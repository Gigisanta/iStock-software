/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  S6 · el RADIO de la invalidación, medido en páginas. Owner: `qa-agent`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## El hallazgo que este archivo convierte en gate
 * `cost-auditor` midió un cold-hit rate de ~39% contra una alarma de 5%, y la causa era ésta:
 * `invalidateStorefrontUnit()` emitía `storefront:{slug}` + `tenant-config:{slug}` + `listing:{uuid}`,
 * y la ficha registraba los dos tags de tenant. **Un tag es un OR**: una reserva en un negocio de
 * 60 equipos tiraba abajo 61 páginas, 59 de las cuales no habían cambiado en nada.
 *
 * Lo que faltaba no era el diagnóstico, era el **instrumento**: los tests de tags afirman qué
 * strings se emiten y qué strings se registran, y las dos mitades pueden estar verdes con el
 * catálogo purgándose igual, porque lo que decide qué muere es la **intersección** de las dos
 * listas — y la intersección no vive en ningún archivo, vive en el cache. Peor: hay entradas en dos
 * niveles (la ruta y cada `'use cache'` de adentro), así que una página puede sobrevivir adentro y
 * morir afuera. Eso es una función invocada y un HTML re-renderizado —o sea el costo— **con cero
 * queries**, invisible para cualquier contador de Postgres.
 *
 * Por eso acá la afirmación es sobre **páginas**, no sobre tags.
 *
 * ## Cómo se detecta un re-render, que es la decisión delicada de todo esto
 * Después de reservar se pide cada página **una sola vez** y se mira `x-nextjs-cache`:
 *
 * - `HIT` → la entrada de ruta sobrevivió. Nadie invocó la función. La página no se re-renderizó.
 * - cualquier otra cosa (`MISS`, `STALE`, ausente) → la entrada murió y esta request la regeneró.
 *
 * **Una sola request y no más**: la segunda ya vuelve a decir `HIT` y borra la evidencia.
 *
 * El contador de sentencias del espía (`_lib/pg-spy.ts`) va al lado, no en lugar: `statements > 0`
 * prueba que además se pagó una query, y distingue "murió la ruta" de "murió también el loader".
 * Ninguna de las dos señales implica a la otra, así que cualquiera de las dos cuenta como
 * re-render (`pageWasRerendered()`).
 *
 * Lo que **no** se usa, dicho para que nadie lo intente de nuevo: comparar el HTML. Un re-render
 * produce exactamente el mismo HTML; una aserción de igualdad de body no puede fallar.
 *
 * ## Las dos mitades, porque una sola aprueba la regresión
 * 1. Las fichas hermanas **sobreviven**. Es el costo.
 * 2. La grilla **se purga** y su card pasa a decir "Reservado", y la ficha del equipo señado
 *    también. Sin esta mitad, el veredicto lo aprobaría un arreglo que rompió la invalidación: no
 *    purgar nada da radio 0, "mejora" el número y deja la vidriera mintiéndole al visitante.
 *
 * Y una tercera, que protege el arreglo de su atajo más tentador: **publicar un borrador tiene que
 * matar el miss cacheado de su ficha**. La ficha registra `listing:{uuid}` recién después del
 * `await` y sólo si la unidad es públicamente visible, así que en el camino de miss el único tag
 * que puede alcanzarla es el del tenant. Si alguien "arregla" el radio sacándole `storefront:{slug}`
 * a la ficha **entera**, el dueño publica, pega el link en un estado, y el link dice que el equipo
 * no está publicado hasta que venza el perfil corto. Es S1 un nivel más abajo.
 *
 * `qa-agent` **no edita el código bajo test para poner esto en verde** (`CLAUDE.md` §4). Si sale
 * rojo, el defecto es del código hasta que se demuestre lo contrario.
 *
 * ## Por qué es un spec nuevo y no una prueba más del spec de S6
 * El `beforeAll` de `s6-la-reserva-se-ve-en-la-vidriera-y-el-cron-la-libera.spec.ts` es un journey
 * de seis minutos con tres subidas de 12 MP, monta **una** unidad y no usa el espía de Postgres.
 * Esta medición necesita lo contrario: cuatro unidades publicadas, todas calentadas hasta `HIT`, y
 * el contador de sentencias en el camino. Meterlas en el mismo `beforeAll` ataría dos gates a un
 * fixture: el día que uno se caiga, el otro deja de poder medir por un motivo que no es suyo.
 */

import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';
import { expect, test } from './_lib/fixtures';
import {
  catalogModelRows,
  deleteTenantBySlug,
  deleteUserByEmail,
  listingById,
  seedDraftUnit,
  seedFxSettings,
  seedListingPhoto,
  seedLocation,
  seedPublicUnit,
  tenantIdBySlug,
} from './_lib/db';
import { APEX_URL, storefrontUrl, uniqueEmail, uniqueSlug } from './_lib/env';
import { domHtml, firstH1 } from './_lib/html';
import { fetchUntilCached, getRaw } from './_lib/http';
import { isListingMiss, isMiss } from './_lib/miss';
import { createBusiness, signIn, STOCK_PATH } from './_lib/panel';
import { pgSpyStats, resetPgSpy } from './_lib/pg-spy';
import {
  BADGE_DISPONIBLE,
  BADGE_RESERVADO,
  draftPublishMedidoLine,
  draftPublishProblems,
  invalidationRadius,
  invalidationRadiusMedidoLine,
  invalidationRadiusProblems,
  pageWasRerendered,
  rerenderSignal,
  visitsUntilPublished,
  EXPECTED_RADIUS,
  type DraftPublishMeasurement,
  type InvalidationRadiusMeasurement,
  type PageVisit,
} from './_lib/s6-measure';

test.describe.configure({ mode: 'serial' });

const slug = uniqueSlug('radio');
const email = uniqueEmail('radio');
const businessName = 'Vidriera QA Radio';

/** El que se seña. Los otros tres no se tocan y son los que tienen que sobrevivir. */
const RESERVADO = { label: 'ficha-b', slug: 'equipo-b', title: 'iPhone 13 128 Medianoche' };
const HERMANOS = [
  { label: 'ficha-a', slug: 'equipo-a', title: 'iPhone 12 64 Azul' },
  { label: 'ficha-c', slug: 'equipo-c', title: 'iPhone 14 256 Violeta' },
  { label: 'ficha-d', slug: 'equipo-d', title: 'iPhone 11 128 Blanco' },
];
/** El borrador de la tercera medición. Nace `draft`, así que su ficha responde el miss del equipo. */
const BORRADOR = { slug: 'equipo-e', title: 'iPhone SE 2022 64 Negro' };

const MINUTOS = '30';

interface Observed {
  readonly radius: InvalidationRadiusMeasurement;
  readonly publish: DraftPublishMeasurement;
  readonly statusAfterReserve: string;
}

let observed: Observed | null = null;

function seen(): Observed {
  if (observed === null) {
    throw new Error('el radio de S6 no se midió: mirá el error del beforeAll, no este mensaje');
  }
  return observed;
}

/** El badge de estado tal como lo pinta la página, leído del DOM y no del payload de Flight. */
function badgeEnHtml(html: string): string {
  const match = /<span[^>]*\bdata-status="[^"]*"[^>]*>([\s\S]*?)<\/span>/u.exec(domHtml(html));
  if (match === null) return '(sin badge)';
  return (match[1] ?? '').replace(/<[^>]+>/gu, '').trim();
}

/**
 * El badge de **una card puntual** de la grilla. Se corta el DOM a partir de la marca de esa card
 * (`data-listing="{slug}"`) y se lee el primer badge que aparece: es el de esa card, porque el
 * siguiente `data-listing` empieza la card de al lado.
 *
 * Sin este recorte, leer "el badge de la grilla" devolvería el de la primera card, y la grilla
 * podría pasar el test mostrando "Reservado" sobre el equipo equivocado.
 */
function badgeDeLaCard(html: string, listingSlug: string): string {
  const dom = domHtml(html);
  const marca = dom.indexOf(`data-listing="${listingSlug}"`);
  if (marca === -1) return '(la card no está en la grilla)';
  return badgeEnHtml(dom.slice(marca));
}

/**
 * Calienta una página hasta que la sirva el cache y devuelve lo que decía y con qué header.
 * `saidBefore` es el control de honestidad de toda la medición: una página que nunca llegó a `HIT`
 * no sobrevive a nada.
 */
async function calentar(
  request: APIRequestContext,
  url: string,
  leer: (html: string) => string,
): Promise<{ cache: string; dice: string }> {
  const response = await fetchUntilCached(request, url);
  return { cache: response.headers()['x-nextjs-cache'] ?? '(sin header)', dice: leer(await response.text()) };
}

/**
 * **La** request de la medición: una sola, con el contador en cero, justo después de la mutación.
 * Pedirla dos veces devolvería `HIT` la segunda y borraría la evidencia de la purga.
 */
async function visitarUnaVez(
  request: APIRequestContext,
  url: string,
  leer: (html: string) => string,
): Promise<{ cache: string; statements: number; dice: string }> {
  await resetPgSpy();
  const response = await getRaw(request, url);
  const html = await response.text();
  const stats = await pgSpyStats();
  return {
    cache: response.headers()['x-nextjs-cache'] ?? '(sin header)',
    statements: stats.statements,
    dice: leer(html),
  };
}

async function estadoDelListing(listingId: string): Promise<string> {
  const row = await listingById(listingId);
  if (row === null) throw new Error(`el equipo ${listingId} desapareció de la base`);
  return row.status;
}

async function reservarDesdeElPanel(owner: Page, listingId: string): Promise<void> {
  await owner.goto(`${APEX_URL}${STOCK_PATH}`, { waitUntil: 'load' });
  const fila = owner.locator(`li[data-testid="fila-unidad"][data-listing-id="${listingId}"]`);
  const detalle = fila.getByTestId('reservar-detalle');
  await expect(
    detalle,
    'la fila de un equipo publicado no ofrece reservar: sin reserva no hay invalidación por unidad ' +
      'que medir',
  ).toBeVisible({ timeout: 30_000 });
  await detalle.locator('summary').click();
  await fila.getByTestId('reserva-minutos').selectOption(MINUTOS);
  await fila.getByTestId('reserva-etiqueta').fill('Juan de Cipolletti');
  await fila.getByTestId('reservar-confirmar').click();
  await expect(
    fila.getByTestId('cancelar-reserva'),
    'reservar no dejó la fila en estado reservado',
  ).toBeVisible({ timeout: 30_000 });
}

test.beforeAll(async ({ browser }) => {
  // Login + negocio + cinco unidades + cinco páginas calentadas hasta HIT + una publicación desde
  // el panel. El default de 90 s es para un test, no para esto.
  test.setTimeout(300_000);

  const panel: BrowserContext = await browser.newContext();
  const owner = await panel.newPage();
  // Contexto aparte para el visitante: sin la cookie del dueño y sin el cache del browser del panel.
  const anonimo: BrowserContext = await browser.newContext();

  let radius: InvalidationRadiusMeasurement | null = null;
  let publish: DraftPublishMeasurement | null = null;
  let statusAfterReserve = '';

  try {
    const visitante = anonimo.request;

    await signIn(owner, email);
    await createBusiness(owner, { name: businessName, slug });

    const tenantId = await tenantIdBySlug(slug);
    if (tenantId === null) throw new Error(`el tenant ${slug} no quedó en la base`);

    // Precondiciones sin pantalla hasta S5 (TC y punto de retiro): sin ellas la grilla sale vacía.
    await seedFxSettings(tenantId);
    await seedLocation(tenantId);

    const catalogo = await catalogModelRows();
    const modelo = catalogo.find((row) => row.isActive);
    if (modelo === undefined) {
      throw new Error('`catalog_models` está vacía: corré `pnpm db:seed` antes de los e2e');
    }

    // ── Cuatro unidades publicadas. Tres son las hermanas que tienen que sobrevivir ───────────
    const unidades = [
      { ...RESERVADO, role: 'ficha-reservada' as const },
      ...HERMANOS.map((hermano) => ({ ...hermano, role: 'ficha-hermana' as const })),
    ];
    const ids = new Map<string, string>();
    for (const unidad of unidades) {
      const id = await seedPublicUnit({ tenantId, slug: unidad.slug, title: unidad.title });
      await seedListingPhoto(tenantId, id, 0);
      ids.set(unidad.slug, id);
    }
    const reservadoId = ids.get(RESERVADO.slug);
    if (reservadoId === undefined) throw new Error('no se pudo sembrar el equipo a reservar');

    const grillaUrl = storefrontUrl(slug);
    const fichaUrl = (listingSlug: string): string => storefrontUrl(slug, `/p/${listingSlug}`);

    // ── Control del espía: la primerísima request, con todo frío, tiene que verse en el contador ──
    // Si acá sale 0, los ceros de después no significan "sobrevivió", significan "no vi nada".
    await resetPgSpy();
    await getRaw(visitante, grillaUrl);
    const coldStatements = (await pgSpyStats()).statements;

    // ── Todo se calienta hasta HIT ANTES de tocar nada ────────────────────────────────────────
    const grillaAntes = await calentar(visitante, grillaUrl, (html) =>
      badgeDeLaCard(html, RESERVADO.slug),
    );
    const fichasAntes = new Map<string, { cache: string; dice: string }>();
    for (const unidad of unidades) {
      fichasAntes.set(unidad.slug, await calentar(visitante, fichaUrl(unidad.slug), badgeEnHtml));
    }

    // ── El dueño seña UN equipo ───────────────────────────────────────────────────────────────
    await reservarDesdeElPanel(owner, reservadoId);
    statusAfterReserve = await estadoDelListing(reservadoId);

    // El panel se apaga antes de medir: una pestaña abierta que revalida de fondo le sumaría
    // sentencias a la primera página que se mida y la reportaría como re-renderizada.
    await owner.goto('about:blank', { waitUntil: 'load' });

    // ── Una request por página, la grilla primero ─────────────────────────────────────────────
    const visits: PageVisit[] = [];

    const grillaDespues = await visitarUnaVez(visitante, grillaUrl, (html) =>
      badgeDeLaCard(html, RESERVADO.slug),
    );
    visits.push({
      label: 'grilla',
      role: 'grilla',
      url: grillaUrl,
      cacheBefore: grillaAntes.cache,
      cacheAfter: grillaDespues.cache,
      statementsAfter: grillaDespues.statements,
      saidBefore: grillaAntes.dice,
      saysAfter: grillaDespues.dice,
    });

    for (const unidad of unidades) {
      const antes = fichasAntes.get(unidad.slug);
      if (antes === undefined) throw new Error(`la ficha de ${unidad.slug} no se calentó`);
      const despues = await visitarUnaVez(visitante, fichaUrl(unidad.slug), badgeEnHtml);
      visits.push({
        label: unidad.label,
        role: unidad.role,
        url: fichaUrl(unidad.slug),
        cacheBefore: antes.cache,
        cacheAfter: despues.cache,
        statementsAfter: despues.statements,
        saidBefore: antes.dice,
        saysAfter: despues.dice,
      });
    }

    radius = {
      reservedListingId: reservadoId,
      publishedUnits: unidades.length,
      coldStatements,
      visits,
    };

    // ── Tercera medición: publicar un borrador tiene que matar el miss cacheado de su ficha ────
    const borradorId = await seedDraftUnit({
      tenantId,
      slug: BORRADOR.slug,
      title: BORRADOR.title,
      catalogModelId: modelo.id,
    });
    // Tres fotos: es el mínimo publicable del dominio (`MIN_PHOTOS_TO_PUBLISH`) y sin él el panel
    // no dibuja el botón que esta medición necesita apretar.
    for (const orden of [0, 1, 2]) {
      await seedListingPhoto(tenantId, borradorId, orden);
    }

    const borradorUrl = fichaUrl(BORRADOR.slug);
    const missCalentado = await fetchUntilCached(visitante, borradorUrl);
    const missHtml = await missCalentado.text();
    const cacheBefore = missCalentado.headers()['x-nextjs-cache'] ?? '(sin header)';
    const missWasCached = isListingMiss(missHtml);

    await owner.goto(`${APEX_URL}${STOCK_PATH}`, { waitUntil: 'load' });
    const filaBorrador = owner.locator(
      `li[data-testid="fila-unidad"][data-listing-id="${borradorId}"]`,
    );
    const botonPublicar = filaBorrador.getByRole('button', { name: 'Publicar', exact: true });
    await expect(
      botonPublicar,
      'el panel no ofrece "Publicar" sobre un borrador con modelo de catálogo, precio, condición y ' +
        'tres fotos: el escenario de la tercera medición no se puede montar',
    ).toBeVisible({ timeout: 30_000 });
    await botonPublicar.click();
    await expect(
      filaBorrador.getByRole('button', { name: 'Sacar de la vidriera', exact: true }),
      'apretar "Publicar" no dejó el equipo en la vidriera',
    ).toBeVisible({ timeout: 30_000 });

    const statusAfterPublish = await estadoDelListing(borradorId);
    await owner.goto('about:blank', { waitUntil: 'load' });

    const etiqueta = (html: string): string => {
      if (isListingMiss(html)) return 'miss';
      if (isMiss(html)) return 'sin-vidriera';
      if (firstH1(html) === BORRADOR.title) return 'ficha';
      return `otro(${firstH1(html) ?? 'sin h1'})`;
    };

    const sequence: string[] = [];
    for (let intento = 0; intento < 4 && sequence[sequence.length - 1] !== 'ficha'; intento += 1) {
      sequence.push(etiqueta(await (await getRaw(visitante, borradorUrl)).text()));
    }

    publish = {
      listingId: borradorId,
      cacheBefore,
      missWasCached,
      statusAfterPublish,
      sequence,
    };
  } finally {
    await panel.close();
    await anonimo.close();
  }

  if (radius === null || publish === null) {
    throw new Error('el radio de S6 quedó a medio medir: no hay línea `MEDIDO` que emitir');
  }

  // Las líneas salen ANTES de cualquier aserción: si algo está rojo, el número ya se puede leer.
  process.stdout.write(`\n${invalidationRadiusMedidoLine(radius)}\n`);
  process.stdout.write(`${draftPublishMedidoLine(publish)}\n\n`);

  observed = { radius, publish, statusAfterReserve };
});

test.afterAll(async () => {
  await deleteTenantBySlug(slug);
  await deleteUserByEmail(email);
});

test('la vidriera entera se estaba sirviendo desde el cache antes de que alguien señara un equipo', () => {
  const { radius, statusAfterReserve } = seen();

  // Es el control de honestidad de todo el archivo, y por eso es un test propio: si esto falla,
  // "sobrevivió" y "nunca estuvo cacheada" se confunden, y hay que saberlo separado.
  expect(
    radius.coldStatements,
    'el espía de Postgres no vio ni una sentencia en la request fría: el contador no está en el ' +
      'camino y los ceros de las otras mediciones no prueban nada',
  ).toBeGreaterThan(0);

  const frias = radius.visits.filter((visit) => visit.cacheBefore !== 'HIT');
  expect(
    frias.map((visit) => `${visit.label}=${visit.cacheBefore}`),
    'estas páginas nunca llegaron a servirse desde el cache: una página fría no sobrevive a una ' +
      'purga, aparece, y medirla no dice nada del radio',
  ).toEqual([]);

  expect(statusAfterReserve, 'el equipo no quedó reservado en Postgres').toBe('reserved');
});

test('señar un equipo no le tira abajo la ficha cacheada a los equipos hermanos del mismo negocio', () => {
  const { radius } = seen();

  const hermanas = radius.visits.filter((visit) => visit.role === 'ficha-hermana');
  expect(
    hermanas.length,
    'con menos de dos fichas hermanas, "el radio no crece con el stock" es una frase sobre un solo dato',
  ).toBeGreaterThanOrEqual(2);

  const purgadas = hermanas.filter(pageWasRerendered).map((visit) => `${visit.label} (${rerenderSignal(visit)})`);
  expect(
    purgadas,
    `señar un equipo re-renderizó la ficha de equipos que no cambiaron. En un negocio de 60 ` +
      'publicados esto es el catálogo entero regenerándose por cada reserva del día — el cold-hit ' +
      'de ~39% que midió `cost-auditor`. El tag que las alcanza sobra en la intersección: mirá qué ' +
      'registra la RUTA de la ficha, no sólo qué registra el loader',
  ).toEqual([]);

  const contaminadas = hermanas.filter((visit) => visit.saysAfter !== visit.saidBefore);
  expect(
    contaminadas.map((visit) => `${visit.label}: ${visit.saidBefore} → ${visit.saysAfter}`),
    'reservar un equipo le cambió lo que dice la ficha de otro',
  ).toEqual([]);
});

test('señar un equipo sí actualiza la grilla, que pasa a mostrar esa card como Reservado', () => {
  const { radius } = seen();

  const grilla = radius.visits.find((visit) => visit.role === 'grilla');
  expect(grilla, 'no se midió la grilla').toBeDefined();
  if (grilla === undefined) return;

  // La otra mitad del veredicto. Sin ésta, un arreglo que rompió la invalidación bajaría el radio
  // a 0 y "mejoraría" el número con la vidriera mintiéndole al visitante.
  expect(
    pageWasRerendered(grilla),
    'la grilla sobrevivió a la reserva: la card sigue saliendo del cache como estaba',
  ).toBe(true);

  expect(
    grilla.saidBefore,
    'la grilla cacheada no mostraba el equipo como disponible antes de la reserva',
  ).toBe(BADGE_DISPONIBLE);

  expect(
    grilla.saysAfter,
    'la card del equipo señado sigue diciendo lo de antes en la grilla: dos personas viajan al ' +
      'local por el mismo teléfono',
  ).toBe(BADGE_RESERVADO);
});

test('la ficha del equipo señado deja de decir Disponible en la primera visita de un desconocido', () => {
  const { radius } = seen();

  const ficha = radius.visits.find((visit) => visit.role === 'ficha-reservada');
  expect(ficha, 'no se midió la ficha del equipo reservado').toBeDefined();
  if (ficha === undefined) return;

  expect(
    pageWasRerendered(ficha),
    'la ficha del equipo señado sobrevivió a la reserva: el link que circula por WhatsApp la sigue ' +
      'mostrando como estaba',
  ).toBe(true);

  expect(
    ficha.statementsAfter,
    'la ficha se re-renderizó sin consultar la base: sirvió datos viejos desde el cache de adentro',
  ).toBeGreaterThan(0);

  expect(ficha.saysAfter, 'la ficha de un equipo señado no dice "Reservado"').toBe(BADGE_RESERVADO);
});

test('el radio de la purga por unidad no crece con la cantidad de equipos publicados del negocio', () => {
  const { radius } = seen();

  expect(
    invalidationRadius(radius),
    `una reserva re-renderizó ${String(invalidationRadius(radius))} de las ${String(
      radius.visits.length,
    )} páginas medidas. Tienen que ser ${String(EXPECTED_RADIUS)}: la grilla (aparece el badge) y ` +
      'la ficha de ese equipo. Lo demás no cambió, así que no puede morir',
  ).toBe(EXPECTED_RADIUS);

  expect(
    invalidationRadiusProblems(radius),
    'el radio de la invalidación por unidad tiene problemas abiertos',
  ).toEqual([]);
});

test('publicar un borrador reemplaza la ficha cacheada que decía que el equipo no está publicado', () => {
  const { publish } = seen();

  expect(
    publish.missWasCached,
    'la ficha del borrador no se estaba sirviendo como "este equipo ya no está publicado": sin esa ' +
      'entrada cacheada, verla publicada después no prueba que publicar la haya invalidado',
  ).toBe(true);

  expect(publish.cacheBefore, 'el miss del equipo nunca se sirvió desde el cache').toBe('HIT');
  expect(publish.statusAfterPublish, 'el equipo no quedó publicado').toBe('available');

  expect(
    visitsUntilPublished(publish),
    `secuencia de visitas: [${publish.sequence.join(', ')}]. Publicar tiene que tirar abajo el miss ` +
      'cacheado de la ficha en la primera visita: el dueño publica, pega el link en un estado, y el ' +
      'link no puede decir que el equipo no está. La ficha registra `listing:{uuid}` recién después ' +
      'del await y sólo si la unidad es visible, así que en el camino de miss el único tag que la ' +
      'alcanza es el del tenant',
  ).toBe(1);

  expect(draftPublishProblems(publish), 'el alta de una unidad tiene problemas abiertos').toEqual([]);
});
