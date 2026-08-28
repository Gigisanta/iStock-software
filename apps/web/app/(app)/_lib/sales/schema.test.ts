import { describe, expect, it } from 'vitest';
import {
  PAYMENT_METHODS,
  paymentMethodSchema,
  salePriceSchema,
  saleFieldsSchema,
} from './schema';

/**
 * El borde de la venta manual.
 *
 * Lo que se afirma acá no es "Zod funciona": es que **este** borde acepte exactamente lo que una
 * persona escribe en el mostrador y rechace lo que archivaría una venta falsa. El caso caro es el
 * separador de miles — `"1.200"` es mil doscientos para el dueño y `1.2` para `parseFloat`, y una
 * coerción alegre archiva un iPhone vendido a USD 1,20 sin que nadie se entere hasta el reporte.
 *
 * Que `parseUsdToCents` haga bien su trabajo ya tiene test en `_lib/listings/parse-money.test.ts`;
 * acá se afirma que este schema lo **use** en vez de coercionar.
 */

describe('salePriceSchema', () => {
  it('acepta lo que se escribe en el mostrador y devuelve centavos enteros', () => {
    expect(salePriceSchema.parse('620')).toBe(62_000);
    expect(salePriceSchema.parse('620,50')).toBe(62_050);
    expect(salePriceSchema.parse('620.5')).toBe(62_050);
    expect(salePriceSchema.parse(' 620 ')).toBe(62_000);
  });

  /** El motivo entero de no usar `z.coerce.number()`. Un `1.200` no se adivina: se rechaza. */
  it('rechaza el separador de miles en vez de adivinar', () => {
    const result = salePriceSchema.safeParse('1.200');

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/sin puntos de miles/u);
  });

  /** `CHECK sales_price_positive` vive en Postgres; acá se falla antes y en castellano. */
  it('rechaza el cero y devuelve un mensaje accionable', () => {
    const result = salePriceSchema.safeParse('0');

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('El precio de venta tiene que ser mayor a cero.');
  });

  /** Un `FormData.get()` de un campo que no vino es `null`, no `undefined`. */
  it('un campo ausente no revienta: rebota con un mensaje', () => {
    const result = salePriceSchema.safeParse(null);

    expect(result.success).toBe(false);
    expect(typeof result.error?.issues[0]?.message).toBe('string');
  });

  it('rechaza texto que no es un número', () => {
    expect(salePriceSchema.safeParse('gratis').success).toBe(false);
    expect(salePriceSchema.safeParse('-620').success).toBe(false);
  });
});

describe('paymentMethodSchema', () => {
  it('acepta los códigos declarados', () => {
    for (const method of PAYMENT_METHODS) {
      expect(paymentMethodSchema.parse(method)).toBe(method);
    }
  });

  /**
   * Sin default. El `<select>` abre sin elegir y esto es lo que pasa cuando alguien manda igual:
   * rebota con un mensaje, no archiva "efectivo" en una venta que fue por transferencia.
   */
  it('sin elegir, rebota; no hay medio de pago por descarte', () => {
    const result = paymentMethodSchema.safeParse('');

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Elegí con qué te pagaron.');
  });

  it('un código inventado no entra', () => {
    expect(paymentMethodSchema.safeParse('bitcoin').success).toBe(false);
  });

  /** Los códigos son identificadores en inglés y estables: el reporte de margen agrupa por esto. */
  it('los códigos son estables y sin duplicados', () => {
    expect(new Set(PAYMENT_METHODS).size).toBe(PAYMENT_METHODS.length);
    expect(PAYMENT_METHODS).toContain('other');
  });
});

describe('saleFieldsSchema', () => {
  it('parsea los dos campos de la venta', () => {
    expect(saleFieldsSchema.parse({ priceUsdCents: '620', paymentMethod: 'transfer' })).toEqual({
      priceUsdCents: 62_000,
      paymentMethod: 'transfer',
    });
  });

  /**
   * **D2, del lado del borde.** El costo no está en el schema, así que un `POST` que lo mande no
   * tiene quién lo lea: Zod lo descarta y la fila de `sales` copia el costo de `listings` adentro
   * de la transacción. Si algún día alguien agrega el campo acá, esta aserción cae — que es
   * exactamente cuando tiene que caer, porque `margin_usd` se deriva del costo y escribir uno es
   * escribir el otro.
   */
  it('un costUsd de contrabando no sobrevive al borde', () => {
    const parsed = saleFieldsSchema.parse({
      priceUsdCents: '620',
      paymentMethod: 'transfer',
      costUsd: '1',
      marginUsd: '999',
      soldBy: 'otro-usuario',
    });

    expect(Object.keys(parsed).sort()).toEqual(['paymentMethod', 'priceUsdCents']);
  });
});
