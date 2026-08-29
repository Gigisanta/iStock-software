'use server';

import { revalidatePath } from 'next/cache';
import { importListingsFromCsv } from '../../../../_lib/csv-import/import-listings';
import { MAX_CSV_BYTES, checkCsvFile } from '../../../../_lib/csv-import/schema';
import { logEvent } from '../../../../_lib/log';
import { requireTenant } from '../../../../_lib/session';
import { initialImportState, type ImportFormState } from './form-state';

/**
 * Importar stock desde un CSV.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  El orden de las verificaciones es ADR-007, igual que en el alta de a uno
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * 1. **`requireTenant()` primero, adentro de la acción.** Las Server Functions no son rutas
 *    propias en la cadena de matchers de `proxy.ts`: un `matcher` que excluye un path también
 *    saltea las Server Functions de ese path. Un guard en el layout protege la pantalla y deja la
 *    mutación abierta a cualquier `POST` crudo.
 * 2. **El archivo se chequea por forma antes de leerlo** (`checkCsvFile`): extensión, tipo y
 *    peso, sin materializar un byte. Decodificar 1 MB para descubrir que era un `.xlsx` es CPU de
 *    función serverless regalada — el mismo criterio que `checkPhotoFile` en el alta.
 * 3. **Recién ahí `text()`**, y de ahí todo pasa por Zod en `_lib/csv-import/schema.ts`. El CSV es
 *    entrada no confiable: no lo escribió nuestro formulario, lo escribió el Excel de un tercero.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Por qué NO redirige y el resultado se pinta acá
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * El alta de a uno termina en `redirect()`. Este no, y es a propósito: el resultado del import
 * **es** la respuesta. Un POST-redirect-GET a `/app/stock` perdería el *"importamos 47 equipos"* y
 * la lista de las 8 filas a corregir, que son la mitad de la aceptación de esta slice. El dueño
 * quedaría mirando su stock sin saber si entró todo.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Doble submit: qué pasa y qué no se finge
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Subir el mismo archivo dos veces carga los equipos dos veces. **No hay guard de idempotencia** y
 * no se simula uno: hacerlo bien pide una clave de import persistida (tabla nueva, de `db-agent`),
 * y un guard de mentira —un `Map` en memoria, un token en una cookie— daría una garantía que no
 * existe en serverless con varias instancias. Lo que sí hay es lo que se puede sostener: el botón
 * se bloquea mientras la acción corre (`isPending` en el formulario) y el resultado dice cuántos
 * equipos entraron, así que dos imports seguidos se ven como dos resultados y no como uno.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Cache
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `revalidatePath('/app/stock')` para que la lista del panel muestre los equipos nuevos.
 * **Nada de `revalidateTag('storefront:…')`**: todo entra como `draft` y un borrador no está en la
 * vidriera. Tirar el cache del storefront para publicar cero cambios es gastar el 95% de hits que
 * no tocan Postgres (`CLAUDE.md` §0.12). El porqué completo está en `_lib/csv-import/import-listings.ts`.
 *
 * ── Nada de esto se loguea ───────────────────────────────────────────────────────────────────
 * Ni el texto del CSV, ni una fila, ni el nombre del archivo, ni un IMEI. Sólo IDs y números:
 * `_lib/log.ts` no acepta objetos y tiene denylist de nombres de campo.
 */

function fileFromFormData(formData: FormData, key: string): File | null {
  const value = formData.get(key);
  return value instanceof File ? value : null;
}

export async function importCsvAction(
  _prev: ImportFormState,
  formData: FormData,
): Promise<ImportFormState> {
  const session = await requireTenant();

  const check = checkCsvFile(fileFromFormData(formData, 'archivo'));
  if (!check.ok) {
    return { ...initialImportState, status: 'file_error', message: check.reason };
  }

  const text = await check.file.text();

  // Segundo techo, sobre los bytes **decodificados**. `file.size` cuenta bytes del archivo y
  // `text` cuenta caracteres: un CSV en UTF-8 con acentos y emojis puede pasar el primer cap y
  // seguir siendo grande. `MAX_CSV_ROWS` ya acota el trabajo real, pero este corte es anterior a
  // parsear y cuesta una comparación.
  if (text.length > MAX_CSV_BYTES) {
    return {
      ...initialImportState,
      status: 'file_error',
      message: 'Ese archivo es demasiado grande. Partilo en dos y subilo en dos veces.',
    };
  }

  const result = await importListingsFromCsv(session.ctx, text);

  if (!result.ok && result.kind === 'file') {
    return { ...initialImportState, status: 'file_error', message: result.reason };
  }

  if (!result.ok) {
    // Números, no filas. `issues` no viaja a ningún log: es para la pantalla.
    logEvent('listing.import.rejected', {
      tenantId: session.ctx.tenantId,
      rows: result.rowCount,
      issues: result.issueCount,
    });
    return {
      ...initialImportState,
      status: 'row_errors',
      issues: result.issues,
      issueCount: result.issueCount,
      okCount: result.okCount,
      rowCount: result.rowCount,
    };
  }

  revalidatePath('/app/stock');

  return {
    ...initialImportState,
    status: 'imported',
    imported: result.imported,
    ignoredColumns: result.ignoredColumns,
  };
}
