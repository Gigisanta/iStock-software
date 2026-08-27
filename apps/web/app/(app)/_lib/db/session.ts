import 'server-only';
import { sql } from 'drizzle-orm';
import { buildJwtClaims } from '../auth/types';
import { db, type Tx } from './connection';

/**
 * Las **dos** formas de hablar con Postgres desde el panel. Son dos y no una porque tienen
 * privilegios distintos, y mezclarlas es exactamente el bug que RLS existe para atrapar.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *  `withTenantDb(ctx, fn)`  → TODA query de negocio. Corre como `authenticated` con los claims
 *                             del usuario, o sea **con RLS activa**.
 *  `withServiceDb(fn)`      → SÓLO el bootstrap: resolver la membresía de alguien que todavía no
 *                             tiene claim, y crear el primer tenant. Sin RLS. Tres llamadores.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Lo que hace `withTenantDb` es literalmente lo que hace PostgREST en producción, y lo mismo que
 * hace `packages/db/src/test-session.ts` en los tests de RLS cruzado:
 *
 *   begin;
 *     set local role authenticated;
 *     select set_config('request.jwt.claims', '<json>', true);
 *     <la query>
 *   commit;
 *
 * `set local` muere con la transacción: no hay forma de que los claims de un request se filtren
 * al siguiente aunque la conexión se reuse. Eso es justamente por qué **todo va adentro de una
 * transacción** y no en un `SET SESSION`.
 *
 * Y aun así, **RLS no alcanza sola**: `CLAUDE.md` §2 pide el `where tenant_id = ...` explícito en
 * cada query *además* de la policy. Este helper habilita la policy; no exime del `where`. Si
 * mañana alguien afloja una policy en un fix apurado, la query sigue acotada.
 */

export interface TenantContext {
  readonly userId: string;
  readonly tenantId: string;
  readonly role: 'owner' | 'seller';
}

export async function withTenantDb<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const claims = JSON.stringify(buildJwtClaims(ctx.userId, ctx.tenantId));

  return db().transaction(async (tx) => {
    await tx.execute(sql`set local role authenticated`);
    await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
    return fn(tx);
  });
}

/**
 * Conexión con privilegios de operador. **Bypassea RLS.**
 *
 * Tiene exactamente tres usos legítimos, y ninguno recibe datos del request sin validar antes:
 *
 * 1. `resolveMembership()` — leer a qué tenant pertenece un usuario. Es el problema del huevo y
 *    la gallina: para leer `memberships` bajo RLS hace falta el claim de tenant, y el claim de
 *    tenant sale de `memberships`. En Supabase esto lo resuelve el Custom Access Token Hook, que
 *    también corre con privilegios. Está acotado por `user_id = auth.uid()` verificado antes.
 * 2. `createTenant()` — el usuario todavía no tiene claim, así que la policy
 *    `tenants_tenant_insert` (`with check id = <claim>`) lo rechazaría con el claim en `null`.
 * 3. El driver local de auth, que emula el alta de `auth.users` que en producción hace GoTrue.
 *
 * Cualquier cuarto uso es un bug de seguridad, no una optimización. Si necesitás leer listings,
 * fotos, ventas o canjes: `withTenantDb`.
 */
export async function withServiceDb<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db().transaction(async (tx) => fn(tx));
}
