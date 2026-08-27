import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cacheLife, cacheTag } from 'next/cache';
import { STOREFRONT_DOMAIN } from '@istock/domain';
import { storefrontTag, tenantConfigTag } from '../../_lib/cache-tags';
import { PRERENDER_SEED_SLUG } from '../../_lib/host';
import { getStorefrontTenant } from '../../_lib/tenant';

/**
 * `/s/{slug}` — **home de la vidriera**. Hoy es un placeholder honesto: resuelve el tenant y lo
 * muestra. **Cero producto**: la grilla y la ficha son S3, y prometer un catálogo vacío que
 * "ya viene" es exactamente la clase de pantalla que hace que el dueño no vuelva.
 *
 * ## Cómo llega el `slug`
 * Por el **path**, reescrito por `apps/web/proxy.ts` desde `{slug}.maat.work`. Nunca por header.
 * El `slug` entra al cache key de `'use cache'` (es un argumento serializable) y a los `cacheTag`.
 * Sin eso, `acme.maat.work` y `beta.maat.work` renderizarían el mismo path con los mismos
 * argumentos y **compartirían la entrada de cache**: el key del CDN incluye el host, pero el de
 * `'use cache'` y el del ISR durable **no**.
 *
 * ## Ausencias deliberadas
 * - **`generateStaticParams` no lista tenants.** Devuelve un único slug semilla, porque su función
 *   acá es cambiar el modo de servido de la ruta (ver abajo), no prerenderizar contenido.
 * - **No hay `export const revalidate`.** El TTL por tiempo es el modelo viejo y acá es una
 *   decisión de plata: `revalidate: 60` son ~USD 2.59/tenant/mes contra ~USD 0.012 con
 *   `cacheLife('max')` + invalidación por evento. 216x.
 * - **No hay `dynamic = 'force-dynamic'` ni `cache: 'no-store'`** "por las dudas".
 */

/**
 * **Esto es lo que hace cacheable a la vidriera. No lo borres porque "no hace nada".**
 *
 * Con `cacheComponents: true`, una ruta con segmento dinámico y **sin** `generateStaticParams` se
 * sirve siempre en modo *postponed*: `Cache-Control: private, no-cache, no-store`, una invocación de
 * función en el **100%** de los pageviews y `x-vercel-cache` que nunca da `HIT` — o sea, el test 1
 * de verificación de ADR-007 falla, aunque los datos sí estén cacheados y Postgres no se toque.
 *
 * Con `generateStaticParams` presente, la ruta pasa a ISR clásico. Medido en `next start` 16.3.3:
 *
 * | host | req 1 | req 2 | `Cache-Control` |
 * |---|---|---|---|
 * | `demo` (tenant real) | `MISS` 200 | `HIT` 200 | `s-maxage=2592000, swr=28944000` |
 * | `nortecel` (tenant creado **después** del build) | `MISS` 200 | `HIT` 200 | idem |
 * | `inexistente9` (no existe) | `MISS` **404** | `HIT` **404** | idem |
 *
 * Las tres filas son gates de ADR-007, incluida la tercera: **404 real y cacheado**.
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

export async function generateMetadata({ params }: StorefrontPageProps): Promise<Metadata> {
  'use cache';
  cacheLife('max');

  const { slug } = await params;
  cacheTag(tenantConfigTag(slug));

  const tenant = await getStorefrontTenant(slug);
  if (tenant === null) {
    return { title: 'Vidriera no encontrada', robots: { index: false, follow: false } };
  }

  return {
    title: tenant.name,
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

export default async function StorefrontHomePage({ params }: StorefrontPageProps) {
  'use cache';
  cacheLife('max');

  const { slug } = await params;
  // El tag va SIEMPRE con el slug adentro: los cache tags de Vercel están scopeados a
  // proyecto + environment, **no a dominio**. Un tag genérico purga a todos los tenants juntos.
  cacheTag(storefrontTag(slug), tenantConfigTag(slug));

  const tenant = await getStorefrontTenant(slug);

  // 404 REAL, no un redirect a la home de marketing. Medido: `HTTP/1.1 404`, `x-nextjs-cache: MISS`
  // la primera vez y `HIT` después, `Cache-Control: s-maxage=2592000, swr=28944000`.
  //
  // Que el status sea 404 y no 200 depende de UNA cosa, y por eso está escrita acá: la doc de
  // `not-found.js` dice que Next devuelve *"200 for streamed responses, and 404 for non-streamed
  // responses"*. Sin `generateStaticParams` esta ruta se sirve en modo *postponed* (streamed) y el
  // mismo código devuelve **200 con contenido de 404** — un soft 404, el peor resultado posible
  // para SEO. Si alguien saca `generateStaticParams`, esto se rompe en silencio.
  //
  // ⚠️ CONTRAPARTIDA OPERATIVA, NO OPCIONAL: como este 404 queda cacheado hasta que expire
  // `cacheLife('max')`, **el alta de un tenant TIENE que invalidar `storefront:{slug}` y
  // `tenant-config:{slug}` de su propio slug**. Si no, alguien visita `acme.maat.work` un minuto
  // antes de que exista el tenant y la vidriera de `acme` nace muerta. Es gate de S1 y está en la
  // skill `isr-revalidate`.
  if (tenant === null) notFound();

  const host = `${tenant.slug}.${STOREFRONT_DOMAIN}`;

  return (
    <main>
      <header className="border-b border-neutral-200 pb-5 dark:border-neutral-800">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{host}</p>
        <h1 className="mt-1 text-2xl font-semibold leading-tight sm:text-3xl">{tenant.name}</h1>
      </header>

      <section
        aria-labelledby="estado-vidriera"
        className="mt-6 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800"
      >
        <h2 id="estado-vidriera" className="text-base font-semibold">
          Vidriera en preparación
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
          Todavía no hay equipos publicados en esta dirección. Cuando {tenant.name} cargue el stock,
          vas a ver acá cada equipo con fotos, condición, batería, garantía y el precio en dólares y
          en pesos.
        </p>
      </section>

      <dl className="mt-6 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
          <dt className="text-neutral-500">Acepta canje</dt>
          <dd className="mt-1 font-medium">{tenant.acceptsTradeIn ? 'Sí' : 'No'}</dd>
        </div>
        <div className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
          <dt className="text-neutral-500">Medios de pago</dt>
          <dd className="mt-1 font-medium">
            {tenant.paymentMethods.length > 0 ? tenant.paymentMethods.join(' · ') : 'A confirmar'}
          </dd>
        </div>
      </dl>

      {/*
        Acá NO va un botón de WhatsApp. El texto canónico de `CLAUDE.md` §1 nombra un equipo y un
        precio concretos; sin ficha no hay equipo, y un `wa.me` genérico ("Hola, vi tu vidriera")
        es exactamente el mensaje sin contexto que el producto existe para eliminar.
        El único `wa.me` de la vidriera se arma en `publicListingDTO` (`@istock/domain`) y sale en
        la ficha, en S3/S4.
      */}
    </main>
  );
}
