/**
 * La key pública es opaca **por contrato** (ADR-006 + `CLAUDE.md` §2). Este archivo es el que
 * tiene que ponerse rojo si alguien vuelve al esquema `t/{tenantId}/l/{listingId}/{variant}/…`.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  assertPublicVariantKey,
  contentHash,
  isMasterObjectKey,
  isPublicVariantKey,
  masterObjectKey,
  publicVariantKey,
  publicVariantKeyProblem,
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

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  El falso positivo de IMEI dentro del hash (defecto medido, 2026-08-28)
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// `/\d{15}/` está **escrito a mano acá**, igual que los literales de presupuesto de
// `budgets.test.ts` y por el mismo motivo: si el test importara el regex de `keys.ts`, aflojar el
// regex pondría el test en verde y el guard dejaría de guardar. Esta copia afirma dos cosas
// distintas a la vez: (1) que el fenómeno existe —hay keys legítimas con 15 dígitos seguidos— y
// (2) que el gate igual las acepta. Si alguien "arregla" el falso positivo cambiando el regex a
// algo que ya no matchea hex, (1) se pone rojo y el arreglo se nota.
const QUINCE_DIGITOS = /\d{15}/;

/** El hash tal cual lo produce `contentHash`, sin pasar por el pipeline de imágenes. */
const hashDe = (semilla: string): string =>
  createHash('sha256').update(semilla).digest('hex').slice(0, 32);

describe('una key legítima con 15 dígitos seguidos NO es un IMEI', () => {
  // El caso exacto que reprodujo el LEAD antes de despachar el arreglo.
  const SEMILLA = 'foto-de-un-iphone-559';
  const HASH = '09c47cc8be5dc3197181915259251fb7';
  const KEY = 'v1/09/09c47cc8be5dc3197181915259251fb7.webp';
  const CORRIDA = '319718191525925';

  it('el caso de referencia es determinista y sigue conteniendo 15 dígitos', () => {
    expect(hashDe(SEMILLA)).toBe(HASH);
    expect(QUINCE_DIGITOS.exec(KEY)?.[0]).toBe(CORRIDA);
  });

  it('no es una key inventada: la escribe el constructor real para esos bytes', () => {
    expect(publicVariantKey(bytes(SEMILLA))).toBe(KEY);
  });

  it('se acepta: el reseller puede subir esa foto', () => {
    expect(publicVariantKeyProblem(KEY)).toBeNull();
    expect(() => { assertPublicVariantKey(KEY); }).not.toThrow();
  });

  // ──────────────────────────────────────────────────────────────────────────────────────────
  //  Censo. Contar hashes, no argumentar.
  // ──────────────────────────────────────────────────────────────────────────────────────────
  it('sobre 200.000 hashes reales: los que pegan /\\d{15}/ existen y TODOS pasan el gate', () => {
    const N = 200_000;
    let conCorrida = 0;
    let rechazadas = 0;
    for (let i = 0; i < N; i += 1) {
      const hash = hashDe(`foto-de-un-iphone-${String(i)}`);
      const key = `v1/${hash.slice(0, 2)}/${hash}.webp`;
      if (QUINCE_DIGITOS.test(key)) conCorrida += 1;
      if (publicVariantKeyProblem(key) !== null) rechazadas += 1;
    }
    // ~0,63 % de 200.000 ≈ 1.266. La cota de abajo es holgada: lo que se afirma es "esto pasa
    // seguido", no un valor exacto.
    expect(conCorrida).toBeGreaterThan(500);
    // Y ninguna de ellas —ni ninguna otra— se rechaza. Antes del arreglo esto daba `conCorrida`.
    expect(rechazadas).toBe(0);
  });
});

describe('la exención NO se extiende fuera del segmento de hash', () => {
  const HASH = hashDe('una card cualquiera');
  const IMEI = '356938035643809';

  it('el escáner sigue prendido en la parte de la key que no generamos', () => {
    // Mismo hash canónico + un IMEI pegado: deja de round-trippear, se escanea la key ENTERA.
    const conCola = `v1/${HASH.slice(0, 2)}/${HASH}-${IMEI}.webp`;
    expect(publicVariantKeyProblem(conCola)).not.toBeNull();
    expect(() => { assertPublicVariantKey(conCola); }).toThrow(UnsafeMediaKeyError);

    const enElShard = `v1/${IMEI}/${HASH}.webp`;
    expect(publicVariantKeyProblem(enElShard)).not.toBeNull();

    const enUnSegmentoExtra = `v1/${HASH.slice(0, 2)}/${IMEI}/${HASH}.webp`;
    expect(publicVariantKeyProblem(enUnSegmentoExtra)).not.toBeNull();
  });

  it('un IMEI en una key que NO es canónica se sigue rechazando por IMEI', () => {
    const problema = publicVariantKeyProblem(`v1/35/${IMEI}.webp`);
    expect(problema).toContain('15 dígitos');
  });

  it('el shard tiene que derivarse del hash: no es un segmento libre', () => {
    // `v1/ff/{hash}.webp` matchea el regex de forma, pero no es lo que escribe publicVariantKey.
    const shardMentiroso = `v1/ff/${HASH}.webp`;
    expect(isPublicVariantKey(shardMentiroso)).toBe(true);
    expect(publicVariantKeyProblem(shardMentiroso)).not.toBeNull();
  });

  it('un hash con mayúsculas no es canónico (y por lo tanto se escanea entero)', () => {
    const gritado = `v1/${HASH.slice(0, 2)}/${HASH.toUpperCase()}.webp`;
    expect(publicVariantKeyProblem(gritado)).not.toBeNull();
  });
});

describe('content-addressing: el arreglo no tocó una sola key', () => {
  it('la key de unos bytes es la misma de siempre (hash truncado a 32 hex)', () => {
    const data = bytes('el mismo iPhone 14 sobre el mismo escritorio');
    const esperada = createHash('sha256').update(data).digest('hex').slice(0, 32);
    expect(contentHash(data)).toBe(esperada);
    expect(publicVariantKey(data)).toBe(`v1/${esperada.slice(0, 2)}/${esperada}.webp`);
  });

  it('publicVariantKey sigue sin depender de nada más que los bytes', () => {
    expect(publicVariantKey.length).toBe(1);
    const foto = bytes('foto compartida por dos tenants');
    expect(publicVariantKey(foto)).toBe(publicVariantKey(foto));
  });

  it('el segmento de hash mide 32 y es hex minúscula: es lo que ancla la exención', () => {
    const hash = contentHash(bytes('cualquier cosa'));
    expect(hash).toHaveLength(32);
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('publicVariantKeyProblem: la forma total del gate', () => {
  it('devuelve null para una key servible y el motivo para una rota', () => {
    expect(publicVariantKeyProblem(publicVariantKey(bytes('ok')))).toBeNull();
    expect(publicVariantKeyProblem('')).toBe('key vacía');
    expect(publicVariantKeyProblem(null)).toBe('key vacía');
    expect(publicVariantKeyProblem(42)).toBe('key vacía');
  });

  it('no tira nunca, ni con basura', () => {
    for (const basura of [undefined, {}, [], 'a'.repeat(10_000), '../../etc/passwd']) {
      expect(() => publicVariantKeyProblem(basura)).not.toThrow();
    }
  });

  it('assertPublicVariantKey tira exactamente cuando el motivo no es null', () => {
    const master = masterObjectKey({
      tenantId: TENANT_A,
      listingId: LISTING,
      masterBytes: bytes('master'),
    });
    expect(isMasterObjectKey(master)).toBe(true);
    expect(publicVariantKeyProblem(master)).not.toBeNull();
    expect(() => { assertPublicVariantKey(master); }).toThrow(UnsafeMediaKeyError);
  });
});
