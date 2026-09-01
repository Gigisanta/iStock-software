import { DrizzleQueryError } from 'drizzle-orm/errors';
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

const fetchAutomaticFxQuote = vi.fn();
vi.mock('../fx/automatic-rate', () => ({
  fetchAutomaticFxQuote: () => fetchAutomaticFxQuote(),
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
 * Un `23505` **como llega de verdad al `catch`**, que no es como lo entrega `postgres-js`.
 *
 * Hasta el 2026-08-28 esta función devolvía el error plano (`code` y `constraint_name` en la raíz),
 * y por eso los cinco casos de abajo estaban verdes por el motivo equivocado: `createTenant` corre
 * sus `insert` por Drizzle, y **Drizzle 0.45.2 envuelve** lo que tira el driver en un
 * `DrizzleQueryError` con el `PostgresError` colgado en `.cause`. O sea que la forma que este
 * archivo afirmaba era la única que producción nunca produce — el alta con el link ocupado tiraba
 * un 500 con estos cinco tests en verde.
 *
 * El envoltorio es la clase real de Drizzle, no una imitación: si mañana alguien "simplifica" el
 * walk de `_lib/db/pg-error.ts`, estos tests se ponen rojos acá, al lado del mensaje que se pierde.
 * La forma plana no se abandona: la cubre `_lib/db/pg-error.test.ts` contra Postgres real, que es
 * el único lugar donde se puede afirmar sin inventar un error.
 */
function uniqueViolation(constraint?: string): Error {
  const pg = Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    ...(constraint === undefined ? {} : { constraint_name: constraint }),
  });
  return new DrizzleQueryError('insert into "tenants" ...', [], pg);
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
  fetchAutomaticFxQuote.mockResolvedValue({
    arsCentsPerUsd: 148_750,
    asOf: '2026-08-31',
    source: 'bcra',
  });
});

describe('createTenantSchema · el tipo de cambio no se pide al dueño', () => {
  it('valida sólo los datos que la persona necesita cargar', () => {
    expect(createTenantSchema.safeParse(VALID_INPUT).success).toBe(true);
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
  /**
   * Se afirma **identidad**, no el texto del mensaje. Con el error envuelto, el `message` de arriba
   * es el `Failed query: …` de Drizzle y el `duplicate key` vive en el `.cause`: un `toThrow(/…/)`
   * contra el texto pasaría a medir cuál de los dos mensajes quedó arriba, que no es lo que este
   * caso afirma. "Sube intacto" es exactamente `toBe` — el mismo objeto, sin traducir ni re-envolver.
   */
  it('una constraint desconocida NO se traga: propaga', async () => {
    const error = uniqueViolation('fx_settings_pkey');
    db.insertError = { table: fxSettings, error };

    await expect(createTenant(USER_ID, parsedInput())).rejects.toBe(error);
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

  /** Lo de siempre: lo que no es `23505` sigue subiendo intacto, envoltorio de Drizzle incluido. */
  it('un error que no es 23505 sigue propagando y no se loguea como unique violation', async () => {
    const error = new DrizzleQueryError(
      'insert into "tenants" ...',
      [],
      Object.assign(new Error('deadlock detected'), { code: '40P01' }),
    );
    db.insertError = { table: tenants, error };

    await expect(createTenant(USER_ID, parsedInput())).rejects.toBe(error);
    expect(logError).not.toHaveBeenCalled();
  });
});

describe('createTenant · el TC sembrado viene de la cotización automática', () => {
  it('guarda la cotización validada del BCRA y no la identidad del dueño como actualizador', async () => {
    await createTenant(USER_ID, parsedInput());

    expect(rowsOf(fxSettings)[0]?.row).toMatchObject({
      tenantId: TENANT_ID,
      arsPerUsd: 148_750,
      updatedBy: null,
    });
  });

  it('si el proveedor no responde no crea un negocio con precios inciertos', async () => {
    fetchAutomaticFxQuote.mockRejectedValue(new Error('provider unavailable'));

    const result = await createTenant(USER_ID, parsedInput());

    expect(result).toEqual({
      ok: false,
      field: 'form',
      message: 'No pudimos obtener la cotización del día. Esperá unos minutos y probá de nuevo.',
    });
    expect(db.inserts).toEqual([]);
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

  it('el log deja la señal de S3.1 y el origen de la cotización, no el valor', async () => {
    await createTenant(USER_ID, parsedInput());

    expect(logEvent).toHaveBeenCalledWith('tenant.created', {
      tenantId: TENANT_ID,
      userId: USER_ID,
      plan: 'trial',
      fxSeeded: true,
      fxSource: 'bcra',
      fxAsOf: '2026-08-31',
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
