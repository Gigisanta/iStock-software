/**
 * 0020 · Postgres no permite estados comerciales huérfanos, incluso si alguien saltea el panel.
 *
 * Las pruebas usan sesiones `authenticated` reales. El admin sólo monta y desmonta fixtures.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claimsFor, openAdmin, openSession, type Session } from './test-session';

const TENANT = '00000000-0000-4020-9000-000000000001';
const USER = '00000000-0000-4020-9000-000000000002';
const LISTING = '00000000-0000-4020-9000-000000000003';
const LISTING_NO_PHOTOS = '00000000-0000-4020-9000-000000000004';
const PHOTO = '00000000-0000-4020-9000-000000000005';

const admin = openAdmin();
let panel: Session;

beforeAll(async () => {
  await admin.unsafe(`delete from tenants where id = '${TENANT}'`);
  await admin.unsafe(`
    insert into auth.users (id, email) values ('${USER}', 'effects-0020@hardening.local')
    on conflict (id) do nothing`);
  await admin.unsafe(`
    insert into tenants (id, slug, name, wa_phone) values
      ('${TENANT}', 'effects-0020', 'Effects 0020', '5492990000099')`);
  await admin.unsafe(`
    insert into memberships (tenant_id, user_id, role, accepted_at)
    values ('${TENANT}', '${USER}', 'owner', now())`);
  await admin.unsafe(`
    insert into listings (id, tenant_id, slug, title, condition, price_usd, status)
    values ('${LISTING}', '${TENANT}', 'effects-unit', 'Effects unit', 'used_excellent', 600, 'available')`);
  await admin.unsafe(`
    insert into listing_photos (id, tenant_id, listing_id, sort_order, master_key, thumb_key, card_key, detail_key)
    values ('${PHOTO}', '${TENANT}', '${LISTING}', 0, 'master', 'thumb', 'card', 'detail')`);
  panel = openSession(claimsFor(USER, TENANT));
});

afterAll(async () => {
  await panel?.close();
  await admin.unsafe(`delete from tenants where id = '${TENANT}'`);
  await admin.unsafe(`delete from users where id = '${USER}'`);
  await admin.unsafe(`delete from auth.users where id = '${USER}'`);
  await admin.end({ timeout: 5 });
});

describe('listing effect integrity · migration 0020', () => {
  it('no permite sold sin una venta aunque se invoque el RPC directamente', async () => {
    const failure = await panel.expectFailure(
      `select public.transition_listing_status('${TENANT}', '${LISTING}', 'available', 'sold')`,
    );
    expect(failure.code).toBe('23514');
    expect(failure.message).toContain('sold listing requires a sale');
  });

  it('no permite reserved sin una reserva activa aunque se invoque el RPC directamente', async () => {
    const failure = await panel.expectFailure(
      `select public.transition_listing_status('${TENANT}', '${LISTING}', 'available', 'reserved')`,
    );
    expect(failure.code).toBe('23514');
    expect(failure.message).toContain('reserved listing requires an active reservation');
  });

  it('no permite una reserva activa sobre una unidad que sigue available', async () => {
    const failure = await panel.expectFailure(`
      insert into reservations (tenant_id, listing_id, status, minutes, expires_at)
      values ('${TENANT}', '${LISTING}', 'active', 60, now() + interval '60 minutes')`);
    expect(failure.code).toBe('23514');
    expect(failure.message).toContain('active reservation requires a reserved listing');
  });

  it('no permite una venta sobre una unidad que no está sold', async () => {
    const failure = await panel.expectFailure(`
      insert into sales (tenant_id, listing_id, price_usd)
      values ('${TENANT}', '${LISTING}', 600)`);
    expect(failure.code).toBe('23514');
    expect(failure.message).toContain('sale requires a sold listing');
  });

  it('no permite insertar stock publicable sin fotos', async () => {
    const failure = await panel.expectFailure(`
      insert into listings (id, tenant_id, slug, title, condition, price_usd, status)
      values ('${LISTING_NO_PHOTOS}', '${TENANT}', 'effects-no-photos', 'No photos', 'used_excellent', 600, 'available')`);
    expect(failure.code).toBe('23514');
    expect(failure.message).toContain('public listing requires at least one photo');
  });
});
