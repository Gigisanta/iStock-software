/**
 * El canal de incidentes es la mitad del arreglo de "el render no puede tirar": sin él, degradar
 * sería cambiar un problema ruidoso (ficha colgada) por uno invisible (foto que falta y nadie se
 * entera). Estos tests afirman que reporta, que no filtra y que no tira.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  keyPrefix,
  reportMediaIncident,
  resetMediaIncidentReporter,
  setMediaIncidentReporter,
  type MediaIncident,
} from './incidents';

const incidente: MediaIncident = {
  code: 'MEDIA_UNSAFE_KEY',
  reason: 'contiene un UUID (tenant_id / listing_id)',
  keyPrefix: 'v1/ab/1111…',
  variant: 'card',
};

afterEach(() => {
  resetMediaIncidentReporter();
});

describe('reportMediaIncident', () => {
  it('llega al reporter enchufado', () => {
    const vistos: MediaIncident[] = [];
    setMediaIncidentReporter((i) => vistos.push(i));
    reportMediaIncident(incidente);
    expect(vistos).toEqual([incidente]);
  });

  it('el override por llamada gana sobre el global', () => {
    const global: MediaIncident[] = [];
    const local: MediaIncident[] = [];
    setMediaIncidentReporter((i) => global.push(i));
    reportMediaIncident(incidente, (i) => local.push(i));
    expect(local).toHaveLength(1);
    expect(global).toHaveLength(0);
  });

  it('un reporter que tira no propaga: este canal existe para NO tirar', () => {
    setMediaIncidentReporter(() => {
      throw new Error('Sentry caído');
    });
    expect(() => reportMediaIncident(incidente)).not.toThrow();
  });

  it('null vuelve al default sin romper', () => {
    setMediaIncidentReporter(null);
    expect(() => reportMediaIncident(incidente, () => undefined)).not.toThrow();
  });
});

describe('keyPrefix', () => {
  it('trunca: la key entera nunca va a un log (podría ser la del master)', () => {
    const master =
      'originals/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/0123456789abcdef0123456789abcdef.webp';
    const prefijo = keyPrefix(master);
    expect(prefijo).toBe('originals/11…');
    expect(prefijo).not.toContain('1111-4111');
    expect(master).toContain('22222222');
    expect(prefijo).not.toContain('22222222');
  });

  it('no tira con lo que no es un string', () => {
    for (const basura of [undefined, null, 0, {}, []]) {
      expect(keyPrefix(basura)).toBe('');
    }
  });

  it('una key corta se deja entera (no hay nada que esconder en 12 chars)', () => {
    expect(keyPrefix('v1/ab/x.webp')).toBe('v1/ab/x.webp');
  });
});
