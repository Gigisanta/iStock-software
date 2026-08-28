import { describe, expect, it } from 'vitest';
import { formatAmount } from '@istock/domain';
import { parseUsdToCents } from '../listings/parse-money';
import { PAYMENT_METHOD_OPTIONS, paymentMethodLabel, priceInputValue } from './presentation';
import { PAYMENT_METHODS } from './schema';

describe('paymentMethodLabel', () => {
  it('cada código tiene una etiqueta de mostrador, y ninguna se repite', () => {
    const labels = PAYMENT_METHODS.map(paymentMethodLabel);

    expect(labels.every((label) => label.length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('PAYMENT_METHOD_OPTIONS', () => {
  /**
   * El `<select>` se dibuja con esto, así que el orden y el conjunto tienen que ser los del schema:
   * una opción que el borde no acepta es un formulario que rebota después del toque.
   */
  it('son exactamente los códigos del schema, en el mismo orden', () => {
    expect(PAYMENT_METHOD_OPTIONS.map((option) => option.value)).toEqual([...PAYMENT_METHODS]);
  });
});

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  `priceInputValue` es el INVERSO de `parseUsdToCents`, y así se afirma
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * No se comparan strings a ojo: se hace la ida y la vuelta. Un formateador de pantalla que se cuele
 * como `defaultValue` de este input dejaría el formulario precargado con un valor que el propio
 * borde rechaza, y sólo para los equipos de USD 1.000 para arriba — el caso que más se vende.
 */
describe('priceInputValue', () => {
  const CASES = [0, 1, 99, 62_000, 62_050, 120_000, 1_299_990, 99_999_999];

  it('lo que devuelve, el borde lo vuelve a parsear al mismo número', () => {
    for (const cents of CASES) {
      const parsed = parseUsdToCents(priceInputValue(cents));
      expect(parsed.ok ? parsed.cents : `rechazado: ${priceInputValue(cents)}`).toBe(cents);
    }
  });

  it('omite los centavos en cero y usa coma cuando los hay', () => {
    expect(priceInputValue(62_000)).toBe('620');
    expect(priceInputValue(62_050)).toBe('620,50');
    expect(priceInputValue(62_005)).toBe('620,05');
  });

  /**
   * El caso que motiva el módulo entero. `formatAmount()` mete separador de miles porque es como se
   * **lee** un precio, y `parseUsdToCents` lo rechaza a propósito porque es ambiguo. Esta aserción
   * fija que los dos hacen cosas distintas: el día que alguien "simplifique" usando el formateador
   * acá, cae.
   */
  it('NO es formatAmount: el del formateador de pantalla no pasa el borde', () => {
    expect(formatAmount(120_000)).toBe('1.200');
    expect(parseUsdToCents(formatAmount(120_000)).ok).toBe(false);
    expect(parseUsdToCents(priceInputValue(120_000)).ok).toBe(true);
  });

  /** Basura adentro, string vacío afuera: el input abre en blanco en vez de con un `NaN`. */
  it('un valor imposible deja el input vacío', () => {
    expect(priceInputValue(Number.NaN)).toBe('');
    expect(priceInputValue(-1)).toBe('');
    expect(priceInputValue(1.5)).toBe('');
  });
});
