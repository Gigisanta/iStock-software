/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  S2 · el techo de bytes, probado de verdad. Owner: `qa-agent`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## La regla de negocio
 * El dueño está parado en el mostrador con el cliente al lado. Si la foto que sacó no entra, tiene
 * que leer **una frase en castellano que le diga qué hacer**. No un `413`, no `Body exceeded
 * 3.5mb`, no un stack de Node, no una página en inglés de la plataforma.
 *
 * ## La cadena de techos, y por qué sólo se puede contestar adentro de una banda
 * ```
 *   3   MiB  MAX_PHOTO_BYTES              cap de la app · Zod · mensaje nuestro   ← nuestro
 *   3.5 MiB  serverActions.bodySizeLimit  a partir de acá contesta Next           ← nuestro
 *   4   MB   Routing Middleware (proxy.ts)  lo corta Vercel, no varía por plan
 *   4.5 MB   Vercel Function                lo corta Vercel
 * ```
 * Por encima de `bodySizeLimit` el request **no llega a nuestro código**: el que contesta es Next
 * o directamente Vercel, y no hay nada que podamos escribir en castellano porque no hay handler
 * corriendo. Un test que mandara 5 MB estaría probando el manejo de errores de la plataforma.
 *
 * La fixture de acá vive entre el cap y `bodySizeLimit` a propósito (`_lib/photo.ts`), y el primer
 * test **afirma la banda**: es la precondición de todo lo demás y tiene que fallar ruidosamente el
 * día que alguien mueva un techo.
 *
 * ## Los dos caminos, y por qué los dos hacen falta
 * El diseño que cerró el LEAD dice que el **downscale del cliente sólo se activa si el archivo
 * supera el cap**. Entonces hay dos historias distintas, y probar una sola deja la otra abierta:
 *
 *   1. **Con JavaScript** (el 99% de los dueños): la foto grande se achica en el navegador y
 *      entra. Se prueba que **el camino no se rompe** y termina con las 3 fotos. Este test **no**
 *      afirma bytes de salida: los bytes son de `s2-la-foto-del-duenio-llega-en-150kb.spec.ts`,
 *      que los mide sobre una fixture bajo el cap justamente para no estar midiendo el `canvas`
 *      de Chromium. Medir acá sería medir el navegador y llamarlo pipeline.
 *   2. **Sin JavaScript**: el archivo grande viaja tal cual y el que tiene que contestar es el
 *      server. Es el único camino donde se puede ver si nuestro cap **existe del lado que importa**
 *      o si era una validación de navegador —o sea, ninguna. Se apaga el JS a propósito: el
 *      formulario del panel declara que funciona con progressive enhancement, así que apagarlo no
 *      es un caso raro de laboratorio, es el mismo POST que arma un `curl`.
 *
 * `qa-agent` no arregla el código bajo test. Si esto se pone rojo, el defecto es de la impl.
 */

import type { Page } from '@playwright/test';
import { expect, test } from './_lib/fixtures';
import { isSpanishUserMessage, platformErrorMarkersIn } from './_lib/copy';
import {
  deleteTenantBySlug,
  deleteUserByEmail,
  listingPhotoCount,
  purgeE2eFixtures,
} from './_lib/db';
import { APEX_URL, FIXTURE_PREFIX, uniqueEmail, uniqueSlug } from './_lib/env';
import {
  MAX_PHOTO_BYTES,
  MIDDLEWARE_BODY_LIMIT_BYTES,
  overCapPhotoJpeg,
  overCapPhotoUpload,
  ownersPhotoUpload,
  SERVER_ACTION_BODY_LIMIT_BYTES,
} from './_lib/photo';
import {
  createBusiness,
  createUnitDraft,
  errorTextIn,
  loadedPhotos,
  photosPath,
  signIn,
  tryAddPhoto,
} from './_lib/panel';

/**
 * Serial: el rechazo del server se prueba **antes** de sumar fotos, sobre un equipo con una sola.
 * Si corriera al final, el equipo ya tendría 3 y un rechazo podría ser por cantidad y no por
 * tamaño — el test seguiría verde y no estaría probando el techo de bytes.
 */
test.describe.configure({ mode: 'serial' });

const slug = uniqueSlug('techo');
const email = uniqueEmail('techo');
const imei = `35${String(Date.now()).slice(-13)}`;

const MIN_PHOTOS_TO_PUBLISH = 3;

let page: Page;
let listingId = '';

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  await purgeE2eFixtures(FIXTURE_PREFIX);

  page = await browser.newPage();
  await signIn(page, email);
  await createBusiness(page, { name: 'Neuquen Cel Techo', slug });

  const created = await createUnitDraft(page, {
    title: 'iPhone 15 128 Azul',
    condition: 'used_excellent',
    storageGb: 128,
    color: 'Azul',
    priceUsd: 780,
    batteryPct: 95,
    imei,
    costUsd: 640,
    photo: await ownersPhotoUpload(),
  });
  listingId = created.listingId;
});

test.afterAll(async () => {
  await page.close();
  await deleteTenantBySlug(slug);
  await deleteUserByEmail(email);
});

test('la foto pesada de prueba cae entre nuestro cap y el techo de la plataforma', async () => {
  const bytes = (await overCapPhotoJpeg()).byteLength;

  expect(
    bytes,
    `la foto de prueba pesa ${bytes} B y el cap de la app son ${MAX_PHOTO_BYTES} B: si no lo ` +
      'supera no hay nada que rechazar y los tests de abajo pasan sin probar el techo',
  ).toBeGreaterThan(MAX_PHOTO_BYTES);

  expect(
    bytes,
    `la foto de prueba pesa ${bytes} B y pasa el bodySizeLimit de ${SERVER_ACTION_BODY_LIMIT_BYTES} ` +
      'B: a partir de ahí el que contesta es Next con su propio 413 y el rechazo deja de ser ' +
      'nuestro. El test estaría probando el manejo de errores de la plataforma',
  ).toBeLessThan(SERVER_ACTION_BODY_LIMIT_BYTES);

  // La cadena entera, para que el rojo diga cuál techo se movió y no sólo que la fixture no sirve.
  expect(
    MAX_PHOTO_BYTES < SERVER_ACTION_BODY_LIMIT_BYTES &&
      SERVER_ACTION_BODY_LIMIT_BYTES < MIDDLEWARE_BODY_LIMIT_BYTES,
    `la cadena de techos dejó de ser creciente: cap ${MAX_PHOTO_BYTES} · bodySizeLimit ` +
      `${SERVER_ACTION_BODY_LIMIT_BYTES} · middleware ${MIDDLEWARE_BODY_LIMIT_BYTES}. Con el cap ` +
      'por encima de un techo de Vercel, el dueño nunca ve nuestro mensaje: el request muere antes',
  ).toBe(true);
});

test('sin JavaScript, la foto que supera el cap la rechaza el server con una frase en castellano', async ({
  browser,
}) => {
  test.setTimeout(180_000);

  // Misma sesión, sin JS. El formulario del panel declara progressive enhancement: acá se cobra esa
  // promesa. Y de paso es el único modo de que el archivo grande llegue **entero** al server, que
  // es lo único que este test quiere saber.
  const context = await browser.newContext({
    javaScriptEnabled: false,
    storageState: await page.context().storageState(),
  });
  const noJs = await context.newPage();

  try {
    await noJs.goto(`${APEX_URL}${photosPath(listingId)}`);

    const input = noJs.getByTestId('input-agregar-foto');
    await expect(
      input,
      'la pantalla de fotos no renderiza el formulario sin JavaScript: sin progressive ' +
        'enhancement no hay forma de saber si el cap existe del lado del server',
    ).toBeAttached({ timeout: 20_000 });
    await input.setInputFiles(await overCapPhotoUpload());

    const [response] = await Promise.all([
      noJs.waitForResponse((res) => res.request().method() === 'POST', { timeout: 90_000 }),
      noJs.getByTestId('submit-agregar-foto').click(),
    ]);

    // 413 es la respuesta de la plataforma, no la nuestra. Nuestro cap está 512 KiB por debajo del
    // de Next justamente para poder contestar nosotros: si acá sale 413, el cap de la app no
    // existe del lado del server y lo que se veía en pantalla era una validación de navegador.
    expect(
      response.status(),
      `el POST de la foto contestó ${response.status()}: el request pasó de largo nuestro cap y ` +
        'lo cortó la plataforma. El dueño lee una página en inglés',
    ).not.toBe(413);
    expect(
      response.status(),
      `el POST de la foto contestó ${response.status()}: una foto grande es un caso esperado, no ` +
        'un error del server',
    ).toBeLessThan(500);

    // El POST sin JS es una navegación: cuando llegan los headers, el documento nuevo todavía no
    // se parseó. Se espera por **cualquiera de los dos desenlaces posibles** —el mensaje de error
    // o una foto más— y recién ahí se lee la pantalla. Leer antes daría "no hay error-foto" con el
    // browser todavía en la página vieja, que es un falso rojo indistinguible del verdadero.
    await Promise.any([
      noJs.getByTestId('error-foto').waitFor({ state: 'visible', timeout: 90_000 }),
      expect(noJs.getByTestId('foto-cargada')).toHaveCount(2, { timeout: 90_000 }),
    ]).catch(() => undefined);

    const shown = await errorTextIn(noJs, 'error-foto');
    expect(
      shown,
      'el server rechazó (o aceptó) la foto sin escribir nada en data-testid="error-foto": el ' +
        'dueño no tiene forma de saber qué pasó',
    ).not.toBeNull();

    const text = shown ?? '';
    expect(
      platformErrorMarkersIn(text),
      `el mensaje que ve el dueño dice "${text}": eso lo escribió la plataforma, no nosotros`,
    ).toEqual([]);
    expect(
      isSpanishUserMessage(text),
      `el mensaje que ve el dueño dice "${text}" y no parece castellano: CLAUDE.md §0.10`,
    ).toBe(true);

    // Y lo que importa de verdad: la foto no entró. Un mensaje lindo con la foto guardada igual
    // sería peor que el 413.
    expect(
      await listingPhotoCount(listingId),
      'la foto que supera el cap quedó guardada igual: el mensaje era decorativo',
    ).toBe(1);
  } finally {
    await context.close();
  }
});

test('con JavaScript, una foto más pesada que el cap se achica sola y el equipo la acepta', async () => {
  test.setTimeout(180_000);

  // Sin aserciones de bytes a propósito: acá el que produce el archivo es el navegador. Lo único
  // que se afirma es que el camino no se rompe — que es exactamente lo que el LEAD pidió probar.
  const { error } = await tryAddPhoto(page, await overCapPhotoUpload(), 2);

  expect(
    error,
    `una foto de celular normal (por encima del cap, por debajo del techo de la plataforma) fue ` +
      `rechazada con "${error ?? ''}": el dueño no puede publicar con las fotos que saca su ` +
      'teléfono',
  ).toBeNull();
  // Con reintento: el `count` que devuelve el helper es una lectura congelada de reporte, y una
  // aserción de cantidad no puede depender de en qué milisegundo se leyó el DOM.
  await expect(loadedPhotos(page), 'la foto grande no se sumó a la pantalla').toHaveCount(2, {
    timeout: 30_000,
  });
  expect(
    await listingPhotoCount(listingId),
    'la pantalla muestra 2 fotos pero la base tiene otra cosa',
  ).toBe(2);
});

test('el equipo llega a las tres fotos aunque las tres vengan del teléfono sin achicar', async () => {
  test.setTimeout(180_000);

  const { error } = await tryAddPhoto(page, await overCapPhotoUpload(), MIN_PHOTOS_TO_PUBLISH);

  expect(error, `la tercera foto grande fue rechazada con "${error ?? ''}"`).toBeNull();
  await expect(
    loadedPhotos(page),
    'la tercera foto no se sumó a la pantalla',
  ).toHaveCount(MIN_PHOTOS_TO_PUBLISH, { timeout: 30_000 });
  expect(
    await listingPhotoCount(listingId),
    'la base no tiene las 3 fotos que muestra la pantalla',
  ).toBe(MIN_PHOTOS_TO_PUBLISH);

  // El cierre del camino: la razón por la que todo esto importa es que el equipo se pueda publicar.
  await expect(
    page.getByTestId('faltan-fotos'),
    'con 3 fotos cargadas la pantalla sigue diciendo que faltan',
  ).toHaveCount(0);
  await expect(
    page.getByTestId('submit-publicar'),
    'con las 3 fotos del teléfono el equipo tiene que poder publicarse',
  ).toBeEnabled();

  await expect(
    loadedPhotos(page),
    'la cuenta de fotos en pantalla dejó de coincidir',
  ).toHaveCount(MIN_PHOTOS_TO_PUBLISH, { timeout: 30_000 });
});
