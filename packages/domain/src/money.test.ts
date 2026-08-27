import { describe, expect, it } from 'vitest';

import { DomainError } from './errors';
import { CENTS_PER_UNIT, assertCents, assertNonNegativeCents, formatAmount, formatArs, formatUsd } from './money';

describe('plata en enteros de centavos', () => {
  it('la unidad monetaria son 100 centavos enteros', () => {
    expect(CENTS_PER_UNIT).toBe(100);
    expect(formatAmount(CENTS_PER_UNIT)).toBe('1');
  });

  it('un precio con centavos en cero se muestra sin decimales', () => {
    expect(formatAmount(62_000)).toBe('620');
  });

  it('separa miles con punto, como se publica en un estado de IG', () => {
    expect(formatAmount(120_000)).toBe('1.200');
    expect(formatAmount(92_300_000)).toBe('923.000');
  });

  it('usa coma decimal cuando hay centavos', () => {
    expect(formatAmount(62_050)).toBe('620,50');
    expect(formatAmount(62_005)).toBe('620,05');
    expect(formatAmount(123_456_789)).toBe('1.234.567,89');
  });

  it('cero y negativos no rompen el formato', () => {
    expect(formatAmount(0)).toBe('0');
    expect(formatAmount(-62_000)).toBe('-620');
  });

  it('rechaza un float: la plata nunca es un double', () => {
    expect(() => assertCents(620.5, 'precio')).toThrow(DomainError);
    expect(() => formatAmount(620.5)).toThrow(/entero de centavos/u);
  });

  it('rechaza un entero fuera del rango seguro', () => {
    expect(() => assertCents(Number.MAX_SAFE_INTEGER + 2, 'precio')).toThrow(DomainError);
  });

  it('un precio no puede ser negativo', () => {
    expect(() => assertNonNegativeCents(-1, 'precio USD')).toThrow(/no puede ser negativo/u);
    expect(() => assertNonNegativeCents(0, 'precio USD')).not.toThrow();
  });

  it('los prefijos de moneda son los de la ficha', () => {
    expect(formatUsd(62_000)).toBe('USD 620');
    expect(formatArs(92_300_000)).toBe('$ 923.000');
  });
});
