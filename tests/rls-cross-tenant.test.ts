/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  R0–R8 · UN RESELLER NO VE, NI ESCRIBE, NI BORRA UNA FILA DE OTRO. POSTGRES REAL, CERO MOCKS.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## Por qué este archivo vive en `tests/` y no en `packages/db/src/`
 * Las policies que este archivo audita las escribe `db-agent`. Si el test viviera en su paquete,
 * el mismo writer estaría en las dos puntas del invariante más caro del producto (*"sin RLS no hay
 * merge"*): el que escribe la regla no puede ser también el que decide cuándo la regla se cumple.
 * Es la misma separación que saca un gate del directorio que audita. Un test de RLS que sólo mira
 * su propio tenant sí es del paquete y se queda allá (`packages/db/src/rls.test.ts`); éste cruza
 * dos tenants, dos conexiones y dos roles, así que es de `tests/` (`CLAUDE.md` §4, desempate de
 * FASE 4).
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
 * lee las migraciones y `packages/db/src/rls-anon-storefront.test.ts` §f lee el catálogo con la
 * allowlist de columnas **por nombre**. La allowlist está escrita dos veces, en dos archivos, a
 * propósito: si alguien la ensancha en uno para poner algo en verde, el otro sigue en rojo.
 *
 * `qa-agent` no arregla el código bajo test para poner un test en verde, y el owner del paquete no
 * edita este archivo para tapar un fallo (`CLAUDE.md` §4). Si algo de acá se pone rojo, el defecto
 * es del código hasta que se demuestre lo contrario, y se reporta al LEAD.
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
const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), '../packages/db/drizzle');
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

// ── R9 (S7 · venta manual) ──────────────────────────────────────────────────────────────────
// Fixture propio, montado en el `beforeAll` de R9 y NO acá arriba: `sales.listing_id` es
// `ON DELETE RESTRICT`, así que una venta de B colgando de `LISTING_B` desde el arranque haría
// fallar con `23503` al `delete from listings` de R4 — que es un test de aislamiento, no de FKs.
// Un fixture que rompe otro test es un fixture que se paga con un rojo que no dice nada.
const SALE_B = '00000000-0000-4000-9000-0000000000d4';
/** La venta que B intenta plantar en la cuenta de A. Nunca tiene que existir. */
const SALE_INTRUSA = '00000000-0000-4000-9000-0000000000e8';
/** El uuid de unidad que las DOS ventas de R9f comparten: es el punto entero de R9f. */
const LISTING_MISMO_UUID = '00000000-0000-4000-9000-0000000000c6';
const VENTA_PAR_A = '00000000-0000-4000-9000-0000000000c7';
const VENTA_PAR_B = '00000000-0000-4000-9000-0000000000d7';

/** El costo de la venta de B. Si este número aparece en una sesión de A, es fuga (y al revés). */
const COST_VENTA_B = '300.00';

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

/**
 * El rechazo de Postgres, entero. **El código solo no alcanza y desde S4 menos que nunca.**
 *
 * `42501` (`insufficient_privilege`) tapa dos fallas que significan cosas opuestas:
 *
 * | mensaje | qué pasó | qué significa si aparece donde no va |
 * |---|---|---|
 * | `permission denied for table …` | faltó el `GRANT` | la capa de privilegio cerró la puerta |
 * | `new row violates row-level security policy …` | el `GRANT` estaba y **la policy** rechazó la fila | la capa de RLS cerró la puerta |
 *
 * `GRANT` y RLS son **dos capas y se evalúan las dos** (`CLAUDE.md` §2). Un test que sólo mira el
 * código no puede distinguir "la policy funciona" de "todavía no otorgamos nada", y esa confusión
 * es exactamente cómo un invariante de aislamiento se vuelve verde por vacío: el día que alguien
 * agregue el `GRANT` que faltaba, el test sigue en verde y nadie evaluó nunca la policy.
 */
interface PgError {
  readonly code: string;
  readonly message: string;
}

interface Session {
  readonly rows: <T>(text: string) => Promise<T[]>;
  readonly affected: (text: string) => Promise<number>;
  readonly errorCode: (text: string) => Promise<string>;
  /** El rechazo con su mensaje. Ver {@link PgError}: la diferencia ES el invariante. */
  readonly error: (text: string) => Promise<PgError>;
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

  async function rejected(text: string): Promise<PgError> {
    try {
      await run<never>(text);
    } catch (caught) {
      const failure = caught as { code?: string; message?: string };
      return { code: failure.code ?? 'UNKNOWN_ERROR', message: failure.message ?? '' };
    }
    // Que la query pase limpia NO es un `expect` fallado: es que el test no probó lo que dice
    // probar. Se tira acá para que el fallo diga eso y no "se esperaba 42501 y llegó undefined".
    throw new Error(`se esperaba que Postgres rechazara la query y pasó limpia: ${text}`);
  }

  return {
    rows: async <T>(text: string): Promise<T[]> => (await run<T>(text)).rows,
    affected: async (text: string): Promise<number> => (await run<never>(text)).count,
    errorCode: async (text: string): Promise<string> => (await rejected(text)).code,
    error: rejected,
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

/**
 * `true`, `(true)`, ` ( TRUE ) ` — el mismo criterio textual que {@link policiesUsingTrue}, pero
 * aplicable a un predicado ya leído. Existe porque R6c mira el predicado que corresponde al
 * comando de cada policy (`using` para las de lectura, `with check` para la de INSERT) y necesita
 * el mismo juicio sobre cualquiera de los dos.
 */
function esPredicadoTrue(predicado: string): boolean {
  return /^\(*\s*true\s*\)*$/iu.test(predicado.trim());
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

/**
 * R7b-bis · las columnas, una por una, sobre las que `anon` puede ESCRIBIR.
 *
 * {@link anonWritePrivileges} contesta *"¿hay escritura de columna en esta tabla?"* y con eso
 * alcanzaba mientras la respuesta correcta era "en ninguna". Desde `drizzle/0004` la respuesta es
 * "en una", y ahí ese detector deja de ser suficiente: una columna de más en el mismo `GRANT`
 * —`id`, `created_at`, o la que se agregue el año que viene— no cambia su salida ni un carácter.
 *
 * Éste enumera. Es la diferencia entre "el beacon escribe" y "el beacon escribe exactamente
 * `tenant_id`, `listing_id` y `source`", que es lo que hace que `id` y `created_at` salgan de sus
 * defaults y **no se puedan forjar**.
 */
function anonWritableColumns(schema: string): string {
  return `
    select c.relname || '.' || a.attname || ':' || w.p as t
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    cross join lateral (
      select p from unnest(array['INSERT','UPDATE','REFERENCES']) as p
      where has_column_privilege('anon', c.oid, a.attnum, p)
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
/**
 * R2b · la única escritura SIN AUTENTICAR del producto tampoco cruza de tenant.
 *
 * R1–R4 prueban el aislamiento entre dos *resellers logueados*. Desde S4 hay un tercer escritor y
 * no tiene sesión: el visitante de la vidriera, que al tocar el botón de WhatsApp deja una fila en
 * `wa_click_events` como rol `anon`. Es el único `INSERT` del sistema donde del otro lado del cable
 * no hay nadie identificado, así que el tenant **no puede venir del body**: sale del claim que el
 * proxy derivó del host, y la policy es lo único que lo ata.
 *
 * R6c y R7 miran la FORMA de ese permiso —qué policies existen, qué columnas se otorgaron—. Este
 * bloque mira el COMPORTAMIENTO, que es otra cosa: una policy puede estar escrita, enumerada y
 * nombrada, y aun así dejar pasar la fila. Se corre contra Postgres de verdad con dos claims
 * distintos porque un mock de RLS es un test inútil.
 *
 * ── Por qué acá se afirma el MENSAJE y no sólo el `42501` ────────────────────────────────────
 * `42501` tapa dos rechazos que significan cosas **opuestas** (ver {@link PgError}):
 * `permission denied for table` es "faltó el GRANT" y `new row violates row-level security policy`
 * es "el GRANT estaba y la policy hizo su trabajo". Si acá se aceptara cualquiera de los dos, el
 * test daría verde tanto con la policy funcionando como con la migración `0004` sin aplicar —
 * o sea, daría verde midiendo nada. Esa distinción **es** el invariante, no un detalle del assert.
 */
describe('R2b · el visitante anónimo escribe su click y no puede anotarlo en la cuenta de otro', () => {
  afterAll(async () => {
    await admin.unsafe(`delete from wa_click_events where tenant_id in ('${TENANT_A}', '${TENANT_B}')`);
  });

  it('CONTROL POSITIVO · la vidriera de A SÍ puede registrar el click de su propia ficha', async () => {
    // Sin esto, los cuatro rechazos de abajo serían verdes por vacío: una tabla a la que `anon` no
    // puede escribir NADA los cumple todos, y también rompe el beacon en producción.
    const visitante = openStorefront(SLUG_A);
    try {
      const filas = await visitante.affected(
        `insert into wa_click_events (tenant_id, listing_id, source)
         values ((select public.storefront_tenant_id()), '${LISTING_A}', 'storefront_detail')`,
      );
      expect(filas, 'el beacon del click no puede escribir: la vidriera de A está muda').toBe(1);
    } finally {
      await visitante.close();
    }
  });

  it('la vidriera de B no puede anotar un click en la cuenta de A: lo frena el WITH CHECK', async () => {
    const visitante = openStorefront(SLUG_B);
    try {
      const error = await visitante.error(
        `insert into wa_click_events (tenant_id, listing_id, source)
         values ('${TENANT_A}', null, 'storefront_detail')`,
      );
      expect(error.code).toBe('42501');
      expect(
        error.message,
        'el rechazo no vino de la policy: quien frenó la fila fue otra cosa',
      ).toContain('violates row-level security policy');
      expect(
        error.message,
        'esto es "faltó el GRANT", no "la policy rechazó la fila": el aislamiento sigue sin probarse',
      ).not.toContain('permission denied');
    } finally {
      await visitante.close();
    }
  });

  it('B tampoco puede nombrar la ficha de A desde su propio tenant: la policy ata las dos puntas', async () => {
    // El `tenant_id` acá es el legítimo de B, así que la mitad fácil del `with check` pasa. Lo que
    // frena la fila es el `exists` sobre `listings`: contar clicks del equipo de otro sería medir
    // el interés que genera el stock ajeno, que es inteligencia comercial, no un contador roto.
    const visitante = openStorefront(SLUG_B);
    try {
      const error = await visitante.error(
        `insert into wa_click_events (tenant_id, listing_id, source)
         values ((select public.storefront_tenant_id()), '${LISTING_A}', 'storefront_detail')`,
      );
      expect(error.code).toBe('42501');
      expect(error.message).toContain('violates row-level security policy');
    } finally {
      await visitante.close();
    }
  });

  it('los dos rechazos no fueron un error de tipo disfrazado: en la cuenta de A quedó UNA sola fila', async () => {
    const rows = await adminRows<{ n: string }>(
      `select count(*)::text as n from wa_click_events where tenant_id = '${TENANT_A}'`,
    );
    expect(rows[0]?.n, 'la del control positivo y ninguna más').toBe('1');
  });

  it('el visitante no puede forjar el `id` ni antedatar el `created_at` de su propio click', async () => {
    // Acá el mensaje tiene que ser el OTRO: estas dos columnas no están en el `GRANT`, así que el
    // rechazo llega de la capa de privilegio y ni siquiera se evalúa la policy. Es la diferencia
    // entre `GRANT INSERT (cols)` y `GRANT INSERT`, y es la que hace que el timestamp sea de la
    // base y no del cliente.
    const visitante = openStorefront(SLUG_A);
    try {
      for (const forjada of [
        `insert into wa_click_events (id, tenant_id, source)
         values ('${INTRUDER_ROW}', (select public.storefront_tenant_id()), 'storefront_detail')`,
        `insert into wa_click_events (tenant_id, created_at, source)
         values ((select public.storefront_tenant_id()), now() - interval '30 days', 'storefront_detail')`,
      ]) {
        const error = await visitante.error(forjada);
        expect(error.code).toBe('42501');
        expect(
          error.message,
          'el rechazo vino de la policy, no del GRANT: la columna está otorgada y no debería',
        ).toContain('permission denied');
      }
    } finally {
      await visitante.close();
    }
  });

  it('el visitante escribe su click y no lee ninguno, ni siquiera los de su propia vidriera', async () => {
    // `wa_click_events` es telemetría del dueño, no contenido de la vidriera. Un `select` acá
    // convertiría el contador en un ranking público de qué se está por vender.
    const visitante = openStorefront(SLUG_A);
    try {
      for (const lectura of [
        `select count(*) from wa_click_events`,
        // Valor válido del enum a propósito: con uno inválido Postgres se cae antes con `22P02`
        // y el test mediría el parser, no el privilegio.
        `update wa_click_events set source = 'storefront_detail'`,
        `delete from wa_click_events`,
      ]) {
        const error = await visitante.error(lectura);
        expect(error.code).toBe('42501');
        expect(error.message).toContain('permission denied');
      }
    } finally {
      await visitante.close();
    }
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
  //
  // ── S4 movió la lista, no el invariante ──────────────────────────────────────────────────
  // Hasta S4 esto afirmaba "`anon` no escribe, nunca". Con `drizzle/0004_storefront_wa_click_
  // insert.sql`, `anon` gana UNA escritura: el beacon del click de WhatsApp, que es la única
  // escritura sin autenticar de todo el producto. La reacción cómoda sería relajar la aserción a
  // "casi todas son de lectura", y eso sería el final de R6c: pasaría de custodiar un invariante a
  // describir el estado actual, y la SEGUNDA escritura sin autenticar entraría sin despertar a
  // nadie. El riesgo entero del cambio es ése.
  //
  // Así que la lista se endurece en vez de aflojarse. Pasa de 5 nombres a 6 nombres **y** fija el
  // comando de cada uno. Una escritura más, o esta misma convertida en `FOR ALL`, o un UPDATE para
  // `anon`, rompen el test igual que antes. La diferencia entre "5" y "6" no es de cantidad: es
  // que el número lo escribió alguien.
  describe('R6c · las policies `TO anon` son 6: las 5 de lectura de la vidriera y el beacon del click', () => {
    /** Las de `drizzle/0002_storefront_anon_grants.sql` §5. Todas de lectura. */
    const LECTURA = [
      'fx_settings.fx_settings_storefront_anon_select',
      'listing_photos.listing_photos_storefront_anon_select',
      'listings.listings_storefront_anon_select',
      'locations.locations_storefront_anon_select',
      'tenants.tenants_storefront_anon_select',
    ];

    /** La de `drizzle/0004_storefront_wa_click_insert.sql`. **Una**, de INSERT, y ni una más. */
    const ESCRITURA = ['wa_click_events.wa_click_events_storefront_insert'];

    /** `policiesForAnon` ordena por `tabla.policy`, y `wa_click_events` va después de `tenants`. */
    const ESPERADAS = [...LECTURA, ...ESCRITURA];

    it('el detector de policies `TO anon` encuentra la trampa plantada, con su comando', async () => {
      const rows = await adminRows<{ t: string; cmd: string }>(policiesForAnon(CONTROL_SCHEMA));
      expect(rows.map((r) => `${r.t}:${r.cmd}`)).toEqual(['leaky_anon_policy.leaky_anon_write:ALL']);
    });

    it('en public son EXACTAMENTE esas 6, por nombre: una policy `TO anon` nueva rompe el test', async () => {
      const rows = await adminRows<{ t: string }>(policiesForAnon('public'));
      expect(rows.map((r) => r.t)).toEqual(ESPERADAS);
    });

    it('el comando de cada una está fijado: 5 de SELECT y UNA sola de INSERT, la del beacon', async () => {
      // Fijar el par (nombre, comando) es lo que tapa los tres cambios silenciosos que importan:
      // que una de lectura se ensanche a `FOR ALL`, que aparezca un UPDATE o un DELETE para el
      // visitante, y que la de escritura deje de ser sólo de INSERT. Ninguno de los tres cambia la
      // cantidad de policies, así que contar seis no los ve.
      const rows = await adminRows<{ t: string; cmd: string }>(policiesForAnon('public'));
      expect(rows.map((r) => `${r.t}:${r.cmd}`)).toEqual([
        ...LECTURA.map((t) => `${t}:SELECT`),
        ...ESCRITURA.map((t) => `${t}:INSERT`),
      ]);
    });

    it('las policies de lectura no tienen WITH CHECK: ahí un WITH CHECK sería escritura encubierta', async () => {
      const rows = await adminRows<{ t: string; cmd: string; with_check: string }>(
        policiesForAnon('public'),
      );
      const conCheck = rows.filter((r) => r.cmd === 'SELECT' && r.with_check.trim() !== '');
      expect(conCheck.map((r) => r.t)).toEqual([]);
    });

    it('ninguna policy de `anon` es decorativa: las 6 acotan por el claim del host', async () => {
      // ── Dónde vive el predicado depende del comando, y la diferencia NO es cosmética ──
      // Una policy de INSERT tiene `qual` **NULL por construcción**: no hay filas previas que
      // filtrar, y todo su predicado está en el `with check`. Leer `qual` para las seis reventaría
      // con un TypeError sobre null; saltear la fila nula —que es la tentación— dejaría a la única
      // escritura sin autenticar del producto **sin auditar y con el test en verde**. Una policy de
      // INSERT con `with check` nulo o `true` es exactamente el agujero que este bloque existe
      // para encontrar, así que se le exige el predicado igual que a las de lectura, en su lugar.
      const rows = await adminRows<{ t: string; cmd: string; qual: string; with_check: string }>(
        policiesForAnon('public'),
      );
      expect(rows.length, 'cambió la cantidad de policies `TO anon`').toBe(ESPERADAS.length);
      for (const row of rows) {
        const donde = row.cmd === 'INSERT' ? 'with check' : 'using';
        const predicado = (row.cmd === 'INSERT' ? row.with_check : row.qual).trim();
        expect(
          predicado,
          `${row.t} no tiene predicado en su \`${donde}\`: deja pasar cualquier fila`,
        ).not.toBe('');
        expect(
          esPredicadoTrue(predicado),
          `${row.t} es RLS decorativa: \`${donde} (true)\``,
        ).toBe(false);
        expect(predicado, `${row.t} no acota por el claim del host`).toMatch(
          /storefront_(slug|tenant_id)/,
        );
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

  /**
   * ── La escritura de `anon`, escrita como lista literal ────────────────────────────────────
   * Antes de S4 esto era `[]` y era fácil de defender. Desde `drizzle/0004` hay exactamente UNA
   * entrada, y la lista literal es lo único que separa "el beacon escribe" de "`anon` escribe".
   * Una segunda escritura sin autenticar —de la tabla que sea, del comando que sea— agrega una
   * entrada y rompe el test. Es el punto entero de mantenerlo así de duro.
   */
  const ESCRITURA_DE_ANON = ['wa_click_events:column:INSERT'];

  /**
   * Y las columnas, una por una. `anonWritePrivileges` contesta *"¿hay escritura de columna en esta
   * tabla?"*, así que una columna de más en el MISMO `GRANT` no le cambia la salida ni un carácter.
   * Estas tres son las que el handler manda; `id` y `created_at` salen de sus defaults **porque no
   * están acá**, y por eso el visitante no puede forjar el uno ni antedatar el otro.
   */
  const COLUMNAS_ESCRIBIBLES = [
    'wa_click_events.listing_id:INSERT',
    'wa_click_events.source:INSERT',
    'wa_click_events.tenant_id:INSERT',
  ];

  it('la ÚNICA escritura de `anon` en public es el INSERT de columna del beacon del click', async () => {
    const rows = await adminRows<{ t: string }>(anonWritePrivileges('public'));
    expect(
      rows.map((r) => r.t),
      'apareció una escritura sin autenticar que no es la del beacon de S4',
    ).toEqual(ESCRITURA_DE_ANON);
  });

  it('esa escritura NO es de tabla: `has_table_privilege` sobre wa_click_events sigue en false', async () => {
    // `GRANT INSERT (cols)` y `GRANT INSERT` se leen casi igual en un `.sql` y no son lo mismo: el
    // de tabla alcanza a toda columna **presente y futura**, incluidas `id` y `created_at`. Por eso
    // el privilegio de columna no confiere el de tabla, y por eso este cero es el que separa los
    // dos mundos. Corolario para quien lea esto buscando por qué su chequeo da false: preguntar por
    // `has_table_privilege('anon','wa_click_events','INSERT')` no ve el GRANT del beacon.
    const rows = await adminRows<{ t: string }>(`
      select c.relname as t
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and has_table_privilege('anon', c.oid, 'INSERT')
      order by 1`);
    expect(rows.map((r) => r.t)).toEqual([]);
  });

  it('el detector de columnas escribibles encuentra la trampa plantada', async () => {
    const rows = await adminRows<{ t: string }>(anonWritableColumns(CONTROL_SCHEMA));
    expect(rows.map((r) => r.t)).toEqual(['leaky_grant_write.status:INSERT']);
  });

  it('las columnas que `anon` puede escribir son esas tres: `id` y `created_at` no se pueden forjar', async () => {
    const rows = await adminRows<{ t: string }>(anonWritableColumns('public'));
    expect(rows.map((r) => r.t)).toEqual(COLUMNAS_ESCRIBIBLES);
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

// ═══════════════════════════════════════════════════════════════════════════════════════════
/**
 * R9 · LA VENTA MANUAL (S7). El hecho contable no cruza de tenant, y el margen lo deriva el motor.
 *
 * `sales` existe desde `0000` y tiene policies desde `0001`, pero **hasta S7 no la escribió nunca
 * código de producción**: un privilegio que nunca se ejerció es una suposición, no una garantía.
 * S7 la enciende (`apps/web/app/(app)/_lib/sales/record-sale.ts`) y con eso aparece la fila más
 * cara del producto: la única que lleva `cost_usd` **y** `margin_usd` juntos, o sea el número que
 * `CLAUDE.md` §0.9 dice que ni el propio seller del tenant puede ver. Que ese número no cruce a
 * otro reseller no es una preferencia: es el peor incidente posible de este SaaS.
 *
 * Este bloque es la **auditoría de referencia** de `sales` (`CLAUDE.md` §4, precisión de S4).
 * `packages/db/src/sales-one-sale-per-listing.test.ts` §e tiene casos cruzados como red de
 * regresión de `db-agent`, y eso está bien: la duplicación es deliberada. Lo que no puede pasar es
 * que un gate cite el test del paquete como evidencia — el writer de las policies estaría firmando
 * su propio certificado. **Si los dos divergen, gana éste.**
 *
 * Los seis invariantes, y por qué ninguno se deduce de otro:
 *   a · A lee lo suyo (control positivo). Una policy que no deja leer a NADIE cumple b, c y d.
 *   b · B no lee, no cuenta y no suma las ventas de A. El `count(*)` es su propio invariante:
 *       devolver "3" ya dice cuántos equipos vendió el competidor sin mostrar una columna.
 *   c · B no escribe en la cuenta de A. Dos capas distintas, medidas por separado.
 *   d · B no actualiza ni borra las ventas de A, ni muda las suyas al tenant de A.
 *   e · `margin_usd` no se escribe **ni siendo dueño**: es `GENERATED ALWAYS`.
 *   f · el índice único es el PAR `(tenant_id, listing_id)`, no `(listing_id)`.
 */
describe('R9 · la venta manual: el costo y el margen de un reseller no cruzan al de al lado', () => {
  /** Igual que `Session.error`, pero para la conexión de operador: R9f mide el MOTOR (un índice),
   *  no una policy, así que el insert tiene que llegar sin que RLS opine nada por el medio. */
  async function adminRechaza(text: string): Promise<PgError> {
    try {
      await admin.unsafe(text);
    } catch (caught) {
      const failure = caught as { code?: string; message?: string };
      return { code: failure.code ?? 'UNKNOWN_ERROR', message: failure.message ?? '' };
    }
    throw new Error(`se esperaba que Postgres rechazara la query y pasó limpia: ${text}`);
  }

  beforeAll(async () => {
    // B vende su propia unidad. Sin una venta de B, "B ve 1 fila y no 2" sería verde por vacío:
    // una policy que devuelve cero a todo el mundo lo cumpliría igual, con el panel roto.
    await admin.unsafe(`
      insert into sales (id, tenant_id, listing_id, price_usd, cost_usd, payment_method)
      values ('${SALE_B}', '${TENANT_B}', '${LISTING_B}', 480.00, ${COST_VENTA_B}, 'transferencia')`);
    // La unidad cuyo uuid comparten los dos tenants en R9f. Vive en A y no tiene venta todavía.
    await admin.unsafe(`
      insert into listings (id, tenant_id, slug, title, condition, price_usd, status)
      values ('${LISTING_MISMO_UUID}', '${TENANT_A}', 'iphone-15-256', 'iPhone 15 256 Negro',
              'sealed', 900.00, 'available')`);
  });

  afterAll(async () => {
    // El `or listing_id = …` no es redundancia: `sales.listing_id` es `ON DELETE RESTRICT`, así
    // que UNA venta inesperada colgando de esta unidad convierte el `delete` de abajo en un
    // `23503` y el fixture queda a medio desmontar. Lo encontró la prueba de falsificación M4
    // (`margin_usd` sin `GENERATED ALWAYS`): ahí R9e deja de rechazar y la fila entra con un `id`
    // que esta lista no conoce. Un limpiador que sólo sabe borrar lo que él mismo creó falla justo
    // el día que algo salió mal, que es el día en que hace falta.
    await admin.unsafe(
      `delete from sales
        where id in ('${SALE_B}', '${SALE_INTRUSA}', '${VENTA_PAR_A}', '${VENTA_PAR_B}')
           or listing_id = '${LISTING_MISMO_UUID}'`,
    );
    await admin.unsafe(`delete from listings where id = '${LISTING_MISMO_UUID}'`);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────
  describe('R9a · CONTROL POSITIVO: el dueño SÍ ve sus propias ventas, con costo y margen', () => {
    // La punta que se olvida. Las cuatro negativas de abajo las cumple, sin despeinarse, una tabla
    // a la que nadie puede leer — que es un producto roto con la suite en verde.
    it('A lee su venta entera: precio, costo y el margen que derivó Postgres', async () => {
      const rows = await a.rows<{ price_usd: string; cost_usd: string; margin_usd: string }>(
        `select price_usd, cost_usd, margin_usd from sales where id = '${SALE_A}'`,
      );
      expect(rows.length, 'el dueño no ve su propia venta: la policy es un candado total').toBe(1);
      expect(rows[0]?.price_usd).toBe('620.00');
      expect(rows[0]?.cost_usd).toBe(COST_A);
      expect(rows[0]?.margin_usd, 'price_usd - cost_usd, derivado por el motor').toBe('208.00');
    });

    it('y el `select *` del panel sobre sus ventas devuelve exactamente las de su tenant', async () => {
      const rows = await a.rows<{ tenant_id: string }>(`select * from sales`);
      expect(rows.map((r) => r.tenant_id)).toEqual([TENANT_A]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────
  describe('R9b · un reseller no LEE —ni cuenta, ni suma— las ventas del reseller de al lado', () => {
    it('B pide la venta de A por id y recibe cero filas, no un error', async () => {
      const rows = await b.rows<{ id: string }>(`select id from sales where id = '${SALE_A}'`);
      expect(rows).toEqual([]);
    });

    it('el `select` sin `where` sobre sales devuelve sólo el tenant propio', async () => {
      const rows = await b.rows<{ tenant_id: string }>(`select distinct tenant_id from sales`);
      expect(rows.map((r) => r.tenant_id)).toEqual([TENANT_B]);
    });

    it('un `count(*)` que devolviera el número de A ya sería fuga aunque no muestre columnas', async () => {
      // Cuántos equipos vendió el competidor este mes es inteligencia comercial. Un contador no es
      // una lectura menos peligrosa: es la misma fuga con menos bytes.
      const total = await b.rows<{ n: string }>(`select count(*)::text as n from sales`);
      expect(total[0]?.n, 'B está contando ventas que no son suyas').toBe('1');

      const deA = await b.rows<{ n: string }>(
        `select count(*)::text as n from sales where tenant_id = '${TENANT_A}'`,
      );
      expect(deA[0]?.n, 'preguntar de prepo por el tenant ajeno tampoco lo cuenta').toBe('0');
    });

    it('el costo y el margen de A no se filtran por agregación: sumar es leer', async () => {
      const rows = await b.rows<{ costo: string; margen: string }>(
        `select coalesce(sum(cost_usd), 0)::text as costo,
                coalesce(sum(margin_usd), 0)::text as margen
           from sales`,
      );
      // Lo suyo: 480 - 300 = 180. Si el costo de A entrara, esto daría 712.00 / 388.00.
      expect(rows[0]?.costo).toBe(COST_VENTA_B);
      expect(rows[0]?.margen).toBe('180.00');
    });

    it('B no confirma el costo de A ni buscándolo de prepo por su valor exacto', async () => {
      // El ataque del oráculo: no hace falta LEER la columna si se puede preguntar por ella. Con
      // 60 intentos se adivina un costo de tres cifras.
      const rows = await b.rows<{ id: string }>(`select id from sales where cost_usd = ${COST_A}`);
      expect(rows).toEqual([]);
    });

    it('B no ve al vendedor ni las notas internas de una venta de A (dato personal + margen)', async () => {
      const rows = await b.rows<{ sold_by: string }>(
        `select sold_by from sales where listing_id = '${LISTING_A}'`,
      );
      expect(rows).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────
  /**
   * R9c · los dos vectores del INSERT, medidos por separado porque son DOS cosas distintas.
   *
   * El `WITH CHECK` de la policy y la FK a `listings` pueden estar mal una sin la otra: la policy
   * mira `tenant_id` y no sabe nada de `listing_id`; la FK mira `listing_id` y no sabe nada de
   * tenants. Un test que los mezcla en un solo insert no puede decir cuál de las dos lo frenó, y
   * el día que una se caiga el test va a seguir verde porque la otra tapa el agujero.
   *
   * ── Lo que este bloque NO afirma, y está declarado a propósito ──────────────────────────────
   * Falta un tercer caso: B insertando una venta con **su propio** `tenant_id` y el `listing_id`
   * de A. Hoy la base la ACEPTA — el `with check` mira `tenant_id` (que es el suyo, legítimo) y la
   * FK es `sales.listing_id → listings(id)` **a secas, sin el tenant en el par**. No filtra datos
   * (todo join contra `listings` lo corta RLS), pero con `on delete restrict` le clava la unidad al
   * otro tenant. Está medido y reportado: es la fila **P4** del board, junto con las otras seis FKs
   * a `listings.id` sin `tenant_id`, y el LEAD la sacó del alcance de esta ola. No se escribe el
   * assert acá porque **fallaría, y fallaría por el motivo correcto**: un rojo permanente con causa
   * conocida enseña a ignorar el archivo entero, que es la única forma de perder este gate.
   */
  describe('R9c · un reseller no ESCRIBE una venta en la cuenta del reseller de al lado', () => {
    it('vector 1 · B con el tenant_id de A: lo frena la POLICY, y el mensaje lo dice', async () => {
      // La unidad es `LISTING_MISMO_UUID` y NO `LISTING_A`, y la diferencia la encontró la propia
      // prueba de falsificación de este bloque: `LISTING_A` ya tiene `SALE_A`, así que con la
      // policy aflojada a `with check (true)` este insert recibía `23505` del índice de D8 en vez
      // de entrar. O sea que el test de abajo —"la fila no quedó en la base"— quedaba VERDE con la
      // policy apagada, tapado por un índice que no tiene nada que ver con el aislamiento.
      // Con una unidad sin venta previa, lo único que puede frenar la fila es la policy.
      const error = await b.error(
        `insert into sales (id, tenant_id, listing_id, price_usd, cost_usd)
         values ('${SALE_INTRUSA}', '${TENANT_A}', '${LISTING_MISMO_UUID}', 1.00, 1.00)`,
      );
      expect(error.code).toBe('42501');
      expect(
        error.message,
        'el rechazo no vino de la policy: quien frenó la fila fue otra cosa',
      ).toContain('violates row-level security policy');
      expect(
        error.message,
        'esto es "faltó el GRANT", no "la policy rechazó la fila": el aislamiento sigue sin probarse',
      ).not.toContain('permission denied');
    });

    it('el rechazo del vector 1 no fue un unique disfrazado: la fila no quedó en la base', async () => {
      const rows = await adminRows<{ id: string }>(`select id from sales where id = '${SALE_INTRUSA}'`);
      expect(rows).toEqual([]);
    });

    it('vector 2 · la FK a `listings` no es decorativa: una unidad inventada da 23503', async () => {
      // La otra capa. Si la FK se cayera (un `drop constraint` en una migración de limpieza), una
      // venta podría apuntar a cualquier uuid del universo y `sales` dejaría de ser historia
      // contable auditable. El 42501 del vector 1 no dice nada sobre esto.
      const error = await b.error(
        `insert into sales (tenant_id, listing_id, price_usd)
         values ('${TENANT_B}', '${INTRUDER_ROW}', 1.00)`,
      );
      expect(error.code).toBe('23503');
      expect(error.message).toContain('sales_listing_id_listings_id_fk');
    });

    it('B tampoco puede registrar la venta de A pasando por la unidad de A y su propio tenant fake', async () => {
      // El claim forjado, otra vez: `user_metadata` lo escribe el propio usuario (`CLAUDE.md` §2).
      // Si la policy de `sales` lo mirara, cualquiera se anotaría ventas —y margen— en el tenant
      // ajeno editando su perfil.
      const forjada = openSession({
        sub: USER_B,
        role: 'authenticated',
        app_metadata: { tenant_id: TENANT_B },
        ...{ user_metadata: { tenant_id: TENANT_A } },
      } as Claims);
      try {
        const error = await forjada.error(
          `insert into sales (id, tenant_id, listing_id, price_usd)
           values ('${SALE_INTRUSA}', '${TENANT_A}', '${LISTING_A}', 1.00)`,
        );
        expect(error.code).toBe('42501');
        expect(error.message).toContain('violates row-level security policy');
      } finally {
        await forjada.close();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────
  describe('R9d · un reseller no MODIFICA ni BORRA las ventas del reseller de al lado', () => {
    it('B bajándole el precio a la venta de A afecta 0 filas, y el precio queda intacto', async () => {
      expect(await b.affected(`update sales set price_usd = 1.00 where id = '${SALE_A}'`)).toBe(0);
      const rows = await adminRows<{ price_usd: string }>(`select price_usd from sales where id = '${SALE_A}'`);
      expect(rows[0]?.price_usd).toBe('620.00');
    });

    it('el `update sales` masivo sin where —el accidente de las 3am— toca sólo lo propio', async () => {
      expect(await b.affected(`update sales set payment_method = 'efectivo'`)).toBe(1);
      const rows = await adminRows<{ payment_method: string }>(
        `select payment_method from sales where id = '${SALE_A}'`,
      );
      expect(rows[0]?.payment_method, 'B pisó el medio de pago de una venta de A').toBe(null);
    });

    it('B no puede reescribir el costo de A: pisar el margen ajeno también es tocar el margen', async () => {
      // Un `update` que afecta 0 filas es la respuesta correcta. Si afectara 1, B estaría
      // falsificando la contabilidad de A sin haber leído nunca una fila suya.
      expect(await b.affected(`update sales set cost_usd = 1.00 where id = '${SALE_A}'`)).toBe(0);
      const rows = await adminRows<{ margin_usd: string }>(`select margin_usd from sales where id = '${SALE_A}'`);
      expect(rows[0]?.margin_usd).toBe('208.00');
    });

    it('B borrando la venta de A afecta 0 filas, y el `delete` sin where sólo se lleva la suya', async () => {
      expect(await b.affected(`delete from sales where id = '${SALE_A}'`)).toBe(0);
      const rows = await adminRows<{ n: string }>(
        `select count(*)::text as n from sales where tenant_id = '${TENANT_A}'`,
      );
      expect(rows[0]?.n).toBe('1');
    });

    it('B no puede MUDAR su propia venta al tenant de A: el `with check` del update ata las dos puntas', async () => {
      // El `using` deja pasar la fila (es de B) y el `with check` mira la fila NUEVA. Sin el
      // segundo, un tenant plantaría filas en la cuenta ajena sin un solo INSERT.
      const error = await b.error(`update sales set tenant_id = '${TENANT_A}' where id = '${SALE_B}'`);
      expect(error.code).toBe('42501');
      expect(error.message).toContain('violates row-level security policy');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────
  /**
   * R9e · `margin_usd` la deriva el motor y NADIE la escribe, ni el dueño del tenant.
   *
   * Por qué vale escribirlo: `record-sale.ts` no nombra la columna, así que hoy nada la escribe
   * **por convención**. El día que alguien la pase a `GENERATED BY DEFAULT` para "arreglar" un
   * import o un backfill, el margen deja de ser una consecuencia del costo y pasa a ser un número
   * que viaja en un request — y no hay ningún otro test del repo que se ponga rojo por eso. Es una
   * afirmación sobre lo que Postgres RECHAZA, y esas son justamente las que nadie escribe.
   */
  describe('R9e · el margen es una consecuencia del costo, no un valor que alguien manda', () => {
    it('ni el dueño del tenant puede nombrar margin_usd en un INSERT: Postgres da 428C9', async () => {
      const error = await a.error(
        `insert into sales (tenant_id, listing_id, price_usd, cost_usd, margin_usd)
         values ('${TENANT_A}', '${LISTING_MISMO_UUID}', 900.00, 400.00, 500.00)`,
      );
      expect(error.code, 'margin_usd dejó de ser GENERATED ALWAYS: el margen ahora se manda').toBe('428C9');
      expect(error.message).toContain('margin_usd');
    });

    it('ni en un UPDATE: la columna sólo se puede llevar a DEFAULT, o sea a lo que el motor derive', async () => {
      const error = await a.error(`update sales set margin_usd = 1.00 where id = '${SALE_A}'`);
      expect(error.code).toBe('428C9');
      expect(error.message).toContain('margin_usd');
    });

    it('y el margen sigue al costo solo: cambiar cost_usd lo recalcula sin que nadie lo escriba', async () => {
      // El control positivo de los dos rechazos de arriba. Sin esto, una columna que simplemente
      // no existiera —o que fuera NULL siempre— también daría error al nombrarla, y las dos
      // negativas quedarían verdes sobre una tabla que no deriva nada.
      expect(await a.affected(`update sales set cost_usd = 500.00 where id = '${SALE_A}'`)).toBe(1);
      const cambiado = await a.rows<{ margin_usd: string }>(
        `select margin_usd from sales where id = '${SALE_A}'`,
      );
      expect(cambiado[0]?.margin_usd, '620.00 - 500.00').toBe('120.00');

      expect(await a.affected(`update sales set cost_usd = ${COST_A} where id = '${SALE_A}'`)).toBe(1);
      const vuelto = await a.rows<{ margin_usd: string }>(`select margin_usd from sales where id = '${SALE_A}'`);
      expect(vuelto[0]?.margin_usd).toBe('208.00');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────
  /**
   * R9f · el índice único de D8 es el PAR `(tenant_id, listing_id)`, y el par es el invariante.
   *
   * `(listing_id)` a secas parece la afirmación más fuerte —"una unidad se vende una sola vez en
   * todo el sistema"— y es la que alguien va a proponer el día que "simplifique" el índice: los
   * uuid son únicos, ¿para qué el tenant? Para esto: un único GLOBAL convierte al índice en un
   * **oráculo cruzado**. El `23505` del motor se evalúa ANTES que cualquier policy de lectura, así
   * que un tenant que consigue el uuid de una unidad ajena distinguiría "ya vendida" de "no
   * vendida" por el error que recibe, sin haber leído una fila y sin que RLS se entere.
   *
   * Se mide con la conexión de operador y no con dos sesiones: acá el sujeto es **el motor**, no
   * una policy. Que B pueda o no llegar a referenciar el `listing_id` de A desde su sesión es otra
   * pregunta, es P4, y está fuera del alcance de esta ola (ver R9c).
   */
  describe('R9f · dos resellers pueden tener una venta cada uno sobre el mismo uuid de unidad', () => {
    it('la primera venta del par (tenant A, unidad) entra sin chistar', async () => {
      await admin.unsafe(
        `insert into sales (id, tenant_id, listing_id, price_usd, cost_usd)
         values ('${VENTA_PAR_A}', '${TENANT_A}', '${LISTING_MISMO_UUID}', 900.00, 600.00)`,
      );
      const rows = await adminRows<{ n: string }>(
        `select count(*)::text as n from sales where id = '${VENTA_PAR_A}'`,
      );
      expect(rows[0]?.n).toBe('1');
    });

    it('el MISMO listing_id en OTRO tenant también entra: no hay oráculo cruzado', async () => {
      await admin.unsafe(
        `insert into sales (id, tenant_id, listing_id, price_usd, cost_usd)
         values ('${VENTA_PAR_B}', '${TENANT_B}', '${LISTING_MISMO_UUID}', 850.00, 550.00)`,
      );
      const rows = await adminRows<{ tenant_id: string }>(
        `select tenant_id from sales where listing_id = '${LISTING_MISMO_UUID}' order by tenant_id`,
      );
      expect(
        rows.map((r) => r.tenant_id),
        'el índice es (listing_id) solo: un 23505 le revela a un tenant que la unidad ajena se vendió',
      ).toEqual([TENANT_A, TENANT_B]);
    });

    it('y la SEGUNDA venta del mismo par sí choca: D8 la frena el motor, con el índice por nombre', async () => {
      const error = await adminRechaza(
        `insert into sales (tenant_id, listing_id, price_usd)
         values ('${TENANT_A}', '${LISTING_MISMO_UUID}', 10.00)`,
      );
      expect(error.code).toBe('23505');
      expect(error.message).toContain('sales_one_sale_per_listing');
    });

    it('en el catálogo, los únicos índices ÚNICOS de sales son la PK y el par de D8', async () => {
      // La aserción ancha: un `unique index` nuevo sobre `(listing_id)` restauraría el oráculo sin
      // tocar `sales_one_sale_per_listing`, así que los tres tests de arriba seguirían verdes.
      const rows = await adminRows<{ idx: string; cols: string }>(`
        select c.relname as idx,
               (select string_agg(a.attname, ',' order by k.ord)
                  from unnest(i.indkey) with ordinality as k(attnum, ord)
                  join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum) as cols
        from pg_index i
        join pg_class c on c.oid = i.indexrelid
        where i.indrelid = 'public.sales'::regclass and i.indisunique
        order by 1`);
      expect(rows).toEqual([
        { idx: 'sales_one_sale_per_listing', cols: 'tenant_id,listing_id' },
        { idx: 'sales_pkey', cols: 'id' },
      ]);
    });
  });
});
