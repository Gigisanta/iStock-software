import type { RowIssue } from '../../../../_lib/csv-import/build-import';

/**
 * Estado de la pantalla de import. Vive aparte de `actions.ts` porque un archivo `'use server'`
 * sólo puede exportar funciones async.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Cuatro estados, y ninguno se puede confundir con otro
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * La aceptación de S10 prohíbe el resultado ambiguo: *importar 188 de 200 y decir "importado"*.
 * El diseño elegido es **todo o nada** (el porqué está en `_lib/csv-import/build-import.ts`), y
 * este tipo es lo que hace que la pantalla no pueda mentir aunque quiera:
 *
 * - `idle` — todavía no se subió nada.
 * - `imported` — entraron **todas**. `imported` es a la vez lo que entró y lo que había.
 * - `file_error` — el archivo entero no se pudo leer o no corresponde. No hay filas que mostrar.
 * - `row_errors` — **no entró nada** y hay una lista de filas para corregir.
 *
 * `row_errors` es el que tiene el veneno, y por eso lleva `okCount` **y** `rowCount`: la pantalla
 * dice *"no importamos nada: 3 de 11 filas están bien, estas 8 hay que corregirlas"*. Un estado
 * que llevara sólo la lista de errores dejaría al dueño creyendo que algo entró.
 *
 * No hay un estado `partial`, y no es un olvido: **no existe**. Si algún día el diseño cambiara a
 * parcial-anunciado, agregar el estado obliga a tocar este archivo y a nombrarlo, que es
 * exactamente la fricción que se busca.
 */

export type ImportStatus = 'idle' | 'imported' | 'file_error' | 'row_errors';

export interface ImportFormState {
  readonly status: ImportStatus;
  /** Para `file_error`. En castellano y con qué hacer al respecto. */
  readonly message: string;
  /** Para `imported`. */
  readonly imported: number;
  /** Para `row_errors`. Recortada a `MAX_ISSUES_REPORTED`; el total va en `issueCount`. */
  readonly issues: readonly RowIssue[];
  readonly issueCount: number;
  /** Cuántas filas estaban bien. **Nunca** entraron: el import es todo o nada. */
  readonly okCount: number;
  readonly rowCount: number;
  /** Columnas del archivo que no usamos. Se nombran para que ignorarlas no sea silencioso. */
  readonly ignoredColumns: readonly string[];
}

export const initialImportState: ImportFormState = {
  status: 'idle',
  message: '',
  imported: 0,
  issues: [],
  issueCount: 0,
  okCount: 0,
  rowCount: 0,
  ignoredColumns: [],
};
