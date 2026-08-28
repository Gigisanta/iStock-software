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
La **regla**, que es lo único que esta skill fija:

- Quién puede qué se pregunta a **una** función, nunca a `tenant.plan`.
  Prohibido: `if (tenant.plan === 'negocio')` desparramado por la app.
- El catálogo de qué vende cada plan vive en **un** archivo, y la resolución
  (plan + fila de `entitlements` + vigencia del trial) en **otro**. Un catálogo que además
  autoriza es el segundo lugar donde alguien se olvida de mirar `trial_ends_at`.
- **Feature flags** para poder apagar cualquier feature paga sin deploy: la fila explícita
  de `entitlements` gana sobre el plan, en las dos direcciones.
- Una feature con techo numérico (los puntos de retiro) **se cuenta, no se prende**: el
  veredicto positivo lleva el límite adentro.

La **firma** no se transcribe acá a propósito, y la versión anterior de esta línea es el motivo:
declaraba una feature que no existe (`multi_pickup`, se llama `pickup_points`) y un retorno
`boolean` que ya no era el retorno. Una skill que copia una firma es una segunda fuente de verdad,
y la segunda es siempre la vieja. Los tipos vigentes están en:

- `apps/web/app/(billing)/_lib/plans.ts` — catálogo: planes, precios, `BILLABLE_FEATURES`, techos.
- `apps/web/app/(app)/_lib/entitlements.ts` — `featureAccess()`, el resolver que usan las
  Server Actions y las pantallas.
- `apps/web/app/(billing)/_lib/entitlements.ts` — `setFeatureFlag()`, el **único** escritor de la
  tabla, y el resolver con techo y motivo.

## Fin del trial
La vidriera **no** se cae de golpe. La política de degradación la define `docs/PRODUCT.md`
(avisos previos + degradación explícita). No la inventes en el código.

## Nunca
Datos de tarjeta tocando nuestro servidor. Secretos de MP en el cliente. Estado de suscripción
consultado a MP **por request** (vive en `subscriptions`, se actualiza por webhook).

## Aceptación
```
pnpm --filter @istock/web exec vitest run billing
```
Test obligatorio: **el mismo webhook enviado dos veces produce un solo efecto.**
