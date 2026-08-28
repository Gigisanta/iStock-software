# /docs — índice

| doc | qué contiene | lo escribe | cuándo se actualiza |
|---|---|---|---|
| [PRODUCT.md](PRODUCT.md) | producto ejecutable: ICP, recorrido que factura, planes, fuera de alcance | `product-scribe` | cambio de producto (raro — no se reabre) |
| [DOMAIN.md](DOMAIN.md) | glosario, entidades, máquina de estados, FX, visibilidad por rol, `publicListingDTO` | `product-scribe` + `domain-agent` | cada slice que toca reglas de negocio |
| [ARCHITECTURE.md](ARCHITECTURE.md) | monorepo, host→tenant, cache, camino de una foto, RLS, límites de confianza, **qué NO reescribe el proxy** | LEAD en FASE 1, después `docs-keeper` | FASE 1 + §"Qué NO se reescribe" agregada en **S2** |
| [DECISIONS.md](DECISIONS.md) | ADRs numeradas con alternativas descartadas y verificación | LEAD en FASE 1, después `docs-keeper`; **el LEAD ratifica** cada ADR nueva | **ADR-001..015; 008 y 010 abiertas.** ADR-011 supersede el corolario 4 de ADR-007; ADR-012 lo precisa con el polo negativo; **013** (indistinguibilidad en el panel) y **014** (`instant = false`, **enmendada el 2026-08-28 con la medición del status**) salieron de S2; **015** (el matcher excluye por nombre, no por sufijo) cierra P1+P2 |
| [SLICE_BOARD.md](SLICE_BOARD.md) | **estado de la verdad del avance** + blockers + **FASE 4 bis** (trabajo que salió de una slice) | `docs-keeper` | cada slice |
| [TEST_MATRIX.md](TEST_MATRIX.md) | unit / RLS / e2e / seguridad + cobertura de reglas | `qa-agent` | cada test nuevo |
| [COST.md](COST.md) | piso de plataforma, marginal por tenant, estrés, métrica a vigilar | LEAD en FASE 1, después `cost-auditor` | **con fuente desde FASE 1** |
| [CHATBOT.md](CHATBOT.md) | dieta, contexto, tools, handoff, evals, costo por 1000 msgs | `ai-agent` | FASE 5 |
| [research/](research/) | hechos verificados con fuente y fecha | `researcher` (uno por archivo) | **7 topics de FASE 1 (6 PASS, R4 PARCIAL) + `vercel-request-body-limit.md`, pedido en S2** |

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

> **Nota de ownership — RESUELTA por el LEAD en FASE 4.** Había tres fuentes y dos respuestas:
> `CLAUDE.md` §4 daba `docs/**` a `docs-keeper`, este índice decía `architect`, y el contrato de
> `docs-keeper` decía que las decisiones las escribe el `architect`. **Manda la tabla de
> `CLAUDE.md` §4:** el rol `architect` era de FASE 1 y está dormido, así que `ARCHITECTURE.md` y
> `DECISIONS.md` los mantiene **`docs-keeper`**. El LEAD sigue **ratificando** cada ADR nueva:
> escribirla no es lo mismo que decidirla.

## Estado — 2026-08-28
**FASE 0, FASE 1 y FASE 2 cerradas.** El LEAD re-ejecutó el gate de FASE 2 el 2026-08-27 y **D1–D4
pasaron a `done`** con la corrida registrada en `SLICE_BOARD.md`. **FASE 3 (K1–K5), S1 y S2 NO.**
Ojo con el motivo, que cambió el 2026-08-28: el `next build` **ya compila** (la medición de ADR-014
corrió `next start` y los e2e del panel). Lo que falta es **correr los gates enteros**. El código
está escrito, pero **el gate es la corrida, no el código**.
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
- **El techo de request body que manda es 4 MB** (Routing Middleware), no 4.5. Por eso entra **una
  foto por request**. La slice que lo levanta es **S2.1** y está `blocked` en B1 — y arrastra una
  pregunta abierta entre las reglas 1 y 4 de `media-agent` que hay que contestar antes de empezar.
- **Las tres condiciones previas a S3 están cerradas.** `robots.txt`/`sitemap.xml` por tenant
  (**P1**) y los metadata file conventions (**P2**) eran el mismo bug y los cierra **ADR-015**: el
  matcher del proxy excluye **por nombre, no por sufijo** — `/icon.png` es ruta, `/logo.png` es
  asset, y por sufijo son indistinguibles. Y el gate de S3 ya existe (**P3**,
  `scripts/accept-s3.sh`): mide **el byte que el browser pide** —un `srcset` sin `sizes` baja
  `detail` (128.570 B) donde el presupuesto dice `card` (50.692 B)— y exige los **15 campos**.
- **`instant = false` no recupera el status 404 del panel: está medido** (ADR-014, "Corrección
  medida", 2026-08-28). No es un defecto de seguridad —`mine`, `theirs` y `ghost` dan 200 los tres,
  que es el invariante de ADR-013—, pero un 404 que viaja como 200 **no aparece en la tasa de error**
  de Sentry ni de PostHog: la observabilidad del panel (FASE 8) no puede depender del status.
- **Deuda de S2:** `collectOrphanObjects` existe, está testeado y **no lo llama nadie**, mientras
  cuatro comentarios la citan en presente (**S2.2**); el lock de las 8 fotos está probado por forma
  y no por efecto (**T5**, **T6**); el `<input type="file">` no se limpia tras subir (**S2.3**); y el
  docblock de `page.tsx` afirma un 404 que la medición desmiente (**S2.4**, `app-agent`).
- **Regla de método vigente: un gate que nunca se vio fallar no es un gate.** Dos gates estaban
  verdes por vacío desde S1 (la regla del `TODO` no podía disparar nunca) y una regla del
  `guard-leaks` exigía citar el ADR equivocado. Toda regla nueva se prueba en **las dos
  polaridades**. Detalle en `SLICE_BOARD.md`.
- **Deuda de S1 sin slice:** no hay rate limiting (**T1**) ni guard de "query sin filtro de tenant"
  (**T2**). Las dos son del **LEAD**: `scripts/**` y `vercel.json` tienen dueño desde FASE 4.
- **Deuda de los instrumentos, abierta en FASE 4:** el test de RLS cruzado vive en el directorio de
  `db-agent` y lo tiene que auditar `qa-agent` → se muda a `tests/` después de S2 (**T3**);
  `none()` está copiado en tres gates con dos versiones distintas → `scripts/_lib.sh` (**T4**); y
  `readMatchers()` trunca el matcher del proxy en el primer `]` (**T7**, no rompe nada hoy).
- **El driver de R2 existe** (`packages/media/src/storage/r2.ts`, `MEDIA_DRIVER=r2`). Lo que falta
  para K5 es el bucket real: ningún byte viajó nunca a R2. Eso es **B1**.
