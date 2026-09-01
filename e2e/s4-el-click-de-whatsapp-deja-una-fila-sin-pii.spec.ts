/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  S4 · el click de WhatsApp deja UNA fila, sin PII, en el tenant correcto. Owner: `qa-agent`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Este archivo **nace en rojo, a propósito**. Se escribe antes de que exista el handler
 * `apps/web/app/(storefront)/s/[slug]/api/track/route.ts` y antes de que exista la policy
 * `wa_click_events_storefront_insert`, para que nadie pueda elegir a qué se parece la aceptación
 * después de haber implementado. Un test que nunca se vio fallar no prueba nada (`CLAUDE.md` §0).
 *
 * `qa-agent` **no edita el código bajo test para poner esto en verde** (`CLAUDE.md` §4). Si algo
 * de acá se pone rojo, el defecto es de la implementación hasta que se demuestre lo contrario.
 *
 * ── Las tres mediciones que emite este archivo, y que `scripts/accept-s4.sh` sólo LEE ──────────
 *
 * ```
 * MEDIDO s4 sinjs · ruta=… · anchors=N · href=… · abre_whatsapp=si|no
 * MEDIDO s4 click · ruta=… · filas_al_cargar=N · filas_antes=N · filas_despues=N · tenant_ok=… · listing_ok=…
 * MEDIDO s4 cruce · slug_atacante=… · listing_de=… · filas_creadas=N
 * ```
 *
 * El gate **falla si la línea no está**: ausencia de medición es FAIL, nunca PASS. Por eso cada
 * línea se emite **antes** de las aserciones del test que la produjo — si una aserción se cae, el
 * número ya salió y se puede leer qué pasó. Y por eso ninguna se emite con valores inventados:
 * una medición que no ocurrió tiene que verse como ausente, no como un cero (misma disciplina que
 * `_lib/pg-spy.ts`: *un cero que en realidad significa "no vi nada" es la peor medición posible*).
 *
 * ── Por qué `sinjs` es una MEDICIÓN sobre la página servida y no un grep ───────────────────────
 * El `wa.me` atravesó toda la FASE 3 con tres pruebas alrededor y ninguna encima de la página que
 * el servidor manda. Un grep confirma que `wa-button.tsx` *dice* `href={listing.waUrl}`; no dice
 * absolutamente nada sobre lo que sale por el socket. Acá la ficha se carga en un contexto con
 * **`javaScriptEnabled: false`** —o sea el peor caso real: el visitante con el 3G de la ruta 22 y
 * el bundle a medio bajar— y se cuenta el anchor en el DOM servido.
 *
 * El invariante es de plata, no de telemetría: **el beacon es telemetría, y si la telemetría puede
 * romper la venta la slice está al revés.** Un `preventDefault()` en el componente para "asegurar"
 * el tracking ataría la única acción que da plata al éxito de un `fetch`. Por eso el harness
 * cancela la navegación **externa** desde afuera (`route.abort()` sobre `https://wa.me/**`) y
 * jamás pidiéndole a la app que cancele el click.
 *
 * ── Por qué `filas_al_cargar` NO es redundante con `filas_antes` ───────────────────────────────
 * Es la medición que `cost-auditor` marcó como el riesgo más probable de S4, y es de costo tanto
 * como de privacidad. Si el beacon disparara en el *view* en vez de en el click:
 *
 * 1. `allowed requests ≈ pageviews`, y el renglón de WAF del presupuesto pasa de fijo a
 *    proporcional al tráfico — que es exactamente lo que `config/firewall-rules.json` explica que
 *    no se hace;
 * 2. la tabla deja de medir **intención de compra**. Contar cuánta gente miró ya lo hace PostHog;
 *    `wa_click_events` existe para contar cuánta gente **apretó**.
 *
 * Entre `filas_al_cargar` (antes de navegar) y `filas_antes` (con la ficha cargada y asentada) la
 * cuenta no se puede mover. Y "asentada" no es un `sleep`: es `load` → el anchor visible →
 * `networkidle` → y **una espera por condición con presupuesto** que corta apenas aparecería una
 * fila. Si el beacon estuviera atado al view, ese poll lo agarra; si no lo está, la espera se
 * consume entera y el número sale igual. Ver {@link esperarFilas}.
 *
 * ── Por qué el `cruce` es la mitad de la slice que ninguna otra prueba puede ver ───────────────
 * El endpoint es la **única escritura sin autenticar del producto**. El tenant sale del segmento
 * de path que escribió el proxy desde el host (`{slug}.maat.work/api/track` → `/s/{slug}/api/track`),
 * jamás de un campo del body. Un POST crudo contra la vidriera del atacante nombrando el
 * `listing_id` de otro negocio tiene que crear **cero** filas — y cero **para los dos tenants**,
 * no sólo para el que el atacante nombró. Por eso se cuentan las filas de ambos, antes y después.
 *
 * Se mandan cuatro variantes del mismo ataque porque el nombre exacto del campo es un detalle de
 * una implementación que todavía no existe, y el invariante no puede depender de adivinarlo: si
 * cualquiera de las cuatro escribe una fila, la escritura cross-tenant existe (`CLAUDE.md` §7).
 * La variante que manda `tenantId` en el body es la más importante de las cuatro: es literalmente
 * el ataque que la regla "el tenant nunca sale del body" existe para negar.
 *
 * Ese test lleva además un **control de vida**, y sin él sería el peor test del repo: contra una
 * ruta que no existe, `filas_creadas=0` sale verde sin probar nada de aislamiento. La sonda es un
 * `GET` al mismo endpoint —405 si la ruta existe y sólo exporta `POST`, 404 si no existe— porque
 * es la única señal de vida que no obliga a fijar de antemano ni el nombre de un campo del body ni
 * el status con el que el POST rechazado contesta. Las dos cosas son de `storefront-agent`.
 *
 * ── Sin PII, tampoco acá ──────────────────────────────────────────────────────────────────────
 * La tabla es "sin PII" por diseño: no se anonimiza, no se recibe. Este spec no la inventa —no
 * lee ni imprime IP, user agent ni teléfono del visitante— y `_lib/db.ts` sólo trae `id`,
 * `tenant_id`, `listing_id` y `source`.
 */

import type { Page } from '@playwright/test';
import { expect, test } from './_lib/fixtures';
import {
  countWaClickEvents,
  deleteTenantBySlug,
  deleteWaClickEvents,
  seedFxSettings,
  seedListingPhoto,
  seedLocation,
  seedPublicUnit,
  seedTenant,
  tenantIdBySlug,
  waClickEventRows,
} from './_lib/db';
import { storefrontUrl, uniqueSlug } from './_lib/env';

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  Fixtures: dos vidrieras vivas. La segunda no es decorado — es el atacante del tercer test.
// ══════════════════════════════════════════════════════════════════════════════════════════════
//
// La ficha se siembra por SQL y no por el panel por el mismo motivo que en el spec de db-hits: lo
// que se audita acá es el **evento**, y ni la cuenta de filas ni el `href` servido cambian un
// dígito según cómo nació la fila. `fx_settings` y `locations` son precondición sin pantalla
// hasta S5: sin TC la ficha ni siquiera renderiza (ver `_lib/db.ts`).
//
// Tenants nuevos por corrida, nunca `demo`: `filas_al_cargar` tiene que poder valer 0 de verdad.
// Con el tenant del seed, cualquier corrida anterior habría dejado clicks adentro y la medición
// más cara del archivo —"cargar la ficha no escribió NADA"— se volvería un delta sobre basura.

const vidrieraSlug = uniqueSlug('waclick');
const atacanteSlug = uniqueSlug('atacante');
const listingSlug = uniqueSlug('iphone-14-pro-256-grafito');
const listingAtacanteSlug = uniqueSlug('iphone-13-128-azul');
const TITULO = 'iPhone 14 Pro 256 Grafito';
const PRECIO_USD = 620;

/** El copy de negocio que tiene que llegar completo a la conversación, no sólo por fragmentos. */
const MENSAJE_WA_EXACTO =
  `Hola, vi el ${TITULO} (usado A) a USD ${String(PRECIO_USD)} en ` +
  `${vidrieraSlug}.maat.work y lo quiero.`;

/** El `wa_phone` que `seedTenant` le pone al fixture: es el número que tiene que estar en el href. */
const WA_PHONE = '5492994123456';

/** Ruta pública de la ficha bajo el host del tenant. El slug del tenant ya está en el host. */
const RUTA_FICHA = `/p/${listingSlug}`;

/** Ruta pública del beacon. El proxy la reescribe a `/s/{slug}/api/track`. */
const RUTA_TRACK = '/api/track';

const SELECTOR_WA = 'a[data-wa="listing"]';

/** Todo lo que sale del sitio hacia WhatsApp se corta acá, en el harness. Nunca en la app. */
const AFUERA = ['https://wa.me/**', 'http://wa.me/**'] as const;

let vidrieraTenantId = '';
let atacanteTenantId = '';
let listingId = '';

test.beforeAll(async () => {
  test.setTimeout(120_000);

  await seedTenant({ slug: vidrieraSlug, name: 'Vidriera QA clicks', waPhone: WA_PHONE });
  const vidriera = await tenantIdBySlug(vidrieraSlug);
  if (vidriera === null) throw new Error(`el tenant ${vidrieraSlug} no quedó en la base`);
  vidrieraTenantId = vidriera;
  await seedFxSettings(vidrieraTenantId);
  await seedLocation(vidrieraTenantId);
  listingId = await seedPublicUnit({
    tenantId: vidrieraTenantId,
    slug: listingSlug,
    title: TITULO,
    priceUsd: PRECIO_USD,
    imei: '351234567890123',
    costUsd: 500,
  });
  await seedListingPhoto(vidrieraTenantId, listingId, 0);

  await seedTenant({ slug: atacanteSlug, name: 'Vidriera QA atacante' });
  const atacante = await tenantIdBySlug(atacanteSlug);
  if (atacante === null) throw new Error(`el tenant ${atacanteSlug} no quedó en la base`);
  atacanteTenantId = atacante;
  await seedFxSettings(atacanteTenantId);
  await seedLocation(atacanteTenantId);
  // La vidriera del atacante tiene su propio equipo publicado a propósito: un tenant vacío haría
  // que el endpoint pudiera rechazar el POST por "no hay nada acá" en vez de por aislamiento, y el
  // test estaría midiendo la razón equivocada.
  await seedPublicUnit({
    tenantId: atacanteTenantId,
    slug: listingAtacanteSlug,
    title: 'iPhone 13 128 Azul',
    priceUsd: 430,
  });
});

test.afterAll(async () => {
  await deleteWaClickEvents(vidrieraTenantId);
  await deleteWaClickEvents(atacanteTenantId);
  await deleteTenantBySlug(vidrieraSlug);
  await deleteTenantBySlug(atacanteSlug);
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  Espera por CONDICIÓN, con presupuesto. No es un `sleep` disfrazado y la diferencia importa.
// ══════════════════════════════════════════════════════════════════════════════════════════════
//
// El `insert` del beacon es asíncrono respecto del click: `navigator.sendBeacon` encola y el
// browser sigue. Contar filas "justo después" mediría la latencia de la red, no la regla.
//
// Dos usos, opuestos a propósito:
//
// - **para el click**, donde se espera que la fila APAREZCA: el poll corta apenas aparece, así que
//   el test tarda lo que tarda el producto y no el presupuesto;
// - **para el view**, donde se espera que NO aparezca: el poll se consume entero, y ése es el
//   punto — le da al hipotético beacon-en-el-view todas las chances de dejar su fila. Un chequeo
//   instantáneo ahí reportaría `filas_antes == filas_al_cargar` por llegar temprano, no porque el
//   producto esté bien, y el gate más caro de la slice pasaría por casualidad.
//
// El `catch` no se traga una aserción: `expect.poll` acá es **la espera**, no la afirmación. Lo
// que se afirma lo afirma el test, abajo, sobre el número REAL que esta función devuelve — que es
// el que además sale en la línea `MEDIDO`. Si el poll fuera la aserción, un fallo cortaría el test
// antes de emitir la medición y el gate no fallaría por el número: fallaría por ausencia de línea,
// que dice mucho menos.
const POLL_INTERVALS = [100, 200, 300, 500, 800, 1_000];
const PRESUPUESTO_VIEW_MS = 4_000;
const PRESUPUESTO_CLICK_MS = 12_000;

async function esperarFilas(
  contar: () => Promise<number>,
  objetivo: number,
  presupuestoMs: number,
): Promise<number> {
  let ultimo = await contar();
  if (ultimo >= objetivo) return ultimo;
  try {
    await expect
      .poll(
        async () => {
          ultimo = await contar();
          return ultimo;
        },
        { timeout: presupuestoMs, intervals: POLL_INTERVALS },
      )
      .toBeGreaterThanOrEqual(objetivo);
  } catch {
    // No llegó dentro del presupuesto. `ultimo` es el número real y lo afirma el test.
  }
  return ultimo;
}

const siNo = (valor: boolean): string => (valor ? 'si' : 'no');

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  1 · sin JS, el botón sigue abriendo WhatsApp
// ══════════════════════════════════════════════════════════════════════════════════════════════

interface AnchorWa {
  readonly href: string;
  readonly target: string | null;
  readonly rel: string | null;
}

test('con JavaScript apagado la ficha servida trae el único enlace a WhatsApp del equipo', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await context.route(AFUERA[0], (route) => route.abort());
    await context.route(AFUERA[1], (route) => route.abort());

    const url = storefrontUrl(vidrieraSlug, RUTA_FICHA);
    const response = await page.goto(url, { waitUntil: 'load' });

    // Se leen TODOS los anchors a `wa.me` del documento, no sólo el que tiene `data-wa`: si
    // mañana aparece un segundo botón sin ese atributo, la regla "UN botón" (CLAUDE.md §1) se
    // rompió igual y este conteo tiene que verlo.
    const anchors: AnchorWa[] = await page.$$eval('a[href]', (nodes) =>
      nodes
        .map((node) => ({
          href: node.getAttribute('href') ?? '',
          target: node.getAttribute('target'),
          rel: node.getAttribute('rel'),
        }))
        .filter((a) => a.href.startsWith('https://wa.me/')),
    );

    const primero = anchors[0];
    const href = primero?.href ?? '(no hay ningún anchor a wa.me en el DOM servido)';

    // Un `wa.me` REAL del listing: el número del tenant en el path, y en el `text=` el equipo, el
    // precio en dólares y la vidriera de donde vino. Un anchor a `wa.me` con el texto de otro
    // equipo abriría WhatsApp igual y sería la venta equivocada.
    let texto = '';
    let telefonoOk = false;
    if (primero !== undefined) {
      const parsed = new URL(primero.href);
      texto = parsed.searchParams.get('text') ?? '';
      telefonoOk = parsed.pathname === `/${WA_PHONE}`;
    }
    const abreWhatsapp =
      anchors.length === 1 &&
      telefonoOk &&
      texto.includes(TITULO) &&
      texto.includes(`USD ${String(PRECIO_USD)}`) &&
      texto.includes(`${vidrieraSlug}.maat.work`);

    process.stdout.write(
      `MEDIDO s4 sinjs · ruta=${RUTA_FICHA} · anchors=${String(anchors.length)} · ` +
        `href=${href} · abre_whatsapp=${siNo(abreWhatsapp)}\n`,
    );

    expect(
      response?.status(),
      `la ficha ${url} no se sirvió: sin HTML no hay botón que medir`,
    ).toBe(200);

    expect(
      anchors.length,
      'la regla es UN botón wa.me por ficha (CLAUDE.md §1) y con JS apagado se cuentan los que ' +
        `mandó el servidor. Se encontraron ${String(anchors.length)}: ${anchors
          .map((a) => a.href)
          .join(' | ')}`,
    ).toBe(1);

    expect(
      abreWhatsapp,
      'con JavaScript apagado el botón no abre la conversación correcta de WhatsApp. El único ' +
        'camino a la venta quedó dependiendo de que hidrate un bundle, o el texto del mensaje no ' +
        `es el de este equipo. href servido: ${href}`,
    ).toBe(true);

    expect(
      primero?.href,
      'el href de WhatsApp no coincide exactamente con el mensaje comercial: un href que sólo ' +
        'contiene algunos fragmentos puede perder el modelo, la condición, el precio o el host ' +
        'y mandar una conversación ambigua',
    ).toBe(
      `https://wa.me/${WA_PHONE}?text=${encodeURIComponent(MENSAJE_WA_EXACTO)}`,
    );

    // `target="_blank"` sin `rel="noopener"` le da a la pestaña de WhatsApp una referencia a
    // `window.opener` sobre la vidriera del reseller.
    expect(primero?.target, 'el enlace a WhatsApp dejó de abrirse en otra pestaña').toBe('_blank');
    expect(primero?.rel ?? '', 'target="_blank" sin rel="noopener"').toContain('noopener');
  } finally {
    await context.close();
  }
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  2 · el pageview no escribe; el click escribe UNA
// ══════════════════════════════════════════════════════════════════════════════════════════════

test('mirar la ficha no registra nada y recién el click en WhatsApp deja una fila del tenant y del equipo', async ({
  context,
  page,
}) => {
  const contarVidriera = (): Promise<number> => countWaClickEvents(vidrieraTenantId);
  const contarAtacante = (): Promise<number> => countWaClickEvents(atacanteTenantId);

  const idsAntes = new Set((await waClickEventRows(vidrieraTenantId)).map((fila) => fila.id));
  const atacanteAlCargar = await contarAtacante();

  // ── momento 1: antes de navegar ─────────────────────────────────────────────────────────────
  const filasAlCargar = await contarVidriera();

  // La navegación a WhatsApp se corta ACÁ, en el harness, y nunca con un `preventDefault()` en el
  // componente: el gate lo rechaza porque ataría la venta al beacon.
  await context.route(AFUERA[0], (route) => route.abort());
  await context.route(AFUERA[1], (route) => route.abort());

  const url = storefrontUrl(vidrieraSlug, RUTA_FICHA);
  await page.goto(url, { waitUntil: 'load' });
  const boton = page.locator(SELECTOR_WA);
  await expect(boton, 'la ficha no trajo el botón de WhatsApp').toBeVisible();
  await page.waitForLoadState('networkidle');

  // ── momento 2: la ficha cargó y se asentó, y nadie apretó nada ───────────────────────────────
  const filasAntes = await esperarFilas(contarVidriera, filasAlCargar + 1, PRESUPUESTO_VIEW_MS);

  // ── el click ────────────────────────────────────────────────────────────────────────────────
  const popupEsperada = context.waitForEvent('page', { timeout: 10_000 }).catch(() => null);
  await boton.click();
  const popup: Page | null = await popupEsperada;
  const abrioWhatsapp = popup !== null;
  if (popup !== null) await popup.close();

  // ── momento 3: después del click ────────────────────────────────────────────────────────────
  const filasDespues = await esperarFilas(contarVidriera, filasAntes + 1, PRESUPUESTO_CLICK_MS);

  const nuevas = (await waClickEventRows(vidrieraTenantId)).filter((fila) => !idsAntes.has(fila.id));
  const atacanteDespues = await contarAtacante();

  // `tenant_ok` mira LAS DOS vidrieras: una fila que aparece en la cuenta del vecino es tan grave
  // como una que no aparece en la propia, y contar sólo la del tenant bajo prueba no lo vería.
  const nueva = nuevas[0];
  const tenantOk =
    nuevas.length === 1 &&
    nueva !== undefined &&
    nueva.tenantId === vidrieraTenantId &&
    atacanteDespues === atacanteAlCargar;
  const listingOk = nueva !== undefined && nueva.listingId === listingId;

  process.stdout.write(
    `MEDIDO s4 click · ruta=${RUTA_FICHA} · filas_al_cargar=${String(filasAlCargar)} · ` +
      `filas_antes=${String(filasAntes)} · filas_despues=${String(filasDespues)} · ` +
      `tenant_ok=${siNo(tenantOk)} · listing_ok=${siNo(listingOk)}\n`,
  );

  // ── 1. lo que NO se puede mover: mirar no es apretar ─────────────────────────────────────────
  expect(
    filasAntes,
    `cargar la ficha escribió ${String(filasAntes - filasAlCargar)} fila(s) sin que nadie apretara ` +
      'nada: el beacon quedó atado al view. Deja de medir intención de compra (eso ya lo hace ' +
      'PostHog) y convierte el renglón fijo de WAF del presupuesto en uno proporcional al tráfico.',
  ).toBe(filasAlCargar);

  // ── 2. la venta no depende de la telemetría ─────────────────────────────────────────────────
  expect(
    abrioWhatsapp,
    'el click en el botón no abrió WhatsApp. Si el beacon se puso adelante de la navegación, la ' +
      'telemetría está rompiendo la única acción que da plata.',
  ).toBe(true);

  // ── 3. y el click deja exactamente UNA fila ─────────────────────────────────────────────────
  expect(
    filasDespues - filasAntes,
    'el click tiene que dejar exactamente una fila en wa_click_events. Cero = el beacon no llegó ' +
      'a escribir (handler ausente, GRANT ausente o policy que rechaza el insert de anon); más de ' +
      'una = se está contando dos veces la misma intención.',
  ).toBe(1);

  expect(
    tenantOk,
    `la fila no quedó en el tenant que la generó. filas nuevas en la vidriera: ${String(nuevas.length)}; ` +
      `filas nuevas en la vidriera del vecino: ${String(atacanteDespues - atacanteAlCargar)}`,
  ).toBe(true);

  expect(
    nueva?.listingId ?? '(no se creó ninguna fila)',
    'la fila no apunta al equipo que se clickeó: el reseller no puede saber qué producto le ' +
      'generó la conversación, que es todo el valor de la tabla',
  ).toBe(listingId);

  // Sin PII y con el origen declarado: la fila dice de dónde salió el click, y nada más.
  expect(
    nueva?.source ?? '(no se creó ninguna fila)',
    'el click de la ficha tiene que registrarse como `storefront_detail`',
  ).toBe('storefront_detail');
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  3 · escritura cross-tenant: cero filas, para los dos
// ══════════════════════════════════════════════════════════════════════════════════════════════

test('un POST a la vidriera de un negocio nombrando el equipo de otro no escribe ninguna fila', async ({
  request,
}) => {
  const antesVidriera = await countWaClickEvents(vidrieraTenantId);
  const antesAtacante = await countWaClickEvents(atacanteTenantId);

  const url = storefrontUrl(atacanteSlug, RUTA_TRACK);

  // Cuatro formas del MISMO ataque. El nombre exacto del campo es un detalle de una implementación
  // que todavía no existe; el invariante no puede depender de adivinarlo. La tercera —`tenantId`
  // en el body— es la que niega literalmente la regla "el tenant sale del segmento de path que
  // escribió el proxy, jamás del body". La cuarta imita a `navigator.sendBeacon`, que manda
  // `text/plain` cuando se le pasa un string.
  const ataques = [
    {
      que: 'listingId de otro tenant, en JSON',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ listingId, source: 'storefront_detail' }),
    },
    {
      que: 'listing_id de otro tenant, en snake_case',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ listing_id: listingId, source: 'storefront_detail' }),
    },
    {
      que: 'el tenant de la víctima dictado desde el body',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        listingId,
        tenantId: vidrieraTenantId,
        tenant_id: vidrieraTenantId,
        source: 'storefront_detail',
      }),
    },
    {
      que: 'como lo mandaría navigator.sendBeacon (text/plain)',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ listingId, source: 'storefront_detail' }),
    },
  ] as const;

  const respuestas: string[] = [];
  for (const ataque of ataques) {
    const res = await request.post(url, {
      headers: ataque.headers,
      data: ataque.body,
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    respuestas.push(`${ataque.que} → ${String(res.status())}`);
  }

  // Se espera un rato por si alguna escritura tardara en aparecer: el que corta la espera es el
  // hallazgo, no el reloj. Si nunca aparece nada, la espera se consume y el número sale en cero,
  // que es el resultado correcto.
  const total = async (): Promise<number> =>
    (await countWaClickEvents(vidrieraTenantId)) + (await countWaClickEvents(atacanteTenantId));
  const despuesTotal = await esperarFilas(
    total,
    antesVidriera + antesAtacante + 1,
    PRESUPUESTO_VIEW_MS,
  );
  const filasCreadas = despuesTotal - (antesVidriera + antesAtacante);

  process.stdout.write(
    `MEDIDO s4 cruce · slug_atacante=${atacanteSlug} · listing_de=${vidrieraSlug} · ` +
      `filas_creadas=${String(filasCreadas)}\n`,
  );

  expect(
    filasCreadas,
    'un POST al endpoint de una vidriera nombrando el equipo de otro negocio escribió filas: es ' +
      'escritura cross-tenant y es rechazo (CLAUDE.md §7). Respuestas del endpoint: ' +
      respuestas.join(' | '),
  ).toBe(0);

  // Y se dice por separado de qué lado no aparecieron, porque los dos fallos son distintos: una
  // fila en la víctima es que el body dictó el tenant; una fila en el atacante es que el endpoint
  // aceptó un listing que no es de su tenant y le atribuyó la conversación a quien no la generó.
  expect(
    await countWaClickEvents(vidrieraTenantId),
    'el atacante escribió en la cuenta de clicks de la víctima: el tenant salió del body',
  ).toBe(antesVidriera);

  expect(
    await countWaClickEvents(atacanteTenantId),
    'el endpoint aceptó un listing_id que no es de su tenant y se anotó la conversación de otro',
  ).toBe(antesAtacante);

  // ── control de vida: sin esto, "cero filas" pasaría por ENDPOINT AUSENTE ─────────────────────
  //
  // Es el mismo control positivo que el spec de fotos ajenas: *"sin este control positivo, 'no
  // existe para nadie' pasaría por aislamiento"*. Un `filas_creadas=0` contra una ruta que no
  // existe no prueba absolutamente nada sobre el aislamiento — prueba que no hay handler, que es
  // exactamente el estado del repo el día que este archivo se escribió. Sin esta aserción, el
  // único test del cruce cross-tenant sería un test que pasa con la implementación vacía
  // (`CLAUDE.md` §0, regla 4).
  //
  // La sonda es un **GET** al mismo endpoint, y es deliberadamente ciega a la forma del body: un
  // route handler de App Router que sólo exporta `POST` contesta **405** a un `GET`; una ruta que
  // no existe contesta **404**. O sea que distingue "está y rechazó" de "no está" sin obligar a
  // nadie a llamar `listingId` o `listing_id` a un campo que todavía no se escribió, y sin fijar
  // qué status devuelve el POST rechazado — que es una decisión de `storefront-agent` (podría ser
  // 204 indistinguible, como ADR-013, y estaría bien).
  const vida = await request.get(url, { failOnStatusCode: false, maxRedirects: 0 });
  expect(
    vida.status(),
    `${RUTA_TRACK} no existe todavía bajo ${atacanteSlug}: el \`filas_creadas=0\` de arriba es la ` +
      'ausencia del handler, no aislamiento. Cuando el endpoint exista, un GET a una ruta que sólo ' +
      'exporta POST contesta 405 y esta aserción pasa a medir lo que dice medir.',
  ).not.toBe(404);
});
