import 'server-only';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Condition } from '@istock/domain';
import { decimalToCents, tradeinLeads } from '@istock/db';
import { withTenantDb, type TenantContext } from '../db/session';
import type { TradeinStatus } from './status';

/**
 * Lecturas del inbox de canjes.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  `offer_usd` e `internal_notes` NO ESTÁN EN EL OBJETO que recibe un `seller`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `CLAUDE.md` §0.9: *"Seller no ve costo ni margen. Nunca. Ni en el payload, ni en API, ni en
 * DTO."* Y `offer_usd` **es** el costo: es lo que el dueño paga por el equipo del visitante, o sea
 * exactamente lo que `accept-to-stock` escribe en `listings.cost_usd`. Que la columna se llame
 * distinto no la hace otro dato.
 *
 * Hay tres formas de "cumplir" esa regla y dos son falsas:
 *
 * | forma | qué queda en el payload RSC | veredicto |
 * |---|---|---|
 * | traer la fila y no renderizar la columna | el costo, legible con el inspector | **fallo de slice** |
 * | traer la fila y mapear a `null` | nada, pero un `select` que sí pidió el costo | frágil |
 * | **no pedirlo en el SQL** | nada, y el SQL tampoco lo nombra | lo que hace este archivo |
 *
 * Esta versión va un paso más allá que `listings/queries.ts`, que devuelve `costUsdCents: null`
 * para el `seller`. Acá el tipo es una **unión discriminada por `canSeeOffer`**: en la rama del
 * `seller` las claves `offerUsdCents` e `internalNotes` no existen —`'offerUsdCents' in row` es
 * `false`, no `undefined`—, así que TypeScript obliga a estrechar antes de leerlas y un
 * `JSON.stringify` de la fila no puede tener la clave ni con valor nulo. Es la diferencia entre
 * "el campo viajó vacío" y "el campo no viajó", y el test se escribe sobre el objeto, no sobre el
 * render.
 *
 * ── Lo que el `seller` SÍ ve, y por qué ──────────────────────────────────────────────────────
 * Nombre y WhatsApp del visitante. No es un descuido: el `seller` es quien atiende el mostrador y
 * devuelve el mensaje, y un lead sin forma de contestarlo no es un lead. §0.9 habla de **costo y
 * margen**, no de PII, y la PII del lead está protegida por otra cosa: RLS de tenant, prohibición
 * de log (`_lib/log.ts` tira si el campo se llama `phone`/`name`) y prohibición de DTO público.
 *
 * ── Las dos capas de tenant ───────────────────────────────────────────────────────────────────
 * `withTenantDb` prende RLS (`tradein_leads_tenant_select`) **y** cada `where` lleva su
 * `eq(tradeinLeads.tenantId, ctx.tenantId)` explícito. `CLAUDE.md` §2: las dos, siempre.
 *
 * ── Hoy la única capa de rol es ÉSTA ─────────────────────────────────────────────────────────
 * Las policies de `tradein_leads` son cuatro y ninguna mira `membership_role`: el predicado es
 * `tenant_id = <claim>` y nada más, y `authenticated` tiene `SELECT` sobre las 17 columnas,
 * `offer_usd` incluida. O sea: **a nivel de base, un `seller` autenticado puede leer el costo**.
 * La policy por rol es S11 y es de `db-agent`. Hasta que exista, la regla 9 sobre esta tabla la
 * sostiene este archivo. Está reportado al LEAD como P5; no es un `TODO` escondido.
 */

/** Techo de la primera pantalla. Mismo criterio que `STOCK_PAGE_SIZE`. */
export const TRADEIN_PAGE_SIZE = 100;

/** Lo que ve cualquier rol. Ni una columna sensible acá adentro. */
export interface TradeinLeadCommon {
  readonly id: string;
  readonly status: TradeinStatus;
  /** PII del visitante: no cruza a un DTO público, a un log ni al chatbot. */
  readonly customerName: string;
  /** PII del visitante. Es el `wa.me` con el que el mostrador contesta. */
  readonly customerWaPhone: string;
  readonly modelText: string;
  readonly storageGb: number | null;
  readonly color: string | null;
  readonly declaredCondition: Condition | null;
  readonly batteryPct: number | null;
  readonly notes: string | null;
  /** La unidad que creó `acceptToStock`, o `null` si el lead todavía no se aceptó. */
  readonly createdListingId: string | null;
  readonly createdAt: Date;
}

/** El objeto que recibe un `seller`. Sin `offerUsdCents`, sin `internalNotes`, no en `null`: ausentes. */
export interface TradeinLeadForSeller extends TradeinLeadCommon {
  readonly canSeeOffer: false;
}

export interface TradeinLeadForOwner extends TradeinLeadCommon {
  readonly canSeeOffer: true;
  /** SENSITIVE. El costo de la unidad que va a nacer. Sólo `owner`. */
  readonly offerUsdCents: number | null;
  /** SENSITIVE. Sólo `owner`. */
  readonly internalNotes: string | null;
}

export type TradeinLead = TradeinLeadForSeller | TradeinLeadForOwner;

/**
 * Las columnas que se piden **siempre**. Se declara una vez y se usa en las dos queries para que
 * agregar un campo a la lista no pueda agregarlo por accidente sólo en una.
 */
const COMMON_COLUMNS = {
  id: tradeinLeads.id,
  status: tradeinLeads.status,
  customerName: tradeinLeads.customerName,
  customerWaPhone: tradeinLeads.customerWaPhone,
  modelText: tradeinLeads.modelText,
  storageGb: tradeinLeads.storageGb,
  color: tradeinLeads.color,
  declaredCondition: tradeinLeads.declaredCondition,
  batteryPct: tradeinLeads.batteryPct,
  notes: tradeinLeads.notes,
  createdListingId: tradeinLeads.createdListingId,
  createdAt: tradeinLeads.createdAt,
} as const;

/**
 * El inbox: los canjes que entraron, lo último arriba.
 *
 * El costo viaja en una **segunda query que sólo corre si el rol es `owner`**. Para un `seller` el
 * SQL que llega a Postgres no menciona `offer_usd` ni `internal_notes` en ningún lado.
 */
export async function listTradeinLeads(ctx: TenantContext): Promise<readonly TradeinLead[]> {
  return withTenantDb(ctx, async (tx) => {
    const rows = await tx
      .select(COMMON_COLUMNS)
      .from(tradeinLeads)
      .where(eq(tradeinLeads.tenantId, ctx.tenantId))
      .orderBy(desc(tradeinLeads.createdAt))
      .limit(TRADEIN_PAGE_SIZE);

    if (rows.length === 0) return [];
    if (ctx.role !== 'owner') return rows.map(sellerView);

    const ids = rows.map((row) => row.id);
    const requestedIds = sql`ARRAY[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}]::uuid[]`;
    const sensitive = (await tx.execute<{
      tradein_lead_id: string;
      offer_usd: string | null;
      internal_notes: string | null;
    }>(sql`
      SELECT sensitive.tradein_lead_id, sensitive.offer_usd::text, sensitive.internal_notes
      FROM unnest(${requestedIds}) AS requested(lead_id)
      CROSS JOIN LATERAL public.owner_get_tradein_sensitive(
        ${ctx.tenantId}::uuid,
        requested.lead_id
      ) AS sensitive
    `)) as unknown as readonly {
      tradein_lead_id: string;
      offer_usd: string | null;
      internal_notes: string | null;
    }[];

    const byId = new Map(sensitive.map((row) => [row.tradein_lead_id, row]));
    return rows.map((row) => {
      const extra = byId.get(row.id);
      return {
        ...row,
        canSeeOffer: true,
        offerUsdCents: extra?.offer_usd === null || extra === undefined ? null : decimalToCents(extra.offer_usd),
        internalNotes: extra?.internal_notes ?? null,
      } satisfies TradeinLeadForOwner;
    });
  });
}

/**
 * Un canje por id, o `null`.
 *
 * `null` tapa los dos casos —no existe / es de otro tenant— sin distinguirlos, igual que
 * `loadUnitWithPhotos`. Un 403 con mensaje distinto le confirmaría a alguien de otro negocio que
 * ese id existe.
 */
export async function loadTradeinLead(
  ctx: TenantContext,
  leadId: string,
): Promise<TradeinLead | null> {
  return withTenantDb(ctx, async (tx) => {
    const rows = await tx
      .select(COMMON_COLUMNS)
      .from(tradeinLeads)
      .where(and(eq(tradeinLeads.tenantId, ctx.tenantId), eq(tradeinLeads.id, leadId)))
      .limit(1);

    const row = rows[0];
    if (row === undefined) return null;
    if (ctx.role !== 'owner') return sellerView(row);

    const sensitive = (await tx.execute<{
      tradein_lead_id: string;
      offer_usd: string | null;
      internal_notes: string | null;
    }>(sql`
      SELECT tradein_lead_id, offer_usd::text, internal_notes
      FROM public.owner_get_tradein_sensitive(${ctx.tenantId}::uuid, ${leadId}::uuid)
    `)) as unknown as readonly {
      tradein_lead_id: string;
      offer_usd: string | null;
      internal_notes: string | null;
    }[];

    const extra = sensitive[0];
    return {
      ...row,
      canSeeOffer: true,
      offerUsdCents: extra?.offer_usd === null || extra === undefined ? null : decimalToCents(extra.offer_usd),
      internalNotes: extra?.internal_notes ?? null,
    } satisfies TradeinLeadForOwner;
  });
}

/**
 * El objeto del `seller`. Se construye campo por campo **a propósito**: un `{ ...row }` sobre el
 * resultado de la query común sería equivalente hoy y dejaría de serlo el día que alguien sume una
 * columna sensible a `COMMON_COLUMNS`. Acá esa columna no se copiaría, y el `satisfies` no
 * compilaría si además la agregaran al tipo.
 */
function sellerView(row: TradeinLeadCommon): TradeinLeadForSeller {
  return {
    id: row.id,
    status: row.status,
    customerName: row.customerName,
    customerWaPhone: row.customerWaPhone,
    modelText: row.modelText,
    storageGb: row.storageGb,
    color: row.color,
    declaredCondition: row.declaredCondition,
    batteryPct: row.batteryPct,
    notes: row.notes,
    createdListingId: row.createdListingId,
    createdAt: row.createdAt,
    canSeeOffer: false,
  };
}
