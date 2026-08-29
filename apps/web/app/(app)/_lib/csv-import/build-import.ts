import { sanitizeDescription, type Condition } from '@istock/domain';
import { TITLE_MAX_LENGTH } from '../listings/schema';
import { parseCsv, type CsvRecord } from './parse-csv';
import {
  CSV_FIELDS,
  MAX_CSV_ROWS,
  REQUIRED_CSV_FIELDS,
  canonicalField,
  csvRowSchema,
  normalizeHeader,
  type CsvField,
  type CsvRowInput,
} from './schema';

/**
 * El plan de import. **Puro, sin I/O, sin `server-only`** — decide qué se va a escribir y qué está
 * mal, pero no escribe nada. Es la misma mitad que `_lib/stock-list/build-input.ts`: la lógica que
 * decide vive de este lado y se testea sin base, y `./queries.ts` + `./import-listings.ts` ponen
 * el Postgres del otro.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  "Sin import parcial silencioso": se eligió TODO O NADA. El motivo.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * La aceptación de S10 admite dos diseños honestos —*todo o nada*, o *parcial pero anunciado*— y
 * prohíbe el tercero, que es importar 188 de 200 y decir "importado". Acá se eligió **todo o
 * nada**, y el argumento que decide no es de pureza: es **qué puede hacer el dueño después**.
 *
 * Un import parcial deja al dueño con un archivo que ya entró a medias. Para terminar el trabajo
 * tiene que subir el resto, y ahí aparece el problema: **una unidad importada no tiene clave
 * natural**. El IMEI es opcional (`listings_tenant_imei_key` es un índice único **parcial**, sólo
 * sobre las filas con IMEI no nulo), y un iPhone 14 Pro 256 Grafito a USD 620 es indistinguible
 * del de al lado — porque muchas veces hay dos. O sea: **no hay forma de reconocer que una fila ya
 * se importó**. Las opciones que le quedan al dueño son editar el CSV a mano para borrar las
 * filas que entraron —contando renglones— o volver a subir el archivo entero y duplicar stock. La
 * segunda es la que va a elegir un tipo apurado en un mostrador, y duplicar stock es peor que no
 * importar nada: se publica dos veces el mismo equipo y se vende uno que no existe.
 *
 * Con todo o nada, el ciclo es: subir → ver **todos** los errores → corregir el Excel → subir el
 * mismo archivo otra vez. Reintentar es seguro por construcción, porque antes no entró nada.
 *
 * El precio de esta elección es real y es uno solo: **un typo en la fila 200 frena las 199
 * buenas**. Se paga con la contrapartida obligatoria, que es la mitad del diseño y no un extra:
 * **se validan TODAS las filas antes de cortar**, nunca se para en el primer error. Un import que
 * abortara en el primero convertiría 12 errores en 12 viajes; validando todo son 12 renglones en
 * una pantalla y un solo viaje. Por eso `resolveImportPlan` acumula y no hace `return` temprano.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  "Errores por fila": el número es el del Excel del dueño
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `RowIssue.line` es la **línea física del archivo**, contando el encabezado como la 1 — o sea el
 * número que el dueño ve en el costado de su planilla. No es el índice de la fila de datos: decir
 * "fila 42" cuando en la planilla es la 43 manda a corregir el equipo equivocado, y el dueño lo
 * descubre publicando.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Los mensajes no republican el contenido de la celda. Con UNA excepción declarada.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `CLAUDE.md` §1 y §2: el IMEI no va a logs ni a un DTO, y el costo no cruza. Un mensaje de error
 * es texto que termina en el HTML, en el estado del formulario y en la captura de pantalla que el
 * dueño manda por WhatsApp a soporte. Todos los mensajes de acá se arman con constantes; lo
 * variable es el número de fila, el nombre de la columna y —única excepción— **el texto del modelo
 * que no se encontró en el catálogo**, recortado a `MODEL_ECHO_MAX_CHARS`.
 *
 * Esa excepción es necesaria: *"no conocemos ese modelo"* sin decir cuál, en un archivo de 200
 * filas con 6 modelos distintos mal escritos, no es accionable. Y es segura por lo que es ese
 * dato: el nombre comercial de un teléfono, escrito por el dueño, público por definición. No es
 * IMEI, no es costo, no es una nota interna. `build-import.test.ts` afirma que ninguna otra celda
 * llega a un mensaje — en particular que un IMEI inválido nunca se imprime.
 */

/** Ver el docblock: el nombre del modelo se cita recortado; ninguna otra celda se cita. */
const MODEL_ECHO_MAX_CHARS = 40;

/**
 * Cuántos errores se devuelven para pintar. Con 500 filas malas serían ~1500 renglones de HTML en
 * un celular: la pantalla dejaría de ser accionable justo cuando más lo necesita. Se cortan acá y
 * se devuelve `issueCount` con el total, para que la pantalla pueda decir "y N más" — que es la
 * diferencia entre recortar y **esconder**, y es la misma regla que el resto de la slice.
 */
export const MAX_ISSUES_REPORTED = 50;

export interface RowIssue {
  /** Línea física del archivo. El encabezado es la 1. */
  readonly line: number;
  /** Nombre canónico de la columna, o `null` si el problema es de la fila entera. */
  readonly column: CsvField | null;
  readonly message: string;
}

/** Lo que se va a insertar. Sin `tenantId`: eso lo pone `./import-listings.ts`, en el `values()`. */
export interface DraftUnit {
  readonly line: number;
  readonly title: string;
  readonly catalogModelId: string;
  readonly condition: Condition;
  readonly priceUsdCents: number;
  readonly costUsdCents: number | null;
  readonly storageGb: number | null;
  readonly color: string | null;
  readonly batteryPct: number | null;
  readonly imei: string | null;
  readonly description: string | null;
}

export interface ReadRow {
  readonly line: number;
  /** Texto crudo del modelo. Se conserva aunque la fila tenga otros errores: ver `resolveImportPlan`. */
  readonly modelText: string;
  /** `null` si la fila no pasó Zod. Los motivos ya están en `issues`. */
  readonly values: CsvRowInput | null;
}

export interface ImportReadOk {
  readonly rows: readonly ReadRow[];
  readonly issues: readonly RowIssue[];
  /** Columnas del archivo que no usamos. Se informan: ignorar en silencio es la falla de la slice. */
  readonly ignoredColumns: readonly string[];
  /** El archivo trae columna de costo. Lo mira la Server Action para decidir por rol. */
  readonly hasCostColumn: boolean;
  /** Filas de datos leídas, buenas y malas. */
  readonly rowCount: number;
}

export type ImportRead =
  | { readonly ok: false; readonly reason: string }
  | { readonly ok: true; readonly read: ImportReadOk };

export interface CatalogEntry {
  readonly id: string;
  readonly slug: string;
  readonly displayName: string;
}

export interface ResolveDeps {
  readonly catalog: readonly CatalogEntry[];
  /** IMEIs que este tenant ya tiene cargados. Los lee `./queries.ts` con su filtro de tenant. */
  readonly takenImeis: ReadonlySet<string>;
}

export type ImportPlan =
  | { readonly ok: true; readonly units: readonly DraftUnit[] }
  | {
      readonly ok: false;
      /** Hasta `MAX_ISSUES_REPORTED`. El total real está en `issueCount`. */
      readonly issues: readonly RowIssue[];
      readonly issueCount: number;
      /** Cuántas filas **habrían** entrado. Se muestra para que el dueño mida lo que le falta. */
      readonly okCount: number;
      readonly rowCount: number;
    };

/**
 * Clave de comparación de un modelo. Misma normalización que los encabezados: minúsculas, sin
 * acentos, todo lo que no es alfanumérico a `_`. Así `"iPhone 14 Pro"`, `"iphone 14 pro"` y el
 * slug `"iphone-14-pro"` son la misma clave.
 *
 * **No hay match difuso, y es una decisión, no una limitación.** Un match por distancia elige
 * "iPhone 14" cuando el dueño escribió "iPhone 15" y publica el equipo equivocado sin que nadie se
 * entere. Eso es exactamente la clase de fallo silencioso que esta slice existe para prohibir:
 * preferimos un error que el dueño corrige en 10 segundos antes que un acierto probable.
 */
export function catalogKey(text: string): string {
  return normalizeHeader(text);
}

/**
 * Índice de búsqueda. Un modelo entra por su `displayName` y por su `slug`.
 *
 * Si dos modelos distintos normalizan a la misma clave, la clave queda **ambigua** (`null`) en vez
 * de que gane el primero: elegir uno de dos en silencio es el mismo fallo que el match difuso.
 */
export function buildCatalogIndex(
  catalog: readonly CatalogEntry[],
): ReadonlyMap<string, CatalogEntry | null> {
  const index = new Map<string, CatalogEntry | null>();
  const put = (key: string, entry: CatalogEntry): void => {
    if (key === '') return;
    const seen = index.get(key);
    if (seen === undefined) {
      index.set(key, entry);
      return;
    }
    if (seen !== null && seen.id !== entry.id) index.set(key, null);
  };
  for (const entry of catalog) {
    put(catalogKey(entry.displayName), entry);
    put(catalogKey(entry.slug), entry);
  }
  return index;
}

/** Etiqueta legible de una columna, para el mensaje "falta la columna X". */
function columnList(fields: readonly CsvField[]): string {
  return fields.join(', ');
}

/**
 * Paso 1: archivo → filas validadas con Zod. **No toca el catálogo ni la base.**
 *
 * Devuelve `ok: false` sólo cuando el archivo entero no sirve —no se puede leer, le falta una
 * columna obligatoria, tiene una columna repetida—, porque en esos casos no hay ningún error "por
 * fila" que reportar: están todas mal por el mismo motivo y el dueño arregla el encabezado una vez.
 */
export function readImportCsv(text: string): ImportRead {
  const parsed = parseCsv(text, MAX_CSV_ROWS);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };

  const { header, records } = parsed.table;

  const columnOf: (CsvField | null)[] = [];
  const ignoredColumns: string[] = [];
  const seen = new Map<CsvField, number>();

  for (const [i, raw] of header.cells.entries()) {
    const field = canonicalField(raw);
    if (field === null) {
      columnOf[i] = null;
      const label = raw.trim();
      if (label !== '') ignoredColumns.push(label);
      continue;
    }
    const previous = seen.get(field);
    if (previous !== undefined) {
      return {
        ok: false,
        reason: `La columna "${field}" está dos veces en el encabezado. Dejá una sola y volvé a subirlo.`,
      };
    }
    seen.set(field, i);
    columnOf[i] = field;
  }

  const missing = REQUIRED_CSV_FIELDS.filter((field) => !seen.has(field));
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `Al encabezado le faltan columnas: ${columnList(missing)}. Bajate la plantilla y copiá tus datos ahí.`,
    };
  }

  const rows: ReadRow[] = [];
  const issues: RowIssue[] = [];

  for (const record of records) {
    const { line } = record;
    const shapeIssue = checkCellCount(record, header.cells.length);
    if (shapeIssue !== null) issues.push(shapeIssue);

    const raw: Record<string, string> = {};
    for (const field of Object.values(CSV_FIELDS)) raw[field] = '';
    for (const [i, cell] of record.cells.entries()) {
      const field = columnOf[i];
      if (field !== null && field !== undefined) raw[field] = cell;
    }

    const modelText = (raw[CSV_FIELDS.model] ?? '').trim().replace(/\s+/gu, ' ');
    const result = csvRowSchema.safeParse(raw);

    if (result.success) {
      rows.push({ line, modelText, values: result.data });
      continue;
    }
    for (const issue of result.error.issues) {
      issues.push({
        line,
        column: (issue.path[0] as CsvField | undefined) ?? null,
        message: issue.message,
      });
    }
    rows.push({ line, modelText, values: null });
  }

  return {
    ok: true,
    read: {
      rows,
      issues,
      ignoredColumns,
      hasCostColumn: seen.has(CSV_FIELDS.costUsd),
      rowCount: records.length,
    },
  };
}

/**
 * Una fila con más celdas que el encabezado casi siempre es una coma adentro de un texto sin
 * comillas, y el efecto es que los valores quedan **corridos**: el color termina en el precio. Con
 * menos celdas pasa lo mismo al revés. Se reporta como problema de la fila —no de una columna—
 * porque no hay una sola columna culpable, y se reporta **además** de los errores de Zod: los dos
 * juntos son lo que explica qué pasó.
 */
function checkCellCount(record: CsvRecord, expected: number): RowIssue | null {
  if (record.cells.length === expected) return null;
  return {
    line: record.line,
    column: null,
    message:
      record.cells.length > expected
        ? `Esta fila tiene ${String(record.cells.length)} columnas y el encabezado tiene ${String(expected)}. Suele pasar cuando hay un separador adentro de un texto: poné ese texto entre comillas.`
        : `Esta fila tiene ${String(record.cells.length)} columnas y el encabezado tiene ${String(expected)}. Fijate que no le falte un dato.`,
  };
}

/**
 * Paso 2: filas validadas + catálogo + IMEIs ya cargados → unidades a insertar, **o** la lista
 * completa de lo que hay que corregir.
 *
 * El chequeo de catálogo corre sobre **toda** fila que traiga texto de modelo, incluidas las que
 * ya fallaron Zod por otra columna. Es a propósito y es lo que hace que un solo viaje alcance: si
 * la fila 43 tiene el precio mal **y** el modelo mal, el dueño se entera de las dos cosas ahora y
 * no en la segunda subida.
 */
export function resolveImportPlan(read: ImportReadOk, deps: ResolveDeps): ImportPlan {
  const index = buildCatalogIndex(deps.catalog);
  const issues: RowIssue[] = [...read.issues];
  const units: DraftUnit[] = [];

  /** IMEI → primera línea donde apareció **en este archivo**. */
  const firstImeiLine = new Map<string, number>();

  for (const row of read.rows) {
    const model = row.modelText === '' ? undefined : index.get(catalogKey(row.modelText));

    if (row.modelText !== '' && model === undefined) {
      issues.push({
        line: row.line,
        column: CSV_FIELDS.model,
        message: `No tenemos ese modelo en el catálogo ("${truncate(row.modelText)}"). Escribilo igual que en la lista de modelos del alta.`,
      });
    }
    if (model === null) {
      issues.push({
        line: row.line,
        column: CSV_FIELDS.model,
        message: `Ese nombre coincide con más de un modelo del catálogo ("${truncate(row.modelText)}"). Escribilo completo.`,
      });
    }

    const values = row.values;
    if (values === null) continue;

    const imei = values[CSV_FIELDS.imei];
    const description = values[CSV_FIELDS.description];
    if (imei !== null) {
      const previous = firstImeiLine.get(imei);
      if (previous !== undefined) {
        // Nunca se imprime el IMEI: se señala la otra fila, que es lo que el dueño necesita para
        // encontrarlo. `CLAUDE.md` §1.
        issues.push({
          line: row.line,
          column: CSV_FIELDS.imei,
          message: `Este IMEI está repetido: ya aparece en la fila ${String(previous)} de este mismo archivo.`,
        });
      } else {
        firstImeiLine.set(imei, row.line);
        if (deps.takenImeis.has(imei)) {
          issues.push({
            line: row.line,
            column: CSV_FIELDS.imei,
            message: 'Ya tenés un equipo cargado con este IMEI.',
          });
        }
      }
    }

    if (model === undefined || model === null) continue;

    units.push({
      line: row.line,
      title: buildTitle(values, model.displayName),
      catalogModelId: model.id,
      condition: values[CSV_FIELDS.condition],
      priceUsdCents: values[CSV_FIELDS.priceUsd],
      costUsdCents: values[CSV_FIELDS.costUsd],
      storageGb: values[CSV_FIELDS.storageGb],
      color: values[CSV_FIELDS.color],
      batteryPct: values[CSV_FIELDS.batteryPct],
      imei,
      // Se sanea acá, del lado puro, con la misma función que usa el alta de a una
      // (`_lib/listings/create-listing.ts`). Dos saneadores distintos para el mismo campo es cómo
      // se termina publicando en la vidriera algo que el alta habría limpiado.
      description: description === null ? null : sanitizeDescription(description),
    });
  }

  if (issues.length > 0) {
    issues.sort((a, b) => a.line - b.line);
    return {
      ok: false,
      issues: issues.slice(0, MAX_ISSUES_REPORTED),
      issueCount: issues.length,
      okCount: units.length,
      rowCount: read.rowCount,
    };
  }

  return { ok: true, units };
}

/**
 * El nombre que ve el comprador. Si el dueño puso uno en la columna `titulo`, manda el suyo; si
 * no, se arma con el modelo del catálogo + GB + color, que es exactamente como lo arma la lista
 * para estados (`_lib/stock-list/build-input.ts`) y como lo escribiría él.
 *
 * El recorte a `TITLE_MAX_LENGTH` sólo puede tocar al título **derivado** —el del dueño ya lo validó Zod contra
 * el mismo techo—, así que no hay dato de nadie que se pierda en silencio.
 */
function buildTitle(values: CsvRowInput, displayName: string): string {
  const own = values[CSV_FIELDS.title];
  if (own !== null) return own;

  const storage = values[CSV_FIELDS.storageGb];
  const parts = [displayName, storage === null ? null : `${String(storage)} GB`, values[CSV_FIELDS.color]];
  return parts.filter((part): part is string => part !== null && part !== '').join(' ')
    .slice(0, TITLE_MAX_LENGTH);
}

function truncate(text: string): string {
  return text.length <= MODEL_ECHO_MAX_CHARS ? text : `${text.slice(0, MODEL_ECHO_MAX_CHARS)}…`;
}
