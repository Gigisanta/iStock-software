import { describe, expect, it } from 'vitest';

import { DomainError } from './errors';
import { formatArs, formatUsd } from './money';
import {
  ARGENTINA_UTC_OFFSET_MINUTES,
  BUSINESS_NAME_MAX_CHARS,
  DEFAULT_BLOCK_BUDGET_CHARS,
  WA_MESSAGE_MAX_CHARS,
  buildStockList,
  buildStockListEntry,
  type StockListInput,
  type StockListUnit,
} from './stock-list';
import { conditionLabel, waConditionLabel } from './types';

const UNIT: StockListUnit = {
  nameSource: 'catalog',
  modelDisplayName: 'iPhone 14 Pro',
  storageGb: 256,
  color: 'Grafito',
  condition: 'used_excellent',
  priceUsdCents: 62_000,
  priceArsCents: 86_800_000,
  status: 'available',
  url: 'https://nortecel.maat.work/p/iphone-14-pro-256-grafito',
};

/** N unidades distinguibles, con URLs y nombres distintos. */
function manyUnits(count: number): StockListUnit[] {
  return Array.from({ length: count }, (_unused, index) => ({
    ...UNIT,
    modelDisplayName: `iPhone ${String(index + 1)} Pro`,
    url: `https://nortecel.maat.work/p/equipo-${String(index + 1)}`,
  }));
}

function baseInput(units: readonly StockListUnit[], extra: Partial<StockListInput> = {}): StockListInput {
  return { businessName: 'Nortecel', slug: 'nortecel', units, ...extra };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  buildStockListEntry — el renglón
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('buildStockListEntry — la unidad indivisible', () => {
  it('SL1 — dos renglones: datos arriba, link abajo', () => {
    expect(buildStockListEntry(UNIT)).toBe(
      'iPhone 14 Pro 256 Grafito · usado excelente · USD 620 · $ 868.000\n' +
        'https://nortecel.maat.work/p/iphone-14-pro-256-grafito',
    );
  });

  it('SL2 — usa el registro de la FICHA (`usado excelente`), no el de WhatsApp (`usado A`)', () => {
    // `CLAUDE.md` §1 fija dos mapas a propósito. Esta lista la lee un comprador y cada renglón
    // termina en un link a la ficha, que dice `usado excelente`: decir otra cosa acá le daría dos
    // palabras distintas para lo mismo a la persona que hace el click.
    const entry = buildStockListEntry(UNIT);
    expect(entry).toContain(conditionLabel('used_excellent'));
    expect(entry).not.toContain(waConditionLabel('used_excellent'));
    expect(conditionLabel('used_excellent')).not.toBe(waConditionLabel('used_excellent'));
  });

  it('SL3 — el link va a la FICHA, nunca a `wa.me`', () => {
    // El embudo es estado → ficha → botón de WhatsApp. Un `wa.me` acá saltea el "llega informado".
    const entry = buildStockListEntry(UNIT);
    expect(entry).not.toContain('wa.me');
    expect(entry.split('\n')[1]).toBe(UNIT.url);
  });

  it('SL4 — `reserved` sale marcado, y la marca va al principio del renglón', () => {
    const entry = buildStockListEntry({ ...UNIT, status: 'reserved' });
    expect(entry.startsWith('RESERVADO · ')).toBe(true);
    expect(entry).toContain('iPhone 14 Pro 256 Grafito');
  });

  it('SL4b — `sold` también se marca: ningún estado se muestra como disponible sin serlo', () => {
    expect(buildStockListEntry({ ...UNIT, status: 'sold' }).startsWith('VENDIDO · ')).toBe(true);
    // `available` es el único sin marca.
    expect(buildStockListEntry(UNIT).startsWith('iPhone')).toBe(true);
  });

  it('SL5 — el ARS entra ya calculado y es opcional', () => {
    const withoutArs = buildStockListEntry({ ...UNIT, priceArsCents: null });
    expect(withoutArs).toContain('USD 620');
    expect(withoutArs).not.toContain('$ ');
    // Y cuando viene, sale tal cual: esta función no hace FX.
    expect(buildStockListEntry({ ...UNIT, priceArsCents: 1_000_000 })).toContain('$ 10.000');
  });

  it('SL6 — la plata se formatea con las mismas funciones que la pantalla', () => {
    const unit: StockListUnit = { ...UNIT, priceUsdCents: 62_050, priceArsCents: 86_812_345 };
    const entry = buildStockListEntry(unit);
    expect(entry).toContain(formatUsd(62_050));
    expect(entry).toContain(formatArs(86_812_345));
  });

  it('SL7 — no repite storage ni color en un título de texto libre', () => {
    // El bug `iPhone 14 Pro 256 Grafito 256 Grafito` (W5 de `accept-s4.sh`) se resuelve una sola
    // vez, en `describeListingName`. Acá sólo se verifica que esta función pase por ahí.
    const entry = buildStockListEntry({
      ...UNIT,
      nameSource: 'free_text',
      modelDisplayName: 'iPhone 14 Pro 256 Grafito',
    });
    expect(entry.startsWith('iPhone 14 Pro 256 Grafito · usado excelente')).toBe(true);
  });

  it('SL8 — un nombre en blanco no emite un renglón con un hueco: tira', () => {
    expect(() => buildStockListEntry({ ...UNIT, modelDisplayName: '   ' })).toThrow(DomainError);
  });

  it('SL9 — la URL tiene que ser absoluta: una relativa en un estado es texto, no link', () => {
    for (const url of ['', '   ', '/p/iphone-14-pro', 'nortecel.maat.work/p/x', 'https://a b/c']) {
      expect(() => buildStockListEntry({ ...UNIT, url })).toThrow(DomainError);
    }
    // `http://` se acepta: los e2e corren sobre `{slug}.127.0.0.1.nip.io:3100`.
    expect(buildStockListEntry({ ...UNIT, url: 'http://nortecel.127.0.0.1.nip.io:3100/p/x' })).toContain(
      'http://nortecel.127.0.0.1.nip.io:3100/p/x',
    );
  });

  it('SL10 — plata negativa no sale publicada', () => {
    expect(() => buildStockListEntry({ ...UNIT, priceUsdCents: -1 })).toThrow(DomainError);
    expect(() => buildStockListEntry({ ...UNIT, priceArsCents: -1 })).toThrow(DomainError);
    expect(() => buildStockListEntry({ ...UNIT, priceUsdCents: 620.5 })).toThrow(DomainError);
  });

  it('SL11 — el tipo no tiene campos sensibles, y el texto tampoco los muestra', () => {
    // La prohibición de `CLAUDE.md` §2 es de TIPOS: los campos de abajo no existen en
    // `StockListUnit`, así que un mapeo que los pase no compila. El `as` de este test es la única
    // forma de simular el error, y sirve para demostrar que ni siquiera colados salen impresos.
    const contaminated = {
      ...UNIT,
      imei: '353916100002614',
      costUsdCents: 40_000,
      margin: 22_000,
      internalNotes: 'lo trajo el Pipa, debe 200',
      supplier: 'Pipa',
      tenantId: '5b8f7f22-1111-2222-3333-444455556666',
    } as unknown as StockListUnit;
    const entry = buildStockListEntry(contaminated);
    for (const secret of ['353916100002614', '40000', '400', 'Pipa', 'debe 200', '5b8f7f22']) {
      expect(entry).not.toContain(secret);
    }
    expect(entry).toBe(buildStockListEntry(UNIT));
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  buildStockList — el armado en bloques
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('buildStockList — encabezado y bloques', () => {
  it('SL12 — un solo bloque: encabezado con negocio y host, sin numeración', () => {
    const list = buildStockList(baseInput([UNIT]));
    expect(list.blocks).toHaveLength(1);
    const block = list.blocks[0];
    expect(block?.text).toBe(`Nortecel · nortecel.maat.work\n\n${buildStockListEntry(UNIT)}`);
    // `1/1` es ruido y son caracteres que le saca a un equipo.
    expect(block?.text).not.toContain('1/1');
    expect(block?.index).toBe(1);
    expect(block?.total).toBe(1);
  });

  it('SL13 — la fecha entra por parámetro, en hora de Argentina, y sin `now` no hay fecha', () => {
    // 2026-08-29T00:30:00Z son las 21:30 del 28 en Cipolletti, que es cuando se arma el estado.
    // Con la zona del runtime (Vercel = UTC) el encabezado diría `29/08`.
    const now = new Date('2026-08-29T00:30:00.000Z');
    expect(buildStockList(baseInput([UNIT], { now })).blocks[0]?.text).toContain('Stock al 28/08');
    expect(ARGENTINA_UTC_OFFSET_MINUTES).toBe(-180);
    // El offset es explícito y se puede cambiar.
    expect(
      buildStockList(baseInput([UNIT], { now, utcOffsetMinutes: 0 })).blocks[0]?.text,
    ).toContain('Stock al 29/08');
    // Sin `now`: ni fecha, ni fecha inventada.
    expect(buildStockList(baseInput([UNIT])).blocks[0]?.text).not.toContain('Stock al');
  });

  it('SL14 — cero unidades: cero bloques, no un encabezado solo', () => {
    const list = buildStockList(baseInput([]));
    expect(list.blocks).toEqual([]);
    expect(list.unitCount).toBe(0);
  });

  it('SL15 — orden y numeración: los bloques van `1/N`, `2/N`, … y en el orden del caller', () => {
    const units = manyUnits(20);
    const list = buildStockList(baseInput(units, { maxBlockChars: 400 }));
    expect(list.blocks.length).toBeGreaterThan(2);

    const total = list.blocks.length;
    list.blocks.forEach((block, position) => {
      expect(block.index).toBe(position + 1);
      expect(block.total).toBe(total);
      // El encabezado dice el número real, y es la primera línea.
      expect(block.text.split('\n')[0]).toBe(`Nortecel · nortecel.maat.work · ${String(position + 1)}/${String(total)}`);
    });

    // Y el orden de las unidades sobrevive la partición: concatenar los bloques devuelve la lista
    // original, en orden.
    const emitted = list.blocks.flatMap((block) =>
      block.text
        .split('\n\n')
        .slice(1)
        .map((entry) => entry.split('\n')[1]),
    );
    expect(emitted).toEqual(units.map((unit) => unit.url));
  });

  it('SL15b — el `N` del encabezado es el total real aunque el encabezado crezca de un dígito', () => {
    // El largo del encabezado depende del total (`1/9` vs `1/10`) y el total depende del largo del
    // encabezado: si el punto fijo no cerrara, el encabezado diría `1/9` habiendo 10 bloques y el
    // dueño publicaría nueve.
    for (const count of [9, 10, 11, 12, 99, 100, 101]) {
      const list = buildStockList(baseInput(manyUnits(count), { maxBlockChars: 260 }));
      const declared = new Set(list.blocks.map((block) => block.total));
      expect([...declared]).toEqual([list.blocks.length]);
      for (const block of list.blocks) {
        expect(block.text).toContain(`${String(block.index)}/${String(list.blocks.length)}`);
      }
    }
  });

  it('SL16 — ninguna unidad se pierde y ninguna se parte', () => {
    for (const count of [1, 2, 7, 15, 60, 200]) {
      for (const budget of [200, 400, 1000, 4096]) {
        const units = manyUnits(count);
        const list = buildStockList(baseInput(units, { maxBlockChars: budget }));
        expect(list.unitCount).toBe(count);
        expect(list.blocks.reduce((sum, block) => sum + block.unitCount, 0)).toBe(count);
        // Cada entrada aparece **entera** en exactamente un bloque.
        for (const unit of units) {
          const entry = buildStockListEntry(unit);
          const hits = list.blocks.filter((block) => block.text.includes(entry));
          expect(hits).toHaveLength(1);
        }
      }
    }
  });

  it('SL17 — una unidad que NO entra en el presupuesto aparece igual, en su propio bloque', () => {
    // El peor fallo posible de esta función es perder stock en silencio: el dueño publica 3 y
    // vende 2 sin enterarse nunca de cuál faltó.
    const gigante: StockListUnit = {
      ...UNIT,
      modelDisplayName: `iPhone ${'Pro '.repeat(60)}Max`,
      url: 'https://nortecel.maat.work/p/gigante',
    };
    const units = [manyUnits(1)[0] as StockListUnit, gigante, manyUnits(1)[0] as StockListUnit];
    const list = buildStockList(baseInput(units, { maxBlockChars: 200 }));

    expect(list.unitCount).toBe(3);
    const solo = list.blocks.find((block) => block.text.includes('/p/gigante'));
    expect(solo).toBeDefined();
    expect(solo?.unitCount).toBe(1);
    expect(solo?.overBudget).toBe(true);
    expect(solo?.text).toContain(buildStockListEntry(gigante));
    // Sale igual, entero, y el resto de los bloques sigue dentro del presupuesto.
    for (const block of list.blocks.filter((candidate) => candidate !== solo)) {
      expect(block.overBudget).toBe(false);
    }
  });

  it('SL17b — presupuesto de 1: cada unidad en su bloque, todas presentes, ninguna cortada', () => {
    const units = manyUnits(4);
    const list = buildStockList(baseInput(units, { maxBlockChars: 1 }));
    expect(list.blocks).toHaveLength(4);
    expect(list.unitCount).toBe(4);
    expect(list.blocks.every((block) => block.overBudget)).toBe(true);
    units.forEach((unit, position) => {
      expect(list.blocks[position]?.text).toContain(buildStockListEntry(unit));
    });
  });

  it('SL18 — todo bloque con más de una unidad respeta el presupuesto', () => {
    for (const budget of [300, 500, DEFAULT_BLOCK_BUDGET_CHARS, 2000]) {
      const list = buildStockList(baseInput(manyUnits(40), { maxBlockChars: budget, now: new Date('2026-08-28T12:00:00.000Z') }));
      for (const block of list.blocks) {
        expect(block.text.length).toBeLessThanOrEqual(budget);
        expect(block.overBudget).toBe(false);
      }
    }
  });

  it('SL19 — el default de presupuesto entra cómodo en un mensaje de WhatsApp', () => {
    expect(DEFAULT_BLOCK_BUDGET_CHARS).toBe(1000);
    expect(DEFAULT_BLOCK_BUDGET_CHARS).toBeLessThan(WA_MESSAGE_MAX_CHARS);
    // Con margen de sobra para la línea que el dueño le agrega arriba al pegarlo.
    expect(DEFAULT_BLOCK_BUDGET_CHARS * 3).toBeLessThan(WA_MESSAGE_MAX_CHARS);
    expect(WA_MESSAGE_MAX_CHARS).toBe(4096);

    const list = buildStockList(baseInput(manyUnits(50)));
    for (const block of list.blocks) {
      expect(block.text.length).toBeLessThanOrEqual(WA_MESSAGE_MAX_CHARS);
    }
    // Y un bloque de default lleva un puñado de equipos, no dos ni cuarenta.
    expect(list.blocks[0]?.unitCount).toBeGreaterThanOrEqual(5);
  });

  it('SL20 — `reserved` sigue marcado dentro del bloque armado', () => {
    const list = buildStockList(
      baseInput([UNIT, { ...UNIT, status: 'reserved', url: 'https://nortecel.maat.work/p/reservado' }]),
    );
    const text = list.blocks[0]?.text ?? '';
    expect(text).toContain('RESERVADO · ');
    expect(text.match(/RESERVADO/gu)).toHaveLength(1);
  });

  it('SL21 — el slug se sigue validando aunque ya no arme el host del encabezado', () => {
    expect(() => buildStockList(baseInput([UNIT], { slug: 'No Válido' }))).toThrow(DomainError);

    // Este test pedía antes que con `slug: 'celu-store'` el encabezado dijera `celu-store.maat.work`
    // **dejando las URLs en `nortecel.maat.work`**: o sea fijaba la contradicción como si fuera el
    // contrato. El contrato es el de SL27 — el encabezado dice el host de los links —, así que un
    // input coherente lleva las dos puntas.
    const list = buildStockList(
      baseInput([{ ...UNIT, url: 'https://celu-store.maat.work/p/iphone-14-pro-256-grafito' }], {
        slug: 'celu-store',
      }),
    );
    expect(list.blocks[0]?.text).toContain('celu-store.maat.work');
    expect(list.blocks[0]?.text).not.toContain('nortecel');
  });

  it('SL22 — el nombre del negocio no puede forjar un encabezado ni partirlo en dos', () => {
    const list = buildStockList(baseInput([UNIT], { businessName: 'Norte\ncel  \t Sur\n1/1 · otro.maat.work' }));
    const text = list.blocks[0]?.text ?? '';
    // El `\n` se reemplaza por un espacio, no se borra: unir dos palabras que el dueño escribió
    // separadas sería inventarle otro nombre al negocio.
    expect(text.split('\n')[0]).toBe('Norte cel Sur 1/1 · otro.maat.work · nortecel.maat.work');
    // Un solo encabezado: el whitespace colapsado impide el renglón forjado.
    expect(text.split('\n\n')).toHaveLength(2);
  });

  it('SL23 — nombre de negocio vacío, gigante, o entradas inválidas: falla, no publica a medias', () => {
    expect(() => buildStockList(baseInput([UNIT], { businessName: '   ' }))).toThrow(DomainError);
    expect(() => buildStockList(baseInput([UNIT], { businessName: 'x'.repeat(BUSINESS_NAME_MAX_CHARS + 1) }))).toThrow(
      DomainError,
    );
    expect(buildStockList(baseInput([UNIT], { businessName: 'x'.repeat(BUSINESS_NAME_MAX_CHARS) })).blocks).toHaveLength(
      1,
    );
    // Una unidad rota rompe la lista entera: media lista publicada es peor que ninguna, porque el
    // dueño no sabría cuál falta.
    expect(() => buildStockList(baseInput([UNIT, { ...UNIT, url: '/p/relativo' }]))).toThrow(DomainError);
  });

  it('SL24 — presupuesto y offset inválidos se rechazan', () => {
    for (const maxBlockChars of [0, -10, 3.5, Number.NaN]) {
      expect(() => buildStockList(baseInput([UNIT], { maxBlockChars }))).toThrow(DomainError);
    }
    expect(() => buildStockList(baseInput([UNIT], { now: new Date('2026-08-28T00:00:00.000Z'), utcOffsetMinutes: 900 }))).toThrow(
      DomainError,
    );
    expect(() => buildStockList(baseInput([UNIT], { now: new Date('no es una fecha') }))).toThrow(DomainError);
  });

  it('SL25 — determinista: la misma entrada da byte a byte la misma salida', () => {
    const input = baseInput(manyUnits(23), { maxBlockChars: 420, now: new Date('2026-08-28T23:59:00.000Z') });
    expect(JSON.stringify(buildStockList(input))).toBe(JSON.stringify(buildStockList(input)));
  });

  it('SL26 — ningún campo sensible sobrevive al armado de la lista completa', () => {
    const contaminated = [
      { ...UNIT, imei: '353916100002614', internalNotes: 'debe 200' },
      { ...UNIT, url: 'https://nortecel.maat.work/p/dos', costUsdCents: 40_000, margin: 22_000 },
    ] as unknown as StockListUnit[];
    const text = buildStockList(baseInput(contaminated))
      .blocks.map((block) => block.text)
      .join('\n');
    for (const secret of ['353916100002614', 'debe 200', '40000', '22000']) {
      expect(text).not.toContain(secret);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  El host del encabezado sale de los MISMOS links que el bloque imprime
// ══════════════════════════════════════════════════════════════════════════════════════════════
//
// El bloque se copia entero y se pega entero. Si el encabezado dice un host y los links apuntan a
// otro, el texto se contradice a sí mismo delante de cien personas. La única defensa que no
// depende de que dos cálculos coincidan es que haya **un solo** cálculo: el host del encabezado se
// lee de las URLs de las unidades, que son las que se imprimen.

/** `Nortecel · nortecel.maat.work · 1/2` → `nortecel.maat.work`. */
function headerHost(blockText: string): string {
  return (blockText.split('\n')[0] ?? '').split(' · ')[1] ?? '';
}

/** Los hosts de todos los links impresos en el bloque, en orden. */
function linkHosts(blockText: string): string[] {
  return blockText
    .split('\n')
    .filter((line) => line.startsWith('http'))
    .map((line) => /^https?:\/\/([^/]+)/u.exec(line)?.[1] ?? '');
}

describe('buildStockList — encabezado y links no pueden discrepar', () => {
  it('SL27 — dev/e2e: el encabezado dice el host de los links, no `maat.work`', () => {
    const base = 'http://demo.127.0.0.1.nip.io:3100';
    const units = manyUnits(9).map((unit, index) => ({ ...unit, url: `${base}/p/equipo-${String(index + 1)}` }));
    const list = buildStockList({ businessName: 'Nortecel', slug: 'demo', units, maxBlockChars: 420 });

    expect(list.blocks.length).toBeGreaterThan(1);
    for (const block of list.blocks) {
      expect(headerHost(block.text)).toBe('demo.127.0.0.1.nip.io:3100');
      for (const host of linkHosts(block.text)) expect(host).toBe(headerHost(block.text));
      // El host de producción no puede aparecer en un bloque armado contra un origen local.
      expect(block.text).not.toContain('maat.work');
    }
  });

  it('SL28 — producción no se mueve: con `maat.work` la salida es byte por byte la de siempre', () => {
    expect(buildStockList(baseInput([UNIT], { now: new Date('2026-08-28T12:00:00.000Z') })).blocks[0]?.text).toBe(
      'Nortecel · nortecel.maat.work\nStock al 28/08\n\n' +
        'iPhone 14 Pro 256 Grafito · usado excelente · USD 620 · $ 868.000\n' +
        'https://nortecel.maat.work/p/iphone-14-pro-256-grafito',
    );

    // Y con numeración, que es donde el encabezado cambia de largo y mueve el empaquetado.
    const multi = buildStockList(baseInput(manyUnits(9), { maxBlockChars: 420 }));
    expect(multi.blocks.map((block) => block.text.split('\n')[0])).toEqual(
      multi.blocks.map((block) => `Nortecel · nortecel.maat.work · ${String(block.index)}/${String(block.total)}`),
    );
    expect(multi.blocks).toHaveLength(3);
    expect(multi.unitCount).toBe(9);
  });

  it('SL29 — dos hosts en la misma lista fallan: el encabezado no elige uno y desmiente al otro', () => {
    expect(() => buildStockList(baseInput([UNIT, { ...UNIT, url: 'https://otro.maat.work/p/x' }]))).toThrow(DomainError);
    // Una sola unidad con host propio no es ambigua y sale.
    expect(buildStockList(baseInput([{ ...UNIT, url: 'https://otro.maat.work/p/x' }])).blocks[0]?.text).toContain(
      'Nortecel · otro.maat.work',
    );
  });
});
