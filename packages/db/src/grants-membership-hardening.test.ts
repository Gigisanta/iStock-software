/**
 * Regresión P0 de grants y membresía vigente.
 *
 * Las sesiones son conexiones físicas distintas y cada operación replica PostgREST:
 * `set local role authenticated` + `request.jwt.claims` dentro de una transacción. No hay mocks.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claimsFor, openAdmin, openSession, type Session } from './test-session';

const TENANT_A = '00000000-0000-4016-9000-000000000001';
const TENANT_B = '00000000-0000-4016-9000-000000000002';
const OWNER_A = '00000000-0000-4016-9000-000000000011';
const SELLER_A = '00000000-0000-4016-9000-000000000012';
const STALE_A = '00000000-0000-4016-9000-000000000013';
const OWNER_B = '00000000-0000-4016-9000-000000000021';
const LISTING_A = '00000000-0000-4016-9000-000000000101';
const LISTING_B = '00000000-0000-4016-9000-000000000102';
const LEAD_A = '00000000-0000-4016-9000-000000000201';
const OWNER_INSERT = '00000000-0000-4016-9000-000000000301';

const admin = openAdmin();
let ownerA: Session;
let sellerA: Session;
let staleA: Session;
let ownerB: Session;

beforeAll(async () => {
  await admin.unsafe(`delete from sales where tenant_id in ('${TENANT_A}', '${TENANT_B}')`);
  await admin.unsafe(`delete from tenants where id in ('${TENANT_A}', '${TENANT_B}')`);
  await admin.unsafe(`
    insert into auth.users (id, email) values
      ('${OWNER_A}', 'owner-a@hardening.local'),
      ('${SELLER_A}', 'seller-a@hardening.local'),
      ('${STALE_A}', 'stale-a@hardening.local'),
      ('${OWNER_B}', 'owner-b@hardening.local')
    on conflict (id) do nothing`);
  await admin.unsafe(`
    insert into tenants (id, slug, name, wa_phone) values
      ('${TENANT_A}', 'hardening-a', 'Hardening A', '5492990000011'),
      ('${TENANT_B}', 'hardening-b', 'Hardening B', '5492990000022')`);
  await admin.unsafe(`
    insert into users (id, email) values
      ('${OWNER_A}', 'owner-a@hardening.local'),
      ('${SELLER_A}', 'seller-a@hardening.local'),
      ('${STALE_A}', 'stale-a@hardening.local'),
      ('${OWNER_B}', 'owner-b@hardening.local')
    on conflict (id) do nothing`);
  await admin.unsafe(`
    insert into memberships (tenant_id, user_id, role, accepted_at) values
      ('${TENANT_A}', '${OWNER_A}', 'owner', now()),
      ('${TENANT_A}', '${SELLER_A}', 'seller', now()),
      ('${TENANT_A}', '${STALE_A}', 'seller', now()),
      ('${TENANT_B}', '${OWNER_B}', 'owner', now())`);
  await admin.unsafe(`
    insert into listings (
      id, tenant_id, slug, title, condition, price_usd, cost_usd, supplier, internal_notes,
      imei, status, published_at, sold_at
    ) values
      ('${LISTING_A}', '${TENANT_A}', 'hardening-a-unit', 'Unidad A', 'used_excellent', 800.00,
       500.00, 'proveedor A', 'nota A', '356938035643809', 'available', now(), null),
      ('${LISTING_B}', '${TENANT_B}', 'hardening-b-unit', 'Unidad B', 'used_excellent', 800.00,
       500.00, 'proveedor B', 'nota B', '356938035643810', 'available', now(), null)`);
  await admin.unsafe(`
    insert into tradein_leads (
      id, tenant_id, customer_name, customer_wa_phone, model_text, offer_usd, internal_notes
    ) values ('${LEAD_A}', '${TENANT_A}', 'Cliente A', '5492990000000', 'iPhone 12', 400.00, 'nota canje A')`);

  ownerA = openSession(claimsFor(OWNER_A, TENANT_A));
  sellerA = openSession(claimsFor(SELLER_A, TENANT_A));
  // Se abre antes de borrar la membresía para probar que un JWT ya emitido falla cerrado.
  staleA = openSession(claimsFor(STALE_A, TENANT_A));
  ownerB = openSession(claimsFor(OWNER_B, TENANT_B));
});

afterAll(async () => {
  await ownerA?.close();
  await sellerA?.close();
  await staleA?.close();
  await ownerB?.close();
  await admin.unsafe(`delete from sales where tenant_id in ('${TENANT_A}', '${TENANT_B}')`);
  await admin.unsafe(`delete from tenants where id in ('${TENANT_A}', '${TENANT_B}')`);
  await admin.unsafe(`delete from users where id in ('${OWNER_A}', '${SELLER_A}', '${STALE_A}', '${OWNER_B}')`);
  await admin.unsafe(`delete from auth.users where id in ('${OWNER_A}', '${SELLER_A}', '${STALE_A}', '${OWNER_B}')`);
  await admin.end({ timeout: 5 });
});

describe('aislamiento y grants efectivos', () => {
  it('tenant A no ve tenant B con sesiones autenticadas distintas', async () => {
    expect(await ownerA.query(`select id from listings where id = '${LISTING_B}'`)).toEqual([]);
    expect(await ownerB.query(`select id from listings where id = '${LISTING_A}'`)).toEqual([]);
    expect(await ownerA.query(`select distinct tenant_id from listings`)).toEqual([{ tenant_id: TENANT_A }]);
  });

  it('mide la superficie efectiva: tabla UPDATE/DELETE y columnas protegidas quedan en false', async () => {
    const rows = await admin.unsafe(`
      select
        has_table_privilege('authenticated', 'public.listings', 'UPDATE') as listings_update,
        has_table_privilege('authenticated', 'public.listings', 'DELETE') as listings_delete,
        has_table_privilege('authenticated', 'public.tradein_leads', 'DELETE') as tradein_delete,
        has_table_privilege('authenticated', 'public.listings', 'INSERT') as listings_insert,
        has_column_privilege('authenticated', 'public.listings', 'imei', 'UPDATE') as imei_update,
        has_column_privilege('authenticated', 'public.listings', 'status', 'UPDATE') as status_update,
        has_column_privilege('authenticated', 'public.listings', 'published_at', 'UPDATE') as published_update,
        has_column_privilege('authenticated', 'public.listings', 'sold_at', 'UPDATE') as sold_update,
        has_column_privilege('authenticated', 'public.listings', 'cost_usd', 'UPDATE') as cost_update,
        has_column_privilege('authenticated', 'public.listings', 'internal_notes', 'UPDATE') as notes_update,
        has_column_privilege('authenticated', 'public.tradein_leads', 'internal_notes', 'UPDATE') as tradein_notes_update,
        has_column_privilege('authenticated', 'public.listings', 'title', 'UPDATE') as title_update,
        has_column_privilege('authenticated', 'public.tradein_leads', 'offer_usd', 'UPDATE') as offer_update`);
    expect(rows).toEqual([{
      listings_update: false,
      listings_delete: false,
      tradein_delete: false,
      listings_insert: true,
      imei_update: false,
      status_update: false,
      published_update: false,
      sold_update: false,
      cost_update: false,
      notes_update: false,
      tradein_notes_update: false,
      title_update: true,
      offer_update: true,
    }]);
  });
});

describe('seller/member no puede usar PostgREST para mutar campos protegidos', () => {
  it('no puede cambiar IMEI, estado, published_at, sold_at ni notas internas', async () => {
    for (const statement of [
      `update listings set imei = '356938035643810' where id = '${LISTING_A}'`,
      `update listings set status = 'sold' where id = '${LISTING_A}'`,
      `update listings set published_at = now() where id = '${LISTING_A}'`,
      `update listings set sold_at = now() where id = '${LISTING_A}'`,
      `update listings set internal_notes = 'forjado' where id = '${LISTING_A}'`,
    ]) {
      const failure = await sellerA.expectFailure(statement);
      expect(failure.code, statement).toBe('42501');
      expect(failure.message, statement).toContain('permission denied');
    }
  });

  it('no puede borrar listings ni tradein_leads', async () => {
    const listingFailure = await sellerA.expectFailure(`delete from listings where id = '${LISTING_A}'`);
    const leadFailure = await sellerA.expectFailure(`delete from tradein_leads where id = '${LEAD_A}'`);
    expect(listingFailure.code).toBe('42501');
    expect(leadFailure.code).toBe('42501');
    expect(listingFailure.message).toContain('permission denied');
    expect(leadFailure.message).toContain('permission denied');
  });

  it('conserva una mutación ordinaria legítima del seller', async () => {
    expect(await sellerA.affected(`update listings set title = 'Título corregido' where id = '${LISTING_A}'`)).toBe(1);
  });
});

describe('owner y mutaciones permitidas', () => {
  it('owner puede crear un listing con sus campos de costo/IMEI y editar el título', async () => {
    const inserted = await ownerA.query<{ id: string }>(`insert into listings (
      id, tenant_id, slug, title, condition, price_usd, cost_usd, internal_notes, imei, status
    ) values (
      '${OWNER_INSERT}', '${TENANT_A}', 'hardening-owner-insert', 'Owner insert',
      'used_excellent', 900.00, 600.00, 'nota owner', '356938035643811', 'draft'
    ) returning id`);
    expect(inserted).toEqual([{ id: OWNER_INSERT }]);
    expect(await ownerA.affected(`update listings set title = 'Owner edit' where id = '${OWNER_INSERT}'`)).toBe(1);
  });

  it('owner conserva la mutación legítima del offer del flujo de aceptación', async () => {
    expect(await ownerA.affected(`update tradein_leads set offer_usd = 410.00, handled_by = '${OWNER_A}' where id = '${LEAD_A}'`)).toBe(1);
  });
});

describe('revocación inmediata con JWT viejo', () => {
  it('tras borrar membership, la sesión stale no puede select/update/delete', async () => {
    await admin.unsafe(`delete from memberships where tenant_id = '${TENANT_A}' and user_id = '${STALE_A}'`);

    expect(await staleA.query(`select id from listings where id = '${LISTING_A}'`)).toEqual([]);
    expect(await staleA.affected(`update listings set title = 'stale write' where id = '${LISTING_A}'`)).toBe(0);

    const failure = await staleA.expectFailure(`delete from listings where id = '${LISTING_A}'`);
    expect(failure.code).toBe('42501');
    expect(failure.message).toContain('permission denied');
  });
});
