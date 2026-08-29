import { describe, expect, it } from 'vitest';
import { CONDITIONS, conditionLabel, waConditionLabel } from '@istock/domain';
import { readImportCsv, resolveImportPlan, type CatalogEntry } from './build-import';
import {
  CSV_FIELDS,
  MAX_CSV_BYTES,
  MAX_CSV_ROWS,
  canonicalField,
  checkCsvFile,
  csvRowSchema,
  csvTemplate,
  normalizeHeader,
} from './schema';

/**
 * El borde del import: la forma del archivo y el significado de cada celda.
 *
 * `build-import.test.ts` prueba el plan; acá se prueba lo de más afuera —qué archivo se acepta
 * antes de leerlo— y lo de más adentro —qué texto se convierte en qué dato—, que son las dos
 * puntas por donde entra basura.
 */

const CATALOG: readonly CatalogEntry[] = [
  { id: 'model-14-pro', slug: 'iphone-14-pro', displayName: 'iPhone 14 Pro' },
];

function fakeFile(name: string, type: string, size: number): File {
  const file = new File(['x'], name, { type });
  // `File` calcula `size` del contenido; para probar el cap sin materializar un MB se sobrescribe.
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('checkCsvFile · lo que se rechaza antes de leer un byte', () => {
  it('sin archivo, lo pide', () => {
    const result = checkCsvFile(null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/elegí el archivo/iu);
  });

  /**
   * El error más probable del mundo real: el dueño sube el `.xlsx` directo. El mensaje tiene que
   * decirle **qué hacer** —"Guardar como → CSV"— y no "formato no soportado", que lo deja parado.
   */
  it.each([['stock.xlsx'], ['stock.xls']])('%s dice cómo convertirlo, no sólo que está mal', (name) => {
    const result = checkCsvFile(fakeFile(name, 'application/vnd.ms-excel', 1000));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('Guardar como');
  });

  /**
   * Windows reporta el tipo que dice su registro, no lo que el archivo es: un `.csv` asociado a
   * Excel llega como `application/vnd.ms-excel`. Rechazarlo por tipo dejaría afuera al usuario más
   * común que tenemos.
   */
  it.each([
    ['text/csv'],
    ['application/vnd.ms-excel'],
    ['text/plain'],
    [''],
  ])('acepta un .csv aunque el navegador diga el tipo %s', (type) => {
    expect(checkCsvFile(fakeFile('stock.csv', type, 5000)).ok).toBe(true);
  });

  it('un archivo vacío se corta acá y no llega al parser', () => {
    const result = checkCsvFile(fakeFile('stock.csv', 'text/csv', 0));
    expect(result.ok).toBe(false);
  });

  /** El cap propio existe para que el rechazo lo escriba Zod en castellano y no el 413 de Next. */
  it('el techo de bytes rechaza con un mensaje en castellano', () => {
    expect(checkCsvFile(fakeFile('stock.csv', 'text/csv', MAX_CSV_BYTES)).ok).toBe(true);
    const result = checkCsvFile(fakeFile('stock.csv', 'text/csv', MAX_CSV_BYTES + 1));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/pesa más/iu);
  });

  /** El cap tiene que quedar bien debajo del `bodySizeLimit` de 3,5 MB de las Server Actions. */
  it('el techo de bytes deja aire bajo el techo de plataforma', () => {
    expect(MAX_CSV_BYTES).toBeLessThan(3.5 * 1024 * 1024);
  });
});

describe('normalizeHeader · el encabezado que escribió una persona', () => {
  it.each([
    ['Modelo', 'modelo'],
    ['Condición', 'condicion'],
    ['PRECIO USD', 'precio_usd'],
    ['Batería %', 'bateria'],
    ['  Color  ', 'color'],
    ['costo_usd', 'costo_usd'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeHeader(raw)).toBe(expected);
  });

  /**
   * El `%` de "Batería %" se convierte en `_` y **el `_` del final se descarta**. Sin eso la
   * columna se llamaría `bateria_`, no matchearía ningún alias, y la batería entraría siempre
   * vacía sin un solo error: el mismo fallo mudo que el BOM.
   */
  it('no deja separadores colgando al final', () => {
    expect(canonicalField('Batería %')).toBe(CSV_FIELDS.batteryPct);
    expect(canonicalField('Precio (USD)')).toBe(CSV_FIELDS.priceUsd);
  });

  it('una columna que no conocemos no se inventa', () => {
    expect(canonicalField('proveedor')).toBeNull();
    expect(canonicalField('')).toBeNull();
  });
});

describe('csvRowSchema · texto → dato', () => {
  const base = {
    [CSV_FIELDS.model]: 'iPhone 14 Pro',
    [CSV_FIELDS.condition]: 'sellado',
    [CSV_FIELDS.priceUsd]: '620',
    [CSV_FIELDS.title]: '',
    [CSV_FIELDS.storageGb]: '',
    [CSV_FIELDS.color]: '',
    [CSV_FIELDS.batteryPct]: '',
    [CSV_FIELDS.imei]: '',
    [CSV_FIELDS.costUsd]: '',
    [CSV_FIELDS.description]: '',
  };

  function parse(overrides: Partial<Record<string, string>> = {}) {
    return csvRowSchema.safeParse({ ...base, ...overrides });
  }

  it('el precio va a centavos enteros, nunca a un float', () => {
    expect(parse({ [CSV_FIELDS.priceUsd]: '620,50' }).data?.precio_usd).toBe(62_050);
    expect(parse({ [CSV_FIELDS.priceUsd]: '620.5' }).data?.precio_usd).toBe(62_050);
  });

  /**
   * `1.200` es mil doscientos para el dueño y uno con dos para `parseFloat`. Equivocarse acá
   * publica un iPhone a USD 1,20. Se delega en `parseUsdToCents`, que es el único lugar del panel
   * donde un string se convierte en plata — y se prueba acá que el import **no** tenga su propia
   * regla más "amable".
   */
  it('rechaza el separador de miles en vez de adivinar', () => {
    expect(parse({ [CSV_FIELDS.priceUsd]: '1.200' }).success).toBe(false);
    expect(parse({ [CSV_FIELDS.priceUsd]: '1,200' }).success).toBe(false);
  });

  it('limpia el símbolo de moneda que trae una planilla real', () => {
    expect(parse({ [CSV_FIELDS.priceUsd]: 'USD 620' }).data?.precio_usd).toBe(62_000);
    expect(parse({ [CSV_FIELDS.priceUsd]: '$620' }).data?.precio_usd).toBe(62_000);
  });

  it('un precio de cero no es una oferta, es un typo', () => {
    expect(parse({ [CSV_FIELDS.priceUsd]: '0' }).success).toBe(false);
  });

  it('acepta "256 GB" y "87%": es lo que hay escrito en las planillas', () => {
    expect(parse({ [CSV_FIELDS.storageGb]: '256 GB' }).data?.gb).toBe(256);
    expect(parse({ [CSV_FIELDS.batteryPct]: '87%' }).data?.bateria).toBe(87);
  });

  /** Los rangos son los mismos `CHECK` de Postgres: sin esto el dato malo vuelve en un error. */
  it('la batería fuera de 0..100 se rechaza acá y no en un CHECK de Postgres', () => {
    expect(parse({ [CSV_FIELDS.batteryPct]: '100' }).success).toBe(true);
    expect(parse({ [CSV_FIELDS.batteryPct]: '0' }).success).toBe(true);
    expect(parse({ [CSV_FIELDS.batteryPct]: '101' }).success).toBe(false);
  });

  it('el IMEI son 15 dígitos y el mensaje NO lo imprime', () => {
    expect(parse({ [CSV_FIELDS.imei]: '353751000000015' }).data?.imei).toBe('353751000000015');
    // Con guiones y espacios, como lo copia y pega la gente.
    expect(parse({ [CSV_FIELDS.imei]: '35375-1000 000015' }).data?.imei).toBe('353751000000015');

    const bad = parse({ [CSV_FIELDS.imei]: '35375100000001' });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).not.toContain('35375100000001');
  });

  /**
   * Las tres formas salen de `@istock/domain` y no de una lista copiada acá. El `it.each` se
   * **deriva** del enum: el día que se agregue una condición, este test la cubre solo.
   */
  it.each(CONDITIONS.flatMap((c) => [c, conditionLabel(c), waConditionLabel(c)].map((t) => [t, c])))(
    'la condición escrita "%s" es %s',
    (text, condition) => {
      expect(parse({ [CSV_FIELDS.condition]: String(text) }).data?.condicion).toBe(condition);
    },
  );

  it('una condición inventada no cae en un default', () => {
    const result = parse({ [CSV_FIELDS.condition]: 'como nuevo' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('sellado');
  });

  it('las columnas opcionales vacías son null, no cadena vacía', () => {
    const data = parse().data;
    expect(data?.titulo).toBeNull();
    expect(data?.color).toBeNull();
    expect(data?.imei).toBeNull();
    expect(data?.costo_usd).toBeNull();
    expect(data?.descripcion).toBeNull();
  });
});

describe('csvTemplate · la plantilla que se le entrega al dueño', () => {
  /**
   * El gate que importa: **la plantilla que repartimos tiene que importar limpia**. Se deriva de
   * `CSV_FIELDS`, así que no puede desincronizarse del parser por olvido; este test lo demuestra
   * en vez de confiarlo. Una plantilla que no valida contra su propio import es la peor primera
   * impresión posible.
   */
  it('la plantilla del owner se importa sin un solo error', () => {
    const parsed = readImportCsv(`${csvTemplate(true)}\n`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = resolveImportPlan(parsed.read, { catalog: CATALOG, takenImeis: new Set() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.units[0]?.costUsdCents).toBe(48_000);
    expect(result.units[0]?.description).toBe('Impecable, sin detalles');
  });

  it('la plantilla del seller no ofrece la columna de costo', () => {
    const template = csvTemplate(false);
    expect(template).not.toContain(CSV_FIELDS.costUsd);
    const parsed = readImportCsv(`${template}\n`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.read.hasCostColumn).toBe(false);
    expect(parsed.read.issues).toEqual([]);
  });

  it('la fila de ejemplo no trae un IMEI de mentira para copiar 200 veces', () => {
    const parsed = readImportCsv(`${csvTemplate(true)}\n`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.read.rows[0]?.values?.imei).toBeNull();
  });

  it('la plantilla nombra todas las columnas que el parser conoce', () => {
    const header = csvTemplate(true).split('\n')[0] ?? '';
    for (const field of Object.values(CSV_FIELDS)) {
      expect(header.split(',')).toContain(field);
    }
  });
});

describe('los techos están donde dicen estar', () => {
  it('el techo de filas es 2,5x el tope del ICP (20–200 equipos)', () => {
    expect(MAX_CSV_ROWS).toBe(500);
  });
});
