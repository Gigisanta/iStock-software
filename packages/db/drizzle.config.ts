/**
 * `drizzle-kit generate` es la **única** fuente de las migraciones base.
 * `drizzle-kit push` está prohibido como fuente de verdad (`db-agent` §3): no deja archivo,
 * no se revisa en un PR y no se puede replicar en Supabase.
 *
 * `schemaFilter: ['public']` — el schema `auth` lo maneja Supabase, no nosotros. Las FK a
 * `auth.users` se emiten igual; el `create schema auth` no.
 * `entities.roles.provider: 'supabase'` — `anon` / `authenticated` / `service_role` ya existen
 * (los crea Supabase, y localmente `scripts/pg-local.sh`): drizzle no los crea ni los dropea.
 */
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  schemaFilter: ['public'],
  entities: { roles: { provider: 'supabase' } },
  verbose: true,
  strict: true,
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/istock_dev',
  },
});
