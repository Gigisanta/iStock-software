# DOMAIN — modelo de negocio ejecutable

_**Qué es:** el modelo de negocio en su forma ejecutable — glosario, máquina de estados, FX,
visibilidad por rol y el `publicListingDTO`. **Para quién:** cualquiera que vaya a escribir una regla
de negocio, antes de escribirla. **Cuándo se actualiza:** con cada slice que toca reglas de negocio._

_Owner: **`docs-keeper`** por `CLAUDE.md` §4 (`docs/**` menos `research/` y `COST.md`).
`domain-agent` es dueño de la **implementación** en `packages/domain`, no de este archivo._

> **Conflicto de ownership CERRADO por el LEAD el 2026-08-28, y cerrado como clase, no como caso.**
> Era el de siempre: `CLAUDE.md` §4 da `docs/**` a `docs-keeper`, `INDEX.md` daba este archivo a
> `product-scribe`, y `.claude/agents/product-scribe.md:11` dice *"escribís sólo en `docs/PRODUCT.md`
> y `docs/DOMAIN.md`"* — tres fuentes, dos respuestas, la misma forma que `architect` sobre
> `ARCHITECTURE.md`/`DECISIONS.md`. La regla nueva de §4 no arbitra este archivo, arbitra todos:
> **un contrato de agente puede acotar lo que su dueño escribe, nunca ampliarlo**; si
> `.claude/agents/*.md` y §4 discrepan sobre un path, **gana §4** y el contrato queda derogado en esa
> línea. `product-scribe` queda **dormido**, igual que `architect`. Este archivo es de `docs-keeper`.

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

## Máquina de estados del canje (`tradein_leads`) · S8

```
new ──> contacted ──> evaluating ──> accepted   (única transición que S8 escribe)
                                └──> rejected
```

Cinco estados, y **el enum vive en Postgres**. `apps/web/app/(app)/_lib/tradein/status.ts` deriva el
tipo de `tradeinLeads.$inferSelect` con un **`import type`** —que TypeScript borra al compilar—, así
que agregarle un estado a la tabla **rompe la compilación** hasta que alguien decida cómo se llama en
castellano, y Drizzle **no entra al bundle** del componente que muestra la etiqueta. Una segunda
lista de estados escrita en TS compilaría siempre y mentiría el día que cambie la tabla.

**`accepted` es el único de los cinco con significado de negocio para el panel, y es la única
transición que S8 escribe.** Los otros cuatro son etiquetas de seguimiento: hoy **nadie los mueve**
—S8 no trae la pantalla de *contactado* ni la de rechazo—, así que la flecha del diagrama describe la
intención, no un camino que el código recorra.

| aspecto | cómo está resuelto |
|---|---|
| **quién crea el lead** | el visitante **sin login**, desde la vidriera, como rol `anon` y a través de una policy `FOR INSERT`. Es la **segunda** escritura sin autenticar del producto (la primera es el beacon de S4) y la primera que trae **PII de un tercero** — **ADR-026** |
| **aceptar** | crea la unidad en **`draft`, siempre**, con el costo copiado de columna a columna. Nace en `draft` a propósito: aceptar un canje no publica nada, así que la función **no invalida el cache de la vidriera** — no hay nada que un visitante pueda ver distinto |
| **doble submit** | lo para el **guard de concurrencia**, no un `if` de UI: el `update` del lead va **primero** y lleva `status <> 'accepted'` en el `where`. Medido: `accept_dos_veces_una_unidad=1` |
| **el vínculo lead → unidad** | `tradein_leads.created_listing_id`, escrito después de crear la unidad |

### Qué sostiene el motor y qué sostiene el borde  ·  cerrado por la `0009` (fila `S8.1`, 2026-08-28)

Este párrafo decía tres cosas —que no quedaba registrado que una unidad entró por canje, que faltaba
el `CHECK`, y que la policy no miraba `accepts_trade_in`— y **las tres las cerró la migración
`packages/db/drizzle/0009_tradein_accepts_and_acquisition_channel.sql`**. Se reescribe en vez de
tacharse porque una de las tres **entró distinta a como se pidió**, y ese "distinta" es lo que hay
que leer:

| lo que S8 dejaba en el borde | dónde vive ahora |
|---|---|
| **el tenant tiene el canje prendido** | **adentro** de la policy de `INSERT`, vía `ALTER POLICY` — el primero del repo. El `where` del handler **lo sigue chequeando**: dos capas, no redundancia a limpiar |
| **de dónde salió la unidad** | `listings.acquisition_channel` (enum `purchase` / `trade_in` / `other`, default `purchase`), con backfill de lo que ya estaba. **No** es `provenance_text` —ese es el texto libre de la ficha pública—, y **no** está en el `GRANT` de columna de `anon`: nace invisible para la vidriera |
| **un lead `accepted` tiene unidad** | un **`CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED`**, no un `CHECK` |

**Una columna nueva con default no queda escrita sola, y esto costó unas horas de datos falsos.**
`acquisition_channel` nació con `DEFAULT 'purchase'` y la 0009 hizo el **backfill** de las unidades
que ya venían de un lead — o sea que el **pasado** quedó bien. El **futuro** no: `apps/web` no
escribía la columna, así que cada unidad nueva nacida de un canje se guardaba como `purchase`,
**justo el caso por el que la columna se pidió**. Lo encontró y lo arregló `app-agent` en la misma
pasada (`acquisitionChannel: 'trade_in'` en el `insert` de `accept-to-stock.ts`, §7 de su docblock).
Se deja escrito porque la forma se repite: **un backfill arregla el pasado y no dice nada del
futuro**, y un default sensato es exactamente lo que hace que el bug no se note.

**El `CHECK` que pedía el encargo no se puede escribir, y la próxima persona que lea "falta el CHECK"
en un doc viejo tiene que encontrar acá por qué no es un CHECK.** Un `CHECK` en Postgres **no se
puede diferir**: se evalúa al terminar cada sentencia. `acceptToStock()` escribe en tres pasos —
(1) `update` del lead a `accepted`, (2) `insert` de la unidad, (3) `update` del vínculo — y el `update`
de (1) va **primero a propósito**: **es** el guard de concurrencia (lleva `status <> 'accepted'` en el
`where`), y moverlo quemaría un slug y un id por cada carrera perdida. Un `CHECK` habría explotado con
`23514` en (1), que `acceptToStock()` no atrapa: **aceptar un canje habría pasado a ser un 500.** El
encargo estaba mal y la implementación tuvo razón en desobedecerlo. Un trigger diferido corre al
**COMMIT**, permite el estado intermedio —que dentro de una transacción no ve nadie— y exige el
estado final igual.

**Un cambio de comportamiento que sale de ahí y conviene no descubrir depurando:** ya no se puede
borrar una unidad nacida de un canje aceptado sin resolver antes el lead (la FK es
`ON DELETE SET NULL`, así que el borrado dejaba el lead en `accepted` sin unidad). Hoy no rompe nada
—no existe ningún borrado de `listings` en `apps/web`—; el día que exista una pantalla de borrado va
a tener que decidir qué pasa con el canje.

### Qué significa `accepts_trade_in`  ·  ratificado por el LEAD el 2026-08-28

**La bandera cierra la puerta de la vidriera, no el mostrador.**

La policy de `anon` mira `accepts_trade_in`; la de `authenticated` **no**, y eso es deliberado: el
dueño de un tenant con la bandera en `false` **puede** cargar un canje desde el panel. Lo midió
`qa-agent` y preguntó si era defecto — no lo es. `accepts_trade_in = false` significa *"no publico el
formulario de canje en mi vidriera"*, no *"dejo de hacer canjes"*. Canje es **compra presencial de un
equipo usado al cliente** (glosario, arriba) y `CLAUDE.md` §1 lo llama flujo de primera clase: si la
bandera cerrara también el panel, apagarla equivaldría a apagar un flujo de primera clase, que es otra
cosa y ningún dueño la pidió.

Lo afirma `tests/rls-cross-tenant.test.ts` §R2c-g (*"apagar el canje baja el formulario público, no el
mostrador"*), que es el archivo que se pone rojo y nombra la decisión el día que alguien quiera
cambiarla.

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
| `tradein_leads.offer_usd`, `tradein_leads.internal_notes` | ✅ (**RPC owner-only**) | ❌ **ni por `SELECT` directo ni por RPC owner-only** | ❌ |
| `tradein_leads.customer_name`, `customer_wa_phone` | ✅ | ✅ (panel: hay que llamar al cliente) | ❌ — **y es PII de un tercero**, la primera del producto (**ADR-026**) |

La rama del seller usa una **allowlist en el select del server**. Ocultar con CSS o con un `if` en
el componente es un fallo de seguridad, no una decisión de UI. Esa allowlist no es la única barrera:
en el estado actual la base también revoca los `SELECT` sensibles.

**Historial de S8 (2026-08-28):** medido por el LEAD contra Postgres real, un `seller` autenticado
**sí podía** leer `offer_usd` e `internal_notes` de `tradein_leads`: `membership_role` aparecía
**cero veces** en sus policies. Esa era la evidencia de P5 en ese momento y explica por qué S8
también ató la respuesta del servidor.

**Estado verificado en la corrida local del 2026-09-01 UTC:** las migraciones
`0012_owner_sensitive_read_functions.sql`, `0014_member_imei_lookup.sql` y el hardening posterior
revocan el `SELECT`
directo de las columnas sensibles para `authenticated` y dejan una allowlist explícita. Por eso
`cost_usd`, `offer_usd` e `internal_notes` no son legibles por `SELECT` directo, tampoco para un
owner. El owner obtiene `cost_usd` mediante `owner_get_listing_cost` y la oferta/notas mediante
`owner_get_tradein_sensitive`; ambos son RPC `SECURITY DEFINER` con validación de tenant y rol
owner. El seller no obtiene filas por esos RPC. La evidencia del árbol está en
`packages/db/src/seller-authorization.test.ts` y en las queries del panel.

Lo que **sí** está atado, y es más fuerte que un `if`: `listTradeinLeads()` devuelve una **unión
discriminada** por `canSeeOffer`, y en la rama del `seller` la clave `offerUsdCents` **no existe en
el objeto** — leerla en esa rama **no compila**. El **SQL** de esa rama tampoco **nombra**
`offer_usd` ni `internal_notes`. Y el `adversary-reviewer` censó que **no hay un tercer camino de
lectura**: `grep -rn 'tradeinLeads\|tradein_leads' apps/web` devuelve exactamente **dos** consumidores.
Por eso el gate de S8 mide `costo_en_el_payload_del_seller=0` sobre el **objeto** y no sobre el tipo:
un tipo que no compila no es lo mismo que un byte que no sale.

## `publicListingDTO` — allowlist explícita
```ts
// ALLOWLIST. Agregar un campo acá es una decisión, no un accidente.
// Verificado contra `PublicListingDTO` de packages/domain/src/dto.ts el 2026-08-28.
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
dice `usado excelente` (`src/types.ts` · `CONDITION_LABELS`) y el mensaje de WhatsApp dice
`usado A` (`src/types.ts` · `WA_CONDITION_LABELS`). La ficha le habla a un comprador; el mensaje, a un reseller
que usa esa jerga. **No es una inconsistencia y no se unifica.** Quien lo afirma sobre la misma
página —único lugar donde los dos mapas se observan a la vez— es **M3b de `scripts/accept-s3.sh`**;
los unit tests ven un mapa por vez y **seguirían verdes** si alguien los fusionara.

### El copy público no compromete una acción futura nuestra

Regla de la vidriera, y **vale para todo lo que se le muestre a un visitante anónimo** — incluido el
chatbot de FASE 5, que todavía no existe. **Ningún texto público puede prometer que después vamos a
hacer algo.** Puede describir el presente (*"otra persona lo reservó"*), puede describir cómo
funciona el mundo (*"una reserva a veces se cae"*) y puede pedirle algo al visitante
(*"decíselo"*). No puede decir *"avisamos"*, *"te escribimos"* ni *"quedás anotado"*.

**No es tono, es capacidad:** la vidriera es anónima y cacheada, **no tiene DB propia** y no la va a
tener; no hay lista de espera, no hay notificación y no se guarda un solo dato del visitante. Y el
que queda mal cuando el aviso no llega no somos nosotros: es el reseller, en su propio dominio.

Hasta S6 el texto de `reserved` decía *«si la reserva se cae, avisamos»* y el botón se degradaba a
*«Preguntar por WhatsApp si se libera»*. Lo segundo rompía además `CLAUDE.md` §1: la ficha tiene
**UN** `wa.me` y ese botón es el que vende — un CTA que se disculpa convierte la única conversación
del producto en una consulta tibia.

| estado | badge | CTA | mensaje de WhatsApp |
|---|---|---|---|
| `available` | `Disponible` | *Lo quiero — escribir por WhatsApp* | el string canónico de `CLAUDE.md` §1, **fijado byte a byte** |
| `reserved` | `Reservado` | *Lo quiero igual — escribir por WhatsApp* | primer renglón afirmativo (`quiero el …`), el estado se **reconoce** y el aviso queda como consecuencia (*"si se cae, lo compro yo"*) — el favor se lo pide el visitante al vendedor, que **sí** puede cumplirlo |
| `sold` | `Vendido` | *Preguntar por WhatsApp si entra otro igual* | pregunta por un equipo parecido; la ficha vieja sigue teniendo URL y el vendido es prueba social |

**Los tres estados abren la conversación y eso lo decide el dominio, no la pantalla:**
`buildWaMessage` tiene un texto propio para cada uno. Esconder el botón en `reserved` o en `sold`
tira los dos leads más baratos del negocio — el que espera que se caiga una seña y el que quiere el
mismo equipo que otro ya se llevó. Lo que cambia es **qué promete el botón**, no si existe.

**Cero datos de la reserva en cualquiera de los dos lados.** Ni quién señó ni hasta cuándo:
`WaListing` no los tiene y el DTO público tampoco, así que la prohibición es de tipos. Que la ficha
diga que está reservado es todo lo que un visitante anónimo puede saber.

_Verificado el 2026-08-28 contra `apps/web/app/(storefront)/_lib/status.ts` y
`packages/domain/src/wa.ts`. La regla la afirma un test, no la prosa:
`status.test.ts` *«NINGÚN estado promete una acción futura nuestra»* barre `label + detail +
ctaLabel` de los tres estados contra ocho formas de promesa. **Las dos mitades están en el árbol de
trabajo y todavía no pasaron por una corrida de gate del LEAD**; el string de `available` es el
único fijado por un gate (`wa.test.ts` U14 + M3b de `accept-s3.sh`)._
