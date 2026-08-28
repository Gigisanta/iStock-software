/**
 * PROBE DEL LEAD PARA S7 — la venta manual, medida contra Postgres real.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *  El defecto que esta probe existe para que no vuelva
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `packages/domain` declaraba `createsSale: to === 'sold'` y **no lo consumía nadie**:
 * `transitionUnit()` ejecutaba tres de los cuatro efectos de `TransitionEffects` y descartaba el
 * cuarto en silencio. La tabla `sales` existía, tenía RLS, tenía índices, la usaba el seed, y
 * ningún código de producción le escribía una fila. Es la misma clase que el fallo de S6: un
 * efecto que el dominio declara y la aplicación ejecuta a medias.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *  Por qué Postgres de verdad y no un `tx` de mentira
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Porque cuatro de los nueve campos **no los puede contestar otra cosa**:
 *
 *  - `margen_derivado_por_postgres`: `sales.margin_usd` es `generatedAlwaysAs(price_usd - cost_usd)`.
 *    Un fake devuelve lo que se le metió, así que "el motor lo deriva" sería una frase, no un hecho.
 *  - `costo_del_form_ignorado`: el costo viaja de columna a columna con un subselect **adentro del
 *    `insert`**. Nunca pasa por el heap de Node, o sea que no hay valor de JS que espiar: la única
 *    forma de saber qué se escribió es preguntárselo a la base.
 *  - `segunda_venta_de_la_misma_unidad`: lo afirma `sales_one_sale_per_listing`, un índice único.
 *  - `costo_congelado_no_se_mueve` / `ars_congelado_no_se_mueve`: se mide moviendo la fila de
 *    origen DESPUÉS de la venta. Sin persistencia real no hay "después".
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *  Por qué vive en `scripts/probes/` y no en `apps/web`
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `CLAUDE.md` §4: la auditoría de referencia —la afirmación que un gate cita y que queda parada
 * entre una venta mal escrita y un merge— **no puede ser del writer del código auditado**.
 * `_lib/listings/publish-listing.test.ts` es de `app-agent`, igual que la venta: es su red de
 * regresión y está bien que exista, pero si `accept-s7.sh` lo citara, `app-agent` estaría firmando
 * su propio certificado. Y esta probe audita a DOS columnas a la vez —el camino de escritura
 * (`app-agent`) y el índice único con la columna generada (`db-agent`)—, así que no puede ser de
 * ninguna de las dos.
 *
 * El fixture se arma con el rol del `DATABASE_URL` (operador, bypassea RLS) y la venta corre por
 * `withTenantDb`, o sea como `authenticated` y con claims: la escritura que se mide es la que hace
 * el panel, no una que se coló por la puerta de servicio.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/** Habla con Next fuera de un request; no es lo que se mide. */
vi.mock('../../apps/web/app/(app)/_lib/tenants/storefront-cache', () => ({
  invalidateStorefront: vi.fn(),
  invalidateStorefrontUnit: vi.fn(),
  invalidateListing: vi.fn(),
}));

/**
 * El logger se **anota**, no se silencia. `record-sale.ts` loguea `sale.fx_unusable` cuando el TC
 * guardado no se puede aplicar, y el caso D necesita distinguir "no había TC" (`freezeFx` devuelve
 * `null` sin log) de "había uno roto" (devuelve `null` CON log). Un mock mudo daría el mismo
 * `price_ars = NULL` en los dos y mediría la nada.
 */
const registroLogs = vi.hoisted(() => [] as { event: string }[]);
vi.mock('../../apps/web/app/(app)/_lib/log', () => ({
  logEvent: (event: string) => {
    registroLogs.push({ event });
  },
  logError: (event: string) => {
    registroLogs.push({ event });
  },
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

const { transitionUnit, ALREADY_SOLD } = await import(
  '../../apps/web/app/(app)/_lib/listings/publish-listing'
);
const { parseStatusForm } = await import(
  '../../apps/web/app/(app)/app/(panel)/stock/status-action-schema'
);

const SLUG_A = 'probe-s7-con-tc';
const SLUG_SIN_TC = 'probe-s7-sin-tc';
/**
 * DOS dueños, uno por tenant, y no es cosmética del fixture: `memberships_single_owner_per_user_key`
 * (0005) es un único parcial sobre `user_id where role = 'owner'` — "una persona POSEE un solo
 * negocio", que es producto (`PRODUCT.md`), no una restricción técnica. Un fixture con un dueño
 * repetido rebota con `23505` antes de medir nada. La probe se adapta al invariante; el invariante
 * no se afloja para que la probe corra.
 */
const USER_A = '77777777-7777-4777-8777-777777777771';
const USER_SIN_TC = '77777777-7777-4777-8777-777777777772';

/**
 * ── Por qué los literales van en DECIMAL y no en centavos ─────────────────────────────────────
 *
 * Las columnas de plata son `numeric(12, 2)` y esta probe le habla al driver crudo, sin pasar por
 * el `customType` `moneyCents` de `@istock/db` que traduce a enteros de centavos. Podría importar
 * `centsToDecimal`/`decimalToCents` para escribir y para leer — y sería un error: **un bug en esa
 * conversión se cancelaría solo**, porque la misma función torcida haría la ida y la vuelta. Acá se
 * escribe `"500.00"` y se espera `"500.00"`: lo que se mide es la columna, no el traductor.
 *
 * `MARGEN` es la excepción que confirma la regla: está escrito como literal **pero no se escribe
 * nunca** — es lo que Postgres tiene que derivar solo en `margin_usd`.
 */
const COSTO = '500.00';
const PRECIO = '620.00';
const MARGEN = '120.00';
const COSTO_FALSO = '1.00';
const TC = '1487.50';

let tenantA = '';
let tenantSinTc = '';

/**
 * ── El parte de la corrida, y por qué el gate no se conforma con el exit code ──────────────────
 *
 * Una probe que dejara de armar el fixture sigue saliendo 0 con las aserciones ejecutadas sobre la
 * nada. Cada caso deja su número acá y `afterAll` lo imprime en UNA línea; `accept-s7.sh` la parsea
 * y compara cada campo contra un literal escrito **en el shell**, o sea en otro archivo y en otro
 * lenguaje (ADR-023): para que el gate mienta hay que romper la probe Y el gate a la vez, en la
 * misma dirección.
 *
 * `-1` y no `0` a propósito: un caso que no corrió tiene que distinguirse de uno que midió cero,
 * porque `segunda_venta_de_la_misma_unidad=0` es un PASS y `sin medir` es un FAIL.
 */
const medido: Record<string, number> = {
  ventas_por_unidad_vendida: -1,
  costo_del_form_ignorado: -1,
  costo_congelado_no_se_mueve: -1,
  margen_derivado_por_postgres: -1,
  ars_congelado_no_se_mueve: -1,
  venta_sin_tc_no_se_bloquea: -1,
  reserva_cerrada_como_confirmed: -1,
  segunda_venta_de_la_misma_unidad: -1,
  costo_o_margen_en_el_retorno: -1,
};

function actor(tenantId: string, slug: string, userId: string) {
  return {
    ctx: { userId, tenantId, role: 'owner' as const },
    tenant: { slug, plan: 'negocio' as const, trialEndsAt: null },
  };
}

async function nuevaUnidad(tenantId: string, estado: string, costo: string | null = COSTO) {
  const id = randomUUID();
  await cliente`
    insert into listings (id, tenant_id, slug, title, condition, price_usd, cost_usd, status)
    values (${id}::uuid, ${tenantId}::uuid, ${'u-' + id.slice(0, 8)}, 'iPhone de prueba',
            'used_excellent', ${PRECIO}, ${costo}, ${estado})`;
  return id;
}

async function ventasDe(listingId: string) {
  return cliente<
    { cost_usd: string | null; price_usd: string; margin_usd: string | null; price_ars: string | null; fx_ars_per_usd: string | null; reservation_id: string | null }[]
  >`select cost_usd, price_usd, margin_usd, price_ars, fx_ars_per_usd, reservation_id
      from sales where listing_id = ${listingId}::uuid`;
}

/** El form tal cual lo manda el panel, más el costo falso que D2 dice que nadie lee. */
function formDeVenta(listingId: string, conCostoFalso: boolean): FormData {
  const fd = new FormData();
  fd.set('listingId', listingId);
  fd.set('to', 'sold');
  fd.set('priceUsd', '620');
  fd.set('paymentMethod', 'cash_usd');
  fd.set('after', 'stay');
  if (conCostoFalso) {
    // Los cuatro nombres plausibles. Si alguno se leyera, `sales.cost_usd` dejaría de ser el de
    // `listings` y `margin_usd` —que Postgres deriva del costo— quedaría escrito desde el request.
    for (const k of ['costUsd', 'cost_usd', 'cost', 'costoUsd']) fd.set(k, '1');
  }
  return fd;
}

async function venderPorElBorde(
  tenantId: string, slug: string, userId: string, listingId: string, conCostoFalso = true,
) {
  const parsed = parseStatusForm(formDeVenta(listingId, conCostoFalso));
  expect(parsed.ok, `el borde rechazó el form de venta: ${parsed.ok ? '' : parsed.error}`).toBe(true);
  if (!parsed.ok || parsed.data.to !== 'sold') throw new Error('el borde no produjo una venta');
  return transitionUnit(actor(tenantId, slug, userId), listingId, {
    to: 'sold',
    sale: { priceUsdCents: parsed.data.priceUsdCents, paymentMethod: parsed.data.paymentMethod },
  });
}

beforeAll(async () => {
  try {
    await cliente`select 1`;
  } catch (error) {
    throw new Error(
      `no hay Postgres en ${process.env.DATABASE_URL ?? '(sin DATABASE_URL)'}. Esta probe mide una ` +
        'columna GENERADA, un índice único y un subselect que nunca pasa por el heap de Node: con ' +
        `un \`tx\` de mentira los tres serían frases. Levantala con \`pnpm db:local\`. Causa: ${String(error)}`,
    );
  }

  await cliente`delete from tenants where slug in (${SLUG_A}, ${SLUG_SIN_TC})`;
  await cliente.unsafe(
    `insert into auth.users (id, email) values
       ('${USER_A}', 'probe-s7-a@maat.work'), ('${USER_SIN_TC}', 'probe-s7-b@maat.work')
     on conflict (id) do nothing`,
  );

  const [a] = await cliente<{ id: string }[]>`
    insert into tenants (slug, name, wa_phone) values (${SLUG_A}, 'Probe S7', '5490000000001') returning id`;
  const [b] = await cliente<{ id: string }[]>`
    insert into tenants (slug, name, wa_phone) values (${SLUG_SIN_TC}, 'Probe S7 sin TC', '5490000000002') returning id`;
  tenantA = a?.id ?? '';
  tenantSinTc = b?.id ?? '';
  expect(tenantA, 'no se pudo crear el tenant del fixture').not.toBe('');
  expect(tenantSinTc, 'no se pudo crear el tenant sin TC').not.toBe('');

  await cliente`
    insert into memberships (tenant_id, user_id, role) values
      (${tenantA}::uuid, ${USER_A}::uuid, 'owner'),
      (${tenantSinTc}::uuid, ${USER_SIN_TC}::uuid, 'owner')`;

  // Sólo A tiene TC. El de `SLUG_SIN_TC` NO se crea: es el fixture del caso D.
  await cliente`
    insert into fx_settings (tenant_id, ars_per_usd, rounding)
    values (${tenantA}::uuid, ${TC}, 'ceil_1000')`;
});

afterAll(async () => {
  await cliente`delete from tenants where slug in (${SLUG_A}, ${SLUG_SIN_TC})`;
  await cliente.unsafe(`delete from auth.users where id in ('${USER_A}', '${USER_SIN_TC}')`);
  // Se imprime SIEMPRE, también cuando un caso falló: el gate tiene que distinguir "no midió" de
  // "midió mal", y un parte que sólo sale en verde no distingue nada.
  console.log(
    'MEDIDO s7 venta · ' +
      Object.entries(medido)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(' · '),
  );
  await cliente.end({ timeout: 5 });
});

describe('S7 · la venta manual escribe una fila y congela lo que tiene que congelar', () => {
  it('A · vender una unidad disponible escribe UNA venta, con el costo de `listings` y no el del form', async () => {
    const listingId = await nuevaUnidad(tenantA, 'available');
    const out = await venderPorElBorde(tenantA, SLUG_A, USER_A, listingId);
    expect(out.ok, `la venta no entró: ${out.ok ? '' : out.message}`).toBe(true);

    const filas = await ventasDe(listingId);
    medido.ventas_por_unidad_vendida = filas.length;
    expect(filas).toHaveLength(1);
    const venta = filas[0];
    if (venta === undefined) throw new Error('sin fila de venta');

    // D2 · el costo salió de la columna, no del request.
    medido.costo_del_form_ignorado =
      venta.cost_usd === COSTO && venta.cost_usd !== COSTO_FALSO ? 1 : 0;
    expect(venta.cost_usd).toBe(COSTO);
    expect(venta.price_usd).toBe(PRECIO);

    // D2 · y `margin_usd` la derivó el motor: no se nombra en el `insert`.
    medido.margen_derivado_por_postgres = venta.margin_usd === MARGEN ? 1 : 0;
    expect(venta.margin_usd).toBe(MARGEN);

    // D6 · nada del retorno habla de costo ni de margen. Los uuid se tachan primero: un id que por
    // azar contuviera "50000" haría fallar la probe por el motivo equivocado, y un gate que falla
    // por azar es un gate que se termina ignorando.
    const payload = JSON.stringify(out).replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      '<id>',
    );
    const sucio =
      /cost|margin|margen|costo|internal_notes/i.test(payload) ||
      // En las dos unidades: la columna guarda `"500.00"`, el código de app piensa en centavos.
      ['500.00', '120.00', '50000', '12000'].some((n) => payload.includes(n));
    medido.costo_o_margen_en_el_retorno = sucio ? 1 : 0;
    expect(sucio, `el retorno de la venta menciona costo o margen: ${payload}`).toBe(false);

    // D4 · el ARS se congeló con el TC del tenant.
    expect(venta.price_ars).not.toBeNull();
    expect(venta.fx_ars_per_usd).not.toBeNull();
  });

  it('B · mover el costo y el TC DESPUÉS de la venta no reescribe la venta', async () => {
    const listingId = await nuevaUnidad(tenantA, 'available');
    expect((await venderPorElBorde(tenantA, SLUG_A, USER_A, listingId)).ok).toBe(true);
    const [antes] = await ventasDe(listingId);
    if (antes === undefined) throw new Error('sin fila de venta');

    // El dueño corrige el costo de la unidad y mueve el TC. La venta ya archivada no se entera.
    await cliente`update listings set cost_usd = '1000.00' where id = ${listingId}::uuid`;
    await cliente`update fx_settings set ars_per_usd = '2975.00' where tenant_id = ${tenantA}::uuid`;

    const [despues] = await ventasDe(listingId);
    if (despues === undefined) throw new Error('la venta desapareció');

    medido.costo_congelado_no_se_mueve =
      despues.cost_usd === antes.cost_usd && despues.margin_usd === antes.margin_usd ? 1 : 0;
    medido.ars_congelado_no_se_mueve =
      despues.price_ars === antes.price_ars && despues.fx_ars_per_usd === antes.fx_ars_per_usd ? 1 : 0;

    expect(despues.cost_usd).toBe(antes.cost_usd);
    expect(despues.margin_usd).toBe(antes.margin_usd);
    expect(despues.price_ars).toBe(antes.price_ars);

    await cliente`update fx_settings set ars_per_usd = ${TC} where tenant_id = ${tenantA}::uuid`;
  });

  /**
   * ── Este caso estaba MAL y lo dijo una mutación, no una lectura ────────────────────────────
   *
   * La primera versión vendía dos veces seguidas y contaba las filas. Salía verde — **y seguía
   * saliendo verde con `sales_one_sale_per_listing` BORRADO de la base**, medido. El motivo: al
   * segundo intento la unidad ya está en `sold`, la máquina de estados contesta `same_state` y
   * corta ANTES de llegar a `sales`. O sea que el campo afirmaba el índice sin tocarlo nunca: el
   * verde venía del `if` de arriba, no del único de abajo.
   *
   * Los dos guardianes son distintos y defienden cosas distintas, así que se miden por separado:
   *   C1 · el doble submit del dueño (dos clics, dos pestañas) lo para la máquina de estados.
   *   C2 · el estado vuelve a `available` —una carrera, o alguien corrigiéndolo a mano— y ahí la
   *        máquina de estados **deja pasar**. Lo único que queda entre eso y una segunda venta de
   *        la misma unidad es el índice, y este caso lo obliga a hablar.
   */
  it('C · ni el doble submit ni un estado revertido escriben una segunda venta', async () => {
    const listingId = await nuevaUnidad(tenantA, 'available');
    expect((await venderPorElBorde(tenantA, SLUG_A, USER_A, listingId)).ok).toBe(true);

    // C1 · la máquina de estados.
    const c1 = await venderPorElBorde(tenantA, SLUG_A, USER_A, listingId);
    expect(c1.ok, 'el doble submit NO tenía que entrar').toBe(false);

    // C2 · el índice. Se revierte el estado sin tocar `sales`, que es lo que pasa cuando dos
    // requests corren a la par: las dos leen `available` y las dos intentan insertar.
    await cliente`update listings set status = 'available' where id = ${listingId}::uuid`;
    const c2 = await venderPorElBorde(tenantA, SLUG_A, USER_A, listingId);
    expect(c2.ok, 'la venta duplicada NO tenía que entrar').toBe(false);
    expect(
      c2.ok ? '' : c2.message,
      'rebotó, pero no por el índice: el mensaje no es el de "ya figura vendido"',
    ).toBe(ALREADY_SOLD);

    const filas = await ventasDe(listingId);
    medido.segunda_venta_de_la_misma_unidad = filas.length - 1;
    expect(filas).toHaveLength(1);
  });

  it('D · un tenant sin TC cargado vende igual, con `price_ars` en NULL', async () => {
    const listingId = await nuevaUnidad(tenantSinTc, 'available');
    registroLogs.length = 0;
    const out = await venderPorElBorde(tenantSinTc, SLUG_SIN_TC, USER_SIN_TC, listingId);
    expect(out.ok, `la falta de TC bloqueó la venta: ${out.ok ? '' : out.message}`).toBe(true);

    const [venta] = await ventasDe(listingId);
    if (venta === undefined) throw new Error('sin fila de venta');

    // No alcanza con que la venta entre: tiene que entrar SIN TC. Un `price_ars` con número acá
    // querría decir que alguien inventó una cotización, que es peor que no tener el dato.
    const sinTc = venta.price_ars === null && venta.fx_ars_per_usd === null;
    // Y no hubo TC roto: `freezeFx` devuelve null sin loguear cuando simplemente no hay fila.
    const noHuboFxRoto = !registroLogs.some((l) => l.event === 'sale.fx_unusable');
    medido.venta_sin_tc_no_se_bloquea = sinTc && noHuboFxRoto ? 1 : 0;

    expect(sinTc).toBe(true);
    expect(noHuboFxRoto, 'se logueó fx_unusable: el fixture tenía un TC roto, no cero TC').toBe(true);
    expect(venta.cost_usd).toBe(COSTO);
  });

  it('E · vender una unidad reservada cierra la reserva como `confirmed`', async () => {
    const listingId = await nuevaUnidad(tenantA, 'reserved');
    const reservationId = randomUUID();
    await cliente`
      insert into reservations (id, tenant_id, listing_id, status, minutes, expires_at)
      values (${reservationId}::uuid, ${tenantA}::uuid, ${listingId}::uuid, 'active', 60,
              now() + interval '60 minutes')`;

    const out = await venderPorElBorde(tenantA, SLUG_A, USER_A, listingId);
    expect(out.ok, `la venta desde reserved no entró: ${out.ok ? '' : out.message}`).toBe(true);

    const [r] = await cliente<{ status: string }[]>`
      select status from reservations where id = ${reservationId}::uuid`;
    medido.reserva_cerrada_como_confirmed = r?.status === 'confirmed' ? 1 : 0;
    expect(r?.status).toBe('confirmed');

    // La venta apunta a la reserva que convirtió: sin esto "cerrada" y "convertida" serían dos
    // hechos sueltos y nadie sabría cuál cerró a cuál.
    const [venta] = await ventasDe(listingId);
    expect(venta?.reservation_id).toBe(reservationId);
  });
});
