import 'server-only';
import { and, eq } from 'drizzle-orm';
import { entitlements } from '@istock/db';
import { withTenantDb, type TenantContext } from '../../(app)/_lib/db/session';
import { trialIsAlive, type PlanSnapshot } from '../../(app)/_lib/entitlements';
import { BILLABLE_FEATURES, planIncludes, planLimit } from './plans';

/**
 * `hasEntitlement(tenant, 'chatbot')` — **el único lugar donde se decide si una feature paga está
 * prendida.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Entitlements como DATOS, no como `if` sueltos
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * El catálogo comercial vive en `plans.ts` (una tabla), las excepciones viven en la tabla
 * `entitlements` (una fila por tenant y feature), y la resolución vive acá (una función). Ningún
 * call site escribe `if (tenant.plan === 'negocio')`: eso es lo que convierte un cambio de precio
 * en una cacería de `grep`.
 *
 * ── Orden de precedencia, idéntico al de `(app)/_lib/entitlements.ts` ───────────────────────────
 * | hay fila en `entitlements` | resultado |
 * |---|---|
 * | sí | `enabled` de la fila, sea cual sea el plan |
 * | no | lo que trae el plan, **y si el plan es `trial`, sólo mientras el trial esté vivo** |
 *
 * La fila es la palanca fina: es el **feature flag sin deploy** que pide el contrato de este
 * agente. Apagar el chatbot de un tenant que abusa, o prendérselo a uno de `base` como cortesía
 * mientras se cierra una venta, es un `update` — no un release.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Por qué esta función existe además de `featureAccess()`, y qué la haría desaparecer
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * **Esto es una colisión de ownership conocida y está reportada al LEAD; no la resolví solo.**
 *
 * `apps/web/app/(app)/_lib/entitlements.ts` es de `app-agent` y trae su propio mapa
 * `PLAN_FEATURES`, que declara **una sola** feature (`reservations`) porque —dice su propio
 * comentario, y tiene razón— *"declarar `chatbot`, `margin` o `pickup_points` acá antes de que
 * exista su slice sería escribir el precio de algo que todavía no se puede prender"*. Ese mapa es
 * correcto para lo que `app-agent` necesitaba y **es incompleto como catálogo comercial**: contra
 * él, `hasEntitlement(negocio, 'chatbot')` daría `false`, que es lo contrario de lo que se vende.
 *
 * No puedo editar ese archivo (`CLAUDE.md` §4: un writer por directorio), así que la resolución
 * completa vive acá, con la **misma** semántica de precedencia y la **misma** `trialIsAlive()`
 * importada de allá — la vigencia del trial no se reimplementa, se reusa.
 *
 * La divergencia no se documenta: **se mide**. `entitlements.test.ts` maneja los dos resolvers
 * sobre las features que los dos declaran y falla si difieren, y `plans.test.ts` cuenta el hueco
 * exacto. El día que `app-agent` derive su `PLAN_FEATURES` de `planFeatures()` —un cambio de una
 * línea, en su archivo— este módulo se vuelve un alias de `featureAccess()` y se borra. Mientras
 * tanto hay dos funciones y **cero** desacuerdos silenciosos.
 */

/**
 * Motivo del rechazo. Se conserva el vocabulario de `FeatureAccess` de `app-agent` a propósito:
 * las pantallas ya saben traducir `plan` y `trial_expired` a español, y un tercer vocabulario
 * obligaría a un `switch` nuevo en cada call site.
 */
export type EntitlementDenial = 'plan' | 'trial_expired' | 'flag_off';

export type EntitlementVerdict =
  | { readonly ok: true; readonly limit: number | null }
  | { readonly ok: false; readonly reason: EntitlementDenial };

/**
 * ¿Puede este tenant usar `feature` **hoy**?
 *
 * `snapshot` entra por parámetro porque ya viene en la sesión (`requireTenant()` → `tenant`), y
 * `now` también, porque la vigencia del trial se testea a los dos lados del vencimiento y eso no
 * se puede hacer con un `Date.now()` escondido adentro.
 *
 * Dos capas de tenant, como siempre (`CLAUDE.md` §2): `withTenantDb` prende RLS **y** el `where`
 * lleva su `eq(entitlements.tenantId, ctx.tenantId)` explícito.
 */
export async function hasEntitlement(
  ctx: TenantContext,
  snapshot: PlanSnapshot,
  feature: string,
  now: Date = new Date(),
): Promise<EntitlementVerdict> {
  const rows = await withTenantDb(ctx, async (tx) =>
    tx
      .select({ enabled: entitlements.enabled, limitValue: entitlements.limitValue })
      .from(entitlements)
      .where(and(eq(entitlements.tenantId, ctx.tenantId), eq(entitlements.feature, feature)))
      .limit(1),
  );

  const row = rows[0];
  if (row !== undefined) {
    // La fila manda en las dos direcciones. `enabled = false` con plan Negocio es el kill switch.
    if (!row.enabled) return { ok: false, reason: 'flag_off' };
    return { ok: true, limit: row.limitValue ?? planLimit(snapshot.plan, feature) };
  }

  // El plan no la incluye: el motivo es el plan, aunque además el trial esté vencido. Decirle "se
  // te terminó la prueba" a alguien que nunca tuvo esa feature explica mal lo que pasó.
  if (!planIncludes(snapshot.plan, feature)) return { ok: false, reason: 'plan' };

  if (!trialIsAlive(snapshot, now)) return { ok: false, reason: 'trial_expired' };

  return { ok: true, limit: planLimit(snapshot.plan, feature) };
}

/**
 * La misma pregunta en booleano, para decidir si se dibuja algo. **No es la autorización.**
 *
 * La autorización es `requireEntitlement()`, adentro de la Server Function o del route handler.
 * No dibujar el botón es cortesía; rechazar la acción es la puerta — y la puerta nunca puede
 * estar en el proxy: un `matcher` que excluye un path también saltea las Server Functions de ese
 * path (ADR-007), así que un gate de entitlement en el proxy es un gate que no corre.
 */
export async function isEntitled(
  ctx: TenantContext,
  snapshot: PlanSnapshot,
  feature: string,
  now: Date = new Date(),
): Promise<boolean> {
  return (await hasEntitlement(ctx, snapshot, feature, now)).ok;
}

export class EntitlementRequiredError extends Error {
  readonly feature: string;
  readonly reason: EntitlementDenial;

  constructor(feature: string, reason: EntitlementDenial) {
    super(`la feature "${feature}" no está habilitada para este negocio (${reason})`);
    this.name = 'EntitlementRequiredError';
    this.feature = feature;
    this.reason = reason;
  }
}

/**
 * El gate. Tira si la feature está apagada; devuelve el techo numérico si está prendida.
 *
 * Se llama **adentro** del handler, no antes de él y no en el render. Es la misma regla que
 * ADR-018 fija para el rechazo por trial vencido: *"la negativa aterriza en la Server Action"*.
 */
export async function requireEntitlement(
  ctx: TenantContext,
  snapshot: PlanSnapshot,
  feature: string,
  now: Date = new Date(),
): Promise<number | null> {
  const verdict = await hasEntitlement(ctx, snapshot, feature, now);
  if (!verdict.ok) throw new EntitlementRequiredError(feature, verdict.reason);
  return verdict.limit;
}

/**
 * **El feature flag sin deploy.** Escribe (o pisa) la fila de excepción de un tenant.
 *
 * No lo llama el webhook: ADR-018 ya decidió que sembrar una fila por feature en cada alta
 * convierte cada feature nueva en una migración de datos, y que las filas son para las
 * excepciones. Esto es la palanca del operador —soporte, cortesía comercial, apagar algo que se
 * está portando mal— y por eso el `enabled` es explícito y no tiene default.
 *
 * `feature` se valida contra el catálogo: una feature con un typo se guardaría sin error y no
 * apagaría nada, que es la peor forma de fallar para un kill switch.
 */
export async function setFeatureFlag(
  ctx: TenantContext,
  feature: string,
  enabled: boolean,
  limitValue: number | null = null,
): Promise<void> {
  if (!(BILLABLE_FEATURES as readonly string[]).includes(feature)) {
    throw new EntitlementRequiredError(feature, 'plan');
  }

  await withTenantDb(ctx, async (tx) => {
    await tx
      .insert(entitlements)
      .values({ tenantId: ctx.tenantId, feature, enabled, limitValue })
      .onConflictDoUpdate({
        target: [entitlements.tenantId, entitlements.feature],
        set: { enabled, limitValue, updatedAt: new Date() },
      });
  });
}
