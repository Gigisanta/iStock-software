# /docs — índice

| doc | qué contiene | lo escribe | cuándo se actualiza |
|---|---|---|---|
| [PRODUCT.md](PRODUCT.md) | producto ejecutable: ICP, recorrido que factura, planes, fuera de alcance | `product-scribe` | cambio de producto (raro — no se reabre) |
| [DOMAIN.md](DOMAIN.md) | glosario, entidades, máquina de estados, FX, visibilidad por rol, `publicListingDTO` | `product-scribe` + `domain-agent` | cada slice que toca reglas de negocio |
| [ARCHITECTURE.md](ARCHITECTURE.md) | monorepo, host→tenant, cache, camino de una foto, RLS, límites de confianza | LEAD en FASE 1, después `architect` | **FASE 1 cerrada** |
| [DECISIONS.md](DECISIONS.md) | ADRs numeradas con alternativas descartadas y verificación | LEAD en FASE 1, después `architect` | **ADR-001..010; 008 y 010 abiertas** |
| [SLICE_BOARD.md](SLICE_BOARD.md) | **estado de la verdad del avance** + blockers abiertos | `docs-keeper` | cada slice |
| [TEST_MATRIX.md](TEST_MATRIX.md) | unit / RLS / e2e / seguridad + cobertura de reglas | `qa-agent` | cada test nuevo |
| [COST.md](COST.md) | piso de plataforma, marginal por tenant, estrés, métrica a vigilar | LEAD en FASE 1, después `cost-auditor` | **con fuente desde FASE 1** |
| [CHATBOT.md](CHATBOT.md) | dieta, contexto, tools, handoff, evals, costo por 1000 msgs | `ai-agent` | FASE 5 |
| [research/](research/) | hechos verificados con fuente y fecha | `researcher` (uno por archivo) | **7 topics; 6 PASS, R4 PARCIAL** |

## Contratos que no están en /docs
| archivo | qué es |
|---|---|
| `CLAUDE.md` | constitución: reglas duras, stack cerrado, ownership de archivos |
| `AGENTS.md` | roster de oficios, protocolo común, contratos por agente |
| `.claude/skills/*/SKILL.md` | recetas deterministas (RLS, WhatsApp, R2, dieta del bot, …) |
| `.claude/commands/*.md` | entradas humanas: `/istock-build` `/istock-slice` `/istock-review` `/istock-cost` |
| `.claude/workflows/istock-build.js` | orquestación del pipeline por fases |

## Cómo leer esto por primera vez
1. `CLAUDE.md` (reglas duras y stack) → 2. `docs/PRODUCT.md` (qué se vende) →
3. `docs/SLICE_BOARD.md` (dónde estamos) → 4. `docs/ARCHITECTURE.md` (cómo está armado).

## Estado — 2026-08-27
**FASE 0 y FASE 1 cerradas. Cero código de app escrito, por diseño.**
Lo que hay que saber sin leer nada más:
- La vidriera es `proxy.ts` + rewrite a `/s/{slug}` + `'use cache'`. **El slug en el path no es
  estilo: sin él, dos tenants comparten entrada de cache.** (ADR-007)
- **`cacheLife` es una decisión de costo**: `'max'` = USD 0.012/tenant/mes, `revalidate: 60` = USD
  2.59. La segunda revienta el objetivo sola. (`COST.md` §2)
- El chatbot se come **~75% del presupuesto de infra del plan Negocio**. Está dentro, pero ya no es
  ruido. (`COST.md` §0)
- **ENACOM corta a 5 consultas/día por IP** → nada de consultar en el alta masiva. (ADR-009)
- **R4 (Mercado Pago) está PARCIAL y frenado por la regla 3.** Se cierra con sandbox, no con
  research. (ADR-008)
- Blocker con más lead time: **B5**, migrar los nameservers de `maat.work` a Vercel (24–48 h).
