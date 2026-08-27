import 'server-only';

/**
 * Logger del panel. Existe para hacer **imposible** el `console.log` que prohíbe `CLAUDE.md` §2:
 * *"`console.log` de un listing completo → rechazo"* y *"IMEI, `cost_usd`, `margin`,
 * `internal_notes` cruzando a un DTO público → rechazo"*.
 *
 * Reglas que impone el tipo, no la disciplina:
 * - El payload es `Record<string, string | number | boolean>`. **No entra un objeto**, así que no
 *   se puede loguear un listing "sin querer".
 * - Hay una denylist de nombres de campo. Si alguien intenta `logEvent('x', { imei })`, en dev
 *   tira y en producción el campo se descarta con un marcador. Se prefiere perder una línea de
 *   log antes que escribir un IMEI en un archivo que después va a Sentry.
 */

export type LogFields = Readonly<Record<string, string | number | boolean>>;

/**
 * Nombres que jamás se escriben. `email` y `phone` son PII; `imei` es dato regulado;
 * `cost`/`margin` rompen `CLAUDE.md` §0.9 aunque el destino sea un archivo interno.
 */
const FORBIDDEN_FIELD = /imei|cost|margin|price|internal|note|email|mail|phone|telefono|address|direccion|token|secret|password|full_?name/iu;

const REDACTED = '[redactado]';

function sanitize(fields: LogFields): Record<string, string | number | boolean> {
  const safe: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (FORBIDDEN_FIELD.test(key)) {
      if (process.env['NODE_ENV'] !== 'production') {
        throw new Error(
          `logEvent: el campo "${key}" no se puede loguear (PII o dato sensible, CLAUDE.md §2). ` +
            'Logueá el id, no el valor.',
        );
      }
      safe[key] = REDACTED;
      continue;
    }
    safe[key] = value;
  }
  return safe;
}

/** `logEvent('tenant.created', { tenantId, userId })`. Ids, nunca contenido. */
export function logEvent(event: string, fields: LogFields = {}): void {
  const line = JSON.stringify({ event, ...sanitize(fields) });
  // eslint-disable-next-line no-console -- único punto de salida de logs del panel.
  console.log(line);
}

/**
 * Error operativo. No recibe el `Error` crudo: los mensajes de Postgres pueden incluir el valor
 * de la fila que violó una constraint, y esa fila puede tener un IMEI.
 */
export function logError(event: string, code: string, fields: LogFields = {}): void {
  const line = JSON.stringify({ event, level: 'error', code, ...sanitize(fields) });
  // eslint-disable-next-line no-console -- único punto de salida de logs del panel.
  console.error(line);
}
