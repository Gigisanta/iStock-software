import type { Metadata } from 'next';
import { cacheLife, cacheTag } from 'next/cache';
import { STOREFRONT_DOMAIN } from '@istock/domain';
import { storefrontTag, tenantConfigTag } from '../../_lib/cache-tags';
import { cacheStorefrontMiss } from '../../_lib/cache-life';
import { PRERENDER_SEED_SLUG, isSlugShaped } from '../../_lib/host';
import { getStorefrontTenant } from '../../_lib/tenant';
import { getStorefrontCatalog } from '../../_lib/listings';
import { ListingGrid } from '../../_components/listing-grid';
import { STOREFRONT_MISS_METADATA, StorefrontMiss } from '../../_components/storefront-miss';

/**
 * `/s/{slug}` — **home de la vidriera**: encabezado del tenant + la grilla de equipos publicados.
 *
 * La grilla no arma su propio `select`: llama a `getStorefrontCatalog()` (`_lib/listings.ts`), que
 * devuelve `PublicListingDTO[]` y nada más. Ese es el **único** camino de datos hasta el JSX, así
 * que la allowlist del DTO no se puede esquivar desde acá aunque alguien quiera — no hay una fila
 * cruda a mano para filtrar "a ojo" en el markup.
 *
 * Las cards **no** llevan botón de WhatsApp: el único `wa.me` de la vidriera vive en la ficha
 * (`CLAUDE.md` §1). Ver `_components/listing-grid.tsx` para por qué la grilla es de dos columnas
 * en mobile y por qué no usa `next/link`: las dos cosas son presupuesto, no estética.
 *
 * ## Cómo llega el `slug`
 * Por el **path**, reescrito por `apps/web/proxy.ts` desde `{slug}.maat.work`. Nunca por header.
 * El `slug` entra al cache key de `'use cache'` (es un argumento serializable) y a los `cacheTag`.
 * Sin eso, `acme.maat.work` y `beta.maat.work` renderizarían el mismo path con los mismos
 * argumentos y **compartirían la entrada de cache**: el key del CDN incluye el host, pero el de
 * `'use cache'` y el del ISR durable **no**.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *  El slug inexistente: por qué NO hay `notFound()` acá. ADR-011, variante B. Decisión del LEAD.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * **Relato corto:** bajo `cacheComponents` es **status XOR body**. Se eligió el body.
 *
 * Medido por el LEAD con `curl` sobre un mismo build de `next@16.3.3`, tres variantes, slug nuevo
 * en cada corrida (cache frío para ese slug aunque el server esté caliente):
 *
 * | variante | req 1 | req 2+ | body visible (sin `<script>`) | `h1` | robots | `<title>` |
 * |---|---|---|---|---|---|---|
 * | **A** `notFound()` en `s/[slug]` | 200 | 404 | **0 bytes** | 0 | noindex | `iStock` (fuga) |
 * | **C** `notFound()`, boundary en `(storefront)/not-found.tsx` | 200 | 404 | **0 bytes** | 0 | noindex | `iStock` (fuga) |
 * | **B** el miss como contenido de página (esto) | 200 | 200 | **797 bytes** | 1 | noindex, nofollow | propio |
 *
 * Tres hechos que salen de esa tabla y que **no** hay que volver a probar:
 * 1. **Ninguna variante da 404 en la primera request.** El gate original del board ("slug
 *    inexistente → 404 real") era inalcanzable en esta versión de Next, no un defecto de esta
 *    página.
 * 2. **Mover el `not-found.tsx` en el árbol no cambia un byte** (C ≡ A). Ya está probado.
 * 3. **`notFound()` renderiza cero DOM visible**, incluso en el caso completamente prerenderizado.
 *    O sea: no es un artefacto del streaming. El `<h1>` viajaba **sólo** dentro del payload de
 *    Flight, JSON-escapado, y la persona veía una página en blanco — la primera request y la
 *    centésima.
 *
 * ── Por qué el status no se puede tener ────────────────────────────────────────────────────────
 * Doc de esta misma versión de Next
 * (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md:103-113`):
 *
 * > *"When streaming, a `200` status code will be returned... Because the response headers have
 * > already been sent to the client, the status code of the response cannot be updated. ... If you
 * > need a 404 status, for compliance or analytics, ensure the resource exists before the response
 * > body is streamed. You can run this check in `proxy`..."*
 *
 * Con `cacheComponents: true` la ruta es `PARTIALLY_STATIC` (`.next/prerender-manifest.json`:
 * `"renderingMode":"PARTIALLY_STATIC"`, y `.next/server/app/s/[slug].meta` con `"status": 200` +
 * `postponed`). Un param que no estaba en `generateStaticParams` se sirve reanudando ese shell, y
 * el shell ya salió con 200. Las tres salidas teóricas, y por qué ninguna se tomó:
 * 1. **Chequear existencia en `proxy`** — es lo que dice la doc, y es I/O en el proxy: prohibido
 *    por contrato y sería una query en el **100%** de los pageviews, justo lo contrario del 95%
 *    sin Postgres.
 * 2. **`htmlLimitedBots` con un regex que matchee todo** — medido: arregla el status **y destruye
 *    el cache**. Ese mismo regex alimenta `experimentalBypassFor` en el prerender manifest, así
 *    que hace bypass de cache para todos (`demo` req1 y req2 salieron las dos
 *    `private, no-cache, no-store`, sin `x-nextjs-cache: HIT`).
 * 3. **Apagar `cacheComponents`** — imposible sin perder `'use cache'`: `experimental.useCache` y
 *    `experimental.dynamicIO` fueron removidos en Next 16 (`upgrading/version-16.md:1200-1202`), y
 *    sin `'use cache'` no existe el `cacheLife` asimétrico de MEDIUM-C. Tampoco hay escape por
 *    segmento: `export const dynamic` y `export const dynamicParams` los rechaza el compilador
 *    (*"not compatible with `nextConfig.cacheComponents`"*).
 *
 * ── Qué se eligió, qué se paga, y quién lo vigila ──────────────────────────────────────────────
 * Se adoptó **B**. El propósito del gate —que un slug muerto no se confunda con una vidriera y no
 * se indexe— se cumple con `noindex` + DOM legible. **A** cumplía la letra (el status) mientras le
 * mostraba una página en blanco al 100% de las personas.
 *
 * **Deuda declarada (ADR-011), no bug:** el miss deja de ser distinguible por status code en los
 * logs de acceso. `scripts/accept-s1.sh` A3/A4 la imprime en cada corrida y, en lugar del status,
 * exige sobre la **primera** request a un slug nuevo: `<h1>` literal en el body · `robots noindex` ·
 * `<title>` propio y distinto de `iStock` · **cero markup de vidriera** (ni `wa.me` ni
 * `data-listing`) · `x-nextjs-cache: HIT` en la req 2 · y `demo` todavía en 200.
 *
 * El texto y la metadata del miss viven en `_components/storefront-miss.tsx`, una sola vez.
 * `s/[slug]/not-found.tsx` sigue existiendo, pero ya no como "el boundary de lo que S3 va a
 * lanzar": la ficha de S3 lo intentó, el LEAD midió lo mismo que acá (0 chars visibles en la
 * primera request) y ahora también devuelve su miss como contenido, `<ListingMiss />`. Hoy ningún
 * archivo de la vidriera llama `notFound()`; el boundary queda como piso en castellano y dentro
 * del layout del tenant, que es un motivo que no depende de la medición.
 *
 * ## Ausencias deliberadas
 * - **`generateStaticParams` no lista tenants.** Devuelve un único slug semilla, porque su función
 *   acá es cambiar el modo de servido de la ruta (ver abajo), no prerenderizar contenido.
 * - **No hay `export const revalidate`.** El TTL por tiempo es el modelo viejo y acá es una
 *   decisión de plata: `revalidate: 60` son ~USD 2.59/tenant/mes contra ~USD 0.012 con
 *   `cacheLife('max')` + invalidación por evento. 216x.
 * - **No hay `dynamic = 'force-dynamic'` ni `cache: 'no-store'`** "por las dudas".
 * - **No hay `notFound()`.** Ver arriba. Borrar `StorefrontMiss` y volver a `notFound()` reabre
 *   ADR-011 y vuelve a servir una página en blanco.
 */

/**
 * **Esto es lo que hace cacheable a la vidriera. No lo borres porque "no hace nada".**
 *
 * Con `cacheComponents: true`, una ruta con segmento dinámico y **sin** `generateStaticParams` se
 * sirve siempre en modo *postponed*: `Cache-Control: private, no-cache, no-store`, una invocación de
 * función en el **100%** de los pageviews y `x-nextjs-cache` que nunca da `HIT`. Con
 * `generateStaticParams` presente, la ruta pasa a ISR clásico. Medido en `next start` 16.3.3:
 *
 * | host | req 1 | req 2 y 3 | `Cache-Control` de la req 2 |
 * |---|---|---|---|
 * | `demo` (tenant real) | 200, sin `x-nextjs-cache` | `HIT` 200 | `s-maxage=2592000, swr=28944000` |
 * | slug que no existe | 200, sin `x-nextjs-cache` | `HIT` 200 | perfil corto (`STOREFRONT_MISS_LIFE`) |
 *
 * Los bytes y los status de esas dos filas están en la tabla de arriba; lo que importa acá son las
 * columnas 2 y 3. Sin `generateStaticParams` **ninguna** request llega a `HIT` y el `Cache-Control`
 * se queda en `private, no-cache, no-store` para siempre: 100% de los pageviews a Postgres. Que la
 * fila del miss diga `200` y no `404` es ADR-011, no una regresión de cache — el miss **sí** queda
 * cacheado, que es la mitad del motivo por el que existe el perfil corto.
 *
 * El slug que se devuelve no le importa a nadie — lo único que Next exige es que la lista no esté
 * vacía. Por eso va `PRERENDER_SEED_SLUG` y **no** la lista real de tenants: prerenderizar tenants
 * ataría el build a Postgres, haría una query por tenant en cada deploy y no cubriría a los que se
 * dan de alta después. Verificado: `next build` compila **sin `DATABASE_URL`**.
 *
 * `dynamicParams` (que es lo que permite servir slugs desconocidos on-demand) **no se declara**:
 * es el default y, además, declararlo rompe el build — `Route segment config "dynamicParams" is not
 * compatible with nextConfig.cacheComponents`.
 */
export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  return [{ slug: PRERENDER_SEED_SLUG }];
}

interface StorefrontPageProps {
  readonly params: Promise<{ readonly slug: string }>;
}

/**
 * Metadata de la vidriera. Se cachea **aparte** del cuerpo (Next la resuelve en su propio
 * boundary), así que necesita sus propios `cacheTag` y su propio perfil de vida.
 *
 * Los dos tags van siempre juntos con el cuerpo: invalidar uno solo deja el peor caso de todos —
 * la página se ve perfecta y el `<title>` sigue diciendo *"No hay ninguna vidriera en esta
 * dirección"* con `robots: noindex`. La vidriera anda para quien tenga el link y es invisible para
 * Google, y "pegá el link en un estado" es la mitad del producto.
 *
 * Que el cuerpo y la metadata sean dos entradas de cache distintas es también el motivo por el que
 * `StorefrontMiss` emite su **propio** `<meta name="robots">` además de este: la directiva del
 * camino negativo no puede depender de qué rama de metadata resolvió. Ver
 * `_components/storefront-miss.tsx`.
 */
export async function generateMetadata({ params }: StorefrontPageProps): Promise<Metadata> {
  'use cache';

  const { slug } = await params;

  // Antes de `cacheTag()`, siempre. Ver el comentario gemelo del cuerpo, abajo: acá pesa el doble,
  // porque la metadata resuelve en su propio boundary y `error.tsx` **no** la cubre.
  if (!isSlugShaped(slug)) {
    cacheStorefrontMiss();
    return STOREFRONT_MISS_METADATA;
  }

  cacheTag(storefrontTag(slug), tenantConfigTag(slug));

  const tenant = await getStorefrontTenant(slug);
  if (tenant === null) {
    // Mismo perfil corto que el cuerpo. Si la metadata durara 30 días y el cuerpo 5 minutos, un
    // tenant dado de alta después quedaría con la vidriera bien y el `<title>` del miss.
    cacheStorefrontMiss();

    // `index: false` pisa al `index: true` de `(storefront)/layout.tsx`: la metadata de Next se
    // mergea por campo y el segmento más profundo gana. El layout NO se toca — que Google indexe
    // la vidriera real es parte del producto.
    return STOREFRONT_MISS_METADATA;
  }

  cacheLife('max');

  return {
    title: { absolute: tenant.name },
    description: `Stock de celulares de ${tenant.name}. Precios en USD y ARS, retiro en el local y cierre por WhatsApp.`,
    alternates: { canonical: `https://${tenant.slug}.${STOREFRONT_DOMAIN}/` },
    openGraph: {
      type: 'website',
      locale: 'es_AR',
      siteName: tenant.name,
      url: `https://${tenant.slug}.${STOREFRONT_DOMAIN}/`,
    },
  };
}

/**
 * El cuerpo de la vidriera, **cacheado entero**, con los dos caminos adentro del mismo scope.
 *
 * El camino negativo **devuelve** `<StorefrontMiss />` en vez de lanzar `notFound()` (ADR-011,
 * variante B: ver el docblock de arriba, con la tabla medida). Los dos caminos eligen perfil de
 * cache **explícitamente** y son distintos a propósito: `cacheStorefrontMiss()` (minutos) para el
 * slug que no existe, `cacheLife('max')` (30 días, invalidado por evento) para el que sí.
 *
 * ⚠️ CONTRAPARTIDA OPERATIVA, NO OPCIONAL: el miss **se cachea**. El alta de un tenant sigue
 * teniendo que invalidar `storefront:{slug}` y `tenant-config:{slug}` de su propio slug —
 * `(app)/_lib/tenants/storefront-cache.ts` lo hace con `updateTag`, que es read-your-own-writes.
 * El TTL corto es el tirador; el `updateTag` es el cinturón, y el dueño probando su propio link no
 * puede esperar cinco minutos.
 */
export default async function StorefrontHomePage({ params }: StorefrontPageProps) {
  'use cache';

  const { slug } = await params;

  // ── Validar ANTES de `cacheTag()`. Es el fix del HIGH del adversary de S1. ────────────────────
  // `cacheTag(storefrontTag(slug))` **tira** con un slug basura, y bajo `cacheComponents` + PPR un
  // throw de render no es un 500: el shell ya salió con `200` y lo que queda es un stream que no
  // cierra. Derivar la validación del throw convierte cualquier input malo en CPU facturada.
  //
  // **Esto es un backstop, no la respuesta.** Quien contesta `/s/algo.json` es el proxy, con un 404
  // real y sin invocar la app (el argumento completo está en `_lib/host.ts`,
  // `isStorefrontInternalPath`). Esta rama existe para el día que alguien afloje el `matcher` o
  // llame a esta página desde otro lado, y su contrato es más chico: **no tirar, no colgarse, no
  // filtrar, y no costar caro**. El status no entra en ese contrato, y no por olvido — ADR-011
  // demostró que desde acá adentro el status ya está decidido: el shell de PPR salió con `200`
  // antes de que nadie mirara el slug. La capa que puede elegir status es la que corre antes del
  // stream, y ésa es el proxy.
  if (!isSlugShaped(slug)) {
    cacheStorefrontMiss();
    return <StorefrontMiss />;
  }

  // El tag va SIEMPRE con el slug adentro: los cache tags de Vercel están scopeados a
  // proyecto + environment, **no a dominio**. Un tag genérico purga a todos los tenants juntos.
  cacheTag(storefrontTag(slug), tenantConfigTag(slug));

  const tenant = await getStorefrontTenant(slug);
  if (tenant === null) {
    cacheStorefrontMiss();
    return <StorefrontMiss />;
  }

  cacheLife('max');

  const host = `${tenant.slug}.${STOREFRONT_DOMAIN}`;
  const catalog = await getStorefrontCatalog(slug);

  return (
    <main>
      <header className="border-b border-neutral-200 pb-5 dark:border-neutral-800">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{host}</p>
        <h1 className="mt-1 text-2xl font-semibold leading-tight sm:text-3xl">{tenant.name}</h1>
      </header>

      {catalog.listings.length > 0 ? (
        <section aria-labelledby="stock" className="mt-6">
          <h2 id="stock" className="sr-only">
            Equipos publicados
          </h2>
          <ListingGrid listings={catalog.listings} />
          <p className="mt-5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
            Tocá un equipo para ver fotos, batería, garantía, punto de retiro y el precio en pesos.
          </p>
        </section>
      ) : (
        <EmptyStorefront tenantName={tenant.name} publishedCount={catalog.publishedCount} />
      )}
    </main>
  );
}

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  La vidriera vacía tiene DOS causas y se dicen distinto
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * - `publishedCount === 0`: el dueño todavía no publicó nada. La vidriera está bien; falta stock.
 * - `publishedCount > 0` con grilla vacía: hay equipos publicados y **falta el tipo de cambio**.
 *   El TC lo carga el dueño a mano, por tenant (`CLAUDE.md` §1: no hay API de dólar en el hot
 *   path), y sin él no hay ARS, que es uno de los 15 campos obligatorios de la ficha. Antes que
 *   inventarle un dólar al dueño, la vidriera no publica y **lo dice**.
 *
 * Que sean dos textos y no uno no es cortesía: el segundo caso es el dueño que cargó 15 equipos
 * una tarde y ve la misma pantalla que si no hubiera cargado ninguno. Es la tarde en la que decide
 * si el producto sirve, y un mensaje ambiguo ahí se lee como "no funciona".
 *
 * El número exacto de equipos NO se muestra: al visitante anónimo no le sirve saber que hay 15
 * equipos que no puede ver, y publicar el tamaño del stock de un negocio no es dato nuestro.
 */
function EmptyStorefront({
  tenantName,
  publishedCount,
}: {
  readonly tenantName: string;
  readonly publishedCount: number;
}) {
  const pending = publishedCount > 0;

  return (
    <section
      aria-labelledby="estado-vidriera"
      className="mt-6 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800"
    >
      <h2 id="estado-vidriera" className="text-base font-semibold">
        {pending ? 'Vidriera casi lista' : 'Vidriera en preparación'}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
        {pending
          ? `${tenantName} ya cargó equipos, pero todavía falta el tipo de cambio del día para publicar los precios en pesos. Volvé en un rato.`
          : `Todavía no hay equipos publicados en esta dirección. Cuando ${tenantName} cargue el stock, vas a ver acá cada equipo con fotos, condición, batería, garantía y el precio en dólares y en pesos.`}
      </p>

      {/*
        Acá NO va un botón de WhatsApp. El texto canónico de `CLAUDE.md` §1 nombra un equipo y un
        precio concretos; sin ficha no hay equipo, y un `wa.me` genérico ("Hola, vi tu vidriera")
        es exactamente el mensaje sin contexto que el producto existe para eliminar.
      */}
    </section>
  );
}
