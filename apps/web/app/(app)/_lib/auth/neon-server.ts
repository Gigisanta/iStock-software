import 'server-only';

import { createNeonAuth, type NeonAuth } from '@neondatabase/auth/next/server';
import { z } from 'zod';
import { serverEnv } from '../env';

let auth: NeonAuth | undefined;

export function neonAuth(): NeonAuth {
  if (auth !== undefined) return auth;

  const env = serverEnv();
  const baseUrl = env.NEON_AUTH_BASE_URL?.trim() ?? '';
  const cookieSecret = env.NEON_AUTH_COOKIE_SECRET?.trim() ?? '';
  if (!z.url().safeParse(baseUrl).success || cookieSecret.length < 32) {
    throw new Error('Falta configurar Neon Auth: NEON_AUTH_BASE_URL y NEON_AUTH_COOKIE_SECRET.');
  }

  auth = createNeonAuth({
    baseUrl,
    cookies: { secret: cookieSecret, sessionDataTtl: 300 },
    logLevel: 'silent',
  });
  return auth;
}
