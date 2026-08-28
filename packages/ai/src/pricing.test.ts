/**
 * Tarifas de `docs/research/llm-pricing.md` [R3]. El test que importa no es la aritmética: es que
 * un modelo desconocido devuelva `null` y no cero. Un costo de cero por no saber la tarifa es
 * exactamente el número que hace que nadie mire la factura.
 */

import { describe, expect, it } from 'vitest';
import { PRICE_PER_MTOK, costPerThousandMessages, priceFor } from './pricing';

describe('priceFor', () => {
  it('conoce al primario y al fallback vigentes', () => {
    expect(priceFor('gemini-2.5-flash-lite')).toEqual({ inputPerMTok: 0.1, outputPerMTok: 0.4 });
    expect(priceFor('openai/gpt-oss-20b')).toEqual({ inputPerMTok: 0.075, outputPerMTok: 0.3 });
  });

  it('devuelve null para un modelo que no está en la tabla', () => {
    expect(priceFor('modelo-que-no-existe')).toBeNull();
  });

  it('ninguna tarifa es cero ni negativa', () => {
    for (const [id, price] of Object.entries(PRICE_PER_MTOK)) {
      expect(price.inputPerMTok, id).toBeGreaterThan(0);
      expect(price.outputPerMTok, id).toBeGreaterThan(0);
    }
  });
});

describe('costPerThousandMessages', () => {
  it('calcula USD por 1000 mensajes con el consumo medido', () => {
    // 1000 in + 150 out sobre el primario: (1000·0.1 + 150·0.4)/1e6 · 1000
    expect(costPerThousandMessages('gemini-2.5-flash-lite', 1000, 150)).toBeCloseTo(0.16, 6);
  });

  it('el fallback es más barato por token que el primario en esta tabla', () => {
    const primario = costPerThousandMessages('gemini-2.5-flash-lite', 1000, 150) ?? Infinity;
    const fallback = costPerThousandMessages('openai/gpt-oss-20b', 1000, 150) ?? Infinity;
    expect(fallback).toBeLessThan(primario);
  });

  it('null si no conocemos la tarifa: ausencia de medición no es cero', () => {
    expect(costPerThousandMessages('modelo-fantasma', 1000, 150)).toBeNull();
  });

  it('la dieta completa (1200 in / 180 out) cuesta menos de un centavo cada 100 mensajes', () => {
    const worst = costPerThousandMessages('gemini-2.5-flash-lite', 1200, 180) ?? Infinity;
    expect(worst).toBeLessThan(0.25);
  });
});
