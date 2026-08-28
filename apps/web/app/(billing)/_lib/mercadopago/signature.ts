import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verificación de la firma del webhook de Mercado Pago. **Es la única defensa de esta puerta.**
 *
 * No hay sesión, no hay cookie y no hay guard del proxy: `ADR-008` lo cierra con el mismo motivo
 * mecánico de ADR-007 —un `matcher` que excluye un path también saltea las Server Functions de ese
 * path—, así que la autorización se verifica **adentro** del route handler y esta función es esa
 * verificación. Un webhook sin validación de origen es un endpoint que le deja a cualquiera
 * activar un plan pago escribiendo un JSON.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  El manifiesto
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 *     id:<data.id de la QUERY>;request-id:<header x-request-id>;ts:<ts del header x-signature>;
 *
 * HMAC-SHA256 en **hex** con el secreto de *Tus integraciones*. El header viene como
 * `x-signature: ts=<timestamp>,v1=<hex>`.
 *
 * Tres detalles que son bugs si se hacen de memoria, los tres documentados en
 * `docs/research/mp-subscriptions.md` (la parte del documento que **sí** sobrevivió al override):
 *
 * 1. **`data.id` sale de la QUERY, no del body.** Firmar el body sería lo intuitivo y sería otra
 *    firma.
 * 2. **`data.id` alfanumérico llega en MAYÚSCULAS y hay que pasarlo a minúsculas.** Con un id
 *    numérico —que es el caso normal— no se nota nunca; con uno alfanumérico falla siempre.
 * 3. **El `ts` dice "milisegundos" en la doc y el ejemplo publicado tiene 10 dígitos, o sea
 *    segundos.** Se normaliza por magnitud antes de cualquier chequeo de antigüedad. Sin eso, un
 *    `ts` en segundos leído como milisegundos queda en 1970 y **todo** webhook parece viejo.
 *
 * Una parte ausente se **omite** del manifiesto en vez de escribirse como `undefined`: es lo que
 * dice la guía de MP para los campos que no vienen. Esto está **UNVERIFIED contra el servicio
 * real** —B3— y es la única pieza de este archivo que puede necesitar un ajuste cuando aterrice:
 * si MP incluyera el segmento vacío, el HMAC no coincidiría y el síntoma sería `mismatch`, que es
 * fallar cerrado. No hay camino en el que esta duda deje pasar algo.
 */

export type SignatureFailure =
  | 'missing_secret'
  | 'missing_header'
  | 'malformed_header'
  | 'stale_timestamp'
  | 'mismatch';

export type SignatureVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: SignatureFailure };

export interface SignatureInput {
  /** Header `x-signature`. */
  readonly signatureHeader: string | null;
  /** Header `x-request-id`. */
  readonly requestId: string | null;
  /** Query param `data.id` de la URL de la notificación. */
  readonly dataId: string | null;
  readonly secret: string | null;
  readonly now: Date;
}

/**
 * Ventana de antigüedad aceptada, en segundos.
 *
 * **No es la defensa contra el replay: es defensa en profundidad.** Quien defiende de verdad es el
 * ledger de eventos, que hace que reprocesar sea un no-op contado. Esta ventana sólo acota la
 * utilidad de una captura vieja del header.
 *
 * 15 minutos, y el número tiene motivo: MP reintenta **cada 15 minutos** tras un fallo. No está
 * verificado si en el reintento vuelve a firmar con un `ts` nuevo o repite el original (B3), así
 * que una ventana de 5 minutos podría rechazar reintentos legítimos — y rechazar un reintento
 * legítimo es perder un pago, que es más caro que aceptar un header de 14 minutos. Cuando B3
 * aterrice, se mide y se ajusta con dato en vez de con criterio.
 */
export const MAX_SIGNATURE_AGE_SECONDS = 900;

/**
 * Tolerancia hacia el futuro. Más corta que la de atrás: un `ts` futuro no se explica por latencia
 * ni por reintentos, sólo por relojes desincronizados.
 */
export const MAX_SIGNATURE_FUTURE_SECONDS = 300;

interface ParsedSignatureHeader {
  readonly ts: string;
  readonly v1: string;
}

/**
 * `ts=1704908010,v1=abc...` → `{ ts, v1 }`. Devuelve `null` si falta cualquiera de los dos.
 *
 * El parseo es tolerante con el formato (espacios, orden, claves de más que MP pudiera agregar) y
 * estricto con el contenido: `ts` tiene que ser dígitos y `v1` tiene que ser hex. Tolerar de más
 * en el contenido es aceptar de más.
 */
export function parseSignatureHeader(header: string | null): ParsedSignatureHeader | null {
  if (header === null) return null;

  let ts: string | undefined;
  let v1: string | undefined;
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    const value = part.slice(eq + 1).trim();
    if (key === 'ts') ts = value;
    else if (key === 'v1') v1 = value;
  }

  if (ts === undefined || v1 === undefined) return null;
  if (!/^\d{1,20}$/u.test(ts)) return null;
  if (!/^[0-9a-f]+$/iu.test(v1) || v1.length % 2 !== 0) return null;
  return { ts, v1 };
}

/**
 * El `ts` del header, en milisegundos de época.
 *
 * La doc dice milisegundos y el ejemplo que publica tiene 10 dígitos. Se decide por **magnitud**,
 * no por largo: `>= 1e12` ya es un milisegundo plausible (año 2001 en ms es 1e12; en segundos, 1e12
 * sería el año 33658). Devuelve `null` si el número no entra en un entero seguro.
 */
export function signatureTimestampMs(ts: string): number | null {
  const raw = Number(ts);
  if (!Number.isSafeInteger(raw) || raw <= 0) return null;
  return raw >= 1e12 ? raw : raw * 1000;
}

/**
 * El manifiesto exacto que MP firma. Exportado porque el mock lo necesita para **firmar** los
 * eventos de prueba: si el mock firmara con otra receta, el test de firma probaría el mock.
 */
export function signatureManifest(parts: {
  readonly dataId: string | null;
  readonly requestId: string | null;
  readonly ts: string;
}): string {
  const segments: string[] = [];
  // `data.id` alfanumérico llega en mayúsculas; el manifiesto lo quiere en minúsculas.
  if (parts.dataId !== null && parts.dataId.length > 0) segments.push(`id:${parts.dataId.toLowerCase()};`);
  if (parts.requestId !== null && parts.requestId.length > 0) segments.push(`request-id:${parts.requestId};`);
  segments.push(`ts:${parts.ts};`);
  return segments.join('');
}

/** HMAC-SHA256 hex del manifiesto. La misma función que usa el mock para firmar. */
export function signManifest(manifest: string, secret: string): string {
  return createHmac('sha256', secret).update(manifest, 'utf8').digest('hex');
}

/**
 * Comparación de tiempo constante entre dos firmas en hex.
 *
 * Se comparan los **bytes decodificados** y se exige el mismo largo antes de llamar a
 * `timingSafeEqual` — pasarle largos distintos tira, y esa excepción sería, ella misma, un oráculo
 * de longitud. Mismo criterio que el handler del cron.
 */
function signaturesMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * ¿Esta notificación viene de Mercado Pago?
 *
 * El orden de los rechazos es deliberado: primero lo que no depende del secreto (falta el header,
 * está mal armado, el `ts` es viejo) y recién al final el HMAC. Así el camino caro corre sólo
 * sobre requests que ya parecen legítimas. **Todos los motivos se devuelven al llamador para el
 * log; ninguno se le cuenta a quien golpea la puerta** — el handler responde 401 con el mismo
 * cuerpo para los cinco.
 */
export function verifyWebhookSignature(input: SignatureInput): SignatureVerdict {
  if (input.secret === null || input.secret.length === 0) return { ok: false, reason: 'missing_secret' };
  if (input.signatureHeader === null) return { ok: false, reason: 'missing_header' };

  const parsed = parseSignatureHeader(input.signatureHeader);
  if (parsed === null) return { ok: false, reason: 'malformed_header' };

  const tsMs = signatureTimestampMs(parsed.ts);
  if (tsMs === null) return { ok: false, reason: 'malformed_header' };

  const deltaSeconds = (input.now.getTime() - tsMs) / 1000;
  if (deltaSeconds > MAX_SIGNATURE_AGE_SECONDS) return { ok: false, reason: 'stale_timestamp' };
  if (deltaSeconds < -MAX_SIGNATURE_FUTURE_SECONDS) return { ok: false, reason: 'stale_timestamp' };

  const expected = signManifest(
    signatureManifest({ dataId: input.dataId, requestId: input.requestId, ts: parsed.ts }),
    input.secret,
  );

  return signaturesMatch(parsed.v1, expected) ? { ok: true } : { ok: false, reason: 'mismatch' };
}
