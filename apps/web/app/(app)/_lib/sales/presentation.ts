import { PAYMENT_METHODS, type PaymentMethod } from './schema';

/**
 * Lo que la pantalla de venta necesita mostrar. Puro, sin I/O y sin `server-only`: lo calcula el
 * Server Component y viaja como props al `"use client"`, para que `@istock/domain` y este módulo
 * no entren al bundle del browser. Mismo criterio que `_lib/reservations/presentation.ts`.
 */

/** Etiqueta de mostrador de cada medio de pago. Código en inglés, texto en rioplatense. */
const PAYMENT_METHOD_LABEL: Readonly<Record<PaymentMethod, string>> = {
  cash_usd: 'Efectivo en dólares',
  cash_ars: 'Efectivo en pesos',
  transfer: 'Transferencia',
  usdt: 'USDT / cripto',
  card: 'Tarjeta',
  trade_in: 'Canje + diferencia',
  other: 'Otro',
};

export function paymentMethodLabel(method: PaymentMethod): string {
  return PAYMENT_METHOD_LABEL[method];
}

export interface PaymentMethodOption {
  readonly value: PaymentMethod;
  readonly label: string;
}

/** Los `<option>` del `<select>`, en el orden declarado en el schema. */
export const PAYMENT_METHOD_OPTIONS: readonly PaymentMethodOption[] = PAYMENT_METHODS.map(
  (value) => ({ value, label: paymentMethodLabel(value) }),
);

/**
 * El precio publicado, escrito como lo acepta el formulario de venta.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Por qué NO es `formatAmount()` de `@istock/domain`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Porque `formatAmount(120000)` es `"1.200"` —con separador de miles, que es como se lee un
 * precio— y `parseUsdToCents("1.200")` lo **rechaza** a propósito (`parse-money.ts`: "no hay
 * heurística que acierte siempre"). O sea: usar el formateador de pantalla como `defaultValue` de
 * este input deja el formulario precargado con un valor que el propio borde rechaza, y sólo para
 * los equipos de USD 1.000 para arriba — el caso que más se vende y el que más caro sale equivocar.
 *
 * Así que esto no es "otro formateador": es el **inverso exacto de `parseUsdToCents`**, y su test
 * lo afirma en esos términos (ida y vuelta), no comparando strings a ojo. Los centavos en `00` se
 * omiten porque escribir "620" es lo que hace una persona, y `parseUsdToCents` los completa.
 */
export function priceInputValue(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) return '';
  const whole = Math.trunc(cents / 100);
  const frac = cents % 100;
  return frac === 0 ? String(whole) : `${String(whole)},${String(frac).padStart(2, '0')}`;
}
