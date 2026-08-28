/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  R0–R8 · RLS CRUZADO CONTRA POSTGRES REAL. Owner: `db-agent`.
 *  (El encabezado decía `qa-agent`. `CLAUDE.md` §4, corregido en FASE 2: el test unitario de un
 *   paquete es del owner del paquete — nace y muere con el código que prueba. `qa-agent` es dueño
 *   de lo que CRUZA un límite: e2e e integración. Este archivo vive en `packages/db/src`.)
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
 *   verde por vacío. R5/R6/R7 tienen **control negativo**: el mismo SQL detector se corre contra un
 *   schema desechable (`qa_rls_control`) donde están plantados, a propósito, los seis ataques que
 *   este archivo dice cazar. Si el detector no encuentra su trampa, el detector está roto y el
 *   test lo dice **antes** de afirmar nada sobre `public`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  POR QUÉ CAMBIÓ EL INVARIANTE DE `anon` (S1 · si venís del git log leyendo "aflojaron un test
 *  de RLS", esto es lo que buscabas)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Hasta `drizzle/0001_rls_and_grants.sql` este archivo afirmaba dos cosas que hoy son falsas
 * **por diseño**, no por descuido:
 *
 *   (viejo R1) "`select … from listings` como `anon` devuelve 42501" — o sea, `anon` no tiene
 *              NINGÚN privilegio sobre `listings`.
 *   (viejo R6) "ninguna policy de `public` está otorgada a `public`/`anon`".
 *
 * `drizzle/0002_storefront_anon_grants.sql` las contradice a propósito. El motivo está entero en
 * el encabezado de esa migración y se resume así: la vidriera anónima **sí** es un cliente de
 * Postgres. Mientras `anon` no tuvo ni un `GRANT`, el aislamiento entre tenants de la vidriera lo
 * hacía el `where` de la query, no la base — y eso sólo "andaba" en local porque la conexión de
 * desarrollo es superusuaria y un superusuario se saltea `FORCE ROW LEVEL SECURITY` entero. En
 * producción ese mismo camino recibía `42501` y la vidriera mostraba cero equipos. Hallazgo HIGH-1
 * de la ronda S1.
 *
 * Lo que hay que cuidar entonces NO es "cero privilegio para `anon`" —ese invariante describía un
 * producto sin vidriera— sino el que es **estrictamente más difícil de cumplir**:
 *
 *   > `anon` toca EXACTAMENTE la allowlist de columnas públicas, **por columna y nunca por tabla**,
 *   > sólo `SELECT`, y sólo las filas del slug que trae el claim.
 *
 * Que es más fuerte y no más débil se ve en los ataques que cada versión caza:
 *
 *   ataque                                                    viejo R1   R1/R7 de hoy
 *   ────────────────────────────────────────────────────────  ────────   ────────────
 *   GRANT SELECT ON TABLE listings TO anon                     ROJO       ROJO
 *   GRANT SELECT (imei) ON listings TO anon                    **VERDE**  ROJO
 *   GRANT INSERT (status) ON listings TO anon                  **VERDE**  ROJO
 *   CREATE POLICY … TO anon USING (true)                       **VERDE**  ROJO
 *   CREATE POLICY … TO public USING (…)                        **VERDE**  ROJO
 *   `anon` cruza de vidriera A a vidriera B                    **VERDE**  ROJO
 *
 * Las tres celdas VERDE de la izquierda no son retórica: con un GRANT sólo sobre `imei`, el viejo
 * `select id from listings` seguía devolviendo `42501` y el test quedaba en verde con el IMEI
 * publicado. El invariante viejo medía la puerta equivocada.
 *
 * El de R6 es un caso más chico: `public` es el pseudo-rol atrapa-todo (lo tiene TODO el mundo,
 * incluido `anon` sin decirlo) y `anon` es un rol nominado. El detector viejo los metía en el mismo
 * `array['public','anon']` y barría a los dos. La intención —"nunca una policy al atrapa-todo"—
 * sobrevive intacta; lo que se separó es el rol explícito, que ahora tiene su propio invariante
 * *más* estricto que el general (sólo SELECT, sólo las 5 nominadas, todas acotadas por el claim).
 *
 * Nada de esto relaja el gate: `packages/db/scripts/rls-lint.mjs` (reglas 0020/0022/0023/0024/0025)
 * lee las migraciones y `src/rls-anon-storefront.test.ts` §f lee el catálogo con la allowlist de
 * columnas **por nombre**. La allowlist está escrita dos veces, en dos archivos, a propósito: si
 * alguien la ensancha en uno para poner algo en verde, el otro sigue en rojo.
 *
 * `db-agent` no arregla el código bajo test para poner un test en verde (`CLAUDE.md` §4). Si algo
 * de acá se pone rojo, se reporta al LEAD.
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

/** Los slugs del host: `{slug}.maat.work`. Son el claim de la vidriera anónima (`0002`). */
const SLUG_A = 'qa-rls-a';
const SLUG_B = 'qa-rls-b';

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

/** El claim de la vidriera (`drizzle/0002`): no hay usuario y no hay `tenant_id`. Lo único que el
 *  server conoce antes de consultar nada es el **slug del host**, que reescribe `proxy.ts`. */
interface StorefrontClaims {
  readonly role: 'anon';
  readonly app_metadata?: { readonly storefront_slug: string };
}

type AnyClaims = Claims | StorefrontClaims;

type PgRole = 'authenticated' | 'anon' | 'service_role';

interface Session {
  readonly rows: <T>(text: string) => Promise<T[]>;
  readonly affected: (text: string) => Promise<number>;
  readonly errorCode: (text: string) => Promise<string>;
  readonly close: () => Promise<void>;
}

function openSession(claims: AnyClaims, role: PgRole = 'authenticated'): Session {
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

/** Vidriera pública: rol `anon` real + el claim del slug. `slug === null` = alguien se olvidó de
 *  setearlo, y eso tiene que fallar **cerrado** (cero filas), no abierto. */
function openStorefront(slug: string | null): Session {
  const claims: StorefrontClaims =
    slug === null ? { role: 'anon' } : { role: 'anon', app_metadata: { storefront_slug: slug } };
  return openSession(claims, 'anon');
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

/**
 * R6b · policies otorgadas al pseudo-rol `public` en vez de a un rol nominado.
 *
 * `public` NO es un rol: es el atrapa-todo que tiene absolutamente cualquiera que se conecte,
 * `anon` incluido y sin decirlo. Una policy `TO public` es una policy cuyo alcance no está escrito
 * en ningún lado. `anon` **sí** es un rol nominado y quedó fuera de este detector a partir de
 * `drizzle/0002`: tiene su propio invariante, más estricto que éste, en R6c y R7 (ver el docblock).
 */
function policiesGrantedToPublicRole(schema: string): string {
  return `
    select tablename || '.' || policyname as t
    from pg_policies
    where schemaname = '${schema}' and roles::text[] && array['public']
    order by 1`;
}

/** R6c · toda policy que nombre a `anon`, con su comando y su predicado, para auditarla entera. */
function policiesForAnon(schema: string): string {
  return `
    select tablename || '.' || policyname as t,
           cmd,
           coalesce(qual, '') as qual,
           coalesce(with_check, '') as with_check,
           permissive
    from pg_policies
    where schemaname = '${schema}' and 'anon' = any(roles)
    order by 1`;
}

// ── Detectores de PRIVILEGIO (GRANT), que es la otra capa ───────────────────────────────────
// `GRANT` y RLS se evalúan las dos: el GRANT decide si podés tocar la tabla, la policy decide qué
// filas ves (`CLAUDE.md` §2). Estos detectores preguntan por el privilegio **efectivo**
// (`has_*_privilege`), no por el `acl` textual: así también cae un `GRANT … TO PUBLIC`, que le
// llega a `anon` sin que su nombre aparezca en ningún lado.

/** R7a · tablas donde `anon` tiene SELECT **de tabla**. Un GRANT de tabla hace andar `select *`
 *  —y con él `imei` y `cost_usd`— sin tocar una sola línea de policy. */
function anonTableLevelSelect(schema: string): string {
  return `
    select c.relname as t
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = '${schema}' and c.relkind = 'r'
      and has_table_privilege('anon', c.oid, 'SELECT')
    order by 1`;
}

/** R7b · cualquier privilegio de ESCRITURA de `anon`, de tabla o de columna. El visitante no
 *  escribe: si mañana hay que registrar un lead, entra por una Server Function con el rol del
 *  server. Las únicas privilegios que existen a nivel de columna son SELECT/INSERT/UPDATE/REFERENCES. */
function anonWritePrivileges(schema: string): string {
  return `
    select c.relname || ':' || p as t
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral (
      select p from unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as p
      where has_table_privilege('anon', c.oid, p)
      union all
      select 'column:' || p from unnest(array['INSERT','UPDATE','REFERENCES']) as p
      where exists (
        select 1 from pg_attribute a
        where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
          and has_column_privilege('anon', c.oid, a.attnum, p)
      )
    ) w(p)
    where n.nspname = '${schema}' and c.relkind = 'r'
    order by 1`;
}

/** R7c · columnas marcadas `-- SENSITIVE: never in public DTO` que `anon` igual puede leer.
 *  No se compara contra una lista escrita a mano: se le pregunta a Postgres cuáles columnas están
 *  marcadas y se cruza con el privilegio efectivo. Una columna sensible nueva queda cubierta el día
 *  que se marca, sin tocar este archivo. */
function anonReadableSensitiveColumns(schema: string): string {
  return `
    select c.relname || '.' || a.attname as t
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where n.nspname = '${schema}' and c.relkind = 'r'
      and col_description(c.oid, a.attnum) like 'SENSITIVE:%'
      and has_column_privilege('anon', c.oid, a.attnum, 'SELECT')
    order by 1`;
}

/** R7d · el read model público completo, columna por columna, leído del catálogo. */
function anonReadableColumns(schema: string): string {
  return `
    select c.relname as tbl, a.attname as col
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where n.nspname = '${schema}' and c.relkind = 'r'
      and has_column_privilege('anon', c.oid, a.attnum, 'SELECT')
    order by 1, 2`;
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
      ('${TENANT_A}', '${SLUG_A}', 'Celus del Valle', '5492995550001'),
      ('${TENANT_B}', '${SLUG_B}', 'Neuquen Mobile', '5492995550002')`);
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

  // 3 · El schema de control negativo: acá SÍ están plantados los seis ataques que este archivo
  //     dice cazar. Cada detector se corre PRIMERO contra este schema —donde tiene que encontrar
  //     su trampa y NADA MÁS— y recién después contra `public`. Un detector que no encuentra su
  //     trampa es un detector roto, y un test con un detector roto es verde inútil.
  //
  //     Regla al agregar una trampa: sólo lleva columna `tenant_id` la que tiene que caer en el
  //     detector de R5 (`tablesWithoutRls` filtra por esa columna). Si no, se contaminan entre sí
  //     y las aserciones de control dejan de ser exactas.
  await admin.unsafe(`drop schema if exists ${CONTROL_SCHEMA} cascade`);
  await admin.unsafe(`create schema ${CONTROL_SCHEMA}`);

  // 3.a · R5 — tabla de negocio sin RLS.
  await admin.unsafe(`create table ${CONTROL_SCHEMA}.leaky_no_rls (id uuid primary key, tenant_id uuid not null)`);

  // 3.b · R6a/R6b — policy `using (true)` Y otorgada al atrapa-todo `public`. Las dos cosas en la
  //       misma trampa a propósito: cada detector tiene que encontrarla por SU motivo.
  await admin.unsafe(`create table ${CONTROL_SCHEMA}.leaky_policy (id uuid primary key, tenant_id uuid not null)`);
  await admin.unsafe(`alter table ${CONTROL_SCHEMA}.leaky_policy enable row level security`);
  await admin.unsafe(`create policy leaky_all on ${CONTROL_SCHEMA}.leaky_policy for select to public using (true)`);

  // 3.c · R6c — policy de ESCRITURA otorgada a `anon`. El qual NO es `true`: si lo fuera, no se
  //       podría distinguir "el detector de anon la encontró" de "la encontró el de using(true)".
  await admin.unsafe(`create table ${CONTROL_SCHEMA}.leaky_anon_policy (id uuid primary key, tenant_id uuid not null)`);
  await admin.unsafe(`alter table ${CONTROL_SCHEMA}.leaky_anon_policy enable row level security`);
  await admin.unsafe(
    `create policy leaky_anon_write on ${CONTROL_SCHEMA}.leaky_anon_policy for all to anon using (tenant_id is not null)`,
  );

  // 3.d · R7a — GRANT a nivel de TABLA (el ataque "se otorgó de tabla en vez de por columna").
  await admin.unsafe(`create table ${CONTROL_SCHEMA}.leaky_grant_table (id uuid primary key, imei text)`);
  await admin.unsafe(`grant select on table ${CONTROL_SCHEMA}.leaky_grant_table to anon`);

  // 3.e · R7b — GRANT de escritura a `anon`, uno de tabla y uno de columna.
  await admin.unsafe(`create table ${CONTROL_SCHEMA}.leaky_grant_write (id uuid primary key, status text)`);
  await admin.unsafe(`grant delete on table ${CONTROL_SCHEMA}.leaky_grant_write to anon`);
  await admin.unsafe(`grant insert (status) on table ${CONTROL_SCHEMA}.leaky_grant_write to anon`);

  // 3.f · R7c — columna marcada SENSITIVE y otorgada igual a `anon`, por columna. Éste es el
  //       ataque que el invariante VIEJO dejaba pasar en verde: `select id from leaky_grant_col`
  //       sigue dando 42501 mientras el costo se publica.
  await admin.unsafe(`create table ${CONTROL_SCHEMA}.leaky_grant_col (id uuid primary key, cost_usd numeric(12,2))`);
  await admin.unsafe(
    `comment on column ${CONTROL_SCHEMA}.leaky_grant_col.cost_usd is 'SENSITIVE: never in public DTO'`,
  );
  await admin.unsafe(`grant select (cost_usd) on table ${CONTROL_SCHEMA}.leaky_grant_col to anon`);

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

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // El visitante anónimo. Hasta `0001` acá había UN test: "`anon` no tiene privilegio sobre
  // listings → 42501". `0002` lo volvió falso a propósito (ver el docblock del archivo): la
  // vidriera pública ES un cliente de Postgres. Lo que sigue es el invariante que lo reemplaza,
  // y es más caro de cumplir: **la allowlist de columnas públicas, por columna, sólo SELECT, y
  // sólo las filas del slug del claim.** Cada `it` de acá abajo se pone rojo ante un ataque que
  // el test viejo dejaba pasar en verde.
  describe('el visitante anónimo de la vidriera habla SQL, pero sólo el dialecto de la vidriera', () => {
    it('CONTROL POSITIVO · con el slug de A, `anon` SÍ lee la unidad publicada de A', async () => {
      // Sin esto, todo lo de abajo sería verde por vacío: "cero filas" también es lo que devuelve
      // una policy que alguien borró, y una vidriera vacía es un incidente, no una defensa.
      const visitor = openStorefront(SLUG_A);
      try {
        const rows = await visitor.rows<{ title: string }>(`select title from listings`);
        expect(rows.map((r) => r.title)).toEqual(['iPhone 14 Pro 256 Grafito']);
      } finally {
        await visitor.close();
      }
    });

    it('la vidriera de B no ve el stock de A: el aislamiento de R1 vale también para `anon`', async () => {
      const visitor = openStorefront(SLUG_B);
      try {
        expect(await visitor.rows(`select id from listings where id = '${LISTING_A}'`)).toEqual([]);
        // y sin `where`, que es como se filtra de verdad:
        const todos = await visitor.rows<{ tenant_id: string }>(`select distinct tenant_id from listings`);
        expect(todos.map((r) => r.tenant_id)).toEqual([TENANT_B]);
      } finally {
        await visitor.close();
      }
    });

    it('un claim de `tenant_id` no le sirve a `anon`: la llave de la vidriera es el slug, y sólo el slug', async () => {
      // Éste es el heredero directo del test viejo, con el MISMO claim forjado. Un visitante que
      // se fabrica el JWT del panel (`app_metadata.tenant_id`) no abre nada: las policies `TO anon`
      // sólo miran `storefront_slug`. Ojo con la forma del fallo: son CERO FILAS, no un error.
      const visitor = openSession(claimsFor(USER_B, TENANT_B), 'anon');
      try {
        expect(await visitor.rows(`select id, slug, title from listings`)).toEqual([]);
        expect(await visitor.rows(`select id, slug from tenants`)).toEqual([]);
      } finally {
        await visitor.close();
      }
    });

    it('sin claim ninguno, `anon` lee cero filas: la vidriera falla CERRADA (el caso PostgREST)', async () => {
      // La `anon key` de Supabase vive en el browser. Un JWT firmado para `anon` no puede traer
      // `app_metadata.storefront_slug`, así que `GET /rest/v1/listings` con la clave pública
      // devuelve `[]` y `GET /rest/v1/tenants` no lista la cartera de clientes.
      const visitor = openStorefront(null);
      try {
        expect(await visitor.rows(`select id from listings`)).toEqual([]);
        expect(await visitor.rows(`select slug from tenants`)).toEqual([]);
      } finally {
        await visitor.close();
      }
    });

    it('`select *` como `anon` sigue siendo 42501: el GRANT es de COLUMNA y no de tabla', async () => {
      // Lo que caza: `GRANT SELECT ON TABLE listings TO anon`. Es el único ataque que el
      // invariante viejo también cazaba, y por eso se conserva textual.
      const visitor = openStorefront(SLUG_A);
      try {
        expect(await visitor.errorCode(`select * from listings limit 1`)).toBe('42501');
        expect(await visitor.errorCode(`select * from tenants limit 1`)).toBe('42501');
      } finally {
        await visitor.close();
      }
    });

    // Lo que caza: `GRANT SELECT (imei) ON listings TO anon`. Con el invariante viejo, este
    // ataque quedaba VERDE — `select id from listings` seguía dando 42501 con el IMEI publicado.
    // `imei_check_status*` es el resultado de la consulta a ENACOM: va en el panel, nunca afuera.
    const sensibles = [
      'imei', 'imei_check_status', 'imei_check_status_raw', 'imei_check_note', 'imei_checked_by',
      'cost_usd', 'margin_usd', 'supplier', 'internal_notes', 'created_by',
    ];

    it.each(sensibles)('`anon` pidiendo listings.%s recibe 42501, no una fila filtrada', async (col) => {
      const visitor = openStorefront(SLUG_A);
      try {
        expect(await visitor.errorCode(`select ${col} from listings limit 1`)).toBe('42501');
        // Tampoco de costado: un `order by` o un `sum()` leen la columna igual.
        expect(await visitor.errorCode(`select id from listings order by ${col}`)).toBe('42501');
      } finally {
        await visitor.close();
      }
    });

    it('`anon` no escribe: insert, update y delete son 42501 aun con el slug correcto', async () => {
      // Lo que caza: `GRANT INSERT (status) ON listings TO anon` o una policy `TO anon FOR ALL`.
      // Otro que el invariante viejo dejaba pasar: con un GRANT de escritura y sin GRANT de
      // lectura, `select id from listings` seguía dando 42501 y el test quedaba verde.
      const visitor = openStorefront(SLUG_A);
      try {
        expect(
          await visitor.errorCode(
            `insert into listings (tenant_id, slug, title, condition, price_usd)
             values ('${TENANT_A}', 'plantado', 'Equipo plantado', 'sealed', 1.00)`,
          ),
        ).toBe('42501');
        expect(await visitor.errorCode(`update listings set price_usd = 1.00`)).toBe('42501');
        expect(await visitor.errorCode(`delete from listings`)).toBe('42501');
      } finally {
        await visitor.close();
      }
    });

    it('las tablas que no son de la vidriera no existen para `anon`: ni una columna otorgada', async () => {
      const visitor = openStorefront(SLUG_A);
      try {
        for (const tabla of ['sales', 'tradein_leads', 'memberships', 'users', 'reservations']) {
          expect(await visitor.errorCode(`select 1 from ${tabla} limit 1`), tabla).toBe('42501');
        }
      } finally {
        await visitor.close();
      }
    });
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

  it('el detector de policies otorgadas al atrapa-todo `public` encuentra la trampa plantada', async () => {
    const rows = await adminRows<{ t: string }>(policiesGrantedToPublicRole(CONTROL_SCHEMA));
    expect(rows.map((r) => r.t)).toEqual(['leaky_policy.leaky_all']);
  });

  it('y NO se lleva puesta la policy `TO anon`: `public` y `anon` no son lo mismo', async () => {
    // El bug del detector viejo: `array['public','anon']` barría el rol nominado junto con el
    // atrapa-todo. Si esta aserción se pone roja, alguien volvió a meterlos en la misma bolsa y
    // R6c —que es el invariante estricto de `anon`— quedó tapado por el general.
    const rows = await adminRows<{ t: string }>(policiesGrantedToPublicRole(CONTROL_SCHEMA));
    expect(rows.map((r) => r.t)).not.toContain('leaky_anon_policy.leaky_anon_write');
  });

  it('ninguna policy de public está otorgada al pseudo-rol `public`: siempre a un rol nominado', async () => {
    const rows = await adminRows<{ t: string }>(policiesGrantedToPublicRole('public'));
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

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // R6c · el invariante propio de `anon`, que es MÁS estricto que el general de R6b y no menos:
  // las policies del rol nominado están enumeradas por nombre. Una policy `TO anon` nueva se pone
  // roja hasta que alguien la agregue acá a mano, que es exactamente la fricción que se busca.
  describe('R6c · las policies `TO anon` son las 5 de la vidriera, sólo SELECT y acotadas por el claim', () => {
    /** Las de `drizzle/0002_storefront_anon_grants.sql` §5. Ni una más. */
    const ESPERADAS = [
      'fx_settings.fx_settings_storefront_anon_select',
      'listing_photos.listing_photos_storefront_anon_select',
      'listings.listings_storefront_anon_select',
      'locations.locations_storefront_anon_select',
      'tenants.tenants_storefront_anon_select',
    ];

    it('el detector de policies `TO anon` encuentra la trampa plantada, con su comando', async () => {
      const rows = await adminRows<{ t: string; cmd: string }>(policiesForAnon(CONTROL_SCHEMA));
      expect(rows.map((r) => `${r.t}:${r.cmd}`)).toEqual(['leaky_anon_policy.leaky_anon_write:ALL']);
    });

    it('en public son EXACTAMENTE las 5 de la vidriera', async () => {
      const rows = await adminRows<{ t: string }>(policiesForAnon('public'));
      expect(rows.map((r) => r.t)).toEqual(ESPERADAS);
    });

    it('ninguna es de escritura: `anon` no tiene INSERT/UPDATE/DELETE ni por policy', async () => {
      const rows = await adminRows<{ t: string; cmd: string; with_check: string }>(policiesForAnon('public'));
      for (const row of rows) {
        expect(row.cmd, `${row.t} no es FOR SELECT`).toBe('SELECT');
        expect(row.with_check, `${row.t} tiene WITH CHECK: eso es una policy de escritura`).toBe('');
      }
    });

    it('ninguna es `using (true)` y todas acotan por el claim de la vidriera', async () => {
      // Una policy `TO anon` que no mira `storefront_slug()`/`storefront_tenant_id()` es una
      // policy que le muestra a cualquier visitante el stock de todos los tenants.
      const rows = await adminRows<{ t: string; qual: string }>(policiesForAnon('public'));
      expect(rows.length).toBe(ESPERADAS.length);
      for (const row of rows) {
        expect(row.qual.trim(), `${row.t} es RLS decorativa`).not.toBe('true');
        expect(row.qual, `${row.t} no acota por el claim del host`).toMatch(/storefront_(slug|tenant_id)/);
      }
    });
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
describe('R7 · el privilegio de `anon` es la allowlist de columnas públicas y nada más', () => {
  // El invariante viejo era "`anon` no tiene privilegio sobre ninguna tabla de negocio", y lo
  // cumplía sin esfuerzo: `0001` no le daba nada. Hoy `0002` le da algo, y por eso este describe
  // dejó de ser una afirmación de vacío y pasó a ser una afirmación de FORMA — que es la que
  // seguía en pie el día que la vidriera existió. Cada detector trae su control negativo.
  //
  // Nota de fidelidad (heredada): `scripts/pg-local.sh` no replica los `ALTER DEFAULT PRIVILEGES`
  // que Supabase deja puestos en `public`. Acá `anon` no tiene privilegio de tabla porque nunca
  // se lo dieron; en Supabase lo tiene que revocar `0001` (lint 0022 lo exige por texto). Hay que
  // re-correr esto contra el proyecto real antes de creerle del todo.

  /** El read model público de la vidriera, columna por columna: `drizzle/0002` §3.
   *  Está escrito también en `rls-anon-storefront.test.ts` §f, en otro archivo y con otro fixture,
   *  a propósito: si alguien ensancha uno para poner algo en verde, el otro queda rojo. */
  const ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
    catalog_models: ['brand', 'display_name', 'family', 'id', 'release_year', 'slug'],
    fx_settings: ['ars_per_usd', 'rounding', 'tenant_id'],
    listing_photos: [
      'alt', 'card_key', 'detail_key', 'height', 'id', 'listing_id', 'sort_order', 'tenant_id',
      'thumb_key', 'width',
    ],
    listings: [
      'battery_pct', 'catalog_model_id', 'color', 'condition', 'description', 'icloud_status_text',
      'id', 'price_usd', 'provenance_text', 'published_at', 'screen_original', 'slug', 'status',
      'storage_gb', 'tenant_id', 'title', 'warranty_text',
    ],
    locations: ['address', 'city', 'hours', 'id', 'is_active', 'name', 'sort_order', 'tenant_id'],
    tenants: ['accepts_trade_in', 'id', 'name', 'payment_methods', 'slug', 'status', 'wa_phone'],
  };

  it('el detector de GRANT de TABLA encuentra la trampa plantada', async () => {
    const rows = await adminRows<{ t: string }>(anonTableLevelSelect(CONTROL_SCHEMA));
    expect(rows.map((r) => r.t)).toEqual(['leaky_grant_table']);
  });

  it('ninguna tabla de public le da SELECT de TABLA a `anon`: el GRANT es de columna', async () => {
    // Un GRANT de tabla hace andar `select *` —y con él `imei` y `cost_usd`— sin tocar una policy.
    const rows = await adminRows<{ t: string }>(anonTableLevelSelect('public'));
    expect(rows.map((r) => r.t)).toEqual([]);
  });

  it('el detector de escritura encuentra las dos trampas: la de tabla y la de columna', async () => {
    const rows = await adminRows<{ t: string }>(anonWritePrivileges(CONTROL_SCHEMA));
    expect(rows.map((r) => r.t)).toEqual([
      'leaky_grant_write:DELETE',
      'leaky_grant_write:column:INSERT',
    ]);
  });

  it('`anon` no tiene ningún privilegio de escritura en public, ni de tabla ni de columna', async () => {
    const rows = await adminRows<{ t: string }>(anonWritePrivileges('public'));
    expect(rows.map((r) => r.t)).toEqual([]);
  });

  it('el detector de columnas SENSITIVE encuentra la trampa plantada', async () => {
    const rows = await adminRows<{ t: string }>(anonReadableSensitiveColumns(CONTROL_SCHEMA));
    expect(rows.map((r) => r.t)).toEqual(['leaky_grant_col.cost_usd']);
  });

  it('ninguna columna marcada SENSITIVE es legible por `anon` (leído del COMMENT de la base)', async () => {
    const rows = await adminRows<{ t: string }>(anonReadableSensitiveColumns('public'));
    expect(rows.map((r) => r.t)).toEqual([]);
  });

  it('el read model de `anon` es EXACTAMENTE la allowlist: ni una columna de más', async () => {
    // La aserción más ancha del archivo, y la que caza el ataque que ningún detector temático ve:
    // otorgar una columna que no es sensible pero tampoco es pública (`qty`, `kind`, `sold_at`).
    const rows = await adminRows<{ tbl: string; col: string }>(anonReadableColumns('public'));
    const real: Record<string, string[]> = {};
    for (const row of rows) (real[row.tbl] ??= []).push(row.col);
    expect(real).toEqual(ALLOWLIST);
  });

  it('CONTROL POSITIVO · la allowlist no está vacía: si lo estuviera, R7 pasaría por vacío', async () => {
    // El modo de falla clásico de este describe: la migración no aplicó, `anon` no tiene nada, y
    // todas las aserciones de "cero privilegio" quedan verdes mientras la vidriera está caída.
    const rows = await adminRows<{ tbl: string; col: string }>(anonReadableColumns('public'));
    expect(rows.length).toBe(Object.values(ALLOWLIST).reduce((n, cols) => n + cols.length, 0));
    expect(rows.length).toBeGreaterThan(40);
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
