/**
 * GATE S11 · el seller no recibe costo, margen ni datos sensibles en la lista de stock.
 *
 * Se prueba el valor que devuelve la lectura server-side y su serialización, no el HTML: un
 * campo que no se renderiza igual puede quedar expuesto en el RSC payload. La superficie de
 * listado también sirve lotes, por eso el fixture incluye una fila con qty > 1.
 */
import { userInfo } from 'node:os';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { TenantContext } from '../db/session';
import type { SellerUnitRow } from './queries';

const URL_DB =
  process.env.DATABASE_URL ??
  `postgresql://${userInfo().username}@localhost:5432/${process.env.ISTOCK_DB ?? 'istock_dev'}`;
process.env.DATABASE_URL = URL_DB;

vi.mock('server-only', () => ({}));

const { listUnits } = await import('./queries');
const { db } = await import('../db/connection');

const TENANT_ID = crypto.randomUUID();
const OWNER_ID = crypto.randomUUID();
const SELLER_ID = crypto.randomUUID();
const SUFFIX = TENANT_ID.slice(0, 8);

const ctxOwner: TenantContext & { readonly role: 'owner' } = {
  userId: OWNER_ID,
  tenantId: TENANT_ID,
  role: 'owner',
};
const ctxSeller: TenantContext & { readonly role: 'seller' } = {
  userId: SELLER_ID,
  tenantId: TENANT_ID,
  role: 'seller',
};

const admin = postgres(URL_DB, { max: 1, prepare: false, onnotice: () => {} });

const UNIT_ID = crypto.randomUUID();
const LOT_ID = crypto.randomUUID();
const UNIT_COST = '711.11';
const LOT_COST = '222.22';
const UNIT_MARGIN = '288.89';
const LOT_MARGIN = '111.11';
const UNIT_IMEI = '351234567890123';
const INTERNAL_NOTE = `S11-INTERNAL-${SUFFIX}`;
const SUPPLIER = `S11-SUPPLIER-${SUFFIX}`;

beforeAll(async () => {
  await admin`insert into auth.users (id, email) values
    (${OWNER_ID}, ${`owner-s11-${SUFFIX}@test.local`}),
    (${SELLER_ID}, ${`seller-s11-${SUFFIX}@test.local`})`;
  await admin`
    insert into tenants (id, slug, name, wa_phone)
    values (${TENANT_ID}, ${`s11-${SUFFIX}`}, 'Fixture de S11', '2995550000')
  `;
  await admin`
    insert into memberships (tenant_id, user_id, role) values
      (${TENANT_ID}, ${OWNER_ID}, 'owner'), (${TENANT_ID}, ${SELLER_ID}, 'seller')
  `;
  await admin`
    insert into listings
      (id, tenant_id, slug, kind, title, condition, price_usd, cost_usd, supplier,
       internal_notes, imei, qty, status)
    values
      (${UNIT_ID}, ${TENANT_ID}, ${`s11-unit-${SUFFIX}`}, 'unit', 'Unidad S11', 'used_excellent',
       1000.00, ${UNIT_COST}, ${SUPPLIER}, ${INTERNAL_NOTE}, ${UNIT_IMEI}, 1, 'draft'),
      (${LOT_ID}, ${TENANT_ID}, ${`s11-lot-${SUFFIX}`}, 'lot', 'Lote S11', 'sealed',
       333.33, ${LOT_COST}, ${SUPPLIER}, ${INTERNAL_NOTE}, null, 3, 'draft')
  `;
  await db().$client.unsafe('select 1');
}, 30_000);

afterAll(async () => {
  await admin`delete from tenants where id = ${TENANT_ID}`;
  await admin`delete from auth.users where id in (${OWNER_ID}, ${SELLER_ID})`;
  await admin.end({ timeout: 5 });
  await db().$client.end({ timeout: 5 });
});

describe('S11 · lista de stock del seller', () => {
  it('el tipo seller no declara una propiedad de costo', () => {
    const sellerShape = null as unknown as SellerUnitRow;
    // @ts-expect-error El costo no forma parte del payload ni del tipo del seller.
    void sellerShape.costUsdCents;
  });

  it('no serializa costo, margen ni sensibles, incluso para un lote qty > 1', async () => {
    const rows = await listUnits(ctxSeller);

    expect(rows).toHaveLength(2);
    const lot = rows.find((row) => row.id === LOT_ID);
    expect(lot?.kind).toBe('lot');
    expect(lot?.qty).toBe(3);

    const payload = JSON.stringify(rows);
    expect(payload).not.toContain(UNIT_COST);
    expect(payload).not.toContain(LOT_COST);
    expect(payload).not.toContain(UNIT_MARGIN);
    expect(payload).not.toContain(LOT_MARGIN);
    expect(payload).not.toContain(UNIT_IMEI);
    expect(payload).not.toContain(INTERNAL_NOTE);
    expect(payload).not.toContain(SUPPLIER);
    expect(payload).not.toMatch(/cost_usd|costUsd|margin_usd|marginUsd|internalNotes|masterKey/iu);

    for (const row of rows) {
      expect('costUsdCents' in row).toBe(false);
      expect(Object.keys(row)).not.toContain('costUsdCents');
    }
  }, 30_000);

  it('mantiene el costo sólo en la rama owner, sin compartir la forma del seller', async () => {
    const [ownerRow] = await listUnits(ctxOwner);
    if (ownerRow === undefined) throw new Error('se esperaba una fila para owner');

    expect(ownerRow.costUsdCents).toBe(71111);
    expect(JSON.stringify(ownerRow)).toContain('costUsdCents');
  }, 30_000);
});
