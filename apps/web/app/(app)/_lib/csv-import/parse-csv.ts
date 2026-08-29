/**
 * Tokenizador de CSV. **Puro, sin I/O, sin dependencias** — mitad de abajo de S10.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Por qué se escribe a mano en vez de agregar una librería
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * El stack está cerrado (`CLAUDE.md` §3) y una dependencia nueva se pide, no se agrega. Pero el
 * motivo de fondo no es burocrático: lo que este archivo tiene que devolver **no es lo que
 * devuelve un parser de CSV genérico**. La aceptación de S10 dice *"errores por fila"*, y "fila"
 * significa *el renglón que el dueño ve numerado en el costado de su Excel*. Un parser genérico
 * devuelve un array de arrays y pierde exactamente ese número. Acá cada registro sale con su
 * `line`, y ese es el 80% del valor del archivo.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Qué se soporta, y por qué cada cosa
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * 1. **BOM.** Excel de Windows escribe `UTF-8 con BOM` por default. Sin sacarlo, el encabezado
 *    de la primera columna se llama `﻿modelo` y no matchea nunca. Es el fallo más común y
 *    el más difícil de explicar por teléfono: se ve idéntico en pantalla.
 * 2. **`;` además de `,`.** El Excel en español (es-AR) exporta *"CSV delimitado por comas"* con
 *    **punto y coma**, porque la coma es el separador decimal del locale. Un import que sólo
 *    entiende `,` rechaza el archivo que produce la máquina del cliente.
 * 3. **Comillas con `""` adentro** y saltos de línea dentro de comillas (RFC 4180): una
 *    descripción con una coma es normal.
 * 4. **`\r\n`, `\n` y `\r` sueltos** como fin de registro.
 * 5. **Líneas en blanco se descartan**, incluidas las del final. Excel deja una casi siempre, y
 *    reportarla como *"fila 201: falta el modelo"* sería mandar al dueño a buscar un fantasma.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Lo que NO hace, a propósito
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * No adivina tipos, no normaliza encabezados y no sabe qué es un equipo. Devuelve celdas de texto
 * con su número de línea. La semántica la pone `./schema.ts` (Zod) y `./build-import.ts`. El corte
 * es el mismo de `_lib/stock-list/`: lógica pura y testeable de un lado, `server-only` del otro.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  El número de línea con saltos adentro de comillas
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `line` es la línea física **donde arranca** el registro. Con una descripción multilínea, el
 * registro ocupa varias líneas físicas y el número de Excel deja de coincidir con el conteo de
 * `\n` — pero sigue coincidiendo con el renglón donde el dueño ve empezar la fila, que es lo que
 * él va a buscar. Se prefiere el número que sirve para encontrar la fila antes que el que sirve
 * para contar bytes.
 */

/** Separadores que se prueban. Orden irrelevante: gana el que más aparezca en el encabezado. */
export const CSV_DELIMITERS = [',', ';', '\t'] as const;

export interface CsvRecord {
  /** Línea física del archivo donde arranca el registro. El encabezado es la **1**. */
  readonly line: number;
  readonly cells: readonly string[];
}

export interface CsvTable {
  /** Primer registro no vacío. Sin normalizar: eso es de `./schema.ts`. */
  readonly header: CsvRecord;
  readonly records: readonly CsvRecord[];
  /** El separador que se detectó. Se devuelve para poder decirlo en un mensaje de error. */
  readonly delimiter: string;
}

export type CsvParseResult =
  | { readonly ok: true; readonly table: CsvTable }
  | { readonly ok: false; readonly reason: string };

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Cuenta separadores **en la primera línea lógica** (fuera de comillas) y devuelve el que más
 * aparece. Empate o cero ocurrencias → `,`, que es el default de RFC 4180.
 *
 * Se mira sólo el encabezado a propósito: es la línea que con más probabilidad no tiene comillas
 * ni texto libre, o sea la menos ruidosa del archivo.
 */
export function detectDelimiter(text: string): string {
  const counts = new Map<string, number>(CSV_DELIMITERS.map((d) => [d, 0]));
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === undefined) break;
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) continue;
    if (ch === '\n' || ch === '\r') break;
    const seen = counts.get(ch);
    if (seen !== undefined) counts.set(ch, seen + 1);
  }

  let best = ',';
  let bestCount = 0;
  for (const d of CSV_DELIMITERS) {
    const n = counts.get(d) ?? 0;
    if (n > bestCount) {
      best = d;
      bestCount = n;
    }
  }
  return best;
}

/**
 * Texto → tabla. `maxRecords` cuenta **filas de datos**, sin el encabezado.
 *
 * Devuelve `ok: false` sólo cuando el archivo entero no se puede leer: vacío, comilla sin cerrar,
 * sin encabezado, o por encima del techo de filas. Todo lo demás es un problema **de una fila** y
 * se resuelve más arriba, con su número — que es lo que pide la aceptación de S10.
 */
export function parseCsv(input: string, maxRecords: number): CsvParseResult {
  const text = stripBom(input);
  if (text.trim() === '') {
    return { ok: false, reason: 'El archivo está vacío.' };
  }

  const delimiter = detectDelimiter(text);
  const records: CsvRecord[] = [];

  let cells: string[] = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  /** `true` mientras no se consumió ningún carácter del registro actual. */
  let fresh = true;
  let overflow = false;

  const endRecord = (): void => {
    cells.push(field);
    field = '';
    const blank = cells.every((cell) => cell.trim() === '');
    if (!blank) {
      // El techo se chequea acá y no al final: un archivo de 200.000 filas no se termina de
      // materializar en RAM para después decir que no entraba.
      if (records.length > maxRecords) overflow = true;
      else records.push({ line: recordLine, cells });
    }
    cells = [];
    fresh = true;
  };

  for (let i = 0; i < text.length && !overflow; i += 1) {
    const ch = text[i];
    if (ch === undefined) break;

    if (fresh) {
      recordLine = line;
      fresh = false;
    }

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
        continue;
      }
      if (ch === '\n') line += 1;
      field += ch;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === delimiter) {
      cells.push(field);
      field = '';
      continue;
    }
    if (ch === '\r') {
      if (text[i + 1] === '\n') i += 1;
      endRecord();
      line += 1;
      continue;
    }
    if (ch === '\n') {
      endRecord();
      line += 1;
      continue;
    }
    field += ch;
  }

  if (inQuotes) {
    return {
      ok: false,
      reason:
        'Hay una comilla (") sin cerrar en el archivo. Revisá que cada comilla que abre tenga la que cierra.',
    };
  }

  if (!fresh && !overflow) endRecord();

  // Sólo `overflow`, y no un segundo `records.length > maxRecords`: `records` **incluye el
  // encabezado**, así que compararlo contra un techo que cuenta filas de datos rechaza un archivo
  // de exactamente `maxRecords` equipos. Es un off-by-one que le niega al dueño el archivo que le
  // dijimos que entraba, y lo encendió el caso "acepta exactamente `maxRecords`" del test — el
  // otro lado del borde, que sin él habría quedado verde con el techo corrido en uno.
  if (overflow) {
    return {
      ok: false,
      reason: `El archivo tiene más de ${String(maxRecords)} filas. Partilo en dos y subilo en dos veces.`,
    };
  }

  const header = records[0];
  if (header === undefined) {
    return { ok: false, reason: 'El archivo está vacío.' };
  }
  if (records.length === 1) {
    return {
      ok: false,
      reason: 'El archivo tiene el encabezado pero ninguna fila de equipos.',
    };
  }

  return { ok: true, table: { header, records: records.slice(1), delimiter } };
}
