/**
 * Acceso directo a Postgres desde los e2e. Owner: `qa-agent`.
 *
 * Se usa para **dos** cosas y nada más:
 *   1. **Fixtures**: sembrar tenants que el test necesita ya existiendo (host resolution).
 *   2. **Limpieza**: borrar lo que el test creó, para que la base local no se llene de basura y
 *      para que dos corridas seguidas no se pisen.
 *
 * Lo que acá **no** se hace: crear el tenant del test de invalidación de cache. Ése tiene que
 * pasar por el panel de verdad, porque justamente lo que se está probando es que el alta real
 * invalide el 404 cacheado. Un `insert` directo salteando la Server Action probaría lo contrario
 * de lo que hace falta probar.
 */

import postgres from 'postgres';

/** Mismo default que `packages/db/src/env.ts` (`scripts/pg-local.sh`). */
const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/istock_dev';

export const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });

/**
 * `E2E_KEEP_FIXTURES=1` deja los fixtures en la base al terminar. **No cambia lo que el test
 * afirma**: sólo apaga la limpieza, para poder inspeccionar a mano el estado exacto que produjo
 * un fallo (que es la diferencia entre "el alta no ocurrió" y "el alta ocurrió y el cache no se
 * enteró"). Apagado por default: una corrida normal no deja basura.
 */
const KEEP_FIXTURES = process.env['E2E_KEEP_FIXTURES'] === '1';

export interface SeedTenant {
  readonly slug: string;
  readonly name: string;
  readonly waPhone?: string;
  readonly status?: 'active' | 'suspended' | 'cancelled';
}

export async function seedTenant(tenant: SeedTenant): Promise<void> {
  await sql`
    insert into public.tenants (slug, name, wa_phone, plan, status)
    values (${tenant.slug}, ${tenant.name}, ${tenant.waPhone ?? '5492994123456'}, 'trial',
            ${tenant.status ?? 'active'}::tenant_status)
    on conflict (slug) do update set name = excluded.name, status = excluded.status
  `;
}

export async function tenantIdBySlug(slug: string): Promise<string | null> {
  const rows = await sql<{ id: string }[]>`select id from public.tenants where slug = ${slug} limit 1`;
  return rows[0]?.id ?? null;
}

/** Borra el tenant y todo lo que le cuelga. Orden: hijos primero, FK no perdona. */
export async function deleteTenantBySlug(slug: string): Promise<void> {
  if (KEEP_FIXTURES) return;
  const id = await tenantIdBySlug(slug);
  if (id === null) return;
  await sql`delete from public.memberships where tenant_id = ${id}::uuid`;
  await sql`delete from public.tenants where id = ${id}::uuid`;
}

/** `public.users` cuelga de `auth.users` con `on delete cascade`: se borra la raíz. */
export async function deleteUserByEmail(email: string): Promise<void> {
  if (KEEP_FIXTURES) return;
  await sql`delete from auth.users where email = ${email}`;
}

/**
 * Barrido de restos de corridas anteriores (una corrida abortada deja el tenant creado).
 * Sólo toca el prefijo de los fixtures: nunca datos de nadie más.
 */
export async function purgeE2eFixtures(prefix: string): Promise<void> {
  if (KEEP_FIXTURES) return;
  const pattern = `${prefix}%`;
  await sql`
    delete from public.memberships
     where tenant_id in (select id from public.tenants where slug like ${pattern})
  `;
  await sql`delete from public.tenants where slug like ${pattern}`;
  await sql`delete from auth.users where email like ${pattern}`;
}

export async function closeDb(): Promise<void> {
  await sql.end({ timeout: 5 });
}
