import 'server-only';
import { randomFillSync, randomUUID } from 'node:crypto';
import { listingEvents, listings } from '@istock/db';
import { uniqueViolationConstraint } from '../db/pg-error';
import { withTenantDb, type TenantContext } from '../db/session';
import { buildListingSlug } from '../listings/listing-slug';
import { logError, logEvent } from '../log';
import { readImportCsv, resolveImportPlan, type RowIssue } from './build-import';
import { readCatalogForImport, readTakenImeis } from './queries';

/**
 * La escritura del import. **Una transacción, todas las filas o ninguna.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Por qué la atomicidad no se delega a "validamos bien antes"
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `./build-import.ts` explica *por qué* el import es todo-o-nada (resumen: una unidad importada no
 * tiene clave natural, así que después de un import parcial no hay forma segura de reintentar). Lo
 * que se agrega acá es que esa promesa **no se puede sostener sólo validando**: entre la
 * validación y la escritura hay constraints de Postgres que pueden fallar igual —un IMEI que otra
 * pestaña cargó hace dos segundos, una colisión de slug—, y sin transacción el archivo entraría a
 * medias justo en el caso que menos esperamos. Los `insert` van adentro del mismo `withTenantDb`
 * que las lecturas; si algo revienta, el `rollback` deja la base como estaba y el dueño vuelve a
 * subir el mismo archivo sin duplicar nada.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Un solo `insert` multi-fila, no 200 sueltos
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * 200 `insert` de a uno son 200 round-trips contra Postgres desde una función serverless: segundos
 * de latencia que el dueño mira parado en el mostrador, y presupuesto de conexión de Neon Postgres
 * gastado al pedo. `MAX_CSV_ROWS` (500) × ~15 columnas son ~7.500 parámetros, muy por debajo del
 * techo de 65.535 del protocolo de Postgres, así que una sola sentencia alcanza y sobra.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Todo entra como `draft`. Por eso NO se invalida el cache de la vidriera.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `CLAUDE.md` §0.7 pide `revalidateTag('storefront:{slug}')` en toda mutación que cambie stock
 * **visible**. Un borrador no es visible: la policy `listings_storefront_anon_select` y la query de
 * la vidriera filtran por `PUBLIC_STATUSES` + `published_at is not null`, y un `draft` no pasa
 * ninguno de los dos. Invalidar acá tiraría el cache de toda la vidriera —el 95% de hits que no
 * tocan Postgres, que es el presupuesto de §0.12— para publicar exactamente cero cambios. La
 * invalidación vive donde el equipo entra o sale de la vidriera, que es `publish-listing.ts`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  `cost_usd` se decide en el server, dos veces
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * §0.9: el `seller` no ve costo ni margen, **ni en el payload**. Acá se corta dos veces:
 *
 * 1. Un archivo con columna de costo subido por un `seller` **se rechaza entero**, con mensaje. La
 *    alternativa —importar ignorando esa columna— sería cargar 200 equipos distintos de lo que el
 *    archivo decía sin avisarle a nadie: el mismo fallo silencioso que la slice prohíbe, movido de
 *    las filas a las columnas.
 * 2. El `values()` vuelve a preguntar por el rol. La primera capa es la que da el mensaje
 *    entendible; la segunda es la que sigue siendo cierta si mañana alguien llama a esta función
 *    desde otro lado.
 */

export interface ImportOk {
  readonly ok: true;
  readonly imported: number;
  /** Columnas del archivo que no usamos. La pantalla las nombra: ignorar callado no es opción. */
  readonly ignoredColumns: readonly string[];
}

export interface ImportRejected {
  readonly ok: false;
  readonly kind: 'file';
  readonly reason: string;
}

export interface ImportRowErrors {
  readonly ok: false;
  readonly kind: 'rows';
  readonly issues: readonly RowIssue[];
  readonly issueCount: number;
  readonly okCount: number;
  readonly rowCount: number;
}

export type ImportResult = ImportOk | ImportRejected | ImportRowErrors;

/** Reintentos por colisión de slug. Mismo criterio que `createUnit`: el sufijo es aleatorio. */
const SLUG_ATTEMPTS = 3;

function newSlug(title: string): string {
  return buildListingSlug(title, randomFillSync(new Uint8Array(8)));
}

/**
 * Texto del CSV → equipos cargados como borrador.
 *
 * El orden importa y es el mismo de siempre: **validar todo primero, escribir después**. Las
 * lecturas de catálogo e IMEIs pasan adentro de la transacción que después escribe.
 */
export async function importListingsFromCsv(
  ctx: TenantContext,
  text: string,
): Promise<ImportResult> {
  const parsed = readImportCsv(text);
  if (!parsed.ok) return { ok: false, kind: 'file', reason: parsed.reason };

  const read = parsed.read;

  if (read.hasCostColumn && ctx.role !== 'owner') {
    return {
      ok: false,
      kind: 'file',
      reason:
        'Ese archivo trae una columna de costo y tu usuario no carga costos. Sacá esa columna y volvé a subirlo.',
    };
  }

  for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt += 1) {
    try {
      const result = await withTenantDb(ctx, async (tx) => {
        const catalog = await readCatalogForImport(tx);
        const imeis = read.rows
          .map((row) => row.values?.imei ?? null)
          .filter((imei): imei is string => imei !== null);
        const takenImeis = await readTakenImeis(tx, ctx.tenantId, imeis);

        const planned = resolveImportPlan(read, { catalog, takenImeis });
        if (!planned.ok) {
          return {
            ok: false as const,
            kind: 'rows' as const,
            issues: planned.issues,
            issueCount: planned.issueCount,
            okCount: planned.okCount,
            rowCount: planned.rowCount,
          };
        }

        // Sin filas no hay `insert`: Drizzle tira con un `values([])` y, sobre todo, no hay nada
        // que escribir. `parseCsv` ya rechaza el archivo que sólo tiene encabezado, así que llegar
        // acá con cero unidades es imposible hoy; se contempla igual porque el costo es una línea.
        if (planned.units.length === 0)
          return { ok: true as const, imported: 0, ignoredColumns: read.ignoredColumns };

        // El `id` se genera acá y no se deja al `DEFAULT` de Postgres porque `listing_events`
        // necesita el `listing_id` de cada fila **en la misma sentencia**. Un solo array de pares
        // alimenta los dos `insert`: dos mapas separados serían dos fuentes del mismo id, y el día
        // que se desincronicen los eventos apuntarían a otro equipo.
        const planRows = planned.units.map((unit) => ({ id: randomUUID(), unit }));

        await tx.insert(listings).values(
          planRows.map(({ id, unit }) => ({
            id,
            // Las dos capas: RLS por `withTenantDb` y el tenant explícito en el `values()`.
            // W015 lo exige literal acá adentro, y con razón: un `insert` no tiene `where` donde
            // atarlo.
            tenantId: ctx.tenantId,
            slug: newSlug(unit.title),
            kind: 'unit' as const,
            title: unit.title,
            // Sin modelo de catálogo la unidad nace impublicable (`checkPublishable` deniega
            // `missing_catalog_model`), por eso una fila sin modelo conocido es un error de fila y
            // no un import con `null`.
            catalogModelId: unit.catalogModelId,
            storageGb: unit.storageGb,
            color: unit.color,
            condition: unit.condition,
            batteryPct: unit.batteryPct,
            imei: unit.imei,
            description: unit.description,
            priceUsd: unit.priceUsdCents,
            costUsd: ctx.role === 'owner' ? unit.costUsdCents : null,
            qty: 1,
            status: 'draft' as const,
            createdBy: ctx.userId,
          })),
        );

        // Bitácora. `metadata` NUNCA lleva IMEI, costo ni notas internas: acá sólo va de dónde
        // vino el alta, que es lo que sirve para entender un stock cargado en lote.
        await tx.insert(listingEvents).values(
          planRows.map(({ id }) => ({
            tenantId: ctx.tenantId,
            listingId: id,
            kind: 'created' as const,
            toStatus: 'draft' as const,
            actorUserId: ctx.userId,
            metadata: { source: 'csv_import' },
          })),
        );

        return {
          ok: true as const,
          imported: planned.units.length,
          ignoredColumns: read.ignoredColumns,
        };
      });

      if (result.ok) {
        // IDs y números, nunca filas (`CLAUDE.md` §2). `units` no dice qué equipos son.
        logEvent('listing.import.done', { tenantId: ctx.tenantId, units: result.imported });
      }
      return result;
    } catch (error) {
      if (uniqueViolationConstraint(error) === 'listings_tenant_slug_key') continue;

      // Una carrera de IMEI: entre la lectura y el `insert`, otra pestaña cargó ese equipo. El
      // archivo entero se cayó solo (transacción), así que la respuesta honesta es pedir que lo
      // vuelva a subir — y el reintento va a mostrar el IMEI repetido como error de fila.
      if (uniqueViolationConstraint(error) === 'listings_tenant_imei_key') {
        logError('listing.import.imei_race', '23505', { tenantId: ctx.tenantId });
        return {
          ok: false,
          kind: 'file',
          reason:
            'Mientras importábamos, alguien cargó un equipo con uno de esos IMEI. No entró nada: volvé a subir el archivo.',
        };
      }
      throw error;
    }
  }

  logError('listing.import.slug_exhausted', '23505', { tenantId: ctx.tenantId });
  return {
    ok: false,
    kind: 'file',
    reason: 'No pudimos generar los links de esos equipos. Probá de nuevo en un minuto.',
  };
}
