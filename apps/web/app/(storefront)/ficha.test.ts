/**
 * **Invariantes de la vidriera que se afirman sobre el FUENTE**, por el mismo motivo que
 * `error.test.ts`: `apps/web/tsconfig.json` declara `"jsx": "preserve"` (correcto — transpila
 * Next, no Vitest), así que importar un `.tsx` desde acá necesitaría una `vitest.config.ts` en
 * `apps/web/`, que no es de esta columna. La afirmación de comportamiento —el HTML servido de
 * verdad— vive donde corresponde: `scripts/accept-s3.sh` M3/M4, contra un server vivo.
 *
 * Lo que sí se puede afirmar acá, en milisegundos y sin build, son las tres cosas que se rompen
 * por edición y no por lógica:
 *
 * 1. **UN solo `wa.me` en toda la vidriera** (`CLAUDE.md` §1). Es una regla de conteo: el día que
 *    alguien agregue un botón "consultar" en la card de la grilla, el gate del LEAD no lo vería
 *    (la grilla no es la ficha) y el producto pasaría a mandar mensajes sin contexto.
 * 2. **El DTO es el único camino de datos al JSX.** Ninguna página de la vidriera importa el
 *    esquema de Drizzle ni el cliente de base: si no hay una fila cruda en scope, no hay nada que
 *    filtrar mal.
 * 3. **La descripción del dueño nunca se inyecta como HTML.**
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('.', import.meta.url).pathname;

function sources(dir: string): Array<{ rel: string; src: string }> {
  const out: Array<{ rel: string; src: string }> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sources(full));
    } else if (/\.tsx?$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name)) {
      out.push({ rel: full.slice(ROOT.length), src: readFileSync(full, 'utf8') });
    }
  }
  return out;
}

const FILES = sources(ROOT);
const FICHA = FILES.find((f) => f.rel === 's/[slug]/p/[listing]/page.tsx');
const GRID = FILES.find((f) => f.rel === '_components/listing-grid.tsx');

/** Las líneas que no son comentario: una regla no puede gritarle a la explicación de sí misma. */
function code(src: string): string {
  return src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/u.test(line))
    .join('\n');
}

describe('la ficha existe y es la única puerta al WhatsApp', () => {
  it('la ruta de la ficha está en su lugar', () => {
    expect(FICHA).toBeDefined();
  });

  it('hay exactamente UN componente que emite un enlace de WhatsApp', () => {
    const emitters = FILES.filter((f) => /\bwaUrl\b/u.test(code(f.src))).map((f) => f.rel);
    expect(emitters).toEqual(['_components/wa-button.tsx']);
  });

  it('ese componente renderiza un solo `<a>` marcado, y la ficha lo usa una sola vez', () => {
    const button = FILES.find((f) => f.rel === '_components/wa-button.tsx');
    expect(button).toBeDefined();
    expect(code(button?.src ?? '').match(/data-wa=/gu)).toHaveLength(1);
    expect(code(FICHA?.src ?? '').match(/<WaButton\b/gu)).toHaveLength(1);
  });

  it('la grilla NO tiene botón de WhatsApp: sin ficha no hay equipo ni precio que nombrar', () => {
    expect(code(GRID?.src ?? '')).not.toMatch(/WaButton|wa\.me|waUrl/u);
  });

  it('el texto del mensaje no se transcribe en la ficha: son dos registros a propósito', () => {
    // El mensaje dice "usado A" (jerga de reseller) y la ficha dice "usado excelente" (comprador).
    // Ratificado por el LEAD en FASE 2. Imprimir el mensaje al lado del label los enfrenta.
    expect(code(FICHA?.src ?? '')).not.toMatch(/\bwaMessage\b/u);
  });
});

describe('el DTO es el único camino de datos hasta el JSX', () => {
  it('ninguna página o componente de la vidriera importa el esquema ni el cliente de base', () => {
    const pages = FILES.filter((f) => /\/page\.tsx$/u.test(f.rel) || f.rel.startsWith('_components/'));
    for (const file of pages) {
      expect(code(file.src), file.rel).not.toMatch(/from '@istock\/db'/u);
      expect(code(file.src), file.rel).not.toMatch(/drizzle|postgres/u);
    }
  });

  it('la ficha lee por los loaders de `_lib`, nunca por Drizzle', () => {
    // Son dos loaders y no uno desde S3.3: el del equipo, y el del tenant que desempata los dos
    // miss (ver el describe de S3.3, abajo). Ninguno de los dos abre una conexión desde acá.
    const src = code(FICHA?.src ?? '');
    expect(src).toMatch(/getStorefrontListing/u);
    expect(src).not.toMatch(/\.select\(|withStorefrontDb/u);
  });

  it('la grilla lee por `getStorefrontCatalog` y no arma su propio select', () => {
    const home = FILES.find((f) => f.rel === 's/[slug]/page.tsx');
    expect(code(home?.src ?? '')).toMatch(/getStorefrontCatalog/u);
    expect(code(home?.src ?? '')).not.toMatch(/\.select\(/u);
  });
});

describe('la descripción del dueño es input no confiable', () => {
  it('en ningún lado de la vidriera se inyecta HTML crudo', () => {
    for (const file of FILES) {
      expect(code(file.src), file.rel).not.toMatch(/dangerouslySetInnerHTML/u);
    }
  });
});

describe('cache: la ficha registra su propio tag además de los del tenant', () => {
  it('emite storefront, tenant-config y listing', () => {
    const src = code(FICHA?.src ?? '');
    expect(src).toMatch(/storefrontTag\(/u);
    expect(src).toMatch(/tenantConfigTag\(/u);
    expect(src).toMatch(/listingTag\(/u);
  });

  it('no hay TTL por tiempo en ninguna página de la vidriera', () => {
    for (const file of FILES) {
      expect(code(file.src), file.rel).not.toMatch(/export\s+const\s+revalidate/u);
    }
  });
});

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  El miss de la ficha, después de la medición del 2026-08-28
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * La afirmación que importa —que el miss trae TEXTO VISIBLE en la PRIMERA request— sólo se puede
 * hacer contra un server vivo, y la hace `scripts/accept-s3.sh` M7, que es del LEAD. Acá se fijan
 * las tres cosas que M7 no puede ver y que se rompen por edición, no por lógica: que nadie vuelva
 * a lanzar `notFound()` en la vidriera, que el texto del miss siga viviendo una sola vez, y que el
 * miss no crezca un botón de WhatsApp.
 */
describe('el equipo que no existe se DEVUELVE, no se lanza', () => {
  const MISS = FILES.find((f) => f.rel === '_components/listing-miss.tsx');

  it('ningún archivo de la vidriera llama `notFound()`: está medido que no pinta nada', () => {
    // Medido por el LEAD sobre `eaccfee`: slug de ficha inventado → req1 200 con 0 chars de texto
    // visible, req2 404. Es el patológico de ADR-011 un nivel más abajo. Volver a `notFound()` acá
    // es volver a servirle una pantalla en blanco a quien abrió un link viejo de un estado de WA.
    const lanzan = FILES.filter((f) => /\bnotFound\(\)/u.test(code(f.src))).map((f) => f.rel);
    expect(lanzan).toEqual([]);
  });

  it('la ficha devuelve el miss como contenido, nunca lanzando', () => {
    // Las dos ramas negativas del cuerpo terminan en un componente de miss devuelto. La que
    // desempata devuelve los dos en la misma expresión, así que se cuenta el componente, no el
    // `return`.
    const src = code(FICHA?.src ?? '');
    expect(src).toMatch(/<ListingMiss \/>/u);
    expect(src).toMatch(/<StorefrontMiss \/>/u);
  });

  it('el texto del miss vive en UN solo archivo', () => {
    const dicen = FILES.filter((f) => f.src.includes('Ver el resto de la vidriera')).map((f) => f.rel);
    expect(dicen).toEqual(['_components/listing-miss.tsx']);
  });

  it('el `<title>` y el `<h1>` del miss son el mismo string', () => {
    // Dos literales iguales hoy son dos literales distintos en tres meses: la pestaña dice una cosa
    // y la pantalla otra, y nadie lo mira nunca.
    expect(code(MISS?.src ?? '').match(/'Este equipo ya no está publicado'/gu)).toHaveLength(1);
    expect(code(MISS?.src ?? '')).toMatch(/\{LISTING_MISS_TITLE\}/u);
  });

  it('el miss va noindex soldado al DOM, además de por la metadata', () => {
    // Cuerpo y metadata son dos entradas de cache distintas y la metadata se streamea aparte: la
    // directiva del camino negativo no puede depender de qué rama de metadata resolvió.
    expect(code(MISS?.src ?? '')).toMatch(/name="robots" content="noindex, nofollow"/u);
    expect(code(MISS?.src ?? '')).toMatch(/robots: \{ index: false, follow: false \}/u);
  });

  it('el miss no tiene botón de WhatsApp: sin equipo no hay precio que nombrar', () => {
    expect(code(MISS?.src ?? '')).not.toMatch(/WaButton|wa\.me|waUrl/u);
  });

  it('el camino de vuelta apunta a la vidriera del tenant, no al apex', () => {
    // `STOREFRONT_HOME_PATH` es `/` bajo el host del tenant, que el proxy reescribe a `/s/{slug}`.
    // El motivo (y por qué no es una URL absoluta) vive una sola vez, en `_lib/routes.ts`.
    expect(code(MISS?.src ?? '')).toMatch(/href=\{STOREFRONT_HOME_PATH\}/u);
    expect(code(MISS?.src ?? '')).not.toMatch(/href="\//u);
  });
});

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  S3.3 · el tenant que no existe y el equipo que no existe son DOS hechos, y se dicen distinto
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * El defecto: `getStorefrontListing()` devuelve `null` por dos motivos —no hay tenant · no hay
 * equipo— y la ficha contestaba *"Este equipo ya no está publicado"* para los dos. A quien abría
 * `{inventado}.maat.work/p/lo-que-sea` le decíamos que se agotó un equipo de un negocio que nunca
 * existió, y lo invitábamos a ver "el resto de la vidriera" de una vidriera que no hay. Peor: la
 * home del mismo subdominio muerto ya distinguía bien, así que dos URLs del mismo host contestaban
 * cosas distintas sobre el mismo hecho.
 *
 * Lo que M7 de `accept-s3.sh` mide es el miss del **equipo** (pide `/p/...` bajo el host del
 * tenant del seed). El miss del **tenant** en la ficha no lo ve nadie ahí, así que su invariante
 * de costo se fija acá: **la consulta del tenant no puede estar en el camino feliz.**
 */
describe('S3.3 · la ficha distingue el tenant que no existe del equipo que no existe', () => {
  const src = () => code(FICHA?.src ?? '');

  it('reusa el loader del tenant de la home, no una segunda consulta escrita a mano', () => {
    // El mismo `'use cache'`, los mismos tags y el mismo perfil corto para el `null` que usa
    // `s/[slug]/page.tsx`. Una consulta nueva acá sería un segundo lugar donde arreglar el día que
    // cambie la regla de `status = 'active'`.
    expect(src()).toMatch(/getStorefrontTenant/u);
    expect(src()).not.toMatch(/\.select\(|withStorefrontDb/u);
  });

  it('el desempate ocurre DESPUÉS del `null` del listing, nunca antes', () => {
    // ESTE es el invariante de costo, y el motivo por el que este test existe. Un
    // `getStorefrontTenant(slug)` arriba del `getStorefrontListing(slug, ...)` le suma una consulta
    // a TODA ficha, incluidas las que existen, para arreglar el caso raro. `CLAUDE.md` §3: el 95%
    // de los hits no toca Postgres, y está medido en `MEDIDO s3 db-hits`.
    const body = src();
    const listingAt = body.indexOf('getStorefrontListing(slug');
    const tenantAt = body.indexOf('getStorefrontTenant(slug');
    expect(listingAt, 'la ficha ya no llama a `getStorefrontListing`').toBeGreaterThan(-1);
    expect(tenantAt, 'la ficha ya no llama a `getStorefrontTenant`').toBeGreaterThan(-1);
    expect(
      tenantAt,
      'la consulta del tenant quedó antes de la del equipo: eso le agrega un hit de Postgres al ' +
        'camino feliz de toda ficha que sí existe',
    ).toBeGreaterThan(listingAt);
  });

  it('la consulta del tenant se hace UNA vez y desde un solo lugar', () => {
    // Cuerpo y metadata desempatan por el mismo helper. Si cada uno tuviera su propia llamada, una
    // de las dos deriva y sale la peor pantalla: `<h1>` de una respuesta con `<title>` de la otra.
    expect(src().match(/getStorefrontTenant\(slug\)/gu)).toHaveLength(1);
  });

  it('los dos miss se eligen con el mismo predicado en el cuerpo y en la metadata', () => {
    expect(src()).toMatch(/storefrontExists\(slug\).*<ListingMiss \/>.*<StorefrontMiss \/>/su);
    expect(src()).toMatch(/missMetadataFor\(slug\)/u);
    expect(src()).toMatch(
      /storefrontExists\(slug\).*LISTING_MISS_METADATA.*STOREFRONT_MISS_METADATA/su,
    );
  });

  it('el miss del tenant en la ficha usa el MISMO texto que el de la home', () => {
    // No se inventa copy: se importan las dos mitades del módulo que ya la tiene. Si alguien
    // escribiera el título a mano acá, habría dos strings y en tres meses dicen cosas distintas.
    expect(src()).toMatch(/from '\.\.\/\.\.\/\.\.\/\.\.\/_components\/storefront-miss'/u);
    expect(src()).not.toMatch(/No hay ninguna vidriera/u);
  });

  it('los dos miss de la ficha siguen siendo noindex y sin wa.me', () => {
    // Los dos bordes del pedido, afirmados sobre los componentes que la ficha devuelve.
    for (const rel of ['_components/listing-miss.tsx', '_components/storefront-miss.tsx']) {
      const file = FILES.find((f) => f.rel === rel);
      expect(code(file?.src ?? ''), rel).toMatch(/name="robots" content="noindex, nofollow"/u);
      expect(code(file?.src ?? ''), rel).toMatch(/robots: \{ index: false, follow: false \}/u);
      expect(code(file?.src ?? ''), rel).not.toMatch(/WaButton|wa\.me|waUrl/u);
    }
  });
});
