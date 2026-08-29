/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  S9 · Q4 y Q5 · LA LISTA QUE EL DUEÑO PEGA EN UN ESTADO NO PUEDE LINKEAR UNA FICHA MUERTA.
 *  Postgres real, dos tenants, la query del panel y la sesión de la vidriera. Owner: `qa-agent`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## Qué se está afirmando
 * El texto de `/app/lista` termina pegado en un estado de Instagram. Cada renglón lleva un link
 * absoluto a `{slug}.maat.work/p/{unidad}`. Entonces la regla no es "la query filtra bien": es
 * **el conjunto de unidades que el dueño publica es un subconjunto del que el visitante anónimo
 * puede abrir**. Un link de más no es un bug de listado, es un 404 que el dueño le sirvió a sus
 * propios clientes, con su nombre arriba.
 *
 * ## Por qué acá y no en `packages/*` ni en un unit test del panel
 * Cruza tres cosas que ningún paquete tiene juntas (`CLAUDE.md` §4): la query del panel
 * (`listPublishedUnitsForStockList`, `apps/web/app/(app)/_lib/stock-list/queries.ts`), la sesión
 * anónima de la vidriera (`withStorefrontDb`, `apps/web/app/(storefront)/_lib/storefront-db.ts`)
 * y la policy `listings_storefront_anon_select` de `drizzle/0002_storefront_anon_grants.sql`. Las
 * tres pueden estar verdes por separado y aun así discrepar: lo que se mide acá es la
 * **intersección**, que no vive en ningún archivo.
 *
 * ## Las dos mitades se MIDEN, ninguna se afirma leyendo el código
 * Para cada unidad, el test pregunta las dos cosas contra la base:
 *   1. ¿la trae la query del panel? (o sea: ¿va a salir con link en el texto?)
 *   2. ¿la ve `anon` con el claim `storefront_slug` del tenant? (o sea: ¿ese link abre?)
 * y exige que las dos respuestas sean la misma. Un test que sólo mirara (1) estaría afirmando el
 * `where` que ya se puede leer en el archivo; el que hace falta es el que **compara**.
 *
 * ## La unidad `available` SIN `published_at`, y por qué hay que plantarla a mano
 * `published_at is not null` es el segundo predicado de la query y el segundo de la policy. Hoy
 * el trigger `listings_stamp_published_at` (migración 0002) sella cualquier fila que entre o pase
 * a estado público, así que **por el camino normal ese caso no se puede producir**: sacar el
 * `isNotNull(publishedAt)` de la query dejaría este archivo verde y el defecto vivo. Un test que
 * no puede fallar no prueba nada (`CLAUDE.md` §Reglas duras 1).
 *
 * Por eso la fila se planta con `set local session_replication_role = replica`, que apaga los
 * triggers **de esa transacción y de ninguna otra** — es el control negativo de siempre, el mismo
 * patrón con el que `rls-cross-tenant.test.ts` planta sus seis ataques en `qa_rls_control` antes
 * de afirmar nada sobre `public`. No es un caso inventado: es exactamente lo que queda en la tabla
 * después de un backfill, una restauración parcial o una réplica lógica, o el día que alguien
 * toque el trigger. La única defensa que queda ahí es el predicado de la query, y esto es lo que
 * lo mantiene parado.
 *
 * `sin-sello` es además la única fila del fixture cuyo **estado** dice "publicada": es la que
 * demuestra que mirar `status` no alcanza.
 *
 * ## Q5 · el techo de 100 no se toma en silencio
 * `STOCK_LIST_MAX_UNITS` corta la lista, y la query hace un `count()` aparte para saber cuántas
 * quedaron afuera. Ese número es lo único que le puede decir al dueño que lo que está por pegar
 * **no es todo su stock**. Acá se mide la mitad de datos (la pantalla la mide el e2e hermano,
 * `e2e/s9-la-lista-avisa-cuando-el-stock-no-entra-entero.spec.ts`) y en las dos polaridades:
 * con 101 publicadas tiene que decir 101, y con 100 exactas **no puede** anunciar un recorte que
 * no existe (`CLAUDE.md` §5: una alarma se prueba encendiéndola y callándola).
 *
 * `qa-agent` no edita el código bajo test para poner esto en verde (`CLAUDE.md` §4). Si sale rojo,
 * el defecto es del código hasta que se demuestre lo contrario.
 */

import postgres from 'postgres';
import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  STOCK_LIST_MAX_UNITS,
  listPublishedUnitsForStockList,
} from '../apps/web/app/(app)/_lib/stock-list/queries';
import type { TenantContext } from '../apps/web/app/(app)/_lib/db/session';
import { withStorefrontDb } from '../apps/web/app/(storefront)/_lib/storefront-db';

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/istock_dev';

/** El negocio bajo prueba. */
const TENANT_A = '00000000-0000-4000-9000-00000000a901';
const SLUG_A = 'qa-lista-a';
/** El negocio de al lado. Existe para que "no aparece" pueda fallar. */
const TENANT_B = '00000000-0000-4000-9000-00000000b901';
const SLUG_B = 'qa-lista-b';
/** El que tiene 101 unidades publicadas: toca el techo. */
const TENANT_C = '00000000-0000-4000-9000-00000000c901';
const SLUG_C = 'qa-lista-c';
/** El que tiene exactamente 100: NO toca el techo, y no puede decir que sí. */
const TENANT_D = '00000000-0000-4000-9000-00000000d901';
const SLUG_D = 'qa-lista-d';

const USER_A = '00000000-0000-4000-9000-00000000a902';

const TENANT_IDS = [TENANT_A, TENANT_B, TENANT_C, TENANT_D] as const;

/** El dueño de A, tal como lo arma `requireTenant()` antes de llamar a la query. */
const CTX_A: TenantContext = { userId: USER_A, tenantId: TENANT_A, role: 'owner' };

const admin: Sql = postgres(DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });

/**
 * Las unidades de A, y qué tiene que pasar con cada una. `enLaLista` es lo que afirma este
 * archivo; está al lado del estado a propósito, porque el par (estado, expectativa) **es** la
 * regla: los tres estados públicos entran, y nada más entra.
 */
interface Unidad {
  readonly slug: string;
  readonly title: string;
  readonly status: string;
  /** `false` → se planta sin `published_at`, con los triggers apagados. */
  readonly sellada: boolean;
  readonly enLaLista: boolean;
  /** Para qué está en el fixture. Sale en el mensaje de fallo. */
  readonly porque: string;
}

const UNIDADES_DE_A: readonly Unidad[] = [
  {
    slug: 'qa-disponible',
    title: 'iPhone 14 Pro 256 Grafito',
    status: 'available',
    sellada: true,
    enLaLista: true,
    porque: 'es el caso normal: publicada y comprable hoy',
  },
  {
    slug: 'qa-reservado',
    title: 'iPhone 13 128 Medianoche',
    status: 'reserved',
    sellada: true,
    enLaLista: true,
    porque: 'reservado es público: la vidriera lo muestra con badge y la lista lo marca RESERVADO',
  },
  {
    slug: 'qa-vendido',
    title: 'iPhone 12 64 Azul',
    status: 'sold',
    sellada: true,
    enLaLista: true,
    porque: 'vendido es prueba social y la vidriera lo sirve: recortarlo sería decidir por el dueño',
  },
  {
    slug: 'qa-borrador',
    title: 'iPhone 11 128 Blanco',
    status: 'draft',
    sellada: true,
    enLaLista: false,
    porque: 'un borrador no está en la vidriera: su link sería un "equipo no publicado"',
  },
  {
    slug: 'qa-fuera-de-vidriera',
    title: 'iPhone SE 2022 64 Negro',
    status: 'unavailable',
    sellada: true,
    enLaLista: false,
    porque: 'estado lateral: el dueño lo bajó de la vidriera y el texto no puede resucitarlo',
  },
  {
    slug: 'qa-sin-sello',
    title: 'iPhone 15 256 Titanio',
    status: 'available',
    sellada: false,
    enLaLista: false,
    porque:
      'available pero sin published_at: la policy de anon NO la muestra. Es el caso que el ' +
      'estado solo no atrapa y el único que sostiene el `isNotNull(publishedAt)` de la query',
  },
];

function unidad(slug: string): Unidad {
  const found = UNIDADES_DE_A.find((u) => u.slug === slug);
  if (found === undefined) throw new Error(`el fixture no tiene la unidad ${slug}`);
  return found;
}

async function seedTenant(id: string, slug: string): Promise<void> {
  await admin`
    insert into public.tenants (id, slug, name, wa_phone, plan, status)
    values (${id}::uuid, ${slug}, ${`Negocio ${slug}`}, '5492994123456', 'trial', 'active')
  `;
}

/** Una unidad sellada por el trigger, como la deja el panel. */
async function seedUnidad(tenantId: string, u: Unidad): Promise<void> {
  await admin`
    insert into public.listings (tenant_id, slug, kind, title, condition, price_usd, qty, status)
    values (${tenantId}::uuid, ${u.slug}, 'unit', ${u.title},
            'used_excellent'::listing_condition, 620, 1, ${u.status}::listing_status)
  `;
}

/**
 * La fila que el trigger no selló. `set local` muere con la transacción: ninguna otra escritura
 * de esta corrida —ni de la suite— pierde el trigger.
 */
async function seedUnidadSinSellar(tenantId: string, u: Unidad): Promise<void> {
  await admin.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`
      insert into public.listings (tenant_id, slug, kind, title, condition, price_usd, qty, status,
                                   published_at)
      values (${tenantId}::uuid, ${u.slug}, 'unit', ${u.title},
              'used_excellent'::listing_condition, 620, 1, ${u.status}::listing_status, null)
    `;
  });
}

/** `n` unidades publicadas y selladas, para los tenants que sólo existen para contar. */
async function seedMuchasUnidades(tenantId: string, n: number): Promise<void> {
  await admin`
    insert into public.listings (tenant_id, slug, kind, title, condition, price_usd, qty, status)
    select ${tenantId}::uuid, 'qa-masivo-' || i, 'unit', 'iPhone 12 64 Azul ' || i,
           'used_excellent'::listing_condition, 620, 1, 'available'
    from generate_series(1, ${n}) as i
  `;
}

/** Lo que `anon` ve de un tenant, con el mismo claim y el mismo rol que usa la vidriera. */
async function slugsQueVeElVisitante(slug: string): Promise<readonly string[]> {
  return withStorefrontDb(slug, async (tx) => {
    const rows = await tx.execute<{ slug: string }>(
      // SQL crudo y no el builder: lo que se está midiendo es la **policy**, y el `select` más
      // chico posible es el que no puede pasar por accidente. El filtro de tenant lo pone la
      // policy con el claim, que es justamente lo que está bajo prueba.
      // web-lint:sin-tenant es la lectura del visitante anonimo, acotada por la policy del claim storefront_slug
      'select slug from public.listings order by slug',
    );
    return rows.map((row) => row.slug);
  });
}

async function wipe(): Promise<void> {
  for (const id of TENANT_IDS) {
    await admin`delete from public.listings where tenant_id = ${id}::uuid`;
    await admin`delete from public.tenants where id = ${id}::uuid`;
  }
}

beforeAll(async () => {
  await wipe();

  await seedTenant(TENANT_A, SLUG_A);
  await seedTenant(TENANT_B, SLUG_B);
  await seedTenant(TENANT_C, SLUG_C);
  await seedTenant(TENANT_D, SLUG_D);

  for (const u of UNIDADES_DE_A) {
    if (u.sellada) await seedUnidad(TENANT_A, u);
    else await seedUnidadSinSellar(TENANT_A, u);
  }

  // El negocio de al lado, publicado y sano: si el filtro de tenant se cae, esto aparece en la
  // lista de A. Sin esta fila, "no trae nada ajeno" sería verde por vacío.
  await seedUnidad(TENANT_B, {
    slug: 'qa-del-vecino',
    title: 'iPhone 14 128 Azul del vecino',
    status: 'available',
    sellada: true,
    enLaLista: false,
    porque: 'es de otro negocio',
  });

  await seedMuchasUnidades(TENANT_C, STOCK_LIST_MAX_UNITS + 1);
  await seedMuchasUnidades(TENANT_D, STOCK_LIST_MAX_UNITS);
});

afterAll(async () => {
  await wipe();
  await admin.end({ timeout: 5 });
});

describe('Q4 · el fixture dice lo que dice: sin esto, todo lo de abajo es verde por vacío', () => {
  it('la unidad plantada sigue en estado público y sin published_at cuando se la va a medir', async () => {
    const rows = await admin<{ status: string; published_at: Date | null }[]>`
      select status, published_at from public.listings
      where tenant_id = ${TENANT_A}::uuid and slug = 'qa-sin-sello'
    `;

    expect(rows, 'la unidad sin sellar no quedó en la base: el fixture no montó el caso').toHaveLength(1);
    expect(
      rows[0]?.status,
      'la unidad plantada dejó de estar en un estado público: ya no es el caso que el estado solo ' +
        'no atrapa, y el test de abajo no probaría nada',
    ).toBe('available');
    expect(
      rows[0]?.published_at,
      'el trigger listings_stamp_published_at le puso published_at igual: el `set local ' +
        'session_replication_role = replica` del fixture dejó de apagarlo y este archivo ya no ' +
        'puede sostener el `isNotNull(publishedAt)` de la query',
    ).toBeNull();
  });
});

describe('Q4 · la lista para estados sólo linkea fichas que el visitante puede abrir', () => {
  it('cada unidad que sale con link en el texto es una que anon ve en la vidriera', async () => {
    const { rows } = await listPublishedUnitsForStockList(CTX_A);
    const enLaLista = rows.map((row) => row.slug).sort();
    const visiblesParaElVisitante = [...(await slugsQueVeElVisitante(SLUG_A))].sort();

    // El control positivo de todo el archivo: si la vidriera no viera NADA, "la lista ⊆ la
    // vidriera" se cumpliría con la lista vacía y este test sería un adorno.
    expect(
      visiblesParaElVisitante.length,
      'el visitante anónimo no ve una sola unidad de este negocio: la comparación de abajo sería ' +
        'verde por vacío. Mirá la policy listings_storefront_anon_select y el claim storefront_slug.',
    ).toBeGreaterThan(0);

    const muertos = enLaLista.filter((slug) => !visiblesParaElVisitante.includes(slug));
    expect(
      muertos,
      'la lista que el dueño pega en un estado linkea fichas que el visitante NO ve: cada una de ' +
        `estas URLs es un 404 servido por el dueño a sus propios clientes → ${muertos.join(', ')}`,
    ).toEqual([]);
  });

  it('una unidad disponible sin published_at no entra: el estado no alcanza para decidir', async () => {
    const { rows } = await listPublishedUnitsForStockList(CTX_A);
    const u = unidad('qa-sin-sello');

    expect(
      rows.map((row) => row.slug),
      `${u.slug}: ${u.porque}. La query la trajo igual, así que el texto lleva su link y ese link ` +
        'no abre.',
    ).not.toContain(u.slug);

    expect(
      await slugsQueVeElVisitante(SLUG_A),
      `${u.slug}: la policy de anon empezó a mostrar una unidad sin published_at. El invariante ` +
        'que sostiene esta exclusión se movió: revisá 0002_storefront_anon_grants.sql antes de ' +
        'tocar la query.',
    ).not.toContain(u.slug);
  });

  it('el borrador y el equipo bajado de la vidriera se quedan afuera del texto', async () => {
    const { rows } = await listPublishedUnitsForStockList(CTX_A);
    const enLaLista = rows.map((row) => row.slug);

    for (const u of UNIDADES_DE_A.filter((x) => !x.enLaLista)) {
      expect(enLaLista, `${u.slug}: ${u.porque}`).not.toContain(u.slug);
    }
  });

  it('los tres estados públicos salen en el texto, vendido incluido', async () => {
    const { rows } = await listPublishedUnitsForStockList(CTX_A);
    const enLaLista = rows.map((row) => row.slug);

    for (const u of UNIDADES_DE_A.filter((x) => x.enLaLista)) {
      expect(
        enLaLista,
        `${u.slug} desapareció del texto y ${u.porque}. Un equipo publicado que no sale en la ` +
          'lista es uno que el dueño cree haber publicado y nadie ve.',
      ).toContain(u.slug);
    }
  });

  it('el stock publicado del negocio de al lado nunca entra en mi lista', async () => {
    const { rows } = await listPublishedUnitsForStockList(CTX_A);

    expect(
      rows.map((row) => row.slug),
      'una unidad del tenant vecino salió en la lista de A: el dueño publicaría en su estado el ' +
        'stock de otro negocio, con su nombre arriba',
    ).not.toContain('qa-del-vecino');

    // La otra punta, porque "no la trajo" también sería cierto si el vecino no tuviera stock.
    expect(
      await slugsQueVeElVisitante(SLUG_B),
      'el vecino no tiene stock publicado: la aserción de arriba era verde por vacío',
    ).toContain('qa-del-vecino');
  });
});

describe('Q5 · el techo de la lista no se toma en silencio', () => {
  it('con más stock publicado que el techo, la query dice cuántos equipos hay en total', async () => {
    const ctxC: TenantContext = { userId: USER_A, tenantId: TENANT_C, role: 'owner' };
    const { rows, total } = await listPublishedUnitsForStockList(ctxC);

    expect(rows.length, 'la lista dejó de cortar en el techo').toBe(STOCK_LIST_MAX_UNITS);
    expect(
      total,
      'la query recortó a 100 y devolvió 100 como total: la pantalla no tiene con qué avisar que ' +
        'lo que el dueño está por pegar no es todo su stock',
    ).toBe(STOCK_LIST_MAX_UNITS + 1);
  });

  it('con el stock justo en el techo no se anuncia un recorte que no existe', async () => {
    const ctxD: TenantContext = { userId: USER_A, tenantId: TENANT_D, role: 'owner' };
    const { rows, total } = await listPublishedUnitsForStockList(ctxD);

    expect(rows.length, 'la lista perdió unidades antes del techo').toBe(STOCK_LIST_MAX_UNITS);
    expect(
      total,
      'con exactamente 100 publicadas el total tiene que ser 100: cualquier otra cosa hace que la ' +
        'pantalla avise de un recorte inexistente y el dueño busque un equipo que sí está',
    ).toBe(STOCK_LIST_MAX_UNITS);
  });
});
