import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Reservar y cancelar, con Postgres de mentira.
 *
 * Tres cosas y sólo tres, porque el resto ya tiene test en `packages/domain`:
 *
 * 1. **Quién decide.** La arista `available → reserved` la aprueba `checkTransition()` de
 *    `@istock/domain` con el entitlement y la reserva activa que le pasa este módulo. Si el
 *    entitlement está apagado no se escribe **nada**: ni el listing, ni la reserva, ni el evento.
 * 2. **La carrera la gana el motor, no un `if`.** Dos reservas simultáneas sobre la misma unidad:
 *    una escribe, la otra recibe un `23505` de `reservations_one_active_per_listing` y un mensaje
 *    propio. Una constraint **desconocida** se propaga: heredar el mensaje de la que conocemos es
 *    cómo se pierde un incidente (mismo criterio que `tenants/create-tenant.ts`).
 * 3. **La vidriera se entera.** `available → reserved` cambia el badge de la ficha y de la grilla
 *    (`storefront-agent` ya lo pinta en ámbar). Sin la invalidación, el equipo sigue diciendo
 *    "Disponible" en el CDN — que es exactamente la mentira de los estados de Instagram que el
 *    producto vino a matar.
 */

vi.mock('server-only', () => ({}));

const loadUnitForTransition = vi.fn();
vi.mock('../listings/queries', () => ({
  loadUnitForTransition: (...args: unknown[]) => loadUnitForTransition(...args) as unknown,
}));

const loadActiveReservation = vi.fn();
vi.mock('./queries', () => ({
  loadActiveReservation: (...args: unknown[]) => loadActiveReservation(...args) as unknown,
}));

const featureAccess = vi.fn();
vi.mock('../entitlements', () => ({
  FEATURE_RESERVATIONS: 'reservations',
  featureAccess: (...args: unknown[]) => featureAccess(...args) as unknown,
}));

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
  writes: [] as Recorded[],
  /** Filas que devuelve el `update ... where status = <from>`. 0 = otro dispositivo ganó. */
  listingUpdated: 1,
  /** Error a tirar en el `insert(reservations)`. Es donde muere el índice único parcial. */
  reservationInsertError: null as unknown,
  /** Error a tirar en el `update(listings)`. Es la primera fila que se lockea: ahí pega el `40P01`. */
  listingUpdateError: null as unknown,
};

function thenable<T>(produce: () => T): PromiseLike<T> & Record<string, unknown> {
  const builder = {
    where: () => builder,
    returning: () => builder,
    then: (resolve: (value: T) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve().then(produce).then(resolve, reject),
  };
  return builder as unknown as PromiseLike<T> & Record<string, unknown>;
}

const tx = {
  update: (table: unknown) => ({
    set: (row: Record<string, unknown>) =>
      thenable(() => {
        const isListing = table === listings;
        if (isListing && db.listingUpdateError !== null) throw db.listingUpdateError;
        if (isListing && db.listingUpdated === 0) return [];
        db.writes.push({ op: 'update', table, row });
        return [{ id: LISTING_ID }];
      }),
  }),
  insert: (table: unknown) => ({
    values: (row: Record<string, unknown>) =>
      thenable(() => {
        if (table === reservations && db.reservationInsertError !== null) {
          throw db.reservationInsertError;
        }
        db.writes.push({ op: 'insert', table, row });
        return [];
      }),
  }),
};

vi.mock('../db/session', () => ({
  withTenantDb: (_ctx: unknown, fn: (t: unknown) => unknown) => fn(tx),
  withServiceDb: (fn: (t: unknown) => unknown) => fn(tx),
}));

const { cancelReservation, reserveUnit } = await import('./reserve-unit');
const { listingEvents, listings, reservations } = await import('@istock/db');

const LISTING_ID = '3f2b1a90-7c4d-4e21-9b8a-0c1d2e3f4a5b';
const TENANT_ID = '11111111-2222-4333-8444-555555555555';
const NOW = new Date('2026-08-28T14:00:00.000Z');

const actor = {
  ctx: { userId: 'user-1', tenantId: TENANT_ID, role: 'owner' as const },
  // `trialEndsAt` viaja en el actor desde D2: la vigencia del trial se resuelve en
  // `featureAccess()`, así que el objeto que arma `panelActor()` la tiene que traer.
  tenant: { slug: 'nortecel', plan: 'negocio' as const, trialEndsAt: null },
};

function givenUnit(status: string): void {
  loadUnitForTransition.mockResolvedValue({
    id: LISTING_ID,
    slug: 'iphone-14-pro-256',
    status,
    kind: 'unit',
    condition: 'used_excellent',
    priceUsdCents: 620_00,
    qty: 1,
    catalogModelId: '4f1a0d2e-6b5c-4a3d-9e8f-0a1b2c3d4e5f',
    photoCount: 3,
  });
}

/** El `40P01` que tira Postgres cuando elige a esta transacción como víctima de un deadlock. */
function deadlock(): Error {
  return Object.assign(new Error('deadlock detected'), { code: '40P01' });
}

function uniqueViolation(constraint: string): Error {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    constraint_name: constraint,
  });
}

const rowsOf = (table: unknown): Recorded[] => db.writes.filter((w) => w.table === table);

const INPUT = { listingId: LISTING_ID, minutes: 90, customerLabel: 'Juan de Cipolletti' };

beforeEach(() => {
  vi.clearAllMocks();
  db.writes = [];
  db.listingUpdated = 1;
  db.reservationInsertError = null;
  db.listingUpdateError = null;
  featureAccess.mockResolvedValue({ ok: true });
  loadActiveReservation.mockResolvedValue(null);
  givenUnit('available');
});

describe('reserveUnit · el camino feliz', () => {
  it('mueve el listing a reserved y escribe la reserva con el tenant y el vencimiento', async () => {
    const result = await reserveUnit(actor, INPUT, NOW);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const reservation = rowsOf(reservations)[0];
    expect(reservation?.op).toBe('insert');
    expect(reservation?.row['tenantId']).toBe(TENANT_ID);
    expect(reservation?.row['listingId']).toBe(LISTING_ID);
    expect(reservation?.row['minutes']).toBe(90);
    expect(reservation?.row['customerLabel']).toBe('Juan de Cipolletti');
    // 90 minutos después de `now`. El vencimiento lo calcula `createReservation` del dominio.
    expect((reservation?.row['expiresAt'] as Date).toISOString()).toBe('2026-08-28T15:30:00.000Z');
    expect(result.expiresAt.toISOString()).toBe('2026-08-28T15:30:00.000Z');
    expect(reservation?.row['id']).toBe(result.reservationId);

    expect(rowsOf(listings)[0]?.row['status']).toBe('reserved');
    expect(rowsOf(listingEvents)[0]?.row).toMatchObject({
      tenantId: TENANT_ID,
      fromStatus: 'available',
      toStatus: 'reserved',
      kind: 'status_change',
    });
  });

  it('invalida la vidriera de ESE tenant, con el id de la unidad', async () => {
    await reserveUnit(actor, INPUT, NOW);
    expect(invalidateStorefrontUnit).toHaveBeenCalledWith('nortecel', LISTING_ID);
  });

  it('no loguea la etiqueta del cliente: se loguean ids, nunca texto de una persona', async () => {
    await reserveUnit(actor, INPUT, NOW);
    const logged = JSON.stringify(logEvent.mock.calls);
    expect(logged).not.toContain('Juan de Cipolletti');
  });
});

describe('reserveUnit · las puertas', () => {
  it('sin entitlement no escribe NADA y lo dice en castellano', async () => {
    featureAccess.mockResolvedValue({ ok: false, reason: 'plan' });

    const result = await reserveUnit(actor, INPUT, NOW);

    expect(result).toEqual({ ok: false, message: 'Eso viene con el plan Negocio.' });
    expect(db.writes).toHaveLength(0);
    expect(invalidateStorefrontUnit).not.toHaveBeenCalled();
  });

  /**
   * D2. **La acción rebota**, no sólo el botón: `/app/stock` deja de dibujar el formulario cuando el
   * trial venció, pero una tab abierta desde antes lo sigue teniendo, y un `POST` a mano no mira
   * ningún CSS. Y el texto no es el del plan: a alguien que estaba en el plan que **sí** incluye
   * reservas, "eso viene con el plan Negocio" le explica cualquier cosa menos lo que pasó.
   */
  it('con el trial vencido rebota en la acción y explica que se terminó la prueba', async () => {
    featureAccess.mockResolvedValue({ ok: false, reason: 'trial_expired' });

    const result = await reserveUnit(actor, INPUT, NOW);

    expect(result).toEqual({
      ok: false,
      message: 'Se te terminó la prueba, así que las reservas quedaron apagadas. Escribinos y lo vemos.',
    });
    expect(db.writes).toHaveLength(0);
    expect(invalidateStorefrontUnit).not.toHaveBeenCalled();
  });

  it('con una reserva activa ya existente rebota antes de tocar la base', async () => {
    loadActiveReservation.mockResolvedValue({
      id: 'r1',
      tenantId: TENANT_ID,
      expiresAt: new Date(NOW.getTime() + 60_000),
    });

    const result = await reserveUnit(actor, INPUT, NOW);

    expect(result).toEqual({ ok: false, message: 'Ya tiene una reserva activa.' });
    expect(db.writes).toHaveLength(0);
  });

  it('una unidad que no está disponible no se reserva', async () => {
    givenUnit('draft');
    const result = await reserveUnit(actor, INPUT, NOW);
    expect(result.ok).toBe(false);
    expect(db.writes).toHaveLength(0);
  });

  it('una unidad de otro tenant (o inexistente) no se distingue: no existe', async () => {
    loadUnitForTransition.mockResolvedValue(null);
    const result = await reserveUnit(actor, INPUT, NOW);
    expect(result).toEqual({ ok: false, message: 'No encontramos ese equipo.' });
  });
});

describe('reserveUnit · la carrera la corta el motor', () => {
  it('el índice único parcial gana: la segunda reserva recibe su propio mensaje', async () => {
    db.reservationInsertError = uniqueViolation('reservations_one_active_per_listing');

    const result = await reserveUnit(actor, INPUT, NOW);

    expect(result).toEqual({ ok: false, message: 'Ya tiene una reserva activa.' });
    expect(invalidateStorefrontUnit).not.toHaveBeenCalled();
  });

  it('una constraint DESCONOCIDA se propaga: no hereda el mensaje de la que sí conocemos', async () => {
    db.reservationInsertError = uniqueViolation('reservations_alguna_constraint_nueva');

    await expect(reserveUnit(actor, INPUT, NOW)).rejects.toThrow(/duplicate key/u);
    expect(logError).toHaveBeenCalledWith(
      'reservation.create.unknown_unique_violation',
      '23505',
      expect.objectContaining({ constraint: 'reservations_alguna_constraint_nueva' }),
    );
  });

  it('si otro dispositivo movió el listing primero, no nace ninguna reserva', async () => {
    db.listingUpdated = 0;

    const result = await reserveUnit(actor, INPUT, NOW);

    expect(result.ok).toBe(false);
    expect(rowsOf(reservations)).toHaveLength(0);
    expect(invalidateStorefrontUnit).not.toHaveBeenCalled();
  });

  /**
   * D1. Un `40P01` es una carrera perdida, no un 500: para quien está parado en el mostrador es
   * indistinguible de que otro dispositivo le haya ganado de mano, y se resuelve igual (recargando).
   * Sin esto, el `throw` sube hasta la Server Action —que no tiene `catch`— y el dueño termina en el
   * error boundary del panel porque el cron le tocó la misma fila.
   */
  it('un deadlock se cuenta como carrera perdida, no como 500', async () => {
    db.listingUpdateError = deadlock();

    const result = await reserveUnit(actor, INPUT, NOW);

    expect(result).toEqual({
      ok: false,
      message: 'Alguien cambió este equipo mientras lo mirabas. Recargá la pantalla.',
    });
    expect(logError).toHaveBeenCalledWith('reservation.create.deadlock', '40P01', {
      tenantId: TENANT_ID,
      listingId: LISTING_ID,
    });
    expect(invalidateStorefrontUnit).not.toHaveBeenCalled();
  });
});

describe('cancelReservation', () => {
  beforeEach(() => {
    givenUnit('reserved');
    loadActiveReservation.mockResolvedValue({
      id: 'r1',
      tenantId: TENANT_ID,
      // Todavía NO venció: cancelar a mano tiene que poder igual (intent = 'cancel').
      expiresAt: new Date(NOW.getTime() + 30 * 60_000),
    });
  });

  it('devuelve la unidad a available, cierra la reserva y avisa a la vidriera', async () => {
    const result = await cancelReservation(actor, LISTING_ID, NOW);

    expect(result.ok).toBe(true);
    expect(rowsOf(listings)[0]?.row['status']).toBe('available');
    expect(rowsOf(reservations)[0]?.op).toBe('update');
    expect(rowsOf(reservations)[0]?.row['status']).toBe('cancelled');
    expect(rowsOf(listingEvents)[0]?.row).toMatchObject({
      fromStatus: 'reserved',
      toStatus: 'available',
    });
    expect(invalidateStorefrontUnit).toHaveBeenCalledWith('nortecel', LISTING_ID);
  });

  it('una reserva de otro tenant no se cancela desde acá', async () => {
    loadActiveReservation.mockResolvedValue({
      id: 'r1',
      tenantId: 'otro-tenant',
      expiresAt: new Date(NOW.getTime() + 30 * 60_000),
    });

    const result = await cancelReservation(actor, LISTING_ID, NOW);

    expect(result).toEqual({ ok: false, message: 'Esa reserva no es de este negocio.' });
    expect(db.writes).toHaveLength(0);
  });

  it('si el listing ya no está reservado, no se inventa un evento', async () => {
    db.listingUpdated = 0;
    const result = await cancelReservation(actor, LISTING_ID, NOW);
    expect(result.ok).toBe(false);
    expect(rowsOf(listingEvents)).toHaveLength(0);
  });

  /** El mismo trato que en `reserveUnit`: esta era la función que no tenía `catch` (D1). */
  it('un deadlock contra el cron se cuenta como carrera perdida', async () => {
    db.listingUpdateError = deadlock();

    const result = await cancelReservation(actor, LISTING_ID, NOW);

    expect(result).toEqual({
      ok: false,
      message: 'Alguien cambió este equipo mientras lo mirabas. Recargá la pantalla.',
    });
    expect(logError).toHaveBeenCalledWith('reservation.cancel.deadlock', '40P01', {
      tenantId: TENANT_ID,
      listingId: LISTING_ID,
    });
  });

  /**
   * Cancelar **no** pide entitlement: si el downgrade dejara las reservas trabadas, el plan Base
   * sería una trampa con stock adentro. Se prueba con el trial vencido porque es el caso que D2
   * volvió alcanzable de verdad: hasta S6 nada bajaba nunca el plan.
   */
  it('con el trial vencido igual se puede soltar la propia unidad', async () => {
    featureAccess.mockResolvedValue({ ok: false, reason: 'trial_expired' });

    const result = await cancelReservation(actor, LISTING_ID, NOW);

    expect(result).toEqual({ ok: true });
    expect(rowsOf(listings)[0]?.row['status']).toBe('available');
  });
});
