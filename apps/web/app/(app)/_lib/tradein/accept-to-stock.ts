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
 * ── El `CONSTRAINT TRIGGER` de 0009 NO reemplaza este guard. No lo borres. ────────────────────
 * Desde `drizzle/0009_*` la base sostiene `tradein_leads_accepted_has_listing`: un lead en
 * `accepted` tiene `created_listing_id`. Es una invariante **por fila y de existencia**, y de ahí
 * sale exactamente lo que cubre y lo que no:
 *
 *   · el trigger impide **media** operación — un lead aceptado sin unidad;
 *   · el trigger **no** impide **dos operaciones completas**. Sin el `ne(status, 'accepted')` de
 *     abajo, un segundo `acceptToStock()` sobre el mismo lead insertaría una segunda unidad y
 *     repuntaría `created_listing_id` a ella: la fila final queda `accepted` **con** unidad, o sea
 *     el trigger la deja commitear feliz. Resultado: dos equipos en el stock por un solo canje, el
 *     primero huérfano y con un costo que ya no se puede atribuir a nada. No hay `unique` sobre
 *     `created_listing_id` ni vínculo inverso desde `listings`, así que la base **no tiene con qué**
 *     verlo. Este `where` es lo único que lo impide, y el caso *"el trigger de la base NO cubre
 *     esto"* de `accept-to-stock.test.ts` lo escribe a mano contra Postgres para probarlo.
 *
 * Y una consecuencia de forma: el `23514` del trigger **no se atrapa** más abajo, a propósito. Si
 * llegara a dispararse significa que esta función rompió su propia invariante, y para eso el
 * comportamiento correcto es un 500 ruidoso con traza, no un mensaje amable que tape una escritura
 * a medias. El fallo que la persona sí puede causar —aceptar dos veces— se atiende arriba, con
 * mensaje en castellano, antes de que el motor tenga que gritar.
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
 *  6. Lo que el motor ya sostiene (era el §6 de "lo que falta", y 0009 lo cerró)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Este bloque pedía dos cosas a `db-agent`. `drizzle/0009_*` las trajo, una tal cual y la otra con
 * otra herramienta, y queda escrito acá **qué cambió de este lado**:
 *
 * - **`listings.acquisition_channel` existe** (`enum purchase | trade_in | other`,
 *   `not null default 'purchase'`). El `insert` de arriba escribe `'trade_in'` **explícito**: el
 *   default es correcto para un alta a mano en el panel —cargarla es haberla comprado— y sería
 *   mentira para ésta. La procedencia deja de deducirse del join a `tradein_leads` (que arrastra
 *   PII) o del `jsonb` de la bitácora. El `listing_events` con `metadata.source = 'tradein'` se
 *   queda igual: es la línea de tiempo, no el estado.
 * - **`accepted` ⇒ hay unidad creada** lo sostiene `tradein_leads_accepted_has_listing`, un
 *   `CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED` y no el `CHECK` que este bloque pedía: un
 *   `CHECK` no se difiere, así que habría explotado en la sentencia (1) de esta misma función
 *   —donde el lead ya está `accepted` y todavía no hay unidad— y aceptar un canje sería un 500.
 *   Lo que **no** cubre, y por qué el guard de concurrencia sigue vivo, está en el §2.
 *
 * Lo que sigue faltando: la policy por rol de `tradein_leads` (§5, S11, reportado como P5).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  7. El canal se escribe, no se deduce.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `acquisitionChannel: 'trade_in'` es una línea y vale decir por qué no se dejó al default: el
 * default de la columna es `'purchase'`, así que **no escribirla haría que toda unidad nacida de un
 * canje se contara como una compra** — justo el caso por el que la columna se pidió. Drizzle nombra
 * todas las columnas en `insert().values()`, así que esto no cambia la forma de la sentencia: sólo
 * cambia el valor, de `default` a la verdad.
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
          // El canal es un hecho, no una deducción. Ver §7.
          acquisitionChannel: 'trade_in',
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
