/**
 * PROBE DEL LEAD PARA S6 — el scheduler gratuito tiene que llegar al handler real.
 *
 * Vercel Hobby rechaza una agenda de cada cinco minutos, así que la ejecución programada vive en Inngest. Esta
 * probe cruza el trigger, el endpoint `serve` de Next y `proxy.ts`: un path mal escrito, una
 * exportación incompleta o un rewrite que lo mande a una vidriera deja las reservas sin vencer
 * aunque el deployment figure verde.
 *
 * La puerta HTTP manual `/api/cron/expire-reservations` conserva su propia probe de fail-closed;
 * no se elimina porque sigue siendo una vía operativa útil y tiene que permanecer protegida.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { proxy } from '../../apps/web/proxy';

const RAIZ = resolve(__dirname, '../..');
const ROUTE = resolve(RAIZ, 'apps/web/app/api/inngest/route.ts');
const FUNCTIONS = resolve(RAIZ, 'apps/web/inngest/functions.ts');
const PACKAGE = resolve(RAIZ, 'apps/web/package.json');

const HOSTS_POSIBLES = [
  'istock-software.vercel.app',
  'istock-software-maatwork.vercel.app',
  'maat.work',
  'www.maat.work',
] as const;

describe('S6 · Inngest llega al handler del scheduler', () => {
  it('el route de Inngest existe, sirve los tres verbos y fija el timeout recomendado', () => {
    expect(existsSync(ROUTE), `falta ${ROUTE}; Inngest no tiene endpoint para sincronizar`).toBe(true);

    const source = readFileSync(ROUTE, 'utf8');
    expect(source).toMatch(/from\s+['"]inngest\/next['"]/);
    expect(source).toMatch(/export\s+const\s+maxDuration\s*=\s*300/);
    expect(source).toMatch(/export\s+const\s+\{\s*GET\s*,\s*POST\s*,\s*PUT\s*\}\s*=\s*serve\s*\(/);
  });

  it('el trigger es estable, cada cinco minutos y pertenece a la app iStock', () => {
    expect(existsSync(FUNCTIONS), `falta ${FUNCTIONS}; el endpoint serviría cero funciones`).toBe(true);

    const source = readFileSync(FUNCTIONS, 'utf8');
    expect(source).toMatch(/new\s+Inngest\s*\(\s*\{[^}]*id\s*:\s*['"]istock['"]/s);
    expect(source).toMatch(/id\s*:\s*['"][^'"]*expire-reservations[^'"]*['"]/);
    expect(source).toMatch(/triggers\s*:\s*\[\s*cron\s*\(\s*['"]\*\/5 \* \* \* \*['"]\s*\)/);

    const pkg = JSON.parse(readFileSync(PACKAGE, 'utf8')) as {
      dependencies?: Record<string, unknown>;
    };
    expect(pkg.dependencies?.inngest, 'apps/web no declara el SDK que compila el endpoint').toBeTruthy();
  });

  it('vercel.json no declara un cron incompatible con Hobby ni otra configuración', () => {
    const raw = JSON.parse(readFileSync(resolve(RAIZ, 'vercel.json'), 'utf8')) as Record<string, unknown>;
    expect(Object.keys(raw).sort()).toEqual(['$schema']);
    expect(raw.crons).toBeUndefined();
  });

  it('el proxy deja pasar /api/inngest desde cualquier host que pueda recibir el callback', () => {
    for (const host of HOSTS_POSIBLES) {
      const path = '/api/inngest';
      const res = proxy(new NextRequest(new URL(path, `https://${host}`), { headers: { host } }));

      expect(
        res.status < 300,
        `${host}${path} devuelve ${String(res.status)}; un callback redirigido nunca llega a serve`,
      ).toBe(true);
      expect(
        res.headers.get('x-middleware-rewrite'),
        `${host}${path} se reescribe como vidriera y no como endpoint global`,
      ).toBeNull();
      expect(res.headers.get('x-middleware-next'), `${host}${path} no sale como passthrough`).not.toBeNull();
    }
  });
});
