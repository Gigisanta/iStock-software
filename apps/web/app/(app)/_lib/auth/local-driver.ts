import 'server-only';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { withServiceDb } from '../db/session';
import { logEvent } from '../log';
import { clearSessionCookie, readSessionCookie, writeSessionCookie } from './cookies';
import type { AuthDriver, AuthIdentity, SignInInput, SignInResult } from './types';

/**
 * Driver de autenticación **de desarrollo**. Permite levantar el panel sin Neon Auth ni correo
 * externo; la producción siempre usa el driver Neon.
 *
 * Qué emula del proveedor de identidad, y qué no:
 *
 * | pieza | acá | Neon Auth |
 * |---|---|---|
 * | fila en `auth.users` | `insert` directo (la crea `scripts/pg-local.sh`) | Neon Auth |
 * | verificación del mail | **ninguna** | contraseña gestionada por Neon Auth |
 * | sesión | cookie HMAC propia | cookie gestionada por Neon Auth |
 * | claims de tenant | `raw_app_meta_data` de `auth.users` | membresía revalidada por el servidor |
 * | claims que ve Postgres | `set_config('request.jwt.claims', ...)` | idem, vía sesión server-side |
 *
 * La fila "verificación del mail: ninguna" es la razón por la que `assertLocalDriverAllowed()`
 * corta el arranque en producción y por la que `isDevelopmentOnly` es `true`: la pantalla de
 * ingreso **avisa** que está en modo desarrollo. Un login que no dice que no verifica nada es una
 * promesa falsa, y las promesas falsas están prohibidas también adentro del panel.
 */

const emailSchema = z
  .string()
  .transform((raw) => raw.trim().toLowerCase())
  .pipe(z.email('Ese mail no parece válido.').max(254));

type UserRow = {
  readonly id: string;
  readonly email: string;
  readonly full_name: string | null;
};

async function findIdentity(userId: string): Promise<AuthIdentity | null> {
  const rows = await withServiceDb(async (tx) => {
    const result = await tx.execute<UserRow>(
      sql`select id, email, full_name from public.users where id = ${userId}::uuid limit 1`,
    );
    return result as unknown as UserRow[];
  });

  const row = rows[0];
  if (row === undefined) return null;
  return { userId: row.id, email: row.email, fullName: row.full_name };
}

export function localAuthDriver(): AuthDriver {
  return {
    name: 'local',
    isDevelopmentOnly: true,

    async currentIdentity(): Promise<AuthIdentity | null> {
      const payload = await readSessionCookie();
      if (payload === null) return null;
      return findIdentity(payload.userId);
    },

    async signIn(input: SignInInput): Promise<SignInResult> {
      const parsed = emailSchema.safeParse(input.email);
      if (!parsed.success) {
        return {
          ok: false,
          code: 'INVALID_EMAIL',
          message: parsed.error.issues[0]?.message ?? 'Ese mail no parece válido.',
        };
      }
      const email = parsed.data;

      const identity = await withServiceDb(async (tx) => {
        // 1. `auth.users` — en producción esta fila la crea Neon Auth, no nosotros.
        const authRows = (await tx.execute<{ id: string }>(
          sql`insert into auth.users (email)
              values (${email})
              on conflict (email) do update set email = excluded.email
              returning id`,
        )) as unknown as { id: string }[];

        const authUser = authRows[0];
        if (authUser === undefined) throw new Error('no se pudo crear la identidad local');

        // 2. `public.users` — el perfil espejo. `id` = `auth.users.id`, que es lo que hace que
        //    `auth.uid()` sirva para algo (ver el docblock de packages/db/src/schema/users.ts).
        const profileRows = (await tx.execute<UserRow>(
          sql`insert into public.users (id, email)
              values (${authUser.id}::uuid, ${email})
              on conflict (id) do update set email = excluded.email, updated_at = now()
              returning id, email, full_name`,
        )) as unknown as UserRow[];

        const profile = profileRows[0];
        if (profile === undefined) throw new Error('no se pudo crear el perfil local');

        return { userId: profile.id, email: profile.email, fullName: profile.full_name };
      });

      await writeSessionCookie({ userId: identity.userId, issuedAt: Date.now() });
      // Id, nunca el mail: `logEvent` tira si le pasás un campo con nombre de PII.
      logEvent('auth.sign_in', { driver: 'local', userId: identity.userId });

      return { ok: true, status: 'signed_in', identity };
    },

    async signOut(): Promise<void> {
      await clearSessionCookie();
    },

    async syncTenantClaim(userId: string, tenantId: string): Promise<void> {
      // `raw_app_meta_data` queda reservado para claims server-side. **Nunca**
      // `raw_user_meta_data`: eso es metadata editable por el usuario (lint 0015, ERROR).
      // En este driver el tenant se revalida desde `memberships` en cada request, así que el
      // campo es sólo paridad con el esquema de auth local, no la fuente de verdad.
      await withServiceDb(async (tx) => {
        await tx.execute(
          sql`update auth.users
                 set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                                         || jsonb_build_object('tenant_id', ${tenantId}::text)
               where id = ${userId}::uuid`,
        );
      });
    },
  };
}
