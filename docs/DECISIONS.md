# DECISIONS — ADRs

_Qué es: el registro de decisiones de arquitectura. Una decisión que no está acá **no existe**._
_Para quién: cualquiera que vaya a escribir código y necesite saber qué ya se cerró y por qué._
_Cuándo se actualiza: cuando el LEAD cierra una decisión. La escribe `docs-keeper`, la **ratifica**
el LEAD (`CLAUDE.md` §4 — el rol `architect` era de FASE 1 y está dormido)._

---

## ADR-001 — Un solo proyecto Supabase con RLS, no schema-per-tenant
- **Estado:** aceptada · **Fecha:** 2026-08-27 · **Autor:** LEAD (FASE 0)
- **Contexto:** hasta 100 tenants con costo marginal < USD 0.50/mes por tenant.
- **Decisión:** un proyecto Postgres, `tenant_id` en toda tabla de negocio, RLS forzada.
- **Alternativas descartadas:** schema-per-tenant (migraciones × N, cache de plan de consultas
  degradado, operativa insostenible a 100 tenants) · un proyecto Supabase por cliente
  (piso de costo por tenant ≥ USD 25/mes: rompe el objetivo por 50×).
- **Consecuencias:** RLS es el único límite de seguridad real → **sin RLS no hay merge**, y todo
  test de tenant corre contra Postgres real.
- **Verificación:** `pnpm --filter @istock/db test -- rls` + query de `pg_class` con `relrowsecurity=false` → 0 filas.

## ADR-002 — Fotos en Cloudflare R2, nunca Vercel ni Supabase Storage
- **Estado:** aceptada · **Fecha:** 2026-08-27 · **Autor:** LEAD (FASE 0)
- **Contexto:** las fotos son el 95%+ de los bytes de la vidriera. El egress es el vector que puede
  hacer explotar el costo unitario sin aviso.
- **Decisión:** R2 (egress $0) + CDN de Cloudflare. Resize server-side a 3 variantes antes de subir.
- **Alternativas descartadas:** Supabase Storage público (egress pago, y compite con el presupuesto
  de la DB) · Vercel Image Optimization (se paga por transformación, escala con pageviews, no con
  stock) · Cloudinary pago (fuera del stack cerrado).
- **Consecuencias:** `packages/media` es el **único** que conoce el bucket. Nadie arma URLs a mano.
- **Verificación:** `pnpm --filter @istock/media test` (presupuesto de bytes por variante).

## ADR-003 — Vidriera cacheada por ISR + tags, no consulta por request
- **Estado:** aceptada · **Fecha:** 2026-08-27 · **Autor:** LEAD (FASE 0)
- **Contexto:** una vidriera viral no puede convertirse en una factura de Postgres.
- **Decisión:** ISR / cache de CDN con `revalidateTag('storefront:{slug}')` disparado por el panel.
- **Alternativas descartadas:** SSR por request (costo lineal en tráfico) · client-side fetch
  (peor SEO, peor LCP, más costo) · Realtime para anónimos (conexiones concurrentes pagas).
- **Consecuencias:** toda mutación de stock **debe** invalidar. Olvidarlo muestra stock vendido:
  es un bug de slice, no un detalle.
- **Verificación:** cargar la ficha 10× → 0 queries después de la primera.

## ADR-004 — LLM barato y fuera del hot path
- **Estado:** aceptada · **Fecha:** 2026-08-27 · **Autor:** LEAD (FASE 0)
- **Contexto:** el chatbot es un feature del plan `negocio` (~USD 35), no puede costar USD 5/tenant.
- **Decisión:** Gemini Flash-Lite primario, Groq 8B fallback, dieta de 1200/180 tokens, sin thinking.
  El LLM sólo corre ante un mensaje explícito del visitante, nunca por pageview.
- **Alternativas descartadas:** Claude/GPT frontier (1–2 órdenes de magnitud más caro para
  responder "¿tiene batería buena?") · embeddings por request (se hacen en el seed).
- **Consecuencias:** la calidad depende de la **dieta de contexto**, no del modelo → RAG chico y
  handoff agresivo a WhatsApp.
- **Verificación:** `pnpm --filter @istock/ai eval` + USD/1000 msgs medido en `docs/CHATBOT.md`.
- **Pendiente `[R3]`:** IDs exactos y precios vigentes → `docs/research/llm-pricing.md`.

---

## ADRs pendientes de FASE 1
| id | tema | depende de |
|---|---|---|
| ~~ADR-005~~ | **cerrada abajo** (R7 PASS) | — |
| ~~ADR-006~~ | **cerrada abajo** (R2 PASS) | — |
| ~~ADR-007~~ | **cerrada abajo** (R1 PASS) | — |
| ADR-008 | modelo de integración con MP Subscriptions | **R4 PARCIAL — bloqueado en B3, ver plan de sandbox abajo** |
| ~~ADR-009~~ | **cerrada abajo** (R5 PASS) | — |
| ADR-010 | región de las funciones de Vercel (`iad1` vs `gru1`) | R1 + medición de latencia |

---

## ADR-007 — Vidriera: wildcard de Vercel + Cache Components + rewrite a `/s/{slug}`
- **Estado:** aceptada · **Fecha:** 2026-08-27 · **Autor:** LEAD (FASE 1)
- **Insumo:** `docs/research/wildcard-isr.md` (R1, veredicto adversarial **PASS**), más
  verificación directa del LEAD contra `nextjs.org/docs/.../file-conventions/proxy` (v16.3.3).

### Contexto
`{slug}.maat.work` tiene que servirse desde el CDN sin tocar Postgres en el 95% de los hits
(regla §3 de `CLAUDE.md`), con invalidación por tenant y sin filtrar contenido entre tenants.

### Decisión — cinco piezas que sólo funcionan juntas

1. **Wildcard `*.maat.work` en Vercel.** Soportado en todos los planes, certificado automático
   por DNS-01. **Obliga a usar los nameservers de Vercel** (`ns1/ns2.vercel-dns.com`) —
   `maat.work` entero pasa a resolverse en Vercel. Propagación 24–48 h. Es el blocker **B5** y
   ahora tiene un costo operativo concreto: **migrar todo el DNS del dominio**, no agregar un CNAME.

2. **`proxy.ts`, no `middleware.ts`.** Renombrado en Next 16.0, runtime Node.js no configurable.

3. **El proxy no hace I/O. Ni DB, ni Global Config, ni un `Map` en memoria.** La doc dice que el
   proxy puede desplegarse al CDN y que no se debe depender de módulos ni globals compartidos.
   Sólo parsea el host, valida el slug contra un regex, y **reescribe a `/s/{slug}/...`**.
   El proxy corre **antes** del cache → se factura en el 100% de los pageviews, incluso en HIT.
   Presupuesto: **< 2 ms de CPU, 0 llamadas de red.** Es un assert de `cost-auditor`, no un ideal.

4. **El slug viaja en el path, nunca en un header.** Dos razones independientes, cada una
   suficiente: (a) `headers()` dentro de `'use cache'` tira error y vuelve la ruta dinámica,
   matando el ISR; (b) **el key de `'use cache'` y el del ISR durable NO incluyen el host** — sólo
   build ID + function ID + argumentos. Sin el slug en los argumentos, **dos tenants comparten la
   misma entrada de cache**. Eso no es una ineficiencia: es servir la vidriera del tenant A bajo
   el dominio del tenant B. Los headers `x-tenant-*` siguen siendo válidos en `/app/*`, que es
   dinámico por definición.

5. **`cacheComponents: true`** + `'use cache'` + `cacheTag('storefront:{slug}')` +
   `cacheLife('max')`. `experimental.ppr` y `experimental.dynamicIO` fueron eliminados en 16.0;
   `revalidateTag(tag)` de un solo argumento está deprecado (va `revalidateTag(tag, perfil)`);
   `updateTag()` — read-your-writes en Server Actions, que es lo que el panel necesita tras cargar
   un equipo — **sólo existe en este modelo**.

### Taxonomía de tags (normativa)
`storefront:{slug}` · `listing:{unit_id}` · `tenant-config:{slug}`.
Los cache tags están scopeados a **proyecto + environment, NO a dominio** → **un tag sin slug en
cualquier cosa que toque vidriera purga a todos los tenants**. Límites duros: 128 tags por
respuesta, 256 bytes por tag, 16 tags por llamada bulk a la REST API.
Es regla de review de `adversary-reviewer`.

### Consecuencias de costo (las que muerden)
- **`cacheLife` es una decisión de costo, no de UX.** Con `cacheLife('max')` + invalidación por
  evento: ~200 mutaciones/mes/tenant × 15 write units ≈ **USD 0.012/tenant/mes**. Con
  `revalidate: 60` serían 43.200 regeneraciones/mes/tenant ≈ **USD 2.59/tenant/mes** — el **13%
  del plan Base de USD 19**, y por sí solo revienta el objetivo de < USD 0.50.
- **Un solo `set-cookie` server-side en la vidriera desactiva el cache del CDN entero** y manda
  el 100% de los pageviews a la función y a Postgres. Check explícito de `cost-auditor`.
- **Cada deploy invalida el ISR cache** (el key incluye el build ID) → pico de writes proporcional
  a `tenants × páginas`. Con 100 tenants y deploys diarios deja de ser gratis.
- **Global Config: NO se adopta.** La arquitectura no lo necesita y su unidad de precio no está
  publicada.

### Consecuencias de seguridad
- **Cookies de sesión del panel nunca con `Domain=.maat.work`.** El dueño publica contenido en su
  subdominio; una cookie de dominio padre es visible desde todos los tenants. Se usa el prefijo
  `__Host-` (sin `Domain`), que la pinea a `maat.work`.
- **Las Server Functions no son rutas propias en la cadena de matchers**: un `matcher` que excluye
  un path también saltea las Server Functions de ese path. La autorización se verifica **dentro**
  de cada Server Function. El proxy no es un control de acceso.

### Alternativas descartadas
Lookup de tenant en el proxy (mata el 95%-sin-DB y agrega red al 100% de los hits) ·
`x-tenant-id` por header (rompe el cache y filtra entre tenants) · dominio custom por tenant en
Capa 1 (rate limit de 100 altas/hora/team y trabajo manual por cliente) · Global Config.

### Verificación (`qa-agent`, primer deploy con wildcard)
1. `curl -I` sobre `a.maat.work` y `b.maat.work` → `x-vercel-cache: HIT` y **contenido distinto**.
2. Mutar el tenant A desde `maat.work/app` → sólo cambia `a.maat.work`; `b.maat.work` sigue en HIT.
3. Grep de `set-cookie` en toda respuesta de `(storefront)`: debe dar cero.
4. ~~Un slug inexistente da **404 real** y cacheable~~ → **superado por ADR-011**: el status 404 en
   la primera request es inalcanzable bajo `cacheComponents` y el miss se sirve como página legible
   con `noindex, nofollow`. La segunda mitad **sigue vigente**: la respuesta negativa se cachea, así
   que dar de alta el slug después **invalida su propio tag** (si no, el negativo queda cacheado y
   la vidriera nace muerta).

### Riesgo abierto que hereda esta ADR
R1 marca **confianza media** en la granularidad de invalidación: dos docs oficiales de Vercel se
contradicen sobre si `revalidateTag` está scopeado por dominio. Se resuelve con el test 2 de
arriba. **Si resultara scopeado por dominio**, toda invalidación cross-host desde el panel es un
no-op silencioso y hay que mover la mutación a un Route Handler en el host del tenant.
Es el primer experimento a correr apenas exista deploy — antes de S3.

---

## ADR-008 (ABIERTA) — Mercado Pago Subscriptions: qué falta y cómo se cierra
- **Estado:** **abierta, bloqueada en B3** · **Fecha:** 2026-08-27 · **Autor:** LEAD (FASE 1)
- **Por qué está abierta:** R4 falló el voto adversarial **dos veces** → regla 3, STOP y re-plan.
  No hay tercera pasada de research. Ver el bloque **LEAD OVERRIDE** al tope de
  `docs/research/mp-subscriptions.md` con las 5 afirmaciones anuladas.
- **Re-plan del LEAD:** lo que falta **no se contesta leyendo**. Las páginas de costos de MP son
  UA-gated y renderizadas por JS, y la adhesión de un CBU sólo se establece intentándola.
  Se cambia research por **experimento**. FASE 6 es la última del pipeline, así que esto **no
  bloquea** FASE 2/3/4 — pero el resultado del experimento 1 puede cambiar el pitch comercial.

### Plan de sandbox — 4 experimentos, se corren el día que llegue B3
| # | Experimento | Qué decide |
|---|---|---|
| 1 | `GET /v1/payment_methods` + intentar crear un `preapproval` con `Debin_transfer` / `CVU` | **Si existe débito por CBU.** `CLAUDE.md` §3 pide preferir débito/transferencia; hoy no sabemos si el riel existe. Un negativo falso acá le cierra al ICP el medio de pago que más le sirve. |
| 2 | Cobro real de prueba con `account_money` vs `credit_card` | La comisión **varía por medio de pago**, no sólo por plazo de acreditación (FAQ oficial, 3 variables). Sin esto no hay piso de costo presupuestable. |
| 3 | Disparar el webhook dos veces con el mismo `id` | Idempotencia del handler. No depende de MP: es nuestro. Se puede correr sin B3 contra un mock. |
| 4 | `external_reference` de ida y vuelta en el flujo `init_point` | Si el puente MP→tenant sobrevive el checkout hosteado. R4 lo afirmó sin verificar. |

### Lo que ya es ley aunque la ADR esté abierta
- **El webhook no depende del proxy.** Su única defensa es el **HMAC verificado dentro del route
  handler**. Un `matcher` que excluya el path también saltearía las Server Functions de ese path,
  y `CLAUDE.md` prohíbe delegar autorización al proxy.
- **El «piso de USD 1,03/mes por cliente pagador» no se usa como gate de `cost-auditor`** hasta el
  experimento 2. Está condicionado, no medido.
- Sigue en pie: `preapproval`, la máquina de estados y la forma del webhook no están en disputa.

---

## ADR-005 — RLS por claim en JWT, con `memberships` como fuente de verdad
- **Estado:** aceptada · **Fecha:** 2026-08-27 · **Autor:** LEAD (FASE 1) · **Insumo:** R7 (PASS)

**Decisión.** `tenant_id` viaja en `auth.jwt() -> 'app_metadata'`, alimentado por el Custom Access
Token Hook desde la tabla `memberships`, que es la fuente de verdad.

**Forma obligatoria de toda policy** (es receta, no estilo — va al skill `drizzle-rls`):
`(select auth.jwt() ...)` **siempre envuelto en subquery** · `TO authenticated` **siempre** ·
índice en `tenant_id` **siempre** · `WITH CHECK` en INSERT/UPDATE **siempre**.
Vistas: `with (security_invoker = on)` obligatorio. **Vistas materializadas y foreign tables no se
exponen a la API**: RLS no aplica sobre ellas.

**Prohibición dura.** `tenant_id` **jamás** en `user_metadata` — el usuario puede escribirlo, así
que es escalación directa de tenant. Es el lint `0015`, severidad ERROR. Ya está en `CLAUDE.md` §2.

**Deuda declarada, no escondida: el claim queda stale hasta 3600 s.** Consecuencia operativa: toda
operación de **membresía o billing** re-lee `memberships`, no confía en el claim. Un usuario
expulsado conserva acceso hasta que su token rote.

**Gate de merge (bloqueante, sin excepción)** — los seis lints de Supabase de severidad ERROR:
`0002`, **`0007`**, `0010`, `0013`, `0015`, `0023`.
`0007` (*policies escritas y RLS apagado*) es el que **más se parece a "ya está hecho"** y es
justamente el que faltaba. Sin los seis en verde no hay merge.

**Defensa en profundidad, además de RLS:** DAL único en `server-only`; DTOs como `class` para que
bajar el objeto entero **rompa el build**; `experimental.taint: true`.

---

## ADR-006 — Fotos: encode propio con sharp, dos buckets R2, key opaca content-addressed
- **Estado:** aceptada · **Fecha:** 2026-08-27 · **Autor:** LEAD (FASE 1) · **Insumo:** R2 (PASS)

**Decisión.** Resize propio con sharp en el upload (1600/800/200, WebP). **No** transformaciones de
Cloudflare Images. Dos buckets: `istock-originals` **privado** (master, sin public access ni custom
domain, sólo S3 API server-side) e `istock-media` **público** detrás de `img.maat.work`, que sirve
**únicamente** thumb/card/detail.

**Key pública opaca:** `v1/{ab}/{sha256_32}.webp`, con el hash del **byte output de esa variante** —
sin sufijo de variante, sin `tenant_id`, sin `listing_id`. Así la vidriera no filtra identificadores
internos en su HTML, y desde la URL de `card` **no se puede derivar** la del master. El mapeo
`listing → keys` vive en Postgres con `tenant_id` + RLS.

**Trampa que trae la key content-addressed:** dos tenants que suban la misma foto **comparten el
objeto**. Por eso **borrar un listing nunca borra el objeto de R2**: se borra la fila del mapeo, y
el byte se recolecta sólo cuando ningún tenant lo referencia. Borrar por key es borrado cruzado
entre tenants. Ya es causal de rechazo en `CLAUDE.md` §2 y gate de review de S2.

**Detalle de implementación que es un bug silencioso si se hace mal:** `Cache-Control` se setea con
el parámetro **`CacheControl` de `@aws-sdk/client-s3`**, no con `httpMetadata.cacheControl` — eso
último es el binding de Workers y **no existe** en el runtime Node de Vercel. Hacerlo mal deja los
objetos sin `Cache-Control` y con edge TTL default de 120 min.

**Números** (regla de redondeo de R2: la facturación redondea al alza a la siguiente unidad):
100 tenants → **USD 0.00–0.09/mes** · 1.000 tenants → **USD 2.16/mes** esperado, **USD 14.76** peor
caso con 0% de cache hit; a esa escala 960.000 PUT/mes = 96% del free tier de Class A.
**Alternativas descartadas con su precio:** S3 equivalente ≈ USD 7.20–39.60/mes a 100 tenants y
~USD 477/mes a 1.000, sólo en egress · Cloudflare Images **USD 165–465/mes** a 1.000 tenants.

---

## ADR-009 — IMEI/ENACOM: atestación manual racionada, cero integración
- **Estado:** aceptada · **Fecha:** 2026-08-27 · **Autor:** LEAD (FASE 1) · **Insumo:** R5 (PASS)

**El hecho que cambia el diseño: ENACOM corta a las 5 consultas por día por IP.** Ese cupo mata dos
cosas de una: cualquier scraper nuestro muere en la sexta unidad, y el botón "consultar" por unidad
en el alta es inejecutable — el dueño que carga 15 equipos en una tarde (que es literalmente el
*done cobrable* de `CLAUDE.md` §1) ve `Intenta nuevamente mañana` en el equipo N° 6.

**Decisión.**
- **Cero integración.** Un `<a target="_blank" rel="noopener">` a `imei.enacom.gob.ar`. Sin cliente
  HTTP, sin job, sin cache, sin retry, sin secreto. **COST_DELTA = 0.**
- **El alta de unidad NO consulta ENACOM.** Guarda `not_checked` y no interrumpe la carga masiva.
  **`not_checked` es un estado normal y mayoritario, no una deuda.**
- El botón vive en **compra / canje / ingreso de mercadería** y en el detalle de la unidad — flujos
  de pocas unidades por día, compatibles con el cupo.
- Vista de panel **"unidades sin chequear"** ordenada por antigüedad, para que el dueño gaste sus 5
  consultas diarias en las que importan (mayor valor, procedencia dudosa) y no en orden de carga.
- Copy fijo: *"ENACOM permite 5 consultas por día por conexión. Si te dice que excediste el límite,
  marcá 'No pude consultar' y reintentá mañana."* → eso es `inconclusive`.

**Schema** (`db-agent`): `imei_check_status` enum `not_checked|valid|blocked|invalid|inconclusive` ·
**`imei_check_status_raw text`** — el texto crudo que mostró ENACOM, sin normalizar · `imei_checked_at`
· `imei_checked_by` · `imei_check_source` = `'enacom_web_manual'` · `imei_check_note` ·
`tenant_id` + índice + RLS.
La columna `_raw` **no es opcional**: es la única mitigación real de "ENACOM cambia los textos". Sin
ella, el día que cambien el copy no hay forma de re-mapear el histórico.

**Validación:** 15 dígitos numéricos en Zod, **bloqueante** (lo exige el propio form de ENACOM).
**Luhn se calcula en `packages/domain` como warning NO bloqueante.** Prohibido un `.refine(luhn)`
que impida el alta: existen equipos con IMEI mal grabado, y el dueño necesita poder cargarlos
justamente para marcarlos `blocked`/`invalid` y no venderlos. **Un gate de alta que rechaza stock es
peor que un warning que el dueño ignora.**

**Privacidad:** el `publicListingDTO` stripea el IMEI **y todo el bloque `imei_check_*`** — aunque
`valid` parezca inofensivo, publicarlo es afirmar un estado oficial que no controlamos y que cambia
con el tiempo. Nada de eso entra al contexto del chatbot. Test explícito en `packages/domain`.

**iStock no certifica nada.** Copy obligatorio: *"Resultado declarado por el dueño el {fecha}.
iStock no es un registro oficial ni consulta a ENACOM."*
**CABA 295/26 no genera trabajo de producto** y es argumento de venta, nunca promesa de
cumplimiento. **Prohibido el copy "cumplís con el Decreto 295/26".**

**Blocker que no es de ingeniería:** en los ToS, el reseller es responsable de la base de datos
personales y MaatWork es encargado del tratamiento. Necesita redacción legal → marketing/legal.

---

## ADR-011 — El slug inexistente se sirve como página legible con `noindex`, no como 404 duro
- **Estado:** aceptada · **Fecha:** 2026-08-27 · **Autor:** LEAD (FASE 4, S1)
- **Insumo:** medición directa del LEAD con `curl`, tres variantes sobre el **mismo build**
  (`next@16.3.3`, `cacheComponents: true`), slug que no corresponde a ningún tenant.
- **Supersede el corolario 4 de la verificación de ADR-007** (*"un slug inexistente da 404 real y
  cacheable"*). **No supersede ADR-007**: las cinco piezas de esa ADR siguen vigentes.

### Contexto — lo que se midió

| variante | req1 status | req2+ status | body visible (HTML sin `<script>`) | `h1` | robots | `<title>` |
|---|---|---|---|---|---|---|
| **A** `notFound()` en `s/[slug]/page.tsx` | 200 | 404 | **0 bytes** | 0 | noindex | `iStock` (hereda del layout raíz) / en req2+ ninguno |
| **C** `notFound()` con el boundary movido a `(storefront)/not-found.tsx` | 200 | 404 | **0 bytes** | 0 | noindex | igual que A |
| **B** el contenido de not-found renderizado como página normal | 200 | 200 | **797 bytes** | 1 | **noindex, nofollow** | propio y correcto |

Hechos, todos verificados y ninguno inferido:

1. **Ninguna** de las tres variantes da 404 en la primera request.
2. La causa no es del código de este repo: bajo PPR el status se decide **antes** de que resuelva el
   lookup del slug. Lo dice la doc que Next envía en su propio paquete,
   `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md:103-113`:
   > *"When streaming, a `200` status code will be returned... the status code of the response
   > cannot be updated... ensure the resource exists before the response body is streamed. You can
   > run this check in `proxy`..."*
3. La posición de `not-found.tsx` en el árbol **no cambia nada**: C es idéntica a A.
4. `notFound()` bajo `cacheComponents` renderiza **cero DOM visible incluso en el caso
   completamente prerenderizado** — el seed guarda `"status": 404` y su body menos `<script>` son
   0 bytes. No es un artefacto de streaming.
5. `16.3.3` es el último estable: no hay upgrade que disuelva esto.
6. Es **status XOR body**: ninguna variante da las dos cosas.

### Alternativa descartada: el chequeo en el proxy (la salida que sugiere Next)
**Rechazada por costo, no por gusto.** El proxy corre **antes** del cache y se factura en el 100%
de los pageviews, incluso en HIT: una query ahí es una query a Postgres **por pageview**.
Contradice ADR-007 §3 y el objetivo de *"95% de los hits no tocan Postgres"* de `CLAUDE.md` §3.

### Decisión
**Se adopta la variante B.** El propósito del gate —que un slug muerto no se confunda con una
vidriera y no se indexe— se cumple con `noindex, nofollow` + DOM legible. La variante A cumplía la
**letra** (el status 404) mientras le mostraba una **página en blanco** al 100% de las personas, en
la primera request y en la centésima.

### Por qué el XOR es estructural y no se esquiva reordenando el código
El mismo archivo, `loading.md:118`, explica **cuándo** empieza a streamearse el body y da la receta
para conservar el status:

> *"The response body starts streaming when a Suspense fallback renders (for example, a
> `loading.tsx`) or when a Server Component suspends under a `Suspense` boundary. **Place
> `notFound()` before those boundaries and before any `await` that may suspend.**"*

La receta se cita entera aunque acá sea **inaplicable**, y por una razón concreta: en `/s/[slug]`
**el `await` que suspende es exactamente el lookup del slug**. Es imposible saber si el slug existe
*antes* de esperarlo. La única forma de cumplir la receta sería tener la lista completa de slugs en
build time vía `generateStaticParams`, y eso es **incompatible con un SaaS self-serve** donde un
tenant se da de alta en runtime.

Dos consecuencias que cierran el tema:
- Explica el resultado medido de la variante **C**: mover el boundary no cambia nada porque el
  problema nunca fue dónde está el boundary, sino que el dato llega después del primer byte.
- **La variante A no es una implementación mejorable: es el techo.** No hay orden de instrucciones,
  ni posición de `not-found.tsx`, ni upgrade que dé **status y body** a la vez. Se eligió B porque
  era la única opción que quedaba, no porque fuera la mejor de tres.

### El riesgo de SEO no es nuestro problema, y lo dice el framework
La preocupación obvia contra la variante B —*"un 200 sobre un recurso que no existe es un soft 404
y Google lo indexa"*— está contestada en el mismo párrafo de
`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md`:

> *"Some crawlers may label these responses as 'soft 404s'. In the streaming case, this does not
> lead to indexation because the page is explicitly marked `noindex` in the HTML."*

No es una mitigación inventada acá ni una apuesta: es la guía del framework sobre su propio
comportamiento. **El único costo real que deja la variante B es el de monitoreo**, abajo.

### El precio, declarado y no escondido
**El miss deja de ser distinguible por status code en los logs de acceso.** Es una pérdida real de
señal de monitoreo, del mismo orden que la deuda del claim stale de 3600 s de ADR-005: no se
mitiga, se acepta. Se paga a cambio de que la persona que se equivocó de subdominio lea algo.

### Lo que reemplaza al status como invariante chequeable
Ya implementado en `scripts/accept-s1.sh`, A3/A4. Sobre la **primera** request a un slug nuevo:
- `<h1` **literal** en el body (DOM renderizado de verdad, no payload de Flight);
- `robots` `noindex`;
- `<title>` propio, distinto de `iStock`;
- **cero markup de vidriera**: ni `wa.me` ni `data-listing`;
- req2 con `x-nextjs-cache: HIT` (un escaneo de subdominios no puede ser una query por request);
- control: el tenant `demo` sigue dando **200**.

### Lo que sobrevive de ADR-007 sin cambios
El cinturón: **el alta de un tenant tiene que invalidar el tag de su propio slug**
(`storefront:{slug}` y `tenant-config:{slug}`), o la respuesta negativa queda cacheada y la vidriera
nace muerta. Sigue siendo cierta palabra por palabra; sólo dejó de llamarse "404".
También sigue en pie el `cacheLife` asimétrico: `'max'` para el positivo, perfil corto para el miss.

---

## ADR-012 — Los dos polos del cache de la vidriera son asimétricos a propósito
- **Estado:** aceptada · **Fecha:** 2026-08-27 · **Autor:** LEAD (FASE 4, S1)
- **Insumo:** hallazgo **MEDIUM-C** de la revisión de S1. Todo lo de acá es verificable en el árbol:
  `apps/web/app/(storefront)/_lib/cache-life.ts` · `scripts/guard-leaks.sh` §6 (commit `96d0c67`) ·
  `scripts/accept-s1.sh` A5.
- **Por qué existe esta ADR:** la decisión vivía sólo en comentarios de dos scripts y en un
  docblock. Un docblock que alguien limpia deja un número mágico sin razonamiento. Precisa ADR-007
  (`cacheLife('max')`), no la contradice: agrega el **segundo** polo, que ADR-007 no distinguía.

### Decisión — dos polos, dos perfiles, dos motivos distintos

**Polo positivo (el tenant que existe): `cacheLife('max')`**, invalidado **por evento**
(`updateTag` desde el panel), nunca por tiempo. Es lo que compra los ~**USD 0,012/tenant/mes** en
ISR Writes. Un `revalidate: 60` por tiempo son ~**USD 2,59/tenant/mes**: **216×**, el **13% del plan
Base de USD 19**. Sólo eso ya revienta el objetivo de < USD 0,50/tenant/mes.

**Polo negativo (el slug que no existe): perfil corto** — `stale 60 s · revalidate 300 s ·
expire 900 s`, declarado en `_lib/cache-life.ts` (`STOREFRONT_MISS_LIFE` / `cacheStorefrontMiss()`).
Poner `'max'` también acá produce **dos problemas opuestos que salen de la misma causa**:

1. **Envenenamiento durable.** Un bot que barre `aaa1.maat.work … zzz9.maat.work` crea una entrada
   de ISR **de 30 días por cada slug inventado**, y **nadie las va a invalidar nunca**: no
   corresponden a ningún tenant, así que no hay evento que las purgue.
2. **El tenant que nace muerto.** Alguien prueba `nortecel.maat.work` el martes, el negocio se da de
   alta el miércoles → la vidriera queda muerta hasta 30 días. El `updateTag(storefront:{slug})` del
   alta es **el cinturón**; este perfil corto son **los tirantes**, para el caso en que el cinturón
   no aplica: un slug que nadie creó nunca, un alta hecha por un job donde `updateTag` falla, un
   deploy en el medio.

### El costo de acortar el negativo, en la unidad correcta
**Una** query a Postgres cada `revalidate` **por slug**, no una por request. Un escaneo de 10.000
subdominios sostenido durante una hora son ~**12 queries por slug**, contra 10.000 sin cache. El
`where slug = ...` pega sobre el **índice único de `tenants.slug`** y no devuelve filas.

### Cómo se hace cumplir — `scripts/guard-leaks.sh` §6 (commit `96d0c67`)
Esto es lo que evita que la ADR sea decorativa. Cinco reglas, cada una tapando un agujero medido:

| # | qué chequea | por qué |
|---|---|---|
| **6a** | el polo positivo sigue en `cacheLife('max')` | un TTL por tiempo ahí es el 216× |
| **6b** | **un solo** archivo declara el perfil corto (`_lib/cache-life.ts`); ningún `cacheLife({...})` inline en otro lado | un inline es un TTL por tiempo escondido en el camino positivo |
| **6c** | los enteros de ese archivo siguen en **[30, 900] s**, contra un techo **duplicado dentro del guard a propósito**; y el perfil se llama `MISS` | mismo criterio que el presupuesto de bytes de `packages/media`: si el techo se leyera de la constante, **subir la constante pondría el guard en verde** |
| **6d** | ningún `revalidate` numérico corto fuera de ese archivo | la regla original, ahora con scope |
| **6e** | todo scope `'use cache'` elige perfil **explícito** | borrar el `cacheLife` **no** vuelve la ruta dinámica: la deja en el perfil **default (~15 min)**, que es el mismo 216× por otra puerta |

`scripts/accept-s1.sh` A5 no duplica estos regex: **invoca** a `guard-leaks.sh` §6. Dos copias del
mismo regex derivan, y la que deriva es siempre la que nadie mira.

### Procedencia, escrita y no borrada
La asimetría la decidió el **LEAD** a partir de MEDIUM-C. La regla 6 **fue reescrita** porque su
versión anterior prohibía `revalidate: <número corto>` en **cualquier** archivo de `(storefront)` sin
distinguir polo: el perfil corto del miss hacía fallar el mismo gate que lo exige, y la regla **se
satisfacía renombrando el literal a una constante** — o sea que había dejado de guardar. El conflicto
lo **reportó `storefront-agent` en vez de resolverlo a escondidas**, y tenía razón.
Un ADR que borra de dónde vino una corrección se lee como si nunca hubiera habido un error.

---

## ADR-013 — En `/app/*`, "no existe" y "no es tuyo" son la misma respuesta
- **Estado:** aceptada · **Fecha:** 2026-08-28 · **Autor:** LEAD (FASE 4, S2) · redactada por `docs-keeper`
- **Insumo:** código de S2 (`apps/web/app/(app)/app/(panel)/stock/[id]/fotos/page.tsx:35-41`,
  `_lib/listings/queries.ts`) y el e2e de `qa-agent`
  `e2e/s2-las-fotos-de-un-equipo-ajeno-no-existen.spec.ts`.
- **Pariente, no gemela, de ADR-011.** Ver la tabla de abajo: se parecen en el resultado y no
  comparten ni el sujeto ni el motivo. **No se fusionan.**

### Contexto
`/app/stock/{id}/fotos` recibe un UUID por la URL. `loadUnitWithPhotos` filtra por
`eq(listings.tenantId, ctx.tenantId)` **además** de RLS y devuelve `null` **sin distinguir** "no
existe" de "no es de este tenant".

### Decisión
Ese `null` se convierte en **`notFound()`** (`page.tsx:115` y `:118`). **Nunca un 403, nunca un
mensaje propio, nunca un texto distinto** para el recurso ajeno.

El motivo es **anti-enumeración**, y es distinto del de ADR-011: si el recurso ajeno diera 403 —o
404 con otro cuerpo, u otro tiempo de respuesta— el status sería un **oráculo** que le confirma a
cualquiera que ese id existe en la base, y de yapa que es de otro. Un id que no es mío tiene que ser
idéntico a un id que no es de nadie.

**El invariante chequeable es la indistinguibilidad, no el status code.** Esto no es una preferencia
de estilo del test: el status no está disponible como invariante bajo Cache Components (es la mitad
técnica que ADR-011 ya midió), así que fijarlo es pedir un imposible. La igualdad entre las dos
respuestas, en cambio, se puede exigir siempre y **sigue siendo cierta el día que Next permita el
404 real**, sin que nadie toque el test.

### En qué se diferencia de ADR-011 — para que nadie las fusione

| | **ADR-011** | **ADR-013** (esta) |
|---|---|---|
| sujeto | la **vidriera**, `{slug}.maat.work` | el **panel**, `/app/*` |
| quién pide | un visitante anónimo que erró el subdominio | alguien logueado que pega un id que no es suyo |
| motivo | el 404 real es inalcanzable bajo `cacheComponents`, y **el chequeo en el proxy está prohibido por costo** (una query por pageview) | **anti-enumeración**: el status no puede ser un oráculo de existencia cross-tenant |
| respuesta | página **propia y legible** con `noindex, nofollow` (variante B, 797 B de body) | **`notFound()`**: el 404 genérico de Next, sin título ni datos, con `noindex` |
| qué se paga | se pierde el 404 como señal de monitoreo | nada: la pantalla en blanco es la respuesta correcta acá |

**Lo que las une** es sólo el corolario: en las dos, **el invariante que se testea no es el status**.

### Corrección de una premisa que circulaba y es falsa
Se dijo, al pedir esta ADR, que el panel *"sirve una página legible del panel, no un 404 duro"*.
**No es lo que hace el código**, y la diferencia importa: `page.tsx` llama `notFound()`, no hay
`not-found.tsx` bajo `apps/web/app/(app)/` (el único del repo es
`apps/web/app/(storefront)/s/[slug]/not-found.tsx`, que es el de ADR-011), y el cuerpo que recibe el
curioso es el 404 genérico de Next: **sin título, sin slug, sin un dato**. Que sea genérico **es la
decisión**, no un pendiente de diseño: una pantalla propia y bonita sería un lugar donde volver a
filtrar algo.

### Verificación — `e2e/s2-las-fotos-de-un-equipo-ajeno-no-existen.spec.ts`
El invariante está asertado, no descrito: `expect(theirs.status).toBe(ghost.status)` (`:364-368` por
el browser, `:411-415` por HTTP crudo con la cookie de sesión). Además, y **antes** que el status
—porque un título ajeno en el cuerpo es la slice entera y un status distinto es una molestia—, se
buscan los marcadores de fuga (título, slug, nombre y uuid del tenant ajeno) en el HTML **completo**,
payload de Flight incluido. Las tres puertas: browser, HTTP crudo con sesión, y sin sesión.

El único status que este archivo sí fija es el **control positivo**: `mine.status === 200`
(`:321-326`). Sin él, la igualdad daría verde con la ruta rota para todos.

### Consecuencia para el resto del panel
Toda ruta futura de `/app/*` que reciba un identificador por la URL hereda esta ADR: filtro de
tenant explícito en la query, `null` indistinguible, `notFound()`. Un 403 con mensaje propio en el
panel es causal de rechazo de review.

---

## ADR-014 — `export const instant = false` es una excepción por ruta, con dos condiciones
- **Estado:** aceptada · **Fecha:** 2026-08-28 · **Autor:** LEAD (FASE 4, S2) · redactada por `docs-keeper`
- **Pedida por `app-agent`**, que la aplicó en S2 y dejó el razonamiento en un docblock.
- **Insumo, todo verificable en el árbol:**
  `apps/web/app/(app)/app/(panel)/stock/[id]/fotos/page.tsx:58-105` ·
  `scripts/guard-routes.sh` (tabla `ESPERADO`) ·
  `apps/web/app/(app)/app/(panel)/stock/[id]/fotos/agregar-foto-form.tsx:19-24`.
- **Por qué existe la ADR:** la decisión vivía en un docblock y en un comentario de un guard. Un
  docblock que alguien "limpia" deja una línea de configuración sin razonamiento, y el efecto de
  borrarla no se ve en ningún test unitario: se ve en producción, sin JavaScript.

### La regla por default
**Las rutas del panel no bloquean el render.** Bajo `cacheComponents: true` salen como
`compute=resuming / response=initial`: shell estático primero, contenido después. Está **fijado**,
ruta por ruta, en la tabla `ESPERADO` de `scripts/guard-routes.sh` — `/app`, `/app/ajustes`,
`/app/canjes`, `/app/crear-negocio`, `/app/stock`, `/app/stock/nuevo`, `/ingresar`.

Ese guard existe por un invariante que es de seguridad y no de performance: **una ruta de `/app/*`
que pase a `compute=static` es un leak cross-tenant** — contenido autenticado horneado en un archivo
que el CDN le sirve al siguiente que pida la URL. No lo detecta ningún test de RLS (la policy nunca
se evalúa: la respuesta no toca Postgres) ni ningún e2e logueado (pide con sesión, por definición).

### La excepción
**Una sola ruta hoy:** `/app/stock/[id]/fotos`, con `export const instant = false`
(`page.tsx:105`) y **cero `<Suspense>` de tope**. Queda en `compute=blocking / response=empty`, y
así está fijado en `guard-routes.sh`.

### La condición para usarla — dos, y las dos a la vez
No es un permiso general. Se justifica **por ruta**, y las dos razones están medidas en el gate de
S2, no supuestas. Un `<Suspense>` de tope parte la respuesta: primero el shell (status 200 +
esqueleto) y el contenido real al final, dentro de un `<div hidden id="S:…">` que recoloca un script
inline (`$RC`). Eso rompe:

1. **El status de `notFound()` llega tarde.** Se manda con el shell, antes de que corra
   `loadUnitWithPhotos()`: la respuesta sale 200 con cuerpo de 404. Es la ruta que materializa
   ADR-013. **Ojo con la mitad que se creía y era falsa:** `instant = false` **no** devuelve el
   status 404 — está medido abajo, en "Corrección medida". Lo que sí arregla es (2).
2. **Sin JavaScript la pantalla es un esqueleto permanente.** Si `$RC` no corre, el form de
   `agregar-foto-form.tsx` nunca sale del `<div hidden>`. El form postea sin JS y está bien armado,
   pero **a un form invisible no se lo puede tocar**: la promesa de progressive enhancement era falsa
   por culpa del boundary, no del form.

**La condición, entonces:** la ruta (a) puede hacer `notFound()` por un identificador que viene de la
URL **y** (b) tiene un form que promete funcionar sin JavaScript. Una sola de las dos **no alcanza**.

`export const instant = false` es la salida que nombra el propio Next en el texto del error
`blocking-prerender-runtime`, y según `instant.md` §"Disabling static shell validation" también saca
a la ruta de la validación de shell estático de Cache Components. Ningún ancestro declara `instant`,
así que este `false` es el más alto del árbol de esa ruta.

### El precio, aceptado y declarado
En la tabla de `next build` la ruta pasa de `◐ (Partial Prerender)` a `ƒ (Dynamic)`: el primer byte
espera la sesión, los params y la query de la unidad. **No hay esqueleto instantáneo.** Es tráfico
autenticado del dueño, a una pantalla a la que se llega desde una fila del stock. Una respuesta
correcta vale más que un esqueleto rápido que después se contradice.

### Alcance, y qué NO es esta decisión
El resto del panel sigue con su `<Suspense>` y su shell en `◐`, y los dos boundaries del layout
(header y bottom nav) siguen donde estaban. **Si otra ruta del panel se cae a `ƒ`, no es esta
decisión: es un efecto colateral y se revierte.**

### Cómo se verifica
`scripts/guard-routes.sh`, que **no lee la tabla de `next build`**: lee
`.next/prerender-manifest.json`. El motivo está medido y es la clase de bug que justifica un guard —
el LEAD leyó `◐` en `/app/stock/[id]/fotos` y concluyó que `instant = false` no había hecho nada,
mientras el manifest decía `compute=blocking`. La columna `○ ◐ ƒ` es un dibujo para humanos y
confunde tres estados distintos. **Un invariante que se verifica leyendo un glifo no es un
invariante.**

### Hueco declarado — qué le falta al LEAD para cerrar esta ADR

**No se inventa el motivo de nada de lo de arriba: todo está en el código.** Lo que falta son dos
cosas, y se dejan escritas en vez de rellenarlas:

1. ~~Nadie midió el status de esta ruta después del cambio.~~ **Cerrado el 2026-08-28 por la
   medición del LEAD. Ver "Corrección medida" abajo: el hueco se cerró y el número contradice la
   prosa que había acá.**
2. **La condición de arriba no la hace cumplir ningún guard.** `guard-routes.sh` fija **el modo** de
   cada ruta, así que un cambio no puede pasar en silencio — pero la regla de cuándo se *permite* la
   excepción vive en prosa. Hoy alcanza, porque la excepción es una sola y agregar la segunda obliga
   a tocar el guard. Si aparece una tercera, esto se convierte en trabajo del LEAD.

### Corrección medida — 2026-08-28 · `instant = false` **no** recupera el status 404

Lo que sigue es medición del LEAD, no interpretación. **Lo que queda contradicho es la
justificación de esta ADR, no su conclusión:** `instant = false` se queda, por la razón (2) —el form
sin JavaScript— que sí se cumple y no está en discusión.

**Antes que nada, y es lo primero que hay que leer: esto no es un defecto de seguridad.** El
invariante que declara ADR-013 es la **indistinguibilidad, nunca el status code**. Las tres
respuestas —`mine` (mi unidad), `theirs` (unidad de otro tenant) y `ghost` (id que no existe)— dan
exactamente lo mismo. No hay enumeración de tenants, no hay IDOR y no hay fuga; y ahora el
invariante está medido en **tres puertas**, que es más de lo que había antes.

**Evidencia A — e2e** (`e2e/s2-las-fotos-de-un-equipo-ajeno-no-existen.spec.ts`, tres puertas):

```
MEDIDO adr014 status · ruta=/app/stock/{id}/fotos · puerta=browser               · mine=200 theirs=200 ghost=200
MEDIDO adr014 status · ruta=/app/stock/{id}/fotos · puerta=http-crudo-con-sesion · mine=200 theirs=200 ghost=200
MEDIDO adr014 status · ruta=/app/stock/{id}/fotos · puerta=sin-sesion            · mine=(no medido) theirs=200 ghost=200
```

**Evidencia B — `curl` contra `next start` en :3199, sin sesión y sin seguir redirects:**

| id pedido | status | redirects | qué es |
|---|---|---|---|
| `…-0201` | 200 | 0 | existe y es del tenant |
| `…-9999` | 200 | 0 | no existe |
| `no-es-uuid` | 200 | 0 | id malformado |

**Evidencia C — el cuerpo delata el soft 404.** El caso `no-es-uuid` devuelve 24.216 bytes con
`<title>Fotos del equipo · iStock</title>` —el título de la **página del panel**— y la cadena `404`
ocho veces: el shell sale con su propia metadata y el contenido de 404 se renderiza adentro. No hay
duda de que `notFound()` corre: `no-es-uuid` llega a `notFound()` **incondicionalmente**
(`page.tsx:115`, el `safeParse` del UUID).

**Registro de la corrección, sin dramatismo.** Esta es la misma afirmación sobre la que el LEAD fue
corregido en su momento —se aceptó que `instant = false` recuperaba el status— y la medición le da
la razón a la versión original. Se anota porque un ADR que borra de dónde vino una corrección se
lee como si nunca hubiera habido un error, no porque importe quién tenía razón.

**Consecuencia operativa, que hoy no está escrita en ningún otro lado y no es un TODO:** un 404 que
viaja como 200 **no aparece en la tasa de error** de Sentry ni en PostHog. Cuando llegue FASE 8
(README de operación), la observabilidad del panel **no puede depender del status code** para
detectar "el dueño está pegando ids que no existen": hay que instrumentarlo por evento, no por
status. Vale para toda ruta de `/app/*` que herede ADR-013.

**Qué NO decide esta corrección.** Si conviene o no perseguir el status correcto en esta ruta es
una pregunta aparte, más cara, y la decide el LEAD. `page.tsx` es de `app-agent`: el docblock de
`page.tsx:69-72` sigue afirmando lo contrario de lo medido y su corrección está anotada en
`SLICE_BOARD.md` (**S2.4**). `docs-keeper` no propone el arreglo ni lo escribe.

---

## ADR-015 — El proxy excluye por **sufijo salvo que el nombre sea una convención de metadata de Next**
- **Estado:** aceptada · **Fecha:** 2026-08-28 · **Autor:** LEAD (FASE 4 bis, P1 + P2) · redactada por `docs-keeper`
- **Implementó:** `storefront-agent` en `apps/web/proxy.ts`, commit `117c4f0`.
- **Verificó el LEAD:** leyendo el archivo entero y corriendo una prueba propia de **30 URLs** contra
  el `path-to-regexp` compilado de Next.
- **Cierra** las dos filas del board que eran requisito previo a S3: **P1** (`robots.txt` /
  `sitemap.xml` por tenant) y **P2** (metadata file conventions bajo host de tenant).

### Contexto — una sola causa raíz para tres fugas
El `matcher` del proxy excluía **por sufijo**, el router de Next matchea **por segmento**, y Next
decide los file conventions de metadata **por nombre de archivo**. Tres criterios distintos para la
misma pregunta ("¿esta URL es una ruta de la app?"), y de ahí salieron los tres agujeros:

| # | URL | por qué el sufijo no alcanzaba |
|---|---|---|
| S1 | `/s/algo.json` | `/s/[slug]` matchea con `slug = "algo.json"` |
| S2 | `/_media/….webp` | `[...key]`: la extensión la elige quien pide la URL |
| P2 | `/icon.png`, `/robots.txt`, `/sitemap/1.xml` (25 URLs) | son **nombres**, no sufijos |

Los dos primeros se taparon con una entrada de inclusión por incidente. El tercero no se tapa así:
son 25 URLs de 8 convenciones, y la lista crece cada vez que Next agrega una.

### Decisión
La exclusión por sufijo **se conserva, pero no se aplica a los file conventions de metadata de
Next**. El criterio pasa a ser **el mismo que usa Next: el nombre del archivo**.

**Por qué el nombre y no el sufijo ni la profundidad:** `/icon.png` (ruta de la app, la genera Next)
y `/logo.png` (asset estático) son **indistinguibles** por sufijo y por profundidad. Sólo los separa
el nombre. Cualquier regla basada en la extensión vuelve a abrir el mismo agujero con otra ropa, y
anclar a la raíz lo deja un nivel más abajo esperando a la primera convención anidada.

### P1 se resolvió sin agregar un solo `if`
Las 25 URLs de metadata siguen la **regla general de host**: bajo el apex pasan derecho, bajo
`acme.maat.work` se reescriben a `/s/acme/robots.txt`, `/s/acme/icon.png`, etc. Esas rutas todavía
no existen —las trae S3—, así que **hoy dan 404 en el host de tenant**.

**Ese 404 es la respuesta correcta, no una deuda** (y no lo gobierna ADR-011, que es sobre el slug
que no resuelve a ningún tenant): un `robots.txt` ausente significa "crawleá todo", que es lo que
queremos para una vidriera pública; y servir el favicon o el sitemap del apex en `acme.maat.work`
pone la marca y las URLs de MaatWork adentro de la vidriera de un cliente — en el caso del sitemap,
además, le declara a Google que las URLs de ese host son las del apex. **El bug nunca fue el 404:
era el 200 con el archivo de otro.**

### El dato que cambia el análisis de cualquiera que relea esto
**`apps/web/public/` no existe.** No hay `favicon.ico`, ni `icon.*`, ni `robots.txt`, ni
`sitemap.xml` en todo el árbol. O sea que la exclusión de 16 sufijos que había antes **protegía cero
archivos**: su costo real era cero requests ahorradas y tres agujeros producidos. Quien vaya a
discutir el gasto de invocaciones de este matcher tiene que arrancar por acá, no por la intuición de
que "excluir assets ahorra".

`_next/static` y `_next/image` **siguen afuera** y ahí está el volumen real (decenas de subrequests
por pageview). Son el único par que se puede excluir **por prefijo**, o sea sin razonar por sufijo y
sin reabrir el bug.

### Alternativas descartadas
- **Agregar una entrada de inclusión por convención** (lo que se hizo en S1 y S2): 25 entradas hoy y
  una más cada release de Next. Es la estrategia que ya falló tres veces.
- **Borrar la exclusión por sufijo entera:** el proxy pasaría a correr sobre `public/`… que no
  existe, así que el beneficio sería nulo, pero deja el precedente de que el matcher no discrimina y
  se paga el día que haya assets.
- **Servir el `robots.txt` / favicon del apex bajo el host de tenant** (passthrough): es exactamente
  el bug que se estaba arreglando.

### Verificación
`tests/proxy-matcher-no-deja-la-vidriera-sin-vigilar.test.ts` deriva las 25 URLs **ejecutando las
funciones del propio Next** (`fillStaticMetadataSegment`, `normalizeMetadataRoute`), no de una lista
escrita a mano: si Next cambia una convención, el guard se pone rojo con el nombre viejo y el nuevo.
Contra un server real, el control que importa es que `/robots.txt` bajo el apex y bajo un host de
tenant **no** devuelvan el mismo body (hoy los dos dan 404, y eso es pasar; lo que reprueba es el
segundo devolviendo 200 con el archivo del apex).

### Consecuencia para S3
S3 implementa `/s/[slug]/robots.txt` y `/s/[slug]/sitemap.xml` **con su propio perfil de cache**: un
sitemap que pegue a Postgres por hit de crawler rompe el 95% de `CLAUDE.md` §3. El enrutamiento ya
está y no se toca.

---

## ADR-016 — El rate limit del WAF vive en `config/firewall-rules.json`, no en `vercel.json`
- **Estado:** aceptada · **Fecha:** 2026-08-28 · **Autor:** LEAD (FASE 4 bis, T1) · redactada por `docs-keeper`
- **Implementó:** el **LEAD** — `config/**` y `scripts/**` son suyos por `CLAUDE.md` §4. Commits
  `4fce968` (archivo + gate), `3199a78` (polaridad del gate + cableado a CI), `c9611b1`
  (`storefront-track-rl` pasa a `active` con S4).
- **Origen:** `docs/research/vercel-firewall-as-code.md`, que **demolió la premisa de la fila T1**:
  decía *"2 reglas en `vercel.json`"* y eso no se puede escribir.

### Contexto — la fila del board pedía algo imposible
`SLICE_BOARD.md` tenía **T1** con owner *LEAD (`vercel.json`)* y artefacto *"falta definir"*. La
verificación contra la fuente cerró la pregunta antes de empezar: el schema oficial tipa
`routes[].mitigate.action` como **enum cerrado `["challenge","deny"]`** con
`additionalProperties: false`, y la palabra `rate_limit` aparece **cero veces**. Verificado contra
`openapi.vercel.sh/vercel.json` el **2026-08-28**.

### Decisión
1. **`vercel.json` no existe en el repo, y no lo va a crear esta necesidad.** La regla **F5** de
   `scripts/guard-firewall.sh` falla si alguien lo crea creyendo declarar el límite ahí.
2. Las reglas viven **versionadas en `config/firewall-rules.json`**, con su `$doc`, su `$owner` y su
   `$apply` adentro del propio archivo.
3. **Se aplican por CLI** (`vercel firewall rules add …` + `vercel firewall publish`), que **no es
   parte del build**: un `vercel deploy` **no** sincroniza el WAF. Esto no es un detalle operativo,
   es la fuente del único riesgo residual de la decisión (ver abajo).
4. **Las condiciones matchean por `eq`, no por `pre`.** `pre` es prefijo: `/api/track` matchearía
   también `/api/tracking` y `/api/track-v2`, y **como el censo del gate usa la misma lógica**, una
   ruta futura bajo ese prefijo heredaría el techo, heredaría el medidor y **quedaría contada como
   cubierta por decisión de nadie**. Es el único punto donde el censo podría dar verde a algo que no
   se miró; lo encontró `cost-auditor` auditando T1. Precio del `eq`: un `POST` a `/api/track/` (con
   barra) no matchea. No abre un agujero: Next tiene `trailingSlash: false` y devuelve **308**, que
   en POST preserva el método y reintenta contra `/api/track`, que **sí** está cubierta. El costo del
   bypass es un redirect, no una escritura sin techo.
5. **Ninguna regla puede condicionar por `host`.** La regla **F2** del gate falla si alguien declara
   una por `host` sin acotar path, o un catch-all.
6. **El gate es del LEAD, no de los agentes que escriben las rutas** — el mismo principio que sacó
   `scripts/probes/**` de `packages/media`: **el gate no puede ser del mismo writer que el código que
   audita**. Y `guard-firewall.sh` **censa `apps/web/app/api/**`**: toda ruta HTTP está cubierta por
   una regla **o** exceptuada con motivo escrito, así que **una ruta nueva sin decidir rompe el gate
   el día que se crea**, no el día que la floodean.

### Alternativa descartada — la regla de vidriera por `host`, y cuánto costaba
El research proponía `host suf .maat.work`. **Rechazada.** El rate limit se factura por *allowed
requests* —los que matchean **y pasan**—, así que esa regla le cobraría peaje a **cada pageview de
vidriera**, que es exactamente lo que `ARCHITECTURE.md` declara scrapeable a propósito (*"se defiende
lo que cuesta plata"*). **`cost-auditor` midió el marginal: rechazarla sacó el 77% del costo marginal
del plan Base — de USD 0.124 a 0.03.** Para abuso masivo del HTML la palanca es **Attack Challenge
Mode**, gratis en todos los planes, inmediato y sin `publish`.

Las dos reglas apuntan a lo que sí cuesta plata:
- **`/api/track`** — la única escritura **sin autenticar** del producto. Con el spend cap de Supabase
  en ON, floodearla no infla una factura: **apaga el proyecto para todos los tenants.**
- **`/api/chat`** — cada request es un token pagado.

### Consecuencias
- **`active` no significa "publicada en Vercel".** Significa que el archivo **declara que debe
  estarlo**. `storefront-track-rl` pasó a `active` con S4 porque el endpoint no nace sin techo;
  `chatbot-rl` sigue `planned` hasta FASE 5.
- **Riesgo residual asumido y sin redondear: el drift entre el archivo y la config viva.** Lo cierra
  el **gate de nivel 2** (`vercel firewall diff --json`), que **no existe todavía**: falta verificar
  qué scope de token permite el `publish` (§UNVERIFIED del research). Mientras tanto el apply es
  manual y el procedimiento mínimo son los dos comandos de `$apply` dentro del JSON.
- Los contadores del WAF son **por región**: el límite efectivo es `N × requests`. Los números
  (60/min de tracking, 12/min de chat) se eligieron sabiéndolo.

### Verificación
`bash scripts/guard-firewall.sh` → `GUARD-FIREWALL: PASS` (límites de Pro: `keys ⊆ {ip, ja4}` —
`header:` es Enterprise—, `algo = fixed_window`, ventana 10–600 s, ≤ 40 reglas; más el censo de
rutas). Y su polaridad, `bash scripts/guard-firewall.test.sh`, que exige **ver romper cada regla**:
existe porque *"14 fixtures, 14 rompen"* se había ejercido a mano y fuera del repo, y el día que se
volvió un comando encontró que **seis reglas no fallaban nunca** —las fixtures mutaban `algo`,
`keys`, `window` y `action` en la **raíz** de la regla, y los límites de Pro se validan bajo
`rateLimit`—. Hoy son **25 casos, cada uno en su polaridad**, y las fixtures se **derivan del archivo
real en memoria**: una fixture literal se congela el día que se escribe y después falla por el motivo
equivocado. Las dos corren en CI (`.github/workflows/ci.yml:118` y `:126`) desde `3199a78`.

---

## Notas operativas — hallazgos que no son ADR

> **Qué es:** hechos verificados que cambian cómo se escribe o se lee algo del repo, pero que **no
> abren ni modifican una decisión de arquitectura**. No llevan número de ADR a propósito: numerarlos
> los volvería reabribles, y no hay nada que reabrir.
> **Para quién:** el que va a escribir o auditar un gate.
> **Cuándo se actualiza:** cuando aparece un hallazgo de esta clase. Lo escribe `docs-keeper`.

### 2026-08-28 · Dos formas nuevas de que un gate esté verde sin haber mirado nada

Los dos son casos de la regla que el repo ya tiene escrita —**"un gate que nunca se vio fallar no es
un gate"**, `SLICE_BOARD.md` §"Regla de método de los gates"— y los dos ya están corregidos.

**1. Un gate puede satisfacerse con un `import` y no correr nunca.**
La regla **R5** de `scripts/guard-r2.sh` verificaba que `assertPublicVariantKey` **apareciera** en
`upload.ts` y `url.ts`. La línea de `import` sola ya contiene el nombre: un gate **importado y jamás
llamado** pasaba la regla. No se ve leyendo el código —el archivo se lee como si el chequeo
estuviera— y no lo encontró una revisión: lo encontró **la prueba de polaridad**, borrando la llamada
para confirmar que el guard se ponía rojo. No se puso.
Corregido a buscar la **llamada** (`assertPublicVariantKey\(`, descartando las líneas de `import`).
**Regla general derivada: un guard verifica la invocación, nunca la presencia del símbolo.** Aplica a
todo `grep` de gate que hoy busque un identificador suelto.

**2. `scripts/guard-artifacts.sh` invocado mal daba `PASS`.**
Sin argumentos iteraba sobre una lista vacía y salía `GUARD: PASS` con exit 0 **habiendo chequeado
cero archivos**. Y en `--harness` los conteos **se imprimían sin afirmar**: borrar dos agentes lo
dejaba verde con `12 (esperado 14)` ahí arriba como texto decorativo, porque el bucle de `check` sólo
ve los archivos que **todavía están**.
O sea: el guard que existe para hacer cumplir *"archivo inexistente o vacío = la tarea no pasó"*
(`CLAUDE.md` §Phantom-file guard) era el que violaba la regla, y le daba verde a cualquiera que lo
invocara mal. **Lo encontró el LEAD invocándolo mal él mismo.** Las dos cosas fallan ahora: sin
argumentos es `SIN-ARGS … Ausencia de medicion = FAIL, nunca PASS`, y cada conteo del harness aborta
el guard si no da el número esperado.

**Lo que comparten, y por eso están juntos:** los dos daban verde **por ausencia**, no por
aprobación. Un gate que no distingue "lo chequeé y está bien" de "no chequeé nada" no es un gate, es
un `echo`.

### 2026-08-28 · Un helper con nombre de comando de `coreutils` es una bomba con temporizador

Decisión del LEAD, verificada contra `0bcb281`. `scripts/accept-fase2.sh` era el último gate fuera de
`scripts/_lib.sh` y se migró; con eso son **seis** los gates que comparten los helpers
(`accept-s1`, `accept-s2`, `accept-s3`, `accept-fase2`, `accept-fase3`, `guard-grants`), más
`_lib.test.sh` que los prueba en las dos polaridades en CI.

**El motivo anotado en el board no era el motivo real, y la diferencia importa.** La excepción decía
que `bad()` y `strip_comments()` no tenían equivalente en `_lib.sh`. La primera mitad no era un
motivo: `bad()` es `no()` con otro nombre. La segunda es cierta y se resolvió dejando
`strip_comments()` local — lo usa un solo gate, así que no hay dos copias que puedan divergir.

Lo que decidió la migración fue un tercer helper que **no estaba en la lista**: el gate definía
**`head()`, que pisa el comando `head`**. Mientras el archivo corrió autónomo fue latente, porque
nunca lo invocaba. **Hacer `source` de `_lib.sh` lo activaba**: `_veredicto()` termina en `| head -6`
(`_lib.sh:64`) y **bash resuelve funciones en el momento de la llamada, no en el de la definición**,
así que ese `head -6` habría entrado a la función del gate —un pipe a `printf '%s' "$1"` que se come
la salida y devuelve `0`— y la regla habría seguido imprimiendo `FAIL` **sin listar un solo
hallazgo**. Un auditor que dice "reprobado" y no dice qué encontró es inservible en el momento exacto
en que hace falta.

**La regla general, que es lo que se guarda:** una función de shell con nombre de comando de
`coreutils` (`head`, `tail`, `cut`, `test`, `printf`, `sort`…) no es un problema de estilo. Es una
bomba con el temporizador puesto en **el día que ese archivo comparta scope con otro** — y el día
llega solo, porque compartir helpers es la dirección en la que todo repo de gates evoluciona. Se
renombró a `sec()`, como en los otros cinco.

**Corolario para el que audita:** el peligro no lo ve el archivo que define la función, lo ve el que
la llama. Un `grep` de "funciones con nombre de comando" es barato y hay que correrlo **antes** de
mover un script a una librería compartida, no después.


### 2026-08-28 · Un invariante puede tener tres pruebas alrededor y ninguna encima

Hallazgo de `docs-keeper` al no poder citar evidencia para una fila del board, verificado por el LEAD
antes de aceptarlo y cerrado por él en el commit `0edb661` (módulo **M3b** de `scripts/accept-s3.sh`).
El invariante era el más caro del producto: **la ficha renderiza el botón `wa.me`**. De los 15 campos
de la ficha mínima (`CLAUDE.md` §1) el gate aseguraba 14, y el que faltaba era el único por el que
entra la plata — los otros 14 informan, ese convierte.

Lo que hace que esto sobreviva a una revisión es que **el invariante no estaba desnudo: estaba
rodeado.** Tres pruebas, las tres correctas, las tres útiles, ninguna capaz de fallar si la vidriera
perdiera el botón en todas sus fichas:

| prueba | qué afirma de verdad | por qué no alcanza |
|---|---|---|
| `packages/domain/src/wa.test.ts` (U14–U16) | el string canónico, byte a byte | prueba **la función**, no que alguien la llame |
| `apps/web/app/(storefront)/ficha.test.ts:69` | **un solo** componente emite el enlace | cuenta en el **fuente**: un componente que existe y no se renderiza pasa |
| `e2e/_lib/miss.ts:96` | el miss **no** trae `wa.me` | está en **negativo**: una vidriera sin botón lo satisface perfectamente |

**La forma del error, que es lo que se guarda:** cada prueba cubre un lado distinto —el valor, la
estructura, la ausencia— y ninguna cubre **la presencia del valor en la página servida**. Sumadas
dan la sensación de cobertura total porque nombran el invariante tres veces. Un inventario que
cuenta menciones —y `TEST_MATRIX.md` es un inventario— las cuenta como tres.

**El detalle que lo vuelve reproducible en cualquier otro invariante:** el docblock de
`ficha.test.ts` **declara su propia limitación y delega**, textual: *"La afirmación de comportamiento
—el HTML servido de verdad— vive donde corresponde: `scripts/accept-s3.sh` M3/M4, contra un server
vivo."* La delegación era correcta y honesta; **el destinatario no la había recibido**. Nadie leyó el
otro archivo. **Regla derivada: una prueba que delega parte de su invariante a otra tiene que nombrar
la aserción concreta del destino, no el archivo** — y quien audita cobertura sigue el puntero hasta
verla, o la fila no está cubierta.

**Por qué no es un caso más de *"un gate que nunca se vio fallar no es un gate"*.** Aquellos dos eran
gates que daban verde **por ausencia** (una lista vacía, un `import` sin llamada). Este no: los tres
tests miran algo y fallan si eso cambia. El agujero no está en ninguno de los tres, está **entre**
ellos, y por eso no lo encuentra leer un archivo — lo encuentra preguntarse, para un invariante dado,
**qué archivo lo afirma sobre el artefacto que ve el usuario**. Si la respuesta es una lista de tres
y ninguno es ese artefacto, la respuesta es *ninguno*.

**Corolario que ya está aplicado, y es la parte que no se puede probar en otro lado.** M3b afirma
además el **par de registros de condición** de `CLAUDE.md` §1: la misma página dice `usado excelente`
en el cuerpo y `usado A` en el mensaje de WhatsApp, y se afirma en las dos direcciones (que esté
`usado A` **y que no esté** `usado excelente`). Es el único punto del proyecto donde los dos mapas se
observan **a la vez sobre el mismo HTML**: el unit de dominio ve un mapa por vez y no sabe que existe
una página. El día que alguien "arregle la inconsistencia" unificando `WA_CONDITION_LABELS`
(`packages/domain/src/types.ts:69`), **todos los tests unitarios siguen verdes** y sólo falla este
gate. Una decisión de producto deliberada que sólo un test defiende es una decisión con fecha de
vencimiento.


### 2026-08-28 · La consulta duplicada del tenant en el miss frío es **deuda aceptada**, con su número

**Decisión del LEAD al aceptar S3.3** (`042e24e`). `storefront-agent` la planteó al entregar y es un
trade-off real, no una excusa: en el **miss frío** de una ficha el tenant se resuelve **dos veces**.
`getStorefrontListing()` ya lo resuelve **adentro de su transacción** (`tenantContext(tx, slug)`,
`_lib/listings.ts:426`) y **descarta esa información** al devolver `null`; después
`storefrontExists()` vuelve a preguntar con `getStorefrontTenant()` para desempatar cuál de los dos
miss corresponde.

**La alternativa de cero duplicación existe y está descartada:** que el loader devuelva un resultado
discriminado (`{ kind: 'ok' | 'listing-miss' | 'tenant-miss' }`) en vez de `null`.

**Por qué se queda como está — el número, que es lo que decide.** El extra es **una transacción**
(≈5 sentencias: `begin`, `set local role anon`, `set_config` del claim, el `select` y `commit`) **por
slug muerto y por ventana de `STOREFRONT_MISS_LIFE` (5 min)**, no por request. La entrada de
`getStorefrontTenant(slug)` es `'use cache'` con el perfil corto, así que:

- un bot probando **mil** fichas de un subdominio inventado paga **5 sentencias de más en total**,
  no mil — y el cuerpo y la metadata, que son dos entradas de cache distintas, comparten esa misma
  entrada;
- para un **tenant real** el extra es **cero**: `getStorefrontTenant(slug)` es la misma entrada de
  cache que ya usa la home de la vidriera;
- el **camino feliz no la ejecuta nunca**: el desempate se pregunta después del `null`, y eso está
  testeado (`ficha.test.ts:219-227`).

Cambiar el contrato del loader para ahorrar eso mueve `_lib/listings.ts`, su docblock y
`ficha.test.ts`. **No abre fila en el board, y es a propósito:** una fila `todo` es una promesa, y
esto no es una promesa — es un costo medido que se decidió pagar. Si algún día el número cambia de
forma (por ejemplo, si el miss dejara de cachearse), la deuda se reabre por el número, no por el
estilo.

### 2026-08-28 · El `noindex` en el HTML de una ficha **sana** está en el flight, no en el `<meta>`

Hallazgo del LEAD midiendo S3.3, **perseguido hasta el final: no es un defecto y no es nuevo.** Se
anota para que el próximo que lo vea no lo diagnostique de cero.

**El síntoma:** el HTML servido de una ficha que existe y se indexa contiene la palabra `noindex`.

**Los números, sobre el build** (`apps/web/.next/server/app/s/…`):

| archivo | ocurrencias de `noindex` | `<meta name="robots">` real |
|---|---|---|
| `demo/p/iphone-14-pro-256-grafito.html` (ficha sana) | **1** | `index, follow` |
| `noexiste-xyz.html` y los `p/no-existe-*.html` (miss) | **5** | `noindex, nofollow` |
| `demo.html` (home de la vidriera, **que S3.3 no tocó**) | **1** | — |

**Qué es:** el `notFound` boundary serializado en el payload de RSC para navegación de cliente. En el
flight se lee, textual, `"notFound":[["$","main",null,{"data-storefront":"miss",…,"children":[["$","meta",null,{"name":"robots","content":"noindex, nofollow"}]…`.
O sea: es el **componente de miss** viajando como dato para que el router pueda renderizarlo sin
volver al server — **no** es un `<meta>` hoisteado al `<head>` ni una directiva que Google vaya a
leer. Que `s/demo.html` (que viene de S1/S2) tenga exactamente lo mismo es la prueba de que no lo
introdujo S3.3.

**La regla que se guarda, porque es reutilizable:** en un HTML de App Router **una ocurrencia de
texto no es una directiva**. El mismo documento lleva el DOM renderizado y el payload de RSC, y el
segundo repite componentes que no están activos. Ya mordió una vez en este repo con otro nombre: M3b
de `accept-s3.sh` cuenta **anchors** `<a … href="https://wa.me/…">` y no ocurrencias de `wa.me`,
porque en la ficha el texto aparece **3 veces** y el botón es **uno**. **Un gate que mide sobre HTML
servido cuenta la estructura (`<meta name="robots">`, anchors), nunca el substring.**
