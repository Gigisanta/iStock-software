import {
  RESERVATION_DEFAULT_MINUTES,
  RESERVATION_MAX_MINUTES,
  RESERVATION_MIN_MINUTES,
} from '@istock/domain';

/**
 * Cómo se le cuenta una reserva a alguien parado en el mostrador.
 *
 * Puro y con `now` inyectado: es la única forma de testear "quedan 45 min" sin congelar el reloj
 * del proceso. Vive en `_lib` y no en `_ui` porque no dibuja nada — devuelve texto.
 *
 * ── Por qué la cuenta regresiva y no la hora ────────────────────────────────────────────────
 * "Reservado hasta las 15:30" obliga a elegir una zona horaria, y el servidor corre en UTC: en
 * Vercel eso se ve como una reserva que vence tres horas más tarde de lo que dice la pantalla. La
 * cuenta regresiva no tiene zona horaria, y además es la pregunta real del mostrador — nadie mira
 * el reloj, mira cuánto falta.
 */

/**
 * Las duraciones que ofrece el `<select>`.
 *
 * Son cuatro presets, no el rango entero: en un teléfono, con una mano, una lista de 91 opciones
 * es peor que ninguna. El rango de verdad lo impone `reserveUnitSchema` (que importa las
 * constantes del dominio) y, abajo de todo, el `CHECK` de Postgres. El test de este módulo
 * verifica que los cuatro presets caigan dentro del rango del dominio y que el default esté entre
 * ellos: si mañana el dominio mueve el mínimo a 45, esta lista falla en vez de ofrecer una opción
 * que el server rechaza.
 */
export const RESERVATION_MINUTE_OPTIONS: readonly number[] = [30, 60, 90, 120];

/** El preset que viene elegido. Es el default del dominio, no una preferencia de esta pantalla. */
export const RESERVATION_DEFAULT_OPTION = RESERVATION_DEFAULT_MINUTES;

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;

/** "1 h 30 min" · "45 min". Se usa en el `<option>` y en la cuenta regresiva. */
export function durationLabel(minutes: number): string {
  if (minutes < MINUTES_PER_HOUR) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const rest = minutes % MINUTES_PER_HOUR;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
}

/**
 * Cuánto pasó desde que venció antes de que el texto deje de prometer que se arregla solo.
 *
 * El cron corre cada 5 minutos, así que 15 son tres oportunidades. Dentro de esa ventana "se libera
 * solo en unos minutos" es verdad y decir otra cosa sería alarmismo: el dueño no tiene que hacer
 * nada. Pasada la ventana, la promesa dejó de cumplirse y seguir haciéndola es peor que no decir
 * nada, porque es lo que hace que nadie apriete el botón que arregla el problema.
 */
const SWEEP_GRACE_MINUTES = 15;

/**
 * Cuánto le queda a la reserva.
 *
 * El caso vencido no dice "vencida" a secas: entre que vence y que el cron la barre pasan minutos,
 * y en ese rato el equipo **sigue** reservado en la base y en la vidriera. Decir "ya venció" a
 * secas invitaría a intentar venderlo y encontrarse con un rechazo. Se dice lo que está pasando.
 *
 * ── Por qué hay DOS textos de vencida, y por qué esto no es cosmética ────────────────────────
 * Hasta S6 había uno solo —«venció, se libera en unos minutos»— y lo decidía **sólo el reloj**. O
 * sea que lo seguía diciendo a las tres horas, y a los tres días: la misma frase tranquilizadora
 * para "el cron pasa en un rato" y para "el barrido no puede con esta fila y ya la abandonó"
 * (`_lib/reservations/expire-reservations.ts`, `MAX_SWEEP_ATTEMPTS`). Como
 * `reservations_one_active_per_listing` impide crear otra reserva sobre la misma unidad, el equipo
 * queda trabado, invendible, y el panel le explica al dueño que espere. Eso no se factura: se
 * cancela.
 *
 * El segundo texto no informa: **manda**. Nombra el botón que está en la misma fila («Liberar
 * equipo», `_ui/cancel-reservation-button.tsx`), que es la única salida que el dueño tiene a mano y
 * que además es reversible. Esta función no puede saber si el barrido está trabado —no lee
 * `sweep_attempts`, y hacerlo costaría una columna más en la lista de stock para un texto—, pero no
 * hace falta: pasado el tiempo en que el cron debió haberla barrido, apretar el botón es la
 * respuesta correcta en los dos escenarios. Si el barrido estaba por llegar, cancelar a mano deja
 * la unidad en el mismo lugar donde la iba a dejar él.
 *
 * La resta se hace acá y no con `reservationMsRemaining()` del dominio por una razón chica y
 * concreta: esa función pide una `Reservation` **entera**, y la lista de stock sólo lee cuatro
 * columnas (`_lib/reservations/queries.ts`). Fabricar una reserva de mentira con un `as` para
 * mostrar un texto sería mentirle al tipo; la resta es la misma cuenta y no miente.
 */
export function reservationCountdown(expiresAt: Date, now: Date): string {
  const remaining = expiresAt.getTime() - now.getTime();

  if (remaining >= MS_PER_MINUTE) {
    return `quedan ${durationLabel(Math.floor(remaining / MS_PER_MINUTE))}`;
  }
  if (remaining > 0) return 'queda menos de 1 min';

  const overdue = Math.floor(-remaining / MS_PER_MINUTE);
  if (overdue < SWEEP_GRACE_MINUTES) return 'venció, se libera solo en unos minutos';
  return `venció hace ${durationLabel(overdue)} y sigue trabado — usá "Liberar equipo"`;
}

/** Los dos extremos, para el texto de ayuda del formulario. */
export const RESERVATION_RANGE_LABEL = `${durationLabel(RESERVATION_MIN_MINUTES)} a ${durationLabel(RESERVATION_MAX_MINUTES)}`;
