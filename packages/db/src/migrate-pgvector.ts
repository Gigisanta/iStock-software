/**
 * Migración **opcional y aparte**: embeddings del catálogo global con pgvector.
 *
 * Está separada porque el Postgres de desarrollo de esta máquina **no tiene pgvector**, y las
 * migraciones base tienen que poder aplicar limpias contra `istock_dev`. Meter
 * `create extension vector` en `0000` haría que nadie pueda correr el schema en local, que es
 * justamente donde se prueba la RLS.
 *
 * Los embeddings se calculan **sólo en el seed/update de `catalog_models`** (CLAUDE.md §3),
 * nunca por request y nunca por tenant: el catálogo es global, así que se pagan una vez para
 * todos los tenants.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createSqlClient } from './client';
import { databaseUrl } from './env';

const file = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../drizzle/optional/0100_pgvector_embeddings.sql',
);

async function main(): Promise<void> {
  const sql = createSqlClient({ url: databaseUrl() });
  try {
    await sql.unsafe(readFileSync(file, 'utf8'));
    process.stdout.write('pgvector OK\n');
  } catch (error) {
    process.stderr.write(
      `pgvector NO aplicado: ${error instanceof Error ? error.message : String(error)}\n` +
        'Es esperable en un Postgres sin la extension. Las migraciones base NO dependen de esto.\n',
    );
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

await main();
