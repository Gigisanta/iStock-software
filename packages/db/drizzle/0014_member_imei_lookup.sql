-- 0014 · IMEI duplicate checks remain possible without granting direct IMEI reads.

REVOKE SELECT ("imei") ON TABLE "listings" FROM authenticated;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.member_get_taken_imeis(
  p_tenant_id uuid,
  p_imeis text[]
)
RETURNS TABLE (imei text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
  SELECT l.imei
  FROM public.listings AS l
  WHERE (select auth.role()) = 'authenticated'
    AND (select auth.uid()) IS NOT NULL
    AND p_tenant_id IS NOT NULL
    AND (select auth.jwt() -> 'app_metadata' ->> 'tenant_id') = p_tenant_id::text
    AND EXISTS (
      SELECT 1
      FROM public.memberships AS m
      WHERE m.tenant_id = p_tenant_id
        AND m.user_id = (select auth.uid())
    )
    AND l.tenant_id = p_tenant_id
    AND l.imei = ANY (coalesce(p_imeis, ARRAY[]::text[]))
$fn$;--> statement-breakpoint
ALTER FUNCTION public.member_get_taken_imeis(uuid, text[]) OWNER TO service_role;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.member_get_taken_imeis(uuid, text[]) FROM PUBLIC, anon, service_role;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.member_get_taken_imeis(uuid, text[]) TO authenticated;--> statement-breakpoint

COMMENT ON FUNCTION public.member_get_taken_imeis(uuid, text[]) IS
  'Member-only duplicate check for supplied IMEIs. Returns only matching values in the claimed tenant; authenticated has no direct SELECT on listings.imei.';
