import { describe, expect, it, vi } from 'vitest';
import {
  RESERVATION_DEFAULT_MINUTES,
  RESERVATION_MAX_MINUTES,
  RESERVATION_MIN_MINUTES,
} from '@istock/domain';

/**
 * `presentation.ts` importa `MAX_SWEEP_ATTEMPTS` del módulo del cron —el tope tiene que ser UNO, no
 * dos que se desincronizan— y ese módulo es `server-only`, que en vitest tira al importarse. Se
 * neutraliza el marcador, no el tope: `MAX_SWEEP_ATTEMPTS` abajo es el valor real del cron, y si
 * mañana cambia, estos tests cambian con él.
 */
vi.mock('server-only', () => ({}));

const { MAX_SWEEP_ATTEMPTS } = await import('./expire-reservations');
const {
  RESERVATION_DEFAULT_OPTION,
  RESERVATION_MINUTE_OPTIONS,
  durationLabel,
  reservationCountdown,
} = await import('./presentation');

/**
 * Los presets del `<select>` son una lista escrita a mano, y por eso se testean contra el dominio:
 * el día que el rango cambie, esto tiene que ponerse rojo. Un `<option value="30">` que el server
 * rechaza es peor que no ofrecer la opción — el dueño aprieta y le rebota, sin entender por qué.
 */

const NOW = new Date('2026-08-28T14:00:00.000Z');

/**
 * Una fila sana: el barrido nunca falló sobre ella. Es el caso normal y el que deja hablar al reloj.
 * `sweepAttempts` se pasa explícito en cada llamada a propósito — no hay default que se pueda
 * olvidar, y esa es la mitad del arreglo de T24.
 */
const sana = (minutes: number) => ({
  expiresAt: new Date(NOW.getTime() + minutes * 60_000),
  sweepAttempts: 0,
});

/** La misma fila, pero abandonada por el barrido: pasó el techo y no vuelve a entrar al lote. */
const enCuarentena = (minutes: number) => ({
  expiresAt: new Date(NOW.getTime() + minutes * 60_000),
  sweepAttempts: MAX_SWEEP_ATTEMPTS,
});

const CUARENTENA = 'venció y el equipo no se va a liberar solo — usá "Liberar equipo"';

describe('los presets caen dentro del rango del dominio', () => {
  it('ninguno se sale de [min, max]', () => {
    for (const option of RESERVATION_MINUTE_OPTIONS) {
      expect(option).toBeGreaterThanOrEqual(RESERVATION_MIN_MINUTES);
      expect(option).toBeLessThanOrEqual(RESERVATION_MAX_MINUTES);
      expect(Number.isInteger(option)).toBe(true);
    }
  });

  it('el default del dominio es uno de los presets, o viene preseleccionado algo que no está', () => {
    expect(RESERVATION_DEFAULT_OPTION).toBe(RESERVATION_DEFAULT_MINUTES);
    expect(RESERVATION_MINUTE_OPTIONS).toContain(RESERVATION_DEFAULT_MINUTES);
  });

  it('los dos extremos se pueden elegir: son el mínimo y el máximo que existen', () => {
    expect(RESERVATION_MINUTE_OPTIONS).toContain(RESERVATION_MIN_MINUTES);
    expect(RESERVATION_MINUTE_OPTIONS).toContain(RESERVATION_MAX_MINUTES);
  });
});

describe('durationLabel', () => {
  it('menos de una hora va en minutos', () => {
    expect(durationLabel(30)).toBe('30 min');
    expect(durationLabel(45)).toBe('45 min');
  });

  it('la hora exacta no dice "1 h 0 min"', () => {
    expect(durationLabel(60)).toBe('1 h');
    expect(durationLabel(120)).toBe('2 h');
  });

  it('el resto se muestra', () => {
    expect(durationLabel(90)).toBe('1 h 30 min');
  });
});

describe('reservationCountdown', () => {
  it('cuenta lo que falta', () => {
    expect(reservationCountdown(sana(45), NOW)).toBe('quedan 45 min');
    expect(reservationCountdown(sana(90), NOW)).toBe('quedan 1 h 30 min');
  });

  it('el último minuto no dice "quedan 0 min"', () => {
    expect(reservationCountdown({ expiresAt: new Date(NOW.getTime() + 30_000), sweepAttempts: 0 }, NOW)).toBe(
      'queda menos de 1 min',
    );
  });

  it('recién vencida no dice "vencida": dice que el cron la va a barrer, que es la verdad', () => {
    expect(reservationCountdown(sana(-5), NOW)).toBe('venció, se libera solo en unos minutos');
    // El borde es cerrado del lado del vencimiento, igual que en el dominio.
    expect(reservationCountdown(sana(0), NOW)).toBe('venció, se libera solo en unos minutos');
  });

  /**
   * El reloj como **fallback**. Con el contador en 0 no hay información —una caída del cron deja
   * `sweep_attempts` en 0 porque el barrido ni corrió—, y ahí el tiempo vencido es la mejor señal
   * que hay: pasada la ventana el texto deja de prometer y manda al botón. Se equivoca por exceso
   * (pide trabajo manual que quizá no hacía falta) y ese error es inocuo: soltar a mano una unidad
   * que igual se iba a soltar la deja igual de disponible.
   */
  it('pasada la ventana del cron deja de prometer y manda al botón', () => {
    expect(reservationCountdown(sana(-20), NOW)).toBe(
      'venció hace 20 min y sigue trabado — usá "Liberar equipo"',
    );
    expect(reservationCountdown(sana(-90), NOW)).toBe(
      'venció hace 1 h 30 min y sigue trabado — usá "Liberar equipo"',
    );
  });

  it('el cambio de texto del reloj es una sola vez, en el minuto 15', () => {
    // 14 min: el cron tuvo dos oportunidades y le queda una. Todavía se le pide que espere.
    expect(reservationCountdown(sana(-14), NOW)).toBe('venció, se libera solo en unos minutos');
    expect(reservationCountdown(sana(-15), NOW)).toContain('Liberar equipo');
  });
});

/**
 * La mitad cara del módulo (T24). Con el reloj solo, «trabado» era una conjetura; con
 * `sweep_attempts` es un hecho: el barrido tiene el techo en el `where`, así que una fila que lo
 * pasó **no la toma nunca más** y esa unidad no se libera sola jamás.
 *
 * Los dos errores del reloj no eran simétricos, y por eso el contador va primero: el caro es una
 * fila en cuarentena **dentro** de la ventana de gracia, donde el reloj decía «se libera solo en
 * unos minutos» — falso para siempre, y justo el texto que evita que el dueño haga lo único que
 * arregla el problema. Como `reservations_one_active_per_listing` impide crear otra reserva sobre
 * la misma unidad, eso es un equipo invendible con un cartel que le pide al dueño que espere.
 */
describe('reservationCountdown · el contador manda sobre el reloj', () => {
  it('en cuarentena y recién vencida NO promete que se libera sola: es el caso que T24 vino a matar', () => {
    // 1 minuto vencida: el reloj, solo, diría "se libera solo en unos minutos" y sería mentira para
    // siempre.
    expect(reservationCountdown(enCuarentena(-1), NOW)).toBe(CUARENTENA);
    expect(reservationCountdown(enCuarentena(0), NOW)).toBe(CUARENTENA);
  });

  it('el texto dice que NO se va a liberar sola, no que "sigue trabada": son cosas distintas para el que lee', () => {
    const texto = reservationCountdown(enCuarentena(-200), NOW);
    expect(texto).toBe(CUARENTENA);
    expect(texto).toContain('no se va a liberar solo');
    expect(texto).not.toContain('sigue trabado');
    // Nombra el botón que está en la misma fila: es la única salida y es reversible.
    expect(texto).toContain('Liberar equipo');
  });

  it('el texto de cuarentena no depende del reloj: es el mismo al minuto y a las tres horas', () => {
    expect(reservationCountdown(enCuarentena(-1), NOW)).toBe(
      reservationCountdown(enCuarentena(-180), NOW),
    );
  });

  /** Polaridad. Una fila sana vencida hace poco NO puede llevarse el texto de cuarentena. */
  it('una fila sana vencida hace poco NO dice el texto de cuarentena', () => {
    expect(reservationCountdown(sana(-1), NOW)).not.toBe(CUARENTENA);
    expect(reservationCountdown(sana(-5), NOW)).toBe('venció, se libera solo en unos minutos');
    // Ni siquiera pasada la ventana: ahí manda al botón, pero sin afirmar que no se libera sola.
    expect(reservationCountdown(sana(-200), NOW)).not.toBe(CUARENTENA);
  });

  /**
   * El borde. Un intento menos que el techo todavía puede entrar al lote, así que el barrido
   * **puede** liberarla y decir lo contrario sería empujar al dueño a trabajo manual innecesario.
   */
  it('un intento por debajo del techo todavía es del reloj', () => {
    const casiEnCuarentena = {
      expiresAt: new Date(NOW.getTime() - 60_000),
      sweepAttempts: MAX_SWEEP_ATTEMPTS - 1,
    };
    expect(reservationCountdown(casiEnCuarentena, NOW)).toBe('venció, se libera solo en unos minutos');
  });

  /** Un contador por encima del techo (un `+1` de más, un operador con la mano pesada) es cuarentena igual. */
  it('por encima del techo también es cuarentena', () => {
    expect(
      reservationCountdown(
        { expiresAt: new Date(NOW.getTime() - 60_000), sweepAttempts: MAX_SWEEP_ATTEMPTS + 3 },
        NOW,
      ),
    ).toBe(CUARENTENA);
  });

  /** Una reserva viva se cuenta hacia adelante aunque el barrido la haya castigado antes. */
  it('el contador no le gana al tiempo que todavía queda', () => {
    expect(reservationCountdown(enCuarentena(45), NOW)).toBe('quedan 45 min');
  });
});
