import { describe, expect, it } from 'vitest';
import { parseStatusForm } from './status-action-schema';

/**
 * El borde de `setListingStatusAction`, testeado como lo que es: un `POST` que arma cualquiera.
 *
 * El caso que este archivo existe para fijar es **D2**: un `costUsd` en el payload de la venta no
 * tiene quién lo lea. Es la mitad barata de la afirmación —la cara la mide la probe del LEAD contra
 * Postgres, mandando un costo falso y mirando qué quedó en `sales.cost_usd`—, pero es la que rompe
 * en el segundo en que alguien agrega el campo a `formFields()`.
 */

const LISTING_ID = '3f2b1a90-7c4d-4e21-9b8a-0c1d2e3f4a5b';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

describe('parseStatusForm · publicar y despublicar', () => {
  it('acepta los dos destinos de siempre', () => {
    for (const to of ['available', 'draft']) {
      const parsed = parseStatusForm(form({ listingId: LISTING_ID, to }));

      expect(parsed).toEqual({ ok: true, data: { listingId: LISTING_ID, to, after: 'stay' } });
    }
  });

  /** No hay campos de venta en esta rama: si llegan, se descartan. */
  it('un precio colado en una transición que no es venta no sobrevive', () => {
    const parsed = parseStatusForm(
      form({ listingId: LISTING_ID, to: 'draft', priceUsd: '1', paymentMethod: 'cash_usd' }),
    );

    expect(parsed.ok && Object.keys(parsed.data).sort()).toEqual(['after', 'listingId', 'to']);
  });

  it('un destino que esta pantalla no maneja no entra', () => {
    for (const to of ['reserved', 'in_service', 'unavailable', '']) {
      expect(parseStatusForm(form({ listingId: LISTING_ID, to })).ok).toBe(false);
    }
  });

  it('un listingId que no es uuid no llega a la query', () => {
    const parsed = parseStatusForm(form({ listingId: "'; drop table listings; --", to: 'draft' }));

    expect(parsed).toEqual({ ok: false, error: 'No pudimos identificar el equipo. Recargá la pantalla.' });
  });

  /** `after` es del cliente: basura no rompe la operación, la deja donde está. */
  it('un after inventado cae en "stay" en vez de rebotar', () => {
    const parsed = parseStatusForm(
      form({ listingId: LISTING_ID, to: 'draft', after: 'https://otro-lado.example' }),
    );

    expect(parsed.ok && parsed.data.after).toBe('stay');
  });
});

describe('parseStatusForm · la venta', () => {
  const sale = { listingId: LISTING_ID, to: 'sold', priceUsd: '620,50', paymentMethod: 'transfer' };

  it('acepta el precio cobrado y el medio de pago, y devuelve centavos', () => {
    expect(parseStatusForm(form(sale))).toEqual({
      ok: true,
      data: {
        listingId: LISTING_ID,
        to: 'sold',
        after: 'stay',
        priceUsdCents: 62_050,
        paymentMethod: 'transfer',
      },
    });
  });

  /**
   * **D2, del lado del borde.** El costo del formulario no se lee, así que no aparece en lo
   * parseado ni con otro nombre. La probe del LEAD mide la otra mitad —que `sales.cost_usd` quede
   * en el de `listings` y no en el falso—; esto fija que ni siquiera llegue tan lejos.
   */
  it('un costUsd de contrabando no tiene quién lo lea', () => {
    const parsed = parseStatusForm(
      form({ ...sale, costUsd: '1', cost_usd: '1', marginUsd: '999', soldBy: 'otro' }),
    );

    expect(parsed.ok).toBe(true);
    expect(JSON.stringify(parsed)).not.toMatch(/cost|margin|soldBy|otro/iu);
  });

  /** D5 del lado del runtime: `to: 'sold'` sin datos de venta no pasa el borde tampoco. */
  it('vender sin precio no pasa, y el mensaje es para quien lo está tipeando', () => {
    const parsed = parseStatusForm(form({ listingId: LISTING_ID, to: 'sold', paymentMethod: 'transfer' }));

    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? '' : parsed.error).toMatch(/precio/iu);
  });

  it('vender sin medio de pago no pasa', () => {
    const parsed = parseStatusForm(form({ listingId: LISTING_ID, to: 'sold', priceUsd: '620' }));

    expect(parsed).toEqual({ ok: false, error: 'Elegí con qué te pagaron.' });
  });

  /** El caso caro: `1.200` es mil doscientos, no uno con dos. Se rechaza en vez de adivinar. */
  it('un precio con separador de miles rebota con un mensaje que enseña', () => {
    const parsed = parseStatusForm(form({ ...sale, priceUsd: '1.200' }));

    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? '' : parsed.error).toMatch(/sin puntos de miles/u);
  });

  it('un medio de pago inventado no entra', () => {
    expect(parseStatusForm(form({ ...sale, paymentMethod: 'bitcoin' })).ok).toBe(false);
  });

  /**
   * Un id roto en una venta devuelve el texto genérico, no el mensaje de un campo tipeado: el
   * `listingId` viaja en un hidden y no hay nada que corregir escribiendo.
   */
  it('con el id roto habla de la pantalla, no del precio', () => {
    const parsed = parseStatusForm(form({ ...sale, listingId: 'no-es-un-uuid' }));

    expect(parsed).toEqual({ ok: false, error: 'No pudimos identificar el equipo. Recargá la pantalla.' });
  });
});
