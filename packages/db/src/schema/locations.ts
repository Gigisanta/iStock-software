/**
 * `locations` — puntos de retiro (Neuquén / Cipolletti / donde sea), con horario.
 * Es uno de los 15 campos obligatorios de la ficha pública (CLAUDE.md §1).
 */

import { sql } from 'drizzle-orm';
import { boolean, index, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { createdAt, pk, updatedAt } from './columns';
import { tenantId } from './tenants';
import { storefrontAnonSelectPolicy, storefrontTenantId, tenantPolicies } from './rls';

export const locations = pgTable(
  'locations',
  {
    id: pk(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    address: text('address').notNull(),
    /** Texto libre: "lun a vie 10 a 18, sáb 10 a 13". No se parsea, se muestra. */
    hours: text('hours').notNull(),
    city: text('city'),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('locations_tenant_idx').on(t.tenantId),
    index('locations_tenant_active_idx').on(t.tenantId, t.isActive, t.sortOrder),
    ...tenantPolicies('locations'),
    // Punto de retiro: es uno de los 15 campos obligatorios de la ficha. Sólo los activos.
    storefrontAnonSelectPolicy(
      'locations',
      sql`tenant_id = ${storefrontTenantId()} and is_active`,
    ),
  ],
).enableRLS();
