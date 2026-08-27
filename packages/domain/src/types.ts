/**
 * Vocabulario del dominio. Un solo lugar donde viven los enums de negocio.
 * `packages/db` los refleja en Postgres; `apps/web` los consume. Nadie los redefine.
 */

/** CLAUDE.md §1 — "Realidad local que el software debe modelar". */
export const CONDITIONS = [
  'sealed',
  'open_box',
  'tester_a_plus',
  'used_excellent',
  'used_with_detail',
] as const;
export type Condition = (typeof CONDITIONS)[number];

export function isCondition(value: string): value is Condition {
  return (CONDITIONS as readonly string[]).includes(value);
}

/** Estados principales del listing. `sold` es terminal. */
export const MAIN_STATUSES = ['draft', 'available', 'reserved', 'sold'] as const;
export type MainStatus = (typeof MAIN_STATUSES)[number];

/** Estados laterales: el equipo existe pero no está en la vidriera. */
export const SIDE_STATUSES = ['in_transit', 'in_tradein', 'in_service', 'unavailable'] as const;
export type SideStatus = (typeof SIDE_STATUSES)[number];

export const LISTING_STATUSES = [...MAIN_STATUSES, ...SIDE_STATUSES] as const;
export type ListingStatus = MainStatus | SideStatus;

export function isListingStatus(value: string): value is ListingStatus {
  return (LISTING_STATUSES as readonly string[]).includes(value);
}

export function isSideStatus(value: ListingStatus): value is SideStatus {
  return (SIDE_STATUSES as readonly string[]).includes(value);
}

/** Estados que la vidriera pública puede mostrar. El resto no existe para el comprador. */
export const PUBLIC_STATUSES = ['available', 'reserved', 'sold'] as const;
export type PublicStatus = (typeof PUBLIC_STATUSES)[number];

export function isPublicStatus(value: ListingStatus): value is PublicStatus {
  return (PUBLIC_STATUSES as readonly string[]).includes(value);
}

/** `unit` = un equipo con IMEI. `lot` = N intercambiables (accesorios), con `qty`. */
export const LISTING_KINDS = ['unit', 'lot'] as const;
export type ListingKind = (typeof LISTING_KINDS)[number];

/** Etiqueta de UI (español rioplatense) de la condición. Panel y ficha usan ésta. */
const CONDITION_LABELS: Readonly<Record<Condition, string>> = {
  sealed: 'sellado',
  open_box: 'open box',
  tester_a_plus: 'tester A+',
  used_excellent: 'usado excelente',
  used_with_detail: 'usado con detalle',
};

export function conditionLabel(condition: Condition): string {
  return CONDITION_LABELS[condition];
}

/**
 * Etiqueta **corta** para el mensaje de WhatsApp.
 * Distinta a propósito: el string canónico de `CLAUDE.md` §1 dice `(usado A)`, no
 * `(usado excelente)`. El mensaje de WA es un contrato byte a byte, no una etiqueta de UI.
 */
const WA_CONDITION_LABELS: Readonly<Record<Condition, string>> = {
  sealed: 'sellado',
  open_box: 'open box',
  tester_a_plus: 'tester A+',
  used_excellent: 'usado A',
  used_with_detail: 'usado con detalle',
};

export function waConditionLabel(condition: Condition): string {
  return WA_CONDITION_LABELS[condition];
}
