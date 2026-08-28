import { describe, expect, it } from 'vitest';

import { DomainError } from './errors';
import {
  LISTING_SLUG_MAX_LENGTH,
  LISTING_SLUG_MIN_LENGTH,
  LISTING_SLUG_PATTERN,
  SLUG_MAX_LENGTH,
  SLUG_MIN_LENGTH,
  SLUG_PATTERN,
  assertSlug,
  isListingSlugShaped,
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

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  Segunda familia: el slug de una ficha
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** La fila 207 de `packages/db/src/seed-data.ts`. 37 caracteres, publicada, legible por `anon`. */
const SEED_207_SLUG = 'iphone-15-pro-max-256-titanio-natural';

const LISTING_AT_MIN = 'a'.repeat(LISTING_SLUG_MIN_LENGTH);
const LISTING_AT_MAX = 'a'.repeat(LISTING_SLUG_MAX_LENGTH);

describe('el slug de una ficha vive en el path, no en el host', () => {
  it('acepta el slug de 37 caracteres que ya está sembrado (fila 207)', () => {
    // Si esto se pone en rojo, hay un equipo publicado que el comprador nunca encuentra.
    expect(SEED_207_SLUG.length).toBe(37);
    expect(isListingSlugShaped(SEED_207_SLUG)).toBe(true);
  });

  it('rechaza uno de 65: el techo existe para acotar el cache key que elige el visitante', () => {
    expect(isListingSlugShaped('a'.repeat(LISTING_SLUG_MAX_LENGTH + 1))).toBe(false);
    expect(isListingSlugShaped(LISTING_AT_MAX)).toBe(true);
  });

  it('rechaza uno de 2 y acepta el mínimo de 3', () => {
    expect(isListingSlugShaped('a'.repeat(LISTING_SLUG_MIN_LENGTH - 1))).toBe(false);
    expect(isListingSlugShaped(LISTING_AT_MIN)).toBe(true);
  });

  it('rechaza el guión al principio', () => {
    expect(isListingSlugShaped('-arranca-con-guion')).toBe(false);
  });

  it('rechaza el guión al final', () => {
    expect(isListingSlugShaped('termina-')).toBe(false);
  });

  it('rechaza mayúsculas', () => {
    expect(isListingSlugShaped('MAYUSCULAS')).toBe(false);
  });

  it('rechaza el espacio, que rompería el segmento de path', () => {
    expect(isListingSlugShaped('con espacio')).toBe(false);
  });

  it('rechaza el guión bajo: el alfabeto es el mismo que el del slug de tenant', () => {
    expect(isListingSlugShaped('con_guion_bajo')).toBe(false);
  });

  it('rechaza el string vacío', () => {
    expect(isListingSlugShaped('')).toBe(false);
  });

  it('rechaza punto, barra y porcentaje, que se comen el ruteo de `/p/{slug}`', () => {
    for (const value of ['iphone.14', 'iphone/14', 'iphone%2014', '../secreto', 'ñandu-14']) {
      expect(isListingSlugShaped(value), value).toBe(false);
    }
  });

  it('es pura: nunca tira, ni con basura de la barra de direcciones', () => {
    // El input lo escribe un desconocido. Bajo cacheComponents + PPR un throw de render sale como
    // stream abierto con 200, no como 500: CPU facturada por input basura.
    for (const value of ['', '-', '%%%', 'a'.repeat(5000), '\u0000', 'コンニチハ']) {
      expect(() => isListingSlugShaped(value), value).not.toThrow();
    }
  });

  it('el patrón no tiene la bandera global, que lo volvería stateful entre llamadas', () => {
    expect(LISTING_SLUG_PATTERN.global).toBe(false);
    expect(LISTING_SLUG_PATTERN.test(SEED_207_SLUG)).toBe(true);
    expect(LISTING_SLUG_PATTERN.test(SEED_207_SLUG)).toBe(true);
  });
});

describe('el generador es más angosto que el lector, a propósito', () => {
  it('la familia de tenant sigue rechazando el slug de 37 de la fila 207', () => {
    // Si esto se pone en verde, dejaron de ser dos familias y el techo de 32 se perdió: el slug
    // de tenant es un label DNS y ese límite no se afloja para acomodar una ficha.
    expect(isSlugShaped(SEED_207_SLUG)).toBe(false);
    expect(SEED_207_SLUG.length).toBeGreaterThan(SLUG_MAX_LENGTH);
  });

  it('lo que fabrica el panel (≤32) siempre lo lee la vidriera (≤64)', () => {
    // La asimetría sólo es sana en una dirección: generador ⊂ lector. Al revés desaparecen fichas.
    expect(LISTING_SLUG_MAX_LENGTH).toBeGreaterThan(SLUG_MAX_LENGTH);
    expect(LISTING_SLUG_MIN_LENGTH).toBe(SLUG_MIN_LENGTH);
    for (const value of ['nortecel', 'iphone-14-pro-256-grafi-k7m2p', AT_MIN, AT_MAX]) {
      expect(isSlugShaped(value), value).toBe(true);
      expect(isListingSlugShaped(value), value).toBe(true);
    }
  });

  it('64 no es un techo cualquiera: deja aire sobre el peor slug real y corta el path de 8 KB', () => {
    expect(LISTING_SLUG_MAX_LENGTH).toBeGreaterThan(SEED_207_SLUG.length);
    expect(LISTING_SLUG_MAX_LENGTH).toBeLessThan(256);
    expect(isListingSlugShaped('a'.repeat(8192))).toBe(false);
  });

  it('las constantes de largo y el regex de la familia de listing dicen lo mismo', () => {
    expect(isListingSlugShaped('a'.repeat(LISTING_SLUG_MIN_LENGTH - 1))).toBe(false);
    expect(isListingSlugShaped('a'.repeat(LISTING_SLUG_MIN_LENGTH))).toBe(true);
    expect(isListingSlugShaped('a'.repeat(LISTING_SLUG_MAX_LENGTH))).toBe(true);
    expect(isListingSlugShaped('a'.repeat(LISTING_SLUG_MAX_LENGTH + 1))).toBe(false);
  });
});
