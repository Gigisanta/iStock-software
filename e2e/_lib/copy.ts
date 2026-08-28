/**
 * Copy visible que los tests afirman. Owner: `qa-agent`.
 *
 * Está acá y no repetida en cada archivo por una razón concreta: si mañana alguien reescribe el
 * texto del 404 de la vidriera, tiene que fallar **un** lugar y no cinco, y el fallo tiene que
 * decir "cambió la copy", no "el 404 dejó de funcionar".
 */

/**
 * `<h1>` de la **dirección sin vidriera** (`app/(storefront)/_components/storefront-miss.tsx`,
 * ADR-011 variante B). Es el mismo texto que usa `s/[slug]/not-found.tsx`, que renderiza ese
 * componente: el párrafo vive una sola vez del lado de la impl y una sola vez del lado del test.
 */
export const STOREFRONT_404_H1 = 'No hay ninguna vidriera en esta dirección';

/**
 * `<h1>` de `app/(marketing)/page.tsx`.
 *
 * Está acá porque el test de subdominios reservados (`www`) necesita afirmar **en positivo** qué
 * se sirvió, y no sólo que no se sirvió la vidriera: `expect(h1).not.toBe(404_H1)` da verde
 * también el día que `www` devuelve una página vacía, un error de Next o el panel.
 */
export const MARKETING_H1 = 'Tu stock, con vidriera propia y el WhatsApp ya escrito.';

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  RONDA 2 · "en castellano" es una afirmación verificable, no una intención
// ══════════════════════════════════════════════════════════════════════════════════════════════
//
// El contrato de S2 dice que una foto rechazada muestra un mensaje en `data-testid="error-foto"`.
// Un test que sólo afirmara `toBeVisible()` daría verde con `Error: Body exceeded 3.5mb` adentro
// del nodo, que es exactamente el fallo que hay que cazar: el dueño está parado en el mostrador y
// lee una frase de infraestructura en inglés.
//
// Entonces se afirman las dos mitades, porque una sola es fácil de cumplir por accidente:
//   1. **lo que NO puede estar**: los textos que emite la plataforma o un stack de Node;
//   2. **lo que SÍ tiene que estar**: castellano de verdad.

/**
 * Marcadores de que lo que se ve lo escribió la plataforma y no nosotros.
 *
 * `413` y `FUNCTION_PAYLOAD_TOO_LARGE` salen de la doc de Vercel; `Body exceeded` es literal del
 * `action-handler` de Next cuando se pasa `serverActions.bodySizeLimit`; los `at ` son un stack.
 */
export const PLATFORM_ERROR_MARKERS: readonly string[] = [
  'FUNCTION_PAYLOAD_TOO_LARGE',
  'Payload Too Large',
  'Body exceeded',
  'Request Entity Too Large',
  'Unhandled Runtime Error',
  'Application error',
  'Internal Server Error',
  'at Object.',
  'at async ',
  'node_modules',
];

/** Los marcadores de plataforma presentes en un texto. Vacío = el mensaje es nuestro. */
export function platformErrorMarkersIn(text: string): readonly string[] {
  const lower = text.toLowerCase();
  return PLATFORM_ERROR_MARKERS.filter((marker) => lower.includes(marker.toLowerCase()));
}

/**
 * Heurística deliberadamente laxa de "esto está escrito en castellano rioplatense".
 *
 * No intenta adivinar el idioma: busca que aparezca **alguna** palabra que un mensaje nuestro
 * necesariamente tiene. Es laxa porque el contrato no fija la copy —`app-agent` la elige— y un
 * test que exigiera una frase exacta estaría convirtiendo una decisión de producto en una
 * regresión. Lo que sí es duro es lo de arriba: que no haya inglés de infraestructura.
 */
export function isSpanishUserMessage(text: string): boolean {
  return /\b(?:la|el|los|las|un|una|de|del|que|no|con|para|más|pesa|foto|fotos|equipo|megas?|probá|subí|elegí|sacala|achicá|cargá)\b/iu.test(
    text,
  );
}
