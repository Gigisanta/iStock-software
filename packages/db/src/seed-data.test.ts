/**
 * Las keys del seed tienen que tener **la forma real** de ADR-006, no una parecida.
 *
 * ## Por qué existe este archivo
 * `seedMasterKey` emitía `originals/{2hex}/{32hex}.jpg`. La forma del master es
 * `originals/{tenant_id}/{listing_id}/{32hex}.webp`. Ni los segmentos ni la extensión. Como el
 * seed no sube un byte a R2 y nadie leía todavía `master_key`, el bug estaba **latente y verde**:
 * la primera víctima iba a ser un job de GC o de inventario filtrando por esa forma, que habría
 * ignorado en silencio todas las filas del demo.
 *
 * ## Por qué los regex están copiados a mano y NO importados de `@istock/media`
 * Es deliberado y es el punto del test. Si importara `isMasterObjectKey`, el día que `packages/media`
 * afloje o cambie su contrato, este test se adaptaría solo y seguiría verde mientras el seed
 * produce basura distinta. Copiado a mano, un cambio de contrato allá pone **rojo** acá y obliga a
 * que un humano mire las dos puntas. Es la misma razón por la que los techos de bytes viven
 * duplicados en el test de `media`: un contrato entre dos paquetes se verifica desde los dos lados
 * o no se verifica.
 *
 * Si este test se pone rojo: NO lo relajes. Andá a `packages/media/src/keys.ts`, mirá qué cambió
 * y decidí a mano si el seed tiene que seguirlo.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Lo que este archivo AFIRMABA de más y era falso: `IMEI_RE = /\d{15}/` sobre la key pública
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Hasta el 2026-08-28 había acá una tercera copia de `/\d{15}/` y una aserción que decía
 * `filtra 15 dígitos seguidos: ${key}` sobre un string que es **un hash hexadecimal**. Estaba
 * verde por suerte, no por diseño.
 *
 * La cuenta: en hex un dígito sale con probabilidad 10/16, así que 32 hex contienen 15 dígitos
 * seguidos el **0,64 %** de las veces (medido acá mismo sobre 200.000 keys con la construcción de
 * `seedMediaKey`: 1.281 pegan; el cálculo cerrado de `packages/media` da 0,639 %). O sea: cada
 * listing que alguien agregue al seed traía ~1,9 % de chance (3 variantes) de poner este archivo
 * rojo con un mensaje que acusa de filtrar un IMEI a una key que no filtra absolutamente nada.
 * Un test que falla por azar entrena a que se lo ignore, y ese es el daño real.
 *
 * **No se aflojó nada: se dejó de preguntar donde la respuesta no significaba nada.** Lo que
 * reemplaza a esa aserción es más fuerte, no más débil: la key tiene que ser **carácter por
 * carácter la que el constructor canónico habría escrito** (`canonicalVariantKeyProblem`). Una
 * key que round-trippea no tiene dónde esconder un IMEI: son tres segmentos, el del medio se
 * **deriva** del último, y el último es 32 hex. Todo lo que no es el hash es `v1/` + 2 hex que
 * salen del hash + `.webp`. La pregunta vieja no se podía contestar; ésta sí, y además agarra
 * cosas que la vieja no veía (sufijo de variante, shard libre, segmento de más).
 *
 * La aserción de UUID (`UUID_ANYWHERE_RE`) **se queda tal cual**: un UUID lleva guiones, que no
 * existen en `[0-9a-f]{32}`, así que sobre una key canónica no puede dar falso positivo — y un
 * UUID en la key sería un `tenant_id`/`listing_id`, que es lo que prohíbe `CLAUDE.md` §2.
 *
 * Precedente: `packages/media/src/keys.ts` se arregló por este mismo defecto (ver el bloque
 * "Por qué el escáner de PII NO mira el segmento de hash"). Acá **no** se importa su gate; el
 * motivo está en `canonicalVariantKeyProblem`.
 */

import { describe, expect, it } from 'vitest';
import {
  SEED_LISTINGS,
  SEED_MODELS,
  SEED_TENANT_ID,
  seedMasterKey,
  seedMediaKey,
} from './seed-data';

// ── Contrato COPIADO A MANO de packages/media/src/keys.ts (no importar de allá) ────────────────

/** `originals/{uuid}/{uuid}/{32 hex}.webp`. Bucket privado, nunca en una URL. */
const MASTER_KEY_RE = /^originals\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f]{32}\.webp$/;
/** `v1/{2 hex}/{32 hex}.webp` y nada más. */
const PUBLIC_KEY_RE = /^v1\/[0-9a-f]{2}\/[0-9a-f]{32}\.webp$/;
/** Un UUID en cualquier parte de la key pública es un `tenant_id`/`listing_id` filtrado. */
const UUID_ANYWHERE_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Versión literal del esquema de keys públicas (ADR-006). */
const PUBLIC_KEY_VERSION = 'v1';
/** Extensión de toda variante pública. */
const PUBLIC_KEY_EXT = '.webp';
/** El segmento que genera el constructor: SHA-256 truncado a 32 hex minúsculas. */
const HASH_SEGMENT_RE = /^[0-9a-f]{32}$/;

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  La propiedad que el seed sí tiene que cumplir, y que se puede afirmar sin mentir
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Devuelve el motivo del rechazo, o `null` si `key` es **exactamente** lo que el constructor
 * canónico de ADR-006 habría escrito. Las cinco condiciones son las mismas que
 * `parseCanonicalVariantKey` de `packages/media`, y están acá por la misma razón que
 * `PUBLIC_KEY_RE` y `MASTER_KEY_RE`: es un contrato entre dos paquetes y se verifica desde los
 * dos lados o no se verifica.
 *
 * ## Por qué esto NO se importa de `@istock/media` (decisión para el LEAD, no improvisada)
 * `publicVariantKeyProblem` haría este chequeo y más, pero `packages/db` **no puede importarlo
 * hoy** por tres razones concretas, ninguna estética:
 *
 *   1. `@istock/media` exporta **sólo** `.` — no hay subpath `./keys`. Importar el gate arrastra
 *      todo `src/index.ts`, y con él `./upload → ./pipeline → sharp` (binario nativo) y
 *      `./storage → @aws-sdk/client-s3`. `packages/db` corre migraciones y seed; meterle un
 *      encoder de imágenes al grafo de `pnpm --filter @istock/db test` es caro y frágil.
 *   2. **Invierte el layering.** `packages/media` modela filas de esta DB (`ListingPhotoRow`,
 *      `ListingPhotoMappingStore` en `unlink.ts`): media está *arriba* de db. `db → media` no es
 *      un ciclo de módulos hoy, pero es un ciclo conceptual y el primer `import` de db adentro de
 *      media lo vuelve literal.
 *   3. Agregar la dependencia obliga a un `pnpm install` que reescribe `pnpm-lock.yaml`, que está
 *      **fuera de la columna de `db-agent`**.
 *
 * Lo que NO se hizo, y era la trampa: copiar el `/\d{15}/` de media. Esa copia era la causa del
 * defecto que este bloque reemplaza. Acá no hay ningún escáner de PII copiado; hay una
 * **derivación**, que es otra cosa: se re-arma la key desde sus propias partes y se compara.
 */
function canonicalVariantKeyProblem(key: string): string | null {
  const segments = key.split('/');
  if (segments.length !== 3) {
    return `tiene ${String(segments.length)} segmentos, no 3`;
  }
  const [version, shard, file] = segments;
  if (version !== PUBLIC_KEY_VERSION) {
    return `la versión no es "${PUBLIC_KEY_VERSION}" literal (recibido: "${String(version)}")`;
  }
  if (shard === undefined || file === undefined) {
    return 'faltan segmentos';
  }
  if (!file.endsWith(PUBLIC_KEY_EXT)) {
    return `no termina en "${PUBLIC_KEY_EXT}"`;
  }
  const hash = file.slice(0, file.length - PUBLIC_KEY_EXT.length);
  if (!HASH_SEGMENT_RE.test(hash)) {
    return `el segmento de hash no es 32 hex minúsculas (recibido: "${hash}")`;
  }
  if (shard !== hash.slice(0, 2)) {
    return `el shard "${shard}" no se deriva del hash (debería ser "${hash.slice(0, 2)}")`;
  }
  const rebuilt = `${PUBLIC_KEY_VERSION}/${shard}/${hash}${PUBLIC_KEY_EXT}`;
  if (rebuilt !== key) {
    return `no round-trippea: el constructor habría escrito "${rebuilt}"`;
  }
  return null;
}

/** El seed inserta exactamente 3 fotos por ficha (mínimo del gate de publicación). */
const PHOTOS_PER_LISTING = 3;

const PUBLIC_VARIANTS = ['thumb', 'card', 'detail'] as const;

interface SeedPhotoKeys {
  readonly listingSlug: string;
  readonly listingId: string;
  readonly index: number;
  readonly masterKey: string;
  readonly publicKeys: readonly string[];
}

/**
 * Reproduce **lo que `seed.ts` inserta de verdad** en `listing_photos`, con los mismos argumentos.
 * Si el call site del seed cambia de forma, este helper deja de representarlo y hay que tocarlo:
 * eso es intencional, es el acoplamiento que hace que el test valga algo.
 */
function seedPhotoKeys(): SeedPhotoKeys[] {
  const out: SeedPhotoKeys[] = [];
  for (const item of SEED_LISTINGS) {
    for (let i = 0; i < PHOTOS_PER_LISTING; i += 1) {
      out.push({
        listingSlug: item.slug,
        listingId: item.id,
        index: i,
        masterKey: seedMasterKey({
          tenantId: SEED_TENANT_ID,
          listingId: item.id,
          listingSlug: item.slug,
          index: i,
        }),
        publicKeys: PUBLIC_VARIANTS.map((v) => seedMediaKey(item.slug, i, v)),
      });
    }
  }
  return out;
}

describe('seedMasterKey: la key del master del seed matchea el contrato de ADR-006', () => {
  const photos = seedPhotoKeys();

  it('el set de fotos del seed no está vacío (si no, todo lo de abajo pasa por vacío)', () => {
    expect(SEED_LISTINGS.length).toBe(10);
    expect(photos.length).toBe(SEED_LISTINGS.length * PHOTOS_PER_LISTING);
  });

  it('TODA master key matchea originals/{uuid}/{uuid}/{32hex}.webp', () => {
    const malformadas = photos
      .filter((p) => !MASTER_KEY_RE.test(p.masterKey))
      .map((p) => `${p.listingSlug}#${String(p.index)} → ${p.masterKey}`);
    expect(
      malformadas,
      'hay master keys que packages/media rechazaría (isMasterObjectKey === false):\n' +
        malformadas.join('\n'),
    ).toEqual([]);
  });

  it('termina en .webp, nunca en .jpg (el pipeline sólo escribe WebP)', () => {
    for (const p of photos) {
      expect(p.masterKey.endsWith('.webp')).toBe(true);
      expect(p.masterKey.endsWith('.jpg')).toBe(false);
    }
  });

  it('el primer segmento es el tenant y el segundo el listing, en ese orden (no invertidos)', () => {
    // Una key con tenant y listing cruzados matchea el regex igual. Sólo esto lo agarra.
    for (const p of photos) {
      const parts = p.masterKey.split('/');
      expect(parts[0]).toBe('originals');
      expect(parts[1]).toBe(SEED_TENANT_ID);
      expect(parts[2]).toBe(p.listingId);
    }
  });

  it('cada foto tiene su propia key: cero colisiones entre fichas ni entre índices', () => {
    const keys = photos.map((p) => p.masterKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('es determinista: mismos argumentos → misma key (el seed no puede tirar dados)', () => {
    const args = {
      tenantId: SEED_TENANT_ID,
      listingId: SEED_LISTINGS[0]?.id ?? '',
      listingSlug: SEED_LISTINGS[0]?.slug ?? '',
      index: 0,
    };
    expect(seedMasterKey(args)).toBe(seedMasterKey(args));
    expect(seedMasterKey(args)).not.toBe(seedMasterKey({ ...args, index: 1 }));
  });

  it('rechaza un tenantId o un listingId que no sea UUID en vez de emitir una key inválida', () => {
    const base = {
      tenantId: SEED_TENANT_ID,
      listingId: SEED_LISTINGS[0]?.id ?? '',
      listingSlug: 'x',
      index: 0,
    };
    expect(() => seedMasterKey({ ...base, tenantId: 'demo' })).toThrow();
    expect(() => seedMasterKey({ ...base, listingId: 'listing-1' })).toThrow();
    // 36 chars de hex-y-guiones que NO son un UUID: pasarían `[0-9a-f-]{36}` del regex de media.
    expect(() => seedMasterKey({ ...base, listingId: '-'.repeat(36) })).toThrow();
  });
});

describe('seedMediaKey: la key pública sigue siendo opaca', () => {
  const photos = seedPhotoKeys();

  it('TODA key pública matchea v1/{2hex}/{32hex}.webp', () => {
    for (const p of photos) {
      for (const key of p.publicKeys) {
        expect(PUBLIC_KEY_RE.test(key), `key pública inválida: ${key}`).toBe(true);
      }
    }
  });

  it('ninguna key pública contiene un UUID (sería un tenant_id o un listing_id)', () => {
    // Se queda tal cual: un UUID lleva guiones y `[0-9a-f]{32}` no los tiene, así que sobre una
    // key canónica esto no puede dar falso positivo. Lo que agarra —un identificador interno en
    // la URL de una foto— es rechazo directo por CLAUDE.md §2.
    for (const p of photos) {
      for (const key of p.publicKeys) {
        expect(UUID_ANYWHERE_RE.test(key), `filtra un UUID: ${key}`).toBe(false);
      }
    }
  });

  it('TODA key pública es exactamente la que el constructor canónico habría escrito', () => {
    // Reemplaza a la vieja aserción `/\d{15}/`, que sobre un hash hex era falsa el 0,64 % de las
    // veces y no significaba nada el otro 99,36 %. Ver el docblock del archivo.
    const rotas = photos.flatMap((p) =>
      p.publicKeys
        .map((key) => ({ key, problem: canonicalVariantKeyProblem(key) }))
        .filter((r) => r.problem !== null)
        .map((r) => `${p.listingSlug}#${String(p.index)} → ${r.key}: ${String(r.problem)}`),
    );
    expect(rotas, 'hay keys del seed que no son canónicas:\n' + rotas.join('\n')).toEqual([]);
  });

  it('el chequeo de canonicidad NO es vacío: rechaza cada forma de key adulterada', () => {
    // Sin esto, `canonicalVariantKeyProblem` podría degradarse a `() => null` y todo seguiría
    // verde. Un gate que no puede fallar es un adorno.
    const hash = 'a'.repeat(32);
    const casos: readonly (readonly [string, string])[] = [
      ['shard libre, no derivado del hash', `v1/zz/${hash}.webp`],
      ['shard que es hex pero no el del hash', `v1/bb/${hash}.webp`],
      ['sufijo de variante pegado al hash', `v1/aa/${hash}-card.webp`],
      ['segmento de más (jerarquía filtrada)', `v1/aa/tenant/${hash}.webp`],
      ['segmento de menos', `v1/${hash}.webp`],
      ['versión distinta de la literal', `v2/aa/${hash}.webp`],
      ['extensión que el pipeline no escribe', `v1/aa/${hash}.jpg`],
      ['hash en mayúsculas (otra key para el CDN)', `v1/AA/${hash.toUpperCase()}.webp`],
      ['hash más largo que 32 (IMEI concatenado)', `v1/aa/${hash}123456789012345.webp`],
      ['key del master', `originals/${SEED_TENANT_ID}/${SEED_TENANT_ID}/${hash}.webp`],
      ['string vacío', ''],
    ];
    for (const [motivo, key] of casos) {
      expect(canonicalVariantKeyProblem(key), `debería rechazar (${motivo}): ${key}`).not.toBeNull();
    }
    // Y una canónica de verdad tiene que pasar, si no el chequeo rechazaría todo.
    expect(canonicalVariantKeyProblem(`v1/${hash.slice(0, 2)}/${hash}.webp`)).toBeNull();

    // ── La concesión, escrita sin maquillaje (misma que documenta packages/media) ──────────────
    // `123456789012345` + 17 hex = 32 caracteres de `[0-9a-f]`, con su shard derivado: eso ES
    // una key canónica y este chequeo la acepta. No es un agujero de este test, es la definición
    // de content-addressed: un hash puede tener cualquier dígito adentro. Lo que impide que ese
    // string llegue a ser una key no es un escáner, es que **no hay un segundo constructor de
    // keys en el repo** — lo sostienen `guard-r2.sh` R5 y `media-lint` M003, y del lado del seed
    // lo sostiene que `seedMediaKey` derive el hash de un SHA-256 y no de un campo del listing.
    expect(canonicalVariantKeyProblem('v1/12/123456789012345aaaaaaaaaaaaaaaaa.webp')).toBeNull();
  });

  it('desde una variante pública no se deriva otra ni el master (hashes independientes)', () => {
    for (const p of photos) {
      const hashes = p.publicKeys.map((k) => k.split('/')[2]);
      expect(new Set(hashes).size, `dos variantes comparten hash en ${p.listingSlug}`).toBe(
        p.publicKeys.length,
      );
      const masterHash = p.masterKey.split('/')[3];
      expect(hashes).not.toContain(masterHash);
    }
  });

  it('ninguna key pública lleva sufijo de variante (`-card`, `-master`, etc.)', () => {
    for (const p of photos) {
      for (const key of p.publicKeys) {
        expect(key).not.toMatch(/thumb|card|detail|master|original/i);
      }
    }
  });
});

describe('composición del seed demo (gate de aceptación, no decorativo)', () => {
  it('8 iPhones + 2 accesorios', () => {
    const units = SEED_LISTINGS.filter((l) => l.kind === 'unit');
    const lots = SEED_LISTINGS.filter((l) => l.kind === 'lot');
    expect(units.length).toBe(8);
    expect(lots.length).toBe(2);
  });

  it('exactamente uno en `reserved`', () => {
    expect(SEED_LISTINGS.filter((l) => l.status === 'reserved').length).toBe(1);
  });

  it('los accesorios (`lot`) no tienen IMEI', () => {
    for (const l of SEED_LISTINGS.filter((x) => x.kind === 'lot')) {
      expect(l.imei).toBeNull();
    }
  });
});

describe('catálogo Apple del seed', () => {
  it('trae las 32 líneas de modelo y no duplica slugs', () => {
    expect(SEED_MODELS).toHaveLength(32);
    expect(new Set(SEED_MODELS.map((model) => model.slug)).size).toBe(SEED_MODELS.length);
  });

  it('cada modelo tiene al menos una capacidad y un color seleccionables', () => {
    for (const model of SEED_MODELS) {
      expect(model.storageOptionsGb.length, model.slug).toBeGreaterThan(0);
      expect(model.colors.length, model.slug).toBeGreaterThan(0);
    }
  });
});
