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
import { conditionLabel, isPublicStatus, type Condition, type ListingStatus, type PublicStatus } from './types';
import { buildWaMessage, buildWaUrl, type WaListing } from './wa';

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

  const waListing: WaListing = {
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
