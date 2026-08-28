-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 0005 · "un negocio por persona" era una regla de Capa 1 que la base no sostenía.
--
-- ── El defecto ────────────────────────────────────────────────────────────────────────────
-- La regla la sostenía **sólo** `createTenant()`
-- (`apps/web/app/(app)/_lib/tenants/create-tenant.ts`), con un
-- `if (await hasMembership(userId)) reject` que corre **antes** de abrir la transacción que
-- después inserta tenant + membresía + `fx_settings` + punto de retiro.
--
-- El schema no decía nada: el único índice único de `memberships` era
-- `memberships_tenant_user_key` sobre **el par** `(tenant_id, user_id)`, que es exactamente la
-- forma de "una persona puede estar en varios negocios". Nada impedía dos filas `owner` del
-- mismo `user_id` en dos tenants distintos.
--
-- La carrera, con las dos transacciones concurrentes:
--     T1: select ... from memberships where user_id = U   → 0 filas
--     T2: select ... from memberships where user_id = U   → 0 filas
--     T1: insert tenant A + membership(owner, U)          → commit
--     T2: insert tenant B + membership(owner, U)          → commit
-- Resultado: dos tenants para una persona y dos slugs quemados (el único de `tenants.slug` no
-- los suelta nunca), sin que ninguna transacción falle. **Un chequeo leído fuera de la
-- transacción que después escribe no es una garantía, es una probabilidad**: no hay lock, no
-- hay conflicto de escritura y Read Committed no inventa uno.
--
-- ── La forma: único PARCIAL, y no un único sobre `user_id` pelado ──────────────────────────
--     CREATE UNIQUE INDEX ... ON memberships (user_id) WHERE role = 'owner';
--
-- La distinción no es cosmética. Un único sobre `user_id` a secas prohibiría también la segunda
-- membresía `seller`, o sea **derogaría desde el schema** lo que `(tenant_id, user_id)` modela a
-- propósito —el empleado que trabaja en dos locales— para ganar una regla que sólo habla de la
-- **propiedad**. El parcial dice la regla que efectivamente tenemos ("una persona POSEE un solo
-- negocio") y deja intacto lo que el schema ya sabía. Si mañana Capa 2 permite dos negocios por
-- dueño, se dropea este índice y no hay nada más que revisar.
--
-- El predicado es `role = 'owner'` y nada más. **No** lleva `AND accepted_at IS NOT NULL`: una
-- fila `owner` pendiente ya ocupa el lugar, y si el filtro la excluyera, dos invitaciones de
-- propiedad pendientes para la misma persona podrían aceptarse las dos y volveríamos al mismo
-- agujero por otra puerta.
--
-- ── Qué hace esta migración si la base YA tiene dos `owner` para el mismo `user_id` ────────
-- **Aborta, nombra a los responsables, y no toca ningún dato.** El bloque `DO` de abajo corre
-- antes del `CREATE UNIQUE INDEX` y hace `RAISE EXCEPTION` con la lista de `user_id` en conflicto
-- y sus tenants. La migración no queda registrada en `__drizzle_migrations`, así que se puede
-- volver a correr después de limpiar.
--
-- Por qué abortar y NO remediar sola: elegir **cuál de los dos negocios conserva** una persona es
-- una decisión de negocio con plata adentro (stock cargado, slug publicado en un estado de IG,
-- una suscripción de Mercado Pago viva). Una migración que degrada a `seller` "el más nuevo", o
-- que borra la membresía sobrante, toma esa decisión a las 3 AM, en silencio, y deja un tenant
-- que su dueño ya no puede administrar. Eso es peor que un deploy que se frena. La remediación va
-- en el `HINT` y la ejecuta una persona que sabe cuál de los dos negocios es el vivo.
--
-- La segunda mitad de esa garantía es que el guard **no puede dar un falso verde**: si el rol que
-- corre la migración no ve las filas (`memberships` tiene FORCE ROW LEVEL SECURITY y las policies
-- son `TO authenticated`, así que un owner de tabla sin BYPASSRLS leería cero), el `DO` no
-- encuentra nada, pero el `CREATE UNIQUE INDEX` que viene después **falla igual**: la construcción
-- de un índice lee la tabla entera sin pasar por RLS. En el peor caso perdemos el mensaje lindo y
-- queda el `23505 could not create unique index` crudo de Postgres. El guard mejora el mensaje;
-- el que garantiza es el índice. Ese orden es a propósito.
--
-- ── Por qué no CONCURRENTLY ───────────────────────────────────────────────────────────────
-- `CREATE INDEX CONCURRENTLY` no puede correr dentro de una transacción, y el migrador de Drizzle
-- corre cada migración adentro de una. Con `memberships` —una fila por persona por negocio, tres
-- dígitos en el peor escenario de Capa 1— el `SHARE lock` dura milisegundos. Cambiarlo por
-- CONCURRENTLY costaría la atomicidad del guard de arriba para ahorrar un lock que no se mide.
--
-- El `CREATE UNIQUE INDEX` de abajo lo emitió `drizzle-kit generate` desde
-- `src/schema/memberships.ts` y no se tocó. El bloque `DO` y el `COMMENT` se agregaron a mano:
-- el guard no lo puede expresar el schema de Drizzle, y sin él la migración sólo sería segura
-- sobre una base vacía — que es una bomba con fecha, no una migración.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  conflicts text;
  n_users int;
BEGIN
  SELECT count(*)::int,
         string_agg(format('user_id=%s posee %s negocios: %s', user_id, n, tenant_ids), E'\n  ')
    INTO n_users, conflicts
    FROM (
      SELECT user_id,
             count(*)::int AS n,
             string_agg(tenant_id::text, ', ' ORDER BY created_at) AS tenant_ids
        FROM public.memberships
       WHERE role = 'owner'
       GROUP BY user_id
      HAVING count(*) > 1
    ) dup;

  IF n_users > 0 THEN
    RAISE EXCEPTION
      'la base viola "un negocio por persona": % usuario(s) con mas de una membresia owner', n_users
      USING
        ERRCODE = 'unique_violation',
        DETAIL  = conflicts,
        HINT    = 'Esta migracion NO elige por vos cual negocio conserva cada persona: hay stock, '
                  'slug publicado y suscripcion atados a cada tenant. Revisa cada caso con '
                  '"select m.user_id, m.tenant_id, t.slug, t.status, t.created_at from memberships m '
                  'join tenants t on t.id = m.tenant_id where m.role = ''owner'' and m.user_id in (...)" '
                  'y dejale UNA fila owner a cada usuario (update memberships set role = ''seller'' '
                  'where id = ''<la que pierde>''; o delete si esa membresia no debe existir). '
                  'Despues volve a correr la migracion: no quedo registrada.';
  END IF;
END
$$;--> statement-breakpoint

CREATE UNIQUE INDEX "memberships_single_owner_per_user_key" ON "memberships" USING btree ("user_id") WHERE role = 'owner';--> statement-breakpoint

COMMENT ON INDEX "memberships_single_owner_per_user_key" IS 'Capa 1: una persona POSEE un solo negocio. Parcial a proposito (where role = owner): el unico sobre el par (tenant_id, user_id) sigue permitiendo que una persona TRABAJE en varios negocios. Violarlo da 23505; createTenant() lo mapea a "Ya tenes un negocio creado.".';
