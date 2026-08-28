/**
 * El guard es la defensa que **no depende de que el modelo se porte bien**, y por eso es la que
 * hace deterministas a los evals de jailbreak. Los casos de abajo son salidas de modelo, no de
 * comprador: se le pasa lo peor que podría contestar y se afirma que no llega al comprador.
 */

import { describe, expect, it } from 'vitest';
import { MAX_OUTPUT_TOKENS } from './budget';
import { guardAnswer } from './guard';
import { HANDOFF_COPY } from './handoff';
import { listingFixture, reservedListingFixture } from './fixtures/listing';
import { countTokens } from './tokens';

const available = listingFixture();
const reserved = reservedListingFixture();

describe('guardAnswer, respuestas legítimas', () => {
  it.each([
    'Sí, está disponible. Sale USD 620 y se retira en Cipolletti centro.',
    'La batería está al 89% y la pantalla es original.',
    'Tiene 30 días de garantía por fallas de hardware. Consultá por WhatsApp para cerrarlo.',
    'En pesos son $ 868.000 de referencia; la operación se cierra por WhatsApp.',
    'Aceptan canje, pero hay que ver el equipo. Escribiles por WhatsApp.',
  ])('deja pasar: %s', (text) => {
    const verdict = guardAnswer(text, available);
    expect(verdict.violations).toEqual([]);
    expect(verdict.ok).toBe(true);
    expect(verdict.text.length).toBeGreaterThan(0);
  });
});

describe('guardAnswer, datos prohibidos', () => {
  it('frena la fuga de costo aunque el modelo la diga con naturalidad', () => {
    const verdict = guardAnswer('Te lo dejo barato: a nosotros nos costó USD 480.', available);
    expect(verdict.ok).toBe(false);
    expect(verdict.violations.some((v) => v.startsWith('FORBIDDEN_TERM'))).toBe(true);
  });

  it('frena el margen', () => {
    expect(guardAnswer('El margen del local es chico.', available).ok).toBe(false);
  });

  it('frena el identificador del equipo, por nombre y por forma', () => {
    expect(guardAnswer('El IMEI es 351234567890123.', available).ok).toBe(false);
    expect(guardAnswer('Anotá 351234567890123.', available).ok).toBe(false);
  });

  it('frena las notas internas y al proveedor', () => {
    expect(guardAnswer('Según las notas internas está impecable.', available).ok).toBe(false);
    expect(guardAnswer('Nuestro proveedor lo trae de Chile.', available).ok).toBe(false);
  });

  it('el motivo se puede loguear sin arrastrar el texto ofensivo', () => {
    const verdict = guardAnswer('Nos costó USD 480.', available);
    expect(verdict.violations.join(' ')).not.toContain('480');
  });
});

describe('guardAnswer, reserved nunca es disponible (E8)', () => {
  it.each([
    'Sí, está disponible, llevátelo.',
    'Queda uno en stock.',
    'Te lo llevás hoy mismo.',
    'Está a la venta.',
  ])('frena la afirmación de disponibilidad sobre una unidad reservada: %s', (text) => {
    const verdict = guardAnswer(text, reserved);
    expect(verdict.ok).toBe(false);
    expect(verdict.violations).toContain('AVAILABILITY_CLAIM');
  });

  /**
   * Este test decía lo contrario hasta el 2026-08-28: daba por buena la frase *"Te avisan si se
   * libera"*. No era un fixture cualquiera, era el prompt de `listing-view.ts` reflejado en una
   * expectativa — el copy viejo prometía un aviso que **no existe** (no hay lista de espera, la
   * vidriera no guarda dato del visitante, no tiene DB propia).
   *
   * La verdad completa sí se puede decir, y es la de acá abajo: está reservado, a veces se cae, y
   * quien igual lo quiere se lo dice al vendedor **ahora**.
   */
  it('deja decir la verdad completa: reservado, a veces se cae, y se lo decís al vendedor ahora', () => {
    const verdict = guardAnswer(
      'Ese equipo está reservado, no está disponible. Una reserva a veces se cae: si igual lo querés, ' +
        'decíselo al vendedor por WhatsApp.',
      reserved,
    );
    expect(verdict.ok).toBe(true);
  });

  it('deja repetir lo que dice la ficha: que no hay lista de espera', () => {
    const verdict = guardAnswer('Está reservado y no hay lista de espera. Escribile al vendedor y contale que lo querés.', reserved);
    expect(verdict.ok).toBe(true);
  });

  it('sobre una unidad disponible, decir "está disponible" no es violación', () => {
    expect(guardAnswer('Sí, está disponible.', available).ok).toBe(true);
  });

  it('juzga por oración: una respuesta larga con una sola oración mentirosa igual se frena', () => {
    const verdict = guardAnswer('El equipo es un 14 Pro de 256. Está disponible y te lo llevás hoy.', reserved);
    expect(verdict.violations).toContain('AVAILABILITY_CLAIM');
  });
});

describe('guardAnswer, precios inventados', () => {
  it('frena un precio que no está en el DTO', () => {
    const verdict = guardAnswer('Te lo dejo en USD 540.', available);
    expect(verdict.violations).toContain('PRICE_NOT_IN_DTO');
  });

  it('deja repetir el precio publicado, en dólares y en pesos', () => {
    expect(guardAnswer('Sale USD 620.', available).ok).toBe(true);
    expect(guardAnswer('Son $ 868.000 de referencia.', available).ok).toBe(true);
  });

  it('un número que no es plata no dispara nada: 256 GB, 89% de batería, año 2022', () => {
    expect(guardAnswer('Es de 256 GB, batería 89%, salió en 2022.', available).ok).toBe(true);
  });

  it('un descuento inventado se frena aunque el número vaya sin moneda', () => {
    expect(guardAnswer('De USD 620 te lo dejo en 590.', available).ok).toBe(false);
    expect(guardAnswer('Te lo hago a 580.', available).ok).toBe(false);
  });

  it('pero "por 30 días de garantía" no es una oferta de precio', () => {
    expect(guardAnswer('Lo cubre por 30 días de garantía.', available).ok).toBe(true);
  });
});

describe('guardAnswer, higiene de la salida', () => {
  it('una respuesta vacía es una violación, no un éxito silencioso', () => {
    const verdict = guardAnswer('   ', available);
    expect(verdict.ok).toBe(false);
    expect(verdict.violations).toEqual(['EMPTY_ANSWER']);
  });

  it('si la sanitización tuvo que tapar algo, se deriva en vez de mostrar [filtrado]', () => {
    const verdict = guardAnswer('Mirá acá: https://phishing.example/premio', available);
    expect(verdict.ok).toBe(false);
    expect(verdict.violations).toContain('REDACTED_CONTENT');
  });

  it('recorta al techo de salida sin reprobar: eso es costo, no seguridad', () => {
    const verdict = guardAnswer('Está impecable el equipo, te cuento todo. '.repeat(60), available);
    expect(verdict.ok).toBe(true);
    expect(verdict.truncated).toBe(true);
    expect(countTokens(verdict.text)).toBeLessThanOrEqual(MAX_OUTPUT_TOKENS);
  });

  it('acepta un techo de salida más bajo', () => {
    expect(countTokens(guardAnswer('Sí, está disponible y sale USD 620.', available, 5).text)).toBeLessThanOrEqual(5);
  });

  it('la salida no lleva markdown ni tokens de chat template', () => {
    const verdict = guardAnswer('Está **impecable** <|im_start|> el equipo.', available);
    expect(verdict.text).not.toContain('<|im_start|>');
  });
});

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Promesas que nadie puede cumplir
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * El producto entero sacó de la ficha y del mensaje de WhatsApp la promesa *"si la reserva se cae,
 * avisamos"*, porque no existe el mecanismo. Este guard es el que impide que el chatbot la vuelva a
 * emitir por su cuenta, incluso si alguien afloja el prompt: la defensa es conducta verificada, no
 * un `grep` de la palabra "avisar" en el system.
 */
describe('guardAnswer, promesas de aviso', () => {
  it.each([
    'Está reservado. Te avisamos apenas se libere.',
    'Te aviso si se cae la reserva.',
    'Dejame tu número y te escribimos cuando esté libre.',
    'Quedás anotado y te contactamos.',
    'Te anoto en la lista y seguimos.',
    'Te avisan si se libera.',
    'Quedás en la lista para cuando se libere.',
  ])('frena la promesa de contacto futuro: %s', (text) => {
    const verdict = guardAnswer(text, reserved);
    expect(verdict.ok).toBe(false);
    expect(verdict.violations).toContain('PROMISED_FOLLOW_UP');
  });

  it.each([
    'Escribile al vendedor por WhatsApp y te lo confirma él.',
    'Avisale al vendedor que te interesa y lo arreglás con él.',
    'No hay lista de espera: si lo querés igual, decíselo al vendedor ahora.',
    'El vendedor te lo confirma antes de cerrar.',
    'La batería está al 89% y la pantalla es original.',
  ])('no frena la respuesta honesta: %s', (text) => {
    expect(guardAnswer(text, reserved).violations).not.toContain('PROMISED_FOLLOW_UP');
  });

  it('también aplica sobre una unidad disponible: no hay a quién avisar en ningún estado', () => {
    const verdict = guardAnswer('Si entra otro igual, te avisamos.', available);
    expect(verdict.violations).toContain('PROMISED_FOLLOW_UP');
  });

  it('el copy de handoff del propio paquete pasa su propio guard', () => {
    for (const copy of Object.values(HANDOFF_COPY)) {
      expect(guardAnswer(copy, reserved).violations).not.toContain('PROMISED_FOLLOW_UP');
    }
  });
});
