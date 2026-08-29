import { describe, expect, it } from 'vitest';
import { detectDelimiter, parseCsv } from './parse-csv';

/**
 * El tokenizador, no el import.
 *
 * Lo único que este módulo decide es **dónde empieza y termina cada celda, y en qué línea física
 * arranca cada registro**. Ese número de línea es el que la aceptación de S10 pide ("errores por
 * fila") y el que el dueño va a buscar en el costado de su Excel: si sale corrido en uno, todos
 * los mensajes de error mandan a la fila equivocada y el import queda inservible aunque valide
 * perfecto.
 *
 * Por eso casi todos los casos de acá afirman `line` además de `cells`.
 */

const BOM = '\u{feff}';

describe('detectDelimiter · el CSV que produce el Excel del cliente', () => {
  it('coma cuando el encabezado usa coma', () => {
    expect(detectDelimiter('modelo,condicion,precio_usd\n')).toBe(',');
  });

  /**
   * El caso que motiva la función: el Excel en español exporta "CSV delimitado por comas" con
   * **punto y coma**, porque la coma es el separador decimal del locale. Un import que sólo
   * entiende `,` rechaza el archivo que sale de la máquina del cliente.
   */
  it('punto y coma cuando el encabezado usa punto y coma (es-AR)', () => {
    expect(detectDelimiter('modelo;condicion;precio_usd\n')).toBe(';');
  });

  it('tabulación cuando el archivo salió de Google Sheets como TSV', () => {
    expect(detectDelimiter('modelo\tcondicion\tprecio_usd\n')).toBe('\t');
  });

  /**
   * Mira **sólo el encabezado**. Un archivo con encabezado por `;` y descripciones llenas de comas
   * no puede cambiar de separador por las comas de la fila 40.
   */
  it('no se deja arrastrar por el cuerpo del archivo', () => {
    const csv = 'modelo;precio_usd\niPhone 14, muy lindo, casi nuevo;620\n';
    expect(detectDelimiter(csv)).toBe(';');
  });

  it('ignora los separadores que están dentro de comillas', () => {
    expect(detectDelimiter('"modelo;equipo";precio\n')).toBe(';');
    expect(detectDelimiter('"a,b,c,d,e";f;g\n')).toBe(';');
  });

  it('una sola columna, sin separadores: cae al default de RFC 4180', () => {
    expect(detectDelimiter('modelo\n')).toBe(',');
  });
});

describe('parseCsv · la forma del archivo', () => {
  it('parsea el caso normal y numera el encabezado como fila 1', () => {
    const res = parseCsv('modelo,precio_usd\niPhone 14,620\niPhone 13,480\n', 500);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.table.header.line).toBe(1);
    expect(res.table.header.cells).toEqual(['modelo', 'precio_usd']);
    expect(res.table.records.map((r) => r.line)).toEqual([2, 3]);
    expect(res.table.records[0]?.cells).toEqual(['iPhone 14', '620']);
    expect(res.table.delimiter).toBe(',');
  });

  /**
   * El BOM es el fallo más común y el más difícil de explicar por teléfono: sin sacarlo, la
   * primera columna se llama `﻿modelo`, no matchea ningún alias, y **el archivo se ve
   * idéntico en pantalla**. Se afirma la celda con `toBe` justamente para que un `includes` no lo
   * deje pasar.
   */
  it('saca el BOM que escribe el Excel de Windows', () => {
    const res = parseCsv(`${BOM}modelo,precio_usd\niPhone 14,620\n`, 500);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.table.header.cells[0]).toBe('modelo');
  });

  it('el último registro sin salto de línea final igual entra', () => {
    const res = parseCsv('modelo,precio_usd\niPhone 14,620', 500);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.table.records).toHaveLength(1);
    expect(res.table.records[0]?.cells).toEqual(['iPhone 14', '620']);
  });

  it.each([
    ['\\r\\n (Windows)', '\r\n'],
    ['\\n (Unix)', '\n'],
    ['\\r solo (Excel viejo de Mac)', '\r'],
  ])('entiende %s como fin de registro y no corre el número de fila', (_name, eol) => {
    const res = parseCsv(`modelo,precio${eol}a,1${eol}b,2${eol}`, 500);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.table.records.map((r) => r.line)).toEqual([2, 3]);
    expect(res.table.records.map((r) => r.cells)).toEqual([
      ['a', '1'],
      ['b', '2'],
    ]);
  });
});

describe('parseCsv · comillas', () => {
  it('una coma adentro de comillas no parte la celda', () => {
    const res = parseCsv('modelo,descripcion\niPhone 14,"impecable, sin detalles"\n', 500);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.table.records[0]?.cells).toEqual(['iPhone 14', 'impecable, sin detalles']);
  });

  it('`""` adentro de comillas es una comilla literal', () => {
    const res = parseCsv('modelo,descripcion\niPhone,"pantalla ""original"" de fábrica"\n', 500);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.table.records[0]?.cells[1]).toBe('pantalla "original" de fábrica');
  });

  /**
   * Una descripción multilínea ocupa dos líneas físicas. La fila **siguiente** tiene que quedar
   * numerada 4, no 3: si el contador no avanzara adentro de las comillas, cada salto embebido
   * correría todos los errores posteriores una fila para arriba. Es el bug silencioso más caro de
   * este archivo, porque el import valida bien y manda al dueño a corregir la fila equivocada.
   */
  it('un salto de línea DENTRO de comillas no termina el registro pero SÍ cuenta como línea', () => {
    const res = parseCsv('modelo,descripcion\nA,"primera\nsegunda"\nB,corta\n', 500);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.table.records).toHaveLength(2);
    expect(res.table.records[0]).toEqual({ line: 2, cells: ['A', 'primera\nsegunda'] });
    expect(res.table.records[1]).toEqual({ line: 4, cells: ['B', 'corta'] });
  });

  it('una comilla sin cerrar es un fallo de archivo entero, no de una fila', () => {
    const res = parseCsv('modelo,descripcion\nA,"quedó abierta\nB,otra\n', 500);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toContain('comilla');
  });

  it('una celda vacía entre comillas es una celda vacía, no una celda ausente', () => {
    const res = parseCsv('a,b,c\n1,"",3\n', 500);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.table.records[0]?.cells).toEqual(['1', '', '3']);
  });
});

describe('parseCsv · líneas en blanco', () => {
  /**
   * Excel deja una línea en blanco al final casi siempre. Reportarla como "fila 201: falta el
   * modelo" manda al dueño a buscar un fantasma, y —peor— hace fallar un import que estaba bien.
   */
  it('descarta la línea en blanco del final sin contarla como fila', () => {
    const res = parseCsv('modelo,precio\nA,1\n\n', 500);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.table.records).toHaveLength(1);
  });

  it('descarta líneas en blanco del medio SIN corromper el número de las que siguen', () => {
    const res = parseCsv('modelo,precio\nA,1\n\n\nB,2\n', 500);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.table.records.map((r) => r.line)).toEqual([2, 5]);
  });

  /**
   * Una fila de puros separadores (`,,,`) es lo que deja Excel cuando el dueño borra el contenido
   * de un renglón pero no el renglón. No es un equipo sin modelo: es un renglón que no existe.
   */
  it('una fila de puros separadores también es blanco', () => {
    const res = parseCsv('modelo,precio,color\nA,1,rojo\n,,\n', 500);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.table.records).toHaveLength(1);
  });

  it('una fila con espacios en todas las celdas también es blanco', () => {
    const res = parseCsv('modelo,precio\nA,1\n   ,  \n', 500);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.table.records).toHaveLength(1);
  });
});

describe('parseCsv · lo que no se puede leer', () => {
  it('archivo vacío', () => {
    expect(parseCsv('', 500)).toEqual({ ok: false, reason: 'El archivo está vacío.' });
    expect(parseCsv('   \n\n', 500).ok).toBe(false);
  });

  it('sólo encabezado: lo dice con esas palabras, no "está vacío"', () => {
    const res = parseCsv('modelo,condicion,precio_usd\n', 500);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toContain('encabezado');
  });

  /**
   * El techo cuenta **filas de datos**, sin el encabezado. Se prueban los dos lados del borde: con
   * `maxRecords` filas pasa y con una más falla. Un test que sólo probara el caso que falla no
   * distinguiría este techo de uno corrido en uno, que es la clase de error que deja al dueño sin
   * poder subir el archivo que le dijimos que entraba.
   */
  it('acepta exactamente `maxRecords` filas de datos', () => {
    const csv = `modelo,precio\n${Array.from({ length: 5 }, (_, i) => `A${String(i)},1`).join('\n')}\n`;
    const res = parseCsv(csv, 5);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.table.records).toHaveLength(5);
  });

  it('rechaza el archivo entero una fila más arriba, y dice cuántas entran', () => {
    const csv = `modelo,precio\n${Array.from({ length: 6 }, (_, i) => `A${String(i)},1`).join('\n')}\n`;
    const res = parseCsv(csv, 5);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toContain('5');
  });

  /**
   * El corte por techo pasa **antes** de terminar de materializar el archivo: un CSV de 200.000
   * filas no se convierte entero en objetos para después decir que no entraba. Se afirma con un
   * archivo grande y un techo chico; si el corte fuera al final, esto igual pasaría, así que lo
   * que este caso realmente defiende es que el mensaje sea el del techo y no otro.
   */
  it('un archivo enorme corta por techo y no por otra cosa', () => {
    const csv = `modelo,precio\n${Array.from({ length: 3000 }, (_, i) => `A${String(i)},1`).join('\n')}\n`;
    const res = parseCsv(csv, 500);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toContain('500');
  });
});
