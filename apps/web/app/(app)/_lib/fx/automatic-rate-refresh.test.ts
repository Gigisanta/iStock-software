import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  withServiceDb: vi.fn(),
  invalidateStorefront: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('../db/session', () => ({ withServiceDb: mocks.withServiceDb }));
vi.mock('../tenants/storefront-cache', () => ({ invalidateStorefront: mocks.invalidateStorefront }));

const { refreshAutomaticFxSettings, resetAutomaticFxQuoteCache } = await import('./automatic-rate');

type RateRow = {
  readonly tenantId: string;
  readonly slug: string;
};

function transactionFor(rows: readonly RateRow[]) {
  const selectWhere = vi.fn(async () => rows);
  const innerJoin = vi.fn(() => ({ where: selectWhere }));
  const from = vi.fn(() => ({ innerJoin }));
  const select = vi.fn(() => ({ from }));
  const updateReturning = vi.fn(async () => [] as readonly RateRow[]);
  const updateWhere = vi.fn(() => ({ returning: updateReturning }));
  const set = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set }));

  return { select, from, innerJoin, selectWhere, update, set, updateWhere, updateReturning };
}

function bcraResponse(rate: number): Response {
  return new Response(
    JSON.stringify({
      status: 200,
      results: {
        fecha: '2026-09-04',
        detalle: [{ codigoMoneda: 'USD', tipoCotizacion: rate }],
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('refreshAutomaticFxSettings', () => {
  beforeEach(() => {
    resetAutomaticFxQuoteCache();
    mocks.withServiceDb.mockReset();
    mocks.invalidateStorefront.mockReset();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(bcraResponse(1508.5)));
  });

  afterEach(() => {
    resetAutomaticFxQuoteCache();
    vi.unstubAllGlobals();
  });

  it('actualiza e invalida sólo los tenants que cambiaron de cotización', async () => {
    const tx = transactionFor([{ tenantId: 'tenant-b', slug: 'negocio-b' }]);
    tx.updateReturning.mockResolvedValue([{ tenantId: 'tenant-b', slug: 'negocio-b' }]);
    mocks.withServiceDb.mockImplementation(async (callback: (value: unknown) => Promise<unknown>) =>
      callback(tx),
    );

    await expect(refreshAutomaticFxSettings()).resolves.toMatchObject({
      arsCentsPerUsd: 150_850,
      updatedTenants: 1,
    });

    expect(tx.selectWhere).toHaveBeenCalledTimes(1);
    expect(tx.update).toHaveBeenCalledTimes(1);
    expect(tx.updateWhere).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateStorefront).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateStorefront).toHaveBeenCalledWith('negocio-b');
  });

  it('no escribe ni purga cache cuando el BCRA devuelve la misma cotización', async () => {
    const tx = transactionFor([]);
    mocks.withServiceDb.mockImplementation(async (callback: (value: unknown) => Promise<unknown>) =>
      callback(tx),
    );

    await expect(refreshAutomaticFxSettings()).resolves.toMatchObject({
      arsCentsPerUsd: 150_850,
      updatedTenants: 0,
    });

    expect(tx.selectWhere).toHaveBeenCalledTimes(1);
    expect(tx.update).not.toHaveBeenCalled();
    expect(mocks.invalidateStorefront).not.toHaveBeenCalled();
  });

  it('no vuelve a invalidar si otra corrida ganó la actualización en paralelo', async () => {
    const tx = transactionFor([{ tenantId: 'tenant-b', slug: 'negocio-b' }]);
    mocks.withServiceDb.mockImplementation(async (callback: (value: unknown) => Promise<unknown>) =>
      callback(tx),
    );

    await expect(refreshAutomaticFxSettings()).resolves.toMatchObject({ updatedTenants: 0 });

    expect(tx.update).toHaveBeenCalledTimes(1);
    expect(tx.updateReturning).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateStorefront).not.toHaveBeenCalled();
  });
});
