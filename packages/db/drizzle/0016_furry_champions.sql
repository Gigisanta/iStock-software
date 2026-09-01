-- 0016 · membresía vigente + grants fail-closed para el rol compartido.
--
-- El claim sigue siendo el selector de tenant que emitió el hook, pero no es una autorización:
-- puede quedar stale hasta una hora. Los helpers son SECURITY DEFINER, propiedad de service_role,
-- y leen memberships directamente para que FORCE RLS no convierta la comprobación en recursión.
-- Devuelven sólo booleanos; no exponen membresías ni saltan los checks de tenant de las policies.
CREATE OR REPLACE FUNCTION public.is_current_user_tenant_member(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.memberships AS m
    WHERE m.tenant_id = p_tenant_id
      AND m.user_id = (select auth.uid())
  )
$fn$;--> statement-breakpoint
ALTER FUNCTION public.is_current_user_tenant_member(uuid) OWNER TO service_role;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.is_current_user_tenant_owner(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.memberships AS m
    WHERE m.tenant_id = p_tenant_id
      AND m.user_id = (select auth.uid())
      AND m.role = 'owner'::public.membership_role
  )
$fn$;--> statement-breakpoint
ALTER FUNCTION public.is_current_user_tenant_owner(uuid) OWNER TO service_role;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.is_current_user_tenant_member(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.is_current_user_tenant_owner(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.is_current_user_tenant_member(uuid) TO authenticated, service_role;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.is_current_user_tenant_owner(uuid) TO authenticated, service_role;--> statement-breakpoint

-- authenticated comparte el mismo rol entre owner y seller. INSERT queda a nivel de tabla porque
-- Drizzle nombra todas las columnas, incluso las que valen DEFAULT; las policies y los triggers
-- siguen decidiendo qué filas y qué valores son válidos. UPDATE sí queda por columna.
--
-- status queda fuera de UPDATE para authenticated, igual que el resto de los campos protegidos.
-- La app hoy lo actualiza desde acciones con rol authenticated; app-agent debe mover esas
-- transiciones a un RPC SECURITY DEFINER con autorización de membresía/estado. Esta migración no
-- toca apps fuera de packages/db.
REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE public.listings FROM authenticated;--> statement-breakpoint
GRANT SELECT (
  id, tenant_id, slug, kind, catalog_model_id, title, storage_gb, color, condition, battery_pct,
  screen_original, icloud_status_text, warranty_text, provenance_text, description, price_usd,
  imei_check_status, imei_check_status_raw, imei_checked_at, imei_checked_by, imei_check_source,
  imei_check_note, qty, status, published_at, sold_at, created_by, created_at, updated_at,
  acquisition_channel
) ON TABLE public.listings TO authenticated;--> statement-breakpoint
GRANT INSERT ON TABLE public.listings TO authenticated;--> statement-breakpoint
GRANT UPDATE (
  slug, kind, catalog_model_id, title, storage_gb, color, condition, battery_pct, screen_original,
  icloud_status_text, warranty_text, provenance_text, description, price_usd,
  imei_check_status, imei_check_status_raw, imei_checked_at, imei_checked_by, imei_check_source,
  imei_check_note, qty, created_by, updated_at
) ON TABLE public.listings TO authenticated;--> statement-breakpoint
REVOKE DELETE ON TABLE public.listings FROM authenticated;--> statement-breakpoint

REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE public.tradein_leads FROM authenticated;--> statement-breakpoint
GRANT SELECT (
  id, tenant_id, status, customer_name, customer_wa_phone, model_text, storage_gb, color,
  declared_condition, battery_pct, notes, created_listing_id, handled_by, created_at, updated_at
) ON TABLE public.tradein_leads TO authenticated;--> statement-breakpoint
GRANT INSERT ON TABLE public.tradein_leads TO authenticated;--> statement-breakpoint
GRANT UPDATE (
  status, customer_name, customer_wa_phone, model_text, storage_gb, color, declared_condition,
  battery_pct, notes, offer_usd, created_listing_id, handled_by, updated_at
) ON TABLE public.tradein_leads TO authenticated;--> statement-breakpoint
REVOKE DELETE ON TABLE public.tradein_leads FROM authenticated;--> statement-breakpoint

-- Owner checks are membership checks against the current transaction, not JWT role claims.
CREATE OR REPLACE FUNCTION public.reject_seller_sensitive_listing_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF (select auth.uid()) IS NULL OR public.is_current_user_tenant_owner(NEW.tenant_id) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.cost_usd IS NOT NULL OR NEW.margin_usd IS NOT NULL OR NEW.supplier IS NOT NULL OR NEW.internal_notes IS NOT NULL THEN
      RAISE EXCEPTION 'seller cannot set sensitive listing fields' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.imei IS DISTINCT FROM OLD.imei
     OR NEW.cost_usd IS DISTINCT FROM OLD.cost_usd
     OR NEW.supplier IS DISTINCT FROM OLD.supplier
     OR NEW.internal_notes IS DISTINCT FROM OLD.internal_notes
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.published_at IS DISTINCT FROM OLD.published_at
     OR NEW.sold_at IS DISTINCT FROM OLD.sold_at THEN
    RAISE EXCEPTION 'seller cannot modify protected listing fields' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$fn$;--> statement-breakpoint
ALTER FUNCTION public.reject_seller_sensitive_listing_changes() OWNER TO service_role;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.reject_seller_sensitive_listing_changes() FROM PUBLIC;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.reject_seller_sensitive_tradein_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF (select auth.uid()) IS NULL OR public.is_current_user_tenant_owner(NEW.tenant_id) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.offer_usd IS NOT NULL OR NEW.internal_notes IS NOT NULL THEN
      RAISE EXCEPTION 'seller cannot set sensitive trade-in fields' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.offer_usd IS DISTINCT FROM OLD.offer_usd OR NEW.internal_notes IS DISTINCT FROM OLD.internal_notes THEN
    RAISE EXCEPTION 'seller cannot modify sensitive trade-in fields' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$fn$;--> statement-breakpoint
ALTER FUNCTION public.reject_seller_sensitive_tradein_changes() OWNER TO service_role;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.reject_seller_sensitive_tradein_changes() FROM PUBLIC;--> statement-breakpoint

-- Las policies quedan fail-closed incluso si el rol tiene un token emitido antes de la revocación.
-- service_role/bootstrap conserva BYPASSRLS y sus grants DML existentes.
ALTER POLICY "tenants_tenant_select" ON "tenants" TO authenticated USING (id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(id));--> statement-breakpoint
ALTER POLICY "users_self_or_teammate_select" ON "users" TO authenticated USING (id = (select auth.uid()) or exists (
    select 1 from public.memberships m
    where m.user_id = users.id
      and public.is_current_user_tenant_member(m.tenant_id)
  ));--> statement-breakpoint
ALTER POLICY "memberships_tenant_select" ON "memberships" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id));--> statement-breakpoint
ALTER POLICY "memberships_tenant_insert" ON "memberships" TO authenticated WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id) and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
ALTER POLICY "memberships_tenant_update" ON "memberships" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id) and public.is_current_user_tenant_owner(tenant_id)) WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id) and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
ALTER POLICY "memberships_tenant_delete" ON "memberships" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id) and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
ALTER POLICY "locations_tenant_select" ON "locations" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id));--> statement-breakpoint
ALTER POLICY "locations_tenant_insert" ON "locations" TO authenticated WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id));--> statement-breakpoint
ALTER POLICY "locations_tenant_update" ON "locations" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id)) WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id));--> statement-breakpoint
ALTER POLICY "locations_tenant_delete" ON "locations" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id));--> statement-breakpoint
ALTER POLICY "fx_settings_tenant_select" ON "fx_settings" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id) and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
ALTER POLICY "fx_settings_tenant_insert" ON "fx_settings" TO authenticated WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id) and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
ALTER POLICY "fx_settings_tenant_update" ON "fx_settings" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id) and public.is_current_user_tenant_owner(tenant_id)) WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id) and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
ALTER POLICY "fx_settings_tenant_delete" ON "fx_settings" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id) and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
ALTER POLICY "listings_tenant_select" ON "listings" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id));--> statement-breakpoint
ALTER POLICY "listings_tenant_insert" ON "listings" TO authenticated WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id));--> statement-breakpoint
ALTER POLICY "listings_tenant_update" ON "listings" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id)) WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id));--> statement-breakpoint
ALTER POLICY "listings_tenant_delete" ON "listings" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id));--> statement-breakpoint
ALTER POLICY "listing_photos_tenant_select" ON "listing_photos" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id));--> statement-breakpoint
ALTER POLICY "listing_photos_tenant_insert" ON "listing_photos" TO authenticated WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id));--> statement-breakpoint
ALTER POLICY "listing_photos_tenant_update" ON "listing_photos" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id)) WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id));--> statement-breakpoint
ALTER POLICY "listing_photos_tenant_delete" ON "listing_photos" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id));--> statement-breakpoint
ALTER POLICY "listing_events_tenant_select" ON "listing_events" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id));--> statement-breakpoint
ALTER POLICY "listing_events_tenant_insert" ON "listing_events" TO authenticated WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id));--> statement-breakpoint
ALTER POLICY "listing_events_tenant_update" ON "listing_events" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id)) WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id));--> statement-breakpoint
ALTER POLICY "listing_events_tenant_delete" ON "listing_events" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id));--> statement-breakpoint
ALTER POLICY "wa_click_events_tenant_select" ON "wa_click_events" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id));--> statement-breakpoint
ALTER POLICY "wa_click_events_tenant_insert" ON "wa_click_events" TO authenticated WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id));--> statement-breakpoint
ALTER POLICY "wa_click_events_tenant_update" ON "wa_click_events" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id)) WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id));--> statement-breakpoint
ALTER POLICY "wa_click_events_tenant_delete" ON "wa_click_events" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id));--> statement-breakpoint
ALTER POLICY "reservations_tenant_select" ON "reservations" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id));--> statement-breakpoint
ALTER POLICY "reservations_tenant_insert" ON "reservations" TO authenticated WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id) and sweep_attempts = 0);--> statement-breakpoint
ALTER POLICY "reservations_tenant_update" ON "reservations" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id)) WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id));--> statement-breakpoint
ALTER POLICY "reservations_tenant_delete" ON "reservations" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id));--> statement-breakpoint
ALTER POLICY "sales_tenant_select" ON "sales" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id) and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
ALTER POLICY "sales_tenant_insert" ON "sales" TO authenticated WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id) and public.is_current_user_tenant_owner(tenant_id) or tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id) and public.is_current_user_tenant_member(tenant_id) and not public.is_current_user_tenant_owner(tenant_id) and cost_usd is not distinct from (select l.cost_usd from public.listings l where l.id = sales.listing_id and l.tenant_id = sales.tenant_id) and internal_notes is null and sold_by = (select auth.uid()));--> statement-breakpoint
ALTER POLICY "sales_tenant_update" ON "sales" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id) and public.is_current_user_tenant_owner(tenant_id)) WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id) and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
ALTER POLICY "sales_tenant_delete" ON "sales" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id) and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
ALTER POLICY "tradein_checklists_tenant_select" ON "tradein_checklists" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id));--> statement-breakpoint
ALTER POLICY "tradein_checklists_tenant_insert" ON "tradein_checklists" TO authenticated WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id));--> statement-breakpoint
ALTER POLICY "tradein_checklists_tenant_update" ON "tradein_checklists" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id)) WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id));--> statement-breakpoint
ALTER POLICY "tradein_checklists_tenant_delete" ON "tradein_checklists" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id));--> statement-breakpoint
ALTER POLICY "tradein_leads_tenant_select" ON "tradein_leads" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id));--> statement-breakpoint
ALTER POLICY "tradein_leads_tenant_insert" ON "tradein_leads" TO authenticated WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id));--> statement-breakpoint
ALTER POLICY "tradein_leads_tenant_update" ON "tradein_leads" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id)) WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id));--> statement-breakpoint
ALTER POLICY "tradein_leads_tenant_delete" ON "tradein_leads" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id));--> statement-breakpoint
ALTER POLICY "chatbot_messages_tenant_select" ON "chatbot_messages" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id));--> statement-breakpoint
ALTER POLICY "chatbot_messages_tenant_insert" ON "chatbot_messages" TO authenticated WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id));--> statement-breakpoint
ALTER POLICY "chatbot_messages_tenant_update" ON "chatbot_messages" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id)) WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id));--> statement-breakpoint
ALTER POLICY "chatbot_messages_tenant_delete" ON "chatbot_messages" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id));--> statement-breakpoint
ALTER POLICY "chatbot_threads_tenant_select" ON "chatbot_threads" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id));--> statement-breakpoint
ALTER POLICY "chatbot_threads_tenant_insert" ON "chatbot_threads" TO authenticated WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id));--> statement-breakpoint
ALTER POLICY "chatbot_threads_tenant_update" ON "chatbot_threads" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id)) WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id));--> statement-breakpoint
ALTER POLICY "chatbot_threads_tenant_delete" ON "chatbot_threads" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id));--> statement-breakpoint
ALTER POLICY "billing_webhook_events_tenant_select" ON "billing_webhook_events" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id) and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
ALTER POLICY "billing_webhook_events_tenant_insert" ON "billing_webhook_events" TO authenticated WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id) and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
ALTER POLICY "billing_webhook_events_tenant_update" ON "billing_webhook_events" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id) and public.is_current_user_tenant_owner(tenant_id)) WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id) and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
ALTER POLICY "billing_webhook_events_tenant_delete" ON "billing_webhook_events" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id) and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
ALTER POLICY "entitlements_tenant_select" ON "entitlements" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id) and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
ALTER POLICY "entitlements_tenant_insert" ON "entitlements" TO authenticated WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id) and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
ALTER POLICY "entitlements_tenant_update" ON "entitlements" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id) and public.is_current_user_tenant_owner(tenant_id)) WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id) and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
ALTER POLICY "entitlements_tenant_delete" ON "entitlements" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id) and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
ALTER POLICY "subscriptions_tenant_select" ON "subscriptions" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id) and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
ALTER POLICY "subscriptions_tenant_insert" ON "subscriptions" TO authenticated WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id) and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
ALTER POLICY "subscriptions_tenant_update" ON "subscriptions" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id) and public.is_current_user_tenant_owner(tenant_id)) WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id) and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
ALTER POLICY "subscriptions_tenant_delete" ON "subscriptions" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id) and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint

-- Verificación de la capa GRANT. Estas aserciones no confían en la policy: miden el ACL efectivo
-- del rol compartido después de los REVOKE/GRANT. Si una base heredó un ACL amplio, migrate falla.
DO $check$
DECLARE
  problem text;
BEGIN
  IF has_table_privilege('authenticated', 'public.listings', 'UPDATE') THEN
    problem := 'authenticated conserva UPDATE de tabla en listings';
  ELSIF has_table_privilege('authenticated', 'public.listings', 'DELETE') THEN
    problem := 'authenticated conserva DELETE de tabla en listings';
  ELSIF has_table_privilege('authenticated', 'public.tradein_leads', 'DELETE') THEN
    problem := 'authenticated conserva DELETE de tabla en tradein_leads';
  ELSIF has_column_privilege('authenticated', 'public.listings', 'imei', 'UPDATE') THEN
    problem := 'authenticated puede UPDATE listings.imei';
  ELSIF has_column_privilege('authenticated', 'public.listings', 'cost_usd', 'UPDATE') THEN
    problem := 'authenticated puede UPDATE listings.cost_usd';
  ELSIF has_column_privilege('authenticated', 'public.listings', 'margin_usd', 'UPDATE') THEN
    problem := 'authenticated puede UPDATE listings.margin_usd';
  ELSIF has_column_privilege('authenticated', 'public.listings', 'supplier', 'UPDATE') THEN
    problem := 'authenticated puede UPDATE listings.supplier';
  ELSIF has_column_privilege('authenticated', 'public.listings', 'internal_notes', 'UPDATE') THEN
    problem := 'authenticated puede UPDATE listings.internal_notes';
  ELSIF has_column_privilege('authenticated', 'public.listings', 'status', 'UPDATE') THEN
    problem := 'authenticated puede UPDATE listings.status';
  ELSIF has_column_privilege('authenticated', 'public.listings', 'published_at', 'UPDATE') THEN
    problem := 'authenticated puede UPDATE listings.published_at';
  ELSIF has_column_privilege('authenticated', 'public.listings', 'sold_at', 'UPDATE') THEN
    problem := 'authenticated puede UPDATE listings.sold_at';
  ELSIF has_column_privilege('authenticated', 'public.tradein_leads', 'internal_notes', 'UPDATE') THEN
    problem := 'authenticated puede UPDATE tradein_leads.internal_notes';
  ELSIF NOT has_table_privilege('authenticated', 'public.listings', 'INSERT') THEN
    problem := 'authenticated perdió INSERT de tabla en listings: se rompe alta/import';
  ELSIF NOT has_table_privilege('authenticated', 'public.tradein_leads', 'INSERT') THEN
    problem := 'authenticated perdió INSERT de tabla en tradein_leads: se rompe el flujo';
  ELSIF NOT has_table_privilege('service_role', 'public.listings', 'UPDATE') THEN
    problem := 'service_role perdió UPDATE de tabla en listings';
  ELSIF NOT has_table_privilege('service_role', 'public.tradein_leads', 'UPDATE') THEN
    problem := 'service_role perdió UPDATE de tabla en tradein_leads';
  END IF;

  IF problem IS NOT NULL THEN
    RAISE EXCEPTION '0016 grants fail-closed: %', problem USING ERRCODE = '42501';
  END IF;

  RAISE NOTICE
    '0016 effective privileges: listings table UPDATE=%, listings.imei UPDATE=%, listings.status UPDATE=%, tradein_leads table DELETE=%',
    has_table_privilege('authenticated', 'public.listings', 'UPDATE'),
    has_column_privilege('authenticated', 'public.listings', 'imei', 'UPDATE'),
    has_column_privilege('authenticated', 'public.listings', 'status', 'UPDATE'),
    has_table_privilege('authenticated', 'public.tradein_leads', 'DELETE');
END
$check$;
