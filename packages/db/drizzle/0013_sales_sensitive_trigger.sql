-- 0013 · seller sales remain writable after sensitive SELECT is removed from listings.
--
-- The sales INSERT policy used to read listings.cost_usd directly. That is safe only while
-- authenticated has SELECT on that column; once the column is private, the policy itself fails
-- with 42501 before it can evaluate the seller rule. A SECURITY DEFINER trigger keeps the
-- comparison inside the database without granting the seller a cost read privilege.

REVOKE SELECT ("supplier", "internal_notes") ON TABLE "listings" FROM authenticated;--> statement-breakpoint

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

  -- El costo se congela desde la unidad; el valor entregado por el caller nunca es la fuente.
  NEW.cost_usd := expected_cost;

  IF EXISTS (
    SELECT 1
    FROM public.memberships AS m
    WHERE m.tenant_id = NEW.tenant_id
      AND m.user_id = (select auth.uid())
      AND m.role = 'owner'::public.membership_role
  ) AND NEW.internal_notes IS NOT NULL THEN
    RAISE EXCEPTION 'seller cannot set sale internal notes' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$fn$;--> statement-breakpoint
ALTER FUNCTION public.reject_seller_forged_sale_fields() OWNER TO service_role;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.reject_seller_forged_sale_fields() FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint
CREATE TRIGGER sales_reject_seller_forged_fields
BEFORE INSERT ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.reject_seller_forged_sale_fields();--> statement-breakpoint

ALTER POLICY "sales_tenant_insert" ON "sales" TO authenticated
WITH CHECK (
  tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
  AND public.is_current_user_tenant_owner(tenant_id)
  OR tenant_id = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
  AND public.is_current_user_tenant_member(tenant_id)
  AND NOT public.is_current_user_tenant_owner(tenant_id)
  AND internal_notes IS NULL
  AND sold_by = (select auth.uid())
);--> statement-breakpoint

COMMENT ON FUNCTION public.reject_seller_forged_sale_fields() IS
  'Seller sale writes compare cost to the tenant listing inside a SECURITY DEFINER trigger; authenticated never receives SELECT on listings.cost_usd.';
