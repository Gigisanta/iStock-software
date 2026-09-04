import type { Metadata } from 'next';
import { cacheLife, cacheTag } from 'next/cache';
import type { PublicListingDTO } from '@istock/domain';
import { STOREFRONT_DOMAIN } from '@istock/domain';
import { listingTag, storefrontTag, tenantConfigTag } from '../../../../_lib/cache-tags';
import { cacheStorefrontMiss } from '../../../../_lib/cache-life';
import { PRERENDER_SEED_SLUG, isSlugShaped } from '../../../../_lib/host';
import {
  PRERENDER_SEED_LISTING,
  STOREFRONT_HOME_PATH,
  TRADEIN_PATH,
} from '../../../../_lib/routes';
import { getStorefrontListing } from '../../../../_lib/listings';
import { getStorefrontTenant } from '../../../../_lib/tenant';
import { SECONDARY_PHOTO_SIZES } from '../../../../_lib/photo';
import { statusBadge } from '../../../../_lib/status';
import { LISTING_MISS_METADATA, ListingMiss } from '../../../../_components/listing-miss';
import { STOREFRONT_MISS_METADATA, StorefrontMiss } from '../../../../_components/storefront-miss';
import { StatusBadge } from '../../../../_components/status-badge';
import { StorefrontHeroPhoto, StorefrontPhoto } from '../../../../_components/storefront-photo';
import { WaButton } from '../../../../_components/wa-button';

/**
 * `/s/{slug}/p/{listing}` — **la ficha**. La URL pública es `{slug}.maat.work/p/{listing}`; este
 * path es el destino interno del rewrite de `proxy.ts` y no se linkea nunca (ver `listingPath()`
 * en `_lib/routes.ts`).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Los 15 campos, y de dónde sale cada uno
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Los 15 salen de **un** objeto, `PublicListingDTO`, y de ningún otro lado. Ese es el diseño de
 * seguridad entero: no hay una fila cruda en scope de este archivo, así que no hay nada que
 * "filtrar a ojo" en el JSX y no hay forma de que `imei`, el costo, el proveedor o las notas
 * internas lleguen al markup — ni al HTML visible ni al payload de RSC del final del body, que es
 * por donde un objeto crudo se escapa sin verse en pantalla.
 *
 * | campo | de dónde |
 * |---|---|
 * | 3 fotos | `listing.photos[]` → keys de R2 vía `@istock/media` |
 * | condición | `listing.conditionLabel` (`usado excelente`) |
 * | GB · color | `listing.storageGb` · `listing.color` |
 * | procedencia | `listing.provenanceText` |
 * | batería % | `listing.batteryPct` |
 * | pantalla original | `listing.screenOriginal` |
 * | iCloud | `listing.icloudStatusText` |
 * | garantía | `listing.warrantyText` |
 * | USD + ARS | `listing.priceUsd` · `listing.priceArs` (`fx_settings` + `applyFx`) |
 * | punto + horario | `listing.pickup[]` (`locations` activas del tenant) |
 * | medios de pago | `listing.paymentMethods` (`tenants.payment_methods`) |
 * | canje | `listing.acceptsTradeIn` (`tenants.accepts_trade_in`) |
 * | badge | `listing.status` → `_lib/status.ts` |
 * | `wa.me` | `listing.waUrl`, armado por `buildWaUrl` en `@istock/domain` |
 *
 * ── Dos registros de condición, a propósito (LEAD, FASE 2, punto 1) ──────────────────────────
 * La ficha dice **usado excelente** y el mensaje de WhatsApp dice **usado A**. No es una
 * inconsistencia a corregir: la ficha le habla a un comprador y el mensaje le habla al reseller
 * que lo va a leer del otro lado. Por eso esta página **no transcribe** `listing.waMessage`.
 *
 * ── El ARS es informativo, y la ficha lo dice (LEAD, FASE 2, punto 3) ────────────────────────
 * El TC viene de la cotización oficial automática y el redondeo por default es `ceil_1000`.
 * Publicar un peso sin decir que es orientativo lo convierte en una oferta, y la operación se
 * cierra por WhatsApp.
 *
 * ── El equipo que no existe: `<ListingMiss />`, no `notFound()` (medido, 2026-08-28) ──────────
 * Acá se lanzaba `notFound()`, con el argumento de que ADR-011 gobernaba otra pregunta
 * (*"¿existe este tenant?"*) y de que en la ficha el shell del tenant ya había resuelto. El
 * argumento era razonable y **la medición lo desmintió**: el LEAD midió sobre el build de
 * `eaccfee`, dos requests por caso, y el slug inventado salió `200` con **0 chars de texto
 * visible** en la primera request y 404 recién en la segunda. Mismo patológico de ADR-011, un
 * nivel más abajo. La tabla completa está en `_components/listing-miss.tsx`, junto al componente
 * que la contesta; no se copia acá para que no derive.
 *
 * Consecuencia: los caminos negativos de esta página **devuelven** contenido. El `null` del
 * loader se cachea igual con el perfil corto, así que un bot probando mil slugs inventados hace
 * mil queries una vez y cero después.
 *
 * ── Y son DOS negativos, no uno (S3.3) ───────────────────────────────────────────────────────
 * El `null` de `getStorefrontListing()` tapaba dos hechos distintos —no existe el tenant · no
 * existe el equipo— y los dos contestaban *"Este equipo ya no está publicado"*. A quien abría
 * `{inventado}.maat.work/p/lo-que-sea` le decíamos que se agotó un equipo de un negocio que nunca
 * existió, y encima `{inventado}.maat.work/` (que sí distinguía) contestaba otra cosa sobre el
 * mismo hecho. El desempate, y por qué se pregunta **después** del `null` y no antes, están abajo
 * en `storefrontExists()`.
 *
 * ── Los tags de las DOS entradas de esta página, y por qué el miss lleva uno más (S6.1) ───────
 * El cuerpo y la metadata son dos entradas de cache distintas y cada una registra los suyos.
 * Ninguna de las dos registra `storefront:{slug}`: ese tag es el de la **grilla**, y mientras esta
 * página lo llevara, `invalidateStorefrontUnit()` —que lo emite para tirar abajo la grilla— purgaba
 * las 61 páginas de un tenant de 60 equipos cada vez que se reservaba una. Cold-hit ~39% contra una
 * alarma de 5% (`cost-auditor` sobre S6, `docs/COST.md` §2.4).
 *
 * | camino | tags de la entrada | de dónde sale cada uno |
 * |---|---|---|
 * | equipo publicado | `tenant-config:{slug}` · `listing:{uuid}` | el primero acá; el segundo acá **y** heredado de `getStorefrontListing()` |
 * | equipo/vidriera que no existe | `tenant-config:{slug}` · `storefront:{slug}` | los dos acá, y el segundo **además** heredado |
 *
 * La herencia no es una figura retórica: el wrapper de `'use cache'` copia los tags de la entrada
 * interna al scope que la contiene, en las cinco rutas de lectura (generada, hit del cache handler,
 * resume data cache y los dos joins entre requests). La única excepción es la revalidación en
 * background de una entrada stale, cuyo camino de lectura en primer plano ya propagó.
 *
 * El camino negativo recibiría `storefront:{slug}` por herencia igual —lo propagan el miss de
 * `getStorefrontListing()` (ver `listingMiss()` en `_lib/listings.ts`) y el `getStorefrontTenant()`
 * del desempate— y aun así **lo registra a mano**. La redundancia es a propósito y la decidió el
 * LEAD: la propagación está verificada contra `use-cache-wrapper.js`, un interno de Next sin
 * contrato público, y el piso de versiones de Next se mueve por seguridad (`CLAUDE.md` §3), no por
 * esta slice. El camino positivo no depende de ese interno —registra su `listing:{uuid}` él mismo—
 * y las dos ramas tienen que estar igualadas, porque el día del upgrade nadie se acuerda de que una
 * de las dos era distinta. Si la herencia cambiara y el registro no estuviera, **publicar un equipo
 * dejaría esta página mostrando "ya no está publicado" hasta 15 minutos** (`MISS_EXPIRE_SECONDS`),
 * sin error, sin log y sin ningún test en rojo.
 */

/**
 * Obligatorio, y no por contenido: sin `generateStaticParams` la ruta se sirve en modo *postponed*
 * (`Cache-Control: private, no-cache, no-store`) y **todos** los pageviews invocan una función y
 * pegan a Postgres. Con la lista presente —no vacía, aunque el par no exista— la ruta pasa a ISR.
 * El argumento largo está en el gemelo de `s/[slug]/page.tsx`.
 *
 * El par semilla usa `PRERENDER_SEED_SLUG`, que es un subdominio reservado: el loader lo corta
 * antes de abrir una conexión, así que `next build` sigue compilando **sin `DATABASE_URL`**.
 */
export async function generateStaticParams(): Promise<Array<{ slug: string; listing: string }>> {
  return [{ slug: PRERENDER_SEED_SLUG, listing: PRERENDER_SEED_LISTING }];
}

/** La ficha también entrega su HTML completo sin JS; no usa navegación instantánea de Next. */
export const instant = false;

interface ListingPageProps {
  readonly params: Promise<{ readonly slug: string; readonly listing: string }>;
}

/**
 * Metadata de la ficha, en su **propio** boundary de cache y por lo tanto con sus propios tags.
 *
 * Es la que se ve cuando el dueño pega el link en un estado de WhatsApp o de Instagram, o sea el
 * momento exacto en el que el producto funciona. Un `<title>` genérico ahí es medio producto.
 */
export async function generateMetadata({ params }: ListingPageProps): Promise<Metadata> {
  'use cache';

  const { slug, listing: listingSlug } = await params;

  // Validar antes de `cacheTag()`: `tenantConfigTag()` pasa por el mismo `assertSlug()` que
  // `storefrontTag()` y tira igual con un slug basura, así que sacar el tag del catálogo no aflojó
  // esta guarda. Bajo `cacheComponents` + PPR un throw de render no es un 500: es un stream que no
  // cierra con el 200 ya emitido.
  // Un slug de tenant que no pasa `isSlugShaped` **no puede existir en la base** (el CHECK
  // `tenants_slug_format` de `packages/db` no lo deja entrar), así que la respuesta honesta es la
  // del tenant, no la del equipo: no hay vidriera en esa dirección. El validador de la ficha
  // (`isListingSlugShaped`, techo 64) NO se chequea acá — lo aplica `getStorefrontListing` sin
  // abrir conexión, y así el `listingSlug` basura cae por el mismo camino que el inexistente y
  // recibe la misma respuesta de dos ramas. Por qué son dos validadores: `packages/domain/slug.ts`.
  if (!isSlugShaped(slug)) {
    cacheStorefrontMiss();
    return STOREFRONT_MISS_METADATA;
  }

  // **Sólo el tag de config, nunca el del catálogo (S6.1).** Un tag es un OR: mientras esta
  // entrada registrara `storefront:{slug}`, reservar UNA unidad purgaba las 61 páginas del tenant
  // —la que cambió y las 60 que no—, porque `invalidateStorefrontUnit()` emite ese tag para tirar
  // abajo la grilla. Medido por `cost-auditor` sobre S6: cold-hit ~39% contra una alarma de 5%.
  // Lo que mata a esta entrada cuando corresponde: `tenant-config:{slug}` si cambia el TC o un
  // punto de retiro, y `listing:{uuid}` —heredado del loader por propagación— si cambia el equipo.
  cacheTag(tenantConfigTag(slug));

  const listing = await getStorefrontListing(slug, listingSlug);
  if (listing === null) {
    cacheStorefrontMiss();
    // **El tag del tenant, registrado acá y no heredado.** El loader ya lo propaga (su miss lo
    // lleva), así que esta línea es redundante *hoy*. No es defensa en profundidad decorativa: es
    // que el camino positivo registra su `listing:{uuid}` explícitamente doce líneas más abajo, y
    // dos ramas del mismo archivo no pueden tener distinto grado de dependencia de un interno de
    // Next. La propagación de tags de un `'use cache'` interno al que lo contiene está verificada
    // en `use-cache-wrapper.js`, que es un interno **sin contrato público**, y `CLAUDE.md` §3 nos
    // obliga a subir el piso de Next (CVE-2026-64648 no tiene workaround, sólo upgrade). Un
    // `pnpm up` que cambie ese orden no pondría rojo ningún test nuestro: el síntoma sería una
    // ficha recién publicada mostrando "este equipo ya no está publicado" hasta
    // `MISS_EXPIRE_SECONDS` (15 min), sin error y sin log. Eso es lo que se lleva puesto quien
    // borre esta línea por redundante.
    cacheTag(storefrontTag(slug));
    // El desempate de los dos miss vive UNA sola vez, en `missMetadataFor()` (abajo), para que el
    // `<title>` no pueda decir "este equipo ya no está publicado" mientras el cuerpo dice "no hay
    // ninguna vidriera en esta dirección". Cuerpo y metadata son dos entradas de cache distintas:
    // si el desempate estuviera copiado, la copia deriva y nadie lo mira.
    return await missMetadataFor(slug);
  }

  cacheTag(listingTag(listing.id));
  cacheLife('max');

  const url = `https://${slug}.${STOREFRONT_DOMAIN}/p/${listing.slug}`;
  const cover = listing.photos[0];

  return {
    title: { absolute: `${listing.title} - ${listing.priceUsd.formatted}` },
    description: `${listing.title}. Condición ${listing.conditionLabel}. ${listing.priceUsd.formatted}. Retiro en el local y cierre por WhatsApp.`,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      locale: 'es_AR',
      title: listing.title,
      description: `${listing.conditionLabel} · ${listing.priceUsd.formatted}`,
      url,
      // La foto de la card, no la de detalle: la previsualización de WhatsApp la baja el
      // dispositivo de cada persona que ve el estado. Es el recurso más multiplicado del producto.
      ...(cover === undefined ? {} : { images: [{ url: cover.card, alt: cover.alt }] }),
    },
  };
}

export default async function ListingPage({ params }: ListingPageProps) {
  'use cache';

  const { slug, listing: listingSlug } = await params;

  // Backstop de forma. Con el proxy en pie no llega nadie acá: un host que no puede ser tenant
  // jamás lo corta el proxy, sin invocar la app (`isStorefrontInternalPath` / `malformedHost`).
  // Entonces el contrato de esta rama es chico: no tirar, no colgarse, no filtrar y no costar caro.
  // El status no entra en el contrato, y no por olvido — ADR-011 y la medición del 2026-08-28
  // muestran que desde acá adentro ya está decidido.
  //
  // Devuelve el miss del **tenant**, no el del equipo, y sin preguntarle a Postgres: un slug que no
  // pasa `isSlugShaped` no puede estar en `tenants` (CHECK `tenants_slug_format`, `packages/db`),
  // así que "no hay vidriera en esta dirección" es un hecho ya decidido acá. El validador de la
  // ficha se sacó de esta condición a propósito: lo aplica `getStorefrontListing` sin abrir
  // conexión, y así el `listingSlug` malformado desemboca en el mismo desempate que el inexistente
  // en vez de asumir una vidriera que quizás tampoco existe.
  if (!isSlugShaped(slug)) {
    cacheStorefrontMiss();
    return <StorefrontMiss />;
  }

  // Sólo el de config, igual que en `generateMetadata`: el del catálogo (`storefront:{slug}`) es
  // de la grilla, y registrarlo acá hacía que reservar una unidad purgara las 61 páginas. El tag
  // del equipo se hereda del loader, y el camino negativo de abajo hereda el del catálogo.
  cacheTag(tenantConfigTag(slug));

  // El caso frecuente, y el que paga esta página: el equipo se vendió y se despublicó, y el link
  // del estado de WhatsApp sigue circulando. Se **devuelve** el miss (ver el docblock de arriba).
  const listing = await getStorefrontListing(slug, listingSlug);
  if (listing === null) {
    cacheStorefrontMiss();
    // Mismo registro explícito que en `generateMetadata`, por el mismo motivo: es el único tag que
    // el panel emite al publicar este equipo —todavía no hay UUID que registrar— y no puede quedar
    // dependiendo de que la propagación de un interno de Next siga funcionando igual después del
    // próximo upgrade. Si esto se borra: ficha publicada que sigue mostrando el miss hasta 15 min.
    cacheTag(storefrontTag(slug));
    // Y recién ACÁ se pregunta si la vidriera existe. Ver `storefrontExists()`, abajo: el orden es
    // el invariante de costo de esta página, no una preferencia de lectura.
    return (await storefrontExists(slug)) ? <ListingMiss /> : <StorefrontMiss />;
  }

  // El tag propio de la unidad, además del de config del tenant —ya no de los dos: ver arriba—.
  // Se registra recién acá porque el UUID se conoce después del `await`; `cacheTag()` es
  // acumulativo dentro del scope. Es el que hace que publicar o reservar UNA unidad purgue UNA
  // ficha y no el catálogo entero. Se registra igual aunque el loader ya lo lleve (y propague el
  // suyo hacia acá): que la página nombre el tag que la mata no puede depender de que un módulo de
  // más abajo se acuerde de hacerlo.
  cacheTag(listingTag(listing.id));
  cacheLife('max');

  const badge = statusBadge(listing.status);
  const [cover, ...rest] = listing.photos;

  return (
    <main className="storefront-main storefront-listing-page pb-10">
      <p className="pt-1">
        <a
          href={STOREFRONT_HOME_PATH}
          className="storefront-back-link text-sm underline-offset-4 hover:underline"
        >
          ← Volver a la vidriera
        </a>
      </p>

      {/*
        Orden mobile-first: título → precio → estado → fotos → botón. La persona está parada en la
        calle con una mano; lo que decide (qué es, cuánto sale, si está) va antes que lo que
        confirma (las fotos) y que lo que ejecuta (el botón).
      */}
      <div className="storefront-listing-layout">
        <header className="storefront-listing-info">
          <h1>{listing.title}</h1>
          <div className="storefront-listing-prices">
            <p><strong>{listing.priceUsd.formatted}</strong></p>
            <p><span>≈ {listing.priceArs.formatted}</span></p>
          </div>
          <p className="storefront-price-note text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
            El precio en pesos es <strong className="font-semibold">informativo</strong> y sale de
            convertir {listing.priceUsd.formatted} con la cotización oficial diaria (TC{' '}
            {listing.fxRateUsed}). Es una referencia: la operación se cierra por WhatsApp.
          </p>
          <p className="storefront-status-line">
            <StatusBadge status={listing.status} />
          </p>
          {badge.detail === '' ? null : (
            <p className="storefront-status-detail text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
              {badge.detail}
            </p>
          )}
        </header>

        <div className="storefront-listing-media">
          <ListingPhotos cover={cover} rest={rest} />
        </div>

        {/* UN solo botón de WhatsApp en toda la ficha. `CLAUDE.md` §1. */}
        <div className="storefront-listing-action">
          <WaButton listing={listing} />
        </div>
      </div>

      <div className="storefront-detail-sections">
        <SpecSheet listing={listing} />

        {listing.description === null ? null : (
          <section aria-labelledby="descripcion" className="storefront-section">
            <h2 id="descripcion" className="text-base font-semibold">
              Lo que dice el local
            </h2>
            {/*
              Ya viene sanitizada por `publicListingDTO` (`sanitizeDescription` de `@istock/domain`).
              Se imprime como TEXTO, nunca inyectando HTML crudo: el dueño escribe esto en un
              textarea del panel y es input no confiable aunque sea el dueño.
            */}
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
              {listing.description}
            </p>
          </section>
        )}

        <PickupAndPayment listing={listing} />
      </div>
    </main>
  );
}

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Los dos miss de esta página son DOS HECHOS DISTINTOS, y el orden en que se preguntan es plata
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `getStorefrontListing()` devuelve `null` por dos motivos que no se parecen en nada:
 *
 * | qué pasó | qué contesta | por qué |
 * |---|---|---|
 * | la vidriera no existe | `<StorefrontMiss />` · *"No hay ninguna vidriera en esta dirección"* | el link está mal escrito o el subdominio nunca fue de nadie |
 * | la vidriera existe, el equipo no | `<ListingMiss />` · *"Este equipo ya no está publicado"* | se vendió, y el resto del stock **sí** está ahí |
 *
 * Decirle *"este equipo ya no está publicado"* a quien abrió `{inventado}.maat.work/p/lo-que-sea`
 * es dos mentiras encima: no hay tal equipo y no hay tal negocio, y encima lo mandamos a buscar
 * stock a un lugar que no existe. Peor todavía, `{inventado}.maat.work/` sí contestaba bien: dos
 * URLs del mismo subdominio muerto contestaban cosas distintas sobre el mismo hecho.
 *
 * El desempate reusa `getStorefrontTenant()` —el mismo loader que ya usa `s/[slug]/page.tsx`, con
 * su mismo `'use cache'`, sus mismos tags y su mismo perfil corto para el `null`— en vez de una
 * segunda consulta escrita acá.
 *
 * ## Por qué se llama DESPUÉS del `null`, y nunca antes
 * Esta pregunta **no entra en el camino feliz**. Una ficha que existe no ejecuta ni una línea de
 * acá: `getStorefrontListing()` ya resolvió el tenant adentro de su propia transacción y devolvió
 * el DTO. Poner el `getStorefrontTenant()` arriba, como hace la home, le sumaría una consulta a
 * **toda** ficha —incluidas las 99 de cada 100 que sí existen— para arreglar el caso raro, y eso
 * es exactamente lo que el §3 de `CLAUDE.md` compra con el `'use cache'` (95% de los hits sin
 * Postgres). El costo queda confinado al miss: **una** consulta más, sólo en cache frío, y
 * cacheada con `STOREFRONT_MISS_LIFE` (5 min) como cualquier otro `null` de la vidriera.
 */
async function storefrontExists(slug: string): Promise<boolean> {
  return (await getStorefrontTenant(slug)) !== null;
}

/**
 * El mismo desempate para la metadata, y **escrito una sola vez** para los dos.
 *
 * El cuerpo y la metadata son dos entradas de cache distintas, con sus propios tiempos de vida y
 * su propio momento de resolución en el stream. Si el desempate estuviera copiado, alcanza con que
 * una de las dos copias derive para producir la peor pantalla posible: un `<h1>` que dice "no hay
 * ninguna vidriera acá" con un `<title>` que dice "este equipo ya no está publicado".
 *
 * Las dos metadatas llevan `robots: { index: false, follow: false }`, así que el desempate no puede
 * volver indexable a ninguno de los dos miss por más que elija mal.
 */
async function missMetadataFor(slug: string): Promise<Metadata> {
  return (await storefrontExists(slug)) ? LISTING_MISS_METADATA : STOREFRONT_MISS_METADATA;
}

/**
 * Las tres fotos. La primera es el `<picture>` del hero (en teléfono `detail` **no** es un
 * candidato alcanzable, ver `_lib/photo.ts`); las otras dos van en una fila y resuelven a `card`.
 * A 390×844 DPR 3 la ficha entera baja 3 × `card`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Pueden ser menos de tres, y hasta cero. Qué se hace entonces, y por qué.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `MIN_PHOTOS_TO_PUBLISH` son 3 y el panel no deja publicar con menos, así que en el papel esto no
 * pasa. En la práctica sí: `_lib/listings.ts` **omite** de la lista la foto cuya fila de
 * `listing_photos` no se puede servir (una key rota, una importación a medias), porque la
 * alternativa —listarla igual con `about:invalid`— es un `<img>` que falla y deja un hueco con el
 * `alt` adentro de la caja. Omitir es correcto; lo que hay que decidir es qué se muestra cuando lo
 * omitido son las tres.
 *
 * **Lo que se eligió: la ficha se publica igual, sin sección de fotos, con una línea que dice que
 * no hay fotos.** Los otros dos caminos son peores:
 *
 * - **Tres cajas grises "Sin foto"** (el placeholder que sí usa la grilla) es decoración: ocupa la
 *   mitad de la pantalla de un teléfono para no decir nada, y empuja abajo del fold el precio, el
 *   estado y el botón, que es lo único que esta persona puede usar.
 * - **Tratarla como miss** (`<ListingMiss />`, "este equipo ya no está publicado") sería mentir: el
 *   equipo está publicado, el precio, la condición, la batería, la garantía y el punto de retiro
 *   son todos reales, y el link salió de un estado de WhatsApp que alguien acaba de abrir. Perder
 *   una venta real porque **nuestra** capa de media falló es cambiar un defecto visible por uno
 *   caro e invisible. La foto rota es un problema del reseller y se arregla en el panel; mientras
 *   tanto, la ficha sigue haciendo lo que vino a hacer.
 *
 * La línea no es un placeholder decorativo: es el dato de que no hay fotos —que el comprador tiene
 * derecho a saber antes de tomarse un colectivo— y lo convierte en la única acción disponible, que
 * es la que ya está en pantalla. **No agrega un segundo `wa.me`**: nombra el botón que está abajo
 * (`CLAUDE.md` §1, un solo botón por ficha).
 */
function ListingPhotos({
  cover,
  rest,
}: {
  readonly cover: PublicListingDTO['photos'][number] | undefined;
  readonly rest: readonly PublicListingDTO['photos'][number][];
}) {
  if (cover === undefined) {
    return (
      <section aria-label="Fotos del equipo" className="storefront-photo-gallery">
        <p className="rounded-xl border border-dashed border-neutral-300 p-3 text-sm leading-relaxed text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
          Este equipo todavía no tiene fotos publicadas. Pedilas por WhatsApp, con el botón de acá
          abajo, antes de ir hasta el local.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Fotos del equipo" className="storefront-photo-gallery">
      <div className="storefront-hero-frame aspect-[4/3] w-full overflow-hidden rounded-xl bg-neutral-100 dark:bg-neutral-800">
        <StorefrontHeroPhoto photo={cover} />
      </div>
      {rest.length === 0 ? null : (
        <ul className="storefront-photo-thumbs mt-2 grid grid-cols-3 gap-2">
          {rest.map((photo) => (
            <li
              key={photo.card}
              className="aspect-[4/3] overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-800"
            >
              <StorefrontPhoto
                photo={photo}
                sizes={SECONDARY_PHOTO_SIZES}
                className="h-full w-full object-cover"
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * La ficha técnica. Es un `<dl>` y no una tabla porque en 390 px una tabla se lee mal, y porque
 * son pares nombre/valor de verdad.
 *
 * Un campo que la base no tiene **no se inventa ni se rellena con "—"**: se omite la fila. Un
 * "batería: —" al lado de "garantía: 90 días" se lee como "no tiene batería", no como "no lo
 * cargaron".
 */
function SpecSheet({ listing }: { readonly listing: PublicListingDTO }) {
  const rows: Array<{ readonly label: string; readonly value: string }> = [
    { label: 'Condición', value: listing.conditionLabel },
    ...(listing.storageGb === null
      ? []
      : [{ label: 'Capacidad', value: `${String(listing.storageGb)} GB` }]),
    ...(listing.color === null ? [] : [{ label: 'Color', value: listing.color }]),
    ...(listing.batteryPct === null
      ? []
      : [{ label: 'Batería', value: `${String(listing.batteryPct)}%` }]),
    ...(listing.screenOriginal === null
      ? []
      : [{ label: 'Pantalla original', value: listing.screenOriginal ? 'Sí' : 'No' }]),
    ...(listing.icloudStatusText === null
      ? []
      : [{ label: 'iCloud', value: listing.icloudStatusText }]),
    ...(listing.warrantyText === null ? [] : [{ label: 'Garantía', value: listing.warrantyText }]),
    ...(listing.provenanceText === null
      ? []
      : [{ label: 'Procedencia', value: listing.provenanceText }]),
  ];

  return (
    <section aria-labelledby="ficha-tecnica" className="storefront-section">
      <h2 id="ficha-tecnica" className="text-base font-semibold">
        Ficha técnica
      </h2>
      <dl className="storefront-spec-grid text-sm">
        {rows.map((row) => (
          <div key={row.label} className="storefront-spec">
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * Dónde se retira, cómo se paga y si toman canje. Los tres salen del tenant, no del equipo:
 * `locations` activas, `tenants.payment_methods` y `tenants.accepts_trade_in`. Hoy un `listing`
 * **no** referencia una `location`, así que se listan todos los puntos activos del local — que es
 * la verdad: el equipo se retira en cualquiera de ellos.
 */
function PickupAndPayment({ listing }: { readonly listing: PublicListingDTO }) {
  return (
    <section aria-labelledby="retiro-y-pago" className="storefront-section">
      <h2 id="retiro-y-pago" className="text-base font-semibold">
        Dónde retirarlo y cómo pagarlo
      </h2>

      {listing.pickup.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          El punto de retiro se coordina por WhatsApp.
        </p>
      ) : (
        <ul className="storefront-pickup-grid mt-2">
          {listing.pickup.map((point) => (
            <li
              key={point.name}
              className="rounded-xl border border-neutral-200 p-3 text-sm dark:border-neutral-800"
            >
              <p className="font-medium">{point.name}</p>
              <p className="mt-0.5 text-neutral-600 dark:text-neutral-400">{point.address}</p>
              <p className="mt-0.5 text-neutral-600 dark:text-neutral-400">
                Horario: {point.hours}
              </p>
            </li>
          ))}
        </ul>
      )}

      <dl className="storefront-payment-grid text-sm">
        <div>
          <dt>Medios de pago</dt>
          <dd>
            {listing.paymentMethods.length === 0
              ? 'A coordinar por WhatsApp'
              : listing.paymentMethods.join(' · ')}
          </dd>
        </div>
        <div>
          <dt>Canje</dt>
          <dd>
            {listing.acceptsTradeIn
              ? 'Sí, toman tu equipo usado como parte de pago'
              : 'No toman canje por este equipo'}
          </dd>
          {/*
            El link a `/canje` sólo cuando el negocio lo tiene prendido: mandarlo a un formulario
            que va a decirle que no toman canje es peor que no ofrecerlo. Es un `<a>` y no un
            `<Link>` por lo mismo que la grilla (W005: el prefetch cuesta una invocación por link),
            y el path es relativo al host del tenant — el slug ya está en la barra.

            **No es un segundo llamado a la acción compitiendo con el botón de WhatsApp.** Vive
            adentro de la fila que ya decía "sí toman canje", en la sección de retiro y pago, muy
            por debajo del `wa.me`. Quien está decidido a comprar ya apretó el botón; esto es para
            quien está haciendo la cuenta de cuánto le sale entregando el suyo.
          */}
          {listing.acceptsTradeIn ? (
            <p className="mt-2">
              <a href={TRADEIN_PATH} className="font-medium underline underline-offset-4">
                Contales qué equipo entregás →
              </a>
            </p>
          ) : null}
        </div>
      </dl>
    </section>
  );
}
