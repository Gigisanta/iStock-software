CREATE TABLE "billing_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text DEFAULT 'mercadopago' NOT NULL,
	"provider_event_id" text NOT NULL,
	"topic" text NOT NULL,
	"action" text,
	"resource_id" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_webhook_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "billing_webhook_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Authorization owner/seller basada en la membresía vigente, no en un claim de rol forjable.
CREATE OR REPLACE FUNCTION public.is_current_user_tenant_member(p_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_catalog
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships AS m
    WHERE m.tenant_id = p_tenant_id AND m.user_id = (select auth.uid())
  );
$fn$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.is_current_user_tenant_owner(p_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_catalog
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships AS m
    WHERE m.tenant_id = p_tenant_id
      AND m.user_id = (select auth.uid())
      AND m.role = 'owner'::public.membership_role
  );
$fn$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.is_current_user_tenant_member(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.is_current_user_tenant_owner(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.is_current_user_tenant_member(uuid) TO authenticated, service_role;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.is_current_user_tenant_owner(uuid) TO authenticated, service_role;--> statement-breakpoint

-- Preflight: cualquier hijo con un UUID válido pero otro tenant aborta la migración completa.
DO $check$
DECLARE mismatch_count bigint;
BEGIN
  SELECT count(*) INTO mismatch_count FROM (
    SELECT 1 FROM public.listing_photos AS c JOIN public.listings AS p ON p.id = c.listing_id WHERE c.tenant_id <> p.tenant_id
    UNION ALL SELECT 1 FROM public.listing_events AS c JOIN public.listings AS p ON p.id = c.listing_id WHERE c.tenant_id <> p.tenant_id
    UNION ALL SELECT 1 FROM public.wa_click_events AS c JOIN public.listings AS p ON p.id = c.listing_id WHERE c.listing_id IS NOT NULL AND c.tenant_id <> p.tenant_id
    UNION ALL SELECT 1 FROM public.reservations AS c JOIN public.listings AS p ON p.id = c.listing_id WHERE c.tenant_id <> p.tenant_id
    UNION ALL SELECT 1 FROM public.sales AS c JOIN public.listings AS p ON p.id = c.listing_id WHERE c.tenant_id <> p.tenant_id
    UNION ALL SELECT 1 FROM public.sales AS c JOIN public.reservations AS p ON p.id = c.reservation_id WHERE c.reservation_id IS NOT NULL AND c.tenant_id <> p.tenant_id
    UNION ALL SELECT 1 FROM public.tradein_leads AS c JOIN public.listings AS p ON p.id = c.created_listing_id WHERE c.created_listing_id IS NOT NULL AND c.tenant_id <> p.tenant_id
    UNION ALL SELECT 1 FROM public.tradein_checklists AS c JOIN public.tradein_leads AS p ON p.id = c.tradein_lead_id WHERE c.tenant_id <> p.tenant_id
    UNION ALL SELECT 1 FROM public.chatbot_threads AS c JOIN public.listings AS p ON p.id = c.listing_id WHERE c.listing_id IS NOT NULL AND c.tenant_id <> p.tenant_id
    UNION ALL SELECT 1 FROM public.chatbot_messages AS c JOIN public.chatbot_threads AS p ON p.id = c.thread_id WHERE c.tenant_id <> p.tenant_id
  ) AS mismatches;
  IF mismatch_count > 0 THEN
    RAISE EXCEPTION '0010 aborted: % cross-tenant child references need explicit repair before composite FKs', mismatch_count USING ERRCODE = '23514';
  END IF;
END
$check$;--> statement-breakpoint

-- Targets únicos requeridos por las FKs compuestas, creados antes de ADD CONSTRAINT.
CREATE UNIQUE INDEX "listings_tenant_id_key" ON "listings" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_tenant_id_key" ON "reservations" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "tradein_leads_tenant_id_key" ON "tradein_leads" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "chatbot_threads_tenant_id_key" ON "chatbot_threads" USING btree ("tenant_id","id");--> statement-breakpoint

-- `authenticated` es un rol compartido: el trigger separa escritura sensible de seller sin
-- quitarle al owner el acceso que el panel necesita.
CREATE OR REPLACE FUNCTION public.reject_seller_sensitive_listing_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
BEGIN
  IF (select auth.uid()) IS NULL OR EXISTS (
    SELECT 1 FROM public.memberships AS m
    WHERE m.tenant_id = NEW.tenant_id AND m.user_id = (select auth.uid()) AND m.role = 'owner'::public.membership_role
  ) THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.cost_usd IS NOT NULL OR NEW.margin_usd IS NOT NULL OR NEW.supplier IS NOT NULL OR NEW.internal_notes IS NOT NULL THEN
      RAISE EXCEPTION 'seller cannot set sensitive listing fields' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.cost_usd IS DISTINCT FROM OLD.cost_usd OR NEW.margin_usd IS DISTINCT FROM OLD.margin_usd
     OR NEW.supplier IS DISTINCT FROM OLD.supplier OR NEW.internal_notes IS DISTINCT FROM OLD.internal_notes THEN
    RAISE EXCEPTION 'seller cannot modify sensitive listing fields' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$fn$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.reject_seller_sensitive_tradein_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
BEGIN
  IF (select auth.uid()) IS NULL OR EXISTS (
    SELECT 1 FROM public.memberships AS m
    WHERE m.tenant_id = NEW.tenant_id AND m.user_id = (select auth.uid()) AND m.role = 'owner'::public.membership_role
  ) THEN RETURN NEW; END IF;
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
REVOKE ALL ON FUNCTION public.reject_seller_sensitive_listing_changes() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.reject_seller_sensitive_tradein_changes() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER listings_reject_seller_sensitive_changes BEFORE INSERT OR UPDATE ON public.listings
FOR EACH ROW EXECUTE FUNCTION public.reject_seller_sensitive_listing_changes();--> statement-breakpoint
CREATE TRIGGER tradein_leads_reject_seller_sensitive_changes BEFORE INSERT OR UPDATE ON public.tradein_leads
FOR EACH ROW EXECUTE FUNCTION public.reject_seller_sensitive_tradein_changes();--> statement-breakpoint
REVOKE ALL ON TABLE "billing_webhook_events" FROM anon, authenticated;--> statement-breakpoint
GRANT SELECT ON TABLE "billing_webhook_events" TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "billing_webhook_events" TO service_role;--> statement-breakpoint
ALTER TABLE "listing_photos" DROP CONSTRAINT "listing_photos_listing_id_listings_id_fk";
--> statement-breakpoint
ALTER TABLE "listing_events" DROP CONSTRAINT "listing_events_listing_id_listings_id_fk";
--> statement-breakpoint
ALTER TABLE "wa_click_events" DROP CONSTRAINT "wa_click_events_listing_id_listings_id_fk";
--> statement-breakpoint
ALTER TABLE "reservations" DROP CONSTRAINT "reservations_listing_id_listings_id_fk";
--> statement-breakpoint
ALTER TABLE "sales" DROP CONSTRAINT "sales_listing_id_listings_id_fk";
--> statement-breakpoint
ALTER TABLE "sales" DROP CONSTRAINT "sales_reservation_id_reservations_id_fk";
--> statement-breakpoint
ALTER TABLE "tradein_checklists" DROP CONSTRAINT "tradein_checklists_tradein_lead_id_tradein_leads_id_fk";
--> statement-breakpoint
ALTER TABLE "tradein_leads" DROP CONSTRAINT "tradein_leads_created_listing_id_listings_id_fk";
--> statement-breakpoint
ALTER TABLE "chatbot_messages" DROP CONSTRAINT "chatbot_messages_thread_id_chatbot_threads_id_fk";
--> statement-breakpoint
ALTER TABLE "chatbot_threads" DROP CONSTRAINT "chatbot_threads_listing_id_listings_id_fk";
--> statement-breakpoint
DROP INDEX "listing_photos_listing_sort_key";--> statement-breakpoint
DROP INDEX "reservations_one_active_per_listing";--> statement-breakpoint
DROP INDEX "tradein_checklists_lead_item_key";--> statement-breakpoint
ALTER TABLE "billing_webhook_events" ADD CONSTRAINT "billing_webhook_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_webhook_events_tenant_idx" ON "billing_webhook_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_webhook_events_provider_event_key" ON "billing_webhook_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
ALTER TABLE "listing_photos" ADD CONSTRAINT "listing_photos_tenant_listing_fk" FOREIGN KEY ("tenant_id","listing_id") REFERENCES "public"."listings"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_events" ADD CONSTRAINT "listing_events_tenant_listing_fk" FOREIGN KEY ("tenant_id","listing_id") REFERENCES "public"."listings"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_click_events" ADD CONSTRAINT "wa_click_events_tenant_listing_fk" FOREIGN KEY ("tenant_id","listing_id") REFERENCES "public"."listings"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_tenant_listing_fk" FOREIGN KEY ("tenant_id","listing_id") REFERENCES "public"."listings"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_tenant_listing_fk" FOREIGN KEY ("tenant_id","listing_id") REFERENCES "public"."listings"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_tenant_reservation_fk" FOREIGN KEY ("tenant_id","reservation_id") REFERENCES "public"."reservations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradein_checklists" ADD CONSTRAINT "tradein_checklists_tenant_lead_fk" FOREIGN KEY ("tenant_id","tradein_lead_id") REFERENCES "public"."tradein_leads"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradein_leads" ADD CONSTRAINT "tradein_leads_tenant_created_listing_fk" FOREIGN KEY ("tenant_id","created_listing_id") REFERENCES "public"."listings"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatbot_messages" ADD CONSTRAINT "chatbot_messages_tenant_thread_fk" FOREIGN KEY ("tenant_id","thread_id") REFERENCES "public"."chatbot_threads"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatbot_threads" ADD CONSTRAINT "chatbot_threads_tenant_listing_fk" FOREIGN KEY ("tenant_id","listing_id") REFERENCES "public"."listings"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "listing_photos_listing_sort_key" ON "listing_photos" USING btree ("tenant_id","listing_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_one_active_per_listing" ON "reservations" USING btree ("tenant_id","listing_id") WHERE status = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "tradein_checklists_lead_item_key" ON "tradein_checklists" USING btree ("tenant_id","tradein_lead_id","item_key");--> statement-breakpoint
CREATE POLICY "billing_webhook_events_tenant_select" ON "billing_webhook_events" AS PERMISSIVE FOR SELECT TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
CREATE POLICY "billing_webhook_events_tenant_insert" ON "billing_webhook_events" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
CREATE POLICY "billing_webhook_events_tenant_update" ON "billing_webhook_events" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_owner(tenant_id)) WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
CREATE POLICY "billing_webhook_events_tenant_delete" ON "billing_webhook_events" AS PERMISSIVE FOR DELETE TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
ALTER POLICY "tenants_tenant_insert" ON "tenants" TO authenticated WITH CHECK (id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and false);--> statement-breakpoint
ALTER POLICY "tenants_tenant_update" ON "tenants" TO authenticated USING (id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_owner(id)) WITH CHECK (id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_owner(id));--> statement-breakpoint
ALTER POLICY "tenants_tenant_delete" ON "tenants" TO authenticated USING (id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_owner(id));--> statement-breakpoint
ALTER POLICY "memberships_tenant_insert" ON "memberships" TO authenticated WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
ALTER POLICY "memberships_tenant_update" ON "memberships" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_owner(tenant_id)) WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
ALTER POLICY "memberships_tenant_delete" ON "memberships" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
ALTER POLICY "fx_settings_tenant_select" ON "fx_settings" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
ALTER POLICY "fx_settings_tenant_insert" ON "fx_settings" TO authenticated WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
ALTER POLICY "fx_settings_tenant_update" ON "fx_settings" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_owner(tenant_id)) WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
ALTER POLICY "fx_settings_tenant_delete" ON "fx_settings" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
ALTER POLICY "sales_tenant_select" ON "sales" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
ALTER POLICY "sales_tenant_insert" ON "sales" TO authenticated WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_owner(tenant_id) or tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id) and not public.is_current_user_tenant_owner(tenant_id) and cost_usd is not distinct from (select l.cost_usd from public.listings l where l.id = sales.listing_id and l.tenant_id = sales.tenant_id) and internal_notes is null and sold_by = (select auth.uid()));--> statement-breakpoint
ALTER POLICY "sales_tenant_update" ON "sales" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_owner(tenant_id)) WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
ALTER POLICY "sales_tenant_delete" ON "sales" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
ALTER POLICY "entitlements_tenant_select" ON "entitlements" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
ALTER POLICY "entitlements_tenant_insert" ON "entitlements" TO authenticated WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
ALTER POLICY "entitlements_tenant_update" ON "entitlements" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_owner(tenant_id)) WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
ALTER POLICY "entitlements_tenant_delete" ON "entitlements" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
ALTER POLICY "subscriptions_tenant_select" ON "subscriptions" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
ALTER POLICY "subscriptions_tenant_insert" ON "subscriptions" TO authenticated WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
ALTER POLICY "subscriptions_tenant_update" ON "subscriptions" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_owner(tenant_id)) WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
ALTER POLICY "subscriptions_tenant_delete" ON "subscriptions" TO authenticated USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_owner(tenant_id));
