/**
 * El cache de 60 s ahorra **armado**, no tokens: el prompt viaja igual entero (el context caching de
 * los proveedores no aplica a una dieta de 1200, R3 §1). Por eso lo que se prueba acá es el TTL y la
 * cantidad de veces que se llama a `build`, no ningún efecto sobre el costo del turno.
 */

import { describe, expect, it, vi } from 'vitest';
import { CACHE_TTL_MS } from './budget';
import { createTtlCache } from './cache';

function clock(start = 0) {
  let at = start;
  return { now: () => at, advance: (ms: number) => (at += ms) };
}

describe('createTtlCache', () => {
  it('no vuelve a construir dentro del TTL', () => {
    const time = clock();
    const cache = createTtlCache<string>({ ttlMs: CACHE_TTL_MS, now: time.now });
    const build = vi.fn(() => 'ficha');

    expect(cache.get('a', build)).toBe('ficha');
    time.advance(CACHE_TTL_MS - 1);
    expect(cache.get('a', build)).toBe('ficha');
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('reconstruye cuando vence, así una ficha editada no queda pegada un día entero', () => {
    const time = clock();
    const cache = createTtlCache<number>({ ttlMs: CACHE_TTL_MS, now: time.now });
    let value = 1;
    const build = () => value;

    expect(cache.get('a', build)).toBe(1);
    time.advance(CACHE_TTL_MS + 1);
    value = 2;
    expect(cache.get('a', build)).toBe(2);
  });

  it('las claves no se pisan entre sí, que es lo que separa una ficha de otra (y un tenant de otro)', () => {
    const cache = createTtlCache<string>();
    expect(cache.get('tenant-a:ficha', () => 'A')).toBe('A');
    expect(cache.get('tenant-b:ficha', () => 'B')).toBe('B');
    expect(cache.get('tenant-a:ficha', () => 'otra')).toBe('A');
  });

  it('tiene techo de entradas: no es un leak con nombre de cache', () => {
    const cache = createTtlCache<number>({ maxEntries: 3 });
    for (let i = 0; i < 10; i += 1) cache.get(`k${i}`, () => i);
    expect(cache.size).toBe(3);
    // La más vieja se fue: se reconstruye.
    const build = vi.fn(() => 0);
    cache.get('k0', build);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('clear vacía', () => {
    const cache = createTtlCache<string>();
    cache.get('a', () => 'x');
    expect(cache.size).toBe(1);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('el TTL por default es el de la constitución', () => {
    const time = clock();
    const cache = createTtlCache<string>({ now: time.now });
    const build = vi.fn(() => 'x');
    cache.get('a', build);
    time.advance(CACHE_TTL_MS - 1);
    cache.get('a', build);
    expect(build).toHaveBeenCalledTimes(1);
    time.advance(2);
    cache.get('a', build);
    expect(build).toHaveBeenCalledTimes(2);
  });
});
