CREATE TYPE "public"."chat_role" AS ENUM('user', 'assistant', 'system');--> statement-breakpoint
CREATE TYPE "public"."fx_rounding_mode" AS ENUM('exact', 'ceil_100', 'nearest_1000', 'ceil_1000');--> statement-breakpoint
CREATE TYPE "public"."imei_check_status" AS ENUM('not_checked', 'valid', 'blocked', 'invalid', 'inconclusive');--> statement-breakpoint
CREATE TYPE "public"."listing_condition" AS ENUM('sealed', 'open_box', 'tester_a_plus', 'used_excellent', 'used_with_detail');--> statement-breakpoint
CREATE TYPE "public"."listing_event_kind" AS ENUM('created', 'status_change', 'price_change', 'photo_change', 'imei_check', 'correction');--> statement-breakpoint
CREATE TYPE "public"."listing_kind" AS ENUM('unit', 'lot');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('draft', 'available', 'reserved', 'sold', 'in_transit', 'in_tradein', 'in_service', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('owner', 'seller');--> statement-breakpoint
CREATE TYPE "public"."plan_tier" AS ENUM('trial', 'base', 'negocio');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('active', 'expired', 'cancelled', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'authorized', 'paused', 'cancelled', 'payment_failed');--> statement-breakpoint
CREATE TYPE "public"."tenant_status" AS ENUM('active', 'suspended', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."tradein_check_result" AS ENUM('ok', 'fail', 'na');--> statement-breakpoint
CREATE TYPE "public"."tradein_status" AS ENUM('new', 'contacted', 'evaluating', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."wa_click_source" AS ENUM('storefront_card', 'storefront_detail', 'storefront_footer', 'chatbot', 'demo');--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"wa_phone" text NOT NULL,
	"payment_methods" text[] DEFAULT '{}'::text[] NOT NULL,
	"accepts_trade_in" boolean DEFAULT false NOT NULL,
	"plan" "plan_tier" DEFAULT 'trial' NOT NULL,
	"status" "tenant_status" DEFAULT 'active' NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_format" CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$'),
	CONSTRAINT "tenants_wa_phone_digits" CHECK (wa_phone ~ '^[0-9]{8,15}$')
);
--> statement-breakpoint
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"full_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "membership_role" DEFAULT 'seller' NOT NULL,
	"invited_by" uuid,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"hours" text NOT NULL,
	"city" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "locations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fx_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ars_per_usd" numeric(12, 2) NOT NULL,
	"rounding" "fx_rounding_mode" DEFAULT 'ceil_1000' NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fx_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "catalog_faqs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"catalog_model_id" uuid,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"locale" text DEFAULT 'es-AR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"brand" text DEFAULT 'Apple' NOT NULL,
	"family" text DEFAULT 'iPhone' NOT NULL,
	"display_name" text NOT NULL,
	"release_year" integer,
	"storage_options_gb" integer[] DEFAULT '{}' NOT NULL,
	"colors" text[] DEFAULT '{}' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"kind" "listing_kind" DEFAULT 'unit' NOT NULL,
	"catalog_model_id" uuid,
	"title" text NOT NULL,
	"storage_gb" integer,
	"color" text,
	"condition" "listing_condition" NOT NULL,
	"battery_pct" integer,
	"screen_original" boolean,
	"icloud_status_text" text,
	"warranty_text" text,
	"provenance_text" text,
	"description" text,
	"price_usd" numeric(12, 2) NOT NULL,
	"cost_usd" numeric(12, 2),
	"margin_usd" numeric(12, 2) GENERATED ALWAYS AS (price_usd - cost_usd) STORED,
	"supplier" text,
	"internal_notes" text,
	"imei" text,
	"imei_check_status" "imei_check_status" DEFAULT 'not_checked' NOT NULL,
	"imei_check_status_raw" text,
	"imei_checked_at" timestamp with time zone,
	"imei_checked_by" uuid,
	"imei_check_source" text,
	"imei_check_note" text,
	"qty" integer DEFAULT 1 NOT NULL,
	"status" "listing_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"sold_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listings_price_positive" CHECK (price_usd > 0),
	CONSTRAINT "listings_cost_non_negative" CHECK (cost_usd is null or cost_usd >= 0),
	CONSTRAINT "listings_battery_range" CHECK (battery_pct is null or (battery_pct between 0 and 100)),
	CONSTRAINT "listings_storage_positive" CHECK (storage_gb is null or storage_gb > 0),
	CONSTRAINT "listings_qty_non_negative" CHECK (qty >= 0),
	CONSTRAINT "listings_unit_shape" CHECK (kind <> 'unit' or qty = 1),
	CONSTRAINT "listings_lot_has_no_imei" CHECK (kind <> 'lot' or imei is null),
	CONSTRAINT "listings_imei_format" CHECK (imei is null or imei ~ '^[0-9]{15}$')
);
--> statement-breakpoint
ALTER TABLE "listings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "listing_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"alt" text,
	"master_key" text NOT NULL,
	"thumb_key" text NOT NULL,
	"card_key" text NOT NULL,
	"detail_key" text NOT NULL,
	"width" integer,
	"height" integer,
	"card_bytes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listing_photos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "listing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"kind" "listing_event_kind" NOT NULL,
	"from_status" "listing_status",
	"to_status" "listing_status",
	"actor_user_id" uuid,
	"reason" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listing_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "wa_click_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"listing_id" uuid,
	"source" "wa_click_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wa_click_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"status" "reservation_status" DEFAULT 'active' NOT NULL,
	"minutes" integer DEFAULT 60 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"customer_label" text,
	"created_by" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_minutes_range" CHECK (minutes between 30 and 120)
);
--> statement-breakpoint
ALTER TABLE "reservations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"reservation_id" uuid,
	"price_usd" numeric(12, 2) NOT NULL,
	"price_ars" numeric(12, 2),
	"fx_ars_per_usd" numeric(12, 2),
	"payment_method" text,
	"cost_usd" numeric(12, 2),
	"margin_usd" numeric(12, 2) GENERATED ALWAYS AS (price_usd - cost_usd) STORED,
	"internal_notes" text,
	"sold_by" uuid,
	"sold_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_price_positive" CHECK (price_usd > 0)
);
--> statement-breakpoint
ALTER TABLE "sales" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tradein_checklists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tradein_lead_id" uuid NOT NULL,
	"item_key" text NOT NULL,
	"item_label" text NOT NULL,
	"result" "tradein_check_result" DEFAULT 'na' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tradein_checklists" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tradein_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"status" "tradein_status" DEFAULT 'new' NOT NULL,
	"customer_name" text NOT NULL,
	"customer_wa_phone" text NOT NULL,
	"model_text" text NOT NULL,
	"storage_gb" integer,
	"color" text,
	"declared_condition" "listing_condition",
	"battery_pct" integer,
	"notes" text,
	"offer_usd" numeric(12, 2),
	"internal_notes" text,
	"created_listing_id" uuid,
	"handled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tradein_leads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "chatbot_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"role" "chat_role" NOT NULL,
	"content" text NOT NULL,
	"tokens_in" integer,
	"tokens_out" integer,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chatbot_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "chatbot_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"listing_id" uuid,
	"visitor_hash" text,
	"message_count" integer DEFAULT 0 NOT NULL,
	"last_message_at" timestamp with time zone,
	"handed_off_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chatbot_threads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"limit_value" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entitlements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text DEFAULT 'mercadopago' NOT NULL,
	"provider_preapproval_id" text,
	"external_reference" text,
	"last_provider_event_id" text,
	"plan" "plan_tier" DEFAULT 'trial' NOT NULL,
	"status" "subscription_status" DEFAULT 'trialing' NOT NULL,
	"amount_ars" numeric(12, 2),
	"payment_method" text,
	"trial_ends_at" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_settings" ADD CONSTRAINT "fx_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_settings" ADD CONSTRAINT "fx_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_faqs" ADD CONSTRAINT "catalog_faqs_catalog_model_id_catalog_models_id_fk" FOREIGN KEY ("catalog_model_id") REFERENCES "public"."catalog_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_catalog_model_id_catalog_models_id_fk" FOREIGN KEY ("catalog_model_id") REFERENCES "public"."catalog_models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_imei_checked_by_users_id_fk" FOREIGN KEY ("imei_checked_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_photos" ADD CONSTRAINT "listing_photos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_photos" ADD CONSTRAINT "listing_photos_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_events" ADD CONSTRAINT "listing_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_events" ADD CONSTRAINT "listing_events_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_events" ADD CONSTRAINT "listing_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_click_events" ADD CONSTRAINT "wa_click_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_click_events" ADD CONSTRAINT "wa_click_events_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_sold_by_users_id_fk" FOREIGN KEY ("sold_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradein_checklists" ADD CONSTRAINT "tradein_checklists_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradein_checklists" ADD CONSTRAINT "tradein_checklists_tradein_lead_id_tradein_leads_id_fk" FOREIGN KEY ("tradein_lead_id") REFERENCES "public"."tradein_leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradein_leads" ADD CONSTRAINT "tradein_leads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradein_leads" ADD CONSTRAINT "tradein_leads_created_listing_id_listings_id_fk" FOREIGN KEY ("created_listing_id") REFERENCES "public"."listings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradein_leads" ADD CONSTRAINT "tradein_leads_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatbot_messages" ADD CONSTRAINT "chatbot_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatbot_messages" ADD CONSTRAINT "chatbot_messages_thread_id_chatbot_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chatbot_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatbot_threads" ADD CONSTRAINT "chatbot_threads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatbot_threads" ADD CONSTRAINT "chatbot_threads_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "tenants_status_idx" ON "tenants" USING btree ("status");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "memberships_tenant_idx" ON "memberships" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_tenant_user_key" ON "memberships" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "locations_tenant_idx" ON "locations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "locations_tenant_active_idx" ON "locations" USING btree ("tenant_id","is_active","sort_order");--> statement-breakpoint
CREATE INDEX "fx_settings_tenant_idx" ON "fx_settings" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fx_settings_tenant_key" ON "fx_settings" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "catalog_faqs_model_idx" ON "catalog_faqs" USING btree ("catalog_model_id","locale");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_models_slug_key" ON "catalog_models" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "catalog_models_family_idx" ON "catalog_models" USING btree ("family","release_year");--> statement-breakpoint
CREATE INDEX "listings_tenant_idx" ON "listings" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "listings_tenant_status_idx" ON "listings" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "listings_tenant_slug_key" ON "listings" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE INDEX "listings_tenant_model_idx" ON "listings" USING btree ("tenant_id","catalog_model_id");--> statement-breakpoint
CREATE UNIQUE INDEX "listings_tenant_imei_key" ON "listings" USING btree ("tenant_id","imei") WHERE imei is not null;--> statement-breakpoint
CREATE INDEX "listings_tenant_imei_check_idx" ON "listings" USING btree ("tenant_id","imei_check_status","created_at") WHERE kind = 'unit';--> statement-breakpoint
CREATE INDEX "listing_photos_tenant_idx" ON "listing_photos" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "listing_photos_tenant_listing_idx" ON "listing_photos" USING btree ("tenant_id","listing_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "listing_photos_listing_sort_key" ON "listing_photos" USING btree ("listing_id","sort_order");--> statement-breakpoint
CREATE INDEX "listing_events_tenant_idx" ON "listing_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "listing_events_tenant_listing_idx" ON "listing_events" USING btree ("tenant_id","listing_id","created_at");--> statement-breakpoint
CREATE INDEX "wa_click_events_tenant_idx" ON "wa_click_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "wa_click_events_tenant_created_idx" ON "wa_click_events" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "reservations_tenant_idx" ON "reservations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "reservations_tenant_status_idx" ON "reservations" USING btree ("tenant_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "reservations_active_expiry_idx" ON "reservations" USING btree ("expires_at") WHERE status = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_one_active_per_listing" ON "reservations" USING btree ("listing_id") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "sales_tenant_idx" ON "sales" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "sales_tenant_sold_at_idx" ON "sales" USING btree ("tenant_id","sold_at");--> statement-breakpoint
CREATE INDEX "sales_tenant_listing_idx" ON "sales" USING btree ("tenant_id","listing_id");--> statement-breakpoint
CREATE INDEX "tradein_checklists_tenant_idx" ON "tradein_checklists" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tradein_checklists_tenant_lead_idx" ON "tradein_checklists" USING btree ("tenant_id","tradein_lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tradein_checklists_lead_item_key" ON "tradein_checklists" USING btree ("tradein_lead_id","item_key");--> statement-breakpoint
CREATE INDEX "tradein_leads_tenant_idx" ON "tradein_leads" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tradein_leads_tenant_status_idx" ON "tradein_leads" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "chatbot_messages_tenant_idx" ON "chatbot_messages" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "chatbot_messages_tenant_thread_idx" ON "chatbot_messages" USING btree ("tenant_id","thread_id","created_at");--> statement-breakpoint
CREATE INDEX "chatbot_threads_tenant_idx" ON "chatbot_threads" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "chatbot_threads_tenant_created_idx" ON "chatbot_threads" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "entitlements_tenant_idx" ON "entitlements" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entitlements_tenant_feature_key" ON "entitlements" USING btree ("tenant_id","feature");--> statement-breakpoint
CREATE INDEX "subscriptions_tenant_idx" ON "subscriptions" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_tenant_key" ON "subscriptions" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_preapproval_key" ON "subscriptions" USING btree ("provider_preapproval_id");--> statement-breakpoint
CREATE POLICY "tenants_tenant_select" ON "tenants" AS PERMISSIVE FOR SELECT TO "authenticated" USING (id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenants_tenant_insert" ON "tenants" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenants_tenant_update" ON "tenants" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid) WITH CHECK (id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenants_tenant_delete" ON "tenants" AS PERMISSIVE FOR DELETE TO "authenticated" USING (id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "users_self_or_teammate_select" ON "users" AS PERMISSIVE FOR SELECT TO "authenticated" USING (id = (select auth.uid()) or exists (
    select 1 from public.memberships m
    where m.user_id = users.id
      and m.tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
  ));--> statement-breakpoint
CREATE POLICY "users_self_insert" ON "users" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "users_self_update" ON "users" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (id = (select auth.uid())) WITH CHECK (id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "users_self_delete" ON "users" AS PERMISSIVE FOR DELETE TO "authenticated" USING (id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "memberships_tenant_select" ON "memberships" AS PERMISSIVE FOR SELECT TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "memberships_tenant_insert" ON "memberships" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "memberships_tenant_update" ON "memberships" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid) WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "memberships_tenant_delete" ON "memberships" AS PERMISSIVE FOR DELETE TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "locations_tenant_select" ON "locations" AS PERMISSIVE FOR SELECT TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "locations_tenant_insert" ON "locations" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "locations_tenant_update" ON "locations" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid) WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "locations_tenant_delete" ON "locations" AS PERMISSIVE FOR DELETE TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "fx_settings_tenant_select" ON "fx_settings" AS PERMISSIVE FOR SELECT TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "fx_settings_tenant_insert" ON "fx_settings" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "fx_settings_tenant_update" ON "fx_settings" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid) WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "fx_settings_tenant_delete" ON "fx_settings" AS PERMISSIVE FOR DELETE TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "listings_tenant_select" ON "listings" AS PERMISSIVE FOR SELECT TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "listings_tenant_insert" ON "listings" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "listings_tenant_update" ON "listings" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid) WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "listings_tenant_delete" ON "listings" AS PERMISSIVE FOR DELETE TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "listing_photos_tenant_select" ON "listing_photos" AS PERMISSIVE FOR SELECT TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "listing_photos_tenant_insert" ON "listing_photos" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "listing_photos_tenant_update" ON "listing_photos" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid) WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "listing_photos_tenant_delete" ON "listing_photos" AS PERMISSIVE FOR DELETE TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "listing_events_tenant_select" ON "listing_events" AS PERMISSIVE FOR SELECT TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "listing_events_tenant_insert" ON "listing_events" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "listing_events_tenant_update" ON "listing_events" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid) WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "listing_events_tenant_delete" ON "listing_events" AS PERMISSIVE FOR DELETE TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "wa_click_events_tenant_select" ON "wa_click_events" AS PERMISSIVE FOR SELECT TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "wa_click_events_tenant_insert" ON "wa_click_events" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "wa_click_events_tenant_update" ON "wa_click_events" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid) WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "wa_click_events_tenant_delete" ON "wa_click_events" AS PERMISSIVE FOR DELETE TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "reservations_tenant_select" ON "reservations" AS PERMISSIVE FOR SELECT TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "reservations_tenant_insert" ON "reservations" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "reservations_tenant_update" ON "reservations" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid) WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "reservations_tenant_delete" ON "reservations" AS PERMISSIVE FOR DELETE TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "sales_tenant_select" ON "sales" AS PERMISSIVE FOR SELECT TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "sales_tenant_insert" ON "sales" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "sales_tenant_update" ON "sales" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid) WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "sales_tenant_delete" ON "sales" AS PERMISSIVE FOR DELETE TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tradein_checklists_tenant_select" ON "tradein_checklists" AS PERMISSIVE FOR SELECT TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tradein_checklists_tenant_insert" ON "tradein_checklists" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tradein_checklists_tenant_update" ON "tradein_checklists" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid) WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tradein_checklists_tenant_delete" ON "tradein_checklists" AS PERMISSIVE FOR DELETE TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tradein_leads_tenant_select" ON "tradein_leads" AS PERMISSIVE FOR SELECT TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tradein_leads_tenant_insert" ON "tradein_leads" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tradein_leads_tenant_update" ON "tradein_leads" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid) WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tradein_leads_tenant_delete" ON "tradein_leads" AS PERMISSIVE FOR DELETE TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "chatbot_messages_tenant_select" ON "chatbot_messages" AS PERMISSIVE FOR SELECT TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "chatbot_messages_tenant_insert" ON "chatbot_messages" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "chatbot_messages_tenant_update" ON "chatbot_messages" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid) WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "chatbot_messages_tenant_delete" ON "chatbot_messages" AS PERMISSIVE FOR DELETE TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "chatbot_threads_tenant_select" ON "chatbot_threads" AS PERMISSIVE FOR SELECT TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "chatbot_threads_tenant_insert" ON "chatbot_threads" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "chatbot_threads_tenant_update" ON "chatbot_threads" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid) WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "chatbot_threads_tenant_delete" ON "chatbot_threads" AS PERMISSIVE FOR DELETE TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "entitlements_tenant_select" ON "entitlements" AS PERMISSIVE FOR SELECT TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "entitlements_tenant_insert" ON "entitlements" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "entitlements_tenant_update" ON "entitlements" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid) WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "entitlements_tenant_delete" ON "entitlements" AS PERMISSIVE FOR DELETE TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "subscriptions_tenant_select" ON "subscriptions" AS PERMISSIVE FOR SELECT TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "subscriptions_tenant_insert" ON "subscriptions" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "subscriptions_tenant_update" ON "subscriptions" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid) WITH CHECK (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "subscriptions_tenant_delete" ON "subscriptions" AS PERMISSIVE FOR DELETE TO "authenticated" USING (tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);