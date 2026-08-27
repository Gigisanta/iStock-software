/**
 * `users` — perfil de la persona. Espejo de `auth.users` de Supabase.
 *
 * ## Por qué NO tiene `tenant_id` (excepción declarada, distinta a la del catálogo)
 * Una persona se relaciona con un tenant a través de `memberships` (ADR-005: *"`memberships`, que
 * es la fuente de verdad"*). Ponerle `tenant_id not null` a `users` obligaría a duplicar la fila
 * por tenant, y entonces `users.id` ya no podría ser `auth.users.id` — que es justamente lo que
 * hace que `auth.uid()` sirva para algo. Duplicar la identidad para cumplir la letra de la regla
 * rompería el mecanismo que la regla protege.
 *
 * **Igual está aislada, y con RLS.** El predicado no es `tenant_id = claim` sino
 * `soy yo` OR `compartimos tenant`, que es estrictamente más chico que "todos los usuarios".
 * No es una tabla global: un usuario de otro tenant devuelve 0 filas.
 */

import { sql } from 'drizzle-orm';
import { index, pgPolicy, pgTable, text } from 'drizzle-orm/pg-core';
import { authUsers, authenticatedRole } from 'drizzle-orm/supabase';
import { createdAt, pk, updatedAt } from './columns';
import { tenantClaim } from './rls';

const isSelf = sql`id = (select auth.uid())`;
const sharesTenant = sql`exists (
    select 1 from public.memberships m
    where m.user_id = users.id
      and m.tenant_id = ${tenantClaim()}
  )`;

export const users = pgTable(
  'users',
  {
    /** = `auth.users.id`. La identidad la emite Supabase Auth, no nosotros. */
    id: pk().references(() => authUsers.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    fullName: text('full_name'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('users_email_idx').on(t.email),
    pgPolicy('users_self_or_teammate_select', {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: sql`${isSelf} or ${sharesTenant}`,
    }),
    // Escritura: SÓLO sobre uno mismo. El alta de un compañero de equipo la hace el
    // service_role al aceptar la invitación, no un usuario cualquiera.
    pgPolicy('users_self_insert', {
      as: 'permissive',
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`id = (select auth.uid())`,
    }),
    pgPolicy('users_self_update', {
      as: 'permissive',
      for: 'update',
      to: authenticatedRole,
      using: sql`id = (select auth.uid())`,
      withCheck: sql`id = (select auth.uid())`,
    }),
    pgPolicy('users_self_delete', {
      as: 'permissive',
      for: 'delete',
      to: authenticatedRole,
      using: sql`id = (select auth.uid())`,
    }),
  ],
).enableRLS();
