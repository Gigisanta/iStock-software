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
 *
 * ── El error del driver NO es el error que se atrapa. Medido, no leído ────────────────────────
 * Hasta el 2026-08-28 este módulo leía `code` y `constraint_name` del objeto **de arriba**, y por
 * eso no leía nada: **Drizzle 0.45.2 no propaga el error del driver, lo envuelve**. Cada query
 * pasa por `wrapQuery`, que atrapa lo que tire `postgres-js` y tira en su lugar un
 * `DrizzleQueryError` —cuyo `message` es `Failed query: …` y cuyo `code` es `undefined`— con el
 * `PostgresError` real colgado en `.cause`. Lo midió el LEAD contra Postgres real, por
 * `db.execute` y por `tx.execute`:
 *
 *     via db.execute → DrizzleQueryError | code: undefined | cause: PostgresError 23505 …_k_key
 *     via tx.execute → DrizzleQueryError | code: undefined | cause: PostgresError 23505 …_k_key
 *
 * O sea que `uniqueViolationConstraint()` devolvía `null` y `pgErrorCode()` devolvía `'unknown'`
 * **para todo error que pasara por Drizzle, que son todos**. Seis `catch` escritos, bien escritos,
 * y muertos: el mensaje de "ese link ya está ocupado" del onboarding, "otra pestaña reservó",
 * `LOST_RACE`, `ALREADY_SOLD`, y el código del cron que existe justamente para distinguir un
 * deadlock de una conexión caída. Ninguno salió nunca. No lo vio TypeScript —todas las funciones
 * toman `unknown`— ni lo vio ningún test, porque **no había test**.
 *
 * Por eso ahora se camina la cadena de `cause`. Tres decisiones y las tres tienen motivo:
 *
 *  1. **Acotada, no `while (true)`.** `cause` es una propiedad cualquiera y nada impide un ciclo
 *     (`a.cause = b; b.cause = a`): un walk sin techo cuelga el request en vez de fallar. El techo
 *     es holgado respecto de lo que se mide hoy (un solo eslabón) porque el punto no es adivinar
 *     el largo, es que el largo no importe.
 *  2. **Gana el primer eslabón con un `code` de SQLSTATE**, no el primero que tenga cualquier
 *     `code`. `DrizzleQueryError` no trae `code`, pero un `Error` de Node sí puede traer uno que no
 *     es de Postgres (`ENOTFOUND`), y quedarse con ése taparía al `23505` que viene abajo.
 *  3. **Si ningún eslabón tiene SQLSTATE, vale el primero con `code` a secas.** No es un adorno:
 *     `postgres-js` reporta la conexión caída como un `Error` con `code: 'CONNECTION_ENDED'`, que
 *     no es SQLSTATE y **también viaja envuelto en `DrizzleQueryError`** (medido, caso I). Exigir
 *     SQLSTATE a secas dejaría el log del cron en `'unknown'` justo en el caso que el docblock de
 *     `pgErrorCode` nombra como su razón de existir.
 *
 * ── Por qué el test no puede armar el error a mano ────────────────────────────────────────────
 * `pg-error.test.ts` levanta Postgres de verdad y hace que el driver tire los errores. Un
 * `{ code: '23505' }` escrito a mano es exactamente la forma que **nunca** produce el driver, y es
 * la razón por la que esto sobrevivió: un helper probado contra una forma inventada afirma un
 * mecanismo que no toca. El test cubre las dos formas —envuelta y cruda— porque las dos existen en
 * producción: lo que pasa por Drizzle viene envuelto, y lo que pasa por el cliente pelado no.
 */

interface PgErrorShape {
  readonly code?: string;
  readonly constraint_name?: string;
  readonly constraint?: string;
}

/**
 * Techo del walk de `cause`. Hoy la cadena real mide **uno** (`DrizzleQueryError` → `PostgresError`);
 * el margen está para que un envoltorio más —de Drizzle o nuestro— no vuelva a apagar los `catch` en
 * silencio. Lo que el número compra no es alcance, es terminación: `cause` puede ser cíclico.
 */
const MAX_CAUSE_DEPTH = 8;

/**
 * Un SQLSTATE son cinco caracteres de `[0-9A-Z]`: `23505`, `40P01`, `08006`.
 *
 * Devuelve `boolean` y **no** un type predicate (`code is string`) a propósito: un predicate hace
 * que en la rama negativa TypeScript le reste `string` a `code`, lo deje en `undefined`, y el
 * chequeo de fallback de abajo pase a ser `never`. La rama que atrapa `CONNECTION_ENDED` se
 * volvería incompilable por una narrowing que es cierta para el tipo y falsa para el dato.
 */
function isSqlState(code: unknown): boolean {
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code);
}

function asPgError(error: unknown): PgErrorShape | null {
  let node: unknown = error;
  let fallback: PgErrorShape | null = null;
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof node !== 'object' || node === null) break;
    const link = node as PgErrorShape & { readonly cause?: unknown };
    if (isSqlState(link.code)) return link;
    if (fallback === null && typeof link.code === 'string' && link.code.length > 0) fallback = link;
    node = link.cause;
  }
  return fallback;
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
