# /docs — índice

**Qué es:** una línea por doc — qué contiene, quién lo escribe y cuándo se actualiza — más el estado
del avance en prosa corta. Si algo no está acá, no está escrito.
**Para quién:** el que llega al repo y no sabe qué leer, y el agente que va a escribir en `docs/**` y
necesita saber si el archivo es suyo.
**Cuándo se actualiza:** cada vez que nace un doc, cambia su dueño, o el LEAD re-ejecuta un gate.
Lo escribe `docs-keeper` (`CLAUDE.md` §4).

| doc | qué contiene | lo escribe | cuándo se actualiza |
|---|---|---|---|
| [PRODUCT.md](PRODUCT.md) | producto ejecutable: ICP, recorrido que factura, planes, fuera de alcance | `product-scribe` | cambio de producto (raro — no se reabre) |
| [DOMAIN.md](DOMAIN.md) | glosario, entidades, máquina de estados, FX, visibilidad por rol, `publicListingDTO` | `product-scribe` + `domain-agent` | cada slice que toca reglas de negocio |
| [ARCHITECTURE.md](ARCHITECTURE.md) | monorepo, host→tenant, cache, camino de una foto, RLS, límites de confianza, **qué NO reescribe el proxy** | LEAD en FASE 1, después `docs-keeper` | FASE 1 + §"Qué NO se reescribe" agregada en **S2** |
| [DECISIONS.md](DECISIONS.md) | ADRs numeradas con alternativas descartadas y verificación + **§"Notas operativas"** (hallazgos verificados que no abren ADR) | LEAD en FASE 1, después `docs-keeper`; **el LEAD ratifica** cada ADR nueva | **ADR-001..016; 008 y 010 abiertas.** ADR-011 supersede el corolario 4 de ADR-007; ADR-012 lo precisa con el polo negativo; **013** (indistinguibilidad en el panel) y **014** (`instant = false`, **enmendada el 2026-08-28 con la medición del status**) salieron de S2; **015** (el matcher excluye por nombre, no por sufijo) cierra P1+P2; **016** (el rate limit del WAF vive en `config/firewall-rules.json` y no en `vercel.json`, que no existe) cierra el nivel 1 de T1. **Notas operativas abiertas el 2026-08-28**: los dos gates que daban verde por ausencia, el `head()` que pisaba el comando `head`, **"un invariante puede tener tres pruebas alrededor y ninguna encima"** (el botón `wa.me`, cerrado con M3b), la **consulta duplicada del tenant en el miss frío** (deuda aceptada de S3.3, con su número), el **`noindex` del flight** que no es un `<meta>` y —2026-08-28— **"un gate tiene dos niveles"**: `ci.yml` nunca corrió, así que *"corre en CI"* significa *"el repo declara el step"* |
| [SLICE_BOARD.md](SLICE_BOARD.md) | **estado de la verdad del avance** + blockers + **FASE 4 bis** (trabajo que salió de una slice) + §**"Seis gates rojos o dormidos"** (el día que se separó *gate declarado* de *gate ejecutado*) | `docs-keeper` | cada slice, y cada vez que el LEAD re-ejecuta un gate |
| [TEST_MATRIX.md](TEST_MATRIX.md) | unit / RLS / e2e / seguridad + **qué regla no prueba nadie todavía**, verificado contra el repo | `docs-keeper` (era `qa-agent`; **corregido por el LEAD el 2026-08-28**: quien escribe los tests que cruzan no puede escribir también el doc que declara la cobertura) | cada test nuevo, y cada corrida de gate que cambie lo cubierto |
| [COST.md](COST.md) | piso de plataforma, marginal por tenant, estrés, métrica a vigilar | LEAD en FASE 1, después `cost-auditor` | **con fuente desde FASE 1** |
| [CHATBOT.md](CHATBOT.md) | dieta, contexto, tools, handoff, evals, costo por 1000 msgs | `ai-agent` | FASE 5 |
| [research/](research/) | hechos verificados con fuente y fecha | `researcher` (uno por archivo) | **7 topics de FASE 1 (6 PASS, R4 PARCIAL) + `vercel-request-body-limit.md` (S2) + `vercel-firewall-as-code.md` (T1), los dos pedidos al cerrar una slice** |

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

> ### 🔴 Antes que nada: `.github/workflows/ci.yml` **nunca corrió**
> `git ls-remote --heads origin` está **vacío** contra **89** commits locales; `origin/main` figura
> `gone`. Todo *"corre en CI"* de este índice, de `SLICE_BOARD.md` y de `DECISIONS.md` significa
> **"`ci.yml` declara el step"** — nivel 1. Nivel 2 (corrió en `ubuntu-latest`, sobre este commit) no
> lo alcanzó **ningún** gate del repo. Misma distinción que ADR-016 fijó para `"status": "active"`
> del WAF: el archivo declara, no ejecuta. No es teórico: `accept-s1.sh` usaba `stat -f %m`, que en
> GNU significa `--file-system`, y habría salido **verde midiendo basura** en Linux (`c854b99`).
> **Lo destraba un `git push`, y no es una fila de ningún board.** Detalle:
> `SLICE_BOARD.md` §"Seis gates rojos o dormidos" · `DECISIONS.md` §Notas operativas.

**FASE 0, FASE 1 y FASE 2 cerradas.** El LEAD re-ejecutó el gate de FASE 2 el 2026-08-27 y **D1–D4
pasaron a `done`** con la corrida registrada en `SLICE_BOARD.md`. **S1, S2, S3 y S4 están
ACEPTADAS** — las cuatro corridas están fechadas abajo. **FASE 3 (K1–K5) sigue sin re-ejecutar**: su gate termina en
`next build` y no se corrió. El código de FASE 3 está escrito, pero **el gate es la corrida, no el
código** — es la misma regla que tuvo a S1 en `doing` y a S2 en `todo` un día largo con el código ya
en `main`.
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
- **S1 y S2 están `done`: el LEAD re-ejecutó los dos gates enteros el 2026-08-28** — `accept-s1.sh`
  26 PASS / 0 FAIL, `accept-s2.sh` 21 PASS / 0 FAIL, los dos con `EXIT=0`. Ninguna pasa por
  ausencia: S2 imprimió bytes (`card=50692B` contra `techo=153600B`, más `detail`, `thumb`, `master`
  y los 4 objetos), y S1, que no imprime `MEDIDO`, pega HTTP en vivo, consulta Postgres y corre la
  suite e2e entera con censo (`10/10 archivos · 70/70 tests · 0 salteados`). **Aceptar la slice no
  cierra sus deudas:** siguen abiertas **S2.1** (`blocked` en B1), **S2.2**, **S2.3**
  y **S2.4** (**T1** cerró su nivel 1 el 2026-08-28 y **T2** cerró entero, ver abajo). Y sigue viva la deuda declarada de **ADR-011**: el miss contesta `200`, así que **deja
  de ser distinguible por status code en los logs de acceso** — el gate lo imprime, no lo esconde, y
  vuelve a morder en FASE 8.
- **S3 está `done`: el LEAD re-ejecutó `bash scripts/accept-s3.sh` el 2026-08-28 — 50 PASS, 0 FAIL,
  `S3: ACEPTADA`.** Con eso cierran también **S3.1**, **S3.2** y **T8**. Las dos mediciones que
  bloqueaban salieron con número: `transferSize=51016B` contra un techo de 204800 B (la grilla de un
  teléfono baja `card`, no `detail`) y `primera=9 · cacheada=0` (la ficha cacheada no le manda **ni
  una** sentencia a Postgres). La corrida encontró **cuatro defectos** que la entrega del código no
  había mostrado (`9837ee7`, `50173df`, `ba8536c`, `09c9bc3`): es el mejor argumento que tiene este
  repo para la regla de que **`done` lo fija la corrida, no el código**.
  **S3.3 y T3 cerraron después** (`042e24e`, `d686923`), y con S3.3 la corrida de `accept-s3.sh`
  quedó en **58 PASS · 0 FAIL** manteniendo `primera=9 · cacheada=0`: el arreglo **no encareció el
  camino feliz**. S3.3 era que una ficha bajo un slug de **tenant** inexistente contestaba *"Este
  equipo ya no está publicado"* en vez de *"No hay ninguna vidriera en esta dirección"* —al que abre
  el link de un negocio que nunca existió le decíamos que el equipo se vendió—, y el desempate ahora
  se pregunta **después** del `null` para no sumarle una consulta a toda ficha que sí existe.
  **Queda abierta T15** (prioridad baja, `db-agent`): en el `/demo`, el slug del listing dice
  `grafito` y la página dice `Negro espacial`.
- **S4 está `done`: `./scripts/accept-s4.sh` re-ejecutado por el LEAD el 2026-08-28, sin fixture —
  37 PASS, 0 FAIL**, con la suite e2e corrida de verdad (**73 tests**) y el repo en **1004 passed /
  0 failed**. El click del botón de WhatsApp deja **una** fila en `wa_click_events` y nada más:
  `filas_al_cargar=0 · filas_antes=0 · filas_despues=1` (dispara en el **click**, no en el **view**),
  `filas_creadas=0` en el cruce de tenants, y `anchors=1 · abre_whatsapp=si` **con JavaScript
  apagado** — la telemetría nunca se pone adelante de la venta. Sin PII: no se anonimiza, **no se
  recibe**. Dos desvíos de la spec, los dos correctos y los dos registrados en el board: un
  `<script>` inline de 412 B en vez de un Client Component (lo prohíbe **W001**, y encima engancha al
  parsear y no al hidratar), y un `insert … select from listings` en vez de `insert … values`
  (con `values`, el uuid de otro tenant resuelve a **NULL** y la fila se escribe igual por la rama
  `listing_id is null` del `WITH CHECK`).
- **Lo que S4 dejó abierto es S4.1, y es de conversión, no de seguridad:** cuando el listing **no
  tiene `catalog_model`**, el mensaje dice `iPhone 14 Pro 256 Grafito 256 Grafito (usado A)` — el
  fallback al `title` (texto libre del dueño, que ya trae storage y color) más el append de
  `describeListing`. **No es artefacto del fixture:** `catalogModelId` es nullable y
  `onDelete: 'set null'`. Y es la segunda vez que el repo paga la misma lección: **tres pruebas
  alrededor del string y ninguna encima del string completo en el camino real.**
  **Al 2026-08-28 el código y el gate están los dos en `main`** — gate primero y en rojo (`7e40856`:
  M3b de `accept-s3.sh` + W5 de `accept-s4.sh` exigen que el equipo nombrado **no repita un token**),
  fix después (`07c42ff`: `nameSource` requerido sin default, `resolveModelName` como único
  constructor, `isBlank` tratando `''` como ausente). **La fila sigue `doing` por una sola razón: el
  LEAD todavía no re-ejecutó `accept-s3.sh` ni `accept-s4.sh` sobre el fix.** Los `37 PASS` que este
  índice cita para S4 son de la corrida **anterior**, la que imprimió el defecto y lo dejó pasar, así
  que no sirven como evidencia de S4.1.
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
  Los 15 **recién desde `0edb661`** (módulo **M3b**, 2026-08-28): hasta ese commit exigía 14 y el que
  faltaba era el botón `wa.me`, el único de los 15 por el que entra la plata. Gate re-ejecutado
  entero después: **58 PASS · 0 FAIL**.
- **`instant = false` no recupera el status 404 del panel: está medido** (ADR-014, "Corrección
  medida", 2026-08-28). No es un defecto de seguridad —`mine`, `theirs` y `ghost` dan 200 los tres,
  que es el invariante de ADR-013—, pero un 404 que viaja como 200 **no aparece en la tasa de error**
  de Sentry ni de PostHog: la observabilidad del panel (FASE 8) no puede depender del status.
- **Deuda de S2:** `collectOrphanObjects` existe, está testeado y **no lo llama nadie**, mientras
  cuatro comentarios la citan en presente (**S2.2**); el lock de las 8 fotos está probado por forma
  y no por efecto (**T5**, **T6**); el `<input type="file">` no se limpia tras subir (**S2.3**); y el
  docblock de `page.tsx` afirma un 404 que la medición desmiente (**S2.4**, `app-agent`).
- **Seis gates rojos o dormidos el 2026-08-28, y son una familia, no seis accidentes.**
  `guard-routes` (rojo desde `c9611b1`, la ruta del beacon nunca entró al censo → `b1a8732`);
  `accept-fase2` (rojo desde **el mismo commit**: su regla decía *"toda policy de `anon` es SELECT"*
  y S4 le dio a `anon` la única escritura sin autenticar del producto → `bd7b4e4`, **endureciendo**:
  la lista de escrituras se compara por **igualdad**, así que borrar el beacon también rompe el
  gate); `accept-fase3` y `accept-s1..s4` fuera de CI; `_lib.test.sh` **rojo y en CI** porque
  `.gitignore` ocultaba sus propias fixtures a los helpers que las buscan; y `accept-s1.sh` con
  `stat`/`date` de BSD. Los últimos cuatro, en `c854b99`. **Lo que comparten:** una aceptación por
  slice corre sus aserciones y **no puede ver el invariante que la slice derogó** — lo único que
  cruza slices es CI, y CI nunca corrió.
- **T2 cerró** (`9b3d7d2`): `W015` de `apps/web/scripts/web-lint.mjs` está en `main`, deriva las
  tablas de negocio del schema, mide **filtrado y no presencia**, y el escape es la marca
  `web-lint:sin-tenant` con motivo escrito (hoy **dos** en todo el repo). **Su alcance es `apps/web`
  y nada más → `packages/**` sigue sin gate: fila nueva `T16`.** Residuo declarado: la polaridad de
  W015 se ejerció **fuera del repo**, y es exactamente la situación en la que `guard-firewall` tenía
  seis reglas que no fallaban nunca hasta que la polaridad se volvió un archivo.
- **S5 (FX → ARS) está `done`, y figuraba `todo` con las tres partes en `main`** — el mismo drift que
  tuvo a S1 en `doing` un día. El TC lo carga el dueño en el alta (`fxRate` → `fx_settings` por
  tenant), `applyFx` con default `ceil_1000` tiene 187 tests verdes en `@istock/domain`, y el ARS de
  la ficha lo exige M3 de `accept-s3.sh` en la corrida de 58 PASS del LEAD. **El hueco que queda no
  es de S5: es T12**, que el dueño no puede *editar* el TC después del alta. Contarlo dos veces
  escondía que lo que falta es una pantalla, no el FX.
- **S6 (reserva + cron) está `doing`, `app-agent`.** DB y dominio listos: `reservations` con índice
  único **parcial** `reservations_one_active_per_listing` (la invariante en el motor, no en un `if`),
  `check(minutes between 30 and 120)`, y `expireReservation` puro e idempotente en
  `packages/domain/src/reservation.ts:95`. Falta panel + **ruta de cron** —hoy no hay ninguna— +
  `revalidateTag` (`invalidateStorefrontUnit`, no `invalidateStorefront`). **El `vercel.json` con el
  schedule lo escribe el LEAD y hoy no existe**, y la ruta nueva va a romper el censo de
  `guard-firewall.sh` el día que nazca: `config/firewall-rules.json` también es del LEAD.
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
- **T1 cerró su nivel 1, y el `done` hay que leerlo entero** (`4fce968`). **El rate limit del WAF no
  entra en `vercel.json` y no puede entrar**: el schema oficial tipa `routes[].mitigate.action` como
  enum cerrado `["challenge","deny"]` y `rate_limit` aparece **cero veces**. `vercel.json` sigue sin
  existir. Las 2 reglas viven en `config/firewall-rules.json` (**LEAD**) y se aplican por CLI, que
  **no es parte del build**. **Declaradas y validadas ≠ aplicadas:** no hay proyecto Vercel (**B2**,
  **B5**). `/api/track` **ya existe** —aterrizó con **S4**, no con un "S4b" que nunca fue una fila del
  board— y su regla pasó a `active`; `/api/chat` sigue esperando la **FASE 5**. Lo que hace fuerte al gate no es validar el JSON sino el **censo**: hoy 3 route
  handlers, los 3 decididos, y una ruta nueva sin decidir lo rompe **el día que se crea** — y desde
  `3199a78` **el gate y su polaridad tienen step en CI** (`ci.yml:118` y `:126`), así que eso dejó de
  depender de que alguien se acuerde — *step declarado*, no ejecutado: ver el recuadro rojo al tope
  de §Estado. Y ninguna regla condiciona por `host`: se facturan los
  *allowed requests*, así que eso le cobraría peaje a cada pageview de vidriera, que
  `ARCHITECTURE.md` declara scrapeable a propósito — y `cost-auditor` lo midió: rechazarla le sacó
  al plan Base el **77%** de su costo marginal (0.124 → 0.03). Todo esto es **ADR-016**, abierta y
  ratificada por el LEAD el 2026-08-28. **Lo único que sigue abierto de T1 es el nivel 2:** con S4,
  `storefront-track-rl` pasó a `active`, y `active` significa *"el archivo declara que debe estar
  publicada"*, **no** *"está publicada"*. El drift contra la config viva lo cierra
  `vercel firewall diff --json`, que **no existe todavía**.
- **T2 dejó de ser "no lo chequea nadie" y pasó a "no está commiteado".** La regla existe: es
  **`W015`** de `apps/web/scripts/web-lint.mjs`, corre y da verde (15 tablas de negocio **derivadas
  del schema**, no de una lista a mano). Pero `git log -S W015` sobre ese archivo devuelve **cero
  commits** y `git status` lo marca `M`: **en `main` no existe y no corrió en ningún push.** Es la
  tercera pregunta que este repo tuvo que aprender a hacerse —*¿hay chequeo?*, *¿lo corre alguien?*
  y ahora **¿está en `main`?**— y la cierra el LEAD, no un doc.
- **Deuda de los instrumentos: T3 cerró** (`d686923`). El test de RLS cruzado vive en
  `tests/rls-cross-tenant.test.ts` —`db-agent` escribe las policies, así que no puede ser dueño del
  test que las audita— y el LEAD lo re-ejecutó desde la ubicación nueva: **69 casos** verdes, total
  del repo **919**. **No eran 59:** ese número contaba `it()` literales y se comía el `it.each` sobre
  10 columnas sensibles. **Y desde S4 son 79**, con R2b (el visitante anónimo no puede anotar su
  click en la cuenta de otro) y R6c contando las policies `TO anon`, que ahora son 6. Sigue abierta **T7** (`readMatchers()` trunca el matcher del proxy en el
  primer `]`, no rompe nada hoy).
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
