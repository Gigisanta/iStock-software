/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  LA VIDRIERA ANÓNIMA CONTRA POSTGRES REAL, CON EL ROL `anon` DE VERDAD.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Este archivo es la corrección del hallazgo HIGH-1: la vidriera consultaba Postgres con un rol
 * que **se saltea RLS** (superusuario en local) y, del otro lado, `anon` no tenía ni un `GRANT`,
 * así que en producción habría leído cero filas con `42501`.
 *
 * ## El assert que hace que este archivo valga algo
 * Todo lo de abajo es **teatro** si la conexión bajo prueba es superusuario: un superusuario
 * ignora `FORCE ROW LEVEL SECURITY` y todos los `GRANT`, así que cualquier aserción de
 * aislamiento pasa sola. Por eso el primer `describe` no prueba el producto: prueba **el
 * instrumento**. Y tiene control positivo — la conexión de admin, que sí es superusuario — para
 * que no pueda quedar verde por medir mal.
 *
 * ## Las dos capas que se verifican, por separado
 * 1. **GRANT de columna** → decide QUÉ COLUMNAS. `select imei` / `select *` dan `42501`, no
 *    devuelven datos de más. Es la defensa que sigue en pie cuando `publicListingDTO` falla.
 * 2. **Policy `TO anon`** → decide QUÉ FILAS. Tenant del slug + estado público + publicado.
 *
 * Cero mocks: la policy no la evalúa TypeScript, la evalúa el planner de Postgres.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PUBLIC_STATUSES } from '@istock/domain';
import { openAdmin, openStorefrontSession, type Session } from './test-session';

// Bloque de uuids propio: no pisa los de `rls.test.ts` (a/b) ni los de `rls-cross-tenant.test.ts`
// (c/d).
const TENANT_A = '00000000-0000-4000-9000-0000000000e1';
const TENANT_B = '00000000-0000-4000-9000-0000000000e2';
const TENANT_OFF = '00000000-0000-4000-9000-0000000000e3';
const SLUG_A = 'anonstore-a';
const SLUG_B = 'anonstore-b';
const SLUG_OFF = 'anonstore-off';

const LISTING_A_PUBLIC = '00000000-0000-4000-9000-0000000000f1';
const LISTING_A_DRAFT = '00000000-0000-4000-9000-0000000000f2';
const LISTING_B_PUBLIC = '00000000-0000-4000-9000-0000000000f3';
const LISTING_OFF = '00000000-0000-4000-9000-0000000000f4';
const PHOTO_A_PUBLIC = '00000000-0000-4000-9000-0000000000f5';
const PHOTO_A_DRAFT = '00000000-0000-4000-9000-0000000000f6';
const LOC_A_ACTIVE = '00000000-0000-4000-9000-0000000000f7';
const LOC_A_OFF = '00000000-0000-4000-9000-0000000000f8';

const admin = openAdmin();
let storefrontA: Session;
let storefrontB: Session;
let storefrontSinClaim: Session;

async function adminRows<T>(text: string): Promise<T[]> {
  return (await admin.unsafe(text)) as unknown as T[];
}

function listingInsert(id: string, tenant: string, slug: string, status: string): string {
  return `
    insert into listings
      (id, tenant_id, slug, title, condition, price_usd, cost_usd, supplier, internal_notes, imei, status)
    values
      ('${id}', '${tenant}', '${slug}', 'iPhone 14 Pro', 'used_excellent', 620.00, 500.00,
       'Proveedor Secreto', 'no mostrar', '353916100000001', '${status}')`;
}

beforeAll(async () => {
  await admin.unsafe(`delete from tenants where id in ('${TENANT_A}', '${TENANT_B}', '${TENANT_OFF}')`);
  await admin.unsafe(`
    insert into tenants (id, slug, name, wa_phone, status, payment_methods, accepts_trade_in) values
      ('${TENANT_A}',   '${SLUG_A}',   'Vidriera A',    '5492990000011', 'active',    '{"efectivo"}', true),
      ('${TENANT_B}',   '${SLUG_B}',   'Vidriera B',    '5492990000012', 'active',    '{"transferencia"}', false),
      ('${TENANT_OFF}', '${SLUG_OFF}', 'Vidriera Baja', '5492990000013', 'suspended', '{"efectivo"}', false)`);

  await admin.unsafe(`
    insert into fx_settings (tenant_id, ars_per_usd, rounding) values
      ('${TENANT_A}', 1487.50, 'ceil_1000'), ('${TENANT_B}', 1500.00, 'ceil_1000')`);

  await admin.unsafe(`
    insert into locations (id, tenant_id, name, address, hours, is_active) values
      ('${LOC_A_ACTIVE}', '${TENANT_A}', 'Cipolletti', 'Roca 100', 'lun a vie 10 a 18', true),
      ('${LOC_A_OFF}',    '${TENANT_A}', 'Cerrado',    'Roca 200', 'no atiende',        false)`);

  // `imei` distinto por fila: hay un único parcial (tenant_id, imei).
  await admin.unsafe(listingInsert(LISTING_A_PUBLIC, TENANT_A, 'publicado-a', 'available'));
  await admin.unsafe(
    listingInsert(LISTING_A_DRAFT, TENANT_A, 'borrador-a', 'draft').replace('353916100000001', '353916100000002'),
  );
  await admin.unsafe(
    listingInsert(LISTING_B_PUBLIC, TENANT_B, 'publicado-b', 'available').replace('353916100000001', '353916100000003'),
  );
  await admin.unsafe(
    listingInsert(LISTING_OFF, TENANT_OFF, 'publicado-off', 'available').replace('353916100000001', '353916100000004'),
  );

  await admin.unsafe(`
    insert into listing_photos (id, tenant_id, listing_id, sort_order, master_key, thumb_key, card_key, detail_key) values
      ('${PHOTO_A_PUBLIC}', '${TENANT_A}', '${LISTING_A_PUBLIC}', 0, 'originals/secreto.jpg', 't1', 'c1', 'd1'),
      ('${PHOTO_A_DRAFT}',  '${TENANT_A}', '${LISTING_A_DRAFT}',  0, 'originals/secreto2.jpg', 't2', 'c2', 'd2')`);

  storefrontA = openStorefrontSession(SLUG_A);
  storefrontB = openStorefrontSession(SLUG_B);
  storefrontSinClaim = openStorefrontSession(null);
});

afterAll(async () => {
  await storefrontA?.close();
  await storefrontB?.close();
  await storefrontSinClaim?.close();
  await admin.unsafe(`delete from tenants where id in ('${TENANT_A}', '${TENANT_B}', '${TENANT_OFF}')`);
  await admin.end({ timeout: 5 });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('0 · el instrumento: la conexión bajo prueba NO es superusuario', () => {
  it('current_user es `anon`, no el dueño de la base', async () => {
    const r = await storefrontA.query<{ u: string }>(`select current_user::text as u`);
    expect(r[0]?.u).toBe('anon');
  });

  it('usesuper = false · rolsuper = false · rolbypassrls = false', async () => {
    // `pg_user` sólo lista roles con login, y `anon` es NOLOGIN: comparar `usesuper = false`
    // daría NULL y el test "pasaría" por vacío. Se pregunta por la existencia de la fila
    // superusuaria, que es la pregunta correcta: *¿esta conexión tiene usesuper?*
    const r = await storefrontA.query<{ usesuper: boolean; rolsuper: boolean; bypass: boolean }>(`
      select exists (select 1 from pg_user where usename = current_user and usesuper) as usesuper,
             (select rolsuper      from pg_roles where rolname = current_user) as rolsuper,
             (select rolbypassrls  from pg_roles where rolname = current_user) as bypass`);
    expect(r[0]?.usesuper).toBe(false);
    expect(r[0]?.rolsuper).toBe(false);
    expect(r[0]?.bypass).toBe(false);
  });

  it('control positivo: la conexión de admin SÍ es superusuario (si no, el assert de arriba no mide nada)', async () => {
    const r = await adminRows<{ usesuper: boolean }>(
      `select exists (select 1 from pg_user where usename = current_user and usesuper) as usesuper`,
    );
    expect(r[0]?.usesuper).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('a · la vidriera LEE lo que tiene que leer (si no, el resto sería verde por vacío)', () => {
  it('el listing publicado del tenant A, con los campos de publicListingDTO', async () => {
    const r = await storefrontA.query<{ slug: string; title: string; price_usd: string; status: string }>(
      `select slug, title, price_usd, status from listings where tenant_id = '${TENANT_A}'`,
    );
    expect(r).toHaveLength(1);
    expect(r[0]?.slug).toBe('publicado-a');
    // `numeric` llega como string y así se queda (src/money.ts).
    expect(r[0]?.price_usd).toBe('620.00');
  });

  it('el tenant del host, con el teléfono del `wa.me`', async () => {
    const r = await storefrontA.query<{ slug: string; name: string; wa_phone: string }>(
      `select slug, name, wa_phone from tenants where slug = '${SLUG_A}'`,
    );
    expect(r).toEqual([{ slug: SLUG_A, name: 'Vidriera A', wa_phone: '5492990000011' }]);
  });

  it('las variantes públicas de la foto, el punto de retiro activo y el TC', async () => {
    const fotos = await storefrontA.query<{ card_key: string }>(
      `select card_key from listing_photos where tenant_id = '${TENANT_A}'`,
    );
    expect(fotos.map((f) => f.card_key)).toEqual(['c1']);

    const locs = await storefrontA.query<{ name: string }>(
      `select name from locations where tenant_id = '${TENANT_A}'`,
    );
    expect(locs.map((l) => l.name)).toEqual(['Cipolletti']);

    const fx = await storefrontA.query<{ ars_per_usd: string; rounding: string }>(
      `select ars_per_usd, rounding from fx_settings where tenant_id = '${TENANT_A}'`,
    );
    expect(fx).toEqual([{ ars_per_usd: '1487.50', rounding: 'ceil_1000' }]);
  });

  it('el catálogo global, que es un hecho del mundo y no un dato de nadie', async () => {
    const r = await storefrontA.query<{ n: string }>(`select count(*)::text as n from catalog_models`);
    expect(Number(r[0]?.n ?? 0)).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('b · las columnas sensibles no se filtran: revientan con 42501', () => {
  // 42501 = insufficient_privilege. La diferencia con "el DTO no las incluye" es que esto lo
  // decide Postgres, no nuestro código: sigue en pie cuando el DTO tiene un bug.
  const prohibidas: readonly (readonly [string, string])[] = [
    ['listings', 'imei'],
    ['listings', 'imei_check_status'],
    ['listings', 'imei_check_status_raw'],
    ['listings', 'imei_checked_by'],
    ['listings', 'cost_usd'],
    ['listings', 'margin_usd'],
    ['listings', 'supplier'],
    ['listings', 'internal_notes'],
    ['listings', 'created_by'],
    ['listing_photos', 'master_key'],
    ['listing_photos', 'card_bytes'],
    ['fx_settings', 'updated_by'],
    ['tenants', 'plan'],
    ['tenants', 'trial_ends_at'],
  ];

  it.each(prohibidas)('select %s.%s → 42501', async (table, column) => {
    expect(await storefrontA.expectError(`select ${column} from ${table} limit 1`)).toBe('42501');
  });

  it('`select *` tampoco corre: es la feature, no un efecto colateral', async () => {
    // Un `select *` de Drizzle sobre una tabla de la vidriera deja de funcionar a propósito.
    // Si algún día alguien lo necesita, la respuesta es el DTO, no un GRANT más ancho.
    expect(await storefrontA.expectError(`select * from listings limit 1`)).toBe('42501');
    expect(await storefrontA.expectError(`select * from listing_photos limit 1`)).toBe('42501');
    expect(await storefrontA.expectError(`select * from tenants limit 1`)).toBe('42501');
  });

  it('ni siquiera agregando: un `sum(cost_usd)` es la fuga más silenciosa que hay', async () => {
    expect(await storefrontA.expectError(`select sum(cost_usd) from listings`)).toBe('42501');
    expect(await storefrontA.expectError(`select count(*) from listings where imei is not null`)).toBe('42501');
    expect(await storefrontA.expectError(`select slug from listings order by cost_usd`)).toBe('42501');
  });

  const invisibles = [
    'sales', 'tradein_leads', 'tradein_checklists', 'reservations', 'memberships', 'users',
    'listing_events', 'wa_click_events', 'chatbot_threads', 'chatbot_messages', 'subscriptions',
    'entitlements', 'catalog_faqs',
  ];

  it.each(invisibles)('la tabla %s no existe para la vidriera: ni una columna otorgada', async (table) => {
    expect(await storefrontA.expectError(`select 1 from ${table} limit 1`)).toBe('42501');
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('c · las filas que no son públicas devuelven 0 filas, no un error', () => {
  it('un listing en `draft` no existe para la vidriera', async () => {
    const r = await storefrontA.query<{ n: string }>(
      `select count(*)::text as n from listings where id = '${LISTING_A_DRAFT}'`,
    );
    expect(r[0]?.n).toBe('0');
  });

  it('la foto de un borrador tampoco: la foto se ve si y sólo si su listing se ve', async () => {
    const r = await storefrontA.query<{ id: string }>(
      `select id from listing_photos where tenant_id = '${TENANT_A}' order by sort_order`,
    );
    expect(r.map((x) => x.id)).toEqual([PHOTO_A_PUBLIC]);
  });

  it('un punto de retiro dado de baja no se publica', async () => {
    const r = await storefrontA.query<{ n: string }>(
      `select count(*)::text as n from locations where id = '${LOC_A_OFF}'`,
    );
    expect(r[0]?.n).toBe('0');
  });

  it('un tenant `suspended` no tiene vidriera, ni él ni su stock publicado', async () => {
    const visitante = openStorefrontSession(SLUG_OFF);
    try {
      expect(await visitante.query(`select slug from tenants`)).toEqual([]);
      expect(await visitante.query(`select slug from listings`)).toEqual([]);
      // El stock del tenant dado de baja tampoco aparece desde la vidriera de otro.
      const r = await storefrontA.query<{ n: string }>(
        `select count(*)::text as n from listings where id = '${LISTING_OFF}'`,
      );
      expect(r[0]?.n).toBe('0');
    } finally {
      await visitante.close();
    }
  });

  it('sin claim de slug NO se ve nada: falla cerrado (es el caso de PostgREST con la anon key)', async () => {
    expect(await storefrontSinClaim.query(`select slug from tenants`)).toEqual([]);
    expect(await storefrontSinClaim.query(`select slug from listings`)).toEqual([]);
    expect(await storefrontSinClaim.query(`select card_key from listing_photos`)).toEqual([]);
    expect(await storefrontSinClaim.query(`select name from locations`)).toEqual([]);
    expect(await storefrontSinClaim.query(`select ars_per_usd from fx_settings`)).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('d · la vidriera no escribe. Nunca.', () => {
  const escrituras: readonly (readonly [string, string])[] = [
    [
      'insert listing',
      `insert into listings (tenant_id, slug, title, condition, price_usd) values ('${TENANT_A}', 'trucho', 'x', 'sealed', 1.00)`,
    ],
    ['update listing', `update listings set title = 'hackeado' where id = '${LISTING_A_PUBLIC}'`],
    ['delete listing', `delete from listings where id = '${LISTING_A_PUBLIC}'`],
    ['update precio', `update listings set price_usd = 1.00 where tenant_id = '${TENANT_A}'`],
    ['insert tenant', `insert into tenants (slug, name, wa_phone) values ('trucho', 'x', '5492990000099')`],
    ['update tenant', `update tenants set wa_phone = '5490000000000' where slug = '${SLUG_A}'`],
    ['delete tenant', `delete from tenants where slug = '${SLUG_A}'`],
    ['insert foto', `insert into listing_photos (tenant_id, listing_id, master_key, thumb_key, card_key, detail_key) values ('${TENANT_A}', '${LISTING_A_PUBLIC}', 'm', 't', 'c', 'd')`],
    ['delete foto', `delete from listing_photos where tenant_id = '${TENANT_A}'`],
    ['update fx', `update fx_settings set ars_per_usd = 1.00 where tenant_id = '${TENANT_A}'`],
    ['insert lead de canje', `insert into tradein_leads (tenant_id, customer_name, customer_wa_phone, model_text) values ('${TENANT_A}', 'x', '5492990000000', 'iPhone 12')`],
    ['insert click de WhatsApp', `insert into wa_click_events (tenant_id, listing_id, source) values ('${TENANT_A}', '${LISTING_A_PUBLIC}', 'storefront_card')`],
  ];

  it.each(escrituras)('%s → 42501', async (_caso, statement) => {
    expect(await storefrontA.expectError(statement)).toBe('42501');
  });

  it('y la fila que intentó tocar quedó intacta', async () => {
    const r = await adminRows<{ title: string; price_usd: string }>(
      `select title, price_usd from listings where id = '${LISTING_A_PUBLIC}'`,
    );
    expect(r[0]).toEqual({ title: 'iPhone 14 Pro', price_usd: '620.00' });
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('e · vidriera A no lee vidriera B (dos sesiones, dos claims, cero mocks)', () => {
  it('A no ve el listing publicado de B', async () => {
    const r = await storefrontA.query<{ n: string }>(
      `select count(*)::text as n from listings where id = '${LISTING_B_PUBLIC}'`,
    );
    expect(r[0]?.n).toBe('0');
  });

  it('B sí ve el suyo: el aislamiento no es "no hay datos"', async () => {
    const r = await storefrontB.query<{ slug: string }>(`select slug from listings`);
    expect(r.map((x) => x.slug)).toEqual(['publicado-b']);
  });

  it('un `select` SIN where —el error clásico— tampoco cruza tenants', async () => {
    const r = await storefrontA.query<{ tenant_id: string }>(`select distinct tenant_id from listings`);
    expect(r.map((x) => x.tenant_id)).toEqual([TENANT_A]);
  });

  it('A no puede pedir el tenant de B por slug ni por id', async () => {
    expect(await storefrontA.query(`select name from tenants where slug = '${SLUG_B}'`)).toEqual([]);
    expect(await storefrontA.query(`select name from tenants where id = '${TENANT_B}'`)).toEqual([]);
  });

  it('el TC y los puntos de retiro de B tampoco cruzan', async () => {
    expect(await storefrontA.query(`select ars_per_usd from fx_settings where tenant_id = '${TENANT_B}'`)).toEqual([]);
    expect(await storefrontA.query(`select card_key from listing_photos where tenant_id = '${TENANT_B}'`)).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('f · la forma del privilegio, leída de la base (no del archivo de migración)', () => {
  /** Allowlist EXACTA. Si alguien agrega una columna al GRANT, este test lo dice por nombre. */
  const ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
    tenants: ['accepts_trade_in', 'id', 'name', 'payment_methods', 'slug', 'status', 'wa_phone'],
    listings: [
      'battery_pct', 'catalog_model_id', 'color', 'condition', 'description', 'icloud_status_text',
      'id', 'price_usd', 'provenance_text', 'published_at', 'screen_original', 'slug', 'status',
      'storage_gb', 'tenant_id', 'title', 'warranty_text',
    ],
    listing_photos: [
      'alt', 'card_key', 'detail_key', 'height', 'id', 'listing_id', 'sort_order', 'tenant_id',
      'thumb_key', 'width',
    ],
    locations: ['address', 'city', 'hours', 'id', 'is_active', 'name', 'sort_order', 'tenant_id'],
    fx_settings: ['ars_per_usd', 'rounding', 'tenant_id'],
    catalog_models: ['brand', 'display_name', 'family', 'id', 'release_year', 'slug'],
  };

  it('`anon` no tiene privilegio de TABLA sobre ninguna de las 19: el GRANT es de columna', async () => {
    const r = await adminRows<{ t: string }>(`
      select c.relname as t from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and has_table_privilege('anon', c.oid, 'SELECT')
      order by 1`);
    expect(r.map((x) => x.t)).toEqual([]);
  });

  it('tampoco INSERT/UPDATE/DELETE en ninguna tabla ni en ninguna columna', async () => {
    const tablas = await adminRows<{ t: string }>(`
      select c.relname as t from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and has_table_privilege('anon', c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
      order by 1`);
    expect(tablas.map((x) => x.t)).toEqual([]);

    const columnas = await adminRows<{ p: string }>(`
      select table_name || '.' || column_name || ':' || privilege_type as p
      from information_schema.column_privileges
      where table_schema = 'public' and grantee = 'anon' and privilege_type <> 'SELECT'
      order by 1`);
    expect(columnas.map((x) => x.p)).toEqual([]);
  });

  it('el GRANT de columna es EXACTAMENTE la allowlist del read model público', async () => {
    const r = await adminRows<{ table_name: string; column_name: string }>(`
      select table_name, column_name from information_schema.column_privileges
      where table_schema = 'public' and grantee = 'anon' and privilege_type = 'SELECT'
      order by table_name, column_name`);

    const real: Record<string, string[]> = {};
    for (const row of r) (real[row.table_name] ??= []).push(row.column_name);
    expect(real).toEqual(ALLOWLIST);
  });

  it('ninguna columna SENSITIVE tiene GRANT hacia anon (leído del COMMENT de la propia base)', async () => {
    // No se compara contra una lista escrita a mano: se le pregunta a Postgres cuáles columnas
    // están marcadas `SENSITIVE:` y se cruza con lo que `anon` puede leer. Una columna sensible
    // nueva queda cubierta el día que se marca, sin tocar este test.
    const r = await adminRows<{ col: string }>(`
      select c.relname || '.' || a.attname as col
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      where c.relkind = 'r'
        and col_description(c.oid, a.attnum) like 'SENSITIVE:%'
        and has_column_privilege('anon', c.oid, a.attnum, 'SELECT')
      order by 1`);
    expect(r.map((x) => x.col)).toEqual([]);
  });

  it('las policies `TO anon` son SÓLO de SELECT y ninguna es `using (true)`', async () => {
    const r = await adminRows<{ p: string; cmd: string; qual: string | null }>(`
      select tablename || '.' || policyname as p, cmd, qual
      from pg_policies where schemaname = 'public' and 'anon' = any(roles) order by 1`);
    expect(r.length).toBe(5);
    for (const row of r) {
      expect(row.cmd, `${row.p} no es SELECT`).toBe('SELECT');
      expect(row.qual ?? 'true', `${row.p} es RLS decorativa`).not.toBe('true');
    }
  });

  it('ninguna policy está otorgada a `public` (que incluye a anon sin decirlo)', async () => {
    const r = await adminRows<{ p: string }>(`
      select tablename || '.' || policyname as p from pg_policies
      where schemaname = 'public' and roles::text[] && array['public'] order by 1`);
    expect(r.map((x) => x.p)).toEqual([]);
  });

  it('la policy de listings usa EXACTAMENTE los PUBLIC_STATUSES de @istock/domain', async () => {
    // El día que `domain` agregue o saque un estado público, esto se pone rojo en vez de dejar
    // la base publicando un vocabulario viejo.
    const r = await adminRows<{ qual: string }>(`
      select qual from pg_policies
      where schemaname = 'public' and policyname = 'listings_storefront_anon_select'`);
    const qual = r[0]?.qual ?? '';
    const enPolicy = [...qual.matchAll(/'([a-z_]+)'::listing_status/g)].map((m) => m[1]).sort();
    expect(enPolicy).toEqual([...PUBLIC_STATUSES].sort());
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('g · `published_at` lo garantiza el motor, no la buena memoria del panel', () => {
  const ID = '00000000-0000-4000-9000-0000000000fa';

  it('una unidad que nace `available` sale publicada, aunque nadie stampee published_at', async () => {
    await admin.unsafe(
      listingInsert(ID, TENANT_A, 'nace-publicada', 'available').replace('353916100000001', '353916100000009'),
    );
    const r = await storefrontA.query<{ slug: string }>(`select slug from listings where id = '${ID}'`);
    expect(r.map((x) => x.slug)).toEqual(['nace-publicada']);
    await admin.unsafe(`delete from listings where id = '${ID}'`);
  });

  it('un borrador que pasa a `available` también', async () => {
    await admin.unsafe(
      listingInsert(ID, TENANT_A, 'nace-borrador', 'draft').replace('353916100000001', '353916100000010'),
    );
    expect(await storefrontA.query(`select slug from listings where id = '${ID}'`)).toEqual([]);
    await admin.unsafe(`update listings set status = 'available' where id = '${ID}'`);
    const r = await storefrontA.query<{ slug: string }>(`select slug from listings where id = '${ID}'`);
    expect(r.map((x) => x.slug)).toEqual(['nace-borrador']);
    await admin.unsafe(`delete from listings where id = '${ID}'`);
  });
});
