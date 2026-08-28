/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  S2 · `/app/stock/{id}/fotos` con el id de otro negocio. Owner: `qa-agent`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## La regla de negocio
 * El equipo de otro reseller **no existe para mí**. No "no lo puedo editar": no existe. Desde
 * afuera, un id ajeno y un id inventado tienen que ser **indistinguibles**: mismo status, mismo
 * cuerpo, mismo silencio. En el momento en que las dos respuestas difieren en algo observable, la
 * pantalla se convierte en un oráculo — le contesta "sí, ese equipo está en la base" a cualquiera
 * que pruebe ids, y de yapa le dice de quién no es.
 *
 * ## Por qué el invariante es la indistinguibilidad y NO `.toBe(404)` — no volver a "arreglarlo"
 * No es una preferencia de este test ni una opinión suelta de `qa-agent`: es **ADR-011 — "El slug
 * inexistente se sirve como página legible con `noindex`, no como 404 duro"** (aceptada
 * 2026-08-27, `docs/DECISIONS.md`), que **supersede el corolario 4 de ADR-007** (*"un slug
 * inexistente da 404 real y cacheable"*) y deja el status fuera de los invariantes chequeables.
 * Todo lo que este bloque dice sobre el 404 es historia de una decisión ya tomada, no algo a
 * reabrir; ADR-011 §"Lo que reemplaza al status como invariante chequeable" es la lista vigente.
 *
 * Este archivo afirmaba `.toBe(404)` y estaba mal, por dos motivos distintos y los dos serios.
 *
 * **1. El 404 real no se puede fijar en esta arquitectura.** Con `cacheComponents: true` (Next
 * 16.3.3) la respuesta empieza a transmitir antes de que el server sepa de quién es el equipo. La
 * doc instalada lo dice sin ambigüedad
 * (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/not-found.md`):
 *
 * > *"the response has already begun streaming as a `200`, and the status can't change once
 * > streaming has started. The `noindex` tag keeps a soft 404 out of search results. To return a
 * > real `404` status, the resource has to be checked before the response streams. With Cache
 * > Components, every dynamic route streams a static shell first, so run that check in `proxy`
 * > instead."*
 *
 * El remedio que propone Next —chequear en `proxy`— está **prohibido** por `CLAUDE.md` §3: el
 * proxy parsea el host y reescribe, no consulta nada, y corre en el 100% de los hits. O sea que el
 * status 404 no está disponible, y un test que lo exige es un test que pide un imposible y tapa
 * todo lo que viene atrás.
 *
 * Está medido por el LEAD: `notFound()` **sí corre**, el cuerpo es el 404 genérico de Next (sin
 * título, sin slug, con `<meta name="robots" content="noindex, nofollow">`), y dos UUID
 * inexistentes distintos devuelven respuestas idénticas. **No hay fuga. Hay un status que no se
 * puede fijar.**
 *
 * **2. El assert de status iba PRIMERO y cortaba antes de las aserciones de fuga.** Ése es el
 * defecto grave del archivo viejo: los chequeos de `SECRET_TITLE` y del slug ajeno —las dos únicas
 * líneas que probaban que no se filtra nada— **nunca se ejecutaron en ningún gate**, porque el
 * `expect(status).toBe(404)` de arriba tiraba primero. La suite reportaba sobre una regla que no
 * había evaluado.
 *
 * Entonces el invariante que se afirma acá es: **las dos respuestas son iguales entre sí**, sea
 * cual sea el status. Un 403 para el ajeno y un 404 para el inventado falla — y tiene que fallar,
 * porque un 403 confirma que el equipo existe. El día que Next permita el 404 real, este test
 * sigue verde **sin que nadie lo toque**.
 *
 * ## Orden de las aserciones: primero la fuga
 * Un status distinto es una molestia; un título de otro negocio en el cuerpo es la slice entera.
 * El que corta la corrida tiene que ser el importante. Además, **todos** los marcadores de fuga se
 * evalúan en una sola aserción sobre una lista, así que ninguno queda escondido detrás del fallo
 * de otro: si se filtran tres cosas, el rojo dice las tres.
 *
 * ## Cómo se monta el ataque
 * El tenant A hace todo por el panel, como un dueño. El tenant B y su equipo se siembran por SQL
 * (`_lib/db.ts`): el equipo de B **no está bajo prueba, es el objetivo**. Lo único que el test
 * necesita de él es que exista y sea de otro dueño; hacerlo por el panel costaría un login y un
 * negocio enteros para producir un UUID.
 *
 * El título de B lleva una marca única, y con él viajan el slug, el nombre y el uuid del tenant
 * ajeno. Se busca en el HTML **completo**, payload de Flight incluido: un dato del otro serializado
 * adentro de un `self.__next_f.push(...)` está igual de filtrado que en un `<h1>`, sólo que no se
 * ve — y ése es justo el modo de falla que un test de status code no caza.
 *
 * ## Las tres puertas
 *   1. **El browser**: lo que hace el curioso que pega una URL.
 *   2. **HTTP crudo con la cookie de sesión**: sin JS ni render de cliente. Si el "no existe" lo
 *      dibujara el cliente y el server mandara los datos adentro, acá se ve.
 *   3. **Sin sesión**: un equipo ajeno y un id inventado tienen que comportarse igual, o el login
 *      se convierte en un buscador de ids ajenos.
 *
 * ## Por qué este archivo ya NO corre en `mode: 'serial'`
 * Corría en serial y el precio lo pagaba la cobertura: **con un solo rojo, Playwright saltea todos
 * los tests que siguen** y los deja en `did not run`. Medido en el gate de S2: 8 tests sin correr,
 * entre ellos las otras dos puertas (HTTP crudo y sin sesión) y el ataque a la mutación, que son
 * reglas de seguridad distintas de la que falló. Un archivo de aislamiento en el que el primer
 * fallo apaga las demás defensas es el archivo que menos puede darse ese lujo.
 *
 * En `mode: 'default'` los tests siguen corriendo en orden y en un solo worker (`workers: 1`,
 * `fullyParallel: false`), comparten la sesión que arma el `beforeAll` —que cuesta un login, un
 * negocio y un alta con foto: repetirlo por test serían ~90 s cada uno, y ese costo sí compraría
 * un fixture por test— pero **un rojo ya no tapa a los que vienen atrás**. La independencia real
 * la da que cada test arranca con su propio `goto`: ninguno depende del DOM que dejó el anterior.
 *
 * Lo que se pierde con esto es que el fallo del **control positivo** (test 1) ya no saltea al
 * resto, y sin control positivo la igualdad de status daría verde con la ruta rota —404 para todo
 * el mundo, aislamiento perfecto, producto inexistente—. No es un agujero: si el control positivo
 * cae, la corrida entera es roja igual y el gate no pasa. Lo que ya no pasa es que ese rojo se
 * lleve puestas las aserciones de fuga.
 *
 * `qa-agent` no arregla el código bajo test. Si esto se pone rojo, el defecto es de la impl.
 */

import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from './_lib/fixtures';
import {
  deleteTenantBySlug,
  deleteUserByEmail,
  listingById,
  listingPhotoCount,
  purgeE2eFixtures,
  seedListing,
  seedTenant,
  tenantIdBySlug,
} from './_lib/db';
import { APEX_URL, FIXTURE_PREFIX, uniqueEmail, uniqueSlug } from './_lib/env';
import { getRaw } from './_lib/http';
import { ownersPhotoUpload } from './_lib/photo';
import {
  STOCK_URL_RE,
  createBusiness,
  createUnitDraft,
  photosPath,
  signIn,
} from './_lib/panel';

/**
 * `default`, no `serial`, y está razonado arriba: en serial el primer rojo dejaba en `did not run`
 * a las otras dos puertas y al ataque a la mutación. No volver a `serial` sin leer ese párrafo.
 */
test.describe.configure({ mode: 'default' });

// ── El dueño que sí soy ──────────────────────────────────────────────────────────────────────
const slugA = uniqueSlug('mio');
const emailA = uniqueEmail('mio');
const imeiA = `35${String(Date.now()).slice(-13)}`;

// ── El negocio del otro, el de la vuelta ─────────────────────────────────────────────────────
const slugB = uniqueSlug('ajeno');
const NAME_B = 'Cel del Otro Negocio';
const LISTING_SLUG_B = 'iphone-12-del-otro';

/** Marca única y buscable. Si aparece en cualquier byte de mi respuesta, se filtró. */
const SECRET_TITLE = `iPhone 12 del otro negocio ${Date.now().toString(36)}`;

/** Un UUID que no es de nadie. Es el control: "no existe" tiene que verse igual que "no es mío". */
const GHOST_ID = '00000000-0000-4000-8000-000000000000';

let page: Page;
let myListingId = '';
let theirListingId = '';
let tenantBId = '';

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  await purgeE2eFixtures(FIXTURE_PREFIX);

  await seedTenant({ slug: slugB, name: NAME_B });
  const tenantB = await tenantIdBySlug(slugB);
  if (tenantB === null) throw new Error(`el tenant ${slugB} no quedó en la base`);
  tenantBId = tenantB;
  theirListingId = await seedListing({
    tenantId: tenantB,
    slug: LISTING_SLUG_B,
    title: SECRET_TITLE,
  });

  page = await browser.newPage();
  await signIn(page, emailA);
  await createBusiness(page, { name: 'Cipolletti Cel Mio', slug: slugA });

  const created = await createUnitDraft(page, {
    title: 'iPhone 14 128 Negro',
    condition: 'used_excellent',
    storageGb: 128,
    color: 'Negro',
    priceUsd: 560,
    batteryPct: 92,
    imei: imeiA,
    costUsd: 460,
    photo: await ownersPhotoUpload(),
  });
  myListingId = created.listingId;
});

test.afterAll(async () => {
  await page.close();
  await deleteTenantBySlug(slugA);
  await deleteTenantBySlug(slugB);
  await deleteUserByEmail(emailA);
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  Lo que se compara: una respuesta reducida a los hechos que un atacante puede observar
// ══════════════════════════════════════════════════════════════════════════════════════════════

interface Response {
  /** Cómo nombrarla en el mensaje de un rojo. */
  readonly label: string;
  readonly status: number | null;
  /** El cuerpo **entero**, payload de Flight incluido. Ahí es donde se esconde una fuga. */
  readonly body: string;
  /** Dónde terminó parada la respuesta: un redirect distinto también distingue. */
  readonly pathname: string;
  /** El `pathname` con **su propio** id borrado. Es lo único comparable: ver `shapeOfPath`. */
  readonly pathShape: string;
}

interface Screen extends Response {
  /** `<meta name="robots">` leído del DOM, esté donde esté: React lo hoistea al `<head>`. */
  readonly robots: string | null;
}

/**
 * El pathname de esta pantalla **lleva el id adentro** (`/app/stock/{id}/fotos`), así que comparar
 * dos pathnames crudos entre sí es imposible por construcción: difieren siempre, haga lo que haga
 * el producto. Este archivo lo hacía y daba rojo con dos respuestas que se habían quedado
 * exactamente donde se les pidió — o sea, un fallo por la forma del test y no por lo que mide.
 *
 * Lo que sí hay que afirmar es que **ninguna de las dos terminó en una pantalla distinta de la que
 * pidió**: un id ajeno que rebota a `/app/stock` mientras el inventado se queda en su `/fotos` es
 * la misma pista de existencia, servida por redirect. Por eso se reemplaza en cada pathname **su
 * propio** id por un placeholder y se comparan los resultados: iguales si los dos se quedaron,
 * iguales si los dos rebotaron al mismo lado (`/ingresar` para un anónimo, por ejemplo), distintos
 * —y rojo, que es lo que se quiere— si uno rebotó y el otro no.
 *
 * No usar regex: `split`/`join` reemplaza el literal y no hay nada que escapar.
 */
function shapeOfPath(pathname: string, listingId: string): string {
  return pathname.split(listingId).join('{id}');
}

/** Abre la pantalla en el browser, como el curioso que pega la URL, y la reduce a hechos. */
async function openScreen(target: Page, label: string, listingId: string): Promise<Screen> {
  const response = await target.goto(`${APEX_URL}${photosPath(listingId)}`);
  const robots = target.locator('meta[name="robots"]');
  const pathname = new URL(target.url()).pathname;
  return {
    label,
    status: response?.status() ?? null,
    body: await target.content(),
    pathname,
    pathShape: shapeOfPath(pathname, listingId),
    robots: (await robots.count()) > 0 ? await robots.first().getAttribute('content') : null,
  };
}

/** La misma respuesta pedida en crudo. `maxRedirects: 0`: seguir el redirect es tapar la pista. */
async function fetchScreen(
  request: APIRequestContext,
  label: string,
  listingId: string,
): Promise<Response> {
  const response = await getRaw(request, `${APEX_URL}${photosPath(listingId)}`);
  const pathname = new URL(response.url()).pathname;
  return {
    label,
    status: response.status(),
    body: await response.text(),
    pathname,
    pathShape: shapeOfPath(pathname, listingId),
  };
}

/**
 * Todo lo que identifica al negocio ajeno. Si **cualquiera** de estas cadenas aparece en una
 * respuesta mía, se filtró: no importa si se ve en pantalla o si viaja adentro del Flight.
 *
 * El `listingId` ajeno **no** está en la lista, a propósito: es el dato que el atacante escribió
 * en la URL. Devolvérselo no le informa nada que no supiera; lo que no puede recibir es qué hay
 * detrás de ese id.
 *
 * Si un marcador viene vacío, el fixture no se armó y la comparación sería `body.includes('')`,
 * o sea `true` para todo. Se rompe con un mensaje que dice eso, y no con una fuga inventada.
 */
function forbiddenMarkers(): readonly { readonly what: string; readonly value: string }[] {
  const markers = [
    { what: 'el título del equipo ajeno', value: SECRET_TITLE },
    { what: 'el slug del negocio ajeno', value: slugB },
    { what: 'el nombre del negocio ajeno', value: NAME_B },
    { what: 'el uuid del tenant ajeno', value: tenantBId },
    { what: 'el slug del equipo ajeno', value: LISTING_SLUG_B },
  ];
  const empty = markers.filter((marker) => marker.value === '');
  if (empty.length > 0) {
    throw new Error(
      `el fixture del negocio ajeno no quedó armado (${empty.map((m) => m.what).join(', ')}): ` +
        'sin marcadores, la búsqueda de fuga no afirma nada',
    );
  }
  return markers;
}

/**
 * Los datos del otro negocio que aparecen en estas respuestas. Devuelve **la lista completa**, no
 * el primero: se afirma una sola vez sobre el conjunto, así ningún marcador queda sin evaluar
 * porque otro falló antes. Ése fue el defecto original de este archivo.
 */
function leaksIn(...responses: readonly Response[]): string[] {
  const markers = forbiddenMarkers();
  return responses.flatMap((response) =>
    markers
      .filter((marker) => response.body.includes(marker.value))
      .map((marker) => `${response.label} trae ${marker.what} ("${marker.value}")`),
  );
}

/** Cuáles de estas respuestas dibujaron la pantalla del dueño. Tiene que ser ninguna. */
function ownerScreensIn(...responses: readonly Response[]): string[] {
  return responses
    .filter((response) => response.body.includes('fotos-de-la-unidad'))
    .map((response) => response.label);
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  Los tests
// ══════════════════════════════════════════════════════════════════════════════════════════════

test('la pantalla de fotos de mi propio equipo abre: sin este control positivo, "no existe para nadie" pasaría por aislamiento', async () => {
  const mine = await openScreen(page, 'la pantalla de mi propio equipo', myListingId);

  // Sin esto, el test de abajo —que compara dos respuestas **entre sí**— daría verde con la ruta
  // sin implementar: mismo "no existe" para todo el mundo, aislamiento perfecto, producto
  // inexistente. Es el único assert de este archivo que fija un status, y puede: es el camino
  // feliz, no el de un id que no se puede resolver.
  expect(
    mine.status,
    `${photosPath(myListingId)} contestó ${String(mine.status)} para su propio dueño`,
  ).toBe(200);

  await expect(
    page.getByTestId('fotos-de-la-unidad'),
    'la pantalla de fotos de mi equipo no muestra el contenedor del contrato',
  ).toBeVisible({ timeout: 20_000 });
});

test('un equipo de otro negocio es indistinguible de un id inventado: mismo status y ni un dato de su dueño', async () => {
  const theirs = await openScreen(page, 'la pantalla del equipo ajeno', theirListingId);
  const ghost = await openScreen(page, 'la pantalla del id inventado', GHOST_ID);

  // ── 1. Fuga. Va primero porque es lo caro, y en UNA aserción sobre la lista completa para que
  //       ningún marcador quede detrás del fallo de otro.
  expect(
    leaksIn(theirs, ghost),
    'una pantalla que dice "no existe" trae datos del negocio ajeno adentro: el filtro de tenant ' +
      'corrió después de leer la fila, o no corrió (CLAUDE.md §2)',
  ).toEqual([]);

  // ── 2. Y no se dibujó la pantalla del dueño con un cartel de "no existe" encima.
  expect(
    ownerScreensIn(theirs, ghost),
    'se sirvió la pantalla de fotos para un equipo que no es mío',
  ).toEqual([]);

  // ── 3. `noindex`: es la mitigación que la propia doc de Next nombra para el soft 404, y acá
  //       además es lo único que impide que el equipo de otro reseller termine en Google.
  expect(
    [theirs, ghost]
      .filter((screen) => !(screen.robots ?? '').toLowerCase().includes('noindex'))
      .map((screen) => `${screen.label}: robots="${screen.robots ?? '(no hay meta robots)'}"`),
    'sin `noindex`, el soft 404 de un equipo ajeno se puede indexar',
  ).toEqual([]);

  // ── 4. El invariante: las dos respuestas son la misma. No se clava en 200 ni en 404 a propósito
  //       (ver el encabezado); lo que no puede pasar es que difieran, porque la diferencia ES el
  //       oráculo: un 403 para el ajeno y un 404 para el inventado confirma que el ajeno existe.
  expect(
    theirs.status,
    `el equipo ajeno contesta ${String(theirs.status)} y el id inventado ${String(ghost.status)}: ` +
      'la diferencia le confirma a cualquiera que ese equipo está en la base',
  ).toBe(ghost.status);

  // Con el id normalizado, nunca crudo: el pathname lleva el id adentro y dos crudos no pueden
  // ser iguales jamás (ver `shapeOfPath`). Lo que se compara es si cada uno se quedó donde pidió.
  expect(
    theirs.pathShape,
    `el equipo ajeno terminó en "${theirs.pathname}" y el inventado en "${ghost.pathname}": uno ` +
      'de los dos redirigió y el otro no, y esa diferencia es la misma pista, servida por redirect',
  ).toBe(ghost.pathShape);

  // ── 5. Un 5xx sería igual en los dos y pasaría lo de arriba, pero significa que la ruta explota
  //       con un id que no puede resolver — y una excepción del server termina en el log entero.
  expect(
    theirs.status ?? 500,
    `la ruta contestó ${String(theirs.status)}: un id que no es mío no puede hacer explotar la ruta`,
  ).toBeLessThan(500);

  // ── 6. Y el equipo del otro sigue intacto: mirar no es tocar.
  expect(
    await listingById(theirListingId),
    'el equipo del otro negocio desapareció de la base',
  ).not.toBeNull();
});

test('el "no existe" del equipo ajeno lo decide el server, no el JavaScript del navegador', async () => {
  // `page.request` comparte las cookies de la sesión: es mi sesión pidiendo el HTML crudo, sin
  // ejecutar una línea de cliente. Si el server mandara los datos adentro y el "no existe" lo
  // dibujara React, acá se vería el cuerpo con el título del otro.
  const mine = await fetchScreen(page.request, 'mi propio equipo por HTTP crudo', myListingId);
  const theirs = await fetchScreen(page.request, 'el equipo ajeno por HTTP crudo', theirListingId);
  const ghost = await fetchScreen(page.request, 'el id inventado por HTTP crudo', GHOST_ID);

  expect(
    leaksIn(theirs, ghost),
    'la respuesta cruda trae datos del negocio ajeno: el aislamiento no puede depender de que el ' +
      'navegador ejecute algo',
  ).toEqual([]);

  expect(
    ownerScreensIn(theirs, ghost),
    'el server sirvió la pantalla de fotos, en crudo, para un equipo que no es mío',
  ).toEqual([]);

  expect(
    theirs.status,
    `el server contestó ${String(theirs.status)} para el equipo ajeno y ${String(ghost.status)} ` +
      'para el inventado: sin browser de por medio, las dos respuestas tienen que ser la misma',
  ).toBe(ghost.status);

  // Control positivo de esta puerta: sin él, "todo da lo mismo por HTTP crudo" pasaría con la
  // ruta rota. Es mi equipo, así que acá el 200 sí se puede exigir.
  expect(mine.status, 'mi propio equipo no responde por HTTP crudo').toBe(200);
});

test('un id que ni siquiera es un UUID no llega a Postgres: nunca un 500 ni un error de la base en pantalla', async () => {
  const weird = await openScreen(page, 'la pantalla de un id con forma inválida', 'no-soy-un-uuid');

  // 500 acá no es un detalle estético: significa que la ruta le pasó el segmento crudo de la URL a
  // la query. Lo mismo que hoy sale como `invalid input syntax for type uuid` es la superficie
  // donde mañana entra otra cosa. Zod en todos los bordes (`CLAUDE.md` §5).
  //
  // No se afirma un status exacto —ver el encabezado— sino el rango: lo que el producto promete es
  // que un id con forma inválida se contesta, no que se rompa.
  expect(
    weird.status ?? 500,
    `un id inválido contestó ${String(weird.status)}: el segmento de la URL está llegando a la ` +
      'base sin pasar por un schema',
  ).toBeLessThan(500);

  const shown = weird.body.toLowerCase();
  const dbErrors = ['invalid input syntax', 'postgreserror', 'syntax error at or near'].filter(
    (marker) => shown.includes(marker),
  );
  expect(dbErrors, 'la pantalla muestra un error de la base').toEqual([]);

  expect(leaksIn(weird), 'un id con forma inválida devolvió datos de otro negocio').toEqual([]);
  expect(
    ownerScreensIn(weird),
    'un id que ni siquiera es un UUID sirvió la pantalla de fotos de alguien',
  ).toEqual([]);
});

test('subirle una foto al equipo de otro negocio no le agrega ninguna, ni con el id cambiado a mano', async () => {
  test.setTimeout(180_000);

  // El "no existe" del GET protege la **pantalla**. Esto ataca la **mutación**, que es otra
  // superficie y otra defensa: las Server Functions no son rutas propias en la cadena de matchers
  // del proxy, así que la autorización se verifica adentro de cada acción o no se verifica en
  // ningún lado (ADR-007). El formulario lleva el `listingId` en un campo oculto: cualquiera con
  // las devtools abiertas lo edita en cinco segundos, y eso es exactamente lo que se hace acá.
  await page.goto(`${APEX_URL}${photosPath(myListingId)}`);
  await expect(
    page.getByTestId('form-agregar-foto'),
    'la pantalla de mi equipo no tiene el formulario de agregar foto: no hay nada que atacar',
  ).toBeVisible({ timeout: 20_000 });

  // Acotado al form de agregar foto por su `data-testid`, y no es cosmética: esta pantalla tiene
  // **dos** formularios que mandan `listingId` en un hidden (éste y el de publicar). Un
  // `input[name="listingId"]` suelto matchea los dos y muere por strict mode antes de atacar nada.
  // El otro form se ataca en el test de abajo, que es otra acción y otra defensa.
  const hidden = page.getByTestId('form-agregar-foto').locator('input[name="listingId"]');
  await expect(
    hidden,
    'el formulario no manda el listingId en un campo oculto: si cambió el contrato, este ataque ' +
      'hay que rearmarlo, no borrarlo',
  ).toBeAttached();

  await hidden.evaluate((element, value: string) => {
    element.setAttribute('value', value);
    (element as unknown as { value: string }).value = value;
  }, theirListingId);

  await page.getByTestId('input-agregar-foto').setInputFiles(await ownersPhotoUpload());
  await page.getByTestId('submit-agregar-foto').click();

  // Se espera por un desenlace observable —un error, o una foto más en MI equipo— y recién ahí se
  // mira la base. No importa cuál de los dos ocurra: lo que este test afirma es lo de abajo.
  await Promise.any([
    page.getByTestId('error-foto').waitFor({ state: 'visible', timeout: 90_000 }),
    expect(page.getByTestId('foto-cargada')).toHaveCount(2, { timeout: 90_000 }),
  ]).catch(() => undefined);

  expect(
    await listingPhotoCount(theirListingId),
    `el equipo ${theirListingId} de otro negocio quedó con fotos mías: la acción confió en el ` +
      'campo oculto del formulario en vez de verificar el dueño (CLAUDE.md §2 y ADR-007)',
  ).toBe(0);
});

test('publicar con el id cambiado a mano no le mueve el estado al equipo de otro negocio', async () => {
  test.setTimeout(120_000);

  // El mismo ataque que el de arriba, contra el **otro** formulario de esta pantalla. Apareció
  // solo: `input[name="listingId"]` matcheaba dos elementos, y el segundo era el form de publicar.
  // Vale más que el de la foto: sumarle una foto al equipo del otro es ensuciarlo; moverle el
  // estado a `available` es publicarlo en MI vidriera —o sacárselo de la suya— desde afuera de su
  // negocio. Es la máquina de estados de otro dueño manejada por un tercero.
  //
  // `setListingStatusAction` recibe el `listingId` por FormData igual que la de fotos, así que la
  // única defensa es que relea la unidad **con el filtro de tenant** antes de transicionar. Si
  // confía en el campo oculto, este test lo dice.
  const before = await listingById(theirListingId);
  expect(
    before,
    'el equipo del otro negocio no está en la base: no hay nada que atacar',
  ).not.toBeNull();

  await page.goto(`${APEX_URL}${photosPath(myListingId)}`);

  const publishForm = page.locator('form').filter({ has: page.getByTestId('submit-publicar') });
  const hidden = publishForm.locator('input[name="listingId"]');
  await expect(
    hidden,
    'el form de publicar no manda el listingId en un campo oculto: si cambió el contrato, este ' +
      'ataque hay que rearmarlo, no borrarlo',
  ).toBeAttached({ timeout: 20_000 });

  await hidden.evaluate((element, value: string) => {
    element.setAttribute('value', value);
    (element as unknown as { value: string }).value = value;
  }, theirListingId);

  // El botón está apagado porque a MI equipo le faltan fotos, y ese `disabled` es cortesía de UI:
  // lo saca cualquiera con el inspector en cinco segundos. Sacarlo acá es parte del ataque, no una
  // trampa del test — quien tiene que decir que no es la Server Action, releyendo de Postgres.
  const button = page.getByTestId('submit-publicar');
  await button.evaluate((element) => {
    element.removeAttribute('disabled');
  });
  await button.click();

  // Cualquiera de los dos desenlaces sirve para saber que la acción ya corrió: el error abajo del
  // botón, o el redirect al stock que la acción hace cuando la transición sale bien. Lo que se
  // afirma es lo de abajo, contra la base, no cuál de los dos ocurrió.
  await Promise.any([
    publishForm.getByRole('alert').waitFor({ state: 'visible', timeout: 60_000 }),
    page.waitForURL(STOCK_URL_RE, { timeout: 60_000 }),
  ]).catch(() => undefined);

  const after = await listingById(theirListingId);
  expect(
    after?.status ?? null,
    `el equipo ${theirListingId} de otro negocio pasó de "${before?.status ?? '(no estaba)'}" a ` +
      `"${after?.status ?? '(no está)'}" desde el panel de otro dueño: la acción confió en el ` +
      'campo oculto del formulario en vez de verificar el dueño (CLAUDE.md §2 y ADR-007)',
  ).toBe(before?.status ?? null);
});

test('sin sesión, un equipo ajeno y uno inventado se comportan exactamente igual', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const anon = await context.newPage();

  try {
    // Sin oráculo externo: se comparan las dos respuestas **entre sí**. Da igual si la ruta manda
    // a `/ingresar` o dice "no existe"; lo que no puede pasar es que un id existente y uno
    // inventado se distingan, porque eso convierte al login en un buscador de ids ajenos.
    const theirs = await fetchScreen(anon.request, 'el equipo ajeno sin sesión', theirListingId);
    const ghost = await fetchScreen(anon.request, 'el id inventado sin sesión', GHOST_ID);

    expect(
      leaksIn(theirs, ghost),
      'la respuesta a un anónimo trae datos de un negocio ajeno',
    ).toEqual([]);

    expect(
      ownerScreensIn(theirs, ghost),
      'un anónimo recibió la pantalla de fotos de un equipo',
    ).toEqual([]);

    expect(
      theirs.status,
      `un id ajeno que existe contesta ${String(theirs.status)} y uno inventado ` +
        `${String(ghost.status)}: la diferencia es un oráculo de existencia de equipos ajenos`,
    ).toBe(ghost.status);

    // Otra vez normalizado, y acá importa doble: sin sesión lo más probable es que **los dos**
    // reboten a `/ingresar`, y eso está bien y tiene que dar verde. Lo que no puede pasar es que
    // rebote uno solo, o que reboten a lugares distintos. Comparar los pathnames crudos no podía
    // distinguir ese caso de ninguno: siempre difieren, porque el id viaja adentro.
    expect(
      theirs.pathShape,
      `sin sesión el equipo ajeno terminó en "${theirs.pathname}" y el inventado en ` +
        `"${ghost.pathname}": el login se convierte en un buscador de ids ajenos`,
    ).toBe(ghost.pathShape);
  } finally {
    await context.close();
  }
});
