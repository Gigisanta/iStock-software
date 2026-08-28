/**
 * PROBE DEL LEAD PARA S8 — el canje, medido contra Postgres real.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *  Qué se mide y por qué no lo puede contestar otra cosa
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * S8 abre la SEGUNDA escritura sin autenticar del producto, y a diferencia del beacon de S4 esta
 * escribe PII de una persona: nombre y WhatsApp de alguien que quiere entregar su teléfono. La
 * afirmación que sostiene la slice tiene dos mitades y ninguna vive en TypeScript:
 *
 *   (a) `anon` ESCRIBE nueve columnas y sólo esas nueve — lo decide el `GRANT` de la 0008.
 *   (b) `anon` NO LEE nada de esta tabla — lo decide la AUSENCIA de un `GRANT SELECT`.
 *
 * Un fake devuelve lo que se le metió, así que "el GRANT no incluye `offer_usd`" sería una frase.
 * Y hay una distinción que sólo Postgres puede hacer, que es la que este repo ya pagó una vez:
 * **`42501` tapa dos capas distintas**. `permission denied for table X` es la capa `GRANT`;
 * `new row violates row-level security policy` es la capa de policy. Un test que compara sólo el
 * código sale verde el día que alguien abra el `GRANT`, porque la policy seguiría rechazando y el
 * número no se movería. Por eso cada caso de abajo mira el MENSAJE y no sólo el código.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *  Por qué la sesión `anon` se arma acá y no con `openSession()` de `@istock/db`
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `packages/db/src/test-session.ts` hace exactamente esto y lo hace bien. No se usa por una razón
 * de independencia, no de calidad: es de `db-agent`, que es el writer de los `GRANT` y de las
 * policies que esta probe audita. Si ese helper algún día dejara de cambiar de rol —y hay una
 * forma trivial de que pase, `set local role` FUERA de un bloque de transacción es un no-op que
 * sólo emite un WARNING—, todos los casos correrían como superusuario, que bypassea RLS y GRANT a
 * la vez, y esta probe saldría verde sin haber medido nada. Es un error que el LEAD cometió en
 * esta misma slice, midiendo a mano, y por eso `comoAnon()` lleva un CANARIO: cada transacción
 * anota su `current_user` y `afterAll` exige que las N anotaciones digan `anon`.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *  Por qué vive en `scripts/probes/` (CLAUDE.md §4)
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * La auditoría de referencia —la afirmación que un gate cita y que queda parada entre una policy
 * aflojada y un merge— no puede ser del writer del código auditado. Esta probe audita a TRES
 * columnas a la vez: el `GRANT` y la policy (`db-agent`), el handler público (`storefront-agent`)
 * y el camino de aceptación del panel (`app-agent`). No puede ser de ninguna de las tres.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const registroLogs = vi.hoisted(() => [] as string[]);
vi.mock('../../apps/web/app/(app)/_lib/log', () => ({
  logEvent: (event: string) => void registroLogs.push(event),
  logError: (event: string) => void registroLogs.push(event),
}));

const { cliente, base } = await vi.hoisted(async () => {
  const { userInfo: quien } = await import('node:os');
  const url =
    process.env.DATABASE_URL ??
    `postgresql://${quien().username}@localhost:5432/${process.env.ISTOCK_DB ?? 'istock_dev'}`;
  process.env.DATABASE_URL = url;
  const { default: pg } = await import('postgres');
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const c = pg(url, { max: 1, prepare: false, onnotice: () => {} });
  return { cliente: c, base: drizzle(c) };
});

vi.mock('../../apps/web/app/(app)/_lib/db/connection', () => ({ db: () => base }));

const { acceptToStock } = await import('../../apps/web/app/(app)/_lib/tradein/accept-to-stock');
const { listTradeinLeads } = await import('../../apps/web/app/(app)/_lib/tradein/queries');

const SLUG_A = 'probe-s8-canje-a';
const SLUG_B = 'probe-s8-canje-b';
/** Un dueño por tenant: `memberships_single_owner_per_user_key` es un único parcial sobre `user_id`. */
const USER_A = '78787878-7878-4878-8878-787878787871';
const USER_B = '78787878-7878-4878-8878-787878787872';
/** El vendedor del tenant A. Es quien mide la mitad de SALIDA de la regla 9. */
const USER_SELLER_A = '78787878-7878-4878-8878-787878787873';

/** Las nueve columnas del `GRANT` de la 0008, en el orden en que la migración las nombra. */
const NUEVE = [
  'tenant_id', 'customer_name', 'customer_wa_phone', 'model_text',
  'storage_gb', 'color', 'declared_condition', 'battery_pct', 'notes',
] as const;

let tenantA = '';
let tenantB = '';
let modelo = '';

/**
 * El canario de la escotilla. Cada transacción de `comoAnon()` anota qué rol vio Postgres de
 * verdad. Si `set local role` dejara de cambiar el rol, los nueve casos correrían como
 * superusuario —que bypassea RLS y GRANT a la vez— y todos "pasarían". `afterAll` lo exige.
 */
const rolesVistos: string[] = [];

/**
 * `-1` y no `0`: un caso que no corrió tiene que distinguirse de uno que midió cero, porque
 * `lead_a_tenant_ajeno=0` es un PASS y "sin medir" es un FAIL.
 */
const medido: Record<string, number> = {
  lead_anonimo_entra: -1,
  lead_sin_claim_no_entra: -1,
  lead_a_tenant_ajeno: -1,
  offer_usd_desde_anon: -1,
  returning_desde_anon: -1,
  checks_del_motor: -1,
  accept_crea_unidad_en_draft: -1,
  accept_dos_veces_una_unidad: -1,
  costo_en_el_payload_del_seller: -1,
};

type Fila = Record<string, unknown>;

/**
 * Corre `text` como `anon`, con el claim de `slug` (o sin claim si es `null`). Todo adentro de un
 * `begin … rollback implícito por error` / commit: `set local` sólo existe dentro de una
 * transacción, y afuera es un no-op silencioso.
 */
async function comoAnon(slug: string | null, text: string, params: unknown[] = []): Promise<Fila[]> {
  return cliente.begin(async (tx) => {
    await tx.unsafe('set local role anon');
    const claims = slug === null ? '{}' : JSON.stringify({ role: 'anon', app_metadata: { storefront_slug: slug } });
    await tx.unsafe(`select set_config('request.jwt.claims', $1, true)`, [claims]);
    const canario = (await tx.unsafe('select current_user')) as unknown as { current_user: string }[];
    rolesVistos.push(canario[0]?.current_user ?? '(sin fila)');
    const filas = await tx.unsafe(text, params as Parameters<typeof tx.unsafe>[1]);
    return filas as unknown as Fila[];
  }) as unknown as Promise<Fila[]>;
}

/** Igual, esperando que Postgres rechace. Devuelve código Y mensaje: `42501` tapa dos capas. */
async function anonFalla(
  slug: string | null, text: string, params: unknown[] = [],
): Promise<{ code: string; message: string }> {
  try {
    await comoAnon(slug, text, params);
  } catch (error) {
    const { code, message } = error as { code?: string; message?: string };
    return { code: code ?? 'SIN_CODIGO', message: message ?? '' };
  }
  throw new Error(`se esperaba un rechazo de Postgres y la sentencia pasó: ${text}`);
}

/** El insert de nueve columnas tal cual lo manda el handler público, parametrizado. */
function insertDeNueve(columnas: readonly string[] = NUEVE): string {
  const placeholders = columnas.map((_, i) => `$${String(i + 1)}`).join(', ');
  return `insert into tradein_leads (${columnas.map((c) => `"${c}"`).join(', ')}) values (${placeholders})`;
}

function valoresDeNueve(tenantId: string, over: Partial<Record<string, unknown>> = {}): unknown[] {
  const base: Record<string, unknown> = {
    tenant_id: tenantId,
    customer_name: 'Visitante de Cipolletti',
    customer_wa_phone: '5492995550000',
    model_text: 'iPhone 12 128',
    storage_gb: 128,
    color: 'Negro',
    declared_condition: 'used_excellent',
    battery_pct: 87,
    notes: null,
  };
  return NUEVE.map((c) => (c in over ? over[c] : base[c]));
}

async function cuantosLeads(tenantId: string): Promise<number> {
  const filas = await cliente<{ n: string }[]>`
    select count(*)::text as n from tradein_leads where tenant_id = ${tenantId}::uuid`;
  return Number(filas[0]?.n ?? '-1');
}

function ctxDe(tenantId: string, userId: string, role: 'owner' | 'seller') {
  return { userId, tenantId, role } as const;
}

beforeAll(async () => {
  try {
    await cliente`select 1`;
  } catch (error) {
    throw new Error(
      `no hay Postgres en ${process.env.DATABASE_URL ?? '(sin DATABASE_URL)'}. Esta probe mide un ` +
        'GRANT por columna, la AUSENCIA de un GRANT SELECT y la diferencia entre dos rechazos que ' +
        `comparten el código 42501: con un \`tx\` de mentira las tres serían frases. Causa: ${String(error)}`,
    );
  }

  await cliente`delete from tenants where slug in (${SLUG_A}, ${SLUG_B})`;
  await cliente.unsafe(
    `insert into auth.users (id, email) values
       ('${USER_A}', 'probe-s8-a@maat.work'),
       ('${USER_B}', 'probe-s8-b@maat.work'),
       ('${USER_SELLER_A}', 'probe-s8-seller@maat.work')
     on conflict (id) do nothing`,
  );

  // `accepts_trade_in` se prende A PROPOSITO y en el fixture, no en el caso. La `0009` (fila S8.1)
  // ato la policy `TO anon` a la bandera del tenant, y la columna nace `default false`: sin esta
  // linea, A no puede recibir un canje y los casos A y F no MIDEN — que es distinto de medir cero.
  // Asi fallo esta probe la primera vez que se corrio despues de la 0009, y el gate hizo bien en
  // rechazar la slice: `-1` no es `0`. Lo que esta probe mide es la vidriera de un tenant que SI
  // acepta canjes; el polo negativo —bandera apagada ⇒ el insert rebota— es R2c-g de
  // `tests/rls-cross-tenant.test.ts`, de `qa-agent`, y es la auditoria de referencia por §4.
  const [a] = await cliente<{ id: string }[]>`
    insert into tenants (slug, name, wa_phone, accepts_trade_in)
      values (${SLUG_A}, 'Probe S8 A', '5490000000081', true) returning id`;
  const [b] = await cliente<{ id: string }[]>`
    insert into tenants (slug, name, wa_phone, accepts_trade_in)
      values (${SLUG_B}, 'Probe S8 B', '5490000000082', true) returning id`;
  tenantA = a?.id ?? '';
  tenantB = b?.id ?? '';
  expect(tenantA, 'no se pudo crear el tenant A del fixture').not.toBe('');
  expect(tenantB, 'no se pudo crear el tenant B del fixture').not.toBe('');

  await cliente`
    insert into memberships (tenant_id, user_id, role) values
      (${tenantA}::uuid, ${USER_A}::uuid, 'owner'),
      (${tenantA}::uuid, ${USER_SELLER_A}::uuid, 'seller'),
      (${tenantB}::uuid, ${USER_B}::uuid, 'owner')`;

  const [m] = await cliente<{ id: string }[]>`
    insert into catalog_models (slug, display_name, release_year)
    values (${'probe-s8-' + randomUUID().slice(0, 8)}, 'iPhone 12', 2020) returning id`;
  modelo = m?.id ?? '';
  expect(modelo, 'no se pudo crear el modelo de catálogo del fixture').not.toBe('');
});

afterAll(async () => {
  await cliente`delete from tenants where slug in (${SLUG_A}, ${SLUG_B})`;
  await cliente.unsafe(`delete from catalog_models where id = '${modelo}'`);
  await cliente.unsafe(
    `delete from auth.users where id in ('${USER_A}', '${USER_B}', '${USER_SELLER_A}')`,
  );

  // El canario, antes del parte: si el rol no cambió, el parte de arriba no midió nada.
  const impostores = rolesVistos.filter((r) => r !== 'anon');
  const canario = rolesVistos.length > 0 && impostores.length === 0;

  console.log(
    'MEDIDO s8 canje · ' +
      Object.entries(medido).map(([k, v]) => `${k}=${String(v)}`).join(' · ') +
      ` · canario_rol_anon=${canario ? '1' : '0'} (${String(rolesVistos.length)} transacciones)`,
  );
  await cliente.end({ timeout: 5 });
});

describe('S8 · la vidriera escribe el canje y no lo lee', () => {
  it('A · con claim del slug, el insert de nueve columnas entra', async () => {
    const antes = await cuantosLeads(tenantA);
    await comoAnon(SLUG_A, insertDeNueve(), valoresDeNueve(tenantA));
    const despues = await cuantosLeads(tenantA);
    medido.lead_anonimo_entra = despues - antes;
    expect(despues - antes).toBe(1);
  });

  it('B · sin claim no entra nada, y falla en la POLICY, no en el GRANT', async () => {
    const antes = await cuantosLeads(tenantA);
    const { code, message } = await anonFalla(null, insertDeNueve(), valoresDeNueve(tenantA));
    const despues = await cuantosLeads(tenantA);
    medido.lead_sin_claim_no_entra = despues - antes;
    expect(despues - antes).toBe(0);
    expect(code).toBe('42501');
    // La capa importa: si esto dijera `permission denied for table`, el `GRANT` se habría caído y
    // el caso A estaría midiendo otra cosa.
    expect(message).toMatch(/row-level security/i);
  });

  it('C · con claim de A, un `tenant_id` de B rebota en la policy', async () => {
    const antes = await cuantosLeads(tenantB);
    const { code, message } = await anonFalla(SLUG_A, insertDeNueve(), valoresDeNueve(tenantB));
    const despues = await cuantosLeads(tenantB);
    medido.lead_a_tenant_ajeno = despues - antes;
    expect(despues - antes).toBe(0);
    expect(code).toBe('42501');
    expect(message).toMatch(/row-level security/i);
  });

  it('D · nombrar `offer_usd` es `permission denied`: es GRANT, no policy', async () => {
    const columnas = [...NUEVE, 'offer_usd'];
    const { code, message } = await anonFalla(
      SLUG_A, insertDeNueve(columnas), [...valoresDeNueve(tenantA), 5000],
    );
    // El campo cuenta los FALLOS de la afirmación, así que 0 es el PASS: o entró, o rebotó por la
    // capa equivocada. Un rechazo de policy acá querría decir que `anon` TIENE el privilegio de
    // escribir el costo y lo único que lo para es una condición de fila.
    const malo = code === '42501' && /permission denied/i.test(message) ? 0 : 1;
    medido.offer_usd_desde_anon = malo;
    expect(malo).toBe(0);
    // La misma vara para `internal_notes`: las dos columnas SENSITIVE de la tabla.
    const otro = await anonFalla(
      SLUG_A, insertDeNueve([...NUEVE, 'internal_notes']), [...valoresDeNueve(tenantA), 'nota'],
    );
    expect(otro.code).toBe('42501');
    expect(otro.message).toMatch(/permission denied/i);
  });

  it('E · `insert ... returning` no devuelve nada: `anon` no lee esta tabla', async () => {
    const { code, message } = await anonFalla(
      SLUG_A, `${insertDeNueve()} returning id, customer_wa_phone`, valoresDeNueve(tenantA),
    );
    // Es la mitad que hace que la PII no vuelva por la misma puerta por la que entró. Falla en la
    // capa GRANT porque no hay `GRANT SELECT`: no hay policy de SELECT que aflojar, no existe.
    const malo = code === '42501' && /permission denied/i.test(message) ? 0 : 1;
    medido.returning_desde_anon = malo;
    expect(malo).toBe(0);
  });

  it('F · los siete CHECK del motor: el valor justo adentro entra, el justo afuera rebota', async () => {
    // `[columna, adentro, afuera]`. Cada par mide el BORDE, no un valor cómodo: un CHECK escrito
    // con `<` en vez de `<=` sólo se nota en el borde.
    const pares: readonly (readonly [string, unknown, unknown])[] = [
      ['customer_name', 'x'.repeat(80), 'x'.repeat(81)],
      ['customer_wa_phone', '123456', '12345'],
      ['model_text', 'm'.repeat(120), 'm'.repeat(121)],
      ['color', 'c'.repeat(40), 'c'.repeat(41)],
      ['notes', 'n'.repeat(500), 'n'.repeat(501)],
      ['battery_pct', 100, 101],
      ['storage_gb', 4096, 4097],
    ];

    let bien = 0;
    for (const [columna, adentro, afuera] of pares) {
      const antes = await cuantosLeads(tenantA);
      await comoAnon(SLUG_A, insertDeNueve(), valoresDeNueve(tenantA, { [columna]: adentro }));
      const entro = (await cuantosLeads(tenantA)) - antes === 1;

      const rechazo = await anonFalla(
        SLUG_A, insertDeNueve(), valoresDeNueve(tenantA, { [columna]: afuera }),
      );
      const reboto = rechazo.code === '23514';
      if (entro && reboto) bien += 1;
      else expect.soft(`${columna}: adentro=${String(entro)} afuera=${rechazo.code}`).toBe('ok');
    }
    medido.checks_del_motor = bien === pares.length ? 1 : 0;
    expect(bien).toBe(pares.length);
  });
});

describe('S8 · el dueño acepta el canje y nace una unidad', () => {
  const entrada = (leadId: string) => ({
    leadId,
    title: 'iPhone 12 128 Negro',
    catalogModelId: modelo,
    condition: 'used_excellent' as const,
    storageGb: 128,
    color: 'Negro',
    batteryPct: 87,
    priceUsd: 62_000,
    offerUsd: 50_000,
  });

  async function nuevoLead(): Promise<string> {
    const [fila] = await cliente<{ id: string }[]>`
      insert into tradein_leads (tenant_id, customer_name, customer_wa_phone, model_text)
      values (${tenantA}::uuid, 'Cliente del mostrador', '5492995551111', 'iPhone 12 128')
      returning id`;
    return fila?.id ?? '';
  }

  it('G · la unidad nace `draft` y con `cost_usd` copiado de la oferta', async () => {
    const leadId = await nuevoLead();
    const salida = await acceptToStock(ctxDe(tenantA, USER_A, 'owner'), entrada(leadId));
    expect(salida.ok, salida.ok ? '' : salida.message).toBe(true);
    if (!salida.ok) return;

    const [unidad] = await cliente<{ status: string; cost_usd: string | null; kind: string }[]>`
      select status, cost_usd, kind from listings where id = ${salida.listingId}::uuid`;
    const [lead] = await cliente<{ status: string; created_listing_id: string | null }[]>`
      select status, created_listing_id from tradein_leads where id = ${leadId}::uuid`;

    // Las cuatro mitades de "entró al stock": nace borrador, es una unidad, el costo salió de la
    // oferta (columna a columna, sin pasar por el heap de Node) y el lead quedó atado a la unidad.
    const bien =
      unidad?.status === 'draft' &&
      unidad.kind === 'unit' &&
      unidad.cost_usd === '500.00' &&
      lead?.status === 'accepted' &&
      lead.created_listing_id === salida.listingId;
    medido.accept_crea_unidad_en_draft = bien ? 1 : 0;
    expect({
      status: unidad?.status, kind: unidad?.kind, cost: unidad?.cost_usd,
      lead: lead?.status, atado: lead?.created_listing_id === salida.listingId,
    }).toEqual({ status: 'draft', kind: 'unit', cost: '500.00', lead: 'accepted', atado: true });
  });

  it('H · aceptar dos veces crea UNA unidad, no dos', async () => {
    const leadId = await nuevoLead();
    const uno = await acceptToStock(ctxDe(tenantA, USER_A, 'owner'), entrada(leadId));
    const dos = await acceptToStock(ctxDe(tenantA, USER_A, 'owner'), entrada(leadId));
    expect(uno.ok).toBe(true);
    // El segundo no es un error del motor: es un fallo con mensaje, que es lo que ve la persona.
    expect(dos.ok).toBe(false);

    const conteo = await cliente<{ n: string }[]>`
      select count(*)::text as n from listings
       where id in (select created_listing_id from tradein_leads where id = ${leadId}::uuid)`;
    const n = Number(conteo[0]?.n ?? '-1');
    medido.accept_dos_veces_una_unidad = n === 1 ? 1 : 0;
    expect(n).toBe(1);
  });

  it('I · el payload del seller no trae el costo, medido sobre el OBJETO', async () => {
    const leadId = await nuevoLead();
    await acceptToStock(ctxDe(tenantA, USER_A, 'owner'), entrada(leadId));

    const filas = await listTradeinLeads(ctxDe(tenantA, USER_SELLER_A, 'seller'));
    expect(filas.length).toBeGreaterThan(0);

    /**
     * Se censa el OBJETO, no el tipo: `TradeinLeadForSeller` no tiene `offerUsdCents` en la firma
     * y aun así el objeto podría traerlo si alguien devolviera la fila cruda. Y se exige AUSENCIA
     * de la clave, no `null`: un `null` serializado sigue diciendo que el campo existe.
     *
     * El nombre del campo dice `costo` y no `costo_o_pii` a propósito, y la spec de este gate lo
     * decía al revés. El seller SÍ ve el nombre y el WhatsApp del visitante: es la PII con la que
     * atiende el mostrador, y §0.9 de CLAUDE.md prohíbe el costo y el margen, no el contacto del
     * cliente. Un campo que contara la PII como fuga daría 2 sobre código correcto y enseñaría a
     * bajarle la vara al gate.
     */
    const prohibidas = ['offerUsdCents', 'internalNotes', 'offer_usd', 'internal_notes', 'costUsd', 'cost_usd'];
    const fugas = filas.flatMap((fila) =>
      prohibidas.filter((k) => Object.hasOwn(fila as object, k)).map((k) => `${fila.id}:${k}`),
    );
    medido.costo_en_el_payload_del_seller = fugas.length;
    expect(fugas).toEqual([]);
    // Y el contraste que hace útil al número: para el dueño el costo SÍ está. Sin esto, un payload
    // vacío para todo el mundo daría 0 y pasaría.
    const delDueno = await listTradeinLeads(ctxDe(tenantA, USER_A, 'owner'));
    expect(delDueno.some((f) => Object.hasOwn(f as object, 'offerUsdCents'))).toBe(true);
  });
});
