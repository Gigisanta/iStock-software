import { describe, expect, it } from 'vitest';

import { DomainError } from './errors';
// `assertSlug` se mudó a `./slug` (fuente única del formato del slug); el test lo sigue
// ejercitando desde acá porque el borde que rompe es `buildWaUrl`.
import { assertSlug } from './slug';
import {
  STOREFRONT_DOMAIN,
  buildWaMessage,
  buildWaUrl,
  describeListing,
  normalizeWaPhone,
  storefrontHost,
  storefrontUrl,
  type WaListing,
} from './wa';

/** El listing del ejemplo canónico de `CLAUDE.md` §1. */
const CANONICAL: WaListing = {
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

  it('U16 — un listing reservado cambia el copy y no promete disponibilidad', () => {
    const text = buildWaMessage({ ...CANONICAL, status: 'reserved' }, 'nortecel');
    expect(text).toBe(
      'Hola, vi el iPhone 14 Pro 256 Grafito (usado A) a USD 620 en nortecel.maat.work. Dice que está reservado, ¿me avisás si se libera?',
    );
    expect(text).not.toContain('y lo quiero');
  });

  it('U16b — un listing vendido no ofrece comprar lo que ya no está', () => {
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
