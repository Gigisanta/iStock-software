# vercel-cron-limits
_Consultado: 2026-08-28 · Agente: researcher_

## Pregunta

Para el plan **Vercel Pro** (USD 20/mes), hoy 2026-08-28, verificado contra `vercel.com/docs`:
granularidad del schedule, máximo de crons por proyecto, timeout de la invocación, forma exacta de
`crons[]` en `vercel.json`, autenticación por `CRON_SECRET`, y cómo se factura la invocación.
El consumidor es `vercel.json` (archivo del LEAD, **hoy no existe**) y el handler ya escrito en
`apps/web/app/api/cron/expire-reservations/route.ts`.

## Respuesta corta

- **Pro permite por minuto.** Mínimo `* * * * *` (1/min), precisión **per-minute** (la invocación cae
  dentro del minuto especificado). `*/5 * * * *` es legal en Pro. **Hobby confirmado: 1 vez por día**,
  y una expresión más frecuente **falla el deploy**, no se degrada silenciosamente.
- **100 cron jobs por proyecto**, en **los tres planes** (Hobby/Pro/Enterprise). El schema de
  `vercel.json` lo impone como `maxItems: 100`, así que un `vercel.json` con 101 rompe en validación.
- **No hay timeout propio del cron.** Es el `maxDuration` de la función: Pro **300 s default, 800 s
  máximo** (1800 s en beta, con config por función). Cron que no termina → `504
  FUNCTION_INVOCATION_TIMEOUT`. Vercel **no reintenta**.
- **`crons[]` tiene exactamente dos campos, los dos requeridos: `path` y `schedule`.** `path` debe
  empezar con `/`, máx 512 chars; `schedule` máx 256. **Query string: no documentado** → ver UNVERIFIED.
- **Sí, `CRON_SECRET` con ese nombre exacto.** Si la env var existe, Vercel manda su valor
  automáticamente en el header `Authorization`, **con prefijo `Bearer `**. El handler actual
  (comparación de hashes + `timingSafeEqual` + fail-closed si falta la env) es exactamente el patrón
  que documenta Vercel, endurecido. **No hay que cambiarlo.**
- **Facturación: cuenta como Function Invocation normal, a `$0.60 / 1.000.000` en Pro, sin allotment
  incluido** (lo absorbe el crédito mensual del plan). Un cron `*/5` = **8.640 invocaciones/mes ≈
  USD 0,0052/mes**. Ruido. Lo que cuesta es lo que la función *hace*, no que la disparen.

## Detalle

### 1. Granularidad y precisión

Tabla oficial de `/docs/cron-jobs/usage-and-pricing` (last_updated 2026-07-15):

| | crons por proyecto | Intervalo mínimo | Precisión |
|---|---|---|---|
| Hobby | 100 | Once per day | Per-hour (±59 min) |
| **Pro** | **100** | **Once per minute** | **Per-minute** |
| Enterprise | 100 | Once per minute | Per-minute |

Hobby, textual: *"Cron jobs can only run once per day. Expressions like `0 * * * *` (per-hour) or
`*/30 * * * *` (every 30 minutes) **will fail deployment** with the error: Hobby accounts are limited
to daily cron jobs."* → **confirmado, y corregido en un punto**: no es sólo un límite de frecuencia,
es un **error de build**. Además Hobby tiene deriva de hasta 59 min (`0 1 * * *` dispara entre 01:00 y
01:59).

Pro, textual (`/docs/cron-jobs/manage-cron-jobs`, §"Cron jobs accuracy"): *"For all other teams, cron
jobs will be invoked within the minute specified. For instance, the expression `5 8 * * *` would
trigger an invocation between `08:05:00` and `08:05:59`."*

Formato de expresión: 5 campos, **UTC siempre**. Limitaciones documentadas:
no soporta alias (`MON`, `JAN`, …), y **no se puede setear day-of-month y day-of-week a la vez**
(uno de los dos tiene que ser `*`).

**Consecuencia para la expiración de reservas** (`CLAUDE.md` §1: reserva 30–120 min): con `*/5` la
deriva máxima de una reserva vencida es ~5 min + duración del barrido. Con Hobby sería de hasta
24 h — o sea, la feature no existiría. Es una razón más para Pro, independiente de la licencia.

### 2. Máximo de crons

`/docs/limits` (last_updated 2026-08-25), fila `Cron Jobs (per project)`: **100 / 100 / 100**.
El asterisco de Hobby remite al límite de frecuencia, no al de cantidad.
Confirmado en el schema oficial (`openapi.vercel.sh/vercel.json`, descargado 2026-08-28):
`"crons": { "type": "array", "maxItems": 100, ... }`.
Nota operativa: *"Disabled cron jobs will still be listed and will count towards your cron jobs
limits."* Deshabilitar no libera cupo.

### 3. Timeout

`/docs/cron-jobs/manage-cron-jobs`, textual: *"The duration limits for Cron jobs are **identical to
those of Vercel Functions**."* **No existe un timeout propio del cron.** Con fluid compute
(default en proyectos nuevos), `/docs/functions/limitations` da:

| | Default | Máximo | Máximo extendido |
|---|---|---|---|
| Hobby | 300 s | 300 s | — |
| **Pro** | **300 s** | **800 s** | 1800 s (beta, config por función) |

Superado el límite → `504 FUNCTION_INVOCATION_TIMEOUT`.

Tres cosas más de esa misma página que **son diseño, no trivia**:

- **Vercel no reintenta un cron fallido.** *"Vercel will not retry an invocation if a cron job fails."*
- **La entrega es best-effort en las dos direcciones.** *"Cron delivery can also occasionally invoke
  the same scheduled run more than once"* y también puede **saltear** una corrida sin dejar log.
  Vercel exige explícitamente handlers **idempotentes y reconciliadores**: procesar *todo el trabajo
  pendiente desde la última corrida exitosa*, no *el delta del último tick*.
  `expireDueReservations()` ya es de este tipo (barre por `expires_at < now()`), así que cumple; pero
  el invariante es de la función, no del scheduler, y hay que mantenerlo así.
- **No hay control de concurrencia.** Si una corrida dura más que el intervalo, Vercel dispara la
  segunda igual. La doc recomienda lock distribuido; para nosotros la palanca barata es que el
  `UPDATE ... WHERE status = 'reserved' AND expires_at < now()` es naturalmente idempotente y una
  segunda corrida simultánea no duplica nada.

### 4. Forma exacta del campo

Del schema oficial (`https://openapi.vercel.sh/vercel.json`, descargado 2026-08-28), literal:

```json
{"crons":{"type":"array","maxItems":100,"items":{"type":"object",
"required":["schedule","path"],
"properties":{"schedule":{"type":"string","minLength":9,"maxLength":256},
"path":{"type":"string","maxLength":512,"pattern":"^/.*"}}}}}
```

- **Sólo `path` y `schedule`**, ambos `required`. No hay `id`, ni `name`, ni `method`, ni `headers`,
  ni `timezone`, ni `maxDuration` por cron. La duración se configura por función (`functions[]` o
  `export const maxDuration`), no acá.
- El objeto `crons[]` **no declara `additionalProperties: false`** (el objeto raíz de `vercel.json`
  **sí**). O sea: un campo extra dentro de un cron pasaría la validación de schema y sería ignorado.
  **No lo aprovechemos**: no es una promesa, es un hueco.
- `schedule.minLength: 9` = el largo de `* * * * *`. Cualquier expresión de 5 campos lo cumple.
- `path.pattern: "^/.*"` — sólo exige que empiece con `/`.
- Los crons se crean **sólo para deployments de producción**: *"Vercel invokes cron jobs only for
  production deployments and not for preview deployments."* El preview no dispara nada, lo cual es
  bueno para nosotros (no hay preview vaciando reservas), pero significa que **el cron no se prueba
  en preview**: se prueba con `vercel crons run <path>` contra producción (CLI en beta).

Ejemplo mínimo válido, listo para el `vercel.json` que hay que crear:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    { "path": "/api/cron/expire-reservations", "schedule": "*/5 * * * *" }
  ]
}
```

### 5. Autenticación — `CRON_SECRET`

`/docs/cron-jobs/manage-cron-jobs`, §"Securing cron jobs", textual:

> *"It is possible to secure your cron job invocations by adding an environment variable called
> `CRON_SECRET` to your Vercel project. We recommend using a random string of **at least 16
> characters** […] **The value of the variable will be automatically sent as an `Authorization`
> header when Vercel invokes your cron job.**"*
>
> *"The `authorization` header will have the `Bearer` prefix for the value."*

**Las tres respuestas que el handler necesitaba, confirmadas:**
1. Sí, es automático — no hay que configurarlo en `vercel.json` ni en la ruta.
2. El nombre de la env var es **exactamente `CRON_SECRET`**. No es configurable.
3. El header es `Authorization: Bearer <valor>` (mismo formato que compara `route.ts`).

El snippet oficial de Next.js App Router compara `authHeader` contra el template `` `Bearer ${cronSecret}` `` y devuelve 401 si `cronSecret` es falsy
→ **fail-closed si falta la env**, que es literalmente la razón #2 del docblock de nuestro handler.
Nuestra implementación es un superconjunto (hash + `timingSafeEqual`), y la doc no la contradice en
nada. **No hay cambio requerido en `route.ts`.**

Dos headers extra que Vercel manda y que hoy no usamos:
- `User-Agent: vercel-cron/1.0` (**no es autenticación** — un header es falsificable; sirve para logs).
- `x-vercel-cron-schedule: <expresión>`, útil si algún día dos schedules comparten `path`.

### 6. Facturación

Textual, `/docs/cron-jobs/usage-and-pricing`: *"Cron jobs invoke Vercel Functions. This means the
**same usage and pricing limits will apply**."* Y en `manage-cron-jobs`: *"Cron jobs are **logged as
function invocations**."*

- **Function Invocations**: `$0.60 per 1,000,000` en Pro, **`Included (Pro): N/A`** — o sea que en Pro
  las invocaciones **no tienen allotment gratis propio**; se cobran on-demand contra el crédito
  mensual del plan. (Hobby sí tiene 1 M incluidas.) Definición: *"Counts each request to your
  function […] Counts regardless of request success or failure."*
- **Active CPU / Provisioned Memory**: se cobran igual que cualquier función (`iad1`: $0.128/CPU-hr,
  $0.0106/GB-hr). Para el barrido de reservas — una query indexada — el Active CPU es despreciable;
  lo que corre es Provisioned Memory por el *wall time* de la query.
- **Edge Requests (= CDN Requests)**: Pro incluye las primeras **10.000.000**. Ver UNVERIFIED: la doc
  **no dice explícitamente** que un cron incurra Edge Request, aunque el request entra por el CDN.
  Aun asumiendo que sí, 8.640/mes contra 10 M incluidos es 0,086 % del allotment.

Costo mensual de `*/5 * * * *`: 12 × 24 × 30 = **8.640 invocaciones** → 8.640 × $0,60/1.000.000 =
**USD 0,0052/mes**. Con `* * * * *` serían 43.200 → USD 0,026/mes. **La frecuencia del cron no es una
decisión de costo; es una decisión de precisión de la reserva.**

### Trampas que aplican a *nuestra* arquitectura

1. **Los crons NO siguen redirects.** *"When a cron-triggered endpoint returns a 3xx redirect status
   code, the job completes without further requests."* Si `proxy.ts` (host → vidriera) o un
   `redirects[]` llegan a redirigir `/api/cron/*` — apex→www, trailing slash, canonicalización de
   host — **el cron devuelve 3xx, Vercel lo da por hecho, y las reservas no expiran nunca, en
   silencio**. Es el modo de falla más probable de esta pieza y no lo agarra ningún test unitario.
2. **Un `path` inexistente da 404 pero igual se ejecuta y se factura**: *"If you create a cron job for
   a path that doesn't exist, it generates a 404 error. However, **Vercel still executes your cron
   job**."* Un typo en `vercel.json` es un 404 recurrente que no rompe nada visible.
3. **Instant Rollback no actualiza los crons activos**: *"active cron jobs will not be updated. They
   will continue to run as scheduled."* Un rollback deja corriendo el schedule del deploy nuevo
   contra el código viejo.
4. **Attack Challenge Mode ya exceptúa a los crons de Vercel** (changelog 2025-04-01): *"Vercel Cron
   Jobs are now exempt from challenges when running in the same account."* O sea, prender ACM —la
   palanca gratis de `ARCHITECTURE.md` contra abuso del HTML— **no rompe la expiración de reservas.**
   Ojo: eso vale para ACM; **no** dice nada sobre las reglas de rate limit del WAF, que se evalúan
   aparte. Si `config/firewall-rules.json` le pone techo por IP a `/api/cron/*`, hay que verificar
   que el rango de origen del cron no quede atrapado.
5. **No hay soporte local**: *"There is currently no support for `vercel dev`, `next dev`, or other
   framework-native local development servers."* Local se prueba pegándole al endpoint a mano.

## Números que importan

| ítem | valor | unidad | fuente |
|---|---|---|---|
| Intervalo mínimo Pro | 1 | por minuto | [cron usage-and-pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing) |
| Precisión de invocación Pro | dentro del minuto (±59 s) | s | [manage-cron-jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs) |
| Intervalo mínimo Hobby | 1 | por día (falla el deploy si es más) | [cron usage-and-pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing) |
| Deriva Hobby | hasta 59 | min | [cron usage-and-pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing) |
| Crons por proyecto (todos los planes) | 100 | crons | [limits](https://vercel.com/docs/limits) · schema `maxItems:100` |
| `maxDuration` default Pro | 300 | s | [functions/limitations](https://vercel.com/docs/functions/limitations) |
| `maxDuration` máximo Pro | 800 | s | [functions/limitations](https://vercel.com/docs/functions/limitations) |
| `maxDuration` extendido Pro (beta) | 1800 | s | [functions/limitations](https://vercel.com/docs/functions/limitations) |
| Reintentos ante fallo | 0 | reintentos | [manage-cron-jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs) |
| `path` máx | 512 | chars, debe empezar con `/` | [vercel-json#crons](https://vercel.com/docs/project-configuration/vercel-json#crons) |
| `schedule` máx | 256 | chars (min 9) | [vercel-json#crons](https://vercel.com/docs/project-configuration/vercel-json#crons) · schema |
| Campos de `crons[]` | 2 (`path`, `schedule`), ambos requeridos | — | [openapi.vercel.sh/vercel.json](https://openapi.vercel.sh/vercel.json) |
| Env var de auth | `CRON_SECRET` (nombre fijo) | — | [manage-cron-jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs) |
| Largo recomendado del secreto | ≥ 16 | chars | [manage-cron-jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs) |
| Header enviado | `Authorization: Bearer <CRON_SECRET>` | — | [manage-cron-jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs) |
| User-Agent del cron | `vercel-cron/1.0` | — | [cron-jobs](https://vercel.com/docs/cron-jobs) |
| Function Invocations Pro | 0.60 | USD / 1.000.000 | [limits](https://vercel.com/docs/limits) |
| Invocations incluidas en Pro | N/A (0, on-demand contra el crédito) | — | [functions/usage-and-pricing](https://vercel.com/docs/functions/usage-and-pricing) |
| Edge Requests incluidos Pro | 10.000.000 | requests/mes | [limits](https://vercel.com/docs/limits) |
| Invocaciones de un cron `*/5` | 8.640 | invocaciones/mes | cálculo: 12×24×30 |
| Costo de invocación de `*/5` | 0.0052 | USD/mes | cálculo: 8.640 × 0.60/1e6 |
| Costo de invocación de `* * * * *` | 0.026 | USD/mes | cálculo: 43.200 × 0.60/1e6 |
| Active CPU `iad1` | 0.128 | USD/CPU-hr | [functions/usage-and-pricing](https://vercel.com/docs/functions/usage-and-pricing) |
| Provisioned Memory `iad1` | 0.0106 | USD/GB-hr | [functions/usage-and-pricing](https://vercel.com/docs/functions/usage-and-pricing) |

## Fuentes

- [Cron Jobs](https://vercel.com/docs/cron-jobs) — consultado 2026-08-28 (doc `last_updated: 2026-08-11`)
- [Usage & Pricing for Cron Jobs](https://vercel.com/docs/cron-jobs/usage-and-pricing) — consultado 2026-08-28 (`last_updated: 2026-07-15`)
- [Managing Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs) — consultado 2026-08-28 (`last_updated: 2026-08-11`)
- [Getting started with cron jobs](https://vercel.com/docs/cron-jobs/quickstart) — consultado 2026-08-28 (`last_updated: 2026-08-11`)
- [Static Configuration with vercel.json — §crons](https://vercel.com/docs/project-configuration/vercel-json) — consultado 2026-08-28 (`last_updated: 2026-08-14`)
- [openapi.vercel.sh/vercel.json (JSON Schema oficial)](https://openapi.vercel.sh/vercel.json) — descargado 2026-08-28, HTTP 200, 418.990 bytes
- [Vercel Functions Limits](https://vercel.com/docs/functions/limitations) — consultado 2026-08-28 (`last_updated: 2026-08-24`)
- [Fluid compute pricing](https://vercel.com/docs/functions/usage-and-pricing) — consultado 2026-08-28 (`last_updated: 2026-06-16`)
- [Limits](https://vercel.com/docs/limits) — consultado 2026-08-28 (`last_updated: 2026-08-25`)
- [CDN pricing and usage](https://vercel.com/docs/manage-cdn-usage) — consultado 2026-08-28 (`last_updated: 2026-08-11`)
- [vercel crons (CLI, beta)](https://vercel.com/docs/cli/crons) — consultado 2026-08-28 (`last_updated: 2026-07-15`)
- [Changelog: Attack Challenge Mode now allows verified bots and Vercel cron jobs](https://vercel.com/changelog/attack-challenge-mode-now-allows-verified-bots-and-vercel-cron-jobs) — consultado 2026-08-28 (changelog 2025-04-01)

## Impacto en iStock

**ARCHITECTURE.md**
- El `vercel.json` que hay que crear lleva **exactamente** `{"path": "/api/cron/expire-reservations",
  "schedule": "*/5 * * * *"}`. Ningún campo más: el schema no define otro.
- **`maxDuration` no se setea en `crons[]`.** Si el barrido llegara a pasar de 300 s (no debería:
  es un `UPDATE` indexado), se sube por `functions[]` o `export const maxDuration` en la ruta —
  decisión de `app-agent` sobre su archivo, no del cron.
- **Regla nueva derivada, y es la más importante de este research:** `/api/cron/*` **no puede recibir
  un 3xx de `proxy.ts` ni de `redirects[]`**. Un redirect ahí apaga la expiración de reservas en
  silencio, sin log de error, sin alerta. Candidato a gate: `scripts/probes/` que pegue a la ruta de
  producción y falle si el status es 3xx.
- El cron es **at-least-once y puede saltear corridas**. `expireDueReservations()` debe seguir siendo
  reconciliador (barrer *todo* lo vencido), nunca incremental. Vale la pena que esto esté escrito en
  `ARCHITECTURE.md` y no sólo en el docblock del handler.
- Cron ≠ preview: la única forma de probarlo end-to-end es `vercel crons run` contra producción.

**DECISIONS.md**
- Refuerza el ADR de Vercel Pro con un argumento **funcional**, no sólo de licencia: en Hobby la
  expiración de reservas tendría granularidad diaria y deriva de 59 min → la reserva de 30–120 min
  de `PRODUCT.md` sería inimplementable. Pro no es una preferencia, es el piso técnico de la feature.
- Ratifica el handler existente: el patrón `CRON_SECRET` + `Authorization: Bearer` es el oficial;
  nuestra versión (hash + `timingSafeEqual` + fail-closed) es estrictamente más dura. Sin cambios.

**COST.md** (para `cost-auditor`, no lo escribo yo)
- Cron de expiración `*/5`: **8.640 invocaciones/mes = USD 0,0052/mes** en Function Invocations.
- Edge Requests: 8.640/mes contra 10 M incluidos en Pro → **0,086 % del allotment**.
- Active CPU + Provisioned Memory del barrido: no medido acá, depende de la query. Es el único
  componente del cron que puede crecer, y crece con la cantidad de reservas vencidas, no con la
  frecuencia. **Bajar el cron a `*/15` no ahorra plata; sólo empeora la precisión de la reserva.**

**`config/firewall-rules.json`** (LEAD)
- Attack Challenge Mode **no** bloquea los crons (exentos desde 2025-04-01). Prenderlo es seguro.
- Una regla de rate limit sobre `/api/cron/*` sí podría atrapar al cron: la exención documentada es
  de ACM, no del WAF. Si `guard-firewall.sh` exige que toda ruta esté cubierta o exceptuada, la
  entrada correcta para `/api/cron/expire-reservations` es **exceptuada con motivo**: la ruta ya está
  autenticada por secreto y falla cerrado, y ponerle techo por IP arriesga apagar la expiración.

## Confianza

**alta** para 1, 2, 3, 5 y la mitad de 4 y 6.
Todo sale de `vercel.com/docs` con `last_updated` entre 2026-06-16 y 2026-08-25, y los límites de
`crons[]` están corroborados por **dos** fuentes independientes que coinciden: la prosa de
`/docs/project-configuration/vercel-json#crons` y el JSON Schema ejecutable de
`openapi.vercel.sh/vercel.json`. Cero contradicciones entre páginas oficiales en este topic.

**media** para la parte de facturación que toca Edge Requests, y **baja** para el query string.

Qué la subiría: (a) un deploy real con `vercel crons run` y el gráfico de Edge Requests filtrado por
`requestPath:/api/cron/*` — cierra el punto 6 con evidencia medida en vez de derivada;
(b) un `path` con `?` desplegado a producción, que responde el punto del query string de una.
Qué la bajaría: que Vercel cambie los defaults de fluid compute (los 300 s default son recientes) o
que el CLI `vercel crons`, hoy **en beta**, cambie el shape de lo que escribe en `vercel.json`.

## UNVERIFIED

1. **Query string en `path`.** La doc **no dice ni que sí ni que no**. Lo que sí se sabe: el schema
   valida `path` con `pattern: "^/.*"` y `maxLength: 512`, o sea que `?foo=bar` **pasaría la
   validación** — pero un pattern permisivo no es una promesa de que el runtime lo respete al
   construir la URL. Los ejemplos oficiales para pasar parámetros usan **segmentos de path**
   (`/api/sync-slack-team/T0CAQ10TZ`), y para distinguir schedules que comparten `path` la doc empuja
   el header `x-vercel-cron-schedule`, no un query param. **Recomendación: no usar query string en
   `vercel.json`.** No lo necesitamos y no hay razón para apostar a algo indocumentado en la única
   puerta HTTP sin sesión que escribe.
2. **Si la invocación del cron incurre Edge Request / CDN Request.** Confirmado que incurre
   **Function Invocation** (dos páginas lo dicen). Para Edge Requests la doc de CDN dice *"Static
   assets and functions all incur CDN Requests"* y la de cron dice que Vercel *"makes an HTTP GET
   request to your project's production deployment URL"* — de las dos se **deriva** que sí, pero
   **ninguna página lo afirma para cron**. Asumo que sí (es lo conservador para COST) y el impacto es
   despreciable en cualquier caso: 8.640 vs 10 M incluidos.
3. **Qué hostname exacto golpea el cron.** La doc dice *"your project's production deployment URL"* y
   ejemplifica con `https://*.vercel.app/api/cron`. **No aclara** si usa el dominio de producción
   asignado (`maat.work`), el `*.vercel.app`, o la URL inmutable del deployment. **Nos importa mucho**
   porque `proxy.ts` rutea por host: si el host entrante no es el que el proxy espera, el request
   podría caer en la rama de vidriera. Se resuelve empíricamente en el primer deploy leyendo
   `host` en el handler; hasta entonces, **el proxy debe dejar pasar `/api/cron/*` sin reescribir,
   sea cual sea el host**.
4. **Si el rate limit del WAF de Vercel aplica a los crons.** La exención documentada es sólo de
   Attack Challenge Mode. No encontré doc que diga si las reglas de rate limit de Firewall se evalúan
   sobre tráfico de cron ni desde qué IPs sale. Falta: rango de IP de origen de `vercel-cron/1.0`.
