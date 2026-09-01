/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  `listings.acquisition_channel` — LA PROCEDENCIA DEJA DE DEDUCIRSE DE DOS RASTROS (S9)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * La pidió `app-agent` por escrito en el §6 de `apps/web/app/(app)/_lib/tradein/accept-to-stock.ts`.
 * Hasta S8, para saber que una unidad venía de un canje había que juntar DOS cosas y ninguna era
 * declarativa: el vínculo duro (`tradein_leads.created_listing_id`, o sea un `join` a la tabla de
 * leads, que además trae PII al alcance de la mano) y la bitácora
 * (`listing_events.metadata ->> 'source' = 'tradein'`, o sea un `jsonb` sin forma garantizada).
 * Dos rastros no son un canal.
 *
 * ## Lo que este archivo mide, en orden de lo que puede salir mal
 * 1. **Que el panel siga pudiendo dar de alta una unidad.** Es el riesgo real de agregar una
 *    columna `not null`: Drizzle **nombra todas las columnas** en `insert().values()`, y Postgres
 *    exige el privilegio sobre cada columna nombrada aunque el valor sea `DEFAULT`. Una columna
 *    nueva sin privilegio de INSERT para `authenticated` no dice "no la elijas": dice "no insertes
 *    nada". Es la lección que S6 pagó rompiendo el alta de reservas, y por eso la sentencia de acá
 *    se construye con el query builder y no a mano.
 * 2. **Que NO se haya filtrado a la vidriera.** `0002` le da a `anon` un GRANT **de columna** sobre
 *    `listings`, y un GRANT de columna no alcanza a las columnas futuras — o sea que esto tiene que
 *    ser cierto sin que 0009 haya hecho nada. Justamente por eso se verifica: lo que se da por
 *    obvio es lo que nadie mira, y esta columna dice de dónde sacó el dueño cada equipo.
 * 3. **Que el backfill haya corrido.** Sin él, toda unidad nacida de un canje antes de S9 diría
 *    `purchase`, o sea que la columna nueva mentiría sobre exactamente los casos por los que se
 *    pidió.
 *
 * ## Lo que este archivo NO es
 * No es la auditoría de referencia de RLS de `listings`: esa es de `qa-agent` y vive en
 * `tests/rls-cross-tenant.test.ts` (`CLAUDE.md` §4). Ningún gate cita este archivo como evidencia.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { getTableColumns } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { claimsFor, openAdmin, openSession, openStorefrontSession, type Session } from './test-session';
import { listings } from './schema/listings';
import { databaseUrl } from './env';

// Bloque de uuids propio (grupo `9006`): no pisa `rls.test.ts` (9000), `rls-anon-wa-click` (9001),
// `reservations-sweep-attempts` (9002), `sales-one-sale-per-listing` (9003),
// `rls-anon-tradein-lead` (9004) ni `tradein-accepted-has-listing` (9005).
const TENANT = '00000000-0000-4000-9006-000000000001';
const USER = '00000000-0000-4000-9006-000000000011';
const SLUG = 'canal-a';

const admin = openAdmin();
let panel: Session;
let vidriera: Session;

// El emisor no conecta: `toSQL()` no abre socket. La sentencia la corre la sesión del test, que es
// la que tiene el rol y el claim; un cliente de Drizzle con la URL real la correría como el usuario
// de la conexión —que en local es SUPERUSUARIO— y no probaría ni el GRANT ni la policy.
const emisorSql = postgres(databaseUrl(), { max: 1, prepare: false, onnotice: () => {} });
const emisor = drizzle(emisorSql);

async function adminRows<T>(text: string): Promise<T[]> {
  return (await admin.unsafe(text)) as unknown as T[];
}

/** El alta de unidad tal como la emite el panel: query builder, no SQL a mano. */
function altaComoElPanel(id: string, slug: string, extra: Record<string, unknown> = {}) {
  const query = emisor.insert(listings).values({
    id,
    tenantId: TENANT,
    slug,
    title: 'iPhone 14 Pro 256 Grafito',
    condition: 'used_excellent',
    priceUsd: 62_000,
    ...extra,
  });
  return query.toSQL();
}

beforeAll(async () => {
  await admin.unsafe(`delete from tenants where id = '${TENANT}'`);
  await admin.unsafe(`
    insert into auth.users (id, email) values ('${USER}', 'duenio@canal.local')
    on conflict (id) do nothing`);
  await admin.unsafe(`
    insert into tenants (id, slug, name, wa_phone, status, accepts_trade_in)
    values ('${TENANT}', '${SLUG}', 'Canal', '5492990000061', 'active', true)`);
  await admin.unsafe(`
    insert into memberships (tenant_id, user_id, role)
    values ('${TENANT}', '${USER}', 'owner')`);

  panel = openSession(claimsFor(USER, TENANT));
  vidriera = openStorefrontSession(SLUG);
});

afterAll(async () => {
  await panel?.close();
  await vidriera?.close();
  await emisorSql.end({ timeout: 5 });
  await admin.unsafe(`delete from tenants where id = '${TENANT}'`);
  await admin.unsafe(`delete from auth.users where id = '${USER}'`);
  await admin.end({ timeout: 5 });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('a · la columna existe con la forma que se decidió, leída de la BASE', () => {
  it('es `not null` con default `purchase` y del tipo enum, no `text`', async () => {
    // `text` con un CHECK sería casi lo mismo salvo en lo que importa: un enum se puede ordenar,
    // se puede agrupar sin normalizar y no acepta `'Trade_In'` con mayúscula un martes.
    const r = await adminRows<{ tipo: string; udt: string; nulo: string; def: string | null }>(`
      select data_type as tipo, udt_name as udt, is_nullable as nulo, column_default as def
      from information_schema.columns
      where table_schema = 'public' and table_name = 'listings' and column_name = 'acquisition_channel'`);
    expect(r).toHaveLength(1);
    expect(r[0]?.tipo).toBe('USER-DEFINED');
    expect(r[0]?.udt).toBe('acquisition_channel');
    expect(r[0]?.nulo).toBe('NO');
    expect(r[0]?.def ?? '').toContain(`'purchase'`);
  });

  it('el enum tiene exactamente tres valores, en su orden declarado', async () => {
    // Tres a propósito: `consignment` / `import` / `warranty_swap` son vocabulario que el producto
    // todavía no tiene, y un valor de enum no se borra, se hereda. El cuarto es una migración de
    // una línea el día que exista el flujo; sacar uno publicado no lo es.
    const r = await adminRows<{ v: string }>(`
      select e.enumlabel as v from pg_enum e join pg_type t on t.oid = e.enumtypid
      where t.typname = 'acquisition_channel' order by e.enumsortorder`);
    expect(r.map((x) => x.v)).toEqual(['purchase', 'trade_in', 'other']);
  });

  it('lleva el porqué escrito en la propia base, no sólo en el .sql', async () => {
    const r = await adminRows<{ c: string | null }>(`
      select col_description('public.listings'::regclass, a.attnum) as c
      from pg_attribute a
      where a.attrelid = 'public.listings'::regclass and a.attname = 'acquisition_channel'`);
    const comentario = r[0]?.c ?? '';
    expect(comentario).toContain('provenance_text');
    expect(comentario).toContain('anon');
  });

  it('NO lleva índice propio, y el número está acá para que la decisión se pueda revisar', async () => {
    // Medido antes de decidir, con 4000 unidades y 200 por tenant (el techo del ICP de
    // `PRODUCT.md`): sin índice dedicado, 0.122 ms y 75 buffers por `listings_tenant_model_idx` +
    // filtro; con `(tenant_id, acquisition_channel, created_at)`, 0.055 ms y 22 buffers, 48 kB.
    // Se ahorran 0.067 ms en una consulta de panel que corre unas pocas veces por día, y se paga
    // una sexta escritura de índice en CADA alta y CADA edición de la tabla más caliente del
    // producto. El día que un tenant tenga 20.000 unidades esto se vuelve a medir.
    const r = await adminRows<{ i: string }>(`
      select indexname as i from pg_indexes
      where schemaname = 'public' and tablename = 'listings' and indexdef ilike '%acquisition_channel%'`);
    expect(r.map((x) => x.i)).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('b · el panel sigue pudiendo dar de alta una unidad (el riesgo real de la columna)', () => {
  const COMPRA = '00000000-0000-4000-9006-00000000000a';
  const CANJE = '00000000-0000-4000-9006-00000000000b';

  it('la sentencia que emite Drizzle NOMBRA la columna nueva, aunque nadie se la pase', async () => {
    // Si no la nombrara, el test de abajo estaría verde sin probar el privilegio, y el alta
    // rompería en producción la primera vez que alguien sí la nombre.
    const { sql } = altaComoElPanel(COMPRA, 'compra-1');
    expect(sql).toContain('"acquisition_channel"');
    // Y la lista se deriva del schema, no se escribe a mano: la próxima columna de `listings` entra
    // sola en vez de desactualizar el test en silencio.
    const nombradas = (/insert into "listings" \(([^)]*)\)/i.exec(sql)?.[1] ?? '')
      .split(',')
      .map((c) => c.trim().replace(/"/g, ''));
    const delSchema = Object.values(getTableColumns(listings))
      .map((c) => c.name)
      // `margin_usd` es `generatedAlwaysAs`: Drizzle no puede nombrarla ni queriendo.
      .filter((n) => n !== 'margin_usd');
    expect(nombradas.sort()).toEqual(delSchema.sort());
  });

  it('el alta ENTRA y la unidad queda en `purchase` sin que el formulario elija nada', async () => {
    // Cargar una unidad a mano en el panel **es** haberla comprado. Ése es el default y por eso la
    // columna no es anulable: un `null` en casi todas las filas obligaría a un `coalesce` en cada
    // consulta, o sea reintroduciría la suposición que la columna vino a hacer explícita.
    const { sql, params } = altaComoElPanel(COMPRA, 'compra-1');
    expect(await panel.affected(sql, params)).toBe(1);
    const r = await adminRows<{ c: string }>(
      `select acquisition_channel as c from listings where id = '${COMPRA}'`,
    );
    expect(r[0]?.c).toBe('purchase');
  });

  it('`accept-to-stock` puede escribir `trade_in` explícito', async () => {
    const { sql, params } = altaComoElPanel(CANJE, 'canje-1', { acquisitionChannel: 'trade_in' });
    expect(await panel.affected(sql, params)).toBe(1);
    const r = await adminRows<{ c: string }>(
      `select acquisition_channel as c from listings where id = '${CANJE}'`,
    );
    expect(r[0]?.c).toBe('trade_in');
  });

  it('el dueño puede corregirla después: no es una columna de sólo-escritura', async () => {
    expect(
      await panel.affected(
        `update listings set acquisition_channel = 'other'
          where tenant_id = '${TENANT}' and id = '${COMPRA}'`,
      ),
    ).toBe(1);
    expect(
      await panel.affected(
        `update listings set acquisition_channel = 'purchase'
          where tenant_id = '${TENANT}' and id = '${COMPRA}'`,
      ),
    ).toBe(1);
  });

  it('un valor inventado rebota con 22P02: es un enum, no texto libre', async () => {
    const fallo = await panel.expectFailure(
      `update listings set acquisition_channel = 'robado'
        where tenant_id = '${TENANT}' and id = '${COMPRA}'`,
    );
    expect(fallo.code).toBe('22P02');
  });

  it('el panel la LEE, que es para lo que se pidió', async () => {
    const r = await panel.query<{ c: string; n: string }>(`
      select acquisition_channel as c, count(*)::text as n from listings
      where tenant_id = '${TENANT}' group by 1 order by 1`);
    expect(r).toEqual([
      { c: 'purchase', n: '1' },
      { c: 'trade_in', n: '1' },
    ]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('c · la vidriera NO la ve: el read model público no creció solo', () => {
  it('`anon` no tiene privilegio de SELECT sobre la columna', async () => {
    const r = await adminRows<{ ve: boolean }>(
      `select has_column_privilege('anon', 'public.listings', 'acquisition_channel', 'SELECT') as ve`,
    );
    expect(r[0]?.ve).toBe(false);
  });

  it('pedirla desde la vidriera es `permission denied`, no una columna vacía', async () => {
    // Publicar de dónde sacó el dueño cada equipo es una decisión de producto, no un efecto
    // colateral de agregar una columna. Hoy la decisión es que no.
    const fallo = await vidriera.expectFailure(`select acquisition_channel from listings limit 1`);
    expect(fallo.code).toBe('42501');
    expect(fallo.message).toMatch(/permission denied/i);
  });

  it('ni por `select *`, que es la forma en que una columna nueva se filtra sin que nadie lo note', async () => {
    const fallo = await vidriera.expectFailure(`select * from listings limit 1`);
    expect(fallo.code).toBe('42501');
    expect(fallo.message).toMatch(/permission denied/i);
  });

  it('y la vidriera sigue leyendo lo suyo: no se rompió el read model al agregar la columna', async () => {
    // El control positivo. Sin esto, los tres rechazos de arriba también estarían verdes en el
    // mundo donde `anon` perdió el acceso a `listings` entero y la vidriera está muerta.
    await admin.unsafe(`
      update listings set status = 'available', published_at = now()
      where tenant_id = '${TENANT}' and slug = 'compra-1'`);
    const r = await vidriera.query<{ slug: string }>(
      `select slug from listings where tenant_id = '${TENANT}'`,
    );
    expect(r.map((x) => x.slug)).toEqual(['compra-1']);
  });

  it('el GRANT de `anon` sobre `listings` sigue siendo por COLUMNA y no por tabla', async () => {
    // Es lo único que hace que la columna nueva nazca invisible por construcción: un GRANT de
    // tabla alcanzaría a toda columna futura, y este test estaría midiendo suerte.
    const r = await adminRows<{ p: string }>(`
      select p from unnest(array['SELECT','INSERT','UPDATE','DELETE']) as p
      where has_table_privilege('anon', 'public.listings', p)`);
    expect(r.map((x) => x.p)).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('d · el backfill: las unidades que YA venían de un canje no quedaron en el default', () => {
  it('ninguna unidad enlazada desde un `tradein_lead` dice `purchase`', async () => {
    // Se mide sobre la base ENTERA, no sobre el tenant del fixture: lo que puede fallar acá es que
    // la migración se haya aplicado sin su `UPDATE`, y eso se ve en las filas viejas.
    const r = await adminRows<{ n: string }>(`
      select count(*)::text as n
      from tradein_leads t join listings l
        on l.id = t.created_listing_id and l.tenant_id = t.tenant_id
      where l.acquisition_channel <> 'trade_in'`);
    expect(r[0]?.n).toBe('0');
  });

  it('la FK compuesta rechaza un `created_listing_id` de otro tenant', async () => {
    // Antes 0010 el vínculo sólo era por `id` y un cruce era representable. Ahora la base lo
    // rechaza en el INSERT, antes de que un backfill pueda arrastrar una unidad ajena.
    const otro = '00000000-0000-4000-9006-000000000002';
    const cruzado = '00000000-0000-4000-9006-00000000000c';
    const lead = '00000000-0000-4000-9006-00000000000d';
    try {
      await admin.unsafe(`
        insert into tenants (id, slug, name, wa_phone, status, accepts_trade_in)
        values ('${otro}', 'canal-b', 'Canal B', '5492990000062', 'active', true)`);
      await admin.unsafe(`
        insert into listings (id, tenant_id, slug, title, condition, price_usd)
        values ('${cruzado}', '${otro}', 'ajena-1', 'iPhone ajeno', 'used_excellent', 500.00)`);
      // El lead vive en el tenant del fixture y apunta a la unidad del OTRO: 23503 es la FK,
      // no una policy ni un unique global que exponga información.
      let code = '';
      try {
        await admin.unsafe(`
          insert into tradein_leads (id, tenant_id, customer_name, customer_wa_phone, model_text, created_listing_id)
          values ('${lead}', '${TENANT}', 'Cruzado', '5492995551234', 'iPhone 11', '${cruzado}')`);
      } catch (error) {
        code = (error as { code?: string }).code ?? '';
      }
      expect(code).toBe('23503');
    } finally {
      await admin.unsafe(`delete from tradein_leads where id = '${lead}'`);
      await admin.unsafe(`delete from tenants where id = '${otro}'`);
    }
  });
});
