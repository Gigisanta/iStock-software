import { describe, expect, it } from 'vitest';
import { SLUG_MAX_LENGTH, isSlugShaped } from '@istock/domain';
import { SLUG_SUFFIX_LENGTH, buildListingSlug, listingSlugBase, slugSuffix } from './listing-slug';

const bytes = (...values: number[]) => new Uint8Array(values);

describe('listingSlugBase', () => {
  it('normaliza un título real', () => {
    expect(listingSlugBase('iPhone 14 Pro 256 Grafito')).toBe('iphone-14-pro-256-grafito');
  });

  it('saca acentos y signos', () => {
    expect(listingSlugBase('Samsung Galaxy S23 — Ultra (¡nuevo!)')).toBe(
      'samsung-galaxy-s23-ultra-n',
    );
  });

  it('cae al fallback cuando el título no deja letras usables', () => {
    expect(listingSlugBase('📱📱📱')).toBe('equipo');
    expect(listingSlugBase('!!')).toBe('equipo');
  });

  it('nunca termina en guión aunque el corte caiga en uno', () => {
    expect(listingSlugBase('a'.repeat(25) + ' pro')).not.toMatch(/-$/u);
  });
});

describe('slugSuffix', () => {
  it('es determinista para los mismos bytes', () => {
    expect(slugSuffix(bytes(0, 1, 2, 3, 4))).toBe(slugSuffix(bytes(0, 1, 2, 3, 4)));
    expect(slugSuffix(bytes(0, 1, 2, 3, 4))).toHaveLength(SLUG_SUFFIX_LENGTH);
  });

  it('no usa caracteres ambiguos (l, o, 0, 1)', () => {
    for (let i = 0; i < 256; i += 1) {
      expect(slugSuffix(bytes(i, i, i, i, i))).not.toMatch(/[lo01]/u);
    }
  });
});

describe('buildListingSlug', () => {
  it('siempre tiene forma de slug válida', () => {
    const titles = ['iPhone 14 Pro', '📱', 'x', 'A'.repeat(200), '---', '256 GB'];
    for (const title of titles) {
      const slug = buildListingSlug(title, bytes(9, 8, 7, 6, 5));
      expect(isSlugShaped(slug), `${title} → ${slug}`).toBe(true);
      expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    }
  });

  it('dos equipos con el mismo título no colisionan', () => {
    const a = buildListingSlug('iPhone 14 Pro 256 Grafito', bytes(1, 2, 3, 4, 5));
    const b = buildListingSlug('iPhone 14 Pro 256 Grafito', bytes(6, 7, 8, 9, 10));
    expect(a).not.toBe(b);
  });
});
