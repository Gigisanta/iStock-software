import { describe, expect, it } from 'vitest';
import { CACHE_TAG_LIMITS, listingTag, storefrontTag, tenantConfigTag } from './cache-tags';

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
