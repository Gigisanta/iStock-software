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
| ADR-005 | forma del claim de tenant para RLS (JWT custom vs `memberships`) | R7 |
| ADR-006 | transformación de imágenes: sharp propio vs transform sobre R2 | R2 |
| ~~ADR-007~~ | **cerrada abajo** (R1 PASS) | — |
| ADR-008 | modelo de integración con MP Subscriptions | **R4 PARCIAL — bloqueado en B3, ver plan de sandbox abajo** |
| ADR-009 | representación del resultado ENACOM (enum + link) | R5 |
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
4. Un slug inexistente da **404 real** y cacheable; darlo de alta después **invalida su propio tag**
   (si no, el 404 negativo queda cacheado y la vidriera nace muerta).

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
