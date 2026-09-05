# SLICE_BOARD — estado de la verdad del avance

> **Qué es:** el estado de la verdad del avance — una fila por slice, con su gate, su dueño y su
> artefacto — más los blockers y el trabajo que salió de hacer una slice.
> **Para quién:** el LEAD antes de repartir trabajo, y cualquier agente antes de tocar una fila.
> **Cuándo se actualiza:** con cada slice y con cada corrida de gate del LEAD. Lo mantiene
> `docs-keeper`, que **verifica contra el código antes de escribir** y reporta la discrepancia en vez
> de arreglar el código.
>
> Una slice pasa a `done` **sólo** cuando el **LEAD re-ejecutó** su comando de aceptación y el
> resultado fue verde. Que un agente diga "pasa" no alcanza. Que el código esté en `main` tampoco:
> ya tuvo a S1 en `doing` y a S3.1/S3.2 en `todo` un día entero con el código entregado.
>
> **Y hay una clase que va por la CUARTA vez, contada por el LEAD el 2026-08-28: una afirmación falsa
> que sobrevive EN PROSA después de haber sido corregida en la tabla.** La tabla es lo que todos
> miran y lo que el gate cuenta; los encabezados de sección, los blockquotes y las notas al pie no
> los mira nadie con la fila en la mano, así que ahí una falsedad envejece sola. Las dos instancias
> de esta ronda: el encabezado de §"T21–T25 (+ T31)" decía **"T24 está `doing`"** y **"T31, `doing`"**
> con las dos `done` desde `4a9a8de`/`dd871ce` —y con la corrección ya escrita ~100 líneas más
> arriba, en §"Tercera tanda", o sea el board contradiciéndose a sí mismo—, e `INDEX.md` decía
> *"`packages/ai` no existe"* con `T19` ya corregida en esta tabla y el paquete en `main` desde
> `d42fac9`.
>
> **La regla que deja el LEAD: si aparece una quinta, se reportan las cinco juntas y deja de ser una
> corrección — pasa a ser un gate que falta.** Cuatro instancias arregladas de a una son la firma de
> una clase sin gate, que es exactamente el argumento con el que nacieron `T28` y `T30`.
>
> **Dicho como regla y no como caso, porque ya se aplicó cuatro veces:** el reporte verde de un
> agente **no mueve la fila** a `done`. Lo que la mueve es la corrida del LEAD, y esa corrida puede
> volver en rojo: el 2026-08-28 **T21 volvió en rojo después de haber sido reportada verde**, y el
> defecto que encontró era el alta de reservas del panel, rota en producción.
>
> **`esperando gate` es un estado propio desde el 2026-08-28, y NO cuenta para el tope de `doing`.**
> Esta línea decía lo contrario —*"esperando gate se escribe `doing`, no hay un quinto estado y no lo
> va a haber"*— y la **corrigió el LEAD**, contestando la pregunta que este board le hizo. El motivo
> del corte no es taxonómico, es de qué mide cada número. **El tope de `doing` existe para acotar
> cuántos writers están escribiendo a la vez**, y una fila que espera que el LEAD re-ejecute un gate
> no tiene a nadie escribiendo: contarla ahí bloquea a un writer libre. Y `done` tampoco es, porque
> el veredicto todavía no existe.
>
> El riesgo que la línea vieja temía —que *"entregado pero sin correr"* se lea como `done` a los dos
> días— es real y se ataca donde corresponde: **la celda de estado dice qué comando falta correr y
> quién lo corre.** Sin esas dos cosas escritas, la fila no puede estar en `esperando gate`; va a
> `doing`. Y si el tope de `doing` se pudiera bajar marcando `done` sin la corrida, el board estaría
> premiando exactamente lo que vino a impedir.
>
> **Y quien la escribió no la puede cerrar** (LEAD, 2026-08-28): una fila en `esperando gate` cuyo
> comando lo tiene que correr el LEAD **no la cierra el agente que la escribió**, ni siquiera
> corriendo el comando y viéndolo verde. Es **ADR-022 aplicado al board**: el gate no puede ser del
> writer que audita, y el veredicto tampoco. Lo que el agente sí hace —y es lo que se espera de él—
> es **correr el comando igual y dejar el número escrito**, marcado como corrida suya; eso acelera al
> LEAD y deja constancia si las dos corridas discrepan. Lo que no hace es mover la fila.
> Ya se aplicó tres veces el 2026-08-28: **T29** (este board marcó que el `done` lo fijaba una
> instrucción y no una corrida del LEAD, y el LEAD corrió), **T30** (`docs-keeper` corrió
> `guard-gates.sh`, lo dejó escrito, y la fila esperó igual hasta la corrida del LEAD) y **T32**, que
> es la primera que **estuvo** en `esperando gate` y salió de ahí: `docs-keeper` corrió
> `guard-doc-tables.sh`, anotó `PASS · 1157 filas · 165 tablas · 21 archivos`, escribió en la celda
> que su corrida no movía la fila, y la fila se movió cuando el LEAD corrió el mismo comando y le dio
> lo mismo. **Las dos corridas coincidieron, que es la otra mitad de para qué se anota el número:**
> si hubieran discrepado, la discrepancia estaría escrita en vez de perdida.
>
> **Cuando vuelve en rojo, el fallo se anota en la fila, con número.** `CLAUDE.md` §0 regla 3 dice
> que **dos fallos en la misma slice son STOP y re-plan**, así que el contador no es prosa: el que
> toma la fila tiene que poder ver, sin reconstruir el histórico, si el próximo intento es el último.
> Una fila que volvió de rojo y no lo dice gasta el segundo intento creyendo que es el primero.

Estados: `todo` · `doing` · `esperando gate` · `blocked` · `done`
**Regla:** máximo **una** slice en `doing` por directorio owner. **`esperando gate` no cuenta para
ese tope** (ver arriba), su celda tiene que nombrar **el comando** que falta y **quién** lo corre, y
**no la cierra el agente que la escribió** cuando el comando lo corre el LEAD.

## Última evidencia ejecutada — 2026-09-05

`HEAD` y `main` apuntan a `bb6ea63` (`[fix] marketing: stabilize desktop hero heading`); el
`origin/main` local todavía referencia `c0b09d4` (`[fix] marketing: clarify Mercado Pago payment
copy`). El fix CSS está incorporado en `bb6ea63`, en `apps/web/app/globals.css`: `.marketing-hero h1`
conserva `max-width: 11ch` y aplica `max-width: 12ch` sólo en `@media (min-width: 900px)`. El LEAD verificó
`E2E_PORT=3178 pnpm e2e`: **109/109**, **19/19 specs**, 0 skips; `pnpm typecheck`, `pnpm lint`,
`pnpm test` (**2977 passed**, 4 skips MP ADR-008/B3), `pnpm audit`, `pnpm build`, `accept-fase2` y
`accept-fase3` en PASS. La corrección de copy integra “La pantalla de pago…” en precios y destraba
K1 sin cambiar decisiones de producto.

El CI run `33942556793`, basado en `c0b09d4`, queda como diagnóstico histórico: falló antes del CSS
porque Ubuntu midió el H1 en 3 líneas. Todavía falta un CI posterior al commit CSS; no se usa ese run
para describir el estado actual.

Production es `dpl_EFeaAD5fjQkcF3WzqVkkgVUavANF`, Ready, URL
`istock-5850hfjzb-giolivos-projects.vercel.app`; `https://istock.maat.work` responde. Las rutas
públicas, `/api/health`, los rechazos 401/no-store de webhook, subscribe y cron, y el HTML sin
secretos responden lo esperado. `/s/not-a-tenant` y robots/sitemap fuera del tenant son 404
intencionales de `proxy.ts`.

La sonda externa de Cloudflare verificó T13 para CDN: la regla
`87a896569a304efd94370af6b0892312` (`istock_media_response_headers`) agrega
`Timing-Allow-Origin: *` y `X-Content-Type-Options: nosniff` a WebP de `img.maat.work`; la sonda
temporal dio 200 `image/webp` y luego 404 tras borrar/purgar, con ambos headers en ambos casos. Los
buckets `istock-media` e `istock-originals` terminaron con 0 objetos. Esto no verifica el upload S3
del pipeline de la app ni su `Cache-Control`; E11 (LCP con throttling) sigue sin cubrirse por falta
de Chrome DevTools MCP.

**Un encargo con varios ítems es UNA entrada en `doing`** — LEAD, 2026-08-28, resolviendo la
colisión `T50`/`S8.2`. El tope cuenta **writers trabajando en paralelo sobre un directorio**, que es
lo que la regla protege, no ítems adentro del mismo encargo. Las filas siguen siendo dos porque son
dos hallazgos distintos, y **cada celda nombra a la otra** para que la entrada única se pueda ver sin
reconstruirla. **La colisión se resolvió haciendo cierta la regla, no aflojándola:** `S8.2` estaba
`doing` sin nadie encima, y en vez de declarar una excepción el LEAD la sumó al encargo abierto de
`ai-agent`.

> **Cerrada el 2026-08-28 con el commit `89ab7c0`:** las dos filas pasaron a `done` a la vez —eran un
> encargo— y el ejemplo queda escrito porque el patrón vuelve, no porque el caso siga vivo.
> **La contradicción que esta nota registró sin arbitrar la CERRÓ el LEAD el 2026-08-28, y del lado
> que no era el de aflojar.** Lo registrado era: el LEAD despachó el cierre diciendo que `packages/ai`
> quedaba **sin** entrada en `doing`, y **`T19` seguía marcada `doing` sobre el mismo directorio**.
> O ese `doing` era un rastro viejo, o el conteo no era cero. **Es lo primero**, y el commit `1414302`
> lo convirtió en regla en vez de en excepción: **`CLAUDE.md` §0 regla 1, segunda precisión —
> `doing` marca un writer, no una pregunta abierta.** Una fila cuyo trabajo es *auditar*, *censar* o
> *decidir*, sin nadie editando archivos por ella, va a `todo` o `blocked`. **`T19` está en `todo`**:
> su trabajo pendiente es el censo de E7/E8/E9/S7, y el censo no escribe código.
>
> **Y el conteo de `doing` sobre `packages/ai` NO era cero por el otro lado, que es lo que termina de
> mostrar el costo:** al 2026-08-28, mientras `T19` figuraba `doing`, el writer que de verdad tenía
> el paquete abierto era `ai-agent` en otro encargo (`packages/ai/src/chat.ts` modificado en el árbol
> de trabajo). O sea que el `doing` de `T19` no marcaba a ese writer ni lo protegía: nombraba a nadie
> y tapaba a alguien.
>
> **Es el modo de falla espejo del de arriba, y por eso las dos precisiones viven juntas.** La
> primera nació de un `doing` de más que quería una excepción; la segunda, de un `doing` que
> **reservaba un directorio que nadie estaba usando** — si hubiera significado lo que decía,
> despachar `ai-agent` ese mismo día habría violado *"un writer por directorio"*.

---

## FASE 0 — Harness

| id | título | estado | owner | gate de aceptación | artefacto |
|---|---|---|---|---|---|
| F0.1 | `CLAUDE.md` + `AGENTS.md` | done | LEAD | archivos existen, no vacíos, con ownership table | `CLAUDE.md`, `AGENTS.md` |
| F0.2 | 14 subagents | done | LEAD | `ls .claude/agents/*.md \| wc -l` → 14 | `.claude/agents/` |
| F0.3 | 10 skills | done | LEAD | `ls .claude/skills/*/SKILL.md \| wc -l` → 10 | `.claude/skills/` |
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
| D3 | test RLS cruzado (A no lee B) | **done** | `qa-agent` | Postgres real, dos claims, dos conexiones físicas, sin un solo mock de la policy | `tests/rls-cross-tenant.test.ts` (mudado desde `packages/db/src/` en **T3**, `d686923`) |
| D4 | seed demo | **done** | `db-agent` | 8 iPhones + 2 accesorios + 1 `reserved`, **asertado en test**, no descrito en prosa | `packages/db/src/seed-data.ts` |

### Evidencia de la re-ejecución (2026-08-27)

| id | comando que corrió el LEAD | resultado medido |
|---|---|---|
| D1 | `pnpm --filter @istock/domain test` | **144 passed, 11 archivos.** Los 5 exports mapean 1:1: `applyFx`→`fx.test.ts` · `buildWaMessage`→`wa.test.ts` · `canTransition`→`listing-status.test.ts` · `expireReservation`→`reservation.test.ts` · `publicListingDTO`→`dto.test.ts` |
| D2 | `pnpm --filter @istock/db test` | **19 tablas, 17 con RLS**; las 2 sin RLS son exactamente `catalog_faqs` y `catalog_models` |
| D3 | `pnpm --filter @istock/db test` | **59 `it()` contra Postgres real** en `rls-cross-tenant.test.ts`, dentro de los 302 del paquete. **Los dos números quedaron viejos con T3** (`d686923`): el archivo ya no vive en `packages/db` y son **69** casos, no 59 — el 59 contaba `it()` literales y se comía el `it.each` sobre 10 columnas sensibles. Corrida vigente: la del LEAD desde `tests/`, `69 tests` verdes |
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
   (`tests/rls-cross-tenant.test.ts:809-811`; el `:236-237` que decía esta línea ya estaba corrido
   antes de la mudanza de T3). Global no quiere decir escribible: la siembra es de
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

**El LEAD re-ejecutó `bash scripts/accept-fase3.sh` el 2026-09-05 sobre `bb6ea63` y pasó.** K1–K4
quedan en `done`. K5 queda `blocked`: el gate estático pasa, pero el board reserva su cierre para
un byte real subido por el pipeline de iStock a R2.

> **Anti-drift, 2026-08-28.** El motivo que este board registró el 2026-08-27 —*"el `next build`
> está roto"* (`usePathname()` fuera de `<Suspense>`)— **ya no es cierto**, y quedó probado dos
> veces: la medición de ADR-014 corrió `next start` en :3199, y ahora el propio gate compiló y
> listó las rutas (`○ /`, `ƒ /_media/[...key]`, `ƒ Proxy (Middleware)`). **La corrida que faltaba
> en esta nota histórica quedó hecha el 2026-09-05**; el estado vigente de K1–K5 está en la tabla
> inmediata de abajo.

| id | título | estado | owner | gate de aceptación | artefacto |
|---|---|---|---|---|---|
| K1 | marketing honesta (sin promesas falsas) | **done · 2026-09-05 · LEAD reejecutó `bash scripts/accept-fase3.sh`** | `app-agent` | `bash scripts/accept-fase3.sh` §K1 | `apps/web/app/(marketing)/` · copy en `precios/page.tsx` |
| K2 | auth + crear tenant + slug | **done · 2026-09-05 · LEAD reejecutó `bash scripts/accept-fase3.sh`** | `app-agent` | `bash scripts/accept-fase3.sh` §K2 | `apps/web/app/(app)/` |
| K3 | proxy de host (`proxy.ts`) | **done · 2026-09-05 · LEAD reejecutó `bash scripts/accept-fase3.sh`** | `storefront-agent` | `bash scripts/accept-fase3.sh` §K3 + §K3b (todo cache tag lleva slug) | `apps/web/proxy.ts` |
| K4 | layout del panel (mobile-first) | **done · 2026-09-05 · LEAD reejecutó `bash scripts/accept-fase3.sh`** | `app-agent` | `bash scripts/accept-fase3.sh` §K4 | `apps/web/app/(app)/` |
| K5 | probe de upload a R2 | **blocked** | `media-agent` → `app-agent` | gate estático de `bash scripts/accept-fase3.sh` PASS; falta probe real de byte por pipeline | `packages/media/src/` · `apps/web/app/api/**` |

> **K5 no puede pasar a `done` mientras no exista una probe real de byte en R2, y el motivo no es el
> que decía este board.** Las credenciales de B1 ya están cargadas en Production.
> Corregido el 2026-08-27 contra el código: **el driver de R2 existe y está cableado** —
> `packages/media/src/storage/r2.ts` (151 líneas, `R2Driver` sobre la S3 API) y
> `storage/index.ts` lo elige con `MEDIA_DRIVER=r2`. El driver local no es lo único que hay: es el
> **default mientras B1 esté abierto** (`env.ts` exige las credenciales sólo si `MEDIA_DRIVER=r2`).
> Lo que falta es la otra mitad de la palabra *probe*: `accept-fase3.sh` §K5 es una verificación
> **estática** del paquete (existen las 3 variantes, `card ≤150KB` presupuestado, `CacheControl` por
> parámetro del SDK y no `httpMetadata`, unlink sin `DeleteObject`). **Ningún byte del flujo de upload
> de iStock viajó todavía a un bucket real.** La request pública a
> `/_media/nonexistent.webp` devuelve 404 controlado en Production, lo que acredita wiring y manejo
> de una key inexistente, pero no sustituye una carga real. La probe de byte queda pendiente.

## FASE 4 — Slices Capa 1 (ORDEN FIJO, no reordenar)

| id | slice | estado | owner | gate de aceptación |
|---|---|---|---|---|
| S1 | host → hello storefront | **done** | `storefront-agent` | `{slug}.local` resuelve al tenant; slug inexistente → página legible con `noindex` (**ADR-011**, el gate viejo "404 real en la primera request" era inalcanzable); se verifica con `bash scripts/accept-s1.sh`. **Re-ejecutado por el LEAD el 2026-08-28 en el barrido serial sobre `68c0bd6`: `PASS=39 · FAIL=0`.** El salto de 26 a 39 no es cobertura nueva de producto: **son las aserciones que antes se evaporaban.** A2 llamaba a `chk` y a `have` sin tenerlas importadas —vivían sueltas en `accept-fase3.sh`—, bash devolvía 127 por stderr y seguía, y `no()` nunca se llamaba. Ahora corren, y A2 además dejó de grepear el domicilio (`set local role` dentro de `tenant.ts`, un archivo del que el invariante ya se había mudado) para afirmar el invariante: **ningún archivo de la vidriera construye su propia conexión** — **ADR-020** |
| S2 | listing unit + fotos R2 con variantes | **done** | `media-agent` → `app-agent` | 3 variantes generadas; `card` ≤150KB **medido sobre bytes** (`card=50692B`, techo `153600B`). **Re-ejecutado por el LEAD el 2026-08-28: EXIT=0 · 21 PASS · 0 FAIL · `S2: ACEPTADA`**, y **repetido idéntico en el barrido serial sobre `68c0bd6`: `PASS=21 · FAIL=0`** — el único de los cinco que no movió un número, porque ninguno de los tres gates que ADR-020 arregló vivía acá |
| S3 | grilla + ficha mínima | **done** | `storefront-agent` | `bash scripts/accept-s3.sh`: los **15 campos** de `CLAUDE.md` §1 —los 15 de verdad recién desde **M3b** (`0edb661`), que agregó el botón `wa.me`—; cero campos prohibidos en el HTML; el byte medido es el que **pide el browser** (P3). **Re-ejecutado entero por el LEAD el 2026-08-28, barrido serial sobre `68c0bd6`: `PASS=59 · FAIL=0`** (la corrida que la aceptó dio 50; M3b sumó 8, y la novena salió de uno de los dos commits que tocaron el gate después —`7e40856` de S4.1 o `f691daf` de ADR-020—: **no se le adjudica a ninguno**). **M1 cambió de forma, no de vara** (**ADR-020**): escaneaba el archivo crudo y abría la ventana del tag en el primer `<` hacia atrás, así que un docblock que nombraba `srcSet` en **prosa** le hacía reconstruir un tag fantasma y reprobar `listings.ts`, que no renderiza una etiqueta. Ahora blanquea comentarios y strings **reemplazándolos por espacios**, para no mover un offset y que los números de línea reportados sigan siendo los del archivo real |
| S4 | botón `wa.me` + tracking de eventos | **done** | `domain-agent` → `storefront-agent` | texto exacto byte a byte; evento registrado sin PII. **Re-ejecutado entero por el LEAD el 2026-08-28, sin fixture: `./scripts/accept-s4.sh` → `PASS=38 · FAIL=0`** en el barrido serial sobre `68c0bd6` (la corrida que la aceptó dio 37), con la suite e2e ejecutada de verdad (73 passed) y `pnpm typecheck && pnpm lint && pnpm test` en 1004 passed / 0 failed. Las dos mitades del *byte a byte* siguen afirmadas por separado y hacen falta las dos: `packages/domain/src/wa.test.ts` U14 fija el string (`toBe(CANONICAL_TEXT)`) y M3b de `accept-s3.sh` prueba que la página servida lo lleva — **W1 de `accept-s4.sh` nombra las dos aserciones, no los archivos**, así que borrar M3b pone roja también a S4. Lo nuevo es el evento: W2/W3 (no hay dónde poner PII; `anon` gana exactamente un privilegio de columna y ni uno más), W5 (con JS apagado el botón sigue abriendo WhatsApp), W6/W6b (medición viva, y el cruce de tenant escribe **cero** filas), W7 (el endpoint nace con techo declarado en `config/firewall-rules.json`). **Deja abierta S4.1**, defecto del texto en el camino real |
| S5 | FX → precio en ARS | **done** | `domain-agent` → `app-agent` | TC del dueño; redondeo testeado; ARS visible en ficha. **Los tres tercios están afirmados y por comandos que el LEAD ya re-ejecutó**, aunque S5 nunca tuvo un `accept-s5.sh` propio: (1) el TC lo carga el dueño en el alta — campo `fxRate` en `create-tenant-form.tsx:192` → `fx_settings` por tenant (`create-tenant.ts:320` en `main`, sembrado por **S3.1**); (2) `applyFx` (`packages/domain/src/fx.ts:117`) con `DEFAULT_FX_ROUNDING = 'ceil_1000'` (`:35`) y los 4 modos testeados en `fx.test.ts` — `pnpm --filter @istock/domain test` → **187 passed / 12 archivos**; (3) el ARS sale en la ficha y lo exige **M3 de `accept-s3.sh`** con la forma de `formatArs`, en la corrida de **58 PASS · 0 FAIL** del LEAD. **El hueco que queda no es de S5: es T12** — el dueño no puede *editar* el TC después del alta. Ver §S5 abajo |
| S6 | reserva + scheduler de expiración | **done** · aceptada localmente por el LEAD el 2026-09-04 | `app-agent` (implementación) · **LEAD** (gate) | Reserva 30–120 min, barrido idempotente, revalidación por unidad y puerta manual `GET /api/cron/expire-reservations` con `CRON_SECRET`. El scheduler pasa a Inngest Free con `*/5 * * * *`; `vercel.json` ya no declara `crons`. **Aceptación:** `bash scripts/accept-s6.sh`, que corre V1 con `scripts/probes/s6-inngest-reachability.test.ts`, conserva V2 para el fail-closed manual y mantiene V3–V10. **Resultado local:** el LEAD re-ejecutó el gate sobre el árbol integrado; V1–V10 pasaron y el comando imprimió **S6: ACEPTADA**. **Artefacto:** `vercel.json` schema-only; `scripts/probes/s6-inngest-reachability.test.ts`; `apps/web/app/api/inngest/route.ts`, `apps/web/inngest/functions.ts` y mantenimiento compartido (código local); endpoint manual y `_lib/reservations/`. Cuenta/app, `INNGEST_SIGNING_KEY`, `INNGEST_EVENT_KEY`, sync, deployment y run real: **UNVERIFIED** |
| S7 | venta manual | **done** · 2026-08-28 | `app-agent` (impl) · **LEAD** (gate + probe) · `qa-agent` (aislamiento cruzado) · `db-agent` (migración `0007`) | **`bash scripts/accept-s7.sh`** → **`S7: ACEPTADA`**, re-ejecutado por el LEAD el 2026-08-28 sobre los seis commits de la slice (`df00474` `5bb0d1b` `6eab611` `82d866d` `02424f2` `60b3def`, **ninguno pusheado**). **Sin conteo de PASS registrado**: consta el veredicto, mismo caso que la corrida que cerró S4.1 y la primera de S6. El árbol alrededor sí tiene números, de la misma corrida: `pnpm typecheck` Done (7 proyectos) · `pnpm lint` PASS (16 reglas web + todos los paquetes) · `pnpm test` verde (`apps/web` 658 passed / 4 skipped · `tests/` 291 passed) · los **12** `guard-*.sh` verdes · las **9** `accept-*.sh` ACEPTADAS. **El 12 es de esa corrida y ya son 13**: `2ccb8a1` agregó `guard-effects.test.sh` **después** del veredicto (el commit se titulaba `[fix] T32: …` y el LEAD **enmendó el mensaje** el 2026-08-28, con lo cual el sha que esta celda citaba dejó de existir; el vigente es el de acá y la enmienda la cuenta la fila `T34`, que es donde vive esa historia) — se fecha en vez de reescribirse, que es la convención de este board para un número que se movió. **`pnpm e2e` NO se verificó — requiere `next build` y nadie lo corrió— y no se escribe como verde.** · **Qué afirma el gate:** **V1** el efecto `createsSale` tiene consumidor **fuera** de `packages/domain` (es el defecto original invertido: cuando abrió la slice daba **cero**, y `transitionUnit()` ejecutaba tres de los cuatro efectos de `TransitionEffects` descartando el cuarto en silencio — misma clase que el fallo de S6) · **V2** el margen lo deriva Postgres y el `insert` no lo nombra · **V3** el costo del formulario se ignora · **V4** el único `sales_one_sale_per_listing` está en el motor · **V5** typecheck/lint/test · **V6** lee `MEDIDO s7 venta` de la probe y compara sus **9 campos** contra literales escritos en el shell (**ADR-023**); **ausencia de la línea = FAIL, nunca PASS**. · **Auditoría de referencia de la venta:** `scripts/probes/s7-venta-manual.test.ts` (**LEAD**, 5 casos A–E contra Postgres real: una sola venta con el costo de `listings`; mover costo y TC después no reescribe la venta; ni el doble submit ni un estado revertido escriben una segunda; un tenant sin TC vende igual con `price_ars` NULL; `reserved → sold` cierra la reserva como `confirmed`). · **Aislamiento cruzado:** bloque **R9** de `tests/rls-cross-tenant.test.ts` (**`qa-agent`**, `60b3def`, **24 tests**, R9a–R9f: control positivo, lectura, los dos vectores del `INSERT`, `UPDATE`/`DELETE`, el margen que nadie escribe, y el par `(tenant_id, listing_id)` de D8). · **Implementación:** `apps/web/app/(app)/_lib/sales/record-sale.ts` — **`_lib/sales/`, no `_lib/listings/`**, corregido contra el árbol — llamado con el `tx` abierto desde `transitionUnit()` (`_lib/listings/publish-listing.ts:451` y `:519`), más `_lib/sales/{schema,presentation}.ts`, `app/(panel)/stock/_ui/{sell-form,unit-row}.tsx`, `stock/actions.ts`, `stock/status-action-schema.ts` y la migración `packages/db/drizzle/0007_sales_one_sale_per_listing.sql`. El costo nunca cruza un borde: `sales.cost_usd` se copia con un **subselect adentro del mismo `INSERT`** (`record-sale.ts:138`) y `margin_usd` es `generatedAlwaysAs`. · **La celda de gate anterior decía tres cosas y una era falsa, verificado contra el código:** *"sale de la grilla"* **no** es lo que hace el producto — `sold` está en `PUBLIC_STATUSES` (`packages/domain/src/types.ts:40`) y la unidad vendida **se queda** en la vidriera con badge `Vendido`, ordenada última (`STATUS_ORDER`, `(storefront)/_lib/listings.ts:211`), que es lo que ya decían `PRODUCT.md` Q2 y `DOMAIN.md` §190: el vendido es prueba social y el link vive en chats de WhatsApp para siempre. *"`→ sold`"* lo afirma V1+V6; *"URL directa no rompe"* se cumple y está probado **en unit** (`(storefront)/_lib/status.test.ts:131`, `packages/domain/src/dto.test.ts:275`), **no** en `accept-s7.sh` ni en un e2e — dicho como hueco, no como cobertura |
| S8 | canje: form + inbox + accept-to-stock | **done** · 2026-08-28 | `storefront-agent` (form + endpoint + proxy) · `app-agent` (inbox + accept-to-stock) · `db-agent` (migración `0008`) · `qa-agent` (auditoría de referencia cruzada) · **LEAD** (gate, probe y los dos lints) | **`./scripts/accept-s8.sh`** → **`S8: ACEPTADA`** (**V1…V5**), re-ejecutado por el LEAD el 2026-08-28 sobre los ocho commits de la slice (`abbb9c2` `9a8e7fa` `ab3af3a` `597479d` `39df273` `fe6f0ff` `69a43f7` `7d07763`, **ninguno pusheado**). Árbol de la misma corrida, `pnpm -r test`: domain **201** · media **164** · ai **472** · db **390** · `apps/web` **777** (+4 skipped) · `tests/` **391**. **`pnpm e2e` NO se corrió** —requiere `next build`— y no se escribe como verde: `TEST_MATRIX.md` **E5 sigue 🔴**. · **El parte de la probe, que es lo que V5 compara campo por campo contra literales escritos en el shell (ADR-023):** `lead_anonimo_entra=1 · lead_sin_claim_no_entra=0 · lead_a_tenant_ajeno=0 · offer_usd_desde_anon=0 · returning_desde_anon=0 · checks_del_motor=1 · accept_crea_unidad_en_draft=1 · accept_dos_veces_una_unidad=1 · costo_en_el_payload_del_seller=0 · canario_rol_anon=1 (20 transacciones)`. · **Qué afirma el gate:** **V1** el `GRANT` de `anon` sobre `tradein_leads` son **nueve** columnas exactas, por **igualdad y no por inclusión** —un `grep -q offer_usd` daría verde con el costo adentro— y leído del `.sql` commiteado, no de la base (la trampa del `created_at` de `CLAUDE.md` §3) · **V2** ni un `GRANT SELECT` ni una policy de SELECT `TO anon` sobre esa tabla, censando el árbol **entero** de migraciones · **V3** `offer_usd` / `offerUsd` no aparecen en el borde público · **V4** typecheck/lint/test · **V5** el parte, con **ausencia de la línea = FAIL, nunca PASS**. · **Dos cosas del parte que son doctrina y no números, y van primero porque el resto cuelga de ellas:** (1) **`canario_rol_anon` es el campo que hay que mirar antes que ninguno.** `SET LOCAL` fuera de un bloque de transacción es un **no-op que sólo emite un WARNING**: el rol nunca cambia, todo corre como superusuario, y el superusuario bypassea **RLS y `GRANT` a la vez**. Sin el canario, dos de los nueve casos **siguen pasando** con el `set local role` sacado —los `CHECK` aplican también al superusuario—, o sea que el gate daría verde midiendo nada. Es un error que el LEAD cometió midiendo a mano en esta misma slice, y por eso el campo existe. (2) **Un caso que no corrió reporta `-1`, no `0`.** `lead_a_tenant_ajeno=0` es un PASS y *"sin medir"* es un FAIL; con los dos en `0` no se distinguen, y el gate trata el `-1` como fallo con mensaje propio. · **Auditoría de referencia:** `scripts/probes/s8-canje.test.ts` (**LEAD**), que **no reusa el helper de sesión de `db-agent`** a propósito —ese helper es del writer de los `GRANT` y las policies bajo auditoría—, afirma **el mensaje y no sólo el código** en cada rechazo (`42501` cubre las dos capas, así que un test que sólo mire el código sigue verde el día que alguien abre el `GRANT`, porque la policy rechazaría igual), y fue **falsificada con seis mutaciones** sobre una base desechable: policy borrada, policy aflojada a `with check (true)`, `offer_usd` otorgado, `SELECT` otorgado, un `CHECK` caído, y el cambio de rol sacado. · **Aislamiento cruzado:** `tests/rls-cross-tenant.test.ts` (**`qa-agent`**, `69a43f7`) — **R6c** pasó de afirmar un número a afirmar **cuatro** cosas (las siete policies `TO anon` por nombre, que las cinco superficies de lectura sean todas SELECT, que las dos de escritura-sin-login sean ambas INSERT, y que **no exista nada más**: la cuarta es la que caza un `FOR ALL` colándose entre las dos listas, que las tres primeras habrían contado como cubierto) y **R7c-bis** fija qué columnas sensibles puede **escribir** `anon`: exactamente `customer_name` y `customer_wa_phone`. · **Lo que la slice dejó abierto y no se tapa:** **P5 quedó MEDIDO y sigue abierto** (fila propia, ahora con `tradein_leads` adentro) · cinco huecos de cobertura declarados por `qa-agent` (§S8 abajo), de los cuales **§8 —la PII del visitante sin test de fuga— era el que más importaba y el único sin dueño**: **cerrado el 2026-08-28**, dueño `qa-agent` asignado por el LEAD, 16 casos que prohíben **por forma y no por nombre de columna** (**T43**, `done`) · **T37**…**T42** · y **S8.1**, también `done` el 2026-08-28 con la migración `0009` |
| S9 | copy list para estados de IG/WA | **done** · 2026-09-04 · `bash scripts/accept-s9.sh` → PASS; implementación y pantalla verificadas | `domain-agent` (`packages/domain/**`, el builder) → `app-agent` (`apps/web/app/(app)/**`, la pantalla y la URL absoluta) | **Gate (sin cambios en la vara, más explícito): export con precios y links · cero IMEI · cero costo, margen y notas internas.** El comando lo escribe el LEAD al cerrar; esta celda fija lo que tiene que afirmar. **Y fija cinco decisiones del LEAD que ya están tomadas, porque son justo las que alguien va a querer reabrir:** **(1) El link de cada unidad va a la FICHA, no a `wa.me`.** El embudo de `CLAUDE.md` §1 es *estado → ficha → botón de WhatsApp con el producto ya escrito*. Un `wa.me` pegado en el estado saltea la ficha, o sea saltea el *«llega informado»*, y produce exactamente el WhatsApp sin contexto que el producto vino a eliminar. No es una preferencia de UX: el `wa.me` ya existe **en** la ficha (S4) y ahí lleva el texto canónico byte a byte. **(2) La URL absoluta la arma `apps/web`, no `packages/domain`**, y entra al builder como **un campo más** del input. Motivo escrito y verificable: `apps/web/app/(storefront)/_lib/routes.ts` ya declara que el prefijo `/p` es propio de `apps/web` y **no** del dominio (*«una ruta no es una validación»*, y `LISTING_PATH_PREFIX = '/p'` vive ahí); meterlo en `packages/domain` sería una segunda fuente de verdad de la misma ruta. Ojo con el corolario que ese archivo también deja escrito: los links de la vidriera son **relativos** porque el host ya está en la barra — **acá no pueden serlo**, un estado de IG no tiene host, así que la absoluta se arma en `apps/web` con el host del tenant y esta slice es la excepción **declarada** a esa regla, no un olvido. **(3) El ARS entra YA CALCULADO:** el caller aplica `applyFx` (`packages/domain/src/fx.ts:117`) con el TC y el modo de redondeo del tenant. **El builder no hace FX.** **(4) La prohibición de IMEI / costo / margen / notas internas se implementa COMO TIPOS**, espejando `WaListing` de `packages/domain/src/wa.ts:50`: el input **no tiene** esos campos, así que olvidarse **no compila**. Un filtro en runtime sería la misma regla defendida por la memoria de quien escriba el próximo campo. **(5) Nunca descartar una unidad en silencio** al partir en bloques: **una unidad que sola excede el presupuesto de caracteres va igual, en su propio bloque.** Perder stock sin ruido es el peor fallo posible de esta slice — el dueño no tiene cómo enterarse de que su equipo más caro no salió en la lista. **Nota de higiene que se vuelve visible ahora:** `T48` — el header de `packages/db/drizzle/0009_….sql` se autotitula `S9` y lo que implementa es `S8.1`. La aceptación actual de S9 quedó en `scripts/accept-s9.sh` y fue reejecutada por el LEAD: PASS. Sigue siendo de `db-agent` |
| S10 | import CSV | **done** · commit `55756f3` · **re-ejecutada por el LEAD** | `app-agent` | **`bash scripts/accept-s10.sh`** → `S10: ACEPTADA` · typecheck **0** · lint **16 reglas** · `apps/web` **925 tests** (**110 nuevos**) · `guard-artifacts` **14** · `guard-gates` · `guard-routes` (**33 rutas**) · `guard-firewall` · `guard-leaks` · `guard-effects`. **Medido por la probe contra Postgres:** `lineas_malas=3-4-5-6-7-8-10-11` · `filas_malas_reportadas=8` · `filas_buenas_anunciadas=3` · `unidades_tras_rechazo=0` · `eventos_tras_rechazo=0` · `imei_en_los_mensajes=0` · `unidades_tras_exito=3` · `eventos_tras_exito=3` · `unidades_en_otro_tenant=0` · `unidades_tras_fallo_del_motor=0` · `archivo_con_costo_de_seller_rechazado=1`. **Fronteras conservadas:** la pantalla usa Server Action y no agrega `route.ts` ni una regla WAF; `/app/stock/importar` queda en `guard-routes.sh`; la idempotencia de subir el mismo archivo **no** es parte de esta aceptación y queda en `T57`. **Artefacto:** `apps/web/app/(app)/_lib/csv-import/` + `apps/web/app/(app)/app/(panel)/stock/importar/` + `scripts/accept-s10.sh` + `scripts/probes/s10-import-csv.test.ts` |
| S11 | roles owner/seller | **done** · 2026-09-04 · `E2E_ALLOW_PARTIAL=1 E2E_PORT=3129 pnpm --filter @istock/e2e e2e s11-seller-payload.spec.ts` → **1 passed** | `app-agent` + `qa-agent` · **LEAD** (boundary de permisos y aceptación) | seller ve su stock operativo; el body HTTP de `/app/stock` no lleva costo, margen, IMEI ni notas internas; `/billing` renderiza la frontera `forbidden` sin convertir la sesión en login |
| S12 | onboarding de 15 minutos | **done** · 2026-09-04 · `e2e/s12-onboarding-primer-equipo-publicado.spec.ts` PASS dentro de la suite completa | `app-agent` + `qa-agent` | signup local → negocio → selector de catálogo → tres fotos → publicación → apertura del link exacto de la vidriera; además edita configuración y precio publicado y verifica ambos en el host público; la suite completa quedó en 109/109 tests, 19/19 specs, sin skips |
| S13 | `/demo` | **done** · 2026-09-04 · `E2E_PORT=3125 bash scripts/accept-s13.sh` → PASS; 308 y Location verificados sobre servidor real | `storefront-agent` | tenant demo aislado; cero datos reales. **Diseño ratificado por el LEAD el 2026-08-28 → ADR-027**: `maat.work/demo` y `/demo/**` emiten un **308 permanente** a `demo.<apex>/…` desde `proxy.ts` (`demoAliasRedirect`), **adentro de la rama `marketing` de `resolveHost`** y con el host de destino derivado del **entrante** (`tenantHostFor`, en `app/(storefront)/_lib/host.ts`); los tres motivos por los que se descartó el rewrite los preserva el ADR. **Aceptación reejecutada por el LEAD:** `E2E_PORT=3125 bash scripts/accept-s13.sh` → PASS; el `308` y su `Location` se midieron sobre HTTP y `demo.test.ts` quedó en 18/18. `bash scripts/guard-routes.sh` también pasó sobre el build actual. **`B6` sigue abierto y muerde por otro lado**: sin `SEED_DEMO_WA_PHONE` el seed cae en `SEED_DEMO_WA_PHONE_FALLBACK`, así que el `wa.me` del demo lleva un teléfono placeholder — no bloquea el `308`, sí bloquea *«demo mostrable a un prospecto»* |

> **Revalidación del LEAD · 2026-09-04:** la corrida completa posterior a los últimos cambios fue `E2E_PORT=3145 pnpm e2e` → **109/109 tests, 19/19 specs, 0 skips**. Esto actualiza los conteos históricos de S4, S8 y S12 que todavía mencionan corridas anteriores. En particular, S4.1 queda afirmada por el caso browser de reserva con copy exacto, S8/E5 por el recorrido browser completo del canje y T17 por la preferencia de reserva guardada en Ajustes; las notas históricas debajo no deben leerse como blockers vigentes.

**Cada slice suma al gate:** `adversary-reviewer PASS` + `cost-auditor PASS` ("no agrega costo tonto").

> ### Barrido serial de los cinco gates · 2026-08-28 · HEAD `68c0bd6`
>
> Lo corrió el LEAD **en serie y sobre el árbol ya commiteado** (no sobre un working tree), con los
> **21 chequeos en verde**. Estos son los números que mandan en la tabla de arriba:
>
> ```
> accept-s1  PASS=39 FAIL=0
> accept-s2  PASS=21 FAIL=0
> accept-s3  PASS=59 FAIL=0
> accept-s4  PASS=38 FAIL=0
> accept-s6  PASS=22 FAIL=0
> ```
>
> **Serial y no en paralelo, y eso no es prolijidad:** `accept-s3` y `accept-s6` levantan su propio
> `next start` en `E2E_PORT` (3100 por default) y abortan con la causa nombrada si el puerto está
> ocupado, en vez de prestarse un server ajeno sin el espía de Postgres — que es exactamente cómo
> una medición ausente se disfraza de éxito (`e2e/playwright.config.ts`, `reuseExistingServer: false`).
>
> **Tres de los cinco números se movieron, y ninguno por código de producto nuevo.** La atribución,
> hasta donde `git log` la sostiene y sin redondear lo que no:
>
> | gate | antes → ahora | de dónde sale el delta |
> |---|---|---|
> | `accept-s1` | 26 → **39** | **ADR-020.** `f691daf` tocó `accept-s1.sh`: A2 dejó de evaporarse (`chk`/`have` sin importar) y se reescribió sobre el invariante. El salto es *aserciones que antes no corrían*, no cobertura nueva |
> | `accept-s3` | 58 → **59** | una aserción más. `accept-s3.sh` cambió **dos veces** después de la corrida de 58 (`7e40856`, de S4.1, y `f691daf`, de ADR-020): **el `+1` no se puede atribuir a una de las dos leyendo el board**, y no se le adjudica a ninguna |
> | `accept-s4` | 37 → **38** | **no es de ADR-020.** `accept-s4.sh` no se toca desde `7e40856` —el commit de **S4.1** que hizo que W5 mire el mensaje de WhatsApp entero en vez de substrings—, o sea que el `+1` es de ahí |
> | `accept-s6` | — → **22** | primer conteo registrado para S6. Incluye la **V9** nueva |
>
> La lectura correcta de un contador que sube sin código de producto nuevo es *"antes no se estaba
> midiendo esto"*, no *"ahora hay más cobertura"*.
>
> **Y la medición que S6 no tenía hasta ese día**, emitida por el spec de `qa-agent` y consumida por
> V9 de `accept-s6.sh`:
>
> ```
> MEDIDO s6 radio · publicadas=4 · paginas=5 · rerender=2 · esperado=2
>               · sobrevivieron=[ficha-a,ficha-c,ficha-d] · frio=14
> ```
>
> `frio=14` son las sentencias que el espía vio contra Postgres: es el control que impide que un
> radio de cero **sobre nada** se lea como éxito. `paginas=5` es el que impide afirmar un radio con
> una sola ficha hermana. Los dos son parte de V9, y sin ellos `rerender=2` no significaría nada.
>
> **Los conteos viejos que aparecen más abajo en este board —`26 PASS` de S1, `58 PASS` de S3,
> `37 PASS` de S4— no son errores y no se corrigen:** son el registro de corridas anteriores,
> fechadas y atribuidas, y varias sostienen afirmaciones sobre *esa* corrida (que S3.3 no encareció
> el camino feliz, que W5 de S4 imprimió el defecto y lo dejó pasar). **El número vigente de una
> slice es el de este bloque y el de la tabla de arriba; el resto es historia y se lee como tal.**


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
>   *(Ese censo es **de aquella corrida**. Creció después con los dos specs de S6; el número vigente
>   lo lleva `TEST_MATRIX.md` §e2e, no esta cita.)*
>
> **La deuda de ADR-011 sigue viva, y el gate la imprime en vez de esconderla.** El miss contesta
> `200/200`, no `404`: **deja de ser distinguible por status code en los logs de acceso.** No se
> mitiga —se aceptó a cambio de que la persona que se equivocó de subdominio lea algo en vez de una
> página en blanco— y lo que reemplaza al status como invariante chequeable son A3/A4 de
> `accept-s1.sh` (`<h1` literal, `noindex`, título propio, cero markup de vidriera, req2 en `HIT`).
> Dónde vuelve a morder está fechado: en **FASE 8** la observabilidad no puede depender del status,
> el mismo corolario que dejó la corrección medida de ADR-014 para el panel.
>
> **Aceptar la slice no cierra sus deudas.** Siguen abiertas, con dueño y sin tocar: **T2** (guard de
> query sin filtro de tenant), **S2.1** (`blocked` hasta la probe real de R2), **S2.2**, **S2.3** y
> **S2.4**.
> **T1** cerró su **nivel 1** el 2026-08-28 (`4fce968`) — declarada y validada, **no aplicada**.
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


> **S4 ACEPTADA — 2026-08-28. El LEAD re-ejecutó `./scripts/accept-s4.sh` entero y sin fixture:
> 37 PASS · 0 FAIL**, con la suite e2e corrida de verdad (**73 passed**, eran 70) y
> `pnpm typecheck && pnpm lint && pnpm test` en **1004 passed / 0 failed**
> (domain 160 · media 107 · db 283 · web 239 · tests 215).
>
> ```
> MEDIDO s4 click · filas_al_cargar=0 · filas_antes=0 · filas_despues=1 · tenant_ok=si · listing_ok=si
> MEDIDO s4 cruce · slug_atacante=… · listing_de=… · filas_creadas=0
> MEDIDO s4 sinjs · anchors=1 · abre_whatsapp=si
> ```
>
> **Las tres líneas contestan tres preguntas distintas y ninguna es redundante.** `filas_al_cargar=0`
> y `filas_antes=0` dicen que el beacon dispara en el **click** y no en el **view**: si contara
> pageviews, la tabla dejaría de medir intención de compra (las vistas ya las cuenta PostHog) y el
> renglón fijo del WAF se volvería proporcional al tráfico. `filas_creadas=0` es el cruce: un POST
> desde la vidriera de un negocio nombrando el equipo de otro no escribe nada. `anchors=1 ·
> abre_whatsapp=si` está medido con `javaScriptEnabled: false`: **la telemetría nunca se pone
> adelante de la venta.**
>
> **Dos desvíos deliberados de la spec original, los dos de `storefront-agent`, los dos correctos.**
> Se registran acá porque son notas de diseño, no rodeos:
>
> 1. **El componente cliente separado era imposible.** La regla **W001** de
>    `apps/web/scripts/web-lint.mjs` prohíbe `"use client"` en todo `(storefront)` salvo el error
>    boundary, y `web-lint.mjs` es del LEAD: no es un archivo que esa columna pueda tocar para
>    hacerse lugar. Quedó un `<script>` inline de **412 B** emitido desde un Server Component —
>    **0 KB de bundle**, y el listener engancha **al parsear**, no al hidratar. Ese último renglón es
>    el que decide el caso de uso real: alguien parado en la calle que abre el link de un estado y
>    aprieta enseguida. Un listener que depende de la hidratación pierde exactamente los clicks más
>    impacientes, que son los más calientes.
> 2. **El insert es `insert … select from listings`, no `insert … values`.** Con `values` más
>    subselect, el uuid de otro tenant **resuelve a `NULL`** y la fila se escribe igual por la rama
>    `listing_id is null` del `WITH CHECK`: le grabaría al dueño una conversación que nadie tuvo. Con
>    `select`, si la ficha no es de este tenant **no hay fila** — cero filas, sin error y sin dato
>    inventado. Y como el `select … from listings` corre **como `anon`**, pasa además por
>    `listings_storefront_anon_select`: una unidad en `draft` o un tenant `suspended` tampoco sirven
>    de destino.
>
> **Lo que S4 dejó abierto: S4.1**, el mensaje repite storage y color cuando el listing no tiene
> `catalog_model`. Es **preexistente de S3** y S4 no lo introdujo: lo hizo **visible** al imprimir el
> `href` medido en W5. Fila propia abajo.

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
> que no filtraban); con la corrida de `accept-s3.sh` del LEAD, **S3.1**, **S3.2**, **T8** y
> **S3.3**; **T3** (el test de RLS cruzado ya vive en `tests/`, 69 casos verdes desde la ubicación
> nueva); y **T1 en su nivel 1** —las reglas del WAF existen, están versionadas y tienen censo de
> rutas, pero **no están aplicadas**: leer la fila entera, no el `done`.
> **Sigue abierta T15**, que salió de medir el mensaje de WhatsApp. **S2.1**, **S2.2**, **S2.3** y
> **S2.4** siguen abiertas después de aceptar S1, S2 y S3: **aceptar la slice no cierra sus deudas.**
> **T2 cerró el 2026-08-28** (`9b3d7d2`, `W015` en `main`) **y al cerrarse abrió T16**: su alcance
> medido es `apps/web` y `packages/**` sigue sin gate. Cerrar una fila sin nombrar lo que su alcance
> deja afuera es cómo un gate angosto se lee después como cobertura completa.
> **S4.1 cerró el 2026-08-28** con la barrida completa del LEAD anterior a `cbbfa2f`. Había salido de
> la misma clase de corrida: apareció porque `accept-s4.sh` **imprime el `href` entero** en vez de
> aseverar sobre él. El defecto era preexistente de S3; lo que cambió es que se volvió visible, y
> después asertable.
> **Entradas nuevas del 2026-08-28, las dos al cerrar S6:** **S6.1** —la regla de en qué queda una
> reserva cerrada estaba en `apps/web` y es de la máquina de estados, no de la capa de aplicación— y
> la **deuda de proceso de S5**, que está `done` sin comando de aceptación propio y sin que ningún
> gate la nombre. La segunda no es una fila con owner de paquete: es del **LEAD**, porque los gates
> son suyos por §4. Las dos tienen su sección abajo.
>
> **Segunda tanda del 2026-08-28, y no salió de leer código: salió de auditar costo.** **S6.1 cerró**
> (`83bc673`, **ADR-019**) y **S6.2** nació y cerró el mismo día (`f504d69`): la función que dice
> `Unit` en el nombre purgaba la vidriera entera, la encontró `cost-auditor` mirando el cold-hit rate
> —**~39% contra una alarma de 5%**— y **ningún test la había visto**, porque el defecto no estaba en
> lo que la función hacía mal sino en el **radio** de lo que hacía bien. Junto con ella quedan
> abiertas **T18** (el tercer call site que ADR-019 no alcanzó — **cerrada el 2026-08-28**) y **T19**
> (`packages/ai`, que **hasta el 2026-08-28 no estaba creado** y era el hueco de cobertura más
> grande del repo; hoy el paquete está en `main` y lo que falta es el censo de cobertura y la
> aceptación). **T14 pasó de dos
> prohibiciones sin gate a tres, y esa misma tarde volvió a dos**: `W016` cerró **T14.1** (rate
> limiting con contador en Postgres sobre la vidriera), que era la **última de las 14 prohibiciones
> de §2 sin gate ejecutable**. La fila del gate es **T26**.
>
> **Tercera tanda del 2026-08-28 — la familia del barrido de reservas, y el veredicto lo ejecutó el
> LEAD, no un reporte de agente.** **T21, T22, T23 y T25 cerraron** con la re-ejecución de
> `accept-s6.sh` (V10 + V10b); **T29 cerró** con la del propio `accept-fase3.sh` (`54 PASS · 0 FAIL`),
> que era la corrida que a esa fila le faltaba y que este board había marcado como hueco.
> **T23 cerró acotada**: la mitad del `logEvent` se mudó a **T31**, nueva, `doing`, porque el
> propósito que T23 le daba —dejar de pagar 8.640 líneas por mes— **ya lo cumplió el techo de T22**,
> y lo que falta es otra cosa que se pierde si no se la nombra distinto: los **ids** de las filas
> abandonadas. **T24 y T31 también cerraron** —esta línea decía *"T24 sigue `doing`"* y *"T31, nueva,
> `doing`"*, y quedó vieja el mismo día: las dos están en `4a9a8de` (T31 suma `dd871ce`) y las cerró
> `accept-s6.sh` corrido por el LEAD. **T28 y T30 están commiteadas** en
> `4d33be6` —esta tabla decía "sin commitear" para T27 y T28 y quedó vieja mientras se escribía—, y
> **T30 cerró con la corrida del LEAD** (`guard-gates.sh` → exit 0, `GUARD-GATES: PASS`),
> y trae la evidencia que ningún fixture da: **G4 encendió sobre un gate real el día que el archivo
> nació y antes de estar trackeado**, que es el momento exacto en que T30 dice que tiene que encender.
> Las cuatro instancias históricas se descubrieron meses después y mirando. **La corrección de la spec de T25 es `DECISIONS.md` ADR-024.**
>
> **Cuarta tanda del 2026-08-28: `T32`, el estado de un doc.** Cierra la trilogía que empezaron T28 y
> T30 — allá se censan el **dueño** y la **corrida** de un gate, acá el **estado** de un doc: toda
> fila de tabla de `docs/**` tiene las columnas que declara su cabecera, y un `\|` sin escapar deja
> de correr las celdas en silencio. `scripts/guard-doc-tables.sh` + `.test.sh` están en `d3deb86` y en
> `ci.yml` (`:181`, `:185`), y por eso `guard-gates.sh` censa **23** gates y no 21. La cerró la
> corrida del LEAD (`GUARD-DOC-TABLES: PASS · 1157 filas · 165 tablas · 21 archivos`), no la de
> `docs-keeper`, que dio lo mismo. **Lo que deja de aprendizaje no es el gate, es su primera corrida:**
> encendió sobre **T28** y ahí no había ninguna fila rota — el hallazgo era el bug del propio gate,
> que blanqueaba code spans. **Un gate recién nacido que enciende no es evidencia de un defecto hasta
> que el defecto se reproduce sin el gate.**

| id | título | estado | owner | bloqueo | gate de aceptación | artefacto |
|---|---|---|---|---|---|---|
| S2.1 | upload directo a R2 por URL prefirmada | **blocked** | `media-agent` → `app-agent` | **probe real de byte por el pipeline de la app pendiente**; T13 CDN no cierra esta fila | 8 fotos sin round-trip por foto; el original **nunca** es alcanzable; `card` sigue ≤150KB | `packages/media/src/*`, `apps/web/app/api/**` |
| P1 | `robots.txt` / `sitemap.xml` por tenant — **decisión de diseño** | **done** | `storefront-agent` + `qa-agent` | — | decisión escrita **antes** de arrancar S3 → **ADR-015**, verificada por el LEAD (30 URLs contra el `path-to-regexp` compilado) | `docs/DECISIONS.md` ADR-015 · `apps/web/proxy.ts` (`117c4f0`) |
| P2 | metadata file conventions bajo host de tenant — **decisión de diseño** | **done** | `storefront-agent` + `qa-agent` | — | ídem P1: misma causa raíz, misma ADR, mismo commit | ADR-015 · `apps/web/proxy.ts` · `tests/proxy-matcher-no-deja-la-vidriera-sin-vigilar.test.ts` |
| T1 | rate limiting en el edge: las 2 reglas de Vercel Firewall | **done** — nivel 1 | **LEAD** (`config/**` + `scripts/**`, §4) | — | **el gate original decía "2 reglas activas + prueba de que disparan" y eso NO se cumple entero**: las reglas están declaradas y validadas, y **no están aplicadas** (no hay proyecto Vercel — **B2**/**B5** —, y aplicar es un paso operativo aparte que `vercel deploy` **no** hace). Cerrado el **nivel 1**: el archivo existe, pasa las restricciones reales de Pro, **el censo de route handlers no deja entrar una ruta sin decidir**, y desde `3199a78` **el gate y su polaridad tienen step en CI** (`ci.yml:118` y `:126`) — *step declarado*, no ejecutado: `ci.yml` nunca corrió, ver §"Seis gates rojos o dormidos". `bash scripts/guard-firewall.sh` → `GUARD-FIREWALL: PASS` (re-corrido el 2026-08-28). **Cero** contador en Postgres sobre la vidriera. Con S4 (`c9611b1`) `storefront-track-rl` pasó de `planned` a **`active`**: el endpoint no nace sin techo. Ver §T1 abajo | `config/firewall-rules.json` + `scripts/guard-firewall.sh` + `scripts/guard-firewall.test.sh` (`4fce968`, `3199a78`) · **ADR-016** |
| T2 | guard estático de "query sin filtro de tenant" | **done** — alcance `apps/web` | **LEAD** (`apps/web/scripts/*-lint.mjs` + `scripts/**`, §4) | — | el guard falla sobre una query sin `tenant_id` **y** pasa con la excepción declarada. **Está en `main` desde `9b3d7d2`**, junto con el párrafo de `CLAUDE.md` §2 que fija el contrato del marcador `web-lint:sin-tenant`; `git log --oneline -S W015 -- apps/web/scripts/web-lint.mjs` devuelve **un** commit, no cero. Verificado el 2026-08-28 por `docs-keeper`: `cd apps/web && node ./scripts/web-lint.mjs` → `ok W015 toda query sobre las 15 tablas de negocio filtra por tenant ademas de RLS (builder y sql crudo)` · `WEB-LINT: PASS (16 reglas)` (**decía `15` y era el número de la mañana del 2026-08-28: entró `W016`, fila `T26`; la línea de W015 no cambió**), con las **2** excepciones declaradas del repo pasando. **El alcance es `apps/web` y nada más**: `packages/**` sigue sin gate → **T16**, abierta. **Residuo CERRADO el 2026-08-28** (`a015437`): la polaridad se había ejercido *"in a sandbox outside the repo"* y hoy es un comando — `scripts/web-lint.test.sh`, step propio en `ci.yml:156`, `POLARIDAD WEB-LINT: OK — las 16 reglas se vieron encender`, con **12 casos de W015**. Ver §T2 | `apps/web/scripts/web-lint.mjs` (W015, `9b3d7d2`) |
| T3 | mudar el test de RLS cruzado a `tests/` | **done** | `qa-agent` | — | los casos corren desde `tests/` contra Postgres real, verdes, sin perder ninguno; `packages/db/src/rls-cross-tenant.test.ts` deja de existir; **y en la misma mudanza se borra el encabezado que se declara `db-agent`**, derogado por la regla de desempate de `CLAUDE.md` §4. **Re-ejecutado por el LEAD desde la ubicación nueva: `rls-cross-tenant.test.ts (69 tests)` verdes** — no 59: ese número contaba `it()` literales y se comía el `it.each` sobre 10 columnas sensibles (`:625-630`). Total del repo: **919** | `tests/rls-cross-tenant.test.ts` + `tests/vitest.config.ts` (`d686923`) |
| T4 | extraer los helpers de los gates a `scripts/_lib.sh` | **done** | **LEAD** | — | un solo juego de helpers en el repo; los gates que lo importan re-corridos con el mismo veredicto **y** el helper probado en las dos polaridades, en CI | `scripts/_lib.sh` + `scripts/_lib.test.sh` (`dc1d854`) |
| S2.2 | `collectOrphanObjects` existe y no lo llama nadie | todo | `media-agent` (función) + `app-agent` (comentarios) | — | se elige **(a)** o **(b)** por escrito: si (a), el job corre y borra un huérfano sembrado; si (b), **ningún** comentario del repo la nombra en presente | `packages/media/src/unlink.ts`, `apps/web/app/(app)/_lib/listings/*.ts` |
| S2.3 | el `<input type="file">` conserva la foto después de subirla | todo | `app-agent` | — | tras un alta exitosa el input queda vacío; `PhotoActionState` distingue inicial de éxito | `apps/web/app/(app)/app/(panel)/stock/[id]/fotos/*` |
| P3 | el gate de S3 mide el byte que el browser **pide**, no el que el pipeline generó | **done** | **LEAD** escribió el gate · `storefront-agent` implementó S3 | — | el gate existe, **nació en rojo a propósito** y el 2026-08-28 pasó a verde midiendo el byte que el browser eligió (`51016B`) — ver abajo | `scripts/accept-s3.sh` (`1406c6f`, `d9d7719`, `20fb7ac`) |
| S2.4 | el docblock de `page.tsx:69-72` afirma un 404 que la medición desmiente | todo | `app-agent` | — | el comentario describe el comportamiento **medido** (ADR-014, "Corrección medida"); alcance = el comentario, no la ruta | `apps/web/app/(app)/app/(panel)/stock/[id]/fotos/page.tsx` |
| T7 | `readMatchers()` trunca el matcher en el primer `]` | todo | `qa-agent` | — | **nada roto hoy** — trampa conocida, ver abajo | `tests/proxy-matcher-no-deja-la-vidriera-sin-vigilar.test.ts:144` |
| S3.1 | un tenant real nace sin `fx_settings` y sin `locations` | **done** | `app-agent` | — | **severidad alta** — alta o onboarding siembran un `fx_settings` y ≥ 1 punto de retiro; un tenant nuevo que carga 3 equipos ve grilla con precio y retiro, no vacía. **Cerrada por la corrida de `accept-s3.sh` del LEAD (2026-08-28, 50 PASS/0 FAIL):** M3 exige el punto de retiro, el horario y el ARS con la forma de `formatArs`, y los tres salen de las filas sembradas | `apps/web/app/(app)/_lib/tenants/create-tenant.ts` (`eaccfee`) |
| S3.2 | publicar un equipo purga el catálogo entero del tenant | **done** | `app-agent` | — | al mutar una unidad se emite además `updateTag(listingTag(id))`; los dos tags de tenant dejan de ser la única invalidación. **Cerrada por la misma corrida:** `MEDIDO s3 db-hits · primera=9 · cacheada=0` | `apps/web/app/(app)/_lib/tenants/storefront-cache.ts` (`eaccfee`) |
| S3.3 | bajo un **tenant** inexistente la ficha dice que el equipo se vendió | **done** | `storefront-agent` | — | una ficha bajo un slug de tenant que no existe contesta el *tenant-miss* (`STOREFRONT_MISS_TITLE`, "No hay ninguna vidriera en esta dirección"), no el *listing-miss* ("Este equipo ya no está publicado"); el `null` del tenant se sigue cacheando con `STOREFRONT_MISS_LIFE`. **Verificado por el LEAD contra server real** (`next build` + `next start`, leyendo el HTML servido y no el fuente) y `accept-s3.sh` re-ejecutado: **58 PASS · 0 FAIL · S3 ACEPTADA**, con `MEDIDO s3 db-hits · primera=9 · cacheada=0` — el mismo número de antes del fix, o sea que **el camino feliz no se encareció**. Tabla de los 4 casos en §S3.3 abajo | `apps/web/app/(storefront)/s/[slug]/p/[listing]/page.tsx` + `apps/web/app/(storefront)/ficha.test.ts` (15 → 24 tests) (`042e24e`) |
| S4.1 | el mensaje de WhatsApp repite storage y color cuando el listing no tiene `catalog_model` | **done** | `domain-agent` + `storefront-agent` | — | el `href` medido sobre la **ficha servida** de un listing **sin `catalog_model`** dice el string canónico de `CLAUDE.md` §1 **byte a byte** —no por substrings—, y el fix decide **qué significa `modelDisplayName` cuando no hay catálogo** en vez de parchear el `??`. **Gate primero, en rojo, `7e40856`** (M3b de `accept-s3.sh` + W5 de `accept-s4.sh`: *ningún token repetido en el equipo nombrado*); **fix en `07c42ff`**: `nameSource` es requerido en `WaListing` y `PublicListingSource`, `resolveModelName` es el único constructor, `isBlank` trata `''` como ausente. **Cerrada por la barrida completa del LEAD del 2026-08-28**, la que precede a `cbbfa2f`: `accept-s1..s4` + `accept-s6`, `accept-fase2`, `accept-fase3` y la suite e2e entera (80 tests, 0 skip), **todo verde** — o sea que los dos comandos que cierran la fila corrieron **después** de `07c42ff` y con la aserción de `7e40856` adentro. **Sin conteo de PASS registrado para esa corrida**, a diferencia del resto del board: lo que consta es el veredicto. Ver §S4.1 abajo | `apps/web/app/(storefront)/_lib/model-name.ts:54` (`resolveModelName`) · `packages/domain/src/wa.ts:51` (`nameSource`) · `packages/domain/src/text.ts:22` (`isBlank`) (`07c42ff`) |
| S6.1 | la regla de en qué queda una reserva cerrada vive en `apps/web`, no en el dominio | **done** | `domain-agent` → `app-agent` | — | commiteada en `83bc673`. `grep -rn 'closingStatusFor' apps/web/app` → **cero**; la regla vive en `packages/domain/src/listing-status.ts` como función privada, y la única puerta es `transitionEffects()`. El campo dejó de ser booleano: `closesReservation: boolean` → **`closesReservationAs: ReservationClosingStatus \| null`**, y `transitionEffects()` toma un tercer parámetro **obligatorio** `intent: TransitionIntent \| null`. **El alcance creció de dos valores a tres** y el motivo es el defecto que la abrió: el panel escribía `cancelled` y el cron `expired` **sobre la misma arista** `reserved → available`. Escrito como **ADR-019**. Re-ejecutado por el LEAD: typecheck 0 · lint 0 (**15 reglas al momento de esa corrida; hoy son 16, entró `W016` — ver T26**) · test 0 · `guard-effects` OK (era RECHAZADO) · `guard-leaks` OK. **Deja abierta T18** | `packages/domain/src/listing-status.ts:216,246` · `packages/domain/src/reservation.ts:40` · `apps/web/app/(app)/_lib/listings/publish-listing.ts:321` · `apps/web/app/(app)/_lib/reservations/expire-reservations.ts:194` (`83bc673`) |
| S6.2 | `invalidateStorefrontUnit()` purgaba la vidriera entera | **done** | `app-agent` + `storefront-agent` | — | reservar **una** unidad en un tenant de 60 equipos purgaba las **61** páginas: un tag es un OR y la ficha registraba los dos tags de tenant. Lo encontró `cost-auditor` auditando S6 (`e3f3703`); el cold-hit rate se iba a **~39%** contra una alarma de 5%. Cerrada en `f504d69`, y el arreglo **cruza tres columnas en un solo commit** porque por mitades deja el producto peor. **Medición del LEAD:** `MEDIDO s6 radio · publicadas=4 · paginas=5 · rerender=2 · esperado=2 · sobrevivieron=[ficha-a,ficha-c,ficha-d]` y `MEDIDO s6 alta-de-unidad · miss_cacheado=HIT · visita_que_la_muestra=1`; **antes del arreglo, en un clone desechable a `ea26a02`: `rerender=5` de 5, cero sobrevivientes.** Tres cosas contraintuitivas que hay que leer en §S6.2 antes de tocar un tag. **El residuo —ningún `accept-*` nombraba el spec que la mide— se cerró el 2026-08-28**: `accept-s6.sh` corre `SPEC_RADIO` y su **V9** lee el número de la corrida (`frio=14` es el control que impide que un radio de cero sobre nada pase por éxito). **ADR-020** | `apps/web/app/(app)/_lib/tenants/storefront-cache.ts` · `apps/web/app/(storefront)/_lib/listings.ts:460,502,526` · `apps/web/app/(storefront)/s/[slug]/p/[listing]/page.tsx:158,174,182,230,241,253` · `e2e/s6-senar-un-equipo-no-purga-la-vidriera-entera.spec.ts` · `tests/el-veredicto-del-radio-…test.ts` (`f504d69`) |
| S2.5 | el guard de IMEI de `packages/media` rechazaba keys legítimas | **done** · 2026-09-04 | `media-agent` | — | `assertPublicVariantKey()` acepta la forma canónica `v1/{ab}/{hash}.webp` aunque el hash contenga 15 dígitos seguidos, y vuelve a escanear la key completa si sale de esa forma. `packages/media/src/keys.test.ts` censa 200.000 hashes reales y exige cero rechazos; `url.ts` degrada una key no renderizable sin colgar el render. `pnpm --filter @istock/media test` → **166 passed** | `packages/media/src/keys.ts` · `packages/media/src/keys.test.ts` · `packages/media/src/url.ts` · `packages/media/src/url.test.ts` |
| T8 | los dos specs que miden S3 no emiten ninguna medición | **done** | `qa-agent` | — | las dos líneas `MEDIDO` exactas (ver abajo); **la de imagen se mide sobre la grilla**, no sobre la ficha. **Emitidas y verificadas por el LEAD el 2026-08-28** (`transferSize=51016B` / `primera=9 · cacheada=0`) | `e2e/s3-la-grilla-en-un-telefono-no-baja-la-foto-grande.spec.ts`, `e2e/s3-la-ficha-cacheada-no-le-pega-a-postgres.spec.ts` (`09c9bc3`) |
| T9 | forma de `listings.slug` en `domain` + en el motor | **done** | `domain-agent` + `db-agent` | resto en vuelo con `storefront-agent` | ver abajo | `packages/domain/src/slug.ts`, `packages/db/drizzle/0003_listing_slug_format.sql` |
| T10 | ocho comandos de aceptación corrían la suite entera creyendo filtrar | **done** | **LEAD** (`.claude/**`, §4) | — | el comando de cada contrato **filtra de verdad**, verificado en las dos polaridades (filtra, y falla con exit 1 ante un patrón que no matchea) | 4 `.claude/agents/*.md` + 4 `.claude/skills/*/SKILL.md` + `scripts/accept-fase3.sh` (`0d647c6`) |
| T11 | las reglas de R2 de `CLAUDE.md` §2 no tenían gate | **done** | **LEAD** | — | `scripts/guard-r2.sh` (`985c369`) — ver la nota de método, regla R5 | `scripts/guard-r2.sh` |
| T5 | concurrencia real del techo de 8 fotos, contra Postgres real | todo | `qa-agent` | comparte harness con **T3** | 7 fotos + dos `addUnitPhoto` en paralelo → exactamente 8 fotos y un `ok:false` de techo | `tests/` |
| T6 | `SELECT … FOR UPDATE` bajo RLS: verificación pendiente, no bug | todo | `qa-agent` | corre con **T5** | el `for('update')` devuelve la fila con rol `authenticated` y el claim del tenant, sin `42501` | `tests/` |
| T12 | editar la configuración visible y los puntos de retiro después del alta | **done** · 2026-09-04 | `app-agent` | — | `/app/ajustes` permite al dueño cambiar nombre, WhatsApp, medios de pago, canje y retiro sin recrear el negocio. `updateTenantSettings()` filtra por `tenant_id` en tenant y location y llama `invalidateStorefront(slug)` después del commit. S12 lo prueba desde el formulario hasta el subdominio público. El TC manual no forma parte del editor: la cotización se sincroniza automáticamente desde BCRA y el redondeo queda en el dominio | `apps/web/app/(app)/app/(panel)/ajustes/` · `apps/web/app/(app)/_lib/tenants/update-settings.ts` · `e2e/s12-onboarding-primer-equipo-publicado.spec.ts` |
| T17 | la reserva **configurable por tenant** estaba prometida y no existía | **done** · 2026-09-04 | `app-agent` + `db-agent` | — | El dueño elige 30 min, 1 h, 1 h 30 min o 2 h desde `/app/ajustes`. La preferencia queda en `tenants.reservation_minutes`, con default 60 y `CHECK` de presets; `/app/stock` la usa en cada selector y la Server Action la aplica si el campo llega vacío. La duración puntual sigue validando 30–120 min y no se clampea. S12 lo comprueba después de guardar, al volver al stock | `packages/db/drizzle/0023_unknown_loners.sql` · `apps/web/app/(app)/app/(panel)/ajustes/` · `apps/web/app/(app)/app/(panel)/stock/` · `e2e/s12-onboarding-primer-equipo-publicado.spec.ts` |
| T18 | `cancelReservation()` derivaba el estado de cierre a mano | **done** · 2026-08-28 · **re-ejecutada por el LEAD** | `app-agent` | — | **`bash scripts/accept-s6.sh`** — el mismo comando que ya cubre la familia. **Re-ejecutado por el LEAD el 2026-08-28: `S6: ACEPTADA`, exit 0, V1…V10 todas PASS**, con estas dos líneas medidas: `MEDIDO s6 reserva · estado_tras_reservar=reserved · vidriera_dice="Reservado" · tras_expirar=available` y `MEDIDO s6 radio · publicadas=4 · paginas=5 · rerender=2 · esperado=2 · sobrevivieron=[ficha-a,ficha-c,ficha-d]`. **Sin conteo de PASS registrado para esa corrida** —consta el veredicto y el detalle por sección, no el número—: el último conteo citable de `accept-s6` sigue siendo el `PASS=22` del barrido serial sobre `68c0bd6`, que es **anterior a la V10**. *Lo que la fila afirmaba antes de la corrida, y se sostiene:* la abrió el LEAD en el propio commit de S6.1 (`83bc673`, último párrafo) — `reserve-unit.ts` escribía `status: 'cancelled'` hardcodeado teniendo el `intent: 'cancel'` ya armado, y el barrido del cron escribía la arista a mano teniendo `decision.listingTransition` en la mano; **era el tercer call site de la familia que ADR-019 vino a cerrar** y acertaba por casualidad, porque cancelar a mano **sí** es `cancelled`. Hoy los tres toman el estado de `transitionEffects(...).closesReservationAs`: `reserve-unit.ts:281` (`398fff7`), `expire-reservations.ts:280` (`b9a8e05`) y `publish-listing.ts:321-325`. **Censado contra `main` por `docs-keeper` el 2026-08-28** (`git grep "status: 'cancelled'\|status: 'expired'" HEAD -- apps/web packages`, sin tests): **cero** literales en la familia de reservas — los dos hits que quedan son otra cosa (`(billing)/_lib/subscriptions/status.ts:65` es un estado de **suscripción**, `packages/domain/src/reservation.ts:127` es la tabla del dominio, o sea la fuente) | `apps/web/app/(app)/_lib/reservations/reserve-unit.ts:281` · `apps/web/app/(app)/_lib/reservations/expire-reservations.ts:280` · `apps/web/app/(app)/_lib/listings/publish-listing.ts:321-325` |
| T19 | el lado chatbot del test matrix no tenía código ni test | **todo** · 2026-08-28 · **era `doing` y lo cambió la regla, no el trabajo.** `CLAUDE.md` §0 regla 1, segunda precisión (commit **`1414302`**): *`doing` marca **un writer**, no una pregunta abierta — una fila cuyo trabajo es auditar, censar o decidir, sin nadie editando archivos, va a `todo` o `blocked`*. **El trabajo pendiente de esta fila es TOMAR EL CENSO de E7/E8/E9/S7, que es auditar: nadie edita un archivo por `T19`.** *(Y el `doing` era caro justamente por eso: al escribir esto `ai-agent` **sí** tiene `packages/ai/src/chat.ts` modificado en el árbol de trabajo por otro encargo, así que el `doing` de `T19` no marcaba a ese writer — le reservaba el directorio a nadie mientras el writer real trabajaba sin fila.)* **No se abandonó nada:** el censo sigue sin tomar y la fila sigue abierta; lo que cambia es que el conteo de `doing` sobre `packages/ai` vuelve a medir lo que dice medir — **cero** | `ai-agent` (**FASE 5**) | **B4** | **Corregido el 2026-08-28: `packages/ai` EXISTE y esta fila decía lo contrario.** El texto viejo era *"`ls packages/` devuelve `db domain media` y nada más"*; hoy devuelve **`ai db domain media`** y el paquete está en `main` desde **`d42fac9`**, con 47 archivos y **19 `*.test.ts`** (`git ls-tree -r --name-only HEAD packages/ai/`). **Lo que este board NO afirma es la cobertura**: E7, E8, E9 y S7 de `TEST_MATRIX.md` quedan **pendientes de censo**, no verdes — cuando esto se escribió `ai-agent` estaba editando ocho archivos del paquete y cualquier conteo envejecía antes de la corrida. **Al 2026-08-28, después de `89ab7c0`, el árbol está limpio** (`git status` sin cambios) y `packages/ai` tiene **572 tests** verdes, así que la condición *«se re-audita cuando el árbol se aquiete»* se cumplió: **el censo de E7/E8/E9/S7 se puede tomar y no está tomado.** La fila la mueve el LEAD. **La duda sobre su `doing` la contestó el LEAD el 2026-08-28 (`1414302`) y era lo que este board sospechaba:** era un rastro del árbol de aquel momento, no un writer activo, y la fila está en `todo` desde entonces — ver la celda de estado y §Estados. Con él quedan sin cubrir E7, E8, E9 y S7 del `TEST_MATRIX.md`: el chat que no alucina sobre una unidad `reserved`, los jailbreaks de costo e IMEI en 3 fraseos, la dieta de contexto sin IMEI y la prompt injection escondida en la descripción del dueño. **Es el hueco de cobertura más grande del repo** y es de agenda, no de deuda: `CLAUDE.md` §Monorepo lo declara y FASE 5 lo construye. Se anota acá para que *"sin cubrir — FASE 5"* deje de leerse como una nota al pie | `packages/ai/` (**existe** desde `d42fac9`; el *(no existe)* de esta celda era del texto viejo que la propia fila corrige) · `docs/CHATBOT.md` · `docs/TEST_MATRIX.md` E7/E8/E9/S7 |
| T13 | CDN de `img.maat.work` no mandaba headers de medición y seguridad | **done · 2026-09-05 · verificada por el LEAD** | **LEAD** (`config`/Cloudflare externo; la route también fija headers locales) | probe API directa de clave WebP: 200 `image/webp` + `content-length` + ambos headers; después borrar y purgar: 404 con ambos headers | ruleset `87a896569a304efd94370af6b0892312`, fase `http_response_headers_transform`, ref `istock_media_response_headers`; `img.maat.work` y `.webp` | `apps/web/app/(app)/%5Fmedia/[...key]/route.ts` · Cloudflare Zone Ruleset |
| T14 | **dos** prohibiciones de `CLAUDE.md` §2 que ningún gate afirma (**eran tres hasta el 2026-08-28**: `W016` cerró **T14.1**, ver **T26**) | todo | `qa-agent` (ver desempate abajo) | — | cada una tiene un chequeo **que se vio fallar** sobre una violación sembrada, y corre **en cada push**, no dentro de un `accept-*`. **T14.3 se agregó el 2026-08-28** (la levantó `qa-agent`): *"borrado de un objeto de R2 por key al borrar un listing → rechazo"*. `guard-r2.sh` lo cubre **estáticamente** (R1+R2, `T11`), y no hay ningún test que afirme el **efecto**: que borrar un listing borra **el mapeo** y **no el byte**. La trampa está escrita en `packages/media/src/keys.ts:26` —dos tenants que suben la misma foto comparten el objeto— y hoy **no la frena nada el día que alguien escriba el borrado** | `tests/` (o `scripts/**`, y entonces es del **LEAD**) |
| T15 | el seed del demo dice un color en la URL y otro en la página | todo · **prioridad baja** | `db-agent` | — | **pregunta abierta, no diagnóstico** (ver abajo). Cerrada cuando el slug del listing y el color que muestra la ficha nombren lo mismo, y `bash scripts/accept-s3.sh` siga en verde | `packages/db/src/seed-data.ts:114-116` |
| T16 | `packages/**` no tiene gate de "query sin filtro de tenant" | todo | **LEAD** (todo gate es del LEAD, §4) | — | una query sembrada sin `tenant_id` dentro de `packages/**` pone **rojo** un comando del repo, y la exención se declara con motivo escrito igual que en W015. **Nace de cerrar T2**, cuyo alcance medido es `apps/web/app` + `apps/web/lib` + `proxy.ts` (`web-lint.mjs:41`) y nada más | sin definir — `apps/web/scripts/web-lint.mjs` no puede ser (mira `apps/web`); candidato natural: un gate propio en `scripts/**` |
| T20 | `guard-gates.sh` no se audita a sí mismo, y su mensaje de éxito cuenta de más | **done** · 2026-08-28 | **LEAD** (todo gate es del LEAD, §4) | — | **Levantado por `docs-keeper` el 2026-08-28 al verificar una frase de ADR-020, y confirmado leyendo cuatro líneas del gate.** Estaba así: el mensaje de éxito imprimía un conteo de `scripts/*.sh` hecho con `ls` → *"los **21** scripts resuelven todos los helpers que invocan"*, pero los dos barridos salteaban `_lib.sh`, así que **los auditados eran 20** — y el que quedaba afuera era la librería que importan los otros veinte, o sea donde un helper inexistente hace **más** daño y de una sola vez. **Arreglado por el LEAD el mismo día**, en tres partes y respetando que el diagnóstico valía para G1 y **no** para G2: (1) **`_lib.sh` entra a G1**; (2) **G2 lo sigue exceptuando, con el motivo escrito en el código** (`:167`) — G2 caza al gate que **redefine** un helper que la librería ya da, y `_lib.sh` es la librería: auditarlo ahí reportaría sus 12 definiciones como duplicadas de sí mismas; (3) el número impreso sale del barrido (`AUDITADOS`, `:173`) y no de un `ls`, y **su ausencia es FAIL** (`:184-187`), la misma convención que V9. Hoy imprime *"los **23** scripts auditados"*: los mismos que lista, los mismos que audita — y ese es el invariante, no el número. **Los números de esta celda se re-midieron el 2026-08-28 y habían quedado viejos: decía `21` scripts y `9 casos`, y el repo creció.** | `./scripts/guard-gates.sh` → `PASS  los 23 scripts auditados resuelven todos los helpers que invocan` (sección **G1**); `./scripts/guard-gates.test.sh` → **24 fixtures**, `OK (se vio encender y se vio callar)`, incluidos los tres de T20 (árbol sano con `_lib.sh` adentro → PASS; invocación rota **dentro** de `_lib.sh` → **FAIL**; G2 no acusa a `_lib.sh` de duplicar lo que él mismo define → PASS). **El veredicto global de `guard-gates.sh` hoy NO es PASS**, y no por G1 ni por T20: lo pone en rojo **G4**. Ver **T30** |
| T21 | `reservations` no tiene dónde anotar que una fila ya falló *(= `R1` de `COST.md` §2.5)* | **done** · 2026-08-28 · **cerró con 1 fallo de aceptación en el histórico** (el fallo se deja escrito como historia, no como estado: ver §"T21 · el primer fallo") | `db-agent` | — | **`bash scripts/accept-s6.sh`** (V10 + V10b), re-ejecutado por el **LEAD** el 2026-08-28. **Lo que la cerró no es una lectura de archivo:** la probe ve el contador llegar a **1** tras el rollback de la transacción que falló (`intentos_tras_fallo=1`) y a **5** en el tope (`tope=5`, `abandonadas_en_el_tope=1`) contra Postgres real. Si el `+1` viviera dentro de la transacción que falla, el rollback se lo llevaría y el campo valdría 0 · **Spec:** columna `sweep_attempts integer not null default 0` en `reservations`, **con su `GRANT` explícito para `service_role`** (§2 de `CLAUDE.md`: columna/tabla nueva sin GRANT no la lee nadie) y con la trampa del `created_at` de Drizzle a la vista —una migración editada después de aplicada nunca llega a la base de desarrollo y `migrate` dice `OK`—. **No** una tabla de dead-letter: una tabla nueva cuesta migración + GRANT + policy + un lector que nadie va a escribir; un contador sobre una fila que ya existe cuesta cero. **T21 habilita a T22, T23 y T24** | migración en `packages/db/**` + la fila del schema; el gate que lo mide es el de abajo, y **no** busca `sweep_attempts` en ningún archivo. **El fallo del 2026-08-28 y el gate nuevo que salió de él: §"T21 · el primer fallo"**, abajo |
| T22 | la fila envenenada conserva su lugar en la fila, para siempre *(= `R2` de `COST.md` §2.5)* | **done** · 2026-08-28 | `app-agent` | — | **`bash scripts/accept-s6.sh`** (V10 + V10b), re-ejecutado por el **LEAD** el 2026-08-28. Las **tres** piezas están medidas por los casos A, B y C de la probe: el `order by`, el techo en el `where` y el `+1` en transacción propia (`expire-reservations.ts:231`, `:226`, `:396`). **Mutación ejecutada por el LEAD:** sacar el techo del `where` pone en rojo **dos** campos distintos —el caso B **y** `lineas_log_por_envenenada`, que pasa de 5 a **7**—, o sea que el gate no depende de una sola aserción · **Spec:** `order by sweep_attempts asc, expires_at asc` y `where ... and sweep_attempts < MAX_SWEEP_ATTEMPTS`. El `+1` se escribe **en su propia transacción**, no dentro de la que falló: adentro se rollea con ella y el contador nunca avanza — es la forma más fácil de escribir este arreglo mal y de que el gate lo note igual. `MAX_SWEEP_ATTEMPTS = 5` `[EST]`: generoso para que una carrera perdida contra el dueño cancelando desde el panel (`40P01`) no llegue al tope, chico para que una fila determinista deje de costar 8.640 intentos/mes y pase a costar 5, una sola vez | `apps/web/app/api/cron/expire-reservations/**` |
| T23 | una corrida donde fallan las 200 filas devuelve `200 OK` *(= `R3` de `COST.md` §2.5)* | **done** · 2026-08-28 · **acotada a su predicado** — la mitad del `logEvent` se mudó a **T31** y esta fila **no** la cubre | `app-agent` | — | **`bash scripts/accept-s6.sh`** (V10 + V10b), re-ejecutado por el **LEAD** el 2026-08-28. Medido en las dos puntas **sobre la misma fila**: primera falla → `status_primer_fallo=200`, segunda falla de esa misma fila → `status_segundo_fallo=500` · **Spec:** el route dejó de mentirle al scheduler. **El predicado importa más que el código:** `failed > 0` a secas es el equivocado —a 0,12 expiraciones por corrida la mayoría trae **una** fila, así que una sola carrera perdida pintaría el scheduler de rojo permanente, que es enseñar a ignorar el rojo, el mismo error de los gates vacuamente verdes del otro lado—. El implementado es cross-run y T21 lo hace posible sin estado nuevo: `degraded = stuck \|\| unrecorded \|\| abandoned` (`route.ts:163`). **Por qué el caso nuevo hacía falta, y esto es lo que vale escribir:** el caso F de la probe ya sacaba su 500 por la pata `abandoned`, así que un `degraded = sweep.abandoned > 0` —el arreglo **sin** la mitad cross-run— **pasaba, y pasaba callado durante cinco corridas**. El LEAD lo mutó y ahora rojea. **Lo que esta fila NO cubre: `logEvent('reservation.expire.quarantined', …)` no existe** (`grep -rn quarantined apps/web packages` → **cero**) → **T31** | `apps/web/app/api/cron/expire-reservations/**` |
| T24 | el panel le dice al dueño que **no** haga lo único que arregla el problema *(= `R4` de `COST.md` §2.5)* | **done** · 2026-08-28 · **commiteada en `4a9a8de`** · veredicto re-ejecutado por el LEAD | `app-agent` | — | **`bash scripts/accept-s6.sh`** → **exit 0 · `S6: ACEPTADA`**, con **V10b verde en los 16 campos**. **Corrido por el LEAD el 2026-08-28**, y ésa es la corrida que mueve la fila. Entregado en **`4a9a8de`**, leído contra el árbol por `docs-keeper`: `reservationCountdown()` toma **`ReservationCountdownInput`** (`presentation.ts:69-72`), un objeto con `expiresAt` + `sweepAttempts`, **subconjunto estructural de `ActiveReservationRow`** — así el call site no puede olvidarse el contador sin romper el compilador, que es **ADR-021** (la afirmación tiene la forma del llamador) aplicado a una firma en vez de a un test. El orden quedó como pedía el encargo (`:126-141`): **tiempo restante → contador → reloj**, con `sweepAttempts >= MAX_SWEEP_ATTEMPTS` **importado** de `expire-reservations` (`:6`) y no re-escrito, y `SWEEP_GRACE_MINUTES = 15` intacto como fallback (`:58`). O sea: se **antepuso** el contador, no se reemplazó el reloj — que es exactamente la asimetría que la spec de abajo distinguía · **Spec corregida el 2026-08-28 — la celda anterior describía un código que ya no existe.** Decía *«hay un solo texto y lo decide sólo el reloj»*; **contra `main` hay dos textos** y los parte `SWEEP_GRACE_MINUTES = 15` (`git show HEAD:…/presentation.ts` → `:54`, `:94-95`; el árbol de trabajo lo tiene abierto y ya no coincide con `main`, así que la cita va contra `main` a propósito): *«venció, se libera solo en unos minutos»* adentro de la ventana, y *«venció hace … y sigue trabado — usá "Liberar equipo"»* pasada. O sea que el defecto de fondo **sigue igual**: decide **por el reloj**, y con el reloj «trabado» es una conjetura, mientras que con el contador es un hecho. **Los dos errores que comete hoy no son simétricos**, y por eso el encargo no es simétrico: una fila **en cuarentena dentro** de la ventana de gracia dice «se libera solo» y eso es **falso para siempre** —el defecto que T24 nombra—; una fila **sana durante una caída del cron** dice «usá Liberar» y eso es trabajo manual innecesario, molesto pero **inocuo**. El encargo es **anteponer el contador al reloj, no reemplazarlo**: sin barrido el contador no dice nada y el reloj es el fallback correcto. Cuando se encargó, `presentation.ts` **no mencionaba `sweepAttempts`** (verificado entonces, cero coincidencias); desde `4a9a8de` lo importa y lo lee antes que el reloj — ver la corrida en esta misma celda. **Sin T24, T21–T23 arreglan la métrica y no arreglan la unidad** | `apps/web/app/(app)/**` |
| T25 | el gate que mide T21–T24 *(= las cinco aserciones de `COST.md` §2.5.5)* | **done** · 2026-08-28 · commiteado en `1ae6575` + `9a6bf6f` · **la spec de esta celda estaba equivocada en tres puntos y la corrigió la probe midiendo** (ver abajo) | **LEAD** (`scripts/probes/**`, §4: la auditoría de referencia no puede ser del writer que audita) | — | **`bash scripts/accept-s6.sh`**, secciones **V10** (la probe corre) y **V10b** (el parte se parsea campo por campo), re-ejecutado por el **LEAD** el 2026-08-28. **Polaridad corrida antes de aceptar:** 13 líneas fabricadas contra el bloque V10b verbatim —11 rojas, 2 verdes, entre ellas `corridas=9`, que sube y **debe** seguir pasando—, más una mutación viva: `it.skip` sobre el caso E deja la probe en `exit 0` y pone a V10b **rojo dos veces**. Ese es exactamente el agujero que tenía V10 antes · **Spec:** **no busca `sweep_attempts` en ningún archivo** (**ADR-020**): corre el barrido **más de una vez** y cuenta filas. **Siete casos** (`scripts/probes/s6-sweep-head-of-line.test.ts`), y el parte se imprime **siempre**, también cuando un caso falló —un parte que sólo sale en verde no distingue *"no midió"* de *"midió mal"*—. V10b compara **campo por campo contra literales escritos en el shell**: otro archivo, otro lenguaje, **ADR-023**. **Ausencia de la línea = FAIL** | `scripts/probes/s6-sweep-head-of-line.test.ts` · `scripts/accept-s6.sh` §V10b. **Línea real emitida y verde:** `MEDIDO cron barrido · corridas=7 · envenenadas=200 · sanas=1 · sanas_vencidas_c2=1 · intentos_tras_fallo=1 · reintento_tras_recuperarse=1 · tope=5 · abandonadas_en_el_tope=1 · unrecorded=1 · skipped_sobre_vencidas=0 · status_base_sana=200 · status_con_abandonada=500 · status_primer_fallo=200 · status_segundo_fallo=500 · lineas_log_por_envenenada=5`. **Anticipado, porque un gate que se entera después es caro:** cuando caiga **T31**, `accept-s6.sh` suma un campo que cuenta esa línea y exige **1** |
| T26 | **`W016`** — el contador de rate limit en Postgres sobre la vidriera ya no pasa el lint | **done** · 2026-08-28 | **LEAD** (`*/scripts/*-lint.mjs`, §4) | — | cierra **T14.1**, que era **la última de las 14 prohibiciones de `CLAUDE.md` §2 sin gate ejecutable** (lo censó `qa-agent`). El gate es la corrida, y la corrida ya está: `cd apps/web && node scripts/web-lint.mjs` imprime `ok W016 ninguno de los 23 archivos de (storefront) cuenta requests en Postgres (el techo es el WAF)` y cierra en `WEB-LINT: PASS (16 reglas)`; `bash scripts/web-lint.test.sh` cierra en `POLARIDAD WEB-LINT: OK — las 16 reglas se vieron encender`. **Lo que faltaba para `done` no era una medición, era un commit, y llegó el 2026-08-28: `d37e6b3`** trae los tres archivos juntos. Verificado por `docs-keeper` contra `main`, no contra el árbol: `git show HEAD:apps/web/scripts/web-lint.mjs \| grep -c W016` → **4**, y `git cat-file -e HEAD:scripts/web-lint.test.sh` resuelve. Re-corrida sobre el árbol limpio: `WEB-LINT: PASS (16 reglas)` con la línea de W016 nombrando los 23 archivos de `(storefront)` | `apps/web/scripts/web-lint.mjs` (bloque W016, antes del veredicto) · `scripts/web-lint.test.sh` (**8 casos nuevos**) · `.github/workflows/ci.yml:156` |
| T27 | los dos resolvers de entitlements dan **motivos distintos** para la misma fila apagada, y uno de los dos le miente al dueño | **done** · 2026-08-28 · **commiteado**: el arreglo en `d85310a`, el gate en `4459cff` | `app-agent` (gate del LEAD) | — | **`bash scripts/accept-t27.sh`** → **`T27: ACEPTADA`, exit 0, 11 PASS · 0 FAIL**. El gate lo escribió el LEAD —`scripts/**` es suyo (§4)— después de que este board reportara que la fila estaba en `doing` **sin comando**. **Re-ejecutado por `docs-keeper` el 2026-08-28.** Qué audita: **V0** los cuatro archivos existen y no están vacíos (phantom-file guard en línea); **V1** el certificado es `scripts/probes/t27-un-motivo-una-voz.test.ts`, probe **del LEAD**, `Tests 6 passed`, que alimenta a los dos resolvers con **la misma fila** desde un solo mock de `withTenantDb` —los dos importan del mismo módulo—, que es la premisa de T27; **V2** los dos declaran los mismos tres motivos `[flag_off plan trial_expired]`, **cada lado contra un literal escrito en el gate** y nunca uno contra el otro (**ADR-023**: dos lados que se equivocan igual pasan una comparación mutua); **V3** el `const exhaustive: never = access.reason` está y `tsc --noEmit` de `apps/web` cierra verde, o sea que un motivo nuevo sin texto **no compila**; **V4** *«Eso viene con el plan Negocio.»* se escribe en **un solo lugar** fuera de los tests (`publish-listing.ts:176`); **V5** los tres archivos de test del propio writer, `Tests 70 passed`, que **se corren pero NO son el certificado** —son de `app-agent`, el writer del código auditado, y §4 dice que la auditoría de referencia no puede serlo—, aunque su rojo igual ensucia el veredicto. **Se vio encender**, cuatro mutaciones del LEAD, todas revertidas: `featureAccess()` devolviendo `plan` para la fila apagada (el bug original) → 1 failed; el `case 'flag_off'` borrado del switch de copy → 2 failed, una de ellas la del `new Set(textos).size`; una copia a mano del texto del plan en `parse-money.ts` → **V4 FAIL nombrando los dos sitios**; y la cuarta encontró un falso positivo del propio gate —contaba el docblock de `TRIAL_OVER`, que cita ese texto justamente para explicar por qué **no** es el suyo—, corregido filtrando comentarios con la regla de `none()` de `_lib.sh`. **Lo que este gate NO exige, y sigue abierto:** la unificación completa de los dos resolvers **no es parte de T27** — pide que `featureAccess()` además devuelva el techo (`limit`) y tenga camino de escritura, y **eso es decisión del LEAD, no un refactor**; acá se cerró la divergencia del **motivo**, que es la que le mentía al dueño | `apps/web/app/(app)/_lib/entitlements.ts` · `apps/web/app/(billing)/_lib/entitlements.ts` · el copy en `apps/web/app/(app)/_lib/listings/publish-listing.ts:144,176` · **gate del LEAD:** `scripts/accept-t27.sh` + `scripts/probes/t27-un-motivo-una-voz.test.ts` (los dos **en `main` desde `4459cff`**, verificado con `git cat-file -e HEAD:…`) |
| T28 | el dueño de un gate se **censa**, no se recuerda | **done** · 2026-08-28 · **commiteado en `4d33be6`**, junto con T30 | **LEAD** (`scripts/**` + todo gate, §4) | — | **la corrida es el gate, y ya está corrida.** `bash scripts/guard-gates.sh` cierra en `GUARD-GATES: PASS` con la línea de **G3** nombrando los **7** gates que corren desde un `package.json`; `bash scripts/guard-gates.test.sh` cierra en `OK (se vio encender y se vio callar)` con los **7 casos de G3**, cuatro de ellos viéndolo encender. **Re-ejecutado por `docs-keeper` el 2026-08-28**, los dos comandos, salida idéntica. La abrió el censo de la clase que **ADR-022** dice cubrir y no cubría: el `lint` de `packages/domain` es `scripts/purity-check.mjs`, que **no termina en `-lint.mjs`** y quedaba adentro de la columna de `domain-agent`. Regla vigente: es del LEAD todo script que un `package.json` corra como `lint`/`guard`/`check`/`verify`/`audit` — **son seis**, y los seis declaran `gate-owner: LEAD` en su encabezado. **Estado que se puede probar, re-verificado el 2026-08-28: ya está en `main`.** Esta celda decía lo contrario —*«`git show HEAD:scripts/guard-gates.sh` no trae la sección G3, o sea no está en `main`»*— y quedó vieja con `4d33be6`; hoy el mismo comando trae **G3 en `:195`** y **G4 en `:287`** | `scripts/guard-gates.sh` (sección G3) · `scripts/guard-gates.test.sh` (7 casos) · `CLAUDE.md` §4 · los seis encabezados `gate-owner: LEAD` · **ADR-022** (enmienda) |
| T29 | `accept-fase3.sh` clavaba el número de paquetes con tests, y su regex de resumen sólo sabía contar cuando todo estaba verde | **done** · 2026-08-28 · **commiteado en `0980dba`** | **LEAD** (`scripts/**`, §4) | — | **`bash scripts/accept-fase3.sh`** → **`FASE 3: ACEPTADA` · exit 0 · 54 PASS · 0 FAIL**, `next build` incluido. **Corrido por el LEAD el 2026-08-28**, y ese es el veredicto que mueve la fila. Hasta esa corrida esta celda decía *"el `done` lo fija la instrucción del LEAD"* y lo marcaba como hueco: la corrida que constaba era la de `docs-keeper`, no la del LEAD. **La objeción era correcta y se resolvió corriendo, no reescribiendo** — que es lo que §0.2 pide y lo que este board ya vio hacer falta una vez (T21, rojo después de haber sido reportada verde). Lo que cambió, leído del diff y verificado a mano: (1) **el censo de paquetes sale del filesystem, no de una constante.** `HEAD:scripts/accept-fase3.sh:137` dice `PAQ_CON_TEST=5   # domain, media, db, tests, apps/web`, con la nota *"si cambia, se cambia ACA"*; después nació `packages/ai` y nadie subió el número. El árbol censa y devuelve **6** —`tests`, `apps/web`, `packages/ai`, `packages/db`, `packages/domain`, `packages/media`— y la corrida imprime *«los 6 paquetes con tests reportaron resumen»* sobre **2008** tests. **El defecto que eso tapaba es el peor verde posible:** con `apps/web` en rojo el log traía 5 resúmenes, `5 >= 5`, y la regla que dice *«ausencia de medición = FAIL»* daba PASS **por coincidencia aritmética**. (2) **el regex de resumen cuenta también en rojo.** Medido por `docs-keeper` sobre la línea real `Tests  1 failed \| 569 passed \| 4 skipped (574)`: el viejo `Tests +[0-9]+ passed` matchea **0** veces —el `1 failed` se le mete en el medio— y el nuevo `Tests +[0-9]+ (passed\|failed\|skipped)` matchea **1**. O sea que las tres cuentas derivadas (paquetes, total y skips) **sólo sabían contar cuando no hacían falta**. (3) las dos fuentes se mantienen separadas a propósito —**filesystem** para el censo, **log de vitest** para la cuenta—: para que la comparación mienta hay que borrar los tests del disco **y** el resumen del log a la vez | `scripts/accept-fase3.sh` (**en `main` desde `0980dba`**) |
| T30 | la **ejecución** de un gate también se censa: cuatro gates se escribieron, quedaron afuera de `ci.yml`, y estuvieron rojos o vacuamente verdes sin que nadie se enterara | **done** · 2026-08-28 · **re-ejecutada por el LEAD** | **LEAD** (`scripts/**` + todo gate, §4) | — | **`bash scripts/guard-gates.sh`** → **exit 0**, `GUARD-GATES: PASS`, **re-ejecutado por el LEAD el 2026-08-28**, con las tres secciones: `G1 · los 23 scripts auditados resuelven todos los helpers que invocan` · `G3 · los 7 gates que corren desde un package.json existen y se declaran del LEAD` · `G4 · los 21 gates de scripts/ estan nombrados en ci.yml o declaran su exencion`. `bash scripts/guard-gates.test.sh` cierra en `OK (se vio encender y se vio callar)` con **24 fixtures**, **8 de ellos de G4** y **4 viéndolo encender** (gate ausente de `ci.yml` → FAIL · exención con motivo de menos de 30 caracteres → FAIL · `accept-*.sh` nuevo que nadie agregó al workflow → FAIL · árbol **sin** `ci.yml` → FAIL, porque cero gates censados es hallazgo y no veredicto verde). **El LEAD verificó además los cuatro conteos contra el árbol**, por su cuenta: `ls scripts/probes/*.test.ts \| wc -l` → **7** · fixtures → **24** · gates de `scripts/` → **21** · G1 audita **23**. **Esos cuatro números son de la corrida del 2026-08-28 *antes* de T32, y dos de ellos ya se movieron:** los dos scripts de `guard-doc-tables` entraron a `ci.yml` con `d3deb86`, así que hoy `G4` censa **23** gates y `G1` audita **25** (re-medido por `docs-keeper` el 2026-08-28: `bash scripts/guard-gates.sh` → `PASS`, `ls scripts/probes/*.test.ts \| wc -l` → **7**, fixtures → **24**, sin cambios). Que crezcan es la conducta esperada del censo, no drift del veredicto. **Y G4 se vio encender sobre un caso real, que es la mejor evidencia que tiene este gate.** No es que estuviera roto y se arreglara: **G4 encendió sobre `scripts/ai-lint.test.sh` el día que el archivo nació y antes de estar trackeado** —`GUARD-GATES: FAIL · 1 de 21 gates no corren en CI ni dicen por que`—, que es **exactamente el momento en que T30 dice que tiene que encender**. Las cuatro instancias históricas (`guard-routes`, `guard-grants`, `accept-fase2` con semanas en rojo, `accept-fase3`) se descubrieron meses después y mirando. Ésta se descubrió sola, el primer día. El gate quedó en `ci.yml` con `c2aa5d2` · **Spec:** **es T28 corrido un escalón**, y por eso van en el mismo commit: allá el *dueño* de un gate se recordaba en vez de censarse, acá se recuerda la *corrida*. Cuatro instancias arregladas de a una —`guard-routes`, `guard-grants`, `accept-fase2` (rojo semanas), `accept-fase3`— es la firma de una clase sin gate, no de cuatro descuidos. Regla: todo `scripts/accept-*.sh`, `scripts/guard-*.sh` y `scripts/*.test.sh` está nombrado en `.github/workflows/ci.yml`, o declara `ci-exento: <motivo>` de 30+ caracteres en sus primeras 40 líneas — **mismo idioma que `web-lint:sin-tenant`**, y por la misma razón: la alternativa a una exención escrita no es *«sin exención»*, es la invisible, que es exactamente lo que esas cuatro veces fueron. `_lib.sh` queda **afuera del censo a propósito**: es librería, y exigirla en CI sería pedir que se ejecute un archivo que aborta cuando se lo ejecuta | `scripts/guard-gates.sh` §**G4** (`:287`) · `scripts/guard-gates.test.sh` (8 fixtures de G4) · `CLAUDE.md` §4 |
| T31 | cuando el cron devuelve 500 con `abandoned=3`, el que mira los logs tiene un número y **ningún id** | **done** · 2026-08-28 · **commiteada en `4a9a8de`** (el `logEvent`) y **`dd871ce`** (probe y gate) | `app-agent` | — | **`bash scripts/accept-s6.sh`** → **exit 0 · `S6: ACEPTADA`**, **corrido por el LEAD el 2026-08-28**, con el campo nuevo en el parte: `… · lineas_log_por_envenenada=5 · lineas_cuarentena_por_envenenada=1`. Leído contra el árbol: el evento sale **una sola vez por vida de la fila**, decidido sobre el **`RETURNING` del `+1`** (`expire-reservations.ts:454`, `crossedCap = bumped[0]?.sweepAttempts === MAX_SWEEP_ATTEMPTS`) y no sobre el valor leído antes del update, con `reservationId` / `tenantId` / `listingId` y ningún campo prohibido. **Lo que el campo mide y lo que NO — medido por el LEAD, no supuesto, y es ADR-024 otra vez:** `app-agent` predijo que cambiar `===` por `>=` haría dar **3**; la mutación corrida da **1, verde**. Decidir el cruce contra `row.sweepAttempts + 1` en vez del `RETURNING`: **1, verde**. Lo que el campo **sí** discrimina: no emitir → **0** · emitir por intento → **5** · emitir por vida → **1**. Las dos ramas ciegas sólo se observan con dos corridas del cron pisándose y este fixture tiene **un escritor a la vez**; el hueco está **declarado en la probe** (`s6-sweep-head-of-line.test.ts:600-608`) y en el mensaje de falla del gate, y el caso concurrente se **declinó a propósito** porque dependería del scheduler y un rojo intermitente termina en `it.skip` — este repo ya sabe lo que cuesta un gate que se ignora. **Este board no dice que el campo prueba el `===`, porque no lo prueba** · **Spec:** **Sale de partir T23, y el nombre distinto es el punto de la fila.** El propósito que T23 le daba al `logEvent` —*dejar de pagar 8.640 líneas idénticas por mes*— **ya está cumplido por el techo de T22**, medido en `lineas_log_por_envenenada=5` y después silencio. Lo que falta es otra cosa y si no se la nombra aparte se pierde: **los ids de las filas abandonadas dejan de aparecer en el 5º intento**, así que el 500 de T23 es un número sin sujeto y el dueño no sabe qué unidad soltar. Encargo: `logEvent('reservation.expire.quarantined', …)` **una sola vez en la vida de la fila**, en el **cruce del tope**, con `reservationId` / `tenantId` / `listingId`. **Cuando se encargó no existía:** `grep -rn quarantined apps/web packages` daba **cero**; hoy da el `logEvent` de `expire-reservations.ts:464`, su unit test y la probe | `apps/web/app/api/cron/expire-reservations/**` + `apps/web/app/(app)/_lib/reservations/**` |
| T32 | una tabla de `docs/**` se corrompe **en silencio**: un `\|` sin escapar corre las celdas de lugar y la fila **igual se ve bien** — parece una celda vacía, no un error | **done** · 2026-08-28 · **la cerró la corrida del LEAD**, no la de `docs-keeper` · commiteada en `d3deb86` (gate + `ci.yml`) y `baa6cc8` (board) | **LEAD** (`scripts/guard-doc-tables.sh` + `.test.sh`, §4: el gate no es del writer que audita) · lo que el gate marque adentro de `docs/**` lo arregla `docs-keeper` | — · el bloqueo que tenía —*"los dos archivos del gate están sin trackear"*— lo levantó `d3deb86` | **`bash scripts/guard-doc-tables.sh`** → **`GUARD-DOC-TABLES: PASS` · 1157 filas · 165 tablas · 21 archivos · exit 0**, **corrido por el LEAD el 2026-08-28** sobre el árbol ya commiteado, y **ésa es la corrida que mueve la fila**. `docs-keeper` lo había corrido antes con el mismo resultado y dejó escrito que su propia corrida **no cierra la fila** —una fila cuyo comando corre el LEAD no la cierra el agente que la escribió, **ADR-022** aplicado al board—: acá eso quedó **ejercido, no sólo escrito**, y las dos corridas coincidieron, que es la otra mitad de por qué el número se anota antes. Acompañan `bash scripts/guard-doc-tables.test.sh` → **`POLARIDAD DOC-TABLES: OK — 9 casos, se vio encender y se vio callar` · exit 0**, y el árbol verde entero medido por el LEAD (`pnpm -r typecheck` 0 · `pnpm -r lint` 0 · `pnpm -r test` 0: domain 201 · media 164 · ai 472 · db 330 · apps/web 587 + 4 skipped · tests 267). **Reconciliación de `1156` → `1157`, escrita porque un número que cambia sin explicación es exactamente lo que este board existe para no tener:** no fue drift del gate. El LEAD midió `git diff --unified=0 -- docs/` → **+6 filas de tabla, −5**, o sea neto **+1**, que es la edición sin commitear de `docs-keeper` entre las dos lecturas; el gate devolvió el mismo número las dos veces sobre el mismo árbol. Los dos scripts están cableados en `ci.yml` (`:181`, `:185`) desde `d3deb86`, y por eso **`guard-gates.sh` pasó de censar 21 gates a 23**, con `G4` en verde: el gate nuevo **no nació exento** · **Spec:** el gate nace de una observación de `docs-keeper` —tres filas rotas por la misma causa (T26, una fila de `TEST_MATRIX.md`, y la propia T30) detectadas **a ojo**, que es como se detectaban `guard-routes` y `accept-fase2`—, y de que `guard-artifacts.sh` no las ve: mira que el archivo exista y tenga bytes, así que una tabla corrupta le pasa al lado con un `OK 237271`. Regla: toda fila tiene **exactamente** las columnas que declara su cabecera, ni más ni menos, y el único pipe que no separa es `\|`. **La primera corrida encendió sobre T28, y lo que encontró no era lo que parecía** — medido por `docs-keeper`, porque el diagnóstico de la celda `artefacto` faltante no se sostiene: **esa celda nunca faltó.** La fila tenía **61 backticks (impar)**: un backtick colgado en prosa del LEAD, después de `` `main`» ``, corría el emparejamiento de code spans, y la **primera versión del gate blanqueaba los code spans**, con lo cual el span fantasma se tragaba un pipe de estructura y la fila contaba **6**. El LEAD reemplazó ese modelo: la versión viva **parte sólo por pipes no escapados**, y contra el `SLICE_BOARD.md` de `HEAD`, con T28 **sin** arreglar, cierra en **PASS**. O sea: el backtick de más era **cosmético** —renderiza un backtick literal, no corre ninguna celda— y se sacó igual, pero **la corrupción de columnas de T28 no existió**. **El cambio de modelo es lo que hace útil al gate**: blanquear code spans lo dejaba ciego justo a la clase que lo originó, porque los tres casos reales son un pipe crudo **adentro** de un code span; la versión viva los ve, y su `.test.sh` tiene un caso que enciende con `` un `\|` sin escapar adentro de codigo inline (los 3 casos reales) `` y otro que **calla** con el `\|` ya escapado, para que el gate no castigue su propio arreglo. Evidencia adentro del repo de que ése es el modelo correcto: **20 code spans de `docs/` escriben `\|` a mano**, incluidas `F0.2`–`F0.4` de este board, escritas por el LEAD — convención que sólo hace falta si el pipe separa celdas también adentro del code span. **Y el LEAD aplicó el hallazgo en su propia columna** (`scripts/**`, §4, así que `docs-keeper` reporta y no edita): `guard-doc-tables.test.sh:51` rotulaba un fixture como *"una columna de MENOS (el 4to caso, T28)"*, atribución falsa, y hoy dice *"una columna de MENOS (clase real, sin caso historico)"* — la clase se sigue testeando, lo que se fue es el caso histórico inventado. El docblock de `guard-doc-tables.sh` quedó con la moraleja operativa, que es lo que esta fila deja de aprendizaje: **un gate recién nacido que enciende no es evidencia de un defecto hasta que se reproduce el defecto sin el gate.** La premisa invertida no sólo produjo un falso negativo —el caso del arnés salía verde—, también produjo un **falso positivo**, T28 | `scripts/guard-doc-tables.sh` (§`D1`) · `scripts/guard-doc-tables.test.sh` (9 casos) · `.github/workflows/ci.yml` (`:181`, `:185`) · commits `d3deb86` (gate) y `baa6cc8` (board) · **T28** y **T30** son las filas hermanas: allá se censan el *dueño* y la *corrida* de un gate, acá el *estado* de un doc |
| T33 | `scripts/probes/**` no lo alcanza **ningún** gate de tipo ni de ejecución: ni `pnpm typecheck` ni `pnpm test` lo miran | **done** · 2026-08-28 · **commiteado en `5b6061e`** *(`[fix] T33: nobody ran the probes census, and nothing typechecked scripts/`)* | **LEAD** (`scripts/**` y `scripts/probes/**`, §4) | — | **Defecto LATENTE, no vivo, y la diferencia es la fila entera.** Censado el 2026-08-28 por el LEAD y re-censado por `docs-keeper`: hay **8** probes en `scripts/probes/` y **cero huérfanas** — cada una está nombrada por exactamente un `scripts/accept-*.sh` (`el-grant-cubre-el-insert-de-drizzle`→`accept-fase2` · `s2-media-measure` y `s2-seed-master-key`→`accept-s2` · las tres de `s6-*`→`accept-s6` · `s7-venta-manual`→`accept-s7` · `t27-un-motivo-una-voz`→`accept-t27`). O sea: hoy no hay nada roto, y lo que falta es que eso lo afirme un comando en vez de un censo a mano. **Medido:** `pnpm-workspace.yaml` declara `apps/*`, `packages/*`, `tests` y `e2e`; los dos scripts raíz son `pnpm -r --no-bail typecheck` y `pnpm -r --no-bail test`; **`scripts/` no es workspace de nadie**, y ningún `tsconfig.json` del repo lo incluía (el único que incluye un `scripts/**` es `packages/media/tsconfig.json`, y es el suyo). Consecuencia: una probe puede dejar de compilar, o quedarse sin `accept-*.sh` que la corra, y el árbol sigue verde — la misma clase que T30 (*se escribió el gate, no se ejecuta*) un escalón más abajo, sobre el archivo que **firma** el certificado. **Cerrada por la corrida del LEAD el 2026-08-28**, no por la de `docs-keeper`: **`bash scripts/guard-gates.sh`** → `GUARD-GATES: PASS`, reportada por el LEAD junto con el árbol entero verde (`typecheck`/`lint`/`test`, **2139** tests). Lo que esta celda decía hasta hoy —*«el arreglo está en vuelo, sin commitear»*— quedó viejo con `5b6061e`, y el estado se re-leyó del árbol: **`G5` está en `main`** (`git show HEAD:scripts/guard-gates.sh` la trae en `:409`, `sec "G5 · toda probe de scripts/probes/ la corre alguien, y tsc la alcanza"`) y **`scripts/tsconfig.json` también** (`git cat-file -e HEAD:scripts/tsconfig.json` resuelve; `extends ../tsconfig.base.json`, `types: ["node"]`, `noEmit`, `include: probes/**/*.ts`). **Corrida de `docs-keeper`, que NO mueve la fila y sirve de segunda lectura** (ADR-022 aplicado al board): mismo `PASS`, con las dos mitades de G5 nombrando el mismo censo que este board había hecho a mano — `las 8 probes de scripts/probes/ tienen quien las corra` y `las 8 probes compilan bajo scripts/tsconfig.json`, cada probe con el `accept-*.sh` que la corre al lado. **Las dos mitades son dos preguntas distintas a propósito** (`guard-gates.sh:419`): *quién la corre* y *que `tsc` la vea*; **G5b no corre bajo `GATES_ROOT`** y el propio gate lo dice en `:496` —pide `tsconfig.base.json`, `node_modules` y los paths del monorepo—, así que el arnés ejerce la primera mitad sobre fixtures y la segunda sólo contra el árbol real. Es una limitación **escrita**, no un hueco callado. **Lo que la fila deja:** el defecto era **latente y no vivo** —cero probes huérfanas el día que se abrió—, y el valor del arreglo es que eso ahora lo afirma un comando en vez de un censo a mano; una probe nueva sin `accept-*.sh` que la corra, o que deje de compilar, rompe el gate **el día que nace** | `scripts/probes/**` · `scripts/guard-gates.sh` §**G5** (`:409`, **en `main` desde `5b6061e`**) · `scripts/guard-gates.test.sh` (bloque `── G5 · el censo de probes ──`, `:201`) · `scripts/tsconfig.json` (**en `main`**) · `pnpm-workspace.yaml` |
| T34 | `scripts/guard-effects.sh` no tenía arnés de polaridad ni escotilla de fixture: dos de sus tres polaridades no se habían ejercido nunca | **done** · 2026-08-28 · **commiteado en `2ccb8a1`** | **LEAD** (`scripts/**`, §4) | — | **Cerrada por la corrida del LEAD el 2026-08-28**: `bash scripts/guard-effects.sh` → **`GUARD-EFFECTS: OK`** y `bash scripts/guard-effects.test.sh` → **`POLARIDAD EFFECTS: OK — 10 casos, se vio encender y se vio callar`**. **Por qué hacía falta la corrida del LEAD y no alcanzaba ninguna otra:** los dos comandos son **scripts de shell** y **`pnpm test` no los alcanza**, así que el árbol entero en verde no dice nada sobre esta fila — y la corrida de `docs-keeper` no la cierra (**ADR-022** aplicado al board: el veredicto de un gate es del LEAD, no del agente que escribió la fila). Las dos corridas coincidieron, que es la razón por la que el número se anota antes de tener el veredicto. **Entregado y commiteado en `2ccb8a1`** *(`[fix] T34: the effects gate had three polarities written and none ever seen`)* **mientras se escribía esta fila** — la primera versión decía *"no existe `guard-effects.test.sh`"* y quedó vieja en el mismo día. **El sha y el id de esa línea cambiaron el 2026-08-28 y por eso se dice:** el commit se titulaba `[fix] T32: …` —id ya tomado por `guard-doc-tables.sh`— y el LEAD **enmendó el mensaje**, con lo cual el sha viejo `5f9ca03` dejó de estar en el log. Verificado por `docs-keeper` contra `main`: `git log --oneline` trae `2ccb8a1 [fix] T34: …` y `5b6061e [fix] T33: …`, y esta celda cita el sha nuevo. Hoy el arnés existe (**157 líneas**), la escotilla también (`EFFECTS_FUENTE` / `EFFECTS_DESTINO`, `guard-effects.sh:46-52`, hermana de `DOC_TABLES_ROOT` y de `WAF_CFG`) y el step está en `ci.yml:140`, o sea que **no nació exento** (`G4`). La corrida previa de `docs-keeper` —la que no cierra— había dado lo mismo, con `createsSale se ejecuta en apps/web/app (1 referencia(s))`. **Corrección al encargo, medida:** decía *"nadie lo vio nunca encender"* y era **falso** — la **tercera** polaridad (CON consumidor + CON motivo → FAIL, la exención podrida) encendió de verdad en S7: la exención de `createsSale` decía *"vence con esa slice … apenas aparezca un consumidor, tener el motivo escrito pasa a ser FAIL"*, `transitionUnit()` lo consumió, y el gate se puso rojo sin que nadie se acordara de ir (`02424f2`, que la saca y **la deja anotada en vez de borrada**: es la única exención del repo que se vio expirar sola). Lo que no se había visto son las otras dos y `E1`. **Lo que la fila deja de aprendizaje, y ya se cobró una:** hasta `02424f2` este guard **contaba menciones de docblock como consumidores** — de ocho referencias a `createsSale`, **siete eran comentarios y una era código** —, o sea que un efecto documentado y **no** ejecutado contaba como ejecutado, que es el bug de S6 con prosa encima; el veredicto salía bien de casualidad y sobrevivió dos slices en verde. **Un gate que nunca se vio fallar no es un gate**, y el rojo por accidente no es repetible | `scripts/guard-effects.sh` (escotilla, `:46-52`) · `scripts/guard-effects.test.sh` (**10 casos**, **en `main` desde `2ccb8a1`**) · `.github/workflows/ci.yml:129` y `:140`  <!-- t55-hash-exento: el sha muerto es el sujeto de la oración, no un destino: esta celda existe para avisar que el sha que ella misma citaba cambió, y sin nombrarlo nadie puede reconciliar una copia vieja del board --> |
| P4 | **siete** FKs a `listings.id` sin `tenant_id` en el par: un tenant puede clavarle una unidad al de al lado | todo | `db-agent` (propone la migración) · gate del **LEAD** | — | **Consecuencia medida en S7 y declarada en el docblock de R9c** (`tests/rls-cross-tenant.test.ts:1479-1495`): hoy la base **ACEPTA** que el tenant B inserte una venta con **su propio** `tenant_id` apuntando al `listing_id` de A — el `WITH CHECK` mira `tenant_id`, que es el suyo y es legítimo, y la FK mira `listing_id` y no sabe nada de tenants. **No filtra datos** (todo join contra `listings` lo corta RLS), pero con `on delete restrict` **le clava la unidad al otro tenant**. Las siete, censadas contra el schema: `sales.listing_id` (`restrict`) · `reservations.listing_id` (`cascade`) · `listing_photos.listing_id` (`cascade`) · `listing_events.listing_id` (`cascade`) · `wa_click_events.listing_id` (`set null`) · `chatbot_threads.listing_id` (`set null`) · `tradein_leads.created_listing_id` (`set null`). **El assert NO está escrito en R9c a propósito, y el motivo es la mitad importante de esta fila:** fallaría, y fallaría **por el motivo correcto** — un rojo permanente con causa conocida enseña a ignorar el archivo entero, que es la única forma de perder ese gate. El día que la migración cierre el hueco, el assert entra con ella. **Precio a decidir por el LEAD, no por este board:** cerrarlo pide FK compuesta contra `listings(tenant_id, id)`, o sea tocar `listings` y pagar un índice único más en la tabla más caliente del producto | `packages/db/src/schema/{commerce,events,chatbot,listing-photos,tradein}.ts` · `packages/db/drizzle/0007_sales_one_sale_per_listing.sql` (lo deja escrito) · `tests/rls-cross-tenant.test.ts` §R9c |
| P5 | lectura sensible de seller/owner en `sales`, `listings` y `tradein_leads` | **done** · 2026-09-04 | `db-agent` · **LEAD** (aceptación) | — | Las migraciones `0012_owner_sensitive_read_functions.sql` y `0016_furry_champions.sql` revocan el `SELECT` directo sensible de `authenticated`, dejan allowlists explícitas y reservan las lecturas financieras para RPC `SECURITY DEFINER` owner-only. `packages/db/src/seller-authorization.test.ts` prueba las dos polaridades: seller y owner fallan en `SELECT` directo; owner obtiene sus filas por RPC y seller no obtiene ninguna. `pnpm --filter @istock/db test` → **486 passed** | `packages/db/drizzle/0012_owner_sensitive_read_functions.sql` · `packages/db/drizzle/0016_furry_champions.sql` · `packages/db/src/seller-authorization.test.ts` |
| T35 | `publish-listing.test.ts` **fabrica a mano** la forma del `PostgresError`: es la única clase de test del repo que todavía la escribe en vez de pedírsela a Postgres | todo · **severidad baja** | `app-agent` (es su archivo y suyo el hallazgo) | — | **La levantó `app-agent` sobre su propio archivo**, y eso es la mitad de por qué la fila existe: el writer reportó una deuda de su columna que ningún gate mira. **Qué hay, medido:** `apps/web/app/(app)/_lib/listings/publish-listing.test.ts:19-31` arma el error con `envueltoPorDrizzle(Object.assign(new Error('duplicate key'), { code: '23505', constraint_name: constraint }))`. **El envoltorio es real** —`DrizzleQueryError` importado de `drizzle-orm/errors`, no una imitación—; lo fabricado es el **error de adentro**. **Por qué la severidad es baja y no media, verificado y no supuesto:** los dos campos que la forma inventada usa son los que el driver realmente emite — `constraint_name` es el campo `n` del `ErrorResponse` (`node_modules/postgres/src/connection.js:46`) y `pg-error.test.ts:133` lo afirma **contra Postgres real**, no contra un literal. O sea que hoy el fixture es fiel; lo que no es, es fiel **por construcción**. **El riesgo que queda:** el día que el driver renombre un campo, o que `pg-error.ts` empiece a leer otro (ya lee `constraint_name ?? constraint`, `:114`, porque `node-postgres` lo llama distinto), el fixture inventado **sigue verde** mientras el código deja de andar. Es exactamente la clase que `df00474` pagó: seis `catch` escritos, bien escritos y muertos, porque `pg-error.ts` leía `code` del objeto de arriba y **ningún test le pedía el error al driver**. **Y es la clase que `create-listing.test.ts` ya NO tiene** (`7fc284a`): ahí cada colisión se provoca **insertando la fila que choca** contra Postgres real y el nombre de la constraint lo dice Postgres, con una sonda por caso. **No es un engaño, es una deuda escrita:** el docblock del propio archivo (`:5-17`) declara qué fabrica, por qué envuelve, y que *«la forma plana la cubre `_lib/db/pg-error.test.ts` contra Postgres real»*. **Lo que la fila NO dice:** no dice que haya que migrar el archivo a Postgres real. `publish-listing.test.ts` mockea la DB a propósito para probar la máquina de estados sin base, y esa decisión no se reabre acá — lo que hay que decidir es si la forma del error se importa de un helper compartido con `pg-error.test.ts` o si se acepta el duplicado, **y eso lo decide `app-agent` con el LEAD**, no este board | `apps/web/app/(app)/_lib/listings/publish-listing.test.ts` (`:19-31` y el docblock `:5-17`) · `apps/web/app/(app)/_lib/db/pg-error.ts` (`:114`) · `apps/web/app/(app)/_lib/db/pg-error.test.ts` · commit `df004744` |
| T36 | vitest imprime un IMEI en la salida de test: el `DrizzleQueryError` lleva la **lista de parámetros del `INSERT`** adentro del `message` | todo · **nada que arreglar en el código** | **LEAD** (decide si la clase se cierra y dónde) · el hallazgo es de `app-agent` | — | **Esta fila existe para que nadie lo redescubra creyendo que encontró una fuga.** `CLAUDE.md` §2 vigila ese campo, así que un IMEI en una salida de consola es exactamente lo que un agente atento tiene que frenar a mirar — y la respuesta está acá, medida, en vez de costar media hora cada vez. **Qué pasa, y el mecanismo es más preciso que *«vitest serializa el error»*** —el encargo original decía que la lista salía del runner, `docs-keeper` midió que no, y **el LEAD verificó la corrección antes de commitearla** (`node_modules/drizzle-orm/errors.js:13`)—**:** el que concatena los parámetros no es el runner, es **Drizzle**. `DrizzleQueryError` construye su propio `message` como `` `Failed query: ${query}\nparams: ${params}` `` (`node_modules/drizzle-orm/errors.js`, y `errors.d.ts` tipa `query: string` y `params: any[]`). O sea que la lista de parámetros ya está **dentro del string del mensaje** antes de que nadie serialice nada; vitest sólo lo imprime cuando un caso falla. **El valor es sintético:** `350000000000001`, literal de fixture en `apps/web/app/(app)/_lib/listings/create-listing.test.ts:405`, en el caso *«IMEI repetido → field "imei"»*. No hay IMEI real en ningún test del repo. **Y el camino de producción está cerrado por diseño, verificado:** `logError()` **no recibe el `Error` crudo** y su docblock dice por qué —*«los mensajes de Postgres pueden incluir el valor de la fila que violó una constraint, y esa fila puede tener un IMEI»* (`_lib/log.ts:51-54`)—; además `sanitize()` tiene la denylist `FORBIDDEN_FIELD` con `imei` adentro (`:22`), que en dev **tira** y en producción reemplaza por `[redactado]`. **Y eso no está afirmado por el tipo solamente: lo midió el LEAD el 2026-08-28 recorriendo *todos* los call sites de `logError` en `apps/web`** — **ninguno** recibe un `Error` crudo; todos pasan un código y campos estructurados. Esa medición es la que sostiene la severidad de hoy, y queda escrita acá para que no haya que re-derivarla la próxima vez que alguien vea el IMEI en una consola. **Lo único que hay abierto, y es del LEAD porque es una decisión y no un arreglo:** hoy nada manda el error crudo afuera del proceso —**no hay SDK de Sentry instalado** (`@sentry` no aparece en ningún `package.json` del repo y `grep -rn captureException apps packages` da **cero**), y `instrumentation.ts` cablea sólo el canal de incidentes de `@istock/media`—. El día que se instale Sentry y algo haga `captureException(err)` con un `DrizzleQueryError`, ese `message` viaja con los parámetros del `INSERT`, y ahí el IMEI ya no es sintético. **Esta fila deja el hecho escrito antes de que eso pase**; qué se hace —un `beforeSend` que corte `params`, un wrapper que reescriba el mensaje, o nada— **no lo decide este board** | `node_modules/drizzle-orm/errors.js` (constructor de `DrizzleQueryError`) · `apps/web/app/(app)/_lib/listings/create-listing.test.ts:405` · `apps/web/app/(app)/_lib/log.ts` (`:22`, `:51-54`) · `apps/web/instrumentation.ts` |
| T37 | **cuarta** instancia de la clase *segmento-vs-sufijo* en el matcher del proxy: la instancia se cerró, la clase sigue abierta | todo · **la instancia de S8 está CERRADA** (`ab3af3a`); lo que queda abierto es que **nada impide la quinta** | **LEAD** — el cierre de una clase es un gate y los gates son suyos por §4. **Atribución derivada de §4, no dictada por el encargo**: si el LEAD prefiere otro dueño, es un `sed` | — | **No hay gate que afirme la clase, y eso es exactamente lo que la fila pide decidir.** La instancia sí está cerrada y verificada: `apps/web/proxy.ts` sumó `'/app/:path*'` al `matcher`. **Lo que hay que leer es por qué es la cuarta y no la primera:** el router de Next matchea por **segmento** y este matcher excluye por **sufijo**, y esa discrepancia ya produjo **S1** (`/s/algo.json` matchea `/s/[slug]` con `slug = "algo.json"`), **S2** (`/_media/….webp`: la extensión la elige quien pide la URL) y **P2** (`/icon.png`, `/robots.txt`, `/sitemap/1.xml` — 25 URLs que son **nombres**, no sufijos). La de S8 es `/app/canjes/[id]`, la primera ruta de `/app` cuyo segmento dinámico es el **último**: `/app/canjes/basura-991.json` es match perfecto de la ruta —Next acepta un punto adentro de un segmento— y a la vez cae en la exclusión por sufijo. **16 URLs medidas (una por sufijo) que la app atiende y el proxy no ve**, con la consecuencia que importa: **`stripInboundTenantHeaders()` no corre**, o sea que un `x-tenant-*` puesto por el cliente sobrevive hasta el panel autenticado — `CLAUDE.md` §2, escalación de tenant. **El arreglo angosto se rechazó y el motivo es la fila entera:** un lookahead negativo por ruta nueva (`(?!app/canjes/)…`) cierra la instancia y deja la clase abierta esperando a `/app/clientes/[id]`, que es **exactamente cómo llegaron las tres anteriores**. La inclusión por subárbol no depende de qué rutas se creen adentro. **Verificado contra el `next@16.3.3` instalado, no contra la prosa de la doc:** el `matcher` es una lista **OR** — `next/dist/shared/lib/router/utils/middleware-route-matcher` itera las entradas y devuelve `true` en el primer match (`if (!routeMatch) continue`), así que una entrada de inclusión gana sobre la exclusión por sufijo. Y no mete estáticos al proxy: `apps/web/public/` **no existe** (re-medido en S8), y si existiera los assets se sirven desde la **raíz**, no bajo `/app/` | `apps/web/proxy.ts` (docblock del `config`, tabla de los cuatro agujeros) · `tests/proxy-matcher-no-deja-la-vidriera-sin-vigilar.test.ts` · **ADR-015** (que cerró P1+P2 y nombra la misma clase) |
| T38 | el techo del WAF cuenta **por IP y no por método**, y bajo CGNAT móvil argentino eso reparte el cupo entre desconocidos | todo · **el LEAD decidió NO parchearlo en S8**, con motivo escrito | **LEAD** (`config/firewall-rules.json` y `scripts/guard-firewall.sh` son suyos por §4) | — | **Levantado por `adversary-reviewer` sobre S8, y aplica a las tres reglas del archivo**, no sólo a la nueva: `storefront-tradein-rl` (`/api/tradein`, 5 req / 600 s), `storefront-track-rl` (`/api/track`, 60 / 60) y `chatbot-rl` (`/api/chat`, 20 / 600) usan las tres `keys: ["ip"]` con condición `path eq` y **sin condición de método**. **Dos consecuencias medidas:** (a) bajo **CGNAT móvil** varias personas detrás de la misma IP del carrier comparten el cupo, y el `deny` devuelve un **403 de plataforma de Vercel** —no la `/canje/reintentar` que la app diseñó—, así que **el canje se pierde en silencio** y el reseller no se entera; (b) un `<img src="https://{slug}.maat.work/api/tradein">` en cualquier página quema el cupo del visitante con un `GET`, **antes de que llegue al formulario**. **Por qué NO se parcheó en S8, y el motivo va escrito porque es la decisión:** aplica igual a las tres reglas, así que arreglar sólo la nueva sería tapar sin cerrar; la mitad del método necesita **extender el modelo de condiciones de `guard-firewall.sh`**, con sus propios fixtures de polaridad (regla de método vigente: un gate que nunca se vio fallar no es un gate); y sumar `ja4` a las claves es un **trade-off medido, no un free win** — ayuda al visitante real detrás de CGNAT y **afloja** contra un abusador que rota fingerprint TLS. Media decisión metida en el commit de S8 habría sido peor que la fila | `config/firewall-rules.json` (las tres reglas) · `scripts/guard-firewall.sh` (el modelo de condiciones que habría que extender) · `apps/web/app/(storefront)/s/[slug]/canje/reintentar/page.tsx` (la página que el 403 de plataforma NO muestra) |
| T39 | `accepts_trade_in` no tenía UI de edición | **done** · 2026-09-04 | `app-agent` (`apps/web/app/(app)/**`) | — | El dueño puede prender o apagar el canje desde `/app/ajustes`; la Server Action valida el formulario, persiste el flag con filtro de tenant e invalida la vidriera. La aceptación S12 recorre el guardado desde el panel hasta el host público; el contrato server-side queda en `settings-schema.ts` y `update-settings.ts` | `apps/web/app/(app)/app/(panel)/ajustes/settings-form.tsx` · `apps/web/app/(app)/app/(panel)/ajustes/actions.ts` · `apps/web/app/(app)/_lib/tenants/update-settings.ts` · `e2e/s12-onboarding-primer-equipo-publicado.spec.ts` |
| T40 | `readBody()` aplicaba el techo después de bufferizar el cuerpo completo | **done** · 2026-09-04 | `storefront-agent` (`apps/web/app/(storefront)/**` por §4) | — | `readBody()` rechaza un `Content-Length` numérico sobredimensionado antes de leer y limita el stream por chunks, cancelándolo al superar 6144 caracteres. `route.test.ts` cubre header sin consumo, overflow chunked con cancelación y body válido; `bash scripts/accept-s8.sh` sigue en verde | `apps/web/app/(storefront)/s/[slug]/api/tradein/route.ts` · `apps/web/app/(storefront)/s/[slug]/api/tradein/route.test.ts` · `_lib/tradein-form.ts` |
| T41 | el comando de aceptación **muta `istock_dev`** cuando `DATABASE_URL` está sin setear: un gate que escribe en la base de desarrollo del que lo corre | todo | **LEAD** (`scripts/**` y `scripts/probes/**` por §4) | — | **Lo levantó `app-agent`.** `scripts/probes/s8-canje.test.ts:59` cae a `postgresql://{usuario}@localhost:5432/${process.env.ISTOCK_DB ?? 'istock_dev'}` cuando no hay `DATABASE_URL`, y la probe **escribe**: crea tenants, leads y unidades, y provoca rechazos a propósito. **No es exclusivo de S8** —la probe de S8 heredó el fallback—, y por eso la fila es de la clase y no del archivo: el que corre un `accept-*.sh` para verificar no espera que le muevan la base con la que está trabajando. **Lo que hace peor al síntoma que al bug:** dos agentes midiendo contra la misma base de desarrollo es exactamente el escenario que `CLAUDE.md` §3 documenta para la trampa del `created_at` de Drizzle — dos mediciones distintas del mismo código y nadie mirando la base. **Lo que la fila NO decide:** si la salida es exigir `DATABASE_URL` (y fallar sin ella, que es la forma que este repo ya prefiere: *ausencia de medición es FAIL, nunca PASS*), o sembrar en una base efímera por corrida | `scripts/probes/s8-canje.test.ts:59` · `scripts/accept-s8.sh` (V5, que la invoca) · `scripts/pg-local.sh` |
| T42 | el paquete de `qa-agent` que salió de S8: tres ítems, **pendiente de despachar** | todo · **no despachado** — no cuenta como `doing` porque nadie lo está escribiendo | `qa-agent` (`tests/**` por §4) | — | **Van juntos porque salieron de la misma pasada, no porque sean el mismo bug.** (1) **La fragilidad de `readMatchers()`**: un `]` adentro de un comentario **dentro** del array `matcher` trunca la lista parseada — es **T7**, que ya existe y que S8 volvió a tocar de cerca al agregarle una entrada al matcher, así que ahora tiene un tercer testigo y sigue sin arreglo. (2) **La carrera de dos conexiones**: el pool del panel es `max: 1`, así que un `Promise.all` **serializa** y el test que cree estar probando concurrencia está probando dos llamadas en fila — el guard de `accept_dos_veces_una_unidad` está medido por la probe del LEAD contra Postgres real, pero el test del paquete no lo prueba por el motivo que dice probarlo. (3) **La probe de `REVOKE` sobre `offer_usd`**: hoy V1 de `accept-s8.sh` afirma el `GRANT` **leyendo el `.sql`**, y no existe nada que mida contra la base que el privilegio **no** esté | `apps/web/proxy.ts` + el parser de matchers (T7) · `apps/web/app/(app)/_lib/tradein/accept-to-stock.test.ts` · `scripts/accept-s8.sh` V1 · `tests/rls-cross-tenant.test.ts` |
| T43 | **§8 — la PII del visitante no tenía test de fuga.** Primera PII de un tercero del producto, entra sin login, y nada *probaba* que no llegara a `packages/ai` ni a un log | **done** · 2026-08-28 | `qa-agent` (`tests/**` por §4). **El dueño lo asignó el LEAD**, no este board: la fila estuvo `sin asignar` a propósito porque `docs-keeper` no inventa una decisión de ownership. El corte, escrito: el test cruza `packages/ai`, `apps/web` y `tests/`, y por §4 **lo que cruza un límite es de `qa-agent`** | — | **`tests/la-pii-del-visitante-no-sale-de-la-fila-del-canje.test.ts` · 16 casos · verde.** El LEAD no lo dio por bueno leyendo el reporte: **mutó el handler real** para ver el test encender con un mensaje que nombra `archivo:línea`, y revirtió byte a byte. **Lo que hay que llevarse de esta fila no es que se cerró, es cómo: el test no busca los NOMBRES `customer_name`/`customer_wa_phone` en los sinks, busca por FORMA.** Adentro del perímetro del canje, a un sink (`console.*`, `logEvent`, `logError`, Sentry, PostHog, `JSON.stringify`, `fetch`, `new *Error`, el `metadata:` de `listing_events`) sólo le puede llegar un literal, una constante literal del módulo, o un identificador cuya **cola** matchee `SAFE_ATOM` (`*Id`, `id`/`ids`, `status`, `kind`, `source`, `slug`, `code`, `event`, `count`, `ok`, `level`). Un identificador pelado, un spread, una llamada anidada o un template con una sustitución que no sea de esa lista: rojo. **Un test que grepea nombres lo esquiva cualquiera que escriba `log(lead)` o `JSON.stringify(lead)` — y ése es el caso que va a pasar, porque nadie loguea un campo de PII a propósito: loguea el objeto, para debuggear un 500.** Uno que exige forma no se esquiva renombrando la variable. **Y la distinción que justificaba la fila sobrevive:** hasta este test lo único que había era la medición limpia del `adversary-reviewer`, y **medido no es testeado** — una medición dice cómo está el árbol hoy y no sobrevive al `console.error(body)` de mañana. **Ocho fugas plantadas** (una por forma) más un control negativo con la forma **real** del `logEvent` de `accept-to-stock`, porque un analizador con falsos positivos se apaga. **Precio declarado:** el análisis es sintáctico, sin type checker — conservador adentro del perímetro y ciego afuera, y la ceguera de afuera se compensa censando `import`s. **Lo que esta fila NO cerró:** `Q5` de `PRODUCT.md` (quién responde por esa base) sigue abierta y es producto, no test | `tests/la-pii-del-visitante-no-sale-de-la-fila-del-canje.test.ts` · `apps/web/app/(storefront)/s/[slug]/api/tradein/route.ts` · `apps/web/app/(app)/_lib/tradein/accept-to-stock.ts` · `apps/web/app/(app)/_lib/log.ts` (`FORBIDDEN_FIELD`, la otra capa) · **ADR-026** |
| S8.1 | la policy de INSERT de `tradein_leads` no miraba `accepts_trade_in`, no se registraba que una unidad venía de un canje, y la base admitía un lead `accepted` sin unidad | **done** · 2026-08-28 · migración `0009` | `db-agent` (`packages/db/**` por §4) · gate del **LEAD** | — | **`packages/db/drizzle/0009_tradein_accepts_and_acquisition_channel.sql`, más `scripts/guard-tradein-engine.sh` (LEAD) que lo censa, más **V6** de `accept-s8.sh` que lo llama. Las tres cosas del encargo entraron; **una entró distinta, y `db-agent` tuvo razón en desobedecer**.** **(1) `accepts_trade_in` adentro de la policy:** hecho, vía `ALTER POLICY` — **el primer `ALTER POLICY` del repo**, y la forma correcta de cambiar un predicado ya aplicado sin editar la `0008` (`CLAUDE.md` §3: el migrador compara `created_at`, no el hash). El `where` del handler lo sigue chequeando: dos capas. **(2) `listings.acquisition_channel`:** hecho, enum `purchase`/`trade_in`/`other` con default `purchase` y **backfill** de las unidades que ya venían de un lead. Fuera del `GRANT` de columna de `anon`, así que nace invisible para la vidriera. **(3) El `CHECK` NO se puede escribir, y por eso es un `CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED`.** Un `CHECK` en Postgres no se difiere: se evalúa al terminar cada sentencia. `acceptToStock()` escribe el `status` **antes** que la unidad porque ese `update` **es** el guard de concurrencia (lleva `status <> 'accepted'` en el `where`) y moverlo quemaría un slug y un id por carrera perdida — o sea que un `CHECK` habría tirado `23514` en la **primera** sentencia, que `acceptToStock()` no atrapa: **aceptar un canje habría pasado a ser un 500.** El encargo estaba mal, no la implementación, y se escribe así para que la próxima persona que lea *"falta el CHECK"* en un doc viejo encuentre por qué no es un CHECK. **Cambio de comportamiento que sale de ahí:** ya no se puede borrar una unidad nacida de un canje aceptado sin resolver antes el lead (la FK es `ON DELETE SET NULL`). Hoy no rompe nada — no hay ningún borrado de `listings` en `apps/web` | `packages/db/drizzle/0009_tradein_accepts_and_acquisition_channel.sql` · `packages/db/src/schema/{tradein,listings}.ts` · `apps/web/app/(app)/_lib/tradein/accept-to-stock.ts` (§7, el `acquisitionChannel: 'trade_in'`) · `scripts/guard-tradein-engine.sh` + `.test.sh` · `scripts/accept-s8.sh` V6 · `docs/DOMAIN.md` §"Qué sostiene el motor" |
| T44 | **un prefijo pertenece a un solo documento.** `P<n>` vivía en `PRODUCT.md` y en `SLICE_BOARD.md` a la vez | todo · **la instancia está cerrada** (la serie de `PRODUCT.md` es `Q` desde el 2026-08-28); lo que queda abierto es que **nada impide la próxima colisión** | **LEAD** (la convención de numeración es de quien ratifica el board y las ADRs) | — | **La instancia costó una confusión antes de cerrarse**, que es el único motivo por el que la clase merece fila. `PRODUCT.md` numeraba sus preguntas abiertas `P1…P5` y el board tiene su propia serie `P1…P5`: `P5` significaba dos cosas distintas —la PII del visitante en un doc, `offer_usd` y el rol `seller` en el otro— y las dos estaban abiertas al mismo tiempo. **El desempate lo dio un censo, no una preferencia:** de las ~70 citas de la clase `P<n>` en el repo, **todas las que viven en gates y en comentarios de código apuntan a la serie del board** (`accept-s3.sh`, `accept-s8.sh`, `rls-cross-tenant.test.ts`, `proxy-matcher-*.test.ts`), así que renumerar el board habría roto citas ejecutables y renumerar `PRODUCT.md` no rompió ninguna. **Lo que la fila pide decidir y escribir:** qué serie vive en qué archivo, y que **la próxima serie nueva se elija censando las existentes, no de memoria** — que es exactamente lo que no pasó. Hoy hay al menos **seis** clases conviviendo (`S<n>` slices, `T<n>` FASE 4 bis, `P<n>` board, `Q<n>` PRODUCT, `C<n>` condiciones de costo en `COST.md`, `R<n>`/`U<n>`/`D<n>`/`M<n>`/`W<n>` en `TEST_MATRIX.md` y los lints) y ninguna está declarada en un solo lugar — la de `COST.md` la encontró este mismo lote, buscando otra cosa, que es la forma en que se encuentran todas. **Es censable en un comando**, que es la vara que `CLAUDE.md` §4 ya usa para los gates | `docs/PRODUCT.md` (§"Preguntas abiertas", la nota del rename) · `docs/SLICE_BOARD.md` (serie `P` y serie `T`) · `docs/TEST_MATRIX.md` (las series de test) · `docs/INDEX.md` (donde iría la tabla de prefijos) |
| T45 | **la parte B de la `0009` —`accepted` ⇒ unidad creada— no tiene auditoría cruzada en `tests/`** | todo | `qa-agent` (`tests/**` por §4) | — | **Lo levantó `qa-agent` sobre su propia carencia y NO lo agregó de motu proprio, que estuvo bien**: es la fila la que decide, no el agente que la encuentra. **Qué cubre hoy el invariante, censado:** el test unitario de `db-agent` (su paquete), el test de `app-agent` (su columna) y el grep de `scripts/guard-tradein-engine.sh` sobre el `.sql`. O sea **los dos writers del código y una afirmación de forma** — y nadie mirándolo desde afuera contra Postgres real. Es la asimetría que `CLAUDE.md` §4 nombra: *la auditoría de referencia de un invariante no puede ser del writer que lo implementa*, y acá el invariante más caro de la parte B —**no existe un canje aceptado sin la unidad que lo justifica**— no tiene ninguna. **Los cinco casos ya están medidos en el header de la migración** (orden real de `acceptToStock()` → COMMIT; sólo `status` → `23514` al commit; insert de la vidriera → no dispara; borrar la unidad de un canje aceptado → `23514`; aceptar y borrar el lead en la misma transacción → COMMIT), así que lo que falta no es descubrirlos: es que los afirme alguien que no sea el que los escribió. **Ojo con el desempate de §4:** el test del paquete de `db-agent` **se queda** — la duplicación es deliberada, la de `tests/` es la de referencia, y si divergen gana la de `tests/` | `packages/db/drizzle/0009_tradein_accepts_and_acquisition_channel.sql` (§4, los cinco casos medidos) · `tests/rls-cross-tenant.test.ts` (donde vive R2c) · `scripts/guard-tradein-engine.sh` (lo que hay hoy) |
| T46 | **`TODO: después el RLS` / `TODO: después R2` es la única prohibición de `CLAUDE.md` §2 sin test ni lint** | todo | **LEAD** (es una regla de lint, y los gates son suyos por §4) | — | **§2 tiene trece prohibiciones. El censo es del LEAD: doce tienen dueño y ésta no.** Las que `docs-keeper` pudo verificar contra el árbol, para que la fila no obligue a re-derivarlas: `console.log` de un listing → `S4` de `TEST_MATRIX.md`; IMEI/`cost_usd`/`margin`/`internal_notes` en un DTO público → `S1`/`S2` + R7/R7c; query sin filtro de tenant → `W015` de `web-lint`; secret en el bundle → `S3`; `tenant_id` en `user_metadata` → lint `0015`; rate limit en Postgres sobre la vidriera → `W016`; tabla sin `GRANT` → `guard-grants.sh`; original en bucket público, URL con `tenant_id`, borrado por key en R2 → `guard-r2.sh` y `guard-leaks.sh`. **Ésta no la mira nadie**, y es la que más barato es escribir y más caro es descubrir tarde: un `TODO: después el RLS` commiteado es exactamente la forma en que *"sin RLS no hay merge"* se convierte en una costumbre. **Y ya hay precedente de que el gate obvio sale mal:** `SLICE_BOARD.md` §"Seis gates rojos o dormidos" registra que una regla del `TODO` **estuvo verde por vacío desde S1 porque no podía disparar nunca**. O sea que la fila no es *"escribir un grep"*, es *"escribir un grep y verlo encender"* — regla de método vigente | `CLAUDE.md` §2 · `apps/web/scripts/web-lint.mjs` (donde viviría) · `docs/TEST_MATRIX.md` §"Seguridad" · `SLICE_BOARD.md` §"Seis gates rojos o dormidos" (el precedente del gate vacío) |
| ~~T47~~ | **comentario de `matcher` desactualizado** | **done** · 2026-09-04 · severidad baja | `storefront-agent` (`proxy.ts` por §4) · verificación del LEAD | — | El comentario que atribuía al guard un parser no-goloso fue reemplazado por la descripción real: el escáner cuenta profundidad y saltea comentarios y literales; si el array no cierra, falla explícitamente. La fragilidad histórica como clase sigue cubierta por `T7`; esta instancia de documentación quedó cerrada sin cambiar el matcher ni su comportamiento | `apps/web/proxy.ts` (`config.matcher`) · `tests/proxy-matcher-no-deja-la-vidriera-sin-vigilar.test.ts` (`parseMatcherArray`) · `T7` |
| T48 | **el header de `packages/db/drizzle/0009_...sql` se autotitulaba `S9`, y `0009` es la fila `S8.1`** | **done** · commit `733eda2` · **verificada por el LEAD** | `db-agent` (`packages/db/**` por §4 — **`docs-keeper` no lo arregla: es su columna**) | header `0009 · S8.1`; el SQL sin comentarios conserva el mismo hash que su padre; commit sin errores de whitespace | La primera línea del header en `HEAD` dice `0009 · S8.1`. El cambio fue sólo comentario: el hash semántico sin comentarios es `b214d554…` antes y después. `S9` sigue siendo la slice de *copy list para estados de IG/WA* y no se mueve. | `packages/db/drizzle/0009_tradein_accepts_and_acquisition_channel.sql` · header `0009 · S8.1` · commit `733eda2` |
| T49 | **el soft cap del chat es una cuota compartida entre el comprador real y quien la queme** | todo · **abierta** · no bloquea nada hoy: `chatbot-rl` sigue en `planned` y `/api/chat` no existe. **Aterriza con FASE 5** | `ai-agent` (`packages/ai/**` por §4) para la **forma del contador** · la **política** es del **LEAD** | — | **`SOFT_CAP_MESSAGES_PER_TENANT_PER_DAY = 40` es por tenant, no por sesión ni por IP** (`packages/ai/src/entitlement.ts`, fijado en `entitlement.test.ts` por `expect(SOFT_CAP_MESSAGES_PER_TENANT_PER_DAY).toBe(40)`). Con `chatbot-rl` tal como está — 20 req / 600 s por IP, `config/firewall-rules.json` — **una sola IP agota los 40 mensajes del día de un tenant en veinte minutos** y le deja el chatbot mudo al reseller por el resto de la jornada: gratis, sin violar ninguna regla, y sin que ninguna alarma suene. **No es un agujero de costo:** por encima del cap el chat devuelve handoff con `provider: 'none'`, o sea cuesta cero. Es un **agujero de disponibilidad de la feature que el plan Negocio cobra**. **El arreglo no es apretar el WAF, y eso está evaluado y descartado por el LEAD:** bajar a 10/600 s corta a un comprador real en la pregunta 11, y un comprador informado que abre WhatsApp **es** el producto — se prefiere la falla barata sobre la cara, igual que en la excepción del cron. **El arreglo es que el contador distinga sesiones, y esa decisión todavía no está tomada.** Es fila de board, no número de WAF | `packages/ai/src/entitlement.ts` (`SOFT_CAP_MESSAGES_PER_TENANT_PER_DAY`) · `packages/ai/src/chat.ts` · `softCapReached` (donde el turno se corta) · `config/firewall-rules.json` (`chatbot-rl`, su `why` lo explica entero) · `docs/COST.md` §2.6 y `C1` |
| T50 | **el techo de llamadas facturadas por turno era 4, y no lo decía ni una constante ni un test** | **done** · 2026-08-28 · commit `89ab7c0` · alias `C11` de `COST.md` · **el LEAD re-ejecutó la verificación** (la mutación de abajo, no una lectura) · cerrada junto con `S8.2`, que era el segundo ítem del **mismo** encargo: una entrada de `doing`, dos filas (ver §Estados) | `ai-agent` (`packages/ai/**` por §4) · ratificó el LEAD | — | **Origen: `cost-auditor`, `docs/COST.md` §2.8.3. El techo quedó en 3, y lo que importa de esta fila no es el número: es que dejó de ser un número suelto.** Qué hay en el árbol, **citado por símbolo** (`CLAUDE.md` §5): `MAX_TOOL_ROUNDS = 1` → `TURN_ROUNDS = 1 + MAX_TOOL_ROUNDS` → **`MAX_BILLED_CALLS_PER_TURN = TURN_ROUNDS + 1`**, los tres en `packages/ai/src/chat.ts` y el último exportado por `index.ts`; la palanca que baja 4 → 3 es `skipPrimary`, *un primario que ya contestó un 200 vacío no se reintenta en el mismo turno* — el argumento no es el ahorro sino que el prompt de la ronda 2 **contiene** al de la ronda 1, así que reintentar es la misma pregunta, no una segunda chance (mensaje de `89ab7c0`). **La lección es el cambio de FORMA y es lo que hay que leer, porque el número se olvida y el patrón vuelve:** la primera versión de `ai-agent` puso la constante **al lado** de `MAX_TOOL_ROUNDS` y su docblock afirmaba que eso la protegía. **Co-locar dos constantes no crea una dependencia entre ellas.** Lo falsificó el LEAD mutando `MAX_TOOL_ROUNDS = 1 → 2`: con la versión co-locada el único rojo era un test **viejo** sobre rondas de tools (`chat.test.ts` · `describe('tools desde el orquestador')`) — justo el que va a actualizar quien sube ese número a propósito —, y después la constante quedaba silenciosamente mal mientras `docs/COST.md` seguía multiplicando por una cifra muerta. **Es `T43` otra vez, un nivel más arriba: un test que atrapa un drift de casualidad no es un gate contra ese drift.** Con la constante derivada, la **misma** mutación produce **4 fallos, 3 de ellos en la sección propia del techo** (`chat.test.ts` · `describe('el techo facturable del turno')`): el peor caso, que ahora ejerce `MAX_TOOL_ROUNDS` rondas **de verdad** vía `Array.from` en vez de una fija; `expect(MAX_BILLED_CALLS_PER_TURN).toBe(3)` en un `it` **aparte**, para que el fallo del anterior no lo tape; y el mecanismo del salteo. Las dos derivas son distintas y hacen falta las dos aserciones: un **tercer fallback** mueve el peor caso sin mover la constante; una **ronda de más** mueve las dos. **Árbol verde en el commit, medido por el LEAD:** typecheck 0 · lint 0 · test 0 · **2572 tests** (domain 201 · media 164 · ai 572 · db 439 · `apps/web` 778 +4 skipped · `tests/` 418). **Lo que esta fila NO cierra, dicho para que no se lea como cerrado:** (a) `docs/COST.md` sigue costeando el chat con **4** llamadas en once lugares — fila **`T54`**, y es de `cost-auditor`, no de esta fila ni de `docs-keeper`; (b) **`T51` sigue abierta**: exportar la constante del techo no es emitir la medición del turno, y sin log nadie sabe cuántos turnos llegan al techo de verdad | **citado por símbolo** (`CLAUDE.md` §5 — esta celda tenía seis citas `:NNN` y `3710b7c` las corrió todas): `packages/ai/src/chat.ts` · `MAX_TOOL_ROUNDS` · `TURN_ROUNDS` · `MAX_BILLED_CALLS_PER_TURN` · `skipPrimary` y su docblock · `packages/ai/src/chat.test.ts` · `describe('el techo facturable del turno')` (la sección del techo, con el literal `3` aserido aparte) y `describe('la cota de la dieta y la factura son dos números distintos')` (por qué literal y no constante a secas) · `packages/ai/src/index.ts` (el export) · commit `89ab7c0` · `docs/COST.md` §2.8.3 y `C11` (**desactualizado**, ver `T54`) |
| T51 | **`billed` se calcula y no lo emite nadie** | todo · **la fila ENCOGIÓ el 2026-08-28 y volvió a ser su enunciado original**: las dos cosas que le habían crecido encima están cerradas — la condición de alarma la **arbitró el LEAD** (`CLAUDE.md` §5) y la medición que se perdía la **arregló `ai-agent`** (`3710b7c`) · alias `C10` de `COST.md` | `app-agent` (`apps/web/app/api/**` y `(app)/**` por §4) | **FASE 5**: `/api/chat` no existe (censado el 2026-08-28: `apps/web/app/api` tiene `cron`, `health` y `tenants`; `answerChat` no tiene un solo llamador fuera de `packages/ai/src`). **Y ahora es lo único que falta** | **Origen: `cost-auditor`, `docs/COST.md` §2.8, alias `C10`.** `ChatAnswer.billed` existe, dice la verdad, y **no lo lee nadie**. **Contra qué se escribe el emisor — lo arbitró el LEAD el 2026-08-28 en `CLAUDE.md` §5, «Una alarma se verifica en las dos polaridades, igual que un gate», y de ahí hay que leerlo:** tres condiciones con tres trabajos en vez de un umbral haciendo tres mal — **`billed.primaryServedEmpty`** = degradación (*el primario cobró y no dio nada*) · **`handoff === 'provider_down'`** = turno quemado · **`calls > MAX_BILLED_CALLS_PER_TURN`** = aserción de **control de flujo**, no alarma de costo. **`calls > 2` está muerto:** fallaba en las dos direcciones —por arriba encendía con tráfico legal (el techo es 3 desde `T50`), por abajo no veía el turno quemado, que reportaba `calls: 0`—. **La segunda mitad de eso ya no es cierta, y es por qué la fila encoge:** `3710b7c` hizo que `generateWithFallback` **devuelva** la ronda fallada en vez de tirarla (`RoundOutcome` discriminado por `ok`, sin `throw` ni `catch`) y que `addBilled` corra **antes** de mirar si hubo respuesta, en los dos sitios; el turno quemado hoy reporta `calls: 2` o `3` según dónde murió, con `handoff: 'provider_down'`. **Lo que queda es lo que la fila siempre fue, ahora sin la excusa de que el dato no estaba: nadie emite.** El dato existe, es correcto, y no hay una sola línea de log | `packages/ai/src/chat.ts` — **citado por símbolo y no por línea** (`CLAUDE.md` §5, y esta celda tenía ocho citas `:NNN` que vencieron el mismo día): `ChatAnswer.billed` · `BilledUsage.primaryServedEmpty` · `MAX_BILLED_CALLS_PER_TURN` · `RoundOutcome` (su docblock explica por qué la ronda que falla se devuelve y no se tira) · `generateWithFallback` · `addBilled` · `apps/web/app/(app)/_lib/log.ts` (`logEvent`, el sink, con su denylist de PII) · **`CLAUDE.md` §5** (las tres condiciones) · `docs/COST.md` `C10` · filas `T50`, `T54` y `T55` |
| T52 | **el techo de 1200 tokens de entrada: 7 de las 9 degradaciones del corpus son la ficha del plan Negocio** | **`blocked` · decisión humana** · alias `C9` de `COST.md`, re-medido · **no es un `B<n>`**: no bloquea ninguna slice, ver la nota de §"Blockers abiertos" | **humano** (el 1200 es de su goal: `≤1200 in / ≤180 out`) · `ai-agent` (`packages/ai/**`) ejecuta **si** se decide moverlo | **decisión humana pendiente.** El código funciona hoy: no espera a nadie, degrada. **Pero la decisión hoy se tomaría sobre un corpus sintético:** lo que la vuelve decidible sobre fichas de tenants reales es **`T53`** (`C6`), y la mitad de `T53` que da ese dato espera **FASE 5** | **Origen: `cost-auditor`, `docs/COST.md` §2.8.4 y §2.8.5. Esta fila NO propone subir el techo: registra que hay una decisión abierta, con su precio medido.** Barriendo techos sobre el corpus de `packages/ai`, **1374 es el mínimo exacto que deja los 162 prompts armados sin degradar** — a 1350 degrada uno y a 1300 cuatro (`COST.md` §2.8.4), y **el LEAD barrió el borde por su cuenta el 2026-08-28, aparte de `cost-auditor`: a 1373 ya degrada uno.** O sea que el 1374 es exacto, no redondeado, y **dos mediciones independientes coinciden en él** — que es la única razón por la que este número se puede usar para decidir. Hoy, con `MAX_INPUT_TOKENS = 1200` (`packages/ai/src/budget.ts` · `MAX_INPUT_TOKENS`), **degradan 9 de 162, y 7 de esos 9 son la ficha del plan Negocio** —el tenant de USD 35—, que entra tirando **los 6 medios de pago y los 4 turnos de historial, o sea el historial entero**. **El que más paga es el único al que el chatbot se le olvida la conversación**, y le pasa justo en el turno en que el modelo pidió un dato para contestar mejor. **Precio de subirlo a 1374: entre USD 0,00047 y USD 0,0574/tenant/mes** contra una asignación de chat de USD 1,00 — entre 0,05% y 5,7%, **ruido en las dos ramas**. *(La rama cara decía **0,0731** y **7,3%** hasta `89ab7c0`, que bajó el techo de llamadas facturadas de 4 a 3: el número vigente es de `cost-auditor`, `docs/COST.md` §2.8.5 y `C9`, commit `84c2f4d`. **`docs-keeper` lo transcribe, no lo calcula.** La decisión no se movió; se movió el 21% de su rama cara.)* Y ahí está el punto: **si subir el techo cuesta ruido, el 1200 no se está pagando con plata, se está pagando con calidad, y una decisión que no se paga con plata no la puede arbitrar el auditor de costo.** `cost-auditor` declara explícitamente que **no tiene objeción a ninguna de las tres ramas** (subir el techo · achicar la ficha del Negocio · dejarlo como está), así que el que quiera sostener el 1200 no tiene que pelear contra ningún número. **Tres acotaciones que la decisión necesita — las dos primeras son números medidos, la tercera es qué instrumento falta:** (1) **1374 es un piso, no el número final** — sale de las fixtures del corpus, no de fichas reales; una descripción más larga o un cuarto punto de retiro lo suben, y `listing-view.ts` recorta la descripción pero **esa cota superior no está medida**; (2) **con 1374 el techo absoluto del chat queda en USD 0,6910 contra 1,00 — 1,45× de headroom**, así que esta fila se lee junto con `T50`: subir el techo es barato, subirlo *sin* haber clavado el de llamadas facturadas ya no tanto. **⚠️ El par que esta celda traía —USD 0,8795 y 1,14×— estaba VIEJO y a favor: se calculó con 4 llamadas facturadas por turno, y `T50` bajó el techo a 3 el 2026-08-28.** El par vigente (0,6910 · 1,45×) **no lo recalculó `docs-keeper`**: lo publicó `cost-auditor` en `docs/COST.md` §2.8.5, acotación 2, commit `84c2f4d`, y acá se **transcribe con su fuente**. **Sigue pendiente de `cost-auditor` y es `T54`:** §2.8.5 ya está re-medida, pero `COST.md` cita 4 llamadas en otros lugares, y hasta que `T54` cierre este número se re-verifica **contra §2.8.5**, nunca se recalcula en este board. (3) **`C6` antes que el techo, y ya tiene fila: `T53`.** No es orden de trabajo, es **qué información tiene el que decide**: el 1374 sale de cuatro fixtures y **hoy nada mide si una ficha real degrada**, porque el `ContextTrimReport` se construye y no lo lee nadie. **Decidir hoy es decidir sobre un corpus sintético** — rama legítima y con precio medido, pero conviene que sea elegida y no heredada. **Y el dato que cambia cómo se lee todo lo anterior, verificado en el archivo por `docs-keeper` y no citado de segunda mano: subir el techo NO es una variable de entorno, es un commit.** `packages/ai/src/env.ts` · `tokenCeiling` valida `LLM_MAX_INPUT_TOKENS` con un `.max()` contra la constante de `budget.ts`, y el mensaje de error dice literalmente *«la dieta se baja por env, nunca se sube»*. **Eso está bien y no es lo que hay que arreglar**: es la diferencia entre una perilla que alguien puede girar en producción y un número que se cambia con un diff revisado. Si la decisión es moverlo, lo que se toca es `budget.ts` | **citado por símbolo** (`CLAUDE.md` §5): `packages/ai/src/budget.ts` · `MAX_INPUT_TOKENS` (= 1200) · `packages/ai/src/env.ts` · `tokenCeiling` (el `.max()` y su mensaje) · `packages/ai/src/context.ts` · `buildChatContext` (donde se aplica el límite) · `packages/ai/src/listing-view.ts` (el recorte de la descripción, cota superior **sin medir**) · `docs/COST.md` §2.8.4, §2.8.5 y `C9` · `docs/CHATBOT.md` (la dieta) · fila `T50` |
| T53 | **nadie cuenta cuándo la dieta se cae: el `ContextTrimReport` se construye y no lo lee ningún consumidor — y es lo que hace DECIDIBLE a `T52`** | todo · alias `C6` de `COST.md` · **es la fila de la que cuelga `T52`**, no al revés | `ai-agent` (`packages/ai/**`) la mitad que se puede hacer hoy · `app-agent` (`apps/web/app/api/**` y `(app)/**`) la de producción — los dos por §4 | la mitad de producción espera **FASE 5**: `/api/chat` no existe (mismo censo que `T51`). **La mitad del corpus no está bloqueada por nada.** Y ojo con el eco de `T51`, que ya hizo despachar trabajo inexistente una vez: **el campo YA está expuesto** —`index.ts` exporta `buildChatContext` y `type ContextTrimReport`, y `ChatAnswer.trimmed` viaja en la respuesta—, así que lo que falta no es exponer, es **contar** | **Origen: `cost-auditor`, `docs/COST.md` §2.8.5 punto 3 y la tabla de `C6`.** `buildChatContext` arma un `ContextTrimReport` en cada turno —qué se tiró para que el prompt entrara en el techo— y **no lo lee ningún consumidor**: censado contra HEAD `6aea02b`, cero llamadores de `.trimmed` fuera de los tests del propio paquete. **Por qué esta fila no es higiene ni prerequisito de proceso —lo corrigió el LEAD al despacharla, y la corrección es la fila—: `C6` es lo que hace DECIDIBLE a `T52`.** El **1374** sale de **cuatro fixtures**, no de fichas de tenants reales, y hoy **no existe forma de saber si una ficha real degrada**, porque el único instrumento que lo diría se construye y se tira. Traducido: **si el humano decide el techo hoy, lo decide sobre un corpus sintético; con `C6` lo decide sobre sus propios tenants.** **Y hay que decir qué compra cada mitad, porque no compran lo mismo:** **(a)** contar la degradación sobre el corpus vive adentro de `packages/ai` y se puede hacer **ya** — compra convertir *«9 de 162, 7 la ficha del plan Negocio»* de **medición de una tarde** en **afirmación que se pone roja sola**, y el board ya tiene el precedente escrito en `T43`: **medido no es testeado**; **(b)** la que contesta *«¿degradan las fichas de MIS tenants?»* es la emisión al log en producción, y **ésa espera FASE 5**, exactamente como `T51`. **Dos números que explican por qué el contador importa más que el número del techo, los dos medidos por `cost-auditor`:** entre §2.7 y §2.8 —**el mismo día**, sin que nadie tocara `budget.ts`— el peor prompt sin degradar pasó de **1251 a 1374**, o sea que **la variable se mueve sola**, empujada por fixtures y por features, y un techo elegido sin contador te deja en el mismo lugar la próxima vez que la ficha crezca 200 tokens. Y hoy degradan **9 de 162 prompts armados, 7 de ellos la ficha del plan Negocio**: el tenant de **USD 35 es el que más pierde**, que es lo que hace que esto sea calidad y no ruido. **Lo que esta fila NO decide:** qué se hace con la cuenta una vez que exista —umbral, alarma, o gate de la eval— no está decidido, y `docs-keeper` no lo cierra | `packages/ai/src/context.ts` · `ContextTrimReport` y `buildChatContext` (donde se arma) · `packages/ai/src/chat.ts` · `ChatAnswer.trimmed` (que ya viaja en la respuesta) · `packages/ai/src/index.ts` (**ya lo exporta: falta el consumidor, no el export**) · `apps/web/app/(app)/_lib/log.ts` (`logEvent`, el sink de la mitad (b)) · `docs/COST.md` `C6` y §2.8.5 punto 3 · filas `T52` (la decisión que esto vuelve decidible) y `T51` (misma forma, mismo bloqueo) |
| T54 | **`docs/COST.md` costea el chat con el techo de 4 llamadas, y el árbol factura 3 desde `89ab7c0`** | todo · **detectado, no arbitrado** · sale de cerrar `T50` | `cost-auditor` (`docs/COST.md` por §4 — **`docs-keeper` no lo escribe**) | — | **Es drift entre dos documentos, y se registra sin tocar el archivo ajeno.** `T50` cerró bajando el techo estructural del turno de **4 a 3** y derivándolo de `MAX_TOOL_ROUNDS`; `COST.md` todavía multiplica por 4 en **once** lugares — §2.8.3 y el bloque de cálculo (`:2569`, `:2573`, `:2579`, `:2664`, `:2687`), la tabla de márgenes de §1 (`:90`, `USD 0,833` *«las 4 llamadas de §2.8.3»*), `:28`, `:103`, `:209`, `:1921` y el escenario de abuso de `:1984` (*«a 4 llamadas por turno esa misma IP…»*). **No es cosmético en dos de esos once:** el margen del plan Negocio y el escenario de una IP que agota el soft cap son **peores de lo que el código hoy permite**, así que la corrección va a favor del producto, y el número que `T52` usa para decidir (**1,14× de headroom con el techo de 1374**) se movió. **Qué NO afirma esta fila:** que `COST.md` esté mal *ahora mismo*. La medición es contra el archivo en `6aea02b`, y **`cost-auditor` estaba escribiendo el archivo cuando esto se anotó** (2026-08-28), así que puede estar cerrada antes de leerse. **La cierra quien verifique el archivo, no esta lectura.** Se anota igual porque un drift entre el costeo y el código que no está escrito en ningún lado es exactamente el modo en que `COST.md` deja de ser confiable sin que nadie se entere | `docs/COST.md` §1 (tabla de márgenes), §2.8.3 y `C11` · `packages/ai/src/chat.ts` · `MAX_BILLED_CALLS_PER_TURN` (el techo real) · fila `T50` |
| T55 | **una cita `archivo.ts:NNN` en `docs/**` envejece sola, y nada la cuenta: tres agentes distintos dejaron citas vencidas en una sola sesión** | todo · **la clase la cerró el LEAD en `CLAUDE.md` §5** («Un doc cita el símbolo, no el número de línea»); lo que falta es el gate que la haga fallar sola | **LEAD** (`scripts/**` por §4 — y por el motivo de fondo: **el gate no puede ser del writer que audita**, y acá los auditados son `docs-keeper`, `cost-auditor` y `researcher`, o sea los tres dueños de `docs/**`) | — | **La evidencia, y es de un solo día: 2026-08-28, tres tandas, tres agentes, la misma sesión.** `cost-auditor` citó `chat.ts:284-286`, el LEAD citó `:338` y `docs-keeper` citó ocho líneas (enumeradas en `CLAUDE.md` §5). **Las tres tandas eran correctas al escribirse** y las tres quedaron apuntando a texto ajeno **antes de terminar la sesión**, porque `ai-agent` estaba editando el archivo. Tres instancias con tres autores y cero descuidos es la firma de una **propiedad del formato**, no de un error de nadie — el mismo argumento del que nacieron `T28` y `T30`. **Qué tendría que afirmar el gate (la implementación es del LEAD y esta fila NO la propone):** **(1)** censar `docs/**` entero —incluidos `docs/research/**` y `docs/COST.md`, que no son de `docs-keeper`— buscando referencias a código; **(2)** que cada referencia esté **anclada en un símbolo que exista en el archivo citado**, que es la afirmación gate-able porque se resuelve con un `grep`; **(3)** que un número de línea suelto, sin símbolo al lado, **rompa** — la regla de `CLAUDE.md` §5 no es *«nunca un número»* sino *«no un número solo»*, así que `chat.ts` · `addBilled` · `~:500` pasa y `chat.ts:500` no; **(4)** que el archivo citado exista, que es el phantom-file guard aplicado a una cita; y **(5)** que **un hash de commit citado sea alcanzable desde `main`** — es la segunda forma de la misma clase, agregada por el LEAD en `CLAUDE.md` §5 después de producirla él: enmendó `9d5d20a` y quedaron tres citas al sha muerto. **La agravante es cómo falla:** `git cat-file -t 9d5d20a` contesta `commit` porque el objeto sigue vivo en el reflog de quien enmendó, así que la cita se verifica perfecto en la máquina donde se rompió y muere en un clon o en el primer `gc`. La pregunta correcta es `git merge-base --is-ancestor <sha> main`, y es **más barata de chequear que (2)**. Corolario para el arnés: la polaridad de (5) no se puede escribir con un sha inventado —`cat-file` lo rechaza por otro motivo y el fixture pasaría por la razón equivocada—, hace falta un commit real fuera de `main`. **Y dos condiciones de forma que el board ya aprendió a pedir:** **polaridad** —tiene que encender con una cita huérfana y callar con una anclada, porque una alarma verificada en una sola dirección es independiente de lo que dice medir (`CLAUDE.md` §5, la sección de arriba)— y **exención escrita**, en el idioma de `web-lint:sin-tenant`: una cita que legítimamente no tiene símbolo se declara con motivo, porque la alternativa a una exención escrita no es *«sin exención»*, es la exención invisible. **Lo que el gate NO puede afirmar, y es por qué la regla cambió en vez de agregar disciplina:** que el **número** sea correcto. Un doc y el árbol se mueven por separado, así que un gate sobre el número estaría verde el día que se escribe y rojo al día siguiente **sin defecto**; el símbolo sobrevive a que le agreguen 40 líneas arriba. **Quién arregla lo que el gate marque:** el owner del archivo por §4, no el LEAD. **Tamaño real de la deuda, censado por `docs-keeper` el 2026-08-28 y NO estimado:** un `grep -roE` sobre `docs/*.md` por *backtick · path con extension de codigo · dos puntos · digitos · backtick* daba **241 citas fuera de `COST.md`**, no las ~20 con las que se despachó el encargo — el censo del que salió el 20 se comía los paths con paréntesis de route group y por eso no veía a `(storefront)/_lib/listings.ts` ni al grueso de `SLICE_BOARD.md`. Quedan convertidas `ARCHITECTURE.md`, `DOMAIN.md`, `TEST_MATRIX.md` e `INDEX.md` (**cero**); **siguen abiertas `SLICE_BOARD.md` (~150) y `DECISIONS.md` (~30)**, que son encargo aparte porque cada cita hay que medirla contra el árbol antes de convertirla. **El gate se escribe contra el número real, no contra el 20** | **`CLAUDE.md` §5, «Un doc cita el símbolo, no el número de línea»** (la regla y las tres tandas enumeradas) · `docs/**` (el censo) · `scripts/**` (el gate, del LEAD) · `.github/workflows/ci.yml` (por `G4` de `guard-gates.sh`: un gate que no corre no protege nada) · filas `T28` y `T30` (la misma forma: una clase que se recordaba en vez de censarse) · fila `T51` (el caso que la disparó)  <!-- t55-hash-exento: esta fila describe el modo de falla que C2 detecta y el sha enmendado es su espécimen; reemplazarlo por uno vivo volvería falsa la oración que explica por qué cat-file contesta commit --> <!-- t55-cita-exenta: las dos citas de esta fila son especimenes exhibidos de la forma mala, igual que su sha enmendado: se muestran para explicar que un numero de linea solo no pasa, y nunca se van a arreglar --> |
| T56 | **`DEMO_TENANT_SLUG` era un segundo literal `'demo'` en `apps/web`; su casa canónica es `packages/domain`, al lado del Set que lo protege** | **done** · commit `733eda2` · **verificada por el LEAD** · **pedido de `storefront-agent` a otra columna, salido de S13** | `domain-agent` (`packages/domain/**`) + `storefront-agent` (consumidor en `(storefront)`) | `pnpm --filter @istock/domain exec vitest run src/reserved-slugs.test.ts` → **24/24** · `pnpm --filter @istock/web exec vitest run 'app/(storefront)/demo.test.ts'` → **18/18** · `bash scripts/guard-gates.sh` → **PASS** | `HEAD` exporta `DEMO_TENANT_SLUG` desde `packages/domain/src/index.ts` y `(storefront)/_lib/host.ts` lo importa; los dos Sets se derivan de esa constante. `guard-gates.sh` también verificó **37 scripts auditados**, **7 gates de paquete**, **35 gates de `scripts/`** y **10 probes**. | `packages/domain/src/reserved-slugs.ts` · `packages/domain/src/index.ts` · `apps/web/app/(storefront)/_lib/host.ts` · `packages/domain/src/reserved-slugs.test.ts` · `apps/web/app/(storefront)/demo.test.ts` · commit `733eda2` |
| T57 | **el import CSV no es idempotente si se sube dos veces el mismo archivo** | todo · pendiente de diseño, no parte de S10 | `db-agent` | **Pregunta abierta:** definir la clave persistida del import y su semántica; después, test contra Postgres real que entregue el mismo archivo dos veces y compruebe que no duplica unidades ni eventos | S10 deja explícito que hoy una segunda subida carga de nuevo los equipos. Cerrar esto requiere una clave de import persistida y una tabla nueva; no hay decisión de esquema ni artefacto implementado en el árbol. `T57` queda abierto y no cambia el gate ni el estado de S10. | `packages/db/**` · pendiente de definir por `db-agent` y de ratificación del LEAD |
| S8.2 | `listing.title` llegaba al prompt **sin** `sanitizeForPrompt` mientras `description` sí pasaba | **done** · 2026-08-28 · commit `89ab7c0` · **segundo ítem del encargo de `T50`**, o sea la misma entrada de `doing` y no una segunda (ver §Estados) · verificado por el LEAD con la mutación de abajo | `ai-agent` (`packages/ai/**` por §4) | — | **Cerrada, y la fila ubicaba el arreglo en el lugar equivocado. Se corrige al cerrarla, porque es exactamente lo que se pierde con un `done` pelado.** Esta celda decía *«donde se arma el prompt»*; la protección real quedó **una capa más arriba**, en el mapeo DTO → vista de `packages/ai/src/listing-view.ts`: `name: ownerText(listing.title, NAME_MAX_LENGTH) ?? ''` (`:192`). **Y el arreglo salió más ancho que el hallazgo, que es la otra mitad:** `ownerText` (`:178`) sanitiza **todo** texto del dueño, no sólo el `title` — el censo mostró que `title` era el caso más **visible**, no el único (`color` y el bloque del vendedor entraban igual de crudos). **Un envoltorio para todo el bloque, no uno por campo, y el motivo es de dieta:** `sanitizeForPrompt` cuesta **30 tokens** de delimitador *cada vez que se llama*, siete envoltorios eran **+150** sobre un bloque de 295, y el peor caso normal ya medía **1131 de 1200** — o sea que envolver campo por campo lo habría pagado la escalera de `context.ts` tirando chunks y turnos de historial. Se lee junto con **`T52`**. El test fija la **propiedad** y no el número: **un** envoltorio (`listing-view.test.ts:389`). **Verificación del LEAD:** mutando `name: listing.title.trim()` en `listing-view.ts` → **3 fallos en `listing-view.test.ts`** y el test de camino de `chat.test.ts` **verde**. Eso no es un hueco de cobertura: son **dos capas testeadas independientemente**, y dice dónde vive la afirmación — el prompt se protege en el mapeo, y `chat.ts` prueba el camino | `packages/ai/src/listing-view.ts:178` (`ownerText`) y `:192` (`name`) · `packages/ai/src/listing-view.test.ts:295-400` (la sección del hallazgo) y `:233` (la misma propiedad por la vía de la tool) · `packages/domain/src/sanitize.ts` (`sanitizeForPrompt`, `UNTRUSTED_OPEN`/`UNTRUSTED_CLOSE`) · `apps/web/app/(app)/_lib/tradein/accept-to-stock.ts` (el salto que S8 agregó) · commit `89ab7c0` · `docs/ARCHITECTURE.md` §"Límites de confianza" |

> **Los ids de estas cuatro filas.** El encargo del LEAD pedía `T31`, `T32`, `P4` y `P5`, y las dos primeras **ya estaban tomadas** — `T31` es el evento de cuarentena del cron (`done`, `4a9a8de`) y `T32` es `guard-doc-tables.sh` (`done`, `d3deb86`), las dos citadas por otras filas y por `INDEX.md`. `docs-keeper` no renumeró por prolijidad: dos filas con el mismo id en *el estado de la verdad* rompen exactamente lo que `guard-doc-tables.sh` vino a cuidar, y `T31` está referenciada hasta en el título de §T21–T25. **Entraron como `T33` y `T34`, con el contenido del encargo sin tocar.** Si el LEAD prefiere otros ids, es un `sed`; lo que no se hace solo es elegir.
>
> **Resuelto el 2026-08-28, y del lado que correspondía.** La colisión llegó a estar en `main`: el commit del arnés de `guard-effects.sh` se titulaba `[fix] T32: …` y el del censo de probes `[fix] T31: …`, o sea que el repo tenía dos `T31` y dos `T32` — los ids de dos filas `done` (`4a9a8de` y `d3deb86`) reusados por commits nuevos. `docs-keeper` lo dejó medido **sin** reescribir mensajes de commit ni renumerar filas `done`, porque ninguna de las dos cosas es suya, y el **LEAD enmendó los dos mensajes**: hoy `git log --oneline` trae **`2ccb8a1 [fix] T34: …`** y **`5b6061e [fix] T33: …`**, y los shas viejos (`5f9ca03`, y el del censo) ya no están en el log. Las celdas de T33 y T34 citan los shas nuevos. **Los ids del board no se movieron**: `T33`/`T34` quedaron como estaban, que es lo que evita tocar `INDEX.md`, el título de §T21–T25 y las celdas que citan `T31`. <!-- t55-hash-exento: la nota narra la colisión de ids y su enmienda: el sha viejo es el hecho narrado y sin él la frase «ya no están en el log» no dice cuáles -->


#### T21–T25 (+ T31) · el barrido de reservas se atraganta con la primera fila podrida

> **Estado al 2026-08-28, después de las corridas del LEAD: la familia CERRÓ entera.** T21, T22, T23
> y T25 pasaron a `done` por la re-ejecución de `bash scripts/accept-s6.sh` (V10 + V10b) del LEAD, y
> **T24 y T31 también** —las dos están en `4a9a8de`, T31 suma `dd871ce`, y las cerró la misma corrida—.
> **T23 quedó acotada a su predicado** y la mitad que le faltaba —el evento con los **ids** de las
> filas abandonadas— se mudó a **T31**, que es por qué la familia lleva ese id en el título.
>
> **Este párrafo decía *«T24 está `doing`»* y *«T31, `doing`»* y quedó viejo el mismo día**; la nota
> de §"Tercera tanda del 2026-08-28" ya lo había corregido allá y acá no, o sea que el board se contradecía
> a sí mismo sobre qué estaba en `doing`. Corregido por `docs-keeper` el 2026-08-28 verificando contra
> las celdas y contra `main`, que es el mismo drift que la fila de abajo describe y la misma cura.

**Origen:** `cost-auditor`, `docs/COST.md` §2.5, re-auditoría del 2026-08-28 sobre HEAD `68c0bd6`.
**Dueños asignados por el LEAD**, no derivados por este board. **Los ids del board son `T21`–`T25` (más `T31`, que salió de partir T23),
no `R1`–`R4`**: en este mismo archivo `R1`–`R7` ya son los topics de research de FASE 1 (tabla de
`:34`) y en `TEST_MATRIX.md` `R0`–`R8` son los casos de RLS cruzado. Cada fila lleva su alias de
COST.md entre paréntesis para que la recomendación siga siendo rastreable; **reportado al LEAD**,
que fue quien las nombró así. La explicación completa —aritmética, SQLSTATEs y las cinco
aserciones— vive en COST.md; acá va sólo lo que hace falta para tomar la fila.

El hallazgo no es «el barrido es lento». El `select` es
`where status='active' and expires_at <= now order by expires_at asc limit 200`, y una fila que tira
deja la transacción rolleada: sigue `active`, con el mismo `expires_at` en el pasado. Por `asc`,
**es la primera de la próxima corrida, y de la siguiente, para siempre.** No hay columna donde anotar
que ya falló, el `try/catch` es por fila y está dentro del loop, así que una corrida donde fallan las
200 devuelve `{ ok: true, scanned: 200, expired: 0, failed: 200 }` y **`200 OK`** — para el dashboard
de scheduler es idéntica a una corrida perfecta.

**Por qué no lo agarra nada de lo que ya existe.** `expire-reservations.test.ts` tiene el caso *«una
fila podrida no frena el barrido»* y pasa: afirma la resiliencia **dentro** de una corrida. El
hallazgo es **entre corridas**, y no hay un solo test que ejecute el barrido dos veces. Es el peor
tipo de cobertura: la que tranquiliza sobre el eje equivocado. Y las causas que envenenan el 100% de
las filas de una —tabla sin `GRANT` (`42501`), migración editada después de aplicada (`23514`), check
nuevo en `listing_events` (`23502`)— son las tres **deterministas** y ninguna aparece en CI, porque
en CI la base nace limpia.

**Por qué prioriza.** A nosotros nos cuesta **USD 0,0015 por mes** por unidad trabada: haría falta
que se trabaran 330 a la vez para igualar el chat de un tenant. Al reseller le cuesta
**USD 15 – 22/mes** por unidad (0,30 de probabilidad de venta × USD 50–74 de margen), y el plan Base
sale **USD 19**: una sola unidad trabada le come el abono entero. La asimetría es de ~10.000× y toda
cae del lado del cliente. Un gate de dinero no puede ver esto — por eso la fila T25 cuenta filas y no
dólares.

**Lo que NO hay que hacer**, escrito acá para que no vuelva a proponerse: bajar `EXPIRE_BATCH_SIZE`
(la capacidad es 1.745× la demanda; el problema es el orden, no el lote) · reintentar dentro de la
misma corrida (contra un error determinista es una segunda transacción facturada con el mismo
resultado) · un worker que vigile el cron (es el «worker 24/7» que `CLAUDE.md` §3 prohíbe) · subir la
frecuencia del cron (una fila envenenada falla más rápido, nada más).

#### T21 · el primer fallo  ·  2026-08-28  ·  **fallo 1 de 2**

**Qué pasó, medido.** `db-agent` reportó T21 verde declarando que **no** había corrido e2e. El LEAD
re-ejecutó `scripts/accept-s6.sh` **entero**, e2e incluido, y la slice pasó de verde a **RECHAZADA**:
los dos specs e2e caen con `42501 permission denied for table reservations`. **Reservar un equipo
desde el panel quedó roto**, que es la mitad del producto que S6 vende.

**La causa, en una línea:** la migración `0006` revocó el `INSERT` de **tabla** a `authenticated` y
lo re-otorgó **columna por columna** sobre las 11 que ya existían, dejando afuera la nueva
`sweep_attempts` — y **Drizzle, en `insert().values()`, nombra todas las columnas de la tabla**
aunque vayan con `default`, mientras Postgres exige privilegio sobre cada columna **nombrada**. Un
`GRANT` por columna incompleto no es "más restrictivo": es un `INSERT` roto para todo el producto.
El razonamiento de origen era correcto —que un seller no pueda forjar el contador— y el mecanismo
era el equivocado: eso se ata en el `WITH CHECK` de la policy, que sabe decir *"sí, pero en cero"*,
cosa que un `GRANT` no sabe decir. Para `UPDATE` el `GRANT` por columna **sí** sirve, porque el
`.set()` de Drizzle nombra sólo las columnas que setea. Las dos mitades están escritas dentro de
`packages/db/drizzle/0006_reservations_sweep_attempts.sql`, con un bloque `DO` que aborta la
migración si el reparto no es el declarado.

**Lo que este fallo dice del harness, y es más caro que el defecto.** `scripts/guard-grants.sh`
dijo **PASS con el panel roto**, y no por descuido: cuenta que exista un `GRANT` por tabla, y un
`GRANT` parcial existe. Quien agarró el defecto fue **e2e** — el gate más lento y más caro del repo.
Una afirmación que sólo el gate más caro puede hacer se termina haciendo tarde.

**Gate nuevo del LEAD, y su domicilio:** `scripts/probes/el-grant-cubre-el-insert-de-drizzle.test.ts`,
regla **G6**, cableada en `scripts/accept-fase2.sh` como sección **D5**. Le pregunta al **catálogo de
Postgres** —`has_column_privilege`, cero `INSERT` ejecutados— tabla de negocio por tabla de negocio
(las que tienen `tenant_id`, derivadas de `information_schema`, no de una lista): si `authenticated`
tiene **algún** privilegio de `INSERT` por columna, tiene que tenerlo sobre **todas**. **Cero
privilegios = fuera de alcance**, y eso es deliberado: esa tabla la escribe `service_role` y es una
decisión legítima, no un hallazgo.

**No entró adentro de `guard-grants.sh` a propósito.** Ese guard declara en su encabezado que es
100% estático para poder correr sin base en el pre-commit, y esta afirmación **sólo** se puede hacer
contra el catálogo de una base migrada. Romperle el contrato para meterle una regla habría sido peor
que la regla: un guard que a veces necesita Postgres deja de correr en el pre-commit, y un gate que
deja de correr no protege nada.

**Probado en las dos polaridades sobre el censo real, no sobre el predicado** (LEAD): una tabla con
`tenant_id` y un `GRANT` de `INSERT` que cubría 2 de 3 columnas → **rojo, nombrando tabla y columna
faltante**; borrada la tabla → **verde**; base verificada limpia después. Y la probe trae adentro un
control de polaridad que **corre siempre**, sobre una tabla sembrada en una transacción que se
rollea, para que *"no encontré tablas rotas"* y *"no sé buscar tablas rotas"* dejen de ser la misma
salida verde.

**Estado de la fila, actualizado el 2026-08-28.** T21 sigue **`doing`**, y el motivo **cambió**:
ya no es que falte el commit. El arreglo de `db-agent` está en `main` desde **`63abcb7`** —la
migración `0006` con el `REVOKE` reducido a `UPDATE` y el candado mudado al `WITH CHECK
(sweep_attempts = 0)` de la policy, `packages/db/src/reservations-sweep-attempts.test.ts` reescrito
para construir el `INSERT` **con el query builder de Drizzle** (`toSQL()`) y derivar la lista de
columnas del schema, y la sección **3b** de `rls-lint.mjs`—. Verificado contra `main`:
`git cat-file -e HEAD:packages/db/drizzle/0006_reservations_sweep_attempts.sql` resuelve y
`git show HEAD:packages/db/scripts/rls-lint.mjs` trae la sección 3b en `:176`.

**Cerrada el 2026-08-28: la corrida llegó y fue verde.** El LEAD re-ejecutó `scripts/accept-s6.sh`
—la misma corrida que la había rechazado, e2e incluido, la única que puede afirmar que el alta de
reservas del panel volvió a andar— y T21 pasó a **`done`**. El segundo fallo que la regla 3 tenía
apuntado no llegó. **El fallo queda escrito acá como historia, no como estado:** la fila dice `done`
y su celda dice *"cerró con 1 fallo de aceptación en el histórico"*, porque el contador de intentos
sirve mientras la fila esté abierta y el relato sirve para siempre — es de donde salió **G6** y de
donde salió **ADR-021**.

**Y lo que la cerró no fue leer un archivo.** La afirmación de T21 no es *"la columna existe"*: es
que **el `+1` sobrevive al rollback de la transacción que falló**. La probe lo mide contra Postgres
real —`intentos_tras_fallo=1` después del rollback, `tope=5` y `abandonadas_en_el_tope=1` en el
techo—. Si el `+1` viviera dentro de la transacción que falla, la columna estaría igual de presente
en el schema y el campo valdría **0**: el arreglo escrito y sin efecto, que es la forma más fácil de
escribir esto mal.

**Nota de método que esta fila deja escrita, porque la aprendió dos veces en el mismo día:** un
`doing` sin motivo fechado se lee como *"alguien está tecleando"*. Estas dos versiones del párrafo
dicen `doing` por razones distintas —falta el commit / falta la corrida— y sólo la segunda es un
pedido al LEAD. El estado no informa: lo que informa es qué falta.

**La lección general no se queda acá: es `DECISIONS.md` ADR-021** — *la aserción tiene la forma del
caller, no la forma cómoda*. El test que "probó que el panel podía insertar" escribía él mismo una
sentencia `INSERT` que **ningún caller del producto emite**. No era un gate vacuo: medía algo real,
contra Postgres real. Medía a un **sujeto inventado**.

#### T25 · la spec de la celda estaba equivocada en tres puntos, y la corrigió la probe midiendo

**El LEAD corrigió la spec, no el gate.** Los tres puntos de abajo estaban escritos en esta tabla
**antes** de que la probe existiera, y los tres los contradijo la medición. La lección general —que
esto ya pasó tres veces en esta fase— es **`DECISIONS.md` ADR-024**.

**1 · «alcanza el `tx` falso de `expire-reservations.test.ts`». Es falso, y la probe ya lo había
rechazado con razón.** La primera de las tres piezas del arreglo es
`order by sweep_attempts asc, expires_at asc`, y un `tx` de mentira devuelve las filas **en el orden
en que se las metieron**: no hay nada del ordenamiento que pueda medir. Un fake que ignora el
ordenamiento y después "verifica el ordenamiento" es la familia que **ADR-020** vino a cerrar —afirma
una conducta y ejecuta otra cosa—, sólo que con un mock en lugar de un grep. La probe usa **Postgres
real**, y **sin base es FAIL, no `skip`**: la única pieza de mentira es de dónde sale el pool.

**2 · `intentos_23514` / `intentos_40P01`: la spec partía por SQLSTATE y el código no parte por
SQLSTATE — ni debería.** El barrido **no ramifica por código de error**. Lo que importa no es qué
error fue, es **si una fila que dejó de fallar vuelve a entrar al lote**. Por eso los campos reales
son `intentos_tras_fallo` (el `+1` sobrevivió al rollback) y `reintento_tras_recuperarse` (la fila
recuperada volvió al lote), y el veneno de la probe es un `CHECK` (`23514`), no un deadlock. Partir
la medición por SQLSTATE habría atado el gate a una taxonomía de errores que el código no tiene: el
gate habría descrito un diseño imaginario y habría enrojecido con el real.

**3 · `lineas_log_por_envenenada == tope + 1`. Hoy vale `tope` (5).** El `+1` que la spec pedía es
un evento que **nadie escribió**, y sacarlo a fila propia es **T31**: el propósito que T23 le daba
—*dejar de pagar 8.640 líneas idénticas por mes*— ya está cumplido por el techo de T22, y lo que
falta es otra cosa (los **ids** de las filas abandonadas). Cuando T31 caiga, `accept-s6.sh` suma un
campo que cuenta esa línea y exige **1**. **Un gate que anticipa lo que va a medir es barato; uno
que se entera después, no.**

**Lo que no cambió, y conviene decirlo:** los tres puntos son correcciones **de la spec**, no del
gate ni del producto. La aserción de fondo de T25 —*correr el barrido más de una vez y contar filas,
sin grepear `sweep_attempts` en ningún archivo*— quedó intacta, y es la que sigue parada entre el
head-of-line y un merge.

#### T23 · por qué el caso nuevo hacía falta, medido

El predicado que T23 eligió es cross-run y está medido **en las dos puntas sobre la misma fila**:
primera falla → **200** (una carrera perdida contra el dueño cancelando desde el panel no puede
pintar el cron de rojo permanente), segunda falla de esa misma fila → **500**. Vale escribir por qué
se agregó ese caso: **el caso F ya existente sacaba su 500 por la pata `abandoned`**, así que un
`degraded = sweep.abandoned > 0` —el arreglo **sin** la mitad cross-run— **pasaba, y pasaba callado
durante cinco corridas**. El LEAD lo mutó y ahora rojea. Es la misma forma de los verdes que este
board viene cazando: un gate que da PASS por la pata que no es.

> **Anti-drift, 2026-08-28 — el caso completo, de punta a punta, porque es el que enseña la regla.**
> Durante un día **S3.1 y S3.2 estuvieron `todo` con el código ya en `main`** (`eaccfee`). Las filas
> **no se movieron** entonces: el estado lo fija la corrida del gate por el LEAD, no la entrega del
> código (regla 5 de este board). Se movieron a `done` recién con la corrida verde del 2026-08-28,
> y en el medio esa corrida encontró **cuatro defectos reales** (`9837ee7`, `50173df`, `ba8536c`,
> `09c9bc3`) que la entrega del código no había mostrado. Eso es lo que compra la regla.
> Lo que sí se corrigió el día que las filas seguían `todo` fue la **descripción**, porque decía algo
> que el código ya no hacía:
> - **S3.1** — `create-tenant.ts` ya siembra `fx_settings` (`:320`) y una fila de `locations`
>   (`:328`) en la **misma** transacción que `tenants` + `memberships` (`eaccfee`).
> - **S3.2** — `storefront-cache.ts` ya tiene tres puntos de entrada según el alcance real de la
>   mutación (`invalidateStorefront` 2 tags · `invalidateStorefrontUnit` 3 · `invalidateListing` 1),
>   y los tags se **importan** de `(storefront)/_lib/cache-tags` en vez de redefinirse.
>   **Ese `3` quedó viejo el 2026-08-28 y se deja tachado a propósito:** `invalidateStorefrontUnit`
>   emite **2** desde `f504d69`, y el tag que se cayó —`tenant-config:{slug}`— era justamente el que
>   hacía que una reserva arrastrara las 60 fichas hermanas. Ver **S6.2**. Contar tags no es medir
>   radio: los tres eran correctos por separado y el conjunto purgaba la vidriera entera.
>
> Lo que faltaba para las dos era lo mismo —**la corrida verde de `bash scripts/accept-s3.sh`**— y
> llegó el 2026-08-28. Las dos son `done`.

### S2.1 · upload directo a R2 por URL prefirmada  ·  **blocked por probe real pendiente**

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

**Por qué la probe real sigue pendiente:** ahora hay bucket y credenciales de alcance exclusivo en
Production, pero todavía no se construyó ni se ejecutó un presigned contra ese bucket. La sonda de
key inexistente devuelve 404, pero no prueba un PUT. El driver de R2 **sí existe**
(`packages/media/src/storage/r2.ts`, elegido con `MEDIA_DRIVER=r2`); lo que no existe es la firma de
un PUT directo, y lo dice el propio código: `packages/media/src/upload.ts:6`. Mientras tanto se
trabaja con el driver local (`storage/local.ts`), donde **no hay techo de 4 MB** — o sea que lo que
S2 entregó es correcto *y* verificable en local, pero todavía no aceptado contra R2 real.

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

### T1 · rate limiting en el edge  ·  **NIVEL 1 CERRADO el 2026-08-28** (`4fce968`)

**La premisa de la fila era falsa y la demolió `researcher`.** La fila pedía "2 reglas activas" con
owner *LEAD (`vercel.json`)* y artefacto *"falta definir"*. **El rate limit del WAF no entra en
`vercel.json` y no puede entrar:** el schema oficial tipa `routes[].mitigate.action` como enum
cerrado `["challenge","deny"]` con `additionalProperties: false`, y la palabra `rate_limit` aparece
**cero veces** (verificado contra `openapi.vercel.sh/vercel.json` el 2026-08-28,
`docs/research/vercel-firewall-as-code.md`). Por eso **`vercel.json` sigue sin existir**, y la regla
**F5** del gate falla si alguien lo crea creyendo declarar el límite ahí.

Las reglas viven versionadas en `config/firewall-rules.json` y se aplican **por CLI**
(`vercel firewall rules add …` + `vercel firewall publish`), que **no es parte del build**: un
`vercel deploy` **no** sincroniza el WAF.

**Qué está hecho y qué no — el gate original no se cumple entero, y se deja escrito así.**

| nivel | qué afirma | estado |
|---|---|---|
| 1 · estático, sin red | el archivo existe, parsea, cabe en los límites reales de Pro, **ninguna regla le cobra peaje al HTML de la vidriera**, y **todo route handler de la app está decidido** | ✅ `bash scripts/guard-firewall.sh` → `GUARD-FIREWALL: PASS`, **y corre en CI** desde `3199a78` (`ci.yml:118`), junto con su polaridad (`:126`) |
| 2 · contra la config viva (`vercel firewall diff --json`) | lo declarado **es** lo aplicado | 🔴 **sin implementar**: falta verificar qué scope de token permite el `publish` (§UNVERIFIED del research) |
| aplicación | las reglas corriendo y **disparando** un `429` | 🔴 **no aplicadas**. No hay proyecto Vercel (**B2**/**B5**). **Son 3 desde `cb4fe3f`, no 2** (`guard-firewall.sh` §F1: `3 reglas declaradas (techo de Pro: 40)`): `storefront-track-rl` está `active` desde S4 (`c9611b1`) porque su ruta ya existe; `storefront-tradein-rl` está `planned` con `lands_with: S8`; `chatbot-rl` sigue `planned` porque `/api/chat` aterriza con **FASE 5** |

**Lo que hace fuerte al gate no es validar el JSON** contra los límites de Pro (`keys ⊆ {ip, ja4}` —
`header:` es Enterprise —, `algo = fixed_window`, ventana 10–600 s, ≤ 40 reglas): eso es aritmética.
Es el **censo**. Cada route handler tiene que estar cubierto por una regla **o** exceptuado con
motivo escrito de 60+ caracteres, así que **una ruta nueva sin decidir rompe el gate el día que se
crea**, no el día que la floodean. **El número del censo se movió y se re-mide, no se recuerda: hoy son 6, no 3.** Corrida de
`docs-keeper` el 2026-08-28 —`bash scripts/guard-firewall.sh` → `GUARD-FIREWALL: PASS`—:
`route handlers censados en apps/web/app: 6`, **5 exceptuados** y **1 cubierto por una regla**.
Los exceptuados: `/api/health` (el handler entero es un `Response.json` constante),
`/api/tenants/slug-check` (exige `getPanelSession()` no-nulo **antes** de tocar la tabla),
`/_media/[...key]` (el mayor egress del producto, exceptuado con `revisit: B1` porque en producción
esos bytes los sirve el CDN de Cloudflare desde otro host), `/api/cron/expire-reservations` y
`/billing/webhooks/mercadopago`. El cubierto es `/s/[slug]/api/track`. Los tres últimos no existían
cuando se escribió el `3`; que el número suba solo es la conducta esperada del censo, no drift del
veredicto — lo que sería drift es que este board siguiera publicando el viejo.

**Decisión del LEAD que contradice al `researcher`, y por eso se registra.** El research proponía
una regla de vidriera con condición `host suf .maat.work`. **Rechazada.** El rate limit se factura
por *allowed requests* —los que matchean **y pasan**—, así que esa regla le cobraría peaje a **cada
pageview de vidriera**, que es exactamente lo que `ARCHITECTURE.md:197` declara scrapeable a
propósito (*"se defiende lo que cuesta plata"*). Las reglas apuntan a lo que sí cuesta:
`/api/track` —**primera** escritura **sin autenticar** del producto: con el spend cap de Supabase en ON,
floodearla no infla una factura, **apaga el proyecto para todos los tenants**— y `/api/chat`, donde
cada request es un token pagado. Para abuso masivo del HTML la palanca es **Attack Challenge Mode**,
gratis en todos los planes e inmediato, sin `publish`. La regla **F2** del guard **falla** si alguien
declara una regla por `host` sin acotar path, o un catch-all.

> **Esto era material de ADR y ya lo es: el LEAD abrió y ratificó ADR-016** (2026-08-28). La
> decisión, la alternativa descartada (`host suf .maat.work`, con su número de costo) y la
> verificación con fuente viven ahí; esta sección queda como el estado de la fila.

**El nivel 1 dejó de depender de disciplina: `guard-firewall.sh` tiene step en CI.** ⚠️ *Step
declarado, no ejecutado* — `ci.yml` no corrió nunca (§"Seis gates rojos o dormidos"), así que lo que
dejó de depender de disciplina es **acordarse**, no **la corrida**. Verificado
contra `.github/workflows/ci.yml` el 2026-08-28 — está en el job principal en `:118`, y su polaridad
(`guard-firewall.test.sh`, "cada regla se tiene que ver romper") en `:126`, las dos desde `3199a78`.
**Este board decía lo contrario y estaba desactualizado**; se corrige acá y en `TEST_MATRIX.md`, que
lo repetía. Importa porque el censo es la parte que sólo sirve si corre sola: *"una ruta nueva sin
decidir rompe el gate el día que se crea"* era falso mientras lo corriera una persona cuando se
acordaba. Es la segunda mitad de la pregunta que este repo ya aprendió a hacerse —*¿hay chequeo?*
**y** *¿lo corre alguien?*— y hoy la respuesta es *sí* y *sí*.

**Lo que sí sigue abierto es el nivel 2, y no se redondea: `active` no significa "publicada en
Vercel".** Con S4 (`c9611b1`) `storefront-track-rl` pasó de `planned` a `active` porque el endpoint
no nace sin techo, pero `active` significa **que este archivo declara que la regla debe estar
publicada**, no que lo esté. La brecha entre `config/firewall-rules.json` y la config viva es el
**riesgo residual conocido de T1** y se cierra con el gate de nivel 2 (`vercel firewall diff --json`),
que **no existe todavía**: falta verificar qué scope de token permite el `publish`
(`docs/research/vercel-firewall-as-code.md` §UNVERIFIED). Mientras no exista, el apply es manual y el
procedimiento mínimo son los dos comandos de `$apply` en el propio JSON.

**Tercera regla, `cb4fe3f` (2026-08-28): `storefront-tradein-rl`, y llegó ANTES que su handler.**
`5` requests / `600 s` por `ip`, `deny`, `status: planned`, `lands_with: S8`, cubriendo
`/s/[slug]/api/tradein`. **Es más dura que la de `/api/track` a propósito** y el motivo está escrito
en el `why` de la propia regla, en las dos monedas que importan: en Postgres, el beacon escribe tres
columnas de ancho fijo y sin PII, mientras que un lead de canje escribe **texto libre de un anónimo**
(`model_text`, `notes`) y además es una fila que **el dueño lee en su inbox** — o sea que un flood no
infla una tabla, **arruina la herramienta**; y en atención humana, cada fila falsa es un WhatsApp que
alguien de Cipolletti manda a un número inventado. La asimetría de los techos también está dicha:
`60/60s` en `track` es un beacon que un comprador real dispara varias veces por sesión, y un canje
real se manda **una** vez, así que `5/600s` deja lugar a corregir un typo y reenviar, y no deja lugar
a un `for`.

**Lo que esta anotación NO dice, y es la parte que importa:** la regla está `planned`, su ruta
**todavía no existe**, y por eso `guard-firewall.sh` la deja pasar sin exigir handler (§F3 sólo
verifica que *las reglas activas* cubran handlers que existen). **El techo llega antes que el
endpoint**, que es la conducta que el censo vino a producir — *"una ruta nueva sin decidir rompe el
gate el día que se crea"* funciona en las dos direcciones. El día que `storefront-agent` aterrice
`POST /s/[slug]/api/tradein`, la regla pasa a `active` **por el mismo motivo por el que `track` pasó
en S4**: un endpoint no nace sin techo. Y `active` sigue significando *"este archivo declara que la
regla debe estar publicada"*, no que lo esté — el nivel 2 sigue abierto.

**El resto de S8 no se anota todavía.** Los tres agentes (`db-agent`, `storefront-agent`,
`app-agent`) están en vuelo y ninguno cerró; el board de S8 se escribe con el encargo del LEAD y con
mediciones reales, no prometidas.

**El borde de `CLAUDE.md` §2 que esta fila no cubre —y ya lo cubre otro:** *rate limiting con
contador en Postgres sobre la vidriera es rechazo automático*. Que exista el WAF **no** pone un gate
sobre esa prohibición —son dos cosas distintas: una configura un techo en el edge, la otra prohíbe
una implementación en el código—, y eso era **T14.1**. **Lo cierra `W016` el 2026-08-28**, fila
**T26**: el WAF cubría la mitad de afuera y *nada impedía escribir el contador igual y quedarse con
las dos capas, pagando la cara*. Esta fila (**T1**) no cambia: sigue siendo el techo del edge.

### T2 · el guard de "query sin filtro de tenant"  ·  **CERRADA el 2026-08-28** (`9b3d7d2`) · LEAD

`CLAUDE.md` §2 rechaza toda query sin filtro de tenant *además* de RLS. `scripts/guard-leaks.sh`
tiene 15 secciones y **ninguna es ésta** — sigue siendo cierto, y por eso la fila nació. La regla
**se escribió en otro lado**, como `W015` de `apps/web/scripts/web-lint.mjs`, que es del LEAD por la
misma tabla de §4.

**Lo que este board decía y era falso al 2026-08-28.** Decía *"implementación en vuelo, sin
commitear"* y citaba `git log -S W015` devolviendo **cero commits**. Re-medido:

```
$ git log --oneline -S W015 -- apps/web/scripts/web-lint.mjs
9b3d7d2 [fix] W015: read raw SQL, measure filtering instead of presence, fail closed
```

El mismo commit trae el párrafo de `CLAUDE.md` §2 que fija el contrato del marcador
`web-lint:sin-tenant` (motivo de 30+ caracteres, una línea, dentro de la declaración de nivel de
módulo o su docblock pegado; sin ancla no hay exención). O sea que la pregunta que la fila enseñó a
hacerse —después de *¿hay chequeo?* y *¿lo corre alguien?*, la tercera es **¿está en `main`?**— ya
tiene respuesta afirmativa, y el diagnóstico de arriba describe un estado que duró horas.

**Estado verificado por `docs-keeper` el 2026-08-28, no reportado.** `node ./scripts/web-lint.mjs`
desde `apps/web` imprime
`ok W015 toda query sobre las 15 tablas de negocio filtra por tenant ademas de RLS (builder y sql crudo)`
y cierra en **`WEB-LINT: PASS (16 reglas)`**. Corre en CI por `pnpm -r lint` (`ci.yml:64`, vía el script
`lint` de `apps/web/package.json`) — con la salvedad de la sección *"«en CI» era una afirmación
sobre intención"* de más abajo, que aplica a **todos** los gates de este repo.

> **Este board decía `15 reglas` acá y era el número de la mañana.** Al cierre del 2026-08-28 el
> linter tiene **16**: entró **`W016`**, que cierra la última prohibición de §2 sin gate ejecutable
> (**T14.1**) y tiene fila propia, **T26**. La línea de W015 **no cambió** —sigue diciendo `15
> tablas de negocio`, que es otra cosa que `16 reglas` y conviene no confundir— y las dos filas de
> este board que citan `lint 0 (15 reglas)` como evidencia re-ejecutada (**S6.1** y el §"Cómo se
> cerró" de más abajo) **quedan con su número**, fechado: eran ciertas el día que se midieron.
> Reescribir una medición vieja con un número nuevo es exactamente el drift que este board evita.

**Las dos excepciones declaradas del repo, y son exactamente dos:**

| archivo | motivo escrito |
|---|---|
| `apps/web/app/(app)/_lib/session.ts:94` | *resolver a qué tenant pertenece una sesión es anterior a que exista el tenant* |
| `apps/web/app/(app)/_lib/tenants/create-tenant.ts:202` | *pregunta existencial sobre todos los tenants, hecha antes de que exista el primero* |

**Residuo declarado y CERRADO el 2026-08-28 (`a015437`): la polaridad de W015 ya es un comando.**
El commit de W015 decía *"twelve constructed cases, each seen to break in its own direction,
**run in a sandbox outside the repo**"*. Era literalmente la situación anterior de `guard-firewall`,
donde *"14 fixtures, 14 rompen"* también se había ejercido a mano y fuera del repo — y el día que se
volvió un comando (`scripts/guard-firewall.test.sh`, `3199a78`) encontró que **seis reglas no
fallaban nunca** (`DECISIONS.md` ADR-016 §Verificación). Lo cierra **`scripts/web-lint.test.sh`**,
del LEAD, con step propio en `ci.yml:156`.

> **La pregunta abierta que este board le dejaba al LEAD está contestada, y la respuesta es sí.**
> Decía: *"¿W015 lleva arnés de polaridad versionado? Hoy `ls apps/web/scripts/` devuelve un solo
> archivo"*. La observación era cierta y **miraba el directorio equivocado**: el arnés no vive al
> lado del linter sino en `scripts/`, con los otros arneses del LEAD. Verificado por `docs-keeper`
> el 2026-08-28: `bash scripts/web-lint.test.sh` cierra en
> `POLARIDAD WEB-LINT: OK — las 16 reglas se vieron encender`, **45 casos**, y **W015 aporta 12** —
> los seis bordes que importan están adentro (*presencia no es filtro*, *proximidad no es alcance*,
> *el docblock del módulo no exime*, *un motivo de tres palabras no es un motivo*, el `insert` que se
> ata por el `values()` y no por un `where` que no puede tener, y **schema ilegible = FAIL**).
> El arnés mide **contra el ID de la regla, no contra el exit code**, y el motivo está escrito en
> `ci.yml:153-155`: con 16 reglas sobre un mismo árbol, un fixture puede salir rojo **por la regla
> equivocada** y eso reportaría cobertura sin haber ejercido nada.

**Por qué la implementación es de las buenas.** Deriva la lista de tablas del
**schema real** (las que tienen `tenantId`), así que una tabla de negocio nueva queda cubierta el día
que nace y no el día que alguien se acuerda de una lista; **falla si no puede leer el schema**
—ausencia de medición es FAIL, y una lista vacía haría pasar todas las queries diciendo PASS—; usa
una ventana de sentencia **angosta a propósito**, porque una ancha produce falsos negativos (un
`tenantId` diez líneas más arriba, de otra query, dejaría pasar a ésta); y el escape es una marca
`web-lint:sin-tenant` con **30+ caracteres de motivo escrito**, el mismo mecanismo que el censo de
rutas de `guard-firewall.sh`.

**Lo que este `done` NO cierra, y por qué la fila del alcance se separó:**
1. **El alcance no es el de la regla de `CLAUDE.md`.** `web-lint.mjs` recorre `apps/web/app`,
   `apps/web/lib` y `proxy.ts` (`web-lint.mjs:41`). Una query sin filtro en `packages/**` sigue sin
   gate. Eso **no** es un residuo de T2: es trabajo con su propio dueño y su propio comando, así que
   es **T16** y queda abierta. Cerrar T2 sin abrir T16 sería exactamente la forma en que un alcance
   angosto se lee después como cobertura completa.
2. **La razón por la que la regla importa teniendo RLS está en el propio comentario y conviene
   repetirla acá:** la RLS depende del claim de la sesión, así que **una query con `service_role`
   —los jobs, el signup, cualquier `withServiceDb`— no tiene RLS encima**. Ahí el filtro explícito es
   la única defensa que queda, y es justo donde menos se escribe *"total, hay RLS"*. Las dos capas se
   caen en momentos distintos: por eso van las dos.

**Corrección medida sobre una nota vieja de este board.** Decía, de `app-agent`, que
`apps/web/app/(app)/_lib/catalog/queries.ts` es la única query del panel sin `where tenant_id` y que
*"esa excepción tiene que quedar declarada con la marca, no descubierta"*. La primera mitad sigue
siendo cierta; **la segunda ya no aplica y pedirla sería pedir ruido**: W015 deriva las tablas de
negocio del schema —las que tienen `tenantId`—, y `packages/db/src/schema/catalog.ts` define
`catalog_models` y `catalog_faqs` **sin esa columna** (`grep -n tenantId` sobre el archivo no
devuelve nada). O sea que `queries.ts` no está exento: **nunca entra a la regla**. Verificado:
`grep -rn 'web-lint:sin-tenant' apps/web/app` devuelve **sólo** las dos marcas de la tabla de arriba,
y el lint pasa igual. Una marca ahí diría *"acá hay una excepción"* sobre una query que no la
necesita, y las excepciones que no significan nada son las que enseñan a no leerlas. La
justificación por escrito que ya vive en el propio archivo es lo correcto y alcanza.

### T3 · el test de RLS cruzado estaba en la columna equivocada  ·  **CERRADA el 2026-08-28** (`d686923`)

**No bloqueaba D3 y D3 está `done`.** El test existía, corría contra Postgres real y estaba verde:
el requisito se cumplía. Lo que estaba mal era **quién lo podía editar**.

`packages/db/src/rls-cross-tenant.test.ts` vivía en el directorio de `db-agent`, y su propio
encabezado se declaraba owner `db-agent` citando la corrección de FASE 4 de `CLAUDE.md` §4 (*"el test
unitario de un paquete es del owner del paquete"*). **El LEAD reasignó** (§4: *"conflicto de
ownership = el LEAD reasigna"*): **este test es de `qa-agent` y vive en `tests/`.**

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

> **Precisión posterior del desempate, `CLAUDE.md` §4, `6929088` — no reabre T3.** Tal como estaba
> escrita, la regla *"cruza tenants → se muda a `tests/`"* era **demasiado ancha**: arrastraba también
> al test con el que `db-agent` prueba su propia migración. El criterio vigente es **quién es la
> auditoría de referencia**, y para RLS cruzado sigue siendo `qa-agent`: **este archivo no se mueve.**
> Lo que sí cambia es el otro lado — el owner del paquete **puede** quedarse casos cruzados como red
> de regresión propia si (a) la auditoría de referencia existe en `tests/`, (b) **ningún gate cita el
> test del paquete como evidencia** y (c) cuando divergen **gana el de `tests/`**. Concreto y
> vigente: `packages/db/src/rls-anon-wa-click.test.ts` **se queda con `db-agent`**, y la auditoría de
> referencia del beacon de S4 son **R2b / R6c / R7** de `tests/rls-cross-tenant.test.ts`. La
> duplicación es deliberada y tiene precio: dos archivos que tocar cuando cambia la policy.

**CERRADA el 2026-08-28** (`d686923`). El archivo vive en `tests/rls-cross-tenant.test.ts`, el
encabezado que se declaraba `db-agent` está borrado —ahora explica por qué vive acá y remite al
desempate de `CLAUDE.md` §4— y el LEAD **re-ejecutó desde la ubicación nueva**:
`rls-cross-tenant.test.ts (69 tests)` verdes, total del repo **919**.

**El número de esta fila estaba mal desde D3 y son 69, no 59.** El 59 contaba `it()` literales y se
comía el `it.each(sensibles)` sobre las **10 columnas sensibles** de `listings`
(`tests/rls-cross-tenant.test.ts:625-630`: `imei`, los cuatro `imei_check_*`, `cost_usd`,
`margin_usd`, `supplier`, `internal_notes`, `created_by`). Es un detalle con moraleja propia y es la
misma que el repo ya aprendió contando menciones en vez de aserciones: **un inventario que cuenta
`it()` en el fuente cuenta la forma del archivo, no los casos que corren.** El número que vale es el
que imprime el runner.

**Lo que se movió además del `git mv`, y no es cosmético:**
- `MIGRATIONS` resolvía `'../drizzle'` relativo a la ubicación vieja; ahora resuelve
  `'../packages/db/drizzle'` (`:115`). Sin eso el archivo migraba contra una carpeta inexistente.
- `tests/vitest.config.ts` ganó `fileParallelism: false` y `testTimeout`/`hookTimeout` de 30 s: son
  69 casos contra un Postgres real montando y desmontando un fixture de dos tenants más un schema
  de control, y en paralelo **se pisan el rol y el claim**. El síntoma de no hacerlo sería
  intermitencia, que es la peor forma de perder un test de seguridad.

**Se agendaba después de que cerrara S2, y S2 cerró el 2026-08-28** (21 PASS / 0 FAIL). El motivo de
la espera era no mudar el archivo con una slice en vuelo; ya no hay slice en vuelo sobre `packages/db`.
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
código sin commitear auditado igual) y el contador `fail`. Tiene step propio en CI
(`.github/workflows/ci.yml:88`, *"polaridad de los helpers de los gates"*), antes que los guards que
dependen de él. **Y estuvo rojo ahí adentro todo ese tiempo**: `.gitignore` ocultaba su directorio
de fixtures a los helpers que las buscan, así que 3 de sus 13 casos no podían pasar nunca. Lo
arregló `c854b99`; el caso entero está en §"Seis gates rojos o dormidos".

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

**Corolario agregado el 2026-08-28, y es sobre el fixture, no sobre el gate:** *un fix cuya
reproducción no se vio encender no está probado.* El LEAD escribió un fixture para ver fallar a la
**M1** vieja de `accept-s3.sh` y el fixture **no reproducía el defecto** —su prosa nombraba `sizes`
antes que `srcSet`, así que la ventana del tag encontraba el `sizes` y el escáner pasaba—. Lo detectó
corriendo el **escáner viejo** contra él y viéndolo **pasar cuando tenía que encenderse**. La regla
de arriba dice que hay que ver fallar al gate; ésta agrega que **hay que ver fallar al gate *con este
fixture***: un fixture mudo se disfraza de "ya estaba arreglado", que es el único modo de falla peor
que un gate verde, porque además cierra la investigación. Detalle en **ADR-020** §Verificación.

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

### Seis gates rojos o dormidos, un solo día, una sola familia  ·  2026-08-28

> **Qué es:** el registro de lo que pasó el 2026-08-28 con los gates, escrito una vez y junto.
> **Para quién:** el que va a escribir, mover o creer un gate.
> **Cuándo se actualiza:** cuando aparece otro caso de la familia. Lo escribe `docs-keeper`; los
> arreglos son del LEAD, que es dueño de `scripts/**` y de `.github/**` por `CLAUDE.md` §4.

No son seis accidentes: son seis instancias de **una** pregunta que el repo no se estaba haciendo.

| # | gate | qué le pasaba | desde | arreglado en |
|---|---|---|---|---|
| 1 | `scripts/guard-routes.sh` | **rojo**: la ruta del beacon de S4 nunca entró al censo | `c9611b1` (S4) | `b1a8732` |
| 2 | `scripts/accept-fase2.sh` | **rojo**: su regla decía *"toda policy de `anon` es SELECT"* y S4 le dio a `anon` la única escritura sin autenticar del producto | `c9611b1`, **el mismo commit** | `bd7b4e4` |
| 3 | `scripts/accept-fase3.sh` | **no estaba en CI** y no lo corría nadie (pasa) | siempre | `c854b99` |
| 4 | `scripts/accept-s1..s4.sh` | **no estaban en CI** | siempre | `c854b99` |
| 5 | `scripts/_lib.test.sh` | **rojo y en CI**: `.gitignore` ignoraba su directorio de fixtures y los helpers que prueba saltean a propósito lo que git ignora → 3 de 13 casos no podían pasar nunca, y un cuarto pasaba por el motivo equivocado | `98594bf` — **no *"desde siempre"***, como dice el mensaje de `c854b99`: nació en `dc1d854` y `98594bf` le agregó el `scripts/.libtest-tmp/` al `.gitignore` **22 commits después** (`git rev-list --count dc1d854..98594bf`), del otro lado del repo | `c854b99` |
| 6 | `scripts/accept-s1.sh` | `stat -f %m` y `date -j` son **BSD**. En `ubuntu-latest` habría salido **verde midiendo basura** | siempre | `c854b99` |

**Los dos primeros comparten commit de origen y eso es lo que hay que leer.** `c9611b1` cerró S4 con
`accept-s4.sh` en **37 PASS · 0 FAIL** mientras dejaba rojos a otros dos gates. No es contradicción:
**una aceptación por slice corre sus propias aserciones y no puede ver el invariante que la slice
derogó.** Lo único que cruza slices es CI, y por eso entraron ahí las cinco aceptaciones (#3 y #4).

**#2 se arregló endureciendo, no aflojando, y el detalle importa.** La regla podría haberse relajado
a *"`anon` puede escribir si la policy lo permite"*, que es lo que pide el camino de menor
resistencia. En vez de eso, la lista de escrituras de `anon` **se compara por igualdad**: una
escritura nueva rompe el gate, y **borrar el beacon también**. Un gate que sólo se puede violar hacia
arriba deja de medir el día que alguien borra lo que medía.

#### El hecho que enmarca los seis: **"está en CI" era una afirmación sobre intención**

```
$ git ls-remote --heads origin
$ git rev-list --count HEAD
89
$ git branch -avv
* main c854b99 [origin/main: gone] …
```

**`origin` está configurado y no tiene una sola rama.** 89 commits locales, `origin/main` marcado
`gone`. `.github/workflows/ci.yml` **nunca se ejecutó**, ni una vez, en ninguno de los 89.

_Re-medido el 2026-08-28 sobre `68c0bd6`, después del barrido serial de los cinco `accept-*`:
**110 commits**, `git ls-remote --heads origin` sigue sin salida (exit 0, cero ramas). El bloque de
arriba queda como el snapshot que originó la nota. **Que el denominador crezca y el numerador no es
el dato**: veintiún commits más de trabajo apoyados en gates que nadie ejecutó en un runner limpio —
y entre ellos, los tres arreglos de **ADR-020** y el gate nuevo `guard-gates.sh`, que entró a
`ci.yml:101` sin haber corrido ahí ni una vez._

Entonces cada *"corre en CI"* de este board y de `DECISIONS.md` significa, con precisión: **el repo
declara que el step existe en `ci.yml`**. No significa que haya corrido. Es exactamente la misma
distinción que ADR-016 ya dejó escrita para otra cosa: `"status": "active"` en
`config/firewall-rules.json` significa *"el archivo declara que la regla debe estar publicada"*, no
que lo esté — y por eso T1 está cerrada **en nivel 1** y el `done` hay que leerlo entero. Los gates
tienen el mismo nivel 1 y el mismo nivel 2, y hasta hoy nadie los había separado:

| nivel | qué afirma | cómo se verifica |
|---|---|---|
| **1 · declarado** | el gate existe, pasa a mano, y `ci.yml` tiene su step | `bash scripts/<gate>.sh` + `grep` en `ci.yml` |
| **2 · ejecutado** | corrió sobre este commit, en Linux, sin la máquina del que lo escribió | una corrida de GitHub Actions — **hoy: cero** |

#6 es el precio de confundirlos: `accept-s1.sh` habría salido **verde** en `ubuntu-latest` midiendo
basura, porque `stat -f` no falla en GNU, significa `--file-system`. Un gate en nivel 1 que nunca
llegó al 2 no está probado en la plataforma donde va a correr, y el modo de falla no es rojo: es
verde.

**La lección, en una línea:** *"¿hay chequeo?"* → *"¿lo corre alguien?"* → *"¿está en `main`?"*
(la pregunta que abrió **T2**) → **"¿el CI que lo corre corrió alguna vez?"** → y desde **ADR-020**,
la que faltaba y no es sobre la corrida sino sobre el contenido: **"cuando pasa, ¿qué midió?"**.

> **Lo que destraba el nivel 2 es un `git push`, y no es una fila de este board:** no hay slice que
> lo cubra y no hay blocker que lo nombre. Se anota acá para que la próxima lectura de un *"corre en
> CI"* sepa qué está leyendo. **Comando que lo contesta en cualquier momento:**
> `git ls-remote --heads origin` — vacío significa nivel 1 para todos los gates del repo, sin
> excepción.

#### Tres más el mismo día — y esta vez la clase quedó cerrada por un gate  ·  **ADR-020**

Los seis de arriba son sobre **si el gate corre**. Los tres de abajo son sobre **qué mide cuando
pasa**, que es la pregunta que faltaba. Los tres estaban en la columna del **LEAD** (§4: todo gate
es del LEAD, porque el gate no puede ser del mismo writer que el código que audita), los tres están
arreglados, y los números del barrido serial de arriba ya son los de después.

| gate | la aserción escrita | lo que recogía | arreglo |
|---|---|---|---|
| `accept-s6.sh` **V5** | *"invalida la unidad, **no la vidriera entera**"* | `grep 'invalidateStorefrontUnit'` | reducida a la prohibición estática (`invalidateStorefront(` no se llama desde el camino de reservas), **y el radio se cuenta en V9** |
| `accept-s1.sh` **A2** | *"la vidriera baja de rol antes de consultar"* | `grep 'set local role'` en `tenant.ts` — **un archivo del que el invariante ya se había mudado**, y encima con `chk` sin importar, así que la línea se evaporaba | afirma el invariante que sobrevive al refactor: **el único `createDb(` de la vidriera vive en `storefront-db.ts`, y ese lugar abre transacción y baja a `anon`** |
| `accept-s3.sh` **M1** | *"ningún `srcset` sin `sizes`"* | escaneo del archivo **crudo**: un `srcSet` nombrado en **prosa** hacía abrir la ventana del tag en un `<` de comentario y reprobar `listings.ts` | blanquea comentarios y strings **por espacios** antes de escanear, para no mover un offset y que los números de línea sigan siendo los reales |

**La parte mecánica la cierra `scripts/guard-gates.sh`**, que corre sobre todo `scripts/*.sh` y falla
si un gate invoca una palabra que **no resuelve a nada** —ni función propia, ni de `_lib.sh` cuando
lo importa, ni builtin, ni binario en PATH— y también si **redefine** un helper que `_lib.sh` ya da.
Tiene step en `ci.yml:101` con `if: always()`, y su polaridad `guard-gates.test.sh` en `:105` con
**nueve** fixtures: se lo ve **encender** contra el árbol de ayer (`chk`/`have` prestados), contra la
redefinición y contra una invocación rota **dentro** de `_lib.sh`, y se lo ve **callar** ante un `chk`
propio legítimo, el árbol sano con `_lib.sh` adentro del barrido, G2 no acusando a `_lib.sh` de
duplicar lo que él mismo define, un `;` adentro de un string y un cuerpo de heredoc.

**Lo que ese gate NO cierra, dicho acá para que su verde no se lea de más:** cubre **una** de las
tres formas —la aserción que se evapora—. *"El nombre promete un cuerpo"* (V5) y *"el escáner
reconstruye un tag fantasma"* (M1) **no tienen gate y no lo van a tener**: hay que leer la aserción.
Se revisa contra ADR-020.

**No se auditaba a sí mismo: `T20`, abierta y cerrada el mismo día.** Su mensaje de éxito contaba 21
archivos con un `ls` y los dos barridos salteaban `_lib.sh`, así que auditaba 20 — y el que quedaba
afuera era la librería que importan los otros veinte. Lo levantó `docs-keeper` verificando una frase
de la propia ADR-020; lo arregló el LEAD, que es el dueño de `scripts/**`. Hoy `_lib.sh` entra a G1,
**G2 lo exceptúa con el motivo escrito en el código** (sus definiciones son el original, no una copia
que derive), y el número impreso sale del barrido (`AUDITADOS`), no de un `ls`, con la ausencia de
la línea contando como **FAIL**. Que el gate de los gates tuviera la forma que la ADR describe no es
irónico: es el motivo por el que la regla se escribió como una pregunta que se le hace a **todo**
gate, incluido el último. Y lo que la cerró no fue acordar una redacción —hubo dos, opuestas, las
dos leyendo media implementación— sino abrir el archivo y **medir los dos polos por separado**:
medidos, el diagnóstico valía para G1 y no para G2, y ninguna de las dos prosas contenía esa
asimetría.

**Dos cosas que se dejan escritas sin maquillar, porque el registro sirve para eso:**

- **El arreglo de M1 no destapó ningún rojo del producto.** `listings.ts` ya no tiene `srcSet` y el
  árbol entero pasaba también con el escáner viejo. **Se sacó una mina, no se arregló una falla
  viva**, y contarlo como bug encontrado inflaría el valor del arreglo.
- **El primer fixture con el que el LEAD intentó probar M1 no reproducía el defecto**: su prosa
  nombraba `sizes` antes que `srcSet`, así que la ventana del tag encontraba un `sizes` y el escáner
  viejo pasaba. Lo detectó corriendo el **escáner viejo** contra el fixture y viéndolo **pasar cuando
  tenía que encenderse**. Es el corolario que le faltaba a la regla de método de este board: **un fix
  cuya reproducción no se vio encender no está probado.**

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

**(a) Agendarla en el scheduler.** El job de expiración de reservas es de **S6** (FASE 4, no FASE 6)
y la implementación actual usa Inngest; `vercel.json` conserva sólo `$schema` y no declara **crons**.
El **rate limit** tampoco vive ahí — ver **T1**, y `guard-firewall.sh` F5 lo hace fallar—. Ojo con el
tamaño real de esta opción:
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
Postgres real. El caso es de **`qa-agent`** y vive en `tests/` por la regla de desempate de
`CLAUDE.md` §4, **en su redacción precisada del 2026-08-28** (`6929088`): el criterio no es *"cruza
tenants"* —eso era demasiado ancho y le sacaba a cada paquete el test de su propio código— sino
**quién es la auditoría de referencia**, o sea la afirmación que un gate cita y que queda parada
entre el defecto y el merge. Acá esa afirmación es *"el lock serializa de verdad"*, y no la puede
firmar el mismo writer que escribió el lock.

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

### S2.5 · el guard de IMEI rechazaba keys legítimas  ·  `media-agent`  ·  **CERRADA el 2026-09-04**

> **Qué era:** un defecto de disponibilidad en `packages/media`, medido, que atacaba directo el *done
> cobrable* de `CLAUDE.md` §1. **Estado histórico al abrir la fila:** `media-agent` tenía que
> resolverlo y el LEAD tenía que reejecutar la aceptación. **Cierre 2026-09-04:** la key canónica ya
> tiene una exención estructural, la key completa se revisa fuera de esa forma y el barrido de hashes
> reales, el caso negativo y el render degradado quedaron afirmados por los tests de `packages/media`.

**El defecto.** La key pública de una variante es content-addressed y **hexadecimal**:

```
v1/{2 hex}/{32 hex}.webp          packages/media/src/keys.ts:35
```

El guard de la key busca IMEI con `IMEI_RE = /\d{15}/` (`keys.ts:43`) — *quince dígitos seguidos*.
En una cadena hexadecimal de 32 caracteres, **una corrida de 15 dígitos decimales sale sola cada
tanto**, y cuando sale, `assertPublicVariantKey()` tira `UnsafeMediaKeyError` sobre una key que no
tiene ni podría tener un IMEI adentro: la key **no recibe** `tenantId` ni `listingId` ni nada del
equipo, es el hash del byte de salida. El guard fue escrito para atrapar un identificador filtrado y
está rechazando ruido criptográfico.

**Los números, medidos por `qa-agent` y verificados por el LEAD con 2.000.000 de hashes:**

| medición | valor |
|---|---|
| variantes rechazadas | **0,631%** — 1 de cada 158 |
| **fotos imposibles de subir, para siempre** | **1,88%** |
| onboardings de 15 equipos que pegan al menos una | **57%** |

> **Los mismos números, medidos otra vez por `media-agent` en el árbol de trabajo, dan 0,633% ·
> 1,89% · 57,6%** (`packages/media/src/keys.ts`, docblock: *"12.665 de 2.000.000 de hashes"*, con el
> cálculo cerrado `0.625^15 + 17 · 0.375 · 0.625^15` = 0,639%). **La diferencia con los 0,631 / 1,88
> / 57 de arriba es muestreo, no desacuerdo** — dos corridas Monte Carlo de la misma probabilidad —,
> y se dejan las dos escritas en vez de elegir una: la de arriba es la que verificó el LEAD, la de
> abajo la que va a quedar en el código. **Que aparezca el cálculo cerrado importa más que el
> tercer decimal:** una medición sin fórmula al lado no distingue un defecto de un mal día del RNG.

**El "para siempre" es la parte que lo vuelve severidad alta, no una molestia.** La key es
**determinista**: es el SHA-256 del byte de la variante. Reintentar produce **exactamente el mismo
rechazo**. No hay reintento, ni "probá de nuevo", ni backoff que ayude: esa foto, de ese equipo, no
entra nunca. Y el rechazo pega en el `assertPublicVariantKey(key)` de `upload.ts:85`, o sea **antes
del PUT**, así que el dueño lo ve como un error al cargar.

Contra qué se mide: `CLAUDE.md` §1 define el *done cobrable* como **"un reseller de Cipolletti carga
15 equipos en una tarde"**. Más de la mitad de esas tardes pega al menos un equipo que no se puede
publicar, sin ninguna explicación que le sirva a quien lo está viviendo.

**Segundo orden, y es peor que el primero.** El **mismo** guard corre en el **render**, no sólo en el
upload: `publicUrlForKey()` llama `assertPublicVariantKey(key)` en `packages/media/src/url.ts:31`, y
`variantUrl()` se invoca desde `(storefront)/_lib/listings.ts:244-245`, **adentro del `'use cache'`
de la vidriera**. Bajo `cacheComponents`, un throw dentro de un render cacheado **no es un 500: es un
200 que nunca cierra el stream** — la ficha **cuelga**. El propio repo ya tenía escrita la mecánica
en otro lado (`listings.ts:435`: *"un throw de render bajo `cacheComponents` + PPR es un stream que
no cierra, no un 500"*), y acá se cumple con una key que la base ya guardó.

**Criterio de cierre que guió la corrección:** la solución tenía que afirmar el efecto y no sólo la
forma del regex:

- la aserción tiene que ser sobre el **efecto** —una key que hoy es rechazada deja de serlo y la foto
  sube— y no sobre la forma del regex;
- tiene que existir el caso **negativo**: una key con un IMEI de verdad adentro sigue siendo
  rechazada. Un guard que se afloja hasta dejar pasar todo también arregla el síntoma;
- y el camino de **render** tiene que quedar cubierto aparte del de **upload**, porque son dos
  llamadas distintas al mismo guard con dos modos de falla distintos (error visible vs. página
  colgada).

**Estado del árbol, corregido el 2026-08-28: ya está todo en `main`, y este párrafo decía lo
contrario.** La versión anterior listaba `packages/media/src/{keys,url,index}.ts` + sus tests,
`packages/media/src/incidents.ts` y `scripts/guard-gates.sh` como **sin commitear**. Los cinco
archivos existen en `HEAD` (`git cat-file -e HEAD:<path>` resuelve para todos), repartidos entre
**`1fc0e59`** (`keys.ts`, `keys.test.ts`, `incidents.ts`), **`6e74a51`** (el subpath `/incidents`
medido contra el barrel) y **`f691daf`** + **`2ad4fd7`** (`guard-gates.sh`). El docblock de `keys.ts`
describe la exención por **estructura y posición** y `keys.test.ts` trae los tres criterios de
arriba, incluido el barrido sobre 200.000 hashes reales y el caso negativo de una key no canónica
con un IMEI.

**Cierre verificado 2026-09-04:** `packages/media/src/{keys,url,index}.ts` y sus tests contienen la
solución; `keys.test.ts` censa 200.000 hashes reales y conserva el rechazo de una key no canónica con
un IMEI, mientras `url.test.ts` cubre la degradación del render. `pnpm --filter @istock/media test`
→ **166 passed**. El artefacto y la reejecución que faltaban ya están registrados en la fila activa.

### S3.1 · un tenant real nace sin FX y sin punto de retiro  ·  **CERRADA el 2026-08-28**

> **`done`.** El LEAD re-ejecutó `bash scripts/accept-s3.sh` (50 PASS, 0 FAIL). Lo que lo prueba no
> es que el `insert` esté escrito sino que M3 exige, contra el HTML servido, el punto de retiro
> (`Local Neuquén centro`), su horario (`lun a vie de 10 a 18`), el segundo punto y un ARS con la
> forma de `formatArs` terminado en `000` — y esos cuatro datos sólo existen si `fx_settings` y
> `locations` están sembrados.
>
> **Lo que el código ya hacía desde `eaccfee` (`docs-keeper`, verificado contra el repo).**
> `create-tenant.ts` inserta hoy `tenants` + `memberships` + `fx_settings` (`:320`) + un punto de
> retiro (`:328`) en una sola transacción, y `automatic-rate.ts` valida la cotización oficial del
> BCRA antes de sembrar el TC. El punto
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

### S3.3 · la ficha de un tenant que no existe decía que el equipo se vendió  ·  **CERRADA el 2026-08-28** (`042e24e`)

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

**Alcance:** ~10 líneas. Un `getStorefrontTenant(slug)` y `<StorefrontMiss />` en la rama `null`. La
función ya es `'use cache'` y ya cachea su `null` con `STOREFRONT_MISS_LIFE` (`_lib/tenant.ts:71-100`),
así que **no agrega una query por pageview**: el bot que escanea subdominios sigue pagando una vez y
cero después. No toca el camino feliz.

> **Este párrafo decía "antes del loader de la ficha" y así implementado habría sido un defecto de
> costo.** Preguntar por el tenant **antes** le suma una consulta a **toda** ficha, incluidas las 99
> de cada 100 que sí existen, para arreglar el caso raro. La entrega lo pregunta **después** del
> `null`, y ese orden es hoy un invariante testeado. Se deja el error a la vista porque es la clase
> de detalle que un diagnóstico correcto puede arruinar en la línea de la solución.

**Gate:** una ficha bajo un slug de tenant inexistente contesta el *tenant-miss* y no el
*listing-miss*, con el `noindex` de ADR-011 y sin perder el cacheo corto del `null`.

**No es ADR-011 ni su corolario de `ba8536c`.** Aquellos son sobre el **status** y sobre que la
primera request no salga en blanco. Éste es sobre **cuál de los dos textos** se devuelve, y los dos
casos ya salen 200 con contenido.

**Cerrada el 2026-08-28 (`042e24e`), y el LEAD lo verificó contra un server real** —`next build` +
`next start`, leyendo el **HTML servido**, no el fuente— con dos controles adentro de la medición:

| caso | `<title>` | marcador |
|---|---|---|
| A · `{inventado}/p/lo-que-sea` | No hay ninguna vidriera en esta dirección | `data-storefront="miss"` |
| D · `{inventado}/` (**control**: la home ya distinguía) | idéntico a A | `miss` |
| B · `demo/p/no-existe` | Este equipo ya no está publicado | `listing-miss` |
| C · ficha real (**control**: el camino feliz sigue vivo) | iPhone 14 Pro 256 GB Negro espacial — USD 620 | `index, follow` + 1 `wa.me` |

Cero `wa.me` en el DOM de los dos miss. `accept-s3.sh` re-ejecutado entero: **58 PASS · 0 FAIL ·
`S3: ACEPTADA`**, con **`MEDIDO s3 db-hits · primera=9 · cacheada=0`** — el **mismo** número que
antes del fix, que es la forma de decir que **el camino feliz no se encareció**.

**Cómo quedó, en una línea:** el desempate se pregunta **después** del `null` y nunca antes
(`storefrontExists()`), y cuerpo y metadata lo resuelven con **el mismo predicado en un solo lugar**
(`missMetadataFor()`) porque son **dos entradas de cache distintas**: copiado, deriva, y sale un
`<h1>` de una respuesta con un `<title>` de la otra.

`ficha.test.ts` pasó de 15 a **24** tests. El que importa no es ninguno de los de texto sino el
**invariante de costo**: `expect(tenantAt).toBeGreaterThan(listingAt)` (`:219-227`), que se pone rojo
el día que alguien suba el `getStorefrontTenant` arriba del `getStorefrontListing`. Es una aserción
sobre la posición en el **fuente** del módulo, y está bien que lo sea: lo que defiende es el orden
de las llamadas, y ninguna medición de HTML lo puede ver.

**Trae además una decisión que la fila no pedía:** un slug de tenant que **no pasa `isSlugShaped`**
contesta el tenant-miss **sin consultar Postgres**, apoyándose en el CHECK `tenants_slug_format` de
`packages/db` — si no puede entrar a la tabla, no hace falta preguntar.

**Deuda aceptada, no fila:** en el miss frío el tenant se consulta **dos veces**. Está escrita con su
número medido en `DECISIONS.md` §Notas operativas (*"La consulta duplicada del tenant en el miss frío
es deuda aceptada"*). **No abre fila accionable** y eso es deliberado.

**Hallazgo de la medición que NO es un defecto, anotado para que nadie lo re-diagnostique:** el HTML
servido de una ficha **sana** contiene la palabra `noindex`. Está en el payload de RSC, no en el
`<meta>`. Detalle y números en `DECISIONS.md` §Notas operativas.

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

### T12 · editar configuración visible y puntos de retiro después del alta  ·  `app-agent`  ·  **CERRADA el 2026-09-04**

> **Actualización 2026-09-04:** el campo manual de tipo de cambio que describía esta sección fue
> retirado. El alta y el cron de expiración (cada 5 minutos) usan la cotización oficial del BCRA,
> cacheada una vez por día; la vidriera sólo lee el último valor persistido. `/app/ajustes` permite
> editar nombre, WhatsApp, medios de pago, canje y puntos de retiro después del alta, e invalida la
> configuración pública después del commit.

`apps/web/app/(app)/app/(panel)/ajustes/page.tsx` contiene el formulario de configuración visible y
aclara que la cotización se actualiza sola. No hay una mutación manual de `fx_settings`: el alta la
siembra y el cron de expiración la mantiene con la cotización diaria cacheada.

**Por qué esto es producto.** El TC se sincroniza una vez por día desde la cotización oficial del
BCRA y no se consulta en el hot path (`CLAUDE.md` §1). Así el dueño no carga valores a mano, el alta
nace con ARS y la vidriera se actualiza con invalidación de cache al correr el cron.

Lo mismo con los puntos de retiro: el alta siembra **uno solo** y es un placeholder honesto
(*"A coordinar por WhatsApp"*, `city` en `null` a propósito). El plan Negocio vende **3 puntos de
retiro** (`CLAUDE.md` §1) y punto de retiro + horario son campos **obligatorios** de la ficha mínima.

#### El requisito de aceptación que nació antes que la slice — agregado el 2026-08-28 al cerrar S6.2

Esto va escrito acá, en la fila, **no en un docblock**, porque el docblock lo va a leer quien ya está
adentro de `storefront-cache.ts` y el que va a romper esto es quien escriba una pantalla en
`ajustes/`.

**La mutación del TC tiene que llamar `invalidateStorefront(slug)`. No `updateTag(storefrontTag(slug))`.**

Hasta S6.2 el error habría sido inofensivo: la ficha registraba los dos tags de tenant, así que
cualquiera de los dos la alcanzaba. **Ya no.** Desde `f504d69`:

| diagnóstico histórico, verificado el 2026-08-28 | consecuencia |
|---|---|
| `tenant-config:{slug}` es el **único** tag de alcance tenant que le queda a la ficha en su camino de HIT | es el único que la puede purgar cuando cambia el TC |
| en ese corte `invalidateStorefront()` tenía **un solo caller**: `create-tenant.ts` | no había ningún ejemplo vivo de "editar config del tenant" del que copiarse |
| la ficha corre con `cacheLife('max')` | la entrada vieja vive **hasta un año** |

O sea: emitir `storefront:{slug}` a mano actualiza **la grilla** —que se ve bien, con el precio
nuevo— y deja **cada ficha del tenant con el TC viejo**, sin error, sin log y sin nada que se note
mirando la vidriera por arriba. El dueño sube el dólar, ve la grilla actualizada, y sigue vendiendo
al TC de la semana pasada por los links que ya circulan.

Es la misma clase de trampa que el `revalidateTag` vs `updateTag` del alta, y por el mismo motivo:
**el modo de falla es una página que se sirve perfecta con el dato viejo.**

Los puntos de retiro son idénticos: `tenant-config:{slug}` cachea también el punto, el horario, los
medios de pago y el teléfono.

**Cierre de T12:** `updateTenantSettings()` llama `invalidateStorefront(slug)` luego de guardar. La
E2E de S12 perturba una configuración visible, espera el guardado y vuelve a abrir el host público;
la vidriera recibe el nombre nuevo. El TC sigue fuera del editor por diseño: lo mantiene el cron
diario del BCRA y el dominio conserva el redondeo.

### T13 · `/_media` expone `Timing-Allow-Origin`  ·  `app-agent`

La ruta responde con `content-type`, `content-length`, `cache-control` inmutable,
`Timing-Allow-Origin: *` y `x-content-type-options`. Las fotos se sirven desde **otro origen**
que la vidriera (`img.maat.work` contra `{slug}.maat.work`; en local
`127.0.0.1.nip.io:3100/_media/…` contra `{slug}.127.0.0.1.nip.io:3100`), y para un recurso
cross-origin el spec de Resource Timing reporta `transferSize`, `encodedBodySize` y
`decodedBodySize` en **0** salvo que la respuesta traiga `Timing-Allow-Origin`.

Antes la ausencia del header hacía que la Resource Timing API ocultara los bytes cross-origin. La
ruta local ahora lo emite y `s2-la-foto-del-duenio-llega-en-150kb.spec.ts` lo afirma sobre la
respuesta HTTP real. El e2e de bytes sigue usando `request.sizes()` para medir el cuerpo sin
depender de CORS, y el test del header protege el prerrequisito de cualquier RUM posterior.

El gate de bytes conserva la medición por `request.sizes()` porque cuenta el costo real del cuerpo y
no el dato que expone el browser. La prueba nueva de `Timing-Allow-Origin` evita que una futura
medición de Resource Timing vuelva a confundir ausencia de permisos con una imagen de cero bytes.

> **Ojo con el path.** El directorio en disco es `apps/web/app/(app)/%5Fmedia/[...key]/`, con el
> guión bajo **percent-encoded**: un `_` literal haría que Next tratara la carpeta como privada y la
> ruta no existiría. La URL pública sí es `/_media/…`. Buscarla como `_media` no la encuentra.

**Cerrada para el driver local el 2026-09-04:** `route.ts` emite `Timing-Allow-Origin: *` y el spec
de media lo comprueba sobre HTTP. **Cerrada para el CDN productivo el 2026-09-05:** la regla externa
de Cloudflare para `img.maat.work` fue inspeccionada con una sonda API directa, que vio los dos headers
en el 200 de un WebP temporal y en el 404 posterior a borrar/purgar. Esto cierra T13 para CDN; E11
con throttling sigue **UNVERIFIED**, y la sonda no cierra K5/S2.1 porque no subió el byte mediante el
pipeline de la app.

### T14 · dos prohibiciones de `CLAUDE.md` §2 que ningún gate afirma  ·  `qa-agent`

Verificado una por una el 2026-08-28 contra los gates del repo. **De la lista de §2 quedan dos sin
nadie que las chequee.** El número se movió dos veces el mismo día y las dos quedan escritas, porque
el recorrido es el contenido: el título decía *dos* mientras la fila ya decía *tres* (se había
anotado **T14.3**), y esa tarde `W016` cerró la **1** y lo devolvió a dos. La numeración de los
puntos **no se corre**: `T14.2` y `T14.3` se citan por número desde `TEST_MATRIX.md`, así que la 1
se queda en su lugar, tachada.

1. ~~**Rate limiting con contador en Postgres sobre la vidriera.**~~ **CERRADA el 2026-08-28 por
   `W016`** (`apps/web/scripts/web-lint.mjs`, LEAD). Fila del gate: **T26**. Lo que decía esta fila y
   ahora tiene dueño: *"T1 puso el techo del lado del edge (`config/firewall-rules.json` +
   `scripts/guard-firewall.sh`, `4fce968`); esta fila es que **nada detecta la violación del lado
   del código** … mañana alguien mete un `insert into rate_limit_hits` en el render de la vidriera y
   todo el pipeline sale verde"*. Es exactamente lo que W016 rompe, y por los dos caminos: nombrar
   el concepto en un archivo que abre Postgres, **y** la forma del contador aunque no se nombre.
   **El desempate de columna de más abajo se resolvió al revés de lo que este board prefería** — ver
   la nota que sigue a los tres puntos.
2. **Imagen original (>500 KB) servida a la vidriera.** Hay dos chequeos y **ninguno corre en cada
   push**: el probe `scripts/probes/s2-media-measure.test.ts:47` fija
   `MASTER_MAX_BYTES = 800 * 1024` pero sólo se ejecuta **dentro de `accept-s2.sh`** (`:32`), que no
   es un job de CI; y el byte que el browser **baja** lo mide M2 de `accept-s3.sh` (techo
   204800 B). El propio `guard-r2.sh:12` declara que esta regla queda afuera de él (*"cubierto por
   scripts/probes, no aca"*). La regla existe en dos lados y no corre en ninguno.
   **Actualizado el 2026-08-28:** M2 ya no está bloqueado —corrió y midió `transferSize=51016B`—
   pero eso **no cierra esta fila**: `accept-s3.sh` sigue sin ser un job de CI, así que la regla se
   afirma cuando el LEAD corre el gate a mano, no en cada push. Que es justo lo que T14 pide.
3. **Borrado de un objeto de R2 por key al borrar un listing** (**T14.3**, anotada el 2026-08-28 por
   `qa-agent`). `guard-r2.sh` la cubre **estáticamente** (R1+R2, T11) y `packages/media/src/unlink.test.ts`
   afirma el efecto **desde el paquete que la implementa**. Lo que falta es la auditoría de
   referencia del **efecto** en la columna de `qa-agent`: que borrar un listing borre **el mapeo** y
   **no el byte**. La trampa está escrita en `packages/media/src/keys.ts:26` —dos tenants que suben
   la misma foto comparten el objeto— y hoy nada la frena el día que alguien escriba el borrado.

**Desempate de columna, para que no se trabe cuando se agende.** Si la forma que se elige es un
grep-guard en `scripts/**`, el dueño es el **LEAD** —un gate no puede ser del mismo writer que el
código que audita, igual que **T2**—. `qa-agent` es el dueño si la forma es un test que **siembra la
violación** en `tests/`. La segunda es preferible para la 1: un grep de *"rate limit"* es fácil de
esquivar sin querer.

> **Y para la 1 se eligió la primera. Vale anotar por qué el reparo de arriba no se cumplió**, que
> es lo único que este board puede aportar sobre una decisión que ya se tomó. El reparo era que *"un
> grep de «rate limit» es fácil de esquivar sin querer"* — y es cierto de un grep de una sola forma.
> `W016` **no** es eso: tiene **dos brazos que no se implican**, y el segundo no busca el nombre sino
> **la forma del contador** (`onConflictDoUpdate`, `+ 1` adentro de un template de `sql`,
> `increment`, `count = count + …`). El caso *"esquivar sin querer"* tiene fixture propio en el
> arnés: *"upsert en la vidriera sin nombrar el concepto: el contador que no se declara"*, y **FIRES**.
> El brazo del nombre sólo se enciende si además el archivo **abre Postgres**, que es lo que evita
> que la regla castigue al que documenta la prohibición. La 2 y la 3 siguen sin decidir columna.

**Lo que sí tiene gate y este board no vuelve a pedir** (verificado, para que nadie lo reabra):

| prohibición de §2 | quién la afirma hoy | ¿tiene step en CI? |
|---|---|---|
| `tenant_id` fuera de `app_metadata` | `guard-leaks.sh:127` (§7) · `apps/web/scripts/web-lint.mjs:123` (W008) · `accept-fase3.sh:61` | sí, **los tres** desde `c854b99` — `accept-fase3.sh` entró ese día (`ci.yml:137`) |
| tabla nueva sin `GRANT` | `scripts/guard-grants.sh` | sí, desde `985c369` — antes **sólo** corría dentro de `accept-s1.sh`, que **tampoco** estaba en CI hasta `c854b99` (`ci.yml:205`) |
| **`GRANT` de `INSERT` por columna incompleto** (la tabla tiene `GRANT`, y el panel igual recibe `42501`) | **`G6`**, `scripts/probes/el-grant-cubre-el-insert-de-drizzle.test.ts`, dentro de `accept-fase2.sh` §**D5**. Pregunta al catálogo, no ejecuta `INSERT` | sí, vía `accept-fase2.sh` (`ci.yml:137`, el único job con Postgres migrado y seedeado). **Nace del fallo de T21**: `guard-grants.sh` dijo PASS con el alta de reservas rota, porque cuenta que el `GRANT` **exista** y uno parcial existe. Ver §"T21 · el primer fallo" |
| borrado de un objeto de R2 por key | `scripts/guard-r2.sh` R1 + R2 (**T11**, `done`) | sí |
| **query sin filtro de tenant** | `W015` de `apps/web/scripts/web-lint.mjs` (**T2**, `done`) | sí, vía `pnpm -r lint` (`ci.yml:64`). **Alcance `apps/web` → `packages/**` sigue descubierto: T16** |
| **rate limiting con contador en Postgres sobre la vidriera** | **`W016`** de `apps/web/scripts/web-lint.mjs` (**T26**, LEAD). **Dos brazos que no se implican:** (a) archivo de `(storefront)` que **abre Postgres** *y* **nombra el concepto en código** — puerta por archivo, concepto por **línea**, saltando comentarios; (b) la **forma** del contador (`onConflictDoUpdate`, `+ 1` en un template de `sql`, `increment`, `count = count + …`) **aunque no se llame *rate limit***. **Sin marcador de exención, a diferencia de W015**, y por un motivo escrito: no existe la vidriera que legítimamente cuente en Postgres. **Falla cerrado**: `(storefront)` vacío = rojo | sí, vía `pnpm -r lint` (`ci.yml:64`), + polaridad propia en `ci.yml:156`. **Cierra T14.1**, la última de las 14 prohibiciones de §2 sin gate ejecutable. `guard-firewall.sh` cubría **la mitad de afuera**: nada impedía escribir el contador igual y quedarse con las dos capas |

**Los "sí" de esta columna son de nivel 1.** `ci.yml` nunca corrió (§"Seis gates rojos o dormidos"):
significan *"el repo declara el step"*, no *"se ejecutó"*.

### T26 · `W016` — el techo de abuso de la vidriera es el WAF, no una query  ·  **LEAD**

**Qué cierra.** La última de las **14 prohibiciones de `CLAUDE.md` §2 sin gate ejecutable** (el censo
es de `qa-agent`): *"rate limiting con contador en Postgres sobre la **vidriera** → rechazo"*. Era
**T14.1**. Lo que la hacía la más barata de violar sin darse cuenta es que **anda**: un contador de
requests en Postgres son tres líneas de Drizzle. Lo que rompe no es la query, es la premisa —§3 fija
que **el 95% de los hits de vidriera no tocan Postgres**, y un contador los hace tocar el 100%.

**Por qué `guard-firewall.sh` no alcanzaba, aunque exista y esté verde.** Cubre **la mitad de
afuera**: que la regla de WAF exista en `config/firewall-rules.json` y que ninguna ruta quede sin
decidir. Nada impedía escribir el contador **igual** y quedarse con las dos capas, pagando la cara.
Es la misma distinción que ya estaba escrita en la fila de **T1** y que este board dejaba en 🔴:
*una configura un límite, la otra prohíbe una implementación.*

**Dos brazos, porque la infracción tiene dos formas y ninguna implica la otra.**

| brazo | qué busca | granularidad |
|---|---|---|
| (a) **el concepto, con la puerta abierta** | archivo de `(storefront)` que **abre Postgres** (`withStorefrontDb`, `createDb`, un import de `@istock/db` o de `drizzle-orm`) **y** nombra el concepto en código (`rate limit`, `throttle`, `leaky bucket`, `token bucket`, `sliding/fixed window`) | **archivo entero** para la puerta, **línea** para el concepto |
| (b) **la forma del contador** | `onConflictDoUpdate`, `+ 1` adentro de un template de `sql`, `increment`, `count = count + …` — **aunque no se llame *rate limit*** | línea |

El (b) es el que hace que el reparo que este board tenía anotado —*"un grep de «rate limit» es fácil
de esquivar sin querer"*— no se cumpla: el contador que **no se declara** tiene fixture propio y
**FIRES**.

**El detalle que decide si la regla sirve o estorba: el brazo (a) mira la línea, no el archivo.**
`app/(storefront)/s/[slug]/api/track/route.ts:34` **abre Postgres** y **explica la prohibición en su
docblock** (*"Tampoco hay contador de abuso propio: `CLAUDE.md` §2 prohíbe rate limiting con contador
en Postgres sobre la vidriera"*). Una regla que se encienda ahí es una regla que **castiga por
documentarse**, y el repo ya pagó ese modo de falla una vez: es el `TODO`/`TODOS` de la regla 3 de
`guard-leaks.sh`. Funciona porque `scan()` saltea comentarios, así que **W016 depende de `scan()`**
y no de su propio regex — vale saberlo el día que alguien toque `scan()`.

**No hay marcador de exención, a diferencia de W015, y el motivo está escrito en el código.** W015
tiene marcador porque **existen** preguntas legítimamente cross-tenant (resolver a qué tenant
pertenece una sesión es anterior a tener tenant). Acá **no existe la vidriera que legítimamente
cuente en Postgres**: §2 dice *rechazo*, sin condición. Si algún día existe, la excepción la escribe
el LEAD **en la regla**, con nombre y motivo — no una marca que se copia y se pega.

**Falla cerrado.** Si `(storefront)` está vacío, W016 sale **rojo**, no verde: *medir cero no es
aprobar*. Es la misma forma que ya tienen W015 (schema ilegible = FAIL) y `guard-artifacts.sh` sin
argumentos, y tiene fixture: *"sin un solo archivo de (storefront), W016 FALLA"*.

**Lo medido, verificado por `docs-keeper` el 2026-08-28** (re-corrida, no citada de un reporte):

```
$ cd apps/web && node scripts/web-lint.mjs
ok    W016 ninguno de los 23 archivos de (storefront) cuenta requests en Postgres (el techo es el WAF)
WEB-LINT: PASS (16 reglas)

$ bash scripts/web-lint.test.sh
POLARIDAD WEB-LINT: OK — las 16 reglas se vieron encender.
```

**La polaridad.** 8 casos nuevos en `scripts/web-lint.test.sh`, y la
forma importa: **tres pares FIRES/SILENT sobre el mismo path** —que es la regla del arnés, porque un
par sobre paths distintos prueba el path y no la regla— más dos FIRES sueltos.

| par / caso | FIRES | SILENT |
|---|---|---|
| el concepto en código vs. en un comentario | *"gemelo: el mismo archivo, el mismo concepto, pero en codigo"* | *"abre Postgres y NOMBRA la prohibicion en un comentario: documentarse no es violarla"* |
| el concepto con y sin la puerta a Postgres | *"gemelo: el mismo concepto, ahora con la puerta a Postgres abierta"* | *"nombra rate limit pero no abre Postgres: leer el veredicto del WAF es lo correcto"* |
| `+ 1` de aritmética vs. `+ 1` adentro de `sql` | *"gemelo: el mismo `+ 1`, adentro de un template de sql"* | *"aritmetica de strings con `+ 1` no es un contador: el shape real de `_lib/host.ts`"* |
| el contador que no se declara | *"upsert en la vidriera sin nombrar el concepto"* | — |
| la lista vacía | *"sin un solo archivo de (storefront), W016 FALLA (medir cero no es aprobar)"* | — |

El arnés mide **contra el ID de la regla, no contra el exit code**, y el motivo está en
`ci.yml:153-155`: con 16 reglas sobre un mismo árbol, un fixture puede salir rojo **por la regla
equivocada** y eso reportaría cobertura sin haber ejercido nada.

**Por qué esta fila es propia y no un residuo de T2.** Es la pregunta que el LEAD dejó abierta al
despachar el registro, y la respuesta de este board es **fila propia**, por tres razones que valen
más juntas que separadas: **(1)** cierra una **prohibición distinta** de §2 —T2/W015 cierra *query
sin filtro de tenant*, ésta cierra *rate limiting con contador*— y el board indexa por prohibición,
no por archivo; **(2)** tiene **arnés propio y step de CI propio**, así que puede estar roja mientras
W015 está verde, y una fila que puede fallar sola necesita estado propio; **(3)** `TEST_MATRIX.md`
las lista en **filas separadas de la tabla de §2**, así que meterla como residuo dejaría la
prohibición de rate limiting sin fila que la sostenga y con un ✅ apuntando a la de otra regla — el
mismo hueco que este board acaba de cerrar en la tabla. Compartir archivo (`web-lint.mjs`) no es
compartir invariante.

**Cerrada el 2026-08-28 (`d37e6b3`), y lo que faltaba no era una medición.** Los tres archivos
—`web-lint.mjs`, `web-lint.test.sh`, `ci.yml`— estaban modificados **sin commitear**, y esta fila se
quedó en `doing` por eso: la regla que este board aprendió en T2 no se relaja porque el autor sea el
LEAD — *un gate en el árbol de trabajo de una sola máquina no protege a nadie más que a quien lo
tiene abierto*. `d37e6b3` los trae a `main` en un solo commit.

**Verificado contra `main`, no contra el árbol**, que es la distinción entera de esta fila:
`git show HEAD:apps/web/scripts/web-lint.mjs \| grep -c W016` devuelve **4** y
`git cat-file -e HEAD:scripts/web-lint.test.sh` resuelve. La re-corrida sobre el árbol limpio sigue
dando `WEB-LINT: PASS (16 reglas)` con la línea de W016. **Queda una quinta pregunta abierta y no es
de esta fila:** el CI que corre `web-lint.test.sh` (`ci.yml:156`) **nunca corrió**, porque
`git ls-remote --heads origin` sigue vacío contra 125 commits. Eso hace a W016 un gate de **nivel
1**, igual que a todos los demás, y está anotado como tal en `TEST_MATRIX.md`.

### T27 · dos resolvers de entitlements, dos motivos, y el que se muestra es el equivocado  ·  `app-agent`

**Lo medido, contra `main` (`b9a8e05`), no contra el árbol.** Con una fila de `entitlements` en
`enabled = false` para el mismo tenant y la misma feature:

| resolver | archivo | veredicto |
|---|---|---|
| `hasEntitlement()` | `app/(billing)/_lib/entitlements.ts:110` | `{ ok: false, reason: 'flag_off' }` |
| `featureAccess()` | `app/(app)/_lib/entitlements.ts:203` | `{ ok: false, reason: 'plan' }` |

En `main` el tipo `FeatureAccess` de `(app)` ni siquiera **tiene** el caso: es
`'plan' | 'trial_expired'` y nada más, así que no era un mapeo mal elegido — era un vocabulario al
que le falta una palabra.

**Por qué esto es producto y no consistencia de tipos.** `publish-listing.ts` traduce el motivo a
español: `case 'plan'` (`:144`) sale por *«Eso viene con el plan Negocio.»* (`:176`). O sea, el
único camino que existe hoy para apagarle una feature a un tenant **sin bajarle el plan** —la fila,
que es la palanca fina que ADR-018 §6 declara— produce en pantalla una invitación a comprar el plan
que ese tenant **ya está pagando**. El dueño no puede resolverlo: no hay nada que comprar. Es el
mismo defecto de copy que `reserve-unit.ts` ya tenía documentado para `trial_expired`, sólo que en
la rama que nadie había recorrido porque **nadie escribe filas todavía** (ver la nota de abajo).

**Quién lo levantó y quién no lo puede arreglar.** Lo levantó `billing-agent` desde su propia
columna, y lo dejó **fijado en `entitlements.test.ts`**, no comentado — que es la forma correcta:
`(app)/_lib/entitlements.ts` es de `app-agent` por §4, así que se reporta y no se toca. El LEAD lo
verificó y lo despachó a `app-agent`, que **está arreglándolo mientras se escribe esto**: el árbol
de trabajo marca `apps/web/app/(app)/_lib/entitlements.ts` y `publish-listing.ts` como `M`, y la
versión del árbol ya declara `flag_off` en el tipo y lo devuelve en `:203`.

**Cerrada el 2026-08-28, y por la mitad que faltaba: el gate.** El LEAD escribió
`scripts/accept-t27.sh` —con su probe `scripts/probes/t27-un-motivo-una-voz.test.ts`— y el comando
cierra en `T27: ACEPTADA`, exit 0, 11 PASS · 0 FAIL, con cuatro mutaciones que se lo vieron
encender. **La salvedad que llevaba esta fila ya venció, y se deja escrita porque explica el
trato:** decía que el arreglo y el gate estaban en el **árbol de trabajo, sin commitear**, y que por
eso el `done` había que leerlo como *"corrida sí, commit todavía no"* — el mismo trato que tenía
**T28**. **Las dos cerraron el círculo el 2026-08-28**: T27 está en `main` con `d85310a` (el
arreglo) y `4459cff` (el gate), T28 con `4d33be6`. Lo que queda vigente es la regla, no el estado:
lo que mueve una fila es **la corrida del LEAD**, el board **escribe al lado si el código todavía no
está commiteado** en vez de mantener una fila cerrada en `doing`, y si el commit no llega, lo que
queda mal no es la fila: es el árbol.

**Lo que esta fila NO abarca, escrito para que nadie lo lea de más.** No es *"unificar los dos
resolvers"*. `hasEntitlement()` tiene dos cosas más que `featureAccess()` no tiene —el techo
(`limit`, que es lo único en el repo capaz de contestar *cuántos* puntos de retiro le tocan a un
plan) y el camino de escritura— y fusionarlos son tres cambios de semántica. **Esa decisión es del
LEAD y no está tomada**; acá se cierra la divergencia del **motivo**, que es la que le miente al
dueño.

#### Nota de colisión: **disuelta el 2026-08-28** — las dos filas cerraron, la pregunta quedó sin contestar

Estuvo abierta mientras `app-agent` tuvo **dos** filas en `doing` a la vez —**T18** (código en
`main`, esperando la corrida del LEAD) y **T27** (arreglo en el árbol de trabajo)—, contra el
*"máximo **una** slice en `doing` por directorio owner"* del encabezado. **Se disolvió por el único
camino que la disolvía: las dos corridas.** `bash scripts/accept-s6.sh` → `S6: ACEPTADA` (T18, la
corrió el LEAD) y `bash scripts/accept-t27.sh` → `T27: ACEPTADA` (11 PASS · 0 FAIL). `app-agent`
queda con **cero** filas en `doing`.

**Lo que no se resolvió es lo que la nota preguntaba**, y se deja escrito porque el empate va a
volver: elegir si *esperando gate* cuenta para el tope de `doing`, o degradar una de las dos filas,
**es del LEAD** y sigue sin decidirse. La colisión no salió de trabajo de más: salió de que
*entregado sin correr* y *en curso* comparten un solo estado, y el board no tiene un quinto estado
a propósito. `docs-keeper` no puede cerrar esto solo, y tampoco podía entonces dejar una de las dos
en `todo` para que el conteo cerrara: eso sería falsear el estado para satisfacer una regla sobre
el estado.

**El segundo hallazgo también cerró, y ese sí cambió el árbol.** Era distinto de la colisión: T27
estaba en `doing` **sin comando de aceptación** —su columna remitía a esta nota y esta nota no tenía
ninguno—, y una fila así **no puede llegar a `done` por definición** (`CLAUDE.md` §0.2: nada es
`done` sin un comando que el LEAD re-ejecute). `docs-keeper` lo reportó y **no lo inventó**:
escribir el gate es del LEAD. El LEAD lo escribió, y lo que era prosa —*"los dos resolvers dan el
mismo motivo para la misma fila y el copy del panel dice que alguien la apagó, no que falta plan"*—
hoy son las cinco verificaciones de `scripts/accept-t27.sh`. El test de `billing-agent` que había
dejado el defecto **fijado** (`apps/web/app/(billing)/_lib/entitlements.test.ts`) sigue siendo lo
que era, material para un gate y no un gate: corre en la **V5**, declarado como red de regresión del
writer y **no** como certificado.

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

### S4.1 · el mensaje de WhatsApp repite storage y color sin `catalog_model`  ·  **CERRADA el 2026-08-28** (`7e40856` + `07c42ff`)

Abierta el 2026-08-28, **medida y no inferida**. La imprime W5 de `./scripts/accept-s4.sh` sobre un
browser real contra un build real:

```
href=https://wa.me/54…?text=Hola%2C%20vi%20el%20iPhone%2014%20Pro%20256%20Grafito%20256%20Grafito%20(usado%20A)%20…
```

Decodificado: `Hola, vi el iPhone 14 Pro 256 Grafito 256 Grafito (usado A) a USD 620 en … y lo quiero.`
Canónico según `CLAUDE.md` §1: `… el iPhone 14 Pro 256 Grafito (usado A) …`

**La causa, en dos archivos de dos columnas distintas.** ⚠️ **Las dos líneas de abajo describen el
código ANTERIOR a `07c42ff` y ya no están ahí** — se dejan porque son el diagnóstico, no el estado;
lo que hay hoy en esos archivos está en el bloque *"Lo que aterrizó"* al final de esta sección.

- `packages/domain/src/wa.ts:53` (pre-`07c42ff`) — `describeListing` armaba `[modelDisplayName,
  storageGb, color]`, y el contrato del campo decía textual *"nombre de display del `catalog_model`"*.
- `apps/web/app/(storefront)/_lib/listings.ts:282` (pre-`07c42ff`) — `modelDisplayName: row.modelDisplayName ?? row.title`.
  Sin `catalog_model` cae al `title`, que es **texto libre del dueño** y en la práctica ya trae
  storage y color adentro (*"iPhone 14 Pro 256 Grafito"* es exactamente como lo escribe un reseller).
  Entonces se appendean por segunda vez.

**No es artefacto del fixture, y esto es lo que la vuelve una fila del board.**
`packages/db/src/schema/listings.ts:54`: `catalogModelId` es **nullable** y además
`onDelete: 'set null'`. Dos caminos de producción, ninguno exótico: (1) el dueño carga una unidad sin
elegir modelo de catálogo; (2) se borra un `catalog_model` y **todos** los listings que lo apuntaban
caen al fallback **de golpe**. El fallback en sí es correcto y está justificado por escrito en el
propio archivo —un accesorio no tiene `catalog_model` y *"vi el Cargador 20W USB-C"* se entiende
mientras que *"vi el null"* no—: **el bug no es el `??`, es que `describeListing` sigue appendeando
como si el nombre viniera del catálogo.** Por eso el fix tiene que decidir qué significa
`modelDisplayName` cuando no hay catálogo; parchear el `??` mueve el bug de lugar.

**Alcance: es preexistente de S3 y no lo introdujo S4.** No filtra nada y no es seguridad. Lo que
toca es la superficie de conversión del producto: el único string por el que entra la plata.

**Por qué ningún gate lo vio — y esto es lo que hay que leer, porque es un patrón que se repite.**
Tres pruebas alrededor del string y **ninguna encima del string completo en el camino real**:

| prueba | qué afirma | por qué no lo agarra |
|---|---|---|
| **U14** (`packages/domain/src/wa.test.ts`) | el string canónico **byte a byte** (`toBe`) | corre con `modelDisplayName` ya limpio: prueba la **función**, no el **mapeo** que la alimenta |
| **M3b** (`scripts/accept-s3.sh`) | **substrings** sobre el HTML servido | `256 Grafito` aparece — **dos veces**, y `grep -q` no cuenta ocurrencias |
| **W5** (`scripts/accept-s4.sh`) | imprime el `href` **entero** | sólo asevera `anchors=1` y `abre_whatsapp=si`: lo imprime, no lo compara |

Es la segunda vez que este repo paga la misma lección —la primera fue el botón `wa.me` que tenía tres
pruebas alrededor y ninguna encima, cerrada con M3b— y la forma es idéntica: **cada prueba era
correcta y el invariante seguía descubierto.** El gate que cierra S4.1 tiene que comparar el string
**completo**, sobre la **ficha servida**, con un listing **sin `catalog_model`**.

#### Lo que aterrizó (verificado contra `main` el 2026-08-28)

**Primero el gate, en rojo: `7e40856`.** Toca `scripts/accept-s3.sh` (M3b) y `scripts/accept-s4.sh`
(W5) y agrega la misma aserción a los dos. No compara contra un string literal —el modelo, el
storage y el color salen del seed, y hardcodearlos haría mentir al gate el día que cambien— sino
contra la **propiedad que el defecto viola**: el equipo nombrado entre `vi el ` y ` (` **no repite
ningún token**. `iPhone 14 Pro 256 Grafito` tiene cinco y ninguno se repite.

**Después el fix: `07c42ff`.** Decide qué significa `modelDisplayName` sin catálogo, que es lo que
la fila pedía, en vez de parchear el `??`:

| pieza | dónde | qué hace |
|---|---|---|
| `nameSource` | `packages/domain/src/wa.ts:51` · `dto.ts:62` | **requerido, sin default.** El nombre y su procedencia son una decisión en un objeto: elegir el nombre y olvidarse de dónde vino es la forma exacta que tenía el bug |
| `resolveModelName` | `apps/web/app/(storefront)/_lib/model-name.ts:54` | **único constructor**; trata el blanco como ausente, porque `display_name` es `text NOT NULL` sin `CHECK` y `''` es representable — con `??` se colaba como nombre de catálogo |
| `isBlank` | `packages/domain/src/text.ts:22` | un solo predicado de "vacío" para toda la cadena; `publicListingDTO` y `describeListing` rechazan `title`/`modelDisplayName` en blanco en vez de emitir `Hola, vi el  (usado A)` |

Con `nameSource: 'free_text'` los atributos se appendean **sólo si no están ya en el nombre**
(`wa.ts:168`, `:199`); con `'catalog'` se appendean siempre, que es el comportamiento que la ficha
tenía antes y que era correcto **cuando el nombre venía del catálogo**. `nameSource` **no** viaja al
DTO público (`dto.ts:213`): es procedencia interna del dato.

**La corrida llegó, y con eso la fila cierra.** Regla 5 de este board: el estado lo fija la
re-ejecución del LEAD, no la entrega del código. Los dos comandos que cerraban la fila:

```
bash scripts/accept-s3.sh     # M3b: el equipo se nombra una sola vez, sobre la ficha SERVIDA
bash scripts/accept-s4.sh     # W5:  mismo invariante sobre el unico href medido de un browser real
```

**Los dos corrieron en verde en la barrida completa del LEAD del 2026-08-28**, la que precede a
`cbbfa2f` (`accept-s1..s4` + `accept-s6`, `accept-fase2`, `accept-fase3`, la suite e2e entera con 80
tests y 0 skip, más `typecheck`, `lint` y 1173 unit tests). Lo que importa del orden: esa barrida es
**posterior** a `07c42ff` (el fix) y a `7e40856` (la aserción), así que no es el caso de S4 —donde el
número citado era de la corrida que **imprimió** el defecto y lo dejó pasar—. **Salvedad honesta:
para esta corrida consta el veredicto, no el conteo de PASS**, que es la forma en que el resto de
este board cita sus cierres.

**La evidencia que este board cita hoy para S4 es anterior al fix, y conviene saberlo al leerla.**
Los `37 PASS · 0 FAIL` de la fila S4 son de la corrida que **imprimió** el defecto en W5 y lo dejó
pasar (`7e40856`: *"un gate que imprime la evidencia del defecto y lo deja pasar es peor que uno que
no la mira: deja el registro de que se vio"*). S4 está `done` y el LEAD la ratificó; lo que no se
puede hacer es reusar ese número como prueba de S4.1, porque es del gate **sin** la aserción que
S4.1 necesita.

### S5 · FX → precio en ARS  ·  **CERRADA el 2026-08-28**  ·  el hueco que queda es T12, no S5

Esta fila figuró `todo` con las tres partes de su gate ya en `main`. Es el mismo drift que tuvo a
S1 en `doing` y a S3.1/S3.2 en `todo` un día entero, y se corrige igual: verificando contra el
código, no contra la memoria.

| tercio del gate | dónde está | quién lo afirma |
|---|---|---|
| **cotización automática** | `automatic-rate.ts` valida la API pública del BCRA con cache diaria; el alta siembra `fx_settings` y el cron cada 5 minutos actualiza todos los tenants cuando cambia la cotización | **S5**, verificado con tests de parser, alta y cron |
| **redondeo testeado** | `applyFx` (`packages/domain/src/fx.ts:117`), `FxRoundingMode = 'exact' \| 'ceil_100' \| 'nearest_1000' \| 'ceil_1000'` (`:33`), `DEFAULT_FX_ROUNDING = 'ceil_1000'` (`:35`) — el default ratificado por el LEAD en FASE 2, punto 2 | `packages/domain/src/fx.test.ts`; `pnpm --filter @istock/domain test` → **187 passed / 12 archivos** (2026-08-28) |
| **ARS visible en ficha** | `s/[slug]/p/[listing]/page.tsx`, con el cartel de que el peso es **informativo** (FASE 2, punto 3) | **M3 de `scripts/accept-s3.sh`**, que exige el ARS con la forma de `formatArs`; corrida del LEAD **58 PASS · 0 FAIL** |

**S5 no tiene `accept-s5.sh`.** Su gate está repartido entre `accept-s3.sh` (la mitad que se ve) y
la suite de `@istock/domain` (la mitad que calcula), y las dos las re-ejecutó el LEAD. Se anota
explícito porque *"no encontré el comando"* no puede volver a leerse como *"no está verificado"*.
**Que eso alcance para el `done` es otra pregunta, y quedó abierta como deuda de proceso:** ningún
comando del repo *nombra* a S5, así que borrar M3 de `accept-s3.sh` le saca la evidencia sin poner
nada en rojo. La versión anterior de este párrafo decía *"y no lo va a tener"*: eso era una decisión,
y `docs-keeper` no las toma. La decide el LEAD — ver §"S5 quedó `done` sin comando de aceptación
propio".

**El hueco real, y por qué es T12 y no S5.** El dueño **no puede editar el TC después del alta**:
`app/(panel)/ajustes/page.tsx` es sólo lectura, cero `'use server'` en el directorio, y la única
mutación de `fx_settings` en todo el repo es el `insert` del alta. Eso es exactamente lo que dice
**T12**, que ya está en este board con su dueño (`app-agent`), su gate y su artefacto. Dejar a S5 en
`todo` por ese motivo sería **contar la misma deuda dos veces** y, peor, esconderla: leyendo el board
parecería que falta el FX entero cuando lo que falta es una pantalla de edición. La fila que hay que
mirar para el TC es T12.

### S6 · reserva + scheduler de expiración  ·  **done · aceptada localmente por el LEAD el 2026-09-04**

**Lo que entró**, y de dónde sale cada tercio del gate:

| tercio | dónde | nota |
|---|---|---|
| **reserva 30–120 min** | `_lib/reservations/` (`schema.ts`, `reserve-unit.ts`, `queries.ts`) + `stock/reservation-actions.ts` + `stock/_ui/reserve-form.tsx` y `cancel-reservation-button.tsx` | el rango **se rechaza, no se clampea** (`schema.ts:15-20`): clampear le devolvería al vendedor una reserva que no pidió. Lo sostienen tres capas: Zod, el `CHECK` `reservations_minutes_range` y el dominio |
| **scheduler libera** | `app/api/cron/expire-reservations/route.ts` + `_lib/reservations/expire-reservations.ts` + integración Inngest (`*/5 * * * *`) | el barrido es idempotente (`expireReservation` del dominio es puro, con `now` inyectado); el callback global está implementado localmente |
| **vidriera revalida** | `invalidateStorefrontUnit(slug, listingId)` | **por unidad**, no por catálogo: expirar una reserva cambia una ficha. Purgar de más es el defecto que cerró S3.2 |

**La decisión de scheduler cambió y reabre la aceptación de S6.** ADR-017 ahora fija Inngest Free con
`*/5 * * * *`; `vercel.json` conserva sólo `$schema` y no declara `crons`. El endpoint global
`/api/inngest` y la función de mantenimiento son responsabilidad de `app-agent`, y su presencia en
Production, la cuenta/sincronización de Inngest, las claves, el deployment y un run real siguen
**UNVERIFIED**. El rate limit continúa fuera de `vercel.json`, según ADR-016.

#### El rechazo del `adversary-reviewer`, que es lo que hay que leer de esta slice

El bloqueante **no era preexistente: lo introdujo S6**. La slice le agregó el parámetro `extras` a
`transitionContextFor()` y dejó atrás a un caller, así que `transitionUnit()` evaluaba **toda**
transición con `activeReservation: null`. Consecuencia medible: *"Publicar"* sobre una unidad
`reserved` devolvía ok, el equipo volvía a la vidriera como **Disponible con la seña puesta**, y
quedaba irreservable —`reserveUnit` chocaba contra el índice único parcial
`reservations_one_active_per_listing` y contestaba *"Ya tiene una reserva activa"* sobre una fila
cuyo badge decía "En vidriera"—, sin salida por UI.

**Por qué el typecheck no lo vio, que es la lección transferible:** el parámetro era **opcional y su
default era un valor válido**. `strict` no distingue *"no me lo pasaron"* de *"me pasaron que no hay
reserva"*. **El fix fue borrar el default**, no pasar el dato: ahora el compilador atrapa al caller
olvidado, y los dos sitios que sólo renderizan pasan una constante con nombre
(`DRAFT_PUBLISH_EXTRAS`, `unit-row.tsx:137` y `fotos/page.tsx:132`) que documenta por qué ahí la
mentira es inofensiva. Un default válido en un parámetro opcional es un `any` con mejores modales.

Segunda mitad del mismo bloqueante: `transitionEffects().closesReservation` está comentado en el
dominio como *"Efecto obligatorio"* (`packages/domain/src/listing-status.ts:85`) y **tenía cero
consumidores**. Ahora se ejecuta dentro de la misma transacción que mueve el listing. Lo cubre
`scripts/guard-effects.sh` (`5befc94`), en CI desde `e3a7c5e`.

#### Las dos probes del LEAD, y por qué el `route.test.ts` de `app-agent` no puede ocupar su lugar

`scripts/probes/` es del LEAD por §4: **el gate no puede ser del mismo writer que el código que
audita**. `app/api/cron/expire-reservations/route.test.ts` existe, es de `app-agent`, y sirve como
red de regresión propia; si `accept-s6.sh` lo citara como evidencia, `app-agent` estaría firmando su
propio certificado.

- **`s6-inngest-reachability.test.ts` — que Inngest LLEGUE.** Cruza el trigger, el endpoint `serve`
  de Next, `proxy.ts` (`storefront-agent`) y el route handler (`app-agent`): **tres columnas, y
  ninguna ve el camino entero**. Verifica el endpoint, los verbos, `maxDuration`, la función con
  `*/5 * * * *`, la ausencia de `crons` en `vercel.json` y el passthrough global. Un callback que no
  llega deja reservas sin vencer aunque el deployment figure verde. **La probe existe en el árbol de
  trabajo, y el route y la función que inspecciona ya están presentes en el árbol local. La probe no
  prueba la cuenta/app externa, las claves de Production, la sincronización, el deployment ni un run
  real.**
- **`s6-cron-fail-closed.test.ts` — que el 401 vaya ANTES del barrido manual.** La propiedad no es *"devuelve
  401"*, es **"sin credencial válida no toca Postgres"**, que es una afirmación sobre el **orden** de
  dos cosas: un handler que barre primero y decide el status después devuelve los mismos 401 y es una
  escritura abierta. Por eso espía la función del barrido en vez de comparar un status. **El caso que
  justifica el archivo es la env ausente:** la comparación cae contra `undefined`, y el endpoint que
  vacía reservas queda público respondiendo 200, sin nada raro en los logs.

`GET /api/cron/expire-reservations` es la **única puerta HTTP manual sin sesión que escribe** en todo
el producto, y **no lleva regla de rate limit**: la excepción está escrita con su motivo en
`config/firewall-rules.json:75-76` (falla cerrado, así que un flood no abre una conexión; y una regla
mal calibrada apaga el scheduler y las reservas no vencen nunca, en silencio).

#### El gate, y el residuo que hay que leer junto al `done`

`bash scripts/accept-s6.sh` — V1 (Inngest declara la función, el trigger y el endpoint y el callback
llega hasta él) · V2 (fail-closed medido por invocación de la puerta manual) · V3 (fuera de rango se rechaza) · V4 (el entitlement se
chequea **adentro** de la Server Action) · V5 (expirar invalida la unidad, no la vidriera entera) ·
V6 (nada de lo que S6 agrega filtra costo, margen ni IMEI) · V7 (el barrido cruza tenants para
**leer** y escribe atado al tenant de cada fila) · V8 (medición e2e del ciclo) · V9 (radio de
invalidación medido) · V10/V10b (barrido sin bloqueo detrás de una fila rota y parte verificado).

**Estado de aceptación local:** el LEAD re-ejecutó `bash scripts/accept-s6.sh` después del cambio de
scheduler sobre el árbol integrado. V1–V10 pasaron y el comando imprimió **S6: ACEPTADA**; S6 queda
`done` localmente. La cuenta/app de Inngest, la sincronización, las claves
`INNGEST_SIGNING_KEY`/`INNGEST_EVENT_KEY`, el deployment y un run real son **UNVERIFIED** y quedan
como blockers de producción. La aceptación local no cierra la probe real de R2, B3 (Mercado Pago)
ni B7–B9 (Inngest, elegibilidad de Vercel, deployment y run real).

**La V8 es el cuarto caso del repo de la misma familia**, y lo marcó `qa-agent` **en su propio
reporte, con el gate ya en verde y a su favor**: grepeaba el **fuente** buscando `MEDIDO s6 reserva`,
cadena que aparece en el docblock del spec y en el del helper que la arma, así que daba **PASS con
dos comentarios y cero corridas**. Desde `10d31b6` corre el spec, lee la línea de la **salida real** y
exige seis campos. En el mismo commit se acotó la **V3**, que dio su tercer falso positivo matcheando
un `Math.max(0, expiresAt - now)` que es un piso de cuenta regresiva, no un clamp de duración.

**Residuo cerrado el 2026-08-28, con una salvedad que no se redondea.** El residuo era que la
barrida que citaba esta sección era **anterior** a `10d31b6` y había corrido la V8 en su forma vieja.
El LEAD declara haber re-ejecutado `scripts/accept-s6.sh` **en su forma actual** —la V8 que lee la
línea de la salida real, no la que grepeaba el fuente—. **Lo que no consta es el conteo de PASS**,
igual que en la corrida que cerró **S4.1**: consta el veredicto, no el número. Esa asimetría con el
resto del board (26 / 21 / 58 / 37) se deja anotada en vez de completarse de memoria.

**Y el residuo que sí sigue abierto, que este mismo `done` no podía ver: la V5.**

```
V5 · expirar una reserva invalida la unidad, no la vidriera entera
   grep -rqE 'invalidateStorefrontUnit' ...
```

La aserción **afirma una propiedad** y **verifica un nombre**. Mientras `invalidateStorefrontUnit()`
emitía los tres tags —o sea mientras purgaba la vidriera entera— la propiedad era **falsa** y la V5
estaba **verde**, en la misma corrida que aceptó S6. Lo encontró `cost-auditor` mirando el cold-hit
rate, no un gate. Desarrollo completo en **§S6.2**; la fila es del LEAD por §4.

### S6.1 · en qué queda una reserva cerrada lo decide el dominio  ·  **CERRADA el 2026-08-28** (`83bc673`)

**Qué era.** El dominio declaraba **que** había que cerrar la reserva
(`TransitionEffects.closesReservation: boolean`) y callaba **cómo**, así que el único consumidor que
existía —`apps/web/.../publish-listing.ts`— se había inventado un `closingStatusFor(to)` local. Eso
es una regla de la máquina de estados viviendo en la capa de aplicación, y ya estaba produciendo el
defecto: **el panel escribía `cancelled` y el barrido del cron escribía `expired` sobre la MISMA
arista `reserved → available`.** Una reserva vencida por reloj quedaba registrada como cancelada por
una persona **según quién la cerrara primero**.

**Qué quedó.** No es la mudanza literal del helper: la regla pasó de dos valores a tres y el campo
cambió de forma.

```
closesReservation: boolean            ->  closesReservationAs: ReservationClosingStatus | null
transitionEffects(from, to)           ->  transitionEffects(from, to, intent)
```

| arista | estado de cierre |
|---|---|
| `reserved → sold` | `confirmed`, **sin importar el `intent`** — no existe una venta que venció |
| `reserved → available` con `intent: 'expire'` | **`expired`** — el mismo valor que ya devuelve `expireReservation()` |
| `reserved → cualquier otro destino` | `cancelled`, **incluso si la reserva ya estaba vencida** |

La tercera fila es la que hay que leer: `'expired'` significa *"se venció sola"*, y **quién tiene la
definición de vencida es `expireReservation()`**. Dos definiciones de "vencida" es exactamente cómo
se pierde un borde cerrado. `intent: 'expire'` sólo pesa sobre `to === 'available'` porque ése es su
alcance declarado: un `reserved → in_service` no lo hace un reloj, lo hace alguien que agarró el
equipo y lo mandó a service.

**Tres decisiones de forma que no son cosméticas**, y las tres están escritas en el propio archivo
(`packages/domain/src/listing-status.ts:159-247`):

1. **Es reemplazo y no agregado.** Un `boolean` con un `ReservationClosingStatus` al lado deja
   representable el estado ilegal `true` + `null`, y —peor— deja abierta la puerta de leer *"cierra"*
   y elegir el estado por fuera, que es literalmente el bug. Al ser **el mismo valor**, es imposible
   consumir el efecto sin recibir el estado de cierre.
2. **`intent` es obligatorio y admite `null`**, en vez de opcional. Es la lección de S6 aplicada:
   *un parámetro opcional cuyo default es un valor válido no distingue "no me lo pasaron" de "me
   pasaron que no hay"*, y esa distinción es justo la que tiene que sostener el compilador. Sin ella
   el cron se llevaría `'cancelled'` en silencio donde corresponde `'expired'`. Es **rompiente a
   propósito**: el bug anterior de esta misma familia sobrevivió por ser invisible para TypeScript.
3. **`closingStatusFor` es privada**: la única puerta es `transitionEffects`, para que nadie pueda
   pedir el estado de cierre sin pedir también el resto de los efectos.

**Cómo se cerró.** Commiteada en `83bc673` y re-ejecutada por el LEAD: `pnpm typecheck` 0 · `pnpm
lint` 0 (**15 reglas al momento de esa corrida; hoy son 16, entró `W016` — ver T26**) · `pnpm test` 0 · `bash scripts/guard-effects.sh` **OK, y venía RECHAZADO** ·
`bash scripts/guard-leaks.sh` OK. El gate escrito de la fila se cumple: `grep -rn 'closingStatusFor'
apps/web/app` → **cero**. El dominio sumó 11 tests (199 en total), con E5/E5b recorriendo el
**producto cartesiano** de aristas en vez de listas a mano y E3b cruzando la tabla contra
`expireReservation()`.

**El test que atrapa la regresión no es el que fija `'expired'`.** Los tests nuevos de `apps/web` no
fijan el string: fijan que la arista del cron **con** `intent` da lo que el cron escribe y **sin**
`intent` da `cancelled` —o sea, lo que **no** tiene que escribir—. Esa segunda mitad es la que ve el
día que alguien pase `null` "porque compila".

**ADR-019** deja escrita la decisión de fondo, que es más chica y más transferible que el diff:
**la tabla del dominio decide, el call site declara su intención.** La ratificó el LEAD el
2026-08-28.

**Lo que NO alcanzó, y tuvo fila propia: T18 — cerrada el 2026-08-28.** `cancelReservation()` era el
tercer call site de la misma familia y escribía `'cancelled'` hardcodeado con el `intent: 'cancel'`
ya armado al lado. **Acertaba por casualidad** —cancelar a mano sí es `cancelled`—, que es la peor
forma de estar bien: no hay síntoma que avise el día que la tabla del dominio cambie de opinión
sobre esa arista. Hoy los tres call sites la consultan (`reserve-unit.ts:281`,
`expire-reservations.ts:280`, `publish-listing.ts:321-325`) y la fila cerró con la corrida de
`accept-s6.sh` del LEAD.

### S6.2 · la función que dice `Unit` en el nombre purgaba la vidriera entera  ·  **CERRADA el 2026-08-28** (`f504d69`)

> **Qué es:** el registro del defecto de **radio** de invalidación de S6 y de la topología de tags que
> quedó. **Para quién:** cualquiera que vaya a tocar un `cacheTag()` o un `updateTag()` de la
> vidriera — que son **cuatro** archivos en **dos** columnas de ownership. **Cuándo se actualiza:**
> cuando cambie quién registra qué tag.

**El defecto.** Un tag de Vercel es un **OR**: una entrada cacheada muere si se purga **cualquiera**
de los tags que registró. `invalidateStorefrontUnit()` emitía `storefront:{slug}` +
`tenant-config:{slug}` + `listing:{uuid}`, y la ficha registraba los **dos** de tenant. Consecuencia
medida: **reservar UNA unidad en un tenant de 60 equipos purgaba las 61 páginas**, 59 de las cuales
no habían cambiado en nada.

**No lo encontró un test: lo encontró `cost-auditor` auditando S6** (`e3f3703`). El cold-hit rate se
iba a **~39%** contra una alarma de **5%** (`docs/COST.md` §2.4). Es la lección que vale más que el
diff: el defecto no estaba en lo que la función hacía **mal**, sino en el **radio** de lo que hacía
**bien** — y un radio no se ve en un unit test que verifica que la invalidación ocurrió.

**Estado final. Es contraintuitivo y por eso está en una tabla:**

| | tags que registra / emite |
|---|---|
| **grilla** | `storefront:{slug}` + `tenant-config:{slug}` (**sin cambios**) |
| **ficha, camino de HIT** | `tenant-config:{slug}` + `listing:{uuid}` |
| **ficha, camino de MISS** | `tenant-config:{slug}` + `storefront:{slug}` |
| `invalidateStorefrontUnit()` | `storefront:{slug}` + `listing:{uuid}` |

La grilla **no se toca**, y eso no es olvido: `storefront:{slug}` es **su** tag y reservar **sí**
cambia la card (aparece el badge "Reservado"). Bajar el radio sacándolo también sería reintroducir
exactamente la regresión que `adversary-reviewer` rechazó en S6 — la grilla diciendo "Disponible"
sobre una unidad reservada.

#### Las tres cosas que el arreglo obvio no tenía, y que se vuelven a perder

1. **El miss conserva `storefront:{slug}` a propósito.** La ficha registra `listing:{uuid}`
   **después del `await`** y **sólo si la unidad es públicamente visible**. Sacarle el tag de tenant
   al camino de miss dejaba una ficha cacheada como miss —el equipo todavía en `draft`, el link ya
   circulando— **sin ningún tag que el panel emita al publicar esa unidad**: publicarla la habría
   dejado mostrando *"este equipo ya no está publicado"* hasta **15 minutos**
   (`MISS_EXPIRE_SECONDS`), **sin error y sin log**. Por eso las dos ramas negativas pasan por
   `listingMiss()`, que registra el tag y el perfil corto **juntos**: son dos mitades de la misma
   decisión y separarlas es cómo se pierde una.
2. **Había un CUARTO registrante, y era el que decidía la métrica.** `page.tsx` registra tags por su
   cuenta en sus **dos** entradas (`generateMetadata` y el cuerpo), y los tags del loader propagan
   **hacia afuera**, nunca al revés (`propagateCacheLifeAndTagsToRevalidateStore`, en
   `use-cache-wrapper.js`). **Sin tocar esas dos líneas, el arreglo mataba el amplificador de
   Postgres y NO movía el cold-hit rate** — o sea, un arreglo que deja intacto el número que lo
   justificó, y que después se cita como *"ya lo arreglamos"*.
3. **Las dos ramas de `page.tsx` quedaron simétricas a propósito.** El hit registra su tag
   explícitamente y el miss también, **en vez de heredarlo por propagación**. La propagación existe
   y funciona, pero sale de un **interno de Next sin contrato público**, y `CLAUDE.md` §3 nos obliga
   a subir Next (CVE-2026-64648 sólo se arregla con upgrade). Un `pnpm up` que cambie el orden **no
   rompería ningún test nuestro: los mocks afirman el mock.**

#### El radio se mide, no se estima

`e2e/s6-senar-un-equipo-no-purga-la-vidriera-entera.spec.ts` (nuevo) más 18 casos en `tests/`. El
predicado es `cacheAfter !== 'HIT' || statementsAfter > 0`, y son **dos instrumentos porque cada uno
ve un caso que el otro no**: el header ve el caso en que muere la entrada ISR y sobrevive el
`'use cache'` de adentro (cero queries y la función se invocó igual), el contador ve el inverso y no
depende de que Next mantenga la semántica del header. **Comparar HTML no sirve —un re-render produce
el mismo HTML— y está escrito en el spec** para que nadie lo reintroduzca como simplificación.
Controles anti-vacuidad: la request fría tiene que producir `statements > 0`, toda página tiene que
haber estado en HIT **antes** de la mutación, y exactamente **una** request por página después (la
segunda vuelve HIT y borra la evidencia).

**Medición del LEAD, después** (la línea completa, tal como la emite el spec y la lee **V9** de
`accept-s6.sh` desde el 2026-08-28):

```
MEDIDO s6 radio · publicadas=4 · paginas=5 · rerender=2 · esperado=2
              · sobrevivieron=[ficha-a,ficha-c,ficha-d] · frio=14
MEDIDO s6 alta-de-unidad · miss_cacheado=HIT · visita_que_la_muestra=1
```

`frio=14` no es decorativo y por eso está en la línea: son las **sentencias que el espía vio contra
Postgres**. En cero, todas las páginas "sobrevivirían" porque nunca se sirvió nada — la medición
vacía disfrazada de éxito. V9 lo exige `> 0` igual que exige `paginas > 2`.

**Antes**, en un clone desechable a `ea26a02`: **`rerender=5` de 5, cero sobrevivientes.**

Las dos últimas mediciones son la mitad que un test de *"no se purgó nada"* aprobaría y no debería:
hay un caso que **rechaza explícitamente** el arreglo que baja el radio a cero rompiendo la
invalidación, y otro que prueba el camino de miss del punto 1.

#### Lo que el e2e NO puede medir, y hay que decirlo donde se cite la medición

- **La invalidación se midió contra `next start` local.** `x-nextjs-cache` es la **caché de ruta de
  Next**, no el edge de Vercel. Lo que está medido es el radio de la purga en el runtime de la app;
  el comportamiento del CDN de Vercel con estos mismos tags es **nivel 2 y no lo alcanzó nadie**
  (**B2**/**B5**).
- **El radio se midió con 4 unidades publicadas, no con 60.** *"El radio no crece con la cantidad de
  equipos"* está sostenido por **3 hermanas sobrevivientes**, no por una curva. La afirmación es
  estructural (un tag por unidad no puede alcanzar a otra), pero lo **medido** son 3 fichas.

#### Residuo declarado — **CERRADO el 2026-08-28**: ahora el gate nombra el spec que mide el radio

Decía, y era cierto cuando se escribió: `grep -rn 's6-senar\|MEDIDO s6 radio' scripts/ .github/workflows/ci.yml`
→ **cero**. El spec corría —entra por `pnpm e2e`— pero **ningún comando de aceptación lo citaba como
evidencia**, así que borrarlo le sacaba a S6.2 su medición **sin poner nada en rojo**. Evidencia
escrita, medida, con su módulo de veredicto testeado, y sosteniendo nada.

**Lo cerró el LEAD** (§4, los gates son suyos): `accept-s6.sh` fija `SPEC_RADIO=` en
`s6-senar-un-equipo-no-purga-la-vidriera-entera.spec.ts` y lo corre **en la misma invocación que
`$SPEC`**, y **V9** lee `MEDIDO s6 radio` de esa salida. La auditoría de referencia del veredicto es
`tests/el-veredicto-del-radio-rechaza-la-purga-que-arrastra-fichas-ajenas.test.ts`, de **`qa-agent`**
— otra columna que la del código auditado, que es lo que `CLAUDE.md` §4 exige para que el gate pueda
citarla sin que el writer firme su propio certificado.

**La deuda de proceso de S5 sigue abierta y es la misma forma**, así que el precedente ya no es sólo
W1 de `accept-s4.sh`: es también esto.

#### Y la V5 de `accept-s6.sh`, que estuvo verde todo el tiempo — **ARREGLADA el 2026-08-28** (**ADR-020**)

Así estaba:

```
V5 · expirar una reserva invalida la unidad, no la vidriera entera
   grep -rqE 'invalidateStorefrontUnit' ...
```

La aserción **afirmaba una propiedad** (*"invalida la unidad, no la vidriera entera"*) y **verificaba
un nombre**. Mientras `invalidateStorefrontUnit()` emitía los tres tags, la propiedad era **falsa** y
el gate estaba **verde**: acompañó el defecto de punta a punta. No es el caso conocido de *"verificar
la presencia del símbolo en vez de la invocación"* —acá la invocación **existía**—: es el escalón
siguiente, **verificar la invocación de una función cuyo cuerpo hace lo contrario de lo que su nombre
promete**. Un gate no puede delegar su aserción en la honestidad de un identificador.

**El arreglo del LEAD fue más ancho que reescribir la línea, y así queda:**

| | qué afirma | tipo |
|---|---|---|
| **V5**, ahora | *nadie llama a la purga del catálogo (`invalidateStorefront(`) desde el camino de reservas ni desde su UI*. La **ausencia** de una llamada prohibida **sí** es una propiedad del fuente | estático, **y el título de la sección lo dice**: *"(estático; el radio se mide en V9)"* |
| **V9**, nueva | lee `MEDIDO s6 radio` de la corrida y compara `rerender` contra `esperado`, con `paginas > 2` y `frio > 0` como controles anti-vacuidad y **ausencia de la línea = FAIL** | contado |

Que el título de V5 diga de qué tipo es su evidencia no es cosmética: **el defecto original era
justamente que el nombre prometía más que el método.** La regla vinculante que salió de acá —*un
gate afirma una conducta medida, nunca un identificador grepeado*— es **ADR-020**, y V5 es uno de
sus tres casos; los otros dos son **A2 de `accept-s1.sh`** (grepeaba un archivo del que el invariante
se había mudado, y encima no fallaba porque `chk` no estaba importado) y **M1 de `accept-s3.sh`**
(escaneaba comentarios y reconstruía un tag fantasma, o sea castigaba documentar la regla que
defiende). La parte mecánica de la clase la cierra `scripts/guard-gates.sh`.


### S5 quedó `done` sin comando de aceptación propio  ·  **deuda de proceso**, no de producto

> **Qué es:** el registro de un hueco en el **proceso**, no en el código. **Para quién:** el LEAD, que
> es el único que puede cerrarlo — los gates son suyos por `CLAUDE.md` §4 y no pueden ser del writer
> que auditan. **Cuándo se actualiza:** cuando el LEAD decide cuál de las dos salidas toma.

`CLAUDE.md` §0 regla 2: *"nada es `done` sin (a) artefacto en `/docs` y (b) comando de aceptación que
el LEAD re-ejecuta"*. **S5 está `done` y no tiene un comando propio.** La §S5 de este board argumenta
—y sigue siendo cierto— que sus tres tercios están afirmados por comandos que el LEAD sí re-ejecutó:
`accept-s3.sh` (M3, el ARS en la ficha servida) y la suite de `@istock/domain` (los 4 modos de
redondeo). Lo que ese argumento **no** cubre es el punto que lo vuelve deuda:

**nada nombra a S5.** `grep -rn 'S5' scripts/ .github/workflows/ci.yml` devuelve **dos comentarios**
en `accept-s3.sh` (`:271` y `:277`) y **cero aserciones**. Consecuencia concreta: **si mañana se borra
o se afloja M3 de `accept-s3.sh`, S5 pierde su evidencia y ningún comando se pone rojo.** El repo ya
resolvió este problema exacto una vez y la solución está a la vista: **W1 de `accept-s4.sh` nombra las
dos aserciones que sostienen S4** —no los archivos— así que borrar M3b pone roja también a S4. S5 no
tiene ese hilo.

**DECIDIDO por el LEAD el 2026-08-28: S5 va a tener `scripts/accept-s5.sh`.** Lo escribe el LEAD
después de esta pasada; los gates son suyos por §4. Las dos salidas que este board planteaba dejan de
estar abiertas.

**Y el motivo por el que la salida barata —encadenar lo que ya existe— no alcanzaba, que es lo que
hay que leer:** los tres tercios afirmados hoy **no cubren la aserción que importa**, y la que falta
es **causal**. Ninguno de los tres perturba el TC y mira moverse el ARS servido:

- (1) afirma que el alta **escribe** un `fx_settings`;
- (2) afirma que `applyFx` **calcula bien** en aislamiento (187 tests en `@istock/domain`);
- (3) afirma que la ficha **muestra un ARS con la forma de `formatArs`**.

**El seed tiene un solo tenant** (`demo`) con `arsPerUsd: 148_750` (`packages/db/src/seed.ts:166`),
o sea TC = 1487,50. Un fallback hardcodeado a 1487,50 en cualquier punto entre `fx_settings` y el
HTML **pasa los tres tercios**: escribe la fila, calcula bien, y muestra el número correcto. Lo que
lo atrapa es una sola cosa: **cambiar el TC del tenant y ver cambiar el precio en pesos de la ficha
servida.** Esa es la aserción que le falta a S5 y la que justifica un archivo propio en vez de un
`grep` más adentro de `accept-s3.sh`.

Corolario que va a heredar **T12**: cuando exista la pantalla de editar el TC, esa misma aserción
causal es su gate natural — hoy perturbar el TC exige recrear el negocio.

**No lo arregla `docs-keeper`.**

### S8 · canje  ·  **ACEPTADA el 2026-08-28** (`abbb9c2` … `7d07763`, ocho commits, **ninguno pusheado**)

> **Nota de estado:** el diagnóstico de esta sección conserva el corte histórico de S8. Las filas
> activas de arriba son la fuente vigente: P5 se cerró el 2026-09-04 con `0012`/`0016`, y el
> recorrido browser de roles se cerró con S11. Los huecos que siguen abajo se leen como deuda de
> cobertura histórica salvo que su fila activa indique otra cosa.

El LEAD re-ejecutó `./scripts/accept-s8.sh` entero → **`S8: ACEPTADA`** (V1…V5). El parte:

```
MEDIDO s8 canje · lead_anonimo_entra=1 · lead_sin_claim_no_entra=0 · lead_a_tenant_ajeno=0
              · offer_usd_desde_anon=0 · returning_desde_anon=0 · checks_del_motor=1
              · accept_crea_unidad_en_draft=1 · accept_dos_veces_una_unidad=1
              · costo_en_el_payload_del_seller=0 · canario_rol_anon=1 (20 transacciones)
```

Árbol de la misma corrida, `pnpm -r test`:
**domain 201 · media 164 · ai 472 · db 390 · `apps/web` 777 (+4 skipped) · `tests/` 391.**
**`pnpm e2e` no se corrió** (requiere `next build`) y no se cuenta como verde en ningún lado.

#### Las dos cosas del parte que son doctrina y no números

Van primero porque el resto de los campos no significan nada sin ellas.

**1. `canario_rol_anon` es el primer campo que hay que mirar, no el último.**
`SET LOCAL` fuera de un bloque de transacción es un **no-op que sólo avisa con un `WARNING`**: el
rol nunca cambia y todo corre como superusuario, que bypassea **RLS y `GRANT` a la vez**. Sin el
canario, **dos de los nueve casos siguen "pasando"** con el `set local role` sacado —los `CHECK`
aplican también al superusuario—, o sea que el gate daría verde midiendo nada. No es una hipótesis:
es un error que el LEAD cometió midiendo a mano en esta misma slice, y de ahí salió el campo. La
falsificación de la probe incluye esa mutación a propósito, y **es la única de las seis que sólo el
canario caza**.

**2. Un caso que no corrió reporta `-1`, no `0`.**
`lead_a_tenant_ajeno=0` es un **PASS** —cero filas cruzadas es exactamente lo que se quiere— y
*"sin medir"* es un **FAIL**. Si los dos escribieran `0`, no se distinguen, y el gate leería una
medición ausente como éxito, que es la familia entera de **ADR-020**. `accept-s8.sh` trata el `-1`
como fallo con mensaje propio: *"ese caso NO corrió"*.

#### Huecos de cobertura, declarados por `qa-agent`  ·  cinco, con dueño salvo uno

Van escritos como huecos, no como *"pendiente"*: cada uno dice qué no está afirmado y quién lo
tendría que afirmar. **Aceptar la slice no cierra sus deudas** — la misma regla que dejó S2.1…S2.5
abiertas después de aceptar S2.

1. **`TEST_MATRIX.md` E5 sigue 🔴.** `next build` y `pnpm e2e` no se corrieron en esta slice: es el
   **mismo hueco que S7**, no uno nuevo. Censo con `--list`: **86 tests en 13 archivos, ninguno de
   S8**. Dueño: `qa-agent` para el spec, **LEAD** para la corrida.
2. **La regla 9 del lado del panel: sin unit y sin e2e.** El corte del `seller` **sí** está probado
   en la **capa de query** —`apps/web/app/(app)/_lib/tradein/queries.test.ts`, con control positivo
   (el `owner` sí recibe la oferta), el caso del `seller`, y la aserción de que el **SQL** de esa
   rama no nombra las columnas sensibles—. Lo que no tiene nada es lo que se **renderiza**: ningún
   test mira la pantalla del inbox con rol `seller`, y **E6 sigue 🔴** porque no existe un e2e con
   ese rol (depende de S11). Dueño: `app-agent` para el unit de render, `qa-agent` para E6.
3. ~~**§8 — la PII del visitante no tiene test de fuga.**~~ **CERRADO el 2026-08-28.** Era el hueco
   sin dueño y sin test, y el que más importaba de los cinco. Lo cierra
   `tests/la-pii-del-visitante-no-sale-de-la-fila-del-canje.test.ts` (**`qa-agent`**, dueño asignado
   por el LEAD, 16 casos), y el LEAD lo verificó **mutando el handler real** para verlo encender.
   Ver **T43**, y ahí lo reusable: **el test prohíbe por forma, no por nombre de columna.**
4. **El rate limit de `/api/tradein` está afirmado sólo como config, nunca en runtime.**
   `guard-firewall.sh` verifica que la regla exista, esté en los límites de Pro y cubra la ruta;
   nadie mide un `429`/`deny` real. Es el **riesgo residual conocido de T1** —el apply del WAF es un
   paso manual de CLI y un `vercel deploy` **no** sincroniza el WAF—, y `accept-s8.sh` lo declara
   explícitamente entre las cosas que **no** afirma. Dueño: **LEAD**.
5. **El `GRANT` de `service_role` sobre `tradein_leads` está medido a mano pero no afirmado.** R8 de
   `tests/rls-cross-tenant.test.ts` nombra sólo `listings` y `reservations`. Es **exactamente** la
   trampa que `CLAUDE.md` §2 documenta —*"suponer que `BYPASSRLS` alcanza para leer una tabla"*: un
   rol con `BYPASSRLS` y sin `GRANT` recibe `42501` y no lee nada— y el mismo archivo dice por qué
   duele: **no aparece en CI, aparece el día que se prende el cron.** Dueño: `qa-agent`.

**Caveat heredado, y sigue vigente:** `scripts/pg-local.sh` **no replica** el `ALTER DEFAULT
PRIVILEGES` de Supabase. Una tabla que en local parece legible puede no serlo en producción, y al
revés. Vale para las cinco.

#### Lo que la slice dejó abierto, en una línea cada uno

| fila | qué | dueño |
|---|---|---|
| ~~**P5**~~ | **cerrado** con `0012_owner_sensitive_read_functions`: `authenticated` no tiene `SELECT` directo sobre `offer_usd`/`internal_notes`; el owner los obtiene por RPC con validación de tenant y rol | `db-agent` · **done** |
| **T37** | cuarta instancia de *segmento-vs-sufijo* en el matcher del proxy: la instancia está cerrada, la clase no | **LEAD** |
| **T38** | el techo del WAF cuenta por IP y no por método — CGNAT y el `<img src>` que quema el cupo | **LEAD** |
| ~~**T39**~~ | `accepts_trade_in` no tenía UI de edición: no se podía **dejar** de recibir canjes — **cerrado el 2026-09-04** con `/app/ajustes`, acción validada, persistencia filtrada por tenant e invalidación pública | `app-agent` · **done** |
| ~~**T40**~~ | **cerrado el 2026-09-04**: `readBody()` limita `Content-Length` y el stream antes de mantener el cuerpo completo en memoria | `storefront-agent` · **done** |
| **T41** | el comando de aceptación muta `istock_dev` cuando falta `DATABASE_URL` | **LEAD** |
| **T42** | el paquete de `qa-agent`: T7 otra vez, la carrera que serializa, y la probe de `REVOKE` | `qa-agent` |
| ~~**T43**~~ | la PII del visitante sin test de fuga — **cerrada el 2026-08-28** con 16 casos que prohíben por **forma**, no por nombre | `qa-agent` · **done** |
| ~~**S8.1**~~ | `accepts_trade_in` adentro de la policy + `acquisition_channel` + el invariante de `accepted` — **done el 2026-08-28**, migración **0009**. El tercero **no** es un `CHECK` y no puede serlo: es un `CONSTRAINT TRIGGER … DEFERRABLE` | `db-agent` · **done** |
| **T44** | un prefijo pertenece a un solo documento: `P<n>` estaba en `PRODUCT.md` y en el board a la vez | **LEAD** |
| **T45** | la parte B de la `0009` no tiene auditoría cruzada en `tests/`: hoy la cubren los dos writers y un grep | `qa-agent` |
| **T46** | `TODO: después el RLS` es la única prohibición de `CLAUDE.md` §2 sin test ni lint | **LEAD** |
| ~~**T47**~~ | comentario de `matcher` desactualizado, corregido el 2026-09-04 | `storefront-agent` · **done** |
| **T48** | el header de la `0009` dice `S8.1`; corregido y verificado en `733eda2` | `db-agent` · **done** |
| **T49** | el soft cap del chat es una **cuota compartida**: una IP agota los 40 del día en veinte minutos | `ai-agent` · política del **LEAD** |
| ~~**S8.2**~~ | `listing.title` llegaba al prompt sin `sanitizeForPrompt` — **done el 2026-08-28** (`89ab7c0`); la protección quedó **una capa más arriba** de donde esta fila la ubicaba: en el mapeo DTO → vista, y alcanza a **todo** el texto del dueño | `ai-agent` · **done** |
| ~~**T50**~~ | el techo de llamadas facturadas por turno era **4** y no lo decía ni una constante ni un test — **done el 2026-08-28** (`89ab7c0`): quedó en **3** y **derivado** de `MAX_TOOL_ROUNDS`, porque **co-locar dos constantes no crea una dependencia entre ellas** | `ai-agent` · **done** |
| **T51** | nadie emite `billed` ni alarma — **y la condición de alarma ya no es `calls > 2`**: la arbitró el LEAD el 2026-08-28 (`CLAUDE.md` §5) en tres condiciones con tres trabajos. Lo que `C10` le pedía a `ai-agent` estaba hecho; la **medición que se pierde** en el turno quemado, no | `app-agent` (el log, con FASE 5) |
| **T52** | el techo de 1200 tokens: 7 de las 9 degradaciones del corpus son la ficha del plan Negocio | **humano** · `blocked` |
| **T53** | el `ContextTrimReport` no lo lee nadie: sin él, `T52` se decide sobre un corpus sintético y no sobre tenants reales | `ai-agent` (el corpus) · `app-agent` (producción, FASE 5) |
| **T54** | `docs/COST.md` costea el chat con el techo de **4** y el árbol factura **3** desde `89ab7c0` — drift **registrado, no arbitrado** | `cost-auditor` |
| **T55** | una cita `archivo.ts:NNN` en `docs/**` envejece sola y nada la cuenta — **tres agentes, tres tandas, una sesión** (`CLAUDE.md` §5) | **LEAD** (el gate, `scripts/**`) |
| **T56** | la fuente canónica de `DEMO_TENANT_SLUG` está en `packages/domain`; tests y gate verificados en `733eda2` | `domain-agent` + `storefront-agent` · **done** |
| **T57** | el import CSV duplica unidades si se sube dos veces el mismo archivo; falta clave persistida y decisión de esquema | `db-agent` · **todo** |

**`T44`…`T49` no salieron de S8: salieron de cerrar S8.1 y del lote de documentación del 2026-08-28.**
Se listan acá porque es la única tabla del board que junta los pendientes vivos de esta rama del
trabajo, no porque la slice los haya dejado. `T43` y `S8.1` quedan tachadas en vez de borradas: una
fila que desaparece no enseña que se cerró.

**`T50`, `T51`, `T52` y `T53` tienen otra procedencia todavía: salen de la re-auditoría de
`cost-auditor` del 2026-08-28 (`docs/COST.md`, commit `6aea02b`), donde vivían como `C11`, `C10`,
`C9` y `C6`.** Las tres primeras estaban en §2.8; **`C6` no** —vive en la tabla de §2.6 y en §2.8.5
sólo se la cita de paso— y por eso casi se queda afuera del lote: `grep -c C6 SLICE_BOARD.md` daba
**0** mientras `COST.md` la nombraba como condición de la decisión de `T52`. **La recomendación más
cara de ejecutar resultó ser la que ni siquiera estaba en la sección que se estaba transcribiendo.**
Se pasan a filas por una razón de proceso y no de contenido: **una recomendación que sólo existe
adentro de `COST.md` es una recomendación que nadie va a ejecutar**, porque el board es el estado de
la verdad del avance y `COST.md` no lo es. Cada una lleva su alias `C<n>` para que la recomendación
siga siendo rastreable hasta el número que la produjo — misma convención que `T21`–`T25`.

#### Y lo que S8 dejó **cerrado** del lado de los instrumentos, que no es poco

Dos gates crecieron en esta slice, y el segundo tiene una historia que hay que contar entera porque
es la que enseña algo. Está abajo, en §"Dos gates crecieron en S8".

---

### Dos gates crecieron en S8, y el segundo tenía un agujero de una columna

#### `rls-lint` tiene arnés de polaridad  ·  `scripts/rls-lint.test.sh`, 12 casos, en `ci.yml`

Era **el único de los cinco lints sin arnés**, y el arnés se escribió **el mismo día que se aflojó
la regla que audita**. Ese orden es la mitad del punto: aflojar sin arnés habría impreso
`rls-lint OK` **idéntico** si la excepción se llevaba puesta también la lectura, y nadie se habría
enterado. Los dos casos que cargan el peso son `GRANT SELECT (customer_name)` —tiene que quedar
**rojo**— y el mismo nombre de columna sobre **otra tabla**, que prueba que la excepción es por
`tabla.columna` y no por nombre.

La regla `0020` pasó de *prohibir esas columnas en cualquier `GRANT` a `anon`* a **prohibirlas de
leer**. La excepción está acotada a `tradein_leads.customer_name` y `tradein_leads.customer_wa_phone`
y **sólo aplica cuando el privilegio es de escritura**. El razonamiento completo es **ADR-026**.

#### `web-lint` W015 ahora mide la **fuente** de un `insert … select`

Esta va en cuatro pasos porque los cuatro hacen falta:

1. **El defecto original.** W015 preguntaba si `tenant_id` **aparecía** en la sentencia. En un
   `insert … select` la **lista de columnas siempre lo nombra**, así que el gate pasaba en verde una
   sentencia cuyo `select` no filtraba por tenant: **una fila por tenant de la tabla, escritura
   cruzada** — la peor versión del bug que W015 existe para cerrar, un nivel más abajo.
2. **El primer arreglo, y por qué estaba mal.** *"El tenant tiene que estar después del `where`"*.
   Eso encendió sobre un beacon de S4 que ata el tenant **en el `from`** y está perfectamente
   atado: un **falso positivo sobre código correcto**, que es la forma de romper un gate que este
   repo paga más caro — enseña a marcarlo `web-lint:sin-tenant` y seguir. La ventana correcta es
   **desde el primer `from` hasta el final**: la fuente del select más su `where`.
3. **Y el arreglo estaba mal igual. Lo encontró `adversary-reviewer`.** Buscaba **la subcadena**
   `'from'`. `listing_events.from_status` **existe hoy en el schema**, así que nombrar esa columna
   en la lista movía el arranque de la ventana **de vuelta adentro del paréntesis**, y W015 volvía a
   leer la lista de columnas como si fuera la fuente. **Reproducido por el LEAD antes de tocar
   nada:** un fixture, dos corridas, **la única diferencia `, "from_status"`** — con la columna
   `ok W015`, sin ella W015 enciende. O sea: **el gate tenía un caso de test que pasaba y una
   variante de UNA columna que lo apagaba**, y justo sobre la tabla del historial de estados, la más
   propensa del repo a que alguien escriba un backfill.
4. **La forma vigente.** Se busca el **token** `from` a **nivel 0 de paréntesis**, que resuelve las
   dos mitades de una: la lista de columnas es nivel 1, y un `from` adentro de un subselect de
   proyección también. **Tres fixtures nuevos** en el paso 4 (siete en total sumando los cuatro del
   paso 1), y uno de ellos es la variante de una columna que lo apagaba.

**La moraleja, y es reusable más allá de W015: ningún fixture del arnés usaba un identificador que
contuviera la palabra que la regla busca.** Un arnés de polaridad prueba que la regla **enciende**;
no prueba que enciende **sobre las formas que el schema real produce**. Es primo de **ADR-021** —la
aserción tenía la forma cómoda, no la forma del schema— y de la nota de método vigente: *un gate que
nunca se vio fallar no es un gate*, con el corolario de que **verlo fallar sobre un fixture inventado
no es verlo fallar sobre el repo**.
---

### S8.1 trajo un gate nuevo, y las tres decisiones de diseño son más reusables que el archivo

`scripts/guard-tradein-engine.sh` + `scripts/guard-tradein-engine.test.sh` (**15 fixtures**), los dos
del **LEAD**, los dos en `ci.yml`. `guard-gates.sh` da **PASS con 29 gates censados**, y **V6** de
`accept-s8.sh` dejó de ser inline: ahora lo llama y propaga sus `OK:` / `FALLA:`.

**1. Por qué no fue a `rls-lint`.** Lo pidió `db-agent` **en vez de editarlo**, que es lo correcto por
**ADR-022**: `packages/db/scripts/rls-lint.mjs` es del LEAD justamente porque audita las policies que
`db-agent` escribe. La respuesta fue que no va ahí, y el motivo no es de ownership sino de sujeto: **el
sujeto de `rls-lint` son las policies**, y la parte B de la `0009` es un **trigger**. Estirar un lint
hasta que cubra otra clase de objeto lo diluye hasta que deje de significar algo — el día que
`rls-lint` audite policies, triggers, funciones y constraints, *"`rls-lint OK`"* no va a querer decir
nada en particular. Gate nuevo, con su propio arnés de polaridad.

**2. Por qué censa el árbol de `.sql` y no la base.** El migrador de Drizzle decide qué aplicar
comparando **`created_at`, no el hash del archivo** (`CLAUDE.md` §3), así que **la base es la fuente
menos confiable que hay**: puede tener la `0009` aplicada a medias y `migrate` diciendo `OK`. El `.sql`
commiteado es lo único que sobrevive a eso. **La consecuencia honesta está escrita en el header del
propio gate y no se disimula: un `DROP TRIGGER` tipeado a mano contra `istock_dev` deja el gate
verde.** Defiende el repositorio, no una base. Un gate que promete más de lo que mide es peor que uno
angosto que dice dónde termina.

**3. La fixture que carga el peso es la del borde entre archivos.** El último statement de un `.sql`
**no** lleva `--> statement-breakpoint`, así que un censo ingenuo pega el final de la `0008` con el
principio de la `0009` y un `WITH CHECK (true)` **hereda** el `accepts_trade_in` del statement
anterior — o sea, el gate daría verde sobre una policy aflojada. Se vio encender. Es la misma familia
que el `from_status` que apagaba `W015`: **un arnés prueba que la regla enciende; no prueba que
enciende sobre las formas que el árbol real produce.** Y el gate toma el **último** statement que
define cada objeto, no cualquiera: el agujero que persigue no es el de hoy, es la `0012` que dropea el
trigger o que hace `ALTER POLICY … WITH CHECK (true)` para "arreglar" un test.

---

## FASE 5 — Chatbot (post S4/S8)  ·  **la condición de arranque se cumplió el 2026-08-28**
Capa 2. Se **diseña** en FASE 1, se **codea** después de S4/S8. **Las dos están ACEPTADAS**, así que
lo que faltaba deja de ser una dependencia de slice. Ver `docs/CHATBOT.md`, **y leerlo antes de
codear**: el diseño es de FASE 1 y `packages/ai` ya existe (`T19`), o sea que el código llegó
primero y el doc no está re-verificado contra lo implementado. Dos entradas propias de S8 caen acá:
**S8.2** (`listing.title` llegaba al prompt sin `sanitizeForPrompt`), **cerrada el 2026-08-28** en
`89ab7c0`, y con un dato que le sirve al que codee esta fase: la protección **no** vive donde se arma
el prompt, vive **una capa más arriba**, en el mapeo DTO → vista (`listing-view.ts`), y alcanza a
**todo** el texto del dueño con **un** envoltorio — porque siete envoltorios eran +150 tokens que no
entraban en la dieta. La otra era
**T43**, y **está cerrada desde el 2026-08-28**: `packages/ai/**` y `packages/domain/**` están censados
—por AST, no por texto crudo— en `tests/la-pii-del-visitante-no-sale-de-la-fila-del-canje.test.ts`, así
que el chatbot de FASE 5 **arranca con la afirmación puesta** en vez de tener que acordarse de ella.
Lo que ese test **no** cubría era S8.2 —ahí el problema no es PII, es contenido sin sanitizar—, y
esa mitad la cubre desde `89ab7c0` la sección propia de `packages/ai/src/listing-view.test.ts`.

**Y cuatro filas más aterrizan acá, las cuatro de la auditoría de costo del 2026-08-28:** **`T50`**
(el techo de llamadas facturadas por turno — **cerrada el 2026-08-28 en `89ab7c0`**: quedó en **3**,
derivado de `MAX_TOOL_ROUNDS`, con el peor caso y la constante afirmados por separado; deja de ser
trabajo de esta fase y pasa a ser el número con el que se lee todo lo demás, **incluida `T54`**, que
es el drift que quedó en `COST.md`), **`T51`** (emitir `billed` al
log y alarmar — **contra las tres condiciones que el LEAD arbitró el 2026-08-28, `CLAUDE.md` §5, no contra `calls > 2`**), **`T52`** (el techo de 1200 tokens de entrada, `blocked` por
**decisión humana**) y **`T53`** (el `ContextTrimReport` que no lee nadie). **Ninguna bloquea el
arranque de la fase, y la dirección de las dependencias es la contraria — que es lo que hay que ver
antes de codear:** `T51` y la mitad de producción de `T53` **esperan a que exista `/api/chat`**, o
sea a esta fase; y como `T53` es lo que hace decidible a `T52`, **la decisión del techo de dieta
sobre fichas de tenants REALES no se puede tomar antes de FASE 5 más un período de tráfico.**
Decidirla antes es legítimo —el precio está medido— pero es decidirla sobre el corpus sintético, y
conviene que eso sea una elección y no un descubrimiento.

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
| B1 | probe de byte real contra R2 mediante el pipeline de la app; las credenciales ya están cargadas en Production | K5, S2, **S2.1** | **LEAD** |
| B2 | proyecto Neon Postgres/Auth + credenciales de Production | D2, D3 | **humano** |
| B3 | prueba externa de Mercado Pago: cuenta/test checkout/webhook; integración segura implementada pero sin cobro verificable | FASE 6, **ADR-008** | **humano** |
| B4 | claves LLM opcionales ausentes — **no bloquea producción ni el preflight actual** | FASE 5 | **humano** |
| B5 | nameservers de `maat.work`: **resuelto para el deployment actual**, el alias `https://istock.maat.work` responde | K3, S1 (prod) | **cerrado** |
| B6 | número de WhatsApp del tenant demo — **ya tiene forma de env**: entra por `SEED_DEMO_WA_PHONE` y sin él `packages/db/src/seed.ts` cae en `SEED_DEMO_WA_PHONE_FALLBACK`, que es un placeholder | demo mostrable a prospectos | **humano** |
| B7 | cuenta/app Production de Inngest, `INNGEST_SIGNING_KEY` y `INNGEST_EVENT_KEY` cargadas y sincronización de funciones | S6 final, producción | **humano + LEAD** |
| B8 | decisión pendiente de subir el equipo Vercel de Hobby a Pro | producción comercial | **humano + LEAD** |
| B9 | sincronización de Inngest y un run real de `*/5 * * * *` en el deployment actual (**UNVERIFIED**) | S6 final, producción | **LEAD + humano** |

> **Nota histórica de B5 (FASE 1 / R1).** El wildcard `*.maat.work` se certificaba por DNS-01, y
> Vercel sólo lo emitía si el dominio usaba **sus** nameservers. Ese era el blocker con más lead
> time del plan inicial. **Estado vigente 2026-09-05:** el alias `https://istock.maat.work` responde;
> B5 ya no bloquea K3 ni S1 del deployment actual.
> Efecto colateral a mirar antes de apretar el botón: todo registro MX/TXT actual de `maat.work`
> (mail, verificaciones) hay que recrearlo en Vercel o se cae.

> **Qué NO es un blocker, y por qué se escribe acá en vez de dejarlo implícito.** `T52` —el techo de
> `MAX_INPUT_TOKENS = 1200`— **es una decisión humana pendiente y aun así no es un `B<n>`**. El
> criterio lo da la columna *bloquea* de esta tabla: los blockers son **insumos externos que el
> equipo no puede producir** (credenciales, DNS, un número de teléfono) y **cada uno bloquea trabajo
> que no puede arrancar sin él**. `T52` no bloquea nada: el código corre hoy, entra en 1200 y
> **degrada** — el síntoma es de calidad, no de parálisis. Meterlo acá lo haría parecer un trámite
> pendiente del humano cuando es una elección de producto con el precio ya medido, y sacaría de la
> única tabla donde se lee junto con `T50`, que es con lo que hay que leerlo.
> Queda dicho para que la próxima pasada no lo "arregle" abriendo un `B7`: la ausencia es
> deliberada. **Si el LEAD prefiere que sea un blocker, es una línea y la mueve** — la clasificación
> es suya, no de este documento.
