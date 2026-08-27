/**
 * El test que tiene que ponerse rojo si alguien "arregla" el borrado llamando a DeleteObject.
 *
 * Escenario central: dos tenants suben la MISMA foto. La key es content-addressed ⇒ es la MISMA
 * key ⇒ el MISMO objeto. Si el borrado del listing del tenant A borrara el objeto, el tenant B
 * se queda con la vidriera rota. Eso es un incidente de multi-tenancy, no una optimización.
 */

import { describe, expect, it } from 'vitest';
import { collectOrphanObjects, unlinkListingPhotos } from './unlink';
import type { ListingPhotoMappingStore } from './unlink';
import { ForbiddenObjectDeleteError, MediaConfigError } from './errors';
import { publicVariantKey, masterObjectKey } from './keys';
import type { ListingPhotoRow } from './types';
import type { MediaBucket, StorageDriver } from './storage';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const LISTING_A = '33333333-3333-4333-8333-333333333333';
const LISTING_B = '44444444-4444-4444-8444-444444444444';

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

/** Los tres bytes de variante son los mismos para las dos filas: es LA MISMA foto. */
const SHARED = {
  thumbKey: publicVariantKey(bytes('thumb compartido')),
  cardKey: publicVariantKey(bytes('card compartida')),
  detailKey: publicVariantKey(bytes('detail compartido')),
};

function row(tenantId: string, listingId: string, id: string): ListingPhotoRow {
  return {
    id,
    tenantId,
    listingId,
    ...SHARED,
    masterKey: masterObjectKey({ tenantId, listingId, masterBytes: bytes('master compartido') }),
  };
}

class FakeStore implements ListingPhotoMappingStore {
  rows: ListingPhotoRow[];

  constructor(rows: ListingPhotoRow[]) {
    this.rows = rows;
  }

  async listByListing(tenantId: string, listingId: string): Promise<readonly ListingPhotoRow[]> {
    // Filtro de tenant explícito ADEMÁS de RLS (CLAUDE.md §5).
    return this.rows.filter((r) => r.tenantId === tenantId && r.listingId === listingId);
  }

  async deleteByListing(tenantId: string, listingId: string): Promise<number> {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !(r.tenantId === tenantId && r.listingId === listingId));
    return before - this.rows.length;
  }

  countAcrossAllTenants(key: string): number {
    return this.rows.filter(
      (r) => r.thumbKey === key || r.cardKey === key || r.detailKey === key || r.masterKey === key,
    ).length;
  }
}

class SpyDriver implements StorageDriver {
  readonly name = 'spy';
  readonly deletes: { bucket: MediaBucket; key: string }[] = [];
  async put(): Promise<void> {}
  async head(): Promise<null> {
    return null;
  }
  async get(): Promise<null> {
    return null;
  }
  async delete(bucket: MediaBucket, key: string): Promise<void> {
    this.deletes.push({ bucket, key });
  }
}

describe('unlinkListingPhotos', () => {
  it('borra el mapeo y devuelve las keys liberadas', async () => {
    const store = new FakeStore([row(TENANT_A, LISTING_A, 'a1'), row(TENANT_A, LISTING_A, 'a2')]);
    const result = await unlinkListingPhotos(
      { tenantId: TENANT_A, listingId: LISTING_A },
      { store },
    );
    expect(result.unlinkedRows).toBe(2);
    expect(store.rows).toHaveLength(0);
    expect(result.releasedKeys).toContain(SHARED.cardKey);
  });

  it('NO borra ningún objeto de R2', async () => {
    const store = new FakeStore([row(TENANT_A, LISTING_A, 'a1')]);
    const result = await unlinkListingPhotos(
      { tenantId: TENANT_A, listingId: LISTING_A },
      { store },
    );
    expect(result.deletedObjects).toBe(0);
  });

  it('no toca las filas de otro tenant ni de otro listing', async () => {
    const store = new FakeStore([
      row(TENANT_A, LISTING_A, 'a1'),
      row(TENANT_B, LISTING_B, 'b1'),
      row(TENANT_A, LISTING_B, 'a3'),
    ]);
    await unlinkListingPhotos({ tenantId: TENANT_A, listingId: LISTING_A }, { store });
    expect(store.rows.map((r) => r.id).sort()).toEqual(['a3', 'b1']);
  });

  it('exige UUIDs (Zod en el borde)', async () => {
    const store = new FakeStore([]);
    await expect(
      unlinkListingPhotos({ tenantId: 'gigi', listingId: LISTING_A }, { store }),
    ).rejects.toBeInstanceOf(MediaConfigError);
  });

  it('un listing sin fotos no rompe nada', async () => {
    const store = new FakeStore([]);
    const result = await unlinkListingPhotos(
      { tenantId: TENANT_A, listingId: LISTING_A },
      { store },
    );
    expect(result.unlinkedRows).toBe(0);
    expect(result.releasedKeys).toHaveLength(0);
  });
});

describe('dos tenants, la misma foto, el mismo objeto', () => {
  it('borrar el listing de A NO deja sin fotos a B', async () => {
    const store = new FakeStore([row(TENANT_A, LISTING_A, 'a1'), row(TENANT_B, LISTING_B, 'b1')]);
    const driver = new SpyDriver();

    const unlinked = await unlinkListingPhotos(
      { tenantId: TENANT_A, listingId: LISTING_A },
      { store },
    );

    // 1. El unlink no tocó R2.
    expect(driver.deletes).toHaveLength(0);
    expect(unlinked.deletedObjects).toBe(0);

    // 2. El GC tampoco borra: el tenant B todavía referencia la key.
    const gc = await collectOrphanObjects(
      { candidateKeys: unlinked.releasedKeys },
      {
        driver,
        countReferencesAcrossAllTenants: async (key) => store.countAcrossAllTenants(key),
      },
    );

    expect(gc.deleted).not.toContain(SHARED.cardKey);
    expect(gc.kept).toContain(SHARED.cardKey);
    expect(driver.deletes.map((d) => d.key)).not.toContain(SHARED.cardKey);

    // 3. La fila de B sigue viva y sigue apuntando al mismo objeto.
    expect(store.rows.map((r) => r.id)).toEqual(['b1']);
    expect(store.rows[0]?.cardKey).toBe(SHARED.cardKey);
  });

  it('cuando el ÚLTIMO tenant lo suelta, ahí sí se recolecta', async () => {
    const store = new FakeStore([row(TENANT_A, LISTING_A, 'a1')]);
    const driver = new SpyDriver();
    const unlinked = await unlinkListingPhotos(
      { tenantId: TENANT_A, listingId: LISTING_A },
      { store },
    );
    const gc = await collectOrphanObjects(
      { candidateKeys: unlinked.releasedKeys },
      { driver, countReferencesAcrossAllTenants: async (k) => store.countAcrossAllTenants(k) },
    );
    expect(gc.deleted).toContain(SHARED.cardKey);
    expect(gc.kept).toHaveLength(0);
    // El master va al bucket privado, las variantes al público.
    const buckets = Object.fromEntries(driver.deletes.map((d) => [d.key, d.bucket]));
    expect(buckets[SHARED.cardKey]).toBe('media');
    expect(buckets[store.rows[0]?.masterKey ?? 'x']).toBeUndefined();
    expect(driver.deletes.some((d) => d.bucket === 'originals')).toBe(true);
  });
});

describe('collectOrphanObjects', () => {
  it('dryRun no borra nada', async () => {
    const driver = new SpyDriver();
    const gc = await collectOrphanObjects(
      { candidateKeys: [SHARED.cardKey], dryRun: true },
      { driver, countReferencesAcrossAllTenants: async () => 0 },
    );
    expect(driver.deletes).toHaveLength(0);
    expect(gc.deleted).toHaveLength(0);
    expect(gc.kept).toEqual([SHARED.cardKey]);
  });

  it('rechaza una key que no es nuestra (no se borra a ciegas)', async () => {
    const driver = new SpyDriver();
    await expect(
      collectOrphanObjects(
        { candidateKeys: ['../../etc/passwd'] },
        { driver, countReferencesAcrossAllTenants: async () => 0 },
      ),
    ).rejects.toBeInstanceOf(ForbiddenObjectDeleteError);
    expect(driver.deletes).toHaveLength(0);
  });

  it('rechaza un conteo de referencias inválido', async () => {
    const driver = new SpyDriver();
    await expect(
      collectOrphanObjects(
        { candidateKeys: [SHARED.cardKey] },
        { driver, countReferencesAcrossAllTenants: async () => Number.NaN },
      ),
    ).rejects.toBeInstanceOf(ForbiddenObjectDeleteError);
    expect(driver.deletes).toHaveLength(0);
  });
});

describe('superficie pública del paquete', () => {
  it('no exporta ningún borrado de objeto por key', async () => {
    const api = (await import('./index')) as Record<string, unknown>;
    const nombresDeBorrado = Object.keys(api).filter((k) => /^delete/i.test(k));
    expect(nombresDeBorrado).toEqual([]);
    expect(api['deleteListingPhotos']).toBeUndefined();
    expect(typeof api['unlinkListingPhotos']).toBe('function');
    expect(typeof api['uploadListingPhoto']).toBe('function');
    expect(typeof api['variantUrl']).toBe('function');
  });
});
