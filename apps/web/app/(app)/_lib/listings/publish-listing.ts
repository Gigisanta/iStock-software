import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import {
  MIN_PHOTOS_TO_PUBLISH,
  checkTransition,
  transitionEffects,
  type ActiveReservation,
  type ListingStatus,
  type TransitionContext,
  type TransitionDenyReason,
  type TransitionIntent,
} from '@istock/domain';
import { listingEvents, listings, reservations } from '@istock/db';
import { DEADLOCK, isDeadlock } from '../db/pg-error';
import { withTenantDb, type TenantContext } from '../db/session';
import {
  FEATURE_RESERVATIONS,
  featureAccess,
  type FeatureAccess,
  type PlanSnapshot,
} from '../entitlements';
import { logError, logEvent } from '../log';
import { loadActiveReservation } from '../reservations/queries';
import type { ActiveSession } from '../session';
import { invalidateStorefrontUnit } from '../tenants/storefront-cache';
import { loadUnitForTransition, type UnitForTransition } from './queries';

/**
 * Publicar / despublicar una unidad.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  No hay un `UPDATE status` suelto en ningún lado de este panel.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Toda transición pasa por `checkTransition()` de `@istock/domain`, que es exhaustivo: la tabla de
 * aristas es un `Record` completo sobre `ListingStatus` y lo que no está listado devuelve `false`.
 * Reimplementar el criterio acá sería tener dos máquinas de estados, y la segunda siempre es la
 * que se olvida de que `sold` es terminal.
 *
 * Y los **efectos** tampoco se deciden a ojo: `transitionEffects(from, to, intent)` dice si la
 * vidriera cambió y en qué estado queda la reserva que la transición cierra. `CLAUDE.md` §0.7 —
 * *"Mutación que cambia stock visible → siempre `revalidateTag('storefront:' + slug)`"*. Acá eso
 * se cumple porque la tabla del dominio lo dice, no porque quien escribió esta función se acordó.
 *
 * ── Por qué el alta NO llama a esto ──────────────────────────────────────────────────────────
 * Una unidad nace en `draft`. La policy de `anon` sobre `listings` exige
 * `status in ('available','reserved','sold') and published_at is not null`: un borrador no existe
 * para el visitante. Invalidar el cache al crear un borrador sería un miss de CDN por cada equipo
 * cargado sin que nadie vea nada distinto.
 *
 * ── `published_at` ───────────────────────────────────────────────────────────────────────────
 * No se escribe desde acá. Lo estampa el trigger `listings_stamp_published_at` (migración 0002),
 * y está bien que así sea: *"la policy de anon exige published_at not null y no puede depender de
 * que el panel se acuerde"*.
 */

export type PublishOutcome =
  | { readonly ok: true; readonly status: ListingStatus }
  | { readonly ok: false; readonly message: string };

/**
 * Quién hace la transición. `slug`, `plan` y `trialEndsAt` salen de la **sesión**, nunca del
 * request: un `POST` con el slug de otro negocio purgaría la vidriera ajena, y uno con
 * `plan: 'negocio'` compraría el entitlement gratis.
 *
 * Va acá y no en `reservations/reserve-unit.ts` porque los dos módulos lo necesitan igual y
 * `reserve-unit` ya importa de este archivo: al revés habría un ciclo.
 */
export interface PanelActor {
  readonly ctx: TenantContext;
  readonly tenant: { readonly slug: string } & PlanSnapshot;
}

/**
 * El actor a partir de la sesión. Existe para que ninguna Server Action arme el objeto a mano: el
 * día que la resolución de entitlements necesite otro campo del tenant, se agrega en un solo lugar
 * en vez de descubrirse por una pantalla que quedó vieja. **Este olvido ya pasó**: S6 le agregó
 * `extras` a `transitionContextFor()` y dejó a `transitionUnit()` llamándolo sin ellos.
 */
export function panelActor(session: ActiveSession): PanelActor {
  return {
    ctx: session.ctx,
    tenant: {
      slug: session.tenant.slug,
      plan: session.tenant.plan,
      trialEndsAt: session.tenant.trialEndsAt,
    },
  };
}

export const NOT_FOUND = 'No encontramos ese equipo.';
export const LOST_RACE = 'Alguien cambió este equipo mientras lo mirabas. Recargá la pantalla.';

/**
 * El trial se venció (D2 del LEAD). Dice **qué pasó**, no "no autorizado": el dueño no hizo nada
 * mal, se le terminó la prueba, y "Eso viene con el plan Negocio" sería mentirle — el plan que
 * tiene es justamente el que incluía la función.
 */
const TRIAL_OVER =
  'Se te terminó la prueba, así que las reservas quedaron apagadas. Escribinos y lo vemos.';

/**
 * Motivo del dominio → castellano rioplatense. Le habla a alguien parado en el mostrador.
 *
 * `access` es opcional porque casi ningún motivo depende de él: sólo `entitlement_required`
 * cambia de texto según **por qué** la feature está apagada. Sin el dato, el mensaje es el del
 * plan, que es el caso mayoritario y el que no inventa una explicación que no se verificó.
 */
export function denyReasonText(
  reason: TransitionDenyReason,
  access: FeatureAccess = { ok: true },
): string {
  if (reason === 'entitlement_required' && !access.ok && access.reason === 'trial_expired') {
    return TRIAL_OVER;
  }

  switch (reason) {
    case 'missing_photos':
      return `Faltan fotos: para publicarlo necesitás ${String(MIN_PHOTOS_TO_PUBLISH)}.`;
    case 'missing_price':
      return 'Falta el precio en dólares.';
    case 'missing_condition':
      return 'Falta decir en qué estado está.';
    case 'missing_catalog_model':
      return 'Falta elegir el modelo. Todavía no se puede desde acá.';
    case 'invalid_qty':
      return 'Falta poner cuántas unidades hay.';
    case 'same_state':
      return 'Ya está así.';
    case 'terminal_state':
      return 'Está vendido: no se puede volver atrás desde acá.';
    case 'edge_not_allowed':
      return 'Ese cambio no se puede hacer desde el estado actual.';
    case 'entitlement_required':
      return 'Eso viene con el plan Negocio.';
    case 'reservation_already_active':
      return 'Ya tiene una reserva activa.';
    case 'reservation_not_active':
      return 'No tiene una reserva activa.';
    case 'reservation_not_expired':
      return 'La reserva todavía no venció.';
    case 'reservation_tenant_mismatch':
      return 'Esa reserva no es de este negocio.';
  }
}

/**
 * Lo que este módulo **no** puede saber solo: si el tenant tiene reservas y si la unidad ya tiene
 * una viva. Las dos son queries (`_lib/entitlements.ts`, `_lib/reservations/queries.ts`) y esta
 * función no las hace: se las pasa quien ya las hizo.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  El parámetro NO tiene default, y eso es la corrección de un bug de S6
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Lo tenía (`extras: TransitionExtras = {}`), con el argumento de que los defaults eran los del
 * caso "publicar / despublicar". El problema es que **el caso lo decide `from`, y `from` se relee
 * de Postgres**: `transitionUnit()` quedó llamando sin extras y evaluando toda transición con
 * `activeReservation: null` y `reservations: false`. Sobre una unidad `reserved`, `checkRelease()`
 * ve `reservation === null` y aprueba —"volver a `available` es reparar un estado inconsistente"—,
 * o sea que el dominio aprobaba porque le mentían. La unidad volvía a la vidriera como
 * "Disponible" con la seña puesta, y quedaba irreservable hasta que el cron venciera la reserva.
 *
 * Sin default, un call site nuevo tiene que decir qué sabe. El que sólo dibuja un botón de
 * `draft → available` usa `DRAFT_PUBLISH_EXTRAS`, que es la misma mentira pero **firmada**: se
 * llama como la única arista para la que es verdad.
 */
export interface TransitionExtras {
  /** `entitlements.reservations` ya resuelto. */
  readonly reservationsEnabled: boolean;
  readonly activeReservation: ActiveReservation | null;
  /** `'cancel'` = alguien apretó el botón; `'expire'` = venció sola. Cambia lo que permite el dominio. */
  readonly intent?: TransitionIntent;
}

/**
 * Para chequear `draft → available` **en un render**, que es la única arista donde las reservas no
 * juegan: un borrador no puede tener una, y publicar no pide entitlement. No sirve para decidir
 * una mutación — ahí los datos se leen de la base.
 */
export const DRAFT_PUBLISH_EXTRAS: TransitionExtras = {
  reservationsEnabled: false,
  activeReservation: null,
};

/**
 * El contexto que pide `@istock/domain` para decidir. Se arma en un solo lugar para que la
 * pantalla y la Server Action evalúen **exactamente** lo mismo: si el botón se dibuja con un
 * criterio y la acción valida con otro, el dueño ve un botón que siempre falla.
 *
 * ── Por qué `intent` se agrega condicionalmente ─────────────────────────────────────────────
 * `exactOptionalPropertyTypes` está prendido en `tsconfig.base.json`: `intent: undefined` **no** es
 * lo mismo que no tener `intent`, y el tipo del dominio declara `intent?: TransitionIntent`. El
 * spread condicional es la forma de decir "no hay intención declarada" sin mentirle al tipo.
 */
export function transitionContextFor(
  ctx: TenantContext,
  unit: UnitForTransition,
  now: Date,
  extras: TransitionExtras,
): TransitionContext {
  return {
    now,
    tenantId: ctx.tenantId,
    kind: unit.kind,
    photoCount: unit.photoCount,
    priceUsdCents: unit.priceUsdCents,
    condition: unit.condition,
    catalogModelId: unit.catalogModelId,
    qty: unit.qty,
    entitlements: { reservations: extras.reservationsEnabled },
    activeReservation: extras.activeReservation,
    ...(extras.intent === undefined ? {} : { intent: extras.intent }),
  };
}

/**
 * Cambia el estado de una unidad. El actor sale de la sesión, no del request: su `slug` es el que
 * se usa para invalidar el cache y uno de otro tenant purgaría la vidriera ajena.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  El contexto se lee de la base, ENTERO. Nada se asume por la arista que se pidió.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `from` sale de Postgres, así que esta función **no sabe** de antemano si está publicando un
 * borrador o soltando una unidad reservada: una tab vieja de `/app/stock` manda `to='available'`
 * sobre algo que mientras tanto pasó a `reserved` desde otro dispositivo. Por eso la reserva viva y
 * el entitlement se consultan siempre, y no sólo cuando "parece" que hacen falta. Ver el bloque de
 * `TransitionExtras`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  El efecto declarado se EJECUTA, en la misma transacción
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `transitionEffects(from, to, intent).closesReservationAs` es no-`null` exactamente cuando
 * `from === 'reserved'`, y **trae el estado con el que la reserva queda cerrada**. No hay forma de
 * enterarse de que hay que cerrarla sin recibir en el mismo valor con qué estado: el
 * `closingStatusFor(to)` que vivía acá era esa regla derivada por segunda vez en la capa de
 * aplicación, y una segunda derivación es siempre la que se olvida de un caso — el cron cierra la
 * misma arista como `expired` y este mapeo local no tenía cómo saberlo.
 *
 * Salir de `reserved` dejando la reserva `active` es el mismo bug con otro disfraz: el índice único
 * `reservations_one_active_per_listing` la sigue contando, así que la unidad queda irreservable
 * —"Ya tiene una reserva activa" sobre una fila cuyo badge dice "En vidriera"— hasta que el cron la
 * venza. Va adentro de la transacción que mueve el listing: si el `update` de la reserva falla, la
 * unidad no se movió.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Orden de locks: `listings` → `reservations` (D1 del LEAD)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * El mismo orden que `cancelReservation()` y —desde esta slice— que el cron. Dos órdenes distintos
 * sobre el mismo par de tablas es un deadlock ABBA, y con esta función tocando las dos hay **tres**
 * participantes. Un `40P01` que llega igual es una carrera perdida, no un 500: se mapea a
 * `LOST_RACE`, que es lo mismo que ve alguien a quien le ganaron de mano por un milisegundo.
 */
export async function transitionUnit(
  actor: PanelActor,
  listingId: string,
  to: ListingStatus,
  now: Date = new Date(),
): Promise<PublishOutcome> {
  const { ctx, tenant } = actor;

  const unit = await loadUnitForTransition(ctx, listingId);
  if (unit === null) return { ok: false, message: NOT_FOUND };

  /**
   * Las dos lecturas que el dominio necesita para no decidir a ciegas. Se piden juntas porque no
   * dependen entre sí; con `max: 1` (ver `_lib/db/connection.ts`) el pool las **encola**, así que
   * el `Promise.all` ahorra la ida y vuelta de código, no una conexión.
   */
  const [access, activeReservation] = await Promise.all([
    featureAccess(ctx, tenant, FEATURE_RESERVATIONS, now),
    loadActiveReservation(ctx, listingId),
  ]);

  const from = unit.status;
  /**
   * Un solo objeto para las dos preguntas. El dominio decide **si se puede** y **qué hay que
   * hacer** con el mismo contexto: si el `check` y los `effects` se armaran por separado, el día
   * que aparezca un call site con `intent` uno de los dos se quedaría viejo.
   */
  const extras: TransitionExtras = { reservationsEnabled: access.ok, activeReservation };

  const check = checkTransition(from, to, transitionContextFor(ctx, unit, now, extras));
  if (!check.ok) return { ok: false, message: denyReasonText(check.reason, access) };

  /**
   * `null` = **no hay intención humana declarada**, que es lo que dice este camino: publicar,
   * despublicar o mandar a un lateral. El `'cancel'` del botón de soltar entra por
   * `cancelReservation()` y el `'expire'` es del cron; ninguno de los dos pasa por acá.
   */
  const effects = transitionEffects(from, to, extras.intent ?? null);

  let updated: boolean;
  try {
    updated = await withTenantDb(ctx, async (tx) => {
      // `eq(status, from)` es el guard de concurrencia: si otro dispositivo ya lo movió, esta
      // actualización afecta 0 filas en vez de pisar una transición que ya ocurrió.
      const rows = await tx
        .update(listings)
        .set({ status: to, updatedAt: sql`now()` })
        .where(
          and(
            eq(listings.tenantId, ctx.tenantId),
            eq(listings.id, listingId),
            eq(listings.status, from),
          ),
        )
        .returning({ id: listings.id });

      if (rows.length === 0) return false;

      /**
       * Se cierra **la** reserva activa de esta unidad, sin nombrarla por id: el índice único
       * parcial garantiza que hay a lo sumo una, y el id que teníamos es de antes de la
       * transacción. El guard `status = 'active'` la hace idempotente contra el cron corriendo al
       * mismo tiempo.
       */
      if (effects.closesReservationAs !== null) {
        await tx
          .update(reservations)
          .set({
            status: effects.closesReservationAs,
            closedAt: sql`now()`,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(reservations.tenantId, ctx.tenantId),
              eq(reservations.listingId, listingId),
              eq(reservations.status, 'active'),
            ),
          );
      }

      await tx.insert(listingEvents).values({
        tenantId: ctx.tenantId,
        listingId,
        kind: 'status_change',
        fromStatus: from,
        toStatus: to,
        actorUserId: ctx.userId,
      });

      return true;
    });
  } catch (error) {
    if (isDeadlock(error)) {
      // Ids y el SQLSTATE. Nunca el `Error`: su `DETAIL` cita la fila, y la fila de una reserva
      // lleva la etiqueta del cliente.
      logError('listing.transition.deadlock', DEADLOCK, { tenantId: ctx.tenantId, listingId });
      return { ok: false, message: LOST_RACE };
    }
    throw error;
  }

  if (!updated) {
    return { ok: false, message: LOST_RACE };
  }

  /**
   * El dominio decide si la vidriera cambió; nosotros ejecutamos.
   *
   * Publicar o despublicar mueve la **grilla** (el equipo entra o sale) y la **ficha**, así que va
   * la invalidación de los tres tags: los dos del tenant más `listing:{uuid}`. El de la unidad no
   * se saltea aunque hoy sea redundante — ver el bloque "el TERCER tag" en `storefront-cache.ts`.
   */
  if (effects.revalidateStorefront) {
    invalidateStorefrontUnit(tenant.slug, listingId);
  }

  logEvent('listing.status_changed', {
    tenantId: ctx.tenantId,
    listingId,
    from,
    to,
  });

  return { ok: true, status: to };
}
