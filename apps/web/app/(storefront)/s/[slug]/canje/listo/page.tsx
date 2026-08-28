import type { Metadata } from 'next';
import { cacheLife, cacheTag } from 'next/cache';
import { storefrontTag, tenantConfigTag } from '../../../../_lib/cache-tags';
import { cacheStorefrontMiss } from '../../../../_lib/cache-life';
import { PRERENDER_SEED_SLUG, isSlugShaped } from '../../../../_lib/host';
import { STOREFRONT_HOME_PATH } from '../../../../_lib/routes';
import { getStorefrontTenant } from '../../../../_lib/tenant';
import { STOREFRONT_MISS_METADATA, StorefrontMiss } from '../../../../_components/storefront-miss';
import { TradeinOutcome } from '../../../../_components/tradein-outcome';

/**
 * `/canje/listo` — **el canje entró**. Destino del `303` de `POST /api/tradein` cuando la fila se
 * escribió (`count === 1`).
 *
 * ## Por qué es una página y no un `?ok=1`
 * POST/Redirect/GET. Si la confirmación fuera el cuerpo del POST, un F5 reenviaría el formulario y
 * el dueño recibiría el mismo canje tres veces. Y un `searchParams` volvería la ruta dinámica, que
 * es la forma más cara de decir "listo": esta pantalla es HTML estático, cacheado con el mismo
 * perfil que la vidriera, y no toca Postgres más que para el nombre del negocio.
 *
 * ## Qué promete el texto, y qué no
 * `_lib/status.ts` fija la regla: ningún texto de la vidriera compromete una acción futura
 * **nuestra**. Acá lo que sigue es una acción del **dueño** —un WhatsApp desde su teléfono— y por
 * eso se puede decir, con el sujeto puesto: *"{tenant.name} te escribe"*, no *"te avisamos"*.
 *
 * Y se dice explícitamente que **no** va a llegar un mail, porque el formulario no pidió ninguno:
 * la persona que dejó su teléfono y no ve nada en su casilla tiene que saber dónde mirar.
 *
 * ## Lo que esta página NO muestra
 * Ni un dato del lead que acaba de entrar. No es discreción: `anon` no tiene **SELECT** sobre
 * `tradein_leads` (`drizzle/0008_*`), ni siquiera sobre la fila que acaba de escribir. No hay id
 * que mostrar, no hay "seguimiento" y no puede haberlo — que es exactamente lo que hace que este
 * endpoint no sea un oráculo sobre los canjes de otra gente.
 */
export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  return [{ slug: PRERENDER_SEED_SLUG }];
}

interface TradeinDonePageProps {
  readonly params: Promise<{ readonly slug: string }>;
}

export async function generateMetadata({ params }: TradeinDonePageProps): Promise<Metadata> {
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
    title: { absolute: `Canje enviado — ${tenant.name}` },
    robots: { index: false, follow: true },
  };
}

export default async function TradeinDonePage({ params }: TradeinDonePageProps) {
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
    <TradeinOutcome kicker="Canje enviado" title="Listo, tu canje llegó">
      <p className="mt-3 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
        Lo que dejaste ya está del lado de {tenant.name}. Cuando lo revisen, te escriben por
        WhatsApp al número que pusiste para arreglar cuándo pasás con el equipo.
      </p>
      <p className="mt-3 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
        No te va a llegar ningún mail: no te pedimos ninguno. El precio del canje se define cuando
        ven el equipo en el local.
      </p>

      <p className="mt-8 text-sm">
        <a href={STOREFRONT_HOME_PATH} className="font-medium underline underline-offset-4">
          ← Ver los equipos de {tenant.name}
        </a>
      </p>
    </TradeinOutcome>
  );
}
