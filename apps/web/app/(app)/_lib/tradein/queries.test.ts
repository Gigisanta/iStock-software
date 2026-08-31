/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  GATE (b) · EL SELLER NO RECIBE EL COSTO. SE MIDE EN EL PAYLOAD Y EN EL SQL.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `CLAUDE.md` §0.9: *"Ni en el payload, ni en API, ni en DTO."* Un test que mirara la pantalla
 * pasaría con un campo que viaja y no se renderiza — que es exactamente el fallo. Así que acá hay
 * **dos** afirmaciones y son distintas:
 *
 *   1. **Sobre el objeto.** Las claves `offerUsdCents` e `internalNotes` no están: `'k' in obj` es
 *      `false` y `Object.keys()` no las lista. No `undefined`, no `null`: **ausentes**. Y el
 *      `JSON.stringify` del payload entero no contiene ni el número ni el texto secreto, que es la
 *      forma en que un campo se escapa de verdad — serializado dentro del RSC payload.
 *
 *   2. **Sobre el SQL.** Se capturan las consultas que Drizzle efectivamente construye y se afirma
 *      que, para un `seller`, **ninguna nombra `offer_usd` ni `internal_notes`**, y que para un
 *      `owner` alguna sí. Esa es la diferencia entre "se ocultó" y "no se pidió", y es lo único que
 *      sigue siendo cierto el día que alguien agregue un campo al `select` sin leer el docblock.
 *
 * ── Cómo se captura el SQL sin tocar el código de producción ──────────────────────────────────
 * Se envuelve el `tx` que `withTenantDb` le pasa al callback en un `Proxy` que, al momento de que
 * el builder se espera (`then`), guarda su `toSQL().sql`. La transacción, la conexión, RLS y las
 * policies siguen siendo las reales: lo único agregado es un observador. Un mock de `withTenantDb`
 * que devolviera filas inventadas no mediría nada — el punto entero es qué SQL llega a Postgres.
 *
 * ── Lo que este archivo NO hace, y por qué ────────────────────────────────────────────────────
 * No revoca el privilegio de columna de `authenticated` sobre `offer_usd` para ver si la query del
 * `seller` sobrevive. Sería la prueba más fuerte y es la que **no** se puede escribir acá: un
 * `REVOKE` es DDL de tabla, global a la base, y `vitest` corre los archivos en paralelo — el
 * archivo de al lado (`accept-to-stock.test.ts`) escribe `offer_usd` en esa misma ventana. Un gate
 * que a veces se pone rojo por otro archivo enseña a ignorar los gates. Queda pedido para
 * `qa-agent`, que sí puede aislar la base.
 *
 * ── Y lo que hoy NO sostiene la base ──────────────────────────────────────────────────────────
 * Las cuatro policies de `tradein_leads` son `tenant_id = <claim>` y nada más: ninguna mira
 * `membership_role`, y `authenticated` tiene `SELECT` sobre las 17 columnas. O sea que este archivo
 * mide la única capa que hoy separa a un `seller` del costo. Está reportado como P5; la policy por
 * rol es S11 y es de `db-agent`.
 */
import { userInfo } from 'node:os';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tx } from '../db/connection';
import type { TenantContext } from '../db/session';

const URL_DB =
  process.env.DATABASE_URL ??
  `postgresql://${userInfo().username}@localhost:5432/${process.env.ISTOCK_DB ?? 'istock_dev'}`;
process.env.DATABASE_URL = URL_DB;

vi.mock('server-only', () => ({}));

/** Todo el SQL que se ejecutó desde que se llamó a `empezarACapturar()`. */
const sqlCapturado: string[] = [];

/**
 * Envuelve un objeto de Drizzle para espiar el SQL que construye.
 *
 * Tres detalles y ninguno es adorno — los tres son fallos que este espía tuvo antes de andar:
 * - Los métodos se aplican con el **target crudo** como `this`. Drizzle usa campos privados de
 *   clase y con el proxy de `this` reventarían.
 * - Los builders encadenados devuelven `this`, o sea el target. Si se devolviera tal cual, la
 *   cadena se escaparía del proxy y no se capturaría nada. Cuando el resultado **es** el target se
 *   devuelve el proxy en su lugar.
 * - `tx.select(cols)` devuelve un `PgSelectBuilder`, que **todavía no tiene `toSQL`**: el que lo
 *   tiene es lo que devuelve su `.from()`. Un espía que sólo siguiera objetos con `toSQL` soltaba
 *   la cadena en el primer eslabón y capturaba cero queries — poniendo en verde, por vacío, justo
 *   el caso que tiene que fallar si el `select` del seller pide el costo. Por eso se sigue también
 *   a lo que tenga `from`, y por eso cada caso afirma `sqlCapturado.length > 0`.
 */
function tieneMetodo(value: unknown, name: string): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>)[name] === 'function'
  );
}

function espiar<T extends object>(target: T): T {
  return new Proxy(target, {
    get(t, prop, receiver) {
      if (prop === 'then' && tieneMetodo(t, 'toSQL')) {
        sqlCapturado.push((t as unknown as { toSQL: () => { sql: string } }).toSQL().sql);
      }
      const value = Reflect.get(t, prop, t) as unknown;
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const result = (value as (...a: unknown[]) => unknown).apply(t, args);
        if (result === t) return receiver;
        if (tieneMetodo(result, 'toSQL') || tieneMetodo(result, 'from')) {
          return espiar(result as object);
        }
        return result;
      };
    },
  }) as T;
}

vi.mock('../db/session', async (importOriginal) => {
  const real = await importOriginal<typeof import('../db/session')>();
  return {
    ...real,
    withTenantDb: <T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> =>
      real.withTenantDb(ctx, async (tx) => fn(espiar(tx as unknown as object) as Tx)),
  };
});

const { listTradeinLeads, loadTradeinLead } = await import('./queries');
const { db } = await import('../db/connection');

// ── Fixture ───────────────────────────────────────────────────────────────────────────────────

const TENANT_ID = crypto.randomUUID();
const OTRO_TENANT_ID = crypto.randomUUID();
const OWNER_ID = crypto.randomUUID();
const SELLER_ID = crypto.randomUUID();
const SUFIJO = TENANT_ID.slice(0, 8);

const ctxOwner: TenantContext = { userId: OWNER_ID, tenantId: TENANT_ID, role: 'owner' };
const ctxSeller: TenantContext = { userId: SELLER_ID, tenantId: TENANT_ID, role: 'seller' };

/** Valores elegidos para ser **inconfundibles** dentro de un `JSON.stringify` del payload. */
const OFERTA_DECIMAL = '431.00';
const OFERTA_CENTAVOS = 43_100;
const NOTA_INTERNA = 'PAGO-A-450-SI-INSISTE';
const NOMBRE = 'Visitante del fixture';
const TELEFONO = '5492995550000';

const admin = postgres(URL_DB, { max: 1, prepare: false, onnotice: () => {} });

async function insertarLead(tenantId = TENANT_ID, conSensibles = true): Promise<string> {
  const id = crypto.randomUUID();
  await admin`
    insert into tradein_leads
      (id, tenant_id, customer_name, customer_wa_phone, model_text, storage_gb, color,
       declared_condition, battery_pct, notes, offer_usd, internal_notes)
    values
      (${id}, ${tenantId}, ${NOMBRE}, ${TELEFONO}, 'iPhone 13 128', 128, 'Medianoche',
       'used_excellent', 87, 'Lo cuidé bien',
       ${conSensibles ? OFERTA_DECIMAL : null}, ${conSensibles ? NOTA_INTERNA : null})
  `;
  return id;
}

function empezarACapturar(): void {
  sqlCapturado.length = 0;
}

/** Todo el SQL capturado, en una sola cadena, en minúscula. */
function sqlJunto(): string {
  return sqlCapturado.join('\n').toLowerCase();
}

beforeAll(async () => {
  await admin`insert into auth.users (id, email) values (${OWNER_ID}, ${`owner-${SUFIJO}@test.local`})`;
  await admin`insert into auth.users (id, email) values (${SELLER_ID}, ${`seller-${SUFIJO}@test.local`})`;
  await admin`
    insert into tenants (id, slug, name, wa_phone)
    values (${TENANT_ID}, ${`t-${SUFIJO}`}, 'Fixture de tradein/queries', '2995550000')
  `;
  await admin`
    insert into tenants (id, slug, name, wa_phone)
    values (${OTRO_TENANT_ID}, ${`o-${SUFIJO}`}, 'Vecino del fixture', '2995550001')
  `;
  await admin`
    insert into memberships (tenant_id, user_id, role) values
      (${TENANT_ID}, ${OWNER_ID}, 'owner'), (${TENANT_ID}, ${SELLER_ID}, 'seller')
  `;
  await db().$client.unsafe('select 1');
}, 30_000);

afterAll(async () => {
  await admin`delete from tenants where id in (${TENANT_ID}, ${OTRO_TENANT_ID})`;
  await admin`delete from auth.users where id in (${OWNER_ID}, ${SELLER_ID})`;
  await admin.end({ timeout: 5 });
  await db().$client.end({ timeout: 5 });
});

beforeEach(empezarACapturar);

afterEach(async () => {
  await admin`delete from tradein_leads where tenant_id in (${TENANT_ID}, ${OTRO_TENANT_ID})`;
});

/** El único lead de la lista. Falla acá si el fixture dejó de reproducir el caso. */
function uno<T>(rows: readonly T[]): T {
  expect(rows).toHaveLength(1);
  const row = rows[0];
  if (row === undefined) throw new Error('se esperaba exactamente una fila');
  return row;
}

describe('control positivo · el owner SÍ recibe la oferta y la nota interna', () => {
  it('loadTradeinLead se las trae con el valor real', async () => {
    const leadId = await insertarLead();
    const lead = await loadTradeinLead(ctxOwner, leadId);

    if (lead === null || !lead.canSeeOffer) throw new Error('el owner tendría que ver la oferta');
    expect(lead.offerUsdCents).toBe(OFERTA_CENTAVOS);
    expect(lead.internalNotes).toBe(NOTA_INTERNA);
    // El SQL del owner **sí** nombra las dos columnas: es el contraste que vuelve informativo al
    // caso del seller. Sin esto, un `select` que no las pidiera nunca pasaría los dos casos.
    expect(sqlJunto()).toContain('offer_usd');
    expect(sqlJunto()).toContain('internal_notes');
  });

  it('listTradeinLeads también', async () => {
    await insertarLead();
    const lead = uno(await listTradeinLeads(ctxOwner));

    if (!lead.canSeeOffer) throw new Error('el owner tendría que ver la oferta');
    expect(lead.offerUsdCents).toBe(OFERTA_CENTAVOS);
    expect(lead.internalNotes).toBe(NOTA_INTERNA);
  });
});

describe('gate (b) · el seller no recibe offer_usd ni internal_notes', () => {
  it('loadTradeinLead: las claves NO están en el objeto (no son undefined: no existen)', async () => {
    const leadId = await insertarLead();
    const lead = await loadTradeinLead(ctxSeller, leadId);
    if (lead === null) throw new Error('el seller tendría que ver el lead de su tenant');

    expect(lead.canSeeOffer).toBe(false);
    expect('offerUsdCents' in lead).toBe(false);
    expect('internalNotes' in lead).toBe(false);
    expect(Object.keys(lead)).not.toContain('offerUsdCents');
    expect(Object.keys(lead)).not.toContain('internalNotes');

    // El payload serializado —que es lo que viaja en el RSC— no contiene ni el número ni el texto.
    const payload = JSON.stringify(lead);
    expect(payload).not.toContain(String(OFERTA_CENTAVOS));
    expect(payload).not.toContain(OFERTA_DECIMAL);
    expect(payload).not.toContain(NOTA_INTERNA);

    // Y lo que sí necesita para trabajar el lead en el mostrador, sí está.
    expect(lead.customerName).toBe(NOMBRE);
    expect(lead.customerWaPhone).toBe(TELEFONO);
  });

  it('loadTradeinLead: el SQL del seller no NOMBRA las columnas sensibles', async () => {
    const leadId = await insertarLead();
    await loadTradeinLead(ctxSeller, leadId);

    // Se corrió al menos una query: si no, el caso pasaría por vacío.
    expect(sqlCapturado.length).toBeGreaterThan(0);
    expect(sqlJunto()).not.toContain('offer_usd');
    expect(sqlJunto()).not.toContain('internal_notes');
    // Y la que sí corrió lleva su filtro de tenant explícito además de RLS (`CLAUDE.md` §2).
    expect(sqlJunto()).toContain('tenant_id');
  });

  it('listTradeinLeads: ni en el objeto ni en el SQL', async () => {
    await insertarLead();
    const leads = await listTradeinLeads(ctxSeller);
    const lead = uno(leads);

    expect(lead.canSeeOffer).toBe(false);
    expect('offerUsdCents' in lead).toBe(false);
    expect('internalNotes' in lead).toBe(false);

    const payload = JSON.stringify(leads);
    expect(payload).not.toContain(String(OFERTA_CENTAVOS));
    expect(payload).not.toContain(OFERTA_DECIMAL);
    expect(payload).not.toContain(NOTA_INTERNA);

    expect(sqlCapturado.length).toBeGreaterThan(0);
    expect(sqlJunto()).not.toContain('offer_usd');
    expect(sqlJunto()).not.toContain('internal_notes');
  });

  it('un lead sin oferta cargada se ve igual de vacío para los dos roles, y no es lo mismo', async () => {
    const leadId = await insertarLead(TENANT_ID, false);

    const paraOwner = await loadTradeinLead(ctxOwner, leadId);
    if (paraOwner === null || !paraOwner.canSeeOffer) throw new Error('el owner tendría que ver la rama con oferta');
    // Para el owner la clave **existe** y vale `null`: todavía no cargó la oferta.
    expect('offerUsdCents' in paraOwner).toBe(true);
    expect(paraOwner.offerUsdCents).toBeNull();

    const paraSeller = await loadTradeinLead(ctxSeller, leadId);
    if (paraSeller === null) throw new Error('el seller tendría que ver el lead');
    // Para el seller no existe. Es la distinción que un `null` para los dos borraría.
    expect('offerUsdCents' in paraSeller).toBe(false);
  });
});

describe('aislamiento de tenant', () => {
  it('el lead del vecino no existe para este tenant', async () => {
    const ajeno = await insertarLead(OTRO_TENANT_ID);

    expect(await loadTradeinLead(ctxOwner, ajeno)).toBeNull();
    expect(await loadTradeinLead(ctxSeller, ajeno)).toBeNull();
    expect(await listTradeinLeads(ctxOwner)).toHaveLength(0);
  });
});
