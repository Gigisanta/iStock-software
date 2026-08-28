/**
 * Contador de tokens del paquete.
 *
 * ## Por qué existe y por qué NO es un tokenizador
 * La dieta (`docs/CHATBOT.md`) es **1200 in / 180 out**, y `CLAUDE.md` §0 dice que es una
 * aserción **medida, no estimada**. Medir con el tokenizador exacto de cada proveedor obligaría a
 * una dependencia por proveedor (y a bajar un vocabulario de decenas de MB) para un número que
 * usamos como **techo**. Lo que necesitamos de un techo no es exactitud: es que **nunca subestime**.
 *
 * Por eso `countTokens` es un **estimador conservador**: cuenta por encima del BPE real de Gemini y
 * de Groq para prosa en español. Si el estimador dice 1200, el tokenizador real va a decir menos.
 * El error va siempre para el lado seguro (armamos un prompt más chico del que podríamos), y el
 * test `tokens.test.ts` **fija esa dirección como invariante**, no como comentario.
 *
 * ## Cómo cuenta
 * 1. Colapsa espacios (el whitespace repetido no se paga como texto en ningún BPE moderno).
 * 2. Parte en "átomos": corridas de letras/dígitos por un lado, corridas de símbolos por el otro.
 * 3. Una corrida alfanumérica cuesta `ceil(len / 3)`. Tres caracteres por token es el piso
 *    observado para español acentuado; los BPE reales rinden 3,5–4,5, así que sobreestima ~15–30%.
 * 4. Una corrida de símbolos cuesta `ceil(len / 2)`. **Esta línea existe por una medición, no por
 *    simetría:** la primera versión cobraba cada símbolo suelto como un token entero, y sobre
 *    texto denso en puntuación —JSON, URLs, listas separadas por `|`— eso daba más del doble de lo
 *    que devuelve un BPE real, que tiene merges dedicados para esas secuencias. Sobreestimar está
 *    bien y es el punto del contador; sobreestimar 2× arruina la decisión que el número tenía que
 *    informar, porque se termina recortando contexto real para pagar tokens imaginarios.
 * 4. Cada mensaje suma `MESSAGE_OVERHEAD_TOKENS` por el andamiaje de rol del chat template.
 */

/** Caracteres por token asumidos. Deliberadamente bajo: sobrecontar es la falla segura. */
const CHARS_PER_TOKEN = 3;

/**
 * Andamiaje de rol por mensaje (`<|start|>user<|message|>` y equivalentes). Gemini y Groq no
 * publican el número; 4 es el valor que usa la industria para chat templates de esta familia.
 */
export const MESSAGE_OVERHEAD_TOKENS = 4;

/** Átomo = corrida alfanumérica, o corrida de símbolos. El espacio no es átomo. */
const ATOM = /[\p{L}\p{N}]+|[^\s\p{L}\p{N}]+/gu;
/** Caracteres por token dentro de una corrida de símbolos. */
const CHARS_PER_SYMBOL_TOKEN = 2;
const ALPHANUMERIC = /^[\p{L}\p{N}]/u;

/**
 * Colapsa whitespace a un espacio simple y recorta. Es la forma en la que el contador ve el texto,
 * y también la referencia contra la que el test verifica que no subestimamos.
 */
export function normalizeForCount(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

/** Estimación conservadora de tokens de un texto suelto. */
export function countTokens(text: string): number {
  const normalized = normalizeForCount(text);
  if (normalized.length === 0) return 0;
  let total = 0;
  for (const atom of normalized.match(ATOM) ?? []) {
    const rate = ALPHANUMERIC.test(atom) ? CHARS_PER_TOKEN : CHARS_PER_SYMBOL_TOKEN;
    total += Math.max(1, Math.ceil(atom.length / rate));
  }
  return total;
}

/** Un mensaje de chat tal como lo cuenta la dieta. El rol se paga aunque el contenido sea corto. */
export interface CountableMessage {
  readonly role: string;
  readonly content: string;
}

/** Tokens de una conversación completa, con el andamiaje de cada mensaje incluido. */
export function countMessageTokens(messages: readonly CountableMessage[]): number {
  let total = 0;
  for (const message of messages) {
    total += MESSAGE_OVERHEAD_TOKENS + countTokens(message.role) + countTokens(message.content);
  }
  return total;
}

/**
 * Recorta un texto para que quepa en `maxTokens`, cortando en el último espacio para no partir una
 * palabra al medio. Devuelve el texto tal cual si ya entra.
 */
export function truncateToTokens(text: string, maxTokens: number): string {
  if (maxTokens <= 0) return '';
  if (countTokens(text) <= maxTokens) return text;
  const normalized = normalizeForCount(text);
  // Búsqueda binaria sobre caracteres: `countTokens` es monótona en el prefijo.
  let low = 0;
  let high = normalized.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (countTokens(normalized.slice(0, mid)) <= maxTokens) low = mid;
    else high = mid - 1;
  }
  const cut = normalized.slice(0, low);
  const lastSpace = cut.lastIndexOf(' ');
  const body = lastSpace > low * 0.6 ? cut.slice(0, lastSpace) : cut;
  return body.trimEnd();
}
