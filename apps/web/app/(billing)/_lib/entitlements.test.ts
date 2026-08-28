import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `hasEntitlement()` — el único lugar donde se decide si una feature paga está prendida.
 *
 * Tres cosas se miden acá, y ninguna se puede afirmar leyendo el código:
 *
 * 1. **Lo que se vende.** `base` sin chatbot, `negocio` con chatbot. Es el hecho comercial que
 *    `CLAUDE.md` §1 declara cerrado, y el que hace que este producto tenga dos precios.
 * 2. **El feature flag sin deploy.** Una fila en `entitlements` gana sobre el plan, en las dos
 *    direcciones. Se mide apagándole el chatbot a un `negocio` y prendiéndoselo a un `base`.
 * 3. **El trial vencido no da nada.** Ya lo decidió ADR-018; lo que se mide es que este resolver
 *    lo respete y que un trial **sin fecha** falle cerrado.
 *
 * Postgres es de mentira: una fila sembrada. Lo que se prueba es la precedencia, no la SQL.
 */

vi.mock('server-only', () => ({}));

interface Row {
  readonly enabled: boolean;
  readonly limitValue: number | null;
}

const db = {
  row: null as Row | null,
  writes: [] as Record<string, unknown>[],
};

function thenable(produce: () => unknown): Record<string, unknown> {
  const builder: Record<string, unknown> = {
    onConflictDoUpdate: () => builder,
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve().then(produce).then(resolve, reject),
  };
  return builder;
}

/** Registra el `where` para poder afirmar que el filtro de tenant es explícito además de RLS. */
const conditions: unknown[] = [];

/**
 * Los valores primitivos que quedaron dentro de una condición de Drizzle. No se puede
 * `JSON.stringify` un `SQL`: las columnas apuntan a su tabla y la tabla a sus columnas. Se camina
 * el grafo con un `Set` de visitados y se junta lo que es string — que es donde va a estar el
 * `tenant_id` si el `where` lo lleva de verdad.
 */
function valoresDe(root: unknown): string[] {
  const vistos = new Set<unknown>();
  const salida: string[] = [];
  const pila: unknown[] = [root];

  while (pila.length > 0) {
    const nodo = pila.pop();
    if (typeof nodo === 'string') {
      salida.push(nodo);
      continue;
    }
    if (typeof nodo !== 'object' || nodo === null || vistos.has(nodo)) continue;
    vistos.add(nodo);
    pila.push(...Object.values(nodo as Record<string, unknown>));
  }

  return salida;
}

const tx = {
  select: () => ({
    from: () => ({
      where: (condition: unknown) => {
        conditions.push(condition);
        return { limit: () => (db.row === null ? [] : [db.row]) };
      },
    }),
  }),
  insert: () => ({
    values: (row: Record<string, unknown>) =>
      thenable(() => {
        db.writes.push(row);
        return [];
      }),
  }),
};

let tenantOfLastCall: string | null = null;
vi.mock('../../(app)/_lib/db/session', () => ({
  withTenantDb: async (ctx: { tenantId: string }, fn: (t: unknown) => Promise<unknown>) => {
    tenantOfLastCall = ctx.tenantId;
    return fn(tx);
  },
}));

const { EntitlementRequiredError, hasEntitlement, isEntitled, requireEntitlement, setFeatureFlag } =
  await import('./entitlements');
const { FEATURE_CHATBOT, FEATURE_PICKUP_POINTS, FEATURE_RESERVATIONS } = await import('./plans');
const { featureAccess } = await import('../../(app)/_lib/entitlements');

const TENANT_ID = '11111111-2222-4333-8444-555555555555';
const ctx = { userId: 'user-1', tenantId: TENANT_ID, role: 'owner' as const };
const NOW = new Date('2026-08-28T14:00:00.000Z');

const base = { plan: 'base' as const, trialEndsAt: null };
const negocio = { plan: 'negocio' as const, trialEndsAt: null };
const trialVivo = { plan: 'trial' as const, trialEndsAt: new Date('2026-09-05T00:00:00.000Z') };
const trialVencido = { plan: 'trial' as const, trialEndsAt: new Date('2026-08-01T00:00:00.000Z') };

beforeEach(() => {
  db.row = null;
  db.writes = [];
  conditions.length = 0;
  tenantOfLastCall = null;
});

describe('lo que se vende', () => {
  it('base NO tiene chatbot y negocio sí', async () => {
    expect(await hasEntitlement(ctx, base, FEATURE_CHATBOT, NOW)).toEqual({ ok: false, reason: 'plan' });
    expect(await hasEntitlement(ctx, negocio, FEATURE_CHATBOT, NOW)).toEqual({ ok: true, limit: null });
  });

  it('base no tiene ninguna feature paga', async () => {
    for (const feature of [FEATURE_CHATBOT, FEATURE_RESERVATIONS, FEATURE_PICKUP_POINTS]) {
      expect(await isEntitled(ctx, base, feature, NOW)).toBe(false);
    }
  });

  it('los puntos de retiro son 3 en negocio y 1 en base (que ni siquiera los tiene como feature)', async () => {
    expect(await hasEntitlement(ctx, negocio, FEATURE_PICKUP_POINTS, NOW)).toEqual({ ok: true, limit: 3 });
    expect(await hasEntitlement(ctx, base, FEATURE_PICKUP_POINTS, NOW)).toEqual({ ok: false, reason: 'plan' });
  });
});

describe('el trial', () => {
  it('vivo: da el producto entero, chatbot incluido', async () => {
    expect(await hasEntitlement(ctx, trialVivo, FEATURE_CHATBOT, NOW)).toEqual({ ok: true, limit: null });
  });

  it('vencido: no da NADA, y el motivo lo dice', async () => {
    expect(await hasEntitlement(ctx, trialVencido, FEATURE_CHATBOT, NOW)).toEqual({
      ok: false,
      reason: 'trial_expired',
    });
  });

  /**
   * `tenants.trial_ends_at` es nullable. Un trial sin fecha de fin es el trial infinito que
   * ADR-018 vino a matar: se falla cerrado. El control está abajo — si el módulo lo tratara como
   * "todavía no vence", este test pasaría igual con `ok: true`, así que se afirma el motivo.
   */
  it('sin fecha de fin está VENCIDO (falla cerrado, no infinito)', async () => {
    expect(await hasEntitlement(ctx, { plan: 'trial', trialEndsAt: null }, FEATURE_CHATBOT, NOW)).toEqual({
      ok: false,
      reason: 'trial_expired',
    });
  });

  it('el borde es cerrado del lado del vencimiento', async () => {
    const justo = { plan: 'trial' as const, trialEndsAt: NOW };
    const unMsAntes = { plan: 'trial' as const, trialEndsAt: new Date(NOW.getTime() + 1) };
    expect((await hasEntitlement(ctx, justo, FEATURE_CHATBOT, NOW)).ok).toBe(false);
    expect((await hasEntitlement(ctx, unMsAntes, FEATURE_CHATBOT, NOW)).ok).toBe(true);
  });
});

describe('la fila manda: es el feature flag sin deploy', () => {
  it('apaga el chatbot de un negocio que ya lo tenía por plan', async () => {
    db.row = { enabled: false, limitValue: null };
    expect(await hasEntitlement(ctx, negocio, FEATURE_CHATBOT, NOW)).toEqual({ ok: false, reason: 'flag_off' });
  });

  it('lo prende para un base, como cortesía, sin cambiarle el plan', async () => {
    db.row = { enabled: true, limitValue: null };
    expect(await hasEntitlement(ctx, base, FEATURE_CHATBOT, NOW)).toEqual({ ok: true, limit: null });
  });

  it('gana incluso sobre el trial vencido (si no, no habría forma de dar una cortesía)', async () => {
    db.row = { enabled: true, limitValue: null };
    expect((await hasEntitlement(ctx, trialVencido, FEATURE_CHATBOT, NOW)).ok).toBe(true);
  });

  it('el techo de la fila pisa el del plan', async () => {
    db.row = { enabled: true, limitValue: 7 };
    expect(await hasEntitlement(ctx, negocio, FEATURE_PICKUP_POINTS, NOW)).toEqual({ ok: true, limit: 7 });
  });

  it('sin techo en la fila, cae al del plan', async () => {
    db.row = { enabled: true, limitValue: null };
    expect(await hasEntitlement(ctx, negocio, FEATURE_PICKUP_POINTS, NOW)).toEqual({ ok: true, limit: 3 });
  });
});

describe('requireEntitlement · el gate', () => {
  it('tira con la feature y el motivo adentro', async () => {
    await expect(requireEntitlement(ctx, base, FEATURE_CHATBOT, NOW)).rejects.toThrow(EntitlementRequiredError);
    await expect(requireEntitlement(ctx, base, FEATURE_CHATBOT, NOW)).rejects.toMatchObject({
      feature: FEATURE_CHATBOT,
      reason: 'plan',
    });
  });

  it('devuelve el techo cuando pasa', async () => {
    expect(await requireEntitlement(ctx, negocio, FEATURE_PICKUP_POINTS, NOW)).toBe(3);
  });
});

describe('setFeatureFlag', () => {
  it('escribe la fila con el tenant explícito', async () => {
    await setFeatureFlag(ctx, FEATURE_CHATBOT, false);
    expect(db.writes).toHaveLength(1);
    expect(db.writes[0]).toMatchObject({ tenantId: TENANT_ID, feature: FEATURE_CHATBOT, enabled: false });
  });

  it('una feature con typo se rechaza: un kill switch que no apaga nada es peor que ninguno', async () => {
    await expect(setFeatureFlag(ctx, 'chatbo', false)).rejects.toThrow(EntitlementRequiredError);
    expect(db.writes).toHaveLength(0);
  });
});

describe('las dos capas de tenant', () => {
  it('la query se acota por tenant ADEMÁS de correr bajo RLS', async () => {
    await hasEntitlement(ctx, negocio, FEATURE_CHATBOT, NOW);
    // `withTenantDb` prende RLS con el claim del usuario...
    expect(tenantOfLastCall).toBe(TENANT_ID);
    // ...y el `where` lleva igual el tenant, que es lo que sigue en pie si alguien afloja la
    // policy en un fix apurado (CLAUDE.md §2, defensa en profundidad).
    expect(valoresDe(conditions)).toContain(TENANT_ID);
  });
});

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Coherencia con el OTRO resolver que hoy existe
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `app/(app)/_lib/entitlements.ts` (de `app-agent`) tiene su propio `featureAccess()` con su propio
 * mapa de planes. Es una colisión de ownership reportada al LEAD, no un descuido. Lo que no se
 * puede permitir mientras las dos convivan es que **difieran en silencio**, así que se manejan las
 * dos sobre la feature que ambas declaran y se exige el mismo veredicto.
 */
describe('coherencia con featureAccess() de app-agent', () => {
  it.each([
    ['base', base],
    ['negocio', negocio],
    ['trial vivo', trialVivo],
    ['trial vencido', trialVencido],
  ])('reservations: los dos resolvers dicen lo mismo para %s', async (_caso, snapshot) => {
    const mio = await hasEntitlement(ctx, snapshot, FEATURE_RESERVATIONS, NOW);
    const suyo = await featureAccess(ctx, snapshot, FEATURE_RESERVATIONS, NOW);
    expect(mio.ok).toBe(suyo.ok);
    if (!mio.ok && !suyo.ok) expect(mio.reason).toBe(suyo.reason);
  });
});
