import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tx } from '../db/connection';
import type { TenantContext } from '../db/session';

vi.mock('server-only', () => ({}));

const execute = vi.fn();
const tx = { execute } as unknown as Tx;
const ctx: TenantContext = {
  userId: '00000000-0000-4000-8000-000000000001',
  tenantId: '00000000-0000-4000-8000-000000000002',
  role: 'owner',
};
const LISTING_ID = '00000000-0000-4000-8000-000000000003';

const { transitionListingStatus } = await import('./transition-listing-status');

beforeEach(() => {
  vi.clearAllMocks();
  execute.mockResolvedValue([{ changed: 1 }]);
});

describe('transitionListingStatus · RPC del panel', () => {
  it('devuelve true sólo cuando el RPC confirma una fila cambiada', async () => {
    await expect(
      transitionListingStatus(tx, ctx, LISTING_ID, 'draft', 'available'),
    ).resolves.toBe(true);

    execute.mockResolvedValue([{ changed: 0 }]);
    await expect(
      transitionListingStatus(tx, ctx, LISTING_ID, 'draft', 'available'),
    ).resolves.toBe(false);
  });

  it('ejecuta transition_listing_status con los cuatro argumentos del tenant y la arista', async () => {
    await transitionListingStatus(tx, ctx, LISTING_ID, 'reserved', 'available');

    expect(execute).toHaveBeenCalledTimes(1);
    const query = execute.mock.calls[0]?.[0] as {
      queryChunks?: readonly unknown[];
    };
    const chunks = query.queryChunks ?? [];

    expect(JSON.stringify(chunks)).toContain('select public.transition_listing_status');
    expect(chunks.filter((chunk) => typeof chunk === 'string')).toEqual([
      ctx.tenantId,
      LISTING_ID,
      'reserved',
      'available',
    ]);
  });

  it('propaga el error del RPC para que la transacción haga rollback', async () => {
    const error = new Error('rpc failed');
    execute.mockRejectedValue(error);

    await expect(
      transitionListingStatus(tx, ctx, LISTING_ID, 'available', 'reserved'),
    ).rejects.toBe(error);
  });
});
