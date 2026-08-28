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

**No re-ejecutada.** `scripts/accept-fase3.sh` termina en `next build`, y el `next build` **está roto
ahora mismo** (`usePathname()` fuera de `<Suspense>` en `/app/stock/[id]/fotos`; lo está arreglando
`app-agent`). El LEAD no promueve filas cuyo gate no pudo correr. Las cinco quedan `todo` hasta que
el build vuelva y el gate corra entero.

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
| S1 | host → hello storefront | doing | `storefront-agent` | `{slug}.local` resuelve al tenant; slug inexistente → página legible con `noindex` (**ADR-011**, el gate viejo "404 real en la primera request" era inalcanzable); se verifica con `bash scripts/accept-s1.sh` |
| S2 | listing unit + fotos R2 con variantes | todo | `media-agent` → `app-agent` | 3 variantes generadas; `card` ≤150KB medido |
| S3 | grilla + ficha mínima | todo | `storefront-agent` | los 15 campos de la skill `storefront-ficha`; cero campos prohibidos en el HTML |
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

> **Estado de S1 y S2 al 2026-08-27 — medido, no supuesto.**
> **S1 sigue `doing`** y **S2 sigue `todo`**: los dos gates (`scripts/accept-s1.sh`,
> `scripts/accept-s2.sh`) terminan en `next build` y **el `next build` no compila**
> (`usePathname()` fuera de `<Suspense>` en `/app/stock/[id]/fotos`, `app-agent` lo está
> arreglando). El gate de S2 lo corrió el LEAD y **falló ahí**. Que el código esté escrito no es el
> gate; el gate es la corrida.
>
> **El aviso de drift de FASE 2 se cerró.** D1–D4 pasaron a `done` con la re-ejecución registrada
> arriba, en "Evidencia de la re-ejecución". FASE 3 y S1/S2 no: no se pudieron correr.

---

## FASE 4 bis — trabajo que salió de una slice, no del plan original

> Todo lo de esta sección apareció **haciendo** S1 y S2, o **corriendo sus gates**. No estaba en el
> orden fijo de FASE 4 y no lo reordena: son entradas propias con su propio dueño y su propio
> bloqueo. Las dos últimas (**T3**, **T4**) salieron de la re-ejecución del LEAD del 2026-08-27 y no
> son deuda de producto: son deuda **de los instrumentos** — quién es dueño del test que audita las
> policies, y por qué los cuatro gates no comparten un helper.

| id | título | estado | owner | bloqueo | gate de aceptación | artefacto |
|---|---|---|---|---|---|---|
| S2.1 | upload directo a R2 por URL prefirmada | blocked | `media-agent` → `app-agent` | **B1** + pregunta abierta de abajo | 8 fotos sin round-trip por foto; el original **nunca** es alcanzable; `card` sigue ≤150KB | `packages/media/src/*`, `apps/web/app/api/**` |
| P1 | `robots.txt` / `sitemap.xml` por tenant — **decisión de diseño** | todo | `storefront-agent` + `qa-agent` | — | decisión escrita **antes** de arrancar S3 | ADR nueva en `DECISIONS.md` (la escribe `docs-keeper`, la ratifica el LEAD — `architect` está dormido desde FASE 1) |
| P2 | metadata file conventions bajo host de tenant — **decisión de diseño** | todo | `storefront-agent` + `qa-agent` | — | decisión escrita **antes** de arrancar S3 | ADR + guard ampliado |
| T1 | rate limiting en el edge: las 2 reglas de Vercel Firewall | todo | **LEAD** (`vercel.json`, §4) | — | 2 reglas activas + prueba de que disparan; **cero** contador en Postgres sobre la vidriera | falta definir (no hay `vercel.json` hoy) |
| T2 | guard estático de "query sin filtro de tenant" | todo | **LEAD** (`scripts/**`, §4) | — | el guard falla sobre una query sin `tenant_id` **y** pasa con la excepción declarada | `scripts/guard-leaks.sh` §16 |
| T3 | mudar el test de RLS cruzado a `tests/` | todo | `qa-agent` | agendado **después** de que cierre S2 | los 59 `it()` corren desde `tests/` contra Postgres real, verdes, sin perder ninguno; `packages/db/src/rls-cross-tenant.test.ts` deja de existir | `tests/` |
| T4 | extraer los helpers de los gates a `scripts/_lib.sh` | todo | **LEAD** | — | un solo `none()` en el repo; los **4** gates (`accept-fase2`, `accept-fase3`, `accept-s1`, `accept-s2`) re-corridos y con el mismo veredicto que antes | `scripts/_lib.sh` |
| S2.2 | `collectOrphanObjects` existe y no lo llama nadie | todo | `media-agent` (función) + `app-agent` (comentarios) | — | se elige **(a)** o **(b)** por escrito: si (a), el job corre y borra un huérfano sembrado; si (b), **ningún** comentario del repo la nombra en presente | `packages/media/src/unlink.ts`, `apps/web/app/(app)/_lib/listings/*.ts` |
| S2.3 | el `<input type="file">` conserva la foto después de subirla | todo | `app-agent` | — | tras un alta exitosa el input queda vacío; `PhotoActionState` distingue inicial de éxito | `apps/web/app/(app)/app/(panel)/stock/[id]/fotos/*` |
| P3 | el gate de S3 mide el byte que el browser **pide**, no el que el pipeline generó | todo | **LEAD** escribe el gate · `storefront-agent` implementa | — | escrito **antes** de arrancar S3 — ver abajo | `scripts/accept-s3.sh` (no existe hoy) |
| T5 | concurrencia real del techo de 8 fotos, contra Postgres real | todo | `qa-agent` | comparte harness con **T3** | 7 fotos + dos `addUnitPhoto` en paralelo → exactamente 8 fotos y un `ok:false` de techo | `tests/` |
| T6 | `SELECT … FOR UPDATE` bajo RLS: verificación pendiente, no bug | todo | `qa-agent` | corre con **T5** | el `for('update')` devuelve la fila con rol `authenticated` y el claim del tenant, sin `42501` | `tests/` |

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

### P1 · `robots.txt` y `sitemap.xml` por tenant  ·  decisión previa a S3

Los encontró `storefront-agent` cerrando el agujero de `/_media` en el `matcher`.

Hoy los dos están excluidos **por nombre** en el `matcher` de `apps/web/proxy.ts`, y el guard de
`qa-agent` (`tests/proxy-matcher-no-deja-la-vidriera-sin-vigilar.test.ts`) **afirma que tienen que
quedar excluidos**: están en su lista `STATIC` con `expect(proxyRuns(asset, matchers)).toBe(false)`.

Cuando S3 los haga por tenant van a necesitar resolución de host y rewrite a
`/s/{slug}/robots.txt` — lo que choca **de frente con las dos cosas a la vez**: con la exclusión del
matcher y con el guard que la sostiene. Es decisión de diseño previa a la slice, **no un parche
adentro**.

### P2 · metadata file conventions bajo host de tenant  ·  decisión previa a S3

El guard de arriba enumera rutas con `ROUTE_FILES = new Set(['page.tsx', 'page.ts', 'route.ts',
'route.tsx'])`: **los file conventions de metadata de Next no están ahí**. Un `icon.png` o
`apple-icon.png` por tenant se sirve, bajo el host del tenant, en `/icon.png` → sufijo `.png` →
fuera del matcher → sin rewrite → **el visitante de `acme.maat.work` recibe el ícono del apex**.

Es **la misma clase de bug** que el de `/_media` que se acaba de arreglar, con otro sufijo y con un
guard que hoy no lo vería. (`opengraph-image` sí queda cubierto: su URL no tiene extensión.)
Detalle en `ARCHITECTURE.md` §"Qué NO se reescribe".

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

**Se agenda después de que cierre S2.** Mudar 59 tests con una slice en vuelo es riesgo sin apuro.
Al mudarlo hay que corregir también el encabezado del archivo, que hoy argumenta lo contrario: si se
mueve el código y queda el comentario, el próximo agente lee la versión vieja de la decisión.

### T4 · los helpers de los gates están duplicados y ya divergieron  ·  deuda de los gates

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
(`ok`/`bad`/`head`/`strip_comments`), sin `none()`.

Hay que extraer los helpers a un **`scripts/_lib.sh` único**. Owner **LEAD** (`scripts/**` es suyo
por §4, y un gate no puede ser del mismo writer que el código que audita). **Requiere re-correr los
cuatro gates** para probar que no se rompió ninguno — por eso no se hizo en el momento en que se
encontró el bug: tocar los cuatro auditores a la vez, con el `next build` roto, es cambiar el
instrumento en medio de la medición.

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
