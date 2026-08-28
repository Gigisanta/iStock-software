/**
 * `numeric(12, 2)` en SQL ↔ entero de centavos en TS. La conversión tiene que ser **exacta**:
 * el día que alguien meta un `parseFloat` acá, la plata empieza a perder un centavo por operación
 * y nadie se entera hasta que un reseller cierra la caja y no le da.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { MoneyColumnError, centsToDecimal, decimalToCents } from './money';
import { openAdmin } from './test-session';

describe('conversión exacta, sin coma flotante', () => {
  it.each([
    ['0.00', 0], ['620.00', 62_000], ['1487.50', 148_750], ['0.01', 1], ['0.10', 10],
    ['9999999999.99', 999_999_999_999], ['-700.00', -70_000], ['12', 1_200], ['12.3', 1_230],
  ])('decimalToCents("%s") = %i', (text, cents) => {
    expect(decimalToCents(text)).toBe(cents);
  });

  it.each([
    [0, '0.00'], [62_000, '620.00'], [148_750, '1487.50'], [1, '0.01'], [-70_000, '-700.00'],
  ])('centsToDecimal(%i) = "%s"', (cents, text) => {
    expect(centsToDecimal(cents)).toBe(text);
  });

  it('ida y vuelta es identidad para todo centavo', () => {
    for (const cents of [0, 1, 99, 100, 101, 62_000, 148_750, 999_999_999_999]) {
      expect(decimalToCents(centsToDecimal(cents))).toBe(cents);
    }
  });

  it('el caso que rompe a los floats: 0.1 + 0.2 en centavos es exacto', () => {
    expect(decimalToCents('0.10') + decimalToCents('0.20')).toBe(30);
    expect(centsToDecimal(decimalToCents('0.10') + decimalToCents('0.20'))).toBe('0.30');
  });

  it('rechaza basura en vez de devolver NaN', () => {
    for (const bad of ['', 'abc', '1.234', '1,50', '1e3', ' ']) {
      expect(() => decimalToCents(bad), bad).toThrow(MoneyColumnError);
    }
  });

  it('rechaza lo que no entra en numeric(12, 2) antes de que lo rechace Postgres', () => {
    expect(() => centsToDecimal(1_000_000_000_000)).toThrow(MoneyColumnError);
    expect(() => centsToDecimal(1.5)).toThrow(MoneyColumnError);
  });
});

describe('ida y vuelta contra Postgres real', () => {
  const sql = openAdmin();
  afterAll(async () => { await sql.end({ timeout: 5 }); });

  it('lo que guarda el seed vuelve como los mismos centavos', async () => {
    const r = (await sql.unsafe(
      `select price_usd, cost_usd, margin_usd from listings where slug = 'iphone-14-pro-256-grafito'`,
    )) as unknown as { price_usd: string; cost_usd: string; margin_usd: string }[];
    // Valores corregidos 2026-08-28 (ver packages/db/src/seed-data.ts, función `usd()`):
    // USD 620 de precio y USD 520 de costo, no USD 62.000 / USD 52.000.
    expect(decimalToCents(r[0]?.price_usd ?? '')).toBe(62_000);
    expect(decimalToCents(r[0]?.cost_usd ?? '')).toBe(52_000);
    // El margen lo calcula Postgres (columna generada), no el código de la app.
    expect(decimalToCents(r[0]?.margin_usd ?? '')).toBe(10_000);
  });

  it('el TC del dueño vuelve como centavos de ARS por USD, listo para `applyFx`', async () => {
    const r = (await sql.unsafe(`select ars_per_usd from fx_settings limit 1`)) as unknown as {
      ars_per_usd: string;
    }[];
    expect(decimalToCents(r[0]?.ars_per_usd ?? '')).toBe(148_750);
  });
});
