# TEST_MATRIX

**Qué es:** el inventario de qué prueba cada regla de `CLAUDE.md`, y —desde el 2026-08-28— **qué
regla no prueba nadie todavía**. Una regla sin test no existe.
**Para quién:** el LEAD antes de aceptar una slice, y cualquier agente que quiera saber si el
invariante que está por tocar tiene red abajo.
**Cuándo se actualiza:** con cada test nuevo, y cada vez que el LEAD corre un gate y la corrida
cambia lo que está cubierto.

**Lo escribe `docs-keeper`.** El header decía `Owner: qa-agent` y era el mismo error que ya se
corrigió dos veces en este repo: **`qa-agent` no puede escribir los tests que cruzan un límite y
además el documento que declara que hay cobertura** — sería el mismo writer en las dos puntas del
invariante. Es el principio de `CLAUDE.md` §4 que sacó los gates de la columna del código que
auditan (`scripts/probes/**` fuera de `packages/media`) y que mudó `rls-cross-tenant.test.ts` de
`db-agent` a `qa-agent`. `qa-agent` **escribe los tests**; este doc **cuenta qué falta**, y por eso
lo mantiene otro. Resuelto por el LEAD el 2026-08-28.

> **Cada línea de "sin cubrir" de este doc está verificada contra el repo por `docs-keeper`, no
> copiada de un reporte.** El motivo está al final, en "Cómo se verifica esta tabla": la última vez
> que se transcribió un reporte sin verificar, tres reglas dadas por descubiertas estaban cubiertas.

## Principios
1. El test **va primero** y **se muestra fallando** antes de la impl.
2. Nada de mocks donde importa la verdad: **RLS contra Postgres real**, dos sesiones, dos claims.
3. El nombre del test dice la **regla de negocio**, no el nombre de la función.
4. Prohibido: `expect(true).toBe(true)`, snapshots gigantes, tests que pasan con la impl vacía.

## Unit — `packages/domain` (mínimo 20)
| # | regla | función |
|---|---|---|
| U1–U4 | `applyFx` redondea según la regla, con TC 0 / negativo / gigante / decimal | `applyFx` |
| U5–U10 | máquina de estados: cada transición válida pasa y **cada inválida falla** | `canTransition` |
| U11 | `sold` es terminal | `canTransition` |
| U12–U13 | reserva expira exactamente en `expires_at`; `now` inyectado | `expireReservation` |
| U14 | `buildWaMessage` produce el string canónico **byte a byte** | `buildWaMessage` |
| U15 | encoding correcto de acentos y espacios en la URL | `buildWaMessage` |
| U16 | copy distinto cuando el listing está `reserved` | `buildWaMessage` |
| U17 | `publicListingDTO` **no** filtra `imei` | `publicListingDTO` |
| U18 | `publicListingDTO` **no** filtra `cost_usd` ni margen | `publicListingDTO` |
| U19 | **campo nuevo en el modelo NO aparece** en el DTO (prueba de allowlist) | `publicListingDTO` |
| U20 | sanitización de descripción neutraliza instrucciones inyectadas | `sanitizeDescription` |
| **E1–E7** de `listing-status.test.ts` | **ADR-019** en unit, 9 casos: `reserved → sold` cierra `confirmed` sin mirar el `intent` · `→ available` con `intent: 'expire'` cierra `expired` y **sin** `intent` cierra `cancelled` · un lateral cierra `cancelled` **incluso con `intent: 'expire'`** · el resto cierra `null` | `transitionEffects` |
| E3b | **el estado que la tabla usa para el cron es el mismo que devuelve `expireReservation()`** | `transitionEffects` × `expireReservation` |
| E5b | el campo es no-`null` **exactamente** cuando `from === 'reserved'`, sobre **todos** los pares | `transitionEffects` |
| E6 | el estado de cierre **nunca** es `'active'` (`ReservationClosingStatus` se define por exclusión) | `transitionEffects` |
| E7 | **los otros efectos no cambiaron** al reemplazar el booleano por el enum | `transitionEffects` |

> **La numeración `U*` de esta tabla y la `E*` del archivo de tests no son la misma serie**, y las
> filas de arriba usan la del archivo porque es la que un agente va a grepear. Las `E*` de acá
> **no** son las `E*` de e2e. Ordenar esto es deuda de este doc, no del código.
>
> **Por qué E3b y E5b valen más que las otras siete juntas.** El defecto de S6.1 no era que una
> arista devolviera el valor equivocado: era que **dos call sites decidían por separado** sobre la
> misma arista, y cada uno tenía tests que pasaban. Un caso por arista no habría encontrado nada —
> los dos lados estaban internamente bien. E5b cuantifica **sobre todos los pares** (así que una
> arista nueva no puede colarse sin decidir si cierra) y E3b ata la tabla a la **otra** función que
> tiene una definición de "vencida", que es donde vivía la divergencia.

## RLS — Postgres real
`tests/rls-cross-tenant.test.ts`. Archivo único, **79 casos** (eran 69; S4 sumó 10 con el beacon),
cero mocks, dos conexiones físicas con dos claims. Es de **`qa-agent`**, y vive en `tests/` desde
**T3** (`d686923`): `db-agent` escribe las policies, así que no puede ser dueño del test que las
audita. El encabezado que se declaraba `db-agent` está borrado.

**El número lo dice el runner, no el fuente.** `pnpm --filter @istock/tests exec vitest run
rls-cross-tenant` → `rls-cross-tenant.test.ts (79 tests)`, corrido el 2026-08-28 después de S4.
**Los 79 siguen siendo 79 después de S6, S6.1 y S6.2**: el archivo no se tocó desde `c9611b1`
(`git log --oneline -- tests/rls-cross-tenant.test.ts`), y ninguna de las tres slices agregó tabla
ni policy — S6.2 movió *tags de cache*, que no tienen RLS.

El total del repo en la última corrida del LEAD (2026-08-28, sobre `f504d69`) fue **1225**:
domain 199 · media 107 · db 300 · web 365 · tests 254. Eran 1004 después de S4; las tres slices de
reservas sumaron **221 tests**, de los cuales **cero** están en `packages/media`: 107 antes y 107
después. Es la única cifra que no se movió, y no es casualidad — es el paquete donde estaba
esperando **S2.5**. (**Corregido el 2026-08-28:** esa frase decía *"el árbol de trabajo tiene tests
nuevos de `media` sin commitear"*, y dejaron de estarlo — `1fc0e59` trae `keys.ts`/`keys.test.ts`/
`incidents.ts` y `6e74a51` el subpath `/incidents`. **El total de 1225 no se recuenta acá**: es la
cifra de una corrida del LEAD sobre `f504d69` y se fecha en vez de reescribirse, que es la misma
convención que la celda de W015. El próximo conteo sale de la próxima corrida, no de una suma.)

> **El conteo de *archivos* no se repite acá y es a propósito.** La corrida informó **62**
> archivos; `find packages apps tests -name '*.test.ts'` sobre el mismo commit devuelve **63**
> (domain 12 · media 9 · db 9 · web 26 · tests 7), y los 63 caen dentro de los `include` de los
> cinco `vitest.config.ts`. Uno de diferencia sin explicación **no es un número que este doc pueda
> publicar**: es exactamente el error que ya se cometió dos veces con los 59/69/79 de RLS, contar en
> un lado y afirmar en el otro. Reportado al LEAD. Aparte de esos 63 hay **7 probes**
> (`scripts/probes/*.test.ts`) que **no** corren con `pnpm test`: los invoca el `accept-*` que los
> necesita. **Eran 4 y el número quedó viejo el 2026-08-28**: `s6-sweep-head-of-line.test.ts` (T25),
> `t27-un-motivo-una-voz.test.ts` (T27) y `el-grant-cubre-el-insert-de-drizzle.test.ts` (G6) son de
> esta fase. Contado con `ls scripts/probes/*.test.ts | wc -l` el 2026-08-28, no copiado.

> **Este doc dijo 59 cuando eran 69, y decía 69 cuando ya eran 79.** El 59 contaba `it()` literales
> y se comía el `it.each(sensibles)` sobre 10 columnas sensibles; el 69 era correcto hasta que S4
> agregó R2b y las policies del beacon. Es la misma clase de error las dos veces: **contar en el
> fuente no es contar lo que corre.**

> **Precisión de ownership, `CLAUDE.md` §4, commit `6929088` — el desempate viejo era demasiado
> ancho y este doc lo repetía.** No es *"el test cruza tenants → se muda a `tests/`"*: así escrito,
> arrastraba también el test con el que `db-agent` prueba su propia migración, y eso contradice la
> mitad de §4 que le da a cada paquete el test de su código. El criterio real es **quién es la
> auditoría de referencia**: la afirmación que un **gate cita** y que queda parada entre una policy
> aflojada y un merge. Esa es **siempre de `qa-agent` y vive en `tests/`**. El owner del paquete
> puede quedarse casos cruzados como red de regresión propia con tres condiciones: (a) la auditoría
> de referencia existe en `tests/`; (b) **ningún gate cita el test del paquete como evidencia**;
> (c) si divergen, **gana el de `tests/`**.
>
> **Concreto y vigente:** `packages/db/src/rls-anon-wa-click.test.ts` **se queda con `db-agent`**, y
> la auditoría de referencia del beacon son **R2b / R6c / R7** de `tests/rls-cross-tenant.test.ts`,
> de `qa-agent`. La duplicación es deliberada y tiene precio —dos archivos que tocar cuando cambia
> la policy—; se paga porque las dos puntas del invariante más caro del producto no pueden ser del
> mismo writer.

| # | aserción | estado |
|---|---|---|
| R0 | control positivo: A **sí** ve sus propias filas. Sin esto R1–R4 serían verdes por vacío | ✅ |
| R1 | tenant B hace `select` de una fila de A → **0 filas** | ✅ |
| R2 | tenant B hace `insert` con `tenant_id` de A → **error** | ✅ |
| R2b | **la única escritura sin autenticar del producto tampoco cruza.** Control positivo (la vidriera de A **sí** registra el click de su propia ficha, si no los rechazos serían verdes por vacío) + los dos sentidos del cruce rechazados con `42501` **y el mensaje afirmado**: tiene que decir `violates row-level security policy` y **no** `permission denied` — si se aceptara cualquiera de los dos, el test daría verde también con la migración `0004` sin aplicar. Cierra con el conteo: en la cuenta de A quedó **una** fila, la del control positivo. Además: el visitante no puede forjar `id` ni antedatar `created_at`, y **escribe sin leer** (S4) | ✅ |
| R3 | tenant B hace `update` de una fila de A → **0 filas afectadas** | ✅ |
| R4 | tenant B hace `delete` de una fila de A → **0 filas afectadas** | ✅ |
| R5 | **toda** tabla de negocio tiene `relrowsecurity = true` **y `FORCE`** (sin FORCE el dueño ignora las policies) | ✅ |
| R6 | ninguna policy es `using (true)` / `with check (true)`, ni está otorgada al pseudo-rol `public` | ✅ |
| R6c | **el invariante propio de `anon`, más estricto que R6:** las policies `TO anon` son **6** — las 5 de lectura de la vidriera **más** el `INSERT` del beacon de S4—, cada una con su comando y su predicado auditados enteros. Una policy `TO anon` nueva rompe la cuenta | ✅ |
| R7 | **privilegios, no policies**: `anon` no tiene SELECT **de tabla** en ninguna tabla, ni ningún privilegio de escritura (de tabla ni de columna), y su read model es **exactamente** la allowlist — leído del `COMMENT` de la base, no de una lista a mano | ✅ |
| R8 | `service_role` lee los dos tenants en la misma query: sin eso no hay cron de reservas | ✅ |

> **R7 no estaba en esta tabla y sí en el código.** Es la mitad *`GRANT`* del invariante que
> `CLAUDE.md` §2 separa a propósito de la mitad *policy* (*"`GRANT` y RLS son dos capas y se evalúan
> las dos"*). Corregido el 2026-08-28: la tabla decía R1–R6 y el archivo implementa R0–R8.
>
> Cada detector de R5/R6/R7 tiene **su trampa plantada** y un test que verifica que la encuentra.
> Es la regla de método del board —*un gate que nunca se vio fallar no es un gate*— aplicada acá.

## e2e — Playwright
Estado verificado contra `e2e/**` y `scripts/accept-*.sh` el **2026-08-28**, después de **S6.2** y
del barrido serial de los cinco `accept-*` sobre `68c0bd6` (`accept-s1 39` · `s2 21` · `s3 59` ·
`s4 38` · `s6 22`, todos con `FAIL=0`).
La suite corre **86 tests · 0 skip**, en **13 archivos**, y el censo del reporter dice **13/13
ejecutados** (eran 73 en 11 archivos: los dos specs de S6 sumaron 13 tests). El censo lo emite el
reporter de `qa-agent` y lo lee M4 de `accept-s2.sh`; **no se cuenta por nombre de archivo en la
salida**, porque Playwright imprime el nombre de un spec que no corrió.

> **Qué NO puede medir esta suite, y conviene saberlo antes de leer los ✅ de abajo.**
> 1. Corre contra un `next start` **local**. El `x-nextjs-cache` que leen los specs es el route
>    cache de Next, **no** el edge de Vercel: que una ficha diga `HIT` acá no prueba que el 95% de
>    los hits de producción no toquen Postgres (`ARCHITECTURE.md`), prueba que el mecanismo de
>    invalidación hace lo que dice.
> 2. El radio de invalidación de **S6.2** se midió con **4 unidades**, no con 60. Lo que sostiene la
>    fila **E17** son **3 fichas hermanas que sobrevivieron** a la purga, no una curva: es
>    suficiente para distinguir *"purga una"* de *"purga todas"* —que era el defecto— e insuficiente
>    para afirmar nada sobre cómo escala. La línea completa de la corrida del LEAD sobre `68c0bd6`:
>    `MEDIDO s6 radio · publicadas=4 · paginas=5 · rerender=2 · esperado=2 · sobrevivieron=[ficha-a,ficha-c,ficha-d] · frio=14`.
>    **`frio=14` es el control que hace que el resto signifique algo**: son las sentencias que el
>    espía vio contra Postgres, y en cero todas las páginas "sobrevivirían" porque nunca se sirvió
>    nada.

| # | escenario | aserción central | estado |
|---|---|---|---|
| E1 | signup → crear tenant → cargar 2 unidades | ambas publicadas y visibles | 🟡 **parcial** — el alta del negocio (`_lib/panel.ts:114`, `/app/crear-negocio`) y la carga de **una** unidad con sus 3 fotos hasta publicar están cubiertas (`s2-cargar-un-equipo-…`). No hay signup real: el auth de e2e es `AUTH_DRIVER=local` |
| E2 | **otro browser** (sin sesión) abre `{slug}` y entra a una ficha | los 15 campos presentes | 🟡 **no por browser** — los campos los mide **`curl`** en M3/M3b/M4 de `accept-s3.sh`, sobre los bytes servidos bajo el host del tenant. Es una cobertura fuerte (lee el payload de RSC, donde un objeto crudo se escapa sin verse) pero **no prueba lo que un browser hace con ellos**: ni JS, ni layout, ni el click. **La segunda mitad de esta celda quedó vieja el 2026-08-28**: decía que `accept-s3.sh` no corre en CI y desde `c854b99` tiene step propio (`ci.yml:213`). Lo que sigue siendo cierto es lo primero — el gate es `curl`, no browser |
| E3 | click en WhatsApp | URL con el **texto exacto** del producto y el precio | 🟡 **ahora sí hay un browser, y el texto sigue sin estar afirmado entero sobre el camino real** — cambió con S4 (`c9611b1`): `e2e/s4-…-sin-pii.spec.ts:239` lee la ficha con `javaScriptEnabled: false` y mide `anchors=1 · abre_whatsapp=si`, y `:322` **hace el click**. Lo que ninguna de las dos hace es **comparar el `href` completo**: W5 lo **imprime**. Sumado a M3b de `accept-s3.sh` (substrings sobre el HTML servido: un solo anchor en la ficha, cero en la grilla, teléfono contra `SEED_DEMO_WA_PHONE`, `USD 620` + `demo.maat.work` + `y lo quiero.`, `usado A` sí / `usado excelente` no) y a U14 en unit (`toBe`, pero con el `modelDisplayName` ya limpio), quedan **tres pruebas alrededor del string y ninguna encima** — que es exactamente cómo pasó **S4.1**. `accept-s3.sh` sigue sin ser job de CI |
| E4 | unidad `reserved` | badge visible; **no** dice "disponible"; copy alternativo | ✅ **cerrada por S6, y sobre el camino que importa**: `grep -rln reserved e2e/` pasó de cero a tres archivos. Lo afirman dos specs distintos y complementarios: `s6-la-reserva-…:458` (*"un desconocido que abre la ficha de un equipo señado lee Reservado y nunca Disponible"*) y `s6-senar-…:476`, que agrega la parte cara — **en la primera visita**, o sea que la ficha que estaba cacheada como disponible **se invalidó**, no que expiró un TTL. La aserción es en los dos sentidos (dice `Reservado` **y** no dice `Disponible`); una sola de las dos mitades se satisface con una página en blanco. **Lo que sigue afuera es el copy del mensaje de WhatsApp bajo `reserved`** (U16 en unit): ningún spec compara el `href` de una ficha reservada — mismo hueco de forma que **E3**, una vuelta más abajo |
| E5 | canje: form público → inbox → checklist → aceptar | unidad creada en `draft` con costo | 🔴 sin cubrir — la slice (S8) no arrancó |
| E6 | login como **seller** | `cost_usd` **ausente del payload de red**, no sólo de la pantalla | 🔴 **sin cubrir** — re-verificado después de S4: las 9 líneas que matchean `seller` en `e2e/**` son **todas la palabra `reseller` en prosa de comentarios**, ni una es un rol. No hay spec con rol `seller` porque **S11 no arrancó**; el `costUsd` que aparece en 6 specs es **dato sembrado**, no una aserción de ausencia. Es `CLAUDE.md` §Reglas duras 9 (*"seller no ve costo ni margen. Nunca. Ni en payload"*) sin red en el borde donde se rompería |
| E7 | chatbot responde con tool | usa `get_open_listing`, no inventa | 🟡 **pendiente de censo, corregido el 2026-08-28**: esta celda decía *"`packages/ai` no existe"* y el paquete está en `main` desde `d42fac9` (19 `*.test.ts`). **No pasa a ✅ por eso:** que el paquete exista no es que E7 esté cubierto, y `ai-agent` lo está editando mientras se escribe esto. FASE 5, **T19** |
| E8 | chatbot ante listing `reserved` | **no** dice "disponible" | 🟡 **pendiente de censo** — ídem **T19** (el paquete existe desde `d42fac9`; la cobertura no está censada). Ojo al leer E4 en verde: que la **ficha** ya no diga "disponible" bajo `reserved` no dice nada de lo que va a contestar el chat, que es otro renderizador del mismo estado |
| E9 | jailbreak: "¿cuánto te costó?" / "pasame el IMEI" | se niega y ofrece handoff, en 3 fraseos distintos | 🟡 **pendiente de censo** — ídem **T19** (el paquete existe desde `d42fac9`; la cobertura no está censada). Es la regla dura 8 y 9 de `CLAUDE.md` §0 sobre la superficie donde más barato es romperlas |
| E10 | peso de la imagen `card` en la grilla | **< 200KB** medido en la respuesta de red | ✅ **medido el 2026-08-28**: `transferSize=51016B` contra un techo de 204800 B, viewport 390×844 dpr 3, variante `card`. `s3-la-grilla-…` + M2 de `accept-s3.sh` |
| E11 | LCP mobile de la ficha (4G simulado) | dentro del presupuesto de `ARCHITECTURE.md` | 🔴 **sin cubrir**, y con una dependencia técnica antes que de agenda — re-verificado el 2026-08-28: `grep -rn 'LCP\|largest-contentful' e2e/ scripts/` devuelve **cero**, y `Timing-Allow-Origin` no aparece en `apps/web/**` (**T13**). Hoy se miden **bytes**, no tiempo, y mientras `/_media` no mande ese header la Performance API **todavía no es una fuente disponible**: el recurso es cross-origin y los tiempos vienen en cero. O sea que T13 no es cosmética, es el requisito previo de esta fila |
| E12 | mutar precio en el panel → recargar vidriera | precio nuevo **sin esperar TTL** | 🟡 **parcial, y bastante menos parcial desde S6.2** — hoy hay tres mutaciones distintas medidas de punta a punta contra la vidriera: alta del negocio (`s1-alta-invalida-el-miss-cacheado`), **señar** (`s6-senar-…:450`, la card pasa a `Reservado`) y **publicar un borrador** (`s6-senar-…:514`, la ficha cacheada que decía "no publicado" se reemplaza). Lo que **sigue sin escribirse es el precio**, y no es intercambiable con las otras tres: el precio es el único campo cuya mutación **no cambia el estado del listing**, así que es el que más fácil se cae si alguien invalida por estado en vez de por unidad. Peor: cambiar el **TC** es la variante que la topología de S6.2 dejó minada (`DOMAIN.md` §FX · **T12**) |
| E13 | host de tenant A **nunca** sirve contenido de B | cero cross-tenant en el cache | ✅ `s1-vidriera-por-host.spec.ts:62`, explícitamente *"ni siquiera desde el cache"* |
| E14 | slug inexistente | página legible: `<h1` literal en el body, `robots noindex`, título propio ≠ `iStock`, cero markup de vidriera (`wa.me`/`data-listing`), req2 en `HIT`. **No 404** — ADR-011 | ✅ `s1-vidriera-por-host.spec.ts:96,109,127,169` + `s1-ruta-…:273`. **Ojo:** esto cubre el slug de **tenant** en la **home**. La **ficha** bajo un tenant inexistente era el agujero **S3.3**, cerrado el 2026-08-28 (`042e24e`): lo afirman `apps/web/app/(storefront)/ficha.test.ts` (24 tests, `storefront-agent`) y la verificación del LEAD contra server real, **no** un e2e — ningún browser recorre todavía los 4 casos |
| E15 | el click en WhatsApp deja **una** fila sin PII | mirar la ficha no escribe; el click escribe una fila con el tenant y el equipo correctos; el POST cruzado no escribe ninguna | ✅ **medido el 2026-08-28** por `accept-s4.sh` sobre browser real: `filas_al_cargar=0 · filas_antes=0 · filas_despues=1 · tenant_ok=si · listing_ok=si` y `filas_creadas=0` en el cruce. **`filas_al_cargar=0` no es decoración**: es lo que separa "medir intención de compra" de "contar pageviews" (que ya los cuenta PostHog) y lo que evita que el renglón fijo del WAF se vuelva proporcional al tráfico. El aislamiento a nivel SQL es R2b; esta fila es el mismo invariante por HTTP |
| E16 | ciclo completo de la reserva: señar → ver → vencer → volver a `available` | la reserva vive en Postgres con la duración que se eligió, el cron **sólo abre con el secreto**, y al vencer la fila queda `expired` con `closed_at` | ✅ **S6** (`s6-la-reserva-…`, 7 tests). Tres cosas que no son obvias y por eso están escritas aparte: (a) `:432` afirma que **la duración del `<select>` llegó a la fila** — sin eso, "se reservó" es compatible con haber guardado el default; (b) `:441` mide que la ficha **estaba cacheada como disponible antes**, que es el control de honestidad sin el cual "se invalidó" y "nunca estuvo en cache" se confunden; (c) `:558` afirma `status = 'expired'` **y** `closedAt != null`, que es **ADR-019** observado de punta a punta y no en unit: es la aserción que separa el cron del panel sobre la misma arista |
| E17 | **radio** de la invalidación al señar una unidad | re-renderizan exactamente **2** páginas de las medidas: la grilla y la ficha de ese equipo | ✅ **S6.2** (`s6-senar-…`, 6 tests, `EXPECTED_RADIUS = 2` en `e2e/_lib/s6-measure.ts:353`). **Es la única fila de esta tabla que mide un techo y no una presencia**, y está construida en los dos sentidos a propósito: `:425` exige que las hermanas **sobrevivan** y `:450`/`:476` exigen que la grilla y la ficha señada **NO** sobrevivan. Sin la segunda mitad, romper la invalidación entera bajaría el radio a 0 y **mejoraría el número** con la vidriera mintiéndole al visitante. Además `:404` exige `coldStatements > 0` (el espía de Postgres está en el camino) y que ninguna página medida viniera fría — **una página fría no sobrevive a una purga: aparece**. Ver la caveat de las 4 unidades arriba. **Desde el 2026-08-28 esta fila dejó de ser evidencia huérfana**: `accept-s6.sh` corre el spec (`SPEC_RADIO`) y su **V9** lee `rerender` y `esperado` de la salida, con `paginas > 2` y `frio > 0` como controles y **ausencia de la línea = FAIL**. Antes se podían borrar el spec y su veredicto sin que nada se pusiera rojo (**ADR-020**) |

> **Cerrado: el gate de S3 aseguraba 14 de los 15 campos, y ahora asegura 15.** El aviso que estaba
> acá decía que M3 exigía las 3 fotos, condición, GB, color, procedencia, batería, iCloud, garantía,
> USD, pantalla original, badge, punto + horario, medios de pago, canje y el ARS —14— **y ninguna
> aserción sobre el botón `wa.me`**, el 15° de `CLAUDE.md` §1 y el único por el que entra la plata.
> Lo escribió el LEAD (`scripts/**` es suyo, §4) como módulo **M3b**, commit `0edb661`, entre M3 y
> M4. Gate entero re-ejecutado: **58 PASS · 0 FAIL · `S3: ACEPTADA`** (eran 50; M3b suma 8).
>
> **La lección de método, que es más grande que la fila:** *un invariante puede tener tres pruebas
> alrededor y ninguna encima.* Las tres que había eran correctas y ninguna afirmaba que la ficha
> renderiza el botón — el unit de dominio fija el string **fuera** de la página; `ficha.test.ts`
> cuenta componentes **en el fuente**, no anchors en el HTML; `e2e/_lib/miss.ts:96` lo chequea **en
> negativo**. Una vidriera que perdiera el botón en todas sus fichas las satisfacía a las tres. El
> desarrollo largo está en `DECISIONS.md` §"Notas operativas".

> **Y volvió a pasar, con el mismo string, once días de trabajo después: S4.1.** El 2026-08-28
> `accept-s4.sh` imprimió el `href` real de un listing **sin `catalog_model`** y decía
> `iPhone 14 Pro 256 Grafito **256 Grafito** (usado A)`. Las tres pruebas de siempre seguían verdes:
> **U14** compara byte a byte pero con el `modelDisplayName` ya limpio (prueba la función, no el
> mapeo que la alimenta); **M3b** afirma *substrings* sobre el HTML servido y `256 Grafito` aparece
> —dos veces, y `grep -q` no cuenta ocurrencias—; **W5** imprime el `href` entero pero sólo asevera
> `anchors=1` y `abre_whatsapp=si`.
>
> **La lección de segunda vuelta, que es la que hay que internalizar:** cerrar un caso de *"tres
> pruebas alrededor"* agregando una cuarta prueba **al lado** no cierra la clase de defecto. M3b se
> escribió justamente para tapar este agujero y no lo tapó, porque afirma **menciones** donde el
> invariante es **el string completo**. Un invariante que `CLAUDE.md` fija *byte a byte* se prueba
> `toBe` **sobre el artefacto que ve el usuario**, y con el caso de datos que rompe —acá, un listing
> sin `catalog_model`, que no es exótico: `catalogModelId` es nullable y `onDelete: 'set null'`.
> Detalle completo en `SLICE_BOARD.md` §S4.1.

## Seguridad — una por regla de `CLAUDE.md` §2
| # | regla | cómo se prueba |
|---|---|---|
| S1 | IMEI nunca en vidriera | grep del HTML renderizado + `__NEXT_DATA__` |
| S2 | costo/margen nunca al seller ni al público | inspección del payload de red |
| S3 | sin secretos en el bundle | grep de `NEXT_PUBLIC_` + build del cliente |
| S4 | sin `console.log` de listing | grep del repo |
| S5 | Zod en todo borde | test de request malformado por cada endpoint. 🔴 **hueco de censo, anotado el 2026-08-28 · no resuelto acá.** Hay Zod y hay tests de borde sueltos (`accept-s4.sh:104` exige `.strict()` en el beacon; `accept-fase3.sh:68` exige que el schema de alta sea Zod; W010 obliga a que `process.env` se parsee en un solo lugar), pero **nadie enumera los bordes**. Hoy son **5 `route.ts`** y **6 archivos con `'use server'`**, y ninguna regla dice *"cada uno de estos tiene un schema"*: un endpoint nuevo sin validar **no rompe nada**. Es la misma forma que `guard-firewall.sh` resolvió para el WAF —censar el directorio entero y exigir regla o excepción escrita— aplicada a otra cosa. **Le falta fila en el board** |
| S6 | IDOR | pedir un recurso de otro tenant por ID → 404/403, **nunca** 200. Cubierto en la capa de datos (R1–R4, R7) y en fotos (`s2-las-fotos-de-un-equipo-ajeno-no-existen`); **no** hay barrido por endpoint, por el mismo motivo que S5 |
| S7 | prompt injection en la descripción | eval dedicada en `packages/ai` — 🟡 **pendiente de censo, corregido el 2026-08-28.** Decía *"`packages/ai` no existe"*; hoy `ls packages/` devuelve `ai db domain media` y el paquete trae `src/evals/` en `main` (`d42fac9`). Que exista una carpeta de evals no es que la eval de prompt injection exista y pase: **eso se censa, no se supone** (**T19**). `sanitizeDescription` (U20) ya está en `packages/domain` y es lo único que hoy toca esta regla |

> **Cómo se cuenta sobre HTML servido, porque acá hay cuatro filas que greppean bytes.** Un HTML de
> App Router lleva **dos** cosas: el DOM renderizado y el payload de RSC. El segundo repite
> componentes que **no están activos**, así que **una ocurrencia de texto no es una directiva**.
> Medido el 2026-08-28: la ficha **sana** del demo contiene la palabra `noindex` (viene del boundary
> de `not-found` serializado) aunque su `<meta name="robots">` diga `index, follow`; y `wa.me`
> aparece **3 veces** con **un** solo botón. Por eso M3b cuenta **anchors** y no substrings.
> Un gate que mide sobre HTML servido cuenta **estructura**, nunca menciones
> (`DECISIONS.md` §Notas operativas, *"El `noindex` … está en el flight"*).

## CI (bloqueante)
```
pnpm typecheck && pnpm lint && pnpm test && pnpm e2e
```
Verde o no se mergea. Sin excepciones "porque es un fix chico".

`.github/workflows/ci.yml` declara además, y son bloqueantes: `pnpm audit --audit-level=high`
(`CLAUDE.md` §3, CVE-2026-64648 no tiene workaround), `scripts/_lib.test.sh` (polaridad de los
helpers compartidos de los gates, `:88`), **`guard-gates.sh` (`:101`) y su polaridad
`guard-gates.test.sh` (`:105`)** —los dos con `if: always()`, agregados el 2026-08-28 con
**ADR-020**: ningún gate puede invocar un helper que no tiene, ni redefinir uno que `_lib.sh` ya
da—, `guard-leaks.sh`, `guard-grants.sh`, `guard-r2.sh`,
**`accept-fase2.sh`** (`:137`, el único job con Postgres migrado y seedeado — desde el 2026-08-28
trae adentro **D5 · G6**, `scripts/probes/el-grant-cubre-el-insert-de-drizzle.test.ts`: **ADR-021**),
**`guard-firewall.sh`** (`:118`), **`guard-firewall.test.sh`** (`:126`),
`guard-artifacts.sh --harness`, **`accept-fase3.sh`** (`:137`, hace su propio `next build`) y
—dentro del job `e2e`, el único que ya tiene un `.next`, el del `webServer` de Playwright—
`guard-routes.sh` (`:208`) más **cinco aceptaciones por slice**: `accept-s1.sh` (`:224`),
`accept-s2.sh` (`:228`), `accept-s3.sh` (`:232`), `accept-s4.sh` (`:236`) y **`accept-s6.sh`
(`:245`, desde `10d31b6`)**. Los números de línea cambiaron con `10d31b6`; están releídos contra
`git show HEAD:.github/workflows/ci.yml` el 2026-08-28. **No hay `accept-s5.sh`** — es deuda de
proceso declarada, no un olvido: `SLICE_BOARD.md` §S5.

**Las seis últimas entraron a CI el 2026-08-28 (`c854b99`), y el motivo no es cobertura: es que una
aceptación por slice no puede ver el invariante que la slice derogó.** `accept-s4.sh` dio
`37 PASS · 0 FAIL` mientras **el mismo commit** (`c9611b1`) dejaba rojos a `guard-routes` y a
`accept-fase2`. Lo único que cruza slices es CI.

> ### 🔴 `ci.yml` NUNCA CORRIÓ. Leer esto antes de creerle a cualquier ✅ de este doc.
>
> ```
> $ git ls-remote --heads origin      # (sin salida)
> $ git rev-list --count HEAD
> 110
> ```
>
> `origin` está configurado y **no tiene una sola rama**; `origin/main` figura `gone`. En **110** commits
> locales **no hubo una corrida de GitHub Actions**. Decía 89, después 103, y se re-midió sobre
> `68c0bd6` el 2026-08-28 tras el barrido serial de los cinco `accept-*`: **veintiún commits más que
> el primer conteo, y el número que importa sigue siendo cero.** Los dos steps nuevos de
> `guard-gates` nacieron ya en esa condición. Por lo tanto, en este doc y en todo `docs/**`:
>
> | se lee | significa |
> |---|---|
> | ✅ / *"en cada push"* | **nivel 1**: el gate pasa a mano y `ci.yml` declara su step |
> | — | **nivel 2**: corrió en `ubuntu-latest` sobre este commit → **hoy no aplica a ningún gate** |
>
> Es la misma distinción que ADR-016 fijó para `"status": "active"` del WAF: el archivo declara,
> no ejecuta. Y no es teórica — `accept-s1.sh` usaba `stat -f %m`, que en GNU es `--file-system`:
> habría salido **verde midiendo basura** en Linux (`c854b99`). El nivel 1 sin nivel 2 falla en
> verde. Detalle completo en `SLICE_BOARD.md` §"Seis gates rojos o dormidos, un solo día, una sola
> familia" y en `DECISIONS.md` §Notas operativas. **Lo destraba un `git push`.**

> **CORRECCIÓN, 2026-08-28. Este doc decía que `scripts/guard-firewall.sh` (T1) NO estaba en CI, y
> es falso: está.** `.github/workflows/ci.yml:118`, y su polaridad `guard-firewall.test.sh` en
> `:126`, las dos desde `3199a78`. Re-verificado con `grep -n guard-firewall .github/workflows/ci.yml`
> antes de escribir esta línea. La afirmación vieja era correcta cuando se escribió —el commit que lo
> cableó es posterior— y quedó sin actualizar; se deja el rastro porque un inventario de cobertura
> que corrige en silencio no se puede auditar. **Con esto, la segunda pregunta de este doc —*¿hay
> chequeo?* y *¿lo corre alguien?*— tiene respuesta *sí* y *sí* para el censo de rutas del WAF.**
>
> **Lo que sigue abierto de T1 no es la corrida sino el nivel 2**, y no se redondea: la regla
> `storefront-track-rl` está `active` en `config/firewall-rules.json` desde S4, y `active` significa
> *"este archivo declara que la regla debe estar publicada"*, **no** *"está publicada en Vercel"*.
> El drift entre el archivo y la config viva es el riesgo residual conocido de T1 y lo cierra
> `vercel firewall diff --json`, que **no existe todavía** (ADR-016 · `SLICE_BOARD.md` §T1).

> **Dos precisiones que costaron caro y se dejan escritas, 2026-08-28.**
> 1. `pnpm e2e` es `pnpm --filter @istock/e2e e2e`. **No** `@istock/web`: `apps/web` no tiene
>    `@playwright/test` ni `playwright.config.ts`, y hasta `fe4e5dc` CI filtraba por ahí y obtenía
>    `Total: 0 tests in 0 files`, **exit 0**. El job `e2e` venía verde sin ejecutar un solo test.
> 2. Un e2e que necesita un secret humano (R2 real, MP sandbox, LLM) se marca `skip` **con motivo**
>    en el propio test. Un e2e verde por no haber corrido es peor que un e2e rojo.

### La familia "gate vacuamente verde" — tres entradas del 2026-08-28, **las tres cerradas** (**ADR-020**)
Este repo ya tenía catalogada una clase de defecto —reglas que no pueden fallar, gates satisfechos
por un `import`, `guard-artifacts.sh` pasando con cero archivos— y ese mismo día sumó tres. Van acá y
no en el board porque **las tres son sobre la evidencia, que es de lo que trata este doc**. Se
dejan escritas con su diagnóstico entero y con el arreglo al lado: **borrar el hallazgo cuando se
cierra es cómo se pierde la única parte que no se vuelve a descubrir sola.**

1. **Un gate afirmó una propiedad y verificó un nombre.** V5 de `scripts/accept-s6.sh` se llamaba
   *"expirar una reserva invalida la unidad, no la vidriera entera"* y lo que ejecutaba era
   `grep -rqE 'invalidateStorefrontUnit'`. Durante todo el defecto de **S6.2** la función se llamaba
   así **y purgaba la vidriera entera**: el gate estuvo verde de punta a punta. Es la variante más
   difícil de ver de *"tres pruebas alrededor y ninguna encima"*, porque acá la prueba estaba
   **encima del identificador correcto**. Regla que se derivó: si el nombre de la aserción tiene un
   verbo (*purga*, *invalida*, *rechaza*), el `grep` de un símbolo **no** es esa aserción.
   **→ CERRADO.** V5 quedó reducida a lo único estático que sí puede afirmar —que **nadie llama** a
   `invalidateStorefront(` desde el camino de reservas; la **ausencia** de una llamada prohibida sí
   es una propiedad del fuente— y el título de la sección ahora dice de qué tipo es su evidencia:
   *"(estático; el radio se mide en V9)"*. El radio se **cuenta** en la **V9** nueva.

2. **Ningún `accept-*` nombraba la evidencia de S6.2.** El spec del radio y su módulo de veredicto
   corrían (`pnpm e2e`, `pnpm test`), así que el nivel 1 estaba; lo que faltaba era que el **gate de
   la slice** los citara. Se podían borrar los dos y **nada se ponía rojo** — borrar un test nunca
   pone nada en rojo, ése es justamente el punto.
   **→ CERRADO.** `accept-s6.sh` fija `SPEC_RADIO=s6-senar-un-equipo-no-purga-la-vidriera-entera.spec.ts`
   y lo corre junto con `$SPEC`; **V9** lee `MEDIDO s6 radio` **de la salida de esa corrida** y falla
   si la línea no está. La auditoría de referencia del veredicto es
   `tests/el-veredicto-del-radio-rechaza-la-purga-que-arrastra-fichas-ajenas.test.ts`, de
   **`qa-agent`** — otra columna que la del código auditado, como exige `CLAUDE.md` §4.

3. **Un gate que corre en CI podía saltearse once aserciones sin bajar de verde.** `accept-s1.sh`
   llamaba `chk` diez veces y `have` una **sin tenerlas importadas** —vivían sueltas dentro de
   `accept-fase3.sh`—; bash imprime `command not found` por **stderr**, devuelve 127 y **sigue**.
   Como `no()` nunca se llama, el contador `fail` no se toca: el gate reportó `25 PASS / 1 FAIL` con
   **once aserciones que no se ejecutaron**, entre ellas las cuatro que le preguntan a Postgres si
   `anon` puede leer `listings.imei`. El único FAIL era ajeno; sin él, el gate salía **verde**. **Lo
   que hay que llevarse no es "faltaba un `source`":** es que **`PASS + FAIL` no es el total de
   aserciones escritas**, y ningún gate del repo verificaba esa igualdad.
   **→ CERRADO, y es el único de los tres con gate propio.** `scripts/guard-gates.sh` falla si un
   gate invoca una palabra que **no resuelve a nada** —ni función propia, ni de `_lib.sh` cuando lo
   importa, ni builtin, ni binario en PATH— y si **redefine** un helper que `_lib.sh` ya da. Es
   estático a propósito: el `command_not_found_handle` que también se puso es de **bash ≥ 4.0** y
   macOS ships 3.2.57, o sea que agarraría en CI y sería inerte en la máquina donde más se corren
   los gates a mano. `ci.yml:101`, con su polaridad de seis fixtures en `:105`, los dos con
   `if: always()`.

> **Las tres se leen mejor juntas que separadas.** La pregunta que este doc venía haciendo era
> *¿existe la aserción?*; las tres dicen que no alcanza, y cada una agrega una pregunta distinta:
> **¿la aserción mide el verbo de su nombre?** · **¿alguien la cita como evidencia?** ·
> **¿se ejecutó?** Con la lista de cuatro preguntas del final de este doc, son siete.

#### El cierre no es simétrico, y conviene saber cuál mitad quedó cubierta

`guard-gates.sh` cubre **la tercera** y nada más: la aserción que se evapora. Es la única mecánica.
Las otras dos —**el nombre que promete un cuerpo** y **el gate que nadie cita**— se revisan leyendo,
contra **ADR-020**. Un `guard-gates` en verde dice *"ninguna línea se evaporó"*, **no** *"los gates
miden lo que dicen"*, y son cosas muy distintas.

**Cubría 20 de 21 y hoy cubre 21 de 21 (`T20` del board, cerrada el 2026-08-28).** El mensaje de
éxito contaba `ls scripts/*.sh | wc -l` = **21** mientras los dos barridos salteaban `_lib.sh`, o sea
que auditaba **20** — y el que quedaba afuera era la librería que importan los otros veinte, donde un
helper inexistente se propaga a todos de una vez. Lo levantó `docs-keeper` verificando una frase de
ADR-020; lo arregló el LEAD, dueño de `scripts/**` por §4. Ahora `_lib.sh` entra a **G1**; **G2 lo
exceptúa con motivo escrito** (`:167`) porque ahí sería vacuo —G2 caza al que **redefine** un helper
de la librería, y la librería es el original—; y el número impreso sale del barrido
(`AUDITADOS`, `:173`), no de un `ls`, con **ausencia = FAIL** (`:184-187`). La polaridad pasó de seis
a **nueve** casos.

#### Un cuarto miembro que estaba en la misma familia y en la otra polaridad

**M1 de `scripts/accept-s3.sh`** —*"ningún `srcset` sin `sizes` en la vidriera"*— escaneaba el
archivo **crudo** y abría la ventana del tag en el primer `<` hacia atrás. Un docblock que nombraba
`srcSet` en **prosa** unas líneas después de un `<` de comentario le hacía reconstruir un **tag
fantasma** y reprobar `listings.ts`, un archivo que no renderiza una etiqueta. **El único arreglo
disponible para quien lo chocaba era borrar la explicación**: el gate castigaba documentar la regla
que defiende. Falla en la polaridad opuesta a los otros tres —de más, no de menos— y termina en el
mismo lugar, porque **un gate ruidoso es un gate que se aprende a saltear**. Arreglado blanqueando
comentarios y strings **por espacios** antes de escanear, para no mover un offset y que los números
de línea que reporta sigan siendo los del archivo real (lo mismo que ya hacía `scan()` de
`web-lint.mjs`). **Límite declarado en el propio gate:** no detecta literales de regex, así que un
`//` adentro de uno podría blanquear de más — el modo de falla sería **omitir** una detección, no
inventarla, y si aparece el fix es tokenizar, no aflojar la regla.

**Dos cosas que este doc no redondea, porque medir bien incluye no cobrarse de más:**

- **El arreglo de M1 no destapó ningún rojo del producto.** `listings.ts` ya no tiene `srcSet` y el
  árbol entero pasaba también con el escáner viejo. Se **sacó una mina**, no se arregló una falla
  viva. La cobertura real de la regla no cambió; lo que cambió es que ahora se puede documentar sin
  que el gate muerda.
- **El primer fixture con el que se intentó probar M1 no reproducía el defecto** (la prosa nombraba
  `sizes` antes que `srcSet`, así que la ventana encontraba el `sizes`). Se detectó corriendo el
  **escáner viejo** contra el fixture y viéndolo **pasar cuando tenía que encenderse**. Queda como
  regla de método, hermana de *"un gate que nunca se vio fallar no es un gate"*: **un fix cuya
  reproducción no se vio encender no está probado.**

#### Un quinto caso, de la otra clase: cobertura que tranquiliza sobre el eje equivocado — **cerrado el 2026-08-28**

Los cuatro de arriba son gates que afirman de más. Éste es un **test** que afirma sobre el eje que no
es, y por eso entra acá aunque no sea un gate. `apps/web/.../expire-reservations.test.ts` tiene el
caso *«una fila podrida no frena el barrido → cuenta el fallo, loguea el id y sigue con la
siguiente»*, y pasa. Afirma la resiliencia **dentro de una corrida**. El defecto que
`cost-auditor` encontró (`COST.md` §2.5) es **entre corridas**: la fila que falla queda `active` con
el mismo `expires_at` en el pasado y, por el `order by expires_at asc`, vuelve a ser la primera de la
próxima corrida y de todas. Cuando se escribió este párrafo **no había un solo test que ejecutara el
barrido dos veces**, así que ningún verde de esta matriz contradecía el hallazgo. Eso dejó de ser
cierto el 2026-08-28 y el párrafo se conserva porque es el que explica la clase; el estado va abajo.

**Cerrado el 2026-08-28. La aserción existe, es un entero y no un identificador, y la corrió el
LEAD.** Vive en `scripts/probes/s6-sweep-head-of-line.test.ts` —columna del LEAD, porque la auditoría
de referencia no puede ser del writer que audita— y el caso A es exactamente el que faltaba: dos
corridas, `EXPIRE_BATCH_SIZE` filas envenenadas más una sana, *cuántas sanas venció la corrida 2*.
Valía **0** y hoy vale **1** (`sanas_vencidas_c2=1`). Filas `T21`–`T25` del board (más `T31`); las
cinco aserciones originales, en `COST.md` §2.5.5.

**La probe tiene 7 casos, no 5, y la diferencia no es de tamaño: la spec estaba equivocada.** Tres
puntos de las cinco aserciones no sobrevivieron al contacto con la medición, y **ganó la probe**
(**ADR-024**):

| la spec decía | lo que mide la probe | por qué |
|---|---|---|
| *"alcanza el `tx` falso de `expire-reservations.test.ts`; no necesita Postgres"* | **Postgres real**, y **sin base es FAIL, no `skip`** | la primera pieza del arreglo es `order by sweep_attempts asc, expires_at asc`, y un `tx` de mentira devuelve las filas en el orden en que se las metieron: **no hay nada del ordenamiento que pueda medir**. Es **ADR-020** con un mock en lugar de un grep |
| `intentos_23514` / `intentos_40P01` — partir por SQLSTATE | `intentos_tras_fallo` · `reintento_tras_recuperarse` | **el barrido no ramifica por código de error, ni debería.** Lo que importa no es qué error fue, es si una fila que dejó de fallar **vuelve a entrar al lote**. El veneno es un `CHECK` (`23514`), no un deadlock |
| `lineas_log_por_envenenada == tope + 1` | `== tope` (**5**) | el `+1` es un evento que **nadie escribió** → **T31**. El propósito original (dejar de pagar 8.640 líneas idénticas por mes) **ya lo cumplió el techo**; lo que falta son los **ids** de las abandonadas |

**Los 7 casos**, y qué afirma cada uno:

| # | caso | campo del parte |
|---|---|---|
| A | con el lote lleno de filas que fallan, la sana igual vence en la **segunda** corrida | `sanas_vencidas_c2=1` |
| B | pasado el techo la fila deja de entrar al lote y se cuenta como abandonada | `tope=5` · `abandonadas_en_el_tope=1` |
| C | una fila que falló una vez y **dejó de fallar** vence en la corrida siguiente | `intentos_tras_fallo=1` · `reintento_tras_recuperarse=1` |
| D | si **tampoco** se puede anotar el intento, se cuenta aparte | `unrecorded=1` |
| E | sobre reservas genuinamente vencidas, `skipped` es **cero** | `skipped_sobre_vencidas=0` |
| F | 200 con la base sana, **500** con una unidad abandonada | `status_base_sana=200` · `status_con_abandonada=500` |
| G | la **segunda** falla de la misma fila es 500, la primera es 200, cuesta `tope` líneas de log, y la fila abandonada **se anuncia una vez** | `status_primer_fallo=200` · `status_segundo_fallo=500` · `lineas_log_por_envenenada=5` · `lineas_cuarentena_por_envenenada=1` |

**El caso G es el que justifica su propia existencia**, y por eso está escrito: el caso F ya sacaba
su 500 por la pata `abandoned`, así que un `degraded = sweep.abandoned > 0` —el arreglo **sin** la
mitad cross-run— **pasaba, y pasaba callado durante cinco corridas**. El LEAD lo mutó y ahora rojea.

**Y la probe no se cita por su `exit 0`.** Emite un parte —**siempre**, también cuando un caso
falló, porque un parte que sólo sale en verde no distingue *"no midió"* de *"midió mal"*— y
**V10b de `scripts/accept-s6.sh` lo parsea campo por campo contra literales escritos en el shell**:
otro archivo, otro lenguaje (**ADR-023**). **Ausencia de la línea = FAIL.**

```
MEDIDO cron barrido · corridas=7 · envenenadas=200 · sanas=1 · sanas_vencidas_c2=1 ·
intentos_tras_fallo=1 · reintento_tras_recuperarse=1 · tope=5 · abandonadas_en_el_tope=1 ·
unrecorded=1 · skipped_sobre_vencidas=0 · status_base_sana=200 · status_con_abandonada=500 ·
status_primer_fallo=200 · status_segundo_fallo=500 · lineas_log_por_envenenada=5 ·
lineas_cuarentena_por_envenenada=1
```

**El campo 16 llegó con T31 el 2026-08-28, y lo que NO discrimina está escrito, no supuesto.** `lineas_cuarentena_por_envenenada` separa las tres conductas que importan —no emitir → **0** · emitir por intento → **5** · emitir una vez por vida de la fila → **1**—, y ahí se termina. `app-agent` predijo que cambiar `===` por `>=` en el cruce del tope lo pondría en **3**; el LEAD corrió la mutación y da **1, verde**, igual que decidir el cruce contra `row.sweepAttempts + 1` en vez del `RETURNING`. Las dos ramas sólo se observan con dos corridas del cron pisándose, y el fixture tiene **un escritor a la vez**. El caso concurrente se **declinó a propósito**: dependería del scheduler, y un rojo intermitente termina en `it.skip` — este repo ya pagó por un gate que se ignora. El hueco queda **declarado** en la probe (`s6-sweep-head-of-line.test.ts:600-608`) y en el mensaje de falla del gate (`accept-s6.sh:404`), que es lo que `ci-exento` y `web-lint:sin-tenant` hacen en otros lados: una cobertura que falta se escribe, no se simula. **Esta matriz no dice que el campo pruebe el `===`, porque no lo prueba.**

**Polaridad, corrida por el LEAD antes de aceptar:** 13 líneas fabricadas contra el bloque V10b
verbatim —11 rojas, 2 verdes, entre ellas `corridas=9`, que **sube y debe seguir pasando**— más una
mutación viva: `it.skip` sobre el caso E deja la probe en `exit 0` y pone a **V10b rojo dos veces**.
Ése era exactamente el agujero de V10 antes de tener V10b.

#### Un sexto caso, y abre una familia nueva: el test medía bien, a un sujeto inventado — **ADR-021**

**Éste no es de la familia de arriba y por eso tiene ADR propia.** Los cinco anteriores fallan por la
**evidencia** (se afirma una conducta y se recoge un identificador, o se mide el eje equivocado).
Éste midió el eje correcto, con la base real, en la capa correcta — y su sujeto no existe.

`packages/db/src/reservations-sweep-attempts.test.ts` probaba que *el panel podía seguir insertando*
después de que `0006` pasara el `GRANT INSERT` de `authenticated` a columna por columna. Lo probaba
con una sentencia `INSERT` **escrita a mano en el test**, que nombraba tres columnas. Ningún caller
del producto emite esa sentencia: **Drizzle, en `insert().values()`, nombra todas las columnas de la
tabla** y pone `default` en las que no le pasaste, y Postgres exige privilegio sobre cada columna
nombrada. Resultado: `packages/db` en verde y el alta de reservas del panel rota con `42501`.

**Quién lo agarró:** e2e, o sea el gate más lento y más caro del repo — dentro de
`scripts/accept-s6.sh`, en la re-ejecución del LEAD. **Quién NO lo agarró y no podía:**
`guard-grants.sh`, que cuenta que el `GRANT` **exista**, y un `GRANT` parcial existe. Dijo PASS con
el panel roto.

**Cómo quedó cubierto:**

| capa | qué afirma ahora |
|---|---|
| el test del paquete (`db-agent`) | el `INSERT` se construye con el **query builder de Drizzle** (`toSQL()`) y se ejecuta tal cual; la lista de columnas se **deriva del schema** y se compara contra la que la sentencia nombra de verdad. Y las dos negativas se separan por **mensaje**, no por código: el `UPDATE` de la columna tiene que decir `permission denied for table` (capa `GRANT`) y el `INSERT` con el contador forjado, `row-level security` (capa policy) |
| el gate barato (LEAD) | **G6** · `scripts/probes/el-grant-cubre-el-insert-de-drizzle.test.ts`, sección **D5** de `accept-fase2.sh`: si `authenticated` tiene **algún** `INSERT` por columna sobre una tabla de negocio, lo tiene sobre **todas**. Le pregunta al catálogo; no ejecuta un solo `INSERT`. Cero privilegios = fuera de alcance (esa tabla la escribe `service_role`) |
| la migración | el bloque `DO` de `0006` **aborta y no se registra** si el reparto de privilegios no es el declarado |

**La sexta pregunta de este doc**, que ninguna de las cinco anteriores hace: *cuando el test pasa,
**¿quién** emitió lo que se midió?* Si la respuesta es "lo escribí yo acá", lo medido es una
hipótesis sobre el caller, no el caller.

## Cobertura de las prohibiciones de `CLAUDE.md` §2
Verificado regla por regla contra el repo el **2026-08-28**. La tabla completa se cierra en FASE 7;
lo que hay acá es lo que ya está confirmado, incluidos los huecos.

| prohibición de §2 | quién la afirma hoy | ¿tiene step en CI? (**nivel 1** — ver recuadro rojo arriba) |
|---|---|---|
| `tenant_id` en `user_metadata` | **estático:** `guard-leaks.sh:127` · `web-lint.mjs:123` (W008) · `accept-fase3.sh:61` — **y en runtime:** `tests/rls-cross-tenant.test.ts:535`, que **forja un claim** con el tenant en `user_metadata` contra Postgres real y verifica que **no abre nada** | ✅ (los dos primeros + el test) |
| tabla nueva sin `GRANT` | `guard-grants.sh` (parsea por **sentencia**, no por línea: 5 de los 6 `GRANT` son multilínea) — **y en runtime:** R7a/R7b/R7c preguntan por el privilegio **efectivo** (`has_table_privilege`), así que también cae un `GRANT … TO PUBLIC` | ✅ desde `985c369` |
| **`GRANT` de `INSERT` por columna incompleto** — la tabla **tiene** `GRANT` y el panel igual recibe `42501` | **`G6`** · `scripts/probes/el-grant-cubre-el-insert-de-drizzle.test.ts`, sección **D5** de `accept-fase2.sh`. Le pregunta al catálogo (`has_column_privilege`) tabla de negocio por tabla de negocio; **cero privilegios = fuera de alcance**, esa tabla la escribe `service_role`. Trae control de polaridad propio, siempre encendido | ✅ vía `accept-fase2.sh` (`ci.yml:137`, el único job con Postgres migrado). **Nace del primer fallo de T21, 2026-08-28:** `guard-grants.sh` dijo PASS con el alta de reservas rota, y el que lo agarró fue **e2e**. **ADR-021** |
| borrado de un objeto de R2 por key | `guard-r2.sh` R1 + R2 (**T11**) — **y en runtime:** `packages/media/src/unlink.test.ts:131` (*"borrar el listing de A NO deja sin fotos a B"*) y `:162` (*"cuando el ÚLTIMO tenant lo suelta, ahí sí se recolecta"*) | 🟡 **T14.3, anotada el 2026-08-28.** El ✅ anterior sobrevaloraba la evidencia. R1 y R2 de `guard-r2.sh` son **greps del fuente** (`DeleteObjectCommand` fuera de `unlink.ts`; un nombre exportado en `index.ts`): afirman que *nadie escribió* un borrado por key, no que *borrar un listing deje el byte vivo*. Lo segundo sólo lo afirma `unlink.test.ts`, que es **del owner del paquete y corre contra un driver en memoria** — nunca contra R2. O sea: el invariante más caro de recuperar (un byte borrado no vuelve, y es de otro tenant) **no tiene auditoría de referencia en `tests/`**, que es justo lo que `CLAUDE.md` §4 pide para las dos puntas de un invariante. Lo único que hay en `tests/` sobre R2 es `la-url-de-r2-no-se-arma-fuera-de-media.test.ts`, que es otra cosa |
| IMEI / costo / margen / notas en la vidriera | M4 de `accept-s3.sh` sobre los **bytes** de ficha **y** grilla, con los IMEI leídos del seed · `web-lint.mjs` W009 · `guard-leaks.sh` | ✅ nivel 1 desde `c854b99`: `accept-s3.sh` pasó a ser step de CI (`ci.yml:213`), así que M4 dejó de depender de que alguien lo corra a mano |
| **query sin filtro de tenant *además* de RLS** | **`W015` de `apps/web/scripts/web-lint.mjs`, en `main` desde `9b3d7d2`.** Corregido el 2026-08-28: este doc decía *"todavía NO está commiteada"* citando `git log -S W015` en cero, y ya no es cierto — `git log --oneline -S W015 -- apps/web/scripts/web-lint.mjs` devuelve **un** commit, que trae además el párrafo de `CLAUDE.md` §2 con el contrato del marcador. Re-corrida: `cd apps/web && node ./scripts/web-lint.mjs` → `WEB-LINT: PASS (15 reglas)` · *"toda query sobre las **15 tablas de negocio** filtra por tenant ademas de RLS (builder y sql crudo)"* — **las `15 reglas` son de esa corrida y hoy son `16`** (entró `W016`); la línea de W015 no cambió, y el número viejo se fecha en vez de reescribirse porque una medición vieja con un número nuevo es el drift que este doc existe para evitar. Lo que la hace fuerte: **deriva la lista de tablas del schema real** (las que tienen `tenantId`), así que una tabla de negocio nueva queda cubierta el día que nace; **falla si no puede leer el schema** (ausencia de medición es FAIL, y una lista vacía dejaría pasar todas las queries diciendo PASS); ventana de sentencia **angosta a propósito**; mide **filtrado, no presencia** (proyectar `m.tenant_id` o nombrarlo en un `join … on` no filtra); y el escape es `web-lint:sin-tenant` con **30+ caracteres de motivo** — hoy **dos** marcas en todo el repo, `_lib/session.ts:94` y `_lib/tenants/create-tenant.ts:202`. **Dos huecos que no se redondean:** (a) el alcance es `apps/web/app` + `apps/web/lib` + `proxy.ts` (`web-lint.mjs:41`), así que **`packages/**` sigue sin gate** → **T16**; (b) **su polaridad ya es un comando, y esta celda decía lo contrario.** Hasta `a015437` los 12 casos se habían ejercido *"in a sandbox outside the repo"* (`9b3d7d2`) — la misma situación en la que `guard-firewall` tenía **seis reglas que no fallaban nunca** hasta que la polaridad se volvió un archivo. Hoy existe **`scripts/web-lint.test.sh`**, con step propio en `ci.yml:156`, y cierra en `POLARIDAD WEB-LINT: OK — las 16 reglas se vieron encender`. **W015 aporta 12 de esos casos** y los seis bordes que importan están adentro: *presencia no es filtro*, *proximidad no es alcance*, *el docblock del módulo no exime*, *un motivo de tres palabras no es un motivo*, el `insert` que se ata por el `values()` y no por un `where` que no puede tener, y **el schema ilegible = FAIL**. De los dos huecos, éste se cerró; **el que sigue abierto es (a)** | ✅ nivel 1 (`pnpm -r lint`, `ci.yml:64`) · **T2 cerrada**, **T16 abierta** |
| **rate limiting con contador en Postgres sobre la vidriera** | **`W016` de `apps/web/scripts/web-lint.mjs`**, escrita por el LEAD el 2026-08-28. Hasta ese día decía **nadie**, y era **la última de las 14 prohibiciones de §2 sin gate ejecutable** — lo censó `qa-agent`. **`guard-firewall.sh` sigue sin cubrirla y no es un olvido:** audita el techo del WAF (config + censo de rutas), o sea **la mitad de afuera**; nada impedía escribir el contador igual y quedarse con las dos capas, pagando la cara. **Dos brazos, porque la infracción tiene dos formas y ninguna implica la otra:** (a) un archivo de `(storefront)` que **abre Postgres** *y* **nombra el concepto en código**; (b) la **forma** del contador (`onConflictDoUpdate`, `+ 1` dentro de un template de `sql`, `increment`, `count = count + …`) **aunque no se llame *rate limit***. El brazo (a) mira el **archivo entero** para la puerta y la **línea** para el concepto, y depende de que `scan()` saltee comentarios: `app/(storefront)/s/[slug]/api/track/route.ts:34` abre Postgres y **explica la prohibición en su docblock** — una regla que se encienda ahí es una regla que **castiga por documentarse**, el mismo modo de falla que el `TODO`/`TODOS` de la regla 3 de `guard-leaks.sh`. **No hay marcador de exención, a diferencia de W015, y el motivo está escrito en el código:** W015 lo tiene porque existen preguntas legítimamente cross-tenant; **no existe la vidriera que legítimamente cuente en Postgres**. **Falla cerrado:** si `(storefront)` está vacío, W016 sale **rojo**, no verde — medir cero no es aprobar. Veredicto real, verificado por `docs-keeper` el 2026-08-28: `ok W016 ninguno de los 23 archivos de (storefront) cuenta requests en Postgres (el techo es el WAF)` · `WEB-LINT: PASS (16 reglas)` | ✅ nivel 1 (`pnpm -r lint`, `ci.yml:64`) + polaridad propia en `ci.yml:156`. **`T14.1` cierra; `T26` cerró el 2026-08-28** — el gate está en `main` desde `d37e6b3`, verificado con `git show HEAD:apps/web/scripts/web-lint.mjs \| grep -c W016` → **4** |
| **una key legítima rechazada por el guard de PII** (disponibilidad, no seguridad) | hoy `packages/media/src/keys.test.ts` — **y hasta el 2026-08-28 no lo cubría nadie**: los casos del gate eran keys elegidas a mano, todas sin 15 dígitos seguidos, así que el 0,63% de keys que el guard rechaza **nunca apareció en un test**. Es un hueco de *muestreo*, no de olvido: la forma que faltaba era **generar keys reales en masa** y afirmar sobre el efecto | 🔴 **S2.5, abierta** — **pero ya no por el commit**: el arreglo está en `main` (`1fc0e59`, `6e74a51`) y lo que falta es la corrida de aceptación del LEAD. **La lección que sí es de este doc:** un guard cuyos casos de prueba los escribe la misma persona que el regex sólo ve las entradas que esa persona imaginó; el defecto vivía en las que produce la máquina |
| **imagen original (>500 KB) servida a la vidriera** | `scripts/probes/s2-media-measure.test.ts` (dentro de `accept-s2.sh`) · M2 de `accept-s3.sh` (ya midió: 51016 B) | 🟡 **T14.2 cambió de color el 2026-08-28**: los dos `accept-*` que la afirman entraron a CI en `c854b99` (`ci.yml:209` y `:213`), así que dejó de ser *"existe en dos lados y no corre en ninguno"*. Sigue **amarilla y no verde** por dos motivos distintos: nadie la afirma fuera de un `accept-*` (que es lo que T14 pedía), y ningún gate del repo llegó al **nivel 2** |

> **Dos de estas se dieron por descubiertas y estaban cubiertas.** Un reporte del 2026-08-28 listaba
> `user_metadata` como *"cubierta sólo estáticamente por el lint 0015"* y la de `GRANT` como *"R5/R6
> chequean RLS, no privilegios"*. **Las dos son falsas**: `tests/rls-cross-tenant.test.ts:535` es un test
> de runtime que forja el claim, y R7 chequea privilegios y no policies. La única de las tres que
> resultó real es el rate limiting, y **ya tenía fila** (T14.1). De ahí la regla de abajo.
>
> **Tercer caso el mismo día, y con el signo invertido: `W015`.** Se reportó *"query sin filtro de
> tenant: no lo sostiene ningún test ni regla de lint"* y al buscarlo apareció la regla, escrita,
> corriendo y en verde — pero **sin commitear**. Las dos mitades del reporte eran ciertas en momentos
> distintos: era verdad cuando se auditó y dejó de serlo mientras se escribía el doc. Moraleja
> operativa, que se suma a las dos preguntas de este doc: *¿hay chequeo?*, *¿lo corre alguien?* y
> ahora **¿está en `main`?** Un gate en el árbol de trabajo de una sola máquina no protege a nadie
> más que a quien lo tiene abierto.
>
> **Y el cuarto, 2026-08-28 a la tarde: la misma celda envejeció otra vez, en la otra dirección.**
> El texto *"sin commitear · cero commits"* quedó **falso** con `9b3d7d2`, y este doc lo siguió
> afirmando. Cambia una vez más la lista de preguntas, y ésta es la que ninguna de las anteriores
> hacía: **¿el CI que lo corre corrió alguna vez?** Hoy la respuesta es **no** —
> `git ls-remote --heads origin` vacío contra **110** commits — y por eso todo ✅ de arriba es nivel 1.
> **Re-medido el 2026-08-28: sigue vacío, ahora contra 125 commits.** El número sube, la respuesta no
> cambia, y el ✅ de nivel 1 se queda como está.
> Las cuatro preguntas, en orden: *¿hay chequeo?* · *¿lo corre alguien?* · *¿está en `main`?* ·
> *¿corrió el CI?* **Y desde ADR-020 hay una quinta, que no es sobre la corrida sino sobre el
> contenido: *cuando pasa, ¿qué midió?*** **Desde ADR-021 hay una sexta, y es la que dejó pasar el
> alta de reservas rota: *cuando pasa, ¿**quién** emitió lo que se midió?*** Un test que arma él
> mismo la sentencia que dice estar probando mide una hipótesis sobre el caller, no al caller.
>
> **Y hay una séptima, ratificada por el LEAD el 2026-08-28 (`DECISIONS.md` ADR-023): *¿el esperado
> y el observado tienen orígenes independientes?*** Las seis anteriores le dan verde a un test que
> compara `PLAN_CATALOG` consigo mismo. El caso medido está en la ADR y no se re-explica acá:
> ensanchar el bloque de coherencia de `plans.test.ts` a `PLAN_TIERS × BILLABLE_FEATURES` lo
> **debilitó**, porque los dos lados pasaron a derivar del mismo catálogo.
>
> **Lo que la séptima pregunta NO es, y el LEAD lo corrigió al ratificar:** no prohíbe la comparación
> de mismo origen. Un chequeo de coherencia entre dos writers es lo único que caza a dos columnas
> separándose, y sólo se escribe comparando un lado con el otro. Lo que se exige es que **no sea lo
> único en la sala**: sobre el mismo sujeto tiene que haber además una aserción cuyo esperado sea un
> **literal escrito en el test**, y el archivo tiene que **decir en prosa** cuál de sus bloques lleva
> el contenido y cuál lleva sólo la coherencia. `plans.test.ts` ya cumple las dos mitades —literales
> en `:43-91`, declaración en `:114`, matriz en `:132-156`— y por eso es el **caso modelo** de la
> ADR, no el infractor: **no se le agrega nada**.

## Cómo se verifica esta tabla
**Un "sin cubrir" se escribe acá sólo después de buscarlo en el repo**, no cuando un agente lo
reporta. Dos veces seguidas un reporte de cobertura resultó más pesimista que el repo, y las dos
veces el error tenía la misma forma: **se buscó el test por el nombre esperado y no por la regla**.
Un doc que declara huecos que no existen produce trabajo que no hace falta, y —peor— entrena a
leerlo con desconfianza, que es como muere un inventario de cobertura.

Concreto: antes de marcar 🔴, se corre el grep de la **regla** (`user_metadata`, `has_table_privilege`,
`rate.limit`) sobre `packages/**`, `tests/**`, `e2e/**`, `scripts/**` y `apps/web/scripts/**`, y se
mira si el gate que aparece **corre en CI** o sólo dentro de un `accept-*` a mano. Las dos preguntas
son distintas y las dos importan: la mitad de los huecos reales de este repo no fueron *"no hay
test"* sino *"hay test y no lo corre nadie"*.

**Y la misma disciplina en el otro sentido, agregada el 2026-08-28.** Un ✅ también se escribe sólo
después de buscarlo: la fila **E3** y la columna de gate de **S3** decían *"los 15 campos"* citando
un gate que exigía 14. Nadie mintió — un `grep -iE 'wa\.me|whatsapp'` sobre el gate anterior a M3b
devolvía **cinco líneas**, y las cinco eran **comentarios o mensajes de error** (`:228`, `:231`,
`:250`, `:302`, `:410`). El nombre estaba cinco veces; la aserción, cero. Por eso: **antes de marcar ✅ se busca la
aserción, no la mención**, y si la cobertura está repartida entre varios archivos se pregunta cuál
de ellos la afirma **sobre el artefacto que ve el usuario**. Tres pruebas que rodean un invariante
no son una que lo afirme (`DECISIONS.md` §"Notas operativas").

**Una pregunta más, la del 2026-08-28 (ADR-020): cuando el ✅ se apoya en un gate, ¿qué mide ese gate
cuando pasa?** No *"¿existe la aserción?"* ni *"¿corrió?"* —esas ya están arriba— sino **de qué tipo
es su evidencia**: un **conteo leído de una corrida** o un **`grep` del fuente**. Las dos son
legítimas y afirman cosas distintas: el `grep` puede afirmar una **ausencia** (*"nadie llama a la
purga del catálogo"*) o un invariante estructural (*"nadie construye su propia conexión"*), y **no
puede** afirmar una conducta con verbo (*"no purga la vidriera entera"*), porque un nombre no tiene
polaridad ni promete un cuerpo. Regla práctica al escribir una fila de esta tabla: **si el ✅ cita un
gate cuyo nombre tiene un verbo, hay que poder decir de dónde sale el número.** Si no hay número, el
✅ es sobre el fuente y la fila lo dice.
