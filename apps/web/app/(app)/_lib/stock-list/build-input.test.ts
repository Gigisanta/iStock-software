import { describe, expect, it } from 'vitest';
import { buildStockList, buildStockListEntry } from '@istock/domain';
import {
  buildStockListInput,
  listingUrl,
  resolveFx,
  toStockListUnit,
  type StockListRow,
} from './build-input';

/**
 * El mapeo, no la aritmética.
 *
 * `buildStockList` ya tiene sus propios tests en `packages/domain`. Lo que se prueba acá es lo
 * único que este archivo decide, que es también donde se pierde plata: de qué string sale el
 * nombre, cómo se arma el link, qué pasa cuando el TC no sirve, y —sobre todo— que **ningún
 * equipo se caiga en el camino**. Un equipo que el dueño publicó y no aparece en el texto que
 * pega es stock que nadie ve y que nadie va a reportar.
 */

const BASE = 'https://nortecel.maat.work';

function row(overrides: Partial<StockListRow> = {}): StockListRow {
  return {
    slug: 'iphone-14-pro-256-grafito',
    title: 'iPhone 14 Pro 256 Grafito',
    modelDisplayName: 'iPhone 14 Pro',
    storageGb: 256,
    color: 'Grafito',
    condition: 'used_excellent',
    priceUsdCents: 62_000,
    status: 'available',
    ...overrides,
  };
}

describe('listingUrl · el renglón que factura', () => {
  it('arma la URL absoluta de la FICHA con el prefijo que declara (storefront)/_lib/routes', () => {
    expect(listingUrl(BASE, 'iphone-14-pro-256-grafito')).toBe(
      'https://nortecel.maat.work/p/iphone-14-pro-256-grafito',
    );
  });

  /**
   * `${base}/` + `/p/x` = `//p/x`, que para un navegador es **otro host** (`//p` es un
   * protocol-relative URL). Un link muerto pegado en un estado no lo reporta nadie.
   */
  it('no produce doble barra si la base viene con barra final', () => {
    expect(listingUrl(`${BASE}/`, 'abc')).toBe('https://nortecel.maat.work/p/abc');
    expect(listingUrl(`${BASE}///`, 'abc')).toBe('https://nortecel.maat.work/p/abc');
  });

  /**
   * La base entra por parámetro justamente para esto: en desarrollo y en los e2e el host no es
   * `maat.work`, y un link a producción mandaría a la persona (y al test) a un dominio que ahí no
   * resuelve.
   */
  it('respeta la base que le den, incluido el host de desarrollo', () => {
    expect(listingUrl('http://demo.localhost:3000', 'abc')).toBe('http://demo.localhost:3000/p/abc');
  });
});

describe('resolveFx · sin TC sincronizado no hay pesos inventados', () => {
  it('sin fila de TC, no hay TC', () => {
    expect(resolveFx(null)).toBeNull();
  });

  it('un TC guardado que no es aplicable degrada a null en vez de tirar', () => {
    expect(resolveFx({ arsCentsPerUsd: 0, rounding: 'ceil_1000' })).toBeNull();
    expect(resolveFx({ arsCentsPerUsd: -1, rounding: 'ceil_1000' })).toBeNull();
  });

  it('un TC válido conserva el modo de redondeo del tenant', () => {
    expect(resolveFx({ arsCentsPerUsd: 140_100, rounding: 'exact' })).toEqual({
      rate: { arsCentsPerUsd: 140_100 },
      rounding: 'exact',
    });
  });
});

describe('toStockListUnit · el ARS lo calcula el panel, no el builder', () => {
  /**
   * USD 620 a TC 1401 son ARS 868.620 exactos. Con `ceil_1000` —el default del tenant y como se
   * publica en la práctica— sale 869.000. Este test distingue los dos modos: si el mapeo ignorara
   * el `rounding` guardado y usara el default del dominio, el caso `exact` fallaría.
   */
  it('aplica el modo de redondeo del tenant, no uno fijo', () => {
    const ceil = toStockListUnit(row(), BASE, resolveFx({ arsCentsPerUsd: 140_100, rounding: 'ceil_1000' }));
    const exact = toStockListUnit(row(), BASE, resolveFx({ arsCentsPerUsd: 140_100, rounding: 'exact' }));
    expect(ceil.priceArsCents).toBe(86_900_000);
    expect(exact.priceArsCents).toBe(86_862_000);
  });

  it('sin TC, el renglón sale sólo en dólares y el equipo NO se pierde', () => {
    const unit = toStockListUnit(row(), BASE, null);
    expect(unit.priceArsCents).toBeNull();
    const entry = buildStockListEntry(unit);
    expect(entry).toContain('USD 620');
    expect(entry).not.toContain('$');
  });

  /**
   * El bug que midió W5 de `accept-s4.sh` en un browser real: el título del dueño ya trae storage
   * y color adentro, así que appendearlos otra vez imprime `256 Grafito 256 Grafito`. Se prueba
   * el efecto en el texto final, no el valor del discriminante: lo que se pega en un estado es el
   * texto.
   */
  it('un equipo sin modelo de catálogo usa el título del dueño SIN duplicar storage y color', () => {
    const unit = toStockListUnit(row({ modelDisplayName: null }), BASE, null);
    expect(buildStockListEntry(unit)).toContain('iPhone 14 Pro 256 Grafito ·');
    expect(buildStockListEntry(unit)).not.toContain('256 Grafito 256 Grafito');
  });

  it('un display_name en blanco es un nombre ausente y cae al título', () => {
    const unit = toStockListUnit(row({ modelDisplayName: '   ' }), BASE, null);
    expect(buildStockListEntry(unit)).toContain('iPhone 14 Pro 256 Grafito');
  });

  it('con modelo de catálogo, el nombre sale del catálogo y se le agregan storage y color', () => {
    const unit = toStockListUnit(row({ title: 'lo que sea que escribió el dueño' }), BASE, null);
    expect(buildStockListEntry(unit)).toContain('iPhone 14 Pro 256 Grafito ·');
  });

  /**
   * `CLAUDE.md` §2 y §0.9. La prohibición es de tipos, pero el tipo no está en runtime: esto
   * afirma que el objeto que llega al texto tiene **exactamente** la allowlist y ni una clave más.
   * Un `...row` puesto de apuro mañana enciende acá.
   */
  it('la unidad tiene exactamente la allowlist: ni costo, ni margen, ni imei, ni tenant', () => {
    const unit = toStockListUnit(row(), BASE, null);
    expect(Object.keys(unit).sort()).toEqual([
      'color',
      'condition',
      'modelDisplayName',
      'nameSource',
      'priceArsCents',
      'priceUsdCents',
      'status',
      'storageGb',
      'url',
    ]);
  });

  /**
   * Estado imposible: la query filtra por `PUBLIC_STATUSES`. Llegar acá con un borrador significa
   * que el `where` se rompió, y entonces lo correcto es hacer ruido — omitir esa unidad y publicar
   * el resto le daría al dueño una lista que parece completa.
   */
  it('un estado no público TIRA en vez de descartar el equipo en silencio', () => {
    for (const status of ['draft', 'in_service', 'in_tradein', 'in_transit', 'unavailable'] as const) {
      expect(() => toStockListUnit(row({ status }), BASE, null)).toThrow(/no es\s+público/u);
    }
  });
});

describe('buildStockListInput · nada se pierde en el camino', () => {
  /**
   * Los tres estados públicos, mezclados **a propósito**. Con un fixture de puros `available` un
   * `.filter(status === 'available')` metido de apuro sería un no-op y ningún test lo vería: la
   * lista saldría corta en producción y verde acá. Lo midió la mutación M7 de esta misma slice, que
   * pasó verde contra la versión anterior del fixture.
   */
  const PUBLIC_ROTATION = ['available', 'reserved', 'sold'] as const;
  const rows: readonly StockListRow[] = Array.from({ length: 37 }, (_, i) =>
    row({
      slug: `equipo-${String(i)}`,
      title: `Equipo ${String(i)}`,
      modelDisplayName: null,
      status: PUBLIC_ROTATION[i % PUBLIC_ROTATION.length] ?? 'available',
    }),
  );

  it('emite TODAS las unidades, aunque haya que partirlas en varios bloques', () => {
    const list = buildStockList(
      buildStockListInput({ businessName: 'Nortecel', slug: 'nortecel', storefrontBaseUrl: BASE, rows, fx: null }),
    );
    expect(list.unitCount).toBe(rows.length);
    expect(list.blocks.reduce((sum, block) => sum + block.unitCount, 0)).toBe(rows.length);
    expect(list.blocks.length).toBeGreaterThan(1);
  });

  it('cada equipo aparece una sola vez, con su link, en el texto de algún bloque', () => {
    const list = buildStockList(
      buildStockListInput({ businessName: 'Nortecel', slug: 'nortecel', storefrontBaseUrl: BASE, rows, fx: null }),
    );
    // Se cierra cada bloque con `\n` para poder contar la URL **completa**: sin eso,
    // `/p/equipo-1` matchearía adentro de `/p/equipo-10`, y el test diría "aparece 11 veces" de
    // un equipo que aparece una. Contar substrings sin anclar es la forma clásica de que un test
    // afirme algo distinto de lo que dice afirmar.
    const texto = `${list.blocks.map((block) => block.text).join('\n')}\n`;
    for (const r of rows) {
      const url = `${listingUrl(BASE, r.slug)}\n`;
      expect(texto.split(url).length - 1).toBe(1);
    }
  });

  it('preserva el orden que eligió la query: el bloque 1 arranca con la primera fila', () => {
    const list = buildStockList(
      buildStockListInput({ businessName: 'Nortecel', slug: 'nortecel', storefrontBaseUrl: BASE, rows, fx: null }),
    );
    expect(list.blocks[0]?.text).toContain(listingUrl(BASE, 'equipo-0'));
  });

  /**
   * Sin `now` no hay renglón de fecha (el dominio nunca inventa una). Con `now`, la fecha es la de
   * Argentina: un estado armado a las 21:30 de Cipolletti se fecharía **mañana** si se leyera la
   * zona del proceso, que en Vercel es UTC.
   */
  it('la fecha del encabezado sale de la `now` inyectada y en hora de Argentina', () => {
    const sinFecha = buildStockList(
      buildStockListInput({ businessName: 'Nortecel', slug: 'nortecel', storefrontBaseUrl: BASE, rows: [row()], fx: null }),
    );
    expect(sinFecha.blocks[0]?.text).not.toContain('Stock al');

    const conFecha = buildStockList(
      buildStockListInput({
        businessName: 'Nortecel',
        slug: 'nortecel',
        storefrontBaseUrl: BASE,
        rows: [row()],
        fx: null,
        now: new Date('2026-08-29T00:30:00.000Z'),
      }),
    );
    expect(conFecha.blocks[0]?.text).toContain('Stock al 28/08');
  });

  it('sin unidades no arma bloques: un encabezado solo no es una lista', () => {
    const list = buildStockList(
      buildStockListInput({ businessName: 'Nortecel', slug: 'nortecel', storefrontBaseUrl: BASE, rows: [], fx: null }),
    );
    expect(list.blocks).toEqual([]);
    expect(list.unitCount).toBe(0);
  });

  it('`maxBlockChars` llega al dominio: un presupuesto chico produce más bloques', () => {
    const apretado = buildStockList(
      buildStockListInput({
        businessName: 'Nortecel',
        slug: 'nortecel',
        storefrontBaseUrl: BASE,
        rows,
        fx: null,
        maxBlockChars: 300,
      }),
    );
    const ancho = buildStockList(
      buildStockListInput({ businessName: 'Nortecel', slug: 'nortecel', storefrontBaseUrl: BASE, rows, fx: null }),
    );
    expect(apretado.blocks.length).toBeGreaterThan(ancho.blocks.length);
    expect(apretado.unitCount).toBe(rows.length);
  });
});
