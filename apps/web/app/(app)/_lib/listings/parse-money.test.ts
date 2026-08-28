import { describe, expect, it } from 'vitest';
import { parseUsdToCents } from './parse-money';

describe('parseUsdToCents', () => {
  it('entero simple', () => {
    expect(parseUsdToCents('620')).toEqual({ ok: true, cents: 62000 });
  });

  it('acepta coma y punto como separador decimal', () => {
    expect(parseUsdToCents('620,50')).toEqual({ ok: true, cents: 62050 });
    expect(parseUsdToCents('620.50')).toEqual({ ok: true, cents: 62050 });
  });

  it('un solo decimal se completa a centavos', () => {
    expect(parseUsdToCents('620,5')).toEqual({ ok: true, cents: 62050 });
  });

  it('ignora espacios alrededor y adentro', () => {
    expect(parseUsdToCents('  1200 ')).toEqual({ ok: true, cents: 120000 });
  });

  /**
   * El caso que justifica todo el módulo: `1.200` es mil doscientos para el dueño y uno con dos
   * para `parseFloat`. Se rechaza en vez de adivinar — publicar un iPhone a USD 1,20 es peor que
   * pedirle que lo escriba sin punto.
   */
  it('rechaza separadores de miles en vez de adivinar', () => {
    expect(parseUsdToCents('1.200').ok).toBe(false);
    expect(parseUsdToCents('1,200').ok).toBe(false);
  });

  it('rechaza vacío, texto y negativos', () => {
    for (const bad of ['', '   ', 'seiscientos', '-620', '620,505', '$620', '6e3']) {
      expect(parseUsdToCents(bad).ok, bad).toBe(false);
    }
  });

  it('el resultado es siempre un entero seguro', () => {
    const result = parseUsdToCents('999999999,99');
    expect(result.ok).toBe(true);
    if (result.ok) expect(Number.isSafeInteger(result.cents)).toBe(true);
  });
});
