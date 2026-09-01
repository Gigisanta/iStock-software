/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  `reservations.sweep_attempts` — QUIÉN LA LEE Y QUIÉN LA INCREMENTA, CONTRA POSTGRES REAL.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * La columna la agrega `drizzle/0006_reservations_sweep_attempts.sql`. Existe porque el barrido de
 * reservas no tenía dónde anotar que una fila ya le había fallado: toma
 * `status='active' and expires_at <= now() order by expires_at asc limit 200`, y la fila que hace
 * rollback queda `active` con el **mismo `expires_at`**, o sea que vuelve a ser la primera de la
 * próxima corrida. Para siempre.
 *
 * ## Lo que este archivo tiene que probar, y por qué no alcanza con "la columna existe"
 * Un contador de intentos es un **guard**, y un guard escribible por la parte de la que te querés
 * defender no es un guard. Concretamente: un seller que escribe `sweep_attempts = 999` en su
 * propia reserva (su RLS se lo permite, es su tenant) se fabrica una reserva que el barrido va a
 * saltear para siempre — stock congelado en `reserved` a voluntad, o sea el mismo bug que este
 * contador vino a arreglar, ahora disponible como feature. Por eso la mitad cara de la migración
 * no es el `ADD COLUMN`, es el reparto de privilegios, y por eso se prueba acá con sesiones
 * reales y no con un mock: un mock de un GRANT prueba que el mock funciona.
 *
 * El reparto que se afirma, en una línea: **lee el panel y el cron; el contador lo mueve SÓLO el
 * cron.** La vidriera no ve `reservations` en absoluto.
 *
 * ## Por qué este archivo se reescribió (S6, y es la lección cara de la slice)
 * La primera versión sacaba `sweep_attempts` del `GRANT INSERT` de `authenticated` y probaba que
 * el panel podía seguir insertando… con una sentencia escrita a mano acá. **Ningún caller emite
 * esa sentencia.** Drizzle, en `insert().values()`, NOMBRA todas las columnas de la tabla y pone
 * `default` en las que no le pasaste, y Postgres exige el privilegio sobre cada columna nombrada
 * aunque el valor sea `DEFAULT`. Resultado: `packages/db` en verde y el alta de reservas del panel
 * rota con `42501` en e2e.
 *
 * De ahí las dos reglas que gobiernan este archivo:
 *   1. **La aserción tiene la forma del caller, no la forma cómoda.** El INSERT del panel se
 *      construye con el propio query builder de Drizzle (`toSQL()`) y se ejecuta tal cual, con sus
 *      `$n`. No hay una sola lista de columnas escrita a mano: la lista se DERIVA del schema, así
 *      que la próxima columna entra sola en vez de desactualizar el test en silencio.
 *   2. **Cada candado se prueba en la capa donde vive.** El INSERT lo ata la policy y el UPDATE lo
 *      ata el GRANT, así que no alcanza con mirar el código `42501`: se mira el MENSAJE.
 *
 * ## El detalle que hace que las aserciones negativas valgan algo
 * `42501` tapa dos cosas distintas (`test-session.ts` lo documenta):
 *   · `permission denied for table reservations`            → faltó el GRANT (capa 1)
 *   · `new row violates row-level security policy for ...`  → el GRANT estaba y **la policy**
 *                                                             rechazó la fila (capa 2)
 * Y acá los dos mensajes son **la aserción**, no un detalle del formato, porque las dos negativas
 * de `authenticated` viven en capas distintas y a propósito:
 *   · `UPDATE` de la columna  → tiene que decir `permission denied for table`. Es la capa 1: la
 *     fila es de su propio tenant, la policy la dejaría pasar, y lo único que la frena es el
 *     privilegio de COLUMNA. Si acá apareciera `row-level security`, estaríamos midiendo el
 *     fixture (una sesión apuntando al tenant equivocado) y no el GRANT.
 *   · `INSERT` con el contador forjado → tiene que decir `row-level security`. Es la capa 2, y si
 *     dijera `permission denied for table` significaría que volvimos al bug: el panel no puede
 *     insertar NADA, porque Drizzle nombra la columna aunque no la elija.
 *
 * Y por eso el grupo `b` prueba primero que el panel **sí** puede escribir sus columnas —con la
 * sentencia real—: sin eso, todas las negativas serían verdes porque el `REVOKE` se llevó puesto
 * el panel entero.
 *
 * ## Lo que este archivo NO es
 * No es la auditoría de referencia de RLS cruzado: esa es de `qa-agent` y vive en
 * `tests/rls-cross-tenant.test.ts` (CLAUDE.md §4 — el que escribe las policies no puede ser
 * también el dueño del test que las audita). El grupo `d` de acá es red de regresión del paquete
 * sobre su propia columna, ningún gate lo cita como evidencia, y si diverge del de `tests/`, gana
 * el de `tests/` y el que se corrige es éste.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { getTableColumns } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { claimsFor, openAdmin, openSession, openStorefrontSession, type Session } from './test-session';
import { reservations } from './schema/commerce';
import { databaseUrl } from './env';

// Bloque de uuids propio (grupo `9002`): no pisa el de `rls.test.ts` (9000) ni el de
// `rls-anon-wa-click.test.ts` (9001).
const TENANT_A = '00000000-0000-4000-9002-000000000001';
const TENANT_B = '00000000-0000-4000-9002-000000000002';
const SLUG_A = 'sweep-a';
const SLUG_B = 'sweep-b';
const USER_A = '00000000-0000-4000-9002-0000000000a2';
const USER_B = '00000000-0000-4000-9002-0000000000b2';

/** Una reserva por listing: `reservations_one_active_per_listing` no admite dos activas. */
const LISTING_A1 = '00000000-0000-4000-9002-00000000000a';
const LISTING_A2 = '00000000-0000-4000-9002-00000000000b';
const LISTING_B1 = '00000000-0000-4000-9002-00000000000c';

const RESERVA_A1 = '00000000-0000-4000-9002-0000000000d1';
const RESERVA_A2 = '00000000-0000-4000-9002-0000000000d2';
const RESERVA_B1 = '00000000-0000-4000-9002-0000000000d3';
/** La que crea el panel con la sentencia de Drizzle. No la monta el fixture: la crea el test. */
const RESERVA_NUEVA = '00000000-0000-4000-9002-0000000000d4';

const admin = openAdmin();
let panelA: Session;
let panelB: Session;
let vidrieraA: Session;

/**
 * El cron. **No es `openAdmin()`**: la conexión local es superusuario y un superusuario se saltea
 * los GRANTs igual que se saltea `FORCE RLS`, así que probar el incremento como admin no probaría
 * nada del privilegio de `service_role` — que es justamente la mitad de la migración que, si
 * falta, produce el `42501` que "aparece el día que se prende el cron" (CLAUDE.md §3).
 */
const cronSql = postgres(databaseUrl(), { max: 1, prepare: false, onnotice: () => {} });
async function cron<T>(text: string): Promise<T[]> {
  return (await cronSql.begin(async (tx) => {
    await tx.unsafe('set local role service_role');
    return (await tx.unsafe(text)) as unknown;
  })) as unknown as T[];
}

async function adminRows<T>(text: string): Promise<T[]> {
  return (await admin.unsafe(text)) as unknown as T[];
}

/** El contador leído con el rol de operador, para no depender de lo que estamos auditando. */
async function attemptsDe(reserva: string): Promise<number> {
  const r = await adminRows<{ n: number }>(`select sweep_attempts as n from reservations where id = '${reserva}'`);
  return r[0]?.n ?? -1;
}

function listingInsert(id: string, tenant: string, slug: string): string {
  return `insert into listings (id, tenant_id, slug, title, condition, price_usd, status)
          values ('${id}', '${tenant}', '${slug}', 'iPhone 14 Pro', 'used_excellent', 620.00, 'reserved')`;
}

function reservaInsert(id: string, tenant: string, listing: string): string {
  return `insert into reservations (id, tenant_id, listing_id, expires_at, status)
          values ('${id}', '${tenant}', '${listing}', now() - interval '5 minutes', 'active')`;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  LA FORMA DEL CALLER, CONSTRUIDA POR EL CALLER
// ══════════════════════════════════════════════════════════════════════════════════════════════
//
// Esto es lo que faltaba en la primera versión de este archivo y lo que rompió S6. El panel no
// escribe SQL: llama a `db.insert(reservations).values({...})`, y Drizzle emite
//
//     insert into "reservations" ("id","tenant_id",…,"sweep_attempts","created_at","updated_at")
//     values ($1,$2,…,default,default,default)
//
// o sea que NOMBRA `sweep_attempts` aunque nadie la haya elegido. Postgres exige el privilegio
// sobre cada columna nombrada aunque el valor sea `DEFAULT`, así que sacarla del `GRANT INSERT`
// no impide elegirla: impide crear reservas.
//
// El builder de abajo es el **mismo** de `apps/web/…/reserve-unit.ts`. No hay conexión: sólo se
// usa `toSQL()`, y la sentencia se ejecuta por la sesión del test, que es la que tiene el rol y el
// claim. Un cliente de Drizzle con la URL real haría la query como el usuario de la conexión —
// que en local es SUPERUSUARIO— y no probaría absolutamente nada.
// `toSQL()` no conecta: postgres.js abre el socket recién en la primera query, y acá no hay
// ninguna. El cliente se cierra igual en `afterAll`, para no dejar el handle colgando.
const emisorSql = postgres(databaseUrl(), { max: 1, prepare: false, onnotice: () => {} });
const emisor = drizzle(emisorSql);

interface ReservaDelPanel {
  readonly id: string;
  readonly tenantId: string;
  readonly listingId: string;
  /** Sólo lo manda el caso de FORJA. El panel real nunca la nombra: sale de su `default 0`. */
  readonly sweepAttempts?: number;
}

/** La sentencia exacta que emite el panel, con sus `$n` sin interpolar. */
function insertComoElPanel(r: ReservaDelPanel): { sql: string; params: readonly unknown[] } {
  const query = emisor.insert(reservations).values({
    id: r.id,
    tenantId: r.tenantId,
    listingId: r.listingId,
    status: 'active',
    minutes: 60,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    customerLabel: null,
    createdBy: null,
    ...(r.sweepAttempts === undefined ? {} : { sweepAttempts: r.sweepAttempts }),
  });
  const { sql, params } = query.toSQL();
  return { sql, params };
}

/** Las columnas de `reservations` **derivadas del schema**, en el orden en que Drizzle las emite. */
function columnasDelSchema(): string[] {
  return Object.values(getTableColumns(reservations)).map((c) => c.name);
}

/** La lista de columnas que la sentencia nombra de verdad, parseada de su propio texto. */
function columnasNombradas(sql: string): string[] {
  const lista = /insert into "reservations" \(([^)]*)\)/i.exec(sql);
  return (lista?.[1] ?? '').split(',').map((c) => c.trim().replace(/"/g, ''));
}

beforeAll(async () => {
  await admin.unsafe(`delete from tenants where id in ('${TENANT_A}', '${TENANT_B}')`);
  await admin.unsafe(`
    insert into auth.users (id, email) values
      ('${USER_A}', 'a@sweeptest.local'), ('${USER_B}', 'b@sweeptest.local')
    on conflict (id) do nothing`);
  await admin.unsafe(`
    insert into tenants (id, slug, name, wa_phone, status) values
      ('${TENANT_A}', '${SLUG_A}', 'Sweep A', '5492990000031', 'active'),
      ('${TENANT_B}', '${SLUG_B}', 'Sweep B', '5492990000032', 'active')`);
  await admin.unsafe(`
    insert into memberships (tenant_id, user_id, role) values
      ('${TENANT_A}', '${USER_A}', 'owner'), ('${TENANT_B}', '${USER_B}', 'owner')`);

  await admin.unsafe(listingInsert(LISTING_A1, TENANT_A, 'sweep-a-1'));
  await admin.unsafe(listingInsert(LISTING_A2, TENANT_A, 'sweep-a-2'));
  await admin.unsafe(listingInsert(LISTING_B1, TENANT_B, 'sweep-b-1'));

  await admin.unsafe(reservaInsert(RESERVA_A1, TENANT_A, LISTING_A1));
  await admin.unsafe(reservaInsert(RESERVA_A2, TENANT_A, LISTING_A2));
  await admin.unsafe(reservaInsert(RESERVA_B1, TENANT_B, LISTING_B1));

  panelA = openSession(claimsFor(USER_A, TENANT_A));
  panelB = openSession(claimsFor(USER_B, TENANT_B));
  vidrieraA = openStorefrontSession(SLUG_A);
});

afterAll(async () => {
  await panelA?.close();
  await panelB?.close();
  await vidrieraA?.close();
  await cronSql.end({ timeout: 5 });
  await emisorSql.end({ timeout: 5 });
  await admin.unsafe(`delete from tenants where id in ('${TENANT_A}', '${TENANT_B}')`);
  await admin.unsafe(`delete from auth.users where id in ('${USER_A}', '${USER_B}')`);
  await admin.end({ timeout: 5 });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('0 · el instrumento: ninguna sesión de este archivo es superusuario', () => {
  // Sin esto todo lo de abajo es teatro: un superusuario ignora los GRANTs y `FORCE RLS`, así que
  // cualquier escritura pasaría y cualquier negativa quedaría verde por medir mal.
  it.each([
    ['panel (authenticated)', 'authenticated', () => panelA],
    ['vidriera (anon)', 'anon', () => vidrieraA],
  ] as const)('%s corre como `%s` sin usesuper', async (_label, esperado, get) => {
    const r = await get().query<{ u: string; usesuper: boolean }>(
      `select current_user::text as u,
              exists (select 1 from pg_user where usename = current_user and usesuper) as usesuper`,
    );
    expect(r[0]?.u).toBe(esperado);
    expect(r[0]?.usesuper).toBe(false);
  });

  it('el cron corre como `service_role` sin usesuper (tiene BYPASSRLS, que NO es lo mismo)', async () => {
    // Y esa distinción es el punto: `BYPASSRLS` saltea la *policy*, no el *GRANT*. Un rol con
    // BYPASSRLS y sin GRANT recibe `42501` (CLAUDE.md §3, costó un fallo de slice en FASE 2).
    const r = await cron<{ u: string; usesuper: boolean; bypass: boolean }>(
      `select current_user::text as u,
              exists (select 1 from pg_user where usename = current_user and usesuper) as usesuper,
              (select rolbypassrls from pg_roles where rolname = current_user) as bypass`,
    );
    expect(r[0]?.u).toBe('service_role');
    expect(r[0]?.usesuper).toBe(false);
    expect(r[0]?.bypass).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('a · la columna existe con la forma que el barrido necesita', () => {
  it('es `integer not null default 0`', async () => {
    const r = await adminRows<{ t: string; nullable: string; def: string | null }>(`
      select data_type as t, is_nullable as nullable, column_default as def
      from information_schema.columns
      where table_schema = 'public' and table_name = 'reservations' and column_name = 'sweep_attempts'`);
    expect(r[0]?.t).toBe('integer');
    // `not null` para que no exista el estado "no sé cuántas veces falló": con NULL, un
    // `sweep_attempts < 3` da NULL y la fila DESAPARECE del barrido en vez de entrar.
    expect(r[0]?.nullable).toBe('NO');
    expect(r[0]?.def).toBe('0');
  });

  it('las filas que ya existían quedaron en 0, no en NULL', async () => {
    expect(await attemptsDe(RESERVA_A1)).toBe(0);
  });

  it('un contador negativo lo rechaza el CHECK, no una convención', async () => {
    // Un contador que puede ir a -1 es una forma de apagar el guard sin que se vea en un diff.
    await expect(
      admin.unsafe(`update reservations set sweep_attempts = -1 where id = '${RESERVA_A1}'`),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('b · el panel SIGUE escribiendo lo suyo (si no, todo el resto es verde por vacío)', () => {
  // La migración revoca `INSERT, UPDATE` de tabla y los re-otorga columna por columna. Si esa
  // segunda mitad se hubiera olvidado, el panel estaría roto y todas las negativas de abajo
  // pasarían por el motivo equivocado.
  it('puede UPDATE de `status` en su propia reserva', async () => {
    const n = await panelA.affected(
      `update reservations set status = 'expired', closed_at = now() where id = '${RESERVA_A2}'`,
    );
    expect(n).toBe(1);
    await admin.unsafe(`update reservations set status = 'active', closed_at = null where id = '${RESERVA_A2}'`);
  });

  it('puede INSERT de una reserva nueva con la sentencia que emite Drizzle (NO una escrita a mano)', async () => {
    // ESTE es el test que faltaba. La versión anterior escribía el `insert` a mano nombrando tres
    // columnas, pasaba, y el alta del panel estaba rota igual: el caller nombra las DOCE.
    await admin.unsafe(`delete from reservations where listing_id = '${LISTING_A2}'`);
    const { sql, params } = insertComoElPanel({ id: RESERVA_NUEVA, tenantId: TENANT_A, listingId: LISTING_A2 });

    const n = await panelA.affected(sql, params);

    expect(n).toBe(1);
    // Y entra en cero, que es lo que la policy exige: el `default` de la columna la satisface.
    expect(await attemptsDe(RESERVA_NUEVA)).toBe(0);
    await admin.unsafe(`delete from reservations where listing_id = '${LISTING_A2}'`);
    await admin.unsafe(reservaInsert(RESERVA_A2, TENANT_A, LISTING_A2));
  });

  it('puede LEER `sweep_attempts` de su propia reserva: el dueño ve que una reserva viene fallando', async () => {
    const r = await panelA.query<{ n: number }>(
      `select sweep_attempts as n from reservations where tenant_id = '${TENANT_A}' and id = '${RESERVA_A1}'`,
    );
    expect(r[0]?.n).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('c · el panel NO puede ESCRIBIR `sweep_attempts` — es la aserción cara del archivo', () => {
  it('un UPDATE de la columna en su PROPIA reserva da 42501 de la capa GRANT', async () => {
    const antes = await attemptsDe(RESERVA_A1);
    const { code, message } = await panelA.expectFailure(
      `update reservations set sweep_attempts = 999 where tenant_id = '${TENANT_A}' and id = '${RESERVA_A1}'`,
    );
    expect(code).toBe('42501');
    // Capa 1, no capa 2: la fila es del propio tenant, así que la policy la deja pasar y lo
    // único que puede frenar esto es el privilegio de COLUMNA. Si el mensaje hablara de
    // row-level security, estaríamos midiendo el fixture y no el GRANT.
    expect(message).toMatch(/permission denied for (table|relation) reservations/i);
    expect(message).not.toMatch(/row-level security/i);
    expect(await attemptsDe(RESERVA_A1)).toBe(antes);
  });

  it('tampoco puede bajarlo a 0 (que es el ataque real: soltar el guard, no subirlo)', async () => {
    await admin.unsafe(`update reservations set sweep_attempts = 7 where id = '${RESERVA_A1}'`);
    const code = await panelA.expectError(
      `update reservations set sweep_attempts = 0 where tenant_id = '${TENANT_A}' and id = '${RESERVA_A1}'`,
    );
    expect(code).toBe('42501');
    expect(await attemptsDe(RESERVA_A1)).toBe(7);
    await admin.unsafe(`update reservations set sweep_attempts = 0 where id = '${RESERVA_A1}'`);
  });

  it('un UPDATE que toca la columna JUNTO a una permitida se rechaza ENTERO', async () => {
    // Postgres evalúa el privilegio por columna asignada, así que el `status` legítimo no
    // "arrastra" a la prohibida. Vale la pena afirmarlo: es la forma en que esto se colaría.
    const code = await panelA.expectError(
      `update reservations set status = 'expired', sweep_attempts = 5
       where tenant_id = '${TENANT_A}' and id = '${RESERVA_A1}'`,
    );
    expect(code).toBe('42501');
    const r = await adminRows<{ status: string; n: number }>(
      `select status, sweep_attempts as n from reservations where id = '${RESERVA_A1}'`,
    );
    expect(r[0]?.status).toBe('active');
    expect(r[0]?.n).toBe(0);
  });

  it('el privilegio de UPDATE no está, y se lee así en el catálogo (no sólo en el mensaje de error)', async () => {
    const r = await adminRows<{ sel: boolean; ins: boolean; upd: boolean; updTabla: boolean }>(`
      select has_column_privilege('authenticated', 'reservations', 'sweep_attempts', 'SELECT') as sel,
             has_column_privilege('authenticated', 'reservations', 'sweep_attempts', 'INSERT') as ins,
             has_column_privilege('authenticated', 'reservations', 'sweep_attempts', 'UPDATE') as upd,
             has_table_privilege('authenticated', 'reservations', 'UPDATE') as "updTabla"`);
    // `ins: true` es deliberado y es la corrección de S6: el INSERT lo ata la POLICY (grupo `g`),
    // no el GRANT. `updTabla: false` es la otra mitad — si el privilegio de UPDATE volviera a
    // nivel de tabla, cubriría `sweep_attempts` y `upd` daría true sin que nadie lo escribiera.
    expect(r[0]).toEqual({ sel: true, ins: true, upd: false, updTabla: false });
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('d · la vidriera anónima no toca `reservations`, ni la columna ni la tabla', () => {
  it('un SELECT de `anon` sobre la tabla da 42501 (no cero filas: 42501)', async () => {
    const { code, message } = await vidrieraA.expectFailure(
      `select sweep_attempts from reservations where tenant_id = '${TENANT_A}'`,
    );
    expect(code).toBe('42501');
    expect(message).toMatch(/permission denied for (table|relation) reservations/i);
  });

  it('un UPDATE de `anon` sobre la columna da 42501', async () => {
    const code = await vidrieraA.expectError(`update reservations set sweep_attempts = 0`);
    expect(code).toBe('42501');
  });

  it('`anon` no tiene NINGÚN privilegio sobre reservations en el catálogo', async () => {
    const r = await adminRows<{ p: string }>(`
      select privilege_type as p from information_schema.role_column_grants
      where table_schema = 'public' and table_name = 'reservations' and grantee = 'anon'
      union all
      select privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'reservations' and grantee = 'anon'`);
    expect(r.map((x) => x.p)).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('e · el cron SÍ puede anotar el intento (sin esto la columna es decorativa)', () => {
  it('`service_role` incrementa el contador de una reserva vencida', async () => {
    await admin.unsafe(`update reservations set sweep_attempts = 0 where id = '${RESERVA_A1}'`);
    await cron(`update reservations set sweep_attempts = sweep_attempts + 1 where id = '${RESERVA_A1}'`);
    expect(await attemptsDe(RESERVA_A1)).toBe(1);
    await cron(`update reservations set sweep_attempts = sweep_attempts + 1 where id = '${RESERVA_A1}'`);
    expect(await attemptsDe(RESERVA_A1)).toBe(2);
    await admin.unsafe(`update reservations set sweep_attempts = 0 where id = '${RESERVA_A1}'`);
  });

  it('el cron ve las reservas vencidas de TODOS los tenants (por eso barre sin claim)', async () => {
    // `service_role` tiene BYPASSRLS: el barrido es global a propósito. Lo que lo hace seguro no
    // es la policy sino que no hay sesión de usuario detrás — y el GRANT, que sí se evalúa.
    const r = await cron<{ tenant_id: string }>(
      `select distinct tenant_id from reservations
       where status = 'active' and expires_at <= now()
         and tenant_id in ('${TENANT_A}', '${TENANT_B}') order by 1`,
    );
    expect(r.map((x) => x.tenant_id).sort()).toEqual([TENANT_A, TENANT_B].sort());
  });

  it('el CHECK también aplica al cron: no puede dejar el contador en negativo', async () => {
    await expect(
      cron(`update reservations set sweep_attempts = sweep_attempts - 1 where id = '${RESERVA_A1}'`),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('g · el INSERT lo ata la POLICY, y por eso el panel puede crear reservas', () => {
  // El grupo entero existe porque la primera versión de 0006 ató el INSERT con el GRANT por
  // columna y rompió el alta del panel. Acá se mide la sentencia real, en sus dos polaridades.

  beforeEach(async () => {
    await admin.unsafe(`delete from reservations where listing_id = '${LISTING_A2}'`);
  });

  afterEach(async () => {
    await admin.unsafe(`delete from reservations where listing_id = '${LISTING_A2}'`);
    await admin.unsafe(reservaInsert(RESERVA_A2, TENANT_A, LISTING_A2));
  });

  it('la premisa: Drizzle NOMBRA `sweep_attempts` con `default` aunque el caller no la elija', async () => {
    // Si esto se pone rojo, no es un test roto: cambió el emisor y hay que revisar 0006 entera.
    // Toda la elección de capa de esta migración cuelga de esta línea.
    const { sql } = insertComoElPanel({ id: RESERVA_NUEVA, tenantId: TENANT_A, listingId: LISTING_A2 });

    // La lista se DERIVA del schema: la próxima columna de `reservations` entra sola acá en vez
    // de desactualizar el test en silencio, que es como volveríamos a este mismo bug.
    expect(columnasNombradas(sql)).toEqual(columnasDelSchema());
    expect(columnasNombradas(sql)).toContain('sweep_attempts');
    expect(sql).toMatch(/values \(.*default.*\)/i);
    // Y el valor va como `default`, no como parámetro: el caller no la elige, sólo la nombra.
    expect(sql).not.toMatch(/"sweep_attempts"\s*\)\s*values[^)]*\$9/i);
  });

  it('con la lista COMPLETA de columnas y `default`, el panel crea la reserva (era el 42501 de e2e)', async () => {
    const { sql, params } = insertComoElPanel({ id: RESERVA_NUEVA, tenantId: TENANT_A, listingId: LISTING_A2 });
    const n = await panelA.affected(sql, params);
    expect(n).toBe(1);
    expect(await attemptsDe(RESERVA_NUEVA)).toBe(0);
  });

  it('forjar `sweep_attempts = 7` al crear lo rechaza la POLICY, y el MENSAJE es la aserción', async () => {
    const { sql, params } = insertComoElPanel({
      id: RESERVA_NUEVA, tenantId: TENANT_A, listingId: LISTING_A2, sweepAttempts: 7,
    });
    // Misma sesión, mismo tenant, misma tabla: lo único que cambia es el valor del contador.
    expect(sql).toMatch(/\$9/);

    const { code, message } = await panelA.expectFailure(sql, params);

    expect(code).toBe('42501');
    // Capa 2. Si dijera `permission denied for table`, el candado habría vuelto al GRANT y el
    // panel no podría crear NINGUNA reserva — verde por el motivo equivocado, que es el bug.
    expect(message).toMatch(/new row violates row-level security policy/i);
    expect(message).not.toMatch(/permission denied for (table|relation)/i);
    // Y no quedó fila: el rechazo es real, no un warning.
    const r = await adminRows<{ n: number }>(`select count(*)::int as n from reservations where id = '${RESERVA_NUEVA}'`);
    expect(r[0]?.n).toBe(0);
  });

  it('tampoco puede forjarlo en 1 (el ataque no necesita un número grande)', async () => {
    const { sql, params } = insertComoElPanel({
      id: RESERVA_NUEVA, tenantId: TENANT_A, listingId: LISTING_A2, sweepAttempts: 1,
    });
    const { code, message } = await panelA.expectFailure(sql, params);
    expect(code).toBe('42501');
    expect(message).toMatch(/new row violates row-level security policy/i);
  });

  it('el `and` no reemplazó al tenant: el panel A sigue sin poder crear una reserva de B', async () => {
    // Si alguien "simplificara" el `with check` a `sweep_attempts = 0`, este test es el que grita.
    const { sql, params } = insertComoElPanel({ id: RESERVA_NUEVA, tenantId: TENANT_B, listingId: LISTING_A2 });
    const { code, message } = await panelA.expectFailure(sql, params);
    expect(code).toBe('42501');
    expect(message).toMatch(/new row violates row-level security policy/i);
  });

  it('el `with check` de la policy exige las DOS cosas, y se lee en el catálogo', async () => {
    const r = await adminRows<{ wc: string }>(`
      select with_check as wc from pg_policies
      where schemaname = 'public' and tablename = 'reservations'
        and policyname = 'reservations_tenant_insert'`);
    const wc = r[0]?.wc ?? '';
    expect(wc).toMatch(/sweep_attempts = 0/);
    expect(wc).toMatch(/tenant_id/);
    // ADR-005: `auth.jwt()` siempre dentro de un `(select …)`, o se evalúa una vez POR FILA.
    expect(wc).toMatch(/\(\s*SELECT/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('f · regresión de tenant sobre la columna nueva (la auditoría de referencia es de qa-agent)', () => {
  // Dos sesiones con claims distintos, Postgres real, cero mocks. Esto NO reemplaza a
  // `tests/rls-cross-tenant.test.ts`: si divergen, gana aquél (CLAUDE.md §4).
  it('tenant B no lee el `sweep_attempts` de una reserva de tenant A', async () => {
    await admin.unsafe(`update reservations set sweep_attempts = 3 where id = '${RESERVA_A1}'`);
    const r = await panelB.query<{ n: number }>(
      `select sweep_attempts as n from reservations where id = '${RESERVA_A1}'`,
    );
    expect(r).toEqual([]);
    // Y la de B sí la ve: si no, el vacío de arriba no probaría aislamiento sino una query rota.
    const propia = await panelB.query<{ n: number }>(
      `select sweep_attempts as n from reservations where tenant_id = '${TENANT_B}' and id = '${RESERVA_B1}'`,
    );
    expect(propia).toHaveLength(1);
  });

  it('tenant B tampoco puede escribirla en una reserva de tenant A (42501 antes que 0 filas)', async () => {
    // El GRANT se evalúa antes que la policy, así que acá gana la capa 1. Las dos frenan.
    const code = await panelB.expectError(
      `update reservations set sweep_attempts = 0 where id = '${RESERVA_A1}'`,
    );
    expect(code).toBe('42501');
    expect(await attemptsDe(RESERVA_A1)).toBe(3);
    await admin.unsafe(`update reservations set sweep_attempts = 0 where id = '${RESERVA_A1}'`);
  });

  it('tenant B no puede tocar la reserva de A ni por las columnas que SÍ tiene otorgadas', async () => {
    const n = await panelB.affected(`update reservations set status = 'expired' where id = '${RESERVA_A1}'`);
    expect(n).toBe(0);
    const r = await adminRows<{ status: string }>(`select status from reservations where id = '${RESERVA_A1}'`);
    expect(r[0]?.status).toBe('active');
  });
});
