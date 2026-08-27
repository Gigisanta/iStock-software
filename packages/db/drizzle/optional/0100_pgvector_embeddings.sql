-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 0100 · OPCIONAL · embeddings del catálogo GLOBAL con pgvector.
--
-- NO está en el journal de drizzle a propósito: `pnpm --filter @istock/db migrate` no la aplica.
-- Se aplica a mano con `pnpm --filter @istock/db migrate:pgvector` (o `psql -f`) allá donde la
-- extensión exista — Supabase la tiene; el Postgres 16 de desarrollo local, no.
--
-- Por qué separada y no condicional dentro de 0000: una migración base que falla en local es una
-- migración que nadie corre, y entonces la RLS deja de probarse contra Postgres real. El
-- aislamiento entre tenants vale más que tener los embeddings el día 1.
--
-- Por qué el embedding vive en tablas GLOBALES y no por tenant: el catálogo es el mismo para los
-- 100 tenants. Un embedding por tenant sería pagar 100 veces el mismo vector y tener 100 copias
-- que se desincronizan. Los embeddings se calculan SÓLO en el seed/update del catálogo, nunca
-- por request (CLAUDE.md §3, ADR-004).
--
-- 768 dimensiones = `gemini-embedding-001` con `outputDimensionality: 768`.
-- UNVERIFIED: la dimensión exacta la fija `packages/ai` cuando se implemente FASE 5; si cambia,
-- se cambia acá y se re-embebe el catálogo (son ~40 filas, no es una migración cara).
-- ═══════════════════════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "catalog_models" ADD COLUMN IF NOT EXISTS "embedding" vector(768);
ALTER TABLE "catalog_faqs"   ADD COLUMN IF NOT EXISTS "embedding" vector(768);

-- HNSW sobre coseno. Listas chicas: el catálogo son decenas de filas, no millones.
CREATE INDEX IF NOT EXISTS "catalog_models_embedding_idx"
  ON "catalog_models" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX IF NOT EXISTS "catalog_faqs_embedding_idx"
  ON "catalog_faqs" USING hnsw ("embedding" vector_cosine_ops);

COMMENT ON COLUMN "catalog_models"."embedding" IS 'Calculado en el seed/update del catalogo. NUNCA por request.';
COMMENT ON COLUMN "catalog_faqs"."embedding"   IS 'Calculado en el seed/update del catalogo. NUNCA por request.';
