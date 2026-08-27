// NOTA PARA EL LEAD: acá debería ir `import 'server-only'`, que es el guard que hace **fallar el
// build** si este módulo termina importado desde un Client Component. El paquete `server-only` no
// está en `apps/web/package.json` y ese archivo es del LEAD, así que no lo agrego yo.
// Mientras tanto el guard de hecho es `@istock/db` → `postgres` (driver de Node): un import desde
// cliente rompe igual, pero con un error de bundling críptico en vez de uno que se entiende.
// Pedido concreto: `pnpm --filter @istock/web add server-only`.

import { cacheLife, cacheTag } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { createDb, tenants, type Database } from '@istock/db';
import { SLUG_RE, isReservedSubdomain } from './host';
import { storefrontTag, tenantConfigTag } from './cache-tags';

/**
 * DAL de la vidriera. **El único lugar de `(storefront)` que habla con Postgres.**
 *
 * ## Presupuesto
 * 1 query en el cache miss, **0 en el hit** (ADR-003, `CLAUDE.md` §3: 95% de los hits sin Postgres).
 * `cacheLife('max')` (stale 5m · revalidate 30d · expire 1y) + invalidación por evento vía
 * `revalidateTag('storefront:{slug}', 'max')` desde el panel.
 *
 * **`revalidate: 60` está prohibido y es una decisión de plata, no de UX**: 43.200 regeneraciones
 * por tenant por mes ≈ USD 2.59/tenant/mes contra USD 0.012 con `'max'`. 216x, el 13% del plan Base
 * de USD 19, y por sí solo revienta el objetivo de < USD 0.50/tenant.
 *
 * ## Por qué el visitante no es un cliente de Postgres
 * `packages/db/drizzle/0001_rls_and_grants.sql`: **`anon` no tiene ningún GRANT**, ni hoy ni sobre
 * la tabla que se cree el mes que viene. El 5% que falla el cache lo resuelve **el server**, con
 * conexión propia y con **filtro de tenant explícito** (`where slug = ...`), que es la defensa en
 * profundidad que pide `CLAUDE.md` §2 además de RLS.
 *
 * ## Lo que NO cruza
 * `tenants.id` (el `tenant_id`) y `tenants.wa_phone` **no salen de esta función**. El `id` no se
 * publica nunca; el teléfono se usa para armar el `wa.me` dentro de `publicListingDTO`
 * (`@istock/domain`) y aparece en la URL del botón, no como dato suelto en el HTML.
 */

/**
 * Pool memoizado a nivel de módulo. **Esto es legal acá y sería un bug en `proxy.ts`**: el proxy
 * corre fuera del runtime de la app y la doc dice explícito que no dependas de globals; este
 * módulo corre dentro de la función de la página.
 *
 * `max: 1`: Vercel abre una función por request y Postgres cobra por conexión. Un pool grande en
 * serverless no da throughput, agota el pool.
 */
let memoizedDb: Database | null = null;

function db(): Database {
  if (memoizedDb === null) memoizedDb = createDb({ max: 1 }).db;
  return memoizedDb;
}

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
 * que dejó de pagar es prometer disponibilidad que nadie va a atender por WhatsApp.
 *
 * ⚠️ **El `null` se cachea**, y eso es a propósito: un slug inexistente da un 404 barato y
 * repetible en vez de una query por cada bot que escanea subdominios. La contracara es un
 * requisito operativo que **no es opcional**: el alta de un tenant (y su reactivación) **tiene que
 * invalidar `storefront:{slug}` y `tenant-config:{slug}`**, o el 404 negativo queda cacheado hasta
 * 30 días y la vidriera nace muerta. Es parte del gate de S1 y está en la skill `isr-revalidate`.
 */
export async function getStorefrontTenant(slug: string): Promise<StorefrontTenant | null> {
  'use cache';
  cacheLife('max');
  // El slug va en el tag SIEMPRE: los tags son de proyecto+environment, no de dominio.
  cacheTag(storefrontTag(slug), tenantConfigTag(slug));

  // Segunda validación (la primera la hizo el proxy). Esta función es exportada y el día que
  // alguien la llame desde otro lado, el slug basura entra por acá.
  if (!SLUG_RE.test(slug)) return null;

  // Reservados (`www`, `app`, `api`, …) no son tenants y no se preguntan. Además de ser la misma
  // regla que aplica el proxy, esto es lo que permite que `generateStaticParams` prerenderice
  // `PRERENDER_SEED_SLUG` **sin abrir una conexión a Postgres en el build**.
  if (isReservedSubdomain(slug)) return null;

  const rows = await db()
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
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;

  return {
    slug: row.slug,
    name: row.name,
    acceptsTradeIn: row.acceptsTradeIn,
    paymentMethods: [...row.paymentMethods],
  };
}
