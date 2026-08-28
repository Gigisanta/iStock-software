/**
 * Leer un error de Postgres **sin loguearlo**.
 *
 * Dos funciones minúsculas y un motivo grande: el `Error` crudo de un driver de Postgres trae el
 * `DETAIL` de la fila que rompió la constraint, y en este producto esa fila puede tener un IMEI o
 * el WhatsApp de un dueño. `log.ts` no acepta objetos justamente para que no se pueda "loguear el
 * error y seguir". Lo que sí se puede publicar es el **código** (`23505`, `40P01`) y el **nombre**
 * de un índice: eso es DDL, no es dato de nadie.
 *
 * ── Por qué es un módulo aparte y no vive donde se usa ───────────────────────────────────────
 * Lo escribió `tenants/create-tenant.ts` para distinguir dos `23505` que le piden a la persona
 * cosas opuestas (cambiar el link vs. no hacer nada). `reservations/reserve-unit.ts` necesita
 * exactamente lo mismo para el índice único parcial de "una reserva activa por unidad". La
 * segunda copia de un discriminador de seguridad es la que se olvida de leer `constraint` cuando
 * alguien cambia de driver, y ahí un `23505` conocido pasa a `null` y se propaga como un 500.
 *
 * **Sin `server-only`, a propósito**: no toca base ni entorno, es una lectura de propiedades. Eso
 * lo hace importable desde un Route Handler que en los tests corre sin el shim de React Server.
 */

interface PgErrorShape {
  readonly code?: string;
  readonly constraint_name?: string;
  readonly constraint?: string;
}

function asPgError(error: unknown): PgErrorShape | null {
  if (typeof error !== 'object' || error === null) return null;
  return error as PgErrorShape;
}

/**
 * Nombre de la constraint de un `23505`, o `null` si el error es otra cosa.
 *
 * `postgres-js` expone el campo `n` del `ErrorResponse` como `constraint_name`; `node-postgres` lo
 * llama `constraint`. Se leen los dos: el driver es un detalle de infraestructura y ninguna
 * decisión de producto puede depender de cuál está montado.
 *
 * Un `23505` **sin** nombre de constraint devuelve `'unnamed'`, no `null`: sigue siendo una
 * violación de unicidad, sólo que anónima, y una anónima no puede heredar el mensaje de ninguna de
 * las que sí conocemos. Postgres manda ese campo desde 9.3 para toda violación de integridad, así
 * que llegar ahí ya es raro — razón de más para no adivinar.
 */
export function uniqueViolationConstraint(error: unknown): string | null {
  const pg = asPgError(error);
  if (pg === null || pg.code !== '23505') return null;
  return pg.constraint_name ?? pg.constraint ?? 'unnamed';
}

/**
 * `SQLSTATE` del error, o `'unknown'`. Es lo único del error que se puede escribir en un log.
 *
 * Sirve para que un fallo del cron se distinga de otro sin abrir el objeto: `40P01` (deadlock)
 * y `08006` (se cayó la conexión) piden cosas distintas y los dos se ven igual como "falló".
 */
export function pgErrorCode(error: unknown): string {
  const pg = asPgError(error);
  return typeof pg?.code === 'string' && pg.code.length > 0 ? pg.code : 'unknown';
}

/** `deadlock_detected`. Es DDL de Postgres, no un dato de nadie: se puede loguear. */
export const DEADLOCK = '40P01';

/**
 * ¿Postgres eligió a esta transacción como víctima de un deadlock?
 *
 * Importa que sea una sola función y no un `=== '40P01'` suelto en cada módulo, porque los tres
 * lugares que tocan `listings` + `reservations` tienen que responder **lo mismo**: para la persona
 * parada en el mostrador, un deadlock es indistinguible de que otro dispositivo le haya ganado de
 * mano. Los dos casos se resuelven recargando la pantalla, y ninguno es un 500.
 *
 * El orden de locks unificado (`listings` → `reservations`, D1 del LEAD) hace que esto no debería
 * pasar. "No debería" no es un manejo de error.
 */
export function isDeadlock(error: unknown): boolean {
  return pgErrorCode(error) === DEADLOCK;
}
