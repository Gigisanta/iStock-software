# `@istock/media`

Pipeline de fotos: upload server-side → resize propio con sharp → 3 variantes WebP en R2 →
CDN de Cloudflare con **egress $0**.

Owner: `media-agent`. Nadie más escribe acá.
Decisión cerrada: **ADR-006** (`docs/DECISIONS.md`) + `docs/research/r2-images.md` (R2, PASS).

---

## API pública (lo único que el resto del monorepo importa)

```ts
import { uploadListingPhoto, variantUrl, unlinkListingPhotos } from '@istock/media';

// 1. Alta de foto — Route Handler / Server Function, runtime Node.
const photo = await uploadListingPhoto({ tenantId, listingId, data: bytesDelArchivo });
// → { thumbKey, cardKey, detailKey, masterKey, width, height, variants, urls, classAOps: 4 }
// El DAL inserta la fila en `listing_photos` con tenant_id. Este paquete NO toca Postgres.

// 2. Render — la fila de `listing_photos`, no una key suelta.
<img src={variantUrl(photo, 'card')} srcSet={cardSrcSet(photo)} />

// 3. Borrado de listing.
const { releasedKeys } = await unlinkListingPhotos({ tenantId, listingId }, { store });
```

Nadie fuera de este paquete conoce el bucket, la base del CDN ni el formato de las keys.

### `@istock/media/incidents` — el subpath liviano del bootstrap

El paquete tiene **dos** entrypoints, y el segundo existe por un motivo de costo, no de estilo:

```ts
// bootstrap del server (instrumentation.ts): NO carga sharp.
import { setMediaIncidentReporter, isVariant } from '@istock/media/incidents';
```

`apps/web` enchufa el canal de incidentes en `register()`, o sea antes de la primera request y en
**toda** instancia — también en las que nunca van a servir una foto. Llegar a
`setMediaIncidentReporter` por el barrel costaba `./upload → ./pipeline → sharp`: el binario nativo
de libvips más `zod`. Medido en `src/subpath-isolation.test.ts`, que corre en cada `pnpm test`:

| entrypoint | módulos resueltos | objetos nativos | import en frío |
|---|---|---|---|
| `@istock/media` | 265 | 171 (incluye `sharp-*.node` + `libvips-cpp.dylib`) | ~150 ms |
| `@istock/media/incidents` | **3** | **0** | ~7–20 ms |

Exporta `setMediaIncidentReporter` · `resetMediaIncidentReporter` · `reportMediaIncident` ·
`VARIANTS` · `isVariant` y los tipos `MediaIncident` / `MediaIncidentCode` /
`MediaIncidentReporter` / `Variant`. Nada más: ni keys, ni URLs, ni storage, ni env.

El aislamiento se **mide** de dos formas independientes y cada una viene con su control positivo
sobre el barrel — un medidor de arrastre que se rompe deja de ver `sharp` y pasa en verde, que es
el modo de falla que ADR-020 persigue. Ver el docblock del test. La regla derivada, para el que
edite este paquete: **`incidents-entry.ts`, `incidents.ts` y `types.ts` no pueden importar nada
fuera de sí mismos.** Un `import` nuevo en cualquiera de los tres pone el test en rojo.

Dato que corrige una creencia previa: **`@aws-sdk/client-s3` nunca estuvo en el camino del
bootstrap.** `storage/r2.ts` lo carga con `await import()` dentro de cada método desde antes de
esta slice, así que el barrel tampoco lo traía. El costo eager del barrel es `sharp` + `zod`.

### Por qué `variantUrl(photo, variant)` y no `variantUrl(key, variant)`

Con la key opaca de ADR-006 **no se puede derivar** la key de una variante desde otra. Esa
imposibilidad *es* la feature. Por eso la función recibe el mapeo (`thumbKey`/`cardKey`/`detailKey`,
que son exactamente las columnas de `listing_photos`) y elige, no calcula.

### Dos superficies: la que tira y la que degrada

| función | tira | quién la llama |
|---|---|---|
| `publicUrlForKey(key)` | **sí** | `uploadListingPhoto` (camino de escritura) |
| `variantUrl` · `variantUrls` · `cardSrcSet` · `renderableVariantUrls` | **no** | render (panel + vidriera) |

En el **alta**, tirar es lo correcto: el reseller ve un error y nada malo se guarda.

En el **render**, tirar es lo peor que se puede hacer. Bajo `cacheComponents` una excepción adentro
de un render cacheado no produce un 500: produce un **200 que nunca cierra el stream**, y la ficha
queda colgada hasta el timeout (300 s medidos por `qa-agent`, con un mensaje que ni siquiera
hablaba de media). Así que el camino de render **degrada**: `variantUrl` devuelve
`UNRENDERABLE_VARIANT_URL` (`'about:invalid'`: cero requests, se ve el `alt`) y reporta el evento
por `setMediaIncidentReporter`. No es `''` a propósito — un string vacío dentro del `srcset` que
arma la vidriera (`${photo.card} 800w, …`) se lee como la URL relativa `800w` y el browser la
pide contra la función de Next. Para omitir la foto de verdad —que es lo que la vidriera quiere— está
`renderableVariantUrls(photo)`, que devuelve `null` y deja que el caller saltee la fila:

```ts
const urls = renderableVariantUrls(row);
if (urls === null) continue;   // la ficha se arma con las fotos que sí sirven
```

Degradar en silencio sería cambiar un problema ruidoso por uno invisible: por eso el reporte no es
opcional, es la mitad del arreglo.

### El escáner de PII no mira el segmento de hash (y por qué eso no lo debilita)

`assertPublicVariantKey` rechaza UUIDs, emails, tokens sensibles y **15 dígitos seguidos** (IMEI).
Ese último escáner corría sobre la key entera, y una key content-addressed es hexadecimal: en hex
un dígito sale 10 de 16 veces, así que **0,633 % de los hashes contienen 15 dígitos seguidos**
(medido: 12.665 de 2.000.000). Eso es 1 de cada 158 variantes, **1,89 % de las fotos** y **57,6 %
de los onboardings de 15 equipos × 3 fotos** — y como la key es un hash del byte, reintentar daba
el mismo rechazo: esa foto **no se podía subir nunca**.

El arreglo no afloja el escáner: lo aplica sobre la parte de la key **que no generamos nosotros**.
`parseCanonicalVariantKey` exige que la key sea, carácter por carácter, el round-trip de
`publicVariantKey` (tres segmentos, versión literal, 32 hex minúsculas, shard *derivado* del hash);
recién entonces exime **el rango de índices del hash**, y escanea el esqueleto `v1/{ab}` + `.webp`.
Cualquier key que no round-trippee se escanea **entera**, con los cuatro escáneres. Aflojar el
regex de forma no extiende la exención: la rompe.

`contentHash` y `publicVariantKey` no cambiaron: los mismos bytes siguen dando la misma key y dos
tenants con la misma foto siguen compartiendo el objeto.

### Por qué `unlinkListingPhotos` y no `deleteListingPhotos`

La key pública es el **hash del byte de salida**. Dos tenants que suben la misma foto producen la
misma key y **comparten el objeto**. Borrar el objeto al borrar un listing es un **borrado cruzado
entre tenants**: el tenant B se queda sin vidriera porque el tenant A borró un equipo.
`CLAUDE.md` §2 lo marca como causal de rechazo automático.

`unlinkListingPhotos` borra **la fila del mapeo** y devuelve `deletedObjects: 0` en el tipo.
El byte se recolecta después con `collectOrphanObjects`, que exige un conteo de referencias
**cruzando todos los tenants** y sólo borra si da exactamente 0.

> **Drift declarado para el LEAD:** `.claude/agents/media-agent.md` (regla 5 y 7) y
> `.claude/skills/r2-media/SKILL.md` todavía dicen `t/{tenantId}/l/{listingId}/{variant}/{hash}.webp`
> y `deleteListingPhotos()`. Eso es **anterior** a ADR-006 y hoy está prohibido por `CLAUDE.md` §2
> ("URL pública de foto que contenga `tenant_id`/`listing_id` → rechazo" y "borrado de un objeto de
> R2 por key al borrar un listing → rechazo"). Se implementó lo que dice `CLAUDE.md` + ADR-006.
> Los dos archivos son del LEAD: hay que actualizarlos.

---

## Bytes medidos (no los del techo)

Imagen de referencia: **4000×3000 (12 MP) JPEG q88, 2935.9 KB**, generada de forma determinista
por `src/fixtures/reference-image.ts` (fbm de 9 octavas + 260 props + grano de sensor; simula el
escritorio de un local, no un gradiente liso). Medido con `pnpm --filter @istock/media bench`
en macOS arm64, **sharp 0.35.4 / libvips 8.18.6**.

| objeto   | px        | bytes medidos | techo    | uso  | q  | intentos | bucket              |
|----------|-----------|--------------:|---------:|-----:|---:|---------:|---------------------|
| `thumb`  | 200×150   |    **7.5 KB** |  25.0 KB |  30% | 72 |        1 | `istock-media` (púb) |
| `card`   | 800×600   |   **49.5 KB** | 150.0 KB |  33% | 78 |        1 | `istock-media` (púb) |
| `detail` | 1600×1200 |  **125.6 KB** | 250.0 KB |  50% | 78 |        1 | `istock-media` (púb) |
| `master` | 1600×1200 |  **306.6 KB** | 350.0 KB |  88% | 90 |        1 | `istock-originals` (**privado**) |

- **Público por foto: 182.6 KB.** Con el master privado: 489.2 KB.
- La ficha pública carga `detail` = **125.6 KB**, contra un techo de 200 KB en el presupuesto de
  performance de `docs/ARCHITECTURE.md`.
- Reducción contra el archivo del celular: **2935.9 KB → 182.6 KB públicos (−94%)**.

### CPU

**533 ms** por foto en esta máquina (1 decode de 12 MP + 1 downscale + 4 encodes WebP), promedio
de 3 corridas. Es costo **por upload**, no por pageview: no escala con tráfico. 15 equipos × 4 fotos
= 60 uploads ≈ **32 s de CPU** para la carga de una tarde entera.
`UNVERIFIED`: el CPU-ms real en una función de Vercel (no en un M-series) todavía no se midió.

### WebP vs AVIF — medido, no supuesto

| variante | WebP q78 | AVIF q55 | Δ bytes | Δ CPU |
|---|---:|---:|---:|---:|
| `card`   |  49.5 KB | 38.0 KB | −23% | 53 ms → **160 ms** (3.0×) |
| `detail` | 125.6 KB | 100.7 KB | −20% | 192 ms → **414 ms** (2.2×) |

**Se queda WebP.** El ahorro de bytes no compra nada en dólares (egress es $0 y el storage sale
$0.03/mes), sólo LCP; y para servir los dos formatos harían falta content negotiation y el doble de
objetos, que es justo lo que la key opaca servida por `<img src>` plano evita. Se revisa si algún
día el LCP mobile no llega a 2.5 s.

---

## Costo (línea "Media / R2" de `docs/COST.md`)

Supuestos de R2 (`docs/research/r2-images.md`, pricing 2026-08-07): storage $0.015/GB-mes ·
Class A $4.50/M · Class B $0.36/M · **egress $0** · free tier 10 GB-mes + 1M Class A + 10M Class B ·
**la facturación redondea hacia arriba**.

| escala | fotos | storage total | facturable | USD/mes |
|---|---:|---:|---:|---:|
| 100 tenants (60 listings × 4 fotos) | 24.000 | **11.19 GB** | 2 GB-mes | **$0.03** |
| 1.000 tenants | 240.000 | **111.9 GB** | 102 GB-mes | **$1.53** |

Menos que la estimación de R2 ($0.09 / $2.16) porque los bytes medidos son 489 KB/foto contra los
640 KB supuestos.

- **Class A:** exactamente **4 PutObject por foto** (3 variantes + 1 master). Es el valor de diseño
  que vigila la alarma de anomalía de `cost-auditor` (`Class A del mes / fotos del mes > 5` ⇒ hay
  reprocesamiento). A 1.000 tenants con rotación total son 960.000/mes = **96% del free tier**: eso
  es *capacidad*, no anomalía.
- **Class B:** 0 en el upload. En la vidriera, sólo cache miss.
- **Egress: $0.** Los mismos 180–540 GB/mes en S3 costarían **$7.20–39.60/mes** a 100 tenants.
- **Costo nuevo introducido:** CPU-ms de sharp en el upload. Por upload, no por pageview.

---

## Reglas que el código hace cumplir (no son comentarios)

| # | Regla | Dónde |
|---|---|---|
| 1 | Nada entra a R2 sin resize; máx 1600px | `pipeline.ts`, `MAX_OUTPUT_EDGE` |
| 2 | El techo de bytes se hace cumplir **en runtime**, no sólo en el test | `encodeWithinBudget` |
| 3 | La key pública no puede contener tenant/listing/IMEI/email | `assertPublicVariantKey` |
| 4 | La key del master nunca se convierte en URL | `publicUrlForKey` |
| 5 | `r2.dev` rechazado como base pública | `env.ts` + `url.ts` |
| 6 | El master no puede compartir bucket con las variantes | `env.ts` + `R2Driver` |
| 7 | El paquete no exporta ningún borrado de objeto por key | `index.ts` + `media-lint` M011 |
| 8 | Una credencial de R2 con prefijo `NEXT_PUBLIC_` explota | `env.ts` |
| 9 | EXIF/GPS descartado (sharp no copia metadata y no se pide) | `pipeline.ts` + test |
| 10 | Zod en el borde de `uploadListingPhoto` y `unlinkListingPhotos` | `upload.ts`, `unlink.ts` |

### `Cache-Control` — la trampa que deja los objetos sin cache

Se setea con el parámetro **`CacheControl`** de `@aws-sdk/client-s3`:
`public, max-age=31536000, immutable`.

`httpMetadata.cacheControl` es el **binding de Workers** y no existe en el runtime Node de Vercel.
Usarlo deja los objetos sin `Cache-Control` y con **edge TTL default de 120 minutos** → revalidación
contra R2 12 veces por día por objeto → Class B evitable y p95 peor. La regla `M001` de
`scripts/media-lint.mjs` falla si la string `httpMetadata` aparece en el código.

### Degradación adaptativa

Las tres variantes públicas bajan calidad (78 → 45, de a 6) y, si aun así no entran, aplican un
denoise creciente (sigma 1.0 → 1.6). Sólo si nada alcanza, **lanzan**. Nunca sale una variante
pesada a la vidriera. El caso normal es `attempts === 1` y `blurSigma === 0`; el test de aceptación
lo verifica, así que subir `quality` o `maxEdge` pone el suite en rojo aunque el techo se siga
cumpliendo por degradación.

El **master** tiene techo **blando**: no se blurea nunca (su razón de ser es re-encodear las
variantes el día que cambiemos tamaños) y no rechaza la foto del dueño; si no entra en 350 KB se
guarda igual y se reporta `masterWithinBudget: false`. Vive en un bucket privado: su exceso es
storage y nada más.

---

## Sin credenciales de R2 (B1 abierto)

`MEDIA_DRIVER=local` (default) usa `LocalDiskDriver`, que escribe en `<cwd>/.media-local/{bucket}/`
con un sidecar `.meta.json` que conserva `contentType` y `cacheControl`. **El pipeline de resize y
los techos de bytes se testean sin ninguna credencial.**

Cuando B1 se cierre:

```bash
MEDIA_DRIVER=r2
R2_ACCOUNT_ID=...            # server-only
R2_ACCESS_KEY_ID=...         # server-only
R2_SECRET_ACCESS_KEY=...     # server-only
R2_BUCKET_MEDIA=istock-media
R2_BUCKET_ORIGINALS=istock-originals
NEXT_PUBLIC_MEDIA_BASE_URL=https://img.maat.work
```

Checklist de infra para el humano (no lo hace el código):

1. `istock-originals` **privado**: sin public access, **sin custom domain**. Sólo S3 API.
2. `istock-media` público **detrás de `img.maat.work`**. `r2.dev` prohibido: rate-limited, sin
   cache, sin WAF.
3. Smart Tiered Cache en la zona (menos requests llegan a R2 ⇒ menos Class B).
4. No hace falta "Cache Everything": `.webp` ya está en las extensiones cacheadas por default.
5. Transformaciones de Cloudflare **habilitadas pero fuera del hot path**, bajo 5.000 únicas/mes
   ($0). Si el uso se acerca a 5.000, es señal de que falta una variante fija.

---

## Aceptación

```bash
pnpm --filter @istock/media test        # 96 tests, 8 archivos
pnpm --filter @istock/media typecheck
pnpm --filter @istock/media lint        # media-lint: 10 reglas de ADR-006 / CLAUDE.md §2
pnpm --filter @istock/media bench       # imprime la tabla de bytes medidos de arriba
```

El test que cumple el gate del oficio es `src/pipeline.test.ts`: **falla si una variante supera su
presupuesto de bytes** con la imagen de referencia de 12 MP. Los techos están escritos como
literales en el test, **no importados de `budgets.ts`**, a propósito: si alguien "arregla" un fallo
subiendo la constante del presupuesto, el test sigue rojo.
