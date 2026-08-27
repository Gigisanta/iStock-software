---
name: mp-subscriptions
description: Suscripciones de Mercado Pago para el SaaS - trial 14d, planes base/negocio, webhook idempotente con firma verificada y entitlements como datos. Usar en toda la fase de billing.
---

# mp-subscriptions

Cobramos en Argentina, a resellers. **Mercado Pago Subscriptions. Stripe está prohibido.**

## Fuente de verdad de la API
`docs/research/mp-subscriptions.md` (topic **R4** de FASE 1). La API de MP cambia:
**no implementes de memoria**, seguí el research verificado.

## Planes
| plan | precio ~ | incluye |
|---|---|---|
| `trial` | USD 0, **14 días** | todo |
| `base` | ~USD 19/mes | stock, vidriera, WhatsApp, FX. **Sin chatbot.** |
| `negocio` | ~USD 35/mes | + chatbot, reservas, margen, 3 puntos de retiro |

Preferir **débito automático / transferencia** sobre tarjeta de crédito: es como paga el ICP.

## Webhook — las 4 reglas
1. **Verificar la firma.** Sin validación de origen no se mergea.
2. **Idempotencia en DB**, no en memoria: tabla `webhook_events` con unique sobre el id del evento
   de MP. Evento ya visto → `200 OK` y salir. MP reintenta; procesar dos veces un pago es un incidente.
3. **Responder rápido** (2xx) y hacer el trabajo pesado aparte. Un timeout dispara reintentos.
4. **Nunca confiar en el body** para el estado: revalidar contra la API de MP antes de otorgar acceso.

## Entitlements como datos
Una sola función, consultada desde un solo lugar:
```ts
hasEntitlement(tenant, 'chatbot' | 'reservations' | 'margin' | 'multi_pickup'): boolean
```
Prohibido: `if (tenant.plan === 'negocio')` desparramado por la app.
**Feature flags** para poder apagar cualquier feature paga sin deploy.

## Fin del trial
La vidriera **no** se cae de golpe. La política de degradación la define `docs/PRODUCT.md`
(avisos previos + degradación explícita). No la inventes en el código.

## Nunca
Datos de tarjeta tocando nuestro servidor. Secretos de MP en el cliente. Estado de suscripción
consultado a MP **por request** (vive en `subscriptions`, se actualiza por webhook).

## Aceptación
```
pnpm --filter web test -- billing
```
Test obligatorio: **el mismo webhook enviado dos veces produce un solo efecto.**
