/**
 * PROBE DEL LEAD PARA S6 — el cron tiene que LLEGAR, y eso no lo prueba ningún test de S6.
 *
 * `app-agent` probó que el handler hace lo correcto **cuando lo llaman**. Esta probe prueba lo
 * anterior: que lo llamen. Son dos cosas distintas y la segunda no tiene dueño natural, porque
 * cruza tres columnas —`vercel.json` (LEAD), `proxy.ts` (storefront-agent) y el route handler
 * (app-agent)— y ninguna de las tres ve el camino entero.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *  Por qué existe: un cron que recibe 3xx completa sin reintentar, y no avisa
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * De la doc de Vercel, verificada el 2026-08-28 (`docs/research/vercel-cron-limits.md`):
 *
 *   > "When a cron-triggered endpoint returns a 3xx redirect status code, the job completes
 *   >  without further requests."
 *
 * O sea: un redirect NO es un fallo para Vercel. La corrida figura completa, no hay reintento
 * —Vercel no reintenta ninguna corrida—, no hay error, no hay log nuestro (el handler nunca corrió)
 * y no hay alerta. El síntoma aparece semanas después, del lado del cliente: "mi equipo sigue
 * reservado". Lo mismo con un 404 por un `path` mal escrito, que además **se factura igual**.
 *
 * Y nuestro caso es exactamente el que puede caer en eso: `proxy.ts` rutea por HOST, y el hostname
 * que golpea el cron está UNVERIFIED (la doc dice "production deployment URL" y ejemplifica con
 * `*.vercel.app`). Hoy no hay redirect porque `resolveHost` manda `*.vercel.app`, el apex y todo
 * host desconocido a `marketing` → passthrough. Eso es correcto **por casualidad para este uso**:
 * se decidió por otro motivo (no romper healthchecks ni dominios apuntados por error) y nada lo
 * ata. Un `redirects[]` en `vercel.json`, o cambiar el host desconocido a 404 —que es una lectura
 * defendible de "no existe una vidriera en este dominio"— apagan el cron sin poner nada en rojo.
 *
 * Esta probe es lo que lo pone en rojo.
 *
 * Vive en `scripts/probes/` (columna del LEAD) y no en `apps/web`: audita a `proxy.ts` y al route
 * handler, o sea a dos writers, y un gate no puede ser del writer que audita.
 */
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { proxy } from '../../apps/web/proxy';

const RAIZ = resolve(__dirname, '../..');

interface Cron {
  readonly path: string;
  readonly schedule: string;
}

function crons(): readonly Cron[] {
  const raw: unknown = JSON.parse(readFileSync(resolve(RAIZ, 'vercel.json'), 'utf8'));
  const lista = (raw as { crons?: unknown }).crons;
  expect(Array.isArray(lista), 'vercel.json no declara `crons`').toBe(true);
  return lista as readonly Cron[];
}

/**
 * Hosts desde los que puede llegar la invocación. Escritos a mano, no derivados de `host.ts`: si se
 * leyeran del código bajo test, cambiar `PASSTHROUGH_SUFFIXES` movería el gate junto con el bug.
 *
 * Los dos primeros son la forma real de la "production deployment URL" de Vercel (con y sin sufijo
 * de equipo). El apex y `www` están porque un dominio de producción asignado al proyecto también
 * puede ser el que el cron golpee, y ese es el caso donde `proxy.ts` tiene más para romper.
 */
const HOSTS_POSIBLES = [
  'istock-software.vercel.app',
  'istock-software-maatwork.vercel.app',
  'maat.work',
  'www.maat.work',
] as const;

describe('S6 · el cron llega al handler', () => {
  it('todo `path` de vercel.json es un route handler que existe y exporta GET', () => {
    for (const { path } of crons()) {
      const archivo = resolve(RAIZ, 'apps/web/app', `.${path}`, 'route.ts');
      expect(
        existsSync(archivo),
        `vercel.json agenda ${path}, que no tiene handler en ${archivo}. Un path con typo NO ` +
          'falla el deploy: Vercel invoca, recibe 404, marca la corrida completa y la factura. ' +
          'El trabajo no se hace y nada se pone rojo.',
      ).toBe(true);

      const fuente = readFileSync(archivo, 'utf8');
      expect(
        /export\s+(async\s+)?function\s+GET\b/.test(fuente),
        `${path} existe pero no exporta GET. Vercel Cron hace un HTTP GET (doc verificada, ` +
          'ver docs/research/vercel-cron-limits.md); cualquier otro verbo lo contesta Next con ' +
          '405 sin entrar al handler, y 405 tampoco es un fallo para el cron.',
      ).toBe(true);
    }
  });

  it('el proxy deja pasar el path del cron desde cualquier host plausible: ni 3xx, ni 404, ni rewrite', () => {
    for (const { path } of crons()) {
      for (const host of HOSTS_POSIBLES) {
        const res = proxy(new NextRequest(new URL(path, `https://${host}`), { headers: { host } }));

        expect(
          res.status < 300,
          `${host}${path} devuelve ${String(res.status)}. Si es 3xx, el cron completa sin ` +
            'reintentar y las reservas no vencen NUNCA, en silencio. Si es 4xx, el handler no ' +
            'corre. Las dos fallas son mudas: no hay log, porque el log lo escribe el handler.',
        ).toBe(true);

        expect(
          res.headers.get('x-middleware-rewrite'),
          `${host}${path} está siendo REESCRITO por el proxy. El path del cron es global al ` +
            'deploy, no de la vidriera de ningún slug: reescribirlo lo manda a una ruta que no ' +
            'existe y el cron come 404.',
        ).toBeNull();

        expect(
          res.headers.get('x-middleware-next'),
          `${host}${path} no sale del proxy como passthrough.`,
        ).not.toBeNull();
      }
    }
  });

  it('el schedule respeta los límites reales del plan Pro', () => {
    const lista = crons();
    expect(lista.length, 'el schema oficial tipa `crons` con maxItems 100').toBeLessThanOrEqual(100);

    for (const { schedule, path } of lista) {
      // `minLength: 9` en el schema oficial; `* * * * *` (9 chars) es el mínimo y Pro lo permite.
      expect(schedule.length, `${path}: schedule más corto que el mínimo del schema`).toBeGreaterThanOrEqual(9);
      expect(schedule.split(/\s+/), `${path}: un cron de Vercel tiene 5 campos`).toHaveLength(5);
    }
  });

  it('vercel.json no declara nada más que `$schema` y `crons`', () => {
    const raw = JSON.parse(readFileSync(resolve(RAIZ, 'vercel.json'), 'utf8')) as Record<string, unknown>;
    expect(
      Object.keys(raw).sort(),
      'el schema oficial tiene `additionalProperties: false` en la raíz: una clave de más NO se ' +
        'ignora, rompe el deploy. Y `redirects`/`routes` acá son la forma más directa de apagar ' +
        'el cron: un 3xx sobre su path lo mata sin avisar.',
    ).toEqual(['$schema', 'crons']);
  });
});
