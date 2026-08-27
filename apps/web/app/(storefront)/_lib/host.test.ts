import { describe, expect, it } from 'vitest';
import {
  PRERENDER_SEED_SLUG,
  RESERVED_SUBDOMAINS,
  SLUG_RE,
  isInfrastructurePath,
  isReservedSubdomain,
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
    // La regla: slug inexistente → 404 real, nunca redirect/passthrough al home.
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
