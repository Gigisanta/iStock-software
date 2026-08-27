import 'server-only';
import { serverEnv } from '../env';
import { AuthError, type AuthDriver, type AuthIdentity, type SignInResult } from './types';

/**
 * Driver real. **Bloqueado en B2** y además le falta una dependencia que `app-agent` no puede
 * agregar (`apps/web/package.json` lo escribe el LEAD).
 *
 * No hay un mock disfrazado de implementación acá. Un driver que "casi anda" es peor que uno que
 * falla fuerte: se despliega sin que nadie lo note. Este tira `DRIVER_NOT_CONFIGURED` con el
 * motivo exacto.
 *
 * ── Lo que falta para prenderlo, en orden ────────────────────────────────────────────────────
 *
 * 1. **Dependencia** (BLOCKER, LEAD): `@supabase/ssr` + `@supabase/supabase-js` en
 *    `apps/web/package.json`.
 *
 * 2. **Env** (BLOCKER B2, humano): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
 *    `SUPABASE_SERVICE_ROLE_KEY`. Spend cap ON antes de la primera request.
 *
 * 3. **Custom Access Token Hook** (db-agent / operador): una función SQL que lea `memberships` y
 *    escriba `app_metadata.tenant_id` en el access token. `ARCHITECTURE.md` §"Modelo de RLS".
 *    **`app_metadata`, jamás `user_metadata`.**
 *
 * 4. **Implementación**, que es corta porque el flujo ya está escrito en `_lib/session.ts`:
 *
 * ```ts
 * import { createServerClient } from '@supabase/ssr';
 * import { cookies } from 'next/headers';
 *
 * async function client() {
 *   const store = await cookies();
 *   return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
 *     cookies: {
 *       getAll: () => store.getAll(),
 *       // Sólo escribe desde Server Actions y Route Handlers. Desde un Server Component,
 *       // `store.set` tira; se ignora a propósito y el refresh lo hace la próxima acción.
 *       setAll: (list) => { try { for (const c of list) store.set(c.name, c.value, c.options); } catch {} },
 *     },
 *   });
 * }
 *
 * // currentIdentity(): SIEMPRE `getUser()`, NUNCA `getSession()`.
 * // `getSession()` lee la cookie sin verificar la firma contra el servidor de auth: confiar en
 * // eso es aceptar un `sub` falsificado, y ese `sub` termina en `request.jwt.claims`.
 * const { data } = await (await client()).auth.getUser();
 * ```
 *
 * 5. **`signIn`**: `signInWithOtp({ email, options: { emailRedirectTo } })` + un Route Handler
 *    `app/api/auth/callback/route.ts` que haga `exchangeCodeForSession`. La autorización se
 *    verifica **dentro** de ese handler; el proxy no lo cubre (ADR-007).
 *
 * 6. **`syncTenantClaim`**: `admin.updateUserById(userId, { app_metadata: { tenant_id } })` con la
 *    service role key, y después forzar rotación del token. Mientras no rote, el claim sigue
 *    stale hasta 3600 s — deuda declarada en `ARCHITECTURE.md`, no bug.
 */

function notConfigured(): never {
  const env = serverEnv();
  const missing: string[] = [];
  if (env.NEXT_PUBLIC_SUPABASE_URL === undefined) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (env.NEXT_PUBLIC_SUPABASE_ANON_KEY === undefined) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  if (env.SUPABASE_SERVICE_ROLE_KEY === undefined) missing.push('SUPABASE_SERVICE_ROLE_KEY');

  throw new AuthError(
    'DRIVER_NOT_CONFIGURED',
    'El driver de Supabase todavía no está implementado (blocker B2 + falta la dependencia ' +
      `@supabase/ssr en apps/web/package.json).${
        missing.length > 0 ? ` Además faltan estas variables: ${missing.join(', ')}.` : ''
      } Para desarrollo usá AUTH_DRIVER="local".`,
  );
}

export function supabaseAuthDriver(): AuthDriver {
  return {
    name: 'supabase',
    isDevelopmentOnly: false,
    currentIdentity: (): Promise<AuthIdentity | null> => notConfigured(),
    signIn: (): Promise<SignInResult> => notConfigured(),
    signOut: (): Promise<void> => notConfigured(),
    syncTenantClaim: (): Promise<void> => notConfigured(),
  };
}
