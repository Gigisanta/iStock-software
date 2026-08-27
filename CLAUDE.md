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
- Imagen original (>500KB) servida a la vidriera → rechazo (`cost-auditor`).

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
- **LLM de vidriera:** Gemini 2.5 Flash-Lite (o el Lite vigente más barato) primario;
  Groq `llama-3.1-8b-instant` / `gpt-oss-20b` fallback. **NUNCA Claude/GPT en el hot path.**
- **Vercel AI SDK** + tools. Embeddings **sólo** en seed/update de `catalog_models`.
- **Pagos SaaS:** Mercado Pago Subscriptions. Preferir débito/transferencia. **No Stripe.**
- Sentry + PostHog (free). Playwright + Vitest. **pnpm**. Deploy Vercel + wildcard `*.maat.work`.

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
Rutas: `/` marketing · `/demo` · `/onboarding` · `/app/*` panel · middleware de host → vidriera.

---

## 4. File ownership (un writer por directorio)

| Path | Owner | Nadie más escribe acá |
|---|---|---|
| `packages/db/**` | `db-agent` | ✅ |
| `packages/domain/**` | `domain-agent` | ✅ |
| `packages/media/**` | `media-agent` | ✅ |
| `packages/ai/**` | `ai-agent` | ✅ |
| `apps/web/app/(app)/**`, `apps/web/app/api/**` | `app-agent` | ✅ |
| `apps/web/app/(storefront)/**`, `middleware.ts` | `storefront-agent` | ✅ |
| `apps/web/app/(billing)/**`, webhooks MP | `billing-agent` | ✅ |
| `tests/**`, `e2e/**`, `**/*.test.ts` | `qa-agent` | ✅ |
| `docs/**` (excepto `docs/research/**`) | `docs-keeper` | ✅ |
| `docs/research/**` | `researcher` (uno por topic-file) | ✅ |
| `docs/COST.md` | `cost-auditor` | ✅ |
| `CLAUDE.md`, `AGENTS.md`, `.claude/**` | **LEAD** | ✅ |

Conflicto de ownership = el LEAD reasigna. Un agente **nunca** edita fuera de su columna.

---

## 5. Calidad

- TS `strict`. **Zod en todos los bordes** (request, webhook, form, env).
- Filtro de tenant explícito en la query **además** de RLS.
- Resize en el upload. Nada de 12MP entrando a la DB o a R2 sin procesar.
- Nada de secrets al browser (`NEXT_PUBLIC_*` se audita a mano).
- Tests: `pnpm typecheck && pnpm lint && pnpm test` verde antes de cualquier commit.

## 6. Respuesta al humano (formato del LEAD)

Sin dumps de código. Siempre: **path del workflow · FASE · agentes · artefactos · blockers · próxima acción humana.**
