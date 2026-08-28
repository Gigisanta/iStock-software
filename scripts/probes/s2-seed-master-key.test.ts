/**
 * Sonda del LEAD sobre `seedMasterKey`. Existe por la regla de que el LEAD re-ejecuta la
 * aceptacion en vez de creerle al subagente: `db-agent` escribio su propio test con el regex
 * copiado a mano, que es lo correcto, pero un test escrito por el mismo que escribio el codigo
 * mide consistencia interna, no correccion.
 *
 * Esta sonda lee el regex REAL desde el fuente de `packages/media/src/keys.ts` en vez de
 * copiarlo: si el contrato de media y lo que emite el seed se separan, el que tiene que gritar
 * es este archivo. Es la unica copia del chequeo que no vive en la columna de ninguno de los dos.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SEED_TENANT_ID, seedMasterKey } from '../../packages/db/src/seed-data';

const KEYS_SRC = readFileSync(resolve(__dirname, '../../packages/media/src/keys.ts'), 'utf8');
// `\s*` y no un espacio: prettier parte la declaracion en dos lineas cuando el regex es largo,
// y un extractor que asume una sola linea se rompe por formato y no por contenido. Ya paso.
const RE_LINE = /const MASTER_KEY_RE =\s*(\/.*\/);/u.exec(KEYS_SRC);

const LISTING_ID = '7d8e9f0a-1b2c-4d3e-9f8a-6b5c4d3e2f1a';

describe('LEAD · el seed emite masters con la forma que packages/media exige', () => {
  it('el regex se pudo leer del fuente de media (si no, la sonda no mide nada)', () => {
    expect(RE_LINE).not.toBeNull();
  });

  it('la key emitida matchea el MASTER_KEY_RE real, no una copia', () => {
    // El `!` de antes tapaba dos cosas distintas: que la linea no matcheara y que el grupo 1 no
    // existiera. Con `noUncheckedIndexedAccess` lo segundo es un error de tipo, y `tsc` no llegaba
    // hasta aca (ver `G5` de `guard-gates.sh`). Un `undefined` silencioso habria construido un
    // `RegExp` sobre "undefined" y la probe habria medido otra cosa.
    const crudo = RE_LINE?.[1];
    if (crudo === undefined) throw new Error('no se pudo extraer MASTER_KEY_RE de la fuente');
    const re = new RegExp(crudo.slice(1, -1), 'u');
    const key = seedMasterKey({
      tenantId: SEED_TENANT_ID,
      listingId: LISTING_ID,
      listingSlug: 'iphone-14-pro-256-grafito',
      index: 0,
    });
    // eslint-disable-next-line no-console -- la sonda del LEAD imprime lo que mide, no un listing
    console.log(`MEDIDO seedMasterKey -> ${key}`);
    expect(key).toMatch(re);
  });

  it('tenant y listing van en ese orden y no al reves', () => {
    const key = seedMasterKey({
      tenantId: SEED_TENANT_ID,
      listingId: LISTING_ID,
      listingSlug: 'iphone-14-pro-256-grafito',
      index: 0,
    });
    expect(key.split('/')[1]).toBe(SEED_TENANT_ID);
    expect(key.split('/')[2]).toBe(LISTING_ID);
  });
});
