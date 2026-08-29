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

import { createHash } from 'node:crypto';
import postgres from 'postgres';
import type { Sql } from 'postgres';
import { assertPublicVariantKey } from '../../packages/media/src/keys';

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

/**
 * El slug público del equipo, que es la **única** forma de armar la URL que ve un desconocido:
 * `{tenant}.maat.work/p/{listingSlug}`. Lo genera el alta a partir del título (no lo elige el
 * test), así que hay que ir a buscarlo.
 *
 * Va aparte y no como una columna más de `LISTING_COLUMNS` a propósito: esa lista la consumen los
 * specs de S1/S2 para afirmar sobre el estado interno del equipo, y meterle el slug ahí mezclaría
 * dos cosas distintas —lo que el panel guarda y lo que la vidriera publica— en la misma fila.
 */
export async function listingSlugById(listingId: string): Promise<string | null> {
  const q = sql();
  const rows = await q<{ slug: string }[]>`
    select slug from public.listings where id = ${listingId}::uuid limit 1
  `;
  return rows[0]?.slug ?? null;
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

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  S3 · las PRECONDICIONES de la vidriera que todavía no tienen pantalla en el panel
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `fx_settings` y `locations` son dos de los 15 campos de la ficha y hoy **no se pueden cargar
 * desde el panel**: la pantalla de tipo de cambio es S5 y la de puntos de retiro también. Un
 * tenant creado por el camino real del dueño nace sin TC, y sin TC `getStorefrontCatalog()`
 * devuelve la grilla vacía a propósito (no le inventamos un dólar al reseller).
 *
 * O sea que sin estas dos filas no hay ni una foto en la grilla que medir, y el spec de bytes
 * fallaría por una razón que no tiene nada que ver con lo que afirma.
 *
 * Sembrarlas por SQL es correcto **porque no están bajo prueba**: son el decorado, no la escena.
 * La regla de este archivo —lo que el test afirma tiene que nacer por el camino real— se sigue
 * cumpliendo donde importa: el equipo, la foto y la publicación pasan por el panel.
 *
 * El día que S5 exista, esto se reemplaza por el journey de la pantalla de TC y este comentario
 * se borra. Mientras tanto queda escrito acá para que nadie lo lea como "los e2e siembran datos
 * bajo prueba".
 */
export async function seedFxSettings(
  tenantId: string,
  arsPerUsd = '1487.50',
  rounding = 'ceil_1000',
): Promise<void> {
  const q = sql();
  await q`
    insert into public.fx_settings (tenant_id, ars_per_usd, rounding)
    values (${tenantId}::uuid, ${arsPerUsd}::numeric, ${rounding}::fx_rounding_mode)
    on conflict (tenant_id)
      do update set ars_per_usd = excluded.ars_per_usd, rounding = excluded.rounding
  `;
}

export interface SeedLocation {
  readonly name?: string;
  readonly address?: string;
  readonly hours?: string;
}

/** Un punto de retiro activo. Campo obligatorio de la ficha; su pantalla también es S5. */
export async function seedLocation(tenantId: string, location: SeedLocation = {}): Promise<void> {
  const q = sql();
  await q`
    insert into public.locations (tenant_id, name, address, hours, city, is_active, sort_order)
    values (${tenantId}::uuid,
            ${location.name ?? 'Local QA centro'},
            ${location.address ?? 'Av. Argentina 200, Neuquén'},
            ${location.hours ?? 'lun a vie de 10 a 18'},
            'Neuquén', true, 0)
  `;
}

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Una unidad YA PUBLICADA, por SQL. Sólo para el spec que mide **queries**, nunca para el que
 *  mide bytes.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * La distinción es la de siempre y acá se ve clarísima:
 *
 * - El spec de **bytes** mide el objeto que produjo `packages/media`, así que la foto tiene que
 *   haber entrado por el `<input type="file">` del panel. Un `insert` de keys inventadas mediría
 *   un 404. Ese spec **no** usa esta función.
 * - El spec de **db-hits** mide cuántas sentencias le manda el server a Postgres al renderizar la
 *   ficha y cuántas le manda cuando la sirve desde el cache. Esa cuenta no cambia ni un dígito
 *   según cómo nació la fila: lo que se está auditando es el `'use cache'` de la vidriera. Pagar
 *   un journey de panel de un minuto (login + negocio + 3 subidas de 12 MP) para producir una
 *   fila que el propio spec no mira sería tiempo de corrida a cambio de nada.
 *
 * `status: 'available'` dispara el trigger `listings_stamp_published_at` (migración 0002), que es
 * lo que pone `published_at` — la policy de `anon` exige `published_at is not null` y no puede
 * depender de que el que inserta se acuerde. Que la fila nazca visible para `anon` **por el mismo
 * trigger que en producción** es justamente lo que hace que este atajo no cambie lo que se mide.
 *
 * Los campos peligrosos (`imei`, `cost_usd`, `supplier`, `internal_notes`) se siembran **a
 * propósito**: una ficha de fixture sin datos sensibles convierte cualquier chequeo de fuga en un
 * chequeo vacuo, y M4 de `scripts/accept-s3.sh` barre el HTML servido buscando exactamente esto.
 */
export interface SeedPublicUnit {
  readonly tenantId: string;
  readonly slug: string;
  readonly title: string;
  readonly priceUsd?: number;
  readonly imei?: string;
  readonly costUsd?: number;
}

export async function seedPublicUnit(unit: SeedPublicUnit): Promise<string> {
  const q = sql();
  const rows = await q<{ id: string }[]>`
    insert into public.listings (
      tenant_id, slug, kind, title, storage_gb, color, condition, battery_pct,
      screen_original, icloud_status_text, warranty_text, provenance_text,
      price_usd, cost_usd, supplier, internal_notes, imei, qty, status
    )
    values (
      ${unit.tenantId}::uuid, ${unit.slug}, 'unit', ${unit.title}, 256, 'Grafito',
      'used_excellent'::listing_condition, 89,
      true, 'Libre de iCloud, verificado en el local', '90 días de garantía del local',
      'Compra directa a cliente en Cipolletti',
      ${unit.priceUsd ?? 620}, ${unit.costUsd ?? 500}, 'Canje mostrador QA',
      'Entró por canje, revisar batería', ${unit.imei ?? null}, 1, 'available'
    )
    returning id
  `;
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`no se pudo sembrar la unidad pública ${unit.slug}`);
  return id;
}

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Un BORRADOR publicable, por SQL. El que se usa para medir el camino de MISS de la ficha.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Es el hermano de `seedPublicUnit` con dos diferencias que no son cosméticas:
 *
 * 1. Nace en `draft`, así que su ficha responde **el miss del equipo** (`ListingMiss`) y no la
 *    ficha. Ese miss es el que se cachea y el que publicar tiene que tirar abajo.
 * 2. Lleva **`catalog_model_id`**, y sin eso no serviría para nada: `checkTransition('draft',
 *    'available', …)` deniega con `missing_catalog_model` para `kind: 'unit'`, o sea que el panel
 *    **no dibuja el botón "Publicar"** (`canPublish` en `stock/_ui/unit-row.tsx`) y el escenario no
 *    se puede montar. `seedListing()` no lo pone porque su unidad no está para publicarse: es el
 *    objetivo de un ataque cross-tenant.
 *
 * Lo que está bajo prueba acá es **la invalidación**, no el alta: la unidad es el decorado. La
 * publicación sí pasa por el botón del panel, que es el camino real y el que puede perder el
 * `revalidateTag` en un refactor.
 */
export interface SeedDraftUnit {
  readonly tenantId: string;
  readonly slug: string;
  readonly title: string;
  /** `catalog_models.id`. Sin él la unidad es impublicable y el botón no existe. */
  readonly catalogModelId: string;
  readonly priceUsd?: number;
}

export async function seedDraftUnit(unit: SeedDraftUnit): Promise<string> {
  const q = sql();
  const rows = await q<{ id: string }[]>`
    insert into public.listings (
      tenant_id, slug, kind, title, catalog_model_id, storage_gb, color, condition, battery_pct,
      screen_original, icloud_status_text, warranty_text, provenance_text, price_usd, qty, status
    )
    values (
      ${unit.tenantId}::uuid, ${unit.slug}, 'unit', ${unit.title}, ${unit.catalogModelId}::uuid,
      128, 'Medianoche', 'used_excellent'::listing_condition, 91,
      true, 'Libre de iCloud, verificado en el local', '90 días de garantía del local',
      'Compra directa a cliente en Neuquén', ${unit.priceUsd ?? 540}, 1, 'draft'
    )
    returning id
  `;
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`no se pudo sembrar el borrador ${unit.slug}`);
  return id;
}

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  S9 · una unidad en el estado que el test necesite, y la que el trigger NO selló
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `seedPublicUnit()` siembra siempre `available`, y el spec de la lista para estados necesita las
 * cinco caras del mismo hecho —los tres estados públicos, un borrador y un lateral— para poder
 * afirmar *qué* entra en el texto que el dueño pega en un estado de Instagram. Sin las que **no**
 * entran, "sólo entran las públicas" es verde por vacío.
 *
 * ── El sello, que es donde estaban los dos agujeros ───────────────────────────────────────────
 * La policy `listings_storefront_anon_select` y la query de `/app/lista` filtran por **dos** cosas
 * a la vez: `status in (available, reserved, sold)` **y** `published_at is not null`. Con una
 * siembra ingenua las dos condiciones son redundantes —un borrador recién insertado tampoco tiene
 * sello— y entonces **cualquiera de las dos se puede borrar del código sin que un test se entere**.
 * Lo medí: con la primera versión de este helper, sacarle a la query el filtro por estado dejaba
 * los seis tests de la lista en verde. Por eso hay tres valores y no un booleano.
 *
 * - **`'trigger'`** (default) — no se menciona la columna y decide el trigger
 *   `listings_stamp_published_at` (migración 0002): estado público ⇒ sella, borrador ⇒ `null`.
 *   Es el camino normal del panel.
 *
 * - **`'kept'`** — la fila entra con `published_at` puesto **aunque el estado no sea público**.
 *   No es un truco: es el caso más común del producto. El trigger dice, con todas las letras,
 *   *"nunca lo borra: el histórico de publicación no se pierde porque una unidad haya vuelto a
 *   `unavailable`"*. O sea que **el equipo que el dueño publicó y después bajó de la vidriera
 *   queda con estado no público y sello puesto**, y la única cosa que lo mantiene fuera de la
 *   lista es el filtro por estado. Se produce con un `insert` normal porque el trigger sólo
 *   escribe cuando el estado es público.
 *
 * - **`'none'`** — la fila entra **sin** sello y en estado público, que es lo contrario: la única
 *   cosa que la mantiene afuera es el `isNotNull(publishedAt)`. Por el camino normal no se puede
 *   producir (el trigger sella al entrar), así que se planta con
 *   `set local session_replication_role = replica`, que apaga los triggers **de esa transacción y
 *   de ninguna otra** (`set local` muere en el commit): ninguna otra siembra de la suite pierde el
 *   sellado. Es el mismo patrón de control negativo con el que `tests/rls-cross-tenant.test.ts`
 *   planta sus ataques antes de afirmar nada. Y tampoco es de laboratorio: así queda la tabla
 *   después de un backfill, de una restauración parcial o de una réplica lógica.
 *
 * Con `'kept'` y `'none'` en el mismo fixture, las dos mitades del filtro tienen cada una una fila
 * que sólo ella excluye, y borrar cualquiera de las dos pone el spec en rojo.
 */
export type UnitStamp = 'trigger' | 'kept' | 'none';

export interface SeedUnitInState {
  readonly tenantId: string;
  readonly slug: string;
  readonly title: string;
  /** Enum `listing_status`. */
  readonly status: string;
  /** Qué pasa con `published_at`. Default `'trigger'`. Ver el docblock: no es cosmético. */
  readonly stamp?: UnitStamp;
  readonly priceUsd?: number;
}

export async function seedUnitInState(unit: SeedUnitInState): Promise<string> {
  const q = sql();
  const price = unit.priceUsd ?? 620;

  if (unit.stamp === 'kept') {
    // El trigger no toca la fila porque el estado no es público: el sello entra tal cual.
    const kept = await q<{ id: string }[]>`
      insert into public.listings (tenant_id, slug, kind, title, condition, price_usd, qty,
                                   status, published_at)
      values (${unit.tenantId}::uuid, ${unit.slug}, 'unit', ${unit.title},
              'used_excellent'::listing_condition, ${price}, 1,
              ${unit.status}::listing_status, now())
      returning id
    `;
    const id = kept[0]?.id;
    if (id === undefined) throw new Error(`no se pudo sembrar la unidad bajada ${unit.slug}`);
    return id;
  }

  if (unit.stamp === 'none') {
    const planted = await q.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      return tx<{ id: string }[]>`
        insert into public.listings (tenant_id, slug, kind, title, condition, price_usd, qty,
                                     status, published_at)
        values (${unit.tenantId}::uuid, ${unit.slug}, 'unit', ${unit.title},
                'used_excellent'::listing_condition, ${price}, 1,
                ${unit.status}::listing_status, null)
        returning id
      `;
    });
    const id = (planted as unknown as { id: string }[])[0]?.id;
    if (id === undefined) throw new Error(`no se pudo plantar la unidad sin sellar ${unit.slug}`);
    return id;
  }

  const rows = await q<{ id: string }[]>`
    insert into public.listings (tenant_id, slug, kind, title, condition, price_usd, qty, status)
    values (${unit.tenantId}::uuid, ${unit.slug}, 'unit', ${unit.title},
            'used_excellent'::listing_condition, ${price}, 1, ${unit.status}::listing_status)
    returning id
  `;
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`no se pudo sembrar la unidad ${unit.slug} (${unit.status})`);
  return id;
}

/**
 * `count` unidades publicadas, en **una** sentencia.
 *
 * Existe para el spec del techo de la lista, que necesita cruzar `STOCK_LIST_MAX_UNITS`: 101
 * inserts de a uno son 101 round-trips para producir decorado que el test no mira de a uno. Lo que
 * el test mira es el número que la pantalla dice, y para eso las filas sólo tienen que existir,
 * estar publicadas y ser del tenant.
 *
 * Los dos límites van casteados a `int` **a propósito**: `postgres.js` manda los parámetros sin
 * tipo, y `generate_series(unknown, unknown)` es ambiguo para Postgres (hay overloads de `int`,
 * `bigint`, `numeric` y `timestamp`), así que sin el cast la siembra muere con `function
 * generate_series(unknown, unknown) is not unique` y el spec acusa a la pantalla por un defecto
 * del arnés.
 *
 * `from` deja empezar la numeración donde terminó la siembra anterior: el spec siembra en dos
 * tandas a propósito (abajo del techo y arriba del techo) para medir las dos polaridades del aviso
 * sobre el mismo negocio.
 */
export async function seedManyPublicUnits(
  tenantId: string,
  count: number,
  from = 1,
): Promise<void> {
  if (count <= 0) return;
  const q = sql();
  await q`
    insert into public.listings (tenant_id, slug, kind, title, condition, price_usd, qty, status)
    select ${tenantId}::uuid, 'qa-masivo-' || i, 'unit', 'iPhone 12 64 Azul ' || i,
           'used_excellent'::listing_condition, 620, 1, 'available'
    from generate_series(${from}::int, ${from + count - 1}::int) as i
  `;
}

/** Estado y `published_at` de una unidad, para que un spec pueda probar que su fixture es el que dice. */
export async function listingStampRow(
  listingId: string,
): Promise<{ readonly status: string; readonly publishedAt: Date | null } | null> {
  const q = sql();
  const rows = await q<{ status: string; published_at: Date | null }[]>`
    select status, published_at from public.listings where id = ${listingId}::uuid limit 1
  `;
  const row = rows[0];
  if (row === undefined) return null;
  return { status: row.status, publishedAt: row.published_at };
}

/**
 * Una fila de `listing_photos` con keys **con la forma pública real** (`v1/{ab}/{sha256_32}.webp`)
 * pero **sin bytes detrás**.
 *
 * Es exactamente lo que el spec de db-hits necesita y nada más: ese spec pide la ficha con
 * `request.get()` —sin browser— así que no baja una sola subrecurso y la foto nunca se descarga.
 * Lo único que la fila tiene que hacer es existir, para que la ficha recorra el mismo camino de
 * queries que en producción (`photosByListing` es una de las seis).
 *
 * **No se usa donde se miden bytes.** Una key sin objeto detrás devuelve 404 y 404 pesa poco: un
 * spec de presupuesto que midiera esto daría verde midiendo la nada.
 */
export async function seedListingPhoto(
  tenantId: string,
  listingId: string,
  sortOrder = 0,
): Promise<void> {
  const q = sql();
  const digest = (tag: string): string =>
    createHash('sha256')
      .update(`qae2e/${listingId}/${String(sortOrder)}/${tag}`)
      .digest('hex')
      .slice(0, 32);
  /**
   * La key se arma con la MISMA forma que la del pipeline real (`v1/{ab}/{sha256_32}.webp`) y se
   * pasa por el gate del producto antes de tocar la base: este helper es el único lugar del repo
   * que inserta en `listing_photos` salteando el upload, o sea el único que puede plantar una key
   * que el producto nunca habría producido —y esa key no falla acá, cuelga el render de la ficha.
   */
  const key = (tag: string): string => {
    const hash = digest(tag);
    const candidate = `v1/${hash.slice(0, 2)}/${hash}.webp`;
    assertPublicVariantKey(candidate);
    return candidate;
  };

  await q`
    insert into public.listing_photos (
      tenant_id, listing_id, sort_order, alt, master_key, thumb_key, card_key, detail_key,
      width, height, card_bytes
    )
    values (${tenantId}::uuid, ${listingId}::uuid, ${sortOrder}, null,
            ${`originals/${tenantId}/${listingId}/${digest('master')}.webp`},
            ${key('thumb')}, ${key('card')}, ${key('detail')}, 1600, 1200, 50692)
  `;
}

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  S4 · `wa_click_events`, leído desde afuera de la app. Owner: `qa-agent`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Es la **única escritura sin autenticar del producto**, así que el spec que la audita no puede
 * preguntarle a la app cuántas filas escribió: tiene que contarlas en Postgres. Dos motivos, y
 * ninguno es de gusto:
 *
 * 1. **Un contador expuesto por el código bajo test lo mantiene el mismo writer que la
 *    optimización que audita** (mismo argumento que `_lib/pg-spy.ts`, `CLAUDE.md` §4). `qa-agent`
 *    no edita `apps/web/**`.
 * 2. La afirmación más cara de S4 es **negativa** —*"cargar la ficha no escribe NADA"*— y una
 *    afirmación negativa sobre filas sólo se puede sostener contando filas. Un 204 del handler no
 *    dice si hubo `insert`; un `insert` rechazado por RLS tampoco cambia el status.
 *
 * La conexión de los e2e es la de dueño de la base (`DATABASE_URL` real, sin pasar por el espía),
 * así que **ve todas las filas de todos los tenants**: es exactamente lo que hace falta para poder
 * afirmar que un POST cruzado no escribió en NINGUNO de los dos, y no sólo que no escribió en el
 * que el atacante nombró.
 *
 * **No se lee ni se devuelve una sola columna que pueda tener PII**, porque la tabla no tiene
 * ninguna y este helper no la va a inventar: `id`, `tenant_id`, `listing_id`, `source`.
 */
export interface WaClickEventRow {
  readonly id: string;
  readonly tenantId: string;
  /** `null` cuando el click salió del footer y no de una ficha. */
  readonly listingId: string | null;
  readonly source: string;
}

export async function waClickEventRows(tenantId: string): Promise<readonly WaClickEventRow[]> {
  const q = sql();
  return q<WaClickEventRow[]>`
    select id, tenant_id as "tenantId", listing_id as "listingId", source
      from public.wa_click_events
     where tenant_id = ${tenantId}::uuid
     order by created_at
  `;
}

/** Cuántos clicks tiene registrados un tenant. El número que va a la línea `MEDIDO s4 click`. */
export async function countWaClickEvents(tenantId: string): Promise<number> {
  return (await waClickEventRows(tenantId)).length;
}

/** Borra los clicks de un tenant. Lo llama el `afterAll` del spec de S4, no la limpieza general. */
export async function deleteWaClickEvents(tenantId: string): Promise<void> {
  if (KEEP_FIXTURES) return;
  const q = sql();
  await q`delete from public.wa_click_events where tenant_id = ${tenantId}::uuid`;
}

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Reservas · lo que la medición de S6 necesita leer y adelantar
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * La reserva **se crea desde el panel**, como la crea el dueño; acá sólo se *lee* (para afirmar
 * sobre el estado real, no sobre lo que la pantalla dice) y se *adelanta el vencimiento* (para no
 * tener que esperar 30 minutos de reloj).
 *
 * Adelantar `expires_at` es tocar el **fixture**, no la implementación: el barrido sigue
 * decidiendo solo, con su propio `now`, contra una fila que ya venció de verdad. La alternativa
 * —inyectarle un `now` falso al cron— probaría el barrido contra un reloj que en producción no
 * existe.
 */
export interface ReservationRow {
  readonly id: string;
  readonly tenantId: string;
  readonly listingId: string;
  readonly status: string;
  readonly minutes: number;
  readonly expiresAt: Date;
  readonly closedAt: Date | null;
}

const RESERVATION_COLUMNS = `
  id, tenant_id as "tenantId", listing_id as "listingId", status::text as status,
  minutes, expires_at as "expiresAt", closed_at as "closedAt"
`;

/** Todas las reservas de un equipo, en orden de creación. Incluye las cerradas: el test de S6
 *  afirma que la que venció quedó `expired` y no que desapareció. */
export async function reservationsByListing(listingId: string): Promise<readonly ReservationRow[]> {
  const q = sql();
  return q<ReservationRow[]>`
    select ${q.unsafe(RESERVATION_COLUMNS)}
      from public.reservations
     where listing_id = ${listingId}::uuid
     order by created_at
  `;
}

/** La reserva viva del equipo. `null` si no hay ninguna: es lo que el índice parcial garantiza. */
export async function activeReservation(listingId: string): Promise<ReservationRow | null> {
  const rows = await reservationsByListing(listingId);
  return rows.find((row) => row.status === 'active') ?? null;
}

/**
 * Manda el vencimiento de una reserva al pasado. Devuelve el `expires_at` que quedó escrito, para
 * que el spec afirme sobre lo que la base tiene y no sobre lo que pidió.
 *
 * No toca `status`: dejar la fila `active` y **vencida** es exactamente el estado que el barrido
 * tiene que encontrar. Ponerla en `expired` a mano sería escribirle el resultado al test.
 */
export async function backdateReservation(reservationId: string, secondsAgo = 60): Promise<Date> {
  const q = sql();
  const rows = await q<{ expiresAt: Date }[]>`
    update public.reservations
       set expires_at = now() - make_interval(secs => ${secondsAgo})
     where id = ${reservationId}::uuid
    returning expires_at as "expiresAt"
  `;
  const row = rows[0];
  if (row === undefined) throw new Error(`no existe la reserva ${reservationId}`);
  return row.expiresAt;
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
