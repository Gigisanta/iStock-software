-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 0007 · D8 · Una unidad tiene a lo sumo UNA venta, y eso lo afirma el MOTOR.
--
-- ── Qué garantizaba la invariante hasta hoy, y por qué no alcanza ──────────────────────────
-- Dos cosas, y las dos viven en `apps/web`, ninguna en la base:
--   · `sold` es terminal — `checkTransition` devuelve `terminal_state` desde `sold`
--     (`packages/domain/src/listing-status.ts`), y
--   · el `eq(listings.status, from)` que `transitionUnit()` usa como guard de concurrencia
--     (`apps/web/app/(app)/_lib/listings/publish-listing.ts`).
--
-- Las dos son buenas capas y se quedan. Lo que falta es que la afirmación exista donde no
-- depende de que el próximo writer la re-derive: `sales` tiene HOY cero escritores de producción
-- (`grep -rn 'sales' apps packages tests` devuelve sólo tests), o sea que el primer escritor real
-- llega con S7 y el segundo —un canje que cierra en venta, un import de stock, un backfill— va a
-- llegar sin leer esto. Es la misma doctrina de defensa en profundidad por la que este repo
-- exige el filtro de tenant en la query **además** de RLS: la máquina de estados es la primera
-- capa, el motor es la última, y la última es la que sigue en pie cuando la primera tiene un bug.
--
-- Medido contra la base sembrada ANTES de escribir esta migración (S7, `db-agent`): dos ventas de
-- la misma unidad, mismo tenant, sesión `authenticated` real → **las dos entran**. Después de
-- esta migración la segunda da `23505`.
--
-- ── Por qué REEMPLAZA a `sales_tenant_listing_idx` en vez de convivir ──────────────────────
-- Porque no hay una sola lectura que convivir. Dos motivos, en ese orden:
--   1. **No existe consulta de producción sobre `sales`** — se buscó antes de borrar, no después.
--   2. Y aunque existiera: el índice nuevo tiene **las mismas dos columnas en el mismo orden**.
--      Un btree único no se lee distinto de uno común; sólo verifica de más al escribir. Cubre
--      todo plan que cubría el anterior, incluido el que usa `tenant_id` solo como prefijo.
-- Dejar los dos sería pagar dos inserciones de índice por fila para servir un único árbol de
-- lectura. La medición del plan queda en el bloque 3 de este archivo, con `explain` de verdad.
--
-- ── Por qué `(tenant_id, listing_id)` y no `(listing_id)` a secas ──────────────────────────
-- `(listing_id)` solo sería una afirmación más fuerte y **peor**: un único GLOBAL convierte al
-- índice en un oráculo cruzado. Un tenant que adivina o consigue el `id` de una unidad ajena
-- distingue "ya vendida" de "no vendida" por el `23505` que recibe, sin haber leído una fila y
-- sin que RLS se entere — el error del motor se evalúa antes que cualquier policy de lectura.
-- Con el tenant adentro de la clave, ese insert cruzado no colisiona con nada de nadie.
--
-- El precio de esa elección, dicho para que nadie lo descubra después: la unicidad es **por
-- tenant**. Lo que la completaría —que la venta y el listing sean del mismo tenant— hoy la base
-- **no** lo ata: `sales.listing_id` referencia `listings(id)` a secas, sin el tenant. Medido en
-- S7: un tenant puede insertar una venta PROPIA apuntando al `listing_id` de OTRO y la policy la
-- acepta (el `with check` mira `tenant_id`, que es el suyo). No filtra datos —el join contra
-- `listings` lo corta RLS— pero con `on delete restrict` le clava la unidad al otro tenant.
-- Cerrarlo pide FK compuesta contra `listings(tenant_id, id)`, o sea tocar `listings` y pagar un
-- índice único más en la tabla más caliente del producto: es un **hallazgo reportado al LEAD**,
-- no un cambio que esta slice se tome por su cuenta.
--
-- ── La trampa del migrador (CLAUDE.md §3) ──────────────────────────────────────────────────
-- Las dos sentencias de abajo las emitió `drizzle-kit generate` desde `src/schema/commerce.ts`.
-- Todo lo demás —el pre-chequeo, la verificación y estos comentarios— se escribió sobre el
-- archivo generado **antes** de aplicarlo. Drizzle decide qué aplicar comparando `created_at` y
-- no el hash del `.sql`: editar una migración ya aplicada la deja sin corregir en toda base que
-- ya la tenga, con `migrate` diciendo `OK` y sin síntoma.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

-- ── 1 · Pre-chequeo: decir QUÉ unidad tiene dos ventas, en vez de un 23505 mudo ────────────
-- `CREATE UNIQUE INDEX` sobre datos sucios falla igual, pero con un mensaje que nombra el índice
-- y no la fila. Una base con ventas duplicadas es exactamente el caso en el que hace falta saber
-- cuáles son para poder decidir, así que la migración las nombra antes de romper.
DO $do$
DECLARE
  duplicadas text;
BEGIN
  SELECT string_agg(format('tenant %s / listing %s → %s ventas', tenant_id, listing_id, n), '; ')
    INTO duplicadas
    FROM (
      SELECT tenant_id, listing_id, count(*) AS n
        FROM public.sales
       GROUP BY tenant_id, listing_id
      HAVING count(*) > 1
    ) d;

  IF duplicadas IS NOT NULL THEN
    RAISE EXCEPTION '0007: hay unidades con mas de una venta y el indice unico no puede crearse: %', duplicadas
      USING HINT = 'Decidir cual es la venta buena ANTES de aplicar. Borrar la sobrante no es automatico: sales.margin_usd es historia contable, no cache.';
  END IF;
END
$do$;--> statement-breakpoint

-- ── 2 · El cambio, generado por drizzle-kit ────────────────────────────────────────────────
DROP INDEX "sales_tenant_listing_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "sales_one_sale_per_listing" ON "sales" USING btree ("tenant_id","listing_id");--> statement-breakpoint

COMMENT ON INDEX "sales_one_sale_per_listing" IS 'D8: una unidad tiene a lo sumo UNA venta por tenant, afirmado en el motor y no solo en la maquina de estados. Reemplaza a sales_tenant_listing_idx (mismas columnas, mismo orden: cubre los mismos planes). El tenant va en la clave a proposito: un unico global seria un oraculo cruzado (un 23505 revela que la unidad ajena ya se vendio).';--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- ── 3 · Verificación, dentro de la propia migración ────────────────────────────────────────
-- `sales` existe desde 0000, tiene RLS desde 0001 y GRANT desde 0001 — pero **nunca la escribió
-- código de producción**, así que ninguno de esos privilegios se ejerció jamás. Un privilegio no
-- ejercido es una suposición, y CLAUDE.md §3 ya cobró una vez por confundir las dos capas:
-- `GRANT` decide si podés TOCAR la tabla, la policy decide QUÉ FILAS; un rol con `BYPASSRLS` y
-- sin `GRANT` recibe `42501` y no lee nada. S7 es la slice donde eso se enciende, así que acá se
-- afirma. Si algo es falso la migración aborta y **no se registra**.
-- `src/sales-one-sale-per-listing.test.ts` lo vuelve a probar con sesiones reales; esto es el
-- cinturón.
DO $do$
DECLARE
  problema text;
  faltante text;
  idx_def text;
  check_insert text;
  qual_select text;
BEGIN
  SELECT pg_get_indexdef(i.indexrelid) INTO idx_def
    FROM pg_index i WHERE i.indexrelid = to_regclass('public.sales_one_sale_per_listing');

  SELECT p.with_check, q.qual INTO check_insert, qual_select
    FROM (SELECT with_check FROM pg_policies
           WHERE schemaname='public' AND tablename='sales' AND policyname='sales_tenant_insert') p
    FULL JOIN (SELECT qual FROM pg_policies
           WHERE schemaname='public' AND tablename='sales' AND policyname='sales_tenant_select') q ON true;

  -- Toda columna NO generada tiene que ser nombrable en un INSERT por `authenticated`: Drizzle,
  -- en `insert().values()`, NOMBRA TODAS las columnas y pone `default` en las que no le pasaste,
  -- y Postgres pide el privilegio sobre cada columna NOMBRADA aunque el valor sea `DEFAULT`.
  -- Es la lección que 0006 pagó rompiendo el alta de reservas.
  SELECT string_agg(a.attname, ', ') INTO faltante
    FROM pg_attribute a
   WHERE a.attrelid = 'public.sales'::regclass AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attgenerated = ''
     AND NOT has_column_privilege('authenticated', 'public.sales', a.attname, 'INSERT');

  -- ── a · el índice de D8 existe, es ÚNICO, y sobre las columnas correctas en ese orden.
  IF idx_def IS NULL THEN
    problema := 'no existe el indice sales_one_sale_per_listing: D8 no esta afirmada en el motor';
  ELSIF idx_def !~* 'CREATE UNIQUE INDEX' THEN
    problema := 'sales_one_sale_per_listing existe pero NO es unico: no afirma nada';
  ELSIF idx_def !~* '\(tenant_id, listing_id\)' THEN
    problema := format('sales_one_sale_per_listing no es sobre (tenant_id, listing_id): %s', idx_def);
  -- ── b · reemplaza, no convive. Si el viejo sigue ahi, se paga doble escritura por nada.
  ELSIF to_regclass('public.sales_tenant_listing_idx') IS NOT NULL THEN
    problema := 'sales_tenant_listing_idx sigue existiendo: el unico lo reemplaza, no convive con el';
  -- ── c · …y el DROP no se llevo mas de lo que debia.
  ELSIF to_regclass('public.sales_tenant_idx') IS NULL THEN
    problema := 'desaparecio sales_tenant_idx: el indice de tenant_id es obligatorio (CLAUDE.md §7)';
  ELSIF to_regclass('public.sales_tenant_sold_at_idx') IS NULL THEN
    problema := 'desaparecio sales_tenant_sold_at_idx';
  -- ── d · margin_usd la deriva Postgres. Si dejara de ser generada, el costo se escribiria
  --        desde el request por la puerta de al lado (D2 de la spec de S7).
  ELSIF (SELECT attgenerated FROM pg_attribute
          WHERE attrelid='public.sales'::regclass AND attname='margin_usd') <> 's' THEN
    problema := 'sales.margin_usd dejo de ser una columna generada: el margen pasa a ser un valor que alguien escribe';
  -- ── e · RLS prendida Y forzada. Sin FORCE, el dueño de la tabla se saltea las policies.
  ELSIF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.sales'::regclass) THEN
    problema := 'sales no tiene RLS habilitada';
  ELSIF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid='public.sales'::regclass) THEN
    problema := 'sales no tiene FORCE ROW LEVEL SECURITY';
  -- ── f · capa 1 (GRANT): el panel puede TOCAR la tabla. Es lo que S7 enciende por primera vez.
  ELSIF NOT has_table_privilege('authenticated', 'public.sales', 'INSERT') THEN
    problema := 'authenticated no tiene INSERT sobre sales: el panel no puede registrar una venta (42501)';
  ELSIF NOT has_table_privilege('authenticated', 'public.sales', 'SELECT') THEN
    problema := 'authenticated no tiene SELECT sobre sales';
  ELSIF faltante IS NOT NULL THEN
    problema := format('authenticated no puede nombrar en un INSERT: %s — Drizzle nombra TODAS las columnas y da 42501', faltante);
  -- ── g · el cron / los jobs.
  ELSIF NOT has_table_privilege('service_role', 'public.sales', 'SELECT') THEN
    problema := 'service_role no puede leer sales: BYPASSRLS no reemplaza al GRANT (CLAUDE.md §2)';
  -- ── h · capa 2 (policy): el INSERT del panel queda atado al tenant de la sesion.
  ELSIF check_insert IS NULL THEN
    problema := 'no existe la policy sales_tenant_insert o no tiene with check: un tenant escribe filas de otro';
  ELSIF position('tenant_id' in check_insert) = 0 THEN
    problema := 'el with check de sales_tenant_insert no exige tenant_id';
  ELSIF check_insert ~* '^\s*true\s*$' THEN
    problema := 'el with check de sales_tenant_insert es true: RLS decorativa';
  ELSIF qual_select IS NULL THEN
    problema := 'no existe la policy sales_tenant_select';
  ELSIF position('tenant_id' in qual_select) = 0 OR qual_select ~* '^\s*true\s*$' THEN
    problema := 'el using de sales_tenant_select no acota por tenant: un tenant lee (y CUENTA) las ventas de otro';
  -- ── i · la vidriera no ve una venta ni por asomo. Ni la tabla, ni el costo.
  ELSIF has_table_privilege('anon', 'public.sales', 'SELECT') THEN
    problema := 'anon puede leer sales: la vidriera no ve ventas de nadie';
  ELSIF has_column_privilege('anon', 'public.sales', 'cost_usd', 'SELECT') THEN
    problema := 'anon puede leer sales.cost_usd (SENSITIVE: never in public DTO)';
  ELSIF has_table_privilege('anon', 'public.sales', 'INSERT') THEN
    problema := 'anon puede escribir sales';
  END IF;

  IF problema IS NOT NULL THEN
    RAISE EXCEPTION '0007: sales no cumple lo que esta migracion afirma: %', problema
      USING HINT = 'GRANT y RLS son dos capas y se evaluan las dos (CLAUDE.md §3). Revisar los bloques 2 y 3 de esta migracion antes de aplicarla de nuevo.';
  END IF;
END
$do$;
