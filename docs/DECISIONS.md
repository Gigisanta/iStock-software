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

> **El "< USD 0,50" que aparece en el contexto de esta ADR y en dos más (ADR-006, ADR-011) es el
> objetivo tal como estaba escrito cuando se decidió, y desde `ea26a02` **el objetivo es por plan**:
> **Base ≤ 0,50 · Negocio ≤ 1,50**, donde el 1,50 es *0,50 + hasta 1,00 atribuible al chat*. El
> texto de las ADRs **no se reescribe** —una ADR es lo que se decidió y con qué información—, pero
> ninguna de las tres es la fuente del número: la fuente es **`COST.md`** (`cost-auditor`), y la
> regla de cómo se aplica está en `ARCHITECTURE.md` §"objetivo de costo marginal". Lo que importa
> operativamente y no se ve en el número solo: **una slice de vidriera, panel o media se mide contra
> 0,50 aunque el tenant esté en Negocio.** El margen del chat es del chat.

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

### Estado de implementación al 2026-09-04

El driver local usa provisoriamente la variante oficial **sin plan asociado + `status: "pending"`**:
manda la recurrencia mensual en ARS, `reason`, `external_reference`, `payer_email`, `back_url` y
redirige al `init_point` de la suscripción. La selección del medio queda en el checkout hospedado
de Mercado Pago y el trial de 14 días sigue siendo el trial inicial de iStock, no un segundo trial
del proveedor. El checkout también usa `billing_checkout_intents` (migración `0022`): una fila por
tenant, lock de fila y lease de 10 minutos evitan que dos pestañas creen dos `preapproval`; un
intent listo reutiliza el mismo `init_point` y el webhook lo libera cuando el estado es autorizado
o cancelado. Esto resuelve la carrera local, pero **no cierra ADR-008**: la cuenta real, el webhook
público, los medios disponibles y la eventual caída después de crear el preapproval todavía
requieren B3.

Decisión de seguridad del handler: aunque Mercado Pago recomienda activar también el tópico
`payment`, iStock lo acepta y lo ignora para entitlements. El recurso `GET /v1/payments/{id}` expone
`external_reference` como texto libre pero no `preapproval_id`; por eso una notificación de pago
aislada no puede habilitar un tenant. La autorización queda en `subscription_preapproval` y
`subscription_authorized_payment`, cuya factura sí trae el vínculo `preapproval_id`. Se reabre sólo
si B3 demuestra una relación de proveedor equivalente y verificable.

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
1. **Esta necesidad no crea `vercel.json`.** La regla **F5** de `scripts/guard-firewall.sh` falla si
   alguien lo crea creyendo declarar el límite ahí.
   > **Corregido el 2026-08-28 por drift:** hasta hoy esta línea decía *"`vercel.json` no existe en
   > el repo"*, y **desde S6 (`cbbfa2f`) existe** — declara el `crons` del barrido de reservas
   > (**ADR-017**) y nada más. La decisión no cambia y F5 tampoco: el gate siempre tuvo las dos
   > ramas, y con el archivo presente afirma que **no pretende declarar rate limits**
   > (`guard-firewall.sh:237-240`). Lo que estaba mal era el doc, no el código.
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
   audita**. Y `guard-firewall.sh` **censa `apps/web/app` ENTERO**: toda ruta HTTP está cubierta por
   una regla **o** exceptuada con motivo escrito, así que **una ruta nueva sin decidir rompe el gate
   el día que se crea**, no el día que la floodean.
   > **Corregido el 2026-08-28 por drift:** esta línea decía `apps/web/app/api/**`, que era el
   > alcance de la **primera** versión del gate — y por eso no veía `/_media/[...key]`, que vive en
   > el route group `(app)` y sirve los BYTES de las fotos, o sea el endpoint de mayor egress del
   > producto. El alcance ancho es deliberado y está en `guard-firewall.sh:154-168`; `CLAUDE.md` §4
   > ya se había corregido en `cf9d1fb` y esta ADR se quedó atrás. Un censo que no ve el endpoint
   > más caro es peor que no tener censo: da tranquilidad.

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
equivocado. Las dos **están declaradas** en CI (`.github/workflows/ci.yml:118` y `:126`) desde
`3199a78` — declaradas, no ejecutadas: `git ls-remote --heads origin` está vacío y `ci.yml` no
corrió nunca. Ver `SLICE_BOARD.md` §"Seis gates rojos o dormidos". La verificación que sí se hizo
es a mano, en macOS, por el LEAD.

---

## ADR-017 — Los jobs son **Vercel Cron**, no Inngest, y el `vercel.json` declara sólo el `crons`
- **Estado:** aceptada · **Fecha:** 2026-08-28 · **Autor:** LEAD (S6) · redactada por `docs-keeper`
- **Implementó:** el **LEAD** (`vercel.json` y `scripts/**` son suyos por §4) y `app-agent` (el
  handler). Commits `cbbfa2f` (slice + `vercel.json`), `7a96033` (schedule + las dos probes),
  `10d31b6` (el gate entra a CI).
- **Insumo:** `docs/research/vercel-cron-limits.md` (2026-08-28). Costo: `docs/COST.md` §2.4.

### Contexto — la disyuntiva estaba escrita y nadie la había cerrado
`CLAUDE.md` §3 dice *"Jobs: Vercel Cron o Inngest free tier. **No** worker 24/7"* y
`ARCHITECTURE.md` §Jobs repetía el *"(o Inngest free)"*. **S6 la cerró de hecho** —eligió Vercel Cron
y escribió el `vercel.json`— sin que existiera esta ADR. Se escribe ahora para que la próxima slice
con un job no vuelva a abrirla.

### Decisión
1. **Los jobs de Capa 1 son Vercel Cron.** Hoy hay exactamente uno:
   `GET /api/cron/expire-reservations`, `*/5 * * * *`.
2. **`vercel.json` declara el `crons` y nada más.** No puede declarar más aunque se quiera: el schema
   oficial tiene `additionalProperties: false` en la raíz, así que una clave de más **no se ignora,
   rompe el deploy**. El rate limit del WAF sigue donde lo puso **ADR-016**, y la regla **F5** de
   `guard-firewall.sh` sigue vigilando que nadie lo mueva acá.
3. **`crons[]` tiene dos campos y los dos son requeridos: `path` y `schedule`.** Sin query string
   (no está documentado); la credencial viaja por `Authorization`, no por URL.
4. **La autenticación es `CRON_SECRET` con ese nombre exacto**, que Vercel manda solo con prefijo
   `Bearer `. El handler compara **hashes** con `timingSafeEqual` y **falla cerrado ante env ausente
   o vacía** (`cronSecret()` devuelve `null` para las dos).

### Por qué Vercel Cron, y qué NO se está afirmando de Inngest
**Vercel Pro ya es obligatorio por licencia** (`CLAUDE.md` §3: Hobby prohíbe el uso comercial, y la
vidriera es exactamente eso), así que el cron **no agrega proveedor, ni credencial, ni blocker
humano** — y hoy hay **seis** blockers humanos abiertos en el board, todos de credenciales. Con Pro
el intervalo mínimo es **1/min** con precisión per-minute, así que `*/5` es legal y la deriva máxima
de una reserva vencida es ~5 min + el barrido, sobre un reloj de 30–120 min. En Hobby el mínimo es
**una vez por día** y una expresión más frecuente **rompe el deploy**: con Hobby esta feature no
existiría, lo que es una razón para Pro independiente de la licencia.

**Lo que esta ADR no afirma: que Inngest sea peor.** Al redactarla no se había investigado — el
descarte original fue por **superficie**, no por números: un proveedor más, una credencial más, un
webhook más que firmar, para un job que hoy es un `GET` cada cinco minutos. El research posterior
`docs/research/inngest-free-scheduled-functions.md` confirma que Inngest puede cubrir un cron de
cinco minutos en una función serverless, pero también confirma la superficie adicional de endpoint
firmado, claves y sincronización. Ese research no cambia esta ADR por sí solo. Si el requisito es
posponer Vercel Pro, esta ADR se reabre con ese research y con una prueba de cuota, firma,
reintento e idempotencia antes de cambiar el proveedor.

### Consecuencias — lo que se pierde, sin redondear
| se pierde | cuánto duele hoy | mitigación |
|---|---|---|
| **Sin reintentos.** *"Vercel will not retry an invocation if a cron job fails."* | poco: el barrido es **idempotente** (`expireReservation()` es puro, con `now` inyectado) y la corrida siguiente es 5 min después | el diseño idempotente + la frecuencia **son** la política de reintento |
| **Sin backoff ni cola** | poco: una sola tarea, sin dependencias entre corridas | — |
| **Granularidad atada al plan** | nada mientras haya Pro; todo si alguien degrada a Hobby | el `*/5` rompería el deploy en Hobby, así que falla ruidoso |
| **Un 3xx completa la corrida sin más requests** | **mucho**: apaga el job **en silencio** — sin log, sin error, sin alerta. El síntoma aparece semanas después: *"mi equipo sigue reservado"* | `scripts/probes/s6-cron-reachability.test.ts` |
| **Un `path` inexistente da 404, se ejecuta igual y se factura igual** | medio: un typo en `vercel.json` es un 404 recurrente que no rompe nada visible | la misma probe: V1 exige que el `path` agendado apunte a un handler que existe |

**Las dos probes son del LEAD y eso no es protocolo, es la única forma de que midan algo.** La de
alcanzabilidad cruza **tres columnas** —`vercel.json` (LEAD), `proxy.ts` (`storefront-agent`) y el
route handler (`app-agent`)— y **ninguna de las tres ve el camino entero**; hoy no hay redirect
porque `resolveHost` manda `*.vercel.app`, el apex y todo host desconocido a `marketing`, y eso se
decidió por otro motivo, así que **nada lo ataba**. La de fail-closed afirma algo que un status code
no puede afirmar: **el orden**. *"Sin credencial válida no toca Postgres"* es una propiedad sobre qué
pasa antes de qué; un handler que barre primero y decide el status después devuelve los mismos 401 y
es una escritura abierta. Por eso espía el barrido en vez de comparar respuestas, y por eso **no
delega en `route.test.ts`**, que es del mismo writer que el handler (`CLAUDE.md` §4).

### Costo
No lo fija esta ADR. `cost-auditor` lo auditó en **`docs/COST.md` §2.4**, y el titular es incómodo y
conviene leerlo: **las 8.640 invocaciones/mes (USD 0,0052 · 0,086% del allotment de Edge Requests de
Pro) son sólo el 4–19% de lo que cuesta el cron**; el resto es Active CPU y memoria, y **el renglón
caro de S6 no es el cron sino la invalidación**. Citar el 0,0052 como "el costo del cron" es citar
una línea de tres.

### Verificación
`bash scripts/accept-s6.sh` — **V1** (el `path` de `vercel.json` apunta a un handler que existe **y**
el cron llega hasta él, corriendo `s6-cron-reachability.test.ts`) y **V2** (fail-closed medido por
invocación, `s6-cron-fail-closed.test.ts`). Step en CI desde `10d31b6` (`ci.yml:236`) — **declarado,
no ejecutado**: ver §Notas operativas, *"un gate tiene dos niveles"*.

## ADR-018 — El trial da el producto completo **mientras está vivo**; vencido no conserva ninguna feature
- **Estado:** aceptada · **Fecha:** 2026-08-28 · **Autor:** LEAD (S6, D2 del despacho) · redactada por `docs-keeper`
- **Implementó:** `app-agent` — `apps/web/app/(app)/_lib/entitlements.ts` (`cbbfa2f`).

### Contexto
`PRODUCT.md` vende el trial como 14 días del producto **completo**, y `packages/db/src/seed.ts` crea
la suscripción como `plan: 'negocio', status: 'trialing'`. O sea: mientras corre, el trial **incluye
reservas**, que es feature del plan `negocio`. Un trial que no deja probar lo que se paga no vende
nada, así que esa mitad nunca estuvo en duda.

La otra mitad sí. La versión anterior del módulo daba `trial: [FEATURE_RESERVATIONS]` **sin mirar
`trial_ends_at`**, apoyada en que *"cuando el trial vence, `billing-agent` baja el plan"*.
**`billing-agent` es FASE 6 y no existe**: hoy nada baja ese plan. Consecuencia real, no teórica: un
tenant con el trial vencido hace seis meses seguía reservando gratis, **para siempre**.

### Decisión
1. **El trial incluye reservas mientras está vigente.** Ratificado, no era una pregunta abierta.
2. **Vencido, el plan `trial` no da ninguna feature.** No se difiere a `billing-agent`: diferirlo era
   deuda con otro nombre, y `CLAUDE.md` §2 rechaza esa herencia se la escriba como se la escriba.
3. **La vigencia se resuelve en la resolución de entitlements, no en el call site.** `featureAccess()`
   es el **único** lugar del repo que mira `trial_ends_at` para decidir una feature. Un chequeo que
   cada pantalla tiene que acordarse de hacer no es un chequeo: es una lista de lugares donde
   todavía no falló.
4. **El rechazo pega en la Server Action, no en el render.** Que el botón no se dibuje es cortesía;
   la puerta es la acción. Lo afirma **V4** de `accept-s6.sh`.
5. **Un trial sin fecha de fin está vencido.** `tenants.trial_ends_at` es nullable; `createTenant()`
   y el seed siempre la escriben, así que `null` con `plan = 'trial'` es una fila que nadie sabe
   explicar. Se falla cerrado: un trial sin vencimiento **es** el trial infinito que esta decisión
   viene a matar.
6. **La fila explícita de `entitlements` sigue mandando, también acá.** La vigencia apaga lo que da
   el **plan**, que es el default; una fila es una palanca que alguien movió a mano. Sin esa
   precedencia no habría forma de darle una cortesía a un negocio sin inventarle un cambio de plan
   — justo lo que `billing-agent` todavía no puede hacer. **La fila no es el trial; el trial es el plan.**
7. **`cancelReservation` no pide entitlement, y esto es producto, no un detalle de implementación.**
   Soltar una unidad no puede quedar bloqueado por facturación: el equipo está en el mostrador y la
   alternativa es una unidad trabada por una deuda de USD 19. Reservar pide entitlement; **soltar,
   nunca**.

### Alternativa descartada
**Esperar a `billing-agent`.** Habría dejado un agujero de facturación abierto toda la FASE 4 y la
FASE 5, con el modo de falla más caro que hay: no falla nada, funciona gratis.

### Consecuencias
- El plan sigue definido **en un lugar** (el fallback por plan) y las filas de `entitlements` quedan
  para las excepciones, que es lo que significa la columna `enabled`. Sembrar una fila por feature en
  el alta convertiría cada feature nueva en una migración de datos sobre los tenants existentes.
- **`Q1` de `PRODUCT.md` sigue abierta y esta ADR no la toca:** qué pasa con **la vidriera** al vencer
  el trial es otra pregunta. Esto decide qué pasa con **las features del panel**.
- El mensaje al dueño dice **qué pasó**, no *"no autorizado"*: no hizo nada mal, se le terminó la
  prueba.

### Addendum 2026-08-28 — la palanca del punto 6 existe, está sin cablear, y hay que decirlo así

El punto 6 llama a la fila de `entitlements` *"una palanca que alguien movió a mano"*. Verificado
contra `main`, la palanca tiene mecanismo y **no tiene mano**:

- **`setFeatureFlag()` de `app/(billing)/_lib/entitlements.ts:182` es el único escritor de la tabla
  `entitlements` en toda la app.** El otro `insert` sobre la tabla es
  `packages/db/src/seed.ts:173`, que es el seed del demo. Censado con `grep` sobre `apps/web` y
  `packages`: dos escritores, uno de producto y uno de seed.
- **Ese único escritor no tiene call sites de producción.** Tampoco los tienen `hasEntitlement`,
  `isEntitled` ni `requireEntitlement`. Los tres consumidores vivos —`publish-listing.ts`,
  `reserve-unit.ts` y `stock/page.tsx`— usan `featureAccess()` / `isFeatureEnabled()`, que **sólo
  leen**.

Se escribe acá por una razón concreta y no por prolijidad: **es el dato que decidió que el módulo de
`(billing)` no se borrara.** Su docblock prometía autodestruirse el día que `(app)` tuviera un
resolver real; ese día llegó el 2026-08-28 y la promesa estaba mal escrita, porque daba por sentado
que la única diferencia entre los dos resolvers era el catálogo. No lo era: el techo (`limit`) y el
camino de escritura viven sólo de este lado. **Borrar el módulo borraba el feature flag sin deploy.**

**Lo que este addendum NO dice:** que el feature flag sin deploy esté disponible. Está **cableado a
medias** — hay función, hay tabla, hay policy, y no hay pantalla ni script que la llame. Cualquier
doc que lo ofrezca como capacidad del producto estaría prometiendo algo que hoy sólo se puede hacer
con un `update` a mano contra Postgres.

**Y hay una divergencia abierta que toca directamente al punto 6:** con la misma fila apagada, los
dos resolvers dan motivos distintos (`flag_off` vs `plan`), y el que se muestra al dueño es el que
le ofrece comprar el plan que ya tiene. Es la fila **T27** del board, `app-agent`, arreglo en vuelo.
Esta ADR no cambia: la precedencia del punto 6 es correcta y lo que falla es el vocabulario del
rechazo.

### Verificación
`bash scripts/accept-s6.sh` **V4** (el entitlement se chequea **adentro** de la Server Action) +
`apps/web/app/(app)/_lib/entitlements.test.ts`.

## ADR-019 — En qué queda una reserva cerrada lo decide **la tabla del dominio**; el call site sólo declara su intención
- **Estado:** aceptada · **Fecha:** 2026-08-28 · **Autor:** LEAD (ratificada al despachar S6.1) · redactada por `docs-keeper`
- **Implementó:** `domain-agent` + `app-agent` — `packages/domain/src/listing-status.ts`, `packages/domain/src/reservation.ts`, `apps/web/app/(app)/_lib/listings/publish-listing.ts`, `apps/web/app/(app)/_lib/reservations/expire-reservations.ts` (`83bc673`).

### Contexto — dos historias del mismo hecho, y ninguna estaba mal escrita

`TransitionEffects` declaraba `closesReservation: boolean`: decía **que** había que cerrar la reserva
y callaba **cómo**. La consecuencia no fue que alguien se olvidara de cerrarla, fue peor: **cada call
site contestó la pregunta por su cuenta y contestó distinto.**

| call site | qué escribía sobre `reserved → available` |
|---|---|
| el panel (`publish-listing.ts`, con un `closingStatusFor(to)` local y privado) | `cancelled` |
| el barrido del cron (`expire-reservations.ts`, con la definición de "vencida" de `expireReservation()`) | `expired` |

**La misma arista, dos estados de cierre, y el que ganaba dependía de quién llegara primero.** Una
reserva que se venció sola quedaba registrada como cancelada por una persona. Los dos códigos eran
correctos leídos de a uno: el helper del panel tenía su justificación escrita al lado, y el cron
tenía razón en llamar `expired` a lo que su propia función acababa de declarar vencido.

Es la clase de defecto que ningún test de un solo lado encuentra, porque **de un solo lado no hay
contradicción**.

### Decisión

**La tabla del dominio decide el estado de cierre. El call site declara su intención, no el
resultado.**

```
closesReservation: boolean            ->  closesReservationAs: ReservationClosingStatus | null
transitionEffects(from, to)           ->  transitionEffects(from, to, intent)
```

- `intent: TransitionIntent | null` es **obligatorio**, y `TransitionIntent` es el **motivo humano**
  de la transición (`'expire'` | `'cancel'`), no su resultado.
- La tabla que lo resuelve (`closingStatusFor`) es **privada**: la única puerta es
  `transitionEffects`.
- `ReservationClosingStatus` se define **por exclusión** de `'active'` sobre
  `RESERVATION_STATUSES`, así que agregar un estado de reserva **obliga a decidir** si es un cierre y
  rompe la compilación de las tablas exhaustivas que lo consumen.

| arista | estado de cierre | por qué |
|---|---|---|
| `reserved → sold` | `confirmed` (sin importar el `intent`) | no existe una venta que venció |
| `reserved → available` con `intent: 'expire'` | `expired` | es el mismo valor que ya devuelve `expireReservation()` para la misma reserva, y ésa es **la única transición que esa función produce** |
| `reserved → cualquier otro destino` | `cancelled`, **aunque la reserva ya estuviera vencida** | `expired` significa *"se venció sola"*, y quién tiene la definición de vencida es `expireReservation()` |

`intent: 'expire'` sólo pesa sobre `to === 'available'` porque ése es su alcance declarado. Un
`reserved → in_service` no lo produce un reloj: lo produce alguien que agarró el equipo y lo mandó a
service, y ahí `'expire'` no significa nada y no se lo deja teñir el registro.

### Por qué esto es una ADR y no un refactor

Tres cosas que se pierden si esto queda sólo como diff:

1. **Es un contrato entre paquetes**, no una preferencia. `CLAUDE.md` §Monorepo pone la máquina de
   estados en `packages/domain` — *"TS puro, cero I/O"*. Mapear una arista del listing a un estado de
   reserva **es** máquina de estados. Dejarlo en `apps/web` lo dejaba fuera de la suite del dominio,
   que es donde se prueban las aristas.
2. **La forma del tipo es la decisión.** `closesReservationAs` **reemplaza** al booleano, no lo
   acompaña. Un `boolean` con un `ReservationClosingStatus` al lado deja representable el estado
   ilegal `true` + `null` y —lo que importa— **deja abierta la puerta de leer "cierra" y elegir el
   estado por fuera**, que es exactamente el bug que esta ADR cierra. Al ser el mismo valor, es
   **imposible consumir el efecto sin recibir el estado de cierre**.
3. **`intent` es obligatorio y admite `null`, en vez de opcional**, y eso es la lección de S6
   codificada en una firma. Un parámetro opcional cuyo default es un valor válido **no distingue "no
   me lo pasaron" de "me pasaron que no hay"**, y `strict` no puede ayudar. El bloqueante que
   `adversary-reviewer` encontró en S6 sobrevivió exactamente por eso. `null` significa *"no hay una
   intención humana declarada"*, que es lo que dice el panel cuando publica un borrador.

### Alternativas descartadas

| alternativa | por qué no |
|---|---|
| **dejar el `boolean` y mudar `closingStatusFor` al dominio como función exportada** | resuelve la ubicación y no el acoplamiento: siguen siendo dos llamadas, y nada obliga a que el call site use la segunda. El segundo consumidor que aparezca (venta manual, canje) la vuelve a derivar a mano |
| **`closesReservation: boolean` + `closingStatus: ReservationClosingStatus`** | deja representable `true` + `null` y `false` + `'expired'`. Un estado ilegal representable es una rama que alguien va a escribir |
| **`intent` opcional con default `null`** | es la firma que produjo el bloqueante de S6. El compilador deja de ver al caller olvidado, y el cron se lleva `'cancelled'` en silencio |
| **que el cron mande el estado final en vez del motivo** | invierte la dirección del acoplamiento: el dominio pasaría a obedecer a la capa de aplicación, que es de dónde venimos |

### Verificación

`packages/domain`: 11 tests nuevos (**199** en total), con **E5/E5b recorriendo el producto
cartesiano** de aristas en vez de listas escritas a mano, y **E3b cruzando la tabla contra
`expireReservation()`** — que es la aserción que impide que las dos definiciones de "vencida" se
separen otra vez.

`apps/web`: los tests nuevos **no fijan el string `'expired'`**. Fijan que la arista del cron **con**
`intent` da lo que el cron escribe, y **sin** `intent` da `cancelled` — o sea, **lo que no tiene que
escribir**. Esa segunda mitad es la que atrapa la regresión el día que alguien pase `null` porque
compila.

`bash scripts/guard-effects.sh` mira lo mismo desde el otro lado: **un efecto que el dominio declara
obligatorio y que no ejecuta nadie es FAIL.** Pasó de RECHAZADO a OK con este commit.

### Lo que esta ADR NO cerró

**`cancelReservation()` (`reserve-unit.ts:277`) sigue escribiendo `'cancelled'` hardcodeado**, con el
`intent: 'cancel'` ya armado al lado, y el barrido escribe la arista a mano teniendo
`decision.listingTransition` disponible. Hoy **acierta por casualidad**. Es la fila **T18** del
board, y se deja nombrada acá porque una ADR que se lee como "ya está resuelto en todo el repo"
produce justamente el tercer call site que la contradice.

## ADR-020 — Un gate afirma una **conducta medida**, nunca un identificador grepeado
- **Estado:** aceptada · **Fecha:** 2026-08-28 · **Autor:** LEAD (ratificada al cerrar el barrido serial de los cinco `accept-*` sobre `68c0bd6`) · redactada por `docs-keeper`
- **Implementó:** LEAD, que es dueño de `scripts/**` por `CLAUDE.md` §4 — `scripts/accept-s1.sh` (A2), `scripts/accept-s3.sh` (M1), `scripts/accept-s6.sh` (V5 reducida + **V9 nueva**), `scripts/guard-gates.sh` y su polaridad `scripts/guard-gates.test.sh`, con step propio en `.github/workflows/ci.yml:101` y `:105`.

### Contexto — la misma falla, tres veces, el mismo día, en la misma columna

No es un caso con dos parientes: es **una familia con tres miembros vivos**, encontrada de a uno y
recién nombrada cuando se los puso en fila.

| gate | la aserción **escrita** | la evidencia que **recogía** | cuánto tiempo estuvo verde mintiendo |
|---|---|---|---|
| `accept-s6.sh` **V5** | *"expirar una reserva invalida la unidad, **no la vidriera entera**"* | `grep -rqE 'invalidateStorefrontUnit'` | **todo S6.2**: la función se llamaba así **y purgaba la vidriera entera**. El gate acompañó el defecto de punta a punta |
| `accept-s1.sh` **A2** | *"la vidriera baja de rol antes de consultar"* | `grep 'set local role'` **dentro de `tenant.ts`** | desde que `storefront-agent` centralizó la bajada de rol en `_lib/storefront-db.ts` — o sea desde que el código **mejoró**. Y encima no fallaba: la línea usaba `chk`, que no estaba definido |
| `accept-s3.sh` **M1** | *"ningún `srcset` sin `sizes` en la vidriera"* | escaneo del archivo **crudo**, con la ventana del tag abierta en el primer `<` hacia atrás | reportó FAIL sobre `listings.ts`, que no renderiza una etiqueta: la ventana se abrió en un `<` de **prosa**, y el gate reconstruyó un tag fantasma a partir de un docblock |

Las tres tienen la misma forma y por eso hay una regla y no tres parches: **la aserción es una
propiedad del comportamiento y la evidencia es la presencia —o la ausencia— de un identificador.**
Entre las dos hay un supuesto que nadie declaró: *que el nombre dice lo que el cuerpo hace, y que
está donde estaba ayer*. Es un supuesto razonable, y es exactamente el que rompe un refactor sin
renombrar nada.

M1 agrega la variante que más cuesta ver, porque falla en la polaridad opuesta: **castigaba
documentar la regla que defiende.** El único arreglo disponible para quien lo chocaba era borrar la
explicación. Un gate que empuja a borrar prosa correcta está roto aunque su intención sea buena, y
además se vuelve el gate que todos aprenden a saltear.

### Decisión

**Un gate afirma una conducta medida, nunca un identificador grepeado.** Operacionalizada en cuatro
reglas de escritura, que son lo que hay que chequear al aceptar un gate nuevo:

1. **Si el nombre de la aserción tiene un verbo** —*purga*, *invalida*, *baja de rol*, *rechaza*— **o
   contiene un "no"**, la evidencia **no puede ser la presencia de un nombre**. Un nombre no tiene
   polaridad y no promete un cuerpo. Tiene que ser una medición del efecto, tomada del lado donde el
   "no" se rompería.
2. **El `grep` sigue siendo legítimo, y para algo preciso:** la **ausencia** de una llamada prohibida
   sobre un conjunto de archivos acotado (`none()`), y los invariantes estructurales que sí son
   propiedades del fuente (*"ningún archivo de la vidriera construye su propia conexión"*). Lo que no
   puede es **sustituir a un conteo**. Cuando las dos cosas conviven, se separan en dos secciones y
   **el nombre de cada una dice cuál es cuál** — por eso V5 hoy se llama *"el camino de reservas no
   purga el catálogo entero (**estático**; el radio se mide en V9)"*.
3. **Lo que se cuenta se lee de la salida de una corrida, no del fuente, y la ausencia de la línea es
   FAIL.** Ya era la convención de S3 y S4; con V9 lo es también la de S6. Un gate que grepea el
   fuente buscando la cadena `MEDIDO` encuentra el docblock del spec y pasa con **cero corridas** —
   eso es exactamente lo que hacía V8 hasta el 2026-08-28.
4. **Cuando un gate se rompe porque el archivo se movió, el arreglo no es repuntar el path.** Es
   subir la aserción al invariante que sobrevive al refactor. Repuntar el `grep` de A2 a
   `storefront-db.ts` habría repuesto la misma fragilidad con otro domicilio.

### Cómo quedó cada caso

| gate | qué afirma ahora | tipo |
|---|---|---|
| **V5** de `accept-s6.sh` | *nadie llama a la purga del catálogo (`invalidateStorefront(`) desde el camino de reservas*. La **ausencia** sí es una propiedad del fuente | estático, y el nombre lo dice |
| **V9** de `accept-s6.sh` (nueva) | lee `MEDIDO s6 radio` de la corrida y **compara `rerender` contra `esperado`**, con tres controles anti-vacuidad: `paginas > 2` (sin fichas hermanas el radio no se puede afirmar), `frio > 0` (si el espía de Postgres no vio una sentencia, nadie midió nada) y **ausencia de la línea = FAIL** | contado |
| **A2** de `accept-s1.sh` | *ningún archivo de la vidriera construye su propia conexión: el único `createDb(` vive en `storefront-db.ts`, y ese lugar abre transacción y baja a `anon`* | estático, pero sobre el invariante y no sobre el domicilio |
| **M1** de `accept-s3.sh` | el mismo techo de siempre, escaneando el fuente **con comentarios y strings blanqueados** —reemplazados por espacios, para no mover un offset y que los números de línea sigan siendo los reales—, igual que `scan()` de `web-lint.mjs` | estático, con la ventana del tag bien delimitada |

### Por qué es una ADR y no otra nota operativa

Las notas operativas del 2026-08-28 registran **hechos**: cuatro formas de gate vacío, y V5 como
quinta. Esta es distinta en dos cosas, y las dos la hacen vinculante:

1. **Cambia lo que se le exige a un gate antes de aceptarlo**, no lo que se sabe sobre uno viejo. La
   regla de método del board pregunta *¿se lo vio fallar?*; ésta pregunta **¿qué mide cuando pasa?**
   Un gate puede haberse visto fallar por el motivo equivocado — M1 se vio fallar contra
   `listings.ts` y ese rojo era falso.
2. **Por primera vez la clase tiene un chequeo automático.** `scripts/guard-gates.sh` corre sobre
   todo `scripts/*.sh` y falla si un gate invoca una palabra que **no resuelve a nada** —ni función
   propia, ni de `_lib.sh` cuando lo importa, ni builtin, ni binario en PATH— y también si
   **redefine** un helper que `_lib.sh` ya da (dos copias derivan). Es estático a propósito y no un
   `command_not_found_handle`: ese gancho es de bash ≥ 4.0 y macOS ships 3.2.57, o sea que agarraría
   en CI y sería inerte en la máquina donde más se corren los gates a mano.

### Lo que esta ADR **no** puede cerrar automáticamente, y no se va a poder

`guard-gates.sh` cierra **una sola** de las tres formas: la aserción que se evapora porque su helper
no existe. Es la única que es mecánica. Las otras dos —**el nombre que promete un cuerpo** y **el
escáner que reconstruye un tag fantasma**— no tienen gate y no lo van a tener: decidir si *"no purga
la vidriera entera"* está **medido** o **grepeado** exige leer la aserción y entender qué promete.
Se hace en review, contra esta ADR. Escribirlo importa porque la alternativa es que alguien lea
`guard-gates.sh` en verde como si dijera *"los gates están bien"*, y dice mucho menos que eso.

### Alternativas descartadas

| alternativa | por qué no |
|---|---|
| **arreglar los tres greps sin escribir la regla** | los tres se arreglaban en veinte minutos; lo que se pierde es la pregunta. La familia ya había sumado cinco miembros en un día — sin regla escrita, el sexto se descubre igual de tarde |
| **prohibir el `grep` en los gates** | mata la mitad útil. La **ausencia** de una llamada prohibida *sí* es una propiedad del fuente, y es como se afirman la mitad de las prohibiciones de `CLAUDE.md` §2. La regla no es *"no grepear"*, es *"no grepear un nombre cuando lo que se afirma es una conducta"* |
| **hacer que `guard-gates.sh` también detecte "aserción con verbo + evidencia de grep"** | requeriría entender qué mide cada aserción. Un gate heurístico sobre esto produce falsos positivos, y un gate ruidoso es un gate que se aprende a ignorar — que es el modo de falla de M1 antes del arreglo, otra vez |
| **dejar V5 midiendo el radio en vez de partirla en V5 + V9** | el radio necesita un browser, un espía de Postgres y un fixture de varias fichas: es e2e, y el arnés es de otra columna. Partirla deja cada mitad con la evidencia que su tipo admite, y el nombre de cada sección dice cuál es |

### Verificación

**Barrido serial del LEAD sobre el árbol commiteado (HEAD `68c0bd6`), 2026-08-28, los 21 chequeos en
verde:**

```
accept-s1  PASS=39 FAIL=0
accept-s2  PASS=21 FAIL=0
accept-s3  PASS=59 FAIL=0
accept-s4  PASS=38 FAIL=0
accept-s6  PASS=22 FAIL=0
```

**La medición que S6 no tenía hasta ese día, emitida por el spec de `qa-agent` y consumida por V9:**

```
MEDIDO s6 radio · publicadas=4 · paginas=5 · rerender=2 · esperado=2
              · sobrevivieron=[ficha-a,ficha-c,ficha-d] · frio=14
```

`scripts/guard-gates.sh` pasa sobre los **21** `scripts/*.sh` (`:48`, `glob` sin exclusión) y
**el número que imprime es el de los archivos que efectivamente auditó**: sale del barrido
(`AUDITADOS`, `:173`), no de un `ls`, y **su ausencia es FAIL** (`:184-187`) — *"sin `AUDITADOS` no
se sabe sobre qué se está afirmando"*, que es la misma convención de V9 aplicada al gate de gates.
Hoy dice *"los **21** scripts auditados resuelven todos los helpers que invocan"*: 21 en la lista,
21 auditados. **`_lib.sh` entra a G1**, que es donde importa: la librería también puede invocar algo
que no resuelve, y es el único archivo donde eso se propaga a los otros veinte de una vez.
**G2 sí lo exceptúa, con el motivo escrito en el código** (`:167`): G2 caza al gate que **redefine**
un helper que la librería ya da, y `_lib.sh` es la librería — sus definiciones son el original y no
una copia que derive, así que auditarlo ahí reportaría las 12 como duplicadas de sí mismas. La
excepción es de un barrido, no del archivo, y está declarada donde ocurre.

Su polaridad `scripts/guard-gates.test.sh` se ve **encender y callar** con **nueve** fixtures: el bug
real (`chk`/`have` prestados de otro gate), la redefinición de un helper de `_lib.sh`, una invocación
rota **dentro** de `_lib.sh`, y los que tienen que quedarse callados —un gate con su propio `chk`
legítimo, el árbol sano con `_lib.sh` adentro del barrido, G2 no acusando a `_lib.sh` de duplicar lo
que él mismo define, un `;` adentro de un string, un cuerpo de heredoc—. Los dos tienen step en
`ci.yml` (`:101` y `:105`) con `if: always()`, que en este repo significa **nivel 1** y nada más:
`ci.yml` sigue sin haber corrido nunca (ver §Notas operativas).

**Y la evidencia que estaba huérfana ahora sostiene algo.**
`e2e/s6-senar-un-equipo-no-purga-la-vidriera-entera.spec.ts` estaba en disco, medido, con su módulo
de veredicto testeado, y **ningún gate lo citaba**: borrar los dos archivos no ponía nada en rojo.
`accept-s6.sh` los corre desde el 2026-08-28 (`SPEC_RADIO`, en la misma invocación que V8). La
auditoría de referencia del veredicto es
`tests/el-veredicto-del-radio-rechaza-la-purga-que-arrastra-fichas-ajenas.test.ts`, de **`qa-agent`**
— otra columna que la del código auditado, como exige `CLAUDE.md` §4: si el gate citara el test del
mismo writer, el writer estaría firmando su propio certificado.

#### Dos honestidades que se dejan sin maquillar, porque son la mitad del valor de esta ADR

1. **El arreglo de M1 no destapó ningún rojo del producto.** `listings.ts` ya no tiene `srcSet`, y el
   árbol entero pasaba también con el escáner viejo. Se **sacó una mina**, no se arregló una falla
   viva. Queda escrito porque la próxima lectura del diff podría contarlo como un bug encontrado, y
   eso inflaría el valor de un arreglo que vale por lo que evita, no por lo que curó.
2. **El primer fixture con el que el LEAD intentó probar M1 no reproducía el defecto.** La prosa del
   fixture nombraba `sizes` **antes** que `srcSet`, así que la ventana del tag encontraba un `sizes`
   y el escáner viejo pasaba sin encenderse. Lo detectó corriendo el escáner **viejo** contra el
   fixture y viéndolo **pasar cuando tenía que fallar**. Regla de método que se suma a la del board
   —*un gate que nunca se vio fallar no es un gate*—: **un fix cuya reproducción no se vio encender
   no está probado.** El fixture es tan código como el gate y falla igual de silencioso; la
   diferencia es que su falla se disfraza de "ya estaba arreglado".

#### Y una tercera, sobre este documento — la ADR se aplicó a sí misma y se encontró en falta

La primera redacción de la sección de arriba decía que el barrido son *"21 archivos, `_lib.sh`
excluido porque es la librería y no un gate"*. **Eso afirmaba una conducta del gate leyendo su
diseño, no su código** — exactamente la forma que esta ADR prohíbe, sólo que escrita en prosa en vez
de en bash. Nadie la inventó: es plausible por analogía con el resto del repo, y así es como entran
estas afirmaciones.

**Y la primera corrección tampoco estaba medida.** Se propuso al revés —que `_lib.sh` **entra** al
barrido y que los 21 lo incluyen— leyendo el `glob.glob('scripts/*.sh')` de `:48`, que efectivamente
no excluye nada. Pero el `glob` arma la **lista**; quien decide el **alcance** son los dos `for` que saltean
`_lib.sh` — **`:122` y `:158` del archivo tal como quedó en `f691daf`**, o sea el de esa mañana,
antes del arreglo de T20. Las dos versiones leyeron **media** implementación y las dos sonaban
bien. Lo que las separó no fue discutirlo: fue abrir el archivo y mirar esas dos líneas más el
`glob` y la que imprime el número.

> **Los cuatro números de este párrafo describen un archivo que ya no existe, y por eso se citan
> contra un commit.** `guard-gates.sh` sigue vivo y sigue moviéndose: T20 mismo le corrió las
> líneas —hoy `_lib.sh` **entra** a G1, así que el `for` de `:122` ni siquiera dice lo que decía—.
> Un número de línea suelto es una afirmación sobre un archivo que cambia sin que nadie toque el
> doc: **se vuelve falsa sin dejar diff**, que es la peor forma de drift porque no hay nada que
> revisar. La forma que se usa acá, y que vale para todo `docs/**`: **si el número describe el
> pasado, va anclado al commit** (`git show f691daf:scripts/guard-gates.sh`); si describe el
> presente, va con fecha de verificación y se relee cuando el archivo se toca. Las citas vigentes
> de esta misma ADR —`:48`, `:167`, `:173`, `:184-187`— son de la segunda clase y están releídas
> el 2026-08-28.

**La moraleja es la de la ADR, con el documento adentro del alcance:** *"pasa sobre los scripts del
repo"* es una afirmación con verbo, y una afirmación con verbo se verifica contando, incluso cuando
el que la escribe es un doc y no un `grep`. Una regla sobre no dar por buenas las afirmaciones sin
medir vale bastante menos si el texto que la enuncia se exceptúa a sí mismo.

**Desenlace, el mismo día.** Lo que cerró la discusión no fue acordar una redacción: fue **abrir el
archivo y medir los dos polos por separado**. Medidos, no coincidían con ninguna de las dos
versiones enteras — el diagnóstico valía para G1 y **no** para G2, y esa asimetría no la contenía
ninguna de las dos prosas. El LEAD arregló `scripts/guard-gates.sh` (T20, cerrada): `_lib.sh` entró
a G1, G2 lo sigue exceptuando **con el motivo escrito en el código**, y el número impreso pasó de un
`ls` a `AUDITADOS`, con la ausencia de la línea contando como FAIL. La cláusula de §Verificación de
arriba dice lo que el código hace hoy. Los dos párrafos de esta subsección **no** se corrigieron ni
se suavizaron: describen dos afirmaciones que estuvieron mal, y ése —no la versión final— es el
ejemplo. Lo barato acá fue el arreglo; lo caro fue las dos veces que se afirmó sin abrir el archivo.

## ADR-021 — La aserción tiene la forma del **caller**, no la forma cómoda
- **Estado:** aceptada · **Fecha:** 2026-08-28 · **Autor:** LEAD (la formuló al despachar el primer fallo de T21) · redactada por `docs-keeper`
- **Implementó:** LEAD — `scripts/probes/el-grant-cubre-el-insert-de-drizzle.test.ts` (**G6**), cableado en `scripts/accept-fase2.sh` §**D5**. Del lado del código auditado, `db-agent` reescribió `packages/db/src/reservations-sweep-attempts.test.ts` y `packages/db/drizzle/0006_reservations_sweep_attempts.sql`.
- **Relación con ADR-020:** hermanas, y **ninguna contiene a la otra**. Ver §"Por qué es ADR propia".

### Contexto — un test que midió de verdad, contra alguien que no existe

La migración `0006` agregó `reservations.sweep_attempts` (fila **T21**). Para que un seller no
pudiera forjar el contador, revocó el `INSERT` de **tabla** a `authenticated` y lo re-otorgó
**columna por columna** sobre las 11 que ya existían. `db-agent` lo acompañó con un test que probaba
que *el panel podía seguir insertando*: contra Postgres real, con sesión de `authenticated`, con
claim y todo. **Verde.**

El panel estaba roto. Los dos specs e2e de S6 caen con `42501 permission denied for table
reservations`, y **reservar un equipo desde el panel** —la mitad que S6 vende— dejó de funcionar.

La grieta no está en el schema ni en el método de medición: está en **quién emite la sentencia**.

| | lo que hacía el test | lo que hace el producto |
|---|---|---|
| quién arma el `INSERT` | una cadena escrita a mano en el propio test | `db.insert(reservations).values({…})` |
| columnas nombradas | las 3 que el autor eligió | **todas las de la tabla**, con `default` en las que no le pasaste |
| resultado | pasa | `42501`: Postgres exige privilegio sobre cada columna **nombrada**, aunque el valor sea `DEFAULT` |

Ningún caller del producto emite la sentencia que el test ejecutó. El test **no era vacuo** —medía
un efecto real, en la capa correcta, con la base real— y aun así su verde no decía nada sobre el
producto: **medía a un sujeto inventado.**

### Decisión

**Cuando una aserción es sobre lo que le pasa a un caller, el sujeto de la medición tiene que ser
el caller — no una reconstrucción a mano de lo que uno cree que el caller emite.** Operacionalizada
en tres reglas, que son lo que hay que preguntarle a un test nuevo antes de creerle:

1. **Si la aserción nombra a un actor del producto** —*el panel*, *la vidriera*, *el cron*, *el
   seller*— **el input se construye con el mismo código que ese actor usa.** Acá eso es el query
   builder de Drizzle (`toSQL()`), ejecutado tal cual con sus `$n`. La reescritura de `db-agent` lo
   hace así y además **deriva la lista de columnas del schema**, con lo cual la próxima columna
   entra sola en vez de desactualizar el test en silencio.
2. **Si hay una lista escrita a mano en el test, esa lista es la hipótesis, no la evidencia.** Una
   enumeración de columnas, de headers, de campos o de parámetros tecleada en el test es una
   afirmación sobre lo que la librería hace — y esa afirmación se verifica **contra la librería**,
   no se asume. Cuando la lista tiene que existir igual, se compara contra la derivada: el test
   nuevo afirma `columnasNombradas(sql) === columnasDelSchema()` **y** que `sweep_attempts` está
   adentro, que es la premisa entera del defecto.
3. **La capa que se está probando se nombra en la aserción, porque el mismo síntoma tiene dos
   causas.** `42501` tapa *"nunca tuviste el privilegio"* (`permission denied for table`) y *"la
   policy miró la fila y la rechazó"* (`new row violates row-level security policy`). Confundirlas
   es cómo un test verde convive con un panel roto: si la negativa del `INSERT` forjado dijera
   `permission denied for table` en vez de `row-level security`, estaríamos de vuelta en el bug y
   el test seguiría en verde. Se afirma el **mensaje**, no el código.

**Corolario de diseño que sale de este caso y vale más allá del test** (está escrito adentro de la
migración): **no se usa `GRANT` por columna para `INSERT`.** El `GRANT` sólo sabe decir *sí* o *no*;
el candado *"esta columna se inserta sólo en cero"* lo sabe expresar la `WITH CHECK` de la policy,
que es la capa que mira el valor. Para `UPDATE` el `GRANT` por columna **sí** sirve, porque el
`.set()` de Drizzle nombra únicamente lo que estás seteando. Las dos capas se evalúan las dos
(`CLAUDE.md` §3) y cada una va donde la otra no llega.

### Por qué es ADR propia y no una sección de ADR-020

Porque **las cuatro reglas de ADR-020 dan verde a este defecto.** ADR-020 separa *aserción con
verbo* de *evidencia por presencia de un identificador*: prohíbe grepear un nombre donde hay que
contar un efecto. El test de T21 **contaba un efecto**, contra Postgres real, y una revisión que
aplicara ADR-020 al pie de la letra lo habría aprobado. Son dos ejes distintos:

| | ADR-020 | ADR-021 |
|---|---|---|
| qué falla | la **evidencia**: se afirma una conducta y se ejecuta un `grep` | el **sujeto**: se ejecuta de verdad, contra alguien que no existe |
| cómo se ve el gate roto | verde sin haber medido | verde habiendo medido lo que no era |
| la pregunta que lo caza | *cuando pasa, ¿qué midió?* | *cuando pasa, **¿quién** emitió eso?* |

Meterlo adentro de ADR-020 obligaría a ensanchar su decisión hasta que deje de cortar —"un gate
tiene que estar bien hecho" no es una regla— y a tocar una sección que el LEAD dejó explícitamente
congelada como ejemplo. Y hay una razón práctica: las ADRs se citan por número desde los gates y
desde el board (T25 ya cita ADR-020 para *"no busca `sweep_attempts` en ningún archivo"*). Un
número propio le da a esta regla un lugar que citar cuando el reviewer de turno pregunte quién
emite la sentencia.

### Verificación

- **El gate barato existe y es del LEAD:** **G6**, `scripts/probes/el-grant-cubre-el-insert-de-drizzle.test.ts`,
  sección **D5** de `scripts/accept-fase2.sh` (`ci.yml:137`, el único job con Postgres migrado —
  **nivel 1**, ver el recuadro rojo de `TEST_MATRIX.md`). Recorre las tablas de negocio derivadas de
  `information_schema` (las que tienen `tenant_id`) y exige: si `authenticated` tiene **algún**
  privilegio de `INSERT` por columna, lo tiene sobre **todas**. Cero privilegios = fuera de alcance,
  porque esa tabla la escribe `service_role` y es legítimo.
- **No vive adentro de `guard-grants.sh`, y es a propósito.** Ese guard declara en su encabezado ser
  100% estático para poder correr sin base en el pre-commit; esta afirmación **sólo** se puede hacer
  contra el catálogo de una base migrada. `guard-grants.sh` **dijo PASS con el panel roto** y eso no
  es un descuido suyo: cuenta que el `GRANT` **exista**, y un `GRANT` parcial existe. Romperle el
  contrato para meterle esta regla habría sido peor que la regla.
- **Probado en las dos polaridades sobre el censo real**, no sobre el predicado (LEAD, 2026-08-28):
  tabla sembrada con `tenant_id` y `GRANT` de `INSERT` sobre 2 de 3 columnas → **rojo, nombrando
  tabla y columna faltante**; borrada → **verde**; base verificada limpia después. La probe además
  lleva adentro un control de polaridad que corre **siempre**, sobre una tabla creada dentro de una
  transacción que se rollea, para que *"no encontré tablas rotas"* y *"no sé buscar tablas rotas"*
  dejen de ser la misma salida verde.
- **La migración se defiende sola:** el bloque `DO` de `0006` aborta —y por lo tanto **no se
  registra**— si el reparto de privilegios no es el declarado, incluida la mitad que costó el fallo
  (`authenticated` tiene `INSERT` a nivel de **tabla**; el contador lo ata la policy).
- **Lo que esta ADR no cierra:** el fallo de T21 lo agarró **e2e**, el gate más caro y más lento del
  repo. G6 pone la misma afirmación en un lugar barato, pero la clase general —*una aserción cuyo
  sujeto no es el caller*— no tiene guard mecánico y probablemente no pueda tenerlo. Se sostiene en
  revisión, con la pregunta de la tabla de arriba.

### Alternativa descartada

**Que el test del paquete siguiera escribiendo el `INSERT` a mano, "pero con todas las columnas".**
Arregla este caso y deja el mecanismo intacto: la lista tecleada envejece con la próxima columna y
vuelve a divergir del caller **en silencio**, que es exactamente lo que pasó. La lista se deriva del
schema o no se escribe.

---

## ADR-022 — Un gate no puede crecer de la mano del código que audita: todo script de gate es del LEAD  ·  **enmendada el 2026-08-28** (el título original decía *todo `*-lint.mjs`*, y ese sufijo dejaba un gate afuera)
- **Estado:** aceptada · **Fecha:** 2026-08-28 · **Autor:** LEAD (`CLAUDE.md` §4, commit `6952393`) · redactada por `docs-keeper`
- **La levantó el agente auditado:** `db-agent`, que preguntó si le correspondía ampliar el lint que mira sus propias policies. Le correspondía preguntar; la respuesta es no.
- **Relación con ADR-020 y ADR-021:** las tres son de la misma familia y ninguna contiene a las otras. ADR-020 dice **qué afirma** un gate (conducta, no identificador); ADR-021 dice **sobre quién** (el caller, no un sujeto inventado); ésta dice **quién lo escribe**.

### Contexto — la fila nombraba un archivo donde tenía que nombrar una clase

`CLAUDE.md` §4 decía `apps/web/scripts/*-lint.mjs` es del LEAD. Nombraba **un** lint. Por ese hueco,
`packages/db/scripts/rls-lint.mjs` —el gate que sostiene *"sin RLS no hay merge"*, la invariante más
cara del producto— quedaba adentro de `packages/db/**`, o sea del **mismo writer cuyas policies
audita**.

No es teoría, y el precio está medido. La migración `0006` trajo el **primer `ALTER POLICY` del
repo**. `rls-lint.mjs` leía sólo `CREATE POLICY`. Medición del LEAD sobre el archivo real, antes del
arreglo:

| versión del lint | `0006` con `ALTER POLICY … WITH CHECK (true)` | salida |
|---|---|---|
| la vieja (sólo `CREATE POLICY`) | no la ve | `rls-lint OK · 74 policies` · **exit 0** |
| con la sección **3b** | la ve | `0007 reservations.reservations_tenant_insert (ALTER) deja WITH CHECK (true)` · **exit 1** |

La regla `0007` es la que `CLAUDE.md` §2 nombra como fallo de merge. Tenía una puerta al lado sin
cerrar, y la puerta la abrió la primera migración que usó la sintaxis nueva.

### Decisión

**Todo `*-lint.mjs`, viva donde viva, es del LEAD.** No `apps/web/scripts/*-lint.mjs`: la clase
entera, por la misma razón que `scripts/probes/**` y que `config/firewall-rules.json` — el gate no
puede ser del mismo writer que el código que audita.

**Corolario operativo, y es el que cuesta: `db-agent` pide, no edita.** Escribe policies todo el
tiempo y ya no puede ampliar el lint que las mira. Es exactamente el mismo trato que tiene con los
techos del WAF.

**Lo que 3b NO exige, y no es un olvido que haya que "arreglar":** un `ALTER POLICY` que **omite**
`WITH CHECK` no es un hallazgo. En Postgres la cláusula omitida queda como estaba, así que pedirla
sería un falso positivo — y un gate que enrojece sobre código correcto es el modo de falla que
ADR-020 nombra en su caso M1.

### Alternativa descartada

**Dejar `rls-lint.mjs` con `db-agent` y confiar en la revisión.** El argumento a favor era real: es
el agente que más rápido se entera de que hace falta una regla nueva, y de hecho ésta la escribió
él. El argumento en contra es estructural y gana: **un lint que crece de la mano del código que
audita es un lint que nunca lo va a contradecir.** El costo de que la regla llegue un día más tarde
—porque hay que pedirla— es menor que el de un gate que sólo sabe afirmar lo que su autor ya cree.

### Consecuencias

- `packages/db/**` deja de ser un directorio de un solo owner: `db-agent` escribe todo menos
  `scripts/`. Es la primera excepción de esa forma y está aceptada.
- La regla se aplica **hacia adelante sin lista**: un gate nuevo en cualquier paquete nace siendo
  del LEAD, sin que haya que agregar una fila. (Decía `*-lint.mjs`; la enmienda del 2026-08-28 lo
  cambió por *todo script que un `package.json` corra como gate*, que es lo que la frase quería decir.)
- **El alcance real es más ancho de lo que el commit hacía suponer, y lo censó `docs-keeper` el
  2026-08-28 al aplicar la regla.** `find . -name '*-lint.mjs'` sin `node_modules` devuelve
  **cinco**, y **cuatro los escribió el writer que auditan**: `rls-lint.mjs` (`db-agent`, `63abcb7`),
  `ai-lint.mjs` (`ai-agent`, `d42fac9`), `media-lint.mjs` (`media-agent`, `2027fc9`) y `qa-lint.mjs`
  (`qa-agent`, `81da33f`). El único escrito por el LEAD es `web-lint.mjs`. Los cuatro son
  **anteriores** a `6952393`, así que **ninguno es una infracción de nadie** — y son la evidencia de
  que enumerar no habría alcanzado: el commit nombró un caso y la clase tenía cuatro. La tabla vive
  en `ARCHITECTURE.md` §"Mapa del monorepo", no acá, para que no haya dos censos.
- **~~Lo que esto abre y `docs-keeper` no decide: si los cuatro se mudan a `scripts/`.~~ Decidido
  por el LEAD el 2026-08-28: NO se mudan.** El argumento de mudarlos —*un archivo dentro de
  `packages/x/**` se lee como del owner de `packages/x/**` aunque §4 diga otra cosa*— era correcto,
  y se contestó con una marca y un gate en vez de con una mudanza. Ver la **enmienda** al final.
- **~~No hay gate que verifique esta regla, y no puede haberlo por construcción.~~ Falso, y lo
  demostró el gate.** Lo que no se puede auditar es la *intención* de un owner; lo que sí se puede
  es que el archivo **declare** a su dueño y que alguien lo cense. Es la sección **G3** de
  `scripts/guard-gates.sh`. Ver la enmienda.
- Un contrato de `.claude/agents/*.md` que reclame un `*-lint.mjs` está **derogado en esa línea**:
  `CLAUDE.md` §4 ya fija que un contrato de agente puede **acotar** lo que su dueño escribe, nunca
  ampliarlo.

### Verificación

`git show HEAD:packages/db/scripts/rls-lint.mjs` trae la sección **3b** en `:176` (`63abcb7`), y
`CLAUDE.md` §4 trae la fila generalizada (`6952393`). Del lado del efecto, la medición de las dos
polaridades está en la tabla de arriba y la hizo el LEAD sobre el archivo real.

### Enmienda del 2026-08-28 — el sujeto de la regla es la **función** del script, no su nombre

Ratificada por el LEAD el mismo día, después de censar la clase que esta ADR dice cubrir y encontrar
que **no la cubre**.

`find . -name '*-lint.mjs' -not -path '*/node_modules/*'` devuelve **cinco** (la tabla del censo, en
`ARCHITECTURE.md`). Pero el `lint` de `packages/domain` es **`packages/domain/scripts/purity-check.mjs`**
—`packages/domain/package.json`: `"lint": "node ./scripts/purity-check.mjs"`—, que **no termina en
`-lint.mjs`**. La regla tal como estaba escrita no lo alcanzaba, así que quedaba adentro de
`packages/domain/**`, o sea de `domain-agent`, **el writer cuya pureza audita**. Es el mismo agujero
que esta ADR vino a tapar, reabierto un nivel más arriba: **una regla que nombra un sufijo falla
igual que la que nombraba un archivo.**

**Regla vigente** (`CLAUDE.md` §4): es del LEAD **todo script que un `package.json` del repo corra
como `lint`, `guard`, `check`, `verify` o `audit`**, además de `scripts/**` y `scripts/probes/**`.
El sujeto es **lo que el script hace**, no cómo se llama — y, el punto entero, la definición es
**censable en un comando**. Hoy son **seis**: `web-lint.mjs`, `rls-lint.mjs`, `ai-lint.mjs`,
`media-lint.mjs`, `qa-lint.mjs` y `purity-check.mjs`.

**Alternativa descartada: mudar los seis a `scripts/`.** Es editar seis `package.json` en cinco
columnas ajenas y reescribir la resolución de paths de cada uno, todo para arreglar un problema de
**rótulo** — y no lo arreglaría. `purity-check.mjs` muestra que el fallo no es *dónde vive el
archivo* sino *cómo la regla identifica a su sujeto*: una regla apoyada en la ubicación tendría el
mismo hueco de sufijo el día que alguien ponga un gate en otro lado.

**Lo que sí se hizo, porque el argumento de la lectura era correcto:** los seis llevan la marca
literal **`gate-owner: LEAD`** en su encabezado (línea 3 de cada uno, verificado archivo por
archivo), y **hay un gate que la exige**. Sección **G3** de `scripts/guard-gates.sh`: enumera los
`package.json` del repo, resuelve el target de cada script de gate y falla si el archivo no declara
la marca en sus primeras 40 líneas. Un gate nuevo escrito por el writer que audita **rompe el día
que nace**, no la vez que a alguien se le ocurra censar.

**Qué exime G3 y por qué:** un gate bajo `scripts/**` no necesita la marca — ese path ya es del LEAD
por fila propia de §4 y no hay ambigüedad de lectura que resolver. La marca existe para el archivo
que vive **adentro de la columna de otro**. Por eso G3 censa **siete** targets y no seis: los seis de
paquete más `scripts/guard-artifacts.sh`, que corre desde el `guard` del `package.json` raíz, entra
al censo y queda exento de marca. Y G3 falla **también por ausencia**: un `package.json` que corre un
gate que no existe es `FAIL` (gate fantasma), y **cero gates censados es hallazgo, no veredicto
verde** — la regla de ADR-020 aplicada al censo mismo.

### Verificación de la enmienda

Corrida del LEAD, **re-verificada por `docs-keeper` el 2026-08-28 ejecutando los dos comandos**:

```
bash scripts/guard-gates.sh
  G3 · todo gate de paquete se declara del LEAD (CLAUDE.md §4 · ADR-022)
    PASS  los 7 gates que corren desde un package.json existen y se declaran del LEAD
  GUARD-GATES: PASS

bash scripts/guard-gates.test.sh   → "guard-gates.sh: OK (se vio encender y se vio callar)"
```

Los **7 casos nuevos de G3** incluyen los cuatro que lo ven **encender**: gate de paquete sin marca ·
**el gate que NO se llama `*-lint.mjs`** (el agujero que dejaba la regla vieja) · gate fantasma ·
censo vacío. Los dos comandos ya son steps de CI (`ci.yml:101` y `:105`), así que G3 entra sin tocar
`ci.yml` — con la salvedad de nivel de siempre: **el CI declara el step y nunca corrió** (ver
`TEST_MATRIX.md`).

**Estado en `main` al momento de escribir esto: NO está commiteado.** `git show HEAD:scripts/guard-gates.sh | grep -c 'G3 ·'`
→ **0**, y `git show HEAD:CLAUDE.md | grep -c 'guard-gates.sh'` → **0**. Lo medido es el árbol de
trabajo. Fila **T28** del board.

---

## ADR-023 — Una comparación de mismo origen no audita el contenido: se declara, y va acompañada de una aserción por literal
- **Estado:** **aceptada** · **Fecha:** 2026-08-28 · **Ratificada por el LEAD**, que corrigió lo que la propuesta exigía (ver §"Decisión") · redactada por `docs-keeper`. Se escribe acá y no en cinco archivos porque la clase apareció tres veces en un mes y cada vez se documentó en el archivo donde molestaba, sin nombre común.
- **Autor del hallazgo que la dispara:** `billing-agent`, midiéndolo por mutación sobre su propio test.
- **Relación con ADR-020 y ADR-021:** tercera hermana, y **ninguna de las dos la cubre**. Ver §"Por qué no es ADR-020 ni ADR-021".

### Contexto — tres casos, la misma forma, ningún nombre

| caso | la aserción | por qué no auditaba |
|---|---|---|
| `plans.test.ts`, bloque *"coherencia con el resolver"* | *"el resolver coincide con el catálogo"* | los **dos** lados derivan de `PLAN_CATALOG`: el esperado es `planIncludes(tier, feature)` = `PLAN_CATALOG[tier].features.includes(feature)`, y el observado es `featureAccess()` → `planFeatures(tier).includes(feature)` = **la misma expresión**. El contenido se cancela |
| el control de polaridad de la probe **G6** | *"el censo sabe encontrar una tabla rota"* | el control re-inlineaba el SQL en vez de llamar al predicado del censo. Mutar el predicado real dejaba el censo **verde** y el control verde con él |
| el censo de `guard-gates.sh` | *"los 21 scripts resuelven todos los helpers"* | el número salía de un `ls` y los barridos auditaban 20. La población medida y la población declarada tenían orígenes distintos, y el que se imprimía era el cómodo |

Los tres pasan las cuatro reglas de ADR-020 —miden conducta, no identificadores— y los tres pasan
ADR-021 —el sujeto es el caller real—. Y los tres son verdes que no afirman nada.

**Precisión sobre la primera fila, para que la tabla no se lea de más:** lo que no audita contenido
es **ese bloque**, no el archivo. `plans.test.ts` lleva además el bloque de literales y dice en prosa
cuál es cuál, así que **cumple la forma ratificada más abajo** — es el ejemplo positivo de esta ADR.
Los otros dos casos de la tabla sí eran defectos: no tenían acompañante.

**La medición que lo hace concreto**, hecha por `billing-agent` sobre `plans.test.ts` y verificada
por `docs-keeper` leyendo las dos rutas de derivación: sacarle `chatbot` a `negocio` en
`PLAN_CATALOG` pone **rojos los 4 tests de contenido** y deja el bloque de coherencia **verde**. Y
el bloque de coherencia es el que se había *ensanchado* —de una feature a
`PLAN_TIERS × BILLABLE_FEATURES`— con la intención de reforzarlo. Ensancharlo lo **debilitó**: la
versión angosta comparaba dos mapas escritos por separado; la ancha compara un mapa consigo mismo,
**12 veces** (3 planes × 4 features).

### Decisión — y la corrección del LEAD, que cambia lo que la regla EXIGE

La propuesta se leía como una **prohibición** de la comparación de mismo origen. **Eso está mal y la
habría hecho dañina.** Un chequeo de coherencia entre dos writers es exactamente lo que caza a
`billing-agent` y a `app-agent` separándose, y **sólo se puede escribir comparando un lado con el
otro**. Prohibirlo borra la única prueba de que las dos columnas siguen diciendo lo mismo.

**Lo que está mal no es la aserción de mismo origen. Es que sea lo único que hay en la sala.**

**Forma ratificada, y es lo que hay que cumplir:** un archivo que contiene una comparación de mismo
origen tiene que contener además, **sobre el mismo sujeto**, al menos una aserción cuyo valor
esperado sea un **literal escrito en el test**; y tiene que **decir en prosa** cuál de sus bloques
lleva el contenido y cuál lleva sólo la coherencia. Una comparación de mismo origen sin ese
acompañante no es un test débil: es un test que **reporta salud que nadie midió**, que es la misma
familia de ADR-020 y ADR-021.

**Una aserción sólo audita el contenido si su valor esperado y su valor observado tienen orígenes
independientes.** Tres preguntas, en orden, para un test o un gate nuevo:

1. **¿De dónde sale el esperado?** Si sale de la misma constante, del mismo módulo o del mismo
   `select` que el observado, la aserción es una tautología y su verde es incondicional.
2. **¿El control de polaridad llama al código bajo prueba, o a una copia suya?** Una copia hace que
   el control certifique un predicado que no es el que corre. Es la forma más cara porque el
   arnés—lo que se supone que protege—es el que miente.
3. **¿La población medida es la población declarada?** Un conteo que sale de una fuente y un barrido
   que sale de otra no se auditan mutuamente: se contradicen en silencio y gana el que se imprime.

**Y una consecuencia que hay que escribir porque va contra el instinto: ensanchar una matriz no
refuerza un chequeo, y a veces lo rompe.** Ensanchar es correcto cuando los dos lados siguen siendo
independientes. Cuando la unificación de fuentes ya ocurrió —que es justo lo que se estaba
celebrando en `plans.ts`— la matriz ancha mide la unificación, no el contenido. **Las dos cosas se
afirman por separado o no se afirman.**

**Lo que esta ADR NO pide, y conviene leerlo dos veces:** borrar el bloque de coherencia de
`plans.test.ts`. Afirma algo real
y valioso —que el catálogo es **uno**, que `app-agent` no volvió a forkear su mapa, y que el camino
completo *fila ausente → catálogo → vigencia* da `ok`— y hoy su docblock lo dice con todas las
letras. Lo que se propone es que eso se **declare** en el test, como ya está declarado ahí, y que
la corrección del contenido tenga su propia aserción por **igualdad literal**, que es donde un
cambio de producto no querido tiene que enrojecer.

### Por qué no es ADR-020 ni ADR-021

- **ADR-020** ataca *aserción sobre conducta / evidencia sobre un identificador*. Acá la evidencia
  **es** conducta: `plans.test.ts` ejecuta `featureAccess()` de verdad.
- **ADR-021** ataca *el sujeto no es el caller*. Acá el sujeto **es** el caller real, con su código
  real.
- Lo que falla es la **independencia entre el esperado y el observado**, que ninguna de las dos
  nombra. Merece número propio por el mismo motivo por el que ADR-021 no fue una sección de
  ADR-020: las reglas de las otras dos le habrían dado verde a los tres casos de la tabla.

### Dónde vive

**Acá y sólo acá**, con punteros desde `TEST_MATRIX.md` (una sexta pregunta en la lista de *¿hay
chequeo? · ¿lo corre alguien? · ¿está en `main`? · ¿corrió el CI? · ¿qué afirma?*) y desde
`SLICE_BOARD.md` cuando una fila la invoque. **No se re-explica en cada archivo**: una regla de
método copiada en cinco lugares es la misma clase de defecto que la regla describe.

### La pregunta que quedaba abierta, contestada por el LEAD

Era: **si `plans.test.ts` necesita además una aserción de contenido por igualdad literal contra
`PLAN_CATALOG`, o si alcanza con que el primer bloque del mismo archivo ya la tenga.**

**No necesita que se le agregue nada. `plans.test.ts` es el caso MODELO de esta ADR, no el
infractor**, y una ADR que sale con su ejemplo positivo adentro se aplica sola. Verificado por el
LEAD leyendo el archivo y re-verificado por `docs-keeper` sobre
`apps/web/app/(billing)/_lib/plans.test.ts`:

- **El primer bloque (`:43-91`) es todo literal**, y ahí nace el esperado: `PLAN_TIERS` →
  `toEqual(['trial','base','negocio'])` · `planFeatures('base')` → `toEqual([])` ·
  `planLimit('negocio', PICKUP)` → `toBe(3)` · `planLimit('base', PICKUP)` → `toBe(1)` ·
  `toBeNull()` · `monthlyUsdCents` → `1900 / 3500 / 0` · `formatMonthlyUsd` → `'USD 19' / 'USD 35'`.
  El esperado lo escribe el test; el observado sale de `plans.ts`. **Orígenes independientes.**
- **El segundo bloque (`:132-156`) es la matriz de coherencia**, y **el propio archivo ya declara en
  prosa** lo que no afirma (`:114`): *"el contenido se cancela: esto NO afirma que Negocio traiga
  chatbot"*. Lo que sí afirma —que el catálogo es uno, que `app-agent` no volvió a forkear su mapa,
  y que el camino *fila ausente → catálogo → vigencia* da `ok`— está escrito ahí mismo.

**La línea de `TEST_MATRIX.md` se queda** (la séptima pregunta), y deja de estar condicionada a una
ratificación pendiente.

**Corolario para el que escribe el próximo test:** no borres tu bloque de coherencia. Ponele al lado
la aserción por literal, y escribí arriba cuál es cuál.

---

## ADR-024 — Cuando la probe contradice midiendo a la spec del gate que la pidió, **gana la probe** y la spec se corrige
- **Estado:** **aceptada** · **Fecha:** 2026-08-28 · redactada por `docs-keeper`, **ratificada por el LEAD**, que corrigió la evidencia (ver §"Contexto") y agregó el límite de §"Lo que la medición NO puede ganar"
- **Origen:** el LEAD, cerrando **T25**: *"el ADR no es sobre el cron: es sobre que una spec de gate escrita antes que la probe puede estar equivocada, y cuando la probe la contradice midiendo, gana la probe y la spec se corrige."*
- **La evidencia se corrigió antes de aceptar, y en las dos direcciones.** `docs-keeper` objetó que los tres casos que podía documentar eran **los tres puntos de la spec de T25**, o sea **una** celda, no tres slices, y dejó la objeción escrita en vez de rellenarla. El LEAD la aceptó —*"mi frase «tercera vez en esta fase» era imprecisa y tu objeción es correcta"*— y aportó los hashes de los tres casos reales, **más uno que pidió explícitamente NO citar**. Los tres se verificaron contra el mensaje de cada commit antes de entrar acá.
- **Relación con ADR-020 / 021 / 023:** las tres dicen **cómo tiene que estar hecha una aserción**. Ésta dice **quién gana cuando la aserción y su encargo no coinciden**. Ninguna de las tres contesta eso, y es la pregunta que aparece cada vez.
- **`docs-keeper` no la decide.** Se redacta acá lo que el LEAD ya ejecutó tres veces; lo que queda abierto está marcado como pregunta al final.

### Contexto — tres slices, la misma forma, ningún nombre

Una spec de gate se escribe **antes** que el gate, en la celda del board, y describe qué se va a
medir. Eso está bien: es lo que impide que el gate se escriba a medida del código que audita. Pero
la spec es una **hipótesis sobre el código**, y el que la escribe todavía no lo midió.

**Los tres casos de la clase, en tres slices distintas.** Verificados por `docs-keeper` contra el
mensaje de cada commit y contra `git merge-base --is-ancestor`, no tomados de palabra:

| # | commit | la hipótesis | lo que devolvió la medición |
|---|---|---|---|
| 1 | **`4fd230e`** · `[test] plans.test.ts: the clock was never the lever` | un **pool de conexiones muriéndose de hambre** bajo doce transacciones secuenciales de `withTenantDb` | **no hay pool.** El archivo mockea `(app)/_lib/db/session` y ningún test de esa suite toca una base. Los 3489 ms eran `await import('…/entitlements')`, o sea **instanciar el grafo de módulos**; las doce llamadas a `featureAccess()` costaban **10 ms**. Textual del commit: *"my own diagnosis was the thing the measurement killed"* |
| 2 | **`a0e5fde`** · `[test] G6: assert the GRANT covers the INSERT Drizzle emits, not one written by hand` | la spec del gate afirmaba sobre un `INSERT` **escrito a mano** en el test | el `42501` de e2e mostró **qué emite Drizzle en realidad** (todas las columnas de la tabla). La spec perdió contra la medición, y el gate se reescribió alrededor del `INSERT` real |
| 3 | **`10d31b6`**, **sólo su mitad de V3** | el predicado de V3 buscaba un **clamp de duración** de reserva | matcheaba el `Math.max(0, expiresAt - now)` de `presentation.ts`, que es un **piso de cuenta regresiva**, no un clamp — **tercer falso positivo de esa regla**. Lo corrigió *mirar qué era esa línea*, no razonarla |

**El caso 1 es el más limpio de los tres y es contra el LEAD**, que fue quien había hecho el
diagnóstico. Eso importa para la regla: si la única forma de que una spec se corrija fuera que la
escribiera otro, la ADR sería una regla de jerarquía. No lo es. Es una regla sobre **qué clase de
evidencia gana**.

**`10d31b6` entra por mitades, y la otra mitad NO es de esta clase.** Su V8 —el gate que grepeaba
`MEDIDO s6 reserva` en el **fuente** y daba PASS con dos comentarios y cero corridas— es la familia
de **ADR-020**, la del gate que no mide. V3 sí es ésta: el gate medía, y medía la línea equivocada.

**`f691daf` NO se cita acá, y el LEAD lo pidió explícitamente.** Ahí el defecto es que **la aserción
no correspondía a su propio nombre** (`accept-s6` V5 se llamaba *"no purga la vidriera entera"* y
ejecutaba un grep de un identificador). Es primo, no hermano: meterlo diluye la clase, porque
convierte *"la spec era una hipótesis equivocada"* en *"el gate estaba mal escrito"*, que ya tiene
tres ADRs.

**T25 es el caso que la disparó, no su única evidencia.** Sus tres puntos son de **una sola celda**,
así que valen como el detalle que hizo visible la clase, no como tres instancias de ella:

| # | la spec de T25 decía | lo que la medición devolvió | quién ganó |
|---|---|---|---|
| 1 | **A** — *"no necesita Postgres: alcanza el `tx` falso de `expire-reservations.test.ts`"* | la primera pieza del arreglo es `order by sweep_attempts asc, expires_at asc`, y **un `tx` de mentira devuelve las filas en el orden en que se las metieron**: no hay nada del ordenamiento que pueda medir | la probe. Usa Postgres real, y **sin base es FAIL, no `skip`** |
| 2 | **C** — medir `intentos_23514` e `intentos_40P01`, o sea partir por SQLSTATE | **el barrido no ramifica por código de error**, ni debería: lo que importa no es qué error fue, es si una fila que dejó de fallar **vuelve a entrar al lote** | la probe. Los campos son `intentos_tras_fallo` y `reintento_tras_recuperarse` |
| 3 | **B** — `lineas_log_por_envenenada == tope + 1` | vale `tope`. **El `+1` era un evento que nadie escribió** | la probe. El evento salió a fila propia (**T31**) |

**El caso 2 es el que mejor muestra el costo de no tener esta regla.** Si el gate hubiera cumplido
la spec, habría medido `intentos_23514` / `intentos_40P01` contra un barrido que **no distingue
SQLSTATEs**. Para poder afirmarlo habría hecho falta o bien inventarle al código una taxonomía de
errores que no tiene —cambiar el producto para satisfacer al gate—, o bien que el gate contara algo
que él mismo se fabrica. Las dos salidas son peores que el defecto que el gate iba a cazar: la
primera hace que el gate diseñe, la segunda es **ADR-023** en estado puro.

### Decisión

**Una spec de gate es una hipótesis, no un contrato.** Cuando la probe la contradice **midiendo**, la
que se corrige es **la spec**, y la corrección se escribe en la celda del board con el número que la
desmintió al lado.

Tres condiciones, porque sin ellas esto se vuelve la excusa universal para escribir un gate más
débil que el que se pidió:

1. **La contradicción es una medición, no una opinión.** *"Con Postgres real es más lento"* no
   corrige nada. *"Un `tx` falso devuelve las filas en el orden de inserción, así que el `order by`
   no se puede medir ahí"* sí: es una afirmación falsable sobre el código, y se puede ver.
2. **La aserción de fondo no se afloja.** Lo que cambia es **cómo** se mide, nunca **qué** se
   afirma. En T25 la aserción de fondo —*correr el barrido más de una vez y contar filas, sin
   grepear `sweep_attempts` en ningún archivo*— quedó intacta en los tres casos. Un cambio de spec
   que baja la vara no es esta ADR: es una slice que se está rindiendo, y va al LEAD como tal.
3. **La corrección queda escrita, con las dos versiones.** La spec vieja no se borra: se deja al
   lado de la nueva. Una celda que sólo muestra la versión que sobrevivió le enseña al próximo que
   las specs salen bien de primera, que es lo contrario de lo que pasó tres veces.

**Y una consecuencia que va contra el instinto: cumplir la spec al pie de la letra puede ser el
error.** Un gate que satisface una spec equivocada es **exactamente igual de verde** que uno que
mide bien, y encima trae la firma de la aprobación del que la escribió. Es la misma familia de
ADR-020, ADR-021 y ADR-023 —un verde que no afirma nada— con una vuelta más: acá el verde **está
autorizado por escrito**.

### Lo que la medición NO puede ganar — el límite que hace a esta ADR no-circular

**Agregado por el LEAD al ratificar, y es la mitad sin la cual la regla se da vuelta.**

La medición gana **sobre la spec del gate**. Nunca sobre el **invariante de producto que esa spec
sirve**. Son dos cosas distintas y esta ADR sólo habla de la primera:

| | qué es | quién gana si la medición lo contradice |
|---|---|---|
| **la spec** | *cómo* se va a medir: `intentos_23514` / `intentos_40P01`, partir por SQLSTATE | **la medición.** El código no ramifica por SQLSTATE, así que la spec se corrige a `intentos_tras_fallo` / `reintento_tras_recuperarse` |
| **el invariante** | *qué* se afirma: **una fila envenenada no bloquea a las sanas** | **nadie.** Si una probe "contradice" esto, **el que está roto es el código**, no la spec |

**Sin esta línea, ADR-024 se lee como permiso para reescribir la expectativa hasta que dé verde**, que
es la falla más cara que un documento de método puede tener: convertiría el mecanismo que corrige
gates en el mecanismo que los ablanda, con la firma de una ADR arriba.

La prueba de que el límite se respetó en el caso que la disparó: en T25 los tres puntos cambiaron
**cómo** se mide y **ninguno** tocó el qué. La aserción de fondo —*correr el barrido más de una vez y
contar filas, sin grepear `sweep_attempts` en ningún archivo*— salió idéntica de los tres, y es la que
sigue parada entre el head-of-line y un merge.

**La pregunta operativa, para el que tenga la duda en vivo:** *¿el cambio que estoy por hacerle a la
spec deja el defecto original detectable?* Si la respuesta es no, no es esta ADR — es una slice
rindiéndose, y va al LEAD como tal (condición 2 de arriba).

### Por qué no es ADR-020, ADR-021 ni ADR-023

- **ADR-020** ataca *aserción sobre conducta / evidencia sobre un identificador*. Los tres casos de
  la tabla miden conducta.
- **ADR-021** ataca *el sujeto no es el caller*. En los tres el sujeto es el barrido real.
- **ADR-023** ataca *el esperado y el observado tienen el mismo origen*. En los tres el esperado es
  un literal escrito en el shell, en otro archivo y en otro lenguaje.
- Lo que ninguna nombra es **el conflicto entre la aserción y su encargo**. Las tres dan por buena
  la spec y auditan la implementación; acá la que está mal es la spec.

### Lo que esta ADR NO habilita

- **No habilita que el writer del código auditado corrija la spec de su propio gate.** La spec y el
  gate son del LEAD (`CLAUDE.md` §4); quien mide puede **reportar** la contradicción, y en T25 la
  corrección la ejecutó el LEAD.
- **No habilita ablandar el gate por costo de implementación.** Ver la condición 2.
- **No habilita corregir la spec en silencio.** Ver la condición 3.
- **No habilita tocar el invariante de producto que la spec sirve.** Ver §"Lo que la medición NO
  puede ganar". Es el límite que el LEAD agregó al ratificar y el que impide que esta ADR sea
  circular.

### Verificación

`docs/SLICE_BOARD.md` §*"T25 · la spec de la celda estaba equivocada en tres puntos"* y
`docs/TEST_MATRIX.md` §*"Un quinto caso"* llevan la tabla de las dos versiones. La medición que la
sostiene es la línea `MEDIDO cron barrido` y su parseo campo por campo en **V10b** de
`scripts/accept-s6.sh`.

Los tres casos de la clase se releen con `git log -1 4fd230e a0e5fde 10d31b6`: **el mensaje de cada
commit trae la medición que mató a la hipótesis**, que es de dónde salió esta ADR y por qué se puede
auditar sin creerle a este archivo.

### La pregunta que quedaba abierta, contestada por el LEAD

**Estaba escrita acá como pregunta y se resolvió con hashes, no con prosa.** `docs-keeper` objetó que
los tres casos documentados eran de **una sola slice** —los tres puntos de la spec de T25— y que
*"tres casos en tres slices es una clase; tres puntos en una celda puede leerse como una celda mal
escrita"*. El LEAD dio la razón (*"mi frase era imprecisa y tu objeción es correcta"*) y aportó
`4fd230e`, `a0e5fde` y la mitad de V3 de `10d31b6`, más el que **no** hay que citar (`f691daf`).
Están en §"Contexto", verificados uno por uno contra el mensaje de su commit.

**Se deja escrito el intercambio y no sólo el resultado**, porque es el que muestra cómo se usa la
regla de este repo sobre sí misma: la objeción *"no me consta"* de un agente contra una afirmación
del LEAD **valió**, y lo que la cerró fue evidencia verificable, no autoridad. Es la condición 1 de
esta misma ADR aplicada a la ADR.

---

## ADR-025 — La unicidad de la venta la afirma **el motor**, y el `tenant_id` va **adentro** de la clave

- **Estado:** **aceptada · ratificada por el LEAD 2026-08-28.** Redactada por `docs-keeper`; ratificada por el LEAD. Las dos mitades quedan escritas a propósito: `docs-keeper` redacta una decisión que S7 ya ejecutó y commiteó —con su porqué y sus citas— y lo que la vuelve `aceptada` es la ratificación del LEAD. **La separación entre redactar y decidir es la que hace que `CLAUDE.md` §4 funcione**, y borrarla al aceptar sería perder justo el dato: dentro de un mes, un ADR sin esa línea se lee como si el escritor hubiera decidido.
- **Fecha:** 2026-08-28 · **Origen:** S7 (venta manual), commit `6eab611`, migración `packages/db/drizzle/0007_sales_one_sale_per_listing.sql` (`db-agent`)
- **Por qué es una ADR y no una nota operativa:** tiene alternativa descartada con motivo, tiene un precio aceptado que le queda a otro dueño (**P4**), y el próximo escritor de `sales` —un canje que cierra en venta, un import— va a tomar la misma decisión sin leer el código.

### El contexto: la invariante existía y no vivía en la base

*"Una unidad tiene a lo sumo una venta"* la sostenían **dos** cosas hasta S7, y las dos en `apps/web`:

1. `sold` es terminal — `checkTransition` devuelve `terminal_state` desde `sold` (`packages/domain/src/listing-status.ts`), y
2. el `eq(listings.status, from)` que `transitionUnit()` usa como guard de concurrencia (`apps/web/app/(app)/_lib/listings/publish-listing.ts`).

Las dos son buenas capas y se quedan. Lo que faltaba es la afirmación **donde no depende de que el próximo writer la re-derive**. Es la misma doctrina por la que `CLAUDE.md` §2 exige el filtro de tenant en la query **además** de RLS: la máquina de estados es la primera capa, el motor es la última, y la última es la que sigue en pie cuando la primera tiene un bug.

**Medido por `db-agent` contra la base sembrada, antes de escribir la migración:** dos ventas de la misma unidad, mismo tenant, sesión `authenticated` real → **las dos entran**. Después de `0007`, la segunda da `23505`.

### La decisión

`uniqueIndex('sales_one_sale_per_listing').on(tenantId, listingId)` — **el par**, y **reemplaza** a `sales_tenant_listing_idx` en vez de convivir con él.

### Alternativas descartadas

| alternativa | por qué no |
|---|---|
| **`unique (listing_id)` a secas** — más fuerte, y es la que sale primero | Convierte al índice en un **oráculo cruzado**: un tenant que adivina o consigue el `id` de una unidad ajena distingue *"ya vendida"* de *"no vendida"* por el `23505` que recibe, **sin haber leído una fila y sin que RLS se entere** — el error del motor se evalúa antes que cualquier policy de lectura. Con el tenant adentro de la clave, ese insert cruzado no colisiona con nada de nadie |
| **dejar los dos índices** | El nuevo tiene **las mismas dos columnas en el mismo orden**: un btree único no se lee distinto de uno común, sólo verifica de más al escribir. Cubre todo plan que cubría el anterior. Dejar los dos es pagar dos inserciones de índice por fila para servir un único árbol de lectura. **Se buscó antes de borrar, no después:** `sales` no tenía **ninguna** consulta de producción — la tabla nunca tuvo un lector |
| **dejarlo en la máquina de estados** (statu quo) | Es lo que había, y la medición de arriba muestra qué garantizaba: nada, apenas aparece un segundo camino de escritura |

### La regla reusable, que es lo que hay que llevarse de acá

La fila de arriba dice *por qué no* en el caso de `sales`. **El motivo general no es que la venta sea
un dato sensible** — si lo fuera, esta ADR no le serviría a nadie más. Es esto, y aplica a **toda**
tabla de negocio:

> **Un índice único se evalúa antes que cualquier policy de lectura, y no sabe qué es un tenant.**
> El `23505` sale del motor de almacenamiento; RLS filtra **filas que se leen**, y acá no se leyó
> ninguna. Un único que no lleva `tenant_id` adentro de la clave es, por construcción, un canal que
> contesta *"esa fila ajena existe"* a quien la adivine.

Es **la misma clase** que `GRANT` vs RLS, la que `CLAUDE.md` §2 ya cobró con un fallo de slice: dos
capas distintas, evaluadas en **orden distinto**, y la de abajo no sabe nada de tenants. Ahí el
síntoma era `42501` sin `GRANT`; acá es `23505` sin haber leído. En los dos casos el error se produce
**antes** de que la capa que sí entiende de tenants tenga algo que decir.

**Consecuencia operativa, y es la línea que necesita el próximo:** un `unique` sobre una tabla que
tiene `tenant_id` lleva `tenant_id` **adentro de la clave**, salvo que la unicidad sea genuinamente
global (un `id` opaco, un hash content-addressed). Si es global a propósito, se dice por qué en el
schema. **No alcanza con que la policy tape la lectura**: la policy corre después.

### El precio, dicho para que nadie lo descubra después

**La unicidad es por tenant.** Lo que la completaría —que la venta y el listing sean del mismo tenant— **la base hoy no lo ata**: `sales.listing_id` referencia `listings(id)` a secas, sin el tenant en el par. Medido en S7: un tenant puede insertar una venta **propia** apuntando al `listing_id` de **otro** y la policy la acepta, porque el `WITH CHECK` mira `tenant_id` y es el suyo. No filtra datos (todo join contra `listings` lo corta RLS), pero con `on delete restrict` **le clava la unidad al otro tenant**.

Cerrarlo pide FK compuesta contra `listings(tenant_id, id)`, o sea tocar `listings` y pagar un índice único más en la tabla más caliente del producto. **Es la fila `P4` del board**, con `db-agent` de dueño y gate del LEAD — no un cambio que S7 se tomó por su cuenta. El assert correspondiente está **deliberadamente ausente** de `tests/rls-cross-tenant.test.ts` §R9c, con el motivo escrito ahí: fallaría por el motivo correcto, y un rojo permanente con causa conocida enseña a ignorar el archivo entero.

### Lo que hace que la última capa sirva: la venta se escribe adentro de la transacción

`recordSale()` recibe el `tx` como primer parámetro (`apps/web/app/(app)/_lib/sales/record-sale.ts:122`) y se llama con la transacción abierta que mueve el estado (`publish-listing.ts:519`). **La versión "después del commit" de esa línea no existe**, así que el índice único y el guard de concurrencia miran el mismo instante. Dos consecuencias del mismo diseño, ninguna cosmética:

- **el costo no cruza un borde:** `sales.cost_usd` se copia con un **subselect adentro del mismo `INSERT`** (`record-sale.ts:138`), no pasa por el heap de Node; y `margin_usd` es `generatedAlwaysAs(price_usd - cost_usd)`, así que el `insert` **no nombra ninguna de las dos**. Escribir el costo es escribir el margen — por eso no se escribe ninguno.
- **una venta sin sus hechos no compila:** el pedido es una **unión discriminada** sobre el parámetro y no un campo opcional, así que `transitionUnit(actor, id, { to: 'sold' })` no typechequea. Es la misma lección que `CLAUDE.md` y ADR-019 ya pagaron dos veces (el `extras` de S6, el `intent` de S6.1): **un parámetro opcional con default válido no distingue *"no me lo pasaron"* de *"me pasaron que no hay"*.** Acá se lleva un paso más: el estado inválido es **irrepresentable**, no meramente rechazado.

### Verificación

- `bash scripts/accept-s7.sh` §**V4** (el único está en el motor) y §**V6** campo `segunda_venta_de_la_misma_unidad=0`, medido tras **dos** reintentos que rebotan en guardianes **distintos** — el doble submit lo para la máquina de estados (`same_state`), y el estado revertido a `available` la máquina **lo deja pasar**, así que lo único que queda es el índice. La primera versión de la probe hacía sólo el primer caso y **salía verde con el índice borrado** (medido): afirmaba el único sin tocarlo nunca.
- `tests/rls-cross-tenant.test.ts` §**R9f** (`qa-agent`): dos resellers tienen una venta cada uno sobre el **mismo uuid** de unidad —no hay oráculo cruzado— y la segunda del mismo par choca por nombre de índice; además censa que **los únicos índices únicos de `sales` son la PK y el par de D8**.
- `packages/db/src/sales-one-sale-per-listing.test.ts` (`db-agent`, red de regresión del propio paquete; **no** es la auditoría de referencia — `CLAUDE.md` §4).

### Preguntas abiertas que esta ADR **no** cierra

1. **`P4`** — la FK compuesta. Es una decisión de costo sobre `listings` y **es del LEAD**, no de esta ADR.
2. **`P5`** — **estado histórico al ratificar esta ADR (2026-08-28):** ninguna policy de `sales`
   miraba `membership_role`, así que a nivel base un `seller` podía leer `cost_usd` y `margin_usd` de
   su tenant. Esta ADR explicaba por qué el **camino de escritura** no exponía el costo; no cerraba el
   camino de lectura. **Actualización 2026-09-04:** el árbol actual incluye `0012` y `0016`, que
   revocan el `SELECT` directo sensible, dejan allowlists y reservan la lectura financiera a RPC
   owner-only; `seller-authorization.test.ts` prueba seller y owner en las dos polaridades.

---

## ADR-026 — La PII del visitante se parte en **escritura y lectura**: `anon` la escribe y no la lee, y la mitad que importa se sostiene por una **ausencia**

- **Estado:** **aceptada · ratificada por el LEAD el 2026-08-28.** La redactó `docs-keeper`, la ratificó el LEAD, y entre las dos cosas pasaron horas: la separación entre **redactar** y **decidir** se conserva escrita a propósito y no se borra al aceptar. **Escribir una ADR no es decidirla.** El que la redacta pone el porqué y las citas de algo que ya se decidió; si algo no se decidió todavía lo deja como pregunta abierta y lo reporta, nunca lo cierra él. Esa es la línea que hace funcionar `CLAUDE.md` §4 — `ARCHITECTURE.md` y `DECISIONS.md` son de `docs-keeper` desde que cerró FASE 1, **y el LEAD ratifica cada ADR nueva**.
- **Fecha:** 2026-08-28 · **Origen:** S8 (canje), migración `packages/db/drizzle/0008_storefront_tradein_lead_insert.sql` (`db-agent`) y el aflojamiento de la regla `0020` de `packages/db/scripts/rls-lint.mjs` (**LEAD**)
- **Por qué es una ADR y no una nota operativa:** hoy vive **sólo en comentarios de código**, tiene una alternativa descartada con motivo, cambió una regla de gate que este repo trata como innegociable, y **es la primera PII de un tercero del producto** — el próximo escritor de una tabla que reciba datos de un visitante va a tomar esta misma decisión, y sin este archivo la va a tomar de cero.

### El contexto: `tradein_leads` tiene dos mitades que se contradicen si una se afloja

S8 abre la **segunda** escritura sin autenticar del producto. La primera —el beacon de `wa_click_events`,
S4— escribe tres columnas de ancho fijo y **sin PII**. Ésta escribe el **nombre** y el **WhatsApp** de
una persona que no se logueó nunca:

```
`anon` ESCRIBE nueve columnas y sólo esas nueve  ←  lo decide el GRANT de la 0008
`anon` NO LEE ni una                             ←  lo decide la AUSENCIA de un GRANT SELECT
```

Las nueve, exactas: `tenant_id`, `customer_name`, `customer_wa_phone`, `model_text`, `storage_gb`,
`color`, `declared_condition`, `battery_pct`, `notes`. Lo que quedó afuera está enumerado con su
motivo en el `.sql`: `status`, `offer_usd`, `internal_notes`, `created_listing_id`, `handled_by`.

### La decisión

**La prohibición de PII de un tercero para `anon` deja de ser *"no aparece en ningún privilegio"* y
pasa a ser *"no aparece en un privilegio de LECTURA"*.** Es la persona escribiendo su propio nombre
y su propio teléfono —datos que ya tiene— y lo que no puede es leerlos de vuelta: ni los suyos ni,
sobre todo, los de otro.

### Las tres consecuencias, y cada una tapa una forma distinta de que esto se vuelva un agujero

**1. La mitad que más importa del invariante se sostiene por una ausencia, y una ausencia no la ve
ningún lint de policies.**
No hay policy que auditar: `anon` no lee `tradein_leads` porque **nadie le otorgó `SELECT`**. Un
lint que recorre `CREATE POLICY` no tiene sujeto. Por eso la afirmación se construyó en dos lugares
distintos y ninguno de los dos es una policy:

- **`accept-s8.sh` V2 la censa** sobre el **árbol entero de migraciones**: cero `GRANT SELECT` y
  cero policy de `SELECT … TO anon` sobre esa tabla. Censar el árbol entero, y no la `0008`, es el
  punto: una `0010` que otorgue el privilegio tiene que romper este gate.
- **La probe la mide:** `returning_desde_anon=0`, o sea que un `insert … returning` **falla**. Ésa
  es la forma exacta en que la PII del visitante volvería **por la misma puerta por la que entró**,
  sin necesidad de un `select`.

Y hay una cuarta llave que no vive en el `GRANT` ni en la policy: la regla `0026` de `rls-lint`
exige que **ninguna** tabla de `STOREFRONT_WRITE` tenga `GRANT SELECT` a `anon`. Sin eso,
*"prohibido de leer"* sería una promesa escrita en un archivo; con eso, es una que se chequea.

**2. La regla `0020` de `rls-lint` cambió, y el alcance del aflojamiento es la mitad delicada.**
Pasó de *prohibir esas columnas en cualquier `GRANT` a `anon`* a **prohibirlas de leer**. La
excepción se declara con tres llaves puestas:

- **es por `tabla.columna`, no por nombre de columna** — un `customer_name` que aparezca en el
  `GRANT` de **otra** tabla sigue siendo un hallazgo, así que la doctrina de *"se chequea por
  nombre, no por tabla"* se conserva entera para todo lo que no esté en la excepción;
- **es sólo para INSERT** — en un `GRANT SELECT` estas dos columnas siguen prohibidas por las **dos**
  ramas de la regla (`0020` prohibida y `0020` SENSITIVE), que es exactamente el rojo que no se
  quería perder al aflojar;
- **no afloja nada más** — `offer_usd` e `internal_notes` de la misma tabla siguen en
  `NEVER_TO_ANON` **y** en `SENSITIVE_COLUMNS`. Son el costo y las notas del dueño (`CLAUDE.md`
  §0.9), y el visitante ni los escribe ni los lee.

**El arnés llegó con el aflojamiento, no después.** `rls-lint` era **el único de los cinco lints sin
arnés de polaridad**, y `scripts/rls-lint.test.sh` (12 casos, en `ci.yml`) se escribió el mismo día
que se aflojó la regla que audita. Es cuando hace falta: **aflojar sin arnés habría impreso
`rls-lint OK` idéntico si la excepción se llevaba puesta también la lectura.** Los dos casos que
cargan el peso son `GRANT SELECT (customer_name)`, que tiene que quedar rojo, y el mismo nombre de
columna sobre otra tabla, que prueba que la excepción es por `tabla.columna`.

**3. Es la primera PII de un tercero del producto.** Antes, todo lo que entraba a la base era del
**dueño** o de su **stock**: lo tipeaba alguien logueado, sobre cosas suyas. Acá el sujeto de los
datos no es el cliente de MaatWork ni su empleado — es una persona que abrió un link. Tres
consecuencias que no son de esta ADR pero cuelgan de ella y quedan nombradas para que no se
redescubran: en los ToS el reseller es **responsable** de esa base y MaatWork **encargado del
tratamiento**; el chatbot de FASE 5 no puede tener esas columnas en su contexto; y **la segunda de
esas dos ya está afirmada por un test** — `tests/la-pii-del-visitante-no-sale-de-la-fila-del-canje.test.ts`
(`qa-agent`, **16 casos**), que cerró la fila **T43** el 2026-08-28. Hasta ese día lo único que había
era la medición limpia del `adversary-reviewer`, y **medido no es testeado**: una medición dice cómo
está el árbol hoy y no sobrevive al `console.error(body)` que alguien commitea mañana a las once para
debuggear un 500.

#### Cómo lo afirma, que es la mitad transferible

**El test no busca los nombres `customer_name` / `customer_wa_phone` en los sinks: busca por forma.**
Adentro del perímetro del canje, a un sink —`console.*`, `logEvent`, `logError`, Sentry, PostHog,
`JSON.stringify`, `fetch`, `new *Error`, el `metadata:` de `listing_events`— sólo le puede llegar un
literal, una constante literal declarada en el módulo, o un identificador cuya **cola** matchee
`SAFE_ATOM`: `*Id`, `id`/`ids`, `status`, `kind`, `source`, `slug`, `code`, `event`, `count`, `ok`,
`level`. Un identificador pelado, un spread, una llamada anidada o un template con una sustitución
que no sea de esa lista: rojo.

**La diferencia entre las dos formas de escribirlo es la fila entera.** Un test que grepea nombres de
columna lo esquiva cualquiera que escriba `log(lead)`, `log({ ...lead })` o `JSON.stringify(lead)`, y
ése es exactamente el caso que va a pasar: **nadie loguea un campo de PII a propósito — loguea el
objeto**, para debuggear, sin mirar qué trae adentro. Un test que exige forma no se esquiva
renombrando la variable, y de yapa agarra la fuga que todavía no tiene nombre. Ese es el precedente
que le queda al próximo escritor de PII de este repo.

**El precio está declarado y aceptado:** el analizador es **sintáctico**, no hay type checker. No
sabe que `lead` es un `TradeinLead`; sabe que `lead` no es un id ni un literal. Es conservador
**adentro** del perímetro y **ciego afuera**, y la ceguera de afuera se compensa censando
**importaciones** — un lead sale del perímetro sólo por un `import`, y el `import` está en el fuente.

**Y se vio encender.** Ocho fuentes con la fuga plantada, una por forma, más un control negativo con
la forma **real** del `logEvent` de `accept-to-stock`, porque un analizador con falsos positivos se
apaga y un guard apagado no protege a nadie. El LEAD además **mutó el handler real** para verlo
encender nombrando `archivo:línea`, y revirtió byte a byte.

### Alternativas descartadas

| alternativa | por qué no |
|---|---|
| **Que el formulario escriba a través de un endpoint con `service_role`** en vez de darle `INSERT` a `anon` | Mueve el invariante de la base al servidor, que es la dirección contraria a la de todo el resto del repo (`CLAUDE.md` §2: filtro de tenant en la query **además** de RLS). Y el precedente ya existía: el beacon de S4 escribe como `anon` con policy, y esa policy la evalúa el planner en **cada** fila. Un endpoint con `service_role` es una llave maestra en el camino de una escritura anónima |
| **Dejar `0020` como estaba y no marcar `customer_name` / `customer_wa_phone` como SENSITIVE** | Sería resolver el conflicto **borrando la mitad que protege**. Esas dos columnas tienen que seguir prohibidas de lectura para `anon`, y sacarlas de la lista las dejaría sin regla en las dos direcciones |
| **Excepción por nombre de columna** (`customer_name` permitido en cualquier `GRANT`) | Es el aflojamiento que se ve igual de chico y no lo es: le abriría la puerta a cualquier tabla futura que use el mismo nombre. La doctrina de `rls-lint` es *chequear por nombre, no por tabla*, y la excepción es justamente el lugar donde esa doctrina tiene que invertirse |
| **Permitir el `insert … returning` para que el formulario tenga el id del lead** | Es exactamente el vector que `returning_desde_anon` mide. El formulario no necesita el id: contesta con un `303` a `/canje/listo`, y el vínculo con la unidad lo hace el dueño desde el panel |

### Verificación

- `./scripts/accept-s8.sh` → **`S8: ACEPTADA`**, re-ejecutado por el LEAD el 2026-08-28. **V1** el
  `GRANT` son las nueve columnas **por igualdad, no por inclusión** —un `grep -q offer_usd` daría
  verde con el costo adentro— y se lee del `.sql` **commiteado**, no de la base, por la trampa del
  `created_at` de `CLAUDE.md` §3. **V2** es el censo de la ausencia.
- `scripts/probes/s8-canje.test.ts`: `returning_desde_anon=0` · `offer_usd_desde_anon=0` ·
  `lead_a_tenant_ajeno=0` · `lead_sin_claim_no_entra=0` · `canario_rol_anon=1`. **Cada rechazo
  afirma el mensaje, no sólo el código:** `42501` cubre las **dos** capas, así que un test que sólo
  mire el código sigue verde el día que alguien abre el `GRANT` —la policy rechazaría igual— y el
  invariante habría cambiado sin que nada se pusiera rojo.
- `tests/rls-cross-tenant.test.ts` (`qa-agent`): **R6c** afirma las siete policies `TO anon` por
  nombre, que las cinco superficies de lectura sean todas `SELECT`, que las dos de
  escritura-sin-login sean ambas `INSERT`, y que **no exista nada más** — la cuarta es la que caza un
  `FOR ALL` colándose entre las dos listas. **R7c-bis** fija que las únicas columnas sensibles
  escribibles por `anon` son `customer_name` y `customer_wa_phone`.
- `scripts/rls-lint.test.sh`: 12 casos de polaridad, en `ci.yml`.

### Lo que esta ADR NO decide

- **No decidía que a nivel base un `seller` no pudiera leer `offer_usd`.** Durante la medición que
  dio origen a esta ADR **sí podía**: ninguna policy de `tradein_leads` miraba `membership_role`.
  **Actualización 2026-09-04:** P5 quedó cerrado en el árbol actual por `0012` y `0016`; el acceso
  directo sensible está revocado y las lecturas financieras pasan por RPC owner-only, con la
  polaridad afirmada por `seller-authorization.test.ts`.
- **No decide que la policy mire `accepts_trade_in`.** _(**Cerrado el 2026-08-28 por `S8.1`**,
  migración `0009`: el flag entró **adentro** del `WITH CHECK`, vía el primer `ALTER POLICY` del
  repo. Cuando esta ADR se escribió lo chequeaba sólo el `where` del handler. El handler **lo sigue
  chequeando**, y eso es defensa en profundidad, no redundancia a limpiar.)_
- **No decide nada sobre logs ni sobre el prompt del chatbot.** _(La afirmación existe desde el
  2026-08-28 — `tests/la-pii-del-visitante-no-sale-de-la-fila-del-canje.test.ts`, **`T43` cerrada**,
  dueño `qa-agent`. Lo que esta ADR sigue sin decidir es la mitad de **producto**: quién responde por
  esa base y qué se le promete a esa persona. Es `Q5` de `PRODUCT.md` y sigue **abierta**.)_

---
## ADR-027 — `/demo` es un **308 al subdominio del tenant demo**, no un rewrite: la vidriera existe sólo bajo su host
- **Estado:** **aceptada** · **Fecha:** 2026-08-28 · **Ratificada por el LEAD** · redactada por `docs-keeper` · diseño e implementación de `storefront-agent` (**S13**).
- **Alcance:** `apps/web/proxy.ts` y `apps/web/app/(storefront)/_lib/host.ts`. No toca `next.config.ts` ni agrega rutas.

### Contexto

`maat.work/demo` es una URL de marketing: se pega en un mensaje, en un mail o en un estado, y tiene
que llevar a la vidriera del tenant `demo`. Esa vidriera ya tiene URL canónica —`demo.maat.work`—
porque el producto resuelve el tenant **por host** (`resolveHost`), no por path.

La opción cómoda era servirla ahí mismo con un rewrite. **No se puede, y los tres motivos son
independientes**: cada uno alcanza solo para descartarlo.

1. **Todos los links de la vidriera son host-rooted.** `STOREFRONT_HOME_PATH` es `/`, `listingPath()`
   devuelve `/p/{listing}` y `TRADEIN_PATH` es `/canje` — todos relativos al host, porque bajo la
   vidriera el host ya está en la barra. Un rewrite de `/demo` da una grilla renderizada donde
   **ninguna card abre**: los `href` apuntarían a `maat.work/p/…`, que es marketing.
2. **El texto de `wa.me` es byte-exact y termina en `{slug}.maat.work`** (`CLAUDE.md` §1). Bajo
   rewrite, el mensaje que el prospecto manda **mentiría sobre dónde estuvo**, y ese string es un
   gate de aceptación, no una cortesía.
3. **Un `if` por path ANTES de resolver el host es una fuga de tenant.** Es la clase que ya nos
   mordió con `'use cache'` sin host en la clave: ese `if` serviría el demo bajo **cualquier** host,
   con lo cual `acme.maat.work/demo` dejaría de ser una URL de `acme`.

### Decisión

`maat.work/demo` y todo `/demo/**` emiten un **`308` permanente** a `demo.<apex>/…`, desde `proxy.ts`
(`demoAliasRedirect`), y **adentro de la rama `marketing` de `resolveHost`** — nunca arriba de ella.

Dos propiedades hacen el trabajo, y ninguna es opcional:

- **La llamada vive dentro de la rama `marketing`.** Bajo un host de tenant, `/demo` vuelve a ser
  *un path más de ese tenant* y sigue el camino de siempre (`acme.maat.work/demo` → 404 de `acme`).
  La uniformidad es lo que cierra el motivo 3. Se falsificó moviendo la llamada arriba de
  `resolveHost` y viendo encender `app/(storefront)/demo.test.ts`.
- **El host de destino se deriva del host ENTRANTE**, con `tenantHostFor` (en
  `app/(storefront)/_lib/host.ts`), que es la inversa de `resolveHost` y se prueba con un round trip.
  En producción `maat.work → demo.maat.work`; en los e2e `127.0.0.1.nip.io:3100 →
  demo.127.0.0.1.nip.io:3100`. Devuelve `null` donde no hay wildcard (preview de Vercel), y ahí
  `/demo` pasa derecho al 404 de la app: **un `Location` a un host que no existe es peor que un 404.**

El slug y el alias no son strings sueltos: `DEMO_TENANT_SLUG`, `DEMO_ALIAS_PATH`, `isDemoAliasPath()`
y `demoAliasTargetPath()` viven en `_lib/host.ts`, y `demoAliasTargetPath()` **tira** si se la llama
con un path que no es el alias.

### Alternativas descartadas

- **Rewrite** — los tres motivos de arriba.
- **`redirects` de `next.config.ts`** — la doc de `proxy` lo sugiere para un redirect simple, y este
  no lo es: un `destination` fijo rompe `*.nip.io`, `localhost` y los previews, o sea todo lo que no
  sea producción. Y `next.config.ts` es del **LEAD** y decide para las tres caras a la vez (§4).
- **Un `route.ts` que redirija** — lo censaría `guard-firewall.sh`, que barre `apps/web/app` entero,
  y pediría entrada en `config/firewall-rules.json`, que tampoco es la columna de `storefront-agent`.
  Una ruta nueva para no escribir cuatro líneas en el proxy paga con una decisión de WAF.

### Consecuencias — el precio va escrito, no omitido

- **Un round trip extra**, ~150–400 ms en 4G malo. Lo paga el prospecto que entra por el link de
  marketing, una vez.
- **El `308` es permanente y el browser lo cachea**, así que es **difícil de revertir**: el día que
  alguien quiera servir contenido propio en `maat.work/demo` se va a encontrar con browsers que ni
  preguntan. Se acepta porque la alternativa —`307`— renuncia a consolidar las señales de SEO en la
  URL canónica, que es justamente para lo que existe el alias.

### Lo que esta ADR NO decide

- **No decide que `/demo` sea especial bajo un host de tenant.** `demo.maat.work/demo` da 404 y eso
  es correcto: el demo no es especial adentro de su propia vidriera.
- **No decide dónde vive `DEMO_TENANT_SLUG`.** En `HEAD` `733eda2`, la fuente canónica está en
  `packages/domain/src/reserved-slugs.ts` y `(storefront)` la importa. Los tests y gates de **T56** fueron
  verificados por el LEAD. Esto no agrega una decisión nueva ni cambia la frontera de S13.
- **No decide el contenido del demo.** El teléfono del `wa.me` entra por `SEED_DEMO_WA_PHONE` y hoy
  cae en un placeholder: blocker **`B6`**, humano.

### Verificación

- **Hecho:** `apps/web/app/(storefront)/demo.test.ts` — el 308 sobre el objeto `NextResponse`, el
  round trip `resolveHost(tenantHostFor(h, slug))`, la polaridad de la ubicación de la llamada, y las
  tres propiedades que atan el literal `'demo'`.
- **Falta, y lo corre el LEAD:** `scripts/accept-s13.sh` (no existe todavía; `scripts/**` es del
  LEAD), `bash scripts/guard-routes.sh` (requiere `next build`) y un e2e que mida el `308` y el
  `Location` **sobre la red**. Hasta entonces la fila S13 está en `esperando gate`, no en `done`.

---


## Notas operativas — hallazgos que no son ADR

> **Qué es:** hechos verificados que cambian cómo se escribe o se lee algo del repo, pero que **no
> abren ni modifican una decisión de arquitectura**. No llevan número de ADR a propósito: numerarlos
> los volvería reabribles, y no hay nada que reabrir.
> **Para quién:** el que va a escribir o auditar un gate.
> **Cuándo se actualiza:** cuando aparece un hallazgo de esta clase. Lo escribe `docs-keeper`.

### 2026-08-28 · Un gate puede verificar la invocación correcta y aun así afirmar algo falso — quinto caso

> **CERRADO el mismo día, y dejó de ser sólo un hallazgo: es la primera evidencia de ADR-020.** V5
> quedó reducida a lo único estático que sí puede afirmar y el radio se **cuenta** en la **V9** nueva
> de `scripts/accept-s6.sh`. Esta nota se conserva entera porque es el caso que hizo visible la
> familia; **la regla vinculante que salió de él vive en ADR-020**, junto con los otros dos miembros
> (A2 de `accept-s1.sh`, M1 de `accept-s3.sh`) y con el gate que cierra la parte mecánica de la
> clase, `scripts/guard-gates.sh`.

**Hallazgo verificado, no abre decisión.** Este repo ya tenía escritas cuatro formas de gate vacío:
la regla que no puede disparar nunca; el gate satisfecho por un `import` (*"verificar la invocación,
nunca la presencia del símbolo"*); `guard-artifacts.sh` dando `PASS` con cero archivos; y la V8 de
`accept-s6.sh` grepeando el **fuente** y contando dos comentarios como corrida. **Falta una, y es la
más difícil de ver porque el gate hace todo lo que las cuatro reglas anteriores piden.**

`scripts/accept-s6.sh:119-123`:

```
V5 · expirar una reserva invalida la unidad, no la vidriera entera
   grep -rqE 'invalidateStorefrontUnit' "$RES" "${S6_UI[@]}"
```

Verifica una **invocación** —no un import, no un símbolo—, y la invocación **existe**. Y sin embargo,
mientras `invalidateStorefrontUnit()` emitía sus tres tags, **la propiedad que la línea afirma era
falsa**: la función invalidaba la vidriera entera. El gate estuvo verde durante la corrida que aceptó
S6. Lo encontró `cost-auditor` mirando el **cold-hit rate** (~39% contra una alarma de 5%), no un
gate; el detalle está en `SLICE_BOARD.md` §S6.2.

**La forma del error, para reconocerla en otro gate:** la aserción escrita es una propiedad del
**comportamiento** (*"invalida la unidad, no la vidriera entera"*) y la evidencia recogida es la
presencia de un **identificador**. Entre las dos hay un supuesto que nadie declaró: *que el cuerpo de
la función hace lo que su nombre promete.* Es un supuesto razonable y es exactamente el que un
refactor rompe sin renombrar nada.

**Regla práctica que se suma a la de método del board:** cuando la aserción de un gate contiene un
*"no"* —*"no la vidriera entera"*, *"no el catálogo"*, *"sin PII"*— la evidencia **no puede ser un
nombre**, porque un nombre no tiene polaridad. Tiene que ser una medición del efecto, y del lado
donde el "no" se rompería. Acá esa medición existe hoy (`e2e/s6-senar-un-equipo-no-purga-la-vidriera-entera.spec.ts`)
y **la V5 no la citaba**: era evidencia escrita que no sostenía nada. **Corregido el 2026-08-28**:
`accept-s6.sh` corre ese spec (`SPEC_RADIO`) y **V9 lee el número de la corrida**
(`rerender=2 · esperado=2`, con `paginas=5` y `frio=14` como controles anti-vacuidad). Detalle en
ADR-020 §Verificación y en `SLICE_BOARD.md` §S6.2.

### 2026-08-28 · Un gate tiene dos niveles, igual que una regla del WAF — y hasta hoy nadie los separaba

**No es un ADR y no abre ninguna decisión: es un hecho medido que cambia cómo se lee una frase.**
El detalle completo, con los seis casos del día, está en `SLICE_BOARD.md` §"Seis gates rojos o
dormidos, un solo día, una sola familia". Acá va lo que hay que saber para escribir o leer un doc.

```
$ git ls-remote --heads origin      # (sin salida)
$ git rev-list --count HEAD
89
```

`origin` está configurado (`github.com/Gigisanta/iStock-software.git`), `origin/main` figura `gone`,
y **`.github/workflows/ci.yml` no se ejecutó ni una vez en 89 commits.** _Re-medido el 2026-08-28
sobre `68c0bd6`, después del barrido serial de los cinco `accept-*`: **110 commits,
`git ls-remote --heads origin` sigue vacío (exit 0, sin salida).** El snapshot de arriba se deja como
estaba porque es la corrida que motivó esta nota; lo que cambió es sólo el denominador — **21 commits
más de trabajo apoyados en gates que ningún runner limpio ejecutó**, incluidos los tres arreglos de
ADR-020 y `guard-gates.sh`, que entró a `ci.yml:101` sin haber corrido ahí nunca._ Por lo tanto toda frase de
la forma *"corre en CI"* / *"corre en cada push"* en este repo significa, literalmente, **"`ci.yml`
declara el step"**.

**Es la misma distinción que ADR-016 ya fijó para el WAF**, y por eso va acá y no en una ADR nueva:
no hay nada que decidir, hay una palabra que estaba haciendo dos trabajos. En
`config/firewall-rules.json`, `"status": "active"` significa *"el repo declara que la regla debe
estar publicada"*, no que lo esté — y por eso T1 cerró en **nivel 1**. Los gates tienen los mismos
dos niveles:

| nivel | qué afirma | evidencia |
|---|---|---|
| **1 · declarado** | el gate existe, pasa a mano, y tiene step en `ci.yml` | `bash scripts/<gate>.sh` + `grep` en `ci.yml` |
| **2 · ejecutado** | corrió sobre este commit, en Linux, sin la máquina del autor | una corrida de Actions — **hoy: cero** |

**Qué compra el nivel 2, con un caso medido.** `accept-s1.sh` usaba `stat -f %m` y `date -j`, que son
BSD. En `ubuntu-latest` `date -j` falla, pero **`stat -f` no**: en GNU es `--file-system`. El guard
de frescura del build habría comparado basura y salido **verde** (`c854b99`). El modo de falla del
nivel 1 sin nivel 2 no es rojo: es verde.

**Consecuencia editorial, y aplica a todo `docs/**`:** un doc no escribe *"corre en cada push"*
mientras `git ls-remote --heads origin` esté vacío. Escribe *"tiene step en `ci.yml:NN`"*, que es
verificable, o *"declarado en CI, sin ejecutar"*. Las dos frases que decían lo otro
—§Verificación de ADR-016 y la nota del `head()`— quedaron corregidas el 2026-08-28.

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
`_lib.test.sh` que los prueba en las dos polaridades y tiene step propio en CI (`ci.yml:88`).

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

### 2026-09-01 · La cotización ARS es automática y diaria

El formulario de alta deja de pedir **"¿A cuánto tomás el dólar?"**. El sistema obtiene la última
cotización USD publicada por la API pública de Estadísticas Cambiarias del BCRA, sin API key, y la
guarda en `fx_settings` como centavos de ARS por USD. El alta usa esa fuente para que el negocio
nazca con precios completos; el cron de expiración corre cada cinco minutos pero reutiliza una
cotización BCRA cacheada por día, actualiza todos los tenants cuando corresponde y llama a
`invalidateStorefront()` para que grilla y fichas no conserven el valor anterior.

La vidriera no consulta al BCRA: lee el último valor persistido. Si el proveedor falla, los tenants
existentes conservan el último valor bueno y el cron responde `500` para que la falla sea visible;
un alta nueva falla cerrado y no crea precios inciertos. La fuente es oficial, gratuita y no agrega
otro servicio de infraestructura. [API del BCRA](https://www.bcra.gob.ar/apis-banco-central/) y
[manual de Estadísticas Cambiarias](https://www.bcra.gob.ar/archivos/Catalogo/Content/files/pdf/estadisticascambiarias-v1.pdf),
consultados el 2026-09-01.
