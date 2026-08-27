/**
 * Invariantes del schema, verificadas **contra la base real**, no contra el TypeScript.
 *
 * Por qué contra la base: el TS puede decir `.enableRLS()` y la migración no haberse aplicado; la
 * policy puede existir con la RLS apagada (lint `0007` de Supabase, que es *el que más se parece
 * a "ya está hecho"*); el `COMMENT` puede haberse perdido en un merge. Lo único que cuenta es lo
 * que hay en `pg_class` / `pg_policies` cuando alguien se conecta.
 *
 * Estos tests son el equivalente ejecutable del §6 de la skill `drizzle-rls` y del gate de merge
 * de ADR-005 (los seis lints ERROR de Supabase).
 */

import { afterAll, describe, expect, it } from 'vitest';
import { CONDITIONS, LISTING_KINDS, LISTING_STATUSES } from '@istock/domain';
import { openAdmin } from './test-session';

const sql = openAdmin();

/** Las dos únicas tablas sin `tenant_id` y sin RLS. Ver `src/schema/catalog.ts`. */
const GLOBAL_TABLES = ['catalog_faqs', 'catalog_models'] as const;
/** Sin `tenant_id` pero CON RLS: identidad. Ver `src/schema/users.ts` y `tenants.ts`. */
const IDENTITY_TABLES = ['tenants', 'users'] as const;

const EXPECTED_TABLES = 19;
const EXPECTED_RLS_TABLES = 17;

afterAll(async () => { await sql.end({ timeout: 5 }); });

async function rows<T>(text: string): Promise<T[]> {
  return (await sql.unsafe(text)) as unknown as T[];
}

describe('conteo de tablas vs conteo de RLS (el número que reporta db-agent)', () => {
  it(`hay ${String(EXPECTED_TABLES)} tablas en public`, async () => {
    const r = await rows<{ n: string }>(`
      select count(*)::text as n from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relname not like '__drizzle%'`);
    expect(r[0]?.n).toBe(String(EXPECTED_TABLES));
  });

  it(`${String(EXPECTED_RLS_TABLES)} tienen RLS habilitada`, async () => {
    const r = await rows<{ n: string }>(`
      select count(*)::text as n from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity`);
    expect(r[0]?.n).toBe(String(EXPECTED_RLS_TABLES));
  });

  it('la diferencia son EXACTAMENTE las 2 tablas globales del catálogo, ninguna más', async () => {
    const r = await rows<{ relname: string }>(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
        and c.relname not like '__drizzle%' order by 1`);
    expect(r.map((x) => x.relname)).toEqual([...GLOBAL_TABLES]);
    expect(EXPECTED_TABLES - EXPECTED_RLS_TABLES).toBe(GLOBAL_TABLES.length);
  });

  it('toda tabla con RLS la tiene además FORZADA (si no, el owner la ignora)', async () => {
    const r = await rows<{ relname: string }>(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity and not c.relforcerowsecurity`);
    expect(r.map((x) => x.relname)).toEqual([]);
  });
});

describe('forma de las policies (ADR-005 · los seis lints ERROR de Supabase)', () => {
  it('lint 0007 — no hay policies escritas sobre una tabla con RLS apagada', async () => {
    const r = await rows<{ tablename: string }>(`
      select distinct p.tablename from pg_policies p
      join pg_class c on c.relname = p.tablename
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = p.schemaname
      where p.schemaname = 'public' and not c.relrowsecurity`);
    expect(r.map((x) => x.tablename)).toEqual([]);
  });

  it('ninguna policy es `using (true)` / `with check (true)` — eso es RLS decorativa', async () => {
    const r = await rows<{ p: string }>(`
      select tablename || '.' || policyname as p from pg_policies
      where schemaname = 'public' and (qual = 'true' or with_check = 'true')`);
    expect(r.map((x) => x.p)).toEqual([]);
  });

  it('toda policy es `TO authenticated` — nunca `TO public`, que incluye a anon', async () => {
    const r = await rows<{ p: string }>(`
      select tablename || '.' || policyname as p from pg_policies
      where schemaname = 'public' and not ('authenticated' = any(roles))`);
    expect(r.map((x) => x.p)).toEqual([]);
  });

  it('`auth.jwt()` siempre va envuelto en subquery (se evalúa 1 vez, no 1 vez por fila)', async () => {
    const r = await rows<{ p: string }>(`
      select tablename || '.' || policyname as p from pg_policies
      where schemaname = 'public'
        and (qual like '%auth.jwt%' or with_check like '%auth.jwt%')
        and coalesce(qual, '') || coalesce(with_check, '') not like '%( SELECT%'`);
    expect(r.map((x) => x.p)).toEqual([]);
  });

  it('cada tabla con RLS cubre las 4 operaciones: select, insert, update, delete', async () => {
    const r = await rows<{ tablename: string; cmds: string }>(`
      select tablename, string_agg(distinct lower(cmd), ',' order by lower(cmd)) as cmds
      from pg_policies where schemaname = 'public' group by tablename order by tablename`);
    expect(r).toHaveLength(EXPECTED_RLS_TABLES);
    for (const row of r) {
      expect(row.cmds, `${row.tablename} no cubre las 4 operaciones`).toBe('delete,insert,select,update');
    }
  });

  it('toda policy de INSERT/UPDATE tiene WITH CHECK (sin eso se escriben filas de otro tenant)', async () => {
    const r = await rows<{ p: string }>(`
      select tablename || '.' || policyname as p from pg_policies
      where schemaname = 'public' and cmd in ('INSERT', 'UPDATE') and with_check is null`);
    expect(r.map((x) => x.p)).toEqual([]);
  });
});

describe('columnas obligatorias', () => {
  it('`tenant_id` es NOT NULL, uuid, y con FK a tenants ON DELETE CASCADE en las 15 tablas', async () => {
    const r = await rows<{ relname: string; notnull: boolean; typ: string; ondelete: string | null }>(`
      select c.relname,
             a.attnotnull as notnull,
             format_type(a.atttypid, a.atttypmod) as typ,
             (select con.confdeltype from pg_constraint con
               where con.conrelid = c.oid and con.contype = 'f' and a.attnum = any(con.conkey)
               limit 1) as ondelete
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id'
      where n.nspname = 'public' and c.relkind = 'r' order by 1`);
    expect(r).toHaveLength(15);
    for (const row of r) {
      expect(row.notnull, `${row.relname}.tenant_id debe ser NOT NULL`).toBe(true);
      expect(row.typ).toBe('uuid');
      expect(row.ondelete, `${row.relname}.tenant_id debe cascadear`).toBe('c');
    }
  });

  it('`tenant_id` está indexado en TODAS (sin índice, la policy escanea la tabla entera)', async () => {
    const r = await rows<{ relname: string }>(`
      select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id'
      where n.nspname = 'public' and c.relkind = 'r'
        and not exists (select 1 from pg_index i where i.indrelid = c.oid and a.attnum = any(i.indkey))
      order by 1`);
    expect(r.map((x) => x.relname)).toEqual([]);
  });

  it('todo índice compuesto de una tabla con tenant_id arranca por tenant_id', async () => {
    // El orden importa: un índice (status, tenant_id) no sirve para una query filtrada por tenant.
    const r = await rows<{ idx: string }>(`
      select i.relname as idx
      from pg_index x
      join pg_class i on i.oid = x.indexrelid
      join pg_class c on c.oid = x.indrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and array_length(x.indkey::int2[], 1) > 1
        and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id')
        and (select a.attname from pg_attribute a where a.attrelid = c.oid and a.attnum = x.indkey[0]) <> 'tenant_id'
      order by 1`);
    // Excepción consciente: la unicidad "una sola reserva activa por unidad" y la unicidad de
    // orden de foto son por listing, no por tenant — y el listing ya está acotado por tenant.
    expect(r.map((x) => x.idx)).toEqual([
      'listing_photos_listing_sort_key',
      'tradein_checklists_lead_item_key',
    ]);
  });

  it('cero columnas de plata en float/real/double: TODA plata es numeric(12, 2)', async () => {
    const r = await rows<{ col: string; typ: string }>(`
      select c.relname || '.' || a.attname as col, format_type(a.atttypid, a.atttypmod) as typ
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      where n.nspname = 'public' and c.relkind = 'r'
        and format_type(a.atttypid, a.atttypmod) in ('real', 'double precision', 'money')`);
    expect(r.map((x) => x.col)).toEqual([]);
  });

  it('toda columna numeric es exactamente numeric(12, 2)', async () => {
    const r = await rows<{ col: string; typ: string }>(`
      select c.relname || '.' || a.attname as col, format_type(a.atttypid, a.atttypmod) as typ
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      where n.nspname = 'public' and c.relkind = 'r' and a.atttypid = 'numeric'::regtype
        and format_type(a.atttypid, a.atttypmod) <> 'numeric(12,2)'`);
    expect(r.map((x) => x.col)).toEqual([]);
  });

  it('todo timestamp es timestamptz (nunca `timestamp without time zone`)', async () => {
    const r = await rows<{ col: string }>(`
      select c.relname || '.' || a.attname as col
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      where n.nspname = 'public' and c.relkind = 'r'
        and format_type(a.atttypid, a.atttypmod) = 'timestamp without time zone'`);
    expect(r.map((x) => x.col)).toEqual([]);
  });

  it('toda PK `id` es uuid con default', async () => {
    const r = await rows<{ relname: string; typ: string; def: string | null }>(`
      select c.relname, format_type(a.atttypid, a.atttypmod) as typ,
             pg_get_expr(d.adbin, d.adrelid) as def
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'id'
      left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
      where n.nspname = 'public' and c.relkind = 'r' and c.relname not like '__drizzle%' order by 1`);
    expect(r).toHaveLength(EXPECTED_TABLES);
    for (const row of r) {
      expect(row.typ, `${row.relname}.id`).toBe('uuid');
      expect(row.def, `${row.relname}.id sin default`).toContain('gen_random_uuid');
    }
  });
});

describe('columnas SENSIBLES — marcadas en la base, no sólo en el TypeScript', () => {
  const SENSITIVE: readonly (readonly [string, string])[] = [
    ['listings', 'imei'], ['listings', 'cost_usd'], ['listings', 'margin_usd'],
    ['listings', 'supplier'], ['listings', 'internal_notes'],
    ['sales', 'cost_usd'], ['sales', 'margin_usd'], ['sales', 'internal_notes'],
    ['tradein_leads', 'offer_usd'], ['tradein_leads', 'internal_notes'],
    ['tradein_leads', 'customer_name'], ['tradein_leads', 'customer_wa_phone'],
    ['listing_photos', 'master_key'],
  ];

  it.each(SENSITIVE)('%s.%s lleva el marcador SENSITIVE consultable desde Postgres', async (table, column) => {
    const r = await rows<{ comment: string | null }>(`
      select col_description(c.oid, a.attnum) as comment
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = '${column}'
      where n.nspname = 'public' and c.relname = '${table}'`);
    expect(r[0]?.comment ?? '').toMatch(/^SENSITIVE: never in public DTO/);
  });

  it('la migración lleva el marcador textual exacto que exige el contrato', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const file = resolve(dirname(fileURLToPath(import.meta.url)), '../drizzle/0001_rls_and_grants.sql');
    const text = readFileSync(file, 'utf8');
    const marks = text.split('\n').filter((line) => line.trim() === '-- SENSITIVE: never in public DTO');
    expect(marks).toHaveLength(SENSITIVE.length);
  });

  it('ninguna columna sensible tiene un GRANT de columna suelto hacia anon', async () => {
    const r = await rows<{ n: string }>(`
      select count(*)::text as n from information_schema.column_privileges
      where table_schema = 'public' and grantee = 'anon'`);
    expect(r[0]?.n).toBe('0');
  });
});

describe('enums: la base refleja a @istock/domain, no una copia que se desincroniza', () => {
  async function enumValues(name: string): Promise<string[]> {
    const r = await rows<{ v: string }>(`
      select e.enumlabel as v from pg_enum e join pg_type t on t.oid = e.enumtypid
      where t.typname = '${name}' order by e.enumsortorder`);
    return r.map((x) => x.v);
  }

  it('listing_condition == CONDITIONS', async () => {
    expect(await enumValues('listing_condition')).toEqual([...CONDITIONS]);
  });
  it('listing_kind == LISTING_KINDS', async () => {
    expect(await enumValues('listing_kind')).toEqual([...LISTING_KINDS]);
  });
  it('listing_status == LISTING_STATUSES (principales + laterales, en orden)', async () => {
    expect(await enumValues('listing_status')).toEqual([...LISTING_STATUSES]);
  });
  it('imei_check_status es el de ADR-009, con `inconclusive` incluido', async () => {
    expect(await enumValues('imei_check_status')).toEqual([
      'not_checked', 'valid', 'blocked', 'invalid', 'inconclusive',
    ]);
  });
});

describe('invariantes de negocio que defiende el motor, no el código de la app', () => {
  it('una unidad no puede tener dos reservas activas (índice único parcial)', async () => {
    const r = await rows<{ n: string }>(`
      select count(*)::text as n from pg_indexes
      where schemaname = 'public' and indexname = 'reservations_one_active_per_listing'
        and indexdef like '%UNIQUE%' and indexdef like '%active%'`);
    expect(r[0]?.n).toBe('1');
  });

  it('un lote no puede llevar IMEI, y una unidad no puede tener qty distinto de 1', async () => {
    const r = await rows<{ conname: string }>(`
      select conname from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      where c.relname = 'listings' and con.contype = 'c'
        and conname in ('listings_lot_has_no_imei', 'listings_unit_shape') order by 1`);
    expect(r.map((x) => x.conname)).toEqual(['listings_lot_has_no_imei', 'listings_unit_shape']);
  });

  it('el IMEI sólo entra con 15 dígitos (bloqueante), pero Luhn NO bloquea (ADR-009)', async () => {
    const r = await rows<{ def: string }>(`
      select pg_get_constraintdef(con.oid) as def from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      where c.relname = 'listings' and con.conname = 'listings_imei_format'`);
    expect(r[0]?.def).toContain('[0-9]{15}');
    const luhn = await rows<{ n: string }>(`
      select count(*)::text as n from pg_constraint con join pg_class c on c.oid = con.conrelid
      where c.relname = 'listings' and pg_get_constraintdef(con.oid) ilike '%luhn%'`);
    expect(luhn[0]?.n).toBe('0');
  });

  it('las tablas globales están documentadas COMO globales dentro de la propia base', async () => {
    for (const table of GLOBAL_TABLES) {
      const r = await rows<{ comment: string | null }>(
        `select obj_description('public.${table}'::regclass) as comment`,
      );
      expect(r[0]?.comment ?? '').toContain('GLOBAL');
    }
  });

  it('las tablas de identidad tienen RLS aunque no tengan tenant_id', async () => {
    // El filtro por `nspname` no es cosmético: sin él, `users` también matchea `auth.users`,
    // que no tiene RLS y no es nuestra.
    const r = await rows<{ relname: string; rls: boolean }>(`
      select c.relname, c.relrowsecurity as rls from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('${IDENTITY_TABLES.join("','")}') order by 1`);
    expect(r.map((x) => x.relname)).toEqual([...IDENTITY_TABLES]);
    expect(r.every((x) => x.rls)).toBe(true);
  });
});
