import type { Metadata } from 'next';
import { cacheLife, cacheTag } from 'next/cache';
import { storefrontTag, tenantConfigTag } from '../../../../_lib/cache-tags';
import { cacheStorefrontMiss } from '../../../../_lib/cache-life';
import { PRERENDER_SEED_SLUG, isSlugShaped } from '../../../../_lib/host';
import { STOREFRONT_HOME_PATH, TRADEIN_PATH } from '../../../../_lib/routes';
import { getStorefrontTenant } from '../../../../_lib/tenant';
import { STOREFRONT_MISS_METADATA, StorefrontMiss } from '../../../../_components/storefront-miss';
import { TradeinOutcome } from '../../../../_components/tradein-outcome';

/**
 * `/canje/reintentar` — **el canje no entró**. Destino del `303` de `POST /api/tradein` en todos
 * los demás casos.
 *
 * ## Una sola pantalla para cinco causas, y es a propósito
 * Llegan acá el body que no validó, el `42501` de la policy, un `CHECK` violado, la conexión caída
 * y el negocio que dejó de tomar canje. Decir cuál fue tendría dos costos y ningún beneficio:
 *
 * - **Es un oráculo.** Es el único endpoint del producto sin login. Un mensaje que distinga "el
 *   teléfono es muy largo" de "este negocio no toma canje" le describe gratis la forma de la tabla
 *   y el estado de los tenants a cualquiera que tenga `curl`.
 * - **No le cambia nada a la persona.** Tiene el formulario a un toque, con los mismos límites
 *   puestos en el HTML: lo que va a hacer es mirar lo que escribió y mandarlo de nuevo, sea cual
 *   sea la causa.
 *
 * El mensaje de Postgres no cruza al cliente ni por status ni por cuerpo. Lo que sí cruza es lo
 * único cierto y lo único accionable: **no quedó registrado, volvé a mandarlo**.
 *
 * ## Por qué no dice "error"
 * Porque la mitad de las veces no lo es: un campo que se pasó de largo no es una falla del sistema
 * y tratarlo como tal asusta a quien iba a vender su teléfono. El texto describe el estado del
 * mundo —no quedó registrado— y da el siguiente paso.
 *
 * ## Por qué no hay un `wa.me` de escape
 * `CLAUDE.md` §1: el único botón de WhatsApp de la vidriera vive en la ficha y su texto nombra un
 * equipo y un precio concretos. Un `wa.me` genérico desde acá sería el mensaje sin contexto que el
 * producto existe para eliminar, y además rompería la afirmación estructural de `ficha.test.ts` de
 * que un solo componente emite la URL de WhatsApp.
 */
export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  return [{ slug: PRERENDER_SEED_SLUG }];
}

interface TradeinRetryPageProps {
  readonly params: Promise<{ readonly slug: string }>;
}

export async function generateMetadata({ params }: TradeinRetryPageProps): Promise<Metadata> {
  'use cache';

  const { slug } = await params;

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
    title: { absolute: `El canje no se envió — ${tenant.name}` },
    robots: { index: false, follow: true },
  };
}

export default async function TradeinRetryPage({ params }: TradeinRetryPageProps) {
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
    <TradeinOutcome kicker="Canje sin enviar" title="Tu canje no quedó registrado">
      <p className="mt-3 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
        No llegó nada del lado de {tenant.name}, así que nadie te va a escribir por esto. Revisá que
        el nombre, el WhatsApp y el equipo estén completos y mandalo de nuevo.
      </p>

      <a
        href={TRADEIN_PATH}
        className="mt-6 flex min-h-12 w-full items-center justify-center rounded-xl bg-neutral-900 px-4 text-base font-semibold text-white dark:bg-white dark:text-neutral-900"
      >
        Volver al formulario
      </a>

      <p className="mt-6 text-sm">
        <a href={STOREFRONT_HOME_PATH} className="font-medium underline underline-offset-4">
          ← Ver los equipos de {tenant.name}
        </a>
      </p>
    </TradeinOutcome>
  );
}
