import {
  RESERVATION_DEFAULT_MINUTES,
  RESERVATION_MAX_MINUTES,
  RESERVATION_MIN_MINUTES,
} from '@istock/domain';
import { MAX_SWEEP_ATTEMPTS } from './expire-reservations';

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
 *
 * Esto es el **fallback**, no el criterio principal: quien decide primero es `sweep_attempts` (ver
 * abajo). El reloj sólo habla cuando el contador no tiene nada que decir.
 */
const SWEEP_GRACE_MINUTES = 15;

/**
 * Lo que hace falta saber de una reserva para contarla. Es un subconjunto estructural de
 * `ActiveReservationRow` (`_lib/reservations/queries.ts`), a propósito: el call site le pasa la fila
 * entera y **no puede olvidarse el contador**, porque sin él no compila.
 *
 * Es también la razón por la que no es un tercer parámetro opcional con default `0`: ese olvido
 * sería silencioso y dejaría al texto decidiendo por el reloj sin que nadie se entere, que es
 * exactamente el defecto que este módulo acaba de dejar atrás.
 */
export interface ReservationCountdownInput {
  readonly expiresAt: Date;
  /** Cuántas veces seguidas falló el barrido sobre esta fila. Lo escribe el cron. */
  readonly sweepAttempts: number;
}

/**
 * Lo que se le dice al dueño de una unidad cuya reserva ya no se va a liberar sola.
 *
 * No dice "sigue trabado" —eso describe el presente y se lee como transitorio—: dice que **no va a
 * pasar**, que es lo único que mueve a alguien a apretar un botón. Y nombra el botón, que está en
 * la misma fila (`_ui/cancel-reservation-button.tsx`).
 */
const QUARANTINE_TEXT = 'venció y el equipo no se va a liberar solo — usá "Liberar equipo"';

/**
 * Cuánto le queda a la reserva.
 *
 * El caso vencido no dice "vencida" a secas: entre que vence y que el cron la barre pasan minutos,
 * y en ese rato el equipo **sigue** reservado en la base y en la vidriera. Decir "ya venció" a
 * secas invitaría a intentar venderlo y encontrarse con un rechazo. Se dice lo que está pasando.
 *
 * ── Por qué hay TRES textos de vencida, y por qué el orden entre ellos importa ────────────────
 * Hasta S6 había uno solo —«venció, se libera en unos minutos»— y lo decidía **sólo el reloj**. O
 * sea que lo seguía diciendo a las tres horas, y a los tres días: la misma frase tranquilizadora
 * para "el cron pasa en un rato" y para "el barrido no puede con esta fila y ya la abandonó"
 * (`_lib/reservations/expire-reservations.ts`, `MAX_SWEEP_ATTEMPTS`). Como
 * `reservations_one_active_per_listing` impide crear otra reserva sobre la misma unidad, el equipo
 * queda trabado, invendible, y el panel le explica al dueño que espere. Eso no se factura: se
 * cancela.
 *
 * La segunda versión partió ese texto en dos por el reloj, y estaba mejor pero seguía conjeturando.
 * **Ahora el que manda es el contador, y el reloj quedó de fallback.** La diferencia se puede
 * nombrar: con el reloj «trabado» es una hipótesis, con `sweep_attempts >= MAX_SWEEP_ATTEMPTS` es un
 * hecho — el barrido ya dejó de tomar la fila, `expire-reservations.ts` lo tiene en el `where`, y
 * esa unidad **no se libera nunca** hasta que una persona la libere.
 *
 * Los dos errores que cometía el reloj solo no eran simétricos, y por eso el contador va primero:
 *
 * - una fila **en cuarentena** dentro de la ventana de gracia decía «se libera solo en unos
 *   minutos». Falso **para siempre**, y justo el texto que evita que el dueño haga lo único que
 *   arregla el problema;
 * - una fila **sana** durante una caída del cron dice «sigue trabado». Molesto e inocuo: soltar a
 *   mano una unidad que igual se iba a soltar la deja igual de disponible.
 *
 * Por eso el reloj **no se sacó**: con el contador por debajo del tope no hay información —una
 * caída del cron deja `sweep_attempts` en 0 porque el barrido ni corrió— y ahí el tiempo vencido
 * sigue siendo la mejor señal que hay.
 *
 * El tope se **importa** de `expire-reservations.ts` y no se repite acá: dos números que se
 * desincronizan hacen que el panel mienta justo en el borde, que es donde importa.
 *
 * La resta se hace acá y no con `reservationMsRemaining()` del dominio por una razón chica y
 * concreta: esa función pide una `Reservation` **entera**, y la lista de stock sólo lee cinco
 * columnas (`_lib/reservations/queries.ts`). Fabricar una reserva de mentira con un `as` para
 * mostrar un texto sería mentirle al tipo; la resta es la misma cuenta y no miente.
 */
export function reservationCountdown(reservation: ReservationCountdownInput, now: Date): string {
  const remaining = reservation.expiresAt.getTime() - now.getTime();

  if (remaining >= MS_PER_MINUTE) {
    return `quedan ${durationLabel(Math.floor(remaining / MS_PER_MINUTE))}`;
  }
  if (remaining > 0) return 'queda menos de 1 min';

  // El contador antes que el reloj: si el barrido ya la abandonó, cuánto hace que venció no cambia
  // nada de lo que el dueño tiene que hacer.
  if (reservation.sweepAttempts >= MAX_SWEEP_ATTEMPTS) return QUARANTINE_TEXT;

  const overdue = Math.floor(-remaining / MS_PER_MINUTE);
  if (overdue < SWEEP_GRACE_MINUTES) return 'venció, se libera solo en unos minutos';
  return `venció hace ${durationLabel(overdue)} y sigue trabado — usá "Liberar equipo"`;
}

/** Los dos extremos, para el texto de ayuda del formulario. */
export const RESERVATION_RANGE_LABEL = `${durationLabel(RESERVATION_MIN_MINUTES)} a ${durationLabel(RESERVATION_MAX_MINUTES)}`;
