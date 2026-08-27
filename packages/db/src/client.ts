/**
 * Cliente de Drizzle sobre `postgres` (postgres.js).
 *
 * ## Filtro de tenant explícito, ADEMÁS de RLS
 * `CLAUDE.md` §2: *"Query sin filtro de tenant además de RLS → rechazo (defensa en profundidad)"*.
 * RLS es el límite de seguridad real (ADR-001), pero es **un solo** límite: alcanza con un
 * `service_role` mal usado, o con una policy que alguien afloje en un fix apurado, para que
 * desaparezca. El `where(eq(t.tenantId, tenantId))` del DAL es el segundo.
 *
 * ## Pool
 * Postgres cobra por conexión, y Vercel abre una función por request. `max: 1` en serverless no
 * es tacañería: es lo que evita agotar el pool con 20 lambdas tibias. El valor real lo fija
 * `apps/web`; acá queda el default conservador.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { databaseUrl } from './env';
import * as schema from './schema';

export type Database = ReturnType<typeof drizzle<typeof schema>>;

export interface CreateClientOptions {
  readonly url?: string;
  readonly max?: number;
  /** `true` en scripts de un solo uso (seed, migrate, tests). */
  readonly onIdleTimeoutSeconds?: number;
}

export function createSqlClient(options: CreateClientOptions = {}) {
  return postgres(options.url ?? databaseUrl(), {
    max: options.max ?? 1,
    ...(options.onIdleTimeoutSeconds === undefined ? {} : { idle_timeout: options.onIdleTimeoutSeconds }),
    // `numeric` llega como string y así se queda: convertirlo a `number` acá tiraría a la basura
    // la única garantía que da `numeric`. La conversión exacta a centavos la hace `src/money.ts`.
    prepare: false,
    onnotice: () => {},
  });
}

export function createDb(options: CreateClientOptions = {}): { db: Database; close: () => Promise<void> } {
  const sql = createSqlClient(options);
  const db = drizzle(sql, { schema });
  return { db, close: async () => { await sql.end({ timeout: 5 }); } };
}
