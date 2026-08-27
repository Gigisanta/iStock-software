/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Qué tiene que ser una dirección sin vidriera. Owner: `qa-agent`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## Por qué esto ya no se afirma con `expect(status).toBe(404)`
 * **ADR-011** (aceptada, `docs/DECISIONS.md`) supersede el corolario 4 de ADR-007. Medido por el
 * LEAD sobre el mismo build, tres variantes: **ninguna** da 404 en la primera request bajo
 * `cacheComponents`, porque el status se decide antes de que resuelva el lookup del slug. Las dos
 * variantes que sí daban 404 en la req 2 le mostraban una **página en blanco** (0 bytes de DOM
 * visible) al 100% de las personas, primera request y centésima.
 *
 * Se adoptó la variante B: contenido legible con `noindex, nofollow` y status 200.
 *
 * **Esto no ablanda el test, le cambia el instrumento.** La regla de negocio nunca fue "el status
 * es 404": era *"un subdominio que no es de nadie no se confunde con una vidriera y no se
 * indexa"*. El status era la forma de medirla y dejó de servir. Lo que la mide ahora es esta
 * lista, que es la de la sección *"Lo que reemplaza al status como invariante chequeable"* de
 * ADR-011, y es **más** exigente que el status: un 404 con el body vacío pasaba el test viejo y
 * no pasa éste.
 *
 * ## La deuda, declarada
 * El miss dejó de ser distinguible por status code en los logs de acceso. Está aceptada y escrita
 * en la ADR. No se mitiga acá y ningún test finge lo contrario.
 */

import { expect } from '@playwright/test';
import type { APIResponse } from '@playwright/test';
import { STOREFRONT_404_H1 } from './copy';
import { domHtml, firstH1, robotsMeta, titleOf } from './html';

/**
 * Marca que el `<main>` del miss lleva en el DOM
 * (`apps/web/app/(storefront)/_components/storefront-miss.tsx`).
 *
 * Existe porque bajo ADR-011 **el status ya no distingue** miss de vidriera: las dos respuestas son
 * 200. Lo que las distingue es el DOM, y esta marca es la parte del DOM que no depende de la copy:
 * un cambio de texto en la página de miss no tiene por qué romper los tests que sólo necesitan
 * saber *cuál de las dos páginas* se sirvió.
 */
export const MISS_MARKER = 'data-storefront="miss"';

/** ¿Esta respuesta es la página de "dirección sin vidriera"? Se decide por DOM, no por status. */
export function isMiss(html: string): boolean {
  return domHtml(html).includes(MISS_MARKER);
}

/**
 * Afirma que `html` es **la página de dirección sin vidriera**, y no un shell vacío, ni un error
 * de Next, ni una vidriera a medio pintar.
 *
 * `when` describe el momento ("primera visita", "respuesta cacheada", "tenant suspendido"): el
 * mensaje de fallo tiene que decir *cuál* de las visitas se rompió, porque el arreglo es distinto.
 */
export function expectStorefrontMiss(html: string, when: string): void {
  const dom = domHtml(html);

  // 1 · DOM de verdad. `<h1` **literal** en el HTML que el browser pinta: el payload de Flight
  //     lleva el texto JSON-escapado y nunca escribe la etiqueta así. Ésta es la aserción que
  //     reprobaba la variante A en el 100% de las requests.
  expect(
    dom,
    `${when}: el body llegó sin DOM renderizado. La persona ve una pantalla en blanco y el h1 ` +
      'sólo existe en el payload de Flight.',
  ).toContain('<h1');

  expect(
    firstH1(html),
    `${when}: el h1 renderizado no es el de "dirección sin vidriera".`,
  ).toBe(STOREFRONT_404_H1);

  // 1bis · La marca de DOM, que es lo que usan los tests para decidir *cuál* página se sirvió
  //        ahora que el status no distingue (ADR-011). Si desaparece, esos tests dejan de poder
  //        distinguir nada y tienen que enterarse acá, no tres specs más abajo.
  expect(
    dom,
    `${when}: falta ${MISS_MARKER} en el DOM. Es la marca por la que el resto de la suite ` +
      'distingue miss de vidriera ahora que las dos respuestas son 200 (ADR-011).',
  ).toContain(MISS_MARKER);

  // 2 · No se indexa. Es la mitad del propósito del gate: un slug muerto en el índice de Google
  //     es una dirección que le promete a alguien un negocio que no existe.
  expect(
    robotsMeta(html) ?? '(sin meta robots)',
    `${when}: hereda "index, follow" del layout raíz — el subdominio muerto es indexable.`,
  ).toContain('noindex');

  // 3 · Título propio. `iStock` es nombre código interno (`CLAUDE.md`, encabezado): heredar el
  //     template del layout raíz le pega nuestro nombre en la pestaña al cliente de un reseller.
  const title = titleOf(html);
  expect(title, `${when}: el <title> heredó el del layout raíz.`).not.toBe('iStock');
  expect(title, `${when}: el <title> no es el de la dirección sin vidriera.`).toBe(STOREFRONT_404_H1);

  // 4 · Lo que reemplaza al status: el miss **no puede parecerse a una vidriera**. Sin esto, la
  //     variante B degrada en silencio a "shell de tienda vacía con 200" y nadie se entera.
  expect(dom, `${when}: el miss trae un wa.me — se está sirviendo como tienda.`).not.toContain('wa.me');
  expect(dom, `${when}: el miss trae markup de listing — se está sirviendo como tienda.`).not.toMatch(
    /data-listing|data-storefront="grid"/u,
  );
}

/** Igual, pero además exige que el nombre de un negocio concreto **no** aparezca en la respuesta. */
export async function expectMissWithout(
  response: APIResponse,
  forbiddenName: string,
  when: string,
): Promise<void> {
  const html = await response.text();
  expectStorefrontMiss(html, when);
  expect(
    html,
    `${when}: el nombre del negocio se publicó igual (fuga en la respuesta, DOM o Flight).`,
  ).not.toContain(forbiddenName);
}
