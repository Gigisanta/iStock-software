/**
 * **Qué tags registra cada camino del read model de la vidriera.**
 *
 * Este test existe por un modo de falla que no tiene síntoma: un tag de más no rompe nada, no tira,
 * no loguea y no se ve en pantalla. Sólo purga páginas que no cambiaron. Lo midió `cost-auditor` en
 * S6 y costó el 95%: `invalidateStorefrontUnit()` emite `storefront:{slug}` +
 * `tenant-config:{slug}` + `listing:{uuid}`, un tag es un **OR**, y mientras la ficha registraba el
 * tag del catálogo, reservar UNA unidad en un tenant de 60 equipos purgaba las **61** páginas.
 * Cold-hit ~39% contra una alarma de 5%.
 *
 * Por eso las aserciones son sobre los **strings exactos** que se registran, y no sobre
 * "se llamó a `cacheTag`": lo que se rompe acá es *cuál* tag, nunca *si* hubo tag.
 *
 * ## Por qué se mockea `./storefront-db` y nada más
 * La pregunta de este archivo es de cache, no de SQL. Mockeando el único borde de I/O
 * (`withStorefrontDb`) corre el código real de `listings.ts` —las ramas, el orden de las llamadas y
 * el `publicListingDTO` del final— sin Postgres y sin fabricar un query builder falso, que sería
 * cien líneas de andamio afirmando cosas sobre el andamio. `@istock/db` y `@istock/media` se
 * importan de verdad: no abren conexiones al importarse.
 *
 * `'use cache'` es una directiva de Next y bajo Vitest es una expresión-string inerte; `cacheTag` y
 * `cacheLife` son las que hacen algo, y son justo las dos que se están observando.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const tagged: string[] = [];
const lives: unknown[] = [];
vi.mock('next/cache', () => ({
  cacheTag: (...tags: string[]) => {
    tagged.push(...tags);
  },
  cacheLife: (profile: unknown) => {
    lives.push(profile);
  },
}));

/** Lo que devuelve la transacción de la vidriera. `null` = no hay tenant, o no hay unidad. */
let dbResult: unknown = null;
const withStorefrontDb = vi.fn();
vi.mock('./storefront-db', () => ({
  withStorefrontDb: (slug: string) => {
    withStorefrontDb(slug);
    return Promise.resolve(dbResult);
  },
}));

const { getStorefrontCatalog, getStorefrontListing } = await import('./listings');
const { fxRateFromDecimal } = await import('@istock/domain');
const { listingTag, storefrontTag, tenantConfigTag } = await import('./cache-tags');
const { STOREFRONT_MISS_LIFE } = await import('./cache-life');

const SLUG = 'nortecel';
const LISTING_SLUG = 'iphone-14-pro-256-grafito-ab12';
const LISTING_ID = '3f2b1a90-7c4d-4e21-9b8a-0c1d2e3f4a5b';

/**
 * Lo que `toSource()` le pasa a `publicListingDTO()` en el camino feliz. Se devuelve desde el mock
 * de la transacción, que es exactamente el valor que `getStorefrontListing` recibe del `await`.
 */
function source(overrides: Record<string, unknown> = {}) {
  return {
    id: LISTING_ID,
    slug: LISTING_SLUG,
    tenantSlug: SLUG,
    tenantWaPhone: '5492994123456',
    title: 'iPhone 14 Pro 256 Grafito',
    nameSource: 'catalog',
    modelDisplayName: 'iPhone 14 Pro',
    storageGb: 256,
    color: 'Grafito',
    condition: 'used_excellent',
    batteryPct: 89,
    screenOriginal: true,
    icloudStatusText: 'Libre de iCloud',
    warrantyText: '3 meses de garantía del local',
    provenanceText: 'Compra a particular en Neuquén',
    description: 'Impecable.',
    priceUsdCents: 62_000,
    // El TC ya viene como `FxRate` del dominio, igual que en `toSource()`: acá no se inventa un
    // número suelto porque `applyFx` lo rechaza, y tiene razón.
    fxRate: fxRateFromDecimal('1487.50'),
    fxRounding: 'ceil_1000',
    status: 'available',
    photos: [
      {
        cardUrl: 'https://img.maat.work/c/ab34cd56ef78/card.webp',
        detailUrl: 'https://img.maat.work/d/ab34cd56ef78/detail.webp',
        alt: 'Frente del equipo',
      },
    ],
    pickupPoints: [
      { name: 'Cipolletti centro', address: 'Fernández Oro 123', hours: 'Lun a Vie 10 a 18' },
    ],
    paymentMethods: ['Efectivo', 'Transferencia'],
    acceptsTradeIn: true,
    ...overrides,
  };
}

beforeEach(() => {
  tagged.length = 0;
  lives.length = 0;
  dbResult = null;
  withStorefrontDb.mockReset();
});

describe('ficha · el camino positivo NO registra el tag del catálogo', () => {
  it('registra tenant-config y listing:{uuid}, y nada más', async () => {
    dbResult = source();

    const dto = await getStorefrontListing(SLUG, LISTING_SLUG);

    expect(dto).not.toBeNull();
    // Los literales van a mano y contra los constructores: el renombre de un tag de un solo lado
    // no rompe nada en runtime, y esa es toda la razón por la que este test existe.
    expect(tagged).toEqual([`tenant-config:${SLUG}`, `listing:${LISTING_ID}`]);
    expect(tagged).toEqual([tenantConfigTag(SLUG), listingTag(LISTING_ID)]);
  });

  /**
   * **La aserción de S6.1.** Si alguien devuelve `storefrontTag(slug)` al `cacheTag()` de arriba de
   * `getStorefrontListing`, esto se cae. Verificado poniéndolo a mano: sin esta línea, una reserva
   * en un tenant de 60 equipos vuelve a purgar 61 páginas y nada más se pone rojo.
   */
  it('la ficha publicada no muere cuando se publica OTRA unidad del mismo tenant', async () => {
    dbResult = source();

    await getStorefrontListing(SLUG, LISTING_SLUG);

    expect(tagged).not.toContain(storefrontTag(SLUG));
  });

  /**
   * `tenant-config` se queda a propósito: el TC, los puntos de retiro y los medios de pago salen en
   * la ficha. Es también lo que hace que `invalidateStorefront()` (alta del tenant, cambio de
   * config), que emite `storefront` + `tenant-config`, siga matando esta entrada.
   */
  it('un cambio de config del tenant sigue purgando la ficha', async () => {
    dbResult = source();

    await getStorefrontListing(SLUG, LISTING_SLUG);

    expect(tagged).toContain(tenantConfigTag(SLUG));
  });

  it('el camino positivo se guarda con el perfil largo', async () => {
    dbResult = source();

    await getStorefrontListing(SLUG, LISTING_SLUG);

    expect(lives).toEqual(['max']);
  });
});

describe('ficha · el miss SÍ registra el tag del catálogo', () => {
  /**
   * El caso que obliga a esto: el equipo está en `draft`, el link ya circula, alguien lo abre y la
   * respuesta negativa queda cacheada. `listing:{uuid}` no está en esa entrada —se registra después
   * del `await` y sólo si la unidad es visible—, así que si el miss tampoco llevara
   * `storefront:{slug}`, publicar la unidad no purgaría **nada** y la ficha seguiría diciendo "este
   * equipo ya no está publicado" hasta 15 minutos (`MISS_EXPIRE_SECONDS`). Sin error y sin log.
   */
  it('la unidad que no existe todavía queda registrada bajo un tag que el panel emite al publicar', async () => {
    dbResult = null;

    const dto = await getStorefrontListing(SLUG, LISTING_SLUG);

    expect(dto).toBeNull();
    expect(tagged).toEqual([tenantConfigTag(SLUG), storefrontTag(SLUG)]);
    expect(tagged).not.toContain(listingTag(LISTING_ID));
  });

  it('la unidad que existe pero no es pública cae por el mismo camino', async () => {
    // `draft` no está en `PUBLIC_STATUSES`: la fila puede llegar acá por una lectura vieja o por
    // una policy aflojada, y `publicListingDTO` tiraría. Es un miss, y es un miss *publicable*.
    dbResult = source({ status: 'draft' });

    expect(await getStorefrontListing(SLUG, LISTING_SLUG)).toBeNull();
    expect(tagged).toContain(storefrontTag(SLUG));
    expect(tagged).not.toContain(listingTag(LISTING_ID));
  });

  it('el subdominio reservado contesta el miss sin abrir una conexión, y también lleva el tag', async () => {
    expect(await getStorefrontListing('www', LISTING_SLUG)).toBeNull();

    expect(withStorefrontDb).not.toHaveBeenCalled();
    expect(tagged).toEqual([tenantConfigTag('www'), storefrontTag('www')]);
  });

  /**
   * Se compara contra `STOREFRONT_MISS_LIFE` y **no** contra los tres enteros escritos a mano. Los
   * números viven en un solo archivo (`_lib/cache-life.ts`, que es lo que audita `guard-leaks.sh`
   * §6); repetirlos acá sería una segunda copia que deriva, y además pondría un `revalidate: 300`
   * en un archivo de la vidriera, que es exactamente el patrón que §6d busca. Lo que este test
   * afirma es la *elección de polo*: el miss no se guarda con el perfil del camino positivo.
   */
  it('el miss se guarda con el perfil corto, no con el largo', async () => {
    dbResult = null;

    await getStorefrontListing(SLUG, LISTING_SLUG);

    expect(lives).toEqual([STOREFRONT_MISS_LIFE]);
    expect(lives).not.toContain('max');
  });
});

describe('ficha · el slug sin forma de slug no registra NADA', () => {
  /**
   * Y no es un olvido: un slug que no pasa `isSlugShaped` no puede entrar en `tenants` (CHECK
   * `tenants_slug_format`), así que no hay publicación futura que lo vuelva válido y no hay evento
   * que invalidar. Encima `storefrontTag()` tiraría, y un throw de render bajo `cacheComponents` +
   * PPR no es un 500: es un stream que no cierra con el `200` ya emitido.
   */
  it('ni tenant-config ni storefront, y sin tocar Postgres', async () => {
    expect(await getStorefrontListing('NO-ES-UN-SLUG', LISTING_SLUG)).toBeNull();
    expect(await getStorefrontListing(SLUG, 'no es un slug de ficha')).toBeNull();

    expect(tagged).toEqual([]);
    expect(withStorefrontDb).not.toHaveBeenCalled();
  });
});

describe('grilla · el tag del catálogo es SUYO y se queda donde está', () => {
  /**
   * La contracara de la slice, y la mitad que no se puede tocar: `storefront:{slug}` existe para
   * purgar **esta** página. Sacárselo a la grilla dejaría que publicar una unidad no actualice el
   * catálogo, que es el bug opuesto y peor (el dueño carga 15 equipos y no los ve).
   */
  it('la grilla registra storefront:{slug} además de tenant-config', async () => {
    await getStorefrontCatalog('www');

    expect(tagged).toEqual([storefrontTag('www'), tenantConfigTag('www')]);
  });
});
