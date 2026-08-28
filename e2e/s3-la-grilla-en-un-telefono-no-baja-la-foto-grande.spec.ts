/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  S3 · M2 del gate: **el byte que el BROWSER eligió**, no el que el pipeline generó.
 *  Owner: `qa-agent`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## Qué prueba esto que S2 no probó
 * S2 midió el objeto que `packages/media` **produce**: `card` = 50.692 B, y quedó verde. P3 es que
 * eso no alcanza. Entre el objeto guardado y la persona parada en la calle está el `<img>`, y ahí
 * decide el browser: con `srcSet` y sin `sizes`, un teléfono de 390 px CSS con DPR 3 asume
 * `sizes="100vw"`, pide 1170 px de recurso y se baja `detail` (128.570 B) por cada card de la
 * grilla. **2,5× el presupuesto, con el gate de S2 en verde.**
 *
 * Por eso este spec no mira ningún archivo fuente y no le pregunta nada a la base sobre bytes:
 * abre un teléfono de verdad, deja que el algoritmo de `srcset` elija, y mide lo que viajó.
 *
 * ## El teléfono es el equipo del ICP, no un viewport cualquiera
 * 390×844 DPR 3. La cuenta que el browser hace con el `sizes` de la grilla
 * (`45vw` en mobile): 175,5 px CSS × 3 = **526 px de recurso** → el candidato más chico que
 * alcanza es `card` (800 w). `detail` (1600 w) sólo puede ganar si el `sizes` desaparece o miente.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Cómo se cuentan los bytes, y por qué NO alcanza con `performance.getEntriesByType('resource')`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * El `inf` del gate sugiere leer `transferSize` de la Performance API. Acá eso **da 0 siempre**, y
 * no por un bug nuestro: las fotos se sirven desde otro origen que la vidriera
 * (`127.0.0.1.nip.io:3100/_media/…` contra `{slug}.127.0.0.1.nip.io:3100`, que en producción es
 * `img.maat.work` contra `{slug}.maat.work`), y para un recurso **cross-origin** el spec de
 * Resource Timing reporta `transferSize`, `encodedBodySize` y `decodedBodySize` en **0** salvo que
 * la respuesta traiga `Timing-Allow-Origin`. La ruta `/_media/[...key]` hoy no lo manda.
 *
 * O sea que un spec que confiara en la Performance API publicaría `transferSize=0` — y 0 es
 * exactamente el número que el LEAD prohibió reportar, porque significa "no vi nada" y se lee como
 * "no gasta datos".
 *
 * La medición autoritativa sale entonces de la **pila de red del browser**, vía
 * `request.sizes()` de Playwright (`responseBodySize` + `responseHeadersSize`), que no depende de
 * CORS y cuenta el byte codificado tal como llegó. La lectura de la Performance API se hace igual,
 * como control, y el spec **afirma explícitamente** cuál de las dos está mirando: un tercer test
 * la deja escrita para que el día que `/_media` mande `Timing-Allow-Origin`, las dos cuentas se
 * comparen y una discrepancia salte.
 *
 * ## Contexto limpio, o la medición es mentira
 * Toda la medición ocurre en un `browser.newContext()` **propio y recién creado**, que se navega
 * una sola vez. Un contexto reusado sirve la foto desde el cache del browser, `transferSize` da 0
 * y el gate pasaría reportando que no viajó nada. Si aun así el número saliera 0, este spec
 * **falla y no emite la línea `MEDIDO`**: el gate exige la línea y falla por ausencia, que es el
 * resultado correcto para "no pude medir".
 *
 * ## Precondiciones sembradas por SQL (y por qué no ensucian lo que se afirma)
 * `fx_settings` y `locations` no tienen pantalla hasta S5, y sin TC la vidriera no publica precios
 * en pesos y devuelve la grilla **vacía** a propósito. Se siembran por SQL (ver `_lib/db.ts`). El
 * equipo, las 3 fotos y la publicación pasan por el panel de verdad: eso es lo que produce el
 * objeto `card` que después se mide.
 *
 * `qa-agent` no arregla el código bajo test. Si esto se pone rojo, el defecto es de la impl.
 */

import type { Response as PwResponse } from '@playwright/test';
import { expect, test } from './_lib/fixtures';
import {
  deleteTenantBySlug,
  deleteUserByEmail,
  listingPhotoRows,
  listingSlugById,
  seedFxSettings,
  seedLocation,
  tenantIdBySlug,
  type ListingPhotoKeysRow,
} from './_lib/db';
import { storefrontUrl, uniqueEmail, uniqueSlug } from './_lib/env';
import { BASELINE_BYTES, CARD_MAX_BYTES } from './_lib/media';
import { ownersPhotoUpload } from './_lib/photo';
import { createBusiness, createUnitWithPhotos, publishUnit, signIn } from './_lib/panel';
import {
  imageBudgetProblems,
  imageMedidoLine,
  S3_DPR,
  S3_IMAGE_CAP_BYTES,
  S3_VIEWPORT,
  variantOfUrl,
  type ImageMeasurement,
} from './_lib/s3-measure';

test.describe.configure({ mode: 'serial' });

const slug = uniqueSlug('grid');
const email = uniqueEmail('grid');
const businessName = 'Vidriera QA Grilla';
const imei = `35${String(Date.now()).slice(-13)}`;

/**
 * Lo que el browser hizo, leído por dos caminos distintos a propósito.
 *
 * `wire` es la pila de red (autoritativo). `perf` es lo que la página puede ver de sí misma
 * (control, hoy ciego por CORS). Tenerlos separados es lo que permite afirmar *"la medición no
 * salió de la Performance API"* en vez de dejarlo implícito.
 */
interface PerfSample {
  readonly name: string;
  readonly transferSize: number;
  readonly encodedBodySize: number;
  readonly decodedBodySize: number;
}

interface Observed {
  readonly listingId: string;
  readonly listingSlug: string;
  readonly photo: ListingPhotoKeysRow;
  /** URL que el browser eligió del `srcSet` (`currentSrc` del `<img>` de la primera card). */
  readonly chosenUrl: string;
  /** Atributo `sizes` que la card llevaba puesto. Vacío = el bug de P3, tal cual. */
  readonly sizesAttr: string;
  readonly wire: { readonly bodyBytes: number; readonly headerBytes: number };
  readonly httpStatus: number;
  readonly contentType: string;
  readonly perf: PerfSample | null;
  readonly measurement: ImageMeasurement;
  readonly gridUrl: string;
}

let observed: Observed | null = null;

function seen(): Observed {
  if (observed === null) {
    throw new Error('la vidriera del fixture no llegó a medirse: no hay nada que afirmar');
  }
  return observed;
}

/**
 * Se serializa como expresión y se ejecuta en el browser. Va en forma de string porque el tsconfig
 * de los e2e declara `types: ["node"]` **sin la lib del DOM**: tipar `PerformanceResourceTiming`
 * acá adentro traería los tipos del navegador a un proceso de Node para leer cuatro números.
 *
 * **Es una expresión, no una función, y esa diferencia es la que importa.** Un string que *parece*
 * una flecha (`'el => …'`) no se ejecuta: Playwright evalúa la expresión, obtiene un objeto función
 * y lo serializa como `undefined`, sin tirar nada. Este probe funciona porque su valor final es el
 * array; si alguna vez necesita un argumento, se convierte en función de verdad y no en un string
 * con `=>` adentro. Ver el comentario de `currentSrc` más abajo: costó una corrida entera.
 */
const PERF_PROBE = `
  performance.getEntriesByType('resource').map((entry) => ({
    name: entry.name,
    transferSize: entry.transferSize,
    encodedBodySize: entry.encodedBodySize,
    decodedBodySize: entry.decodedBodySize,
  }))
`;

test.beforeAll(async ({ browser }) => {
  // Journey completo del dueño (login, negocio, 3 fotos de 12 MP procesadas server-side) más una
  // visita de vidriera. El default de 90 s del config es para un test, no para esto.
  test.setTimeout(300_000);

  const upload = await ownersPhotoUpload();

  const owner = await browser.newPage();
  let listingId: string;
  try {
    await signIn(owner, email);
    await createBusiness(owner, { name: businessName, slug });

    const tenantId = await tenantIdBySlug(slug);
    if (tenantId === null) throw new Error(`el tenant ${slug} no quedó en la base`);

    // Precondiciones sin pantalla hasta S5. Sin TC la grilla sale vacía a propósito y no habría
    // ninguna foto que medir. Ver el docblock de `seedFxSettings` en `_lib/db.ts`.
    await seedFxSettings(tenantId);
    await seedLocation(tenantId);

    const created = await createUnitWithPhotos(
      owner,
      {
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
      },
      [upload, upload],
    );
    listingId = created.listingId;

    // `createUnitWithPhotos` deja al dueño parado en la pantalla de fotos, que es donde vive el
    // botón. Sin este clic el equipo queda en `draft`, la vidriera no lo muestra y el spec mediría
    // el aire; además es el clic que invalida `storefront:{slug}`.
    await publishUnit(owner);
  } finally {
    await owner.close();
  }

  const listingSlug = await listingSlugById(listingId);
  if (listingSlug === null) throw new Error(`el listing ${listingId} no quedó en la base`);

  const rows = await listingPhotoRows(listingId);
  const photo = rows[0];
  if (photo === undefined) {
    throw new Error(`listing_photos no tiene ninguna fila para ${listingId}`);
  }

  // ── El teléfono. Contexto propio y cache fría: ver el docblock. ──────────────────────────────
  const phone = await browser.newContext({
    viewport: { width: S3_VIEWPORT.width, height: S3_VIEWPORT.height },
    deviceScaleFactor: S3_DPR,
    isMobile: true,
    hasTouch: true,
  });
  const visitor = await phone.newPage();
  const responses: PwResponse[] = [];
  visitor.on('response', (response) => responses.push(response));

  try {
    const gridUrl = storefrontUrl(slug, '/');
    await visitor.goto(gridUrl, { waitUntil: 'load' });

    const card = visitor.locator(`li[data-listing="${listingSlug}"]`).first();
    await expect(
      card,
      `la grilla de ${gridUrl} no muestra ninguna card para el equipo publicado ${listingSlug}`,
    ).toBeVisible({ timeout: 30_000 });

    const img = card.locator('img').first();
    await expect(img, 'la card de la grilla no tiene <img>: no hay byte que medir').toBeVisible({
      timeout: 30_000,
    });

    // `currentSrc` y no `src`: `src` es el fallback para el browser que no entiende `srcSet`. Lo
    // que hay que medir es lo que el algoritmo de selección **eligió**.
    //
    // ## Va como FUNCIÓN y nunca más como string
    // `locator.evaluate('el => el.currentSrc')` **no ejecuta esa flecha**: Playwright evalúa el
    // string como expresión, obtiene un objeto función y lo serializa como `undefined`. Medido con
    // `chromium.launch()` a mano contra un `<img srcset>` de juguete: la forma string devuelve
    // `undefined` y la función devuelve la URL. Costó una corrida entera diciendo *"el browser
    // eligió undefined"*, un rojo que apuntaba a la vidriera cuando el defecto era de esta línea.
    // El `evaluate<string, undefined>` no lo podía desmentir: el string es opaco para TS, así que
    // el tipo declarado era una promesa que nadie verificaba. Con una función, TS mira el cuerpo.
    //
    // `evaluate<R, Arg>`: la firma de `Locator` exige los dos parámetros de tipo aunque la función
    // no reciba argumento.
    const chosenUrl = await img.evaluate<string, undefined>((el) => el.currentSrc);
    if (chosenUrl === '') {
      throw new Error(
        `el <img> de la card de ${listingSlug} llegó al browser sin resolver ninguna fuente ` +
          '(`currentSrc` vacío): o el `srcSet` no ofreció un solo candidato, o la foto no cargó. ' +
          'No hay byte que medir y no se emite ninguna línea MEDIDO.',
      );
    }
    const sizesAttr = (await img.getAttribute('sizes')) ?? '';

    const perfAll = await visitor.evaluate<readonly PerfSample[]>(PERF_PROBE);
    const perf = perfAll.find((entry) => entry.name === chosenUrl) ?? null;

    const response = responses.find((candidate) => candidate.url() === chosenUrl);
    if (response === undefined) {
      throw new Error(
        `el browser eligió ${chosenUrl} pero no hay ninguna respuesta con esa URL en la corrida: ` +
          'la foto salió del cache del contexto (imposible en uno recién creado) o nunca se pidió',
      );
    }
    await response.finished();
    const sizes = await response.request().sizes();

    const measurement: ImageMeasurement = {
      url: chosenUrl,
      variant: variantOfUrl(chosenUrl, photo),
      // `transferSize` del spec de Resource Timing = headers + cuerpo codificado. Se arma con los
      // dos números de la pila de red, que es lo que de verdad viajó.
      transferSize: sizes.responseBodySize + sizes.responseHeadersSize,
    };

    observed = {
      listingId,
      listingSlug,
      photo,
      chosenUrl,
      sizesAttr,
      wire: { bodyBytes: sizes.responseBodySize, headerBytes: sizes.responseHeadersSize },
      httpStatus: response.status(),
      contentType: (await response.headerValue('content-type')) ?? '',
      perf,
      measurement,
      gridUrl,
    };

    // ── La línea que lee M2 de `scripts/accept-s3.sh` ──────────────────────────────────────────
    // Se emite **sólo** si hubo bytes. Un `transferSize=0` no es una medición baja: es una
    // medición que no ocurrió, y publicarla dejaría al gate leyendo "la grilla no gasta datos".
    // Sin línea, el gate falla por ausencia, que es lo correcto para "no pude medir".
    if (measurement.transferSize > 0) {
      process.stdout.write(`${imageMedidoLine(measurement)}\n`);
    } else {
      process.stdout.write(
        `SIN MEDIR s3 imagen · elegido=${chosenUrl} · la pila de red contó 0 bytes ` +
          '(cache del browser o 404): no se emite MEDIDO con un 0\n',
      );
    }
  } finally {
    await visitor.close();
    await phone.close();
  }
});

test.afterAll(async () => {
  await deleteTenantBySlug(slug);
  await deleteUserByEmail(email);
});

test('la vidriera de un teléfono baja la variante card y nunca la detail de 1600px', () => {
  const it = seen();

  expect(
    imageBudgetProblems(it.measurement),
    `medición: elegido=${it.chosenUrl} variante=${it.measurement.variant} ` +
      `transferSize=${String(it.measurement.transferSize)}B (cuerpo ${String(it.wire.bodyBytes)}B ` +
      `+ headers ${String(it.wire.headerBytes)}B) · techo=${String(S3_IMAGE_CAP_BYTES)}B · ` +
      `sizes="${it.sizesAttr}"`,
  ).toEqual([]);

  // Redundante con lo de arriba y se queda: si alguien afloja `imageBudgetProblems`, esta línea
  // sigue diciendo la regla de producto en una sola comparación legible.
  expect(
    it.measurement.variant,
    `el browser eligió ${it.measurement.variant} con sizes="${it.sizesAttr}"`,
  ).toBe('card');
});

test('la card de la grilla llega con sizes explicito, que es lo que decide el byte', () => {
  const it = seen();

  // M1 del gate chequea esto **estáticamente** sobre el `.tsx`. Acá se chequea sobre el DOM
  // servido: un `sizes` que se pierde en el camino (un componente que reenvía props a medias, un
  // build que lo tira) no lo ve ningún grep del fuente y cuesta 2,5× el presupuesto.
  expect(
    it.sizesAttr,
    'el <img> de la card llegó al browser sin `sizes`: sin él se asume 100vw y el teléfono se ' +
      'baja `detail` aunque el `srcSet` esté perfecto. Es P3, textual.',
  ).not.toBe('');

  expect(
    it.sizesAttr,
    `el sizes de la card ("${it.sizesAttr}") no describe una grilla de dos columnas en mobile: ` +
      'a una columna la caja pide ~1074px de recurso a DPR 3 y gana `detail`',
  ).toMatch(/\d+vw/u);
});

test('el byte reportado es el que viajo por el cable y no una lectura vacia del cache', () => {
  const it = seen();

  expect(it.httpStatus, `la foto de la grilla respondió ${String(it.httpStatus)}`).toBe(200);
  expect(it.contentType, 'la grilla no está sirviendo WebP').toContain('image/webp');

  expect(
    it.wire.bodyBytes,
    'la pila de red contó 0 bytes de cuerpo: eso es cache del browser o una respuesta vacía, y en ' +
      'los dos casos la medición no significa nada. Reportar ese 0 sería afirmar que la vidriera ' +
      'no gasta datos.',
  ).toBeGreaterThan(0);

  // El cuerpo que viajó tiene que ser el objeto `card` que S2 midió, no algo parecido. El techo de
  // S2 (150 KiB, escrito a mano en `_lib/media.ts`) acota por arriba; el baseline acota la
  // sospecha de que en el medio haya un re-encode que "casualmente" pesa poco.
  expect(
    it.wire.bodyBytes,
    `el cuerpo que bajó pesa ${String(it.wire.bodyBytes)} B y el techo del objeto card son ` +
      `${String(CARD_MAX_BYTES)} B`,
  ).toBeLessThanOrEqual(CARD_MAX_BYTES);

  expect(
    Math.abs(it.wire.bodyBytes - BASELINE_BYTES.card),
    `bajó ${String(it.wire.bodyBytes)} B y el card medido por el LEAD sobre esta misma fixture son ` +
      `${String(BASELINE_BYTES.card)} B: no es el mismo objeto, hay algo re-encodeando en el medio`,
  ).toBeLessThanOrEqual(2_048);

  // La Performance API queda **documentada como ciega**, no ignorada en silencio. Si algún día
  // `/_media` empieza a mandar `Timing-Allow-Origin`, este test pasa a comparar las dos cuentas y
  // una discrepancia entre lo que la página cree y lo que la red contó sale a la luz sola.
  if (it.perf !== null && it.perf.transferSize > 0) {
    expect(
      Math.abs(it.perf.transferSize - it.measurement.transferSize),
      `la Performance API dice ${String(it.perf.transferSize)} B y la pila de red ` +
        `${String(it.measurement.transferSize)} B para el mismo recurso`,
    ).toBeLessThanOrEqual(1_024);
  } else {
    // No es una aserción de conveniencia: afirma que el recurso **sí** entró en la lista de
    // recursos de la página. Un `null` acá significaría que el `<img>` que se midió no es el que
    // la página pidió, y entonces todo lo de arriba estaría mirando otro objeto.
    expect(
      it.perf,
      `el recurso ${it.chosenUrl} no aparece en performance.getEntriesByType('resource'): el ` +
        'browser no lo pidió desde esta página',
    ).not.toBeNull();
  }
});
