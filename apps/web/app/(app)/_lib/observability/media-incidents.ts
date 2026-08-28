import 'server-only';
import { randomUUID } from 'node:crypto';
import { isVariant, setMediaIncidentReporter } from '@istock/media/incidents';
import type { MediaIncident, MediaIncidentReporter } from '@istock/media/incidents';
import { sentryDsn, serverEnv } from '../env';
import { logError } from '../log';

/**
 * Cableado del canal de incidentes de `@istock/media` contra Sentry.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Qué problema resuelve
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `packages/media` dejó de tirar dentro de un render cacheado (un `throw` ahí no es un 500: es un
 * 200 que nunca cierra el stream) y ahora **degrada y reporta** por `reportMediaIncident()`. El
 * paquete no conoce a Sentry: expone `setMediaIncidentReporter()` y espera que la app lo enchufe.
 * Hasta esta slice **nadie lo llamaba**, así que todo incidente moría en un `console.warn` de una
 * función serverless que nadie lee. Degradar sin reportar es cambiar un problema ruidoso por uno
 * invisible.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Tres invariantes, y ninguno es cosmético
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * 1. **La key completa NUNCA sale, tampoco a Sentry.** El incidente trae un *prefijo* por diseño,
 *    y este archivo **no serializa el objeto que recibe**: arma el payload campo por campo y
 *    vuelve a truncar el prefijo por su cuenta (`clampKeyPrefix`). Si mañana alguien sube
 *    `KEY_PREFIX_LENGTH` en `packages/media` —que no es nuestra columna— el recorte de acá sigue
 *    parado. Una key de variante pública mide 43 caracteres y la de un master mucho más: 12 no
 *    pueden ser una key entera ni por accidente. El `reason` además pasa por `redact()`, que borra
 *    UUIDs, hashes largos, mails y corridas de 15+ dígitos (`CLAUDE.md` §1.8: IMEI nunca en logs).
 *
 * 2. **El reporter no hace I/O y no puede tirar.** Corre adentro del camino de render, que es
 *    exactamente el lugar donde una excepción cuelga una ficha. Lo único que hace es sanitizar y
 *    empujar a una cola acotada. El POST lo hace el drenaje, que corre afuera.
 *
 * 3. **Sin DSN el cableado es inerte y silencioso.** No se registra reporter, no se levanta timer,
 *    no se toca la red. Y "inerte" significa literalmente eso: **no se pisa el reporter por
 *    defecto del paquete**, así que en dev se sigue viendo el `console.warn` que ya existía. Un
 *    cableado que apaga la única señal que había cuando no está configurado es peor que no
 *    cablear.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Por qué el import es `@istock/media/incidents` y no el barrel
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Este módulo lo carga `instrumentation.ts`, o sea el **bootstrap del server**: antes de la primera
 * request y en *toda* instancia, también en las que nunca van a servir una foto. El barrel arrastra
 * `./upload → ./pipeline → sharp`, y con él `libvips`. El subpath resuelve tres archivos de TS puro
 * (`incidents-entry → incidents → types`) y cero objetos nativos. Los números están medidos, y
 * están escritos en `instrumentation.ts` porque el que paga el cold start es él.
 *
 * Lo que hace que esto sea correcto y no sólo barato: **el registro del reporter es uno solo para
 * los dos entrypoints.** Acá se enchufa por el subpath, pero quien **emite** —`(storefront)/_lib/
 * listings.ts`— llama `reportMediaIncident` importado del barrel. Los dos resuelven al mismo
 * `packages/media/src/incidents.ts`, así que hay un único módulo y un único reporter. Si algún día
 * el `exports` del paquete apuntara el subpath a una copia, este cableado quedaría enchufado a un
 * canal por el que no pasa nadie: un sink silencioso, que es peor que no tener sink. Está medido en
 * `media-incidents.test.ts` ("el registro es UNO SOLO…"), no supuesto.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Por qué el POST no sale desde el reporter
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Con `cacheComponents` prendido, Next parchea `fetch`: `patch-fetch.js` hace `cacheSignal
 * .beginRead()` al entrar y `endRead()` al salir. Un `fetch` disparado desde adentro de un
 * `'use cache'` —que es donde renderiza la vidriera, que es donde se emiten estos incidentes—
 * mete a Sentry en el camino crítico del llenado del cache: una ficha que tarda lo que tarde
 * `sentry.io`. Ese es el mismo tipo de falla que el canal de incidentes vino a evitar.
 *
 * Por eso el reporter **encola** y el envío lo hace un `setInterval` creado en el bootstrap, o sea
 * en un contexto que nunca tuvo el `AsyncLocalStorage` de render (los timers **heredan** el
 * contexto de quien los crea: agendar desde el reporter no serviría). Va `unref()`ado: no mantiene
 * vivo el proceso ni cuenta como worker 24/7 (`CLAUDE.md` §3).
 *
 * La contracara, escrita para que nadie la descubra sola: en serverless el proceso se congela
 * entre invocaciones, así que la cola de una instancia se drena **en la próxima invocación de esa
 * misma instancia**, y si la instancia muere sin recibir otra request esos incidentes se pierden.
 * Es aceptable a propósito: esto es un canal de degradación, no un libro contable. Lo que no es
 * aceptable es que el envío le cueste latencia a una ficha.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Por qué es un envelope a mano y no `@sentry/nextjs`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * El SDK oficial pide `withSentryConfig` en `next.config.ts` —que es del LEAD— y mete un bundle de
 * cliente en **las tres caras**, incluida la vidriera, cuyo presupuesto de JS es cero
 * (`ARCHITECTURE.md` §"Presupuesto de performance"). Para cuatro campos escalares que salen del
 * server, un POST de envelope es toda la superficie que hace falta: cero dependencias, cero bytes
 * al browser, y ningún auto-captura de headers/cookies que pudiera arrastrar PII sin que lo
 * decidamos nosotros. Si algún día el LEAD adopta el SDK, lo que cambia es `sendEnvelope`.
 */

/** Cuántos caracteres de la key se dejan ver. Espeja `keyPrefix()` de `@istock/media`. */
const KEY_PREFIX_LENGTH = 12;

/** Techo del motivo. Un `MEDIA_CONFIG` trae el mensaje de Zod entero y no aporta nada más largo. */
const MAX_REASON_LENGTH = 200;

/** Incidentes en vuelo. Más que esto y el problema no es de observabilidad. */
const MAX_QUEUE = 32;

/** Fingerprints ya vistos por instancia. Se vacía al llegar al techo: es dedup, no un registro. */
const MAX_SEEN = 200;

/** Cada cuánto se drena la cola. */
const FLUSH_INTERVAL_MS = 5_000;

/** Techo del POST. Sentry lento no puede convertirse en un handle colgado. */
const SEND_TIMEOUT_MS = 3_000;

const KNOWN_CODES = new Set(['MEDIA_UNSAFE_KEY', 'MEDIA_CONFIG']);

/** Destino de ingestión derivado del DSN. */
export interface SentryTarget {
  readonly envelopeUrl: string;
  readonly publicKey: string;
}

/** Lo único que se manda. Cuatro escalares, todos acotados. */
export interface SafeMediaIncident {
  readonly code: string;
  readonly reason: string;
  readonly keyPrefix: string;
  readonly variant: string;
}

/**
 * `https://<publicKey>@<host>[/<path>]/<projectId>` → URL de envelope.
 *
 * Devuelve `null` para cualquier cosa que no sea un DSN: eso incluye la cadena vacía de
 * `.env.example`, un `undefined`, y un DSN mal tipeado. No tira. Un DSN roto apaga la telemetría;
 * no puede apagar el panel.
 */
export function parseSentryDsn(raw: string | null | undefined): SentryTarget | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;

  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username.length === 0) return null;

  const segments = url.pathname.split('/').filter((segment) => segment.length > 0);
  const projectId = segments.pop();
  if (projectId === undefined || !/^[A-Za-z0-9_-]+$/.test(projectId)) return null;

  const prefix = segments.length > 0 ? `/${segments.join('/')}` : '';
  return {
    envelopeUrl: `${url.origin}${prefix}/api/${projectId}/envelope/`,
    publicKey: url.username,
  };
}

/**
 * Recorta el prefijo de key. Es redundante con `packages/media` **a propósito**: la garantía de
 * que la key entera no sale no puede depender de una constante de otra columna.
 */
function clampKeyPrefix(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return '';
  const withoutEllipsis = value.endsWith('…') ? value.slice(0, -1) : value;
  return withoutEllipsis.length <= KEY_PREFIX_LENGTH
    ? withoutEllipsis
    : `${withoutEllipsis.slice(0, KEY_PREFIX_LENGTH)}…`;
}

/**
 * Borra del motivo todo lo que pueda identificar algo: UUID (tenant / listing), corridas largas de
 * hex (hash de contenido), mails y corridas de 15+ dígitos (IMEI). Hoy `packages/media` sólo manda
 * motivos estructurales, pero uno de ellos es `error.message` de un `MediaConfigError`, o sea texto
 * que escribe otra columna. La sanitización se hace donde está la obligación, no donde está la
 * buena voluntad.
 */
function redact(value: unknown): string {
  const text = typeof value === 'string' ? value : String(value ?? '');
  return (
    text
      // Primero las KEYS ENTERAS, antes que las reglas por pieza: una key redactada pieza por
      // pieza sigue dejando ver su cola. Las dos formas están en `packages/media/src/keys.ts`
      // (`MASTER_KEY_RE`, `PUBLIC_KEY_RE`) y se cortan hasta el próximo espacio.
      .replace(/originals\/\S*/giu, '[key]')
      .replace(/\bv1\/[0-9a-f]{2}\/\S*/giu, '[key]')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu, '[uuid]')
      .replace(/[^\s@]+@[^\s@.]+\.[^\s@]+/gu, '[mail]')
      // El IMEI va ANTES que el hash: 15 dígitos también son 15 caracteres hex válidos, y la
      // regla de hash se lo comería primero. El valor desaparecería igual, pero la etiqueta
      // importa: `[digits]` en Sentry es la señal de que un IMEI estuvo a punto de viajar.
      .replace(/\d{15,}/gu, '[digits]')
      // 8 y no 32: `contentHash` trunca a 32 hex, pero un segmento suelto de un hash es igual de
      // identificador. Ninguna palabra de un motivo se escribe sólo con `[0-9a-f]`.
      .replace(/\b[0-9a-f]{8,}\b/giu, '[hash]')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, MAX_REASON_LENGTH)
  );
}

/** Campo por campo, nunca por spread. Un spread de mañana traería lo que agreguen mañana. */
export function sanitizeMediaIncident(incident: MediaIncident): SafeMediaIncident {
  const code = KNOWN_CODES.has(incident.code) ? incident.code : 'MEDIA_UNKNOWN';
  return {
    code,
    reason: redact(incident.reason),
    keyPrefix: clampKeyPrefix(incident.keyPrefix),
    variant:
      typeof incident.variant === 'string' && isVariant(incident.variant)
        ? incident.variant
        : 'none',
  };
}

/** `code|variant|reason|keyPrefix`: dos incidentes con la misma cara se mandan una sola vez. */
function fingerprintOf(safe: SafeMediaIncident): string {
  return `${safe.code}|${safe.variant}|${safe.reason}|${safe.keyPrefix}`;
}

/**
 * Envelope de Sentry: header, header de item, payload. Tres líneas NDJSON.
 *
 * No se manda `server_name`, ni `request`, ni `user`, ni breadcrumbs. Sale lo que está acá escrito
 * y nada más.
 */
export function buildSentryEnvelope(
  safe: SafeMediaIncident,
  meta: { readonly eventId: string; readonly sentAt: Date; readonly environment: string },
): string {
  const header = { event_id: meta.eventId, sent_at: meta.sentAt.toISOString() };
  const itemHeader = { type: 'event' };
  const payload = {
    event_id: meta.eventId,
    timestamp: meta.sentAt.getTime() / 1000,
    platform: 'node',
    level: 'warning',
    logger: 'media.incident',
    environment: meta.environment,
    message: { formatted: `${safe.code}: ${safe.reason}` },
    // Agrupa por causa, no por foto: mil fichas rotas por la misma config son un issue, no mil.
    fingerprint: ['media-incident', safe.code, safe.variant, safe.reason],
    tags: { 'media.code': safe.code, 'media.variant': safe.variant },
    extra: { key_prefix: safe.keyPrefix },
  };

  return `${JSON.stringify(header)}\n${JSON.stringify(itemHeader)}\n${JSON.stringify(payload)}\n`;
}

/** Lo que el sink necesita del mundo. Inyectable para poder testear sin red ni relojes. */
export interface MediaIncidentSinkDeps {
  readonly target: SentryTarget;
  readonly environment: string;
  readonly send: (url: string, init: RequestInit) => Promise<unknown>;
  readonly now: () => Date;
  readonly eventId: () => string;
}

export interface MediaIncidentSink {
  readonly report: MediaIncidentReporter;
  readonly flush: () => Promise<void>;
  readonly pending: () => number;
}

/**
 * Cola acotada + drenaje. `report` es síncrono, sin I/O y sin `throw`; `flush` es el que sale a la
 * red y también se traga todo (`reportMediaIncident` ya envuelve al reporter en un `try`, pero un
 * canal cuya razón de ser es no tirar no delega eso en su llamador).
 */
export function createMediaIncidentSink(deps: MediaIncidentSinkDeps): MediaIncidentSink {
  const queue: SafeMediaIncident[] = [];
  const seen = new Set<string>();

  const report: MediaIncidentReporter = (incident) => {
    try {
      const safe = sanitizeMediaIncident(incident);
      const fingerprint = fingerprintOf(safe);
      if (seen.has(fingerprint)) return;
      // El techo de la cola se mira ANTES de marcar el fingerprint como visto. Al revés —que es
      // como estaba— un incidente descartado por cola llena quedaba anotado como "ya reportado" y
      // no volvía a intentarse nunca: justo la ráfaga que desborda es la que se perdía entera.
      if (queue.length >= MAX_QUEUE) return;
      if (seen.size >= MAX_SEEN) seen.clear();
      seen.add(fingerprint);
      queue.push(safe);
    } catch {
      /* el canal que existe para no tirar en render no tira en render */
    }
  };

  const flush = async (): Promise<void> => {
    const batch = queue.splice(0, queue.length);
    for (const safe of batch) {
      try {
        const body = buildSentryEnvelope(safe, {
          eventId: deps.eventId(),
          sentAt: deps.now(),
          environment: deps.environment,
        });
        await deps.send(deps.target.envelopeUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-sentry-envelope',
            'x-sentry-auth': `Sentry sentry_version=7, sentry_client=istock-media/1, sentry_key=${deps.target.publicKey}`,
          },
          body,
          cache: 'no-store',
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
      } catch {
        // Sentry caído, DNS, timeout. Se pierde el incidente y no pasa nada más: reintentar
        // sería construir una cola de reintentos adentro de una función serverless.
      }
    }
  };

  return { report, flush, pending: () => queue.length };
}

let wired = false;

export type WireResult = 'wired' | 'inert' | 'already-wired';

/**
 * Enchufa el sink. Idempotente: `register()` de `instrumentation.ts` corre una vez por proceso,
 * pero en `next dev` un módulo puede reevaluarse y dos intervalos serían dos drenajes.
 *
 * **Nunca tira.** `serverEnv()` sí puede tirar (valida `process.env` entero con Zod), y eso está
 * bien en el camino de una request —ahí el error tiene que ser ruidoso— pero acá convertiría "una
 * env de runtime está mal" en "el servidor no arranca", que es justo lo que el comentario de
 * `_lib/env.ts` dice que el parseo perezoso viene a evitar.
 */
export function wireMediaIncidents(): WireResult {
  if (wired) return 'already-wired';

  let target: SentryTarget | null = null;
  let environment = 'development';
  let configured = false;

  try {
    const raw = sentryDsn();
    configured = raw !== null;
    target = parseSentryDsn(raw);
    environment = serverEnv().NODE_ENV;
  } catch {
    return 'inert';
  }

  if (target === null) {
    // Silencio total cuando no hay DSN (dev y preview). Una sola línea cuando **sí** lo
    // configuraron y está roto: eso es un error de despliegue nuestro y merece saberse, pero una
    // vez, en el bootstrap, y no una por incidente.
    if (configured) logError('media.incidents.dsn_invalid', 'unparseable', {});
    return 'inert';
  }

  const sink = createMediaIncidentSink({
    target,
    environment,
    send: (url, init) => fetch(url, init),
    now: () => new Date(),
    eventId: () => randomUUID().replaceAll('-', ''),
  });

  setMediaIncidentReporter(sink.report);

  // Creado ACÁ, en el bootstrap: un timer hereda el `AsyncLocalStorage` de quien lo crea, y este
  // no tiene ninguno. Ver el encabezado. `unref()` para no sostener el proceso.
  const timer = setInterval(() => {
    void sink.flush();
  }, FLUSH_INTERVAL_MS);
  timer.unref?.();

  wired = true;
  return 'wired';
}

/** Sólo para tests: vuelve a permitir el cableado. */
export function resetMediaIncidentsWiring(): void {
  wired = false;
}
