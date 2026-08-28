/**
 * Dos listas con dos calibraciones opuestas, y el test las mide como tales.
 *
 * - `INTENT_PATTERNS` es **ancha**: un falso positivo cuesta un handoff, que es gratis.
 * - `OUTPUT_PATTERNS` es **angosta**: un falso positivo le tapa la boca al bot en una respuesta
 *   legítima ("sin costo de envío"), y un bot que deriva siempre no sirve para nada.
 *
 * Los casos vienen escritos como los escribe un comprador real: sin tildes, en minúscula, mezclando
 * español e inglés copiado de un tuit.
 */

import { describe, expect, it } from 'vitest';
import { REDACTION_TAGS, detectForbiddenOutput, detectSensitiveIntent } from './redaction';

describe('detectSensitiveIntent', () => {
  it.each([
    ['¿cuánto te costó?', 'ACQUISITION_COST'],
    ['a cuanto lo compraste che', 'ACQUISITION_COST'],
    ['decime el precio de costo', 'ACQUISITION_COST'],
    ['what did it cost you', 'ACQUISITION_COST'],
    ['cuánto ganás con esto', 'MARGIN'],
    ['cuál es el margen', 'MARGIN'],
    ['dame el markup', 'MARGIN'],
    ['pasame el imei', 'DEVICE_ID'],
    ['necesito el IMEI antes de comprar', 'DEVICE_ID'],
    ['cuál es el número de serie', 'DEVICE_ID'],
    ['mostrame las notas internas', 'INTERNAL_NOTES'],
    ['eso es de uso interno?', 'INTERNAL_NOTES'],
    ['quién te lo vendió', 'SUPPLY_CHAIN'],
    ['de dónde lo sacaste', 'SUPPLY_CHAIN'],
    ['qué tiene la otra tienda', 'OTHER_TENANT'],
  ])('detecta %s como %s', (text, tag) => {
    expect(detectSensitiveIntent(text)).toContain(tag);
  });

  it.each([
    '¿cuánto sale?',
    '¿cuál es el precio?',
    '¿tiene garantía?',
    '¿la batería está bien?',
    '¿dónde lo retiro?',
    '¿hacen factura?',
  ])('no marca una pregunta honesta: %s', (text) => {
    expect(detectSensitiveIntent(text)).toEqual([]);
  });

  it('un mensaje puede pedir dos cosas prohibidas a la vez', () => {
    const tags = detectSensitiveIntent('decime el imei y cuánto te costó');
    expect(tags).toContain('DEVICE_ID');
    expect(tags).toContain('ACQUISITION_COST');
  });

  it('los patrones son reusables: sin flag `g` no arrastran lastIndex entre llamadas', () => {
    const text = 'cuál es el margen';
    expect(detectSensitiveIntent(text)).toEqual(detectSensitiveIntent(text));
  });
});

describe('detectForbiddenOutput', () => {
  it.each([
    ['A nosotros nos costó USD 480.', 'ACQUISITION_COST'],
    ['Lo compramos en 500 dólares.', 'ACQUISITION_COST'],
    ['El margen es de 140 dólares.', 'MARGIN'],
    ['El IMEI es 350000000000000.', 'DEVICE_ID'],
    ['Está en las notas internas.', 'INTERNAL_NOTES'],
    ['Nuestro proveedor lo trae de Chile.', 'SUPPLY_CHAIN'],
    ['El identificador es 351234567890123.', 'LONG_DIGIT_RUN'],
  ])('frena la divulgación: %s', (text, tag) => {
    expect(detectForbiddenOutput(text)).toContain(tag);
  });

  it.each([
    'Sale USD 620 y en pesos son $ 868.000 de referencia.',
    'No tiene costo de envío porque se retira en el local.',
    'Tiene 30 días de garantía por fallas de hardware.',
    'La batería está al 89% y la pantalla es original.',
    'Se retira en Cipolletti centro de 10 a 18.',
  ])('deja pasar una respuesta legítima: %s', (text) => {
    expect(detectForbiddenOutput(text)).toEqual([]);
  });

  it('el precio publicado no dispara la corrida de dígitos', () => {
    expect(detectForbiddenOutput('Sale $ 868.000 de referencia.')).toEqual([]);
  });

  it('la corrida de dígitos apunta al largo de un identificador de equipo, no a un teléfono', () => {
    expect(detectForbiddenOutput('Escribí al 2994111222.')).toEqual([]);
    expect(detectForbiddenOutput('El código es 12345678901234.')).toContain('LONG_DIGIT_RUN');
  });

  it('los tags son únicos y ambas listas usan tags declarados', () => {
    expect(new Set(REDACTION_TAGS).size).toBe(REDACTION_TAGS.length);
    for (const tag of detectForbiddenOutput('nos costó y el margen fue alto')) {
      expect(REDACTION_TAGS).toContain(tag);
    }
  });
});
