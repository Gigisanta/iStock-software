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
 *
 * La tercera mitad —la agregó la migración `0005`— es **qué se le dice a la persona cuando pierde
 * una carrera**. Desde `0005` hay DOS `unique index` que tiran `23505` en esa misma transacción, y
 * significan cosas opuestas: uno dice "cambiá el link", el otro dice "ya tenés un negocio". Un
 * `23505` sin discriminar por `constraint_name` manda a la mitad de la gente a arreglar lo que no
 * está roto. Los tests de abajo miran el mensaje, no el código de error.
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
const logError = vi.fn();
vi.mock('../log', () => ({
  logEvent: (event: string, fields: unknown) => {
    logEvent(event, fields);
  },
  logError: (event: string, code: string, fields: unknown) => {
    logError(event, code, fields);
  },
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
  /**
   * Qué `insert` explota y con qué. `table` importa: la constraint del slug muere en el `insert`
   * de `tenants` y la de la membresía muere **una fila después**, con el tenant ya insertado en la
   * misma transacción. Un mock que falla siempre en el primer `insert` no puede distinguirlas.
   */
  insertError: null as { readonly table: unknown; readonly error: unknown } | null,
};

/**
 * Un `23505` como lo entrega `postgres-js`: `code` y `constraint_name`. Sin `constraint_name`
 * cuando se lo omite — ese caso también es una rama, y no la más obvia.
 */
function uniqueViolation(constraint?: string): Error {
  const error = Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
  });
  return constraint === undefined ? error : Object.assign(error, { constraint_name: constraint });
}

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
        if (db.insertError !== null && db.insertError.table === table) throw db.insertError.error;
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
    db.insertError = { table: tenants, error: uniqueViolation('tenants_slug_key') };

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

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Qué `23505` es cuál (migración `0005`)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `0005` agregó `memberships_single_owner_per_user_key` — `unique (user_id) where role = 'owner'`.
 * Desde entonces, la transacción del alta puede morir con `23505` por dos motivos que le piden a
 * la persona cosas **opuestas**:
 *
 * | constraint | qué pasó de verdad | qué tiene que hacer la persona |
 * |---|---|---|
 * | `tenants_slug_key` | el subdominio está tomado | elegir otro link |
 * | `memberships_single_owner_per_user_key` | ya tiene un negocio | **nada**: entrar al que tiene |
 *
 * Mapear los dos al mensaje del slug no es "un mensaje impreciso": es mandar a alguien a cambiar
 * el nombre de su negocio, reintentar, y fallar igual. Un error que manda al usuario a arreglar lo
 * que no está roto es peor que uno genérico.
 */
describe('createTenant · un 23505 no es un mensaje: hay que mirar QUÉ constraint murió', () => {
  it('slug tomado → el mensaje del link', async () => {
    db.insertError = { table: tenants, error: uniqueViolation('tenants_slug_key') };

    const result = await createTenant(USER_ID, parsedInput());

    expect(result).toEqual({
      ok: false,
      field: 'slug',
      message: 'Ese link ya lo está usando otro negocio.',
    });
  });

  /**
   * La carrera que cerró `0005`: dos altas concurrentes de la misma persona. El chequeo previo
   * `hasMembership()` vio 0 filas en las dos, la primera commiteó, la segunda muere acá.
   *
   * Hoy este test falla afirmando `'Ese link ya lo está usando otro negocio.'`, que es exactamente
   * el defecto: al que pierde la carrera se le dice que el problema es su link.
   */
  it('membresía duplicada → "Ya tenés un negocio creado.", NO el mensaje del link', async () => {
    db.insertError = {
      table: memberships,
      error: uniqueViolation('memberships_single_owner_per_user_key'),
    };

    const result = await createTenant(USER_ID, parsedInput());

    expect(result).toEqual({ ok: false, field: 'form', message: 'Ya tenés un negocio creado.' });
  });

  /**
   * El invariante que importa: **ganar o perder la carrera se ve igual desde afuera**. Si los dos
   * caminos no dan el mismo objeto, el resultado depende de milisegundos y hay dos copias del
   * mensaje esperando divergir.
   */
  it('perder la carrera se ve IGUAL que el chequeo previo, campo y texto', async () => {
    db.selectRows = [{ id: 'membership-1' }];
    const precheck = await createTenant(USER_ID, parsedInput());

    db.selectRows = [];
    db.insertError = {
      table: memberships,
      error: uniqueViolation('memberships_single_owner_per_user_key'),
    };
    const race = await createTenant(USER_ID, parsedInput());

    expect(race).toEqual(precheck);
  });

  it('la membresía duplicada no sincroniza claim ni invalida el cache del slug', async () => {
    db.insertError = {
      table: memberships,
      error: uniqueViolation('memberships_single_owner_per_user_key'),
    };

    await createTenant(USER_ID, parsedInput());

    expect(syncTenantClaim).not.toHaveBeenCalled();
    expect(invalidateStorefront).not.toHaveBeenCalled();
  });

  /**
   * La tercera constraint. Hoy este test falla porque el `catch` devuelve el mensaje del slug para
   * cualquier `23505`: un error desconocido presentado como uno conocido es cómo se pierde un
   * incidente. Se propaga, como ya se propaga cualquier otro error de Postgres que este módulo no
   * entiende — compartir el código `23505` con dos constraints conocidas no es motivo para heredar
   * su mensaje.
   */
  it('una constraint desconocida NO se traga: propaga', async () => {
    db.insertError = { table: fxSettings, error: uniqueViolation('fx_settings_pkey') };

    await expect(createTenant(USER_ID, parsedInput())).rejects.toThrow(/duplicate key/u);
  });

  it('la constraint desconocida queda logueada por nombre, que es lo que se investiga después', async () => {
    db.insertError = { table: fxSettings, error: uniqueViolation('fx_settings_pkey') };

    await expect(createTenant(USER_ID, parsedInput())).rejects.toThrow();

    expect(logError).toHaveBeenCalledWith(
      'tenant.create.unknown_unique_violation',
      '23505',
      expect.objectContaining({ userId: USER_ID, constraint: 'fx_settings_pkey' }),
    );
  });

  /**
   * Falla cerrada. Un `23505` sin `constraint_name` no es ninguna de las dos que conocemos, así
   * que tampoco puede llevarse el mensaje de ninguna. Postgres manda el campo desde 9.3 y
   * `postgres-js` lo expone, o sea que llegar acá ya es raro: razón de más para no adivinar.
   */
  it('un 23505 sin constraint_name tampoco hereda un mensaje: propaga', async () => {
    db.insertError = { table: tenants, error: uniqueViolation() };

    await expect(createTenant(USER_ID, parsedInput())).rejects.toThrow();
    expect(logError).toHaveBeenCalledWith(
      'tenant.create.unknown_unique_violation',
      '23505',
      expect.objectContaining({ constraint: 'unnamed' }),
    );
  });

  /** Lo de siempre: lo que no es `23505` sigue subiendo intacto. */
  it('un error que no es 23505 sigue propagando y no se loguea como unique violation', async () => {
    db.insertError = {
      table: tenants,
      error: Object.assign(new Error('deadlock detected'), { code: '40P01' }),
    };

    await expect(createTenant(USER_ID, parsedInput())).rejects.toThrow(/deadlock/u);
    expect(logError).not.toHaveBeenCalled();
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
