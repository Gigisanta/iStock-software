import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cacheLife, cacheTag } from 'next/cache';
import type { PublicListingDTO } from '@istock/domain';
import { STOREFRONT_DOMAIN, isListingSlugShaped } from '@istock/domain';
import { listingTag, storefrontTag, tenantConfigTag } from '../../../../_lib/cache-tags';
import { cacheStorefrontMiss } from '../../../../_lib/cache-life';
import { PRERENDER_SEED_SLUG, isSlugShaped } from '../../../../_lib/host';
import { PRERENDER_SEED_LISTING } from '../../../../_lib/routes';
import { getStorefrontListing } from '../../../../_lib/listings';
import { SECONDARY_PHOTO_SIZES } from '../../../../_lib/photo';
import { statusBadge } from '../../../../_lib/status';
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
 * El TC lo carga el dueño a mano y el redondeo por default es `ceil_1000`. Publicar un peso sin
 * decir que es orientativo lo convierte en una oferta, y la operación se cierra por WhatsApp.
 *
 * ── `notFound()` acá SÍ, y no contradice ADR-011 ──────────────────────────────────────────────
 * ADR-011 gobierna *"¿existe este tenant?"* y por eso `s/[slug]` devuelve `<StorefrontMiss />` en
 * vez de lanzar. Acá la pregunta es otra —*"¿existe este equipo en esta vidriera?"*— el shell del
 * tenant ya resolvió, no hay ambigüedad de host, y el boundary en castellano ya existe
 * (`s/[slug]/not-found.tsx`). El `null` del loader **se cachea** con el perfil corto, así que un
 * bot probando mil slugs inventados hace mil queries una vez y cero después.
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

  // Validar antes de `cacheTag()`: `storefrontTag()` tira con un slug basura y bajo
  // `cacheComponents` + PPR un throw de render es un stream que no cierra con el 200 ya emitido.
  // Los dos validadores son de `@istock/domain`: el del tenant (techo 32, label DNS) y el de la
  // ficha (techo 64, segmento de path). Por qué son dos, está en `packages/domain/src/slug.ts`.
  if (!isSlugShaped(slug) || !isListingSlugShaped(listingSlug)) {
    cacheStorefrontMiss();
    return NOT_FOUND_METADATA;
  }

  cacheTag(storefrontTag(slug), tenantConfigTag(slug));

  const listing = await getStorefrontListing(slug, listingSlug);
  if (listing === null) {
    cacheStorefrontMiss();
    return NOT_FOUND_METADATA;
  }

  cacheTag(listingTag(listing.id));
  cacheLife('max');

  const url = `https://${slug}.${STOREFRONT_DOMAIN}/p/${listing.slug}`;
  const cover = listing.photos[0];

  return {
    title: { absolute: `${listing.title} — ${listing.priceUsd.formatted}` },
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

/** Cuando el equipo no existe (o no es público) la metadata no puede prometer que sí. */
const NOT_FOUND_METADATA: Metadata = {
  title: { absolute: 'Este equipo ya no está publicado' },
  robots: { index: false, follow: false },
};

export default async function ListingPage({ params }: ListingPageProps) {
  'use cache';

  const { slug, listing: listingSlug } = await params;

  if (!isSlugShaped(slug) || !isListingSlugShaped(listingSlug)) {
    cacheStorefrontMiss();
    notFound();
  }

  cacheTag(storefrontTag(slug), tenantConfigTag(slug));

  const listing = await getStorefrontListing(slug, listingSlug);
  if (listing === null) {
    cacheStorefrontMiss();
    notFound();
  }

  // El tag propio de la unidad, además de los dos del tenant. Se registra recién acá porque el
  // UUID se conoce después del `await`; `cacheTag()` es acumulativo dentro del scope. Es lo que
  // permite que publicar UNA unidad deje de purgar el catálogo entero de su vidriera.
  cacheTag(listingTag(listing.id));
  cacheLife('max');

  const badge = statusBadge(listing.status);
  const [cover, ...rest] = listing.photos;

  return (
    <main className="pb-10">
      <p className="pt-1">
        <a href="/" className="text-sm text-neutral-500 underline-offset-4 hover:underline">
          ← Volver a la vidriera
        </a>
      </p>

      {/*
        Orden mobile-first: título → precio → estado → fotos → botón. La persona está parada en la
        calle con una mano; lo que decide (qué es, cuánto sale, si está) va antes que lo que
        confirma (las fotos) y que lo que ejecuta (el botón).
      */}
      <header className="mt-3">
        <h1 className="text-xl font-semibold leading-tight sm:text-2xl">{listing.title}</h1>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-2xl font-bold tabular-nums">{listing.priceUsd.formatted}</p>
          <p className="text-base text-neutral-500 tabular-nums">≈ {listing.priceArs.formatted}</p>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
          El precio en pesos es <strong className="font-semibold">informativo</strong> y sale de
          convertir {listing.priceUsd.formatted} al tipo de cambio que carga el local (TC{' '}
          {listing.fxRateUsed}). Es una referencia: la operación se cierra por WhatsApp.
        </p>
        <p className="mt-3">
          <StatusBadge status={listing.status} />
        </p>
        {badge.detail === '' ? null : (
          <p className="mt-2 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
            {badge.detail}
          </p>
        )}
      </header>

      <ListingPhotos cover={cover} rest={rest} />

      {/* UN solo botón de WhatsApp en toda la ficha. `CLAUDE.md` §1. */}
      <WaButton listing={listing} />

      <SpecSheet listing={listing} />

      {listing.description === null ? null : (
        <section aria-labelledby="descripcion" className="mt-8">
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
    </main>
  );
}

/**
 * Las tres fotos. La primera es el `<picture>` del hero (en teléfono `detail` **no** es un
 * candidato alcanzable, ver `_lib/photo.ts`); las otras dos van en una fila y resuelven a `card`.
 * A 390×844 DPR 3 la ficha entera baja 3 × `card`.
 */
function ListingPhotos({
  cover,
  rest,
}: {
  readonly cover: PublicListingDTO['photos'][number] | undefined;
  readonly rest: readonly PublicListingDTO['photos'][number][];
}) {
  if (cover === undefined) return null;

  return (
    <section aria-label="Fotos del equipo" className="mt-5">
      <div className="aspect-[4/3] w-full overflow-hidden rounded-xl bg-neutral-100 dark:bg-neutral-800">
        <StorefrontHeroPhoto photo={cover} />
      </div>
      {rest.length === 0 ? null : (
        <ul className="mt-2 grid grid-cols-3 gap-2">
          {rest.map((photo) => (
            <li
              key={photo.card}
              className="aspect-[4/3] overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-800"
            >
              <StorefrontPhoto photo={photo} sizes={SECONDARY_PHOTO_SIZES} />
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
    <section aria-labelledby="ficha-tecnica" className="mt-8">
      <h2 id="ficha-tecnica" className="text-base font-semibold">
        Ficha técnica
      </h2>
      <dl className="mt-2 divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
        {rows.map((row) => (
          <div key={row.label} className="flex items-start justify-between gap-4 py-2.5">
            <dt className="shrink-0 text-neutral-500">{row.label}</dt>
            <dd className="text-right font-medium">{row.value}</dd>
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
    <section aria-labelledby="retiro-y-pago" className="mt-8">
      <h2 id="retiro-y-pago" className="text-base font-semibold">
        Dónde retirarlo y cómo pagarlo
      </h2>

      {listing.pickup.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          El punto de retiro se coordina por WhatsApp.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
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

      <dl className="mt-3 space-y-3 text-sm">
        <div className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
          <dt className="text-neutral-500">Medios de pago</dt>
          <dd className="mt-1 font-medium">
            {listing.paymentMethods.length === 0
              ? 'A coordinar por WhatsApp'
              : listing.paymentMethods.join(' · ')}
          </dd>
        </div>
        <div className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
          <dt className="text-neutral-500">Canje</dt>
          <dd className="mt-1 font-medium">
            {listing.acceptsTradeIn
              ? 'Sí, toman tu equipo usado como parte de pago'
              : 'No toman canje por este equipo'}
          </dd>
        </div>
      </dl>
    </section>
  );
}
