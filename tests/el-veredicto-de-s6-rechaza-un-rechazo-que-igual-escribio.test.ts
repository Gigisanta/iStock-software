/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  La polaridad negativa de la medición de S6. Owner: `qa-agent`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `e2e/_lib/s6-measure.ts` decide si el ciclo reserva → vidriera → cron está bien. Ese veredicto
 * es el que `scripts/accept-s6.sh` (V8) termina leyendo, y **un veredicto que nunca se vio decir
 * que no, no prueba nada** (`CLAUDE.md` §0: el test va primero, y un test que nunca falló no
 * prueba nada).
 *
 * El problema es que la falla que V8 vino a atrapar —`transitionUnit` evaluando con
 * `activeReservation: null` hardcodeado— sólo se puede ver en rojo desde el browser **rompiendo a
 * propósito el código bajo test**, que es exactamente lo que `qa-agent` no hace (`CLAUDE.md` §4).
 * Así que la polaridad negativa se ejercita donde sí se puede: alimentando la función con la
 * medición del bug y viendo que el veredicto sale no vacío. Lo que el browser no puede demostrar,
 * lo demuestra el dato.
 *
 * Este archivo vive en `tests/` y no en `e2e/` porque no necesita browser: corre en 3 ms con
 * `vitest`, o sea que entra en `pnpm test` y no en `pnpm e2e`. La regla que audita cruza dos
 * columnas (el panel que rechaza y la vidriera que revalida), así que es de acá.
 */

import { describe, expect, it } from 'vitest';
import {
  BADGE_DISPONIBLE,
  BADGE_RESERVADO,
  publishProblems,
  publishVerdict,
  reservationCycleMedidoLine,
  reservationCycleProblems,
  sweepProblems,
  type PublishWhileReservedAttempt,
  type ReservationCycleMeasurement,
} from '../e2e/_lib/s6-measure';

/** El ciclo tal como tiene que salir: es la línea base contra la que se rompe cada campo. */
const CICLO_SANO: ReservationCycleMeasurement = {
  listingId: '11111111-2222-3333-4444-555555555555',
  statusAfterReserve: 'reserved',
  storefrontSaidBefore: BADGE_DISPONIBLE,
  storefrontSays: BADGE_RESERVADO,
  statusAfterSweep: 'available',
  storefrontSaysAfterSweep: BADGE_DISPONIBLE,
  publish: {
    httpStatus: 200,
    alert: 'La reserva todavía no venció.',
    listingStatusAfter: 'reserved',
    reservationStatusAfter: 'active',
  },
};

describe('el veredicto del ciclo de la reserva', () => {
  it('no reporta ningún problema cuando el ciclo entero salió como tiene que salir', () => {
    expect(reservationCycleProblems(CICLO_SANO)).toEqual([]);
  });

  it('marca el equipo que quedó publicado como disponible con la seña ya puesta', () => {
    const problemas = reservationCycleProblems({
      ...CICLO_SANO,
      storefrontSays: BADGE_DISPONIBLE,
    });
    expect(problemas.join(' ')).toContain('dos personas al local');
  });

  it('marca la ficha que nunca estuvo cacheada, porque ahí el Reservado no prueba la purga', () => {
    // Si la vidriera nunca dijo "Disponible", leer "Reservado" después mide el render y no la
    // invalidación. Sin esta regla, la medición pasaría con `invalidateStorefrontUnit()` borrado.
    const problemas = reservationCycleProblems({
      ...CICLO_SANO,
      storefrontSaidBefore: BADGE_RESERVADO,
    });
    expect(problemas.join(' ')).toContain('la invalidación por unidad corrió');
  });

  it('marca la reserva vencida que el cron no llegó a devolverle a la vidriera', () => {
    const problemas = reservationCycleProblems({
      ...CICLO_SANO,
      statusAfterSweep: 'reserved',
      storefrontSaysAfterSweep: BADGE_RESERVADO,
    });
    expect(problemas).toHaveLength(2);
    expect(problemas.join(' ')).toContain('stock que se pierde');
    expect(problemas.join(' ')).toContain('le sigue mintiendo al visitante');
  });
});

describe('el intento de publicar con la reserva viva', () => {
  const rechazoLimpio: PublishWhileReservedAttempt = CICLO_SANO.publish;

  it('aprueba únicamente el rechazo que además no dejó nada escrito', () => {
    expect(publishProblems(rechazoLimpio)).toEqual([]);
  });

  it('rechaza el intento que el panel aceptó, que es el bug que el quinto campo vino a atrapar', () => {
    const problemas = publishProblems({
      ...rechazoLimpio,
      alert: null,
      listingStatusAfter: 'available',
      reservationStatusAfter: 'active',
    });
    expect(problemas.join(' ')).toContain('activeReservation: null');
  });

  it('rechaza el rechazo que igual republicó el equipo, porque eso no es un rechazo', () => {
    // Las dos mitades del bug original eran separables: devolver error en pantalla y haber escrito
    // igual es el caso peor, porque se lee como si el sistema hubiera defendido.
    const problemas = publishProblems({ ...rechazoLimpio, listingStatusAfter: 'available' });
    expect(problemas.join(' ')).toContain('deja basura escrita');
  });

  it('rechaza el rechazo que se llevó puesta la reserva del cliente que había señado', () => {
    const problemas = publishProblems({ ...rechazoLimpio, reservationStatusAfter: null });
    expect(problemas.join(' ')).toContain('se llevó puesta la seña');
  });

  it('rechaza el intento del que no se vio ninguna respuesta, porque no se midió nada', () => {
    // Sin prueba de vida, un botón muerto se reportaría como "el sistema rechazó".
    const problemas = publishProblems({ ...rechazoLimpio, httpStatus: null });
    expect(problemas.join(' ')).toContain('el click no llegó al server');
  });
});

describe('la línea MEDIDO del ciclo de la reserva', () => {
  it('lleva los cinco campos que el gate documenta, con el veredicto adentro del quinto', () => {
    const linea = reservationCycleMedidoLine(CICLO_SANO);

    // El formato es un contrato con un parser de `sed`: un espacio de más y V8 deja de leerla.
    expect(linea.startsWith('MEDIDO s6 reserva · ')).toBe(true);
    expect(linea.split(' · ')).toHaveLength(6);
    expect(linea).toContain('estado_tras_reservar=reserved');
    expect(linea).toContain('tras_expirar=available');
    expect(linea).toContain('publicar_estando_reservada=rechazado(');
  });

  it('dice aceptado cuando el panel dejó publicar, y no lo que esperábamos que dijera', () => {
    // Una línea que imprime la expectativa en vez del hecho es peor que no tener línea.
    const verdict = publishVerdict({
      httpStatus: 200,
      alert: null,
      listingStatusAfter: 'available',
      reservationStatusAfter: 'active',
    });
    expect(verdict.startsWith('aceptado(')).toBe(true);
    expect(verdict).toContain('listing=available');
  });
});

describe('la puerta HTTP del barrido de reservas', () => {
  it('no aprueba un barrido que funciona pero contesta también sin secreto', () => {
    const problemas = sweepProblems({
      httpStatus: 200,
      httpStatusSinSecreto: 200,
      scanned: 3,
      expired: 1,
      released: 1,
    });
    expect(problemas.join(' ')).toContain('estaría abierta para cualquiera');
  });

  it('no aprueba un barrido que no venció ni liberó nada teniendo una reserva vencida', () => {
    const problemas = sweepProblems({
      httpStatus: 200,
      httpStatusSinSecreto: 401,
      scanned: 0,
      expired: 0,
      released: 0,
    });
    expect(problemas.join(' ')).toContain('no la tocó');
  });

  it('aprueba el barrido autenticado que encontró y liberó la reserva vencida', () => {
    expect(
      sweepProblems({
        httpStatus: 200,
        httpStatusSinSecreto: 401,
        scanned: 1,
        expired: 1,
        released: 1,
      }),
    ).toEqual([]);
  });
});
