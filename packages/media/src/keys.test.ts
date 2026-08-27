/**
 * La key pública es opaca **por contrato** (ADR-006 + `CLAUDE.md` §2). Este archivo es el que
 * tiene que ponerse rojo si alguien vuelve al esquema `t/{tenantId}/l/{listingId}/{variant}/…`.
 */

import { describe, expect, it } from 'vitest';
import {
  assertPublicVariantKey,
  contentHash,
  isMasterObjectKey,
  isPublicVariantKey,
  masterObjectKey,
  publicVariantKey,
} from './keys';
import { UnsafeMediaKeyError } from './errors';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const LISTING = '33333333-3333-4333-8333-333333333333';

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('key pública', () => {
  it('tiene la forma v1/{ab}/{sha256_32}.webp', () => {
    const key = publicVariantKey(bytes('una card cualquiera'));
    expect(key).toMatch(/^v1\/[0-9a-f]{2}\/[0-9a-f]{32}\.webp$/);
    expect(isPublicVariantKey(key)).toBe(true);
  });

  it('el shard son los dos primeros caracteres del hash', () => {
    const data = bytes('foto');
    const hash = contentHash(data);
    expect(publicVariantKey(data)).toBe(`v1/${hash.slice(0, 2)}/${hash}.webp`);
  });

  it('no contiene tenant_id, listing_id ni sufijo de variante', () => {
    const key = publicVariantKey(bytes('foto'));
    expect(key).not.toContain(TENANT_A);
    expect(key).not.toContain(LISTING);
    for (const token of ['thumb', 'card', 'detail', 'master', 'original']) {
      expect(key).not.toContain(token);
    }
  });

  it('sólo depende del byte de la variante: la función ni recibe el tenant', () => {
    // Firma de una sola posición: no puede filtrar lo que no conoce.
    expect(publicVariantKey.length).toBe(1);
  });

  it('desde la card no se puede derivar detail ni el master', () => {
    const card = publicVariantKey(bytes('bytes de la card'));
    const detail = publicVariantKey(bytes('bytes del detail'));
    const master = masterObjectKey({
      tenantId: TENANT_A,
      listingId: LISTING,
      masterBytes: bytes('bytes del master'),
    });
    expect(card).not.toBe(detail);
    // El único "parentesco" sería un sufijo o un prefijo común más allá de `v1/`.
    expect(card.slice(3)).not.toBe(detail.slice(3));
    expect(master).not.toContain(card.split('/')[2]);
  });

  it('es content-addressed: dos tenants con la MISMA foto comparten la key', () => {
    // Este es el hecho que hace que borrar por key sea un borrado cruzado entre tenants.
    const mismaFoto = bytes('el mismo iPhone 14 sobre el mismo escritorio');
    expect(publicVariantKey(mismaFoto)).toBe(publicVariantKey(mismaFoto));
    const paraA = publicVariantKey(mismaFoto);
    const paraB = publicVariantKey(mismaFoto);
    expect(paraA).toBe(paraB);
    expect(TENANT_A).not.toBe(TENANT_B); // dos tenants distintos, una sola key
  });

  it('cambia con el contenido (cache inmutable sin purge)', () => {
    expect(publicVariantKey(bytes('v1'))).not.toBe(publicVariantKey(bytes('v2')));
  });
});

describe('assertPublicVariantKey', () => {
  it('acepta una key válida', () => {
    expect(() => assertPublicVariantKey(publicVariantKey(bytes('ok')))).not.toThrow();
  });

  const rechazadas: [string, string][] = [
    ['vacía', ''],
    ['con tenant_id', `t/${TENANT_A}/l/${LISTING}/card/abc.webp`],
    ['con listing_id', `v1/ab/${LISTING}.webp`],
    ['con sufijo de variante', 'v1/ab/0123456789abcdef0123456789abcdef-card.webp'],
    ['con la palabra master', 'v1/ab/master0123456789abcdef0123456789.webp'],
    ['con IMEI', 'v1/ab/356938035643809.webp'],
    ['con email', 'v1/ab/hola@cactus.webp'],
    ['con path traversal', 'v1/../../etc/passwd'],
    ['jpg en vez de webp', 'v1/ab/0123456789abcdef0123456789abcdef.jpg'],
    ['hash corto', 'v1/ab/0123456789abcdef.webp'],
    ['sin versión', 'ab/0123456789abcdef0123456789abcdef.webp'],
  ];

  for (const [label, key] of rechazadas) {
    it(`rechaza una key ${label}`, () => {
      expect(() => assertPublicVariantKey(key)).toThrow(UnsafeMediaKeyError);
    });
  }

  it('rechaza la key del master aunque sea válida en su bucket', () => {
    const master = masterObjectKey({
      tenantId: TENANT_A,
      listingId: LISTING,
      masterBytes: bytes('master'),
    });
    expect(isMasterObjectKey(master)).toBe(true);
    expect(() => assertPublicVariantKey(master)).toThrow(UnsafeMediaKeyError);
  });
});

describe('key del master (bucket privado)', () => {
  it('es jerárquica por tenant y listing', () => {
    const key = masterObjectKey({
      tenantId: TENANT_A,
      listingId: LISTING,
      masterBytes: bytes('master'),
    });
    expect(key).toBe(`originals/${TENANT_A}/${LISTING}/${contentHash(bytes('master'))}.webp`);
  });

  it('exige UUIDs', () => {
    expect(() =>
      masterObjectKey({ tenantId: 'gigi', listingId: LISTING, masterBytes: bytes('x') }),
    ).toThrow(UnsafeMediaKeyError);
  });

  it('nunca pasa el gate de key pública', () => {
    const key = masterObjectKey({
      tenantId: TENANT_A,
      listingId: LISTING,
      masterBytes: bytes('master'),
    });
    expect(isPublicVariantKey(key)).toBe(false);
  });
});
