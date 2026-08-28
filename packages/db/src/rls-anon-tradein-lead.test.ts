/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  EL LEAD DE CANJE ENTRA COMO `anon`, CONTRA POSTGRES REAL. RED DE REGRESIÓN DE `packages/db`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * S8: el visitante de la vidriera deja su canje sin estar logueado. El LEAD decidió que entre con
 * un INSERT de `anon` acotado y **no** por un handler con `service_role`, por el mismo motivo que
 * el click de WhatsApp de S4: `service_role` tiene BYPASSRLS, así que con él la garantía de que la
 * fila cae en el tenant correcto viviría **entera** en el handler y la base dejaría de ser la
 * última línea de defensa justo en un endpoint sin login. Con `anon` + policy, el `WITH CHECK` lo
 * evalúa el planner en cada insert.
 *
 * ## Las tres capas que este archivo separa a propósito
 * `42501` tapa dos cosas distintas y el `.sql` no distingue cuál te frenó:
 *
 *   · `permission denied for table/column`         → faltó el **GRANT** (capa 1)
 *   · `new row violates row-level security policy` → el GRANT estaba y la **policy** rechazó (capa 2)
 *   · `violates check constraint "..."`  (`23514`) → las dos pasaron y la frenó el **CHECK** (capa 3)
 *
 * Un test que sólo compara el código deja verde el caso en que "la policy me frenó el insert
 * cruzado" es en realidad "nunca tuve privilegio para insertar nada". Por eso acá se afirma el
 * mensaje, no sólo el código, exactamente como hace `rls-anon-wa-click.test.ts` (R9c).
 *
 * La capa 3 no existe en S4 y acá sí hace falta: el click escribe un enum y dos uuids, así que la
 * forma la garantiza el tipo. El canje es **texto libre de un anónimo**, y entre un `curl` y la
 * tabla el handler es la única otra capa. Zod en el borde va a exigir lo mismo (`storefront-agent`),
 * pero una afirmación que vive sólo en el borde se pierde el día que aparece un segundo caller.
 *
 * ## Lo que este archivo NO es
 * No es la auditoría de referencia cruzada del producto: esa es de `qa-agent` y vive en
 * `tests/rls-cross-tenant.test.ts` (`CLAUDE.md` §4, la precisión de S4). Esto es la red de
 * regresión del paquete sobre su propia migración, y ningún gate la cita como evidencia. Si los
 * dos divergen, gana el de `tests/` y el que se corrige es éste.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openAdmin, openStorefrontSession, type Session } from './test-session';

// Bloque de uuids propio (grupo `9004`): no pisa `rls.test.ts` (9000), `rls-anon-wa-click` (9001),
// `reservations-sweep-attempts` (9002) ni `sales-one-sale-per-listing` (9003).
const TENANT_A = '00000000-0000-4000-9004-000000000001';
const TENANT_B = '00000000-0000-4000-9004-000000000002';
const SLUG_A = 'canje-a';
const SLUG_B = 'canje-b';

const admin = openAdmin();
let vidrieraA: Session;
let vidrieraB: Session;
let sinClaim: Session;

async function adminRows<T>(text: string): Promise<T[]> {
  return (await admin.unsafe(text)) as unknown as T[];
}

/** Cuántos leads tiene un tenant, leído con el rol de operador: el visitante no puede contarlos. */
async function leadsDe(tenant: string): Promise<number> {
  const r = await adminRows<{ n: string }>(
    `select count(*)::text as n from tradein_leads where tenant_id = '${tenant}'`,
  );
  return Number(r[0]?.n ?? '-1');
}

/**
 * El insert mínimo que manda la vidriera: las cuatro columnas `not null` del formulario. Cada
 * test agrega lo suyo encima. Se escribe como texto porque el caller real de S8 todavía no
 * existe; lo que se está midiendo es la superficie de la BASE, no la forma de una query de Drizzle.
 */
function leadMinimo(tenant: string, extraCols = '', extraVals = ''): string {
  return `
    insert into tradein_leads (tenant_id, customer_name, customer_wa_phone, model_text${extraCols})
    values ('${tenant}', 'Vecino de Cipolletti', '5492995551234', 'iPhone 13 128'${extraVals})`;
}

beforeAll(async () => {
  await admin.unsafe(`delete from tenants where id in ('${TENANT_A}', '${TENANT_B}')`);
  await admin.unsafe(`
    insert into tenants (id, slug, name, wa_phone, status) values
      ('${TENANT_A}', '${SLUG_A}', 'Canje A', '5492990000041', 'active'),
      ('${TENANT_B}', '${SLUG_B}', 'Canje B', '5492990000042', 'active')`);

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
  // Sin esto todo lo de abajo es teatro: un superusuario ignora FORCE RLS y los GRANTs por igual,
  // así que cualquier insert pasaría y toda aserción de aislamiento quedaría verde por medir mal.
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
describe('a · el canje legítimo SE ESCRIBE (si no, el resto sería verde por vacío)', () => {
  it('la vidriera de A deja un lead en A', async () => {
    const antes = await leadsDe(TENANT_A);
    expect(await vidrieraA.affected(leadMinimo(TENANT_A))).toBe(1);
    expect(await leadsDe(TENANT_A)).toBe(antes + 1);
  });

  it('B deja el suyo: el aislamiento no es "acá no escribe nadie"', async () => {
    const antes = await leadsDe(TENANT_B);
    expect(await vidrieraB.affected(leadMinimo(TENANT_B))).toBe(1);
    expect(await leadsDe(TENANT_B)).toBe(antes + 1);
  });

  it('los campos opcionales que el visitante SÍ puede mandar entran', async () => {
    const antes = await leadsDe(TENANT_A);
    expect(
      await vidrieraA.affected(
        leadMinimo(
          TENANT_A,
          ', storage_gb, color, declared_condition, battery_pct, notes',
          `, 128, 'Medianoche', 'used_excellent', 87, 'Tiene un rayón en el marco'`,
        ),
      ),
    ).toBe(1);
    expect(await leadsDe(TENANT_A)).toBe(antes + 1);
  });

  it('la fila nació en `new`, sin oferta, sin notas internas y sin dueño asignado', async () => {
    // Lo que el visitante NO puede escribir tiene que quedar en su default, no en lo que él diga.
    const r = await adminRows<{
      status: string;
      offer_usd: string | null;
      internal_notes: string | null;
      created_listing_id: string | null;
      handled_by: string | null;
      id: string;
      created_at: string;
    }>(`
      select status, offer_usd::text, internal_notes, created_listing_id::text, handled_by::text,
             id::text, created_at::text
      from tradein_leads where tenant_id = '${TENANT_A}' and color = 'Medianoche'`);
    expect(r).toHaveLength(1);
    expect(r[0]?.status).toBe('new');
    expect(r[0]?.offer_usd).toBeNull();
    expect(r[0]?.internal_notes).toBeNull();
    expect(r[0]?.created_listing_id).toBeNull();
    expect(r[0]?.handled_by).toBeNull();
    // No los eligió el visitante: los puso el motor.
    expect(r[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r[0]?.created_at ?? '').not.toBe('');
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('b · capa 2 · la POLICY rechaza lo que no es del tenant del claim', () => {
  it('el `tenant_id` de OTRO tenant: lo frena el WITH CHECK, no la falta de privilegio', async () => {
    // Éste es el ataque que el diseño con `service_role` no podría parar por sí solo: el body
    // dice B y la sesión es la vidriera de A.
    const antesB = await leadsDe(TENANT_B);
    const fallo = await vidrieraA.expectFailure(leadMinimo(TENANT_B));
    expect(fallo.code).toBe('42501');
    // La distinción importa: con `permission denied for table` este test estaría verde por la
    // razón equivocada (nunca hubo privilegio) y la policy podría estar mal escrita.
    expect(fallo.message).toMatch(/row-level security policy/i);
    expect(await leadsDe(TENANT_B)).toBe(antesB);
  });

  it('sin claim de slug no se escribe nada: falla CERRADO', async () => {
    // `storefront_tenant_id()` devuelve NULL, la comparación da NULL y el WITH CHECK no se cumple.
    // Es el caso de alguien pegándole con la `anon key` pública de Supabase.
    const antesA = await leadsDe(TENANT_A);
    const fallo = await sinClaim.expectFailure(leadMinimo(TENANT_A));
    expect(fallo.code).toBe('42501');
    expect(fallo.message).toMatch(/row-level security policy/i);
    expect(await leadsDe(TENANT_A)).toBe(antesA);
  });

  it('un slug que no existe tampoco: no hay tenant al que atribuirle el canje', async () => {
    const fantasma = openStorefrontSession('canje-no-existe');
    try {
      const fallo = await fantasma.expectFailure(leadMinimo(TENANT_A));
      expect(fallo.code).toBe('42501');
      expect(fallo.message).toMatch(/row-level security policy/i);
    } finally {
      await fantasma.close();
    }
  });

  it('un `tenant_id` que no existe: la policy lo frena antes que la FK', async () => {
    const fallo = await vidrieraA.expectFailure(leadMinimo('00000000-0000-4000-9004-0000000000ff'));
    expect(fallo.code).toBe('42501');
    expect(fallo.message).toMatch(/row-level security policy/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('c · capa 1 · el GRANT: nueve columnas, y las otras ocho ni se nombran', () => {
  // Acá el mensaje tiene que ser `permission denied` y NO `row-level security policy`: son dos
  // mecanismos distintos y confundirlos es creer que la policy tapa lo que en realidad tapa el
  // privilegio. Si mañana alguien "arregla" esto agrandando el GRANT, estos tests pasan a decir
  // `row-level security policy` (o directamente a insertar) y el diff se ve.

  async function denegadoPorPrivilegio(session: Session, sqlText: string): Promise<void> {
    const fallo = await session.expectFailure(sqlText);
    expect(fallo.code, sqlText).toBe('42501');
    expect(fallo.message, sqlText).toMatch(/permission denied/i);
  }

  it('`offer_usd` → permission denied: es el COSTO de la unidad que nace del canje', async () => {
    // `CLAUDE.md` §0.9 y §2. Que el visitante escriba su propia oferta es escribir el costo de
    // una unidad de stock desde afuera del negocio.
    const antes = await leadsDe(TENANT_A);
    await denegadoPorPrivilegio(vidrieraA, leadMinimo(TENANT_A, ', offer_usd', ', 480.00'));
    expect(await leadsDe(TENANT_A)).toBe(antes);
  });

  it('`internal_notes` → permission denied: son las notas del dueño, no del visitante', async () => {
    await denegadoPorPrivilegio(vidrieraA, leadMinimo(TENANT_A, ', internal_notes', `, 'regatear'`));
  });

  it('`status = accepted` → permission denied: nadie se auto-aprueba el canje', async () => {
    // Sin este candado, un `curl` deja el lead en `accepted` y se saltea la evaluación entera.
    const antes = await leadsDe(TENANT_A);
    await denegadoPorPrivilegio(vidrieraA, leadMinimo(TENANT_A, ', status', `, 'accepted'`));
    expect(await leadsDe(TENANT_A)).toBe(antes);
  });

  it('`status = new`, o sea el mismo valor del default, tampoco: el privilegio mira la COLUMNA', async () => {
    // Postgres exige el privilegio sobre cada columna NOMBRADA, aunque el valor coincida con el
    // default. Es lo que hace que "sacarla del GRANT" signifique algo y no sea una convención.
    await denegadoPorPrivilegio(vidrieraA, leadMinimo(TENANT_A, ', status', `, 'new'`));
  });

  it('`id`, `created_at` y `updated_at` → permission denied: salen de sus defaults y no se forjan', async () => {
    await denegadoPorPrivilegio(
      vidrieraA,
      leadMinimo(TENANT_A, ', id', `, '00000000-0000-4000-9004-0000000000ee'`),
    );
    await denegadoPorPrivilegio(
      vidrieraA,
      leadMinimo(TENANT_A, ', created_at', `, now() - interval '30 days'`),
    );
    await denegadoPorPrivilegio(vidrieraA, leadMinimo(TENANT_A, ', updated_at', `, now()`));
  });

  it('`created_listing_id` y `handled_by` → permission denied: los escribe accept-to-stock', async () => {
    await denegadoPorPrivilegio(
      vidrieraA,
      leadMinimo(TENANT_A, ', created_listing_id', `, '00000000-0000-4000-9004-0000000000aa'`),
    );
    await denegadoPorPrivilegio(
      vidrieraA,
      leadMinimo(TENANT_A, ', handled_by', `, '00000000-0000-4000-9004-0000000000bb'`),
    );
  });

  it('`insert ... default values` lo frena la POLICY, no el GRANT — y por eso hacen falta las dos', async () => {
    // Medido, no supuesto: esta sentencia **no nombra ninguna columna**, así que el chequeo de
    // privilegio de columna no tiene nada que rechazar y el insert llega hasta la policy, que lo
    // corta porque `tenant_id` quedaría NULL. Vale escribirlo porque contradice la intuición de
    // que "el GRANT de columna tapa todo": la capa 1 acota QUÉ columnas, no si podés intentarlo.
    // Un diseño con `service_role` no tendría esta segunda capa y la fila entraría sin tenant.
    const antes = await leadsDe(TENANT_A);
    const fallo = await vidrieraA.expectFailure(`insert into tradein_leads default values`);
    expect(fallo.code).toBe('42501');
    expect(fallo.message).toMatch(/row-level security policy/i);
    expect(await leadsDe(TENANT_A)).toBe(antes);
  });

  it('y no escribe en `tradein_checklists`: la excepción es UNA tabla del canje, no el canje', async () => {
    // La evaluación presencial la carga el dueño. Un visitante que pudiera escribir el checklist
    // se auto-certificaría la batería y la pantalla del equipo que viene a canjear.
    const fallo = await vidrieraA.expectFailure(`
      insert into tradein_checklists (tenant_id, tradein_lead_id, item_key, item_label)
      values ('${TENANT_A}', '00000000-0000-4000-9004-0000000000cc', 'battery', 'Bateria')`);
    expect(fallo.code).toBe('42501');
    expect(fallo.message).toMatch(/permission denied/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('d · el visitante deja su canje y NO lee ninguno — ni el propio', () => {
  it('`select` sobre tradein_leads → 42501 por falta de privilegio, no cero filas', async () => {
    // No hay policy de select que evaluar porque no hay privilegio: la consulta ni siquiera corre.
    const fallo = await vidrieraA.expectFailure(`select id from tradein_leads limit 1`);
    expect(fallo.code).toBe('42501');
    expect(fallo.message).toMatch(/permission denied/i);
  });

  it('ni `select *`, ni contar, ni leer el propio filtrando por su tenant, ni el teléfono', async () => {
    for (const q of [
      `select * from tradein_leads limit 1`,
      `select count(*) from tradein_leads`,
      `select customer_name from tradein_leads where tenant_id = '${TENANT_A}'`,
      `select customer_wa_phone from tradein_leads where tenant_id = '${TENANT_A}'`,
      `select offer_usd from tradein_leads where tenant_id = '${TENANT_A}'`,
      `select internal_notes from tradein_leads`,
    ]) {
      const fallo = await vidrieraA.expectFailure(q);
      expect(fallo.code, q).toBe('42501');
      expect(fallo.message, q).toMatch(/permission denied/i);
    }
  });

  it('un `insert ... returning` tampoco: el form no necesita saber qué id escribió', async () => {
    // Consecuencia directa de no tener lectura, y está bien. La respuesta a este 42501 NO es un
    // privilegio de SELECT más: si el form quiere confirmar algo, que confirme sin el id.
    const antes = await leadsDe(TENANT_A);
    const fallo = await vidrieraA.expectFailure(`${leadMinimo(TENANT_A)} returning id`);
    expect(fallo.code).toBe('42501');
    expect(fallo.message).toMatch(/permission denied/i);
    expect(await leadsDe(TENANT_A)).toBe(antes);
  });

  it('no corrige ni borra leads, ni los propios ni los de nadie', async () => {
    for (const q of [
      `update tradein_leads set customer_name = 'otro' where tenant_id = '${TENANT_A}'`,
      `update tradein_leads set status = 'accepted'`,
      `delete from tradein_leads where tenant_id = '${TENANT_A}'`,
      `delete from tradein_leads`,
      `truncate tradein_leads`,
    ]) {
      expect(await vidrieraA.expectError(q), q).toBe('42501');
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('e · capa 3 · los CHECK, con el valor justo adentro y el justo afuera del borde', () => {
  // Un CHECK que sólo se prueba con un valor absurdo (`repeat('x', 10000)`) no dice dónde está el
  // borde: pasaría igual si el límite fuera 8000. Por eso cada uno se mide en N y en N+1.

  /** Adentro del borde: la fila entra. Se borra al toque para no ensuciar los conteos de arriba. */
  async function entra(extraCols: string, extraVals: string): Promise<void> {
    const n = await vidrieraA.affected(leadMinimo(TENANT_A, extraCols, extraVals));
    expect(n, `${extraCols} = ${extraVals} tendría que entrar`).toBe(1);
    await admin.unsafe(`delete from tradein_leads where tenant_id = '${TENANT_A}'
                        and id = (select id from tradein_leads where tenant_id = '${TENANT_A}'
                                  order by created_at desc limit 1)`);
  }

  /** Afuera del borde: `23514`, y el mensaje nombra la constraint que lo frenó. */
  async function rebota(extraCols: string, extraVals: string, constraint: string): Promise<void> {
    const fallo = await vidrieraA.expectFailure(leadMinimo(TENANT_A, extraCols, extraVals));
    expect(fallo.code, `${extraCols} = ${extraVals}`).toBe('23514');
    expect(fallo.message, `${extraCols} = ${extraVals}`).toContain(constraint);
  }

  /** Igual que `rebota` pero para las cuatro columnas `not null` del form, que van en el insert base. */
  async function rebotaBase(sqlText: string, constraint: string): Promise<void> {
    const fallo = await vidrieraA.expectFailure(sqlText);
    expect(fallo.code, sqlText).toBe('23514');
    expect(fallo.message, sqlText).toContain(constraint);
  }

  function conNombre(expr: string): string {
    return `insert into tradein_leads (tenant_id, customer_name, customer_wa_phone, model_text)
            values ('${TENANT_A}', ${expr}, '5492995551234', 'iPhone 13 128')`;
  }
  function conTelefono(expr: string): string {
    return `insert into tradein_leads (tenant_id, customer_name, customer_wa_phone, model_text)
            values ('${TENANT_A}', 'Vecino', ${expr}, 'iPhone 13 128')`;
  }
  function conModelo(expr: string): string {
    return `insert into tradein_leads (tenant_id, customer_name, customer_wa_phone, model_text)
            values ('${TENANT_A}', 'Vecino', '5492995551234', ${expr})`;
  }

  it('customer_name: 1 y 80 entran; 0 y 81 rebotan', async () => {
    expect(await vidrieraA.affected(conNombre(`repeat('x', 1)`))).toBe(1);
    expect(await vidrieraA.affected(conNombre(`repeat('x', 80)`))).toBe(1);
    await admin.unsafe(`delete from tradein_leads where tenant_id = '${TENANT_A}' and model_text = 'iPhone 13 128' and customer_name ~ '^x+$'`);
    await rebotaBase(conNombre(`''`), 'tradein_leads_customer_name_len');
    await rebotaBase(conNombre(`repeat('x', 81)`), 'tradein_leads_customer_name_len');
  });

  it('customer_wa_phone: 6 y 25 entran; 5 y 26 rebotan', async () => {
    expect(await vidrieraA.affected(conTelefono(`repeat('9', 6)`))).toBe(1);
    expect(await vidrieraA.affected(conTelefono(`repeat('9', 25)`))).toBe(1);
    await admin.unsafe(`delete from tradein_leads where tenant_id = '${TENANT_A}' and customer_wa_phone ~ '^9+$'`);
    await rebotaBase(conTelefono(`repeat('9', 5)`), 'tradein_leads_customer_wa_phone_len');
    await rebotaBase(conTelefono(`repeat('9', 26)`), 'tradein_leads_customer_wa_phone_len');
  });

  it('model_text: 1 y 120 entran; 0 y 121 rebotan', async () => {
    expect(await vidrieraA.affected(conModelo(`repeat('m', 1)`))).toBe(1);
    expect(await vidrieraA.affected(conModelo(`repeat('m', 120)`))).toBe(1);
    await admin.unsafe(`delete from tradein_leads where tenant_id = '${TENANT_A}' and model_text ~ '^m+$'`);
    await rebotaBase(conModelo(`''`), 'tradein_leads_model_text_len');
    await rebotaBase(conModelo(`repeat('m', 121)`), 'tradein_leads_model_text_len');
  });

  it('color: null y 40 entran; 41 rebota', async () => {
    await entra(', color', ', null');
    await entra(', color', `, repeat('c', 40)`);
    await rebota(', color', `, repeat('c', 41)`, 'tradein_leads_color_len');
  });

  it('notes: null y 500 entran; 501 rebota', async () => {
    await entra(', notes', ', null');
    await entra(', notes', `, repeat('n', 500)`);
    await rebota(', notes', `, repeat('n', 501)`, 'tradein_leads_notes_len');
  });

  it('battery_pct: null, 0 y 100 entran; -1 y 101 rebotan', async () => {
    await entra(', battery_pct', ', null');
    await entra(', battery_pct', ', 0');
    await entra(', battery_pct', ', 100');
    await rebota(', battery_pct', ', -1', 'tradein_leads_battery_pct_range');
    await rebota(', battery_pct', ', 101', 'tradein_leads_battery_pct_range');
  });

  it('storage_gb: null, 1 y 4096 entran; 0 y 4097 rebotan', async () => {
    await entra(', storage_gb', ', null');
    await entra(', storage_gb', ', 1');
    await entra(', storage_gb', ', 4096');
    await rebota(', storage_gb', ', 0', 'tradein_leads_storage_gb_range');
    await rebota(', storage_gb', ', 4097', 'tradein_leads_storage_gb_range');
  });

  it('los CHECK también atan al PANEL: no son "validación de la vidriera"', async () => {
    // Se mide con el rol de operador, que no pasa por el GRANT ni por la policy de `anon`. Es la
    // diferencia entre una regla del motor y una regla del borde: si esto fuera Zod, un
    // `accept-to-stock` mal escrito la saltearía sin enterarse.
    let error: { code?: string } = {};
    try {
      await admin.unsafe(`
        insert into tradein_leads (tenant_id, customer_name, customer_wa_phone, model_text, battery_pct)
        values ('${TENANT_A}', 'Panel', '5492995551234', 'iPhone 13', 500)`);
    } catch (e) {
      error = e as { code?: string };
    }
    expect(error.code).toBe('23514');
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('f · la forma del privilegio, leída de la BASE y no del archivo de migración', () => {
  it('el privilegio de escritura de anon sobre tradein_leads son EXACTAMENTE 9 columnas', async () => {
    const r = await adminRows<{ c: string }>(`
      select column_name as c from information_schema.column_privileges
      where table_schema = 'public' and grantee = 'anon'
        and table_name = 'tradein_leads' and privilege_type = 'INSERT'
      order by 1`);
    expect(r.map((x) => x.c)).toEqual([
      'battery_pct', 'color', 'customer_name', 'customer_wa_phone', 'declared_condition',
      'model_text', 'notes', 'storage_gb', 'tenant_id',
    ]);
  });

  it('las ocho columnas de afuera no están, y se nombran para que el diff las muestre', async () => {
    // Igualdad exacta arriba y ausencia explícita acá: lo primero rompe si aparece una columna de
    // más, lo segundo dice CUÁL y por qué importa cuando alguien lee el fallo.
    const r = await adminRows<{ c: string }>(`
      select column_name as c from information_schema.column_privileges
      where table_schema = 'public' and grantee = 'anon' and table_name = 'tradein_leads'
        and column_name in ('id', 'created_at', 'updated_at', 'status', 'offer_usd',
                            'internal_notes', 'created_listing_id', 'handled_by')`);
    expect(r.map((x) => x.c)).toEqual([]);
  });

  it('no es privilegio de TABLA: un GRANT de tabla alcanzaría a toda columna futura', async () => {
    const r = await adminRows<{ p: string }>(`
      select p from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as p
      where has_table_privilege('anon', 'tradein_leads', p)`);
    expect(r.map((x) => x.p)).toEqual([]);
  });

  it('`anon` NO tiene ni una columna de LECTURA sobre tradein_leads', async () => {
    const r = await adminRows<{ c: string }>(`
      select column_name as c from information_schema.column_privileges
      where table_schema = 'public' and grantee = 'anon'
        and table_name = 'tradein_leads' and privilege_type = 'SELECT'
      order by 1`);
    expect(r.map((x) => x.c)).toEqual([]);
  });

  it('sobre `tradein_checklists`, `anon` no tiene absolutamente nada', async () => {
    const r = await adminRows<{ c: string }>(`
      select column_name || ':' || privilege_type as c from information_schema.column_privileges
      where table_schema = 'public' and grantee = 'anon' and table_name = 'tradein_checklists'`);
    expect(r.map((x) => x.c)).toEqual([]);
  });

  it('la policy es de INSERT, tiene WITH CHECK, no es `true` y mira el claim del slug', async () => {
    const r = await adminRows<{ cmd: string; qual: string | null; wc: string | null }>(`
      select cmd, qual, with_check as wc from pg_policies
      where schemaname = 'public' and policyname = 'tradein_leads_storefront_insert'`);
    expect(r).toHaveLength(1);
    expect(r[0]?.cmd).toBe('INSERT');
    const wc = r[0]?.wc ?? '';
    expect(wc).not.toBe('');
    expect(wc).not.toBe('true');
    expect(wc).toContain('storefront_tenant_id');
    // En subquery: InitPlan, una evaluación por query y no una por fila (ADR-005).
    expect(wc).toMatch(/\(\s*SELECT storefront_tenant_id/i);
    // Una policy de INSERT no tiene `USING`, y no debe tenerlo: `USING` en INSERT no se evalúa.
    expect(r[0]?.qual).toBeNull();
  });

  it('sobre tradein_leads, `anon` tiene UNA policy y es la de INSERT: ninguna de lectura', async () => {
    const r = await adminRows<{ p: string; cmd: string }>(`
      select policyname as p, cmd from pg_policies
      where schemaname = 'public' and tablename = 'tradein_leads' and 'anon' = any(roles)
      order by 1`);
    expect(r).toEqual([{ p: 'tradein_leads_storefront_insert', cmd: 'INSERT' }]);
  });

  it('los siete CHECK existen en la base con su nombre, no sólo en el .sql', async () => {
    const r = await adminRows<{ c: string }>(`
      select conname as c from pg_constraint
      where conrelid = 'public.tradein_leads'::regclass and contype = 'c' order by 1`);
    expect(r.map((x) => x.c)).toEqual([
      'tradein_leads_battery_pct_range',
      'tradein_leads_color_len',
      'tradein_leads_customer_name_len',
      'tradein_leads_customer_wa_phone_len',
      'tradein_leads_model_text_len',
      'tradein_leads_notes_len',
      'tradein_leads_storage_gb_range',
    ]);
  });

  it('la tabla lleva el porqué escrito en la propia base, no sólo en el .sql', async () => {
    const r = await adminRows<{ comment: string | null }>(
      `select obj_description('public.tradein_leads'::regclass) as comment`,
    );
    expect(r[0]?.comment ?? '').toContain('El rol anon inserta 9 columnas');
  });
});
