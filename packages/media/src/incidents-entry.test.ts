/**
 * La superficie de `@istock/media/incidents`, export por export.
 *
 * El comportamiento del canal ya está probado en `./incidents.test.ts`; esto prueba lo que es
 * propio del subpath: **que la lista de exports es exactamente la declarada** y que cada uno llega
 * vivo del otro lado. Un subpath cuya superficie crece sin que nadie lo decida vuelve a ser un
 * barrel, y con el barrel vuelve `sharp` al bootstrap.
 */

import { afterEach, describe, expect, it } from 'vitest';
import * as subpath from './incidents-entry';
import type { MediaIncident, MediaIncidentReporter } from './incidents-entry';

const incidente: MediaIncident = {
  code: 'MEDIA_UNSAFE_KEY',
  reason: 'contiene un UUID (tenant_id / listing_id)',
  keyPrefix: 'v1/ab/1111…',
  variant: 'card',
};

afterEach(() => {
  subpath.resetMediaIncidentReporter();
});

describe('la superficie del subpath es cerrada y deliberada', () => {
  it('exporta exactamente estos nombres en runtime', () => {
    expect(Object.keys(subpath).sort()).toEqual([
      'VARIANTS',
      'isVariant',
      'reportMediaIncident',
      'resetMediaIncidentReporter',
      'setMediaIncidentReporter',
    ]);
  });

  it('NO exporta `keyPrefix`: el recorte de `apps/web` es una segunda barrera, no un duplicado a borrar', () => {
    expect(Object.keys(subpath)).not.toContain('keyPrefix');
  });
});

describe('setMediaIncidentReporter', () => {
  it('el reporter enchufado por el subpath recibe los incidentes', () => {
    const vistos: MediaIncident[] = [];
    const reporter: MediaIncidentReporter = (i) => vistos.push(i);

    subpath.setMediaIncidentReporter(reporter);
    subpath.reportMediaIncident(incidente);

    expect(vistos).toEqual([incidente]);
  });

  it('es el MISMO estado global que el del barrel: enchufar por acá se ve desde allá', async () => {
    // Si el subpath fuera una copia del módulo, `apps/web` enchufaría un reporter que el camino
    // de render (que importa por el barrel) no usaría nunca. El cableado quedaría en verde y sin
    // efecto: exactamente el gate vacío que ADR-020 persigue.
    const barrel = await import('./index');
    const vistos: MediaIncident[] = [];

    subpath.setMediaIncidentReporter((i) => vistos.push(i));
    barrel.reportMediaIncident(incidente);

    expect(vistos).toEqual([incidente]);
  });

  it('`null` vuelve al reporter por defecto sin romper', () => {
    subpath.setMediaIncidentReporter(null);
    expect(() => subpath.reportMediaIncident(incidente, () => undefined)).not.toThrow();
  });
});

describe('resetMediaIncidentReporter', () => {
  it('desenchufa el reporter que se había puesto', () => {
    const vistos: MediaIncident[] = [];
    subpath.setMediaIncidentReporter((i) => vistos.push(i));
    subpath.resetMediaIncidentReporter();

    subpath.reportMediaIncident(incidente, () => undefined);

    expect(vistos).toEqual([]);
  });
});

describe('reportMediaIncident', () => {
  it('un sink roto no propaga: el canal existe para NO tirar en render', () => {
    subpath.setMediaIncidentReporter(() => {
      throw new Error('Sentry caído');
    });
    expect(() => subpath.reportMediaIncident(incidente)).not.toThrow();
  });

  it('la forma del incidente sigue siendo prefijo, nunca la key entera', () => {
    // El subpath re-exporta; no reinterpreta. Se afirma acá porque es la garantía que
    // `CLAUDE.md` §2 pone sobre este canal y ahora tiene una segunda puerta de entrada.
    const recibidos: MediaIncident[] = [];
    subpath.setMediaIncidentReporter((i) => recibidos.push(i));
    subpath.reportMediaIncident(incidente);

    const visto = recibidos[0];
    expect(visto).toBeDefined();
    expect(Object.keys(visto ?? {}).sort()).toEqual(['code', 'keyPrefix', 'reason', 'variant']);
    expect(visto?.keyPrefix).toContain('…');
    expect(visto?.keyPrefix.length).toBeLessThanOrEqual(13);
  });
});

describe('VARIANTS / isVariant viajan con el tipo del incidente', () => {
  it('`VARIANTS` son las tres que se sirven, y el master no es una de ellas', () => {
    expect(subpath.VARIANTS).toEqual(['thumb', 'card', 'detail']);
    expect(subpath.VARIANTS as readonly string[]).not.toContain('master');
  });

  it('`isVariant` acepta la variante de un incidente y rechaza cualquier otra cosa', () => {
    expect(subpath.isVariant('card')).toBe(true);
    expect(subpath.isVariant('master')).toBe(false);
    expect(subpath.isVariant('')).toBe(false);
  });

  it('son la MISMA referencia que las del barrel: no hay dos tablas de variantes', async () => {
    const barrel = await import('./index');
    expect(subpath.VARIANTS).toBe(barrel.VARIANTS);
    expect(subpath.isVariant).toBe(barrel.isVariant);
  });
});
