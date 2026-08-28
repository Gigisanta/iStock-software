/**
 * **Las URLs públicas de la vidriera.** La *forma* del slug de una ficha ya no se prueba acá: la
 * declara `@istock/domain` y la cubren sus tests en `packages/domain/src/slug.test.ts`. Repetir
 * esos casos sería repetir la definición con otro disfraz, que es exactamente lo que la regla 14
 * de `guard-leaks.sh` existe para impedir.
 *
 * Lo que queda es lo que sólo se puede afirmar desde `apps/web`: cómo se ve el link y qué hace la
 * vidriera con un slug malo.
 */

import { describe, expect, it } from 'vitest';
import { isListingSlugShaped, isSlugShaped } from '@istock/domain';
import { LISTING_PATH_PREFIX, PRERENDER_SEED_LISTING, listingPath } from './routes';

describe('listingPath', () => {
  it('arma la URL PÚBLICA, relativa al host del tenant: sin `/s/`, sin slug de tenant', () => {
    const path = listingPath('iphone-14-pro-256-grafito');
    expect(path).toBe('/p/iphone-14-pro-256-grafito');
    // `/s/**` lo corta `proxy.ts` con 404: un href a ese espacio sería un link muerto.
    expect(path.startsWith('/s/')).toBe(false);
  });

  it('el prefijo es un slug reservado, así que no le pisa el subdominio a ningún tenant', () => {
    expect(LISTING_PATH_PREFIX).toBe('/p');
    expect(isSlugShaped('p')).toBe(false);
  });
});

describe('PRERENDER_SEED_LISTING', () => {
  it('tiene forma válida: si no, `generateStaticParams` prerenderiza una ruta que no compila', () => {
    expect(isListingSlugShaped(PRERENDER_SEED_LISTING)).toBe(true);
  });
});

describe('el borde de la vidriera CONTESTA un slug malo, no lo lanza', () => {
  /**
   * No es una repetición de los tests de forma de `domain`: lo que se afirma es la **propiedad que
   * la vidriera necesita**, que es que el validador se pueda usar dentro de un scope `'use cache'`.
   * Bajo `cacheComponents` + PPR un throw de render no es un 500 — el shell ya salió con `200` y lo
   * que queda es un stream que no cierra, o sea CPU facturada por input basura. Si alguien cambiara
   * `isListingSlugShaped` por un `assert*`, este test es el que se pone en rojo.
   */
  it('no tira con nada de lo que puede venir en una URL', () => {
    for (const hostile of ['', '%%%', '../../etc/passwd', ' ', 'a'.repeat(9000)]) {
      expect(() => isListingSlugShaped(hostile)).not.toThrow();
      expect(isListingSlugShaped(hostile)).toBe(false);
    }
  });

  it('el largo del path no puede elegir el tamaño del cache key', () => {
    // El slug es argumento de `'use cache'`, o sea que entra al cache key. Un path de 8 KB sería un
    // cache key de 8 KB elegido por quien pide la URL. El techo lo pone `domain`; acá se comprueba
    // que la vidriera efectivamente lo hereda y no acepta más.
    expect(isListingSlugShaped('a'.repeat(8192))).toBe(false);
  });
});
