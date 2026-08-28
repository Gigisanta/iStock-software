import { describe, expect, it } from 'vitest';
import { MIN_ARS_PER_USD, parseFxArsPerUsd } from './parse-fx';

/**
 * El TC es el multiplicador de **todos** los precios del negocio: un error de una coma no publica
 * un equipo mal, publica el catálogo entero mal. Este test es sobre eso y no sobre aritmética.
 */

describe('parseFxArsPerUsd · lo que el dueño tipea de verdad', () => {
  it('pesos enteros', () => {
    expect(parseFxArsPerUsd('1487')).toEqual({ ok: true, arsCentsPerUsd: 148_700 });
  });

  it('con coma decimal, que es como se escribe acá', () => {
    expect(parseFxArsPerUsd('1487,50')).toEqual({ ok: true, arsCentsPerUsd: 148_750 });
  });

  it('con punto decimal, que es como lo escribe un teclado numérico', () => {
    expect(parseFxArsPerUsd('1487.5')).toEqual({ ok: true, arsCentsPerUsd: 148_750 });
  });

  it('espacios alrededor y adentro', () => {
    expect(parseFxArsPerUsd('  1 487 ')).toEqual({ ok: true, arsCentsPerUsd: 148_700 });
  });
});

describe('parseFxArsPerUsd · los tipeos que publican un catálogo mal', () => {
  /**
   * `1.487` es mil cuatrocientos ochenta y siete para el dueño. Si lo tomáramos como "uno con
   * cuarenta y ocho", un iPhone de USD 620 se publicaría a **$ 1.000** en la vidriera.
   */
  it('rechaza el separador de miles con punto', () => {
    const result = parseFxArsPerUsd('1.487');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('sin puntos de miles');
  });

  it('rechaza el separador de miles con coma', () => {
    expect(parseFxArsPerUsd('1,487').ok).toBe(false);
  });

  it('rechaza un TC abajo del piso de tipeo', () => {
    const result = parseFxArsPerUsd(String(MIN_ARS_PER_USD - 1));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('error de tipeo');
  });

  it('acepta justo el piso', () => {
    expect(parseFxArsPerUsd(String(MIN_ARS_PER_USD))).toEqual({
      ok: true,
      arsCentsPerUsd: MIN_ARS_PER_USD * 100,
    });
  });

  it('rechaza cero, que es el sentinel que haría tirar a fxRateFromArsCents en la vidriera', () => {
    expect(parseFxArsPerUsd('0').ok).toBe(false);
    expect(parseFxArsPerUsd('0,00').ok).toBe(false);
  });

  it('rechaza vacío, negativo, texto y notación científica', () => {
    for (const raw of ['', '   ', '-1487', 'mil', '1487e3', '1487..5', '14 87,5,5']) {
      expect(parseFxArsPerUsd(raw).ok, raw).toBe(false);
    }
  });

  it('rechaza más de dos decimales: truncar plata en silencio es un bug de negocio', () => {
    expect(parseFxArsPerUsd('1487,555').ok).toBe(false);
  });

  it('rechaza ocho cifras enteras', () => {
    expect(parseFxArsPerUsd('12345678').ok).toBe(false);
  });

  it('nunca devuelve un no-entero: la plata es centavos enteros', () => {
    const result = parseFxArsPerUsd('1487,99');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Number.isSafeInteger(result.arsCentsPerUsd)).toBe(true);
    expect(result.arsCentsPerUsd).toBe(148_799);
  });
});
