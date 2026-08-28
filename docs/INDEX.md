# /docs — índice

| doc | qué contiene | lo escribe | cuándo se actualiza |
|---|---|---|---|
| [PRODUCT.md](PRODUCT.md) | producto ejecutable: ICP, recorrido que factura, planes, fuera de alcance | `product-scribe` | cambio de producto (raro — no se reabre) |
| [DOMAIN.md](DOMAIN.md) | glosario, entidades, máquina de estados, FX, visibilidad por rol, `publicListingDTO` | `product-scribe` + `domain-agent` | cada slice que toca reglas de negocio |
| [ARCHITECTURE.md](ARCHITECTURE.md) | monorepo, host→tenant, cache, camino de una foto, RLS, límites de confianza, **qué NO reescribe el proxy** | LEAD en FASE 1, después `docs-keeper` | FASE 1 + §"Qué NO se reescribe" agregada en **S2** |
| [DECISIONS.md](DECISIONS.md) | ADRs numeradas con alternativas descartadas y verificación + **§"Notas operativas"** (hallazgos verificados que no abren ADR) | LEAD en FASE 1, después `docs-keeper`; **el LEAD ratifica** cada ADR nueva | **ADR-001..015; 008 y 010 abiertas.** ADR-011 supersede el corolario 4 de ADR-007; ADR-012 lo precisa con el polo negativo; **013** (indistinguibilidad en el panel) y **014** (`instant = false`, **enmendada el 2026-08-28 con la medición del status**) salieron de S2; **015** (el matcher excluye por nombre, no por sufijo) cierra P1+P2. **Notas operativas abiertas el 2026-08-28** con los dos gates que daban verde por ausencia **y con el `head()` que pisaba el comando `head`** |
| [SLICE_BOARD.md](SLICE_BOARD.md) | **estado de la verdad del avance** + blockers + **FASE 4 bis** (trabajo que salió de una slice) | `docs-keeper` | cada slice |
| [TEST_MATRIX.md](TEST_MATRIX.md) | unit / RLS / e2e / seguridad + **qué regla no prueba nadie todavía**, verificado contra el repo | `docs-keeper` (era `qa-agent`; **corregido por el LEAD el 2026-08-28**: quien escribe los tests que cruzan no puede escribir también el doc que declara la cobertura) | cada test nuevo, y cada corrida de gate que cambie lo cubierto |
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
- **S3 está `done`: el LEAD re-ejecutó `bash scripts/accept-s3.sh` el 2026-08-28 — 50 PASS, 0 FAIL,
  `S3: ACEPTADA`.** Con eso cierran también **S3.1**, **S3.2** y **T8**. Las dos mediciones que
  bloqueaban salieron con número: `transferSize=51016B` contra un techo de 204800 B (la grilla de un
  teléfono baja `card`, no `detail`) y `primera=9 · cacheada=0` (la ficha cacheada no le manda **ni
  una** sentencia a Postgres). La corrida encontró **cuatro defectos** que la entrega del código no
  había mostrado (`9837ee7`, `50173df`, `ba8536c`, `09c9bc3`): es el mejor argumento que tiene este
  repo para la regla de que **`done` lo fija la corrida, no el código**.
  **Queda abierto de S3: T3, y S3.3 — nueva.** Una ficha bajo un slug de **tenant** inexistente
  contesta *"Este equipo ya no está publicado"* en vez de *"No hay ninguna vidriera en esta
  dirección"*: al que abre el link de un negocio que nunca existió le decimos que el equipo se
  vendió. `ListingPage` no llama a `getStorefrontTenant` y no distingue los dos `null`. ~10 líneas,
  `storefront-agent`.
- **La forma de `listings.slug` está cerrada en las dos capas** (**T9**): `LISTING_SLUG_PATTERN`
  (3–64, sin guión en los bordes) en `packages/domain` con 15 tests, y `0003_listing_slug_format`
  en `packages/db` con 21 casos contra Postgres real, de polaridad negativa. Queda en vuelo que
  `storefront-agent` borre su copia e importe de `domain`.
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
  polaridades**. Detalle en `SLICE_BOARD.md`. **Dos casos más el 2026-08-28**
  (`DECISIONS.md` §"Notas operativas"): un gate se satisfacía con un `import` —hay que verificar
  **la invocación, nunca la presencia del símbolo**— y `guard-artifacts.sh` sin argumentos daba
  `PASS` con cero archivos chequeados. Las reglas de R2 de `CLAUDE.md` §2 ya tienen gate:
  `scripts/guard-r2.sh` (**T11**). **T4 cerró** (`dc1d854`): `scripts/_lib.sh` es el único juego de
  helpers, lo importan **6** gates, y `scripts/_lib.test.sh` lo prueba en las dos polaridades **en
  CI** — que es lo que compra el riesgo de compartir (si `none()` se rompe, todos los gates se
  vuelven vacuamente verdes a la vez). **La excepción anotada se cerró el 2026-08-28** (`0bcb281`):
  `accept-fase2.sh` migró, y el motivo que lo decidió **no era el que estaba escrito**. No fue
  `bad()`/`strip_comments()` sin equivalente —`bad()` es `no()` con otro nombre— sino que el gate
  definía **`head()`, que pisa el comando `head`**: latente mientras corrió autónomo, activo apenas
  hace `source` de `_lib.sh`, porque `_veredicto()` termina en `| head -6` y bash resuelve funciones
  **en el momento de la llamada**. Ese `head -6` habría entrado a la función del gate —un pipe que
  se come la salida y devuelve 0— y la regla habría seguido imprimiendo `FAIL` **sin listar un solo
  hallazgo**. Lección: **un helper con nombre de comando de `coreutils` es una bomba con el
  temporizador puesto en el día que el archivo comparta scope con otro.**
- **El harness de CI también estaba verde por vacío** (`fe4e5dc`, 2026-08-28). El job `e2e` corría
  `pnpm --filter @istock/web e2e`: el comando **resolvía**, pero `apps/web` no tiene
  `@playwright/test` ni config, así que daba `Total: 0 tests in 0 files`, exit 0 — **CI reportaba
  e2e verde sin haber corrido un solo test**. Se corrigió a `@istock/e2e` y se borró el script `e2e`
  de `apps/web`, que era lo que hacía resolver al comando mal escrito. En la misma pasada:
  `guard-routes.sh` entró a CI (job `e2e`, el único con un `.next`; estaba afuera y había quedado
  **rojo tres commits**), y el artifact de fallas dejó de apuntar a `apps/web/playwright-report/`
  —que no existe nunca— para subir `e2e/test-results/`.
- **Deuda de S1 sin slice:** no hay rate limiting (**T1**) ni guard de "query sin filtro de tenant"
  (**T2**). Las dos son del **LEAD**: `scripts/**` y `vercel.json` tienen dueño desde FASE 4.
- **Deuda de los instrumentos, abierta en FASE 4:** el test de RLS cruzado vive en el directorio de
  `db-agent` y lo tiene que auditar `qa-agent` → se muda a `tests/` después de S2 (**T3**, sigue
  abierta: 59 `it()`, y el encabezado del archivo todavía se declara `db-agent`); y `readMatchers()`
  trunca el matcher del proxy en el primer `]` (**T7**, no rompe nada hoy).
- **Deuda nueva, abierta el 2026-08-28:** editar el **TC** y los puntos de retiro después del alta
  **no existe** —`ajustes` es sólo lectura y la única mutación de `fx_settings`/`locations` es el
  `insert` del alta— así que hoy mover el TC exige recrear el negocio (**T12**, `app-agent`, es
  producto: el TC lo pone una persona y la va a mover seguido); `/_media` no manda
  `Timing-Allow-Origin`, así que la Performance API mide **0** cross-origin y **ninguna medición de
  bytes de imagen puede salir de ahí** —ni los e2e, que miden con `request.sizes()` de Playwright,
  ni RUM el día que exista— (**T13**, `app-agent`); y quedan **dos** prohibiciones de `CLAUDE.md` §2
  que no chequea nadie: rate limiting con contador en Postgres sobre la vidriera, y la imagen
  original >500 KB servida a la vidriera, cuyos dos chequeos existen pero **ninguno corre en cada
  push** (**T14**, `qa-agent`).
- **El driver de R2 existe** (`packages/media/src/storage/r2.ts`, `MEDIA_DRIVER=r2`). Lo que falta
  para K5 es el bucket real: ningún byte viajó nunca a R2. Eso es **B1**.
- **Ocho comandos de aceptación corrían la suite entera creyendo filtrar** (**T10**, LEAD,
  **cerrada** en `0d647c6`). El diagnóstico viejo —*"el comando no resuelve"*— era **falso y más
  benigno que la realidad**: `pnpm --filter web test -- storefront` **sí** resolvía y corría los 147
  tests del paquete con el patrón perdido, así que 4 contratos de agente y 4 skills entregaban un
  verde que no era sobre su slice. La forma que quedó es
  `pnpm --filter @istock/web exec vitest run <patrón>`, verificada en las dos polaridades. Para S3
  el comando sigue siendo `bash scripts/accept-s3.sh`.
