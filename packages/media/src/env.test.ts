import { describe, expect, it } from 'vitest';
import { parseMediaEnv } from './env';
import { MediaConfigError } from './errors';

describe('env de media', () => {
  it('sin nada configurado, default local (B1 no bloquea)', () => {
    const env = parseMediaEnv({});
    expect(env.MEDIA_DRIVER).toBe('local');
    expect(env.R2_BUCKET_MEDIA).toBe('istock-media');
    expect(env.R2_BUCKET_ORIGINALS).toBe('istock-originals');
  });

  it('MEDIA_DRIVER=r2 exige las tres credenciales', () => {
    expect(() => parseMediaEnv({ MEDIA_DRIVER: 'r2' })).toThrow(MediaConfigError);
    expect(() =>
      parseMediaEnv({
        MEDIA_DRIVER: 'r2',
        R2_ACCOUNT_ID: 'acc',
        R2_ACCESS_KEY_ID: 'ak',
        R2_SECRET_ACCESS_KEY: 'sk',
        NEXT_PUBLIC_MEDIA_BASE_URL: 'https://img.maat.work',
      }),
    ).not.toThrow();
  });

  it('rechaza un solo bucket: el master en el bucket público es descargable', () => {
    expect(() =>
      parseMediaEnv({
        MEDIA_DRIVER: 'r2',
        R2_ACCOUNT_ID: 'acc',
        R2_ACCESS_KEY_ID: 'ak',
        R2_SECRET_ACCESS_KEY: 'sk',
        NEXT_PUBLIC_MEDIA_BASE_URL: 'https://img.maat.work',
        R2_BUCKET_MEDIA: 'istock-todo',
        R2_BUCKET_ORIGINALS: 'istock-todo',
      }),
    ).toThrow(MediaConfigError);
  });

  /**
   * ────────────────────────────────────────────────────────────────────────────────────────────
   *  `NEXT_PUBLIC_MEDIA_BASE_URL` × driver: las dos ramas, incluida la que NO falla.
   * ────────────────────────────────────────────────────────────────────────────────────────────
   * El defecto original era un `.default()`: deployar con `MEDIA_DRIVER=r2` y olvidarse la
   * variable en el dashboard de Vercel no era un error de arranque, y todas las vidrieras
   * servían `<img src="/_media/…">` sin una sola excepción en Sentry.
   *
   * El caso positivo (driver local, sin la variable) está acá a propósito: es el que usan
   * `e2e/playwright.config.ts` y `scripts/accept-s2.sh`. Sin él, el día que alguien haga la
   * variable obligatoria siempre, esto sigue verde y se entera el e2e.
   */
  it('con driver local y sin la variable, parsea y usa el default de dev', () => {
    const env = parseMediaEnv({ MEDIA_DRIVER: 'local' });
    expect(env.NEXT_PUBLIC_MEDIA_BASE_URL).toBe('/_media');
  });

  it('con driver local respeta la base que le pasen (el gate S2 apunta a su propio puerto)', () => {
    const env = parseMediaEnv({
      MEDIA_DRIVER: 'local',
      NEXT_PUBLIC_MEDIA_BASE_URL: 'http://127.0.0.1:3210/_media',
    });
    expect(env.NEXT_PUBLIC_MEDIA_BASE_URL).toBe('http://127.0.0.1:3210/_media');
  });

  it('con r2 y las credenciales puestas, sin NEXT_PUBLIC_MEDIA_BASE_URL no arranca', () => {
    expect(() =>
      parseMediaEnv({
        MEDIA_DRIVER: 'r2',
        R2_ACCOUNT_ID: 'acc',
        R2_ACCESS_KEY_ID: 'ak',
        R2_SECRET_ACCESS_KEY: 'sk',
      }),
    ).toThrow(MediaConfigError);
  });

  it('el error de la base ausente le dice al operador qué setear y dónde', () => {
    let message = '';
    try {
      parseMediaEnv({
        MEDIA_DRIVER: 'r2',
        R2_ACCOUNT_ID: 'acc',
        R2_ACCESS_KEY_ID: 'ak',
        R2_SECRET_ACCESS_KEY: 'sk',
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    // Nombre de la variable, valor de ejemplo, dónde se setea y que hay que redeployar.
    expect(message).toContain('NEXT_PUBLIC_MEDIA_BASE_URL');
    expect(message).toContain('https://img.maat.work');
    expect(message).toContain('Vercel');
    expect(message).toContain('deployar');
    expect(message).not.toContain('Invalid input');
  });

  it('MEDIA_DRIVER=r2 con la base seteada arranca', () => {
    const env = parseMediaEnv({
      MEDIA_DRIVER: 'r2',
      R2_ACCOUNT_ID: 'acc',
      R2_ACCESS_KEY_ID: 'ak',
      R2_SECRET_ACCESS_KEY: 'sk',
      NEXT_PUBLIC_MEDIA_BASE_URL: 'https://img.maat.work',
    });
    expect(env.NEXT_PUBLIC_MEDIA_BASE_URL).toBe('https://img.maat.work');
  });

  it('con r2, una base vacía o en blanco es lo mismo que no setearla', () => {
    for (const value of ['', '   ']) {
      expect(() =>
        parseMediaEnv({
          MEDIA_DRIVER: 'r2',
          R2_ACCOUNT_ID: 'acc',
          R2_ACCESS_KEY_ID: 'ak',
          R2_SECRET_ACCESS_KEY: 'sk',
          NEXT_PUBLIC_MEDIA_BASE_URL: value,
        }),
      ).toThrow(MediaConfigError);
    }
  });

  /**
   * ────────────────────────────────────────────────────────────────────────────────────────────
   *  Driver × `VERCEL_ENV`: en producción es `r2` o no arranca (requisito de COSTO).
   * ────────────────────────────────────────────────────────────────────────────────────────────
   * El driver local en producción sirve las fotos por `/_media` de la función de Next: Edge
   * Requests + Fast Origin Transfer, USD 0.033/tenant/mes. Hoy además se rompería sola por el
   * disco efímero de Vercel, pero un `ENOENT` no le explica a nadie qué pasó.
   *
   * Las ramas positivas (sin `VERCEL_ENV`, y `preview`) son las que usan los e2e, `accept-s2.sh`
   * y cualquier máquina de desarrollo: si esto se pone rojo, se cae la suite entera.
   */
  it('sin VERCEL_ENV, el driver local sigue siendo válido (dev, e2e, gate)', () => {
    expect(parseMediaEnv({ MEDIA_DRIVER: 'local' }).MEDIA_DRIVER).toBe('local');
    expect(parseMediaEnv({}).MEDIA_DRIVER).toBe('local');
  });

  it('en preview el driver local es válido', () => {
    const env = parseMediaEnv({ VERCEL_ENV: 'preview', MEDIA_DRIVER: 'local' });
    expect(env.MEDIA_DRIVER).toBe('local');
  });

  it('en producción el driver local no arranca', () => {
    expect(() => parseMediaEnv({ VERCEL_ENV: 'production' })).toThrow(MediaConfigError);
    expect(() => parseMediaEnv({ VERCEL_ENV: 'production', MEDIA_DRIVER: 'local' })).toThrow(
      MediaConfigError,
    );
  });

  it('el error del driver en producción nombra la variable, el valor y el costo', () => {
    let message = '';
    try {
      parseMediaEnv({ VERCEL_ENV: 'production', MEDIA_DRIVER: 'local' });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('MEDIA_DRIVER');
    expect(message).toContain('"r2"');
    expect(message).toContain('Vercel');
    expect(message).toContain('USD 0.033');
    expect(message).not.toContain('Invalid input');
  });

  it('en producción, con r2 completo, arranca', () => {
    const env = parseMediaEnv({
      VERCEL_ENV: 'production',
      MEDIA_DRIVER: 'r2',
      R2_ACCOUNT_ID: 'acc',
      R2_ACCESS_KEY_ID: 'ak',
      R2_SECRET_ACCESS_KEY: 'sk',
      NEXT_PUBLIC_MEDIA_BASE_URL: 'https://img.maat.work',
    });
    expect(env.MEDIA_DRIVER).toBe('r2');
    expect(env.NEXT_PUBLIC_MEDIA_BASE_URL).toBe('https://img.maat.work');
  });

  it('rechaza r2.dev como base pública', () => {
    expect(() => parseMediaEnv({ NEXT_PUBLIC_MEDIA_BASE_URL: 'https://pub-x.r2.dev' })).toThrow(
      MediaConfigError,
    );
  });

  it('rechaza una credencial de R2 con prefijo NEXT_PUBLIC_ (secret en el bundle)', () => {
    expect(() => parseMediaEnv({ NEXT_PUBLIC_R2_SECRET_ACCESS_KEY: 'ups' })).toThrow(
      MediaConfigError,
    );
    expect(() => parseMediaEnv({ NEXT_PUBLIC_R2_ACCESS_KEY_ID: 'ups' })).toThrow(MediaConfigError);
  });

  it('rechaza un driver inventado', () => {
    expect(() => parseMediaEnv({ MEDIA_DRIVER: 'supabase-storage' })).toThrow(MediaConfigError);
  });
});
