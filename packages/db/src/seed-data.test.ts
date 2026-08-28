/**
 * Las keys del seed tienen que tener **la forma real** de ADR-006, no una parecida.
 *
 * ## Por qué existe este archivo
 * `seedMasterKey` emitía `originals/{2hex}/{32hex}.jpg`. La forma del master es
 * `originals/{tenant_id}/{listing_id}/{32hex}.webp`. Ni los segmentos ni la extensión. Como el
 * seed no sube un byte a R2 y nadie leía todavía `master_key`, el bug estaba **latente y verde**:
 * la primera víctima iba a ser un job de GC o de inventario filtrando por esa forma, que habría
 * ignorado en silencio todas las filas del demo.
 *
 * ## Por qué los regex están copiados a mano y NO importados de `@istock/media`
 * Es deliberado y es el punto del test. Si importara `isMasterObjectKey`, el día que `packages/media`
 * afloje o cambie su contrato, este test se adaptaría solo y seguiría verde mientras el seed
 * produce basura distinta. Copiado a mano, un cambio de contrato allá pone **rojo** acá y obliga a
 * que un humano mire las dos puntas. Es la misma razón por la que los techos de bytes viven
 * duplicados en el test de `media`: un contrato entre dos paquetes se verifica desde los dos lados
 * o no se verifica.
 *
 * Si este test se pone rojo: NO lo relajes. Andá a `packages/media/src/keys.ts`, mirá qué cambió
 * y decidí a mano si el seed tiene que seguirlo.
 */

import { describe, expect, it } from 'vitest';
import {
  SEED_LISTINGS,
  SEED_TENANT_ID,
  seedMasterKey,
  seedMediaKey,
} from './seed-data';

// ── Contrato COPIADO A MANO de packages/media/src/keys.ts (no importar de allá) ────────────────

/** `originals/{uuid}/{uuid}/{32 hex}.webp`. Bucket privado, nunca en una URL. */
const MASTER_KEY_RE = /^originals\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f]{32}\.webp$/;
/** `v1/{2 hex}/{32 hex}.webp` y nada más. */
const PUBLIC_KEY_RE = /^v1\/[0-9a-f]{2}\/[0-9a-f]{32}\.webp$/;
/** Un UUID en cualquier parte de la key pública es un `tenant_id`/`listing_id` filtrado. */
const UUID_ANYWHERE_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** 15 dígitos seguidos: posible IMEI. Nunca en una key (CLAUDE.md §1.8). */
const IMEI_RE = /\d{15}/;

/** El seed inserta exactamente 3 fotos por ficha (mínimo del gate de publicación). */
const PHOTOS_PER_LISTING = 3;

const PUBLIC_VARIANTS = ['thumb', 'card', 'detail'] as const;

interface SeedPhotoKeys {
  readonly listingSlug: string;
  readonly listingId: string;
  readonly index: number;
  readonly masterKey: string;
  readonly publicKeys: readonly string[];
}

/**
 * Reproduce **lo que `seed.ts` inserta de verdad** en `listing_photos`, con los mismos argumentos.
 * Si el call site del seed cambia de forma, este helper deja de representarlo y hay que tocarlo:
 * eso es intencional, es el acoplamiento que hace que el test valga algo.
 */
function seedPhotoKeys(): SeedPhotoKeys[] {
  const out: SeedPhotoKeys[] = [];
  for (const item of SEED_LISTINGS) {
    for (let i = 0; i < PHOTOS_PER_LISTING; i += 1) {
      out.push({
        listingSlug: item.slug,
        listingId: item.id,
        index: i,
        masterKey: seedMasterKey({
          tenantId: SEED_TENANT_ID,
          listingId: item.id,
          listingSlug: item.slug,
          index: i,
        }),
        publicKeys: PUBLIC_VARIANTS.map((v) => seedMediaKey(item.slug, i, v)),
      });
    }
  }
  return out;
}

describe('seedMasterKey: la key del master del seed matchea el contrato de ADR-006', () => {
  const photos = seedPhotoKeys();

  it('el set de fotos del seed no está vacío (si no, todo lo de abajo pasa por vacío)', () => {
    expect(SEED_LISTINGS.length).toBe(10);
    expect(photos.length).toBe(SEED_LISTINGS.length * PHOTOS_PER_LISTING);
  });

  it('TODA master key matchea originals/{uuid}/{uuid}/{32hex}.webp', () => {
    const malformadas = photos
      .filter((p) => !MASTER_KEY_RE.test(p.masterKey))
      .map((p) => `${p.listingSlug}#${String(p.index)} → ${p.masterKey}`);
    expect(
      malformadas,
      'hay master keys que packages/media rechazaría (isMasterObjectKey === false):\n' +
        malformadas.join('\n'),
    ).toEqual([]);
  });

  it('termina en .webp, nunca en .jpg (el pipeline sólo escribe WebP)', () => {
    for (const p of photos) {
      expect(p.masterKey.endsWith('.webp')).toBe(true);
      expect(p.masterKey.endsWith('.jpg')).toBe(false);
    }
  });

  it('el primer segmento es el tenant y el segundo el listing, en ese orden (no invertidos)', () => {
    // Una key con tenant y listing cruzados matchea el regex igual. Sólo esto lo agarra.
    for (const p of photos) {
      const parts = p.masterKey.split('/');
      expect(parts[0]).toBe('originals');
      expect(parts[1]).toBe(SEED_TENANT_ID);
      expect(parts[2]).toBe(p.listingId);
    }
  });

  it('cada foto tiene su propia key: cero colisiones entre fichas ni entre índices', () => {
    const keys = photos.map((p) => p.masterKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('es determinista: mismos argumentos → misma key (el seed no puede tirar dados)', () => {
    const args = {
      tenantId: SEED_TENANT_ID,
      listingId: SEED_LISTINGS[0]?.id ?? '',
      listingSlug: SEED_LISTINGS[0]?.slug ?? '',
      index: 0,
    };
    expect(seedMasterKey(args)).toBe(seedMasterKey(args));
    expect(seedMasterKey(args)).not.toBe(seedMasterKey({ ...args, index: 1 }));
  });

  it('rechaza un tenantId o un listingId que no sea UUID en vez de emitir una key inválida', () => {
    const base = {
      tenantId: SEED_TENANT_ID,
      listingId: SEED_LISTINGS[0]?.id ?? '',
      listingSlug: 'x',
      index: 0,
    };
    expect(() => seedMasterKey({ ...base, tenantId: 'demo' })).toThrow();
    expect(() => seedMasterKey({ ...base, listingId: 'listing-1' })).toThrow();
    // 36 chars de hex-y-guiones que NO son un UUID: pasarían `[0-9a-f-]{36}` del regex de media.
    expect(() => seedMasterKey({ ...base, listingId: '-'.repeat(36) })).toThrow();
  });
});

describe('seedMediaKey: la key pública sigue siendo opaca', () => {
  const photos = seedPhotoKeys();

  it('TODA key pública matchea v1/{2hex}/{32hex}.webp', () => {
    for (const p of photos) {
      for (const key of p.publicKeys) {
        expect(PUBLIC_KEY_RE.test(key), `key pública inválida: ${key}`).toBe(true);
      }
    }
  });

  it('ninguna key pública contiene un UUID ni algo con forma de IMEI', () => {
    for (const p of photos) {
      for (const key of p.publicKeys) {
        expect(UUID_ANYWHERE_RE.test(key), `filtra un UUID: ${key}`).toBe(false);
        expect(IMEI_RE.test(key), `filtra 15 dígitos seguidos: ${key}`).toBe(false);
      }
    }
  });

  it('desde una variante pública no se deriva otra ni el master (hashes independientes)', () => {
    for (const p of photos) {
      const hashes = p.publicKeys.map((k) => k.split('/')[2]);
      expect(new Set(hashes).size, `dos variantes comparten hash en ${p.listingSlug}`).toBe(
        p.publicKeys.length,
      );
      const masterHash = p.masterKey.split('/')[3];
      expect(hashes).not.toContain(masterHash);
    }
  });

  it('ninguna key pública lleva sufijo de variante (`-card`, `-master`, etc.)', () => {
    for (const p of photos) {
      for (const key of p.publicKeys) {
        expect(key).not.toMatch(/thumb|card|detail|master|original/i);
      }
    }
  });
});

describe('composición del seed demo (gate de aceptación, no decorativo)', () => {
  it('8 iPhones + 2 accesorios', () => {
    const units = SEED_LISTINGS.filter((l) => l.kind === 'unit');
    const lots = SEED_LISTINGS.filter((l) => l.kind === 'lot');
    expect(units.length).toBe(8);
    expect(lots.length).toBe(2);
  });

  it('exactamente uno en `reserved`', () => {
    expect(SEED_LISTINGS.filter((l) => l.status === 'reserved').length).toBe(1);
  });

  it('los accesorios (`lot`) no tienen IMEI', () => {
    for (const l of SEED_LISTINGS.filter((x) => x.kind === 'lot')) {
      expect(l.imei).toBeNull();
    }
  });
});
