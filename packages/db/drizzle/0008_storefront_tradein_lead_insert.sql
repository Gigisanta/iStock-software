-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 0008 · El lead de canje entra desde la vidriera con el rol `anon`, igual que el click de S4.
--        Es la SEGUNDA (y por ahora última) escritura sin autenticar del producto.
--
-- ── Por qué `anon` y no un handler con `service_role` (LEAD, S8 · no se reabre) ────────────
-- Mismo razonamiento que 0004, y no es analogía: es la misma pregunta. Con `service_role` la
-- garantía de que la fila cae en el tenant correcto vive **entera** en el handler, y
-- `service_role` tiene BYPASSRLS: no hay segunda capa justo en un endpoint sin login al que le
-- puede pegar cualquiera. Con `anon` + policy, el `WITH CHECK` lo evalúa el planner en CADA
-- insert; un bug del handler —o un `tenant_id` metido en el body— termina en `42501` y en una
-- fila que no existe, no en el inbox de otro reseller.
--
-- ── Qué gana `anon` sobre `tradein_leads`, exactamente ────────────────────────────────────
-- INSERT de NUEVE columnas, y ninguna más. Lo que queda AFUERA del privilegio, por grupos, que
-- es donde está el diseño:
--
--   · `id`, `created_at`, `updated_at` — salen de sus defaults (`gen_random_uuid()`, `now()`)
--     para que **no se puedan forjar**. Misma regla que 0004: un visitante no elige el id de su
--     lead ni lo antedata para colarse arriba en el inbox.
--   · `status` — default `'new'`. Un visitante **no elige en qué estado entra su propio lead**.
--     Sin esto, un `curl` deja un lead en `accepted` y se salta la evaluación del dueño entera.
--   · `offer_usd`, `internal_notes` — son **el costo y las notas del dueño** (`CLAUDE.md` §0.9 y
--     §2, y están marcadas `SENSITIVE` en 0001). `offer_usd` es lo que el reseller ofrece pagar,
--     o sea el costo de la unidad que va a nacer de este canje: que el visitante lo escriba es
--     escribir el costo de una unidad de stock desde afuera.
--   · `created_listing_id`, `handled_by` — los escribe `accept-to-stock`, del lado autenticado,
--     cuando el dueño acepta el canje. Son el resultado de una decisión que el visitante no tomó.
--
-- Y como en 0004: **cero** SELECT, cero UPDATE, cero DELETE. Ni GRANT ni policy. El visitante
-- deja su canje y no lee ninguno — **ni el propio**. Consecuencia práctica para quien escriba el
-- handler: un `insert ... returning id` desde la vidriera recibe `42501`. Es correcto y NO se
-- arregla con un privilegio más; si el form necesita confirmar algo, que confirme sin el id.
--
-- ── Los CHECK, que en 0004 no hacían falta y acá sí ───────────────────────────────────────
-- El click de WhatsApp escribe un enum y dos uuids: la forma la garantiza el tipo. Acá el
-- visitante escribe **texto libre**, y entre un `curl` y la tabla el handler es la ÚNICA otra
-- capa. Zod en el borde va a exigir lo mismo (eso es de `storefront-agent`), pero una afirmación
-- que vive sólo en el borde se pierde el día que aparece un segundo caller — misma doctrina que
-- ADR-025. Los límites son de tamaño y de rango, no de formato: validar un teléfono argentino a
-- fuerza de regex en el motor es la clase de constraint que después nadie puede migrar.
--
-- Los cuatro campos opcionales van detrás de un `is null or` porque `null` es un lead legítimo:
-- el visitante muchas veces no sabe los GB ni el % de batería, y un canje sin esos datos igual
-- vale — la evaluación real es presencial y está en `tradein_checklists`.
--
-- ── Lo que el lint dice de esto, a propósito ──────────────────────────────────────────────
-- `scripts/rls-lint.mjs` (del LEAD, ADR-022) da ROJO con este archivo: la regla 0026 tiene a
-- `wa_click_events` como allowlist cerrada de la escritura sin autenticar, y la 0020 prohíbe
-- `customer_name` / `customer_wa_phone` en un GRANT a `anon`. Ese rojo es la regla funcionando:
-- existe para que esta excepción no se copie a una tercera tabla sin que nadie la mire. El LEAD
-- la está mirando y ajusta el gate; `db-agent` no toca el lint (pide, no edita).
-- ═══════════════════════════════════════════════════════════════════════════════════════════

-- ── 1 · Tamaño y rango en el motor (emitido por `drizzle-kit generate`) ───────────────────
ALTER TABLE "tradein_leads" ADD CONSTRAINT "tradein_leads_customer_name_len" CHECK (length("tradein_leads"."customer_name") between 1 and 80);
--> statement-breakpoint
ALTER TABLE "tradein_leads" ADD CONSTRAINT "tradein_leads_customer_wa_phone_len" CHECK (length("tradein_leads"."customer_wa_phone") between 6 and 25);
--> statement-breakpoint
ALTER TABLE "tradein_leads" ADD CONSTRAINT "tradein_leads_model_text_len" CHECK (length("tradein_leads"."model_text") between 1 and 120);
--> statement-breakpoint
ALTER TABLE "tradein_leads" ADD CONSTRAINT "tradein_leads_color_len" CHECK ("tradein_leads"."color" is null or length("tradein_leads"."color") <= 40);
--> statement-breakpoint
ALTER TABLE "tradein_leads" ADD CONSTRAINT "tradein_leads_notes_len" CHECK ("tradein_leads"."notes" is null or length("tradein_leads"."notes") <= 500);
--> statement-breakpoint
ALTER TABLE "tradein_leads" ADD CONSTRAINT "tradein_leads_battery_pct_range" CHECK ("tradein_leads"."battery_pct" is null or "tradein_leads"."battery_pct" between 0 and 100);
--> statement-breakpoint
ALTER TABLE "tradein_leads" ADD CONSTRAINT "tradein_leads_storage_gb_range" CHECK ("tradein_leads"."storage_gb" is null or "tradein_leads"."storage_gb" between 1 and 4096);--> statement-breakpoint

-- ── 2 · El privilegio, que es de COLUMNA y son NUEVE ──────────────────────────────────────
-- Se revoca primero por idempotencia y para que no sobreviva ningún privilegio de TABLA puesto a
-- mano: uno de tabla alcanzaría a `offer_usd`, a `status` y a toda columna **futura** de la
-- tabla, que es exactamente lo que este archivo existe para impedir.
REVOKE ALL ON TABLE "tradein_leads" FROM anon;--> statement-breakpoint
GRANT INSERT ("tenant_id", "customer_name", "customer_wa_phone", "model_text", "storage_gb", "color", "declared_condition", "battery_pct", "notes") ON TABLE "tradein_leads" TO anon;--> statement-breakpoint

-- ── 3 · Documentación consultable desde la propia base ────────────────────────────────────
COMMENT ON TABLE "tradein_leads" IS 'Inbox de canje. El rol anon inserta 9 columnas desde la vidriera (tenant_id, customer_name, customer_wa_phone, model_text, storage_gb, color, declared_condition, battery_pct, notes) y NO lee, ni corrige, ni borra: ni siquiera el lead que acaba de dejar. Fuera del privilegio quedan id/created_at/updated_at (defaults, no se forjan), status (default new: el visitante no elige el estado de su lead), offer_usd e internal_notes (SENSITIVE: son el costo y las notas del dueno) y created_listing_id/handled_by (los escribe accept-to-stock del lado autenticado). Trae PII del visitante: nunca a la vidriera, ni al chatbot, ni a un log.';--> statement-breakpoint

-- ── 4 · La policy (emitida por `drizzle-kit generate` desde `src/schema/tradein.ts`) ───────
-- `tenant_id = (select public.storefront_tenant_id())`: el tenant sale del **claim del slug**,
-- que lo escribió `proxy.ts` desde el host, jamás del body. Sin claim la función devuelve NULL,
-- la comparación da NULL y el insert se rechaza: falla CERRADO. Eso también tapa PostgREST — la
-- `anon key` vive en el browser, pero un JWT firmado por Supabase para `anon` no puede traer
-- `app_metadata.storefront_slug`.
-- A diferencia de 0004 no hay un `exists` sobre `listings`: un canje no cuelga de ninguna ficha.
CREATE POLICY "tradein_leads_storefront_insert" ON "tradein_leads" AS PERMISSIVE FOR INSERT TO "anon" WITH CHECK (tenant_id = (select public.storefront_tenant_id()));
