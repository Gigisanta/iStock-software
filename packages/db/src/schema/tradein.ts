/**
 * Canje (trade-in) — **flujo de primera clase** (CLAUDE.md §1), no un formulario de contacto.
 *
 * S8: form público → inbox del panel → `accept-to-stock` crea una unidad en `draft` **con costo**.
 * Ese costo es `offer_usd`, y el seller **no lo ve**: por eso está marcado SENSITIVE acá y no
 * sólo en `listings`.
 *
 * El lead trae datos personales del visitante (nombre, WhatsApp). No entran a la vidriera, no
 * entran al chatbot, no entran a un log. En los ToS el reseller es responsable de esa base y
 * MaatWork es encargado del tratamiento (ADR-009 §blocker legal).
 */

import { index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { authUsers } from 'drizzle-orm/supabase';
import { moneyCents } from '../money';
import { createdAt, pk, updatedAt } from './columns';
import { tenantId } from './tenants';
import { listingConditionEnum, tradeinCheckResultEnum, tradeinStatusEnum } from './enums';
import { listings } from './listings';
import { tenantPolicies } from './rls';

export const tradeinLeads = pgTable(
  'tradein_leads',
  {
    id: pk(),
    tenantId: tenantId(),
    status: tradeinStatusEnum('status').notNull().default('new'),

    /** SENSITIVE: never in public DTO. Dato personal del visitante. */
    customerName: text('customer_name').notNull(),
    /** SENSITIVE: never in public DTO. Dato personal del visitante. */
    customerWaPhone: text('customer_wa_phone').notNull(),

    /** Lo que el visitante dice que tiene. Texto libre: no confiar, es input anónimo. */
    modelText: text('model_text').notNull(),
    storageGb: integer('storage_gb'),
    color: text('color'),
    declaredCondition: listingConditionEnum('declared_condition'),
    batteryPct: integer('battery_pct'),
    notes: text('notes'),

    /** SENSITIVE: never in public DTO. Lo que el dueño ofrece pagar = el costo de la unidad. */
    offerUsd: moneyCents('offer_usd'),
    /** SENSITIVE: never in public DTO. */
    internalNotes: text('internal_notes'),

    /** Unidad creada por `accept-to-stock`. `null` mientras el lead no se acepta. */
    createdListingId: uuid('created_listing_id').references(() => listings.id, { onDelete: 'set null' }),
    handledBy: uuid('handled_by').references(() => authUsers.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('tradein_leads_tenant_idx').on(t.tenantId),
    index('tradein_leads_tenant_status_idx').on(t.tenantId, t.status, t.createdAt),
    ...tenantPolicies('tradein_leads'),
  ],
).enableRLS();

/** Checklist presencial del canje: pantalla original, batería, iCloud, golpes, etc. */
export const tradeinChecklists = pgTable(
  'tradein_checklists',
  {
    id: pk(),
    tenantId: tenantId(),
    tradeinLeadId: uuid('tradein_lead_id')
      .notNull()
      .references(() => tradeinLeads.id, { onDelete: 'cascade' }),
    itemKey: text('item_key').notNull(),
    itemLabel: text('item_label').notNull(),
    result: tradeinCheckResultEnum('result').notNull().default('na'),
    note: text('note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('tradein_checklists_tenant_idx').on(t.tenantId),
    index('tradein_checklists_tenant_lead_idx').on(t.tenantId, t.tradeinLeadId),
    uniqueIndex('tradein_checklists_lead_item_key').on(t.tradeinLeadId, t.itemKey),
    ...tenantPolicies('tradein_checklists'),
  ],
).enableRLS();
