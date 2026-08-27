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
   * `supabase` → GoTrue real. **Bloqueado en B2** (falta el proyecto y la service role key).
   */
  AUTH_DRIVER: z.enum(['local', 'supabase']).default('local'),

  /** HMAC de la cookie de sesión del driver local. Sólo dev. */
  AUTH_LOCAL_SECRET: z.string().min(16, 'AUTH_LOCAL_SECRET necesita al menos 16 caracteres').optional(),

  DATABASE_URL: z.string().min(1).optional(),

  NEXT_PUBLIC_ROOT_DOMAIN: z.string().min(1).default('localhost:3000'),
  NEXT_PUBLIC_APP_URL: z.string().min(1).default('http://localhost:3000'),

  // B2. Presentes pero opcionales: el panel arranca sin ellas con el driver local.
  NEXT_PUBLIC_SUPABASE_URL: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
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
      'AUTH_DRIVER="local" está prohibido en producción. Configurá Supabase (blocker B2) y ' +
        'poné AUTH_DRIVER="supabase".',
    );
  }
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
