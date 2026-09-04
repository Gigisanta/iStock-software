# Inngest Free para jobs programados
_Consultado: 2026-09-04 · Agente: researcher_

## Pregunta

¿Puede iStock ejecutar el barrido de reservas cada cinco minutos sin Vercel Pro, ahora que la
implementación de Inngest ya está presente localmente?

## Respuesta corta

- La implementación local está presente: `apps/web/package.json` fija `inngest@4.20.0`,
  `apps/web/inngest/functions.ts` declara `expireReservations` con `cron('*/5 * * * *')`, y
  `apps/web/app/api/inngest/route.ts` expone `/api/inngest` mediante `serve`.
- `vercel.json` está localmente sin `crons`; eso confirma que no se está declarando un cron de
  Vercel en el árbol actual, pero no confirma un deploy ni una ejecución en producción.
- La documentación oficial sigue describiendo Hobby como gratuito, sin tarjeta y con 50.000
  ejecuciones mensuales publicadas; la cuota efectiva del workspace y el costo efectivo de iStock
  quedan `UNVERIFIED`.
- Siguen sin verificarse una cuenta/app de Inngest, las claves de Production, la sincronización de
  funciones, una corrida real y la cuota efectiva. No se afirma integración externa ni producción.
- La alternativa sigue siendo técnicamente viable, pero el LEAD debe validar esos puntos antes de
  cambiar ADR-017 o vender el flujo como operativo.

## Detalle

### Estado local

El código local ya contiene el SDK `inngest@4.20.0`, la función `expireReservations`, el trigger
`*/5 * * * *`, el endpoint App Router `/api/inngest` y el handler `serve`. El endpoint también
declara `maxDuration = 300`, siguiendo la guía oficial para Vercel. `vercel.json` sólo contiene
`$schema` y no declara `crons`.

Esto demuestra una implementación local presente y coherente con el patrón documentado por Inngest.
No demuestra que exista una cuenta o app externa, que las variables estén cargadas en Production,
que Inngest haya sincronizado esta app, que una corrida haya llegado al endpoint ni que el deploy
de producción esté activo.

### Evidencia oficial conservada

Un trigger cron acepta una expresión Unix; `*/5 * * * *` es válido según [Trigger helpers:
`cron()`](https://www.inngest.com/docs/reference/typescript/functions/triggers), Inngest,
consultado 2026-09-04. La guía de [Deploy Inngest to
Vercel](https://www.inngest.com/docs/deploy/vercel), Inngest, consultada 2026-09-04, documenta
`serve` en `/api/inngest`, `maxDuration`, las claves requeridas, la sincronización automática de
la integración oficial y la sincronización manual si esa integración no se usa.

La página oficial de [Pricing](https://www.inngest.com/pricing), Inngest, consultada 2026-09-04,
publica Hobby a USD 0, sin tarjeta, con 50.000 ejecuciones mensuales, 5 pasos concurrentes y
500.000 eventos; también indica que al superar la cuota gratuita Hobby pausa la ejecución. Son
límites y precio publicados, no una medición de la cuenta o del costo efectivo de iStock.

La documentación oficial de [Signing keys](https://www.inngest.com/docs/platform/signing-keys) y
[Event keys](https://www.inngest.com/docs/events/creating-an-event-key), ambas consultadas
2026-09-04, respalda que Production necesita una clave de firma para autenticar llamadas entrantes
y una clave de evento para que la aplicación envíe eventos.

### Gaps y consecuencias

- La cuenta y la app de Inngest no fueron verificadas. No hay evidencia local de que el workspace
  exista o esté conectado al proyecto de Vercel.
- Las claves `INNGEST_SIGNING_KEY` y `INNGEST_EVENT_KEY` de Production no fueron verificadas. El
  código acepta la configuración, pero eso no prueba que los secretos estén cargados, sean válidos
  o correspondan al entorno correcto.
- La sincronización de funciones no fue verificada. La guía oficial permite sincronización automática
  mediante la integración de Vercel o manual mediante UI/API; no se afirma que ninguna de las dos
  haya ocurrido aquí.
- No se ejecutó una corrida real del cron ni se observó el endpoint firmado. La idempotencia,
  locks, límite por lote y fail-closed del barrido siguen siendo responsabilidades del código local.
- La cuota efectiva, el consumo real por corrida y el costo efectivo siguen `UNVERIFIED`; el precio
  y la cuota publicada no sustituyen una medición del dashboard ni una factura del workspace.
- Antes de una decisión operativa, el LEAD debe reabrir ADR-017 si corresponde, censar `/api/inngest`
  en el firewall, configurar secretos de Production y ejecutar pruebas de firma, cron, reintento e
  idempotencia. No alcanza con quitar `crons` de `vercel.json`.

## Números que importan

| ítem | valor | unidad | fuente |
|---|---:|---|---|
| Frecuencia declarada por la función local | `*/5` | minutos | Código local `apps/web/inngest/functions.ts`, consultado 2026-09-04; validez de la expresión en [Trigger helpers: `cron()`](https://www.inngest.com/docs/reference/typescript/functions/triggers), consultado 2026-09-04 |
| Ocurrencias de `*/5 * * * *` en 30 días | 8.640 | ejecuciones programadas | Cálculo derivado del cron documentado en [Trigger helpers: `cron()`](https://www.inngest.com/docs/reference/typescript/functions/triggers), consultado 2026-09-04 |
| Diseño con función y una etapa | ~17.280 | ejecuciones mensuales proyectadas | Cálculo derivado; depende del conteo de steps de Inngest documentado en [Pricing](https://www.inngest.com/pricing), consultado 2026-09-04 |
| Hobby publicado | USD 0 | por mes | [Pricing](https://www.inngest.com/pricing), consultado 2026-09-04 |
| Ejecuciones Hobby publicadas | 50.000 | por mes | [Pricing](https://www.inngest.com/pricing), consultado 2026-09-04 |
| Pasos concurrentes publicados | 5 | pasos | [Pricing](https://www.inngest.com/pricing), consultado 2026-09-04 |
| Eventos publicados | 500.000 | por mes | [Pricing](https://www.inngest.com/pricing), consultado 2026-09-04 |
| `maxDuration` local del endpoint | 300 | segundos | Código local `apps/web/app/api/inngest/route.ts`, consultado 2026-09-04; [Deploy Inngest to Vercel](https://www.inngest.com/docs/deploy/vercel), consultado 2026-09-04 |

Las proyecciones no equivalen a una cuota efectiva: el conteo exacto depende de los pasos reales,
reintentos y ejecuciones observadas. La versión local `4.20.0` es evidencia del repo, no una
afirmación de que Production esté usando esa versión.

## Fuentes

- [Trigger helpers: `cron()`](https://www.inngest.com/docs/reference/typescript/functions/triggers) — consultado 2026-09-04
- [Deploy Inngest to Vercel](https://www.inngest.com/docs/deploy/vercel) — consultado 2026-09-04
- [Pricing](https://www.inngest.com/pricing) — consultado 2026-09-04
- [Signing keys](https://www.inngest.com/docs/platform/signing-keys) — consultado 2026-09-04
- [Create an Inngest Event Key](https://www.inngest.com/docs/events/creating-an-event-key) — consultado 2026-09-04

## Impacto en iStock

- **ARCHITECTURE:** la implementación local ya tiene el adaptador Inngest y el endpoint firmado;
  la arquitectura externa queda pendiente de cuenta/app, sincronización, secretos y corrida real.
  Vercel sigue sin ser la fuente declarativa del cron mientras `vercel.json` no tenga `crons`.
- **DECISIONS:** ADR-017 no debe darse por resuelto sólo por la presencia del código. El LEAD debe
  decidir después de verificar el workspace, Production y el comportamiento observado.
- **COST:** usar el plan publicado puede evitar el costo de Vercel Pro para este job, pero el costo
  efectivo, la cuota efectiva y el impacto de reintentos siguen `UNVERIFIED`; no hay base para
  afirmar ahorro ni costo cero en producción.

## Confianza

media — alta para la presencia y forma de la implementación local y para los límites publicados en
las fuentes oficiales; media para la decisión operativa porque faltan cuenta/app, claves de
Production, sincronización, corrida real, cuota efectiva y costo. Una corrida controlada con
dashboard y configuración real subiría la confianza; una contradicción entre el workspace y el
pricing publicado la bajaría.

## UNVERIFIED

- Cuenta y app de Inngest existentes y vinculadas al proyecto.
- Claves `INNGEST_SIGNING_KEY` e `INNGEST_EVENT_KEY` cargadas y válidas en Production.
- Sincronización externa de funciones, mediante integración de Vercel o UI/API manual.
- Deploy y ejecución real del cron cada cinco minutos, incluyendo recepción firmada del endpoint.
- Cuota efectiva disponible, consumo real por ejecución y comportamiento ante reintentos.
- Costo efectivo de Inngest y cualquier ahorro o cargo asociado en producción.
