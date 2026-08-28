import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Los tags que el panel emite, **como strings exactos**.
 *
 * Este test es raro a propósito: casi todo lo que verifica son literales escritos a mano
 * (`'listing:…'`, `'storefront:…'`). No es duplicación perezosa — es la única forma de atrapar el
 * modo de falla de esta capa. Un tag que el panel arma distinto del que la vidriera registró
 * **no invalida nada y no falla**: no hay excepción, no hay 500, no hay log. Sólo una ficha vieja
 * servida por un año. Un test que compare `panelTag === panelTag` pasa siempre; uno que compare
 * contra un literal se cae el día que alguien renombre el tag de un lado solo.
 *
 * Por eso hay dos aserciones por tag y las dos hacen falta:
 * 1. contra el literal → detecta el renombre;
 * 2. contra `listingTag()` de `(storefront)/_lib/cache-tags.ts` → detecta la divergencia con el
 *    dueño real del nombre (`storefront-agent`), que es de quien se importa y a quien no editamos.
 */

vi.mock('server-only', () => ({}));

const updateTag = vi.fn();
const revalidateTag = vi.fn();
vi.mock('next/cache', () => ({
  updateTag: (tag: string) => {
    updateTag(tag);
  },
  revalidateTag: (tag: string, options?: unknown) => {
    revalidateTag(tag, options);
  },
}));

const logEvent = vi.fn();
vi.mock('../log', () => ({
  logEvent: (event: string, fields: unknown) => {
    logEvent(event, fields);
  },
  logError: vi.fn(),
}));

const { invalidateListing, invalidateStorefront, invalidateStorefrontUnit } = await import(
  './storefront-cache'
);
const { listingTag, storefrontTag, tenantConfigTag } = await import(
  '../../../(storefront)/_lib/cache-tags'
);

const SLUG = 'lacoope';
const LISTING_ID = '3f2b1a90-7c4d-4e21-9b8a-0c1d2e3f4a5b';

/** Los tags que efectivamente se emitieron, en orden. */
const emitted = (): string[] => updateTag.mock.calls.map(([tag]) => tag as string);

beforeEach(() => {
  // `mockReset` y no `clearAllMocks`: los dos últimos tests instalan una implementación que tira,
  // y `clearAllMocks` borra las llamadas pero **deja la implementación puesta**.
  updateTag.mockReset();
  revalidateTag.mockReset();
  logEvent.mockReset();
});

describe('invalidateStorefront · la vidriera entera', () => {
  it('emite los dos tags de tenant y ninguno más', () => {
    invalidateStorefront(SLUG);

    expect(emitted()).toEqual(['storefront:lacoope', 'tenant-config:lacoope']);
  });

  it('los dos literales son los que arma la vidriera', () => {
    invalidateStorefront(SLUG);

    expect(emitted()).toEqual([storefrontTag(SLUG), tenantConfigTag(SLUG)]);
  });
});

describe('invalidateStorefrontUnit · cambió la unidad y la grilla', () => {
  it('emite DOS tags: la grilla y esa unidad', () => {
    invalidateStorefrontUnit(SLUG, LISTING_ID);

    expect(emitted()).toEqual([
      'storefront:lacoope',
      'listing:3f2b1a90-7c4d-4e21-9b8a-0c1d2e3f4a5b',
    ]);
  });

  /**
   * **La aserción del RADIO (S6).** Es la única cosa que impide que alguien vuelva a meter
   * `tenantConfigTag(slug)` acá adentro "por las dudas". No es un detalle de estilo: la ficha
   * pública registra el tag de config, y un tag es un OR, así que emitirlo desde una mutación de
   * UNA unidad purga las fichas de TODAS las hermanas. Medido en S6: 61 páginas invalidadas por
   * una reserva en un tenant de 60 equipos, cold-hit rate ~39% contra una alarma de 5%.
   *
   * Reservar no cambia el TC, ni los puntos de retiro, ni el teléfono. Si una mutación futura sí
   * los cambia, la función es `invalidateStorefront()`, no esta.
   */
  it('NO purga la config del tenant: el radio es la grilla + una ficha, no el catálogo', () => {
    invalidateStorefrontUnit(SLUG, LISTING_ID);

    expect(emitted()).not.toContain(tenantConfigTag(SLUG));
    expect(emitted()).not.toContain('tenant-config:lacoope');
    expect(emitted()).toHaveLength(2);
  });

  /**
   * **La aserción de S3.2.** Si alguien saca el `updateTag(listingTag(id))` de
   * `invalidateStorefrontUnit`, o le cambia el prefijo, esto se cae. Verificado sacándolo a mano:
   * `expected [ 'storefront:lacoope' ] to contain 'listing:3f2b…'`.
   */
  it('el tag de la unidad se emite y es el mismo string que registra la ficha', () => {
    invalidateStorefrontUnit(SLUG, LISTING_ID);

    expect(emitted()).toContain(`listing:${LISTING_ID}`);
    expect(emitted()).toContain(listingTag(LISTING_ID));
  });

  /**
   * La grilla se queda **aunque** el radio se haya achicado: reservar cambia la card (aparece el
   * badge "Reservado"). Sin este tag la grilla seguiría diciendo "Disponible" sobre una unidad
   * reservada, que es la regresión que el adversary rechazó en S6.
   */
  it('sí purga la grilla: el badge "Reservado" vive en la card', () => {
    invalidateStorefrontUnit(SLUG, LISTING_ID);

    expect(emitted()).toContain(storefrontTag(SLUG));
  });

  /**
   * Con el radio de dos tags, el de la unidad es lo **único** que alcanza a la ficha. Si el id no
   * tiene forma de UUID y no se ensanchara, quedaría sólo `storefront:{slug}`: la grilla se
   * actualiza y la ficha queda pegada en el CDN con `cacheLife('max')` hasta un año. Purgar de más
   * en un caso que no debería ocurrir nunca es mejor que servir una ficha mentirosa.
   */
  it('un listingId que no es UUID no explota: se ensancha a los tags de tenant', () => {
    invalidateStorefrontUnit(SLUG, 'no-soy-un-uuid');

    expect(emitted()).toEqual(['storefront:lacoope', 'tenant-config:lacoope']);
    expect(logEvent).toHaveBeenCalledWith('storefront.cache.listing_tag_invalid', { slug: SLUG });
  });

  it('el id crudo nunca entra al log', () => {
    invalidateStorefrontUnit(SLUG, 'no-soy-un-uuid');

    expect(JSON.stringify(logEvent.mock.calls)).not.toContain('no-soy-un-uuid');
  });
});

describe('invalidateListing · cambió SÓLO la ficha', () => {
  /**
   * Acá está el ahorro de la slice. Con 200 equipos publicados, emitir `storefront:{slug}` purga
   * la grilla y las 200 fichas; emitir sólo `listing:{uuid}` purga una.
   */
  it('emite UN tag: el de la unidad', () => {
    invalidateListing(SLUG, LISTING_ID);

    expect(emitted()).toEqual(['listing:3f2b1a90-7c4d-4e21-9b8a-0c1d2e3f4a5b']);
  });

  it('NO purga la vidriera del tenant', () => {
    invalidateListing(SLUG, LISTING_ID);

    expect(emitted()).not.toContain(storefrontTag(SLUG));
    expect(emitted()).not.toContain(tenantConfigTag(SLUG));
  });

  /**
   * Sin el tag de unidad no habría nada que emitir, y "nada" dejaría la ficha vieja servida un
   * año. Ensanchar es peor de lo necesario y estrictamente mejor que no invalidar.
   */
  it('si el id no es UUID, ensancha a los tags de tenant antes que no emitir nada', () => {
    invalidateListing(SLUG, 'no-soy-un-uuid');

    expect(emitted()).toEqual(['storefront:lacoope', 'tenant-config:lacoope']);
  });
});

describe('el fallback de updateTag (E872 fuera de una Server Action)', () => {
  it('degrada a revalidateTag(tag, { expire: 0 }) por cada tag y lo loguea', () => {
    updateTag.mockImplementation(() => {
      throw new Error('E872: updateTag sólo se puede usar en una Server Action');
    });

    invalidateStorefrontUnit(SLUG, LISTING_ID);

    expect(revalidateTag.mock.calls).toEqual([
      ['storefront:lacoope', { expire: 0 }],
      [`listing:${LISTING_ID}`, { expire: 0 }],
    ]);
    expect(logEvent).toHaveBeenCalledTimes(2);
  });

  it('un tag que falla no se lleva puestos a los otros', () => {
    updateTag.mockImplementation((tag: string) => {
      if (tag.startsWith('storefront:')) throw new Error('E872');
    });

    invalidateStorefrontUnit(SLUG, LISTING_ID);

    expect(emitted()).toHaveLength(2);
    expect(revalidateTag.mock.calls).toEqual([['storefront:lacoope', { expire: 0 }]]);
  });
});
