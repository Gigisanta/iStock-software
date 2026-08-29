import 'server-only';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { catalogModels, listings } from '@istock/db';
import type { Tx } from '../db/connection';
import type { CatalogEntry } from './build-import';

/**
 * Las **dos lecturas** que necesita el import, y nada más.
 *
 * Las dos toman una `Tx` en vez de abrir la suya: corren adentro de la misma transacción que
 * escribe (`./import-listings.ts`). No es prolijidad — es lo que hace que el chequeo de IMEI
 * repetido signifique algo. Con una lectura en su propia transacción, entre "leí los IMEIs
 * ocupados" y "escribí las 200 filas" hay una ventana en la que otra pestaña del mismo dueño da de
 * alta un equipo con ese IMEI. Adentro de la transacción sigue habiendo carrera, pero la resuelve
 * Postgres con `listings_tenant_imei_key` y el import entero se cae — que es la respuesta correcta
 * bajo "todo o nada", y no un import de 199 filas con una silenciosamente ausente.
 */

/**
 * El catálogo activo. **Es la única lectura del panel sin `where tenant_id = …`, y está bien**:
 * `catalog_models` no tiene `tenant_id` y no tiene RLS a propósito (`packages/db/src/schema/catalog.ts`).
 * "iPhone 14 Pro" es un hecho del mundo, el mismo para los 100 tenants; lo que la protege es que
 * el `GRANT` de `authenticated` sobre esa tabla es `SELECT` y nada más. El razonamiento completo
 * está en `_lib/catalog/queries.ts`, que hace esta misma excepción para el `<select>` del alta.
 *
 * Se traen **todos** los modelos activos (~40 filas de tres columnas) en vez de consultar por los
 * nombres del CSV: buscar por nombre exigiría mandarle a Postgres la normalización que
 * `catalogKey` hace en TS, o sea dos normalizaciones que se pueden desincronizar. Una lista de 40
 * filas indexada en memoria es más barata y tiene una sola definición de "misma clave".
 */
export async function readCatalogForImport(tx: Tx): Promise<readonly CatalogEntry[]> {
  return tx
    .select({
      id: catalogModels.id,
      slug: catalogModels.slug,
      displayName: catalogModels.displayName,
    })
    .from(catalogModels)
    .where(eq(catalogModels.isActive, true));
}

/**
 * De los IMEIs que trae el archivo, cuáles ya están cargados **en este tenant**.
 *
 * Se pregunta por los del archivo (`inArray`) y no se trae la columna entera: con 3.000 equipos,
 * traer todos los IMEIs a memoria para comparar 200 sería mover datos sensibles sin necesidad.
 *
 * Dos capas de tenant, como pide `CLAUDE.md` §2: RLS por `withTenantDb` **y** el
 * `eq(listings.tenantId, ctx.tenantId)` explícito. Acá la segunda capa no es ceremonia: sin ella,
 * una policy aflojada convertiría esta lectura en un oráculo que dice si **otro** negocio tiene
 * cargado un IMEI determinado.
 */
export async function readTakenImeis(
  tx: Tx,
  tenantId: string,
  imeis: readonly string[],
): Promise<ReadonlySet<string>> {
  if (imeis.length === 0) return new Set();

  const rows = await tx
    .select({ imei: listings.imei })
    .from(listings)
    .where(
      and(eq(listings.tenantId, tenantId), isNotNull(listings.imei), inArray(listings.imei, [...imeis])),
    );

  const taken = new Set<string>();
  for (const row of rows) {
    if (row.imei !== null) taken.add(row.imei);
  }
  return taken;
}
