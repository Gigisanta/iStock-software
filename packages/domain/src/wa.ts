/**
 * Botón de WhatsApp — skill `wa-payload`.
 *
 * "El botón de WhatsApp **es el producto**. Un texto mal armado rompe el único momento que factura."
 *
 * Texto canónico (`CLAUDE.md` §1):
 * ```
 * Hola, vi el iPhone 14 Pro 256 Grafito (usado A) a USD 620 en nortecel.maat.work y lo quiero.
 * ```
 * Plantilla:
 * ```
 * Hola, vi el {modelo} {storage} {color} ({condición}) a USD {precio} en {slug}.maat.work y lo quiero.
 * ```
 *
 * Reglas que se cumplen acá y en ningún otro lado:
 * - **Un solo** `wa.me` por ficha. Nadie arma este texto a mano en un componente.
 * - Prohibido en el texto: IMEI, costo, margen, notas internas, proveedor. El input de esta función
 *   **no tiene** esos campos: la prohibición es de tipos, no de disciplina.
 * - El precio se formatea con `formatUsd`, la misma función que usa la pantalla. Discrepancia = bug.
 * - `reserved` cambia el copy: nunca prometemos disponibilidad que el DTO no respalda.
 */

import { DomainError } from './errors';
import { formatUsd } from './money';
import { assertSlug } from './slug';
import { waConditionLabel, type Condition, type PublicStatus } from './types';

export const STOREFRONT_DOMAIN = 'maat.work';

/** Lo mínimo (y lo único) que el mensaje puede conocer del listing. */
export interface WaListing {
  /** `iPhone 14 Pro` — nombre de display del `catalog_model`. */
  readonly modelDisplayName: string;
  /** `256`. `null` en lotes/accesorios sin almacenamiento. */
  readonly storageGb: number | null;
  /** `Grafito`. `null` si no aplica. */
  readonly color: string | null;
  readonly condition: Condition;
  readonly priceUsdCents: number;
  readonly status: PublicStatus;
}

/** `nortecel` → `nortecel.maat.work`. */
export function storefrontHost(slug: string): string {
  assertSlug(slug);
  return `${slug}.${STOREFRONT_DOMAIN}`;
}

export function storefrontUrl(slug: string): string {
  return `https://${storefrontHost(slug)}`;
}

/** `iPhone 14 Pro 256 Grafito (usado A)` — sin campos sensibles, por construcción. */
export function describeListing(listing: WaListing): string {
  const parts = [listing.modelDisplayName.trim()];
  if (listing.storageGb !== null) parts.push(String(listing.storageGb));
  if (listing.color !== null && listing.color.trim().length > 0) parts.push(listing.color.trim());
  return `${parts.join(' ')} (${waConditionLabel(listing.condition)})`;
}

/**
 * Texto exacto del mensaje. **Sin** URL-encoding: eso lo hace `buildWaUrl`.
 * El copy depende del estado público del listing.
 */
export function buildWaMessage(listing: WaListing, slug: string): string {
  const host = storefrontHost(slug);
  const what = describeListing(listing);
  const price = formatUsd(listing.priceUsdCents);

  switch (listing.status) {
    case 'available':
      return `Hola, vi el ${what} a ${price} en ${host} y lo quiero.`;
    case 'reserved':
      return `Hola, vi el ${what} a ${price} en ${host}. Dice que está reservado, ¿me avisás si se libera?`;
    case 'sold':
      return `Hola, vi el ${what} en ${host} y dice que está vendido. ¿Te queda alguno parecido?`;
    default: {
      const never: never = listing.status;
      throw new DomainError('LISTING_INVALID', `estado público desconocido: ${String(never)}`);
    }
  }
}

/**
 * Teléfono en E.164 **sin** `+` ni espacios: `5492994xxxxxx`.
 * Se valida al guardarlo (Zod, borde) y también acá: un link roto no se ve hasta que se pierde
 * la venta.
 */
export function normalizeWaPhone(input: string): string {
  const digits = input.replace(/[\s()+-]/gu, '');
  if (!/^[1-9]\d{7,14}$/u.test(digits)) {
    throw new DomainError(
      'WA_PHONE_INVALID',
      `teléfono inválido: "${input}" (E.164 sin "+", 8–15 dígitos, sin cero inicial)`,
    );
  }
  return digits;
}

/**
 * `https://wa.me/{phoneE164}?text={encoded}`.
 * `encodeURIComponent` sobre el texto completo: acentos y espacios sobreviven del lado de WhatsApp.
 */
export function buildWaUrl(listing: WaListing, slug: string, phone: string): string {
  const phoneE164 = normalizeWaPhone(phone);
  const text = buildWaMessage(listing, slug);
  return `https://wa.me/${phoneE164}?text=${encodeURIComponent(text)}`;
}
