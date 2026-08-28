-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 0009 · S9 · Dos afirmaciones del canje que vivían SÓLO en el borde, mudadas al motor.
--
-- Las dos las levantó `adversary-reviewer` sobre S8, y las dos son la misma clase de defecto:
-- una regla de negocio que sólo existe en `apps/web`, en un camino que ya tiene un caller y va a
-- tener otro. Es la doctrina que **0008 escribió en sus propias líneas 36-40** para justificar
-- sus siete CHECK de tamaño — "una afirmación que vive sólo en el borde se pierde el día que
-- aparece un segundo caller" (ADR-025) — aplicada a los largos de texto y no a la regla que
-- tiene consecuencia.
--
-- ── 0008 NO SE EDITA, y por eso esto es un archivo nuevo ───────────────────────────────────
-- El migrador de Drizzle decide qué aplicar comparando `created_at`, **no el hash del `.sql`**.
-- Editar 0008 —que ya está aplicado en toda base de desarrollo— dejaría esas bases sin la
-- corrección y con `migrate` diciendo `OK`, sin síntoma (CLAUDE.md §3). El `ALTER POLICY` de
-- abajo es la forma correcta de cambiar un predicado ya aplicado.
--
-- Lo emitido por `drizzle-kit generate` desde `src/schema/**` son exactamente TRES sentencias:
-- el `CREATE TYPE`, el `ADD COLUMN` y el `ALTER POLICY`. Todo lo demás de este archivo —el
-- backfill, el trigger, los COMMENT y los dos bloques de verificación— se escribió sobre el
-- archivo generado **antes** de aplicarlo, por el mismo motivo del párrafo anterior.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--  A · `accepts_trade_in` dejaba de ser una regla en cuanto uno no pasaba por el handler
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- Medido contra `istock_dev` antes de escribir nada, con un tenant en `accepts_trade_in = false`:
-- una sesión `anon` con el claim del slug, insertando las nueve columnas del GRANT de 0008 sin
-- pasar por el `from tenants t ... and t.accepts_trade_in` del handler, devolvía **`INSERT 0 1`**.
-- La única defensa viva era esa línea del handler
-- (`apps/web/app/(storefront)/s/[slug]/api/tradein/route.ts`).
--
-- Consecuencia concreta, que no es teórica: el día que aparezca un segundo escritor de
-- `tradein_leads` como `anon` —o que alguien simplifique ese `select ... from tenants` a un
-- `values`, que es el refactor más natural del mundo— un tenant que **apagó** el canje empieza a
-- recibir datos personales de visitantes (nombre + WhatsApp) en un inbox que no mira.
--
-- ── Forma elegida: `exists` correlacionado, y las dos alternativas medidas ─────────────────
-- Las dos candidatas eran equivalentes en lógica, porque el primer conjunto ya ata
-- `tenant_id` al tenant del claim:
--
--   A) `and exists (select 1 from tenants t where t.id = tradein_leads.tenant_id
--                   and t.accepts_trade_in)`         ← la elegida
--   B) `and (select accepts_trade_in from tenants where id = (select storefront_tenant_id()))`
--
-- (A) gana por dos motivos, uno de forma y otro medido:
--   · Dice "el tenant DE ESTA FILA toma canje" sin depender de que el otro conjunto siga ahí.
--     (B) sólo significa lo que queremos mientras el primer conjunto exista; es una afirmación
--     que se rompe sola si alguien reordena el predicado.
--   · Es más barata: (B) llama `storefront_tenant_id()` una **tercera** vez por sentencia y
--     paga otra resolución del slug. Medido con `pgbench`, 3000 tx, misma máquina:
--     baseline 0.51 ms/insert · (A) 0.56 ms · (B) 0.62 ms.
--
-- ── Las dos preguntas que había que MEDIR antes de escribir esta policy ────────────────────
-- El subselect corre **como `anon`**, no como el dueño. `GRANT` y RLS son dos capas y se evalúan
-- las dos (CLAUDE.md §2), así que si a `anon` le faltara cualquiera de las dos la policy fallaría
-- CERRADO **siempre** y esta migración rompería el canje entero en vez de arreglarlo.
--
--   1. **Privilegio.** `has_table_privilege('anon','tenants','SELECT')` = `false` (correcto: el
--      read model se otorga por columna), pero
--      `has_column_privilege('anon','tenants','accepts_trade_in','SELECT')` = **`true`** y lo
--      mismo para `id` — las dos están en el GRANT de columna de `0002` §3.a. Es todo lo que el
--      subselect toca. Verificado otra vez en el bloque 4.b de este archivo: si algún día alguien
--      recorta ese GRANT, esta migración aborta en vez de dejar el canje mudo.
--   2. **Filas.** La policy `tenants_storefront_anon_select` (`status = 'active' and slug =
--      storefront_slug()`) le deja ver exactamente la fila de su propio tenant. Y la RLS de
--      `tenants` **sí se aplica adentro del subplan**: se leyó del plan real, no se supuso —
--      `Filter: (accepts_trade_in AND (status = 'active') AND (id = tradein_leads.tenant_id))`.
--      Por construcción esa fila es visible siempre que el primer conjunto sea verdadero, así que
--      no hay falso-cerrado: el tenant del claim es, por definición, activo y del slug.
--
-- ── Costo, que es la otra mitad de la pregunta ─────────────────────────────────────────────
-- Es un `SubPlan` **por fila**, no un `InitPlan`: correlacionar con `tenant_id` es justamente lo
-- que lo hace robusto y lo que le saca la evaluación única. En el camino real —un lead por
-- request desde un formulario público— eso es **una** fila:
--   · `+2 buffers` (`shared hit`, cero lecturas de disco: son la página del índice
--     `tenants_slug_key` y la del heap, calientes porque `storefront_tenant_id()` acaba de
--     leerlas microsegundos antes).
--   · `+0.004 ms` de SubPlan en el `explain (analyze, buffers)` de un insert de una fila.
--   · `+0.047 ms` de mediana sobre la transacción completa medida punta a punta (5 rondas
--     intercaladas de 4000 tx: 0.51 → 0.56 ms, deltas 0.031/0.047/0.084/0.054/0.032).
-- O sea ~9% de una transacción que ya cuesta medio milisegundo, en un endpoint que recibe leads
-- de canje. No hay decisión que tomar acá: es gratis comparado con lo que compra.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--  B · `listings.acquisition_channel` y el CHECK de `accepted` — lo que pidió el §6 de
--      `accept-to-stock.ts`, por escrito, y hasta hoy no existía
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- El §6 de `apps/web/app/(app)/_lib/tradein/accept-to-stock.ts` enumera dos huecos. Los dos
-- están medidos y los dos se cierran acá, uno tal cual se pidió y el otro con otra herramienta
-- porque la pedida rompía al caller. El detalle de cada uno está en su bloque.
-- ═══════════════════════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- ── 1 · A · La policy. Emitida por `drizzle-kit generate` desde `src/schema/tradein.ts` ────
-- ═══════════════════════════════════════════════════════════════════════════════════════════
ALTER POLICY "tradein_leads_storefront_insert" ON "tradein_leads" TO anon WITH CHECK (tenant_id = (select public.storefront_tenant_id()) and exists (select 1 from tenants t where t.id = tradein_leads.tenant_id and t.accepts_trade_in));--> statement-breakpoint

COMMENT ON POLICY "tradein_leads_storefront_insert" ON "tradein_leads" IS 'Vidriera anonima: el lead cae en el tenant del claim del slug (nunca del body) Y ese tenant tiene el canje prendido. La segunda mitad la agrego 0009: hasta S8 la sostenia solo el handler, y un insert como anon salteandolo entraba INSERT 0 1 en un tenant con accepts_trade_in = false. El subselect lee tenants COMO anon, pasando por su GRANT de columna (0002 3.a) y por tenants_storefront_anon_select.';--> statement-breakpoint


-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- ── 2 · B1 · `listings.acquisition_channel`: la procedencia deja de deducirse de dos rastros
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- Hasta hoy, saber que una unidad vino de un canje pedía juntar DOS cosas y ninguna declarativa:
-- el vínculo duro (`tradein_leads.created_listing_id`, o sea un join a la tabla de leads, que
-- además trae PII al alcance de la mano) y la bitácora (`listing_events.metadata ->> 'source' =
-- 'tradein'`, o sea un `jsonb` sin forma garantizada). Ninguno de los dos es un canal.
--
-- `not null default 'purchase'`, y el default no es pereza: cargar una unidad a mano en el panel
-- **es** haberla comprado, y el único otro canal que el producto tiene hoy es el canje, que entra
-- por `accept-to-stock` y va a escribir `'trade_in'` explícito. Dejarla anulable pondría `null`
-- en casi todas las filas y obligaría a un `coalesce` en cada consulta — o sea reintroduciría la
-- suposición que la columna vino a hacer explícita.
--
-- Las filas que YA venían de un canje no se quedan con el default: el §3 las backfillea con el
-- único dato duro que existía. La columna nace de acuerdo con la historia, no encima de ella.
--
-- ── Sobre `anon`: la columna nace invisible para la vidriera, por construcción ─────────────
-- `0002` le da a `anon` un GRANT **de columna** sobre `listings`, y un GRANT de columna no
-- alcanza a las columnas futuras. Así que esto no pide un REVOKE: pide no hacer nada, y el
-- bloque 4.c lo verifica en vez de confiar. Publicarla es una migración y una decisión, igual
-- que `qty` y `kind`. `authenticated` sí la ve y la escribe: su GRANT sobre `listings` es de
-- TABLA (`0001` §2.c), así que la columna nueva entra sola — y eso importa porque Drizzle, en
-- `insert().values()`, **nombra todas las columnas**; el bloque 4.d lo afirma (lección de 0006).
--
-- ── Por qué NO lleva índice, con el número ─────────────────────────────────────────────────
-- `app-agent` pidió "un índice por canal". Se midió antes de decidir, con 4000 unidades y 200
-- por tenant (el techo del ICP: 20-200 equipos, `PRODUCT.md`):
--   · sin índice dedicado → Bitmap Heap Scan por `tenant_id`, `Execution Time: 0.122 ms`,
--     75 buffers, 180 filas descartadas por el filtro.
--   · con `(tenant_id, acquisition_channel, created_at)` → `0.055 ms`, 22 buffers, +48 kB.
-- Se ahorran **0.067 ms** en una consulta de panel que corre unas pocas veces por día, y se paga
-- una sexta escritura de índice en CADA alta y CADA edición de `listings`, que es la tabla más
-- caliente del producto. A esta escala el índice cuesta más de lo que rinde. El día que un tenant
-- tenga 20.000 unidades esto se vuelve a medir y se agrega en una línea; hoy no.
CREATE TYPE "public"."acquisition_channel" AS ENUM('purchase', 'trade_in', 'other');--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "acquisition_channel" "acquisition_channel" DEFAULT 'purchase' NOT NULL;--> statement-breakpoint

COMMENT ON COLUMN "listings"."acquisition_channel" IS 'De donde salio la unidad: purchase (default: cargarla a mano en el panel es haberla comprado), trade_in (lo escribe accept-to-stock) u other. NO es provenance_text: eso es el texto libre que va a la ficha publica, esto es el hecho en un enum, para contarlo y filtrarlo. NO esta en el GRANT de columna de anon y no es un olvido: un GRANT de columna no alcanza a las columnas futuras, asi que nace invisible para la vidriera. Publicarla es una migracion y una decision, igual que qty y kind.';--> statement-breakpoint

COMMENT ON TYPE "public"."acquisition_channel" IS 'Canal de adquisicion de una unidad. Tres valores a proposito: consignment / import / warranty_swap son vocabulario que el producto todavia no tiene, y un valor de enum no se borra, se hereda.';--> statement-breakpoint


-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- ── 3 · El backfill, con el único dato duro que existía hasta hoy ──────────────────────────
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Sin esto, toda unidad nacida de un canje antes de S9 quedaría en `'purchase'` — o sea la
-- columna nueva mentiría sobre exactamente los casos por los que se pidió. El `tenant_id` en el
-- `where` va **además** del `id`, que ya es único: es la misma defensa en profundidad que el repo
-- exige en toda query (CLAUDE.md §2), y acá evita que un `created_listing_id` cruzado —que 0007
-- documenta como posible, porque la FK no lleva el tenant— toque la unidad de otro.
UPDATE "listings" l
   SET "acquisition_channel" = 'trade_in'
  FROM "tradein_leads" t
 WHERE t."created_listing_id" = l."id"
   AND t."tenant_id" = l."tenant_id"
   AND l."acquisition_channel" <> 'trade_in';--> statement-breakpoint


-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- ── 4 · B2 · `accepted` ⇒ hay unidad creada. Por qué NO es un CHECK, medido ────────────────
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- Lo pedido en el §6 de `accept-to-stock.ts` es, textual, "un CHECK que ate `status = 'accepted'`
-- a `created_listing_id is not null`". Un `CHECK` pelado **rompe a quien lo pidió**, y no es una
-- opinión: se corrió el orden de escritura real de `acceptToStock()` contra la base.
--
--   1. `update tradein_leads set status = 'accepted' ...`  ← acá `created_listing_id` es NULL
--   2. `insert into listings ...`
--   3. `update tradein_leads set created_listing_id = ...`
--
-- Un `CHECK` en Postgres **no se puede diferir**: se evalúa al terminar la sentencia (1) y ahí ya
-- está violado. Aceptar un canje devolvería `23514`, que `acceptToStock()` no atrapa, o sea un
-- 500 en la pantalla. Y el orden no es un descuido: el §2 de ese archivo argumenta por escrito
-- que el `update` va primero porque es el guard de concurrencia, y que ponerlo después quemaría
-- un slug y un id por cada carrera perdida. Cambiarlo es una decisión de `app-agent` sobre su
-- propia columna, no algo que `packages/db` pueda tomarle por su cuenta rompiéndole la slice.
--
-- ── Lo que sí es diferible: un CONSTRAINT TRIGGER ──────────────────────────────────────────
-- `DEFERRABLE INITIALLY DEFERRED` corre al **COMMIT**, no al fin de la sentencia. El estado
-- intermedio de (1) queda permitido —que es lo correcto: dentro de una transacción nadie más lo
-- ve— y el estado final se exige igual. Verificado contra la base, los cinco casos:
--   · orden real de `acceptToStock()` (1→2→3) ............................. `COMMIT` ✔
--   · sólo `status = 'accepted'`, sin unidad .............................. `23514` al commit ✔
--   · insert de la vidriera (`status` sale de su default `'new'`) ......... `COMMIT`, no dispara ✔
--   · borrar la unidad de un canje aceptado (`ON DELETE SET NULL` deja el
--     lead en `accepted` con `created_listing_id` NULL) .................. `23514` al commit ✔
--   · aceptar y borrar el lead en la misma transacción .................... `COMMIT` ✔
--
-- El cuarto caso es un **cambio de comportamiento** y se dice acá para que nadie lo descubra
-- depurando: a partir de ahora no se puede borrar una unidad nacida de un canje aceptado sin
-- resolver antes el lead. Hoy no rompe nada —`grep` sobre `apps/web` no encuentra ningún borrado
-- de `listings`; los únicos que existen son teardown de tests, sobre leads que nunca llegan a
-- `accepted`— y cuando exista una pantalla de borrado va a tener que decidir qué pasa con el
-- canje, que es exactamente la pregunta que hoy nadie se hace.
--
-- ── Por qué la función RELEE la fila en vez de mirar `NEW` ─────────────────────────────────
-- Es la trampa de los triggers diferidos y es fácil de no ver: `NEW` es la tupla **del momento de
-- la sentencia**, no la del commit. En el orden real, (1) encola un evento con
-- `NEW = (accepted, NULL)`; si la función mirara `NEW`, ese evento explotaría al commit aunque
-- (3) ya haya arreglado la fila. Releer por PK en el snapshot del commit es lo único que da la
-- respuesta correcta, y de yapa resuelve solo el caso de la fila borrada en la misma transacción
-- (no hay fila → no hay violación).
--
-- ── `SECURITY INVOKER`, a propósito, y qué pasa en cada rol ────────────────────────────────
-- La función **no** es `SECURITY DEFINER`, y la razón es la misma por la que `0002` la rechazó
-- para `storefront_tenant_id()`: con `FORCE ROW LEVEL SECURITY` puesto en las 17 tablas, el dueño
-- tampoco se saltea las policies, así que una `security definer` cuyo dueño no tenga `BYPASSRLS`
-- leería CERO filas — y una relectura que devuelve cero filas acá no rompe: **calla**. Sería un
-- gate vacuamente verde, que es peor que no tenerlo. Con `SECURITY INVOKER`:
--   · `authenticated` (el panel, único escritor de `accepted` que existe) tiene `SELECT` de tabla
--     por `0001` §2.c y su policy `tradein_leads_tenant_select` es `tenant_id = <claim>` — la
--     misma condición que la del `UPDATE` que acaba de hacer. Si pudo escribir la fila, la ve.
--   · `service_role` conserva sus default privileges y tiene `BYPASSRLS`: la ve.
--   · `anon` no dispara nunca — la cláusula `WHEN` es falsa, porque `status` no está en su GRANT
--     de columna y sale siempre de su default `'new'`. Y si algún día alguien se lo diera, `anon`
--     no tiene `SELECT` sobre `tradein_leads`: recibiría `42501` y la escritura se cae igual.
--     Falla cerrado en las dos ramas.
--
-- ── Costo ─────────────────────────────────────────────────────────────────────────────────
-- La cláusula `WHEN (NEW.status = 'accepted')` es lo que hace que esto no se pague en el camino
-- público: el cuerpo ni se llama. Medido con `pgbench`, alternando y con `vacuum full` entre
-- corridas para que la medición no sea bloat disfrazado de trigger:
--   · insert de lead desde la vidriera (`anon`, `status = 'new'`) → delta dentro del ruido
--     (±0.03 ms sobre 0.54 ms; el signo cambia entre rondas). El trigger **no se ejecuta**.
--   · aceptar un canje (dispara dos veces: una por (1) y otra por (3)) → **+0.024 ms** de
--     mediana sobre 0.61 ms, 4 rondas de 3000 tx (deltas 0.023/0.015/0.024/0.028). Cada disparo
--     es un lookup por PK sobre `tradein_leads`.
--
-- ── Pre-chequeo: un CONSTRAINT TRIGGER no valida las filas que ya están ────────────────────
-- A diferencia de un `CHECK ... NOT VALID`, un trigger no mira el pasado: si hay leads `accepted`
-- huérfanos, quedarían adentro y la invariante nacería falsa. Se nombran y se aborta, mismo
-- criterio que el pre-chequeo de 0007: una base sucia es justo el caso donde hace falta saber
-- cuáles son para poder decidir.
DO $do$
DECLARE
  huerfanos text;
BEGIN
  SELECT string_agg(format('tenant %s / lead %s', tenant_id, id), '; ')
    INTO huerfanos
    FROM public.tradein_leads
   WHERE status = 'accepted' AND created_listing_id IS NULL;

  IF huerfanos IS NOT NULL THEN
    RAISE EXCEPTION '0009: hay canjes en accepted sin unidad creada y el trigger no valida el pasado: %', huerfanos
      USING HINT = 'Decidir uno por uno ANTES de aplicar: crear la unidad que falta, o devolver el lead a evaluating. Nada de esto es automatico: aceptar un canje escribe un costo.';
  END IF;
END
$do$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.tradein_leads_accepted_has_listing() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_catalog
AS $fn$
DECLARE
  huerfano boolean;
BEGIN
  -- Relectura por PK en el snapshot del COMMIT. Ver el bloque de arriba: mirar `NEW` daria un
  -- falso positivo en el orden real de acceptToStock(), donde el evento se encola con la fila a
  -- medio escribir y se arregla dos sentencias despues.
  SELECT true INTO huerfano
    FROM public.tradein_leads l
   WHERE l.id = NEW.id
     AND l.status = 'accepted'
     AND l.created_listing_id IS NULL;

  IF huerfano THEN
    RAISE EXCEPTION 'el canje % quedo en accepted sin unidad creada', NEW.id
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'tradein_leads_accepted_has_listing',
            TABLE = 'tradein_leads',
            HINT = 'Aceptar un canje crea la unidad en la MISMA transaccion (accept-to-stock.ts). Un lead accepted sin created_listing_id es media operacion.';
  END IF;

  RETURN NULL;
END
$fn$;--> statement-breakpoint

COMMENT ON FUNCTION public.tradein_leads_accepted_has_listing() IS 'Invariante D-canje: un lead accepted tiene unidad creada. Corre como CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED porque un CHECK no se puede diferir y rompia el orden de escritura de acceptToStock() (update del guard de concurrencia primero, link despues). Relee la fila por PK en vez de mirar NEW: en un trigger diferido NEW es la tupla de la sentencia, no la del commit. SECURITY INVOKER a proposito: con FORCE RLS, una security definer sin BYPASSRLS leeria cero filas y callaria en vez de fallar.';--> statement-breakpoint

CREATE CONSTRAINT TRIGGER "tradein_leads_accepted_has_listing"
  AFTER INSERT OR UPDATE OF "status", "created_listing_id" ON "tradein_leads"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW."status" = 'accepted')
  EXECUTE FUNCTION public.tradein_leads_accepted_has_listing();--> statement-breakpoint


-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- ── 5 · Verificación dentro de la propia migración ─────────────────────────────────────────
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- `src/tradein-accepts-and-acquisition.test.ts` vuelve a probar todo esto con sesiones reales de
-- Postgres; esto es el cinturón, y está acá porque hay una cosa que el test NO puede atrapar: si
-- algo de esto es falso, la migración **no se registra** y la base no queda a medias.
--
-- El caso 4.b es el que justifica el bloque entero. `GRANT` y RLS son dos capas y se evalúan las
-- dos; el `with check` nuevo depende de que `anon` pueda LEER dos columnas de `tenants`. Si un
-- día alguien recorta ese GRANT de columna, la policy no se vuelve permisiva: se vuelve
-- imposible de satisfacer, y el canje deja de funcionar **en silencio, sólo en producción**,
-- porque en local la conexión es superusuario. Es exactamente el modo de falla que CLAUDE.md §2
-- dice que costó un fallo de slice en FASE 2.
DO $do$
DECLARE
  problema text;
  with_check_actual text;
  faltante text;
  trig record;
BEGIN
  SELECT p.with_check INTO with_check_actual
    FROM pg_policies p
   WHERE p.schemaname = 'public' AND p.tablename = 'tradein_leads'
     AND p.policyname = 'tradein_leads_storefront_insert';

  SELECT t.tgdeferrable, t.tginitdeferred, t.tgtype, t.tgconstraint INTO trig
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.tradein_leads'::regclass
     AND t.tgname = 'tradein_leads_accepted_has_listing';

  -- Drizzle NOMBRA TODAS las columnas en `insert().values()` y Postgres exige el privilegio sobre
  -- cada columna nombrada aunque el valor sea DEFAULT. Una columna nueva sin privilegio de INSERT
  -- para `authenticated` no dice "no la elijas": dice "no insertes nada". Lección de 0006.
  SELECT string_agg(a.attname, ', ') INTO faltante
    FROM pg_attribute a
   WHERE a.attrelid = 'public.listings'::regclass AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attgenerated = ''
     AND NOT has_column_privilege('authenticated', 'public.listings', a.attname, 'INSERT');

  -- ── a · la policy quedó con las DOS mitades. Un ALTER que pierde el tenant es peor que nada.
  IF with_check_actual IS NULL THEN
    problema := 'no existe la policy tradein_leads_storefront_insert';
  ELSIF with_check_actual !~ 'storefront_tenant_id' THEN
    problema := format('el with_check dejo de acotar por el claim del slug: %s', with_check_actual);
  ELSIF with_check_actual !~ 'accepts_trade_in' THEN
    problema := format('el with_check no exige accepts_trade_in: %s', with_check_actual);

  -- ── b · …y `anon` puede EVALUARLA. Sin estas dos columnas la policy falla cerrado siempre.
  ELSIF NOT has_column_privilege('anon', 'public.tenants', 'accepts_trade_in', 'SELECT') THEN
    problema := 'anon no puede leer tenants.accepts_trade_in: el with_check nuevo fallaria cerrado y el canje entero dejaria de entrar';
  ELSIF NOT has_column_privilege('anon', 'public.tenants', 'id', 'SELECT') THEN
    problema := 'anon no puede leer tenants.id: el subselect del with_check no puede correlacionar';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                     AND tablename = 'tenants' AND policyname = 'tenants_storefront_anon_select') THEN
    problema := 'desaparecio tenants_storefront_anon_select: anon tendria GRANT y cero filas visibles';

  -- ── c · la columna nueva NO se filtro a la vidriera. Un GRANT de columna no alcanza a las
  --        columnas futuras, asi que esto tiene que ser cierto sin haber hecho nada — y por eso
  --        mismo se verifica: lo que se da por obvio es lo que nadie mira.
  ELSIF has_column_privilege('anon', 'public.listings', 'acquisition_channel', 'SELECT') THEN
    problema := 'anon puede leer listings.acquisition_channel: la columna se filtro al read model publico';

  -- ── d · …y el panel SI la puede escribir (ver el comentario del SELECT de arriba).
  ELSIF faltante IS NOT NULL THEN
    problema := format('authenticated no puede nombrar en un INSERT sobre listings: %s', faltante);

  -- ── e · el trigger existe y es DIFERIDO. Uno inmediato romperia acceptToStock() en su primera
  --        sentencia, que es justo el modo de falla que este archivo eligio evitar.
  ELSIF trig IS NULL THEN
    problema := 'no existe el trigger tradein_leads_accepted_has_listing: accepted sin unidad no lo frena nadie';
  ELSIF NOT trig.tgdeferrable THEN
    problema := 'tradein_leads_accepted_has_listing no es DEFERRABLE: rompe el orden de escritura de acceptToStock()';
  ELSIF NOT trig.tginitdeferred THEN
    problema := 'tradein_leads_accepted_has_listing no es INITIALLY DEFERRED: se evaluaria por sentencia';
  ELSIF trig.tgconstraint = 0 THEN
    problema := 'tradein_leads_accepted_has_listing no es un constraint trigger';

  -- ── f · el backfill no dejo ninguna unidad de canje contada como compra.
  ELSIF EXISTS (
    SELECT 1 FROM public.tradein_leads t
      JOIN public.listings l ON l.id = t.created_listing_id AND l.tenant_id = t.tenant_id
     WHERE l.acquisition_channel <> 'trade_in'
  ) THEN
    problema := 'quedaron unidades enlazadas desde un tradein_lead con acquisition_channel <> trade_in: el backfill no corrio o no vio las filas';
  END IF;

  IF problema IS NOT NULL THEN
    RAISE EXCEPTION '0009: %', problema;
  END IF;
END
$do$;
