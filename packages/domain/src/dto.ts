/**
 * `publicListingDTO` — el **único** camino de datos entre la DB y la vidriera
 * (ARCHITECTURE.md §"Límites de confianza": `DB → vidriera` sólo cruza `publicListingDTO`).
 *
 * ## Allowlist, no denylist
 * El DTO se construye campo por campo, a mano, sin `spread`, sin `delete`, sin `omit()`.
 * Una denylist falla el día que `db-agent` agrega una columna; una allowlist falla del lado seguro:
 * el campo nuevo simplemente **no existe** para el comprador hasta que alguien lo agregue acá a
 * propósito. Agregar un campo a esta lista es una **decisión**, no un accidente.
 *
 * ## Prohibido para siempre (DOMAIN.md §Visibilidad)
 * `imei` y todo el bloque `imei_check_*` · `cost_usd` · `margin` · `internal_notes` · `supplier` ·
 * `enacomResult` · `tenantId` · `userId` · claves de R2 del master · cualquier timestamp interno.
 *
 * El IMEI no sale ni siquiera en su forma "inofensiva" (`valid`): publicarlo es afirmar un estado
 * oficial que no controlamos y que cambia con el tiempo.
 */

import { DomainError } from './errors';
import { applyFx, fxRateToDecimalString, type FxRate, type FxRoundingMode } from './fx';
import { formatArs, formatUsd } from './money';
import { sanitizeDescription } from './sanitize';
import { isBlank } from './text';
import { conditionLabel, isPublicStatus, type Condition, type ListingStatus, type PublicStatus } from './types';
import { buildWaMessage, buildWaUrl, type NameSource, type WaListing } from './wa';

/** Una foto tal como viene del read model. Puede traer la key del master: no sale de acá. */
export interface PhotoSource {
  readonly cardUrl: string;
  readonly detailUrl: string;
  readonly alt: string | null;
}

export interface PickupPointSource {
  readonly name: string;
  readonly address: string;
  readonly hours: string;
}

/**
 * Read model de entrada. Es a propósito **más chico** que la fila de la DB: el `select` del server
 * ya filtra. Aun así el DTO no confía en el `select` — de ahí la allowlist.
 *
 * El tipo se intersecta con `Record<string, unknown>` en la firma de `publicListingDTO` para que
 * un caller pueda pasarle la fila entera sin que TypeScript se queje... y el DTO igual no la filtre.
 */
export interface PublicListingSource {
  readonly id: string;
  /** Slug de la ficha dentro de la vidriera (`/p/{slug}`). */
  readonly slug: string;
  /** Subdominio del tenant. NO es el `tenant_id`. */
  readonly tenantSlug: string;
  /** Teléfono del tenant para el `wa.me`. No se publica: se usa para armar la URL. */
  readonly tenantWaPhone: string;
  readonly title: string;
  /**
   * De dónde salió `modelDisplayName`: `'catalog'` si es el `display_name` del `catalog_model`,
   * `'free_text'` si el read model cayó al `title` del dueño (`catalog_model_id` es nullable y
   * además `on delete set null`). Requerido y sin default: el mapeo tiene que decidirlo, porque de
   * eso depende que el mensaje de WhatsApp no repita storage y color. Ver `NAME_SOURCES` en `wa.ts`.
   */
  readonly nameSource: NameSource;
  readonly modelDisplayName: string;
  readonly storageGb: number | null;
  readonly color: string | null;
  readonly condition: Condition;
  readonly batteryPct: number | null;
  readonly screenOriginal: boolean | null;
  readonly icloudStatusText: string | null;
  readonly warrantyText: string | null;
  readonly provenanceText: string | null;
  /** Texto libre del dueño: se sanitiza SIEMPRE antes de salir. */
  readonly description: string | null;
  readonly priceUsdCents: number;
  readonly fxRate: FxRate;
  readonly fxRounding?: FxRoundingMode;
  readonly status: ListingStatus;
  readonly photos: readonly PhotoSource[];
  readonly pickupPoints: readonly PickupPointSource[];
  readonly paymentMethods: readonly string[];
  readonly acceptsTradeIn: boolean;
}

export interface PublicPhotoDTO {
  readonly card: string;
  readonly detail: string;
  readonly alt: string;
}

export interface PublicPickupDTO {
  readonly name: string;
  readonly address: string;
  readonly hours: string;
}

export interface PublicMoneyDTO {
  readonly cents: number;
  readonly formatted: string;
}

export interface PublicListingDTO {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly modelDisplayName: string;
  readonly storageGb: number | null;
  readonly color: string | null;
  readonly condition: Condition;
  readonly conditionLabel: string;
  readonly batteryPct: number | null;
  readonly screenOriginal: boolean | null;
  readonly icloudStatusText: string | null;
  readonly warrantyText: string | null;
  readonly provenanceText: string | null;
  /** Sanitizada. Nunca el texto crudo del dueño. */
  readonly description: string | null;
  readonly priceUsd: PublicMoneyDTO;
  /** Informativo: la operación se cierra por WhatsApp. La ficha lo dice. */
  readonly priceArs: PublicMoneyDTO;
  readonly fxRateUsed: string;
  readonly photos: readonly PublicPhotoDTO[];
  readonly status: PublicStatus;
  readonly pickup: readonly PublicPickupDTO[];
  readonly paymentMethods: readonly string[];
  readonly acceptsTradeIn: boolean;
  /** UN solo botón. El texto ya viene armado. */
  readonly waUrl: string;
  readonly waMessage: string;
}

/** ¿Este estado se puede mostrar a un comprador anónimo? */
export function isPubliclyVisible(status: ListingStatus): status is PublicStatus {
  return isPublicStatus(status);
}

function photoDTO(photo: PhotoSource, fallbackAlt: string): PublicPhotoDTO {
  // Allowlist anidada: `card`, `detail`, `alt`. La key del master no tiene camino hasta acá.
  return {
    card: photo.cardUrl,
    detail: photo.detailUrl,
    alt: photo.alt !== null && photo.alt.trim().length > 0 ? photo.alt.trim() : fallbackAlt,
  };
}

function pickupDTO(point: PickupPointSource): PublicPickupDTO {
  return { name: point.name, address: point.address, hours: point.hours };
}

/**
 * Un nombre en blanco es un nombre **ausente**, y una ficha sin nombre no se publica.
 *
 * `listings.title` y `catalog_models.display_name` son los dos `text not null` **sin CHECK**
 * (`packages/db/drizzle/0000_sparkling_vector.sql:95` para el segundo; ninguno de los 46 CHECK de
 * esa migración toca a ninguno de los dos). `NOT NULL` no es `no vacío`: `''` entra en las dos
 * columnas, y con él entran `'   '` y `'\t\n'`.
 *
 * `title` es el `<h1>` de la ficha, el `<title>` de la pestaña, el texto del Open Graph y el `alt`
 * de fallback de todas las fotos. `modelDisplayName` es lo que va adentro del mensaje de WhatsApp.
 * Ninguno de los dos tiene una degradación aceptable: una ficha con el `<h1>` vacío y un `wa.me`
 * que dice `Hola, vi el  (usado A)` es peor que un 404, porque parece que funciona.
 *
 * El DTO es el **único** camino de datos entre la DB y la vidriera (`ARCHITECTURE.md` §Límites de
 * confianza), así que tirar acá saca el caso de todas las pantallas de una vez. Criterio de vacío:
 * `isBlank`, el mismo que usa `resolveModelName` en la vidriera. Ver `text.ts`.
 */
function assertNamed(value: string, field: 'title' | 'modelDisplayName'): void {
  if (isBlank(value)) {
    throw new DomainError(
      'LISTING_INVALID',
      `\`${field}\` está vacío o en blanco (${JSON.stringify(value)}): un listing sin nombre no se ` +
        'publica. `NOT NULL` no es `no vacío`; el fix va en el mapeo o en la fila, no acá.',
    );
  }
}

/**
 * Construye el DTO público. Tira si el listing no es públicamente visible: la vidriera tiene que
 * dar 404 **antes** de llegar acá, no confiar en que el DTO devuelva algo vacío.
 */
export function publicListingDTO(listing: PublicListingSource & Record<string, unknown>): PublicListingDTO {
  if (!isPubliclyVisible(listing.status)) {
    throw new DomainError(
      'LISTING_INVALID',
      `el listing está en "${listing.status}" y no es público. La vidriera debe devolver 404.`,
    );
  }
  const status: PublicStatus = listing.status;

  // Antes de construir nada: si el listing no tiene nombre, no hay DTO. `describeListing` volvería
  // a chequear `modelDisplayName` más abajo (es export público y tiene que defenderse solo), pero
  // el mensaje de error de acá dice **qué campo** de la fila está mal, que es lo que necesita quien
  // lo lea en Sentry. `title` no pasa por `describeListing` y no tendría quién lo mire.
  assertNamed(listing.title, 'title');
  assertNamed(listing.modelDisplayName, 'modelDisplayName');

  const waListing: WaListing = {
    nameSource: listing.nameSource,
    modelDisplayName: listing.modelDisplayName,
    storageGb: listing.storageGb,
    color: listing.color,
    condition: listing.condition,
    priceUsdCents: listing.priceUsdCents,
    status,
  };

  const priceArsCents =
    listing.fxRounding === undefined
      ? applyFx(listing.priceUsdCents, listing.fxRate)
      : applyFx(listing.priceUsdCents, listing.fxRate, listing.fxRounding);

  // ── ALLOWLIST EXPLÍCITA ──────────────────────────────────────────────────────────────────────
  // Nada de `...listing`. Cada línea es una decisión de publicar ese dato.
  // `nameSource` **no** está acá: es procedencia interna del dato, no información para el
  // comprador. Entra al DTO como insumo del mensaje de WhatsApp y muere en esta función.
  return {
    id: listing.id,
    slug: listing.slug,
    title: listing.title,
    modelDisplayName: listing.modelDisplayName,
    storageGb: listing.storageGb,
    color: listing.color,
    condition: listing.condition,
    conditionLabel: conditionLabel(listing.condition),
    batteryPct: listing.batteryPct,
    screenOriginal: listing.screenOriginal,
    icloudStatusText: listing.icloudStatusText,
    warrantyText: listing.warrantyText,
    provenanceText: listing.provenanceText,
    description: listing.description === null ? null : sanitizeDescription(listing.description),
    priceUsd: { cents: listing.priceUsdCents, formatted: formatUsd(listing.priceUsdCents) },
    priceArs: { cents: priceArsCents, formatted: formatArs(priceArsCents) },
    fxRateUsed: fxRateToDecimalString(listing.fxRate),
    photos: listing.photos.map((photo) => photoDTO(photo, listing.title)),
    status,
    pickup: listing.pickupPoints.map(pickupDTO),
    paymentMethods: [...listing.paymentMethods],
    acceptsTradeIn: listing.acceptsTradeIn,
    waUrl: buildWaUrl(waListing, listing.tenantSlug, listing.tenantWaPhone),
    waMessage: buildWaMessage(waListing, listing.tenantSlug),
  };
  // ─────────────────────────────────────────────────────────────────────────────────────────────
}
