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

  it('vencida no dice "vencida": dice lo que está pasando, que es que todavía no se liberó', () => {
    expect(reservationCountdown(inMinutes(-5), NOW)).toBe('venció, se libera en unos minutos');
    // El borde es cerrado del lado del vencimiento, igual que en el dominio.
    expect(reservationCountdown(NOW, NOW)).toBe('venció, se libera en unos minutos');
  });
});
