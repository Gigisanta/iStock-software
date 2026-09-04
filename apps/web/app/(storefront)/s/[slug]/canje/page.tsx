import type { Metadata } from 'next';
import { cacheLife, cacheTag } from 'next/cache';
import { storefrontTag, tenantConfigTag } from '../../../_lib/cache-tags';
import { cacheStorefrontMiss } from '../../../_lib/cache-life';
import { PRERENDER_SEED_SLUG, isSlugShaped } from '../../../_lib/host';
import { STOREFRONT_HOME_PATH } from '../../../_lib/routes';
import { getStorefrontTenant } from '../../../_lib/tenant';
import { STOREFRONT_MISS_METADATA, StorefrontMiss } from '../../../_components/storefront-miss';
import { TradeinForm } from '../../../_components/tradein-form';

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  `/canje` — el visitante ofrece su equipo en parte de pago. Página estática, formulario nativo.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * El canje presencial es un flujo de primera clase del producto (`CLAUDE.md` §1) y hasta S8 la
 * vidriera sólo sabía decir *"sí, toman canje"* en una fila de la ficha. Esta página es la otra
 * mitad: el visitante deja qué tiene y cómo ubicarlo, y el dueño lo evalúa desde el panel.
 *
 * ## Por qué es una página propia y no un bloque dentro de la ficha
 * Tres razones, y ninguna es de diseño visual:
 * 1. **La ficha ya tiene un único llamado a la acción** y es el `wa.me` (`CLAUDE.md` §1). Un
 *    segundo formulario compitiendo con el botón, en la pantalla donde alguien decidió comprar,
 *    convierte peor los dos.
 * 2. **El canje no cuelga de ningún equipo.** `tradein_leads` no tiene `listing_id`: alguien puede
 *    querer entregar su teléfono sin haber elegido cuál se lleva. Meter el formulario adentro de la
 *    ficha ataría el lead a una unidad que el dominio no ata.
 * 3. **Cache.** El formulario depende sólo de `tenant-config:{slug}` (nombre del negocio y si toma
 *    canje). Adentro de la ficha viviría en una entrada que se purga cada vez que cambia el equipo.
 *
 * ## Los tres caminos, y el perfil de cache de cada uno
 * | camino | qué se ve | perfil |
 * |---|---|---|
 * | slug con forma inválida, o vidriera que no existe | `<StorefrontMiss />` | `cacheStorefrontMiss()` |
 * | el negocio **no** toma canje | lo dice, sin formulario | `cacheLife('max')` |
 * | el negocio toma canje | el formulario | `cacheLife('max')` |
 *
 * **El tag es sólo `tenant-config:{slug}`, nunca el del catálogo** — misma lección que la ficha
 * (S6.1): un tag es un OR, y registrar `storefront:{slug}` acá haría que reservar una unidad
 * purgara también esta página, que no muestra ni un equipo. En el camino del miss sí se registran
 * los dos, igual que en la ficha y por el mismo motivo escrito allá.
 *
 * ## `noindex, follow`, y no es un descuido
 * `(storefront)/layout.tsx` declara `index: true` porque que Google encuentre la vidriera real es
 * parte del producto. Esta página **no** es vidriera: es un formulario sin stock, sin precio y sin
 * fotos, y su texto es casi idéntico entre tenants. Indexarla es ofrecerle a Google N páginas finas
 * y competirle posiciones a las fichas, que son las que traen a alguien que quiere comprar.
 * `follow: true` para que el link de vuelta a la grilla sí se siga.
 *
 * ## Lo que esta página NO hace
 * - **No lee el body de ningún POST.** El formulario postea a `/api/tradein`, que es un `route.ts`
 *   con path propio para que el WAF pueda ponerle techo sin tocar los pageviews de la vidriera.
 * - **No muestra ningún lead.** `anon` no tiene SELECT sobre `tradein_leads` — ni siquiera del que
 *   acaba de dejar (`drizzle/0008_*`). No hay "mis canjes" y no puede haberlo.
 */

/**
 * Obligatorio: sin esto la ruta vuelve a modo *postponed*, el `Cache-Control` pasa a
 * `private, no-cache, no-store` y **todos** los pageviews invocan una función. El argumento largo
 * está en `s/[slug]/page.tsx`. El slug semilla es un subdominio reservado, así que el loader lo
 * corta antes de abrir conexión y `next build` sigue compilando sin `DATABASE_URL`.
 */
export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  return [{ slug: PRERENDER_SEED_SLUG }];
}

/** El formulario público entrega HTML completo; la navegación es por `<a>` y POST/Redirect/GET. */
export const instant = false;

interface TradeinPageProps {
  readonly params: Promise<{ readonly slug: string }>;
}

export async function generateMetadata({ params }: TradeinPageProps): Promise<Metadata> {
  'use cache';

  const { slug } = await params;

  // Antes de `cacheTag()`, siempre: `tenantConfigTag()` tira con un slug basura y bajo
  // `cacheComponents` + PPR un throw de render no es un 500, es un stream que no cierra.
  if (!isSlugShaped(slug)) {
    cacheStorefrontMiss();
    return STOREFRONT_MISS_METADATA;
  }

  cacheTag(tenantConfigTag(slug));

  const tenant = await getStorefrontTenant(slug);
  if (tenant === null) {
    cacheStorefrontMiss();
    cacheTag(storefrontTag(slug));
    return STOREFRONT_MISS_METADATA;
  }

  cacheLife('max');

  return {
    title: { absolute: `Canje - ${tenant.name}` },
    description: `Entregá tu equipo usado como parte de pago en ${tenant.name}.`,
    robots: { index: false, follow: true },
  };
}

export default async function TradeinPage({ params }: TradeinPageProps) {
  'use cache';

  const { slug } = await params;

  if (!isSlugShaped(slug)) {
    cacheStorefrontMiss();
    return <StorefrontMiss />;
  }

  cacheTag(tenantConfigTag(slug));

  const tenant = await getStorefrontTenant(slug);
  if (tenant === null) {
    cacheStorefrontMiss();
    cacheTag(storefrontTag(slug));
    return <StorefrontMiss />;
  }

  cacheLife('max');

  return (
    <main data-storefront="tradein">
      <meta name="robots" content="noindex, follow" />

      <p className="storefront-kicker">
        {tenant.name}
      </p>
      <h1>
        Entregá tu equipo en parte de pago
      </h1>

      {tenant.acceptsTradeIn ? (
        <>
          <p className="mt-3 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
            Contanos qué tenés y cómo ubicarte. {tenant.name} lo revisa y te escribe por WhatsApp
            para arreglar cuándo pasás a que lo vean.
          </p>
          <TradeinForm tenantName={tenant.name} />
        </>
      ) : (
        /*
          Honestidad, misma regla que el badge de estado: si el dueño no tiene el canje prendido, la
          vidriera lo dice y no muestra un formulario que después no va a poder entrar. La sentencia
          del handler igual lo verifica (`and t.accepts_trade_in`), porque un POST a mano se saltea
          esta pantalla — pero la pantalla no puede mentir mientras tanto.
        */
        <p className="mt-3 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
          {tenant.name} no está tomando equipos usados como parte de pago en este momento. Si te
          interesa algún equipo del catálogo, escribiles desde la ficha y consultales.
        </p>
      )}

      <p className="mt-8 border-t border-neutral-200 pt-5 text-sm dark:border-neutral-800">
        <a href={STOREFRONT_HOME_PATH} className="font-medium underline underline-offset-4">
          ← Ver los equipos de {tenant.name}
        </a>
      </p>
    </main>
  );
}
