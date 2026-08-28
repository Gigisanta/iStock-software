/**
 * El tipo de cambio que escribe el dueño → **centavos de ARS por USD**.
 *
 * Hermano de `_lib/listings/parse-money.ts` y por las mismas razones: plata en enteros de
 * centavos, conversión por string, cero `parseFloat`. Lo que cambia es qué se está parseando —
 * acá no es un precio sino el multiplicador de **todos** los precios del negocio, así que un
 * error de una coma no publica un equipo mal: publica el catálogo entero mal.
 *
 * ## Por qué existe este archivo y no un `z.coerce.number()`
 * `CLAUDE.md` §1: *"el TC lo setea el DUEÑO, manualmente, por tenant. No hay API de dólar en el
 * hot path."* O sea que este string es la única fuente del TC que existe en el producto. El
 * parseo real lo hace `fxRateFromDecimal()` de `@istock/domain` (que ya sabe rechazar floats de
 * JS y más de dos decimales); este módulo sólo agrega lo que el dominio no puede dar: mensajes
 * de mostrador en castellano y las dos guardas de tipeo de abajo.
 *
 * ## Guarda 1 · sin separadores de miles
 * `1.487` es mil cuatrocientos ochenta y siete para el dueño y "uno con cuarenta y ocho" para
 * cualquier parser. No hay heurística que acierte siempre. Se acepta **un solo** separador
 * decimal con 1–2 dígitos atrás, y nada más; el formulario lo dice con todas las letras.
 *
 * ## Guarda 2 · piso de plausibilidad
 * `MIN_ARS_PER_USD` **no es una política de FX** —el TC lo pone el dueño y nosotros no opinamos
 * del número— sino un detector de tipeo: no existe un dólar a menos de $100, así que un valor
 * abajo de ese piso es siempre un `1.48` que quiso ser `1487`. Sin el piso, ese error se publica
 * como un iPhone a "$ 1.000" en la ficha y el dueño se entera por WhatsApp.
 * Es una constante y se mueve sola el día que haga falta.
 */

import { fxRateFromDecimal } from '@istock/domain';

/** Hasta 7 dígitos enteros. Un TC de 8 cifras es un tipeo, no una hiperinflación nueva. */
const FX_RE = /^(\d{1,7})(?:[.,]\d{1,2})?$/u;

/** Piso de tipeo, no de mercado. Ver el encabezado. */
export const MIN_ARS_PER_USD = 100;

const FORMAT_REASON = 'Escribí sólo números, sin puntos de miles. Ejemplo: 1487 o 1487,50.';

export type ParsedFxRate =
  | { readonly ok: true; readonly arsCentsPerUsd: number }
  | { readonly ok: false; readonly reason: string };

/** `"1487"` → `148700` · `"1487,50"` → `148750` · `"1.487"` → error (ver guarda 1). */
export function parseFxArsPerUsd(raw: string): ParsedFxRate {
  const value = raw.trim().replace(/\s+/gu, '');
  if (value === '') return { ok: false, reason: 'Poné a cuánto tomás el dólar.' };
  if (!FX_RE.test(value)) return { ok: false, reason: FORMAT_REASON };

  let arsCentsPerUsd: number;
  try {
    arsCentsPerUsd = fxRateFromDecimal(value).arsCentsPerUsd;
  } catch {
    // El dominio ya rechazó la forma. Nunca se muestra su mensaje: cita el input crudo.
    return { ok: false, reason: FORMAT_REASON };
  }

  if (arsCentsPerUsd < MIN_ARS_PER_USD * 100) {
    return {
      ok: false,
      reason: 'Ese dólar parece un error de tipeo. Escribí los pesos sin puntos de miles: 1487, no 1.487.',
    };
  }

  return { ok: true, arsCentsPerUsd };
}
