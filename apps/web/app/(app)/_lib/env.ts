import 'server-only';
import { z } from 'zod';

/**
 * Borde de entorno del panel. **Zod en todos los bordes** (`CLAUDE.md` §5) incluye `process.env`:
 * una variable mal escrita tiene que romper acá, con un mensaje en castellano, y no seis capas
 * más abajo con un `undefined` que se guarda en la base.
 *
 * Dos decisiones que no son estilo:
 *
 * 1. **El parseo es perezoso y memoizado**, no en tiempo de import. Next evalúa los módulos
 *    durante el build (prerender de rutas), y ahí no hay `DATABASE_URL` ni secretos: parsear al
 *    importar convertiría "falta una env de runtime" en "no compila".
 * 2. **Nada de acá se re-exporta a un Client Component.** El archivo es `server-only`. Las
 *    `NEXT_PUBLIC_*` se leen igual desde el server; ponerlas acá no las hace secretas, sólo las
 *    valida en un lugar.
 */

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /**
   * `local`  → driver de desarrollo: cookie firmada + Postgres local (`scripts/pg-local.sh`).
   * `neon`   → Neon Auth real, administrado por la integración de Vercel.
   * `supabase` → compatibilidad temporal para instalaciones anteriores.
   */
  AUTH_DRIVER: z.enum(['local', 'neon', 'supabase']).default('local'),

  /** HMAC de la cookie de sesión del driver local. Sólo dev. */
  AUTH_LOCAL_SECRET: z.string().min(16, 'AUTH_LOCAL_SECRET necesita al menos 16 caracteres').optional(),

  DATABASE_URL: z.string().min(1).optional(),

  NEON_AUTH_BASE_URL: z.string().optional(),
  NEON_AUTH_COOKIE_SECRET: z.string().optional(),

  NEXT_PUBLIC_ROOT_DOMAIN: z.string().min(1).default('localhost:3000'),
  NEXT_PUBLIC_APP_URL: z.string().min(1).default('http://localhost:3000'),

  // B2. Presentes pero opcionales: el panel arranca sin ellas con el driver local.
  NEXT_PUBLIC_SUPABASE_URL: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  /**
   * Credencial del cron de Vercel: llega como `Authorization: Bearer <CRON_SECRET>`.
   *
   * La cadena vacía se acepta **a propósito** y significa "no configurado": es lo que trae
   * `.env.example`, y es lo que hay en desarrollo, donde el cron no corre. Si en vez de eso el
   * schema exigiera un mínimo siempre, un panel de desarrollo no arrancaría por una variable que
   * sólo usa una ruta. Cuando tiene valor, en cambio, se le exige largo: un secreto corto es un
   * secreto adivinable, y esta es la única puerta HTTP sin sesión que escribe en la base.
   */
  CRON_SECRET: z
    .union([z.literal(''), z.string().min(24, 'CRON_SECRET necesita al menos 24 caracteres')])
    .optional(),

  /**
   * DSN de Sentry. Opcional, y **sin validar la forma acá a propósito** — que es lo contrario de
   * lo que hace `CRON_SECRET` dos líneas más arriba, así que la diferencia se explica:
   *
   * Un `CRON_SECRET` corto es un agujero de autenticación y tiene que romper fuerte. Un
   * `SENTRY_DSN` mal tipeado no abre nada: apaga la telemetría. Si acá dijera `z.url()`, una `s`
   * de más en el DSN dejaría **el panel entero** sin arrancar por la variable menos importante del
   * archivo. La forma la valida `parseSentryDsn()` en `_lib/observability/media-incidents.ts`, que
   * ante un DSN roto queda inerte y deja **una** línea de log en el bootstrap.
   */
  SENTRY_DSN: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  if (cached !== undefined) return cached;

  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(' · ');
    throw new Error(`Variables de entorno inválidas → ${detail}`);
  }

  cached = parsed.data;
  return cached;
}

/**
 * El driver local **no puede** correr en producción: firma una cookie con un secreto de
 * desarrollo y da de alta usuarios sin verificar el mail. Que exista es útil; que se despliegue
 * sería un bypass de autenticación.
 */
export function assertLocalDriverAllowed(env: ServerEnv): void {
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'AUTH_DRIVER="local" está prohibido en producción. Configurá Neon Auth y poné ' +
        'AUTH_DRIVER="neon".',
    );
  }
}

/**
 * El secreto del cron, o `null` si no hay ninguno configurado.
 *
 * **`null` para ausente y para vacío.** Un `CRON_SECRET=""` heredado de `.env.example` en un
 * preview deploy es exactamente el caso en el que una comparación descuidada deja pasar a
 * cualquiera: acá no existe ese camino, porque no hay valor con el cual comparar y quien lo
 * consume (`app/api/cron/expire-reservations/route.ts`) responde **401**. En esos dos casos esta
 * función **no tira**, y eso es deliberado: si tirara, "no está configurado" saldría con un status
 * distinto que "credencial equivocada", y esa diferencia es un oráculo gratis para quien esté
 * probando la puerta.
 *
 * **Pero `null` no es el único desenlace posible, y decir que esta función "no tira" era falso.**
 * Lo primero que hace es `serverEnv()`, que valida `process.env` entero con Zod y **lanza** cuando
 * algo no pasa. Dos consecuencias reales, las dos con 500:
 *
 * 1. `CRON_SECRET` **seteado pero inválido** (cualquier valor no vacío de menos de 24 caracteres)
 *    no llega nunca a este `return`: revienta en el `safeParse`. O sea que "seteado a `xyz`" y
 *    "sin setear" **no** dan la misma respuesta HTTP: el primero es 500, el segundo 401.
 * 2. Cualquier **otra** variable inválida del schema tira igual, aunque no tenga nada que ver con
 *    el cron: la validación es del entorno completo, no de una clave.
 *
 * El llamado de la ruta está **fuera** de su `try`, así que esa excepción sube y Next responde 500.
 * Se deja así a propósito: un secreto corto es un error de despliegue nuestro, no un intento de
 * nadie, y tiene que ser ruidoso. Lo que hay que tener presente es que **la única falla que degrada
 * a 401 silencioso es la ausencia**; el resto rompe fuerte, y está bien que rompa.
 */
export function cronSecret(): string | null {
  const value = serverEnv().CRON_SECRET;
  return value === undefined || value.length === 0 ? null : value;
}

/** Host raíz sin protocolo: `maat.work` en prod, `localhost:3000` en dev. */
export function rootDomain(): string {
  return serverEnv().NEXT_PUBLIC_ROOT_DOMAIN;
}

/**
 * URL pública de la vidriera de un tenant. En dev el wildcard se resuelve con
 * `{slug}.localhost:3000`; en prod es `https://{slug}.maat.work`.
 *
 * No usa `storefrontUrl()` de `@istock/domain` a propósito: esa función hardcodea `maat.work`
 * (es la que arma el texto del `wa.me`, donde el dominio real **tiene** que aparecer), y en dev
 * mostraría un link muerto en el panel.
 */
export function storefrontUrlForSlug(slug: string): string {
  const scheme = rootDomain().startsWith('localhost') ? 'http' : 'https';
  return `${scheme}://${storefrontHostForSlug(slug)}`;
}

/**
 * Lo mismo sin protocolo, para **mostrar** en pantalla.
 *
 * Existe porque el panel escribía `{slug}.maat.work` a mano al lado de un `href` que en desarrollo
 * apunta a `localhost`. Con el link y el texto diciendo cosas distintas, el botón "copiar" copia
 * una tercera. El texto de la pantalla sale de la misma función que el link, siempre.
 */
export function storefrontHostForSlug(slug: string): string {
  return `${slug}.${rootDomain()}`;
}

/**
 * DSN de Sentry, o `null` si no hay ninguno configurado.
 *
 * `null` para ausente **y para vacío**, por el mismo motivo que `cronSecret()`: `.env.example`
 * trae `SENTRY_DSN=""` y un preview deploy lo hereda tal cual. La diferencia con el cron es qué
 * significa ese `null`: allá es "no autorizás a nadie", acá es "no reportás a nadie".
 */
export function sentryDsn(): string | null {
  const value = serverEnv().SENTRY_DSN;
  const trimmed = value?.trim() ?? '';
  return trimmed.length === 0 ? null : trimmed;
}
