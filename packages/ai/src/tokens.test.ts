/**
 * El contador es un **techo**, y lo único que se le exige es que nunca subestime.
 *
 * El test central no es "cuenta 12 tokens para este string": eso fijaría la implementación y se
 * rompería con cualquier ajuste. Lo que se fija es la **dirección del error** contra la cota más
 * generosa que se le concede a un BPE real (4 caracteres por token para español acentuado). Si
 * alguien afloja `CHARS_PER_TOKEN` a 5 buscando meter más contexto, esta invariante se cae.
 */

import { describe, expect, it } from 'vitest';
import { MESSAGE_OVERHEAD_TOKENS, countMessageTokens, countTokens, normalizeForCount, truncateToTokens } from './tokens';

/** Cota superior optimista de un BPE real. Si nuestro contador baja de acá, subestima. */
const BEST_CASE_CHARS_PER_TOKEN = 4;

const SAMPLES = [
  'Hola, ¿el iPhone 14 Pro de 256 GB todavía está disponible?',
  'Batería 89%, pantalla original, garantía de 30 días por fallas de hardware.',
  'Sí. Está en USD 620 y se retira en Cipolletti centro de lunes a viernes de 10 a 18.',
  '¿Aceptan canje? Tengo un 12 Pro Max de 128 en buen estado y quiero pasarme.',
  'a',
  '¿?',
  'ñandú ñandú ñandú ñandú',
  'https://ejemplo.example/una/url/larguisima?con=query&y=todo',
  '1234567890123456',
];

describe('normalizeForCount', () => {
  it('colapsa whitespace y recorta, que es como el contador ve el texto', () => {
    expect(normalizeForCount('  hola\n\n   mundo \t ')).toBe('hola mundo');
  });

  it('deja el vacío en vacío', () => {
    expect(normalizeForCount('   \n\t  ')).toBe('');
  });
});

describe('countTokens', () => {
  it('el texto vacío no cuesta nada', () => {
    expect(countTokens('')).toBe(0);
    expect(countTokens('   \n ')).toBe(0);
  });

  it.each(SAMPLES)('nunca subestima frente al mejor caso de un BPE real: %s', (sample) => {
    const floor = Math.ceil(normalizeForCount(sample).length / BEST_CASE_CHARS_PER_TOKEN);
    expect(countTokens(sample)).toBeGreaterThanOrEqual(floor);
  });

  it('es monótono en el prefijo, que es de lo que depende la búsqueda binaria de truncateToTokens', () => {
    const text = SAMPLES.join(' ');
    let previous = 0;
    for (let cut = 0; cut <= text.length; cut += 7) {
      const current = countTokens(text.slice(0, cut));
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  it('el whitespace repetido no se paga', () => {
    expect(countTokens('hola     mundo')).toBe(countTokens('hola mundo'));
  });

  /**
   * Una corrida de símbolos cuesta más por carácter que el texto (2 vs 3 caracteres por token),
   * pero **no** un token por símbolo. Cobrar cada símbolo suelto —que es lo que decía este test
   * antes— hacía que el schema de las tres tools, que es casi todo puntuación JSON, midiera 446
   * tokens contra los ~120 reales: 27% de la dieta gastada en tokens que no existen, y el que lo
   * pagaba era el comprador, en chunks y en historial recortados para que "entre".
   */
  it('una corrida de símbolos cuesta más por carácter que el texto, pero no un token por símbolo', () => {
    expect(countTokens('!!!!!')).toBe(3);
    expect(countTokens('!!!!!')).toBeLessThan(5);
    expect(countTokens('{"a":1}')).toBeGreaterThan(0);
  });

  it('ningún átomo sale gratis: un símbolo solo cuesta un token', () => {
    expect(countTokens('!')).toBe(1);
    expect(countTokens('{')).toBe(1);
  });
});

describe('countMessageTokens', () => {
  it('cobra el andamiaje de rol de cada mensaje', () => {
    const messages = [{ role: 'user', content: 'hola' }];
    expect(countMessageTokens(messages)).toBe(MESSAGE_OVERHEAD_TOKENS + countTokens('user') + countTokens('hola'));
  });

  it('un mensaje vacío igual cuesta: el rol viaja aunque el contenido no', () => {
    expect(countMessageTokens([{ role: 'assistant', content: '' }])).toBeGreaterThan(0);
  });

  it('suma sobre la conversación', () => {
    const one = countMessageTokens([{ role: 'user', content: 'hola' }]);
    const two = countMessageTokens([
      { role: 'user', content: 'hola' },
      { role: 'user', content: 'hola' },
    ]);
    expect(two).toBe(one * 2);
  });
});

describe('truncateToTokens', () => {
  it('devuelve el texto tal cual si ya entra', () => {
    expect(truncateToTokens('hola mundo', 100)).toBe('hola mundo');
  });

  it('un presupuesto de cero deja el texto en nada', () => {
    expect(truncateToTokens('hola mundo', 0)).toBe('');
    expect(truncateToTokens('hola mundo', -5)).toBe('');
  });

  it('el resultado siempre entra en el presupuesto pedido', () => {
    const long = 'Descripción larga del equipo escrita por el dueño. '.repeat(50);
    for (const budget of [1, 5, 20, 60, 140]) {
      expect(countTokens(truncateToTokens(long, budget))).toBeLessThanOrEqual(budget);
    }
  });

  it('corta en un espacio y no en la mitad de una palabra', () => {
    const cut = truncateToTokens('anticonstitucionalmente estrafalario paralelepípedo trigonometría', 6);
    expect(cut.length).toBeGreaterThan(0);
    expect(cut.endsWith(' ')).toBe(false);
  });
});
