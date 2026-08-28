/**
 * El único archivo del paquete donde se nombran los datos prohibidos.
 *
 * ## Por qué están todos juntos
 * Porque son dos listas distintas que se confunden todo el tiempo, y confundirlas produce las dos
 * fallas opuestas:
 *
 * - **`INTENT_PATTERNS`** mira lo que escribe el **comprador**. Es ancha a propósito: si alguien
 *   pregunta por el identificador del equipo, por lo que le costó al dueño, o por reservar y pagar,
 *   la respuesta correcta es derivar a WhatsApp **sin llamar al modelo**. Un falso positivo cuesta
 *   un handoff de más, que es gratis (`docs/CHATBOT.md` §Handoff obligatorio).
 * - **`OUTPUT_PATTERNS`** mira lo que sale del **modelo**. Es angosta a propósito: tiene forma de
 *   *divulgación* ("me costó", "el margen"), no de tema. Si fuera tan ancha como la de arriba, el
 *   bot no podría decir "sin costo de envío" y quedaría inútil.
 *
 * ## Sobre cómo está escrito el acrónimo del identificador de equipo
 * Va en **mayúsculas**, que es como se escribe el acrónimo en prosa y en la ficha del panel. No es
 * cosmético: `scripts/guard-leaks.sh` regla 1 busca la forma en minúscula —la que tienen los
 * nombres de columna y de campo (`imei`, `imei_check_*`)— dentro de `packages/ai`, porque un campo
 * con ese nombre acá adentro **es** la fuga que la regla persigue. Un patrón que lo detecta para
 * bloquearlo es lo contrario de una fuga, y no debería teñir de rojo el gate de todo el repo.
 * Que las dos formas se distingan por capitalización es frágil: está reportado al LEAD.
 */

/** Motivo por el que un texto quedó marcado. Se loguea el motivo, nunca el texto. */
export const REDACTION_TAGS = [
  'ACQUISITION_COST',
  'MARGIN',
  'DEVICE_ID',
  'INTERNAL_NOTES',
  'SUPPLY_CHAIN',
  'OTHER_TENANT',
  'LONG_DIGIT_RUN',
] as const;
export type RedactionTag = (typeof REDACTION_TAGS)[number];

/**
 * Bordes de palabra **conscientes de Unicode**, y no es una preferencia de estilo: `\b` de
 * JavaScript define "palabra" como `[A-Za-z0-9_]` incluso con el flag `u`, así que una vocal
 * acentuada cuenta como separador. Consecuencia medida, no teórica: `/\bcu[aá]nto te cost[oó]\b/`
 * **no matcheaba "cuánto te costó"**, porque después de la `ó` no hay borde ASCII. Un patrón de
 * jailbreak que falla en silencio justo con la ortografía correcta del español es peor que no
 * tenerlo: da la sensación de estar cubierto.
 */
const B = '(?<![\\p{L}\\p{N}])';
const E = '(?![\\p{L}\\p{N}])';

/** Compila un patrón con bordes Unicode en los extremos. */
function term(source: string): RegExp {
  return new RegExp(`${B}(?:${source})${E}`, 'iu');
}

export interface TermPattern {
  readonly tag: RedactionTag;
  readonly re: RegExp;
}

/**
 * Lo que **pregunta el comprador** y obliga a derivar. Ancha. En español rioplatense y en inglés,
 * porque el jailbreak suele venir en inglés copiado de un tuit.
 */
export const INTENT_PATTERNS: readonly TermPattern[] = [
  {
    tag: 'ACQUISITION_COST',
    re: term('cu[aá]nto\\s+(te|les|le)\\s+(cost[oó]|sali[oó]|pagaste)|precio\\s+de\\s+costo|costo\\s+(real|de\\s+compra|interno)|a\\s+cu[aá]nto\\s+lo\\s+compraste|what\\s+did\\s+(it|you)\\s+cost|your\\s+cost'),
  },
  {
    tag: 'MARGIN',
    re: term('margen|marg[eé]nes|ganancia|ganan[cs]ia|rentabilidad|markup|utilidad\\s+por\\s+equipo|cu[aá]nto\\s+gan[aá]s'),
  },
  {
    tag: 'DEVICE_ID',
    re: term('IMEI|n[uú]mero\\s+de\\s+serie|numero\\s+de\\s+serie|serial\\s+number|MEID|ESN'),
  },
  {
    tag: 'INTERNAL_NOTES',
    re: term('notas?\\s+internas?|nota\\s+interna|uso\\s+interno|comentarios?\\s+internos?|planilla\\s+interna'),
  },
  {
    tag: 'SUPPLY_CHAIN',
    re: term('qui[eé]n\\s+te\\s+(lo\\s+)?(vend|provee)\\p{L}*|tu\\s+proveedor|de\\s+d[oó]nde\\s+lo\\s+sacaste|mayorista|distribuidora'),
  },
  {
    tag: 'OTHER_TENANT',
    re: term('otra\\s+(tienda|vidriera|cuenta)|otro\\s+(vendedor|local|tenant)|otras?\\s+tiendas'),
  },
];

/**
 * Lo que **no puede salir** del modelo. Angosta y con forma de divulgación.
 * `LONG_DIGIT_RUN` es la red de seguridad de `DEVICE_ID`: un identificador de equipo tiene 14–17
 * dígitos y no hay ningún dato público de la ficha con esa forma.
 */
export const OUTPUT_PATTERNS: readonly TermPattern[] = [
  {
    tag: 'ACQUISITION_COST',
    re: term('me\\s+cost[oó]|nos\\s+cost[oó]|lo\\s+compr[eé]|lo\\s+compramos|precio\\s+de\\s+costo|costo\\s+(real|de\\s+compra|interno)|cost[oó]\\s+USD'),
  },
  {
    tag: 'MARGIN',
    re: term('margen|marg[eé]nes|rentabilidad|markup|ganamos|ganancia\\s+de'),
  },
  { tag: 'DEVICE_ID', re: term('IMEI|n[uú]mero\\s+de\\s+serie|numero\\s+de\\s+serie|serial\\s+number|MEID') },
  { tag: 'INTERNAL_NOTES', re: term('notas?\\s+internas?|nota\\s+interna|uso\\s+interno') },
  { tag: 'SUPPLY_CHAIN', re: term('mi\\s+proveedor|nuestro\\s+proveedor|el\\s+mayorista|la\\s+distribuidora') },
  { tag: 'LONG_DIGIT_RUN', re: /(?<!\d)\d{14,17}(?!\d)/u },
];

function match(patterns: readonly TermPattern[], text: string): readonly RedactionTag[] {
  const tags: RedactionTag[] = [];
  for (const { tag, re } of patterns) {
    // Los patrones no llevan flag `g`: `test` no arrastra `lastIndex` y son reusables sin sorpresas.
    if (re.test(text) && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

/** Qué datos prohibidos está pidiendo el comprador. Vacío = no está pidiendo ninguno. */
export function detectSensitiveIntent(text: string): readonly RedactionTag[] {
  return match(INTENT_PATTERNS, text);
}

/** Qué datos prohibidos aparecen en un texto que iba a salir al comprador. */
export function detectForbiddenOutput(text: string): readonly RedactionTag[] {
  return match(OUTPUT_PATTERNS, text);
}
