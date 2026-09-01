/**
 * `drizzle-kit generate` es la **única** fuente de las migraciones base.
 * `drizzle-kit push` está prohibido como fuente de verdad (`db-agent` §3): no deja archivo,
 * no se revisa en un PR y no se puede replicar en Supabase.
 *
 * `schemaFilter: ['public']` — `neon_auth` y la capa de compatibilidad `auth` no forman parte del
 * schema de negocio que Drizzle genera.
 * `entities.roles.provider: 'supabase'` conserva la forma de las policies (`anon` /
 * `authenticated` / `service_role`); la migración inicial crea esos roles si el proveedor no los
 * trae, como ocurre en Neon.
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
    url:
      process.env['DATABASE_URL_UNPOOLED'] ??
      process.env['DATABASE_URL'] ??
      'postgresql://localhost:5432/istock_dev',
  },
});
