---
description: Auditoría de costo de infra - modelo por tenant, piso de plataforma y proyección a 100 tenants. Actualiza docs/COST.md.
argument-hint: "[slice-id | full]"
---

# /istock-cost

Auditoría de costo. Alcance: `$ARGUMENTS` (sin argumento → `full`).

## Objetivo duro
**Costo marginal de infra < USD 0.50 / mes por tenant activo, hasta 100 tenants.**
El piso fijo de plataforma se documenta **aparte** del marginal. No los mezcles.

## Qué produce
Lanzá `cost-auditor`, que actualiza `docs/COST.md` con:

1. **Piso mensual de MaatWork** — Supabase Pro + Vercel Pro + Cloudflare (≈ USD 50–70).
   Con la línea de cada servicio y su fuente.
2. **Costo marginal por tenant `base` vs `negocio`** — con la aritmética a la vista y los supuestos
   explícitos: listings por tenant, fotos por listing, pageviews/mes, msgs de chat/día.
3. **Techo de LLM a 50 tenants premium** — tokens/día × precio verificado en `docs/research/`.
4. **La métrica que avisa antes de que explote** — una sola, por vector:
   egress y ops de R2 · tokens/día · CPU-ms de function · filas y conexiones de Postgres.
5. **Escenario de estrés** — un tenant con 200 equipos y una vidriera que se hace viral un día.
   ¿Cuánto cuesta ese día? ¿Qué se rompe primero?

## Fallos automáticos (bloquean merge)
- Fotos por Supabase Storage público o Vercel Image Optimization.
- Original >500KB llegando al browser.
- LLM por pageview, o modelo frontier en hot path.
- Realtime abierto a anónimos.
- Vidriera pegándole a Postgres en cada hit.
- Worker 24/7 que podría ser un cron.
- **Spend cap de Supabase apagado.**

## Salida al humano
```
DELTA_POR_TENANT_MES: USD X.XX
PISO_PLATAFORMA_MES: USD XX
VECTOR_MAS_RIESGOSO: <cuál>
METRICA_A_VIGILAR: <una>
VERDICT: PASS | FAIL
```
