import { describe, expect, it } from 'vitest';

import { DomainError } from './errors';
import {
  SLUG_MAX_LENGTH,
  SLUG_MIN_LENGTH,
  SLUG_PATTERN,
  assertSlug,
  isSlugShaped,
  isUsableSlug,
  normalizeSlug,
  suggestSlug,
} from './slug';

const AT_MIN = 'a'.repeat(SLUG_MIN_LENGTH);
const AT_MAX = 'a'.repeat(SLUG_MAX_LENGTH);

describe('la forma del slug es la del label DNS, no la de un título', () => {
  it('acepta minúsculas, dígitos y guiones interiores', () => {
    for (const value of ['nortecel', 'norte-cel', 'cipo2', '3g-store', 'a1b', AT_MIN, AT_MAX]) {
      expect(isSlugShaped(value), value).toBe(true);
    }
  });

  it('rechaza mayúsculas, espacios, puntos, barras y guión bajo', () => {
    // Cada uno de estos rompe una cara distinta: el punto rompe el wildcard de un nivel, la barra
    // rompe el rewrite `/s/{slug}`, el guión bajo no es un label DNS válido.
    for (const value of ['NorteCel', 'norte cel', 'norte.cel', 'norte/cel', 'norte_cel', 'ñandu',
      'norte%20cel', 'norte:cel']) {
      expect(isSlugShaped(value), value).toBe(false);
    }
  });

  it('rechaza el guión en los bordes, que es donde el label DNS deja de ser válido', () => {
    for (const value of ['-nortecel', 'nortecel-', '-nortecel-']) {
      expect(isSlugShaped(value), value).toBe(false);
    }
  });

  it('los límites de largo del regex y las constantes exportadas dicen lo mismo', () => {
    // Si divergen, el borde muestra "mínimo 3" y el regex rechaza en 4: el dueño no entiende
    // por qué su link no entra y abandona el alta.
    expect(isSlugShaped('a'.repeat(SLUG_MIN_LENGTH - 1))).toBe(false);
    expect(isSlugShaped(AT_MIN)).toBe(true);
    expect(isSlugShaped(AT_MAX)).toBe(true);
    expect(isSlugShaped('a'.repeat(SLUG_MAX_LENGTH + 1))).toBe(false);
  });

  it('el largo máximo entra cómodo en un label DNS y en un cache tag', () => {
    // RFC 1035: 63 bytes por label. Cache tag de Next: 256 bytes, y el nuestro lleva prefijo.
    expect(SLUG_MAX_LENGTH).toBeLessThan(63);
    expect(`storefront:${AT_MAX}`.length).toBeLessThan(256);
  });

  it('el patrón no tiene la bandera global, que lo volvería stateful entre llamadas', () => {
    // Un regex con /g exportado guarda `lastIndex` y devuelve `false` una de cada dos veces.
    // Como este se comparte entre owners, sería un bug intermitente e imposible de leer.
    expect(SLUG_PATTERN.global).toBe(false);
    expect(SLUG_PATTERN.test('nortecel')).toBe(true);
    expect(SLUG_PATTERN.test('nortecel')).toBe(true);
  });
});

describe('normalizar antes de validar, nunca después', () => {
  it('recorta espacios y baja a minúsculas', () => {
    expect(normalizeSlug('  NorteCel ')).toBe('nortecel');
  });

  it('colapsa las formas de compatibilidad Unicode que imitan un subdominio nuestro', () => {
    // `ｗｗｗ` (fullwidth) no es `www` hasta que se normaliza NFKC. Sin esto, entra a la base un
    // slug que se ve idéntico a un reservado.
    expect(normalizeSlug('ｗｗｗ')).toBe('www');
    expect(isUsableSlug(normalizeSlug('ｗｗｗ'))).toBe(false);
  });

  it('`WWW` no esquiva la lista de reservados por venir en mayúsculas', () => {
    expect(isUsableSlug('WWW')).toBe(false);
    expect(isUsableSlug(normalizeSlug('WWW'))).toBe(false);
  });

  it('normalizar dos veces da lo mismo que normalizar una', () => {
    const once = normalizeSlug('  MiTienda ');
    expect(normalizeSlug(once)).toBe(once);
  });
});

describe('un slug usable tiene forma válida y además no está reservado', () => {
  it('acepta el nombre de un negocio real', () => {
    expect(isUsableSlug('nortecel')).toBe(true);
    expect(isUsableSlug('cipo-cel')).toBe(true);
  });

  it('rechaza un reservado aunque su forma sea impecable', () => {
    for (const value of ['www', 'app', 'soporte', 'not-a-tenant']) {
      expect(isSlugShaped(value), value).toBe(true);
      expect(isUsableSlug(value), value).toBe(false);
    }
  });

  it('rechaza una forma inválida aunque no esté reservada', () => {
    expect(isUsableSlug('Norte_Cel')).toBe(false);
  });
});

describe('assertSlug corta el paso antes de construir un host o un cache tag', () => {
  it('deja pasar un slug válido sin tirar', () => {
    expect(() => {
      assertSlug('nortecel');
    }).not.toThrow();
  });

  it('tira DomainError con código SLUG_INVALID y el valor ofensor en el mensaje', () => {
    try {
      assertSlug('Norte Cel');
      expect.unreachable('assertSlug tenía que tirar');
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe('SLUG_INVALID');
      expect((err as DomainError).message).toContain('Norte Cel');
    }
  });

  it('no valida reservados: son dos preguntas distintas y mezclarlas confunde el borde', () => {
    // `assertSlug` protege la construcción del host y del tag. Que `www` esté reservado es una
    // regla de negocio del alta, no una condición para poder escribir `www.maat.work`.
    expect(() => {
      assertSlug('www');
    }).not.toThrow();
  });
});

describe('la sugerencia de link nunca propone algo que el submit vaya a rechazar', () => {
  it('convierte el nombre del negocio en un link legible', () => {
    expect(suggestSlug('Norte Cel Cipolletti')).toBe('norte-cel-cipolletti');
  });

  it('saca los acentos y la eñe en vez de dejarlos entrar al subdominio', () => {
    expect(suggestSlug('Cañadón  Ñandú')).toBe('canadon-nandu');
  });

  it('corta en el largo máximo sin dejar un guión colgando en el borde', () => {
    expect(suggestSlug('Norte Cel Cipolletti Rio Negro Argentina')).toBe(
      'norte-cel-cipolletti-rio-negro-a',
    );
    expect(suggestSlug(`${'a'.repeat(SLUG_MAX_LENGTH - 1)} xyz`)).toBe('a'.repeat(SLUG_MAX_LENGTH - 1));
  });

  it('devuelve vacío en vez de proponer un nombre reservado', () => {
    // Proponer `demo` y que el submit lo rechace es peor que no proponer nada: el dueño ya se
    // imaginó su link.
    expect(suggestSlug('Demo')).toBe('');
    expect(suggestSlug('Soporte')).toBe('');
  });

  it('devuelve vacío cuando no queda nada usable del nombre', () => {
    expect(suggestSlug('')).toBe('');
    expect(suggestSlug('!!!')).toBe('');
    expect(suggestSlug('Ok')).toBe('');
  });

  it('todo lo que sugiere es aceptado por la misma validación del alta', () => {
    const nombres = ['Norte Cel', 'iPhones del Valle', 'CIPO CEL 2026', 'Móviles Ñeuquén'];
    for (const nombre of nombres) {
      const sugerido = suggestSlug(nombre);
      expect(sugerido.length, nombre).toBeGreaterThan(0);
      expect(isUsableSlug(sugerido), `${nombre} → ${sugerido}`).toBe(true);
    }
  });
});
