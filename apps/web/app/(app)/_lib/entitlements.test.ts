import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BILLABLE_FEATURES,
  FEATURE_CHATBOT,
  PLAN_TIERS,
  planIncludes,
} from '../../(billing)/_lib/plans';
import type { PlanSnapshot, PlanTier } from './entitlements';

/**
 * El entitlement, con Postgres de mentira.
 *
 * Se prueban las dos decisiones del módulo, en este orden:
 *
 * 1. **La fila de `entitlements` manda; el plan es el default cuando no hay fila.** Al revés, un
 *    tenant al que billing le apagó una feature la seguiría teniendo por ser del plan que sea.
 * 2. **El trial da features mientras está vivo; vencido no da ninguna** (D2 del LEAD, S6). Cada
 *    caso se corre a los dos lados del vencimiento con el mismo `snapshot`, inyectando `now`: si
 *    la vigencia se resolviera con `Date.now()` adentro, esto no se podría escribir.
 *
 * El caso del fallback por plan hace falta que exista: hoy `createTenant()` **no** siembra
 * `entitlements` (se ve en `tenants/create-tenant.ts`: escribe cuatro filas y ninguna es de esa
 * tabla). Sin fallback, todo tenant real nace sin reservas y la slice S6 sería código muerto salvo
 * para el tenant del seed.
 */

vi.mock('server-only', () => ({}));

const db = { rows: [] as { enabled: boolean }[], selects: 0 };

function thenable<T>(produce: () => T): PromiseLike<T> & Record<string, unknown> {
  const builder = {
    from: () => builder,
    where: () => builder,
    limit: () => builder,
    then: (resolve: (value: T) => unknown) => Promise.resolve(produce()).then(resolve),
  };
  return builder as unknown as PromiseLike<T> & Record<string, unknown>;
}

const tx = {
  select: () =>
    thenable(() => {
      db.selects += 1;
      return db.rows;
    }),
};

vi.mock('./db/session', () => ({
  withTenantDb: (_ctx: unknown, fn: (t: unknown) => unknown) => fn(tx),
}));

const { FEATURE_RESERVATIONS, featureAccess, isFeatureEnabled, trialIsAlive } = await import(
  './entitlements'
);

const ctx = { userId: 'user-1', tenantId: 'tenant-1', role: 'owner' } as const;

/** El vencimiento del trial y dos relojes, uno de cada lado. Un minuto alcanza: el borde es `>=`. */
const TRIAL_ENDS = new Date('2026-09-10T12:00:00.000Z');
const BEFORE = new Date('2026-09-10T11:59:00.000Z');
const AFTER = new Date('2026-09-10T12:01:00.000Z');

/** Un plan sin trial: la fecha no se mira, y por eso se pone una vencida a propósito. */
function paid(plan: Exclude<PlanTier, 'trial'>): PlanSnapshot {
  return { plan, trialEndsAt: TRIAL_ENDS };
}

const TRIAL: PlanSnapshot = { plan: 'trial', trialEndsAt: TRIAL_ENDS };

beforeEach(() => {
  db.rows = [];
  db.selects = 0;
});

describe('isFeatureEnabled · la fila de entitlements manda', () => {
  it('una fila en true habilita, sea cual sea el plan', async () => {
    db.rows = [{ enabled: true }];
    await expect(isFeatureEnabled(ctx, paid('base'), FEATURE_RESERVATIONS, AFTER)).resolves.toBe(
      true,
    );
  });

  it('una fila en false apaga, aunque el plan sea negocio', async () => {
    db.rows = [{ enabled: false }];
    await expect(isFeatureEnabled(ctx, paid('negocio'), FEATURE_RESERVATIONS, BEFORE)).resolves.toBe(
      false,
    );
  });

  it('una fila en true sobrevive al trial vencido: es la palanca a mano y tiene precedencia', async () => {
    db.rows = [{ enabled: true }];
    await expect(featureAccess(ctx, TRIAL, FEATURE_RESERVATIONS, AFTER)).resolves.toEqual({
      ok: true,
    });
  });

  /**
   * ── El motivo de la fila apagada es `flag_off`, no `plan` (2026-08-28) ─────────────────────
   *
   * Estas dos aserciones son el enum del defecto que reportó `billing-agent`; el copy que se
   * renderizaba se fija en `listings/publish-listing.test.ts`, que es donde vive el texto. Las dos
   * mitades hacen falta: el bug era de copy, y un test que sólo mire el enum se queda verde el día
   * que alguien vuelva a mapear `flag_off` al mensaje del plan.
   */
  it('la fila apagada dice `flag_off`: el tenant puede TENER el plan que la incluye', async () => {
    db.rows = [{ enabled: false }];
    await expect(
      featureAccess(ctx, paid('negocio'), FEATURE_RESERVATIONS, BEFORE),
    ).resolves.toEqual({ ok: false, reason: 'flag_off' });
  });

  /**
   * Y también cuando el plan tampoco la incluye. Podría argumentarse `plan` acá —las dos cosas son
   * ciertas— pero el veredicto lo produjo la fila: el plan ni se leyó. Contestar con la fuente que
   * no decidió es explicar mal, y además desincroniza el motivo con `hasEntitlement()` de
   * `(billing)`, que resuelve la misma fila en el mismo orden.
   */
  it('la fila apagada gana también sobre un plan que no la incluye: decidió la fila', async () => {
    db.rows = [{ enabled: false }];
    await expect(featureAccess(ctx, paid('base'), FEATURE_RESERVATIONS, BEFORE)).resolves.toEqual({
      ok: false,
      reason: 'flag_off',
    });
  });

  /** Ni `trial_expired`: con fila, la vigencia del trial no llega a evaluarse. */
  it('la fila apagada gana también sobre el trial vencido', async () => {
    db.rows = [{ enabled: false }];
    await expect(featureAccess(ctx, TRIAL, FEATURE_RESERVATIONS, AFTER)).resolves.toEqual({
      ok: false,
      reason: 'flag_off',
    });
  });
});

describe('isFeatureEnabled · sin fila decide el plan', () => {
  it('negocio tiene reservas', async () => {
    await expect(isFeatureEnabled(ctx, paid('negocio'), FEATURE_RESERVATIONS, AFTER)).resolves.toBe(
      true,
    );
  });

  it('base NO tiene reservas', async () => {
    await expect(isFeatureEnabled(ctx, paid('base'), FEATURE_RESERVATIONS, BEFORE)).resolves.toBe(
      false,
    );
  });

  it('una feature que nadie declaró está apagada para los tres planes', async () => {
    for (const plan of ['trial', 'base', 'negocio'] as const) {
      await expect(
        isFeatureEnabled(ctx, { plan, trialEndsAt: TRIAL_ENDS }, 'teletransportacion', BEFORE),
      ).resolves.toBe(false);
    }
  });

  it('a un plan sin la feature el motivo es el plan, no la prueba vencida', async () => {
    await expect(featureAccess(ctx, paid('base'), FEATURE_RESERVATIONS, AFTER)).resolves.toEqual({
      ok: false,
      reason: 'plan',
    });
  });
});

describe('featureAccess · la vigencia del trial (D2)', () => {
  it('el trial vivo tiene reservas: sin esto no se puede probar lo que se paga', async () => {
    await expect(featureAccess(ctx, TRIAL, FEATURE_RESERVATIONS, BEFORE)).resolves.toEqual({
      ok: true,
    });
  });

  it('el mismo tenant, un minuto después del vencimiento, ya no las tiene', async () => {
    await expect(featureAccess(ctx, TRIAL, FEATURE_RESERVATIONS, AFTER)).resolves.toEqual({
      ok: false,
      reason: 'trial_expired',
    });
  });

  it('el borde es cerrado: justo en trial_ends_at ya venció', async () => {
    await expect(featureAccess(ctx, TRIAL, FEATURE_RESERVATIONS, TRIAL_ENDS)).resolves.toEqual({
      ok: false,
      reason: 'trial_expired',
    });
  });

  it('un trial SIN fecha de fin está vencido: se falla cerrado, no infinito', async () => {
    await expect(
      featureAccess(ctx, { plan: 'trial', trialEndsAt: null }, FEATURE_RESERVATIONS, BEFORE),
    ).resolves.toEqual({ ok: false, reason: 'trial_expired' });
  });

  it('negocio y base no miran la fecha: un trial_ends_at vencido no les apaga nada', () => {
    expect(trialIsAlive({ plan: 'negocio', trialEndsAt: TRIAL_ENDS }, AFTER)).toBe(true);
    expect(trialIsAlive({ plan: 'base', trialEndsAt: null }, AFTER)).toBe(true);
  });
});

/**
 * ── Un solo mapa plan → feature en `apps/web` ─────────────────────────────────────────────────
 *
 * Hasta S-B2 este módulo tenía su propia tabla `PLAN_FEATURES` con una sola feature. Convivía con
 * el catálogo comercial de `(billing)/_lib/plans.ts` y **divergían**: contra la tabla vieja,
 * `featureAccess(negocio, 'chatbot')` daba `false`, o sea que el resolver le negaba al plan
 * Negocio justo lo que ese plan se vende por incluir. No se notaba porque `chatbot` todavía no
 * tiene consumidor; se hubiera notado el día que lo tuviera, como "el chatbot no anda en el plan
 * que lo trae".
 *
 * Ahora el catálogo es uno y esto lo mide sobre **todas** las features facturables y los tres
 * planes, no sobre la intersección de lo que dos mapas declaraban. La aserción que reemplaza es la
 * de `plans.test.ts` ("el hueco entre catálogo y resolver está contado"), que se borró con esta
 * slice porque contaba un hueco que ya no existe.
 */
describe('el plan lo declara el catálogo, no este módulo', () => {
  it('los tres planes y TODAS las features facturables: el resolver coincide con el catálogo', async () => {
    for (const tier of PLAN_TIERS) {
      for (const feature of BILLABLE_FEATURES) {
        // Trial VIVO (`BEFORE`): así se compara contra el plan de lista y no contra la vigencia,
        // que es la otra decisión del módulo y ya se prueba arriba.
        const access = await featureAccess(
          ctx,
          { plan: tier, trialEndsAt: TRIAL_ENDS },
          feature,
          BEFORE,
        );
        expect(access.ok, `plan ${tier} / feature ${feature}`).toBe(planIncludes(tier, feature));
      }
    }
  });

  it('negocio TIENE chatbot: es el hueco concreto que esta derivación cerró', async () => {
    await expect(isFeatureEnabled(ctx, paid('negocio'), FEATURE_CHATBOT, AFTER)).resolves.toBe(true);
    await expect(isFeatureEnabled(ctx, paid('base'), FEATURE_CHATBOT, AFTER)).resolves.toBe(false);
  });

  it('el trial vencido no hereda nada del catálogo, tampoco las features nuevas', async () => {
    for (const feature of BILLABLE_FEATURES) {
      await expect(
        featureAccess(ctx, { plan: 'trial', trialEndsAt: TRIAL_ENDS }, feature, AFTER),
      ).resolves.toEqual({ ok: false, reason: 'trial_expired' });
    }
  });
});
