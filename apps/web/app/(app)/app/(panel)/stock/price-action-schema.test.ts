import { describe, expect, it } from 'vitest';
import { parsePriceForm } from './price-action-schema';

const LISTING_ID = '4f1a0d2e-6b5c-4a3d-9e8f-0a1b2c3d4e5f';

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe('parsePriceForm', () => {
  it('acepta coma decimal y devuelve centavos', () => {
    const parsed = parsePriceForm(form({ listingId: LISTING_ID, priceUsd: '620,50' }));

    expect(parsed).toEqual({
      ok: true,
      data: { listingId: LISTING_ID, priceUsd: 62_050 },
    });
  });

  it('rechaza cero y separadores de miles con mensajes accionables', () => {
    expect(parsePriceForm(form({ listingId: LISTING_ID, priceUsd: '0' }))).toEqual({
      ok: false,
      error: 'El precio tiene que ser mayor a cero.',
    });
    expect(parsePriceForm(form({ listingId: LISTING_ID, priceUsd: '1.200' }))).toEqual({
      ok: false,
      error: 'Escribí sólo números, sin puntos de miles. Ejemplo: 620 o 620,50.',
    });
  });

  it('no expone el mensaje interno cuando el id no tiene forma de uuid', () => {
    expect(parsePriceForm(form({ listingId: 'otro-tenant', priceUsd: '620' }))).toEqual({
      ok: false,
      error: 'No pudimos identificar el equipo. Recargá la pantalla.',
    });
  });

  it('lee sólo listingId y priceUsd', () => {
    const parsed = parsePriceForm(
      form({ listingId: LISTING_ID, priceUsd: '620', costUsd: '1', tenantId: 'ajeno' }),
    );

    expect(parsed.ok && Object.keys(parsed.data).sort()).toEqual(['listingId', 'priceUsd']);
  });
});
