import { describe, expect, it } from 'vitest';
import { parseNotificationBody, signedDataIdFromUrl, TOPIC_PREAPPROVAL } from './notification';

/**
 * Dos preguntas y nada más: **cuál es la clave de idempotencia** y **qué cuerpo se acepta**.
 *
 * La primera es la que importa. `id` (la notificación), `data.id` (el recurso) y `x-request-id`
 * (el envío) son tres identificadores distintos que en un ejemplo de la doc parecen intercambiables
 * y no lo son: deduplicar por `data.id` procesaría el primer evento de una suscripción y
 * descartaría todos los siguientes, en silencio y para siempre.
 */

const cuerpo = (extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ id: 12345, type: TOPIC_PREAPPROVAL, action: 'updated', data: { id: 'PRE-1' }, ...extra });

describe('la clave de idempotencia es el id del CUERPO, no el del recurso', () => {
  it('eventId sale de `id` y resourceId de `data.id`, y no se confunden', () => {
    const parsed = parseNotificationBody(cuerpo());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.notification.eventId).toBe('12345');
    expect(parsed.notification.resourceId).toBe('PRE-1');
    expect(parsed.notification.eventId).not.toBe(parsed.notification.resourceId);
  });

  it('dos eventos del MISMO recurso tienen eventId distinto (por eso no se deduplica por data.id)', () => {
    const a = parseNotificationBody(cuerpo({ id: 1 }));
    const b = parseNotificationBody(cuerpo({ id: 2 }));
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    expect(a.notification.resourceId).toBe(b.notification.resourceId);
    expect(a.notification.eventId).not.toBe(b.notification.eventId);
  });

  it('`123` numérico y `"123"` string son el mismo evento', () => {
    const numero = parseNotificationBody(cuerpo({ id: 123 }));
    const texto = parseNotificationBody(cuerpo({ id: '123' }));
    expect(numero.ok && texto.ok).toBe(true);
    if (!numero.ok || !texto.ok) return;
    expect(numero.notification.eventId).toBe(texto.notification.eventId);
  });
});

describe('tolerancia del parseo', () => {
  it('acepta `topic` (IPN viejo) además de `type`', () => {
    const parsed = parseNotificationBody(JSON.stringify({ id: 1, topic: TOPIC_PREAPPROVAL }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.notification.topic).toBe(TOPIC_PREAPPROVAL);
  });

  /**
   * A propósito, y es la decisión que más se parece a un bug si no se lee el motivo: un `z.enum`
   * cerrado convertiría "MP agregó un estado" en "el webhook devuelve 400 y MP reintenta para
   * siempre". Lo estrecho está en el mapeo (`subscriptions/status.ts`), no acá.
   */
  it('acepta un topic que no conocemos: quién lo ignora es el handler, no el parser', () => {
    const parsed = parseNotificationBody(JSON.stringify({ id: 1, type: 'algo_que_inventaron_ayer' }));
    expect(parsed.ok).toBe(true);
  });

  it('sin type ni topic: no hay evento', () => {
    expect(parseNotificationBody(JSON.stringify({ id: 1 }))).toEqual({ ok: false, reason: 'invalid_shape' });
  });

  it('sin id: no hay clave de idempotencia, así que no hay evento', () => {
    expect(parseNotificationBody(JSON.stringify({ type: TOPIC_PREAPPROVAL }))).toEqual({
      ok: false,
      reason: 'invalid_shape',
    });
  });

  it('json roto: invalid_json, sin tirar', () => {
    expect(parseNotificationBody('{')).toEqual({ ok: false, reason: 'invalid_json' });
  });

  it('un array no es una notificación', () => {
    expect(parseNotificationBody('[]')).toEqual({ ok: false, reason: 'invalid_shape' });
  });
});

describe('signedDataIdFromUrl · el data.id firmado sale de la QUERY', () => {
  it('prefiere `data.id` y cae a `id` (IPN viejo)', () => {
    expect(signedDataIdFromUrl(new URL('https://x/w?data.id=A&id=B'))).toBe('A');
    expect(signedDataIdFromUrl(new URL('https://x/w?id=B'))).toBe('B');
    expect(signedDataIdFromUrl(new URL('https://x/w'))).toBeNull();
  });
});
