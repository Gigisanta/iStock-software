/**
 * **El presupuesto de bytes de la vidriera, testeado como aritmética y no como intención.**
 *
 * P3 dejó dicho que el criterio de S3 mide *el recurso que el browser eligió*, no el que el
 * pipeline generó. Esa medición la hace `qa-agent` con un browser real. Este archivo cubre la
 * mitad que un browser real **no** puede cubrir barato: que la elección sea correcta para cada
 * combinación de viewport y DPR que nos importa, incluidas las que no están en el harness.
 *
 * Por eso el test reimplementa el algoritmo de `srcset`/`sizes` en doce líneas. Es duplicación a
 * propósito, del mismo tipo que los techos de bytes escritos a mano en `e2e/_lib/photo.ts`: si el
 * test leyera la decisión del código, cambiar el código pondría el test en verde y el guard
 * dejaría de guardar. Acá el test conoce **la regla del browser**, no la nuestra.
 *
 * La regla, simplificada a lo que aplica: el browser calcula el ancho de la caja con `sizes`, lo
 * multiplica por el DPR y elige el candidato más chico cuyo `w` alcance ese número.
 */

import { describe, expect, it } from 'vitest';
import {
  CARD_WIDTH,
  DETAIL_WIDTH,
  GRID_PHOTO_SIZES,
  HERO_PHOTO_SIZES,
  HERO_WIDE_MEDIA,
  HERO_WIDE_SIZES,
  SECONDARY_PHOTO_SIZES,
  heroPhotoProps,
  photoImgProps,
} from './photo';

const PHOTO = {
  card: '/_media/v1/ab/card.webp',
  detail: '/_media/v1/ab/detail.webp',
  alt: 'iPhone 14 Pro visto de frente',
} as const;

/** Bytes medidos por el LEAD sobre la fixture de referencia (`packages/media/README.md`). */
const BYTES = { card: 50_692, detail: 128_570 } as const;

/** El techo de `scripts/accept-s3.sh` M2, escrito a mano. */
const CEILING_BYTES = 204_800;

function cssPx(value: string, viewportPx: number): number {
  if (value.endsWith('vw')) return (Number(value.slice(0, -2)) / 100) * viewportPx;
  if (value.endsWith('px')) return Number(value.slice(0, -2));
  throw new Error(`unidad no soportada en sizes: "${value}"`);
}

/** Evalúa un atributo `sizes` para un viewport dado. Primera condición que matchea, gana. */
function resolveSizes(sizes: string, viewportPx: number): number {
  for (const raw of sizes.split(',')) {
    const part = raw.trim();
    const conditional = /^\((min|max)-width:\s*(\d+)px\)\s+(.+)$/u.exec(part);
    if (conditional === null) return cssPx(part, viewportPx);
    const kind = conditional[1];
    const bound = Number(conditional[2]);
    const value = conditional[3];
    if (value === undefined) throw new Error(`sizes mal formado: "${sizes}"`);
    const matches = kind === 'min' ? viewportPx >= bound : viewportPx <= bound;
    if (matches) return cssPx(value, viewportPx);
  }
  throw new Error(`ningún tramo de "${sizes}" aplica a ${String(viewportPx)}px`);
}

/** Parsea `"/a.webp 800w, /b.webp 1600w"` y elige como elige un browser. */
function chosen(srcSet: string, sizes: string, viewportPx: number, dpr: number): string {
  const needed = resolveSizes(sizes, viewportPx) * dpr;
  const candidates = srcSet.split(',').map((entry) => {
    const [url, width] = entry.trim().split(/\s+/u);
    if (url === undefined || width === undefined) throw new Error(`srcSet mal formado: "${srcSet}"`);
    return { url, width: Number(width.replace(/w$/u, '')) };
  });
  candidates.sort((a, b) => a.width - b.width);
  const fit = candidates.find((c) => c.width >= needed) ?? candidates[candidates.length - 1];
  if (fit === undefined) throw new Error('srcSet vacío');
  return fit.url;
}

function bytesOf(url: string): number {
  return url === PHOTO.detail ? BYTES.detail : BYTES.card;
}

describe('photoImgProps', () => {
  it('sirve `card` como src: el fallback del browser viejo es el recurso barato', () => {
    expect(photoImgProps(PHOTO, GRID_PHOTO_SIZES).src).toBe(PHOTO.card);
  });

  it('ofrece los dos candidatos con el ancho REAL de `packages/media`', () => {
    const props = photoImgProps(PHOTO, GRID_PHOTO_SIZES);
    expect(props.srcSet).toBe(
      `${PHOTO.card} ${String(CARD_WIDTH)}w, ${PHOTO.detail} ${String(DETAIL_WIDTH)}w`,
    );
    expect(CARD_WIDTH).toBe(800);
    expect(DETAIL_WIDTH).toBe(1600);
  });

  it('propaga el `sizes` que le pasan, sin default: es argumento obligatorio', () => {
    expect(photoImgProps(PHOTO, SECONDARY_PHOTO_SIZES).sizes).toBe(SECONDARY_PHOTO_SIZES);
  });
});

describe('la grilla en el teléfono de la calle (390×844, DPR 3)', () => {
  const VIEWPORT = 390;
  const DPR = 3;

  it('elige `card` y no `detail`', () => {
    const props = photoImgProps(PHOTO, GRID_PHOTO_SIZES);
    expect(chosen(props.srcSet, props.sizes, VIEWPORT, DPR)).toBe(PHOTO.card);
  });

  it('queda holgadamente abajo del techo de 204.800 B por recurso', () => {
    const props = photoImgProps(PHOTO, GRID_PHOTO_SIZES);
    expect(bytesOf(chosen(props.srcSet, props.sizes, VIEWPORT, DPR))).toBeLessThanOrEqual(
      CEILING_BYTES,
    );
  });

  it('sigue eligiendo `card` en un teléfono chico (320 px) y en uno grande (430 px)', () => {
    const props = photoImgProps(PHOTO, GRID_PHOTO_SIZES);
    for (const viewport of [320, 390, 430]) {
      expect(chosen(props.srcSet, props.sizes, viewport, DPR)).toBe(PHOTO.card);
    }
  });
});

describe('el hero de la ficha', () => {
  it('en el teléfono `detail` NO es un candidato alcanzable, con ningún DPR', () => {
    const hero = heroPhotoProps(PHOTO);
    expect(hero.img.srcSet).not.toContain(PHOTO.detail);
    for (const dpr of [1, 2, 3, 4]) {
      expect(chosen(hero.img.srcSet, hero.img.sizes, 390, dpr)).toBe(PHOTO.card);
    }
  });

  it('en pantalla grande sí ofrece `detail`, que es donde la densidad se nota', () => {
    const hero = heroPhotoProps(PHOTO);
    expect(hero.wide.media).toBe(HERO_WIDE_MEDIA);
    expect(hero.wide.srcSet).toContain(PHOTO.detail);
    // 600 px de caja: a DPR 1 alcanza `card`; a DPR 2 hacen falta 1200 y gana `detail`.
    expect(chosen(hero.wide.srcSet, hero.wide.sizes, 1280, 1)).toBe(PHOTO.card);
    expect(chosen(hero.wide.srcSet, hero.wide.sizes, 1280, 2)).toBe(PHOTO.detail);
    expect(HERO_WIDE_SIZES).toBe('600px');
  });

  it('la ficha entera pesa 3 × card en el teléfono: ~152 KB de imagen', () => {
    const hero = heroPhotoProps(PHOTO);
    const secondary = photoImgProps(PHOTO, SECONDARY_PHOTO_SIZES);
    const total =
      bytesOf(chosen(hero.img.srcSet, hero.img.sizes, 390, 3)) +
      2 * bytesOf(chosen(secondary.srcSet, secondary.sizes, 390, 3));
    expect(total).toBe(3 * BYTES.card);
    expect(total).toBeLessThan(CEILING_BYTES);
  });

  it('el `sizes` del teléfono describe el layout de verdad (ancho completo)', () => {
    expect(HERO_PHOTO_SIZES).toBe('100vw');
    expect(resolveSizes(HERO_PHOTO_SIZES, 390)).toBe(390);
  });
});
