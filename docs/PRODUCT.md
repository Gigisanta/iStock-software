# PRODUCT — iStock

_Owner: `product-scribe`. El producto **no se reabre** (`CLAUDE.md` §1). Este doc lo hace ejecutable._
_Estado: seed del LEAD en FASE 0. `product-scribe` lo completa en FASE 2._

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

## Planes
| plan | precio | incluye | no incluye |
|---|---|---|---|
| `trial` | 0, 14 días | todo, **mientras está vigente** | nada, **una vez vencido** — **ADR-018** |
| `base` | ~USD 19/mes | stock, vidriera, WhatsApp, FX, 1 punto de retiro | chatbot, reservas, margen |
| `negocio` | ~USD 35/mes | + chatbot, reservas, margen, 3 puntos de retiro | — |

**Landing custom = upsell humano**, se cotiza aparte. En el signup **siempre** se crea la genérica.

## Fuera de alcance (Capa 1) — no negociable
ARCA/AFIP · WhatsApp Business API · sync con MercadoLibre · carrito · checkout de ventas del
reseller · POS · landing custom en el signup · LLM dentro de WhatsApp.

## Realidad local que el software modela
- **El TC lo pone el dueño**, a mano, por tenant. No hay API de dólar en el hot path.
  El dueño no quiere el dólar "real": quiere **su** dólar.
- **Condiciones:** sellado · open box · tester A+ · usado excelente · usado con detalle.
- **Canje presencial** como flujo de primera clase (no una nota al pie).
- **Puntos de retiro** con horario. El comprador quiere saber dónde y cuándo, no un formulario de envío.
- **Copy para estados de IG/WA** exportable desde el panel.

## Compliance
IMEI + origen + resultado de consulta ENACOM (link + enum) **en el panel, nunca en la vidriera**.
**No somos registro oficial.** CABA 295/26 es argumento de venta, no una integración.

## Definición de "done cobrable"
Un reseller de Cipolletti carga 15 equipos en una tarde, pega el link en un estado, y **recibe
WhatsApps esa misma noche** que mencionan el equipo y el precio.

## Preguntas abiertas
| # | pregunta | default propuesto por el LEAD |
|---|---|---|
| P1 | ¿Qué pasa con la vidriera al vencer el trial sin pago? | 7 días de gracia con banner → luego vidriera en modo "contactá al vendedor" (fichas visibles, sin precios). **No** 404: rompe links ya compartidos en WhatsApp. |
| P2 | ¿La ficha de un equipo vendido devuelve 404? | No. 200 con "vendido" + link a similares. Los links viven en chats de WhatsApp para siempre. |
| P3 | ¿Duración default de la reserva? | 60 min (rango permitido 30–120). **Implementado en S6, a medias:** el rango y el default son constantes del dominio (`RESERVATION_MIN/MAX/DEFAULT_MINUTES`), sostenidas además por el `CHECK` `reservations_minutes_range`; **el "configurable por tenant" no existe** y no tiene fila en el board. Fuera de rango se **rechaza**, no se clampea. |
| P4 | ¿El seller puede publicar (`draft → available`)? | Sí, pero **no** ve ni edita `cost_usd`. |
