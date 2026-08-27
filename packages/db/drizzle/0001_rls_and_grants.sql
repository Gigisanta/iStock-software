-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 0001 · RLS forzada, GRANTs mínimos y marcado de columnas sensibles.
--
-- Escrita a mano a propósito. `drizzle-kit generate` emite `ENABLE ROW LEVEL SECURITY` y las
-- policies (eso está en 0000 y sigue siendo la fuente de verdad del schema), pero NO emite
-- tres cosas que en este proyecto no son opcionales:
--
--   1. `FORCE ROW LEVEL SECURITY`. Sin `FORCE`, **el dueño de la tabla ignora las policies**.
--      En Supabase el dueño es `postgres`, y cualquier cosa que corra con ese rol lee todos los
--      tenants. RLS "habilitada" sin `FORCE` es RLS que se apaga sola en el peor momento.
--   2. Los `GRANT`. RLS se aplica **encima** de los privilegios, no en lugar de ellos. Una tabla
--      sin `GRANT` no la lee nadie (bien), y una tabla con `GRANT ALL` al rol equivocado la lee
--      todo el mundo antes de que la policy opine. Acá se otorga tabla por tabla, y a `anon`
--      **nada**: la vidriera es ISR servida desde el CDN, no un cliente anónimo con SQL.
--      Corolario que costó un test rojo: `BYPASSRLS` **no** otorga privilegios. `service_role`
--      bypassea las policies, pero sin `GRANT` no lee una fila. Ver §2.
--   2bis. Los `ALTER DEFAULT PRIVILEGES`. El `REVOKE ... ON ALL TABLES` sólo alcanza a las tablas
--      que existen cuando corre. En un proyecto Supabase real las tablas NUEVAS nacen con GRANT a
--      `anon`/`authenticated` por default privileges del rol dueño. Ver §2.a.
--   3. El marcado `-- SENSITIVE: never in public DTO`, que además se graba como
--      `COMMENT ON COLUMN` → queda **consultable desde Postgres** (`col_description`) y lo
--      verifica `src/schema.test.ts` contra la base real. Un comentario que sólo vive en el
--      TypeScript se pierde en el primer refactor; éste no.
--
-- Aplica con `psql -f`. Idempotente salvo por los `COMMENT`, que son sobrescritura.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

-- ── 1 · FORCE RLS en las 17 tablas de negocio ─────────────────────────────────────────────
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "locations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fx_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "listings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "listing_photos" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "listing_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "wa_click_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reservations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tradein_leads" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tradein_checklists" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chatbot_threads" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chatbot_messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "subscriptions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "entitlements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- ── 2 · GRANTs ───────────────────────────────────────────────────────────────────────────
-- Tres roles, tres razones distintas. Ninguna es "ya viene resuelto por Supabase".
--
--   `anon`          → NADA. Ni hoy, ni sobre la tabla que se cree el mes que viene. El visitante
--                     de la vidriera no es un cliente de Postgres: la vidriera es ISR servida por
--                     el CDN y el 5% que falla el cache lo resuelve el server del tenant (ADR-003).
--   `authenticated` → DML tabla por tabla sobre las 17 de negocio; SELECT pelado sobre el catálogo
--                     global. El GRANT decide QUÉ tablas se pueden tocar; la policy, QUÉ filas.
--   `service_role`  → DML sobre las 19: es el rol del seed, del cron de expiración de reservas (S6)
--                     y de los jobs.
--
-- **BYPASSRLS no otorga privilegios.** RLS y GRANT son dos capas distintas y se evalúan las dos:
-- primero el GRANT decide si podés tocar la tabla, después la policy decide qué filas ves (y
-- BYPASSRLS sólo saltea ese segundo paso). Un rol con BYPASSRLS y sin GRANT recibe
-- `42501 permission denied for table listings` y no lee UNA fila. Esta migración decía lo
-- contrario en un comentario y por eso no otorgaba nada: el cron de reservas no habría fallado
-- en CI, habría fallado el día que se prendiera en producción. Verificado contra Postgres real
-- (`has_table_privilege('service_role','listings','SELECT')` = false sin las líneas de abajo).

-- 2.a · DEFAULT PRIVILEGES: el invariante tiene que sobrevivir a la próxima migración ─────────
-- Un proyecto Supabase real trae `ALTER DEFAULT PRIVILEGES ... IN SCHEMA public GRANT ALL ON
-- TABLES TO anon, authenticated, service_role` puestos por el rol dueño. Eso significa que
-- `REVOKE ALL ON ALL TABLES` limpia SÓLO las tablas que existen en este instante: la tabla que
-- cree la migración 0007 nace con GRANT a `anon` otra vez. "anon no recibe nada" es un invariante
-- del proyecto, no una limpieza puntual, así que se arregla en la fábrica y no en el producto.
--
-- A `authenticated` también se le sacan los defaults, por la misma razón y una más: una tabla que
-- nace con GRANT automático es una tabla legible por todo usuario logueado ANTES de que alguien
-- le escriba una policy. Acá los GRANT son explícitos o no son.
-- A `service_role` se le dejan puestos a propósito: es el rol de servidor de confianza y ningún
-- job debería romperse porque alguien olvidó una línea de GRANT.
--
-- El bloque itera sobre los roles dueños plausibles (el que corre la migración, `postgres`,
-- `supabase_admin` y cualquiera que ya tenga un default ACL en `public`), porque
-- ALTER DEFAULT PRIVILEGES sólo afecta a los objetos que crea el rol nombrado: un REVOKE contra
-- el rol equivocado es un no-op silencioso. Si falta la membresía, avisa en vez de mentir.
DO $do$
DECLARE
  owner_role text;
  owner_roles text[];
BEGIN
  SELECT coalesce(array_agg(DISTINCT r), '{}'::text[]) INTO owner_roles
  FROM unnest(
    ARRAY[current_user::text, session_user::text, 'postgres', 'supabase_admin']
    || coalesce(
         (SELECT array_agg(DISTINCT pg_get_userbyid(defaclrole))
          FROM pg_default_acl WHERE defaclnamespace = 'public'::regnamespace),
         '{}'::text[])
  ) AS r
  WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r);

  FOREACH owner_role IN ARRAY owner_roles LOOP
    IF NOT pg_has_role(current_user, owner_role, 'USAGE') THEN
      RAISE WARNING
        '0001: sin membresia en %, no se tocan sus DEFAULT PRIVILEGES en public. Las tablas que cree % pueden nacer con GRANT a anon.',
        owner_role, owner_role;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM anon', owner_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon', owner_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon', owner_role);

    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated', owner_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated', owner_role);

    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role', owner_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO service_role', owner_role);
  END LOOP;
END
$do$;--> statement-breakpoint

-- 2.b · anon: se le saca lo que ya tenga sobre lo que ya existe ───────────────────────────────
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;--> statement-breakpoint
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;--> statement-breakpoint
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;--> statement-breakpoint

-- 2.c · authenticated: DML tabla por tabla sobre las 17 de negocio ────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "tenants" TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "users" TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "memberships" TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "locations" TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "fx_settings" TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "listings" TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "listing_photos" TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "listing_events" TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "wa_click_events" TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "reservations" TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "sales" TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "tradein_leads" TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "tradein_checklists" TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "chatbot_threads" TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "chatbot_messages" TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "subscriptions" TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "entitlements" TO authenticated;--> statement-breakpoint

-- Catálogo GLOBAL: **sólo lectura** para `authenticated`.
-- Es lo que reemplaza a la RLS que estas dos tablas no tienen. Sin `tenant_id` no hay nada que
-- aislar (un iPhone 14 Pro es el mismo para los 100 tenants), pero sí hay algo que proteger:
-- que un usuario cualquiera no pueda **escribir** el catálogo de todos los demás.
GRANT SELECT ON TABLE "catalog_models" TO authenticated;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON TABLE "catalog_models" FROM authenticated;--> statement-breakpoint
GRANT SELECT ON TABLE "catalog_faqs" TO authenticated;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON TABLE "catalog_faqs" FROM authenticated;--> statement-breakpoint
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;--> statement-breakpoint

-- 2.d · service_role: el rol de los jobs ──────────────────────────────────────────────────────
-- Tabla por tabla, mismo estilo explícito que `authenticated`, para que se lea en el diff qué
-- puede tocar un job y no haya que ir a buscarlo a un `ALL TABLES`.
-- Quién usa esto, concretamente:
--   · el cron de expiración de reservas (S6): SELECT + UPDATE sobre reservations y listings.
--   · el seed / los backfills: INSERT y DELETE sobre todo, incluido el catálogo global.
--   · los webhooks de Mercado Pago: UPDATE sobre subscriptions y entitlements, sin sesión de usuario.
-- Es DML, no DDL, y no incluye TRUNCATE ni TRIGGER: un job no altera la forma de la base.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "tenants" TO service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "users" TO service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "memberships" TO service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "locations" TO service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "fx_settings" TO service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "listings" TO service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "listing_photos" TO service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "listing_events" TO service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "wa_click_events" TO service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "reservations" TO service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "sales" TO service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "tradein_leads" TO service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "tradein_checklists" TO service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "chatbot_threads" TO service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "chatbot_messages" TO service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "subscriptions" TO service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "entitlements" TO service_role;--> statement-breakpoint

-- Catálogo global: acá sí escribe, porque el seed y el update de embeddings lo pueblan con
-- `service_role` (`src/seed.ts`, `drizzle/optional/0100_pgvector_embeddings.sql`).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "catalog_models" TO service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "catalog_faqs" TO service_role;--> statement-breakpoint

-- Hoy no hay ni una sequence en `public` (todos los ids son `uuid` con default, `db-agent` §6),
-- así que esto es un no-op verificado: está para que el día que entre un contador (nro. de venta
-- correlativo, por ejemplo) el seed no se caiga con `permission denied for sequence`.
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO service_role;--> statement-breakpoint

-- ── 3 · Columnas sensibles ───────────────────────────────────────────────────────────────
-- Cada una lleva el marcador exacto que exige `db-agent` §4 y, además, un COMMENT consultable.
-- SENSITIVE: never in public DTO
COMMENT ON COLUMN "listings"."imei" IS 'SENSITIVE: never in public DTO. el IMEI no sale de la vidriera, ni de un log, ni del contexto del chatbot (CLAUDE.md 8).';--> statement-breakpoint
-- SENSITIVE: never in public DTO
COMMENT ON COLUMN "listings"."cost_usd" IS 'SENSITIVE: never in public DTO. el seller no ve costo. Nunca. Ni en el payload (CLAUDE.md 9).';--> statement-breakpoint
-- SENSITIVE: never in public DTO
COMMENT ON COLUMN "listings"."margin_usd" IS 'SENSITIVE: never in public DTO. derivada de cost_usd: filtra el costo por resta.';--> statement-breakpoint
-- SENSITIVE: never in public DTO
COMMENT ON COLUMN "listings"."supplier" IS 'SENSITIVE: never in public DTO. proveedor: dato competitivo del reseller.';--> statement-breakpoint
-- SENSITIVE: never in public DTO
COMMENT ON COLUMN "listings"."internal_notes" IS 'SENSITIVE: never in public DTO. notas del dueno, escritas asumiendo que nadie mas las lee.';--> statement-breakpoint
-- SENSITIVE: never in public DTO
COMMENT ON COLUMN "sales"."cost_usd" IS 'SENSITIVE: never in public DTO. el seller no ve costo. Nunca. Ni en el payload.';--> statement-breakpoint
-- SENSITIVE: never in public DTO
COMMENT ON COLUMN "sales"."margin_usd" IS 'SENSITIVE: never in public DTO. derivada de cost_usd: filtra el costo por resta.';--> statement-breakpoint
-- SENSITIVE: never in public DTO
COMMENT ON COLUMN "sales"."internal_notes" IS 'SENSITIVE: never in public DTO. notas del dueno.';--> statement-breakpoint
-- SENSITIVE: never in public DTO
COMMENT ON COLUMN "tradein_leads"."offer_usd" IS 'SENSITIVE: never in public DTO. lo ofrecido en el canje ES el costo de la unidad que se crea.';--> statement-breakpoint
-- SENSITIVE: never in public DTO
COMMENT ON COLUMN "tradein_leads"."internal_notes" IS 'SENSITIVE: never in public DTO. notas del dueno.';--> statement-breakpoint
-- SENSITIVE: never in public DTO
COMMENT ON COLUMN "tradein_leads"."customer_name" IS 'SENSITIVE: never in public DTO. dato personal del visitante.';--> statement-breakpoint
-- SENSITIVE: never in public DTO
COMMENT ON COLUMN "tradein_leads"."customer_wa_phone" IS 'SENSITIVE: never in public DTO. dato personal del visitante.';--> statement-breakpoint
-- SENSITIVE: never in public DTO
COMMENT ON COLUMN "listing_photos"."master_key" IS 'SENSITIVE: never in public DTO. key del master en el bucket PRIVADO istock-originals (ADR-006).';--> statement-breakpoint

-- ── 4 · Documentación de la excepción global, en la propia base ──────────────────────────
COMMENT ON TABLE "catalog_models" IS 'GLOBAL: sin tenant_id y sin RLS a proposito. Un modelo de Apple es un hecho del mundo, identico para los 100 tenants: no hay dato de nadie que aislar. Se protege con GRANT SELECT (sin escritura) y se puebla por seed con service_role. Si un tenant necesitara un modelo propio, NO se le agrega tenant_id a esta tabla: se crea tenant_catalog_overrides con tenant_id + RLS.';--> statement-breakpoint
COMMENT ON TABLE "catalog_faqs" IS 'GLOBAL: sin tenant_id y sin RLS a proposito. Ver catalog_models. Alimenta los 3 chunks del mismo catalog_model que entran al contexto del chatbot.';--> statement-breakpoint
COMMENT ON TABLE "users" IS 'Sin tenant_id pero CON RLS: la identidad es de Supabase Auth (users.id = auth.users.id) y la relacion con el tenant vive en memberships (ADR-005). Aislada por auth.uid() + membresia compartida, no por tenant_id.';--> statement-breakpoint
COMMENT ON TABLE "tenants" IS 'Unidad de aislamiento. Es la unica tabla de negocio cuyo identificador de tenant es su propio id: sus policies usan id = claim, no tenant_id = claim.';
