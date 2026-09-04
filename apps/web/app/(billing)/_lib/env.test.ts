import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * El borde de entorno de billing. Lo que se mide es **cómo falla**, que es lo único que importa
 * en un archivo así:
 *
 * - sin credenciales (B3 abierto) el producto arranca en `mock` y **nadie se vuelve pagador**;
 * - la cadena vacía —lo que trae `.env.example` y lo que hereda un preview deploy— es "no
 *   configurado", no "configurado con nada";
 * - con `BILLING_DRIVER="mercadopago"` a medias, **explota al arrancar** en vez de cobrar a medias.
 */

vi.mock('server-only', () => ({}));

const { billingDriver, billingReady, mpAccessToken, mpWebhookSecret, resetBillingEnvCache } =
  await import('./env');

const CLAVES = [
  'BILLING_DRIVER',
  'MP_ACCESS_TOKEN',
  'MP_WEBHOOK_SECRET',
  'VERCEL_ENV',
] as const;

const original: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const clave of CLAVES) {
    original[clave] = process.env[clave];
    delete process.env[clave];
  }
  resetBillingEnvCache();
});

afterEach(() => {
  for (const clave of CLAVES) {
    if (original[clave] === undefined) delete process.env[clave];
    else process.env[clave] = original[clave];
  }
  resetBillingEnvCache();
});

describe('sin credenciales · B3 abierto', () => {
  it('el driver por defecto es mock y no hay secreto con el cual autorizar a nadie', () => {
    expect(billingDriver()).toBe('mock');
    expect(mpWebhookSecret()).toBeNull();
    expect(mpAccessToken()).toBeNull();
    expect(billingReady()).toBe(false);
  });

  it('la cadena vacía es "no configurado", no "configurado con nada"', () => {
    process.env['MP_WEBHOOK_SECRET'] = '';
    process.env['MP_ACCESS_TOKEN'] = '';
    resetBillingEnvCache();

    // Es el valor que trae `.env.example` y el que hereda un preview deploy. Si `''` pasara como
    // secreto, `verifyWebhookSignature` recibiría un string vacío en vez de `null` — el mismo bug
    // que `cronSecret()` ya tuvo que resolver en el panel.
    expect(mpWebhookSecret()).toBeNull();
    expect(mpAccessToken()).toBeNull();
  });
});

describe('driver real a medias · falla al arrancar', () => {
  it.each(['MP_ACCESS_TOKEN', 'MP_WEBHOOK_SECRET'])(
    'sin %s no arranca',
    (faltante) => {
      process.env['BILLING_DRIVER'] = 'mercadopago';
      process.env['MP_ACCESS_TOKEN'] = 'token-de-mercadopago-larguito';
      process.env['MP_WEBHOOK_SECRET'] = 'secreto-de-webhook-larguito';
      delete process.env[faltante];
      resetBillingEnvCache();

      // Un driver `mercadopago` a medio configurar es peor que el mock: cobra a medias y activa a
      // medias. El nombre de la variable que falta va en el mensaje, sin el valor de ninguna otra.
      expect(() => billingDriver()).toThrow(faltante);
    },
  );

  it('completo: las tres resuelven', () => {
    process.env['BILLING_DRIVER'] = 'mercadopago';
    process.env['MP_ACCESS_TOKEN'] = 'token-de-mercadopago-larguito';
    process.env['MP_WEBHOOK_SECRET'] = 'secreto-de-webhook-larguito';
    resetBillingEnvCache();

    expect(billingDriver()).toBe('mercadopago');
    expect(mpWebhookSecret()).toBe('secreto-de-webhook-larguito');
    expect(billingReady()).toBe(true);
  });

  it('en Production el mock no puede pasar como si hubiera cobros habilitados', () => {
    process.env['VERCEL_ENV'] = 'production';
    process.env['BILLING_DRIVER'] = 'mock';
    resetBillingEnvCache();

    expect(() => billingDriver()).toThrow(/BILLING_DRIVER.*mercadopago.*producción/iu);
    expect(billingReady()).toBe(false);
  });

  it('en Production el driver real completo sí queda disponible', () => {
    process.env['VERCEL_ENV'] = 'production';
    process.env['BILLING_DRIVER'] = 'mercadopago';
    process.env['MP_ACCESS_TOKEN'] = 'token-de-mercadopago-larguito';
    process.env['MP_WEBHOOK_SECRET'] = 'secreto-de-webhook-larguito';
    resetBillingEnvCache();

    expect(billingDriver()).toBe('mercadopago');
    expect(billingReady()).toBe(true);
  });

  it('un driver que no existe no cae al mock: rompe', () => {
    process.env['BILLING_DRIVER'] = 'stripe';
    resetBillingEnvCache();
    expect(() => billingDriver()).toThrow(/BILLING_DRIVER/u);
  });

  it('un token truncado se rechaza en vez de rebotar contra la API de MP en producción', () => {
    process.env['MP_ACCESS_TOKEN'] = 'corto';
    resetBillingEnvCache();
    expect(() => billingDriver()).toThrow(/MP_ACCESS_TOKEN/u);
  });
});

describe('nada de esto llega al browser', () => {
  it('ninguna variable de billing es NEXT_PUBLIC_*', () => {
    // `MP_ACCESS_TOKEN` en el bundle es rechazo automático (CLAUDE.md §2). El módulo es
    // `server-only`, pero el prefijo es lo que decide qué inlinea Next: se afirma el prefijo.
    for (const clave of CLAVES) {
      expect(clave.startsWith('NEXT_PUBLIC_')).toBe(false);
    }
  });
});
