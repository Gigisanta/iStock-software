# COST — modelo de costo de infraestructura

_Owner: `cost-auditor`. **Escrito por el LEAD en FASE 1** (excepción declarada en `CLAUDE.md` §4).
Números con fuente salvo los marcados `[EST]` / `[UNVERIFIED]`, que **no** son evidencia._
_Fecha: 2026-08-28. Insumos: R1 (wildcard/ISR), R2 (R2/imágenes), R3 (LLM), R7 (amenazas)._
_Re-medido el 2026-08-27 después de **ADR-011** (el slug inexistente dejó de ser 404) y **ADR-012**
(los dos polos del cache). Lo que cambió está en §2.1; lo que **no** cambió también, y dice por qué._

## Objetivo duro
> **Costo marginal de infra < USD 0.50 / mes por tenant activo, hasta 100 tenants.**

El **piso fijo** se cuenta **aparte** del marginal. No mezclar.

## 0. Conclusión, arriba de todo

**Se cumple, y con margen — pero no por donde parecía en FASE 0.**

| | FASE 0 `[EST]` | FASE 1 (con fuente) | FASE 4 (S1 + S2 **medidas**) |
|---|---|---|---|
| Marginal plan **Base** | ~USD 0.03 | USD 0.07 | **USD 0.09** |
| Marginal plan **Negocio** | 0.03 + `[R3]` | USD 0.24 – 0.30 | **USD 0.25 – 0.31** |
| Headroom del Negocio contra el objetivo | «~15× abajo» | ~1.7× | **~1.6×** |

**S2 (pipeline de fotos) aporta USD 0.013/tenant/mes** y el 70% de eso **no es R2**: es el
Active CPU de `sharp` en el upload por Server Action. R2 entero —storage, writes, reads, egress—
cuesta **USD 0.005/tenant/mes**, el 1% del objetivo. Ver §2.2.

La frase de FASE 0 *«el `base` está ~15× abajo»* era optimista y ya no aplica al plan que importa.
**El chatbot se come el 70–77% del presupuesto de infra del plan Negocio.** No está mal — está
dentro —, pero deja de ser ruido: cualquier cosa que afloje la dieta de contexto o el soft cap sale
directamente de ese margen.

**Y el hallazgo que importa más que todo lo anterior:** con los números de R4, la **comisión de
Mercado Pago (~USD 1.03/mes por cliente pagador `[UNVERIFIED]`) cuesta 3–4× toda la infraestructura
marginal junta.** Estamos optimizando el vector equivocado si miramos sólo infra. Ese número está
**bloqueado en B3** y es el experimento 2 de ADR-008.

## 1. Piso fijo de plataforma
| servicio | plan | USD/mes | estado |
|---|---|---|---|
| Vercel | **Pro** | **20** | **verificado (R7).** Obligatorio **por licencia**, no por features: Hobby prohíbe uso comercial y *"advertising the sale of a product or service"* es exactamente la vidriera. Incluye USD 20 de credit y 1 seat (seat extra: USD 20). |
| Supabase | Pro | ~25 | **`[UNVERIFIED]`** — ver §7 |
| Cloudflare R2 | uso | **0.00 – 0.09** | verificado (R2). Free tier: 10 GB-mes + 1M Class A + 10M Class B |
| Sentry + PostHog | free | 0 | |
| **Total** | | **~45** | |

**El piso domina hasta bien entrado el crecimiento.** Diluido: **USD 2.25/tenant a 20 tenants ·
USD 0.90 a 50 · USD 0.45 a 100.** El marginal recién empieza a importar pasados ~100 tenants.
Contra un plan Base de USD 19 el piso es irrelevante desde el tenant ~3; no es un riesgo de negocio,
es sólo la razón por la que el objetivo está escrito sobre el marginal y no sobre el total.

## 2. Costo marginal por tenant

**Supuestos** (los que no tienen fuente son míos y están marcados; si cambian, cambia todo):
60 listings · 4 fotos/listing · 3 variantes · 3.000 pageviews/mes `[EST]` ·
~120.000 requests/mes/tenant `[EST, R1]` · plan Negocio con el soft cap de **40 msgs/día = 1.200/mes**
(`CLAUDE.md` §3).

| vector | cálculo | USD/mes | fuente |
|---|---|---|---|
| R2 storage | **120,2 MB medidos** (240 fotos × 500.938 B) × USD 0.015/GB | **0.0018** | **§2.2, medido** |
| R2 Class A (writes) | 288 PutObject/mes × USD 4.50/1M | **0.0013** | **§2.2, medido** |
| R2 Class B (reads) | ~4.320 GET de origen/mes × USD 0.36/1M | **0.0016** `[EST]` | §2.2 |
| R2 egress | **0 por diseño** | **0** | R2: egress Free |
| **Upload: Active CPU de `sharp`** | 72 fotos/mes × 1,35 s × USD 0.128/CPU-h | **0.0035** `[UNVERIFIED el precio]` | **§2.2, CPU medido** |
| Upload: memoria + invocaciones + transferencia a R2 | ver §2.2 | **0.0056** `[EST]` | §2.2 |
| **ISR Writes** | ~200 mutaciones/mes × 15 write units | **0.012** | R1: USD 4.00/1M units de 8 KB (iad1) |
| ISR Reads | sólo en CDN miss | ~0 | R1: USD 0.40/1M |
| Edge Requests | 10M incluidos ≈ 80 tenants; después USD 2.00/1M | **~0.04** | R1 (iad1) |
| **WAF Rate Limiting** | 120k allowed req/mes × USD 0.50/1M | **0.06** | R7 |
| Postgres | 95% de hits cacheados | ~0 | ADR-007 |
| LLM plan **Base** | **widget ausente** | **0** | `CLAUDE.md` §3 |
| LLM plan **Negocio** | 1.200 msgs × USD 0.000144–0.000192 | **0.17 – 0.23** | R3 |
| **Marginal Base** | | **~USD 0.09** | |
| **Marginal Negocio** | | **USD 0.25 – 0.31** | |

La línea vieja de R2 decía **«~140 MB → ~0.001»** y estaba baja **4,7×**, no por el storage
(120 MB medidos contra 140 supuestos: acertó) sino porque **contaba Class A y Class B como si
fueran cero**. No lo son; son chicos, que es otra cosa. Y aparecieron dos renglones que R2 no
tiene: el upload pasa por una Vercel Function y `sharp` cuesta CPU. Detalle en §2.2.

**Las dos líneas que no estaban en FASE 0 y ahora pesan:** el WAF rate limiting (USD 0.06, **12% del
presupuesto** — el precio de no fragmentar el cache filtrando en el edge en vez de en la app) y los
Edge Requests, que **no son gratis pasados ~80 tenants** porque el proxy corre en el 100% de los
pageviews, HIT incluido.

### 2.1 Medido en S1 — la vidriera dejó de ser un supuesto (2026-08-27)

Primera vez que estas líneas se **miden** en vez de estimarse. Método: `next build` + `next start`
(Next 16.3.3, `cacheComponents: true`) contra el Postgres 16 local, contando queries con
`pg_stat_user_tables` sobre `tenants` y leyendo los headers crudos con `curl -D -`.
Se midió **dos veces**: en `6a6513c` (base) y con S1 aplicado, para poder restar.
**Tercera pasada (post ADR-011/012):** mismo método, build `YlYSocwwIEzv3EIsY06xz`, `next start`
sobre `{slug}.127.0.0.1.nip.io`. Las filas que se re-midieron dicen *(re-medido)*.

⚠️ **Es `next start`, no Vercel.** Lo que se mide acá es el comportamiento del runtime de Next
(cuántas queries, cuántos bytes, qué se cachea). Los **precios** siguen siendo los de R1 y el
comportamiento del CDN de Vercel sigue `[UNVERIFIED]` hasta que haya un deploy real.

| qué | cómo se midió | resultado |
|---|---|---|
| **hits de vidriera que tocan Postgres** | 50 GET a un slug tibio | **0 / 50** (base: 0 / 50 también) |
| cache miss frío | 1 GET a un slug nuevo | **1 query**, y ninguna más |
| **slug inexistente (el «miss»)** *(re-medido)* | 4 GET seguidos a un slug nuevo | 1ª: **`200`**, sin `x-nextjs-cache`, `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate`. 2ª en adelante: **`200`** con `x-nextjs-cache: HIT`, **`Cache-Control: s-maxage=300, stale-while-revalidate=600`**, `x-nextjs-stale-time: 60` |
| **cuerpo del miss** (ADR-011, variante B) *(re-medido)* | HTML del HIT sin `<script>`/`<style>` y sin tags | **~270 B visibles** (269 B medidos por el LEAD, 271 re-medidos acá: la diferencia es el trim de whitespace, no el DOM) · `<title>` propio (`No hay ninguna vidriera en esta dirección`) · **2** `<meta name="robots" content="noindex, nofollow">` · control `demo`: `200`, 384 B y **un solo** `<meta robots>` |
| **polo positivo, header real** *(re-medido)* | 2 GET a `demo` | `200`, `x-nextjs-cache: HIT`, **`Cache-Control: s-maxage=2592000, stale-while-revalidate=28944000`**, `x-nextjs-stale-time: 300` |
| **entrada de ISR del miss** *(re-medido)* | `.next/server/app/s/{slug}.*` | html 11.232 B + `_full` 7.765 B + `__PAGE__.segment.rsc` 6.583 B + `_tree` 504 B + meta 368 B = **26.452 B → 4–6 write units** |
| **entrada de ISR del tenant que existe** *(re-medido)* | `.next/server/app/s/demo.*` | html 14.831 B + `_full` 9.617 B + **`__PAGE__.segment.rsc` 8.451 B** + `_tree` 505 B + meta 321 B = **33.725 B → 5–8 write units**. La medición de S1 decía «24,5 KB / ~6 units»: **se le había escapado el `__PAGE__.segment.rsc`**, 8,4 KB, un tercio de la entrada |
| HTML por pageview | mismo tenant, base → S1 → hoy | 14.386 → 14.326 → **14.831 B**. Los +505 B contra S1 están medidos; **a qué cambio se deben, no lo medí** (no tengo el build anterior a la variante B en el árbol) |
| **bundle del proxy** (corre en el 100% de los hits, antes del cache) | `.next/server/chunks/[root-of-the-server]__02a5epf._.js` | 214.960 → **216.038 B (+1.078 B)**. Fuentes propias: `proxy.ts`, `domain/wa.ts`, `domain/reserved-slugs.ts` — el barrel de `@istock/domain` **no** arrastró `money`/`reservation` |
| `set-cookie` en `(storefront)` *(re-medido)* | headers del positivo y de las 4 requests del miss | **ninguna** (apagaría el CDN entero) |

**Dos correcciones al modelo de §2:**
1. Una regeneración cuesta **5–8 write units, no 15** — y **no ~6**, como decía la primera pasada:
   esa cuenta omitía el `__PAGE__.segment.rsc` (8.451 B, un tercio de la entrada). La
   sobrestimación real del renglón de §2 es **~1,9×, no ~2,5×**. El rango sale de que **no está
   verificado si Vercel cobra el techo de 8 KB por archivo (8 units) o por entrada (5 units)** —
   es un hueco, no una estimación. No se baja el número de §2 todavía: 15 sigue siendo el techo
   conservador y la entrada va a crecer con fichas y fotos (S2). Se re-mide en S2.
2. **La primera visita a un slug, después de cada deploy o de cada invalidación, NO es cacheable**:
   sale en modo *postponed* (`Cache-Control: private, no-cache, no-store`) y es 1 invocación de
   función + 1 query. Recién la segunda queda en ISR. Es el mecanismo exacto por el que se rompe
   el 95%, y ahora está medido en vez de supuesto.

### El `s-maxage=2592000` que este documento afirmaba del miss: qué pasó realmente

El renglón viejo decía que el slug inexistente se servía con `s-maxage=2592000` (30 días).
**Medido hoy, ya no: el miss sale con `s-maxage=300, stale-while-revalidate=600`.** De las dos
hipótesis posibles, la buena es la segunda: **el header cambió y el renglón quedó obsoleto.** No hay
un CDN sirviendo 30 días por encima de un perfil que declara 300 s. El perfil corto de ADR-012
**compra exactamente lo que dice comprar**, y ahora está verificado en el header, no en el docblock.

La aritmética que lo cierra, para que no haya que creerme. `getCacheControlHeader` de Next
(`node_modules/next/dist/server/lib/cache-control.js:12-19`) emite
`s-maxage=<revalidate>, stale-while-revalidate=<expire − revalidate>`. Con eso, cada header medido
se deriva de un perfil y de uno solo:

| perfil | `stale` / `revalidate` / `expire` | header que produce | medido en |
|---|---|---|---|
| `'max'` de Next (`config-shared.js:179`) | 300 / **2.592.000** / 31.536.000 | `s-maxage=2592000, stale-while-revalidate=28944000` | **el polo positivo (`demo`)**, hoy |
| `STOREFRONT_MISS_LIFE` (`_lib/cache-life.ts`) | 60 / **300** / 900 | `s-maxage=300, stale-while-revalidate=600` | **el miss**, hoy |

`28.944.000 = 31.536.000 − 2.592.000`, y `600 = 900 − 300`. **El header viejo del renglón 87 era,
byte por byte, el perfil `'max'` aplicado al camino negativo**: era la huella del hallazgo MEDIUM-C,
escrita en este documento como si fuera comportamiento normal. Hoy `'max'` sigue emitiendo ese
header — pero sobre el tenant que existe, que es donde corresponde.

**Corolario que ADR-012 no dice con estos números:** `cacheLife('max')` **no es infinito**. Son
30 días de `s-maxage` + 335 de `stale-while-revalidate`. Contra el CDN de Vercel da igual, porque
ahí la invalidación es por tag (`x-next-cache-tags` viaja en la respuesta, verificado en el `.meta`
de `demo`). Contra cualquier intermediario que **no** hable ese protocolo, `s-maxage=2592000` es
una promesa de 30 días sin hook de purga. Ver §7 — es un hueco abierto, no un hallazgo cerrado.

### El precio del polo negativo, en la unidad correcta

ADR-012 cotizó el polo negativo en queries a Postgres (~12/slug/hora bajo escaneo sostenido) y no
en ISR writes. Faltaba la mitad. Con la entrada del miss medida (**6 units**, techo del rango):

```
escaneo one-shot de 10.000 subdominios inventados
  perfil corto:  10.000 × 6 units × USD 4.00/1M = USD 0.24   → 0 entradas vivas a los 900 s
  con 'max':     10.000 × 6 units × USD 4.00/1M = USD 0.24   → 10.000 entradas vivas 30 d, que nadie purga

escaneo SOSTENIDO 1 h, re-tocando cada slug dentro de cada ventana de 300 s (120.000 requests)
  perfil corto:  12 × 6 × 10.000 = 720.000 units = USD 2.88 en esa hora
  con 'max':                        60.000 units = USD 0.24 en esa hora
```

**El perfil corto cuesta 12× más en writes bajo escaneo sostenido.** Es el precio explícito de no
dejar 10.000 entradas muertas de 30 días, y está bien pagado: cambia un problema **durable y no
purgable** por uno **transitorio y rate-limiteable**. Lo que lo acota es el **WAF rate limiting**
que ya está presupuestado en §2 (USD 0.06/tenant/mes): sin esa regla, esta línea no tiene techo.

**No mueve el marginal por tenant y no lo va a mover:** los slugs inventados no son de nadie, así
que este gasto es de plataforma, no atribuible. Por eso necesita su propia métrica (§5) — es el
único vector del documento que **no** se detecta mirando el costo de un tenant.

**El % de hits que llega a Postgres, con la aritmética a la vista:**
```
queries/tenant/mes = renders fríos
                   = deploys que reciben visita (30/mes [EST]) + sesiones de mutación visitadas (30/mes [EST])
                   = 60
60 / 3.000 pageviews = 2 %          (alarma: 5 %)
```

### Gate anticipado para S2 (stock): la invalidación tiene que coalescer

S1 llama `invalidateStorefront()` **una vez en la vida del tenant** (el alta), así que su costo es
ruido. S2 lo va a llamar en cada publicar/despublicar/reservar/vender. Con `updateTag` —que es
*read-your-own-writes* y por diseño **no** sirve stale— cada llamada le cobra al próximo visitante
un render bloqueante + 1 query:

```
200 mutaciones/mes/tenant sin agrupar → 200 renders fríos
200 / 3.000 pageviews = 6,7 %  →  POR ENCIMA de la alarma de 5 %
ISR writes: 200 × 8 units × USD 4.00/1M = USD 0.0064/tenant/mes  (la plata no es el problema)
```
El problema no es el gasto, son las **queries a Postgres**: el vector que el objetivo protege.
Mitigación esperada en S2 (no en S1): las mutaciones de una misma sesión de carga colapsan en una
sola invalidación, o se invalida al terminar la tanda. **Cargar 15 equipos tiene que costar 1
regeneración, no 15.** Es gate de `cost-auditor` para S2.

### 2.2 Medido en S2 — el pipeline de fotos (2026-08-28)

Segunda slice que se **mide**. Método: los bytes de las tres variantes públicas salen del gate del
LEAD (`scripts/accept-s2.sh` M1, que corre `scripts/probes/s2-media-measure.test.ts`); los bytes del
master y los **milisegundos de CPU** salen de `pnpm --filter @istock/media bench`, re-corrido hoy por
`cost-auditor`. Imagen de referencia: **4000×3000 (12 MP) JPEG q88, 2.935,9 KB**, determinista.

⚠️ **Es una Mac, no Vercel.** Los bytes no dependen de la máquina (`sharp`/libwebp son
deterministas para el mismo input y los mismos parámetros). Los **677 ms de CPU sí**, y el precio
del Active CPU de Vercel **no está en ninguna research de este repo** — ver §7.

#### Los bytes, medidos por dos writers distintos

| objeto | gate del LEAD | bench del owner | techo | uso | bucket |
|---|---:|---:|---:|---:|---|
| `thumb` | **7.718 B** | 7,5 KiB | 25 KiB | 30% | `istock-media` (púb.) |
| `card` | **50.692 B** | 49,5 KiB | 150 KiB | 33% | `istock-media` (púb.) |
| `detail` | **128.570 B** | 125,6 KiB | 250 KiB | 50% | `istock-media` (púb.) |
| `master` | **el gate NO lo mide** | **306,6 KiB = 313.958 B** | 350 KiB (blando) | 88% | `istock-originals` (**privado**) |
| **por foto** | 186.980 B públicos | **500.938 B con master** | | | |

**El hueco que hay que decir en voz alta:** el gate del LEAD verifica que el master esté en el
bucket privado y que su key no sea derivable, pero **no cuántos bytes pesa**. Y el master es el
**62,7%** de los bytes almacenados de S2. O sea: la línea de storage más grande de esta slice sale
de una medición hecha por el mismo writer que escribió el encoder. No es un FAIL —el número es
plausible y el techo es blando a propósito— pero es una medición de una punta sola y así se
registra. Se cierra agregando el `master` al probe del LEAD, que ya tiene el objeto en la mano.

#### 1. Bytes y operaciones por tenant

**Supuestos, explícitos:** `MIN_PHOTOS_TO_PUBLISH = 3` (`packages/domain/src/listing-status.ts`),
así que **3 fotos es el piso del producto, no una estimación**. Uso 4 fotos/listing en el caso base
para no romper la continuidad con §2, y 3 en los extremos del rango del ICP (20–200 equipos).
Rotación mensual del stock: **30%** `[EST]` — un reseller que vende y repone ~18 de 60 equipos.

```
bytes/foto = 7.718 (thumb) + 50.692 (card) + 128.570 (detail) + 313.958 (master) = 500.938 B
```

| tenant | fotos | bytes | GB | storage USD/mes (×0.015) |
|---|---:|---:|---:|---:|
| 20 equipos × 3 fotos | 60 | 30.056.280 | 0,0301 | **0.00045** |
| **60 equipos × 4 fotos (caso base §2)** | **240** | **120.225.120** | **0,1202** | **0.0018** |
| 200 equipos × 3 fotos (techo del ICP) | 600 | 300.562.800 | 0,3006 | **0.0045** |

**El tenant más grande del ICP cuesta menos de medio centavo de storage.** A 100 tenants del caso
base son 12,02 GB, de los cuales **10 GB son free tier**: la factura real de storage de la flota
entera es **USD 0.03/mes**. Uso igual el número sin free tier (0.0018) porque el free tier es piso
de plataforma y este documento no mezcla piso con marginal (§0).

**Class A (writes).** `uploadListingPhoto` hace exactamente **4 `PutObject` por foto** (3 variantes
+ 1 master) y **cero `GetObject`**. No es una estimación: está en el tipo (`classAOps: 4`) y el
probe del LEAD lo cuenta.

```
carga inicial:  240 fotos × 4 = 960 ops    (UNA vez, no mensual) × USD 4.50/1M = USD 0.0043
régimen (30%):   72 fotos × 4 = 288 ops/mes                      × USD 4.50/1M = USD 0.0013
flota de 100 tenants en régimen: 28.800 ops/mes = 2,9% del free tier de 1M
```

**Class B (reads) — acá el modelo ingenuo estaba mal.** «Class B ≈ 0 porque el CDN cachea» es
falso: el CDN de Cloudflare cachea **por PoP**, así que el piso de Class B no lo fija el tráfico,
lo fija **objetos × PoPs que reciben tráfico**, y se paga otra vez cada vez que un objeto se cae
del cache del PoP.

```
objetos públicos por tenant = 240 fotos × 3 variantes = 720
tráfico regional (6 PoPs argentinos/vecinos):  720 × 6   =   4.320 GET/mes → USD 0.0016
techo absurdo (300+ PoPs, tráfico global):     720 × 300 = 216.000 GET/mes → USD 0.078  ← 16% del objetivo
```

El caso regional es el real para un reseller del Alto Valle y es el que va al modelo. **El techo
está escrito para que exista el número**: si una vidriera se hace viral fuera del país, Class B es
el único renglón de R2 que se mueve de verdad, y se mueve 48×. `[EST]`: no hay medición porque no
hay bucket (B1) ni vidriera con fotos (S3).

#### 2. Egress — el camino sale por Cloudflare, verificado en el código

| eslabón | qué dice el código | veredicto |
|---|---|---|
| armado de la URL | `packages/media/src/url.ts` concatena `NEXT_PUBLIC_MEDIA_BASE_URL` + key, y **nadie más arma URLs** (gate M5 de `accept-s2.sh`) | ✅ |
| `r2.dev` | `url.ts` y `env.ts` **lanzan** si la base termina en `.r2.dev` (rate-limited, sin cache: cada request sería un Class B) | ✅ |
| Vercel Image Optimization | `next/image` prohibido por gate M5 y por la regla W006 de `web-lint` | ✅ |
| Supabase Storage | no aparece en el pipeline; el único driver es R2 (+ uno local de dev) | ✅ |
| `/_media/{key}` en Vercel | la ruta **devuelve 404 cuando `MEDIA_DRIVER=r2`**, a propósito y comentado | ✅ |
| original >500 KB al browser | el master (306,6 KB) vive en `istock-originals`, privado, y su key no matchea el regex de la ruta pública. Lo más pesado que puede bajar un visitante es `detail` = **128.570 B** | ✅ |

**Egress de imágenes: 0 GB/mes por Vercel y 0 por Supabase. Cero bytes, no «pocos».**

**El hallazgo, y ahora está cerrado en el código: un `superRefine` que lo bloquea en el boot.**
`media-agent` cerró el hueco en `packages/media/src/env.ts`. `NEXT_PUBLIC_MEDIA_BASE_URL` pasó de
tener default **`http://localhost:3000/_media`** a ser `.optional()`, con ese default aplicado
recién en un `.transform()` final — así el `superRefine` puede distinguir "no la setearon" de "la
setearon". Dos reglas nuevas sobre esa distinción: (a) con `MEDIA_DRIVER=r2`, si
`NEXT_PUBLIC_MEDIA_BASE_URL` falta o viene en blanco, **el boot falla**; (b) se agregó
`VERCEL_ENV` al schema y **`VERCEL_ENV === 'production' && MEDIA_DRIVER !== 'r2'` también hace
fallar el boot**, citando en el mensaje de error el número de abajo. El repo sigue sin
`vercel.json` — no hace falta: el gate vive en el schema de Zod que corre en cada arranque del
proceso, no en config de plataforma.

Lo que costaría ese deploy si esta regla no existiera, con los precios de R1 (`iad1`) — la cuenta
que hoy cita el propio mensaje de error:
```
3.000 pageviews × 5 imágenes            = 15.000 imágenes/mes/tenant
Edge Requests (se cobran en el 100%, HIT incluido):
  15.000 × USD 2.00/1M                  = USD 0.030/tenant/mes
Fast Origin Transfer del 5% que no pega en el CDN de Vercel:
  750 × 50.692 B = 38 MB × USD 0.06/GB  = USD 0.0023   (en gru1, ×6,8 = USD 0.016)
                                        ─────────────
                                          USD 0.033/tenant/mes  ≈ 7% del objetivo, por UNA env var
                          a 100 tenants:  USD 3.30/mes de puro desperdicio
```
**Qué lo detecta ahora y cuándo:** falla en el *boot* del proceso — antes de que el deploy sirva un
solo byte — no en el browser del visitante. La versión vieja de este bug era invisible para el
sistema: cero excepciones en Sentry (nunca hay un `fetch` server-side que falle), el `<img src>`
se rompe del lado del visitante, y ese HTML con la imagen rota queda **cacheado por ISR** hasta la
próxima invalidación. Un boot roto es ruidoso por diseño; un `<img>` roto en producción no le avisa
a nadie.

**Qué NO cubre:** la regla (b) mira `VERCEL_ENV`. Un deploy fuera de Vercel (otro host, un
contenedor propio) no la dispara — la variable simplemente no está seteada ahí, y esa validación no
corre. El día que exista otro host de producción, esta regla queda dormida y hay que repetir el
mecanismo con lo que ese host sí exponga.

#### 3. El multiplicador de la deduplicación: **no existe. Es 1,00×.**

La key pública es content-addressed (`v1/{ab}/{sha256_32}.webp`), así que dos tenants que suben la
misma foto comparten el objeto. Suena a palanca de costo. **Con los números medidos, no lo es**, y
por tres motivos independientes:

1. **El master no dedupea nunca, por construcción.** Su key es `originals/{tenantId}/{listingId}/
   {hash}.webp` — jerárquica, con el tenant adentro. Dos tenants con la foto idéntica guardan dos
   masters. Y el master es **313.958 de 500.938 B = 62,7% de los bytes**. O sea que la dedup no
   puede tocar más del **37,3%** del storage, ni en el caso perfecto.
2. **Requiere que coincida el byte de *salida*, no la escena.** Dos resellers fotografiando el
   mismo iPhone 14 Pro sobre su propio escritorio producen píxeles distintos → hashes distintos.
   Sólo colisionan archivos literalmente iguales: la foto de prensa del fabricante, la imagen que
   circuló por el broadcast del mayorista, o el mismo dueño re-subiendo el mismo archivo.
3. **No ahorra ni una operación de escritura.** `upload.ts` hace `driver.put` de las 4 keys
   **siempre**, sin `head()` previo. Re-subir una foto que ya existe cuesta los mismos 4 Class A.

La aritmética del mejor escenario que me animo a defender (20% de fotos duplicadas en la flota —
generoso, asume catálogo de mayorista compartido):
```
ahorro = 0,20 × 0,373 × USD 0.0018/tenant/mes = USD 0.00013/tenant/mes
```
**Trece cienmilésimas de dólar.** Es cien veces menos que el redondeo de la factura de R2. Cambiar
el `put` por `head`+`put` condicional convertiría 1 Class A (USD 4.50/1M) en 1 Class B
(USD 0.36/1M): ahorra **USD 0.0000041 por foto duplicada** y agrega un round-trip a R2 en el hot
path del upload. **No se hace.**

**Entonces la dedup no se escribe en el modelo como ahorro, porque no lo es.** Es una palanca de
**corrección**, y ahí sí paga: retry idempotente (re-subir no duplica), **cero purga de CDN jamás**
(cambia el byte → cambia la URL) y **cero `tenant_id` en la URL pública**. Venderla como ahorro
sería mentir por 0,0001 dólares.

**Corolario que sí cuesta plata, en la otra dirección:** como la key es compartida, `CLAUDE.md` §2
prohíbe borrar el objeto al borrar un listing, y `unlinkListingPhotos` devuelve `deletedObjects: 0`
por tipo. El recolector existe (`collectOrphanObjects`, testeado) pero **hoy no tiene ni un caller
en todo el repo** — no hay cron. Consecuencia: el storage crece monótono.
```
tenant con rotación anual completa: 240 fotos/año × 500.938 B = +0,120 GB/año de bytes huérfanos
al cabo de 1 año:  0,120 GB huérfanos × USD 0.015/GB-mes = +USD 0.0018/tenant/MES
al cabo de 3 años: 0,360 GB huérfanos + 0,120 GB vivos   =  4× el storage del stock vivo
```
**No es una emergencia de plata** (a tres años el renglón sigue siendo USD 0.007/tenant/mes). Es que la métrica «GB por tenant» de §5 se vuelve ilegible: deja de medir stock y
pasa a medir historia. El cron de GC es higiene de métrica, no de factura, y se agenda como tal.

#### 4. El upload cuesta CPU de Vercel, y es el renglón más grande de S2

**Medido hoy:** `sharp` tarda **677 ms** en decodificar el JPEG de 12 MP y producir los 4 encodes
(promedio de 3 corridas: 687 / 664 / 680 ms, Apple Silicon). Es el único costo que S2 agrega fuera
de R2, y es **el 70% del delta de la slice**.

```
factor de conversión a vCPU de Vercel: ×2  [EST, conservador]  → 1,35 s de Active CPU por foto

régimen (72 fotos/mes):   72 × 1,35 s =  97 s = 0,0270 CPU-h × USD 0.128/CPU-h = USD 0.0035/mes
memoria provisionada:     0,0270 h × 2 GB = 0,054 GB-h × USD 0.0106/GB-h       = USD 0.0006/mes
invocaciones:             72 × USD 0.60/1M                                     = USD 0.00004/mes
transferencia función→R2: 72 × 500.938 B = 36 MB, techo USD 0.15/GB            = USD 0.0054/mes
                                                                               ──────────────────
                                                                                 USD 0.0095/mes
mes de onboarding (240 fotos): 324 s = 0,090 CPU-h                             = USD 0.0115 extra
```
Los tres precios de fluid compute (Active CPU, memoria provisionada, invocaciones) están
`[UNVERIFIED]`: **no aparecen en ninguna research del repo** — `docs/research/wildcard-isr.md` trae
la tabla de ISR / Edge Requests / Transfer pero no las tres líneas de compute. Ver §7.

**Lo que esto resuelve para el ADR de S2.1** (`vercel-request-body-limit.md` §COST le pide
explícitamente a `cost-auditor` que lo cuantifique antes de decidir):

| camino | CPU de la función por sesión de onboarding (15 equipos × 3 fotos = 45 uploads) | USD |
|---|---:|---:|
| **hoy**: Server Action → `sharp` → R2 | 45 × 1,35 s = 61 s | **0.0022** |
| S2.1: presigned PUT, la función sólo firma | 45 × ~2 ms = 0,09 s | **0.000003** |

**El argumento económico de la subida directa a R2 es nulo: ahorra dos milésimas de dólar por
onboarding.** Si S2.1 se hace, que se haga por UX o por el techo de 4 MB, **nunca citando costo**.
Y la advertencia que va con el número: con presigned PUT el resize deja de ser server-side, y
«original de 12 MP entrando a R2» es un **fallo automático** de §6. Un S2.1 mal hecho cuesta tres
órdenes de magnitud más que todo lo que ahorra.

#### 5. El gate de coalescing que S1 le dejó a S2: cumplido en el eje que importa

S1 exigía: *«Cargar 15 equipos tiene que costar 1 regeneración, no 15»*. Lo que S2 implementó,
leído del código:

| paso | invalida | por qué |
|---|---|---|
| `create-listing.ts` | **0** | nace en `draft`; el borrador no existe para el visitante |
| `add-photo.ts` (fotos 2 y 3) | **0** | `if (isPublicStatus(unit.status))` — un `draft` no lo es |
| `publish-listing.ts` / `transitionUnit` | **1 por unidad** | la arista `draft → available` sí cambia la vidriera |

**El eje que S2 introducía —las fotos— coalesce a cero por construcción**, y era el peligroso: sin
esa guarda, 4 fotos por unidad habrían multiplicado las invalidaciones por 4. Lo que queda es 1 por
unidad publicada, que es comportamiento de S1, no de S2.

**La letra del gate no se cumple (son 15, no 1). El costo que el gate protegía, sí:**
```
techo absoluto de una tanda de 15 altas: 15 × 8 write units × USD 4.00/1M = USD 0.00048
```
y las invalidaciones **sólo se pagan cuando cae un visitante entre dos de ellas**: los renders
fríos están acotados por `min(invalidaciones, pageviews de la ventana)`, y 3.000 pageviews/mes son
~4 por hora. Una tarde de carga cuesta 2–4 regeneraciones reales, no 15.

En régimen, con la mitigación de S2 puesta, el vector que el objetivo protege queda así:
```
invalidaciones/mes = publicaciones + ventas + despublicaciones ≈ 18 + 18 + 4 = 40   [EST]
40 / 3.000 pageviews = 1,3 %          (alarma: 5 %; la proyección de S1 era 6,7 %)
```
**No se implementa coalescing por sesión.** Costaría estado compartido entre Server Actions para
ahorrar medio milésimo de dólar y bajar 1,3% a 0,9%. Sería costo tonto en la dirección contraria.

#### 6. Lo que S2 **no** midió, y con qué comando se mediría

Un costo no medido escrito como si estuviera medido es peor que un hueco declarado. Estos son
huecos, no estimaciones prolijas:

| qué falta | por qué no se midió | comando / fuente que lo cierra |
|---|---|---|
| **bytes del `master`** en el gate del LEAD | el probe verifica bucket y key, no tamaño | agregar `master` al `console.log('MEDIDO …')` de `scripts/probes/s2-media-measure.test.ts` (el objeto ya está en memoria) |
| **Class B real** contra R2 | no hay bucket: **B1** | panel de R2 → *Metrics* → Class B/día por bucket, o Cloudflare GraphQL Analytics API `r2OperationsAdaptiveGroups` filtrado por `istock-media` |
| **bytes por pageview de vidriera con fotos** | la grilla y la ficha son **S3** | tras S3: `curl -s https://{slug}.maat.work/ \| grep -o 'img\.maat\.work/[^"]*' \| sort -u`, y sumar los `content-length` de cada uno |
| **Active CPU real en Vercel** | los 677 ms son de una Mac, no de un vCPU de Vercel | Observability → *Active CPU* de la función de `/app/stock/nuevo` tras el primer deploy; o `console.time` alrededor de `buildVariants` con el número en el log estructurado |
| **precio de Active CPU / memoria provisionada / invocaciones (Pro)** | no está en ninguna research del repo | `vercel.com/docs/pricing` — una lectura, 1 minuto, igual que B2 |
| **si Vercel cobra la transferencia función→R2, y bajo qué línea** | no verificado si es Fast Data Transfer, Fast Origin Transfer o nada | factura del primer mes con uso real; hasta entonces el renglón va a su techo (USD 0.15/GB) |
| **cuántos GB de huérfanos hay de verdad** | no hay GC ni bucket | `wrangler r2 object list istock-media` menos las keys referenciadas en `listing_photos` (service role, cruzando tenants) |

#### 7. Un hallazgo que no cuesta plata hoy pero rompe la medición de S3

`cardSrcSet()` (`packages/media/src/url.ts`) emite `card 800w, detail 1600w` y **hoy no tiene ni un
caller** — la grilla de la vidriera es S3. Cuando lo tenga: sin atributo `sizes`, el browser asume
`100vw`, y un teléfono de 390 px con DPR 3 pide 1170w → **elige `detail` (128.570 B) y nunca `card`
(50.692 B)**. Con egress $0 eso **no cuesta un centavo** y por eso no es un FAIL de costo. Pero:

- el criterio de aceptación del board dice *«`card` ≤150KB medido»*, y **`card` sería el byte que
  nadie descarga**: el gate estaría midiendo la variante equivocada;
- `card` pasa a ser **10% del storage y 1 de cada 4 Class A ops** comprando nada
  (240 fotos × 50.692 B = 12,2 MB/tenant, 72 ops/mes) — no es plata, es peso muerto declarado;
- el que paga es el visitante en Cipolletti con datos móviles: 128 KB en vez de 50 por foto.

**Gate para S3, de `cost-auditor`:** o la grilla lleva `sizes` acorde al ancho real de la tarjeta,
o el criterio de aceptación se corrige para medir `detail`. Las dos cosas están bien; medir una y
servir la otra, no.

#### 8. Veredicto de S2

```
COST_VERDICT: PASS
DELTA_POR_TENANT_MES: USD 0.013   (régimen)   ·   USD 0.030 en el mes de onboarding

  R2 storage        120,2 MB medidos × USD 0.015/GB                 = 0.0018
  R2 Class A        288 PutObject/mes × USD 4.50/1M                 = 0.0013
  R2 Class B        ~4.320 GET de origen/mes × USD 0.36/1M          = 0.0016  [EST]
  R2 egress         por Cloudflare, verificado en el código          = 0.0000
  Active CPU        97 s/mes × USD 0.128/CPU-h                      = 0.0035  [precio UNVERIFIED]
  memoria + invoc.  0,054 GB-h + 72 invocaciones                    = 0.0006  [EST]
  función → R2      36 MB/mes al techo de USD 0.15/GB               = 0.0054  [EST, techo]
                                                                    ─────────
                                                                      0.0142
  menos el renglón viejo de R2 que este reemplaza (−0.001)            0.0132

marginal Base    = 0.073 + 0.013 = USD 0.086   →  17% del objetivo de 0.50
marginal Negocio = 0.30  + 0.013 = USD 0.313   →  63% del objetivo de 0.50 (headroom 1,6×)
```

**SUPUESTOS:** 3.000 pageviews/mes/tenant `[EST]` · 60 listings × 4 fotos (piso del producto: 3) ·
rotación mensual del stock 30% `[EST]` · 6 PoPs de Cloudflare con tráfico `[EST]` · plan Negocio
con el soft cap de 40 msgs/día · región `iad1` · factor ×2 de la CPU de la Mac al vCPU de Vercel.

**VECTOR_MAS_RIESGOSO:** el **Active CPU del upload por Server Action**. No porque sea caro hoy
—USD 0.0035— sino porque es el único renglón de S2 que escala con la actividad del dueño en vez
de con el stock, porque su **precio unitario no está verificado en ningún artefacto del repo**, y
porque una regresión en `sharp` (un `effort` subido, un `qualityLadder` que ahora hace 5 intentos
en vez de 1) lo multiplica sin tocar un solo byte de los que el gate mide. Los cuatro objetos de
hoy salen en **1 intento cada uno**: ese `intentos: 1` es la medición que protege este renglón.

**METRICA_A_VIGILAR:** **`ms de CPU de `buildVariants` por foto subida`**, con alarma en **> 1.500 ms**
(2,2× la medición de hoy). Es la única que avisa antes: los bytes de salida pueden quedar idénticos
mientras el costo se duplica, así que ningún techo de bytes la detecta. La de R2 —`Class A del mes
/ fotos del mes > 5`— sigue vigente, pero R2 tiene dos órdenes de magnitud de aire y no es por ahí
que esto se rompe.

### La decisión de una línea que rompe el objetivo entera
| `cacheLife` | ISR Writes/tenant/mes | contra el objetivo |
|---|---|---|
| `'max'` + invalidación por evento | **USD 0.012** | 2.4% |
| `revalidate: 60` | **USD 2.59** | **518% — reventado** |

Esto aplica al **polo positivo** y sólo a él. El polo negativo usa un perfil corto **a propósito**
(ADR-012) y su costo no se mide por tenant: ver «El precio del polo negativo» arriba.

`cacheLife` **es una decisión de costo, no de UX** (R1). Un `revalidate: 60` puesto sin pensar
multiplica el costo por 216× y por sí solo tira el objetivo. Gate de `cost-auditor`.

## 3. Techo de LLM a 50 tenants `negocio`
```
50 tenants × 40 msgs/día × 30 días = 60.000 msgs/mes
60.000 × 1.200 tokens in  =  72,0M tokens in
60.000 ×   180 tokens out =  10,8M tokens out
```
**USD 8.64 – 11.52/mes** con `gemini-2.5-flash-lite` (R3). Es **decenas de USD, no cientos**: el
techo de FASE 0 se cumple.

Por tenant Negocio (USD 35 de precio de lista): **0.5–0.7% del ingreso** al soft cap lleno.

**Alerta de presupuesto:** si hay que migrar a `gemini-3.5-flash-lite`, el mismo tráfico cuesta
**USD 48.60/mes (4.2×)** y el chatbot deja de ser ruido en el P&L. Por eso el fallback definido es
Groq `openai/gpt-oss-20b`, **no** el Lite siguiente de Google (R3, ADR-004).

**El riesgo no es el precio unitario.** Es (a) que la dieta de 1200/180 se desborde con reasoning
tokens **no medidos**, y (b) abuso sin rate limit. Se cubren con **instrumentación de tokens reales
por turno** (campos de `usage`, incluidos `cached`/`thought` — no confiar en la estimación) y cap
por tenant en DB. R7 lo llama *el mayor riesgo de costo del producto*: sin el cap de 180 tokens out
**enforced server-side**, una inyección de prompt hace el gasto por pageview ilimitado.

## 4. Escenario de estrés — la vidriera se hace viral un día
50.000 pageviews en 24 h en un tenant:

| vector | efecto |
|---|---|
| Postgres | ~0 **si** el ISR está bien |
| R2 egress | **0** por diseño |
| R2 Class B | **techo: 720 objetos × PoPs, no 15 por pageview.** El renglón viejo («~750k reads») modelaba mal: un objeto se lee de origen una vez por PoP, no una vez por visita. Aunque el pico traiga tráfico de los 300+ PoPs, son **216.000 reads = USD 0.078**, y no vuelve a pagarse al día siguiente |
| Edge Requests + WAF | ~400k requests → **~USD 1.00 en el día**, el vector real |
| Vercel functions | sólo en misses |
| LLM | acotado por el soft cap de 40 msgs/tenant/día |

**Lo que se rompe primero:** la tasa de hits que llega a Postgres, si una mutación tira el cache en
pleno pico. Por eso el `revalidateTag` es quirúrgico por tenant y nunca un `revalidatePath('/')`.

**Modo de falla nuevo (R1):** **cada deploy invalida el ISR cache** — el key incluye el build ID.
Con 100 tenants y deploys diarios, el pico de writes es proporcional a `tenants × páginas` y deja de
ser gratis. Deployar en pico de tráfico es un evento de costo.

## 5. La métrica a vigilar (una por vector)
| vector | métrica | alarma |
|---|---|---|
| DB | **% de hits de vidriera que llegan a Postgres** | **> 5%** |
| cache | `x-vercel-cache: HIT` ratio en vidriera | cualquier caída sostenida |
| cache | `set-cookie` en respuesta de `(storefront)` | **cualquiera** — apaga el CDN entero |
| imágenes | ratio Class A / fotos procesadas | **> 5** (anomalía, no capacidad; el valor de diseño es **4**, en el tipo: `classAOps`) |
| **imágenes** | **ms de CPU de `buildVariants` por foto subida** | **> 1.500 ms** (2,2× los 677 ms medidos en S2). **Es la única métrica de S2 que no se deduce de los bytes**: la salida puede pesar exactamente lo mismo mientras el costo se duplica |
| imágenes | bytes de la variante que el browser **elige** (no la que el gate mide) | que `sizes` falte y la grilla baje `detail` (128.570 B) donde el modelo dice `card` (50.692 B) — §2.2.7 |
| imágenes | `MEDIA_DRIVER` y `NEXT_PUBLIC_MEDIA_BASE_URL` del deploy de producción | **cualquier valor que no sea `r2` / `https://img.maat.work`** — es la única forma de que un byte de foto salga por Vercel (§2.2.2) |
| storage | GB por tenant | huérfanos de listings borrados — hoy **crecen sin techo**: `collectOrphanObjects` existe y **no tiene caller** |
| LLM | **tokens reales/turno por tenant** | > 1200 in o > 180 out, o modelo frontier en el log |
| proxy | CPU-ms del proxy por pageview | **> 2 ms**, o cualquier llamada de red |
| edge | Edge Requests/mes | acercarse a 10M (≈ 80 tenants) |
| **miss** | **ISR writes sobre slugs que no son de ningún tenant** | **cualquier ritmo sostenido** — es el único vector que no aparece en el costo de ningún tenant, y el perfil corto lo hace 12× más caro por hora que el viejo `'max'` (a cambio de que no quede nada pegado) |

## 6. Fallos automáticos (bloquean merge)
Fotos por Supabase Storage público o Vercel Image Optimization · original >500KB al browser ·
**master en bucket R2 público** · **URL pública con `tenant_id`/`listing_id`** · LLM por pageview o
modelo frontier en hot path · Realtime para anónimos · vidriera pegándole a Postgres en cada hit ·
worker 24/7 en vez de cron · **spend cap de Supabase apagado** · **`revalidate` por tiempo corto en
la vidriera** · **rate limiting con contador en Postgres sobre la vidriera** · `set-cookie`
server-side en la vidriera · **deploy de producción con `MEDIA_DRIVER != 'r2'` o con
`NEXT_PUBLIC_MEDIA_BASE_URL` apuntando a `/_media`** (agregado en S2: es la única forma de que un
byte de foto salga por Vercel; cerrado en el código desde S2 — el `superRefine` de
`packages/media/src/env.ts` hace fallar el boot antes de que esto llegue a producción, salvo que el
deploy no sea Vercel, § 2.2.2) ·
**`head()` antes del `put` "para aprovechar la dedup"** (ahorra USD 0.0000041 por foto y agrega un
round-trip a R2 en el upload — §2.2.3: costo tonto en la dirección contraria).

**BotID Deep Analysis (USD 1/1000 llamadas): NO activar preventivamente.** A 10.000 conversaciones/mes
son USD 10/mes — **el 53% del precio de lista de un plan Base**. (Precio, no margen: el margen
unitario del Base no está calculado en ningún artefacto — ver §7.)

## 7. `[UNVERIFIED]` — lo que este documento NO sabe
- **Precio de Supabase Pro.** `supabase.com/pricing` renderiza los precios por JS; el HTML servido no
  los trae (verificado hoy: HTTP 200, 380.979 bytes, sin el monto). **USD 25 es memoria, no fuente.**
  Es la línea más grande del piso fijo. Se confirma en 1 minuto al crear el proyecto → **B2**.
  Sí está verificado, textual, que Supabase trae *"spend cap enabled by default to keep costs under
  control"* — lo que `CLAUDE.md` exige es **no apagarlo**.
- **Comisión de Mercado Pago.** Varía por **tres** cosas: provincia del domicilio, **medio de pago que
  elija el cliente**, y plazo de acreditación. El «piso de USD 1.03/mes» de R4 modela sólo el plazo →
  **no es presupuestable y no se usa como gate.** Experimento 2 de ADR-008, bloqueado en **B3**.
  Repito lo de §0: probablemente sea el costo por tenant más grande del producto.
- **Márgenes unitarios de los planes.** El precio está en `CLAUDE.md` §1; el margen (precio − COGS)
  no está calculado. Toda comparación del tipo *"X es comparable al margen"* es inválida hasta que
  este documento lo publique.
- **Supuestos de tráfico míos, no medidos:** 3.000 pageviews/mes/tenant, ~8 requests/pageview,
  95% de cache hit ratio, tamaños de variante, frecuencia de deploy y de mutación.
  Se miden con la primera vidriera real, no antes. **Casi todas las cifras de §2 dependen de ellos.**
  Bajaron de categoría dos, medidos en S1 (§2.1): el **peso de la página** (14,3 KB de HTML +
  9,3 KB de RSC, sin fotos todavía) y el **hit ratio contra Postgres** (0 queries en 50 hits
  tibios). Lo que sigue sin medirse es **cuántos** hits son tibios en producción.
- **Qué hace un intermediario con el `s-maxage=2592000` del polo positivo.** Medido: ese header
  sale hoy en la respuesta del tenant que existe. En el CDN de Vercel la invalidación es por tag
  y el TTL no manda. **Lo que no está verificado es qué pasa si Cloudflare queda proxyando el
  wildcard y cacheando HTML:** ahí no hay hook de purga y `s-maxage=2592000` es una promesa de
  30 días — un equipo vendido seguiría publicado. **Gate antes de prender el wildcard**, y se
  verifica con un `curl` después del primer deploy real, no antes.
- **Si Vercel cobra el techo de 8 KB de ISR Write por archivo o por entrada.** Cambia la entrada
  del tenant de 5 a 8 units (60%). No mueve el número de §2, que usa 15 como techo, pero sí
  mueve cualquier cuenta futura que use el valor medido.
- **Precio de fluid compute de Vercel Pro: Active CPU (USD/CPU-h), memoria provisionada
  (USD/GB-h) e invocaciones (USD/1M).** Los tres se usan en §2.2.4 y **ninguno sale de una research
  del repo**: `docs/research/wildcard-isr.md` tiene ISR, Edge Requests y Transfer, pero no compute.
  Los valores escritos (0.128 / 0.0106 / 0.60) son **memoria, no fuente** — el mismo defecto que el
  precio de Supabase, y se cierra igual de rápido: una lectura de `vercel.com/docs/pricing`.
  Sostienen el renglón más grande de S2.
- **Si Vercel factura la transferencia de la función a R2, y bajo qué línea** (Fast Data Transfer,
  Fast Origin Transfer, o nada). El renglón de §2.2.4 va a su **techo** (USD 0.15/GB = 0.0054) hasta
  que haya una factura real. Si no se cobra, el delta de S2 baja de 0.013 a 0.008.
- **Bytes del `master`.** Los 306,6 KB salen de `pnpm --filter @istock/media bench`, o sea del
  **owner del paquete**, no del gate del LEAD — que verifica el bucket y la key del master pero no
  su tamaño. Es el **62,7% de los bytes almacenados** de S2 medido por una sola punta.
- **Class B contra R2 real.** El 6 de «6 PoPs» es mío. El rango entre el caso regional (USD 0.0016)
  y el global (USD 0.078) es de **48×**, y sólo se cierra con métricas del bucket → **B1**.
- **Región de funciones.** `iad1` es 1.6× más barato que `gru1` en ISR y ~7× en Fast Origin Transfer
  (USD 0.06 vs 0.41/GB), pero está más lejos si Supabase queda en `sa-east-1`. Falta la medición de
  latencia real contra el Alto Valle → **ADR-010 abierta**. Todos los números de §2 asumen `iad1`.

## 8. Estado
**FASE 1 cerrada** para los vectores de infra (Vercel, R2, LLM, WAF).
**S1 auditada (2026-08-27): PASS, delta USD 0.00/tenant/mes** — ver §2.1. Aporta las primeras
mediciones reales de la vidriera y el gate anticipado de coalescing para S2.
**Re-auditada tras ADR-011 + ADR-012 (2026-08-27): PASS, delta USD 0.00/tenant/mes.** El miss
pasó de `404`/`s-maxage=2592000` a `200`/`s-maxage=300`: el perfil corto está en el header y no
sólo en el código. Lo que se movió fue el tamaño medido de la entrada de ISR (24,5 → 33,7 KB,
por un archivo que la primera pasada no contó) y apareció un vector de plataforma nuevo —el
costo de writes de un escaneo de subdominios— que **no** es marginal por tenant. Ninguno cambia
el número de §2.
**S2 auditada (2026-08-28): PASS, delta USD 0.013/tenant/mes** — ver §2.2. Los bytes de las tres
variantes públicas y los 677 ms de CPU de `sharp` están **medidos**; el master lo midió el owner y
no el gate. Tres correcciones al modelo: (a) el renglón de R2 de §2 estaba bajo **4,7×** por contar
Class A/B como cero, (b) Class B **no** escala con pageviews sino con **objetos × PoPs**, lo que
además abarata el escenario de estrés de §4, y (c) apareció un renglón que R2 no tiene y que es el
**70% del delta**: el Active CPU del upload. **La dedup de keys content-addressed no es una palanca
de costo** (1,00×): el master, que es el 62,7% de los bytes, no dedupea nunca.
El gate de coalescing que S1 le dejó a S2 se cumple **en el eje de las fotos** (un `draft` no
invalida nada), no en la letra: una tanda de 15 altas son 15 invalidaciones, USD 0.00048 y 1,3% de
hits a Postgres contra una alarma de 5%.

**Abierto:** precio de Supabase (B2) · **precio de fluid compute de Vercel (§7)** · comisión de MP
(B3, ADR-008) · región (ADR-010) · **Class B real y bytes del master (B1)** ·
**bytes por pageview de vidriera con fotos (S3)** · todos los supuestos de tráfico, hasta la
primera vidriera real.
