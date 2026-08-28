# DOMAIN — modelo de negocio ejecutable

_**Qué es:** el modelo de negocio en su forma ejecutable — glosario, máquina de estados, FX,
visibilidad por rol y el `publicListingDTO`. **Para quién:** cualquiera que vaya a escribir una regla
de negocio, antes de escribirla. **Cuándo se actualiza:** con cada slice que toca reglas de negocio._

_Owner: **`docs-keeper`** por `CLAUDE.md` §4 (`docs/**` menos `research/` y `COST.md`).
`domain-agent` es dueño de la **implementación** en `packages/domain`, no de este archivo._

> ⚠ **Conflicto de ownership abierto, levantado el 2026-08-28 — lo resuelve el LEAD, no este doc.**
> `CLAUDE.md` §4 da `docs/**` a `docs-keeper`; `INDEX.md` daba este archivo a `product-scribe`; y
> `.claude/agents/product-scribe.md:11` dice *"escribís sólo en `docs/PRODUCT.md` y
> `docs/DOMAIN.md`"*. **Tres fuentes, dos respuestas** — exactamente la misma forma que el conflicto
> de `architect` sobre `ARCHITECTURE.md`/`DECISIONS.md`, que el LEAD cerró en FASE 4 a favor de la
> tabla de §4. Mientras no se decida, **manda `CLAUDE.md` §4** (regla escrita en el propio §4:
> *"conflicto de ownership = el LEAD reasigna"*). `.claude/**` es del LEAD y no se toca desde acá.

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
| `draft` | `available` | tiene ≥3 fotos, precio USD, condición, modelo | `invalidateStorefrontUnit` |
| `available` | `reserved` | entitlement `reservations`; no hay reserva activa | crea `reservation` con `expires_at`; `invalidateStorefrontUnit` |
| `reserved` | `available` | `now >= expires_at` (cron) **o** cancelación manual | cierra la reserva **con el estado que dice el dominio** (ver §Reservas); `invalidateStorefrontUnit` |
| `reserved` | `sold` | reserva vigente y del mismo tenant | cierra la reserva como `confirmed`; crea `sale`; `invalidateStorefrontUnit` |
| `available` | `sold` | — | crea `sale`; `invalidateStorefrontUnit` |
| `sold` | — | **terminal**. Revertir = evento de corrección auditado, no una transición normal. | |
| cualquiera | lateral | — | sale de la vidriera; cierra la reserva si venía de `reserved`; `invalidateStorefrontUnit` |

**El efecto de vidriera es `invalidateStorefrontUnit`, no `revalidateTag('storefront:{slug}')`, y la
diferencia es de costo, no de estilo** (corregido el 2026-08-28, S6.2): purgar por tag de tenant
tiraba abajo **las 61 páginas** de un tenant de 60 equipos para que cambiara una. La topología
completa —quién registra qué tag, y por qué el camino de miss de la ficha es asimétrico— está en
`ARCHITECTURE.md` §"Quién registra qué tag". `packages/domain` **declara** los efectos
(`transitionEffects`); `apps/web` los **ejecuta**.

**Toda** transición escribe en `listing_events` (quién, cuándo, de→a, motivo).
`canTransition(from, to, ctx)` es **exhaustiva**: transición no listada = `false`, no `true` por default.

## FX
```
priceArs = round(priceUsd * tenant.fxRate)
```
- El TC vive en `fx_settings` por tenant, con `updated_at` y quién lo cambió.
- **Regla de redondeo: `ceil_1000` — techo al millar de ARS — es el default del tenant.** No es
  propuesta: lo ratificó el LEAD en FASE 2 (`CLAUDE.md` §1) y está implementado en
  `packages/domain/src/fx.ts` (`DEFAULT_FX_ROUNDING`, `:35`; `applyFx`, `:117`). Es como se publica en
  la práctica y **nunca deja el precio publicado por debajo del USD × TC**. Los otros modos existen y
  están testeados; **el default se cambia por tenant, no por deploy**.
  _Esta línea decía "definir y testear (propuesta: …)" hasta el 2026-08-28: era drift, la decisión
  estaba tomada y el código escrito desde S5._
- Cambiar el TC **revalida toda la vidriera** del tenant, y eso significa **`invalidateStorefront()`**,
  que emite los **dos** tags de tenant. Desde S6.2 la ficha ya **no** registra `storefront:{slug}` en
  su camino de HIT, así que emitir ese tag a mano actualiza la grilla y **deja cada ficha con el TC
  viejo hasta un año** (`cacheLife('max')`), sin error y sin log. Es la trampa que espera a **T12**
  (`SLICE_BOARD.md` §T12 · `ARCHITECTURE.md` §"Quién registra qué tag").
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
// Verificado contra packages/domain/src/dto.ts:101-129 el 2026-08-28.
{
  id, slug, title, modelDisplayName, storageGb, color,
  condition, conditionLabel,         // el enum Y su etiqueta de ficha ("usado excelente")
  batteryPct, screenOriginal, icloudStatusText, warrantyText, provenanceText,
  description,                       // SANITIZADA. Nunca el texto crudo del dueño
  priceUsd, priceArs,                // { cents, formatted } — el ARS es informativo
  fxRateUsed,
  photos: [{ card, detail, alt }],   // sólo URLs de variante, nunca la key del original
  status,                            // 'available' | 'reserved' | 'sold'
  pickup: [{ name, address, hours }],
  paymentMethods, acceptsTradeIn,
  waUrl, waMessage,                  // UN solo botón; el texto ya viene armado
}
```
_Tres campos faltaban en esta lista hasta el 2026-08-28 (`conditionLabel`, `description`,
`waMessage`) y estaban en el DTO desde S3/S4. **Una allowlist incompleta es peor que no tenerla**:
invita a leerla como "lo que sale hoy" cuando su trabajo es ser la lista contra la que se compara._

**`nameSource` es del `PublicListingSource`, no del DTO, y esa asimetría es a propósito**: dice si
`modelDisplayName` salió del `catalog_model` o del `title` libre del dueño, alimenta el mensaje de
WhatsApp (S4.1) y **no tiene por qué viajar al comprador**.
**Prohibido para siempre:** `imei` · `cost_usd` · `margin` · `internal_notes` · `supplier` ·
`enacomResult` · `tenantId` interno · `userId` · cualquier timestamp interno.

Test obligatorio: agregar un campo nuevo al modelo de DB **no** debe hacerlo aparecer en el DTO.

## Reservas
`duration ∈ [30, 120]` minutos, default 60 (`RESERVATION_MIN/MAX/DEFAULT_MINUTES`). **Fuera de rango
se rechaza, no se clampea:** clampear le devuelve al vendedor una reserva que no pidió, y el cliente
del otro lado del WhatsApp escucha un plazo que nadie guardó.
`expireReservation(reservation, now)` es **puro** — `now` se inyecta. El cron sólo la invoca.
Al expirar: `reserved → available` + revalidate. Una unidad tiene **como máximo una** reserva activa,
y eso lo sostiene el índice único **parcial** `reservations_one_active_per_listing`, no un `if`.

**Entitlement `reservations`:** plan `negocio` **y** plan `trial` **mientras esté vigente**. Un trial
vencido no conserva ninguna feature, la vigencia se resuelve en `featureAccess()` y el rechazo pega
en la Server Action — **ADR-018**. **Cancelar no pide entitlement**: soltar una unidad no puede
quedar bloqueado por facturación.

**En qué queda una reserva que se cierra lo decide la tabla del dominio; el call site sólo declara su
intención.** Es **ADR-019**, cerrada el 2026-08-28 (S6.1, `83bc673`). La puerta única es
`transitionEffects(from, to, intent)`, y el efecto **no es un booleano**: es
`closesReservationAs: ReservationClosingStatus | null`, donde `null` significa *"esta transición no
cierra ninguna reserva"*.

| arista | queda | por qué |
|---|---|---|
| `reserved → sold` | `confirmed` | sin importar el `intent`: no existe una venta que venció |
| `reserved → available` con `intent: 'expire'` | `expired` | es el mismo valor que devuelve `expireReservation()`, que es **quien tiene la definición de vencida** |
| `reserved → cualquier otro destino` | `cancelled` | **incluso si la reserva ya estaba vencida**: `expired` significa "se venció sola" |

`intent` (`'expire' | 'cancel' | null`) es el **motivo humano**, no el resultado, y es **obligatorio**
aunque admita `null`: un parámetro opcional con default válido no distingue *"no me lo pasaron"* de
*"me pasaron que no hay"*, y ésa es justo la distinción que hacía que el panel escribiera `cancelled`
donde el cron escribía `expired`, **sobre la misma arista**.

`ReservationClosingStatus` se define por **exclusión** de `'active'`, para que agregar un estado de
reserva obligue a decidir si es un cierre en vez de quedar afuera en silencio.

## Mensaje de WhatsApp
Ver skill `wa-payload`. Texto canónico en `CLAUDE.md` §1. Función pura en `packages/domain/src/wa.ts`
(el path decía `packages/domain/wa.ts`, que no existe; corregido el 2026-08-28).

**Dos registros de condición, a propósito** (ratificado por el LEAD en FASE 2, no reabrir): la ficha
dice `usado excelente` (`CONDITION_LABELS`, `src/types.ts:52`) y el mensaje de WhatsApp dice
`usado A` (`WA_CONDITION_LABELS`, `:69`). La ficha le habla a un comprador; el mensaje, a un reseller
que usa esa jerga. **No es una inconsistencia y no se unifica.** Quien lo afirma sobre la misma
página —único lugar donde los dos mapas se observan a la vez— es **M3b de `scripts/accept-s3.sh`**;
los unit tests ven un mapa por vez y **seguirían verdes** si alguien los fusionara.
