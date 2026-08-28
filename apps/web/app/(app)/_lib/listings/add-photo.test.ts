import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `addUnitPhoto` con Postgres y R2 de mentira.
 *
 * Lo que se prueba acá es **la decisión**, no el SQL: que el techo de `MAX_PHOTOS_PER_LISTING` se
 * respete cuando el `count(*)` de adentro de la transacción no coincide con el `photoCount` que se
 * leyó antes del upload. Ese desacuerdo es exactamente la carrera (N submits en paralelo desde
 * `/app/stock/{id}/fotos`), y acá se simula fijando los dos números por separado.
 *
 * Lo que **no** se prueba acá y no se puede: que el `for update` serialice de verdad. Eso necesita
 * dos conexiones a un Postgres real y vive en `tests/` (`qa-agent`), no en esta columna. El tx
 * falso no tiene locks; sí tiene el orden de las llamadas, que es lo que se verifica.
 */

vi.mock('server-only', () => ({}));

const uploadListingPhoto = vi.fn();
// Mock parcial: `schema.ts` (importado por cadena) lee `MAX_UPLOAD_BYTES` del mismo paquete y el
// cap de bytes es una constante real, no algo que este test deba inventar.
vi.mock('@istock/media', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  uploadListingPhoto: (input: unknown) => uploadListingPhoto(input) as unknown,
}));

const loadUnitForTransition = vi.fn();
vi.mock('./queries', () => ({
  loadUnitForTransition: (...args: unknown[]) => loadUnitForTransition(...args) as unknown,
}));

/**
 * Las dos invalidaciones son mocks **separados** a propósito: lo que se verifica en S3.2 no es
 * "se invalidó algo" sino **cuánto** se invalidó. Un solo espía que las tape a las dos dejaría
 * pasar justo el bug (purgar la vidriera entera por la segunda foto de un equipo).
 */
const invalidateStorefrontUnit = vi.fn();
const invalidateListing = vi.fn();
vi.mock('../tenants/storefront-cache', () => ({
  invalidateStorefront: vi.fn(),
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

/** Estado del "Postgres": lo que la transacción va a ver cuando cuente. */
const db = {
  listingExists: true,
  /** `count(*)` de `listing_photos` **adentro** de la transacción. */
  total: 0,
  maxSortOrder: -1,
  inserts: [] as { sortOrder: number; masterKey: string }[],
  updatedListing: 0,
  /** Orden de las operaciones, para verificar que el lock va antes del `count`. */
  calls: [] as string[],
};

/** Promesa perezosa: el builder es "thenable" así se puede `await` al final de la cadena. */
function thenable<T>(produce: () => T): PromiseLike<T> & Record<string, () => unknown> {
  const builder = {
    from: () => builder,
    where: () => builder,
    limit: () => builder,
    for: () => builder,
    set: () => builder,
    values: () => builder,
    then: (resolve: (value: T) => unknown) => Promise.resolve(produce()).then(resolve),
  };
  return builder as unknown as PromiseLike<T> & Record<string, () => unknown>;
}

const tx = {
  select(fields: Record<string, unknown>) {
    // El `select` del lock pide `id`; el de la cardinalidad pide `sortOrder`/`total`.
    if ('id' in fields) {
      db.calls.push('lock');
      return thenable(() => (db.listingExists ? [{ id: 'listing-1' }] : []));
    }
    db.calls.push('count');
    return thenable(() => [{ sortOrder: db.maxSortOrder + 1, total: db.total }]);
  },
  insert() {
    return {
      values: (row: { sortOrder: number; masterKey: string }) =>
        thenable(() => {
          db.calls.push('insert');
          db.inserts.push({ sortOrder: row.sortOrder, masterKey: row.masterKey });
          return [];
        }),
    };
  },
  update() {
    return {
      set: () =>
        thenable(() => {
          db.calls.push('update');
          db.updatedListing += 1;
          return [];
        }),
    };
  },
};

vi.mock('../db/session', () => ({
  withTenantDb: (_ctx: unknown, fn: (t: unknown) => unknown) => fn(tx),
}));

const { addUnitPhoto } = await import('./add-photo');
const { MAX_PHOTOS_PER_LISTING } = await import('./schema');

const ctx = { userId: 'user-1', tenantId: 'tenant-1', role: 'owner' } as const;
const uploaded = {
  masterKey: 'o/aa/bb.webp',
  thumbKey: 't/aa/bb.webp',
  cardKey: 'c/aa/bb.webp',
  detailKey: 'd/aa/bb.webp',
  width: 1600,
  height: 1200,
  variants: { card: { bytes: 120_000 } },
};

/** Lo que la unidad "tenía" cuando se leyó, antes del upload. */
function givenUnit(photoCount: number, status = 'available'): void {
  loadUnitForTransition.mockResolvedValue({
    id: 'listing-1',
    slug: 'iphone-14-pro',
    status,
    kind: 'unit',
    condition: 'used_excellent',
    priceUsdCents: 62000,
    qty: 1,
    catalogModelId: null,
    photoCount,
  });
}

const add = () => addUnitPhoto(ctx, 'lacoope', 'listing-1', new Uint8Array([1, 2, 3]));

beforeEach(() => {
  vi.clearAllMocks();
  db.listingExists = true;
  db.total = 0;
  db.maxSortOrder = -1;
  db.inserts = [];
  db.updatedListing = 0;
  db.calls = [];
  uploadListingPhoto.mockResolvedValue(uploaded);
});

describe('addUnitPhoto · camino feliz', () => {
  it('inserta con max(sort_order)+1 y devuelve el total nuevo', async () => {
    givenUnit(2);
    db.total = 2;
    db.maxSortOrder = 4; // hubo borrados: el orden no es el índice

    const result = await add();

    expect(result).toEqual({ ok: true, photoCount: 3 });
    expect(db.inserts).toEqual([{ sortOrder: 5, masterKey: uploaded.masterKey }]);
    expect(db.updatedListing).toBe(1);
    // Tercera foto: la grilla pinta `photos[0]` y no cambió. Se purga UNA ficha. Ver S3.2.
    expect(invalidateListing).toHaveBeenCalledWith('lacoope', 'listing-1');
    expect(invalidateStorefrontUnit).not.toHaveBeenCalled();
  });

  it('toma el lock del listing ANTES de contar y de insertar', async () => {
    givenUnit(0);

    await add();

    expect(db.calls).toEqual(['lock', 'count', 'insert', 'update']);
  });

  it('un borrador no invalida la vidriera: no existe para `anon`', async () => {
    givenUnit(1, 'draft');
    db.total = 1;
    db.maxSortOrder = 0;

    await expect(add()).resolves.toEqual({ ok: true, photoCount: 2 });
    expect(invalidateStorefrontUnit).not.toHaveBeenCalled();
    expect(invalidateListing).not.toHaveBeenCalled();
  });
});

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  S3.2 · cuánto se purga por una foto
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * El bug del board no era "no se invalida": era que **todo** se invalidaba. Con 200 equipos
 * publicados, la segunda foto de uno emitía `storefront:{slug}` y tiraba abajo la grilla más las
 * 200 fichas. Estos tests fijan la frontera y son de polaridad: el de "sólo la ficha" se cae si
 * alguien vuelve a la invalidación ancha, y el de "la primera foto" se cae si alguien la angosta
 * de más y deja la card de la grilla con el placeholder.
 */
describe('addUnitPhoto · granularidad de la invalidación (S3.2)', () => {
  it('la PRIMERA foto de una unidad publicada sí mueve la grilla: se purga la vidriera', async () => {
    givenUnit(0);
    db.total = 0;
    db.maxSortOrder = -1;

    await expect(add()).resolves.toEqual({ ok: true, photoCount: 1 });
    expect(invalidateStorefrontUnit).toHaveBeenCalledWith('lacoope', 'listing-1');
    expect(invalidateListing).not.toHaveBeenCalled();
  });

  it('la SEGUNDA foto no mueve la grilla: se purga una sola ficha', async () => {
    givenUnit(1);
    db.total = 1;
    db.maxSortOrder = 0;

    await expect(add()).resolves.toEqual({ ok: true, photoCount: 2 });
    expect(invalidateListing).toHaveBeenCalledWith('lacoope', 'listing-1');
    expect(invalidateStorefrontUnit).not.toHaveBeenCalled();
  });

  it('el slug sale de la sesión y el id de la unidad viaja siempre, para armar listing:{uuid}', async () => {
    givenUnit(1);
    db.total = 1;

    await add();

    expect(invalidateListing.mock.calls).toEqual([['lacoope', 'listing-1']]);
  });

  it('una unidad reservada también publica ficha: se invalida igual que una disponible', async () => {
    givenUnit(1, 'reserved');
    db.total = 1;
    db.maxSortOrder = 0;

    await add();

    expect(invalidateListing).toHaveBeenCalledWith('lacoope', 'listing-1');
  });
});

describe('addUnitPhoto · el techo de MAX_PHOTOS_PER_LISTING', () => {
  it('la guarda temprana corta ANTES de gastar R2', async () => {
    givenUnit(MAX_PHOTOS_PER_LISTING);
    db.total = MAX_PHOTOS_PER_LISTING;

    const result = await add();

    expect(result.ok).toBe(false);
    expect(uploadListingPhoto).not.toHaveBeenCalled();
    expect(db.calls).toEqual([]);
  });

  /**
   * El defecto TOCTOU: se leyó 7 antes de subir, pero mientras subíamos entraron las otras. Sin la
   * guarda de adentro de la transacción, esto insertaba la novena foto con `sort_order` 8 y el
   * techo dejaba de ser un techo.
   */
  it('aborta adentro de la transacción si el count llegó al techo mientras subíamos', async () => {
    givenUnit(MAX_PHOTOS_PER_LISTING - 1);
    db.total = MAX_PHOTOS_PER_LISTING;
    db.maxSortOrder = MAX_PHOTOS_PER_LISTING - 1;

    const result = await add();

    expect(result.ok).toBe(false);
    expect(db.inserts).toEqual([]);
    expect(db.updatedListing).toBe(0);
    expect(invalidateStorefrontUnit).not.toHaveBeenCalled();
    expect(invalidateListing).not.toHaveBeenCalled();
  });

  it('también aborta si el count se pasó del techo (N carreras ya perdidas)', async () => {
    givenUnit(1);
    db.total = MAX_PHOTOS_PER_LISTING + 3;

    await expect(add()).resolves.toEqual({
      ok: false,
      message: `Ya tiene ${String(MAX_PHOTOS_PER_LISTING)} fotos, que es el máximo por equipo.`,
    });
    expect(db.inserts).toEqual([]);
  });

  it('las dos guardas dicen exactamente lo mismo', async () => {
    givenUnit(MAX_PHOTOS_PER_LISTING);
    const early = await add();

    givenUnit(0);
    db.total = MAX_PHOTOS_PER_LISTING;
    const inTransaction = await add();

    expect(early.ok).toBe(false);
    expect(inTransaction.ok).toBe(false);
    expect(early.ok || inTransaction.ok).toBe(false);
    if (early.ok || inTransaction.ok) return;
    expect(inTransaction.message).toBe(early.message);
  });

  it('loguea el rechazo con ids y contadores, sin la key del master', async () => {
    givenUnit(1);
    db.total = MAX_PHOTOS_PER_LISTING;

    await add();

    expect(logEvent).toHaveBeenCalledWith('listing.photo.rejected_full', {
      tenantId: 'tenant-1',
      listingId: 'listing-1',
      photos: MAX_PHOTOS_PER_LISTING,
    });
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain(uploaded.masterKey);
  });
});

describe('addUnitPhoto · la unidad se fue mientras subíamos', () => {
  it('el listing borrado entre el select y el lock no inserta nada', async () => {
    givenUnit(1);
    db.listingExists = false;

    await expect(add()).resolves.toEqual({ ok: false, message: 'No encontramos ese equipo.' });
    expect(db.inserts).toEqual([]);
    expect(db.calls).toEqual(['lock']);
  });

  it('la unidad de otro tenant vuelve null y sale como "no existe", sin tocar R2', async () => {
    loadUnitForTransition.mockResolvedValue(null);

    await expect(add()).resolves.toEqual({ ok: false, message: 'No encontramos ese equipo.' });
    expect(uploadListingPhoto).not.toHaveBeenCalled();
  });
});

describe('addUnitPhoto · el upload falla', () => {
  it('no inserta y loguea el código, nunca el error crudo', async () => {
    givenUnit(0);
    uploadListingPhoto.mockRejectedValue(Object.assign(new Error('boom'), { code: 'R2_TIMEOUT' }));

    const result = await add();

    expect(result.ok).toBe(false);
    expect(db.inserts).toEqual([]);
    expect(logError).toHaveBeenCalledWith('listing.photo.upload_failed', 'R2_TIMEOUT', {
      tenantId: 'tenant-1',
      listingId: 'listing-1',
    });
    expect(JSON.stringify(logError.mock.calls)).not.toContain('boom');
  });
});
