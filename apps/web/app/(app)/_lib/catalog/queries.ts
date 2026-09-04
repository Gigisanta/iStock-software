import 'server-only';
import { and, asc, desc, eq } from 'drizzle-orm';
import { catalogModels } from '@istock/db';
import { withTenantDb, type TenantContext } from '../db/session';

/**
 * Los modelos del catálogo, para el `<select>` del alta.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Esta es la ÚNICA query del panel sin `where tenant_id = …`, y está bien.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `CLAUDE.md` §2 rechaza toda query sin filtro de tenant *además* de RLS. `catalog_models` es la
 * excepción declarada del schema (`packages/db/src/schema/catalog.ts`): **no tiene `tenant_id` y
 * no tiene RLS**, a propósito. "iPhone 14 Pro" no es un dato del reseller, es un hecho del mundo,
 * y es el mismo para los 100 tenants. No hay nada que aislar porque no hay dato de nadie.
 *
 * Lo que la mantiene segura no es un `where`, son dos cosas que ya están en la migración:
 * 1. El `GRANT` de `authenticated` sobre esta tabla es **`SELECT` y nada más**
 *    (`0001_rls_and_grants.sql`). Un usuario logueado no puede escribir el catálogo de todos.
 * 2. Se puebla por seed/migración con `service_role`, nunca desde el panel.
 *
 * Escribir `eq(catalogModels.tenantId, …)` acá sería imposible (la columna no existe) y pedirla
 * sería el camino a copiar 100× la misma fila. Si un día un tenant necesita un modelo propio,
 * `catalog.ts` ya dice qué hacer: una tabla `tenant_catalog_overrides` con `tenant_id` + RLS.
 *
 * Corre igual bajo `withTenantDb`, o sea como `authenticated` con los claims puestos: es el rol
 * que tiene el `GRANT`. Con `withServiceDb` andaría también y sería un privilegio de más por nada.
 *
 * ── Por qué no se cachea (todavía) ───────────────────────────────────────────────────────────
 * Son 32 filas de variantes y se leen en **una** pantalla del panel autenticado, no en la
 * vidriera. El presupuesto de `CLAUDE.md` §0.12 es sobre los hits anónimos; meter `'use cache'`
 * acá agregaría una entrada de cache y un tag que invalidar por un `select` que corre cuando el
 * dueño carga un equipo. Si algún día el alta se usa en lote, se cachea con `cacheLife` largo:
 * el catálogo cambia cuando Apple presenta un teléfono.
 */

export interface CatalogModelOption {
  readonly id: string;
  readonly displayName: string;
  /** Para agrupar en el `<optgroup>`: "iPhone", "iPad". */
  readonly family: string;
  readonly storageOptionsGb: readonly number[];
  readonly colors: readonly string[];
}

export async function listCatalogModels(ctx: TenantContext): Promise<readonly CatalogModelOption[]> {
  const rows = await withTenantDb(ctx, async (tx) => {
    const rows = await tx
      .select({
        id: catalogModels.id,
        displayName: catalogModels.displayName,
        family: catalogModels.family,
        storageOptionsGb: catalogModels.storageOptionsGb,
        colors: catalogModels.colors,
      })
      .from(catalogModels)
      .where(eq(catalogModels.isActive, true))
      // Lo más nuevo primero: es lo que más se carga. `displayName` desempata para que el orden
      // sea determinista y el `<select>` no se reordene entre renders.
      .orderBy(asc(catalogModels.family), desc(catalogModels.releaseYear), asc(catalogModels.displayName));

    return rows;
  });

  return rows.map((row) => ({
    ...row,
    storageOptionsGb: [...row.storageOptionsGb],
    colors: [...row.colors],
  }));
}

/** Devuelve una variante activa para que el server valide también un POST armado a mano. */
export async function getCatalogModel(
  ctx: TenantContext,
  id: string,
): Promise<CatalogModelOption | null> {
  // web-lint:sin-tenant catálogo global sin tenant_id; se lee sólo para validar la variante elegida
  const rows = await withTenantDb(ctx, async (tx) =>
    tx
      .select({
        id: catalogModels.id,
        displayName: catalogModels.displayName,
        family: catalogModels.family,
        storageOptionsGb: catalogModels.storageOptionsGb,
        colors: catalogModels.colors,
      })
      .from(catalogModels)
      .where(and(eq(catalogModels.id, id), eq(catalogModels.isActive, true)))
      .limit(1),
  );

  const row = rows[0];
  if (row === undefined) return null;
  return {
    ...row,
    storageOptionsGb: [...row.storageOptionsGb],
    colors: [...row.colors],
  };
}
