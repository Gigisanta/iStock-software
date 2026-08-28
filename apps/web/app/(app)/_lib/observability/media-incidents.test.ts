import { afterEach, describe, expect, it, vi } from 'vitest';

// Igual que el resto de la columna: el módulo es `server-only` y vitest no es el bundler de Next.
vi.mock('server-only', () => ({}));

import {
  buildSentryEnvelope,
  createMediaIncidentSink,
  parseSentryDsn,
  sanitizeMediaIncident,
  type SentryTarget,
} from './media-incidents';
import type { MediaIncident } from '@istock/media';

/**
 * Lo que estos tests defienden, en orden de gravedad:
 *
 * 1. Que la key entera **no salga**, ni siquiera si `packages/media` —que no es nuestra columna—
 *    empieza a mandar una key completa en `keyPrefix` o a meter identificadores en `reason`.
 * 2. Que el reporter no tire ni haga I/O: corre adentro de un render cacheado.
 * 3. Que sin DSN válido no haya nada enchufado.
 */

const TARGET: SentryTarget = {
  envelopeUrl: 'https://o1.ingest.sentry.io/api/42/envelope/',
  publicKey: 'pub',
};

const incident = (over: Partial<MediaIncident> = {}): MediaIncident => ({
  code: 'MEDIA_UNSAFE_KEY',
  reason: 'contiene un UUID (tenant_id / listing_id)',
  keyPrefix: 'v1/ab/1234…',
  variant: 'card',
  ...over,
});

describe('parseSentryDsn', () => {
  it('deriva la URL de envelope de un DSN normal', () => {
    expect(parseSentryDsn('https://abc123@o55.ingest.us.sentry.io/4507')).toEqual({
      envelopeUrl: 'https://o55.ingest.us.sentry.io/api/4507/envelope/',
      publicKey: 'abc123',
    });
  });

  it('soporta un prefijo de path (self-hosted detrás de un reverse proxy)', () => {
    expect(parseSentryDsn('https://k@sentry.interno/sentry/9')).toEqual({
      envelopeUrl: 'https://sentry.interno/sentry/api/9/envelope/',
      publicKey: 'k',
    });
  });

  it.each([
    ['ausente', undefined],
    ['nulo', null],
    ['vacío, que es lo que trae .env.example', ''],
    ['sólo espacios', '   '],
    ['texto que no es URL', 'poneme-el-dsn'],
    ['sin public key', 'https://o1.ingest.sentry.io/42'],
    ['sin project id', 'https://k@o1.ingest.sentry.io'],
    ['protocolo raro', 'ftp://k@o1.ingest.sentry.io/42'],
  ])('devuelve null y no tira: %s', (_caso, raw) => {
    expect(parseSentryDsn(raw)).toBeNull();
  });
});

describe('sanitizeMediaIncident', () => {
  it('vuelve a truncar el prefijo aunque el paquete mande la key entera', () => {
    // El día que `packages/media` suba KEY_PREFIX_LENGTH, esto sigue parado.
    const key =
      'originals/6f1e0b2a-1111-4222-8333-444455556666/9a0d1c2b-3333-4444-8555-666677778888/' +
      '0123456789abcdef0123456789abcdef.webp';
    const safe = sanitizeMediaIncident(incident({ keyPrefix: key }));

    expect(safe.keyPrefix).toBe('originals/6f…');
    expect(safe.keyPrefix.length).toBeLessThanOrEqual(13);
    expect(safe.keyPrefix).not.toContain('0123456789abcdef');
  });

  it('deja ver la familia de la key, que es para lo que sirve el prefijo', () => {
    expect(sanitizeMediaIncident(incident({ keyPrefix: 'v1/ab/0123…' })).keyPrefix).toBe(
      'v1/ab/0123',
    );
  });

  it('borra UUID, hash largo, mail e IMEI del motivo', () => {
    const safe = sanitizeMediaIncident(
      incident({
        reason:
          'key 6f1e0b2a-1111-4222-8333-444455556666 hash 0123456789abcdef0123456789abcdef ' +
          'dueño duenio@negocio.com imei 351234567890123',
      }),
    );

    expect(safe.reason).toBe('key [uuid] hash [hash] dueño [mail] imei [digits]');
  });

  it('borra la key entera antes que sus pedazos: un hash corto no se escapa', () => {
    const safe = sanitizeMediaIncident(
      incident({ reason: 'no se sirve originals/6f1e0b2a-1111-4222-8333-444455556666/aa/dead.webp' }),
    );

    expect(safe.reason).toBe('no se sirve [key]');
  });

  it('acota el motivo largo de un MEDIA_CONFIG', () => {
    const safe = sanitizeMediaIncident(incident({ code: 'MEDIA_CONFIG', reason: 'x'.repeat(900) }));
    expect(safe.reason.length).toBe(200);
  });

  it('normaliza un code o una variante que no conoce', () => {
    const raw = { code: 'MEDIA_LO_QUE_SEA', reason: 'r', keyPrefix: '', variant: 'gigante' };
    const safe = sanitizeMediaIncident(raw as unknown as MediaIncident);
    expect(safe).toEqual({ code: 'MEDIA_UNKNOWN', reason: 'r', keyPrefix: '', variant: 'none' });
  });
});

describe('buildSentryEnvelope', () => {
  const safe = sanitizeMediaIncident(incident());
  const body = buildSentryEnvelope(safe, {
    eventId: 'a'.repeat(32),
    sentAt: new Date('2026-08-28T12:00:00.000Z'),
    environment: 'production',
  });

  it('son tres líneas NDJSON', () => {
    expect(body.trimEnd().split('\n')).toHaveLength(3);
  });

  it('manda cuatro escalares y nada más: ni request, ni user, ni server_name', () => {
    const payload = JSON.parse(body.trimEnd().split('\n')[2] ?? '{}') as Record<string, unknown>;

    expect(Object.keys(payload).sort()).toEqual([
      'environment',
      'event_id',
      'extra',
      'fingerprint',
      'level',
      'logger',
      'message',
      'platform',
      'tags',
      'timestamp',
    ]);
    expect(payload['extra']).toEqual({ key_prefix: 'v1/ab/1234' });
  });

  it('agrupa por causa y no por foto', () => {
    const otra = buildSentryEnvelope(sanitizeMediaIncident(incident({ keyPrefix: 'v1/zz/9999…' })), {
      eventId: 'b'.repeat(32),
      sentAt: new Date('2026-08-28T12:00:01.000Z'),
      environment: 'production',
    });

    const fp = (raw: string) =>
      (JSON.parse(raw.trimEnd().split('\n')[2] ?? '{}') as { fingerprint: string[] }).fingerprint;

    expect(fp(body)).toEqual(fp(otra));
  });
});

describe('createMediaIncidentSink', () => {
  const sink = (send: MediaIncidentSinkSend) =>
    createMediaIncidentSink({
      target: TARGET,
      environment: 'test',
      send,
      now: () => new Date('2026-08-28T12:00:00.000Z'),
      eventId: () => 'c'.repeat(32),
    });

  type MediaIncidentSinkSend = (url: string, init: RequestInit) => Promise<unknown>;

  it('report() no hace I/O: encola y vuelve', () => {
    const send = vi.fn(async () => undefined);
    const s = sink(send);

    s.report(incident());

    expect(send).not.toHaveBeenCalled();
    expect(s.pending()).toBe(1);
  });

  it('deduplica: la misma foto rota en mil renders es un evento', () => {
    const s = sink(async () => undefined);
    for (let i = 0; i < 1000; i += 1) s.report(incident());
    expect(s.pending()).toBe(1);
  });

  it('acota la cola: un incidente distinto por render no se come la memoria', () => {
    const s = sink(async () => undefined);
    for (let i = 0; i < 500; i += 1) s.report(incident({ reason: `motivo ${String(i)}` }));
    expect(s.pending()).toBeLessThanOrEqual(32);
  });

  it('lo descartado por cola llena no queda marcado como ya reportado', async () => {
    const s = sink(async () => undefined);
    for (let i = 0; i < 100; i += 1) s.report(incident({ reason: `motivo ${String(i)}` }));

    const desbordado = s.pending();
    await s.flush();
    // Después de drenar, la clase que se había descartado vuelve a entrar: si el fingerprint se
    // hubiera marcado al descartarla, acá la cola quedaría vacía.
    s.report(incident({ reason: 'motivo 99' }));

    expect(desbordado).toBe(32);
    expect(s.pending()).toBe(1);
  });

  it('no tira aunque el incidente venga deforme', () => {
    const s = sink(async () => undefined);
    expect(() => {
      s.report(undefined as unknown as MediaIncident);
    }).not.toThrow();
  });

  it('flush() postea el envelope con el header de auth y vacía la cola', async () => {
    const send = vi.fn(async () => undefined);
    const s = sink(send);
    s.report(incident());

    await s.flush();

    expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(TARGET.envelopeUrl);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-sentry-auth']).toContain('sentry_key=pub');
    expect(s.pending()).toBe(0);
  });

  it('flush() no propaga un Sentry caído', async () => {
    const s = sink(async () => {
      throw new Error('ECONNREFUSED');
    });
    s.report(incident());

    await expect(s.flush()).resolves.toBeUndefined();
    expect(s.pending()).toBe(0);
  });

  it('el cuerpo que sale no contiene la key entera', async () => {
    const key =
      'originals/6f1e0b2a-1111-4222-8333-444455556666/9a0d1c2b-3333-4444-8555-666677778888/' +
      '0123456789abcdef0123456789abcdef.webp';
    let body = '';
    const s = sink(async (_url, init) => {
      body = String(init.body);
      return undefined;
    });

    s.report(incident({ keyPrefix: key, reason: `no se sirve ${key}` }));
    await s.flush();

    expect(body).not.toContain(key);
    expect(body).not.toContain('0123456789abcdef');
    expect(body).not.toContain('6f1e0b2a-1111-4222-8333-444455556666');
  });
});

/**
 * El cableado de verdad: que `setMediaIncidentReporter()` quede efectivamente llamado.
 *
 * Se prueba **a través de `reportMediaIncident()` del paquete real**, no espiando al setter. Lo
 * que se quería saber no es "¿llamamos a la función?", es "¿el incidente que emite `variantUrl()`
 * llega a nuestro sink?". Un test del setter pasaría igual con el cableado roto río abajo.
 *
 * El DSN de estos casos apunta a `127.0.0.1:1` a propósito: si el `setInterval` del drenaje
 * llegara a dispararse durante la corrida, el POST muere en el loopback. Un test no le pega a
 * `sentry.io`.
 */
describe('wireMediaIncidents', () => {
  const previous = process.env['SENTRY_DSN'];

  afterEach(() => {
    if (previous === undefined) delete process.env['SENTRY_DSN'];
    else process.env['SENTRY_DSN'] = previous;
    vi.restoreAllMocks();
  });

  it('sin DSN queda inerte y NO pisa el reporter por defecto del paquete', async () => {
    vi.resetModules();
    delete process.env['SENTRY_DSN'];

    const wiring = await import('./media-incidents');
    const media = await import('@istock/media');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(wiring.wireMediaIncidents()).toBe('inert');

    // La señal que ya existía en dev sigue ahí. "Inerte" es no tocar nada, no apagar lo que había.
    media.reportMediaIncident(incident());
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('con DSN vacío —lo que trae .env.example— también queda inerte y en silencio', async () => {
    vi.resetModules();
    process.env['SENTRY_DSN'] = '';

    const wiring = await import('./media-incidents');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(wiring.wireMediaIncidents()).toBe('inert');
    expect(log).not.toHaveBeenCalled();
  });

  it('con DSN roto queda inerte, pero deja UNA línea: es un error de despliegue nuestro', async () => {
    vi.resetModules();
    process.env['SENTRY_DSN'] = 'poneme-el-dsn';

    const wiring = await import('./media-incidents');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(wiring.wireMediaIncidents()).toBe('inert');
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('con DSN válido el incidente del paquete llega a nuestro sink', async () => {
    vi.resetModules();
    process.env['SENTRY_DSN'] = 'http://k@127.0.0.1:1/42';

    const wiring = await import('./media-incidents');
    const media = await import('@istock/media');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(wiring.wireMediaIncidents()).toBe('wired');

    media.reportMediaIncident(incident());

    // El default del paquete ya no corre: lo nuestro está enchufado.
    expect(warn).not.toHaveBeenCalled();

    media.resetMediaIncidentReporter();
  });

  it('es idempotente: dos register() no son dos drenajes', async () => {
    vi.resetModules();
    process.env['SENTRY_DSN'] = 'http://k@127.0.0.1:1/42';

    const wiring = await import('./media-incidents');
    expect(wiring.wireMediaIncidents()).toBe('wired');
    expect(wiring.wireMediaIncidents()).toBe('already-wired');

    const media = await import('@istock/media');
    media.resetMediaIncidentReporter();
  });
});

/**
 * ── El subpath no puede ser una SEGUNDA copia del registro ────────────────────────────────────
 *
 * Este módulo enchufa el reporter por `@istock/media/incidents` (bootstrap liviano, sin `sharp`),
 * pero quien **emite** —`(storefront)/_lib/listings.ts`— llama `reportMediaIncident` importado del
 * barrel. Si los dos entrypoints resolvieran a dos instancias del módulo, cada una tendría su
 * propio reporter: el cableado quedaría enchufado a un canal por el que no pasa nadie y el
 * síntoma sería **ninguno**, que es el peor. La barata forma de afirmarlo es la identidad de la
 * función: mismo objeto ⇒ mismo módulo ⇒ mismo registro.
 */
describe('un solo registro para los dos entrypoints de @istock/media', () => {
  it('el barrel y el subpath exponen EL MISMO `setMediaIncidentReporter`', async () => {
    const barrel = await import('@istock/media');
    const subpath = await import('@istock/media/incidents');

    expect(subpath.setMediaIncidentReporter).toBe(barrel.setMediaIncidentReporter);
    expect(subpath.reportMediaIncident).toBe(barrel.reportMediaIncident);
  });

  it('CONTROL — con dos instancias del módulo la aserción de arriba SÍ falla', async () => {
    const subpath = await import('@istock/media/incidents');
    // `resetModules()` fabrica exactamente el modo de falla que se está descartando: dos registros
    // distintos para el mismo paquete. Sin este control, la aserción de arriba podría estar
    // pasando por comparar algo consigo mismo y nadie se enteraría (ADR-020).
    vi.resetModules();
    const otraInstancia = await import('@istock/media');

    expect(otraInstancia.setMediaIncidentReporter).not.toBe(subpath.setMediaIncidentReporter);
  });
});
