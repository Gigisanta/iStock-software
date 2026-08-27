/**
 * GATE DE ACEPTACIÓN DE S2.
 *
 * Este archivo **falla si una variante supera su presupuesto de bytes** con una imagen de
 * referencia real (12 MP, generada de forma determinista con sharp).
 *
 * Los techos están escritos como literales, NO importados de `budgets.ts`, a propósito: si
 * alguien "arregla" un fallo subiendo la constante del presupuesto, el test tiene que seguir
 * rojo. El gate no puede ser configurable por el código bajo test.
 */

import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { buildVariants } from './pipeline';
import { VARIANT_BUDGETS, VARIANT_SPECS, MASTER_SPEC } from './budgets';
import { VariantBudgetExceededError, UnsupportedImageError } from './errors';
import { VARIANTS } from './types';
import {
  REFERENCE_HEIGHT,
  REFERENCE_WIDTH,
  incompressibleNoise,
  referencePhotoJpeg,
  stressPhoto,
  tinyPng,
} from './fixtures/reference-image';

/** Techos duros, en bytes. Copiados a mano desde el contrato del oficio + `docs/COST.md`. */
const HARD_BUDGET_BYTES = {
  thumb: 25 * 1024,
  card: 150 * 1024,
  detail: 250 * 1024,
} as const;

const MASTER_HARD_BUDGET_BYTES = 350 * 1024;

describe('presupuesto de bytes con la imagen de referencia de 12 MP', () => {
  it('la fuente es realmente una foto de celular: 12 MP y varios MB', async () => {
    const jpeg = await referencePhotoJpeg();
    const meta = await sharp(jpeg).metadata();
    expect(meta.width).toBe(REFERENCE_WIDTH);
    expect(meta.height).toBe(REFERENCE_HEIGHT);
    expect(meta.format).toBe('jpeg');
    // Si el fixture degenerara en algo liso, el gate dejaría de medir nada.
    expect(jpeg.byteLength).toBeGreaterThan(1_500_000);
  });

  it('ninguna variante supera su techo', async () => {
    const built = await buildVariants(await referencePhotoJpeg());

    const report = VARIANTS.map((v) => ({
      variant: v,
      bytes: built.variants[v].byteLength,
      budget: HARD_BUDGET_BYTES[v],
      pct: Math.round((built.variants[v].byteLength / HARD_BUDGET_BYTES[v]) * 100),
    }));

    for (const row of report) {
      expect(
        row.bytes,
        `variante ${row.variant}: ${row.bytes} bytes contra un techo de ${row.budget} (${row.pct}%)`,
      ).toBeLessThanOrEqual(row.budget);
    }

    expect(built.master.byteLength).toBeLessThanOrEqual(MASTER_HARD_BUDGET_BYTES);
  });

  it('las constantes de presupuesto no se aflojaron', () => {
    expect(VARIANT_BUDGETS.thumb).toBe(HARD_BUDGET_BYTES.thumb);
    expect(VARIANT_BUDGETS.card).toBe(HARD_BUDGET_BYTES.card);
    expect(VARIANT_BUDGETS.detail).toBe(HARD_BUDGET_BYTES.detail);
    expect(MASTER_SPEC.budgetBytes).toBe(MASTER_HARD_BUDGET_BYTES);
  });

  it('entra en el techo a calidad nominal, sin degradar', async () => {
    // Si alguien sube `quality` o `maxEdge`, esto se pone rojo aunque el techo se siga cumpliendo
    // por el descenso adaptativo. El presupuesto no se paga con calidad sin que se note.
    const built = await buildVariants(await referencePhotoJpeg());
    for (const v of VARIANTS) {
      expect(built.variants[v].attempts, `${v} necesitó degradar calidad`).toBe(1);
      expect(built.variants[v].quality).toBe(VARIANT_SPECS[v].quality);
    }
  });

  it('respeta el lado mayor de cada variante y nunca pasa de 1600px', async () => {
    const built = await buildVariants(await referencePhotoJpeg());
    for (const v of VARIANTS) {
      const { width, height } = built.variants[v];
      expect(Math.max(width, height)).toBe(VARIANT_SPECS[v].maxEdge);
      expect(Math.max(width, height)).toBeLessThanOrEqual(1600);
    }
    // El master tampoco: el 12 MP no se guarda tal cual (regla 1 del oficio).
    expect(Math.max(built.master.width, built.master.height)).toBe(1600);
  });

  it('todas las salidas son WebP', async () => {
    const built = await buildVariants(await referencePhotoJpeg());
    for (const v of VARIANTS) {
      expect((await sharp(built.variants[v].bytes).metadata()).format).toBe('webp');
    }
    expect((await sharp(built.master.bytes).metadata()).format).toBe('webp');
  });

  it('descarta EXIF (el GPS de la foto del dueño es PII y no va a un bucket público)', async () => {
    const withExif = await sharp(await referencePhotoJpeg())
      .withExif({ IFD0: { Copyright: 'gigi', Software: 'iStock' }, IFD2: { GPSLatitudeRef: 'S' } })
      .toBuffer();
    const built = await buildVariants(withExif);
    for (const v of VARIANTS) {
      const meta = await sharp(built.variants[v].bytes).metadata();
      expect(meta.exif).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
    }
    expect((await sharp(built.master.bytes).metadata()).exif).toBeUndefined();
  });

  it('es determinista: dos corridas producen el mismo byte', async () => {
    const jpeg = await referencePhotoJpeg();
    const a = await buildVariants(jpeg);
    const b = await buildVariants(jpeg);
    for (const v of VARIANTS) {
      expect(Buffer.compare(a.variants[v].bytes, b.variants[v].bytes)).toBe(0);
    }
  });
});

describe('el gate falla cuando tiene que fallar', () => {
  it('con techos ridículos, la imagen de referencia lanza VariantBudgetExceededError', async () => {
    // Prueba que el presupuesto está cableado DENTRO del pipeline y no es sólo un assert del test.
    await expect(
      buildVariants(await referencePhotoJpeg(), {
        budgets: { thumb: 25 * 1024, card: 4_096, detail: 250 * 1024 },
      }),
    ).rejects.toBeInstanceOf(VariantBudgetExceededError);
  });

  it('el error dice qué variante y con qué números', async () => {
    let caught: unknown;
    try {
      await buildVariants(await referencePhotoJpeg(), {
        budgets: { thumb: 25 * 1024, card: 4_096, detail: 250 * 1024 },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(VariantBudgetExceededError);
    const error = caught as VariantBudgetExceededError;
    expect(error.variant).toBe('card');
    expect(error.budgetBytes).toBe(4_096);
    expect(error.byteLength).toBeGreaterThan(4_096);
    expect(error.code).toBe('MEDIA_BUDGET_EXCEEDED');
  });

  it('ni el ruido puro sale pesado a la vidriera', async () => {
    // Ruido por píxel: el peor caso posible para un encoder. Sale degradado, pero SIEMPRE bajo
    // el techo. Lo que nunca puede pasar es que se sirva una variante de 1 MB.
    const built = await buildVariants(await incompressibleNoise(1600, 1200));
    expect(built.variants.detail.byteLength).toBeLessThanOrEqual(HARD_BUDGET_BYTES.detail);
    expect(built.variants.card.byteLength).toBeLessThanOrEqual(HARD_BUDGET_BYTES.card);
    expect(built.variants.detail.degraded).toBe(true);
    expect(built.variants.detail.blurSigma).toBeGreaterThan(0);
  });

  it('cuando ni el denoise alcanza, lanza en vez de servir de más', async () => {
    // 2 KB para una card de 800px es imposible: se agota la escalera y los dos pasos de denoise.
    await expect(
      buildVariants(await incompressibleNoise(1600, 1200), {
        budgets: { thumb: 25 * 1024, card: 2_048, detail: 250 * 1024 },
      }),
    ).rejects.toBeInstanceOf(VariantBudgetExceededError);
  });
});

describe('descenso adaptativo de calidad', () => {
  it('una foto de textura difícil entra igual en el techo, degradando calidad', async () => {
    const built = await buildVariants(await stressPhoto());
    const card = built.variants.card;
    expect(card.attempts, 'esta foto debería necesitar más de un intento').toBeGreaterThan(1);
    expect(card.quality).toBeLessThan(VARIANT_SPECS.card.quality);
    expect(card.degraded).toBe(true);
    expect(card.byteLength).toBeLessThanOrEqual(HARD_BUDGET_BYTES.card);
  });

  it('el master no se blurea nunca y nunca rechaza la foto', async () => {
    // El master es archivo: bluearlo arruinaría el re-encode del día que cambiemos tamaños.
    const built = await buildVariants(await incompressibleNoise(1600, 1200));
    expect(built.master.blurSigma).toBe(0);
    expect(built.master.byteLength).toBeGreaterThan(0);
    // Esta imagen no entra en 350 KB ni al mínimo: se guarda igual y se reporta.
    expect(built.masterWithinBudget).toBe(false);
  });

  it('la foto de referencia sale sin degradar', async () => {
    const built = await buildVariants(await referencePhotoJpeg());
    for (const v of VARIANTS) {
      expect(built.variants[v].degraded, `${v} salió degradada`).toBe(false);
      expect(built.variants[v].blurSigma).toBe(0);
    }
  });
});

describe('validación de entrada', () => {
  it('acepta PNG chico sin agrandarlo (withoutEnlargement)', async () => {
    const built = await buildVariants(await tinyPng(64));
    expect(built.variants.detail.width).toBe(64);
    expect(built.variants.card.width).toBe(64);
    expect(built.variants.thumb.width).toBe(64);
  });

  it('rechaza lo que no es imagen', async () => {
    await expect(buildVariants(Buffer.from('no soy una foto, soy un csv'))).rejects.toBeInstanceOf(
      UnsupportedImageError,
    );
  });

  it('rechaza SVG (XSS y bombas de decode)', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
    );
    await expect(buildVariants(svg)).rejects.toBeInstanceOf(UnsupportedImageError);
  });
});
