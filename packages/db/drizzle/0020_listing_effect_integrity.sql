-- 0020 · los estados comerciales no pueden quedar sin sus efectos.
--
-- El panel ejecuta cada operación dentro de una transacción: primero cambia el listing y después
-- escribe la reserva/venta correspondiente. Estas restricciones son DEFERRABLE para validar el
-- estado final al COMMIT y cerrar el acceso directo por PostgREST sin romper ese orden.

CREATE OR REPLACE FUNCTION public.assert_listing_effect_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  claim_tenant uuid;
BEGIN
  -- Seed, migraciones y jobs usan service_role/admin y no son un caller de usuario.
  IF (select auth.uid()) IS NULL THEN
    RETURN NEW;
  END IF;

  claim_tenant := nullif((select auth.jwt() -> 'app_metadata' ->> 'tenant_id'), '')::uuid;
  -- Una fila de otro tenant debe fallar por RLS, no por esta defensa secundaria.
  IF NEW.tenant_id IS DISTINCT FROM claim_tenant THEN
    RETURN NEW;
  END IF;

  IF NEW.status IN ('available', 'reserved', 'sold')
     AND NOT EXISTS (
       SELECT 1 FROM public.listing_photos p
        WHERE p.tenant_id = NEW.tenant_id AND p.listing_id = NEW.id
     ) THEN
    RAISE EXCEPTION 'public listing requires at least one photo' USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'available'
     AND EXISTS (
       SELECT 1 FROM public.reservations r
        WHERE r.tenant_id = NEW.tenant_id AND r.listing_id = NEW.id AND r.status = 'active'
     ) THEN
    RAISE EXCEPTION 'available listing cannot have an active reservation' USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'reserved'
     AND NOT EXISTS (
       SELECT 1 FROM public.reservations r
        WHERE r.tenant_id = NEW.tenant_id AND r.listing_id = NEW.id AND r.status = 'active'
     ) THEN
    RAISE EXCEPTION 'reserved listing requires an active reservation' USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'sold' AND (
       EXISTS (
         SELECT 1 FROM public.reservations r
          WHERE r.tenant_id = NEW.tenant_id AND r.listing_id = NEW.id AND r.status = 'active'
       )
       OR NOT EXISTS (
         SELECT 1 FROM public.sales s
          WHERE s.tenant_id = NEW.tenant_id AND s.listing_id = NEW.id
       )
     ) THEN
    RAISE EXCEPTION 'sold listing requires a sale and no active reservation' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$fn$;
--> statement-breakpoint

ALTER FUNCTION public.assert_listing_effect_integrity() OWNER TO service_role;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.assert_listing_effect_integrity() FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint

DROP TRIGGER IF EXISTS listings_assert_effect_integrity ON public.listings;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER listings_assert_effect_integrity
  AFTER INSERT OR UPDATE OF status ON public.listings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.status IN ('available', 'reserved', 'sold'))
  EXECUTE FUNCTION public.assert_listing_effect_integrity();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.assert_reservation_listing_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF (select auth.uid()) IS NULL
     OR NEW.tenant_id IS DISTINCT FROM nullif((select auth.jwt() -> 'app_metadata' ->> 'tenant_id'), '')::uuid
     OR NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.listings l
     WHERE l.tenant_id = NEW.tenant_id AND l.id = NEW.listing_id AND l.status = 'reserved'
  ) THEN
    RAISE EXCEPTION 'active reservation requires a reserved listing' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$fn$;
--> statement-breakpoint

ALTER FUNCTION public.assert_reservation_listing_state() OWNER TO service_role;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.assert_reservation_listing_state() FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
DROP TRIGGER IF EXISTS reservations_assert_listing_state ON public.reservations;
--> statement-breakpoint
CREATE TRIGGER reservations_assert_listing_state
  BEFORE INSERT OR UPDATE OF status ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.assert_reservation_listing_state();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.assert_sale_listing_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF (select auth.uid()) IS NULL
     OR NEW.tenant_id IS DISTINCT FROM nullif((select auth.jwt() -> 'app_metadata' ->> 'tenant_id'), '')::uuid THEN
    RETURN NEW;
  END IF;

  -- Let the composite FK be the authority when the parent row is absent for
  -- this tenant. This preserves the expected 23503 instead of masking it with
  -- the commerce-state invariant below.
  IF NOT EXISTS (
    SELECT 1 FROM public.listings l
     WHERE l.tenant_id = NEW.tenant_id AND l.id = NEW.listing_id
  ) THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.listings l
     WHERE l.tenant_id = NEW.tenant_id AND l.id = NEW.listing_id AND l.status = 'sold'
  ) THEN
    RAISE EXCEPTION 'sale requires a sold listing' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$fn$;
--> statement-breakpoint

ALTER FUNCTION public.assert_sale_listing_state() OWNER TO service_role;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.assert_sale_listing_state() FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
DROP TRIGGER IF EXISTS zz_sales_assert_listing_state ON public.sales;
--> statement-breakpoint
CREATE TRIGGER zz_sales_assert_listing_state
  BEFORE INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.assert_sale_listing_state();
--> statement-breakpoint

DO $check$
DECLARE
  bad_public bigint;
  bad_active_reservations bigint;
  bad_sales bigint;
BEGIN
  SELECT count(*) INTO bad_public
    FROM public.listings l
   WHERE l.status IN ('available', 'reserved', 'sold')
     AND NOT EXISTS (
       SELECT 1 FROM public.listing_photos p
        WHERE p.tenant_id = l.tenant_id AND p.listing_id = l.id
     );
  SELECT count(*) INTO bad_active_reservations
    FROM public.reservations r
    JOIN public.listings l ON l.tenant_id = r.tenant_id AND l.id = r.listing_id
   WHERE r.status = 'active' AND l.status <> 'reserved';
  SELECT count(*) INTO bad_sales
    FROM public.sales s
    JOIN public.listings l ON l.tenant_id = s.tenant_id AND l.id = s.listing_id
   WHERE l.status <> 'sold';

  IF bad_public > 0 OR bad_active_reservations > 0 OR bad_sales > 0 THEN
    RAISE EXCEPTION '0020 existing commerce effects are inconsistent: public_without_photos=%, active_reservation_without_reserved_listing=%, sale_without_sold_listing=%',
      bad_public, bad_active_reservations, bad_sales USING ERRCODE = '23514';
  END IF;
END
$check$;
