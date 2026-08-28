/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  El contador de queries de la vidriera. Owner: `qa-agent`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `CLAUDE.md` §3 pide que **el 95% de los hits de la vidriera no toquen Postgres**. Eso es una
 * afirmación sobre queries, y una afirmación sobre queries se prueba contando queries. Lo que este
 * módulo NO hace, y es la parte importante:
 *
 * - **No infiere el número desde un timing.** "Cacheado responde más rápido" es una correlación,
 *   no una cuenta: una respuesta rápida con una query adentro sigue siendo una query por pageview,
 *   y a 100.000 pageviews eso es la factura.
 * - **No lee un contador que expone el código bajo test.** `qa-agent` no edita `apps/web/**`, y un
 *   contador que viva adentro del módulo que se está auditando lo mantiene el mismo writer que la
 *   optimización que audita.
 *
 * ## Cómo cuenta, entonces
 * Se mete **debajo** del driver: un proxy TCP transparente entre `next start` y Postgres. El
 * `DATABASE_URL` que el `webServer` de Playwright le pasa al server apunta acá (ver
 * `playwright.config.ts`), y este módulo reenvía cada byte a Postgres sin tocarlo, contando al
 * pasar los mensajes del **protocolo de frontend** que llevan SQL:
 *
 * ```
 *   'Q'  Query   (protocolo simple)     → 1 sentencia
 *   'P'  Parse   (protocolo extendido)  → 1 sentencia   ← postgres.js con `prepare: false`
 * ```
 *
 * Un `Bind`/`Execute` de un `Parse` ya contado no suma: lo que se cuenta es **SQL enviado**, que es
 * exactamente lo que le cuesta a Postgres atender un pageview.
 *
 * Las sentencias de sesión y transacción (`begin`, `commit`, `set local role anon`,
 * `select set_config(...)`) se cuentan aparte, pero **suman al total**: `withStorefrontDb()` abre
 * una transacción por render, y un render cacheado no tiene que abrir ninguna. El número que va a
 * la línea `MEDIDO` es el total, porque "cero hits" significa cero, no "cero salvo el `begin`".
 *
 * ## Por qué es transparente y no un parser que reescribe
 * Los dos sockets se `pipe`an tal cual. El conteo pasa por un *listener* sobre el stream de ida,
 * o sea que un bug del parser puede hacer que el número esté mal —y eso se ve como un test rojo—
 * pero **no puede corromper la conexión** ni cambiar lo que la app le manda a la base. Esa es toda
 * la diferencia entre "el arnés miente" y "el arnés rompe la suite entera".
 *
 * ## TLS: se detecta y se **falla**, no se adivina
 * Si el `DATABASE_URL` pidiera TLS, después del `SSLRequest` el stream va cifrado y no hay nada que
 * contar. En ese caso el espía marca `encrypted` y el spec **falla diciendo por qué**, en vez de
 * reportar `0` — un cero que en realidad significa "no vi nada" es la peor medición posible, y es
 * justo la que haría pasar el gate por la puerta de atrás.
 *
 * ## Perilla de escape
 * `E2E_PG_SPY=0` desconecta el espía: el server vuelve a hablarle a Postgres directo y el resto de
 * la suite corre igual. El spec de db-hits, en cambio, falla — a propósito: sin espía no hay
 * medición, y una medición ausente no puede leerse como una medición buena.
 */

import { createServer as createTcpServer, connect as tcpConnect } from 'node:net';
import type { Server as TcpServer, Socket } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';

/** Mismo default que `packages/db/src/env.ts` y que `_lib/db.ts`. */
export const REAL_DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/istock_dev';

export const PG_SPY_TCP_PORT = Number(process.env['E2E_PGSPY_PORT'] ?? '6544');
export const PG_SPY_HTTP_PORT = Number(process.env['E2E_PGSPY_HTTP_PORT'] ?? '6545');

/** `E2E_PG_SPY=0` apaga el espía. Ver el docblock. */
export const PG_SPY_ENABLED = process.env['E2E_PG_SPY'] !== '0';

const READY_FLAG = 'E2E_PGSPY_READY';

export interface PgSpyStats {
  /** Sentencias SQL que el server le mandó a Postgres desde el último `reset`. */
  readonly statements: number;
  /** De esas, cuántas son control de sesión/transacción (`begin`, `commit`, `set`, `set_config`). */
  readonly sessionControl: number;
  /** Conexiones nuevas abiertas desde el último `reset`. */
  readonly connections: number;
  /** `true` si la conexión negoció TLS: el espía no puede contar y la medición no vale. */
  readonly encrypted: boolean;
  /** Primeras sentencias vistas, recortadas. Para poder decir QUÉ se consultó de más. */
  readonly samples: readonly string[];
}

interface MutableStats {
  statements: number;
  sessionControl: number;
  connections: number;
  encrypted: boolean;
  samples: string[];
}

const stats: MutableStats = {
  statements: 0,
  sessionControl: 0,
  connections: 0,
  encrypted: false,
  samples: [],
};

const MAX_SAMPLES = 16;
const SAMPLE_CHARS = 120;

/**
 * Control de sesión y de transacción. Se cuenta aparte para poder **decir** de qué está hecho un
 * número distinto de cero, no para descontarlo: un `begin` en un pageview cacheado es un roundtrip
 * a Postgres igual que un `select`.
 */
const SESSION_CONTROL_RE =
  /^\s*(begin|start\s+transaction|commit|rollback|savepoint|release|set\b|select\s+set_config|discard|deallocate|listen|unlisten)/iu;

function record(sql: string): void {
  stats.statements += 1;
  if (SESSION_CONTROL_RE.test(sql)) stats.sessionControl += 1;
  if (stats.samples.length < MAX_SAMPLES) {
    stats.samples.push(sql.replace(/\s+/gu, ' ').trim().slice(0, SAMPLE_CHARS));
  }
}

function resetStats(): void {
  stats.statements = 0;
  stats.sessionControl = 0;
  stats.connections = 0;
  stats.samples = [];
  // `encrypted` NO se resetea: es una propiedad del transporte, no de la ventana de medición.
}

function snapshot(): PgSpyStats {
  return {
    statements: stats.statements,
    sessionControl: stats.sessionControl,
    connections: stats.connections,
    encrypted: stats.encrypted,
    samples: [...stats.samples],
  };
}

// ── el parser del protocolo de frontend ───────────────────────────────────────────────────────

const SSL_REQUEST_CODE = 80877103;
const GSSENC_REQUEST_CODE = 80877104;
const MSG_QUERY = 0x51; // 'Q'
const MSG_PARSE = 0x50; // 'P'
/** Por encima de esto no se bufferea el mensaje: se saltea. Un `Parse` nunca es así de grande. */
const MAX_BUFFERED_MESSAGE = 1_048_576;

function cstring(body: Buffer, from: number): { readonly value: string; readonly next: number } {
  const end = body.indexOf(0, from);
  if (end === -1) return { value: body.toString('utf8', from), next: body.byteLength };
  return { value: body.toString('utf8', from, end), next: end + 1 };
}

/**
 * Máquina de estados del stream **cliente → servidor**. Sólo lee; nunca modifica ni retiene el
 * flujo, que se reenvía por `pipe()` aparte.
 *
 * `blind` es la rendición explícita: si el stream deja de parsearse (TLS, o un mensaje que no
 * entendemos), se deja de contar **y se dice**, en vez de seguir sumando números inventados.
 */
class FrontendParser {
  private buf: Buffer = Buffer.alloc(0);
  private phase: 'startup' | 'messages' | 'blind' = 'startup';
  private skip = 0;

  blind(): void {
    this.phase = 'blind';
    this.buf = Buffer.alloc(0);
  }

  feed(chunk: Buffer, onSslRequest: () => void): void {
    if (this.phase === 'blind') return;
    this.buf = this.buf.byteLength === 0 ? chunk : Buffer.concat([this.buf, chunk]);

    for (;;) {
      if (this.skip > 0) {
        const taken = Math.min(this.skip, this.buf.byteLength);
        this.skip -= taken;
        this.buf = this.buf.subarray(taken);
        if (this.skip > 0) return;
      }

      if (this.phase === 'startup') {
        if (this.buf.byteLength < 8) return;
        const length = this.buf.readUInt32BE(0);
        if (length < 8 || length > MAX_BUFFERED_MESSAGE) return this.blind();
        const code = this.buf.readUInt32BE(4);
        if (this.buf.byteLength < length) return;
        this.buf = this.buf.subarray(length);
        if (length === 8 && (code === SSL_REQUEST_CODE || code === GSSENC_REQUEST_CODE)) {
          // Pidió cifrado. Si el server acepta, lo que sigue no se puede leer: ver `onSslRequest`.
          onSslRequest();
          continue;
        }
        this.phase = 'messages';
        continue;
      }

      if (this.buf.byteLength < 5) return;
      const type = this.buf[0];
      const length = this.buf.readUInt32BE(1);
      if (type === undefined || length < 4) return this.blind();
      const total = 1 + length;

      if (total > MAX_BUFFERED_MESSAGE) {
        // Mensaje enorme (un `Bind` con un payload grande): no se bufferea, se saltea entero.
        this.skip = total - this.buf.byteLength;
        this.buf = Buffer.alloc(0);
        if (this.skip < 0) return this.blind();
        continue;
      }
      if (this.buf.byteLength < total) return;

      const body = this.buf.subarray(5, total);
      this.buf = this.buf.subarray(total);

      if (type === MSG_QUERY) record(cstring(body, 0).value);
      else if (type === MSG_PARSE) record(cstring(body, cstring(body, 0).next).value);
    }
  }
}

// ── el proxy ──────────────────────────────────────────────────────────────────────────────────

let tcpServer: TcpServer | null = null;
let httpServer: HttpServer | null = null;

function upstream(): { readonly host: string; readonly port: number } {
  const url = new URL(REAL_DATABASE_URL);
  return { host: url.hostname, port: Number(url.port === '' ? '5432' : url.port) };
}

/** El `DATABASE_URL` que ve el server bajo prueba: el mismo, con el host apuntando al espía. */
export function spiedDatabaseUrl(): string {
  const url = new URL(REAL_DATABASE_URL);
  url.hostname = '127.0.0.1';
  url.port = String(PG_SPY_TCP_PORT);
  return url.toString();
}

function handleConnection(client: Socket): void {
  const target = upstream();
  const server = tcpConnect({ host: target.host, port: target.port });
  const parser = new FrontendParser();
  let sslRequested = false;
  let sslAnswered = false;

  stats.connections += 1;

  client.on('data', (chunk: Buffer) => {
    parser.feed(chunk, () => {
      sslRequested = true;
    });
  });

  server.on('data', (chunk: Buffer) => {
    // La única lectura del stream de vuelta: la respuesta al `SSLRequest`. `S` = "hablemos TLS",
    // y a partir de ahí lo que viaje por el socket no es parseable. Se marca y se deja de contar.
    if (!sslRequested || sslAnswered || chunk.byteLength === 0) return;
    sslAnswered = true;
    if (chunk[0] === 0x53 /* 'S' */) {
      stats.encrypted = true;
      parser.blind();
    }
  });

  const end = (): void => {
    client.destroy();
    server.destroy();
  };
  client.on('error', end);
  server.on('error', end);
  client.on('close', end);
  server.on('close', end);

  client.pipe(server);
  server.pipe(client);
  client.unref();
  server.unref();
}

function handleControl(request: IncomingMessage, response: ServerResponse): void {
  const path = (request.url ?? '/').split('?')[0];
  if (path === '/reset') resetStats();
  response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(snapshot()));
}

/**
 * Arranca el espía **una sola vez por corrida** y devuelve el `DATABASE_URL` para el server.
 *
 * Lo llama `playwright.config.ts` a nivel de módulo, así que corre tanto en el proceso principal
 * como en cada worker (Playwright carga el config en los dos). El flag de entorno es lo que hace
 * que sólo el principal escuche: los workers heredan el `process.env` del principal y se enteran
 * de que ya hay un espía sin pelearse por el puerto.
 *
 * Los dos servidores van `unref()`: existen mientras la corrida exista y no le agregan un motivo
 * al proceso para no terminar.
 */
export function startPgSpy(): string {
  if (!PG_SPY_ENABLED) return REAL_DATABASE_URL;
  if (process.env[READY_FLAG] === '1') return spiedDatabaseUrl();

  tcpServer = createTcpServer(handleConnection);
  tcpServer.on('error', (error: Error) => {
    process.stderr.write(
      `pg-spy: no pude escuchar en 127.0.0.1:${String(PG_SPY_TCP_PORT)} (${error.message}). ` +
        'Si quedó un espía de una corrida anterior, matalo; si el puerto es de otra cosa, ' +
        'corré con E2E_PGSPY_PORT=<libre>.\n',
    );
  });
  tcpServer.listen(PG_SPY_TCP_PORT, '127.0.0.1');
  tcpServer.unref();

  httpServer = createHttpServer(handleControl);
  httpServer.on('error', (error: Error) => {
    process.stderr.write(`pg-spy: el control HTTP no pudo escuchar (${error.message})\n`);
  });
  httpServer.listen(PG_SPY_HTTP_PORT, '127.0.0.1');
  httpServer.unref();

  process.env[READY_FLAG] = '1';
  return spiedDatabaseUrl();
}

// ── lado del test (corre en el worker, habla con el proceso principal por HTTP) ────────────────

const CONTROL_URL = `http://127.0.0.1:${String(PG_SPY_HTTP_PORT)}`;

async function control(path: string): Promise<PgSpyStats> {
  if (!PG_SPY_ENABLED) {
    throw new Error(
      'E2E_PG_SPY=0: el espía de Postgres está apagado, así que no hay contador de queries. ' +
        'La medición de db-hits no se puede hacer sin él (y un 0 sin espía no significa nada).',
    );
  }
  let response: Response;
  try {
    response = await fetch(`${CONTROL_URL}${path}`, { signal: AbortSignal.timeout(5_000) });
  } catch (error) {
    throw new Error(
      `el espía de Postgres no contesta en ${CONTROL_URL}${path} ` +
        `(${error instanceof Error ? error.message : String(error)}). Lo levanta ` +
        '`playwright.config.ts` al cargarse: si este spec se corrió con otro config, no hay contador.',
    );
  }
  return (await response.json()) as PgSpyStats;
}

/** Pone el contador en cero y devuelve el estado ya reseteado. */
export async function resetPgSpy(): Promise<PgSpyStats> {
  return control('/reset');
}

/** Lo que el server le mandó a Postgres desde el último `resetPgSpy()`. */
export async function pgSpyStats(): Promise<PgSpyStats> {
  return control('/stats');
}

/**
 * Falla con un mensaje que dice **qué** está mal cuando el espía existe pero no está en el camino.
 *
 * El caso real y silencioso: `reuseExistingServer` reusa un `next start` de una corrida anterior,
 * que se conectó a Postgres **directo** porque el espía no existía cuando arrancó. Todo funciona,
 * la vidriera responde, y el contador dice 0 para siempre. Un 0 así pasaría el gate de M5 mientras
 * la ficha pega a Postgres en cada pageview.
 */
export function assertSpyWasInThePath(stats: PgSpyStats, what: string): void {
  if (stats.encrypted) {
    throw new Error(
      `${what}: la conexión a Postgres va por TLS, así que el espía no puede contar sentencias. ` +
        'Correr los e2e contra una base local sin TLS (`scripts/pg-local.sh`).',
    );
  }
  if (stats.statements === 0) {
    throw new Error(
      `${what}: el espía no vio UNA sola sentencia. El server bajo prueba no está pasando por él. ` +
        'Casi siempre es un `next start` viejo reusado (`reuseExistingServer`) que se conectó ' +
        `directo a Postgres: matá el proceso del puerto ${String(process.env['E2E_PORT'] ?? '3100')} ` +
        'y volvé a correr la suite. Reportar 0 acá sería reportar "no toca Postgres" cuando la ' +
        'verdad es "no vi nada".',
    );
  }
}
