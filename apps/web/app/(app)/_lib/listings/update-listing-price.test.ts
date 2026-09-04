import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const invalidateStorefrontUnit = vi.fn();
vi.mock('../tenants/storefront-cache', () => ({
  invalidateStorefrontUnit: (slug: string, listingId: string) => {
    invalidateStorefrontUnit(slug, listingId);
  },
}));

const logError = vi.fn();
vi.mock('../log', () => ({
  logError: (event: string, code: string, fields: unknown) => logError(event, code, fields),
}));

const db = {
  current: {
    id: 'listing-1',
    status: 'available' as const,
    priceUsd: 62_000,
  } as {
    id: string;
    slug: string;
    status: 'draft' | 'available' | 'reserved' | 'sold';
    priceUsd: number;
  } | null,
  update: null as Record<string, unknown> | null,
  event: null as Record<string, unknown> | null,
  fail: false,
  calls: [] as string[],
};

function thenable<T>(produce: () => T): PromiseLike<T> & Record<string, () => unknown> {
  const builder = {
    from: () => builder,
    where: () => builder,
    for: () => builder,
    limit: () => builder,
    set: () => builder,
    returning: () => builder,
    then: (resolve: (value: T) => unknown) => Promise.resolve(produce()).then(resolve),
  };
  return builder as unknown as PromiseLike<T> & Record<string, () => unknown>;
}

const tx = {
  select() {
    db.calls.push('lock');
    return thenable(() => {
      if (db.fail) throw new Error('db down');
      return db.current === null ? [] : [db.current];
    });
  },
  update() {
    const chain = {
      set(row: Record<string, unknown>) {
        db.calls.push('update');
        db.update = row;
        return chain;
      },
      where: () => chain,
      returning: () =>
        thenable(() => {
          if (db.current === null) return [];
          return [{ id: db.current.id, status: db.current.status }];
        }),
    };
    return chain;
  },
  insert() {
    return {
      values(row: Record<string, unknown>) {
        db.calls.push('event');
        db.event = row;
        return thenable(() => []);
      },
    };
  },
};

vi.mock('../db/session', () => ({
  withTenantDb: (_ctx: unknown, fn: (transaction: unknown) => unknown) => fn(tx),
}));

const { updateListingPrice } = await import('./update-listing-price');

const ctx = { userId: 'user-1', tenantId: 'tenant-1', role: 'owner' } as const;

beforeEach(() => {
  vi.clearAllMocks();
  db.current = {
    id: 'listing-1',
    slug: 'iphone-14-pro',
    status: 'available',
    priceUsd: 62_000,
  };
  db.update = null;
  db.event = null;
  db.fail = false;
  db.calls = [];
});

describe('updateListingPrice', () => {
  it('actualiza, audita e invalida sólo después de una edición pública', async () => {
    const result = await updateListingPrice(ctx, 'nortecel', 'listing-1', 62_500);

    expect(result).toEqual({
      ok: true,
      changed: true,
      listingId: 'listing-1',
      status: 'available',
    });
    expect(db.calls).toEqual(['lock', 'update', 'event']);
    expect(db.update?.priceUsd).toBe(62_500);
    expect(db.event).toMatchObject({
      tenantId: 'tenant-1',
      listingId: 'listing-1',
      kind: 'price_change',
      actorUserId: 'user-1',
    });
    expect(invalidateStorefrontUnit).toHaveBeenCalledWith('nortecel', 'listing-1');
  });

  it('no purga un borrador y no escribe una auditoría si el precio ya era el mismo', async () => {
    if (db.current === null) throw new Error('fixture inválido');
    db.current.status = 'draft';
    await expect(updateListingPrice(ctx, 'nortecel', 'listing-1', 62_500)).resolves.toMatchObject({ changed: true });
    expect(invalidateStorefrontUnit).not.toHaveBeenCalled();

    db.current.priceUsd = 62_500;
    db.calls = [];
    db.event = null;
    await expect(updateListingPrice(ctx, 'nortecel', 'listing-1', 62_500)).resolves.toMatchObject({ changed: false });
    expect(db.calls).toEqual(['lock']);
    expect(db.event).toBeNull();
  });

  it('no permite editar una unidad vendida ni tocar la base', async () => {
    if (db.current === null) throw new Error('fixture inválido');
    db.current.status = 'sold';

    await expect(updateListingPrice(ctx, 'nortecel', 'listing-1', 62_500)).resolves.toEqual({
      ok: false,
      reason: 'sold',
      message: 'Ese equipo ya está vendido y no se puede editar.',
    });
    expect(db.calls).toEqual(['lock']);
    expect(db.update).toBeNull();
    expect(invalidateStorefrontUnit).not.toHaveBeenCalled();
  });

  it('devuelve un mensaje de mostrador cuando la base falla y deja código seguro en el log', async () => {
    db.fail = true;

    await expect(updateListingPrice(ctx, 'nortecel', 'listing-1', 62_500)).resolves.toEqual({
      ok: false,
      reason: 'failed',
      message: 'No pudimos guardar el precio. Probá de nuevo en unos segundos.',
    });
    expect(logError).toHaveBeenCalledWith('listing.price_update_failed', 'Error', {
      tenantId: 'tenant-1',
      listingId: 'listing-1',
    });
    expect(invalidateStorefrontUnit).not.toHaveBeenCalled();
  });
});
