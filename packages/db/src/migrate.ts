/**
 * Aplica las migraciones **versionadas y commiteadas** de `drizzle/`.
 *
 * `drizzle-kit push` no se usa como fuente de verdad (`db-agent` §3): no deja archivo, no se
 * revisa en un PR y no se puede replicar contra Supabase. Este script sólo **aplica** lo que ya
 * está en git.
 *
 * La migración de pgvector **no** entra acá: vive en `drizzle/optional/` y se aplica con
 * `pnpm --filter @istock/db migrate:pgvector`. El Postgres de desarrollo local no tiene la
 * extensión, y las migraciones base tienen que aplicar limpias igual.
 */

import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createDb } from './client';
import { databaseUrl } from './env';

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../drizzle');

async function main(): Promise<void> {
  const url = databaseUrl();
  process.stdout.write(`migrate → ${url.replace(/:[^:@/]*@/, ':***@')}\n`);
  const { db, close } = createDb({ url });
  try {
    await migrate(db, { migrationsFolder });
    process.stdout.write('migrate OK\n');
  } finally {
    await close();
  }
}

await main();
