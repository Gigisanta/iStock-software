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
        R2_BUCKET_MEDIA: 'istock-todo',
        R2_BUCKET_ORIGINALS: 'istock-todo',
      }),
    ).toThrow(MediaConfigError);
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
