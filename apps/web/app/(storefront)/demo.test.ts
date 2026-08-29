/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  S13 · `/demo` lleva a la vidriera del tenant demo, y NINGÚN host sirve la vidriera de otro
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Este archivo ejercita `proxy()` **de verdad** (no lee el fuente): `next/server` sí está instalado
 * en `apps/web`, así que acá se puede correr la función que en `tests/` sólo se puede grepear.
 *
 * Tres bloques, y el del medio es el que justifica la slice:
 *
 * 1. **El alias existe.** `maat.work/demo` → `308` a `demo.maat.work/`, con el host destino
 *    derivado del host entrante (producción, `nip.io` de los e2e, `localhost` de dev).
 * 2. **AISLAMIENTO — el invariante que se falsificó a mano.** Ningún host sirve, redirige ni
 *    reescribe la vidriera de un slug distinto al suyo. Se afirma como **propiedad sobre una
 *    matriz** de hosts × paths, no como tres casos elegidos: *si la respuesta es un rewrite, el
 *    slug del path destino es el del host; si es un redirect, el host de origen era marketing y el
 *    destino es el demo*. Falsificado moviendo `isDemoAliasPath()` arriba de `resolveHost()` en
 *    `proxy.ts` — la mutación que un lector apurado haría — y verificando que enciende.
 * 3. **El literal `'demo'` está atado a `@istock/domain`.** `DEMO_TENANT_SLUG` es una copia (el
 *    lugar canónico es `packages/domain`, que no es de esta columna), así que las tres propiedades
 *    que la vuelven correcta se afirman acá y no se prometen en un comentario.
 *
 * ## Lo que este archivo NO prueba, para que nadie confunda cobertura con afirmación
 *
 * | invariante | quién lo mide |
 * |---|---|
 * | el `308` sale con ese `Location` desde un server real | requiere `next build` · lo corre el LEAD |
 * | el tenant demo tiene stock y fotos propias, cero filas de un tenant real | `packages/db` (seed) + `tests/rls-cross-tenant.test.ts` |
 * | el hit a `demo.<apex>/` no toca Postgres | `_lib/tenant.ts` (`cacheLife('max')`) + ADR-012; acá sólo se afirma que el ALIAS no invoca la app |
 */

import { describe, expect, it } from 'vitest';
import { NextRequest, type NextResponse } from 'next/server';
import {
  RESERVED_SLUGS,
  RESERVED_SUBDOMAINS,
  TENANT_SERVED_RESERVED_SLUGS,
  isSlugShaped,
} from '@istock/domain';
import { proxy } from '../../proxy';
import {
  DEMO_ALIAS_PATH,
  DEMO_TENANT_SLUG,
  demoAliasTargetPath,
  isDemoAliasPath,
  resolveHost,
  tenantHostFor,
} from './_lib/host';

/** Lo que el proxy decidió, en los cuatro verbos que sabe emitir. */
type Outcome =
  | { readonly kind: 'redirect'; readonly status: number; readonly location: string }
  | { readonly kind: 'rewrite'; readonly to: string }
  | { readonly kind: 'passthrough' }
  | { readonly kind: 'blocked'; readonly status: number };

function outcomeOf(res: NextResponse): Outcome {
  const location = res.headers.get('location');
  if (location !== null) return { kind: 'redirect', status: res.status, location };
  const rewrite = res.headers.get('x-middleware-rewrite');
  if (rewrite !== null) return { kind: 'rewrite', to: rewrite };
  if (res.status >= 400) return { kind: 'blocked', status: res.status };
  return { kind: 'passthrough' };
}

/**
 * Corre el proxy como lo corre Next: el `host` va **en el header**, que es de donde lo lee
 * `resolveHost`, y también en la URL, que es de donde sale `nextUrl`. Que las dos coincidan es
 * justamente lo que pasa en producción.
 */
function run(host: string, path: string, scheme: 'http' | 'https' = 'http'): Outcome {
  const url = new URL(`${scheme}://${host}${path}`);
  const request = new NextRequest(url, { headers: { host } });
  return outcomeOf(proxy(request));
}

/** Hosts que sirven marketing y **sí** tienen un subdominio de tenant al lado. */
const APEX_CON_WILDCARD: ReadonlyArray<readonly [entrante: string, demo: string]> = [
  ['maat.work', 'demo.maat.work'],
  ['www.maat.work', 'demo.maat.work'],
  // Un reservado cualquiera: el proxy ya lo manda a marketing, y el alias tiene que seguir andando.
  ['app.maat.work', 'demo.maat.work'],
  ['MAAT.WORK', 'demo.maat.work'],
  // Los dos hosts de desarrollo que el repo usa de verdad: `nip.io` para abrir la vidriera desde un
  // celular real (mobile-first) y `localhost` para el `next dev` de todos los días.
  ['127.0.0.1.nip.io', 'demo.127.0.0.1.nip.io'],
  ['127-0-0-1.nip.io', 'demo.127-0-0-1.nip.io'],
  ['127.0.0.1.nip.io:3100', 'demo.127.0.0.1.nip.io'],
  ['localhost', 'demo.localhost'],
  ['localhost:3000', 'demo.localhost'],
  ['ajustes.localhost', 'demo.localhost'],
];

/**
 * Hosts que sirven marketing y **no** tienen dónde vivir la vidriera del demo.
 *
 * No es una lista de rarezas: `*.vercel.app` es cada preview deploy del proyecto (el wildcard
 * `*.maat.work` no lo cubre y el certificado tampoco), y `127.0.0.1` pelado es cómo la mitad de la
 * gente abre `next dev`. En los dos casos el alias tiene que **no existir**, no inventar un
 * `Location` a un host que no resuelve.
 */
const APEX_SIN_WILDCARD: readonly string[] = [
  'istock-git-main-maatwork.vercel.app',
  'istock.vercel.app',
  '127.0.0.1',
  '127.0.0.1:3000',
  '0.0.0.0:3000',
  '[::1]:3000',
  'midominio-custom.com',
];

/** Slugs de tenants de verdad, para el bloque de aislamiento. */
const TENANTS = ['acme', 'celu-cipo', 'alto-valle-phones'] as const;

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  1 · el alias existe, y su destino se deriva del host entrante
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('S13 · `/demo` bajo el apex redirige a la vidriera del tenant demo', () => {
  it('`308` permanente a `demo.<apex>/`, en producción y en los dos hosts de desarrollo', () => {
    for (const [entrante, esperado] of APEX_CON_WILDCARD) {
      const outcome = run(entrante, DEMO_ALIAS_PATH);
      expect(outcome.kind, `${entrante}${DEMO_ALIAS_PATH}`).toBe('redirect');
      if (outcome.kind !== 'redirect') continue;
      // Permanente a propósito: el costo de la permanencia está declarado en `_lib/host.ts`.
      expect(outcome.status, entrante).toBe(308);
      expect(new URL(outcome.location).hostname, entrante).toBe(esperado);
      expect(new URL(outcome.location).pathname, entrante).toBe('/');
    }
  });

  it('preserva puerto, esquema y querystring: el `?utm_source` del link a un prospecto no se pierde', () => {
    const conPuerto = run('127.0.0.1.nip.io:3100', `${DEMO_ALIAS_PATH}?utm_source=ig&utm_campaign=alto-valle`);
    expect(conPuerto.kind).toBe('redirect');
    if (conPuerto.kind === 'redirect') {
      const url = new URL(conPuerto.location);
      expect(url.port).toBe('3100');
      expect(url.protocol).toBe('http:');
      expect(url.search).toBe('?utm_source=ig&utm_campaign=alto-valle');
      expect(url.host).toBe('demo.127.0.0.1.nip.io:3100');
    }

    const prod = run('maat.work', DEMO_ALIAS_PATH, 'https');
    expect(prod.kind).toBe('redirect');
    if (prod.kind === 'redirect') {
      // Un `Location` con el esquema equivocado en un `308` es un downgrade permanente cacheado
      // por el browser: por eso el esquema se preserva y no se escribe a mano.
      expect(prod.location).toBe('https://demo.maat.work/');
    }
  });

  it('el alias es TOTAL, no sólo la home: `/demo/p/{ficha}` y `/demo/canje` aterrizan donde corresponde', () => {
    const casos: ReadonlyArray<readonly [string, string]> = [
      [`${DEMO_ALIAS_PATH}/`, '/'],
      [`${DEMO_ALIAS_PATH}/p/iphone-14-pro-256-grafito`, '/p/iphone-14-pro-256-grafito'],
      [`${DEMO_ALIAS_PATH}/canje`, '/canje'],
      [`${DEMO_ALIAS_PATH}/canje/listo`, '/canje/listo'],
    ];
    for (const [entra, sale] of casos) {
      const outcome = run('maat.work', entra, 'https');
      expect(outcome.kind, entra).toBe('redirect');
      if (outcome.kind === 'redirect') expect(outcome.location, entra).toBe(`https://demo.maat.work${sale}`);
    }
  });

  it('el corte es por SEGMENTO: `/demostracion` y `/demo-viejo` no son el alias', () => {
    // Es la discrepancia sufijo/segmento que ya produjo cuatro agujeros en el `matcher` (S1, S2,
    // P2, S8). Acá se escribe del lado correcto desde el principio.
    for (const path of ['/demostracion', '/demo-viejo', '/demos', '/undemo', '/precios']) {
      expect(isDemoAliasPath(path), path).toBe(false);
      expect(run('maat.work', path).kind, path).toBe('passthrough');
    }
    expect(isDemoAliasPath(DEMO_ALIAS_PATH)).toBe(true);
    expect(isDemoAliasPath(`${DEMO_ALIAS_PATH}/p/x`)).toBe(true);
  });

  it('donde no hay subdominio de tenant no hay alias: se pasa derecho, nunca un `Location` muerto', () => {
    for (const host of APEX_SIN_WILDCARD) {
      expect(tenantHostFor(host, DEMO_TENANT_SLUG), host).toBeNull();
      const outcome = run(host, DEMO_ALIAS_PATH);
      // Passthrough → el 404 de la app. Honesto: en ese setup la vidriera del demo no existe.
      expect(outcome.kind, host).toBe('passthrough');
    }
  });

  it('un host malformado sigue siendo 404 del proxy: el alias no le abre una puerta', () => {
    for (const host of ['Foo_Bar.maat.work', 'a.b.maat.work', 'ab.maat.work']) {
      const outcome = run(host, DEMO_ALIAS_PATH);
      expect(outcome.kind, host).toBe('blocked');
      if (outcome.kind === 'blocked') expect(outcome.status, host).toBe(404);
    }
  });

  it('`/s/demo` sigue siendo 404: el alias no abrió una segunda URL canónica del demo', () => {
    // `isStorefrontInternalPath` corta `/s/**` en cualquier host. Si el alias hubiera sido un
    // rewrite a `/s/demo`, esta regla habría tenido que aflojarse — y con ella la única URL
    // canónica por tenant.
    for (const host of ['maat.work', 'demo.maat.work', 'acme.maat.work']) {
      const outcome = run(host, `/s/${DEMO_TENANT_SLUG}`);
      expect(outcome.kind, host).toBe('blocked');
    }
  });

  it('`demoAliasTargetPath` no se deja llamar con un path que no es el alias', () => {
    expect(() => demoAliasTargetPath('/precios')).toThrow(/no es el alias/u);
    expect(() => demoAliasTargetPath('/demostracion')).toThrow(/no es el alias/u);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  2 · AISLAMIENTO · ningún host sirve la vidriera de otro slug. Es el gate de la slice.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** El slug que el proxy le está sirviendo a un rewrite `/s/{slug}/...`. */
function slugDelRewrite(to: string): string | null {
  const match = /^\/s\/([^/?#]+)/u.exec(new URL(to).pathname);
  return match?.[1] ?? null;
}

describe('S13 · aislamiento · el demo no se sirve bajo el host de otro tenant, ni al revés', () => {
  /**
   * La matriz. Se cruzan **todos** los hosts con **todos** los paths sensibles, y se afirma la
   * propiedad, no el caso: un test de tres ejemplos elegidos a mano no habría visto la mutación.
   */
  const PATHS = [
    '/',
    DEMO_ALIAS_PATH,
    `${DEMO_ALIAS_PATH}/`,
    `${DEMO_ALIAS_PATH}/p/iphone-14-pro-256-grafito`,
    `${DEMO_ALIAS_PATH}/canje`,
    '/p/iphone-14-pro-256-grafito',
    '/canje',
  ] as const;

  it('bajo el host de un tenant, `/demo` es un path de ESE tenant y nunca un redirect al demo', () => {
    for (const slug of TENANTS) {
      for (const apexDeTenant of ['maat.work', '127.0.0.1.nip.io:3100', 'localhost:3000']) {
        const host = `${slug}.${apexDeTenant}`;
        for (const path of PATHS) {
          const outcome = run(host, path);
          const etiqueta = `${host}${path}`;

          // (a) NUNCA un redirect. Un `Location` acá sería la vidriera del demo anunciada desde el
          //     dominio de otro comercio: fuga entre tenants, no una ineficiencia.
          expect(outcome.kind, etiqueta).toBe('rewrite');
          if (outcome.kind !== 'rewrite') continue;

          // (b) y el rewrite va SIEMPRE al slug del host, jamás al del path.
          expect(slugDelRewrite(outcome.to), etiqueta).toBe(slug);
          expect(new URL(outcome.to).pathname, etiqueta).toBe(`/s/${slug}${path === '/' ? '' : path}`);
        }
      }
    }
  });

  it('bajo el host del demo, el demo es un tenant más: `/demo` es 404 suyo, no un caso especial', () => {
    // La uniformidad es lo que mantiene cerrada la fuga: si `/demo` significara "el tenant demo"
    // en algún host, existiría un path reservado que designa otro tenant, y eso es el agujero.
    for (const [apex] of APEX_CON_WILDCARD) {
      const demoHost = tenantHostFor(apex, DEMO_TENANT_SLUG);
      expect(demoHost, apex).not.toBeNull();
      if (demoHost === null) continue;
      const outcome = run(demoHost, DEMO_ALIAS_PATH);
      expect(outcome.kind, demoHost).toBe('rewrite');
      if (outcome.kind === 'rewrite') {
        expect(new URL(outcome.to).pathname, demoHost).toBe(`/s/${DEMO_TENANT_SLUG}${DEMO_ALIAS_PATH}`);
      }
    }
  });

  it('propiedad global sobre la matriz: un rewrite jamás cruza de slug y un redirect sólo nace en marketing', () => {
    const hostsDeTenant = TENANTS.flatMap((slug) =>
      ['maat.work', '127.0.0.1.nip.io:3100', 'localhost:3000'].map((apex) => `${slug}.${apex}`),
    );
    const hostsDemo = APEX_CON_WILDCARD.map(([apex]) => tenantHostFor(apex, DEMO_TENANT_SLUG)).filter(
      (h): h is string => h !== null,
    );
    const hostsMarketing = [...APEX_CON_WILDCARD.map(([apex]) => apex), ...APEX_SIN_WILDCARD];
    const todos = [...hostsDeTenant, ...hostsDemo, ...hostsMarketing];

    // Ausencia de medición es FAIL, nunca PASS: una matriz vacía aprueba cualquier cosa.
    expect(todos.length * PATHS.length).toBeGreaterThan(100);

    for (const host of todos) {
      const resuelto = resolveHost(host);
      for (const path of PATHS) {
        const outcome = run(host, path);
        const etiqueta = `${host}${path}`;

        if (outcome.kind === 'rewrite') {
          expect(resuelto.kind, etiqueta).toBe('storefront');
          if (resuelto.kind !== 'storefront') continue;
          expect(slugDelRewrite(outcome.to), etiqueta).toBe(resuelto.slug);
        }

        if (outcome.kind === 'redirect') {
          // Un redirect sólo puede nacer de un host de marketing, sólo desde el path del alias, y
          // sólo puede apuntar al host del demo de ESE apex.
          expect(resuelto.kind, etiqueta).toBe('marketing');
          expect(isDemoAliasPath(path), etiqueta).toBe(true);
          const destino = new URL(outcome.location);
          expect(destino.hostname, etiqueta).toBe(tenantHostFor(host, DEMO_TENANT_SLUG));
          expect(resolveHost(destino.host), etiqueta).toEqual({ kind: 'storefront', slug: DEMO_TENANT_SLUG });
        }
      }
    }
  });

  it('el `Location` nunca sale del alias: no hay host de tenant que produzca uno', () => {
    // Dicho al revés y como cuantificador, porque es la forma en que se lee el gate: en toda la
    // matriz de hosts de tenant no existe UN solo `Location`.
    const conLocation = TENANTS.flatMap((slug) =>
      PATHS.map((path) => ({ host: `${slug}.maat.work`, path, outcome: run(`${slug}.maat.work`, path) })),
    ).filter((r) => r.outcome.kind === 'redirect');
    expect(conLocation.map((r) => `${r.host}${r.path}`)).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  3 · `tenantHostFor` es la inversa de `resolveHost`, y se prueba con un round trip
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('S13 · `tenantHostFor` no puede divergir de `resolveHost`', () => {
  it('round trip: `resolveHost(tenantHostFor(h, slug))` es siempre `storefront(slug)`', () => {
    const slugs = [DEMO_TENANT_SLUG, 'acme', 'alto-valle-phones'];
    let medidos = 0;
    for (const [apex] of APEX_CON_WILDCARD) {
      for (const slug of slugs) {
        const host = tenantHostFor(apex, slug);
        expect(host, `${slug} @ ${apex}`).not.toBeNull();
        if (host === null) continue;
        expect(resolveHost(host), `${slug} @ ${apex}`).toEqual({ kind: 'storefront', slug });
        medidos += 1;
      }
    }
    expect(medidos).toBe(APEX_CON_WILDCARD.length * slugs.length);
  });

  it('el negativo también: donde `tenantHostFor` devuelve `null`, no había vidriera que ofrecer', () => {
    for (const host of APEX_SIN_WILDCARD) {
      expect(tenantHostFor(host, DEMO_TENANT_SLUG), host).toBeNull();
    }
    // Y el host vacío o ausente, que `resolveHost` manda a marketing para no romper healthchecks.
    expect(tenantHostFor(null, DEMO_TENANT_SLUG)).toBeNull();
    expect(tenantHostFor('', DEMO_TENANT_SLUG)).toBeNull();
  });

  it('no se deja llamar con un slug que la DB no aceptaría (el path traversal entra por ahí)', () => {
    for (const malo of ['Foo_Bar', '../otro', 'ab', 'a'.repeat(33), 'con espacio']) {
      expect(() => tenantHostFor('maat.work', malo)).toThrow(/slug inválido/u);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  4 · el literal `'demo'` está atado a `@istock/domain`, no prometido en un comentario
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('S13 · `DEMO_TENANT_SLUG` es una copia ATADA de lo que decide `packages/domain`', () => {
  it('sirve vidriera y a la vez nadie lo puede registrar: la asimetría que S13 necesita', () => {
    // Las tres son necesarias y ninguna implica a las otras dos.
    expect(TENANT_SERVED_RESERVED_SLUGS.has(DEMO_TENANT_SLUG)).toBe(true);
    expect(RESERVED_SLUGS.has(DEMO_TENANT_SLUG)).toBe(true);
    expect(RESERVED_SUBDOMAINS.has(DEMO_TENANT_SLUG)).toBe(false);
  });

  it('tiene forma de slug de tenant y su host resuelve a la vidriera del demo', () => {
    expect(isSlugShaped(DEMO_TENANT_SLUG)).toBe(true);
    expect(resolveHost(`${DEMO_TENANT_SLUG}.maat.work`)).toEqual({
      kind: 'storefront',
      slug: DEMO_TENANT_SLUG,
    });
  });

  it('el alias es exactamente ese slug: `/demo` no es un string suelto', () => {
    expect(DEMO_ALIAS_PATH).toBe(`/${DEMO_TENANT_SLUG}`);
  });
});
