import { describe, expect, it } from 'vitest';
import {
  RESERVATION_DEFAULT_MINUTES,
  RESERVATION_MAX_MINUTES,
  RESERVATION_MIN_MINUTES,
} from '@istock/domain';
import {
  RESERVATION_DEFAULT_OPTION,
  RESERVATION_MINUTE_OPTIONS,
  durationLabel,
  reservationCountdown,
} from './presentation';

/**
 * Los presets del `<select>` son una lista escrita a mano, y por eso se testean contra el dominio:
 * el día que el rango cambie, esto tiene que ponerse rojo. Un `<option value="30">` que el server
 * rechaza es peor que no ofrecer la opción — el dueño aprieta y le rebota, sin entender por qué.
 */

const NOW = new Date('2026-08-28T14:00:00.000Z');
const inMinutes = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

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
    expect(reservationCountdown(inMinutes(45), NOW)).toBe('quedan 45 min');
    expect(reservationCountdown(inMinutes(90), NOW)).toBe('quedan 1 h 30 min');
  });

  it('el último minuto no dice "quedan 0 min"', () => {
    expect(reservationCountdown(new Date(NOW.getTime() + 30_000), NOW)).toBe('queda menos de 1 min');
  });

  it('recién vencida no dice "vencida": dice que el cron la va a barrer, que es la verdad', () => {
    expect(reservationCountdown(inMinutes(-5), NOW)).toBe('venció, se libera solo en unos minutos');
    // El borde es cerrado del lado del vencimiento, igual que en el dominio.
    expect(reservationCountdown(NOW, NOW)).toBe('venció, se libera solo en unos minutos');
  });

  /**
   * La mitad cara del módulo. El texto de arriba es una **promesa**: "no hagas nada, se arregla
   * solo". Mientras el cron esté por pasar es verdad; a las tres horas es mentira, y era la misma
   * frase. Con `reservations_one_active_per_listing` impidiendo crear otra reserva sobre la misma
   * unidad, esa mentira es un equipo invendible con un cartel que le pide al dueño que espere.
   *
   * Pasada la ventana el texto deja de informar y manda, nombrando el botón que está en la misma
   * fila. No hace falta saber si el barrido está trabado: apretar "Liberar equipo" es la respuesta
   * correcta en los dos escenarios.
   */
  it('pasada la ventana del cron deja de prometer y manda al botón', () => {
    expect(reservationCountdown(inMinutes(-20), NOW)).toBe(
      'venció hace 20 min y sigue trabado — usá "Liberar equipo"',
    );
    expect(reservationCountdown(inMinutes(-90), NOW)).toBe(
      'venció hace 1 h 30 min y sigue trabado — usá "Liberar equipo"',
    );
  });

  it('el cambio de texto es una sola vez, en el minuto 15', () => {
    // 14 min: el cron tuvo dos oportunidades y le queda una. Todavía se le pide que espere.
    expect(reservationCountdown(inMinutes(-14), NOW)).toBe('venció, se libera solo en unos minutos');
    expect(reservationCountdown(inMinutes(-15), NOW)).toContain('Liberar equipo');
  });
});
