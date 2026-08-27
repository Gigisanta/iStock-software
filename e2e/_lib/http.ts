/**
 * Pedidos HTTP crudos, sin browser. Owner: `qa-agent`.
 *
 * La mitad de lo que hay que verificar en la vidriera **no está en el DOM**: el status real
 * (404 vs. 200 con contenido de 404), `x-nextjs-cache`, `cache-control`, la ausencia de
 * `location`. Un `page.goto()` los tapa; un pedido crudo los muestra.
 *
 * `maxRedirects: 0` en todos lados a propósito: seguir el redirect es exactamente cómo un test
 * "pasa" mientras el producto manda a la home de marketing en vez de dar 404.
 */

import type { APIRequestContext, APIResponse } from '@playwright/test';

export async function getRaw(request: APIRequestContext, url: string): Promise<APIResponse> {
  return request.get(url, { maxRedirects: 0 });
}

/**
 * Pide la misma URL hasta que la sirva el cache de ISR (`x-nextjs-cache: HIT`).
 *
 * No es un `sleep` disfrazado: la primera respuesta de una ruta con segmento dinámico se genera
 * on-demand (y en 16.3.3 sale como shell en streaming), la entrada durable se escribe después.
 * Cuántos pedidos hacen falta es un detalle del runtime; que **quede** cacheada no lo es.
 */
export async function fetchUntilCached(
  request: APIRequestContext,
  url: string,
  attempts = 6,
): Promise<APIResponse> {
  let last = await getRaw(request, url);
  for (let attempt = 1; attempt < attempts; attempt += 1) {
    if (last.headers()['x-nextjs-cache'] === 'HIT') return last;
    last = await getRaw(request, url);
  }
  return last;
}
