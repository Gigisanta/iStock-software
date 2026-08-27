---
name: chatbot-diet
description: Dieta dura de contexto y costo del chatbot de vidriera - 1200 in / 180 out, 3 tools, handoff a WhatsApp, sanitización anti prompt-injection y evals. Usar en todo cambio de packages/ai.
---

# chatbot-diet

El chatbot **no es el producto**: el producto es que el visitante llegue informado al WhatsApp.
El bot existe para **acortar** esa distancia, no para conversar.

## Presupuesto por turno (requisito de aceptación, medido)
| ítem | techo |
|---|---|
| tokens de entrada | **1200** |
| tokens de salida | **180** |
| temperatura | 0.2 |
| thinking / reasoning | **cero** |

## Composición exacta del contexto
```
system corto (cacheado 60s)
+ publicListingDTO de la ficha abierta
+ 3 chunks del MISMO modelo (nunca de otro modelo, nunca de otro tenant)
+ últimos 4 turnos, recortados
```
**Nada más entra.** No metas el catálogo entero, ni el historial completo, ni los otros listings.

## Modelos
Primario: **Gemini 2.5 Flash-Lite** (o el Lite vigente más barato según `docs/research/llm-pricing.md`).
Fallback: **Groq** `llama-3.1-8b-instant` / `gpt-oss-20b`.
**Claude/GPT en el hot path = fallo.** Embeddings sólo en seed de catálogo.

## Tools (exactamente tres)
- `get_open_listing()` — DTO público de la ficha abierta
- `search_listings(query)` — **máx 5**, campos mínimos
- `handoff_whatsapp(reason)` — corta y manda al humano

## Handoff obligatorio
reservar · pagar · iCloud · IMEI · envío no configurado · **baja confianza**.
Ante la duda: handoff. Un handoff de más cuesta nada; una respuesta inventada cuesta un cliente.

## Nunca en la salida
costo · margen · IMEI · notas internas · datos de otro tenant · promesa de precio o stock que el
DTO no respalde. Un listing `reserved` **nunca** se describe como disponible.

## Seguridad
La descripción del listing la escribe el **dueño** = input no confiable.
Sanitizar + delimitar antes del prompt. Instrucciones dentro de la descripción se ignoran.
Rate limit **8/IP/10min**. Soft cap **40 msgs/tenant/día** → después sólo el botón de WhatsApp.

## Entitlement
Plan **Base: el widget no existe en el DOM.** No se muestra paywall al comprador final —
el comprador no es nuestro cliente y no tiene que enterarse de nuestros planes.

## Evals (gate)
- 50 preguntas reales de compradores
- jailbreaks de **costo** e **IMEI** (el bot no los suelta ni reformulando)
- prompt injection metida en la descripción del listing
- caso `reserved` → no dice "disponible"
- caso "no sé" → handoff, no invención

## Costo
Documentar **USD por 1000 mensajes** medido (no estimado) en `docs/CHATBOT.md`.
