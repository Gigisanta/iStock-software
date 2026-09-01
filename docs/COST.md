# Auditoría de costo de producción

**Corte:** 2026-09-01
**Checkout auditado:** `3fd4c1a` (commit de launch auditado)
**Alcance:** costo marginal de infraestructura por tenant activo, hasta 100 tenants. El piso fijo de plataforma se informa aparte.
**Regla:** la pregunta de esta auditoría es «¿esto agrega costo tonto?». Un dato de producción que no pudo observarse es `UNVERIFIED`; no se trata como cero.

## Gate

```text
COST_VERDICT: FAIL
DELTA_POR_TENANT_MES: USD 0.02960/tenant/mes = (R2 storage USD 0.00435 + R2 Class B en stress sin cache USD 0.02520 + R2 Class A USD 0.00000 + R2 egress USD 0.00000 + cron Vercel USD 0.00005184), con redondeo conservador y amortización en 100 tenants; + USD 0.00180/tenant/mes de invocaciones Vercel sólo si la tarifa por unidad aplica [UNVERIFIED] = USD 0.03140 condicional. CPU real, Postgres, HTML/WAF, Cloudflare y uso real de LLM siguen UNVERIFIED; no hay total certificable.
SUPUESTOS: 100 tenants activos; 3.000 pageviews públicos/tenant/mes; 60 listings visibles por tenant; máximo 8 fotos/listing; 4 fotos/listing como planificación esperada; 90% de vistas de home y 10% de detalle; 40 mensajes/día/tenant sólo para Negocio; mes de 30 días.
VECTOR_MAS_RIESGOSO: Postgres/cache y crecimiento de objetos R2. Una regresión del cache vuelve cada hit público una lectura de DB; los objetos R2 de listings borrados no se eliminan y hacen que el almacenamiento crezca sin cota temporal.
METRICA_A_VIGILAR: storefront_db_hit_rate = hits públicos de vidriera que ejecutan SQL / hits públicos totales; alarma >5% y gate objetivo ≤5% (95% de hits sin DB).
```

El `FAIL` no significa que el escenario numérico conocido supere USD 0.50. Significa que producción no está demostrada y hay riesgos de costo sin límite o sin atribución. El merge queda bloqueado hasta cerrar los puntos del gate de §Producción.

### Objetivo ratificado por LEAD (2026-08-28)

| Plan | Precio de venta | Techo marginal | Atribución obligatoria |
|---|---:|---:|---|
| Base | ~USD 19 | **USD 0.50/tenant/mes** | Todo lo que no es chat |
| Negocio | ~USD 35 | **USD 1.50/tenant/mes** | Los mismos USD 0.50 no-chat + hasta USD 1.00 de `packages/ai` |

El USD 1.50 de Negocio no habilita gastar USD 1.50 en la vidriera. Cada slice no-chat se compara contra USD 0.50 incluso para un tenant Negocio. El chat tiene su propio renglón y dueño: `packages/ai`.

## Resumen ejecutivo

La decisión de usar pocos servicios es correcta para este volumen:

| Servicio | Responsabilidad | Decisión de costo |
|---|---|---|
| Vercel | Next.js, proxy de host, Functions, ISR y un cron | Un proyecto; no agregar worker, Redis ni cola permanente |
| Supabase | Postgres, Auth, RLS y `pgvector` | Un proyecto; catálogo global para no duplicar filas/embeddings |
| Cloudflare R2 + CDN | Fotos públicas y master privado | Un bucket público y uno privado; egress de R2 a USD 0; no Supabase Storage ni Vercel Image Optimization |
| Mercado Pago | Suscripciones | Separa facturación de infraestructura; comisión transaccional no es costo marginal de infra |
| Gemini + Groq | Chat de Negocio | Dos proveedores por resiliencia, ambos sólo en el hot path del chat |

No encontré un servicio siempre encendido, una conexión Realtime anónima ni una cola/Redis innecesarios en el checkout. Agregar cualquiera de ellos antes de medir sería costo tonto: suma piso fijo o conexiones sin resolver un cuello de botella probado.

El checkout está en preproducción y el README declara que no hay deploy público ni métricas de producción verificables. Por eso la arquitectura puede ser eficiente en papel, pero el gate de producción no puede ser `PASS` todavía.

## Supuestos de tráfico y atribución

Son escenarios de cálculo, no observaciones de producción:

| Variable | Escenario usado | Estado |
|---|---:|---|
| Tenants activos | 100 | objetivo del contrato |
| Pageviews públicos | 3.000/tenant/mes | supuesto de stress |
| Listings visibles | 60/tenant | `STOREFRONT_PAGE_SIZE` |
| Fotos/listing | 8 máximo; 4 esperado | máximo de app / supuesto de planificación |
| Vistas home/detalle | 90% / 10% | supuesto de stress |
| Mensajes Negocio | 40/día = 1.200/mes | `SOFT_CAP_MESSAGES_PER_TENANT_PER_DAY` |
| Días del mes | 30 | normalización de cálculo |

Faltan datos reales de pageviews, distribución de planes, bytes efectivamente entregados, cache hits/misses, consultas por request, CPU-ms, conexiones y tokens. Todos quedan `UNVERIFIED` hasta que existan logs o métricas del despliegue.

## Tarifas verificadas y piso fijo

Tarifas consultadas el 2026-09-01 en documentación oficial:

| Proveedor | Tarifa útil para este modelo | Tratamiento |
|---|---|---|
| Cloudflare R2 | USD 0.015/GB-mes; Class A USD 4.50/M; Class B USD 0.36/M; egress USD 0; free tier mensual 10 GB, 1 M Class A y 10 M Class B por cuenta | variable marginal; el free tier es de cuenta, no de tenant |
| Supabase Pro | USD 25/mes; incluye 8 GB de disk y créditos de compute; egress incluido hasta 250 GB y cached egress hasta 250 GB en el plan consultado | piso fijo, no se divide en la prueba marginal; exceso/uso real `UNVERIFIED` |
| Vercel Pro | USD 20/mes y USD 20 de crédito mensual; función por unidad publicada a USD 0.0000006/invocación para Pro; CPU y memoria dependen de región | piso fijo; la aplicación del crédito y la clasificación actual del proyecto son `UNVERIFIED` |
| Gemini 2.5 Flash-Lite | USD 0.10/M tokens de entrada y USD 0.40/M de salida | sólo chat Negocio |
| Groq `openai/gpt-oss-20b` | USD 0.075/M de entrada y USD 0.30/M de salida | fallback de chat; uso real `UNVERIFIED` |

Fuentes oficiales y fecha de consulta: [Cloudflare R2 Pricing](https://developers.cloudflare.com/r2/pricing/) (actualizada 2026-08-07, consultada 2026-09-01), [Supabase Pricing](https://supabase.com/pricing/) (consultada 2026-09-01), [Vercel Pro Plan](https://vercel.com/docs/plans/pro-plan) y [Vercel Functions usage and pricing](https://vercel.com/docs/functions/usage-and-pricing) (consultadas 2026-09-01), [Vercel function invocations per-unit](https://vercel.com/changelog/function-invocations-now-billed-per-unit) (2026-05-29, consultada 2026-09-01), [Gemini API Pricing](https://ai.google.dev/gemini-api/docs/pricing) (consultada 2026-09-01), [Groq gpt-oss-20b pricing](https://console.groq.com/docs/model/openai/gpt-oss-20b) (consultada 2026-09-01).

Piso mensual separado del marginal: **USD 25 Supabase Pro + USD 20 Vercel Pro + precio del plan Cloudflare `UNVERIFIED`**. El piso no se reparte dentro de USD 0.50/tenant. Las comisiones de Mercado Pago y cualquier add-on pago tampoco se inventan ni se mezclan con infraestructura.

## Egreso y operaciones de imágenes

### Evidencia de implementación

- `packages/media/src/budgets.ts`: `thumb` 200 px/25 KiB, `card` 800 px/150 KiB, `detail` 1.600 px/250 KiB y master privado 1.600 px/350 KiB. Total por foto: 775 KiB; total público: 425 KiB.
- `packages/media/src/pipeline.ts`: un decode, un downscale y cuatro encodes WebP; límite de salida 1.600 px.
- `packages/media/src/upload.ts`: cada foto produce tres `PutObject` públicos y un `PutObject` del master privado: **4 Class A por foto**. No hace `GetObject` durante el upload.
- `packages/media/src/env.ts`: producción rechaza `MEDIA_DRIVER` distinto de `r2`, exige buckets separados y `NEXT_PUBLIC_MEDIA_BASE_URL`, y rechaza `.r2.dev`.
- `apps/web/app/(app)/%5Fmedia/[...key]/route.ts`: con `MEDIA_DRIVER=r2` devuelve 404; el fallback que lee/head-ea objetos sólo corresponde al driver local.
- `apps/web/next.config.ts`: `images.unoptimized: true`; no hay Vercel Image Optimization.
- Las pantallas usan `<img>` con `srcSet` de card/detail; la vidriera no recibe la key del original.

### Almacenamiento R2

Máximo acotado por el catálogo visible actual, suponiendo que todas las fotos llegan al máximo de bytes:

```text
60 listings × 8 fotos × 775 KiB = 380.928 MB decimales/tenant
100 tenants × 0.380928 GB = 38.0928 GB en la cuenta
redondeo conservador a 39 GB − 10 GB free tier = 29 GB facturables
29 GB × USD 0.015/GB-mes = USD 0.435 total
USD 0.435 / 100 = USD 0.00435/tenant/mes
```

Planificación con cuatro fotos/listing: `60 × 4 × 775 KiB × 100 = 19.0464 GB`; redondeado a 20 GB, da aproximadamente `10 × USD 0.015 = USD 0.15` de cuenta, o USD 0.00150/tenant/mes. Los bytes reales de cada variante y la ocupación histórica son `UNVERIFIED`.

El cálculo de 39 GB no es un límite de vida útil. `packages/media/src/unlink.ts` elimina la fila `listing_photos` pero deliberadamente no borra los objetos R2. Listings eliminados, reuploads y huérfanos pueden hacer crecer el bucket sin cota. Sin una métrica de crecimiento y una política de garbage collection/retención, el vector no tiene un techo de producción certificable: **FAIL**.

### Class A y Class B

Stress de reescritura mensual de todas las fotos visibles:

```text
60 × 8 × 100 fotos × 4 PutObject = 192.000 Class A/mes
192.000 < 1.000.000 free tier de cuenta → USD 0.00 en este escenario
```

Los uploads reales por mes son `UNVERIFIED`. Los deletes no agregan Class A según la tarifa consultada.

Stress deliberadamente sin cache CDN, para mostrar el techo de lecturas y no presentarlo como tráfico esperado:

```text
home: 60 imágenes; detalle: 8 imágenes
promedio = 0.90 × 60 + 0.10 × 8 = 54.8 imágenes/view
3.000 views × 54.8 × 100 tenants = 16.440.000 Class B/mes
redondeo conservador: 17 M − 10 M free tier = 7 M facturables
7 M × USD 0.36/M = USD 2.52 total
USD 2.52 / 100 = USD 0.02520/tenant/mes
```

Con el CDN de Cloudflare funcionando, R2 no cobra egress y los Class B deben aproximarse a los misses de cache, no a todos los `<img>`. El hit ratio del dominio custom, los bytes servidos y los Class B observados son `UNVERIFIED`. La decisión correcta es medir cache misses; no asumir que “CDN” equivale a cero lecturas.

### Bytes al browser

El stress anterior carga `90% × 60 × 150 KiB + 10% × (250 + 7 × 150) KiB = 8.230 KiB/view`. Con 3.000 vistas: `25.28256 GB/tenant/mes` de bytes públicos máximos. El proveedor R2 cobra egress USD 0, pero el origen real del byte, el plan/CDN y cualquier byte que escape por Vercel o Supabase son `UNVERIFIED`. Un original de 25 MiB sólo es un límite de upload server-side; no es un presupuesto válido para el browser.

## Postgres, filas y conexiones

### Evidencia de lecturas

- `apps/web/app/(storefront)/_lib/tenant.ts`: los tenants válidos usan `'use cache'` + `cacheLife('max')`; un hit cacheado no consulta DB.
- `apps/web/app/(storefront)/_lib/listings.ts`: el catálogo y el detalle tienen tag por tenant y, en cold path, una transacción con cinco consultas de aplicación: tenant context, listings/catalog, FX, locations y photos.
- `apps/web/app/(storefront)/_lib/storefront-db.ts`: pool memoizado con `max: 1`; el panel usa la misma estrategia en `apps/web/app/(app)/_lib/db/connection.ts`.
- `apps/web/app/(storefront)/[...]/page.tsx` y `s/[slug]/page.tsx`: cachean la respuesta pública; `generateStaticParams` evita el camino de 100% DB que existiría sin ISR.
- `apps/web/proxy.ts`: sólo reescribe host/ruta, no hace fetch ni DB. El comentario fija un presupuesto de `<2 ms` CPU; no es una medición de runtime.

Filas devueltas en un cold home, bajo los supuestos máximos: `1 tenant + 60 listings + 480 photos + 3 locations + 1 FX = 545 filas`. Cold detail: `1 + 1 + 8 + 3 + 1 = 14 filas`. Con cuatro fotos esperadas, el home baja a 305 filas. Son filas de resultado, no bytes de almacenamiento; filas persistidas, índices, bloat y tiempo real de query son `UNVERIFIED`.

Con cache sano, el costo DB público esperado es cero en hits. El objetivo del contrato exige al menos 95% de hits sin DB, equivalente a `storefront_db_hit_rate ≤5%`. El checkout no tiene una métrica de Vercel/DB que pruebe ese porcentaje.

### Escrituras públicas y cron

- `s/[slug]/api/track/route.ts`: un `INSERT ... SELECT` por beacon válido, con máximo una fila `wa_click_events`; el beacon no devuelve payload.
- `tradein/route.ts`: un `INSERT ... SELECT` por lead válido, una fila `tradein_leads` por envío.
- `vercel.json`: un único cron `*/5 * * * *`, equivalente a `12 × 24 × 30 = 8.640 invocaciones/mes`.
- `expire-reservations/route.ts` autentica primero con `CRON_SECRET`; no hay worker 24/7.
- `expireDueReservations`: incluso sin vencimientos hace al menos dos SELECT por ejecución; el batch máximo es 200 y cada fila cambiada puede hacer hasta un UPDATE de listing, un UPDATE de reservation y un INSERT de event.

Mínimo mensual del cron, plataforma completa: `8.640 × 2 = 17.280 SELECT`; distribuido aritméticamente en 100 tenants: `172.8 SELECT/tenant/mes`, antes de las filas realmente vencidas. A la tarifa de referencia de invocación Vercel: `8.640 × USD 0.0000006 = USD 0.005184 total`, `USD 0.00005184/tenant`; el crédito Pro y la clasificación vigente son `UNVERIFIED`. El costo Supabase por fila/consulta no se puede inventar a partir del precio del plan.

### Conexiones y Realtime

`max: 1` limita cada pool de instancia caliente, no el total de conexiones del proyecto. La cantidad de instancias, concurrencia, conexiones activas, espera de pool y tamaño/compute de Supabase son `UNVERIFIED`.

No hay código de Realtime anónimo en la vidriera. El gate sigue exigiendo **cero conexiones anónimas** y una verificación de la configuración del proyecto Supabase, porque el código no prueba por sí solo la configuración administrada.

## Vercel Functions, CPU y egress HTML

El proxy corre antes del cache para las rutas incluidas por su matcher. Con el supuesto de 3.000 pageviews/tenant:

```text
3.000 × 100 = 300.000 ejecuciones de proxy/mes
presupuesto declarado: <2 ms/ejecución
300.000 × 2 ms = <600.000 ms = <600 s CPU total
tarifa regional gru1 publicada: USD 0.221/CPU-hora
<600/3.600 × USD 0.221 = <USD 0.03683 total
<USD 0.03683 / 100 = <USD 0.000368/tenant
```

Ese cálculo es una cota basada en un comentario del código, no CPU observada. Además, la tarifa de Vercel distingue Edge/Functions/fluid compute y el crédito mensual; si el proxy no se factura como esa clase, el resultado no aplica. La clasificación, región, CPU real, memoria provisionada, invocaciones de ISR y egress HTML son `UNVERIFIED`.

Como referencia separada, si las 300.000 invocaciones de proxy se facturaran a USD 0.0000006: `300.000 × USD 0.0000006 = USD 0.18 total = USD 0.00180/tenant`. No se incorpora al subtotal certificado porque el plan Pro tiene crédito y reglas de inclusión que deben comprobarse en el dashboard.

No hay evidencia de fetch por render ni N+1 en la consulta de catálogo: la carga usa una consulta acotada y una consulta de fotos por los IDs, no una consulta por foto. La prueba de cache hit/miss y CPU requiere deploy; este auditor no ejecuta `next build` ni un servidor silencioso por el límite del harness.

## LLM: sólo Negocio y con atribución propia

### Estado actual

- `packages/ai/src/budget.ts`: máximo 1.200 tokens de entrada, 180 de salida, `temperature: 0.2`, cuatro mensajes de historia, tres chunks y cinco resultados.
- `packages/ai/src/env.ts`: exige driver live y claves en producción, permite sólo familias aprobadas y rechaza modelos frontier/retirados.
- `packages/ai/src/entitlement.ts`: cap blando de 40 mensajes/tenant/día.
- `packages/ai/src/chat.ts`: permite hasta tres llamadas facturables por turno para tool/fallback.
- En el checkout no existe ruta web `/api/chat`, no hay adapter live en `packages/ai` y `apps/web` no consume el paquete. Invocaciones LLM observables desde este checkout: **0**, porque el chat todavía no está conectado; ese cero no es un PASS de costo.

La fuente de Groq consultada marca `llama-3.1-8b-instant` como retirado el 2026-08-16 y documenta `openai/gpt-oss-20b`. El contrato del repo menciona Groq 8B como fallback, mientras el código prevé la familia nueva. La identidad final del modelo de producción y su variable de entorno son `UNVERIFIED` y necesitan una decisión explícita del LEAD; no se acepta un modelo frontier.

### Costo condicional de Negocio

Una llamada al máximo de la dieta, 1.200 in + 180 out:

```text
Gemini: (1.200 × USD 0.10 + 180 × USD 0.40) / 1.000.000
       = USD 0.000192/turno
Groq:   (1.200 × USD 0.075 + 180 × USD 0.30) / 1.000.000
       = USD 0.000144/turno
1.200 turnos/mes × Gemini = USD 0.23040/tenant/mes
1.200 turnos/mes × Groq   = USD 0.17280/tenant/mes
```

El peor camino permitido por el código si consume dos llamadas Gemini y un fallback Groq al máximo:

```text
2 × USD 0.000192 + USD 0.000144 = USD 0.000528/turno
1.200 × USD 0.000528 = USD 0.63360/tenant/mes de chat
100 tenants = USD 63.36/mes de chat
```

USD 0.63360 queda debajo del techo de chat Negocio de USD 1.00, pero **3.600 in/540 out agregados** si cada una de las tres llamadas consume su máximo viola la dieta por turno de 1.200/180. No hay usage logging ni contador diario conectado; por eso el chat no puede pasar hasta medir tokens agregados, aplicar el cap y confirmar que no hay llamada por pageview. El costo de filas de `chatbot_threads/messages` también es futuro y `UNVERIFIED` porque la ruta no existe.

## Qué no agrega costo tonto

Estas decisiones actuales reducen superficie y costo:

- R2 + CDN custom evita egress de almacenamiento y evita pagar Vercel Image Optimization; el browser recibe sólo variantes públicas.
- Tres variantes públicas y un master privado acotan bytes y evitan servir originales.
- ISR/tag por tenant evita que cada hit público haga cinco lecturas; el proxy no hace I/O.
- Catálogo, FAQ y embeddings son globales: no se duplican por tenant.
- Un cron cada cinco minutos reemplaza un worker permanente.
- Realtime queda fuera de la vidriera y no se agregan conexiones anónimas.
- El chat está aislado como costo de Negocio; no se llama LLM por pageview.

La decisión de “menor cantidad posible de servicios” pasa arquitectónicamente. El FAIL actual es de evidencia operativa, límites de almacenamiento/atribución y feature incompleta, no una recomendación de agregar servicios.

## Gate de producción antes de `PASS`

El LEAD debe adjuntar evidencia fechada de todos estos puntos:

1. **R2/media:** `MEDIA_DRIVER=r2`; credenciales y dos buckets configurados; dominio CDN custom activo; ningún `.r2.dev`, Supabase Storage público, Vercel Image Optimization u original >500 KiB en browser. Medir bytes, Class A/B, cache miss y crecimiento de objetos; resolver retención/GC de objetos huérfanos.
2. **Cache/DB:** en producción, `storefront_db_hit_rate ≤5%`; mostrar consultas por hit, filas, p95 de query, conexiones activas y pool waits. Un hit de vidriera que toca Postgres es una regresión de costo aunque el tenant sea Negocio.
3. **Vercel:** confirmar Pro, región/clase de ejecución, invocaciones, CPU-ms/pageview, memoria, egress HTML y consumo del crédito de USD 20. Confirmar que el cron publicado ejecuta 8.640/mes esperado, tiene `CRON_SECRET` y no hay worker 24/7.
4. **Supabase:** proyecto real, compute, disk, conexiones y spend cap **ON**. El spend cap apagado es fallo automático; no se reemplaza por una suposición del `.env.example`.
5. **Seguridad de tráfico:** publicar y comprobar las cuatro reglas de `config/firewall-rules.json` para track, trade-in, chat y billing; no agregar rate limit por cada pageview HTML sin una justificación de costo. La publicación viva está declarada como pendiente en el archivo.
6. **Realtime:** evidencia de cero conexiones anónimas.
7. **LLM/Negocio:** ruta real sólo en Negocio; Gemini Flash-Lite primario y fallback aprobado; ningún frontier; p95 y máximo agregado ≤1.200 in/180 out por turno; cap ≤40 mensajes/día/tenant; costo por proveedor y tokens in/out por tenant.
8. **Atribución:** reporte mensual separando no-chat y `packages/ai`. Base debe ser ≤USD 0.50. Negocio debe ser no-chat ≤USD 0.50 + chat ≤USD 1.00; un total único no sirve.

Cualquier punto sin evidencia permanece `UNVERIFIED` y conserva `COST_VERDICT: FAIL`.

## Registro de datos `UNVERIFIED`

- Deploy, hostname wildcard, DNS/nameservers y dominio CDN activos.
- Configuración efectiva y consumo de Vercel Pro, créditos, región, clase de runtime, CPU-ms, memoria, invocaciones y egress HTML.
- Proyecto Supabase real, spend cap, compute, disk, bloat, filas acumuladas, conexiones y costo de exceso.
- Cuenta R2 real, bucket lifecycle, objetos huérfanos, bytes medios, Class A/B y hit ratio del CDN.
- Pageviews, scroll efectivo, distribución home/detalle, uploads/reuploads y tenants por plan.
- Publicación efectiva de WAF/rate limits.
- Ruta y adapter de chat, modelo/IDs efectivos, tokens agregados, cap diario, fallback real y filas de conversación.
- Pricing/overage efectivo de Cloudflare fuera de R2 y comisiones de Mercado Pago.

## Comando de aceptación

```sh
git diff --check -- docs/COST.md && rg -n "^COST_VERDICT:|^DELTA_POR_TENANT_MES:|^SUPUESTOS:|^VECTOR_MAS_RIESGOSO:|^METRICA_A_VIGILAR:" docs/COST.md && git diff --name-only
```

El último comando debe mostrar `docs/COST.md` como único archivo tracked modificado; los artefactos preexistentes no tracked `.agents/` y `.codex/` deben preservarse.
