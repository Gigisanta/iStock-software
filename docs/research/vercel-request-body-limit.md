# vercel-request-body-limit
_Consultado: 2026-08-27 · Agente: researcher_

## Pregunta

Después de subir `experimental.serverActions.bodySizeLimit` en Next.js 16, ¿queda **otro** techo
por debajo, impuesto por Vercel, que la configuración de la app no controla? ¿Cuál es su valor hoy
en el plan **Pro**?

## Respuesta corta

- **Sí, queda otro techo: 4.5 MB** de request body por invocación de Vercel Function. Es un límite
  de plataforma; Vercel **no documenta ninguna opción de configuración, plan ni env var para
  subirlo**, y en vez de un knob ofrece rutas alternativas (subida directa al storage).
  ([docs/functions/limitations#request-body-size](https://vercel.com/docs/functions/limitations), consultado 2026-08-27)
- **No varía por plan.** Hobby, Pro y Enterprise: el mismo 4.5 MB. La tabla de límites de esa misma
  página **sí** desglosa por plan memoria (2/4 GB), duración (300/800/1800 s) y concurrencia — y el
  request body **no** aparece desglosado: se enuncia como un número único.
- **Hay un techo todavía más bajo, y nos pega de lleno: 4 MB en Routing Middleware** (= `proxy.ts`
  en Next 16). Si la request de upload cae dentro del `matcher` del proxy, el techo efectivo es
  **4 MB, no 4.5 MB**. ([docs/routing-middleware#limits-on-requests](https://vercel.com/docs/routing-middleware), consultado 2026-08-27)
- **Streaming NO salva el request body.** El texto oficial que dice "streaming functions, which
  don't have this limit" está en la sección **"If the response body is too large"**. Para el
  request body, la misma KB manda a subir directo al storage. Un diseño que asuma "streameo el
  upload y esquivo el 4.5" está mal.
- Al exceder: **HTTP 413 `FUNCTION_PAYLOAD_TOO_LARGE`**, nombre `Payload Too Large`.
  **Si la app puede interceptarlo y mostrar un mensaje propio: NO VERIFICADO** (ver §Detalle 3).
- Consecuencia dura: con fotos de 3 MB, **entra UNA por request**. Dos (6 MB) revientan.

## Detalle

### 1. El número, las unidades y si cambió

`https://vercel.com/docs/functions/limitations` (frontmatter `last_updated: 2026-08-24`) tiene una
sección literal **"Request body size"**:

> "In Vercel, the request body size is the maximum amount of data that can be included in the body
> of a request to a function. The maximum payload size for the request body or the response body of
> a Vercel Function is **4.5 MB**. If a Vercel Function receives a payload in excess of the limit it
> will return an error 413: `FUNCTION_PAYLOAD_TOO_LARGE`."

Consultado 2026-08-27. Notar que **el mismo 4.5 MB cubre request y response**.

**¿Cambió recientemente?** No hay ninguna entrada de changelog de Vercel que toque este número.
Los cambios de límites de 2026 que sí existen son de **bundle**, no de body: Python a 500 MB
(2026-02-24) y Large Functions a 5 GB (2026-06-29). Búsqueda en `vercel.com/changelog` el
2026-08-27: cero resultados sobre request body. Se documenta como **estable**, aunque la ausencia
de changelog no es prueba de inmutabilidad futura.

**¿Depende del plan?** No, según toda la documentación consultada:

| Página | Fecha de la página | ¿Desglosa el body por plan? |
|---|---|---|
| `/docs/functions/limitations` | 2026-08-24 | No — número único, 4.5 MB |
| `/docs/limits` | 2026-08-25 | **Ni siquiera lo menciona**; delega en `/docs/functions/limitations` |
| KB "How do I bypass the 4.5MB body size limit…" | 2025-11-10 | No — sin calificador de plan |

`/docs/limits` es la página que Vercel usa para todo lo que sí es per-plan (build minutes, rate
limits, Pro trial, on-demand resources para Pro). Que el body size **no esté ahí** y sí esté en la
página de límites técnicos de funciones es la señal más fuerte de que no es una palanca comercial.

**Matiz de honestidad:** Vercel nunca escribe la frase "no podés subir este límite". Escribe "the
maximum … is 4.5 MB" y luego dedica una KB entera a **bypasses arquitectónicos**, no a una opción
de configuración. La inferencia "no se puede subir" es sólida pero es una inferencia, no una cita.

### 2. Runtimes y tipos de función

- **Node.js vs Edge:** ninguna página oficial documenta un límite de request body distinto para
  Edge. `/docs/functions/runtimes/edge` (`last_updated: 2026-08-03`, consultado 2026-08-27) **no
  menciona request body en absoluto**. Lo único per-plan ahí es el **code size** (Hobby 1 MB / Pro
  2 MB / Ent 4 MB gzip), que es tamaño de bundle, no de request — no confundir.
  Además esa misma página dice: *"Starting in Next.js 16.3, setting `runtime = 'edge'` is no longer
  supported. Routes and pages run on Node.js."* Para nosotros el punto es discutible.
- **Serverless / Fluid:** la tabla de `/docs/functions/limitations` es explícitamente "Vercel
  Functions **with Fluid compute**". El 4.5 MB está en esa misma página. No hay límite de body
  diferenciado para Fluid.
- **Streaming — acá está el matiz que cambia el diseño.** La KB separa dos casos:
  - *"If the request body is too large: This is when the body sent from the user/client to the
    function exceeds the 4.5 MB limit. The most common reason why this happens is when you are
    uploading large files. Instead, you may want to upload directly to the source."*
  - *"If the response body is too large: … we recommend using streaming functions, which don't have
    this limit."*

  La exención de streaming está **sólo del lado de la response**. `/docs/functions/streaming-functions`
  (`last_updated: 2026-08-11`) no menciona el límite de 4.5 MB en ninguna dirección.
  **NO VERIFICADO:** que consumir el request como `ReadableStream` en el handler evada el 4.5 MB.
  Ninguna página oficial lo afirma. Cualquier fuente que lo afirme no es Vercel.

### 3. Qué pasa cuando se excede

De `/docs/errors/FUNCTION_PAYLOAD_TOO_LARGE` (`last_updated: 2026-02-09`, consultado 2026-08-27):

- **Error Code:** `413`
- **Name:** `Payload Too Large`
- Frontmatter/summary: *"The payload sent to the function is too large. **This is a function error.**"*
- Cuerpo: *"occurs when the payload sent to a function exceeds the maximum allowed size. This
  typically happens when the data sent in the request body to a serverless function is larger than
  the server can process."*

**¿Lo ve la app o lo corta la plataforma antes?** — **NO VERIFICADO.** Ninguna página oficial de
Vercel dice explícitamente si el 413 se genera en la red de Vercel antes de invocar la función, ni
muestra el cuerpo exacto de la respuesta (HTML de error de Vercel vs. respuesta de la app). Lo que
sí se puede afirmar con fuente:

1. Vercel lo cataloga como error **con código propio de plataforma** y le da página de error
   dedicada, igual que `FUNCTION_INVOCATION_TIMEOUT`.
2. **Los 5 remedios que Vercel documenta son todos "no lo mandes"**, ninguno es "capturalo y
   manejalo": revisar tamaño, reducir tamaño, client-side uploads a Vercel Blob, partir en varias
   requests, storage externo.

Que el remedio documentado nunca sea "manejá el 413 en tu handler" es evidencia circunstancial
fuerte de que el código de la función no llega a correr — pero **es inferencia, no cita**. Para el
producto, la conclusión operativa segura es: **no asumir que podemos renderizar un mensaje lindo
en castellano cuando se excede; hay que validar el tamaño del lado del cliente antes de mandar.**

Aparte, existe `FUNCTION_RESPONSE_PAYLOAD_TOO_LARGE` (**500**, no 413) para el caso de la response
— otro error, otro código. No mezclar en logs ni en alertas.

### 4. Camino que Vercel documenta para archivos más grandes

Sólo se reporta qué documenta Vercel. La decisión de arquitectura es del LEAD.

De la KB (`last_updated: 2025-11-10`) y de `/docs/errors/FUNCTION_PAYLOAD_TOO_LARGE`:

1. **Subida directa desde el browser al media host, sin la función como proxy.** Cita textual:
   *"you can upload large files directly to a media host from your browser without needing a Vercel
   Function as a proxy."* Vercel recomienda su propio producto, **Vercel Blob** con *client uploads*.
2. **URL prefirmada:** Vercel la documenta **para el sentido de bajada**, no de subida:
   *"If you have a large file like a video that you need to send to a client, you should consider
   storing those assets in a dedicated media host and making them retrievable with a pre-signed URL
   that contains access control policies directly in the URL."*
   Para el sentido de **subida**, Vercel documenta el *token exchange* de Vercel Blob client
   uploads, no la frase "presigned URL". Es una diferencia de vocabulario, no de mecánica.
3. **Partir en chunks / varias requests** (sólo en la página de error, no en la KB).
4. **Storage externo** (sólo en la página de error).
5. `/docs/vercel-blob/server-upload` (`last_updated: 2026-08-11`) lleva un callout explícito:
   *"Vercel has a 4.5 MB request body size limit on Vercel Functions. If you need to upload larger
   files, use client uploads."* Y: *"Server uploads are perfectly fine as long as you do not need to
   upload files larger than 4.5 MB on Vercel."*
6. `/docs/vercel-blob/client-upload` (`last_updated: 2026-08-11`): *"When you need to upload files
   larger than 4.5 MB, you can use client uploads. The file goes directly from the browser to
   Vercel Blob, secured by a token exchange between your server and Vercel Blob."*

### 5. ¿Aplica antes de llegar a la función (CDN / edge network)?

**Hallazgo importante y no obvio.** Hay un segundo límite, **más bajo**, en la capa que corre antes
de la función: **Routing Middleware** — que en Next.js ≥16 es exactamente nuestro **`proxy.ts`**.

`https://vercel.com/docs/routing-middleware` (`last_updated: 2026-08-14`, consultado 2026-08-27),
sección **"Limits on requests"**: *"The following limits apply to requests processed by Routing
Middleware"*:

| Name | Limit |
|---|---|
| Maximum URL length | 14 KB |
| Maximum request body length | **4 MB** |
| Maximum number of request headers | 64 |
| Maximum request headers length | 16 KB |

Es decir: **4 MB en el middleware, 4.5 MB en la función.** Para una request que atraviesa el
`matcher` del proxy, **manda el 4 MB**.

- **NO VERIFICADO:** qué status/error devuelve Vercel al exceder los 4 MB en Routing Middleware.
  No existe página `/docs/routing-middleware/limitations` (404 el 2026-08-27) y la tabla no
  documenta código de error.
- **NO VERIFICADO:** si el límite de 4 MB aplica también cuando el middleware sólo *pasa* la
  request (rewrite) sin leer el body. La redacción es *"requests processed by Routing Middleware"*,
  que no distingue.
- Fuera de eso, **no hay ningún límite de request body documentado en la capa CDN/edge network**
  para rutas estáticas o cacheadas. `/docs/edge-network` y `/docs/edge-network/caching` devuelven
  404; `/docs/vercel-firewall` (2026-08-11) no menciona tamaño de body.
- Dato adyacente que no es este límite pero se confunde: `/docs/limits` documenta **Proxied request
  timeout = 120 s** para rewrites a destino externo. Es tiempo, no bytes.

### Inconsistencias encontradas en la documentación oficial

No son contradicciones de número — son **enlaces rotos**, y conviene registrarlas porque explican
por qué circulan cifras distintas:

- `/docs/errors/FUNCTION_PAYLOAD_TOO_LARGE` linkea el límite a `/docs/functions/runtimes#size-limits`.
- `/docs/vercel-blob/server-upload` linkea a `/docs/functions/runtimes#request-body-size`.
- **Ninguno de esos dos anchors existe.** Verificado el 2026-08-27: `/docs/functions/runtimes.md`
  no contiene la cadena "4.5", ni "body size", ni "payload", ni una sección de request body.

La página **canónica y vigente** es `/docs/functions/limitations#request-body-size`
(`last_updated: 2026-08-24`), que además es la más reciente de todas. **Esa es la que pesa.**
Las otras dos citan el mismo número 4.5 MB, así que no hay conflicto de valor: hay bitrot de anchors.

## Números que importan

| ítem | valor | unidad | fuente |
|---|---|---|---|
| Request body máximo — Vercel Function (todos los planes, incl. Pro) | 4.5 | MB | [docs/functions/limitations](https://vercel.com/docs/functions/limitations) — 2026-08-27 |
| Response body máximo — Vercel Function | 4.5 | MB | [docs/functions/limitations](https://vercel.com/docs/functions/limitations) — 2026-08-27 |
| Request body máximo — Routing Middleware (`proxy.ts`) | **4** | MB | [docs/routing-middleware](https://vercel.com/docs/routing-middleware) — 2026-08-27 |
| Status al exceder (request) | 413 | HTTP | [docs/errors/FUNCTION_PAYLOAD_TOO_LARGE](https://vercel.com/docs/errors/FUNCTION_PAYLOAD_TOO_LARGE) — 2026-08-27 |
| Status al exceder (response) | 500 | HTTP | [docs/errors/FUNCTION_RESPONSE_PAYLOAD_TOO_LARGE](https://vercel.com/docs/errors/FUNCTION_RESPONSE_PAYLOAD_TOO_LARGE) — 2026-08-27 |
| Máx. URL en Routing Middleware | 14 | KB | [docs/routing-middleware](https://vercel.com/docs/routing-middleware) — 2026-08-27 |
| Máx. headers en Routing Middleware | 64 / 16 KB | headers / bytes | [docs/routing-middleware](https://vercel.com/docs/routing-middleware) — 2026-08-27 |
| Variación del body limit por plan | ninguna documentada | — | [docs/limits](https://vercel.com/docs/limits) (2026-08-25) no lo lista — 2026-08-27 |
| Code size Edge runtime (NO es body) | 1 / 2 / 4 | MB gzip (Hobby/Pro/Ent) | [docs/functions/runtimes/edge](https://vercel.com/docs/functions/runtimes/edge) — 2026-08-27 |
| Umbral a partir del cual Vercel manda a client uploads | 4.5 | MB | [docs/vercel-blob/client-upload](https://vercel.com/docs/vercel-blob/client-upload) — 2026-08-27 |

## Fuentes

- [Vercel Functions Limits — sección "Request body size"](https://vercel.com/docs/functions/limitations) — consultado 2026-08-27 (página: `last_updated 2026-08-24`) — **fuente canónica**
- [Limits](https://vercel.com/docs/limits) — consultado 2026-08-27 (página: `last_updated 2026-08-25`) — relevante por lo que **no** dice: el body size no figura entre los límites per-plan
- [FUNCTION_PAYLOAD_TOO_LARGE](https://vercel.com/docs/errors/FUNCTION_PAYLOAD_TOO_LARGE) — consultado 2026-08-27 (página: `last_updated 2026-02-09`)
- [How do I bypass the 4.5MB body size limit of Vercel Serverless Functions?](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions) — consultado 2026-08-27 (página: `last_updated 2025-11-10`) — KB oficial de Vercel, no blog de tercero
- [Routing Middleware — "Limits on requests"](https://vercel.com/docs/routing-middleware) — consultado 2026-08-27 (página: `last_updated 2026-08-14`) — **el 4 MB**
- [Edge Runtime](https://vercel.com/docs/functions/runtimes/edge) — consultado 2026-08-27 (página: `last_updated 2026-08-03`)
- [Streaming](https://vercel.com/docs/functions/streaming-functions) — consultado 2026-08-27 (página: `last_updated 2026-08-11`)
- [Server Uploads with Vercel Blob](https://vercel.com/docs/vercel-blob/server-upload) — consultado 2026-08-27 (página: `last_updated 2026-08-11`)
- [Client Uploads with Vercel Blob](https://vercel.com/docs/vercel-blob/client-upload) — consultado 2026-08-27 (página: `last_updated 2026-08-11`)
- [Vercel Functions Runtimes](https://vercel.com/docs/functions/runtimes) — consultado 2026-08-27 — citada para documentar que **los anchors `#size-limits` y `#request-body-size` no existen ahí**

Cero fuentes de terceros usadas. Cero StackOverflow. Cero blogs.

## Impacto en iStock

**ARCHITECTURE.** El techo real del flujo de carga de fotos no es el `bodySizeLimit` de Next: es
**4.5 MB de Vercel**, y **4 MB si la ruta pasa por el `matcher` de `proxy.ts`**. Subir
`experimental.serverActions.bodySizeLimit` a, digamos, 20 MB **no hace nada** — Next deja pasar y
Vercel corta igual. Hay que decidir explícitamente: (a) el `matcher` de `proxy.ts` excluye la ruta
de upload — recordando la nota de CLAUDE.md de que excluir un path del matcher también saltea las
Server Functions de ese path, y que por eso la autorización se verifica dentro de cada Server
Function; y (b) si el upload va por Server Action a la Function o directo del browser a R2.
El requisito de producto son **3 fotos reales por ficha**: por Server Action eso son 3 requests
como mínimo, con estado parcial si una falla a mitad de camino.

**DECISIONS.** Amerita un ADR: *"Upload de fotos: Server Action vs. subida directa a R2"*. El dato
que lo fuerza es este 4.5/4 MB, no una preferencia. Nota de coherencia con el stack cerrado: Vercel
documenta **su** camino (Vercel Blob client uploads), y el stack de iStock ya tiene **Cloudflare R2**
elegido por egress $0. El mecanismo que Vercel documenta (URL/token de corta vida, browser → storage,
la función sólo firma) es equivalente al presigned PUT de R2; el proveedor es otro. Este documento
no elige — sólo deja constancia de que el 4.5 MB no se negocia por config.

**COST.** Si las fotos suben por Vercel Function, cada foto atraviesa la función y consume
Active CPU + memoria provisionada, además de que la Function tiene que reenviar los bytes a R2.
Si suben directo del browser a R2, la Function sólo firma (milisegundos de CPU) y el byte no toca
Vercel. Es una diferencia de orden de magnitud en el costo del onboarding "15 equipos en una tarde"
(15 equipos × 3 fotos = 45 uploads por sesión). `cost-auditor` debería cuantificarlo antes del ADR.

**UX / gate de aceptación.** Como no está verificado que la app pueda interceptar el 413, la
validación de tamaño **tiene que ser client-side, antes de mandar** — o el dueño en Cipolletti ve
una pantalla de error de Vercel en inglés en vez de "esa foto pesa mucho, probá de nuevo". Esto es
condición de aceptación de la slice de upload, no un pulido posterior.

## Confianza

**alta** para el número (4.5 MB), el status (413), la no-variación por plan y el 4 MB de Routing
Middleware: los cuatro salen de páginas oficiales de Vercel actualizadas dentro de los últimos
13 días, y el 4.5 MB aparece consistente en cinco páginas oficiales distintas.

**media-baja** para dos puntos, ambos marcados NO VERIFICADO: (a) si el 413 lo corta la plataforma
antes de invocar el código, y (b) el comportamiento exacto al exceder los 4 MB en Routing Middleware.

Qué subiría la confianza: una prueba empírica en un preview deploy de Pro — mandar 5 MB a una
Server Action y capturar status, headers y cuerpo exacto de la respuesta, con y sin el path dentro
del `matcher` de `proxy.ts`. Eso convierte las dos inferencias en hechos y es barato de hacer.
Qué la bajaría: un changelog de Vercel posterior al 2026-08-24 que toque el número — no existe hoy.

## UNVERIFIED

1. Si el 413 `FUNCTION_PAYLOAD_TOO_LARGE` lo genera la plataforma **antes** de invocar la función, y
   por lo tanto si el código de la app puede interceptarlo para mostrar un mensaje propio. Vercel no
   lo documenta ni muestra el cuerpo de la respuesta.
2. Qué status/error devuelve Vercel al exceder los **4 MB** de Routing Middleware, y si ese límite
   aplica cuando el middleware sólo reescribe sin leer el body.
3. Si consumir el request body como stream evade el 4.5 MB. Vercel documenta la exención de
   streaming **sólo para la response**; para el request no dice nada.
4. La frase explícita "este límite no se puede aumentar" no existe en la documentación de Vercel.
   Se infiere de que no hay ninguna opción de configuración documentada y de que todos los remedios
   oficiales son arquitectónicos. Es inferencia fuerte, no cita.
5. Si el 4.5 MB se mide sobre bytes crudos del body o sobre el body ya decodificado (relevante para
   `Content-Encoding: gzip`). No documentado.

## Consecuencia para iStock

Con el techo de 4.5 MB (4 MB si la ruta cruza `proxy.ts`), en una sola request entra **exactamente
una** foto de 3 MB: 2 × 3 MB = 6 MB excede ambos límites y devuelve 413. El margen sobrante sobre
una foto de 3 MB es de ~1.5 MB (o ~1 MB pasando por el proxy), y de ahí hay que descontar el
overhead de `multipart/form-data` y los metadatos de la Server Action. Las 3 fotos que exige la
ficha pública **no caben juntas** en ninguna request: o van de a una, o el byte no pasa por Vercel.
