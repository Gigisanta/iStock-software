import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * El alta, con Postgres de mentira.
 *
 * Lo que se prueba es **qué filas nacen con el tenant**, no el SQL. El hallazgo S3.1 fue
 * exactamente eso: el alta insertaba `tenants` + `memberships` y nada más, así que un tenant real
 * nacía sin `fx_settings` y sin puntos de retiro. El read model de la vidriera corta con
 * `if (fx === null) return` — o sea que ese negocio cargaba 15 equipos y publicaba **cero**.
 *
 * La otra mitad es *dónde* nacen: las cuatro filas van en la **misma** transacción. Un tenant a
 * medio nacer deja el slug quemado (`tenants_slug_key` no lo suelta) y no hay pantalla para
 * arreglarlo.
 */

vi.mock('server-only', () => ({}));

const syncTenantClaim = vi.fn();
vi.mock('../auth/driver', () => ({
  authDriver: () => ({ syncTenantClaim: (...args: unknown[]) => syncTenantClaim(...args) }),
}));

const invalidateStorefront = vi.fn();
vi.mock('./storefront-cache', () => ({
  invalidateStorefront: (slug: string) => {
    invalidateStorefront(slug);
  },
  invalidateStorefrontUnit: vi.fn(),
  invalidateListing: vi.fn(),
}));

const logEvent = vi.fn();
vi.mock('../log', () => ({
  logEvent: (event: string, fields: unknown) => {
    logEvent(event, fields);
  },
  logError: vi.fn(),
}));

const TENANT_ID = '11111111-2222-4333-8444-555555555555';
const USER_ID = '99999999-8888-4777-8666-555555555555';

interface RecordedInsert {
  /** En qué invocación de `withServiceDb` cayó. Es lo que prueba "misma transacción". */
  readonly txIndex: number;
  readonly table: unknown;
  readonly row: Record<string, unknown>;
}

const db = {
  txCount: 0,
  inserts: [] as RecordedInsert[],
  /** Lo que devuelve el `select` (membresía previa). Vacío = esta persona todavía no tiene negocio. */
  selectRows: [] as unknown[],
  /** Si no es `null`, el `insert` de `tenants` tira este error. */
  insertError: null as unknown,
};

function thenable<T>(produce: () => T): PromiseLike<T> & Record<string, unknown> {
  const builder = {
    from: () => builder,
    where: () => builder,
    limit: () => builder,
    returning: () => builder,
    then: (resolve: (value: T) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve()
        .then(produce)
        .then(resolve, reject),
  };
  return builder as unknown as PromiseLike<T> & Record<string, unknown>;
}

const tx = {
  select: () => thenable(() => db.selectRows),
  insert: (table: unknown) => ({
    values: (row: Record<string, unknown>) =>
      thenable(() => {
        if (db.insertError !== null) throw db.insertError;
        db.inserts.push({ txIndex: db.txCount, table, row });
        return [{ id: TENANT_ID }];
      }),
  }),
};

vi.mock('../db/session', () => ({
  withServiceDb: (fn: (t: unknown) => unknown) => {
    db.txCount += 1;
    return fn(tx);
  },
}));

const { createTenant, createTenantSchema, INITIAL_PICKUP_POINT } = await import('./create-tenant');
const { fxSettings, locations, memberships, tenants } = await import('@istock/db');

const VALID_INPUT = {
  name: 'Norte Cel',
  slug: 'nortecel',
  waPhone: '2995551234',
  fxArsCentsPerUsd: '1487,50',
  acceptsTradeIn: true,
};

function parsedInput() {
  const parsed = createTenantSchema.safeParse(VALID_INPUT);
  if (!parsed.success) throw new Error(`el input de prueba no parsea: ${parsed.error.message}`);
  return parsed.data;
}

const rowsOf = (table: unknown): RecordedInsert[] => db.inserts.filter((i) => i.table === table);

beforeEach(() => {
  vi.clearAllMocks();
  db.txCount = 0;
  db.inserts = [];
  db.selectRows = [];
  db.insertError = null;
});

describe('createTenantSchema · el TC entra por el borde, con Zod', () => {
  it('convierte el TC tipeado a centavos de ARS por USD', () => {
    expect(parsedInput().fxArsCentsPerUsd).toBe(148_750);
  });

  it('sin TC no hay alta: es un campo obligatorio, no un default nuestro', () => {
    const parsed = createTenantSchema.safeParse({ ...VALID_INPUT, fxArsCentsPerUsd: '' });
    expect(parsed.success).toBe(false);
  });

  it('un TC con separador de miles se rechaza con el campo apuntado', () => {
    const parsed = createTenantSchema.safeParse({ ...VALID_INPUT, fxArsCentsPerUsd: '1.487' });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.path).toEqual(['fxArsCentsPerUsd']);
  });
});

describe('createTenant · las CUATRO filas del alta (S3.1)', () => {
  it('siembra tenant, membresía, fx_settings y un punto de retiro', async () => {
    const result = await createTenant(USER_ID, parsedInput());

    expect(result).toEqual({ ok: true, tenantId: TENANT_ID, slug: 'nortecel' });
    expect(rowsOf(tenants)).toHaveLength(1);
    expect(rowsOf(memberships)).toHaveLength(1);
    expect(rowsOf(fxSettings)).toHaveLength(1);
    expect(rowsOf(locations)).toHaveLength(1);
  });

  /**
   * Polaridad negativa de S3.1. Sacar el `insert(fxSettings)` de `createTenant` deja este test en
   * rojo con `expected 0 to be 1` — y sin él, la vidriera del tenant nuevo no publica nada.
   */
  it('sin fx_settings la vidriera no publica NADA: la fila existe o el alta está rota', async () => {
    await createTenant(USER_ID, parsedInput());

    expect(rowsOf(fxSettings)).toHaveLength(1);
  });

  it('las cuatro filas van en la MISMA transacción', async () => {
    await createTenant(USER_ID, parsedInput());

    const txIndexes = new Set(db.inserts.map((i) => i.txIndex));
    expect(txIndexes.size).toBe(1);
  });

  it('si el slug ya existe no queda ninguna fila colgada del alta', async () => {
    db.insertError = Object.assign(new Error('duplicate key'), { code: '23505' });

    const result = await createTenant(USER_ID, parsedInput());

    expect(result).toEqual({
      ok: false,
      field: 'slug',
      message: 'Ese link ya lo está usando otro negocio.',
    });
    expect(db.inserts).toEqual([]);
    expect(syncTenantClaim).not.toHaveBeenCalled();
    expect(invalidateStorefront).not.toHaveBeenCalled();
  });
});

describe('createTenant · el TC sembrado es el que puso el dueño', () => {
  it('guarda los centavos que salieron del borde, no un número nuestro', async () => {
    await createTenant(USER_ID, parsedInput());

    expect(rowsOf(fxSettings)[0]?.row).toMatchObject({
      tenantId: TENANT_ID,
      arsPerUsd: 148_750,
      updatedBy: USER_ID,
    });
  });

  /** `ceil_1000` es lo ratificado en FASE 2: nunca publica menos ARS que USD × TC. */
  it('el redondeo default es ceil_1000', async () => {
    await createTenant(USER_ID, parsedInput());

    expect(rowsOf(fxSettings)[0]?.row['rounding']).toBe('ceil_1000');
  });
});

describe('createTenant · el punto de retiro es un placeholder verdadero, no un dato falso', () => {
  it('nace activo y primero, o la ficha no lo muestra', async () => {
    await createTenant(USER_ID, parsedInput());

    expect(rowsOf(locations)[0]?.row).toMatchObject({
      tenantId: TENANT_ID,
      name: INITIAL_PICKUP_POINT.name,
      address: INITIAL_PICKUP_POINT.address,
      hours: INITIAL_PICKUP_POINT.hours,
      isActive: true,
      sortOrder: 0,
    });
  });

  /**
   * Esto sale publicado en la ficha de alguien que no conocemos. Una dirección inventada del Alto
   * Valle sería editable **y mentira**: manda a un cliente a una esquina que no existe.
   */
  it('no inventa una dirección: sin altura de calle y sin ciudad', async () => {
    await createTenant(USER_ID, parsedInput());

    const row = rowsOf(locations)[0]?.row ?? {};
    expect(String(row['address'])).not.toMatch(/\d/u);
    expect(row['city']).toBeUndefined();
  });
});

describe('createTenant · lo que ya hacía y sigue haciendo', () => {
  it('el claim va por syncTenantClaim y el cache del slug se invalida', async () => {
    await createTenant(USER_ID, parsedInput());

    expect(syncTenantClaim).toHaveBeenCalledWith(USER_ID, TENANT_ID);
    expect(invalidateStorefront).toHaveBeenCalledWith('nortecel');
  });

  it('el log deja la señal de S3.1 y no el valor del TC', async () => {
    await createTenant(USER_ID, parsedInput());

    expect(logEvent).toHaveBeenCalledWith('tenant.created', {
      tenantId: TENANT_ID,
      userId: USER_ID,
      plan: 'trial',
      fxSeeded: true,
      pickupPoints: 1,
    });
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain('148750');
  });

  it('quien ya tiene negocio no crea otro', async () => {
    db.selectRows = [{ id: 'membership-1' }];

    const result = await createTenant(USER_ID, parsedInput());

    expect(result).toEqual({ ok: false, field: 'form', message: 'Ya tenés un negocio creado.' });
    expect(db.inserts).toEqual([]);
  });
});
