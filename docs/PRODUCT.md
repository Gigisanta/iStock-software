# PRODUCT — iStock

_**Qué es:** el producto cerrado de `CLAUDE.md` §1, en forma verificable — a quién le sirve, qué
entra en Capa 1, qué preguntas quedaron abiertas (serie **`Q`** — ver la nota arriba de esa tabla) y
con qué número se declara cobrable. **Para quién:**
quien va a decidir si algo entra en una slice. **Cuándo se actualiza:** cuando una pregunta abierta se
cierra, o cuando una slice cambia el alcance de Capa 1. El producto **no se reabre** (`CLAUDE.md` §1)._

_Owner: **`docs-keeper`** por `CLAUDE.md` §4. Ver la salvedad de ownership en `DOMAIN.md` (encabezado):
`.claude/agents/product-scribe.md` reclama este archivo y **eso lo resuelve el LEAD**, no este doc._

## Una frase
Cargás el stock una vez → tenés vidriera en `{slug}.maat.work` → el visitante llega informado →
abre WhatsApp con el producto ya escrito.

## Para quién
Reseller del Alto Valle (Neuquén / Cipolletti) con **20–200 equipos**, oficina, WhatsApp y canje
presencial. Hoy vive en **Excel + estados de Instagram**. Ese es el competidor real.

## Tres caras, un tenant
| cara | host | quién entra | auth |
|---|---|---|---|
| marketing | `maat.work` | prospecto | no |
| panel | `maat.work/app/*` | dueño y vendedores | sí |
| vidriera | `{slug}.maat.work` | comprador final | **no** — anónima y cacheada |

La **vidriera no tiene DB propia**: lee el mismo Postgres a través de cache/ISR.

## El recorrido que factura
1. El dueño carga 15 equipos en una tarde (fotos con el celular, precio en USD).
2. Pega `{slug}.maat.work` en un estado de Instagram.
3. El comprador entra, ve fotos reales, condición, batería, precio en USD **y en ARS**, punto de retiro.
4. Toca **un** botón y su WhatsApp se abre con el mensaje ya escrito.
5. El dueño recibe un mensaje que dice **qué equipo** y **a qué precio**, no "hola, info?".

**Ese paso 5 es el producto.** Todo lo demás existe para llegar ahí.

**S8 abrió una segunda puerta que entra al mismo paso 5, y no lo reemplaza.** El visitante que no
viene a comprar sino a **vender su equipo** deja un canje desde un formulario público de la vidriera;
el dueño lo ve en un inbox del panel y, si lo acepta, la unidad se crea en **`draft`** —o sea que
aceptar un canje **no publica nada**: publicar sigue siendo una decisión aparte del dueño—. El
recorrido que factura no cambia: el canje **alimenta** el paso 1.

## Planes
| plan | precio | incluye | no incluye |
|---|---|---|---|
| `trial` | 0, 14 días | todo, **mientras está vigente** | nada, **una vez vencido** — **ADR-018** |
| `base` | ~USD 19/mes | stock, vidriera, WhatsApp, FX, 1 punto de retiro | chatbot, reservas, margen |
| `negocio` | ~USD 35/mes | + chatbot, reservas, margen, 3 puntos de retiro | — |

**Landing custom = upsell humano**, se cotiza aparte. En el signup **siempre** se crea la genérica.

**La tabla de arriba es el default, no la última palabra.** Una feature se puede prender o apagar
por tenant sin tocarle el plan: es una fila en `entitlements`, y manda sobre el plan en las **dos**
direcciones (ADR-018 §6) — cortesía a un `base` mientras se cierra una venta, o kill switch sobre un
`negocio` que abusa. **Hoy eso no tiene pantalla:** el único escritor de esa tabla es
`setFeatureFlag()` y no lo llama nadie en producción, así que en la práctica se hace con un `update`
a mano contra Postgres. Se anota acá para que la palanca no se lea como una capacidad del panel.

## Fuera de alcance (Capa 1) — no negociable
ARCA/AFIP · WhatsApp Business API · sync con MercadoLibre · carrito · checkout de ventas del
reseller · POS · landing custom en el signup · LLM dentro de WhatsApp.

## Realidad local que el software modela
- **El TC se actualiza automáticamente** una vez por día con la última cotización oficial disponible
  del BCRA, por tenant. No se consulta ningún proveedor en el hot path de la vidriera.
  El ARS es informativo y la operación se cierra por WhatsApp.
- **Condiciones:** sellado · open box · tester A+ · usado excelente · usado con detalle.
- **Canje presencial** como flujo de primera clase (no una nota al pie). **Existe desde S8**
  (2026-08-28): formulario público en la vidriera → inbox en el panel → aceptar crea la unidad en
  `draft` con su costo. **El límite que queda, y conviene no leerlo de más:** el dueño **no puede
  dejar de recibir canjes desde el panel** — `accepts_trade_in` sólo lo escribe el signup y en
  `/app/ajustes` se muestra de sólo lectura (fila `T39`, abierta). Lo que la bandera hace **cuando
  alguien la cambia a mano** es cerrar el formulario público de la vidriera y **no** el mostrador:
  semántica en `DOMAIN.md` §"Máquina de estados del canje".
  _(La otra mitad de esta línea decía que **no queda registrado que una unidad entró por canje**.
  Es falsa desde el 2026-08-28: `listings.acquisition_channel` existe —migración `0009`, fila `S8.1`
  cerrada— y `acceptToStock()` escribe `trade_in`.)_
- **Puntos de retiro** con horario. El comprador quiere saber dónde y cuándo, no un formulario de envío.
- **Copy para estados de IG/WA** exportable desde el panel.

## Compliance
IMEI + origen + resultado de consulta ENACOM (link + enum) **en el panel, nunca en la vidriera**.
**No somos registro oficial.** CABA 295/26 es argumento de venta, no una integración.

## Definición de "done cobrable"
Un reseller de Cipolletti carga 15 equipos en una tarde, pega el link en un estado, y **recibe
WhatsApps esa misma noche** que mencionan el equipo y el precio.

## Preguntas abiertas
**El prefijo de esta serie es `Q`, no `P`, y el motivo va escrito porque el rename tuvo costo.**
`SLICE_BOARD.md` tiene su propia serie `P<n>` (hoy `P1`…`P5`), y este doc numeraba también con `P`
desde P1: dos series, un prefijo, y ya costó una confusión. Censadas las ~70 citas por el LEAD, **las
que aparecen en gates y en comentarios de código apuntan todas a la serie del board**, así que la que
se renumeró fue ésta y el board no se tocó. **Un prefijo pertenece a un solo documento** — regla
nueva, fila `T44` del board, dueño LEAD.

| # | pregunta | default propuesto por el LEAD |
|---|---|---|
| Q1 | ¿Qué pasa con la vidriera al vencer el trial sin pago? | 7 días de gracia con banner → luego vidriera en modo "contactá al vendedor" (fichas visibles, sin precios). **No** 404: rompe links ya compartidos en WhatsApp. |
| Q2 | ¿La ficha de un equipo vendido devuelve 404? | No. 200 con "vendido" + link a similares. Los links viven en chats de WhatsApp para siempre. |
| Q3 | ¿Duración default de la reserva? | 60 min al crear el negocio; el dueño puede elegir 30 min, 1 h, 1 h 30 min o 2 h desde Ajustes. El selector queda preseleccionado al reservar, el server usa esa preferencia si falta el campo y cada reserva todavía puede cambiarse. El rango por unidad sigue siendo 30–120 min y fuera de rango se **rechaza**, no se clampea. |
| Q4 | ¿El seller puede publicar (`draft → available`)? | Sí, pero **no** ve ni edita `cost_usd`. |
| Q5 | Desde S8 el producto guarda **PII de un tercero** (nombre y WhatsApp de alguien que no es cliente de MaatWork ni empleado del reseller, escritos **sin login**). ¿Qué dicen los ToS sobre quién responde por esa base, y qué se le promete a esa persona? | **Sin default: el LEAD no lo definió y `docs-keeper` no lo inventa.** Lo que sí está decidido y ejecutado es la mitad técnica —`anon` **escribe** esas dos columnas y **no las lee**, **ADR-026**—; lo que no está decidido es la mitad de producto. Contexto para decidirla: hasta S8 todo lo que entraba a la base era del **dueño** o de su **stock**, tipeado por alguien logueado sobre cosas suyas. **Sobre el número:** esta pregunta era `P5` hasta el 2026-08-28 y colisionaba con el `P5` de `SLICE_BOARD.md`, que es otra cosa (`offer_usd` y el rol `seller` a nivel base). La colisión se reportó y **el LEAD la resolvió renumerando esta serie a `Q`**, no el board: las citas de gates y de código apuntaban a la del board. |
