# /docs — índice

| doc | qué contiene | lo escribe | cuándo se actualiza |
|---|---|---|---|
| [PRODUCT.md](PRODUCT.md) | producto ejecutable: ICP, recorrido que factura, planes, fuera de alcance | `product-scribe` | cambio de producto (raro — no se reabre) |
| [DOMAIN.md](DOMAIN.md) | glosario, entidades, máquina de estados, FX, visibilidad por rol, `publicListingDTO` | `product-scribe` + `domain-agent` | cada slice que toca reglas de negocio |
| [ARCHITECTURE.md](ARCHITECTURE.md) | monorepo, host→tenant, cache, camino de una foto, RLS, límites de confianza | `architect` | FASE 1 y cada ADR nueva |
| [DECISIONS.md](DECISIONS.md) | ADRs numeradas con alternativas descartadas y verificación | `architect` | cada decisión técnica |
| [SLICE_BOARD.md](SLICE_BOARD.md) | **estado de la verdad del avance** + blockers abiertos | `docs-keeper` | cada slice |
| [TEST_MATRIX.md](TEST_MATRIX.md) | unit / RLS / e2e / seguridad + cobertura de reglas | `qa-agent` | cada test nuevo |
| [COST.md](COST.md) | piso de plataforma, marginal por tenant, estrés, métrica a vigilar | `cost-auditor` | cada slice (gate de costo) |
| [CHATBOT.md](CHATBOT.md) | dieta, contexto, tools, handoff, evals, costo por 1000 msgs | `ai-agent` | FASE 5 |
| [research/](research/) | hechos verificados con fuente y fecha | `researcher` (uno por archivo) | FASE 1, o cuando un dato caduca |

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
