# Inngest Free para jobs programados

**Fecha de consulta:** 2026-09-04  
**Pregunta:** si iStock puede ejecutar el barrido de reservas cada cinco minutos sin Vercel Pro.  
**Alcance:** Inngest Cloud Hobby, una función TypeScript servida por Next.js App Router en Vercel.  
**Estado:** research; no se instaló el SDK, no se creó una cuenta y no se cambió el proveedor del repo.

## Respuesta ejecutiva

Sí, es técnicamente viable dentro del stack cerrado: Inngest acepta expresiones cron Unix como
`*/5 * * * *` y documenta un endpoint `serve` para Next.js/Vercel. Su plan Hobby publicado es
gratuito, sin tarjeta, e incluye 50.000 ejecuciones mensuales. No es una solución sin configuración:
Production necesita `INNGEST_SIGNING_KEY` para autenticar las llamadas de Inngest y
`INNGEST_EVENT_KEY` para la comunicación de la aplicación. La integración también agrega un
endpoint público firmado, sincronización de funciones y un proveedor operativo nuevo.

## Hechos verificados

| Afirmación | Evidencia primaria | Confianza |
|---|---|---|
| Un trigger cron acepta una expresión Unix y `*/5 * * * *` es una forma válida | [Trigger helpers: `cron()`](https://www.inngest.com/docs/reference/typescript/functions/triggers), Inngest, consultado 2026-09-04 | Alta |
| Next.js App Router se integra con `serve` en `/api/inngest`; se recomienda configurar `maxDuration` | [Deploy Inngest to Vercel](https://www.inngest.com/docs/deploy/vercel), Inngest, consultado 2026-09-04 | Alta |
| Hobby cuesta USD 0, no requiere tarjeta, e incluye 50.000 ejecuciones, 5 pasos concurrentes y 500.000 eventos | [Pricing](https://www.inngest.com/pricing), Inngest, consultado 2026-09-04 | Alta |
| Al superar la cuota gratuita, Hobby pausa la ejecución | [Pricing, FAQ](https://www.inngest.com/pricing), Inngest, consultado 2026-09-04 | Alta |
| Production requiere claves de firma y evento; la firma autentica las llamadas entrantes | [Signing keys](https://www.inngest.com/docs/platform/signing-keys), [Event keys](https://www.inngest.com/docs/events/creating-an-event-key), Inngest, consultados 2026-09-04 | Alta |
| La integración de Vercel puede cargar las claves y sincronizar funciones automáticamente; sin ella la sincronización es manual | [Deploy Inngest to Vercel](https://www.inngest.com/docs/deploy/vercel), Inngest, consultado 2026-09-04 | Alta |

## Aplicación a iStock

- `*/5 * * * *` produce 8.640 ocurrencias en un mes de 30 días. Es un cálculo derivado de la
  expresión actual, no una cuota publicada por Inngest.
- Inngest cuenta una ejecución de la función y cada `step.run()` como ejecuciones separadas. Un
  diseño con una sola etapa de mantenimiento sería aproximadamente 17.280 ejecuciones mensuales;
  dos etapas serían aproximadamente 25.920. Ambas cifras son una proyección y deben verificarse en
  el dashboard después de una prueba real.
- El barrido actual ya es idempotente y trata la siguiente corrida como reintento. Inngest agregaría
  reintentos con estado y observabilidad, pero no elimina la necesidad de conservar el orden de
  locks, el límite por lote ni el fail-closed del endpoint manual.
- Para un dominio propio, la guía documenta `INNGEST_SERVE_ORIGIN`; si se usa la integración de
  Vercel, la sincronización de la app debe comprobarse luego del deploy.

## Gaps y consecuencias

- No se verificó una cuenta real de Inngest, el estado de sus límites en un workspace concreto ni la
  sincronización de una app de iStock. Queda `UNVERIFIED` hasta crear un entorno y ejecutar una
  corrida controlada.
- Habría que reabrir ADR-017, agregar el endpoint `/api/inngest` al censo de firewall, definir sus
  variables Production y escribir pruebas de firma, cron, reintento e idempotencia. No alcanza con
  borrar `crons` de `vercel.json`.
- Las claves son secretos server-only. El endpoint debe quedar accesible para Inngest, pero nunca
  aceptar una invocación sin firma válida.
- El plan gratuito puede pausar ejecuciones al consumir la cuota; eso es un riesgo operativo que no
  existe en el diseño actual con Vercel Pro y debe incluir una alarma antes de vender.

## Decisión pendiente

La alternativa es viable para posponer Vercel Pro, pero implica una decisión explícita del LEAD y
coordinación externa con Inngest. Hasta esa decisión, se conserva el cron `*/5` versionado y no se
degrada a una frecuencia diaria, porque eso rompería la expiración de reservas.
