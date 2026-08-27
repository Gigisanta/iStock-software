import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { sql } from 'drizzle-orm';
import { authDriver } from './auth/driver';
import type { AuthIdentity, MembershipRole } from './auth/types';
import { withServiceDb } from './db/session';
import type { TenantContext } from './db/session';

/**
 * **La autorización se verifica acá, dentro de cada Server Function.**
 *
 * No es una preferencia de estilo: `ARCHITECTURE.md` (ADR-007) lo cierra con un motivo mecánico.
 * Las Server Functions no son rutas propias en la cadena de matchers de `proxy.ts` — un `matcher`
 * que excluye un path **también saltea las Server Functions de ese path**. Un guard en el proxy
 * protege la página y deja la mutación abierta. Por eso cada `page.tsx`, cada Server Action y
 * cada Route Handler de este panel abre con `requireUser()` / `requireTenant()` / `requireOwner()`.
 *
 * `cache()` de React memoiza **por request**: cinco `requireTenant()` en un mismo render son una
 * sola query. Fuera del request no cachea nada, así que no hay forma de que la membresía de un
 * usuario sobreviva a la de otro.
 */

export interface TenantSummary {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly plan: 'trial' | 'base' | 'negocio';
  readonly status: 'active' | 'suspended' | 'cancelled';
  readonly trialEndsAt: Date | null;
}

export interface PanelSession {
  readonly identity: AuthIdentity;
  readonly tenant: TenantSummary | null;
  readonly role: MembershipRole | null;
}

/** Contexto listo para `withTenantDb`. Sólo existe si hay tenant. */
export interface ActiveSession extends PanelSession {
  readonly tenant: TenantSummary;
  readonly role: MembershipRole;
  readonly ctx: TenantContext;
}

type MembershipRow = {
  readonly role: MembershipRole;
  readonly tenant_id: string;
  readonly slug: string;
  readonly name: string;
  readonly plan: TenantSummary['plan'];
  readonly status: TenantSummary['status'];
  readonly trial_ends_at: string | Date | null;
};

/**
 * Resuelve la membresía **releyendo `memberships`**, que es la fuente de verdad (ADR-005), en vez
 * de confiar en el claim del token. `ARCHITECTURE.md` lo pide con nombre y apellido: *"el claim
 * queda stale hasta 3600 s (…) toda operación de membresía o billing re-lee `memberships`"*. Un
 * usuario expulsado que conserva el token conserva el claim; no conserva la fila.
 *
 * Corre con `withServiceDb` porque es el bootstrap del claim y no puede ser de otra manera: para
 * leer `memberships` bajo RLS hace falta el `tenant_id`, que es lo que estamos buscando. Está
 * acotado por `user_id`, que viene del driver de auth y no del request.
 *
 * Capa 1 = **un tenant por usuario**. El `order by` + `limit 1` es determinista a propósito: si
 * mañana hay multi-tenant, esto se convierte en un selector explícito, no en "el primero que
 * devuelva Postgres".
 */
const resolveMembership = cache(async (userId: string): Promise<{ tenant: TenantSummary; role: MembershipRole } | null> => {
  const rows = (await withServiceDb(async (tx) =>
    tx.execute<MembershipRow>(
      sql`select m.role,
                 m.tenant_id,
                 t.slug,
                 t.name,
                 t.plan,
                 t.status,
                 t.trial_ends_at
            from public.memberships m
            join public.tenants t on t.id = m.tenant_id
           where m.user_id = ${userId}::uuid
             and t.status <> 'cancelled'
           order by m.created_at asc
           limit 1`,
    ),
  )) as unknown as MembershipRow[];

  const row = rows[0];
  if (row === undefined) return null;

  return {
    role: row.role,
    tenant: {
      id: row.tenant_id,
      slug: row.slug,
      name: row.name,
      plan: row.plan,
      status: row.status,
      trialEndsAt: row.trial_ends_at === null ? null : new Date(row.trial_ends_at),
    },
  };
});

/** Sesión del request. `null` si no hay usuario. Nunca redirige: eso lo deciden los `require*`. */
export const getPanelSession = cache(async (): Promise<PanelSession | null> => {
  /**
   * `connection()` marca el punto donde este árbol deja de ser prerenderizable, y tiene que ser
   * **la primera línea**, antes de tocar el driver o la base.
   *
   * Sin esto, `next build` ejecuta el cuerpo entero durante el prerender de cada página del panel:
   * lee variables de entorno que en el build no están, y abre una conexión a Postgres desde el
   * worker de build. Verificado — el build reventaba con el assert del driver de auth, que es la
   * versión benigna del problema; la versión cara es un build que se cuelga esperando a una base
   * que no existe.
   *
   * `cookies()` sola no alcanza como señal: para cuando se llama, el driver ya se construyó.
   */
  await connection();

  const identity = await authDriver().currentIdentity();
  if (identity === null) return null;

  const membership = await resolveMembership(identity.userId);
  if (membership === null) return { identity, tenant: null, role: null };

  return { identity, tenant: membership.tenant, role: membership.role };
});

/** Hay persona logueada. Todavía puede no tener negocio. */
export async function requireUser(): Promise<AuthIdentity> {
  const session = await getPanelSession();
  if (session === null) redirect('/ingresar');
  return session.identity;
}

/**
 * Hay persona **y** negocio. Devuelve el `ctx` que exige `withTenantDb`.
 *
 * Un usuario sin membresía no es un error: es alguien que se registró y todavía no creó su
 * negocio. Va al alta, no a un 403.
 */
export async function requireTenant(): Promise<ActiveSession> {
  const session = await getPanelSession();
  if (session === null) redirect('/ingresar');
  if (session.tenant === null || session.role === null) redirect('/app/crear-negocio');

  return {
    identity: session.identity,
    tenant: session.tenant,
    role: session.role,
    ctx: { userId: session.identity.userId, tenantId: session.tenant.id, role: session.role },
  };
}

/**
 * Se lanza cuando hay sesión válida pero el rol no alcanza. La separación importa: 401 y 403 no
 * son lo mismo, y mandar a `/ingresar` a alguien que ya está logueado es un loop.
 *
 * TODO del LEAD, no de esta slice: con `experimental.authInterrupts: true` en `next.config.ts`
 * (archivo del LEAD) esto se reemplaza por `forbidden()` de `next/navigation`, que devuelve un
 * **403 real** y renderiza `forbidden.tsx`. Hoy el flag está en `false` por default, así que
 * llamarlo tiraría en runtime. Está pedido en BLOCKERS.
 */
export class PanelForbiddenError extends Error {
  readonly status = 403;
  constructor(message = 'No tenés permiso para entrar acá.') {
    super(message);
    this.name = 'PanelForbiddenError';
  }
}

/**
 * Sólo `owner`. Es el guard que va a proteger costo, margen, facturación e invitaciones.
 *
 * Que exista desde el esqueleto no es adelantar S11: es que agregarlo después obliga a repasar
 * pantalla por pantalla, y `CLAUDE.md` §0.9 no admite un olvido — *"Seller no ve costo ni margen.
 * Nunca. Ni en el payload"*. El filtro real va en el `select`; esto es la puerta.
 */
export async function requireOwner(): Promise<ActiveSession> {
  const session = await requireTenant();
  if (session.role !== 'owner') throw new PanelForbiddenError();
  return session;
}
