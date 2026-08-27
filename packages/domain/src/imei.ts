/**
 * IMEI — validación **no bloqueante** (DECISIONS.md, ENACOM).
 *
 * "Luhn se calcula en `packages/domain` como warning NO bloqueante. Prohibido un `.refine(luhn)`
 * que impida el alta: existen equipos con IMEI mal grabado, y el dueño necesita poder cargarlos
 * justamente para marcarlos `blocked`/`invalid` y no venderlos. Un gate de alta que rechaza stock
 * es peor que un warning que el dueño ignora."
 *
 * Los 15 dígitos **sí** son bloqueantes (lo exige el propio form de ENACOM) y se validan con Zod en
 * el borde; acá se expone `hasFifteenDigits` para que ese borde use la misma regla.
 *
 * Este módulo NUNCA se usa en la vidriera ni en el contexto del chatbot: el IMEI vive en el panel.
 */

export interface ImeiCheck {
  /** 15 dígitos exactos. Regla bloqueante del alta (se aplica en el borde con Zod). */
  readonly hasFifteenDigits: boolean;
  /** Dígito verificador de Luhn correcto. Sólo informativo. */
  readonly luhnValid: boolean;
  /** Copy para el panel, en rioplatense. `null` si no hay nada que advertir. */
  readonly warning: string | null;
}

const DIGITS_ONLY = /^\d+$/u;

/** Luhn puro sobre un string de dígitos. `false` si hay algo que no sea dígito. */
export function luhnValid(digits: string): boolean {
  if (!DIGITS_ONLY.test(digits) || digits.length === 0) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    const char = digits.charAt(i);
    let value = Number(char);
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Chequeo completo. **Nunca** tira: devuelve un warning que el dueño puede ignorar.
 */
export function checkImei(input: string): ImeiCheck {
  const digits = input.replace(/[\s-]/gu, '');
  const hasFifteenDigits = DIGITS_ONLY.test(digits) && digits.length === 15;
  const isLuhnValid = hasFifteenDigits && luhnValid(digits);

  let warning: string | null = null;
  if (!hasFifteenDigits) {
    warning = 'El IMEI tiene que ser de 15 dígitos.';
  } else if (!isLuhnValid) {
    warning =
      'Este IMEI no pasa el dígito verificador. Puede estar mal tipeado o mal grabado en el equipo. Podés guardarlo igual y consultarlo en ENACOM.';
  }

  return { hasFifteenDigits, luhnValid: isLuhnValid, warning };
}
