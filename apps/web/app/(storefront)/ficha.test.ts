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

  it('la ficha lee por `getStorefrontListing` y por nada más', () => {
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
