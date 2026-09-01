/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  UN CANJE `accepted` TIENE UNIDAD CREADA — Y LA AFIRMACIÓN ES DEL MOTOR, NO DEL HANDLER (S9)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Lo pidió `app-agent` por escrito en el §6 de `apps/web/app/(app)/_lib/tradein/accept-to-stock.ts`:
 * *"un CHECK que ate `status = 'accepted'` a `created_listing_id is not null`"*. Hasta S8, un lead
 * podía quedar en `accepted` sin unidad creada y no había nada en la base que lo impidiera: media
 * operación, con el vecino esperando su plata y sin equipo cargado del otro lado.
 *
 * ## Por qué NO es un CHECK, que es lo que se pidió
 * Un `CHECK` de Postgres **no se puede diferir**: se evalúa al terminar cada sentencia. Y el orden
 * de escritura real de `acceptToStock()` es, a propósito:
 *
 *   1. `update tradein_leads set status = 'accepted' …`   ← acá `created_listing_id` todavía es NULL
 *   2. `insert into listings …`
 *   3. `update tradein_leads set created_listing_id = …`
 *
 * o sea que un CHECK pelado explotaría en (1) y **rompería a quien lo pidió**: aceptar un canje
 * devolvería `23514` en la primera sentencia y el dueño vería un 500. El orden tampoco es un
 * descuido — el §2 de ese archivo argumenta que el `update` va primero porque **es** el guard de
 * concurrencia, y que invertirlo quemaría un slug y un id por cada carrera perdida. Cambiarlo es
 * una decisión de `app-agent` sobre su propia columna.
 *
 * La herramienta que sí sirve es un `CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED`: corre al
 * **COMMIT** y no al fin de la sentencia. El estado intermedio queda permitido —que es lo correcto,
 * porque dentro de una transacción no lo ve nadie más— y el estado final se exige igual.
 *
 * ## Qué mide este archivo, y por qué el caso (a) va primero
 * El riesgo de esta clase de invariante no es que deje pasar de más: es que **rompa el camino
 * feliz**. Por eso el primer test es el orden real de `acceptToStock()` commiteando, y recién
 * después vienen los rechazos. Un archivo que sólo probara los rechazos estaría verde en el mundo
 * donde aceptar un canje ya no funciona.
 *
 * ## Lo que este archivo NO es
 * No es la auditoría de referencia del canje: esa es de `qa-agent` y vive en
 * `tests/rls-cross-tenant.test.ts` (`CLAUDE.md` §4). Ningún gate cita este archivo como evidencia.
 * Y **no reimplementa `acceptToStock()`**: reproduce su ORDEN DE ESCRITURA, que es lo único de esa
 * función de lo que depende la forma del trigger.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claimsFor, openAdmin, openStorefrontSession, type Session } from './test-session';

// Bloque de uuids propio (grupo `9005`): no pisa `rls.test.ts` (9000), `rls-anon-wa-click` (9001),
// `reservations-sweep-attempts` (9002), `sales-one-sale-per-listing` (9003) ni
// `rls-anon-tradein-lead` (9004).
const TENANT = '00000000-0000-4000-9005-000000000001';
const USER = '00000000-0000-4000-9005-000000000011';
const SLUG = 'canje-invariante';

const admin = openAdmin();
const claims = JSON.stringify(claimsFor(USER, TENANT));
let vidriera: Session;

async function adminRows<T>(text: string): Promise<T[]> {
  return (await admin.unsafe(text)) as unknown as T[];
}

interface Veredicto {
  readonly ok: boolean;
  readonly code: string;
  readonly message: string;
}

/**
 * Corre N sentencias en **UNA** transacción, como `authenticated` y con el claim del tenant.
 * Los casos de cleanup que borran listings/leads pasan explícitamente a `service_role`: 0016
 * revoca DELETE del rol compartido, así que una eliminación administrativa no se simula como si
 * fuera una mutación permitida del panel.
 *
 * Ésta es la única forma de medir un trigger diferido, y por eso no se usa `openSession()`: aquel
 * helper abre una transacción **por sentencia**, así que cada `query()` commitea sola y el estado
 * intermedio del orden real de `acceptToStock()` nunca existiría. Lo que se está probando es
 * justamente que ese estado intermedio sobreviva hasta el COMMIT.
 *
 * El error se atrapa y se devuelve en vez de tirar: en un trigger diferido **el error llega en el
 * COMMIT**, no en la sentencia, y afirmar cuál de las dos cosas falló es la mitad del test.
 */
async function enUnaTransaccion(sentencias: readonly string[], role: 'authenticated' | 'service_role' = 'authenticated'): Promise<Veredicto> {
  try {
    await admin.begin(async (tx) => {
      await tx.unsafe(`set local role ${role}`);
      await tx.unsafe(
        `select set_config('request.jwt.claims', $1, true)`,
        [claims] as Parameters<typeof tx.unsafe>[1],
      );
      for (const s of sentencias) await tx.unsafe(s);
    });
    return { ok: true, code: '', message: '' };
  } catch (error) {
    const { code, message } = error as { code?: string; message?: string };
    return { ok: false, code: code ?? 'UNKNOWN', message: message ?? '' };
  }
}

function leadNuevo(id: string, sufijo: string): string {
  return `insert into tradein_leads (id, tenant_id, customer_name, customer_wa_phone, model_text)
          values ('${id}', '${TENANT}', 'Vecino ${sufijo}', '5492995551234', 'iPhone 12 128')`;
}

/** Las tres sentencias de `acceptToStock()`, en su orden real y con su forma real. */
function aceptarComoElPanel(lead: string, listing: string, slug: string): readonly string[] {
  return [
    // (1) el guard de concurrencia: `status <> 'accepted'` es lo que hace que dos clicks no creen
    //     dos unidades. Acá la fila queda `accepted` con `created_listing_id` NULL.
    `update tradein_leads set status = 'accepted', offer_usd = 400.00, updated_at = now()
      where tenant_id = '${TENANT}' and id = '${lead}' and status <> 'accepted'`,
    // (2) la unidad, en `draft`, con el costo copiado por la función owner-only dentro de la
    //     misma transacción; el rol authenticated no tiene SELECT directo sobre offer_usd.
    `insert into listings (id, tenant_id, slug, title, condition, price_usd, cost_usd, status, acquisition_channel)
      values ('${listing}', '${TENANT}', '${slug}', 'iPhone 12 128', 'used_excellent', 500.00,
              (select offer_usd from public.owner_get_tradein_sensitive('${TENANT}', '${lead}')),
              'draft', 'trade_in')`,
    // (3) el link. Sin esto, la transacción no puede commitear.
    `update tradein_leads set created_listing_id = '${listing}'
      where tenant_id = '${TENANT}' and id = '${lead}'`,
  ];
}

beforeAll(async () => {
  await admin.unsafe(`delete from tenants where id = '${TENANT}'`);
  await admin.unsafe(`
    insert into auth.users (id, email) values ('${USER}', 'duenio@canje-invariante.local')
    on conflict (id) do nothing`);
  await admin.unsafe(`
    insert into tenants (id, slug, name, wa_phone, status, accepts_trade_in)
    values ('${TENANT}', '${SLUG}', 'Canje Invariante', '5492990000051', 'active', true)`);
  await admin.unsafe(`
    insert into memberships (tenant_id, user_id, role)
    values ('${TENANT}', '${USER}', 'owner')`);
  vidriera = openStorefrontSession(SLUG);
});

afterAll(async () => {
  await vidriera?.close();
  await admin.unsafe(`delete from tenants where id = '${TENANT}'`);
  await admin.unsafe(`delete from auth.users where id = '${USER}'`);
  await admin.end({ timeout: 5 });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('0 · el instrumento: la transacción es UNA sola y el rol no es superusuario', () => {
  // Sin esto todo lo de abajo es teatro por partida doble: si cada sentencia commiteara sola, el
  // caso (a) fallaría por una razón que no es la del producto; y si el rol fuera superusuario, las
  // policies no se evaluarían y el bloque `c` estaría verde por no medir nada.
  it('las N sentencias corren en la misma transacción, con el mismo `xid`', async () => {
    const visto: string[] = [];
    await admin.begin(async (tx) => {
      await tx.unsafe(`set local role authenticated`);
      for (let i = 0; i < 2; i += 1) {
        const r = (await tx.unsafe(
          `select txid_current()::text as x, current_user::text as u`,
        )) as unknown as { x: string; u: string }[];
        visto.push(`${r[0]?.x}/${r[0]?.u}`);
      }
    });
    expect(visto[0]).toBe(visto[1]);
    expect(visto[0]).toMatch(/\/authenticated$/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('a · el camino feliz: `acceptToStock()` COMMITEA con su orden real', () => {
  const LEAD = '00000000-0000-4000-9005-000000000021';
  const LISTING = '00000000-0000-4000-9005-000000000031';

  it('acepta el canje y crea la unidad en la misma transacción', async () => {
    // Éste es el test que un `CHECK` pelado dejaría rojo: la sentencia (1) deja la fila en
    // `accepted` con `created_listing_id` NULL y el CHECK se evaluaría ahí mismo.
    await admin.unsafe(leadNuevo(LEAD, 'feliz'));
    const v = await enUnaTransaccion(aceptarComoElPanel(LEAD, LISTING, 'canje-feliz'));
    expect(v.ok, `aceptar un canje se rompió: ${v.code} ${v.message}`).toBe(true);
  });

  it('quedó `accepted` con la unidad enlazada y con el costo copiado del lead', async () => {
    const r = await adminRows<{ status: string; listing: string | null; costo: string | null }>(`
      select l.status, l.created_listing_id::text as listing, u.cost_usd::text as costo
      from tradein_leads l join listings u on u.id = l.created_listing_id
      where l.id = '${LEAD}'`);
    expect(r).toHaveLength(1);
    expect(r[0]?.status).toBe('accepted');
    expect(r[0]?.listing).toBe(LISTING);
    expect(r[0]?.costo).toBe('400.00');
  });

  it('el segundo click NO crea una segunda unidad, y el guard de (1) sigue siendo el guard', async () => {
    // El `status <> 'accepted'` de la sentencia (1) hace que el segundo intento afecte 0 filas. El
    // trigger no interfiere con eso: la fila ya está bien, así que el insert de (2) rebota por el
    // `unique` del slug y no por la invariante. Vale medirlo porque el modo de falla que se quiere
    // evitar es que la invariante nueva **enmascare** el guard de concurrencia que ya existía.
    const v = await enUnaTransaccion(aceptarComoElPanel(LEAD, LISTING, 'canje-feliz'));
    expect(v.ok).toBe(false);
    expect(v.code, 'lo frenó otra cosa que el unique de la unidad ya creada').toBe('23505');
    const r = await adminRows<{ n: string }>(
      `select count(*)::text as n from listings where tenant_id = '${TENANT}'`,
    );
    expect(r[0]?.n).toBe('1');
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('b · media operación NO commitea: `accepted` sin unidad rebota en el COMMIT', () => {
  const LEAD = '00000000-0000-4000-9005-000000000022';

  it('un lead nace en `new` sin unidad y eso está PERFECTO: el trigger no dispara', async () => {
    // La cláusula `WHEN (NEW.status = 'accepted')` es lo que hace que esto no cueste nada en el
    // camino público, que es por donde entra el 100% de los leads.
    const v = await enUnaTransaccion([leadNuevo(LEAD, 'nuevo')]);
    expect(v.ok, `un lead normal dejó de entrar: ${v.code} ${v.message}`).toBe(true);
  });

  it('pasar a `contacted`, `evaluating` o `rejected` tampoco pide unidad', async () => {
    for (const estado of ['contacted', 'evaluating', 'rejected']) {
      const v = await enUnaTransaccion([
        `update tradein_leads set status = '${estado}' where tenant_id = '${TENANT}' and id = '${LEAD}'`,
      ]);
      expect(v.ok, `${estado} rebotó: ${v.code} ${v.message}`).toBe(true);
    }
  });

  it('pasar a `accepted` SIN crear la unidad rebota con 23514 — y el error llega en el COMMIT', async () => {
    const v = await enUnaTransaccion([
      `update tradein_leads set status = 'accepted' where tenant_id = '${TENANT}' and id = '${LEAD}'`,
    ]);
    expect(v.ok).toBe(false);
    // `check_violation`: el mismo código que un CHECK, para que quien lo lea del otro lado no
    // tenga que saber que abajo hay un trigger.
    expect(v.code).toBe('23514');
    expect(v.message).toContain(LEAD);
    expect(v.message).toMatch(/sin unidad creada/i);
  });

  it('y no dejó rastro: la transacción entera se fue atrás', async () => {
    const r = await adminRows<{ status: string }>(
      `select status from tradein_leads where id = '${LEAD}'`,
    );
    expect(r[0]?.status).toBe('rejected');
  });

  it('un INSERT directo en `accepted` sin unidad tampoco entra (import, backfill, script suelto)', async () => {
    // El trigger es `AFTER INSERT OR UPDATE`, no sólo UPDATE: la puerta de al lado también cierra.
    const v = await enUnaTransaccion([
      `insert into tradein_leads (id, tenant_id, customer_name, customer_wa_phone, model_text, status)
       values ('00000000-0000-4000-9005-000000000023', '${TENANT}', 'Import', '5492995551234',
               'iPhone 11', 'accepted')`,
    ]);
    expect(v.ok).toBe(false);
    expect(v.code).toBe('23514');
  });

  it('aceptar y ARREPENTIRSE en la misma transacción sí commitea: no hay fila que violar', async () => {
    // Es la consecuencia directa de releer por PK en vez de mirar `NEW`. Si la función mirara la
    // tupla vieja, este caso explotaría por una fila que ya no existe.
    const efimero = '00000000-0000-4000-9005-000000000024';
    const v = await enUnaTransaccion([
      leadNuevo(efimero, 'efimero'),
      `update tradein_leads set status = 'accepted' where tenant_id = '${TENANT}' and id = '${efimero}'`,
      `delete from tradein_leads where tenant_id = '${TENANT}' and id = '${efimero}'`,
    ], 'service_role');
    expect(v.ok, `${v.code} ${v.message}`).toBe(true);
  });

  it('volver a `evaluating` DES-acepta y libera la unidad: la salida existe', async () => {
    // Si el único camino fuera "creá la unidad", la invariante sería una trampa: el dueño que se
    // equivocó al aceptar quedaría preso. Se mide para que el error de arriba tenga una salida
    // escrita y probada, no sólo un HINT.
    const lead = '00000000-0000-4000-9005-000000000025';
    const listing = '00000000-0000-4000-9005-000000000035';
    await admin.unsafe(leadNuevo(lead, 'arrepentido'));
    expect((await enUnaTransaccion(aceptarComoElPanel(lead, listing, 'canje-arrepentido'))).ok).toBe(true);

    const v = await enUnaTransaccion([
      `update tradein_leads set status = 'evaluating', created_listing_id = null
        where tenant_id = '${TENANT}' and id = '${lead}'`,
      `delete from listings where tenant_id = '${TENANT}' and id = '${listing}'`,
    ], 'service_role');
    expect(v.ok, `${v.code} ${v.message}`).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('c · borrar la unidad de un canje aceptado: CAMBIO DE COMPORTAMIENTO, medido', () => {
  const LEAD = '00000000-0000-4000-9005-000000000026';
  const LISTING = '00000000-0000-4000-9005-000000000036';

  beforeAll(async () => {
    await admin.unsafe(leadNuevo(LEAD, 'borrado'));
    const v = await enUnaTransaccion(aceptarComoElPanel(LEAD, LISTING, 'canje-borrado'));
    expect(v.ok, `${v.code} ${v.message}`).toBe(true);
  });

  it('borrar la unidad SOLA rebota por la FK compuesta, antes de dejar el lead huérfano', async () => {
    // `SET NULL` no es válido con `tenant_id NOT NULL`: la FK compuesta protege la relación y
    // obliga a resolver el canje antes de borrar la unidad. No rompe ningún flujo vivo: `apps/web`
    // no tiene un camino que borre un `listing`.
    const v = await enUnaTransaccion([
      `delete from listings where tenant_id = '${TENANT}' and id = '${LISTING}'`,
    ], 'service_role');
    expect(v.ok).toBe(false);
    expect(v.code).toBe('23503');
    expect(v.message).toContain('tradein_leads_tenant_created_listing_fk');
  });

  it('la relación queda declarada como FK compuesta con `ON DELETE RESTRICT`', async () => {
    const fk = await adminRows<{ def: string }>(`
      select pg_get_constraintdef(oid) as def
      from pg_constraint
      where conrelid = 'public.tradein_leads'::regclass
        and conname = 'tradein_leads_tenant_created_listing_fk'`);
    expect(fk[0]?.def).toMatch(/FOREIGN KEY \(tenant_id, created_listing_id\)/i);
    expect(fk[0]?.def).toMatch(/ON DELETE RESTRICT/i);

    // El constraint trigger legado sigue protegiendo transiciones de estado; ya no lo dispara
    // una eliminación porque la FK compuesta la rechaza antes.
    const r = await adminRows<{ ev: string }>(`
      select string_agg(
               case when t.tgtype::int & 4 = 4 then 'insert' else '' end ||
               case when t.tgtype::int & 16 = 16 then 'update' else '' end, ',') as ev
      from pg_trigger t
      where t.tgrelid = 'public.tradein_leads'::regclass
        and t.tgname = 'tradein_leads_accepted_has_listing'`);
    expect(r[0]?.ev).toBe('insertupdate');

    const cols = await adminRows<{ c: string }>(`
      select string_agg(a.attname, ',' order by a.attname) as c
      from pg_trigger t
      join unnest(t.tgattr::int2[]) as att(num) on true
      join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = att.num
      where t.tgrelid = 'public.tradein_leads'::regclass
        and t.tgname = 'tradein_leads_accepted_has_listing'`);
    expect(cols[0]?.c).toBe('created_listing_id,status');
  });

  it('borrar el lead Y la unidad juntos SÍ commitea: la salida es resolver el canje', async () => {
    const v = await enUnaTransaccion([
      `delete from tradein_leads where tenant_id = '${TENANT}' and id = '${LEAD}'`,
      `delete from listings where tenant_id = '${TENANT}' and id = '${LISTING}'`,
    ], 'service_role');
    expect(v.ok, `${v.code} ${v.message}`).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('d · la vidriera anónima no paga nada por esto y tampoco puede esquivarlo', () => {
  it('el lead del visitante entra igual que antes de 0009', async () => {
    // El trigger existe para el panel. Si el camino público lo rozara, el costo de esta invariante
    // lo pagaría cada visitante de cada vidriera del sistema.
    const n = await vidriera.affected(`
      insert into tradein_leads (tenant_id, customer_name, customer_wa_phone, model_text)
      values ('${TENANT}', 'Visitante', '5492995559999', 'iPhone SE 64')`);
    expect(n).toBe(1);
  });

  it('`anon` no puede escribir `status`, así que la cláusula `WHEN` nunca es verdadera para él', async () => {
    // Doble candado y las dos ramas fallan cerrado: si mañana alguien le diera el privilegio de
    // `status`, el trigger dispararía y la función releería `tradein_leads` — sobre la que `anon`
    // no tiene ni una columna de SELECT, así que recibiría `42501` y la escritura se caería igual.
    const fallo = await vidriera.expectFailure(`
      insert into tradein_leads (tenant_id, customer_name, customer_wa_phone, model_text, status)
      values ('${TENANT}', 'Vivo', '5492995559999', 'iPhone SE 64', 'accepted')`);
    expect(fallo.code).toBe('42501');
    expect(fallo.message).toMatch(/permission denied/i);

    const lectura = await adminRows<{ c: string }>(`
      select coalesce(string_agg(column_name, ','), '') as c
      from information_schema.column_privileges
      where table_schema = 'public' and grantee = 'anon'
        and table_name = 'tradein_leads' and privilege_type = 'SELECT'`);
    expect(lectura[0]?.c).toBe('');
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('e · la forma del trigger, leída de la BASE y no del archivo de migración', () => {
  it('es un CONSTRAINT TRIGGER, DEFERRABLE e INITIALLY DEFERRED', async () => {
    // Las tres cosas por separado: `DEFERRABLE` sin `INITIALLY DEFERRED` se evaluaría por sentencia
    // salvo que alguien escriba `SET CONSTRAINTS`, o sea rompería a `acceptToStock()` igual que un
    // CHECK. Es el modo de falla exacto que 0009 eligió evitar, y por eso se afirma.
    const r = await adminRows<{ deferrable: boolean; deferred: boolean; constraint: boolean; row: boolean }>(`
      select tgdeferrable as deferrable, tginitdeferred as deferred,
             (tgconstraint <> 0) as constraint, (tgtype::int & 1 = 1) as row
      from pg_trigger
      where tgrelid = 'public.tradein_leads'::regclass
        and tgname = 'tradein_leads_accepted_has_listing'`);
    expect(r).toHaveLength(1);
    expect(r[0]?.deferrable).toBe(true);
    expect(r[0]?.deferred).toBe(true);
    expect(r[0]?.constraint).toBe(true);
    expect(r[0]?.row).toBe(true);
  });

  it('tiene cláusula `WHEN`: sin ella, cada lead de la vidriera pagaría un lookup por PK', async () => {
    const r = await adminRows<{ def: string }>(`
      select pg_get_triggerdef(oid) as def from pg_trigger
      where tgrelid = 'public.tradein_leads'::regclass
        and tgname = 'tradein_leads_accepted_has_listing'`);
    const def = r[0]?.def ?? '';
    expect(def).toMatch(/WHEN \(+new\.status = 'accepted'/i);
    expect(def).toMatch(/DEFERRABLE INITIALLY DEFERRED/i);
  });

  it('la función es SECURITY INVOKER y tiene `search_path` fijo', async () => {
    // INVOKER a propósito: con FORCE RLS puesto, una `security definer` cuyo dueño no tenga
    // BYPASSRLS leería CERO filas — y una relectura vacía acá no rompe, CALLA. Sería un gate
    // vacuamente verde, que es peor que no tenerlo.
    const r = await adminRows<{ definer: boolean; config: string | null }>(`
      select prosecdef as definer, array_to_string(proconfig, ',') as config
      from pg_proc where proname = 'tradein_leads_accepted_has_listing'`);
    expect(r).toHaveLength(1);
    expect(r[0]?.definer).toBe(false);
    expect(r[0]?.config ?? '').toContain('search_path=');
  });

  it('la función NO mira `NEW`: relee la fila por PK, que es lo único correcto en un diferido', async () => {
    // `NEW` es la tupla del momento de la SENTENCIA. En el orden real de `acceptToStock()`, (1)
    // encola un evento con `NEW = (accepted, NULL)` que ya está desactualizado cuando llega el
    // COMMIT. Mirar `NEW` haría fallar el camino feliz, que es el test (a) de este archivo. Se
    // afirma sobre el cuerpo porque es una decisión que se puede "simplificar" sin querer.
    const r = await adminRows<{ src: string }>(
      `select prosrc as src from pg_proc where proname = 'tradein_leads_accepted_has_listing'`,
    );
    const src = r[0]?.src ?? '';
    expect(src).toMatch(/from\s+public\.tradein_leads\s+l/i);
    expect(src).toMatch(/l\.id\s*=\s*NEW\.id/i);
    // Lo único que se usa de `NEW` es la PK. Ni el status ni el link salen de la tupla vieja.
    expect(src).not.toMatch(/NEW\.status/i);
    expect(src).not.toMatch(/NEW\.created_listing_id/i);
  });

  it('la función lleva el porqué escrito en la base, no sólo en el .sql', async () => {
    const r = await adminRows<{ c: string | null }>(`
      select obj_description(oid, 'pg_proc') as c
      from pg_proc where proname = 'tradein_leads_accepted_has_listing'`);
    expect(r[0]?.c ?? '').toContain('DEFERRABLE');
  });

  it('no quedó ningún canje `accepted` huérfano en la base: la invariante vale también hacia atrás', async () => {
    // Un CONSTRAINT TRIGGER no valida las filas que ya estaban (a diferencia de un
    // `CHECK … NOT VALID` + `VALIDATE`). El pre-chequeo de 0009 aborta la migración si las hay;
    // esto lo vuelve a mirar sobre la base entera, no sólo sobre el tenant del fixture.
    const r = await adminRows<{ n: string }>(`
      select count(*)::text as n from tradein_leads
      where status = 'accepted' and created_listing_id is null`);
    expect(r[0]?.n).toBe('0');
  });
});
