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

/**
 * Claims de la **vidriera anónima**. No hay usuario y no hay `tenant_id`: lo único que el server
 * conoce antes de consultar nada es el slug del host (`{slug}.maat.work`), y eso es lo que acota
 * las filas (`drizzle/0002_storefront_anon_grants.sql`).
 */
export interface StorefrontClaims {
  readonly role: 'anon';
  readonly app_metadata?: { readonly storefront_slug: string };
}

export type SessionClaims = JwtClaims | StorefrontClaims;

export type PgRole = 'authenticated' | 'anon';

/**
 * Parámetros posicionales (`$1`, `$2`, …) de una sentencia. Existen por un motivo concreto y no
 * por comodidad: el caller real del panel **no escribe SQL**, lo emite Drizzle, y `toSQL()`
 * devuelve `{ sql, params }`. Un test que reescribe esa sentencia a mano con los valores
 * interpolados mide una forma de sentencia que no existe en el producto — que es exactamente
 * cómo `0006` pasó verde en `packages/db` y rompió el alta de reservas en e2e.
 */
export type SessionParams = readonly unknown[];

export interface Session {
  /** Corre SQL como `authenticated` con estos claims. Devuelve las filas. */
  query: <T = Record<string, unknown>>(text: string, params?: SessionParams) => Promise<T[]>;
  /** Igual, pero devuelve la cantidad de filas afectadas (update/delete). */
  affected: (text: string, params?: SessionParams) => Promise<number>;
  /** Corre esperando error; devuelve el `code` de Postgres. Falla si NO hubo error. */
  expectError: (text: string, params?: SessionParams) => Promise<string>;
  /**
   * Igual que `expectError` pero devuelve además el mensaje. Hace falta porque **`42501` tapa dos
   * cosas distintas** y confundirlas deja un test verde que no prueba lo que dice:
   *
   *   · `permission denied for table X`                      → faltó el GRANT (capa 1)
   *   · `new row violates row-level security policy for X`   → el GRANT estaba y la **policy**
   *                                                            rechazó la fila (capa 2)
   *
   * Un test que sólo compara el código no distingue "la policy me frenó el insert cruzado" de
   * "nunca tuve privilegio para insertar nada", y esa diferencia **es** el invariante de S4.
   */
  expectFailure: (text: string, params?: SessionParams) => Promise<{ code: string; message: string }>;
  close: () => Promise<void>;
}

export function openSession(claims: SessionClaims, role: PgRole = 'authenticated'): Session {
  const sql = postgres(databaseUrl(), { max: 1, prepare: false, onnotice: () => {} });
  const json = JSON.stringify(claims);

  async function run<T>(text: string, params: SessionParams = []): Promise<{ rows: T[]; count: number }> {
    return sql.begin(async (tx) => {
      await tx.unsafe(`set local role ${role}`);
      await tx.unsafe(`select set_config('request.jwt.claims', $1, true)`, [json]);
      // El cast va contra la firma del driver y no a `any`: los `params` que entran acá salen de
      // `toSQL()` de Drizzle, que los tipa `unknown[]` porque no sabe qué columnas le pasaste.
      const result = await tx.unsafe(text, params as Parameters<typeof tx.unsafe>[1]);
      return { rows: result as unknown as T[], count: result.count };
    }) as unknown as Promise<{ rows: T[]; count: number }>;
  }

  async function expectFailure(text: string, params?: SessionParams): Promise<{ code: string; message: string }> {
    try {
      await run<unknown>(text, params);
    } catch (error) {
      const { code, message } = error as { code?: string; message?: string };
      return { code: code ?? 'UNKNOWN', message: message ?? '' };
    }
    throw new Error(`se esperaba un error de Postgres y la query pasó: ${text}`);
  }

  return {
    query: async <T = Record<string, unknown>>(text: string, params?: SessionParams): Promise<T[]> =>
      (await run<T>(text, params)).rows,
    affected: async (text: string, params?: SessionParams): Promise<number> =>
      (await run<unknown>(text, params)).count,
    expectError: async (text: string, params?: SessionParams): Promise<string> =>
      (await expectFailure(text, params)).code,
    expectFailure,
    close: async () => { await sql.end({ timeout: 5 }); },
  };
}

/**
 * Sesión de vidriera: rol `anon` **real** + el claim de slug. `slug === null` simula el caso en
 * que alguien se olvida de setear el claim: tiene que devolver cero filas, no todo.
 */
export function openStorefrontSession(slug: string | null): Session {
  const claims: StorefrontClaims =
    slug === null ? { role: 'anon' } : { role: 'anon', app_metadata: { storefront_slug: slug } };
  return openSession(claims, 'anon');
}

/** Cliente con privilegios de operador (superusuario / `service_role`): monta los fixtures. */
export function openAdmin() {
  return postgres(databaseUrl(), { max: 1, prepare: false, onnotice: () => {} });
}
