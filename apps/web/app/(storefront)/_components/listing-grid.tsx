import type { PublicListingDTO } from '@istock/domain';
import { GRID_PHOTO_SIZES } from '../_lib/photo';
import { listingPath } from '../_lib/routes';
import { StatusBadge } from './status-badge';
import { StorefrontPhoto, StorefrontPhotoPlaceholder } from './storefront-photo';

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  La grilla. Dos columnas en mobile, y eso es un presupuesto de bytes disfrazado de layout
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * A una columna, la caja de la foto mediría ~358 px CSS y en un teléfono DPR 3 el browser pediría
 * ~1074 px de recurso: elegiría `detail` (128.570 B) por card **aunque el `sizes` estuviera
 * perfecto**. A dos columnas mide ~175 px CSS → ~527 px de recurso → `card` (50.692 B). La misma
 * grilla, la misma foto, 2,5× de diferencia en la factura de datos de alguien parado en la calle.
 *
 * ── Qué NO hay acá, y por qué ─────────────────────────────────────────────────────────────────
 * - **No hay `wa.me` por card.** El botón vive en la ficha, uno solo (`CLAUDE.md` §1). Una
 *   conversación que arranca antes de que la persona vea batería, garantía y punto de retiro es
 *   justo el mensaje sin contexto que el producto viene a eliminar.
 * - **No hay `<Link>` de `next/link`.** Con `partialPrefetching` la doc de Next avisa que un link
 *   prefetchable *"costs a server invocation per prefetchable link"*: con 20 fichas visibles son
 *   20 invocaciones por pageview en la única página cuya economía depende de no invocar nada
 *   (regla W005 de `web-lint`). Un `<a>` navega igual; lo único que se pierde es el prefetch, que
 *   acá es exactamente lo que no queremos pagar.
 * - **No hay precio en ARS.** Ocupa una línea por card y obliga a explicar en cada una que es
 *   informativo. La grilla muestra el USD, que es el precio con el que se negocia; el ARS y su
 *   aclaración van en la ficha, una vez.
 * - **No hay `data-listing` con el id.** El `data-listing` marca la card (lo usa la suite de
 *   `qa-agent` para distinguir vidriera de miss) y lleva el **slug**, que ya está en el `href`. El
 *   UUID no tiene por qué viajar al HTML público.
 */
export function ListingGrid({ listings }: { readonly listings: readonly PublicListingDTO[] }) {
  return (
    <ul
      data-storefront="grid"
      className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4"
    >
      {listings.map((listing, index) => (
        <ListingCard key={listing.id} listing={listing} index={index} />
      ))}
    </ul>
  );
}

/**
 * Una card. Todo lo que se ve sale del `PublicListingDTO` y de ningún otro lado — no hay una
 * segunda fuente de datos "sólo para la grilla" que se pueda desincronizar del DTO ni saltarse su
 * allowlist.
 *
 * `index` sólo decide `loading="lazy"` vs `eager`: las cuatro primeras cards son las que entran en
 * un viewport de 390×844, y hacerlas `lazy` retrasaría el LCP de la grilla a propósito.
 */
function ListingCard({ listing, index }: { readonly listing: PublicListingDTO; readonly index: number }) {
  const photo = listing.photos[0];

  return (
    <li data-listing={listing.slug} className="min-w-0">
      <a
        href={listingPath(listing.slug)}
        className="flex h-full flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white active:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900"
      >
        <div className="relative aspect-[4/3] w-full overflow-hidden bg-neutral-100 dark:bg-neutral-800">
          {photo === undefined ? (
            <StorefrontPhotoPlaceholder />
          ) : (
            <StorefrontPhoto photo={photo} sizes={GRID_PHOTO_SIZES} priority={index < 4} />
          )}
          <span className="absolute left-1.5 top-1.5">
            <StatusBadge status={listing.status} />
          </span>
        </div>

        <div className="flex flex-1 flex-col gap-1 p-2.5">
          <h3 className="text-sm font-semibold leading-snug">{listing.title}</h3>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {listing.conditionLabel}
            {listing.batteryPct === null ? '' : ` · batería ${String(listing.batteryPct)}%`}
          </p>
          <p className="mt-auto pt-1 text-base font-semibold tabular-nums">
            {listing.priceUsd.formatted}
          </p>
        </div>
      </a>
    </li>
  );
}
