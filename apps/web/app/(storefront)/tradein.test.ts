/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  S8 · el canje que entra desde la vidriera: el borde, y que los dos bordes digan lo mismo
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Dos clases de afirmación, y conviene no confundirlas:
 *
 * 1. **Comportamiento** de `_lib/tradein-form.ts`, que es TypeScript puro y se importa de verdad:
 *    qué acepta y qué rechaza el parser, y cómo queda el teléfono guardado.
 * 2. **Forma del fuente** del handler, del formulario y de las tres páginas. Se afirma sobre el
 *    texto —igual que `beacon.test.ts` y `ficha.test.ts`— porque `apps/web/tsconfig.json` declara
 *    `"jsx": "preserve"` y una `vitest.config.ts` en `apps/web/` no es de esta columna. Lo que se
 *    prueba así es lo que se rompe **por edición** y que ningún test de comportamiento vería a
 *    tiempo: que alguien saque el filtro de tenant, agregue un `returning`, o loguee el body.
 *
 * Y una tercera que es la que justifica el archivo entero:
 *
 * 3. **El borde de Zod contra el borde del motor.** Los `CHECK` de
 *    `packages/db/drizzle/0008_storefront_tradein_lead_insert.sql` y `TRADEIN_LIMITS` son dos
 *    afirmaciones del mismo número escritas por dos columnas distintas (`db-agent` y
 *    `storefront-agent`). Sin este test, `db-agent` puede bajar un `CHECK` a 60 y este borde sigue
 *    aceptando 80: el síntoma sería un canje que se pierde en un `catch` genérico, sin error
 *    visible, el día que alguien escriba un nombre largo. La misma comparación cubre el `GRANT`:
 *    si el `insert` del handler nombrara una décima columna, Postgres daría `42501` y la respuesta
 *    correcta es sacarla, no agrandar el privilegio.
 *
 * Lo que este archivo **no** prueba, y quién lo prueba:
 *
 * | invariante | quién lo mide |
 * |---|---|
 * | el POST deja UNA fila, en el tenant del host | `qa-agent`, e2e contra Postgres |
 * | un POST cruzado (`otro.maat.work`) no escribe nada | ídem |
 * | `anon` no puede leer ni un lead, ni el propio | `packages/db` (policy + `rls-lint`) |
 * | el `303` navega y no reenvía con F5 | e2e con navegador real |
 * | el WAF corta al sexto envío en 10 min | `scripts/guard-firewall.sh` + plataforma |
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONDITIONS } from '@istock/domain';
import {
  MAX_TRADEIN_BODY_CHARS,
  TRADEIN_ENGINE_CHECKS,
  TRADEIN_FIELDS,
  TRADEIN_LIMITS,
  normalizeWaPhone,
  parseTradeinBody,
} from './_lib/tradein-form';

const ROOT = new URL('.', import.meta.url).pathname;
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

/** Las líneas que no son comentario: una regla no puede gritarle a la explicación de sí misma. */
function code(src: string): string {
  return src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/u.test(line))
    .join('\n');
}

const HANDLER_REL = 's/[slug]/api/tradein/route.ts';
const FORM_REL = '_components/tradein-form.tsx';
const PAGE_REL = 's/[slug]/canje/page.tsx';
const DONE_REL = 's/[slug]/canje/listo/page.tsx';
const RETRY_REL = 's/[slug]/canje/reintentar/page.tsx';

const HANDLER = read(HANDLER_REL);
const FORM = read(FORM_REL);
const PAGES = [PAGE_REL, DONE_REL, RETRY_REL].map((rel) => ({ rel, src: read(rel) }));

/**
 * La migración de `db-agent`, leída desde acá. Es el único archivo fuera de esta columna que este
 * test toca, y sólo para leerlo: es la otra punta de la comparación.
 */
const MIGRATION = readFileSync(
  join(ROOT, '../../../../packages/db/drizzle/0008_storefront_tradein_lead_insert.sql'),
  'utf8',
);

/** El cuerpo del `sql\`\`` del handler: la sentencia sola, sin la prosa que la explica. */
const STATEMENT = /sql`([\s\S]*?)`/u.exec(code(HANDLER))?.[1] ?? '';

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  1 · Los dos bordes dicen el mismo número
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** `between 1 and 80` → `{min:1,max:80}` · `<= 40` → `{max:40}`. `null` = no se pudo leer. */
function engineBounds(constraint: string): { min?: number; max: number } | null {
  const line = MIGRATION.split('\n').find(
    (l) => l.includes(`ADD CONSTRAINT "${constraint}"`) && l.includes('CHECK'),
  );
  if (line === undefined) return null;

  const between = /between\s+(\d+)\s+and\s+(\d+)/u.exec(line);
  if (between !== null) return { min: Number(between[1]), max: Number(between[2]) };

  const atMost = /<=\s*(\d+)/u.exec(line);
  if (atMost !== null) return { max: Number(atMost[1]) };

  return null;
}

describe('cada límite de Zod es el mismo número que el CHECK del motor', () => {
  it('la migración 0008 existe y se pudo leer (ausencia de medición es FAIL, nunca PASS)', () => {
    expect(MIGRATION).toMatch(/ALTER TABLE "tradein_leads" ADD CONSTRAINT/u);
  });

  for (const [constraint, key] of Object.entries(TRADEIN_ENGINE_CHECKS)) {
    it(`${constraint} ↔ TRADEIN_LIMITS.${key}`, () => {
      const engine = engineBounds(constraint);
      // Si `db-agent` renombra el constraint, esto se pone rojo por NO ENCONTRARLO, que es
      // exactamente lo que tiene que pasar: un mapeo que se corrige solo no es una afirmación.
      expect(engine, `no encontré el CHECK ${constraint} en 0008`).not.toBeNull();

      const ours = TRADEIN_LIMITS[key];
      expect(ours.max).toBe(engine?.max);
      if (engine?.min !== undefined) expect(ours.min).toBe(engine.min);
    });
  }

  it('no hay ningún CHECK de la tabla que el borde no esté espejando', () => {
    // La otra mitad: arriba se verifica que lo que declaramos existe allá; acá, que no apareció
    // allá un límite nuevo que este borde ignora. Sin esto, un `CHECK` agregado en 0009 dejaría
    // canjes cayéndose en el `catch` sin que ningún test se moviera.
    const declared = [...MIGRATION.matchAll(/ADD CONSTRAINT "(tradein_leads_[a-z_]+)"/gu)].map(
      (m) => m[1],
    );
    expect(declared.length).toBeGreaterThan(0);
    expect(declared.sort()).toEqual(Object.keys(TRADEIN_ENGINE_CHECKS).sort());
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  2 · El insert nombra EXACTAMENTE las columnas del GRANT
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Las columnas de una lista SQL entre paréntesis, en minúsculas y sin comillas. */
const columns = (list: string): string[] =>
  list
    .split(',')
    .map((c) => c.replace(/["\s]/gu, '').toLowerCase())
    .filter((c) => c.length > 0);

describe('el insert del handler contra el GRANT de columna de `anon`', () => {
  const granted = columns(
    /GRANT INSERT \(([^)]*)\) ON TABLE "tradein_leads" TO anon/u.exec(MIGRATION)?.[1] ?? '',
  );
  const inserted = columns(/insert into tradein_leads\s*\(([^)]*)\)/iu.exec(STATEMENT)?.[1] ?? '');

  it('el GRANT de 0008 son nueve columnas y se pudo leer', () => {
    expect(granted).toHaveLength(9);
  });

  it('el handler nombra esas nueve y ni una más', () => {
    // Una décima columna es `42501` en producción y silencio en CI. Acá es rojo.
    expect([...inserted].sort()).toEqual([...granted].sort());
  });

  it('la sentencia no toca `status`, el precio ofrecido, las notas del dueño ni los campos del panel', () => {
    // Redundante con la igualdad de arriba a propósito: si alguien "arregla" ese test aflojándolo,
    // esta afirmación nombra una por una las columnas cuya ausencia es el diseño de la migración.
    for (const forbidden of [
      'status',
      'offer_usd',
      'internal_notes',
      'created_listing_id',
      'handled_by',
      'created_at',
      'updated_at',
    ]) {
      expect(STATEMENT).not.toMatch(new RegExp(`\\b${forbidden}\\b`, 'u'));
    }
  });

  it('`tenant_id` está en la lista de columnas y NO sale de nada que venga del cliente', () => {
    expect(inserted).toContain('tenant_id');
    // El valor de esa columna es `t.id`, la fila de `tenants` que resolvió el claim del slug.
    expect(STATEMENT).toMatch(/select\s+t\.id/iu);
    expect(code(HANDLER)).not.toMatch(/tenant_?[iI]d\s*[:=]/u);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  3 · La forma del handler
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('el handler vive donde reescribe el proxy y sólo contesta POST', () => {
  it('sólo exporta POST: un GET a `/api/tradein` es 405, no una página compartible', () => {
    expect(code(HANDLER)).toMatch(/export async function POST\(/u);
    expect(code(HANDLER)).not.toMatch(
      /export (async )?function (GET|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/u,
    );
  });

  it('el tenant sale de `params`, que es lo que escribió el proxy desde el host', () => {
    expect(code(HANDLER)).toMatch(/await params/u);
  });

  it('no acepta un tenant dictado por quien llama', () => {
    expect(HANDLER).not.toMatch(/body[^\n]*tenant|tenant_?[iI]d\s*:\s*(z\.|body|json|input|form)/u);
  });

  it('no lee ni un header del visitante: ni `request.headers`, ni `headers()`, ni `cookies()`', () => {
    // W002 ya lo prohíbe para las páginas; acá importa por otro motivo: si el `Location` del 303
    // se armara con el host del pedido, este handler pasaría a depender de un header que en la
    // página de al lado mata el ISR. El `Location` relativo es lo que evita esa tentación.
    expect(code(HANDLER)).not.toMatch(/request\.headers|\b(headers|cookies|draftMode)\s*\(\s*\)/u);
  });

  it('abre la transacción de la vidriera, o sea que corre como `anon`', () => {
    expect(code(HANDLER)).toMatch(/withStorefrontDb\(/u);
  });
});

describe('la sentencia: filtro explícito, `select` y sin `returning`', () => {
  it('filtra por tenant EN LA QUERY además de RLS, en subquery (CLAUDE.md §5, ADR-005)', () => {
    expect(STATEMENT).toMatch(
      /where\s+t\.id\s*=\s*\(\s*select\s+public\.storefront_tenant_id\(\)\s*\)/iu,
    );
  });

  it('es `insert … select`, no `insert … values`: sin tenant que tome canje no hay fila', () => {
    expect(STATEMENT).toMatch(/insert into tradein_leads[\s\S]*select/iu);
    expect(STATEMENT).not.toMatch(/\bvalues\s*\(/iu);
  });

  it('exige `accepts_trade_in`: un POST a mano se saltea la pantalla, no la sentencia', () => {
    expect(STATEMENT).toMatch(/and\s+t\.accepts_trade_in/iu);
  });

  it('no hay `returning`: `anon` tiene cero SELECT sobre la tabla y recibiría 42501', () => {
    expect(STATEMENT).not.toMatch(/returning/iu);
  });

  it('la confirmación sale de las filas afectadas, no de una fila leída', () => {
    expect(code(HANDLER)).toMatch(/affectedRows\(result\) === 1/u);
  });
});

describe('lo que el visitante recibe, y lo que no', () => {
  it('distingue "entró" de "no entró" con dos destinos, y con ningún otro dato', () => {
    expect(code(HANDLER)).toMatch(/TRADEIN_DONE_PATH/u);
    expect(code(HANDLER)).toMatch(/TRADEIN_RETRY_PATH/u);
  });

  it('contesta 303 (POST/Redirect/GET): un F5 no reenvía el canje', () => {
    expect(code(HANDLER)).toMatch(/status:\s*303/u);
    expect(code(HANDLER)).not.toMatch(/status:\s*30[127]\b/u);
  });

  it('el `Location` es relativo al host del tenant', () => {
    expect(code(HANDLER)).not.toMatch(/https?:\/\//u);
    expect(code(HANDLER)).not.toMatch(/Response\.redirect/u);
  });

  it('la respuesta del POST no se cachea', () => {
    expect(code(HANDLER)).toMatch(/'cache-control':\s*'no-store'/u);
  });

  it('el error de Postgres no cruza al cliente ni por cuerpo ni por status', () => {
    const body = code(HANDLER);
    // El `catch` no tiene binding: no hay ninguna variable de error que se pueda devolver por
    // accidente. Y no se construye ninguna respuesta con cuerpo.
    expect(body).toMatch(/\}\s*catch\s*\{/u);
    expect(body).not.toMatch(/catch\s*\(/u);
    expect(body).toMatch(/new Response\(null,/u);
    expect(body).not.toMatch(/new Response\((?!null,)/u);
  });

  it('no loguea NADA: el body trae nombre y teléfono de una persona real', () => {
    expect(code(HANDLER)).not.toMatch(/console\./u);
    expect(code(FORM)).not.toMatch(/console\./u);
  });

  it('no revalida ningún tag: un lead de canje no cambia un byte de la vidriera', () => {
    expect(code(HANDLER)).not.toMatch(/revalidateTag|updateTag|revalidatePath/u);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  4 · El parser del borde, corriendo de verdad
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Un envío legítimo mínimo: los tres campos obligatorios y nada más. */
const minimal = new URLSearchParams({
  [TRADEIN_FIELDS.customerName]: 'Gimena Paredes',
  [TRADEIN_FIELDS.customerWaPhone]: '+54 9 299 415-3388',
  [TRADEIN_FIELDS.modelText]: 'iPhone 12',
});

const body = (over: Record<string, string> = {}): string => {
  const p = new URLSearchParams(minimal);
  for (const [k, v] of Object.entries(over)) p.set(k, v);
  return p.toString();
};

describe('normalizeWaPhone', () => {
  it('deja dígitos y un `+` adelante', () => {
    expect(normalizeWaPhone('+54 9 299 415-3388')).toBe('+5492994153388');
  });

  it('un número local se guarda como lo escribió la persona, sin inventarle prefijo de país', () => {
    expect(normalizeWaPhone('(0299) 15 415 3388')).toBe('0299154153388');
  });

  it('un `+` en el medio es basura y se cae con el resto', () => {
    expect(normalizeWaPhone('299+415')).toBe('299415');
  });

  it('no valida que el número exista: 6 dígitos es un teléfono para este borde', () => {
    expect(normalizeWaPhone('4153388')).toBe('4153388');
  });
});

describe('parseTradeinBody: qué entra', () => {
  it('los tres obligatorios alcanzan; los cinco opcionales quedan en null', () => {
    expect(parseTradeinBody(body())).toEqual({
      customerName: 'Gimena Paredes',
      customerWaPhone: '+5492994153388',
      modelText: 'iPhone 12',
      storageGb: null,
      color: null,
      declaredCondition: null,
      batteryPct: null,
      notes: null,
    });
  });

  it('un campo opcional en blanco es null, no un string vacío', () => {
    const lead = parseTradeinBody(
      body({ [TRADEIN_FIELDS.color]: '   ', [TRADEIN_FIELDS.notes]: '' }),
    );
    expect(lead?.color).toBeNull();
    expect(lead?.notes).toBeNull();
  });

  it('acepta las cinco condiciones del catálogo y ninguna inventada', () => {
    for (const condition of CONDITIONS) {
      const lead = parseTradeinBody(body({ [TRADEIN_FIELDS.declaredCondition]: condition }));
      expect(lead?.declaredCondition).toBe(condition);
    }
    expect(parseTradeinBody(body({ [TRADEIN_FIELDS.declaredCondition]: 'roto' }))).toBeNull();
  });

  it('los números llegan como texto del formulario y salen como enteros', () => {
    const lead = parseTradeinBody(
      body({ [TRADEIN_FIELDS.storageGb]: '128', [TRADEIN_FIELDS.batteryPct]: '87' }),
    );
    expect(lead?.storageGb).toBe(128);
    expect(lead?.batteryPct).toBe(87);
  });

  it('el nombre y el modelo se recortan: un espacio de más no es un campo de más', () => {
    const lead = parseTradeinBody(body({ [TRADEIN_FIELDS.customerName]: '  Gimena  ' }));
    expect(lead?.customerName).toBe('Gimena');
  });
});

describe('parseTradeinBody: qué NO entra', () => {
  it('cada límite, en su borde exacto: uno adentro pasa, uno afuera no', () => {
    const cases: Array<[string, number]> = [
      [TRADEIN_FIELDS.customerName, TRADEIN_LIMITS.customerName.max],
      [TRADEIN_FIELDS.modelText, TRADEIN_LIMITS.modelText.max],
      [TRADEIN_FIELDS.color, TRADEIN_LIMITS.color.max],
      [TRADEIN_FIELDS.notes, TRADEIN_LIMITS.notes.max],
    ];
    for (const [field, max] of cases) {
      expect(parseTradeinBody(body({ [field]: 'a'.repeat(max) })), `${field} en ${max}`).not.toBeNull();
      expect(parseTradeinBody(body({ [field]: 'a'.repeat(max + 1) })), `${field} en ${max + 1}`).toBeNull();
    }
  });

  it('el teléfono se mide DESPUÉS de normalizar, que es como lo mide el motor', () => {
    const max = TRADEIN_LIMITS.customerWaPhone.max;
    // 25 dígitos entran; 26 no. Y los espacios no cuentan, porque no se guardan.
    expect(parseTradeinBody(body({ [TRADEIN_FIELDS.customerWaPhone]: '1'.repeat(max) }))).not.toBeNull();
    expect(parseTradeinBody(body({ [TRADEIN_FIELDS.customerWaPhone]: '1'.repeat(max + 1) }))).toBeNull();
    expect(
      parseTradeinBody(body({ [TRADEIN_FIELDS.customerWaPhone]: '1 '.repeat(max).trim() })),
    ).not.toBeNull();
  });

  it('un teléfono más corto que el mínimo no entra', () => {
    expect(
      parseTradeinBody(
        body({ [TRADEIN_FIELDS.customerWaPhone]: '1'.repeat(TRADEIN_LIMITS.customerWaPhone.min - 1) }),
      ),
    ).toBeNull();
  });

  it('los rangos numéricos, en su borde', () => {
    const b = TRADEIN_LIMITS.batteryPct;
    const s = TRADEIN_LIMITS.storageGb;
    expect(parseTradeinBody(body({ [TRADEIN_FIELDS.batteryPct]: String(b.max) }))).not.toBeNull();
    expect(parseTradeinBody(body({ [TRADEIN_FIELDS.batteryPct]: String(b.max + 1) }))).toBeNull();
    expect(parseTradeinBody(body({ [TRADEIN_FIELDS.batteryPct]: String(b.min - 1) }))).toBeNull();
    expect(parseTradeinBody(body({ [TRADEIN_FIELDS.storageGb]: String(s.max + 1) }))).toBeNull();
    expect(parseTradeinBody(body({ [TRADEIN_FIELDS.storageGb]: String(s.min - 1) }))).toBeNull();
    expect(parseTradeinBody(body({ [TRADEIN_FIELDS.storageGb]: '128.5' }))).toBeNull();
    expect(parseTradeinBody(body({ [TRADEIN_FIELDS.storageGb]: 'ciento veintiocho' }))).toBeNull();
  });

  it('faltando un obligatorio no entra nada', () => {
    for (const field of [
      TRADEIN_FIELDS.customerName,
      TRADEIN_FIELDS.customerWaPhone,
      TRADEIN_FIELDS.modelText,
    ]) {
      const p = new URLSearchParams(minimal);
      p.delete(field);
      expect(parseTradeinBody(p.toString()), `sin ${field}`).toBeNull();
    }
  });

  it('una clave de más se rechaza entera: `.strict()`, no `passthrough`', () => {
    expect(parseTradeinBody(body({ tenant_id: 'otro-tenant' }))).toBeNull();
    expect(parseTradeinBody(body({ status: 'accepted' }))).toBeNull();
    expect(parseTradeinBody(body({ offer_usd: '1' }))).toBeNull();
  });

  it('el esquema es `.strict()` y no hay ninguna puerta abierta', () => {
    const schema = read('_lib/tradein-form.ts');
    expect(code(schema)).toMatch(/\.strict\(\)/u);
    expect(code(schema)).not.toMatch(/passthrough\(|looseObject\(|\.catchall\(/u);
  });

  it('un body vacío, o más largo que el techo, no se parsea', () => {
    expect(parseTradeinBody('')).toBeNull();
    expect(parseTradeinBody('a'.repeat(MAX_TRADEIN_BODY_CHARS + 1))).toBeNull();
  });

  it('el techo del body deja pasar el peor envío legítimo', () => {
    const worst = body({
      [TRADEIN_FIELDS.customerName]: 'ñ'.repeat(TRADEIN_LIMITS.customerName.max),
      [TRADEIN_FIELDS.modelText]: 'ñ'.repeat(TRADEIN_LIMITS.modelText.max),
      [TRADEIN_FIELDS.color]: 'ñ'.repeat(TRADEIN_LIMITS.color.max),
      [TRADEIN_FIELDS.notes]: 'ñ'.repeat(TRADEIN_LIMITS.notes.max),
      [TRADEIN_FIELDS.storageGb]: '4096',
      [TRADEIN_FIELDS.batteryPct]: '100',
      [TRADEIN_FIELDS.declaredCondition]: CONDITIONS[0],
    });
    expect(worst.length).toBeLessThanOrEqual(MAX_TRADEIN_BODY_CHARS);
    expect(parseTradeinBody(worst)).not.toBeNull();
  });

  it('una clave repetida se queda con la primera y no concatena', () => {
    const lead = parseTradeinBody(`${body()}&${TRADEIN_FIELDS.color}=negro&${TRADEIN_FIELDS.color}=azul`);
    expect(lead?.color).toBe('negro');
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  5 · El formulario: HTML puro, y los mismos números que el server
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('el formulario no manda JavaScript y no puede divergir del borde', () => {
  it('es un POST nativo al endpoint con path propio, no una Server Action', () => {
    expect(code(FORM)).toMatch(/method="post"/u);
    expect(code(FORM)).toMatch(/action=\{TRADEIN_ENDPOINT_PATH\}/u);
    expect(code(FORM)).not.toMatch(/['"]use (client|server)['"]/u);
  });

  it('los `maxlength` y los rangos salen de TRADEIN_LIMITS, no de números tipeados', () => {
    // Un número literal en un atributo de tamaño es exactamente la divergencia que este módulo
    // existe para impedir: el formulario dejaría escribir algo que el server rechaza sin decir por
    // qué. `rows` y `step` quedan afuera: no son límites de validación.
    const attrs = [...code(FORM).matchAll(/(maxLength|min|max)=\{([^}]*)\}/gu)];
    expect(attrs.length).toBeGreaterThanOrEqual(8);
    for (const [, attr, value] of attrs) {
      expect(value, `${attr}={${value}}`).toMatch(/^L\./u);
    }
  });

  it('los `name` de los campos son los del borde, no strings sueltos', () => {
    for (const field of Object.keys(TRADEIN_FIELDS)) {
      expect(code(FORM)).toMatch(new RegExp(`name=\\{TRADEIN_FIELDS\\.${field}\\}`, 'u'));
    }
  });

  it('el botón de enviar NO tiene `name`: con `.strict()`, una clave de más rompe el envío', () => {
    const button = /<button[\s\S]*?>/u.exec(code(FORM))?.[0] ?? '';
    expect(button).toMatch(/type="submit"/u);
    expect(button).not.toMatch(/\bname=/u);
  });

  it('no pide precio ni identificador de hardware (CLAUDE.md §0.8 y §0.9)', () => {
    expect(code(FORM)).not.toMatch(/\b(imei|serial|precio|price|usd)\b/iu);
  });

  it('no pide mail: lo que sigue es un WhatsApp, y un dato que no se usa no se pide', () => {
    expect(code(FORM)).not.toMatch(/type="email"|autoComplete="email"/u);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  6 · Las tres páginas: cacheadas, con el slug en el key, y sin el tag del catálogo
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('las páginas del canje se sirven como el resto de la vidriera', () => {
  for (const { rel, src } of PAGES) {
    describe(rel, () => {
      it('tiene generateStaticParams: sin eso la ruta vuelve a modo postponed', () => {
        expect(code(src)).toMatch(/export async function generateStaticParams\(/u);
      });

      it('cuerpo y metadata están cacheados, cada uno con su perfil explícito', () => {
        expect(code(src).match(/'use cache'/gu) ?? []).toHaveLength(2);
        expect(code(src)).toMatch(/cacheLife\('max'\)/u);
        expect(code(src)).toMatch(/cacheStorefrontMiss\(\)/u);
      });

      it('el slug entra al cache key por `params` y a los tags, nunca por un header', () => {
        expect(code(src)).toMatch(/await params/u);
        expect(code(src)).toMatch(/cacheTag\(tenantConfigTag\(slug\)\)/u);
        expect(code(src)).not.toMatch(/request\.headers|\b(headers|cookies|draftMode)\s*\(\s*\)/u);
      });

      it('valida la forma del slug ANTES de registrar ningún tag', () => {
        const body = code(src);
        const guard = body.indexOf('isSlugShaped(slug)');
        const tag = body.indexOf('cacheTag(');
        expect(guard).toBeGreaterThan(-1);
        expect(guard).toBeLessThan(tag);
      });

      it('el tag del catálogo se registra SÓLO en el camino del miss (lección S6.1)', () => {
        // Un tag es un OR: si el camino positivo registrara `storefront:{slug}`, reservar una
        // unidad purgaría también estas páginas, que no muestran ni un equipo. Cada
        // `cacheTag(storefrontTag(...))` tiene que venir inmediatamente después de un
        // `cacheStorefrontMiss()`.
        const lines = code(src)
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 0);
        const hits = lines
          .map((l, i) => [l, i] as const)
          .filter(([l]) => l.includes('storefrontTag('));
        expect(hits.length).toBeGreaterThan(0);
        for (const [, i] of hits) {
          expect(lines[i - 1]).toBe('cacheStorefrontMiss();');
        }
      });

      it('la vidriera que no existe se contesta con contenido, no con notFound() (ADR-011)', () => {
        expect(code(src)).toMatch(/<StorefrontMiss \/>/u);
        expect(code(src)).not.toMatch(/notFound\(/u);
      });

      it('no se indexa: es un formulario sin stock, y le competiría posiciones a las fichas', () => {
        expect(code(src)).toMatch(/index: false/u);
        // Y la directiva viaja SOLDADA AL CUERPO además de en la metadata, porque cuerpo y
        // metadata son dos entradas de cache distintas (mismo argumento que `storefront-miss`).
        // La página del formulario emite el `<meta>` ella misma; las dos de resultado lo heredan
        // de `<TradeinOutcome>`, que es donde vive su casco.
        const inline = /name="robots"/u.test(code(src));
        const viaShell = /<TradeinOutcome/u.test(code(src));
        expect(inline || viaShell).toBe(true);
      });
    });
  }

  it('el casco de las pantallas de resultado emite el `noindex` con el cuerpo', () => {
    expect(code(read('_components/tradein-outcome.tsx'))).toMatch(
      /<meta name="robots" content="noindex, follow" \/>/u,
    );
  });

  it('la página del formulario respeta el interruptor del dueño', () => {
    const page = PAGES.find((p) => p.rel === PAGE_REL)?.src ?? '';
    expect(code(page)).toMatch(/tenant\.acceptsTradeIn/u);
  });

  it('ninguna página del canje emite un `wa.me`: el único de la vidriera vive en la ficha', () => {
    for (const { rel, src } of PAGES) {
      expect(code(src), rel).not.toMatch(/wa\.me|waUrl/u);
    }
    expect(code(FORM)).not.toMatch(/wa\.me|waUrl/u);
  });

  it('ninguna página ni el formulario importan la base de datos', () => {
    for (const { rel, src } of [...PAGES, { rel: FORM_REL, src: FORM }]) {
      expect(code(src), rel).not.toMatch(/@istock\/db|drizzle|postgres/u);
    }
  });
});
