/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  LA TRANSACCIÓN SE MIDE EN LAS FILAS DE POSTGRES, NO EN EL VALOR DE RETORNO
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `acceptToStock()` afirma tres cosas que un `expect(res.ok).toBe(true)` no puede ver:
 *
 *   1. que `tradein_leads.offer_usd` y `listings.cost_usd` son **el mismo dato** (el gate a de la
 *      slice) — se compara columna contra columna en una sola query, no dos lecturas de JS;
 *   2. que aceptar dos veces **no crea dos unidades** — se cuentan las filas de `listings`;
 *   3. que si una mitad falla **no queda ninguna** — se provoca el fallo con una FK real y se
 *      verifica que el lead quedó **exactamente** como estaba, campo por campo.
 *
 * Ninguna de las tres se puede afirmar mirando el retorno: una implementación que devuelve
 * `{ ok: true }` y no escribe nada las pasaría todas.
 *
 * ── El fallo lo provoca Postgres, no un mock ──────────────────────────────────────────────────
 * El caso de atomicidad usa un `catalog_model_id` con forma de uuid que **no existe**, así que la
 * que rompe es la FK `listings_catalog_model_id_fkey`, en el medio de la transacción, después de
 * que el `update` del lead ya corrió. Es la ventana exacta que el bug tendría en producción. Un
 * `vi.fn().mockRejectedValue()` habría probado el `catch`, no el `ROLLBACK`. Misma doctrina que
 * `create-listing.test.ts`: los errores de Postgres los tira Postgres.
 *
 * ── Lo único que se controla es el AZAR ───────────────────────────────────────────────────────
 * Se mockea `node:crypto` y nada más, y sólo para el caso que necesita provocar una colisión de
 * slug: el sufijo son 5 caracteres sobre un alfabeto de 32 y no se choca esperando. Fuera de ese
 * caso las dos funciones vuelven a ser aleatorias.
 *
 * ── Concurrencia: lo que este archivo NO puede medir ──────────────────────────────────────────
 * El pool del panel es `max: 1` (`_lib/db/connection.ts`), así que dos `acceptToStock()` lanzados
 * con `Promise.all` **no** corren en paralelo: el pool los encola. Lo que se mide acá es la
 * secuencia —aceptar, y volver a aceptar— que es la forma real del doble submit y del `POST`
 * repetido. El caso de dos transacciones simultáneas peleando por el lock de la fila necesita dos
 * conexiones y es de `qa-agent`; está pedido en el reporte.
 *
 * ── El fixture no deja residuo ────────────────────────────────────────────────────────────────
 * Tenant, usuarios, memberships y modelo de catálogo son de la corrida y se borran en `afterAll`.
 * Listings y leads se borran después de **cada** caso.
 */
import { userInfo } from 'node:os';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TenantContext } from '../db/session';
import { buildListingSlug } from '../listings/listing-slug';
import type { AcceptTradeinInput } from './schema';
import type { AcceptTradeinFailure, AcceptTradeinResult } from './accept-to-stock';

/**
 * `db()` resuelve la URL por `serverEnv()`, que no conoce `ISTOCK_DB`. Se fija acá para que el
 * cliente de la app y el de admin de este archivo apunten **a la misma base**, y para que una
 * corrida contra una base descartable no termine midiendo contra `istock_dev`.
 */
const URL_DB =
  process.env.DATABASE_URL ??
  `postgresql://${userInfo().username}@localhost:5432/${process.env.ISTOCK_DB ?? 'istock_dev'}`;
process.env.DATABASE_URL = URL_DB;

vi.mock('server-only', () => ({}));

const randomUuidStub = vi.fn<() => string>();
const randomFillStub = vi.fn<(buf: Uint8Array) => Uint8Array>();
vi.mock('node:crypto', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  randomUUID: () => randomUuidStub(),
  randomFillSync: (buf: Uint8Array) => randomFillStub(buf),
}));

const { acceptToStock } = await import('./accept-to-stock');
const { db } = await import('../db/connection');

// ── Fixture de la corrida ─────────────────────────────────────────────────────────────────────

const TENANT_ID = crypto.randomUUID();
const OTRO_TENANT_ID = crypto.randomUUID();
const OWNER_ID = crypto.randomUUID();
const SELLER_ID = crypto.randomUUID();
const MODEL_ID = crypto.randomUUID();
const SUFIJO = TENANT_ID.slice(0, 8);

const ctxOwner: TenantContext = { userId: OWNER_ID, tenantId: TENANT_ID, role: 'owner' };
const ctxSeller: TenantContext = { userId: SELLER_ID, tenantId: TENANT_ID, role: 'seller' };

const TITULO = 'iPhone 13 128 Medianoche';
/** Dos semillas fijas → dos sufijos distintos y **predecibles**. */
const BYTES_A = new Uint8Array(8).fill(0);
const BYTES_B = new Uint8Array(8).fill(1);

/** Lo que el dueño paga (= el costo) y a cuánto lo publica. En centavos, como todo el repo. */
const OFERTA_CENTS = 42_000;
const PRECIO_CENTS = 56_000;

const admin = postgres(URL_DB, { max: 1, prepare: false, onnotice: () => {} });

function entrada(leadId: string, over: Partial<AcceptTradeinInput> = {}): AcceptTradeinInput {
  return {
    leadId,
    title: TITULO,
    catalogModelId: MODEL_ID,
    condition: 'used_excellent',
    storageGb: 128,
    color: 'Medianoche',
    batteryPct: 87,
    priceUsd: PRECIO_CENTS,
    offerUsd: OFERTA_CENTS,
    ...over,
  };
}

/** Un lead como lo dejaría el form público: sin `offer_usd`, sin `internal_notes`, en `new`. */
async function insertarLead(tenantId = TENANT_ID): Promise<string> {
  const id = crypto.randomUUID();
  await admin`
    insert into tradein_leads
      (id, tenant_id, customer_name, customer_wa_phone, model_text, storage_gb, color,
       declared_condition, battery_pct)
    values
      (${id}, ${tenantId}, 'Visitante del fixture', '5492995550000', ${TITULO}, 128, 'Medianoche',
       'used_excellent', 87)
  `;
  return id;
}

interface FilaLead {
  readonly status: string;
  readonly offer_usd: string | null;
  readonly created_listing_id: string | null;
  readonly handled_by: string | null;
}

async function leerLead(id: string): Promise<FilaLead> {
  const rows = await admin<FilaLead[]>`
    select status, offer_usd, created_listing_id, handled_by
    from tradein_leads where tenant_id = ${TENANT_ID} and id = ${id}
  `;
  return unica(rows);
}

async function contarListings(): Promise<number> {
  const rows = await admin<{ n: string }[]>`
    select count(*)::text as n from listings where tenant_id = ${TENANT_ID}
  `;
  return Number(unica(rows).n);
}

function unica<T>(rows: readonly T[]): T {
  expect(rows).toHaveLength(1);
  const row = rows[0];
  if (row === undefined) throw new Error('se esperaba exactamente una fila');
  return row;
}

function exito(res: AcceptTradeinResult | AcceptTradeinFailure): AcceptTradeinResult {
  if (!res.ok) throw new Error(`se esperaba aceptar y falló en "${res.field}": ${res.message}`);
  return res;
}

function fallo(res: AcceptTradeinResult | AcceptTradeinFailure): AcceptTradeinFailure {
  if (res.ok) throw new Error(`se esperaba un fallo y el canje entró con slug "${res.slug}"`);
  return res;
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

beforeAll(async () => {
  await admin`insert into auth.users (id, email) values (${OWNER_ID}, ${`owner-${SUFIJO}@test.local`})`;
  await admin`insert into auth.users (id, email) values (${SELLER_ID}, ${`seller-${SUFIJO}@test.local`})`;
  await admin`
    insert into tenants (id, slug, name, wa_phone)
    values (${TENANT_ID}, ${`t-${SUFIJO}`}, 'Fixture de accept-to-stock', '2995550000')
  `;
  await admin`
    insert into tenants (id, slug, name, wa_phone)
    values (${OTRO_TENANT_ID}, ${`o-${SUFIJO}`}, 'Vecino del fixture', '2995550001')
  `;
  await admin`
    insert into memberships (tenant_id, user_id, role) values
      (${TENANT_ID}, ${OWNER_ID}, 'owner'), (${TENANT_ID}, ${SELLER_ID}, 'seller')
  `;
  await admin`
    insert into catalog_models (id, slug, display_name)
    values (${MODEL_ID}, ${`fixture-${SUFIJO}`}, 'iPhone 13 (fixture)')
  `;

  // El pool de la app se abre con el azar todavía real: si el driver necesitara `crypto` para el
  // handshake, no lo haría en el medio de un caso con las semillas fijadas.
  randomUuidStub.mockImplementation(() => crypto.randomUUID());
  randomFillStub.mockImplementation((buf) => buf);
  await db().$client.unsafe('select 1');
}, 30_000);

afterAll(async () => {
  await admin`delete from tenants where id in (${TENANT_ID}, ${OTRO_TENANT_ID})`;
  await admin`delete from catalog_models where id = ${MODEL_ID}`;
  await admin`delete from auth.users where id in (${OWNER_ID}, ${SELLER_ID})`;
  await admin.end({ timeout: 5 });
  await db().$client.end({ timeout: 5 });
});

beforeEach(() => {
  randomUuidStub.mockImplementation(() => crypto.randomUUID());
  randomFillStub.mockImplementation((buf) => {
    for (let i = 0; i < buf.length; i += 1) buf[i] = Math.floor(Math.random() * 256);
    return buf;
  });
});

afterEach(async () => {
  // Los leads primero: `created_listing_id` referencia `listings` con `on delete set null`, pero
  // borrar en este orden deja el estado del próximo caso limpio sin depender de esa regla.
  await admin`delete from tradein_leads where tenant_id in (${TENANT_ID}, ${OTRO_TENANT_ID})`;
  await admin`delete from listings where tenant_id = ${TENANT_ID}`;
  vi.restoreAllMocks();
});

/**
 * ── Gate (a) · control positivo ───────────────────────────────────────────────────────────────
 * Sin esto, todos los casos negativos los cumpliría una `acceptToStock` que devuelve un fallo
 * siempre. Acá se mide la aceptación que funciona **contra las filas**, no contra el retorno.
 */
describe('gate (a) · aceptar crea la unidad en draft con el costo, y ata el lead', () => {
  it('escribe listing + lead + evento, y la unidad nace en draft', async () => {
    const leadId = await insertarLead();
    const res = exito(await acceptToStock(ctxOwner, entrada(leadId)));

    const listing = unica(
      await admin<
        {
          slug: string;
          status: string;
          kind: string;
          qty: number;
          price_usd: string;
          cost_usd: string | null;
          condition: string;
          storage_gb: number | null;
          color: string | null;
          battery_pct: number | null;
          catalog_model_id: string | null;
          created_by: string;
          published_at: Date | null;
        }[]
      >`
        select slug, status, kind, qty, price_usd, cost_usd, condition, storage_gb, color,
               battery_pct, catalog_model_id, created_by, published_at
        from listings where tenant_id = ${TENANT_ID} and id = ${res.listingId}
      `,
    );

    expect(listing.slug).toBe(res.slug);
    // El corazón del gate: nace borrador, no en vidriera. Y `published_at` sigue nulo, que es la
    // otra mitad de la policy de la vidriera anónima.
    expect(listing.status).toBe('draft');
    expect(listing.published_at).toBeNull();
    expect(listing.kind).toBe('unit');
    expect(listing.qty).toBe(1);
    expect(Number(listing.price_usd)).toBe(560);
    expect(Number(listing.cost_usd)).toBe(420);
    expect(listing.condition).toBe('used_excellent');
    expect(listing.storage_gb).toBe(128);
    expect(listing.color).toBe('Medianoche');
    expect(listing.battery_pct).toBe(87);
    expect(listing.catalog_model_id).toBe(MODEL_ID);
    expect(listing.created_by).toBe(OWNER_ID);

    const lead = await leerLead(leadId);
    expect(lead.status).toBe('accepted');
    expect(Number(lead.offer_usd)).toBe(420);
    expect(lead.created_listing_id).toBe(res.listingId);
    expect(lead.handled_by).toBe(OWNER_ID);

    const evento = unica(
      await admin<{ kind: string; to_status: string; metadata: Record<string, unknown> }[]>`
        select kind, to_status, metadata
        from listing_events where tenant_id = ${TENANT_ID} and listing_id = ${res.listingId}
      `,
    );
    expect(evento.kind).toBe('created');
    expect(evento.to_status).toBe('draft');
    expect(evento.metadata['source']).toBe('tradein');
    // La bitácora **no** puede llevar el costo ni PII del visitante (`events.ts`, `CLAUDE.md` §2).
    expect(JSON.stringify(evento.metadata)).not.toContain('420');
    expect(JSON.stringify(evento.metadata)).not.toContain('Visitante');
    expect(JSON.stringify(evento.metadata)).not.toContain('549299');
  });

  /**
   * "Es el mismo dato" se afirma **en Postgres**, comparando las dos columnas en una sola query.
   * Dos lecturas separadas a JS y un `expect(a).toBe(b)` medirían que dos números son iguales;
   * esto mide que la copia que hizo el `INSERT` es exacta, sin ida y vuelta por centavos.
   */
  it('offer_usd y cost_usd son el mismo valor, comparado columna contra columna', async () => {
    const leadId = await insertarLead();
    const res = exito(await acceptToStock(ctxOwner, entrada(leadId)));

    const fila = unica(
      await admin<{ iguales: boolean; cost: string | null }[]>`
        select l.cost_usd = t.offer_usd as iguales, l.cost_usd as cost
        from listings l
        join tradein_leads t
          on t.created_listing_id = l.id and t.tenant_id = l.tenant_id
        where l.tenant_id = ${TENANT_ID} and l.id = ${res.listingId}
      `,
    );
    expect(fila.iguales).toBe(true);
    // Y no son iguales por ser las dos `null`: la unidad de un canje nace **con** costo.
    expect(fila.cost).not.toBeNull();
  });

  /**
   * El margen lo deriva el motor (`generatedAlwaysAs(price_usd - cost_usd)`). Se afirma acá porque
   * es la consecuencia que hace que copiar el costo valga la pena: sin costo, el margen de toda
   * unidad que entró por canje sería `null` para siempre.
   */
  it('el margen queda derivado por Postgres, no escrito por el panel', async () => {
    const leadId = await insertarLead();
    const res = exito(await acceptToStock(ctxOwner, entrada(leadId)));

    const fila = unica(
      await admin<{ margin_usd: string | null }[]>`
        select margin_usd from listings where tenant_id = ${TENANT_ID} and id = ${res.listingId}
      `,
    );
    expect(Number(fila.margin_usd)).toBe(140);
  });
});

describe('aceptar dos veces NO crea dos unidades', () => {
  it('el segundo intento falla y sigue habiendo una sola unidad', async () => {
    const leadId = await insertarLead();
    const primero = exito(await acceptToStock(ctxOwner, entrada(leadId)));
    expect(await contarListings()).toBe(1);

    const segundo = fallo(await acceptToStock(ctxOwner, entrada(leadId)));
    expect(segundo.message).toContain('ya lo aceptaron');

    // Lo que importa no es el mensaje: es que no haya una segunda unidad.
    expect(await contarListings()).toBe(1);

    const lead = await leerLead(leadId);
    // Y que el lead siga apuntando a la PRIMERA unidad, no a una nueva.
    expect(lead.created_listing_id).toBe(primero.listingId);
  });

  it('un lead que otro ya aceptó por fuera tampoco entra', async () => {
    const leadId = await insertarLead();
    // Alguien lo aceptó desde otra pestaña: la fila ya está en `accepted`.
    await admin`update tradein_leads set status = 'accepted' where id = ${leadId}`;

    const res = fallo(await acceptToStock(ctxOwner, entrada(leadId)));
    expect(res.message).toContain('ya lo aceptaron');
    expect(await contarListings()).toBe(0);
  });
});

/**
 * ── La transacción es UNA ─────────────────────────────────────────────────────────────────────
 * El `catalog_model_id` tiene forma de uuid y no existe: la FK revienta **después** de que el
 * `update` del lead ya corrió. Si `acceptToStock` abriera dos transacciones, el lead quedaría
 * `accepted` con `offer_usd` escrito y sin ninguna unidad — un canje que se comió el equipo.
 */
describe('si una mitad falla, no queda ninguna', () => {
  it('la FK del modelo rompe el insert y el lead queda EXACTAMENTE como estaba', async () => {
    const leadId = await insertarLead();
    const antes = await leerLead(leadId);
    expect(antes.status).toBe('new');

    const res = fallo(
      await acceptToStock(ctxOwner, entrada(leadId, { catalogModelId: crypto.randomUUID() })),
    );
    expect(res.field).toBe('catalogModelId');

    const despues = await leerLead(leadId);
    expect(despues.status).toBe('new');
    expect(despues.offer_usd).toBeNull();
    expect(despues.created_listing_id).toBeNull();
    expect(despues.handled_by).toBeNull();
    expect(await contarListings()).toBe(0);
  });
});

/**
 * ── Colisión de slug: el reintento vuelve a empezar la transacción entera ─────────────────────
 * Un `23505` aborta la transacción en Postgres. Si el reintento viviera adentro del `withTenantDb`
 * seguiría en un bloque abortado y el segundo intento fallaría con `25P02`. Acá se mide que la
 * transacción se rehizo de cero: el lead no quedó a medio aceptar y la unidad entró con el
 * **segundo** sufijo.
 */
describe('colisión de slug', () => {
  it('reintenta la transacción entera y deja el lead consistente', async () => {
    const leadId = await insertarLead();
    const slugOcupado = buildListingSlug(TITULO, BYTES_A);
    await admin`
      insert into listings (tenant_id, slug, title, condition, price_usd)
      values (${TENANT_ID}, ${slugOcupado}, 'el que ocupa el slug', 'used_excellent', 100.00)
    `;

    semillas(BYTES_A, BYTES_B);
    const res = exito(await acceptToStock(ctxOwner, entrada(leadId)));

    expect(res.slug).toBe(buildListingSlug(TITULO, BYTES_B));
    expect(res.slug).not.toBe(slugOcupado);
    expect(randomFillStub).toHaveBeenCalledTimes(2);

    const lead = await leerLead(leadId);
    expect(lead.status).toBe('accepted');
    expect(lead.created_listing_id).toBe(res.listingId);
    // El que ocupaba el slug + el del canje. Ni uno huérfano del primer intento.
    expect(await contarListings()).toBe(2);
  });
});

/**
 * ── Gate (b), del lado de la escritura ────────────────────────────────────────────────────────
 * Un `seller` no escribe un costo. El chequeo vive en la función exportada, no sólo en la Server
 * Action: un caller nuevo no tiene por qué acordarse.
 */
describe('sólo el owner acepta', () => {
  it('un seller no crea ninguna unidad y el lead no se mueve', async () => {
    const leadId = await insertarLead();

    const res = fallo(await acceptToStock(ctxSeller, entrada(leadId)));
    expect(res.message).toContain('Sólo el dueño');

    const lead = await leerLead(leadId);
    expect(lead.status).toBe('new');
    expect(lead.offer_usd).toBeNull();
    expect(lead.handled_by).toBeNull();
    expect(await contarListings()).toBe(0);
  });
});

describe('aislamiento de tenant', () => {
  it('un lead de otro negocio no existe: ni se acepta ni se dice que existe', async () => {
    const ajeno = await insertarLead(OTRO_TENANT_ID);

    const res = fallo(await acceptToStock(ctxOwner, entrada(ajeno)));
    // Mismo mensaje que un id inventado: no se confirma que el lead exista en algún lado.
    expect(res.message).toContain('no existe');
    expect(await contarListings()).toBe(0);

    const vecino = unica(
      await admin<{ status: string; created_listing_id: string | null }[]>`
        select status, created_listing_id
        from tradein_leads where tenant_id = ${OTRO_TENANT_ID} and id = ${ajeno}
      `,
    );
    expect(vecino.status).toBe('new');
    expect(vecino.created_listing_id).toBeNull();
  });

  it('un id que no existe da el mismo fallo', async () => {
    const res = fallo(await acceptToStock(ctxOwner, entrada(crypto.randomUUID())));
    expect(res.message).toContain('no existe');
    expect(await contarListings()).toBe(0);
  });
});
