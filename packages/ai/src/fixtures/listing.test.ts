/**
 * **El fixture del peor caso, afirmando sobre sí mismo.**
 *
 * `businessPlanListingFixture()` es la ficha de la que sale el número publicado del p95 y de la
 * degradación. No es una ficha patológica: es exactamente la que el plan Negocio vende — 3 puntos
 * de retiro, 6 medios de pago, descripción en su presupuesto entero (`CLAUDE.md` §1).
 *
 * El riesgo que este archivo cubre no es que el fixture esté mal hoy. Es que **se ablande mañana**
 * sin que nadie lo note: alguien acorta un horario, saca un medio de pago, recorta la descripción
 * "que era muy larga", y el peor caso deja de ser el peor caso. El corpus sigue verde, el p95 baja,
 * y el número publicado pasa a describir una ficha que ningún cliente tiene. Un fixture que sostiene
 * un número publicado necesita un test como cualquier otra afirmación medida.
 */

import { describe, expect, it } from 'vitest';
import {
  DESCRIPCION_AL_TOPE,
  NEGOCIO_FIXTURE_CLAIMS,
  NEGOCIO_PAYMENT_METHODS,
  NEGOCIO_PICKUP_POINTS,
  businessPlanListingFixture,
} from './listing';
import { DESCRIPTION_TOKEN_BUDGET, MAX_PAYMENT_METHODS, MAX_PICKUP_POINTS, listingPromptView } from '../listing-view';
import { countTokens } from '../tokens';

describe('la ficha del plan Negocio satura los topes que el plan vende', () => {
  const listing = businessPlanListingFixture();

  it('trae los 3 puntos de retiro que el plan Negocio ofrece, ni uno menos', () => {
    expect(listing.pickup).toHaveLength(MAX_PICKUP_POINTS);
    expect(NEGOCIO_FIXTURE_CLAIMS.pickupPoints).toBe(MAX_PICKUP_POINTS);
  });

  it('trae los 6 medios de pago del tope: un local del Alto Valle llega sin esforzarse', () => {
    expect(listing.paymentMethods).toHaveLength(MAX_PAYMENT_METHODS);
    expect(NEGOCIO_FIXTURE_CLAIMS.paymentMethods).toBe(MAX_PAYMENT_METHODS);
  });

  it('la descripción llena su presupuesto: si se acorta, el peor caso deja de serlo', () => {
    // El presupuesto es el techo del recorte de `listing-view.ts`. La descripción cruda mide MÁS
    // que eso a propósito: así la vista la recorta y el bloque queda exactamente en el tope.
    expect(countTokens(DESCRIPCION_AL_TOPE)).toBeGreaterThanOrEqual(DESCRIPTION_TOKEN_BUDGET);
    expect(NEGOCIO_FIXTURE_CLAIMS.measuredDescriptionTokens).toBe(countTokens(DESCRIPCION_AL_TOPE));
    const view = listingPromptView(listing);
    expect(view.description).not.toBeNull();
    expect(countTokens(view.description ?? '')).toBe(DESCRIPTION_TOKEN_BUDGET);
  });

  it('los horarios y los medios tienen largo HUMANO, no un placeholder de tres letras', () => {
    // El costo del bloque no lo hace la cantidad de filas, lo hace el texto adentro. Un fixture con
    // `'ef'` y `'L-V'` tendría los mismos 3+6 y mediría la mitad — o sea, mentiría por omisión.
    for (const point of NEGOCIO_PICKUP_POINTS) {
      expect(point.hours?.length ?? 0).toBeGreaterThan(20);
      expect(point.name.length).toBeGreaterThan(6);
    }
    for (const method of NEGOCIO_PAYMENT_METHODS) expect(method.length).toBeGreaterThan(5);
  });

  it('el tercer punto de retiro es el que la eval exige en el prompt: General Roca', () => {
    // `cases.eval.ts` afirma `promptMustContain: ['General Roca']`. Si acá se renombra, allá el
    // caso se pone rojo con un mensaje que no explica nada, así que el vínculo se escribe.
    expect(listing.pickup.map((point) => point.name)).toContain('General Roca');
  });
});
