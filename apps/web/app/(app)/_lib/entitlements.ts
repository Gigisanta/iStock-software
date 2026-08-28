import 'server-only';
import { and, eq } from 'drizzle-orm';
import { entitlements } from '@istock/db';
import { planFeatures, type PlanTier } from '../../(billing)/_lib/plans';
import { withTenantDb, type TenantContext } from './db/session';

/**
 * ¿Qué puede hacer este negocio **hoy**?
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Se lee en el server. Nunca viaja al cliente como flag.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `commerce`/`billing` lo dicen en el schema: *"Plan `base`: el widget del chatbot **no existe en
 * el DOM** (cero paywall mostrado al comprador final)"*. La misma idea vale para el panel: cuando
 * una feature está apagada, el botón no se dibuja **y** la acción la rechaza. Lo primero es
 * cortesía; lo segundo es la puerta.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Dos fuentes y un orden: la FILA manda, el PLAN es el default
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * | hay fila en `entitlements` | resultado |
 * |---|---|
 * | sí | `enabled` de la fila, sea cual sea el plan |
 * | no | lo que trae el plan |
 *
 * Al revés —el plan primero— una feature apagada a mano por billing seguiría prendida para todo
 * tenant del plan que la incluye, y el único modo de apagarla sería bajarle el plan. La fila es
 * la palanca fina; el plan es lo que se vende.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Por qué el fallback por plan EXISTE (y no es "por las dudas")
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `tenants/create-tenant.ts` siembra cuatro filas en el alta —`tenants`, `memberships`,
 * `fx_settings`, `locations`— y **ninguna es de `entitlements`**. O sea: hoy, todo tenant real
 * nace sin una sola fila en esa tabla. Sin el fallback, las reservas serían código muerto para
 * todos menos para el tenant del seed, y el bug se vería como "el botón de reservar no aparece",
 * sin error y sin log.
 *
 * Podría arreglarse sembrando filas en el alta. No se hace, por dos motivos: sembrar una fila por
 * feature convierte cada feature nueva en una migración de datos sobre los tenants existentes, y
 * deja la respuesta a "¿qué incluye el plan Negocio?" repartida entre el código y N filas viejas.
 * Acá el plan se define en un lugar y las filas quedan para las excepciones, que es lo que la
 * columna `enabled` significa.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  El trial da features MIENTRAS ESTÁ VIVO. Vencido, no da ninguna.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Ratificado por el LEAD (S6). Es un trial **del plan Negocio** —`packages/db/src/seed.ts` crea la
 * suscripción como `plan: 'negocio', status: 'trialing'` y `PRODUCT.md` vende los 14 días como la
 * prueba del producto completo—, así que mientras corre incluye reservas: un trial que no deja
 * probar lo que se paga no vende nada.
 *
 * Lo que **no** puede pasar es que las conserve después. La versión anterior de este módulo daba
 * `trial: [FEATURE_RESERVATIONS]` sin mirar `trial_ends_at`, y confiaba en que "cuando el trial
 * vence, `billing-agent` baja el plan". `billing-agent` es FASE 6 y todavía no existe: nada baja
 * ese plan, así que un tenant con el trial vencido hace seis meses seguía reservando gratis, para
 * siempre. Dejarlo para cuando exista `billing-agent` hubiera sido deuda diferida con otro
 * nombre, y §2 de `CLAUDE.md` rechaza esa clase de herencia se la escriba como se la escriba.
 *
 * **La vigencia se resuelve acá, no en el call site.** `featureAccess()` es el único lugar donde se
 * mira `trial_ends_at` para decidir una feature: un chequeo que cada pantalla tiene que acordarse
 * de hacer no es un chequeo, es una lista de lugares donde todavía no falló.
 *
 * ── Un trial sin fecha de fin está vencido ───────────────────────────────────────────────────
 * `tenants.trial_ends_at` es nullable en el schema. `createTenant()` siempre la escribe y el seed
 * también, así que `null` con `plan = 'trial'` es una fila que nadie sabe explicar. Un trial sin
 * fecha de vencimiento es exactamente el trial infinito que esta decisión vino a matar: se falla
 * cerrado. `base` y `negocio` ni la miran — no tienen vigencia que chequear.
 *
 * ── Y la fila de `entitlements` sigue mandando, también acá ──────────────────────────────────
 * La vigencia apaga lo que da el **plan**, que es el default. Una fila explícita en `entitlements`
 * es una palanca que alguien movió a mano (hoy nada del panel escribe esa tabla: sólo el seed), y
 * si le sacáramos precedencia no habría forma de darle una cortesía a un negocio sin inventar un
 * cambio de plan — que es justo lo que `billing-agent` todavía no puede hacer. La fila no es el
 * trial; el trial es el plan.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Qué incluye cada plan NO se decide acá: se lee de `(billing)/_lib/plans.ts`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Este módulo tenía su propia tabla `PLAN_FEATURES` con una sola feature (`reservations`), bajo el
 * argumento de que declarar `chatbot`/`margin`/`pickup_points` antes de que existiera su slice
 * sería escribir el precio de algo que no se puede prender. El argumento era razonable y el
 * resultado fue el que siempre da tener la misma respuesta escrita dos veces: **divergieron**.
 * Contra esa tabla, `featureAccess(negocio, 'chatbot')` daba `false`, que es lo contrario de lo
 * que `PRODUCT.md` vende. No se veía porque nadie consume `chatbot` todavía; el día que alguien lo
 * consumiera, el bug se hubiera visto como "el chatbot no anda en el plan que lo incluye".
 *
 * Ahora el catálogo es uno solo —`planFeatures()`— y este módulo **resuelve**, no declara. El
 * corte es exacto y vale la pena escribirlo: *qué se vende* es del catálogo comercial
 * (`billing-agent`); *quién puede hacer qué hoy* —la fila explícita, la vigencia del trial— es de
 * acá. Importar `plans.ts` es una lectura y `plans.ts` es un módulo puro (no toca Postgres, no lee
 * `process.env`, no importa `server-only`), así que no arrastra nada al panel.
 *
 * Una feature que el catálogo no declara sigue apagada para los tres planes: el default es "no",
 * no "por las dudas sí".
 */

/** El nombre de la feature es el valor de `entitlements.feature`, no un enum de TypeScript. */
export const FEATURE_RESERVATIONS = 'reservations';

/**
 * El tipo también sale del catálogo, y no es cosmético: con la unión escrita a mano acá, un cuarto
 * plan en `PLAN_TIERS` no le hubiera dado ningún error al `tsc` de este archivo —la unión chica es
 * asignable a la grande— y el `PLAN_CATALOG[tier]` de adentro de `planFeatures()` habría explotado
 * en runtime contra una clave que el mapa no tiene. Un plan nuevo tiene que romper en compilación
 * o no romper en absoluto; lo que no puede es romper recién en producción.
 *
 * Se re-exporta porque `PlanSnapshot` es de acá y sus consumidores (`publish-listing.ts`,
 * `reserve-unit.ts`) ya importan de este módulo: obligarlos a traer el tipo de `(billing)` sería
 * empujar la columna de billing hasta las pantallas del panel por un alias.
 */
export type { PlanTier } from '../../(billing)/_lib/plans';

/**
 * Lo que hace falta saber del plan de un tenant para resolver una feature. Sale entero de la
 * sesión (`requireTenant()` → `tenant`, releído en cada request, ADR-005): `TenantSummary` lo
 * satisface tal cual, así que ninguna pantalla arma este objeto a mano ni puede olvidarse la fecha.
 */
export interface PlanSnapshot {
  readonly plan: PlanTier;
  readonly trialEndsAt: Date | null;
}

/**
 * Por qué una feature está apagada. El motivo importa porque el mensaje al dueño cambia, y los tres
 * casos son distintos de verdad:
 *
 * | motivo | qué pasó | qué copy sería mentira |
 * |---|---|---|
 * | `plan` | su plan no la incluye | ninguno: es el **único** caso donde "viene con el plan Negocio" es cierto |
 * | `trial_expired` | la tuvo mientras corría el trial y el trial venció | "viene con el plan Negocio": el plan que tenía la incluía |
 * | `flag_off` | hay una fila en `entitlements` en `false` — alguien se la apagó a mano | "viene con el plan Negocio": puede tenerlo contratado y tenerla apagada igual |
 *
 * ── `flag_off` se agregó el 2026-08-28, y no es cosmético ────────────────────────────────────
 * Hasta entonces la fila apagada devolvía `plan`, y `denyReasonText()` la renderizaba como *"Eso
 * viene con el plan Negocio."* a un tenant que **tiene** el plan Negocio y al que un operador le
 * apagó la feature: lo mandaba a comprar lo que ya pagó. Es exactamente el defecto que este mismo
 * docblock denunciaba para `trial_expired`, con el otro motivo — el argumento estaba escrito y le
 * faltaba una fila. Lo levantó `billing-agent`: su `hasEntitlement()` ya contestaba `flag_off`
 * sobre la misma fila, y el desacuerdo entre los dos resolvers estaba medido en un test de
 * `(billing)` en vez de comentado.
 *
 * Que hoy nada del panel escriba esta tabla no lo vuelve hipotético: la fila la siembra
 * `packages/db/src/seed.ts` y la escribe `setFeatureFlag()` de `(billing)`, y
 * `packages/ai/src/entitlement.ts` ya **testea** `flag_off` como motivo que espera recibir. El
 * productor de producción todavía no existe; el consumidor sí.
 *
 * El motivo es de **explicación**, nunca de autorización: los tres significan `ok: false` y ninguna
 * pantalla decide nada mirando cuál es. Quien lo mira es el copy.
 */
export type FeatureAccess =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'plan' | 'trial_expired' | 'flag_off' };

const ACCESS_OK: FeatureAccess = { ok: true };

/**
 * ¿El trial sigue corriendo? El borde es cerrado del lado del vencimiento (`now >= trialEndsAt`
 * ya no es trial), igual que `expireReservation()` del dominio. Sin fecha, no corre: ver arriba.
 */
export function trialIsAlive(snapshot: PlanSnapshot, now: Date): boolean {
  if (snapshot.plan !== 'trial') return true;
  if (snapshot.trialEndsAt === null) return false;
  return now.getTime() < snapshot.trialEndsAt.getTime();
}

/**
 * ¿Puede este tenant usar `feature` **hoy**, y si no, por qué?
 *
 * `snapshot` se pasa por parámetro en vez de releerse acá: ya viene en la sesión
 * (`requireTenant()` → `tenant`, releído de `memberships`/`tenants` en cada request, ADR-005), y
 * volver a consultarlo sería una query por cada chequeo de feature en el mismo render. `now`
 * también entra por parámetro: la vigencia del trial se testea a los dos lados del vencimiento y
 * eso no se puede hacer con `Date.now()` adentro.
 *
 * Las dos capas de tenant, como siempre: `withTenantDb` prende RLS **y** el `where` lleva su
 * `eq(entitlements.tenantId, ctx.tenantId)` explícito (`CLAUDE.md` §2).
 */
export async function featureAccess(
  ctx: TenantContext,
  snapshot: PlanSnapshot,
  feature: string,
  now: Date = new Date(),
): Promise<FeatureAccess> {
  const rows = await withTenantDb(ctx, async (tx) =>
    tx
      .select({ enabled: entitlements.enabled })
      .from(entitlements)
      .where(and(eq(entitlements.tenantId, ctx.tenantId), eq(entitlements.feature, feature)))
      .limit(1),
  );

  const row = rows[0];
  // La fila manda, y también manda sobre el **motivo**: si está en `false`, lo que pasó es que
  // alguien la apagó a mano, sea cual sea el plan. Contestar `plan` acá sería explicar el veredicto
  // con la fuente que no lo produjo. Mismo orden y mismo motivo que `hasEntitlement()` de
  // `(billing)`, que resuelve la misma pregunta sobre la misma fila.
  if (row !== undefined) return row.enabled ? ACCESS_OK : { ok: false, reason: 'flag_off' };

  // El plan no la incluye: el motivo es el plan, aunque el trial además esté vencido. Decirle
  // "se te terminó la prueba" a alguien que nunca tuvo esa feature sería explicar mal.
  if (!planFeatures(snapshot.plan).includes(feature)) return { ok: false, reason: 'plan' };

  return trialIsAlive(snapshot, now) ? ACCESS_OK : { ok: false, reason: 'trial_expired' };
}

/**
 * La misma pregunta en booleano, para las pantallas: dibujar o no dibujar un formulario no
 * necesita el motivo. **No es la autorización**: la Server Action vuelve a preguntar con
 * `featureAccess()` y ahí el motivo sí se usa para explicar qué pasó.
 */
export async function isFeatureEnabled(
  ctx: TenantContext,
  snapshot: PlanSnapshot,
  feature: string,
  now: Date = new Date(),
): Promise<boolean> {
  return (await featureAccess(ctx, snapshot, feature, now)).ok;
}
