# DECISIONS — ADRs

_Owner: `architect`. Una decisión que no está acá **no existe**._
_Formato en `.claude/agents/architect.md`._

---

## ADR-001 — Un solo proyecto Supabase con RLS, no schema-per-tenant
- **Estado:** aceptada · **Fecha:** 2026-08-27 · **Autor:** LEAD (FASE 0)
- **Contexto:** hasta 100 tenants con costo marginal < USD 0.50/mes por tenant.
- **Decisión:** un proyecto Postgres, `tenant_id` en toda tabla de negocio, RLS forzada.
- **Alternativas descartadas:** schema-per-tenant (migraciones × N, cache de plan de consultas
  degradado, operativa insostenible a 100 tenants) · un proyecto Supabase por cliente
  (piso de costo por tenant ≥ USD 25/mes: rompe el objetivo por 50×).
- **Consecuencias:** RLS es el único límite de seguridad real → **sin RLS no hay merge**, y todo
  test de tenant corre contra Postgres real.
- **Verificación:** `pnpm --filter @istock/db test -- rls` + query de `pg_class` con `relrowsecurity=false` → 0 filas.

## ADR-002 — Fotos en Cloudflare R2, nunca Vercel ni Supabase Storage
- **Estado:** aceptada · **Fecha:** 2026-08-27 · **Autor:** LEAD (FASE 0)
- **Contexto:** las fotos son el 95%+ de los bytes de la vidriera. El egress es el vector que puede
  hacer explotar el costo unitario sin aviso.
- **Decisión:** R2 (egress $0) + CDN de Cloudflare. Resize server-side a 3 variantes antes de subir.
- **Alternativas descartadas:** Supabase Storage público (egress pago, y compite con el presupuesto
  de la DB) · Vercel Image Optimization (se paga por transformación, escala con pageviews, no con
  stock) · Cloudinary pago (fuera del stack cerrado).
- **Consecuencias:** `packages/media` es el **único** que conoce el bucket. Nadie arma URLs a mano.
- **Verificación:** `pnpm --filter @istock/media test` (presupuesto de bytes por variante).

## ADR-003 — Vidriera cacheada por ISR + tags, no consulta por request
- **Estado:** aceptada · **Fecha:** 2026-08-27 · **Autor:** LEAD (FASE 0)
- **Contexto:** una vidriera viral no puede convertirse en una factura de Postgres.
- **Decisión:** ISR / cache de CDN con `revalidateTag('storefront:{slug}')` disparado por el panel.
- **Alternativas descartadas:** SSR por request (costo lineal en tráfico) · client-side fetch
  (peor SEO, peor LCP, más costo) · Realtime para anónimos (conexiones concurrentes pagas).
- **Consecuencias:** toda mutación de stock **debe** invalidar. Olvidarlo muestra stock vendido:
  es un bug de slice, no un detalle.
- **Verificación:** cargar la ficha 10× → 0 queries después de la primera.

## ADR-004 — LLM barato y fuera del hot path
- **Estado:** aceptada · **Fecha:** 2026-08-27 · **Autor:** LEAD (FASE 0)
- **Contexto:** el chatbot es un feature del plan `negocio` (~USD 35), no puede costar USD 5/tenant.
- **Decisión:** Gemini Flash-Lite primario, Groq 8B fallback, dieta de 1200/180 tokens, sin thinking.
  El LLM sólo corre ante un mensaje explícito del visitante, nunca por pageview.
- **Alternativas descartadas:** Claude/GPT frontier (1–2 órdenes de magnitud más caro para
  responder "¿tiene batería buena?") · embeddings por request (se hacen en el seed).
- **Consecuencias:** la calidad depende de la **dieta de contexto**, no del modelo → RAG chico y
  handoff agresivo a WhatsApp.
- **Verificación:** `pnpm --filter @istock/ai eval` + USD/1000 msgs medido en `docs/CHATBOT.md`.
- **Pendiente `[R3]`:** IDs exactos y precios vigentes → `docs/research/llm-pricing.md`.

---

## ADRs pendientes de FASE 1
| id | tema | depende de |
|---|---|---|
| ADR-005 | forma del claim de tenant para RLS (JWT custom vs `memberships`) | R7 |
| ADR-006 | transformación de imágenes: sharp propio vs transform sobre R2 | R2 |
| ADR-007 | mecanismo de wildcard + estrategia de ISR concreta en Vercel | R1 |
| ADR-008 | modelo de integración con MP Subscriptions | R4 |
| ADR-009 | representación del resultado ENACOM (enum + link) | R5 |
