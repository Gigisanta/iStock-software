// `server-only` hace **fallar el build** si este módulo termina importado desde un Client
// Component. Es lo que impide que el read model de la vidriera viaje al browser.
import 'server-only';

import { cacheLife, cacheTag } from 'next/cache';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { catalogModels, fxSettings, listingPhotos, listings, locations, tenants } from '@istock/db';
import { renderableVariantUrls, reportMediaIncident } from '@istock/media';
import {
  PUBLIC_STATUSES,
  fxRateFromArsCents,
  isListingSlugShaped,
  isPubliclyVisible,
  publicListingDTO,
  type Condition,
  type FxRoundingMode,
  type ListingStatus,
  type PublicListingDTO,
  type PublicListingSource,
} from '@istock/domain';
import { withStorefrontDb, type StorefrontTx } from './storefront-db';
import { isReservedSubdomain, isSlugShaped } from './host';
import { listingTag, storefrontTag, tenantConfigTag } from './cache-tags';
import { resolveModelName } from './model-name';
import { STOREFRONT_MISS_LIFE, cacheStorefrontMiss } from './cache-life';

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Read model de la vidriera. **`publicListingDTO` es el único camino de datos a la vista.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Ninguna función de este archivo devuelve una fila de Postgres. Devuelven `PublicListingDTO`, o
 * `null`. Eso no es prolijidad: es la diferencia entre un filtro y una allowlist.
 *
 * Un componente que recibe la fila y "no imprime el costo" está a un `JSON.stringify`, un
 * `data-*`, un `console.log` o un `{...row}` de publicarlo — y bajo RSC el objeto puede terminar
 * en el payload de Flight al final del `<body>` **sin aparecer en pantalla**, que es el modo de
 * falla que ningún code review encuentra mirando el JSX. Por eso el borde está acá abajo y no en
 * la vista: lo que sale de este módulo ya no tiene los campos prohibidos, así que no hay nada que
 * recordar más arriba.
 *
 * La descripción del dueño es **input no confiable** y se sanitiza dentro de `publicListingDTO`
 * (`sanitizeDescription` de `@istock/domain`). No se sanitiza acá otra vez: dos saneadores en dos
 * capas es la receta para que uno de los dos se afloje "porque el otro ya lo hace".
 *
 * ── Tres capas de aislamiento, y las tres se evalúan ──────────────────────────────────────────
 * 1. **GRANT de columna** (migración 0002): `anon` no tiene `SELECT` de tabla sobre `listings`,
 *    tiene `SELECT (slug, title, price_usd, …)`. Un `select *` no filtra de más: **no corre**
 *    (`42501`). Es la capa que sigue en pie el día que este archivo tenga un bug.
 * 2. **RLS**: las policies `*_storefront_anon_select` acotan a `storefront_tenant_id()`, y la de
 *    `listings` además exige `status in ('available','reserved','sold') and published_at is not
 *    null`. Un borrador no existe para el visitante.
 * 3. **`where` explícito** por `tenant_id` en cada query de acá, además de RLS (`CLAUDE.md` §5).
 *    Si mañana alguien afloja una policy, la query sigue acotada; si alguien borra el `where`, la
 *    policy sigue acotando.
 *
 * ── Presupuesto ───────────────────────────────────────────────────────────────────────────────
 * **Una transacción por render cacheado**, no una por dato. La ficha lee tenant + TC + puntos de
 * retiro + equipo + fotos + modelo dentro del mismo `withStorefrontDb`: son seis roundtrips contra
 * uno en el 5% de requests que fallan el cache, y el otro 95% no ejecuta nada de este archivo.
 * `cacheLife('max')` en el camino positivo; invalidación **por evento** desde el panel.
 */

/**
 * Techo de fichas por página de grilla.
 *
 * No es paginación (todavía no hace falta: el ICP tiene 20–200 equipos y la grilla entra), es un
 * **techo de tags**: la ficha registra `listing:{uuid}` y Vercel descarta en silencio los tags que
 * pasan de **128 por respuesta** (`CACHE_TAG_LIMITS.maxTagsPerResponse`). Un tag descartado no
 * invalida nada y no rompe nada — la peor falla posible. La grilla no registra tags por unidad
 * justamente por eso, y este techo es la segunda razón por la que no puede empezar a hacerlo.
 */
export const STOREFRONT_PAGE_SIZE = 60;

/**
 * Lo que la grilla necesita saber, y una cosa más que parece de más y no lo es.
 *
 * `publishedCount` distingue **"este negocio todavía no publicó nada"** de **"publicó y todavía
 * no tiene una cotización sincronizada"**. Sin ese número las dos se ven igual —grilla vacía— y el dueño que
 * cargó 15 equipos una tarde ve exactamente la misma pantalla que el que no cargó ninguno. Es el
 * peor momento posible para ser ambiguo: es la tarde en la que decide si el producto sirve.
 */
export interface StorefrontCatalog {
  /** Fichas publicables, ya como DTO. */
  readonly listings: readonly PublicListingDTO[];
  /** Unidades públicas que existen en la base, tengan o no precio en pesos calculable. */
  readonly publishedCount: number;
}

/** Contexto del tenant que comparten la grilla y la ficha. Nunca sale de este módulo. */
interface TenantContext {
  readonly id: string;
  readonly slug: string;
  readonly waPhone: string;
  readonly paymentMethods: readonly string[];
  readonly acceptsTradeIn: boolean;
}

/**
 * El tenant activo del slug, **con el teléfono**. Es un `select` distinto del de
 * `_lib/tenant.ts` a propósito: aquel alimenta el encabezado y no trae `wa_phone`; éste arma el
 * `wa.me` y no se usa para pintar nada. Que el teléfono viaje sólo por el camino que lo necesita
 * es lo que hace que "no publicamos el teléfono suelto" sea verdad por construcción.
 */
async function tenantContext(tx: StorefrontTx, slug: string): Promise<TenantContext | null> {
  const rows = await tx
    .select({
      id: tenants.id,
      slug: tenants.slug,
      waPhone: tenants.waPhone,
      paymentMethods: tenants.paymentMethods,
      acceptsTradeIn: tenants.acceptsTradeIn,
    })
    .from(tenants)
    .where(and(eq(tenants.slug, slug), eq(tenants.status, 'active')))
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    slug: row.slug,
    waPhone: row.waPhone,
    paymentMethods: row.paymentMethods,
    acceptsTradeIn: row.acceptsTradeIn,
  };
}

/**
 * El TC diario sincronizado para el tenant. **No hay API de dólar en el hot path.**
 *
 * Devuelve `null` si el tenant todavía no sincronizó ninguno, y ese `null` **no se rellena con un
 * default**. Publicar un precio en pesos calculado con un TC inventado por nosotros es peor que no
 * publicarlo: el ARS de la ficha sólo sale de la cotización automática validada.
 */
async function fxContext(tx: StorefrontTx, tenantId: string) {
  const rows = await tx
    .select({ arsPerUsd: fxSettings.arsPerUsd, rounding: fxSettings.rounding })
    .from(fxSettings)
    .where(eq(fxSettings.tenantId, tenantId))
    .limit(1);
  return rows[0] ?? null;
}

/** Puntos de retiro activos, en el orden que eligió el dueño. Uno de los 15 campos de la ficha. */
async function pickupContext(tx: StorefrontTx, tenantId: string) {
  return tx
    .select({ name: locations.name, address: locations.address, hours: locations.hours })
    .from(locations)
    .where(and(eq(locations.tenantId, tenantId), eq(locations.isActive, true)))
    .orderBy(asc(locations.sortOrder), asc(locations.name));
}

/**
 * Columnas de `listings` que la vidriera lee. Es **exactamente** el `GRANT` de columna de `anon`
 * menos las que el DTO no usa. Se escribe una sola vez y la comparten la grilla y la ficha: dos
 * listas de columnas es cómo se cuela una columna sensible en el `select` que nadie mira.
 */
const LISTING_COLUMNS = {
  id: listings.id,
  slug: listings.slug,
  title: listings.title,
  storageGb: listings.storageGb,
  color: listings.color,
  condition: listings.condition,
  batteryPct: listings.batteryPct,
  screenOriginal: listings.screenOriginal,
  icloudStatusText: listings.icloudStatusText,
  warrantyText: listings.warrantyText,
  provenanceText: listings.provenanceText,
  description: listings.description,
  priceUsdCents: listings.priceUsd,
  status: listings.status,
  modelDisplayName: catalogModels.displayName,
} as const;

/**
 * La forma de una fila del `select` de arriba, escrita a mano y **no** derivada de las columnas de
 * Drizzle. El `leftJoin` con `catalog_models` hace que `display_name` pueda venir `null` aunque la
 * columna sea `not null` —los accesorios no tienen modelo de catálogo—, y un tipo derivado de la
 * columna diría `string`. Ese es justo el `null` que hay que contemplar.
 */
interface ListingRow {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly storageGb: number | null;
  readonly color: string | null;
  readonly condition: Condition;
  readonly batteryPct: number | null;
  readonly screenOriginal: boolean | null;
  readonly icloudStatusText: string | null;
  readonly warrantyText: string | null;
  readonly provenanceText: string | null;
  readonly description: string | null;
  readonly priceUsdCents: number;
  readonly status: ListingStatus;
  readonly modelDisplayName: string | null;
}

/**
 * Orden de la grilla: **primero lo que se puede comprar hoy.**
 *
 * `sold` se sigue publicando (está en `PUBLIC_STATUSES` y es prueba social: "este negocio vende"),
 * pero abajo. Mostrar un vendido arriba de un disponible es gastar el scroll de alguien parado en
 * la calle en un equipo que no puede comprar.
 *
 * Se ordena en SQL y no en TS porque el `limit` corta **después** del `order by`: con el orden en
 * memoria, el equipo 61 disponible se perdería detrás de 60 vendidos.
 */
const STATUS_ORDER = sql`case ${listings.status} when 'available' then 0 when 'reserved' then 1 else 2 end`;

/** Fotos de un conjunto de fichas, agrupadas por listing y en el orden que eligió el dueño. */
async function photosByListing(
  tx: StorefrontTx,
  tenantId: string,
  listingIds: readonly string[],
): Promise<Map<string, Array<{ cardUrl: string; detailUrl: string; alt: string | null }>>> {
  const grouped = new Map<string, Array<{ cardUrl: string; detailUrl: string; alt: string | null }>>();
  if (listingIds.length === 0) return grouped;

  const rows = await tx
    .select({
      listingId: listingPhotos.listingId,
      alt: listingPhotos.alt,
      thumbKey: listingPhotos.thumbKey,
      cardKey: listingPhotos.cardKey,
      detailKey: listingPhotos.detailKey,
    })
    .from(listingPhotos)
    .where(
      and(
        eq(listingPhotos.tenantId, tenantId),
        inArray(listingPhotos.listingId, [...listingIds]),
      ),
    )
    .orderBy(asc(listingPhotos.listingId), asc(listingPhotos.sortOrder));

  for (const row of rows) {
    // Las URLs las arma `@istock/media`, nunca este archivo: la key es content-addressed y el
    // bucket, el CDN y el prefijo no son asunto de la vidriera (`CLAUDE.md` §2, ADR-006).
    //
    // `renderableVariantUrls` y no `variantUrl`: la diferencia es **omitir** contra **degradar**.
    // `variantUrl` ya no tira —eso está bien y es lo que evita que una fila rota cuelgue el stream
    // de un render cacheado—, pero devuelve `UNRENDERABLE_VARIANT_URL` (`about:invalid`), y meter
    // eso en la lista produce una ficha con un `<img>` que falla al cargar y muestra el `alt`. Un
    // hueco de imagen rota en la ficha le dice al comprador "este negocio no cuida lo que muestra",
    // que es exactamente lo contrario de para qué existe la vidriera. La foto que no se puede
    // servir **no se lista**.
    //
    // Es todo-o-nada por foto, y lo decide `packages/media`: las tres keys salen del mismo
    // `uploadListingPhoto`, así que una sola rota no es "falta un tamaño", es una fila que no se
    // puede creer — y publicar `card` sin `detail` dejaría a `_lib/photo.ts` armando una lista de
    // candidatos donde uno de los dos tamaños no carga.
    const urls = renderableVariantUrls(row);
    if (urls === null) {
      // La omisión **no es muda**. `renderableVariantUrls` ya reportó el incidente por variante
      // (código + motivo + prefijo de key + variante) por el canal de `@istock/media`; esto agrega
      // el hecho que ese incidente no contiene y que es el que importa acá: **una foto menos en
      // una página pública**, que es lo que ve el comprador y lo que nadie va a reportar por
      // soporte. Sin esta línea, el modo de falla es una ficha que va perdiendo fotos de a una sin
      // que nada se ponga rojo.
      //
      // `keyPrefix: ''` es deliberado y no una omisión: la key es content-addressed y desde ella se
      // llega al master del bucket privado, así que este archivo no la toca ni la recorta — el
      // único que decide cuánta key se puede ver es `packages/media`, y ya la emitió él.
      reportMediaIncident({
        code: 'MEDIA_UNSAFE_KEY',
        reason: 'foto omitida de la vidriera: la fila de listing_photos no es servible',
        keyPrefix: '',
        variant: null,
      });
      continue;
    }

    const list = grouped.get(row.listingId) ?? [];
    list.push({ cardUrl: urls.card, detailUrl: urls.detail, alt: row.alt });
    grouped.set(row.listingId, list);
  }
  return grouped;
}

/**
 * `publicListingDTO()` recibe `PublicListingSource & Record<string, unknown>` a propósito: la firma
 * está escrita para que un caller pueda pasarle **la fila entera de la base** sin pelear con el
 * compilador... y que el DTO igual no la deje pasar, porque la allowlist es de runtime. Una
 * `interface` de TS no es asignable a `Record<string, unknown>` (no tiene index signature
 * implícita), así que el tipo se declara acá, en el borde, y no se toca `@istock/domain`.
 *
 * Que esta vidriera pase un objeto **más chico** que la fila es defensa en profundidad, no
 * redundancia: si mañana la allowlist del DTO tuviera un agujero, acá no hay un `imei` en scope
 * para que se escape por él.
 */
type ListingSource = PublicListingSource & Record<string, unknown>;

/** Fila + contexto → `PublicListingSource`. El único lugar donde se arma la entrada del DTO. */
function toSource(
  row: ListingRow,
  tenant: TenantContext,
  fx: { readonly arsPerUsd: number; readonly rounding: FxRoundingMode },
  pickupPoints: readonly { readonly name: string; readonly address: string; readonly hours: string }[],
  photos: readonly { readonly cardUrl: string; readonly detailUrl: string; readonly alt: string | null }[],
): ListingSource {
  return {
    id: row.id,
    slug: row.slug,
    tenantSlug: tenant.slug,
    tenantWaPhone: tenant.waPhone,
    title: row.title,
    // `nameSource` + `modelDisplayName`, los dos de la misma decisión y en el mismo objeto.
    //
    // Los accesorios no tienen `catalog_model`, y tampoco lo tiene el equipo cargado sin elegir
    // modelo ni ninguno de los que quedan huérfanos por el `on delete set null`. El título es el
    // nombre de display de todos esos: "vi el Cargador 20W USB-C" se entiende; "vi el null" no.
    // Lo que **no** se puede es pasarlo como si viniera del catálogo: el título del dueño ya suele
    // traer storage y color adentro, y `describeListing` se los appendearía otra vez. Ese era el
    // `iPhone 14 Pro 256 Grafito 256 Grafito` que midió W5. Ver `./model-name.ts`.
    ...resolveModelName(row),
    storageGb: row.storageGb,
    color: row.color,
    condition: row.condition,
    batteryPct: row.batteryPct,
    screenOriginal: row.screenOriginal,
    icloudStatusText: row.icloudStatusText,
    warrantyText: row.warrantyText,
    provenanceText: row.provenanceText,
    description: row.description,
    priceUsdCents: row.priceUsdCents,
    fxRate: fxRateFromArsCents(fx.arsPerUsd),
    fxRounding: fx.rounding,
    status: row.status,
    photos,
    pickupPoints,
    paymentMethods: tenant.paymentMethods,
    acceptsTradeIn: tenant.acceptsTradeIn,
  };
}

/**
 * ── Grilla ────────────────────────────────────────────────────────────────────────────────────
 *
 * Cachea con `storefront:{slug}` + `tenant-config:{slug}`, los dos tags que el panel ya invalida
 * (`(app)/_lib/tenants/storefront-cache.ts`). **No** registra un tag por unidad: 200 equipos serían
 * 200 tags y el techo por respuesta es 128 — los de más se descartan **en silencio**.
 *
 * El slug se valida antes de tocar `cacheTag()`: `storefrontTag()` **tira** con un slug basura, y
 * bajo `cacheComponents` + PPR un throw de render no es un 500 sino un stream que no cierra con el
 * `200` ya emitido. Un input inválido se contesta, no se lanza.
 */
export async function getStorefrontCatalog(slug: string): Promise<StorefrontCatalog> {
  'use cache';

  const empty: StorefrontCatalog = { listings: [], publishedCount: 0 };

  if (!isSlugShaped(slug)) {
    cacheLife(STOREFRONT_MISS_LIFE);
    return empty;
  }

  cacheTag(storefrontTag(slug), tenantConfigTag(slug));

  // `www`, `app`, `api`, … no son tenants y no se preguntan. Es también lo que permite que
  // `generateStaticParams` prerenderice el slug semilla **sin abrir una conexión a Postgres**.
  if (isReservedSubdomain(slug)) {
    cacheLife(STOREFRONT_MISS_LIFE);
    return empty;
  }

  const catalog = await withStorefrontDb(slug, async (tx) => {
    const tenant = await tenantContext(tx, slug);
    if (tenant === null) return null;

    const rows = await tx
      .select(LISTING_COLUMNS)
      .from(listings)
      .leftJoin(catalogModels, eq(listings.catalogModelId, catalogModels.id))
      .where(
        and(
          // Filtro de tenant EXPLÍCITO, además de RLS (CLAUDE.md §5).
          eq(listings.tenantId, tenant.id),
          // Y el filtro de estado explícito, además de la policy: `PUBLIC_STATUSES` es la misma
          // constante que espeja el trigger `listings_stamp_published_at` de la migración 0002.
          inArray(listings.status, [...PUBLIC_STATUSES]),
        ),
      )
      .orderBy(STATUS_ORDER, desc(listings.publishedAt), asc(listings.slug))
      .limit(STOREFRONT_PAGE_SIZE);

    const publishedCount = rows.length;

    const fx = await fxContext(tx, tenant.id);
    if (fx === null) return { rows: [], publishedCount };

    const pickupPoints = await pickupContext(tx, tenant.id);
    const photos = await photosByListing(tx, tenant.id, rows.map((row) => row.id));

    return {
      rows: rows.map((row) => toSource(row, tenant, fx, pickupPoints, photos.get(row.id) ?? [])),
      publishedCount,
    };
  });

  if (catalog === null) {
    cacheStorefrontMiss();
    return empty;
  }

  cacheLife('max');

  return {
    // `isPubliclyVisible` es redundante con la policy y con el `inArray` de arriba, y se queda:
    // `publicListingDTO` **tira** con un estado no público, y un throw acá sería un stream que no
    // cierra por una fila mal grabada. La tercera capa es la que convierte ese throw en un equipo
    // que no se muestra.
    listings: catalog.rows.filter((row) => isPubliclyVisible(row.status)).map(publicListingDTO),
    publishedCount: catalog.publishedCount,
  };
}

/**
 * ── Ficha ─────────────────────────────────────────────────────────────────────────────────────
 *
 * `null` = **el miss de la ficha**, que la página devuelve como render normal
 * (`_components/listing-miss.tsx`), no como `notFound()`. Este docblock decía lo contrario —"`null`
 * = 404 de verdad", porque acá el shell del tenant ya resolvió— y el LEAD lo midió el 2026-08-28:
 * la ficha inexistente salía `200` con **0 chars de texto visible** en la primera request y 404
 * recién en la segunda. Mismo patológico de ADR-011, un nivel más abajo. Lo que cambia para este
 * módulo es sólo cómo se llama la respuesta: sigue devolviendo `null` y sigue cacheándolo corto.
 *
 * El `null` se cachea con el perfil corto: un bot que pruebe mil slugs de ficha inventados hace
 * mil queries la primera vez y **cero** después, sin sembrar entradas de 30 días.
 *
 * ── El hit y el miss llevan tags DISTINTOS, y ahí está la plata de esta slice ─────────────────
 *
 * | camino | tags de esta entrada | quién la mata |
 * |---|---|---|
 * | ficha publicada | `tenant-config:{slug}` · `listing:{uuid}` | config del tenant · esa unidad |
 * | miss (`null`)   | `tenant-config:{slug}` · `storefront:{slug}` | config del tenant · **publicar cualquier cosa** |
 *
 * **El hit ya no registra `storefront:{slug}`.** Un tag es un OR: la entrada muere si se purga
 * *cualquiera* de los suyos. Desde S6 el panel emite tres tags en `invalidateStorefrontUnit()`
 * (`storefront` + `tenant-config` + `listing:{uuid}`), así que mientras la ficha siguiera
 * registrando el tag del catálogo, **reservar UNA unidad en un tenant de 60 equipos purgaba las 61
 * páginas** — la que cambió y las 60 que no. Lo midió `cost-auditor` en S6: cold-hit ~39% contra
 * una alarma de 5% (`docs/COST.md` §2.4). Este docblock decía hasta S6.1 que el panel *"sólo emite
 * los dos del tenant, así que este tag todavía no invalida solo"*: era verdad cuando se escribió y
 * dejó de serlo con S6. El motivo por el que `listing:{uuid}` existía ya se cumplió, y por eso el
 * tag del catálogo pasó de redundante a caro.
 *
 * **`tenant-config:{slug}` se queda, y no por simetría:** el TC, los puntos de retiro, los medios de
 * pago y el teléfono salen en la ficha, así que un cambio de config del tenant *tiene* que purgarla.
 * Es también lo que mantiene en pie al alta del tenant, que emite `storefront` + `tenant-config`.
 *
 * **El miss sí lo lleva, y sacárselo sería un bug distinto y peor.** `listing:{uuid}` se registra
 * *después* del `await` y sólo cuando la unidad es públicamente visible, así que una ficha cacheada
 * como miss —el equipo todavía en `draft`, el link ya circulando— no quedaría bajo **ningún** tag
 * que el panel emita al publicarla, y publicarla dejaría *"este equipo ya no está publicado"*
 * servido hasta 15 minutos (`MISS_EXPIRE_SECONDS`). Por eso las dos ramas negativas de acá abajo
 * pasan por `listingMiss()`, que registra el tag y el perfil corto juntos: son dos mitades de la
 * misma decisión y separarlas es cómo se pierde una.
 *
 * Las dos ramas **anteriores** al `cacheTag()` —slug sin forma de slug— no registran nada y así se
 * quedan: un slug que no pasa `isSlugShaped` no puede entrar en `tenants` (CHECK
 * `tenants_slug_format`), así que no hay publicación futura que lo vuelva válido y no hay evento que
 * invalidar. Además `storefrontTag()` tiraría, y un throw de render bajo `cacheComponents` + PPR es
 * un stream que no cierra, no un 500.
 *
 * Todo lo de arriba describe **la entrada de cache de este loader**. La página
 * (`s/[slug]/p/[listing]/page.tsx`) tiene la suya y registra sus propios tags; los de acá se
 * propagan hacia afuera (el wrapper de `'use cache'` copia tags y cache life al scope que lo
 * contiene), pero no al revés: lo que registre la página no se resta desde acá.
 */
export async function getStorefrontListing(
  slug: string,
  listingSlug: string,
): Promise<PublicListingDTO | null> {
  'use cache';

  // Dos familias distintas de slug, y por eso dos validadores: `isSlugShaped` es el del **tenant**
  // (label DNS, techo 32) e `isListingSlugShaped` el de la **ficha** (segmento de path, techo 64).
  // Los dos los declara `@istock/domain` (`slug.ts`), que es donde está escrito por qué la fila 207
  // del seed se caería con el primero y por qué el segundo no tira. Acá sólo se consumen.
  if (!isSlugShaped(slug) || !isListingSlugShaped(listingSlug)) {
    cacheLife(STOREFRONT_MISS_LIFE);
    return null;
  }

  // Sólo el de config. El del catálogo (`storefront:{slug}`) es del camino negativo y lo pone
  // `listingMiss()`; el de la unidad se registra abajo, cuando se conoce el UUID.
  cacheTag(tenantConfigTag(slug));

  if (isReservedSubdomain(slug)) {
    return listingMiss(slug);
  }

  const source = await withStorefrontDb(slug, async (tx) => {
    const tenant = await tenantContext(tx, slug);
    if (tenant === null) return null;

    const rows = await tx
      .select(LISTING_COLUMNS)
      .from(listings)
      .leftJoin(catalogModels, eq(listings.catalogModelId, catalogModels.id))
      .where(
        and(
          eq(listings.tenantId, tenant.id),
          eq(listings.slug, listingSlug),
          inArray(listings.status, [...PUBLIC_STATUSES]),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (row === undefined) return null;

    const fx = await fxContext(tx, tenant.id);
    // Sin TC no hay ARS, y el ARS es uno de los 15 campos obligatorios de la ficha. Antes que
    // publicar una ficha incompleta —o peor, un precio en pesos inventado por nosotros— la ficha
    // no existe todavía. La grilla tampoco la linkea: las dos leen el mismo `fx_settings`.
    if (fx === null) return null;

    const pickupPoints = await pickupContext(tx, tenant.id);
    const photos = await photosByListing(tx, tenant.id, [row.id]);

    return toSource(row, tenant, fx, pickupPoints, photos.get(row.id) ?? []);
  });

  if (source === null || !isPubliclyVisible(source.status)) {
    return listingMiss(slug);
  }

  cacheTag(listingTag(source.id));
  cacheLife('max');

  return publicListingDTO(source);
}

/**
 * El miss de la ficha: **el tag del catálogo y el perfil corto, en una sola llamada.**
 *
 * Están juntos porque son la misma decisión mirada de dos lados. Una entrada negativa necesita las
 * dos cosas: expirar sola en minutos (contra el envenenamiento con slugs inventados, ADR-012) y
 * quedar registrada bajo un tag que el panel emita cuando esa unidad se publique. `listing:{uuid}`
 * no sirve para lo segundo —no hay UUID que registrar cuando no hay unidad visible—, así que el
 * único que queda es `storefront:{slug}`, que es justo el que el camino positivo dejó de llevar.
 *
 * Es una función y no dos líneas repetidas para que una tercera rama negativa futura no pueda nacer
 * con la mitad: el modo de falla de olvidarse el tag acá es una ficha que se queda mostrando "este
 * equipo ya no está publicado" hasta 15 minutos después de publicarlo, sin error y sin log.
 *
 * Devuelve `null` (y no `void`) para que el call site sea `return listingMiss(slug)`: así el tipo de
 * retorno de la función de arriba sigue siendo el que se lee, y no hay forma de llamar a esto y
 * seguir de largo.
 */
function listingMiss(slug: string): null {
  cacheTag(storefrontTag(slug));
  cacheStorefrontMiss();
  return null;
}
