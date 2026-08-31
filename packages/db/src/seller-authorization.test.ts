/**
 * P0 de autorización: seller no administra memberships/tenants, no recibe billing/entitlements
 * y no puede escribir costo/notas. Corre contra Postgres real con sesiones distintas.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claimsFor, openAdmin, openSession, type Session } from './test-session';

const TENANT_A = '00000000-0000-4000-9007-000000000001';
const TENANT_B = '00000000-0000-4000-9007-000000000002';
const OWNER_A = '00000000-0000-4000-9007-000000000011';
const SELLER_A = '00000000-0000-4000-9007-000000000012';
const OWNER_B = '00000000-0000-4007-9007-000000000013';
const LISTING_A = '00000000-0000-4000-9007-000000000021';
const LEAD_A = '00000000-0000-4000-9007-000000000022';
const SALE_A = '00000000-0000-4000-9007-000000000023';

const admin = openAdmin();
let ownerA: Session;
let sellerA: Session;

beforeAll(async () => {
  await admin.unsafe(`delete from sales where tenant_id in ('${TENANT_A}', '${TENANT_B}')`);
  await admin.unsafe(`delete from tenants where id in ('${TENANT_A}', '${TENANT_B}')`);
  await admin.unsafe(`
    insert into auth.users (id, email) values
      ('${OWNER_A}', 'owner-a@authorization.local'),
      ('${SELLER_A}', 'seller-a@authorization.local'),
      ('${OWNER_B}', 'owner-b@authorization.local')
    on conflict (id) do nothing`);
  await admin.unsafe(`
    insert into tenants (id, slug, name, wa_phone) values
      ('${TENANT_A}', 'authorization-a', 'Authorization A', '5492990000071'),
      ('${TENANT_B}', 'authorization-b', 'Authorization B', '5492990000072')`);
  await admin.unsafe(`
    insert into memberships (tenant_id, user_id, role) values
      ('${TENANT_A}', '${OWNER_A}', 'owner'),
      ('${TENANT_A}', '${SELLER_A}', 'seller'),
      ('${TENANT_B}', '${OWNER_B}', 'owner')`);
  await admin.unsafe(`
    insert into listings (id, tenant_id, slug, title, condition, price_usd, cost_usd, supplier, internal_notes)
    values ('${LISTING_A}', '${TENANT_A}', 'authorization-unit', 'iPhone seguro', 'used_excellent', 900.00, 500.00, 'Proveedor privado', 'nota privada')`);
  await admin.unsafe(`
    insert into tradein_leads (id, tenant_id, customer_name, customer_wa_phone, model_text, offer_usd, internal_notes)
    values ('${LEAD_A}', '${TENANT_A}', 'Cliente', '5492995550000', 'iPhone 12', 400.00, 'nota de canje')`);
  await admin.unsafe(`
    insert into sales (id, tenant_id, listing_id, price_usd, cost_usd, internal_notes)
    values ('${SALE_A}', '${TENANT_A}', '${LISTING_A}', 900.00, 500.00, 'venta privada')`);
  await admin.unsafe(`insert into subscriptions (tenant_id, amount_ars) values ('${TENANT_A}', 1000.00)`);
  await admin.unsafe(`insert into entitlements (tenant_id, feature, enabled) values ('${TENANT_A}', 'margin', true)`);
  await admin.unsafe(`insert into fx_settings (tenant_id, ars_per_usd) values ('${TENANT_A}', 1487.50)`);

  ownerA = openSession(claimsFor(OWNER_A, TENANT_A));
  sellerA = openSession(claimsFor(SELLER_A, TENANT_A));
});

afterAll(async () => {
  await ownerA?.close();
  await sellerA?.close();
  await admin.unsafe(`delete from sales where tenant_id in ('${TENANT_A}', '${TENANT_B}')`);
  await admin.unsafe(`delete from tenants where id in ('${TENANT_A}', '${TENANT_B}')`);
  await admin.unsafe(`delete from auth.users where id in ('${OWNER_A}', '${SELLER_A}', '${OWNER_B}')`);
  await admin.end({ timeout: 5 });
});

describe('seller no puede escalar membresías ni borrar/modificar el tenant', () => {
  it('no puede insertar una membership owner', async () => {
    const failure = await sellerA.expectFailure(
      `insert into memberships (tenant_id, user_id, role) values ('${TENANT_A}', '${SELLER_A}', 'owner')`,
    );
    expect(failure.code).toBe('42501');
    expect(failure.message).toContain('row-level security');
  });

  it('no puede promoverse ni borrar memberships', async () => {
    expect(await sellerA.affected(`update memberships set role = 'owner' where tenant_id = '${TENANT_A}' and user_id = '${SELLER_A}'`)).toBe(0);
    expect(await sellerA.affected(`delete from memberships where tenant_id = '${TENANT_A}' and user_id = '${SELLER_A}'`)).toBe(0);
  });

  it('no puede modificar ni borrar el tenant', async () => {
    expect(await sellerA.affected(`update tenants set name = 'escalado' where id = '${TENANT_A}'`)).toBe(0);
    expect(await sellerA.affected(`delete from tenants where id = '${TENANT_A}'`)).toBe(0);
  });
});

describe('seller no puede leer ni mutar billing/entitlements', () => {
  it('no ve subscription, entitlement ni FX del tenant', async () => {
    const subscription = await sellerA.query<{ n: string }>(`select count(*)::text as n from subscriptions where tenant_id = '${TENANT_A}'`);
    const entitlement = await sellerA.query<{ n: string }>(`select count(*)::text as n from entitlements where tenant_id = '${TENANT_A}'`);
    const fx = await sellerA.query<{ n: string }>(`select count(*)::text as n from fx_settings where tenant_id = '${TENANT_A}'`);
    expect(subscription[0]?.n).toBe('0');
    expect(entitlement[0]?.n).toBe('0');
    expect(fx[0]?.n).toBe('0');
  });

  it('no puede insertar un entitlement', async () => {
    const failure = await sellerA.expectFailure(
      `insert into entitlements (tenant_id, feature, enabled) values ('${TENANT_A}', 'billing_hack', true)`,
    );
    expect(failure.code).toBe('42501');
    expect(failure.message).toContain('row-level security');
  });
});

describe('seller no puede leer ventas ni escribir campos financieros', () => {
  it('no ve ventas ni costos/margen de ventas', async () => {
    const rows = await sellerA.query<{ n: string }>(`select count(*)::text as n from sales where tenant_id = '${TENANT_A}'`);
    expect(rows[0]?.n).toBe('0');
  });

  it('no puede intentar una venta con costo/notas forjados', async () => {
    const failure = await sellerA.expectFailure(`
      insert into sales (tenant_id, listing_id, price_usd, cost_usd, internal_notes, sold_by)
      values ('${TENANT_A}', '${LISTING_A}', 900.00, 1.00, 'exfiltrar', '${SELLER_A}')`);
    expect(failure.code).toBe('42501');
    expect(failure.message).toContain('row-level security');
  });

  it('no puede modificar ni borrar una venta', async () => {
    expect(await sellerA.affected(`update sales set price_usd = 1 where id = '${SALE_A}'`)).toBe(0);
    expect(await sellerA.affected(`delete from sales where id = '${SALE_A}'`)).toBe(0);
  });
});

describe('seller no puede escribir campos SENSITIVE de listings/canjes', () => {
  it('el trigger rechaza costo/proveedor/notas del listing', async () => {
    const failure = await sellerA.expectFailure(`update listings set cost_usd = 1, supplier = 'forjado' where id = '${LISTING_A}'`);
    expect(failure.code).toBe('42501');
    expect(failure.message).toContain('seller cannot modify sensitive listing fields');
  });

  it('el trigger rechaza offer_usd/notas internas del canje', async () => {
    const failure = await sellerA.expectFailure(`update tradein_leads set offer_usd = 1, internal_notes = 'forjado' where id = '${LEAD_A}'`);
    expect(failure.code).toBe('42501');
    expect(failure.message).toContain('seller cannot modify sensitive trade-in fields');
  });
});

describe('owner sigue teniendo acceso de operador', () => {
  it('ve sus datos de billing y sus campos financieros', async () => {
    const billing = await ownerA.query<{ n: string }>(`select count(*)::text as n from entitlements where tenant_id = '${TENANT_A}'`);
    const listing = await ownerA.query<{ cost_usd: string }>(`select cost_usd::text from listings where id = '${LISTING_A}'`);
    const sale = await ownerA.query<{ cost_usd: string }>(`select cost_usd::text from sales where id = '${SALE_A}'`);
    expect(billing[0]?.n).toBe('1');
    expect(listing[0]?.cost_usd).toBe('500.00');
    expect(sale[0]?.cost_usd).toBe('500.00');
  });
});
