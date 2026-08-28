/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  LOS ERRORES LOS TIRA POSTGRES. ACÁ NO SE FABRICA NINGUNO.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Este archivo no existía, y esa ausencia **es** el defecto que vino a cerrar. `pg-error.ts` leía
 * `code` y `constraint_name` del objeto de arriba; Drizzle 0.45.2 envuelve el error del driver en
 * un `DrizzleQueryError` y deja el `PostgresError` en `.cause`. O sea que las cuatro funciones
 * contestaban `null` / `'unknown'` para **todo error que pasara por Drizzle, que son todos**, y
 * seis `catch` de producción —el link ocupado del onboarding, "otra pestaña reservó", `LOST_RACE`,
 * `ALREADY_SOLD` y el código con el que el cron distingue un deadlock de una conexión caída— eran
 * código muerto. TypeScript no podía verlo: las cuatro funciones toman `unknown`.
 *
 * Lo único que lo habría visto es un test, y el test que faltaba es **este**: uno que le pida los
 * errores al driver. Un `{ code: '23505' }` escrito a mano es precisamente la forma que el driver
 * **nunca** produce — un helper probado contra una forma inventada afirma un mecanismo que no
 * toca, y sale verde por el motivo equivocado. Por eso acá hay una conexión real y cero literales
 * de error.
 *
 * ── Las dos formas, y por qué las dos tienen que seguir andando ───────────────────────────────
 * En producción conviven:
 *   - **envuelta**: todo lo que sale de `db.execute` / `tx.execute` / el builder de Drizzle;
 *   - **cruda**: lo que sale del cliente de `postgres-js` pelado.
 * El arreglo camina la cadena de `cause`, así que tiene que contestar lo mismo en las dos. Cada
 * grupo de abajo mide el par.
 *
 * ── Por qué algunos errores se piden con `raise ... using errcode` ────────────────────────────
 * Un deadlock real necesita dos transacciones peleándose por dos filas en orden cruzado: es lento,
 * es intrínsecamente temporizado y elige víctima al azar — o sea que en CI es un test que falla
 * sin que nadie haya roto nada. `raise exception using errcode = '40P01'` hace que **el backend**
 * mande el mismo `ErrorResponse` con `C=40P01`, que **el driver** parsea al mismo `PostgresError`
 * y que Drizzle envuelve igual. Lo que se ejercita es la cadena entera; lo único que se ahorra es
 * la carrera. El `23505` con nombre de constraint, en cambio, se provoca de verdad: es el caso que
 * la producción vive y el nombre del índice tiene que venir de Postgres, no de un `raise`.
 *
 * ── Tablas temporales, cero residuo ───────────────────────────────────────────────────────────
 * El fixture es una `temp table`: vive en la sesión y se va sola cuando la conexión cierra. No deja
 * una tabla sin `GRANT` en `public` si este archivo se muere a mitad de camino, que es justo lo que
 * `CLAUDE.md` §2 y `guard-grants.sh` miran.
 */
import { userInfo } from 'node:os';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEADLOCK, isDeadlock, pgErrorCode, uniqueViolationConstraint } from './pg-error';

const URL =
  process.env.DATABASE_URL ??
  `postgresql://${userInfo().username}@localhost:5432/${process.env.ISTOCK_DB ?? 'istock_dev'}`;

/**
 * `max: 1` no es prolijidad: la `temp table` vive en **la** sesión, y `db.transaction()` reserva una
 * conexión del pool. Con más de una, la transacción podría tomar otra y no ver el fixture.
 */
const client = postgres(URL, { max: 1, prepare: false, onnotice: () => {} });
const db = drizzle(client);

const K_KEY = 'pg_error_probe_k_key';
const J_KEY = 'pg_error_probe_j_key';

/** Corre `fn` esperando que reviente, y devuelve lo que tiró. Si no revienta, el test falla acá. */
async function capturar(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error('se esperaba un error de Postgres y la query pasó: el caso no midió nada');
}

/** Lectura cruda del objeto, sólo para AFIRMAR la forma que llega. La producción usa el helper. */
function crudo(error: unknown): { code?: unknown; constraint_name?: unknown; cause?: unknown } {
  return (error ?? {}) as { code?: unknown; constraint_name?: unknown; cause?: unknown };
}

beforeAll(async () => {
  await client.unsafe(`
    create temp table pg_error_probe (
      k text constraint ${K_KEY} unique,
      j text constraint ${J_KEY} unique
    )
  `);
  await client.unsafe(`insert into pg_error_probe (k, j) values ('ocupado', 'tambien-ocupado')`);
}, 30_000);

afterAll(async () => {
  await client.end();
});

/**
 * ── El grupo que sostiene todo lo demás ───────────────────────────────────────────────────────
 * Si Drizzle dejara de envolver, el resto del archivo seguiría verde sin haber ejercitado el walk
 * ni una vez. Por eso acá se afirma **la forma medida** —`code` arriba es `undefined`, el
 * `PostgresError` está en `.cause`— antes de preguntarle nada al helper. El día que Drizzle cambie,
 * el que se pone rojo es este test, y el diagnóstico va a estar escrito en el mensaje de la
 * aserción en vez de aparecer como un 500 en el onboarding de alguien.
 */
describe('lo que llega a un catch de producción viene envuelto por Drizzle 0.45.2', () => {
  it('db.execute: DrizzleQueryError sin code, con el PostgresError en .cause', async () => {
    const error = await capturar(() =>
      db.execute(sql`insert into pg_error_probe (k) values ('ocupado')`),
    );

    expect(crudo(error).code).toBeUndefined();
    expect(crudo(error).constraint_name).toBeUndefined();
    expect(crudo(crudo(error).cause).code).toBe('23505');

    expect(uniqueViolationConstraint(error)).toBe(K_KEY);
    expect(pgErrorCode(error)).toBe('23505');
  }, 30_000);

  it('tx.execute: misma forma adentro de una transacción', async () => {
    const error = await capturar(() =>
      db.transaction(async (tx) => {
        await tx.execute(sql`insert into pg_error_probe (k) values ('ocupado')`);
      }),
    );

    expect(crudo(error).code).toBeUndefined();
    expect(crudo(crudo(error).cause).code).toBe('23505');

    expect(uniqueViolationConstraint(error)).toBe(K_KEY);
    expect(pgErrorCode(error)).toBe('23505');
  }, 30_000);

  it('el cliente pelado NO envuelve: el 23505 llega plano y tiene que seguir andando', async () => {
    const error = await capturar(() =>
      client.unsafe(`insert into pg_error_probe (k) values ('ocupado')`),
    );

    expect(crudo(error).code).toBe('23505');
    expect(crudo(error).constraint_name).toBe(K_KEY);

    expect(uniqueViolationConstraint(error)).toBe(K_KEY);
    expect(pgErrorCode(error)).toBe('23505');
  }, 30_000);
});

/**
 * ── El nombre de la constraint NO se relaja ───────────────────────────────────────────────────
 * Todos los call sites comparan el nombre (`=== ONE_SALE_PER_LISTING`, `=== SLUG_TAKEN`), y eso es
 * lo correcto: un `23505` desconocido presentado con el mensaje de uno conocido le pide a la
 * persona que arregle lo que no está roto. Estos dos casos existen para que "mapear cualquier
 * 23505" no se pueda colar como simplificación: el helper devuelve el nombre que Postgres mandó,
 * no el que el llamador esperaba.
 */
describe('un 23505 de otra constraint devuelve OTRO nombre, no el que el llamador espera', () => {
  it('envuelto', async () => {
    const error = await capturar(() =>
      db.execute(sql`insert into pg_error_probe (j) values ('tambien-ocupado')`),
    );
    expect(uniqueViolationConstraint(error)).toBe(J_KEY);
    expect(uniqueViolationConstraint(error)).not.toBe(K_KEY);
  }, 30_000);

  it('plano', async () => {
    const error = await capturar(() =>
      client.unsafe(`insert into pg_error_probe (j) values ('tambien-ocupado')`),
    );
    expect(uniqueViolationConstraint(error)).toBe(J_KEY);
    expect(uniqueViolationConstraint(error)).not.toBe(K_KEY);
  }, 30_000);
});

/**
 * ── `unnamed`, y que venga de Postgres importa ────────────────────────────────────────────────
 * El docblock de `uniqueViolationConstraint` dice que un `23505` sin nombre devuelve `'unnamed'` y
 * no `null`: sigue siendo una violación de unicidad, sólo que anónima, y una anónima no hereda el
 * mensaje de ninguna conocida. Que ese caso sea raro es motivo para medirlo, no para suponerlo.
 */
describe('un 23505 sin nombre de constraint es "unnamed", nunca null', () => {
  const SIN_NOMBRE = `do $$ begin raise exception 'sin constraint' using errcode = '23505'; end $$`;

  it('envuelto', async () => {
    const error = await capturar(() => db.execute(sql.raw(SIN_NOMBRE)));
    expect(crudo(crudo(error).cause).constraint_name).toBeUndefined();
    expect(uniqueViolationConstraint(error)).toBe('unnamed');
    expect(pgErrorCode(error)).toBe('23505');
  }, 30_000);

  it('plano', async () => {
    const error = await capturar(() => client.unsafe(SIN_NOMBRE));
    expect(crudo(error).constraint_name).toBeUndefined();
    expect(uniqueViolationConstraint(error)).toBe('unnamed');
  }, 30_000);
});

/**
 * ── El deadlock, que es el que hace que una carrera perdida no sea un 500 ─────────────────────
 * `reserve-unit.ts` y `publish-listing.ts` mapean `40P01` a "te ganaron de mano, recargá". Con el
 * error envuelto, `isDeadlock()` devolvía `false` y esas dos ramas nunca corrieron: la persona
 * parada en el mostrador veía un 500.
 */
describe('40P01 se reconoce como deadlock en las dos formas', () => {
  const DEADLOCK_SQL = `do $$ begin raise exception 'victima' using errcode = '40P01'; end $$`;

  it('envuelto', async () => {
    const error = await capturar(() => db.execute(sql.raw(DEADLOCK_SQL)));
    expect(pgErrorCode(error)).toBe(DEADLOCK);
    expect(isDeadlock(error)).toBe(true);
    expect(uniqueViolationConstraint(error)).toBeNull();
  }, 30_000);

  it('plano', async () => {
    const error = await capturar(() => client.unsafe(DEADLOCK_SQL));
    expect(pgErrorCode(error)).toBe(DEADLOCK);
    expect(isDeadlock(error)).toBe(true);
  }, 30_000);

  it('un 23505 no es un deadlock (si lo fuera, todo error sería una carrera perdida)', async () => {
    const error = await capturar(() =>
      db.execute(sql`insert into pg_error_probe (k) values ('ocupado')`),
    );
    expect(isDeadlock(error)).toBe(false);
  }, 30_000);
});

/**
 * ── Un SQLSTATE que no es ninguno de los dos conocidos ────────────────────────────────────────
 * `23503` (foreign_key_violation) es el control negativo de las dos funciones a la vez: no es una
 * violación de unicidad y no es un deadlock, pero **sí** tiene que salir en el log del cron con su
 * código. Un helper que devolviera `'unknown'` acá haría exactamente lo que el bug hacía.
 */
it('un SQLSTATE desconocido se loguea con su código y no se mapea a nada', async () => {
  const error = await capturar(() =>
    db.execute(sql.raw(`do $$ begin raise exception 'fk' using errcode = '23503'; end $$`)),
  );
  expect(pgErrorCode(error)).toBe('23503');
  expect(uniqueViolationConstraint(error)).toBeNull();
  expect(isDeadlock(error)).toBe(false);
}, 30_000);

/**
 * ── La conexión caída: el caso que `pgErrorCode` existe para distinguir ───────────────────────
 * El docblock de `pgErrorCode` dice, textual, que sirve para que `40P01` y una conexión caída no se
 * vean iguales como "falló". Medido: `postgres-js` reporta eso como un `Error` con
 * `code: 'CONNECTION_ENDED'` —que **no** es un SQLSTATE— y Drizzle **también lo envuelve**. O sea
 * que un walk que sólo aceptara SQLSTATE dejaría este caso en `'unknown'`, que es la mitad del
 * síntoma original. Este test es el que sostiene esa decisión del helper.
 */
describe('una conexión caída se distingue de un deadlock, envuelta y plana', () => {
  it('plano y envuelto contestan el código del driver, no "unknown"', async () => {
    const muerto = postgres(URL, { max: 1, prepare: false, onnotice: () => {} });
    const dbMuerto = drizzle(muerto);
    await muerto.unsafe('select 1');
    await muerto.end();

    const plano = await capturar(() => muerto.unsafe('select 1'));
    const envuelto = await capturar(() => dbMuerto.execute(sql`select 1`));

    expect(crudo(plano).code).toBe('CONNECTION_ENDED');
    expect(crudo(envuelto).code).toBeUndefined();
    expect(crudo(crudo(envuelto).cause).code).toBe('CONNECTION_ENDED');

    expect(pgErrorCode(plano)).toBe('CONNECTION_ENDED');
    expect(pgErrorCode(envuelto)).toBe('CONNECTION_ENDED');
    expect(isDeadlock(plano)).toBe(false);
    expect(isDeadlock(envuelto)).toBe(false);
    expect(uniqueViolationConstraint(envuelto)).toBeNull();
  }, 30_000);
});

/**
 * ── El walk es acotado, y eso se mide en las dos direcciones ──────────────────────────────────
 * Hoy la cadena real mide un eslabón. El helper no lo supone —envolver dos veces es lo que pasa el
 * día que agregamos un wrapper propio— pero tampoco camina para siempre: `cause` es una propiedad
 * cualquiera y un ciclo es un `while (true)` que cuelga el request en vez de fallar.
 */
describe('la cadena de cause se camina, pero con techo', () => {
  it('un PostgresError envuelto tres veces sigue siendo un 23505', async () => {
    const real = await capturar(() =>
      db.execute(sql`insert into pg_error_probe (k) values ('ocupado')`),
    );
    const hondo = new Error('capa 3', {
      cause: new Error('capa 2', { cause: new Error('capa 1', { cause: real }) }),
    });

    expect(uniqueViolationConstraint(hondo)).toBe(K_KEY);
    expect(pgErrorCode(hondo)).toBe('23505');
  }, 30_000);

  it('más allá del techo el helper se rinde: contesta "unknown", no cuelga', async () => {
    const real = await capturar(() =>
      db.execute(sql`insert into pg_error_probe (k) values ('ocupado')`),
    );
    let hondo: Error = real as Error;
    for (let i = 0; i < 20; i += 1) hondo = new Error(`capa ${i}`, { cause: hondo });

    expect(uniqueViolationConstraint(hondo)).toBeNull();
    expect(pgErrorCode(hondo)).toBe('unknown');
  }, 30_000);

  it('una cadena cíclica termina en vez de colgar el request', () => {
    const a: { cause?: unknown } = {};
    const b: { cause?: unknown } = { cause: a };
    a.cause = b;

    expect(pgErrorCode(a)).toBe('unknown');
    expect(uniqueViolationConstraint(a)).toBeNull();
    expect(isDeadlock(a)).toBe(false);
  }, 1_000);
});

/**
 * ── Lo que no es un error de Postgres sigue sin serlo ─────────────────────────────────────────
 * La contracara de todo lo de arriba: el arreglo camina más lugares, así que hay más maneras de
 * inventar un `23505` donde no lo hay. Un `catch` que traduce un `TypeError` a "ese link ya está
 * ocupado" es peor que uno que no traduce nada.
 */
describe('lo que no viene de Postgres no se convierte en un error de Postgres', () => {
  const NO_SON: readonly [string, unknown][] = [
    ['null', null],
    ['undefined', undefined],
    ['un string con el código adentro', '23505'],
    ['un Error pelado', new Error('boom')],
    ['un objeto con code numérico', { code: 23505 }],
    ['un objeto con code vacío', { code: '' }],
    ['un cause que no es objeto', new Error('x', { cause: '23505' })],
  ];

  for (const [nombre, valor] of NO_SON) {
    it(`${nombre} → null / "unknown" / false`, () => {
      expect(uniqueViolationConstraint(valor)).toBeNull();
      expect(pgErrorCode(valor)).toBe('unknown');
      expect(isDeadlock(valor)).toBe(false);
    });
  }
});
