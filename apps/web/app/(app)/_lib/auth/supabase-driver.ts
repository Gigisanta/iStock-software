import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { serverEnv } from '../env';
import { selectedPlanFromFormValue, type SelectedPlan } from './selected-plan';
import { AuthError, type AuthDriver, type AuthIdentity, type SignInResult } from './types';

const emailSchema = z
  .string()
  .transform((raw) => raw.trim().toLowerCase())
  .pipe(z.email('Ese mail no parece válido.').max(254));

const userSchema = z.object({
  id: z.uuid(),
  email: z.email().max(254),
  user_metadata: z.unknown().optional(),
});

const metadataSchema = z.object({ full_name: z.string().nullable().optional() }).passthrough();
const callbackCodeSchema = z.string().trim().min(1).max(2048);

type SupabaseConfig = {
  readonly url: string;
  readonly anonKey: string;
};

type SupabaseAdminConfig = SupabaseConfig & {
  readonly serviceRoleKey: string;
};

function validHttpUrl(value: string): string | null {
  const parsed = z.url().safeParse(value);
  if (!parsed.success) return null;
  const url = new URL(parsed.data);
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString().replace(/\/$/u, '') : null;
}

function publicConfig(): SupabaseConfig {
  const env = serverEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL === undefined ? null : validHttpUrl(env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';

  if (url === null || anonKey.length === 0) {
    throw new AuthError(
      'DRIVER_NOT_CONFIGURED',
      'Falta configurar el proyecto de Supabase para poder ingresar. Para desarrollo usá AUTH_DRIVER="local".',
    );
  }

  return { url, anonKey };
}

function adminConfig(): SupabaseAdminConfig {
  const config = publicConfig();
  const serviceRoleKey = serverEnv().SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';
  if (serviceRoleKey.length === 0) {
    throw new AuthError(
      'DRIVER_NOT_CONFIGURED',
      'Falta configurar el service role de Supabase para sincronizar el tenant.',
    );
  }
  return { ...config, serviceRoleKey };
}

function appUrl(): string {
  const value = validHttpUrl(serverEnv().NEXT_PUBLIC_APP_URL);
  if (value === null) {
    throw new AuthError(
      'DRIVER_NOT_CONFIGURED',
      'NEXT_PUBLIC_APP_URL tiene que ser una URL http(s) válida para poder ingresar.',
    );
  }
  return value;
}

async function serverClient() {
  const config = publicConfig();
  const cookieStore = await cookies();

  /**
   * `getUser()` puede renovar tokens. En un Server Component, Next expone cookies de sólo lectura
   * y `setAll` no puede persistir ese refresh; el try/catch es el límite intencional de este borde.
   * El callback y las Server Actions usan el mismo cliente en contextos mutables, por lo que ahí sí
   * quedan persistidas las cookies `sb-*`. No se agrega refresh al `proxy.ts`: su contrato es cero
   * I/O para que los hits cacheados de la vidriera no disparen una red por pageview.
   */
  return createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components pueden leer cookies pero no escribirlas. Las Server Actions y el
          // callback sí pueden hacerlo; el refresh se persiste en el próximo borde mutable.
        }
      },
    },
  });
}

function callbackUrl(selectedPlan: SelectedPlan | null): string {
  const validatedPlan = selectedPlanFromFormValue(selectedPlan);
  if (selectedPlan !== null && validatedPlan === null) {
    throw new AuthError('BACKEND_UNAVAILABLE', 'El plan elegido no es válido.');
  }

  const url = new URL('/api/auth/callback', appUrl());
  if (validatedPlan !== null) url.searchParams.set('plan', validatedPlan);
  return url.toString();
}

function identityFromUser(value: unknown): AuthIdentity {
  const parsed = userSchema.safeParse(value);
  if (!parsed.success) {
    throw new AuthError('BACKEND_UNAVAILABLE', 'Supabase devolvió una identidad inválida.');
  }

  const metadata = metadataSchema.safeParse(parsed.data.user_metadata);
  return {
    userId: parsed.data.id,
    email: parsed.data.email,
    fullName: metadata.success ? (metadata.data.full_name ?? null) : null,
  };
}

function isMissingSession(error: unknown): boolean {
  if (error instanceof Error && error.name === 'AuthSessionMissingError') return true;
  if (typeof error !== 'object' || error === null) return false;

  const status = 'status' in error ? (error as { status?: unknown }).status : undefined;
  const code = 'code' in error ? (error as { code?: unknown }).code : undefined;
  return status === 401 || code === 'session_not_found';
}

function backendError(message: string, error: unknown): AuthError {
  if (error instanceof AuthError) return error;
  return new AuthError('BACKEND_UNAVAILABLE', message);
}

function errorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

/** Canjea el código PKCE del magic link y deja la sesión en las cookies SSR. */
export async function exchangeSupabaseCodeForSession(code: string): Promise<void> {
  const parsed = callbackCodeSchema.safeParse(code);
  if (!parsed.success) throw new AuthError('BACKEND_UNAVAILABLE', 'El link de ingreso no es válido.');

  try {
    const client = await serverClient();
    const { data, error } = await client.auth.exchangeCodeForSession(parsed.data);
    if (error !== null || data.session === null) {
      throw new AuthError('BACKEND_UNAVAILABLE', 'El link de ingreso venció o ya fue usado.');
    }
  } catch (error) {
    throw backendError('No pudimos validar el link de ingreso. Probá pedir uno nuevo.', error);
  }
}

export function supabaseAuthDriver(): AuthDriver {
  return {
    name: 'supabase',
    isDevelopmentOnly: false,

    async currentIdentity(): Promise<AuthIdentity | null> {
      try {
        const client = await serverClient();
        const { data, error } = await client.auth.getUser();
        if (error !== null) {
          if (isMissingSession(error)) return null;
          throw error;
        }
        if (data.user === null) return null;
        return identityFromUser(data.user);
      } catch (error) {
        if (isMissingSession(error)) return null;
        throw backendError('No pudimos validar tu sesión. Probá de nuevo.', error);
      }
    },

    async signIn(input): Promise<SignInResult> {
      const parsed = emailSchema.safeParse(input.email);
      const selectedPlan = selectedPlanFromFormValue(input.selectedPlan);
      if (!parsed.success) {
        return {
          ok: false,
          code: 'INVALID_EMAIL',
          message: parsed.error.issues[0]?.message ?? 'Ese mail no parece válido.',
        };
      }
      if (input.selectedPlan !== null && selectedPlan === null) {
        return { ok: false, code: 'BACKEND_UNAVAILABLE', message: 'El plan elegido no es válido.' };
      }

      try {
        const client = await serverClient();
        const { error } = await client.auth.signInWithOtp({
          email: parsed.data,
          options: { emailRedirectTo: callbackUrl(selectedPlan) },
        });

        if (error !== null) {
          if (error.status === 429 || errorCode(error) === 'over_email_send_rate_limit') {
            return {
              ok: false,
              code: 'RATE_LIMITED',
              message: 'Pediste varios links. Esperá un rato y probá de nuevo.',
            };
          }
          return {
            ok: false,
            code: 'BACKEND_UNAVAILABLE',
            message: 'No pudimos mandar el link. Probá de nuevo en un minuto.',
          };
        }

        // signInWithOtp sólo dispara el correo: todavía no hay identidad ni sesión en este punto.
        return { ok: true, status: 'link_sent' };
      } catch (error) {
        if (error instanceof AuthError) {
          return {
            ok: false,
            code: error.code,
            message: 'No pudimos mandar el link. Probá de nuevo en un minuto.',
          };
        }
        throw backendError('No pudimos mandar el link. Probá de nuevo en un minuto.', error);
      }
    },

    async signOut(): Promise<void> {
      try {
        const client = await serverClient();
        const { error } = await client.auth.signOut();
        if (error !== null && !isMissingSession(error)) throw error;
      } catch (error) {
        throw backendError('No pudimos cerrar tu sesión. Probá de nuevo.', error);
      }
    },

    async syncTenantClaim(userId: string, tenantId: string): Promise<void> {
      const ids = z.object({ userId: z.uuid(), tenantId: z.uuid() }).safeParse({ userId, tenantId });
      if (!ids.success) {
        throw new AuthError('BACKEND_UNAVAILABLE', 'No pudimos sincronizar el tenant.');
      }

      try {
        const config = adminConfig();
        const admin = createClient(config.url, config.serviceRoleKey, {
          auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
        });
        const { error } = await admin.auth.admin.updateUserById(ids.data.userId, {
          app_metadata: { tenant_id: ids.data.tenantId },
        });
        if (error !== null) throw error;
      } catch (error) {
        throw backendError('No pudimos sincronizar el tenant con Supabase.', error);
      }
    },
  };
}
