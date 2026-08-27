-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 0002 · La vidriera anónima SÍ es un cliente de Postgres, y por eso está acotada dos veces:
--        GRANT a nivel de COLUMNA + policies `TO anon` de sólo SELECT.
--
-- ── Por qué existe esta migración (hallazgo HIGH-1 de la ronda S1) ─────────────────────────
-- 0001 asumió que el visitante nunca tocaba Postgres: `REVOKE ALL ... FROM anon` y cero policies
-- `TO anon`. En desarrollo eso "funcionaba" por la razón equivocada — la conexión local es
-- SUPERUSER y un superusuario **se saltea FORCE ROW LEVEL SECURITY entero**, así que el
-- aislamiento entre tenants lo estaba haciendo el `where` explícito de la query, no la base.
-- Verificado contra el Postgres real:
--     select current_user, usesuper from pg_user where usename = current_user;  -->  usesuper = t
-- Con un rol NO superusuario —o sea, producción— el mismo camino recibe
-- `42501 permission denied for table listings` y la vidriera lee CERO filas.
-- `GRANT` y RLS son **dos capas** y se evalúan las dos: el GRANT decide si podés tocar la tabla,
-- la policy decide qué filas ves.
--
-- ── Capa 1 · GRANT de COLUMNA, no de tabla ────────────────────────────────────────────────
-- `anon` no recibe `GRANT SELECT ON listings`. Recibe `GRANT SELECT (slug, title, price_usd, …)`.
-- Consecuencia buscada, y es la mitad del valor de esta migración:
--     select * from listings          →  42501
--     select imei from listings       →  42501
--     select cost_usd from listings   →  42501
-- No "filtra de más": **no corre**. Es la única defensa que sigue en pie el día que
-- `publicListingDTO` tenga un bug o alguien escriba un `select *` con Drizzle (CLAUDE.md §2, §5).
-- Las columnas que NUNCA aparecen en un GRANT a `anon`, ni acá ni nunca:
--     listings.imei · listings.imei_check_* · listings.cost_usd · listings.margin_usd ·
--     listings.supplier · listings.internal_notes · listings.created_by ·
--     listing_photos.master_key · fx_settings.updated_by · sales.* · tradein_leads.* ·
--     memberships.* · users.* · chatbot_*.* · reservations.* · subscriptions.* · entitlements.*
-- (`sales`, `tradein_leads`, `reservations`, `chatbot_*`, `subscriptions`, `entitlements`,
--  `memberships`, `users`, `listing_events`, `wa_click_events` no aparecen en este archivo: para
--  `anon` esas diez tablas siguen sin existir.)
--
-- ── Capa 2 · Policies `TO anon`, sólo SELECT ──────────────────────────────────────────────
-- Deciden QUÉ FILAS. **Cero policies de INSERT/UPDATE/DELETE para `anon`**, ni restringidas: un
-- visitante no escribe. Si mañana la vidriera necesita registrar un lead o un click de WhatsApp,
-- eso entra por una Server Function con el rol del server, no con el rol del visitante.
-- Las policies están en el schema de Drizzle (`src/schema/rls.ts` + cada tabla) y las emitió
-- `drizzle-kit generate`: son la parte de abajo de este archivo, sin editar.
--
-- ── El claim de la vidriera ───────────────────────────────────────────────────────────────
-- `anon` no tiene `tenant_id` en el JWT (no hay usuario). Lo que el server SÍ conoce antes de
-- consultar nada es el **slug**, que sale del host y lo reescribe `proxy.ts`. Ese slug viaja como
-- claim y es lo que acota las filas. Forma exacta, que es la que tiene que usar `storefront-agent`:
--
--     begin;
--       set local role anon;
--       select set_config('request.jwt.claims',
--                         '{"role":"anon","app_metadata":{"storefront_slug":"acme"}}', true);
--       -- la query, con su where tenant_id/slug explícito ADEMÁS de RLS (CLAUDE.md §2)
--     commit;
--
-- Sin claim → `storefront_slug()` devuelve NULL → todas las policies dan falso → cero filas.
-- Falla **cerrado**. Eso además tapa el agujero de PostgREST: la `anon key` de Supabase vive en el
-- browser, pero un JWT firmado por Supabase para `anon` no puede traer
-- `app_metadata.storefront_slug`, así que `GET /rest/v1/listings` con la clave pública sigue
-- devolviendo `[]` — y `GET /rest/v1/tenants` no puede listar la cartera de clientes.
--
-- Aplica con el migrador de Drizzle (`pnpm --filter @istock/db migrate`), que corre cada archivo
-- una sola vez. Todo es idempotente salvo los `CREATE POLICY` del bloque 5, que son el SQL que
-- emitió `drizzle-kit generate` y se dejan textual a propósito: son la fuente de verdad del schema.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

-- ── 1 · Las dos funciones del claim ───────────────────────────────────────────────────────
-- `stable` + **`security invoker`** (el default). No es un detalle de estilo:
-- `security definer` sería un agujero silencioso. Con `FORCE ROW LEVEL SECURITY` el dueño de la
-- tabla TAMPOCO se saltea las policies, y en Supabase el dueño (`postgres`) no es superusuario:
-- la función leería `tenants` sin ninguna policy aplicable y devolvería NULL **en producción**
-- mientras acá, con dueño superusuario, daría verde. Es exactamente el modo de falla que trajo
-- esta migración a la vida; no se repite.
CREATE OR REPLACE FUNCTION public.storefront_slug() RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_catalog
AS $fn$
  -- `auth.jwt()` tiene el mismo cuerpo acá (scripts/pg-local.sh) que en Supabase: lee
  -- current_setting('request.jwt.claims'). Sin claim → NULL, no ''.
  SELECT nullif(auth.jwt() -> 'app_metadata' ->> 'storefront_slug', '')
$fn$;--> statement-breakpoint

-- El tenant ACTIVO dueño de ese slug. Es el `tenant_id` implícito de la vidriera.
-- Lee `tenants` **como `anon`**, o sea que pasa por la policy `tenants_storefront_anon_select`
-- de más abajo: un tenant `suspended`/`cancelled` no resuelve, y su stock deja de ser visible sin
-- tener que tocar una sola fila de `listings`.
CREATE OR REPLACE FUNCTION public.storefront_tenant_id() RETURNS uuid
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_catalog
AS $fn$
  SELECT t.id FROM tenants t
  WHERE t.slug = public.storefront_slug() AND t.status = 'active'
  LIMIT 1
$fn$;--> statement-breakpoint

-- EXECUTE explícito, como todo en este proyecto: una función nace con EXECUTE para PUBLIC y
-- PUBLIC incluye a cualquiera. Sólo `anon` las necesita — las policies de `authenticated` no las
-- llaman.
REVOKE ALL ON FUNCTION public.storefront_slug() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.storefront_tenant_id() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.storefront_slug() TO anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.storefront_tenant_id() TO anon;--> statement-breakpoint

-- ── 2 · `published_at` deja de ser una promesa del panel ──────────────────────────────────
-- La policy de `listings` exige `published_at is not null`. Si eso dependiera de que el panel se
-- acuerde de stampearlo, sería una trampa: el dueño publica, la vidriera queda vacía y nadie
-- entiende por qué. El motor lo garantiza.
CREATE OR REPLACE FUNCTION public.listings_stamp_published_at() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_catalog
AS $fn$
BEGIN
  -- Espejo de PUBLIC_STATUSES (@istock/domain). Nunca lo borra: el histórico de publicación no
  -- se pierde porque una unidad haya vuelto a `unavailable`.
  IF new.status IN ('available', 'reserved', 'sold') AND new.published_at IS NULL THEN
    new.published_at := now();
  END IF;
  RETURN new;
END
$fn$;--> statement-breakpoint

DROP TRIGGER IF EXISTS listings_stamp_published_at ON "listings";--> statement-breakpoint
CREATE TRIGGER listings_stamp_published_at
  BEFORE INSERT OR UPDATE OF status, published_at ON "listings"
  FOR EACH ROW EXECUTE FUNCTION public.listings_stamp_published_at();--> statement-breakpoint

-- Backfill de lo que ya estaba publicado antes del trigger.
UPDATE "listings" SET published_at = coalesce(published_at, updated_at)
  WHERE status IN ('available', 'reserved', 'sold') AND published_at IS NULL;--> statement-breakpoint

-- ── 3 · GRANTs de COLUMNA para `anon` ─────────────────────────────────────────────────────
-- Se revoca primero para que este archivo sea idempotente y para que no sobreviva ningún
-- privilegio de TABLA que alguien haya otorgado a mano. Después se otorga columna por columna.
-- Invariante que verifica `scripts/rls-lint.mjs` (0020) y `src/schema.test.ts`:
-- **`has_table_privilege('anon', <tabla>, 'SELECT')` sigue siendo FALSE en las 19 tablas.**
-- Un GRANT de columna no otorga privilegio de tabla; por eso `select *` revienta.
GRANT USAGE ON SCHEMA public TO anon;--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;--> statement-breakpoint

-- 3.a · tenants — encabezado de la vidriera y datos del `wa.me`.
-- `wa_phone` es público por diseño: **es** el botón. `id` entra porque el filtro de tenant
-- explícito del DAL (`where tenant_id = …`, CLAUDE.md §2) necesita compararlo; que la columna sea
-- legible por SQL no la hace publicable: lo que sale al HTML lo decide `publicListingDTO`, que no
-- tiene campo `tenantId`. Fuera del GRANT: plan, trial_ends_at, is_demo, created_at, updated_at.
GRANT SELECT ("id", "slug", "name", "wa_phone", "payment_methods", "accepts_trade_in", "status")
  ON TABLE "tenants" TO anon;--> statement-breakpoint

-- 3.b · listings — exactamente los campos de `publicListingDTO`, ni uno más.
-- NO aparecen, y no pueden aparecer nunca: imei, imei_check_status, imei_check_status_raw,
-- imei_checked_at, imei_checked_by, imei_check_source, imei_check_note, cost_usd, margin_usd,
-- supplier, internal_notes, created_by, sold_at, qty, kind.
-- (`qty` y `kind` quedan afuera a propósito: el DTO público no los tiene. El día que la grilla
--  necesite mostrar "quedan 3", eso es una migración y una decisión, no un `select` más ancho.)
GRANT SELECT (
  "id", "tenant_id", "catalog_model_id", "slug", "title", "storage_gb", "color", "condition",
  "battery_pct", "screen_original", "icloud_status_text", "warranty_text", "provenance_text",
  "description", "price_usd", "status", "published_at"
) ON TABLE "listings" TO anon;--> statement-breakpoint

-- 3.c · listing_photos — las tres variantes públicas. `master_key` NO: es la key del bucket
-- privado `istock-originals` y desde ella se deriva el original de 2MB (ADR-006, CLAUDE.md §2).
-- `card_bytes` tampoco: es telemetría de costo, no dato de ficha.
GRANT SELECT (
  "id", "tenant_id", "listing_id", "sort_order", "alt",
  "thumb_key", "card_key", "detail_key", "width", "height"
) ON TABLE "listing_photos" TO anon;--> statement-breakpoint

-- 3.d · locations — punto de retiro + horario, que es uno de los 15 campos obligatorios.
GRANT SELECT ("id", "tenant_id", "name", "address", "hours", "city", "is_active", "sort_order")
  ON TABLE "locations" TO anon;--> statement-breakpoint

-- 3.e · fx_settings — el TC que puso el dueño, para el ARS informativo de la ficha.
-- `updated_by` (uuid de un usuario real) queda afuera.
GRANT SELECT ("tenant_id", "ars_per_usd", "rounding") ON TABLE "fx_settings" TO anon;--> statement-breakpoint

-- 3.f · catalog_models — GLOBAL, sin RLS y sin nada de nadie adentro: un iPhone 14 Pro es el mismo
-- hecho del mundo para los 100 tenants. Se otorga igual por columna, para que el `select *` de la
-- vidriera falle acá también y para no arrastrar `embedding` (pgvector) a una query pública.
GRANT SELECT ("id", "slug", "brand", "family", "display_name", "release_year")
  ON TABLE "catalog_models" TO anon;--> statement-breakpoint

-- `catalog_faqs` NO se otorga: alimenta el contexto del chatbot (packages/ai), que corre en el
-- server con su propio rol. La vidriera estática no lo lee.

-- ── 4 · Documentación consultable desde la propia base ────────────────────────────────────
COMMENT ON FUNCTION public.storefront_slug() IS 'Vidriera anonima: slug del claim app_metadata.storefront_slug. NULL si no hay claim -> las policies TO anon dan cero filas (falla cerrado).';--> statement-breakpoint
COMMENT ON FUNCTION public.storefront_tenant_id() IS 'Vidriera anonima: tenant ACTIVO dueno del slug del claim. security invoker: lee tenants pasando por la policy de anon.';--> statement-breakpoint
COMMENT ON FUNCTION public.listings_stamp_published_at() IS 'Garantiza published_at cuando el estado pasa a publico (available/reserved/sold). La policy de anon exige published_at not null y no puede depender de que el panel se acuerde.';--> statement-breakpoint

-- ── 5 · Policies emitidas por `drizzle-kit generate` (fuente de verdad: src/schema/**) ─────
CREATE POLICY "tenants_storefront_anon_select" ON "tenants" AS PERMISSIVE FOR SELECT TO "anon" USING (status = 'active' and slug = (select public.storefront_slug()));--> statement-breakpoint
CREATE POLICY "locations_storefront_anon_select" ON "locations" AS PERMISSIVE FOR SELECT TO "anon" USING (tenant_id = (select public.storefront_tenant_id()) and is_active);--> statement-breakpoint
CREATE POLICY "fx_settings_storefront_anon_select" ON "fx_settings" AS PERMISSIVE FOR SELECT TO "anon" USING (tenant_id = (select public.storefront_tenant_id()));--> statement-breakpoint
CREATE POLICY "listings_storefront_anon_select" ON "listings" AS PERMISSIVE FOR SELECT TO "anon" USING (tenant_id = (select public.storefront_tenant_id()) and status in ('available', 'reserved', 'sold') and published_at is not null);--> statement-breakpoint
CREATE POLICY "listing_photos_storefront_anon_select" ON "listing_photos" AS PERMISSIVE FOR SELECT TO "anon" USING (tenant_id = (select public.storefront_tenant_id()) and exists (select 1 from listings l where l.id = listing_photos.listing_id));
