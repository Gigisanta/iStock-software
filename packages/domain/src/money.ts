/**
 * Plata = enteros. Nunca `float`.
 *
 * Toda cantidad monetaria del dominio viaja como **centavos enteros** (`number` entero,
 * seguro hasta 2^53-1 ≈ USD 90.000.000.000). Los cálculos que pueden desbordar precisión
 * (multiplicar precio por tipo de cambio) se hacen con `bigint` en `fx.ts`.
 *
 * Formato de salida: convención rioplatense — `.` como separador de miles y `,` como decimal.
 * Se implementa a mano (sin `Intl`) para que el string sea **determinista** en cualquier runtime:
 * ICU cambia entre versiones de Node y este texto termina, byte a byte, dentro de un mensaje
 * de WhatsApp que se testea exactamente.
 */

import { DomainError } from './errors';

/** Centavos enteros. 62000 === USD 620,00 */
export type Cents = number;

export const CENTS_PER_UNIT = 100;

export function assertCents(value: number, label: string): asserts value is Cents {
  if (!Number.isInteger(value)) {
    throw new DomainError('MONEY_INVALID', `${label} debe ser un entero de centavos, recibí: ${String(value)}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new DomainError('MONEY_INVALID', `${label} está fuera del rango seguro de enteros`);
  }
}

export function assertNonNegativeCents(value: number, label: string): asserts value is Cents {
  assertCents(value, label);
  if (value < 0) {
    throw new DomainError('MONEY_INVALID', `${label} no puede ser negativo, recibí: ${String(value)}`);
  }
}

function groupThousands(digits: string): string {
  const chars = [...digits];
  let out = '';
  chars.forEach((char, index) => {
    const fromEnd = chars.length - index;
    out += char;
    if (fromEnd > 1 && (fromEnd - 1) % 3 === 0) out += '.';
  });
  return out;
}

/**
 * Formatea centavos como monto rioplatense.
 * - Si los centavos son 0 → sin parte decimal (`620`, `1.200`).
 * - Si no → dos decimales con coma (`620,50`).
 *
 * Regla dura del skill `wa-payload`: el precio del mensaje de WhatsApp se formatea con
 * ESTA función, la misma que usa la pantalla. Discrepancia = bug.
 */
export function formatAmount(cents: Cents): string {
  assertCents(cents, 'monto');
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / CENTS_PER_UNIT);
  const frac = abs % CENTS_PER_UNIT;
  const wholeText = groupThousands(String(whole));
  const body = frac === 0 ? wholeText : `${wholeText},${String(frac).padStart(2, '0')}`;
  return negative ? `-${body}` : body;
}

/** `USD 620` — el prefijo va separado por un espacio simple, igual que en la ficha. */
export function formatUsd(cents: Cents): string {
  return `USD ${formatAmount(cents)}`;
}

/** `$ 868.000` — el ARS es informativo (la operación se cierra por WhatsApp). */
export function formatArs(cents: Cents): string {
  return `$ ${formatAmount(cents)}`;
}
