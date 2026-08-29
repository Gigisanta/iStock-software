/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  PROBE DE S10 — el import de CSV es TODO O NADA, y lo mide contra Postgres.
 *  gate-owner: LEAD (CLAUDE.md §4 — el gate no puede ser del writer que audita)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ── Por qué esta probe existe teniendo `app-agent` 110 tests verdes ────────────────────────────
 * Los 110 son PUROS: `parse-csv`, `schema` y `build-import` no tocan la base. O sea que lo que
 * está probado es el PLANIFICADOR — que decide que el archivo tiene 8 filas malas — y no el
 * EFECTO, que es la afirmación que el board pide: *«sin import parcial silencioso»*.
 *
 * La diferencia no es ceremonial. La regresión realista de esta slice es que alguien cambie el
 * `insert` multi-fila por un `for` con `try/catch` adentro —que es como se "arregla" un import que
 * falla por una fila— y entonces las 3 filas buenas entran, la pantalla dice *"no importamos
 * nada"*, y **los 110 tests puros siguen verdes**, porque el planificador sigue devolviendo
 * exactamente los mismos 8 errores. Lo único que cambia es el estado de una tabla que ningún test
 * mira. Esta probe cuenta esa tabla.
 *
 * ── Los dos caminos por los que un import puede quedar a medias, y son distintos ───────────────
 * 1. **Rechazo por fila** (caso A): el plan sale `ok: false` y no se escribe nada. Es el camino de
 *    todos los días y es el que la regresión de arriba rompe.
 * 2. **Fallo del motor a mitad del `insert`** (caso D): las unidades entran y el `insert` de
 *    `listing_events` revienta. Acá no hay `if` de la aplicación que lo salve: lo único que
 *    deshace la escritura es la transacción de `withTenantDb`. Se mide **inyectando la falla con
 *    un trigger**, porque no existe un dato de entrada que produzca ese estado — y sin inyectarla,
 *    "es transaccional" es una frase sobre un `await` que nadie ejerció.
 *
 * ── Lo que esta probe NO afirma, escrito para que nadie lo lea de más ──────────────────────────
 * - **No mide el rol.** La segunda capa del costo del `seller` —`ctx.role === 'owner' ? … : null`
 *   en el `values()`— es INALCANZABLE mientras la primera (rechazar el archivo entero con columna
 *   de costo) siga parada, así que medirla exigiría romper la primera. Se mide la primera, que es
 *   la que está en el camino. El modelo completo de permisos es `S11`.
 * - **No mide la pantalla.** `importar-form.tsx` es `'use client'` y el orden de los dos párrafos
 *   —el rojo antes del número bueno— es de los tests de `app-agent`.
 * - **No mide idempotencia.** Subir el mismo archivo dos veces carga los equipos dos veces, y eso
 *   hoy es cierto a propósito: arreglarlo pide una tabla nueva, que es de `db-agent`. Una probe
 *   que lo afirmara estaría afirmando algo que el código no promete.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../../apps/web/app/(app)/_lib/log', () => ({
  logEvent: () => {},
  logError: () => {},
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

const { importListingsFromCsv } = await import(
  '../../apps/web/app/(app)/_lib/csv-import/import-listings'
);

const SLUG_A = 'probe-s10-importa';
const SLUG_B = 'probe-s10-vecino';
const USER_OWNER = '77777777-7777-4777-8777-7777770a1001';
const USER_SELLER = '77777777-7777-4777-8777-7777770a1002';
const USER_OWNER_B = '77777777-7777-4777-8777-7777770a1003';

/**
 * IMEI inválido del fixture: **once** dígitos, no quince. El literal se elige raro a propósito —
 * lo que el caso C afirma es que esta cadena no aparece en NINGÚN mensaje de error, y con un
 * `12345` la aserción pasaría o fallaría por coincidencia con cualquier número del texto.
 */
const IMEI_INVALIDO = '86543210987';

/** Modelos que el seed tiene activos. Si el seed cambia, el fixture rebota y lo dice. */
const MODELO_1 = 'iPhone 14';
const MODELO_2 = 'iPhone 13';
const MODELO_3 = 'iPhone 12';

const ENCABEZADO = 'modelo,condicion,precio_usd,gb,color,bateria,imei';

/**
 * 11 filas de datos (líneas 2 a 12), 3 buenas y 8 malas. **Cada fila mala falla por su cuenta**:
 * ninguna depende de otra fila del archivo. Es lo que hace que el conjunto esperado
 * —`3-4-5-6-7-8-10-11`— se pueda derivar leyendo este fixture, sin leer la implementación.
 *
 * El IMEI repetido entre filas se dejó AFUERA a propósito, aunque sea un caso real: al acusar a
 * dos filas por un solo defecto, el número esperado deja de leerse del fixture y pasa a depender
 * de a cuál de las dos culpa el planificador. Ese caso lo cubren los tests de `app-agent`.
 */
const ARCHIVO_CON_8_MALAS = [
  ENCABEZADO,
  `${MODELO_1},used_excellent,620,256,Grafito,87,`, //  2 · buena
  `${MODELO_1},used_excellent,1.200,256,Grafito,87,`, //  3 · separador de miles
  `${MODELO_1},impecable,620,256,Grafito,87,`, //  4 · condición inexistente
  `Nokia 3310,used_excellent,620,256,Grafito,87,`, //  5 · modelo fuera del catálogo
  `${MODELO_1},used_excellent,620,256,Grafito,87,${IMEI_INVALIDO}`, //  6 · IMEI de 11 dígitos
  `${MODELO_1},used_excellent,620,256,Grafito,150,`, //  7 · batería 150%
  `,used_excellent,620,256,Grafito,87,`, //  8 · modelo vacío
  `${MODELO_2},sealed,900,128,Azul,100,`, //  9 · buena
  `${MODELO_2},sealed,,128,Azul,100,`, // 10 · precio vacío
  `${MODELO_2},sealed,abc,128,Azul,100,`, // 11 · precio no numérico
  `${MODELO_3},open_box,500,64,Negro,95,`, // 12 · buena
].join('\n');

const LINEAS_MALAS_ESPERADAS = 8;
const FILAS_BUENAS_ESPERADAS = 3;

const ARCHIVO_LIMPIO = [
  ENCABEZADO,
  `${MODELO_1},used_excellent,620,256,Grafito,87,`,
  `${MODELO_2},sealed,900,128,Azul,100,`,
  `${MODELO_3},open_box,500,64,Negro,95,`,
].join('\n');

/** Con columna de costo. Para el `seller` esto es un archivo que no puede subir (CLAUDE.md §0.9). */
const ARCHIVO_CON_COSTO = [
  'modelo,condicion,precio_usd,costo_usd',
  `${MODELO_1},used_excellent,620,480`,
].join('\n');

let tenantA = '';
let tenantB = '';

const medido: Record<string, number | string> = {
  lineas_malas: '(sin medir)',
  filas_malas_reportadas: -1,
  filas_buenas_anunciadas: -1,
  unidades_tras_rechazo: -1,
  eventos_tras_rechazo: -1,
  imei_en_los_mensajes: -1,
  unidades_tras_exito: -1,
  eventos_tras_exito: -1,
  unidades_en_otro_tenant: -1,
  unidades_tras_fallo_del_motor: -1,
  archivo_con_costo_de_seller_rechazado: -1,
};

const ctxOwner = { userId: USER_OWNER, tenantId: '', role: 'owner' as const };
const ctxSeller = { userId: USER_SELLER, tenantId: '', role: 'seller' as const };

async function contarUnidades(tenantId: string): Promise<number> {
  const [fila] = await cliente<{ n: string }[]>`
    select count(*)::text as n from listings where tenant_id = ${tenantId}::uuid`;
  return Number(fila?.n ?? '-1');
}

async function contarEventos(tenantId: string): Promise<number> {
  const [fila] = await cliente<{ n: string }[]>`
    select count(*)::text as n from listing_events where tenant_id = ${tenantId}::uuid`;
  return Number(fila?.n ?? '-1');
}

async function vaciarTenant(tenantId: string): Promise<void> {
  await cliente`delete from listings where tenant_id = ${tenantId}::uuid`;
}

beforeAll(async () => {
  try {
    await cliente`select 1`;
  } catch (error) {
    throw new Error(
      `no hay Postgres en ${process.env.DATABASE_URL ?? '(sin DATABASE_URL)'}. Esta probe mide el ` +
        'ESTADO de dos tablas después de un rechazo y el rollback de una transacción: con un `tx` ' +
        `de mentira las dos afirmaciones serían frases. Levantala con \`pnpm db:local\`. Causa: ${String(error)}`,
    );
  }

  await cliente`delete from tenants where slug in (${SLUG_A}, ${SLUG_B})`;
  await cliente.unsafe(
    `insert into auth.users (id, email) values
       ('${USER_OWNER}',   'probe-s10-owner@maat.work'),
       ('${USER_SELLER}',  'probe-s10-seller@maat.work'),
       ('${USER_OWNER_B}', 'probe-s10-vecino@maat.work')
     on conflict (id) do nothing`,
  );

  const [a] = await cliente<{ id: string }[]>`
    insert into tenants (slug, name, wa_phone)
    values (${SLUG_A}, 'Probe S10', '5490000000101') returning id`;
  const [b] = await cliente<{ id: string }[]>`
    insert into tenants (slug, name, wa_phone)
    values (${SLUG_B}, 'Probe S10 vecino', '5490000000102') returning id`;
  tenantA = a?.id ?? '';
  tenantB = b?.id ?? '';
  expect(tenantA, 'no se pudo crear el tenant del fixture').not.toBe('');
  expect(tenantB, 'no se pudo crear el tenant vecino').not.toBe('');

  await cliente`
    insert into memberships (tenant_id, user_id, role) values
      (${tenantA}::uuid, ${USER_OWNER}::uuid,   'owner'),
      (${tenantA}::uuid, ${USER_SELLER}::uuid,  'seller'),
      (${tenantB}::uuid, ${USER_OWNER_B}::uuid, 'owner')`;

  ctxOwner.tenantId = tenantA;
  ctxSeller.tenantId = tenantA;

  // El fixture depende del seed del catálogo. Si el modelo no está, la probe tiene que decir ESO
  // y no "8 filas malas": un fixture que se degrada solo mide otra cosa con el mismo nombre.
  const modelos = await cliente<{ display_name: string }[]>`
    select display_name from catalog_models
    where is_active and display_name in (${MODELO_1}, ${MODELO_2}, ${MODELO_3})`;
  expect(
    modelos.length,
    `el seed no tiene los tres modelos del fixture (${MODELO_1}, ${MODELO_2}, ${MODELO_3}). ` +
      'Corré `pnpm db:seed` antes de esta probe: sin catálogo, TODAS las filas darían error de ' +
      'modelo y el conteo de filas malas mediría el seed, no el import.',
  ).toBe(3);
});

afterAll(async () => {
  await cliente.unsafe(`drop trigger if exists probe_s10_revienta on listing_events`);
  await cliente.unsafe(`drop function if exists probe_s10_revienta()`);
  await cliente`delete from tenants where slug in (${SLUG_A}, ${SLUG_B})`;
  await cliente.unsafe(
    `delete from auth.users where id in ('${USER_OWNER}', '${USER_SELLER}', '${USER_OWNER_B}')`,
  );
  // Se imprime SIEMPRE, también cuando un caso falló: el gate tiene que distinguir "no midió" de
  // "midió mal", y un parte que sólo sale en verde no distingue nada.
  console.log(
    'MEDIDO s10 import · ' +
      Object.entries(medido)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(' · '),
  );
  await cliente.end({ timeout: 5 });
});

describe('S10 · el import de CSV es todo o nada, medido sobre las tablas', () => {
  it('A · 8 filas malas entre 11: se reportan las OCHO y no se escribe NADA', async () => {
    const antes = await contarUnidades(tenantA);
    expect(antes, 'el fixture arranca con el tenant vacío').toBe(0);

    const out = await importListingsFromCsv(ctxOwner, ARCHIVO_CON_8_MALAS);

    expect(out.ok, 'un archivo con 8 filas malas no puede importar').toBe(false);
    if (out.ok) throw new Error('importó un archivo con filas malas');
    expect(out.kind, `el rechazo tiene que ser por filas, no por archivo: ${JSON.stringify(out)}`).toBe(
      'rows',
    );
    if (out.kind !== 'rows') throw new Error('rechazo por archivo entero');

    // El conjunto EXACTO, no la cantidad: 8 errores sobre 8 filas equivocadas dan el mismo número
    // que 8 sobre las correctas. Se emite como texto para que el `.sh` compare contra un literal
    // escrito allá (ADR-023) y no contra algo derivado de este archivo.
    const lineas = [...new Set(out.issues.map((i) => i.line))].sort((x, y) => x - y);
    medido.lineas_malas = lineas.join('-');
    medido.filas_malas_reportadas = lineas.length;
    medido.filas_buenas_anunciadas = out.okCount;

    expect(out.issueCount).toBe(LINEAS_MALAS_ESPERADAS);
    expect(out.okCount).toBe(FILAS_BUENAS_ESPERADAS);
    expect(out.rowCount).toBe(11);

    // LA afirmación de la slice. Si alguien cambia el `insert` multi-fila por un `for` con
    // `try/catch`, esto da 3 y todo lo de arriba sigue verde.
    medido.unidades_tras_rechazo = await contarUnidades(tenantA);
    medido.eventos_tras_rechazo = await contarEventos(tenantA);
    expect(medido.unidades_tras_rechazo).toBe(0);
    expect(medido.eventos_tras_rechazo).toBe(0);

    // C · el IMEI inválido nunca sale impreso (CLAUDE.md §1: "IMEI nunca ... ni en logs").
    const todoElTexto = out.issues.map((i) => i.message).join(' | ');
    medido.imei_en_los_mensajes = todoElTexto.includes(IMEI_INVALIDO) ? 1 : 0;
    expect(todoElTexto).not.toContain(IMEI_INVALIDO);
  });

  it('B · el archivo limpio entra ENTERO, en su tenant y en ningún otro', async () => {
    await vaciarTenant(tenantA);

    const out = await importListingsFromCsv(ctxOwner, ARCHIVO_LIMPIO);
    expect(out.ok, `el archivo limpio no entró: ${JSON.stringify(out)}`).toBe(true);
    if (!out.ok) throw new Error('el archivo limpio no entró');
    expect(out.imported).toBe(3);

    medido.unidades_tras_exito = await contarUnidades(tenantA);
    medido.eventos_tras_exito = await contarEventos(tenantA);
    medido.unidades_en_otro_tenant = await contarUnidades(tenantB);

    expect(medido.unidades_tras_exito).toBe(3);
    // Una bitácora por unidad. Un evento de menos es un alta sin rastro; uno de más es una unidad
    // fantasma en la historia del stock.
    expect(medido.eventos_tras_exito).toBe(3);
    expect(medido.unidades_en_otro_tenant).toBe(0);
  });

  it('D · si el motor revienta a mitad del `insert`, no queda NI UNA unidad', async () => {
    await vaciarTenant(tenantA);

    // Inyección de falla. No hay archivo que produzca este estado: las unidades se escriben bien y
    // lo que revienta es el `insert` de la bitácora, o sea el segundo `await` de la transacción.
    // El trigger se acota a este tenant para no tocar nada más de la base de desarrollo.
    await cliente.unsafe(`
      create or replace function probe_s10_revienta() returns trigger as $$
      begin
        if new.tenant_id = '${tenantA}'::uuid then
          raise exception 'probe s10: falla inyectada en listing_events';
        end if;
        return new;
      end $$ language plpgsql`);
    await cliente.unsafe(`
      create trigger probe_s10_revienta before insert on listing_events
      for each row execute function probe_s10_revienta()`);

    try {
      await expect(
        importListingsFromCsv(ctxOwner, ARCHIVO_LIMPIO),
        'la falla del motor tiene que propagarse: tragarla y devolver `ok` sería el peor de los ' +
          'dos mundos — el dueño ve "importado" y no hay nada',
      ).rejects.toThrow();
    } finally {
      await cliente.unsafe(`drop trigger if exists probe_s10_revienta on listing_events`);
      await cliente.unsafe(`drop function if exists probe_s10_revienta()`);
    }

    // Las tres unidades SE ESCRIBIERON antes de que reventara la bitácora. Que no queden es la
    // transacción de `withTenantDb` haciendo su trabajo, y es lo único que lo hace.
    medido.unidades_tras_fallo_del_motor = await contarUnidades(tenantA);
    expect(medido.unidades_tras_fallo_del_motor).toBe(0);
  });

  it('E · el `seller` no puede subir un archivo con columna de costo', async () => {
    await vaciarTenant(tenantA);

    const out = await importListingsFromCsv(ctxSeller, ARCHIVO_CON_COSTO);
    const rechazado = !out.ok && out.kind === 'file';
    medido.archivo_con_costo_de_seller_rechazado = rechazado ? 1 : 0;

    expect(rechazado, `el seller subió un archivo con costo: ${JSON.stringify(out)}`).toBe(true);
    expect(await contarUnidades(tenantA), 'el rechazo por rol tampoco escribe nada').toBe(0);

    // El mismo archivo, con el dueño, sí entra. Sin esta mitad el caso pasaría igual si el import
    // estuviera roto para todo el mundo: mediría "nadie puede importar", no "el seller no puede".
    const conDueno = await importListingsFromCsv(ctxOwner, ARCHIVO_CON_COSTO);
    expect(conDueno.ok, `el dueño sí carga costos: ${JSON.stringify(conDueno)}`).toBe(true);

    const [fila] = await cliente<{ cost_usd: string | null }[]>`
      select cost_usd from listings where tenant_id = ${tenantA}::uuid`;
    expect(fila?.cost_usd, 'el costo del dueño se guarda').toBe('480.00');
  });
});
