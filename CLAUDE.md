# iStock — Constitución del repo

> `iStock` es **nombre código interno** (Getty ocupa la marca). Infra en `*.maat.work`.
> Producto de **MaatWork** (Gio + Tomás, Patagonia). SaaS self-serve para resellers de celulares.

**Una frase:** cargás el stock una vez → tenés vidriera en `{slug}.maat.work` → el visitante llega
informado → abre WhatsApp con el producto ya escrito.

---

## 0. Cómo se trabaja acá

Primitivas, de arriba hacia abajo:

| Primitiva | Qué es | Dónde vive |
|---|---|---|
| Command | entrada humana | `.claude/commands/*.md` |
| Workflow | orquestación determinista (fan-out, olas, gates) | `.claude/workflows/*.js` |
| Subagent | oficio acotado, tools mínimas, **un** directorio | `.claude/agents/*.md` |
| Skill | receta determinista y repetible | `.claude/skills/*/SKILL.md` |

El **LEAD** (sesión principal) es CEO técnico + product owner. **No implementa slices de app.**
Diseña, orquesta, verifica y re-ejecuta los comandos de aceptación.

### Reglas duras

1. **Un writer por archivo/directorio a la vez.** Ver tabla de ownership (§4).
   **Precisión, LEAD, 2026-08-28:** el tope cuenta **writers en paralelo sobre un directorio**,
   no ítems adentro de un encargo. Un encargo con varios ítems al mismo agente es **una** entrada
   en `doing`. Lo levantó `docs-keeper` al encontrar `packages/ai` con dos filas en `doing`
   (`S8.2` y `T50`) y registrarlo sin arbitrarlo, que es lo correcto de su parte. **Se resolvió
   haciendo cierta la regla, no aflojándola:** `S8.2` no tenía a nadie encima, así que se sumó
   al encargo abierto del mismo writer. No es una excepción y no sienta una.
   **Segunda precisión, LEAD, 2026-08-28, y es el modo de falla opuesto:** `doing` marca **un
   writer**, no una pregunta abierta. Una fila cuyo trabajo es *auditar*, *censar* o *decidir*, sin
   nadie editando archivos, va a `todo` o `blocked` — nunca a `doing`. Lo levantó `docs-keeper` al
   ver que `T19` seguía en `doing` sobre `packages/ai` con el árbol limpio, y registrarlo sin
   arbitrarlo. El costo no es cosmético en ninguna de las dos direcciones: un `doing` sin writer
   **reserva un directorio que nadie está usando** —si hubiera significado lo que decía, despachar
   `ai-agent` ese mismo día habría violado esta regla— y al mismo tiempo **hace que el conteo deje
   de medir lo que dice medir**, que es el defecto de la primera precisión visto del otro lado.
   `T19` pasa a `todo`: su trabajo es un censo de `TEST_MATRIX.md` que nadie tomó.
2. Nada es `done` sin (a) artefacto en `/docs` y (b) comando de aceptación que **el LEAD re-ejecuta**.
3. **Dos fallos en la misma slice → STOP y re-plan.** No hay tercer intento a ciegas.
4. Slice = spec en `SLICE_BOARD.md` → test → impl → typecheck/lint/test → adversary → commit.
5. **Stack cerrado** (§3). Proponer otro stack es rechazo automático.
6. **Prohibido en Capa 1:** ARCA/AFIP, WhatsApp Business API, sync MercadoLibre, carrito,
   checkout de ventas del reseller, POS, landing custom en signup, LLM en WhatsApp.
7. Multi-tenant: `tenant_id` + **RLS en toda tabla de negocio**. Sin RLS no hay merge.
8. **IMEI nunca** en vidriera, ni en logs, ni en contexto del chatbot.
9. **Seller no ve costo ni margen.** Nunca. Ni en payload, ni en API, ni en DTO.
10. UI en **español rioplatense**. Código, identificadores y commits en **inglés**.
11. **Mobile-first** panel y vidriera.
12. **COSTO es requisito de aceptación**, no un afterthought. Una slice que sirve fotos por
    Supabase Storage público, o que llama un LLM frontier por pageview, está **mal** aunque funcione.

### Phantom-file guard
Antes de marcar cualquier cosa `done`, el LEAD corre `scripts/guard-artifacts.sh`. **Archivo inexistente o vacío = la tarea no pasó.** Un agente que reporta
"creé X" sin que X exista se trata como fallo de la slice.

### Prefijos de commit
`[research]` `[feat]` `[test]` `[fix]` `[docs]` `[cost]` `[chore]`
Commits chicos. Un concepto por commit.

---

## 1. Producto (NO REABRIR)

- **ICP:** reseller del Alto Valle con 20–200 equipos, oficina + WhatsApp + canje. Nacional después.
- **Tres caras, un tenant:** marketing (`maat.work`) / panel (`/app/*`) / vidriera (`{slug}.maat.work`).
  **La vidriera no tiene DB propia.**
- **Planes:** Trial 14d. Base ~USD 19 (sin chatbot). Negocio ~USD 35 (chat + reservas + margen + 3 puntos de retiro).
- **Landing custom = upsell humano.** En signup **siempre** se crea la genérica.
- **Competencia:** CocosCRM (USD 30, spec de backoffice liviano) · SistemaStock (taller/ARCA, no V1) ·
  Oragon (no clonar) · **Excel + estados de IG = el enemigo real.**
- **Done cobrable:** el dueño carga 15 equipos en una tarde en Cipolletti → pega el link en un estado →
  recibe WhatsApps esa noche.

### Realidad local que el software debe modelar
- **TC (tipo de cambio) lo setea el DUEÑO**, manualmente, por tenant. No hay API de dólar en el hot path.
- **Condiciones:** `sealed` · `open_box` · `tester_a_plus` · `used_excellent` · `used_with_detail`.
- **Canje presencial** (trade-in) como flujo de primera clase.
- **Puntos de retiro** Neuquén / Cipolletti, con horario.
- **Lista para estados de IG/WA** (copy exportable).

### Estados de unidad
`draft → available → reserved → sold`
Laterales: `in_transit` · `in_tradein` · `in_service` · `unavailable`
Reserva 30–120 min + cron de expiración.
**Unidad vs lote desde el día 1.**

### Ficha pública mínima (gate de aceptación, no negociable)
3 fotos reales · condición · GB · color · procedencia · batería % · pantalla original ·
iCloud (texto) · garantía · **USD + ARS** · punto de retiro + horario · medios de pago ·
canje sí/no · badge stock/reserva · **UN** botón `wa.me` con:

> `Hola, vi el iPhone 14 Pro 256 Grafito (usado A) a USD 620 en {slug}.maat.work y lo quiero.`

**Ratificado por el LEAD en FASE 2 (cerrado, no reabrir):**

1. **Dos registros de condición, a propósito.** La ficha dice `usado excelente` (PRODUCT.md); el
   mensaje de WhatsApp dice `usado A` (el string de arriba). No es un bug de consistencia: la ficha
   le habla a un comprador, el mensaje de WA le habla a un reseller y usa su jerga. Son dos mapas
   distintos en `packages/domain` y así se quedan.
2. **Redondeo de FX: techo al millar de ARS** (`ceil_1000`) como default del tenant. Es como se
   publica en la práctica y nunca deja el precio publicado por debajo del USD × TC. Los otros modos
   existen y están testeados; el default se cambia por tenant, no por deploy.
3. **El ARS de la ficha es informativo y la ficha lo dice.** La operación se cierra por WhatsApp.

### Compliance
IMEI + origen + resultado de consulta ENACOM (link + enum) **en el panel**.
**No somos registro oficial.** CABA 295/26 es argumento de venta, no integración.

---

## 2. Prohibiciones que se chequean en review

- `console.log` de un listing completo → rechazo.
- IMEI, `cost_usd`, `margin`, `internal_notes` cruzando a un DTO público → rechazo.
- `TODO: después el RLS` / `TODO: después R2` → rechazo.
- Query sin filtro de tenant *además* de RLS → rechazo (defensa en profundidad).
  Lo sostiene `W015` de `apps/web/scripts/web-lint.mjs`, que deriva las tablas de negocio del
  schema (las que tienen `tenantId`) y mira builder de Drizzle **y** `sql` crudo. **La vara depende
  de la operación:** un `select`/`update`/`delete` se ata por `tenant_id` en el `where`; un `insert` no
  tiene `where` por construcción y se ata por `tenantId` en el `values()` o en la lista de columnas.
  Y **presencia no es filtro**: proyectar `m.tenant_id` o nombrarlo en un `join ... on` no filtra nada.
  Hay preguntas legítimamente cross-tenant —resolver a qué tenant pertenece una sesión es anterior a
  tener tenant—, y para eso está la marca `web-lint:sin-tenant <motivo>`: motivo de 30+ caracteres,
  en una sola línea, **dentro de la declaración de nivel de módulo que contiene la query, o en su
  docblock pegado arriba** (el docblock del módulo no cuenta: los `import` lo separan). El alcance es
  esa declaración, no la cercanía: una marca no excusa a la query de al lado, y **si no se encuentra
  declaración contenedora no hay exención** — sin ancla, FAIL. Una excepción se declara y se explica;
  la alternativa no es "sin excepción", es la excepción invisible, que es lo que la regla vino a matar.
- Secret en el bundle del browser → rechazo.
- `tenant_id` en `user_metadata` de Supabase → rechazo. Va en `app_metadata` (el usuario puede
  escribir `user_metadata`; es escalación de tenant, lint `0015`, severidad ERROR).
- Rate limiting con contador en Postgres sobre la **vidriera** → rechazo: rompe el 95% sin Postgres.
- Tabla nueva sin `GRANT` explícito → **no la lee nadie, y así se queda.** Ratificado por el LEAD en
  FASE 2: la migración revoca los DEFAULT PRIVILEGES de `anon` **y de `authenticated`**, así que una
  tabla nueva nace sin privilegios para los dos y hay que otorgárselos a mano. Una tabla legible por
  todo usuario logueado antes de tener policy es el mismo bug que una legible por `anon`, sólo que
  con menos gente adentro. `service_role` sí conserva sus default privileges: es el rol de los jobs.
- Suponer que `BYPASSRLS` alcanza para leer una tabla → rechazo. **`GRANT` y RLS son dos capas y se
  evalúan las dos:** el `GRANT` decide si podés tocar la tabla, la policy decide qué filas ves.
  Un rol con `BYPASSRLS` y sin `GRANT` recibe `42501` y no lee nada. Costó un fallo de slice en
  FASE 2 y el síntoma no aparece en CI: aparece el día que se prende el cron.
- Imagen original (>500KB) servida a la vidriera → rechazo (`cost-auditor`).
- URL pública de foto que contenga `tenant_id`/`listing_id`, o desde la que se pueda **derivar** la
  key del master → rechazo.
- Master/original en un bucket R2 **público** → rechazo. El master va a `istock-originals`, privado.
- Borrado de un objeto de R2 por key al borrar un listing → rechazo. La key es content-addressed:
  dos tenants pueden compartir el objeto. Se borra el mapeo, no el byte.

---

## 3. Stack (CERRADO)

- **Next.js App Router** + TypeScript `strict` + Tailwind + shadcn/ui. RSC por default,
  `"use client"` sólo donde hay interacción.
- **Supabase:** UN proyecto para todos los tenants. Postgres + Auth + RLS + pgvector. **Spend cap ON.**
- **Drizzle** + migraciones versionadas en git.
  **Trampa medida por `db-agent` en FASE 4 (2026-08-28):** el migrador de Drizzle decide qué
  aplicar comparando **`created_at`, no el hash del archivo**. Si editás una migración después de
  haberla aplicado —típico: `drizzle-kit generate`, correrla, y recién ahí agregarle el guard—, la
  base que ya la tiene **nunca recibe la corrección y `migrate` dice `OK`**. El síntoma es mudo: el
  hash registrado en `drizzle.__drizzle_migrations` no coincide con el del `.sql`, y nadie mira eso.
  No es riesgo de producción (allá se aplica una vez, desde el archivo commiteado); es riesgo de
  **desarrollo**, donde produce dos agentes midiendo contra bases distintas y culpando al código.
  Se detecta con `shasum -a 256` del archivo contra la fila, y se arregla borrando la fila y el
  objeto creado y re-aplicando. **No hay gate para esto y es a propósito:** en CI la base nace
  limpia, así que un guard ahí estaría verde por construcción — un gate que no puede fallar es un
  adorno, y este es de los que enseñan a ignorar los adornos.
- **Fotos: Cloudflare R2** (egress $0). Upload server-side → resize a WebP/AVIF máx 1600px →
  variantes `thumb` / `card` / `detail`. La vidriera sirve `card` (~80–150KB) por CDN de Cloudflare.
  - PROHIBIDO servir originales de 2MB.
  - PROHIBIDO Vercel Image Optimization como default.
  - PROHIBIDO Supabase Storage como CDN público de la vidriera.
- **Vidriera:** ISR / cache de CDN + `revalidateTag('storefront:{slug}')` al mutar stock.
  Objetivo: **95% de los hits no tocan Postgres.**
- **Realtime de Supabase:** sólo panel autenticado. **Nunca** para visitante anónimo.
- **Jobs:** Vercel Cron o Inngest free tier (expirar reservas). **No** worker 24/7.
- **LLM de vidriera:** Gemini 2.5 Flash-Lite primario; **Groq `openai/gpt-oss-20b` fallback**.
  **NUNCA Claude/GPT en el hot path.**
  > Corregido por el LEAD en FASE 1 (R3). `llama-3.1-8b-instant` **está retirado desde el
  > 16/08/2026** para free y developer tier: la línea anterior apuntaba a un modelo muerto.
  > Los IDs van por **env var** (`LLM_PRIMARY_MODEL` / `LLM_FALLBACK_MODEL`), no por constante:
  > hubo dos deprecaciones en tres meses. El fallback está en el camino de ejecución y **testeado**,
  > porque el primario tiene riesgo de apagado en octubre 2026.
  > **Billing habilitado en Gemini desde el día 1** — no es optimización de costo, es privacidad:
  > el free tier entrena con los prompts. **ZDR activado en Groq** antes de producción.
- **Vercel AI SDK** + tools. Embeddings **sólo** en seed/update de `catalog_models`.
- **Pagos SaaS:** Mercado Pago Subscriptions. Preferir débito/transferencia. **No Stripe.**
- Sentry + PostHog (free). Playwright + Vitest. **pnpm**. Deploy Vercel + wildcard `*.maat.work`.
- **Vercel Pro (USD 20/mes) es obligatorio, y no por features: por licencia.** Hobby prohíbe el uso
  comercial, y "advertising the sale of a product or service" es exactamente lo que hace la
  vidriera. Además Hobby no alcanza para las 2 reglas de rate limit que necesitamos.
- **Piso de versiones: Next.js ≥ 16.2.11 y React ≥ 19.2.1.** CVE-2026-64648 (cache confusion) nos
  aplica por ser App Router y **no tiene workaround, sólo upgrade**. Regla de código derivada:
  **nunca reusar un `Request` con un `init` distinto** (`fetch(new Request(init), otroInit)` es el
  disparador). `pnpm audit` bloqueante en CI.

### Rechazo automático
Prisma · Mongo · Firebase · NestJS · schema-per-tenant · un proyecto Supabase por cliente ·
Pinecone · LangChain · Cloudinary pago.

### Monorepo
```
apps/web           Next.js (marketing + panel + vidriera por middleware de host)
packages/db        Drizzle schema, migraciones, RLS policies, seed
packages/domain    TS puro, cero I/O: FX, máquina de estados, wa payload, publicListingDTO
packages/ai        chatbot: prompts, tools, dieta de contexto, evals
packages/media     R2 client + pipeline de variantes
```
Rutas: `/` marketing · `/demo` · `/onboarding` · `/app/*` panel · **`proxy.ts`** (host → vidriera).

> **`middleware.ts` está deprecado desde Next 16.0.0**: el archivo se llama **`proxy.ts`** y exporta
> `proxy`, con runtime Node.js no configurable (poner `runtime` tira error).
> Verificado por el LEAD contra `nextjs.org/docs/app/api-reference/file-conventions/proxy` (v16.3.3,
> 2026-08-25) y el upgrade guide. Codemod: `npx @next/codemod@latest middleware-to-proxy .`
>
> Dos consecuencias que **no** son cosméticas:
> 1. El proxy corre fuera del runtime de la app: *"you should not attempt relying on shared modules
>    or globals"*. Un `Map` a nivel de módulo **no es un cache** ahí. El proxy parsea el host y
>    reescribe; no consulta nada.
> 2. Las Server Functions **no** son rutas propias en la cadena de matchers: un `matcher` que
>    excluye un path también saltea las Server Functions de ese path. Por eso la autorización se
>    verifica **dentro** de cada Server Function y nunca se delega al proxy.

---

## 4. File ownership (un writer por directorio)

| Path | Owner | Nadie más escribe acá |
|---|---|---|
| `packages/db/**` | `db-agent` | ✅ |
| `packages/domain/**` | `domain-agent` | ✅ |
| `packages/media/**` | `media-agent` | ✅ |
| `packages/ai/**` | `ai-agent` | ✅ |
| `apps/web/app/(app)/**`, `apps/web/app/api/**` | `app-agent` | ✅ |
| `apps/web/app/(storefront)/**`, `proxy.ts` | `storefront-agent` | ✅ |
| `apps/web/app/(billing)/**`, webhooks MP | `billing-agent` | ✅ |
| `tests/**`, `e2e/**` | `qa-agent` | ✅ |
| `packages/*/src/**/*.test.ts` (unit del propio paquete) | el owner del paquete | ✅ |
| `docs/**` (excepto `docs/research/**`) | `docs-keeper` | ✅ |
| `docs/research/**` | `researcher` (uno por topic-file) | ✅ |
| `docs/COST.md` | `cost-auditor` | ✅ |
| `CLAUDE.md`, `AGENTS.md`, `.claude/**` | **LEAD** | ✅ |
| `scripts/**`, `vercel.json`, **todo script que un `package.json` corra como `lint`/`guard`/`check`/`verify`/`audit`** (hoy seis: los cinco `*-lint.mjs` más `packages/domain/scripts/purity-check.mjs`) | **LEAD** | ✅ |
| `config/**` (reglas de WAF y demás config de plataforma) | **LEAD** | ✅ |
| `apps/web/instrumentation.ts` | `app-agent` | ✅ |
| `apps/web/next.config.ts`, `apps/web/app/layout.tsx` | **LEAD** | ✅ |

Conflicto de ownership = el LEAD reasigna. Un agente **nunca** edita fuera de su columna.

**Agregado por el LEAD en FASE 4** (hueco real, lo encontró `docs-keeper` al no poder asignar dueño a
dos entradas del board): los **gates no tienen dueño en la tabla y por lo tanto no los tenía nadie**.
`scripts/accept-*.sh`, `scripts/guard-*.sh`, `scripts/probes/**`, las reglas de lint de
`apps/web/scripts/` y `vercel.json` son del LEAD, por un motivo que no
es jerárquico sino de independencia: **el gate no puede ser del mismo writer que el código que
audita.** Por la misma regla, **`config/firewall-rules.json` es del LEAD** (fila nueva, FASE 4):
las reglas de rate limit deciden qué endpoints de `app-agent` y de `storefront-agent` tienen techo,
así que no pueden ser de ninguno de los dos.

**Generalizado a los lints de paquete, LEAD, 2026-08-28, y lo pidió el agente auditado.** La fila
decía `apps/web/scripts/*-lint.mjs`, o sea nombraba **un** lint en vez de la clase, y por ese hueco
`packages/db/scripts/rls-lint.mjs` —el gate que sostiene *"sin RLS no hay merge"*— quedaba adentro
de `packages/db/**`, o sea del mismo writer cuyas policies audita. No es teoría: en esta misma
slice `db-agent` **le agregó una sección** (3b, `ALTER POLICY`) y lo reportó preguntando si le
correspondía. Le correspondía preguntar, y la respuesta es no. **Todo `*-lint.mjs`, viva donde
viva, es del LEAD**, por la misma razón que `scripts/probes/**`: el gate no puede ser del writer
que audita.

El agujero que destapó vale escribirlo porque explica el costo de haberlo tenido: `rls-lint.mjs`
leía sólo `CREATE POLICY`, y `0006` trajo el **primer `ALTER POLICY` del repo**. Medido por el LEAD
sobre el archivo real: con `ALTER POLICY … WITH CHECK (true)` agregado a `0006`, la versión vieja
imprimía `rls-lint OK · 74 policies` y salía **0** — la regla `0007`, la que este archivo nombra
como fallo, tenía una puerta al lado sin cerrar. Con 3b: `exit=1` y
`0007 reservations.reservations_tenant_insert (ALTER) deja WITH CHECK (true)`. Detalle a no
"arreglar": 3b **no** exige `WITH CHECK` en un `ALTER`, porque en Postgres la cláusula omitida
queda como estaba y pedirla sería falso positivo.

El precio del corte está aceptado: `db-agent` escribe policies todo el tiempo y ya no puede
ampliar el lint que las mira. **Pide, no edita** — igual que con los techos del WAF. Un lint que
crece de la mano del código que audita es un lint que nunca lo va a contradecir.

**Y la regla se dejó de apoyar en el nombre del archivo, LEAD, 2026-08-28.** Censé la clase que
ADR-022 dice cubrir y resultó que no la cubre. `find . -name '*-lint.mjs'` devuelve **cinco**
archivos, pero el `lint` de `packages/domain` es **`scripts/purity-check.mjs`**: no termina en
`-lint.mjs`, así que la regla anterior **no lo alcanzaba**, y quedó adentro de `packages/domain/**`
— o sea de `domain-agent`, el writer cuya pureza audita. Es el mismo agujero que ADR-022 vino a
tapar, reabierto un nivel más arriba: **una regla que nombra un sufijo en vez de la clase falla
igual que la que nombraba un archivo.**

**La regla vigente no mira cómo se llama el archivo, mira qué hace:** es del LEAD **todo script que
un `package.json` del repo corra como `lint`, `guard`, `check`, `verify` o `audit`**, además de
`scripts/**` y `scripts/probes/**`. La definición es **censable en un comando**, y ese es el punto:
enumerar los `package.json` da la lista sin que nadie tenga que acordarse de ella. Hoy son seis
— `web-lint.mjs`, `rls-lint.mjs`, `ai-lint.mjs`, `media-lint.mjs`, `qa-lint.mjs`, `purity-check.mjs`.

**No se mudan a `scripts/`, y la alternativa se evaluó.** Mover los seis es editar seis
`package.json` en cinco columnas ajenas y reescribir la resolución de paths de cada uno, todo para
arreglar un problema de **rótulo**. Y no lo arreglaría: `purity-check.mjs` muestra que el fallo no
es *dónde vive el archivo* sino *cómo la regla identifica a su sujeto*. Una regla apoyada en la
ubicación tendría el mismo hueco de sufijo el día que alguien ponga un gate en otro lado. Se quedan
donde están; lo que cambia es que la definición ahora se puede correr.

**Corolario, y es el que hace la diferencia:** esto no puede depender de que un agente haya leído
este párrafo. Va a `guard-gates.sh` — censar los `package.json`, resolver el target de cada script
de gate, y exigir que el archivo declare al LEAD como owner. Un gate nuevo escrito por el writer que
audita tiene que romper **el día que nace**, no la vez que a alguien se le ocurra censar. Fila
**`T28`** del board.

**Y el mismo defecto, un nivel más arriba: la EJECUCIÓN de un gate también se censa. LEAD,
2026-08-28.** `ci.yml` tiene cuatro comentarios distintos contando la misma historia con distinto
nombre — `guard-routes`, `guard-grants`, `accept-fase2` y `accept-fase3` se escribieron, quedaron
afuera del workflow, y estuvieron rojos o vacuamente verdes sin que nadie se enterara;
`accept-fase2` llevaba semanas. Cada vez lo encontró un humano mirando, y cada vez se arregló
agregando **ese** archivo. Cuatro instancias arregladas de a una es la firma de una clase sin gate,
y es literalmente T28 corrido un escalón: allá el *dueño* de un gate se recordaba en vez de
censarse, acá se recuerda la *corrida*.

**Sección `G4` de `guard-gates.sh`:** todo `scripts/accept-*.sh`, `scripts/guard-*.sh` y
`scripts/*.test.sh` tiene que estar **nombrado en `.github/workflows/ci.yml`**, o declarar
`ci-exento: <motivo>` de 30+ caracteres en sus primeras 40 líneas — mismo idioma que
`web-lint:sin-tenant`, y por la misma razón: la alternativa a una exención escrita no es "sin
exención", es la exención invisible, que es exactamente lo que esas cuatro veces fueron. `_lib.sh`
queda afuera del censo a propósito: es librería, y exigirla en CI sería pedir que se ejecute un
archivo que aborta cuando se lo ejecuta. Cero gates censados o `ci.yml` ausente es **FAIL**, no
PASS. Ocho fixtures en `guard-gates.test.sh`, cuatro de ellos viéndolo encender. Fila **`T30`**.

**El rate limit no entra en `vercel.json`.** El archivo **sí existe desde S6** (2026-08-28) y
declara **una sola cosa: el `crons` que dispara `GET /api/cron/expire-reservations` cada 5 min**.
No puede declarar nada más: el schema oficial tiene `additionalProperties: false` en la raíz, así
que sólo admite `$schema` y las claves que él tipa — una clave de más no se ignora, rompe el deploy.
Y el rate limit no es una de ellas: el schema oficial tipa
`routes[].mitigate.action` como enum cerrado `["challenge","deny"]` con `additionalProperties: false`,
y `rate_limit` aparece **cero veces** (verificado contra `openapi.vercel.sh/vercel.json`, 2026-08-28,
`docs/research/vercel-firewall-as-code.md`). Las reglas viven versionadas en `config/firewall-rules.json`
y se aplican por CLI (`vercel firewall rules add` + `publish`), que **no es parte del build**: un
`vercel deploy` **no** sincroniza el WAF. `scripts/guard-firewall.sh` valida el archivo contra los
límites reales de Pro (`keys ⊆ {ip, ja4}` — `header:` es Enterprise —, `algo = fixed_window`,
ventana 10–600 s) y, sobre todo, **censa `apps/web/app` ENTERO** — no `apps/web/app/api`: todo
`route.ts` está cubierto por una regla o exceptuado con motivo escrito. Una ruta nueva sin decidir
rompe el gate el día que se crea. **El alcance ancho es a propósito y esta línea decía lo contrario
hasta el 2026-08-28** (lo marcó `docs-keeper`, lo verifiqué en `guard-firewall.sh:154-168`): la
primera versión del gate censaba sólo `app/api` y por eso **no veía `/_media/[...key]`**, que vive en
el route group `(app)` y es el que sirve los BYTES de las fotos — o sea el de mayor egress del
producto. Un censo que no ve el endpoint más caro es peor que no tener censo: da tranquilidad.
Y una regla que condicione sólo por `host` está **prohibida**: se facturan los *allowed requests*, así
que le cobraría peaje a cada pageview de vidriera — que es exactamente lo que `ARCHITECTURE.md` dice
que no defendemos. Para abuso masivo del HTML la palanca es Attack Challenge Mode, que es gratis. Por eso `scripts/probes/s2-media-measure.test.ts` vive afuera de `packages/media` aunque
mida a `packages/media`, y por eso un agente que quiere cambiar un techo pide, no edita.

**Tres filas nuevas, LEAD, 2026-08-28, y el motivo del corte.** Las levantó `app-agent`: creó
`apps/web/instrumentation.ts` —el hook de bootstrap de Next, donde se cablea el reporter de
incidentes de `@istock/media`— y **no tenía dueño**, porque la tabla cubría `app/(app)/**` y
`app/api/**` pero no la raíz de `apps/web`. Mismo hueco que `app/layout.tsx`, que se había tapado
escribiéndolo el LEAD sin anotarlo, que es tapar sin cerrar.

El corte no es por jerarquía, es por **qué decide cada archivo**. `instrumentation.ts` cablea
observabilidad del server y lee `_lib/env.ts`, que ya es de `app-agent`: partirlo en dos writers
haría que quien agrega una variable de entorno no pueda usarla. Va a `app-agent`.
`next.config.ts` es otra cosa: decide runtime, cache y build **para las tres caras a la vez** —
marketing, panel y vidriera—, así que un writer de una cara ahí decide por las otras dos. Es config
de plataforma, hermana de `vercel.json` y de `config/**`, y va al LEAD por la misma razón que ellas.
`app/layout.tsx` acompaña a `next.config.ts` por ser el shell común de las tres caras.

Corolario que ya aplica: `instrumentation.ts` **no puede** convertirse en el lugar donde una columna
mete efectos que no le corresponden. Es bootstrap, no un patio trasero.

### `architect` es un rol de FASE 1, y está dormido
`docs/ARCHITECTURE.md` y `docs/DECISIONS.md` son de **`docs-keeper`** desde que cerró FASE 1, como
dice la excepción declarada más abajo. `INDEX.md` decía `architect` y el contrato de `docs-keeper`
decía que las decisiones las escribe el `architect`: eran tres fuentes y dos respuestas. **Manda esta
tabla.** El LEAD sigue ratificando los ADRs nuevos; escribirlos no es lo mismo que decidirlos.

**Generalizado por el LEAD el 2026-08-28, porque `architect` no era el único.** `docs-keeper` no
pudo asignar dueño y lo reportó: `.claude/agents/product-scribe.md` reclamaba `docs/PRODUCT.md` y
`docs/DOMAIN.md`, que esta tabla le da a `docs-keeper`. Mismo patrón, otro archivo. La regla que
cierra la clase entera, en vez de este caso: **un contrato de agente puede acotar lo que su dueño
escribe, nunca ampliarlo.** Si `.claude/agents/*.md` y §4 discrepan sobre quién es dueño de un path,
**gana §4** y el contrato está derogado en esa línea hasta que el LEAD lo edite. El motivo no es de
autoridad: dos archivos que se creen dueños del mismo path producen dos writers, y "un writer por
directorio" es la primitiva de la que cuelga todo lo demás. `product-scribe` queda dormido igual
que `architect`; si el LEAD lo despierta, el encargo nombra el archivo y `docs-keeper` no lo toca
mientras dure.

**Corregido por el LEAD en FASE 2.** La fila anterior daba **todo** `**/*.test.ts` a `qa-agent`, y
eso contradecía el contrato de cada agente de paquete, que exige un test por export público. Regla
vigente: **el test unitario de un paquete es del owner del paquete** — nace y muere con el código
que prueba. `qa-agent` es dueño de lo que **cruza** un límite: e2e, RLS contra Postgres real,
tests de integración. Corolario que ya se está aplicando: **`qa-agent` nunca edita el código bajo
test para poner un test en verde**, y el owner del paquete **nunca edita un test de `qa-agent`
para tapar un fallo**. Si el test de `qa-agent` falla, el defecto es del código hasta que se
demuestre lo contrario.

**Desempate, agregado por el LEAD en FASE 4.** Un test puede cumplir las dos descripciones a la vez:
estar *dentro* de un paquete y ser *RLS cruzado contra Postgres real*. **Gana la segunda**, y el
archivo se muda a `tests/`. El motivo es el mismo que separa un gate de su código: `db-agent`
escribe las **policies**, así que no puede ser también el dueño del test que las audita — sería el
mismo writer en las dos puntas del invariante más caro del producto ("sin RLS no hay merge").
Concreto y vigente: `rls-cross-tenant.test.ts` es de **`qa-agent`**. Su encabezado se declara
`db-agent` citando la mitad de arriba de esta regla; ese comentario está **derogado** y se borra en
la mudanza (fila T3 del board). Un test de RLS que sólo mira su propio tenant sí es del paquete.

**Precisión de ese desempate, LEAD, 2026-08-28 (S4).** Tal como quedó escrito arriba, el desempate
es **demasiado ancho**: "cruza tenants → se muda" arrastraría también al test unitario con el que
`db-agent` prueba su propia migración, y eso contradice la mitad de §4 que le da a cada paquete el
test de su código. El defecto es de la regla, no de quien la aplicó. El criterio real no es *si el
test cruza tenants*, es **quién es la auditoría de referencia**: la afirmación que un gate cita y
que queda parada entre una policy aflojada y un merge. Esa es **siempre de `qa-agent` y vive en
`tests/`**. El owner del paquete puede quedarse con casos cruzados como red de regresión propia,
con tres condiciones: (a) la auditoría de referencia existe en `tests/` y es de `qa-agent`;
(b) **ningún gate cita el test del paquete como evidencia** — si lo citara, el writer estaría
firmando su propio certificado; (c) si los dos divergen, **gana el de `tests/`** y el que se
corrige es el del paquete. Concreto y vigente: `packages/db/src/rls-anon-wa-click.test.ts` **se
queda con `db-agent`**; la auditoría de referencia del beacon son R2b/R6c/R7 de
`tests/rls-cross-tenant.test.ts`, de `qa-agent`. `rls-cross-tenant.test.ts` sigue siendo de
`qa-agent`, sin cambios. La duplicación que queda es deliberada y tiene precio: dos archivos que
tocar cuando cambia la policy. Se paga porque las dos puntas del invariante más caro del producto
no pueden ser del mismo writer.

**Excepción declarada, FASE 1:** la síntesis de `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` y
`docs/COST.md` a partir de `docs/research/**` la escribe el **LEAD**, una sola vez. Decidir el
stack no es delegable. Cerrada la FASE 1, esos tres archivos vuelven a `docs-keeper` /
`cost-auditor` y el LEAD sólo ratifica ADRs nuevos.

---

## 5. Calidad

- TS `strict`. **Zod en todos los bordes** (request, webhook, form, env).
- Filtro de tenant explícito en la query **además** de RLS.
- Resize en el upload. Nada de 12MP entrando a la DB o a R2 sin procesar.
- Nada de secrets al browser (`NEXT_PUBLIC_*` se audita a mano).
- Tests: `pnpm typecheck && pnpm lint && pnpm test` verde antes de cualquier commit.

### Una alarma se verifica en las dos polaridades, igual que un gate
**Agregado por el LEAD el 2026-08-28, y lo pagó una alarma que todavía no existe.** `C10` iba a
alarmar con `calls > 2` sobre el turno de chat. Falla **en las dos direcciones a la vez**, que es
lo que la vuelve un caso y no un número mal elegido:

- **Por arriba enciende con tráfico legal.** `T50` bajó el techo a 3, así que el turno degradado
  normal —primario cobra un 200 vacío, contesta el fallback— factura 3 y cruza el umbral. Alarma
  sobre exactamente lo que el diseño contempla.
- **Por abajo no ve el caso patológico.** Lo midió `cost-auditor` y lo verifiqué en el árbol: cuando
  los dos proveedores contestan vacío, el turno pagó dos llamadas y reporta **`calls: 0`**, porque
  `generateWithFallback` acumula en locales y el `throw` las descarta. **Un umbral por arriba no
  puede detectar una medición que se pierde.**

Y el par de instrumentos se mueve en direcciones **opuestas** sobre el mismo evento: el visitante
cuyo turno falló reintenta, así que *mensajes/tenant/día* sube mientras `billed.calls` baja. El
dashboard lee *"más tráfico, menos costo por mensaje"* justo cuando el proveedor se degrada.

**Veredicto: tres condiciones con tres trabajos, no un umbral haciendo tres mal.**
`billed.primaryServedEmpty` es la señal de **degradación** (*el primario cobró y no dio nada*).
`handoff === 'provider_down'` es la señal de **turno quemado**. `calls > MAX_BILLED_CALLS_PER_TURN`
se queda, pero como aserción de **control de flujo** y no como alarma de costo — el docblock de
`chat.ts` ya dice que un turno por encima de ese número *"es un bug de control de flujo, no
tráfico"*. `calls > 2` no mide ninguna de las tres.

La regla general, que es lo que se lleva el que lea esto sin conocer el caso: **una alarma se
prueba encendiéndola con el caso patológico y callándola con el tráfico legal**, igual que
`guard-leaks.test.sh` hace con su gate. Una alarma verificada en una sola polaridad no es una
alarma débil: es independiente de lo que dice medir.

### Un doc cita el símbolo, no el número de línea
**Agregado por el LEAD el 2026-08-28, después de la tercera vez en el mismo día y con tres agentes
distintos.** `cost-auditor` citó `chat.ts:284-286`, yo cité `:338` y `docs-keeper` citó ocho líneas
(`:311`, `:358`, `:364`, `:376`, `:423`, `:426`, `:451`, `:529`): las tres tandas quedaron
apuntando a texto ajeno **dentro de la misma sesión**, porque `ai-agent` estaba editando el archivo.
Ninguno de los tres se equivocó al leer; el archivo se movió abajo de la cita.

**La regla: en `docs/**`, una referencia a código nombra el archivo y el SÍMBOLO** —
`chat.ts`, `addBilled` — **no el número de línea.** Un símbolo sobrevive a que le agreguen 40 líneas
arriba, y **se verifica con un `grep`**, que es lo que lo vuelve gate-able; una línea no se verifica
con nada y envejece en minutos.

Dos precisiones, porque la regla mal leída prohíbe de más:

1. **En un mensaje de commit el número de línea está bien**, y por eso este archivo los usa. Un
   commit queda congelado junto al árbol que describe: la cita y su referente envejecen juntos. Un
   doc vivo no tiene esa propiedad — se lee meses después contra un árbol que siguió.
2. **La regla no es "nunca un número"**, es *"no un número solo"*. `chat.ts` · `addBilled` · `~:500`
   está bien: el símbolo es el ancla y el número es la ayuda para el que scrollea.

**Corolario, y es el mismo de `T28` y `T30`:** esto no puede depender de que alguien se acuerde. Una
cita `archivo.ts:NNN` en `docs/**` es censable, y que el símbolo citado exista en el archivo citado
es un `grep`. Fila **`T55`** del board.

**Tercera precisión, y la escribo porque la produje yo el mismo día: un hash de commit en un doc
tiene el mismo defecto, con una agravante.** Enmendé `9d5d20a` para corregir un mensaje mío que
afirmaba un cambio que el diff no tenía; el commit pasó a ser `1414302` y quedaron **tres citas a
`9d5d20a` en `docs/`** (`INDEX.md`, `SLICE_BOARD.md` ×2). La agravante es cómo falla: `git cat-file
-t 9d5d20a` **contesta `commit`** —el objeto sigue vivo en mi reflog— así que la cita se verifica
perfectamente en la máquina donde se rompió, y muere en un clon o en el primer `gc`.
`git merge-base --is-ancestor` es la pregunta correcta y nadie la hace.

Entonces: **un doc cita un hash sólo si el commit es alcanzable desde `main`**, y el que enmienda es
el que arregla las citas — la enmienda es suya y el costo también. `T55` censa las dos formas: el
`archivo.ts:NNN` sin símbolo y el hash colgante. La segunda es más barata de chequear que la
primera y **no la había visto** hasta que la rompí; queda como recordatorio de que una regla nueva
se prueba contra lo que uno mismo hizo ayer, no sólo contra lo que hicieron los agentes.

## 6. Respuesta al humano (formato del LEAD)

Sin dumps de código. Siempre: **path del workflow · FASE · agentes · artefactos · blockers · próxima acción humana.**
