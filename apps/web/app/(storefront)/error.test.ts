/**
 * **El error boundary de la vidriera no puede desaparecer ni empezar a hablar de más.**
 *
 * ## Por qué este archivo existe, y por qué mira el fuente en vez de renderizar
 * El HIGH de S1 tuvo dos mitades. La primera —el slug malformado que llegaba a `cacheTag()`— está
 * arreglada en su raíz y la cubren `_lib/host.test.ts`, `_lib/cache-tags.test.ts` y el e2e de
 * `qa-agent`. La segunda es más ancha que su vector: bajo `cacheComponents` + PPR **cualquier**
 * throw durante el render de una ruta cacheada sale como stream abierto con `200`, no como `500`,
 * porque los headers ya se emitieron con el shell parcial.
 *
 * Eso dejó de ser teoría durante la propia slice: el LEAD levantó un `next start` sin
 * `DATABASE_URL` y **todo** slug bien formado empezó a colgarse en `200` con digest `847566072`.
 * Ningún matcher tapa eso. Lo tapa `error.tsx`, y por eso el archivo no es un extra del fix: es la
 * mitad que cubre los throws que todavía no sabemos que existen.
 *
 * El test **no renderiza** el componente a propósito, y la razón es concreta: `apps/web/tsconfig`
 * declara `"jsx": "preserve"` (correcto: transpila Next, no Vitest), así que importar un `.tsx`
 * desde Vitest necesitaría una `vitest.config.ts` en `apps/web/`, que no es de esta columna.
 * Cambiar la config de otro para poder testear lo mío sería peor que la alternativa honesta:
 * afirmar sobre el fuente lo que se puede afirmar sobre el fuente, y dejar la afirmación de
 * comportamiento —que el stream **cierra**— donde ya vive, que es el e2e contra un server real.
 * Lo de acá corre en milisegundos y sin build, así que la próxima vez que alguien borre el archivo
 * o le agregue un import, el rojo llega en el commit.
 *
 * ## Las cuatro invariantes, y qué las rompe
 * 1. **Existe.** Es la única que importa de verdad: sin boundary, la clase entera vuelve.
 * 2. **Es Client Component.** Next exige `'use client'` en un boundary de ruta; sin eso no es un
 *    boundary, es un componente más que se cae con el resto. (Esto choca con `web-lint` W001, que
 *    prohíbe `'use client'` en toda la vidriera: la excepción le corresponde al owner de
 *    `web-lint.mjs`, ver el docblock de `error.tsx`.)
 * 3. **No filtra el detalle del error al HTML** (`CLAUDE.md` §2). En producción Next reemplaza el
 *    mensaje de un error de servidor por uno genérico, pero **en dev lo serializa entero al
 *    cliente**, y en dev es cuando un mensaje trae la query, un slug ajeno o un pedazo de fila.
 * 4. **No importa nada.** Es el único `'use client'` de la vidriera: su árbol de imports es lo
 *    único de `packages/*` que puede terminar en el bundle de un visitante anónimo.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(new URL('./error.tsx', import.meta.url), 'utf8');

/**
 * Las líneas de código, sin comentarios.
 *
 * El docblock de `error.tsx` **nombra** `error.message` para explicar por qué no lo renderiza. Un
 * grep sobre el archivo entero se pondría rojo por la documentación de la regla que está
 * cumpliendo. Mismo criterio que `scan()` en `apps/web/scripts/web-lint.mjs`.
 */
const CODE = SOURCE.split('\n')
  .filter((line) => {
    const trimmed = line.trim();
    return !(trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*'));
  })
  .join('\n');

describe('error.tsx · el backstop de la vidriera', () => {
  it('existe y no está vacío: sin boundary, un throw de render vuelve a ser un stream colgado con 200', () => {
    expect(
      SOURCE.length,
      '`app/(storefront)/error.tsx` desapareció o quedó vacío. Bajo `cacheComponents` + PPR eso no ' +
        'devuelve 500: el shell ya salió con 200 y el body queda abierto hasta el `maxDuration` ' +
        '(300 s de Active CPU facturados, `no-store`, sin cache que lo absorba).',
    ).toBeGreaterThan(0);

    expect(
      CODE,
      'el boundary dejó de exportar un componente por default. Next sólo toma el `export default` ' +
        'de `error.tsx` como boundary; cualquier otro export es un archivo decorativo.',
    ).toMatch(/export default function/u);
  });

  it('es Client Component: un boundary de ruta sin "use client" no es un boundary', () => {
    expect(
      CODE.split('\n')[0]?.trim(),
      'la primera línea dejó de ser `\'use client\'`. Next lo exige para los error boundaries; sin ' +
        'la directiva el archivo compila y no atrapa nada.',
    ).toMatch(/^'use client';$/u);
  });

  it('no filtra el detalle del error al HTML público (CLAUDE.md §2)', () => {
    for (const leak of ['error.message', 'error.stack', 'error.cause', 'JSON.stringify(error']) {
      expect(
        CODE,
        `el boundary renderiza \`${leak}\`. En dev Next serializa el mensaje entero al cliente, y ` +
          'un mensaje de la vidriera puede traer la query, el slug de otro tenant o un fragmento ' +
          'de fila. Lo único publicable es `digest`, que es un hash y se cruza con los logs.',
      ).not.toContain(leak);
    }

    expect(
      CODE,
      '`digest` dejó de mostrarse. Es lo que permite que el que atiende el WhatsApp nos pase un ' +
        'código y podamos encontrar el error en los logs sin pedirle una captura.',
    ).toContain('error.digest');
  });

  it('no importa nada: es el único "use client" de la vidriera y su árbol de imports viaja al browser', () => {
    const imports = [...CODE.matchAll(/^\s*import\s.+$/gmu)].map((match) => match[0].trim());

    expect(
      imports,
      'el boundary empezó a importar. Cualquier import acá es JS que se le baja a un visitante ' +
        'anónimo en 4G; un barrel de `@istock/domain` arrastra `fx`, `wa`, `dto` y los módulos de ' +
        'identificadores de equipo al chunk del cliente por una constante. Tree-shaking *debería* limpiarlo, y "debería" no es un ' +
        'presupuesto. Si hace falta un dato, se pasa por props desde el server.',
    ).toEqual([]);

    // `useEffect`/`useState` no son ilegales por React: son ilegales por presupuesto. Un boundary
    // que reporta al cliente es un fetch más en el camino del visitante, y el server ya loggeó.
    expect(CODE, 'el boundary agregó estado o efectos: la vidriera no hace fetch de cliente').not.toMatch(
      /\buse(Effect|State|Router)\s*\(/u,
    );
  });
});
