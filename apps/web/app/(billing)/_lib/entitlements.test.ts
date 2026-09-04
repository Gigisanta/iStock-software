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
const { BILLABLE_FEATURES, FEATURE_CHATBOT, FEATURE_PICKUP_POINTS, FEATURE_RESERVATIONS } =
  await import('./plans');
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
 *  Coherencia con `featureAccess()`, y lo único que todavía los separa
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `app/(app)/_lib/entitlements.ts` (de `app-agent`) resuelve la misma pregunta sobre la misma fila
 * y es quien hoy autoriza de verdad. Desde el 2026-08-28 los dos leen **el mismo catálogo** y
 * comparten **el mismo vocabulario de motivos**, así que el desacuerdo de veredicto tiene que ser
 * cero: se maneja sobre los cuatro snapshots por todas las `BILLABLE_FEATURES`, comparando
 * **también el motivo** y no sólo el `ok`.
 *
 * ── Qué ocupa el lugar del test que se borró ─────────────────────────────────────────────────
 * Acá vivía un segundo test que fijaba la única divergencia de motivo que quedaba: con la misma
 * fila apagada, `featureAccess()` contestaba `plan` y `hasEntitlement()` contestaba `flag_off`.
 * Su docblock decía que el día que allá se agregara `flag_off` se ponía rojo y lo borraba quien
 * hiciera el cambio; ese día fue hoy y esto es ese borrado. Lo que **se gana** al borrarlo no es
 * menos cobertura, es más: mientras el caso con fila era el que discrepaba, la matriz de
 * coherencia tenía que quedarse del lado de la fila **ausente** —eso es todo lo que se podía
 * afirmar—. Ahora la fila sembrada entra en la matriz, en las dos direcciones: apagarla da
 * `flag_off` en los dos resolvers, y prenderla habilita en los dos aun cuando el plan no traiga la
 * feature y el trial esté vencido. Una divergencia fijada se cambió por una coincidencia medida.
 *
 * ── Lo que sigue difiriendo, y por eso sigue fijado: el techo ────────────────────────────────
 * El veredicto positivo de allá es `{ ok: true }`; el de acá trae `limit`. Es la última razón por
 * la que este módulo existe (ver el punto 1 de su encabezado) y no es un descuido de nadie: los 3
 * puntos de retiro de Pro contra 1 de Base no se prenden ni se apagan, **se cuentan**. Se
 * afirma por igualdad de los dos lados —y no como "distintos entre sí"— para que no pueda quedar
 * verde si alguno se mueve a un tercer valor. Si algún día `featureAccess()` devuelve el techo,
 * este test se pone rojo y lo borra quien haga el cambio, sabiendo qué borra. **Es una condición,
 * no un plan: nadie se comprometió a esa fecha, y colapsar los dos resolvers es una decisión del
 * LEAD.**
 */
describe('coherencia con featureAccess() de app-agent', () => {
  it.each([
    ['base', base],
    ['negocio', negocio],
    ['trial vivo', trialVivo],
    ['trial vencido', trialVencido],
  ])('sin fila: los dos resolvers dicen lo mismo, motivo incluido, para %s', async (caso, snapshot) => {
    for (const feature of BILLABLE_FEATURES) {
      const mio = await hasEntitlement(ctx, snapshot, feature, NOW);
      const suyo = await featureAccess(ctx, snapshot, feature, NOW);
      expect(mio.ok, `${caso} / ${feature}`).toBe(suyo.ok);
      if (!mio.ok && !suyo.ok) expect(mio.reason, `${caso} / ${feature}`).toBe(suyo.reason);
    }
  });

  /**
   * **La aserción que antes no se podía escribir.** La palanca es el único caso donde el plan no
   * decide nada, así que es el que más barato divergía sin que se notara: el motivo se lee en un
   * copy, no en un `if`. Se afirma por igualdad contra el literal —no `mio.reason === suyo.reason`—
   * para que los dos resolvers moviéndose juntos hacia un motivo equivocado tampoco pase.
   *
   * El `limit` no participa: acá se compara lo que los dos vocabularios comparten. Lo que difiere
   * está fijado abajo, solo y con nombre.
   */
  it.each([
    ['base', base],
    ['negocio', negocio],
    ['trial vivo', trialVivo],
    ['trial vencido', trialVencido],
  ])('con fila sembrada: la palanca manda igual en los dos, en las dos direcciones, para %s', async (caso, snapshot) => {
    for (const feature of BILLABLE_FEATURES) {
      db.row = { enabled: false, limitValue: null };
      expect(await hasEntitlement(ctx, snapshot, feature, NOW), `apagada · ${caso} / ${feature}`).toEqual({
        ok: false,
        reason: 'flag_off',
      });
      expect(await featureAccess(ctx, snapshot, feature, NOW), `apagada · ${caso} / ${feature}`).toEqual({
        ok: false,
        reason: 'flag_off',
      });

      db.row = { enabled: true, limitValue: null };
      expect((await hasEntitlement(ctx, snapshot, feature, NOW)).ok, `prendida · ${caso} / ${feature}`).toBe(true);
      expect((await featureAccess(ctx, snapshot, feature, NOW)).ok, `prendida · ${caso} / ${feature}`).toBe(true);
    }
  });

  /**
   * La diferencia que queda, con nombre y apellido. Se afirman los dos veredictos por igualdad
   * —y no "distintos entre sí"— para que el test no pueda quedar verde si alguno de los dos se
   * mueve a un tercer valor.
   */
  it('el techo: `limit` acá, veredicto pelado allá — es lo último que separa a los dos resolvers', async () => {
    const mio = await hasEntitlement(ctx, negocio, FEATURE_PICKUP_POINTS, NOW);
    const suyo = await featureAccess(ctx, negocio, FEATURE_PICKUP_POINTS, NOW);

    expect(mio).toEqual({ ok: true, limit: 3 });
    expect(suyo).toEqual({ ok: true });

    // Lo que NO puede diferir nunca: quién puede. La diferencia es de forma del veredicto
    // positivo, no de autorización — si algún día lo fuera, sería un incidente.
    expect(mio.ok).toBe(suyo.ok);
  });
});
