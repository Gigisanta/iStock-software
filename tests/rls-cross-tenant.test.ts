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
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  S8 · LA SEGUNDA ESCRITURA SIN AUTENTICAR, Y POR QUÉ EL CONTEO SE PARTIÓ EN DOS
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `drizzle/0008_storefront_tradein_lead_insert.sql` le da a `anon` un `INSERT` de nueve columnas
 * sobre `tradein_leads`: el lead de canje que el visitante deja desde la vidriera. Es la **segunda**
 * escritura sin login del producto —la primera es el beacon de S4— y la **primera con texto libre
 * y PII de un tercero** adentro. Tres cosas cambiaron acá por eso, y ninguna es un aflojamiento:
 *
 *   1. R6c dejó de contar "policies `TO anon`" en un solo entero. En un entero, "6 → 7" no
 *      distingue *"se publicó una tabla más"* de *"se le dio una lapicera a cualquiera con
 *      `curl`"*. Ahora son dos superficies —5 de LECTURA, 2 de ESCRITURA— y se afirman aparte,
 *      más una tercera aserción que dice que **no hay** una tercera superficie (`FOR ALL`, UPDATE,
 *      DELETE), que es lo que se colaría entre las dos listas sin cambiar ninguna.
 *   2. R7 enumera 12 columnas escribibles en vez de 3, y suma un detector nuevo (R7c-bis): de las
 *      columnas marcadas `SENSITIVE`, `anon` escribe **sólo la PII del propio visitante** y ni una
 *      del dueño. `offer_usd` es el costo de la unidad que nace del canje; que la escriba un `curl`
 *      es escribir el costo del stock ajeno desde afuera, y era una pregunta que ningún detector de
 *      este archivo hacía (los de escritura no miran la marca, el de la marca sólo miraba lectura).
 *   3. R2c es nuevo y es la **auditoría de referencia** del canje: comportamiento contra Postgres
 *      real, con las tres capas de rechazo (GRANT / POLICY / CHECK) afirmadas por separado y el rol
 *      efectivo probado en cada caso ({@link Veredicto}).
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
/**
 * El tercer tenant existe desde `0009` y su única razón de ser es **separar dos rechazos que
 * Postgres cuenta con la misma frase** (ver R2c-g). Está `suspended` y con el canje PRENDIDO: es
 * el único estado en el que el canje rebota sin que la bandera tenga nada que ver.
 *
 * No tiene usuario, ni membership, ni unidades: nada de lo que se le pregunta necesita una sesión
 * autenticada, y un fixture que monta de más es un fixture que rompe otro test (ver `SALE_B`).
 */
const TENANT_C = '00000000-0000-4000-9000-0000000000e1';
const USER_A = '00000000-0000-4000-9000-0000000000c2';
const USER_B = '00000000-0000-4000-9000-0000000000d2';
const LISTING_A = '00000000-0000-4000-9000-0000000000c3';
const LISTING_B = '00000000-0000-4000-9000-0000000000d3';
/**
 * La unidad publicada del tenant suspendido. Existe para que *"su vidriera está apagada"* sea una
 * afirmación y no un vacío: sin stock cargado, "cero unidades servidas" también es lo que devuelve
 * una base donde nadie publicó nada, y el test daría verde con la policy de `tenants` borrada.
 */
const LISTING_C = '00000000-0000-4000-9000-0000000000e3';
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
/** El uuid de unidad que R9f usa para probar la unicidad y el tenant de la FK compuesta. */
const LISTING_MISMO_UUID = '00000000-0000-4000-9000-0000000000c6';
const VENTA_PAR_A = '00000000-0000-4000-9000-0000000000c7';
const VENTA_PAR_B = '00000000-0000-4000-9000-0000000000d7';

/** El costo de la venta de B. Si este número aparece en una sesión de A, es fuga (y al revés). */
const COST_VENTA_B = '300.00';

/** Los slugs del host: `{slug}.maat.work`. Son el claim de la vidriera anónima (`0002`). */
const SLUG_A = 'qa-rls-a';
const SLUG_B = 'qa-rls-b';
/** El slug del tenant suspendido. Existe en la tabla y aun así no resuelve: ver R2c-g. */
const SLUG_C = 'qa-rls-c';

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

/**
 * El resultado de una query **junto con el rol que efectivamente la corrió**.
 *
 * ── Por qué el canario no es adorno (S8, y ya se cobró una medición) ─────────────────────────
 * `set local role` sólo tiene efecto DENTRO de un bloque de transacción: emitido fuera de uno,
 * Postgres lo acepta, no avisa nada y no hace nada. Una primera versión de la medición de R2c
 * corrió el `set local` afuera y los nueve casos "pasaron" **como superusuario** — que bypassea
 * `GRANT` y RLS a la vez, o sea nueve verdes que no probaron ni una policy. Que eso no vuelva a
 * pasar no puede depender de leer con cuidado: cada caso afirma, **desde la misma transacción que
 * corrió la query**, quién la corrió.
 *
 * Y el rechazo viaja como DATO, no como excepción, porque `42501` tapa dos capas que significan
 * cosas opuestas (ver {@link PgError}) y una tercera —`23514`— que ni siquiera es de seguridad.
 * Ver {@link capaQueRechazo}.
 */
interface Veredicto<T> {
  /** `current_user`, leído dentro de la transacción y ANTES de la query: un rechazo la aborta. */
  readonly rol: string;
  /** `request.jwt.claims` tal como lo vio la query. Vacío = el claim del host no llegó. */
  readonly claimsEfectivos: string;
  readonly rows: T[];
  readonly count: number;
  /** `null` si la query pasó limpia. */
  readonly error: PgError | null;
}

interface Session {
  readonly rows: <T>(text: string) => Promise<T[]>;
  readonly affected: (text: string) => Promise<number>;
  readonly errorCode: (text: string) => Promise<string>;
  /** El rechazo con su mensaje. Ver {@link PgError}: la diferencia ES el invariante. */
  readonly error: (text: string) => Promise<PgError>;
  /** La query + el rol que la corrió + de qué capa vino el rechazo. Ver {@link Veredicto}. */
  readonly conCanario: <T>(text: string) => Promise<Veredicto<T>>;
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

  /**
   * Corre `text` con el canario puesto y **sin tirar**: el rechazo vuelve como dato para que el
   * test pueda afirmar de QUÉ capa vino.
   *
   * La query va adentro de un `savepoint` y eso no es cosmético: postgres.js recuerda el primer
   * error de cualquier query del scope de la transacción y lo **re-tira al cerrar**, aunque el
   * llamador lo haya atrapado (`node_modules/postgres/src/index.js`, `uncaughtError`). Sin el
   * subscope, atrapar el `42501` acá adentro no sirve de nada y `conCanario` explota igual.
   */
  async function conCanario<T>(text: string): Promise<Veredicto<T>> {
    return (await sql.begin(async (tx) => {
      await tx.unsafe(`set local role ${role}`);
      await tx.unsafe(`select set_config('request.jwt.claims', $1, true)`, [claimsJson]);
      const canario = (await tx.unsafe(
        `select current_user as rol,
                coalesce(current_setting('request.jwt.claims', true), '') as claims`,
      )) as unknown as Array<{ rol: string; claims: string }>;
      const visto = { rol: canario[0]?.rol ?? '', claimsEfectivos: canario[0]?.claims ?? '' };
      try {
        const result = (await tx.savepoint(async (sp) => sp.unsafe(text))) as unknown as {
          count: number;
        };
        return { ...visto, rows: result as unknown as T[], count: result.count, error: null };
      } catch (caught) {
        const failure = caught as { code?: string; message?: string };
        return {
          ...visto,
          rows: [] as T[],
          count: 0,
          error: { code: failure.code ?? 'UNKNOWN_ERROR', message: failure.message ?? '' },
        };
      }
    })) as unknown as Veredicto<T>;
  }

  return {
    rows: async <T>(text: string): Promise<T[]> => (await run<T>(text)).rows,
    affected: async (text: string): Promise<number> => (await run<never>(text)).count,
    errorCode: async (text: string): Promise<string> => (await rejected(text)).code,
    error: rejected,
    conCanario,
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

/**
 * ── Las TRES capas que pueden frenar una fila, y por qué se nombran por separado ─────────────
 *
 * | veredicto | qué lo produce                                  | qué defensa quedó demostrada |
 * |---|---|---|
 * | `GRANT`   | `permission denied for table …` (`42501`)       | la columna no está otorgada  |
 * | `POLICY`  | `new row violates row-level security …` (`42501`)| el `WITH CHECK` de RLS       |
 * | `CHECK`   | `23514`                                         | tamaño/rango en el motor     |
 * | `ENTRA`   | ningún error                                    | ninguna: la fila pasó        |
 *
 * Un test que sólo afirma *"tiró error"* pasa igual con dos de las tres apagadas, y ése es
 * exactamente el bug que `CLAUDE.md` §2 nombra dos veces: `GRANT` y RLS son **dos capas y se
 * evalúan las dos**. Concreto: si mañana el `GRANT INSERT (9 columnas)` de `drizzle/0008` se
 * ensanchara a un `GRANT INSERT` de tabla, `offer_usd` pasaría a ser escribible desde un `curl`
 * — y un test que sólo mirara el código seguiría verde, porque el `23514` de `battery_pct` sigue
 * saliendo cuando corresponde. Nombrar la capa es lo que separa las tres.
 *
 * El caso `OTRA_CAPA` existe para que un rechazo inesperado (`23502` de NOT NULL, `22P02` de un
 * enum mal escrito, `23503` de una FK) no se disfrace de defensa: aparece con su código en el
 * mensaje del `expect` en vez de contarse como una de las tres.
 */
function capaQueRechazo(error: PgError | null): string {
  if (error === null) return 'ENTRA';
  if (error.code === '23514') return 'CHECK';
  if (error.code === '42501' && error.message.includes('permission denied')) return 'GRANT';
  if (error.code === '42501' && error.message.includes('violates row-level security policy')) {
    return 'POLICY';
  }
  return `OTRA_CAPA(${error.code}): ${error.message}`;
}

/**
 * Corre `text` y devuelve **qué capa lo frenó**, después de exigir que el rol efectivo sea el que
 * el test dice estar probando. Todo caso de R2c pasa por acá: ver {@link Veredicto} para por qué
 * el canario no se puede saltear ni "una sola vez, para este caso que es obvio".
 */
async function veredicto(
  sesion: Session,
  rolEsperado: PgRole,
  text: string,
): Promise<{ capa: string; filas: number }> {
  const visto = await sesion.conCanario<never>(text);
  expect(
    visto.rol,
    'el `set local role` no tuvo efecto: esta medición corrió con otro rol y no probó nada',
  ).toBe(rolEsperado);
  return { capa: capaQueRechazo(visto.error), filas: visto.count };
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

/**
 * R7c-bis · columnas marcadas `SENSITIVE` que `anon` puede **ESCRIBIR**.
 *
 * {@link anonReadableSensitiveColumns} pregunta por `SELECT`, y con eso alcanzaba mientras `anon`
 * no escribía nada. Desde `drizzle/0008` escribe dos columnas marcadas `SENSITIVE` —
 * `customer_name` y `customer_wa_phone`— y eso es **correcto**: son la PII del propio visitante,
 * que él mismo tipea en el formulario de canje. La marca ahí significa *"no sale a la vidriera, ni
 * al chatbot, ni a un log"*, no *"nadie la escribe"*.
 *
 * Lo que no puede pasar es que `anon` escriba una columna `SENSITIVE` **del dueño**: `offer_usd`
 * es lo que el reseller ofrece pagar, o sea el **costo** de la unidad que nace del canje
 * (`CLAUDE.md` §0.9), e `internal_notes` son sus notas. Que el visitante las escriba es escribir
 * el costo del stock ajeno desde afuera, y era una pregunta que ningún detector de este archivo
 * hacía: los de escritura no miran la marca y el de la marca sólo mira lectura.
 */
function anonWritableSensitiveColumns(schema: string): string {
  return `
    select c.relname || '.' || a.attname || ':' || w.p as t
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    cross join lateral (
      select p from unnest(array['INSERT','UPDATE']) as p
      where has_column_privilege('anon', c.oid, a.attnum, p)
    ) w(p)
    where n.nspname = '${schema}' and c.relkind = 'r'
      and col_description(c.oid, a.attnum) like 'SENSITIVE:%'
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
  await admin.unsafe(
    `delete from listings where tenant_id in ('${TENANT_A}', '${TENANT_B}', '${TENANT_C}')`,
  );
  await admin.unsafe(`delete from tenants where id in ('${TENANT_A}', '${TENANT_B}', '${TENANT_C}')`);
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
  // Los tres estados del canje se montan **acá y no dentro de un test**, y ninguno se toca después:
  // la bandera y el `status` son entrada del fixture, no algo que un caso prende y apaga. Un test
  // que muta el tenant deja al siguiente midiendo otra base, y el síntoma sería intermitencia.
  //
  //   A · `active`    + canje ON   → el canje entra. Es el control positivo de todo R2c.
  //   B · `active`    + canje OFF  → vidriera viva, canje cerrado. Es la decisión del dueño.
  //   C · `suspended` + canje ON   → no resuelve el claim: la vidriera entera está apagada.
  //
  // B y C existen separados porque desde `0009` el canje rebota por DOS motivos distintos que
  // Postgres cuenta con la misma frase. Ver R2c-g: sin los dos, "rebotó" no dice cuál de los dos.
  await admin.unsafe(`
    insert into tenants (id, slug, name, wa_phone, accepts_trade_in, status) values
      ('${TENANT_A}', '${SLUG_A}', 'Celus del Valle', '5492995550001', true,  'active'),
      ('${TENANT_B}', '${SLUG_B}', 'Neuquen Mobile', '5492995550002', false, 'active'),
      ('${TENANT_C}', '${SLUG_C}', 'Roca Celulares', '5492995550003', true,  'suspended')`);
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
    insert into listings (id, tenant_id, slug, title, condition, price_usd, status)
    values ('${LISTING_C}', '${TENANT_C}', 'iphone-12-64', 'iPhone 12 64 Verde',
            'used_excellent', 390.00, 'available')`);
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
  // …y la MISMA columna marcada `SENSITIVE`, que es la trampa de R7c-bis (S8): una columna del
  // dueño que `anon` igual puede escribir. Se reusa `status` en vez de plantar otra tabla porque
  // acá `anon` tiene INSERT y NO tiene SELECT, así que la marca no contamina el control de R7c
  // —que pregunta por lectura— y las dos aserciones siguen siendo exactas.
  await admin.unsafe(
    `comment on column ${CONTROL_SCHEMA}.leaky_grant_write.status is 'SENSITIVE: never in public DTO'`,
  );

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

  it('el costo de A no se puede consultar ni por agregación (columna SENSITIVE)', async () => {
    const failure = await b.error(`select coalesce(sum(cost_usd), 0)::text as total from listings`);
    expect(failure.code).toBe('42501');
    expect(failure.message).toContain('permission denied');
  });

  it('el IMEI de A no aparece en la sesión de B ni buscándolo de prepo', async () => {
    const failure = await b.error(`select imei from listings where imei = '${IMEI_A}'`);
    expect(failure.code).toBe('42501');
    expect(failure.message).toContain('permission denied');
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
/**
 * R2c · EL LEAD DE CANJE. Segunda escritura sin autenticar del producto, primera con PII adentro.
 *
 * ── Qué es este bloque, formalmente ─────────────────────────────────────────────────────────
 * Es la **auditoría de referencia** del canje anónimo (`CLAUDE.md` §4, precisión de S4): la
 * afirmación que un gate cita y que queda parada entre una policy aflojada y un merge.
 * `packages/db/src/rls-anon-tradein-lead.test.ts` mira el mismo territorio y está bien que exista,
 * pero es **red de regresión de `db-agent`**: ningún gate lo cita como evidencia, porque el writer
 * de la policy no puede firmar el certificado de su propia policy. Si los dos divergen, gana éste
 * y el que se corrige es el del paquete. La duplicación es deliberada y se paga con dos archivos
 * que tocar cuando cambia la policy.
 *
 * ── Qué mide, y qué NO ──────────────────────────────────────────────────────────────────────
 * R6c y R7 miran la **forma** del permiso: qué policies existen, qué columnas se otorgaron. Acá se
 * mide el **comportamiento**, que es otra cosa: una policy puede estar escrita, enumerada y
 * nombrada y aun así dejar pasar la fila. Postgres real, dos claims distintos, cero mocks — un
 * mock de RLS prueba que el mock funciona.
 *
 * ── Las tres capas se afirman por separado, y ése ES el invariante ──────────────────────────
 * Ver {@link capaQueRechazo}. `permission denied` (GRANT), `violates row-level security policy`
 * (POLICY) y `23514` (CHECK) son tres defensas independientes; un test que sólo afirma "tiró
 * error" da verde con dos de las tres apagadas. Cada `it` de acá abajo nombra la suya.
 *
 * ── El canario ──────────────────────────────────────────────────────────────────────────────
 * Ver {@link Veredicto}: `set local role` fuera de un bloque de transacción es un no-op mudo, y la
 * conexión de desarrollo es superusuaria. Ya hubo una versión de esta medición donde los nueve
 * casos "pasaron" sin probar nada. Todo caso pasa por {@link veredicto}, que exige el rol efectivo
 * leído de la misma transacción.
 *
 * ── El `WITH CHECK` tiene DOS mitades desde `0009`, y se auditan por separado ───────────────
 * `0008` ataba la fila al tenant del claim. `0009` le agregó `and exists (… t.accepts_trade_in)`,
 * o sea una segunda condición que puede rechazar la MISMA fila por un motivo completamente
 * distinto y con la misma frase de error. R2c a–f mide la primera mitad (el tenant, con el canje
 * prendido); **R2c-g mide la segunda** y, sobre todo, las separa: ver su docblock.
 *
 * Fuente de verdad de lo que se afirma: `packages/db/drizzle/0008_storefront_tradein_lead_insert.sql`
 * y `packages/db/drizzle/0009_tradein_accepts_and_acquisition_channel.sql`.
 */
describe('R2c · el visitante deja su canje en la vidriera de A y no toca nada más de la base', () => {
  /**
   * El canje mínimo válido, con los campos opcionales sobreescribibles por nombre. Se arma así y
   * no con `f`-strings sueltas para que los bordes de los CHECK cambien **una** columna por vez:
   * un insert que cambia dos cosas a la vez no dice cuál de las dos lo frenó.
   */
  function canje(
    campos: Readonly<Record<string, string>> = {},
    tenant = '(select public.storefront_tenant_id())',
  ): string {
    const cols: Record<string, string> = {
      tenant_id: tenant,
      customer_name: `'Marcela Quiroga'`,
      customer_wa_phone: `'5492995558888'`,
      model_text: `'iPhone 11 64'`,
      ...campos,
    };
    return `insert into tradein_leads (${Object.keys(cols).join(', ')})
            values (${Object.values(cols).join(', ')})`;
  }

  /** Todo lo que este bloque escriba se borra acá. `LEAD_A` es del fixture del archivo y no se toca. */
  afterAll(async () => {
    await admin.unsafe(
      `delete from tradein_leads
       where tenant_id in ('${TENANT_A}', '${TENANT_B}', '${TENANT_C}') and id <> '${LEAD_A}'`,
    );
  });

  // ── a · el camino feliz, que es el control positivo de todo lo demás ──────────────────────
  it('CONTROL POSITIVO · el visitante de la vidriera de A deja su canje, y lo escribe el rol `anon`', async () => {
    // Sin esto, los rechazos de abajo serían verdes por vacío: una tabla a la que `anon` no puede
    // escribir NADA los cumple todos, y también deja el formulario de canje muerto en producción.
    const visitante = openStorefront(SLUG_A);
    try {
      const visto = await visitante.conCanario<never>(canje());
      expect(visto.rol, 'no corrió como `anon`: no se probó ni una policy').toBe('anon');
      expect(visto.claimsEfectivos, 'el claim del host no llegó a la sesión').toContain(SLUG_A);
      expect(
        capaQueRechazo(visto.error),
        'el canje del visitante no entra: el formulario de la vidriera está muerto',
      ).toBe('ENTRA');
      expect(visto.count).toBe(1);
    } finally {
      await visitante.close();
    }
  });

  it('el canje entra en `new` y sin oferta: el visitante no elige su estado ni se pone precio solo', async () => {
    // Las columnas que quedaron FUERA del `GRANT` no desaparecen: toman su default. Que
    // `status = 'new'` sea el default es lo que hace que sacarla del privilegio sea suficiente —
    // si el default fuera otro, el visitante elegiría su estado sin nombrar la columna.
    const rows = await adminRows<{
      status: string;
      offer_usd: string | null;
      internal_notes: string | null;
      reciente: boolean;
    }>(`select status, offer_usd, internal_notes, (created_at > now() - interval '5 minutes') as reciente
        from tradein_leads where tenant_id = '${TENANT_A}' and id <> '${LEAD_A}'`);
    expect(rows.length, 'el control positivo dejó una fila y sólo una').toBe(1);
    expect(rows[0]).toEqual({ status: 'new', offer_usd: null, internal_notes: null, reciente: true });
  });

  // ── b · el aislamiento: la capa POLICY ────────────────────────────────────────────────────
  it('un `tenant_id` de B metido en el body cae en la vidriera de A: lo frena la POLICY', async () => {
    // El tenant sale del claim que `proxy.ts` derivó del host, JAMÁS del body. Si esto entrara,
    // un `curl` le llenaría el inbox de canje a cualquier reseller del sistema.
    const visitante = openStorefront(SLUG_A);
    try {
      const { capa, filas } = await veredicto(visitante, 'anon', canje({}, `'${TENANT_B}'`));
      expect(capa, 'no lo frenó el `WITH CHECK`: el aislamiento del canje no está probado').toBe('POLICY');
      expect(filas).toBe(0);
    } finally {
      await visitante.close();
    }
  });

  it('sin el claim del host el canje no entra a ningún lado: la vidriera falla CERRADO', async () => {
    // `storefront_tenant_id()` devuelve NULL sin claim, la comparación da NULL y el insert rebota.
    // Las tres formas de intentarlo —la función, el tenant literal y el NULL explícito— tienen que
    // rebotar por el MISMO motivo: si alguna diera `23502` (NOT NULL), la que estaría frenando la
    // fila sería la forma de la tabla y no la policy, y el día que la columna acepte NULL se abre.
    const sinClaim = openStorefront(null);
    try {
      for (const intento of [canje(), canje({}, `'${TENANT_A}'`), canje({}, 'null')]) {
        const { capa } = await veredicto(sinClaim, 'anon', intento);
        expect(capa, `sin claim, este insert no lo frenó la policy: ${intento}`).toBe('POLICY');
      }
    } finally {
      await sinClaim.close();
    }
  });

  // ── c · lo que el visitante no puede NOMBRAR: la capa GRANT ───────────────────────────────
  it('el visitante no se pone precio a sí mismo: nombrar `offer_usd` lo frena el GRANT', async () => {
    // `offer_usd` es lo que el reseller ofrece pagar por el equipo, o sea el COSTO de la unidad que
    // va a nacer de este canje (`CLAUDE.md` §9). Que lo escriba el visitante es escribir el costo
    // del stock ajeno desde afuera. Y el rechazo tiene que ser de la capa GRANT: si viniera de la
    // policy, querría decir que la columna está otorgada y lo único que la salva es el tenant.
    const visitante = openStorefront(SLUG_A);
    try {
      const { capa } = await veredicto(visitante, 'anon', canje({ offer_usd: '1.00' }));
      expect(capa, '`offer_usd` está otorgada a `anon`: el costo se escribe desde la vidriera').toBe('GRANT');
    } finally {
      await visitante.close();
    }
  });

  it('un `curl` no deja su propio canje en `accepted`: nombrar `status` lo frena el GRANT', async () => {
    // Sin esto, el visitante se saltea la evaluación del dueño entera y se autoaprueba el canje.
    const visitante = openStorefront(SLUG_A);
    try {
      const { capa } = await veredicto(visitante, 'anon', canje({ status: `'accepted'` }));
      expect(capa, '`status` está otorgada a `anon`: el visitante elige el estado de su lead').toBe('GRANT');
    } finally {
      await visitante.close();
    }
  });

  it('las notas internas del dueño no las escribe el visitante: `internal_notes` lo frena el GRANT', async () => {
    const visitante = openStorefront(SLUG_A);
    try {
      const { capa } = await veredicto(visitante, 'anon', canje({ internal_notes: `'me lo dejo en 100'` }));
      expect(capa).toBe('GRANT');
    } finally {
      await visitante.close();
    }
  });

  it('tampoco forja el `id`, ni antedata el `created_at`, ni se autoasigna el canje aceptado', async () => {
    // Las cinco que quedan afuera del `GRANT`, cada una por su motivo:
    //   `id`/`created_at`/`updated_at` salen de sus defaults — un lead antedatado se cuela arriba
    //   en el inbox—, y `created_listing_id`/`handled_by` son el RESULTADO de una decisión del
    //   dueño que el visitante no tomó. Las tres capas se distinguen igual que arriba: todas GRANT.
    const visitante = openStorefront(SLUG_A);
    try {
      const forjadas: ReadonlyArray<Readonly<Record<string, string>>> = [
        { id: `'${INTRUDER_ROW}'` },
        { created_at: `now() - interval '30 days'` },
        { updated_at: `now() - interval '30 days'` },
        { created_listing_id: `'${LISTING_A}'` },
        { handled_by: `'${USER_A}'` },
      ];
      for (const campos of forjadas) {
        const columna = Object.keys(campos)[0] ?? '';
        const { capa } = await veredicto(visitante, 'anon', canje(campos));
        expect(capa, `\`${columna}\` está otorgada a \`anon\` y no debería`).toBe('GRANT');
      }
    } finally {
      await visitante.close();
    }
  });

  // ── d · el visitante escribe y NO lee: ni siquiera lo propio ──────────────────────────────
  it('el visitante no lee ni el canje que acaba de dejar: `insert … returning id` lo frena el GRANT', async () => {
    // Consecuencia práctica para quien escriba el handler de la vidriera, y no se arregla con un
    // privilegio más: si el formulario necesita confirmar algo, que confirme sin el id.
    const visitante = openStorefront(SLUG_A);
    try {
      const { capa } = await veredicto(visitante, 'anon', `${canje()} returning id`);
      expect(capa, 'el `returning` devolvió el id: `anon` tiene SELECT sobre el inbox de canje').toBe('GRANT');
    } finally {
      await visitante.close();
    }
  });

  it('el inbox de canje no es contenido de la vidriera: leerlo, corregirlo o borrarlo lo frena el GRANT', async () => {
    // Un `select` acá publicaría el nombre y el WhatsApp de cada persona que ofreció un equipo, en
    // una URL sin login. Es la PII de un tercero, no del reseller: es el peor dato del producto.
    const visitante = openStorefront(SLUG_A);
    try {
      for (const intento of [
        `select customer_wa_phone from tradein_leads`,
        `select count(*) from tradein_leads`,
        `update tradein_leads set notes = 'me arrepenti'`,
        `delete from tradein_leads`,
      ]) {
        const { capa } = await veredicto(visitante, 'anon', intento);
        expect(capa, `\`anon\` puede correr esto sobre el inbox de canje: ${intento}`).toBe('GRANT');
      }
    } finally {
      await visitante.close();
    }
  });

  // ── e · y del lado autenticado, el canje sigue siendo del tenant que lo recibió ────────────
  it('el dueño de B no ve el canje que un visitante dejó en la vidriera de A', async () => {
    // El otro extremo del mismo invariante: la PII del visitante entra sin login pero se lee con
    // uno, y ese login es de UN tenant. Se compara contra el conteo real de A para que no sea
    // verde por vacío si alguien deja de escribir leads.
    const enBase = await adminRows<{ n: string }>(
      `select count(*)::text as n from tradein_leads where tenant_id = '${TENANT_A}'`,
    );
    const veA = await a.rows<{ n: string }>(`select count(*)::text as n from tradein_leads`);
    expect(Number(enBase[0]?.n ?? '0'), 'no hay ni un canje en A: esta aserción no probaría nada').toBeGreaterThan(0);
    expect(veA[0]?.n, 'el dueño de A no ve sus propios canjes').toBe(enBase[0]?.n);

    const veB = await b.rows<{ customer_wa_phone: string }>(`select customer_wa_phone from tradein_leads`);
    expect(veB, 'el reseller de al lado está leyendo la PII de los canjes de A').toEqual([]);
  });

  it('el dueño de B tampoco corrige ni borra un canje de A, ni le planta uno en el inbox', async () => {
    expect(await b.affected(`update tradein_leads set offer_usd = 1 where tenant_id = '${TENANT_A}'`)).toBe(0);
    const failure = await b.error(`delete from tradein_leads where tenant_id = '${TENANT_A}'`);
    expect(failure.code).toBe('42501');
    expect(failure.message).toContain('permission denied');
    const { capa } = await veredicto(b, 'authenticated', canje({}, `'${TENANT_A}'`));
    expect(capa, 'un reseller logueado puede plantar un canje en el inbox del de al lado').toBe('POLICY');
  });

  // ── f · los CHECK: el borde de adentro Y el de afuera ─────────────────────────────────────
  //
  // Un CHECK probado sólo por afuera no distingue *"el límite está en 100"* de *"la columna no
  // acepta nada"*: las dos versiones dan `23514` para 101. Por eso cada límite se mide dos veces.
  //
  // Y se mide como `anon`, que es el caller que importa: entre un `curl` y la tabla, el handler es
  // la ÚNICA otra capa. Zod en el borde va a exigir lo mismo, pero una afirmación que vive sólo en
  // el borde se pierde el día que aparece un segundo caller (doctrina de ADR-025).
  //
  // Nota de orden de evaluación, medida en PostgreSQL 16.14: con el tenant equivocado **y** un
  // valor fuera de rango, el que contesta es RLS (`POLICY`), no el CHECK. Por eso todos los casos
  // de acá abajo usan el tenant correcto: si no, medirían la policy creyendo medir el constraint.
  describe('R2c-f · los límites de tamaño y rango del canje viven en el motor, no en el formulario', () => {
    const BORDES: ReadonlyArray<{
      readonly columna: string;
      readonly adentro: readonly string[];
      readonly afuera: readonly string[];
    }> = [
      // `length between 1 and 80` — un nombre vacío no es un lead, uno de 80 sí.
      { columna: 'customer_name', adentro: [`repeat('x', 1)`, `repeat('x', 80)`], afuera: [`''`, `repeat('x', 81)`] },
      // `between 6 and 25` — ancho para un teléfono argentino con prefijo, sin validar formato:
      // una regex de teléfono en el motor es la clase de constraint que después nadie puede migrar.
      { columna: 'customer_wa_phone', adentro: [`repeat('9', 6)`, `repeat('9', 25)`], afuera: [`repeat('9', 5)`, `repeat('9', 26)`] },
      { columna: 'model_text', adentro: [`repeat('x', 1)`, `repeat('x', 120)`], afuera: [`''`, `repeat('x', 121)`] },
      // Los cuatro opcionales van detrás de un `is null or`: `null` es un lead legítimo. El
      // visitante muchas veces no sabe los GB ni el % de batería y el canje igual vale, porque la
      // evaluación de verdad es presencial.
      { columna: 'color', adentro: ['null', `repeat('x', 40)`], afuera: [`repeat('x', 41)`] },
      { columna: 'notes', adentro: ['null', `repeat('x', 500)`], afuera: [`repeat('x', 501)`] },
      { columna: 'battery_pct', adentro: ['null', '0', '100'], afuera: ['-1', '101'] },
      { columna: 'storage_gb', adentro: ['null', '1', '4096'], afuera: ['0', '4097'] },
    ];

    it('el valor JUSTO ADENTRO del límite entra: un CHECK que rechaza todo también pasa el de afuera', async () => {
      const rebotados: string[] = [];
      const visitante = openStorefront(SLUG_A);
      try {
        for (const borde of BORDES) {
          for (const valor of borde.adentro) {
            const { capa } = await veredicto(visitante, 'anon', canje({ [borde.columna]: valor }));
            if (capa !== 'ENTRA') rebotados.push(`${borde.columna} = ${valor} → ${capa}`);
          }
        }
      } finally {
        await visitante.close();
      }
      expect(rebotados, 'un canje legítimo rebota en la base: el límite quedó más apretado de lo que dice').toEqual([]);
    });

    it('el valor JUSTO AFUERA rebota con 23514, que es el CHECK y no el GRANT ni la policy', async () => {
      const colados: string[] = [];
      const visitante = openStorefront(SLUG_A);
      try {
        for (const borde of BORDES) {
          for (const valor of borde.afuera) {
            const { capa } = await veredicto(visitante, 'anon', canje({ [borde.columna]: valor }));
            if (capa !== 'CHECK') colados.push(`${borde.columna} = ${valor} → ${capa}`);
          }
        }
      } finally {
        await visitante.close();
      }
      expect(colados, 'un valor fuera de rango entró, o lo frenó otra capa que la del CHECK').toEqual([]);
    });

    it('el mismo canje sobredimensionado rebota también para el DUEÑO logueado: el límite es del motor', async () => {
      // Si el límite viviera en el borde de la vidriera, el panel autenticado —que es otro caller—
      // lo escribiría sin problema. Un `notes` de 500KB por lead es también una cuenta de Postgres.
      const { capa } = await veredicto(
        a,
        'authenticated',
        canje({ notes: `repeat('x', 501)` }, `'${TENANT_A}'`),
      );
      expect(capa, 'el CHECK no alcanza al lado autenticado: el límite está en el borde, no en el motor').toBe('CHECK');
    });
  });

  // ── g · el canje APAGADO, y las DOS formas de rebote que `0009` dejó indistinguibles ───────
  /**
   * R2c-g · la segunda mitad del `WITH CHECK`: *el tenant de esta fila tiene el canje prendido*.
   *
   * ── Qué se rompió ───────────────────────────────────────────────────────────────────────
   * Hasta `0008` la policy decía sólo `tenant_id = storefront_tenant_id()`. Un tenant con
   * `accepts_trade_in = false` recibía el lead igual: lo único que lo frenaba era el `and
   * t.accepts_trade_in` del handler de la vidriera. O sea que un `curl` que no pasara por el
   * handler le llenaba de **nombre y teléfono de personas reales** el inbox a un reseller que
   * decidió no tomar canje — PII de terceros en una bandeja que por definición no mira.
   *
   * ── Por qué esto no es "un caso más" sino un bloque aparte ──────────────────────────────
   * Desde `0009` hay **dos maneras distintas** de que un canje no entre, y significan cosas
   * opuestas para el dueño:
   *
   *   · el tenant apagó el canje (`accepts_trade_in = false`) → decisión suya, reversible desde
   *     el panel y sin deploy. Su vidriera sigue viva: sólo se cerró el formulario.
   *   · el tenant no está `active` → `storefront_tenant_id()` filtra por `status = 'active'`, así
   *     que devuelve `NULL` y la PRIMERA mitad ya falla. La bandera ni se mira. No hay vidriera.
   *
   * **Postgres las cuenta con la misma frase**: `42501` +
   * `new row violates row-level security policy`. Un test que sólo mire eso no distingue una de
   * la otra — ni distingue a ninguna de las dos de un tercer mundo, el caro: si alguien recorta
   * el `GRANT` de columna sobre `tenants.accepts_trade_in`, el `exists` deja de ser evaluable y
   * el canje muere **para todos**, con `42501 permission denied for table tenants`. Medido en
   * `istock_dev` dentro de una transacción revertida: es literalmente el mismo código de error.
   * Por eso acá se afirma el **mensaje** —igual que en R2b— y, cuando el mensaje tampoco alcanza,
   * la evidencia se busca en otro observable: si el claim resuelve y si la vidriera sirve stock.
   *
   * La red de regresión de `db-agent` (`packages/db/src/rls-anon-tradein-lead.test.ts`, bloque
   * `g`) cubre los dos casos y está bien que exista, pero los afirma con el mismo par de
   * aserciones, así que no los separa. Ésta es la auditoría de referencia (`CLAUDE.md` §4): si
   * los dos divergen, gana ésta.
   */
  describe('R2c-g · el dueño que apagó el canje deja de recibir PII, y el rebote dice de qué mitad vino', () => {
    /** El rechazo entero —capa, código y mensaje— con el canario del rol ya exigido. */
    async function rebote(slug: string, texto: string): Promise<{ capa: string; error: PgError }> {
      const visitante = openStorefront(slug);
      try {
        const visto = await visitante.conCanario<never>(texto);
        expect(visto.rol, 'esta medición no corrió como `anon`: no probó ninguna policy').toBe('anon');
        const error = visto.error;
        if (error === null) throw new Error(`el canje entró en un tenant que no lo acepta: ${texto}`);
        return { capa: capaQueRechazo(error), error };
      } finally {
        await visitante.close();
      }
    }

    /** Lo que `anon` ve de su propia vidriera: si el claim resolvió y si hay stock que servir. */
    async function vidriera(slug: string): Promise<{ tenant: string | null; titulos: string[] }> {
      const visitante = openStorefront(slug);
      try {
        const resuelto = await visitante.rows<{ t: string | null }>(
          `select public.storefront_tenant_id() as t`,
        );
        const stock = await visitante.rows<{ title: string }>(`select title from listings`);
        return { tenant: resuelto[0]?.t ?? null, titulos: stock.map((r) => r.title) };
      } finally {
        await visitante.close();
      }
    }

    it('el visitante de un tenant que apagó el canje no le deja el lead: lo frena la POLICY, no el GRANT', async () => {
      // El caso que `0009` vino a cerrar: antes de la migración esto devolvía `INSERT 0 1`.
      const antes = await adminRows<{ n: string }>(
        `select count(*)::text as n from tradein_leads where tenant_id = '${TENANT_B}'`,
      );
      const { capa, error } = await rebote(SLUG_B, canje());
      expect(capa, 'el canje entró en un tenant que lo tiene apagado, o lo frenó otra capa').toBe('POLICY');
      expect(error.code).toBe('42501');
      expect(
        error.message,
        'el rechazo no vino del `WITH CHECK`: la bandera del dueño no es lo que frenó la fila',
      ).toContain('violates row-level security policy');
      expect(
        error.message,
        'esto es "`anon` perdió un privilegio", no "la policy rechazó la fila": con el GRANT ' +
          'recortado el canje muere para TODOS los tenants y este test seguiría verde mirando sólo el 42501',
      ).not.toContain('permission denied');
      const despues = await adminRows<{ n: string }>(
        `select count(*)::text as n from tradein_leads where tenant_id = '${TENANT_B}'`,
      );
      expect(despues[0]?.n, 'el rechazo no fue tal: quedó una fila escrita').toBe(antes[0]?.n);
    });

    it('el que apagó el canje conserva su vidriera entera: lo único que se cerró es el formulario', async () => {
      // Éste es el observable que separa este rebote del de abajo, y es también la regla de
      // negocio: apagar el canje no es darse de baja. El claim resuelve y el stock se sirve.
      const visto = await vidriera(SLUG_B);
      expect(visto.tenant, 'el claim del slug no resolvió: entonces no se midió la bandera').toBe(TENANT_B);
      expect(visto.titulos, 'la vidriera del que apagó el canje se quedó sin stock').toEqual([
        'iPhone 13 128 Azul',
      ]);
    });

    it('el tenant que no está activo rebota con el canje PRENDIDO: no se llega ni a mirar la bandera', async () => {
      // La otra mitad. `storefront_tenant_id()` filtra por `status = 'active'`, así que devuelve
      // NULL y la PRIMERA condición ya falla — el `exists` no decide nada acá. Se afirma que la
      // bandera está en `true` justamente para que el rechazo no se pueda atribuir a ella.
      const flag = await adminRows<{ f: boolean }>(
        `select accepts_trade_in as f from tenants where id = '${TENANT_C}'`,
      );
      expect(flag[0]?.f, 'C tiene el canje apagado: este caso mediría lo mismo que el de arriba').toBe(true);

      // C tiene una unidad `available` y publicada (`LISTING_C`): que se sirvan CERO es una
      // afirmación sobre el `status = 'active'`, no sobre una vidriera que estaba vacía igual.
      const publicadas = await adminRows<{ n: string }>(
        `select count(*)::text as n from listings
         where tenant_id = '${TENANT_C}' and status = 'available' and published_at is not null`,
      );
      expect(publicadas[0]?.n, 'C no tiene stock publicado: "no sirve nada" no probaría nada').toBe('1');

      const visto = await vidriera(SLUG_C);
      expect(visto.tenant, 'un tenant suspendido resolvió su claim: la vidriera de un dado de baja está viva').toBeNull();
      expect(visto.titulos, 'un tenant suspendido sigue publicando su stock en la vidriera').toEqual([]);

      const { capa, error } = await rebote(SLUG_C, canje({}, `'${TENANT_C}'`));
      expect(capa, 'un tenant suspendido recibe canjes').toBe('POLICY');
      expect(error.message).toContain('violates row-level security policy');
    });

    it('el visitante no puede deducir del error si el dueño apagó el canje o si lo dieron de baja', async () => {
      // Las dos mitades fallan con la MISMA frase, y eso es deseable: el mensaje de Postgres no
      // es un canal para contarle a un `curl` el estado comercial de un reseller. La consecuencia
      // para quien lea este archivo es la que importa: **el código de error no alcanza para saber
      // qué se rompió**, y por eso los dos casos de arriba se distinguen por otro observable.
      const apagado = await rebote(SLUG_B, canje());
      const inactivo = await rebote(SLUG_C, canje({}, `'${TENANT_C}'`));
      expect(apagado.error.code).toBe(inactivo.error.code);
      expect(
        apagado.error.message,
        'el rechazo del canje apagado y el del tenant inactivo dejaron de ser la misma frase: si ' +
          'ahora se distinguen, la vidriera está filtrando estado comercial en un mensaje de error',
      ).toBe(inactivo.error.message);
    });

    it('cada vidriera lee la bandera de canje de su propio dueño y nunca la del reseller de al lado', async () => {
      // Es el read que decide si el formulario se dibuja. R7 dice que la columna está otorgada;
      // acá se dice que el GRANT no alcanza para ver la configuración comercial del vecino.
      for (const [slug, esperado] of [
        [SLUG_A, { slug: SLUG_A, acepta: true }],
        [SLUG_B, { slug: SLUG_B, acepta: false }],
      ] as const) {
        const visitante = openStorefront(slug);
        try {
          const filas = await visitante.rows<{ slug: string; acepta: boolean }>(
            `select slug, accepts_trade_in as acepta from tenants order by slug`,
          );
          expect(filas, `la vidriera de ${slug} lee la bandera de más de un tenant`).toEqual([esperado]);
        } finally {
          await visitante.close();
        }
      }
    });

    it('apagar el canje baja el formulario público, no el mostrador: el dueño sigue cargando el presencial', async () => {
      // La policy de `authenticated` NO mira `accepts_trade_in`, y eso es deliberado: la bandera
      // dice *"no publico el formulario en la vidriera"*, no *"no tomo canje"*. El canje
      // presencial es flujo de primera clase (`CLAUDE.md` §1) y entra por el panel, con sesión y
      // con una persona del otro lado del mostrador. Si algún día la bandera tuviera que cerrar
      // también el panel, este test es el que se pone rojo y nombra la decisión.
      const antes = await adminRows<{ n: string }>(
        `select count(*)::text as n from tradein_leads where tenant_id = '${TENANT_B}'`,
      );
      const escritas = await b.affected(
        canje({ customer_name: `'Vino a la oficina'` }, `'${TENANT_B}'`),
      );
      expect(escritas, 'el dueño con el canje apagado no puede registrar un canje presencial').toBe(1);
      const despues = await adminRows<{ n: string }>(
        `select count(*)::text as n from tradein_leads where tenant_id = '${TENANT_B}'`,
      );
      expect(Number(despues[0]?.n ?? '0')).toBe(Number(antes[0]?.n ?? '0') + 1);
    });
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

  it('B no puede marcar como vendida una unidad de A por UPDATE directo: status se cambia por RPC', async () => {
    const failure = await b.error(`update listings set status = 'sold'`);
    expect(failure.code).toBe('42501');
    expect(failure.message).toContain('permission denied');
    const rows = await adminRows<{ status: string }>(`select status from listings where id = '${LISTING_A}'`);
    expect(rows[0]?.status).toBe('available');
  });

  it('B no puede tocar el tipo de cambio de A (el TC lo setea el dueño de cada tenant)', async () => {
    expect(await b.affected(`update fx_settings set ars_per_usd = 1.00 where tenant_id = '${TENANT_A}'`)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('R4 · un reseller no puede BORRAR el stock de otro', () => {
  it('B no puede borrar la unidad de A por id: DELETE está revocado para authenticated', async () => {
    const failure = await b.error(`delete from listings where id = '${LISTING_A}'`);
    expect(failure.code).toBe('42501');
    expect(failure.message).toContain('permission denied');
  });

  it('el `delete from listings` sin where —el accidente de las 3am— rebota por GRANT y no toca a nadie', async () => {
    const failure = await b.error(`delete from listings`);
    expect(failure.code).toBe('42501');
    expect(failure.message).toContain('permission denied');
    const rows = await adminRows<{ tenant_id: string; n: string }>(
      `select tenant_id, count(*)::text as n from listings
       where tenant_id in ('${TENANT_A}', '${TENANT_B}') group by tenant_id order by tenant_id`,
    );
    expect(rows).toEqual([
      { tenant_id: TENANT_A, n: '1' },
      { tenant_id: TENANT_B, n: '1' },
    ]);
  });

  it('B no puede borrar el tenant A (el borrado en cascada sería el peor de los casos)', async () => {
    expect(await b.affected(`delete from tenants where id = '${TENANT_A}'`)).toBe(0);
    const rows = await adminRows<{ n: string }>(`select count(*)::text as n from tenants where id = '${TENANT_A}'`);
    expect(rows[0]?.n).toBe('1');
  });

  it('B no puede borrar las ventas ni los leads de canje de A', async () => {
    expect(await b.affected(`delete from sales where id = '${SALE_A}'`)).toBe(0);
    const failure = await b.error(`delete from tradein_leads where id = '${LEAD_A}'`);
    expect(failure.code).toBe('42501');
    expect(failure.message).toContain('permission denied');
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
  //
  // ── S8 volvió a mover la lista, y esta vez además PARTIÓ el número ───────────────────────
  // `drizzle/0008_storefront_tradein_lead_insert.sql` agrega la SEGUNDA escritura sin autenticar
  // del producto —el lead de canje— y con eso el total pasa de 6 a 7. El problema no es el número
  // nuevo: es que en un solo entero, "6 → 7" no distingue *"se publicó una tabla más en la
  // vidriera"* de *"se le dio una lapicera a cualquiera con `curl`"*. Son dos superficies con dos
  // riesgos distintos —una filtra un dato, la otra acepta uno— y sumarlas esconde justo la que
  // este bloque existe para custodiar.
  //
  // Así que el conteo se parte en dos y cada mitad se afirma por separado, con su migración
  // nombrada al lado. Crecer la de ESCRITURA sigue siendo algo que alguien tiene que escribir a
  // mano acá adentro, que es la fricción entera.
  describe('R6c · las policies `TO anon` son 7 = 5 de LECTURA + 2 de ESCRITURA, y se cuentan aparte', () => {
    /** Las de `drizzle/0002_storefront_anon_grants.sql` §5. Todas de lectura. */
    const LECTURA = [
      'fx_settings.fx_settings_storefront_anon_select',
      'listing_photos.listing_photos_storefront_anon_select',
      'listings.listings_storefront_anon_select',
      'locations.locations_storefront_anon_select',
      'tenants.tenants_storefront_anon_select',
    ];

    /**
     * Las DOS escrituras sin autenticar del producto, cada una con la migración que la creó. No
     * hay una tercera, y agregarla es editar esta lista a mano.
     *
     *  · `wa_click_events` — `drizzle/0004_storefront_wa_click_insert.sql` (S4). El beacon del
     *    click de WhatsApp. Comportamiento auditado en R2b.
     *  · `tradein_leads`   — `drizzle/0008_storefront_tradein_lead_insert.sql` (S8). El lead de
     *    canje que el visitante deja desde la vidriera: `FOR INSERT TO anon`,
     *    `WITH CHECK (tenant_id = (select public.storefront_tenant_id()))`, `qual` NULL. Es la
     *    primera escritura sin autenticar que trae **texto libre y PII del visitante**, y su
     *    comportamiento —no sólo su forma— está auditado en R2c.
     */
    const ESCRITURA = [
      'tradein_leads.tradein_leads_storefront_insert',
      'wa_click_events.wa_click_events_storefront_insert',
    ];

    /** `policiesForAnon` ordena por `tabla.policy`, y las dos de escritura van después de `tenants`. */
    const ESPERADAS = [...LECTURA, ...ESCRITURA];

    it('el detector de policies `TO anon` encuentra la trampa plantada, con su comando', async () => {
      const rows = await adminRows<{ t: string; cmd: string }>(policiesForAnon(CONTROL_SCHEMA));
      expect(rows.map((r) => `${r.t}:${r.cmd}`)).toEqual(['leaky_anon_policy.leaky_anon_write:ALL']);
    });

    it('en public son EXACTAMENTE esas 7, por nombre: una policy `TO anon` nueva rompe el test', async () => {
      const rows = await adminRows<{ t: string }>(policiesForAnon('public'));
      expect(rows.map((r) => r.t)).toEqual(ESPERADAS);
    });

    it('la superficie de LECTURA de la vidriera son 5 policies, y las 5 son de SELECT', async () => {
      // La mitad "publica un dato de más". Una tabla nueva en la vidriera entra por acá.
      const rows = await adminRows<{ t: string; cmd: string }>(policiesForAnon('public'));
      expect(rows.filter((r) => r.cmd === 'SELECT').map((r) => r.t)).toEqual(LECTURA);
    });

    it('la superficie de ESCRITURA SIN LOGIN son 2 policies de INSERT: el beacon (S4) y el canje (S8)', async () => {
      // La otra mitad, y la cara: acá del otro lado del cable no hay nadie identificado. Este
      // número se lee solo, sin restarle 5 a un total, que es el punto de haberlo partido.
      const rows = await adminRows<{ t: string; cmd: string }>(policiesForAnon('public'));
      expect(
        rows.filter((r) => r.cmd === 'INSERT').map((r) => r.t),
        'apareció una escritura sin autenticar que no es ni el beacon del click ni el lead de canje',
      ).toEqual(ESCRITURA);
    });

    it('y no hay una TERCERA superficie: `anon` no tiene UPDATE, DELETE ni `FOR ALL` en ningún lado', async () => {
      // Un `FOR ALL` no cambia la cantidad de policies ni la suma de las dos mitades: entra como
      // un `cmd` que no es ninguno de los dos, y sin esta aserción pasaría entre las dos listas.
      const rows = await adminRows<{ t: string; cmd: string }>(policiesForAnon('public'));
      const otras = rows.filter((r) => r.cmd !== 'SELECT' && r.cmd !== 'INSERT');
      expect(otras.map((r) => `${r.t}:${r.cmd}`)).toEqual([]);
    });

    it('el comando de cada una está fijado: 5 de SELECT y 2 de INSERT, el beacon y el canje', async () => {
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

    it('ninguna policy de `anon` es decorativa: las 7 acotan por el claim del host', async () => {
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
   * Antes de S4 esto era `[]` y era fácil de defender. La lista literal es lo único que separa
   * "estas dos tablas reciben una escritura" de "`anon` escribe", y cada entrada nombra la
   * migración que la justifica:
   *
   *   · `wa_click_events` — `drizzle/0004_storefront_wa_click_insert.sql` (S4). El beacon del
   *     click de WhatsApp: 3 columnas.
   *   · `tradein_leads`   — `drizzle/0008_storefront_tradein_lead_insert.sql` (S8). El lead de
   *     canje que el visitante deja desde la vidriera: 9 columnas. Es la SEGUNDA escritura sin
   *     autenticar del producto y la primera con PII adentro.
   *
   * Una tercera —de la tabla que sea, del comando que sea— agrega una entrada y rompe el test.
   * Es el punto entero de mantenerlo así de duro: el número no crece solo, lo crece alguien y
   * tiene que escribir de dónde sale.
   */
  const ESCRITURA_DE_ANON = ['tradein_leads:column:INSERT', 'wa_click_events:column:INSERT'];

  /**
   * Y las columnas, una por una. `anonWritePrivileges` contesta *"¿hay escritura de columna en esta
   * tabla?"*, así que una columna de más en el MISMO `GRANT` no le cambia la salida ni un carácter.
   * Acá están las 12, y lo que **no** está es el diseño:
   *
   *   · `wa_click_events` (3, `drizzle/0004`) — las que manda el handler del beacon. `id` y
   *     `created_at` salen de sus defaults **porque no están acá**, y por eso el visitante no
   *     puede forjar el uno ni antedatar el otro.
   *   · `tradein_leads` (9, `drizzle/0008`) — el formulario de canje entero. Fuera del `GRANT`
   *     quedaron, a propósito: `status` (el visitante no deja su propio lead en `accepted` y se
   *     saltea la evaluación del dueño), `offer_usd` e `internal_notes` (marcadas `SENSITIVE`: son
   *     el costo y las notas del dueño, `CLAUDE.md` §9), `created_listing_id` y `handled_by` (los
   *     escribe el lado autenticado al aceptar el canje) e `id`/`created_at`/`updated_at`.
   *
   * La FORMA de ese privilegio se mide acá; el COMPORTAMIENTO —que nombrar `offer_usd` rebote en
   * la capa `GRANT` y no en otra— se mide en R2c, contra Postgres real y con el rol probado.
   */
  const COLUMNAS_ESCRIBIBLES = [
    'tradein_leads.battery_pct:INSERT',
    'tradein_leads.color:INSERT',
    'tradein_leads.customer_name:INSERT',
    'tradein_leads.customer_wa_phone:INSERT',
    'tradein_leads.declared_condition:INSERT',
    'tradein_leads.model_text:INSERT',
    'tradein_leads.notes:INSERT',
    'tradein_leads.storage_gb:INSERT',
    'tradein_leads.tenant_id:INSERT',
    'wa_click_events.listing_id:INSERT',
    'wa_click_events.source:INSERT',
    'wa_click_events.tenant_id:INSERT',
  ];

  /**
   * `drizzle/0008` · las DOS columnas `SENSITIVE` que `anon` puede escribir, y son sus propios
   * datos: el nombre y el WhatsApp que el visitante tipea en el formulario de canje. La marca ahí
   * dice *"no sale a la vidriera, ni al chatbot, ni a un log"*, no *"nadie la escribe"*.
   * Ni una del dueño: `offer_usd` (el costo de la unidad que nace del canje) e `internal_notes`
   * están marcadas igual y quedaron **fuera** del GRANT.
   */
  const SENSITIVES_ESCRIBIBLES = [
    'tradein_leads.customer_name:INSERT',
    'tradein_leads.customer_wa_phone:INSERT',
  ];

  it('las escrituras de `anon` en public son DOS y de columna: el beacon (S4) y el canje (S8)', async () => {
    const rows = await adminRows<{ t: string }>(anonWritePrivileges('public'));
    expect(
      rows.map((r) => r.t),
      'apareció una escritura sin autenticar que no es ni el beacon de S4 ni el lead de canje de S8',
    ).toEqual(ESCRITURA_DE_ANON);
  });

  it('ninguna de las dos es de TABLA: `has_table_privilege` de INSERT sigue en false en todo public', async () => {
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

  it('las 12 columnas que `anon` escribe están enumeradas: `status` y `offer_usd` no son dos de ellas', async () => {
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

  it('el detector de columnas SENSITIVE ESCRIBIBLES encuentra su propia trampa plantada', async () => {
    const rows = await adminRows<{ t: string }>(anonWritableSensitiveColumns(CONTROL_SCHEMA));
    expect(rows.map((r) => r.t)).toEqual(['leaky_grant_write.status:INSERT']);
  });

  it('de las columnas SENSITIVE, `anon` sólo escribe la PII que el propio visitante tipea', async () => {
    // La pregunta que ningún detector de este archivo hacía antes de S8: los de escritura no miran
    // la marca y el de la marca sólo miraba lectura. `offer_usd` es el costo de la unidad que nace
    // del canje: que lo escriba un `curl` es escribir el costo del stock ajeno desde afuera.
    const rows = await adminRows<{ t: string }>(anonWritableSensitiveColumns('public'));
    expect(
      rows.map((r) => r.t),
      '`anon` escribe una columna sensible del DUEÑO (costo o notas internas): `CLAUDE.md` §9',
    ).toEqual(SENSITIVES_ESCRIBIBLES);
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
      expect(error.message).toContain('sales_tenant_listing_fk');
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
   * R9f · la venta y su unidad deben pertenecer al mismo tenant, y el par es único.
   *
   * La FK compuesta `sales_tenant_listing_fk` rechaza con `23503` un `listing_id` válido de otro
   * tenant antes de que pueda existir una venta cruzada. La unicidad de D8 sigue siendo por par:
   * el segundo intento sobre `(tenant_id, listing_id)` del mismo tenant da `23505`.
   *
   * Se mide con la conexión de operador y no con dos sesiones: acá el sujeto es **el motor**, no
   * una policy. Las sesiones autenticadas de R9c ya prueban el aislamiento de RLS.
   */
  describe('R9f · una venta sólo puede apuntar a una unidad de su tenant y el par es único', () => {
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

    it('el MISMO listing_id en OTRO tenant rebota con 23503 por la FK compuesta', async () => {
      const error = await adminRechaza(
        `insert into sales (id, tenant_id, listing_id, price_usd, cost_usd)
         values ('${VENTA_PAR_B}', '${TENANT_B}', '${LISTING_MISMO_UUID}', 850.00, 550.00)`,
      );
      expect(error.code).toBe('23503');
      expect(error.message).toContain('sales_tenant_listing_fk');

      const rows = await adminRows<{ tenant_id: string }>(
        `select tenant_id from sales where listing_id = '${LISTING_MISMO_UUID}' order by tenant_id`,
      );
      expect(
        rows.map((r) => r.tenant_id),
        'la FK compuesta impide que la unidad de A quede referenciada por una venta de B',
      ).toEqual([TENANT_A]);
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
