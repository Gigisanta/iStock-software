/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  C1–C4 · "UN NEGOCIO POR PERSONA" TIENE QUE SOBREVIVIR A DOS ALTAS SIMULTÁNEAS.
 *          POSTGRES REAL, DOS CONEXIONES, CERO MOCKS.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `CLAUDE.md` §1 (Capa 1) dice que una persona tiene **un** negocio. Hasta esta slice, la regla la
 * sostenía una sola línea de código de aplicación, y estaba **fuera** de la transacción que
 * después escribe:
 *
 *     // apps/web/app/(app)/_lib/tenants/create-tenant.ts
 *     if (await hasMembership(userId)) return { ok: false, ... };   // ← lectura, sin lock
 *     ...
 *     tenantId = await withServiceDb(async (tx) => { ...insert tenant + membership + fx + location... });
 *
 * Un `select` que corre antes de abrir la transacción que escribe **no es una garantía, es una
 * probabilidad**. Bajo Read Committed no toma ningún lock, no genera ningún conflicto de
 * escritura, y Postgres no inventa uno: dos requests de signup del mismo `user_id` leen cero filas
 * los dos, escriben los dos, y commitean los dos. Quedan dos negocios para una persona y **dos
 * slugs quemados** — `tenants_slug_key` no los suelta nunca — sin que ninguna transacción falle
 * y sin una sola línea de error en Sentry.
 *
 * ── Qué afirma este archivo (y qué NO) ────────────────────────────────────────────────────────
 * Afirma **comportamiento**: *después de dos altas concurrentes de la misma persona queda
 * exactamente un negocio*. No nombra ningún índice, ninguna constraint y ningún código de error
 * como condición de éxito. Le da lo mismo cómo `db-agent` gane la carrera —único parcial, único
 * total, constraint de exclusión, lock— mientras el conteo final sea 1. Un test que dijera
 * `expect(indexes).toContain('memberships_single_owner_per_user_key')` estaría acoplado a la
 * forma, y encima no distingue **la constraint puesta** de **la constraint que funciona**: un
 * índice único mal predicado existe en `pg_indexes` y deja pasar la carrera igual.
 *
 * Lo que sí es deliberado es **dónde** se mide. La carrera se reproduce contra la base, replicando
 * el conjunto de escrituras del alta, porque el chequeo de aplicación ya está y ya se demostró
 * insuficiente: no hay arreglo posible en TypeScript para dos procesos que leen antes de escribir.
 * Si mañana alguien "arregla" esto sólo en `createTenant()`, este archivo sigue rojo, que es
 * exactamente lo que tiene que pasar.
 *
 * ── Por qué la réplica del alta y no un import de `createTenant()` ────────────────────────────
 * `create-tenant.ts` abre con `import 'server-only'` y arrastra `next/cache`, el driver de auth y
 * `logEvent`: no entra en un runner de Node sin montar medio Next. Lo que se replica acá es el
 * **conjunto de escrituras** de su transacción, en el mismo orden, y C4 lo verifica leyendo el
 * archivo real: si `app-agent` agrega una quinta tabla al alta o mueve el chequeo adentro de la
 * transacción, C4 se pone rojo y avisa que la réplica quedó vieja. La réplica no puede
 * desincronizarse en silencio.
 *
 * ── Cómo se garantiza el entrelazado (esto es la mitad del test) ──────────────────────────────
 * Un test que abre, escribe y commitea la primera transacción antes de empezar la segunda no
 * reproduce nada: da verde el día que la constraint no está, que es el peor resultado posible.
 * Acá el entrelazado no se confía a la suerte del scheduler, se **construye y se afirma**:
 *
 *   1. **Dos conexiones físicas distintas.** Dos clientes `postgres` con `max: 1`. C2 afirma que
 *      `pg_backend_pid()` es distinto: si fueran la misma conexión, `begin` de la segunda
 *      cerraría la primera y no habría concurrencia que medir.
 *   2. **Las dos leen antes de que cualquiera escriba.** El orden queda escrito en una traza que
 *      se afirma: `B:lee` ocurre antes de `A:escribe` y antes de `A:commit`.
 *   3. **Las dos transacciones están abiertas al mismo tiempo**, y eso lo dice Postgres, no el
 *      test: una tercera conexión de operador consulta `pg_stat_activity` y las ve a las dos en
 *      `idle in transaction` en el mismo instante.
 *   4. **Las dos commitean después de las dos lecturas.**
 *
 * C3 sube la apuesta: las dos escrituras salen **al mismo tiempo** desde una barrera, sin orden
 * impuesto. Es el caso real (dos requests, dos handlers) y no depende de quién gane.
 *
 * ── Reloj: no hay ────────────────────────────────────────────────────────────────────────────
 * Ni un `sleep`. La sincronización es por promesa (barrera) y por orden de `await`. Esperar por
 * milisegundos es cómo se fabrica un test intermitente, y un test de invariante intermitente se
 * termina borrando.
 *
 * `qa-agent` no arregla el código bajo test para poner un test en verde, y el owner del paquete no
 * edita este archivo para tapar un fallo (`CLAUDE.md` §4). Si esto se pone rojo, el defecto es del
 * código hasta que se demuestre lo contrario.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

// ── Conexión ────────────────────────────────────────────────────────────────────────────────
// Mismo default que `packages/db/src/env.ts`, replicado a mano a propósito: el test no debe poder
// "pasar" porque alguien cambió el borde de env del paquete que está bajo test.
const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/istock_dev';
const AQUI = dirname(fileURLToPath(import.meta.url));
const MIGRACIONES = resolve(AQUI, '../packages/db/drizzle');
const FUENTE_DEL_ALTA = resolve(AQUI, '../apps/web/app/(app)/_lib/tenants/create-tenant.ts');

/**
 * Escape hatch de una sola dirección: saltea el `migrate()` de conveniencia y corre contra la base
 * tal cual está. Existe para poder **demostrar este test rojo** contra el estado anterior a la
 * implementación (una base migrada hasta la migración previa), que es el único momento en que un
 * test de invariante prueba algo.
 *
 * No puede usarse para aflojar nada: saltear migraciones sólo puede dejar la base con *menos*
 * schema, y con menos schema este archivo falla más, nunca menos. Si las tablas del alta no
 * existen, `beforeAll` corta con un mensaje explícito en vez de dejar que el fallo aparezca
 * disfrazado de "encontré 0 negocios".
 */
const SALTEAR_MIGRACIONES = process.env['ISTOCK_TEST_SKIP_MIGRATE'] === '1';

// ── Fixture ─────────────────────────────────────────────────────────────────────────────────
// Bloque `f…` propio de este archivo, para no pisar los UUIDs de `rls-cross-tenant.test.ts`.
/** La persona que aprieta "Crear negocio" dos veces. Es **una sola**, y ése es todo el punto. */
const PERSONA = '00000000-0000-4000-9000-0000000000f1';
const EMAIL = 'carrera@qa-alta.local';

/** Los dos slugs que se disputan. Distintos a propósito: `tenants_slug_key` NO es lo que se está
 *  probando acá. Si los dos altas usaran el mismo slug, la carrera la ganaría el único del slug y
 *  este archivo estaría midiendo una regla que ya existe desde la migración 0000. */
const SLUG_UNO = 'qa-carrera-uno';
const SLUG_DOS = 'qa-carrera-dos';

/** El TC que tipea el dueño en el alta, en la forma en que lo guarda la columna: `numeric(12,2)`. */
const TC_ARS_POR_USD = '1487.50';
const TELEFONO_WA = '5492995550777';

/**
 * Un intento de alta que llegó al final, o el motivo por el que no llegó. `code` es el `SQLSTATE`
 * crudo de Postgres: el test **no** exige ninguno en particular (ver el docblock), pero lo guarda
 * para que el reporte de un fallo diga qué pasó de verdad.
 */
type ResultadoDeAlta =
  | { readonly ok: true; readonly slug: string; readonly tenantId: string }
  | { readonly ok: false; readonly slug: string; readonly code: string; readonly message: string };

// ── Barrera: sincronización por promesa, nunca por reloj ────────────────────────────────────
/** Devuelve una función que bloquea hasta que la llamaron `cupos` veces. Sin timers: el
 *  entrelazado es determinista y no depende de cuán rápido esté hoy la máquina. */
function crearBarrera(cupos: number): () => Promise<void> {
  let pendientes = cupos;
  let abrir: () => void = () => {};
  const abierta = new Promise<void>((resolver) => {
    abrir = resolver;
  });
  return async (): Promise<void> => {
    pendientes -= 1;
    if (pendientes <= 0) abrir();
    await abierta;
  };
}

// ── Una sesión de alta = una conexión física + una transacción manejada a mano ──────────────
/**
 * `postgres.js` con `max: 1` da **una** conexión física por cliente, y `begin`/`commit` se emiten
 * a mano para poder parar la transacción en el medio. `sql.begin()` no sirve acá: encapsula el
 * ciclo entero y no deja meter la lectura de la otra sesión entre medio, que es justamente el
 * fenómeno bajo prueba.
 *
 * `statement_timeout` acotado: si una implementación futura resuelve la carrera con un lock que
 * nunca suelta, quiero un fallo rápido y legible, no una suite colgada hasta el timeout de vitest.
 */
interface SesionDeAlta {
  readonly nombre: string;
  pid: () => Promise<number>;
  abrirTransaccion: () => Promise<void>;
  yaTieneNegocio: () => Promise<boolean>;
  escribirNegocio: (slug: string) => Promise<string>;
  commit: () => Promise<void>;
  deshacerSiSigueAbierta: () => Promise<void>;
  cerrar: () => Promise<void>;
}

function abrirSesionDeAlta(nombre: string): SesionDeAlta {
  const sql = postgres(DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });

  return {
    nombre,

    pid: async (): Promise<number> => {
      const filas = (await sql.unsafe(`select pg_backend_pid() as pid`)) as unknown as { pid: number }[];
      return filas[0]?.pid ?? -1;
    },

    abrirTransaccion: async (): Promise<void> => {
      await sql.unsafe(`begin`);
      await sql.unsafe(`set local statement_timeout = '8s'`);
    },

    /**
     * La réplica exacta de `hasMembership()`: `select id from memberships where user_id = … limit 1`.
     * Sin `for update`, sin lock, sin claim — así corre hoy en producción, desde `withServiceDb`.
     */
    yaTieneNegocio: async (): Promise<boolean> => {
      const filas = (await sql.unsafe(
        `select id from memberships where user_id = '${PERSONA}' limit 1`,
      )) as unknown as { id: string }[];
      return filas.length > 0;
    },

    /**
     * Las cuatro filas del alta, en el mismo orden que `createTenant()`: tenant → membresía owner
     * → `fx_settings` → punto de retiro. El orden importa: es el que decide qué escritura choca
     * primero cuando la base sí sostiene la regla.
     */
    escribirNegocio: async (slug: string): Promise<string> => {
      const insertado = (await sql.unsafe(`
        insert into tenants (slug, name, wa_phone, accepts_trade_in, plan, status, trial_ends_at)
        values ('${slug}', 'Negocio ${nombre}', '${TELEFONO_WA}', false, 'trial', 'active', now() + interval '14 days')
        returning id`)) as unknown as { id: string }[];
      const tenantId = insertado[0]?.id;
      if (tenantId === undefined) throw new Error('insert de tenant sin fila devuelta');

      await sql.unsafe(`
        insert into memberships (tenant_id, user_id, role, accepted_at)
        values ('${tenantId}', '${PERSONA}', 'owner', now())`);

      await sql.unsafe(`
        insert into fx_settings (tenant_id, ars_per_usd, rounding, updated_by)
        values ('${tenantId}', ${TC_ARS_POR_USD}, 'ceil_1000', '${PERSONA}')`);

      await sql.unsafe(`
        insert into locations (tenant_id, name, address, hours, is_active, sort_order)
        values ('${tenantId}', 'A coordinar por WhatsApp', 'Escribinos y arreglamos dónde te lo entregamos',
                'Todos los días, por WhatsApp', true, 0)`);

      return tenantId;
    },

    commit: async (): Promise<void> => {
      await sql.unsafe(`commit`);
    },

    deshacerSiSigueAbierta: async (): Promise<void> => {
      try {
        await sql.unsafe(`rollback`);
      } catch {
        // Ya estaba cerrada. Que el `rollback` sobre.
      }
    },

    cerrar: async (): Promise<void> => {
      await sql.end({ timeout: 5 });
    },
  };
}

/** El alta en dos mitades, porque el entrelazado vive justo entre las dos. */

/**
 * Mitad 1: abrir la transacción y correr el chequeo de `createTenant()`. Devuelve `true` si la
 * persona **puede** seguir (leyó "no tenés negocio"), que es lo que las dos sesiones ven en la
 * carrera.
 */
async function abrirYChequear(sesion: SesionDeAlta, traza: string[]): Promise<boolean> {
  await sesion.abrirTransaccion();
  traza.push(`${sesion.nombre}:abre`);
  const ocupado = await sesion.yaTieneNegocio();
  traza.push(`${sesion.nombre}:${ocupado ? 'lee-ocupado' : 'lee-libre'}`);
  return !ocupado;
}

/**
 * Mitad 2: las cuatro escrituras y el commit. Devuelve el resultado en vez de tirar, porque **el
 * que pierde la carrera perdiéndola es el comportamiento correcto** y eso no es un fallo del test.
 */
async function escribirYCommitear(sesion: SesionDeAlta, slug: string, traza: string[]): Promise<ResultadoDeAlta> {
  try {
    const tenantId = await sesion.escribirNegocio(slug);
    traza.push(`${sesion.nombre}:escribe`);
    await sesion.commit();
    traza.push(`${sesion.nombre}:commit`);
    return { ok: true, slug, tenantId };
  } catch (capturado) {
    const fallo = capturado as { code?: string; message?: string };
    traza.push(`${sesion.nombre}:rechazado(${fallo.code ?? 'SIN_CODIGO'})`);
    await sesion.deshacerSiSigueAbierta();
    return { ok: false, slug, code: fallo.code ?? 'SIN_CODIGO', message: fallo.message ?? String(capturado) };
  }
}

/**
 * El alta completa de punta a punta, tal como la ejecuta el server: chequeo → transacción →
 * commit. `antesDeEscribir` es el punto de entrelazado: ahí se cuelga la barrera. La lectura ya
 * ocurrió cuando se lo llama.
 */
async function intentarAlta(
  sesion: SesionDeAlta,
  slug: string,
  traza: string[],
  antesDeEscribir: () => Promise<void>,
): Promise<ResultadoDeAlta> {
  if (!(await abrirYChequear(sesion, traza))) {
    await sesion.deshacerSiSigueAbierta();
    return { ok: false, slug, code: 'APP_YA_TIENE_NEGOCIO', message: 'Ya tenés un negocio creado.' };
  }
  await antesDeEscribir();
  return escribirYCommitear(sesion, slug, traza);
}

/** El índice de un paso en la traza, con un fallo legible si el paso nunca ocurrió. */
function paso(traza: string[], nombre: string): number {
  const indice = traza.indexOf(nombre);
  if (indice < 0) throw new Error(`el paso "${nombre}" no ocurrió · traza=${traza.join(' → ')}`);
  return indice;
}

// ── Conexión de operador: monta el fixture y hace de testigo ────────────────────────────────
const operador = postgres(DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });

async function filasDeOperador<T>(texto: string): Promise<T[]> {
  return (await operador.unsafe(texto)) as unknown as T[];
}

/** Cuántos negocios POSEE la persona. Es la afirmación del archivo, y se pregunta por el camino
 *  que le importa al producto: la membresía de propiedad, no la tabla de tenants. */
async function negociosDeLaPersona(): Promise<number> {
  const filas = await filasDeOperador<{ n: string }>(`
    select count(*) as n
    from memberships m
    join tenants t on t.id = m.tenant_id
    where m.user_id = '${PERSONA}' and m.role = 'owner'`);
  return Number(filas[0]?.n ?? -1);
}

/** Los slugs que quedaron efectivamente quemados. Un "arreglo" que hace fallar la membresía pero
 *  deja el tenant commiteado sigue quemando el subdominio para siempre: eso también es el bug. */
async function slugsQuemados(): Promise<string[]> {
  const filas = await filasDeOperador<{ slug: string }>(
    `select slug from tenants where slug in ('${SLUG_UNO}', '${SLUG_DOS}') order by slug`,
  );
  return filas.map((f) => f.slug);
}

async function limpiarFixture(): Promise<void> {
  // `on delete cascade` de `tenants` se lleva membresías, fx y puntos de retiro.
  await operador.unsafe(`delete from tenants where slug in ('${SLUG_UNO}', '${SLUG_DOS}')`);
  await operador.unsafe(`delete from memberships where user_id = '${PERSONA}'`);
}

beforeAll(async () => {
  if (!SALTEAR_MIGRACIONES) {
    const migrador = postgres(DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
    try {
      await migrate(drizzle(migrador), { migrationsFolder: MIGRACIONES });
    } finally {
      await migrador.end({ timeout: 5 });
    }
  }

  // Que la base esté migrada no se supone: si falta una de las cuatro tablas del alta, el fallo
  // tiene que decir eso y no disfrazarse de "encontré 0 negocios".
  const faltantes = await filasDeOperador<{ t: string }>(`
    select t from unnest(array['tenants','memberships','fx_settings','locations']) as t
    where to_regclass('public.' || t) is null`);
  if (faltantes.length > 0) {
    throw new Error(
      `la base de ${DATABASE_URL} no tiene las tablas del alta: ${faltantes.map((f) => f.t).join(', ')}. ` +
        `Corré \`pnpm db:local\` y \`pnpm --filter @istock/db migrate\`.`,
    );
  }

  await limpiarFixture();
  await operador.unsafe(
    `insert into auth.users (id, email) values ('${PERSONA}', '${EMAIL}') on conflict (id) do nothing`,
  );
});

afterEach(async () => {
  await limpiarFixture();
});

afterAll(async () => {
  await limpiarFixture();
  await operador.unsafe(`delete from auth.users where id = '${PERSONA}'`);
  await operador.end({ timeout: 5 });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('C1 · control positivo: sin esto, "queda un solo negocio" sería verde por vacío', () => {
  it('un alta sola deja el negocio con sus cuatro filas: tenant, dueño, tipo de cambio y punto de retiro', async () => {
    const sesion = abrirSesionDeAlta('sola');
    const traza: string[] = [];
    try {
      const resultado = await intentarAlta(sesion, SLUG_UNO, traza, async () => {});
      expect(resultado.ok).toBe(true);
    } finally {
      await sesion.cerrar();
    }

    expect(await negociosDeLaPersona()).toBe(1);
    expect(await slugsQuemados()).toEqual([SLUG_UNO]);

    const filas = await filasDeOperador<{ tabla: string; n: string }>(`
      select 'memberships' as tabla, count(*) as n from memberships m
        join tenants t on t.id = m.tenant_id where t.slug = '${SLUG_UNO}'
      union all
      select 'fx_settings', count(*) from fx_settings f
        join tenants t on t.id = f.tenant_id where t.slug = '${SLUG_UNO}'
      union all
      select 'locations', count(*) from locations l
        join tenants t on t.id = l.tenant_id where t.slug = '${SLUG_UNO}'
      order by 1`);
    expect(filas.map((f) => `${f.tabla}=${f.n}`)).toEqual(['fx_settings=1', 'locations=1', 'memberships=1']);
  });

  it('la segunda alta de la misma persona, hecha una vez terminada la primera, se rechaza', async () => {
    const primera = abrirSesionDeAlta('primera');
    const segunda = abrirSesionDeAlta('segunda');
    const traza: string[] = [];
    try {
      expect((await intentarAlta(primera, SLUG_UNO, traza, async () => {})).ok).toBe(true);
      // Sin concurrencia: la segunda empieza a leer cuando la primera YA commiteó. Este es el
      // caso que el chequeo de aplicación sí cubre, y por eso NO prueba nada sobre la carrera.
      expect((await intentarAlta(segunda, SLUG_DOS, traza, async () => {})).ok).toBe(false);
    } finally {
      await primera.cerrar();
      await segunda.cerrar();
    }

    expect(await negociosDeLaPersona()).toBe(1);
    expect(await slugsQuemados()).toEqual([SLUG_UNO]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('C2 · dos altas concurrentes de la misma persona dejan un solo negocio', () => {
  it('si las dos leen "no tenés negocio" antes de que cualquiera escriba, igual queda un solo negocio y un solo slug quemado', async () => {
    const a = abrirSesionDeAlta('A');
    const b = abrirSesionDeAlta('B');
    const traza: string[] = [];
    let resultados: ResultadoDeAlta[] = [];
    let pids: number[] = [];
    let abiertasALaVez = 0;

    try {
      // (1) Dos conexiones FÍSICAS distintas. Si fueran la misma, el `begin` de B cerraría la
      //     transacción de A y no habría nada concurrente que medir.
      pids = [await a.pid(), await b.pid()];

      // (2) El entrelazado, paso por paso y sin depender del scheduler: A abre y lee; recién
      //     después B abre y lee; y sólo entonces alguien escribe. La lectura de B ocurre ANTES
      //     de la primera escritura de A y antes de su commit, que es la condición exacta que
      //     hace posible la carrera en producción.
      const aPuedeSeguir = await abrirYChequear(a, traza);
      const bPuedeSeguir = await abrirYChequear(b, traza);
      expect(aPuedeSeguir, 'A no leyó "no tenés negocio": el fixture arrancó sucio').toBe(true);
      expect(bPuedeSeguir, 'B no leyó "no tenés negocio" antes de que A escribiera: no hay carrera').toBe(true);

      // (3) Testigo: con las dos transacciones abiertas y ninguna escritura hecha todavía, una
      //     tercera conexión las ve a las dos vivas en el mismo instante. Lo dice Postgres, no el
      //     test.
      const vivas = await filasDeOperador<{ n: string }>(`
        select count(*) as n from pg_stat_activity
        where pid in (${pids.join(', ')}) and state = 'idle in transaction'`);
      abiertasALaVez = Number(vivas[0]?.n ?? 0);

      // (4) Las dos escriben y commitean, en ese orden. B tiene toda la información que la base
      //     necesita para rechazarlo: A ya está commiteado cuando B intenta.
      const resultadoA = await escribirYCommitear(a, SLUG_UNO, traza);
      const resultadoB = await escribirYCommitear(b, SLUG_DOS, traza);
      resultados = [resultadoA, resultadoB];
    } finally {
      await a.cerrar();
      await b.cerrar();
    }

    // El entrelazado no se declara en un comentario: se afirma.
    expect(pids[0]).not.toBe(pids[1]);
    expect(abiertasALaVez).toBe(2);
    expect(traza.slice(0, 4)).toEqual(['A:abre', 'A:lee-libre', 'B:abre', 'B:lee-libre']);
    expect(paso(traza, 'B:lee-libre')).toBeLessThan(paso(traza, 'A:escribe'));
    expect(paso(traza, 'B:lee-libre')).toBeLessThan(paso(traza, 'A:commit'));

    // Y la regla de negocio, que es lo único que este archivo promete.
    const detalle = `traza=${traza.join(' → ')} · resultados=${JSON.stringify(resultados)}`;
    expect(await negociosDeLaPersona(), `dos altas concurrentes dejaron más de un negocio · ${detalle}`).toBe(1);
    expect(await slugsQuemados(), `quedó un slug quemado de más · ${detalle}`).toEqual([SLUG_UNO]);
    expect(resultados.filter((r) => r.ok), `ganaron las dos altas · ${detalle}`).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('C3 · el caso real: las dos altas escriben al mismo tiempo, sin orden impuesto', () => {
  it('con las dos escrituras saliendo a la vez, gana una sola y la persona termina con un negocio', async () => {
    const a = abrirSesionDeAlta('A');
    const b = abrirSesionDeAlta('B');
    const traza: string[] = [];
    let resultados: ResultadoDeAlta[] = [];

    try {
      // Las dos leen; la barrera las retiene; las dos escriben en el mismo tick. Quién gana lo
      // decide Postgres, no el test — que es exactamente la situación de dos requests HTTP.
      const todasLeyeron = crearBarrera(2);
      resultados = await Promise.all([
        intentarAlta(a, SLUG_UNO, traza, todasLeyeron),
        intentarAlta(b, SLUG_DOS, traza, todasLeyeron),
      ]);
    } finally {
      await a.cerrar();
      await b.cerrar();
    }

    const detalle = `traza=${traza.join(' → ')} · resultados=${JSON.stringify(resultados)}`;
    // Las dos leyeron "libre" antes de que cualquiera escribiera: si esto no se cumple, el test no
    // reprodujo la carrera y cualquier verde de abajo sería mentira. La barrera es lo que lo
    // garantiza; esta aserción es lo que lo demuestra.
    expect(
      traza.filter((evento) => evento.endsWith(':lee-libre')),
      `las dos altas tenían que leer "no tenés negocio" · ${detalle}`,
    ).toHaveLength(2);
    const ultimaLectura = Math.max(paso(traza, 'A:lee-libre'), paso(traza, 'B:lee-libre'));
    const primerDesenlace = traza.findIndex(
      (evento) => evento.endsWith(':escribe') || evento.includes(':rechazado('),
    );
    expect(ultimaLectura, `alguien escribió antes de que las dos leyeran · ${detalle}`).toBeLessThan(
      primerDesenlace,
    );

    expect(await negociosDeLaPersona(), `la persona quedó con más de un negocio · ${detalle}`).toBe(1);
    expect(await slugsQuemados(), `quedó más de un slug quemado · ${detalle}`).toHaveLength(1);
    expect(resultados.filter((r) => r.ok), `ganaron las dos altas · ${detalle}`).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('C4 · la carrera que se reproduce acá sigue siendo la del alta real', () => {
  /** El cuerpo de `createTenant()`, desde su firma hasta el final del archivo. */
  function cuerpoDeCreateTenant(): string {
    const fuente = readFileSync(FUENTE_DEL_ALTA, 'utf8');
    const desde = fuente.indexOf('export async function createTenant(');
    if (desde < 0) {
      throw new Error(`no encontré \`createTenant(\` en ${FUENTE_DEL_ALTA}: la réplica quedó vieja`);
    }
    return fuente.slice(desde);
  }

  it('el alta real escribe exactamente las cuatro tablas que replica este archivo, y en ese orden', () => {
    const cuerpo = cuerpoDeCreateTenant();
    const tablas = [...cuerpo.matchAll(/\.insert\((\w+)\)/gu)].map((m) => m[1]);
    expect(tablas, 'cambió el conjunto de escrituras del alta: actualizá la réplica de este archivo').toEqual([
      'tenants',
      'memberships',
      'fxSettings',
      'locations',
    ]);
  });

  it('el chequeo de "ya tenés un negocio" sigue leyendo fuera de la transacción que después escribe', () => {
    const cuerpo = cuerpoDeCreateTenant();
    const chequeo = cuerpo.indexOf('hasMembership(userId)');
    const transaccion = cuerpo.indexOf('withServiceDb(');
    expect(chequeo, 'desapareció el chequeo de membresía del alta: revisá si esta carrera sigue existiendo').toBeGreaterThanOrEqual(0);
    expect(transaccion, 'el alta ya no abre transacción: la réplica de este archivo quedó vieja').toBeGreaterThan(0);
    // Si algún día el chequeo entra a la transacción, este test avisa: la carrera cambia de forma
    // y hay que volver a mirarla, no dejarla correr con la réplica vieja.
    expect(chequeo, 'el chequeo se movió adentro de la transacción: re-evaluá la carrera').toBeLessThan(transaccion);
  });
});
