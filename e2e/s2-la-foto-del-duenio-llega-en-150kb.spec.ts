/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  S2 · gate del board: **3 variantes generadas y `card` ≤ 150 KB medido**. Owner: `qa-agent`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## Qué se prueba acá que no prueba `packages/media`
 * Los unit tests de `packages/media` prueban que la **función** produce tres WebP dentro de sus
 * techos. Eso ya está cerrado y medido por el LEAD sobre la fixture de referencia:
 *
 * ```
 * fuente  4000×3000 JPEG   3.006.369 B
 * thumb    200×150             7.718 B
 * card     800×600            50.692 B   ← el gate
 * detail  1600×1200         128.570 B
 * master  1600×1200         313.980 B    (istock-originals, privado)
 * ```
 *
 * Lo que falta —y es lo único que puede fallar de acá en más— es el **camino del panel** hasta esa
 * función: el `<input type="file">`, el request, el DAL que inserta el mapeo, la ruta que sirve el
 * objeto. Ese camino tiene tres formas conocidas de arruinar el trabajo del paquete, y las tres
 * pasan cualquier unit test:
 *
 *   1. **Servir el original.** El formulario guarda el archivo tal cual y la lista lo muestra:
 *      3 MB por foto, `CLAUDE.md` §2 ("imagen original >500 KB servida a la vidriera → rechazo").
 *   2. **Rehacer la imagen.** El panel re-encodea, o pide `detail` y lo escala en el browser, o
 *      mete Vercel Image Optimization en el medio (prohibido, §3). Los bytes dejan de ser los
 *      medidos y el costo se va a otro lado.
 *   3. **Filtrar la key.** La URL termina llevando `tenant_id`/`listing_id`, o el master queda
 *      alcanzable desde la web. §2 lo marca como rechazo automático las dos veces.
 *
 * ## Cómo se mide, y por qué así
 * - **Se descarga el objeto y se cuentan los bytes del cuerpo.** No se lee `listing_photos.
 *   card_bytes`: eso es lo que el server *cree*. Lo que le cuesta datos al comprador es la
 *   respuesta HTTP. (La columna se compara aparte, para que tampoco pueda mentir.)
 * - **El techo de 150 KB está escrito a mano** (`CARD_MAX_BYTES` en `_lib/media.ts`), duplicado a
 *   propósito respecto de `VARIANT_SPECS.card.budgetBytes`. Si se leyera la constante del código
 *   bajo test, subir la constante pondría el test en verde y el guard dejaría de guardar.
 * - **Se verifica el hash contra la key.** La key pública *es* el SHA-256/32 del byte de salida
 *   (ADR-006). Si el hash del cuerpo descargado coincide, el objeto que bajó es **exactamente** el
 *   que produjo el pipeline: ningún re-encode intermedio sobrevive a esa comparación. Es una
 *   afirmación mucho más fuerte que "pesa poco", y no depende de la versión de libvips.
 * - **Se leen las dimensiones de la cabecera WebP.** El hash prueba que el byte no se tocó; el
 *   tamaño prueba que el pipeline estaba configurado con los tamaños correctos. Un `card` de
 *   1600 px con hash consistente sigue siendo un `card` que no es un `card`.
 *
 * ## RONDA 2 · el gate se mide con una foto que está POR DEBAJO del cap, a propósito
 * El cap de la app es `MAX_PHOTO_BYTES` = 3 MiB y el diseño que cerró el LEAD dice que el
 * **downscale del cliente sólo se activa si el archivo lo supera**. O sea: por debajo del cap el
 * byte que el dueño eligió viaja intacto hasta el server.
 *
 * Eso es lo que hace que este gate signifique algo. Si la fixture estuviera por encima del cap, el
 * navegador la re-encodearía antes de subirla y **lo que se estaría midiendo sería el `canvas` de
 * Chromium**: una imagen ya achicada por el browser entra al pipeline y sale liviana casi por
 * definición. El test daría verde con el pipeline del server roto. Un gate que mide el browser no
 * guarda nada.
 *
 * Por eso hay un test dedicado —"la foto del gate entra sin que el navegador la toque"— que afirma
 * la banda. No es una verificación de la fixture: es la **precondición** de todos los bytes que se
 * miden abajo, y tiene que fallar ruidosamente el día que la fixture o el cap se muevan.
 *
 * ## RONDA 2 · una foto por request
 * El alta manda **una** foto y redirige a `/app/stock/{id}/fotos` (el techo de 4 MB del Routing
 * Middleware de Vercel no deja más; ver `_lib/panel.ts` y `_lib/photo.ts`). El gate mide esa
 * primera foto: las otras dos que exige `MIN_PHOTOS_TO_PUBLISH` no agregarían acá ninguna
 * afirmación que no esté ya —son el mismo pipeline sobre el mismo byte— y cuestan un minuto de
 * corrida. El flujo completo de las tres lo recorre
 * `s2-cargar-un-equipo-es-una-foto-por-request.spec.ts`.
 *
 * ## Estado esperado hoy
 * **Rojo.** `/app/stock/nuevo` no existe todavía (`app-agent` lo está construyendo en paralelo) y
 * `/app/stock` es una pantalla vacía sin `data-testid="fila-unidad"`. El rojo tiene que ser
 * "no está el formulario del contrato", no un typo.
 *
 * `qa-agent` no arregla el código bajo test. Si esto se pone rojo, el defecto es de la impl.
 */

import { expect, test } from './_lib/fixtures';
import {
  deleteTenantBySlug,
  deleteUserByEmail,
  listingPhotoRows,
  listingsByTenant,
  purgeE2eFixtures,
  tenantIdBySlug,
  type ListingPhotoKeysRow,
} from './_lib/db';
import { APEX_URL, FIXTURE_PREFIX, uniqueEmail, uniqueSlug } from './_lib/env';
import {
  absoluteSrc,
  BASELINE_BYTES,
  BASELINE_SIZE,
  CARD_MAX_BYTES,
  DETAIL_MAX_BYTES,
  fetchObject,
  hashInKey,
  IMMUTABLE_CACHE_CONTROL,
  mediaBaseFromSrc,
  PUBLIC_KEY_RE,
  statusOf,
  THUMB_MAX_BYTES,
  WEBP_CONTENT_TYPE,
} from './_lib/media';
import { MAX_PHOTO_BYTES, ownersPhotoUpload, SOURCE_MIN_BYTES } from './_lib/photo';
import { createBusiness, createUnitDraft, signIn, STOCK_PATH } from './_lib/panel';

/**
 * Un solo camino de alta para todos los tests: el journey del panel cuesta ~1 min (login, negocio,
 * 12 MP subidos y procesados) y repetirlo por test no agregaría ninguna afirmación. Serial porque
 * todos leen el mismo estado y porque si el alta no ocurre, medir bytes no significa nada.
 */
test.describe.configure({ mode: 'serial' });

const slug = uniqueSlug('media');
const email = uniqueEmail('media');
const businessName = 'Patagonia Cel Vermkt';

/** 15 dígitos, único por corrida. `listings_imei_format` exige `^[0-9]{15}$`. */
const imei = `35${String(Date.now()).slice(-13)}`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

interface Observed {
  readonly tenantId: string;
  readonly listingId: string;
  readonly photo: ListingPhotoKeysRow;
  /** `src` de `<img data-testid="thumb-unidad">`, ya resuelto a absoluto. */
  readonly thumbSrc: string;
  /** Base del CDN **derivada del panel**, no de una env var del test. */
  readonly mediaBase: string;
  /** HTML completo de `/app/stock`, incluido el payload de Flight. */
  readonly stockHtml: string;
  readonly sourceBytes: number;
}

let observed: Observed | null = null;

function seen(): Observed {
  if (observed === null) {
    throw new Error('el alta del hook no llegó a completarse: no hay nada que medir');
  }
  return observed;
}

function url(key: string): string {
  return `${seen().mediaBase}/${key}`;
}

test.beforeAll(async ({ browser }) => {
  // El hook hace el journey entero + genera un JPEG de 12 MP (~4 s de CPU). El default de 90 s
  // del config es para un test, no para esto.
  test.setTimeout(240_000);

  await purgeE2eFixtures(FIXTURE_PREFIX);

  const upload = await ownersPhotoUpload();

  const page = await browser.newPage();
  try {
    await signIn(page, email);
    await createBusiness(page, { name: businessName, slug });

    const { listingId } = await createUnitDraft(page, {
      title: 'iPhone 14 Pro 256 Grafito',
      condition: 'used_excellent',
      storageGb: 256,
      color: 'Grafito',
      priceUsd: 620,
      batteryPct: 89,
      imei,
      costUsd: 500,
      catalogModelHint: 'iPhone 14 Pro',
      photo: upload,
    });

    // El alta termina en `/app/stock/{id}/fotos`. La lista es otra pantalla y es donde vive la
    // miniatura que este spec mide, así que se navega: leer el `thumb` de la pantalla de fotos
    // mediría la variante de la pantalla de fotos, que no es la que ve el dueño en su stock.
    await page.goto(`${APEX_URL}${STOCK_PATH}`);
    const thumb = page.getByTestId('thumb-unidad').first();
    const rawSrc = await thumb.getAttribute('src');
    if (rawSrc === null || rawSrc.length === 0) {
      throw new Error('<img data-testid="thumb-unidad"> no tiene src');
    }
    const thumbSrc = absoluteSrc(rawSrc, page.url());

    // El HTML se congela **después** de esperar la miniatura, no antes. `page.content()` es una
    // foto del DOM en ese instante: tomada apenas vuelve el `goto`, con una ruta que transmite
    // capturaba el shell vacío y las aserciones de más abajo se volvían sobre una página que
    // todavía no existía. El control positivo (`toContain(listingId)`) las salvaba de pasar por
    // vacío, pero a cambio de un rojo que culpaba a la lista de un problema de sincronización.
    // `getAttribute` sobre el locator sí espera al elemento: cuando vuelve, hay algo que capturar.
    const stockHtml = await page.content();

    const tenantId = await tenantIdBySlug(slug);
    if (tenantId === null) throw new Error(`el tenant ${slug} no quedó en la base`);

    const rows = await listingPhotoRows(listingId);
    const photo = rows[0];
    if (photo === undefined) {
      throw new Error(
        `listing_photos no tiene ninguna fila para ${listingId}: la foto no llegó al mapeo`,
      );
    }

    observed = {
      tenantId,
      listingId,
      photo,
      thumbSrc,
      mediaBase: mediaBaseFromSrc(thumbSrc, photo.thumbKey),
      stockHtml,
      sourceBytes: upload.buffer.byteLength,
    };
  } finally {
    await page.close();
  }
});

// `closeDb()` NO va acá: el pool es de la suite y lo cierra el fixture de worker de
// `_lib/fixtures.ts`.
test.afterAll(async () => {
  await deleteTenantBySlug(slug);
  await deleteUserByEmail(email);
});

test('la foto del gate sube entera porque está debajo del cap: lo que se mide es el server', async () => {
  const it = seen();

  // La banda, escrita como tres desigualdades en vez de como un número, porque lo que importa no
  // es cuánto pesa la fixture sino **de qué lado del cap cae**:
  //
  //   SOURCE_MIN_BYTES  <  fixture  <  MAX_PHOTO_BYTES
  //     2.500.000          3.006.369    3.145.728
  //
  // Por debajo del piso, el gate de 150 KB se cumpliría solo (una miniatura sale liviana). Por
  // encima del cap, el downscale del cliente se activa y el archivo que llega al pipeline lo
  // produce Chromium: el gate pasaría a medir el `canvas` del navegador y daría verde con el
  // server roto. El único lugar donde este spec afirma algo sobre el pipeline es en el medio.
  expect(
    it.sourceBytes,
    `la fixture encogió a ${it.sourceBytes} B: con eso el techo de card se cumple solo`,
  ).toBeGreaterThanOrEqual(SOURCE_MIN_BYTES);

  expect(
    it.sourceBytes,
    `la fixture pesa ${it.sourceBytes} B y el cap de la app son ${MAX_PHOTO_BYTES} B: por encima ` +
      'del cap la achica el navegador antes de subirla, y este spec pasaría a medir el re-encode ' +
      'de Chromium en vez del pipeline de @istock/media. Un gate que mide el browser no guarda nada',
  ).toBeLessThan(MAX_PHOTO_BYTES);

  // Que la banda exista. Si alguien bajara `MAX_PHOTO_BYTES` por debajo del piso, las dos
  // aserciones de arriba serían incumplibles a la vez y el rojo diría "la fixture pesa mal"
  // cuando el problema es que ya no hay ninguna foto que pueda probar esto.
  expect(
    SOURCE_MIN_BYTES,
    'el piso de la fixture quedó por encima del cap de la app: no queda banda donde medir el ' +
      'pipeline del server con una foto real',
  ).toBeLessThan(MAX_PHOTO_BYTES);
});

test('la unidad recién cargada aparece en el stock con su miniatura y su id de listing', async () => {
  const it = seen();

  expect(
    it.listingId,
    `data-listing-id="${it.listingId}" no es un UUID: la fila no está identificando al listing`,
  ).toMatch(UUID_RE);

  const listings = await listingsByTenant(it.tenantId);
  expect(
    listings.map((l) => l.id),
    'el listing que muestra la lista no es del tenant que se acaba de crear',
  ).toContain(it.listingId);

  expect(
    it.thumbSrc,
    'la miniatura del panel apunta al archivo original en vez de a la variante `thumb`',
  ).not.toContain('.jpg');
});

test('la miniatura del panel se sirve como WebP inmutable y no como el JPEG del celular', async ({
  request,
}) => {
  const it = seen();
  const got = await fetchObject(request, it.thumbSrc);

  expect(got.status, `${it.thumbSrc} no se puede descargar`).toBe(200);
  expect(
    got.contentType,
    `la miniatura viaja como ${got.contentType || '(sin content-type)'}: el pipeline emite WebP`,
  ).toContain(WEBP_CONTENT_TYPE);
  expect(
    got.cacheControl,
    'la key lleva el hash del contenido: el objeto es inmutable y se cachea un año (contrato de S2)',
  ).toBe(IMMUTABLE_CACHE_CONTROL);

  // Techo literal, escrito a mano. No se lee `VARIANT_SPECS.thumb.budgetBytes`.
  expect(got.bytes, `thumb pesa ${got.bytes} B`).toBeLessThanOrEqual(THUMB_MAX_BYTES);
  expect(
    got.sha32,
    'el byte que bajó no es el que produjo el pipeline: algo lo re-encodeó en el camino',
  ).toBe(hashInKey(it.photo.thumbKey));
  expect(got.size, 'la respuesta no es un WebP parseable').not.toBeNull();
  expect(got.size, `el panel está sirviendo una variante que no es thumb`).toEqual(
    BASELINE_SIZE.thumb,
  );
});

test('la variante card que se sirve por HTTP pesa 150 KB o menos, contados en el cuerpo', async ({
  request,
}) => {
  const it = seen();
  const cardUrl = url(it.photo.cardKey);
  const got = await fetchObject(request, cardUrl);

  expect(got.status, `${cardUrl} no se puede descargar`).toBe(200);
  expect(got.contentType, 'la vidriera sirve WebP, no el formato de la cámara').toContain(
    WEBP_CONTENT_TYPE,
  );

  // ── EL GATE DE S2 ────────────────────────────────────────────────────────────────────────────
  // 153.600 = 150 KiB, literal. Duplicado a propósito respecto de la constante del paquete: si se
  // leyera de ahí, subir la constante pondría este test en verde.
  expect(
    got.bytes,
    `card pesa ${got.bytes} B servidos por HTTP y el techo son 153.600 B (150 KiB)`,
  ).toBeLessThanOrEqual(CARD_MAX_BYTES);

  // Piso: un `card` de 3 KB no es un card, es un placeholder o un error servido con 200.
  expect(got.bytes, 'card pesa demasiado poco para ser una foto de producto').toBeGreaterThan(
    10_000,
  );

  expect(
    got.sha32,
    'el cuerpo descargado no hashea a su propia key: el objeto se rehizo después del pipeline',
  ).toBe(hashInKey(it.photo.cardKey));
  expect(got.size, 'card tiene que salir a 800 px de lado mayor').toEqual(BASELINE_SIZE.card);

  // El LEAD midió 50.692 B con esta misma fixture. Una desviación grande no es "otra libvips":
  // es el panel degradando o rehaciendo la imagen, que es el modo de falla que S2 vigila.
  const drift = Math.abs(got.bytes - BASELINE_BYTES.card) / BASELINE_BYTES.card;
  expect(
    drift,
    `card mide ${got.bytes} B contra el baseline de ${BASELINE_BYTES.card} B medido por el LEAD ` +
      'sobre la misma foto: el camino del panel no está usando el pipeline tal cual',
  ).toBeLessThan(0.4);
});

test('la ruta de imágenes permite medir recursos cross-origin para el LCP', async ({ request }) => {
  const it = seen();
  const response = await request.get(url(it.photo.cardKey), { maxRedirects: 0 });
  await response.body();

  expect(
    response.headers()['timing-allow-origin'],
    'la vidriera y el CDN viven en subdominios distintos: sin Timing-Allow-Origin la Performance API ' +
      'oculta transferSize y cualquier presupuesto de LCP queda midiendo cero',
  ).toBe('*');
});

test('las tres variantes existen como objetos distintos y alcanzables, no dos', async ({
  request,
}) => {
  const it = seen();
  const keys = {
    thumb: it.photo.thumbKey,
    card: it.photo.cardKey,
    detail: it.photo.detailKey,
  };

  expect(
    new Set(Object.values(keys)).size,
    `las keys de las variantes se repiten (${JSON.stringify(keys)}): no son tres objetos`,
  ).toBe(3);

  const detail = await fetchObject(request, url(keys.detail));
  const card = await fetchObject(request, url(keys.card));
  const thumb = await fetchObject(request, url(keys.thumb));

  for (const [variant, got] of [
    ['thumb', thumb],
    ['card', card],
    ['detail', detail],
  ] as const) {
    expect(got.status, `la variante ${variant} no está en ${got.url}`).toBe(200);
    expect(got.contentType, `la variante ${variant} no es WebP`).toContain(WEBP_CONTENT_TYPE);
    expect(got.sha32, `la variante ${variant} no hashea a su key`).toBe(hashInKey(keys[variant]));
    expect(got.size, `la variante ${variant} salió con otro tamaño`).toEqual(
      BASELINE_SIZE[variant],
    );
  }

  expect(detail.bytes, `detail pesa ${detail.bytes} B`).toBeLessThanOrEqual(DETAIL_MAX_BYTES);

  // Tres tamaños distintos: si `thumb` y `card` pesan lo mismo, hay una sola imagen con tres keys.
  expect(
    thumb.bytes < card.bytes && card.bytes < detail.bytes,
    `thumb ${thumb.bytes} · card ${card.bytes} · detail ${detail.bytes}: no hay tres resizes`,
  ).toBe(true);

  // Lo público por foto contra lo que salió del celular: el original nunca se sirve.
  const publicBytes = thumb.bytes + card.bytes + detail.bytes;
  expect(
    publicBytes,
    `las tres variantes suman ${publicBytes} B contra un original de ${it.sourceBytes} B`,
  ).toBeLessThanOrEqual(425 * 1024);
});

test('ninguna URL pública de foto revela el tenant, el listing ni el IMEI del equipo', async () => {
  const it = seen();
  const masterHash = /([0-9a-f]{32})\.webp$/u.exec(it.photo.masterKey)?.[1] ?? '(sin hash)';

  /** Valores reales de ESTA corrida. Un regex genérico no probaría que no se filtró lo de acá. */
  const forbidden: ReadonlyArray<readonly [string, string]> = [
    ['tenant_id', it.tenantId],
    ['tenant_id sin guiones', it.tenantId.replace(/-/gu, '')],
    ['listing_id', it.listingId],
    ['listing_id sin guiones', it.listingId.replace(/-/gu, '')],
    ['IMEI', imei],
    ['slug del negocio', slug],
    ['mail del dueño', email],
    ['nombre del archivo del celular', 'IMG_20260827'],
    ['hash del master', masterHash],
  ];

  for (const [variant, key] of [
    ['thumb', it.photo.thumbKey],
    ['card', it.photo.cardKey],
    ['detail', it.photo.detailKey],
  ] as const) {
    // La forma opaca de ADR-006, escrita a mano: sin sufijo de variante no hay nada que adivinar.
    expect(key, `la key de ${variant} no tiene la forma opaca v1/{ab}/{sha256_32}.webp`).toMatch(
      PUBLIC_KEY_RE,
    );

    const full = url(key).toLowerCase();
    for (const [label, value] of forbidden) {
      expect(
        full.includes(value.toLowerCase()),
        `la URL de ${variant} (${url(key)}) contiene el ${label}: CLAUDE.md §2, rechazo automático`,
      ).toBe(false);
    }
    // Prefijos de 8 hex del UUID: un "hash" que en realidad derive del tenant se cazaría acá.
    expect(
      full.includes(it.tenantId.replace(/-/gu, '').slice(0, 8)),
      `la URL de ${variant} arranca con el prefijo del tenant_id: la key no es opaca`,
    ).toBe(false);
  }
});

test('el master del bucket privado no es alcanzable por ninguna variación obvia de su key', async ({
  request,
}) => {
  const it = seen();
  const master = it.photo.masterKey;
  const masterHash = /([0-9a-f]{32})\.webp$/u.exec(master)?.[1] ?? '';

  expect(masterHash, `master_key ${master} no tiene la forma originals/{t}/{l}/{hash}.webp`).toMatch(
    /^[0-9a-f]{32}$/u,
  );

  // El master no puede estar reusado como variante pública: son 313 KB en el CDN y es el archivo
  // que existe para NO servirse.
  expect(
    [it.photo.thumbKey, it.photo.cardKey, it.photo.detailKey].map(hashInKey),
    'el hash del master aparece como key pública: el original quedó en el bucket público',
  ).not.toContain(masterHash);

  const base = it.mediaBase;
  const attempts: ReadonlyArray<readonly [string, string]> = [
    ['la key del master tal cual', `${base}/${master}`],
    ['la key del master URL-encodeada', `${base}/${encodeURIComponent(master)}`],
    ['traversal desde la base pública', `${base}/..%2f${master}`],
    ['el hash del master como key pública', `${base}/v1/${masterHash.slice(0, 2)}/${masterHash}.webp`],
    ['el hash del master suelto', `${base}/${masterHash}.webp`],
    ['la key del master colgando del apex', `${APEX_URL}/${master}`],
    ['el bucket privado como si fuera una ruta', `${APEX_URL}/originals/${masterHash}.webp`],
  ];

  for (const [label, candidate] of attempts) {
    const status = await statusOf(request, candidate);
    expect(
      status,
      `${label}: ${candidate} respondió ${status}. El master vive en un bucket privado y no se ` +
        'sirve nunca (ADR-006 / CLAUDE.md §2)',
    ).toBeGreaterThanOrEqual(400);
  }
});

test('el IMEI del equipo no viaja en el HTML de la lista de stock', async () => {
  const it = seen();

  // Se mira el HTML **completo**, payload de Flight incluido: el IMEI serializado adentro de un
  // `self.__next_f.push(...)` está igual de filtrado que en un `<td>`, sólo que no se ve.
  expect(
    it.stockHtml.includes(imei),
    `el IMEI ${imei} está en la respuesta de ${STOCK_PATH}. Es legítimo en la ficha de edición, ` +
      'no en la lista: CLAUDE.md §1.8 e §2',
  ).toBe(false);

  // Sin esto el test pasaría por vacío el día que la lista deje de traer la unidad.
  expect(
    it.stockHtml,
    `la lista no muestra el listing ${it.listingId}: el test estaría afirmando sobre una página vacía`,
  ).toContain(it.listingId);
});

test('la columna card_bytes de auditoría dice exactamente lo que el CDN devuelve', async ({
  request,
}) => {
  const it = seen();
  const got = await fetchObject(request, url(it.photo.cardKey));

  // El gate se mide por HTTP; esta columna es lo que `cost-auditor` va a leer cuando haya 10.000
  // fotos y nadie las pueda descargar una por una. Si miente, la auditoría de costo miente.
  expect(
    it.photo.cardBytes,
    'listing_photos.card_bytes quedó en null: el presupuesto de S2 no se puede auditar',
  ).not.toBeNull();
  expect(
    it.photo.cardBytes,
    `card_bytes dice ${String(it.photo.cardBytes)} y el CDN devuelve ${got.bytes}`,
  ).toBe(got.bytes);

  expect(
    { width: it.photo.width, height: it.photo.height },
    'width/height del mapeo no coinciden con el detail que se sirve',
  ).toEqual(BASELINE_SIZE.detail);
});
