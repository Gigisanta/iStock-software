/**
 * `memberships` — quién trabaja en qué tenant y con qué rol. **Fuente de verdad del claim**
 * (ADR-005): el Custom Access Token Hook lee de acá para escribir `app_metadata.tenant_id`.
 *
 * ## "Un negocio por persona" lo sostiene la base, no la app (0005)
 * `memberships_single_owner_per_user_key` es un **único parcial sobre `user_id` where
 * `role = 'owner'`**. Es la Capa 1 escrita en el motor: una persona **posee** un solo negocio.
 * Deliberadamente NO es un único sobre `user_id` pelado, porque eso derogaría lo que el par
 * `(tenant_id, user_id)` ya dice a propósito — que una persona puede *trabajar* en varios
 * negocios— para ganar una regla que sólo habla de la propiedad. Ver `drizzle/0005_*.sql`.
 *
 * ## Deuda declarada, no escondida
 * El claim queda **stale hasta 3600 s**. Consecuencia operativa obligatoria: toda operación de
 * membresía o de billing **re-lee esta tabla** y no confía en el claim. Un usuario expulsado
 * conserva acceso hasta que su token rote.
 */

import { sql } from 'drizzle-orm';
import { index, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { authUsers } from 'drizzle-orm/supabase';
import { createdAt, pk, updatedAt } from './columns';
import { tenantId } from './tenants';
import { membershipRoleEnum } from './enums';
import { membershipPolicies } from './rls';

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
    /**
     * **Un negocio por persona (Capa 1), garantizado por el motor.** Hasta 0005 esta regla vivía
     * sólo en `createTenant()`, en un `if (await hasMembership(...))` leído **antes** de la
     * transacción que después escribe: dos signups concurrentes del mismo `user_id` leían cero
     * filas los dos, escribían los dos, y quedaban dos tenants y dos slugs quemados sin que
     * ninguna transacción fallara. Un chequeo leído fuera de la transacción no es una garantía.
     *
     * El predicado es `role = 'owner'` y nada más — a propósito no incluye `accepted_at`:
     * una fila `owner` sin aceptar ya ocupa el lugar, y si el filtro la excluyera, dos invitaciones
     * de propiedad pendientes volverían a poder cerrar las dos.
     */
    uniqueIndex('memberships_single_owner_per_user_key')
      .on(t.userId)
      .where(sql`role = 'owner'`),
    ...membershipPolicies('memberships'),
  ],
).enableRLS();
