import { describe, expect, it } from 'vitest';
import { decodeExternalReference, encodeExternalReference } from './external-reference';

/**
 * El puente MP → tenant. Es un identificador que **vuelve de afuera** y decide a quién se le activa
 * un plan pago, así que lo que se mide es lo que rechaza, no lo que acepta.
 */

const TENANT = '11111111-2222-4333-8444-555555555555';

describe('ida y vuelta', () => {
  it('lo que se escribe se lee', () => {
    const ref = { tenantId: TENANT, plan: 'negocio' as const };
    expect(decodeExternalReference(encodeExternalReference(ref))).toEqual(ref);
  });

  it('el formato es estable y versionado (si cambia, las suscripciones vivas dejan de resolver)', () => {
    expect(encodeExternalReference({ tenantId: TENANT, plan: 'base' })).toBe(`istock:v1:${TENANT}:base`);
  });
});

describe('lo que NO se acepta', () => {
  /**
   * Ninguno de estos cae a un default. Un default acá sería regalar `negocio` o cobrarle `base` a
   * alguien que pagó otra cosa: las dos son plata, en direcciones distintas.
   */
  it.each([
    ['null', null],
    ['vacío', ''],
    ['sin prefijo', `v1:${TENANT}:base`],
    ['otra versión', `istock:v2:${TENANT}:base`],
    ['otro producto', `otracosa:v1:${TENANT}:base`],
    ['tenant que no es uuid', 'istock:v1:no-soy-uuid:base'],
    ['plan que no existe', `istock:v1:${TENANT}:premium`],
    ['plan trial (no es comprable)', `istock:v1:${TENANT}:trial`],
    ['campos de más', `istock:v1:${TENANT}:base:extra`],
    ['campos de menos', `istock:v1:${TENANT}`],
  ])('%s → null', (_caso, raw) => {
    expect(decodeExternalReference(raw)).toBeNull();
  });
});
