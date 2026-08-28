import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `transitionUnit` con Postgres de mentira.
 *
 * Tres cosas:
 *
 * 1. Que la decisión la tome `@istock/domain` (no una tabla de aristas reescrita acá) **con el
 *    contexto real**, no con uno inventado. Ver el bloque de abajo: es el bug que S6 metió.
 * 2. Que la invalidación lleve el id de la unidad (S3.2).
 * 3. Que el efecto declarado por el dominio (`closesReservation`) se **ejecute**, en la misma
 *    transacción y después de haber movido el listing (orden de locks, D1).
 *
 * Qué aristas son legales y qué efectos tiene cada una ya tiene test en `packages/domain`;
 * repetirlo acá sería tener dos máquinas de estados otra vez.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  El caso que este archivo NO tenía, y por eso el bug pasó
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Todos los casos de la versión anterior partían de `draft` o de `available`, o sea de estados donde
 * no hay reserva viva. Con ese universo, `transitionUnit()` llamando a `transitionContextFor()` sin
 * extras —`activeReservation: null`, `reservations: false`— daba exactamente el mismo resultado que
 * la versión correcta, y la suite quedaba verde con la unidad reservada volviendo a la vidriera con
 * la seña puesta. La cobertura no era baja: era del lado equivocado del `if`.
 */

vi.mock('server-only', () => ({}));

const loadUnitForTransition = vi.fn();
vi.mock('./queries', () => ({
  loadUnitForTransition: (...args: unknown[]) => loadUnitForTransition(...args) as unknown,
}));

const loadActiveReservation = vi.fn();
vi.mock('../reservations/queries', () => ({
  loadActiveReservation: (...args: unknown[]) => loadActiveReservation(...args) as unknown,
}));

const featureAccess = vi.fn();
vi.mock('../entitlements', () => ({
  FEATURE_RESERVATIONS: 'reservations',
  featureAccess: (...args: unknown[]) => featureAccess(...args) as unknown,
}));

const invalidateStorefrontUnit = vi.fn();
const invalidateListing = vi.fn();
const invalidateStorefront = vi.fn();
vi.mock('../tenants/storefront-cache', () => ({
  invalidateStorefront: (slug: string) => {
    invalidateStorefront(slug);
  },
  invalidateStorefrontUnit: (slug: string, listingId: string) => {
    invalidateStorefrontUnit(slug, listingId);
  },
  invalidateListing: (slug: string, listingId: string) => {
    invalidateListing(slug, listingId);
  },
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
  /** Filas afectadas por el `update ... where status = <from>`. 0 = otro dispositivo ganó. */
  updated: 1,
  /** Error a tirar en el `update(listings)`: es la primera fila que se lockea. */
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
        if (isListing && db.updated === 0) return [];
        db.writes.push({ op: 'update', table, row });
        return [{ id: LISTING_ID }];
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
}));

const { transitionUnit } = await import('./publish-listing');
const { listingEvents, listings, reservations } = await import('@istock/db');

const LISTING_ID = '3f2b1a90-7c4d-4e21-9b8a-0c1d2e3f4a5b';
const TENANT_ID = 'tenant-1';
const NOW = new Date('2026-08-28T14:00:00.000Z');

const actor = {
  ctx: { userId: 'user-1', tenantId: TENANT_ID, role: 'owner' as const },
  tenant: { slug: 'lacoope', plan: 'negocio' as const, trialEndsAt: null },
};

function givenUnit(status: string, photoCount = 3): void {
  loadUnitForTransition.mockResolvedValue({
    id: LISTING_ID,
    slug: 'iphone-14-pro',
    status,
    kind: 'unit',
    condition: 'used_excellent',
    priceUsdCents: 62_000,
    qty: 1,
    catalogModelId: '00000000-0000-4000-8000-000000000001',
    photoCount,
  });
}

/** Una reserva de este tenant que todavía no venció: media hora por delante. */
function givenLiveReservation(): void {
  loadActiveReservation.mockResolvedValue({
    id: 'r1',
    tenantId: TENANT_ID,
    expiresAt: new Date(NOW.getTime() + 30 * 60_000),
  });
}

/** La misma reserva, un minuto pasada de hora. El cron todavía no la barrió. */
function givenExpiredReservation(): void {
  loadActiveReservation.mockResolvedValue({
    id: 'r1',
    tenantId: TENANT_ID,
    expiresAt: new Date(NOW.getTime() - 60_000),
  });
}

const rowsOf = (table: unknown): Recorded[] => db.writes.filter((w) => w.table === table);

beforeEach(() => {
  vi.clearAllMocks();
  db.updated = 1;
  db.writes = [];
  db.listingUpdateError = null;
  featureAccess.mockResolvedValue({ ok: true });
  loadActiveReservation.mockResolvedValue(null);
});

describe('transitionUnit · publicar', () => {
  it('publica una unidad completa', async () => {
    givenUnit('draft');

    await expect(transitionUnit(actor, LISTING_ID, 'available', NOW)).resolves.toEqual({
      ok: true,
      status: 'available',
    });
  });

  /**
   * **La aserción de S3.2 en este archivo.** Publicar mueve la grilla y la ficha, así que la
   * invalidación tiene que llevar el `listingId`: es lo único con lo que se puede armar
   * `listing:{uuid}`. Si alguien vuelve a `invalidateStorefront(tenantSlug)` —la firma vieja, sin
   * id— esto se cae con `expected "spy" to be called with arguments: [ 'lacoope', '3f2b…' ]`.
   */
  it('invalida CON el id de la unidad, no sólo con el slug del tenant', async () => {
    givenUnit('draft');

    await transitionUnit(actor, LISTING_ID, 'available', NOW);

    expect(invalidateStorefrontUnit).toHaveBeenCalledWith('lacoope', LISTING_ID);
    expect(invalidateStorefront).not.toHaveBeenCalled();
  });

  it('despublicar también saca la unidad de la vidriera y de su ficha', async () => {
    givenUnit('available');

    await transitionUnit(actor, LISTING_ID, 'draft', NOW);

    expect(invalidateStorefrontUnit).toHaveBeenCalledWith('lacoope', LISTING_ID);
  });

  it('el slug es el de la sesión: nunca se purga la vidriera de otro', async () => {
    givenUnit('draft');

    await transitionUnit(actor, LISTING_ID, 'available', NOW);

    expect(invalidateStorefrontUnit.mock.calls).toEqual([['lacoope', LISTING_ID]]);
  });

  it('publicar no cierra ninguna reserva: no hay ninguna que cerrar', async () => {
    givenUnit('draft');

    await transitionUnit(actor, LISTING_ID, 'available', NOW);

    expect(rowsOf(reservations)).toHaveLength(0);
  });
});

describe('transitionUnit · lo que NO invalida', () => {
  it('una unidad sin fotos no se publica y no toca el cache', async () => {
    givenUnit('draft', 0);

    const result = await transitionUnit(actor, LISTING_ID, 'available', NOW);

    expect(result.ok).toBe(false);
    expect(invalidateStorefrontUnit).not.toHaveBeenCalled();
    expect(invalidateListing).not.toHaveBeenCalled();
  });

  it('una unidad que no existe no toca el cache', async () => {
    loadUnitForTransition.mockResolvedValue(null);

    const result = await transitionUnit(actor, LISTING_ID, 'available', NOW);

    expect(result).toEqual({ ok: false, message: 'No encontramos ese equipo.' });
    expect(invalidateStorefrontUnit).not.toHaveBeenCalled();
  });

  /** El guard de concurrencia: otro dispositivo ya movió la unidad, así que no hubo cambio. */
  it('si el update afectó 0 filas no se invalida nada', async () => {
    givenUnit('draft');
    db.updated = 0;

    const result = await transitionUnit(actor, LISTING_ID, 'available', NOW);

    expect(result.ok).toBe(false);
    expect(invalidateStorefrontUnit).not.toHaveBeenCalled();
    expect(db.writes).toHaveLength(0);
  });
});

describe('transitionUnit · una unidad RESERVADA (el bug de S6)', () => {
  /**
   * El caso completo, tal como llega: una tab de `/app/stock` abierta desde antes de la reserva
   * manda `to='available'` sobre una unidad que ahora está `reserved`. Sin pasarle la reserva al
   * dominio, `checkRelease()` ve `reservation === null`, lo lee como "reparar un estado
   * inconsistente" y **aprueba**. Resultado en la base: `listing_status = available` con
   * `reservation_status = active`, o sea el equipo publicado como disponible con la seña puesta, e
   * irreservable (`23505`) hasta que el cron venza la reserva.
   */
  it('con la reserva viva NO se libera, y el motivo es el del dominio', async () => {
    givenUnit('reserved');
    givenLiveReservation();

    const result = await transitionUnit(actor, LISTING_ID, 'available', NOW);

    expect(result).toEqual({ ok: false, message: 'La reserva todavía no venció.' });
    expect(db.writes).toHaveLength(0);
    expect(invalidateStorefrontUnit).not.toHaveBeenCalled();
  });

  it('la reserva viva se lee de la base para ESA unidad y ESE tenant', async () => {
    givenUnit('reserved');
    givenLiveReservation();

    await transitionUnit(actor, LISTING_ID, 'available', NOW);

    expect(loadActiveReservation).toHaveBeenCalledWith(actor.ctx, LISTING_ID);
  });

  it('una reserva de otro tenant no habilita nada: el dominio la rechaza por tenant', async () => {
    givenUnit('reserved');
    loadActiveReservation.mockResolvedValue({
      id: 'r1',
      tenantId: 'otro-tenant',
      expiresAt: new Date(NOW.getTime() + 30 * 60_000),
    });

    const result = await transitionUnit(actor, LISTING_ID, 'available', NOW);

    expect(result).toEqual({ ok: false, message: 'Esa reserva no es de este negocio.' });
    expect(db.writes).toHaveLength(0);
  });

  /**
   * El otro lado del mismo invariante: cuando la transición **sí** procede, el efecto obligatorio
   * que declara el dominio (`transitionEffects().closesReservation`) se ejecuta. Salir de `reserved`
   * dejando la reserva `active` deja la unidad irreservable con el badge diciendo "En vidriera".
   */
  it('con la reserva vencida se libera Y se cierra la reserva, en la misma transacción', async () => {
    givenUnit('reserved');
    givenExpiredReservation();

    const result = await transitionUnit(actor, LISTING_ID, 'available', NOW);

    expect(result).toEqual({ ok: true, status: 'available' });
    expect(rowsOf(listings)[0]?.row['status']).toBe('available');
    expect(rowsOf(reservations)[0]?.op).toBe('update');
    expect(rowsOf(reservations)[0]?.row['status']).toBe('cancelled');
    expect(rowsOf(listingEvents)[0]?.row).toMatchObject({
      tenantId: TENANT_ID,
      fromStatus: 'reserved',
      toStatus: 'available',
      kind: 'status_change',
    });
  });

  /** D1: `listings` antes que `reservations`, siempre. Es el orden que evita el deadlock ABBA. */
  it('el listing se mueve ANTES que la reserva', async () => {
    givenUnit('reserved');
    givenExpiredReservation();

    await transitionUnit(actor, LISTING_ID, 'available', NOW);

    expect(db.writes.map((w) => w.table)).toEqual([listings, reservations, listingEvents]);
  });

  /**
   * `reserved → sold`: la reserva no se cancela, se **convierte**. El dominio dice que hay que
   * cerrarla y no en qué estado; el mapeo vive en `closingStatusFor()` y esto es lo que lo fija.
   */
  it('vender una unidad reservada cierra la reserva como confirmed', async () => {
    givenUnit('reserved');
    givenLiveReservation();

    const result = await transitionUnit(actor, LISTING_ID, 'sold', NOW);

    expect(result).toEqual({ ok: true, status: 'sold' });
    expect(rowsOf(reservations)[0]?.row['status']).toBe('confirmed');
  });

  it('si el listing ya se movió, no se cierra ninguna reserva ni se inventa un evento', async () => {
    givenUnit('reserved');
    givenExpiredReservation();
    db.updated = 0;

    const result = await transitionUnit(actor, LISTING_ID, 'available', NOW);

    expect(result.ok).toBe(false);
    expect(db.writes).toHaveLength(0);
  });

  /**
   * D1. Un `40P01` es una carrera perdida, no un 500: es lo mismo que ve alguien a quien le ganaron
   * de mano por un milisegundo, y se arregla igual (recargando). Sin esto sube a la Server Action,
   * que no tiene `catch`, y el dueño cae en el error boundary del panel.
   */
  it('un deadlock se cuenta como carrera perdida', async () => {
    givenUnit('reserved');
    givenExpiredReservation();
    db.listingUpdateError = Object.assign(new Error('deadlock detected'), { code: '40P01' });

    const result = await transitionUnit(actor, LISTING_ID, 'available', NOW);

    expect(result).toEqual({
      ok: false,
      message: 'Alguien cambió este equipo mientras lo mirabas. Recargá la pantalla.',
    });
    expect(logError).toHaveBeenCalledWith('listing.transition.deadlock', '40P01', {
      tenantId: TENANT_ID,
      listingId: LISTING_ID,
    });
    expect(invalidateStorefrontUnit).not.toHaveBeenCalled();
  });
});

describe('transitionUnit · el entitlement se lee de verdad', () => {
  /**
   * El default `false` mentía en los dos sentidos. Este es el sentido caro: `available → reserved`
   * con el tenant habilitado se rechazaba con "Eso viene con el plan Negocio" para alguien que lo
   * tiene contratado.
   */
  it('con el entitlement prendido, available → reserved no rebota por entitlement', async () => {
    givenUnit('available');

    const result = await transitionUnit(actor, LISTING_ID, 'reserved', NOW);

    expect(result).toEqual({ ok: true, status: 'reserved' });
    expect(featureAccess).toHaveBeenCalledWith(actor.ctx, actor.tenant, 'reservations', NOW);
  });

  it('con el trial vencido rebota, y el mensaje no habla del plan', async () => {
    givenUnit('available');
    featureAccess.mockResolvedValue({ ok: false, reason: 'trial_expired' });

    const result = await transitionUnit(actor, LISTING_ID, 'reserved', NOW);

    expect(result).toEqual({
      ok: false,
      message:
        'Se te terminó la prueba, así que las reservas quedaron apagadas. Escribinos y lo vemos.',
    });
    expect(db.writes).toHaveLength(0);
  });
});
