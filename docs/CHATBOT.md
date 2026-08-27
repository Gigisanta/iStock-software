# CHATBOT — capa 2

_Owner: `ai-agent`. **Se diseña en FASE 1, se codea después de S4/S8.** Ver skill `chatbot-diet`._

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
Primario **Gemini 2.5 Flash-Lite** · fallback **Groq** (`llama-3.1-8b-instant` / `gpt-oss-20b`).
IDs y precios exactos: `docs/research/llm-pricing.md` `[R3]`.
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
