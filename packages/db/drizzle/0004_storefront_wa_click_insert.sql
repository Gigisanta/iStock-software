-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 0004 · La ÚNICA escritura sin autenticar de todo el producto: el click del botón de WhatsApp.
--        Se hace con un INSERT de `anon` acotado, no con una ruta de `service_role`.
--
-- ── Por qué `anon` y no `service_role` (decidido por el LEAD en S4, no se reabre) ──────────
-- Las dos formas "funcionan" el día que se escriben. La diferencia aparece el día que el handler
-- tiene un bug:
--   · Con `service_role`, la garantía de que la fila cae en el tenant correcto vive **entera** en
--     el código de aplicación. `service_role` tiene BYPASSRLS: si el handler toma el tenant del
--     body, o mezcla dos requests, la base escribe lo que le pidan y no hay segunda capa. El
--     invariante "sin RLS no hay merge" (CLAUDE.md §7) quedaría suspendido justo en el único
--     endpoint del producto al que le puede pegar cualquiera, sin login y sin rate limit de sesión.
--   · Con `anon` + policy, el `WITH CHECK` lo evalúa el planner en **cada** insert. El handler deja
--     de ser el que garantiza el aislamiento y pasa a ser sólo el que lo pide. Un bug ahí termina
--     en `42501` y en una fila que no existe, no en una fila en la cuenta de otro.
--
-- ── Qué gana `anon`, exactamente ──────────────────────────────────────────────────────────
-- Un agujero de alfiler, y esa es la mitad del valor de esta migración:
--   · INSERT de **tres columnas** (`tenant_id`, `listing_id`, `source`) sobre **una** tabla.
--   · `id` y `created_at` quedan AFUERA del privilegio a propósito: salen de sus defaults
--     (`gen_random_uuid()` y `now()`) y por lo tanto **no se pueden forjar**. Un visitante no elige
--     el id de su evento ni antedata un click.
--   · Ninguna otra operación sobre la tabla. Ni privilegio ni policy: el visitante escribe su
--     click y no lee ninguno — **ni el propio**. Consecuencia práctica para quien escriba el
--     handler: un `insert ... returning id` desde la vidriera recibe `42501`. Es correcto y no se
--     arregla con un privilegio más; el beacon no necesita saber qué escribió.
--   · Lo que sigue prohibido para siempre, y lo verifica `scripts/rls-lint.mjs` (regla 0026) más
--     el test de polaridad `src/rls-anon-wa-click.test.ts`: leer, corregir o borrar clicks.
--
-- ── El `WITH CHECK`, cláusula por cláusula ────────────────────────────────────────────────
--   1. `tenant_id = (select public.storefront_tenant_id())` — el tenant sale del **claim del
--      slug**, que lo escribió `proxy.ts` desde el host, jamás del body del request. Sin claim la
--      función devuelve NULL, la comparación da NULL, y el insert se rechaza: falla cerrado.
--   2. `listing_id is null or exists (…)` — el `null` es un caso legítimo y documentado en
--      `src/schema/events.ts`: *"null si el click salió del footer"*. Ese click no sale de ninguna
--      ficha. Sin el `or`, el `exists` daría falso y el footer no podría registrar nada.
--   3. `exists (select 1 from listings l where l.id = listing_id and l.tenant_id = …)` — si el
--      evento nombra una ficha, esa ficha es **de ese mismo tenant**. Sin esto, la vidriera de A
--      podría escribir en su propia cuenta un evento que apunta a una unidad de B, que es
--      contaminación de datos aunque no sea escritura cross-tenant.
--
-- Los dos prerrequisitos de esa subconsulta ya estaban puestos por 0002 y no hay que agregar
-- nada: `anon` tiene el privilegio de columna sobre `listings."id"` y `listings."tenant_id"`
-- (bloque 3.b), y `public.storefront_tenant_id()` tiene EXECUTE (bloque 1). Y hay un efecto de
-- borde deseado: el `exists` lee `listings` **como `anon`**, o sea que pasa por
-- `listings_storefront_anon_select`. Una unidad en `draft`, o de un tenant `suspended`, tampoco
-- sirve de destino — si no está publicada, no hay botón desde el cual apretar.
--
-- La `CREATE POLICY` del final la emitió `drizzle-kit generate` desde `src/schema/events.ts` y se
-- deja textual, igual que en 0002: el schema declarativo es la fuente de verdad, este archivo es
-- su registro versionado.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

-- ── 1 · El privilegio, que es de COLUMNA ──────────────────────────────────────────────────
-- Se revoca primero para que el archivo sea idempotente y para que no sobreviva ningún privilegio
-- de TABLA otorgado a mano. Un privilegio de tabla haría legible el histórico de clicks del tenant
-- a cualquiera que sepa mandar un `select`; el de columna ni siquiera compila para leer.
REVOKE ALL ON TABLE "wa_click_events" FROM anon;--> statement-breakpoint
GRANT INSERT ("tenant_id", "listing_id", "source") ON TABLE "wa_click_events" TO anon;--> statement-breakpoint

-- ── 2 · Documentación consultable desde la propia base ────────────────────────────────────
COMMENT ON TABLE "wa_click_events" IS 'Unica escritura sin autenticar del producto. El rol anon inserta 3 columnas (tenant_id, listing_id, source) y NO lee, ni corrige, ni borra. id y created_at salen de sus defaults para que no se puedan forjar. Sin PII: ni IP, ni user agent, ni telefono.';--> statement-breakpoint

-- ── 3 · Policy emitida por `drizzle-kit generate` (fuente de verdad: src/schema/events.ts) ─
CREATE POLICY "wa_click_events_storefront_insert" ON "wa_click_events" AS PERMISSIVE FOR INSERT TO "anon" WITH CHECK (tenant_id = (select public.storefront_tenant_id()) and (listing_id is null or exists (select 1 from listings l where l.id = listing_id and l.tenant_id = (select public.storefront_tenant_id()))));
