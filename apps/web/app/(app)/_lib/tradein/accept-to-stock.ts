import 'server-only';
import { randomFillSync, randomUUID } from 'node:crypto';
import { and, eq, ne, sql } from 'drizzle-orm';
import { listingEvents, listings, tradeinLeads } from '@istock/db';
import { pgErrorCode, uniqueViolationConstraint } from '../db/pg-error';
import { withTenantDb, type TenantContext } from '../db/session';
import { buildListingSlug } from '../listings/listing-slug';
import { logEvent } from '../log';
import type { AcceptTradeinField, AcceptTradeinInput } from './schema';
import { ACCEPTED } from './status';

/**
 * Aceptar un canje = **crear la unidad en `draft` con su costo** y dejar el lead atado a ella.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  1. Es UNA transacción. Las dos mitades, o ninguna.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `withTenantDb` **es** la transacción (abre `db().transaction()`), así que las tres sentencias de
 * abajo entran o no entra ninguna. La alternativa —crear el listing, y en otra llamada mover el
 * lead— compila igual de bien y es exactamente el bug: deja una unidad en el stock que nadie sabe
 * de dónde salió, o un lead marcado como aceptado que no tiene equipo. Mismo argumento que
 * `recordSale()`, y acá es peor: `tradein_leads.created_listing_id` es la **única** manera de
 * saber que esa unidad vino de un canje (ver §"lo que falta en el motor").
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  2. Aceptar dos veces NO crea dos unidades.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * El `update` del lead va **primero** y lleva `status <> 'accepted'` en el `where`. Es el mismo
 * guard de concurrencia que usa `transitionUnit()`: si vuelven cero filas, alguien ya lo aceptó y
 * la transacción entera se cae antes de insertar nada. Dos pestañas apretando el botón a la vez se
 * serializan solas —la segunda espera el lock de la fila, ve el `accepted` nuevo y no matchea—, y
 * el `POST` repetido de quien recarga la pantalla tampoco duplica.
 *
 * Va primero **a propósito**. Con el `insert` adelante también sería correcto (el rollback se lleva
 * el listing huérfano), pero se quemaría un slug y un id por cada intento perdido, y el momento en
 * que la carrera se decide quedaría tres sentencias más tarde de donde se lee.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  3. `offer_usd` → `cost_usd`: el costo viaja de columna a columna.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Lo que el dueño paga por el equipo del visitante **es** el costo de la unidad. El `insert` lo
 * copia con un **subselect** contra el lead que se acaba de actualizar y lockear en esta misma
 * transacción, en vez de volver a escribir el número que trajo el formulario. Doctrina de
 * `recordSale()`, y acá suma dos cosas concretas:
 *
 *   1. Hace **cierto en el SQL** que es el mismo dato. Si mañana el costo se carga en otra pantalla
 *      y el form de aceptar deja de pedirlo, esta línea sigue estando bien sin tocarla.
 *   2. Es exacto sin ida y vuelta: `numeric(12, 2)` → `numeric(12, 2)`, sin pasar por centavos.
 *
 * Lleva `tenant_id` **además** de correr bajo RLS (`CLAUDE.md` §2) y está escrito con los nombres
 * de Postgres para que `W015` lo pueda leer. `margin_usd` no se nombra: es
 * `generatedAlwaysAs(price_usd - cost_usd)` y Postgres rechaza un `INSERT` que la mencione.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  4. La unidad nace en `draft`. Siempre.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Un equipo que acaba de entrar por canje **no tiene fotos** y nadie lo revisó todavía. Nace
 * `draft`, y por eso esta función **no** invalida el cache de la vidriera: no hay nada que un
 * visitante anónimo vea distinto (`listings_storefront_select` exige estado público **y**
 * `published_at is not null`). La invalidación vive en `publish-listing.ts`, que es donde el equipo
 * efectivamente entra o sale de la vidriera. Mismo criterio, escrito, que `createUnit()`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  5. Sólo `owner`. Y lo que hoy NO sostiene la base.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Aceptar escribe un costo, así que lo hace un `owner` (`CLAUDE.md` §0.9). El chequeo está acá
 * **además** de en la Server Action: esta función es exportada y un caller nuevo no tiene por qué
 * acordarse. Se devuelve como fallo y no se tira, para que la pantalla pueda decirlo en castellano
 * en vez de romper con un 500.
 *
 * Lo que la base **no** sostiene hoy: las policies de `tradein_leads` son `tenant_id = <claim>` y
 * nada más — ninguna mira `membership_role`, y `authenticated` tiene `SELECT`/`UPDATE` sobre las 17
 * columnas, `offer_usd` incluida. La policy por rol es S11 y es de `db-agent`. Está reportado como
 * P5; no es un `TODO` disfrazado de comentario.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  6. Lo que falta en el motor (pedido a `db-agent`, no escrito acá)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * - **`listings.acquisition_channel` no existe.** No hay columna ni enum: medido en el schema, en
 *   `grep` sobre el repo y contra la base. Mientras tanto la procedencia queda en dos lados que sí
 *   existen: `tradein_leads.created_listing_id` (el vínculo duro) y un `listing_events` con
 *   `metadata.source = 'tradein'` (la bitácora). Ninguno de los dos es un índice por canal.
 * - **Falta un `CHECK` que ate `status = 'accepted'` a `created_listing_id is not null`.** Hoy la
 *   afirmación vive sólo en esta función, o sea en el borde, que es exactamente lo que ADR-025 dice
 *   que no alcanza cuando aparezca un segundo caller.
 */

export interface AcceptTradeinResult {
  readonly ok: true;
  readonly listingId: string;
  readonly slug: string;
}

export interface AcceptTradeinFailure {
  readonly ok: false;
  readonly field: AcceptTradeinField;
  readonly message: string;
}

export type AcceptTradeinOutcome = AcceptTradeinResult | AcceptTradeinFailure;

/**
 * El lead no se puede aceptar (no existe, es de otro tenant, o ya lo aceptaron). Se tira para que
 * la transacción se caiga entera; lo atrapa el `catch` de abajo y sale como fallo con mensaje.
 * Es una clase y no un string centinela para que `instanceof` distinga esto de un error de
 * Postgres sin comparar mensajes.
 */
class AcceptBlocked extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AcceptBlocked';
  }
}

const NOT_FOUND = 'Ese canje no existe o ya no está disponible.';
const ALREADY_ACCEPTED = 'Ese canje ya lo aceptaron. Buscá la unidad en el stock.';
const NOT_OWNER = 'Sólo el dueño puede aceptar un canje: define el costo del equipo.';
const SLUG_EXHAUSTED = 'No pudimos generar un link para ese nombre. Cambialo un poco.';
const NO_CATALOG_MODEL = 'Elegí el modelo del equipo.';

/** Violación de FK. En este `insert` la única que depende de lo que escribió una persona es el modelo. */
const FOREIGN_KEY_VIOLATION = '23503';

function newSlug(title: string): string {
  return buildListingSlug(title, randomFillSync(new Uint8Array(8)));
}

export async function acceptToStock(
  ctx: TenantContext,
  input: AcceptTradeinInput,
): Promise<AcceptTradeinOutcome> {
  if (ctx.role !== 'owner') {
    return { ok: false, field: 'form', message: NOT_OWNER };
  }

  /**
   * El reintento envuelve a la **transacción entera**, no a una sentencia. Un `23505` de slug
   * aborta la transacción en Postgres: seguir adentro del mismo bloque requeriría un savepoint por
   * intento. Reintentar de cero es más simple y no tiene efecto acumulado — la transacción anterior
   * se deshizo, así que el lead volvió a quedar como estaba.
   */
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const listingId = randomUUID();
    const slug = newSlug(input.title);

    try {
      await withTenantDb(ctx, async (tx) => {
        // ── 1. El guard de concurrencia. Primero, y con `status <> 'accepted'`. ──────────────
        const claimed = await tx
          .update(tradeinLeads)
          .set({
            status: ACCEPTED,
            offerUsd: input.offerUsd,
            handledBy: ctx.userId,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(tradeinLeads.tenantId, ctx.tenantId),
              eq(tradeinLeads.id, input.leadId),
              ne(tradeinLeads.status, ACCEPTED),
            ),
          )
          .returning({ id: tradeinLeads.id });

        if (claimed.length === 0) {
          /**
           * Cero filas son dos casos distintos y la persona necesita mensajes distintos: "no
           * existe" manda a la lista, "ya lo aceptaron" manda al stock. La segunda lectura corre
           * sólo en el camino de fallo y también lleva sus dos capas de tenant.
           */
          const existing = await tx
            .select({ status: tradeinLeads.status })
            .from(tradeinLeads)
            .where(and(eq(tradeinLeads.tenantId, ctx.tenantId), eq(tradeinLeads.id, input.leadId)))
            .limit(1);

          throw new AcceptBlocked(existing.length === 0 ? NOT_FOUND : ALREADY_ACCEPTED);
        }

        // ── 2. La unidad. `draft`, y el costo copiado de columna a columna. ─────────────────
        await tx.insert(listings).values({
          id: listingId,
          tenantId: ctx.tenantId,
          slug,
          kind: 'unit',
          title: input.title,
          catalogModelId: input.catalogModelId,
          storageGb: input.storageGb,
          color: input.color,
          condition: input.condition,
          batteryPct: input.batteryPct,
          priceUsd: input.priceUsd,
          costUsd: sql`(select offer_usd from tradein_leads where id = ${input.leadId} and tenant_id = ${ctx.tenantId})`,
          qty: 1,
          status: 'draft',
          createdBy: ctx.userId,
        });

        // ── 3. El vínculo. Va acá y no en (1) porque la FK no es DEFERRABLE: la fila de
        //      `listings` tiene que existir antes de que nadie la pueda referenciar. ─────────
        await tx
          .update(tradeinLeads)
          .set({ createdListingId: listingId })
          .where(and(eq(tradeinLeads.tenantId, ctx.tenantId), eq(tradeinLeads.id, input.leadId)));

        /**
         * Bitácora. `metadata` **nunca** lleva IMEI, costo ni notas internas (`events.ts`), y acá
         * tampoco lleva el nombre ni el WhatsApp del visitante: es PII y ésta es la tabla que después
         * alimenta pantallas de historial. `source` es de dónde vino la unidad, que es el dato que
         * `listings.acquisition_channel` guardaría si existiera.
         */
        await tx.insert(listingEvents).values({
          tenantId: ctx.tenantId,
          listingId,
          kind: 'created',
          toStatus: 'draft',
          actorUserId: ctx.userId,
          metadata: { source: 'tradein', kind: 'unit' },
        });
      });

      // Ids y estado. Ni el costo, ni la oferta, ni el nombre o el WhatsApp del visitante.
      logEvent('tradein.accepted', {
        tenantId: ctx.tenantId,
        leadId: input.leadId,
        listingId,
        status: 'draft',
      });

      return { ok: true, listingId, slug };
    } catch (error) {
      if (error instanceof AcceptBlocked) {
        return { ok: false, field: 'form', message: error.message };
      }
      // El slug lleva sufijo aleatorio: una colisión es rarísima y se resuelve reintentando entero.
      if (uniqueViolationConstraint(error) === 'listings_tenant_slug_key') continue;
      if (pgErrorCode(error) === FOREIGN_KEY_VIOLATION) {
        return { ok: false, field: 'catalogModelId', message: NO_CATALOG_MODEL };
      }
      throw error;
    }
  }

  return { ok: false, field: 'title', message: SLUG_EXHAUSTED };
}
