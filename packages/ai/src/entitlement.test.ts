/**
 * En Base el widget está **ausente del DOM** (`CLAUDE.md` §Entitlement): no hay paywall que mostrarle
 * al comprador. Este archivo prueba el lado servidor de eso — si la llamada llega igual, se rechaza.
 */

import { describe, expect, it } from 'vitest';
import {
  SOFT_CAP_MESSAGES_PER_TENANT_PER_DAY,
  assertChatEntitled,
  chatEntitlementSchema,
  requireMeasuredUsage,
  softCapReached,
  usageMeasured,
  usageUnmeasured,
} from './entitlement';
import { isAiError } from './errors';

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  El veredicto entra; acá no se decide
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Estos tests reemplazan a los de `chatEnabled(plan)`, que se borró. Aquel `switch` daba `true`
 * para `trial` **incondicionalmente** y su firma ni siquiera recibía la fecha, así que un trial
 * vencido conservaba la feature más cara del producto. El caso `trial_expired` de acá abajo es
 * literalmente ese bug, convertido en test.
 */
function throwsNotEntitled(entitlement: unknown): boolean {
  try {
    assertChatEntitled(entitlement as never);
    return false;
  } catch (error) {
    return isAiError(error) && error.code === 'AI_NOT_ENTITLED';
  }
}

describe('assertChatEntitled', () => {
  it('deja pasar el veredicto favorable', () => {
    expect(() => assertChatEntitled({ ok: true, limit: null })).not.toThrow();
    expect(() => assertChatEntitled({ ok: true, limit: 40 })).not.toThrow();
    // `limit` es opcional: el veredicto de una feature sin cupo no tiene por qué inventarlo.
    expect(() => assertChatEntitled({ ok: true })).not.toThrow();
  });

  it.each(['plan', 'trial_expired', 'flag_off'])('rechaza el veredicto negativo: %s', (reason) => {
    expect(throwsNotEntitled({ ok: false, reason })).toBe(true);
  });

  it('un trial VENCIDO no tiene chatbot (ADR-018), y esto es el bug que había acá', () => {
    expect(throwsNotEntitled({ ok: false, reason: 'trial_expired' })).toBe(true);
  });

  it('un trial VIGENTE sí tiene chatbot: el arreglo no puede ser un interruptor de apagado', () => {
    expect(() => assertChatEntitled({ ok: true, limit: null })).not.toThrow();
  });

  it.each([
    { label: 'undefined', value: undefined },
    { label: 'null', value: null },
    { label: 'objeto vacío', value: {} },
    { label: 'sin `ok`', value: { limit: 40 } },
    { label: '`ok` como string', value: { ok: 'true' } },
    { label: 'negativo sin motivo', value: { ok: false } },
    { label: 'un booleano suelto', value: true },
  ])('falla CERRADO cuando el veredicto no llega o llega roto: $label', ({ value }) => {
    expect(throwsNotEntitled(value)).toBe(true);
  });

  function messageOf(entitlement: unknown): string {
    try {
      assertChatEntitled(entitlement as never);
      return '';
    } catch (error) {
      return isAiError(error) ? error.message : '';
    }
  }

  /**
   * Los dos rechazos no son el mismo evento y no pueden leerse igual en un log: uno es un tenant
   * que no compró la feature, el otro es un llamador que no cableó el veredicto. Confundirlos es
   * cómo un bug de cableado se pasa meses disfrazado de cliente sin plan.
   */
  it('el rechazo por veredicto negativo arrastra el motivo, para que el log sirva', () => {
    expect(messageOf({ ok: false, reason: 'trial_expired' })).toContain('trial_expired');
  });

  it('el rechazo por veredicto ausente dice de quién es la decisión', () => {
    expect(messageOf(undefined)).toContain('fila del tenant');
    expect(messageOf(undefined)).not.toContain('trial');
  });
});

describe('chatEntitlementSchema', () => {
  /**
   * La forma es la del `EntitlementVerdict` de `apps/web/app/(billing)/_lib/entitlements.ts`, a
   * propósito y sin importarlo: `packages/ai` no puede depender de `apps/web`. Este test es lo que
   * mantiene viva esa compatibilidad estructural — si allá cambian la forma, acá se pone rojo.
   */
  it('acepta tal cual el veredicto que emite (billing), sin adaptador', () => {
    expect(chatEntitlementSchema.safeParse({ ok: true, limit: null }).success).toBe(true);
    expect(chatEntitlementSchema.safeParse({ ok: true, limit: 40 }).success).toBe(true);
    expect(chatEntitlementSchema.safeParse({ ok: false, reason: 'trial_expired' }).success).toBe(true);
  });

  it('no acepta un motivo vacío: un rechazo sin motivo no se puede loguear ni entender', () => {
    expect(chatEntitlementSchema.safeParse({ ok: false, reason: '' }).success).toBe(false);
  });
});

describe('softCapReached', () => {
  it('el tope es 40 y se alcanza al llegar, no al pasarse', () => {
    expect(SOFT_CAP_MESSAGES_PER_TENANT_PER_DAY).toBe(40);
    expect(softCapReached(39)).toBe(false);
    expect(softCapReached(40)).toBe(true);
    expect(softCapReached(41)).toBe(true);
  });

  it('acepta un cap propio por tenant', () => {
    expect(softCapReached(5, 10)).toBe(false);
    expect(softCapReached(10, 10)).toBe(true);
  });
});

/**
 * El parte del contador. Lo que se prueba acá no es aritmética: es que **el estado "no hay
 * contador" tenga representación**. Cuando no la tenía, se codificaba como `0` — el valor que
 * apaga el cap — y ningún gate podía verlo.
 */
describe('parte del contador diario', () => {
  it('un parte medido lleva el número y se lee', () => {
    expect(requireMeasuredUsage(usageMeasured(39))).toBe(39);
    expect(requireMeasuredUsage(usageMeasured(0))).toBe(0);
  });

  it('un parte sin contador no es cero: tira, y con el motivo adentro', () => {
    const usage = usageUnmeasured('el contador por tenant/día todavía no existe');
    expect(() => requireMeasuredUsage(usage)).toThrowError(/todavía no existe/u);
    try {
      requireMeasuredUsage(usage);
    } catch (error) {
      expect(isAiError(error) && error.code).toBe('AI_USAGE_UNMEASURED');
    }
  });

  it('falla cerrado ante ausencia: no hay parte y no hay chat', () => {
    for (const absent of [undefined, null]) {
      expect(() => requireMeasuredUsage(absent)).toThrowError(/sin contador/u);
    }
  });

  it('rechaza un conteo que no es un entero >= 0: un contador roto no es un contador', () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => usageMeasured(bad)).toThrowError(/entero/u);
    }
  });

  it('declarar que no hay contador exige un motivo escrito, no una cadena cualquiera', () => {
    expect(() => usageUnmeasured('')).toThrowError(/motivo/u);
    expect(() => usageUnmeasured('todavía no')).toThrowError(/motivo/u);
    expect(usageUnmeasured('  el contador vive en el ADR C1  ').reason).toBe('el contador vive en el ADR C1');
  });

  /**
   * Dónde está cada mitad de la defensa, escrito para que nadie se confunda de capa.
   *
   * El **tipo** es el que mata el `0` que iba a escribir el primer cableado de `/api/chat` para
   * poder compilar: la marca es un `unique symbol` no exportado, así que afuera no hay literal
   * posible (lo prueba `chat.test.ts` y lo prueba `tsc`, que es donde se prueba un tipo).
   *
   * El **runtime** cubre el borde JS —un route handler que pasa cualquier cosa— y ahí sí un objeto
   * con la forma exacta pasa. Eso no es un agujero tapable: quien escribe `as MeasuredUsage` o
   * arma el literal a mano no se olvidó de nada, está mintiendo, y eso se ve en el diff. Lo que la
   * marca evita es la **omisión**, que es el modo de falla que ocurre por apuro.
   */
  it('el runtime cubre el borde JS; lo que bloquea el literal es el tipo', () => {
    expect(() => requireMeasuredUsage(0 as never)).toThrowError(/sin contador/u);
    expect(() => requireMeasuredUsage(40 as never)).toThrowError(/sin contador/u);
    expect(() => requireMeasuredUsage({ messagesToday: 0 } as never)).toThrowError(/sin contador/u);
    expect(() => requireMeasuredUsage({ kind: 'measured', messagesToday: '0' } as never)).toThrowError(
      /sin contador/u,
    );
    // Una falsificación con la forma exacta pasa el runtime. Sólo se puede escribir con un `as`.
    expect(requireMeasuredUsage({ kind: 'measured', messagesToday: 7 } as never)).toBe(7);
  });
});

