# CHATBOT — capa 2

_**Qué es:** el diseño del chatbot de vidriera — dieta de contexto, tools, handoff, evals y costo
por 1000 mensajes. **Para quién:** `ai-agent` antes de escribir `packages/ai`, y el LEAD al aceptar
FASE 5. **Cuándo se actualiza:** cuando cambia la dieta, una tool, o el costo medido._

_Lo escribe **`docs-keeper`** (`CLAUDE.md` §4: `docs/**` menos `research/` y `COST.md`); el
contenido lo aporta `ai-agent`, cuyo propio contrato dice *"documentá el costo medido … en
`docs/CHATBOT.md` (vía `docs-keeper`)"*. **El header decía `Owner: ai-agent` y era la misma línea
que ya se corrigió en `PRODUCT.md`, `DOMAIN.md`, `ARCHITECTURE.md`, `DECISIONS.md` y
`TEST_MATRIX.md`**: `ai-agent` es dueño de `packages/ai`, no de este archivo. **Se diseña en
FASE 1, se codea después de S4/S8.** Ver skill `chatbot-diet`._

> **Este doc está sin revisar desde FASE 1.** Lo único que se tocó desde entonces es el ID de modelo
> muerto de acá abajo. Todo lo demás es diseño de FASE 1 y hay que releerlo contra
> `docs/research/llm-pricing.md` antes de codear.
>
> **Y ahora urge, porque el código llegó primero: `packages/ai` existe en `main` desde `d42fac9`**
> (fila `T19`). Este archivo decía *"no existe"* hasta el 2026-08-28. La consecuencia práctica no es
> el drift de una línea: es que el diseño de FASE 1 escrito acá **no se re-verificó contra lo que
> `ai-agent` implementó**, así que hasta que alguien lo haga, **manda el código y este doc es una
> hipótesis**. Lo re-verifica `docs-keeper` cuando el árbol se aquiete.

## Qué es y qué no es
El chatbot **no es el producto**. El producto es que el visitante llegue **informado** al WhatsApp
del dueño. El bot existe para **acortar** esa distancia. Un bot que conversa mucho y no deriva es
un bot que falló.

## Dieta (requisito de aceptación, medido)
| ítem | techo |
|---|---|
| tokens in | **1200** |
| tokens out | **180** |
| temperatura | 0.2 |
| thinking | **cero** |
| cache de system + ficha | 60s |

## Contexto — composición exacta
```
system corto (cacheado)
+ publicListingDTO de la ficha abierta
+ 3 chunks del MISMO catalog_model
+ últimos 4 turnos recortados
```
Nada más. Ni el catálogo completo, ni los otros listings, ni el historial entero.

## Modelos
Primario **Gemini 2.5 Flash-Lite** · fallback **Groq `openai/gpt-oss-20b`**.
**Los IDs van por env var** (`LLM_PRIMARY_MODEL` / `LLM_FALLBACK_MODEL`), no por constante:
hubo dos deprecaciones en tres meses (`CLAUDE.md` §3).
IDs y precios exactos: `docs/research/llm-pricing.md` `[R3]`.

_Corregido el 2026-08-28 (drift). Esta línea ofrecía `llama-3.1-8b-instant` como fallback y ese
modelo **está retirado desde el 16/08/2026** para free y developer tier —lo dice la deprecations
page de Groq, con `openai/gpt-oss-20b` como reemplazo recomendado (`llm-pricing.md:151-159`)—.
`CLAUDE.md` §3 ya lo había corregido en FASE 1 (R3) y este doc quedó apuntando a un modelo
muerto. **El fallback está en el camino de ejecución y se testea**, porque el primario tiene
riesgo de apagado en octubre 2026._

**Claude/GPT en hot path = fallo.** Embeddings sólo en el seed del catálogo.

## Tools (tres)
| tool | devuelve | límite |
|---|---|---|
| `get_open_listing` | DTO público de la ficha abierta | — |
| `search_listings` | listings del **mismo tenant** | **máx 5**, campos mínimos |
| `handoff_whatsapp` | corta y deriva | — |

## Handoff obligatorio
reservar · pagar · iCloud · IMEI · envío no configurado · **baja confianza**.
Ante la duda, handoff. Un handoff de más no cuesta nada; una respuesta inventada cuesta un cliente.

## Nunca
costo · margen · IMEI · notas internas · datos de otro tenant · promesas de precio o stock que el
DTO no respalde. Un listing `reserved` **nunca** se describe como disponible.

## Seguridad
La descripción del listing la escribe el **dueño** → **input no confiable**. Se sanitiza y se
delimita antes del prompt; las instrucciones que vengan adentro se ignoran.
Rate limit **8/IP/10min**. Soft cap **40 msgs/tenant/día** → después sólo el botón de WhatsApp.

## Entitlement
Plan `base`: **el widget no existe en el DOM.** Cero paywall mostrado al comprador final — el
comprador no es nuestro cliente y no tiene por qué enterarse de nuestros planes.

## Eval (gate de la fase)
- 50 preguntas reales de compradores del Alto Valle
- jailbreaks de costo e IMEI, en **3 fraseos distintos** cada uno
- prompt injection escondida en la descripción de un listing
- caso `reserved` → no dice "disponible"
- caso "no sé" → handoff, no invención

## Costo
| ítem | valor |
|---|---|
| USD / 1000 mensajes | `[pendiente: medir en FASE 5]` |
| tokens in medidos (p50 / p95) | `[pendiente]` |
| tokens out medidos (p50 / p95) | `[pendiente]` |
| costo/mes de un tenant en el soft cap | `[pendiente]` |

Los cuatro se completan con **medición real**, no con estimación.
