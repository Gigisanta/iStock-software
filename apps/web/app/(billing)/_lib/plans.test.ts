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
 * 2. El segundo **maneja el resolver que autoriza de verdad** —`featureAccess()`, de `app-agent`—
 *    y le exige la conducta exacta de este catálogo, plan por plan y feature por feature. Desde el
 *    2026-08-28 ese resolver deriva de `planFeatures()`, así que esto ya no mide un hueco: mide
 *    que la derivación siga existiendo. Es la mitad que ADR-020 pide: la aserción es "el resolver
 *    y el catálogo dicen lo mismo", y la evidencia es haber **corrido** el resolver, no haber
 *    encontrado un nombre en un archivo.
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
 * ── La medición que importa: una sola fuente, y que siga siendo una ──────────────────────────
 *
 * `app/(app)/_lib/entitlements.ts` es quien autoriza, y desde el 2026-08-28 saca el contenido de
 * cada plan de `planFeatures()`, o sea de acá. Este test corre **los tres planes por todas las
 * `BILLABLE_FEATURES`** y exige acuerdo exacto.
 *
 * La versión anterior recorría una sola feature (`reservations`) y contaba el hueco entre dos
 * mapas. El hueco es cero, así que la matriz se ensanchó a lo que el árbol ya permite medir: hoy
 * `chatbot`, `margin` y `pickup_points` también están adentro, y `chatbot` en particular es el que
 * hacía falta — el bug que cerró la derivación era `featureAccess(negocio, 'chatbot') === false`.
 *
 * **Esto se parece al test de `(app)/_lib/entitlements.test.ts`, y la duplicación es deliberada.**
 * No está para cubrir más código: está para que el chequeo no sea propiedad del writer al que
 * audita. Si mañana `app-agent` vuelve a forkear el mapa y se lleva puesta su mitad de la medición,
 * esta queda parada. Es la misma razón por la que un gate no pertenece al código que mide.
 *
 * ── Qué mide exactamente, y qué NO ───────────────────────────────────────────────────────────
 * Ahora que el resolver deriva de este catálogo, los dos lados de la comparación salen del mismo
 * `PLAN_CATALOG` y **el contenido se cancela**: esto NO afirma que Negocio traiga chatbot. Está
 * medido — sacarle `chatbot` a `negocio` en `plans.ts` pone rojos los cuatro tests de contenido
 * (arriba, y `lo que se vende` en `entitlements.test.ts`) y deja este **verde**. Lo que este
 * test afirma es lo otro: que la derivación siga existiendo, que el resolver no vuelva a tener
 * mapa propio, y que el camino completo —fila ausente → catálogo → vigencia— dé `ok` donde el
 * catálogo dice que sí. El contenido lo afirma el primer bloque, por igualdad, y ahí es donde
 * tiene que fallar un cambio de producto no querido. Escrito acá para que nadie lea este bloque
 * como la garantía de que el catálogo es correcto: garantiza que es **uno**.
 *
 * ── No convertir `FEATURE_RESERVATIONS` en un re-export ──────────────────────────────────────
 * El literal está declarado **dos veces**, acá y en el resolver, y la primera línea del test
 * compara las dos declaraciones. Es lo único que ata los dos archivos al mismo valor de la columna
 * `entitlements.feature`, que es `text` y no un enum. Si alguien "limpia" el duplicado
 * re-exportando el de acá, esa línea pasa a compararse consigo misma: queda verde para siempre y
 * deja de medir. **No hay forma de detectarlo en runtime** —dos strings iguales son iguales, se
 * hayan escrito una vez o dos—, así que la propiedad se sostiene con este párrafo y con el
 * comentario de abajo, y no con una aserción.
 */
describe('coherencia con el resolver de entitlements (app-agent)', () => {
  it('los tres planes por TODAS las features facturables: el resolver coincide con el catálogo', async () => {
    const resolver = await import('../../(app)/_lib/entitlements');

    // Dos declaraciones independientes del mismo string, comparadas. NO convertir en re-export:
    // ver el docblock de arriba, esta línea es la única que ata los dos archivos.
    expect(resolver.FEATURE_RESERVATIONS).toBe(FEATURE_RESERVATIONS);

    // El resolver no exporta su tabla —ya no tiene—. Lo que sí se puede observar es su efecto
    // sobre cada plan, que es lo único que importa: se mide la conducta, no el objeto.
    for (const tier of PLAN_TIERS) {
      for (const feature of BILLABLE_FEATURES) {
        // Trial VIVO a propósito: así se compara contra el plan de lista y no contra la vigencia,
        // que es la otra decisión del resolver y no es asunto de un catálogo.
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
