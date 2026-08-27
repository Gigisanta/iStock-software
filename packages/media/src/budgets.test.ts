import { describe, expect, it } from 'vitest';
import {
  MASTER_SPEC,
  MAX_OUTPUT_EDGE,
  MAX_UPLOAD_BYTES,
  VARIANT_BUDGETS,
  VARIANT_SPECS,
  assertWithinBudget,
  qualityLadder,
} from './budgets';
import { VariantBudgetExceededError } from './errors';
import { VARIANTS } from './types';

describe('tabla de presupuestos', () => {
  it('los techos son los del contrato del oficio', () => {
    expect(VARIANT_BUDGETS.thumb).toBe(25 * 1024);
    expect(VARIANT_BUDGETS.card).toBe(150 * 1024);
    expect(VARIANT_BUDGETS.detail).toBe(250 * 1024);
  });

  it('ninguna variante pasa de 1600px', () => {
    for (const v of VARIANTS) {
      expect(VARIANT_SPECS[v].maxEdge).toBeLessThanOrEqual(MAX_OUTPUT_EDGE);
    }
    expect(MASTER_SPEC.maxEdge).toBe(MAX_OUTPUT_EDGE);
  });

  it('el upload rechaza archivos gigantes antes de decodificar', () => {
    expect(MAX_UPLOAD_BYTES).toBe(25 * 1024 * 1024);
  });
});

describe('assertWithinBudget', () => {
  it('pasa justo en el techo', () => {
    expect(() => assertWithinBudget('card', 150 * 1024)).not.toThrow();
  });

  it('lanza un byte por encima', () => {
    expect(() => assertWithinBudget('card', 150 * 1024 + 1)).toThrow(VariantBudgetExceededError);
  });

  it('el error trae los números para el reporte de costo', () => {
    try {
      assertWithinBudget('thumb', 999_999, { quality: 45 });
      expect.unreachable('debería haber lanzado');
    } catch (error) {
      const e = error as VariantBudgetExceededError;
      expect(e.variant).toBe('thumb');
      expect(e.byteLength).toBe(999_999);
      expect(e.budgetBytes).toBe(25 * 1024);
      expect(e.quality).toBe(45);
    }
  });

  it('acepta una tabla de techos inyectada (tests del gate)', () => {
    expect(() =>
      assertWithinBudget('card', 5_000, { budgets: { thumb: 1, card: 1_000, detail: 1 } }),
    ).toThrow(VariantBudgetExceededError);
  });
});

describe('qualityLadder', () => {
  it('baja de la calidad nominal al piso e incluye el piso', () => {
    const ladder = qualityLadder(VARIANT_SPECS.card);
    expect(ladder[0]).toBe(VARIANT_SPECS.card.quality);
    expect(ladder.at(-1)).toBe(VARIANT_SPECS.card.minQuality);
    expect(ladder.every((q, i) => i === 0 || q < (ladder[i - 1] ?? 0))).toBe(true);
  });
});
