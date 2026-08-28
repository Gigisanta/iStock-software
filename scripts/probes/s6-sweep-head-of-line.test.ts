/**
 * PROBE DEL LEAD PARA S6 — el barrido no puede quedarse trabado detrás de una fila rota.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *  El defecto que esta probe existe para que no vuelva
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Hasta S6 el barrido tomaba `where status='active' and expires_at <= now() order by expires_at asc
 * limit 200` y cerraba fila por fila, con el `try/catch` **adentro** del `for`. Una fila que falla
 * hace rollback y queda `active` con el **mismo `expires_at`**: o sea que sigue siendo la más vieja,
 * o sea que vuelve a ser la primera del lote en la corrida siguiente. Y en la siguiente. Con el lote
 * lleno de filas igual de tóxicas, las sanas que vienen atrás **no se procesan nunca**, y el
 * endpoint sigue devolviendo `200 OK`.
 *
 * El modo de falla real de este producto no son "200 filas rotas independientes" —eso no pasa—: es
 * una **causa sistémica que envenena todas las filas de una vez**. Un `GRANT` faltante (`42501`, el
 * que `CLAUDE.md` §3 dice que "aparece el día que se prende el cron"), una migración editada después
 * de aplicada, un `CHECK` nuevo en `listing_events`. En esa forma no hay una unidad trabada: están
 * trabadas todas, en todos los tenants, y la vidriera de cada uno dice «Reservado» sobre stock que
 * está libre. Del lado del cliente eso no se factura: se cancela.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *  Por qué esta probe usa Postgres de verdad, y no el `tx` de mentira
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * La especificación que recibí decía "con el fake `tx` alcanza". **No alcanza, y esa es la parte
 * importante de este archivo.** La primera de las tres piezas del arreglo es
 * `order by sweep_attempts asc, expires_at asc`, y un `tx` de mentira devuelve las filas en el orden
 * en que se las metí: no hay nada del `order by` que pueda medir. Un fake que ignora el ordenamiento
 * y después "verifica el ordenamiento" es exactamente la familia de gates que ADR-020 vino a cerrar
 * —afirma una conducta y ejecuta otra cosa—, sólo que con un mock en lugar de un grep.
 *
 * Acá ordena Postgres. La única pieza de mentira es **de dónde sale el pool** (ver el mock de
 * `connection`), porque el módulo memoiza y no expone con qué cerrarlo; el `select`, el `order by`,
 * el techo del `where`, el rollback de la transacción que falla y el `+1` que sobrevive a ese
 * rollback son todos reales.
 *
 * El veneno también es real y tiene la forma del modo sistémico: un `CHECK` sobre `listing_events`
 * que rechaza a ciertos listings con `23514`. Es la misma clase de causa que el docblock de
 * `expire-reservations.ts` nombra, y entra por donde entraría de verdad: la tercera escritura de la
 * transacción, cuando las dos primeras ya pasaron.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *  Por qué vive en `scripts/probes/` y no en `apps/web`
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `CLAUDE.md` §4: la auditoría de referencia —la afirmación que un gate cita y que queda parada
 * entre un barrido aflojado y un merge— **no puede ser del writer del código auditado**.
 * `_lib/reservations/expire-reservations.test.ts` es de `app-agent`, igual que el barrido: es su red
 * de regresión y está bien que exista, pero si `accept-s6.sh` lo citara como evidencia, `app-agent`
 * estaría firmando su propio certificado. Y hay un motivo concreto además del formal: ese archivo
 * probó durante toda una fase que el barrido era idempotente y correcto **por fila**, que es cierto,
 * mientras el barrido entero estaba trabado. Cobertura que tranquiliza sobre el eje equivocado.
 *
 * Esta probe audita a dos columnas a la vez —el barrido (`app-agent`) y la columna
 * `sweep_attempts` con sus privilegios (`db-agent`)— así que no puede ser de ninguna de las dos.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/** Ninguna de las dos es lo que se mide, y las dos hablan con Next fuera de un request. */
vi.mock('../../apps/web/app/(app)/_lib/tenants/storefront-cache', () => ({
  invalidateStorefront: vi.fn(),
  invalidateStorefrontUnit: vi.fn(),
  invalidateListing: vi.fn(),
}));
/**
 * El logger no se silencia: se **anota**. La version anterior lo mockeaba con dos `vi.fn()` y por
 * eso las lineas del barrido no existian en ningun lado — un espia sobre `console.error` capturaba
 * cero y el conteo del caso G medía la nada. Es la misma familia de defecto que esta probe audita:
 * una medicion que da 0 porque el sujeto esta apagado, no porque el sujeto no haya hecho nada.
 *
 * `vi.hoisted` porque el array tiene que existir antes que el factory, y **compartido** porque los
 * casos F y G hacen `vi.resetModules()`: sin eso el factory vuelve a correr y cada re-import se
 * lleva su propio `vi.fn()`, con lo cual el test miraria un mock y el barrido escribiria en otro.
 */
const registroLogs = vi.hoisted(() => [] as { event: string; fields: Record<string, unknown> }[]);
vi.mock('../../apps/web/app/(app)/_lib/log', () => ({
  logEvent: (event: string, fields: Record<string, unknown> = {}) => {
    registroLogs.push({ event, fields });
  },
  logError: (event: string, code: string, fields: Record<string, unknown> = {}) => {
    registroLogs.push({ event, fields: { code, ...fields } });
  },
}));

/**
 * Lo ÚNICO de mentira del camino a la base: de dónde sale el pool.
 *
 * `_lib/db/connection.ts` memoiza el `Database` a nivel de módulo y **no devuelve con qué cerrarlo**
 * —correcto para una función de Vercel, que quiere reusar el socket entre requests, y sin salida
 * para un test, que termina y deja el proceso colgado. Se reemplaza el proveedor del pool por uno
 * que este archivo sí puede cerrar. `withServiceDb()`, su `transaction()`, el `select`, el
 * `order by`, los `update` y el rollback siguen siendo los reales.
 */
const { cliente, base } = await vi.hoisted(async () => {
  const { userInfo: quien } = await import('node:os');
  const url =
    process.env.DATABASE_URL ??
    `postgresql://${quien().username}@localhost:5432/${process.env.ISTOCK_DB ?? 'istock_dev'}`;
  // El barrido resuelve su URL por `serverEnv()`, que memoiza: se setea ANTES de cualquier import.
  process.env.DATABASE_URL = url;

  const { default: pg } = await import('postgres');
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const c = pg(url, { max: 1, prepare: false, onnotice: () => {} });
  return { cliente: c, base: drizzle(c) };
});

vi.mock('../../apps/web/app/(app)/_lib/db/connection', () => ({ db: () => base }));

const { EXPIRE_BATCH_SIZE, MAX_SWEEP_ATTEMPTS, expireDueReservations } = await import(
  '../../apps/web/app/(app)/_lib/reservations/expire-reservations'
);

/** Prefijo de los uuid de listing que el `CHECK` de abajo rechaza. Es el veneno. */
const VENENO = 'ffff';
const TENANT_SLUG = 'probe-head-of-line';

let tenantId = '';

/** Un uuid que el `CHECK` NO rechaza. El re-roll es 1 en 65.536 y no tener guard es un flake. */
function uuidSano(): string {
  let id = randomUUID();
  while (id.startsWith(VENENO)) id = randomUUID();
  return id;
}

/** Un uuid que el `CHECK` SÍ rechaza, distinto en cada llamada. */
function uuidVenenoso(n: number): string {
  return `${VENENO}ffff-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

interface Fila {
  readonly listingId: string;
  readonly reservationId: string;
}

/**
 * Crea una unidad `reserved` con una reserva `active` ya vencida.
 *
 * `venceHace` en minutos: cuanto más grande, más vieja la reserva, o sea más adelante en el
 * `order by expires_at asc`.
 */
async function unidadVencida(listingId: string, venceHace: number, attempts = 0): Promise<Fila> {
  const reservationId = uuidSano();
  await cliente`
    insert into listings (id, tenant_id, slug, title, condition, price_usd, status)
    values (${listingId}::uuid, ${tenantId}::uuid, ${`u-${listingId.slice(0, 8)}-${venceHace}`},
            'Probe head-of-line', 'used_excellent', 100, 'reserved')`;
  await cliente`
    insert into reservations (id, tenant_id, listing_id, status, minutes, expires_at, sweep_attempts)
    values (${reservationId}::uuid, ${tenantId}::uuid, ${listingId}::uuid, 'active', 60,
            now() - (${venceHace} || ' minutes')::interval, ${attempts})`;
  return { listingId, reservationId };
}

async function estado(reservationId: string): Promise<{ status: string; attempts: number }> {
  const [row] = await cliente<{ status: string; sweep_attempts: number }[]>`
    select status, sweep_attempts from reservations where id = ${reservationId}::uuid`;
  if (row === undefined) throw new Error(`la reserva ${reservationId} desapareció del fixture`);
  return { status: row.status, attempts: row.sweep_attempts };
}

/**
 * ── El parte de la corrida, y por que el gate no puede conformarse con el exit code ────────────
 *
 * `accept-s6.sh` citaba esta probe por su `exit 0`, y eso no alcanza: una probe que dejara de armar
 * el fixture —un `beforeEach` que borra de mas, un `EXPIRE_BATCH_SIZE` que se va a 0— sigue saliendo
 * 0 con las aserciones ejecutadas sobre la nada. Es el mismo modo de falla que `accept-fase3.sh`
 * tuvo con su conteo de paquetes clavado: verde por coincidencia, sobre cero medicion.
 *
 * Cada caso deja su numero aca y `afterAll` lo imprime en UNA linea. El gate parsea esa linea y
 * compara cada campo contra un literal escrito en el shell, o sea en otro archivo y en otro
 * lenguaje: para que el gate mienta hay que romper la probe Y el gate a la vez, en la misma
 * direccion. Mismo contrato que `MEDIDO s6 reserva` y `MEDIDO s6 radio` ya tienen en V8 y V9.
 *
 * `ausente` es -1 y no 0 a proposito: un caso que no corrio tiene que distinguirse de uno que
 * midio cero, porque `skipped_sobre_vencidas=0` es un PASS y `sin medir` es un FAIL.
 */
const medido: Record<string, number> = {
  corridas: 0,
  envenenadas: -1,
  sanas: -1,
  sanas_vencidas_c2: -1,
  intentos_tras_fallo: -1,
  reintento_tras_recuperarse: -1,
  tope: MAX_SWEEP_ATTEMPTS,
  abandonadas_en_el_tope: -1,
  unrecorded: -1,
  skipped_sobre_vencidas: -1,
  status_base_sana: -1,
  status_con_abandonada: -1,
  status_primer_fallo: -1,
  status_segundo_fallo: -1,
  lineas_log_por_envenenada: -1,
  lineas_cuarentena_por_envenenada: -1,
};

/**
 * Cuenta las corridas de verdad: si un caso deja de invocar el barrido, `corridas` lo delata.
 * Cuenta las invocaciones **directas**; el caso F entra por el handler HTTP y no pasa por acá, que
 * es lo que se quiere: F mide el status del cron, no el barrido.
 */
async function barrer(): ReturnType<typeof expireDueReservations> {
  medido.corridas = (medido.corridas ?? 0) + 1;
  return expireDueReservations(new Date());
}

beforeAll(async () => {
  // Que la base no esté levantada es FAIL, no skip: sin medición no hay PASS (ADR-020). El mensaje
  // dice cómo levantarla porque un gate que falla sin decir qué hacer se termina comentando.
  try {
    await cliente`select 1`;
  } catch (error) {
    throw new Error(
      `no hay Postgres en ${process.env.DATABASE_URL ?? '(sin DATABASE_URL)'}. Esta probe mide el ` +
        '`order by` del barrido, y eso sólo lo puede contestar la base: con un `tx` de mentira las ' +
        'filas vuelven en el orden en que se las metí y la aserción no mide nada. Levantala con ' +
        `\`pnpm db:local\`. Causa: ${String(error)}`,
    );
  }

  await cliente`delete from tenants where slug = ${TENANT_SLUG}`;
  const [t] = await cliente<{ id: string }[]>`
    insert into tenants (slug, name, wa_phone) values (${TENANT_SLUG}, 'Probe HOL', '5490000000000')
    returning id`;
  tenantId = t?.id ?? '';
  expect(tenantId, 'no se pudo crear el tenant del fixture').not.toBe('');

  /**
   * El veneno. Un `CHECK` sobre `listing_events` que rechaza a los listings `ffff…` con `23514`.
   *
   * Entra por la TERCERA escritura de la transacción del barrido, cuando el `update` de `listings` y
   * el de `reservations` ya pasaron: así el rollback tiene algo que deshacer y la fila vuelve a
   * quedar `active` con su `expires_at` intacto, que es la condición exacta del head-of-line.
   */
  await cliente.unsafe(`alter table listing_events drop constraint if exists probe_hol_poison`);
  await cliente.unsafe(
    `alter table listing_events add constraint probe_hol_poison
       check (listing_id::text not like '${VENENO}%')`,
  );
});

afterAll(async () => {
  await cliente.unsafe(`alter table listing_events drop constraint if exists probe_hol_poison`);
  await cliente.unsafe(`drop trigger if exists probe_hol_no_bump on reservations`);
  await cliente.unsafe(`drop function if exists probe_hol_no_bump()`);
  if (tenantId !== '') await cliente`delete from tenants where id = ${tenantId}::uuid`;
  // Se imprime SIEMPRE, tambien cuando un caso fallo: el gate tiene que poder distinguir "no
  // midio" de "midio mal", y un parte que solo sale en verde no distingue nada.
  console.log(
    'MEDIDO cron barrido · ' +
      Object.entries(medido)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(' · '),
  );
  await cliente.end({ timeout: 5 });
});

beforeEach(async () => {
  await cliente`delete from listings where tenant_id = ${tenantId}::uuid`;
});

describe('S6 · el barrido no se traba detrás de una fila rota', () => {
  /**
   * ── A · LA aserción de la slice ─────────────────────────────────────────────────────────────
   *
   * El lote entero envenenado y **una** reserva sana, más nueva que todas (o sea última en
   * `expires_at asc`, o sea la que no entra al lote). Se corre el barrido dos veces y se cuenta una
   * sola cosa: **cuántas sanas venció la corrida 2**.
   *
   * Antes del arreglo vale 0 y vale 0 para siempre. Tiene que valer 1.
   */
  it('con el lote lleno de filas que fallan, la reserva sana igual vence en la SEGUNDA corrida', async () => {
    const venenosas: Fila[] = [];
    for (let i = 0; i < EXPIRE_BATCH_SIZE; i += 1) {
      // Todas más viejas que la sana: 500 minutos para arriba.
      venenosas.push(await unidadVencida(uuidVenenoso(i), 500 + i));
    }
    const sanas = [await unidadVencida(uuidSano(), 1)];
    const sana = sanas[0]!;
    medido.envenenadas = venenosas.length;
    medido.sanas = sanas.length;

    const corrida1 = await barrer();

    // El fixture tiene que ser fiel ANTES de que la aserción signifique algo: si la sana hubiera
    // entrado al lote de la corrida 1, esto no estaría midiendo head-of-line, estaría midiendo nada.
    expect(
      corrida1.scanned,
      'el lote de la primera corrida no vino lleno de filas venenosas: el fixture no reproduce el ' +
        'defecto y lo que venga después es decorado.',
    ).toBe(EXPIRE_BATCH_SIZE);
    expect(corrida1.failed, 'las venenosas tienen que fallar todas').toBe(EXPIRE_BATCH_SIZE);
    expect(corrida1.expired, 'en la corrida 1 no vence nadie: la sana ni siquiera entró').toBe(0);
    expect((await estado(sana.reservationId)).status).toBe('active');

    // El `+1` sobrevivió al rollback de la transacción que falló. Si estuviera escrito adentro de
    // esa transacción, esto sería 0 y el `order by` de la corrida 2 no tendría con qué reordenar.
    expect(
      (await estado(venenosas[0]!.reservationId)).attempts,
      'la fila que falló no quedó con el intento anotado. El `+1` se rolleó junto con el error: el ' +
        'techo nunca se alcanza y el head-of-line vuelve entero, con el arreglo escrito y sin efecto.',
    ).toBe(1);
    medido.intentos_tras_fallo = (await estado(venenosas[0]!.reservationId)).attempts;

    const corrida2 = await barrer();
    medido.sanas_vencidas_c2 = corrida2.expired;

    expect(
      (await estado(sana.reservationId)).status,
      'la reserva sana sigue `active` después de dos corridas. Fallar no manda al fondo de la cola: ' +
        'las filas rotas conservan su lugar de privilegio en `expires_at asc` y la unidad sana se ' +
        'queda «Reservado» en la vidriera para siempre, con el cron devolviendo 200.',
    ).toBe('expired');
    expect(corrida2.expired, 'la corrida 2 tiene que vencer exactamente la sana').toBe(1);
    expect(corrida2.released, 'y devolver su unidad a `available`').toBe(1);

    const [listing] = await cliente<{ status: string }[]>`
      select status from listings where id = ${sana.listingId}::uuid`;
    expect(listing?.status).toBe('available');
  });

  /**
   * ── B · el techo existe de verdad ───────────────────────────────────────────────────────────
   *
   * Reintentar para siempre algo que falla siempre es gastar la ventana del cron. Pasado
   * `MAX_SWEEP_ATTEMPTS` la fila deja de entrar al lote — y **aparece contada en `abandoned`**, que
   * es la mitad que evita que "abandonar" sea sinónimo de "esconder".
   */
  it('pasado el techo la fila deja de entrar al lote, y se cuenta como abandonada', async () => {
    await unidadVencida(uuidVenenoso(9001), 300, MAX_SWEEP_ATTEMPTS);
    const sana = await unidadVencida(uuidSano(), 200);

    const corrida = await barrer();

    expect(corrida.scanned, 'la fila que pasó el techo no puede entrar al lote').toBe(1);
    expect(corrida.failed, 'y por lo tanto no puede fallar de nuevo').toBe(0);
    expect((await estado(sana.reservationId)).status).toBe('expired');
    expect(
      corrida.abandoned,
      'la fila abandonada no se contó. Una unidad trabada en `reserved` que ya nadie va a intentar ' +
        'liberar, y que además no figura en ningún número, es el mismo bug con otro disfraz.',
    ).toBe(1);
    medido.abandonadas_en_el_tope = corrida.abandoned;
  });

  /**
   * ── C · polaridad: el techo no exilia a una fila que falló una vez ──────────────────────────
   *
   * La contracara del caso B, y la que evita que el arreglo sea un apagador. Un `40P01` contra el
   * dueño cancelando esa misma reserva desde el mostrador es una carrera perdida, no una fila rota:
   * tiene que reintentarse y salir. Un techo que confunde las dos cosas convierte cada deadlock
   * legítimo en una unidad trabada.
   */
  it('una fila que falló una vez y dejó de fallar vence en la corrida siguiente', async () => {
    const id = uuidVenenoso(9100);
    const fila = await unidadVencida(id, 400);

    const corrida1 = await barrer();
    expect(corrida1.failed).toBe(1);
    expect((await estado(fila.reservationId)).attempts).toBe(1);

    // Se levanta el veneno: la causa se arregló, como se arreglaría en producción.
    await cliente.unsafe(`alter table listing_events drop constraint probe_hol_poison`);
    let corrida2;
    try {
      corrida2 = await barrer();
    } finally {
      // `not valid` porque el barrido que acaba de andar YA dejó su fila en `listing_events` con el
      // listing envenenado: validar las filas viejas haría fallar el re-alta por haber funcionado.
      // Sobre los `insert` siguientes se aplica igual, que es lo único que los otros casos usan.
      await cliente.unsafe(
        `alter table listing_events add constraint probe_hol_poison
           check (listing_id::text not like '${VENENO}%') not valid`,
      );
    }

    expect(
      corrida2.scanned,
      'con 1 intento anotado y el techo en ' +
        String(MAX_SWEEP_ATTEMPTS) +
        ', la fila TIENE que volver a entrar al lote. Si no entra, el arreglo del head-of-line se ' +
        'volvió un apagador: cada deadlock contra el panel deja una unidad trabada.',
    ).toBe(1);
    expect(corrida2.expired).toBe(1);
    expect((await estado(fila.reservationId)).status).toBe('expired');
    medido.reintento_tras_recuperarse = corrida2.scanned;
  });

  /**
   * ── D · el `+1` puede fallar él mismo, y ese es el caso más callado ─────────────────────────
   *
   * Sin el `+1` la fila nunca llega al techo ni a `stuck`: el head-of-line vuelve entero y **sin
   * síntoma**. Por eso `unrecorded` cuenta desde la primera y no espera a la segunda.
   */
  it('si tampoco se puede anotar el intento, se cuenta aparte (`unrecorded`)', async () => {
    const fila = await unidadVencida(uuidVenenoso(9200), 400);

    await cliente.unsafe(`
      create or replace function probe_hol_no_bump() returns trigger language plpgsql as $fn$
      begin
        if new.sweep_attempts > old.sweep_attempts then
          raise exception 'probe: no se puede anotar el intento' using errcode = 'P0001';
        end if;
        return new;
      end $fn$`);
    await cliente.unsafe(`
      create trigger probe_hol_no_bump before update on reservations
      for each row execute function probe_hol_no_bump()`);

    const corrida = await barrer();

    await cliente.unsafe(`drop trigger probe_hol_no_bump on reservations`);

    expect(corrida.failed).toBe(1);
    expect(
      corrida.unrecorded,
      'la fila falló, el `+1` también falló, y el barrido no lo contó. Es el estado en el que el ' +
        'head-of-line vuelve sin dejar rastro: la fila no avanza hacia el techo y nadie se entera.',
    ).toBe(1);
    expect((await estado(fila.reservationId)).attempts, 'el contador no pudo moverse').toBe(0);
    medido.unrecorded = corrida.unrecorded;
  });

  /**
   * ── E · `skipped` no puede tragarse filas vencidas ──────────────────────────────────────────
   *
   * `skipped` es "el dominio dice que no hay nada que hacer". Sobre una reserva genuinamente
   * vencida eso es siempre falso, y un `skipped` ahí sería un head-of-line silencioso de otra
   * forma: la fila se contaría como atendida, no sumaría intentos y volvería igual mañana.
   */
  it('sobre reservas genuinamente vencidas, `skipped` es cero', async () => {
    await unidadVencida(uuidSano(), 10);
    await unidadVencida(uuidSano(), 20);

    const corrida = await barrer();

    expect(corrida.scanned).toBe(2);
    expect(corrida.expired).toBe(2);
    expect(
      corrida.skipped,
      'el dominio dijo "nada que hacer" sobre una reserva vencida. Esa fila no falla, no suma ' +
        'intento y no vence: se cuenta como atendida y vuelve mañana igual.',
    ).toBe(0);
    expect(corrida.failed + corrida.stuck + corrida.unrecorded + corrida.abandoned).toBe(0);
    medido.skipped_sobre_vencidas = corrida.skipped;
  });

  /**
   * ── F · las DOS salidas del handler, en una sola medición ───────────────────────────────────
   *
   * El 500 sólo significa algo si el 200 también existe, y sobre la misma base. Medir uno solo deja
   * pasar el handler que devuelve siempre lo mismo — que es literalmente el defecto de origen: hasta
   * S6 devolvía 200 pase lo que pase, y una corrida con las 200 filas rotas se veía en Vercel Cron
   * exactamente igual que una perfecta.
   */
  it('el cron devuelve 200 con la base sana y 500 con una unidad abandonada', async () => {
    process.env.CRON_SECRET = 'probe-hol-8c1f4a92be7d0356af41cc2e';
    vi.resetModules();
    const { GET } = await import('../../apps/web/app/api/cron/expire-reservations/route');
    const pedir = (): Promise<Response> =>
      GET(
        new Request('https://istock-software.vercel.app/api/cron/expire-reservations', {
          headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ''}` },
        }),
      );

    await unidadVencida(uuidSano(), 30);
    medido.status_base_sana = (await pedir()).status;
    expect(medido.status_base_sana, 'una corrida limpia tiene que ser 200').toBe(200);

    await unidadVencida(uuidVenenoso(9300), 300, MAX_SWEEP_ATTEMPTS);
    medido.status_con_abandonada = (await pedir()).status;
    expect(
      medido.status_con_abandonada,
      'hay una unidad trabada en `reserved` que el barrido ya no va a intentar liberar, y el cron ' +
        'contesta 200. Un cron verde mientras nada se vence es la falla que se descubre semanas ' +
        'después y del lado del cliente.',
    ).toBe(500);
  });
  /**
   * ── G · el predicado del 500, y el costo en lineas de log ───────────────────────────────────
   *
   * F mide las dos salidas del handler, pero el 500 se lo saca por la pata `abandoned`. Ese no es
   * el predicado que la slice discutio. `T23` del board eligió a propósito **`stuck`** —una fila
   * que falla teniendo ya `sweep_attempts >= 1`— y descartó `failed > 0` a secas por una razón
   * medida: a 0,12 expiraciones por corrida la mayoría trae **una** fila, así que una sola carrera
   * perdida contra el dueño cancelando desde el panel pintaría el cron de rojo permanente. Un rojo
   * permanente enseña a ignorar el rojo, que es el mismo defecto que un verde vacío.
   *
   * Con sólo F en el archivo, un `degraded = sweep.abandoned > 0` —o sea el arreglo sin la mitad
   * cross-run— pasa. Y pasa callado durante **cinco corridas**: la fila trabada recién grita cuando
   * llega al techo. Este caso mide las dos puntas del predicado sobre la misma fila:
   *
   *   corrida 1 → 200 · la fila falla por PRIMERA vez. No es un incidente, es una carrera.
   *   corrida 2 → 500 · la misma fila falla con el intento ya anotado. Dos veces no es una carrera.
   *
   * Y de paso cuenta lo único que el techo existe para acotar: **cuántas líneas de log cuesta una
   * fila envenenada en toda su vida**. Sin techo son 8.640 por mes, para siempre, idénticas. Con
   * techo son `MAX_SWEEP_ATTEMPTS` y después silencio — la fila deja de entrar al lote. Esa es la
   * economía del arreglo y acá se cuenta, no se argumenta.
   */
  it('la SEGUNDA falla de la misma fila es 500, la primera es 200, y cuesta `tope` lineas de log', async () => {
    process.env.CRON_SECRET = 'probe-hol-8c1f4a92be7d0356af41cc2e';
    vi.resetModules();
    const { GET } = await import('../../apps/web/app/api/cron/expire-reservations/route');
    const pedir = (): Promise<Response> =>
      GET(
        new Request('https://istock-software.vercel.app/api/cron/expire-reservations', {
          headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ''}` },
        }),
      );

    const rota = await unidadVencida(uuidVenenoso(9400), 400);
    // Una sana atrás, para que la corrida 1 tenga trabajo util ademas del fallo: un 200 sobre una
    // corrida que no vencio nada no distingue "toleró la carrera" de "no hizo nada".
    const sana = await unidadVencida(uuidSano(), 100);

    const desde = registroLogs.length;
    medido.status_primer_fallo = (await pedir()).status;
    medido.status_segundo_fallo = (await pedir()).status;
    // Hasta el techo, y DOS corridas de mas: si el techo no la sacara del lote, esas dos corridas
    // sumarian lineas y el conteo se pasaria de `tope`. Es la mitad que hace que el numero mida.
    for (let i = 2; i < MAX_SWEEP_ATTEMPTS + 2; i += 1) await pedir();

    medido.lineas_log_por_envenenada = registroLogs
      .slice(desde)
      .filter(
        (l) => l.event === 'reservation.expire.failed' && l.fields['listingId'] === rota.listingId,
      ).length;

    // T31. Sobre el MISMO `slice(desde)` y en el mismo fixture, a proposito: las dos lineas cuentan
    // el mismo tramo de vida de la misma fila, asi que el par `5 y 1` es una afirmacion sola —
    // "fallo cinco veces y se anuncio una". Medidas en corridas distintas serian dos numeros que
    // no se pueden comparar.
    medido.lineas_cuarentena_por_envenenada = registroLogs
      .slice(desde)
      .filter(
        (l) =>
          l.event === 'reservation.expire.quarantined' &&
          l.fields['listingId'] === rota.listingId,
      ).length;

    expect(
      (await estado(sana.reservationId)).status,
      'la corrida 1 no vencio la reserva sana: el fixture no separa "tolero la carrera" de "no hizo nada"',
    ).toBe('expired');

    expect(
      medido.status_primer_fallo,
      'la PRIMERA falla de una fila devolvio 500. A 0,12 expiraciones por corrida eso es rojo ' +
        'permanente por una carrera perdida contra el panel, y un rojo permanente se ignora igual ' +
        'que un verde vacio.',
    ).toBe(200);

    expect(
      medido.status_segundo_fallo,
      'la SEGUNDA falla de la MISMA fila devolvio 200. El predicado del 500 se quedo en ' +
        '`abandoned > 0`: la unidad trabada existe desde ahora y el cron la calla durante cinco ' +
        'corridas, que es toda la ventana en la que alguien podia arreglarla barata.',
    ).toBe(500);

    expect(
      (await estado(rota.reservationId)).attempts,
      'la fila no llego al techo: el `+1` dejo de avanzar y el conteo de lineas de abajo no mide nada',
    ).toBe(MAX_SWEEP_ATTEMPTS);

    expect(
      medido.lineas_log_por_envenenada,
      'una fila envenenada no cuesta `MAX_SWEEP_ATTEMPTS` lineas de log sino ' +
        String(medido.lineas_log_por_envenenada) +
        '. Si es mas, el techo no la saca del lote y son 8.640 lineas identicas por mes, para ' +
        'siempre; si es menos, dejo de entrar antes de tiempo y el reintento legitimo tampoco pasa.',
    ).toBe(MAX_SWEEP_ATTEMPTS);

    /**
     * T31. `abandoned` dice CUANTAS; esta linea dice CUALES, y es lo unico que deja los ids
     * escritos antes de que la fila desaparezca de los logs para siempre.
     *
     * ── Lo que este numero SI discrimina, medido, no razonado ──────────────────────────────────
     * Con `MAX_SWEEP_ATTEMPTS + 2` corridas sobre la misma fila envenenada:
     *   · no emitir el evento         → 0   (el 500 vuelve a traer un numero y ningun id)
     *   · emitir por intento          → 5   (la economia de logs que el techo vino a comprar,
     *                                        gastada de nuevo: una linea por corrida, para siempre)
     *   · emitir por vida de la fila  → 1   ← lo correcto
     *
     * ── Lo que NO discrimina, y se dice porque callarlo seria peor ─────────────────────────────
     * El modulo argumenta dos cosas que este fixture **no puede** ver, y las medi antes de
     * afirmarlo: cambiar el `===` por `>=` da 1, y decidir el cruce contra `row.sweepAttempts + 1`
     * —el valor que trajo el `select`, o sea el de hace una transaccion— tambien da 1. Las dos
     * pasan en verde.
     *
     * El motivo es estructural y no se arregla afinando la asercion: las dos solo son observables
     * con **dos corridas del cron pisandose**, porque hace falta que dos transacciones lean la
     * misma fila antes de que cualquiera escriba. Este fixture es de una sola corrida a la vez, y
     * el `where sweep_attempts < MAX_SWEEP_ATTEMPTS` del lote garantiza que el `RETURNING` nunca
     * pase de `MAX`: con un solo escritor, `>=` y `===` son la misma condicion.
     *
     * No se agrega el caso concurrente a proposito. Habria que lanzar dos `GET` en paralelo y
     * esperar que los dos `select` caigan antes del primer `update`, que depende del scheduler: un
     * rojo que aparece a veces se termina marcando `it.skip`, y este repo ya sabe lo que cuesta un
     * gate que se ignora. La cobertura de esas dos ramas queda escrita como hueco —que es lo que
     * `ci-exento` y `web-lint:sin-tenant` hacen en otros lados— en vez de simulada.
     */
    expect(
      medido.lineas_cuarentena_por_envenenada,
      'la fila envenenada se anuncio ' +
        String(medido.lineas_cuarentena_por_envenenada) +
        ' veces en ' +
        String(MAX_SWEEP_ATTEMPTS + 2) +
        ' corridas, y tiene que anunciarse UNA. 0 = el evento no se emite y el 500 trae un numero ' +
        'sin ids; ' +
        String(MAX_SWEEP_ATTEMPTS) +
        ' = se emite por intento y no por vida de la fila, que es la economia de logs del techo ' +
        'gastada de nuevo.',
    ).toBe(1);
  });
});
