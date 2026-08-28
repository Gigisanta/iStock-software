# vercel-firewall-as-code
_Consultado: 2026-08-28 · Agente: researcher_

## Pregunta

¿Las reglas de **rate limiting del Vercel WAF** se pueden declarar como código versionado en el repo
(p. ej. `vercel.json`), o son exclusivamente configuración de dashboard/API? Y en plan **Pro**:
cuántas reglas, qué claves, qué ventana, y cuánto cuesta.

## Respuesta corta

- **NO. `vercel.json` no puede declarar una regla de rate limit.** Es un hecho verificado contra el
  schema oficial: `routes[].mitigate.action` es un `enum` cerrado de **exactamente dos valores**,
  `["challenge","deny"]`, con `additionalProperties: false`. El string `rate_limit` / `rateLimit`
  aparece **0 veces** en todo el schema de `vercel.json`. Escribir un `mitigate` con rate limit no
  se ignora en silencio: **falla la validación**.
- **PERO T1 no es un bloqueo humano.** Hay **tres** caminos oficiales de "reglas como código", y el
  bueno para nosotros es el **CLI**: `vercel firewall rules add --json '<payload>' --yes` seguido de
  `vercel firewall publish --yes`. Es explícitamente apto para CI (`--ai` e interactivo requieren
  TTY; `--json` y `--condition` no). Disponible desde **2026-05-12**.
- **El JSON de las dos reglas se versiona en el repo** y un gate estático lo afirma en cada push. El
  apply es un paso aparte (no ocurre en `vercel deploy`): las reglas del Firewall **no requieren
  redeploy** y viven fuera del ciclo de build.
- **Pro: 40 reglas de rate limit por proyecto.** Nos sobran 38. Ventana **10s–10min**, límite
  1–10.000.000 req. **Clave de conteo en Pro: sólo `ip` y `ja4`** — `header:` es Enterprise.
- **Costo: usage-based desde el request 1, sin allotment gratis en Pro.** `$0.50` / 1M allowed
  requests en `iad1`, **`$0.80` / 1M en `gru1`** (São Paulo, la región relevante para AR). A 100k
  req/mes son **USD 0.08/mes total**, no por tenant. No mueve la aguja del objetivo de <USD 0.50/mes/tenant.
- **`@vercel/firewall` (SDK de código) NO arrastra store externo:** `1.2.5` tiene
  `dependencies: {}` y `peerDependencies: {}`. Los contadores son de Vercel, en el edge. **No hay
  Postgres ni Redis en el hot path.** Pero igual necesita una regla creada en el Firewall, así que
  no reemplaza al camino CLI.

## Detalle

### 1. `vercel.json` — el "no" es duro, y está probado contra el schema

La doc de WAF Custom Rules tiene una sección **"Configuration in vercel.json"** que puede inducir a
error si se lee en diagonal: dice que sí se pueden configurar reglas del WAF en `vercel.json` vía
`routes[].mitigate`. Pero acota, textual:

> *"When configuring WAF rules in `vercel.json`, you can use the following actions: **challenge**,
> **deny**. […] This is a subset of the actions available in the dashboard - `log`, `bypass`, and
> `redirect` actions are not supported in `vercel.json` configuration."*

La doc enumera lo que falta (`log`, `bypass`, `redirect`) y **omite mencionar `rate_limit`**, que es
justo lo que preguntamos. Para no depender de una lista posiblemente incompleta, fui a la fuente
máquina: el JSON Schema oficial en `https://openapi.vercel.sh/vercel.json` (419KB, descargado
2026-08-28). Resultado:

```json
"mitigate": { "type": "object", "additionalProperties": false, "required": ["action"],
  "properties": { "action": { "type": "string", "enum": ["challenge", "deny"] } } }
```

Y el conteo de ocurrencias en todo el schema: `rate_limit` → **0**, `rateLimit` → **0**,
`firewall` → **0**. El `enum` cerrado más `additionalProperties: false` significa que un
`"mitigate": {"action": "rate_limit", ...}` es **inválido**, no ignorado. Eso descarta el peor
escenario que planteaba el pedido ("parece configurado y no lo está"): rompería ruidosamente.

**Corolario para el gate:** un `vercel.json` con `mitigate` sólo nos sirve para `deny`/`challenge`
estáticos. Las dos reglas de T1 no van ahí. **No creemos un `vercel.json` creyendo que resuelve T1.**

### 2. Los tres caminos reales de "as code"

| Camino | Qué es | Apto CI | Riesgo |
|---|---|---|---|
| **Vercel CLI** `vercel firewall` | staged + `diff` + `publish` | **Sí** (`--json`/`--condition` + `-y`) | bajo — incremental |
| **REST API** `PUT /v1/security/firewall/config` | reemplaza la config entera | Sí | **alto — pisa todo** |
| **Terraform** `vercel_firewall_config` | IaC con state | Sí | medio — agrega Terraform al stack |

**El CLI gana** y es lo que recomiendo para T1. `rules add` acepta el payload completo:

```bash
vercel firewall rules add "storefront-rl" \
  --condition '{"type":"host","op":"suf","value":".maat.work"}' \
  --action rate_limit --rate-limit-window 60 --rate-limit-requests 120 \
  --rate-limit-keys ip --rate-limit-action deny --yes
vercel firewall publish --yes
```

Los cambios de reglas **se stagean como draft** hasta el `publish`, y `vercel firewall diff --json`
muestra el delta. Eso nos da algo mejor que un gate estático: **un gate que compara el repo contra
la config viva**.

Sobre la **REST API**: existe y sirve, pero `PUT /v1/security/firewall/config` está documentado como
*"Creates or **overwrite** the existing firewall configuration"*. Un script ingenuo en el deploy
borraría cualquier regla hecha a mano. Si se usa, hay que hacer `GET` → merge → `PUT`, y en ese punto
el CLI ya lo hace mejor. Notar además que el schema del body deja `action` como `{"type":"object"}`
genérico (`{"mitigate": {...}}`), o sea que **la forma exacta del rate limit no está tipada en la doc
de la API** — otra razón para preferir el CLI o Terraform, donde sí está.

**Terraform** es el único que da IaC de verdad (state, plan, drift detection). El provider oficial
`vercel/vercel` **v5.14.0 (2026-08-26)** tipa el bloque completo:

```terraform
action = { action = "rate_limit"
  rate_limit = { limit = 100, window = 300, keys = ["ip","ja4"], algo = "fixed_window", action = "deny" } }
```

Los cinco campos (`action`, `algo`, `keys`, `limit`, `window`) son **Required**. No lo recomiendo
para Capa 1: meter Terraform por dos reglas es desproporcionado y agrega un runtime más al stack
cerrado. Queda anotado como salida si algún día hay muchos proyectos.

### 3. Claves vs condiciones — la distinción que importa

El pedido pregunta "qué se puede usar como clave (IP, path, header, geo)". Son **dos cosas
distintas** y conviene no mezclarlas:

- **Condiciones** (qué requests matchea la regla): `path`, `raw_path`, `target_path`, `route`,
  `server_action`, `method`, `host`, `protocol`, `scheme`, `environment`, `region`, `ip_address`,
  `user_agent`, `geo_country`, `geo_continent`, `geo_country_region`, `geo_city`, `geo_as_number`,
  `header`, `cookie`, `query`, `ja4_digest`, `rate_limit_api_id`. Operadores: `eq`, `sub`, `pre`,
  `suf`, `re`, `ex`, `inc`, `gt/gte/lt/lte` y negaciones. AND dentro del grupo, OR entre grupos.
- **Clave de conteo** (por quién se cuenta): en **Pro sólo `ip` y `ja4`**. `header:<name>` y
  User-Agent son **Enterprise**.

Para nosotros alcanza y sobra: la regla de vidriera puede condicionar por `host` (sufijo
`.maat.work`) y la de chatbot por `path` (prefijo de la ruta del chat), y **ambas contar por `ip`**.
Lo que **no** podemos hacer en Pro es contar por `tenant_id` en un header — si algún día hace falta
aislar el rate limit por tenant, ese es el momento de mirar `@vercel/firewall` con `rateLimitKey`,
no de subir a Enterprise.

### 4. Contradicción detectada (y cómo la resuelvo)

La doc del CLI dice `--rate-limit-window <SECONDS>`: **"10 to 3,600"**. La tabla de límites de WAF
Rate Limiting dice que la ventana máxima en **Pro es 10 minutos (600s)**, y que 1hr es Enterprise.

**Pesa más la tabla de límites de plan.** El rango del CLI describe el dominio del flag para todos
los planes; el límite del plan es el que aplica en runtime y el que va a rechazar el `publish`.
**Diseñemos con ventana ≤600s** y, si se quiere 3600, se prueba primero. Nuestro caso usa 60s, así
que la contradicción no nos toca en la práctica.

### 5. Costo — y una ventaja que no es obvia

Rate limiting es **feature pago y usage-based**, pero la unidad es benigna: se facturan **"Allowed
Requests"**, o sea los requests que matchean la regla y pasan. Y hay un ahorro cruzado explícito:

> *"WAF deny, challenge, or rate-limit mitigated traffic does not incur CDN Requests or Fast Data
> Transfer (FDT)."*

Es decir, **el tráfico que la regla bloquea deja de costar Edge Requests** ($2.00–$3.20 por 1M). En
un escenario de abuso, la regla de rate limit **ahorra plata neta**. Lo mismo vale para persistent
actions, DDoS mitigation, Attack Mode e IP blocking, que además son **gratis en todos los planes**.

El riesgo de costo real no es el precio unitario: es el **scoping**. Una regla con condición
`path` = `/(.*)` sobre la vidriera factura **cada pageview** de vidriera a $0.80/1M. Sigue siendo
trivial en nuestro volumen, pero la regla debe apuntar a lo que queremos limitar, no a todo.

### 6. `@vercel/firewall` — mencionado aparte, como pidió el pedido

Es el "Rate Limiting SDK": `checkRateLimit('<rate-limit-id>', { request })` devuelve `{ rateLimited }`.

- **No arrastra store externo.** Verificado contra el registry de npm: `@vercel/firewall@1.2.5`
  (publicado 2026-08-11) tiene `dependencies: {}` y `peerDependencies: {}`. Los contadores los lleva
  Vercel en el edge. **No hay contador en Postgres**, así que no choca con la prohibición del repo.
- **Pero no es autónomo:** requiere que exista una regla en el Firewall con un **Rate limit ID**
  (condición `rate_limit_api_id`), creada por dashboard/CLI/API. O sea que **igual pasás por el
  camino de la config** — el SDK sólo mueve la *decisión de qué contar* al código.
- Su valor es el `rateLimitKey` custom (userId, orgId, o compuesto `${orgId}:${userId}`), que
  **evade la limitación de Pro de contar sólo por IP/JA4**. Guardar este dato: es la salida si
  hiciera falta rate limit por tenant sin ir a Enterprise.
- **Trampa documentada:** el `rateLimitKey` *reemplaza* el bucket por IP. Si pasás un string
  constante, la regla se vuelve **global** para todos los visitantes. Hay un warning explícito en la
  doc. Para per-IP hay que componer la IP dentro de la key a mano.

### 7. Lo que NO es esto (desambiguación pedida)

- `functions.maxDuration` / `headers` / `redirects` en `vercel.json` → routing y runtime, nada que
  ver con el WAF.
- **Attack Challenge Mode** → toggle global de emergencia, no una regla; se prende con
  `vercel firewall attack-mode enable --duration 1h`, aplica **inmediato sin publish**. Gratis.
- **Managed Rulesets / OWASP CRS** → otro feature pago y distinto ($0.80–$1.28 por 1M inspected +
  excess bytes). **No lo estamos pidiendo y no debería prenderse sin decisión aparte.**
- **IP blocking / system bypass** → gratis, otro subcomando, aplica distinto.
- **Edge Config** → store de config, no tiene nada que ver con el Firewall.

## Números que importan

| ítem | valor | unidad | fuente |
|---|---|---|---|
| `mitigate.action` en `vercel.json` | `["challenge","deny"]` | enum cerrado | openapi.vercel.sh/vercel.json |
| `rate_limit` en schema `vercel.json` | 0 | ocurrencias | openapi.vercel.sh/vercel.json |
| Reglas de rate limit — Pro | 40 | por proyecto | docs rate-limiting |
| Reglas de rate limit — Hobby | 1 | por proyecto | docs rate-limiting |
| Claves de conteo — Pro | `ip`, `ja4` | — | docs rate-limiting |
| Claves de conteo — Enterprise | `ip`, `ja4`, UA, header | — | docs rate-limiting |
| Algoritmo — Pro | fixed window | — | docs rate-limiting |
| Ventana — Pro | 10 – 600 | segundos | docs rate-limiting |
| Ventana — flag del CLI | 10 – 3600 | segundos | docs cli/firewall (contradice ↑) |
| Límite de requests | 1 – 10.000.000 | req/ventana | docs cli/firewall |
| Requests incluidos — Pro | 0 (usage-based) | — | docs rate-limiting |
| Requests incluidos — Hobby | 1.000.000 | allowed req | docs rate-limiting |
| Precio rate limit `iad1` | 0.50 | USD / 1M allowed req | pricing iad1 |
| Precio rate limit `gru1` | 0.80 | USD / 1M allowed req | pricing gru1 |
| Tráfico mitigado → CDN Requests/FDT | 0 | USD | docs usage-and-pricing |
| Custom rules / IP blocking / DDoS | gratis | todos los planes | docs usage-and-pricing |
| CLI `vercel firewall` disponible desde | 2026-05-12 | fecha | changelog |
| Vercel CLI última versión | 59.9.1 | 2026-08-27 | registry npm |
| Terraform provider `vercel/vercel` | v5.14.0 | 2026-08-26 | GitHub releases |
| `@vercel/firewall` | 1.2.5 | 2026-08-11 | registry npm |
| `@vercel/firewall` deps + peerDeps | 0 + 0 | paquetes | registry npm |

## Fuentes

- [WAF Rate Limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting) — consultado 2026-08-28 (doc `last_updated: 2026-06-16`)
- [WAF Custom Rules](https://vercel.com/docs/vercel-firewall/vercel-waf/custom-rules) — consultado 2026-08-28 (doc `last_updated: 2026-07-17`)
- [vercel firewall (CLI)](https://vercel.com/docs/cli/firewall) — consultado 2026-08-28 (doc `last_updated: 2026-07-15`)
- [Rate Limiting SDK](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting-sdk) — consultado 2026-08-28 (doc `last_updated: 2026-07-23`)
- [Usage & Pricing for Vercel WAF](https://vercel.com/docs/vercel-firewall/vercel-waf/usage-and-pricing) — consultado 2026-08-28 (doc `last_updated: 2026-06-16`)
- [Using the REST API with the Firewall](https://vercel.com/docs/vercel-firewall/firewall-api) — consultado 2026-08-28 (doc `last_updated: 2026-08-11`)
- [Put Firewall Configuration](https://vercel.com/docs/rest-api/security/put-firewall-configuration) — consultado 2026-08-28 (doc `last_updated: 2026-08-28`)
- [vercel.json JSON Schema (máquina)](https://openapi.vercel.sh/vercel.json) — descargado 2026-08-28, 418.990 bytes
- [Pricing regional gru1](https://vercel.com/docs/pricing/regional-pricing/gru1) — consultado 2026-08-28 (doc `last_updated: 2026-02-13`)
- [Pricing regional iad1](https://vercel.com/docs/pricing/regional-pricing/iad1) — consultado 2026-08-28 (doc `last_updated: 2026-02-13`)
- [Changelog: Manage Vercel Firewall in the CLI](https://vercel.com/changelog/manage-vercel-firewall-in-the-cli) — consultado 2026-08-28 (publicado 2026-05-12)
- [terraform-provider-vercel · firewall_config](https://github.com/vercel/terraform-provider-vercel/blob/main/docs/resources/firewall_config.md) — consultado 2026-08-28
- [registry npm `@vercel/firewall`](https://registry.npmjs.org/@vercel/firewall) — consultado 2026-08-28

## Impacto en iStock

**DECISIONS — ADR nuevo sugerido: "Firewall rules as versioned JSON + CLI apply".**
La premisa de T1 ("o `vercel.json` o bloqueo humano") es una **falsa dicotomía**. Existe un tercer
camino soportado y apto para CI. T1 **no** pasa a bloqueo humano: se implementa ahora.

**ARCHITECTURE:**
- **No crear `vercel.json` para T1.** No sirve para rate limit. Si algún día se crea, será por otra
  razón (crons, regions), y ese archivo es del **LEAD** según §4.
- Las reglas viven en un JSON versionado (propongo `config/firewall-rules.json`, **owner LEAD**, por
  la misma regla de independencia que ya rige para `scripts/**`: el gate no puede ser del writer que
  audita).
- El apply **no es parte del build**. Las reglas del Firewall no requieren redeploy — es un paso
  operativo separado (`vercel firewall rules add/edit` + `publish`), no un side effect de
  `vercel deploy`. Documentar esto evita el bug de creer que un deploy sincroniza el WAF.
- Regla de vidriera: condición `host` sufijo `.maat.work`, clave `ip`, ventana 60s, `deny`.
  Regla de chatbot: condición `path` prefijo de la ruta del chat, clave `ip`, ventana 60s, `deny`.
  Ambas cuentan **por IP**, que es lo único que Pro permite.
- **Contadores per-region.** Documentado dos veces: *"Rate limit counters are tracked on a
  per-region basis; traffic matching a given rate limit key in multiple regions can exceed the limit
  you configure for any single region."* El límite efectivo es *N × regiones*. Para nosotros es casi
  irrelevante (tráfico AR concentrado), pero el límite no debe elegirse asumiendo que es global.

**Gate (T1) — ahora puede ser fuerte, no cosmético.** Dos niveles:
1. **Estático, en cada push:** el JSON existe, parsea, tiene exactamente las 2 reglas, `algo` =
   `fixed_window`, `keys ⊆ {ip, ja4}`, `window ≤ 600`. Todo verificable sin red.
2. **Contra config viva, manual/CI con token:** `vercel firewall rules list --json` o
   `vercel firewall diff --json` y comparar contra el archivo. Esto detecta **drift** — alguien que
   tocó el dashboard a mano.
El nivel 1 solo ya es infinitamente mejor que "verificar que el procedimiento esté escrito".

**COST:** entrada nueva en `docs/COST.md`, para `cost-auditor`.
- Ítem: *Firewall Rate Limit Requests*, **$0.80 / 1M allowed requests** (usar `gru1`, es el
  conservador para AR; `iad1` sería $0.50).
- **Sin allotment gratis en Pro** — se factura desde el request 1 que matchee.
- Estimación: a 100k requests/mes que matcheen las reglas → **USD 0.08/mes en total**, no por tenant.
  Contra el objetivo de <USD 0.50/mes/tenant, es ruido: con 1 tenant representa el 16% del budget de
  ese tenant, con 10 tenants el 1.6%. **No es blocker de costo.**
- **Ahorro cruzado a registrar:** el tráfico mitigado no genera Edge Requests ni FDT. Bajo abuso la
  regla es **neta negativa en costo**.
- **Alerta para `cost-auditor`:** *Managed Rulesets / OWASP CRS* es un feature pago **separado**
  ($0.80–$1.28 por 1M inspected + $0.20–$0.32/GB de payload inspeccionado). **No prenderlo** sin ADR.
  Es el pie en el que este proyecto se puede disparar sin darse cuenta, porque está en la misma
  pantalla del dashboard que lo que sí queremos.

**Riesgo de stack:** ninguno. El camino CLI no agrega dependencias ni runtime. `@vercel/firewall`
**no** hace falta en Capa 1 y **no** habría que instalarlo todavía — pero si se instalara, tiene 0
dependencias y **no viola** la prohibición de contadores en Postgres.

## Confianza

**alta** para las preguntas 1, 3 y 4.

La negativa sobre `vercel.json` es la afirmación más fuerte del doc porque no depende de prosa de
doc sino del **schema JSON oficial que Vercel publica y usa para validar** — `enum` cerrado de dos
valores, `additionalProperties: false`, cero ocurrencias de `rate_limit`. Es exactamente el tipo de
evidencia que el pedido reclamaba para no escribir un `vercel.json` fantasma. Los límites de Pro y
los precios salen de tablas de docs oficiales con `last_updated` reciente.

**media-alta** para el camino CLI en CI. La doc afirma explícitamente que `--json`/`--condition` son
el modo para scripts y CI, y el mecanismo staged→`publish` está documentado. **Lo que no está
verificado es la ejecución real**: no corrí `vercel firewall rules add` contra un proyecto (no hay
proyecto Vercel ni token en este entorno).

**Qué subiría la confianza:** un smoke test real — crear la regla de vidriera con `--json` en un
proyecto de prueba, `vercel firewall diff --json`, `publish`, y confirmar el `429`. Eso también
resolvería la contradicción de ventana 600s vs 3600s de una vez.
**Qué la bajaría:** que el `publish` requiera un rol que el token de CI no tiene. La doc de custom
rules exige *Project administrator*, *Team member* o *Security* para aplicar cambios — **eso hay que
chequearlo antes de prometer un gate automático de nivel 2**.

## UNVERIFIED

- **Que el tráfico argentino se facture a la tarifa `gru1` ($0.80/1M).** La doc dice que el precio
  *"is based on the region(s) from which the requests come from"*, pero **no encontré la tabla que
  mapea país → región de facturación**. Uso `gru1` por conservador. El rango real es $0.50–$0.80.
- **La tabla "Rate limiting pricing"** dentro de `usage-and-pricing` **no renderiza contenido** en la
  versión markdown de la doc (la sección existe con encabezado y viene vacía). Los precios los tomé
  de las páginas de pricing regional, que sí los listan explícitamente. Si alguna vez discrepan,
  manda la página regional.
- **Forma exacta del objeto `action.mitigate` para rate limit en la REST API.** El schema publicado
  del `PUT` deja `action` como `{"type":"object"}` genérico. La forma la infiero del CLI y de
  Terraform, que coinciden entre sí (`limit`/`window`/`keys`/`algo`/`action`). Otra razón para no
  usar la REST API cruda.
- **Permisos del token de CI para `vercel firewall publish`.** No verificado qué scope mínimo hace
  falta. Bloquea el gate de nivel 2, no el de nivel 1.
- **Si el `publish` rechaza `window > 600` en Pro** o si lo acepta y falla en runtime. No testeado.
- **Resolución de ventana/límite exacta bajo contadores per-region** con tráfico multi-región. No
  testeado.
