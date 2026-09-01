-- 0019 · transición de estado acotada para el panel.
--
-- `authenticated` no conserva UPDATE directo sobre listings.status. Esta función es la única
-- puerta para las transiciones que el panel ya valida en dominio: comprueba identidad, tenant,
-- membresía vigente, arista permitida y estado esperado en una sola sentencia concurrente.
CREATE OR REPLACE FUNCTION public.transition_listing_status(
  p_tenant_id uuid,
  p_listing_id uuid,
  p_expected_status listing_status,
  p_next_status listing_status
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  changed integer;
BEGIN
  IF p_tenant_id IS NULL OR p_listing_id IS NULL OR p_expected_status IS NULL OR p_next_status IS NULL THEN
    RETURN 0;
  END IF;

  IF p_tenant_id IS DISTINCT FROM ((select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid)
     OR NOT public.is_current_user_tenant_member(p_tenant_id)
     OR p_expected_status = p_next_status THEN
    RETURN 0;
  END IF;

  -- Espejo defensivo de las aristas de @istock/domain. Los guards de fotos, reservas y venta
  -- siguen viviendo en el dominio; esta función sólo impide saltos imposibles por PostgREST.
  IF NOT (
    (p_expected_status = 'draft' AND p_next_status IN ('available', 'in_transit', 'in_tradein', 'in_service', 'unavailable')) OR
    (p_expected_status = 'available' AND p_next_status IN ('draft', 'reserved', 'sold', 'in_transit', 'in_tradein', 'in_service', 'unavailable')) OR
    (p_expected_status = 'reserved' AND p_next_status IN ('available', 'sold', 'in_transit', 'in_tradein', 'in_service', 'unavailable')) OR
    (p_expected_status = 'in_transit' AND p_next_status IN ('draft', 'available', 'in_tradein', 'in_service', 'unavailable')) OR
    (p_expected_status = 'in_tradein' AND p_next_status IN ('draft', 'available', 'in_transit', 'in_service', 'unavailable')) OR
    (p_expected_status = 'in_service' AND p_next_status IN ('draft', 'available', 'in_transit', 'in_tradein', 'unavailable')) OR
    (p_expected_status = 'unavailable' AND p_next_status IN ('draft', 'available', 'in_transit', 'in_tradein', 'in_service'))
  ) THEN
    RETURN 0;
  END IF;

  UPDATE public.listings
     SET status = p_next_status, updated_at = now()
   WHERE tenant_id = p_tenant_id
     AND id = p_listing_id
     AND status = p_expected_status;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END
$fn$;
--> statement-breakpoint
ALTER FUNCTION public.transition_listing_status(uuid, uuid, listing_status, listing_status) OWNER TO service_role;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.transition_listing_status(uuid, uuid, listing_status, listing_status) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.transition_listing_status(uuid, uuid, listing_status, listing_status) TO authenticated, service_role;
--> statement-breakpoint

DO $check$
DECLARE
  owner_name text;
BEGIN
  SELECT pg_get_userbyid(p.proowner) INTO owner_name
    FROM pg_proc p
   WHERE p.oid = 'public.transition_listing_status(uuid,uuid,listing_status,listing_status)'::regprocedure;
  IF owner_name <> 'service_role'
     OR NOT has_function_privilege('authenticated', 'public.transition_listing_status(uuid,uuid,listing_status,listing_status)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.transition_listing_status(uuid,uuid,listing_status,listing_status)', 'EXECUTE') THEN
    RAISE EXCEPTION '0019 transition RPC privilege contract failed' USING ERRCODE = '42501';
  END IF;
END
$check$;
