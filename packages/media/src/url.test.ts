import { describe, expect, it } from 'vitest';
import { cardSrcSet, publicUrlForKey, variantUrl, variantUrls } from './url';
import { publicVariantKey, masterObjectKey } from './keys';
import { UnsafeMediaKeyError } from './errors';
import type { ListingPhotoKeys } from './types';

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);
const BASE = { baseUrl: 'https://img.maat.work' };

const photo: ListingPhotoKeys = {
  thumbKey: publicVariantKey(bytes('thumb')),
  cardKey: publicVariantKey(bytes('card')),
  detailKey: publicVariantKey(bytes('detail')),
};

describe('variantUrl', () => {
  it('arma la URL del CDN público', () => {
    expect(variantUrl(photo, 'card', BASE)).toBe(`https://img.maat.work/${photo.cardKey}`);
  });

  it('cada variante tiene su propia URL, sin parentesco visible', () => {
    const urls = variantUrls(photo, BASE);
    expect(new Set(Object.values(urls)).size).toBe(3);
  });

  it('la URL no filtra tenant_id, listing_id ni el string master', () => {
    for (const url of Object.values(variantUrls(photo, BASE))) {
      expect(url).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
      expect(url).not.toContain('master');
      expect(url).not.toContain('original');
    }
  });

  it('normaliza la barra final de la base', () => {
    expect(variantUrl(photo, 'thumb', { baseUrl: 'https://img.maat.work///' })).toBe(
      `https://img.maat.work/${photo.thumbKey}`,
    );
  });

  it('rechaza la key del master: la vidriera nunca recibe el original', () => {
    const master = masterObjectKey({
      tenantId: '11111111-1111-4111-8111-111111111111',
      listingId: '22222222-2222-4222-8222-222222222222',
      masterBytes: bytes('master'),
    });
    expect(() => publicUrlForKey(master, BASE)).toThrow(UnsafeMediaKeyError);
  });

  it('rechaza r2.dev (rate-limited, sin cache, sin WAF)', () => {
    expect(() => variantUrl(photo, 'card', { baseUrl: 'https://pub-abc.r2.dev' })).toThrow(
      UnsafeMediaKeyError,
    );
  });

  it('rechaza una foto sin la key de esa variante', () => {
    const rota = { ...photo, cardKey: undefined } as unknown as ListingPhotoKeys;
    expect(() => variantUrl(rota, 'card', BASE)).toThrow(UnsafeMediaKeyError);
  });
});

describe('cardSrcSet', () => {
  it('usa dos objetos ya guardados, no transformaciones on-the-fly', () => {
    const srcset = cardSrcSet(photo, BASE);
    expect(srcset).toContain('800w');
    expect(srcset).toContain('1600w');
    // Ni `/cdn-cgi/image/`, ni `_next/image`, ni query params de resize.
    expect(srcset).not.toContain('cdn-cgi');
    expect(srcset).not.toContain('_next/image');
    expect(srcset).not.toContain('?');
  });
});
