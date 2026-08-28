import { afterEach, describe, expect, it } from 'vitest';
import {
  cardSrcSet,
  publicUrlForKey,
  renderableVariantUrls,
  variantUrl,
  variantUrls,
  UNRENDERABLE_VARIANT_URL,
} from './url';
import { publicVariantKey, masterObjectKey } from './keys';
import {
  resetMediaIncidentReporter,
  setMediaIncidentReporter,
  type MediaIncident,
} from './incidents';
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

  it('rechaza r2.dev en el camino de escritura (rate-limited, sin cache, sin WAF)', () => {
    expect(() => publicUrlForKey(photo.cardKey, { baseUrl: 'https://pub-abc.r2.dev' })).toThrow(
      UnsafeMediaKeyError,
    );
  });

  it('con r2.dev el render degrada y reporta, no cuelga la ficha', () => {
    const vistos: MediaIncident[] = [];
    const url = variantUrl(photo, 'card', {
      baseUrl: 'https://pub-abc.r2.dev',
      onIncident: (i) => vistos.push(i),
    });
    expect(url).toBe(UNRENDERABLE_VARIANT_URL);
    expect(vistos.map((i) => i.code)).toEqual(['MEDIA_CONFIG']);
  });

  it('una foto sin la key de esa variante degrada, no tira', () => {
    const rota = { ...photo, cardKey: undefined } as unknown as ListingPhotoKeys;
    const vistos: MediaIncident[] = [];
    expect(variantUrl(rota, 'card', { ...BASE, onIncident: (i) => vistos.push(i) })).toBe(
      UNRENDERABLE_VARIANT_URL,
    );
    expect(vistos[0]?.reason).toContain('cardKey');
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

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  El camino de RENDER no puede tirar
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// Bajo `cacheComponents` una excepción adentro de un render cacheado no es un 500: es un 200 que
// nunca cierra el stream. `qa-agent` lo midió como un timeout de 300 s con un mensaje que ni
// siquiera hablaba de media. Estos tests son el único lugar donde eso queda afirmado, porque el
// síntoma no se puede reproducir con un `expect(...).toThrow()`.

afterEach(() => {
  resetMediaIncidentReporter();
});

/** Keys que un `listing_photos` roto podría tener y que el gate rechaza. Ninguna puede tirar. */
const KEYS_INVALIDAS: readonly [string, string][] = [
  ['con tenant_id', 'v1/ab/11111111-1111-4111-8111-111111111111.webp'],
  ['con la key del master', 'originals/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/0123456789abcdef0123456789abcdef.webp'],
  ['con un IMEI de verdad', 'v1/35/356938035643809.webp'],
  ['con sufijo de variante', 'v1/ab/0123456789abcdef0123456789abcdef-card.webp'],
  ['con path traversal', 'v1/../../etc/passwd'],
  ['vacía', ''],
  ['con el shard mentido', 'v1/ff/0123456789abcdef0123456789abcdef.webp'],
];

describe('render: una key inválida degrada, nunca tira', () => {
  for (const [etiqueta, mala] of KEYS_INVALIDAS) {
    it(`variantUrl no tira con una key ${etiqueta}`, () => {
      const rota: ListingPhotoKeys = { ...photo, cardKey: mala };
      const vistos: MediaIncident[] = [];
      const opciones = { ...BASE, onIncident: (i: MediaIncident) => vistos.push(i) };

      // Lo que se afirma NO es el valor: es que la llamada termina.
      expect(() => variantUrl(rota, 'card', opciones)).not.toThrow();
      expect(() => variantUrls(rota, opciones)).not.toThrow();
      expect(() => cardSrcSet(rota, opciones)).not.toThrow();
      expect(() => renderableVariantUrls(rota, opciones)).not.toThrow();

      expect(variantUrl(rota, 'card', opciones)).toBe(UNRENDERABLE_VARIANT_URL);
      // Degradar en silencio sería cambiar un problema ruidoso por uno invisible.
      expect(vistos.length).toBeGreaterThan(0);
      expect(vistos.every((i) => i.code === 'MEDIA_UNSAFE_KEY')).toBe(true);
    });
  }

  it('las variantes sanas de la misma foto se siguen sirviendo', () => {
    const rota: ListingPhotoKeys = { ...photo, cardKey: 'v1/ab/no-es-un-hash.webp' };
    const urls = variantUrls(rota, { ...BASE, onIncident: () => undefined });
    expect(urls.card).toBe(UNRENDERABLE_VARIANT_URL);
    expect(urls.detail).toBe(`https://img.maat.work/${photo.detailKey}`);
    expect(urls.thumb).toBe(`https://img.maat.work/${photo.thumbKey}`);
  });

  it('cardSrcSet omite el candidato roto en vez de emitirlo vacío', () => {
    // Un candidato con URL vacía rompe el parseo del `srcset` ENTERO: el browser se queda sin
    // `detail` también. Por eso se omite.
    const rota: ListingPhotoKeys = { ...photo, cardKey: 'v1/ab/no-es-un-hash.webp' };
    const srcset = cardSrcSet(rota, { ...BASE, onIncident: () => undefined });
    expect(srcset).toBe(`https://img.maat.work/${photo.detailKey} 1600w`);
    expect(srcset).not.toContain('  ');
    expect(srcset.startsWith(' ')).toBe(false);
  });

  it('el reporter global también se entera (no hace falta pasar opciones)', () => {
    const vistos: MediaIncident[] = [];
    setMediaIncidentReporter((i) => vistos.push(i));
    const rota: ListingPhotoKeys = { ...photo, cardKey: 'v1/ab/no-es-un-hash.webp' };
    expect(variantUrl(rota, 'card', BASE)).toBe(UNRENDERABLE_VARIANT_URL);
    expect(vistos).toHaveLength(1);
  });

  it('un reporter roto tampoco cuelga la ficha', () => {
    const rota: ListingPhotoKeys = { ...photo, cardKey: 'v1/ab/no-es-un-hash.webp' };
    expect(() =>
      variantUrl(rota, 'card', {
        ...BASE,
        onIncident: () => {
          throw new Error('Sentry caído');
        },
      }),
    ).not.toThrow();
  });

  it('el incidente no filtra la key entera del master', () => {
    const master = masterObjectKey({
      tenantId: '11111111-1111-4111-8111-111111111111',
      listingId: '22222222-2222-4222-8222-222222222222',
      masterBytes: bytes('master'),
    });
    const vistos: MediaIncident[] = [];
    variantUrl({ ...photo, cardKey: master }, 'card', {
      ...BASE,
      onIncident: (i) => vistos.push(i),
    });
    const incidente = vistos[0];
    expect(incidente).toBeDefined();
    expect(incidente?.keyPrefix).not.toContain('11111111');
    expect(JSON.stringify(vistos)).not.toContain(master);
  });
});

describe('el valor degradado no puede costar plata', () => {
  // Este bloque existe porque el sentinel se escapa de este paquete: `photo.ts` de la vidriera
  // concatena `${photo.card} 800w, ${photo.detail} 1600w` con lo que le devolvemos.
  it('no tiene coma ni espacio: no rompe un `srcset` de terceros ni inventa candidatos', () => {
    expect(UNRENDERABLE_VARIANT_URL).not.toContain(',');
    expect(UNRENDERABLE_VARIANT_URL).not.toContain(' ');
    expect(UNRENDERABLE_VARIANT_URL.length).toBeGreaterThan(0);
  });

  it('es absoluto y no resuelve contra nuestro origen: cero requests a la función de Next', () => {
    const resuelto = new URL(UNRENDERABLE_VARIANT_URL, 'https://nortecel.maat.work/s/nortecel/p/x');
    expect(resuelto.protocol).toBe('about:');
    expect(resuelto.href).not.toContain('maat.work');
  });

  it('un `srcset` armado afuera con el sentinel sigue teniendo 2 candidatos, no 2 URLs relativas', () => {
    const rota: ListingPhotoKeys = { ...photo, cardKey: 'v1/ab/no-es-un-hash.webp' };
    const urls = variantUrls(rota, { ...BASE, onIncident: () => undefined });
    const srcSetDeTerceros = `${urls.card} 800w, ${urls.detail} 1600w`;
    const candidatos = srcSetDeTerceros.split(',').map((c) => c.trim().split(/\s+/)[0]);
    expect(candidatos).toEqual([UNRENDERABLE_VARIANT_URL, `https://img.maat.work/${photo.detailKey}`]);
    // Con `''` el primer candidato habría sido la cadena `800w`, o sea una URL relativa pedible.
    expect(candidatos).not.toContain('800w');
  });
});

describe('renderableVariantUrls: la primitiva de OMITIR la foto', () => {
  it('devuelve las tres URLs cuando la foto está sana', () => {
    const urls = renderableVariantUrls(photo, BASE);
    expect(urls).not.toBeNull();
    expect(urls?.card).toBe(`https://img.maat.work/${photo.cardKey}`);
  });

  it('devuelve null si alguna variante no se puede servir: el caller saltea la foto', () => {
    const rota: ListingPhotoKeys = { ...photo, detailKey: 'v1/ab/no-es-un-hash.webp' };
    expect(renderableVariantUrls(rota, { ...BASE, onIncident: () => undefined })).toBeNull();
  });

  it('una ficha con una fila rota se arma con las fotos que sí sirven', () => {
    const filas: ListingPhotoKeys[] = [
      photo,
      { ...photo, cardKey: '' },
      { thumbKey: photo.thumbKey, cardKey: photo.cardKey, detailKey: photo.detailKey },
    ];
    const servibles = filas
      .map((f) => renderableVariantUrls(f, { ...BASE, onIncident: () => undefined }))
      .filter((u): u is NonNullable<typeof u> => u !== null);
    expect(servibles).toHaveLength(2);
  });
});
