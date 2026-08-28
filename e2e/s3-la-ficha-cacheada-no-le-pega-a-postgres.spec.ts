/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  S3 · M5 del gate: cuántas sentencias le manda la vidriera a Postgres. Owner: `qa-agent`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `CLAUDE.md` §3 pone un número: **el 95% de los hits no toca Postgres.** Es la línea que separa
 * ~USD 0,012 de ~USD 2,59 por tenant por mes, y es la razón de todo el diseño de la vidriera
 * (`'use cache'` + `cacheLife('max')` + invalidación por evento, en vez de `revalidate: 60`).
 * Hasta hoy nadie lo medía: el gate lo pedía y no había quién emitiera la línea.
 *
 * ## Se cuentan sentencias REALES, no tiempos
 * Instrucción explícita del LEAD, y tiene fondo: un spec que infiere "no pegó a la base" de que la
 * respuesta salió en 8 ms mide la velocidad de la base, no el cache. Con Postgres local y tablas
 * de tres filas, seis queries también salen en 8 ms — el spec quedaría verde con el cache apagado.
 *
 * El contador está a **nivel de transporte**: `_lib/pg-spy.ts` levanta un proxy TCP y el
 * `webServer` de Playwright arranca con `DATABASE_URL` apuntándole. Cuenta mensajes `'Q'` (Query
 * simple) y `'P'` (Parse) del protocolo de Postgres, o sea sentencias que **de verdad viajaron por
 * el socket**, sin importar qué driver, qué pool ni qué capa de Drizzle haya en el medio.
 *
 * Se eligió esto y no `pg_stat_statements` ni un contador dentro de `_lib/storefront-db.ts` por un
 * motivo de columna, no de gusto: `apps/web/**` es de `storefront-agent`, y `qa-agent` no edita el
 * código bajo test para poder medirlo. El espía vive entero en `e2e/**`.
 *
 * **El proceso del test conserva el `DATABASE_URL` real**, así que el SQL de fixtures de este
 * mismo archivo NO pasa por el espía y no infla la cuenta. Lo único contado es lo que hace el
 * server al atender el pedido.
 *
 * ## Las dos columnas, y por qué `primera` tiene que ser distinta de cero
 * `primera` = cache frío. Tiene que pegarle a Postgres: resolver tenant, TC, punto de retiro,
 * equipo, fotos y modelo son seis queries, y si diera 0 lo que está roto es el contador, no la
 * vidriera. El gate dice lo mismo con otras palabras (*"el contador de queries no esta contando
 * nada, la medicion es vacua"*), y esta suite lo afirma también, adentro, para que el rojo
 * aparezca donde se puede depurar.
 *
 * `cacheada` = el hit del 95%. Tiene que ser **0**.
 *
 * ## Tenant nuevo por corrida, no `demo`
 * Con el tenant del seed, cualquier spec anterior (o una corrida anterior con `reuseExistingServer`)
 * ya habría calentado el cache: `primera` daría 0, la medición sería vacua y el gate fallaría por
 * un motivo que no tiene nada que ver con lo que se afirma. Un slug único jamás pedido garantiza
 * que la primera visita sea, de verdad, la primera.
 *
 * ## Por qué la fixture se siembra por SQL acá y por el panel en el spec de bytes
 * Lo que se audita es el `'use cache'`, y la cuenta de sentencias no cambia ni un dígito según
 * cómo nació la fila. La foto se siembra sin bytes detrás **a propósito**: este spec pide la ficha
 * con `request.get()`, sin browser, así que no baja un solo subrecurso. Ver `seedPublicUnit` /
 * `seedListingPhoto` en `_lib/db.ts`.
 *
 * `qa-agent` no arregla el código bajo test. Si esto se pone rojo, el defecto es de la impl.
 */

import { expect, test } from './_lib/fixtures';
import {
  deleteTenantBySlug,
  seedFxSettings,
  seedListingPhoto,
  seedLocation,
  seedPublicUnit,
  seedTenant,
  tenantIdBySlug,
} from './_lib/db';
import { storefrontUrl, uniqueSlug } from './_lib/env';
import { fetchUntilCached, getRaw } from './_lib/http';
import { assertSpyWasInThePath, pgSpyStats, resetPgSpy, type PgSpyStats } from './_lib/pg-spy';
import { dbHitsMedidoLine, dbHitsProblems, type DbHitsMeasurement } from './_lib/s3-measure';

test.describe.configure({ mode: 'serial' });

const tenantSlug = uniqueSlug('dbhits');
const listingSlug = uniqueSlug('iphone-14-pro-256-grafito');
const title = 'iPhone 14 Pro 256 Grafito';

interface Observed {
  readonly url: string;
  readonly route: string;
  readonly measurement: DbHitsMeasurement;
  readonly coldStats: PgSpyStats;
  readonly warmStats: PgSpyStats;
  /** Status y cache-header de la respuesta **fría**: la que se contó como `primera`. */
  readonly coldStatus: number;
  readonly coldCacheHeader: string;
  readonly coldHasTitle: boolean;
  /** Ídem para la respuesta **cacheada**, la que se contó como `cacheada`. */
  readonly warmStatus: number;
  readonly warmCacheHeader: string;
  readonly warmHasTitle: boolean;
  /** Cuántos pedidos hicieron falta hasta ver `x-nextjs-cache: HIT`. Diagnóstico, no aserción. */
  readonly warmupCacheHeader: string;
}

let observed: Observed | null = null;

function seen(): Observed {
  if (observed === null) {
    throw new Error('la ficha del fixture no llegó a medirse: no hay nada que afirmar');
  }
  return observed;
}

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(120_000);

  await seedTenant({ slug: tenantSlug, name: 'Vidriera QA db-hits' });
  const tenantId = await tenantIdBySlug(tenantSlug);
  if (tenantId === null) throw new Error(`el tenant ${tenantSlug} no quedó en la base`);

  // Decorado sin pantalla hasta S5: sin TC la ficha ni siquiera renderiza (ver `_lib/db.ts`).
  await seedFxSettings(tenantId);
  await seedLocation(tenantId);
  const listingId = await seedPublicUnit({
    tenantId,
    slug: listingSlug,
    title,
    imei: '351234567890123',
    costUsd: 500,
  });
  await seedListingPhoto(tenantId, listingId, 0);

  const route = `/p/${listingSlug}`;
  const url = storefrontUrl(tenantSlug, route);

  // Cliente HTTP sin browser: no tiene cache propio, así que ninguna de las tres visitas puede
  // salir de un cache del lado del cliente y hacerle decir 0 al contador por el motivo equivocado.
  const request = await playwright.request.newContext({ ignoreHTTPSErrors: false });

  try {
    // ── 1 · cache frío ────────────────────────────────────────────────────────────────────────
    await resetPgSpy();
    const cold = await getRaw(request, url);
    const coldBody = await cold.text();
    const coldStats = await pgSpyStats();

    // Antes de creerle a los números: si el espía no está en el camino (típicamente un
    // `next start` viejo reusado que se conectó directo a Postgres), esto tira con el diagnóstico
    // en vez de dejar que la suite publique un 0 que se lee como éxito.
    assertSpyWasInThePath(coldStats, 'la primera visita a la ficha (cache frío)');

    // ── 2 · calentar hasta que el cache de la ruta la sirva ────────────────────────────────────
    // Un `APIResponse` de Playwright llega con el cuerpo **completo**: cuando esto resuelve, el
    // render del calentamiento ya terminó. Eso es lo que permite resetear el contador justo
    // después sin arrastrar una query tardía del pedido anterior a la columna `cacheada`.
    const warmup = await fetchUntilCached(request, url);

    // ── 3 · el hit del 95% ────────────────────────────────────────────────────────────────────
    await resetPgSpy();
    const warm = await getRaw(request, url);
    const warmBody = await warm.text();
    const warmStats = await pgSpyStats();

    const measurement: DbHitsMeasurement = {
      route,
      first: coldStats.statements,
      cached: warmStats.statements,
    };

    observed = {
      url,
      route,
      measurement,
      coldStats,
      warmStats,
      coldStatus: cold.status(),
      coldCacheHeader: cold.headers()['x-nextjs-cache'] ?? '',
      coldHasTitle: coldBody.includes(title),
      warmStatus: warm.status(),
      warmCacheHeader: warm.headers()['x-nextjs-cache'] ?? '',
      warmHasTitle: warmBody.includes(title),
      warmupCacheHeader: warmup.headers()['x-nextjs-cache'] ?? '',
    };

    // ── La línea que lee M5 de `scripts/accept-s3.sh` ─────────────────────────────────────────
    // Se emite aunque los números estén mal (un `cacheada=6` es una medición **válida** de algo
    // roto, y el gate tiene que verla y fallar). Lo único que no se emite es una medición que no
    // ocurrió: ese caso ya tiró arriba, en `assertSpyWasInThePath`, y el gate falla por ausencia.
    process.stdout.write(`${dbHitsMedidoLine(measurement)}\n`);
  } finally {
    await request.dispose();
  }
});

test.afterAll(async () => {
  await deleteTenantBySlug(tenantSlug);
});

test('la ficha servida desde el cache no le manda ni una sentencia a Postgres', () => {
  const it = seen();

  expect(
    dbHitsProblems(it.measurement),
    `ruta=${it.route} · primera=${String(it.measurement.first)} · ` +
      `cacheada=${String(it.measurement.cached)} · lo que se consultó de más en la visita ` +
      `cacheada: ${it.warmStats.samples.join(' | ')}`,
  ).toEqual([]);

  // Dicho otra vez como número, porque es EL número del producto: cero queries por pageview.
  expect(
    it.measurement.cached,
    'cada visita a la ficha le pega a Postgres. Con 10.000 pageviews/mes eso son 10.000 conexiones ' +
      'contra el proyecto compartido de todos los tenants.',
  ).toBe(0);
});

test('la primera visita si consulta la base, o el contador no esta contando nada', () => {
  const it = seen();

  // Sin esto, la aserción de arriba pasa con el espía desconectado, con la ruta caída, o con un
  // 404 servido rapidísimo. Un contador roto da 0 en las dos columnas y "cumple" el objetivo de
  // costo del §3 sin servir una sola ficha.
  expect(
    it.measurement.first,
    'la visita con cache frío no generó ni una sentencia: la ficha no está leyendo nada de la ' +
      'base, o el espía no está en el camino del server.',
  ).toBeGreaterThan(0);

  // La ficha necesita, como mínimo, resolver el tenant y el equipo. Un `1` sería sospechoso de
  // estar contando sólo el handshake de la conexión y no el render.
  expect(
    it.measurement.first - it.coldStats.sessionControl,
    `de las ${String(it.measurement.first)} sentencias de la visita fría, ` +
      `${String(it.coldStats.sessionControl)} son control de sesión (begin/commit/set): la ficha ` +
      'no consultó datos',
  ).toBeGreaterThan(0);
});

test('lo que se midio es la ficha de verdad y no un 404 servido rapido', () => {
  const it = seen();

  // Toda la medición vale sólo si las dos respuestas contadas son la misma ficha publicada. Un 404
  // (o un redirect a marketing) también da `cacheada=0`, y sería el peor verde posible.
  expect(it.coldStatus, `la visita fría a ${it.url} respondió ${String(it.coldStatus)}`).toBe(200);
  expect(it.warmStatus, `la visita cacheada respondió ${String(it.warmStatus)}`).toBe(200);

  expect(
    it.coldHasTitle,
    `la respuesta fría de ${it.url} no contiene "${title}": se midió otra página`,
  ).toBe(true);
  expect(
    it.warmHasTitle,
    `la respuesta cacheada no contiene "${title}": el cache está sirviendo otra cosa`,
  ).toBe(true);

  // Que la segunda medición sea de verdad "la servida desde el cache" y no otra visita fría que
  // dio 0 por casualidad. Si nunca llega a `HIT`, `cacheada=0` no significa "hay cache".
  expect(
    it.warmCacheHeader,
    `la visita que se contó como cacheada trae x-nextjs-cache: "${it.warmCacheHeader}" ` +
      `(el calentamiento había quedado en "${it.warmupCacheHeader}"). Sin HIT, un cero de queries ` +
      'no prueba que exista el cache.',
  ).toBe('HIT');

  // La conexión sin TLS es condición para que el espía pueda leer el protocolo. Si alguien apunta
  // los e2e a una base remota, el contador se vuelve ciego y esto lo dice.
  expect(
    it.coldStats.encrypted || it.warmStats.encrypted,
    'la conexión a Postgres va por TLS: el espía no puede leer las sentencias y los dos números de ' +
      'la línea MEDIDO son basura',
  ).toBe(false);
});
