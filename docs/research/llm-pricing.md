# R3 - Gemini Flash-Lite y Groq: IDs exactos de modelo y USD por millon de tokens
_Consultado: 2026-08-27 - Agente: researcher_

## Pregunta

Para el chatbot de vidriera con dieta dura de **1200 tokens in / 180 out por turno**, a volumen de
**60.000 mensajes/mes**: cual es HOY el modelo mas barato utilizable, con **ID exacto de API**,
precio USD/1M tokens, free tier, latencia, compatibilidad con Vercel AI SDK y politica de retencion
de datos. Claude y GPT frontier estan prohibidos en el hot path (`CLAUDE.md` §3).

## Respuesta corta

- **`gemini-2.5-flash-lite` sigue siendo el mas barato de Google: USD 0.10 in / 0.40 out por 1M.**
  A nuestro volumen: **USD 11.52/mes**. Ningun modelo Gemini es mas barato hoy.
- **NO existe un Lite mas nuevo Y mas barato.** Los sucesores son *mas caros*:
  `gemini-3.1-flash-lite` USD 0.25/1.50 (**USD 34.20/mes**) y `gemini-3.5-flash-lite` USD 0.30/2.50
  (**USD 48.60/mes**). Subir de version 2.5 -> 3.1 nos **triplica** el costo del chatbot.
- **BLOQUEANTE DE STACK: `llama-3.1-8b-instant` esta MUERTO en Groq desde el 16/08/2026** para free
  y developer tier. El reemplazo oficial que publica Groq es **`openai/gpt-oss-20b`**. `CLAUDE.md`
  §3 nombra un modelo que ya no se puede llamar; hay que corregirlo.
- **`openai/gpt-oss-20b` (Groq) es el mas barato del set: USD 0.075 in / 0.30 out -> USD 8.64/mes**,
  y el mas rapido en generacion (932 t/s). **Pero la ventaja de costo es de solo USD 2,88/mes, y con
  prompt caching contado en los dos lados baja a USD 0,99/mes** (§4). **Fallback, no primario:**
  Gemini gana por TTFT (0.28 s vs 2.98 s), que es lo que percibe el visitante.
- **Latencia para vidriera en vivo:** `gemini-2.5-flash-lite` con thinking OFF = TTFT 0.28 s.
  `gemini-3.1-flash-lite` mide **TTFT 5.45 s** porque tiene thinking que **no se puede apagar**
  (minimo `thinking_level: "minimal"`). Para un chat de vidriera eso es inaceptable.
- **Retencion:** usar **tier PAGO** de Gemini (el free tier entrena con nuestros prompts -> prohibido
  con datos de clientes). Groq: sin retencion por default, logs <=30 dias, ZDR self-serve.
- Presupuesto realista del chatbot a 60k msgs/mes: **USD 9-12/mes**. Contra plan Negocio de USD 35,
  el LLM es **0,8-1,1% del ingreso** si un tenant hace ~2.000 msgs/mes (USD 0,29-0,38/tenant/mes).

## Detalle

### 1. Google Gemini: el Flash-Lite mas barato hoy

| ID exacto (string de API) | Input USD/1M | Output USD/1M | Free tier | Thinking |
|---|---|---|---|---|
| `gemini-2.5-flash-lite` | 0.10 (texto/img/video), 0.30 (audio) | 0.40 | Si | **Off por default** |
| `gemini-3.1-flash-lite` | 0.25 (texto/img/video), 0.50 (audio) | 1.50 | Si | **On (minimal)**, no apagable |
| `gemini-3.5-flash-lite` | 0.30 | 2.50 | Si | **On (minimal)**, no apagable |

Fuente del estado de thinking (dos tablas oficiales distintas, ambas consultadas 2026-08-27):
- La tabla *Controlling thinking* de `docs/thinking` (Interactions API) da
  `gemini-2.5-flash-lite | Default Thinking: Off | Levels: low, medium, high` y
  `gemini-3.5-flash-lite | On (minimal)`. **Esa tabla no tiene fila para `gemini-3.1-flash-lite`.**
- La tabla de niveles de `docs/generate-content/thinking` **si lo cubre explicitamente**, en una
  columna rotulada **"Gemini 3.5 & 3.1 Flash-Lite"**: `minimal = Supported (Default)`,
  `low/medium/high = Supported`. **No hay opcion "off"** para esa familia. La misma pagina advierte:
  *"minimal does not guarantee that thinking is off, the model may reason very minimally for complex
  tasks."* Es decir: el "On (minimal), no apagable" de 3.1 Flash-Lite **es dato de tabla oficial**,
  no extrapolacion (ver `## Refutaciones al review`).

Fuente: pagina oficial de pricing de la Gemini API y pagina oficial de modelos, ambas consultadas
2026-08-27. Los IDs son los strings estables sin sufijo de fecha.

Notas relevantes:
- **`gemini-2.5-flash-lite` es el input mas barato del catalogo entero de Gemini** (verificado contra
  la pricing page: no hay nada por debajo de USD 0.10/1M input).
- **Context caching SI esta cotizado para `gemini-2.5-flash-lite`** (correccion respecto de la v1 de
  este doc, que decia "no disponible" leyendo la columna Free Tier en vez de la Paid). La fila
  `Context caching price` de la pricing page dice, textual: *Free Tier: "Not available"* ·
  *Paid Tier: "$0.01 (text / image / video) $0.03 (audio) $1.00 / 1,000,000 tokens per hour (storage
  price)"*. O sea: **input cacheado a USD 0.01/1M = 10x mas barato que el input normal (0.10)**, mas
  un alquiler de USD 1.00 por 1M de tokens por hora. Para 3.5 Flash-Lite la misma fila es
  `$0.03 + $1.00/1M/hora`.
- **Pero a nuestra dieta de 1200 tokens el caching de Gemini no aplica, por dos razones medibles:**
  1. **Umbral minimo.** La doc de caching publica una tabla de `Min token limit` para implicit
     caching: 4.096 (3.7/3.6/3.5 Flash, 3.1 Pro Preview) y 2.048 (2.5 Flash, 2.5 Pro).
     **Ningun Flash-Lite figura en esa tabla.** Nuestro prompt de 1200 tokens esta **por debajo del
     minimo mas bajo publicado**, asi que un hit es improbable y el minimo real para
     `gemini-2.5-flash-lite` queda `UNVERIFIED`.
  2. **La aritmetica del storage nos mata.** El caching explicito cobra alquiler por hora y por
     contexto. Un prompt de sistema + catalogo de ~1.000 tokens cacheado 24/7 cuesta
     `0,001M x USD 1.00/h x 730 h = USD 0,73/mes` **por tenant**. Con 30 tenants son
     **USD 21,90/mes de storage**, contra un ahorro maximo de **USD 5,40/mes** de input a nuestro
     volumen total. **Caching explicito por tenant = perdida neta de ~USD 16/mes.** No se hace.
  Conclusion operativa (igual que antes, pero ahora por el motivo correcto): **el prompt de sistema
  + catalogo se paga entero en cada turno**, y la dieta de 1200 in sigue siendo la unica proteccion.
- **Batch API = 50% off** (0.05/0.20). **No sirve para el chatbot** (es sincronico y en vivo); si
  sirve para el pipeline de embeddings/seed de `catalog_models`.
- Cuidado con IDs viejos: `gemini-3.1-flash-lite-preview` **fue apagado el 25/05/2026** y
  `gemini-2.0-flash-lite` **fue apagado el 01/06/2026**. Ninguno de los dos se puede usar.

#### Free tier de Gemini (RPM/TPM/RPD): Google dejo de publicarlo
La pagina oficial de rate limits **ya no publica tablas por modelo**. Dice literalmente que los
limites "dependen de varios factores (como tu usage tier) y se pueden ver en Google AI Studio", y
linkea a `aistudio.google.com/rate-limit`. Lo que si publica son las **condiciones de tier**:

| Tier | Como se califica | Cap de gasto |
|---|---|---|
| Free | proyecto activo o free trial | **N/A** (no aplica: no hay facturacion) |
| Tier 1 | vincular billing account activa | USD 250 |
| Tier 2 | USD 100 pagados + 3 dias desde el primer pago | USD 2.000 |
| Tier 3 | USD 1.000 pagados + 30 dias | USD 20.000-100.000+ |

La misma pagina publica **spend-based rate limits en ventana rodante de 10 minutos**: Free `N/A`,
Tier 1 **USD 10**, Tier 2 **USD 50**, Tier 3 **USD 200**; pasarse devuelve `429 RESOURCE_EXHAUSTED`.
A nuestro volumen (USD ~11,52/**mes**) es irrelevante, pero conviene tenerlo escrito para el dia que
alguien dispare un backfill.

Los numeros concretos de RPM/TPM/RPD del free tier que circulan (15 RPM / 250K-1M TPM / 1.000-1.500
RPD para Flash-Lite) vienen **solo de blogs de terceros que se contradicen entre si**. Van a
`UNVERIFIED`. **Igual no importa para la decision**: el free tier de Gemini se entrena con nuestros
datos (ver §7), asi que **no es usable** para conversaciones con clientes reales.

### 2. Hay un modelo mas nuevo y mas barato que 2.5 Flash-Lite?

**No.** Verificado enumerando **los 30 model IDs** de la pricing page oficial el 2026-08-27. Los
modelos de texto mas baratos por input, en orden:

| # | Modelo | Input USD/1M (texto) | Output USD/1M |
|---|---|---|---|
| 1 | `gemini-2.5-flash-lite` | **0.10** | 0.40 |
| 2 | `gemini-3.1-flash-lite` | 0.25 | 1.50 |
| 3 | `gemini-3.5-flash-lite` | 0.30 | 2.50 |
| 3 (empate) | `gemini-2.5-flash` | 0.30 | 2.50 |
| 5 | `gemini-3-flash-preview` | 0.50 | 3.00 |

(Correccion respecto de la v1 de este doc: la lista original omitia `gemini-2.5-flash`, que empata
en input con 3.5 Flash-Lite y es **mas barato** que `gemini-3-flash-preview`. No cambia la conclusion.)

Los sucesores mas nuevos son todavia mas caros: `gemini-3.6-flash` y `gemini-3.7-flash` cotizan
**USD 0.75 in / 3.75 out hasta el 31/12/2026 y USD 1.50 / 7.50 desde el 01/01/2027**.
**Nada en todo el catalogo baja de USD 0.10/1M de input.** La tendencia de Google es clara: **cada
generacion de Lite es mas cara que la anterior**, porque ahora vienen con thinking encendido por
default y el precio de output absorbe los thinking tokens.

**Riesgo de fecha (contradiccion entre fuentes de Google):**
- La **pagina oficial de deprecations de la Gemini API** (fuente primaria, consultada 2026-08-27)
  dice para `gemini-2.5-flash-lite`: release 22/07/2025, **"No shutdown date announced"**.
- Multiples fuentes secundarias y el ciclo de vida de **Vertex AI / Gemini Enterprise** indican
  retiro el **16/10/2026** (release notes) o el **20/10/2026** (lifecycle page), con
  `gemini-3.1-flash-lite` como reemplazo.

**Cual pesa mas:** la deprecations page de *la Gemini API* (que es la superficie que consumimos con
`@ai-sdk/google`, no Vertex). Pero **las dos cosas pueden ser ciertas a la vez**: Vertex AI y la
Gemini API tienen calendarios de retiro distintos. **Postura recomendada: planificar como si
`gemini-2.5-flash-lite` se apagara en octubre 2026**, porque el downside (chatbot caido en
produccion) es mucho peor que el costo de tener el fallback listo. Concretamente: el ID del modelo
tiene que ser **env var, no constante hardcodeada**, y el fallback de Groq tiene que estar probado.

Como referencia: `gemini-3.1-flash-lite` (release 07/05/2026) ya tiene shutdown anunciado para
**07/05/2027**, con reemplazo `gemini-3.5-flash-lite`. El ciclo de vida de estos modelos es de ~12
meses. **Ningun ID de modelo puede vivir hardcodeado en el codigo.**

### 3. Groq: IDs vigentes, precios y limites

| ID exacto | Estado hoy | Input USD/1M | Cached in | Output USD/1M | Velocidad |
|---|---|---|---|---|---|
| `llama-3.1-8b-instant` | **RETIRADO 16/08/2026** en free/dev | ContactSales | - | ContactSales | ~560 t/s |
| `openai/gpt-oss-20b` | Production | 0.075 | 0.0375 | 0.30 | ~1000 t/s |
| `openai/gpt-oss-120b` | Production | 0.15 | - | 0.60 | ~500 t/s |
| `llama-3.3-70b-versatile` | **RETIRADO 16/08/2026** en free/dev | ContactSales | - | ContactSales | ~280 t/s |

La deprecations page oficial de Groq dice textual para `llama-3.1-8b-instant`: shutdown `08/16/26`,
reemplazo recomendado `openai/gpt-oss-20b`, y la nota *"This deprecation applies to free and
developer-tier usage; enterprise customers with a committed-spend contract are not affected."*
Coherente con la models page, que **ya lista `llama-3.1-8b-instant` con precio `ContactSales` y
etiqueta Enterprise**, no con tarifa por token.

**Contradiccion detectada:** varios agregadores de precios (aipricing.guru, cloudzero, portkey,
helicone, etc.) siguen publicando `llama-3.1-8b-instant` a **USD 0.05 in / 0.08 out**. **Pesan menos**
que las docs oficiales de Groq por dos razones: (a) son secundarios, y (b) la models page oficial
*hoy* muestra `ContactSales` en esa fila, lo que confirma que el modelo salio del catalogo
self-serve. Ese precio de 0.05/0.08 es historico y **no lo podemos presupuestar**.

- `openai/gpt-oss-20b`: contexto 131.072, max completion 65.536, tool use + JSON mode + browser
  search + reasoning. Es un **modelo de razonamiento**: los reasoning tokens se facturan como output.
  Hay que forzar `reasoning_effort` bajo o la dieta de 180 out se rompe (ver §4).
- `llama-3.1-8b-instant` mientras existio: contexto 131.072, tool use y JSON mode. Ya no aplica.

**Free tier de Groq (numeros oficiales, para `openai/gpt-oss-20b`):**
`RPM: 30 · RPD: 1K · TPM: 8K · TPD: 200K`.

Nuestra demanda son ~2.000 mensajes/dia ≈ **2.76M tokens/dia**. El free tier (200K TPD) cubre **~7%
de un solo dia**. **El free tier de Groq no sirve ni para el fallback en produccion.**

**Developer tier:** los limites base publicados en la models page para `openai/gpt-oss-20b` son
**250K TPM / 1K RPM**. Fuentes secundarias afirman que Developer no tiene fee mensual (pay-as-you-go
puro, se factura en arrears) y que sube limites ~10x; **eso no lo pude confirmar en pagina oficial**
-> va a UNVERIFIED. A 250K TPM tenemos techo de ~180 mensajes/minuto de nuestra dieta: sobra.

### 4. Calculo directo: 60.000 mensajes/mes, 1200 in / 180 out

Volumen mensual: **72,0M tokens input** + **10,8M tokens output**.

| Opcion (ID exacto) | Input USD | Output USD | **Total USD/mes** | USD por mensaje |
|---|---|---|---|---|
| `openai/gpt-oss-20b` (Groq) | 5.40 | 3.24 | **8.64** | 0.000144 |
| `gemini-2.5-flash-lite` | 7.20 | 4.32 | **11.52** | 0.000192 |
| `openai/gpt-oss-120b` (Groq) | 10.80 | 6.48 | **17.28** | 0.000288 |
| `gemini-3.1-flash-lite` | 18.00 | 16.20 | **34.20** | 0.000570 |
| `gemini-3.5-flash-lite` | 21.60 | 27.00 | **48.60** | 0.000810 |
| ~~`llama-3.1-8b-instant`~~ (no disponible) | 3.60 | 0.86 | ~~4.46~~ | n/a |

Ajustes que hay que tener en la cabeza (son **estimaciones**, marcadas UNVERIFIED):
- **`gpt-oss-20b` con reasoning:** si el modelo emite ~150 reasoning tokens por turno ademas de los
  180 de respuesta, el output pasa a 19,8M -> USD 5.94, total **~USD 11.3/mes**. Empata con Gemini
  2.5 Flash-Lite. Hay que medirlo con eval real y bajar `reasoning_effort`.
- **Prompt caching, comparado de forma simetrica en los dos proveedores** (la v1 de este doc solo se
  lo daba a Groq; eso era una comparacion tramposa). Con el supuesto identico de **50% del input
  cacheado**:

  | Escenario | Input USD | Output USD | Total USD/mes |
  |---|---|---|---|
  | `gpt-oss-20b` sin cache | 5.40 | 3.24 | 8.64 |
  | `gpt-oss-20b` 50% cacheado (0.0375) | 4.05 | 3.24 | **7.29** |
  | `gemini-2.5-flash-lite` sin cache | 7.20 | 4.32 | 11.52 |
  | `gemini-2.5-flash-lite` 50% cacheado (0.01) | 3.96 | 4.32 | **8.28** (+ storage) |

  Con caching en ambos lados la brecha se achica de **USD 2,88 a USD 0,99/mes**: el argumento de
  costo a favor de Groq **se debilita mucho**. Pero las dos filas cacheadas **no son iguales de
  creibles**, y la diferencia esta documentada:
  - **Groq**: caching *automatico*, sin fee adicional, **50% off** en el prefijo cacheado,
    minimo cacheable **"ranging from 128 to 1024 tokens depending on the specific model"**, expira a
    las **2 horas** sin uso, y *"cached tokens do not count toward your rate limits"*. Nuestra dieta
    de 1200 tokens **esta por encima de ese umbral** -> el descuento es plausible.
    Salvedad textual de Groq: *"Groq tries to maximize cache hits, but this is not guaranteed."*
  - **Gemini**: el implicit caching publica minimos de **2.048-4.096 tokens** y **no lista ningun
    Flash-Lite**; nuestros 1200 tokens quedan debajo. El explicit caching agrega
    **USD 1.00/1M tokens/hora de storage**, que a 30 tenants son ~USD 21,90/mes contra USD 5,40 de
    ahorro. -> **La fila cacheada de Gemini es teorica; la de Groq es plausible.** Ambas se miden con
    los campos de `usage` en el primer eval, no se presupuestan.
- **`gemini-3.1-flash-lite` con thinking minimal:** si agrega ~120 thinking tokens/turno, el output
  sube a 18,0M -> USD 27.00, total **~USD 45/mes**. Es decir: migrar a 3.1 no cuesta 3x, cuesta ~4x.
- El Batch API (50% off en ambos proveedores) **no aplica** a un chat en vivo.

Escala por tenant: si un tenant del plan Negocio (USD 35/mes) genera 2.000 mensajes/mes, el costo de
LLM es **USD 0.29 (gpt-oss-20b)** o **USD 0.38 (2.5 Flash-Lite)**. Margen sano. El riesgo no es el
precio unitario: es un tenant con vidriera viral o un bot scrapeando el chat. **Rate limit por IP y
por tenant es requisito, no opcional.**

### 5. Latencia tipica reportada

| Modelo / provider | TTFT | Output t/s | Fuente |
|---|---|---|---|
| `gemini-2.5-flash-lite` (non-reasoning) | **0.28 s** | 341.7 | Artificial Analysis |
| `openai/gpt-oss-20b` en Groq | **2.98 s** (time to first *answer* token) | **932.1** | Artificial Analysis |
| `gemini-3.1-flash-lite` (con thinking) | **5.45 s** | n/d | Artificial Analysis |
| `gpt-oss-120b` en Groq | 0.91 s | n/d | Artificial Analysis |

Lectura para vidriera:
- **`gemini-2.5-flash-lite` con thinking off es el mejor perfil de latencia percibida**: 0.28 s a
  primer token, y con streaming el visitante ve texto casi instantaneo.
- Los 2.98 s de `gpt-oss-20b` en Groq son **time to first *answer* token**, o sea despues del bloque
  de reasoning. Con `reasoning_effort` bajo eso deberia caer bastante, pero **hay que medirlo**. Una
  vez que arranca, 932 t/s significa que los 180 tokens de respuesta salen en **~0.2 s**: la respuesta
  completa llega antes que con cualquier Gemini.
- **`gemini-3.1-flash-lite` a 5.45 s de TTFT es descalificatorio** para un chat de vidriera. Si nos
  fuerzan a migrar de 2.5, el sucesor natural **no es 3.1 Flash-Lite: es Groq**.
- Artificial Analysis es **fuente secundaria** (benchmark independiente, no doc oficial). Ni Google ni
  Groq publican SLA de latencia. Confianza media en estos numeros; validar con nuestro propio eval
  desde region us-east antes de cerrar la decision.

### 6. Compatibilidad con Vercel AI SDK

| Provider | Paquete npm | Env var | Tool calling | Tool streaming | Object generation |
|---|---|---|---|---|---|
| Google Gemini | `@ai-sdk/google` | `GOOGLE_GENERATIVE_AI_API_KEY` | si | si | si |
| Groq | `@ai-sdk/groq` | `GROQ_API_KEY` | si | si | si |

- `@ai-sdk/google` apunta por default a `https://generativelanguage.googleapis.com/v1beta` y manda la
  key en el header `x-goog-api-key`. Se puede customizar con `createGoogleGenerativeAI`.
- `@ai-sdk/groq`: `openai/gpt-oss-20b` y `openai/gpt-oss-120b` soportan tool usage, tool streaming y
  object generation, **mas** la browser search tool (que nosotros **no** queremos: el chatbot de
  vidriera no navega la web, solo consulta nuestro catalogo via tools).
- **Cosas que NO funcionan / a mirar:**
  - Browser search **solo** existe en los `openai/gpt-oss*`. En otros modelos el SDK tira warning y
    la ignora silenciosamente.
  - Structured outputs: la doc del provider dice textual *"Structured outputs are enabled by default
    for Groq models. You can disable them by setting the `structuredOutputs` option to `false`."* y
    advierte *"Structured outputs are only supported by newer Groq models like
    `moonshotai/kimi-k2-instruct-0905`. For unsupported models, you can disable structured outputs by
    setting `structuredOutputs: false`. When disabled, Groq uses the `json_object` format which
    requires the word 'JSON' to be included in your messages."*
    (`ai-sdk.dev/providers/ai-sdk-providers/groq`, 2026-08-27). **UNVERIFIED**: si
    `openai/gpt-oss-20b` cae del lado "supported" o "unsupported" — la doc no lo nombra en ninguna de
    las dos listas. Hay que probarlo en el eval antes de depender de `Output.object`.
  - `reasoning_effort` en `@ai-sdk/groq` para `gpt-oss20b/gpt-oss120b` acepta **`low` / `medium` /
    `high`**. **No hay valor `none`** para esa familia (`none` existe solo para `qwen/qwen3.6-27b`).
    O sea: **el reasoning de `gpt-oss-20b` no se puede apagar, solo bajar a `low`.** Eso refuerza que
    los reasoning tokens hay que medirlos, no asumirlos.
  - `serviceTier` de Groq: `on_demand` (default) · `performance` · `flex` (*"Higher throughput tier
    (10x rate limits)"*) · `auto`. Relevante si el fallback tiene que absorber un pico.
  - Gemini 3.x: `thinking_level` reemplaza a `thinking_budget`. La Gemini 3 developer guide dice
    textual: *"You cannot use both `thinking_level` and the legacy `thinking_budget` parameter in the
    same request. Doing so will return a 400 error."* y, en su FAQ, *"Yes, `thinking_budget` is still
    supported for backward compatibility, but we recommend migrating to `thinking_level` (...) Don't
    use both in the same request."* (`ai.google.dev/gemini-api/docs/gemini-3`, 2026-08-27).
    Nuestro codigo de fallback tiene que ramificar por familia de modelo, no mandar ambos
    "por las dudas".
  - `thinking_level` se ignora silenciosamente en **`gemini-3.1-flash-lite-preview`** (el ID preview,
    ya apagado — no el estable) cuando hay input de audio: issue **abierto** `googleapis/python-genai#2204`,
    creado 2026-03-25, labels `type: bug` / `priority: p2`, verificado via API de GitHub el 2026-08-27:
    <https://github.com/googleapis/python-genai/issues/2204>. **No nos afecta: no mandamos audio.**

Config minima (no es codigo de app, es shape de env):

```
LLM_PRIMARY_MODEL=gemini-2.5-flash-lite
LLM_FALLBACK_MODEL=openai/gpt-oss-20b
GOOGLE_GENERATIVE_AI_API_KEY=...
GROQ_API_KEY=...
```

El ID del modelo **va en env var**. Un ID hardcodeado se rompe solo en la proxima deprecacion (y ya
tenemos dos deprecaciones confirmadas en los ultimos 3 meses).

### 7. Retencion de datos en el tier que usariamos

**Google Gemini API - free tier ("Unpaid Services"):**
Google usa el contenido enviado y las respuestas para *"provide, improve, and develop Google products
and services and machine learning technologies"*. Los terminos dicen explicitamente:
*"Do not submit sensitive, confidential, or personal information to the Unpaid Services."*
-> **Prohibido para iStock.** El chat de vidriera recibe nombres, telefonos y consultas de clientes
reales. Usar free tier seria filtrar datos de clientes de nuestros tenants a un pipeline de
entrenamiento de Google.

**Google Gemini API - paid tier:**
*"Google doesn't use your prompts... or responses to improve our products."* Logging acotado *"for a
limited period of time, solely for detecting and preventing violations"* de la Prohibited Use Policy.
Grounding con Google Search / Maps retiene **30 dias** (no usamos grounding). La metadata de uso
(tokens, metricas, errores) sigue la privacy policy general de Google.
-> **Requisito duro: billing habilitado desde el dia 1.** No hay "arrancamos en free y despues
migramos".

**Groq (free y developer):**
*"By default, Groq does not retain customer data for inference requests."* Logs temporales solo para
troubleshooting de fallas o investigacion de abuso, retenidos **hasta 30 dias** salvo obligacion
legal. No entrenan ni fine-tunean con inputs/outputs de clientes sin permiso explicito. Ademas
*"All customers may enable Zero Data Retention (ZDR)"* self-serve desde Data Controls.
-> **Groq tiene mejor postura de privacidad que el paid tier de Gemini**, y ZDR se activa solo.
Accion concreta: **activar ZDR en la cuenta de Groq antes del primer request de produccion.**

Independiente del proveedor, sigue vigente `CLAUDE.md` §8: **IMEI, `cost_usd`, `margin` e
`internal_notes` nunca entran al contexto del chatbot**, aunque el proveedor prometa no retener nada.
La mejor politica de retencion es no mandar el dato.

## Numeros que importan

| item | valor | unidad | fuente |
|---|---|---|---|
| `gemini-2.5-flash-lite` input | 0.10 | USD/1M tokens | ai.google.dev pricing, 2026-08-27 |
| `gemini-2.5-flash-lite` output | 0.40 | USD/1M tokens | ai.google.dev pricing, 2026-08-27 |
| `gemini-3.1-flash-lite` input / output | 0.25 / 1.50 | USD/1M tokens | ai.google.dev pricing, 2026-08-27 |
| `gemini-3.5-flash-lite` input / output | 0.30 / 2.50 | USD/1M tokens | ai.google.dev pricing, 2026-08-27 |
| Gemini Batch API descuento | 50 | % | ai.google.dev pricing, 2026-08-27 |
| Context caching `gemini-2.5-flash-lite` (input cacheado, paid tier) | 0.01 (texto/img/video), 0.03 (audio) | USD/1M tokens | ai.google.dev/gemini-api/docs/pricing, 2026-08-27 |
| Context caching `gemini-2.5-flash-lite` (storage) | 1.00 | USD/1M tokens/hora | ai.google.dev/gemini-api/docs/pricing, 2026-08-27 |
| Context caching `gemini-2.5-flash-lite` en Free Tier | Not available | - | ai.google.dev/gemini-api/docs/pricing, 2026-08-27 |
| Min token limit para implicit caching (los que Google publica) | 2.048 (2.5 Flash/Pro) - 4.096 (3.x Flash) | tokens | ai.google.dev/gemini-api/docs/caching, 2026-08-27 |
| Min token limit para Flash-Lite | no publicado | - | ai.google.dev/gemini-api/docs/caching, 2026-08-27 |
| Min cacheable prompt en Groq | 128-1024 (varia por modelo) | tokens | console.groq.com/docs/prompt-caching, 2026-08-27 |
| Expiracion de cache en Groq | 2 | horas sin uso | console.groq.com/docs/prompt-caching, 2026-08-27 |
| `gemini-2.5-flash` input / output | 0.30 / 2.50 | USD/1M tokens | ai.google.dev/gemini-api/docs/pricing, 2026-08-27 |
| `gemini-3.6-flash` / `gemini-3.7-flash` input | 0.75 (hasta 31/12/2026), 1.50 (desde 01/01/2027) | USD/1M tokens | ai.google.dev/gemini-api/docs/pricing, 2026-08-27 |
| Thinking default `gemini-2.5-flash-lite` | Off | - | ai.google.dev/gemini-api/docs/thinking, 2026-08-27 |
| Thinking default `gemini-3.1-flash-lite` | minimal (Supported/Default), sin opcion off | - | ai.google.dev/gemini-api/docs/generate-content/thinking, 2026-08-27 |
| `thinking_budget` + `thinking_level` en el mismo request | 400 | codigo HTTP | ai.google.dev/gemini-api/docs/gemini-3, 2026-08-27 |
| `openai/gpt-oss-20b` input / cached / output | 0.075 / 0.0375 / 0.30 | USD/1M tokens | console.groq.com/docs/model/openai/gpt-oss-20b, 2026-08-27 |
| `openai/gpt-oss-120b` input / output | 0.15 / 0.60 | USD/1M tokens | console.groq.com/docs/models, 2026-08-27 |
| `llama-3.1-8b-instant` shutdown | 2026-08-16 | fecha | console.groq.com/docs/deprecations, 2026-08-27 |
| `llama-3.1-8b-instant` precio hoy | ContactSales (Enterprise) | - | console.groq.com/docs/models, 2026-08-27 |
| `gemini-3.1-flash-lite-preview` shutdown | 2026-05-25 | fecha | ai.google.dev models, 2026-08-27 |
| `gemini-2.0-flash-lite` shutdown | 2026-06-01 | fecha | ai.google.dev deprecations, 2026-08-27 |
| `gemini-3.1-flash-lite` shutdown anunciado | 2027-05-07 | fecha | ai.google.dev deprecations, 2026-08-27 |
| Groq free tier gpt-oss-20b | 30 RPM / 1K RPD / 8K TPM / 200K TPD | limites | console.groq.com/docs/rate-limits, 2026-08-27 |
| Groq dev tier gpt-oss-20b | 250K TPM / 1K RPM | limites | console.groq.com/docs/models, 2026-08-27 |
| Gemini Tier 1 (billing linkeado) cap | 250 | USD | ai.google.dev rate-limits, 2026-08-27 |
| Gemini Free tier: billing tier cap | N/A (no aplica) | - | ai.google.dev rate-limits, 2026-08-27 |
| Gemini spend rate limit Tier 1 | 10 | USD / 10 min | ai.google.dev rate-limits, 2026-08-27 |
| LLM como % del plan Negocio (USD 35, 2.000 msgs/mes) | 0,8-1,1 | % del ingreso | calculo propio (0,288/35 y 0,384/35) |
| Consumo mensual del caso | 72.0 / 10.8 | M tokens in / out | calculo propio |
| **Costo `openai/gpt-oss-20b`** | **8.64** | USD/mes | calculo sobre precio oficial |
| **Costo `gemini-2.5-flash-lite`** | **11.52** | USD/mes | calculo sobre precio oficial |
| Costo `gemini-3.1-flash-lite` | 34.20 | USD/mes | calculo sobre precio oficial |
| Costo `gemini-3.5-flash-lite` | 48.60 | USD/mes | calculo sobre precio oficial |
| TTFT `gemini-2.5-flash-lite` (non-reasoning) | 0.28 | s | artificialanalysis.ai, 2026-08-27 |
| TTFT `gemini-3.1-flash-lite` | 5.45 | s | artificialanalysis.ai, 2026-08-27 |
| Time-to-first-answer-token gpt-oss-20b @ Groq | 2.98 | s | artificialanalysis.ai, 2026-08-27 |
| Output speed gpt-oss-20b @ Groq | 932.1 | tokens/s | artificialanalysis.ai, 2026-08-27 |
| Retencion logs Groq | <=30 | dias | console.groq.com/docs/your-data, 2026-08-27 |
| Gemini paid tier: entrena con prompts | no | - | ai.google.dev/gemini-api/terms, 2026-08-27 |
| Gemini free tier: entrena con prompts | si | - | ai.google.dev/gemini-api/terms, 2026-08-27 |

## Fuentes

- [Gemini API - Pricing](https://ai.google.dev/gemini-api/docs/pricing) - consultado 2026-08-27 (primaria)
- [Gemini API - Models](https://ai.google.dev/gemini-api/docs/models) - consultado 2026-08-27 (primaria)
- [Gemini API - Deprecations](https://ai.google.dev/gemini-api/docs/deprecations) - consultado 2026-08-27 (primaria)
- [Gemini API - Rate limits y usage tiers](https://ai.google.dev/gemini-api/docs/rate-limits) - consultado 2026-08-27 (primaria)
- [Gemini API - Thinking (Interactions API)](https://ai.google.dev/gemini-api/docs/thinking) - consultado 2026-08-27 (primaria; tabla *Controlling thinking*)
- [Gemini API - Thinking (Generate Content API, legacy)](https://ai.google.dev/gemini-api/docs/generate-content/thinking) - consultado 2026-08-27 (primaria; tabla de niveles por familia y tabla de `thinkingBudget`)
- [Gemini API - Gemini 3 developer guide](https://ai.google.dev/gemini-api/docs/gemini-3) - consultado 2026-08-27 (primaria; el 400 de `thinking_level` + `thinking_budget`)
- [Gemini API - Context caching](https://ai.google.dev/gemini-api/docs/caching) - consultado 2026-08-27 (primaria; tabla de `Min token limit`)
- [Gemini API - Additional Terms of Service](https://ai.google.dev/gemini-api/terms) - consultado 2026-08-27 (primaria)
- [Gemini 3.1 Flash-Lite Preview (shut down)](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite-preview) - consultado 2026-08-27 (primaria)
- [GroqDocs - Models](https://console.groq.com/docs/models) - consultado 2026-08-27 (primaria)
- [GroqDocs - Deprecations](https://console.groq.com/docs/deprecations) - consultado 2026-08-27 (primaria)
- [GroqDocs - Rate limits](https://console.groq.com/docs/rate-limits) - consultado 2026-08-27 (primaria)
- [GroqDocs - Model: llama-3.1-8b-instant](https://console.groq.com/docs/model/llama-3.1-8b-instant) - consultado 2026-08-27 (primaria)
- [GroqDocs - Model: openai/gpt-oss-20b](https://console.groq.com/docs/model/openai/gpt-oss-20b) - consultado 2026-08-27 (primaria)
- [GroqDocs - Your Data in GroqCloud](https://console.groq.com/docs/your-data) - consultado 2026-08-27 (primaria)
- [GroqDocs - Prompt Caching](https://console.groq.com/docs/prompt-caching) - consultado 2026-08-27 (primaria)
- [googleapis/python-genai issue #2204 - `thinking_level` silently ignored when audio input is present](https://github.com/googleapis/python-genai/issues/2204) - estado `open` verificado via API de GitHub 2026-08-27 (primaria del repo, no de Google docs)
- [AI SDK - Groq Provider](https://ai-sdk.dev/providers/ai-sdk-providers/groq) - consultado 2026-08-27 (primaria)
- [AI SDK - Google Generative AI Provider](https://ai-sdk.dev/providers/ai-sdk-providers/google-generative-ai) - consultado 2026-08-27 (primaria; el path sin `/v5` dio 404 en fetch directo, contenido verificado via `/v5/providers/ai-sdk-providers/google-generative-ai`)
- [Artificial Analysis - Gemini 2.5 Flash-Lite](https://artificialanalysis.ai/models/gemini-2-5-flash-lite) - consultado 2026-08-27 (secundaria, benchmark independiente)
- [Artificial Analysis - gpt-oss-20b providers](https://artificialanalysis.ai/models/gpt-oss-20b/providers) - consultado 2026-08-27 (secundaria)
- [Artificial Analysis - Gemini 3.1 Flash-Lite](https://artificialanalysis.ai/models/gemini-3-1-flash-lite-preview) - consultado 2026-08-27 (secundaria)
- [Foro Google AI Devs - retirement date 2.5 Flash-Lite: Gemini API vs Vertex AI](https://discuss.ai.google.dev/t/gemini-2-5-flash-lite-retirement-date-different-for-gemini-api-vs-vertex-ai/177897) - consultado 2026-08-27 (secundaria, documenta la contradiccion Oct 16 vs Oct 20)

## Impacto en iStock

**ARCHITECTURE:**
1. El chatbot necesita **model registry por env var**, no constantes. Minimo:
   `LLM_PRIMARY_MODEL` / `LLM_FALLBACK_MODEL`. Dos deprecaciones en 3 meses lo demuestran.
2. **Fallback real, no decorativo.** El fallback Groq tiene que estar en el camino de ejecucion y
   testeado, porque el primario (`gemini-2.5-flash-lite`) tiene riesgo de apagado en octubre 2026.
3. Ramificacion por familia de modelo en la config de thinking, con la fuente de cada regla:
   - **Gemini 2.5 Flash-Lite: no hace falta mandar nada.** La tabla oficial dice
     `Default Thinking: Off` / `Default setting (thinking budget not set): "Model does not think"`.
     Si se quiere ser defensivo, `thinkingBudget = 0` es la forma documentada de deshabilitarlo
     (tabla `Disable thinking` de `docs/generate-content/thinking`) — pero **no cambia el default**.
   - **Gemini 3.x: `thinking_level`**, nunca `thinking_budget`.
     **Mandar los dos en el mismo request = `400`** (texto literal de la Gemini 3 developer guide).
   - **`gpt-oss-20b`: `reasoning_effort: "low"`.** Ojo: para esa familia el AI SDK **no expone
     `none`**; el reasoning no se apaga, solo se baja.
4. **Context caching de Gemini existe (USD 0.01/1M input) pero no nos sirve a 1200 tokens**: el minimo
   publicado para implicit caching es 2.048-4.096 y no cubre Flash-Lite, y el explicit caching cobra
   USD 1.00/1M/hora de storage (~USD 21,90/mes a 30 tenants contra USD 5,40 de ahorro). Resultado
   practico: **el prompt se paga entero en cada turno** -> la dieta de 1200 tokens in es lo unico que
   nos protege. Hay que instrumentar tokens reales por turno (campos de `usage`, incluidos
   `cached`/`thought`), no confiar en la estimacion.
5. Rate limit por IP y por tenant en el endpoint del chat. El costo por mensaje es bajo; el costo de
   60.000 mensajes de un scraper no.

**DECISIONS (contradiccion con `CLAUDE.md` §3, para que la resuelva el LEAD):**
- `CLAUDE.md` §3 dice: *"Groq `llama-3.1-8b-instant` / `gpt-oss-20b` fallback"*. **`llama-3.1-8b-instant`
  esta retirado desde el 16/08/2026 para free y developer tier.** La linea del stack apunta a un
  modelo que hoy devuelve error o exige contrato enterprise. **Propuesta: el fallback es
  `openai/gpt-oss-20b`, punto.** (Yo no edito `CLAUDE.md`: es del LEAD.)
- Decision abierta que amerita ADR: **`openai/gpt-oss-20b` es mas barato (USD 8.64 vs 11.52) y mucho
  mas rapido en generacion (932 t/s) que `gemini-2.5-flash-lite`.** El argumento fuerte a favor de
  Gemini es el TTFT de 0.28 s vs 2.98 s. Como es un chat de vidriera donde el visitante mira una
  pantalla, **TTFT gana sobre throughput** -> mantener Gemini primario, tal como manda `CLAUDE.md` §3.
  **Correccion respecto de la v1: la ventaja de costo de Groq es de USD 2,88/mes, no mas.** La v1 le
  daba a Groq el descuento de prompt caching y a Gemini no; comparados de forma simetrica (§4) la
  brecha se achica a **USD 0,99/mes**, que es ruido. Es decir: **el costo no justifica desplazar a
  Gemini como primario; solo el eval de TTFT con `reasoning_effort: "low"` en Groq podria hacerlo.**
- **NO migrar a `gemini-3.1-flash-lite` por default.** Cuesta 3-4x y su TTFT medido (5.45 s) rompe la
  experiencia. Si 2.5 Flash-Lite se apaga, el sucesor logico es **Groq `gpt-oss-20b`**, no el Lite
  siguiente de Google.
- **Billing habilitado en Gemini desde el dia 1** (no es optimizacion de costo, es requisito de
  privacidad: el free tier entrena con los prompts). **ZDR activado en Groq** antes de produccion.

**COST:**
- Linea nueva para `docs/COST.md` (la escribe `cost-auditor`, no yo): **chatbot de vidriera
  USD 8.64-11.52/mes a 60.000 mensajes/mes**, es decir **USD 0.000144-0.000192 por mensaje**.
- Por tenant del plan Negocio (USD 35): a 2.000 msgs/mes son **USD 0,29-0,38/mes**, o sea
  **0,8-1,1% del ingreso** (0,288/35 = 0,82% · 0,384/35 = 1,10%). Usar este rango, no "1-2%".
- El riesgo de costo **no** es el precio unitario: es (a) que la dieta de 1200/180 se desborde con
  reasoning tokens no medidos, y (b) abuso sin rate limit. Ambos se cubren con instrumentacion de
  tokens reales por turno y cap por tenant.
- Alerta de presupuesto: si algun dia hay que ir a `gemini-3.5-flash-lite`, el mismo trafico cuesta
  **USD 48.60/mes** (4.2x). El chatbot dejaria de ser ruido en el P&L.

## Refutaciones al review

Tres findings del review R3 **no se sostienen**, y la evidencia es URL de fuente primaria consultada
hoy. Los cito para que el LEAD no los arrastre como deuda:

1. **"Mandar `thinking_budget` y `thinking_level` juntos devuelve 400" no era invencion.** Es texto
   literal de la Gemini 3 developer guide: *"You cannot use both `thinking_level` and the legacy
   `thinking_budget` parameter in the same request. Doing so will return a 400 error."*
   <https://ai.google.dev/gemini-api/docs/gemini-3> (2026-08-27). El review busco el termino en
   `docs/thinking` (Interactions API), que efectivamente tiene 0 ocurrencias; vive en otra pagina.
   **Culpa mia: cite la URL equivocada.** Corregido en `## Fuentes`.
2. **`thinking_budget: 0` para Gemini 2.5 tampoco era invencion.** La tabla de
   <https://ai.google.dev/gemini-api/docs/generate-content/thinking> (2026-08-27) tiene la fila
   `2.5 Flash Lite | Default: "Model does not think" | Range 512 to 24576 | Disable thinking: thinkingBudget = 0`.
   Concedo lo sustantivo: **es redundante**, porque el default ya es no pensar. Reescrito como
   "opcional/defensivo" en ARCHITECTURE #3, no como requisito.
3. **`gemini-3.1-flash-lite` con thinking "On (minimal)" no apagable NO es extrapolacion.** El review
   miro la tabla *Controlling thinking* de `docs/thinking`, donde ese ID no aparece. Pero
   <https://ai.google.dev/gemini-api/docs/generate-content/thinking> tiene una tabla de niveles con
   una columna rotulada literalmente **"Gemini 3.5 & 3.1 Flash-Lite"**: `minimal = Supported (Default)`,
   `low/medium/high = Supported`, **sin fila "off"**. Es dato de tabla oficial.

Los otros cuatro findings (context caching, enumeracion de mas baratos, aritmetica del %,
"sin cap" vs "N/A") **eran correctos y estan corregidos en el cuerpo**. El de context caching era el
peor: cite bien la pagina y lei mal la columna (Free Tier en vez de Paid Tier).

## Confianza

**alta** para precios, IDs de modelo, deprecaciones y politicas de retencion: todo viene de docs
oficiales de Google y Groq consultadas hoy (2026-08-27), con contradicciones de terceros
explicitamente descartadas. **Baja de "alta" a "alta con asterisco" por un motivo honesto: la v1 de
este documento leyo la columna Free Tier en vez de la Paid Tier en la fila de context caching y
publico "no disponible" citando la pagina que dice lo contrario.** Ese dato ya esta corregido y
re-verificado contra el HTML de la pricing page, igual que la enumeracion de modelos mas baratos
(30 IDs enumerados, no una muestra).

**media** para latencia (Artificial Analysis es benchmark independiente, no SLA oficial; ni Google ni
Groq publican TTFT) y **baja** para los numeros de free tier de Gemini (Google dejo de publicarlos y
solo hay blogs que se contradicen).

Que subiria la confianza:
1. Un eval propio de 50 turnos reales midiendo TTFT y tokens facturados (in/out/thinking) contra
   ambos proveedores desde la region de deploy. Esto convierte las estimaciones de reasoning tokens
   de §4 en numeros duros.
2. Screenshot o export del dashboard de AI Studio con los RPM/TPM/RPD reales de nuestro proyecto.
3. Confirmacion escrita de Google sobre la fecha de retiro de `gemini-2.5-flash-lite` en la Gemini
   API (hoy la deprecations page dice "no announced" y Vertex dice octubre 2026).

Que la bajaria: que Google anuncie el shutdown de `gemini-2.5-flash-lite` con menos de 6 meses de
aviso, o que Groq mueva `gpt-oss-20b` a Enterprise como hizo con `llama-3.1-8b-instant`.

## UNVERIFIED

- **Minimo de tokens para que `gemini-2.5-flash-lite` haga cache hit.** La tabla `Min token limit` de
  `docs/caching` lista 2.048-4.096 para Flash/Pro y **no incluye ningun Flash-Lite**. Nuestra dieta de
  1200 tokens esta por debajo de todo lo publicado, asi que asumo **cero hits** y presupuesto sin
  descuento. Si alguna vez el `usage` muestra `cached` > 0, hay upside de hasta 10x en input.
- **Si `openai/gpt-oss-20b` soporta structured outputs en `@ai-sdk/groq`.** La doc del provider dice
  que estan on por default y que *"only supported by newer Groq models like
  `moonshotai/kimi-k2-instruct-0905`"*, pero **no nombra a `gpt-oss-20b` en ninguna de las dos listas**.
  Hay que probarlo antes de depender de `Output.object` en el fallback.
- **Reasoning tokens reales de `gpt-oss-20b` con `reasoning_effort: "low"`.** La fila "50% cacheado"
  de §4 y la estimacion de ~150 reasoning tokens/turno son supuestos de trabajo, no medicion.
- **La fila "gemini-2.5-flash-lite 50% cacheado -> USD 8,28/mes" de §4 es teorica**, incluida solo para
  que la comparacion contra Groq sea simetrica. No la copies a `COST.md`: el numero presupuestable
  sigue siendo **USD 11,52/mes**.
- **RPM/TPM/RPD concretos del free tier de Gemini** (circulan 15 RPM / 250K-1M TPM / 1.000-1.500 RPD
  para Flash-Lite). La pagina oficial ya no los publica y los blogs se contradicen entre si. Irrelevante
  para la decision: el free tier esta descartado por politica de datos.
- **Fecha real de retiro de `gemini-2.5-flash-lite` en la Gemini API.** Deprecations oficial dice "No
  shutdown date announced"; Vertex AI / fuentes secundarias dicen 16/10/2026 o 20/10/2026. Sin resolver.
- **Que Groq Developer tier no tenga fee mensual** y que suba limites ~10x sobre free. Solo fuentes
  secundarias; no lo encontre en pagina oficial (la pagina publica de pricing de Groq devolvio 404 y
  las tarifas ahora viven solo en las docs del console).
- **RPD / TPD del Developer tier de Groq** para `openai/gpt-oss-20b` (la models page publica TPM y RPM,
  no los limites diarios).
- **Precio historico `llama-3.1-8b-instant` USD 0.05/0.08.** Lo publican agregadores; la doc oficial
  hoy dice `ContactSales`. No presupuestable.
- **Reasoning tokens por turno de `openai/gpt-oss-20b`** con `reasoning_effort` bajo. Mi estimacion de
  ~150 tokens/turno es un supuesto de trabajo, no un dato medido.
- **Thinking tokens por turno de `gemini-3.1-flash-lite`** en `thinking_level: "minimal"`. Estimados en
  ~120/turno; no medido. La doc advierte textual que *"minimal does not guarantee that thinking is off"*,
  asi que el piso real puede ser mayor.
- **Version actual de `@ai-sdk/google` y `@ai-sdk/groq`** (npmjs devolvio 403 al fetch). El nombre de
  los paquetes si esta verificado en la doc oficial del AI SDK.
- **TTFT de `gpt-oss-20b` en Groq con reasoning minimo.** Los 2.98 s medidos son con reasoning "high".
