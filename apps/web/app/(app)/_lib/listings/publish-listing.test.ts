import { DrizzleQueryError } from 'drizzle-orm/errors';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListingStatus } from '@istock/domain';

/**
 * ── El error del driver llega ENVUELTO, y por eso las fábricas de abajo envuelven ─────────────
 *
 * `transitionUnit` corre por Drizzle, y **Drizzle 0.45.2** no propaga lo que tira `postgres-js`:
 * lo envuelve en un `DrizzleQueryError` y deja el `PostgresError` en `.cause`. Hasta el 2026-08-28
 * los casos de deadlock y de `ALREADY_SOLD` de este archivo armaban el error PLANO —`code` en la
 * raíz— y por eso estaban verdes mientras la rama que afirmaban era código muerto: la probe del
 * LEAD (`scripts/probes/s7-venta-manual.test.ts`, caso C2) vio la excepción escapar hasta arriba
 * con estos tests en verde.
 *
 * El envoltorio es la clase real de Drizzle, no una imitación: si alguien "simplifica" el walk de
 * `_lib/db/pg-error.ts`, estos tests se ponen rojos al lado del mensaje que se pierde. La forma
 * plana la cubre `_lib/db/pg-error.test.ts` contra Postgres real.
 */
function envueltoPorDrizzle(pg: Error): Error {
  return new DrizzleQueryError('update "listings" ...', [], pg);
}

function deadlock(): Error {
  return envueltoPorDrizzle(Object.assign(new Error('deadlock detected'), { code: '40P01' }));
}

function uniqueViolation(constraint: string): Error {
  return envueltoPorDrizzle(
    Object.assign(new Error('duplicate key'), { code: '23505', constraint_name: constraint }),
  );
}

/**
 * `transitionUnit` con Postgres de mentira.
 *
 * Tres cosas:
 *
 * 1. Que la decisión la tome `@istock/domain` (no una tabla de aristas reescrita acá) **con el
 *    contexto real**, no con uno inventado. Ver el bloque de abajo: es el bug que S6 metió.
 * 2. Que la invalidación lleve el id de la unidad (S3.2).
 * 3. Que el efecto declarado por el dominio (`closesReservationAs`) se **ejecute con el estado
 *    que el dominio dice**, en la misma transacción y después de haber movido el listing (orden de
 *    locks, D1).
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
  readonly op: 'insert' | 'update' | 'rpc';
  readonly table: unknown;
  readonly row: Record<string, unknown>;
}

const db = {
  writes: [] as Recorded[],
  /** Resultado del RPC optimista. 0 = otro dispositivo ganó. */
  rpcChanged: 1,
  /** Cantidad de llamadas a la puerta de estado. */
  rpcCalls: 0,
  /** Error a tirar en el RPC: es la primera operación que toma el lock del listing. */
  rpcError: null as unknown,
  /** Error a tirar en el `insert(sales)`. Sirve para el `23505` del índice único de D8. */
  saleInsertError: null as unknown,
  /**
   * Lo que devuelve el `select` de `fx_settings`. Vacío = este negocio no cargó el TC, que **no**
   * bloquea la venta (D4).
   */
  fxRows: [] as Record<string, unknown>[],
  /** Filas afectadas por el `update(reservations)`. Vacío = el cron la cerró primero. */
  reservationClosed: [] as { id: string }[],
  /** Tablas que se leyeron adentro de la transacción. */
  reads: [] as unknown[],
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
  /**
   * El único `select` que corre adentro de la transacción: el TC del tenant, que `recordSale()`
   * lee para congelar el ARS. Devuelve `db.fxRows` tal cual, así que el caso "este negocio no
   * cargó el TC" se escribe dejando el array vacío.
   */
  select: () => ({
    from: (table: unknown) => ({
      where: () => ({
        limit: () => {
          db.reads.push(table);
          return Promise.resolve(db.fxRows);
        },
      }),
    }),
  }),
  update: (table: unknown) => ({
    set: (row: Record<string, unknown>) =>
      thenable(() => {
        db.writes.push({ op: 'update', table, row });
        return db.reservationClosed;
      }),
  }),
  execute: async (query: unknown) => {
    db.rpcCalls += 1;
    if (db.rpcError !== null) throw db.rpcError;
    if (db.rpcChanged === 0) return [{ changed: 0 }];
    // `sql` conserva los parámetros en queryChunks; el último listing_status es el destino.
    const chunks = (query as { queryChunks?: readonly unknown[] }).queryChunks;
    const nextStatus = chunks?.[7];
    db.writes.push({
      op: 'rpc',
      table: listings,
      row: { status: typeof nextStatus === 'string' ? nextStatus : 'transitioned' },
    });
    return [{ changed: 1 }];
  },
  insert: (table: unknown) => ({
    values: (row: Record<string, unknown>) =>
      thenable(() => {
        if (table === sales && db.saleInsertError !== null) throw db.saleInsertError;
        db.writes.push({ op: 'insert', table, row });
        return [];
      }),
  }),
};

vi.mock('../db/session', () => ({
  withTenantDb: (_ctx: unknown, fn: (t: unknown) => unknown) => fn(tx),
}));

const { denyReasonText, transitionUnit } = await import('./publish-listing');
const { fxSettings, listingEvents, listings, reservations, sales } = await import('@istock/db');

const LISTING_ID = '3f2b1a90-7c4d-4e21-9b8a-0c1d2e3f4a5b';
const RESERVATION_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
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

/**
 * Una venta como la que arma la Server Action: lo **realmente cobrado** (D3) y con qué pagaron.
 * Nada más — el costo no está y no puede estar: no existe la forma de pasarlo por acá.
 */
const SALE = { to: 'sold', sale: { priceUsdCents: 62_050, paymentMethod: 'transfer' } } as const;

/** El TC del negocio: 1450,00 ARS por USD, redondeando al millar para arriba (el default). */
function givenFxSettings(): void {
  db.fxRows = [{ arsPerUsd: 145_000, rounding: 'ceil_1000' }];
}

beforeEach(() => {
  vi.clearAllMocks();
  db.rpcChanged = 1;
  db.rpcCalls = 0;
  db.writes = [];
  db.reads = [];
  db.rpcError = null;
  db.saleInsertError = null;
  db.fxRows = [];
  db.reservationClosed = [{ id: RESERVATION_ID }];
  featureAccess.mockResolvedValue({ ok: true });
  loadActiveReservation.mockResolvedValue(null);
});

describe('transitionUnit · publicar', () => {
  it('publica una unidad completa', async () => {
    givenUnit('draft');

    await expect(transitionUnit(actor, LISTING_ID, { to: 'available' }, NOW)).resolves.toEqual({
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

    await transitionUnit(actor, LISTING_ID, { to: 'available' }, NOW);

    expect(invalidateStorefrontUnit).toHaveBeenCalledWith('lacoope', LISTING_ID);
    expect(invalidateStorefront).not.toHaveBeenCalled();
  });

  it('despublicar también saca la unidad de la vidriera y de su ficha', async () => {
    givenUnit('available');

    await transitionUnit(actor, LISTING_ID, { to: 'draft' }, NOW);

    expect(invalidateStorefrontUnit).toHaveBeenCalledWith('lacoope', LISTING_ID);
  });

  it('el slug es el de la sesión: nunca se purga la vidriera de otro', async () => {
    givenUnit('draft');

    await transitionUnit(actor, LISTING_ID, { to: 'available' }, NOW);

    expect(invalidateStorefrontUnit.mock.calls).toEqual([['lacoope', LISTING_ID]]);
  });

  it('publicar no cierra ninguna reserva: no hay ninguna que cerrar', async () => {
    givenUnit('draft');

    await transitionUnit(actor, LISTING_ID, { to: 'available' }, NOW);

    expect(rowsOf(reservations)).toHaveLength(0);
  });
});

describe('transitionUnit · lo que NO invalida', () => {
  it('una unidad sin fotos no se publica y no toca el cache', async () => {
    givenUnit('draft', 0);

    const result = await transitionUnit(actor, LISTING_ID, { to: 'available' }, NOW);

    expect(result.ok).toBe(false);
    expect(invalidateStorefrontUnit).not.toHaveBeenCalled();
    expect(invalidateListing).not.toHaveBeenCalled();
  });

  it('una unidad que no existe no toca el cache', async () => {
    loadUnitForTransition.mockResolvedValue(null);

    const result = await transitionUnit(actor, LISTING_ID, { to: 'available' }, NOW);

    expect(result).toEqual({ ok: false, message: 'No encontramos ese equipo.' });
    expect(invalidateStorefrontUnit).not.toHaveBeenCalled();
  });

  /** El guard de concurrencia: otro dispositivo ya movió la unidad, así que no hubo cambio. */
  it('si el RPC afectó 0 filas no se invalida nada', async () => {
    givenUnit('draft');
    db.rpcChanged = 0;

    const result = await transitionUnit(actor, LISTING_ID, { to: 'available' }, NOW);

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

    const result = await transitionUnit(actor, LISTING_ID, { to: 'available' }, NOW);

    expect(result).toEqual({ ok: false, message: 'La reserva todavía no venció.' });
    expect(db.writes).toHaveLength(0);
    expect(invalidateStorefrontUnit).not.toHaveBeenCalled();
  });

  it('la reserva viva se lee de la base para ESA unidad y ESE tenant', async () => {
    givenUnit('reserved');
    givenLiveReservation();

    await transitionUnit(actor, LISTING_ID, { to: 'available' }, NOW);

    expect(loadActiveReservation).toHaveBeenCalledWith(actor.ctx, LISTING_ID);
  });

  it('una reserva de otro tenant no habilita nada: el dominio la rechaza por tenant', async () => {
    givenUnit('reserved');
    loadActiveReservation.mockResolvedValue({
      id: 'r1',
      tenantId: 'otro-tenant',
      expiresAt: new Date(NOW.getTime() + 30 * 60_000),
    });

    const result = await transitionUnit(actor, LISTING_ID, { to: 'available' }, NOW);

    expect(result).toEqual({ ok: false, message: 'Esa reserva no es de este negocio.' });
    expect(db.writes).toHaveLength(0);
  });

  /**
   * El otro lado del mismo invariante: cuando la transición **sí** procede, el efecto obligatorio
   * que declara el dominio (`transitionEffects().closesReservationAs`) se ejecuta. Salir de `reserved`
   * dejando la reserva `active` deja la unidad irreservable con el badge diciendo "En vidriera".
   */
  it('con la reserva vencida se libera Y se cierra la reserva, en la misma transacción', async () => {
    givenUnit('reserved');
    givenExpiredReservation();

    const result = await transitionUnit(actor, LISTING_ID, { to: 'available' }, NOW);

    expect(result).toEqual({ ok: true, status: 'available' });
    expect(db.rpcCalls).toBe(1);
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

    await transitionUnit(actor, LISTING_ID, { to: 'available' }, NOW);

    expect(db.writes.map((w) => w.table)).toEqual([listings, reservations, listingEvents]);
  });

  /**
   * `reserved → sold`: la reserva no se cancela, se **convierte**. El estado de cierre lo trae el
   * mismo efecto (`closesReservationAs`), no un mapeo local: esto fija que lo que llega a la fila
   * es el valor del dominio y no un `'cancelled'` por descarte.
   */
  it('vender una unidad reservada cierra la reserva como confirmed', async () => {
    givenUnit('reserved');
    givenLiveReservation();

    const result = await transitionUnit(actor, LISTING_ID, SALE, NOW);

    expect(result).toEqual({ ok: true, status: 'sold' });
    expect(rowsOf(reservations)[0]?.row['status']).toBe('confirmed');
  });

  it('si el listing ya se movió, no se cierra ninguna reserva ni se inventa un evento', async () => {
    givenUnit('reserved');
    givenExpiredReservation();
    db.rpcChanged = 0;

    const result = await transitionUnit(actor, LISTING_ID, { to: 'available' }, NOW);

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
    db.rpcError = deadlock();

    const result = await transitionUnit(actor, LISTING_ID, { to: 'available' }, NOW);

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

    const result = await transitionUnit(actor, LISTING_ID, { to: 'reserved' }, NOW);

    expect(result).toEqual({ ok: true, status: 'reserved' });
    expect(featureAccess).toHaveBeenCalledWith(actor.ctx, actor.tenant, 'reservations', NOW);
  });

  it('con el trial vencido rebota, y el mensaje no habla del plan', async () => {
    givenUnit('available');
    featureAccess.mockResolvedValue({ ok: false, reason: 'trial_expired' });

    const result = await transitionUnit(actor, LISTING_ID, { to: 'reserved' }, NOW);

    expect(result).toEqual({
      ok: false,
      message:
        'Se te terminó la prueba, así que las reservas quedaron apagadas. Escribinos y lo vemos.',
    });
    expect(db.writes).toHaveLength(0);
  });

  /**
   * El otro motivo, por el camino entero: `featureAccess()` → `checkTransition()` → copy. Se afirma
   * el mensaje **renderizado** y no el `reason`, porque el defecto que esto cierra era de copy: el
   * enum ya distinguía los casos en `(billing)` y el panel los aplastaba a los dos contra el mismo
   * texto.
   */
  it('con la feature apagada a mano rebota, y tampoco habla del plan', async () => {
    givenUnit('available');
    featureAccess.mockResolvedValue({ ok: false, reason: 'flag_off' });

    const result = await transitionUnit(actor, LISTING_ID, { to: 'reserved' }, NOW);

    expect(result).toEqual({
      ok: false,
      message: 'Las reservas están apagadas en tu cuenta. No es el plan: escribinos y te las prendemos.',
    });
    expect(db.writes).toHaveLength(0);
  });
});

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  El copy del entitlement: un texto por motivo, y ninguno miente sobre el plan
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `denyReasonText()` es puro, así que se prueba directo y no a través de una transición. Lo que se
 * fija acá es el **texto**, no el enum: el defecto que cerró esta slice (2026-08-28, lo reportó
 * `billing-agent`) era que la fila apagada llegaba como `plan` y salía como *"Eso viene con el plan
 * Negocio."* a un tenant que tiene el plan Negocio. Un test sobre el `reason` no lo hubiera visto —
 * el `reason` era coherente con su propio mapeo; el que mentía era el string.
 *
 * Por eso cada caso afirma el string exacto **y** que no es el del plan. El día que alguien vuelva a
 * mapear `flag_off` (o un motivo nuevo) al mensaje del plan, esto se pone rojo en el string, que es
 * donde se ve el bug.
 */
describe('denyReasonText · el copy del entitlement', () => {
  const PLAN_TEXT = 'Eso viene con el plan Negocio.';

  it('sin el plan contratado: el texto del plan, el único caso donde es cierto', () => {
    expect(denyReasonText('entitlement_required', { ok: false, reason: 'plan' })).toBe(PLAN_TEXT);
  });

  it('trial vencido: dice que se terminó la prueba y no lo manda a comprar lo que tenía', () => {
    const text = denyReasonText('entitlement_required', { ok: false, reason: 'trial_expired' });

    expect(text).toBe(
      'Se te terminó la prueba, así que las reservas quedaron apagadas. Escribinos y lo vemos.',
    );
    expect(text).not.toContain('plan Negocio');
  });

  it('apagada a mano: dice que está apagada en su cuenta y a quién escribirle', () => {
    const text = denyReasonText('entitlement_required', { ok: false, reason: 'flag_off' });

    expect(text).toBe(
      'Las reservas están apagadas en tu cuenta. No es el plan: escribinos y te las prendemos.',
    );
    // Las tres partes que el copy tiene que tener, por si alguien lo reescribe "más corto".
    expect(text).toContain('tu cuenta');
    expect(text).toContain('No es el plan');
    expect(text).toContain('escribinos');
  });

  /** La aserción del bug, escrita como bug: `flag_off` NO puede renderizar el texto del plan. */
  it('apagada a mano NO renderiza el texto del plan: es el defecto que esta slice cerró', () => {
    const text = denyReasonText('entitlement_required', { ok: false, reason: 'flag_off' });

    expect(text).not.toBe(PLAN_TEXT);
    expect(text).not.toContain('plan Negocio');
  });

  /** Los tres motivos dan tres textos distintos: ninguno se aplasta contra otro. */
  it('un texto por motivo, sin colisiones', () => {
    const textos = (['plan', 'trial_expired', 'flag_off'] as const).map((reason) =>
      denyReasonText('entitlement_required', { ok: false, reason }),
    );

    expect(new Set(textos).size).toBe(textos.length);
  });

  /**
   * El default documentado. `entitlement_required` sin `access` no ocurre hoy —los dos call sites
   * que pueden producirlo lo pasan—, y si ocurriera el texto del plan es el único que no le
   * atribuye al negocio algo que nadie verificó.
   */
  it('sin `access`, `entitlement_required` cae al texto del plan', () => {
    expect(denyReasonText('entitlement_required')).toBe(PLAN_TEXT);
  });

  /** `access` sólo cambia `entitlement_required`: no puede contaminar otro motivo del dominio. */
  it('un `access` apagado no cambia el texto de un motivo que no es de entitlement', () => {
    expect(denyReasonText('missing_price', { ok: false, reason: 'flag_off' })).toBe(
      'Falta el precio en dólares.',
    );
  });
});

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  S7 · el CUARTO efecto: `createsSale`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `transitionEffects()` declara cuatro efectos y esta función ejecutaba tres. El que faltaba no
 * dejaba rastro: la unidad quedaba `sold`, la reserva `confirmed`, la vidriera purgada, y `sales`
 * vacía. Los tests de acá abajo son los que rompen si alguien lo vuelve a descartar.
 *
 * Lo que este archivo NO puede afirmar, y por eso no lo simula: que el subselect del costo devuelva
 * el valor de `listings`, que `margin_usd` la derive Postgres, y que el índice único de D8 exista.
 * Eso pide un motor de verdad y es de `scripts/probes/s7-*` (LEAD) y de `tests/` (`qa-agent`).
 * Acá se afirma lo que decide **este** código: que la fila se escriba, adentro de la transacción,
 * con lo que corresponde y sin lo que no.
 */
describe('transitionUnit · la venta se registra (S7)', () => {
  it('vender escribe la fila de sales, en la misma transacción y después de la reserva', async () => {
    givenUnit('reserved');
    givenLiveReservation();
    givenFxSettings();

    const result = await transitionUnit(actor, LISTING_ID, SALE, NOW);

    expect(result).toEqual({ ok: true, status: 'sold' });
    // El orden es el de los locks: `listings` → `reservations` → `sales` → `listing_events`.
    expect(db.writes.map((w) => w.table)).toEqual([listings, reservations, sales, listingEvents]);
  });

  /** Venta directa: nunca hubo seña, así que no hay reserva que cerrar ni que enlazar. */
  it('desde available se vende sin reserva, y sales.reservation_id queda null', async () => {
    givenUnit('available');
    givenFxSettings();

    const result = await transitionUnit(actor, LISTING_ID, SALE, NOW);

    expect(result).toEqual({ ok: true, status: 'sold' });
    expect(rowsOf(reservations)).toHaveLength(0);
    expect(rowsOf(sales)[0]?.row['reservationId']).toBeNull();
  });

  /**
   * La venta se ata a **la** reserva que esta transacción acaba de cerrar, con el id que devolvió
   * el `update`. Si se usara el id leído antes de la transacción, una reserva que el cron venció en
   * el medio quedaría enlazada a una venta que no convirtió.
   */
  it('la venta se enlaza al id que devolvió el cierre de la reserva', async () => {
    givenUnit('reserved');
    givenLiveReservation();

    await transitionUnit(actor, LISTING_ID, SALE, NOW);

    expect(rowsOf(sales)[0]?.row['reservationId']).toBe(RESERVATION_ID);
  });

  /** El cron cerró la reserva primero: la venta entra igual, sin enlace. No se pierde el hecho. */
  it('si el cierre no afectó ninguna fila, la venta entra con reservation_id null', async () => {
    givenUnit('reserved');
    givenLiveReservation();
    db.reservationClosed = [];

    const result = await transitionUnit(actor, LISTING_ID, SALE, NOW);

    expect(result).toEqual({ ok: true, status: 'sold' });
    expect(rowsOf(sales)[0]?.row['reservationId']).toBeNull();
  });

  /** D7: de la sesión, nunca del formulario. Y D3: el precio es el que se cobró. */
  it('sold_by sale de la sesión y price_usd es lo cobrado', async () => {
    givenUnit('available');

    await transitionUnit(actor, LISTING_ID, SALE, NOW);

    expect(rowsOf(sales)[0]?.row).toMatchObject({
      tenantId: TENANT_ID,
      listingId: LISTING_ID,
      priceUsd: 62_050,
      paymentMethod: 'transfer',
      soldBy: 'user-1',
    });
  });

  /**
   * D2 en su mitad verificable desde acá: el `insert` **no nombra** `margin_usd` —Postgres rechaza
   * un insert que mencione una columna generada— y el costo no es un valor de JS sino un fragmento
   * de SQL. Si alguien "arregla" esto leyendo el costo a una variable, las dos aserciones caen: es
   * el momento exacto en que el costo entra al heap del server y puede terminar en un log.
   */
  it('el insert no nombra margin_usd y el costo viaja como SQL, no como número', async () => {
    givenUnit('available');

    await transitionUnit(actor, LISTING_ID, SALE, NOW);

    const row = rowsOf(sales)[0]?.row ?? {};
    expect(Object.keys(row)).not.toContain('marginUsd');
    expect(Object.keys(row)).not.toContain('margin_usd');
    expect(typeof row['costUsd']).not.toBe('number');
  });

  /** D6: el retorno del camino de venta es el mismo `{ ok, status }` que el de publicar. */
  it('el retorno no trae costo, margen ni notas internas', async () => {
    givenUnit('available');

    const result = await transitionUnit(actor, LISTING_ID, SALE, NOW);

    expect(Object.keys(result)).toEqual(['ok', 'status']);
    expect(JSON.stringify(result)).not.toMatch(/cost|margin|internal/iu);
  });

  /** D4: el ARS se congela con el TC del negocio y su modo de redondeo, calculado en el server. */
  it('congela el ARS con el TC del tenant y el redondeo del tenant', async () => {
    givenUnit('available');
    givenFxSettings();

    await transitionUnit(actor, LISTING_ID, SALE, NOW);

    // 620,50 USD × 1450,00 = 899.725 ARS → techo al millar = 900.000 ARS.
    expect(rowsOf(sales)[0]?.row).toMatchObject({
      priceArs: 90_000_000,
      fxArsPerUsd: 145_000,
    });
    expect(db.reads).toEqual([fxSettings]);
  });

  /**
   * D4, el caso que importa en el mostrador: un negocio recién dado de alta no cargó el TC. No
   * vender por eso sería perder el hecho para conservar un dato informativo.
   */
  it('sin fx_settings la venta NO se bloquea: el ARS queda en null', async () => {
    givenUnit('available');
    db.fxRows = [];

    const result = await transitionUnit(actor, LISTING_ID, SALE, NOW);

    expect(result).toEqual({ ok: true, status: 'sold' });
    expect(rowsOf(sales)[0]?.row).toMatchObject({ priceArs: null, fxArsPerUsd: null });
  });

  /** Un TC guardado que el dominio no puede aplicar tampoco bloquea, y el log no lleva el número. */
  it('un TC inaplicable deja el ARS en null y no tira', async () => {
    givenUnit('available');
    db.fxRows = [{ arsPerUsd: 0, rounding: 'ceil_1000' }];

    const result = await transitionUnit(actor, LISTING_ID, SALE, NOW);

    expect(result).toEqual({ ok: true, status: 'sold' });
    expect(rowsOf(sales)[0]?.row).toMatchObject({ priceArs: null, fxArsPerUsd: null });
    expect(logError).toHaveBeenCalledWith('sale.fx_unusable', 'domain_fx_unusable', {
      tenantId: TENANT_ID,
      listingId: LISTING_ID,
    });
  });

  /**
   * D8 desde el lado de la aplicación: el `23505` del índice único no es un 500. Que el índice
   * exista lo afirma `packages/db`; que su violación se traduzca a un mensaje, esto.
   */
  it('una segunda venta de la misma unidad se cuenta como carrera perdida', async () => {
    givenUnit('available');
    db.saleInsertError = uniqueViolation('sales_one_sale_per_listing');

    const result = await transitionUnit(actor, LISTING_ID, SALE, NOW);

    expect(result).toEqual({ ok: false, message: 'Ese equipo ya figura vendido. Recargá la pantalla.' });
    expect(invalidateStorefrontUnit).not.toHaveBeenCalled();
  });

  /**
   * Otra violación de unicidad no se disfraza de "ya está vendido": sube.
   *
   * Se afirma **identidad**: con el error envuelto, el `message` de arriba es el `Failed query: …`
   * de Drizzle y el `duplicate key` está en el `.cause`. "Sube sin traducir" es el mismo objeto,
   * no un substring que mide cuál de los dos mensajes quedó arriba.
   */
  it('un 23505 de otra constraint no se traduce', async () => {
    givenUnit('available');
    const error = uniqueViolation('otra_cosa');
    db.saleInsertError = error;

    await expect(transitionUnit(actor, LISTING_ID, SALE, NOW)).rejects.toBe(error);
  });

  /**
   * Segunda venta de la misma unidad, por el camino que **de verdad** la corta: el dominio la
   * rechaza antes de abrir la transacción, así que no hay una segunda fila en `sales` ni un segundo
   * evento. El `23505` de arriba es la red de abajo, para la carrera de milisegundos.
   *
   * El motivo es `same_state` y no `terminal_state`, y no es un detalle: `checkTransition()`
   * pregunta `from === to` **antes** que `from === 'sold'`. Sólo llega a `terminal_state` quien
   * intenta salir de `sold` hacia otro estado. Se afirma el mensaje que el dueño ve de verdad; el
   * que uno esperaría leyendo la spec no es el que sale.
   */
  it('vender algo ya vendido no escribe nada', async () => {
    givenUnit('sold');

    const result = await transitionUnit(actor, LISTING_ID, SALE, NOW);

    expect(result).toEqual({ ok: false, message: 'Ya está así.' });
    expect(db.writes).toHaveLength(0);
  });

  /** Y salir de `sold` hacia cualquier otro lado sí es `terminal_state`: no hay vuelta atrás. */
  it('de sold no se sale a ningún lado', async () => {
    givenUnit('sold');

    const result = await transitionUnit(actor, LISTING_ID, { to: 'available' }, NOW);

    expect(result).toEqual({
      ok: false,
      message: 'Está vendido: no se puede volver atrás desde acá.',
    });
    expect(db.writes).toHaveLength(0);
  });

  /**
   * El camino que el copy viejo dejaba sin salida. La seña venció y el dominio manda a pasar por
   * `available` primero: el mensaje tiene que decir **qué apretar**, no describir el estado.
   */
  it('con la seña vencida no se vende, y el mensaje dice qué hacer', async () => {
    givenUnit('reserved');
    givenExpiredReservation();

    const result = await transitionUnit(actor, LISTING_ID, SALE, NOW);

    expect(result).toEqual({
      ok: false,
      message: 'Se venció la seña. Soltá la reserva y marcalo vendido de nuevo.',
    });
    expect(db.writes).toHaveLength(0);
  });

  /**
   * Una transición que **no** es venta no escribe en `sales`. Es la mitad simétrica del defecto: si
   * el efecto se ejecutara sin mirar `createsSale`, publicar un borrador registraría una venta.
   */
  it('publicar no escribe ninguna venta', async () => {
    givenUnit('draft');

    await transitionUnit(actor, LISTING_ID, { to: 'available' }, NOW);

    expect(rowsOf(sales)).toHaveLength(0);
  });
});

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  D5 · la aserción que corre en `tsc`, no en Vitest
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Esta función **no se ejecuta**: lo que se afirma es que cada `@ts-expect-error` tenga algo que
 * suprimir. Si alguien afloja `TransitionRequest` —un `sale?: SaleFields` opcional, una sobrecarga
 * con `ListingStatus` ancho—, el error desaparece y `tsc` falla con *"Unused '@ts-expect-error'
 * directive"*. O sea: el gate de D5 es `pnpm typecheck`, y no hay forma de dejarlo verde a medias.
 *
 * Un test de runtime no podría afirmar esto: el bug que D5 cierra es que el call site **compile**.
 */
async function d5CompileTimeAssertions(): Promise<void> {
  // @ts-expect-error `to: 'sold'` exige `sale`. Ésta es la línea que el defecto de S7 dejaba pasar.
  await transitionUnit(actor, LISTING_ID, { to: 'sold' }, NOW);

  // @ts-expect-error el error simétrico: datos de venta en una arista que no crea venta.
  await transitionUnit(actor, LISTING_ID, { to: 'draft', sale: SALE.sale }, NOW);

  const anywhere = 'sold' as ListingStatus;
  // @ts-expect-error un destino ANCHO no encaja en ninguna rama: hay que estrechar, y al estrechar
  // a 'sold' el compilador pide los datos de la venta.
  await transitionUnit(actor, LISTING_ID, { to: anywhere }, NOW);
}

describe('transitionUnit · D5', () => {
  it('las formas de vender sin datos de venta son errores de TypeScript', () => {
    // La aserción vive en los `@ts-expect-error` de arriba; acá sólo se la nombra para que exista.
    expect(typeof d5CompileTimeAssertions).toBe('function');
  });
});
