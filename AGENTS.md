# iStock — contrato del repo

> Nombre código (Getty tiene la marca): SaaS de **MaatWork** para resellers de celulares: cargás el
> stock → vidriera en `{slug}.maat.work` → WhatsApp con el producto escrito. `CLAUDE.md` y
> `apps/web/CLAUDE.md` son symlinks acá. Lo mantiene el **LEAD**.

## 0. Cómo se trabaja acá
Command (`.claude/commands/`) → Workflow (`.claude/workflows/`) → Subagent (`.claude/agents/`, un
oficio, un directorio) → Skill (`.claude/skills/`). El **LEAD** (sesión principal) **no implementa
slices**: diseña, orquesta y re-ejecuta la aceptación.

1. **Un writer por directorio a la vez** (`docs/OWNERSHIP.md`). `doing` = alguien editando.
2. Nada es `done` sin artefacto en `docs/` y comando de aceptación que **el LEAD re-ejecuta**.
3. **Dos fallos en la misma slice → STOP y re-plan.** No hay tercer intento a ciegas.
4. Slice = spec en `docs/SLICE_BOARD.md` → test → impl → typecheck/lint/test → adversary → commit.
5. **Stack cerrado** (§3). Proponer otro es rechazo automático.
6. **Prohibido en Capa 1:** ARCA/AFIP, WhatsApp Business API, sync MercadoLibre, carrito, checkout
   del reseller, POS, landing custom en signup, LLM en WhatsApp.
7. `tenant_id` + **RLS en toda tabla de negocio**. Sin RLS no hay merge.
8. **IMEI nunca** en vidriera, logs ni contexto del chatbot.
9. **Seller no ve costo ni margen.** Ni en payload, ni en API, ni en DTO.
10. UI en **rioplatense**; código, identificadores y commits en **inglés**.
11. **Mobile-first** panel y vidriera.
12. **COSTO es requisito de aceptación**, no un afterthought.

**Phantom-file guard:** `scripts/guard-artifacts.sh` antes de `done`; archivo inexistente o vacío =
no pasó. Commits `[research] [feat] [test] [fix] [docs] [cost] [chore]`, uno por concepto.

## 1. Producto (NO REABRIR)
- **ICP:** reseller del Alto Valle, 20–200 equipos, oficina + WhatsApp + canje.
- **Tres caras, un tenant:** marketing (`maat.work`) / panel (`/app/*`) / vidriera, sin DB propia.
- **Planes:** Trial 14d · Base USD 35 (sin chatbot) · Pro USD 70 (clave interna `negocio`). **Landing custom = upsell
  humano**; en signup se crea la genérica.
- **Competencia:** CocosCRM · SistemaStock · Oragon (no clonar) · **Excel + estados de IG.**
- **Done cobrable:** 15 equipos en una tarde → link en un estado → WhatsApps esa noche.
- **Realidad local:** TC automático 1×/día (BCRA, nada en el hot path). Condiciones `sealed ·
  open_box · tester_a_plus · used_excellent · used_with_detail`. Canje presencial. Retiro
  Neuquén/Cipolletti con horario. Lista exportable para estados.
- **Estados:** `draft → available → reserved → sold`; laterales `in_transit · in_tradein ·
  in_service · unavailable`. Reserva 30–120 min + cron. **Unidad vs lote desde el día 1.**
- **Ficha mínima (gate):** 3 fotos reales · condición · GB · color · procedencia · batería % ·
  pantalla original · iCloud · garantía · **USD + ARS** · retiro + horario · medios de pago · canje
  sí/no · badge stock/reserva · **UN** botón `wa.me`:
  > `Hola, vi el iPhone 14 Pro 256 Grafito (usado A) a USD 620 en {slug}.maat.work y lo quiero.`

  Cerrado: ficha `usado excelente`, WA `usado A` (dos mapas, a propósito). FX redondea **techo al
  millar de ARS** (`ceil_1000`). El ARS es informativo; se cierra por WhatsApp.
- **Compliance:** IMEI + origen + consulta ENACOM **en el panel**. No somos registro oficial.

## 2. Prohibiciones (se chequean en review)
- `console.log` de un listing completo.
- IMEI, `cost_usd`, `margin`, `internal_notes` cruzando a un DTO público.
- `TODO: después el RLS` / `TODO: después R2`.
- Query sin filtro de tenant **además** de RLS (lint `W015`: `tenant_id` en el `where`, o en
  `values()` si es insert; proyectar o joinear no filtra). Excepción sólo con `web-lint:sin-tenant
  <motivo>` (30+ chars, en la declaración que contiene la query); sin ancla, FAIL.
- Secret en el bundle del browser.
- `tenant_id` en `user_metadata` de Supabase → va en `app_metadata` (lint `0015`, ERROR).
- Rate limiting con contador en Postgres sobre la **vidriera**.
- Tabla nueva sin `GRANT` explícito (la migración revoca DEFAULT PRIVILEGES de `anon` **y**
  `authenticated`; `service_role` los conserva).
- Suponer que `BYPASSRLS` alcanza: `GRANT` y RLS son dos capas; sin GRANT → `42501`.
- Imagen original (>500KB) servida a la vidriera.
- URL pública de foto con `tenant_id`/`listing_id`, o de la que se **derive** la key del master.
- Master/original en bucket R2 **público** (va a `istock-originals`, privado).
- Borrar un objeto de R2 por key al borrar un listing (key content-addressed: se borra el mapeo).

## 3. Stack (CERRADO)
| Capa | Decisión |
|---|---|
| App | Next.js App Router **≥16.2.11**, React **≥19.2.1** (CVE-2026-64648; nunca reusar un `Request` con otro `init`), TS `strict`, Tailwind, shadcn/ui, RSC por default. **`proxy.ts`**, no `middleware.ts`: corre fuera del runtime (sin cache de módulo); la autorización va **dentro** de cada Server Function |
| DB | **Neon**, un proyecto para todos los tenants (integración Vercel): Postgres + Neon Auth + RLS; `pgvector` opcional. **Drizzle** + migraciones en git; nunca editar una migración aplicada (el migrador mira `created_at`) |
| Fotos | **Cloudflare R2**, upload server-side → WebP/AVIF máx 1600px → `thumb/card/detail`; la vidriera sirve `card` por CDN. Prohibido: originales, Vercel Image Optimization, storage externo como CDN |
| Vidriera | ISR/CDN + `revalidateTag('storefront:{slug}')` al mutar. **95% de hits sin Postgres.** Sin realtime |
| Jobs | Vercel Cron o Inngest free. **No** worker 24/7 |
| LLM | Gemini 2.5 Flash-Lite primario, Groq `openai/gpt-oss-20b` fallback testeado; IDs por env `LLM_PRIMARY_MODEL`/`LLM_FALLBACK_MODEL`. **Nunca Claude/GPT en el hot path.** Billing Gemini día 1, ZDR en Groq. Embeddings sólo en seed de `catalog_models` |
| Pagos | Mercado Pago Subscriptions (débito/transferencia). **No Stripe** |
| Ops | Sentry + PostHog · Playwright + Vitest · **pnpm** · Vercel **Pro** (Hobby prohíbe uso comercial) · `pnpm audit` bloqueante en CI |

**Rechazo automático:** Prisma · Mongo · Firebase · NestJS · schema-per-tenant · un proyecto
Supabase por cliente · Pinecone · LangChain · Cloudinary pago. **Monorepo:** `apps/web` (tres
caras, vidriera por `proxy.ts`) · `packages/{db,domain,ai,media}`; `domain` es TS puro, cero I/O.

## 4. File ownership
Tabla y desempates en **`docs/OWNERSHIP.md`**. Gates (`scripts/**`, todo
`lint/guard/check/verify/audit` de un `package.json`, `vercel.json`, `config/**`, `next.config.ts`,
`app/layout.tsx`) = LEAD; test unitario = owner del paquete; lo que cruza un límite = `qa-agent`.
Si un contrato de agente y la tabla discrepan, gana la tabla.

## 5. Calidad
TS `strict` · **Zod en todos los bordes** · filtro de tenant además de RLS · resize en el upload
· cero secrets al browser · `pnpm typecheck && pnpm lint && pnpm test` verde antes de commitear.
- **Una alarma se verifica en las dos polaridades:** enciende con el caso patológico, calla con el
  tráfico legal.
- **Un doc cita el símbolo, no el número de línea**; un hash de commit sólo si es alcanzable desde
  `main` (censo `T55`).

## 6. Respuesta al humano (formato del LEAD)
Sin dumps de código. Siempre: **workflow · FASE · agentes · artefactos · blockers · próxima acción
humana.**

## Roles
Roster: `.agents/skills/istock-roles/SKILL.md`. Contrato por oficio:
`.agents/skills/istock-roles/references/<rol>.md` (symlink a `.claude/agents/<rol>.md`, la fuente);
el workflow lo carga con `cat .claude/agents/<rol>.md`.

## Protocolo común (todos)
1. Leé §2, §3 y `docs/OWNERSHIP.md` antes de escribir. 2. Sólo tu directorio. 3. Datos, no prosa;
respetá el `schema` si te dieron uno. 4. Archivos creados con path absoluto y bytes. 5. Un comando
de aceptación por entrega. 6. Dato no verificado = `UNVERIFIED`. 7. Declará el costo (egress,
filas, tokens, CPU). 8. Dos fallos seguidos → parás. 9. Nada que calle >180 s inline: lo corre el LEAD.

```
FILES: <path> (<bytes>), ...
ACCEPTANCE: <comando que el LEAD re-ejecuta>
COST_DELTA: <none | descripción concreta>
UNVERIFIED: <lista o "none">
BLOCKERS: <lista o "none">
```
