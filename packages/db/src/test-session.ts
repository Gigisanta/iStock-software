/**
 * Sesiones de test contra Postgres **real**. No hay mock acá y no puede haberlo: un mock de RLS
 * prueba que el mock funciona (skill `drizzle-rls` §5, ADR-001 §Verificación).
 *
 * Cada sesión es un cliente propio con `max: 1` → una conexión física propia, igual que dos
 * usuarios distintos pegándole a Supabase. Dentro de cada operación se hace lo mismo que hace
 * PostgREST en producción:
 *
 *   begin;
 *     set local role authenticated;
 *     select set_config('request.jwt.claims', '<json>', true);
 *     <la query>
 *   commit;
 *
 * `auth.jwt()` en `scripts/pg-local.sh` tiene **el mismo cuerpo** que en Supabase (lee
 * `current_setting('request.jwt.claims')`), así que la paridad de lo que importa —la evaluación
 * de la policy— es exacta.
 *
 * Detalle que no es cosmético: el usuario de la conexión es superusuario en local, y un
 * superusuario **bypassea RLS**. Por eso el `set local role authenticated` no es decorativo:
 * sin él, este test pasaría siempre y no probaría nada.
 */

import postgres from 'postgres';
import { databaseUrl } from './env';

export interface JwtClaims {
  readonly sub: string;
  readonly role: 'authenticated';
  readonly app_metadata: { readonly tenant_id: string };
}

export function claimsFor(userId: string, tenantId: string): JwtClaims {
  // ADR-005: el tenant va en `app_metadata`. En `user_metadata` sería escalación de tenant,
  // porque el propio usuario puede escribir ese objeto (lint 0015, severidad ERROR).
  return { sub: userId, role: 'authenticated', app_metadata: { tenant_id: tenantId } };
}

export interface Session {
  /** Corre SQL como `authenticated` con estos claims. Devuelve las filas. */
  query: <T = Record<string, unknown>>(text: string) => Promise<T[]>;
  /** Igual, pero devuelve la cantidad de filas afectadas (update/delete). */
  affected: (text: string) => Promise<number>;
  /** Corre esperando error; devuelve el `code` de Postgres. Falla si NO hubo error. */
  expectError: (text: string) => Promise<string>;
  close: () => Promise<void>;
}

export function openSession(claims: JwtClaims, role: 'authenticated' | 'anon' = 'authenticated'): Session {
  const sql = postgres(databaseUrl(), { max: 1, prepare: false, onnotice: () => {} });
  const json = JSON.stringify(claims);

  async function run<T>(text: string): Promise<{ rows: T[]; count: number }> {
    return sql.begin(async (tx) => {
      await tx.unsafe(`set local role ${role}`);
      await tx.unsafe(`select set_config('request.jwt.claims', $1, true)`, [json]);
      const result = await tx.unsafe(text);
      return { rows: result as unknown as T[], count: result.count };
    }) as unknown as Promise<{ rows: T[]; count: number }>;
  }

  return {
    query: async <T = Record<string, unknown>>(text: string): Promise<T[]> => (await run<T>(text)).rows,
    affected: async (text: string): Promise<number> => (await run<unknown>(text)).count,
    expectError: async (text: string): Promise<string> => {
      try {
        await run<unknown>(text);
      } catch (error) {
        const code = (error as { code?: string }).code;
        return code ?? 'UNKNOWN';
      }
      throw new Error(`se esperaba un error de Postgres y la query pasó: ${text}`);
    },
    close: async () => { await sql.end({ timeout: 5 }); },
  };
}

/** Cliente con privilegios de operador (superusuario / `service_role`): monta los fixtures. */
export function openAdmin() {
  return postgres(databaseUrl(), { max: 1, prepare: false, onnotice: () => {} });
}
