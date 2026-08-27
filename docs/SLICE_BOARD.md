# SLICE_BOARD — estado de la verdad del avance

> Lo mantiene `docs-keeper`. Una slice pasa a `done` **sólo** cuando el **LEAD re-ejecutó**
> su comando de aceptación y el resultado fue verde. Que un agente diga "pasa" no alcanza.

Estados: `todo` · `doing` · `blocked` · `done`
**Regla:** máximo **una** slice en `doing` por directorio owner.

---

## FASE 0 — Harness

| id | título | estado | owner | gate de aceptación | artefacto |
|---|---|---|---|---|---|
| F0.1 | `CLAUDE.md` + `AGENTS.md` | done | LEAD | archivos existen, no vacíos, con ownership table | `CLAUDE.md`, `AGENTS.md` |
| F0.2 | 14 subagents | done | LEAD | `ls .claude/agents/*.md \| wc -l` → 14 | `.claude/agents/` |
| F0.3 | 9 skills | done | LEAD | `ls .claude/skills/*/SKILL.md \| wc -l` → 9 | `.claude/skills/` |
| F0.4 | 4 commands | done | LEAD | `ls .claude/commands/*.md \| wc -l` → 4 | `.claude/commands/` |
| F0.5 | templates de `/docs` | done | LEAD | 9 archivos en `docs/` | `docs/` |
| F0.6 | workflow maestro | done | LEAD | `node --check .claude/workflows/istock-build.js` | `.claude/workflows/istock-build.js` |

## FASE 1 — Research (paralelo + vote adversarial)

| id | topic | estado | archivo |
|---|---|---|---|
| R1 | Wildcard subdominios + ISR en Next/Vercel (2026) | **done** (PASS 1ª vuelta) | `docs/research/wildcard-isr.md` |
| R2 | R2 + transformaciones de imagen vs Cloudflare Images — pricing real | **done** (PASS 2ª vuelta) | `docs/research/r2-images.md` |
| R3 | Gemini Flash-Lite y Groq free tier — IDs exactos y USD/1M | **done** (PASS 2ª vuelta) | `docs/research/llm-pricing.md` |
| R4 | Mercado Pago Subscriptions API Argentina — estado vigente | **PARCIAL — STOP regla 3, bloqueado en B3** | `docs/research/mp-subscriptions.md` |
| R5 | ENACOM — URL y flujo de consulta de IMEI | **done** (PASS 2ª vuelta) | `docs/research/enacom-imei.md` |
| R6 | Catálogo Apple que se vende hoy en AR — líneas y storages | **done** (PASS 2ª vuelta) | `docs/research/apple-catalog-ar.md` |
| R7 | Amenazas: IDOR, scraping, prompt injection en SaaS multi-tenant | **done** (PASS 2ª vuelta) | `docs/research/threats.md` |
| R-syn | Síntesis → `ARCHITECTURE.md` + `DECISIONS.md` + `COST.md` | **done** | LEAD |

**Gate de FASE 1:** cada archivo con fuentes fechadas · sin cifra sin URL (o marcada `UNVERIFIED`) ·
adversary vota cada research · **cero páginas de app escritas**. → **CUMPLIDO.**

**Resultado de FASE 1.** Dos olas: 7 research + 7 adversary (1 PASS, 6 FAIL), después 6 fix + 6
reverify (5 PASS, 1 FAIL). 26 agentes, ~1.9M tokens. **R4 falló dos veces → regla 3, STOP**: no hay
tercera pasada. Causa raíz: sus preguntas abiertas **no son contestables leyendo** (páginas UA-gated
y renderizadas por JS; la adhesión de un CBU sólo se establece intentándola). Se cambió research por
**experimento**: ADR-008 abierta con 4 pruebas de sandbox. Ver el bloque `LEAD OVERRIDE` al tope de
`docs/research/mp-subscriptions.md` con las 5 afirmaciones anuladas. **R4 no bloquea FASE 2/3/4.**

ADRs cerradas: **005** (RLS por claim) · **006** (fotos, 2 buckets) · **007** (wildcard + cache) ·
**009** (ENACOM). Abiertas: **008** (MP, B3) · **010** (región, falta medición).
`docs/COST.md` pasó de todo-`[EST]` a cifras con fuente.

## FASE 2 — Domain + schema (SERIAL, nunca paralelo)

| id | título | estado | owner | gate |
|---|---|---|---|---|
| D1 | `packages/domain` puro + tests | todo | `domain-agent` | `applyFx`, `buildWaMessage`, `canTransition`, `expireReservation`, `publicListingDTO` con test cada uno |
| D2 | schema Drizzle + RLS + migraciones | todo | `db-agent` | toda tabla con `tenant_id` + RLS; conteo tablas == conteo RLS |
| D3 | test RLS cruzado (A no lee B) | todo | `qa-agent` | Postgres real, dos claims, 4 aserciones |
| D4 | seed demo | todo | `db-agent` | 8 iPhones + 2 accesorios + 1 `reserved` |

Entidades: `tenants` `users` `memberships(owner\|seller)` `locations` `catalog_models` `catalog_faqs`
`listings(unit\|lot)` `listing_photos` `listing_events` `fx_settings` `tradein_leads`
`tradein_checklists` `wa_click_events` `sales` `reservations` `subscriptions/entitlements`
`chatbot_threads/messages`.

## FASE 3 — Skeleton

| id | título | estado | owner |
|---|---|---|---|
| K1 | marketing honesta (sin promesas falsas) | todo | `app-agent` |
| K2 | auth + crear tenant + slug | todo | `app-agent` |
| K3 | proxy de host (`proxy.ts`) | todo | `storefront-agent` |
| K4 | layout del panel (mobile-first) | todo | `app-agent` |
| K5 | probe de upload a R2 | todo | `media-agent` |

## FASE 4 — Slices Capa 1 (ORDEN FIJO, no reordenar)

| id | slice | estado | owner | gate de aceptación |
|---|---|---|---|---|
| S1 | host → hello storefront | todo | `storefront-agent` | `{slug}.local` resuelve al tenant; slug inexistente → 404 real |
| S2 | listing unit + fotos R2 con variantes | todo | `media-agent` → `app-agent` | 3 variantes generadas; `card` ≤150KB medido |
| S3 | grilla + ficha mínima | todo | `storefront-agent` | los 15 campos de la skill `storefront-ficha`; cero campos prohibidos en el HTML |
| S4 | botón `wa.me` + tracking de eventos | todo | `domain-agent` → `storefront-agent` | texto exacto byte a byte; evento registrado sin PII |
| S5 | FX → precio en ARS | todo | `domain-agent` → `app-agent` | TC del dueño; redondeo testeado; ARS visible en ficha |
| S6 | reserva + cron de expiración | todo | `app-agent` | reserva 30–120min; cron libera; vidriera revalida |
| S7 | venta manual | todo | `app-agent` | `→ sold`; sale de la grilla; URL directa no rompe |
| S8 | canje: form + inbox + accept-to-stock | todo | `app-agent` | crea unidad en `draft` con costo; seller no ve el costo |
| S9 | copy list para estados de IG/WA | todo | `app-agent` | export con precios y links; cero IMEI |
| S10 | import CSV | todo | `app-agent` | errores por fila; sin import parcial silencioso |
| S11 | roles owner/seller | todo | `app-agent` | seller no recibe `cost_usd` **en el payload**, no sólo en pantalla |
| S12 | onboarding de 15 minutos | todo | `app-agent` | e2e: signup → primer equipo publicado |
| S13 | `/demo` | todo | `storefront-agent` | tenant demo aislado; cero datos reales |

**Cada slice suma al gate:** `adversary-reviewer PASS` + `cost-auditor PASS` ("no agrega costo tonto").

## FASE 5 — Chatbot (post S4/S8)
Capa 2. Se **diseña** en FASE 1, se **codea** después de S4/S8. Ver `docs/CHATBOT.md`.

## FASE 6 — Billing
MP Subscriptions, trial 14d, feature flags, webhook idempotente. Ver skill `mp-subscriptions`.

## FASE 7 — Test matrix
Ver `docs/TEST_MATRIX.md`.

## FASE 8 — README de operador
env · seed · wildcard local (nip.io) · **cómo NO apagar el spend cap**.

## FASE 9 — Guardar workflow + retrospectiva del harness

---

## Blockers abiertos

| # | blocker | bloquea | quién lo destraba |
|---|---|---|---|
| B1 | credenciales de Cloudflare R2 (account id, bucket, access key) | K5, S2 | **humano** |
| B2 | proyecto Supabase + service role key + **spend cap ON** | D2, D3 | **humano** |
| B3 | credenciales de Mercado Pago (**sandbox** + app + webhook secret) | FASE 6, **ADR-008** | **humano** |
| B4 | API key de Gemini y/o Groq | FASE 5 | **humano** |
| B5 | **migrar los nameservers de `maat.work` a `ns1/ns2.vercel-dns.com`** | K3, S1 (prod) | **humano — arrancar ya** |
| B6 | número de WhatsApp del tenant demo | S4, S13 | **humano** |

> **B5 creció en FASE 1 (R1).** El wildcard `*.maat.work` se certifica por DNS-01, y Vercel sólo lo
> emite si el dominio usa **sus** nameservers. No alcanza con un CNAME: hay que mover el DNS
> completo de `maat.work` a Vercel, con **24–48 h de propagación**. Es el blocker con más lead
> time de los seis y no depende de nada nuestro → **conviene arrancarlo antes que B1–B4**, aunque
> se use recién en K3.
> Efecto colateral a mirar antes de apretar el botón: todo registro MX/TXT actual de `maat.work`
> (mail, verificaciones) hay que recrearlo en Vercel o se cae.
