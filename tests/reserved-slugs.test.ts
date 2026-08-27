/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  UNA SOLA LISTA DE SLUGS RESERVADOS. Owner: `qa-agent`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Hoy la lista de reservados existe **dos veces**, escrita por dos owners distintos:
 *
 *   - `apps/web/app/(app)/_lib/slug-format.ts`      → `RESERVED_SLUGS`      (app-agent)
 *     decide **qué slug se puede registrar** en el alta del negocio.
 *   - `apps/web/app/(storefront)/_lib/host.ts`      → `RESERVED_SUBDOMAINS` (storefront-agent)
 *     decide **qué subdominio nunca es una vidriera** y se va a marketing.
 *
 * `scripts/guard-leaks.sh` regla 14 ya vigila que el **regex** de slug no diverja entre owners.
 * La **lista de reservados** no la vigila nadie, y las dos listas ya divergen: el proxy manda
 * `not-a-tenant.maat.work` a marketing (es el `PRERENDER_SEED_SLUG`) y el panel deja registrar
 * ese mismo slug. Quien lo registre paga un plan y **no tiene vidriera**: no falla nada, no hay
 * error, simplemente su link no muestra su negocio nunca.
 *
 * Esa es la clase de bug que este archivo existe para agarrar: **no rompe el build, no rompe un
 * test unitario de nadie, y aparece con el primer cliente.**
 *
 * Contrato que se le pide a `domain-agent` (`packages/domain`, TS puro, sin I/O):
 *   1. `@istock/domain` exporta la lista **canónica** (`RESERVED_SLUGS`).
 *   2. `(app)` y `(storefront)` la **importan**; ninguno declara la suya.
 *   3. Todo subdominio que el proxy manda a marketing es **imposible de registrar**.
 *
 * `qa-agent` no arregla el código bajo test. Si esto se pone rojo, el defecto es de la impl.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { slugSchema } from '../apps/web/app/(app)/_lib/slug';
import { PRERENDER_SEED_SLUG, resolveHost } from '../apps/web/app/(storefront)/_lib/host';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP_SLUG_FORMAT = join(REPO, 'apps/web/app/(app)/_lib/slug-format.ts');
const STOREFRONT_HOST = join(REPO, 'apps/web/app/(storefront)/_lib/host.ts');
const DOMAIN_SRC = join(REPO, 'packages/domain/src');

/** Dominio real de la vidriera. Se resuelve `{label}.maat.work` como en producción. */
const ROOT_DOMAIN = 'maat.work';

// ── utilidades ────────────────────────────────────────────────────────────────────────────────

function canRegister(slug: string): boolean {
  return slugSchema.safeParse(slug).success;
}

/** `www.maat.work` → `'marketing' | 'storefront' | 'not-found'`. */
function hostKind(label: string): string {
  return resolveHost(`${label}.${ROOT_DOMAIN}`, { rootDomain: ROOT_DOMAIN }).kind;
}

/** Acepta `Set<string>` o `readonly string[]`: el contrato es la lista, no el contenedor. */
function asLabels(value: unknown): readonly string[] | null {
  if (value instanceof Set) {
    const items = [...value];
    return items.every((item) => typeof item === 'string') ? (items as string[]) : null;
  }
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value as string[];
  }
  return null;
}

/**
 * Comentarios fuera. Un comentario que **nombra** la lista no es una segunda lista, y tratarlo
 * como tal entrena al equipo a borrar justo el comentario que explica el peligro.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, ' ').replace(/^[ \t]*\/\/.*$/gmu, ' ');
}

/** Literales de string de una sola palabra: `'www'`, `"cdn"`. */
function stringLiterals(source: string): readonly string[] {
  const out: string[] = [];
  for (const match of stripComments(source).matchAll(/['"]([a-z][a-z0-9-]{0,30})['"]/gu)) {
    const value = match[1];
    if (value !== undefined) out.push(value);
  }
  return out;
}

/**
 * Sonda: nombres de infraestructura que **cualquier** lista de reservados de este producto tiene
 * que contener. Un archivo que menciona 8 de estos 12 como literales no está "usando la lista":
 * la está **declarando**.
 */
const INFRA_PROBE = [
  'www', 'api', 'cdn', 'admin', 'mail', 'smtp', 'ns1', 'ns2', 'dns', 'static', 'assets', 'staging',
] as const;
const DECLARES_LIST_THRESHOLD = 8;

function declaresOwnList(file: string): number {
  const literals = new Set(stringLiterals(readFileSync(file, 'utf8')));
  return INFRA_PROBE.filter((name) => literals.has(name)).length;
}

function tsFilesIn(dir: string): readonly string[] {
  return readdirSync(dir)
    .map((entry) => join(dir, entry))
    .filter((path) => statSync(path).isFile() && path.endsWith('.ts') && !path.endsWith('.test.ts'));
}

/** Segmentos de ruta de primer nivel que el producto ya usa (`/app`, `/precios`, `/s`, `/api`…). */
function productRouteSegments(): readonly string[] {
  const appDir = join(REPO, 'apps/web/app');
  const segments = new Set<string>();

  const walkGroup = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (!statSync(path).isDirectory()) continue;
      // Route groups `(app)` / `(marketing)` no agregan segmento a la URL: se atraviesan.
      if (entry.startsWith('(') && entry.endsWith(')')) {
        walkGroup(path);
        continue;
      }
      // `_lib`, `[slug]`, `@modal`: no son segmentos literales de URL.
      if (entry.startsWith('_') || entry.startsWith('[') || entry.startsWith('@')) continue;
      segments.add(entry);
    }
  };

  walkGroup(appDir);
  return [...segments];
}

// ── 1 · una sola fuente ───────────────────────────────────────────────────────────────────────

describe('la lista de slugs reservados tiene UNA sola fuente de verdad', () => {
  it('la lista canónica la exporta `@istock/domain`, que es el único paquete que la puede tener', async () => {
    const domain = (await import('@istock/domain')) as Record<string, unknown>;

    const labels = asLabels(domain['RESERVED_SLUGS']);
    expect(
      labels,
      '`@istock/domain` tiene que exportar `RESERVED_SLUGS` (Set o array de strings). ' +
        'Hoy la lista vive duplicada en (app) y en (storefront), y ya divergió.',
    ).not.toBeNull();

    // No alcanza con que el export exista: tiene que ser la lista de verdad.
    const set = new Set(labels ?? []);
    for (const name of ['www', 'api', 'app', 'admin', 'cdn', 'login', 'soporte']) {
      expect(set.has(name), `\`${name}\` tiene que estar en la lista canónica`).toBe(true);
    }
    expect(set.size).toBeGreaterThanOrEqual(50);
  });

  it('ningún owner de `apps/web` declara su propia copia de la lista', () => {
    const appHits = declaresOwnList(APP_SLUG_FORMAT);
    const storefrontHits = declaresOwnList(STOREFRONT_HOST);

    expect(
      appHits,
      `${APP_SLUG_FORMAT} declara su propia lista de reservados (${appHits}/${INFRA_PROBE.length} ` +
        'nombres de infraestructura como literales). Tiene que importarla de `@istock/domain`.',
    ).toBeLessThan(DECLARES_LIST_THRESHOLD);

    expect(
      storefrontHits,
      `${STOREFRONT_HOST} declara su propia lista de reservados (${storefrontHits}/${INFRA_PROBE.length}). ` +
        'Tiene que importarla de `@istock/domain`.',
    ).toBeLessThan(DECLARES_LIST_THRESHOLD);
  });

  it('dentro de `packages/domain` la lista está declarada una sola vez', () => {
    const declaring = tsFilesIn(DOMAIN_SRC).filter(
      (file) => declaresOwnList(file) >= DECLARES_LIST_THRESHOLD,
    );
    expect(
      declaring,
      'la lista canónica se declara en exactamente un archivo de packages/domain/src',
    ).toHaveLength(1);
  });
});

// ── 2 · las dos caras de la lista no pueden divergir ─────────────────────────────────────────

describe('un subdominio que no es vidriera tampoco puede ser un negocio', () => {
  it('el slug semilla del prerender no lo puede registrar nadie', () => {
    // `PRERENDER_SEED_SLUG` es el slug que `/s/[slug]` prerenderiza en el build y que el proxy
    // manda a marketing. Si alguien lo registra: paga, y su vidriera no existe nunca.
    expect(hostKind(PRERENDER_SEED_SLUG)).toBe('marketing');
    expect(
      canRegister(PRERENDER_SEED_SLUG),
      `el panel deja registrar "${PRERENDER_SEED_SLUG}", que el proxy nunca rutea a una vidriera`,
    ).toBe(false);
  });

  it('todo nombre de la lista canónica que el proxy manda a marketing es irregistrable', async () => {
    const domain = (await import('@istock/domain')) as Record<string, unknown>;
    const canonical = asLabels(domain['RESERVED_SLUGS']) ?? [];

    // Universo de prueba: la lista canónica (cuando exista) + el semilla + la sonda de infra.
    const universe = new Set<string>([...canonical, PRERENDER_SEED_SLUG, ...INFRA_PROBE]);

    const leaks = [...universe].filter(
      (label) => hostKind(label) === 'marketing' && canRegister(label),
    );

    expect(
      leaks,
      'estos slugs se pueden registrar pero su subdominio nunca sirve una vidriera: ' +
        'el dueño paga y su link no muestra su negocio',
    ).toEqual([]);
  });

  it('`www`, `app` y `api` nunca resuelven a una vidriera, aunque alguien insista', () => {
    for (const label of ['www', 'app', 'api', 'admin']) {
      expect(hostKind(label), `${label}.${ROOT_DOMAIN}`).toBe('marketing');
      expect(canRegister(label)).toBe(false);
    }
  });

  it('`demo` es la excepción declarada: tiene vidriera propia y no se registra desde el panel', () => {
    // El tenant demo (S13) existe en la base y `demo.maat.work` tiene que servir su vidriera,
    // pero ningún cliente puede quedarse con ese nombre. Es la única asimetría legítima y por eso
    // está acá: una unificación ingenua de las dos listas la rompe en silencio.
    expect(hostKind('demo')).toBe('storefront');
    expect(canRegister('demo')).toBe(false);
  });
});

// ── 3 · ninguna ruta del producto se puede registrar ─────────────────────────────────────────

describe('ninguna ruta del producto se puede perder contra un slug de tenant', () => {
  it('cada segmento de ruta que existe hoy en apps/web/app está reservado', () => {
    const segments = productRouteSegments().filter((segment) => segment.length >= 3);
    // Control: si el walker deja de encontrar rutas, la aserción sería verde por vacío.
    expect(segments.length, 'el walker de rutas no encontró ninguna ruta').toBeGreaterThanOrEqual(3);

    const registrable = segments.filter((segment) => canRegister(segment));
    expect(
      registrable,
      'estas rutas del producto se pueden registrar como slug de tenant',
    ).toEqual([]);
  });

  it('el segmento del rewrite de la vidriera (`/s/{slug}`) está reservado', () => {
    // `s` mide 1 carácter: el regex de slug ya lo rechaza. La aserción es sobre el resultado,
    // no sobre el motivo — el día que el mínimo baje a 1, esto tiene que seguir en rojo.
    expect(canRegister('s')).toBe(false);
  });
});
