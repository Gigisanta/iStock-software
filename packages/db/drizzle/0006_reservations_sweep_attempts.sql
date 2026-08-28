-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 0006 · `reservations.sweep_attempts`: la memoria que le faltaba al barrido de reservas.
--
-- ── El defecto (verificado contra HEAD, no es teórico) ─────────────────────────────────────
-- El cron de expiración toma
--     where status = 'active' and expires_at <= now() order by expires_at asc limit 200
-- y cierra fila por fila. Una fila que falla hace rollback y queda `active` con el **mismo
-- `expires_at`**, así que vuelve a ser la primera candidata de la próxima corrida. Y de la
-- siguiente. Para siempre. No hay dónde anotar que ya falló: `reservations` no tenía ninguna
-- columna de intentos.
--
-- El modo de falla real no es "200 filas rotas independientes". Es una **causa sistémica que
-- envenena todas las filas de una**: un `GRANT` faltante (`42501`, el que CLAUDE.md §3 dice que
-- "aparece el día que se prende el cron"), una migración editada después de aplicada, un check
-- nuevo en `listing_events`. Con dos filas debidas y las dos fallando ya no vence nada de nadie,
-- el stock queda `reserved` en la vidriera de todos los tenants a la vez, y el endpoint sigue
-- devolviendo `200 OK`. Eso es lo peor de todo: la falla es **muda**.
--
-- Esta migración agrega **el lugar donde anotar**, y nada más. Qué hace el barrido con el número
-- —a quién saltea, con qué techo, si ordena o filtra por él— es de `app-agent` y va después.
-- El `order by` no se toca acá a propósito.
--
-- ── Por qué el default es 0 y no NULL ─────────────────────────────────────────────────────
-- `not null default 0` para que no exista el estado "no sé cuántas veces falló". Un contador que
-- admite NULL obliga a `coalesce(sweep_attempts, 0)` en cada query del cron, y el día que alguien
-- se lo olvida, `sweep_attempts < 3` con NULL da NULL → la fila desaparece del barrido en vez de
-- entrar. El backfill de las filas existentes lo hace el propio `ADD COLUMN ... DEFAULT 0`.
--
-- El `CHECK (sweep_attempts >= 0)` no es decoración: un contador que puede ir a negativo es una
-- forma de apagar el guard escribiendo -1 sin que nadie lo vea en un diff.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- ── 1 · La columna y la policy ────────────────────────────────────────────────────────────
-- Las tres sentencias de abajo las emitió `drizzle-kit generate` desde `src/schema/commerce.ts`
-- (§3: `push` no es fuente de verdad). Todo lo demás de este archivo —los GRANT, el COMMENT y el
-- bloque de verificación— se escribió sobre el archivo generado ANTES de aplicarlo: drizzle
-- compara `created_at` y no el hash, así que editar una migración ya aplicada la deja sin
-- corregir en toda base que ya la tenga, con `migrate` diciendo `OK`.
ALTER TABLE "reservations" ADD COLUMN "sweep_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_sweep_attempts_non_negative" CHECK (sweep_attempts >= 0);--> statement-breakpoint
ALTER POLICY "reservations_tenant_insert" ON "reservations" TO authenticated WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and sweep_attempts = 0);--> statement-breakpoint

COMMENT ON COLUMN "reservations"."sweep_attempts" IS 'Intentos fallidos del cron de expiracion sobre ESTA reserva. La escribe SOLO service_role (el cron). Al panel se lo impiden DOS capas distintas, cada una donde sirve: el INSERT lo ata la POLICY (with check sweep_attempts = 0) y el UPDATE lo ata el GRANT por columna (esta columna no esta en la lista). anon no tiene ningun privilegio sobre reservations.';--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- ── 2 · Quién puede TOCAR la columna. Es la mitad cara de esta migración. ──────────────────
--
-- CLAUDE.md §2: "columna nueva sin GRANT no la lee nadie", y §3: `GRANT` y RLS son **dos capas
-- que se evalúan las dos** — el `GRANT` decide si podés TOCAR la tabla, la policy decide QUÉ
-- FILAS escribís. Esta migración usa las dos, y usa cada una donde la otra no llega. Que sean dos
-- capas distintas no es una redundancia elegante: es lo que hace que exista una que sepa decir
-- "sí, pero en cero", cosa que un `GRANT` no sabe decir.
--
-- El reparto que queda, explícito:
--
--   · `service_role` (el cron)  → SELECT + UPDATE + INSERT + DELETE. **Es el único que escribe.**
--     No hace falta ni un statement acá: 0001 le dio `GRANT ... ON TABLE "reservations"` a nivel
--     de TABLA, y un privilegio de tabla en Postgres cubre las columnas que se agreguen después.
--     Se afirma abajo en el bloque de verificación en vez de asumirse, porque "no hace falta
--     hacer nada" es exactamente la frase que precede a un `42501` en producción.
--
--   · `authenticated` (el panel del seller) → SELECT sí. INSERT sí, **pero en cero**. UPDATE no.
--     Y esas dos escrituras se atan con mecanismos DISTINTOS a propósito:
--
--     ── UPDATE: `GRANT` por columna ────────────────────────────────────────────────────────
--     Es la mitad que de verdad importa. El ataque es forjar el contador **después**, sobre una
--     reserva viva: un seller que escribe `sweep_attempts = 999` en su propia reserva (su RLS se
--     lo permite, es su tenant) se fabrica una reserva que el barrido va a saltear para siempre —
--     stock congelado en `reserved` a voluntad, o sea el bug que este contador vino a arreglar,
--     ahora disponible como feature. 0001 dio `UPDATE` a nivel de TABLA, y un privilegio de tabla
--     cubre las columnas futuras: sin el REVOKE de abajo la columna nace escribible por cualquier
--     sesión de seller el mismo día que se crea, sin que nadie lo decida. Se revoca el privilegio
--     de TABLA y se re-otorga COLUMNA POR COLUMNA, igual que 0002 para `anon`. Un
--     `update reservations set sweep_attempts = 0` desde el panel no "filtra de más": **no
--     compila**, da `42501`. Y este mecanismo funciona acá porque el `.set()` de Drizzle nombra
--     **sólo** las columnas que setea.
--
--     ── INSERT: la POLICY, y el `GRANT` se queda a nivel de tabla ─────────────────────────
--     Acá el mismo patrón está MAL, y esto no es teoría: la primera versión de esta migración
--     sacaba `sweep_attempts` del `GRANT INSERT` y **rompió el alta de reservas del panel**
--     (`42501`, `permission denied for table reservations`, los dos specs e2e de S6 en rojo).
--     El motivo es que Drizzle, en `insert().values()`, **NOMBRA TODAS las columnas de la tabla**
--     y pone `default` en las que no le pasaste:
--
--         insert into "reservations" ("id","tenant_id",…,"sweep_attempts","created_at","updated_at")
--         values ($1,…,default,default,default)
--
--     y Postgres exige el privilegio de INSERT sobre cada columna **nombrada en la lista, aunque
--     el valor sea `DEFAULT`**. O sea que el GRANT por columna no dice "no la elijas": dice "no
--     insertes NADA". La reproducción mínima son dos sentencias idénticas salvo esa columna en la
--     lista: con ella, `permission denied for table`; sin ella, la capa GRANT pasa.
--
--     El candado correcto para el INSERT es el `WITH CHECK` de la policy de arriba, que exige
--     `sweep_attempts = 0`. El caller que no la manda entra con su `default 0`; el que manda
--     `sweep_attempts = 7` recibe `new row violates row-level security policy`. La diferencia
--     entre los dos `42501` no es cosmética y `src/test-session.ts` la documenta: uno dice que
--     nunca tuviste privilegio, el otro dice que la policy miró la fila y la rechazó.
--
--   · `anon` (la vidriera) → NADA, y no hace falta ningún statement: 0001 y 0002 hacen
--     `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon` y `reservations` nunca recibió un
--     GRANT de columna. Para `anon` esta tabla no existe. También se afirma abajo.
--
-- ── El costo de este patrón, dicho para que no sorprenda ──────────────────────────────────
-- Con el privilegio de UPDATE por columna, **la próxima columna de `reservations` nace no
-- actualizable por el panel** y la migración que la agregue tiene que otorgarla a mano. Es el
-- mismo trato que ya tienen las tablas nuevas desde que 0001 revocó los DEFAULT PRIVILEGES: falla
-- cerrado, en la primera prueba, y no en producción. Se paga a propósito. El INSERT, en cambio,
-- **no** paga ese costo — y no puede pagarlo, porque el que emite la lista de columnas es Drizzle
-- y no nosotros.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

REVOKE UPDATE ON TABLE "reservations" FROM authenticated;--> statement-breakpoint

-- Las 11 columnas que existían antes de esta migración. `sweep_attempts` NO está, y esa ausencia
-- es el punto entero del bloque. Ojo: acá va sólo UPDATE. El `INSERT` de tabla que dio 0001 se
-- queda intacto **a propósito** (ver arriba); quien lo convierta en un GRANT por columna rompe el
-- alta de reservas y el bloque `DO` de abajo se lo dice antes de que la migración se registre.
GRANT UPDATE (
  "id", "tenant_id", "listing_id", "status", "minutes", "expires_at",
  "customer_label", "created_by", "closed_at", "created_at", "updated_at"
) ON TABLE "reservations" TO authenticated;--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- ── 3 · Verificación, dentro de la propia migración ───────────────────────────────────────
-- Las afirmaciones de arriba se comprueban acá, contra `has_*_privilege` y `pg_policies`, y si
-- alguna es falsa la migración **aborta y no se registra**. El motivo: media docena de líneas de
-- este archivo son de la forma "no hace falta hacer nada porque X", y una suposición sobre
-- privilegios que nadie ejecuta es la que produjo el fallo de FASE 2.
-- `src/reservations-sweep-attempts.test.ts` lo vuelve a probar con sesiones reales y con la forma
-- de sentencia que emite Drizzle (que es lo que cuenta); esto es el cinturón.
DO $do$
DECLARE
  problema text;
  check_insert text;
BEGIN
  SELECT with_check INTO check_insert FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'reservations'
     AND policyname = 'reservations_tenant_insert';

  -- a · el cron escribe. Si esto es falso, el contador no se puede incrementar y el barrido queda
  --     igual de roto que antes, pero ahora con una columna que da la impresión contraria.
  IF NOT has_column_privilege('service_role', 'reservations', 'sweep_attempts', 'UPDATE') THEN
    problema := 'service_role no puede UPDATE sweep_attempts: el cron no puede anotar el intento';
  -- b · el cron lee.
  ELSIF NOT has_column_privilege('service_role', 'reservations', 'sweep_attempts', 'SELECT') THEN
    problema := 'service_role no puede SELECT sweep_attempts';
  -- c · el panel lee (que sea visible es deliberado, no un descuido).
  ELSIF NOT has_column_privilege('authenticated', 'reservations', 'sweep_attempts', 'SELECT') THEN
    problema := 'authenticated perdio el SELECT de sweep_attempts: el panel no puede mostrar la falla';
  -- d · el panel NO puede ACTUALIZAR la columna. Eso lo ata el GRANT, y se afirma dos veces: el
  --     privilegio de columna ausente, y el de TABLA ausente (si el de tabla estuviera, cubriría
  --     la columna y el de columna daría true igual — o sea que sin esta segunda mitad, un
  --     `GRANT UPDATE ON TABLE` de vuelta pasaría desapercibido).
  ELSIF has_column_privilege('authenticated', 'reservations', 'sweep_attempts', 'UPDATE') THEN
    problema := 'authenticated puede UPDATE sweep_attempts: una sesion de seller congela su stock';
  ELSIF has_table_privilege('authenticated', 'reservations', 'UPDATE') THEN
    problema := 'authenticated tiene UPDATE a nivel de TABLA: cubre sweep_attempts y toda columna futura';
  -- e · el panel SÍ puede INSERTAR, y a nivel de TABLA. Es la mitad que faltaba: Drizzle nombra
  --     TODAS las columnas en `insert().values()`, asi que un GRANT por columna no restringe el
  --     valor, rompe el alta entera con `permission denied for table reservations`.
  ELSIF NOT has_table_privilege('authenticated', 'reservations', 'INSERT') THEN
    problema := 'authenticated no tiene INSERT de TABLA: el insert de Drizzle nombra sweep_attempts y da 42501';
  ELSIF NOT has_column_privilege('authenticated', 'reservations', 'sweep_attempts', 'INSERT') THEN
    problema := 'authenticated no puede nombrar sweep_attempts en un INSERT: el alta de reservas del panel se rompe';
  -- f · …y lo que impide forjar el contador AL CREAR es la POLICY, no el GRANT. Sin esta
  --     afirmacion, el punto (e) seria simplemente "el panel puede escribir lo que quiera".
  ELSIF check_insert IS NULL THEN
    problema := 'no existe la policy reservations_tenant_insert o no tiene with check';
  ELSIF position('sweep_attempts' in check_insert) = 0 THEN
    problema := 'el with check de reservations_tenant_insert no exige sweep_attempts = 0: se forja el contador al crear la reserva';
  ELSIF position('tenant_id' in check_insert) = 0 THEN
    problema := 'el with check de reservations_tenant_insert dejo de exigir el tenant: lo extra va EN AND, nunca reemplaza';
  -- g · el panel SIGUE escribiendo lo suyo. Sin esto, el REVOKE de arriba pudo haber roto el
  --     panel entero y la migracion estaria "verde" por haber apagado todo.
  ELSIF NOT has_column_privilege('authenticated', 'reservations', 'status', 'UPDATE') THEN
    problema := 'authenticated perdio el UPDATE de status: el REVOKE se llevo mas de lo que debia';
  ELSIF NOT has_column_privilege('authenticated', 'reservations', 'tenant_id', 'INSERT') THEN
    problema := 'authenticated perdio el INSERT de tenant_id: el panel no puede crear reservas';
  -- h · la vidriera no toca nada. Ni la columna nueva ni la tabla.
  ELSIF has_table_privilege('anon', 'reservations', 'SELECT') THEN
    problema := 'anon puede leer reservations: la vidriera no ve reservas de nadie';
  ELSIF has_column_privilege('anon', 'reservations', 'sweep_attempts', 'SELECT') THEN
    problema := 'anon puede leer sweep_attempts';
  ELSIF has_column_privilege('anon', 'reservations', 'sweep_attempts', 'UPDATE') THEN
    problema := 'anon puede escribir sweep_attempts';
  END IF;

  IF problema IS NOT NULL THEN
    RAISE EXCEPTION '0006: reparto de privilegios de reservations.sweep_attempts incorrecto: %', problema
      USING HINT = 'GRANT y RLS son dos capas y se evaluan las dos (CLAUDE.md §3): el GRANT decide si podes tocar la tabla, la policy decide que filas escribis. Revisar el bloque 2 de esta migracion antes de aplicarla de nuevo.';
  END IF;
END
$do$;
