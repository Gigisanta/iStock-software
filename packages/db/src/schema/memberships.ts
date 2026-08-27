/**
 * `memberships` — quién trabaja en qué tenant y con qué rol. **Fuente de verdad del claim**
 * (ADR-005): el Custom Access Token Hook lee de acá para escribir `app_metadata.tenant_id`.
 *
 * ## Deuda declarada, no escondida
 * El claim queda **stale hasta 3600 s**. Consecuencia operativa obligatoria: toda operación de
 * membresía o de billing **re-lee esta tabla** y no confía en el claim. Un usuario expulsado
 * conserva acceso hasta que su token rote.
 */

import { index, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { authUsers } from 'drizzle-orm/supabase';
import { createdAt, pk, updatedAt } from './columns';
import { tenantId } from './tenants';
import { membershipRoleEnum } from './enums';
import { tenantPolicies } from './rls';

export const memberships = pgTable(
  'memberships',
  {
    id: pk(),
    tenantId: tenantId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    role: membershipRoleEnum('role').notNull().default('seller'),
    invitedBy: uuid('invited_by').references(() => authUsers.id, { onDelete: 'set null' }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('memberships_tenant_idx').on(t.tenantId),
    uniqueIndex('memberships_tenant_user_key').on(t.tenantId, t.userId),
    index('memberships_user_idx').on(t.userId),
    ...tenantPolicies('memberships'),
  ],
).enableRLS();
