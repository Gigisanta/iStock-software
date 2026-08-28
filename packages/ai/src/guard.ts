/**
 * Guard de salida: lo último que pasa antes de que un texto llegue al comprador.
 *
 * ## Por qué existe si ya está el prompt
 * Porque el prompt es una negociación y esto es un `if`. Las tres cosas que el guard atrapa son las
 * tres que más caro salen y que un modelo barato falla justo cuando el mensaje viene raro:
 *
 * 1. **Datos prohibidos** (`redaction.ts`): costo de compra, margen, identificador del equipo,
 *    notas internas, proveedor, y cualquier corrida de 14–17 dígitos.
 * 2. **Disponibilidad inventada**: si el DTO dice `reserved` o `sold`, ninguna oración puede
 *    afirmar disponibilidad. Es E8 del `TEST_MATRIX.md` y el caso que el encargo nombra aparte.
 * 3. **Precio inventado**: cualquier monto con moneda que no sea el del DTO. *"Te lo dejo a USD
 *    500"* sobre una ficha de USD 620 es una promesa que el vendedor tiene que honrar o desdecir.
 * 4. **Promesa de aviso**: *"te avisamos si se libera"*, *"quedás anotado"*. No existe lista de
 *    espera, la vidriera no guarda dato del visitante y no hay a quién avisar. Es la promesa que
 *    el producto entero acaba de sacar de la ficha y del mensaje de WhatsApp.
 *
 * ## Detectar sobre el crudo, devolver el saneado
 * La detección corre sobre el texto **tal como salió del modelo**; recién después se sanea para
 * mostrar. Al revés no funciona: `sanitizeDescription` reemplaza las corridas largas de dígitos por
 * `[filtrado]`, así que sanear primero borraría la evidencia y el guard quedaría verde por vacío.
 *
 * Un veredicto `ok: false` **no se corrige**: se descarta la respuesta y se deriva a WhatsApp.
 * No se le pide al modelo que reescriba (otro turno, otro costo, otra chance de fallar).
 */

import { sanitizeDescription, type PublicListingDTO } from '@istock/domain';
import { MAX_OUTPUT_TOKENS } from './budget';
import { detectForbiddenOutput } from './redaction';
import { truncateToTokens } from './tokens';

export const GUARD_VIOLATIONS = [
  'FORBIDDEN_TERM',
  'AVAILABILITY_CLAIM',
  'PRICE_NOT_IN_DTO',
  'PROMISED_FOLLOW_UP',
  'EMPTY_ANSWER',
  'REDACTED_CONTENT',
] as const;
export type GuardViolation = (typeof GUARD_VIOLATIONS)[number];

export interface GuardVerdict {
  readonly ok: boolean;
  /** Motivos, sin el texto ofensivo adentro: esto se loguea. */
  readonly violations: readonly string[];
  /** Texto plano listo para mostrar. Sólo se usa si `ok`. */
  readonly text: string;
  /** `true` si hubo que recortar por el techo de salida. No es una violación. */
  readonly truncated: boolean;
}

/** Afirmaciones de disponibilidad. Se buscan por oración, no en el texto entero. */
const AVAILABILITY_CLAIM =
  /\b(disponible|libre|en\s+stock|lo\s+ten[eé]s|te\s+lo\s+llev[aá]s|est[aá]\s+a\s+la\s+venta|queda\s+uno|hay\s+stock)\b/iu;
/** Lo que convierte esa afirmación en negación o en aclaración honesta. */
const NEGATION = /\b(no|ya\s+no|todav[ií]a\s+no|nunca|sin)\b|reservad|vendid|se\s+libera/iu;

/**
 * Promesas de contacto futuro **nuestro**. No existe el mecanismo: no hay lista de espera, no se
 * guarda dato del visitante y la vidriera no tiene DB propia.
 *
 * ## Por qué está anclado a "te/le/les" y no a la palabra "avisar"
 * *"Avisale al vendedor que te interesa"* es la respuesta correcta y usa el mismo verbo. Lo que se
 * prohíbe no es hablar de avisos: es **comprometer un aviso hacia el visitante**.
 *
 * ## Dos cosas que a propósito NO caen acá
 * - *"no hay lista de espera"* — es lo que dice la ficha, palabra por palabra. Si el guard la
 *   frenara, el chatbot no podría repetir la verdad del producto, que es lo contrario del objetivo.
 *   Por eso el patrón pide la forma afirmativa (`quedás anotado`, `te anoto`) y no el sustantivo.
 * - *"el vendedor te confirma por WhatsApp"* — el vendedor sí existe y sí contesta; ese es el
 *   producto. La promesa vacía es la nuestra.
 *
 * El falso positivo que sí acepto: *"pedile al vendedor que te avise"*. Cae, y el resultado es un
 * handoff a WhatsApp — exactamente adonde apunta la respuesta honesta. Un falso positivo cuyo
 * castigo es mandar al comprador al lugar correcto es un precio que se paga sin discutir.
 */
const PROMISED_FOLLOW_UP =
  /(?<![\p{L}\p{N}])(?:(?:te|les?|los)\s+(?:av[ií]s\p{L}*|escrib\p{L}*|contact\p{L}*)|qued[aá]s\s+(?:anotad\p{L}*|en\s+(?:la\s+)?lista)|te\s+(?:anoto|anotamos|apunto|apuntamos|sumo|sumamos))(?![\p{L}\p{N}])/iu;

/** Montos con moneda explícita. Un número suelto puede ser GB, batería o un año. */
const CURRENCY_AMOUNT = /(?:USD|U\$S|US\$|\$)\s*([\d][\d.,]*)|([\d][\d.,]*)\s*(?:d[oó]lares|pesos)/giu;
/**
 * Montos **sin** moneda, pero en una frase que ofrece un precio: *"te lo dejo en 590"*.
 *
 * Existe porque el patrón de arriba no lo veía y el caso no es hipotético: la forma natural de
 * regatear en el Alto Valle es decir el número pelado después del precio de lista, y una promesa de
 * descuento que el DTO no dice es exactamente lo que `CLAUDE.md` §Prohibido en la salida prohíbe.
 * Va anclado a los verbos de oferta y no a cualquier preposición: *"por 30 días de garantía"* es
 * una respuesta correcta y no puede caer acá.
 */
const OFFER_AMOUNT = /\b(?:te\s+l[oa]\s+(?:dejo|hago|paso)|l[oa]\s+dejo|te\s+lo\s+vendo)\s+(?:en|a|por)\s+([\d][\d.,]*)/giu;

function digitsOnly(value: string): string {
  return value.replace(/\D/gu, '');
}

function sentences(text: string): readonly string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function hasUnqualifiedAvailabilityClaim(text: string): boolean {
  return sentences(text).some((sentence) => AVAILABILITY_CLAIM.test(sentence) && !NEGATION.test(sentence));
}

function quotesForeignPrice(text: string, listing: PublicListingDTO): boolean {
  const allowed = new Set([digitsOnly(listing.priceUsd.formatted), digitsOnly(listing.priceArs.formatted)]);
  for (const pattern of [CURRENCY_AMOUNT, OFFER_AMOUNT]) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[1] ?? match[2];
      if (raw === undefined) continue;
      const amount = digitsOnly(raw);
      if (amount.length === 0) continue;
      if (!allowed.has(amount)) return true;
    }
  }
  return false;
}

/**
 * Juzga la respuesta del modelo contra el DTO.
 *
 * `maxOutputTokens` recorta, no reprueba: una respuesta larga es un problema de costo, no de
 * seguridad, y el comprador prefiere dos oraciones a un handoff.
 */
export function guardAnswer(
  raw: string,
  listing: PublicListingDTO,
  maxOutputTokens: number = MAX_OUTPUT_TOKENS,
): GuardVerdict {
  const violations: GuardViolation[] = [];

  if (raw.trim().length === 0) {
    return { ok: false, violations: ['EMPTY_ANSWER'], text: '', truncated: false };
  }

  for (const tag of detectForbiddenOutput(raw)) violations.push(`FORBIDDEN_TERM:${tag}` as GuardViolation);
  if (listing.status !== 'available' && hasUnqualifiedAvailabilityClaim(raw)) violations.push('AVAILABILITY_CLAIM');
  if (quotesForeignPrice(raw, listing)) violations.push('PRICE_NOT_IN_DTO');
  if (PROMISED_FOLLOW_UP.test(raw)) violations.push('PROMISED_FOLLOW_UP');

  // Sin URLs, sin markdown, sin Unicode invisible: la salida se renderiza como texto plano.
  const clean = sanitizeDescription(raw, { maxLength: 2000 });
  // Si después de sanear quedó un `[filtrado]`, el modelo estaba repitiendo algo que la
  // sanitización tuvo que neutralizar (un link, un token de chat template, una corrida de dígitos).
  // Mostrar un `[filtrado]` a un comprador es peor que derivarlo.
  if (clean.includes('[filtrado]')) violations.push('REDACTED_CONTENT');

  const text = truncateToTokens(clean, maxOutputTokens);
  return {
    ok: violations.length === 0,
    violations,
    text,
    truncated: text.length < clean.length,
  };
}
