import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { BCRA_FX_URL, fetchAutomaticFxQuote, parseBcraUsdQuote } = await import('./automatic-rate');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('parseBcraUsdQuote', () => {
  it('convierte la última cotización USD del BCRA a centavos de ARS', () => {
    expect(
      parseBcraUsdQuote({
        status: 200,
        results: {
          fecha: '2026-08-31',
          detalle: [
            { codigoMoneda: 'ARS', tipoCotizacion: 1 },
            { codigoMoneda: 'USD', tipoCotizacion: 1508.5 },
          ],
        },
      }),
    ).toEqual({ arsCentsPerUsd: 150_850, asOf: '2026-08-31', source: 'bcra' });
  });

  it('rechaza respuestas sin estado correcto, fecha válida o USD positivo', () => {
    expect(parseBcraUsdQuote({ status: 500 })).toBeNull();
    expect(
      parseBcraUsdQuote({
        status: 200,
        results: { fecha: '2026-08-31', detalle: [{ codigoMoneda: 'EUR', tipoCotizacion: 1700 }] },
      }),
    ).toBeNull();
    expect(
      parseBcraUsdQuote({
        status: 200,
        results: { fecha: '31-08-2026', detalle: [{ codigoMoneda: 'USD', tipoCotizacion: 1508.5 }] },
      }),
    ).toBeNull();
  });
});

describe('fetchAutomaticFxQuote', () => {
  it('consulta la API pública del BCRA y devuelve sólo una cotización validada', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 200,
          results: {
            fecha: '2026-08-31',
            detalle: [{ codigoMoneda: 'USD', tipoCotizacion: 1508.5 }],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchAutomaticFxQuote()).resolves.toEqual({
      arsCentsPerUsd: 150_850,
      asOf: '2026-08-31',
      source: 'bcra',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      BCRA_FX_URL,
      expect.objectContaining({ cache: 'no-store', headers: { accept: 'application/json' } }),
    );
  });

  it('falla cerrado si el proveedor responde un error o un JSON inválido', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('no disponible', { status: 503 })));
    await expect(fetchAutomaticFxQuote()).rejects.toMatchObject({ code: 'AUTOMATIC_FX_UNAVAILABLE' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    await expect(fetchAutomaticFxQuote()).rejects.toMatchObject({ code: 'AUTOMATIC_FX_UNAVAILABLE' });
  });
});
