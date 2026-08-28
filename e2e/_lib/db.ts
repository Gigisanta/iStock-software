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

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  S2 · el mapeo `listing → keys`, leído de la base para **obtener** las keys, no para creerles.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Con el esquema de key opaca de ADR-006, la URL de `card` **no se puede derivar** de la de
 * `thumb`: no hay sufijo de variante ni nada que adivinar, y ésa es la feature. El único lugar
 * donde vive la correspondencia es `listing_photos`. Entonces el test la **obtiene** de ahí y
 * después mide el objeto por HTTP: la base dice *qué* pedir, la respuesta dice *cuánto pesa*.
 *
 * `master_key` se lee por la razón opuesta: para probar que con esa key en la mano —o sea con más
 * información de la que tiene cualquier atacante— el master sigue sin ser alcanzable desde la web.
 */
export interface ListingPhotoKeysRow {
  readonly id: string;
  readonly tenantId: string;
  readonly listingId: string;
  readonly thumbKey: string;
  readonly cardKey: string;
  readonly detailKey: string;
  readonly masterKey: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly cardBytes: number | null;
}

export async function listingPhotoRows(listingId: string): Promise<readonly ListingPhotoKeysRow[]> {
  const q = sql();
  return q<ListingPhotoKeysRow[]>`
    select id, tenant_id as "tenantId", listing_id as "listingId",
           thumb_key as "thumbKey", card_key as "cardKey", detail_key as "detailKey",
           master_key as "masterKey", width, height, card_bytes as "cardBytes"
      from public.listing_photos
     where listing_id = ${listingId}::uuid
     order by sort_order
  `;
}

export interface ListingRow {
  readonly id: string;
  readonly tenantId: string;
  readonly title: string;
  readonly imei: string | null;
  readonly status: string;
  /**
   * FK a la tabla **global** `catalog_models`. Se lee porque `checkPublishable()` deniega
   * `missing_catalog_model` para todo `kind: 'unit'`: si el alta no lo guarda, el equipo nunca se
   * puede publicar y la pantalla no lo dice de una forma que un e2e pueda distinguir de "faltan
   * fotos".
   */
  readonly catalogModelId: string | null;
}

const LISTING_COLUMNS = `
  id, tenant_id as "tenantId", title, imei, status::text as status,
  catalog_model_id as "catalogModelId"
`;

export async function listingsByTenant(tenantId: string): Promise<readonly ListingRow[]> {
  const q = sql();
  return q<ListingRow[]>`
    select ${q.unsafe(LISTING_COLUMNS)}
      from public.listings
     where tenant_id = ${tenantId}::uuid
     order by created_at
  `;
}

export async function listingById(listingId: string): Promise<ListingRow | null> {
  const q = sql();
  const rows = await q<ListingRow[]>`
    select ${q.unsafe(LISTING_COLUMNS)}
      from public.listings
     where id = ${listingId}::uuid
     limit 1
  `;
  return rows[0] ?? null;
}

/** Cuántas fotos tiene el equipo **según la base**, que es lo que la pantalla debería reflejar. */
export async function listingPhotoCount(listingId: string): Promise<number> {
  const q = sql();
  const rows = await q<{ n: string }[]>`
    select count(*)::text as n from public.listing_photos where listing_id = ${listingId}::uuid
  `;
  return Number(rows[0]?.n ?? '0');
}

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  `catalog_models` — la tabla GLOBAL, leída para cruzarla contra lo que ofrece el `<select>`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * No lleva `tenant_id` y no lleva RLS a propósito (`packages/db/src/schema/catalog.ts`): "iPhone
 * 14 Pro" es un hecho del mundo, no un dato del reseller. Los e2e la **leen y nunca la escriben**:
 * sembrar una fila global desde un test sería ensuciar el catálogo de los 100 tenants con basura
 * de prueba que la limpieza por prefijo (`qae2e-`) no sabe borrar. Si está vacía, el helper del
 * panel falla diciendo que hay que correr `pnpm db:seed`.
 */
export interface CatalogModelRow {
  readonly id: string;
  readonly slug: string;
  readonly displayName: string;
  readonly isActive: boolean;
}

export async function catalogModelRows(): Promise<readonly CatalogModelRow[]> {
  const q = sql();
  return q<CatalogModelRow[]>`
    select id, slug, display_name as "displayName", is_active as "isActive"
      from public.catalog_models
     order by display_name
  `;
}

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  El equipo del OTRO negocio. Se siembra a mano, y acá sí corresponde.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * La regla de este archivo es que nada que esté **bajo prueba** se crea por SQL: el alta tiene que
 * pasar por el panel o el test probaría un `insert`. El equipo del tenant B no está bajo prueba:
 * es el objetivo del ataque. Lo único que el test necesita de él es que **exista y sea de otro
 * dueño**; cómo nació no cambia ni una aserción, y hacerlo por el panel costaría un login y un
 * negocio enteros para producir un UUID.
 *
 * Sin fotos a propósito: la pantalla de fotos de un equipo ajeno tiene que dar 404 **antes** de
 * poder contar nada, así que un equipo vacío es el caso más exigente.
 */
export interface SeedListing {
  readonly tenantId: string;
  readonly slug: string;
  readonly title: string;
  /** Enum `listing_condition`. */
  readonly condition?: string;
  /** Dólares enteros; la columna es `numeric(12,2)`. */
  readonly priceUsd?: number;
}

export async function seedListing(listing: SeedListing): Promise<string> {
  const q = sql();
  const rows = await q<{ id: string }[]>`
    insert into public.listings (tenant_id, slug, kind, title, condition, price_usd, qty, status)
    values (${listing.tenantId}::uuid, ${listing.slug}, 'unit', ${listing.title},
            ${listing.condition ?? 'used_excellent'}::listing_condition,
            ${listing.priceUsd ?? 700}, 1, 'draft')
    returning id
  `;
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`no se pudo sembrar el listing ${listing.slug}`);
  return id;
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
