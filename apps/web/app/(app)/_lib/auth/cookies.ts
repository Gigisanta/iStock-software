import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { z } from 'zod';
import { serverEnv } from '../env';

/**
 * Cookie de sesión del **driver local**. No la usa el driver de Supabase (ahí la maneja
 * `@supabase/ssr` con sus propias cookies `sb-*`).
 *
 * Recordatorio que vale para todo el repo, no sólo para este archivo: `apps/web/app/layout.tsx`
 * dice que un solo `set-cookie` server-side en `(storefront)` apaga el cache del CDN entero y
 * manda el 100% de los pageviews a Postgres. Estas cookies se escriben **únicamente** desde
 * Server Actions y Route Handlers de `(app)`/`api`, nunca desde un layout ni desde una página.
 */

const COOKIE_NAME = 'istock_local_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

/**
 * Sólo el `userId` viaja en la cookie. **El tenant no.** Si el tenant viajara acá, cambiar de
 * tenant sería editar una cookie; y aunque va firmada, dejaría el aislamiento colgando de la
 * firma en vez de colgado de `memberships` + RLS, que es donde `ARCHITECTURE.md` lo puso.
 */
const payloadSchema = z.object({
  userId: z.uuid(),
  issuedAt: z.number().int().positive(),
});

type SessionPayload = z.infer<typeof payloadSchema>;

function secret(): string {
  const env = serverEnv();
  if (env.AUTH_LOCAL_SECRET !== undefined) return env.AUTH_LOCAL_SECRET;
  // Sin secreto configurado sólo se llega acá en dev (`assertLocalDriverAllowed` ya cortó prod).
  return 'istock-dev-only-secret-do-not-use-in-prod';
}

function sign(body: string): string {
  return createHmac('sha256', secret()).update(body).digest('base64url');
}

function verify(body: string, signature: string): boolean {
  const expected = Buffer.from(sign(body), 'utf8');
  const given = Buffer.from(signature, 'utf8');
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

export async function writeSessionCookie(payload: SessionPayload): Promise<void> {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const store = await cookies();
  store.set(COOKIE_NAME, `${body}.${sign(body)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: serverEnv().NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

/**
 * Lee el valor crudo de la cookie **desde el header `cookie`**, no desde `cookies()`.
 *
 * No es preferencia de estilo: `cookies()` revienta al leerse durante el **re-render posterior a
 * una Server Action** que devuelve estado en vez de redirigir. Reproducido en Next 16.3.3 contra
 * `POST /ingresar` y `POST /app/crear-negocio` con un formulario sin JavaScript:
 *
 *   `InvariantError: Received an underlying cookies object that does not match either
 *    'cookies' or 'mutableCookies'. This is a bug in Next.js.`
 *
 * Causa, leída en `node_modules/next/dist/server/request/cookies.js`: en la fase de acción las
 * cookies son mutables, así que `cookies()` resuelve a `workUnitStore.userspaceMutableCookies`;
 * `makeUntrackedCookiesWithDevWarnings()` sólo acepta `requestStore.cookies` o
 * `requestStore.mutableCookies`, y tira el invariante con cualquier otro. Ese camino está adentro
 * de `if (process.env.NODE_ENV === 'development')`, o sea que **el bug es sólo de `next dev`**
 * (en producción la misma rama devuelve la promesa de lectura sin tirar).
 *
 * Consecuencia real, y por eso se arregla en vez de anotarse: el `<form>` del panel tiene que
 * andar **sin JavaScript** —celular con mala señal, parado en el local— y en dev ese camino
 * devolvía el subárbol roto en cada error de validación. También rompería los e2e de `qa-agent`
 * si corren contra `next dev`.
 *
 * `headers()` no tiene fase mutable y la doc de Next lo define como lectura de la request. La
 * única diferencia semántica: no ve una cookie escrita en **este mismo** request. No aplica —
 * `writeSessionCookie()` siempre termina en `redirect()`, así que nadie lee después de escribir.
 */
async function readRawSessionCookie(): Promise<string | undefined> {
  const header = (await headers()).get('cookie');
  if (header === null) return undefined;

  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    if (part.slice(0, eq).trim() !== COOKIE_NAME) continue;

    const value = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return undefined;
}

export async function readSessionCookie(): Promise<SessionPayload | null> {
  const raw = await readRawSessionCookie();
  if (raw === undefined) return null;

  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;

  const body = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  if (!verify(body, signature)) return null;

  try {
    const json: unknown = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    const parsed = payloadSchema.safeParse(json);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}
