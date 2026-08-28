/**
 * **El badge honesto.** `CLAUDE.md`: *"`reserved` **nunca** se muestra como disponible"*.
 *
 * Es la regla más barata de romper de todo el producto y la más cara de tener rota: alguien cruza
 * Cipolletti para buscar un equipo que ya tiene seña. Por eso el test no se conforma con "el label
 * de `reserved` es 'Reservado'" —eso lo cumple cualquier tabla— sino que afirma la propiedad
 * **negativa** sobre todos los textos que el badge produce para un estado que no es `available`.
 */

import { describe, expect, it } from 'vitest';
import { PUBLIC_STATUSES } from '@istock/domain';
import { STATUS_TONE_CLASS, statusBadge } from './status';

describe('statusBadge', () => {
  it('cubre TODOS los estados públicos del dominio', () => {
    for (const status of PUBLIC_STATUSES) {
      const badge = statusBadge(status);
      expect(badge.label.length).toBeGreaterThan(0);
      expect(badge.ctaLabel.length).toBeGreaterThan(0);
      expect(STATUS_TONE_CLASS[badge.tone]).toBeTypeOf('string');
    }
  });

  it('ningún estado que no sea `available` dice "disponible" en NINGÚN texto', () => {
    for (const status of PUBLIC_STATUSES) {
      if (status === 'available') continue;
      const badge = statusBadge(status);
      const todo = `${badge.label} ${badge.detail} ${badge.ctaLabel}`.toLowerCase();
      expect(todo).not.toContain('disponible');
      expect(todo).not.toContain('en stock');
    }
  });

  it('`reserved` se llama Reservado y explica qué significa', () => {
    const badge = statusBadge('reserved');
    expect(badge.label).toBe('Reservado');
    expect(badge.tone).toBe('reserved');
    expect(badge.detail.length).toBeGreaterThan(0);
  });

  it('`sold` se llama Vendido y no invita a comprar ESE equipo', () => {
    const badge = statusBadge('sold');
    expect(badge.label).toBe('Vendido');
    expect(badge.tone).toBe('sold');
    // Sigue habiendo botón: `buildWaMessage` tiene un mensaje propio para vendido ("¿te queda
    // alguno parecido?"). Lo que no puede hacer el CTA es prometer este equipo.
    expect(badge.ctaLabel.toLowerCase()).not.toContain('lo quiero');
  });

  it('cada estado tiene un tono distinto: el color no puede empatar dos significados', () => {
    const tones = PUBLIC_STATUSES.map((status) => statusBadge(status).tone);
    expect(new Set(tones).size).toBe(PUBLIC_STATUSES.length);
  });
});
