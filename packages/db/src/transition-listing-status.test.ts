import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claimsFor, openAdmin, openSession, type Session } from './test-session';

const TENANT_A = '00000000-0000-4019-9000-000000000001';
const TENANT_B = '00000000-0000-4019-9000-000000000002';
const USER_A = '00000000-0000-4019-9000-000000000011';
const USER_B = '00000000-0000-4019-9000-000000000012';
const LISTING_A = '00000000-0000-4019-9000-000000000101';
const PHOTO_A = '00000000-0000-4019-9000-000000000102';

const admin = openAdmin();
let sessionA: Session;
let sessionB: Session;

beforeAll(async () => {
  await admin.unsafe(`delete from tenants where id in ('${TENANT_A}', '${TENANT_B}')`);
  await admin.unsafe(`
    insert into auth.users (id, email) values
      ('${USER_A}', 'transition-a@hardening.local'),
      ('${USER_B}', 'transition-b@hardening.local')
    on conflict (id) do nothing`);
  await admin.unsafe(`
    insert into tenants (id, slug, name, wa_phone) values
      ('${TENANT_A}', 'transition-a', 'Transition A', '5492990000011'),
      ('${TENANT_B}', 'transition-b', 'Transition B', '5492990000012')`);
  await admin.unsafe(`
    insert into users (id, email) values
      ('${USER_A}', 'transition-a@hardening.local'),
      ('${USER_B}', 'transition-b@hardening.local')
    on conflict (id) do nothing`);
  await admin.unsafe(`
    insert into memberships (tenant_id, user_id, role, accepted_at) values
      ('${TENANT_A}', '${USER_A}', 'owner', now()),
      ('${TENANT_B}', '${USER_B}', 'owner', now())`);
  await admin.unsafe(`
    insert into listings (id, tenant_id, slug, title, condition, price_usd, status)
    values ('${LISTING_A}', '${TENANT_A}', 'transition-unit', 'Transition unit', 'used_excellent', 800.00, 'draft')`);
  await admin.unsafe(`
    insert into listing_photos (id, tenant_id, listing_id, sort_order, master_key, thumb_key, card_key, detail_key)
    values ('${PHOTO_A}', '${TENANT_A}', '${LISTING_A}', 0, 'master', 'thumb', 'card', 'detail')`);

  sessionA = openSession(claimsFor(USER_A, TENANT_A));
  sessionB = openSession(claimsFor(USER_B, TENANT_B));
});

afterAll(async () => {
  await sessionA?.close();
  await sessionB?.close();
  await admin.unsafe(`delete from tenants where id in ('${TENANT_A}', '${TENANT_B}')`);
  await admin.unsafe(`delete from users where id in ('${USER_A}', '${USER_B}')`);
  await admin.unsafe(`delete from auth.users where id in ('${USER_A}', '${USER_B}')`);
  await admin.end({ timeout: 5 });
});

describe('transition_listing_status · RPC acotado', () => {
  it('aplica una arista legal con tenant, membresía vigente y estado esperado', async () => {
    const result = await sessionA.query<{ changed: number }>(
      `select public.transition_listing_status('${TENANT_A}', '${LISTING_A}', 'draft', 'available') as changed`,
    );
    expect(result).toEqual([{ changed: 1 }]);
    expect(await sessionA.query(`select status from listings where id = '${LISTING_A}'`)).toEqual([{ status: 'available' }]);
  });

  it('es optimista: estado esperado viejo, arista ilegal y tenant cruzado no cambian nada', async () => {
    expect(await sessionA.query(
      `select public.transition_listing_status('${TENANT_A}', '${LISTING_A}', 'draft', 'reserved') as changed`,
    )).toEqual([{ changed: 0 }]);
    expect(await sessionB.query(
      `select public.transition_listing_status('${TENANT_A}', '${LISTING_A}', 'available', 'reserved') as changed`,
    )).toEqual([{ changed: 0 }]);
  });

  it('falla cerrado cuando se revoca la membresía aunque el JWT siga vivo', async () => {
    await admin.unsafe(`delete from memberships where tenant_id = '${TENANT_A}' and user_id = '${USER_A}'`);
    expect(await sessionA.query(
      `select public.transition_listing_status('${TENANT_A}', '${LISTING_A}', 'available', 'reserved') as changed`,
    )).toEqual([{ changed: 0 }]);
  });
});
