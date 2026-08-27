/**
 * Forma de las policies. **Es receta, no estilo** (ADR-005, `docs/DECISIONS.md`).
 *
 * `tenant_id` viaja en `auth.jwt() -> 'app_metadata' -> 'tenant_id'`, alimentado por el
 * Custom Access Token Hook desde `memberships`, que es la fuente de verdad.
 *
 * Reglas que este módulo hace imposibles de olvidar:
 * - `(select auth.jwt() ...)` **siempre envuelto en subquery** → Postgres lo evalúa una vez por
 *   query (InitPlan) y no una vez por fila. Sin la subquery, una tabla de 10k filas hace 10k
 *   llamadas a `auth.jwt()`.
 * - `TO authenticated` **siempre**. Nunca `TO public`: `public` incluye a `anon`.
 * - `WITH CHECK` en INSERT y UPDATE **siempre**. Sin `with check`, un tenant puede **escribir
 *   filas de otro** aunque no pueda leerlas.
 * - Las cuatro operaciones explícitas. Una policy sólo de `select` deja `delete` abierto.
 * - **`using (true)` está prohibido** y lo verifica `scripts/rls-lint.mjs` + el test de RLS.
 *
 * PROHIBIDO para siempre: `tenant_id` en `user_metadata` — el usuario puede escribir ese objeto,
 * así que sería escalación directa de tenant (lint `0015` de Supabase, severidad ERROR).
 */

import { sql, type SQL } from 'drizzle-orm';
import { pgPolicy } from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

/** `(select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid`. Fresco en cada uso. */
export function tenantClaim(): SQL {
  return sql`(select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid`;
}

/** Predicado estándar: la fila pertenece al tenant del claim. */
export function belongsToTenant(): SQL {
  return sql`tenant_id = ${tenantClaim()}`;
}

/**
 * Las 4 policies de una tabla de negocio con columna `tenant_id`.
 * Devuelve el array listo para spread en el "extra config" de `pgTable`.
 */
export function tenantPolicies(table: string) {
  return [
    pgPolicy(`${table}_tenant_select`, {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: belongsToTenant(),
    }),
    pgPolicy(`${table}_tenant_insert`, {
      as: 'permissive',
      for: 'insert',
      to: authenticatedRole,
      withCheck: belongsToTenant(),
    }),
    pgPolicy(`${table}_tenant_update`, {
      as: 'permissive',
      for: 'update',
      to: authenticatedRole,
      using: belongsToTenant(),
      withCheck: belongsToTenant(),
    }),
    pgPolicy(`${table}_tenant_delete`, {
      as: 'permissive',
      for: 'delete',
      to: authenticatedRole,
      using: belongsToTenant(),
    }),
  ];
}

/**
 * Igual que `tenantPolicies` pero para una tabla cuyo identificador de tenant **es** su `id`
 * (hoy: `tenants`). No hay `tenant_id` que apunte a sí misma.
 */
export function selfTenantPolicies(table: string) {
  const own = sql`id = ${tenantClaim()}`;
  return [
    pgPolicy(`${table}_tenant_select`, { as: 'permissive', for: 'select', to: authenticatedRole, using: own }),
    pgPolicy(`${table}_tenant_insert`, { as: 'permissive', for: 'insert', to: authenticatedRole, withCheck: sql`id = ${tenantClaim()}` }),
    pgPolicy(`${table}_tenant_update`, {
      as: 'permissive',
      for: 'update',
      to: authenticatedRole,
      using: sql`id = ${tenantClaim()}`,
      withCheck: sql`id = ${tenantClaim()}`,
    }),
    pgPolicy(`${table}_tenant_delete`, { as: 'permissive', for: 'delete', to: authenticatedRole, using: sql`id = ${tenantClaim()}` }),
  ];
}
