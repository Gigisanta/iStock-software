import { describe, expect, it } from 'vitest';
import { SLUG_PATTERN } from '@istock/domain';
import {
  MEDIA_PATH_PREFIX,
  PRERENDER_SEED_SLUG,
  RESERVED_SUBDOMAINS,
  SLUG_RE,
  isGlobalMediaPath,
  isInfrastructurePath,
  isReservedSubdomain,
  isSlugShaped,
  isStorefrontInternalPath,
  normalizeHostname,
  resolveHost,
  storefrontPathFor,
} from './host';

/**
 * Tests de `storefront/host` — la lógica entera de `apps/web/proxy.ts`.
 *
 * El proxy corre fuera del runtime de la app y no hay forma barata de ejercitarlo en unit test.
 * Por eso todo lo que decide vive en `host.ts` y se testea acá: si esto pasa, lo único que puede
 * fallar en `proxy.ts` son cuatro líneas de `NextResponse`.
 */

describe('normalizeHostname', () => {
  it('saca el puerto — el bug que sólo aparece en dev', () => {
    // En `next dev` el header `host` llega con puerto. Sin este split el slug local sale mal
    // (`acme.localhost:3000` → slug `acme.localhost:3000`) y el de producción sale bien.
    expect(normalizeHostname('acme.localhost:3000')).toBe('acme.localhost');
    expect(normalizeHostname('acme.maat.work:443')).toBe('acme.maat.work');
  });

  it('normaliza mayúsculas, espacios y el punto raíz del FQDN', () => {
    expect(normalizeHostname('  Acme.MAAT.Work.  ')).toBe('acme.maat.work');
  });

  it('maneja literales IPv6 sin confundir el puerto con los dos puntos de la dirección', () => {
    expect(normalizeHostname('[::1]:3000')).toBe('::1');
  });

  it('devuelve string vacío si no hay host', () => {
    expect(normalizeHostname(null)).toBe('');
    expect(normalizeHostname(undefined)).toBe('');
    expect(normalizeHostname('   ')).toBe('');
  });
});

describe('resolveHost · producción', () => {
  it('apex y www son marketing', () => {
    expect(resolveHost('maat.work')).toEqual({ kind: 'marketing' });
    expect(resolveHost('www.maat.work')).toEqual({ kind: 'marketing' });
  });

  it('{slug}.maat.work resuelve a la vidriera de ese slug', () => {
    expect(resolveHost('nortecel.maat.work')).toEqual({ kind: 'storefront', slug: 'nortecel' });
    expect(resolveHost('celu-cipo.maat.work')).toEqual({ kind: 'storefront', slug: 'celu-cipo' });
    expect(resolveHost('demo.maat.work')).toEqual({ kind: 'storefront', slug: 'demo' });
  });

  it('los subdominios de infraestructura NO son tenants', () => {
    for (const reserved of ['app', 'api', 'admin', 'cdn', 'img', 'staging']) {
      expect(resolveHost(`${reserved}.maat.work`)).toEqual({ kind: 'marketing' });
      expect(RESERVED_SUBDOMAINS.has(reserved)).toBe(true);
    }
  });

  it('`demo` NO está reservado: es un tenant real (tenants.is_demo)', () => {
    expect(RESERVED_SUBDOMAINS.has('demo')).toBe(false);
  });

  it('un subdominio con forma inválida da 404, no marketing', () => {
    // Ojo con el alcance: acá se prueba el host MALFORMADO (`Foo_Bar`, `-acme`, `ab`, 33 chars),
    // no el slug bien formado que todavía no está dado de alta. Son dos casos distintos a
    // propósito y ADR-011 sólo cambió el segundo:
    //  · malformado (esto) — la DB tiene el mismo CHECK, así que no puede ser un tenant JAMÁS;
    //    el proxy responde 404 real sin invocar la app (`malformedHost` en `apps/web/proxy.ts`).
    //  · bien formado e inexistente — ADR-011: sigue al rewrite y la página cacheada devuelve
    //    una página LEGIBLE con `noindex, nofollow` y status 200, no un 404, cacheada con el
    //    perfil corto de ADR-012 (`_lib/cache-life.ts`).
    // La mitad que NO cambió — y que es lo que este test protege — es la otra: en ninguno de los
    // dos casos hay redirect ni passthrough al home. Caer en `marketing` le mostraría la landing
    // de MaatWork a alguien que escribió mal un subdominio, y eso no se distingue de una vidriera.
    expect(resolveHost('Foo_Bar.maat.work').kind).toBe('not-found');
    expect(resolveHost('-acme.maat.work').kind).toBe('not-found');
    expect(resolveHost('acme-.maat.work').kind).toBe('not-found');
    expect(resolveHost('ab.maat.work').kind).toBe('not-found'); // < 3 chars
    expect(resolveHost(`${'a'.repeat(33)}.maat.work`).kind).toBe('not-found'); // > 32 chars
  });

  it('el wildcard es de UN nivel: `a.b.maat.work` no es un tenant', () => {
    expect(resolveHost('a.b.maat.work').kind).toBe('not-found');
  });

  it('un dominio ajeno pasa a marketing, no a 404', () => {
    // Healthchecks, dominios apuntados por error y el upsell futuro de dominio propio.
    expect(resolveHost('otracosa.com')).toEqual({ kind: 'marketing' });
  });

  it('los preview deploys de Vercel nunca se leen como tenant', () => {
    // `istock-git-main-maatwork.vercel.app` tiene un primer label con forma de slug: sin esta
    // rama, TODOS los previews darían 404.
    expect(resolveHost('istock-git-main-maatwork.vercel.app')).toEqual({ kind: 'marketing' });
    expect(resolveHost('istock.vercel.app')).toEqual({ kind: 'marketing' });
  });

  it('sin header host cae a marketing, no a 404', () => {
    expect(resolveHost(null)).toEqual({ kind: 'marketing' });
  });
});

describe('resolveHost · desarrollo', () => {
  it('localhost pelado es marketing; {slug}.localhost es vidriera', () => {
    expect(resolveHost('localhost:3000')).toEqual({ kind: 'marketing' });
    expect(resolveHost('127.0.0.1:3000')).toEqual({ kind: 'marketing' });
    expect(resolveHost('nortecel.localhost:3000')).toEqual({ kind: 'storefront', slug: 'nortecel' });
  });

  it('nip.io con IP en el medio: es el único modo de abrir la vidriera desde un celular real', () => {
    expect(resolveHost('nortecel.127.0.0.1.nip.io')).toEqual({ kind: 'storefront', slug: 'nortecel' });
    expect(resolveHost('nortecel.192-168-0-10.nip.io')).toEqual({ kind: 'storefront', slug: 'nortecel' });
    expect(resolveHost('nortecel.192.168.0.10.sslip.io:3000')).toEqual({
      kind: 'storefront',
      slug: 'nortecel',
    });
  });

  it('nip.io sin slug adelante es el apex de dev', () => {
    expect(resolveHost('127.0.0.1.nip.io')).toEqual({ kind: 'marketing' });
    expect(resolveHost('127-0-0-1.nip.io')).toEqual({ kind: 'marketing' });
  });
});

describe('resolveHost · el slug aceptado es EXACTAMENTE el que acepta la DB', () => {
  // `packages/db`: CHECK tenants_slug_format = '^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$'
  // Un slug que la DB acepta y el proxy rechaza es un tenant que paga y no tiene vidriera.
  const DB_CHECK = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;
  const candidates = ['abc', 'a-c', 'nortecel', 'celu-cipo-2', '0mega', 'a'.repeat(32), 'a'.repeat(33), 'ab', 'A-B', 'a_b', '-ab', 'ab-'];

  it.each(candidates)('slug "%s": proxy y DB opinan lo mismo', (candidate) => {
    expect(SLUG_RE.test(candidate)).toBe(DB_CHECK.test(candidate));
  });
});

describe('storefrontPathFor', () => {
  it('mete el slug como SEGMENTO DE PATH (así entra al cache key de use cache)', () => {
    expect(storefrontPathFor('nortecel', '/')).toBe('/s/nortecel');
    expect(storefrontPathFor('nortecel', '/p/iphone-14-pro')).toBe('/s/nortecel/p/iphone-14-pro');
  });

  it('rechaza un slug inválido: es la última barrera contra path traversal', () => {
    expect(() => storefrontPathFor('../admin', '/')).toThrow();
    expect(() => storefrontPathFor('a/b', '/')).toThrow();
  });
});

describe('isInfrastructurePath', () => {
  it('`/_next/*` nunca se reescribe: reescribirlo rompe el RSC payload', () => {
    // Y `_next/data` se invoca aunque el matcher lo excluya ("intentional behavior").
    expect(isInfrastructurePath('/_next/data/abc/s/nortecel.json')).toBe(true);
    expect(isInfrastructurePath('/_next/static/chunks/main.js')).toBe(true);
    expect(isInfrastructurePath('/p/iphone-14')).toBe(false);
    expect(isInfrastructurePath('/')).toBe(false);
  });
});

describe('isGlobalMediaPath · la foto es global, no es de la vidriera de nadie', () => {
  // El defecto que originó estos tests: las fotos salen en `.webp` y `webp` es uno de los 16
  // sufijos que el `matcher` del proxy excluye, así que sobre TODO el camino de media `proxy()` no
  // corría — ni la resolución de host ni, sobre todo, `stripInboundTenantHeaders()`. La cobertura
  // por prefijo la afirma `tests/proxy-matcher-no-deja-la-vidriera-sin-vigilar.test.ts`; lo que se
  // afirma acá es la otra mitad: que estando cubierto, el proxy NO lo reescriba.

  it('cubre el prefijo entero, no una extensión: la ruta es `[...key]` y la elige quien pide', () => {
    expect(isGlobalMediaPath(`${MEDIA_PATH_PREFIX}/v1/ab/0123456789abcdef.webp`)).toBe(true);
    // El día que el pipeline emita AVIF (CLAUDE.md §3) esto ya está cubierto. Razonar por sufijo
    // es exactamente el bug que se está arreglando.
    expect(isGlobalMediaPath(`${MEDIA_PATH_PREFIX}/v1/ab/0123456789abcdef.avif`)).toBe(true);
    expect(isGlobalMediaPath(MEDIA_PATH_PREFIX)).toBe(true);
  });

  it('acepta la forma percent-encodeada, en las dos cajas del hex (RFC 3986 §2.1)', () => {
    // El directorio en disco es `%5Fmedia` porque `_media` sería una carpeta privada de Next. La
    // URL pública es `/_media/…`, pero un cliente puede escribir el escape a mano y, si alguna capa
    // lo decodifica antes de rutear, ese request llega a la app. Llegue como foto o como 404, tiene
    // que haber pasado por el saneo de headers.
    expect(isGlobalMediaPath('/%5Fmedia/v1/ab/0123456789abcdef.webp')).toBe(true);
    expect(isGlobalMediaPath('/%5fmedia/v1/ab/0123456789abcdef.webp')).toBe(true);
  });

  it('no se come vecinos: sólo el primer segmento exacto', () => {
    expect(isGlobalMediaPath('/_mediaotro/x.webp')).toBe(false);
    expect(isGlobalMediaPath('/algo/_media/x.webp')).toBe(false);
    expect(isGlobalMediaPath('/')).toBe(false);
    expect(isGlobalMediaPath('/s/nortecel')).toBe(false);
    // Sólo se normaliza el escape, no el resto del path: el matcheo de rutas de Next es
    // case-sensitive y la ruta es `_media` en minúscula.
    expect(isGlobalMediaPath('/%5FMEDIA/x.webp')).toBe(false);
  });

  it('es disjunto de `/s/**` y de `/_next/**`: ninguna guarda le pisa el camino a la otra', () => {
    for (const path of [`${MEDIA_PATH_PREFIX}/v1/ab/0123456789abcdef.webp`, '/%5Fmedia/x.webp']) {
      expect(isStorefrontInternalPath(path)).toBe(false);
      expect(isInfrastructurePath(path)).toBe(false);
    }
  });

  it('storefrontPathFor demuestra por qué NO puede reescribirse por host', () => {
    // Esto es lo que haría el proxy sin la guarda, sobre `nortecel.maat.work`. La key es
    // content-addressed (ADR-006): no hay ruta en ese path y el objeto no es de ningún tenant.
    expect(storefrontPathFor('nortecel', `${MEDIA_PATH_PREFIX}/v1/ab/0123456789abcdef.webp`)).toBe(
      '/s/nortecel/_media/v1/ab/0123456789abcdef.webp',
    );
  });
});

describe('PRERENDER_SEED_SLUG · el slug que hace cacheable a la vidriera', () => {
  it('tiene forma de slug válido: si no, `cacheTag()` tira y el BUILD se cae', () => {
    // `generateStaticParams` lo devuelve y el build renderiza `/s/{seed}`, que llama a
    // `storefrontTag(seed)`. Un seed con forma inválida no falla en runtime: falla en el build.
    expect(SLUG_RE.test(PRERENDER_SEED_SLUG)).toBe(true);
  });

  it('está RESERVADO: nadie puede registrarlo y quedarse con la entrada estática del build', () => {
    expect(isReservedSubdomain(PRERENDER_SEED_SLUG)).toBe(true);
    expect(RESERVED_SUBDOMAINS.has(PRERENDER_SEED_SLUG)).toBe(true);
  });

  it('su subdominio NUNCA se reescribe a la vidriera: la página semilla es inalcanzable', () => {
    // El build deja `/s/not-a-tenant` prerenderizado. Que sea inalcanzable es la razón por la que
    // da igual que su contenido sea un 404.
    expect(resolveHost(`${PRERENDER_SEED_SLUG}.maat.work`)).toEqual({ kind: 'marketing' });
  });

  it('`isReservedSubdomain` coincide con lo que `resolveHost` manda a marketing', () => {
    for (const label of RESERVED_SUBDOMAINS) {
      expect(isReservedSubdomain(label)).toBe(true);
      expect(resolveHost(`${label}.maat.work`)).toEqual({ kind: 'marketing' });
    }
    expect(isReservedSubdomain('demo')).toBe(false);
    expect(isReservedSubdomain('nortecel')).toBe(false);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *  El HIGH del adversary de S1: `/s/**` es espacio interno y el proxy lo cierra con 404.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * El bug tenía dos mitades y las dos se testean acá:
 * - la GUARDA no existía como función propia y vivía dentro de la rama `marketing` del proxy, así
 *   que sobre un host de tenant no corría;
 * - el MATCHER excluía 14 extensiones estáticas por sufijo, y `/s/algo.json` es sufijo `.json`
 *   **y** ruta de la app a la vez (`/s/[slug]` matchea con `slug = "algo.json"`).
 * Juntas dejaban un slug basura llegando a `cacheTag()`, que tira, y bajo cacheComponents + PPR un
 * throw de render es un stream que no cierra con status 200.
 */
describe('isStorefrontInternalPath · `/s/**` no es una URL pública', () => {
  it('cubre el prefijo entero, con slug válido o basura', () => {
    expect(isStorefrontInternalPath('/s')).toBe(true);
    expect(isStorefrontInternalPath('/s/nortecel')).toBe(true);
    expect(isStorefrontInternalPath('/s/nortecel/p/iphone-14')).toBe(true);
  });

  it('cubre las 14 extensiones que el matcher excluía — el vector exacto del hallazgo', () => {
    const exts = ['svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'css', 'js', 'txt', 'xml', 'json', 'woff', 'woff2', 'ttf'];
    for (const ext of exts) {
      expect(isStorefrontInternalPath(`/s/noexiste-991.${ext}`), ext).toBe(true);
    }
  });

  it('NO se come paths que apenas empiezan con "s": la exclusión es por segmento', () => {
    // Si esto fuera un `startsWith('/s')` pelado, `/stock` y `/style.css` darían 404 en marketing.
    expect(isStorefrontInternalPath('/stock')).toBe(false);
    expect(isStorefrontInternalPath('/style.css')).toBe(false);
    expect(isStorefrontInternalPath('/sitemap.xml')).toBe(false);
    expect(isStorefrontInternalPath('/')).toBe(false);
    expect(isStorefrontInternalPath('/p/iphone-14')).toBe(false);
  });

  it('lo que el proxy PRODUCE cae dentro de la guarda: por eso el rewrite no puede re-entrar', () => {
    // No es una curiosidad: si los rewrites del proxy volvieran a pasar por el proxy, esta guarda
    // convertiría toda la vidriera en 404. No lo hacen (si lo hicieran, `acme.maat.work/` haría
    // bucle infinito hoy). El test deja escrito de qué depende.
    expect(isStorefrontInternalPath(storefrontPathFor('nortecel', '/'))).toBe(true);
    expect(isStorefrontInternalPath(storefrontPathFor('nortecel', '/p/iphone-14'))).toBe(true);
  });
});

describe('SLUG_RE es UNA sola fuente de verdad, no una copia (hallazgo LOW)', () => {
  it('es literalmente el `SLUG_PATTERN` de @istock/domain, no un regex equivalente', () => {
    // El hallazgo no era "están distintos": era que NADA los ataba. Dos regex equivalentes hoy y
    // divergentes mañana es cómo un host que el proxy acepta termina tirando en `cacheTag()`.
    // `toBe` (identidad referencial) es el assert correcto: `toEqual` pasaría con dos copias.
    expect(SLUG_RE).toBe(SLUG_PATTERN);
  });

  it('`isSlugShaped` responde lo mismo que el regex, sin tirar', () => {
    // Es la diferencia entre contestar y lanzar: la guarda de `page.tsx` no puede tirar.
    for (const s of ['nortecel', 'ab', 'A-B', 'algo.json', '', 'a'.repeat(33), '-ab', 'ab-']) {
      expect(isSlugShaped(s), s).toBe(SLUG_RE.test(s));
    }
    expect(isSlugShaped('algo.json')).toBe(false);
  });

  it('sin flag `g`: un regex con estado daría false en llamadas alternas', () => {
    expect(SLUG_RE.global).toBe(false);
    expect(SLUG_RE.test('nortecel')).toBe(true);
    expect(SLUG_RE.test('nortecel')).toBe(true);
  });
});
