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
 *  Por qué sigue existiendo además de `featureAccess()`, y por qué NO se borró el 2026-08-28
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * La versión anterior de este bloque prometía: *"el día que `app-agent` derive su `PLAN_FEATURES`
 * de `planFeatures()`, este módulo se vuelve un alias de `featureAccess()` y se borra"*. Ese día
 * llegó —hoy `(app)/_lib/entitlements.ts` importa `planFeatures()` de `plans.ts` y ya no declara
 * planes— y **la promesa estaba mal escrita**: daba por sentado que la única diferencia entre los
 * dos resolvers era el catálogo. Medido, no lo era. Lo que se borra es la promesa, no el módulo.
 *
 * Tres cosas tiene esto que `featureAccess()` no tiene, y ninguna es cosmética:
 *
 * 1. **El techo (`limit`).** El veredicto positivo de allá es `{ ok: true }`; el de acá trae el
 *    número. `planLimit()` no tiene otro lector en el repo (medido con `grep`: este archivo y su
 *    test). Los **3** puntos de retiro de Negocio contra **1** de Base son producto (`CLAUDE.md`
 *    §1), y hoy este es el único código capaz de contestar cuántos le tocan a un tenant. Un
 *    booleano no puede: `pickup_points` no se prende ni se apaga, se cuenta.
 * 2. **`flag_off` como motivo.** Con la **misma** fila apagada, `featureAccess()` contesta `plan` y
 *    esto contesta `flag_off`, y no es un empate de gustos: `plan` renderiza *"eso viene con el
 *    plan Negocio"* a un tenant que **tiene** el plan Negocio y al que un operador le apagó el
 *    chatbot a mano. Es el mismo defecto de copy que el docblock de `FeatureAccess` denuncia para
 *    `trial_expired`. La diferencia está **fijada en `entitlements.test.ts`**, no comentada; el
 *    arreglo vive en el archivo de `app-agent`, así que se reporta y no se toca.
 * 3. **`setFeatureFlag()`.** `featureAccess()` sólo lee. Este es el único escritor de la tabla
 *    `entitlements` en toda la app (el otro es el seed), o sea **el feature flag sin deploy** que
 *    pide el contrato de este agente. Borrar el módulo lo borraba a él también.
 *
 * ── Lo que hay que decir en voz alta: hoy nadie llama a este módulo ───────────────────────────
 * Cero call sites de producción para `hasEntitlement` / `isEntitled` / `requireEntitlement` /
 * `setFeatureFlag`. Los tres consumidores vivos —`publish-listing.ts`, `reserve-unit.ts` y
 * `stock/page.tsx`— usan `featureAccess()` / `isFeatureEnabled()`, y hacen bien: `reservations` es
 * booleana y no necesita techo. Esto es la mitad que se cablea cuando llegue la primera feature con
 * techo o la primera pantalla de soporte que apague algo. **No está muerto: está sin cablear** — se
 * escribe acá para que nadie lo descubra con un `grep` y saque la conclusión contraria.
 *
 * ── Qué lo haría desaparecer de verdad ────────────────────────────────────────────────────────
 * Que `featureAccess()` devuelva el techo, distinga `flag_off` y tenga camino de escritura. Es el
 * archivo de `app-agent` y son tres cambios de semántica, no una línea: **es una decisión del LEAD,
 * no un refactor que yo pueda prometer con fecha.** Por eso este bloque ya no promete un borrado.
 */

/**
 * Motivo del rechazo. **Superconjunto** del vocabulario de `FeatureAccess` de `app-agent`, a
 * propósito: `plan` y `trial_expired` se conservan con el mismo nombre y el mismo significado
 * —las pantallas ya los saben traducir y un vocabulario paralelo obligaría a un `switch` nuevo en
 * cada call site—, y `flag_off` se agrega porque allá no existe y hace falta. Ver el encabezado:
 * sin él, una fila apagada a mano se le explica al dueño como si fuera su plan.
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
