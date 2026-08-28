/**
 * Texto que escribe una persona en el mostrador → **enteros de centavos**.
 *
 * `@istock/domain` es taxativo: *"Plata en enteros de centavos. Nunca `float`"*. Este módulo es
 * el único lugar del panel donde un string se convierte en plata, y lo hace **por string**, sin
 * pasar por `Number` en coma flotante en ningún momento intermedio.
 *
 * ## Por qué no se aceptan separadores de miles
 * `1.200` es mil doscientos para el dueño y uno con dos para `parseFloat`. `1,200` es lo mismo al
 * revés. No hay heurística que acierte siempre, y equivocarse acá publica un iPhone a USD 1,20.
 * Se acepta **un solo** separador decimal (`.` o `,`) con 1–2 dígitos atrás, y nada más; el
 * formulario lo dice con todas las letras y el `<input type="number">` empuja al teclado numérico.
 *
 * Sólo parsea. **Formatear es de `@istock/domain`** (`formatUsd`, `formatAmount`): el skill
 * `wa-payload` exige que el precio de la pantalla y el del mensaje de WhatsApp salgan de la misma
 * función, así que tener un formateador propio acá sería sembrar la discrepancia.
 *
 * Es puro y sin I/O a propósito: tiene test propio y no necesita base ni request.
 */

/** Hasta 9 dígitos enteros: `numeric(12, 2)` de `packages/db` no da para más. */
const MONEY_RE = /^(\d{1,9})(?:[.,](\d{1,2}))?$/u;

export type ParsedMoney =
  | { readonly ok: true; readonly cents: number }
  | { readonly ok: false; readonly reason: string };

/**
 * `"620"` → `62000` · `"620,50"` → `62050` · `"620.5"` → `62050`.
 * `"1.200"` → error, y es la respuesta correcta: ver arriba.
 */
export function parseUsdToCents(raw: string): ParsedMoney {
  const value = raw.trim().replace(/\s+/gu, '');
  if (value === '') return { ok: false, reason: 'Poné el precio en dólares.' };

  const match = MONEY_RE.exec(value);
  if (match === null) {
    return {
      ok: false,
      reason: 'Escribí sólo números, sin puntos de miles. Ejemplo: 620 o 620,50.',
    };
  }

  const whole = match[1] ?? '0';
  const frac = (match[2] ?? '').padEnd(2, '0');
  const cents = Number(whole) * 100 + Number(frac);

  if (!Number.isSafeInteger(cents)) {
    return { ok: false, reason: 'Ese número es demasiado grande.' };
  }
  return { ok: true, cents };
}
