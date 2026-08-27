/**
 * FX — USD → ARS con el tipo de cambio que pone **el dueño**, por tenant.
 *
 * No hay API de dólar en el hot path (CLAUDE.md §1). El TC entra SIEMPRE por parámetro.
 *
 * ## Representación
 * El TC se guarda como **entero**: centavos de ARS por 1 USD (`arsCentsPerUsd`).
 * TC 1487,50 → `148750`. Nunca un `float`: `0.1 + 0.2` no es plata.
 *
 * ## Regla de redondeo (DOMAIN.md §FX)
 * Default `ceil_1000`: **se redondea hacia arriba al múltiplo de $1.000 más cercano**, porque así
 * es como el reseller publica en la práctica (nadie publica "$ 868.437,50" en un estado de IG).
 * Hacia arriba y no al más cercano para no publicar nunca **menos** ARS de los que sale el equipo.
 * El ARS es informativo: la operación se cierra por WhatsApp, y la ficha lo dice.
 *
 * Modos disponibles, todos testeados:
 * | modo | qué hace | ejemplo (exacto 868.437,50) |
 * |---|---|---|
 * | `exact` | redondeo half-up al centavo | `868.437,50` |
 * | `ceil_100` | techo al peso entero | `868.438` |
 * | `nearest_1000` | half-up al millar | `868.000` |
 * | `ceil_1000` (default) | techo al millar | `869.000` |
 */

import { DomainError } from './errors';
import { assertNonNegativeCents, type Cents } from './money';

export interface FxRate {
  /** Centavos de ARS por 1 USD. Entero positivo. */
  readonly arsCentsPerUsd: number;
}

export type FxRoundingMode = 'exact' | 'ceil_100' | 'nearest_1000' | 'ceil_1000';

export const DEFAULT_FX_ROUNDING: FxRoundingMode = 'ceil_1000';

const CENTS_PER_ARS = 100n;
const CENTS_PER_1000_ARS = 100_000n;

/**
 * Construye un `FxRate` desde lo que tipeó el dueño.
 * Acepta `"1487.50"`, `"1487,50"`, `"1487"` o el entero `1487` (pesos enteros).
 * Rechaza floats de JS y más de 2 decimales: truncar plata en silencio es un bug de negocio.
 */
export function fxRateFromDecimal(input: string | number): FxRate {
  if (typeof input === 'number') {
    if (!Number.isSafeInteger(input)) {
      throw new DomainError(
        'FX_RATE_INVALID',
        'un TC numérico debe ser un entero de pesos; para decimales usá el string ("1487.50")',
      );
    }
    return fxRateFromArsCents(input * 100);
  }
  const raw = input.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
    throw new DomainError('FX_RATE_INVALID', `TC inválido: "${input}" (formato esperado: 1487 o 1487.50)`);
  }
  const [whole = '0', frac = ''] = raw.split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return fxRateFromArsCents(cents);
}

/** Constructor directo desde centavos de ARS por USD (lo que guarda `fx_settings`). */
export function fxRateFromArsCents(arsCentsPerUsd: number): FxRate {
  if (!Number.isSafeInteger(arsCentsPerUsd)) {
    throw new DomainError('FX_RATE_INVALID', `TC inválido: ${String(arsCentsPerUsd)} no es un entero seguro`);
  }
  if (arsCentsPerUsd <= 0) {
    throw new DomainError('FX_RATE_INVALID', `TC inválido: ${String(arsCentsPerUsd)}. Debe ser > 0`);
  }
  return { arsCentsPerUsd };
}

/** `148750` → `"1487.50"`. Para mostrar qué TC se usó en la ficha (`fxRateUsed`). */
export function fxRateToDecimalString(rate: FxRate): string {
  const whole = Math.trunc(rate.arsCentsPerUsd / 100);
  const frac = rate.arsCentsPerUsd % 100;
  return `${String(whole)}.${String(frac).padStart(2, '0')}`;
}

function roundBigInt(exactArsCents: bigint, mode: FxRoundingMode): bigint {
  switch (mode) {
    case 'exact':
      return exactArsCents;
    case 'ceil_100':
      return ceilTo(exactArsCents, CENTS_PER_ARS);
    case 'nearest_1000':
      return nearestTo(exactArsCents, CENTS_PER_1000_ARS);
    case 'ceil_1000':
      return ceilTo(exactArsCents, CENTS_PER_1000_ARS);
    default: {
      const never: never = mode;
      throw new DomainError('FX_RATE_INVALID', `modo de redondeo desconocido: ${String(never)}`);
    }
  }
}

function ceilTo(value: bigint, step: bigint): bigint {
  const rem = value % step;
  return rem === 0n ? value : value + (step - rem);
}

function nearestTo(value: bigint, step: bigint): bigint {
  const rem = value % step;
  if (rem === 0n) return value;
  // half-up
  return rem * 2n >= step ? value + (step - rem) : value - rem;
}

/**
 * `applyFx(usdCents, rate, mode?)` → centavos de ARS.
 *
 * Puro y entero de punta a punta: el producto intermedio se hace en `bigint` para que un TC
 * de 7 cifras por un precio de 5 cifras no pierda un centavo por precisión de `double`.
 */
export function applyFx(usdCents: Cents, rate: FxRate, mode: FxRoundingMode = DEFAULT_FX_ROUNDING): Cents {
  assertNonNegativeCents(usdCents, 'precio USD');
  if (!Number.isSafeInteger(rate.arsCentsPerUsd) || rate.arsCentsPerUsd <= 0) {
    throw new DomainError('FX_RATE_INVALID', `TC inválido: ${String(rate.arsCentsPerUsd)}. Debe ser > 0`);
  }

  // usdCents [cUSD] / 100 [USD] * arsCentsPerUsd [cARS/USD] = arsCents [cARS]
  const product = BigInt(usdCents) * BigInt(rate.arsCentsPerUsd);
  const exact = halfUpDiv(product, 100n);
  const rounded = roundBigInt(exact, mode);

  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new DomainError('MONEY_INVALID', 'el precio en ARS excede el rango seguro de enteros');
  }
  return Number(rounded);
}

function halfUpDiv(value: bigint, divisor: bigint): bigint {
  const q = value / divisor;
  const rem = value % divisor;
  return rem * 2n >= divisor ? q + 1n : q;
}
