/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  S6 · el ciclo de la reserva: panel → vidriera → cron → vidriera. Owner: `qa-agent`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * V8 de `scripts/accept-s6.sh` lo dice así: *"S6 no se cierra con tests unitarios: el gate del
 * board dice 'cron libera; vidriera revalida', y eso es un ciclo, no una función"*. El script
 * **lee** la línea y falla si no está; medirla necesita un browser real, un visitante anónimo y la
 * puerta HTTP del cron. Esto es el arnés que la produce:
 *
 * ```
 * MEDIDO s6 reserva · unidad=… · estado_tras_reservar=… · vidriera_dice=… · tras_expirar=… · publicar_estando_reservada=…
 * MEDIDO s6 barrido · http=… · sin_secreto=… · escaneadas=… · vencidas=… · liberadas=…
 * ```
 *
 * Las dos se emiten **antes** de las aserciones que las evalúan: si una aserción se cae, el número
 * ya salió y se puede leer qué pasó. Ningún campo tiene un valor escrito a mano — todos salen de
 * Postgres, del DOM o de una respuesta HTTP. Si algo no se pudo medir, el `beforeAll` tira y la
 * corrida falla: no se rellena. Una línea que imprime lo que esperábamos en vez de lo que pasó es
 * peor que no tener línea.
 *
 * `qa-agent` **no edita el código bajo test para poner esto en verde** (`CLAUDE.md` §4).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Las cuatro decisiones de diseño que hacen que esta medición signifique algo
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ── 1. La ficha se **calienta** hasta `x-nextjs-cache: HIT` ANTES de reservar ────────────────
 * La vidriera es ISR con `cacheLife('max')`. Si el spec abriera la ficha por primera vez recién
 * después de reservar, leería una página generada de cero y diría "Reservado" aunque la
 * invalidación por unidad no existiera. Estaría midiendo el render, no la purga. Calentando
 * primero —y guardando en la línea lo que la página cacheada decía: `Disponible`— el "Reservado"
 * de después sólo puede aparecer si `invalidateStorefrontUnit()` tiró abajo la entrada.
 *
 * ── 2. El visitante es anónimo y de contexto nuevo ──────────────────────────────────────────
 * Contexto propio, sin la cookie del dueño y sin cache de browser. La ficha se lee del **DOM
 * renderizado** y no del DTO: lo que se afirma es lo que la persona ve. Un DTO correcto que la
 * página no pinta sigue siendo un equipo señado publicado como disponible.
 *
 * ── 3. "Publicar" se aprieta desde una pestaña VIEJA, y ahí está el bug que V8 vino a atrapar ──
 * `UnitRowCard` sólo dibuja el botón cuando la unidad está en `draft`, así que en una pantalla
 * fresca el botón no existe y la falla es invisible. Pero el dueño real tiene el panel abierto en
 * el mostrador: la pestaña se pintó cuando el equipo era borrador, alguien reservó desde el
 * teléfono, y el botón sigue ahí. Este spec abre una segunda pestaña **en el mismo contexto**
 * (misma sesión) mientras la unidad está en `draft`, no la vuelve a cargar nunca, y le pega al
 * botón con la reserva viva. Es el camino del dueño, no un POST armado a mano.
 *
 * Se miden las dos mitades, porque el bug original tenía las dos: `transitionUnit` evaluaba con
 * `activeReservation: null` hardcodeado, devolvía `ok`, **y republicaba** el equipo con la seña
 * puesta. Un rechazo que igual dejó basura escrita no es un rechazo. Por eso el quinto campo
 * lleva el estado del listing y el de la reserva **después** del intento, y por eso lleva también
 * el status HTTP: sin prueba de vida, "no pasó nada" y "el sistema rechazó" se ven idénticos
 * desde afuera, y el segundo se reportaría como éxito.
 *
 * ── 4. La expiración se provoca moviendo el FIXTURE, nunca el código ─────────────────────────
 * Esperar 30 minutos de reloj no es una opción y falsear el `now` del barrido tampoco: probaría el
 * cron contra un reloj que en producción no existe. Se manda `reservations.expires_at` al pasado
 * —la fila queda `active` y **vencida de verdad**— y el barrido decide solo, con su propio `now`.
 *
 * Y se lo invoca como lo invoca Vercel: `GET /api/cron/expire-reservations` con
 * `Authorization: Bearer …`, no llamando a `expireDueReservations()` por atajo. Es la única puerta
 * HTTP sin sesión que **escribe** en el producto; llamar a la función interna probaría el barrido
 * y dejaría la puerta sin probar. Por eso se golpea también **sin** secreto y se afirma 401: un
 * barrido que anda pero está abierto deja a cualquiera vencerle las reservas a cualquier tenant.
 */

import type { APIRequestContext, Browser, BrowserContext, Page } from '@playwright/test';
import { expect, test } from './_lib/fixtures';
import {
  activeReservation,
  backdateReservation,
  deleteTenantBySlug,
  deleteUserByEmail,
  listingById,
  listingSlugById,
  reservationsByListing,
  seedFxSettings,
  seedLocation,
  tenantIdBySlug,
  type ReservationRow,
} from './_lib/db';
import { APEX_URL, CRON_EXPIRE_URL, E2E_CRON_SECRET, storefrontUrl, uniqueEmail, uniqueSlug } from './_lib/env';
import { domHtml } from './_lib/html';
import { fetchUntilCached } from './_lib/http';
import { createBusiness, createUnitWithPhotos, publishUnit, signIn, STOCK_PATH } from './_lib/panel';
import { ownersPhotoUpload } from './_lib/photo';
import {
  reservationCycleMedidoLine,
  reservationCycleProblems,
  sweepMedidoLine,
  sweepProblems,
  BADGE_DISPONIBLE,
  BADGE_RESERVADO,
  type PublishWhileReservedAttempt,
  type ReservationCycleMeasurement,
  type SweepMeasurement,
} from './_lib/s6-measure';

test.describe.configure({ mode: 'serial' });

const slug = uniqueSlug('reserva');
const email = uniqueEmail('reserva');
const businessName = 'Vidriera QA Reservas';
const imei = `35${String(Date.now()).slice(-13)}`;
const TITULO = 'iPhone 14 Pro 256 Grafito';

/** Duración que el dueño elige en el `<select>`. Es un preset real de `RESERVATION_MINUTE_OPTIONS`. */
const MINUTOS = '30';

interface Observed {
  readonly listingId: string;
  readonly fichaUrl: string;
  /** El botón "Publicar" seguía dibujado en la pestaña vieja. Sin esto el intento no existe. */
  readonly staleOfrecioPublicar: boolean;
  /** `x-nextjs-cache` de la ficha calentada antes de reservar. Tiene que ser `HIT`. */
  readonly cacheAntes: string;
  readonly reserva: ReservationRow;
  readonly vencimientoAdelantado: Date;
  readonly cuerpoDelBarrido: string;
  readonly measurement: ReservationCycleMeasurement;
  readonly sweep: SweepMeasurement;
}

let observed: Observed | null = null;

function seen(): Observed {
  if (observed === null) {
    throw new Error('el ciclo de S6 no se midió: mirá el error del beforeAll, no este mensaje');
  }
  return observed;
}

/** El badge tal como lo pinta la ficha, leído del HTML servido (sin el payload de Flight). */
function badgeEnHtml(html: string): string | null {
  const match = /<span[^>]*\bdata-status="[^"]*"[^>]*>([\s\S]*?)<\/span>/u.exec(domHtml(html));
  if (match === null) return null;
  return (match[1] ?? '').replace(/<[^>]+>/gu, '').trim();
}

/**
 * Lo que un desconocido lee en la ficha, en un browser sin sesión y sin cache previo. Contexto
 * nuevo por lectura a propósito: reusar uno haría que la segunda lectura saliera del cache del
 * browser y midiera la primera.
 */
async function badgeQueVeUnDesconocido(browser: Browser, url: string): Promise<string> {
  const visita = await browser.newContext();
  try {
    const page = await visita.newPage();
    await page.goto(url, { waitUntil: 'load' });
    const badge = page.locator('span[data-status]').first();
    await expect(
      badge,
      `la ficha ${url} no pinta ningún badge de estado: el visitante no tiene forma de saber si el ` +
        'equipo está disponible, reservado o vendido',
    ).toBeVisible({ timeout: 30_000 });
    return ((await badge.textContent()) ?? '').trim();
  } finally {
    await visita.close();
  }
}

/**
 * El intento de publicar desde la pestaña vieja, medido entero.
 *
 * La respuesta HTTP se espera **antes** que la alerta: es el control de vida. Si el click no llega
 * al server, esto tira acá y no se emite una línea que diga "rechazado" sobre algo que nunca pasó.
 */
async function intentarPublicarDesdeLaPestaniaVieja(
  stale: Page,
  listingId: string,
): Promise<{ httpStatus: number | null; alert: string | null }> {
  const fila = stale.locator(`li[data-testid="fila-unidad"][data-listing-id="${listingId}"]`);
  const formulario = fila.locator('form:has(input[name="to"][value="available"])');
  const boton = formulario.getByRole('button', { name: 'Publicar', exact: true });

  await expect(
    boton,
    'la pestaña vieja ya no ofrece "Publicar": sin ese botón no hay nada que intentar y el quinto ' +
      'campo de la medición no se puede producir',
  ).toBeVisible({ timeout: 20_000 });

  const respuesta = stale
    .waitForResponse((response) => response.request().method() === 'POST', { timeout: 30_000 })
    .catch(() => null);

  await boton.click();
  const post = await respuesta;

  const alerta = formulario.getByRole('alert');
  let alert: string | null = null;
  try {
    await expect(alerta).toBeVisible({ timeout: 20_000 });
    alert = ((await alerta.textContent()) ?? '').trim();
  } catch {
    // No es un fallo del arnés: es el resultado. Un intento que no muestra error es un intento
    // que el panel aceptó, y eso es exactamente lo que `publishProblems` reporta.
    alert = null;
  }

  return { httpStatus: post === null ? null : post.status(), alert };
}

async function estadoDelListing(listingId: string): Promise<string> {
  const row = await listingById(listingId);
  if (row === null) throw new Error(`el equipo ${listingId} desapareció de la base`);
  return row.status;
}

test.beforeAll(async ({ browser }) => {
  // Journey completo del dueño (login, negocio, tres fotos de 12 MP procesadas server-side),
  // dos vidrieras anónimas y una corrida del cron. El default de 90 s es para un test, no para esto.
  test.setTimeout(360_000);

  const upload = await ownersPhotoUpload();

  // UN contexto para las dos pestañas: comparten la cookie de sesión, que es lo que hace que la
  // pestaña vieja sea del mismo dueño y no de un desconocido.
  const panel: BrowserContext = await browser.newContext();
  const owner = await panel.newPage();
  const stale = await panel.newPage();

  let listingId = '';
  let staleOfrecioPublicar = false;
  let publish: PublishWhileReservedAttempt | null = null;
  let cacheAntes = '';
  let dijoAntes = '';
  let reserva: ReservationRow | null = null;
  let vencimientoAdelantado: Date | null = null;
  let cuerpoDelBarrido = '';
  let sweep: SweepMeasurement | null = null;
  let fichaUrl = '';
  let dice = '';
  let estadoTrasReservar = '';
  let estadoTrasBarrer = '';
  let diceDespues = '';

  try {
    await signIn(owner, email);
    await createBusiness(owner, { name: businessName, slug });

    const tenantId = await tenantIdBySlug(slug);
    if (tenantId === null) throw new Error(`el tenant ${slug} no quedó en la base`);

    // Precondiciones sin pantalla hasta S5: sin TC ni punto de retiro la ficha no renderiza y no
    // habría badge que leer. Ver el docblock de `seedFxSettings` en `_lib/db.ts`.
    await seedFxSettings(tenantId);
    await seedLocation(tenantId);

    const created = await createUnitWithPhotos(
      owner,
      {
        title: TITULO,
        condition: 'used_excellent',
        storageGb: 256,
        color: 'Grafito',
        priceUsd: 620,
        batteryPct: 89,
        imei,
        costUsd: 500,
        catalogModelHint: 'iPhone 14 Pro',
        photo: upload,
      },
      [upload, upload],
    );
    listingId = created.listingId;

    // ── La pestaña vieja se pinta ACÁ, con la unidad todavía en `draft` ───────────────────────
    // Es el único momento en que el panel dibuja "Publicar". No se vuelve a cargar nunca más:
    // recargarla sería borrar la evidencia.
    await stale.goto(`${APEX_URL}${STOCK_PATH}`, { waitUntil: 'load' });
    const botonEnLaVieja = stale
      .locator(`li[data-testid="fila-unidad"][data-listing-id="${listingId}"]`)
      .getByRole('button', { name: 'Publicar', exact: true });
    await expect(
      botonEnLaVieja,
      'con la unidad en borrador y tres fotos, el panel no ofrece "Publicar": el escenario que V8 ' +
        'audita (apretar un botón que la UI todavía muestra) no se puede montar',
    ).toBeVisible({ timeout: 30_000 });
    staleOfrecioPublicar = true;

    // ── El dueño publica desde la pantalla de fotos ───────────────────────────────────────────
    await publishUnit(owner);

    const listingSlug = await listingSlugById(listingId);
    if (listingSlug === null) throw new Error(`el listing ${listingId} no quedó en la base`);
    fichaUrl = storefrontUrl(slug, `/p/${listingSlug}`);

    // ── Se calienta la ficha hasta que la sirva el cache. Ver la decisión 1 del encabezado ────
    const anonimo: APIRequestContext = panel.request;
    const calentada = await fetchUntilCached(anonimo, fichaUrl);
    cacheAntes = calentada.headers()['x-nextjs-cache'] ?? '(sin header)';
    const badgeAntes = badgeEnHtml(await calentada.text());
    if (badgeAntes === null) {
      throw new Error(
        `la ficha ${fichaUrl} salió sin badge de estado (status ${String(calentada.status())}): sin ` +
          'ese control, leer "Reservado" después no probaría que la invalidación corrió',
      );
    }
    dijoAntes = badgeAntes;

    // ── El dueño reserva desde la lista de stock ──────────────────────────────────────────────
    await owner.goto(`${APEX_URL}${STOCK_PATH}`, { waitUntil: 'load' });
    const fila = owner.locator(`li[data-testid="fila-unidad"][data-listing-id="${listingId}"]`);
    const detalle = fila.getByTestId('reservar-detalle');
    await expect(
      detalle,
      'la fila de un equipo publicado no ofrece reservar: o el plan no tiene la función, o la ' +
        'pantalla no la dibuja. Sin esto no hay reserva que medir',
    ).toBeVisible({ timeout: 30_000 });
    await detalle.locator('summary').click();
    await fila.getByTestId('reserva-minutos').selectOption(MINUTOS);
    await fila.getByTestId('reserva-etiqueta').fill('Juan de Cipolletti');
    await fila.getByTestId('reservar-confirmar').click();

    // `refresh()` re-renderiza la fila: el botón de liberar sólo existe si el equipo quedó
    // `reserved`. Esperar por esa condición y no por un reloj.
    await expect(
      fila.getByTestId('cancelar-reserva'),
      `reservar no dejó la fila en estado reservado. Alerta: ${
        (await fila.getByRole('alert').count()) > 0
          ? ((await fila.getByRole('alert').first().textContent()) ?? '').trim()
          : '(sin alerta)'
      }`,
    ).toBeVisible({ timeout: 30_000 });

    estadoTrasReservar = await estadoDelListing(listingId);

    const viva = await activeReservation(listingId);
    if (viva === null) {
      throw new Error(
        `no quedó ninguna reserva \`active\` para ${listingId}: la pantalla dice reservado y la base no`,
      );
    }
    reserva = viva;

    // ── Lo que ve un desconocido, con la seña puesta ──────────────────────────────────────────
    dice = await badgeQueVeUnDesconocido(browser, fichaUrl);

    // ── El botón que la pestaña vieja todavía ofrece ──────────────────────────────────────────
    const intento = await intentarPublicarDesdeLaPestaniaVieja(stale, listingId);
    const listingTrasIntento = await estadoDelListing(listingId);
    const reservaTrasIntento = await activeReservation(listingId);
    publish = {
      httpStatus: intento.httpStatus,
      alert: intento.alert,
      listingStatusAfter: listingTrasIntento,
      reservationStatusAfter: reservaTrasIntento?.status ?? null,
    };

    // ── Vencer la reserva moviendo el fixture, y barrer por la puerta HTTP ────────────────────
    vencimientoAdelantado = await backdateReservation(reserva.id);

    const sinSecreto = await panel.request.get(CRON_EXPIRE_URL, { maxRedirects: 0 });
    const conSecreto = await panel.request.get(CRON_EXPIRE_URL, {
      headers: { Authorization: `Bearer ${E2E_CRON_SECRET}` },
      maxRedirects: 0,
    });
    cuerpoDelBarrido = await conSecreto.text();

    const parsed: unknown = conSecreto.status() === 200 ? JSON.parse(cuerpoDelBarrido) : {};
    const cifras = parsed as Partial<Record<'scanned' | 'expired' | 'released', unknown>>;
    const numero = (value: unknown, campo: string): number => {
      if (typeof value !== 'number') {
        throw new Error(
          `el barrido no devolvió \`${campo}\` numérico (status ${String(conSecreto.status())}). ` +
            `Cuerpo: ${cuerpoDelBarrido.slice(0, 300)}`,
        );
      }
      return value;
    };

    sweep = {
      httpStatus: conSecreto.status(),
      httpStatusSinSecreto: sinSecreto.status(),
      scanned: numero(cifras.scanned, 'scanned'),
      expired: numero(cifras.expired, 'expired'),
      released: numero(cifras.released, 'released'),
    };

    estadoTrasBarrer = await estadoDelListing(listingId);
    diceDespues = await badgeQueVeUnDesconocido(browser, fichaUrl);
  } finally {
    await panel.close();
  }

  // Nada se rellena: si un campo no se pudo medir, la corrida falla acá y la línea no sale.
  if (publish === null || reserva === null || vencimientoAdelantado === null || sweep === null) {
    throw new Error('el ciclo de S6 quedó a medio medir: no hay línea `MEDIDO` que emitir');
  }

  const measurement: ReservationCycleMeasurement = {
    listingId,
    statusAfterReserve: estadoTrasReservar,
    storefrontSaidBefore: dijoAntes,
    storefrontSays: dice,
    statusAfterSweep: estadoTrasBarrer,
    storefrontSaysAfterSweep: diceDespues,
    publish,
  };

  // Las líneas salen ANTES de cualquier aserción: si algo está rojo, el número ya se puede leer.
  process.stdout.write(`\n${reservationCycleMedidoLine(measurement)}\n`);
  process.stdout.write(`${sweepMedidoLine(sweep)}\n\n`);

  observed = {
    listingId,
    fichaUrl,
    staleOfrecioPublicar,
    cacheAntes,
    reserva,
    vencimientoAdelantado,
    cuerpoDelBarrido,
    measurement,
    sweep,
  };
});

test.afterAll(async () => {
  await deleteTenantBySlug(slug);
  await deleteUserByEmail(email);
});

test('reservar desde el panel deja el equipo reservado en Postgres, no sólo en la pantalla', () => {
  const { measurement, reserva } = seen();

  expect(
    measurement.statusAfterReserve,
    'la fila del panel dice reservado pero `listings.status` no: la pantalla y la base no coinciden',
  ).toBe('reserved');

  expect(reserva.status, 'la reserva no quedó `active`').toBe('active');
  expect(reserva.minutes, 'la duración elegida en el `<select>` no llegó a la fila').toBe(
    Number(MINUTOS),
  );
  expect(
    reserva.expiresAt.getTime(),
    'la reserva nació vencida: `expires_at` no quedó en el futuro',
  ).toBeGreaterThan(Date.now() - 60_000);
});

test('la ficha cacheada se estaba sirviendo como disponible antes de que alguien señara el equipo', () => {
  const { cacheAntes, measurement } = seen();

  // Es el control de honestidad del test siguiente, y por eso es un test propio: si esto falla,
  // "Reservado" después no prueba nada y hay que saberlo separado.
  expect(
    cacheAntes,
    'la ficha nunca llegó a servirse desde el cache de ISR: sin una entrada cacheada previa, leer ' +
      '"Reservado" después mide el render y no la invalidación',
  ).toBe('HIT');

  expect(
    measurement.storefrontSaidBefore,
    'la ficha cacheada no decía "Disponible" antes de la reserva',
  ).toBe(BADGE_DISPONIBLE);
});

test('un desconocido que abre la ficha de un equipo señado lee Reservado y nunca Disponible', () => {
  const { measurement, fichaUrl } = seen();

  expect(
    measurement.storefrontSays,
    `${fichaUrl} le sigue diciendo ${JSON.stringify(measurement.storefrontSays)} a un visitante ` +
      'anónimo con la seña puesta: dos personas viajan al local por el mismo teléfono',
  ).toBe(BADGE_RESERVADO);

  expect(
    measurement.storefrontSays,
    'la ficha de un equipo reservado dice "Disponible": la reserva no le llegó al visitante',
  ).not.toBe(BADGE_DISPONIBLE);
});

test('publicar un equipo con la reserva viva se rechaza y no le pisa la seña a nadie', () => {
  const { measurement, staleOfrecioPublicar } = seen();
  const { publish } = measurement;

  expect(
    staleOfrecioPublicar,
    'el escenario no se pudo montar: la pantalla nunca ofreció "Publicar"',
  ).toBe(true);

  expect(
    publish.httpStatus,
    'el click en "Publicar" no llegó al server: sin prueba de vida, un rechazo y un botón muerto ' +
      'se ven iguales',
  ).not.toBeNull();

  expect(
    publish.alert,
    'el panel aceptó republicar un equipo con la seña puesta: es el bug de `activeReservation: ' +
      'null` hardcodeado en `transitionUnit`, que devolvía ok y dejaba el equipo en la vidriera ' +
      'como disponible hasta que el cron lo venciera',
  ).not.toBeNull();

  expect(
    publish.listingStatusAfter,
    'la transición se rechazó y el equipo igual cambió de estado: un rechazo que deja basura ' +
      'escrita no es un rechazo',
  ).toBe('reserved');

  expect(
    publish.reservationStatusAfter,
    'el intento fallido de publicar se llevó puesta la reserva de un cliente',
  ).toBe('active');
});

test('el barrido de reservas vencidas sólo abre con el secreto del cron y con él libera el equipo', () => {
  const { sweep, cuerpoDelBarrido, vencimientoAdelantado } = seen();

  expect(
    vencimientoAdelantado.getTime(),
    'el fixture no quedó vencido en la base: el barrido no tendría nada que encontrar',
  ).toBeLessThan(Date.now());

  expect(
    sweep.httpStatusSinSecreto,
    'la única puerta HTTP sin sesión que escribe en el producto contesta sin `Authorization`: ' +
      'cualquiera puede vencerle las reservas a cualquier tenant',
  ).toBe(401);

  expect(
    sweep.httpStatus,
    `el barrido con el secreto correcto no respondió 200. Cuerpo: ${cuerpoDelBarrido.slice(0, 300)}`,
  ).toBe(200);

  expect(
    sweep.expired,
    'el barrido corrió y no venció ninguna reserva: un barrido que no barre nada da 0 y "pasa"',
  ).toBeGreaterThanOrEqual(1);

  expect(
    sweep.released,
    'la reserva venció pero el equipo no se liberó: stock muerto en la vidriera hasta que alguien ' +
      'lo toque a mano',
  ).toBeGreaterThanOrEqual(1);

  expect(sweepProblems(sweep), 'la puerta del barrido tiene problemas abiertos').toEqual([]);
});

test('cuando la reserva vence el equipo vuelve a estar disponible en Postgres y en la vidriera', async () => {
  const { measurement, listingId } = seen();

  expect(
    measurement.statusAfterSweep,
    'la reserva venció y el equipo no volvió a `available`',
  ).toBe('available');

  expect(
    measurement.storefrontSaysAfterSweep,
    'el cron liberó en Postgres y la ficha cacheada le sigue diciendo "Reservado" al visitante: ' +
      '"cron libera" y "vidriera revalida" son dos afirmaciones, y ésta es la segunda',
  ).toBe(BADGE_DISPONIBLE);

  // La reserva no se borra: queda como historia, cerrada. Un `delete` haría imposible responder
  // "¿cuántas reservas se caen?", que es la pregunta que justifica el plan Negocio.
  const filas = await reservationsByListing(listingId);
  expect(filas.length, 'la reserva desapareció de la base en vez de quedar cerrada').toBe(1);
  expect(filas[0]?.status, 'la reserva vencida no quedó marcada como vencida').toBe('expired');
  expect(filas[0]?.closedAt, 'la reserva se cerró sin dejar cuándo').not.toBeNull();
});

test('el ciclo completo de la reserva no deja ningún problema abierto en la medición', () => {
  const { measurement } = seen();

  expect(
    reservationCycleProblems(measurement),
    'el ciclo panel → vidriera → cron → vidriera tiene problemas abiertos',
  ).toEqual([]);
});
