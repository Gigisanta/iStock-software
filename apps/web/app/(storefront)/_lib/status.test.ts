/**
 * **El badge honesto.** `CLAUDE.md`: *"`reserved` **nunca** se muestra como disponible"*.
 *
 * Es la regla más barata de romper de todo el producto y la más cara de tener rota: alguien cruza
 * Cipolletti para buscar un equipo que ya tiene seña. Por eso el test no se conforma con "el label
 * de `reserved` es 'Reservado'" —eso lo cumple cualquier tabla— sino que afirma la propiedad
 * **negativa** sobre todos los textos que el badge produce para un estado que no es `available`.
 *
 * ── S6 · la segunda propiedad negativa: el copy no promete nada que no exista ──────────────────
 * El texto viejo de `reserved` decía *«si la reserva se cae, avisamos»* y ofrecía *«Preguntar por
 * WhatsApp si se libera»*. Las dos mitades eran falsas: no hay mecanismo de aviso —la vidriera es
 * anónima, cacheada y no guarda un dato del visitante— y el único botón que vende quedaba
 * convertido en una consulta tibia.
 *
 * Se fija de dos maneras a propósito, porque una sola no alcanza:
 *
 * 1. **Igualdad exacta** del `detail` y del `ctaLabel` de `reserved`. Es la que se pone roja
 *    cuando alguien reescribe el copy sin leer por qué era así, y el mensaje de fallo apunta al
 *    docblock de `status.ts`. Que un texto de producto esté pineado es la intención: cambiarlo
 *    tiene que costar un diff visible, no ser un typo que nadie revisa.
 * 2. **Propiedad estructural** sobre TODOS los estados: ningún texto del badge compromete una
 *    acción futura *nuestra*. Sobrevive a un rewrite legítimo del copy, que es lo que la igualdad
 *    exacta no hace. Ojo con la forma de escribirla: la propiedad prohíbe el verbo, así que una
 *    negación tipo *"no te avisamos"* también da rojo. Es deliberado — la manera de decir que no
 *    hay aviso es nombrar lo que no existe (*"no hay lista de espera"*), no conjugar la promesa
 *    en negativo y esperar que se lea entera en un teléfono al sol.
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

  it('el copy de `reserved` es EXACTAMENTE el que el producto puede sostener', () => {
    const badge = statusBadge('reserved');

    expect(
      badge.detail,
      'cambió el texto de un equipo reservado. Antes de tocarlo, leé el bloque «El copy sólo ' +
        'puede afirmar lo que la vidriera puede sostener» en `_lib/status.ts`: no hay lista de ' +
        'espera, no hay notificación y no se guarda ningún dato del visitante',
    ).toBe(
      'Otra persona lo reservó y una reserva a veces se cae. No hay lista de espera: si lo ' +
        'querés igual, decíselo ahora al vendedor.',
    );

    expect(
      badge.ctaLabel,
      'el único botón `wa.me` de la ficha (`CLAUDE.md` §1) volvió a ser una consulta tibia. ' +
        'Sobre una unidad reservada el CTA no se disculpa: el visitante que igual quiere el ' +
        'equipo tiene que poder decirlo',
    ).toBe('Lo quiero igual — escribir por WhatsApp');
  });

  it('`reserved` mantiene el CTA de comprar, no uno degradado', () => {
    // La versión estructural del pin de arriba: lo que importa no es la frase, es que el botón de
    // un equipo reservado siga expresando la MISMA intención que el de uno disponible. Si algún
    // día el copy cambia, esto tiene que seguir siendo cierto o la regla se perdió.
    const reserved = statusBadge('reserved');
    const available = statusBadge('available');

    expect(
      reserved.ctaLabel.toLowerCase(),
      'el CTA de un equipo reservado dejó de decir que la persona lo quiere: se degradó a ' +
        'preguntar, y una consulta tibia sobre una unidad señada es una conversación que arranca ' +
        'perdida',
    ).toContain('lo quiero');

    expect(
      reserved.ctaLabel,
      'el CTA de reservado quedó idéntico al de disponible: el «igual» es lo que hace honesto al ' +
        'botón sin apagarlo',
    ).not.toBe(available.ctaLabel);
  });

  it('NINGÚN estado promete una acción futura nuestra', () => {
    // `avisamos`, `te escribimos`, `quedás anotado`: cosas que la vidriera no puede hacer porque no
    // tiene dónde guardar al visitante, y que el que queda mal cumpliendo no somos nosotros sino el
    // reseller, en su propio dominio.
    const promesas: readonly RegExp[] = [
      /\bavis(?:amos|aremos|aré|amo)\b/u,
      /\bte\s+avis/u,
      /\bte\s+escrib/u,
      /\bte\s+mand/u,
      /\bte\s+anot/u,
      /\bqued(?:ás|as)\s+anotad/u,
      /\bnotifica(?:mos|remos)\b/u,
      /\bte\s+lo\s+guard/u,
    ];

    for (const status of PUBLIC_STATUSES) {
      const badge = statusBadge(status);
      const todo = `${badge.label} ${badge.detail} ${badge.ctaLabel}`.toLowerCase();
      for (const promesa of promesas) {
        expect(
          promesa.test(todo),
          `el copy de "${status}" promete algo que nadie va a cumplir (${String(promesa)}): ` +
            `${JSON.stringify(todo)}. La vidriera es anónima y cacheada: no hay lista de ` +
            'espera, no hay notificación y no se guarda un solo dato del visitante',
        ).toBe(false);
      }
    }
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
