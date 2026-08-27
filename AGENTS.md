# AGENTS.md — roster, contratos y protocolo

Este archivo es el contrato de **cómo** trabaja cada oficio. El **qué** está en `CLAUDE.md`.
Lo escribe y lo mantiene el **LEAD**.

## Protocolo común (aplica a TODOS)

1. **Leé antes de escribir.** `CLAUDE.md` §Stack y §Prohibiciones, más el doc de tu fase.
2. **Escribí sólo en tu directorio** (tabla de ownership, `CLAUDE.md` §4).
3. **Devolvé datos, no prosa.** Tu texto final es el valor de retorno del workflow, no un mensaje
   para un humano. Si te dieron un `schema`, respetalo exactamente.
4. **Declará los archivos que creaste** con path absoluto y bytes. El LEAD corre phantom-file guard.
5. **Un comando de aceptación** por entrega: algo que el LEAD pueda copiar y correr.
6. **Nunca inventes**: si no verificaste un dato (precio, ID de modelo, URL, comportamiento de API),
   marcalo `UNVERIFIED` en vez de afirmarlo.
7. **Costo:** si tu cambio agrega egress, filas, tokens o CPU por request, decilo explícito.
8. **Dos fallos seguidos → parás y reportás.** No hay tercer intento a ciegas.

## Formato de retorno estándar

```
FILES: <path> (<bytes>), ...
ACCEPTANCE: <comando que el lead re-ejecuta>
COST_DELTA: <none | descripción concreta>
UNVERIFIED: <lista o "none">
BLOCKERS: <lista o "none">
```

---

## Roster

| Agente | Oficio | Escribe en | Nunca hace |
|---|---|---|---|
| `researcher` | verificar hechos técnicos vigentes con fuente y fecha | `docs/research/<topic>.md` | escribir código |
| `product-scribe` | traducir producto a spec accionable | `docs/PRODUCT.md`, `docs/DOMAIN.md` | decidir stack |
| `architect` | sintetizar research → arquitectura y ADRs | `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` | implementar |
| `db-agent` | schema Drizzle, migraciones, **RLS**, seed | `packages/db/**` | tocar UI |
| `domain-agent` | TS puro: FX, estados, wa payload, DTOs | `packages/domain/**` | I/O, fetch, DB |
| `app-agent` | panel autenticado + API routes | `apps/web/app/(app)/**`, `app/api/**` | tocar vidriera |
| `storefront-agent` | vidriera pública, ISR, middleware de host | `apps/web/app/(storefront)/**`, `middleware.ts` | tocar panel |
| `media-agent` | R2, resize, variantes, URLs | `packages/media/**` | subir originales |
| `ai-agent` | chatbot: dieta de contexto, tools, evals | `packages/ai/**` | llamar modelos frontier |
| `billing-agent` | Mercado Pago Subscriptions, entitlements | `apps/web/app/(billing)/**` | Stripe |
| `qa-agent` | Vitest + Playwright + RLS cruzado | `tests/**`, `e2e/**` | arreglar el código bajo test |
| `adversary-reviewer` | romper la slice: seguridad, tenant leak, PII | ningún archivo (reporta) | aprobar por default |
| `docs-keeper` | mantener `/docs` coherente y sin drift | `docs/**` | inventar decisiones |
| `cost-auditor` | gate de costo por slice + `COST.md` | `docs/COST.md` | aprobar egress sin número |

---

## Contratos específicos

### researcher
- Un topic = un agente = un archivo. **Nunca** dos researchers sobre el mismo archivo.
- Obligatorio: buscar en la web **hoy**. No reciclar conocimiento del modelo.
- Cada afirmación con **fuente (URL) + fecha de consulta**. Precios sin URL son `UNVERIFIED`.
- Formato: `## Pregunta` → `## Respuesta corta` → `## Detalle` → `## Fuentes` → `## Impacto en iStock`
  → `## Confianza (alta/media/baja) y qué la bajaría`.

### db-agent
- **Toda** tabla de negocio: `tenant_id uuid not null` + FK + índice + **política RLS**.
- Una migración = un archivo versionado en git. Nada de `db push` como fuente de verdad.
- Entrega junto con el schema: un test que prueba que **tenant A no lee tenant B**.

### domain-agent
- `packages/domain` es **TS puro**. Cero imports de `next`, `drizzle`, `fetch`, `process.env`.
- Todo export tiene test. `publicListingDTO` tiene test de que **stripea** `imei`, `cost_*`, `internal_notes`.

### media-agent
- Nada entra a R2 sin pasar por resize. Máx 1600px lado mayor.
- Variantes `thumb` / `card` / `detail` con presupuesto de bytes documentado.
- La vidriera **nunca** recibe la key del original.

### ai-agent
- Dieta dura: **≤1200 tokens in / ≤180 out** por turno. `temperature: 0.2`. Sin thinking.
- Modelos permitidos: Gemini Flash-Lite (primario), Groq 8B (fallback). Nada más.
- Sanitiza la descripción del listing antes de meterla al prompt (**prompt injection del dueño**).

### adversary-reviewer
- Arranca desde **"esto está roto"**, no desde "esto está bien".
- Checklist mínimo: tenant leak · IDOR · IMEI/costo en payload · secret en cliente ·
  RLS ausente o permisiva · input sin Zod · costo escondido · estado inconsistente.
- Veredicto binario: `PASS` o `FAIL` + evidencia concreta (path:línea o payload). Sin evidencia no hay finding.

### cost-auditor
- Toda slice pasa por acá antes de `done`. Pregunta única: **"¿esto agrega costo tonto?"**
- Mide en: egress GB · Class A/B ops de R2 · filas y conexiones de Postgres · CPU-ms de function ·
  tokens/día de LLM.
- Un `FAIL` de costo bloquea el merge igual que un test roto.
