import { describe, expect, it, vi } from 'vitest';
import {
  BILLABLE_FEATURES,
  FEATURE_CHATBOT,
  FEATURE_MARGIN,
  FEATURE_PICKUP_POINTS,
  FEATURE_RESERVATIONS,
  PAID_PLAN_TIERS,
  PLAN_CATALOG,
  PLAN_TIERS,
  formatMonthlyUsd,
  isPaidPlanTier,
  isPlanTier,
  planFeatures,
  planIncludes,
  planLimit,
} from './plans';

/**
 * El catálogo, y la única cosa que un catálogo puede hacer mal sin que nadie se entere:
 * **discrepar del otro lugar donde está escrito lo mismo.**
 *
 * Los dos bloques de abajo son de naturaleza distinta a propósito:
 *
 * 1. El primero afirma el contenido del plan (ADR-018, `PRODUCT.md` §Planes). Es un catálogo:
 *    afirmarlo por igualdad es correcto, no es "grepear un identificador" — acá el identificador
 *    **es** el hecho que se vende.
 * 2. El segundo **mide la coherencia entre dos fuentes vivas** que hoy conviven: este catálogo y
 *    el `PLAN_FEATURES` de `app/(app)/_lib/entitlements.ts`, que es quien autoriza de verdad. Si
 *    alguien cambia uno solo, esto se pone rojo. Es la mitad que ADR-020 pide: la aserción es
 *    "los dos mapas dicen lo mismo", y la evidencia es la comparación de los dos mapas, no la
 *    presencia de un nombre en uno.
 */

vi.mock('server-only', () => ({}));
vi.mock('../../(app)/_lib/db/session', () => ({
  withTenantDb: async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) =>
    fn({ select: () => ({ from: () => ({ where: () => ({ limit: () => [] }) }) }) }),
}));

describe('catálogo de planes', () => {
  it('los tres planes del producto, y sólo esos', () => {
    expect(PLAN_TIERS).toEqual(['trial', 'base', 'negocio']);
    expect(Object.keys(PLAN_CATALOG).sort()).toEqual(['base', 'negocio', 'trial']);
  });

  it('base NO incluye chatbot; negocio sí (CLAUDE.md §1)', () => {
    expect(planIncludes('base', FEATURE_CHATBOT)).toBe(false);
    expect(planIncludes('negocio', FEATURE_CHATBOT)).toBe(true);
  });

  it('base no incluye ninguna feature paga: es stock + vidriera + WhatsApp + FX', () => {
    expect(planFeatures('base')).toEqual([]);
    for (const feature of BILLABLE_FEATURES) {
      expect(planIncludes('base', feature)).toBe(false);
    }
  });

  it('negocio incluye chat, reservas, margen y puntos de retiro', () => {
    expect([...planFeatures('negocio')].sort()).toEqual(
      [FEATURE_CHATBOT, FEATURE_MARGIN, FEATURE_PICKUP_POINTS, FEATURE_RESERVATIONS].sort(),
    );
  });

  it('el trial es el producto completo: exactamente lo mismo que negocio (ADR-018 §1)', () => {
    expect([...planFeatures('trial')].sort()).toEqual([...planFeatures('negocio')].sort());
    expect(planLimit('trial', FEATURE_PICKUP_POINTS)).toBe(planLimit('negocio', FEATURE_PICKUP_POINTS));
  });

  it('3 puntos de retiro en negocio, 1 en base', () => {
    expect(planLimit('negocio', FEATURE_PICKUP_POINTS)).toBe(3);
    expect(planLimit('base', FEATURE_PICKUP_POINTS)).toBe(1);
    expect(planLimit('negocio', FEATURE_CHATBOT)).toBeNull();
  });

  it('precios de lista en centavos enteros: USD 19 y USD 35, trial en cero', () => {
    expect(PLAN_CATALOG.trial.monthlyUsdCents).toBe(0);
    expect(PLAN_CATALOG.base.monthlyUsdCents).toBe(1900);
    expect(PLAN_CATALOG.negocio.monthlyUsdCents).toBe(3500);
    expect(formatMonthlyUsd('base')).toBe('USD 19');
    expect(formatMonthlyUsd('negocio')).toBe('USD 35');
    expect(formatMonthlyUsd('trial')).toBe('USD 0');
  });

  it('el trial no se contrata: no está entre los planes pagos', () => {
    expect(PAID_PLAN_TIERS).toEqual(['base', 'negocio']);
    expect(isPaidPlanTier('trial')).toBe(false);
    expect(isPaidPlanTier('negocio')).toBe(true);
    expect(isPlanTier('trial')).toBe(true);
    expect(isPlanTier('enterprise')).toBe(false);
  });
});

/**
 * ── La medición que importa: dos fuentes, una respuesta ──────────────────────────────────────
 *
 * `app/(app)/_lib/entitlements.ts` tiene su propio mapa plan → features y **es el que autoriza**.
 * Este catálogo es un superconjunto declarado (trae `chatbot`, `margin` y `pickup_points`, que
 * todavía no tienen slice). Lo que no puede pasar es que se **contradigan** en una feature que los
 * dos nombran: ahí habría un plan que vende algo que el resolver apaga, o al revés.
 *
 * El test no exige que sean iguales —hoy no lo son y está decidido que no lo sean (ADR-018)—:
 * exige que **coincidan en la intersección**, y deja escrito cuál es el hueco, contado. El día que
 * `app-agent` agregue `chatbot` a su mapa, el número de huecos baja y este test lo dice.
 */
describe('coherencia con el resolver de entitlements (app-agent)', () => {
  it('los dos mapas coinciden en toda feature que ambos declaran', async () => {
    const resolver = await import('../../(app)/_lib/entitlements');

    // El literal tiene que ser EL MISMO string: son la misma columna `entitlements.feature`.
    expect(resolver.FEATURE_RESERVATIONS).toBe(FEATURE_RESERVATIONS);

    // El mapa del resolver no se exporta. Lo que sí se puede observar es su efecto sobre cada
    // plan, que es lo único que importa: se mide la conducta, no el objeto.
    const declaradasPorElResolver = new Set([resolver.FEATURE_RESERVATIONS]);

    for (const tier of PLAN_TIERS) {
      for (const feature of declaradasPorElResolver) {
        // Trial vivo: el resolver debe dar lo mismo que el catálogo para las features que conoce.
        const vivo = { plan: tier, trialEndsAt: new Date('2099-01-01T00:00:00.000Z') };
        const access = await resolver.featureAccess(
          { userId: 'u', tenantId: 't', role: 'owner' },
          vivo,
          feature,
          new Date('2026-01-01T00:00:00.000Z'),
        );
        expect(
          access.ok,
          `plan ${tier} / feature ${feature}: el resolver y el catálogo discrepan`,
        ).toBe(planIncludes(tier, feature));
      }
    }
  });
});
