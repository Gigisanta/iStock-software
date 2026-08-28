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

/**
 * Base pública cuando no se setea nada. **Sólo legítima con `MEDIA_DRIVER=local`** (dev/test):
 * la sirve `apps/web/app/(app)/_media/[...key]/route.ts`. Con `r2` es obligatoria de verdad, ver
 * el `superRefine` de abajo.
 */
const LOCAL_MEDIA_BASE_URL = 'http://localhost:3000/_media';

const baseSchema = z.object({
  MEDIA_DRIVER: z.enum(MEDIA_DRIVERS).default('local'),
  /**
   * Base pública del CDN. Prod: `https://img.maat.work`.
   *
   * `optional()` y no `default()`, igual que las credenciales de R2: el default se aplica recién
   * en el `transform` final, así el `superRefine` puede distinguir "no la setearon" de "la
   * setearon". Con `default()` la ausencia era indistinguible del valor de dev y el boot con
   * `MEDIA_DRIVER=r2` salía verde sirviendo `<img src="http://localhost:3000/…">` a todas las
   * vidrieras, sin una sola excepción en Sentry (falla en el browser del visitante) y cacheado
   * por ISR hasta la próxima invalidación.
   */
  NEXT_PUBLIC_MEDIA_BASE_URL: nonEmpty.optional(),
  /** Raíz del driver local en disco. Sólo dev/test. */
  MEDIA_LOCAL_ROOT: z.string().trim().optional(),
  R2_ACCOUNT_ID: z.string().trim().optional(),
  R2_ACCESS_KEY_ID: z.string().trim().optional(),
  R2_SECRET_ACCESS_KEY: z.string().trim().optional(),
  R2_BUCKET_ORIGINALS: nonEmpty.default('istock-originals'),
  R2_BUCKET_MEDIA: nonEmpty.default('istock-media'),
  /**
   * La setea Vercel sola (`production` · `preview` · `development`). No se setea a mano; está en
   * el schema sólo para poder exigir el driver correcto en producción, abajo. Ausente = no
   * estamos en Vercel (tu máquina, los e2e, el gate) y no se exige nada.
   */
  VERCEL_ENV: z.string().trim().optional(),
});

const schema = baseSchema
  .superRefine((env, ctx) => {
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
      // Sin esto el fallo es invisible para el sistema: Zod pasa, el boot sale verde y el
      // `<img src>` roto se rompe recién en el browser del visitante (cero excepciones en
      // Sentry) y encima queda cacheado por ISR. El mensaje lo lee un operador en el dashboard
      // de Vercel a las 11 de la noche: dice qué setear, dónde, y que hay que redeployar.
      if (!env.NEXT_PUBLIC_MEDIA_BASE_URL) {
        ctx.addIssue({
          code: 'custom',
          path: ['NEXT_PUBLIC_MEDIA_BASE_URL'],
          message:
            'NEXT_PUBLIC_MEDIA_BASE_URL es obligatoria cuando MEDIA_DRIVER=r2. Seteala en Vercel ' +
            '→ Project → Settings → Environment Variables (Production) con el custom domain del ' +
            'bucket público y sin barra final, p.ej. ' +
            'NEXT_PUBLIC_MEDIA_BASE_URL=https://img.maat.work, y volvé a deployar: es ' +
            'NEXT_PUBLIC_* y se inlinea en el build. Sin ella la vidriera sirve ' +
            '<img src="http://localhost:3000/_media/…"> y no carga ninguna foto. El default sólo ' +
            'vale con MEDIA_DRIVER=local.',
        });
      }
      if (env.R2_BUCKET_MEDIA === env.R2_BUCKET_ORIGINALS) {
        ctx.addIssue({
          code: 'custom',
          path: ['R2_BUCKET_MEDIA'],
          message:
            'ADR-006: son DOS buckets. El master en el bucket público es descargable por ' +
            'cualquiera.',
        });
      }
    }
    // ────────────────────────────────────────────────────────────────────────────────────────
    //  En producción el driver es `r2`, y esto es un requisito de COSTO (CLAUDE.md §0.12).
    // ────────────────────────────────────────────────────────────────────────────────────────
    // Con el driver local en producción cada foto sale por `/_media` de la función de Next en vez
    // del CDN de Cloudflare: Edge Requests + Fast Origin Transfer. Es el único camino medido por
    // el que S2 se sale del presupuesto. Hoy "no pasa" porque el disco de Vercel es efímero y el
    // upload revienta antes, pero eso es un efecto secundario del filesystem, no un assert: un
    // `ENOENT` no explica por qué está mal, esto sí.
    if (env.VERCEL_ENV === 'production' && env.MEDIA_DRIVER !== 'r2') {
      ctx.addIssue({
        code: 'custom',
        path: ['MEDIA_DRIVER'],
        message:
          `MEDIA_DRIVER tiene que ser "r2" en producción (VERCEL_ENV=production) y está en ` +
          `"${env.MEDIA_DRIVER}". Seteá MEDIA_DRIVER=r2 en Vercel → Project → Settings → ` +
          'Environment Variables (Production) y volvé a deployar. Con el driver local las fotos ' +
          'salen por /_media de la función de Next en vez del CDN de Cloudflare: son Edge ' +
          'Requests + Fast Origin Transfer, USD 0.033/tenant/mes (USD 3.30 a 100 tenants) contra ' +
          'un objetivo de USD 0.50 por tenant.',
      });
    }
    // El bucket público se sirve por custom domain. `r2.dev` está rate-limited y sin cache:
    // cada request sería un GetObject (Class B) y un pico rompe la vidriera.
    if (/\.r2\.dev(\/|$)/i.test(env.NEXT_PUBLIC_MEDIA_BASE_URL ?? '')) {
      ctx.addIssue({
        code: 'custom',
        path: ['NEXT_PUBLIC_MEDIA_BASE_URL'],
        message: 'r2.dev está prohibido: rate-limited, sin cache y sin WAF. Usar img.maat.work.',
      });
    }
  })
  .transform((env) => ({
    ...env,
    NEXT_PUBLIC_MEDIA_BASE_URL: env.NEXT_PUBLIC_MEDIA_BASE_URL ?? LOCAL_MEDIA_BASE_URL,
  }));

export type MediaEnv = z.infer<typeof schema>;

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
