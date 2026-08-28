/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  La polaridad negativa de la medición del RADIO de S6. Owner: `qa-agent`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `e2e/_lib/s6-measure.ts` decide si una reserva costó dos páginas o el catálogo entero. Ese
 * veredicto es el que el gate termina leyendo, y **un veredicto que nunca se vio decir que no, no
 * prueba nada** (`CLAUDE.md` §0).
 *
 * El bug que el gate vino a atrapar —la ficha registrando `storefront:{slug}` y muriendo con la
 * grilla— sólo se puede ver en rojo desde el browser **con el código roto**, que es justo lo que
 * `qa-agent` no hace (`CLAUDE.md` §4). Así que la polaridad negativa se ejercita alimentando la
 * función con la medición del bug: la del catálogo purgado, y también la del "arreglo" que baja el
 * radio a cero **rompiendo la invalidación**, que es la regresión que un test ingenuo aprueba.
 *
 * Corre en `vitest` (3 ms), o sea que entra en `pnpm test` y no en `pnpm e2e`.
 */

import { describe, expect, it } from 'vitest';
import {
  BADGE_DISPONIBLE,
  BADGE_RESERVADO,
  draftPublishMedidoLine,
  draftPublishProblems,
  invalidationRadius,
  invalidationRadiusMedidoLine,
  invalidationRadiusProblems,
  pageWasRerendered,
  rerenderSignal,
  visitsUntilPublished,
  EXPECTED_RADIUS,
  type DraftPublishMeasurement,
  type InvalidationRadiusMeasurement,
  type PageVisit,
} from '../e2e/_lib/s6-measure';

const sobrevive = (label: string): PageVisit => ({
  label,
  role: 'ficha-hermana',
  url: `http://qae2e-radio.127.0.0.1.nip.io:3100/p/${label}`,
  cacheBefore: 'HIT',
  cacheAfter: 'HIT',
  statementsAfter: 0,
  saidBefore: BADGE_DISPONIBLE,
  saysAfter: BADGE_DISPONIBLE,
});

/** El radio tal como tiene que salir: muere la grilla, muere la ficha señada, nadie más. */
const RADIO_SANO: InvalidationRadiusMeasurement = {
  reservedListingId: '11111111-2222-3333-4444-555555555555',
  publishedUnits: 4,
  coldStatements: 7,
  visits: [
    {
      label: 'grilla',
      role: 'grilla',
      url: 'http://qae2e-radio.127.0.0.1.nip.io:3100/',
      cacheBefore: 'HIT',
      cacheAfter: 'MISS',
      statementsAfter: 5,
      saidBefore: BADGE_DISPONIBLE,
      saysAfter: BADGE_RESERVADO,
    },
    {
      label: 'ficha-b',
      role: 'ficha-reservada',
      url: 'http://qae2e-radio.127.0.0.1.nip.io:3100/p/equipo-b',
      cacheBefore: 'HIT',
      cacheAfter: 'MISS',
      statementsAfter: 6,
      saidBefore: BADGE_DISPONIBLE,
      saysAfter: BADGE_RESERVADO,
    },
    sobrevive('ficha-a'),
    sobrevive('ficha-c'),
    sobrevive('ficha-d'),
  ],
};

describe('la señal que distingue una página cacheada de una que se volvió a generar', () => {
  it('cuenta como re-render la ruta que dejó de servirse del cache aunque no toque la base', () => {
    // Es el caso que ningún contador de queries puede ver, y el que produce un arreglo a medias:
    // muere la entrada de la ruta, sobrevive el `'use cache'` de adentro. Cero queries, y la
    // función se invocó igual y se reescribió el ISR.
    const visita: PageVisit = { ...sobrevive('ficha-a'), cacheAfter: 'MISS' };
    expect(pageWasRerendered(visita)).toBe(true);
    expect(rerenderSignal(visita)).toBe('cache=MISS');
  });

  it('cuenta como re-render la página que sirvió del cache pero igual consultó Postgres', () => {
    const visita: PageVisit = { ...sobrevive('ficha-a'), statementsAfter: 3 };
    expect(pageWasRerendered(visita)).toBe(true);
    expect(rerenderSignal(visita)).toBe('db=3');
  });

  it('deja pasar sólo la página que salió entera del cache y no le pegó a la base', () => {
    expect(pageWasRerendered(sobrevive('ficha-a'))).toBe(false);
    expect(rerenderSignal(sobrevive('ficha-a'))).toBe('');
  });
});

describe('el veredicto del radio de la invalidación por unidad', () => {
  it('no reporta ningún problema cuando una reserva costó exactamente dos páginas', () => {
    expect(invalidationRadiusProblems(RADIO_SANO)).toEqual([]);
    expect(invalidationRadius(RADIO_SANO)).toBe(EXPECTED_RADIUS);
  });

  it('rechaza la reserva que además se llevó puesta la ficha de un equipo que no cambió', () => {
    const problemas = invalidationRadiusProblems({
      ...RADIO_SANO,
      visits: RADIO_SANO.visits.map((visita) =>
        visita.label === 'ficha-c' ? { ...visita, cacheAfter: 'MISS' } : visita,
      ),
    });
    expect(problemas.join(' ')).toContain('ficha-c (cache=MISS)');
    expect(problemas.join(' ')).toContain('cold-hit');
  });

  it('rechaza el arreglo que baja el radio a cero porque dejó de invalidar la grilla', () => {
    // La regresión que un test de "no se purgó nada" aprueba: el número mejora y la vidriera le
    // miente al visitante. Por eso el veredicto tiene las dos mitades.
    const problemas = invalidationRadiusProblems({
      ...RADIO_SANO,
      visits: RADIO_SANO.visits.map((visita) =>
        visita.role === 'ficha-hermana'
          ? visita
          : { ...visita, cacheAfter: 'HIT', statementsAfter: 0, saysAfter: BADGE_DISPONIBLE },
      ),
    });
    expect(problemas.join(' ')).toContain('la grilla sobrevivió a la reserva');
    expect(problemas.join(' ')).toContain('dos personas viajan al local');
  });

  it('rechaza la medición en la que el espía de Postgres nunca vio una sentencia', () => {
    // Sin control de que el contador está en el camino, los ceros no son evidencia de nada.
    const problemas = invalidationRadiusProblems({ ...RADIO_SANO, coldStatements: 0 });
    expect(problemas.join(' ')).toContain('no está en el camino');
  });

  it('rechaza la medición de páginas que nunca llegaron a servirse desde el cache', () => {
    const problemas = invalidationRadiusProblems({
      ...RADIO_SANO,
      visits: RADIO_SANO.visits.map((visita) =>
        visita.label === 'ficha-a' ? { ...visita, cacheBefore: 'MISS' } : visita,
      ),
    });
    expect(problemas.join(' ')).toContain('ficha-a');
    expect(problemas.join(' ')).toContain('no puede sobrevivir a una purga');
  });

  it('rechaza el fixture con una sola ficha hermana, que no puede hablar de un radio', () => {
    const problemas = invalidationRadiusProblems({
      ...RADIO_SANO,
      publishedUnits: 2,
      visits: RADIO_SANO.visits.filter(
        (visita) => visita.label !== 'ficha-c' && visita.label !== 'ficha-d',
      ),
    });
    expect(problemas.join(' ')).toContain('un solo dato');
  });

  it('rechaza la reserva que le cambió el contenido a la ficha de otro equipo', () => {
    const problemas = invalidationRadiusProblems({
      ...RADIO_SANO,
      visits: RADIO_SANO.visits.map((visita) =>
        visita.label === 'ficha-d'
          ? { ...visita, cacheAfter: 'MISS', saysAfter: BADGE_RESERVADO }
          : visita,
      ),
    });
    expect(problemas.join(' ')).toContain('le cambió lo que dice la ficha de otro');
  });
});

describe('la línea MEDIDO del radio', () => {
  it('lleva el radio medido y los nombres de las páginas que murieron, no la expectativa', () => {
    const rota: InvalidationRadiusMeasurement = {
      ...RADIO_SANO,
      visits: RADIO_SANO.visits.map((visita) =>
        visita.role === 'ficha-hermana' ? { ...visita, cacheAfter: 'MISS' } : visita,
      ),
    };
    const linea = invalidationRadiusMedidoLine(rota);

    expect(linea.startsWith('MEDIDO s6 radio · ')).toBe(true);
    expect(linea).toContain('rerender=5');
    expect(linea).toContain(`esperado=${String(EXPECTED_RADIUS)}`);
    expect(linea).toContain('ficha-a(cache=MISS)');
    expect(linea).toContain('sobrevivieron=[(ninguna)]');
  });

  it('parte en campos que el parser de sed del gate puede cortar, sin separadores adentro', () => {
    // El formato es un contrato: `sed -nE "s/.*campo=([^·]*).*/\1/p"` corta por ` · `.
    const campos = invalidationRadiusMedidoLine(RADIO_SANO).split(' · ');
    expect(campos).toHaveLength(11);
    for (const campo of campos.slice(1)) {
      expect(campo.includes('·')).toBe(false);
    }
  });
});

const ALTA_SANA: DraftPublishMeasurement = {
  listingId: '99999999-8888-7777-6666-555555555555',
  cacheBefore: 'HIT',
  missWasCached: true,
  statusAfterPublish: 'available',
  sequence: ['ficha'],
};

describe('el veredicto del alta de una unidad sobre su ficha ya cacheada', () => {
  it('aprueba únicamente la publicación que se ve en la primera visita al link', () => {
    expect(draftPublishProblems(ALTA_SANA)).toEqual([]);
    expect(visitsUntilPublished(ALTA_SANA)).toBe(1);
  });

  it('rechaza la publicación que dejó el miss cacheado diciendo que el equipo no está', () => {
    // Es el atajo tentador del arreglo del radio: sacarle `storefront:{slug}` a la ficha entera.
    // El radio baja y el dueño publica un equipo que su propio link declara inexistente.
    const problemas = draftPublishProblems({ ...ALTA_SANA, sequence: ['miss', 'miss', 'miss'] });
    expect(problemas.join(' ')).toContain('no tiró abajo el miss cacheado');
    expect(visitsUntilPublished({ ...ALTA_SANA, sequence: ['miss', 'miss'] })).toBe(0);
  });

  it('rechaza la publicación que el primero en abrir el link igual vio como no publicada', () => {
    const problemas = draftPublishProblems({ ...ALTA_SANA, sequence: ['miss', 'ficha'] });
    expect(problemas.join(' ')).toContain('se come la página vieja');
  });

  it('rechaza la medición en la que el miss nunca estuvo cacheado, porque no prueba la purga', () => {
    const problemas = draftPublishProblems({ ...ALTA_SANA, missWasCached: false, cacheBefore: 'MISS' });
    expect(problemas.join(' ')).toContain('no prueba que publicar la haya invalidado');
  });

  it('rechaza la medición del equipo que nunca llegó a publicarse desde el panel', () => {
    const problemas = draftPublishProblems({ ...ALTA_SANA, statusAfterPublish: 'draft' });
    expect(problemas.join(' ')).toContain('no se publicó nada');
  });

  it('dice en qué visita apareció la ficha, y no la visita en la que esperábamos verla', () => {
    const linea = draftPublishMedidoLine({ ...ALTA_SANA, sequence: ['miss', 'miss', 'ficha'] });
    expect(linea.startsWith('MEDIDO s6 alta-de-unidad · ')).toBe(true);
    expect(linea).toContain('visita_que_la_muestra=3');
    expect(linea).toContain('secuencia=[miss,miss,ficha]');
  });
});
