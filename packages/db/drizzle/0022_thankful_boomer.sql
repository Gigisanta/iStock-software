CREATE TYPE "public"."billing_checkout_intent_status" AS ENUM('creating', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "billing_checkout_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text DEFAULT 'mercadopago' NOT NULL,
	"plan" "plan_tier" NOT NULL,
	"amount_ars" numeric(12, 2) NOT NULL,
	"status" "billing_checkout_intent_status" DEFAULT 'creating' NOT NULL,
	"provider_preapproval_id" text,
	"init_point" text,
	"lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_checkout_intents_paid_plan_check" CHECK ("billing_checkout_intents"."plan" <> 'trial'),
	CONSTRAINT "billing_checkout_intents_state_check" CHECK ((
        ("billing_checkout_intents"."status" = 'ready' and "billing_checkout_intents"."provider_preapproval_id" is not null and "billing_checkout_intents"."init_point" is not null and "billing_checkout_intents"."lease_expires_at" is null)
        or ("billing_checkout_intents"."status" in ('creating', 'failed') and "billing_checkout_intents"."provider_preapproval_id" is null and "billing_checkout_intents"."init_point" is null and ("billing_checkout_intents"."status" = 'creating') = ("billing_checkout_intents"."lease_expires_at" is not null))
      ))
);
--> statement-breakpoint
ALTER TABLE "billing_checkout_intents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "billing_checkout_intents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "billing_checkout_intents" FROM anon, authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "billing_checkout_intents" TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "billing_checkout_intents" TO service_role;--> statement-breakpoint
ALTER TABLE "billing_checkout_intents" ADD CONSTRAINT "billing_checkout_intents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_checkout_intents_tenant_idx" ON "billing_checkout_intents" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_checkout_intents_tenant_key" ON "billing_checkout_intents" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_checkout_intents_preapproval_key" ON "billing_checkout_intents" USING btree ("provider_preapproval_id");--> statement-breakpoint
CREATE POLICY "billing_checkout_intents_tenant_select" ON "billing_checkout_intents" AS PERMISSIVE FOR SELECT TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id) and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
CREATE POLICY "billing_checkout_intents_tenant_insert" ON "billing_checkout_intents" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id) and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
CREATE POLICY "billing_checkout_intents_tenant_update" ON "billing_checkout_intents" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id) and public.is_current_user_tenant_owner(tenant_id)) WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id) and public.is_current_user_tenant_owner(tenant_id));--> statement-breakpoint
CREATE POLICY "billing_checkout_intents_tenant_delete" ON "billing_checkout_intents" AS PERMISSIVE FOR DELETE TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid and public.is_current_user_tenant_member(tenant_id) and public.is_current_user_tenant_owner(tenant_id));
