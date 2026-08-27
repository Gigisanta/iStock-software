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

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Pedido con **fecha de vencimiento**. La respuesta que nunca cierra es un resultado, no un error
 *  del test.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## Por qué no alcanza con `getRaw` + `expect(status).toBe(404)`
 * Bajo `cacheComponents` + PPR, un throw adentro del render cacheado sale como **stream de 200 que
 * no termina nunca**: los headers ya se enviaron, así que el status no se puede corregir, y sin un
 * `error.tsx` que cierre el boundary el cuerpo se queda abierto. Contra eso, un `expect` sobre el
 * status **no llega a evaluarse**: el `await request.get(...)` se cuelga hasta el timeout del test
 * y Playwright reporta `Test timeout of 90000ms exceeded`.
 *
 * Ese rojo es el peor de todos: es correcto por casualidad y se lee como flake. La semana que
 * viene alguien le pone `retries: 1` y el agujero vuelve a ser invisible.
 *
 * Este helper convierte "no cerró" en un **dato** (`timedOut`) que el test afirma explícitamente,
 * con un mensaje que dice qué pasó. El presupuesto lo elige el spec y lo justifica.
 *
 * ## Qué NO hace
 * No hay `setTimeout` ni carrera contra un reloj propio: el corte lo hace el `timeout` del propio
 * `request.get`, que es el único que además **cancela** el socket. Un `Promise.race` dejaría la
 * request colgada de fondo, sumando conexiones abiertas contra el server de test.
 */
export interface DeadlineResult {
  /** `true` si el server no terminó la respuesta dentro del presupuesto. */
  readonly timedOut: boolean;
  /** Milisegundos hasta tener el cuerpo completo (o hasta el corte). */
  readonly elapsedMs: number;
  /** `null` cuando `timedOut`: no hubo respuesta completa que mirar. */
  readonly status: number | null;
  /** Cuerpo completo. Vacío cuando `timedOut`. */
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * `GET url`, sin seguir redirects, con presupuesto de tiempo.
 *
 * El tiempo se mide alrededor de `get` **y** de `text()`: si algún día Playwright resolviera el
 * `get` con los headers y dejara el cuerpo para después, la medición seguiría siendo la del
 * cuerpo completo, que es lo que se está afirmando.
 *
 * Un error que **no** sea de timeout (conexión rechazada, DNS) se re-lanza: eso es "el server no
 * está", no "el server no cierra", y confundirlos hace que un entorno mal levantado se lea como
 * un defecto del producto.
 */
export async function fetchWithDeadline(
  request: APIRequestContext,
  url: string,
  budgetMs: number,
): Promise<DeadlineResult> {
  const started = Date.now();
  try {
    const response = await request.get(url, { maxRedirects: 0, timeout: budgetMs });
    const body = await response.text();
    return {
      timedOut: false,
      elapsedMs: Date.now() - started,
      status: response.status(),
      body,
      headers: response.headers(),
    };
  } catch (error) {
    const elapsedMs = Date.now() - started;
    const message = error instanceof Error ? error.message : String(error);
    if (/timed?\s?out|timeout/iu.test(message)) {
      return { timedOut: true, elapsedMs, status: null, body: '', headers: {} };
    }
    throw error;
  }
}
