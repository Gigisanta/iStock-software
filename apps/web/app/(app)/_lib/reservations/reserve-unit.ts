import 'server-only';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { checkTransition, createReservation, transitionEffects } from '@istock/domain';
import { listingEvents, reservations } from '@istock/db';
import { DEADLOCK, isDeadlock, uniqueViolationConstraint } from '../db/pg-error';
import { withTenantDb } from '../db/session';
import { FEATURE_RESERVATIONS, featureAccess } from '../entitlements';
import {
  LOST_RACE,
  NOT_FOUND,
  denyReasonText,
  transitionContextFor,
  type PanelActor,
} from '../listings/publish-listing';
import { loadUnitForTransition } from '../listings/queries';
import { transitionListingStatus } from '../listings/transition-listing-status';
import { logError, logEvent } from '../log';
import { invalidateStorefrontUnit } from '../tenants/storefront-cache';
import { loadActiveReservation } from './queries';
import type { ReserveUnitInput } from './schema';

/**
 * Reservar una unidad y soltarla. El otro lado —soltarla **sola** cuando vence— es
 * `expire-reservations.ts`, y comparte con este módulo la misma máquina de estados.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  La carrera la gana el motor, no un `if`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `commerce.ts` lo dice donde vale, que es en el schema: *"Una unidad tiene como máximo una
 * reserva activa — y eso no se defiende con un `if` en el server sino con un índice único parcial:
 * dos requests concurrentes contra el mismo listing pasan los dos por el `if` y sólo uno pasa por
 * el índice."* Acá hay **tres** capas y ninguna sobra:
 *
 * | capa | qué atrapa |
 * |---|---|
 * | `loadActiveReservation()` + `checkTransition()` | el caso normal: el equipo ya está reservado y el dueño lo ve venir con un mensaje |
 * | RPC con estado esperado | el otro dispositivo que lo movió entre el render y el click |
 * | `reservations_one_active_per_listing` | los milisegundos: dos `POST` a la vez, uno escribe y el otro recibe `23505` |
 *
 * Y una constraint **desconocida se propaga**. Mapearla al mensaje de la que sí conocemos es cómo
 * se pierde un incidente: un bug nuevo se vería en producción como "gente que intenta reservar dos
 * veces", que es un síntoma que nadie investiga. Mismo criterio, y misma función, que
 * `tenants/create-tenant.ts` (`_lib/db/pg-error.ts`).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  La vidriera se entera. Siempre.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `CLAUDE.md` §0.7: *"Mutación que cambia stock visible → siempre `revalidateTag`"*. Reservar
 * cambia el badge de la ficha y de la grilla —`storefront-agent` lo pinta en ámbar y su
 * `_lib/status.ts` garantiza que `reserved` **nunca** diga "disponible"—. Sin la invalidación el
 * equipo sigue diciendo "Disponible" en el CDN, que es exactamente la mentira del estado de
 * Instagram que este producto vino a matar: alguien escribe por WhatsApp por un equipo que ya
 * tiene seña.
 *
 * Va **después** del commit y **sólo** si algo cambió. Invalidar cuando la escritura no ocurrió es
 * pagar la regeneración de la vidriera por un click que no hizo nada.
 */

/**
 * Quién reserva. Es el mismo actor que el de una transición de estado
 * (`listings/publish-listing.ts`), y el alias existe para que las dos puertas del panel no puedan
 * divergir: cuando la resolución de entitlements pidió `trial_ends_at` además de `plan`, un
 * segundo tipo hubiera dejado a una de las dos preguntando con menos datos.
 */
export type ReservationActor = PanelActor;

export type ReserveOutcome =
  | { readonly ok: true; readonly reservationId: string; readonly expiresAt: Date }
  | { readonly ok: false; readonly message: string };

export type CancelOutcome = { readonly ok: true } | { readonly ok: false; readonly message: string };

/** El índice único parcial de `commerce.ts`. El nombre es DDL: se puede loguear y se puede mapear. */
const ONE_ACTIVE_PER_LISTING = 'reservations_one_active_per_listing';

/**
 * No es un SQLSTATE —los otros `logError` de este módulo sí lo son— porque no lo dijo Postgres: lo
 * dijo el dominio. Se nombra aparte para que la línea sea grepeable y no se confunda con un `40P01`.
 */
const NO_CLOSING_STATUS = 'domain_no_closing_status';

/**
 * `available → reserved`, con la reserva escrita en la misma transacción.
 *
 * El orden de adentro no es casual: primero se mueve el listing mediante el RPC (guardado por
 * `expected_status = 'available'`) y recién después nace la reserva. Al revés, perder la carrera del
 * listing dejaría una reserva activa colgada de una unidad que otro ya vendió — y esa reserva
 * bloquearía la próxima por el índice único, sin que nadie entienda por qué.
 */
export async function reserveUnit(
  actor: ReservationActor,
  input: ReserveUnitInput,
  now: Date = new Date(),
): Promise<ReserveOutcome> {
  const { ctx, tenant } = actor;

  const unit = await loadUnitForTransition(ctx, input.listingId);
  if (unit === null) return { ok: false, message: NOT_FOUND };

  /**
   * Las dos lecturas que el dominio necesita. Se piden juntas porque no dependen entre sí; con
   * `max: 1` (`_lib/db/connection.ts`) el pool las **encola**, así que el `Promise.all` ahorra
   * código, no una conexión. Decir "salen en paralelo" acá era falso y ya está corregido.
   */
  const [access, activeReservation] = await Promise.all([
    featureAccess(ctx, tenant, FEATURE_RESERVATIONS, now),
    loadActiveReservation(ctx, input.listingId),
  ]);

  const check = checkTransition(
    unit.status,
    'reserved',
    transitionContextFor(ctx, unit, now, { reservationsEnabled: access.ok, activeReservation }),
  );
  // `access` viaja al mensaje: un trial vencido no se explica con "eso viene con el plan Pro".
  if (!check.ok) return { ok: false, message: denyReasonText(check.reason, access) };

  /**
   * El id se genera acá y no lo pone la base, para que `createReservation()` —puro, con `now`
   * inyectado— pueda devolver la reserva entera y este módulo no tenga que releerla para saber
   * cuándo vence. El vencimiento que se muestra en pantalla es el mismo objeto que se guardó.
   */
  const reservation = createReservation(
    {
      id: randomUUID(),
      tenantId: ctx.tenantId,
      listingId: input.listingId,
      minutes: input.minutes,
    },
    now,
  );

  let written: boolean;
  try {
    written = await withTenantDb(ctx, async (tx) => {
      const moved = await transitionListingStatus(
        tx,
        ctx,
        input.listingId,
        'available',
        'reserved',
      );

      if (!moved) return false;

      await tx.insert(reservations).values({
        id: reservation.id,
        tenantId: ctx.tenantId,
        listingId: input.listingId,
        status: 'active',
        minutes: input.minutes,
        expiresAt: reservation.expiresAt,
        customerLabel: input.customerLabel,
        createdBy: ctx.userId,
      });

      await tx.insert(listingEvents).values({
        tenantId: ctx.tenantId,
        listingId: input.listingId,
        kind: 'status_change',
        fromStatus: 'available',
        toStatus: 'reserved',
        actorUserId: ctx.userId,
      });

      return true;
    });
  } catch (error) {
    /**
     * Un deadlock es una carrera perdida, no un 500 (D1 del LEAD). Con el orden de locks unificado
     * —`listings` → `reservations` en el panel **y** en el cron— no debería llegar acá; "no
     * debería" no es un manejo de error, y sin esto el dueño ve el error boundary del panel.
     */
    if (isDeadlock(error)) {
      logError('reservation.create.deadlock', DEADLOCK, {
        tenantId: ctx.tenantId,
        listingId: input.listingId,
      });
      return { ok: false, message: LOST_RACE };
    }

    const constraint = uniqueViolationConstraint(error);
    if (constraint === ONE_ACTIVE_PER_LISTING) {
      // Perdió la carrera por milisegundos. Para el dueño es indistinguible del caso normal, y
      // tiene que serlo: el equipo está reservado, sea por quién sea.
      return { ok: false, message: denyReasonText('reservation_already_active') };
    }
    if (constraint !== null) {
      // El **nombre** del índice, nada más. El `Error` crudo trae el `DETAIL` con la fila, y la
      // fila de una reserva lleva la etiqueta del cliente.
      logError('reservation.create.unknown_unique_violation', '23505', {
        tenantId: ctx.tenantId,
        listingId: input.listingId,
        constraint,
      });
    }
    throw error;
  }

  if (!written) return { ok: false, message: LOST_RACE };

  invalidateStorefrontUnit(tenant.slug, input.listingId);

  // La etiqueta del cliente NO se loguea: es texto sobre una persona. Ids y números.
  logEvent('listing.reserved', {
    tenantId: ctx.tenantId,
    listingId: input.listingId,
    reservationId: reservation.id,
    minutes: input.minutes,
  });

  return { ok: true, reservationId: reservation.id, expiresAt: reservation.expiresAt };
}

/**
 * `reserved → available` a mano: se cayó la venta, el cliente no vino, el dueño se arrepintió.
 *
 * ── No pide el entitlement, y es a propósito ────────────────────────────────────────────────
 * Reservar necesita plan Pro; **soltar no**. Un tenant al que se le venció el trial tiene que
 * poder desbloquear su propio equipo: si el downgrade dejara las reservas trabadas, el plan Base
 * sería una trampa con stock adentro. `checkTransition` tampoco lo mira para esta arista.
 *
 * ── `intent: 'cancel'` ──────────────────────────────────────────────────────────────────────
 * Sin eso, `checkRelease()` del dominio exige que la reserva ya haya vencido
 * (`reservation_not_expired`), que es la regla correcta para el cron y la equivocada para un
 * botón. La intención se declara; no se deduce de la hora.
 *
 * ── Y el estado de cierre también sale del dominio ──────────────────────────────────────────
 * Declarar la intención y después escribir `'cancelled'` a mano era declarar la mitad. La otra
 * mitad —con qué estado queda la reserva que esta arista cierra— la contesta
 * `transitionEffects(from, to, intent).closesReservationAs`, que es exactamente lo que ya consume
 * el cron hermano (`expire-reservations.ts`) y `transitionUnit()`. Con el literal acá, el panel y
 * el barrido volvían a ser dos derivaciones de la misma regla sobre la MISMA arista
 * `reserved → available`, que es el fallo que S6.1 cerró del otro lado: la tabla del dominio decide
 * o no decide, y decidir en la mitad del producto es no decidir.
 */
export async function cancelReservation(
  actor: ReservationActor,
  listingId: string,
  now: Date = new Date(),
): Promise<CancelOutcome> {
  const { ctx, tenant } = actor;

  const unit = await loadUnitForTransition(ctx, listingId);
  if (unit === null) return { ok: false, message: NOT_FOUND };

  const activeReservation = await loadActiveReservation(ctx, listingId);

  const check = checkTransition(
    unit.status,
    'available',
    transitionContextFor(ctx, unit, now, {
      // Soltar no pide entitlement (ver arriba), así que el dominio no lo mira para esta arista:
      // `false` es lo honesto, no un permiso denegado.
      reservationsEnabled: false,
      activeReservation,
      intent: 'cancel',
    }),
  );
  if (!check.ok) return { ok: false, message: denyReasonText(check.reason) };

  /**
   * El `from` es el que salió de Postgres, no el `'reserved'` que este módulo espera: preguntarle
   * al dominio por una arista distinta de la que se chequeó sería inventarle la respuesta.
   *
   * `null` = **el dominio dice que esta arista no cierra ninguna reserva**, y hoy eso pasa
   * exactamente cuando `from !== 'reserved'`: una tab vieja apretando "Soltar" sobre una unidad que
   * mientras tanto se fue a service, o a `unavailable`. No se inventa un default —escribir
   * `'cancelled'` acá sería registrar el cierre de una reserva que esta arista no cierra— y no se
   * escribe nada: el RPC de abajo va guardado por `expected_status = 'reserved'`, así que devuelve
   * 0, y el `listing_events` con `fromStatus: 'reserved'` habría sido una mentira.
   * Para quien está en el mostrador es la misma carrera perdida de siempre; queda logueado porque
   * el día que aparezca por otro motivo hay que verlo.
   */
  const closesAs = transitionEffects(unit.status, 'available', 'cancel').closesReservationAs;
  if (closesAs === null) {
    logError('reservation.cancel.no_closing_status', NO_CLOSING_STATUS, {
      tenantId: ctx.tenantId,
      listingId,
      fromStatus: unit.status,
    });
    return { ok: false, message: LOST_RACE };
  }

  let released: boolean;
  try {
    released = await withTenantDb(ctx, async (tx) => {
      const moved = await transitionListingStatus(tx, ctx, listingId, 'reserved', 'available');

      if (!moved) return false;

      /**
       * Cierra **la** reserva activa de esta unidad, sin nombrarla por id: el id que teníamos es de
       * antes de la transacción y el índice único garantiza que hay a lo sumo una. El guard
       * `status = 'active'` la hace idempotente contra el cron corriendo al mismo tiempo, y
       * `closesAs` es el estado que dijo el dominio arriba, no una constante de este archivo.
       */
      await tx
        .update(reservations)
        .set({ status: closesAs, closedAt: sql`now()`, updatedAt: sql`now()` })
        .where(
          and(
            eq(reservations.tenantId, ctx.tenantId),
            eq(reservations.listingId, listingId),
            eq(reservations.status, 'active'),
          ),
        );

      await tx.insert(listingEvents).values({
        tenantId: ctx.tenantId,
        listingId,
        kind: 'status_change',
        fromStatus: 'reserved',
        toStatus: 'available',
        actorUserId: ctx.userId,
      });

      return true;
    });
  } catch (error) {
    /**
     * Esta función es la que **define** el orden de locks del panel (`listings` → `reservations`),
     * y hasta S6 era la que no lo manejaba: no tenía `catch`, así que un `40P01` contra el cron
     * —que iba al revés— llegaba a `cancelReservationAction`, que tampoco tiene `catch`, y el dueño
     * terminaba en el error boundary del panel por una carrera. D1 del LEAD: se unificó el orden y
     * el deadlock que igual llegue se cuenta como carrera perdida.
     */
    if (isDeadlock(error)) {
      logError('reservation.cancel.deadlock', DEADLOCK, { tenantId: ctx.tenantId, listingId });
      return { ok: false, message: LOST_RACE };
    }
    throw error;
  }

  if (!released) return { ok: false, message: LOST_RACE };

  invalidateStorefrontUnit(tenant.slug, listingId);

  logEvent('listing.reservation_cancelled', {
    tenantId: ctx.tenantId,
    listingId,
  });

  return { ok: true };
}
