/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  LOS 23505 LOS TIRA POSTGRES. ACÁ NO SE FABRICA NINGUNO.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `create-listing.ts` no tenía archivo de test —ninguno—, así que el discriminador de `23505` de
 * `createUnit` (colisión de slug / IMEI repetido / genérico) **nunca se ejecutó**. Eso no es una
 * hipótesis: `isUniqueViolation()` de ese archivo leía `error.code` del objeto de arriba y por lo
 * tanto devolvía `false` siempre, porque Drizzle 0.45.2 envuelve el error del driver y deja el
 * `PostgresError` en `.cause`. Con eso, la colisión de slug no se reintentaba nunca y un IMEI
 * duplicado salía como 500. Se arregló en `5bb0d1b` delegando en `uniqueViolationConstraint`, y el
 * arreglo tampoco tenía test: la próxima regresión volvía a ser invisible.
 *
 * Por eso acá no hay un solo literal de error de Postgres. Cada colisión se provoca **insertando la
 * fila que choca** contra Postgres real; el nombre de la constraint lo dice Postgres. Es la lección
 * de `_lib/db/pg-error.test.ts`: un `{ code: '23505' }` escrito a mano es exactamente la forma que
 * el driver **nunca** produce, y un test contra una forma inventada certifica un mapeo que el
 * código no hace — sale verde por el motivo equivocado.
 *
 * ── Las tres ramas tienen que DISTINGUIRSE, no sólo fallar ────────────────────────────────────
 * Slug, IMEI y genérico llegan los tres como `23505`; lo único que los separa es el **nombre de la
 * constraint**. Un caso que sólo afirmara "tiró error" no podría decir cuál rama corrió. Por eso
 * cada caso hace dos cosas:
 *
 *   1. una **sonda** intenta la misma fila con el cliente de admin y afirma qué constraint contesta
 *      Postgres (`listings_tenant_slug_key` · `listings_tenant_imei_key` · `listings_pkey`). Si el
 *      fixture dejara de reproducir la colisión, el caso se pone rojo ahí y no más tarde;
 *   2. el desenlace de `createUnit` es **distinto en cada rama** (`ok` con slug nuevo / `field:
 *      'imei'` / `field: 'form'`) y además se cuenta **cuántas veces se generó un slug**, que es lo
 *      que separa "reintentó" de "no reintentó". Sin ese contador, la rama del slug y la del IMEI
 *      podrían intercambiarse sin que ningún `expect` lo notara.
 *
 * ── Lo único que se controla es el AZAR, y se controla en el borde ────────────────────────────
 * El sufijo del slug son 5 caracteres sobre un alfabeto de 32: una colisión no se provoca
 * esperándola. `newSlug()` llama a `randomFillSync` y el id sale de `randomUUID()`, así que se
 * mockea `node:crypto` y **nada más**: el insert, la transacción, la policy y el error siguen
 * siendo de Postgres. Fuera de los casos que lo piden, las dos funciones vuelven a ser aleatorias.
 *
 * ── El fixture no deja residuo ────────────────────────────────────────────────────────────────
 * Tenant, usuarios, memberships y modelo de catálogo son propios de la corrida (ids nuevos) y se
 * borran en `afterAll`; los listings se borran después de **cada** caso. `catalog_models` es una
 * tabla global: el modelo se inserta con slug propio en vez de apoyarse en el seed, porque un test
 * que depende de `pnpm db:seed` es un test que falla en una base recién migrada.
 */
import { userInfo } from 'node:os';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UploadedListingPhoto } from '@istock/media';
import { pgErrorCode, uniqueViolationConstraint } from '../db/pg-error';
import type { TenantContext } from '../db/session';
import { buildListingSlug } from './listing-slug';
import type { NewUnitInput } from './schema';
import type { CreateUnitFailure, CreateUnitResult } from './create-listing';

/**
 * `db()` (`_lib/db/connection.ts`) resuelve la URL por `serverEnv()`, que no conoce `ISTOCK_DB`.
 * Se fija acá para que el cliente de la app y el de admin de este archivo apunten **a la misma
 * base**, y para que una corrida contra una base descartable (`ISTOCK_DB=… ./scripts/pg-local.sh`)
 * no termine midiendo contra `istock_dev`.
 */
const URL_DB =
  process.env.DATABASE_URL ??
  `postgresql://${userInfo().username}@localhost:5432/${process.env.ISTOCK_DB ?? 'istock_dev'}`;
process.env.DATABASE_URL = URL_DB;

vi.mock('server-only', () => ({}));

/**
 * `packages/media` habla con R2 y `schema.ts` (importado por cadena) lee `MAX_UPLOAD_BYTES` del
 * mismo paquete: el mock es **parcial** para no inventar un cap de bytes que es una constante real.
 * Lo único falso de este archivo es la subida — el orden "R2 primero, Postgres después" se mide
 * igual, y el último caso lo aprovecha.
 */
const uploadListingPhoto = vi.fn();
vi.mock('@istock/media', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  uploadListingPhoto: (input: unknown) => uploadListingPhoto(input) as unknown,
}));

const randomUuidStub = vi.fn<() => string>();
const randomFillStub = vi.fn<(buf: Uint8Array) => Uint8Array>();
vi.mock('node:crypto', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  randomUUID: () => randomUuidStub(),
  randomFillSync: (buf: Uint8Array) => randomFillStub(buf),
}));

const { createUnit } = await import('./create-listing');
const { db } = await import('../db/connection');

// ── Fixture de la corrida ─────────────────────────────────────────────────────────────────────

const TENANT_ID = crypto.randomUUID();
const OWNER_ID = crypto.randomUUID();
const SELLER_ID = crypto.randomUUID();
const MODEL_ID = crypto.randomUUID();
const SUFIJO = TENANT_ID.slice(0, 8);

const ctxOwner: TenantContext = { userId: OWNER_ID, tenantId: TENANT_ID, role: 'owner' };
const ctxSeller: TenantContext = { userId: SELLER_ID, tenantId: TENANT_ID, role: 'seller' };

const TITULO = 'iPhone 14 Pro 256 Grafito';
/** Dos semillas fijas → dos sufijos distintos y **predecibles**: `-aaaaa` y `-bbbbb`. */
const BYTES_A = new Uint8Array(8).fill(0);
const BYTES_B = new Uint8Array(8).fill(1);
const FOTO = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

/** Lo que devolvería `uploadListingPhoto`. No hay R2 en un test unitario del panel. */
const SUBIDA: UploadedListingPhoto = {
  masterKey: `originals/${SUFIJO}/master.webp`,
  masterBytes: 900_000,
  thumbKey: `t/${SUFIJO}/thumb.webp`,
  cardKey: `t/${SUFIJO}/card.webp`,
  detailKey: `t/${SUFIJO}/detail.webp`,
  width: 1600,
  height: 1200,
  variants: {
    thumb: { key: `t/${SUFIJO}/thumb.webp`, bytes: 9_000, width: 320, height: 240, quality: 72 },
    card: { key: `t/${SUFIJO}/card.webp`, bytes: 98_000, width: 800, height: 600, quality: 72 },
    detail: { key: `t/${SUFIJO}/detail.webp`, bytes: 210_000, width: 1600, height: 1200, quality: 72 },
  },
  urls: {
    thumb: `https://cdn.test/${SUFIJO}/thumb.webp`,
    card: `https://cdn.test/${SUFIJO}/card.webp`,
    detail: `https://cdn.test/${SUFIJO}/detail.webp`,
  },
  classAOps: 4,
};

const admin = postgres(URL_DB, { max: 1, prepare: false, onnotice: () => {} });

function nuevaUnidad(over: Partial<NewUnitInput> = {}): NewUnitInput {
  return {
    title: TITULO,
    condition: 'used_excellent',
    catalogModelId: MODEL_ID,
    storageGb: 256,
    color: 'Grafito',
    priceUsd: 62_000,
    batteryPct: 89,
    imei: null,
    costUsd: 50_000,
    description: 'Impecable, con caja.',
    ...over,
  };
}

/** Fija la secuencia de semillas del slug. La última se repite si hay más intentos que semillas. */
function semillas(...enOrden: readonly Uint8Array[]): void {
  let i = 0;
  randomFillStub.mockImplementation((buf) => {
    const fuente = enOrden[Math.min(i, enOrden.length - 1)] ?? BYTES_A;
    i += 1;
    buf.set(fuente.subarray(0, buf.length));
    return buf;
  });
}

interface FilaListing {
  readonly id: string;
  readonly slug: string;
  readonly imei: string | null;
}

/** Inserta con privilegio de admin la fila **contra la que se va a chocar**. */
async function insertarListing(fila: FilaListing): Promise<void> {
  await admin`
    insert into listings (id, tenant_id, slug, title, condition, price_usd, imei)
    values (${fila.id}, ${TENANT_ID}, ${fila.slug}, 'equipo del fixture', 'used_excellent', 100.00, ${fila.imei})
  `;
}

/**
 * La **sonda**: intenta la misma fila y devuelve el nombre de la constraint que contestó Postgres.
 * Es lo que vuelve atribuible cada rama — sin esto, "falló con 23505" no dice cuál de las tres.
 * Si la fila **entra**, el fixture dejó de reproducir la colisión y el caso no mide nada: se corta.
 */
async function constraintQueChoca(fila: FilaListing): Promise<string | null> {
  try {
    await insertarListing(fila);
  } catch (error) {
    return uniqueViolationConstraint(error);
  }
  throw new Error('la sonda NO chocó: el fixture no reproduce la colisión y el caso no mide nada');
}

/** Corre `fn` esperando que reviente y devuelve lo que tiró. Si no revienta, el caso falla acá. */
async function capturar(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error('se esperaba una excepción y la función devolvió normalmente');
}

function unica<T>(rows: readonly T[]): T {
  expect(rows).toHaveLength(1);
  const row = rows[0];
  if (row === undefined) throw new Error('se esperaba exactamente una fila');
  return row;
}

function exito(res: CreateUnitResult | CreateUnitFailure): CreateUnitResult {
  if (!res.ok) throw new Error(`se esperaba un alta exitosa y falló en "${res.field}": ${res.message}`);
  return res;
}

function fallo(res: CreateUnitResult | CreateUnitFailure): CreateUnitFailure {
  if (res.ok) throw new Error(`se esperaba un fallo y el alta entró con slug "${res.slug}"`);
  return res;
}

beforeAll(async () => {
  await admin`insert into auth.users (id, email) values (${OWNER_ID}, ${`owner-${SUFIJO}@test.local`})`;
  await admin`insert into auth.users (id, email) values (${SELLER_ID}, ${`seller-${SUFIJO}@test.local`})`;
  await admin`
    insert into tenants (id, slug, name, wa_phone)
    values (${TENANT_ID}, ${`t-${SUFIJO}`}, 'Fixture de create-listing', '2995550000')
  `;
  await admin`
    insert into memberships (tenant_id, user_id, role) values
      (${TENANT_ID}, ${OWNER_ID}, 'owner'), (${TENANT_ID}, ${SELLER_ID}, 'seller')
  `;
  await admin`
    insert into catalog_models (id, slug, display_name)
    values (${MODEL_ID}, ${`fixture-${SUFIJO}`}, 'iPhone 14 Pro (fixture)')
  `;

  // El pool de la app se abre acá, con el azar todavía real: si el driver necesitara `crypto`
  // para el handshake, no lo haría en el medio de un caso que tiene las semillas fijadas.
  randomUuidStub.mockImplementation(() => crypto.randomUUID());
  randomFillStub.mockImplementation((buf) => buf);
  await db().$client.unsafe('select 1');
}, 30_000);

afterAll(async () => {
  // El tenant cascadea listings / photos / events / memberships. Los usuarios y el modelo global
  // se borran a mano: `catalog_models` no cuelga de ningún tenant.
  await admin`delete from tenants where id = ${TENANT_ID}`;
  await admin`delete from catalog_models where id = ${MODEL_ID}`;
  await admin`delete from auth.users where id in (${OWNER_ID}, ${SELLER_ID})`;
  await admin.end({ timeout: 5 });
  await db().$client.end({ timeout: 5 });
});

beforeEach(() => {
  uploadListingPhoto.mockResolvedValue(SUBIDA);
  randomUuidStub.mockImplementation(() => crypto.randomUUID());
  randomFillStub.mockImplementation((buf) => {
    for (let i = 0; i < buf.length; i += 1) buf[i] = Math.floor(Math.random() * 256);
    return buf;
  });
});

afterEach(async () => {
  await admin`delete from listings where tenant_id = ${TENANT_ID}`;
  vi.restoreAllMocks();
});

/**
 * ── Control positivo ──────────────────────────────────────────────────────────────────────────
 * Sin esto, todos los casos negativos de abajo los cumpliría una `createUnit` que devuelve un
 * fallo siempre. Acá se mide el alta que funciona **contra las filas de Postgres**, no contra el
 * valor de retorno: listing en `draft`, foto en `sort_order 0` y evento `created`.
 */
describe('control positivo · el alta que funciona escribe las tres filas', () => {
  it('crea listing + foto + evento y devuelve el slug que efectivamente quedó guardado', async () => {
    semillas(BYTES_A);
    const res = exito(await createUnit(ctxOwner, nuevaUnidad(), FOTO));

    expect(res.slug).toBe(buildListingSlug(TITULO, BYTES_A));
    expect(res.photoCount).toBe(1);
    expect(randomFillStub).toHaveBeenCalledTimes(1);

    const fila = unica(
      await admin<{ slug: string; status: string; kind: string; qty: number; price_usd: string; cost_usd: string | null; imei: string | null; created_by: string }[]>`
        select slug, status, kind, qty, price_usd, cost_usd, imei, created_by
        from listings where tenant_id = ${TENANT_ID} and id = ${res.listingId}
      `,
    );
    expect(fila.slug).toBe(res.slug);
    expect(fila.status).toBe('draft');
    expect(fila.kind).toBe('unit');
    expect(fila.qty).toBe(1);
    expect(Number(fila.price_usd)).toBe(620);
    expect(Number(fila.cost_usd)).toBe(500);
    expect(fila.created_by).toBe(OWNER_ID);

    const foto = unica(
      await admin<{ sort_order: number; card_key: string; master_key: string; card_bytes: number; width: number; height: number }[]>`
        select sort_order, card_key, master_key, card_bytes, width, height
        from listing_photos where tenant_id = ${TENANT_ID} and listing_id = ${res.listingId}
      `,
    );
    expect(foto.sort_order).toBe(0);
    expect(foto.card_key).toBe(SUBIDA.cardKey);
    expect(foto.master_key).toBe(SUBIDA.masterKey);
    expect(foto.card_bytes).toBe(SUBIDA.variants.card.bytes);

    const evento = unica(
      await admin<{ kind: string; to_status: string; actor_user_id: string; metadata: Record<string, unknown> }[]>`
        select kind, to_status, actor_user_id, metadata
        from listing_events where tenant_id = ${TENANT_ID} and listing_id = ${res.listingId}
      `,
    );
    expect(evento.kind).toBe('created');
    expect(evento.to_status).toBe('draft');
    expect(evento.actor_user_id).toBe(OWNER_ID);
    // `metadata` NUNCA lleva IMEI, costo ni notas internas (`CLAUDE.md` §2). Igualdad exacta, no
    // `toMatchObject`: lo que importa es que no haya una clave **de más**.
    expect(evento.metadata).toEqual({ photos: 1, kind: 'unit' });
  }, 30_000);

  it('seller: `cost_usd` no se escribe aunque venga en el input (CLAUDE.md §0.9)', async () => {
    semillas(BYTES_A);
    const res = exito(await createUnit(ctxSeller, nuevaUnidad({ costUsd: 50_000 }), FOTO));

    const fila = unica(
      await admin<{ cost_usd: string | null; margin_usd: string | null; created_by: string }[]>`
        select cost_usd, margin_usd, created_by
        from listings where tenant_id = ${TENANT_ID} and id = ${res.listingId}
      `,
    );
    // El filtro está en el server, no en un `disabled` del formulario: la fila nace sin costo, así
    // que tampoco hay margen que derivar.
    expect(fila.cost_usd).toBeNull();
    expect(fila.margin_usd).toBeNull();
    expect(fila.created_by).toBe(SELLER_ID);
  }, 30_000);
});

/**
 * ── Las tres ramas del `23505` ────────────────────────────────────────────────────────────────
 * Cada caso empieza plantando la fila contra la que se choca y preguntándole a Postgres **cómo se
 * llama la constraint**. Los tres nombres son distintos y los tres desenlaces también; ese es el
 * único motivo por el que este archivo puede afirmar cuál rama corrió.
 */
describe('23505 · las tres ramas se distinguen por el nombre de la constraint', () => {
  it('slug ocupado → el REINTENTO sucede y la segunda vuelta entra con otro sufijo', async () => {
    const ocupado = buildListingSlug(TITULO, BYTES_A);
    const libre = buildListingSlug(TITULO, BYTES_B);
    expect(libre).not.toBe(ocupado);

    await insertarListing({ id: crypto.randomUUID(), slug: ocupado, imei: null });
    expect(await constraintQueChoca({ id: crypto.randomUUID(), slug: ocupado, imei: null })).toBe(
      'listings_tenant_slug_key',
    );

    semillas(BYTES_A, BYTES_B);
    const res = exito(await createUnit(ctxOwner, nuevaUnidad(), FOTO));

    // Lo que se mide NO es "no explotó": es que hubo **dos** intentos y que el que entró es el
    // segundo, con el sufijo nuevo. Con `isUniqueViolation` devolviendo `false` —el bug de S7—
    // acá no hay reintento: la excepción sube y este caso no llega a la primera aserción.
    expect(randomFillStub).toHaveBeenCalledTimes(2);
    expect(res.slug).toBe(libre);

    const fila = unica(
      await admin<{ slug: string }[]>`
        select slug from listings where tenant_id = ${TENANT_ID} and id = ${res.listingId}
      `,
    );
    expect(fila.slug).toBe(libre);

    // Y la fila que ocupaba el slug sigue siendo la de antes: un reintento no es un upsert.
    const dueña = unica(
      await admin<{ title: string }[]>`
        select title from listings where tenant_id = ${TENANT_ID} and slug = ${ocupado}
      `,
    );
    expect(dueña.title).toBe('equipo del fixture');
  }, 30_000);

  it('slug ocupado en los tres intentos → field "title", ninguna fila y un log sin PII', async () => {
    const ocupado = buildListingSlug(TITULO, BYTES_A);
    await insertarListing({ id: crypto.randomUUID(), slug: ocupado, imei: null });

    const errores = vi.spyOn(console, 'error').mockImplementation(() => {});
    semillas(BYTES_A); // siempre la misma semilla: los tres intentos chocan
    const res = fallo(await createUnit(ctxOwner, nuevaUnidad(), FOTO));

    expect(randomFillStub).toHaveBeenCalledTimes(3);
    expect(res.field).toBe('title');
    expect(res.message).toBe('No pudimos generar un link para ese nombre. Cambialo un poco.');

    // Se agotó el reintento, no se creó nada: la única fila del tenant es la del fixture.
    const filas = await admin<{ title: string }[]>`
      select title from listings where tenant_id = ${TENANT_ID}
    `;
    expect(filas).toHaveLength(1);

    const linea = errores.mock.calls.at(-1)?.[0];
    expect(typeof linea).toBe('string');
    expect(JSON.parse(String(linea))).toEqual({
      event: 'listing.create.slug_exhausted',
      level: 'error',
      code: '23505',
      tenantId: TENANT_ID,
      listingId: expect.any(String),
    });
  }, 30_000);

  it('IMEI repetido → field "imei", y NO reintenta (no es la rama del slug)', async () => {
    const IMEI = '350000000000001';
    await insertarListing({ id: crypto.randomUUID(), slug: 'ocupa-el-imei', imei: IMEI });
    expect(await constraintQueChoca({ id: crypto.randomUUID(), slug: 'otro-slug-libre', imei: IMEI })).toBe(
      'listings_tenant_imei_key',
    );

    semillas(BYTES_A); // el slug está libre: lo único que choca es el IMEI
    const res = fallo(await createUnit(ctxOwner, nuevaUnidad({ imei: IMEI }), FOTO));

    expect(res.field).toBe('imei');
    expect(res.message).toBe('Ya tenés cargado un equipo con ese IMEI.');
    // Un solo intento. Si esta rama cayera en la del slug, serían tres y el mensaje sería otro.
    expect(randomFillStub).toHaveBeenCalledTimes(1);

    const filas = await admin<{ id: string }[]>`
      select id from listings where tenant_id = ${TENANT_ID} and imei = ${IMEI}
    `;
    expect(filas).toHaveLength(1);
  }, 30_000);

  it('otro 23505 (listings_pkey) → field "form", el mensaje genérico', async () => {
    const idChocado = crypto.randomUUID();
    await insertarListing({ id: idChocado, slug: 'ya-existe-esta-fila', imei: null });
    // Tercer nombre de constraint, distinto de los dos que `createUnit` conoce: es exactamente el
    // caso que la rama genérica existe para atender.
    expect(await constraintQueChoca({ id: idChocado, slug: 'un-slug-cualquiera', imei: null })).toBe(
      'listings_pkey',
    );

    randomUuidStub.mockReturnValue(idChocado);
    semillas(BYTES_A);
    const res = fallo(await createUnit(ctxOwner, nuevaUnidad(), FOTO));

    expect(res.field).toBe('form');
    expect(res.message).toBe('Ese equipo ya estaba cargado.');
    expect(randomFillStub).toHaveBeenCalledTimes(1);

    // La fila de antes quedó intacta: el 23505 se reporta, no se resuelve pisando.
    const fila = unica(
      await admin<{ title: string; slug: string }[]>`
        select title, slug from listings where tenant_id = ${TENANT_ID} and id = ${idChocado}
      `,
    );
    expect(fila.title).toBe('equipo del fixture');
    expect(fila.slug).toBe('ya-existe-esta-fila');
  }, 30_000);
});

/**
 * ── La contracara: lo que NO es un 23505 tiene que subir ──────────────────────────────────────
 * La rama genérica traduce **cualquier** `23505` a "ese equipo ya estaba cargado". Sin este caso,
 * un discriminador que dijera `true` a todo error pasaría los cuatro de arriba: convertiría un
 * modelo de catálogo inexistente en "ya estaba cargado" y el bug quedaría escondido detrás de un
 * mensaje tranquilizador.
 */
describe('lo que no es una violación de unicidad no se traga', () => {
  it('23503 (FK del modelo de catálogo) se propaga y no se mapea a ningún campo', async () => {
    semillas(BYTES_A);
    const error = await capturar(() =>
      createUnit(ctxOwner, nuevaUnidad({ catalogModelId: crypto.randomUUID() }), FOTO),
    );

    expect(pgErrorCode(error)).toBe('23503');
    expect(uniqueViolationConstraint(error)).toBeNull();
    // Un error que no es de unicidad no dispara el reintento del slug.
    expect(randomFillStub).toHaveBeenCalledTimes(1);

    const filas = await admin<{ id: string }[]>`
      select id from listings where tenant_id = ${TENANT_ID}
    `;
    expect(filas).toHaveLength(0);
  }, 30_000);
});

/**
 * ── R2 primero, Postgres después ──────────────────────────────────────────────────────────────
 * El docblock de `create-listing.ts` justifica ese orden: bytes huérfanos tienen recolector
 * (`collectOrphanObjects`), filas huérfanas no. Este caso lo mide por el lado barato: si la subida
 * falla, no se llega a generar ni un slug y Postgres queda sin tocar.
 */
describe('la foto va antes que la fila', () => {
  it('si falla el upload no se escribe nada en Postgres ni se genera un slug', async () => {
    const errores = vi.spyOn(console, 'error').mockImplementation(() => {});
    uploadListingPhoto.mockRejectedValueOnce(new Error('formato no soportado'));

    const res = fallo(await createUnit(ctxOwner, nuevaUnidad(), FOTO));

    expect(res.field).toBe('photo');
    expect(res.message).toBe('No pudimos procesar esa foto. Probá de nuevo con otra.');
    expect(randomFillStub).toHaveBeenCalledTimes(0);
    expect(errores).toHaveBeenCalledTimes(1);

    const filas = await admin<{ id: string }[]>`
      select id from listings where tenant_id = ${TENANT_ID}
    `;
    expect(filas).toHaveLength(0);
  }, 30_000);
});
