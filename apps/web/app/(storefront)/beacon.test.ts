/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  S4 · el click que se registra sin PII, y el guard de la única inyección de HTML de la vidriera
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Mismo criterio que `ficha.test.ts` y `error.test.ts`: se afirma **sobre el fuente**, porque
 * `apps/web/tsconfig.json` declara `"jsx": "preserve"` y una `vitest.config.ts` en `apps/web/` no
 * es de esta columna. Lo que este archivo puede probar en milisegundos y sin build son las cosas
 * que se rompen **por edición** y que ningún test de comportamiento vería a tiempo.
 *
 * Lo que este archivo **no** prueba, y quién lo prueba, para que nadie confunda cobertura con
 * afirmación:
 *
 * | invariante | quién lo mide |
 * |---|---|
 * | el click deja UNA fila, en el tenant y el equipo correctos | `e2e/s4-…` (`qa-agent`), contra Postgres |
 * | cargar la ficha no escribe ninguna fila | ídem, `MEDIDO s4 click` |
 * | el POST cruzado no escribe nada | ídem, `MEDIDO s4 cruce` |
 * | sin JavaScript el botón abre WhatsApp | ídem, `MEDIDO s4 sinjs`, con `javaScriptEnabled: false` |
 * | `anon` no gana ningún privilegio de más | `packages/db` (policy + `rls-lint`) y W3 del gate |
 *
 * Acá abajo está el resto: la forma del handler, que el beacon no pueda ponerse adelante de la
 * venta, y —lo más delicado— que la exención de `dangerouslySetInnerHTML` que `ficha.test.ts`
 * concede a `_components/wa-beacon.tsx` no sea una puerta.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('.', import.meta.url).pathname;

const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

/** Las líneas que no son comentario: una regla no puede gritarle a la explicación de sí misma. */
function code(src: string): string {
  return src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/u.test(line))
    .join('\n');
}

const HANDLER_REL = 's/[slug]/api/track/route.ts';
const BEACON_REL = '_components/wa-beacon.tsx';
const BUTTON_REL = '_components/wa-button.tsx';

const HANDLER = read(HANDLER_REL);
const BEACON = read(BEACON_REL);
const BUTTON = read(BUTTON_REL);

/** El `<script>` que se embarca, tal cual sale al HTML. */
const SCRIPT = /const WA_BEACON_SCRIPT = `([\s\S]*?)`;/u.exec(BEACON)?.[1] ?? '';

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  1 · El handler
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('el handler vive en la ruta que escribe el proxy y sólo contesta POST', () => {
  it('está en `/s/[slug]/api/track`, que es adonde el proxy reescribe `{slug}.maat.work/api/track`', () => {
    expect(HANDLER.length).toBeGreaterThan(0);
  });

  it('no exporta ningún otro método: un GET a esta ruta es 405, y ése es el control de vida del e2e', () => {
    // El e2e de `qa-agent` distingue "el endpoint está y rechazó" de "no hay endpoint" con un GET:
    // 405 si la ruta existe y sólo exporta POST, 404 si no existe. Sin esta regla, exportar un
    // `GET` de conveniencia convertiría su `filas_creadas=0` en un resultado que no prueba nada.
    expect(code(HANDLER)).toMatch(/export async function POST\(/u);
    expect(code(HANDLER)).not.toMatch(/export (async )?function (GET|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/u);
  });
});

describe('el tenant sale del segmento de path, y de ningún otro lado', () => {
  it('lo lee de `params`, que es lo que escribió el proxy desde el host', () => {
    expect(code(HANDLER)).toMatch(/await params/u);
  });

  it('no acepta un tenant dictado por quien llama', () => {
    // Es la misma expresión que corre W3 de `scripts/accept-s4.sh`, y acá se aplica al fuente
    // ENTERO —comentarios incluidos, igual que allá— para que las dos den el mismo veredicto.
    expect(HANDLER).not.toMatch(/body[^\n]*tenant|tenant_?[iI]d\s*:\s*(z\.|body|json|input)/u);
  });

  it('no lee headers ni cookies: ni para el tenant, ni para nada', () => {
    expect(code(HANDLER)).not.toMatch(/\brequest\.headers\b|\bheaders\(\)|\bcookies\(\)/u);
  });
});

describe('sin PII: no se anonimiza, no se recibe', () => {
  it('no hay una sola lectura de la dirección de red ni del navegador del visitante', () => {
    // Espejo de W2 del gate. `wa_click_events` no tiene columna donde poner esto, y el handler
    // tampoco tiene de dónde sacarlo: son las dos mitades de la misma afirmación.
    expect(code(HANDLER)).not.toMatch(/x-forwarded-for|x-real-ip|user-?[aA]gent|cf-connecting-ip|\.ip\b/u);
  });

  it('el cuerpo se valida con un objeto CERRADO', () => {
    expect(code(HANDLER)).toMatch(/\.strict\(\)/u);
    expect(code(HANDLER)).not.toMatch(/passthrough\(|looseObject\(|\.catchall\(/u);
  });

  it('el enum de `source` sale de `packages/db` y no de una copia escrita a mano', () => {
    expect(code(HANDLER)).toMatch(/import \{ waClickSourceEnum \} from '@istock\/db'/u);
    expect(code(HANDLER)).toMatch(/z\.enum\(waClickSourceEnum\.enumValues\)/u);
  });

  it('el cuerpo tiene techo: nadie usa el beacon para hacernos parsear un megabyte', () => {
    expect(code(HANDLER)).toMatch(/MAX_BEACON_CHARS/u);
  });
});

describe('la respuesta es siempre el mismo 204, sin cuerpo', () => {
  it('hay una sola forma de contestar y no filtra nada de la base', () => {
    // Un status distinto según si el uuid existe en otro tenant convertiría este endpoint en un
    // oráculo de pertenencia. Y un mensaje de Postgres en el cuerpo sería el error crudo servido
    // a un visitante anónimo.
    expect(code(HANDLER).match(/new Response\(/gu)).toHaveLength(1);
    expect(code(HANDLER)).toMatch(/new Response\(null, \{ status: 204/u);
    expect(code(HANDLER)).not.toMatch(/Response\.json|\bstatus: [45]\d\d/u);
  });
});

describe('el insert: filtro de tenant explícito además de RLS, y sin degradar a una fila vacía', () => {
  it('la unidad se ata al tenant del claim dentro de la misma sentencia', () => {
    expect(code(HANDLER)).toMatch(/and l\.tenant_id = \(select public\.storefront_tenant_id\(\)\)/u);
  });

  it('es `insert … select`, no `insert … values`: un equipo ajeno da CERO filas, no una fila sin equipo', () => {
    // Con `values`, un uuid de otro negocio resolvería a null y la fila se escribiría igual por la
    // rama del footer de la policy: le anotaría al atacante una conversación que nunca existió, y
    // el e2e cuenta las filas de los DOS tenants justamente por eso.
    expect(code(HANDLER)).toMatch(/insert into wa_click_events[\s\S]*?select l\.tenant_id, l\.id/u);
    expect(code(HANDLER)).not.toMatch(/insert into wa_click_events[^\n]*\n\s*values/u);
  });

  it('no hay `returning`: `anon` no lee esta tabla, ni siquiera lo que acaba de escribir', () => {
    expect(code(HANDLER).toLowerCase()).not.toMatch(/returning/u);
  });

  it('la sesión es la de la vidriera: rol `anon` y claim del slug, como toda query de acá', () => {
    expect(code(HANDLER)).toMatch(/withStorefrontDb\(/u);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  2 · El beacon no puede ponerse adelante de la venta
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('el botón lo sigue rindiendo el servidor', () => {
  it('ni el botón ni el beacon son Client Components', () => {
    for (const [rel, src] of [
      [BUTTON_REL, BUTTON],
      [BEACON_REL, BEACON],
    ] as const) {
      expect(code(src), rel).not.toMatch(/['"]use client['"]/u);
    }
  });

  it('el `href` sigue siendo el `wa.me` del equipo, no un redirector propio', () => {
    // Un redirector nuestro delante del botón agregaría un salto, una invocación y un riesgo de
    // open redirect en la única acción que da plata.
    expect(code(BUTTON)).toMatch(/href=\{listing\.waUrl\}/u);
    expect(code(BUTTON)).toMatch(/target="_blank"/u);
    expect(code(BUTTON)).toMatch(/rel="noopener"/u);
  });

  it('el equipo viaja en un atributo del anchor, y es el `id` del DTO', () => {
    expect(code(BUTTON)).toMatch(/data-wa-listing=\{listing\.id\}/u);
    // Y sigue habiendo UN solo marcador `data-wa=`: es el selector del que cuelga el beacon y el
    // que cuenta `ficha.test.ts`.
    expect(code(BUTTON).match(/data-wa="listing"/gu)).toHaveLength(1);
  });

  it('el beacon viaja soldado al botón: se monta una vez y sólo desde ahí', () => {
    expect(code(BUTTON).match(/<WaClickBeacon \/>/gu)).toHaveLength(1);
  });
});

describe('el evento sale en el CLICK, por sendBeacon, y no cancela nada', () => {
  it('nada en la vidriera cancela el click para poder trackearlo', () => {
    for (const [rel, src] of [
      [BUTTON_REL, BUTTON],
      [BEACON_REL, BEACON],
    ] as const) {
      expect(src, rel).not.toMatch(/preventDefault|stopPropagation|returnValue/u);
    }
  });

  it('usa `navigator.sendBeacon` y no `fetch`: el browser cancela un fetch al navegar afuera', () => {
    expect(SCRIPT).toMatch(/navigator\.sendBeacon\(/u);
    expect(SCRIPT).not.toMatch(/fetch\(|XMLHttpRequest/u);
  });

  it('hay UN listener y es de `click`: nada dispara en el view', () => {
    // Es la regla de costo más importante de la slice y la que `cost-auditor` marcó como el riesgo
    // más probable: atado al view, `allowed requests ≈ pageviews` y la tabla deja de medir
    // intención de compra (mirar ya lo cuenta PostHog).
    expect(SCRIPT.match(/addEventListener\(/gu)).toHaveLength(1);
    expect(SCRIPT).toMatch(/addEventListener\('click'/u);
    expect(SCRIPT).not.toMatch(/DOMContentLoaded|'load'|IntersectionObserver|'scroll'|visibilitychange|setTimeout|setInterval/u);
  });

  it('manda dos campos y ninguno es el tenant', () => {
    expect(SCRIPT).toMatch(/JSON\.stringify\(\{listingId:id,source:'storefront_detail'\}\)/u);
    expect(SCRIPT).not.toMatch(/tenant/u);
  });

  it('sin la unidad no manda nada: una fila sin equipo no le sirve a nadie', () => {
    expect(SCRIPT).toMatch(/if\(!id\|\|!navigator\.sendBeacon\)return;/u);
  });

  it('se instala una sola vez aunque el componente se rindiera dos veces', () => {
    // Dos listeners serían dos filas por un click, y el gate exige exactamente una.
    expect(SCRIPT).toMatch(/if\(window\.__waBeacon\)return;/u);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  3 · La exención de `dangerouslySetInnerHTML` NO es una puerta
// ══════════════════════════════════════════════════════════════════════════════════════════════
//
// `ficha.test.ts` prohíbe inyectar HTML crudo en toda la vidriera y exime a este archivo por
// nombre, con la misma forma que W001/W001b de `web-lint.mjs` usa para el error boundary. Una
// exención sin un segundo guard es sólo un agujero con una nota al lado. Este es el guard.

describe('lo único que se inyecta es una constante escrita a mano', () => {
  it('hay exactamente una inyección y su contenido es la constante del módulo', () => {
    expect(code(BEACON).match(/dangerouslySetInnerHTML/gu)).toHaveLength(1);
    expect(code(BEACON)).toMatch(/dangerouslySetInnerHTML=\{\{ __html: WA_BEACON_SCRIPT \}\}/u);
  });

  it('la constante no tiene una sola interpolación: no hay dónde meter un dato', () => {
    expect(SCRIPT.length).toBeGreaterThan(0);
    expect(SCRIPT).not.toContain('${');
  });

  it('el componente no recibe props ni importa nada: no le llega ningún dato para inyectar', () => {
    expect(code(BEACON)).toMatch(/export function WaClickBeacon\(\) \{/u);
    expect(code(BEACON)).not.toMatch(/^import\s/mu);
  });

  it('el script no puede salirse de su propio `<script>`', () => {
    // Sin un `<` adentro no hay forma de cerrar el elemento antes de tiempo, que es la única
    // manera de que una inyección en línea se convierta en markup.
    expect(SCRIPT).not.toContain('<');
  });

  it('el script es chico de verdad: se embarca en CADA ficha', () => {
    // Presupuesto explícito, medido acá y no estimado. Si alguien lo duplica, este test lo dice.
    expect(Buffer.byteLength(SCRIPT, 'utf8')).toBeLessThanOrEqual(600);
  });
});
