import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  MAX_SIGNATURE_AGE_SECONDS,
  parseSignatureHeader,
  signatureManifest,
  signatureTimestampMs,
  signManifest,
  verifyWebhookSignature,
} from './signature';

/**
 * La firma es la única defensa de la puerta, así que lo que se prueba acá no es "la función
 * devuelve un booleano": es **la receta del manifiesto**, escrita a mano, contra un HMAC calculado
 * a mano. Si el test firmara con `signatureManifest()` y verificara con `verifyWebhookSignature()`
 * estaría comprobando que dos funciones nuestras coinciden entre sí, que es exactamente el gate
 * vacío que ADR-020 prohíbe: seguiría verde con la receta equivocada, y el día de B3 rebotaría
 * todo webhook de producción.
 */

const SECRET = 'clave-de-webhook-larga-y-fea-1234';
const TS = '1704908010';
const NOW = new Date(Number(TS) * 1000);

/** El manifiesto tal como lo documenta Mercado Pago, tipeado a mano. Es el oráculo. */
function manifiestoAMano(dataId: string, requestId: string, ts: string): string {
  return `id:${dataId};request-id:${requestId};ts:${ts};`;
}

describe('el manifiesto', () => {
  it('arma id;request-id;ts con punto y coma, en ese orden', () => {
    expect(signatureManifest({ dataId: 'abc123', requestId: 'req-9', ts: TS })).toBe(
      manifiestoAMano('abc123', 'req-9', TS),
    );
  });

  it('pasa a minúsculas el data.id alfanumérico (con uno numérico esto no se nota NUNCA)', () => {
    expect(signatureManifest({ dataId: 'A1B2C3', requestId: 'req-9', ts: TS })).toBe(
      manifiestoAMano('a1b2c3', 'req-9', TS),
    );
  });

  it('omite el segmento que no vino, en vez de escribir "undefined"', () => {
    expect(signatureManifest({ dataId: null, requestId: 'req-9', ts: TS })).toBe(`request-id:req-9;ts:${TS};`);
    expect(signatureManifest({ dataId: 'abc', requestId: null, ts: TS })).toBe(`id:abc;ts:${TS};`);
  });
});

describe('verifyWebhookSignature · contra un HMAC calculado por afuera', () => {
  const v1 = createHmac('sha256', SECRET).update(manifiestoAMano('abc123', 'req-9', TS), 'utf8').digest('hex');

  const input = {
    signatureHeader: `ts=${TS},v1=${v1}`,
    requestId: 'req-9',
    dataId: 'abc123',
    secret: SECRET,
    now: NOW,
  };

  it('acepta la firma correcta', () => {
    expect(verifyWebhookSignature(input)).toEqual({ ok: true });
  });

  it('rechaza si cambia el data.id, aunque el HMAC sea válido para OTRO data.id', () => {
    expect(verifyWebhookSignature({ ...input, dataId: 'abc124' })).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('rechaza si cambia el request-id', () => {
    expect(verifyWebhookSignature({ ...input, requestId: 'req-10' })).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('rechaza con otro secreto', () => {
    expect(verifyWebhookSignature({ ...input, secret: 'otra-clave-igual-de-larga-1234567' })).toEqual({
      ok: false,
      reason: 'mismatch',
    });
  });

  it('sin secreto no autoriza a nadie (falla CERRADO, que es el bug clásico al revés)', () => {
    expect(verifyWebhookSignature({ ...input, secret: null })).toEqual({ ok: false, reason: 'missing_secret' });
    expect(verifyWebhookSignature({ ...input, secret: '' })).toEqual({ ok: false, reason: 'missing_secret' });
  });

  it('sin header: missing_header', () => {
    expect(verifyWebhookSignature({ ...input, signatureHeader: null })).toEqual({
      ok: false,
      reason: 'missing_header',
    });
  });

  it('header sin v1, o con un v1 que no es hex: malformed_header', () => {
    expect(verifyWebhookSignature({ ...input, signatureHeader: `ts=${TS}` })).toEqual({
      ok: false,
      reason: 'malformed_header',
    });
    expect(verifyWebhookSignature({ ...input, signatureHeader: `ts=${TS},v1=no-es-hex` })).toEqual({
      ok: false,
      reason: 'malformed_header',
    });
  });

  it('una firma más corta que la esperada no pasa (ni tira por longitudes distintas)', () => {
    expect(verifyWebhookSignature({ ...input, signatureHeader: `ts=${TS},v1=${v1.slice(0, 10)}` })).toEqual({
      ok: false,
      reason: 'mismatch',
    });
  });

  it('vieja: se rechaza pasada la ventana, y se acepta justo adentro', () => {
    const adentro = new Date(NOW.getTime() + (MAX_SIGNATURE_AGE_SECONDS - 1) * 1000);
    const afuera = new Date(NOW.getTime() + (MAX_SIGNATURE_AGE_SECONDS + 1) * 1000);

    expect(verifyWebhookSignature({ ...input, now: adentro })).toEqual({ ok: true });
    expect(verifyWebhookSignature({ ...input, now: afuera })).toEqual({ ok: false, reason: 'stale_timestamp' });
  });

  it('del futuro lejano: se rechaza (un reloj desincronizado no explica 10 minutos)', () => {
    const futuro = new Date(NOW.getTime() - 600 * 1000);
    expect(verifyWebhookSignature({ ...input, now: futuro })).toEqual({ ok: false, reason: 'stale_timestamp' });
  });
});

describe('el ts: la doc dice ms y el ejemplo publicado trae segundos', () => {
  it('un ts de 10 dígitos se lee como segundos y NO queda en 1970', () => {
    expect(signatureTimestampMs('1704908010')).toBe(1704908010000);
  });

  it('un ts de 13 dígitos se lee como milisegundos, tal cual', () => {
    expect(signatureTimestampMs('1704908010123')).toBe(1704908010123);
  });

  /**
   * El control de polaridad de la decisión de arriba. Si el módulo tratara todo `ts` como
   * milisegundos —que es lo que dice la doc— un webhook recién firmado en segundos parecería tener
   * 55 años y **todo** webhook de producción sería `stale_timestamp`.
   */
  it('control: leído como ms, un ts en segundos daría 1970 y rebotaría todo', () => {
    expect(new Date(Number('1704908010')).getUTCFullYear()).toBe(1970);
    expect(new Date(signatureTimestampMs('1704908010') ?? 0).getUTCFullYear()).toBe(2024);
  });

  it('basura: null', () => {
    expect(signatureTimestampMs('0')).toBeNull();
    expect(signatureTimestampMs('99999999999999999999')).toBeNull();
  });
});

describe('parseSignatureHeader', () => {
  it('tolera espacios, orden invertido y claves de más', () => {
    expect(parseSignatureHeader(` v1=ABCD , ts=${TS}, v2=loquesea `)).toEqual({ ts: TS, v1: 'ABCD' });
  });

  it('exige que el ts sean dígitos y el v1 sea hex de largo par', () => {
    expect(parseSignatureHeader('ts=ayer,v1=abcd')).toBeNull();
    expect(parseSignatureHeader(`ts=${TS},v1=abc`)).toBeNull();
  });

  it('null es null', () => {
    expect(parseSignatureHeader(null)).toBeNull();
  });
});

describe('signManifest', () => {
  it('es HMAC-SHA256 en hex, no base64', () => {
    const firma = signManifest('id:1;ts:2;', SECRET);
    expect(firma).toMatch(/^[0-9a-f]{64}$/u);
    expect(firma).toBe(createHmac('sha256', SECRET).update('id:1;ts:2;', 'utf8').digest('hex'));
  });
});
