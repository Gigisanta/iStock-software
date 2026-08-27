/**
 * Sanitización del texto libre del **dueño** (descripción del listing).
 *
 * Límite de confianza (ARCHITECTURE.md §"Límites de confianza"): `dueño (texto libre) → prompt del
 * LLM` sólo cruza **sanitizado y delimitado**. El dueño es nuestro cliente, pero no es una fuente
 * confiable: su cuenta se puede comprometer, y su descripción termina dentro del prompt de un
 * chatbot que atiende compradores anónimos.
 *
 * Qué hace, en orden:
 * 1. **NFKC** — mata homóglifos y formas de ancho completo.
 * 2. **Unicode invisible** — zero-width, bidi overrides, tag chars (U+E0000+), BOM, selectores de
 *    variación. Es el vector clásico de prompt injection invisible en pantalla.
 * 3. **Controles** — todo C0/C1 salvo el salto de línea y el tab.
 * 4. **Markup** — tags HTML/XML, backticks y fences. La salida del chatbot se renderiza como texto
 *    plano: sin markdown, sin imágenes, sin links.
 * 5. **URLs** — el dueño no publica links desde la descripción (ni el chatbot los repite).
 * 6. **Marcadores de rol y frases imperativas** — `system:`, tokens de chat template, "ignorá las
 *    instrucciones anteriores", etc. → se reemplazan por `[filtrado]`.
 * 7. **Números de 14–17 dígitos** — un IMEI tipeado a mano en la descripción no llega ni a la
 *    vidriera ni al chatbot (CLAUDE.md §1, regla 8).
 * 8. Colapso de espacios y **corte por longitud**.
 *
 * NO es un antivirus semántico: es una reducción de superficie. La defensa real es que el chatbot
 * no tiene tools de escritura y que el `tenant_id` no es argumento de ninguna tool.
 */

export interface SanitizeOptions {
  /** Máximo de caracteres del resultado. Default 1200. */
  readonly maxLength?: number;
  /** Reemplazo de los fragmentos neutralizados. Default `[filtrado]`. */
  readonly redaction?: string;
  /** Quitar URLs. Default `true`. */
  readonly stripUrls?: boolean;
}

export const DEFAULT_MAX_DESCRIPTION_LENGTH = 1200;
/** Dieta del chatbot: ≤1200 tokens de entrada por turno (CHATBOT.md). */
export const PROMPT_MAX_DESCRIPTION_LENGTH = 600;
export const DEFAULT_REDACTION = '[filtrado]';

/** Zero-width, joiners, bidi, BOM, soft hyphen, selectores de variación, tag chars. */
const INVISIBLE =
  /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFE00-\uFE0F\uFEFF]|[\u{E0000}-\u{E007F}]/gu;
/** C0/C1 salvo `\n` y `\t`. */
const CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu;
const HTML_TAG = /<\/?[a-z][^>]{0,200}>/giu;
const CHAT_TEMPLATE_TOKEN =
  /<\|[^|>]{0,64}\|>|\[\/?INST\]|\{\{[^}]{0,64}\}\}|#{2,}\s*(?:system|instruction|prompt)[^\n]*/giu;
const MARKDOWN_LINK = /\[([^\]]{0,120})\]\((?:[^)]{0,300})\)/gu;
const URL = /\b(?:https?:\/\/|www\.|wa\.me\/)\S+/giu;
const FENCE = /(?:```|~~~|`)/gu;
const ROLE_PREFIX =
  /^[ \t>*-]*(?:system|assistant|user|developer|human|ai|sistema|asistente|usuario)\s*:/gimu;
const LONG_DIGIT_RUN = /\b\d{14,17}\b/gu;

/** Frases imperativas típicas de inyección, en inglés y en español rioplatense. */
const INJECTION_PHRASES: readonly RegExp[] = [
  /ignor[aeáíoó]\w*\s+(?:todas?\s+)?(?:las?\s+|the\s+|any\s+|all\s+)?(?:previous\s+|anteriores?\s+|prior\s+)?(?:instruc\w+|indicaciones|rules|reglas|prompts?)[^\n.]*/giu,
  /olvid[aáeé]\w*\s+(?:todo|lo\s+anterior|las\s+instrucciones|tus\s+instrucciones)[^\n.]*/giu,
  /disregard\s+(?:all\s+|any\s+)?(?:previous|prior|above|the)[^\n.]*/giu,
  /(?:forget|override)\s+(?:all\s+|your\s+|the\s+)?(?:previous\s+)?(?:instructions?|rules?|prompt)[^\n.]*/giu,
  /(?:system|developer)\s*prompt[^\n.]*/giu,
  /prompt\s+(?:del\s+)?(?:sistema|system)[^\n.]*/giu,
  /(?:nuevas?\s+instrucciones|new\s+instructions?)[^\n.]*/giu,
  /(?:act[uú]a|actu[aá]|comport[aá]te|pretend|act)\s+(?:como|as)\s+(?:si\s+)?[^\n.]*/giu,
  /(?:sos|eres|you\s+are)\s+(?:ahora|now)\b[^\n.]*/giu,
  /(?:revel[aá]|mostr[aá]|decime|dec[ií]|dime|tell\s+me|show\s+me)\s+(?:tu|tus|el|la|your|the)\s+(?:prompt|system|instruc\w+|reglas|rules)[^\n.]*/giu,
  /(?:cu[aá]nto\s+(?:te\s+)?cost[oó]|costo\s+real|precio\s+de\s+costo|tu\s+margen|el\s+margen)[^\n.]*/giu,
  /(?:pasame|dame|env[ií]ame|send\s+me)\s+(?:el\s+)?imei[^\n.]*/giu,
];

function collapseWhitespace(text: string): string {
  return text
    .replace(/\r\n?/gu, '\n')
    .replace(/\t/gu, ' ')
    .split('\n')
    .map((line) => line.replace(/ {2,}/gu, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  const body = lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${body.trimEnd()}…`;
}

/**
 * Sanitiza la descripción escrita por el dueño. Pura, determinista, sin I/O.
 * Devuelve texto plano listo para renderizar en la ficha o para meter (delimitado) en un prompt.
 */
export function sanitizeDescription(text: string, options?: SanitizeOptions): string {
  const maxLength = options?.maxLength ?? DEFAULT_MAX_DESCRIPTION_LENGTH;
  const redaction = options?.redaction ?? DEFAULT_REDACTION;
  const stripUrls = options?.stripUrls ?? true;

  let out = text.normalize('NFKC');
  out = out.replace(INVISIBLE, '');
  out = out.replace(CONTROLS, ' ');
  out = out.replace(MARKDOWN_LINK, '$1');
  out = out.replace(HTML_TAG, ' ');
  out = out.replace(CHAT_TEMPLATE_TOKEN, redaction);
  out = out.replace(FENCE, '');
  if (stripUrls) out = out.replace(URL, redaction);
  out = out.replace(ROLE_PREFIX, redaction);
  for (const phrase of INJECTION_PHRASES) {
    out = out.replace(phrase, redaction);
  }
  out = out.replace(LONG_DIGIT_RUN, redaction);
  out = collapseWhitespace(out);
  return truncate(out, maxLength);
}

/** Delimitador de bloque no confiable. No es un secreto: es un marcador estructural. */
export const UNTRUSTED_OPEN = '<<<DESCRIPCION_NO_CONFIABLE>>>';
export const UNTRUSTED_CLOSE = '<<<FIN_DESCRIPCION_NO_CONFIABLE>>>';

/**
 * Sanitiza **y delimita** para el prompt del chatbot. El contenido nunca puede cerrar el bloque:
 * cualquier aparición del delimitador dentro del texto se neutraliza antes de envolver.
 */
export function sanitizeForPrompt(text: string, options?: SanitizeOptions): string {
  const maxLength = options?.maxLength ?? PROMPT_MAX_DESCRIPTION_LENGTH;
  const redaction = options?.redaction ?? DEFAULT_REDACTION;
  const stripUrls = options?.stripUrls ?? true;
  const clean = sanitizeDescription(text, { maxLength, redaction, stripUrls })
    .split(UNTRUSTED_OPEN)
    .join(redaction)
    .split(UNTRUSTED_CLOSE)
    .join(redaction);
  return `${UNTRUSTED_OPEN}\n${clean}\n${UNTRUSTED_CLOSE}`;
}
