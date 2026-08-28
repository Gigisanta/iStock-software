/**
 * `listing_events` — bitácora. **Toda** transición escribe acá (DOMAIN.md §Máquina de estados):
 * quién, cuándo, de → a, motivo. `sold` es terminal: revertir es un evento de corrección
 * auditado (`kind='correction'`), no una transición normal.
 *
 * `wa_click_events` — el único evento de la vidriera. **Sin PII**: no guarda IP, ni user agent,
 * ni teléfono del visitante. Sólo tenant, listing y de dónde salió el click.
 *
 * Y es, además, **la única escritura sin autenticar de todo el producto** (S4). La escribe el rol
 * `anon` con su propia policy de `INSERT` — no un endpoint con `service_role` — para que la base
 * siga siendo la última línea de defensa: si el handler tiene un bug, el `WITH CHECK` sigue
 * impidiendo que la fila caiga en el tenant de otro. Ver `drizzle/0004_storefront_wa_click_insert.sql`.
 */

import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { authUsers } from 'drizzle-orm/supabase';
import { createdAt, pk } from './columns';
import { tenantId } from './tenants';
import { listingEventKindEnum, listingStatusEnum, waClickSourceEnum } from './enums';
import { listings } from './listings';
import { storefrontAnonInsertPolicy, storefrontTenantId, tenantPolicies } from './rls';

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
    // ── La escritura de la vidriera anónima ────────────────────────────────────────────────
    // Dos condiciones, y las dos son `AND`:
    //   1. el `tenant_id` de la fila es el del claim del slug — nunca el que venga en el body;
    //   2. si nombra un `listing_id`, ese listing es **de ese mismo tenant**.
    // El `listing_id is null` va adelante porque es un caso legítimo y documentado arriba: el
    // click del footer no sale de ninguna ficha. Sin ese `or`, el `exists` daría falso y el
    // footer no podría registrar nada.
    // El `exists` lee `listings` **como `anon`**: pasa por `listings_storefront_anon_select`, o
    // sea que un listing en `draft` tampoco sirve de destino. Es intencional — si no está
    // publicado, no hay botón desde el que apretar.
    storefrontAnonInsertPolicy(
      'wa_click_events',
      sql`tenant_id = ${storefrontTenantId()} and (listing_id is null or exists (select 1 from listings l where l.id = listing_id and l.tenant_id = ${storefrontTenantId()}))`,
    ),
  ],
).enableRLS();
