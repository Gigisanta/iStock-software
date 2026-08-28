import 'server-only';
import { and, asc, count, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { PUBLIC_STATUSES } from '@istock/domain';
import { catalogModels, listings } from '@istock/db';
import { withTenantDb, type TenantContext } from '../db/session';
import type { StockListRow } from './build-input';

/**
 * La lectura que alimenta `/app/lista`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Las dos capas de tenant, otra vez
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `withTenantDb` prende RLS (`listings_tenant_select`) **y** cada `where` lleva su
 * `eq(listings.tenantId, ctx.tenantId)` explícito. `CLAUDE.md` §2: las dos, siempre. Acá pesa más
 * que en otras pantallas: lo que sale de esta query se convierte en un texto que el dueño pega en
 * un estado público. Una fila de otro negocio no se filtraría por soporte, se publicaría.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Lo que NO se selecciona
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `cost_usd`, `margin_usd`, `imei`, `internal_notes`, `supplier`, `master_key`. No se ocultan más
 * arriba: **no se piden**. `StockListUnit` tampoco los tiene, así que hay dos allowlists en serie
 * y ninguna de las dos depende de que alguien se acuerde. Y la consecuencia práctica: el `seller`
 * y el `owner` corren **el mismo SQL** en esta pantalla, porque no hay una sola columna acá que
 * uno pueda ver y el otro no.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  El filtro es el mismo que ve el visitante, ni uno más
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `status in PUBLIC_STATUSES` **y** `published_at is not null` son, juntos, la policy
 * `listings_storefront_anon_select` escrita en el builder. No es una restricción de más: cada
 * renglón de esta lista termina en un link a la ficha, y una fila que no pasa esa policy es un
 * **404 pegado en un estado de Instagram**. El trigger `listings_stamp_published_at` (migración
 * 0002) garantiza que estado público ⇒ `published_at` no nulo, así que el segundo predicado no
 * puede sacar nada hoy; el día que pudiera, lo que sacaría sería una ficha invisible para el
 * comprador.
 *
 * Lo que sí se trae completo son los **tres** estados públicos, `sold` incluido. Es el mismo
 * conjunto que publica la vidriera y no se recorta acá: recortarlo sería decidir por el dueño qué
 * equipos "no vale la pena" mostrar, y el vendido es prueba social. Lo que sí se hace es
 * **ordenarlo**: disponibles, después reservados, después vendidos. Como `buildStockList` reparte
 * en bloques respetando el orden, los vendidos caen al final — o sea al último bloque, que el
 * dueño puede simplemente no pegar. Nada se descarta y el que decide es él.
 */

/**
 * Techo de unidades de una lista. Mismo espíritu que `STOCK_PAGE_SIZE`: el ICP tiene 20–200
 * equipos y esto se abre en el 4G de un local.
 *
 * **Tocar el techo no es descartar en silencio**: cuando se toca, se hace la segunda query de
 * conteo y la pantalla dice cuántos equipos publicados hay en total contra cuántos entraron. El
 * `count` sólo corre en ese caso — con menos filas que el techo, `rows.length` ya es la verdad.
 */
export const STOCK_LIST_MAX_UNITS = 100;

/**
 * Primero lo que se puede comprar hoy. Se ordena en **SQL** y no en TS porque el `limit` corta
 * después del `order by`: con el orden en memoria, el equipo 101 disponible se perdería detrás de
 * 100 vendidos. Es la misma expresión que usa la grilla de la vidriera, por el mismo motivo.
 */
const STATUS_ORDER = sql`case ${listings.status} when 'available' then 0 when 'reserved' then 1 else 2 end`;

export interface PublishedUnits {
  /** Hasta `STOCK_LIST_MAX_UNITS` filas, en el orden en que van a salir en el texto. */
  readonly rows: readonly StockListRow[];
  /**
   * Cuántas unidades publicadas tiene el tenant. Igual a `rows.length` salvo que se haya tocado
   * el techo, que es el único caso en el que la pantalla tiene algo distinto que contar.
   */
  readonly total: number;
}

export async function listPublishedUnitsForStockList(ctx: TenantContext): Promise<PublishedUnits> {
  return withTenantDb(ctx, async (tx) => {
    const rows = await tx
      .select({
        slug: listings.slug,
        title: listings.title,
        modelDisplayName: catalogModels.displayName,
        storageGb: listings.storageGb,
        color: listings.color,
        condition: listings.condition,
        priceUsdCents: listings.priceUsd,
        status: listings.status,
      })
      .from(listings)
      .leftJoin(catalogModels, eq(listings.catalogModelId, catalogModels.id))
      .where(
        and(
          eq(listings.tenantId, ctx.tenantId),
          inArray(listings.status, [...PUBLIC_STATUSES]),
          isNotNull(listings.publishedAt),
        ),
      )
      .orderBy(STATUS_ORDER, desc(listings.publishedAt), asc(listings.slug))
      .limit(STOCK_LIST_MAX_UNITS);

    if (rows.length < STOCK_LIST_MAX_UNITS) return { rows, total: rows.length };

    // Mismo predicado que arriba, palabra por palabra: dos filtros distintos darían dos números
    // que no se pueden comparar, y el que se muestra en pantalla es la diferencia entre los dos.
    const totals = await tx
      .select({ value: count() })
      .from(listings)
      .where(
        and(
          eq(listings.tenantId, ctx.tenantId),
          inArray(listings.status, [...PUBLIC_STATUSES]),
          isNotNull(listings.publishedAt),
        ),
      );

    return { rows, total: totals[0]?.value ?? rows.length };
  });
}
