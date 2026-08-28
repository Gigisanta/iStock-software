/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Una foto que no se puede servir NO APARECE en la ficha, y la ficha se sigue sirviendo
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `variantUrl()` dejó de tirar —correcto: bajo `cacheComponents` una excepción adentro de un render
 * cacheado no es un 500 sino un 200 que nunca cierra el stream, y la ficha queda colgada hasta el
 * timeout— y pasó a devolver el sentinel `about:invalid`. Ese cambio arregla el cuelgue y deja un
 * defecto más chico y más visible en su lugar: una fila con la key rota entraba igual a la lista y
 * la ficha mostraba un `<img>` que falla, con el `alt` adentro de la caja gris.
 *
 * Este archivo afirma las **dos mitades** de la decisión, que se rompen por separado:
 *
 * 1. la foto rota **no se lista** (`renderableVariantUrls` + `continue`, no `variantUrl`);
 * 2. la ficha **sigue existiendo**: devuelve DTO, con precio, condición, retiro y `wa.me`. Omitir
 *    una foto no puede convertirse en "este equipo ya no está publicado", que sería mentirle a
 *    quien abrió el link desde un estado de WhatsApp por una falla de *nuestra* capa de media.
 *
 * Y una tercera que no es de UI: la omisión **se reporta**. Una foto que desaparece en silencio es
 * un bug que nadie va a abrir por soporte — el comprador no sabe que faltaba una foto y el dueño no
 * mira la ficha pública todos los días.
 *
 * ## Por qué acá se ejecuta la transacción de verdad (y en `listings.test.ts` no)
 * `listings.test.ts` pregunta por **tags de cache**, así que le alcanza con que `withStorefrontDb`
 * devuelva el resultado ya armado. La pregunta de este archivo es lo que pasa **adentro** de la
 * transacción, en `photosByListing`, así que el mock corre el callback contra un stub de query que
 * devuelve filas planeadas en orden. Son ~20 líneas de andamio y compran el código real: el
 * `select`, el agrupado por listing, el mapeo a `PhotoSource` y el `publicListingDTO` del final.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({
  cacheTag: () => undefined,
  cacheLife: () => undefined,
}));

/**
 * Filas que va a devolver la transacción, **en el orden en que el read model las pide**. Cada
 * `await` de una cadena de Drizzle consume una entrada.
 */
let planned: unknown[][] = [];

/** Stub de query: toda la cadena devuelve `this`, y el `await` final saca la próxima tanda. */
function queryStub(): unknown {
  const stub: Record<string, unknown> = {};
  for (const method of ['select', 'from', 'leftJoin', 'where', 'limit', 'orderBy']) {
    stub[method] = () => stub;
  }
  stub.then = (resolve: (rows: unknown[]) => unknown, reject: (err: unknown) => unknown) =>
    Promise.resolve(planned.shift() ?? []).then(resolve, reject);
  return stub;
}

vi.mock('./storefront-db', () => ({
  withStorefrontDb: (_slug: string, run: (tx: unknown) => Promise<unknown>) => run(queryStub()),
}));

const { getStorefrontCatalog, getStorefrontListing } = await import('./listings');
const { setMediaIncidentReporter, resetMediaIncidentReporter, UNRENDERABLE_VARIANT_URL } =
  await import('@istock/media');
const { MIN_PHOTOS_TO_PUBLISH } = await import('@istock/domain');

const SLUG = 'nortecel';
const LISTING_SLUG = 'iphone-14-pro-256-grafito-ab12';
const TENANT_ID = '0f5a6c3d-9e21-4b77-8a10-1c2d3e4f5a6b';
const LISTING_ID = '3f2b1a90-7c4d-4e21-9b8a-0c1d2e3f4a5b';

/**
 * Una key pública válida a partir de un hash de 32 hex. La forma la define `packages/media`
 * (ADR-006, `v1/{ab}/{sha256_32}`); acá se reconstruye **sólo para plantar filas de test**, que es
 * la única razón por la que este archivo puede escribir una key y ningún archivo de la app puede.
 */
const EXT = '.webp';
function variantKey(hash32: string): string {
  return ['v1', hash32.slice(0, 2), hash32 + EXT].join('/');
}

/** Tres keys distintas para una foto sana: thumb, card y detail no comparten byte. */
function healthyPhoto(alt: string, seed: string) {
  return {
    listingId: LISTING_ID,
    alt,
    thumbKey: variantKey(`${seed}1`.repeat(16).slice(0, 32)),
    cardKey: variantKey(`${seed}2`.repeat(16).slice(0, 32)),
    detailKey: variantKey(`${seed}3`.repeat(16).slice(0, 32)),
  };
}

const TENANT_ROWS = [
  {
    id: TENANT_ID,
    slug: SLUG,
    waPhone: '5492994123456',
    paymentMethods: ['Efectivo', 'Transferencia'],
    acceptsTradeIn: true,
  },
];

const LISTING_ROWS = [
  {
    id: LISTING_ID,
    slug: LISTING_SLUG,
    title: 'iPhone 14 Pro 256 Grafito',
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
    status: 'available',
    modelDisplayName: 'iPhone 14 Pro',
  },
];

/** TC en centavos de ARS por USD, como lo guarda `fx_settings`. */
const FX_ROWS = [{ arsPerUsd: 148_750, rounding: 'ceil_1000' }];
const PICKUP_ROWS = [
  { name: 'Cipolletti centro', address: 'Fernández Oro 123', hours: 'Lun a Vie 10 a 18' },
];

/** El orden exacto de consultas de la ficha: tenant → unidad → TC → retiro → fotos. */
function planListing(photoRows: readonly unknown[]): void {
  planned = [TENANT_ROWS, LISTING_ROWS, FX_ROWS, PICKUP_ROWS, [...photoRows]];
}

const incidents: Array<{ code: string; reason: string; keyPrefix: string }> = [];

beforeEach(() => {
  planned = [];
  incidents.length = 0;
  setMediaIncidentReporter((incident) => {
    incidents.push({
      code: incident.code,
      reason: incident.reason,
      keyPrefix: incident.keyPrefix,
    });
  });
});

afterEach(() => {
  resetMediaIncidentReporter();
});

describe('la foto con key inválida no aparece en la ficha', () => {
  it('se listan las sanas y la rota no deja ni un `about:invalid` en el DTO', async () => {
    // Una key que no es la que produce `publicVariantKey`. Da igual cuál sea el defecto: lo que se
    // afirma es que la fila no se puede creer, no un motivo de rechazo puntual.
    const broken = { ...healthyPhoto('Lateral', 'b'), cardKey: 'no-es-una-key-de-media' };
    planListing([healthyPhoto('Frente', 'a'), broken, healthyPhoto('Dorso', 'c')]);

    const dto = await getStorefrontListing(SLUG, LISTING_SLUG);

    expect(dto).not.toBeNull();
    expect(dto?.photos).toHaveLength(2);
    expect(dto?.photos.map((photo) => photo.alt)).toEqual(['Frente', 'Dorso']);

    // La aserción que se caería con `variantUrl()`: el sentinel entraba a `card` **y** a `detail`
    // de la fila rota, y el browser mostraba dos huecos con el `alt` adentro.
    const urls = (dto?.photos ?? []).flatMap((photo) => [photo.card, photo.detail]);
    expect(urls).not.toContain(UNRENDERABLE_VARIANT_URL);
    expect(urls.join(' ')).not.toMatch(/about:invalid/u);
  });

  it('la foto rota se omite ENTERA: no se sirve `detail` sin `card` ni al revés', async () => {
    // `renderableVariantUrls` es todo-o-nada por foto, y no es una preferencia estética: el
    // `srcSet` de `_lib/photo.ts` nombra los dos tamaños, así que media foto servible produce un
    // `srcset` con un candidato que no carga.
    planListing([{ ...healthyPhoto('Frente', 'a'), detailKey: 'roto' }]);

    const dto = await getStorefrontListing(SLUG, LISTING_SLUG);

    expect(dto?.photos).toEqual([]);
  });

  it('la grilla omite la misma foto por el mismo camino', async () => {
    planned = [
      TENANT_ROWS,
      LISTING_ROWS,
      FX_ROWS,
      PICKUP_ROWS,
      [healthyPhoto('Frente', 'a'), { ...healthyPhoto('Lateral', 'b'), cardKey: '' }],
    ];

    const catalog = await getStorefrontCatalog(SLUG);

    expect(catalog.listings).toHaveLength(1);
    expect(catalog.listings[0]?.photos).toHaveLength(1);
    expect(catalog.publishedCount).toBe(1);
  });
});

describe('la ficha se sigue renderizando aunque no quede ninguna foto', () => {
  /**
   * La decisión de la slice, escrita como test: **cero fotos servibles no es un miss.** El equipo
   * está publicado, el precio y el punto de retiro son reales y el link salió de un estado de
   * WhatsApp. Devolver `null` acá haría que la página conteste "este equipo ya no está publicado"
   * —una mentira— y perdería una venta real por una falla de nuestra capa de media.
   */
  it('sin fotos servibles la ficha sigue devolviendo DTO, con precio, retiro y wa.me', async () => {
    planListing([
      { ...healthyPhoto('Frente', 'a'), cardKey: 'roto' },
      { ...healthyPhoto('Lateral', 'b'), thumbKey: 'roto' },
      { ...healthyPhoto('Dorso', 'c'), detailKey: 'roto' },
    ]);

    const dto = await getStorefrontListing(SLUG, LISTING_SLUG);

    expect(dto).not.toBeNull();
    expect(dto?.photos).toEqual([]);
    // Lo que la persona parada en la calle sí puede usar sigue estando entero.
    expect(dto?.title).toBe('iPhone 14 Pro 256 Grafito');
    expect(dto?.conditionLabel.length).toBeGreaterThan(0);
    expect(dto?.priceUsd.cents).toBe(62_000);
    expect(dto?.priceArs.cents).toBeGreaterThan(0);
    expect(dto?.status).toBe('available');
    expect(dto?.pickup).toHaveLength(1);
    expect(dto?.waUrl).toMatch(/^https:\/\/wa\.me\//u);
  });

  it('la ficha puede quedar por debajo del mínimo de publicación y aun así se sirve', async () => {
    // `MIN_PHOTOS_TO_PUBLISH` gobierna el **panel** (qué se puede publicar), no la vidriera (qué se
    // muestra de lo ya publicado). Confundirlos es cómo una foto rota se convierte en un 404.
    planListing([healthyPhoto('Frente', 'a'), { ...healthyPhoto('Lateral', 'b'), cardKey: 'x' }]);

    const dto = await getStorefrontListing(SLUG, LISTING_SLUG);

    expect(dto?.photos.length).toBeLessThan(MIN_PHOTOS_TO_PUBLISH);
    expect(dto).not.toBeNull();
  });
});

describe('la omisión es observable, y no filtra la key', () => {
  it('omitir una foto emite un incidente que nombra a la vidriera', async () => {
    planListing([healthyPhoto('Frente', 'a'), { ...healthyPhoto('Lateral', 'b'), cardKey: 'roto' }]);

    await getStorefrontListing(SLUG, LISTING_SLUG);

    // Dos capas de reporte, y las dos hacen falta: `packages/media` dice *qué key no sirve*, la
    // vidriera dice *que se publicó una foto menos*. Sin la segunda, un `continue` mudo deja una
    // ficha perdiendo fotos de a una sin que nada se ponga rojo.
    expect(incidents.some((i) => /omitida de la vidriera/u.test(i.reason))).toBe(true);
    expect(incidents.every((i) => i.code === 'MEDIA_UNSAFE_KEY')).toBe(true);
  });

  it('la foto sana no reporta nada: el canal no se llena de ruido', async () => {
    planListing([healthyPhoto('Frente', 'a'), healthyPhoto('Lateral', 'b')]);

    const dto = await getStorefrontListing(SLUG, LISTING_SLUG);

    expect(dto?.photos).toHaveLength(2);
    expect(incidents).toEqual([]);
  });

  it('ningún incidente contiene la key entera: es content-addressed y lleva al master', async () => {
    const key = variantKey('dd'.repeat(16));
    // Key con forma válida en `card`, rota en `detail`: la fila se omite y el reporte de la
    // vidriera **no** puede repetir lo que sí es una key servible del bucket público.
    planListing([{ ...healthyPhoto('Frente', 'a'), cardKey: key, detailKey: 'roto' }]);

    await getStorefrontListing(SLUG, LISTING_SLUG);

    expect(incidents.length).toBeGreaterThan(0);
    for (const incident of incidents) {
      expect(JSON.stringify(incident)).not.toContain(key);
      expect(incident.keyPrefix.length).toBeLessThanOrEqual(13);
    }
  });
});
