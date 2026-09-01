-- 0018 · reparación de la superficie UPDATE de listings en bases que ya aplicaron 0016.
--
-- 0016 revocó correctamente el UPDATE de tabla, pero el panel todavía edita
-- listings.acquisition_channel. Esta columna es ordinaria y queda otorgada explícitamente; los
-- campos de identidad, estado, publicación, venta y sensibles siguen fuera del ACL.
GRANT UPDATE (acquisition_channel) ON TABLE public.listings TO authenticated;--> statement-breakpoint

-- 0016 ya había reemplazado esta función en instalaciones nuevas. Se repite acá porque 0016 es
-- versionada y no se reejecuta en una base que ya la registró: las columnas generadas no tienen el
-- valor final durante un BEFORE trigger, por lo que comparar margin_usd marcaba un update de
-- title/acquisition_channel como si fuera una mutación protegida.
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

DO $check$
DECLARE
  problem text;
BEGIN
  IF has_table_privilege('authenticated', 'public.listings', 'UPDATE') THEN
    problem := 'authenticated conserva UPDATE de tabla en listings';
  ELSIF NOT has_column_privilege('authenticated', 'public.listings', 'acquisition_channel', 'UPDATE') THEN
    problem := 'authenticated perdió UPDATE listings.acquisition_channel';
  ELSIF has_column_privilege('authenticated', 'public.listings', 'imei', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.listings', 'status', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.listings', 'published_at', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.listings', 'sold_at', 'UPDATE') THEN
    problem := 'authenticated puede actualizar un campo protegido de listings';
  END IF;

  IF problem IS NOT NULL THEN
    RAISE EXCEPTION '0018 listing grants fail-closed: %', problem USING ERRCODE = '42501';
  END IF;

  RAISE NOTICE
    '0018 effective privileges: listings table UPDATE=%, acquisition_channel UPDATE=%, status UPDATE=%',
    has_table_privilege('authenticated', 'public.listings', 'UPDATE'),
    has_column_privilege('authenticated', 'public.listings', 'acquisition_channel', 'UPDATE'),
    has_column_privilege('authenticated', 'public.listings', 'status', 'UPDATE');
END
$check$;
