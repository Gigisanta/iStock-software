# /docs — índice

**Qué es:** una línea por doc — qué contiene, quién lo escribe y cuándo se actualiza — más el estado
del avance en prosa corta. Si algo no está acá, no está escrito.
**Para quién:** el que llega al repo y no sabe qué leer, y el agente que va a escribir en `docs/**` y
necesita saber si el archivo es suyo.
**Cuándo se actualiza:** cada vez que nace un doc, cambia su dueño, o el LEAD re-ejecuta un gate.
Lo escribe `docs-keeper` (`CLAUDE.md` §4).

| doc | qué contiene | lo escribe | cuándo se actualiza |
|---|---|---|---|
| [PRODUCT.md](PRODUCT.md) | producto ejecutable: ICP, recorrido que factura, planes, fuera de alcance, **preguntas abiertas, serie `Q1`–`Q…`** (renumeradas desde `P` el 2026-08-28: el prefijo `P` es del board — `T44`) | `docs-keeper` por `CLAUDE.md` §4 — **conflicto CERRADO el 2026-08-28**: un contrato de agente acota, nunca amplía; `product-scribe` queda dormido | cambio de producto (raro — no se reabre). **Tocado el 2026-08-28 por S8**: el canje dejó de ser sólo una línea de "realidad local" (existe: form público → inbox → aceptar crea la unidad en `draft`), y se abrió **`Q5`** —quién responde por la PII del visitante— **sin default, porque el LEAD no lo definió**. Ojo: ese `P5` es de la tabla de este doc y **no** es el `P5` de `SLICE_BOARD.md`; colisión de numeración reportada al LEAD |
| [DOMAIN.md](DOMAIN.md) | glosario, entidades, máquina de estados **con sus efectos**, FX, visibilidad por rol, allowlist del `publicListingDTO` | `docs-keeper` por `CLAUDE.md` §4 (`domain-agent` es dueño de la **implementación**, no del doc) — **mismo conflicto, cerrado igual que en `PRODUCT.md`** | cada slice que toca reglas de negocio. **S8 sumó la máquina de estados del canje** (`new → contacted → evaluating → accepted / rejected`, con `accepted` como la **única** transición que la slice escribe y su guard de concurrencia `status <> 'accepted'`) y dos filas a §"Visibilidad por rol" para `tradein_leads`, con la aclaración de que sobre **esa** tabla el corte del `seller` lo sostiene el **servidor** y no la base (**P5** del board) |
| [ARCHITECTURE.md](ARCHITECTURE.md) | monorepo, host→tenant, cache, camino de una foto, RLS, límites de confianza, **qué NO reescribe el proxy** | LEAD en FASE 1, después `docs-keeper` | FASE 1 + §"Qué NO se reescribe" agregada en **S2**, y **tres correcciones el 2026-08-28 con S8**: (1) §nueva **"La superficie de escritura sin autenticar · dos tablas, y la segunda trae PII de un tercero"**; (2) §"Qué NO se reescribe" decía que `/api/**` bajo un host de tenant *"da 404"* y **desde S4 eso es falso** —el destino existe para las dos rutas que la vidriera tiene a propósito, `track` y `tradein`—, más la entrada de `/app/:path*` al matcher, que es la **cuarta** instancia de *segmento-vs-sufijo* (`T37`); (3) el presupuesto del WAF decía **2 reglas** y son **3** |
| [DECISIONS.md](DECISIONS.md) | ADRs numeradas con alternativas descartadas y verificación + **§"Notas operativas"** (hallazgos verificados que no abren ADR) | LEAD en FASE 1, después `docs-keeper`; **el LEAD ratifica** cada ADR nueva | **ADR-001..026 aceptadas; 008 y 010 abiertas; ADR-026 ratificada por el LEAD el 2026-08-28** (S8: *la PII del visitante se parte en escritura y lectura — `anon` la escribe y no la lee, y la mitad que importa se sostiene por una **ausencia***; lo reusable es que **una ausencia no la ve ningún lint de policies**, así que se afirma censando el árbol de migraciones y midiendo que un `insert … returning` falle. **Al ratificarla se le agregó la segunda mitad reusable**, que llegó con `T43`: **un test de PII se escribe por FORMA, no por nombre de columna** — quien grepea `customer_name` lo esquiva con `log(lead)`, y ése es el caso que va a pasar porque nadie loguea PII a propósito: loguea el objeto. Y la ADR conserva escrito que **redactar no es decidir**, que es de lo que cuelga §4). ADR-011 supersede el corolario 4 de ADR-007; ADR-012 lo precisa con el polo negativo; **013** (indistinguibilidad en el panel) y **014** (`instant = false`, **enmendada el 2026-08-28 con la medición del status**) salieron de S2; **015** (el matcher excluye por nombre, no por sufijo) cierra P1+P2; **016** (el rate limit del WAF vive en `config/firewall-rules.json` y no en `vercel.json`) cierra el nivel 1 de T1 — **enmendada el 2026-08-28 en dos puntos que habían driftado**: `vercel.json` conserva sólo `$schema`; la agenda vigente es Inngest Free y el censo de `guard-firewall.sh` camina `apps/web/app` **entero**, no `app/api`; **017** (histórico: los jobs eran Vercel Cron; no describe el scheduler vigente, que es Inngest Free) y **018** (el trial vencido no conserva features) salieron de **S6**; **019** (*en qué queda una reserva cerrada lo decide la tabla del dominio; el call site sólo declara su intención*) salió de **S6.1** y es la que convirtió un booleano en un enum de tres valores; **020** (*un gate afirma una conducta medida, nunca un identificador grepeado*) salió de tres gates del LEAD que estaban verdes o ruidosos por la misma razón, y trae el gate que cierra la parte mecánica de la clase (`guard-gates.sh`); **021** (*la aserción tiene la forma del caller, no la forma cómoda*) salió del **primer fallo de T21** y es **familia aparte de 020**, no una sección suya: ahí el gate no mide, acá mide bien y a un sujeto que ningún caller emite — las cuatro reglas de 020 le habrían dado verde; **022** (*un gate no puede ser del writer que audita*) generaliza una fila de `CLAUDE.md` §4 que nombraba **un** archivo en vez de la clase, y la levantó el agente auditado — `rls-lint.mjs` vivía adentro del paquete cuyas policies audita, y con el primer `ALTER POLICY` del repo imprimía `rls-lint OK · 74 policies` y salía **0**; **enmendada el 2026-08-28**: decía *"todo `*-lint.mjs`"* y eso es un **sufijo**, no la clase — `packages/domain/scripts/purity-check.mjs` se le escapaba, así que la regla vigente es *todo script que un `package.json` corra como `lint`/`guard`/`check`/`verify`/`audit`* (**seis**), no se mudan a `scripts/`, y la sostiene la sección **G3** de `guard-gates.sh` exigiendo la marca `gate-owner: LEAD` (fila **T28**, **en `main` desde `4d33be6`**); **023 ratificada el 2026-08-28** (*una comparación de mismo origen no audita el contenido: se declara y va acompañada de una aserción por literal*) — tercera hermana de 020 y 021, nace de que ensanchar `plans.test.ts` a `PLAN_TIERS × BILLABLE_FEATURES` **debilitó** el chequeo; **el LEAD corrigió lo que exige**: no prohíbe la comparación de mismo origen —es lo único que caza a dos writers separándose—, exige que no sea lo único en la sala, y `plans.test.ts` queda como el **caso modelo**, sin cambios. **024 ratificada el 2026-08-28** (*cuando la probe contradice midiendo a la spec del gate que la pidió, gana la probe y la spec se corrige*): cuarta de la familia 020/021/023 y la única que no habla de **cómo** está hecha una aserción sino de **quién gana** cuando la aserción y su encargo no coinciden. Se para sobre **tres slices** —`4fd230e` (el LEAD diagnosticó un pool que no existe: el archivo mockea la sesión de DB), `a0e5fde` (G6 afirmaba sobre un `INSERT` escrito a mano; el `42501` mostró qué emite Drizzle) y la **mitad de V3** de `10d31b6` (el predicado matcheaba un piso de cuenta regresiva, no un clamp)—, con **T25 como el caso que la disparó y no como su única evidencia**; `f691daf` queda **explícitamente afuera** por ser primo y no hermano. **Su mitad decisiva es el límite que agregó el LEAD:** la medición gana sobre la **spec del gate**, nunca sobre el **invariante de producto** que la spec sirve — si una probe contradice el invariante, el roto es el código; sin esa línea la ADR sería permiso para reescribir la expectativa hasta que dé verde. La evidencia se corrigió porque `docs-keeper` objetó *"no me consta"* contra una frase del LEAD y la objeción valió. **Notas operativas abiertas el 2026-08-28**: los dos gates que daban verde por ausencia, el `head()` que pisaba el comando `head`, **"un invariante puede tener tres pruebas alrededor y ninguna encima"** (el botón `wa.me`, cerrado con M3b), la **consulta duplicada del tenant en el miss frío** (deuda aceptada de S3.3, con su número), el **`noindex` del flight** que no es un `<meta>` y —2026-08-28— **"un gate tiene dos niveles"**: `ci.yml` nunca corrió, así que *"corre en CI"* significa *"el repo declara el step"*. **ADR-025 ratificada el 2026-08-28** (S7: la unicidad de la venta la afirma el motor y el `tenant_id` va **adentro** de la clave). La redactó `docs-keeper` y la ratificó el LEAD, y el ADR deja escritas las dos mitades a propósito. **Lo reusable no es el caso de `sales`:** *un índice único se evalúa antes que cualquier policy de lectura y no sabe qué es un tenant* — misma clase que `GRANT` vs RLS, dos capas en orden distinto y la de abajo sin noción de tenant, así que un `unique` sobre una tabla con `tenant_id` lo lleva **adentro de la clave** salvo que la unicidad sea genuinamente global |
| [SLICE_BOARD.md](SLICE_BOARD.md) | **estado de la verdad del avance** + blockers + **FASE 4 bis** (trabajo que salió de una slice) + §**"Seis gates rojos o dormidos"** (el día que se separó *gate declarado* de *gate ejecutado*) + §**S6.1** y §**S6.2** (las dos correcciones de reservas) + §**S2.5** (el guard de IMEI que rechaza fotos legítimas, **abierta**) + el **barrido serial de los cinco `accept-*`** sobre `68c0bd6` (`39/21/59/38/22`, todos con `FAIL=0`), que es de dónde salen los números de la tabla de FASE 4 + §**T21–T25** (el barrido de reservas se atraganta con la primera fila podrida: hallazgo de `cost-auditor` en `COST.md` §2.5, dueños asignados por el LEAD) + §**"T21 · el primer fallo"** (la aceptación que volvió en rojo, el gate **G6** que salió de ahí, y el contador de fallos de la regla 3) + §**T26** (`W016`, la última prohibición de §2 que no tenía gate ejecutable, **cerrada el 2026-08-28**) + §**T27** (los dos resolvers de entitlements dan motivos distintos, y el que se muestra le ofrece al dueño el plan que ya tiene) **+ el estado `esperando gate`**, introducido por el LEAD el 2026-08-28 contestando una pregunta de este board: **no cuenta para el tope de `doing`** —el tope acota writers escribiendo, y una fila que espera una corrida no tiene a nadie escribiendo— y su celda tiene que nombrar **el comando** que falta y **quién** lo corre. **y no la cierra el agente que la escribió** cuando el comando lo corre el LEAD (ADR-022 aplicado al board). Reemplaza la *nota de colisión de `doing`*, que quedó vieja al cerrar T18 y T27 + §**"T25 · la spec de la celda estaba equivocada en tres puntos"** (**ADR-024**) + §**T30**, donde **G4 se vio encender sobre un gate real el día que nació y antes de estar trackeado** — la evidencia que ningún fixture da — , §**T31** (el 500 del cron deja de ser un número sin ids) y §**T32** (`guard-doc-tables.sh`, el gate que censa que toda fila de tabla de `docs/**` tenga las columnas de su cabecera; **`done` el 2026-08-28**, cerrada por la corrida del LEAD —`GUARD-DOC-TABLES: PASS · 1157 filas · 165 tablas · 21 archivos`— y no por la de `docs-keeper`, que dio lo mismo y lo dijo: **ADR-022 aplicado al board, ejercido y no sólo escrito**. En `ci.yml` desde `d3deb86`, y por eso `guard-gates.sh` censa **23** gates en vez de 21). **Corrección de rumbo escrita en T32:** la primera corrida pareció encontrar una columna faltante en T28 y **no la había** — el gate blanqueaba code spans y un backtick colgado se tragó un pipe de estructura; la versión viva parte sólo por pipes no escapados y da `PASS` sobre el `HEAD` sin arreglar. **S8 (2026-08-28) agregó §"S8 · canje"** —el parte de diez campos, las **dos cosas que son doctrina y no números** (`canario_rol_anon` primero, porque `SET LOCAL` fuera de transacción es un no-op que sólo avisa; y **un caso que no corrió reporta `-1`, no `0`**), y los **cinco huecos de cobertura con dueño**— **y §"Dos gates crecieron en S8"**, donde está la historia entera de W015: la variante de **una columna** (`from_status`) que apagaba el gate, y la moraleja reusable — *ningún fixture del arnés usaba un identificador que contuviera la palabra que la regla busca*. Filas nuevas: **T37**…**T43** más **S8.1** y **S8.2** en `doing`; **T43** (la PII del visitante sin test de fuga) es **la única sin dueño**, y este doc **no se lo asigna**: eso lo decide el LEAD | `docs-keeper` | cada slice, y cada vez que el LEAD re-ejecuta un gate |
| [TEST_MATRIX.md](TEST_MATRIX.md) | unit / RLS / e2e / seguridad + **§"Probes de aceptación"** y **§"Integración — `apps/web` contra Postgres real"** (dos secciones nuevas del 2026-08-28, S7) + **qué regla no prueba nadie todavía**, verificado contra el repo + §**"La familia gate vacuamente verde"** (las tres cerradas con **ADR-020**, y lo que `guard-gates.sh` **no** cubre) + §**"Un sexto caso"**, que abre familia aparte con **ADR-021**: el test que midió bien, a un sujeto inventado. **§"Un quinto caso" se cerró el 2026-08-28**: el barrido de reservas ya tiene un test que lo corre **dos veces** (`scripts/probes/s6-sweep-head-of-line.test.ts`, **7 casos**, Postgres real, y **sin base es FAIL, no `skip`**), y su parte `MEDIDO cron barrido` lo parsea **V10b** de `accept-s6.sh` campo por campo contra literales del shell (**ADR-023**). La sección lleva además la tabla de las **dos versiones** de la spec que la probe corrigió (**ADR-024**). **S7 sumó tres inventarios, los tres SIN conteo de PASS a propósito** —el número que vale sale de una corrida, y este doc ya se equivocó dos veces contando en el fuente y afirmando en el runner—: **R9** en la tabla de RLS (la venta manual: el costo y el margen no cruzan; seis sub-bloques, **24 `it()` contados en el fuente**, con el hueco de R9c **declarado** = fila `P4`), la probe **`s7-venta-manual.test.ts`** (5 casos, certificado de `accept-s7.sh`) y **`create-listing.test.ts`** (8 casos, `7fc284a`, cero literales de error: las colisiones las tira Postgres). **El `79` de RLS y el `1225` del total quedan FECHADOS y no se re-suman**; `79 + 24` es una aritmética que nadie corrió. **El último 🔴 de la tabla de §2 se apagó el 2026-08-28** con `W016` (T26); los que quedan son 🟡 (T14.2, T14.3) y un 🔴 que no es de §2 sino de disponibilidad (S2.5). **S8 sumó:** la probe **`s8-canje.test.ts`** (9 casos **más un canario**, y las probes pasaron de 8 a **9**), **R7c-bis** en la tabla de RLS (qué columnas `SENSITIVE` puede `anon` **escribir**: exactamente dos), **R6c pasó de un entero a cuatro aserciones** (7 policies `TO anon` = 5 de lectura + 2 de escritura, y *que no exista nada más*), la fila de seguridad **S8** —la PII del visitante sin test de fuga, **el hueco que más importa**—, el quinto lint con arnés (`rls-lint.test.sh`) y los **19** casos de W015. **`E5` sigue 🔴 pero por otro motivo, y la celda decía el viejo:** ya no es *"la slice no arrancó"*, es que `next build` y `pnpm e2e` **no se corrieron** (86 tests en 13 archivos, **ninguno de S8**) | `docs-keeper` (era `qa-agent`; **corregido por el LEAD el 2026-08-28**: quien escribe los tests que cruzan no puede escribir también el doc que declara la cobertura) | cada test nuevo, y cada corrida de gate que cambie lo cubierto |
| [COST.md](COST.md) | piso de plataforma, marginal por tenant, estrés, métrica a vigilar | LEAD en FASE 1, después `cost-auditor` | **con fuente desde FASE 1** |
| [CHATBOT.md](CHATBOT.md) | dieta, contexto, tools, handoff, evals, costo por 1000 msgs | `docs-keeper` por `CLAUDE.md` §4 — **decía `ai-agent` y era la cuarta vez del mismo patrón** (`PRODUCT.md`, `DOMAIN.md`, `ARCHITECTURE.md`); acá ni siquiera había conflicto: `.claude/agents/ai-agent.md:46` ya decía *"documentá … en `docs/CHATBOT.md` (**vía `docs-keeper`**)"*. El contenido lo aporta `ai-agent` | **sin revisar desde FASE 1**; lo único tocado el 2026-08-28 fue el ID de modelo muerto (`llama-3.1-8b-instant`, retirado el 16/08/2026). **Esta celda decía *«y `packages/ai` no existe»* y era falso: el paquete está en `main` desde `d42fac9`** — corregido el 2026-08-28 verificando contra el árbol, la misma corrección que ya llevaban `SLICE_BOARD.md` (`T19`) y `TEST_MATRIX.md`. Lo que sigue sin censarse es la **cobertura** (E7/E8/E9/S7), que es la fila `T19`, hoy en `todo` |
| [research/](research/) | hechos verificados con fuente y fecha | `researcher` (uno por archivo) | **7 topics de FASE 1 (6 PASS, R4 PARCIAL) + `vercel-request-body-limit.md` (S2), `vercel-firewall-as-code.md` (T1), `vercel-cron-limits.md` (corte histórico de S6), `vercel-production-limits-2026.md` (addendum vigente 2026-09-04) e `inngest-free-scheduled-functions.md` (agenda Inngest Free), pedidos al evaluar límites o cerrar una slice** |

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
>
> **Generalizado el 2026-08-28, porque `architect` no era el único** (`product-scribe` reclamaba
> `PRODUCT.md` y `DOMAIN.md`, mismo patrón): **un contrato de agente puede acotar lo que su dueño
> escribe, nunca ampliarlo.** Si `.claude/agents/*.md` y §4 discrepan sobre un path, **gana §4** y el
> contrato queda derogado en esa línea. `product-scribe` queda dormido igual que `architect`.
> **Tres filas nuevas de §4 el mismo día**, por si se busca acá: `apps/web/instrumentation.ts` es de
> **`app-agent`**; `apps/web/next.config.ts` y `apps/web/app/layout.tsx` son del **LEAD** — el corte
> no es jerárquico, es por qué decide cada archivo: los dos últimos deciden runtime, cache y shell
> **para las tres caras a la vez**, así que no pueden ser de una sola columna.
>
> **Y una cuarta, `6952393`, que es la que más cambia dónde se escribe: todo gate que corre desde
> un `package.json` es del LEAD**, no sólo el de `apps/web` (la fila decía `*-lint.mjs`; el sufijo
> dejaba afuera a `purity-check.mjs` — ver la enmienda de ADR-022). Alcanza a `packages/db/scripts/rls-lint.mjs`, que hasta
> ese día era de `db-agent` — el mismo writer cuyas policies audita. **ADR-022.** Para el que busca
> dónde pedir una regla nueva de RLS: se pide, no se agrega.

## Estado — 2026-08-28

> ### 🔴 Antes que nada: `.github/workflows/ci.yml` **nunca corrió**
> `git ls-remote --heads origin` está **vacío** contra **110** commits locales sobre `68c0bd6`
> (eran 89 el mismo día, después 103: **crece el denominador, no el numerador**); `origin/main` figura
> `gone`. Todo *"corre en CI"* de este índice, de `SLICE_BOARD.md` y de `DECISIONS.md` significa
> **"`ci.yml` declara el step"** — nivel 1. Nivel 2 (corrió en `ubuntu-latest`, sobre este commit) no
> lo alcanzó **ningún** gate del repo. Misma distinción que ADR-016 fijó para `"status": "active"`
> del WAF: el archivo declara, no ejecuta. No es teórico: `accept-s1.sh` usaba `stat -f %m`, que en
> GNU significa `--file-system`, y habría salido **verde midiendo basura** en Linux (`c854b99`).
> **Lo destraba un `git push`, y no es una fila de ningún board.** Detalle:
> `SLICE_BOARD.md` §"Seis gates rojos o dormidos" · `DECISIONS.md` §Notas operativas.

**FASE 0, FASE 1 y FASE 2 cerradas.** El LEAD re-ejecutó el gate de FASE 2 el 2026-08-27 y **D1–D4
pasaron a `done`** con la corrida registrada en `SLICE_BOARD.md`. **S1, S2, S3, S4, S6, S7 y S8 están
ACEPTADAS** — las corridas están fechadas abajo, una por una. (Esta línea decía *"S1, S2, S3 y S4"*
hasta el 2026-08-28, cuando ya había tres slices aceptadas más; el drift es del tipo que este índice
existe para no tener.) **No hay `S5`**: es deuda de proceso declarada, no un olvido —`SLICE_BOARD.md`
§S5. **FASE 3 (K1–K5) sigue sin re-ejecutar**: su gate termina en
`next build` y no se corrió. El código de FASE 3 está escrito, pero **el gate es la corrida, no el
código** — es la misma regla que tuvo a S1 en `doing` y a S2 en `todo` un día largo con el código ya
en `main`.
Lo que hay que saber sin leer nada más:
- La vidriera es `proxy.ts` + rewrite a `/s/{slug}` + `'use cache'`. **El slug en el path no es
  estilo: sin él, dos tenants comparten entrada de cache.** (ADR-007)
- **`cacheLife` es una decisión de costo**: `'max'` = USD 0.012/tenant/mes, `revalidate: 60` = USD
  2.59. La segunda revienta el objetivo sola. (`COST.md` §2)
- El chatbot se come **~75% del presupuesto de infra del plan Pro**. Está dentro, pero ya no es
  ruido. (`COST.md` §0)
- **ENACOM corta a 5 consultas/día por IP** → nada de consultar en el alta masiva. (ADR-009)
- **R4 (Mercado Pago) está PARCIAL y frenado por la regla 3.** Se cierra con sandbox, no con
  research. (ADR-008)
- Blocker con más lead time: **B5**, migrar los nameservers de `maat.work` a Vercel (24–48 h).
- **El techo de request body que manda es 4 MB** (Routing Middleware), no 4.5. Por eso entra **una
  foto por request**. La slice que lo levanta es **S2.1** y está `blocked` en B1 — y arrastra una
  pregunta abierta entre las reglas 1 y 4 de `media-agent` que hay que contestar antes de empezar.
- **S1 y S2 están `done`: el LEAD re-ejecutó los dos gates enteros el 2026-08-28** — `accept-s1.sh`
  26 PASS / 0 FAIL, `accept-s2.sh` 21 PASS / 0 FAIL, los dos con `EXIT=0`. **Repetido más tarde ese
  día en el barrido serial sobre `68c0bd6`: `s1 PASS=39` y `s2 PASS=21`.** El salto de S1 **no es
  cobertura nueva**: son las once aserciones que se evaporaban porque `chk` y `have` no estaban
  importados, más A2 reescrita (**ADR-020**). Ninguna pasa por
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
  0 failed** — números **de esa corrida**, no los de hoy: los actuales (1225 y 86) están al final de
  esta sección. El click del botón de WhatsApp deja **una** fila en `wa_click_events` y nada más:
  `filas_al_cargar=0 · filas_antes=0 · filas_despues=1` (dispara en el **click**, no en el **view**),
  `filas_creadas=0` en el cruce de tenants, y `anchors=1 · abre_whatsapp=si` **con JavaScript
  apagado** — la telemetría nunca se pone adelante de la venta. Sin PII: no se anonimiza, **no se
  recibe**. Dos desvíos de la spec, los dos correctos y los dos registrados en el board: un
  `<script>` inline de 412 B en vez de un Client Component (lo prohíbe **W001**, y encima engancha al
  parsear y no al hidratar), y un `insert … select from listings` en vez de `insert … values`
  (con `values`, el uuid de otro tenant resuelve a **NULL** y la fila se escribe igual por la rama
  `listing_id is null` del `WITH CHECK`).
- **S4.1 cerró el 2026-08-28, y era de conversión, no de seguridad:** cuando el listing **no tiene
  `catalog_model`**, el mensaje decía `iPhone 14 Pro 256 Grafito 256 Grafito (usado A)` — el fallback
  al `title` (texto libre del dueño, que ya trae storage y color) más el append de `describeListing`.
  **No era artefacto del fixture:** `catalogModelId` es nullable y `onDelete: 'set null'`. Y es la
  segunda vez que el repo paga la misma lección: **tres pruebas alrededor del string y ninguna encima
  del string completo en el camino real.** Gate primero y en rojo (`7e40856`: M3b de `accept-s3.sh` +
  W5 de `accept-s4.sh` exigen que el equipo nombrado **no repita un token**), fix después (`07c42ff`:
  `nameSource` requerido **sin default**, `resolveModelName` como único constructor, `isBlank`
  tratando `''` como ausente). **La cierra la barrida completa del LEAD anterior a `cbbfa2f`**, que
  corrió `accept-s1..s4` + `accept-s6` en verde, o sea **después** del fix y con la aserción adentro.
  Salvedad: de esa corrida consta el veredicto, **no el conteo de PASS**. Los `37 PASS` que este
  índice citaba para S4 son de la corrida **anterior**, la que imprimió el defecto y lo dejó pasar, y
  no sirven como evidencia de S4.1. **El conteo apareció el 2026-08-28** en el barrido serial del
  LEAD sobre `68c0bd6`: `accept-s4 PASS=38 · FAIL=0` (y `accept-s6 PASS=22 · FAIL=0`, el primer
  número que el repo puede citar para S6). Ese es el que vale hoy.
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
  tuvo a S1 en `doing` un día. El alta y el cron de expiración sincronizan el TC oficial del BCRA
  con cache diaria en
  `fx_settings` por tenant, `applyFx` con default `ceil_1000` tiene 187 tests verdes en `@istock/domain`, y el ARS de
  la ficha lo exige M3 de `accept-s3.sh` en la corrida de 58 PASS del LEAD. **El hueco que queda no
  es de S5: es T12**, que el dueño no puede *editar* el TC después del alta. Contarlo dos veces
  escondía que lo que falta es una pantalla, no el FX.
  **Deuda de proceso anotada el 2026-08-28, y es del LEAD:** S5 está `done` **sin comando de
  aceptación propio**, y `grep -rn 'S5' scripts/ .github/` devuelve **dos comentarios y cero
  aserciones**. O sea: borrar M3 de `accept-s3.sh` le saca a S5 su evidencia **sin poner nada en
  rojo**. El repo ya resolvió esto una vez —W1 de `accept-s4.sh` **nombra** las aserciones que
  sostienen S4, así que borrar M3b pone roja también a S4—; S5 no tiene ese hilo. Las dos salidas
  (un `accept-s5.sh`, o una verificación al estilo W1) están en `SLICE_BOARD.md`; la elección es del
  LEAD, porque los gates son suyos por §4.
- **S6 (reserva + scheduler) está `done`** (`cbbfa2f` + `10d31b6`, `app-agent`). Server Actions de
  reservar/cancelar en el panel, barrido manual detrás de `GET /api/cron/expire-reservations`,
  invalidación de la ficha pública **por unidad** (`invalidateStorefrontUnit`, no el catálogo entero)
  y agenda vigente en Inngest Free: `expireReservations` en `apps/web/inngest/functions.ts` usa
  `cron('*/5 * * * *')` y `apps/web/app/api/inngest/route.ts` la expone. `vercel.json` conserva
  únicamente `$schema`. **ADR-017 es corte histórico**: documenta la agenda Vercel Cron anterior,
  no el scheduler vigente. El LEAD re-ejecutó `scripts/accept-s6.sh` con V1–V10 y S6 quedó aceptada
  localmente; siguen `UNVERIFIED` la cuenta Inngest Free, la sincronización/configuración, las
  claves, el deploy y la corrida real programada.
  **`adversary-reviewer` la rechazó primero**, y el bloqueante era una regresión de la propia slice:
  `transitionContextFor()` recibió el parámetro `extras` y quedó un caller sin actualizar, así que
  toda transición se evaluaba con `activeReservation: null` — *"Publicar"* sobre una unidad reservada
  devolvía ok y el equipo volvía a la vidriera **como Disponible con la seña puesta**. **El typecheck
  no podía verlo porque el parámetro era opcional y su default un valor válido**; el fix fue **borrar
  el default**, no pasar el dato. Dos cosas para leer junto al `done`: **(a)** el residuo se cerró el
  2026-08-28 —el LEAD declara haber re-ejecutado `scripts/accept-s6.sh` **en su forma actual**, la
  V8 que mide una corrida y no la que grepeaba el fuente— **con una salvedad que no se redondea:
  consta el veredicto, no el conteo de PASS**, mismo caso que la corrida que cerró S4.1;
  **(b)** dejaba abierta **S6.1**, ya cerrada (abajo). Y dejó abierto algo que no es residuo de
  proceso sino de gate: **la V5 de `accept-s6.sh` se llama *"señar no purga la vidriera entera"* y lo
  que ejecuta es `grep -rqE 'invalidateStorefrontUnit'`** — durante todo el defecto de S6.2 la
  función se llamaba así **y purgaba la vidriera entera**, con el gate en verde.
- **S6.1 cerró** (`83bc673`, `domain-agent` + `app-agent`) y es **ADR-019**: *en qué queda una
  reserva cerrada lo decide la tabla del dominio; el call site sólo declara su intención*. El defecto
  no era un valor mal puesto sino **dos call sites decidiendo por separado sobre la misma arista**
  —el cron escribía `expired`, el panel `cancelled`, y los dos tenían tests verdes—. El efecto dejó
  de ser un booleano y pasó a ser `closesReservationAs: 'confirmed' | 'expired' | 'cancelled' | null`,
  y el `intent` es **obligatorio aunque admita `null`**, porque un parámetro opcional con default
  válido no distingue *"no me lo pasaron"* de *"me pasaron que no hay"* — que es exactamente lo que
  ya había roto S6 con `extras`. **Residuo abierto: `T18`** — en `main` (`f504d69`)
  `cancelReservation()` todavía escribía `'cancelled'` a mano en vez de preguntarle a la tabla; hoy
  **acertaba por casualidad**, y ésa es justo la forma en que este defecto vuelve. **Corregido el
  2026-08-28: el arreglo está en `main` y este índice decía lo contrario.** Los tres call sites
  derivan hoy de `transitionEffects(...).closesReservationAs` — `reserve-unit.ts` ·
  `cancelReservation` (`398fff7`), `expire-reservations.ts` (`b9a8e05`) y `publish-listing.ts` — y el
  censo de literales en la familia de reservas da **cero**. **`T18` está `done` desde el 2026-08-28**,
  con `bash scripts/accept-s6.sh` re-ejecutado por el LEAD (`S6: ACEPTADA`, exit 0); este índice decía
  *"pasa a `doing`, no a `done`: falta la corrida"* y quedó vencido cuando la corrida ocurrió —
  `SLICE_BOARD.md` §T18 es la fuente.
- **S6.2 cerró** (`f504d69`) y es la corrección más cara de leer del día: `invalidateStorefrontUnit()`
  **purgaba la vidriera entera**. Reservar **una** unidad en un tenant de 60 equipos tiraba abajo las
  **61** páginas, porque **un tag de cache es un OR** y la ficha registraba también los tags de
  tenant. Lo encontró `cost-auditor` auditando S6 (`e3f3703`): cold-hit hacia **~39%** contra una
  alarma de 5%. Medición del LEAD después del arreglo: `rerender=2 · esperado=2 ·
  sobrevivieron=[ficha-a,ficha-c,ficha-d]`; **antes, en un clone desechable, `rerender=5` de 5.**
  La topología final (quién registra qué tag) está en `ARCHITECTURE.md`, y **hay que leerla antes de
  emitir un tag a mano**: el camino de HIT de la ficha ya **no** registra `storefront:{slug}`, así
  que quien cambie el **TC** con `invalidateStorefront()` va a actualizar la grilla y dejar cada
  ficha con el precio viejo **hasta un año**, sin error y sin log (**T12**).
- **S7 (venta manual) está `done`: el LEAD re-ejecutó `bash scripts/accept-s7.sh` el 2026-08-28 →
  `S7: ACEPTADA`**, sobre seis commits (`df00474`…`60b3def`, **ninguno pusheado**). **Sin conteo de PASS
  registrado** —consta el veredicto, mismo caso que S4.1 y la primera corrida de S6—; lo que sí tiene número
  es el árbol: `pnpm typecheck` 7 proyectos, `pnpm lint` PASS (16 reglas web), `pnpm test` verde
  (`apps/web` 658/4 skipped · `tests/` 291), **12** `guard-*.sh` y **9** `accept-*.sh` en verde.
  **`pnpm e2e` NO se corrió** (requiere `next build`) y no se cuenta como verde. El defecto que abrió la
  slice: `packages/domain` declaraba `createsSale` y **nadie lo ejecutaba** —`transitionUnit()` corría tres
  de los cuatro efectos y descartaba el cuarto en silencio—, misma clase que el bug de S6. La venta se
  escribe **adentro** de la transacción que mueve el estado, el costo se copia con un subselect dentro del
  `INSERT` y el margen lo deriva Postgres, así que ni el costo ni el margen pasan por el heap ni vuelven en
  el payload. **Tres cosas para leer junto al `done`:** (1) la celda de gate del board decía *"sale de la
  grilla"* y **eso no es lo que hace el producto** —`sold` sigue en la vidriera con badge `Vendido`, que es
  lo que ya decían `PRODUCT.md` Q2 y `DOMAIN.md` §190—, corregido en el board; (2) **ADR-025** la redactó
  `docs-keeper` y el **LEAD la ratificó el 2026-08-28** (aceptada), con la regla reusable adentro: *un
  índice único se evalúa antes que cualquier policy de lectura*; (3) abrió **P4** (siete FKs a `listings.id` sin
  `tenant_id` en el par) y **P5** (ninguna policy de `sales` mira `membership_role`: **el único invariante
  de producto que hoy cuelga de una sola capa**, hoy tapado por **B2**), más **T33** y **T34** del lado de
  los instrumentos. **Al cierre del 2026-08-28: `T33` está `done`** —`G5` de `guard-gates.sh` censa que
  toda probe de `scripts/probes/` la corra algún `accept-*.sh` **y** compile, `GUARD-GATES: PASS`
  corrido por el LEAD, commit `5b6061e`— y **`T34` también** (`2ccb8a1`), cerrada por la corrida del LEAD
  del 2026-08-28 —`GUARD-EFFECTS: OK` y `POLARIDAD EFFECTS: OK — 10 casos`—. **Hizo falta que la
  corriera él y no alcanzaba ninguna otra:** los dos comandos son scripts de shell y `pnpm test` no
  los alcanza, así que el árbol entero en verde no decía nada sobre esa fila. **`T35` y `T36` son nuevas y
  salieron de la misma pasada**, las dos levantadas por `app-agent` sobre su propia columna: `T35` es
  la deuda escrita de `publish-listing.test.ts`, que fabrica a mano la forma del `PostgresError`
  (severidad baja: hoy la forma es fiel, pero por conocimiento y no por construcción); `T36` **no
  tiene nada que arreglar en el código** y existe para que nadie la redescubra creyendo que encontró
  una fuga — el IMEI que aparece en la salida de vitest es sintético y lo mete **Drizzle**, que
  concatena los parámetros del `INSERT` adentro del `message` del `DrizzleQueryError`; el camino de
  producción está cerrado (`logError()` no recibe el `Error` crudo) y hoy **no hay SDK de Sentry
  instalado**, que es la condición bajo la cual dejaría de ser inocuo.
- **S8 (canje) está `done`: el LEAD re-ejecutó `./scripts/accept-s8.sh` el 2026-08-28 →
  `S8: ACEPTADA`** (V1…V5), sobre **ocho** commits (`abbb9c2`…`7d07763`, **ninguno pusheado**), con
  cinco columnas adentro: `storefront-agent` (form + endpoint + proxy), `app-agent` (inbox +
  accept-to-stock), `db-agent` (migración `0008`), `qa-agent` (la auditoría de referencia cruzada) y
  el **LEAD** (gate, probe y los dos lints). El parte que V5 compara campo por campo contra literales
  escritos en el propio gate: `lead_anonimo_entra=1 · lead_sin_claim_no_entra=0 ·
  lead_a_tenant_ajeno=0 · offer_usd_desde_anon=0 · returning_desde_anon=0 · checks_del_motor=1 ·
  accept_crea_unidad_en_draft=1 · accept_dos_veces_una_unidad=1 · costo_en_el_payload_del_seller=0 ·
  canario_rol_anon=1 (20 transacciones)`. Árbol de la misma corrida: domain **201** · media **164** ·
  ai **472** · db **390** · `apps/web` **777** (+4 skipped) · `tests/` **391** — **fechado y no
  sumado contra el `1225` viejo**, y **no todo el delta es de S8**. **`pnpm e2e` NO se corrió**
  (requiere `next build`).
  **Lo que hay que leer junto al `done`, y son tres cosas de método antes que de canje:**
  (1) **`canario_rol_anon` es el primer campo del parte que hay que mirar** — `SET LOCAL` fuera de un
  bloque de transacción es un **no-op que sólo emite un `WARNING`**, así que todo corre como
  superusuario, que bypassea **RLS y `GRANT` a la vez**; sin el canario, **dos de los nueve casos
  siguen pasando** con el cambio de rol sacado, o sea que el gate daría verde midiendo nada.
  (2) **un caso que no corrió reporta `-1`, no `0`**: `lead_a_tenant_ajeno=0` es un PASS y *"sin
  medir"* es un FAIL, y con los dos en `0` no se distinguen (familia de **ADR-020**).
  (3) **W015 tenía un agujero de una columna**: buscaba la **subcadena** `'from'`, y
  `listing_events.from_status` —que existe hoy en el schema— movía la ventana de vuelta adentro del
  paréntesis, así que **el gate tenía un caso de test que pasaba y una variante de UNA columna que lo
  apagaba**, sobre la tabla del historial de estados. La moraleja es reusable: *ningún fixture del
  arnés usaba un identificador que contuviera la palabra que la regla busca*.
  **Abrió `ADR-026`** (la PII del visitante se parte en escritura y lectura), **ratificada por el
  LEAD el 2026-08-28**, y **T37**…**T43**. **`P5` creció** —`membership_role` tampoco aparece en las
  policies de `tradein_leads`— y **sigue abierto, declarado y no tapado**.
- **S8.1 · `done` el 2026-08-28** (`db-agent`, migración `0009`). Tres cosas del encargo, dos entraron
  como se pidieron y **una entró distinta con razón**: el `CHECK` pedido **no se puede escribir** —un
  `CHECK` no se difiere y habría explotado en la primera sentencia de `acceptToStock()`, que escribe el
  `status` antes que la unidad porque ese `update` **es** el guard de concurrencia; aceptar un canje
  habría pasado a ser un 500—, así que es un `CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED`.
  Las otras dos: `accepts_trade_in` **adentro** de la policy (el primer `ALTER POLICY` del repo) y
  `listings.acquisition_channel` con backfill. **Gate nuevo del LEAD:** `scripts/guard-tradein-engine.sh`
  + su arnés de 15 fixtures, los dos en `ci.yml`, `guard-gates` **PASS con 29 gates censados**, y
  **V6** de `accept-s8.sh` dejó de ser inline. Censa el **árbol de `.sql`** y no la base, porque el
  migrador de Drizzle compara `created_at` y no el hash.
- **`T43` · `done` el 2026-08-28**, dueño **`qa-agent`** asignado por el LEAD.
  `tests/la-pii-del-visitante-no-sale-de-la-fila-del-canje.test.ts`, 16 casos.
  **Lo reusable no es que se cerró, es cómo: el test no busca los nombres de las columnas de PII en
  los sinks, busca por FORMA** — a un sink sólo le llega un literal, una constante literal del módulo,
  o un identificador cuya cola matchea `SAFE_ATOM`. Un test que grepea nombres lo esquiva cualquiera
  que escriba `log(lead)`, y ése es el caso que va a pasar. La distinción que justificaba la fila
  sobrevive: **medido no es testeado**.
- **Seis filas nuevas de FASE 4 bis, todas de huecos que levantaron los agentes y ninguna cerrada acá:**
  **T44** (un prefijo pertenece a un solo documento — `P<n>` estaba en `PRODUCT.md` y en el board;
  se renumeró `PRODUCT.md` a `Q<n>` porque las citas de gates y de código apuntan al board · **LEAD**),
  **T45** (la parte B de la `0009` no tiene auditoría cruzada en `tests/`: hoy la cubren los dos
  writers y un grep · `qa-agent`), **T46** (`TODO: después el RLS` es la única prohibición de
  `CLAUDE.md` §2 sin test ni lint · **LEAD**), **T47** (un comentario del `config.matcher` de `proxy.ts` explica una fragilidad del
  parser de matchers que ya no existe · `storefront-agent`), **T48** (el header de la `0009` se
  autotitula `S9`, y `S9` es otra slice · `db-agent`, **no lo toca `docs-keeper`: es su columna**) y
  **T49** (el soft cap del chat, 40 msgs/tenant/día, es una **cuota compartida**: una sola IP la agota
  en veinte minutos y deja el chatbot mudo · `ai-agent` la forma, **LEAD** la política).
- **El objetivo de costo es por plan desde `ea26a02`: Base ≤ USD 0,50 · Pro ≤ USD 1,50**, con el
  1,50 = *0,50 + hasta 1,00 atribuible al chat*. **Una slice de vidriera, panel o media se mide
  contra 0,50 aunque el tenant esté en Pro.** La fuente del número es **`COST.md`**
  (`cost-auditor`); ningún otro doc lo re-deriva.
- **Abiertas al cerrar esta pasada (2026-08-28):** **S2.5** — el guard de IMEI de `packages/media`
  rechaza keys legítimas: una key content-addressed es hexadecimal y cae sola en `/\d{15}/`, o sea
  **1 de cada 158 variantes**, **1,88% de las fotos imposibles de subir para siempre** (la key es
  determinista: reintentar da el mismo rechazo) y **57% de los onboardings de 15 equipos**. Ataca el
  *done cobrable* de `CLAUDE.md` §1, y de segundo orden **cuelga la ficha**, porque el mismo guard
  corre dentro del `'use cache'` y un throw ahí es un 200 que nunca cierra el stream. **Corregido el
  2026-08-28: el arreglo está en `main`** (`1fc0e59`, `6e74a51`) y lo que falta es la aceptación. · **T18** (arriba) · **T19** (**corregido el
  2026-08-28: `packages/ai` EXISTE** en `main` desde `d42fac9`, con 19 `*.test.ts`; `ls packages/`
  devuelve `ai db domain media`. E7–E9 y S7 de `TEST_MATRIX.md` pasaron de 🔴 a 🟡 **pendiente de
  censo** — que el paquete exista no es que la regla esté cubierta. **El censo se puede tomar y sigue sin tomarse, y tomarlo es auditar, no escribir**: por eso `T19` está en `todo` y no en `doing` (`CLAUDE.md` §0 regla 1, segunda precisión, commit `1414302`)) · **T21–T25** (el barrido de reservas conserva para siempre la primera fila que
  falla: `T21` `db-agent` — columna `sweep_attempts` + `GRANT`; `T22`–`T24` `app-agent`; `T25` el gate,
  LEAD, en `scripts/probes/`. Hallazgo de `cost-auditor`, `COST.md` §2.5: nos cuesta USD 0,0015/mes
  por unidad trabada y al reseller USD 15–22 sobre un plan de 19). **Ojo con `T21`: sigue `doing` y
  lleva `1 fallo de aceptación`** — al segundo, `CLAUDE.md` §0 regla 3 obliga a parar y re-planear.
  **Lo que cambió el 2026-08-28: el motivo del `doing`.** El arreglo de `db-agent` ya no está en un
  árbol de trabajo, está en `main` (`63abcb7`: la migración `0006` con el candado mudado al
  `WITH CHECK` de la policy, el test reescrito con `toSQL()`, y la sección **3b** de `rls-lint.mjs`).
  Lo que falta es la re-ejecución de `scripts/accept-s6.sh` **entero, e2e incluido**, por el LEAD —
  la misma corrida que la rechazó.
- **T21 falló su aceptación el 2026-08-28, y el fallo dejó un gate y una ADR.** `db-agent` la reportó
  verde declarando que **no** había corrido e2e; el LEAD re-ejecutó `scripts/accept-s6.sh` entero y
  pasó de VERDE a **RECHAZADA**: `42501 permission denied for table reservations` en los dos specs
  e2e, o sea **reservar un equipo desde el panel roto**. La migración `0006` había re-otorgado el
  `INSERT` **columna por columna** dejando afuera la columna nueva, y **Drizzle nombra todas las
  columnas en `insert().values()`** aunque vayan con `default`. Lo que hay que leer de acá no es el
  bug sino quién lo agarró: **`guard-grants.sh` dijo PASS con el panel roto** —cuenta que el `GRANT`
  exista, y uno parcial existe— y el que lo encontró fue **e2e**, el gate más caro del repo. El LEAD
  puso la misma afirmación en un lugar barato: **`G6`**,
  `scripts/probes/el-grant-cubre-el-insert-de-drizzle.test.ts`, sección **D5** de `accept-fase2.sh`,
  que le pregunta al catálogo de Postgres y **no** ejecuta un `INSERT`. **No entró adentro de
  `guard-grants.sh` a propósito**: ese guard declara ser 100% estático para correr sin base en el
  pre-commit. La lección general es **ADR-021 — *la aserción tiene la forma del caller, no la forma
  cómoda***: el test que "probó que el panel podía insertar" escribía él mismo una sentencia que
  **ningún caller emite**. No era un gate vacuo; medía a un **sujeto inventado**. Es familia aparte
  de ADR-020 y por eso tiene número propio: las cuatro reglas de ADR-020 le habrían dado verde.
  Detalle en `SLICE_BOARD.md` §"T21 · el primer fallo" y en `TEST_MATRIX.md` §"Un sexto caso".
- **El copy de `reserved` de la vidriera prometía algo que nadie puede cumplir, y cambió**
  (2026-08-28, `apps/web/app/(storefront)/_lib/status.ts`, con tests). Decía *«si la reserva se cae,
  avisamos»*: **no existe nada que avise** —no hay lista de espera, no se guarda un dato del
  visitante, la vidriera no tiene DB propia— y el que quedaba mal era el reseller, en su propio
  dominio. Además degradaba el CTA a *«Preguntar por WhatsApp si se libera»*, contra `CLAUDE.md` §1
  (un solo botón `wa.me`, y es el de comprar). La regla que queda está en `DOMAIN.md` §"El copy
  público no compromete una acción futura nuestra" y **vale también para el chatbot de FASE 5**.
  `packages/domain/src/wa.ts` quedó alineado en la misma pasada. **Corregido el 2026-08-28: las dos
  mitades están en `main` (`7c1cc49`)**; lo que sigue faltando es la corrida de gate, que es otra
  cosa y ahora es la única que falta. La frase vieja quedó citada en `COST.md`
  (`cost-auditor`, no es de `docs-keeper`): el argumento de costo sigue en pie, lo que envejeció es
  la cita, y **la despacha el LEAD**.
- **`W016` cerró la última prohibición de `CLAUDE.md` §2 sin gate ejecutable** (2026-08-28, LEAD,
  `apps/web/scripts/web-lint.mjs`; fila **T26**). Era *"rate limiting con contador en Postgres sobre
  la vidriera → rechazo"* — la censó `qa-agent` como **T14.1**, y era la más barata de violar sin
  darse cuenta porque **anda**: tres líneas de Drizzle. `guard-firewall.sh` cubría **la mitad de
  afuera** (que exista la regla de WAF); nada impedía escribir el contador igual y quedarse con las
  dos capas, pagando la cara. **Dos brazos que no se implican:** el concepto nombrado en un archivo
  de `(storefront)` que **abre Postgres**, y la **forma** del contador (`onConflictDoUpdate`, `+ 1`
  dentro de un template de `sql`, `increment`) **aunque no se llame *rate limit***. El primero mira
  la **línea** y no el archivo, porque el docblock de `track/route.ts` abre Postgres y **explica la prohibición
  en su docblock**: una regla que se encienda ahí castiga por documentarse, que es el `TODO`/`TODOS`
  de `guard-leaks.sh` otra vez. **Sin marcador de exención, a diferencia de W015**, y con motivo
  escrito: no existe la vidriera que legítimamente cuente en Postgres. **Falla cerrado** —
  `(storefront)` vacío = rojo. Medido: `WEB-LINT: PASS (16 reglas)` · `ok W016 ninguno de los 23
  archivos de (storefront) cuenta requests en Postgres` · `POLARIDAD WEB-LINT: OK — las 16 reglas se
  vieron encender`. **`done` el 2026-08-28 con `d37e6b3`**, que es lo único que faltaba: los tres
  archivos estaban sin commitear, y en T2 este repo ya había aprendido que después de *¿hay
  chequeo?* y *¿lo corre alguien?* viene ***¿está en `main`?***. Verificado contra `main`, no contra
  el árbol: `git show HEAD:apps/web/scripts/web-lint.mjs | grep -c W016` → **4**.
- **El residuo de T2 se cerró y este índice decía lo contrario:** *"la polaridad de W015 no es un
  comando"*. Lo es desde `a015437` — **`scripts/web-lint.test.sh`**, con step `polaridad de web-lint` en `ci.yml`, 45
  casos, **12 de ellos de W015** (incluidos *presencia no es filtro*, *proximidad no es alcance* y
  *schema ilegible = FAIL*). La pregunta abierta que el board le dejaba al LEAD queda contestada, y
  la observación que la sostenía —*"`ls apps/web/scripts/` devuelve un solo archivo"*— era cierta y
  **miraba el directorio equivocado**: el arnés vive en `scripts/`, con los otros del LEAD.
- **`docs/CHATBOT.md` ofrecía un modelo muerto y no tenía dueño correcto** (2026-08-28, drift de
  FASE 1). Daba como fallback `llama-3.1-8b-instant`, **retirado el 16/08/2026** para free y
  developer tier (`docs/research/llm-pricing.md:151-159`); `CLAUDE.md` §3 ya lo había corregido
  y el doc quedó atrás. Ahora dice **`openai/gpt-oss-20b`** y que los IDs viajan por env var.
  Le faltaba además el header obligatorio (*qué es / para quién / cuándo se actualiza*) y se
  declaraba `Owner: ai-agent`: **cuarto archivo con el mismo patrón**, pero acá ni siquiera
  había conflicto de fuentes — `.claude/agents/ai-agent.md:46` ya decía *"vía `docs-keeper`"*.
  **El resto del archivo sigue sin revisar desde FASE 1, y ahora urge porque el código llegó
  primero** — `packages/ai` **existe** desde `d42fac9` (`T19`), así que el diseño de FASE 1 escrito
  en `CHATBOT.md` no está re-verificado contra lo implementado:
  hay que releerlo contra `llm-pricing.md` antes de codear, y eso quedó escrito arriba de todo
  en el propio doc para que no se lea como diseño vigente.
- **Números vigentes del árbol** (2026-08-28, después de **S8.1**, medidos por el LEAD): `tests/`
  **418** · `packages/db` **439** · `apps/web` **778** (+4 skip) · `packages/domain` **201** ·
  `packages/media` **164**. **`packages/ai` no se cita**: estaba en movimiento al tomar la medición y
  un número a medio camino es peor que uno viejo. **e2e 86/86** con censo de specs **13/13**, corridos
  por `qa-agent` — `docs-keeper` no los verificó, requieren `next build`.
  _(La corrida anterior registrada, sobre `f504d69`, decía **1225** = domain 199 · media 107 · db 300 ·
  web 365 · tests 254. Se conserva en `TEST_MATRIX.md` fechada: una cifra de corrida se fecha, no se
  reescribe.)_
- **Regla de método vigente: un gate que nunca se vio fallar no es un gate.** Dos gates estaban
  verdes por vacío desde S1 (la regla del `TODO` no podía disparar nunca) y una regla del
  `guard-leaks` exigía citar el ADR equivocado. Toda regla nueva se prueba en **las dos
  polaridades**. Detalle en `SLICE_BOARD.md`. **Dos casos más el 2026-08-28**
  (`DECISIONS.md` §"Notas operativas"): un gate se satisfacía con un `import` —hay que verificar
  **la invocación, nunca la presencia del símbolo**— y `guard-artifacts.sh` sin argumentos daba
  `PASS` con cero archivos chequeados. **Tres casos más el 2026-08-28, y los tres cerrados**
  (**ADR-020**): V5 de `accept-s6.sh` (afirmaba una conducta y grepeaba un identificador; el radio
  ahora se **cuenta** en la **V9** nueva), A2 de `accept-s1.sh` (grepeaba el domicilio de ayer, y
  encima se evaporaba porque `chk` no estaba importado) y M1 de `accept-s3.sh` (escaneaba
  comentarios y reprobaba prosa correcta). La parte mecánica la cierra **`scripts/guard-gates.sh`**
  —ningún gate invoca un helper que no tiene, ni redefine uno de `_lib.sh`— con step en
  step `gate de los gates` de `ci.yml`, y polaridad de **nueve** fixtures en `guard-gates.test.sh`. **`T20` cerró el 2026-08-28**: ese gate no
  se auditaba a sí mismo y su mensaje contaba de más (21 impresos, 20 auditados); hoy `_lib.sh` entra
  a G1, G2 lo exceptúa **con motivo escrito**, y el número impreso es `AUDITADOS` —el de los archivos
  realmente medidos—, con ausencia de la línea = FAIL. **Corolario nuevo: un fix cuya reproducción
  no se vio encender no está probado.** **Y su polo opuesto, medido el 2026-08-28 con `T32`: un gate
  recién nacido que **enciende** tampoco es evidencia de un defecto hasta que el defecto se reproduce
  **sin** el gate.** La primera versión de `guard-doc-tables.sh` encendió sobre `T28` y ahí no había
  nada roto: el hallazgo era el bug del propio gate. La premisa invertida costó las dos polaridades a
  la vez — un falso negativo (el caso del arnés salía verde) y un falso positivo (`T28`). Las reglas de R2 de `CLAUDE.md` §2 ya tienen gate:
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
  enum cerrado `["challenge","deny"]` y `rate_limit` aparece **cero veces**. **`vercel.json` conserva
  hoy únicamente `$schema`**; la mención histórica a `crons` correspondía al estado anterior de S6.
  F5 de
  `guard-firewall.sh` sigue afirmando que no pretende declarar rate limits. Las reglas viven en `config/firewall-rules.json` (**LEAD**) y se aplican por CLI, que
  **no es parte del build**. **Son 3 desde `cb4fe3f`, no 2** (`guard-firewall.sh` §F1: `3 reglas declaradas`):
  la tercera es **`storefront-tradein-rl`** (`5` req / `600 s` por `ip`, `deny`, `planned`, `lands_with: S8`),
  **más dura que la de `/api/track` a propósito** — el canje es la **segunda** escritura sin autenticar
  del producto y es más cara en las dos monedas que importan: escribe **texto libre de un anónimo**
  (`model_text`, `notes`) y es una fila que **el dueño lee en su inbox**, así que un flood no infla una
  tabla, arruina la herramienta. **Llegó antes que su handler**, que es la conducta que el censo vino a
  producir. **Declaradas y validadas ≠ aplicadas:** no hay proyecto Vercel (**B2**,
  **B5**). `/api/track` **ya existe** —aterrizó con **S4**, no con un "S4b" que nunca fue una fila del
  board— y su regla pasó a `active`; `/api/chat` sigue esperando la **FASE 5**. Lo que hace fuerte al gate no es validar el JSON sino el **censo**: hoy **6** route
  handlers —el número era **5** y lo movió el árbol, no el gate; re-medido por `docs-keeper` el
  2026-08-28 con `GUARD-FIREWALL: PASS`, **5 exceptuados con motivo** y **1 cubierto por regla**—, los 6 decididos, y una ruta nueva sin decidir lo rompe **el día que se crea** — pasó con
  el cron de S6, que entró a la allowlist **con motivo escrito** en vez de con una regla, porque un
  techo mal calibrado ahí apaga la expiración de reservas en silencio — y desde
  `3199a78` **el gate y su polaridad tienen step en CI** (steps `gate de reglas de WAF` y `polaridad del gate de WAF` de `ci.yml`), así que eso dejó de
  depender de que alguien se acuerde — *step declarado*, no ejecutado: ver el recuadro rojo al tope
  de §Estado. Y ninguna regla condiciona por `host`: se facturan los
  *allowed requests*, así que eso le cobraría peaje a cada pageview de vidriera, que
  `ARCHITECTURE.md` declara scrapeable a propósito — y `cost-auditor` lo midió: rechazarla le sacó
  al plan Base el **77%** de su costo marginal (0.124 → 0.03). Todo esto es **ADR-016**, abierta y
  ratificada por el LEAD el 2026-08-28. **Lo único que sigue abierto de T1 es el nivel 2:** con S4,
  `storefront-track-rl` pasó a `active`, y `active` significa *"el archivo declara que debe estar
  publicada"*, **no** *"está publicada"*. El drift contra la config viva lo cierra
  `vercel firewall diff --json`, que **no existe todavía**.
- **La cuarta pregunta, que nació de que este índice se contradijera a sí mismo.** Hasta el
  2026-08-28 había acá dos viñetas sobre **T2**: una decía que había cerrado en `9b3d7d2` y la otra,
  doce renglones abajo, que `W015` *"en `main` no existe"*. Las dos fueron ciertas, con **horas** de
  diferencia. Se borra la segunda y queda la lección, que es más útil que la fila: la lista de
  preguntas de este repo es **¿hay chequeo?** · **¿lo corre alguien?** · **¿está en `main`?** ·
  **¿corrió el CI?**, y un índice que se actualiza por agregado —sin releer lo que ya dice— produce
  exactamente este resultado. `TEST_MATRIX.md` §"La familia gate vacuamente verde" agrega tres más,
  **las tres cerradas el 2026-08-28** con **ADR-020**, y una **quinta pregunta** que no es sobre la
  corrida sino sobre el contenido: **cuando el gate pasa, ¿qué midió?** — un conteo leído de una
  corrida, o un `grep` del fuente.
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
  que no chequea nadie —**eran tres hasta el 2026-08-28**, el rate limiting con contador en Postgres
  lo cerró `W016`/**T26**—: la imagen original >500 KB servida a la vidriera —cuyos dos chequeos
  existen pero **ninguno corre en cada push**— y el **borrado de un objeto de R2 por key**
  (**T14.3**: hay cobertura estática y un test del propio paquete, falta la auditoría de referencia
  del **efecto**). Todo eso es **T14**, `qa-agent`.
- **El driver de R2 existe** (`packages/media/src/storage/r2.ts`, `MEDIA_DRIVER=r2`). Lo que falta
  para K5 es el bucket real: ningún byte viajó nunca a R2. Eso es **B1**.
- **Ocho comandos de aceptación corrían la suite entera creyendo filtrar** (**T10**, LEAD,
  **cerrada** en `0d647c6`). El diagnóstico viejo —*"el comando no resuelve"*— era **falso y más
  benigno que la realidad**: `pnpm --filter web test -- storefront` **sí** resolvía y corría los 147
  tests del paquete con el patrón perdido, así que 4 contratos de agente y 4 skills entregaban un
  verde que no era sobre su slice. La forma que quedó es
  `pnpm --filter @istock/web exec vitest run <patrón>`, verificada en las dos polaridades. Para S3
  el comando sigue siendo `bash scripts/accept-s3.sh`.

- **Los dos resolvers de entitlements le dan motivos distintos a la misma fila apagada** (fila
  **T27**, `app-agent`, `doing`, 2026-08-28). Con la misma fila de `entitlements` en `false`,
  `hasEntitlement()` de `(billing)` contesta `flag_off` y `featureAccess()` de `(app)` contesta
  `plan` — en `main` (`b9a8e05`) el tipo `FeatureAccess` **ni siquiera tiene** el caso `flag_off`.
  No es cosmética: `publish-listing.ts` traduce `plan` a *«Eso viene con el plan Pro.»*, o sea
  que un tenant que **paga** Pro y al que un operador le apagó la feature a mano recibe una
  invitación a comprar lo que ya tiene, y no hay nada que pueda hacer. Lo levantó `billing-agent`
  desde su columna y lo dejó **fijado en un test**, no comentado. **Corregido el 2026-08-28 y este índice
  decía lo contrario** (*"`app-agent` lo está arreglando y el arreglo está sin commitear"*): **T27 está `done`**
  — el arreglo es `d85310a` y el gate `4459cff`, y el LEAD re-ejecutó `bash scripts/accept-t27.sh` →
  `T27: ACEPTADA`, 11 PASS · 0 FAIL. **La unificación completa de los
  dos resolvers no es parte de la fila y es decisión del LEAD**: `hasEntitlement()` además devuelve
  el techo (`limit`) y tiene camino de escritura.
- **El feature flag sin deploy existe como mecanismo y no tiene mano** (addendum a **ADR-018**).
  `setFeatureFlag()` es el **único** escritor de la tabla `entitlements` en toda la app —el otro
  `insert` es el seed— y **no lo llama nadie en producción**. Ese dato es el que decidió que el
  módulo de `(billing)` no se borrara cuando `(app)` creció su propio resolver. `PRODUCT.md` lo dice
  ahora al lado de la tabla de planes, para que la palanca no se lea como una capacidad del panel:
  hoy se ejerce con un `update` a mano contra Postgres.
