import { describe, expect, it } from 'vitest';
import {
  MAX_ISSUES_REPORTED,
  buildCatalogIndex,
  catalogKey,
  readImportCsv,
  resolveImportPlan,
  type CatalogEntry,
  type ImportReadOk,
  type RowIssue,
} from './build-import';
import { MAX_CSV_ROWS } from './schema';

/**
 * El plan de import: qué entra, qué no, y **con qué número de fila se lo dice**.
 *
 * Dos cosas se prueban acá con más insistencia que el resto, porque son las dos que la aceptación
 * de S10 nombra y las dos que pueden estar rotas con todo en verde:
 *
 * 1. **Que no haya import parcial silencioso.** Un solo error tiene que voltear el archivo entero,
 *    y el resultado tiene que decir cuántas filas *habrían* entrado. Un test que sólo mirara
 *    `ok === false` no distinguiría "todo o nada" de "abortó en el primer error".
 * 2. **Que el reporte sea completo en una pasada.** Se valida TODO antes de cortar. Por eso el
 *    fixture de abajo tiene **siete clases distintas de error a la vez**: si el manejo por fila
 *    estuviera roto y sólo reportara la primera, o sólo reportara los de Zod, el test lo ve. Un
 *    fixture con una sola clase de error habría pasado igual contra las dos implementaciones —es
 *    exactamente lo que pasó en S9 con un fixture de puros `available`.
 */

const CATALOG: readonly CatalogEntry[] = [
  { id: 'model-14-pro', slug: 'iphone-14-pro', displayName: 'iPhone 14 Pro' },
  { id: 'model-13', slug: 'iphone-13', displayName: 'iPhone 13' },
];

const HEADER = 'modelo,condicion,precio_usd,gb,color,bateria,imei,costo_usd,titulo,descripcion';

/** El CSV se arma desde un array para que la fila `i` sea, sin contar, la línea `i + 2`. */
function csv(rows: readonly string[]): string {
  return `${HEADER}\n${rows.join('\n')}\n`;
}

function read(text: string): ImportReadOk {
  const result = readImportCsv(text);
  if (!result.ok) throw new Error(`el archivo no se pudo leer: ${result.reason}`);
  return result.read;
}

function plan(text: string, takenImeis: readonly string[] = []) {
  return resolveImportPlan(read(text), { catalog: CATALOG, takenImeis: new Set(takenImeis) });
}

function issuesAt(issues: readonly RowIssue[], line: number): readonly RowIssue[] {
  return issues.filter((issue) => issue.line === line);
}

describe('readImportCsv · el encabezado', () => {
  it('el archivo bueno se lee entero y no reporta nada', () => {
    const read1 = read(csv(['iPhone 14 Pro,sellado,620,256,Grafito,100,,480,,']));
    expect(read1.issues).toEqual([]);
    expect(read1.rowCount).toBe(1);
    expect(read1.rows[0]?.values).not.toBeNull();
  });

  /**
   * El encabezado real del cliente: acentos, mayúsculas, `%`, y `;` como separador porque el Excel
   * en español exporta así. Si esto fallara, el import serviría sólo para los archivos que
   * generamos nosotros, que es lo mismo que no servir.
   */
  it('acepta el encabezado en castellano, con acentos y punto y coma', () => {
    const result = readImportCsv(
      'Modelo;Condición;Precio USD;Almacenamiento;Color;Batería %\niPhone 13;usado excelente;480;128;Azul;89\n',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.read.issues).toEqual([]);
    expect(result.read.rows[0]?.values?.precio_usd).toBe(48_000);
    expect(result.read.rows[0]?.values?.bateria).toBe(89);
  });

  it('falta una columna obligatoria: es un problema del archivo, no de una fila', () => {
    const result = readImportCsv('modelo,color\niPhone 13,Azul\n');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('condicion');
    expect(result.reason).toContain('precio_usd');
  });

  it('la misma columna dos veces se rechaza en vez de que gane una en silencio', () => {
    const result = readImportCsv('modelo,precio_usd,condicion,precio\nA,1,sellado,2\n');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('dos veces');
  });

  /**
   * Una planilla real trae `proveedor` y `fecha de compra`. Se ignoran —no tenemos dónde
   * ponerlas—, pero **se informan**: ignorar en silencio es la falla que esta slice prohíbe, y el
   * dueño tiene derecho a saber que su columna "costo de flete" no entró a ningún lado.
   */
  it('las columnas que no usamos se informan, no se descartan calladas', () => {
    const result = read(
      'modelo,condicion,precio_usd,proveedor,fecha de compra\niPhone 13,sellado,480,Juan,01/02\n',
    );
    expect(result.ignoredColumns).toEqual(['proveedor', 'fecha de compra']);
  });

  it('avisa si el archivo trae columna de costo (lo mira la Server Action por rol)', () => {
    expect(read(csv(['iPhone 13,sellado,480,,,,,,,'])).hasCostColumn).toBe(true);
    expect(read('modelo,condicion,precio_usd\niPhone 13,sellado,480\n').hasCostColumn).toBe(false);
  });
});

describe('resolveImportPlan · el archivo que está bien', () => {
  it('mapea las diez columnas a la unidad, con la plata en centavos', () => {
    const result = plan(
      csv(['iPhone 14 Pro,usado A,620,256,Grafito,87,353751000000015,480.5,,Impecable']),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.units).toHaveLength(1);
    expect(result.units[0]).toEqual({
      line: 2,
      title: 'iPhone 14 Pro 256 GB Grafito',
      catalogModelId: 'model-14-pro',
      condition: 'used_excellent',
      priceUsdCents: 62_000,
      costUsdCents: 48_050,
      storageGb: 256,
      color: 'Grafito',
      batteryPct: 87,
      imei: '353751000000015',
      description: 'Impecable',
    });
  });

  /**
   * `CLAUDE.md` §1 ratifica los **dos registros** de condición a propósito: la ficha dice "usado
   * excelente" y el mensaje de WhatsApp dice "usado A". El dueño escribe indistintamente uno u
   * otro en su planilla, así que el import acepta los dos **y** la clave del enum. Los tres salen
   * de `@istock/domain`, no de una lista copiada acá.
   */
  it.each([
    ['la clave del enum', 'used_excellent'],
    ['la etiqueta de la ficha', 'usado excelente'],
    ['la jerga de reseller del mensaje de WA', 'usado A'],
  ])('acepta la condición escrita como %s', (_name, text) => {
    const result = plan(csv([`iPhone 13,${text},480,,,,,,,`]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.units[0]?.condition).toBe('used_excellent');
  });

  it('el título del dueño le gana al derivado del catálogo', () => {
    const result = plan(csv(['iPhone 13,sellado,480,128,Azul,,,,Mi iPhone de siempre,']));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.units[0]?.title).toBe('Mi iPhone de siempre');
  });

  it('sin título, se arma con el modelo del CATÁLOGO y no con lo que escribió el dueño', () => {
    const result = plan(csv(['iphone 14 pro,sellado,620,,,,,,,']));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.units[0]?.title).toBe('iPhone 14 Pro');
  });

  it('el modelo matchea por slug además de por nombre', () => {
    const result = plan(csv(['iphone-14-pro,sellado,620,,,,,,,']));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.units[0]?.catalogModelId).toBe('model-14-pro');
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *  EL FIXTURE MULTIERROR. Siete clases distintas, a propósito.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Cada fila mala falla por un motivo **diferente**, y hay cuatro filas buenas mezcladas entre
 * ellas. Con un fixture donde todas las filas fallan por lo mismo, una implementación que
 * reportara sólo el primer error de todo el archivo, o que sólo mirara Zod y no el catálogo,
 * pasaría verde igual.
 */
const BAD_ROWS: readonly string[] = [
  /* 2 */ 'iPhone 14 Pro,sellado,620,256,Grafito,100,353751000000015,,,',
  /* 3 */ 'iPhone 14 Pro,sellado,1.200,256,Grafito,,,,,', // precio con separador de miles
  /* 4 */ 'iPhone 13,nuevito,480,128,Azul,,,,,', // condición inexistente
  /* 5 */ 'iPhone 47 Ultra,sellado,900,,,,,,,', // modelo que no está en el catálogo
  /* 6 */ 'iPhone 13,sellado,480,128,Azul,,12345,,,', // IMEI de 5 dígitos
  /* 7 */ 'iPhone 13,sellado,480,128,Azul,150,,,,', // batería fuera de 0..100
  /* 8 */ 'iPhone 13,sellado,480,128,Azul,,353751000000015,,,', // IMEI repetido con la fila 2
  /* 9 */ ',sellado,480,,,,,,,', // falta el modelo
  /* 10 */ 'iPhone 13,sellado,480,128,Rojo, muy bueno,90,,,,', // una coma de más: fila corrida
  /* 11 */ 'iPhone 13,sellado,480,128,Verde,,,,,',
  /* 12 */ 'iPhone 14 Pro,open box,700,512,Plata,,,,,',
];

describe('resolveImportPlan · sin import parcial silencioso', () => {
  const result = plan(csv(BAD_ROWS));

  it('un solo error voltea el archivo entero, aunque haya filas buenas', () => {
    expect(result.ok).toBe(false);
  });

  /**
   * El número que hace que el resultado sea **imposible de confundir con un éxito**: la pantalla
   * dice "0 de 11 equipos entraron" y no "importado". Si `okCount` fuera igual a `rowCount`, o si
   * no existiera, el resultado se parecería a un éxito parcial.
   */
  it('informa cuántas filas habrían entrado contra cuántas hay: nunca son todas', () => {
    if (result.ok) return;
    expect(result.rowCount).toBe(BAD_ROWS.length);
    expect(result.okCount).toBeLessThan(result.rowCount);
    expect(result.okCount).toBeGreaterThan(0);
  });

  /**
   * El corazón del "errores por fila": se reportan **todas** las filas malas de una, no la primera.
   * Se afirma el conjunto exacto de líneas, no la cantidad: un test que contara issues no vería la
   * diferencia entre reportar la fila 3 dos veces y reportar la 3 y la 4.
   */
  it('reporta TODAS las filas malas en una sola pasada, con la línea del Excel', () => {
    if (result.ok) return;
    const lines = [...new Set(result.issues.map((issue) => issue.line))].sort((a, b) => a - b);
    expect(lines).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it.each([
    [3, 'precio_usd', /puntos de miles|números/u],
    [4, 'condicion', /condición no existe/u],
    [5, 'modelo', /catálogo/u],
    [6, 'imei', /15 números/u],
    [7, 'bateria', /0 a 100/u],
    [8, 'imei', /repetido/u],
    [9, 'modelo', /Falta el modelo/u],
  ])('la fila %i explica el problema de la columna %s en castellano', (line, column, pattern) => {
    if (result.ok) return;
    const found = issuesAt(result.issues, line);
    expect(found.some((issue) => issue.column === column && pattern.test(issue.message))).toBe(true);
  });

  /**
   * La fila 10 tiene una coma sin comillas adentro del color, así que trae una columna de más y
   * **todos los valores quedan corridos**. Es el error que más caro sale si pasa: publicaría un
   * equipo con el precio en el lugar equivocado. Se reporta como problema de la fila entera
   * (`column: null`), porque no hay una columna culpable.
   */
  it('una fila con más columnas que el encabezado se marca como fila corrida', () => {
    if (result.ok) return;
    const found = issuesAt(result.issues, 10);
    expect(found.some((issue) => issue.column === null && /columnas/u.test(issue.message))).toBe(true);
  });

  it('el IMEI repetido apunta a la PRIMERA fila donde apareció', () => {
    if (result.ok) return;
    const found = issuesAt(result.issues, 8);
    expect(found.some((issue) => issue.message.includes('fila 2'))).toBe(true);
  });

  /**
   * `CLAUDE.md` §1: el IMEI no va a un log ni a un mensaje. Un mensaje de error termina en el HTML
   * y en la captura que el dueño manda a soporte. Se afirma contra los dos IMEIs del fixture —el
   * válido repetido y el inválido de 5 dígitos— porque el segundo es el que más tienta a citar.
   */
  it('ningún mensaje imprime un IMEI, ni el válido ni el inválido', () => {
    if (result.ok) return;
    const texto = result.issues.map((issue) => issue.message).join('\n');
    expect(texto).not.toContain('353751000000015');
    expect(texto).not.toContain('12345');
  });

  /** §0.9: el costo no cruza a un payload. Un mensaje de error es un payload. */
  it('ningún mensaje imprime un costo', () => {
    const conCosto = plan(csv(['iPhone 47,sellado,620,,,,,999.99,,']));
    expect(conCosto.ok).toBe(false);
    if (conCosto.ok) return;
    const texto = conCosto.issues.map((issue) => issue.message).join('\n');
    expect(texto).not.toContain('999');
  });

  /**
   * La única cita declarada. Sin ella, "no conocemos ese modelo" en un archivo de 200 filas con 6
   * modelos mal escritos no es accionable.
   */
  it('el único dato de celda que se cita es el nombre del modelo desconocido', () => {
    if (result.ok) return;
    const found = issuesAt(result.issues, 5);
    expect(found.some((issue) => issue.message.includes('iPhone 47 Ultra'))).toBe(true);
  });
});

describe('resolveImportPlan · IMEI contra el stock que ya está cargado', () => {
  it('un IMEI que el tenant ya tiene voltea el archivo y no imprime el IMEI', () => {
    const result = plan(csv(['iPhone 13,sellado,480,,,,353751000000015,,,']), [
      '353751000000015',
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.column).toBe('imei');
    expect(result.issues[0]?.message).not.toContain('353751000000015');
    expect(result.issues[0]?.message).toMatch(/ya tenés/iu);
  });

  it('un IMEI de otro equipo no molesta', () => {
    const result = plan(csv(['iPhone 13,sellado,480,,,,353751000000015,,,']), [
      '353751000000023',
    ]);
    expect(result.ok).toBe(true);
  });
});

describe('resolveImportPlan · el catálogo', () => {
  it('la clave normaliza acentos, mayúsculas y separadores', () => {
    expect(catalogKey('iPhone 14 Pro')).toBe(catalogKey('iphone-14-pro'));
    expect(catalogKey('  IPHONE  14   PRO  ')).toBe(catalogKey('iPhone 14 Pro'));
  });

  /**
   * Sin match difuso, y es una decisión: un match por distancia elegiría "iPhone 14" cuando el
   * dueño escribió "iPhone 15" y publicaría el equipo equivocado sin que nadie se entere.
   */
  it('no adivina: "iPhone 14" NO matchea "iPhone 14 Pro"', () => {
    const result = plan(csv(['iPhone 14,sellado,620,,,,,,,']));
    expect(result.ok).toBe(false);
  });

  /**
   * Dos modelos que normalizan igual dejan la clave ambigua, y una clave ambigua es un error, no
   * un sorteo. Elegir uno de dos en silencio es el mismo fallo que el match difuso.
   */
  it('dos modelos con la misma clave dejan la clave ambigua en vez de que gane el primero', () => {
    const ambiguo: readonly CatalogEntry[] = [
      { id: 'a', slug: 'iphone-14-pro', displayName: 'iPhone 14 Pro' },
      { id: 'b', slug: 'iphone_14_pro', displayName: 'iPhone-14-Pro' },
    ];
    expect(buildCatalogIndex(ambiguo).get(catalogKey('iPhone 14 Pro'))).toBeNull();

    const result = resolveImportPlan(read(csv(['iPhone 14 Pro,sellado,620,,,,,,,'])), {
      catalog: ambiguo,
      takenImeis: new Set(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.message).toMatch(/más de un modelo/u);
  });

  it('el mismo modelo entrando por nombre y por slug no se vuelve ambiguo consigo mismo', () => {
    const index = buildCatalogIndex(CATALOG);
    expect(index.get(catalogKey('iPhone 14 Pro'))?.id).toBe('model-14-pro');
    expect(index.get(catalogKey('iphone-14-pro'))?.id).toBe('model-14-pro');
  });
});

describe('resolveImportPlan · el volumen', () => {
  /**
   * Con 500 filas malas serían ~1500 renglones en un celular. Se recorta la lista **pero se
   * devuelve el total**: recortar diciendo cuánto se recortó es lo contrario de esconder, que es
   * la regla de toda la slice.
   */
  it('recorta los errores que se pintan pero informa el total', () => {
    const rows = Array.from({ length: MAX_ISSUES_REPORTED + 20 }, () => 'iPhone 99,sellado,1,,,,,,,');
    const result = plan(csv(rows));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toHaveLength(MAX_ISSUES_REPORTED);
    expect(result.issueCount).toBe(rows.length);
    expect(result.rowCount).toBe(rows.length);
  });

  it('el techo de filas es del archivo entero y se rechaza antes de validar nada', () => {
    const rows = Array.from({ length: MAX_CSV_ROWS + 1 }, () => 'iPhone 13,sellado,480,,,,,,,');
    const result = readImportCsv(csv(rows));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain(String(MAX_CSV_ROWS));
  });

  it('exactamente el techo de filas entra', () => {
    const rows = Array.from({ length: MAX_CSV_ROWS }, () => 'iPhone 13,sellado,480,,,,,,,');
    const result = plan(csv(rows));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.units).toHaveLength(MAX_CSV_ROWS);
  });
});
