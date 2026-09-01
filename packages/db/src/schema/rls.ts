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
import { anonRole, authenticatedRole } from 'drizzle-orm/supabase';

/** `(select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid`. Fresco en cada uso. */
export function tenantClaim(): SQL {
  return sql`(select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid`;
}

/**
 * Predicado estándar: el claim sólo selecciona el tenant activo; la membresía vigente en DB
 * decide si la sesión todavía puede operar sobre él. Así un JWT stale falla cerrado al revocar
 * la membresía, sin esperar la rotación del token.
 */
export function belongsToTenant(): SQL {
  return sql`tenant_id = ${tenantClaim()} and ${currentUserIsTenantMember()}`;
}

/**
 * Authorization basada en la fuente de verdad (`memberships`), no en un claim mutable por el
 * caller. El helper SQL se declara como SECURITY DEFINER, propiedad de `service_role`, para que
 * la consulta de autorización pueda leer la membresía vigente aun cuando la tabla también está
 * protegida por RLS. Devuelve sólo un booleano y nunca expone filas.
 */
export function currentUserIsTenantMember(): SQL {
  return sql`public.is_current_user_tenant_member(tenant_id)`;
}

export function currentUserIsTenantOwner(): SQL {
  return sql`public.is_current_user_tenant_owner(tenant_id)`;
}

export function currentUserOwnsTenantRow(): SQL {
  return sql`public.is_current_user_tenant_owner(id)`;
}

/**
 * Condición EXTRA sobre el `with check` del INSERT del panel, además del tenant.
 *
 * Existe por un motivo concreto y medido (S6, `drizzle/0006_reservations_sweep_attempts.sql`):
 * hay columnas que el panel **no elige** —las escribe un job— y la primera reacción es sacarlas
 * del privilegio de INSERT columna por columna. **Eso rompe al caller real.** Drizzle, en
 * `insert().values()`, nombra TODAS las columnas de la tabla y pone `default` en las que no le
 * pasaste; y Postgres exige el privilegio sobre cada columna NOMBRADA aunque el valor sea
 * `DEFAULT`. O sea que el `GRANT` por columna no dice "no la elijas": dice "no insertes nada".
 *
 * El candado correcto es este: el `GRANT` de INSERT queda a nivel de TABLA (la capa 1 decide si
 * podés tocar la tabla) y la policy exige el valor (la capa 2 decide qué filas escribís). Es la
 * única de las dos capas que sabe decir "sí, pero en cero", que es justo lo que hace falta.
 *
 * No aplica a `UPDATE`: ahí el `.set()` de Drizzle nombra sólo lo que setea, así que el `GRANT`
 * por columna sí expresa la intención y además defiende el caso caro —forjar el contador
 * *después*, sobre una fila viva—. Los dos mecanismos conviven a propósito.
 */
export interface TenantPolicyOptions {
  /** Predicado extra exigido al INSERTAR, en `and` con el tenant. Nunca lo reemplaza. */
  readonly insertWithCheck?: SQL;
}

/**
 * Las 4 policies de una tabla de negocio con columna `tenant_id`.
 * Devuelve el array listo para spread en el "extra config" de `pgTable`.
 */
export function tenantPolicies(table: string, options: TenantPolicyOptions = {}) {
  // El tenant NUNCA se reemplaza: lo extra va en `and`. Si una opción pudiera sustituir el
  // predicado de tenant, esta función dejaría de ser la receta que hace imposible olvidarlo.
  const insertCheck =
    options.insertWithCheck === undefined
      ? belongsToTenant()
      : sql`${belongsToTenant()} and ${options.insertWithCheck}`;

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
      withCheck: insertCheck,
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
  const member = sql`public.is_current_user_tenant_member(id)`;
  return [
    pgPolicy(`${table}_tenant_select`, { as: 'permissive', for: 'select', to: authenticatedRole, using: sql`${own} and ${member}` }),
    // El alta de un tenant es bootstrap y corre con service_role. No se permite desde una
    // sesión autenticada: un claim de tenant no convierte a un seller en creador de negocios.
    // El predicado de identidad sigue presente aunque el bootstrap autenticado esté cerrado.
    pgPolicy(`${table}_tenant_insert`, { as: 'permissive', for: 'insert', to: authenticatedRole, withCheck: sql`${own} and false` }),
    pgPolicy(`${table}_tenant_update`, {
      as: 'permissive',
      for: 'update',
      to: authenticatedRole,
      using: sql`${own} and ${currentUserOwnsTenantRow()}`,
      withCheck: sql`${own} and ${currentUserOwnsTenantRow()}`,
    }),
    pgPolicy(`${table}_tenant_delete`, {
      as: 'permissive',
      for: 'delete',
      to: authenticatedRole,
      using: sql`${own} and ${currentUserOwnsTenantRow()}`,
    }),
  ];
}

/** Las cuatro operaciones de una tabla cuyo DML autenticado queda reservado al owner. */
export function ownerTenantPolicies(table: string) {
  const own = sql`${belongsToTenant()} and ${currentUserIsTenantOwner()}`;
  return [
    pgPolicy(`${table}_tenant_select`, { as: 'permissive', for: 'select', to: authenticatedRole, using: own }),
    pgPolicy(`${table}_tenant_insert`, { as: 'permissive', for: 'insert', to: authenticatedRole, withCheck: own }),
    pgPolicy(`${table}_tenant_update`, {
      as: 'permissive',
      for: 'update',
      to: authenticatedRole,
      using: own,
      withCheck: own,
    }),
    pgPolicy(`${table}_tenant_delete`, { as: 'permissive', for: 'delete', to: authenticatedRole, using: own }),
  ];
}

/** Membresías: todos los miembros pueden consultar su tenant, pero sólo el owner las muta. */
export function membershipPolicies(table: string) {
  const own = sql`${belongsToTenant()} and ${currentUserIsTenantOwner()}`;
  return [
    pgPolicy(`${table}_tenant_select`, {
      as: 'permissive',
      for: 'select',
      to: authenticatedRole,
      using: belongsToTenant(),
    }),
    pgPolicy(`${table}_tenant_insert`, { as: 'permissive', for: 'insert', to: authenticatedRole, withCheck: own }),
    pgPolicy(`${table}_tenant_update`, {
      as: 'permissive',
      for: 'update',
      to: authenticatedRole,
      using: own,
      withCheck: own,
    }),
    pgPolicy(`${table}_tenant_delete`, { as: 'permissive', for: 'delete', to: authenticatedRole, using: own }),
  ];
}

/**
 * Sales: un seller puede registrar el hecho de venta, pero no leerlo, corregirlo ni borrarlo.
 * La condición de INSERT se completa en `sales.ts` para que el costo sólo pueda copiarse del
 * listing de la misma cuenta y las notas internas no entren por ese camino.
 */
export function ownerReadSellerInsertPolicies(table: string, sellerInsertCheck: SQL) {
  const own = sql`${belongsToTenant()} and ${currentUserIsTenantOwner()}`;
  const sellerInsert = sql`${belongsToTenant()} and ${currentUserIsTenantMember()} and not ${currentUserIsTenantOwner()} and ${sellerInsertCheck}`;
  return [
    pgPolicy(`${table}_tenant_select`, { as: 'permissive', for: 'select', to: authenticatedRole, using: own }),
    pgPolicy(`${table}_tenant_insert`, { as: 'permissive', for: 'insert', to: authenticatedRole, withCheck: sql`${own} or ${sellerInsert}` }),
    pgPolicy(`${table}_tenant_update`, {
      as: 'permissive',
      for: 'update',
      to: authenticatedRole,
      using: own,
      withCheck: own,
    }),
    pgPolicy(`${table}_tenant_delete`, { as: 'permissive', for: 'delete', to: authenticatedRole, using: own }),
  ];
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  VIDRIERA ANÓNIMA — el rol `anon` SÍ es un cliente de Postgres, y por eso está acotado dos veces.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// Corrección de la ronda S1-R2 (hallazgo HIGH-1). La versión anterior de este paquete apostaba a
// que el visitante nunca tocaba Postgres: `REVOKE ALL ... FROM anon` y ninguna policy `TO anon`.
// En dev eso "funcionaba" por la razón equivocada — la conexión local es SUPERUSER y un
// superusuario se saltea FORCE RLS entero, así que el aislamiento lo estaba haciendo el `where`
// de la query, no la base. Con un rol no-superusuario (producción) el mismo camino devuelve
// `42501` y la vidriera lee CERO filas.
//
// La corrección tiene dos capas, y son dos capas distintas a propósito:
//
//   1. **GRANT a nivel de COLUMNA** (`0002_storefront_anon_grants.sql`). `anon` no recibe
//      `GRANT SELECT ON listings`: recibe `GRANT SELECT (slug, title, price_usd, …)`. Un
//      `select *`, un `select imei` o un `select cost_usd` no "filtran de más": **no compilan
//      en Postgres**, dan `42501`. Es la única defensa que sigue en pie el día que
//      `publicListingDTO` tenga un bug. `CLAUDE.md` §2 y §5.
//   2. **Policies `TO anon`** (esto). Deciden QUÉ FILAS. Son de `SELECT` salvo **una**, que el
//      LEAD ratificó en S4: el `INSERT` de `wa_click_events` (el click de WhatsApp). Cero
//      policies de `UPDATE` y de `DELETE` para `anon`: no existen, ni restringidas. El detalle
//      de por qué esa excepción es una policy y no un endpoint con `service_role` está al pie
//      de este archivo, arriba de `storefrontAnonInsertPolicy`.
//
// ## El claim de la vidriera
// `anon` no tiene `tenant_id` en el JWT (no hay usuario). Lo que sí conoce el server ANTES de
// consultar nada es el **slug**, que viene del host (`{slug}.maat.work`) y lo reescribe `proxy.ts`.
// Ese slug viaja como claim y **es el que acota las filas**:
//
//   begin;
//     set local role anon;
//     select set_config('request.jwt.claims', '{"role":"anon","app_metadata":{"storefront_slug":"acme"}}', true);
//     <la query, con su where tenant_id = ... explícito ADEMÁS de RLS>
//   commit;
//
// Sin el claim, `storefront_slug()` devuelve NULL y **todas** las policies de abajo dan falso:
// cero filas. Falla cerrado y en silencio del lado seguro. Eso también cierra el agujero de
// PostgREST: la `anon key` de Supabase está en el browser, pero un JWT firmado por Supabase para
// `anon` **no puede traer `app_metadata.storefront_slug`**, así que `GET /rest/v1/listings` con la
// clave pública sigue devolviendo `[]`.
//
// Las dos funciones (`storefront_slug()`, `storefront_tenant_id()`) las crea la migración 0002.
// Son `stable` y `security invoker`: `storefront_tenant_id()` lee `tenants` **como `anon`**, o sea
// que pasa por la policy de `tenants` de abajo. `security definer` sería un agujero silencioso —
// con `FORCE ROW LEVEL SECURITY`, el dueño de la tabla tampoco se saltea las policies, y en
// Supabase el dueño no es superusuario: la función devolvería NULL en producción y verde en local.

/** El slug de vidriera que está sirviendo esta conexión, o NULL si no hay claim. */
export function storefrontSlugClaim(): SQL {
  // Siempre en subquery: InitPlan, una evaluación por query y no una por fila (ADR-005).
  return sql`(select public.storefront_slug())`;
}

/** El tenant activo dueño de ese slug, o NULL. Es el `tenant_id` implícito de la vidriera. */
export function storefrontTenantId(): SQL {
  return sql`(select public.storefront_tenant_id())`;
}

/**
 * Estados que un comprador anónimo puede ver. **Espejo exacto de `PUBLIC_STATUSES`**
 * (`@istock/domain`), y `src/rls-anon-storefront.test.ts` verifica que no se desincronicen
 * comparando el `qual` real de `pg_policies` contra el array de `domain`.
 */
export const PUBLIC_STATUS_SQL = sql`status in ('available', 'reserved', 'sold')`;

/**
 * Una policy de **sólo lectura** para el rol `anon`. Es la forma por default de la vidriera: el
 * visitante lee, y todo lo que lee está acotado por el claim del slug.
 */
export function storefrontAnonSelectPolicy(table: string, using: SQL) {
  return pgPolicy(`${table}_storefront_anon_select`, {
    as: 'permissive',
    for: 'select',
    to: anonRole,
    using,
  });
}

// ── La única excepción: el click de WhatsApp (S4) ──────────────────────────────────────────────
//
// Hasta S3 este módulo decía, textual, que no había variante de escritura para `anon` y que un
// click de WhatsApp entraría "por una Server Function con el rol del server". **El LEAD lo
// revisó en S4 y decidió lo contrario**, y el motivo no es de comodidad sino de dónde queda la
// última línea de defensa:
//
//   · Con `service_role`, la garantía de que la fila cae en el tenant correcto vive **entera** en
//     el handler. Un bug ahí escribe en la cuenta de otro y la base no se entera: `service_role`
//     tiene `BYPASSRLS`, así que no hay segunda capa. La afirmación "sin RLS no hay merge"
//     (CLAUDE.md §7) se vuelve decorativa justo en el único endpoint sin autenticar del producto.
//   · Con `anon` + policy, el `WITH CHECK` lo evalúa el planner en cada `insert`. Si el handler
//     tiene un bug, o si mañana alguien le pasa un `tenant_id` desde el body, Postgres devuelve
//     `42501` y la fila no existe. El handler deja de ser el que garantiza el aislamiento y pasa
//     a ser sólo el que lo pide.
//
// Lo que NO cambia, y es lo que mantiene la excepción acotada a un agujero de alfiler:
//   · `anon` gana **INSERT de tres columnas** (`tenant_id`, `listing_id`, `source`) sobre **una**
//     tabla. `id` y `created_at` quedan fuera del GRANT: salen de sus defaults y no se forjan.
//   · **Cero** SELECT/UPDATE/DELETE, ni GRANT ni policy. El visitante escribe su click y no lee
//     ninguno — ni el propio. Un `insert ... returning` desde la vidriera da `42501`, y está bien:
//     el beacon no necesita saber qué escribió.
//   · El `tenant_id` sale del claim del slug, igual que en las policies de lectura. Nunca del body.
//
// Ver `drizzle/0004_storefront_wa_click_insert.sql`, `src/rls-anon-wa-click.test.ts` (polaridad
// contra Postgres real) y la regla 0026 de `scripts/rls-lint.mjs`, que es la que impide que esta
// excepción se copie a una segunda tabla sin que nadie lo note.

/**
 * La policy de **escritura** de la vidriera. Sólo `INSERT`, sólo `TO anon`, y con `WITH CHECK`
 * obligatorio (sin él, un visitante escribe filas en el tenant de otro: es el mismo agujero que
 * documenta `tenantPolicies`).
 */
export function storefrontAnonInsertPolicy(table: string, withCheck: SQL) {
  return pgPolicy(`${table}_storefront_insert`, {
    as: 'permissive',
    for: 'insert',
    to: anonRole,
    withCheck,
  });
}
