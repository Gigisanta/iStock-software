/**
 * Env de media, validada con Zod (regla: Zod en todos los bordes).
 *
 * **B1 — sin credenciales de R2 el paquete funciona igual**: `MEDIA_DRIVER=local` usa un driver
 * de disco. El pipeline de resize y los techos de bytes no dependen de ninguna credencial.
 *
 * Nada de acá va al browser salvo `NEXT_PUBLIC_MEDIA_BASE_URL`, que es el host del CDN público
 * (`img.maat.work`). `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` son server-only: si aparecen
 * con prefijo `NEXT_PUBLIC_`, esto explota.
 */

import { z } from 'zod';
import { MediaConfigError } from './errors';

export const MEDIA_DRIVERS = ['local', 'r2'] as const;
export type MediaDriverName = (typeof MEDIA_DRIVERS)[number];

const nonEmpty = z.string().trim().min(1);

const baseSchema = z.object({
  MEDIA_DRIVER: z.enum(MEDIA_DRIVERS).default('local'),
  /** Base pública del CDN. Prod: `https://img.maat.work`. */
  NEXT_PUBLIC_MEDIA_BASE_URL: nonEmpty.default('http://localhost:3000/_media'),
  /** Raíz del driver local en disco. Sólo dev/test. */
  MEDIA_LOCAL_ROOT: z.string().trim().optional(),
  R2_ACCOUNT_ID: z.string().trim().optional(),
  R2_ACCESS_KEY_ID: z.string().trim().optional(),
  R2_SECRET_ACCESS_KEY: z.string().trim().optional(),
  R2_BUCKET_ORIGINALS: nonEmpty.default('istock-originals'),
  R2_BUCKET_MEDIA: nonEmpty.default('istock-media'),
});

export type MediaEnv = z.infer<typeof baseSchema>;

const schema = baseSchema.superRefine((env, ctx) => {
  if (env.MEDIA_DRIVER === 'r2') {
    for (const key of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'] as const) {
      if (!env[key]) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} es obligatoria cuando MEDIA_DRIVER=r2`,
        });
      }
    }
    if (env.R2_BUCKET_MEDIA === env.R2_BUCKET_ORIGINALS) {
      ctx.addIssue({
        code: 'custom',
        path: ['R2_BUCKET_MEDIA'],
        message:
          'ADR-006: son DOS buckets. El master en el bucket público es descargable por cualquiera.',
      });
    }
  }
  // El bucket público se sirve por custom domain. `r2.dev` está rate-limited y sin cache:
  // cada request sería un GetObject (Class B) y un pico rompe la vidriera.
  if (/\.r2\.dev(\/|$)/i.test(env.NEXT_PUBLIC_MEDIA_BASE_URL)) {
    ctx.addIssue({
      code: 'custom',
      path: ['NEXT_PUBLIC_MEDIA_BASE_URL'],
      message: 'r2.dev está prohibido: rate-limited, sin cache y sin WAF. Usar img.maat.work.',
    });
  }
});

export type MediaEnvSource = Record<string, string | undefined>;

/** Parsea sin cachear. Lanza `MediaConfigError` con el detalle de Zod. */
export function parseMediaEnv(source: MediaEnvSource = process.env): MediaEnv {
  const result = schema.safeParse(source);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join(' · ');
    throw new MediaConfigError(`Env de media inválida — ${detail}`);
  }
  assertNoPublicSecrets(source);
  return result.data;
}

let cached: MediaEnv | null = null;

/** Igual que `parseMediaEnv` pero memoizado sobre `process.env`. */
export function mediaEnv(): MediaEnv {
  cached ??= parseMediaEnv(process.env);
  return cached;
}

/** Sólo para tests. */
export function resetMediaEnvCache(): void {
  cached = null;
}

const SECRETY = ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ACCOUNT_ID'];

function assertNoPublicSecrets(source: MediaEnvSource): void {
  for (const name of Object.keys(source)) {
    if (!name.startsWith('NEXT_PUBLIC_')) continue;
    const suffix = name.slice('NEXT_PUBLIC_'.length);
    if (SECRETY.includes(suffix)) {
      throw new MediaConfigError(
        `${name} manda una credencial de R2 al bundle del browser. Sacala (CLAUDE.md §2).`,
      );
    }
  }
}
