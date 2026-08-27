import { describe, expect, it } from 'vitest';
import { CACHE_TAG_LIMITS, listingTag, storefrontTag, tenantConfigTag } from './cache-tags';
import { isSlugShaped } from '@istock/domain';

/**
 * El invariante que estos tests protegen no es de performance: **un tag sin slug purga a todos los
 * tenants a la vez**, porque los cache tags están scopeados a proyecto + environment y no a
 * dominio. Con 100 tenants, una edición de precio dispararía 100 re-renders.
 */

describe('taxonomía de tags', () => {
  it('todo tag de vidriera lleva el slug adentro', () => {
    expect(storefrontTag('nortecel')).toBe('storefront:nortecel');
    expect(tenantConfigTag('nortecel')).toBe('tenant-config:nortecel');
  });

  it('nunca existe un tag genérico sin slug', () => {
    for (const bad of ['', '  ', 'ab', 'A-B', 'todo el mundo']) {
      expect(() => storefrontTag(bad)).toThrow();
      expect(() => tenantConfigTag(bad)).toThrow();
    }
  });

  it('rechaza la coma: es el delimitador del header Vercel-Cache-Tag', () => {
    // Un tag con coma no falla, se PARTE en dos tags. Falla silenciosa en producción.
    expect(() => storefrontTag('acme,beta')).toThrow();
  });

  it('los tags quedan holgadamente bajo el límite de 256 bytes', () => {
    // Un tag de más de 256 bytes se descarta con un console.warn y NO invalida nada.
    const longest = storefrontTag('a'.repeat(32));
    expect(new TextEncoder().encode(longest).length).toBeLessThan(CACHE_TAG_LIMITS.maxBytesPerTag);
  });

  it('`listing:{uuid}` sólo acepta un UUID de verdad', () => {
    expect(listingTag('123e4567-e89b-12d3-a456-426614174000')).toBe(
      'listing:123e4567-e89b-12d3-a456-426614174000',
    );
    expect(() => listingTag('42')).toThrow();
    expect(() => listingTag('nortecel')).toThrow();
  });

  it('dos tenants nunca comparten tag', () => {
    expect(storefrontTag('acme')).not.toBe(storefrontTag('acme-2'));
    expect(storefrontTag('acme')).not.toBe(tenantConfigTag('acme'));
  });
});

/**
 * El throw es la ÚLTIMA barrera, no la primera (hallazgo HIGH del adversary de S1).
 *
 * Estos tags se construyen dentro de scopes `'use cache'`. Ahí, un throw no es un 500: bajo
 * cacheComponents + PPR el shell ya salió con `200` y lo que queda es un stream que no cierra.
 * Por eso el contrato de este módulo tiene dos mitades y las dos importan.
 */
describe('el throw sigue firme, y sigue siendo la última barrera', () => {
  it('un slug con punto (el vector de `/s/algo.json`) no produce un tag: tira', () => {
    expect(() => storefrontTag('algo.json')).toThrow();
    expect(() => tenantConfigTag('algo.json')).toThrow();
  });

  it('`isSlugShaped` contesta lo mismo SIN tirar: es lo que usan los call sites', () => {
    // Si esta equivalencia se rompe, existe un slug que la guarda de `page.tsx` deja pasar y que
    // `storefrontTag()` rechaza — o sea, el stream colgado vuelve por la puerta de al lado.
    for (const s of ['nortecel', 'algo.json', 'ab', 'A-B', '', 'a-b-c', 'a'.repeat(32), 'a'.repeat(33)]) {
      const shaped = isSlugShaped(s);
      let threw = false;
      try {
        storefrontTag(s);
      } catch {
        threw = true;
      }
      expect(threw, s).toBe(!shaped);
    }
  });
});
