import { describe, expect, it } from 'vitest';

import { DomainError } from './errors';
import {
  DEFAULT_FX_ROUNDING,
  applyFx,
  fxRateFromArsCents,
  fxRateFromDecimal,
  fxRateToDecimalString,
} from './fx';
import { formatArs } from './money';

const TC_1487_50 = fxRateFromDecimal('1487.50');

describe('applyFx — el TC lo pone el dueño y entra por parámetro', () => {
  it('U1 — la regla por default es techo al millar de pesos', () => {
    expect(DEFAULT_FX_ROUNDING).toBe('ceil_1000');
    // USD 620 * 1487,50 = ARS 922.250 exactos → techo al millar → 923.000
    expect(applyFx(62_000, TC_1487_50)).toBe(92_300_000);
    expect(formatArs(applyFx(62_000, TC_1487_50))).toBe('$ 923.000');
  });

  it('U1b — un monto ya redondo al millar no se mueve', () => {
    const rate = fxRateFromDecimal('1000');
    expect(applyFx(62_000, rate)).toBe(62_000_000); // ARS 620.000
  });

  it('U2 — los otros modos de redondeo son explícitos y estables', () => {
    // USD 583,45 * 1487,50 = ARS 867.881,875 → half-up al centavo = 867.881,88
    const usdCents = 58_345;
    expect(applyFx(usdCents, TC_1487_50, 'exact')).toBe(86_788_188);
    expect(applyFx(usdCents, TC_1487_50, 'ceil_100')).toBe(86_788_200);
    expect(applyFx(usdCents, TC_1487_50, 'nearest_1000')).toBe(86_800_000);
    expect(applyFx(usdCents, TC_1487_50, 'ceil_1000')).toBe(86_800_000);
  });

  it('U2b — `nearest_1000` baja y `ceil_1000` sube sobre el mismo número', () => {
    const rate = fxRateFromDecimal('1000');
    // USD 620,10 → ARS 620.100
    expect(applyFx(62_010, rate, 'nearest_1000')).toBe(62_000_000);
    expect(applyFx(62_010, rate, 'ceil_1000')).toBe(62_100_000);
  });

  it('U2c — el redondeo al centavo es half-up', () => {
    const halfCent = fxRateFromArsCents(50); // 0,50 ARS por USD
    expect(applyFx(1, halfCent, 'exact')).toBe(1); // 0,005 → 0,01
    expect(applyFx(1, fxRateFromArsCents(49), 'exact')).toBe(0); // 0,0049 → 0
  });

  it('U3 — TC 0 o negativo revienta: publicar ARS 0 es peor que no publicar', () => {
    expect(() => fxRateFromDecimal('0')).toThrow(DomainError);
    expect(() => fxRateFromArsCents(0)).toThrow(/Debe ser > 0/u);
    expect(() => fxRateFromArsCents(-148_750)).toThrow(/Debe ser > 0/u);
    expect(() => applyFx(62_000, { arsCentsPerUsd: -1 })).toThrow(DomainError);
  });

  it('U4 — un TC gigante no pierde un centavo por precisión de double', () => {
    const huge = fxRateFromArsCents(99_999_999_99); // ARS 999.999.999,99 por USD
    const result = applyFx(100, huge, 'exact'); // USD 1
    expect(result).toBe(9_999_999_999);
    expect(Number.isSafeInteger(result)).toBe(true);
  });

  it('U4b — si el resultado se sale del rango seguro, falla fuerte', () => {
    const huge = fxRateFromArsCents(Number.MAX_SAFE_INTEGER - 1);
    expect(() => applyFx(1_000_000, huge)).toThrow(/rango seguro/u);
  });

  it('acepta el TC decimal tal como lo tipea el dueño', () => {
    expect(fxRateFromDecimal('1487.50').arsCentsPerUsd).toBe(148_750);
    expect(fxRateFromDecimal('1487,50').arsCentsPerUsd).toBe(148_750);
    expect(fxRateFromDecimal('1487').arsCentsPerUsd).toBe(148_700);
    expect(fxRateFromDecimal('1487.5').arsCentsPerUsd).toBe(148_750);
    expect(fxRateFromDecimal(1487).arsCentsPerUsd).toBe(148_700);
    expect(fxRateFromDecimal(' 1487.50 ').arsCentsPerUsd).toBe(148_750);
  });

  it('rechaza basura y floats de JS en el TC', () => {
    expect(() => fxRateFromDecimal('mil quinientos')).toThrow(DomainError);
    expect(() => fxRateFromDecimal('1487.505')).toThrow(/formato esperado/u);
    expect(() => fxRateFromDecimal('1.487,50')).toThrow(DomainError);
    expect(() => fxRateFromDecimal(1487.5)).toThrow(/entero de pesos/u);
  });

  it('el precio USD tiene que ser un entero de centavos no negativo', () => {
    expect(() => applyFx(620.5, TC_1487_50)).toThrow(/entero de centavos/u);
    expect(() => applyFx(-1, TC_1487_50)).toThrow(/no puede ser negativo/u);
    expect(applyFx(0, TC_1487_50)).toBe(0);
  });

  it('el TC usado se muestra tal cual se guardó', () => {
    expect(fxRateToDecimalString(TC_1487_50)).toBe('1487.50');
    expect(fxRateToDecimalString(fxRateFromDecimal('1000'))).toBe('1000.00');
  });
});
