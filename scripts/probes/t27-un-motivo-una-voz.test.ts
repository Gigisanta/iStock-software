/**
 * PROBE DEL LEAD PARA T27 — la misma fila apagada tiene que dar el mismo motivo en los dos
 * resolvers, y ese motivo tiene que llegar al mostrador con SU texto y no con el del plan.
 *
 * T27 no es un bug de tipos: los dos resolvers compilaban y los dos devolvían un motivo válido.
 * Era un bug de **significado**. Con la misma fila de `entitlements` en `enabled = false`,
 * `hasEntitlement()` de `(billing)` contestaba `flag_off` y `featureAccess()` de `(app)` contestaba
 * `plan`; el copy del panel mapea `plan` a *«Eso viene con el plan Pro.»*, así que un tenant
 * que **paga** Pro y al que un operador le apagó la feature a mano recibía una invitación a
 * comprar lo que ya tiene. El síntoma no aparece en ningún test de tipos y no rompe nada: sale por
 * pantalla, en castellano, y le miente al dueño.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *  Por qué esto no delega en los tests que ya existen, que son buenos
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `(app)/_lib/entitlements.test.ts` y `(app)/_lib/listings/publish-listing.test.ts` ya afirman esto
 * y lo afirman bien —el `new Set(textos).size` de `publish-listing.test.ts` es exactamente la
 * aserción correcta—. No se citan como certificado por `CLAUDE.md` §4: son de `app-agent`, el mismo
 * writer del código auditado. Sirven como su red de regresión, y está bien que existan. La
 * auditoría de referencia la firma otra columna, y es este archivo.
 *
 * ── Cómo se ata cada lado, y por qué no se atan entre sí (ADR-023) ──────────────────────────────
 * La tentación acá es comparar un resolver contra el otro: `expect(a.reason).toBe(b.reason)`. Eso
 * pasa en verde el día que los dos se equivoquen igual, que es precisamente el estado del que
 * venimos —los dos contestaban algo, y el empate no existía porque contestaban distinto—. Cada lado
 * se compara contra un **literal escrito acá**, y la coherencia entre los dos es consecuencia de
 * que los dos coincidan con el literal, nunca la afirmación principal.
 *
 * ── El único mock, y por qué alcanza uno ───────────────────────────────────────────────────────
 * Los dos resolvers importan `withTenantDb` del MISMO módulo (`(app)/_lib/db/session`): el de
 * `(billing)` lo trae cruzando el límite de columna. Un solo `vi.mock` los alimenta a los dos con
 * la misma fila, que es justamente la premisa de T27 — *la misma fila*.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/** Lo que el `select().from().where().limit()` devuelve. Lo setea cada caso. */
let filas: { enabled: boolean; limitValue: number | null }[] = [];

vi.mock('../../apps/web/app/(app)/_lib/db/session', () => ({
  withTenantDb: async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) =>
    fn({ select: () => ({ from: () => ({ where: () => ({ limit: () => filas }) }) }) }),
}));

import { featureAccess } from '../../apps/web/app/(app)/_lib/entitlements';
import { hasEntitlement } from '../../apps/web/app/(billing)/_lib/entitlements';
import { denyReasonText } from '../../apps/web/app/(app)/_lib/listings/publish-listing';

const CTX = { tenantId: '11111111-1111-4111-8111-111111111111', userId: 'u1' } as never;
/** Pro, o sea el plan que SÍ incluye la feature. Es la mitad que hacía al bug mentir. */
const NEGOCIO = { plan: 'negocio', trialEndsAt: null } as never;
const AHORA = new Date('2026-08-28T12:00:00.000Z');
const FEATURE = 'reservations';

beforeEach(() => {
  filas = [];
});

describe('T27 · la fila apagada dice lo mismo de los dos lados', () => {
  it('`featureAccess()` de (app) contesta `flag_off`, no `plan`', async () => {
    filas = [{ enabled: false, limitValue: null }];
    const v = await featureAccess(CTX, NEGOCIO, FEATURE, AHORA);
    expect(v).toEqual({ ok: false, reason: 'flag_off' });
  });

  it('`hasEntitlement()` de (billing) contesta `flag_off`, contra el mismo literal', async () => {
    filas = [{ enabled: false, limitValue: null }];
    const v = await hasEntitlement(CTX, NEGOCIO, FEATURE, AHORA);
    expect(v).toEqual({ ok: false, reason: 'flag_off' });
  });

  /**
   * El control negativo. Sin él, los dos casos de arriba pasarían igual si alguien hiciera que los
   * resolvers devuelvan `flag_off` para todo: una constante también "coincide con el literal".
   */
  it('sin fila, el plan que NO la incluye sigue diciendo `plan` de los dos lados', async () => {
    const BASE = { plan: 'base', trialEndsAt: null } as never;
    expect(await featureAccess(CTX, BASE, FEATURE, AHORA)).toEqual({ ok: false, reason: 'plan' });
    expect(await hasEntitlement(CTX, BASE, FEATURE, AHORA)).toEqual({ ok: false, reason: 'plan' });
  });
});

describe('T27 · el motivo llega al mostrador con su propio texto', () => {
  /** La aserción del bug, escrita como el bug: `flag_off` NO puede renderizar el texto del plan. */
  it('`flag_off` no manda a comprar lo que el negocio ya tiene', () => {
    const texto = denyReasonText('entitlement_required', { ok: false, reason: 'flag_off' });
    expect(texto).not.toContain('plan Pro');
    // Y dice lo que sí pasó: alguien la apagó. El criterio del board, no una paráfrasis.
    expect(texto).toMatch(/apagad/i);
  });

  /**
   * El ancla literal (ADR-023): si el texto del plan cambiara, el `not.toContain` de arriba pasaría
   * por vacuidad y nadie se enteraría. Este caso lo hace imposible sin ponerse rojo.
   */
  it('`plan` sigue siendo, textualmente, la invitación a contratar', () => {
    expect(denyReasonText('entitlement_required', { ok: false, reason: 'plan' })).toBe(
      'Eso viene con el plan Pro.',
    );
  });

  it('los tres motivos dan tres textos distintos: ninguno se aplasta contra otro', () => {
    const textos = (['plan', 'trial_expired', 'flag_off'] as const).map((reason) =>
      denyReasonText('entitlement_required', { ok: false, reason }),
    );
    expect(new Set(textos).size).toBe(3);
  });
});
