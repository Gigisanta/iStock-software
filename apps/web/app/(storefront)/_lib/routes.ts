/**
 * Las URLs **públicas** de la vidriera. Sólo rutas: la *forma* del slug de una ficha ya no se
 * define acá — la declara `@istock/domain` (`LISTING_SLUG_PATTERN`, `isListingSlugShaped`) y la
 * espeja el `CHECK` de la migración `0003_listing_slug_format`. El motivo del techo 64, la fila
 * 207 del seed y el porqué de que la función sea pura y no tire están escritos allá, una sola vez.
 *
 * Este archivo existe porque una ruta **no** es una validación: el proxy, la grilla y
 * `generateStaticParams` necesitan ponerse de acuerdo en cómo se ve un link, y eso es propio de
 * `apps/web`, no del dominio.
 */

/**
 * Primer segmento de la URL pública de una ficha, bajo el host del tenant.
 *
 * `p` de "producto", y está en `RESERVED_SLUGS` de `@istock/domain` (familia 3, "rutas del
 * producto") junto con `s`: nadie puede registrar un tenant llamado `p`, así que este prefijo no
 * le pisa el subdominio a nadie.
 */
export const LISTING_PATH_PREFIX = '/p';

/**
 * La home de la vidriera **del tenant que está mirando el visitante**.
 *
 * Es `/` a secas, y eso NO es "el apex": bajo `{slug}.maat.work` el proxy reescribe `/` a
 * `/s/{slug}` (`storefrontPathFor` en `_lib/host.ts`), así que un link relativo se queda en el
 * host del tenant y aterriza en su grilla. El apex `maat.work` es otro host y sirve marketing;
 * desde una ficha no se llega nunca, porque `/s/**` y `/p/**` bajo el apex no son vidriera.
 *
 * Por qué no una URL absoluta `https://{slug}.maat.work/` aunque el slug esté a mano en `params`:
 * 1. **rompe todo lo que no sea producción** — los e2e y el `next start` del gate corren sobre
 *    `{slug}.127.0.0.1.nip.io:3100`, y un link absoluto a `maat.work` manda a la persona (y al
 *    test) a un dominio que ahí no resuelve;
 * 2. **es un byte de host de más en el HTML cacheado**, y el host ya está en la barra.
 *
 * La constante existe para que ese razonamiento viva una sola vez y no en cada `href="/"` suelto
 * de la vidriera. Hoy la usan la ficha (el "← Volver a la vidriera") y `_components/listing-miss`.
 */
export const STOREFRONT_HOME_PATH = '/';

/**
 * `iphone-14-pro-256-grafito` → `/p/iphone-14-pro-256-grafito`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  El link de la grilla es RELATIVO AL HOST DEL TENANT, y eso no es una preferencia de estilo
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * La URL interna de la ficha es `/s/{slug}/p/{listing}`, pero ese espacio **no es direccionable**:
 * `proxy.ts` corta todo `/s/**` con un 404 antes de resolver el host (`isStorefrontInternalPath`),
 * por dos motivos que ya están escritos allá — una sola URL canónica por tenant, y `/s/algo.json`
 * era el HIGH del adversary de S1.
 *
 * O sea que un `href="/s/demo/p/…"` en la grilla sería un link que el propio proxy contesta 404.
 * El link correcto es el que ve el visitante: `nombre.maat.work/p/{listing}`, que el proxy
 * reescribe al espacio interno igual que reescribe `/`. Por eso el slug del tenant **no** aparece
 * acá: ya está en el host.
 */
export function listingPath(listingSlug: string): string {
  return `${LISTING_PATH_PREFIX}/${listingSlug}`;
}

/**
 * Slug de ficha que se le pasa a `generateStaticParams` de `/s/[slug]/p/[listing]`.
 *
 * **No existe en ninguna base y no tiene por qué existir.** Lo único que Next exige para que una
 * ruta dinámica pase de modo *postponed* a ISR es que la lista no esté vacía; el par
 * (`PRERENDER_SEED_SLUG`, esto) se corta en el loader antes de abrir una conexión, porque el slug
 * de tenant es un subdominio reservado. Ese es todo el punto: el build no toca Postgres.
 */
export const PRERENDER_SEED_LISTING = 'not-a-listing';

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Las cuatro URLs del canje, y por qué son RELATIVAS igual que el resto (S8)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Mismo argumento que `STOREFRONT_HOME_PATH`, con una consecuencia extra que sí es nueva: el
 * handler de `POST /api/tradein` contesta un **303 con `Location` relativo**. Un `Location`
 * absoluto obligaría a leer el host del pedido, y leer un header desde `(storefront)` es
 * exactamente lo que `web-lint` W002 prohíbe — con motivo: el mismo header que serviría acá es el
 * que mata el ISR una ruta más allá. Un `Location` relativo lo resuelve el navegador contra la
 * barra de direcciones, que ya dice `{slug}.maat.work`, y funciona igual en producción que en el
 * `{slug}.127.0.0.1.nip.io:3100` de los e2e.
 *
 * `canje` y `canjes` están los dos en `RESERVED_SLUGS` de `@istock/domain`, así que ningún tenant
 * puede llamarse así y este prefijo no le pisa el subdominio a nadie.
 */
export const TRADEIN_PATH = '/canje';

/** El formulario ya enviado y aceptado. Es una página propia, no un `?ok=1`. */
export const TRADEIN_DONE_PATH = '/canje/listo';

/**
 * "No entró, revisá y mandalo de nuevo". Cubre **las dos** causas —el body no validó, o la
 * escritura no dejó fila— y a propósito: decir cuál de las dos fue es un oráculo gratis en el
 * único endpoint sin login del producto, y a la persona no le cambia lo que tiene que hacer.
 */
export const TRADEIN_RETRY_PATH = '/canje/reintentar';

/**
 * El endpoint. Está declarado en `config/firewall-rules.json` (`storefront-tradein-rl`, 5 pedidos
 * cada 600 s por IP, acción `deny`) y por eso es un `route.ts` y **no** una Server Action: una
 * Server Action postea a la URL de la página, así que el único path que el WAF podría condicionar
 * sería la ficha misma — o sea, ponerle techo a los pageviews de la vidriera, que es justo lo que
 * `ARCHITECTURE.md` dice que no defendemos.
 */
export const TRADEIN_ENDPOINT_PATH = '/api/tradein';
