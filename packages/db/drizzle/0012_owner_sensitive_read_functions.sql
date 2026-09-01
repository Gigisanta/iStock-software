-- 0012 · el rol `authenticated` no lee costos/notas sensibles por tabla.
--
-- `authenticated` es compartido por owner y seller. RLS sólo decide qué FILAS, no qué
-- COLUMNAS, por lo que un policy de tenant no puede esconder `cost_usd`, `offer_usd` o
-- `internal_notes`. Se revoca el SELECT de tabla y se vuelve a otorgar una allowlist de
-- columnas no protegidas. Los owners obtienen los tres valores únicamente por las funciones
-- de abajo, que validan el contexto de sesión antes de leer como `service_role`.

REVOKE SELECT ON TABLE "listings" FROM authenticated;--> statement-breakpoint
GRANT SELECT (
  "id", "tenant_id", "slug", "kind", "catalog_model_id", "title", "storage_gb", "color",
  "condition", "battery_pct", "screen_original", "icloud_status_text", "warranty_text",
  "provenance_text", "description", "price_usd",
  "imei_check_status", "imei_check_status_raw", "imei_checked_at", "imei_checked_by",
  "imei_check_source", "imei_check_note", "qty", "status", "published_at", "sold_at",
  "created_by", "created_at", "updated_at", "acquisition_channel"
) ON TABLE "listings" TO authenticated;--> statement-breakpoint

REVOKE SELECT ON TABLE "tradein_leads" FROM authenticated;--> statement-breakpoint
GRANT SELECT (
  "id", "tenant_id", "status", "customer_name", "customer_wa_phone", "model_text",
  "storage_gb", "color", "declared_condition", "battery_pct", "notes", "created_listing_id",
  "handled_by", "created_at", "updated_at"
) ON TABLE "tradein_leads" TO authenticated;--> statement-breakpoint

-- El dueño de la función es `service_role`: en Supabase es BYPASSRLS, así que FORCE RLS no
-- convierte la lectura protegida en cero filas. La función no confía en ese privilegio:
-- valida el rol de la sesión, auth.uid(), el tenant del claim, la pertenencia y role=owner,
-- y ata el tenant de la fila al tenant solicitado.
CREATE OR REPLACE FUNCTION public.owner_get_listing_cost(
  p_tenant_id uuid,
  p_listing_id uuid
)
RETURNS TABLE (listing_id uuid, cost_usd numeric(12,2))
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
  WITH request AS (
    SELECT
      (select auth.uid()) AS user_id,
      (select auth.role()) AS role_name,
      nullif((select auth.jwt() -> 'app_metadata' ->> 'tenant_id'), '') AS claim_tenant_id
  )
  SELECT l.id, l.cost_usd
  FROM public.listings AS l
  CROSS JOIN request AS r
  WHERE r.role_name = 'authenticated'
    AND r.user_id IS NOT NULL
    AND p_tenant_id IS NOT NULL
    AND p_listing_id IS NOT NULL
    AND r.claim_tenant_id = p_tenant_id::text
    AND l.tenant_id = p_tenant_id
    AND l.id = p_listing_id
    AND EXISTS (
      SELECT 1
      FROM public.memberships AS m
      WHERE m.tenant_id = p_tenant_id
        AND m.user_id = r.user_id
        AND m.role = 'owner'::public.membership_role
    )
$fn$;--> statement-breakpoint
ALTER FUNCTION public.owner_get_listing_cost(uuid, uuid) OWNER TO service_role;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.owner_get_listing_cost(uuid, uuid) FROM PUBLIC, anon, service_role;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.owner_get_listing_cost(uuid, uuid) TO authenticated;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.owner_get_tradein_sensitive(
  p_tenant_id uuid,
  p_tradein_lead_id uuid
)
RETURNS TABLE (tradein_lead_id uuid, offer_usd numeric(12,2), internal_notes text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
  WITH request AS (
    SELECT
      (select auth.uid()) AS user_id,
      (select auth.role()) AS role_name,
      nullif((select auth.jwt() -> 'app_metadata' ->> 'tenant_id'), '') AS claim_tenant_id
  )
  SELECT t.id, t.offer_usd, t.internal_notes
  FROM public.tradein_leads AS t
  CROSS JOIN request AS r
  WHERE r.role_name = 'authenticated'
    AND r.user_id IS NOT NULL
    AND p_tenant_id IS NOT NULL
    AND p_tradein_lead_id IS NOT NULL
    AND r.claim_tenant_id = p_tenant_id::text
    AND t.tenant_id = p_tenant_id
    AND t.id = p_tradein_lead_id
    AND EXISTS (
      SELECT 1
      FROM public.memberships AS m
      WHERE m.tenant_id = p_tenant_id
        AND m.user_id = r.user_id
        AND m.role = 'owner'::public.membership_role
    )
$fn$;--> statement-breakpoint
ALTER FUNCTION public.owner_get_tradein_sensitive(uuid, uuid) OWNER TO service_role;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.owner_get_tradein_sensitive(uuid, uuid) FROM PUBLIC, anon, service_role;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.owner_get_tradein_sensitive(uuid, uuid) TO authenticated;--> statement-breakpoint

COMMENT ON FUNCTION public.owner_get_listing_cost(uuid, uuid) IS
  'Owner-only sensitive read. Validates auth.role, auth.uid, tenant claim, membership_role=owner and row tenant before returning listings.cost_usd.';--> statement-breakpoint
COMMENT ON FUNCTION public.owner_get_tradein_sensitive(uuid, uuid) IS
  'Owner-only sensitive read. Validates auth.role, auth.uid, tenant claim, membership_role=owner and row tenant before returning tradein_leads.offer_usd/internal_notes.';
