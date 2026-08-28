// `server-only` hace **fallar el build** si este módulo termina importado desde un Client
// Component. Ya está en `apps/web/package.json`, así que el guard es real y no una nota al pie.
import 'server-only';

import { cacheLife, cacheTag } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { tenants } from '@istock/db';
import { withStorefrontDb } from './storefront-db';
import { isReservedSubdomain, isSlugShaped } from './host';
import { storefrontTag, tenantConfigTag } from './cache-tags';
import { STOREFRONT_MISS_LIFE } from './cache-life';

/**
 * DAL de la vidriera. **El único lugar de `(storefront)` que habla con Postgres.**
 *
 * ## Presupuesto
 * 1 query en el cache miss, **0 en el hit** (ADR-003, `CLAUDE.md` §3: 95% de los hits sin Postgres).
 * `cacheLife('max')` (stale 5m · revalidate 30d · expire 1y) en el camino positivo, invalidado por
 * evento vía `revalidateTag('storefront:{slug}')` / `updateTag` desde el panel.
 *
 * **`revalidate: 60` está prohibido y es una decisión de plata, no de UX**: 43.200 regeneraciones
 * por tenant por mes ≈ USD 2.59/tenant/mes contra USD 0.012 con `'max'`. 216x, el 13% del plan Base
 * de USD 19, y por sí solo revienta el objetivo de < USD 0.50/tenant.
 *
 * ## El camino negativo NO usa el mismo perfil (decisión del LEAD, MEDIUM-C)
 * Ver `_lib/cache-life.ts`. Un `null` cacheado 30 días es (a) envenenamiento sin límite con slugs
 * elegidos por un atacante y (b) un tenant que se da de alta después nace muerto. El perfil corto
 * es el tirador; el `updateTag` del alta sigue siendo el cinturón.
 *
 * ## Por qué el visitante NO es un cliente de Postgres, y por qué igual bajamos de rol
 * Está explicado una sola vez, en `_lib/storefront-db.ts`, que es de donde sale `withStorefrontDb`
 * desde S3. Resumen: toda query de la vidriera corre `set local role anon` + los claims del slug
 * dentro de una transacción, y el `where slug = …` explícito se queda **además** de la policy.
 *
 * ## Lo que NO cruza
 * `tenants.id` (el `tenant_id`) y `tenants.wa_phone` **no salen de esta función**. El `id` no se
 * publica nunca; el teléfono se usa para armar el `wa.me` dentro de `publicListingDTO`
 * (`@istock/domain`) y aparece en la URL del botón, no como dato suelto en el HTML.
 */

/**
 * Lo mínimo para pintar el encabezado de una vidriera. Deliberadamente chico: cada campo que se
 * agregue acá es un campo que viaja al HTML público de todos los tenants.
 */
export interface StorefrontTenant {
  /** El subdominio. Es público por definición: está en la URL. */
  readonly slug: string;
  /** Nombre del comercio, tal como lo tipeó el dueño. */
  readonly name: string;
  /** Se muestra en la ficha (`CLAUDE.md` §1: "canje sí/no"). */
  readonly acceptsTradeIn: boolean;
  /** Se muestran en la ficha ("medios de pago"). Texto libre corto del dueño. */
  readonly paymentMethods: readonly string[];
}

/**
 * Resuelve `slug → tenant`. `null` si no existe **o si no está `active`**.
 *
 * Un tenant `suspended`/`cancelled` **no** tiene vidriera: seguir publicando el stock de alguien
 * que dejó de pagar es prometer disponibilidad que nadie va a atender por WhatsApp. Y no depende
 * de que esta query se acuerde: la policy `tenants_storefront_anon_select` también exige
 * `status = 'active'`.
 *
 * ⚠️ **El `null` se cachea, pero corto** (`STOREFRONT_MISS_LIFE`). Un slug inexistente sigue
 * resolviéndose con una respuesta barata y repetible —la página de miss de ADR-011: `200` con
 * `noindex`, ya no un 404— en vez de una query por cada bot que escanea subdominios, pero la
 * entrada expira en minutos: nadie puede sembrar entradas durables con slugs inventados, y un
 * tenant que se dé de alta después no queda invisible más que unos minutos aunque el `updateTag`
 * del alta falle.
 */
export async function getStorefrontTenant(slug: string): Promise<StorefrontTenant | null> {
  'use cache';

  // ── ORDEN, NO ESTILO. Esta guarda va ANTES de `cacheTag()` y ese es el fix del HIGH de S1. ────
  // Estaba tres líneas más abajo, y ahí **nunca devolvía `null`: explotaba antes**, porque
  // `storefrontTag()` → `assertSlug()` tira con un slug basura. O sea: la "defensa en profundidad"
  // que este comentario prometía no existía, y en su lugar había una excepción de render que bajo
  // `cacheComponents` + PPR no es un 500 sino un stream que no cierra, con `200` y `no-store`.
  // Un input inválido no puede convertirse en un throw de render: se contesta, no se lanza.
  //
  // `isSlugShaped` es puro y devuelve `false`; no tira. `SLUG_RE`/`isSlugShaped` salen de
  // `@istock/domain` vía `_lib/host.ts`, que ahora es un alias y ya no una segunda copia del regex.
  if (!isSlugShaped(slug)) {
    // Sin `cacheTag`: un slug con esta forma no puede darse de alta nunca (`CHECK
    // tenants_slug_format` de `packages/db`), así que no hay evento futuro que invalidar, y
    // `storefrontTag()` tiraría igual. Lo único que acota esta entrada es el perfil corto.
    cacheLife(STOREFRONT_MISS_LIFE);
    return null;
  }

  // El slug va en el tag SIEMPRE: los tags son de proyecto+environment, no de dominio.
  cacheTag(storefrontTag(slug), tenantConfigTag(slug));

  // Reservados (`www`, `app`, `api`, …) no son tenants y no se preguntan. Además de ser la misma
  // regla que aplica el proxy, esto es lo que permite que `generateStaticParams` prerenderice
  // `PRERENDER_SEED_SLUG` **sin abrir una conexión a Postgres en el build**.
  if (isReservedSubdomain(slug)) {
    cacheLife(STOREFRONT_MISS_LIFE);
    return null;
  }

  const rows = await withStorefrontDb(slug, async (tx) =>
    tx
      .select({
        slug: tenants.slug,
        name: tenants.name,
        acceptsTradeIn: tenants.acceptsTradeIn,
        paymentMethods: tenants.paymentMethods,
      })
      .from(tenants)
      // Filtro de tenant EXPLÍCITO además de RLS (CLAUDE.md §5). Acá el filtro *es* el slug: la
      // query no puede devolver la fila de otro tenant ni con la policy caída.
      .where(and(eq(tenants.slug, slug), eq(tenants.status, 'active')))
      .limit(1),
  );

  const row = rows[0];
  if (row === undefined) {
    // Perfil corto: ver `_lib/cache-life.ts`. `cacheLife` se llama DESPUÉS del await a propósito
    // — el perfil se aplica a la entrada que se está por escribir, y sólo acá se sabe cuál de los
    // dos casos es. Verificado con `next build` + `next start` y curl, no deducido.
    cacheLife(STOREFRONT_MISS_LIFE);
    return null;
  }

  // Camino positivo: `'max'` (stale 5m · revalidate 30d · expire 1y). Esto es lo que compra los
  // ~USD 0.012/tenant/mes.
  cacheLife('max');

  return {
    slug: row.slug,
    name: row.name,
    acceptsTradeIn: row.acceptsTradeIn,
    paymentMethods: [...row.paymentMethods],
  };
}
