/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  R1–R6 · RLS CRUZADO CONTRA POSTGRES REAL. Owner: `qa-agent`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Este archivo es el gate de `CLAUDE.md` §Reglas duras 7 (*"Multi-tenant: tenant_id + RLS en toda
 * tabla de negocio. Sin RLS no hay merge"*). Es el único test del repo cuyo fallo significa
 * "el producto no se puede vender": un solo proyecto Supabase para los ~100 tenants quiere decir
 * que la policy **es** el límite de seguridad. No hay un segundo muro atrás.
 *
 * Por qué acá no hay ni un mock:
 *   un mock de RLS prueba que el mock funciona. La policy no la evalúa TypeScript: la evalúa el
 *   planner de Postgres, con `auth.jwt()` leyendo `request.jwt.claims` de la sesión. Cualquier
 *   test que no atraviese ese camino es decorativo.
 *
 * Cómo se emula producción (y qué NO se emula):
 *   - dos clientes `postgres` distintos, `max: 1` → **dos conexiones físicas**, como dos usuarios.
 *   - cada operación: `begin; set local role authenticated; set_config('request.jwt.claims', …);`
 *     que es exactamente lo que hace PostgREST/Supabase por request.
 *   - `auth.jwt()` NO se stubbea: la función existe en la base (`scripts/pg-local.sh`) con el
 *     mismo cuerpo que en Supabase.
 *   - CAVEAT de fidelidad, declarado a mano por `qa-agent`: `scripts/pg-local.sh` **no** replica los
 *     `ALTER DEFAULT PRIVILEGES` que Supabase deja puestos en `public` para `anon`, `authenticated`
 *     y `service_role`. Consecuencia: acá `anon` no tiene privilegios *porque nunca se los dieron*,
 *     no porque el `REVOKE` de la migración 0001 haya hecho su trabajo. R7 mide la invariante
 *     correcta (`has_table_privilege`), pero **hay que re-correrlo contra el proyecto Supabase real**
 *     antes de creerle. El mismo hueco es lo que pone a R8 en rojo en local.
 *   - `set local role` no es decorativo: el usuario de la conexión es **superusuario** en local, y
 *     un superusuario bypassea RLS *incluso con FORCE*. Sin el `set role`, todo esto sería verde
 *     para siempre y no probaría nada. Por eso R0 (el control positivo) existe.
 *
 * Falsificabilidad — la parte que a estos tests les suele faltar:
 *   R1–R4 tienen **control positivo** (R0): si el fixture no existiera, "B ve 0 filas" sería
 *   verde por vacío. R5/R6 tienen **control negativo**: el mismo SQL detector se corre contra un
 *   schema desechable (`qa_rls_control`) que contiene, a propósito, una tabla sin RLS y una policy
 *   `using (true)`. Si el detector no las encuentra, el detector está roto y el test lo dice.
 *
 * `qa-agent` no arregla el código bajo test. Si algo de acá se pone rojo, se reporta al LEAD.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

// ── Conexión ────────────────────────────────────────────────────────────────────────────────
// Mismo default que `packages/db/src/env.ts`, replicado a mano a propósito: el test no debe
// poder "pasar" porque alguien cambió el borde de env del paquete que está bajo test.
const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/istock_dev';
const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), '../drizzle');
const CONTROL_SCHEMA = 'qa_rls_control';

// ── Fixture ─────────────────────────────────────────────────────────────────────────────────
// UUIDs propios de este archivo (bloque `c…`/`d…`) para no pisar los de `rls.test.ts`.
const TENANT_A = '00000000-0000-4000-9000-0000000000c1';
const TENANT_B = '00000000-0000-4000-9000-0000000000d1';
const USER_A = '00000000-0000-4000-9000-0000000000c2';
const USER_B = '00000000-0000-4000-9000-0000000000d2';
const LISTING_A = '00000000-0000-4000-9000-0000000000c3';
const LISTING_B = '00000000-0000-4000-9000-0000000000d3';
const SALE_A = '00000000-0000-4000-9000-0000000000c4';
const LEAD_A = '00000000-0000-4000-9000-0000000000c5';
const INTRUDER_ROW = '00000000-0000-4000-9000-0000000000e9';

/** El costo y el IMEI de A. Si alguna de estas dos cadenas aparece en una sesión de B, es fuga. */
const COST_A = '412.00';
const IMEI_A = '353916104123456';

// ── Sesión: una conexión, un claim, un rol ──────────────────────────────────────────────────

interface Claims {
  readonly sub: string;
  readonly role: string;
  /** ADR-005 / `CLAUDE.md` §2: el tenant va en `app_metadata`. En `user_metadata` lo escribe el
   *  propio usuario → escalación de tenant. Que este test lo lea de `app_metadata` es parte de
   *  la aserción: si la policy mirara `user_metadata`, R1 se pondría rojo. */
  readonly app_metadata: { readonly tenant_id: string };
}

type PgRole = 'authenticated' | 'anon' | 'service_role';

interface Session {
  readonly rows: <T>(text: string) => Promise<T[]>;
  readonly affected: (text: string) => Promise<number>;
  readonly errorCode: (text: string) => Promise<string>;
  readonly close: () => Promise<void>;
}

function openSession(claims: Claims, role: PgRole = 'authenticated'): Session {
  const sql = postgres(DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
  const claimsJson = JSON.stringify(claims);

  async function run<T>(text: string): Promise<{ rows: T[]; count: number }> {
    return (await sql.begin(async (tx) => {
      await tx.unsafe(`set local role ${role}`);
      await tx.unsafe(`select set_config('request.jwt.claims', $1, true)`, [claimsJson]);
      const result = await tx.unsafe(text);
      return { rows: result as unknown as T[], count: result.count };
    })) as unknown as { rows: T[]; count: number };
  }

  return {
    rows: async <T>(text: string): Promise<T[]> => (await run<T>(text)).rows,
    affected: async (text: string): Promise<number> => (await run<never>(text)).count,
    errorCode: async (text: string): Promise<string> => {
      try {
        await run<never>(text);
      } catch (error) {
        return (error as { code?: string }).code ?? 'UNKNOWN_ERROR';
      }
      throw new Error(`se esperaba que Postgres rechazara la query y pasó limpia: ${text}`);
    },
    close: async (): Promise<void> => {
      await sql.end({ timeout: 5 });
    },
  };
}

function claimsFor(userId: string, tenantId: string): Claims {
  return { sub: userId, role: 'authenticated', app_metadata: { tenant_id: tenantId } };
}

// ── Detectores de metadata, parametrizados por schema ───────────────────────────────────────
// El MISMO texto SQL se corre contra `public` (donde debe dar vacío) y contra `qa_rls_control`
// (donde debe encontrar las trampas plantadas). Un detector que no encuentra la trampa es un
// detector roto, y un test que usa un detector roto es verde inútil.

/** R5 · tablas con columna `tenant_id` que NO tienen `relrowsecurity`. */
function tablesWithoutRls(schema: string): string {
  return `
    select c.relname as t
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = '${schema}'
      and c.relkind = 'r'
      and exists (
        select 1 from pg_attribute a
        where a.attrelid = c.oid and a.attname = 'tenant_id' and a.attnum > 0 and not a.attisdropped
      )
      and not c.relrowsecurity
    order by 1`;
}

/** R5b · RLS habilitada pero sin FORCE: el dueño de la tabla la ignora. */
function tablesWithoutForceRls(schema: string): string {
  return `
    select c.relname as t
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = '${schema}' and c.relkind = 'r'
      and c.relrowsecurity and not c.relforcerowsecurity
    order by 1`;
}

/** R6 · policies cuyo `USING` o `WITH CHECK` es literalmente `true`. */
function policiesUsingTrue(schema: string): string {
  const isTrue = (col: string) => `coalesce(${col}, '') ~* '^[[:space:]]*\\(*[[:space:]]*true[[:space:]]*\\)*[[:space:]]*$'`;
  return `
    select tablename || '.' || policyname as t
    from pg_policies
    where schemaname = '${schema}' and (${isTrue('qual')} or ${isTrue('with_check')})
    order by 1`;
}

/** R6b · policies otorgadas a `public` (que incluye a `anon`) en vez de a un rol explícito. */
function policiesGrantedToPublic(schema: string): string {
  return `
    select tablename || '.' || policyname as t
    from pg_policies
    where schemaname = '${schema}' and roles::text[] && array['public', 'anon']
    order by 1`;
}

// ── Estado del archivo ──────────────────────────────────────────────────────────────────────
const admin = postgres(DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
let a: Session;
let b: Session;

async function adminRows<T>(text: string): Promise<T[]> {
  return (await admin.unsafe(text)) as unknown as T[];
}

async function wipeFixture(): Promise<void> {
  await admin.unsafe(`delete from sales where tenant_id in ('${TENANT_A}', '${TENANT_B}')`);
  await admin.unsafe(`delete from listings where tenant_id in ('${TENANT_A}', '${TENANT_B}')`);
  await admin.unsafe(`delete from tenants where id in ('${TENANT_A}', '${TENANT_B}')`);
  await admin.unsafe(`delete from users where id in ('${USER_A}', '${USER_B}')`);
  await admin.unsafe(`delete from auth.users where id in ('${USER_A}', '${USER_B}')`);
}

beforeAll(async () => {
  // 1 · Migraciones versionadas de `packages/db/drizzle`. Idempotente: drizzle lleva su propia
  //     tabla de hashes. La de pgvector NO entra acá (vive en `drizzle/optional/`) porque este
  //     Postgres no tiene la extensión y las migraciones base tienen que aplicar limpias igual.
  const migrator = postgres(DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await migrate(drizzle(migrator), { migrationsFolder: MIGRATIONS });
  } finally {
    await migrator.end({ timeout: 5 });
  }

  // 2 · Fixture de dos tenants reales, montado con privilegios de operador.
  await wipeFixture();
  await admin.unsafe(`
    insert into auth.users (id, email) values
      ('${USER_A}', 'a@qa-rls.local'), ('${USER_B}', 'b@qa-rls.local')
    on conflict (id) do nothing`);
  await admin.unsafe(`
    insert into tenants (id, slug, name, wa_phone) values
      ('${TENANT_A}', 'qa-rls-a', 'Celus del Valle', '5492995550001'),
      ('${TENANT_B}', 'qa-rls-b', 'Neuquen Mobile', '5492995550002')`);
  await admin.unsafe(`
    insert into users (id, email) values
      ('${USER_A}', 'a@qa-rls.local'), ('${USER_B}', 'b@qa-rls.local')
    on conflict (id) do nothing`);
  await admin.unsafe(`
    insert into memberships (tenant_id, user_id, role) values
      ('${TENANT_A}', '${USER_A}', 'owner'), ('${TENANT_B}', '${USER_B}', 'owner')`);
  await admin.unsafe(`
    insert into listings (id, tenant_id, slug, title, condition, price_usd, cost_usd, imei, internal_notes, status)
    values ('${LISTING_A}', '${TENANT_A}', 'iphone-14-pro-256', 'iPhone 14 Pro 256 Grafito',
            'used_excellent', 620.00, ${COST_A}, '${IMEI_A}', 'lo trajo el pibe de Roca', 'available')`);
  await admin.unsafe(`
    insert into listings (id, tenant_id, slug, title, condition, price_usd, status)
    values ('${LISTING_B}', '${TENANT_B}', 'iphone-13-128', 'iPhone 13 128 Azul',
            'used_excellent', 480.00, 'available')`);
  await admin.unsafe(`
    insert into fx_settings (tenant_id, ars_per_usd) values
      ('${TENANT_A}', 1487.50), ('${TENANT_B}', 1490.00)`);
  await admin.unsafe(`
    insert into sales (id, tenant_id, listing_id, price_usd, cost_usd)
    values ('${SALE_A}', '${TENANT_A}', '${LISTING_A}', 620.00, ${COST_A})`);
  await admin.unsafe(`
    insert into tradein_leads (id, tenant_id, customer_name, customer_wa_phone, model_text, offer_usd)
    values ('${LEAD_A}', '${TENANT_A}', 'Marcela Quiroga', '5492995559999', 'iPhone 11 64', 180.00)`);

  // 3 · El schema de control negativo para R5/R6: acá SÍ hay RLS rota, a propósito.
  await admin.unsafe(`drop schema if exists ${CONTROL_SCHEMA} cascade`);
  await admin.unsafe(`create schema ${CONTROL_SCHEMA}`);
  await admin.unsafe(`create table ${CONTROL_SCHEMA}.leaky_no_rls (id uuid primary key, tenant_id uuid not null)`);
  await admin.unsafe(`create table ${CONTROL_SCHEMA}.leaky_policy (id uuid primary key, tenant_id uuid not null)`);
  await admin.unsafe(`alter table ${CONTROL_SCHEMA}.leaky_policy enable row level security`);
  await admin.unsafe(`create policy leaky_all on ${CONTROL_SCHEMA}.leaky_policy for select to public using (true)`);

  a = openSession(claimsFor(USER_A, TENANT_A));
  b = openSession(claimsFor(USER_B, TENANT_B));
});

afterAll(async () => {
  await a?.close();
  await b?.close();
  await admin.unsafe(`drop schema if exists ${CONTROL_SCHEMA} cascade`);
  await wipeFixture();
  await admin.end({ timeout: 5 });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('R0 · control positivo: sin esto, R1–R4 serían verdes por vacío', () => {
  it('el dueño del tenant SÍ ve su propia unidad publicada', async () => {
    const rows = await a.rows<{ title: string }>(`select title from listings where id = '${LISTING_A}'`);
    expect(rows.map((r) => r.title)).toEqual(['iPhone 14 Pro 256 Grafito']);
  });

  it('el dueño del tenant SÍ puede editar y borrar lo suyo (la policy no es un candado total)', async () => {
    expect(await a.affected(`update listings set color = 'Grafito' where id = '${LISTING_A}'`)).toBe(1);
    expect(await a.affected(`delete from sales where id = '${SALE_A}'`)).toBe(1);
    await admin.unsafe(
      `insert into sales (id, tenant_id, listing_id, price_usd, cost_usd)
       values ('${SALE_A}', '${TENANT_A}', '${LISTING_A}', 620.00, ${COST_A})`,
    );
  });

  it('la sesión de test NO corre como superusuario: un superusuario bypassea RLS y falsearía todo', async () => {
    const rows = await b.rows<{ role: string; superuser: boolean }>(
      `select current_user as role, (select usesuper from pg_user where usename = current_user) as superuser`,
    );
    expect(rows[0]?.role).toBe('authenticated');
    expect(rows[0]?.superuser ?? false).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('R1 · un reseller no puede LEER el stock de otro reseller', () => {
  it('B pide la unidad de A por id y recibe cero filas (no un error: cero filas)', async () => {
    const rows = await b.rows<{ id: string }>(`select id from listings where id = '${LISTING_A}'`);
    expect(rows).toEqual([]);
  });

  it('el `select` sin `where` —el error clásico— sigue devolviendo sólo lo propio', async () => {
    const rows = await b.rows<{ tenant_id: string }>(`select distinct tenant_id from listings`);
    expect(rows.map((r) => r.tenant_id)).toEqual([TENANT_B]);
  });

  it('el costo de A no se filtra ni por agregación (SUM no devuelve filas, devuelve el secreto)', async () => {
    const rows = await b.rows<{ total: string | null; n: string }>(
      `select coalesce(sum(cost_usd), 0)::text as total, count(*)::text as n from listings`,
    );
    expect(rows[0]?.n).toBe('1'); // sólo la unidad propia de B
    expect(rows[0]?.total).toBe('0'); // y esa no tiene costo cargado: el de A no entra
  });

  it('el IMEI de A no aparece en la sesión de B ni buscándolo de prepo', async () => {
    const rows = await b.rows<{ imei: string }>(`select imei from listings where imei = '${IMEI_A}'`);
    expect(rows).toEqual([]);
  });

  it('los datos personales del canje de A (nombre y WhatsApp del cliente) no cruzan de tenant', async () => {
    const rows = await b.rows<{ customer_wa_phone: string }>(`select customer_wa_phone from tradein_leads`);
    expect(rows).toEqual([]);
  });

  it('B no ve la venta de A ni el margen que se sacó', async () => {
    const rows = await b.rows<{ margin_usd: string }>(`select margin_usd from sales where id = '${SALE_A}'`);
    expect(rows).toEqual([]);
  });

  it('B no ve al tenant A ni listando la tabla de tenants', async () => {
    const rows = await b.rows<{ slug: string }>(`select slug from tenants order by slug`);
    expect(rows.map((r) => r.slug)).toEqual(['qa-rls-b']);
  });

  it('un claim con el tenant en `user_metadata` (escalación de tenant) no abre nada', async () => {
    // `CLAUDE.md` §2: el usuario puede escribir su propio `user_metadata`. Si la policy lo mirara,
    // cualquiera se haría dueño del stock ajeno editando su perfil. Acá el claim miente y no sirve.
    const forged = openSession({
      sub: USER_B,
      role: 'authenticated',
      app_metadata: { tenant_id: TENANT_B },
      ...{ user_metadata: { tenant_id: TENANT_A } },
    } as Claims);
    try {
      const rows = await forged.rows<{ id: string }>(`select id from listings where id = '${LISTING_A}'`);
      expect(rows).toEqual([]);
    } finally {
      await forged.close();
    }
  });

  it('el visitante anónimo de la vidriera no habla SQL: `anon` no tiene privilegio sobre listings', async () => {
    const visitor = openSession(claimsFor(USER_B, TENANT_B), 'anon');
    try {
      expect(await visitor.errorCode(`select id from listings limit 1`)).toBe('42501');
    } finally {
      await visitor.close();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('R2 · un reseller no puede ESCRIBIR filas en el tenant de otro', () => {
  it('B insertando una unidad con el tenant_id de A es rechazado por Postgres (WITH CHECK)', async () => {
    const code = await b.errorCode(
      `insert into listings (id, tenant_id, slug, title, condition, price_usd, status)
       values ('${INTRUDER_ROW}', '${TENANT_A}', 'trucho', 'Equipo plantado', 'sealed', 1.00, 'available')`,
    );
    expect(code).toBe('42501'); // insufficient_privilege: new row violates row-level security policy
  });

  it('el rechazo del insert no fue un unique/FK disfrazado: la fila no quedó en la base', async () => {
    const rows = await adminRows<{ id: string }>(`select id from listings where id = '${INTRUDER_ROW}'`);
    expect(rows).toEqual([]);
  });

  it('B no puede mover una unidad PROPIA al tenant de A (el `with check` del update)', async () => {
    const code = await b.errorCode(`update listings set tenant_id = '${TENANT_A}' where id = '${LISTING_B}'`);
    expect(code).toBe('42501');
  });

  it('B no puede fabricarse una membresía en el tenant de A', async () => {
    const code = await b.errorCode(
      `insert into memberships (tenant_id, user_id, role) values ('${TENANT_A}', '${USER_B}', 'owner')`,
    );
    expect(code).toBe('42501');
  });

  it('B no puede plantar un lead de canje en el inbox de A', async () => {
    const code = await b.errorCode(
      `insert into tradein_leads (tenant_id, customer_name, customer_wa_phone, model_text)
       values ('${TENANT_A}', 'Spam', '5492990000000', 'iPhone X')`,
    );
    expect(code).toBe('42501');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('R3 · un reseller no puede MODIFICAR el stock de otro', () => {
  it('B bajándole el precio a la unidad de A afecta 0 filas', async () => {
    expect(await b.affected(`update listings set price_usd = 1.00 where id = '${LISTING_A}'`)).toBe(0);
  });

  it('y el precio de A siguió intacto después del intento (0 filas = 0 bytes cambiados)', async () => {
    const rows = await adminRows<{ price_usd: string }>(`select price_usd from listings where id = '${LISTING_A}'`);
    expect(rows[0]?.price_usd).toBe('620.00');
  });

  it('B no puede marcar como vendida una unidad de A (update masivo sin where)', async () => {
    expect(await b.affected(`update listings set status = 'sold'`)).toBe(1); // sólo la suya
    const rows = await adminRows<{ status: string }>(`select status from listings where id = '${LISTING_A}'`);
    expect(rows[0]?.status).toBe('available');
  });

  it('B no puede tocar el tipo de cambio de A (el TC lo setea el dueño de cada tenant)', async () => {
    expect(await b.affected(`update fx_settings set ars_per_usd = 1.00 where tenant_id = '${TENANT_A}'`)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('R4 · un reseller no puede BORRAR el stock de otro', () => {
  it('B borrando la unidad de A por id afecta 0 filas', async () => {
    expect(await b.affected(`delete from listings where id = '${LISTING_A}'`)).toBe(0);
  });

  it('el `delete from listings` sin where —el accidente de las 3am— no toca a nadie más', async () => {
    expect(await b.affected(`delete from listings`)).toBe(1); // la suya y sólo la suya
    const rows = await adminRows<{ n: string }>(
      `select count(*)::text as n from listings where tenant_id = '${TENANT_A}'`,
    );
    expect(rows[0]?.n).toBe('1');
    await admin.unsafe(`
      insert into listings (id, tenant_id, slug, title, condition, price_usd, status)
      values ('${LISTING_B}', '${TENANT_B}', 'iphone-13-128', 'iPhone 13 128 Azul',
              'used_excellent', 480.00, 'available')`);
  });

  it('B no puede borrar el tenant A (el borrado en cascada sería el peor de los casos)', async () => {
    expect(await b.affected(`delete from tenants where id = '${TENANT_A}'`)).toBe(0);
    const rows = await adminRows<{ n: string }>(`select count(*)::text as n from tenants where id = '${TENANT_A}'`);
    expect(rows[0]?.n).toBe('1');
  });

  it('B no puede borrar las ventas ni los leads de canje de A', async () => {
    expect(await b.affected(`delete from sales where id = '${SALE_A}'`)).toBe(0);
    expect(await b.affected(`delete from tradein_leads where id = '${LEAD_A}'`)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('R5 · toda tabla de negocio tiene RLS habilitada (y forzada)', () => {
  it('el detector de "tabla sin RLS" encuentra la trampa plantada — si no, no detecta nada', async () => {
    const rows = await adminRows<{ t: string }>(tablesWithoutRls(CONTROL_SCHEMA));
    expect(rows.map((r) => r.t)).toEqual(['leaky_no_rls']);
  });

  it('ninguna tabla con columna tenant_id quedó sin `relrowsecurity` en public', async () => {
    const rows = await adminRows<{ t: string }>(tablesWithoutRls('public'));
    expect(rows.map((r) => r.t)).toEqual([]);
  });

  it('la lista de tablas con tenant_id no está vacía (si lo estuviera, R5 pasaría por vacío)', async () => {
    const rows = await adminRows<{ t: string }>(`
      select c.relname as t from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and exists (select 1 from pg_attribute a
                    where a.attrelid = c.oid and a.attname = 'tenant_id'
                      and a.attnum > 0 and not a.attisdropped)`);
    expect(rows.length).toBeGreaterThanOrEqual(15);
  });

  it('`tenants` y `users` también tienen RLS aunque no tengan columna tenant_id', async () => {
    const rows = await adminRows<{ t: string; on: boolean }>(`
      select relname as t, relrowsecurity as on from pg_class
      where relnamespace = 'public'::regnamespace and relname in ('tenants', 'users') order by 1`);
    expect(rows).toEqual([
      { t: 'tenants', on: true },
      { t: 'users', on: true },
    ]);
  });

  it('ninguna tabla tiene RLS sin FORCE: sin FORCE el dueño de la tabla ignora las policies', async () => {
    const rows = await adminRows<{ t: string }>(tablesWithoutForceRls('public'));
    expect(rows.map((r) => r.t)).toEqual([]);
  });

  it('las únicas tablas de public sin RLS son las GLOBALes declaradas del catálogo', async () => {
    const rows = await adminRows<{ t: string }>(`
      select c.relname as t from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
      order by 1`);
    expect(rows.map((r) => r.t)).toEqual(['catalog_faqs', 'catalog_models']);
  });

  it('las tablas GLOBALes son de sólo lectura para la app: nadie escribe el catálogo de todos', async () => {
    expect(await b.errorCode(`insert into catalog_models (slug, display_name) values ('x', 'X')`)).toBe('42501');
    expect(await b.errorCode(`update catalog_models set display_name = 'x'`)).toBe('42501');
    expect(await b.errorCode(`delete from catalog_models`)).toBe('42501');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('R6 · ninguna policy es `using (true)`: RLS decorativa es peor que no tener RLS', () => {
  it('el detector de `using (true)` encuentra la trampa plantada', async () => {
    const rows = await adminRows<{ t: string }>(policiesUsingTrue(CONTROL_SCHEMA));
    expect(rows.map((r) => r.t)).toEqual(['leaky_policy.leaky_all']);
  });

  it('ninguna policy de public tiene `using (true)` ni `with check (true)`', async () => {
    const rows = await adminRows<{ t: string }>(policiesUsingTrue('public'));
    expect(rows.map((r) => r.t)).toEqual([]);
  });

  it('el detector de policies otorgadas a `public`/`anon` encuentra la trampa plantada', async () => {
    const rows = await adminRows<{ t: string }>(policiesGrantedToPublic(CONTROL_SCHEMA));
    expect(rows.map((r) => r.t)).toEqual(['leaky_policy.leaky_all']);
  });

  it('ninguna policy de public está otorgada a `public`/`anon`: siempre a un rol explícito', async () => {
    const rows = await adminRows<{ t: string }>(policiesGrantedToPublic('public'));
    expect(rows.map((r) => r.t)).toEqual([]);
  });

  it('cada tabla con RLS tiene las 4 operaciones cubiertas: una sola de select deja delete abierto', async () => {
    const rows = await adminRows<{ t: string; cmds: string }>(`
      select c.relname as t,
             coalesce((select string_agg(distinct p.cmd, ',' order by p.cmd)
                       from pg_policies p
                       where p.schemaname = 'public' and p.tablename = c.relname), '') as cmds
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
      order by 1`);
    const incompletas = rows.filter((r) => r.cmds !== 'ALL' && r.cmds !== 'DELETE,INSERT,SELECT,UPDATE');
    expect(incompletas.map((r) => `${r.t}: [${r.cmds}]`)).toEqual([]);
  });

  it('toda policy evalúa `auth.jwt()` dentro de un `(select …)`: si no, corre una vez POR FILA', async () => {
    // No es sólo performance: una policy que llama a `auth.jwt()` 10k veces por query es una
    // policy que alguien va a "optimizar" apagándola.
    const rows = await adminRows<{ t: string }>(`
      select tablename || '.' || policyname as t from pg_policies
      where schemaname = 'public'
        and (coalesce(qual, '') || coalesce(with_check, '')) like '%auth.jwt%'
        and (coalesce(qual, '') || coalesce(with_check, '')) not like '%( SELECT%'
      order by 1`);
    expect(rows.map((r) => r.t)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('R7 · `anon` no tiene privilegio sobre ninguna tabla de negocio', () => {
  it('ninguna tabla de public le da SELECT a anon: el visitante nunca es un cliente de Postgres', async () => {
    const rows = await adminRows<{ t: string }>(`
      select c.relname as t from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and has_table_privilege('anon', c.oid, 'SELECT')
      order by 1`);
    expect(rows.map((r) => r.t)).toEqual([]);
  });

  it('tampoco INSERT/UPDATE/DELETE', async () => {
    const rows = await adminRows<{ t: string }>(`
      select c.relname as t from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and has_table_privilege('anon', c.oid, 'INSERT, UPDATE, DELETE')
      order by 1`);
    expect(rows.map((r) => r.t)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('R8 · el rol de los jobs (service_role) ve todos los tenants: sin eso no hay cron de reservas', () => {
  // BYPASSRLS **no otorga privilegios**: RLS se aplica ENCIMA de los GRANT, no en lugar de ellos.
  // Un `service_role` sin GRANT no lee una fila aunque bypassee todas las policies del mundo.
  // El cron de expiración de reservas y el seed corren con este rol: si no puede leer, no hay job.
  it('service_role tiene privilegio de lectura sobre listings y reservations', async () => {
    const rows = await adminRows<{ t: string; ok: boolean }>(`
      select relname as t, has_table_privilege('service_role', oid, 'SELECT') as ok
      from pg_class
      where relnamespace = 'public'::regnamespace and relname in ('listings', 'reservations')
      order by 1`);
    expect(rows).toEqual([
      { t: 'listings', ok: true },
      { t: 'reservations', ok: true },
    ]);
  });

  it('y efectivamente lee las unidades de los DOS tenants en la misma query', async () => {
    const job = openSession({ sub: USER_A, role: 'service_role', app_metadata: { tenant_id: '' } }, 'service_role');
    try {
      const rows = await job.rows<{ n: string }>(`select count(distinct tenant_id)::text as n from listings`);
      expect(Number(rows[0]?.n ?? 0)).toBeGreaterThanOrEqual(2);
    } finally {
      await job.close();
    }
  });
});
