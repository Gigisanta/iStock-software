/**
 * PROBE DEL LEAD PARA S2 — no es el test de `packages/media`, es su verificación independiente.
 *
 * `CLAUDE.md` regla 2: el LEAD re-ejecuta el comando de aceptación y no le cree al subagente. El
 * paquete tiene su propia suite (96 tests) y está verde; esto NO la reemplaza. Mide de nuevo, con
 * literales escritos a mano acá, lo único que el board pide para dar S2 por buena:
 *
 *     "3 variantes generadas; `card` ≤150KB medido"
 *
 * Vive en `scripts/probes/` (columna del LEAD) y no en `packages/media/src/` a propósito: si el
 * gate escribiera dentro del paquete que audita, sería el mismo writer de las dos puntas.
 *
 * Se corre desde `scripts/accept-s2.sh`, que lo invoca con la instalación de `packages/media`
 * (ahí vive `sharp`) y `--root ../..`.
 */
import { describe, expect, it } from 'vitest';
import { uploadListingPhoto } from '../../packages/media/src/upload';
import { buildVariants } from '../../packages/media/src/pipeline';
import { VARIANTS } from '../../packages/media/src/types';
import type { MediaBucket, PutObjectInput, StorageDriver } from '../../packages/media/src/storage/driver';
import { referencePhotoJpeg } from '../../packages/media/src/fixtures/reference-image';

/**
 * Techos en bytes, COPIADOS A MANO desde `CLAUDE.md` §3 y la skill `r2-media`. No se importan de
 * `budgets.ts` a propósito: si el techo se lee del código bajo test, subir la constante pone el
 * gate en verde y el gate deja de ser un gate.
 */
const TECHO = { thumb: 25 * 1024, card: 150 * 1024, detail: 400 * 1024 } as const;

/** Ids reales de la corrida: lo que NO puede aparecer en ninguna key pública. */
const TENANT_ID = '3f2a91c4-5b6d-4e7f-8a9b-0c1d2e3f4a5b';
const LISTING_ID = '7d8e9f0a-1b2c-4d3e-9f8a-6b5c4d3e2f1a';

function spyDriver(): { driver: StorageDriver; puts: PutObjectInput[] } {
  const puts: PutObjectInput[] = [];
  const driver: StorageDriver = {
    name: 'spy',
    put: async (input) => { puts.push(input); },
    head: async () => null,
    get: async () => null,
    delete: async () => { throw new Error('el probe no borra nada'); },
  };
  return { driver, puts };
}

/** Cable trampa del master: 2,6× los 306,6 KB medidos. Ver el bloque que lo usa. */
const MASTER_MAX_BYTES = 800 * 1024;

describe('S2 · el pipeline entrega lo que el board pide', () => {
  it('genera exactamente 3 variantes y ninguna pasa su techo', async () => {
    const fuente = await referencePhotoJpeg();
    const out = await buildVariants(fuente);
    const nombres = Object.keys(out.variants).sort();

    expect(nombres).toEqual(['card', 'detail', 'thumb']);
    expect(VARIANTS.length).toBe(3);

    for (const v of nombres as Array<keyof typeof TECHO>) {
      const bytes = out.variants[v].bytes.length;
      // eslint-disable-next-line no-console -- el probe reporta al gate; no hay listing acá.
      console.log(`MEDIDO ${v}=${String(bytes)}B techo=${String(TECHO[v])}B ${out.variants[v].width}x${out.variants[v].height}`);
      expect(bytes).toBeLessThanOrEqual(TECHO[v]);
      expect(bytes).toBeGreaterThan(0);
    }
    // La fuente tiene que ser de verdad una foto de celular, o el techo no prueba nada.
    expect(fuente.length).toBeGreaterThan(2 * 1024 * 1024);
    expect(out.variants.card.bytes.length).toBeLessThan(fuente.length / 10);
  }, 180_000);

  it('sube 4 objetos: 3 públicos + el master al bucket privado, y ni uno más', async () => {
    const { driver, puts } = spyDriver();
    const fuente = await referencePhotoJpeg();
    await uploadListingPhoto(
      { tenantId: TENANT_ID, listingId: LISTING_ID, data: fuente },
      { driver },
    );
    expect(puts.length).toBe(4);

    // ───────────────────────────────────────────────────────────────────────────────────────
    //  Los bytes del MASTER, que hasta el 2026-08-28 no los medía nadie.
    // ───────────────────────────────────────────────────────────────────────────────────────
    // El gate verificaba el bucket y la FORMA de la key del master, y no su tamaño. Lo levantó
    // `cost-auditor` auditando S2: el master es el **62,7% de los bytes almacenados** por foto
    // (306,6 KB de 489 KB), o sea el renglón de storage más grande del producto, y era el único
    // de los cuatro objetos sin techo. Un gate que mide las tres variantes chicas y deja libre
    // la grande mide lo que es fácil de medir.
    //
    // El techo NO es un número de gusto. Son las dos cosas que `CLAUDE.md` §5 ya prohíbe
    // ("resize en el upload; nada de 12MP entrando a R2 sin procesar"), escritas como aserción:
    //   1. relativa: el master pesa MENOS que el archivo que entró ⇒ se procesó de verdad.
    //      Ésta es la que atrapa un `put(data)` del original con otro nombre.
    //   2. absoluta: 800 KB. Holgado contra los 306,6 KB medidos (2,6×) a propósito — no es un
    //      presupuesto que optimizar, es un cable trampa para el día que alguien suba el JPEG
    //      del celular sin pasar por `buildVariants`.
    const master = puts.find((p) => p.bucket === 'originals');
    expect(master).toBeDefined();
    const masterBytes = master!.body.length;
    const totalBytes = puts.reduce((acc, p) => acc + p.body.length, 0);
    console.log(
      `MEDIDO master=${String(masterBytes)}B techo=${String(MASTER_MAX_BYTES)}B ` +
        `fuente=${String(fuente.length)}B · total 4 objetos=${String(totalBytes)}B`,
    );
    expect(masterBytes).toBeLessThan(fuente.length);
    expect(masterBytes).toBeLessThanOrEqual(MASTER_MAX_BYTES);
    const porBucket = puts.reduce<Record<string, number>>((acc, p) => {
      acc[p.bucket as MediaBucket] = (acc[p.bucket as MediaBucket] ?? 0) + 1;
      return acc;
    }, {});
    expect(porBucket).toEqual({ media: 3, originals: 1 });
  }, 180_000);

  it('ninguna key pública contiene ni permite derivar un identificador interno', async () => {
    const { driver, puts } = spyDriver();
    const subida = await uploadListingPhoto(
      { tenantId: TENANT_ID, listingId: LISTING_ID, data: await referencePhotoJpeg() },
      { driver },
    );

    const publicas = puts.filter((p) => p.bucket === 'media').map((p) => p.key);
    const master = puts.find((p) => p.bucket === 'originals');
    expect(publicas.length).toBe(3);
    expect(master).toBeDefined();

    for (const key of publicas) {
      expect(key).toMatch(/^v1\/[0-9a-f]{2}\/[0-9a-f]{32}\.webp$/u);
      expect(key).not.toContain(TENANT_ID);
      expect(key).not.toContain(LISTING_ID);
      // Sin guiones tampoco: un uuid sin guiones sigue siendo el uuid.
      expect(key).not.toContain(TENANT_ID.replace(/-/gu, ''));
      expect(key).not.toContain(LISTING_ID.replace(/-/gu, ''));
      // Sin sufijo de variante: `...card.webp` permitiría adivinar las otras dos.
      expect(key).not.toMatch(/(thumb|card|detail|master|original)/u);
    }
    // Desde una key pública no se llega al master: no comparten hash ni prefijo de objeto.
    const hashes = new Set(publicas.map((k) => k.split('/')[2]));
    expect(hashes.has(master!.key.split('/')[2] ?? '')).toBe(false);
    expect(publicas).not.toContain(master!.key);
    expect(subida.masterKey).toBe(master!.key);
  }, 180_000);

  it('las variantes públicas salen con Cache-Control inmutable', async () => {
    const { driver, puts } = spyDriver();
    await uploadListingPhoto(
      { tenantId: TENANT_ID, listingId: LISTING_ID, data: await referencePhotoJpeg() },
      { driver },
    );
    for (const p of puts.filter((x) => x.bucket === 'media')) {
      expect(p.cacheControl).toMatch(/immutable/u);
      expect(p.contentType).toBe('image/webp');
    }
  }, 180_000);
});
