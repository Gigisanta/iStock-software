# COST — modelo de costo de infraestructura

_Owner: `cost-auditor`. **Escrito por el LEAD en FASE 1** (excepción declarada en `CLAUDE.md` §4).
Números con fuente salvo los marcados `[EST]` / `[UNVERIFIED]`, que **no** son evidencia._
_Fecha: 2026-08-27. Insumos: R1 (wildcard/ISR), R2 (R2/imágenes), R3 (LLM), R7 (amenazas)._

## Objetivo duro
> **Costo marginal de infra < USD 0.50 / mes por tenant activo, hasta 100 tenants.**

El **piso fijo** se cuenta **aparte** del marginal. No mezclar.

## 0. Conclusión, arriba de todo

**Se cumple, y con margen — pero no por donde parecía en FASE 0.**

| | FASE 0 `[EST]` | FASE 1 (con fuente) |
|---|---|---|
| Marginal plan **Base** | ~USD 0.03 | **USD 0.07** |
| Marginal plan **Negocio** | 0.03 + `[R3]` | **USD 0.24 – 0.30** |
| Headroom del Negocio contra el objetivo | «~15× abajo» | **~1.7×** |

La frase de FASE 0 *«el `base` está ~15× abajo»* era optimista y ya no aplica al plan que importa.
**El chatbot se come el 70–77% del presupuesto de infra del plan Negocio.** No está mal — está
dentro —, pero deja de ser ruido: cualquier cosa que afloje la dieta de contexto o el soft cap sale
directamente de ese margen.

**Y el hallazgo que importa más que todo lo anterior:** con los números de R4, la **comisión de
Mercado Pago (~USD 1.03/mes por cliente pagador `[UNVERIFIED]`) cuesta 3–4× toda la infraestructura
marginal junta.** Estamos optimizando el vector equivocado si miramos sólo infra. Ese número está
**bloqueado en B3** y es el experimento 2 de ADR-008.

## 1. Piso fijo de plataforma
| servicio | plan | USD/mes | estado |
|---|---|---|---|
| Vercel | **Pro** | **20** | **verificado (R7).** Obligatorio **por licencia**, no por features: Hobby prohíbe uso comercial y *"advertising the sale of a product or service"* es exactamente la vidriera. Incluye USD 20 de credit y 1 seat (seat extra: USD 20). |
| Supabase | Pro | ~25 | **`[UNVERIFIED]`** — ver §7 |
| Cloudflare R2 | uso | **0.00 – 0.09** | verificado (R2). Free tier: 10 GB-mes + 1M Class A + 10M Class B |
| Sentry + PostHog | free | 0 | |
| **Total** | | **~45** | |

**El piso domina hasta bien entrado el crecimiento.** Diluido: **USD 2.25/tenant a 20 tenants ·
USD 0.90 a 50 · USD 0.45 a 100.** El marginal recién empieza a importar pasados ~100 tenants.
Contra un plan Base de USD 19 el piso es irrelevante desde el tenant ~3; no es un riesgo de negocio,
es sólo la razón por la que el objetivo está escrito sobre el marginal y no sobre el total.

## 2. Costo marginal por tenant

**Supuestos** (los que no tienen fuente son míos y están marcados; si cambian, cambia todo):
60 listings · 4 fotos/listing · 3 variantes · 3.000 pageviews/mes `[EST]` ·
~120.000 requests/mes/tenant `[EST, R1]` · plan Negocio con el soft cap de **40 msgs/día = 1.200/mes**
(`CLAUDE.md` §3).

| vector | cálculo | USD/mes | fuente |
|---|---|---|---|
| R2 storage + Class A/B | ~140 MB, redondeo al alza de R2 | **~0.001** | R2: USD 0.015/GB-mes |
| R2 egress | **0 por diseño** | **0** | R2: egress Free |
| **ISR Writes** | ~200 mutaciones/mes × 15 write units | **0.012** | R1: USD 4.00/1M units de 8 KB (iad1) |
| ISR Reads | sólo en CDN miss | ~0 | R1: USD 0.40/1M |
| Edge Requests | 10M incluidos ≈ 80 tenants; después USD 2.00/1M | **~0.04** | R1 (iad1) |
| **WAF Rate Limiting** | 120k allowed req/mes × USD 0.50/1M | **0.06** | R7 |
| Postgres | 95% de hits cacheados | ~0 | ADR-007 |
| LLM plan **Base** | **widget ausente** | **0** | `CLAUDE.md` §3 |
| LLM plan **Negocio** | 1.200 msgs × USD 0.000144–0.000192 | **0.17 – 0.23** | R3 |
| **Marginal Base** | | **~USD 0.07** | |
| **Marginal Negocio** | | **USD 0.24 – 0.30** | |

**Las dos líneas que no estaban en FASE 0 y ahora pesan:** el WAF rate limiting (USD 0.06, **12% del
presupuesto** — el precio de no fragmentar el cache filtrando en el edge en vez de en la app) y los
Edge Requests, que **no son gratis pasados ~80 tenants** porque el proxy corre en el 100% de los
pageviews, HIT incluido.

### 2.1 Medido en S1 — la vidriera dejó de ser un supuesto (2026-08-27)

Primera vez que estas líneas se **miden** en vez de estimarse. Método: `next build` + `next start`
(Next 16.3.3, `cacheComponents: true`) contra el Postgres 16 local, contando queries con
`pg_stat_user_tables` sobre `tenants` y leyendo los headers crudos con `curl -D -`.
Se midió **dos veces**: en `6a6513c` (base) y con S1 aplicado, para poder restar.

⚠️ **Es `next start`, no Vercel.** Lo que se mide acá es el comportamiento del runtime de Next
(cuántas queries, cuántos bytes, qué se cachea). Los **precios** siguen siendo los de R1 y el
comportamiento del CDN de Vercel sigue `[UNVERIFIED]` hasta que haya un deploy real.

| qué | cómo se midió | resultado |
|---|---|---|
| **hits de vidriera que tocan Postgres** | 50 GET a un slug tibio | **0 / 50** (base: 0 / 50 también) |
| cache miss frío | 1 GET a un slug nuevo | **1 query**, y ninguna más |
| 404 de slug inexistente | 10 GET seguidos | 1ª: `200` `no-store`; 2ª en adelante: **`404` con `x-nextjs-cache: HIT`**, `s-maxage=2592000, stale-while-revalidate=28944000`, `x-nextjs-stale-time: 300` |
| **tamaño de la entrada de ISR** | `.next/server/app/s/{slug}.*` | html 14.326 B + `_full.segment.rsc` 9.322 B + `_tree` 505 B + meta 333 B ≈ **24,5 KB → ~6 write units de 8 KB** |
| HTML por pageview | mismo tenant, base vs S1 | 14.386 → **14.326 B** (−60 B) |
| **bundle del proxy** (corre en el 100% de los hits, antes del cache) | `.next/server/chunks/[root-of-the-server]__02a5epf._.js` | 214.960 → **216.038 B (+1.078 B)**. Fuentes propias: `proxy.ts`, `domain/wa.ts`, `domain/reserved-slugs.ts` — el barrel de `@istock/domain` **no** arrastró `money`/`reservation` |
| `set-cookie` en `(storefront)` | headers del 200 y del 404 | **ninguna** (apagaría el CDN entero) |

**Dos correcciones al modelo de §2:**
1. Una regeneración cuesta **~6 write units, no 15**. El renglón de ISR Writes estaba sobrestimado
   ~2,5×. No se baja el número de §2 todavía: 15 es el techo conservador y el tamaño de la entrada
   va a crecer cuando la vidriera tenga fichas y fotos (S2). Se re-mide en S2.
2. **La primera visita a un slug, después de cada deploy o de cada invalidación, NO es cacheable**:
   sale en modo *postponed* (`Cache-Control: private, no-cache, no-store`) y es 1 invocación de
   función + 1 query. Recién la segunda queda en ISR. Es el mecanismo exacto por el que se rompe
   el 95%, y ahora está medido en vez de supuesto.

**El % de hits que llega a Postgres, con la aritmética a la vista:**
```
queries/tenant/mes = renders fríos
                   = deploys que reciben visita (30/mes [EST]) + sesiones de mutación visitadas (30/mes [EST])
                   = 60
60 / 3.000 pageviews = 2 %          (alarma: 5 %)
```

### Gate anticipado para S2 (stock): la invalidación tiene que coalescer

S1 llama `invalidateStorefront()` **una vez en la vida del tenant** (el alta), así que su costo es
ruido. S2 lo va a llamar en cada publicar/despublicar/reservar/vender. Con `updateTag` —que es
*read-your-own-writes* y por diseño **no** sirve stale— cada llamada le cobra al próximo visitante
un render bloqueante + 1 query:

```
200 mutaciones/mes/tenant sin agrupar → 200 renders fríos
200 / 3.000 pageviews = 6,7 %  →  POR ENCIMA de la alarma de 5 %
ISR writes: 200 × 6 units × USD 4.00/1M = USD 0.0048/tenant/mes  (la plata no es el problema)
```
El problema no es el gasto, son las **queries a Postgres**: el vector que el objetivo protege.
Mitigación esperada en S2 (no en S1): las mutaciones de una misma sesión de carga colapsan en una
sola invalidación, o se invalida al terminar la tanda. **Cargar 15 equipos tiene que costar 1
regeneración, no 15.** Es gate de `cost-auditor` para S2.

### La decisión de una línea que rompe el objetivo entera
| `cacheLife` | ISR Writes/tenant/mes | contra el objetivo |
|---|---|---|
| `'max'` + invalidación por evento | **USD 0.012** | 2.4% |
| `revalidate: 60` | **USD 2.59** | **518% — reventado** |

`cacheLife` **es una decisión de costo, no de UX** (R1). Un `revalidate: 60` puesto sin pensar
multiplica el costo por 216× y por sí solo tira el objetivo. Gate de `cost-auditor`.

## 3. Techo de LLM a 50 tenants `negocio`
```
50 tenants × 40 msgs/día × 30 días = 60.000 msgs/mes
60.000 × 1.200 tokens in  =  72,0M tokens in
60.000 ×   180 tokens out =  10,8M tokens out
```
**USD 8.64 – 11.52/mes** con `gemini-2.5-flash-lite` (R3). Es **decenas de USD, no cientos**: el
techo de FASE 0 se cumple.

Por tenant Negocio (USD 35 de precio de lista): **0.5–0.7% del ingreso** al soft cap lleno.

**Alerta de presupuesto:** si hay que migrar a `gemini-3.5-flash-lite`, el mismo tráfico cuesta
**USD 48.60/mes (4.2×)** y el chatbot deja de ser ruido en el P&L. Por eso el fallback definido es
Groq `openai/gpt-oss-20b`, **no** el Lite siguiente de Google (R3, ADR-004).

**El riesgo no es el precio unitario.** Es (a) que la dieta de 1200/180 se desborde con reasoning
tokens **no medidos**, y (b) abuso sin rate limit. Se cubren con **instrumentación de tokens reales
por turno** (campos de `usage`, incluidos `cached`/`thought` — no confiar en la estimación) y cap
por tenant en DB. R7 lo llama *el mayor riesgo de costo del producto*: sin el cap de 180 tokens out
**enforced server-side**, una inyección de prompt hace el gasto por pageview ilimitado.

## 4. Escenario de estrés — la vidriera se hace viral un día
50.000 pageviews en 24 h en un tenant:

| vector | efecto |
|---|---|
| Postgres | ~0 **si** el ISR está bien |
| R2 egress | **0** por diseño |
| R2 Class B | ~750k reads → el que más sube, aun así centavos |
| Edge Requests + WAF | ~400k requests → **~USD 1.00 en el día**, el vector real |
| Vercel functions | sólo en misses |
| LLM | acotado por el soft cap de 40 msgs/tenant/día |

**Lo que se rompe primero:** la tasa de hits que llega a Postgres, si una mutación tira el cache en
pleno pico. Por eso el `revalidateTag` es quirúrgico por tenant y nunca un `revalidatePath('/')`.

**Modo de falla nuevo (R1):** **cada deploy invalida el ISR cache** — el key incluye el build ID.
Con 100 tenants y deploys diarios, el pico de writes es proporcional a `tenants × páginas` y deja de
ser gratis. Deployar en pico de tráfico es un evento de costo.

## 5. La métrica a vigilar (una por vector)
| vector | métrica | alarma |
|---|---|---|
| DB | **% de hits de vidriera que llegan a Postgres** | **> 5%** |
| cache | `x-vercel-cache: HIT` ratio en vidriera | cualquier caída sostenida |
| cache | `set-cookie` en respuesta de `(storefront)` | **cualquiera** — apaga el CDN entero |
| imágenes | ratio Class A / fotos procesadas | **> 5** (anomalía, no capacidad) |
| storage | GB por tenant | huérfanos de listings borrados |
| LLM | **tokens reales/turno por tenant** | > 1200 in o > 180 out, o modelo frontier en el log |
| proxy | CPU-ms del proxy por pageview | **> 2 ms**, o cualquier llamada de red |
| edge | Edge Requests/mes | acercarse a 10M (≈ 80 tenants) |

## 6. Fallos automáticos (bloquean merge)
Fotos por Supabase Storage público o Vercel Image Optimization · original >500KB al browser ·
**master en bucket R2 público** · **URL pública con `tenant_id`/`listing_id`** · LLM por pageview o
modelo frontier en hot path · Realtime para anónimos · vidriera pegándole a Postgres en cada hit ·
worker 24/7 en vez de cron · **spend cap de Supabase apagado** · **`revalidate` por tiempo corto en
la vidriera** · **rate limiting con contador en Postgres sobre la vidriera** · `set-cookie`
server-side en la vidriera.

**BotID Deep Analysis (USD 1/1000 llamadas): NO activar preventivamente.** A 10.000 conversaciones/mes
son USD 10/mes — **el 53% del precio de lista de un plan Base**. (Precio, no margen: el margen
unitario del Base no está calculado en ningún artefacto — ver §7.)

## 7. `[UNVERIFIED]` — lo que este documento NO sabe
- **Precio de Supabase Pro.** `supabase.com/pricing` renderiza los precios por JS; el HTML servido no
  los trae (verificado hoy: HTTP 200, 380.979 bytes, sin el monto). **USD 25 es memoria, no fuente.**
  Es la línea más grande del piso fijo. Se confirma en 1 minuto al crear el proyecto → **B2**.
  Sí está verificado, textual, que Supabase trae *"spend cap enabled by default to keep costs under
  control"* — lo que `CLAUDE.md` exige es **no apagarlo**.
- **Comisión de Mercado Pago.** Varía por **tres** cosas: provincia del domicilio, **medio de pago que
  elija el cliente**, y plazo de acreditación. El «piso de USD 1.03/mes» de R4 modela sólo el plazo →
  **no es presupuestable y no se usa como gate.** Experimento 2 de ADR-008, bloqueado en **B3**.
  Repito lo de §0: probablemente sea el costo por tenant más grande del producto.
- **Márgenes unitarios de los planes.** El precio está en `CLAUDE.md` §1; el margen (precio − COGS)
  no está calculado. Toda comparación del tipo *"X es comparable al margen"* es inválida hasta que
  este documento lo publique.
- **Supuestos de tráfico míos, no medidos:** 3.000 pageviews/mes/tenant, ~8 requests/pageview,
  95% de cache hit ratio, tamaños de variante, frecuencia de deploy y de mutación.
  Se miden con la primera vidriera real, no antes. **Casi todas las cifras de §2 dependen de ellos.**
  Bajaron de categoría dos, medidos en S1 (§2.1): el **peso de la página** (14,3 KB de HTML +
  9,3 KB de RSC, sin fotos todavía) y el **hit ratio contra Postgres** (0 queries en 50 hits
  tibios). Lo que sigue sin medirse es **cuántos** hits son tibios en producción.
- **Región de funciones.** `iad1` es 1.6× más barato que `gru1` en ISR y ~7× en Fast Origin Transfer
  (USD 0.06 vs 0.41/GB), pero está más lejos si Supabase queda en `sa-east-1`. Falta la medición de
  latencia real contra el Alto Valle → **ADR-010 abierta**. Todos los números de §2 asumen `iad1`.

## 8. Estado
**FASE 1 cerrada** para los vectores de infra (Vercel, R2, LLM, WAF).
**S1 auditada (2026-08-27): PASS, delta USD 0.00/tenant/mes** — ver §2.1. Aporta las primeras
mediciones reales de la vidriera y el gate anticipado de coalescing para S2.
**Abierto:** precio de Supabase (B2) · comisión de MP (B3, ADR-008) · región (ADR-010) ·
todos los supuestos de tráfico, hasta la primera vidriera real.
