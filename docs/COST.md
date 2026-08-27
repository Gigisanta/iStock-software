# COST — modelo de costo de infraestructura

_Owner: `cost-auditor`. **Preliminar del LEAD en FASE 0.** Se recalcula en FASE 1 con precios
verificados en `docs/research/`. Todo número sin fuente está marcado `[EST]` y **no** es evidencia._

## Objetivo duro
> **Costo marginal de infra < USD 0.50 / mes por tenant activo, hasta 100 tenants.**

El **piso fijo** de la plataforma se cuenta **aparte** del marginal. No mezclar.

## 1. Piso fijo de plataforma `[EST]`
| servicio | plan | USD/mes | por qué |
|---|---|---|---|
| Supabase | Pro | ~25 | RLS, backups, sin pausa por inactividad, **spend cap ON** |
| Vercel | Pro | ~20 | wildcard de dominios, ISR, cron |
| Cloudflare R2 | pago por uso | ~1–5 | storage; **egress $0** |
| Sentry + PostHog | free | 0 | |
| **Total** | | **~46–50** | `[R1][R2]` a verificar en FASE 1 |

A 100 tenants el piso se diluye a **~USD 0.50/tenant**; el margen real depende del marginal (§2).

## 2. Costo marginal por tenant `[EST]` — a recalcular en FASE 1

**Supuestos explícitos** (si cambian, cambia todo):
- 60 listings activos por tenant
- 4 fotos por listing → 3 variantes = 12 objetos por listing
- 3.000 pageviews/mes por vidriera
- 15 imágenes `card` cargadas por sesión
- plan `negocio`: 40 mensajes de chat/día (soft cap)

| vector | cálculo | USD/mes `[EST]` |
|---|---|---|
| R2 storage | 60 × 4 × (150KB+25KB+400KB) ≈ 140MB → ~0.021 USD/GB-mes | ~0.003 |
| R2 egress | **0 por diseño** | **0** |
| R2 Class B (reads) | ~45k reads/mes → tarifa por millón | ~0.02 |
| R2 Class A (writes) | ~720 writes/mes (sólo al cargar stock) | ~0.00 |
| Postgres | ~5k filas; **95% de hits cacheados** → pocas queries | ~0 marginal |
| Vercel functions | ~150 invocaciones/mes (5% de 3.000) + cron | ~0 marginal |
| LLM (`base`) | **widget ausente** | **0** |
| LLM (`negocio`) | 1200 quedan en ~1200 in + 180 out × 1.200 msgs/mes | `[R3]` |
| **Marginal `base`** | | **~USD 0.03** |
| **Marginal `negocio`** | | **0.03 + LLM `[R3]`** |

**Margen de seguridad:** contra un objetivo de USD 0.50, el `base` está ~15× abajo.
Eso es intencional: el margen absorbe el tenant atípico, no el diseño flojo.

## 3. Techo de LLM a 50 tenants `negocio` `[R3]`
```
50 tenants × 40 msgs/día × 30 días = 60.000 msgs/mes
60.000 × 1.200 tokens in  =  72M tokens in
60.000 ×   180 tokens out = 10.8M tokens out
```
Con Flash-Lite, esto debe quedar en **decenas de USD/mes, no cientos**.
Si el cálculo con precios verificados da > USD 100/mes, se baja el soft cap o se recorta el RAG.
**Bloqueado hasta `docs/research/llm-pricing.md`.**

## 4. Escenario de estrés — la vidriera se hace viral un día
50.000 pageviews en 24h en un tenant:
| vector | efecto |
|---|---|
| Postgres | ~0 (cache) — **si** el ISR está bien |
| R2 egress | **0** por diseño |
| R2 Class B | ~750k reads → **el vector que más sube**, aun así centavos |
| Vercel | invocaciones sólo en misses |
| LLM | acotado por el soft cap de 40 msgs/tenant/día |

**Lo que se rompe primero:** la tasa de hits que llega a Postgres, si una mutación tira el cache
en pleno pico. Por eso el `revalidateTag` es quirúrgico por tenant y no un `revalidatePath('/')`.

## 5. La métrica a vigilar (una por vector)
| vector | métrica | alarma |
|---|---|---|
| imágenes | **R2 Class B ops/día** | crecimiento no lineal contra pageviews |
| DB | **% de hits de vidriera que llegan a Postgres** | **> 5%** |
| LLM | **tokens/día por tenant** | > 1200 in por turno, o modelo frontier en el log |
| functions | **CPU-ms por pageview** | cualquier tendencia al alza sin feature nueva |
| storage | **GB por tenant** | huérfanos de listings borrados |

## 6. Fallos automáticos (bloquean merge)
Fotos por Supabase Storage público o Vercel Image Optimization · original >500KB al browser ·
LLM por pageview o modelo frontier en hot path · Realtime para anónimos · vidriera pegándole a
Postgres en cada hit · worker 24/7 en vez de cron · **spend cap de Supabase apagado**.

## 7. Estado
`PRELIMINAR` — todos los `[EST]` se reemplazan por cifras con fuente en FASE 1.
Bloqueado por: `[R1]` Vercel · `[R2]` R2/imágenes · `[R3]` LLM.
