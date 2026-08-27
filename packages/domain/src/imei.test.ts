import { describe, expect, it } from 'vitest';

import { checkImei, luhnValid } from './imei';

describe('IMEI — warning, nunca un gate de alta', () => {
  it('valida Luhn sobre un IMEI correcto', () => {
    expect(luhnValid('356938035643809')).toBe(true);
    expect(checkImei('356938035643809')).toEqual({ hasFifteenDigits: true, luhnValid: true, warning: null });
  });

  it('un IMEI de 15 dígitos con verificador malo se GUARDA igual, con warning', () => {
    const result = checkImei('356938035643801');
    expect(result.hasFifteenDigits).toBe(true);
    expect(result.luhnValid).toBe(false);
    expect(result.warning).toMatch(/Podés guardarlo igual/u);
  });

  it('avisa cuando no son 15 dígitos', () => {
    expect(checkImei('12345').warning).toBe('El IMEI tiene que ser de 15 dígitos.');
    expect(checkImei('3569380356438091').hasFifteenDigits).toBe(false);
    expect(checkImei('35693803564380x').hasFifteenDigits).toBe(false);
  });

  it('tolera espacios y guiones tipeados por el dueño', () => {
    expect(checkImei('35-693803-564380-9').luhnValid).toBe(true);
    expect(checkImei(' 356938035643809 ').hasFifteenDigits).toBe(true);
  });

  it('nunca tira: el alta de stock no se bloquea por un IMEI raro', () => {
    for (const input of ['', '   ', 'no-es-un-imei', '0'.repeat(40)]) {
      expect(() => checkImei(input)).not.toThrow();
      expect(checkImei(input).luhnValid).toBe(false);
    }
  });

  it('luhnValid rechaza cualquier cosa que no sean dígitos', () => {
    expect(luhnValid('')).toBe(false);
    expect(luhnValid('abc')).toBe(false);
  });
});
