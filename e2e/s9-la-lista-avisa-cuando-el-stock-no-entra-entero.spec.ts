/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  S9 · Q5 · EL RECORTE A 100 EQUIPOS SE ANUNCIA EN PANTALLA, O NO EXISTE.
 *  Owner: `qa-agent`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## La regla de negocio
 * La lista arma **como mucho** `STOCK_LIST_MAX_UNITS` equipos. El dueño no lo sabe: él ve un texto
 * prolijo que empieza con el nombre de su negocio y termina en un link. Si el recorte no se dice,
 * **publica un estado creyendo que lista todo su stock** y los 40 equipos que quedaron afuera no
 * existen esa noche — sin ningún síntoma, porque la pantalla se ve perfecta.
 *
 * La query hace un `count()` aparte **sólo** cuando se toca el techo (`listPublishedUnitsForStockList`
 * en `_lib/stock-list/queries.ts`), o sea paga un round-trip extra con el único propósito de saber
 * cuántos quedaron afuera. Ese número tiene que llegar a la persona: un `count()` que nadie muestra
 * es costo puro.
 *
 * ## Las dos polaridades, que es lo que hace que esto sea una prueba
 * `CLAUDE.md` §5: *"una alarma se prueba encendiéndola con el caso patológico y callándola con el
 * tráfico legal"*. Acá el aviso **es** la alarma:
 *
 * 1. **Callada** — con 3 equipos publicados, la pantalla no dice una palabra de recorte. Un aviso
 *    que aparece siempre entrena a ignorarlo, y encima mentiría: no falta nada.
 * 2. **Encendida** — con 101 equipos publicados, la pantalla dice los dos números (**cuántos hay**
 *    y **cuántos entraron**) y el texto trae exactamente 100 links.
 *
 * Sin la polaridad 1, un `<Note>` incondicional pasaría el test. Sin la 2, borrar el `<Note>` lo
 * pasaría también. Las dos se miden **sobre el mismo negocio**, sembrando en dos tandas: es el
 * mismo tenant cruzando el techo, que es como pasa en la vida real (el dueño carga el equipo 101).
 *
 * ## Por qué los dos números y no sólo "hay más"
 * "Tenés más equipos de los que entran" no le sirve a nadie: la decisión del dueño es *"¿publico
 * igual o filtro?"*, y para eso necesita la magnitud. 101 contra 100 se resuelve publicando; 300
 * contra 100 no. El test exige **el total publicado** y **el techo**, cada uno como número suelto.
 *
 * `qa-agent` no edita `apps/web/**` para poner esto en verde (`CLAUDE.md` §4).
 */

import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './_lib/fixtures';
import { deleteTenantBySlug, deleteUserByEmail, seedManyPublicUnits, tenantIdBySlug } from './_lib/db';
import { APEX_URL, uniqueEmail, uniqueSlug } from './_lib/env';
import { createBusiness, signIn } from './_lib/panel';

test.describe.configure({ mode: 'serial' });

const LISTA_PATH = '/app/lista';

/** El techo de `_lib/stock-list/queries.ts`. Se escribe acá para que el test falle si allá cambia. */
const TECHO = 100;

/** Abajo del techo: el caso en el que el aviso tiene que estar callado. */
const POCOS = 3;

/** Uno arriba del techo. Uno solo: el mínimo que enciende la alarma es el que más se parece al bug. */
const MUCHOS = TECHO + 1;

const slug = uniqueSlug('techo');
const email = uniqueEmail('techo');

/** El renglón que anuncia el recorte, sin los números: el ancla que este spec busca en pantalla. */
const AVISO_RE = /equipos publicados y la lista arma los primeros/iu;

let context: BrowserContext;
let owner: Page;
let tenantId = '';

/** Todo lo que se ve en la pantalla, más los links de los bloques que el dueño copia. */
async function leerLaLista(): Promise<{ texto: string; urls: readonly string[] }> {
  await owner.goto(`${APEX_URL}${LISTA_PATH}`, { waitUntil: 'load' });

  const bloques = owner.locator('pre');
  await expect(
    bloques.first(),
    `${LISTA_PATH} no mostró ningún bloque para copiar: sin lista no hay recorte que anunciar`,
  ).toBeVisible({ timeout: 30_000 });

  const texto = await owner.locator('main').innerText();
  const urls = (await bloques.allInnerTexts()).flatMap(
    (bloque) => bloque.match(/https?:\/\/\S+/gu) ?? [],
  );
  return { texto, urls };
}

test.beforeAll(async ({ browser }) => {
  await deleteTenantBySlug(slug);
  await deleteUserByEmail(email);

  context = await browser.newContext();
  owner = await context.newPage();

  await signIn(owner, email);
  await createBusiness(owner, { name: 'Vidriera QA Techo', slug });

  const id = await tenantIdBySlug(slug);
  if (id === null) throw new Error(`el alta no dejó tenant para ${slug}`);
  tenantId = id;
});

test.afterAll(async () => {
  await context.close();
  await deleteTenantBySlug(slug);
  await deleteUserByEmail(email);
});

test('con el stock entero adentro de la lista, la pantalla no habla de recorte', async () => {
  await seedManyPublicUnits(tenantId, POCOS, 1);

  const { texto, urls } = await leerLaLista();

  expect(
    urls.length,
    `el negocio tiene ${String(POCOS)} equipos publicados y el texto trae ${String(urls.length)} links`,
  ).toBe(POCOS);

  expect(
    AVISO_RE.test(texto),
    'la pantalla anuncia un recorte que no ocurrió. Un aviso que sale siempre se aprende a ' +
      'ignorar, y para cuando el recorte sea de verdad el dueño ya no lo lee.',
  ).toBe(false);

  // `/i` y no `toContain`: el encabezado lleva `uppercase` de Tailwind y `innerText` devuelve el
  // texto **transformado** ("3 EQUIPOS"). Lo que se afirma es el número que la persona lee, no la
  // caja de las letras, que es una decisión de diseño y puede cambiar sin que nada se rompa.
  expect(
    texto,
    'el encabezado no dice cuántos equipos armó la lista: es el único número que el dueño puede ' +
      'contrastar con lo que tiene cargado',
  ).toMatch(new RegExp(`\\b${String(POCOS)} equipos\\b`, 'iu'));
});

test('cuando el stock no entra entero, la pantalla dice cuántos hay y cuántos entraron', async () => {
  // Segunda tanda sobre el MISMO negocio: es el dueño cruzando el techo, no otro fixture.
  await seedManyPublicUnits(tenantId, MUCHOS - POCOS, POCOS + 1);

  const { texto, urls } = await leerLaLista();

  expect(
    urls.length,
    `la lista tendría que armar ${String(TECHO)} equipos y armó ${String(urls.length)}: si el ` +
      'techo cambió, el aviso de abajo está diciendo un número que no es',
  ).toBe(TECHO);

  expect(
    AVISO_RE.test(texto),
    `el negocio tiene ${String(MUCHOS)} equipos publicados, la lista arma ${String(TECHO)} y la ` +
      'pantalla no lo dice. El dueño publica el estado creyendo que lista todo su stock y los ' +
      'equipos que quedaron afuera no existen esa noche.',
  ).toBe(true);

  // Los números se buscan **en el renglón del aviso**, no en la pantalla entera: el encabezado ya
  // dice "100 equipos", así que un `toContain('100')` suelto estaría verde con un aviso sin cifras.
  const renglon = texto.split('\n').find((linea) => AVISO_RE.test(linea)) ?? '';

  expect(
    renglon,
    `el aviso no trae el total publicado (${String(MUCHOS)}). Sin la magnitud, "hay más de los ` +
      'que entran" no le deja decidir si publica igual o filtra.',
  ).toMatch(new RegExp(`\\b${String(MUCHOS)}\\b`, 'u'));

  expect(
    renglon,
    `el aviso no trae cuántos entraron (${String(TECHO)}): el dueño no puede saber cuántos ` +
      'equipos le quedaron afuera',
  ).toMatch(new RegExp(`\\b${String(TECHO)}\\b`, 'u'));
});
