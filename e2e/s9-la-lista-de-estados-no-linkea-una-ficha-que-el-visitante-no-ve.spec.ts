/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  S9 · Q4 · NINGÚN LINK DE LA LISTA PARA ESTADOS PUEDE MORIR EN LA CARA DEL COMPRADOR.
 *  Owner: `qa-agent`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## La regla de negocio, dicha sin nombres de función
 * El dueño abre `/app/lista`, copia un bloque y lo pega en un estado de Instagram. Cada renglón
 * lleva un link a la ficha. **Un link que el visitante no puede abrir es un 404 que el reseller le
 * sirvió a sus propios clientes, con su nombre arriba** — y el dueño no se entera nunca, porque el
 * que ve el error es el comprador y lo único que pasa es que no escribe.
 *
 * Entonces lo que se afirma acá no es "la query filtra": es que **el conjunto de links del texto
 * es un subconjunto de lo que el visitante anónimo puede abrir**, medido pidiendo cada URL sin
 * sesión, contra el server real.
 *
 * ## Por qué las dos mitades y no sólo la de arriba
 * 1. Los links que salen **abren** (200 con la ficha de verdad).
 * 2. Los equipos que quedaron afuera —el borrador, el bajado de vidriera, y el `available` sin
 *    `published_at`— **no abren**: su URL contesta "este equipo ya no está publicado".
 *
 * Sin la mitad 2, "no linkea fichas muertas" también sería cierto con una lista vacía, o con una
 * lista que recorta de más. La mitad 2 es la que prueba que la exclusión era necesaria: si esos
 * equipos hubieran salido en el texto, el estado de Instagram habría llevado tres links rotos.
 *
 * ## La unidad `available` SIN `published_at`, y por qué se planta con los triggers apagados
 * El trigger `listings_stamp_published_at` (migración 0002) sella toda fila que entre o pase a un
 * estado público, así que **por el camino normal el caso no se puede producir** y un test que sólo
 * use el panel deja verde a una query a la que le sacaron el `isNotNull(publishedAt)`. Se planta
 * con `set local session_replication_role = replica` (ver `seedUnitInState` en `_lib/db.ts`), que
 * es el mismo control negativo con el que `tests/rls-cross-tenant.test.ts` planta sus ataques.
 * Es también la fila que demuestra que **mirar el estado no alcanza**: dice `available` y la
 * vidriera no la muestra.
 *
 * ## `https://` → `http://` para pedir la URL, declarado
 * `storefrontUrlForSlug()` decide el esquema con `rootDomain().startsWith('localhost')`, y el
 * arnés corre sobre `127.0.0.1.nip.io:3100`, que no empieza con `localhost`: la lista emite
 * `https://` contra un server que sólo habla HTTP en claro. En producción el esquema es correcto;
 * acá es un artefacto del host del arnés. El test **no** lo tapa: afirma que el link es absoluto y
 * que apunta al host de la vidriera del tenant, y para pedirlo baja el esquema a `http` en una sola
 * función (`enElArnes`), que es donde está escrito el motivo. Lo que está bajo prueba es **qué
 * unidad linkea cada renglón**, no el esquema.
 *
 * `qa-agent` no edita el código bajo test para poner esto en verde (`CLAUDE.md` §4). Si sale rojo,
 * el defecto es del código hasta que se demuestre lo contrario.
 */

import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from './_lib/fixtures';
import {
  deleteTenantBySlug,
  deleteUserByEmail,
  listingStampRow,
  seedUnitInState,
  tenantIdBySlug,
  type UnitStamp,
} from './_lib/db';
import { APEX_URL, storefrontUrl, uniqueEmail, uniqueSlug } from './_lib/env';
import { firstH1 } from './_lib/html';
import { getRaw } from './_lib/http';
import { isListingMiss, isMiss } from './_lib/miss';
import { createBusiness, signIn } from './_lib/panel';

test.describe.configure({ mode: 'serial' });

/** La pantalla bajo prueba. */
const LISTA_PATH = '/app/lista';

const slug = uniqueSlug('lista');
const email = uniqueEmail('lista');
const businessName = 'Vidriera QA Lista';

interface Unidad {
  readonly slug: string;
  readonly title: string;
  readonly status: string;
  /** Qué pasa con `published_at`. Ver `seedUnitInState` en `_lib/db.ts`. */
  readonly stamp: UnitStamp;
  /** Lo que este archivo afirma. */
  readonly enElTexto: boolean;
  /** Para qué está en el fixture. Sale en el mensaje de fallo. */
  readonly porque: string;
}

const UNIDADES: readonly Unidad[] = [
  {
    slug: 'qa-disponible',
    title: 'iPhone 14 Pro 256 Grafito',
    status: 'available',
    stamp: 'trigger',
    enElTexto: true,
    porque: 'publicado y comprable hoy: es el renglón que factura',
  },
  {
    slug: 'qa-reservado',
    title: 'iPhone 13 128 Medianoche',
    status: 'reserved',
    stamp: 'trigger',
    enElTexto: true,
    porque: 'reservado es público: la vidriera lo muestra y la lista lo marca RESERVADO',
  },
  {
    slug: 'qa-vendido',
    title: 'iPhone 12 64 Azul',
    status: 'sold',
    stamp: 'trigger',
    enElTexto: true,
    porque: 'vendido es prueba social y la vidriera lo sirve: el que decide no pegarlo es el dueño',
  },
  {
    slug: 'qa-borrador',
    title: 'iPhone 11 128 Blanco',
    status: 'draft',
    stamp: 'trigger',
    enElTexto: false,
    porque: 'es un borrador que nunca se publicó: no tiene estado público ni sello',
  },
  {
    slug: 'qa-fuera-de-vidriera',
    title: 'iPhone SE 2022 64 Negro',
    status: 'unavailable',
    stamp: 'kept',
    enElTexto: false,
    porque:
      'lo publicó y después lo bajó de la vidriera, así que conserva published_at: lo ÚNICO que ' +
      'lo mantiene fuera de la lista es el filtro por estado',
  },
  {
    slug: 'qa-en-servicio',
    title: 'iPhone XR 64 Coral',
    status: 'in_service',
    stamp: 'kept',
    enElTexto: false,
    porque:
      'estaba publicado y se fue al taller: mismo caso que el bajado de vidriera, con un lateral ' +
      'distinto, y el visitante no lo puede abrir',
  },
  {
    slug: 'qa-sin-sello',
    title: 'iPhone 15 256 Titanio',
    status: 'available',
    stamp: 'none',
    enElTexto: false,
    porque:
      'dice available pero no tiene published_at, así que la policy de anon no lo muestra: lo ' +
      'ÚNICO que lo mantiene fuera de la lista es el isNotNull(publishedAt)',
  },
];

/** Ver el docblock: el arnés no habla TLS y el esquema no es lo que está bajo prueba. */
function enElArnes(url: string): string {
  return url.replace(/^https:/u, 'http:');
}

/**
 * La URL de la ficha de una unidad, en el host de vidriera del arnés.
 *
 * Va en `http` porque es la que se pide de verdad; la que emite la pantalla llega en `https` por el
 * artefacto declarado arriba y se compara después de pasar por `enElArnes`. Host y path —que es lo
 * que decide **a qué equipo** lleva el renglón— se comparan tal cual.
 */
function urlDeLaFicha(unitSlug: string): string {
  return storefrontUrl(slug, `/p/${unitSlug}`);
}

interface Medicion {
  /** Los links, tal cual salen del texto que el dueño copia. */
  readonly urls: readonly string[];
  /** El texto completo de la pantalla, para las aserciones de ausencia. */
  readonly texto: string;
}

let medido: Medicion | null = null;
/** slug de la unidad → id en la base, para poder probar el fixture antes de creerle. */
const ids = new Map<string, string>();

function visto(): Medicion {
  if (medido === null) {
    throw new Error('la lista no se llegó a leer: mirá el error del beforeAll, no este mensaje');
  }
  return medido;
}

/**
 * Lo que el dueño copia. Se lee de los `<pre>` y no del payload de Flight: el `<pre>` es lo que la
 * persona ve y lo que el botón de copiar pone en el portapapeles (y el único camino que le queda
 * cuando el portapapeles no está disponible, que es el caso de este arnés — `127.0.0.1.nip.io` no
 * es un origen seguro y `navigator.clipboard` no existe ahí).
 */
async function leerLaLista(page: Page): Promise<Medicion> {
  await page.goto(`${APEX_URL}${LISTA_PATH}`, { waitUntil: 'load' });

  const bloques = page.locator('pre');
  await expect(
    bloques.first(),
    `${LISTA_PATH} no mostró ningún bloque de texto para copiar. Sin bloques no hay links que ` +
      'medir y este spec no puede afirmar nada.',
  ).toBeVisible({ timeout: 20_000 });

  const textos = await bloques.allInnerTexts();
  const urls = textos.flatMap((bloque) => bloque.match(/https?:\/\/\S+/gu) ?? []);
  const texto = await page.locator('main').innerText();

  return { urls, texto };
}

test.beforeAll(async ({ browser }) => {
  await deleteTenantBySlug(slug);
  await deleteUserByEmail(email);

  const context = await browser.newContext();
  const owner = await context.newPage();

  await signIn(owner, email);
  await createBusiness(owner, { name: businessName, slug });

  const tenantId = await tenantIdBySlug(slug);
  if (tenantId === null) throw new Error(`el alta no dejó tenant para ${slug}`);

  for (const u of UNIDADES) {
    const id = await seedUnitInState({
      tenantId,
      slug: u.slug,
      title: u.title,
      status: u.status,
      stamp: u.stamp,
    });
    ids.set(u.slug, id);
  }

  medido = await leerLaLista(owner);

  await context.close();
});

test.afterAll(async () => {
  await deleteTenantBySlug(slug);
  await deleteUserByEmail(email);
});

test('el fixture monta las dos mitades del filtro, cada una con su propia unidad', async () => {
  /**
   * Control del fixture, y es el test que este archivo no tenía. Los dos predicados de la query
   * —estado público y `published_at` no nulo— son **redundantes sobre una siembra ingenua**: un
   * borrador recién insertado tampoco tiene sello, así que sacar cualquiera de los dos del código
   * dejaba los seis tests de abajo en verde. Lo medí con una mutación y pasó exactamente eso.
   *
   * Así que el fixture monta una unidad que sólo excluye cada mitad, y esto verifica que las dos
   * siguen siendo lo que dicen ser **en el momento de medir**, no en el momento de escribirlas.
   */
  const sinSello = await listingStampRow(ids.get('qa-sin-sello') ?? '');
  expect(sinSello, 'la unidad sin sellar no quedó en la base: el fixture no montó el caso').not.toBeNull();
  expect(
    sinSello?.status,
    'la unidad plantada dejó de estar en estado público: ya no es el caso que el estado solo no ' +
      'atrapa',
  ).toBe('available');
  expect(
    sinSello?.publishedAt,
    'el trigger listings_stamp_published_at le puso published_at igual: el fixture perdió el ' +
      '`session_replication_role = replica` y este spec ya no sostiene el filtro por published_at',
  ).toBeNull();

  for (const u of UNIDADES.filter((x) => x.stamp === 'kept')) {
    const fila = await listingStampRow(ids.get(u.slug) ?? '');
    expect(fila, `${u.slug} no quedó en la base`).not.toBeNull();
    expect(fila?.status, `${u.slug} cambió de estado en el fixture`).toBe(u.status);
    expect(
      fila?.publishedAt,
      `${u.slug} perdió su published_at. El trigger promete no borrarlo nunca (el histórico de ` +
        'publicación no se pierde porque una unidad vuelva a unavailable): si dejó de cumplirlo, ' +
        'esta unidad ya no sostiene el filtro por estado y hay que enterarse acá, no abajo.',
    ).not.toBeNull();
  }
});

test('cada link del texto que el dueño pega abre la ficha del equipo, sin sesión', async ({
  request,
}: {
  request: APIRequestContext;
}) => {
  const { urls } = visto();

  expect(
    urls.length,
    'el texto de la lista no trae un solo link: un renglón sin link corta el embudo entero ' +
      '(estado → ficha → WhatsApp) en el primer paso',
  ).toBeGreaterThan(0);

  const rotos: string[] = [];
  for (const url of urls) {
    const response = await getRaw(request, enElArnes(url));
    const html = await response.text();
    if (isMiss(html)) rotos.push(`${url} → "no hay ninguna vidriera en esta dirección"`);
    else if (isListingMiss(html)) rotos.push(`${url} → "este equipo ya no está publicado"`);
    else if (firstH1(html) === null) rotos.push(`${url} → respondió sin <h1> renderizado`);
  }

  expect(
    rotos,
    'la lista para estados linkea fichas que el visitante NO puede abrir. Cada una de estas URLs ' +
      `es un 404 que el dueño le sirve a sus propios clientes:\n  ${rotos.join('\n  ')}`,
  ).toEqual([]);
});

test('los tres estados públicos salen linkeados y nada más sale', async () => {
  const { urls } = visto();

  const esperados = UNIDADES.filter((u) => u.enElTexto)
    .map((u) => urlDeLaFicha(u.slug))
    .sort();
  const emitidos = urls.map(enElArnes).sort();

  expect(
    emitidos,
    'el conjunto de links de la lista dejó de ser exactamente el stock que el visitante puede ' +
      'abrir. De más = link muerto en un estado de Instagram; de menos = un equipo que el dueño ' +
      'cree haber publicado y nadie ve.',
  ).toEqual(esperados);
});

test('un equipo disponible sin fecha de publicación no aparece en la pantalla', async () => {
  const { texto, urls } = visto();

  for (const u of UNIDADES.filter((x) => !x.enElTexto)) {
    expect(urls.join('\n'), `${u.slug}: ${u.porque}`).not.toContain(`/p/${u.slug}`);
    expect(
      texto,
      `${u.title} aparece en la pantalla de la lista y ${u.porque}`,
    ).not.toContain(u.title);
  }
});

test('los equipos que la lista dejó afuera son, uno por uno, fichas que no abren', async ({
  request,
}: {
  request: APIRequestContext;
}) => {
  // La mitad que prueba que la exclusión era necesaria. Sin esto, recortar de más también pasaría.
  for (const u of UNIDADES.filter((x) => !x.enElTexto)) {
    const response = await getRaw(request, urlDeLaFicha(u.slug));
    const html = await response.text();

    expect(
      isListingMiss(html),
      `${u.slug}: la vidriera SÍ sirve este equipo, así que dejarlo afuera de la lista le esconde ` +
        `al dueño stock que el comprador puede ver. ${u.porque}`,
    ).toBe(true);
  }
});

test('la ficha que sí abre es la del equipo que dice el renglón, y no otra', async ({
  request,
}: {
  request: APIRequestContext;
}) => {
  // Un test de "todas abren" pasaría igual si todos los links apuntaran al mismo equipo. El
  // renglón promete un modelo y un precio: la ficha tiene que ser la de ese equipo.
  for (const u of UNIDADES.filter((x) => x.enElTexto)) {
    const response = await getRaw(request, urlDeLaFicha(u.slug));
    expect(
      firstH1(await response.text()),
      `el link de ${u.slug} abre una ficha que no es la suya: el comprador que tocó ese renglón ` +
        'aterriza en otro equipo',
    ).toBe(u.title);
  }
});
