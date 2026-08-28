/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  LA ÚNICA ESCRITURA SIN AUTENTICAR DEL PRODUCTO, CONTRA POSTGRES REAL Y CON EL ROL `anon`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * S4: el click en el botón de WhatsApp de la vidriera escribe una fila en `wa_click_events`. El
 * LEAD decidió que se haga con un INSERT de `anon` acotado y **no** con una ruta de
 * `service_role`, para que la base siga siendo la última línea de defensa: si mañana el handler
 * tiene un bug, la policy sigue impidiendo que la fila caiga en el tenant de otro.
 *
 * ## Por qué este archivo prueba la POLARIDAD y no el caso feliz
 * Un test que sólo inserta bien deja pasar las dos formas de romper esto, y las dos son
 * silenciosas: un `WITH CHECK` que se evalúa a `true` para todos, y un privilegio más ancho del
 * necesario. Así que acá hay cuatro afirmaciones y ninguna sobra:
 *
 *   1. el insert legítimo **pasa** (si no, el resto sería verde por vacío: nada se inserta nunca);
 *   2. el insert con el `tenant_id` de otro tenant **lo rechaza la policy**;
 *   3. el insert que nombra un `listing_id` de otro tenant **lo rechaza la policy**;
 *   4. un `select` de `anon` sobre la tabla **no devuelve nada**: falla con `42501` porque no hay
 *      privilegio de lectura. El visitante registra su click y no lee ninguno, ni el propio.
 *
 * ## El detalle que hace que 2 y 3 valgan algo
 * `42501` tapa DOS cosas distintas y confundirlas deja un test verde que no prueba nada:
 * `permission denied for table` (faltó el GRANT) y `new row violates row-level security policy`
 * (el GRANT estaba y **la policy** rechazó la fila). Un test que sólo compara el código no
 * distingue "la policy me frenó el insert cruzado" de "nunca tuve privilegio para insertar nada".
 * Por eso se afirma el mensaje, no sólo el código (`Session.expectFailure`).
 *
 * ## Lo que este archivo NO es
 * No es el test de RLS cruzado del producto: ese es de `qa-agent` y vive en `tests/`, porque el
 * que escribe las policies no puede ser también el dueño del test que las audita (CLAUDE.md §4).
 * Esto es el test unitario del paquete sobre su propia policy, y mira una sola tabla.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openAdmin, openStorefrontSession, type Session } from './test-session';

// Bloque de uuids propio (grupo `9001`): no pisa el de `rls.test.ts` (a/b), el de
// `tests/rls-cross-tenant.test.ts` (c/d) ni el de `rls-anon-storefront.test.ts` (e/f).
const TENANT_A = '00000000-0000-4000-9001-000000000001';
const TENANT_B = '00000000-0000-4000-9001-000000000002';
const SLUG_A = 'waclick-a';
const SLUG_B = 'waclick-b';

const LISTING_A = '00000000-0000-4000-9001-00000000000a';
const LISTING_A_DRAFT = '00000000-0000-4000-9001-00000000000b';
const LISTING_B = '00000000-0000-4000-9001-00000000000c';

const admin = openAdmin();
let vidrieraA: Session;
let vidrieraB: Session;
let sinClaim: Session;

async function adminRows<T>(text: string): Promise<T[]> {
  return (await admin.unsafe(text)) as unknown as T[];
}

/** Cuántos clicks tiene un tenant, leído con el rol de operador (el visitante no puede contarlos). */
async function clicksDe(tenant: string): Promise<number> {
  const r = await adminRows<{ n: string }>(
    `select count(*)::text as n from wa_click_events where tenant_id = '${tenant}'`,
  );
  return Number(r[0]?.n ?? '-1');
}

function listingInsert(id: string, tenant: string, slug: string, status: string, imei: string): string {
  return `
    insert into listings (id, tenant_id, slug, title, condition, price_usd, imei, status)
    values ('${id}', '${tenant}', '${slug}', 'iPhone 14 Pro', 'used_excellent', 620.00, '${imei}', '${status}')`;
}

beforeAll(async () => {
  await admin.unsafe(`delete from tenants where id in ('${TENANT_A}', '${TENANT_B}')`);
  await admin.unsafe(`
    insert into tenants (id, slug, name, wa_phone, status) values
      ('${TENANT_A}', '${SLUG_A}', 'Click A', '5492990000021', 'active'),
      ('${TENANT_B}', '${SLUG_B}', 'Click B', '5492990000022', 'active')`);

  await admin.unsafe(listingInsert(LISTING_A, TENANT_A, 'click-a', 'available', '353916100000101'));
  await admin.unsafe(listingInsert(LISTING_A_DRAFT, TENANT_A, 'click-a-draft', 'draft', '353916100000102'));
  await admin.unsafe(listingInsert(LISTING_B, TENANT_B, 'click-b', 'available', '353916100000103'));

  vidrieraA = openStorefrontSession(SLUG_A);
  vidrieraB = openStorefrontSession(SLUG_B);
  sinClaim = openStorefrontSession(null);
});

afterAll(async () => {
  await vidrieraA?.close();
  await vidrieraB?.close();
  await sinClaim?.close();
  await admin.unsafe(`delete from tenants where id in ('${TENANT_A}', '${TENANT_B}')`);
  await admin.end({ timeout: 5 });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('0 · el instrumento: la conexión que escribe NO es superusuario', () => {
  // Sin esto, todo lo de abajo es teatro: un superusuario ignora FORCE RLS y los GRANTs, así que
  // cualquier insert pasaría y cualquier aserción de aislamiento quedaría verde por medir mal.
  it('current_user es `anon` y no tiene usesuper ni bypassrls', async () => {
    const r = await vidrieraA.query<{ u: string; usesuper: boolean; bypass: boolean }>(`
      select current_user::text as u,
             exists (select 1 from pg_user where usename = current_user and usesuper) as usesuper,
             (select rolbypassrls from pg_roles where rolname = current_user) as bypass`);
    expect(r[0]?.u).toBe('anon');
    expect(r[0]?.usesuper).toBe(false);
    expect(r[0]?.bypass).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('a · el click legítimo SE ESCRIBE (si no, el resto sería verde por vacío)', () => {
  it('un click desde la ficha del propio tenant deja exactamente 1 fila', async () => {
    const antes = await clicksDe(TENANT_A);
    const n = await vidrieraA.affected(
      `insert into wa_click_events (tenant_id, listing_id, source)
       values ('${TENANT_A}', '${LISTING_A}', 'storefront_detail')`,
    );
    expect(n).toBe(1);
    expect(await clicksDe(TENANT_A)).toBe(antes + 1);
  });

  it('un click del FOOTER, sin listing, también: `listing_id` nulo es un caso legítimo', async () => {
    // `events.ts` lo documenta: "null si el click salió del footer". Por eso el `exists` de la
    // policy va detrás de un `listing_id is null or`. Sin ese `or`, el footer no registraría nada.
    const antes = await clicksDe(TENANT_A);
    const n = await vidrieraA.affected(
      `insert into wa_click_events (tenant_id, source) values ('${TENANT_A}', 'storefront_footer')`,
    );
    expect(n).toBe(1);
    expect(await clicksDe(TENANT_A)).toBe(antes + 1);
  });

  it('la fila quedó con el tenant y el listing correctos, y con id/created_at de sus defaults', async () => {
    const r = await adminRows<{ listing_id: string | null; source: string; id: string; created_at: string }>(`
      select id::text, listing_id::text, source, created_at::text from wa_click_events
      where tenant_id = '${TENANT_A}' and source = 'storefront_detail'`);
    expect(r).toHaveLength(1);
    expect(r[0]?.listing_id).toBe(LISTING_A);
    // No los eligió el visitante: los puso el motor.
    expect(r[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r[0]?.created_at ?? '').not.toBe('');
  });

  it('B escribe el suyo: el aislamiento no es "acá no escribe nadie"', async () => {
    const antes = await clicksDe(TENANT_B);
    expect(
      await vidrieraB.affected(
        `insert into wa_click_events (tenant_id, listing_id, source)
         values ('${TENANT_B}', '${LISTING_B}', 'storefront_card')`,
      ),
    ).toBe(1);
    expect(await clicksDe(TENANT_B)).toBe(antes + 1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('b · la policy rechaza lo que no es del tenant del claim', () => {
  it('el `tenant_id` de OTRO tenant: lo frena el WITH CHECK, no la falta de privilegio', async () => {
    const antesB = await clicksDe(TENANT_B);
    const fallo = await vidrieraA.expectFailure(
      `insert into wa_click_events (tenant_id, source) values ('${TENANT_B}', 'storefront_footer')`,
    );
    expect(fallo.code).toBe('42501');
    // La distinción importa: si el mensaje fuera `permission denied for table`, este test estaría
    // verde por la razón equivocada (nunca hubo privilegio de insert) y la policy podría estar mal.
    expect(fallo.message).toMatch(/row-level security policy/i);
    expect(await clicksDe(TENANT_B)).toBe(antesB);
  });

  it('un `listing_id` de OTRO tenant, aunque el `tenant_id` sea el propio', async () => {
    // Éste es el que se escapa cuando la policy sólo compara `tenant_id`: la fila cae en la cuenta
    // correcta pero apunta a una unidad ajena. No es escritura cross-tenant, es contaminación.
    const antesA = await clicksDe(TENANT_A);
    const fallo = await vidrieraA.expectFailure(
      `insert into wa_click_events (tenant_id, listing_id, source)
       values ('${TENANT_A}', '${LISTING_B}', 'storefront_detail')`,
    );
    expect(fallo.code).toBe('42501');
    expect(fallo.message).toMatch(/row-level security policy/i);
    expect(await clicksDe(TENANT_A)).toBe(antesA);
  });

  it('un `listing_id` que no existe tampoco entra', async () => {
    const fallo = await vidrieraA.expectFailure(
      `insert into wa_click_events (tenant_id, listing_id, source)
       values ('${TENANT_A}', '00000000-0000-4000-9001-0000000000ff', 'storefront_card')`,
    );
    expect(fallo.code).toBe('42501');
    expect(fallo.message).toMatch(/row-level security policy/i);
  });

  it('una ficha en `draft` no sirve de destino: el `exists` lee listings COMO anon', async () => {
    // Efecto de borde buscado: la subconsulta pasa por `listings_storefront_anon_select`, que
    // exige estado público. Si no está publicado, no hay botón desde el cual apretar.
    const fallo = await vidrieraA.expectFailure(
      `insert into wa_click_events (tenant_id, listing_id, source)
       values ('${TENANT_A}', '${LISTING_A_DRAFT}', 'storefront_detail')`,
    );
    expect(fallo.code).toBe('42501');
    expect(fallo.message).toMatch(/row-level security policy/i);
  });

  it('sin claim de slug no se escribe nada: falla CERRADO', async () => {
    // `storefront_tenant_id()` devuelve NULL, la comparación da NULL y el WITH CHECK no se cumple.
    // Es el caso de alguien pegándole al endpoint con la `anon key` pública de Supabase.
    const antesA = await clicksDe(TENANT_A);
    const fallo = await sinClaim.expectFailure(
      `insert into wa_click_events (tenant_id, source) values ('${TENANT_A}', 'storefront_footer')`,
    );
    expect(fallo.code).toBe('42501');
    expect(fallo.message).toMatch(/row-level security policy/i);
    expect(await clicksDe(TENANT_A)).toBe(antesA);
  });

  it('un slug que no existe tampoco: no hay tenant al que atribuirle el click', async () => {
    const fantasma = openStorefrontSession('waclick-no-existe');
    try {
      const fallo = await fantasma.expectFailure(
        `insert into wa_click_events (tenant_id, source) values ('${TENANT_A}', 'storefront_footer')`,
      );
      expect(fallo.code).toBe('42501');
      expect(fallo.message).toMatch(/row-level security policy/i);
    } finally {
      await fantasma.close();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('c · el visitante escribe su click y NO lee ninguno — ni el propio', () => {
  it('`select` sobre wa_click_events → 42501 por falta de privilegio, no cero filas', async () => {
    // Acá el mensaje SÍ tiene que ser `permission denied`: no hay policy de select que evaluar
    // porque no hay privilegio de tabla ni de columna. La consulta no corre.
    const fallo = await vidrieraA.expectFailure(`select id from wa_click_events limit 1`);
    expect(fallo.code).toBe('42501');
    expect(fallo.message).toMatch(/permission denied/i);
  });

  it('ni `select *`, ni contar, ni leer los propios filtrando por su tenant', async () => {
    for (const q of [
      `select * from wa_click_events limit 1`,
      `select count(*) from wa_click_events`,
      `select source from wa_click_events where tenant_id = '${TENANT_A}'`,
      `select listing_id from wa_click_events where tenant_id = '${TENANT_A}'`,
    ]) {
      const fallo = await vidrieraA.expectFailure(q);
      expect(fallo.code, q).toBe('42501');
      expect(fallo.message, q).toMatch(/permission denied/i);
    }
  });

  it('un `insert ... returning` tampoco: el beacon no necesita saber qué escribió', async () => {
    // Consecuencia directa de no tener lectura, y está bien. Quien escriba el handler tiene que
    // insertar sin `returning`; la respuesta a este 42501 NO es un privilegio más.
    const antesA = await clicksDe(TENANT_A);
    const fallo = await vidrieraA.expectFailure(
      `insert into wa_click_events (tenant_id, source) values ('${TENANT_A}', 'storefront_footer') returning id`,
    );
    expect(fallo.code).toBe('42501');
    expect(fallo.message).toMatch(/permission denied/i);
    expect(await clicksDe(TENANT_A)).toBe(antesA);
  });

  it('no corrige ni borra clicks, ni los propios ni los de nadie', async () => {
    for (const q of [
      `update wa_click_events set source = 'demo' where tenant_id = '${TENANT_A}'`,
      `delete from wa_click_events where tenant_id = '${TENANT_A}'`,
      `delete from wa_click_events`,
      `truncate wa_click_events`,
    ]) {
      expect(await vidrieraA.expectError(q), q).toBe('42501');
    }
  });

  it('y no escribe en NINGUNA otra tabla: la excepción es una tabla, no una puerta', async () => {
    const otras: readonly string[] = [
      `insert into listing_events (tenant_id, listing_id, kind) values ('${TENANT_A}', '${LISTING_A}', 'created')`,
      `insert into tradein_leads (tenant_id, customer_name, customer_wa_phone, model_text) values ('${TENANT_A}', 'x', '5492990000000', 'iPhone 12')`,
      `insert into reservations (tenant_id, listing_id, expires_at) values ('${TENANT_A}', '${LISTING_A}', now() + interval '60 minutes')`,
      `insert into chatbot_threads (tenant_id, listing_id) values ('${TENANT_A}', '${LISTING_A}')`,
      `insert into listings (tenant_id, slug, title, condition, price_usd) values ('${TENANT_A}', 'trucho', 'x', 'sealed', 1.00)`,
    ];
    for (const q of otras) expect(await vidrieraA.expectError(q), q).toBe('42501');
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('d · `id` y `created_at` no se pueden forjar: quedaron fuera del privilegio', () => {
  it('nombrar `id` en el insert → 42501 (permission denied for column)', async () => {
    const fallo = await vidrieraA.expectFailure(
      `insert into wa_click_events (id, tenant_id, source)
       values ('00000000-0000-4000-9001-0000000000ee', '${TENANT_A}', 'storefront_footer')`,
    );
    expect(fallo.code).toBe('42501');
    expect(fallo.message).toMatch(/permission denied/i);
  });

  it('antedatar un click nombrando `created_at` → 42501', async () => {
    const fallo = await vidrieraA.expectFailure(
      `insert into wa_click_events (tenant_id, source, created_at)
       values ('${TENANT_A}', 'storefront_footer', now() - interval '30 days')`,
    );
    expect(fallo.code).toBe('42501');
    expect(fallo.message).toMatch(/permission denied/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('e · la forma del privilegio, leída de la base y no del archivo de migración', () => {
  it('el privilegio de escritura de anon es EXACTAMENTE 3 columnas de 1 tabla', async () => {
    const r = await adminRows<{ p: string }>(`
      select table_name || '.' || column_name as p
      from information_schema.column_privileges
      where table_schema = 'public' and grantee = 'anon' and privilege_type <> 'SELECT'
      order by 1`);
    expect(r.map((x) => x.p)).toEqual([
      'wa_click_events.listing_id',
      'wa_click_events.source',
      'wa_click_events.tenant_id',
    ]);
  });

  it('no es privilegio de TABLA: `has_table_privilege` sigue en false para las 19', async () => {
    // Un GRANT de columna no otorga privilegio de tabla, y esa es la razón por la que `id` y
    // `created_at` quedan realmente afuera en vez de "afuera por convención".
    const r = await adminRows<{ t: string }>(`
      select c.relname as t from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
      order by 1`);
    expect(r.map((x) => x.t)).toEqual([]);
  });

  it('`anon` NO tiene ni una columna de lectura sobre wa_click_events', async () => {
    const r = await adminRows<{ c: string }>(`
      select column_name as c from information_schema.column_privileges
      where table_schema = 'public' and grantee = 'anon'
        and table_name = 'wa_click_events' and privilege_type = 'SELECT'
      order by 1`);
    expect(r.map((x) => x.c)).toEqual([]);
  });

  it('la única policy de escritura para anon es la de wa_click_events, y es de INSERT', async () => {
    const r = await adminRows<{ p: string; cmd: string }>(`
      select tablename || '.' || policyname as p, cmd from pg_policies
      where schemaname = 'public' and 'anon' = any(roles) and cmd <> 'SELECT' order by 1`);
    expect(r).toEqual([{ p: 'wa_click_events.wa_click_events_storefront_insert', cmd: 'INSERT' }]);
  });

  it('esa policy tiene WITH CHECK, no es `true`, y mira el claim del slug', async () => {
    const r = await adminRows<{ qual: string | null; wc: string | null }>(`
      select qual, with_check as wc from pg_policies
      where schemaname = 'public' and policyname = 'wa_click_events_storefront_insert'`);
    const wc = r[0]?.wc ?? '';
    expect(wc).not.toBe('');
    expect(wc).not.toBe('true');
    expect(wc).toContain('storefront_tenant_id');
    // En subquery: InitPlan, una evaluación por query y no una por fila (ADR-005).
    expect(wc).toMatch(/\(\s*SELECT storefront_tenant_id/i);
    // Una policy de INSERT no tiene `USING`, y no debe tenerlo: `USING` en INSERT no se evalúa.
    expect(r[0]?.qual).toBeNull();
  });

  it('la tabla lleva el porqué escrito en la propia base, no sólo en el .sql', async () => {
    const r = await adminRows<{ comment: string | null }>(
      `select obj_description('public.wa_click_events'::regclass) as comment`,
    );
    expect(r[0]?.comment ?? '').toContain('Unica escritura sin autenticar');
  });
});
