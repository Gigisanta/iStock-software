/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  D8 — UNA UNIDAD TIENE A LO SUMO UNA VENTA, AFIRMADO EN EL MOTOR. CONTRA POSTGRES REAL.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * El índice lo crea `drizzle/0007_sales_one_sale_per_listing.sql`. Existe porque hasta S7 la
 * invariante la sostenían **dos cosas que viven las dos en `apps/web`**: `sold` es terminal
 * (`checkTransition` → `terminal_state`) y el `eq(listings.status, from)` que `transitionUnit()`
 * usa como guard de concurrencia. Ninguna vive en la base, y `sales` no tenía —hasta esta slice—
 * un solo escritor de producción: el primero llega con S7 y el segundo (un canje que cierra en
 * venta, un import, un backfill) va a llegar sin re-derivar la regla.
 *
 * ## Lo que este archivo prueba, y por qué no alcanza con "el índice existe"
 * Que exista un índice único es una línea de `\d sales`. Lo que hay que medir es que la
 * **sentencia que emite el caller real** choque contra él, y que las dos capas que rodean a esa
 * escritura sigan en pie:
 *
 *   · **Capa 1 · `GRANT`** — `sales` tiene privilegios desde `0001`, pero **nunca se ejercieron**:
 *     ningún código de producción le escribió jamás una fila. Un privilegio no ejercido es una
 *     suposición, y este repo ya pagó un fallo de slice por confundir las dos capas: un rol con
 *     `BYPASSRLS` y sin `GRANT` recibe `42501` y no lee nada (CLAUDE.md §2 y §3). S7 es la slice
 *     donde se enciende, así que acá se mide.
 *   · **Capa 2 · policy** — el `with check` de `sales_tenant_insert` tiene que atar el `tenant_id`
 *     a la sesión. Sin él, un tenant escribe filas en la cuenta de otro aunque no pueda leerlas.
 *
 * ## La forma del caller, no la forma cómoda
 * Es la lección que S6 pagó rompiendo el alta de reservas: el panel **no escribe SQL**, llama a
 * `db.insert(sales).values({...})`, y Drizzle NOMBRA todas las columnas de la tabla poniendo
 * `default` en las que no le pasaste — Postgres exige el privilegio sobre cada columna nombrada
 * aunque el valor sea `DEFAULT`. Por eso las sentencias de acá se construyen con el query builder
 * y se ejecutan con sus `$n`, y la lista de columnas se **deriva del schema** en vez de escribirse
 * a mano: la próxima columna de `sales` entra sola en vez de desactualizar el test en silencio.
 *
 * Y hay una columna que Drizzle **no** puede nombrar: `margin_usd` es `generatedAlwaysAs`. Eso es
 * lo que hace que D2 de la spec de S7 ("el costo no entra por el formulario") se sostenga por
 * construcción y no por disciplina — escribir el costo es escribir el margen, así que el margen
 * lo deriva Postgres y el `insert` ni lo menciona.
 *
 * ## El detalle que hace que las negativas valgan algo
 * `42501` tapa dos cosas distintas (`test-session.ts` lo documenta) y acá el **mensaje es la
 * aserción**, no un detalle de formato:
 *   · `permission denied for table sales`           → faltó el GRANT (capa 1). Es lo que tiene que
 *                                                     recibir `anon`: para la vidriera esta tabla
 *                                                     no existe.
 *   · `new row violates row-level security policy`  → el GRANT estaba y la **policy** rechazó la
 *                                                     fila (capa 2). Es lo que tiene que recibir
 *                                                     el panel que intenta escribir en otro tenant.
 * Si el cruzado dijera `permission denied for table`, el test estaría verde por el motivo
 * equivocado: significaría que el panel no puede insertar NADA y que la venta está rota.
 *
 * ## Lo que este archivo NO es
 * **No es la auditoría de referencia de RLS cruzado de `sales`.** Esa es de `qa-agent` y vive en
 * `tests/rls-cross-tenant.test.ts` (CLAUDE.md §4: el que escribe las policies no puede ser también
 * el dueño del test que las audita). El grupo `e` de acá es **red de regresión del paquete**:
 * ningún gate lo cita como evidencia, y si diverge del de `tests/`, gana el de `tests/` y el que se
 * corrige es éste.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { getTableColumns } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { claimsFor, openAdmin, openSession, openStorefrontSession, type Session } from './test-session';
import { sales } from './schema/commerce';
import { databaseUrl } from './env';

// Bloque de uuids propio (grupo `9003`): no pisa `rls.test.ts` (9000), `rls-anon-wa-click` (9001)
// ni `reservations-sweep-attempts` (9002).
const TENANT_A = '00000000-0000-4000-9003-000000000001';
const TENANT_B = '00000000-0000-4000-9003-000000000002';
const SLUG_A = 'venta-a';
const SLUG_B = 'venta-b';
const USER_A = '00000000-0000-4000-9003-0000000000a2';
const USER_B = '00000000-0000-4000-9003-0000000000b2';

const LISTING_A1 = '00000000-0000-4000-9003-00000000000a';
const LISTING_A2 = '00000000-0000-4000-9003-00000000000b';
const LISTING_B1 = '00000000-0000-4000-9003-00000000000c';

/** Venta preexistente de B: es la fila que A no tiene que ver, ni contar, ni pisar. */
const VENTA_B1 = '00000000-0000-4000-9003-0000000000d1';
/** Las que crea el test con la sentencia de Drizzle. */
const VENTA_NUEVA = '00000000-0000-4000-9003-0000000000d2';
const VENTA_REPETIDA = '00000000-0000-4000-9003-0000000000d3';
const VENTA_CRUZADA = '00000000-0000-4000-9003-0000000000d4';
const VENTA_DE_B_SOBRE_SU_UNIDAD = '00000000-0000-4000-9003-0000000000d5';

const admin = openAdmin();
let panelA: Session;
let panelB: Session;
let vidrieraA: Session;

async function adminRows<T>(text: string): Promise<T[]> {
  return (await admin.unsafe(text)) as unknown as T[];
}

function listingInsert(id: string, tenant: string, slug: string): string {
  return `insert into listings (id, tenant_id, slug, title, condition, price_usd, cost_usd, status)
          values ('${id}', '${tenant}', '${slug}', 'iPhone 14 Pro', 'used_excellent', 620.00, 500.00, 'available')`;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  LA FORMA DEL CALLER, CONSTRUIDA POR EL CALLER
// ══════════════════════════════════════════════════════════════════════════════════════════════
//
// `toSQL()` no conecta: postgres.js abre el socket recién en la primera query y acá no hay
// ninguna. La sentencia la ejecuta la sesión del test, que es la que tiene el rol y el claim; un
// cliente de Drizzle con la URL real la correría como el usuario de la conexión —que en local es
// SUPERUSUARIO— y no probaría nada. El handle se cierra igual en `afterAll`.
const emisorSql = postgres(databaseUrl(), { max: 1, prepare: false, onnotice: () => {} });
const emisor = drizzle(emisorSql);

interface VentaDelPanel {
  readonly id: string;
  readonly tenantId: string;
  readonly listingId: string;
}

/**
 * La sentencia exacta que va a emitir el panel al registrar una venta. `costUsd` va porque D2 lo
 * copia de `listings` DENTRO de la transacción; `marginUsd` no puede ir ni queriendo (es generada).
 */
function ventaComoElPanel(v: VentaDelPanel): { sql: string; params: readonly unknown[] } {
  const query = emisor.insert(sales).values({
    id: v.id,
    tenantId: v.tenantId,
    listingId: v.listingId,
    priceUsd: 62_000,
    costUsd: 50_000,
    paymentMethod: 'Efectivo USD',
  });
  const { sql, params } = query.toSQL();
  return { sql, params };
}

/** Las columnas de `sales` **derivadas del schema**, en el orden en que Drizzle las emite. */
function columnasDelSchema(): string[] {
  return Object.values(getTableColumns(sales)).map((c) => c.name);
}

/** La lista de columnas que la sentencia nombra de verdad, parseada de su propio texto. */
function columnasNombradas(sql: string): string[] {
  const lista = /insert into "sales" \(([^)]*)\)/i.exec(sql);
  return (lista?.[1] ?? '').split(',').map((c) => c.trim().replace(/"/g, ''));
}

beforeAll(async () => {
  await admin.unsafe(`delete from tenants where id in ('${TENANT_A}', '${TENANT_B}')`);
  await admin.unsafe(`
    insert into auth.users (id, email) values
      ('${USER_A}', 'a@ventatest.local'), ('${USER_B}', 'b@ventatest.local')
    on conflict (id) do nothing`);
  await admin.unsafe(`
    insert into tenants (id, slug, name, wa_phone, status) values
      ('${TENANT_A}', '${SLUG_A}', 'Venta A', '5492990000041', 'active'),
      ('${TENANT_B}', '${SLUG_B}', 'Venta B', '5492990000042', 'active')`);
  await admin.unsafe(`
    insert into memberships (tenant_id, user_id, role) values
      ('${TENANT_A}', '${USER_A}', 'owner'), ('${TENANT_B}', '${USER_B}', 'owner')`);

  await admin.unsafe(listingInsert(LISTING_A1, TENANT_A, 'venta-a-1'));
  await admin.unsafe(listingInsert(LISTING_A2, TENANT_A, 'venta-a-2'));
  await admin.unsafe(listingInsert(LISTING_B1, TENANT_B, 'venta-b-1'));

  await admin.unsafe(`
    insert into sales (id, tenant_id, listing_id, price_usd, cost_usd, internal_notes)
    values ('${VENTA_B1}', '${TENANT_B}', '${LISTING_B1}', 700.00, 400.00, 'notas de B')`);

  panelA = openSession(claimsFor(USER_A, TENANT_A));
  panelB = openSession(claimsFor(USER_B, TENANT_B));
  vidrieraA = openStorefrontSession(SLUG_A);
});

afterAll(async () => {
  await panelA?.close();
  await panelB?.close();
  await vidrieraA?.close();
  await emisorSql.end({ timeout: 5 });
  // `sales.listing_id` es ON DELETE RESTRICT: las ventas se borran antes que los listings, y el
  // cascade de `tenants` no alcanza para ordenarlo solo.
  await admin.unsafe(`delete from sales where tenant_id in ('${TENANT_A}', '${TENANT_B}')`);
  await admin.unsafe(`delete from tenants where id in ('${TENANT_A}', '${TENANT_B}')`);
  await admin.end({ timeout: 5 });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('a · la sentencia que emite el panel', () => {
  it('nombra TODAS las columnas de `sales` salvo la generada, y la lista se deriva del schema', () => {
    const { sql } = ventaComoElPanel({ id: VENTA_NUEVA, tenantId: TENANT_A, listingId: LISTING_A1 });
    const nombradas = columnasNombradas(sql);
    const esperadas = columnasDelSchema().filter((c) => c !== 'margin_usd');

    expect(nombradas).toEqual(esperadas);
    // Es la mitad que importa: si `margin_usd` apareciera, el margen sería un valor que alguien
    // manda en vez de uno que Postgres deriva — y escribir el costo es escribir el margen (D2).
    expect(nombradas).not.toContain('margin_usd');
    // Y esto es lo que obliga a que el `GRANT INSERT` de `authenticated` sea de TABLA: la
    // sentencia nombra columnas que el caller nunca eligió.
    expect(nombradas).toContain('internal_notes');
    expect(nombradas).toContain('sold_by');
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('b · D8: la segunda venta de la misma unidad la frena el motor', () => {
  it('la primera venta entra con la sentencia real del panel', async () => {
    const { sql, params } = ventaComoElPanel({ id: VENTA_NUEVA, tenantId: TENANT_A, listingId: LISTING_A1 });
    expect(await panelA.affected(sql, params)).toBe(1);
  });

  it('la segunda venta de esa MISMA unidad da 23505 y nombra al índice de D8', async () => {
    const { sql, params } = ventaComoElPanel({ id: VENTA_REPETIDA, tenantId: TENANT_A, listingId: LISTING_A1 });
    const { code, message } = await panelA.expectFailure(sql, params);
    expect(code).toBe('23505');
    expect(message).toContain('sales_one_sale_per_listing');
  });

  it('y no dejó fila: la unidad sigue teniendo exactamente UNA venta', async () => {
    const r = await adminRows<{ n: string }>(`select count(*) as n from sales where listing_id = '${LISTING_A1}'`);
    expect(Number(r[0]?.n)).toBe(1);
  });

  it('otra unidad del mismo tenant sí puede venderse: el índice ata la UNIDAD, no el tenant', async () => {
    const { sql, params } = ventaComoElPanel({ id: VENTA_CRUZADA, tenantId: TENANT_A, listingId: LISTING_A2 });
    expect(await panelA.affected(sql, params)).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('c · las dos capas sobre `sales`, y cada 42501 en la suya', () => {
  it('capa 2 · una venta con el `tenant_id` de OTRO tenant la rechaza la POLICY, no el GRANT', async () => {
    const { sql, params } = ventaComoElPanel({
      id: '00000000-0000-4000-9003-0000000000d9',
      tenantId: TENANT_B,
      listingId: LISTING_B1,
    });
    const { code, message } = await panelA.expectFailure(sql, params);
    expect(code).toBe('42501');
    // Si dijera `permission denied for table`, el verde sería por el motivo equivocado: querría
    // decir que el panel no puede insertar NADA y que la venta está rota de entrada.
    expect(message).toContain('row-level security');
    expect(message).not.toContain('permission denied for table');
  });

  it('capa 1 · para la vidriera esta tabla no existe: ni una fila, ni el costo', async () => {
    const lectura = await vidrieraA.expectFailure('select 1 from sales');
    expect(lectura.code).toBe('42501');
    expect(lectura.message).toContain('permission denied');

    const costo = await vidrieraA.expectFailure('select cost_usd from sales');
    expect(costo.code).toBe('42501');
  });

  it('el panel sí lee lo suyo: sin esto, todas las negativas serían verdes por haber apagado todo', async () => {
    const filas = await panelA.query<{ id: string }>(`select id from sales order by id`);
    expect(filas.map((f) => f.id).sort()).toEqual([VENTA_NUEVA, VENTA_CRUZADA].sort());
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('d · lo que dice el catálogo de Postgres', () => {
  it('el índice de D8 es ÚNICO y sobre (tenant_id, listing_id) en ese orden', async () => {
    const r = await adminRows<{ def: string }>(
      `select pg_get_indexdef(indexrelid) as def from pg_index
        where indexrelid = to_regclass('public.sales_one_sale_per_listing')`,
    );
    expect(r[0]?.def).toMatch(/CREATE UNIQUE INDEX/i);
    expect(r[0]?.def).toMatch(/\(tenant_id, listing_id\)/i);
  });

  it('reemplazó a `sales_tenant_listing_idx`: no conviven, y el de `tenant_id` sigue', async () => {
    const r = await adminRows<{ viejo: string | null; tenant: string | null }>(
      `select to_regclass('public.sales_tenant_listing_idx')::text as viejo,
              to_regclass('public.sales_tenant_idx')::text as tenant`,
    );
    // Dos índices con las mismas columnas en el mismo orden son dos escrituras para servir un
    // solo árbol de lectura: el único cubre todo plan que cubría el común.
    expect(r[0]?.viejo).toBeNull();
    // Y el índice de `tenant_id` es obligatorio en toda tabla de negocio (CLAUDE.md §7): si el
    // DROP se lo hubiera llevado, esto lo dice.
    expect(r[0]?.tenant).toBe('sales_tenant_idx');
  });

  it('`margin_usd` la deriva Postgres, y vale `price_usd - cost_usd`', async () => {
    const gen = await adminRows<{ g: string }>(
      `select attgenerated as g from pg_attribute
        where attrelid = 'public.sales'::regclass and attname = 'margin_usd'`,
    );
    expect(gen[0]?.g).toBe('s');

    const fila = await adminRows<{ margin_usd: string }>(
      `select margin_usd from sales where id = '${VENTA_NUEVA}'`,
    );
    // 620.00 cobrados − 500.00 de costo congelado.
    expect(fila[0]?.margin_usd).toBe('120.00');
  });

  it('RLS habilitada Y forzada: sin FORCE, el dueño de la tabla se saltea las policies', async () => {
    const r = await adminRows<{ enabled: boolean; forced: boolean }>(
      `select relrowsecurity as enabled, relforcerowsecurity as forced
         from pg_class where oid = 'public.sales'::regclass`,
    );
    expect(r[0]?.enabled).toBe(true);
    expect(r[0]?.forced).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  RED DE REGRESIÓN DEL PAQUETE — NO es la auditoría de referencia (esa es de `qa-agent`).
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('e · el tenant A no ve, no cuenta y no pisa las ventas de B', () => {
  it('no las ve ni las CUENTA: un `count(*)` no es una lectura menos peligrosa', async () => {
    const ajenas = await panelA.query<{ n: string }>(
      `select count(*) as n from sales where tenant_id = '${TENANT_B}'`,
    );
    expect(Number(ajenas[0]?.n)).toBe(0);

    const puntual = await panelA.query<{ n: string }>(`select count(*) as n from sales where id = '${VENTA_B1}'`);
    expect(Number(puntual[0]?.n)).toBe(0);

    // El agregado también: un `sum(cost_usd)` que incluyera a B filtraría el costo de B por resta.
    const suma = await panelA.query<{ s: string }>(`select coalesce(sum(cost_usd), 0) as s from sales`);
    expect(Number(suma[0]?.s)).toBe(500 + 500);
  });

  it('no las borra ni las actualiza: `affected` es 0, no un error', async () => {
    expect(await panelA.affected(`delete from sales where id = '${VENTA_B1}'`)).toBe(0);
    expect(await panelA.affected(`update sales set price_usd = 1 where id = '${VENTA_B1}'`)).toBe(0);
    const sigue = await adminRows<{ price_usd: string }>(`select price_usd from sales where id = '${VENTA_B1}'`);
    expect(sigue[0]?.price_usd).toBe('700.00');
  });

  it('la unicidad es POR TENANT: el índice de D8 no es un oráculo cruzado', async () => {
    // B vende su propia unidad. Si la clave del índice fuera `(listing_id)` a secas, un `23505`
    // acá le revelaría a un tenant que la unidad de otro ya está vendida sin leer una fila —el
    // error del motor se evalúa antes que cualquier policy de lectura—. Con el tenant adentro de
    // la clave, cada uno choca sólo contra lo suyo.
    const { sql, params } = ventaComoElPanel({
      id: VENTA_DE_B_SOBRE_SU_UNIDAD,
      tenantId: TENANT_B,
      listingId: LISTING_B1,
    });
    const { code } = await panelB.expectFailure(sql, params);
    // B ya tenía una venta de esa unidad (`VENTA_B1`), así que choca contra la SUYA.
    expect(code).toBe('23505');
  });
});
