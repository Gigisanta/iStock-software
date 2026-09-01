/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  EL TEST QUE DECIDE SI EL SCHEMA SE MERGEA: **tenant A no lee tenant B**.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Postgres real, dos sesiones, dos claims distintos. Cero mocks (skill `drizzle-rls` §5).
 *
 * ADR-001: *"RLS es el único límite de seguridad real → sin RLS no hay merge, y todo test de
 * tenant corre contra Postgres real."* Con un solo proyecto Supabase para los 100 tenants, esto
 * no es un test de feature: es el test de que el producto se puede vender.
 *
 * Las 4 aserciones se corren sobre **las 16 tablas tenant-scoped con `tenant_id`**, no sobre una de
 * muestra. Una tabla con la policy de `select` puesta y la de `delete` olvidada se ve idéntica a
 * una tabla bien hecha hasta el día que alguien borra el stock de otro.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claimsFor, openAdmin, openSession, type Session } from './test-session';

const TENANT_A = '00000000-0000-4000-9000-0000000000a1';
const TENANT_B = '00000000-0000-4000-9000-0000000000b1';
const USER_A = '00000000-0000-4000-9000-0000000000a2';
const USER_B = '00000000-0000-4000-9000-0000000000b2';

/** Ids de las filas fixture. `<tabla>` → uuid, por tenant. */
type Fixture = Record<string, string>;

const admin = openAdmin();
const fixtures: Record<string, Fixture> = {};
let sessionA: Session;
let sessionB: Session;

function ids(tenant: 'a' | 'b') {
  const p = tenant === 'a' ? 'a' : 'b';
  const n = (i: number) => `00000000-0000-4000-9000-0000000${p}${String(i).padStart(4, '0')}`;
  return {
    membership: n(1), location: n(2), fx: n(3), listing: n(4), photo: n(5), event: n(6),
    waClick: n(7), reservation: n(8), sale: n(9), lead: n(10), checklist: n(11),
    thread: n(12), message: n(13), subscription: n(14), entitlement: n(15), webhookEvent: n(16),
  };
}

/**
 * INSERT mínimo de cada tabla, con el `tenant_id` como parámetro. Se usa dos veces:
 * para montar el fixture (como admin) y para **intentar escribir en el tenant ajeno** desde la
 * sesión equivocada, que es la aserción que más gente se olvida.
 */
function insertsFor(tenantId: string, tenant: 'a' | 'b', userId: string, suffix = ''): Record<string, string> {
  const i = ids(tenant);
  const u = (base: string) => (suffix === '' ? base : base.replace(/.{4}$/, suffix));
  return {
    memberships: `insert into memberships (id, tenant_id, user_id, role) values ('${u(i.membership)}', '${tenantId}', '${userId}', 'owner')`,
    locations: `insert into locations (id, tenant_id, name, address, hours) values ('${u(i.location)}', '${tenantId}', 'Local ${tenant}', 'Calle 1', '10 a 18')`,
    fx_settings: `insert into fx_settings (id, tenant_id, ars_per_usd) values ('${u(i.fx)}', '${tenantId}', 1487.50)`,
    listings: `insert into listings (id, tenant_id, slug, title, condition, price_usd, status) values ('${u(i.listing)}', '${tenantId}', 'equipo-${tenant}${suffix}', 'iPhone de ${tenant}', 'used_excellent', 600.00, 'available')`,
    listing_photos: `insert into listing_photos (id, tenant_id, listing_id, master_key, thumb_key, card_key, detail_key) values ('${u(i.photo)}', '${tenantId}', '${i.listing}', 'm', 't', 'c', 'd')`,
    listing_events: `insert into listing_events (id, tenant_id, listing_id, kind) values ('${u(i.event)}', '${tenantId}', '${i.listing}', 'created')`,
    wa_click_events: `insert into wa_click_events (id, tenant_id, listing_id, source) values ('${u(i.waClick)}', '${tenantId}', '${i.listing}', 'storefront_card')`,
    reservations: `insert into reservations (id, tenant_id, listing_id, expires_at) values ('${u(i.reservation)}', '${tenantId}', '${i.listing}', now() + interval '60 minutes')`,
    sales: `insert into sales (id, tenant_id, listing_id, price_usd) values ('${u(i.sale)}', '${tenantId}', '${i.listing}', 600.00)`,
    tradein_leads: `insert into tradein_leads (id, tenant_id, customer_name, customer_wa_phone, model_text) values ('${u(i.lead)}', '${tenantId}', 'Cliente ${tenant}', '5492990000000', 'iPhone 12')`,
    tradein_checklists: `insert into tradein_checklists (id, tenant_id, tradein_lead_id, item_key, item_label) values ('${u(i.checklist)}', '${tenantId}', '${i.lead}', 'icloud${suffix}', 'Libre de iCloud')`,
    chatbot_threads: `insert into chatbot_threads (id, tenant_id, listing_id) values ('${u(i.thread)}', '${tenantId}', '${i.listing}')`,
    chatbot_messages: `insert into chatbot_messages (id, tenant_id, thread_id, role, content) values ('${u(i.message)}', '${tenantId}', '${i.thread}', 'user', 'hola')`,
    subscriptions: `insert into subscriptions (id, tenant_id) values ('${u(i.subscription)}', '${tenantId}')`,
    entitlements: `insert into entitlements (id, tenant_id, feature) values ('${u(i.entitlement)}', '${tenantId}', 'chatbot${suffix}')`,
    billing_webhook_events: `insert into billing_webhook_events (id, tenant_id, provider_event_id, topic) values ('${u(i.webhookEvent)}', '${tenantId}', 'rls-${tenant}-${u(i.webhookEvent)}', 'subscription')`,
  };
}

const TENANT_TABLES = Object.keys(insertsFor(TENANT_A, 'a', USER_A));

beforeAll(async () => {
  await admin.unsafe(`delete from sales where tenant_id in ('${TENANT_A}', '${TENANT_B}')`);
  await admin.unsafe(`delete from tenants where id in ('${TENANT_A}', '${TENANT_B}')`);
  await admin.unsafe(`
    insert into auth.users (id, email) values
      ('${USER_A}', 'a@rlstest.local'), ('${USER_B}', 'b@rlstest.local')
    on conflict (id) do nothing`);
  await admin.unsafe(`
    insert into tenants (id, slug, name, wa_phone) values
      ('${TENANT_A}', 'rlstest-a', 'Tenant A', '5492990000001'),
      ('${TENANT_B}', 'rlstest-b', 'Tenant B', '5492990000002')`);
  await admin.unsafe(`
    insert into users (id, email) values ('${USER_A}', 'a@rlstest.local'), ('${USER_B}', 'b@rlstest.local')
    on conflict (id) do nothing`);

  for (const [tenantId, tenant, userId] of [
    [TENANT_A, 'a', USER_A],
    [TENANT_B, 'b', USER_B],
  ] as const) {
    const statements = insertsFor(tenantId, tenant, userId);
    for (const table of TENANT_TABLES) {
      await admin.unsafe(statements[table] as string);
    }
    fixtures[tenant] = ids(tenant) as unknown as Fixture;
  }

  sessionA = openSession(claimsFor(USER_A, TENANT_A));
  sessionB = openSession(claimsFor(USER_B, TENANT_B));
});

afterAll(async () => {
  await sessionA?.close();
  await sessionB?.close();
  await admin.unsafe(`delete from sales where tenant_id in ('${TENANT_A}', '${TENANT_B}')`);
  await admin.unsafe(`delete from tenants where id in ('${TENANT_A}', '${TENANT_B}')`);
  await admin.unsafe(`delete from users where id in ('${USER_A}', '${USER_B}')`);
  await admin.unsafe(`delete from auth.users where id in ('${USER_A}', '${USER_B}')`);
  await admin.end({ timeout: 5 });
});

describe('RLS cruzado — las 4 aserciones de la skill, tabla por tabla', () => {
  const rowIdsA = ids('a') as unknown as Record<string, string>;
  const keyByTable: Record<string, string> = {
    memberships: 'membership', locations: 'location', fx_settings: 'fx', listings: 'listing',
    listing_photos: 'photo', listing_events: 'event', wa_click_events: 'waClick',
    reservations: 'reservation', sales: 'sale', tradein_leads: 'lead',
    tradein_checklists: 'checklist', chatbot_threads: 'thread', chatbot_messages: 'message',
    subscriptions: 'subscription', entitlements: 'entitlement', billing_webhook_events: 'webhookEvent',
  };

  it('cubre las 16 tablas tenant-scoped con tenant_id', () => {
    expect(TENANT_TABLES).toHaveLength(16);
  });

  for (const table of TENANT_TABLES) {
    describe(table, () => {
      const rowA = rowIdsA[keyByTable[table] as string] as string;

      it('el dueño SÍ ve su propia fila (si no, el test de aislamiento sería trivialmente verde)', async () => {
        const rows = await sessionA.query<{ n: string }>(`select count(*)::text as n from ${table} where id = '${rowA}'`);
        expect(rows[0]?.n).toBe('1');
      });

      it('tenant B NO ve la fila de tenant A', async () => {
        const rows = await sessionB.query<{ n: string }>(`select count(*)::text as n from ${table} where id = '${rowA}'`);
        expect(rows[0]?.n).toBe('0');
      });

      it('tenant B NO puede INSERTAR una fila con el tenant_id de A (WITH CHECK)', async () => {
        const attempt = insertsFor(TENANT_A, 'a', USER_A, 'ffff')[table] as string;
        const code = await sessionB.expectError(attempt);
        // 42501 = insufficient_privilege: "new row violates row-level security policy".
        expect(code).toBe('42501');
      });

      it('tenant B NO puede ACTUALIZAR la fila de A (0 filas afectadas, sin error)', async () => {
        if (table === 'billing_webhook_events') {
          const failure = await sessionB.expectFailure(`update ${table} set topic = topic where id = '${rowA}'`);
          expect(failure.code).toBe('42501');
          expect(failure.message).toContain('permission denied');
          return;
        }
        const affected = await sessionB.affected(`update ${table} set tenant_id = tenant_id where id = '${rowA}'`);
        expect(affected).toBe(0);
      });

      it('tenant B NO puede BORRAR la fila de A (0 filas afectadas, sin error)', async () => {
        if (table === 'billing_webhook_events') {
          const failure = await sessionB.expectFailure(`delete from ${table} where id = '${rowA}'`);
          expect(failure.code).toBe('42501');
          expect(failure.message).toContain('permission denied');
          return;
        }
        const affected = await sessionB.affected(`delete from ${table} where id = '${rowA}'`);
        expect(affected).toBe(0);
      });
    });
  }
});

describe('RLS cruzado — casos que no son "una fila más"', () => {
  it('tenant B no ve el tenant A ni siquiera listando la tabla tenants', async () => {
    const rows = await sessionB.query<{ slug: string }>(`select slug from tenants order by slug`);
    expect(rows.map((r) => r.slug)).toEqual(['rlstest-b']);
  });

  it('un select sin WHERE (el error clásico) tampoco filtra: sólo devuelve lo propio', async () => {
    const rows = await sessionB.query<{ tenant_id: string }>(`select distinct tenant_id from listings`);
    expect(rows.map((r) => r.tenant_id)).toEqual([TENANT_B]);
  });

  it('el costo de A no se puede consultar ni con una agregación (columna SENSITIVE)', async () => {
    // La defensa de privilegios es más fuerte que confiar en el filtro de filas: la sentencia no
    // compila para authenticated, así que tampoco puede convertirse en un promedio o un count.
    const failure = await sessionB.expectFailure(`select sum(cost_usd) from listings`);
    expect(failure.code).toBe('42501');
    expect(failure.message).toContain('permission denied');
  });

  it('B no puede mover una fila propia al tenant de A (UPDATE ... SET tenant_id)', async () => {
    const rowB = (ids('b') as unknown as Record<string, string>)['listing'] as string;
    const code = await sessionB.expectError(`update listings set tenant_id = '${TENANT_A}' where id = '${rowB}'`);
    expect(code).toBe('42501');
  });

  it('un claim sin tenant_id no ve absolutamente nada (el claim vacío no es comodín)', async () => {
    const orphan = openSession({ sub: USER_B, role: 'authenticated', app_metadata: { tenant_id: '' } });
    try {
      // `''::uuid` tira error de sintaxis en Postgres: el claim vacío rompe la query, no la abre.
      // Lo que importa es que NO devuelva filas de nadie.
      await orphan.query(`select count(*) from listings`).then(
        (rows) => { expect(rows[0]?.['count']).toBe('0'); },
        (error: unknown) => { expect((error as { code?: string }).code).toBe('22P02'); },
      );
    } finally {
      await orphan.close();
    }
  });

  it('un `anon` con claim de PANEL (tenant_id) no ve nada: la vidriera se acota por slug, no por tenant_id', async () => {
    // Desde 0002 la vidriera anónima SÍ es un cliente de Postgres, pero su claim es
    // `app_metadata.storefront_slug` y no `tenant_id`. Este caso es el de alguien que llega con
    // el claim equivocado (o que lo forja): las policies `TO anon` no lo miran y devuelven cero.
    // El aislamiento por slug está probado a fondo en `src/rls-anon-storefront.test.ts`.
    const visitor = openSession(claimsFor(USER_B, TENANT_B), 'anon');
    try {
      expect(await visitor.query(`select id from listings limit 1`)).toEqual([]);
      expect(await visitor.query(`select id from tenants limit 1`)).toEqual([]);
      // Y las columnas sensibles no dependen de ninguna policy: no están en el GRANT.
      expect(await visitor.expectError(`select imei from listings limit 1`)).toBe('42501');
      expect(await visitor.expectError(`select cost_usd from listings limit 1`)).toBe('42501');
      expect(await visitor.expectError(`select * from listings limit 1`)).toBe('42501');
      // Las tablas que no son read model público siguen sin existir para `anon`.
      expect(await visitor.expectError(`select 1 from sales limit 1`)).toBe('42501');
      expect(await visitor.expectError(`select 1 from tradein_leads limit 1`)).toBe('42501');
    } finally {
      await visitor.close();
    }
  });
});

describe('catálogo GLOBAL — la excepción, acotada', () => {
  it('cualquier tenant LEE el catálogo global (para eso es global)', async () => {
    const rows = await sessionB.query<{ n: string }>(`select count(*)::text as n from catalog_models`);
    expect(Number(rows[0]?.n)).toBeGreaterThan(0);
  });

  it('pero NADIE lo escribe desde la app: el GRANT es sólo SELECT', async () => {
    const code = await sessionB.expectError(
      `insert into catalog_models (slug, display_name) values ('hackeado', 'Modelo Trucho')`,
    );
    expect(code).toBe('42501');
  });

  it('tampoco lo borra ni lo actualiza', async () => {
    expect(await sessionB.expectError(`update catalog_models set display_name = 'x'`)).toBe('42501');
    expect(await sessionB.expectError(`delete from catalog_models`)).toBe('42501');
  });
});

describe('users — aislada por auth.uid() + membresía, no por tenant_id', () => {
  it('B se ve a sí mismo', async () => {
    const rows = await sessionB.query<{ n: string }>(`select count(*)::text as n from users where id = '${USER_B}'`);
    expect(rows[0]?.n).toBe('1');
  });

  it('B NO ve al usuario de A', async () => {
    const rows = await sessionB.query<{ n: string }>(`select count(*)::text as n from users where id = '${USER_A}'`);
    expect(rows[0]?.n).toBe('0');
  });

  it('B no puede editar el perfil de A', async () => {
    const affected = await sessionB.affected(`update users set full_name = 'hackeado' where id = '${USER_A}'`);
    expect(affected).toBe(0);
  });
});
