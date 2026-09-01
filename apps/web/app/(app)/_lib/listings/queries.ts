import 'server-only';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Condition, ListingKind, ListingStatus } from '@istock/domain';
import { decimalToCents, listingPhotos, listings } from '@istock/db';
import { withTenantDb, type TenantContext } from '../db/session';

/**
 * Lecturas de stock del panel.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  `cost_usd` no se pide en la query del `seller`. No se esconde: no se pide.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `CLAUDE.md` §0.9 dice *"Seller no ve costo ni margen. Nunca. Ni en el payload"*. La forma
 * habitual de "cumplir" eso es traer la fila entera y no renderizar la columna: eso deja el costo
 * en el payload RSC, que se puede leer con el inspector abierto. Acá el costo viaja en una
 * **segunda query que sólo existe si el rol es `owner`**. El SQL que corre para un `seller` no
 * menciona `cost_usd` ni `margin_usd` en ningún lado, así que no hay nada que filtrar.
 *
 * Es más caro por una query. Es también la única versión que sigue siendo correcta el día que
 * alguien agregue un campo al `select` sin leer este comentario.
 *
 * ── Las dos capas de tenant ───────────────────────────────────────────────────────────────────
 * `withTenantDb` activa RLS (`listings_tenant_select`) **y** cada `where` lleva su
 * `eq(listings.tenantId, ctx.tenantId)` explícito. `CLAUDE.md` §2: las dos, siempre.
 *
 * ── `master_key` no se selecciona nunca ───────────────────────────────────────────────────────
 * Es la key del bucket **privado** (`istock-originals`). No la necesita ninguna pantalla, así que
 * no entra al payload de ninguna. La allowlist de columnas es la defensa; el comentario es el
 * recordatorio.
 */

/** Techo de la primera pantalla. Paginar es S4; traer 5.000 filas a un teléfono no es "simple". */
export const STOCK_PAGE_SIZE = 100;

/** Sólo las tres keys públicas: es exactamente lo que `variantUrl()` necesita. */
export interface UnitPhoto {
  readonly thumbKey: string;
  readonly cardKey: string;
  readonly detailKey: string;
  readonly alt: string | null;
}

interface UnitRowBase {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly kind: ListingKind;
  readonly status: ListingStatus;
  readonly condition: Condition;
  readonly storageGb: number | null;
  readonly color: string | null;
  readonly batteryPct: number | null;
  readonly priceUsdCents: number;
  readonly qty: number;
  readonly catalogModelId: string | null;
  readonly createdAt: Date;
  readonly photos: readonly UnitPhoto[];
  readonly photoCount: number;
}

/** El seller recibe sólo la allowlist pública; el campo sensible no existe en esta forma. */
export interface SellerUnitRow extends UnitRowBase {}

/** El owner puede recibir el costo, incluido `null` cuando todavía no fue cargado. */
export interface OwnerUnitRow extends UnitRowBase {
  readonly costUsdCents: number | null;
}

export type UnitRow = SellerUnitRow | OwnerUnitRow;

/** Devuelve el costo sólo cuando la fila tiene la forma owner; la forma seller no lo declara. */
export function ownerCostForRow(row: UnitRow): number | null {
  return 'costUsdCents' in row ? row.costUsdCents : null;
}

export async function listUnits(
  ctx: TenantContext & { readonly role: 'owner' },
): Promise<readonly OwnerUnitRow[]>;
export async function listUnits(
  ctx: TenantContext & { readonly role: 'seller' },
): Promise<readonly SellerUnitRow[]>;
export async function listUnits(ctx: TenantContext): Promise<readonly UnitRow[]>;
export async function listUnits(ctx: TenantContext): Promise<readonly UnitRow[]> {
  return withTenantDb(ctx, async (tx) => {
    const rows = await tx
      .select({
        id: listings.id,
        slug: listings.slug,
        title: listings.title,
        kind: listings.kind,
        status: listings.status,
        condition: listings.condition,
        storageGb: listings.storageGb,
        color: listings.color,
        batteryPct: listings.batteryPct,
        priceUsdCents: listings.priceUsd,
        qty: listings.qty,
        catalogModelId: listings.catalogModelId,
        createdAt: listings.createdAt,
      })
      .from(listings)
      .where(eq(listings.tenantId, ctx.tenantId))
      .orderBy(desc(listings.createdAt))
      .limit(STOCK_PAGE_SIZE);

    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);

    const photos = await tx
      .select({
        listingId: listingPhotos.listingId,
        thumbKey: listingPhotos.thumbKey,
        cardKey: listingPhotos.cardKey,
        detailKey: listingPhotos.detailKey,
        alt: listingPhotos.alt,
      })
      .from(listingPhotos)
      .where(and(eq(listingPhotos.tenantId, ctx.tenantId), inArray(listingPhotos.listingId, ids)))
      .orderBy(asc(listingPhotos.listingId), asc(listingPhotos.sortOrder));

    const byListing = new Map<string, UnitPhoto[]>();
    for (const photo of photos) {
      const list = byListing.get(photo.listingId) ?? [];
      list.push({
        thumbKey: photo.thumbKey,
        cardKey: photo.cardKey,
        detailKey: photo.detailKey,
        alt: photo.alt,
      });
      byListing.set(photo.listingId, list);
    }

    // Segunda query, sólo para `owner`. El seller no tiene ningún campo de costo en su objeto.
    const costs = new Map<string, number | null>();
    if (ctx.role === 'owner') {
      const requestedIds = sql`ARRAY[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}]::uuid[]`;
      const sensitive = (await tx.execute<{ listing_id: string; cost_usd: string | null }>(sql`
        SELECT sensitive.listing_id, sensitive.cost_usd::text
        FROM unnest(${requestedIds}) AS requested(listing_id)
        CROSS JOIN LATERAL public.owner_get_listing_cost(
          ${ctx.tenantId}::uuid,
          requested.listing_id
        ) AS sensitive
      `)) as unknown as readonly { listing_id: string; cost_usd: string | null }[];
      for (const row of sensitive) {
        costs.set(row.listing_id, row.cost_usd === null ? null : decimalToCents(row.cost_usd));
      }
    }

    return rows.map((row) => {
      const list = byListing.get(row.id) ?? [];
      const base = { ...row, photos: list, photoCount: list.length };
      if (ctx.role === 'owner') {
        return { ...base, costUsdCents: costs.get(row.id) ?? null };
      }
      return base;
    });
  });
}

/**
 * Una unidad por id, con lo que hace falta para decidir una transición de estado.
 * Existe separada de `listUnits` porque la acción de publicar **no puede** confiar en lo que se
 * renderizó: entre el render y el click pasa tiempo, y el `POST` lo puede armar cualquiera.
 */
export interface UnitForTransition {
  readonly id: string;
  readonly slug: string;
  readonly status: ListingStatus;
  readonly kind: ListingKind;
  readonly condition: Condition;
  readonly priceUsdCents: number;
  readonly qty: number;
  readonly catalogModelId: string | null;
  readonly photoCount: number;
}

/**
 * La unidad con sus fotos: lo que necesita `/app/stock/{id}/fotos` para dibujarse y para decidir
 * si el botón de publicar va habilitado.
 *
 * Devuelve `null` cuando la unidad no existe **o no es de este tenant**, sin distinguir los dos
 * casos. La pantalla lo convierte en 404. Un 403 con mensaje distinto le confirmaría a alguien de
 * otro negocio que ese id existe, que es exactamente el dato que no queremos regalar.
 *
 * Las dos capas de tenant, otra vez: RLS por `withTenantDb` **más** el `eq(tenantId)` explícito,
 * en las dos queries. `master_key` no se selecciona: es el bucket privado.
 */
export interface UnitWithPhotos extends UnitForTransition {
  readonly title: string;
  readonly condition: Condition;
  readonly photos: readonly UnitPhoto[];
}

export async function loadUnitWithPhotos(
  ctx: TenantContext,
  listingId: string,
): Promise<UnitWithPhotos | null> {
  return withTenantDb(ctx, async (tx) => {
    const rows = await tx
      .select({
        id: listings.id,
        slug: listings.slug,
        title: listings.title,
        status: listings.status,
        kind: listings.kind,
        condition: listings.condition,
        priceUsdCents: listings.priceUsd,
        qty: listings.qty,
        catalogModelId: listings.catalogModelId,
      })
      .from(listings)
      .where(and(eq(listings.tenantId, ctx.tenantId), eq(listings.id, listingId)))
      .limit(1);

    const row = rows[0];
    if (row === undefined) return null;

    const photos = await tx
      .select({
        thumbKey: listingPhotos.thumbKey,
        cardKey: listingPhotos.cardKey,
        detailKey: listingPhotos.detailKey,
        alt: listingPhotos.alt,
      })
      .from(listingPhotos)
      .where(and(eq(listingPhotos.tenantId, ctx.tenantId), eq(listingPhotos.listingId, listingId)))
      .orderBy(asc(listingPhotos.sortOrder));

    return { ...row, photos, photoCount: photos.length };
  });
}

export async function loadUnitForTransition(
  ctx: TenantContext,
  listingId: string,
): Promise<UnitForTransition | null> {
  return withTenantDb(ctx, async (tx) => {
    const rows = await tx
      .select({
        id: listings.id,
        slug: listings.slug,
        status: listings.status,
        kind: listings.kind,
        condition: listings.condition,
        priceUsdCents: listings.priceUsd,
        qty: listings.qty,
        catalogModelId: listings.catalogModelId,
      })
      .from(listings)
      .where(and(eq(listings.tenantId, ctx.tenantId), eq(listings.id, listingId)))
      .limit(1);

    const row = rows[0];
    if (row === undefined) return null;

    const photos = await tx
      .select({ id: listingPhotos.id })
      .from(listingPhotos)
      .where(
        and(eq(listingPhotos.tenantId, ctx.tenantId), eq(listingPhotos.listingId, listingId)),
      );

    return { ...row, photoCount: photos.length };
  });
}
