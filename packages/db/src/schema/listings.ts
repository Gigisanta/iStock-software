/**
 * `listings` — lo que se publica. `kind='unit'` (un equipo con IMEI) o `kind='lot'`
 * (N accesorios intercambiables, con `qty`). **Unidad vs lote desde el día 1** (CLAUDE.md §1).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  COLUMNAS SENSIBLES — `imei`, `cost_usd`, `margin_usd`, `supplier`, `internal_notes`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Ninguna de las cinco cruza a un DTO público, a un log, ni al contexto del chatbot.
 *  En la migración van con el marcador `-- SENSITIVE: never in public DTO` y además con un
 *  `COMMENT ON COLUMN` que empieza con `SENSITIVE:` — o sea que la marca es **consultable desde
 *  Postgres** (`col_description`), no un comentario que se pierde en un refactor. `src/schema.test.ts`
 *  lo verifica contra la base real.
 *
 *  `seller` **no ve costo ni margen. Nunca. Ni en el payload** (CLAUDE.md §0.9): el filtro ocurre
 *  en el `select` del server. Esconderlo en el componente es un fallo de seguridad, no de UI.
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { authUsers } from 'drizzle-orm/supabase';
import { moneyCents } from '../money';
import { createdAt, pk, updatedAt } from './columns';
import { tenantId } from './tenants';
import { catalogModels } from './catalog';
import { imeiCheckStatusEnum, listingConditionEnum, listingKindEnum, listingStatusEnum } from './enums';
import { tenantPolicies } from './rls';

export const listings = pgTable(
  'listings',
  {
    id: pk(),
    tenantId: tenantId(),
    /** Slug de la ficha dentro de la vidriera: `/p/{slug}`. Único por tenant. */
    slug: text('slug').notNull(),
    kind: listingKindEnum('kind').notNull().default('unit'),
    /** Global, sin tenant. `null` en accesorios que no son un modelo de catálogo. */
    catalogModelId: uuid('catalog_model_id').references(() => catalogModels.id, { onDelete: 'set null' }),

    title: text('title').notNull(),
    storageGb: integer('storage_gb'),
    color: text('color'),
    condition: listingConditionEnum('condition').notNull(),
    batteryPct: integer('battery_pct'),
    screenOriginal: boolean('screen_original'),
    icloudStatusText: text('icloud_status_text'),
    warrantyText: text('warranty_text'),
    provenanceText: text('provenance_text'),
    /** Texto libre del dueño → **input no confiable**. Se sanitiza antes de la ficha y del prompt. */
    description: text('description'),

    /** Público. `numeric(12, 2)` en SQL, centavos en TS. */
    priceUsd: moneyCents('price_usd').notNull(),

    // ── SENSITIVE: never in public DTO ────────────────────────────────────────────────────────
    /** SENSITIVE: never in public DTO. Ni el seller lo ve, ni siquiera en el payload. */
    costUsd: moneyCents('cost_usd'),
    /** SENSITIVE: never in public DTO. Derivada: `price_usd - cost_usd`, calculada por Postgres. */
    marginUsd: moneyCents('margin_usd').generatedAlwaysAs(sql`price_usd - cost_usd`),
    /** SENSITIVE: never in public DTO. */
    supplier: text('supplier'),
    /** SENSITIVE: never in public DTO. */
    internalNotes: text('internal_notes'),
    /** SENSITIVE: never in public DTO. **Nunca** en vidriera, ni en logs, ni en el chatbot. */
    imei: text('imei'),
    // ──────────────────────────────────────────────────────────────────────────────────────────

    // ADR-009 · atestación manual racionada, cero integración con ENACOM.
    imeiCheckStatus: imeiCheckStatusEnum('imei_check_status').notNull().default('not_checked'),
    /**
     * El texto **crudo** que mostró ENACOM, sin normalizar. No es opcional: es la única
     * mitigación real de "ENACOM cambia los textos". Sin esto, el día que cambien el copy no
     * hay forma de re-mapear el histórico.
     */
    imeiCheckStatusRaw: text('imei_check_status_raw'),
    imeiCheckedAt: timestamp('imei_checked_at', { withTimezone: true }),
    imeiCheckedBy: uuid('imei_checked_by').references(() => authUsers.id, { onDelete: 'set null' }),
    imeiCheckSource: text('imei_check_source'),
    imeiCheckNote: text('imei_check_note'),

    /** `lot`: cuántas unidades quedan. `unit`: siempre 1. */
    qty: integer('qty').notNull().default(1),
    status: listingStatusEnum('status').notNull().default('draft'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    soldAt: timestamp('sold_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => authUsers.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('listings_tenant_idx').on(t.tenantId),
    // Todo índice compuesto arranca por tenant_id a la izquierda (skill drizzle-rls §2).
    index('listings_tenant_status_idx').on(t.tenantId, t.status, t.createdAt),
    uniqueIndex('listings_tenant_slug_key').on(t.tenantId, t.slug),
    index('listings_tenant_model_idx').on(t.tenantId, t.catalogModelId),
    // Un IMEI no se carga dos veces en el mismo tenant. Parcial: los lotes no tienen IMEI.
    uniqueIndex('listings_tenant_imei_key')
      .on(t.tenantId, t.imei)
      .where(sql`imei is not null`),
    // Vista de panel "unidades sin chequear" (ADR-009), ordenada por antigüedad.
    index('listings_tenant_imei_check_idx')
      .on(t.tenantId, t.imeiCheckStatus, t.createdAt)
      .where(sql`kind = 'unit'`),

    check('listings_price_positive', sql`price_usd > 0`),
    check('listings_cost_non_negative', sql`cost_usd is null or cost_usd >= 0`),
    check('listings_battery_range', sql`battery_pct is null or (battery_pct between 0 and 100)`),
    check('listings_storage_positive', sql`storage_gb is null or storage_gb > 0`),
    check('listings_qty_non_negative', sql`qty >= 0`),
    // Invariantes de `kind`. Un lote con IMEI es un dato mal cargado que después miente en la ficha.
    check('listings_unit_shape', sql`kind <> 'unit' or qty = 1`),
    check('listings_lot_has_no_imei', sql`kind <> 'lot' or imei is null`),
    // ADR-009: 15 dígitos, bloqueante (lo exige el propio form de ENACOM).
    // Luhn NO se valida acá: es warning en `packages/domain`. Un gate de alta que rechaza stock
    // es peor que un warning que el dueño ignora.
    check('listings_imei_format', sql`imei is null or imei ~ '^[0-9]{15}$'`),
    ...tenantPolicies('listings'),
  ],
).enableRLS();
