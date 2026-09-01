/**
 * `@istock/domain` — TypeScript **puro**. Cero I/O.
 *
 * Reglas del paquete (CLAUDE.md §4, AGENTS.md §domain-agent):
 * - Cero imports de `next`, `drizzle`, `@supabase/*`, `fetch`, `process.env`.
 * - `Date.now()` prohibido: el tiempo entra por parámetro (`now: Date`).
 * - El tipo de cambio entra por parámetro: la fuente automática vive en `apps/web`, fuera del
 *   dominio puro y del hot path.
 * - Plata en **enteros de centavos**. Nunca `float`.
 * - Todo export público tiene test (`src/*.test.ts`).
 *
 * `pnpm --filter @istock/domain lint` verifica la pureza con un chequeo estático propio.
 */

export { DomainError, isDomainError, type DomainErrorCode } from './errors';

export {
  CENTS_PER_UNIT,
  assertCents,
  assertNonNegativeCents,
  formatAmount,
  formatArs,
  formatUsd,
  type Cents,
} from './money';

export {
  DEFAULT_FX_ROUNDING,
  applyFx,
  fxRateFromArsCents,
  fxRateFromDecimal,
  fxRateToDecimalString,
  type FxRate,
  type FxRoundingMode,
} from './fx';

export {
  CONDITIONS,
  LISTING_KINDS,
  LISTING_STATUSES,
  MAIN_STATUSES,
  PUBLIC_STATUSES,
  SIDE_STATUSES,
  conditionLabel,
  isCondition,
  isListingStatus,
  isPublicStatus,
  isSideStatus,
  waConditionLabel,
  type Condition,
  type ListingKind,
  type ListingStatus,
  type MainStatus,
  type PublicStatus,
  type SideStatus,
} from './types';

export {
  MIN_PHOTOS_TO_PUBLISH,
  allowedTargets,
  canTransition,
  checkTransition,
  transitionEffects,
  type ActiveReservation,
  type TransitionCheck,
  type TransitionContext,
  type TransitionDenyReason,
  type TransitionEffects,
  type TransitionIntent,
} from './listing-status';

export {
  RESERVATION_CLOSING_STATUSES,
  RESERVATION_DEFAULT_MINUTES,
  RESERVATION_MAX_MINUTES,
  RESERVATION_MIN_MINUTES,
  RESERVATION_STATUSES,
  createReservation,
  expireReservation,
  isReservationExpired,
  reservationMsRemaining,
  type CreateReservationInput,
  type ExpireReservationResult,
  type Reservation,
  type ReservationClosingStatus,
  type ReservationStatus,
} from './reservation';

export {
  DEMO_TENANT_SLUG,
  PRERENDER_SEED_SLUG,
  RESERVED_SLUGS,
  RESERVED_SUBDOMAINS,
  TENANT_SERVED_RESERVED_SLUGS,
  isReservedSlug,
  isReservedSubdomain,
} from './reserved-slugs';

export {
  LISTING_SLUG_MAX_LENGTH,
  LISTING_SLUG_MIN_LENGTH,
  LISTING_SLUG_PATTERN,
  SLUG_MAX_LENGTH,
  SLUG_MIN_LENGTH,
  SLUG_PATTERN,
  assertSlug,
  isListingSlugShaped,
  isSlugShaped,
  isUsableSlug,
  normalizeSlug,
  suggestSlug,
} from './slug';

/**
 * Criterio único de "texto vacío". Se exporta a propósito: la vidriera decide lo mismo aguas
 * arriba (`resolveModelName`) y tiene que decidirlo con **esta** función, no con una copia.
 */
export { isBlank } from './text';

export {
  NAME_SOURCES,
  STOREFRONT_DOMAIN,
  buildWaMessage,
  buildWaUrl,
  describeListing,
  describeListingName,
  normalizeWaPhone,
  storefrontHost,
  storefrontUrl,
  type ListingNameParts,
  type NameSource,
  type WaListing,
} from './wa';

/**
 * Lista de stock para estados de IG / difusión de WhatsApp (S9).
 * El link de cada unidad va a la **ficha**, y la URL absoluta la arma `apps/web`: este paquete no
 * conoce el prefijo de la ruta. Ver el docblock de `stock-list.ts`.
 */
export {
  ARGENTINA_UTC_OFFSET_MINUTES,
  BUSINESS_NAME_MAX_CHARS,
  DEFAULT_BLOCK_BUDGET_CHARS,
  WA_MESSAGE_MAX_CHARS,
  buildStockList,
  buildStockListEntry,
  type StockList,
  type StockListBlock,
  type StockListInput,
  type StockListUnit,
} from './stock-list';

export {
  DEFAULT_MAX_DESCRIPTION_LENGTH,
  DEFAULT_REDACTION,
  PROMPT_MAX_DESCRIPTION_LENGTH,
  UNTRUSTED_CLOSE,
  UNTRUSTED_OPEN,
  sanitizeDescription,
  sanitizeForPrompt,
  type SanitizeOptions,
} from './sanitize';

export {
  isPubliclyVisible,
  publicListingDTO,
  type PhotoSource,
  type PickupPointSource,
  type PublicListingDTO,
  type PublicListingSource,
  type PublicMoneyDTO,
  type PublicPhotoDTO,
  type PublicPickupDTO,
} from './dto';

export { checkImei, luhnValid, type ImeiCheck } from './imei';
