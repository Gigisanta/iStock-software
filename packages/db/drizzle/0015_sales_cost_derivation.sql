-- 0015 · existing databases adopt the same cost derivation as fresh installs.
--
-- 0013 created the trigger before the sensitive-column hardening was completed. Replacing the
-- function and narrowing the event to INSERT keeps sales.cost_usd frozen at sale time without
-- requiring authenticated to SELECT listings.cost_usd.

CREATE OR REPLACE FUNCTION public.reject_seller_forged_sale_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE expected_cost numeric(12,2);
BEGIN
  IF (select auth.uid()) IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT l.cost_usd INTO expected_cost
  FROM public.listings AS l
  WHERE l.tenant_id = NEW.tenant_id AND l.id = NEW.listing_id;

  NEW.cost_usd := expected_cost;

  IF EXISTS (
    SELECT 1
    FROM public.memberships AS m
    WHERE m.tenant_id = NEW.tenant_id
      AND m.user_id = (select auth.uid())
      AND m.role <> 'owner'::public.membership_role
  ) AND NEW.internal_notes IS NOT NULL THEN
    RAISE EXCEPTION 'seller cannot set sale internal notes' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$fn$;--> statement-breakpoint
ALTER FUNCTION public.reject_seller_forged_sale_fields() OWNER TO service_role;--> statement-breakpoint
DROP TRIGGER IF EXISTS sales_reject_seller_forged_fields ON public.sales;--> statement-breakpoint
CREATE TRIGGER sales_reject_seller_forged_fields
BEFORE INSERT ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.reject_seller_forged_sale_fields();--> statement-breakpoint

COMMENT ON FUNCTION public.reject_seller_forged_sale_fields() IS
  'Sales cost is derived from the tenant listing at insert time; seller cannot select or forge listings.cost_usd.';
