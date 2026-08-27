# DOMAIN — modelo de negocio ejecutable

_Owner: `product-scribe` (reglas) + `domain-agent` (implementación en `packages/domain`)._
_Estado: esqueleto del LEAD en FASE 0. Se completa en FASE 2._

## Glosario
| término | significado en iStock |
|---|---|
| **tenant** | un reseller. Unidad de aislamiento. Todo dato de negocio lleva `tenant_id`. |
| **listing** | algo que se publica. `kind: unit` (con IMEI, uno solo) o `kind: lot` (N iguales, sin IMEI). |
| **unit** | un equipo físico concreto, identificado por IMEI. |
| **lot** | N unidades intercambiables (accesorios, fundas, cargadores). Tiene `qty`. |
| **catalog_model** | modelo Apple **global** (no por tenant). Un listing apunta a uno. |
| **slug** | subdominio del tenant: `{slug}.maat.work`. Inmutable después del signup. |
| **TC / fx rate** | tipo de cambio que **el dueño** define, por tenant. |
| **canje / trade-in** | compra presencial de un equipo usado al cliente. |

## Máquina de estados de `listing`

```
        draft ──publish──> available ──reserve──> reserved ──confirm──> sold
          ▲                    │  ▲                   │
          │                    │  └──expire/cancel────┘
          │                    └──sell_direct────────────────────────> sold
          └──── unpublish ─────┘

Laterales (desde available o draft, y de vuelta):
   in_transit · in_tradein · in_service · unavailable
```

| de | a | guard | efecto |
|---|---|---|---|
| `draft` | `available` | tiene ≥3 fotos, precio USD, condición, modelo | `revalidateTag(storefront:{slug})` |
| `available` | `reserved` | entitlement `reservations`; no hay reserva activa | crea `reservation` con `expires_at`; revalida |
| `reserved` | `available` | `now >= expires_at` (cron) **o** cancelación manual | cierra reserva; revalida |
| `reserved` | `sold` | reserva vigente y del mismo tenant | crea `sale`; revalida |
| `available` | `sold` | — | crea `sale`; revalida |
| `sold` | — | **terminal**. Revertir = evento de corrección auditado, no una transición normal. | |
| cualquiera | lateral | — | sale de la vidriera; revalida |

**Toda** transición escribe en `listing_events` (quién, cuándo, de→a, motivo).
`canTransition(from, to, ctx)` es **exhaustiva**: transición no listada = `false`, no `true` por default.

## FX
```
priceArs = round(priceUsd * tenant.fxRate)
```
- El TC vive en `fx_settings` por tenant, con `updated_at` y quién lo cambió.
- Regla de redondeo: **definir y testear** (propuesta: redondeo a los $1.000 más cercanos hacia
  arriba, porque así se publica en la práctica). `product-scribe` confirma en FASE 2.
- Cambiar el TC **revalida toda la vidriera** del tenant.
- El ARS es **informativo**: la operación real se cierra por WhatsApp. La ficha lo dice.

## Visibilidad por rol
| campo | owner | seller | vidriera / chatbot |
|---|---|---|---|
| `price_usd`, `price_ars` | ✅ | ✅ | ✅ |
| `cost_usd`, margen | ✅ | ❌ **ni en el payload** | ❌ |
| `imei` | ✅ | ✅ (panel) | ❌ **nunca** |
| `internal_notes`, `supplier` | ✅ | ❌ | ❌ |
| resultado ENACOM | ✅ | ✅ (panel) | ❌ |

El filtro del seller ocurre en el **select del server**. Ocultar con CSS o con un `if` en el
componente es un fallo de seguridad, no una decisión de UI.

## `publicListingDTO` — allowlist explícita
```ts
// ALLOWLIST. Agregar un campo acá es una decisión, no un accidente.
{
  id, slug, title, modelDisplayName, storageGb, color, condition,
  batteryPct, screenOriginal, icloudStatusText, warrantyText, provenanceText,
  priceUsd, priceArs, fxRateUsed,
  photos: [{ card, detail, alt }],   // sólo URLs de variante, nunca la key del original
  status,                            // 'available' | 'reserved' | 'sold'
  pickup: [{ name, address, hours }],
  paymentMethods, acceptsTradeIn,
  waUrl,
}
```
**Prohibido para siempre:** `imei` · `cost_usd` · `margin` · `internal_notes` · `supplier` ·
`enacomResult` · `tenantId` interno · `userId` · cualquier timestamp interno.

Test obligatorio: agregar un campo nuevo al modelo de DB **no** debe hacerlo aparecer en el DTO.

## Reservas
`duration ∈ [30, 120]` minutos, default 60. Entitlement `reservations` (plan `negocio`).
`expireReservation(reservation, now)` es **puro** — `now` se inyecta. El cron sólo la invoca.
Al expirar: `reserved → available` + revalidate. Una unidad tiene **como máximo una** reserva activa.

## Mensaje de WhatsApp
Ver skill `wa-payload`. Texto canónico en `CLAUDE.md` §1. Función pura en `packages/domain/wa.ts`.
