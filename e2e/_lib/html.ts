/**
 * Lectura del HTML **renderizado**, separado de la carga de React Flight. Owner: `qa-agent`.
 *
 * ## Por qué existe este archivo
 * Un `expect(html).not.toContain('No hay ninguna vidriera')` sobre la respuesta cruda **es un
 * falso positivo garantizado**: el `notFound` de cada segmento viaja serializado en el payload de
 * Flight de *toda* página de ese layout, la muestre o no. Verificado en esta app: la vidriera de un
 * tenant vivo, respondiendo 200 y con su `<h1>` correcto, igual trae la copy del 404 adentro de un
 * `<script>self.__next_f.push(...)`.
 *
 * Entonces se afirma sobre lo que **ve la persona**: el HTML hasta antes del primer chunk de
 * Flight.
 */

/** El HTML que el browser pinta, sin los `<script>` con el payload de Flight. */
export function domHtml(html: string): string {
  const index = html.indexOf('self.__next_f');
  return index === -1 ? html : html.slice(0, index);
}

/** Texto del primer `<h1>` renderizado. `null` si la página no tiene ninguno. */
export function firstH1(html: string): string | null {
  const match = /<h1\b[^>]*>([\s\S]*?)<\/h1>/u.exec(domHtml(html));
  if (match === null) return null;
  return stripTags(match[1] ?? '');
}

/** Contenido del `<title>`. `null` si no hay. Es lo que se lee en la pestaña y en Google. */
export function titleOf(html: string): string | null {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/u.exec(domHtml(html));
  if (match === null) return null;
  return stripTags(match[1] ?? '');
}

/** Valor de `<meta name="robots">`. `null` si no hay ninguno. */
export function robotsMeta(html: string): string | null {
  const match = /<meta\s+name="robots"\s+content="([^"]*)"/u.exec(domHtml(html));
  return match?.[1] ?? null;
}

function stripTags(fragment: string): string {
  return fragment
    .replace(/<!--[\s\S]*?-->/gu, '')
    .replace(/<[^>]+>/gu, '')
    .trim();
}
