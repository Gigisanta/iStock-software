import { normalizeWaPhone } from '@istock/domain';

/**
 * Lo que la pantalla de canjes necesita para dibujarse. Puro, sin I/O y **sin `server-only`**: lo
 * calcula el Server Component y viaja como props. Mismo criterio que `sales/presentation.ts`.
 *
 * ── Por qué el link de WhatsApp puede no existir ─────────────────────────────────────────────
 * El teléfono del lead lo escribió un **visitante anónimo** en la vidriera. El `CHECK` de Postgres
 * sólo le exige entre 6 y 25 caracteres, así que `"0299 15-4123456"` es una fila perfectamente
 * legal y `normalizeWaPhone()` la rechaza (E.164 sin cero inicial). Un `<a href>` armado con eso
 * abre WhatsApp en una conversación que no existe.
 *
 * Y sobre todo: `normalizeWaPhone()` **tira** un `DomainError` cuyo mensaje **cita el teléfono
 * crudo**. Dejarlo propagar desde un render no sólo rompe la pantalla del inbox por un lead mal
 * escrito — pone PII de un visitante en un stack trace que después va a Sentry. Por eso se atrapa
 * acá y se devuelve `null`: la pantalla muestra el número tal cual lo dejó la persona, sin link, y
 * el mostrador lo copia a mano.
 */

/** `https://wa.me/{E.164}`, o `null` si lo que escribió el visitante no es un teléfono usable. */
export function waHref(rawPhone: string): string | null {
  try {
    return `https://wa.me/${normalizeWaPhone(rawPhone)}`;
  } catch {
    return null;
  }
}

/**
 * La ficha del lead → los valores con los que se precarga el formulario de aceptar.
 *
 * Es **precarga, no verdad**: los declaró el visitante desde el teléfono, sin ver el equipo y sin
 * que nadie lo revise. Quien acepta tiene el equipo en la mano y corrige lo que haga falta antes
 * de confirmar; lo que se guarda en `listings` es lo que confirmó el dueño.
 */
export function prefillValue(value: number | null): string {
  return value === null ? '' : String(value);
}
