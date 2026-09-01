/**
 * Los dos caminos del panel que un e2e necesita recorrer de verdad: entrar y crear el negocio.
 * Owner: `qa-agent`.
 *
 * Se navega el formulario **como lo navega una persona** (labels, inputs, botón) y no se llama a
 * la Server Action a mano: el alta tiene que disparar todo lo que dispara en producción —
 * incluida la invalidación de los cache tags del slug— o el test no prueba el alta, prueba un
 * `insert`.
 */

import { expect, type Locator, type Page } from '@playwright/test';
import { APEX_URL } from './env';

export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto(`${APEX_URL}/ingresar`);
  await page.locator('input[name="email"]').fill(email);
  // El formulario de producción también exige contraseña para Neon Auth. El driver local la
  // ignora a propósito, pero el helper tiene que recorrer el mismo contrato de formulario.
  await page.locator('input[name="password"]').fill('qa-e2e-password');
  await page.getByRole('button', { name: /entrar/iu }).click();
  // El driver local (sin B2) crea el usuario y redirige al panel. Si la sesión no quedó, la
  // siguiente navegación a `/app/*` vuelve a `/ingresar` y el test muere sin decir por qué.
  await page.waitForURL(/\/app(\/|$)/u, { timeout: 20_000 });
}

export interface NewBusiness {
  readonly name: string;
  readonly slug: string;
  readonly waPhone?: string;
  /**
   * El TC en pesos por dólar, **tal cual lo tipea el dueño**: el input es `type="text"` y el
   * parser del borde (`_lib/tenants/parse-fx.ts`) acepta coma o punto y rechaza el separador de
   * miles. Es obligatorio en el alta desde S3.1 y no es un olvido de UX: `CLAUDE.md` §1 manda que
   * el TC lo ponga una persona, y sin fila en `fx_settings` la vidriera no publica **nada**.
   *
   * Opcional acá porque a la mayoría de los specs el número les da igual — lo que necesitan es un
   * negocio que exista. El que publica ARS y afirma el precio lo pasa explícito.
   */
  readonly fxRate?: number | string;
  readonly acceptsTradeIn?: boolean;
}

/**
 * TC de los fixtures. Es el mismo `1487.50` que siembra `seedFxSettings()` en `_lib/db.ts`, a
 * propósito: los specs que además upsertean el TC por SQL escriben el número que el alta ya dejó,
 * así que ese `insert ... on conflict` no puede cambiar en silencio lo que la vidriera publica.
 */
export const FIXTURE_FX_RATE = '1487.50';

/**
 * El `<form>` del alta. Se ancla en un campo que el panel ya tenía (`slug`) y no en un testid: el
 * alta del negocio no tiene contrato de `data-testid` y `qa-agent` no inventa uno.
 */
function createBusinessForm(page: Page): Locator {
  return page.locator('form:has(input[name="slug"])').first();
}

/**
 * Los controles `required` del alta que quedaron **vacíos**, por `name`.
 *
 * ## Por qué existe esta función
 * El día que el panel agregó `fxRate` required, este helper siguió llenando tres campos, apretó
 * el botón, el alta se rechazó y los **seis** specs que crean un negocio murieron en el mismo
 * `waitForURL` con la palabra "Timeout" y nada más. El costo no fue el rojo — el rojo estaba
 * bien— sino que el rojo no nombraba la causa.
 *
 * Se lee el DOM en vez de `form.checkValidity()` porque el formulario se sirve con `noValidate`
 * (el panel valida en el server y muestra los mensajes en castellano): con `noValidate` el browser
 * **no** frena el submit, así que apoyarse en la validación nativa daría un guard que no guarda
 * nada. El atributo `required` sigue siendo la declaración de intención del panel y eso es lo que
 * se lee.
 *
 * Checkbox, radio y file quedan afuera: "vacío" no significa lo mismo para ellos y un helper que
 * los reportara mentiría con un campo opcional tildado.
 */
async function emptyRequiredFields(form: Locator): Promise<readonly string[]> {
  const controls = form.locator('input[required], select[required], textarea[required]');
  const total = await controls.count();
  const empty: string[] = [];
  for (let index = 0; index < total; index += 1) {
    const control = controls.nth(index);
    const type = ((await control.getAttribute('type')) ?? 'text').toLowerCase();
    if (type === 'checkbox' || type === 'radio' || type === 'file') continue;
    if ((await control.inputValue()).trim() !== '') continue;
    empty.push((await control.getAttribute('name')) ?? '(un campo sin atributo name)');
  }
  return empty;
}

/** Lo que el alta muestra en pantalla después de un envío que no navegó. */
async function createBusinessProblems(form: Locator): Promise<string> {
  const alerts = form.locator('[role="alert"]');
  const alertTotal = await alerts.count();
  const messages: string[] = [];
  for (let index = 0; index < alertTotal; index += 1) {
    const text = ((await alerts.nth(index).textContent()) ?? '').trim();
    if (text !== '') messages.push(text);
  }

  const invalid = form.locator('[aria-invalid="true"]');
  const invalidTotal = await invalid.count();
  const fields: string[] = [];
  for (let index = 0; index < invalidTotal; index += 1) {
    fields.push((await invalid.nth(index).getAttribute('name')) ?? '(sin name)');
  }

  if (messages.length === 0 && fields.length === 0) {
    return '(el formulario no muestra ningún error: el alta no respondió, o respondió y no redirigió)';
  }
  return (
    `campos marcados inválidos: ${fields.length === 0 ? '(ninguno)' : fields.join(', ')}` +
    ` · mensajes: ${messages.length === 0 ? '(ninguno)' : messages.join(' | ')}`
  );
}

export async function createBusiness(page: Page, business: NewBusiness): Promise<void> {
  await page.goto(`${APEX_URL}/app/crear-negocio`);

  const form = createBusinessForm(page);
  await expect(
    form,
    `${APEX_URL}/app/crear-negocio no sirvió el formulario de alta (¿la sesión no quedó?)`,
  ).toBeVisible({ timeout: 20_000 });

  await page.locator('input[name="name"]').fill(business.name);
  // El campo del link es controlado y se autocompleta desde el nombre: escribirlo marca
  // `slugTouched` y gana lo que tipeó la persona, que es exactamente lo que hace un dueño que
  // no quiere el link sugerido.
  await page.locator('input[name="slug"]').fill(business.slug);
  await page.locator('input[name="waPhone"]').fill(business.waPhone ?? '299 555 1234');
  // El TC. Sin él el alta se rechaza entera: es un campo del formulario, no un default nuestro.
  await page
    .locator('input[name="fxRate"]')
    .fill(business.fxRate === undefined ? FIXTURE_FX_RATE : String(business.fxRate));
  if (business.acceptsTradeIn === true) {
    await page.locator('input[name="acceptsTradeIn"]').check();
  }

  // ── Antes de apretar: que el helper no pueda fallar en silencio ──────────────────────────────
  // Si el panel sumó otro campo obligatorio que este helper no conoce, el rojo tiene que decir
  // **cuál**, acá y ahora, y no 30 segundos después en forma de timeout sin causa.
  const pending = await emptyRequiredFields(form);
  if (pending.length > 0) {
    throw new Error(
      `el alta del negocio tiene campo(s) obligatorio(s) que este helper dejó vacío(s): ` +
        `${pending.join(', ')}.\n` +
        '  El panel agregó un `required` y `createBusiness()` quedó atrás: agregalo a ' +
        '`NewBusiness` y llenalo acá. NO se saca el `required` del panel para poner esto en verde.',
    );
  }

  // La disponibilidad se consulta con debounce; el botón queda deshabilitado si el slug está
  // tomado. Esperar a que se habilite es esperar a que el panel esté de acuerdo con el test.
  const submit = page.getByRole('button', { name: /crear mi negocio/iu });
  await expect(submit).toBeEnabled({ timeout: 15_000 });
  await submit.click();

  // `createTenantAction` redirige a `/app` sólo si el alta salió bien. Cuando no sale bien la
  // persona se queda en la misma pantalla con el motivo escrito: eso es lo que hay que reportar.
  try {
    await page.waitForURL(/\/app(\/)?$/u, { timeout: 30_000 });
  } catch {
    throw new Error(
      `el alta no redirigió a /app: el negocio "${business.slug}" no se creó.\n` +
        `  url actual: ${page.url()}\n` +
        `  ${await createBusinessProblems(form)}`,
    );
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  S2 · cargar un equipo son DOS pantallas, y no por gusto de UX
// ══════════════════════════════════════════════════════════════════════════════════════════════
//
// El POST del alta cae en el catch-all del `matcher` de `proxy.ts`, así que lo procesa el Routing
// Middleware de Vercel, cuyo request body está capado en **4 MB** y no varía por plan (verificado
// por el LEAD contra la doc oficial el 2026-08-27, `docs/research/vercel-request-body-limit.md`).
// Tres fotos de celular son ~9 MB y no entran en ningún submit.
//
// De ahí el flujo que estos helpers recorren, que es el que hace el dueño:
//
// ```
//   /app/stock/nuevo          datos + catálogo + UNA foto   → redirect
//   /app/stock/{id}/fotos     una foto por request, hasta 3 → habilita publicar
// ```
//
// Los helpers navegan **como navega una persona** —labels, selects, `<input type="file">`, botón—
// y nunca llaman a la Server Action a mano. Si un helper hiciera un `insert`, S2 probaría que
// Postgres funciona en vez de probar que el camino del panel llega al pipeline de `packages/media`
// sin degradar la imagen.
//
// Los `data-testid` de acá abajo son **el contrato que fijó el LEAD**, palabra por palabra.
// `qa-agent` no los cambia unilateralmente: si están mal, se reporta.

/** Ruta del alta. */
export const NEW_UNIT_PATH = '/app/stock/nuevo';
/** Ruta de la lista. */
export const STOCK_PATH = '/app/stock';
/** Ruta de las fotos de un equipo. Nueva en la ronda 2. */
export function photosPath(listingId: string): string {
  return `/app/stock/${listingId}/fotos`;
}

/** `/app/stock` y no `/app/stock/nuevo`: sin el ancla, el `waitForURL` se cumple solo. */
export const STOCK_URL_RE = /\/app\/stock\/?(?:\?[^#]*)?(?:#.*)?$/u;

/** `/app/stock/{uuid}/fotos`, con el id capturado. */
export const PHOTOS_URL_RE =
  /\/app\/stock\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/fotos\/?(?:[?#].*)?$/u;

export interface PhotoUpload {
  readonly name: string;
  readonly mimeType: string;
  readonly buffer: Buffer;
}

export interface NewUnit {
  readonly title: string;
  /** Enum de `listing_condition`. La ficha lo traduce; acá va el valor de dominio. */
  readonly condition: string;
  readonly storageGb: number;
  readonly color: string;
  readonly priceUsd: number;
  readonly batteryPct: number;
  /** 15 dígitos. SENSITIVE: el spec afirma que no sale en la lista. */
  readonly imei: string;
  /** SENSITIVE: `CLAUDE.md` §0.9. */
  readonly costUsd: number;
  /**
   * Texto que tiene que aparecer en la opción del catálogo global. Opcional: si no matchea
   * ninguna (o no se pasa), se elige la primera opción real. Lo que **no** se hace es inventar un
   * `catalogModelId`: `catalog_models` es una tabla global sembrada por `pnpm db:seed`, y un UUID
   * inventado sería un `POST` armado a mano, no el camino del dueño.
   */
  readonly catalogModelHint?: string;
  /** UNA. El techo de 4 MB del middleware no deja más. */
  readonly photo: PhotoUpload;
}

export interface CatalogOption {
  readonly value: string;
  readonly label: string;
}

export interface CreatedUnit {
  readonly listingId: string;
  readonly catalogModel: CatalogOption;
}

/**
 * Llena un campo por `name` sin suponer con qué elemento lo resolvió `app-agent`.
 *
 * El contrato fija el **`name`**, no el tag: `condition` es un enum y lo natural es un `<select>`,
 * pero podría ser un grupo de radios o un combobox. Un test que exige `<select>` estaría probando
 * una decisión de UI que el contrato no tomó, y el rojo diría "no es un select" en vez de "no se
 * puede cargar una unidad". Se adapta al elemento y se rompe sólo si el campo no existe.
 */
export async function setField(page: Page, name: string, value: string): Promise<void> {
  const field = page.locator(`[name="${name}"]`).first();
  await expect(
    field,
    `el alta no tiene el campo name="${name}" que fija el contrato de S2`,
  ).toBeAttached({ timeout: 15_000 });

  const tag = (await field.evaluate((el) => el.tagName)).toLowerCase();
  if (tag === 'select') {
    await field.selectOption(value);
    return;
  }
  const type = ((await field.getAttribute('type')) ?? 'text').toLowerCase();
  if (type === 'radio' || type === 'checkbox') {
    await page.locator(`[name="${name}"][value="${value}"]`).first().check();
    return;
  }
  await field.fill(value);
}

/**
 * Las opciones **reales** del `<select name="catalogModelId">`, sin el placeholder vacío.
 *
 * Se leen con la API de locators y no con un `evaluateAll` sobre `HTMLOptionElement`: el tsconfig
 * de los e2e declara `types: ["node"]` y no trae la lib del DOM a propósito. Un test que necesita
 * tipos del navegador para leer un `<option>` está mirando el DOM más de cerca de lo que hace
 * falta.
 */
export async function catalogOptions(page: Page): Promise<readonly CatalogOption[]> {
  const select = page.getByTestId('select-catalog-model');
  await expect(
    select,
    `${NEW_UNIT_PATH} no expone data-testid="select-catalog-model" (contrato de la ronda 2). ` +
      '`checkPublishable` deniega `missing_catalog_model` para todo kind="unit": sin este campo ' +
      'no hay unidad publicable.',
  ).toBeVisible({ timeout: 20_000 });

  const options = select.locator('option');
  // `.count()` no reintenta. Si la ruta todavía está transmitiendo, un `<select>` recién flusheado
  // se lee con cero `<option>` y el conteo de abajo compara la nada contra el catálogo real. Se
  // espera por la condición —que haya al menos una— antes de congelar la lectura.
  await expect(
    options,
    `el <select name="catalogModelId"> de ${NEW_UNIT_PATH} nunca llegó a tener una sola ` +
      '<option>: o la pantalla no terminó de servirse, o `catalog_models` está vacía (la siembra ' +
      '`pnpm --filter @istock/db seed`)',
  ).not.toHaveCount(0, { timeout: 20_000 });

  const total = await options.count();
  const out: CatalogOption[] = [];
  for (let index = 0; index < total; index += 1) {
    const option = options.nth(index);
    const value = (await option.getAttribute('value')) ?? '';
    if (value === '') continue; // el placeholder "Elegí un modelo…"
    out.push({ value, label: ((await option.textContent()) ?? '').trim() });
  }
  return out;
}

/**
 * Elige un modelo del catálogo global y devuelve cuál quedó elegido.
 *
 * El fallo por catálogo vacío tiene mensaje propio porque es el fallo que más tiempo hace perder:
 * `catalog_models` no lleva `tenant_id` y no la crea el alta, la siembra `pnpm db:seed`. Sin ese
 * seed la pantalla se ve bien, el `<select>` existe y no hay nada para elegir.
 */
export async function chooseCatalogModel(page: Page, hint?: string): Promise<CatalogOption> {
  const options = await catalogOptions(page);
  if (options.length === 0) {
    throw new Error(
      'el <select name="catalogModelId"> no tiene ninguna opción real: `catalog_models` es una ' +
        'tabla GLOBAL (sin tenant_id) que siembra `pnpm --filter @istock/db seed`. Sembrala antes ' +
        'de correr los e2e o el alta de una unidad no se puede completar nunca.',
    );
  }

  const wanted =
    hint === undefined
      ? undefined
      : options.find((option) => option.label.toLowerCase().includes(hint.toLowerCase()));
  const chosen = wanted ?? options[0];
  if (chosen === undefined) throw new Error('catálogo vacío después de filtrar: imposible');

  await page.getByTestId('select-catalog-model').selectOption(chosen.value);
  return chosen;
}

/** El `<input type="file">` del alta, ya verificado como presente. */
function altaPhotoInput(page: Page) {
  return page.getByTestId('input-foto');
}

/** Texto visible de un contenedor de error, o `null` si no hay ninguno en pantalla. */
export async function errorTextIn(page: Page, testId: string): Promise<string | null> {
  const box = page.getByTestId(testId);
  if ((await box.count()) === 0) return null;
  const text = ((await box.first().textContent()) ?? '').trim();
  return text === '' ? null : text;
}

/**
 * Ruta A: carga el equipo con **una** foto y termina en `/app/stock/{id}/fotos`.
 *
 * Devuelve el id que quedó en la URL. Ese id es el que el contrato promete y el que después usa
 * la ruta B; leerlo de la URL en vez de buscarlo en la base es a propósito: si el redirect llevara
 * al equipo equivocado, un `select` por tenant no lo notaría y este helper sí.
 */
export async function createUnitDraft(page: Page, unit: NewUnit): Promise<CreatedUnit> {
  await page.goto(`${APEX_URL}${NEW_UNIT_PATH}`);

  const form = page.getByTestId('form-nueva-unidad');
  await expect(
    form,
    `${NEW_UNIT_PATH} no expone data-testid="form-nueva-unidad" (contrato de S2)`,
  ).toBeVisible({ timeout: 20_000 });

  await setField(page, 'title', unit.title);
  await setField(page, 'condition', unit.condition);
  await setField(page, 'storageGb', String(unit.storageGb));
  await setField(page, 'color', unit.color);
  await setField(page, 'priceUsd', String(unit.priceUsd));
  await setField(page, 'batteryPct', String(unit.batteryPct));
  await setField(page, 'imei', unit.imei);
  await setField(page, 'costUsd', String(unit.costUsd));

  const catalogModel = await chooseCatalogModel(page, unit.catalogModelHint);

  const photo = altaPhotoInput(page);
  await expect(
    photo,
    'el alta no tiene data-testid="input-foto": sin él no hay nada que medir en S2',
  ).toBeAttached({ timeout: 15_000 });
  await photo.setInputFiles(unit.photo);

  await page.getByTestId('submit-nueva-unidad').click();

  // El resize de 12 MP + 4 encodes WebP corren server-side dentro de este request (~0.5 s de CPU),
  // más el round-trip del form. 90 s es holgado y sigue siendo un techo: si el alta tarda más que
  // esto, el dueño ya cerró la pestaña.
  try {
    await page.waitForURL(PHOTOS_URL_RE, { timeout: 90_000 });
  } catch {
    // Un `waitForURL` vencido dice "timeout" y nada más. Lo que hace falta saber es qué contestó
    // el alta, y eso está en la pantalla.
    const shown = await errorTextIn(page, 'error-alta');
    throw new Error(
      `el alta no redirigió a /app/stock/{id}/fotos (contrato de la ronda 2).\n` +
        `  url actual: ${page.url()}\n` +
        `  error-alta: ${shown ?? '(no hay data-testid="error-alta" en pantalla)'}`,
    );
  }

  const listingId = PHOTOS_URL_RE.exec(page.url())?.[1];
  if (listingId === undefined) {
    throw new Error(`la URL ${page.url()} no trae el id del listing`);
  }

  // La URL cambió; la pantalla puede no haber llegado todavía. Un helper que promete "el dueño
  // quedó parado en la pantalla de fotos" y vuelve con la barra de direcciones puesta y el
  // `<main>` vacío está mintiendo, y el que paga la mentira es el test que llama después.
  //
  // Se espera el **contenedor** y a propósito NO una `foto-cargada`: si esperara una foto, el test
  // que afirma que el alta dejó exactamente una quedaría probado por el helper (o sea, por nadie),
  // y un alta que redirige sin haber guardado la foto se vería como un timeout del helper en vez
  // de como el rojo que es. El contrato de pantalla lo espera el helper; la cantidad la afirma el
  // test.
  await expect(
    photosScreen(page),
    `el alta redirigió a ${page.url()} pero la pantalla nunca sirvió ` +
      'data-testid="fotos-de-la-unidad": la ruta contesta la URL antes de resolver el equipo',
  ).toBeVisible({ timeout: 30_000 });

  return { listingId, catalogModel };
}

// ── Ruta B · `/app/stock/{id}/fotos` ─────────────────────────────────────────────────────────

/**
 * El contenedor de la pantalla de fotos: es **el contrato de que la pantalla se sirvió**, no una
 * decoración. Mientras no esté, no hay nada que contar adentro.
 */
export function photosScreen(page: Page): Locator {
  return page.getByTestId('fotos-de-la-unidad');
}

/**
 * Las fotos que muestra la pantalla del equipo, como **locator**. Éste es el camino de toda
 * aserción de cantidad: `await expect(loadedPhotos(page), mensaje).toHaveCount(n)`.
 *
 * ## Por qué un locator y no un número
 * `Locator.count()` es una lectura **congelada**: pregunta cuántos nodos hay *en este instante* y
 * no reintenta. Con una ruta que transmite —PPR, un Suspense, o simplemente un server lento— la
 * URL puede cambiar antes de que exista un solo `foto-cargada` en el DOM, y entonces el conteo da
 * 0 y el rojo dice "la pantalla no muestra la foto" cuando la verdad es "todavía no terminó de
 * servirse". Las dos cosas se arreglan distinto y el mensaje mandaba a arreglar la equivocada.
 *
 * `toHaveCount` reintenta hasta el timeout, así que la aserción afirma lo mismo pero **deja de
 * depender de que la ruta resuelva rápido**. Eso importa incluso cuando la ruta bloquea: el día
 * que algo vuelva a transmitir, este test tiene que seguir diciendo la verdad sin que nadie lo
 * toque.
 */
export function loadedPhotos(page: Page): Locator {
  return page.getByTestId('foto-cargada');
}

/**
 * Cuántas fotos muestra la pantalla **en este instante**. Es una lectura congelada: sirve para
 * armar mensajes de error y para diagnosticar, y **nunca** es el camino de una aserción — para eso
 * está `loadedPhotos()` con `toHaveCount`. Ver el docblock de arriba.
 */
export async function loadedPhotoCount(page: Page): Promise<number> {
  return loadedPhotos(page).count();
}

/**
 * Texto del aviso de fotos faltantes, o `null` si el nodo no está (o sea: ya no faltan).
 *
 * Le da al aviso la misma chance de aparecer que le da `toHaveCount` a una foto: `errorTextIn` es
 * una lectura congelada, y el aviso es un nodo distinto de la grilla de fotos —puede llegar en
 * otro chunk. Sin esta espera, un aviso que tarda se reporta como "no hay ningún faltan-fotos en
 * pantalla", que es el rojo equivocado. La espera se traga el vencimiento a propósito: el que
 * decide si tenía que estar es la aserción del test, con su mensaje, y no este helper.
 *
 * Cuando el aviso **no** tiene que estar (3 de 3 fotos), el test no llama acá: afirma
 * `toHaveCount(0)` sobre el testid, que es la aserción correcta para una ausencia.
 */
export async function missingPhotosText(page: Page): Promise<string | null> {
  await page
    .getByTestId('faltan-fotos')
    .waitFor({ state: 'visible', timeout: 15_000 })
    .catch(() => undefined);
  return errorTextIn(page, 'faltan-fotos');
}

/** Navega a la pantalla de fotos y devuelve la respuesta (para poder leer el status). */
export async function gotoPhotos(page: Page, listingId: string) {
  return page.goto(`${APEX_URL}${photosPath(listingId)}`);
}

/**
 * Sube **una** foto más en la ruta B y espera a que la pantalla muestre `expectedTotal` fotos.
 *
 * Se espera por la condición —el total en pantalla— y nunca por reloj. Y se falla con el texto de
 * `error-foto` adentro del mensaje: sin eso, un rechazo del server se reporta como "timeout
 * esperando 2 fotos", que es la clase de rojo que manda a alguien a leer el trace en vez de leer
 * el error.
 *
 * ## Por qué el total viene de afuera y no de un `before` que el helper cuenta solo
 * Contar antes de subir es la misma lectura congelada que rompió este spec, sólo que escondida: si
 * la pantalla todavía no terminó de renderizar, el `before` sale 0, el helper espera 1 y da por
 * buena una foto que en realidad es la del alta. El que llama sabe cuántas fotos tiene que haber
 * —es la regla que está probando— así que lo dice, y la espera pasa a ser una condición absoluta
 * que no depende de en qué momento se leyó el DOM.
 */
export async function addPhoto(
  page: Page,
  upload: PhotoUpload,
  expectedTotal: number,
): Promise<void> {
  const { count, error } = await tryAddPhoto(page, upload, expectedTotal);
  if (count === expectedTotal) return;
  throw new Error(
    `subir una foto más en ${page.url()} no dejó ${String(expectedTotal)} fotos en pantalla: ` +
      `hay ${String(count)}.\n  error-foto: ${error ?? '(no hay data-testid="error-foto" en pantalla)'}`,
  );
}

/**
 * Igual que `addPhoto`, pero **no supone que salga bien**: es el helper de los tests que prueban
 * el rechazo. Devuelve el estado en el que quedó la pantalla.
 *
 * `acceptedTotal` es cuántas fotos tendría que mostrar la pantalla **si el server acepta ésta**.
 * Es dato del que llama por el mismo motivo que en `addPhoto`: un baseline contado acá adentro se
 * lee cuando se lee, y con una ruta que transmite eso es una moneda al aire.
 *
 * `Promise.any` en vez de `race`: sirve la primera de las dos condiciones que se cumpla —el total
 * esperado, o un error visible— y si no se cumple ninguna en 90 s, el que grita es el `expect` del
 * test que llamó, con su propio mensaje.
 *
 * El `count` que vuelve es una lectura congelada **de reporte**: se toma recién después de que una
 * de las dos condiciones se cumplió (o venció), y los tests afirman la cantidad con
 * `expect(loadedPhotos(page)).toHaveCount(...)`, que reintenta.
 */
export async function tryAddPhoto(
  page: Page,
  upload: PhotoUpload,
  acceptedTotal: number,
): Promise<{ readonly count: number; readonly error: string | null }> {
  await expect(
    photosScreen(page),
    `${page.url()} no expone data-testid="fotos-de-la-unidad" (contrato de la ronda 2)`,
  ).toBeVisible({ timeout: 20_000 });

  const input = page.getByTestId('input-agregar-foto');
  await expect(
    input,
    'la pantalla de fotos no tiene data-testid="input-agregar-foto"',
  ).toBeAttached({ timeout: 15_000 });
  await input.setInputFiles(upload);
  await page.getByTestId('submit-agregar-foto').click();

  await Promise.any([
    expect(loadedPhotos(page)).toHaveCount(acceptedTotal, { timeout: 90_000 }),
    page.getByTestId('error-foto').waitFor({ state: 'visible', timeout: 90_000 }),
  ]).catch(() => undefined);

  return { count: await loadedPhotoCount(page), error: await errorTextIn(page, 'error-foto') };
}

/**
 * El camino completo del dueño: alta con la primera foto y después una por request hasta llegar a
 * las tres que `MIN_PHOTOS_TO_PUBLISH` exige.
 */
export async function createUnitWithPhotos(
  page: Page,
  unit: NewUnit,
  extraPhotos: readonly PhotoUpload[],
): Promise<CreatedUnit> {
  const created = await createUnitDraft(page, unit);
  // El alta ya dejó una: la siguiente tiene que dejar dos, y así. El total es absoluto a propósito
  // (ver `addPhoto`).
  let total = 1;
  for (const upload of extraPhotos) {
    total += 1;
    await addPhoto(page, upload, total);
  }
  return created;
}

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  S3 · publicar. El último clic antes de que el equipo exista para un desconocido.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Se aprieta el botón real (`data-testid="submit-publicar"`, contrato del LEAD) y no se hace un
 * `update listings set status='available'`. La diferencia no es de pureza: publicar dispara
 * `invalidateStorefrontUnit()`, que es lo que purga `storefront:{slug}` y `tenant-config:{slug}`.
 * Un `update` por SQL dejaría la fila publicada y el cache de la vidriera intacto — o sea, la
 * grilla vacía y un spec rojo culpando al render.
 *
 * El botón nace `disabled` hasta que hay 3 fotos (`MIN_PHOTOS_TO_PUBLISH`), así que primero se
 * espera a que se habilite: si nunca se habilita, el rojo tiene que decir "el panel no deja
 * publicar" y no "no encontré el botón". El `disabled` es cortesía de UI y quien autoriza es
 * `checkTransition()` adentro de la Server Action; acá se navega como el dueño y punto.
 */
export async function publishUnit(page: Page): Promise<void> {
  const button = page.getByTestId('submit-publicar');
  await expect(
    button,
    'la pantalla de fotos no tiene data-testid="submit-publicar" (contrato de S2/S3)',
  ).toBeAttached({ timeout: 20_000 });

  await expect(
    button,
    'el botón de publicar sigue deshabilitado: el panel no considera publicable a este equipo ' +
      `(faltan fotos, o falta el modelo de catálogo). Aviso en pantalla: ${
        (await missingPhotosText(page)) ?? '(no hay data-testid="faltan-fotos")'
      }`,
  ).toBeEnabled({ timeout: 20_000 });

  await button.click();

  // `after="stock"` redirige a `/app/stock` sólo si la transición salió bien. Si la acción la
  // rechaza, el dueño se queda en la pantalla de fotos con un `role="alert"`, y eso es lo que hay
  // que contar en el mensaje: un timeout pelado mandaría a leer el trace.
  try {
    await page.waitForURL(STOCK_URL_RE, { timeout: 30_000 });
  } catch {
    const alert = page.getByRole('alert');
    const shown = (await alert.count()) > 0 ? ((await alert.first().textContent()) ?? '').trim() : '';
    throw new Error(
      `publicar no llevó a ${STOCK_PATH}: el equipo quedó sin publicar.\n` +
        `  url actual: ${page.url()}\n` +
        `  alerta: ${shown === '' ? '(sin alerta en pantalla)' : shown}`,
    );
  }
}
