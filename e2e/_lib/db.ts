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
 * invalide el **miss cacheado** de su propio slug (la página de "dirección sin vidriera"; bajo
 * ADR-011 es 200, no 404, y se cachea igual con el perfil corto de ADR-012). Un `insert` directo
 * salteando la Server Action probaría lo contrario de lo que hace falta probar.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  HIGH-3 · el ciclo de vida del pool es de la SUITE, no de cada spec
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * La versión anterior abría el pool **a nivel de módulo** y cada spec lo cerraba en su
 * `test.afterAll`. Con `workers: 1` los specs comparten proceso y por lo tanto comparten el
 * módulo: el primero en orden alfabético cerraba el pool y **todos los que venían después morían
 * con `CONNECTION_ENDED`** antes de correr una sola aserción. Los tests de aislamiento entre
 * tenants —los únicos que prueban que el reseller A no lee el stock de B— nunca se ejecutaron.
 *
 * Peor que fallar: la suite reportaba sobre tests que no habían corrido.
 *
 * Se arregla en dos capas, a propósito:
 *
 * 1. **El pool es perezoso y se re-crea solo** (este archivo). `closeDb()` no deja un objeto
 *    muerto: deja `null`, y la próxima consulta abre una conexión nueva. Con esto, el orden de
 *    los specs deja de poder romper nada — ni siquiera si alguien vuelve a llamar `closeDb()` a
 *    mano en un `afterAll`.
 * 2. **El cierre lo hace el worker, una vez, al final** (`_lib/fixtures.ts`). Un fixture con
 *    `scope: 'worker'` y `auto: true` es el único lugar de la suite que llama `closeDb()`.
 *
 * La capa 1 sola alcanzaría para que la suite corra entera; existe igual porque es la que hace
 * que el bug **no pueda volver** por la puerta por la que entró. La capa 2 es la que evita que el
 * proceso quede con un socket abierto al terminar.
 */

import postgres from 'postgres';
import type { Sql } from 'postgres';

/** Mismo default que `packages/db/src/env.ts` (`scripts/pg-local.sh`). */
const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/istock_dev';

let pool: Sql | null = null;

/**
 * El pool de la suite. Perezoso: no se abre por importar el módulo, sino en la primera consulta.
 *
 * Que sea perezoso **no** es un detalle de performance. Es lo que hace que `closeDb()` sea
 * reversible: cerrar es "soltar la conexión", no "romper el módulo para el resto del proceso".
 */
function sql(): Sql {
  pool ??= postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
  return pool;
}

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
  const q = sql();
  await q`
    insert into public.tenants (slug, name, wa_phone, plan, status)
    values (${tenant.slug}, ${tenant.name}, ${tenant.waPhone ?? '5492994123456'}, 'trial',
            ${tenant.status ?? 'active'}::tenant_status)
    on conflict (slug) do update set name = excluded.name, status = excluded.status
  `;
}

export async function tenantIdBySlug(slug: string): Promise<string | null> {
  const q = sql();
  const rows = await q<{ id: string }[]>`select id from public.tenants where slug = ${slug} limit 1`;
  return rows[0]?.id ?? null;
}

/** Borra el tenant y todo lo que le cuelga. Orden: hijos primero, FK no perdona. */
export async function deleteTenantBySlug(slug: string): Promise<void> {
  if (KEEP_FIXTURES) return;
  const id = await tenantIdBySlug(slug);
  if (id === null) return;
  const q = sql();
  await q`delete from public.memberships where tenant_id = ${id}::uuid`;
  await q`delete from public.tenants where id = ${id}::uuid`;
}

/** `public.users` cuelga de `auth.users` con `on delete cascade`: se borra la raíz. */
export async function deleteUserByEmail(email: string): Promise<void> {
  if (KEEP_FIXTURES) return;
  const q = sql();
  await q`delete from auth.users where email = ${email}`;
}

/**
 * Barrido de restos de corridas anteriores (una corrida abortada deja el tenant creado).
 * Sólo toca el prefijo de los fixtures: nunca datos de nadie más.
 */
export async function purgeE2eFixtures(prefix: string): Promise<void> {
  if (KEEP_FIXTURES) return;
  const pattern = `${prefix}%`;
  const q = sql();
  await q`
    delete from public.memberships
     where tenant_id in (select id from public.tenants where slug like ${pattern})
  `;
  await q`delete from public.tenants where slug like ${pattern}`;
  await q`delete from auth.users where email like ${pattern}`;
}

/**
 * Suelta la conexión. **Lo llama el fixture de worker de `_lib/fixtures.ts` y nadie más.**
 *
 * Idempotente y reversible: si un spec lo llamara igual, la próxima consulta abre un pool nuevo
 * en vez de tirar `CONNECTION_ENDED`. Ésa es toda la diferencia entre "la suite corre entera" y
 * "la suite reporta verde sobre tests que no corrieron".
 */
export async function closeDb(): Promise<void> {
  const open = pool;
  pool = null;
  if (open === null) return;
  await open.end({ timeout: 5 });
}
