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

import { check, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { authUsers } from 'drizzle-orm/supabase';
import { moneyCents } from '../money';
import { createdAt, pk, updatedAt } from './columns';
import { tenantId } from './tenants';
import { listingConditionEnum, tradeinCheckResultEnum, tradeinStatusEnum } from './enums';
import { listings } from './listings';
import { storefrontAnonInsertPolicy, storefrontTenantId, tenantPolicies } from './rls';

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
    // ── Tamaño y rango EN EL MOTOR (S8) ──────────────────────────────────────────────────────
    // Estos CHECK no duplican al Zod del borde: lo respaldan. La fila la escribe un ANÓNIMO
    // (`tradein_leads_storefront_insert`, abajo), así que el handler de la vidriera es la única
    // otra capa entre un `curl` y la tabla. Una afirmación que vive sólo en el borde se pierde el
    // día que aparece un segundo caller — misma doctrina que ADR-025.
    // Los límites de `color`, `notes`, `battery_pct` y `storage_gb` van detrás de un `is null or`
    // porque las cuatro columnas son opcionales y `null` es un lead legítimo: el visitante no
    // sabe los GB de memoria de su teléfono más veces de las que uno pensaría.
    check('tradein_leads_customer_name_len', sql`length(${t.customerName}) between 1 and 80`),
    check('tradein_leads_customer_wa_phone_len', sql`length(${t.customerWaPhone}) between 6 and 25`),
    check('tradein_leads_model_text_len', sql`length(${t.modelText}) between 1 and 120`),
    check('tradein_leads_color_len', sql`${t.color} is null or length(${t.color}) <= 40`),
    check('tradein_leads_notes_len', sql`${t.notes} is null or length(${t.notes}) <= 500`),
    check('tradein_leads_battery_pct_range', sql`${t.batteryPct} is null or ${t.batteryPct} between 0 and 100`),
    check('tradein_leads_storage_gb_range', sql`${t.storageGb} is null or ${t.storageGb} between 1 and 4096`),
    ...tenantPolicies('tradein_leads'),
    // ── La SEGUNDA escritura sin autenticar del producto (S8, ratificada por el LEAD) ────────
    // Misma forma que el click de WhatsApp de S4 y por el mismo motivo: con `service_role` la
    // garantía de que la fila cae en el tenant correcto vive entera en el handler, y
    // `service_role` tiene BYPASSRLS. Con `anon` + policy, el `WITH CHECK` lo evalúa el planner
    // en cada insert y un bug del handler termina en `42501`, no en el inbox de otro reseller.
    // El `tenant_id` sale del claim del slug (`proxy.ts` → host), NUNCA del body.
    // El privilegio de columna que la acompaña está en `drizzle/0008_*`: nueve columnas, y
    // `offer_usd` / `internal_notes` / `status` NO son ninguna de ellas.
    storefrontAnonInsertPolicy('tradein_leads', sql`tenant_id = ${storefrontTenantId()}`),
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
