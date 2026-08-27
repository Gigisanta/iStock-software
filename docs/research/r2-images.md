# R2 — Cloudflare R2 + transformaciones de imagen vs Cloudflare Images: pricing real
_Consultado: 2026-08-27 · Agente: researcher_

## Pregunta

¿Cómo servimos las fotos de producto de la vidriera con **egress $0** y costo predecible?
Concretamente: (1) pricing vigente de R2, (2) cómo se factura hoy Cloudflare Image
Transformations sobre origen R2, (3) pricing de Cloudflare Images (storage+delivery),
(4) el número en USD/mes de cada opción a nuestra escala, (5) sharp-en-upload vs on-the-fly,
(6) cómo se sirve R2 por CDN y qué `Cache-Control` conviene.

Constraint duro: **cualquier opción que reintroduzca egress pago se descarta.**

## Respuesta corta

- **R2 confirma egress $0.** La pricing page oficial (última actualización **2026-08-07**) dice
  literal `Egress (data transfer to Internet): Free`. Storage Standard **$0.015/GB-mes**,
  Class A **$4.50/M ops**, Class B **$0.36/M ops**. Free tier mensual: **10 GB-mes + 1M Class A +
  10M Class B**, egress gratis. La pricing page **no documenta** mínimo mensual ni prerequisito de
  plan Workers Paid — tampoco lo niega (ver UNVERIFIED). Ojo con **"Billable unit rounding"**:
  *"Cloudflare rounds up your usage to the next billing unit."*
- **Ganadora: sharp en el upload + 3 variantes fijas en un bucket público + master en un bucket
  PRIVADO, con keys opacas por variante.** *"Public Bucket is a feature that allows users to expose
  the contents of their R2 buckets directly to the Internet"* — el bucket se expone **entero**, así que
  el master no puede vivir ahí. Costo a 100 tenants: **USD 0.00–0.09/mes**; a 1.000 tenants **~USD 2.16/mes**.
  Ese mismo egress en S3 costaría **~USD 39.60/mes** a 100 tenants (540 GB a $0.09/GB tras 100 GB free).
- **On-the-fly (`/cdn-cgi/image/...` sobre R2) cuesta USD 11.90–33.50/mes** a nuestra escala.
  Se factura por **transformación única por mes calendario** ($0.50/1.000, primeras 5.000 gratis),
  y **se vuelve a contar cada mes calendario**. Break-even: **~1.666 fotos activas (~7 tenants)**;
  tenemos 24.000 fotos.
- **Cloudflare Images (storage+delivery) se descarta.** "Images Delivered" cobra **$1 / 100.000
  imágenes entregadas** y *"Every image requested by the browser counts as one billable request"*
  — **cache hits incluidos**. Eso es **egress con otro nombre**: USD 20–50/mes hoy y **USD 165–465/mes a 10x**.
  Viola nuestro constraint.
- **Nunca `r2.dev` en la vidriera.** Docs, textual: *"Public access through `r2.dev` subdomains is
  rate-limited and should only be used for development purposes"* y *"To use features like WAF custom
  rules, caching, access controls, or Bot Management, you must configure your bucket behind a custom
  domain. These capabilities are not available when using the `r2.dev` development url."*
  → **custom domain obligatorio** (`img.maat.work`).
- **`Cache-Control: public, max-age=31536000, immutable`** seteado **en el PUT**. Con
  `@aws-sdk/client-s3` (S3 API de R2) el parámetro es **`CacheControl`**; `httpMetadata.cacheControl`
  es el equivalente **solo en el binding de Workers**, que no existe en el runtime Node de Vercel.
  Sin `Cache-Control`, el edge TTL default para un 200 es **120 minutos** → miss cada 2h y Class B evitable.

## Detalle

### 1) Pricing vigente de Cloudflare R2

Fuente: `developers.cloudflare.com/r2/pricing/`, **"Last Updated: August 7, 2026"** (consultado 2026-08-27).

| Concepto | Standard | Infrequent Access |
|---|---|---|
| Storage | $0.015 / GB-mes | $0.010 / GB-mes |
| Class A ops | $4.50 / millón | $9.00 / millón |
| Class B ops | $0.36 / millón | $0.90 / millón |
| Egress a Internet | **Free** | **Free** |
| Data retrieval | — | $0.01 / GB |

**Free tier mensual (solo Standard):** 10 GB-mes de storage · 1.000.000 Class A · 10.000.000 Class B ·
egress gratis. La doc aclara: *"The free tier only applies to Standard storage, and does not apply to
Infrequent Access storage."* Infrequent Access además tiene compromiso mínimo de 30 días.

**Clasificación de ops (relevante para nuestro pipeline):**
- **Class A (escrituras/listados):** `PutObject`, `CreateMultipartUpload`, `UploadPart`,
  `CompleteMultipartUpload`, `CopyObject`, `ListObjects`, `ListBuckets`, `PutBucketCors`,
  `PutBucketLifecycleConfiguration`, etc.
- **Class B (lecturas):** `GetObject`, `HeadObject`, `HeadBucket`, `GetBucketCors`,
  `GetBucketLifecycleConfiguration`, `UsageSummary`, etc.

Nuestro upload = 1 `PutObject` por objeto (los archivos son <100 MB, no hace falta multipart).
Nuestra lectura de vidriera = `GetObject` **solo en cache miss**.

**Mínimo mensual / plan Workers Paid:** revisé la pricing page completa hoy
(`developers.cloudflare.com/r2/pricing/`, 2026-08-27) y **no documenta** ningún mínimo mensual ni
prerequisito de plan Workers Paid — pero **tampoco lo niega explícitamente**. No tengo fuente primaria
que lo afirme, así que la afirmación queda en `UNVERIFIED`, no en el cuerpo. **A verificar en el
dashboard al crear el bucket.**

**Billable unit rounding (regla que aplica a todos los números de abajo):** la misma página dice
literal *"Cloudflare rounds up your usage to the next billing unit."* con ejemplos: *"If you have
performed one million and one operations, you will be billed for two million operations"* y
*"If you have used 1.1 GB-month, you will be billed for 2 GB-month."* Todos los cálculos de storage
de este doc redondean **hacia arriba** al GB-mes.

### 2) Transformaciones sobre origen R2 (`/cdn-cgi/image/`)

Producto: lo que antes se llamaba "Image Resizing" hoy es **Cloudflare Images → Transformations**.

- **Cómo se factura:** por **transformación única**, definida como *"A request to transform an original
  image based on a set of supported parameters"*. La doc de billing dice:
  *"You are billed on the number of unique transformations that are requested within each calendar month.
  Repeat requests for the same transformation within the same month are counted only once for that month."*
  y *"The first request for each unique version within a calendar month is billed as one unique
  transformation, regardless of cache status."*
- **Clave económica:** el contador se **resetea cada mes calendario**. No es un pago único por imagen.
- **Mismo original en 2 anchos = 2 transformaciones únicas.** Pero `format=auto` sirviendo AVIF a un
  browser y WebP a otro **cuenta como una sola**.
- **Free tier: 5.000 transformaciones únicas / mes**, en **plan Free**. Excedido: *"Existing
  transformations in cache will continue to be served as expected. New transformations will return a
  `9422` error"* y *"You will not be charged for exceeding the limits in the Free plan"* — o sea, en Free
  **falla, no cobra**. Eso es un riesgo de producto: fotos rotas en la vidriera el día 20 del mes.
- **Excedente en plan pago: $0.50 / 1.000 transformaciones únicas / mes.**
- **¿Requiere plan pago del dominio?** **No.** La doc de Images dice *"Available on Free and Paid plans"*
  y *"On the Free plan, you can request up to 5,000 unique transformations each month for free."*
  Las guías viejas que dicen "Image Resizing requiere Pro" **ya no aplican**.
- **Sí requiere habilitar transformaciones por zona** en el dashboard (Images → Transformations):
  *"transformations can be requested on every Cloudflare zone that has transformations enabled"*.
- **Origen R2:** soportado. *"Transform and deliver images that are stored on any origin, including
  S3-compatible buckets like R2."* Por default *"Cloudflare only accepts source images from the same zone
  where transformations are served"*, así que el bucket tiene que estar detrás del **custom domain de
  nuestra zona** (`img.maat.work`), o hay que configurar source origins adicionales.
- URL: `https://<ZONE>/cdn-cgi/image/<OPTIONS>/<SOURCE-IMAGE>`, opciones `width`, `height`, `fit`,
  `quality`, `format=auto`, `gravity`, etc. *"A valid URL must specify at least one parameter."*

### 3) Cloudflare Images (storage + delivery)

| Métrica | Precio |
|---|---|
| Images Transformed | primeras 5.000 únicas/mes incluidas + **$0.50 / 1.000 únicas / mes** |
| Images Stored | **$5 / 100.000 imágenes almacenadas / mes** (incrementos de $5) |
| Images Delivered | **$1 / 100.000 imágenes entregadas / mes** |

Definición crítica de "delivered", textual de la doc:
> *"Every image requested by the browser counts as one billable request."*
> Ejemplo de la doc: 10 imágenes en una página, *"if the page was visited 10,000 times this month, then
> this results in 100,000 images delivered"*.

**Los cache hits cuentan.** No hay descuento por cache. Es facturación **por request de browser**, o sea
exactamente la variable que R2 nos regala. Además la doc aclara la frontera con Transformed:
*"When you optimize a hosted image through the image delivery URL, then this counts toward Images
Delivered — not Images Transformed. However, if you optimize a hosted image through the Images binding,
then this counts toward Images Transformed."*

Las **variantes nombradas son gratis** en Images (no hay cargo por variante), pero cada entrega se cobra.
Ese es el punto: Images cambia "pagás por transformar" por "pagás por servir". Para una vidriera con
tráfico creciente y catálogo chico, es el peor de los dos mundos.

**Sobre el mínimo:** la pricing page de Images dice literal *"Storage in Images is available only with
an Images Paid plan. You can purchase storage in increments of $5 for every 100,000 images stored per
month."* O sea: el storage **exige plan pago** y se compra en **bloques de $5**. No aparece documentado
ningún fee base fijo aparte de esos bloques
([Images pricing](https://developers.cloudflare.com/images/pricing/), consultado 2026-08-27).

### 4) Nuestro caso, en números

**Catálogo:** 100 tenants × 60 listings × 4 fotos = **24.000 fotos originales**.
Con 3 variantes fijas → **72.000 variantes** (bucket **público**) + 24.000 masters (bucket **privado**)
= **96.000 objetos** en R2, repartidos en 2 buckets. El free tier de R2 se computa sobre el total de la
cuenta, no por bucket (ver UNVERIFIED), así que partir en dos buckets **no** duplica costo.

**Tráfico:** 100 tenants × 3.000 pageviews/mes = **300.000 pageviews/mes**.
"~15 imágenes card por sesión" es ambiguo respecto de pageviews/sesión, así que doy dos escenarios:
- **Base** (≈3 pv/sesión → 100.000 sesiones × 15) = **1.500.000 requests de imagen/mes**
- **Peor caso** (15 por pageview) = **4.500.000 requests de imagen/mes**

**Presupuesto de bytes por variante (supuesto de diseño, no medido — ver UNVERIFIED):**
master 1600px WebP ≈ 300 KB · detail ≈ 200 KB · card ≈ 120 KB · thumb ≈ 20 KB → **640 KB por foto**.

---

**Opción A — R2 + sharp en upload (3 variantes fijas) + custom domain**

| Componente | Cálculo | USD/mes |
|---|---|---|
| Storage total (variantes + masters) | 24.000 × 640 KB = **15.36 GB**; −10 GB free = 5.36 → **redondeo a 6 GB-mes** × $0.015 | **$0.09** |
| ↳ del cual, bucket público (3 variantes) | 24.000 × 340 KB = **8.16 GB** → solo, entraría en el free tier | — |
| ↳ del cual, bucket privado (masters) | 24.000 × 300 KB = **7.20 GB** | — |
| Class A (PUT) | peor caso rotación total = 4 PUT × 24.000 = **96.000 PUT/mes**; free 1M (9.6%) | **$0.00** |
| Class B (GET) | 4.5M requests × 5% miss = 225.000; incluso a **0% de cache = 4.5M < 10M free** | **$0.00** |
| Egress | 540 GB/mes (peor caso) × **$0** | **$0.00** |
| **TOTAL** | | **$0.00 – $0.09** |

Dato para dimensionar el ahorro, ahora con fuente: **S3 cobra $0.09/GB** de transferencia a Internet
después de los primeros 100 GB/mes gratis agregados por cuenta
([AWS S3 pricing](https://aws.amazon.com/s3/pricing/), consultado 2026-08-27). Nuestros **180–540 GB/mes**
a 100 tenants serían **$7.20 – $39.60/mes**; a 1.000 tenants (5.400 GB) **~$477/mes**. Eso es lo que
compra el egress $0 de R2: **más que el costo total de todas las demás líneas del proyecto juntas**.

**Opción B — R2 (solo masters) + transformaciones on-the-fly**

| Componente | Cálculo | USD/mes |
|---|---|---|
| Storage masters | 24.000 × 300 KB = 7.2 GB → free tier | $0.00 |
| Transformaciones, **catálogo 100% activo** | 24.000 × 3 = 72.000 únicas; (72.000−5.000)/1.000 × $0.50 | **$33.50** |
| Transformaciones, **40% del catálogo activo** | 28.800 únicas; (28.800−5.000)/1.000 × $0.50 | **$11.90** |
| Si además servimos DPR 2x (6 variantes) | 144.000 únicas | **$69.50** |
| Class A/B | despreciable, dentro del free tier | $0.00 |
| **TOTAL** | | **$11.90 – $33.50** (hasta $69.50 con DPR) |

**Opción C — Cloudflare Images (storage + delivery)**

| Componente | Cálculo | USD/mes |
|---|---|---|
| Images Stored | 24.000 imágenes → **1 bloque completo** de $5/100.000 | **$5.00** |
| Images Delivered (base 1.5M) | 15 × $1 | **$15.00** |
| Images Delivered (peor caso 4.5M) | 45 × $1 | **$45.00** |
| **TOTAL** | | **$20.00 – $50.00** |

**Cómo escala cada una (mismo catálogo/tráfico ×10 → 1.000 tenants):**

| Opción | 100 tenants | 1.000 tenants |
|---|---|---|
| A — R2 + sharp | $0.00–$0.09 | **$2.16** esperado, **$14.76** en el peor caso — desglose abajo |
| B — on-the-fly | $11.90–$33.50 | **~$357.50** (720.000 únicas/mes) |
| C — CF Images | $20–$50 | **$165 – $465** (3 bloques stored = $15 + 15M–45M delivered) |

**Desglose de la opción A a 1.000 tenants** (240.000 fotos, 45M requests/mes en el peor caso):

| Componente | Cálculo | USD/mes |
|---|---|---|
| Storage | 240.000 × 640 KB = **153.6 GB**; −10 free = 143.6 → **144 GB-mes** × $0.015 | **$2.16** |
| Class A (PUT) | rotación total = 4 × 240.000 = **960.000/mes = 96% del free tier de 1M** | **$0.00** |
| Class B, hit ratio ≥80% | 45M × 20% = 9M < 10M free | **$0.00** |
| Class B, **0% de hit ratio** (peor caso absurdo) | (45M − 10M) × $0.36/M | **$12.60** |
| **TOTAL** | esperado / peor caso | **$2.16 / $14.76** |

Dos cosas honestas sobre esa columna: (a) **Class A queda al 96% del free tier por diseño**, no por
anomalía — a esa escala la alarma de Class A tiene que ser de *capacidad*, no de *anomalía*
(ver COST); (b) el `$2.16` asume que un cache HIT no factura Class B, supuesto que sigue en `UNVERIFIED`.

**Corrección de la Opción C a 1.000 tenants:** 240.000 imágenes almacenadas son **3 bloques de $5 = $15**
(no $12 prorrateado), coherente con nuestro propio supuesto de bloque completo declarado en UNVERIFIED
y con *"increments of $5 for every 100,000 images stored per month"*. Total peor caso: **$450 + $15 = $465**.

La opción C crece **linealmente con pageviews**. Es el patrón de costo que R2 vino a matar.

### 5) sharp en upload vs on-the-fly: cuál elegir y cuál escala peor

**Recomendación: sharp en el upload, 3 variantes fijas guardadas.** A nuestra escala es
**$0 vs $33.50/mes**, y el break-even está en ~1.666 fotos activas (≈7 tenants). Ya lo pasamos.

**Cuándo escala peor cada uno:**

| | sharp en upload (variantes fijas) | on-the-fly |
|---|---|---|
| Costo crece con | **tamaño total del catálogo** (storage) | **catálogo *activo* por mes calendario** |
| Catálogo grande y frío | paga storage por variantes que nadie mira | gana: solo paga lo que se pide |
| Agregar una 4ª variante / cambiar tamaños | **caro en operación**: reprocesar 24.000 fotos (24.000 GET + 24.000 PUT + CPU); **a 1.000 tenants son 240.000 + 240.000**, y ahí sí se toca el free tier de Class A | gratis: cambiás el query param |
| Responsive / DPR 2x / art direction | explota en combinaciones | natural |
| Costo marginal por pageview | **$0** | $0 después de la primera del mes |
| Riesgo de outage por cuota | ninguno | en plan Free, error `9422` al pasar 5.000 → **fotos rotas en la vidriera** |
| CPU en el hot path | **no** (se paga una vez en el upload) | no (lo hace Cloudflare) |

**Punto fino que decide:** el costo del on-the-fly **se recontabiliza cada mes calendario**. No es
"pagué una vez las 72.000 y listo". Con un catálogo estable de 24.000 fotos que se ven todos los meses,
pagamos ~$33.50 **todos los meses, para siempre**, por transformaciones que ya calculamos antes.
sharp lo paga una sola vez, en CPU de upload.

**Diseño recomendado (híbrido conservador):**
1. **Dos buckets, no uno.**
   - `istock-media` — **público**, detrás del custom domain `img.maat.work`. Contiene **solo**
     `thumb`/`card`/`detail`.
   - `istock-originals` — **privado**, sin public access y **sin custom domain**. Contiene los masters
     ≤1600px. Acceso únicamente por S3 API con credenciales server-side.
   Motivo, con fuente: *"Public Bucket is a feature that allows users to expose the contents of their R2
   buckets directly to the Internet"* — la exposición es **del bucket entero**, no por prefijo. Y
   *"By default, buckets are never publicly accessible and will always require explicit user permission
   to enable."* Si el master está en el bucket público, es descargable por cualquiera que adivine la key.
2. **Key opaca y por variante** en el bucket público: `v1/{ab}/{sha256_32}.webp`, donde `sha256_32` son
   los primeros 32 hex del SHA-256 **del byte output de esa variante concreta** y `ab` son sus 2 primeros
   caracteres (sharding). Consecuencias:
   - **No hay sufijo `-card` / `-master`**: teniendo la URL de `card` no se puede derivar ninguna otra key.
   - **No aparece `tenant_id` ni `listing_id`** en la URL pública → la vidriera deja de filtrar el UUID
     del tenant en su HTML.
   - Sigue siendo inmutable: cambia el byte → cambia la key → cero purge.
   - El mapeo `listing → keys de variantes` vive en Postgres con `tenant_id` + RLS.
   El bucket privado sí puede usar keys jerárquicas (`originals/{tenantId}/{listingId}/{assetId}.webp`)
   porque nunca salen del server.
3. `packages/media`: sharp en **Node runtime** (nunca Edge) en el endpoint de upload → 1 `PutObject` del
   master al bucket privado + 3 `PutObject` de variantes al bucket público, todos con
   `CacheControl: "public, max-age=31536000, immutable"` (parámetro del S3 SDK, ver §6).
4. Vidriera consume la URL directa de la variante en `img.maat.work`. **Sin `/cdn-cgi/image/` en el
   hot path. Sin Vercel Image Optimization** (ya prohibido en `CLAUDE.md` §3).
5. Dejar transformaciones habilitadas en la zona **solo como escape hatch** (OG images, un ancho no
   previsto, un fix urgente) manteniéndonos **debajo de 5.000 únicas/mes → $0**. Si se acerca al límite,
   es señal de que falta una variante fija.

> **Nota de costo del split:** los masters siguen ocupando storage (están en los 15.36 GB de arriba),
> pero dejan de ser servibles por Internet: cero egress y cero Class B de scrapers bajando 300 KB por foto.
> No verificado con medición propia, pero es la diferencia entre 340 KB y 640 KB por foto expuestos.

### 6) Cómo se sirve R2 por CDN público

**`r2.dev` → prohibido en producción.** Doc textual (ambas verificadas hoy contra
`developers.cloudflare.com/r2/buckets/public-buckets/` y contra `r2/llms-full.txt`):
- *"Public access through `r2.dev` subdomains is rate-limited and should only be used for development purposes."*
- *"To use features like WAF custom rules, caching, access controls, or Bot Management, you must configure
  your bucket behind a custom domain. These capabilities are not available when using the `r2.dev`
  development url."*

> **Corrección respecto de la versión anterior de este doc:** la segunda cita estaba mal transcrita como
> *"The development URL (r2.dev) does not support caching, WAF, or bot management. You must use a Custom
> Domain for these features."* Esa frase **no existe** en las docs de Cloudflare
> (`curl -s https://developers.cloudflare.com/r2/llms-full.txt | grep -c 'does not support caching'` → `0`,
> verificado 2026-08-27). El hecho de fondo es correcto; la cita textual no lo era. Ver `## UNVERIFIED`.

Sin cache, **cada request de vidriera sería un `GetObject` (Class B)** y el rate limit nos rompería la
vidriera en un pico. Va como regla dura.

**Custom domain (`img.maat.work`) → obligatorio.** Habilita:
- Cloudflare Cache en el edge (*"Cloudflare caches R2 content at edge data centers ... based on cache rules"*)
- **Tiered Cache / Smart Tiered Cache**: *"This reduces the number of requests that reach R2."* → menos Class B
- WAF, Bot Management, Zero Trust Access, reglas de TLS, analytics por URL

**Cache-Control para objetos con hash inmutable:**

Key con hash de contenido **de la variante**, ej. `v1/9f/9f3c…c1.webp` (32 hex del SHA-256 del byte
output de esa variante). El hash cambia cuando cambia la imagen → nunca hay que invalidar cache, se
publica una key nueva. **No** se usa `listings/{tenantId}/{listingId}/{hash}-{variant}.webp`: ese esquema
filtra el `tenant_id` en la URL pública y permite derivar la key del master desde la del `card`.

```
Cache-Control: public, max-age=31536000, immutable
```

- **Cómo se setea, según qué cliente se use** (esto importa porque el pipeline corre en Node en Vercel,
  no en un Worker):
  - **S3 API (`@aws-sdk/client-s3`) → parámetro `CacheControl`.** R2 lo soporta en `PutObject`:
    la tabla de compatibilidad marca `✅ PutObject → ✅ System Metadata: ✅ Content-Type ✅ Cache-Control ...`
    ([R2 S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/)). **Es el que usamos.**
  - **Binding de Workers → `httpMetadata.cacheControl`.** La doc dice *"These headers map to the
    `httpMetadata` field in the R2 bindings"* y mapea `Cache-Control → httpMetadata.cacheControl`
    ([Workers API reference](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)).
    **No aplica a nuestro pipeline**: en el runtime Node de Vercel no hay binding de Workers.
  En ambos casos no es un header de la CDN: viaja con el objeto.
- Cloudflare respeta el `Cache-Control` del origen: *"Cloudflare should strictly respect `Cache-Control`
  directives received from the origin server"* — **Origin Cache Control está habilitado por default en
  Free, Pro y Business.**
- **No hace falta "Cache Everything"** para imágenes: `WEBP`, `AVIF`, `JPG`, `JPEG` y `PNG` figuran
  explícitamente en la lista de **default cached file extensions** de Cloudflare
  ([Default cache behavior](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/),
  consultado 2026-08-27; verificado ítem por ítem contra la lista publicada). La doc de public buckets
  advierte *"By default, only certain file types are cached. To cache all files in your bucket, you must
  set a Cache Everything page rule"* — para nosotros no aplica porque desde R2 servimos **solo** imágenes
  en esas extensiones. Cache Everything sería necesario para HTML/JSON.
- **Si no seteamos `Cache-Control`**, el edge TTL default es **120 minutos para 200/206/301**,
  20 min para 302/303, **3 min para 404/410**. Un TTL de 2h significa revalidar contra R2 12 veces por
  día por objeto → Class B evitable y latencia p95 peor.
- Límite de tamaño de archivo cacheable: **512 MB** en Free/Pro/Business. Irrelevante para nosotros.

## Números que importan

| ítem | valor | unidad | fuente |
|---|---|---|---|
| R2 storage Standard | 0.015 | USD / GB-mes | [R2 pricing](https://developers.cloudflare.com/r2/pricing/) |
| R2 storage Infrequent Access | 0.010 | USD / GB-mes | [R2 pricing](https://developers.cloudflare.com/r2/pricing/) |
| R2 Class A (Standard) | 4.50 | USD / millón ops | [R2 pricing](https://developers.cloudflare.com/r2/pricing/) |
| R2 Class B (Standard) | 0.36 | USD / millón ops | [R2 pricing](https://developers.cloudflare.com/r2/pricing/) |
| R2 egress a Internet | 0 | USD / GB | [R2 pricing](https://developers.cloudflare.com/r2/pricing/) |
| R2 free tier storage | 10 | GB-mes / mes | [R2 pricing](https://developers.cloudflare.com/r2/pricing/) |
| R2 free tier Class A | 1.000.000 | ops / mes | [R2 pricing](https://developers.cloudflare.com/r2/pricing/) |
| R2 free tier Class B | 10.000.000 | ops / mes | [R2 pricing](https://developers.cloudflare.com/r2/pricing/) |
| R2 pricing page última actualización | 2026-08-07 | fecha | [R2 pricing](https://developers.cloudflare.com/r2/pricing/) |
| Transformaciones únicas gratis (plan Free) | 5.000 | únicas / mes | [Images pricing](https://developers.cloudflare.com/images/pricing/) |
| Transformaciones excedente | 0.50 | USD / 1.000 únicas / mes | [Images pricing](https://developers.cloudflare.com/images/pricing/) |
| Ventana de conteo de transformaciones | 1 | mes calendario | [Transformations overview](https://developers.cloudflare.com/images/optimization/transformations/overview/) |
| CF Images stored | 5.00 | USD / 100.000 imgs / mes | [Images pricing](https://developers.cloudflare.com/images/pricing/) |
| CF Images delivered | 1.00 | USD / 100.000 entregas / mes | [Images pricing](https://developers.cloudflare.com/images/pricing/) |
| Error al exceder free tier de transformaciones | 9422 | código | [Images pricing](https://developers.cloudflare.com/images/pricing/) |
| Edge TTL default sin Cache-Control (200/206/301) | 120 | minutos | [Default cache behavior](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/) |
| Edge TTL default 404/410 | 3 | minutos | [Default cache behavior](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/) |
| Límite de archivo cacheable (Free/Pro/Business) | 512 | MB | [Enable cache in an R2 bucket](https://developers.cloudflare.com/cache/interaction-cloudflare-products/r2/) |
| Billable unit rounding de R2 | redondeo hacia arriba al siguiente GB-mes / millón de ops | regla | [R2 pricing](https://developers.cloudflare.com/r2/pricing/) |
| `Cache-Control` soportado en `PutObject` vía S3 API | sí (`CacheControl`) | booleano | [R2 S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/) |
| Equivalente en binding de Workers | `httpMetadata.cacheControl` | campo | [Workers API reference](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/) |
| Egress S3 a Internet (tras 100 GB/mes free) | 0.09 | USD / GB | [Amazon S3 pricing](https://aws.amazon.com/s3/pricing/) |
| Free tier de egress de S3 | 100 | GB / mes (agregado por cuenta) | [Amazon S3 pricing](https://aws.amazon.com/s3/pricing/) |
| Storage en Cloudflare Images | requiere Images Paid plan, bloques de $5/100.000 | condición | [Images pricing](https://developers.cloudflare.com/images/pricing/) |
| **Opción A (R2+sharp) a 100 tenants** | **0.00 – 0.09** | **USD / mes** | cálculo propio sobre pricing oficial |
| **Opción B (on-the-fly) a 100 tenants** | **11.90 – 33.50** | **USD / mes** | cálculo propio sobre pricing oficial |
| **Opción C (CF Images) a 100 tenants** | **20.00 – 50.00** | **USD / mes** | cálculo propio sobre pricing oficial |
| Opción A a 1.000 tenants (esperado / peor caso) | 2.16 / 14.76 | USD / mes | cálculo propio |
| Opción B a 1.000 tenants | ~357.50 | USD / mes | cálculo propio |
| Opción C a 1.000 tenants | 165 – 465 | USD / mes | cálculo propio |
| Break-even del on-the-fly | ~1.666 fotos activas (~7 tenants) | fotos | cálculo propio (5.000 / 3 variantes) |
| Objetos en R2 a 100 tenants | 96.000 (72.000 públicos + 24.000 privados) | objetos | cálculo propio |
| Storage total a 100 tenants | 15.36 (facturable 6 tras free tier + redondeo) | GB-mes | cálculo propio |
| Class A a 1.000 tenants con rotación total | 960.000 (96% del free tier) | ops / mes | cálculo propio |
| Egress evitado a 100 tenants (peor caso) | ~540 | GB / mes | cálculo propio |
| Costo de ese egress en S3 a 100 tenants | 7.20 – 39.60 | USD / mes | cálculo propio sobre [S3 pricing](https://aws.amazon.com/s3/pricing/) |

## Fuentes

- [Cloudflare R2 — Pricing](https://developers.cloudflare.com/r2/pricing/) — consultado 2026-08-27 (página declara "Last Updated: August 7, 2026")
- [Cloudflare Images — Pricing](https://developers.cloudflare.com/images/pricing/) — consultado 2026-08-27
- [Cloudflare Images — Transformations overview](https://developers.cloudflare.com/images/optimization/transformations/overview/) — consultado 2026-08-27
- [Cloudflare Images — Transform via URL / features](https://developers.cloudflare.com/images/optimization/features/) — consultado 2026-08-27
- [Cloudflare Images — Get started](https://developers.cloudflare.com/images/get-started/) — consultado 2026-08-27
- [Cloudflare R2 — S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/) — consultado 2026-08-27
- [Cloudflare R2 — Workers API reference (bindings)](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/) — consultado 2026-08-27
- [Cloudflare R2 — llms-full.txt (dump completo de docs)](https://developers.cloudflare.com/r2/llms-full.txt) — consultado 2026-08-27
- [Amazon S3 — Pricing](https://aws.amazon.com/s3/pricing/) — consultado 2026-08-27 (solo para dimensionar el egress evitado)

> **Nota sobre URLs:** `/images/transform-images/` y `/images/transform-images/transform-via-url/` siguen
> respondiendo 200 pero **redirigen** a `/images/optimization/transformations/overview/` y
> `/images/optimization/features/` respectivamente (verificado con `curl -L -w '%{url_effective}'`,
> 2026-08-27). Cloudflare reorganizó la IA de las docs de Images; este doc cita ya la estructura vigente.
- [Cloudflare Images — llms-full.txt (dump completo de docs)](https://developers.cloudflare.com/images/llms-full.txt) — consultado 2026-08-27
- [Cloudflare R2 — Public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/) — consultado 2026-08-27
- [Cloudflare Cache — Enable cache in an R2 bucket](https://developers.cloudflare.com/cache/interaction-cloudflare-products/r2/) — consultado 2026-08-27
- [Cloudflare Cache — Default cache behavior](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/) — consultado 2026-08-27
- [Cloudflare Cache — Origin Cache Control](https://developers.cloudflare.com/cache/concepts/cache-control/) — consultado 2026-08-27

**Contradicción detectada y resuelta:** varias fuentes secundarias de 2026 (blogs, calculadoras)
afirman que las transformaciones se facturan **"una vez cada 30 días"**. La doc oficial de Cloudflare
dice **"within each calendar month"** / *"The first request for each unique version within a calendar
month is billed as one unique transformation"*. **Pesa la doc oficial**: es fuente primaria del producto
y define el mecanismo de facturación. La diferencia 30 días vs mes calendario no cambia nuestro número
de forma material (ambas implican recontabilizar mensualmente), pero sí descarta la lectura optimista
de "se paga una sola vez".

Segunda contradicción: guías (incluso recientes) que dicen que Image Resizing **requiere plan Pro**.
La doc oficial de Images hoy dice *"Available on Free and Paid plans"* con 5.000 únicas/mes gratis.
**Pesa la doc oficial**; las guías arrastran el modelo pre-merge de Image Resizing con Images.

## Impacto en iStock

**ARCHITECTURE**
- `packages/media` implementa **resize server-side con sharp en el upload**, en **Node runtime**
  (no Edge: sharp es binario nativo). Salida: `master` ≤1600px + `thumb` + `card` + `detail`, WebP.
- **Dos buckets**: `istock-media` (público, detrás de `img.maat.work`, **solo** `thumb`/`card`/`detail`) y
  `istock-originals` (**privado**, sin public access ni custom domain, **solo** masters). Un bucket público
  expone *"the contents of their R2 buckets directly to the Internet"* — entero, no por prefijo.
- Keys públicas **opacas y por variante**: `v1/{ab}/{sha256_32}.webp`, hash del **byte output de esa
  variante**. Sin `tenant_id`, sin `listing_id`, sin sufijo de variante → la URL de `card` no permite
  derivar la del master ni enumerar el catálogo de un tenant. Contenido inmutable → cero purge.
  El mapeo `listing → keys` vive en Postgres con `tenant_id` + RLS.
- Cada `PutObject` lleva **`CacheControl: "public, max-age=31536000, immutable"`** (parámetro del S3 SDK).
  `httpMetadata.cacheControl` **no** aplica: es el binding de Workers, y el pipeline corre en Node en Vercel.
- **Custom domain `img.maat.work` obligatorio** apuntado al bucket **público**. **`r2.dev` prohibido en la
  vidriera** (rate-limited, sin cache) — sumar a `CLAUDE.md` §2 como causal de rechazo.
- **Sumar a `CLAUDE.md` §2:** *"URL pública de imagen que contenga `tenant_id`, `listing_id`, o desde la
  que se pueda derivar la key del master → rechazo"* y *"master/original en un bucket R2 público → rechazo"*.
  Esto es la aplicación literal del contrato de `media-agent`: **la vidriera nunca recibe la key del original.**
- Activar **Smart Tiered Cache** en la zona para reducir requests que llegan a R2.
- La vidriera referencia la URL de la variante ya generada. **No** se usa `/cdn-cgi/image/` en el hot path,
  **no** se usa Vercel Image Optimization (ya prohibido), **no** se usa el loader default de `next/image`
  contra Vercel.
- Transformaciones on-the-fly quedan **habilitadas pero fuera del hot path**, como escape hatch bajo
  5.000 únicas/mes (OG images, casos raros). Si el uso se acerca a 5.000, es señal de variante faltante.

**DECISIONS** (ADR nuevo para `architect`)
- *"Fotos: R2 + variantes fijas generadas en el upload. NO Cloudflare Images, NO transformaciones
  on-the-fly en el hot path."*
- Justificación medible: A = $0.00–0.09/mes · B = $11.90–33.50/mes · C = $20–50/mes a 100 tenants;
  a 1.000 tenants: A = $2.16 (hasta $14.76 con 0% de cache hit) · B = $357.50 · C = $165–465.
  El mismo tráfico en un object store con egress pago (S3, $0.09/GB) serían $39.60/mes a 100 tenants
  y ~$477/mes a 1.000.
- ADR complementario: *"Master/original en bucket R2 privado. Variantes públicas con key opaca derivada
  del hash de la propia variante."*
- Motivo de descarte de Cloudflare Images: **"Images Delivered" cobra por request de browser,
  cache hits incluidos** → reintroduce facturación proporcional al tráfico, que es exactamente el
  costo que R2 elimina. Choca de frente con el constraint "egress 0".
- Motivo de descarte del on-the-fly como default: el conteo de transformaciones únicas **se resetea cada
  mes calendario**, así que es un costo recurrente sobre trabajo ya hecho; y en plan Free excedido
  devuelve `9422` → **la vidriera se queda sin fotos**, que es un fallo de producto, no de costo.

**COST** (para `docs/COST.md`, owner `cost-auditor`)
- Línea **"Media / R2"**: **USD 0.00–0.09/mes** hasta ~100 tenants. Proyección 1.000 tenants:
  **USD 2.16/mes esperado**, tope **USD 14.76/mes** en el escenario de 0% de cache hit.
- Egress: **USD 0.00**, garantizado por pricing oficial. ~180–540 GB/mes a 100 tenants.
- **Presupuesto de bytes por variante (gate de aceptación de `media-agent`):**
  `thumb` ≤ 25 KB · `card` ≤ 150 KB · `detail` ≤ 250 KB · `master` ≤ 350 KB. Total ≤ 775 KB/foto,
  de los cuales **≤425 KB públicos** (el master es privado).
  A 24.000 fotos eso es ≤18.6 GB → facturable 8.6 → **9 GB-mes** por el redondeo hacia arriba →
  **≤$0.14/mes**. Si una variante se pasa del presupuesto, es FAIL de costo.
- **Alarmas de `cost-auditor`:**
  Separadas en **anomalía** (algo se rompió) y **capacidad** (crecimos, hay que pagar). Mezclarlas
  produce alarmas que suenan siempre y se terminan apagando.
  - *Anomalía* — **Class A del mes / fotos subidas o reprocesadas en el mes > 5** → hay reprocesamiento
    innecesario (el valor de diseño es exactamente **4 PUT por foto**). Esta es la alarma que reemplaza
    al umbral absoluto de 800.000, que a 1.000 tenants se dispara **por diseño** (960.000 PUT/mes).
  - *Anomalía* — cualquier request a `*.r2.dev` desde la vidriera → **FAIL inmediato**.
  - *Anomalía* — una URL servida por la vidriera que contenga un UUID de tenant, un `listing_id`, o los
    strings `master`/`original` → **FAIL inmediato** (fuga de key del original).
  - *Anomalía* — transformaciones únicas > 4.000/mes → FAIL: algo del hot path se fue a on-the-fly.
  - *Capacidad* — Class B > 8.000.000/mes (80% del free tier de 10M) → revisar cache hit ratio y `Cache-Control`.
  - *Capacidad* — Class A > 800.000/mes (80% del free tier de 1M) → a partir de acá cada millón cuesta $4.50.
    **Esperado que se dispare cerca de los 1.000 tenants**; no es un bug.
  - *Capacidad* — storage total > 20 GB-mes (esperado 15.4 GB a 100 tenants) → revisar presupuesto de bytes.
  - *Capacidad* — storage del **bucket público** > 10 GB-mes (esperado 8.2 GB a 100 tenants).
- **Costo nuevo introducido:** CPU-ms de sharp en el upload (función serverless de Vercel). Es un costo
  por *upload*, no por *pageview*, y no escala con tráfico. No cuantificado en este topic (ver UNVERIFIED).

**Snippet de config (Cache Rule opcional, si algún día servimos no-imágenes desde R2):**
```
# Cloudflare Cache Rule — zona img.maat.work
# Match: hostname eq "img.maat.work"
# Cache eligibility: Eligible for cache
# Edge TTL: Use cache-control header if present, otherwise 1 month
# Browser TTL: Respect origin
```

## Confianza

**alta** en el pricing y en las definiciones de facturación: todo sale de docs oficiales de Cloudflare
consultadas hoy (2026-08-27), y la pricing page de R2 declara explícitamente su fecha de última
actualización (2026-08-07). Las tres afirmaciones que deciden la arquitectura —egress $0 en R2,
transformaciones contadas por mes calendario, "Images Delivered" contando cada request de browser
incluyendo cache hits— están citadas textualmente de fuente primaria y **cada cita fue re-verificada por
`grep -F` contra los dumps oficiales** `r2/llms-full.txt` e `images/llms-full.txt` (todas devuelven ≥1
ocurrencia). **Baja de confianza autoinfligida:** la versión anterior de este doc contenía **una cita
textual inexistente** atribuida a las docs de R2 (ver §6 y `## UNVERIFIED`). Está corregida, pero es
motivo suficiente para que el `architect` no copie ninguna cita de acá sin re-grepear el dump.

**media** en los números finales en USD/mes, porque dependen de tres supuestos nuestros: los tamaños de
cada variante, el cache hit ratio del edge, y la interpretación de "15 imágenes card por sesión".
Sin embargo, **la conclusión es robusta a esos supuestos**: la Opción A da $0 incluso asumiendo 0% de
cache hit y el peor caso de tráfico, porque 4.5M Class B sigue estando por debajo del free tier de 10M.
La brecha contra las opciones B y C es de 2–3 órdenes de magnitud; ningún supuesto razonable la cierra.

**Qué la subiría a alta end-to-end:** (a) medir los tamaños reales de las 3 variantes con sharp sobre
10 fotos de producto reales; (b) confirmar con un mes de datos del dashboard de R2 el cache hit ratio
real del custom domain y que los hits no generan Class B; (c) confirmar en la factura que 24.000
imágenes almacenadas se cobran como un bloque de $5 y no prorrateadas; (d) confirmar en el dashboard que
el free tier de R2 se computa por **cuenta** y no por **bucket** (de eso depende que el split en 2 buckets
sea gratis); (e) un `curl` a una key de master adivinada desde el custom domain devolviendo `404`.

**Qué la bajaría:** que Cloudflare cambie el free tier de R2 (10 GB / 1M A / 10M B) — es el pilar del
"$0". Con free tier en cero, la Opción A pasaría a ~$0.23/mes de storage + ~$1.62/mes de Class B en el
peor caso: sigue ganando por goleada, pero deja de ser gratis.

## UNVERIFIED

- **CITA FABRICADA EN LA VERSIÓN ANTERIOR DE ESTE DOC (corregida).** Se atribuyó a Cloudflare la frase
  *"The development URL (r2.dev) does not support caching, WAF, or bot management. You must use a Custom
  Domain for these features."* **Esa frase no existe en las docs.** Verificado:
  `curl -s https://developers.cloudflare.com/r2/llms-full.txt | grep -c 'does not support caching'` → `0`
  (2026-08-27). Reemplazada por la frase real: *"To use features like WAF custom rules, caching, access
  controls, or Bot Management, you must configure your bucket behind a custom domain. These capabilities
  are not available when using the `r2.dev` development url."* El hecho de fondo (r2.dev sin cache/WAF →
  prohibido en producción) **se mantiene y ahora sí está sourced**.
- **Tamaños de las variantes** (thumb 20 KB / card 120 KB / detail 200 KB / master 300 KB): son supuestos
  de diseño, **no medidos** con sharp sobre fotos reales de celulares. Todo el cálculo de storage
  (15.36 GB, $0.09/mes, $2.16/mes a 10x) y los 540 GB de egress dependen de esto. **Ninguna cifra de bytes
  por variante de este doc tiene fuente externa: son presupuesto, no medición.**
- **Que el free tier de R2 (10 GB-mes / 1M A / 10M B) se compute por cuenta y no por bucket:** la pricing
  page lo presenta como asignación mensual sin decir el alcance. De esto depende que partir en 2 buckets
  (público + privado) no duplique el costo. **No encontré la frase explícita.** Si fuera por bucket, el
  split nos **beneficia** (dos free tiers), así que el riesgo es asimétrico a favor.
- **Cache hit ratio del 95%** en el edge para `img.maat.work`: supuesto. No medido.
- **Interpretación de "15 imágenes card por sesión"**: el brief no define pageviews por sesión. Doy un
  rango (1.5M–4.5M requests/mes). El resultado no cambia porque ambos caen dentro del free tier de Class B.
- **Que un cache HIT en el custom domain NO genere un `GetObject` facturable (Class B)**: es el
  comportamiento esperado (el request no llega al gateway de R2) y la doc de cache dice que Tiered Cache
  *"reduces the number of requests that reach R2"*, pero **no encontré una frase textual en docs oficiales
  que afirme explícitamente que los cache hits no se facturan como Class B**. Nuestro cálculo no depende
  de esto (a 0% de hit ratio seguimos en $0), pero sí importaría a 10x escala.
- **Rate limit numérico exacto de `r2.dev`**: Cloudflare no publica el número. Solo dice "rate-limited,
  development purposes only".
- **Que R2 no requiere el plan Workers Paid ($5/mes) ni tiene mínimo mensual**: texto exacto de la
  afirmación que bajé del cuerpo → *"Sin mínimo mensual y sin necesidad del plan Workers Paid."*
  Motivo: la pricing page oficial **no menciona** mínimo ni prerequisito de plan, pero **tampoco lo niega**,
  y no tengo otra fuente primaria. No la cité de fuentes secundarias porque no las verifiqué.
  **Verificar en el dashboard al activar el bucket.** Nota: en Cloudflare **Images** sí hay un
  prerequisito documentado y verificado — *"Storage in Images is available only with an Images Paid plan"* —
  pero eso no dice nada sobre R2.
- **Que 24.000 imágenes almacenadas en Cloudflare Images se cobran como 1 bloque completo de $5**
  (vs prorrateo): asumido a partir de *"increments of $5 for every 100,000 images"*. No confirmado.
- **Costo de CPU-ms de sharp en funciones de Vercel** para 24.000 fotos: fuera del alcance de este topic.
  Corresponde al topic de Vercel/compute.
- **Precio de egress de Supabase Storage**: no verificado hoy. El de **S3 sí** está verificado
  ($0.09/GB tras 100 GB/mes free, [AWS S3 pricing](https://aws.amazon.com/s3/pricing/), 2026-08-27) y es
  el único que uso para el número de "cuánto ahorramos". El precio de S3 es un **proxy** del costo de
  egress de un object store cualquiera, no una cotización de un competidor que estemos evaluando.
- **Cuánto ocupa realmente el bucket privado de masters** y si conviene moverlo a **Infrequent Access**
  ($0.010/GB-mes + $0.01/GB de retrieval, con compromiso mínimo de 30 días): no lo calculé. A 7.2 GB la
  diferencia es de centavos, pero a 1.000 tenants (72 GB de masters) valdría la pena rehacer la cuenta.
- **Si `format=auto` sobre origen R2 cuenta una sola transformación única aun cuando el browser pide
  AVIF vs WebP**: la doc lo afirma para Images en general; no verifiqué que aplique idéntico al path
  `/cdn-cgi/image/` sobre un custom domain de R2.
