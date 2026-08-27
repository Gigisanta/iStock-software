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
- Secret en el bundle del browser → rechazo.
- `tenant_id` en `user_metadata` de Supabase → rechazo. Va en `app_metadata` (el usuario puede
  escribir `user_metadata`; es escalación de tenant, lint `0015`, severidad ERROR).
- Rate limiting con contador en Postgres sobre la **vidriera** → rechazo: rompe el 95% sin Postgres.
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

Conflicto de ownership = el LEAD reasigna. Un agente **nunca** edita fuera de su columna.

**Corregido por el LEAD en FASE 2.** La fila anterior daba **todo** `**/*.test.ts` a `qa-agent`, y
eso contradecía el contrato de cada agente de paquete, que exige un test por export público. Regla
vigente: **el test unitario de un paquete es del owner del paquete** — nace y muere con el código
que prueba. `qa-agent` es dueño de lo que **cruza** un límite: e2e, RLS contra Postgres real,
tests de integración. Corolario que ya se está aplicando: **`qa-agent` nunca edita el código bajo
test para poner un test en verde**, y el owner del paquete **nunca edita un test de `qa-agent`
para tapar un fallo**. Si el test de `qa-agent` falla, el defecto es del código hasta que se
demuestre lo contrario.

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

## 6. Respuesta al humano (formato del LEAD)

Sin dumps de código. Siempre: **path del workflow · FASE · agentes · artefactos · blockers · próxima acción humana.**
