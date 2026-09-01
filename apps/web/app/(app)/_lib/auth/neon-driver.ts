import 'server-only';

import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { withServiceDb } from '../db/session';
import { selectedPlanFromFormValue } from './selected-plan';
import { AuthError, type AuthDriver, type AuthIdentity, type SignInResult } from './types';
import { neonAuth } from './neon-server';

const emailSchema = z
  .string()
  .transform((raw) => raw.trim().toLowerCase())
  .pipe(z.email('Ese mail no parece válido.').max(254));

const neonUserSchema = z.object({
  id: z.uuid(),
  email: z.email().max(254),
  name: z.string().nullable().optional(),
});

function identityFromUser(value: unknown): AuthIdentity {
  const parsed = neonUserSchema.safeParse(value);
  if (!parsed.success) {
    throw new AuthError('BACKEND_UNAVAILABLE', 'Neon Auth devolvió una identidad inválida.');
  }

  return {
    userId: parsed.data.id,
    email: parsed.data.email,
    fullName: parsed.data.name?.trim() || null,
  };
}

/**
 * Neon Auth es la fuente canónica de identidad. `auth.users` es sólo un espejo UUID local para
 * conservar las FK y los tests de RLS del dominio; nunca se usa para autenticar a una persona.
 */
async function ensureLocalIdentity(identity: AuthIdentity): Promise<void> {
  await withServiceDb(async (tx) => {
    await tx.execute(sql`
      insert into auth.users (id, email)
      values (${identity.userId}::uuid, ${identity.email})
      on conflict (id) do update set email = excluded.email
    `);
    await tx.execute(sql`
      insert into public.users (id, email, full_name)
      values (${identity.userId}::uuid, ${identity.email}, ${identity.fullName})
      on conflict (id) do update
        set email = excluded.email,
            full_name = coalesce(excluded.full_name, public.users.full_name),
            updated_at = now()
    `);
  });
}

function isMissingSession(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const status = 'status' in error ? (error as { status?: unknown }).status : undefined;
  const code = 'code' in error ? (error as { code?: unknown }).code : undefined;
  return status === 401 || code === 'session_not_found' || code === 'UNAUTHORIZED';
}

function backendError(message: string, error: unknown): AuthError {
  if (error instanceof AuthError) return error;
  if (isMissingSession(error)) return new AuthError('BACKEND_UNAVAILABLE', 'No hay una sesión activa.');
  return new AuthError('BACKEND_UNAVAILABLE', message);
}

export function neonAuthDriver(): AuthDriver {
  return {
    name: 'neon',
    isDevelopmentOnly: false,

    async currentIdentity(): Promise<AuthIdentity | null> {
      try {
        const result = await neonAuth().getSession();
        if (result.error !== null) {
          if (isMissingSession(result.error)) return null;
          throw result.error;
        }
        if (result.data === null || result.data.user === null) return null;

        const identity = identityFromUser(result.data.user);
        await ensureLocalIdentity(identity);
        return identity;
      } catch (error) {
        if (isMissingSession(error)) return null;
        throw backendError('No pudimos validar tu sesión. Probá de nuevo.', error);
      }
    },

    async signIn(input): Promise<SignInResult> {
      const parsed = emailSchema.safeParse(input.email);
      const selectedPlan = selectedPlanFromFormValue(input.selectedPlan);
      const password = z.string().min(8).max(128).safeParse(input.password);
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
      if (!password.success) {
        return { ok: false, code: 'BACKEND_UNAVAILABLE', message: 'La contraseña necesita entre 8 y 128 caracteres.' };
      }

      try {
        const result =
          input.mode === 'sign_up'
            ? await neonAuth().signUp.email({
                email: parsed.data,
                password: password.data,
                name: parsed.data.split('@')[0] ?? 'Usuario iStock',
              })
            : await neonAuth().signIn.email({ email: parsed.data, password: password.data });
        if (result.error !== null) {
          if (result.error.status === 429 || result.error.code === 'TOO_MANY_REQUESTS') {
            return {
              ok: false,
              code: 'RATE_LIMITED',
              message: 'Demasiados intentos. Esperá un rato y probá de nuevo.',
            };
          }
          return {
            ok: false,
            code: 'BACKEND_UNAVAILABLE',
            message:
              input.mode === 'sign_up'
                ? 'No pudimos crear la cuenta. Revisá los datos o probá con otro mail.'
                : 'El mail o la contraseña no son correctos.',
          };
        }
        return { ok: true, status: 'signed_in', identity: identityFromUser(result.data.user) };
      } catch (error) {
        if (error instanceof AuthError) {
          return { ok: false, code: error.code, message: error.message };
        }
        throw backendError('No pudimos validar tu acceso. Probá de nuevo en un minuto.', error);
      }
    },

    async signOut(): Promise<void> {
      try {
        const result = await neonAuth().signOut();
        if (result.error !== null && !isMissingSession(result.error)) throw result.error;
      } catch (error) {
        throw backendError('No pudimos cerrar tu sesión. Probá de nuevo.', error);
      }
    },

    async syncTenantClaim(userId: string, tenantId: string): Promise<void> {
      const ids = z.object({ userId: z.uuid(), tenantId: z.uuid() }).safeParse({ userId, tenantId });
      if (!ids.success) throw new AuthError('BACKEND_UNAVAILABLE', 'No pudimos sincronizar el tenant.');
      // El claim no se persiste en el proveedor: `withTenantDb` lo construye desde la membresía
      // revalidada en cada request, evitando metadata mutable como fuente de autorización.
    },
  };
}
