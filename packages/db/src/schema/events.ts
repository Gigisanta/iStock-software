/**
 * `listing_events` — bitácora. **Toda** transición escribe acá (DOMAIN.md §Máquina de estados):
 * quién, cuándo, de → a, motivo. `sold` es terminal: revertir es un evento de corrección
 * auditado (`kind='correction'`), no una transición normal.
 *
 * `wa_click_events` — el único evento de la vidriera. **Sin PII**: no guarda IP, ni user agent,
 * ni teléfono del visitante. Sólo tenant, listing y de dónde salió el click.
 */

import { index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { authUsers } from 'drizzle-orm/supabase';
import { createdAt, pk } from './columns';
import { tenantId } from './tenants';
import { listingEventKindEnum, listingStatusEnum, waClickSourceEnum } from './enums';
import { listings } from './listings';
import { tenantPolicies } from './rls';

export const listingEvents = pgTable(
  'listing_events',
  {
    id: pk(),
    tenantId: tenantId(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    kind: listingEventKindEnum('kind').notNull(),
    fromStatus: listingStatusEnum('from_status'),
    toStatus: listingStatusEnum('to_status'),
    /** `null` = lo hizo el cron (expiración de reserva), no una persona. */
    actorUserId: uuid('actor_user_id').references(() => authUsers.id, { onDelete: 'set null' }),
    reason: text('reason'),
    /** Metadata acotada. **Prohibido** meter acá el IMEI, el costo o notas internas. */
    metadata: jsonb('metadata'),
    createdAt: createdAt(),
  },
  (t) => [
    index('listing_events_tenant_idx').on(t.tenantId),
    index('listing_events_tenant_listing_idx').on(t.tenantId, t.listingId, t.createdAt),
    ...tenantPolicies('listing_events'),
  ],
).enableRLS();

export const waClickEvents = pgTable(
  'wa_click_events',
  {
    id: pk(),
    tenantId: tenantId(),
    /** `null` si el click salió del footer de la vidriera y no de una ficha. */
    listingId: uuid('listing_id').references(() => listings.id, { onDelete: 'set null' }),
    source: waClickSourceEnum('source').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('wa_click_events_tenant_idx').on(t.tenantId),
    index('wa_click_events_tenant_created_idx').on(t.tenantId, t.createdAt),
    ...tenantPolicies('wa_click_events'),
  ],
).enableRLS();
