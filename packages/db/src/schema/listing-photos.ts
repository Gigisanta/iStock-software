/**
 * `listing_photos` — el mapeo `listing → keys de R2`. ADR-006.
 *
 * ## Dos cosas que NO son detalles
 * 1. **La key pública es opaca y content-addressed**: `v1/{ab}/{sha256_32}.webp`, hash del byte
 *    de salida de **esa** variante. Sin `tenant_id`, sin `listing_id`, sin sufijo de variante →
 *    desde la URL de `card` **no se puede derivar** la del master.
 * 2. **Borrar un listing NUNCA borra el objeto de R2.** Dos tenants que suben la misma foto
 *    comparten el objeto: borrar por key es borrado cruzado entre tenants. Se borra el mapeo
 *    (esta fila), no el byte. Por eso el `on delete cascade` de acá es seguro y el `DELETE` en R2
 *    es causal de rechazo (CLAUDE.md §2).
 */

import { sql } from 'drizzle-orm';
import { foreignKey, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, updatedAt } from './columns';
import { tenantId } from './tenants';
import { listings } from './listings';
import { storefrontAnonSelectPolicy, storefrontTenantId, tenantPolicies } from './rls';

export const listingPhotos = pgTable(
  'listing_photos',
  {
    id: pk(),
    tenantId: tenantId(),
    listingId: uuid('listing_id').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    alt: text('alt'),

    /**
     * SENSITIVE: never in public DTO.
     * Key del master en el bucket **privado** `istock-originals`. La vidriera nunca la recibe.
     */
    masterKey: text('master_key').notNull(),

    /** Variantes públicas en `istock-media` detrás de `img.maat.work`. */
    thumbKey: text('thumb_key').notNull(),
    cardKey: text('card_key').notNull(),
    detailKey: text('detail_key').notNull(),

    width: integer('width'),
    height: integer('height'),
    /** Presupuesto medido: `card` ≤ 150KB (gate de S2). Se guarda para poder auditarlo. */
    cardBytes: integer('card_bytes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('listing_photos_tenant_idx').on(t.tenantId),
    index('listing_photos_tenant_listing_idx').on(t.tenantId, t.listingId, t.sortOrder),
    uniqueIndex('listing_photos_listing_sort_key').on(t.tenantId, t.listingId, t.sortOrder),
    foreignKey({
      columns: [t.tenantId, t.listingId],
      foreignColumns: [listings.tenantId, listings.id],
      name: 'listing_photos_tenant_listing_fk',
    }).onDelete('cascade'),
    ...tenantPolicies('listing_photos'),
    // La foto se ve si y sólo si SU listing se ve. El `exists` se evalúa con RLS puesta sobre
    // `listings`, o sea que hereda la policy de arriba: una foto de un borrador no existe para
    // `anon` aunque alguien adivine el id. `master_key` no está en el GRANT de columnas.
    storefrontAnonSelectPolicy(
      'listing_photos',
      sql`tenant_id = ${storefrontTenantId()} and exists (select 1 from listings l where l.id = listing_photos.listing_id)`,
    ),
  ],
).enableRLS();
