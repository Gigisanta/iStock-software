/**
 * `reservations` y `sales`.
 *
 * Reserva: 30–120 min, default 60, entitlement `reservations` (plan `negocio`).
 * **Una unidad tiene como máximo una reserva activa** — y eso no se defiende con un `if` en el
 * server sino con un índice único parcial: dos requests concurrentes contra el mismo listing
 * pasan los dos por el `if` y sólo uno pasa por el índice.
 */

import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { authUsers } from 'drizzle-orm/supabase';
import { moneyCents } from '../money';
import { createdAt, pk, updatedAt } from './columns';
import { tenantId } from './tenants';
import { reservationStatusEnum } from './enums';
import { listings } from './listings';
import { tenantPolicies } from './rls';

export const reservations = pgTable(
  'reservations',
  {
    id: pk(),
    tenantId: tenantId(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    status: reservationStatusEnum('status').notNull().default('active'),
    minutes: integer('minutes').notNull().default(60),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Etiqueta corta que escribe el dueño ("Juan de Cipolletti"). No es un CRM. */
    customerLabel: text('customer_label'),
    createdBy: uuid('created_by').references(() => authUsers.id, { onDelete: 'set null' }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('reservations_tenant_idx').on(t.tenantId),
    index('reservations_tenant_status_idx').on(t.tenantId, t.status, t.expiresAt),
    // El cron de expiración barre por `expires_at` sin filtro de tenant (corre como service_role).
    index('reservations_active_expiry_idx').on(t.expiresAt).where(sql`status = 'active'`),
    // La invariante "máximo una reserva activa por unidad", en el motor y no en el código.
    uniqueIndex('reservations_one_active_per_listing')
      .on(t.listingId)
      .where(sql`status = 'active'`),
    check('reservations_minutes_range', sql`minutes between 30 and 120`),
    ...tenantPolicies('reservations'),
  ],
).enableRLS();

export const sales = pgTable(
  'sales',
  {
    id: pk(),
    tenantId: tenantId(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'restrict' }),
    reservationId: uuid('reservation_id').references(() => reservations.id, { onDelete: 'set null' }),
    /** Precio realmente cobrado, en USD. */
    priceUsd: moneyCents('price_usd').notNull(),
    /** ARS informativo al momento de la venta, con el TC que se usó. */
    priceArs: moneyCents('price_ars'),
    fxArsPerUsd: moneyCents('fx_ars_per_usd'),
    paymentMethod: text('payment_method'),

    // ── SENSITIVE: never in public DTO ────────────────────────────────────────────────────────
    /** SENSITIVE: never in public DTO. Costo congelado al momento de la venta. */
    costUsd: moneyCents('cost_usd'),
    /** SENSITIVE: never in public DTO. Derivada por Postgres. */
    marginUsd: moneyCents('margin_usd').generatedAlwaysAs(sql`price_usd - cost_usd`),
    /** SENSITIVE: never in public DTO. */
    internalNotes: text('internal_notes'),
    // ──────────────────────────────────────────────────────────────────────────────────────────

    soldBy: uuid('sold_by').references(() => authUsers.id, { onDelete: 'set null' }),
    soldAt: timestamp('sold_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('sales_tenant_idx').on(t.tenantId),
    index('sales_tenant_sold_at_idx').on(t.tenantId, t.soldAt),
    index('sales_tenant_listing_idx').on(t.tenantId, t.listingId),
    check('sales_price_positive', sql`price_usd > 0`),
    ...tenantPolicies('sales'),
  ],
).enableRLS();
