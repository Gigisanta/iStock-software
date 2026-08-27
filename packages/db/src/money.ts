/**
 * Plata en Postgres: `numeric(12, 2)`. **Nunca** `real`/`double`/`float`.
 * Plata en TypeScript: **entero de centavos** (`@istock/domain` §money).
 *
 * Las dos cosas son ciertas a la vez gracias a este `customType`: la columna es
 * `numeric(12, 2)` (lo que exige el contrato de `db-agent` §6 y lo que se ve en `psql`),
 * y el valor que ve el código es un entero de centavos (lo que exige `packages/domain`,
 * donde `0.1 + 0.2` no es plata).
 *
 * La conversión es **exacta**: se hace por string, sin pasar por `Number` en coma flotante.
 * `numeric` sale del driver de `postgres` como string ("620.00"), justamente para no perder
 * precisión: si acá hiciéramos `parseFloat` tiraríamos a la basura la única garantía que da
 * `numeric`.
 */

import { customType } from 'drizzle-orm/pg-core';

/** Máximo representable en `numeric(12, 2)`: 9.999.999.999,99 → en centavos. */
export const MONEY_MAX_CENTS = 999_999_999_999;

export class MoneyColumnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyColumnError';
  }
}

/** `"620.00"` → `62000`. Exacto, por string. Acepta negativos (margen puede ser negativo). */
export function decimalToCents(value: string): number {
  const raw = value.trim();
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(raw);
  if (match === null) {
    throw new MoneyColumnError(`valor monetario inválido desde Postgres: "${value}"`);
  }
  const [, sign = '', whole = '0', frac = ''] = match;
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) {
    throw new MoneyColumnError(`valor monetario fuera de rango seguro: "${value}"`);
  }
  return sign === '-' ? -cents : cents;
}

/** `62000` → `"620.00"`. Exacto, por string. */
export function centsToDecimal(cents: number): string {
  if (!Number.isSafeInteger(cents)) {
    throw new MoneyColumnError(`los centavos deben ser un entero seguro, recibí: ${String(cents)}`);
  }
  if (Math.abs(cents) > MONEY_MAX_CENTS) {
    throw new MoneyColumnError(`${String(cents)} centavos no entra en numeric(12, 2)`);
  }
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${String(Math.trunc(abs / 100))}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Columna de plata. SQL: `numeric(12, 2)`. TS: `number` de centavos.
 * Usar SIEMPRE ésta para precios, costos, montos y tipo de cambio.
 */
export const moneyCents = customType<{ data: number; driverData: string }>({
  dataType() {
    return 'numeric(12, 2)';
  },
  fromDriver(value: string): number {
    return decimalToCents(value);
  },
  toDriver(value: number): string {
    return centsToDecimal(value);
  },
});
