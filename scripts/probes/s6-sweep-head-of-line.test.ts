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
vi.mock('../../apps/web/app/(app)/_lib/log', () => ({
  logEvent: vi.fn(),
  logError: vi.fn(),
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
    const sana = await unidadVencida(uuidSano(), 1);

    const corrida1 = await expireDueReservations(new Date());

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

    const corrida2 = await expireDueReservations(new Date());

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

    const corrida = await expireDueReservations(new Date());

    expect(corrida.scanned, 'la fila que pasó el techo no puede entrar al lote').toBe(1);
    expect(corrida.failed, 'y por lo tanto no puede fallar de nuevo').toBe(0);
    expect((await estado(sana.reservationId)).status).toBe('expired');
    expect(
      corrida.abandoned,
      'la fila abandonada no se contó. Una unidad trabada en `reserved` que ya nadie va a intentar ' +
        'liberar, y que además no figura en ningún número, es el mismo bug con otro disfraz.',
    ).toBe(1);
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

    const corrida1 = await expireDueReservations(new Date());
    expect(corrida1.failed).toBe(1);
    expect((await estado(fila.reservationId)).attempts).toBe(1);

    // Se levanta el veneno: la causa se arregló, como se arreglaría en producción.
    await cliente.unsafe(`alter table listing_events drop constraint probe_hol_poison`);
    let corrida2;
    try {
      corrida2 = await expireDueReservations(new Date());
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

    const corrida = await expireDueReservations(new Date());

    await cliente.unsafe(`drop trigger probe_hol_no_bump on reservations`);

    expect(corrida.failed).toBe(1);
    expect(
      corrida.unrecorded,
      'la fila falló, el `+1` también falló, y el barrido no lo contó. Es el estado en el que el ' +
        'head-of-line vuelve sin dejar rastro: la fila no avanza hacia el techo y nadie se entera.',
    ).toBe(1);
    expect((await estado(fila.reservationId)).attempts, 'el contador no pudo moverse').toBe(0);
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

    const corrida = await expireDueReservations(new Date());

    expect(corrida.scanned).toBe(2);
    expect(corrida.expired).toBe(2);
    expect(
      corrida.skipped,
      'el dominio dijo "nada que hacer" sobre una reserva vencida. Esa fila no falla, no suma ' +
        'intento y no vence: se cuenta como atendida y vuelve mañana igual.',
    ).toBe(0);
    expect(corrida.failed + corrida.stuck + corrida.unrecorded + corrida.abandoned).toBe(0);
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
    expect((await pedir()).status, 'una corrida limpia tiene que ser 200').toBe(200);

    await unidadVencida(uuidVenenoso(9300), 300, MAX_SWEEP_ATTEMPTS);
    expect(
      (await pedir()).status,
      'hay una unidad trabada en `reserved` que el barrido ya no va a intentar liberar, y el cron ' +
        'contesta 200. Un cron verde mientras nada se vence es la falla que se descubre semanas ' +
        'después y del lado del cliente.',
    ).toBe(500);
  });
});
