import { beforeEach, describe, expect, it, vi } from 'vitest';

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
}

const db = {
  due: [] as Record<string, unknown>[],
  writes: [] as Recorded[],
  /** 0 = alguien ya cerró la reserva entre el `select` y el `update`. */
  reservationClosed: 1,
  /** 0 = el listing ya no estaba `reserved` (se vendió, se fue a service). */
  listingReleased: 1,
  updateError: null as unknown,
};

function thenable<T>(produce: () => T): PromiseLike<T> & Record<string, unknown> {
  const builder = {
    from: () => builder,
    innerJoin: () => builder,
    where: () => builder,
    orderBy: () => builder,
    limit: () => builder,
    returning: () => builder,
    then: (resolve: (value: T) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve().then(produce).then(resolve, reject),
  };
  return builder as unknown as PromiseLike<T> & Record<string, unknown>;
}

const tx = {
  select: () => thenable(() => db.due),
  update: (table: unknown) => ({
    set: (row: Record<string, unknown>) =>
      thenable(() => {
        if (db.updateError !== null) throw db.updateError;
        const affected = table === reservations ? db.reservationClosed : db.listingReleased;
        if (affected === 0) return [];
        db.writes.push({ op: 'update', table, row });
        return [{ id: 'x' }];
      }),
  }),
  insert: (table: unknown) => ({
    values: (row: Record<string, unknown>) =>
      thenable(() => {
        db.writes.push({ op: 'insert', table, row });
        return [];
      }),
  }),
};

vi.mock('../db/session', () => ({
  withTenantDb: (_ctx: unknown, fn: (t: unknown) => unknown) => fn(tx),
  withServiceDb: (fn: (t: unknown) => unknown) => fn(tx),
}));

const { expireDueReservations } = await import('./expire-reservations');
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
});

describe('expireDueReservations · sin nada que hacer', () => {
  it('no escribe, no invalida y no loguea un evento por corrida vacía', async () => {
    const result = await expireDueReservations(NOW);

    expect(result).toMatchObject({ scanned: 0, expired: 0, failed: 0 });
    expect(db.writes).toHaveLength(0);
    expect(invalidateStorefrontUnit).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
  });
});
