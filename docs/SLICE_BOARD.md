# SLICE_BOARD — estado de la verdad del avance

> Lo mantiene `docs-keeper`. Una slice pasa a `done` **sólo** cuando el **LEAD re-ejecutó**
> su comando de aceptación y el resultado fue verde. Que un agente diga "pasa" no alcanza.

Estados: `todo` · `doing` · `blocked` · `done`
**Regla:** máximo **una** slice en `doing` por directorio owner.

---

## FASE 0 — Harness

| id | título | estado | owner | gate de aceptación | artefacto |
|---|---|---|---|---|---|
| F0.1 | `CLAUDE.md` + `AGENTS.md` | done | LEAD | archivos existen, no vacíos, con ownership table | `CLAUDE.md`, `AGENTS.md` |
| F0.2 | 14 subagents | done | LEAD | `ls .claude/agents/*.md \| wc -l` → 14 | `.claude/agents/` |
| F0.3 | 9 skills | done | LEAD | `ls .claude/skills/*/SKILL.md \| wc -l` → 9 | `.claude/skills/` |
| F0.4 | 4 commands | done | LEAD | `ls .claude/commands/*.md \| wc -l` → 4 | `.claude/commands/` |
| F0.5 | templates de `/docs` | done | LEAD | 9 archivos en `docs/` | `docs/` |
| F0.6 | workflow maestro | done | LEAD | `node --check .claude/workflows/istock-build.js` | `.claude/workflows/istock-build.js` |

## FASE 1 — Research (paralelo + vote adversarial)

| id | topic | estado | archivo |
|---|---|---|---|
| R1 | Wildcard subdominios + ISR en Next/Vercel (2026) | **done** (PASS 1ª vuelta) | `docs/research/wildcard-isr.md` |
| R2 | R2 + transformaciones de imagen vs Cloudflare Images — pricing real | **done** (PASS 2ª vuelta) | `docs/research/r2-images.md` |
| R3 | Gemini Flash-Lite y Groq free tier — IDs exactos y USD/1M | **done** (PASS 2ª vuelta) | `docs/research/llm-pricing.md` |
| R4 | Mercado Pago Subscriptions API Argentina — estado vigente | **PARCIAL — STOP regla 3, bloqueado en B3** | `docs/research/mp-subscriptions.md` |
| R5 | ENACOM — URL y flujo de consulta de IMEI | **done** (PASS 2ª vuelta) | `docs/research/enacom-imei.md` |
| R6 | Catálogo Apple que se vende hoy en AR — líneas y storages | **done** (PASS 2ª vuelta) | `docs/research/apple-catalog-ar.md` |
| R7 | Amenazas: IDOR, scraping, prompt injection en SaaS multi-tenant | **done** (PASS 2ª vuelta) | `docs/research/threats.md` |
| R-syn | Síntesis → `ARCHITECTURE.md` + `DECISIONS.md` + `COST.md` | **done** | LEAD |

**Gate de FASE 1:** cada archivo con fuentes fechadas · sin cifra sin URL (o marcada `UNVERIFIED`) ·
adversary vota cada research · **cero páginas de app escritas**. → **CUMPLIDO.**

**Resultado de FASE 1.** Dos olas: 7 research + 7 adversary (1 PASS, 6 FAIL), después 6 fix + 6
reverify (5 PASS, 1 FAIL). 26 agentes, ~1.9M tokens. **R4 falló dos veces → regla 3, STOP**: no hay
tercera pasada. Causa raíz: sus preguntas abiertas **no son contestables leyendo** (páginas UA-gated
y renderizadas por JS; la adhesión de un CBU sólo se establece intentándola). Se cambió research por
**experimento**: ADR-008 abierta con 4 pruebas de sandbox. Ver el bloque `LEAD OVERRIDE` al tope de
`docs/research/mp-subscriptions.md` con las 5 afirmaciones anuladas. **R4 no bloquea FASE 2/3/4.**

ADRs cerradas: **005** (RLS por claim) · **006** (fotos, 2 buckets) · **007** (wildcard + cache) ·
**009** (ENACOM). Abiertas: **008** (MP, B3) · **010** (región, falta medición).
`docs/COST.md` pasó de todo-`[EST]` a cifras con fuente.

## FASE 2 — Domain + schema (SERIAL, nunca paralelo)

**Re-ejecutada por el LEAD el 2026-08-27. Las cuatro filas pasan a `done` con la corrida de abajo.**

| id | título | estado | owner | gate de aceptación | artefacto |
|---|---|---|---|---|---|
| D1 | `packages/domain` puro + tests | **done** | `domain-agent` | los 5 exports del gate (`applyFx`, `buildWaMessage`, `canTransition`, `expireReservation`, `publicListingDTO`) tienen **archivo de test propio**, no un test compartido | `packages/domain/src/` |
| D2 | schema Drizzle + RLS + migraciones | **done** | `db-agent` | ver **"Gate de D2"** abajo — el texto viejo era inalcanzable por diseño | `packages/db/src/schema/`, `packages/db/drizzle/` |
| D3 | test RLS cruzado (A no lee B) | **done** | `qa-agent` (ver **T3**) | Postgres real, dos claims, dos conexiones físicas, sin un solo mock de la policy | `packages/db/src/rls-cross-tenant.test.ts` |
| D4 | seed demo | **done** | `db-agent` | 8 iPhones + 2 accesorios + 1 `reserved`, **asertado en test**, no descrito en prosa | `packages/db/src/seed-data.ts` |

### Evidencia de la re-ejecución (2026-08-27)

| id | comando que corrió el LEAD | resultado medido |
|---|---|---|
| D1 | `pnpm --filter @istock/domain test` | **144 passed, 11 archivos.** Los 5 exports mapean 1:1: `applyFx`→`fx.test.ts` · `buildWaMessage`→`wa.test.ts` · `canTransition`→`listing-status.test.ts` · `expireReservation`→`reservation.test.ts` · `publicListingDTO`→`dto.test.ts` |
| D2 | `pnpm --filter @istock/db test` | **19 tablas, 17 con RLS**; las 2 sin RLS son exactamente `catalog_faqs` y `catalog_models` |
| D3 | `pnpm --filter @istock/db test` | **59 `it()` contra Postgres real** en `rls-cross-tenant.test.ts`, dentro de los 302 del paquete |
| D4 | `pnpm --filter @istock/db test` | `seed-data.test.ts:188` asserta `8 unit + 2 lot`; `:196` asserta exactamente uno en `reserved` |

### Gate de D2 — reescrito el 2026-08-27, porque el anterior no se podía cumplir

**Decía:** *"toda tabla con `tenant_id` + RLS; conteo tablas == conteo RLS"*. Ese gate pedía `19 == 17`.
Era **inalcanzable por diseño ratificado**: `catalog_models` y `catalog_faqs` son globales, no tienen
columna `tenant_id` y son la excepción declarada en `CLAUDE.md`. Un gate así tiene dos finales y los
dos son malos — falla para siempre, o alguien lo afloja a mano y desde ese día no guarda nada.

**Dice, y esto es lo que de verdad se exige:**

1. **17 de 17 tablas de negocio e identidad con RLS activa.** Se mide en `pg_class.relrowsecurity`
   contra la base real, no en el `.enableRLS()` del TypeScript: el TS puede decirlo y la migración
   no haberse aplicado.
2. **Exactamente 2 tablas sin RLS, y son las 2 globales del catálogo por nombre.** No "2 tablas":
   *esas* dos. `packages/db/src/schema.test.ts:20` mantiene la lista
   `GLOBAL_TABLES = ['catalog_faqs', 'catalog_models']`, `:53` exige que las tablas sin RLS sean esa
   lista **y ninguna otra**, y `:54` ata el conteo a la lista
   (`EXPECTED_TABLES - EXPECTED_RLS_TABLES === GLOBAL_TABLES.length`).
3. **La excepción es de lectura y está asertada.** `rls.test.ts` y `rls-cross-tenant.test.ts` exigen
   que `authenticated` pueda leer el catálogo y reciba **`42501`** en `insert` / `update` / `delete`
   (`rls-cross-tenant.test.ts:236-237`). Global no quiere decir escribible: la siembra es de
   `service_role`.

**Por qué esta redacción sirve de gate.** Agregar una tabla de negocio sin RLS rompe las tres cosas a
la vez: el conteo (`19→20` con `17` RLS), la aserción de que las tablas sin RLS son *exactamente*
`GLOBAL_TABLES`, y la igualdad de `:54`. Y para "arreglarlo" hay que escribir el nombre de la tabla
nueva en `GLOBAL_TABLES`, que es un acto deliberado y revisable, no un número que se afloja.

Entidades: `tenants` `users` `memberships(owner\|seller)` `locations` `catalog_models` `catalog_faqs`
`listings(unit\|lot)` `listing_photos` `listing_events` `fx_settings` `tradein_leads`
`tradein_checklists` `wa_click_events` `sales` `reservations` `subscriptions/entitlements`
`chatbot_threads/messages`.

## FASE 3 — Skeleton

**No re-ejecutada.** `scripts/accept-fase3.sh` termina en `next build`. El LEAD no promueve filas
cuyo gate no pudo correr: las cinco quedan `todo` hasta que el gate corra **entero**.

> **Anti-drift, 2026-08-28.** El motivo que este board registró el 2026-08-27 —*"el `next build`
> está roto"* (`usePathname()` fuera de `<Suspense>`)— **ya no es cierto**: la medición de ADR-014
> corrió `next start` en :3199 y los e2e del panel, y eso exige un build hecho. Lo que sigue
> pendiente es **correr el gate**, no compilar. Las filas no se mueven igual, porque el estado lo
> fija la corrida del gate y nadie la hizo.

| id | título | estado | owner | gate de aceptación | artefacto |
|---|---|---|---|---|---|
| K1 | marketing honesta (sin promesas falsas) | todo | `app-agent` | `bash scripts/accept-fase3.sh` §K1 | `apps/web/app/(marketing)/` |
| K2 | auth + crear tenant + slug | todo | `app-agent` | `bash scripts/accept-fase3.sh` §K2 | `apps/web/app/(app)/` |
| K3 | proxy de host (`proxy.ts`) | todo | `storefront-agent` | `bash scripts/accept-fase3.sh` §K3 + §K3b (todo cache tag lleva slug) | `apps/web/proxy.ts` |
| K4 | layout del panel (mobile-first) | todo | `app-agent` | `bash scripts/accept-fase3.sh` §K4 | `apps/web/app/(app)/` |
| K5 | probe de upload a R2 | todo | `media-agent` | **bloqueado por B1** — ver nota abajo | `packages/media/src/` |

> **K5 no puede pasar a `done` mientras B1 siga abierto, y el motivo no es el que decía este board.**
> Corregido el 2026-08-27 contra el código: **el driver de R2 existe y está cableado** —
> `packages/media/src/storage/r2.ts` (151 líneas, `R2Driver` sobre la S3 API) y
> `storage/index.ts` lo elige con `MEDIA_DRIVER=r2`. El driver local no es lo único que hay: es el
> **default mientras B1 esté abierto** (`env.ts` exige las credenciales sólo si `MEDIA_DRIVER=r2`).
> Lo que falta es la otra mitad de la palabra *probe*: `accept-fase3.sh` §K5 es una verificación
> **estática** del paquete (existen las 3 variantes, `card ≤150KB` presupuestado, `CacheControl` por
> parámetro del SDK y no `httpMetadata`, unlink sin `DeleteObject`). **Ningún byte viajó nunca a un
> bucket real**, porque no hay bucket. Eso es B1 y no se puede simular.

## FASE 4 — Slices Capa 1 (ORDEN FIJO, no reordenar)

| id | slice | estado | owner | gate de aceptación |
|---|---|---|---|---|
| S1 | host → hello storefront | **done** | `storefront-agent` | `{slug}.local` resuelve al tenant; slug inexistente → página legible con `noindex` (**ADR-011**, el gate viejo "404 real en la primera request" era inalcanzable); se verifica con `bash scripts/accept-s1.sh`. **Re-ejecutado por el LEAD el 2026-08-28: EXIT=0 · 26 PASS · 0 FAIL · `S1: ACEPTADA`** |
| S2 | listing unit + fotos R2 con variantes | **done** | `media-agent` → `app-agent` | 3 variantes generadas; `card` ≤150KB **medido sobre bytes** (`card=50692B`, techo `153600B`). **Re-ejecutado por el LEAD el 2026-08-28: EXIT=0 · 21 PASS · 0 FAIL · `S2: ACEPTADA`** |
| S3 | grilla + ficha mínima | **done** | `storefront-agent` | `bash scripts/accept-s3.sh`: los **15 campos** de `CLAUDE.md` §1 —los 15 de verdad recién desde **M3b** (`0edb661`), que agregó el botón `wa.me`—; cero campos prohibidos en el HTML; el byte medido es el que **pide el browser** (P3). **Re-ejecutado entero por el LEAD el 2026-08-28: 58 PASS · 0 FAIL · `S3: ACEPTADA`** (la corrida que la aceptó dio 50; M3b sumó 8 aserciones) |
| S4 | botón `wa.me` + tracking de eventos | todo | `domain-agent` → `storefront-agent` | texto exacto byte a byte; evento registrado sin PII |
| S5 | FX → precio en ARS | todo | `domain-agent` → `app-agent` | TC del dueño; redondeo testeado; ARS visible en ficha |
| S6 | reserva + cron de expiración | todo | `app-agent` | reserva 30–120min; cron libera; vidriera revalida |
| S7 | venta manual | todo | `app-agent` | `→ sold`; sale de la grilla; URL directa no rompe |
| S8 | canje: form + inbox + accept-to-stock | todo | `app-agent` | crea unidad en `draft` con costo; seller no ve el costo |
| S9 | copy list para estados de IG/WA | todo | `app-agent` | export con precios y links; cero IMEI |
| S10 | import CSV | todo | `app-agent` | errores por fila; sin import parcial silencioso |
| S11 | roles owner/seller | todo | `app-agent` | seller no recibe `cost_usd` **en el payload**, no sólo en pantalla |
| S12 | onboarding de 15 minutos | todo | `app-agent` | e2e: signup → primer equipo publicado |
| S13 | `/demo` | todo | `storefront-agent` | tenant demo aislado; cero datos reales |

**Cada slice suma al gate:** `adversary-reviewer PASS` + `cost-auditor PASS` ("no agrega costo tonto").

> **S1 y S2 ACEPTADAS — 2026-08-28.** El LEAD re-ejecutó los dos gates enteros:
>
> ```
> accept-s1.sh → EXIT=0 · 26 PASS · 0 FAIL · S1: ACEPTADA
> accept-s2.sh → EXIT=0 · 21 PASS · 0 FAIL · S2: ACEPTADA
> ```
>
> Hasta hoy S1 figuraba `doing` y S2 `todo` **con el código en `main`**. El motivo ya no era técnico:
> el 2026-08-27 los dos gates fallaban porque el `next build` no compilaba, eso se arregló, y lo
> único que faltaba era **la corrida**. Lo mismo le pasó a S3.1, S3.2 y T8, que estuvieron `todo` un
> día entero con el código escrito. Dicho una sola vez y bien, porque es la regla que hace que este
> board sirva: **`done` lo fija la corrida del gate por el LEAD, no la entrega del código.**
>
> **Ninguna de las dos pasa por ausencia** — se verificó explícitamente, porque en este repo un gate
> verde por no haber mirado nada ya apareció dos veces (`DECISIONS.md` §"Dos formas nuevas de que un
> gate esté verde sin haber mirado nada"):
>
> - **S2 midió con número:** `card=50692B` contra `techo=153600B`, `detail=128570B / 409600B`,
>   `thumb=7718B / 25600B`, `master=313980B / 819200B` desde una fuente de `3006369B`, y 4 objetos =
>   `500960B`. O sea que el probe `scripts/probes/s2-media-measure.test.ts` **corrió de verdad**: el
>   techo de 150 KB que este board viene citando desde S2 está afirmado sobre bytes reales, no sobre
>   una constante leída. Pasaron además el polo positivo (la variante pública se sirve, HTTP 200) y
>   el tercero (la misma key devuelve los mismos bytes por apex y por host de tenant).
> - **S1 no imprime `MEDIDO`, y eso NO es un agujero** — chequeado antes de darlo por bueno: sus
>   siete secciones (A1–A8) pegan HTTP en vivo (`primera request a noexiste-… -> HTTP 200 (19965
>   bytes)`), consultan Postgres para el aislamiento, y **A6 corre la suite e2e entera con censo
>   `10/10 archivos · 70/70 tests · 0 salteados · 0 skip declarado`**. No hay tier muerto.
>
> **La deuda de ADR-011 sigue viva, y el gate la imprime en vez de esconderla.** El miss contesta
> `200/200`, no `404`: **deja de ser distinguible por status code en los logs de acceso.** No se
> mitiga —se aceptó a cambio de que la persona que se equivocó de subdominio lea algo en vez de una
> página en blanco— y lo que reemplaza al status como invariante chequeable son A3/A4 de
> `accept-s1.sh` (`<h1` literal, `noindex`, título propio, cero markup de vidriera, req2 en `HIT`).
> Dónde vuelve a morder está fechado: en **FASE 8** la observabilidad no puede depender del status,
> el mismo corolario que dejó la corrección medida de ADR-014 para el panel.
>
> **Aceptar la slice no cierra sus deudas.** Siguen abiertas, con dueño y sin tocar: **T1** (rate
> limiting: no hay implementación), **T2** (guard de query sin filtro de tenant), **S2.1**
> (`blocked` por **B1**), **S2.2**, **S2.3** y **S2.4**.
>
> **El aviso de drift de FASE 2 se cerró.** D1–D4 pasaron a `done` con la re-ejecución registrada
> arriba, en "Evidencia de la re-ejecución".

> **S3 ACEPTADA — 2026-08-28. El LEAD re-ejecutó `bash scripts/accept-s3.sh` entero: 50 PASS, 0
> FAIL, `S3: ACEPTADA`.** Con eso pasan a `done` **S3**, **S3.1**, **S3.2** y **T8**. Lo que destrabó
> el gate fueron las dos mediciones que nunca habían corrido de verdad, y salieron con número:
>
> ```
> MEDIDO s3 imagen  · viewport=390x844 dpr=3 · elegido=…5d49904070bcac12dc5fd1801d0f4ed0.webp#variante=card
>                   · transferSize=51016B · techo=204800B
> MEDIDO s3 db-hits · ruta=/p/qae2e-iphonemtcm352f42 · primera=9 · cacheada=0
> ```
>
> `transferSize=51016B` contra un techo de 204800 B es el byte que **el browser eligió** en un
> viewport de teléfono, que es lo que P3 exigía medir; `cacheada=0` es el objetivo del 95% de hits
> sin Postgres (`CLAUDE.md` §3) verificado sobre una ficha real y no sobre un 404 servido rápido.
>
> Commits que llevaron el gate de rojo a verde, en orden:
> `9837ee7` (M7 no podía correr: el teardown mataba el server tres líneas antes) ·
> `50173df` (M3/M4 salía rojo por el `margin` de la página de error de Next, no por la vidriera) ·
> `ba8536c` (la ficha inexistente salía en blanco en la primera request — ADR-011 un nivel más
> abajo) · `09c9bc3` (T8: las dos líneas `MEDIDO`).
>
> **Lo que S3 dejó abierto y sigue abierto:** **T3** (`qa-agent`, la mudanza del test de RLS) y
> **S3.3**, nueva — bajo un **tenant** inexistente la ficha contesta el texto del *listing-miss*.
>
> **El gate aseguraba 14 de los 15 campos. Cerrado — commit `0edb661`, módulo M3b.** Lo reportó
> `docs-keeper` (la columna de la izquierda decía *"los 15 campos"* y M3 aseguraba 14), lo verificó
> el LEAD antes de creerlo —`grep -i 'wa\.me|whatsapp' scripts/accept-s3.sh` devolvía cinco líneas y
> **las cinco eran comentarios o mensajes de error**— y lo escribió él, porque `scripts/**` es suyo
> (§4). El campo que faltaba era el **botón `wa.me`**: los otros 14 informan, ese convierte, y el
> "done cobrable" del producto es *"recibe WhatsApps esa noche"*.
>
> **M3b** va entre M3 y M4 y afirma, contra el HTML servido: **un solo anchor** `wa.me` en la ficha
> —cuenta `<a ...>`, no ocurrencias del texto, porque medido `wa.me` aparece **3 veces** en una ficha
> sana y las otras dos son el mismo `<a>` serializado en el payload de RSC—; **cero** anchors en la
> grilla; el teléfono del href contra el del **seed** (`SEED_DEMO_WA_PHONE`, `seed-data.ts:28`), no
> contra uno hardcodeado en el gate; y el `text=` decodificado nombrando `USD 620`, `demo.maat.work`
> y `y lo quiero.` Probado en las dos polaridades con cinco fixtures, cada una rompiendo una regla y
> sólo esa. Es la fila **E3** de `docs/TEST_MATRIX.md`, que pasa a cubierta.
>
> **Re-ejecución del gate entero por el LEAD, 2026-08-28 después de M3b: 58 PASS · 0 FAIL ·
> `S3: ACEPTADA`** (eran 50; M3b suma 8 aserciones). El mensaje que imprimió, decodificado del HTML
> servido: `Hola, vi el iPhone 14 Pro 256 Negro espacial (usado A) a USD 620 en demo.maat.work y lo
> quiero.` La corrida de 50 PASS que aparece más arriba sigue siendo la que aceptó S3, S3.1, S3.2 y
> T8: no se reescribe, se le agrega esta.
>
> **La aserción que no existía en ningún otro lado: el par de registros de condición.** La misma
> página dice `usado excelente` en el cuerpo (M3) y `usado A` en el mensaje de WA, y M3b lo afirma en
> las dos direcciones —que esté `usado A` **y que NO esté** `usado excelente`—. Es el único lugar del
> proyecto donde los dos mapas de `CLAUDE.md` §1 se observan **a la vez sobre el mismo HTML**: el
> unit de dominio ve un mapa por vez y no sabe que existe una página. El día que alguien "arregle la
> inconsistencia" unificando `WA_CONDITION_LABELS` (`packages/domain/src/types.ts:69`), **todos los
> tests unitarios siguen verdes** y sólo falla este gate.
>
> El diagnóstico de por qué esta slice estuvo `blocked` se conserva abajo, en las filas S3.1, S3.2
> y T8: **`done` lo fija la corrida del gate por el LEAD, no la entrega del código**, y estas tres
> filas estuvieron `todo` con el código en `main` durante un día entero por esa regla.

---

## FASE 4 bis — trabajo que salió de una slice, no del plan original

> Todo lo de esta sección apareció **haciendo** S1, S2 y S3, o **corriendo sus gates** — las últimas
> dos filas (**S3.3**, **T15**) salieron de la corrida de `accept-s3.sh`, no de leer código. No estaba en el
> orden fijo de FASE 4 y no lo reordena: son entradas propias con su propio dueño y su propio
> bloqueo. **T3**, **T7**, **T13** y **T14** no son deuda de producto: son deuda **de los
> instrumentos** — quién es dueño del test que audita las policies, un parser de tests que trunca en
> silencio, una medición que no se puede tomar, y prohibiciones que no chequea nadie.
> **Cerradas al 2026-08-28:** **P1**, **P2** y **P3** (las tres condiciones previas a S3), **T9**,
> **T11**, **T4** (`scripts/_lib.sh` + su test de polaridad) y **T10** (los 8 comandos de aceptación
> que no filtraban); y con la corrida de `accept-s3.sh` del LEAD, **S3.1**, **S3.2** y **T8**.
> **Abiertas el 2026-08-28 cerrando S3: S3.3** —el tenant-miss de la ficha— y **T15**, que salió de
> medir el mensaje de WhatsApp. **T1**, **T2**, **S2.1**, **S2.2**, **S2.3** y **S2.4** siguen
> abiertas después de aceptar S1 y S2: **aceptar la slice no cierra sus deudas.**

| id | título | estado | owner | bloqueo | gate de aceptación | artefacto |
|---|---|---|---|---|---|---|
| S2.1 | upload directo a R2 por URL prefirmada | blocked | `media-agent` → `app-agent` | **B1** + pregunta abierta de abajo | 8 fotos sin round-trip por foto; el original **nunca** es alcanzable; `card` sigue ≤150KB | `packages/media/src/*`, `apps/web/app/api/**` |
| P1 | `robots.txt` / `sitemap.xml` por tenant — **decisión de diseño** | **done** | `storefront-agent` + `qa-agent` | — | decisión escrita **antes** de arrancar S3 → **ADR-015**, verificada por el LEAD (30 URLs contra el `path-to-regexp` compilado) | `docs/DECISIONS.md` ADR-015 · `apps/web/proxy.ts` (`117c4f0`) |
| P2 | metadata file conventions bajo host de tenant — **decisión de diseño** | **done** | `storefront-agent` + `qa-agent` | — | ídem P1: misma causa raíz, misma ADR, mismo commit | ADR-015 · `apps/web/proxy.ts` · `tests/proxy-matcher-no-deja-la-vidriera-sin-vigilar.test.ts` |
| T1 | rate limiting en el edge: las 2 reglas de Vercel Firewall | todo | **LEAD** (`vercel.json`, §4) | — | 2 reglas activas + prueba de que disparan; **cero** contador en Postgres sobre la vidriera | falta definir (no hay `vercel.json` hoy) |
| T2 | guard estático de "query sin filtro de tenant" | todo | **LEAD** (`scripts/**`, §4) | — | el guard falla sobre una query sin `tenant_id` **y** pasa con la excepción declarada | `scripts/guard-leaks.sh` §16 |
| T3 | mudar el test de RLS cruzado a `tests/` | **doing** | `qa-agent` | S2 cerró el 2026-08-28 y la destrabó; la mudanza **ya está en el working tree, sin commitear ni correr** | los 59 `it()` corren desde `tests/` contra Postgres real, verdes, sin perder ninguno; `packages/db/src/rls-cross-tenant.test.ts` deja de existir; **y en la misma mudanza se borra el encabezado que se declara `db-agent`**, derogado por la regla de desempate de `CLAUDE.md` §4 | `tests/` |
| T4 | extraer los helpers de los gates a `scripts/_lib.sh` | **done** | **LEAD** | — | un solo juego de helpers en el repo; los gates que lo importan re-corridos con el mismo veredicto **y** el helper probado en las dos polaridades, en CI | `scripts/_lib.sh` + `scripts/_lib.test.sh` (`dc1d854`) |
| S2.2 | `collectOrphanObjects` existe y no lo llama nadie | todo | `media-agent` (función) + `app-agent` (comentarios) | — | se elige **(a)** o **(b)** por escrito: si (a), el job corre y borra un huérfano sembrado; si (b), **ningún** comentario del repo la nombra en presente | `packages/media/src/unlink.ts`, `apps/web/app/(app)/_lib/listings/*.ts` |
| S2.3 | el `<input type="file">` conserva la foto después de subirla | todo | `app-agent` | — | tras un alta exitosa el input queda vacío; `PhotoActionState` distingue inicial de éxito | `apps/web/app/(app)/app/(panel)/stock/[id]/fotos/*` |
| P3 | el gate de S3 mide el byte que el browser **pide**, no el que el pipeline generó | **done** | **LEAD** escribió el gate · `storefront-agent` implementó S3 | — | el gate existe, **nació en rojo a propósito** y el 2026-08-28 pasó a verde midiendo el byte que el browser eligió (`51016B`) — ver abajo | `scripts/accept-s3.sh` (`1406c6f`, `d9d7719`, `20fb7ac`) |
| S2.4 | el docblock de `page.tsx:69-72` afirma un 404 que la medición desmiente | todo | `app-agent` | — | el comentario describe el comportamiento **medido** (ADR-014, "Corrección medida"); alcance = el comentario, no la ruta | `apps/web/app/(app)/app/(panel)/stock/[id]/fotos/page.tsx` |
| T7 | `readMatchers()` trunca el matcher en el primer `]` | todo | `qa-agent` | — | **nada roto hoy** — trampa conocida, ver abajo | `tests/proxy-matcher-no-deja-la-vidriera-sin-vigilar.test.ts:144` |
| S3.1 | un tenant real nace sin `fx_settings` y sin `locations` | **done** | `app-agent` | — | **severidad alta** — alta o onboarding siembran un `fx_settings` y ≥ 1 punto de retiro; un tenant nuevo que carga 3 equipos ve grilla con precio y retiro, no vacía. **Cerrada por la corrida de `accept-s3.sh` del LEAD (2026-08-28, 50 PASS/0 FAIL):** M3 exige el punto de retiro, el horario y el ARS con la forma de `formatArs`, y los tres salen de las filas sembradas | `apps/web/app/(app)/_lib/tenants/create-tenant.ts` (`eaccfee`) |
| S3.2 | publicar un equipo purga el catálogo entero del tenant | **done** | `app-agent` | — | al mutar una unidad se emite además `updateTag(listingTag(id))`; los dos tags de tenant dejan de ser la única invalidación. **Cerrada por la misma corrida:** `MEDIDO s3 db-hits · primera=9 · cacheada=0` | `apps/web/app/(app)/_lib/tenants/storefront-cache.ts` (`eaccfee`) |
| S3.3 | bajo un **tenant** inexistente la ficha dice que el equipo se vendió | **doing** — código en el working tree, sin corrida | `storefront-agent` | — | una ficha bajo un slug de tenant que no existe contesta el *tenant-miss* (`STOREFRONT_MISS_TITLE`, "No hay ninguna vidriera en esta dirección"), no el *listing-miss* ("Este equipo ya no está publicado"); el `null` del tenant se sigue cacheando con `STOREFRONT_MISS_LIFE` | `apps/web/app/(storefront)/s/[slug]/p/[listing]/page.tsx` |
| T8 | los dos specs que miden S3 no emiten ninguna medición | **done** | `qa-agent` | — | las dos líneas `MEDIDO` exactas (ver abajo); **la de imagen se mide sobre la grilla**, no sobre la ficha. **Emitidas y verificadas por el LEAD el 2026-08-28** (`transferSize=51016B` / `primera=9 · cacheada=0`) | `e2e/s3-la-grilla-en-un-telefono-no-baja-la-foto-grande.spec.ts`, `e2e/s3-la-ficha-cacheada-no-le-pega-a-postgres.spec.ts` (`09c9bc3`) |
| T9 | forma de `listings.slug` en `domain` + en el motor | **done** | `domain-agent` + `db-agent` | resto en vuelo con `storefront-agent` | ver abajo | `packages/domain/src/slug.ts`, `packages/db/drizzle/0003_listing_slug_format.sql` |
| T10 | ocho comandos de aceptación corrían la suite entera creyendo filtrar | **done** | **LEAD** (`.claude/**`, §4) | — | el comando de cada contrato **filtra de verdad**, verificado en las dos polaridades (filtra, y falla con exit 1 ante un patrón que no matchea) | 4 `.claude/agents/*.md` + 4 `.claude/skills/*/SKILL.md` + `scripts/accept-fase3.sh` (`0d647c6`) |
| T11 | las reglas de R2 de `CLAUDE.md` §2 no tenían gate | **done** | **LEAD** | — | `scripts/guard-r2.sh` (`985c369`) — ver la nota de método, regla R5 | `scripts/guard-r2.sh` |
| T5 | concurrencia real del techo de 8 fotos, contra Postgres real | todo | `qa-agent` | comparte harness con **T3** | 7 fotos + dos `addUnitPhoto` en paralelo → exactamente 8 fotos y un `ok:false` de techo | `tests/` |
| T6 | `SELECT … FOR UPDATE` bajo RLS: verificación pendiente, no bug | todo | `qa-agent` | corre con **T5** | el `for('update')` devuelve la fila con rol `authenticated` y el claim del tenant, sin `42501` | `tests/` |
| T12 | editar el TC y los puntos de retiro después del alta **no existe** | todo | `app-agent` | — | el dueño cambia el TC y edita/agrega un punto de retiro desde el panel **sin recrear el negocio**, y la mutación arrastra la invalidación de la vidriera | `apps/web/app/(app)/app/(panel)/ajustes/` |
| T13 | `/_media` no manda `Timing-Allow-Origin` | todo | `app-agent` | — | la Performance API reporta el byte real del recurso cross-origin; el spec de S3 compara sus **dos** cuentas en vez de descartar una | `apps/web/app/(app)/%5Fmedia/[...key]/route.ts` |
| T14 | dos prohibiciones de `CLAUDE.md` §2 que ningún gate afirma | todo | `qa-agent` (ver desempate abajo) | — | cada una tiene un chequeo **que se vio fallar** sobre una violación sembrada, y corre **en cada push**, no dentro de un `accept-*` | `tests/` (o `scripts/**`, y entonces es del **LEAD**) |
| T15 | el seed del demo dice un color en la URL y otro en la página | todo · **prioridad baja** | `db-agent` | — | **pregunta abierta, no diagnóstico** (ver abajo). Cerrada cuando el slug del listing y el color que muestra la ficha nombren lo mismo, y `bash scripts/accept-s3.sh` siga en verde | `packages/db/src/seed-data.ts:114-116` |

> **Anti-drift, 2026-08-28 — el caso completo, de punta a punta, porque es el que enseña la regla.**
> Durante un día **S3.1 y S3.2 estuvieron `todo` con el código ya en `main`** (`eaccfee`). Las filas
> **no se movieron** entonces: el estado lo fija la corrida del gate por el LEAD, no la entrega del
> código (regla 5 de este board). Se movieron a `done` recién con la corrida verde del 2026-08-28,
> y en el medio esa corrida encontró **cuatro defectos reales** (`9837ee7`, `50173df`, `ba8536c`,
> `09c9bc3`) que la entrega del código no había mostrado. Eso es lo que compra la regla.
> Lo que sí se corrigió el día que las filas seguían `todo` fue la **descripción**, porque decía algo
> que el código ya no hacía:
> - **S3.1** — `create-tenant.ts` ya siembra `fx_settings` (`:218`) y una fila de `locations`
>   (`:226`) en la **misma** transacción que `tenants` + `memberships` (`eaccfee`).
> - **S3.2** — `storefront-cache.ts` ya tiene tres puntos de entrada según el alcance real de la
>   mutación (`invalidateStorefront` 2 tags · `invalidateStorefrontUnit` 3 · `invalidateListing` 1),
>   y los tags se **importan** de `(storefront)/_lib/cache-tags` en vez de redefinirse.
>
> Lo que faltaba para las dos era lo mismo —**la corrida verde de `bash scripts/accept-s3.sh`**— y
> llegó el 2026-08-28. Las dos son `done`.

### S2.1 · upload directo a R2 por URL prefirmada  ·  **blocked por B1**

**El hecho.** Hay tres techos de request body encima nuestro y **el que manda es 4 MB**, no 4.5.
Verificado por el LEAD contra la doc oficial el 2026-08-27; el detalle con URLs está en
`docs/research/vercel-request-body-limit.md`.

| techo | valor | quién lo pone |
|---|---|---|
| `experimental.serverActions.bodySizeLimit` | 3.5 MB | nosotros (`apps/web/next.config.ts`) |
| Routing Middleware = `proxy.ts` | **4 MB ← el que manda** | Vercel |
| Vercel Function | 4.5 MB | Vercel |

Manda el de 4 MB porque el POST del alta no termina en extensión conocida y cae en el catch-all del
`matcher` de `proxy.ts`. **No se saca del matcher para ganar 0.5 MB:** ahí corre
`stripInboundTenantHeaders()`, y cambiar una defensa de tenant por medio mega es un mal negocio. No
varía por plan y streaming no lo evade.

**Lo que S2 ya entregó, y es correcto:** entra **una foto por request**. Alta con la primera foto →
`/app/stock/{id}/fotos` (`apps/web/app/(app)/app/(panel)/stock/[id]/fotos/`), una request por foto
hasta las 3 de `MIN_PHOTOS_TO_PUBLISH` (`packages/domain/src/listing-status.ts`).

**Por qué igual hace falta esta slice.** `MAX_PHOTOS_PER_LISTING = 8`
(`apps/web/app/(app)/_lib/listings/schema.ts`): son 8 round-trips para el equipo más cargado y 3
para el mínimo publicable. El *done cobrable* de `CLAUDE.md` es "15 equipos en una tarde" ≈ **45
uploads secuenciales** con el pipeline corriendo entre cada uno. Lo levantó `app-agent`; el LEAD
coincide con el diagnóstico.

**Forma propuesta.** Un PUT prefirmado directo a R2 no pasa por el Routing Middleware, así que no
tiene el techo de 4 MB. Requiere:
- firmar un PUT a `istock-originals` y disparar el pipeline de variantes desde la key resultante —
  hoy **no existe**: `packages/media/src/upload.ts` dice literal *"No hay presigned PUT directo a
  R2"*. Dueño: **`media-agent`**;
- un Route Handler en `apps/web/app/api/**`. Dueño: **`app-agent`**.

#### ⚠ Pregunta abierta que hay que contestar ANTES de arrancar, no de costado durante

Las dos frases están **en el mismo documento**, `.claude/agents/media-agent.md`:

> **Regla 1.** "*Nada entra a R2 sin resize.* Máximo 1600px en el lado mayor."

> **Regla 4.** "Upload **server-side** (*o presigned + verificación*). El browser nunca ve
> credenciales de R2."

Un PUT directo desde el browser manda los 12MP crudos: la regla 4 lo permite y la regla 1 lo
prohíbe. **Hay que conciliarlas a propósito.** Esto no está resuelto y `docs-keeper` no lo resuelve.

**Salida propuesta por `app-agent` — PROPUESTA, NO RATIFICADA POR EL LEAD.** Que el PUT prefirmado
apunte a un **prefijo de cuarentena dentro de `istock-originals`**, y que el pipeline de variantes
corra recién después, con el objeto ya en R2 pero **todavía sin mapear a ningún listing**. El
argumento: la regla 1 apunta a que nadie pueda *servir* ni *alcanzar* un original de 12MP, y un
prefijo de cuarentena en un bucket privado, sin fila de mapeo, no es alcanzable por nadie. **Si eso
alcanza para satisfacer la regla 1, o si la regla 1 hay que reescribir, es exactamente la decisión
que falta tomar** — y es de `media-agent` + ratificación del LEAD, no de quien escriba el Route
Handler.

**Por qué B1 bloquea:** sin bucket real no se construye ni se testea un presigned — firmar una URL
contra un endpoint que no existe no prueba nada. El driver de R2 **sí existe**
(`packages/media/src/storage/r2.ts`, elegido con `MEDIA_DRIVER=r2`); lo que no existe es la firma de
un PUT directo, y lo dice el propio código: `packages/media/src/upload.ts:6`. Mientras tanto se
trabaja con el driver local (`storage/local.ts`, el default hasta que cierre B1), donde **no hay
techo de 4 MB** — o sea que lo que S2 entregó es correcto *y* verificable.

### P1 y P2 · CERRADAS el 2026-08-28 → **ADR-015**  ·  eran requisito previo a S3

Las dos filas se cierran juntas porque **eran el mismo bug**. Lo implementó `storefront-agent` en
`apps/web/proxy.ts` (commit `117c4f0`); el LEAD lo verificó leyendo el archivo entero y corriendo
una prueba propia de **30 URLs** contra el `path-to-regexp` compilado de Next.

- **Causa raíz, una sola para las tres fugas** (`/s/algo.json` de S1, `/_media/*.webp` de S2 y las
  25 URLs de metadata de P2): el `matcher` excluía **por sufijo**, el router de Next matchea **por
  segmento**, y Next decide las metadata file conventions **por nombre**. Tres criterios distintos
  para la misma pregunta. La corrección no fue borrar la exclusión por sufijo: fue **excluir por
  sufijo salvo que el nombre sea una convención de metadata de Next** — el mismo criterio que usa
  Next.
- **Por qué el nombre y no el sufijo ni la profundidad:** `/icon.png` (ruta de app, la genera Next)
  y `/logo.png` (asset estático) son **indistinguibles** por sufijo y por profundidad. Sólo los
  separa el nombre.
- **P1 se resolvió sin agregar un solo `if`.** Las 25 URLs siguen la regla general de host (apex
  pasa derecho, tenant reescribe a `/s/{slug}/…`) y hoy eso da **404 en el host de tenant**. Ese 404
  es **la respuesta correcta, no una deuda** (el argumento completo está en ADR-015): un `robots.txt`
  ausente significa "crawleá todo", y servir el favicon o el sitemap del apex en `acme.maat.work`
  pone la marca y las URLs de MaatWork adentro de la vidriera de un cliente. **El bug nunca fue el
  404: era el 200 con el archivo de otro.**
- **Dato que cambia el análisis de cualquiera que relea esto:** `apps/web/public/` **no existe**. No
  hay `favicon.ico`, ni `icon.*`, ni `robots.txt`, ni `sitemap.xml` en todo el árbol. La exclusión
  de 16 sufijos que había antes **protegía cero archivos**.

Lo que queda para S3 es implementar `/s/[slug]/robots.txt` y `/s/[slug]/sitemap.xml` **con su propio
perfil de cache**. El enrutamiento ya está.

### T1 · rate limiting: no hay implementación ni test  ·  deuda de S1

Las **2 reglas de Vercel Firewall** que `ARCHITECTURE.md` §"Seguridad de la vidriera" presupuesta
(vidriera + chatbot) y que son parte de por qué se paga **Vercel Pro** (`CLAUDE.md` §3) **no existen
todavía**: no hay `vercel.json` en el repo ni un test que las ejercite.

Al escribirla, el borde que ya está en `CLAUDE.md` §2: **rate limiting con contador en Postgres
sobre la vidriera es rechazo automático**, porque rompe el 95% de hits que no tocan Postgres.

### T2 · falta el guard estático de "query sin filtro de tenant"  ·  deuda de S1

`CLAUDE.md` §2 rechaza toda query sin filtro de tenant *además* de RLS. Hoy la regla se cumple **por
disciplina y revisión, no por lint**: `scripts/guard-leaks.sh` tiene 15 secciones y ninguna es ésta.

Nota relacionada, de `app-agent`: `apps/web/app/(app)/_lib/catalog/queries.ts` es **la única query
del panel sin `where tenant_id`**, y está justificada por escrito en el propio archivo (tabla global
declarada en `packages/db/src/schema/catalog.ts`, sin columna `tenant_id`, `GRANT SELECT` a
`authenticated`, sembrada por `service_role`). **Cuando exista el guard, esa excepción tiene que
estar declarada, no descubierta.**

### T3 · el test de RLS cruzado está en la columna equivocada  ·  reasignación del LEAD

**No bloquea D3 y D3 está `done`.** El test existe, corre contra Postgres real, tiene 59 `it()` y
está verde: el requisito se cumple. Lo que está mal es **quién lo puede editar**.

`packages/db/src/rls-cross-tenant.test.ts` vive en el directorio de `db-agent`, y su propio
encabezado se declara owner `db-agent` citando la corrección de FASE 4 de `CLAUDE.md` §4 (*"el test
unitario de un paquete es del owner del paquete"*). **El LEAD reasigna** (§4: *"conflicto de
ownership = el LEAD reasigna"*): **este test es de `qa-agent` y se muda a `tests/`.**

**El motivo es el mismo principio de independencia que ya se aplicó a los gates de bytes**, por el
que `scripts/probes/s2-media-measure.test.ts` vive afuera de `packages/media` aunque mida a
`packages/media`: `db-agent` escribe **las policies**, así que no puede ser el dueño del test que
**las audita** — sería el mismo writer en las dos puntas. Y RLS no es un invariante cualquiera: es
el más caro del producto (*"sin RLS no hay merge"*, `CLAUDE.md` §Reglas duras 7), y con un solo
proyecto Supabase para todos los tenants la policy **es** el límite de seguridad, sin segundo muro
atrás. Es exactamente la clase de test que `CLAUDE.md` §4 pone del lado de `qa-agent`: *"lo que
cruza un límite"*.

**El diagnóstico de arriba describe el estado hasta el 2026-08-28 a la mañana**, cuando el archivo
seguía en `packages/db/src/` y su encabezado (`:3-6`) todavía se declaraba `Owner: db-agent` citando
la mitad de la regla de §4 que el desempate de FASE 4 **derogó** para este archivo. Se conserva
porque es el argumento de por qué se muda; el estado actual está abajo.

**Estado al 2026-08-28, verificado en el working tree y no en un reporte** (`docs-keeper`): la
mudanza **ya está hecha y sin commitear** — `git status` la muestra como `RM
packages/db/src/rls-cross-tenant.test.ts -> tests/rls-cross-tenant.test.ts`, el archivo tiene sus
**59 `it()`**, `tests/vitest.config.ts` está tocado, y el encabezado **ya se reescribió**: en vez de
declararse `db-agent` ahora explica por qué vive en `tests/` y remite al desempate de `CLAUDE.md` §4.
O sea que las dos mitades del gate que dependen de leer archivos están cumplidas.
**Sigue `doing`, no `done`:** falta la corrida de los 59 contra Postgres real por el LEAD, y falta el
commit. Nada de esto lo puede afirmar `docs-keeper`: es la misma regla que tuvo a S1, S2, S3.1 y S3.2
esperando con el código en `main`.

**Se agendaba después de que cerrara S2, y S2 cerró el 2026-08-28** (21 PASS / 0 FAIL). El motivo de
la espera era no mudar 59 tests con una slice en vuelo; ya no hay slice en vuelo sobre `packages/db`.
La segunda mitad de la fila —*"al mudarlo hay que corregir el encabezado, o el próximo agente lee la
versión vieja de la decisión"*— **está cumplida en la misma entrega**: el comentario no quedó atrás
del código.

### T4 · los helpers de los gates estaban duplicados  ·  **CERRADA el 2026-08-28** (`dc1d854`)

Corriendo el gate de S2 el LEAD encontró **tres defectos en sus propios scripts**, los tres ya
corregidos en `scripts/accept-s2.sh` y `scripts/accept-s1.sh`:

1. **Un gate salía `PASS` con cero tests ejecutados.** Contaba un spec como "ejecutado" si su nombre
   aparecía en la salida — y cuando el censo falla, imprime el nombre de cada spec que **no** corrió.
   La prueba de que corrieron era literalmente el texto que decía que no. Ahora el número se lee de
   la línea del censo (`accept-s2.sh:124`) y **si no hay línea de censo el gate falla**, en vez de
   contar por nombre de archivo.
2. **`none()` daba falso positivo contra `apps/web/tsconfig.tsbuildinfo`**, que lista todos los
   archivos del repo y por lo tanto matcheaba cualquier patrón. Ahora se filtra con
   `git check-ignore`: artefacto = ignorado por git; **código nuevo sin `git add` se audita igual**,
   que es justo cuando hay que auditarlo.
3. **Al fallar la suite el gate mostraba sólo el `tail`**, que en un fallo de `webServer` es la traza
   de módulos: el mensaje real quedaba fuera de pantalla.

**La deuda que queda, y es esta fila:** `none()` está **copiado en tres scripts** (`accept-s1.sh`,
`accept-s2.sh`, `accept-fase3.sh`) **y las copias ya divergieron**. Medido el 2026-08-27: `s1` y
`fase3` son byte a byte idénticas, `s2` es una tercera versión. Los helpers chicos (`sec`, `ok`,
`no`) están triplicados idénticos, y `accept-fase2.sh` corre con un juego propio y distinto
(`ok`/`bad`/`head`/`strip_comments`), sin `none()`. *(Ese `head` propio resultó ser el motivo real
de la migración; ver el punto 1 de más abajo.)*

**Cómo cerró.** `scripts/_lib.sh` es hoy el único lugar donde viven `sec` / `ok` / `no` / `inf`,
`_buscar`, `_veredicto`, `none` y `noneraw`, y **seis** gates lo importan con `. scripts/_lib.sh`:
`accept-s1.sh`, `accept-s2.sh`, `accept-s3.sh`, `accept-fase2.sh`, `accept-fase3.sh` y
`guard-grants.sh` (más `_lib.test.sh`, que lo prueba). La librería además **se niega a ejecutarse
directo** (`_lib.sh:31`): es una librería, no un script.

**Dos precisiones sobre lo que este board pedía, porque el gate escrito arriba no era el que se
cumplió.** Decía *"los **4** gates (`accept-fase2`, `accept-fase3`, `accept-s1`, `accept-s2`)"*:

1. **`accept-fase2.sh` era la excepción anotada, y la excepción se cerró el 2026-08-28** (`0bcb281`,
   decisión del LEAD). **El motivo anotado acá era el equivocado.** Decía que `bad()` y
   `strip_comments()` no tenían equivalente: `bad()` es `no()` con otro nombre y nada más, y
   `strip_comments()` lo usa un solo gate, así que se quedó local — no hay dos copias que puedan
   divergir. Lo que decidió la migración fue **un tercer helper que no estaba en la lista: el gate
   definía `head()`, que pisa el comando `head`.** Mientras corrió autónomo fue latente, porque
   nunca lo invocaba. Al hacer `source` de `_lib.sh` dejaba de serlo: **`_veredicto()` termina en
   `| head -6`** (`_lib.sh:64`) y bash resuelve funciones **en el momento de la llamada**, así que
   ese `head -6` habría entrado a la función del gate —un pipe a `printf '%s' "$1"` que se come la
   salida y devuelve 0— y la regla habría seguido imprimiendo `FAIL` **sin listar un solo hallazgo**.
   Se renombró a `sec()`, como en los otros cinco gates, y el problema deja de existir.
   **La lección, que es la que se guarda:** un helper con nombre de comando de `coreutils` es una
   bomba con temporizador puesto en *"el día que este archivo comparta scope con otro"*.
2. **Se reconectaron seis y no cuatro**, porque en el medio nacieron `accept-s3.sh` (P3) y
   `guard-grants.sh`, y los dos arrancaron importando en vez de copiar.

**Lo que compra el riesgo de compartir.** El argumento en contra de centralizar era real —*un gate
que importa de otro gate se rompe de a dos*, y si `none()` se rompe **todos** los gates se vuelven
vacuamente verdes a la vez. La contrapartida es `scripts/_lib.test.sh`: **10 aserciones**, cada
helper **en las dos polaridades** (`none` limpio → PASS / con aguja → FAIL / con la aguja adentro de
un comentario → PASS; `noneraw` al revés), más el `git check-ignore` (artefacto de build salteado,
código sin commitear auditado igual) y el contador `fail`. Corre **en CI**, en su propio step
(`.github/workflows/ci.yml`, *"polaridad de los helpers de los gates"*), antes que los guards que
dependen de él.

### Regla de método de los gates — **un gate que nunca se vio fallar no es un gate**

Vigente desde el 2026-08-28. **Toda regla nueva de un gate se prueba en las dos polaridades antes de
darla por buena:** que falle sobre un caso que tiene que reprobar, y que pase sobre uno que tiene que
aprobar. No es un principio abstracto — salió de dos hallazgos del LEAD, los dos ya arreglados:

- **`b5065a4` — dos gates estaban verdes por vacío desde S1.** `scripts/accept-s1.sh` y
  `scripts/accept-s2.sh` chequeaban la prohibición de `TODO: después el RLS/R2/cache` con el helper
  `none()`, que **filtra las líneas que empiezan con `//`**. Como ese TODO **siempre** es un
  comentario, la regla no podía disparar nunca. Se arregló con un helper `noneraw()` (idéntico a
  `none()` menos el filtro de comentarios), y el LEAD verificó **primero** que los dos árboles
  estuvieran genuinamente limpios, para que el arreglo no produjera un rojo espurio.
- **`b4b441b` — la regla 15 de `scripts/guard-leaks.sh` exigía citar el ADR equivocado.** Pedía
  ADR-011 en párrafos del **panel**, donde mandan ADR-013/014. Se arregló **acotando la regla por su
  propósito** —que ninguna afirmación sobre un 404 quede huérfana de ADR—, no aflojándola: una
  afirmación sobre la **vidriera** que cite sólo ADR-013 sigue siendo LEAK.

Los dos comparten la moraleja con **T4**: los gates son código y se auditan como código.

**Dos casos más de la misma regla, del 2026-08-28**, asentados en `DECISIONS.md` §"Notas
operativas": la regla R5 de `guard-r2.sh` se satisfacía con un `import` (verificaba la **presencia
del símbolo**, no la **invocación**), y `scripts/guard-artifacts.sh` sin argumentos daba
`GUARD: PASS` habiendo chequeado cero archivos. Los dos ya fallan. **T11** registra el gate nuevo.

### El harness de CI también estaba verde por vacío  ·  corregido el 2026-08-28 (`fe4e5dc`)

Tres defectos en `.github/workflows/ci.yml`, la misma enfermedad de la sección de arriba pero un
nivel más afuera: no era un gate que no podía fallar, era **el job que corre los gates**.

1. **El job `e2e` venía verde sin ejecutar un solo test.** CI corría
   `pnpm --filter @istock/web e2e`. El script existía en `apps/web/package.json`, así que el comando
   **resolvía**; pero `apps/web` no tiene `@playwright/test` ni `playwright.config.ts` — el único
   config del repo es `e2e/playwright.config.ts`. Medido: `Total: 0 tests in 0 files`, **exit 0**.
   Corregido a `@istock/e2e` en las dos líneas (install de browsers y corrida), **y se borró el
   script `e2e` de `apps/web/package.json`**: era lo que hacía que el comando mal escrito resolviera
   en vez de fallar. Ahora falla con *"None of the selected packages has a `e2e` script"*.
2. **`scripts/guard-routes.sh` no corría en ningún push.** Ahora corre **dentro del job `e2e`**, que
   es el único que tiene un `.next` — lo buildea el `webServer` de Playwright, y el guard no
   buildea: lee ese manifest. Estaba fuera de CI, y por eso había quedado **rojo tres commits** sin
   que nadie lo notara.
3. **El artifact de fallas subía cero bytes.** Apuntaba a `apps/web/playwright-report/`, que no
   existe nunca: el config no tiene reporter `html`. Ahora sube `e2e/test-results/`, que es donde
   caen los traces de `trace: 'retain-on-failure'`.

El patrón de los tres es el mismo y conviene decirlo una vez: **un comando que resuelve no es un
comando que hace lo que dice.** Es literalmente el defecto de **T10**, en otro archivo y el mismo
día.

### S2.4 · el docblock de `page.tsx` afirma un 404 que la medición desmiente  ·  deuda de S2

El docblock de `apps/web/app/(app)/app/(panel)/stock/[id]/fotos/page.tsx:69-72` justifica el
`export const instant = false` de la línea 105 diciendo que sin él la respuesta era 200 con cuerpo
de 404 — implicando que `instant = false` recupera el status. **El LEAD lo midió el 2026-08-28 y la
implicación es falsa: la respuesta sigue siendo 200.** Tres puertas del e2e y tres `curl` directos
contra `next start` dan `mine=200 theirs=200 ghost=200`; la evidencia entera está en `DECISIONS.md`,
ADR-014 §"Corrección medida".

**No es un defecto de seguridad:** el invariante de ADR-013 es la indistinguibilidad, y con las tres
respuestas en 200 se cumple y ahora está medido en tres puertas.

**Alcance del ítem:** corregir el comentario para que describa el comportamiento medido. **Nada
más.** Que la ruta devuelva o no el status correcto es una **pregunta abierta, separada y más cara**,
y la decide el LEAD — no es parte de este ítem. Owner: **`app-agent`** (`docs-keeper` no edita
`page.tsx` ni propone el arreglo).

### T7 · `readMatchers()` trunca el matcher en el primer `]`  ·  trampa conocida, nada roto hoy

`readMatchers()` (`tests/proxy-matcher-no-deja-la-vidriera-sin-vigilar.test.ts:144`, archivo de
`qa-agent`) parsea el matcher del proxy con `/matcher\s*:\s*\[([\s\S]*?)\]/u`. Es **no-greedy y
corta en el primer `]`**, así que cualquier clase de caracteres dentro del matcher trunca el parseo
**en silencio**. `storefront-agent` se lo comió cerrando P1/P2 (36 tests en rojo) y lo esquivó
usando `\w+` en vez de una clase.

Se anota porque hoy no rompe nada y por eso mismo nadie lo va a ver venir: **el próximo que meta un
`[...]` en el matcher pierde una hora.** Owner: `qa-agent`.

### S2.2 · `collectOrphanObjects` existe, está testeado, y no lo llama nadie  ·  deuda de S2

**Medido el 2026-08-28.** `grep -rn 'collectOrphanObjects' --include='*.ts' .` devuelve la definición
(`packages/media/src/unlink.ts:90`), el export (`packages/media/src/index.ts:21`), sus tests
(`packages/media/src/unlink.test.ts`), el guard de `qa-agent`
(`tests/la-url-de-r2-no-se-arma-fuera-de-media.test.ts`) y **comentarios que la citan en presente**.
Ninguna línea la ejecuta en producción. Lo mismo vale para `unlinkListingPhotos`: fuera de tests, no
tiene caller.

Y los comentarios no son decorativos: **sostienen una decisión de diseño**.

- `create-listing.ts:35-37` justifica el orden **upload → insert** con una tabla cuya última celda
  dice que los objetos huérfanos *"se pueden reparar: **sí**: `collectOrphanObjects`"*.
- `add-photo.ts:26`, `:69` y `:196` dicen que los bytes huérfanos *"los recoge `collectOrphanObjects`"*.

El orden `upload → insert` **sigue siendo el correcto** y no se reabre: la alternativa deja filas
huérfanas en Postgres, que no tienen recolector ninguno. Lo que hoy es falso es la segunda mitad de
la frase — el recolector existe, pero no corre.

**No es un bloqueante.** El leak sólo ocurre en caminos de error (falla el `insert`, se pierde la
carrera del techo de 8) y son bytes en R2 a USD 0.015/GB/mes. Pero es deuda con fecha, no una frase
tranquilizadora dentro de un docblock.

**Hay que elegir una de las dos, explícitamente, y la decisión es del LEAD:**

**(a) Agendarla en un cron.** El cron de expiración de reservas es de **S6** (FASE 4, no FASE 6) y
hoy no existe: no hay `vercel.json` en el repo. Ojo con el tamaño real de esta opción:
`collectOrphanObjects` recibe `{ candidateKeys }` y **no descubre huérfanos sola** — el refcount
entra por `deps.countReferencesAcrossAllTenants`, que cruza todos los tenants con `service_role`.
Hoy **nadie persiste** las keys liberadas: `unlinkListingPhotos` devuelve `releasedKeys` y el valor
se descarta, y los huérfanos de los caminos de error de `create-listing`/`add-photo` no se anotan en
ningún lado. O sea que (a) **no es "agregar un caller": es agregar la fuente de candidatos.**

**(b) Registrarla como deuda aceptada** y corregir los cuatro comentarios para que digan lo que pasa
hoy: los bytes quedan en R2, el recolector existe y no está agendado.

Owner de la ejecución: **`media-agent`** para la función y para cualquier fuente de candidatos
dentro de `packages/media`; **`app-agent`** para los comentarios de `_lib/listings/`.

### P3 · el gate de S3 tiene que medir el byte que el browser pide  ·  requisito previo a S3

`packages/media/src/url.ts:78` expone `cardSrcSet()`, que devuelve exactamente:

```
{card} 800w, {detail} 1600w
```

Un `<img srcset>` **sin atributo `sizes`** hace que el browser asuma `sizes="100vw"`. Un teléfono de
390 px CSS con DPR 3 pide 1170 px de ancho de recurso y elige **`detail`**, nunca `card`. Los dos
bytes están medidos y fijados en `e2e/_lib/photo.ts:17-18`: `card` = **50.692 B**,
`detail` = **128.570 B**. **2,5×.**

La consecuencia sobre este board es directa: el criterio de S2 «`card` ≤150 KB medido» quedaría
**midiendo el byte que nadie descarga**, y S3 pasaría el gate sirviendo 2,5× de lo presupuestado por
imagen — con el gate en verde.

**Esto no es una crítica al código de S3: S3 no existe.** Verificado hoy: no hay un solo `srcSet` en
ningún `.tsx` del repo, `cardSrcSet` no tiene caller de producción, y `apps/web/app/(storefront)/`
todavía es sólo el proxy, el miss y `s/[slug]`. Por eso es un **requisito que S3 tiene que traer
escrito antes de implementarse**, no un hallazgo de revisión posterior:

1. el criterio de aceptación de S3 mide el `transferSize` del recurso que el browser **eligió** en un
   viewport móvil real (390×844, DPR 3), no el que el pipeline generó;
2. todo `srcset` de la vidriera lleva `sizes` explícito;
3. el guard falla si aparece un `srcset` sin `sizes`.

**El gate lo escribe el LEAD** (`scripts/**` es suyo por §4, y un gate no puede ser del mismo writer
que el código que audita). **`storefront-agent` implementa.**

#### El gate ya existe · `scripts/accept-s3.sh` (`1406c6f`, `d9d7719`) · **nació en rojo a propósito**

Escrito **antes** que S3, que es el punto: un gate que se escribe después del código se escribe para
que el código pase. Exige los **15 campos de la ficha** de `CLAUDE.md` §1. Dos correcciones del LEAD
que quedan asentadas acá:

1. **Mide el byte que el browser pide, no el que el pipeline generó** — `transferSize` del recurso
   que el browser eligió en un viewport de 390×844 a DPR 3. Sin eso, un `srcset` sin `sizes` hace
   que el browser asuma `sizes="100vw"`, pida 1170 px, elija `detail` (128.570 B) en vez de `card`
   (50.692 B), y **S3 pase el gate sirviendo 2,5× del presupuesto con el gate de S2 en verde**. El
   gate además detecta el `srcset` sin `sizes` **estáticamente**, no sólo midiendo.
2. **Los 4 campos que la primera versión daba por diferidos no lo están.** Decía que precio ARS + TC
   iban a S5, punto de retiro + horario y medios de pago a "settings de tenant", y canje a S8. Los
   cuatro tienen **schema y seed hoy**: `fx_settings`, `locations` (dos filas activas),
   `tenants.payment_methods`, `tenants.accepts_trade_in`. **Lo que S5 agrega es la pantalla** para
   que el dueño cambie el TC y el redondeo, **no el dato**. Este board no los difiere: S3 los
   renderiza o no pasa.
3. **Y aun así le faltaba el 15°, un mes entero.** Agregado el 2026-08-28 (`0edb661`, módulo
   **M3b**): el gate exigía 14 campos y **ninguna aserción sobre el botón `wa.me`**. Que un gate se
   escriba antes que el código lo protege de amoldarse al código; **no lo protege de tener un
   agujero**. Los dos puntos de arriba salieron de revisar el gate contra el presupuesto y contra el
   schema; este salió de no poder citar evidencia para una fila del board. Los detalles están en la
   nota de FASE 4, arriba, y el método en `DECISIONS.md` §"Notas operativas".

### T5 · el techo de 8 fotos está probado por forma, no por efecto  ·  cruza a `qa-agent`

`app-agent` cerró un TOCTOU en `addUnitPhoto`. La transacción toma
`select … from listings where tenant_id = … and id = … for update`
(`apps/web/app/(app)/_lib/listings/add-photo.ts:146-153`) **antes** del `count(*)` (`:156-168`), y
aborta con `{ kind: 'full' }` si el total ya llegó a `MAX_PHOTOS_PER_LISTING` (`:169`; la constante
es `8` en `_lib/listings/schema.ts:38`). Antes, el `update listings` del final tomaba ese mismo lock
pero **después** de contar, que es donde no sirve.

Sus tests unitarios corren con Postgres y R2 falsos: prueban que el lock **se pide** antes del
`count` y del `insert`. **No pueden probar que el lock serializa** — eso necesita dos conexiones a
Postgres real. Por la regla de desempate de `CLAUDE.md` §4 (concurrencia/RLS contra Postgres real =
`qa-agent`, vive en `tests/`), el caso es de `qa-agent`.

**Caso concreto:** un listing con 7 fotos, dos `addUnitPhoto` en paralelo con `withTenantDb` →
exactamente **8** fotos al final y un `ok:false` con el texto de techo (`FULL_MESSAGE`).

### T6 · `SELECT … FOR UPDATE` bajo RLS  ·  verificación pendiente, no bug

Lo planteó `app-agent` como lo único que no pudo verificar, y se anota tal cual: **no hay un defecto
conocido acá.**

`FOR UPDATE` no se contenta con el `USING` de la policy de SELECT: la fila tiene que pasar también
el `USING` de la policy de **UPDATE**, y el rol necesita privilegio de UPDATE sobre `listings`. Las
dos condiciones **se cumplen hoy**, y se ve en el mismo archivo: la misma transacción hace
`update listings` sobre la misma fila con el mismo rol (`add-photo.ts:185-188`).

Se anota igual porque es exactamente la clase de cosa que **no aparece en CI y aparece el día del
deploy** — el mismo modo de falla que el `GRANT` que costó un fallo de slice en FASE 2 (`CLAUDE.md`
§2: *"`GRANT` y RLS son dos capas y se evalúan las dos"*). Comparte harness con **T5** y se corre
junto.

### S2.3 · `refresh()` no limpia el `<input type="file">`  ·  deuda declarada de S2

Después de subir una foto, `addPhotoAction` llama `refresh()` sólo en el camino exitoso
(`stock/[id]/fotos/actions.ts:100`) y la lista se actualiza. **El input del browser conserva el
archivo elegido.**

Arreglarlo **no es un fix de una línea**, y por eso abre su propia slice en vez de colarse en otra:

- `PhotoActionState` es hoy `{ readonly error: string | null }`
  (`stock/[id]/fotos/photo-action-state.ts:7`) y el estado inicial es
  `{ error: null }` (`:11`). El éxito devuelve **exactamente el mismo valor** (`actions.ts:104`):
  desde el cliente, **inicial y éxito son indistinguibles**, así que no hay momento en el que sepa
  que tiene que resetear. Hace falta un discriminante nuevo.
- El reset no es sólo el DOM: `PhotoInput` guarda `busy`, `blocked` y `note` en estado local además
  del `inputRef` (`stock/_ui/photo-input.tsx:83-86`). Limpiar el archivo sin limpiar esos tres deja
  la pantalla mintiendo.
- El docblock actual de `photo-action-state.ts` dice *"No hay campo para 'la foto elegida': ningún
  navegador deja repoblar un `<input type="file">`"*. Es cierto y **no es lo mismo**: repoblar es
  imposible, **vaciar** no. El comentario se corrige en la misma slice o queda argumentando contra
  el arreglo.

Owner: **`app-agent`**.

### S3.1 · un tenant real nace sin FX y sin punto de retiro  ·  **CERRADA el 2026-08-28**

> **`done`.** El LEAD re-ejecutó `bash scripts/accept-s3.sh` (50 PASS, 0 FAIL). Lo que lo prueba no
> es que el `insert` esté escrito sino que M3 exige, contra el HTML servido, el punto de retiro
> (`Local Neuquén centro`), su horario (`lun a vie de 10 a 18`), el segundo punto y un ARS con la
> forma de `formatArs` terminado en `000` — y esos cuatro datos sólo existen si `fx_settings` y
> `locations` están sembrados.
>
> **Lo que el código ya hacía desde `eaccfee` (`docs-keeper`, verificado contra el repo).**
> `create-tenant.ts` inserta hoy `tenants` + `memberships` + `fx_settings` (`:218`) + un punto de
> retiro (`:226`) en una sola transacción, el alta pide el TC en ARS/USD, y `parse-fx.ts` delega en
> `fxRateFromDecimal` de `@istock/domain` en vez de re-implementar la aritmética de plata. El punto
> de retiro sembrado es un placeholder honesto (*"A coordinar por WhatsApp"*, `city` en `null` a
> propósito: no se le inventa una dirección al dueño), y **por eso existe T12** — sin pantalla de
> edición, ese placeholder es permanente. Se deja abajo el diagnóstico original, que es el que
> justifica la severidad y el gate.

**Diagnóstico original (cierto hasta `eaccfee`).** `create-tenant.ts` insertaba **`tenants` +
`memberships` y nada más**. No sembraba `fx_settings` ni una fila de `locations`. Consecuencia
directa: el dueño que se registra hoy carga
stock y la vidriera le devuelve **grilla vacía** — no hay TC para calcular el ARS ni punto de retiro
que mostrar, y los dos son campos obligatorios de la ficha mínima (`CLAUDE.md` §1).

**Por qué es alta y no cosmética:** rompe el *done cobrable* —"el dueño carga 15 equipos en una tarde
en Cipolletti y pega el link en un estado"— **para todo tenant que no sea el del seed**. El seed
tiene `fx_settings` y dos `locations` activas, así que el camino feliz de desarrollo no lo ve nunca.
Es la misma clase de defecto que la tabla sin `GRANT`: la app anda, los tests pasan, y aparece con
el primer usuario real.

Dónde va —alta o onboarding— lo decide `app-agent`. Lo que este board exige es el efecto, no el
lugar.

### S3.2 · publicar un equipo purga el catálogo entero del tenant  ·  **CERRADA el 2026-08-28**

> **`done`.** Cerrada por la misma corrida del LEAD, con la línea
> `MEDIDO s3 db-hits · ruta=/p/qae2e-iphonemtcm352f42 · primera=9 · cacheada=0`: la ficha cacheada
> no le manda **ni una sentencia** a Postgres, que es el efecto que esta fila pedía.
>
> **Lo que el código ya hacía desde `eaccfee` (`docs-keeper`, verificado contra el repo).**
> `storefront-cache.ts` expone tres entradas según el alcance de la mutación —`invalidateStorefront`
> (2 tags de tenant), `invalidateStorefrontUnit` (3) e `invalidateListing` (1)— y `publish-listing`
> las usa. Los tags se **importan** de `(storefront)/_lib/cache-tags`: una segunda definición del tag
> es una invalidación que no invalida. Se deja abajo el diagnóstico original, que es el que explica
> por qué la fila existe.

**Diagnóstico original (cierto hasta `eaccfee`).** `invalidateStorefront` recorría exactamente
`[storefrontTag(slug), tenantConfigTag(slug)]`. `listingTag(unitId)` **existía**
(`(storefront)/_lib/cache-tags.ts:91`) y la invalidación del panel no lo emitía nunca. O sea que publicar **una** unidad tira la entrada de
cache de **toda** la vidriera del tenant, y el siguiente visitante paga el render completo contra
Postgres.

No es un bug de corrección —la vidriera nunca queda vieja— sino de costo: es el objetivo del 95% de
hits sin Postgres (`CLAUDE.md` §3) pagando de más en cada alta. Falta `updateTag(listingTag(id))` al
mutar una unidad.

### T8 · el gate de S3 estaba en rojo por ausencia de medición  ·  **CERRADA el 2026-08-28**

> **`done`.** Las dos líneas se emiten y el LEAD las leyó en su corrida:
>
> ```
> MEDIDO s3 imagen  · viewport=390x844 dpr=3 · elegido=…5d49904070bcac12dc5fd1801d0f4ed0.webp#variante=card
>                   · transferSize=51016B · techo=204800B
> MEDIDO s3 db-hits · ruta=/p/qae2e-iphonemtcm352f42 · primera=9 · cacheada=0
> ```
>
> `elegido` termina en `#variante=card` y no en `detail`: el browser de un teléfono bajó **51 KB**
> donde el presupuesto permitía 200 KiB. Se conserva abajo el porqué del formato, que es lo que
> impide que la próxima medición se afloje.

`scripts/accept-s3.sh` falla si no encuentra las dos líneas (`:141-146`, `:166-169`), y falla otra
vez si las encuentra con otro formato (`:152`, `:175`). Los dos specs de `qa-agent` tienen que
emitir **exactamente**:

```
MEDIDO s3 imagen · viewport=390x844 dpr=3 · elegido=<url> · transferSize=<N>B · techo=204800B
MEDIDO s3 db-hits · ruta=<path> · primera=<N> · cacheada=<N>
```

**Requisito que pidió `storefront-agent` y que el LEAD ratifica: la línea de imagen se mide sobre la
grilla, no sobre la ficha.** El propio gate falla si `elegido` contiene `detail` en la grilla — que
es el defecto que P3 encontró y por el que existe esta medición: un `srcset` sin `sizes` hace que el
browser pida `detail` (128.570 B) donde el presupuesto dice `card` (50.692 B). Medir la ficha daría
verde midiendo el byte equivocado.

### S3.3 · la ficha de un tenant que no existe dice que el equipo se vendió  ·  `storefront-agent`

Abierta el 2026-08-28 al cerrar S3. Lo reconoció `storefront-agent` en su entrega y no tenía fila.

**El hecho, verificado contra el repo por `docs-keeper`.** `ListingPage`
(`apps/web/app/(storefront)/s/[slug]/p/[listing]/page.tsx:138-163`) **nunca llama a
`getStorefrontTenant`**. Valida la forma de los dos slugs y va directo a
`getStorefrontListing(slug, listingSlug)`, que devuelve `null` por **dos** motivos distintos —el
tenant no existe (o no está `active`), o el equipo no está publicado— y la página contesta el mismo
componente para los dos: `<ListingMiss />`, o sea **"Este equipo ya no está publicado"**
(`_components/listing-miss.tsx:71`).

**Por qué importa, y no es cosmética.** Al que abre el link de una vidriera que **nunca existió** le
decimos que *el equipo se vendió*. Le confirmamos un negocio que no está y lo dejamos esperando. La
respuesta correcta ya existe y está escrita: `STOREFRONT_MISS_TITLE` = **"No hay ninguna vidriera en
esta dirección"** (`_components/storefront-miss.tsx:72`), que es la página que la home de la vidriera
sí devuelve para el mismo caso. O sea que hoy **`{inventado}.maat.work/` y
`{inventado}.maat.work/p/{cualquiera}` contestan cosas distintas sobre el mismo hecho.**

**Alcance:** ~10 líneas. Un `getStorefrontTenant(slug)` antes del loader de la ficha, y `<StorefrontMiss />`
en la rama `null`. La función ya es `'use cache'` y ya cachea su `null` con `STOREFRONT_MISS_LIFE`
(`_lib/tenant.ts:71-100`), así que **no agrega una query por pageview**: el bot que escanea
subdominios sigue pagando una vez y cero después. No toca el camino feliz.

**Gate:** una ficha bajo un slug de tenant inexistente contesta el *tenant-miss* y no el
*listing-miss*, con el `noindex` de ADR-011 y sin perder el cacheo corto del `null`.

**No es ADR-011 ni su corolario de `ba8536c`.** Aquellos son sobre el **status** y sobre que la
primera request no salga en blanco. Éste es sobre **cuál de los dos textos** se devuelve, y los dos
casos ya salen 200 con contenido.

**Actualización del 2026-08-28, tarde — pasa a `doing`.** El arreglo **está en el working tree, sin
commitear**: `page.tsx` ya importa `getStorefrontTenant` y `StorefrontMiss`, la rama `null` del
loader devuelve `(await storefrontExists(slug)) ? <ListingMiss /> : <StorefrontMiss />`, y el mismo
desempate se aplica al `<title>` en un solo lugar (`missMetadataFor()`), que era la otra mitad del
bug —un cuerpo que dice "no hay vidriera" con un `<title>` que dice "este equipo ya no está
publicado" es el mismo defecto corrido de lugar—. Trae además una decisión que la fila no pedía y
que conviene mirar al aceptar: un slug de tenant que **no pasa `isSlugShaped`** ahora contesta el
tenant-miss **sin consultar Postgres**, apoyándose en el CHECK `tenants_slug_format` de
`packages/db` (si no puede entrar a la tabla, no hace falta preguntar). **`docs-keeper` no afirma
que esto funcione:** lo que está verificado es que el código existe y qué hace. Falta la corrida del
gate por el LEAD.

### T9 · la forma de `listings.slug` · **CERRADA el 2026-08-28**, con un resto en vuelo

`listings.slug` entra al **cache key de `'use cache'`** y a una **URL pública**, y la base lo aceptaba
sin mirar (`tenants.slug` sí tenía CHECK desde `0000`). Cerrado en las dos capas:

- **`packages/domain`** declara `LISTING_SLUG_PATTERN` / `LISTING_SLUG_MIN_LENGTH` (3) /
  `LISTING_SLUG_MAX_LENGTH` (64) / `isListingSlugShaped` (`src/slug.ts:119-135`), con **15 tests**
  propios dentro de los 38 de `slug.test.ts`.
- **`packages/db`** agrega `drizzle/0003_listing_slug_format.sql` con la **misma forma**, y
  `src/listing-slug-format.test.ts` la ejerce con **21 casos contra Postgres real**, de polaridad
  principal **negativa**: lo que se prueba primero es que la base **rechaza**.

El patrón está **duplicado a propósito**: el SQL no puede importar de `domain`. Techo 64 y no 32
porque el slug de tenant es un label DNS (vive en el host) y el de listing vive en el path — la fila
207 del seed tiene 37 caracteres y es legítima.

**Resto en vuelo, no cerrado:** `storefront-agent` tiene que borrar su copia local e importar de
`domain`. **No se marca cerrado hasta que el LEAD lo confirme.**

### T10 · ocho comandos de aceptación corrían la suite entera creyendo filtrar  ·  **CERRADA** (`0d647c6`)

**El diagnóstico que tenía este board era peor que el problema, y estaba mal.** Decía que
`pnpm --filter web test -- storefront` *"no resuelve"*. **Sí resolvía** — `--filter web` matchea por
directorio— y eso lo empeora: el LEAD lo midió y el comando corría los **13 archivos y 147 tests**
del paquete, con el patrón perdido. Un patrón inventado (`-- patron-que-no-existe-123`) devolvía los
mismos 147 en verde. O sea que cuatro contratos de agente y cuatro skills le decían a su owner *"esta
es tu aceptación"* y le entregaban un verde que **no era sobre su slice**. Un comando que no resuelve
se nota; uno que aprueba de más, no.

Trampa que se llevó puesta al arreglo obvio: la forma que **sí** filtra por script del paquete
(`run test <patrón>`) hereda el `--passWithNoTests` de `apps/web/package.json`, así que un patrón mal
escrito imprime *"No test files found"* y sale **0**. La forma que quedó es
`pnpm --filter @istock/web exec vitest run <patrón>`, verificada en las dos polaridades: filtra a 7
archivos / 90 tests con `storefront`, y **sale con exit 1** ante un patrón que no matchea nada.
Lo mismo para los `pnpm e2e -- <patrón>`, que pasaron a
`pnpm --filter @istock/e2e exec playwright test <patrón>`.

Alcance real: **8 comandos** en 4 contratos de agente (`app`, `billing`, `qa`, `storefront`) y 4
skills (`isr-revalidate`, `mp-subscriptions`, `storefront-ficha`, `tradein-flow`). El texto vive en
`.claude/**`, del **LEAD** por `CLAUDE.md` §4; `docs-keeper` lo reportó y no lo editó.

Para S3 el comando de aceptación sigue siendo `bash scripts/accept-s3.sh`, no un filtro de vitest.

**Salió de la misma corrida un segundo defecto, ya corregido:** `accept-fase3.sh` declaraba *"cero
tests skipeados"* sin leer nada — corría `pnpm -s test`, y con `-s` pnpm silencia a los hijos, así
que el log quedaba en **cero bytes** y el `grep` de "skipped" sobre un archivo vacío decía "cero
skipeados" **siempre**, incluso con la suite entera skipeada. Ahora exige **5 resúmenes de vitest**
antes de opinar sobre skips, y si el log no trae resumen la regla **no midió y falla**.

### T12 · el TC no se puede cambiar después del alta  ·  `app-agent`  ·  es producto, no cosmética

`apps/web/app/(app)/app/(panel)/ajustes/page.tsx` es **sólo lectura**, y no por olvido: no hay ni
una Server Action en el directorio (cero `'use server'`), y la propia pantalla lo admite con un
`NotReadyYet` que dice *"Editar estos datos, el tipo de cambio y los puntos de retiro llega en la
próxima entrega"*. La única mutación de `fx_settings` y de `locations` en todo el repo es el
`insert` del alta (`create-tenant.ts:218` y `:226`, sembrados por **S3.1**).

**Por qué esto es producto.** El TC lo setea el **dueño**, a mano, por tenant, y **no hay API de
dólar en el hot path** (`CLAUDE.md` §1): es la decisión de diseño, no una carencia. Pero de ahí se
sigue lo contrario de lo que hay hoy — si el número lo pone una persona, esa persona lo va a mover,
y más de una vez por semana. Hoy la única forma de moverlo es **volver a crear el negocio**, que
además quema el slug: es inmutable después del alta porque ya está pegado en estados de Instagram y
en chats de WhatsApp que no controlamos.

Lo mismo con los puntos de retiro: el alta siembra **uno solo** y es un placeholder honesto
(*"A coordinar por WhatsApp"*, `city` en `null` a propósito). El plan Negocio vende **3 puntos de
retiro** (`CLAUDE.md` §1) y punto de retiro + horario son campos **obligatorios** de la ficha mínima.

Al escribirlo, el borde que ya está resuelto en el repo y no hay que reinventar: cambiar el TC
cambia lo que se ve en la vidriera, así que la mutación arrastra invalidación — y es
`invalidateStorefront(slug)` (los 2 tags del tenant), no `invalidateStorefrontUnit`: el TC afecta a
**todas** las fichas, no a una unidad.

### T13 · `/_media` no manda `Timing-Allow-Origin`  ·  `app-agent`

La ruta responde con `content-type`, `content-length`, `cache-control` inmutable y
`x-content-type-options` (`route.ts:87-95`), y **nada más**. Las fotos se sirven desde **otro origen**
que la vidriera (`img.maat.work` contra `{slug}.maat.work`; en local
`127.0.0.1.nip.io:3100/_media/…` contra `{slug}.127.0.0.1.nip.io:3100`), y para un recurso
cross-origin el spec de Resource Timing reporta `transferSize`, `encodedBodySize` y
`decodedBodySize` en **0** salvo que la respuesta traiga `Timing-Allow-Origin`.

**Consecuencia, medida por `qa-agent` y no supuesta: ninguna medición de bytes de imagen puede salir
de la Performance API.** Ni los e2e —por eso el spec de la grilla mide con `request.sizes()` de
Playwright (`responseBodySize + responseHeadersSize`), que no depende de CORS— ni RUM en producción
el día que exista. La evidencia que hoy está en `main` es el propio gate: `accept-s3.sh:144` nombra
la falta de `Timing-Allow-Origin` en `/_media` como la causa típica del 0 y explica por ahí por qué
el spec mide con Playwright.

**Lo que hoy hay es un workaround del spec, no una solución.** El gate ya no acepta el 0:
`scripts/accept-s3.sh:132-145` falla si `transferSize < 1024 B` —*"ausencia de medición no es un
número chico, es ausencia"*— y su propio `inf` nombra este header como la causa típica (`20fb7ac`).
O sea que el agujero está **tapado y anotado**, que es distinto de cerrado.

> **Ojo con el path.** El directorio en disco es `apps/web/app/(app)/%5Fmedia/[...key]/`, con el
> guión bajo **percent-encoded**: un `_` literal haría que Next tratara la carpeta como privada y la
> ruta no existiría. La URL pública sí es `/_media/…`. Buscarla como `_media` no la encuentra.

**Confirmada abierta el 2026-08-28**, después de la aceptación de S3 (`docs-keeper`): un grep de
`Timing-Allow-Origin` en todo el repo devuelve **sólo** este board, `INDEX.md`, dos comentarios de
`accept-s3.sh` y tres del spec de la grilla. **Cero en `route.ts`.** Owner sigue siendo `app-agent`.

### T14 · dos prohibiciones de `CLAUDE.md` §2 que ningún gate afirma  ·  `qa-agent`

Verificado una por una el 2026-08-28 contra los gates del repo. **De la lista de §2 quedan dos sin
nadie que las chequee:**

1. **Rate limiting con contador en Postgres sobre la vidriera.** Cero menciones de *rate limit* en
   `scripts/**`, `apps/web/scripts/**`, `tests/**` y `e2e/**`. **No es lo mismo que T1:** T1 es la
   *implementación* que falta (las 2 reglas de Vercel Firewall); esto es que **nada detecta la
   violación**. Mañana alguien mete un `insert into rate_limit_hits` en el render de la vidriera y
   todo el pipeline sale verde — rompiendo el 95% de hits sin Postgres, que es el objetivo entero.
2. **Imagen original (>500 KB) servida a la vidriera.** Hay dos chequeos y **ninguno corre en cada
   push**: el probe `scripts/probes/s2-media-measure.test.ts:47` fija
   `MASTER_MAX_BYTES = 800 * 1024` pero sólo se ejecuta **dentro de `accept-s2.sh`** (`:32`), que no
   es un job de CI; y el byte que el browser **baja** lo mide M2 de `accept-s3.sh` (techo
   204800 B). El propio `guard-r2.sh:12` declara que esta regla queda afuera de él (*"cubierto por
   scripts/probes, no aca"*). La regla existe en dos lados y no corre en ninguno.
   **Actualizado el 2026-08-28:** M2 ya no está bloqueado —corrió y midió `transferSize=51016B`—
   pero eso **no cierra esta fila**: `accept-s3.sh` sigue sin ser un job de CI, así que la regla se
   afirma cuando el LEAD corre el gate a mano, no en cada push. Que es justo lo que T14 pide.

**Desempate de columna, para que no se trabe cuando se agende.** Si la forma que se elige es un
grep-guard en `scripts/**`, el dueño es el **LEAD** —un gate no puede ser del mismo writer que el
código que audita, igual que **T2**—. `qa-agent` es el dueño si la forma es un test que **siembra la
violación** en `tests/`. La segunda es preferible para la 1: un grep de *"rate limit"* es fácil de
esquivar sin querer.

**Lo que sí tiene gate y este board no vuelve a pedir** (verificado, para que nadie lo reabra):

| prohibición de §2 | quién la afirma hoy | ¿en CI? |
|---|---|---|
| `tenant_id` fuera de `app_metadata` | `guard-leaks.sh:127` (§7) · `apps/web/scripts/web-lint.mjs:123` (W008) · `accept-fase3.sh:61` | sí (las dos primeras) |
| tabla nueva sin `GRANT` | `scripts/guard-grants.sh` | sí, desde `985c369` — antes **sólo** corría dentro de `accept-s1.sh`, que no está en CI |
| borrado de un objeto de R2 por key | `scripts/guard-r2.sh` R1 + R2 (**T11**, `done`) | sí |

### T15 · el seed del demo dice un color en la URL y otro en la página  ·  `db-agent`

Abierta el 2026-08-28. **Salió de una medición, no de una revisión:** M3b de `accept-s3.sh` decodifica
el `text=` del `wa.me` de la ficha del demo e imprime el mensaje real, y ahí se ve el par:

```
mensaje: Hola, vi el iPhone 14 Pro 256 Negro espacial (usado A) a USD 620 en demo.maat.work y lo quiero.
slug:    iphone-14-pro-256-grafito
```

**Los hechos, verificados en `packages/db/src/seed-data.ts`:** el listing `:114` tiene
`slug: 'iphone-14-pro-256-grafito'`, `title: 'iPhone 14 Pro 256 GB Negro espacial'` (`:115`) y
`color: 'Negro espacial'` (`:116`). El modelo `iphone-14-pro` (`:49`) declara
`colors: ['Negro espacial', 'Plata', 'Oro', 'Morado oscuro']` — **`Grafito` no está entre sus
colores**; sí es un color de `iphone-13-pro` (`:46`). Dato al lado, sin conclusión: el string
canónico de ejemplo de `CLAUDE.md` §1 dice *"iPhone 14 Pro 256 Grafito"*.

**Qué NO se afirma acá, a propósito:** no está verificado si el slug se deriva del color en algún
lado, si se escribió a mano, o cuál de los dos valores es el equivocado. **Es una pregunta abierta
para `db-agent`, no un diagnóstico** — y cuál corregir cambia según eso.

**Por qué es prioridad baja y aun así entra al board:** no rompe nada, ningún gate lo mira, y el
mensaje de WhatsApp que factura es correcto (nombra el color de la página). Lo que se rompe es más
chico y más caro de explicar: en el `/demo` que se le muestra a un reseller, **la URL dice una cosa y
la página dice otra**. Es exactamente el tipo de detalle que un reseller sí mira, porque el color es
parte del precio.

## FASE 5 — Chatbot (post S4/S8)
Capa 2. Se **diseña** en FASE 1, se **codea** después de S4/S8. Ver `docs/CHATBOT.md`.

## FASE 6 — Billing
MP Subscriptions, trial 14d, feature flags, webhook idempotente. Ver skill `mp-subscriptions`.

## FASE 7 — Test matrix
Ver `docs/TEST_MATRIX.md`.

## FASE 8 — README de operador
env · seed · wildcard local (nip.io) · **cómo NO apagar el spend cap**.

## FASE 9 — Guardar workflow + retrospectiva del harness

---

## Blockers abiertos

| # | blocker | bloquea | quién lo destraba |
|---|---|---|---|
| B1 | credenciales de Cloudflare R2 (account id, bucket, access key) | K5, S2, **S2.1** | **humano** |
| B2 | proyecto Supabase + service role key + **spend cap ON** | D2, D3 | **humano** |
| B3 | credenciales de Mercado Pago (**sandbox** + app + webhook secret) | FASE 6, **ADR-008** | **humano** |
| B4 | API key de Gemini y/o Groq | FASE 5 | **humano** |
| B5 | **migrar los nameservers de `maat.work` a `ns1/ns2.vercel-dns.com`** | K3, S1 (prod) | **humano — arrancar ya** |
| B6 | número de WhatsApp del tenant demo | S4, S13 | **humano** |

> **B5 creció en FASE 1 (R1).** El wildcard `*.maat.work` se certifica por DNS-01, y Vercel sólo lo
> emite si el dominio usa **sus** nameservers. No alcanza con un CNAME: hay que mover el DNS
> completo de `maat.work` a Vercel, con **24–48 h de propagación**. Es el blocker con más lead
> time de los seis y no depende de nada nuestro → **conviene arrancarlo antes que B1–B4**, aunque
> se use recién en K3.
> Efecto colateral a mirar antes de apretar el botón: todo registro MX/TXT actual de `maat.work`
> (mail, verificaciones) hay que recrearlo en Vercel o se cae.
