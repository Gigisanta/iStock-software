import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `transitionUnit` con Postgres de mentira.
 *
 * Dos cosas y sólo dos: que la decisión la tome `@istock/domain` (no una tabla de aristas
 * reescrita acá) y que **la invalidación lleve el id de la unidad** (S3.2). Todo lo demás —qué
 * aristas son legales, qué efectos tiene cada una— ya tiene test en `packages/domain` y repetirlo
 * acá sería tener dos máquinas de estados otra vez.
 */

vi.mock('server-only', () => ({}));

const loadUnitForTransition = vi.fn();
vi.mock('./queries', () => ({
  loadUnitForTransition: (...args: unknown[]) => loadUnitForTransition(...args) as unknown,
}));

const invalidateStorefrontUnit = vi.fn();
const invalidateListing = vi.fn();
const invalidateStorefront = vi.fn();
vi.mock('../tenants/storefront-cache', () => ({
  invalidateStorefront: (slug: string) => {
    invalidateStorefront(slug);
  },
  invalidateStorefrontUnit: (slug: string, listingId: string) => {
    invalidateStorefrontUnit(slug, listingId);
  },
  invalidateListing: (slug: string, listingId: string) => {
    invalidateListing(slug, listingId);
  },
}));

const logEvent = vi.fn();
vi.mock('../log', () => ({
  logEvent: (event: string, fields: unknown) => {
    logEvent(event, fields);
  },
  logError: vi.fn(),
}));

const db = {
  /** Filas afectadas por el `update ... where status = <from>`. 0 = otro dispositivo ganó. */
  updated: 1,
  events: [] as Record<string, unknown>[],
};

function thenable<T>(produce: () => T): PromiseLike<T> & Record<string, unknown> {
  const builder = {
    set: () => builder,
    where: () => builder,
    returning: () => builder,
    values: () => builder,
    then: (resolve: (value: T) => unknown) => Promise.resolve(produce()).then(resolve),
  };
  return builder as unknown as PromiseLike<T> & Record<string, unknown>;
}

const tx = {
  update: () => thenable(() => (db.updated > 0 ? [{ id: LISTING_ID }] : [])),
  insert: () => ({
    values: (row: Record<string, unknown>) =>
      thenable(() => {
        db.events.push(row);
        return [];
      }),
  }),
};

vi.mock('../db/session', () => ({
  withTenantDb: (_ctx: unknown, fn: (t: unknown) => unknown) => fn(tx),
}));

const { transitionUnit } = await import('./publish-listing');

const LISTING_ID = '3f2b1a90-7c4d-4e21-9b8a-0c1d2e3f4a5b';
const ctx = { userId: 'user-1', tenantId: 'tenant-1', role: 'owner' } as const;

function givenUnit(status: string, photoCount = 3): void {
  loadUnitForTransition.mockResolvedValue({
    id: LISTING_ID,
    slug: 'iphone-14-pro',
    status,
    kind: 'unit',
    condition: 'used_excellent',
    priceUsdCents: 62_000,
    qty: 1,
    catalogModelId: '00000000-0000-4000-8000-000000000001',
    photoCount,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.updated = 1;
  db.events = [];
});

describe('transitionUnit · publicar', () => {
  it('publica una unidad completa', async () => {
    givenUnit('draft');

    await expect(transitionUnit(ctx, 'lacoope', LISTING_ID, 'available')).resolves.toEqual({
      ok: true,
      status: 'available',
    });
  });

  /**
   * **La aserción de S3.2 en este archivo.** Publicar mueve la grilla y la ficha, así que la
   * invalidación tiene que llevar el `listingId`: es lo único con lo que se puede armar
   * `listing:{uuid}`. Si alguien vuelve a `invalidateStorefront(tenantSlug)` —la firma vieja, sin
   * id— esto se cae con `expected "spy" to be called with arguments: [ 'lacoope', '3f2b…' ]`.
   */
  it('invalida CON el id de la unidad, no sólo con el slug del tenant', async () => {
    givenUnit('draft');

    await transitionUnit(ctx, 'lacoope', LISTING_ID, 'available');

    expect(invalidateStorefrontUnit).toHaveBeenCalledWith('lacoope', LISTING_ID);
    expect(invalidateStorefront).not.toHaveBeenCalled();
  });

  it('despublicar también saca la unidad de la vidriera y de su ficha', async () => {
    givenUnit('available');

    await transitionUnit(ctx, 'lacoope', LISTING_ID, 'draft');

    expect(invalidateStorefrontUnit).toHaveBeenCalledWith('lacoope', LISTING_ID);
  });

  it('el slug es el de la sesión: nunca se purga la vidriera de otro', async () => {
    givenUnit('draft');

    await transitionUnit(ctx, 'lacoope', LISTING_ID, 'available');

    expect(invalidateStorefrontUnit.mock.calls).toEqual([['lacoope', LISTING_ID]]);
  });
});

describe('transitionUnit · lo que NO invalida', () => {
  it('una unidad sin fotos no se publica y no toca el cache', async () => {
    givenUnit('draft', 0);

    const result = await transitionUnit(ctx, 'lacoope', LISTING_ID, 'available');

    expect(result.ok).toBe(false);
    expect(invalidateStorefrontUnit).not.toHaveBeenCalled();
    expect(invalidateListing).not.toHaveBeenCalled();
  });

  it('una unidad que no existe no toca el cache', async () => {
    loadUnitForTransition.mockResolvedValue(null);

    const result = await transitionUnit(ctx, 'lacoope', LISTING_ID, 'available');

    expect(result).toEqual({ ok: false, message: 'No encontramos ese equipo.' });
    expect(invalidateStorefrontUnit).not.toHaveBeenCalled();
  });

  /** El guard de concurrencia: otro dispositivo ya movió la unidad, así que no hubo cambio. */
  it('si el update afectó 0 filas no se invalida nada', async () => {
    givenUnit('draft');
    db.updated = 0;

    const result = await transitionUnit(ctx, 'lacoope', LISTING_ID, 'available');

    expect(result.ok).toBe(false);
    expect(invalidateStorefrontUnit).not.toHaveBeenCalled();
    expect(db.events).toEqual([]);
  });
});
