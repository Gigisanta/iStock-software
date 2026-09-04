/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  S2 · cargar un equipo son DOS pantallas y UNA foto por request. Owner: `qa-agent`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## La regla de negocio, en una línea
 * El dueño carga el equipo con una foto, cae en la pantalla de fotos, suma las otras dos de a una,
 * y recién con tres puede publicar.
 *
 * ## Por qué el flujo es así, y por qué eso es una regla y no una preferencia de UX
 * El POST del alta no termina en una extensión conocida, así que cae en el catch-all del `matcher`
 * de `proxy.ts` y lo procesa el **Routing Middleware de Vercel**, cuyo request body está capado en
 * 4 MB, no varía por plan y no se evade con streaming (verificado por el LEAD contra la doc oficial
 * el 2026-08-27, `docs/research/vercel-request-body-limit.md`). Tres fotos de celular son ~9 MB.
 *
 * O sea: **el diseño de "cargá las 3 fotos y dale enviar" no es lento, es imposible.** Y falla de
 * la peor manera —la plataforma corta el request antes de que ningún código nuestro se entere— así
 * que no hay mensaje que mostrar ni error que loguear. Por eso el flujo de dos pantallas se prueba
 * como se prueba una regla: si alguien vuelve a poner `multiple` en el input, esto se pone rojo el
 * mismo día y no el día que un dueño en Cipolletti sube dos fotos de un iPhone 15.
 *
 * ## Y por qué el catálogo es obligatorio
 * `checkPublishable()` de `@istock/domain` deniega `missing_catalog_model` para todo `kind: 'unit'`
 * y **esa regla se queda** (ratificado por el LEAD). Una unidad sin modelo de catálogo no se puede
 * publicar, no se filtra en la vidriera y el chatbot no la puede contestar. Entonces el alta tiene
 * que pedirlo: si no lo pidiera, el dueño terminaría con un borrador que no puede publicar y sin
 * ninguna pantalla que le diga por qué.
 *
 * `catalog_models` es una tabla **global** (sin `tenant_id`): las opciones se cruzan contra la base
 * para probar que el `<select>` ofrece el catálogo real y no una lista hardcodeada en el JSX.
 *
 * ## Qué NO se prueba acá
 * Los bytes de las variantes: eso es `s2-la-foto-del-duenio-llega-en-150kb.spec.ts`. Acá alcanza
 * con que las miniaturas apunten a la variante `thumb` y no al original.
 *
 * `qa-agent` no arregla el código bajo test. Si esto se pone rojo, el defecto es de la impl.
 */

import type { Page } from '@playwright/test';
import { expect, test } from './_lib/fixtures';
import {
  catalogModelRows,
  deleteTenantBySlug,
  deleteUserByEmail,
  listingById,
  listingPhotoCount,
  listingPhotoRows,
  listingsByTenant,
  purgeE2eFixtures,
  tenantIdBySlug,
} from './_lib/db';
import { APEX_URL, E2E_APEX_HOST, E2E_PORT, FIXTURE_PREFIX, uniqueEmail, uniqueSlug } from './_lib/env';
import { ownersPhotoUpload } from './_lib/photo';
import {
  addPhoto,
  catalogOptions,
  createUnitDraft,
  createBusiness,
  loadedPhotos,
  missingPhotosText,
  NEW_UNIT_PATH,
  PHOTOS_URL_RE,
  setField,
  signIn,
  STOCK_URL_RE,
} from './_lib/panel';

/**
 * Serial y con una sola página: los tests recorren **un** camino de dueño y cada uno empieza donde
 * terminó el anterior. Un `beforeEach` que volviera a cargar el equipo desde cero no probaría el
 * flujo, probaría el alta tres veces.
 */
test.describe.configure({ mode: 'serial' });

const slug = uniqueSlug('flujo');
const email = uniqueEmail('flujo');

/** 15 dígitos. `listings_imei_format` exige `^[0-9]{15}$`. */
const imei = `35${String(Date.now()).slice(-13)}`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** Las 3 fotos que `MIN_PHOTOS_TO_PUBLISH` exige, escrito a mano. No se importa del dominio. */
const MIN_PHOTOS_TO_PUBLISH = 3;

let page: Page;
let tenantId = '';
let listingId = '';

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  await purgeE2eFixtures(FIXTURE_PREFIX);

  page = await browser.newPage();
  await signIn(page, email);
  await createBusiness(page, { name: 'Cel Cipolletti Flujo', slug });

  const id = await tenantIdBySlug(slug);
  if (id === null) throw new Error(`el tenant ${slug} no quedó en la base`);
  tenantId = id;
});

test.afterAll(async () => {
  await page.close();
  await deleteTenantBySlug(slug);
  await deleteUserByEmail(email);
});

test('el link de la vidriera usa el host y puerto de la request local', async () => {
  await page.goto(`${APEX_URL}/app`);

  const storefront = page.getByRole('link', {
    name: `${slug}.${E2E_APEX_HOST}:${String(E2E_PORT)}`,
    exact: true,
  });
  await expect(storefront).toHaveAttribute(
    'href',
    `http://${slug}.${E2E_APEX_HOST}:${String(E2E_PORT)}`,
  );
});

test('el alta pide una sola foto y no deja adjuntar varias en el mismo envío', async () => {
  await page.goto(`${APEX_URL}${NEW_UNIT_PATH}`);

  const input = page.getByTestId('input-foto');
  await expect(
    input,
    `${NEW_UNIT_PATH} no expone data-testid="input-foto" (contrato de la ronda 2)`,
  ).toBeAttached({ timeout: 20_000 });

  // `multiple` es el atributo que decide si el navegador deja elegir 2 archivos. Con él puesto, el
  // dueño puede armar un POST de 9 MB que el Routing Middleware corta a los 4 MB sin que llegue a
  // nuestro código: no hay mensaje que mostrar porque no hay request que atender.
  expect(
    await input.getAttribute('multiple'),
    'el input de foto del alta tiene `multiple`: dos fotos de celular pasan los 4 MB del Routing ' +
      'Middleware de Vercel y el request muere antes de llegar a la Server Action',
  ).toBeNull();

  expect(
    await input.getAttribute('name'),
    'el campo de la foto tiene que llamarse `photo` (singular): el contrato de la ronda 2 cambió ' +
      '`photos` por `photo` justamente porque ya no viaja una lista',
  ).toBe('photo');

  // Aserción de **ausencia**: acá el reintento no agrega nada (cero se cumple al instante), y lo
  // que impide el falso verde es el `toBeAttached` de arriba, que ya probó que el formulario está
  // servido. Igual va como aserción web-first para que en este archivo no quede ningún `.count()`
  // congelado que alguien copie mañana a un caso donde sí importa.
  await expect(
    page.locator('input[name="photos"]'),
    'sobrevivió un input[name="photos"] del flujo viejo de 8 fotos en un submit',
  ).toHaveCount(0);
});

test('el selector de modelos ofrece el catálogo global real y no una lista escrita en el JSX', async () => {
  await page.goto(`${APEX_URL}${NEW_UNIT_PATH}`);

  const options = await catalogOptions(page);
  const models = await catalogModelRows();
  const active = models.filter((model) => model.isActive);

  expect(
    active.length,
    '`catalog_models` está vacía: es una tabla GLOBAL que siembra `pnpm db:seed`. Sin ella el alta ' +
      'de una unidad no se puede completar nunca y este spec no estaría probando nada',
  ).toBeGreaterThan(0);

  // Cada opción es una fila real y **activa**. Un `<select>` con los modelos hardcodeados en el
  // componente se vería idéntico en pantalla y fallaría acá: los ids no existirían en la base.
  const activeIds = new Set(active.map((model) => model.id));
  for (const option of options) {
    expect(
      activeIds.has(option.value),
      `la opción "${option.label}" tiene value="${option.value}", que no es el id de ningún ` +
        'modelo activo de `catalog_models`: el select no sale del catálogo',
    ).toBe(true);
  }

  expect(
    options.length,
    `el select ofrece ${options.length} modelos y el catálogo tiene ${active.length} activos`,
  ).toBe(active.length);
});

test('un equipo sin modelo de catálogo no se llega a crear, porque nunca se podría publicar', async () => {
  await page.goto(`${APEX_URL}${NEW_UNIT_PATH}`);

  // Todos los campos que no dependen del catálogo, para que el motivo verificable sea ése. El
  // nombre, los GB y el color ahora se generan desde el modelo y no se pueden completar sin él.
  await setField(page, 'condition', 'used_excellent');
  await setField(page, 'priceUsd', '430');
  await setField(page, 'batteryPct', '91');
  await page.getByTestId('input-foto').setInputFiles(await ownersPhotoUpload());

  // Todo menos el catálogo. Se manda igual: la defensa no puede ser sólo que el `<select>` esté en
  // pantalla, porque un POST armado a mano llega igual — pero desde el browser lo que se verifica
  // es lo que ve el dueño: que no termine con un borrador que nunca va a poder publicar.
  await page.getByTestId('submit-nueva-unidad').click();

  // Se espera **por el mensaje**, no por reloj ni por "a esta altura ya tendría que haber pasado".
  // Sin esta espera, las dos aserciones de abajo correrían con el POST todavía en vuelo y darían
  // verde aunque el alta terminara creando el equipo un segundo después.
  const error = page.getByTestId('error-alta');
  await expect(
    error,
    'el alta no dice nada cuando falta el modelo: o lo aceptó igual, o falló en silencio',
  ).toBeVisible({ timeout: 60_000 });
  expect(
    ((await error.textContent()) ?? '').toLowerCase(),
    'el error del alta no habla del modelo: el dueño no sabe qué campo le falta',
  ).toContain('modelo');

  await expect(
    page,
    'el alta creó el equipo sin modelo de catálogo: `checkPublishable` va a denegar ' +
      '`missing_catalog_model` para siempre y el dueño no tiene forma de enterarse',
  ).not.toHaveURL(PHOTOS_URL_RE, { timeout: 20_000 });

  const listings = await listingsByTenant(tenantId);
  expect(
    listings.length,
    `quedaron ${listings.length} equipos en la base después de un alta que no eligió modelo`,
  ).toBe(0);
});

test('cargar el equipo con su primera foto lo deja en borrador y lleva a la pantalla de fotos', async () => {
  test.setTimeout(180_000);

  const created = await createUnitDraft(page, {
    title: 'iPhone 14 Pro 256 Grafito',
    condition: 'used_excellent',
    storageGb: 256,
    color: 'Grafito',
    priceUsd: 620,
    batteryPct: 89,
    imei,
    costUsd: 500,
    catalogModelHint: 'iPhone 14 Pro',
    photo: await ownersPhotoUpload(),
  });
  listingId = created.listingId;

  expect(listingId, 'el redirect no lleva un id de listing en la URL').toMatch(UUID_RE);

  const row = await listingById(listingId);
  expect(row, `el listing ${listingId} de la URL no existe en la base`).not.toBeNull();
  expect(
    row?.tenantId,
    'el redirect lleva al equipo de otro tenant: el alta guardó mal el dueño',
  ).toBe(tenantId);

  // El modelo elegido en el `<select>` es el que quedó en la fila. Sin esto, el campo podría
  // existir en la pantalla, validarse, y perderse en el camino al `insert`.
  expect(
    row?.catalogModelId,
    'el modelo de catálogo que eligió el dueño no llegó a `listings.catalog_model_id`',
  ).toBe(created.catalogModel.value);

  expect(row?.status, 'un equipo con una sola foto no puede nacer publicado').toBe('draft');

  expect(
    await listingPhotoCount(listingId),
    'el alta tiene que dejar exactamente la foto que se mandó: ni cero ni dos',
  ).toBe(1);
});

test('con una sola foto la pantalla avisa que faltan dos y no deja publicar todavía', async () => {
  // Web-first y con reintento: el `.count()` que había acá se leía apenas la URL matcheaba y daba
  // 0 con la pantalla todavía en camino, o sea que el rojo culpaba al alta de un problema de la
  // ruta. `toHaveCount` afirma exactamente lo mismo sin depender de cuándo resuelva el server.
  await expect(
    loadedPhotos(page),
    'la pantalla de fotos no muestra la foto del alta',
  ).toHaveCount(1, { timeout: 30_000 });

  const aviso = await missingPhotosText(page);
  expect(
    aviso,
    'con 1 de 3 fotos no hay ningún data-testid="faltan-fotos" en pantalla: el dueño no tiene ' +
      'forma de saber por qué el botón de publicar no le responde',
  ).not.toBeNull();
  // Se afirma **el número** y una frase mínima, no el texto exacto: el copy rioplatense se sigue
  // ajustando (y cambia de plural a singular cuando falta una sola). Un test de conteo que se
  // rompe porque alguien mejoró una palabra no está probando el conteo.
  expect(
    aviso ?? '',
    `el aviso dice "${aviso ?? ''}" y con 1 de ${String(MIN_PHOTOS_TO_PUBLISH)} fotos faltan 2`,
  ).toMatch(/\b2\b/u);
  expect(aviso ?? '', 'el aviso no dice para qué hacen falta las fotos').toContain(
    'para poder publicar',
  );

  await expect(
    page.getByTestId('submit-publicar'),
    'publicar está habilitado con 1 foto y `MIN_PHOTOS_TO_PUBLISH` son 3',
  ).toBeDisabled();
});

test('la segunda foto sube sola en su propio envío y el aviso pasa a decir que falta una', async () => {
  test.setTimeout(180_000);

  await addPhoto(page, await ownersPhotoUpload(), 2);

  await expect(loadedPhotos(page), 'la segunda foto no aparece en la pantalla').toHaveCount(2, {
    timeout: 30_000,
  });
  expect(
    await listingPhotoCount(listingId),
    'la pantalla muestra 2 fotos pero la base tiene otra cosa',
  ).toBe(2);

  const aviso = await missingPhotosText(page);
  expect(aviso, 'con 2 de 3 fotos el aviso desapareció antes de tiempo').not.toBeNull();
  // Singular: "Falta 1 foto para poder publicar". Por eso se afirma el número y la frase, y no la
  // oración entera.
  expect(aviso ?? '', `el aviso dice "${aviso ?? ''}" y con 2 de 3 falta 1`).toMatch(/\b1\b/u);
  expect(aviso ?? '', 'el aviso no dice para qué hace falta la foto').toContain(
    'para poder publicar',
  );

  await expect(
    page.getByTestId('submit-publicar'),
    'publicar está habilitado con 2 fotos',
  ).toBeDisabled();
});

test('con la tercera foto desaparece el aviso y el equipo por fin se puede publicar', async () => {
  test.setTimeout(180_000);

  await addPhoto(page, await ownersPhotoUpload(), MIN_PHOTOS_TO_PUBLISH);

  await expect(
    loadedPhotos(page),
    'la tercera foto no aparece en la pantalla',
  ).toHaveCount(MIN_PHOTOS_TO_PUBLISH, { timeout: 30_000 });
  expect(
    await listingPhotoCount(listingId),
    'la pantalla muestra 3 fotos pero la base tiene otra cosa',
  ).toBe(MIN_PHOTOS_TO_PUBLISH);

  await expect(
    page.getByTestId('faltan-fotos'),
    'el aviso de fotos faltantes sigue en pantalla con las 3 fotos cargadas',
  ).toHaveCount(0);

  await expect(
    page.getByTestId('submit-publicar'),
    'con las 3 fotos que exige `MIN_PHOTOS_TO_PUBLISH`, publicar tiene que estar habilitado',
  ).toBeEnabled();
});

test('las miniaturas de la pantalla de fotos sirven la variante thumb y nunca el original', async () => {
  const rows = await listingPhotoRows(listingId);
  expect(rows.length, 'la base no tiene las 3 fotos del equipo').toBe(MIN_PHOTOS_TO_PUBLISH);

  // El testid está en el `<img>` mismo (aclarado por el LEAD), no en un wrapper: buscar
  // `[data-testid=foto-cargada] img` daría 0 y el rojo diría "no hay fotos" en vez de la verdad.
  const imgs = loadedPhotos(page);
  // El mensaje ya no interpola el conteo: interpolarlo obligaría a leerlo **antes** del reintento
  // y el rojo diría "hay 0" aunque al vencer hubiera 2. Playwright imprime el recibido contra el
  // esperado; el mensaje dice la regla.
  await expect(
    imgs,
    'no hay 3 <img> de foto cargada en pantalla: sin las tres miniaturas no hay src que mirar',
  ).toHaveCount(MIN_PHOTOS_TO_PUBLISH, { timeout: 30_000 });

  // Recién acá se congela: la cantidad ya está afirmada, y lo que sigue es leer los `src` de esos
  // nodos. Un `.count()` para iterar sobre algo cuya cantidad ya se esperó no es una aserción.
  const total = await imgs.count();
  const srcs: string[] = [];
  for (let index = 0; index < total; index += 1) {
    srcs.push((await imgs.nth(index).getAttribute('src')) ?? '');
  }
  const joined = srcs.join(' ');

  for (const row of rows) {
    expect(
      joined.includes(row.thumbKey),
      `ninguna miniatura apunta a la key thumb ${row.thumbKey}. Srcs: ${joined}`,
    ).toBe(true);

    // El master es el archivo que existe para NO servirse (bucket privado, ADR-006). `detail` pesa
    // 128 KB y en una grilla de 3 son 385 KB para mostrar tres cuadraditos.
    expect(
      joined.includes(row.masterKey),
      `una miniatura apunta al master ${row.masterKey}: CLAUDE.md §2, el original nunca se sirve`,
    ).toBe(false);
    expect(
      joined.includes(row.detailKey),
      `una miniatura apunta a la variante detail ${row.detailKey} en vez de a thumb`,
    ).toBe(false);
  }

  expect(
    joined.includes('.jpg'),
    'una miniatura apunta a un `.jpg`: el pipeline emite WebP y el original no se sirve',
  ).toBe(false);
});

test('publicar el equipo lo deja disponible y devuelve al dueño al stock a cargar el siguiente', async () => {
  test.setTimeout(120_000);

  await page.getByTestId('submit-publicar').click();

  // El redirect no es un detalle de UX: el *done cobrable* de `CLAUDE.md` es "carga 15 equipos en
  // una tarde". Después de publicar el equipo N, lo próximo que hace el dueño es cargar el N+1, y
  // el botón de alta vive en `/app/stock`. Quedarse en la pantalla de fotos de una unidad ya
  // publicada es un callejón sin salida: 15 veces son 15 vueltas atrás.
  await expect(
    page,
    'publicar dejó al dueño en la pantalla de fotos del equipo que acaba de publicar',
  ).toHaveURL(STOCK_URL_RE, { timeout: 60_000 });

  const row = await listingById(listingId);
  expect(
    row?.status,
    `el equipo quedó en "${row?.status ?? '(sin fila)'}" después de publicar: la máquina de ` +
      'estados va draft → available',
  ).toBe('available');
});
