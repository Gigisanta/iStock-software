import 'server-only';
import { createDb, type Database } from '@istock/db';
import { serverEnv } from '../env';

/**
 * Una conexión por instancia de función, memoizada a nivel de módulo.
 *
 * `packages/db` deja el default en `max: 1` y explica por qué: *"Postgres cobra por conexión, y
 * Vercel abre una función por request"*. Lo que agrega este archivo es **no abrir y cerrar** el
 * pool en cada request: `createDb().close()` por request convierte cada página del panel en un
 * handshake TCP + TLS contra Neon Postgres.
 *
 * El módulo vive en el runtime de la app (no en `proxy.ts`), así que memoizar acá **sí** es un
 * cache: la advertencia de Next sobre módulos y globals aplica al proxy, no a los Server
 * Components.
 */

let cached: Database | undefined;

export function db(): Database {
  if (cached !== undefined) return cached;

  const url = serverEnv().DATABASE_URL;
  cached = createDb({ max: 1, ...(url === undefined ? {} : { url }) }).db;
  return cached;
}

/** El tipo de la transacción de Drizzle, sin repetir los genéricos de `PgTransaction`. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
