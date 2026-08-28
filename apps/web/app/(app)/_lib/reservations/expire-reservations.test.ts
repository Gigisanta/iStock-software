import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { transitionEffects } from '@istock/domain';

/**
 * El barrido del cron, con Postgres de mentira.
 *
 * El invariante que sostiene esta slice es **idempotencia**: `ARCHITECTURE.md` §Jobs dice
 * *"correr el cron dos veces no rompe nada"*, y Vercel Cron no garantiza exactly-once. Acá eso se
 * consigue con dos cosas que se prueban abajo:
 *
 * - la decisión la toma `expireReservation()` de `@istock/domain` (puro, `now` inyectado), que
 *   sobre una reserva que no venció devuelve `changed: false` y el cron **no escribe**;
 * - los dos `update` van guardados por el estado de origen (`status = 'reserved'`, `status =
 *   'active'`). Si otro proceso ya lo movió, afectan 0 filas y el barrido no lo cuenta.
 *
 * Y el orden en que se escriben, que desde D1 es parte del contrato y no un detalle:
 * **`listings` → `reservations`**, el mismo del panel. Dos órdenes distintos sobre el mismo par de
 * tablas es un deadlock ABBA, y el que se invirtió fue este archivo.
 *
 * Y la mitad que le importa al producto: cada unidad liberada **invalida la vidriera de su
 * tenant**. Sin eso el equipo queda "Reservado" en el CDN hasta el próximo cambio de stock, o sea
 * escondido de la única página que lo vende.
 *
 * ── Y desde S6, el head-of-line ──────────────────────────────────────────────────────────────
 * Una fila que falla siempre conservaba su lugar en `order by expires_at asc`: volvía a ser la
 * primera del lote en cada corrida, para siempre, y con el lote lleno de filas así las sanas de
 * atrás no llegaban nunca. Tres afirmaciones abajo, y las tres hacen falta por separado:
 *
 * 1. el `order by` empieza por `sweep_attempts` (fallar te manda al fondo) y el `where` tiene el
 *    techo. Eso es forma del SQL, así que se prueba renderizando el SQL con el dialecto de
 *    Drizzle: el Postgres de mentira de este archivo ignora `where` y `orderBy` por construcción, y
 *    un test que sólo mira filas mockeadas pasaría en verde con el `order by` viejo;
 * 2. el `+1` va en **otra transacción** que la que falló. Adentro se rollea con ella y el techo
 *    queda escrito pero inalcanzable — arreglado en el código y roto en la base. Por eso cada
 *    escritura anota en qué transacción ocurrió y el test compara ese número, no el hecho de que
 *    la escritura exista;
 * 3. no poder anotar el intento se cuenta aparte (`unrecorded`), porque es el estado en el que el
 *    head-of-line vuelve entero y sin síntoma.
 */

vi.mock('server-only', () => ({}));

const invalidateStorefrontUnit = vi.fn();
vi.mock('../tenants/storefront-cache', () => ({
  invalidateStorefront: vi.fn(),
  invalidateStorefrontUnit: (slug: string, listingId: string) => {
    invalidateStorefrontUnit(slug, listingId);
  },
  invalidateListing: vi.fn(),
}));

const logEvent = vi.fn();
const logError = vi.fn();
vi.mock('../log', () => ({
  logEvent: (event: string, fields: unknown) => {
    logEvent(event, fields);
  },
  logError: (event: string, code: string, fields: unknown) => {
    logError(event, code, fields);
  },
}));

interface Recorded {
  readonly op: 'insert' | 'update';
  readonly table: unknown;
  readonly row: Record<string, unknown>;
  /** En qué transacción (`withServiceDb`) ocurrió. Es lo que distingue el `+1` de R2. */
  readonly txIndex: number;
}

/** Lo que el barrido le pidió a Postgres en el `select` del lote. */
interface Scan {
  where: unknown;
  orderBy: unknown[];
}

const dialect = new PgDialect();
const render = (node: unknown): string => dialect.sqlToQuery(node as SQL).sql;
const params = (node: unknown): unknown[] => dialect.sqlToQuery(node as SQL).params;

const db = {
  due: [] as Record<string, unknown>[],
  writes: [] as Recorded[],
  /** 0 = alguien ya cerró la reserva entre el `select` y el `update`. */
  reservationClosed: 1,
  /** 0 = el listing ya no estaba `reserved` (se vendió, se fue a service). */
  listingReleased: 1,
  updateError: null as unknown,
  /** Lo que devuelve el censo de abandonadas (las que pasaron `MAX_SWEEP_ATTEMPTS`). */
  abandoned: 0,
  /** El `+1` tampoco pudo escribirse: sin GRANT, sin conexión, lo que sea. */
  bumpError: null as unknown,
  /**
   * Lo que el `RETURNING` del `+1` deja ver: el contador **ya incrementado**, tal como quedó en la
   * fila. `null` = el `update` no afectó ninguna fila (la reserva se cerró en el medio), que es un
   * `[]` y no un cero.
   */
  bumpedTo: null as number | null,
  /** Cuántas transacciones se abrieron, y en cuál explotó la fila. */
  txIndex: 0,
  failedTxIndex: -1,
  scan: { where: null, orderBy: [] } as Scan,
};

function thenable<T>(produce: () => T, scan: Scan | null = null): PromiseLike<T> & Record<string, unknown> {
  const builder = {
    from: () => builder,
    innerJoin: () => builder,
    where: (condition: unknown) => {
      if (scan !== null) scan.where = condition;
      return builder;
    },
    orderBy: (...keys: unknown[]) => {
      if (scan !== null) scan.orderBy = keys;
      return builder;
    },
    limit: () => builder,
    returning: () => builder,
    then: (resolve: (value: T) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve().then(produce).then(resolve, reject),
  };
  return builder as unknown as PromiseLike<T> & Record<string, unknown>;
}

const tx = {
  // El censo de abandonadas es el único `select` que proyecta `total`; el otro es el lote.
  select: (fields: Record<string, unknown>) =>
    'total' in fields
      ? thenable(() => [{ total: db.abandoned }])
      : thenable(() => db.due, db.scan),
  update: (table: unknown) => ({
    set: (row: Record<string, unknown>) =>
      thenable(() => {
        // El `+1` de R2: es un update de `reservations` que toca el contador y nada más.
        if (table === reservations && 'sweepAttempts' in row) {
          if (db.bumpError !== null) throw db.bumpError;
          db.writes.push({ op: 'update', table, row, txIndex: db.txIndex });
          return db.bumpedTo === null ? [] : [{ sweepAttempts: db.bumpedTo }];
        }
        if (db.updateError !== null) {
          db.failedTxIndex = db.txIndex;
          throw db.updateError;
        }
        const affected = table === reservations ? db.reservationClosed : db.listingReleased;
        if (affected === 0) return [];
        db.writes.push({ op: 'update', table, row, txIndex: db.txIndex });
        return [{ id: 'x' }];
      }),
  }),
  insert: (table: unknown) => ({
    values: (row: Record<string, unknown>) =>
      thenable(() => {
        db.writes.push({ op: 'insert', table, row, txIndex: db.txIndex });
        return [];
      }),
  }),
};

vi.mock('../db/session', () => ({
  withTenantDb: (_ctx: unknown, fn: (t: unknown) => unknown) => fn(tx),
  withServiceDb: (fn: (t: unknown) => unknown) => {
    db.txIndex += 1;
    return fn(tx);
  },
}));

const { expireDueReservations, MAX_SWEEP_ATTEMPTS } = await import('./expire-reservations');
const { listingEvents, listings, reservations } = await import('@istock/db');

const NOW = new Date('2026-08-28T14:00:00.000Z');
const rowsOf = (table: unknown): Recorded[] => db.writes.filter((w) => w.table === table);

function due(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    reservationId: '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d',
    tenantId: '11111111-2222-4333-8444-555555555555',
    listingId: '3f2b1a90-7c4d-4e21-9b8a-0c1d2e3f4a5b',
    slug: 'nortecel',
    status: 'active',
    createdAt: new Date('2026-08-28T13:00:00.000Z'),
    expiresAt: new Date('2026-08-28T13:59:00.000Z'),
    sweepAttempts: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.due = [];
  db.writes = [];
  db.reservationClosed = 1;
  db.listingReleased = 1;
  db.updateError = null;
  db.bumpError = null;
  db.bumpedTo = null;
  db.abandoned = 0;
  db.txIndex = 0;
  db.failedTxIndex = -1;
  db.scan = { where: null, orderBy: [] };
});

describe('expireDueReservations · lo que libera', () => {
  it('cierra la reserva vencida, devuelve la unidad a available y deja el evento sin actor', async () => {
    db.due = [due()];

    const result = await expireDueReservations(NOW);

    expect(result).toMatchObject({ scanned: 1, expired: 1, released: 1, skipped: 0, failed: 0 });
    expect(rowsOf(reservations)[0]?.row['status']).toBe('expired');
    expect(rowsOf(listings)[0]?.row['status']).toBe('available');

    const event = rowsOf(listingEvents)[0]?.row;
    expect(event).toMatchObject({ fromStatus: 'reserved', toStatus: 'available', kind: 'status_change' });
    // `null` = lo hizo el cron, no una persona (schema de `listing_events`).
    expect(event?.['actorUserId']).toBeNull();
  });

  it('invalida la vidriera del tenant dueño de la unidad, con su slug', async () => {
    db.due = [due()];
    await expireDueReservations(NOW);
    expect(invalidateStorefrontUnit).toHaveBeenCalledWith(
      'nortecel',
      '3f2b1a90-7c4d-4e21-9b8a-0c1d2e3f4a5b',
    );
  });

  it('barre varios tenants en la misma pasada: es un cron, no una acción de tenant', async () => {
    db.due = [
      due(),
      due({
        reservationId: '1a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d',
        tenantId: '22222222-2222-4333-8444-555555555555',
        listingId: '5f2b1a90-7c4d-4e21-9b8a-0c1d2e3f4a5b',
        slug: 'otro-negocio',
      }),
    ];

    const result = await expireDueReservations(NOW);

    expect(result.expired).toBe(2);
    expect(invalidateStorefrontUnit.mock.calls.map((c) => c[0])).toEqual(['nortecel', 'otro-negocio']);
  });
});

describe('expireDueReservations · idempotencia', () => {
  it('una reserva que todavía no venció NO se toca, aunque el select la haya traído', async () => {
    db.due = [due({ expiresAt: new Date('2026-08-28T14:30:00.000Z') })];

    const result = await expireDueReservations(NOW);

    expect(result).toMatchObject({ scanned: 1, expired: 0, skipped: 1 });
    expect(db.writes).toHaveLength(0);
    expect(invalidateStorefrontUnit).not.toHaveBeenCalled();
  });

  it('una reserva que ya no está activa NO se toca', async () => {
    db.due = [due({ status: 'cancelled' })];

    const result = await expireDueReservations(NOW);

    expect(result).toMatchObject({ expired: 0, skipped: 1 });
    expect(db.writes).toHaveLength(0);
  });

  /**
   * El dueño canceló a mano entre el `select` y la transacción, o es la segunda corrida del mismo
   * cron. Los dos guards fallan a la vez **y eso no es casualidad**: con el orden de locks unificado,
   * quien cierra una reserva tomó antes el lock del listing y ya lo movió a `available`. Por eso el
   * caso se prueba con las dos filas en 0; una sola en 0 es el caso inconsistente de más abajo.
   */
  it('si otro proceso ya soltó la unidad y cerró la reserva, la segunda corrida no cuenta nada', async () => {
    db.due = [due()];
    db.reservationClosed = 0;
    db.listingReleased = 0;

    const result = await expireDueReservations(NOW);

    expect(result).toMatchObject({ expired: 0, released: 0 });
    expect(db.writes).toHaveLength(0);
    expect(invalidateStorefrontUnit).not.toHaveBeenCalled();
  });

  /**
   * El caso que la inversión de orden volvió alcanzable: la unidad sigue `reserved` pero su reserva
   * ya no está `active`. Es un estado inconsistente —nadie lo produce con el orden unificado— y el
   * barrido lo **repara**: libera la unidad, escribe el evento (la transición ocurrió de verdad) y
   * lo cuenta como `released` sin contarlo como `expired`, porque esta corrida no venció nada.
   */
  it('una unidad reserved sin reserva activa se libera igual: cuenta released, no expired', async () => {
    db.due = [due()];
    db.reservationClosed = 0;

    const result = await expireDueReservations(NOW);

    expect(result).toMatchObject({ expired: 0, released: 1 });
    expect(rowsOf(listings)[0]?.row['status']).toBe('available');
    expect(rowsOf(listingEvents)).toHaveLength(1);
  });

  it('si el listing ya no estaba reservado, la reserva se cierra igual pero no se inventa un evento', async () => {
    db.due = [due()];
    db.listingReleased = 0;

    const result = await expireDueReservations(NOW);

    expect(result).toMatchObject({ expired: 1, released: 0 });
    expect(rowsOf(reservations)[0]?.row['status']).toBe('expired');
    expect(rowsOf(listingEvents)).toHaveLength(0);
    // El stock visible no cambió: no hay nada que purgar del CDN.
    expect(invalidateStorefrontUnit).not.toHaveBeenCalled();
  });
});

describe('expireDueReservations · el orden de locks (D1)', () => {
  /**
   * `listings` primero, `reservations` después: el mismo orden que `cancelReservation()` y que
   * `transitionUnit()`. Hasta S6 este archivo iba al revés, y ese par invertido es exactamente el
   * ciclo que Postgres resuelve matando a una de las dos transacciones con `40P01` — a veces la del
   * dueño que está parado en el mostrador. El orden es lo único que lo evita; no hay reintento que
   * lo compense, porque un reintento sobre un ciclo de locks vuelve a chocar.
   */
  it('escribe el listing ANTES que la reserva', async () => {
    db.due = [due()];

    await expireDueReservations(NOW);

    expect(db.writes.map((w) => w.table)).toEqual([listings, reservations, listingEvents]);
  });
});

describe('expireDueReservations · una fila podrida no frena el barrido', () => {
  it('cuenta el fallo, loguea el id y sigue con la siguiente', async () => {
    db.due = [due()];
    db.updateError = Object.assign(new Error('deadlock detected'), { code: '40P01' });

    const result = await expireDueReservations(NOW);

    expect(result).toMatchObject({ scanned: 1, expired: 0, failed: 1 });
    expect(logError).toHaveBeenCalledWith(
      'reservation.expire.failed',
      '40P01',
      expect.objectContaining({ reservationId: '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d' }),
    );
  });

  /**
   * La primera vez que falla es contención normal: el dueño cancelando desde el mostrador la misma
   * reserva que el barrido está venciendo. Un cron rojo por eso enseña a ignorar el rojo.
   */
  it('la primera falla NO es `stuck`; la de una fila que ya venía fallando sí', async () => {
    db.updateError = Object.assign(new Error('deadlock detected'), { code: '40P01' });

    db.due = [due()];
    expect(await expireDueReservations(NOW)).toMatchObject({ failed: 1, stuck: 0 });

    db.due = [due({ sweepAttempts: 1 })];
    expect(await expireDueReservations(NOW)).toMatchObject({ failed: 1, stuck: 1 });
  });
});

describe('expireDueReservations · head-of-line (R2)', () => {
  /**
   * El `where` y el `order by` los ignora el Postgres de mentira de este archivo, así que acá se
   * renderiza el SQL de verdad con el dialecto de Drizzle. Sin esto, el `order by expires_at asc`
   * viejo dejaría todos los tests de este archivo en verde.
   */
  it('el `order by` empieza por `sweep_attempts`: fallar manda al fondo de la cola', async () => {
    db.due = [due()];

    await expireDueReservations(NOW);

    const keys = db.scan.orderBy.map(render);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toContain('"sweep_attempts"');
    expect(keys[1]).toContain('"expires_at"');
  });

  it('el `where` tiene el techo, así que una fila podrida deja de entrar al lote', async () => {
    db.due = [due()];

    await expireDueReservations(NOW);

    expect(render(db.scan.where)).toContain('"sweep_attempts" <');
    expect(params(db.scan.where)).toContain(MAX_SWEEP_ATTEMPTS);
  });

  /**
   * El corazón de R2. El `+1` adentro de la transacción que falló se rollea con ella: el contador
   * queda en 0, la fila vuelve a encabezar el `order by` y el techo de arriba nunca se alcanza.
   * Por eso no alcanza con ver que la escritura existe —también existiría escrita mal—: se compara
   * en qué transacción ocurrió.
   */
  it('el `+1` se escribe en OTRA transacción que la que falló', async () => {
    db.due = [due({ sweepAttempts: 2 })];
    db.updateError = Object.assign(new Error('deadlock detected'), { code: '40P01' });

    await expireDueReservations(NOW);

    const bump = db.writes.find((w) => w.table === reservations && 'sweepAttempts' in w.row);
    expect(bump).toBeDefined();
    expect(db.failedTxIndex).toBeGreaterThan(0);
    expect(bump?.txIndex).toBeGreaterThan(db.failedTxIndex);
  });

  it('una fila que no falló no gasta una transacción en anotar nada', async () => {
    db.due = [due()];

    await expireDueReservations(NOW);

    expect(db.writes.some((w) => 'sweepAttempts' in w.row)).toBe(false);
  });

  /**
   * Sin el `+1` la fila vuelve a encabezar el `order by` en la próxima corrida y nunca llega al
   * techo: el head-of-line vuelve entero y sin síntoma. Es la única forma de falla que se cuenta
   * desde la primera vez.
   */
  it('si tampoco se puede anotar el intento, se cuenta aparte y el barrido no se cae', async () => {
    db.due = [due()];
    db.updateError = Object.assign(new Error('deadlock detected'), { code: '40P01' });
    db.bumpError = Object.assign(new Error('permission denied'), { code: '42501' });

    const result = await expireDueReservations(NOW);

    expect(result).toMatchObject({ failed: 1, unrecorded: 1 });
    expect(logError).toHaveBeenCalledWith(
      'reservation.expire.attempt_unrecorded',
      '42501',
      expect.objectContaining({ reservationId: '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d' }),
    );
  });

  /**
   * Abandonar en silencio sería el mismo bug con otro disfraz: la unidad sigue trabada y ahora ni
   * siquiera aparece en los logs. Es además el único caso en el que "no hice nada" y "hay una
   * unidad trabada hace horas" se ven idénticos desde afuera, porque el lote viene vacío.
   */
  it('las que pasaron el techo se cuentan aparte y rompen el silencio del lote vacío', async () => {
    db.abandoned = 2;

    const result = await expireDueReservations(NOW);

    expect(result).toMatchObject({ scanned: 0, abandoned: 2 });
    expect(logEvent).toHaveBeenCalledWith(
      'reservation.expire.swept',
      expect.objectContaining({ abandoned: 2 }),
    );
  });
});

describe('expireDueReservations · la línea de cuarentena (T23)', () => {
  const FALLA = Object.assign(new Error('deadlock detected'), { code: '40P01' });

  const cuarentenas = (): unknown[] =>
    logEvent.mock.calls.filter((c) => c[0] === 'reservation.expire.quarantined');

  /**
   * El motivo de esta línea no es la economía —esa ya la dio el techo: una fila envenenada cuesta
   * `MAX_SWEEP_ATTEMPTS` líneas de `failed` y después silencio—, es la operación. Sin ella el cron
   * devuelve 500 con `abandoned: 3` y el que mira los logs tiene un número y **ningún id**: los ids
   * salieron por última vez en el intento anterior y saber qué unidades están trabadas pasa a ser
   * una consulta a mano contra la base.
   */
  it('el `+1` que deja el contador en el techo deja los ids en el log, una sola vez', async () => {
    db.due = [due({ sweepAttempts: MAX_SWEEP_ATTEMPTS - 1 })];
    db.updateError = FALLA;
    db.bumpedTo = MAX_SWEEP_ATTEMPTS;

    await expireDueReservations(NOW);

    expect(cuarentenas()).toHaveLength(1);
    expect(logEvent).toHaveBeenCalledWith('reservation.expire.quarantined', {
      reservationId: '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d',
      tenantId: '11111111-2222-4333-8444-555555555555',
      listingId: '3f2b1a90-7c4d-4e21-9b8a-0c1d2e3f4a5b',
      sweepAttempts: MAX_SWEEP_ATTEMPTS,
    });
  });

  /** La polaridad. Un fallo cualquiera no es una cuarentena; si lo fuera, volvimos a la línea por corrida. */
  it('un `+1` que no llega al techo no anuncia nada', async () => {
    db.due = [due({ sweepAttempts: 0 })];
    db.updateError = FALLA;
    db.bumpedTo = 1;

    const result = await expireDueReservations(NOW);

    expect(result).toMatchObject({ failed: 1 });
    expect(cuarentenas()).toHaveLength(0);
  });

  /**
   * El evento es del **cruce**, no del estado. Con `>=` en vez de `===`, cualquier `+1` posterior al
   * techo volvería a anunciar la misma fila y tendríamos de nuevo una línea por corrida con otro
   * nombre. El estado ya se reporta y ya es por corrida: es `abandoned` y el 500 de `route.ts`.
   */
  it('un contador que ya pasó el techo no vuelve a anunciarse', async () => {
    db.due = [due({ sweepAttempts: MAX_SWEEP_ATTEMPTS })];
    db.updateError = FALLA;
    db.bumpedTo = MAX_SWEEP_ATTEMPTS + 1;

    await expireDueReservations(NOW);

    expect(cuarentenas()).toHaveLength(0);
  });

  /**
   * Dos corridas seguidas sobre la misma fila: la primera la cruza, la segunda ya no la trae —el
   * `where` del lote la excluye, que es lo que hace que "una vez en la vida" no dependa de que
   * nadie se equivoque después.
   */
  it('la corrida siguiente ya no la trae, así que la línea no se repite', async () => {
    db.due = [due({ sweepAttempts: MAX_SWEEP_ATTEMPTS - 1 })];
    db.updateError = FALLA;
    db.bumpedTo = MAX_SWEEP_ATTEMPTS;
    await expireDueReservations(NOW);
    expect(cuarentenas()).toHaveLength(1);

    // Segunda corrida: el techo la sacó del lote y sólo queda en el censo de abandonadas.
    db.due = [];
    db.abandoned = 1;
    await expireDueReservations(NOW);

    expect(cuarentenas()).toHaveLength(1);
  });

  /** Sin `+1` escrito no hay cruce: la fila vuelve a encabezar el lote. Eso es `unrecorded`, no cuarentena. */
  it('si el `+1` no se pudo escribir, no se anuncia una cuarentena que no ocurrió', async () => {
    db.due = [due({ sweepAttempts: MAX_SWEEP_ATTEMPTS - 1 })];
    db.updateError = FALLA;
    db.bumpError = Object.assign(new Error('permission denied'), { code: '42501' });

    const result = await expireDueReservations(NOW);

    expect(result).toMatchObject({ unrecorded: 1 });
    expect(cuarentenas()).toHaveLength(0);
  });

  /**
   * El `update` no afectó ninguna fila: el dueño cerró la reserva desde el mostrador mientras el
   * barrido fallaba. No hay contador que haya cruzado nada, y anunciarlo sería anunciar una unidad
   * que ya está libre.
   */
  it('si el `+1` no afectó ninguna fila, tampoco', async () => {
    db.due = [due({ sweepAttempts: MAX_SWEEP_ATTEMPTS - 1 })];
    db.updateError = FALLA;
    db.bumpedTo = null;

    await expireDueReservations(NOW);

    expect(cuarentenas()).toHaveLength(0);
  });
});

describe('expireDueReservations · sin nada que hacer', () => {
  it('no escribe, no invalida y no loguea un evento por corrida vacía', async () => {
    const result = await expireDueReservations(NOW);

    expect(result).toMatchObject({ scanned: 0, expired: 0, failed: 0, abandoned: 0 });
    expect(db.writes).toHaveLength(0);
    expect(invalidateStorefrontUnit).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
  });
});

describe('expireDueReservations · el estado de cierre lo dice el dominio, no una constante de acá', () => {
  /**
   * Hasta esta slice el cron escribía `status: 'expired'` literal. No estaba mal el valor: estaba
   * mal el **lugar**. La misma arista (`reserved → available`) la cierra también el panel, y ahí el
   * estado es `'cancelled'`; con el mapeo escrito en cada call site nada obliga a que los dos sigan
   * de acuerdo, que es exactamente la forma del fallo de S6.
   *
   * Estos tests no fijan el string: fijan que lo que llega a la fila **es lo que devuelve la tabla
   * del dominio para la arista del cron**. Si el dominio cambia el mapeo, cambian juntos.
   */
  it('cierra con el `closesReservationAs` de la arista del cron', async () => {
    db.due = [due()];

    await expireDueReservations(NOW);

    const esperado = transitionEffects('reserved', 'available', 'expire').closesReservationAs;
    expect(esperado).not.toBeNull();
    expect(rowsOf(reservations)[0]?.row['status']).toBe(esperado);
  });

  /**
   * La mitad que un booleano no podía sostener: el `intent` **importa**. La misma arista sin
   * `'expire'` cierra `'cancelled'`, y ése es el valor que el cron escribiría en silencio si algún
   * día alguien le pasara `null` a la tabla. Si este test se pone en verde por los dos lados, el
   * cron dejó de distinguir "se venció sola" de "la soltó una persona".
   */
  it('NO escribe el estado de la misma arista sin intent: `expire` y `cancel` no son lo mismo', async () => {
    db.due = [due()];

    await expireDueReservations(NOW);

    const aMano = transitionEffects('reserved', 'available', null).closesReservationAs;
    expect(aMano).toBe('cancelled');
    expect(rowsOf(reservations)[0]?.row['status']).not.toBe(aMano);
  });
});
