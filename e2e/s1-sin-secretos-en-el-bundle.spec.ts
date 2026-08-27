/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Seguridad · `CLAUDE.md` §2: *"Secret en el bundle del browser → rechazo"* · §5: *"Nada de
 *  secrets al browser (`NEXT_PUBLIC_*` se audita a mano)"*. Owner: `qa-agent`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `scripts/guard-leaks.sh` (regla 12) chequea el **código fuente**. Esto chequea el **resultado
 * del build**, que es otra cosa: un secreto no llega al browser porque alguien lo escriba en un
 * Client Component, llega porque un módulo de servidor terminó importado desde uno de cliente, o
 * porque alguien renombró una env var a `NEXT_PUBLIC_*` para que "compile". Los dos casos pasan
 * el grep del fuente y aparecen acá.
 *
 * El valor probado es real: `playwright.config.ts` corre el `next build` con `DATABASE_URL` y
 * `AUTH_LOCAL_SECRET` en el entorno. Si el build los inlinea, están en `.next/static` y este test
 * los encuentra. No es un test que pase con la implementación vacía: pasa sólo si el bundle
 * realmente no los tiene.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';
import { expect, test } from '@playwright/test';

/** `.next/static` es lo único que el browser descarga. Lo demás nunca sale del server. */
const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = resolve(HERE, '../apps/web/.next/static');

function clientAssets(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(js|mjs|css|json|map)$/u.test(entry)) out.push(full);
    }
  };
  walk(CLIENT_DIR);
  return out;
}

/** Lo que el build tenía a mano y **no** puede haber copiado al bundle. */
const FORBIDDEN: ReadonlyArray<{ readonly label: string; readonly needle: string }> = [
  { label: 'AUTH_LOCAL_SECRET', needle: process.env['AUTH_LOCAL_SECRET'] ?? 'e2e-local-secret-32-chars-minimum' },
  { label: 'DATABASE_URL', needle: process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/istock_dev' },
  { label: 'string de conexión a Postgres', needle: 'postgresql://' },
  { label: 'string de conexión a Postgres', needle: 'postgres://' },
  { label: 'clave de service_role de Supabase', needle: 'SUPABASE_SERVICE_ROLE_KEY' },
  { label: 'secret de R2', needle: 'R2_SECRET_ACCESS_KEY' },
];

test('ningún secreto del build termina descargándose en el browser', () => {
  const assets = clientAssets();

  // Sin esta afirmación, el test pasaría por vacío el día que cambie la ruta del build.
  expect(
    assets.length,
    `no se encontró ningún asset de cliente en ${CLIENT_DIR}: el test estaría pasando por vacío`,
  ).toBeGreaterThan(5);

  const leaks: string[] = [];
  for (const file of assets) {
    const content = readFileSync(file, 'utf8');
    for (const { label, needle } of FORBIDDEN) {
      if (content.includes(needle)) leaks.push(`${relative(CLIENT_DIR, file)} contiene ${label}`);
    }
  }

  expect(leaks, `secretos en el bundle del browser:\n${leaks.join('\n')}`).toEqual([]);
});
