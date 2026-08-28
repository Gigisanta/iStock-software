/**
 * Hosts y nombres de fixture de los e2e. Un solo lugar. Owner: `qa-agent`.
 *
 * ## Por qué `nip.io` y no `*.localhost`
 * La vidriera **es** un subdominio: probarla contra `localhost/s/{slug}` sería saltear justo el
 * pedazo que puede fallar (el proxy resolviendo el host). `{slug}.127.0.0.1.nip.io` resuelve por
 * DNS público a `127.0.0.1`, funciona igual desde Node y desde el browser, y es el mismo camino
 * que documenta el README de operador para probar el wildcard sin tocar el DNS de `maat.work`
 * (blocker B5). `*.localhost` en macOS resuelve a `::1` y el server escucha en IPv4: el test
 * fallaría por una razón que no tiene nada que ver con el producto.
 */

export const E2E_PORT = Number(process.env['E2E_PORT'] ?? '3100');

/** Apex de desarrollo: marketing + panel. `resolveHost` lo lee como `marketing`. */
export const E2E_APEX_HOST = process.env['E2E_APEX_HOST'] ?? '127.0.0.1.nip.io';

export const APEX_URL = `http://${E2E_APEX_HOST}:${E2E_PORT}`;

/** `acme` → `http://acme.127.0.0.1.nip.io:3100/` */
export function storefrontUrl(slug: string, path = '/'): string {
  return `http://${slug}.${E2E_APEX_HOST}:${E2E_PORT}${path}`;
}

/**
 * Prefijo de TODO lo que los e2e crean en la base. La limpieza borra por este prefijo y por
 * ningún otro criterio: un `delete from tenants` sin filtro en la base de desarrollo de alguien
 * es una forma cara de aprender.
 */
export const FIXTURE_PREFIX = 'qae2e-';

let counter = 0;

/** Slug único y **válido** (`SLUG_RE`): minúsculas, dígitos y guiones, 3–32, sin guión en bordes. */
export function uniqueSlug(tag = 'x'): string {
  counter += 1;
  const stamp = Date.now().toString(36);
  const clean = tag.replace(/[^a-z0-9]/gu, '').slice(0, 6) || 'x';
  return `${FIXTURE_PREFIX}${clean}${stamp}${counter}`;
}

export function uniqueEmail(tag = 'x'): string {
  return `${uniqueSlug(tag)}@qa.local`;
}

/**
 * El secreto con el que el arnés se hace pasar por Vercel Cron. Lo inyecta
 * `playwright.config.ts` en `webServer.env` y lo lee el spec de S6: **la misma constante en las
 * dos puntas**, porque un test que llama a la puerta del cron con un secreto que el server no
 * tiene mide un 401 y no mide el barrido.
 *
 * No es un secreto de producción y no tiene que serlo: es un fixture. Sí tiene que cumplir el
 * schema de `apps/web/app/(app)/_lib/env.ts` (mínimo 24 caracteres) o el server arranca sin
 * secreto y la puerta queda cerrada para todos — que es el comportamiento correcto del producto y
 * el equivocado para el arnés.
 */
export const E2E_CRON_SECRET = process.env['CRON_SECRET'] ?? 'qa-e2e-cron-secret-32-chars-minimum';

/** La URL que Vercel Cron golpea cada 5 minutos, tal como la declara `vercel.json`. */
export const CRON_EXPIRE_URL = `${APEX_URL}/api/cron/expire-reservations`;
