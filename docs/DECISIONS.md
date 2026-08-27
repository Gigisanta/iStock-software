# DECISIONS — ADRs

_Owner: `architect`. Una decisión que no está acá **no existe**._
_Formato en `.claude/agents/architect.md`._

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
