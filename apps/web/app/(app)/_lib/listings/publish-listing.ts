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
import { listingEvents, reservations } from '@istock/db';
import { DEADLOCK, isDeadlock, uniqueViolationConstraint } from '../db/pg-error';
import { withTenantDb, type TenantContext } from '../db/session';
import {
  FEATURE_RESERVATIONS,
  featureAccess,
  type FeatureAccess,
  type PlanSnapshot,
} from '../entitlements';
import { logError, logEvent } from '../log';
import { loadActiveReservation } from '../reservations/queries';
import { recordSale } from '../sales/record-sale';
import type { SaleFields } from '../sales/schema';
import type { ActiveSession } from '../session';
import { invalidateStorefrontUnit } from '../tenants/storefront-cache';
import { loadUnitForTransition, type UnitForTransition } from './queries';
import { transitionListingStatus } from './transition-listing-status';

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
 * La palanca fina: hay una fila en `entitlements` en `false`, o sea que **alguien se la apagó a mano
 * a este negocio**. No es lo mismo que no tenerla contratada, y el copy no puede mentir sobre eso:
 * quien recibe este mensaje puede estar pagando el plan Negocio, así que *"Eso viene con el plan
 * Negocio"* lo manda a comprar lo que ya tiene. Mismo error que `TRIAL_OVER` corrige para el otro
 * motivo.
 *
 * Por eso el texto no habla de planes: dice **dónde** está apagado (su cuenta), niega la lectura
 * equivocada antes de que la haga, y termina en lo único accionable parado en un mostrador — hay
 * alguien a quien escribirle y esto se prende. No promete un plazo: nadie del otro lado se
 * comprometió a uno.
 */
const FEATURE_OFF =
  'Las reservas están apagadas en tu cuenta. No es el plan: escribinos y te las prendemos.';

/**
 * Motivo del dominio → castellano rioplatense. Le habla a alguien parado en el mostrador.
 *
 * ── Qué significa que `access` sea opcional (reescrito el 2026-08-28) ────────────────────────
 * Este párrafo decía que sin el dato se usa el texto del plan *"que es el caso mayoritario"*. Con
 * dos motivos era una estadística defendible; con tres es adivinar, así que la razón real es otra y
 * es de call sites: **todo camino que puede terminar en `entitlement_required` pasa `access`** —
 * `transitionUnit()` y `reserveUnit()`, que ya tuvieron que resolver la feature para armar el
 * `TransitionContext`, así que no les cuesta una query. Los que lo omiten chequean aristas que **no
 * piden entitlement**: `cancelReservation()` (soltar), `stock/_ui/unit-row.tsx` y
 * `stock/[id]/fotos` (publicar un borrador). Ahí `entitlement_required` no es un caso que ocurra.
 *
 * Si igual ocurriera, el default es el texto del plan. No por probable, sino porque es el único de
 * los tres que no le atribuye al negocio algo que no se verificó: `trial_expired` afirma que tuvo la
 * feature y la perdió, `flag_off` afirma que alguien se la apagó. `plan` sólo afirma lo que ya se
 * sabe por haber llegado hasta acá — que hoy no la tiene.
 */
export function denyReasonText(
  reason: TransitionDenyReason,
  access: FeatureAccess = { ok: true },
): string {
  if (reason === 'entitlement_required' && !access.ok) {
    switch (access.reason) {
      case 'trial_expired':
        return TRIAL_OVER;
      case 'flag_off':
        return FEATURE_OFF;
      case 'plan':
        // El texto del plan, abajo. Es el único motivo para el que ese texto es cierto.
        break;
      default: {
        // Un motivo nuevo en `FeatureAccess` rompe **en compilación**, acá, y no en el mostrador
        // con el copy equivocado. Es la única forma de que agregar un motivo obligue a decidir su
        // texto: sin esto, el motivo nuevo caería en silencio al mensaje del plan, que es
        // exactamente el bug que `flag_off` vino a cerrar.
        const exhaustive: never = access.reason;
        return exhaustive;
      }
    }
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
    /**
     * Sólo lo produce `checkConfirmSale` (verificado con `grep` sobre `packages/domain`), o sea:
     * alguien quiso marcar vendida una unidad `reserved` cuya seña **venció** —o que directamente
     * no tiene fila viva—. El texto anterior ("No tiene una reserva activa") describía el estado y
     * dejaba a alguien parado en el mostrador, con el comprador enfrente, sin saber qué apretar:
     * la unidad **dice** "Reservado" en la pantalla, así que la frase encima parecía un error del
     * sistema. El dominio niega `reserved → sold` a propósito y obliga a pasar por `available`
     * primero, y `checkRelease()` aprueba esa salida tanto con la reserva vencida como con el
     * botón de soltar. Ese es el camino, y el copy lo dice.
     */
    case 'reservation_not_active':
      return 'Se venció la seña. Soltá la reserva y marcalo vendido de nuevo.';
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
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  D5 · Vender sin datos de venta NO COMPILA
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * El destino y los datos de la venta viajan en **un solo valor**, no en dos parámetros. La unión
 * está discriminada por `to`, así que el compilador tiene exactamente dos formas de aceptar un
 * `TransitionRequest`, y ninguna deja pasar el bug de S7:
 *
 *   · `{ to: 'sold' }` a secas → `Property 'sale' is missing`. No hay default, no hay `?`.
 *   · `{ to: 'draft', sale: {...} }` → `sale?: never` lo rechaza. Es el error simétrico y también
 *     es un bug: datos de venta en una arista que **no** crea venta significa que el call site
 *     cree que vendió y no vendió.
 *
 * ── Por qué no se puede eludir ───────────────────────────────────────────────────────────────
 *
 * 1. **No hay un `to: ListingStatus` suelto que sirva.** Un call site que tenga en la mano un
 *    `ListingStatus` ancho —típicamente salido de un `z.enum` o de un `form.get()`— no es
 *    asignable a **ninguna** de las dos ramas: `'sold' | 'draft'` no encaja en
 *    `Exclude<ListingStatus, 'sold'>` ni en `'sold'`. Está obligado a **estrechar**, y en la rama
 *    en la que estrecha a `'sold'` el compilador le pide `sale`. Ése es todo el mecanismo: el
 *    lugar donde se decide el destino es el mismo donde hay que tener los datos.
 * 2. **Un campo opcional en `TransitionExtras` no habría servido**, y es la codificación que la
 *    spec descarta por su nombre: `sale?: SaleFields` compila igual con y sin el campo, o sea
 *    reproduce el defecto de origen —un efecto que el dominio declara (`createsSale`) y el call
 *    site omite en silencio—. La unión no tiene forma de omitirlo en silencio: omitirlo es un
 *    error de tipos.
 * 3. **Sobrecargas tampoco**, por otro motivo: una sobrecarga se elude pasando el argumento por
 *    una variable de tipo ancho, porque la resolución mira el tipo del argumento y no obliga a
 *    estrechar antes. La unión discriminada obliga en el call site.
 * 4. **El `as` sigue existiendo, y contra eso no hay tipo que alcance.** Por eso la afirmación no
 *    vive sólo acá: `transitionUnit()` compara `effects.createsSale` contra los datos que recibió
 *    **en runtime** (abajo) y aborta si discrepan, y `sales_one_sale_per_listing` la sostiene en
 *    el motor. El tipo evita el olvido; las otras dos capas evitan la mentira.
 *
 * `SaleFields` se reusa de `_lib/sales/schema.ts` a propósito: es exactamente lo que el Zod del
 * borde produce, así que el tipo de esta función y el parseo del formulario no pueden divergir.
 * Lo que **no** está acá y no puede estar es el costo — D2/D6: no entra por el request, se copia
 * de `listings` adentro de la transacción y nunca pasa por el heap de Node.
 */
export type TransitionRequest =
  | { readonly to: Exclude<ListingStatus, 'sold'>; readonly sale?: never }
  | { readonly to: 'sold'; readonly sale: SaleFields };

/**
 * La unidad ya tiene una venta registrada. Lo levanta el `23505` de `sales_one_sale_per_listing`
 * (D8), que es la misma clase de mensaje que `reserveUnit()` da para
 * `reservations_one_active_per_listing`: no es un error del que aprieta, es que llegó segundo.
 *
 * En la práctica casi no se ve —`sold` es terminal y el `eq(status, from)` corta antes—, pero
 * "casi" no es "nunca": dos pestañas confirmando la misma venta al mismo tiempo pasan las dos por
 * el `update` sólo si una hace rollback, y el índice es la última palabra.
 */
export const ALREADY_SOLD = 'Ese equipo ya figura vendido. Recargá la pantalla.';

/** El índice único de D8. Se nombra una vez para que el `catch` no compare contra un literal suelto. */
const ONE_SALE_PER_LISTING = 'sales_one_sale_per_listing';

/**
 * El tipo (D5) y el dominio (`createsSale`) discrepan sobre si esta transición es una venta. No
 * debería poder pasar: la unión de arriba ata `to === 'sold'` con la presencia de `sale`, y
 * `transitionEffects()` deriva `createsSale` del mismo `to`. Si igual pasa, es que alguien entró
 * con un `as` o que el dominio cambió la regla, y en los dos casos la respuesta correcta es **no
 * mover el listing**: `sold` es terminal, así que una venta a medias no tiene arista de salida
 * (D1). Se corta antes de abrir la transacción.
 */
export const SALE_NOT_RECORDED = 'No pudimos registrar la venta. Probá de nuevo.';

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
 *
 * Desde S7 la cadena es `listings` → `reservations` → `sales`, y el orden no es arbitrario: la
 * venta necesita el id de la reserva que **esta misma transacción** acaba de cerrar, así que
 * escribirla antes sería no poder enlazarla.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  El CUARTO efecto: `createsSale` (S7)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `transitionEffects()` declara cuatro efectos y esta función ejecutaba tres. `createsSale` se
 * descartaba en silencio: la unidad quedaba `sold`, la reserva `confirmed`, la vidriera purgada, y
 * la tabla `sales` vacía. Misma clase que T18 —un efecto que el dominio declara y la aplicación
 * cumple a medias—, y peor por dónde termina: `sold` es **terminal**, así que la unidad quedaba sin
 * venta y **sin arista para volver**. Por eso la fila de `sales` va adentro de esta transacción
 * (D1) y no en una función que se llame después.
 *
 * Lo que la venta NO devuelve: `cost_usd`, `margin_usd` ni `internal_notes` (D6). El
 * `PublishOutcome` de este camino es el mismo `{ ok: true, status }` que el de publicar. No es que
 * se filtren por rol —`session.role` existe y `stock/nuevo/actions.ts` ya lo usa—: es que **el dato
 * no sale de Postgres**, así que no hay a quién ocultárselo ni `if` que alguien pueda invertir el
 * día que S11 rehaga los permisos del panel. Ver `_lib/sales/record-sale.ts`.
 */
export async function transitionUnit(
  actor: PanelActor,
  listingId: string,
  request: TransitionRequest,
  now: Date = new Date(),
): Promise<PublishOutcome> {
  const { ctx, tenant } = actor;
  const to: ListingStatus = request.to;
  /**
   * Se estrecha **una vez**, acá, y de ahí en más el camino de venta se pregunta por `sale !== null`
   * en vez de re-comparar `to === 'sold'` en cada punto. Dos derivaciones de la misma regla es
   * exactamente cómo nació el defecto que esta slice cierra.
   */
  const sale: SaleFields | null = request.to === 'sold' ? request.sale : null;

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

  /**
   * El dominio y el tipo tienen que estar de acuerdo sobre si esto es una venta. No es un chequeo
   * defensivo por las dudas: es la misma forma en que `cancelReservation()` trata un
   * `closesReservationAs === null` inesperado. Un `&&` silencioso acá dejaría pasar justo el bug de
   * origen —mover el listing a `sold` sin escribir la venta— disfrazado de éxito.
   */
  if (effects.createsSale !== (sale !== null)) {
    logError('listing.transition.sale_effect_mismatch', 'sale_effect_mismatch', {
      tenantId: ctx.tenantId,
      listingId,
      from,
      to,
    });
    return { ok: false, message: SALE_NOT_RECORDED };
  }

  let updated: boolean;
  try {
    updated = await withTenantDb(ctx, async (tx) => {
      // El RPC actualiza status/updated_at y conserva el guard optimista dentro de esta transacción.
      // Si otro dispositivo ganó, devuelve 0 y no se escriben efectos derivados.
      const moved = await transitionListingStatus(tx, ctx, listingId, from, to);
      if (!moved) return false;

      /**
       * Se cierra **la** reserva activa de esta unidad, sin nombrarla por id: el índice único
       * parcial garantiza que hay a lo sumo una, y el id que teníamos es de antes de la
       * transacción. El guard `status = 'active'` la hace idempotente contra el cron corriendo al
       * mismo tiempo.
       */
      let closedReservationId: string | null = null;
      if (effects.closesReservationAs !== null) {
        const closed = await tx
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
          )
          .returning({ id: reservations.id });
        /**
         * El `returning` es lo que ata la venta a **la** reserva que se convirtió, sin una segunda
         * lectura: el id que se leyó antes de la transacción puede ser de una reserva que el cron
         * venció mientras tanto. Si el `update` no tocó nada —el cron ganó de mano— queda `null`,
         * que es lo que `sales.reservation_id` significa: venta directa, sin seña previa. No se
         * aborta por eso; el estado del listing ya se movió y la venta ocurrió igual.
         */
        closedReservationId = closed[0]?.id ?? null;
      }

      /**
       * D1 · La venta se escribe **acá adentro**, con el `tx` abierto. `recordSale()` no puede
       * llamarse de otra forma: recibe la transacción como primer parámetro, así que no existe la
       * versión "después del commit" de esta línea.
       */
      if (sale !== null) {
        await recordSale(tx, ctx, {
          listingId,
          reservationId: closedReservationId,
          priceUsdCents: sale.priceUsdCents,
          paymentMethod: sale.paymentMethod,
        });
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

    /**
     * D8 en el motor. Mismo tratamiento que `reserveUnit()` le da a
     * `reservations_one_active_per_listing`: un `23505` de este índice no es un 500, es que otra
     * pestaña registró la venta primero. Se compara el **nombre** de la constraint —no se mapea
     * cualquier `23505`— para no tapar una violación de unicidad distinta con un mensaje que
     * mentiría sobre lo que pasó.
     */
    if (uniqueViolationConstraint(error) === ONE_SALE_PER_LISTING) {
      logError('listing.transition.already_sold', '23505', {
        tenantId: ctx.tenantId,
        listingId,
      });
      return { ok: false, message: ALREADY_SOLD };
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
