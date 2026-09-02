---
name: istock-roles
description: Router de los oficios (subagentes) de iStock. Usar cuando el LEAD despacha un rol o un agente necesita su contrato. Roster, qué escribe cada uno y dónde está su contrato completo.
---

# Roles de iStock

El contrato de cada oficio vive en `.claude/agents/<rol>.md` (fuente única, frontmatter
`name/description/tools`). `references/<rol>.md` es symlink a ese archivo. El workflow
`.claude/workflows/istock-build.js` lo carga por instrucción (`role(name)` →
`cat .claude/agents/<rol>.md`) porque el registry de subagentes se congela al inicio de la sesión.
Reglas comunes, protocolo y formato de retorno: `AGENTS.md`. Ownership: `docs/OWNERSHIP.md`
(manda sobre cualquier contrato que discrepe).

| Rol | Oficio | Escribe en | Nunca hace |
|---|---|---|---|
| `researcher` | verificar hechos técnicos vigentes con fuente y fecha | `docs/research/<topic>.md` (uno por topic) | escribir código |
| `product-scribe` (dormido) | traducir producto a spec accionable | lo que nombre el encargo | decidir stack |
| `architect` (dormido desde FASE 1) | sintetizar research → arquitectura y ADRs | lo que nombre el encargo | implementar |
| `db-agent` | schema Drizzle, migraciones, **RLS**, seed | `packages/db/**` | tocar UI, editar lints |
| `domain-agent` | TS puro: FX, estados, wa payload, DTOs | `packages/domain/**` | I/O, fetch, DB |
| `app-agent` | panel autenticado + API routes | `apps/web/app/(app)/**`, `app/api/**`, `instrumentation.ts` | tocar vidriera |
| `storefront-agent` | vidriera pública, ISR, proxy de host | `apps/web/app/(storefront)/**`, `proxy.ts` | tocar panel |
| `media-agent` | R2, resize, variantes, URLs | `packages/media/**` | subir originales |
| `ai-agent` | chatbot: dieta de contexto, tools, evals | `packages/ai/**` | llamar modelos frontier |
| `billing-agent` | Mercado Pago Subscriptions, entitlements | `apps/web/app/(billing)/**` | Stripe |
| `qa-agent` | Vitest + Playwright + RLS cruzado | `tests/**`, `e2e/**` | arreglar el código bajo test |
| `adversary-reviewer` | romper la slice: seguridad, tenant leak, PII | nada (reporta `PASS`/`FAIL` con evidencia) | aprobar por default |
| `docs-keeper` | mantener `docs/` coherente y sin drift | `docs/**` salvo `research/` y `COST.md` | inventar decisiones |
| `cost-auditor` | gate de costo por slice | `docs/COST.md` | aprobar egress sin número |

## Lo mínimo que el LEAD chequea al recibir cada retorno
- `researcher`: web **hoy**; toda cifra con URL + fecha o `UNVERIFIED`; formato Pregunta → Respuesta
  corta → Detalle → Fuentes → Impacto → Confianza.
- `db-agent`: toda tabla de negocio con `tenant_id not null` + FK + índice + policy RLS; una
  migración = un archivo en git; entrega un test de que tenant A no lee tenant B.
- `domain-agent`: cero imports de `next`, `drizzle`, `fetch`, `process.env`; todo export con test;
  `publicListingDTO` stripea `imei`, `cost_*`, `internal_notes`.
- `media-agent`: nada entra a R2 sin resize (máx 1600px); variantes `thumb/card/detail` con
  presupuesto de bytes; la vidriera nunca recibe la key del original.
- `ai-agent`: ≤1200 tokens in / ≤180 out por turno, `temperature: 0.2`, sin thinking; sólo Gemini
  Flash-Lite y Groq; sanitiza la descripción del listing (prompt injection del dueño).
- `adversary-reviewer`: arranca desde "esto está roto"; checklist tenant leak · IDOR · IMEI/costo
  en payload · secret en cliente · RLS ausente · input sin Zod · costo escondido; sin evidencia
  (path:símbolo o payload) no hay finding.
- `cost-auditor`: toda slice pasa antes de `done`; mide egress, ops R2, filas/conexiones, CPU-ms,
  tokens/día; un `FAIL` bloquea el merge como un test roto.
