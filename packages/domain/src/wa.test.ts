import { describe, expect, it } from 'vitest';

import { DomainError } from './errors';
// `assertSlug` se mudó a `./slug` (fuente única del formato del slug); el test lo sigue
// ejercitando desde acá porque el borde que rompe es `buildWaUrl`.
import { assertSlug } from './slug';
import { waConditionLabel } from './types';
import {
  NAME_SOURCES,
  STOREFRONT_DOMAIN,
  buildWaMessage,
  buildWaUrl,
  describeListing,
  describeListingName,
  normalizeWaPhone,
  storefrontHost,
  storefrontUrl,
  type WaListing,
} from './wa';

/** El listing del ejemplo canónico de `CLAUDE.md` §1. */
const CANONICAL: WaListing = {
  nameSource: 'catalog',
  modelDisplayName: 'iPhone 14 Pro',
  storageGb: 256,
  color: 'Grafito',
  condition: 'used_excellent',
  priceUsdCents: 62_000,
  status: 'available',
};

const CANONICAL_TEXT = 'Hola, vi el iPhone 14 Pro 256 Grafito (usado A) a USD 620 en nortecel.maat.work y lo quiero.';

describe('buildWaMessage — el botón que factura', () => {
  it('U14 — produce el string canónico byte a byte', () => {
    const text = buildWaMessage(CANONICAL, 'nortecel');
    expect(text).toBe(CANONICAL_TEXT);
    expect([...text].length).toBe([...CANONICAL_TEXT].length);
  });

  it('U14b — el precio del mensaje es el mismo que el de la pantalla', () => {
    expect(buildWaMessage({ ...CANONICAL, priceUsdCents: 120_000 }, 'nortecel')).toContain('a USD 1.200 en');
    expect(buildWaMessage({ ...CANONICAL, priceUsdCents: 62_050 }, 'nortecel')).toContain('a USD 620,50 en');
  });

  it('U15 — la URL codifica acentos y espacios sin romperlos', () => {
    const listing: WaListing = { ...CANONICAL, color: 'Púrpura', modelDisplayName: 'iPhone 14 Pro Máx' };
    const url = buildWaUrl(listing, 'nortecel', '5492994123456');
    expect(url.startsWith('https://wa.me/5492994123456?text=')).toBe(true);
    expect(url).toContain('P%C3%BArpura');
    expect(url).toContain('M%C3%A1x');
    expect(url).toContain('%20');
    expect(url).not.toContain(' ');
    const decoded = decodeURIComponent(url.slice(url.indexOf('?text=') + '?text='.length));
    expect(decoded).toBe(buildWaMessage(listing, 'nortecel'));
  });

  it('U15b — el ejemplo canónico sobrevive el round-trip de encoding', () => {
    const url = buildWaUrl(CANONICAL, 'nortecel', '+54 9 299 412-3456');
    const decoded = decodeURIComponent(url.split('?text=')[1] ?? '');
    expect(decoded).toBe(CANONICAL_TEXT);
  });

  /**
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   *  `reserved`: el botón dice «lo quiero igual», el mensaje tiene que decir lo mismo
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   *
   * El texto viejo era *«... Dice que está reservado, ¿me avisás si se libera?»*. Contra el CTA que
   * la vidriera fijó en S6 —**«Lo quiero igual — escribir por WhatsApp»**— eso es un botón que
   * promete una cosa y un mensaje que manda otra: el visitante aprieta declarando compra y del otro
   * lado llega un pedido de aviso para más adelante, que se archiva.
   *
   * Ojo con el matiz, porque **no** es el defecto que se arregló en `status.ts`: acá el aviso se lo
   * pide el visitante al vendedor, que sí puede cumplirlo. No es una promesa nuestra. Lo que rompe
   * es `CLAUDE.md` §1 — **UN** `wa.me` por ficha, y el texto que abre es el que cierra la operación.
   *
   * Por eso hay dos tests y no uno. `U16` fija el string (se lee, se aprueba, se cambia a
   * propósito). `U16b` es el que tiene que **sobrevivir al próximo rewrite**: no le importa qué
   * palabras se usen, le importa la forma — que la intención de compra vaya primero y afirmativa, y
   * que el mensaje no vuelva a ser un favor pedido en forma de pregunta. Si alguien reescribe el
   * copy y vuelve a la fórmula del favor, `U16b` se pone rojo aunque `U16` se haya actualizado.
   *
   * Alcance a propósito: `U16b` mira **sólo** `reserved`. `sold` sí termina en pregunta
   * (*«¿Te queda alguno parecido?»*) y está bien que así sea — ahí no hay nada que comprar y la
   * pregunta es el producto del mensaje, no su debilidad.
   */
  const RESERVED_TEXT =
    'Hola, quiero el iPhone 14 Pro 256 Grafito (usado A) a USD 620 que vi en nortecel.maat.work. Sé que está reservado: si se cae, lo compro yo.';

  it('U16 — un listing reservado declara la compra sin prometer disponibilidad', () => {
    const text = buildWaMessage({ ...CANONICAL, status: 'reserved' }, 'nortecel');
    expect(text).toBe(RESERVED_TEXT);
    // Reconoce el estado (no vende algo que está señado) sin ser el copy de `available`.
    expect(text).toContain('reservado');
    expect(text).not.toContain('y lo quiero');
    // `available` es intocable: está fijado literalmente en `CLAUDE.md` §1.
    expect(buildWaMessage(CANONICAL, 'nortecel')).toBe(CANONICAL_TEXT);
  });

  it('U16b — estructural: la variante reserved no es un favor pedido en forma de pregunta', () => {
    const text = buildWaMessage({ ...CANONICAL, status: 'reserved' }, 'nortecel');

    /** Compra declarada en primera persona del presente. Ni condicional, ni pregunta. */
    const COMPRA = /\b(quiero|compro|me lo quedo|lo llevo)\b/u;
    /** Pedido de favor: el vendedor tiene que hacer algo más adelante para que el mensaje sirva. */
    const FAVOR = /\b(avisame|avisáme|me avisás|me avisas|me avisarías|podés avisarme)\b/u;
    /** Hasta el primer punto seguido. El host no corta: `nortecel.maat.work` no lleva espacio. */
    const primeraOracion = text.split(/(?<=\.)\s/u)[0] ?? text;

    // (1) No es una pregunta. Ni al final, ni en el medio.
    expect(text).not.toMatch(/[?¿]/u);
    // (2) La intención de compra está, y está en el primer renglón.
    expect(primeraOracion).toMatch(COMPRA);
    // (3) Y va PRIMERO: antes de cualquier mención al estado reservado.
    expect(text.search(COMPRA)).toBeGreaterThanOrEqual(0);
    expect(text.search(COMPRA)).toBeLessThan(text.search(/reserv/u));
    // (4) El aviso puede quedar como consecuencia, nunca como pedido.
    expect(text).not.toMatch(FAVOR);
    // (5) Registro de reseller intacto (`CLAUDE.md` §1, ratificado): `usado A`, no `usado excelente`.
    expect(text).toContain('(usado A)');
    expect(text).not.toContain('usado excelente');
  });

  it('U16c — el mensaje de reservado no filtra un solo dato de la reserva', () => {
    // El visitante no sabe quién señó ni hasta cuándo, y el mensaje no puede enseñárselo.
    // `WaListing` no tiene esos campos: la prohibición es de tipos. Esto es el cinturón.
    const contaminado = {
      ...CANONICAL,
      status: 'reserved',
      customer_label: 'Sofía G.',
      reservedBy: 'Sofía G.',
      reservedUntil: '2026-08-28T19:30:00Z',
      reservation_expires_at: '2026-08-28T19:30:00Z',
      internal_notes: 'seña 100 en efectivo',
    } as WaListing;
    const text = buildWaMessage(contaminado, 'nortecel');
    const url = buildWaUrl(contaminado, 'nortecel', '5492994123456');
    for (const secret of ['Sofía', 'Sofia', '19:30', '2026-08-28', 'seña', 'efectivo', '100']) {
      expect(text).not.toContain(secret);
      expect(decodeURIComponent(url)).not.toContain(secret);
    }
    expect(text).toBe(RESERVED_TEXT);
  });

  it('U16d — un listing vendido no ofrece comprar lo que ya no está', () => {
    const text = buildWaMessage({ ...CANONICAL, status: 'sold' }, 'nortecel');
    expect(text).toContain('dice que está vendido');
    expect(text).not.toContain('y lo quiero');
  });

  it('nunca filtra IMEI, costo ni notas internas aunque vengan pegados en el objeto', () => {
    const contaminado = {
      ...CANONICAL,
      imei: '356938035643809',
      cost_usd: 48_000,
      internal_notes: 'lo compré en 480, proveedor Juan',
      supplier: 'Juan',
    } as WaListing;
    const text = buildWaMessage(contaminado, 'nortecel');
    const url = buildWaUrl(contaminado, 'nortecel', '5492994123456');
    for (const secret of ['356938035643809', '48000', '480', 'Juan', 'proveedor']) {
      expect(text).not.toContain(secret);
      expect(decodeURIComponent(url)).not.toContain(secret);
    }
    expect(text).toBe(CANONICAL_TEXT);
  });

  it('describe lotes sin storage ni color sin dejar espacios de más', () => {
    expect(
      describeListing({
        nameSource: 'free_text',
        modelDisplayName: 'Cargador 20W',
        storageGb: null,
        color: null,
        condition: 'sealed',
        priceUsdCents: 1_500,
        status: 'available',
      }),
    ).toBe('Cargador 20W (sellado)');
  });

  it('usa la etiqueta corta de condición del mensaje, no la de la UI', () => {
    expect(describeListing({ ...CANONICAL, condition: 'tester_a_plus' })).toContain('(tester A+)');
    expect(describeListing({ ...CANONICAL, condition: 'used_with_detail' })).toContain('(usado con detalle)');
    expect(describeListing({ ...CANONICAL, condition: 'open_box' })).toContain('(open box)');
  });
});

describe('slug y host de la vidriera', () => {
  it('arma el host del tenant', () => {
    expect(STOREFRONT_DOMAIN).toBe('maat.work');
    expect(storefrontHost('nortecel')).toBe('nortecel.maat.work');
    expect(storefrontUrl('nortecel')).toBe('https://nortecel.maat.work');
  });

  it('rechaza slugs que romperían el wildcard *.maat.work', () => {
    for (const bad of ['NorteCel', 'norte cel', '-nortecel', 'nortecel-', 'no', 'norte.cel', 'norte_cel', '']) {
      expect(() => assertSlug(bad)).toThrow(DomainError);
    }
    expect(() => buildWaMessage(CANONICAL, 'Norte Cel')).toThrow(/slug inválido/u);
  });
});

describe('normalizeWaPhone — E.164 sin "+" ni espacios', () => {
  it('limpia el formato que el dueño escribe a mano', () => {
    expect(normalizeWaPhone('+54 9 299 412-3456')).toBe('5492994123456');
    expect(normalizeWaPhone('(549) 2994123456')).toBe('5492994123456');
  });

  it('rechaza teléfonos imposibles', () => {
    for (const bad of ['0299412345', '123', 'no-es-un-telefono', '+54 9 299 412 3456 7890 111']) {
      expect(() => normalizeWaPhone(bad)).toThrow(DomainError);
    }
  });
});
/**
 * Procedencia del nombre — el defecto medido en S4 (W5 de `accept-s4.sh`):
 *
 *   Hola, vi el iPhone 14 Pro 256 Grafito 256 Grafito (usado A) a USD 620 en ... y lo quiero.
 *
 * `modelDisplayName` significaba dos cosas según quién lo llenara: el `display_name` limpio del
 * `catalog_model`, o el `title` de texto libre del dueño —que en la práctica ya trae storage y
 * color adentro—. `nameSource` vuelve esa diferencia parte del tipo, obligatoria y sin default.
 */
describe('describeListing — procedencia del nombre (nameSource)', () => {
  const FREE: WaListing = { ...CANONICAL, nameSource: 'free_text' };

  it('expone las dos procedencias posibles', () => {
    expect([...NAME_SOURCES]).toEqual(['catalog', 'free_text']);
  });

  it('F1 — free_text con storage y color YA en el nombre no los repite (el bug medido en W5)', () => {
    const listing: WaListing = { ...FREE, modelDisplayName: 'iPhone 14 Pro 256 Grafito' };
    expect(describeListing(listing)).toBe('iPhone 14 Pro 256 Grafito (usado A)');
    const text = buildWaMessage(listing, 'nortecel');
    expect(text).toBe(CANONICAL_TEXT);
    expect([...text].length).toBe([...CANONICAL_TEXT].length);
    expect(text.match(/256/gu)?.length).toBe(1);
    expect(text.match(/Grafito/gu)?.length).toBe(1);
  });

  it('F2 — free_text sin storage ni color en el nombre los appendea (no deja el mensaje ambiguo)', () => {
    const listing: WaListing = { ...FREE, modelDisplayName: 'iPhone 14 Pro' };
    expect(describeListing(listing)).toBe('iPhone 14 Pro 256 Grafito (usado A)');
    expect(buildWaMessage(listing, 'nortecel')).toBe(CANONICAL_TEXT);
  });

  it('F3 — free_text con storage pero sin color appendea sólo el color', () => {
    const listing: WaListing = { ...FREE, modelDisplayName: 'iPhone 14 Pro 256' };
    expect(describeListing(listing)).toBe('iPhone 14 Pro 256 Grafito (usado A)');
    expect(buildWaMessage(listing, 'nortecel')).toBe(CANONICAL_TEXT);
  });

  it('F3b — free_text con color pero sin storage appendea sólo el storage', () => {
    const listing: WaListing = { ...FREE, modelDisplayName: 'iPhone 14 Pro Grafito' };
    expect(describeListing(listing)).toBe('iPhone 14 Pro Grafito 256 (usado A)');
  });

  it('F4 — la comparación ignora mayúsculas, acentos y espacios de más', () => {
    expect(describeListing({ ...FREE, modelDisplayName: 'iphone 14 pro   256gb   grafito' })).toBe(
      'iphone 14 pro 256gb grafito (usado A)',
    );
    expect(
      describeListing({ ...FREE, modelDisplayName: 'iPhone 13 128 Purpura', storageGb: 128, color: 'Púrpura' }),
    ).toBe('iPhone 13 128 Purpura (usado A)');
    expect(
      describeListing({ ...FREE, modelDisplayName: 'iPhone 13 128 PÚRPURA', storageGb: 128, color: 'purpura' }),
    ).toBe('iPhone 13 128 PÚRPURA (usado A)');
    expect(
      describeListing({ ...FREE, modelDisplayName: 'iPhone 14 Pro - 256 GB / Grafito' }),
    ).toBe('iPhone 14 Pro - 256 GB / Grafito (usado A)');
  });

  it('F4b — un color de dos palabras cuenta como presente sólo si está entero y seguido', () => {
    expect(describeListing({ ...FREE, modelDisplayName: 'iPhone 14 256 Azul Sierra', color: 'Azul Sierra' })).toBe(
      'iPhone 14 256 Azul Sierra (usado A)',
    );
    expect(describeListing({ ...FREE, modelDisplayName: 'iPhone 14 256 Azul', color: 'Azul Sierra' })).toBe(
      'iPhone 14 256 Azul Azul Sierra (usado A)',
    );
  });

  it('F4c — 1 TB y 1024 GB son el mismo dato escrito distinto', () => {
    expect(describeListing({ ...FREE, modelDisplayName: 'iPhone 15 Pro Max 1TB Titanio', storageGb: 1024, color: 'Titanio' })).toBe(
      'iPhone 15 Pro Max 1TB Titanio (usado A)',
    );
    expect(describeListing({ ...FREE, modelDisplayName: 'iPhone 15 Pro Max 1 TB Titanio', storageGb: 1024, color: 'Titanio' })).toBe(
      'iPhone 15 Pro Max 1 TB Titanio (usado A)',
    );
  });

  it('F4d — un número pegado a letras es parte del modelo, no el storage', () => {
    expect(describeListing({ ...FREE, modelDisplayName: 'Moto G64 Negro', storageGb: 64, color: 'Negro' })).toBe(
      'Moto G64 Negro 64 (usado A)',
    );
  });

  it('F5 — storageGb y color en null: no hay nada que appendear ni espacios de más', () => {
    expect(
      describeListing({ ...FREE, modelDisplayName: 'iPhone 14 Pro 256 Grafito', storageGb: null, color: null }),
    ).toBe('iPhone 14 Pro 256 Grafito (usado A)');
    expect(describeListing({ ...FREE, modelDisplayName: 'Cargador 20W', storageGb: null, color: '   ' })).toBe(
      'Cargador 20W (usado A)',
    );
  });

  it('F6 — catalog no adivina: el nombre del catálogo es limpio y siempre se appendea', () => {
    expect(describeListing({ ...CANONICAL, modelDisplayName: 'iPhone 14 Pro 256 Grafito' })).toBe(
      'iPhone 14 Pro 256 Grafito 256 Grafito (usado A)',
    );
    expect(describeListing(CANONICAL)).toBe('iPhone 14 Pro 256 Grafito (usado A)');
  });

  it('F7 — una procedencia desconocida no se ignora en silencio', () => {
    const roto = { ...CANONICAL, nameSource: 'title' } as unknown as WaListing;
    expect(() => describeListing(roto)).toThrow(DomainError);
    expect(() => buildWaMessage(roto, 'nortecel')).toThrow(/procedencia/u);
  });

  /**
   * ════════════════════════════════════════════════════════════════════════════════════════════
   *  El agujero donde va el producto.
   * ════════════════════════════════════════════════════════════════════════════════════════════
   *
   * `catalog_models.display_name` y `listings.title` son los dos `text not null` **sin CHECK**
   * (`packages/db/drizzle/0000_sparkling_vector.sql:95` para el primero; ninguno de los 46 CHECK de
   * esa migración toca a ninguno de los dos). `NOT NULL` no es `no vacío`: `''` entra en las dos
   * columnas. `resolveModelName` (vidriera) cae de `display_name` en blanco a `title`, pero si los
   * dos están en blanco el fallback no tiene a dónde caer y el mensaje degenera en
   * `Hola, vi el  (usado A) a USD 620 en nortecel.maat.work y lo quiero.` — un mensaje con un
   * agujero donde va el producto, mandado al WhatsApp de un cliente real.
   *
   * Criterio de "vacío": **el mismo que usa la vidriera aguas arriba** (`trim().length === 0`).
   * Dos definiciones distintas de vacío en la misma cadena es un hueco con forma de acuerdo.
   */
  const EN_BLANCO = ['', ' ', '   ', '\t', '\n', '\t\n  ', '\u00a0'] as const;

  it('F9 — un nombre vacío o en blanco no describe nada: tira, no emite', () => {
    for (const source of NAME_SOURCES) {
      for (const blank of EN_BLANCO) {
        const listing: WaListing = { ...CANONICAL, nameSource: source, modelDisplayName: blank };
        expect(() => describeListing(listing)).toThrow(DomainError);
        expect(() => describeListing(listing)).toThrow(/nombre/u);
        try {
          describeListing(listing);
          expect.unreachable('describeListing tenía que tirar');
        } catch (err) {
          expect(err).toBeInstanceOf(DomainError);
          expect((err as DomainError).code).toBe('LISTING_INVALID');
        }
      }
    }
  });

  it('F10 — el mensaje y la URL tampoco salen con el agujero', () => {
    for (const blank of EN_BLANCO) {
      const listing: WaListing = { ...FREE, modelDisplayName: blank };
      expect(() => buildWaMessage(listing, 'nortecel')).toThrow(DomainError);
      expect(() => buildWaUrl(listing, 'nortecel', '5492994123456')).toThrow(DomainError);
    }
  });

  it('F11 — un nombre con espacios de más sigue siendo válido (se recorta, no se rechaza)', () => {
    // El chequeo es de "en blanco", no de "tiene espacios": `  iPhone 14 Pro  ` es un nombre.
    expect(describeListing({ ...CANONICAL, modelDisplayName: '  iPhone 14 Pro  ' })).toBe(
      'iPhone 14 Pro 256 Grafito (usado A)',
    );
  });

  it('F8 — la URL de un free_text tampoco duplica', () => {
    const url = buildWaUrl({ ...FREE, modelDisplayName: 'iPhone 14 Pro 256 Grafito' }, 'nortecel', '5492994123456');
    const decoded = decodeURIComponent(url.split('?text=')[1] ?? '');
    expect(decoded).toBe(CANONICAL_TEXT);
  });
});

describe('describeListingName — el nombre, sin condición', () => {
  it('U13n — es exactamente `describeListing` menos el paréntesis de la condición', () => {
    // Un solo implementador de la regla de storage/color. Si estos dos se separan, el bug
    // `iPhone 14 Pro 256 Grafito 256 Grafito` vuelve por el lado que no se testeó.
    const samples: WaListing[] = [
      CANONICAL,
      { ...CANONICAL, nameSource: 'free_text', modelDisplayName: 'iPhone 14 Pro 256 Grafito' },
      { ...CANONICAL, nameSource: 'free_text', modelDisplayName: 'iPhone 14 Pro' },
      { ...CANONICAL, storageGb: null, color: null },
      { ...CANONICAL, condition: 'sealed', color: 'Azul Sierra' },
    ];
    for (const listing of samples) {
      expect(describeListing(listing)).toBe(`${describeListingName(listing)} (${waConditionLabel(listing.condition)})`);
    }
  });

  it('U13n2 — no lleva condición adentro: el registro lo elige quien arma el texto', () => {
    // `stock-list.ts` usa el mapa de la ficha (`usado excelente`) y el mensaje de WA usa `usado A`.
    // Los dos son correctos y por eso la condición no vive acá.
    expect(describeListingName(CANONICAL)).toBe('iPhone 14 Pro 256 Grafito');
    expect(describeListingName(CANONICAL)).not.toContain('usado');
  });

  it('U13n3 — un nombre en blanco tira desde acá, que es el punto más bajo del camino', () => {
    expect(() => describeListingName({ ...CANONICAL, modelDisplayName: '  ' })).toThrow(DomainError);
  });
});
