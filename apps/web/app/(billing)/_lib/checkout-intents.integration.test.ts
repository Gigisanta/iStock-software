import { randomUUID } from 'node:crypto';
import { userInfo } from 'node:os';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const database =
  process.env.DATABASE_URL ??
  `postgresql://${userInfo().username}@localhost:5432/${process.env.ISTOCK_DB ?? 'istock_dev'}`;
process.env.DATABASE_URL = database;

vi.mock('server-only', () => ({}));

const { claimSubscriptionCheckout, completeSubscriptionCheckout, failSubscriptionCheckout } =
  await import('./checkout-intents');
const { db } = await import('../../(app)/_lib/db/connection');

const TENANT_ID = randomUUID();
const USER_ID = randomUUID();
const SLUG = `checkout-${TENANT_ID.slice(0, 8)}`;
const NOW = new Date('2026-09-04T12:00:00.000Z');
const context = { userId: USER_ID, tenantId: TENANT_ID, role: 'owner' as const };
const admin = postgres(database, { max: 1, prepare: false, onnotice: () => {} });

beforeAll(async () => {
  await admin`insert into auth.users (id, email) values (${USER_ID}, ${`${USER_ID}@checkout.local`})`;
  await admin`insert into users (id, email) values (${USER_ID}, ${`${USER_ID}@checkout.local`})`;
  await admin`insert into tenants (id, slug, name, wa_phone) values (${TENANT_ID}, ${SLUG}, 'Checkout test', '5492990000098')`;
  await admin`insert into memberships (tenant_id, user_id, role) values (${TENANT_ID}, ${USER_ID}, 'owner')`;
  await db().$client.unsafe('select 1');
});

afterAll(async () => {
  await admin`delete from tenants where id = ${TENANT_ID}`;
  await admin`delete from users where id = ${USER_ID}`;
  await admin`delete from auth.users where id = ${USER_ID}`;
  await admin.end({ timeout: 5 });
  await db().$client.end({ timeout: 5 });
});

describe('checkout intent contra Postgres real', () => {
  it('serializa el alta, reintenta un fallo y reutiliza el init point listo', async () => {
    const claimed = await claimSubscriptionCheckout(context, {
      plan: 'base',
      amountArsCents: 2_900_000,
      now: NOW,
    });
    expect(claimed.kind).toBe('claimed');
    if (claimed.kind !== 'claimed') return;

    const blocked = await claimSubscriptionCheckout(context, {
      plan: 'base',
      amountArsCents: 2_900_000,
      now: NOW,
    });
    expect(blocked).toEqual({ kind: 'in_progress', plan: 'base' });

    await failSubscriptionCheckout(context, { intentId: claimed.intentId, now: NOW });
    const retry = await claimSubscriptionCheckout(context, {
      plan: 'base',
      amountArsCents: 2_900_000,
      now: NOW,
    });
    expect(retry).toEqual({ kind: 'claimed', intentId: claimed.intentId });

    expect(
      await completeSubscriptionCheckout(context, {
        intentId: claimed.intentId,
        providerPreapprovalId: 'pre-real-guard-1',
        initPoint: 'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_id=pre-real-guard-1',
        now: NOW,
      }),
    ).toBe(true);

    expect(
      await claimSubscriptionCheckout(context, {
        plan: 'base',
        amountArsCents: 2_900_000,
        now: NOW,
      }),
    ).toEqual({
      kind: 'ready',
      plan: 'base',
      initPoint: 'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_id=pre-real-guard-1',
    });
  });

  it('no permite abrir otro plan mientras el checkout actual sigue listo', async () => {
    expect(
      await claimSubscriptionCheckout(context, {
        plan: 'negocio',
        amountArsCents: 5_300_000,
        now: NOW,
      }),
    ).toEqual({ kind: 'conflict', plan: 'base' });
  });
});
