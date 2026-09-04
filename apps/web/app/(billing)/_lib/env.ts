import 'server-only';
import { z } from 'zod';

/**
 * Borde de entorno de **billing**. `CLAUDE.md` §5: Zod en todos los bordes, y `process.env` es uno.
 *
 * Es un archivo aparte del `_lib/env.ts` del panel y no por comodidad: son dos columnas distintas
 * (`CLAUDE.md` §4) y el panel arranca sin una sola variable de MP. Mezclarlos haría que un
 * `MP_WEBHOOK_SECRET` mal tipeado tumbe el alta de unidades, que no tiene nada que ver.
 *
 * Las tres decisiones que no son estilo, y las tres están copiadas del panel a propósito porque ya
 * costaron una corrida allá:
 *
 * 1. **Parseo perezoso y memoizado.** Next evalúa módulos durante el build; parsear al importar
 *    convierte "falta una env de runtime" en "no compila".
 * 2. **Cadena vacía = no configurado.** Es lo que trae `.env.example` y lo que hereda un preview
 *    deploy. La distinción se hace acá, una vez, y no en cada `if`.
 * 3. **Nada de esto llega al browser.** El archivo es `server-only` y ninguna variable es
 *    `NEXT_PUBLIC_*`. `MP_ACCESS_TOKEN` en el bundle es rechazo automático (`CLAUDE.md` §2).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  B3 está ABIERTO: `mock` es el default y el producto corre igual
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Sin credenciales de Mercado Pago el driver es `mock`, el trial de 14 días funciona entero y
 * **nadie se convierte en pagador**. Falla cerrado por construcción: sin `MP_WEBHOOK_SECRET` no
 * hay firma que verificar, el webhook responde 401 y ningún evento activa ningún plan. No hace
 * falta un assert extra para eso — hace falta que nadie lo "arregle" salteando la verificación.
 */

const BILLING_DRIVERS = ['mock', 'mercadopago'] as const;
export type BillingDriver = (typeof BILLING_DRIVERS)[number];

/** `""` (o ausente) → `undefined`. Un valor presente se exige no trivial. */
const optionalSecret = (min: number, message: string) =>
  z
    .union([z.literal(''), z.string().min(min, message)])
    .optional()
    .transform((value) => (value === undefined || value.length === 0 ? undefined : value));

const billingEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    /** Vercel lo inyecta; permite distinguir un preview sin cobros de Production. */
    VERCEL_ENV: z.string().trim().optional(),

    /**
     * `mock` → cliente de MP en memoria, sin red. `mercadopago` → HTTP real contra
     * `api.mercadopago.com`.
     */
    BILLING_DRIVER: z.enum(BILLING_DRIVERS).default('mock'),

    /**
     * Token de la aplicación de *Tus integraciones*. Server-only, siempre.
     * El mínimo es bajo a propósito: no conozco el largo real que emite MP y un mínimo inventado
     * rompería el día que aterrice B3 con un token más corto del que supuse.
     */
    MP_ACCESS_TOKEN: optionalSecret(16, 'MP_ACCESS_TOKEN parece truncado (mínimo 16 caracteres)'),

    /**
     * Secreto HMAC del webhook, de *Tus integraciones → Webhooks*. La verificación vive **dentro**
     * del route handler (ADR-008 §"lo que ya es ley"): un `matcher` del proxy que excluya el path
     * también saltearía las Server Functions de ese path, así que el proxy no es una defensa.
     */
    MP_WEBHOOK_SECRET: optionalSecret(16, 'MP_WEBHOOK_SECRET parece truncado (mínimo 16 caracteres)'),

  })
  .superRefine((env, ctx) => {
    if (env.VERCEL_ENV === 'production' && env.BILLING_DRIVER !== 'mercadopago') {
      ctx.addIssue({
        code: 'custom',
        path: ['BILLING_DRIVER'],
        message:
          'BILLING_DRIVER tiene que ser "mercadopago" en producción (VERCEL_ENV=production). ' +
          'El driver mock sólo se permite en desarrollo y previews.',
      });
    }
    if (env.BILLING_DRIVER !== 'mercadopago') return;
    // Con el driver real, las dos son obligatorias. Un driver `mercadopago` a medio configurar
    // es peor que el mock: cobra a medias y activa a medias.
    for (const key of [
      'MP_ACCESS_TOKEN',
      'MP_WEBHOOK_SECRET',
    ] as const) {
      if (env[key] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `BILLING_DRIVER="mercadopago" exige ${key} (blocker B3)`,
        });
      }
    }
  });

export type BillingEnv = z.infer<typeof billingEnvSchema>;

let cached: BillingEnv | undefined;

export function billingEnv(): BillingEnv {
  if (cached !== undefined) return cached;

  const parsed = billingEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(' · ');
    throw new Error(`Variables de entorno de billing inválidas → ${detail}`);
  }

  cached = parsed.data;
  return cached;
}

/** Sólo para los tests de este módulo: el memo es por proceso y no hay otra forma de vaciarlo. */
export function resetBillingEnvCache(): void {
  cached = undefined;
}

export function billingDriver(): BillingDriver {
  return billingEnv().BILLING_DRIVER;
}

/**
 * El secreto del webhook, o `null`.
 *
 * `null` significa **"no autorizás a nadie"**, igual que `cronSecret()` en el panel: el handler
 * responde 401 sin tocar Postgres. El bug clásico es el contrario —comparar contra `undefined` y
 * dejar pasar a cualquiera—, y acá ese camino no existe porque no hay valor con el cual comparar.
 */
export function mpWebhookSecret(): string | null {
  return billingEnv().MP_WEBHOOK_SECRET ?? null;
}

export function mpAccessToken(): string | null {
  return billingEnv().MP_ACCESS_TOKEN ?? null;
}

/** El CTA sólo se habilita cuando el driver real puede autenticar alta y webhook. */
export function billingReady(): boolean {
  try {
    return billingDriver() === 'mercadopago' && mpAccessToken() !== null && mpWebhookSecret() !== null;
  } catch {
    return false;
  }
}
