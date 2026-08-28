# COST — modelo de costo de infraestructura

_Owner: `cost-auditor`. **Escrito por el LEAD en FASE 1** (excepción declarada en `CLAUDE.md` §4).
Números con fuente salvo los marcados `[EST]` / `[UNVERIFIED]`, que **no** son evidencia._
_Fecha: 2026-08-28. Insumos: R1 (wildcard/ISR), R2 (R2/imágenes), R3 (LLM), R7 (amenazas),
`docs/research/vercel-firewall-as-code.md` (T1)._
_Re-medido el 2026-08-27 después de **ADR-011** (el slug inexistente dejó de ser 404) y **ADR-012**
(los dos polos del cache). Lo que cambió está en §2.1; lo que **no** cambió también, y dice por qué._

## Objetivo duro
> **Costo marginal de infra < USD 0.50 / mes por tenant activo, hasta 100 tenants.**

El **piso fijo** se cuenta **aparte** del marginal. No mezclar.

## 0. Conclusión, arriba de todo

**Se cumple, y con margen — pero no por donde parecía en FASE 0.**

| | FASE 0 `[EST]` | FASE 1 (con fuente) | FASE 4 (S1 + S2 **medidas**) | T1 (WAF **acotado**) |
|---|---|---|---|---|
| Marginal plan **Base** | ~USD 0.03 | USD 0.07 | USD 0.09 | **USD 0.03** |
| Marginal plan **Negocio** | 0.03 + `[R3]` | USD 0.24 – 0.30 | USD 0.25 – 0.31 | **USD 0.20 – 0.26** |
| Headroom del Negocio contra el objetivo | «~15× abajo» | ~1.7× | ~1.6× | **~1.9 – 2.5×** |

**La columna T1 no baja porque el código se haya puesto más rápido: baja porque una regla de WAF
dejó de apuntar a la vidriera.** El renglón de WAF pasó de USD 0.06 a **USD 0.002 – 0.003**, o sea
17–25× abajo, y con eso el plan Base pierde de golpe **el 67% de su costo marginal** — era su línea
más grande, más grande que todo S2 junto. El detalle y la aritmética están en §2.3. No hay ninguna
medición nueva de tráfico atrás de este número: hay un **alcance** distinto.

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
(`CLAUDE.md` §3) · **requests que matchean una regla de WAF: ≤ 4.200/mes/tenant** `[EST]` (§2.3 —
no confundir con los 120.000: sólo dos rutas están bajo regla, y el HTML de la vidriera no).

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
| **WAF Rate Limiting** — Base | ≤3.000 allowed req/mes × USD 0.80/1M | **0.0024** | **§2.3, T1** |
| **WAF Rate Limiting** — Negocio | ≤4.200 allowed req/mes × USD 0.80/1M | **0.0034** | **§2.3, T1** |
| Postgres | 95% de hits cacheados | ~0 | ADR-007 |
| LLM plan **Base** | **widget ausente** | **0** | `CLAUDE.md` §3 |
| LLM plan **Negocio** | 1.200 msgs × USD 0.000144–0.000192 | **0.17 – 0.23** | R3 |
| **Marginal Base** | | **~USD 0.03** | |
| **Marginal Negocio** | | **USD 0.20 – 0.26** | |

La línea vieja de R2 decía **«~140 MB → ~0.001»** y estaba baja **4,7×**, no por el storage
(120 MB medidos contra 140 supuestos: acertó) sino porque **contaba Class A y Class B como si
fueran cero**. No lo son; son chicos, que es otra cosa. Y aparecieron dos renglones que R2 no
tiene: el upload pasa por una Vercel Function y `sharp` cuesta CPU. Detalle en §2.2.

**La línea que no estaba en FASE 0 y sigue pesando** son los Edge Requests, que **no son gratis
pasados ~80 tenants** porque el proxy corre en el 100% de los pageviews, HIT incluido.

**La otra —el WAF— se desinfló, y conviene entender por qué.** La línea de FASE 1 decía
«120k allowed req/mes × USD 0.50/1M = USD 0.06» y era correcta *para la regla que R7 imaginaba*:
una que condicionara por `host suf .maat.work`, o sea todo el tráfico del tenant. En T1 el LEAD
rechazó esa regla y quedaron dos que apuntan a **dos rutas**, no a un host. Los 120.000 requests
del supuesto de tráfico siguen existiendo; lo que cambió es que **ninguno de ellos matchea una
regla**, y lo que se factura son los que matchean. Es la misma corrección de forma que la de
Class B en §2.2: el renglón no escalaba con lo que decía escalar.

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
purgable** por uno **transitorio y acotable**.

> ⚠️ **Corregido en T1 (2026-08-28): esta línea decía «lo acota el WAF rate limiting que ya está
> presupuestado en §2», y desde T1 eso es falso.** Las dos reglas que existen apuntan a `/api/track`
> y `/api/chat`; **el camino de render de la vidriera no tiene ninguna regla**, a propósito
> (§2.3: una regla ahí cuesta USD 0.096/tenant/mes *siempre*, y cuadruplica el marginal del plan
> Base para defender HTML que declaramos scrapeable). **El techo de este vector es Attack Challenge
> Mode**, que es gratis, inmediato y no requiere `publish` — pero es **reactivo y manual**: lo
> prende un humano después de ver la alarma de §5 («ISR writes sobre slugs que no son de ningún
> tenant»). Lo que queda descubierto es la ventana entre que el escaneo arranca y que alguien mira.
> **Una hora de escaneo sostenido sin que nadie lo note son USD 2.88** — el presupuesto de WAF de
> los 100 tenants durante **8,5 meses** (100 × 0.0034 = USD 0.34/mes). No es un agujero de tamaño
> peligroso, pero es el único vector del documento cuya mitigación depende de que alguien esté
> despierto, y por eso la métrica de §5 es la que es.

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

> ⚠️ **Las dos últimas líneas de este bloque son el registro de S2 y quedaron viejas al día
> siguiente.** El 0.073 que arrastran incluye USD 0.06 de WAF calculados sobre una regla que T1
> rechazó. Los totales vigentes son **0.03 (Base)** y **0.20 – 0.26 (Negocio)**: §2.3. Lo que S2
> midió —bytes, CPU, Class A/B— no cambió ni un dígito.

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

### 2.3 Auditado en T1 — Firewall Rate Limit Requests (2026-08-28)

Insumos: `config/firewall-rules.json`, `scripts/guard-firewall.sh` (commit `4fce968`) y
`docs/research/vercel-firewall-as-code.md` (fuentes consultadas 2026-08-28).
**Esto es una auditoría de configuración, no una medición:** no hay proyecto en Vercel, no hay
factura y no hay un solo allowed request contado de verdad. Todos los volúmenes de acá son `[EST]`.

#### El precio, y lo que no sabemos de él

| ítem | valor | estado |
|---|---|---|
| Precio por allowed request — `iad1` | USD **0.50** / 1M | verificado (pricing regional `iad1`) |
| Precio por allowed request — `gru1` | USD **0.80** / 1M | verificado (pricing regional `gru1`) |
| Requests incluidos en **Pro** | **0** | verificado — se factura desde el request 1 que matchee |
| Requests incluidos en Hobby | 1.000.000 | verificado (dato inútil: Hobby está prohibido, `CLAUDE.md` §3) |
| Tráfico **mitigado** (deny / challenge / 429) | **no genera** Edge Requests ni Fast Data Transfer | verificado, textual |
| A qué tarifa se factura el tráfico **argentino** | **no sabemos** | **`[UNVERIFIED]`** |

**El renglón se escribe con `gru1` (USD 0.80) por conservador, y eso es una elección, no un dato.**
La doc dice que el precio *"is based on the region(s) from which the requests come from"*, pero
`researcher` **no encontró la tabla que mapea país → región de facturación**, y la sección
«Rate limiting pricing» de `usage-and-pricing` viene **vacía** en la versión markdown de la doc.
El rango real es **USD 0.50 – 0.80 / 1M** y todo lo de abajo se mueve ±37% dentro de él.

Ojo con un cruce fácil: §7 dice «todos los números de §2 asumen `iad1`» refiriéndose a la **región
de la función**. Acá no aplica — el WAF corre en el PoP del visitante, así que la región que manda
es **de dónde viene el request**, no dónde deployamos la función. Son dos ejes distintos y la
elección de `iad1` para funciones **no** compra la tarifa de `iad1` para el WAF.

#### Cuántos requests matchean, por tenant

Sólo dos rutas están bajo regla: `/api/track` (el beacon del click de `wa.me`, **aterrizó en S4**,
`c9611b1`, 2026-08-28) y `/api/chat` (FASE 5). `storefront-track-rl` pasó de `planned` a **`active`**
con `landed_in: "S4"`; `chatbot-rl` sigue `planned`. **El gasto real de esta línea sigue siendo
USD 0.00, y desde S4 por un motivo distinto:** ya no es que el endpoint no exista —existe y tiene
techo declarado—, es que **ninguna regla está publicada** en Vercel, porque no hay proyecto (B2/B5)
y `publish` es un paso operativo que `vercel deploy` no hace. `active` significa *"el repo declara
que esta regla debe estar publicada"*, **no** *"lo está"*. El resto de la app —el HTML de la
vidriera, `/_media`, `/api/health`, `/api/tenants/slug-check`— no matchea nada.

| escenario | allowed req/tenant/mes | @ USD 0.50/1M | @ USD 0.80/1M |
|---|---|---|---|
| Base — beacon en el click `[MEDIDO]`, volumen ~5% de 3.000 pv `[EST]` | 150 | 0.000075 | 0.00012 |
| **Base — reserva presupuestada** (1 beacon/pageview = 20× el volumen estimado) | 3.000 | 0.0015 | **0.0024** |
| Negocio — beacon por click + chat al soft cap (1.200 msgs) | 1.350 | 0.00068 | 0.0011 |
| **Negocio — reserva presupuestada** (beacon a 20× + chat al cap) | 4.200 | 0.0021 | **0.0034** |

El rótulo de dos filas cambió a propósito: lo que antes se llamaba *peor caso* ahora se llama
**reserva**. El peor caso que justificaba ese renglón —que el beacon disparara en el `view`— está
**medido y descartado** (abajo). Lo que la reserva cubre hoy es otra cosa.

**El renglón se reserva alto: USD 0.0024 (Base) y USD 0.0034 (Negocio).** Contra el objetivo de
0.50 es **0,5% y 0,7%**. Contra el marginal Base entero (0.03) es el 8,5%.

> #### El supuesto sobrevivió a su propia medición, y esto es por qué
>
> **S4 midió el trigger, no el volumen, y el número reservado no se mueve.** Decirlo explícito
> importa: un supuesto que sigue en pie después de que lo midieron **parece verificado y no lo
> está**, y esa confusión es más cara que no haber medido.
>
> **Lo que quedó medido `[MEDIDO en S4, 2026-08-28]`:**
> `MEDIDO s4 click · filas_al_cargar=0 · filas_antes=0 · filas_despues=1 · tenant_ok=si`.
> Cargar la ficha **no escribe ninguna fila**; el click escribe exactamente una. La pregunta
> *click vs. view* está cerrada **midiéndola**, y con eso este renglón **no** es proporcional a
> pageviews.
>
> **Lo que sigue `[EST]` es cuántos clicks hay.** El 5% de conversión es mío y de nadie más: no
> existe todavía una vidriera con tráfico real de la que sacarlo. Dos razones para **no** bajar el
> renglón de 0.0024 a 0.00012:
>
> 1. **El código no acota el ratio a 1 beacon por pageview.** La guarda `window.__waBeacon` impide
>    instalar **dos listeners**, no impide **dos clicks**: el visitante que abre WhatsApp, vuelve
>    con el botón de atrás y aprieta de nuevo manda **dos** beacons en **un** pageview. *«≤ 1 por
>    pageview»* es un supuesto sobre conducta humana, no un invariante del código. Verificado
>    leyendo `apps/web/app/(storefront)/_components/wa-beacon.tsx`.
> 2. **Bajarlo no cambiaría ninguna decisión.** La diferencia entre reserva y escenario medido es
>    **USD 0.0023/tenant/mes = 0,46% del objetivo**: más chica que el error de la tarifa que la
>    multiplica (±37%, `[UNVERIFIED]` cuál aplica a AR) y dos órdenes de magnitud menor que el rango
>    abierto de Class B (48×, B1). Afinar acá sería precisión falsa sobre un renglón cuyo
>    denominador —3.000 pv/mes— tampoco está medido.
>
> **O sea: el número no se movió, pero cambió de qué se defiende.** Antes cubría *«el beacon podría
> dispararse en el view»*, una pregunta abierta de **diseño**, cerrada por medición. Ahora cubre
> *«los clicks podrían ser 20× mi estimación»*, una pregunta abierta de **tráfico**, que se cierra
> con la primera vidriera real y no con otra slice.

#### El número de 100k requests: la aritmética está bien, la atribución no

`100.000 × USD 0.80 / 1.000.000 = USD 0.08/mes`. ✅ Y `0.08 / 0.50 = 16%`, `0.008 / 0.50 = 1.6%`. ✅
Las tres cuentas cierran.

**Lo que no cierra es el escenario.** Con los supuestos de tráfico de §2, un tenant genera ≤4.200
requests que matcheen; para llegar a 100.000 hacen falta **~24 tenants** (100.000 / 4.200 = 23,8).
O sea que el mundo donde la plataforma factura 100k allowed requests es un mundo con 24 tenants, y
ahí el reparto es **USD 0.0033/tenant = 0,67% del budget**, no 16%. La frase «con 1 tenant es el 16%
de su budget» sólo es cierta si ese único tenant produce 24× el tráfico modelado **o** si una regla
volvió a apuntar al HTML — que es exactamente el fallo que T1 evita. Sirve como **techo de
plataforma**, no como línea marginal, y por eso el renglón de §2 dice 0.0024 / 0.0034 y no 0.08.

Traducido a la unidad del objetivo: **la línea completa de WAF, sumada sobre 100 tenants, es
USD 0.24 – 0.34/mes para toda la plataforma.** Es menos que un café. El riesgo nunca fue el precio.

#### Por qué bajo abuso la regla es neta negativa — con el umbral, no con un adjetivo

La afirmación *"WAF deny, challenge, or rate-limit mitigated traffic does not incur CDN Requests or
Fast Data Transfer"* es verificada y contraintuitiva, pero **no es incondicional**: se factura lo
que pasa, no lo que se bloquea, así que la regla ahorra sólo si bloquea una fracción suficiente.

Sea `d` la fracción de requests que la regla **deniega**, `W` el precio del allowed request y `E+F`
lo que ese request habría costado igual (Edge Request + invocación de función + lo que dispare).
La regla ahorra plata cuando `d > W / (E + F + W)`.

| ruta | lo que cuesta un request **permitido**, por 1M | umbral `d*` de rentabilidad |
|---|---|---|
| `/api/track` | Edge 2.00 `[iad1]` + invocación 0.60 `[UNVERIFIED]` + WAF 0.80 | **~23%** (17% si el Edge Request se factura a tarifa `gru1`, 3.20) |
| `/api/chat` | Edge 2.00 + invocación 0.60 + **turno de LLM 144 – 192** (R3) + WAF 0.80 | **~0,5%** |

**Los dos números dicen cosas distintas y las dos importan.**
La regla del chat se paga sola si deniega **más del 0,5%** de lo que ve: un turno de LLM cuesta
**180–240× el peaje del WAF**, así que basta con que corte un puñado de mensajes al mes.
La regla de `/api/track` necesita denegar **~1 de cada 4** para pagarse en dinero — y aun así se
justifica, porque **su motivo no es el dinero sino la disponibilidad**: con el spend cap de Supabase
en ON, floodear el único endpoint de escritura anónima no infla una factura, **apaga el proyecto
para los 100 tenants**. Es una regla de blast radius que además, en cualquier flood serio, termina
siendo gratis.

**En régimen normal (`d ≈ 0`) la regla es un recargo del +40% sobre lo que esos requests ya cuestan
en Edge Requests** (0.80 / 2.00; +25% si el Edge Request es de `gru1`). Esa es la frase que explica
todo el resto de esta sección: **poner una regla sobre un stream de requests cuesta un 40% más de lo
que ese stream ya costaba.** Sobre 4.200 requests no se nota. Sobre 120.000 sí.

#### El scoping: qué habría costado la regla que el LEAD rechazó

La regla que proponía el research (`condition: {type: host, op: suf, value: ".maat.work"}`, sin
acotar path) matchea **todo el tráfico del tenant**: los ~120.000 requests/mes de §2, pageviews
cacheados incluidos.

```
120.000 req/tenant/mes × USD 0.80 / 1M = USD 0.096 / tenant / mes
```

| | marginal Base | contra el objetivo de 0.50 |
|---|---|---|
| con las reglas de T1 | **USD 0.03** | 6% |
| con la regla `host suf .maat.work` | **USD 0.124** | 25% |

**Rechazarla no evitó un riesgo hipotético: le sacó al plan Base el 77% de su costo marginal.**
Habría sido, sola, más cara que R2, `sharp`, los ISR Writes y el storage **sumados** — y todo para
proteger HTML que `ARCHITECTURE.md` declara scrapeable a propósito y que el CDN ya sirve sin tocar
la función. Es el caso de libro de *costo tonto*: pagar por proteger lo que decidimos no proteger.

#### Los tres caminos por los que igual podríamos terminar facturando pageviews

Auditado contra el archivo y contra el gate, no supuesto. **Ninguno está abierto hoy**; los tres son
el mismo tipo de deriva y merecen quedar escritos.

1. **El beacon, si disparara en el `view` en vez de en el click. → CERRADO POR MEDICIÓN EN S4
   (2026-08-28). No se materializó.** Era el camino más probable y el único que no dependía de que
   alguien se equivocara: si `/api/track` se llamara en el load de la ficha, **allowed requests ≈
   pageviews** y la línea de WAF volvería a ser proporcional al tráfico. No habría sido fatal
   —3.000 pv/mes son USD 0.0024, 1/40 de lo que costaba la regla de `host`, porque un pageview son
   ~8 requests y el beacon es 1— pero convertía un renglón fijo en uno que crece con la viralidad.
   **El gate que T1 le dejó a la slice se cumplió, y se cumplió midiendo, no declarando:**
   `MEDIDO s4 click · filas_al_cargar=0 · filas_antes=0 · filas_despues=1`. Las dos mitades
   importan: el cero **no** es «llegué temprano» (el e2e de `qa-agent` espera por condición con un
   presupuesto de 4 s que se consume entero antes de declararlo, justamente para darle al
   hipotético beacon-en-el-view todas sus chances), y el uno prueba que el evento igual se
   registra. En el código no hay camino de view que cerrar: el beacon es un listener delegado de
   `click` sobre `a[data-wa="listing"]`. **Lo que queda vivo de este ítem no es el trigger sino el
   volumen de clicks**, y por eso la reserva de arriba se mantiene.
2. **`op: "pre"` es un prefijo, no una igualdad.** `/api/track` matchea también `/api/tracking`,
   `/api/track-v2` y cualquier ruta futura que empiece igual. Hoy no existe ninguna, y el censo F3
   del guard usa la misma lógica de prefijo, así que una ruta nueva bajo ese prefijo **hereda la
   regla y el medidor en silencio** — pasa el gate porque la da por cubierta. Es el único punto
   donde el censo puede dar verde a algo que nadie decidió.
3. **El `route` del archivo es metadata del repo; la `condition` es lo que Vercel publica.** El
   chequeo F2 del guard bloquea `type: "host"` **sólo si la regla no declara `route`**
   (`if (c.type === 'host' && !r.route)`). Una regla con `condition: {type:"host", suf:".maat.work"}`
   **y** `route: "/api/track"` pasa el gate y factura cada pageview. Lo mismo con
   `{type:"path", op:"pre", value:"/s"}` — el path al que ADR-007 reescribe la vidriera — que no
   está en la lista `CATCHALL` de F2 y matchearía el 100% de los renders. Y como el gate de nivel 2
   (`vercel firewall diff` contra la config viva) **no está implementado**, entre el repo y la
   factura no hay ninguna verificación: lo único que sostiene el número de esta sección es que
   nadie publique una condición distinta de la del archivo. **No es un fallo de T1 —el gate de
   nivel 1 es lo que se prometió— pero es dónde está el riesgo residual, y es de configuración, no
   de código.**

#### 🚩 Managed Rulesets / OWASP CRS — NO prender sin ADR

Nota para el `cost-auditor` del futuro, que va a ser yo mismo mirando el dashboard de Vercel.
**Managed Rulesets (OWASP Core Rule Set) es un feature pago distinto del rate limiting**, y está en
la misma pantalla que lo que sí queremos. Prenderlo es un toggle; entenderlo, no.

| | rate limiting (lo que queremos) | Managed Rulesets (lo que **no**) |
|---|---|---|
| unidad | allowed requests (los que **matchean y pasan**) | **inspected requests** (los que el WAF **mira**) |
| precio | USD 0.50 – 0.80 / 1M | **USD 0.80 – 1.28 / 1M** + **USD 0.20 – 0.32 / GB** de payload inspeccionado |
| volumen nuestro | ≤4.200 req/tenant/mes | **~120.000 req/tenant/mes** — todo lo que llega |

```
120.000 req/tenant/mes × USD 1.28 / 1M = USD 0.154 / tenant / mes
marginal Base 0.03 + 0.154 = USD 0.18  →  6,4× el marginal de hoy, 36% del objetivo
100 tenants × 0.154         = USD 15.4 / mes de plataforma
```

**Un toggle multiplica el costo marginal del plan Base por ~6 y se come más de un tercio del
objetivo, sin que ninguna slice cambie ni un byte.** Es el pie en el que este proyecto se puede
disparar sin darse cuenta, porque el daño no aparece en ningún diff.
**Condición para prenderlo: ADR propio, ratificado por el LEAD, con el número de inspected requests
del mes anterior a la vista.** Si algún día hace falta protección contra OWASP, la pregunta previa
es qué ruta la necesita — casi seguro `/app/*`, que es tráfico autenticado y de volumen chico, no la
vidriera. `[UNVERIFIED]`: si «inspected» incluye los hits servidos desde el CDN cache. Si los
incluye, los USD 0.154 son un **piso**, no un techo.

#### Nota de transferencia: los 181.739 B de `/_next/static` de la ficha

Dato que trajo el LEAD midiendo S3 y que no tiene fila propia en ningún artefacto. **No cambia
ninguna cuenta de esta sección** (el WAF cobra por request, no por byte) y **no abre un renglón
nuevo en §2**, pero sí toca dos supuestos y conviene dejarlo anotado:

- **Fast Data Transfer sigue en cero marginal.** Visita **fría**: 181.739 B de chunks + 14.831 B de
  HTML ≈ **196,6 KB**. Visita **tibia**: los chunks son `immutable`, no se vuelven a pedir ni se
  revalidan → ~15–24 KB. Con una mezcla 50/50 el promedio es **~110 KB/pageview**, contra los
  **120 KB `[EST]`** que R1 usó para dimensionar FDT. **El supuesto de R1 sobrevive a la medición**,
  que es el único motivo por el que esto no abre un renglón.
  `3.000 pv × 110 KB = 0,33 GB/tenant/mes` → **100 tenants = 33 GB/mes contra 1 TB incluido en Pro
  (3,3%)**. FDT recién se factura pasados ~3.000 tenants: no existe en Capa 1.
- **Donde sí toca es en Edge Requests, que no son gratis pasados ~80 tenants.** Cada chunk es un
  request aparte (el build de hoy tiene 17 archivos en `.next/static/chunks`), así que el supuesto
  de «~8 requests/pageview» de R1 describe una visita **fría** y sobreestima una tibia. El número
  de §2 (USD ~0.04) queda del lado conservador.
- **Lo que sí es una fila de otro:** 181.739 B de JS para una ficha que es HTML de 14,8 KB son
  **12,3× el peso del contenido**, y no hay ningún gate mirando ese número — ni de costo (no cuesta)
  ni de performance (que es de quien corresponda). Lo dejo dicho acá porque el día que a alguien se
  le ocurra bajar el JS, este es el número contra el que se compara.

#### Veredicto de T1

```
COST_VERDICT: PASS
DELTA_POR_TENANT_MES: USD 0.0024 (Base)  ·  USD 0.0034 (Negocio)   ← reserva, tarifa gru1
                      USD 0.0000 hoy: NINGUNA regla está publicada (no hay proyecto Vercel, B2/B5).
                      `storefront-track-rl` es `active` desde S4; `chatbot-rl` sigue `planned`.

  Base     3.000 allowed req/mes × USD 0.80/1M = 0.0024   (reserva: 20× el volumen de clicks
                                                           estimado. El trigger es el click, MEDIDO)
  Negocio  4.200 allowed req/mes × USD 0.80/1M = 0.0034   (+1.200 msgs de chat al soft cap)
  a tarifa iad1 (USD 0.50/1M) los mismos volúmenes dan 0.0015 y 0.0021

  y ADEMÁS corrige hacia abajo el renglón de FASE 1:
  marginal Base    0.086 − 0.060 (WAF viejo) + 0.0024 = USD 0.029   → 6% del objetivo
  marginal Negocio 0.313 − 0.060 (WAF viejo) + 0.0034 = USD 0.256   → 51% del objetivo
```

**SUPUESTOS:** 3.000 pageviews/mes/tenant `[EST]` · **el beacon dispara en el `click`, nunca en el
render** `[MEDIDO en S4, 2026-08-28: filas_al_cargar=0]` — esto **dejó de ser un supuesto** ·
la reserva se mantiene en 1 beacon/pageview `[EST, conservador, y explícito]`: **cubre el volumen de
clicks, que sigue sin medirse, no el trigger, que ya está medido** — el detalle de por qué no bajé
el número está en §2.3 · conversión a click de `wa.me` 5% `[EST]` · chat al soft cap de 40 msgs/día
= 1.200/mes · tarifa `gru1` USD 0.80/1M `[UNVERIFIED que sea la que aplica a AR]` · las dos reglas
se publican tal como están en `config/firewall-rules.json` — **hoy no hay ninguna publicada**
(B2/B5), así que el gasto real de este renglón es USD 0.00 y el modelo es una proyección.

**VECTOR_MAS_RIESGOSO:** **el scoping de las reglas, no su precio.** El precio unitario del rate
limit es irrelevante en todos los escenarios que modelé (peor caso: 0,7% del objetivo). Lo que sí
mueve la aguja es **a qué stream de requests se le apunta una regla**, porque cada regla cuesta un
+40% sobre lo que ese stream ya costaba en Edge Requests: apuntar al HTML de la vidriera cuadruplica
el marginal del plan Base (0.03 → 0.124) y prender Managed Rulesets lo sextuplica (0.03 → 0.18).
Las dos son decisiones de **una línea de configuración que no pasa por ningún diff del repo**, y el
gate de drift contra la config viva **no está implementado**.

**METRICA_A_VIGILAR:** **allowed requests del WAF ÷ pageviews de vidriera del mismo período.**
Valor de diseño **≤ 0,05**: el beacon en el click es `[MEDIDO]` desde S4, así que 0,05 dejó de ser
*una de dos ramas posibles* y pasó a ser **la** rama. La banda hasta **1,05** sigue siendo la
**reserva presupuestada** —entra en el objetivo igual—, pero **ya no describe un diseño aceptado**:
un ratio sostenido cerca de 1 significa que el beacon se soltó del click o que una regla se movió,
y eso se investiga, no se acepta. **Alarma en > 1,5**: significa que una regla se corrió al camino de render o a `/_media`
(donde una grilla pide ~20 imágenes de una y el ratio saltaría a ~20). Es un **ratio y no un monto**
a propósito: el monto absoluto va a seguir siendo despreciable durante todo el tiempo en que el
error sea barato de arreglar, así que un umbral en USD avisaría tarde. El monto (dashboard de Vercel
→ *Usage* → **Rate Limit Requests**) sirve de confirmación, con alarma secundaria en
**> USD 0.01/tenant/mes** (3× el peor caso modelado).

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
| Edge Requests | ~400k requests × USD 2.00/1M → **USD 0.80 en el día**, el vector real |
| **WAF Rate Limiting** | **USD 0.04 en el día** (§2.3). Sólo matchea el beacon: ≤50.000 allowed × USD 0.80/1M. El chat está acotado por el soft cap. El renglón viejo decía «Edge Requests + WAF ~USD 1.00» y ese USD 0.20 de más era la regla `host` que T1 rechazó — con las reglas acotadas el WAF es el **5%** del día caro, no la mitad |
| Vercel functions | sólo en misses |
| LLM | acotado por el soft cap de 40 msgs/tenant/día |

**Y si el pico es abuso en vez de viralidad, el día sale más barato, no más caro.** El tráfico que
la regla deniega **no genera Edge Requests, ni Fast Data Transfer, ni invocaciones, ni allowed
requests**: la factura de un flood bloqueado es literalmente cero en esas cuatro líneas. Es
contraintuitivo y está verificado (§2.3). El umbral está calculado: la regla del chat se paga sola
denegando el 0,5% de lo que ve; la de `/api/track`, el 23%.

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
| **WAF** | **allowed requests ÷ pageviews de vidriera** | **> 1,5** — una regla se corrió al camino de render o a `/_media`. Valor de diseño: **0,05**, y desde S4 es `[MEDIDO]` que el beacon dispara en el click (`filas_al_cargar=0`), no en el render. Hasta 1,05 es **reserva presupuestada**, no diseño aceptado: sostenido cerca de 1 se investiga. Es un ratio y no un monto porque el monto avisaría tarde: sigue siendo despreciable durante todo el tiempo en que el error es barato de arreglar (§2.3) |
| **WAF** | **líneas de facturación del Firewall activas** | **cualquiera que no sea `Rate Limit Requests`** — en particular `Managed Rulesets` / *inspected requests*, que se prende con un toggle, no aparece en ningún diff y sextuplica el marginal del plan Base (§2.3) |
| **miss** | **ISR writes sobre slugs que no son de ningún tenant** | **cualquier ritmo sostenido** — es el único vector que no aparece en el costo de ningún tenant, y el perfil corto lo hace 12× más caro por hora que el viejo `'max'` (a cambio de que no quede nada pegado). **La palanca es Attack Challenge Mode** (gratis, inmediato, sin `publish`), no una regla de rate limit: el camino de render **no tiene regla y no la va a tener** (§2.3). Es la única alarma del documento cuya mitigación es manual — USD 2.88 por hora no mirada |

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
round-trip a R2 en el upload — §2.2.3: costo tonto en la dirección contraria) ·
**regla de WAF cuya `condition` matchee el camino de render de la vidriera** — `type: "host"`,
`path pre /s`, o cualquier catch-all — porque los allowed requests se facturan y eso le cobra peaje
a cada pageview: cuadruplica el marginal del plan Base (§2.3) ·
**Managed Rulesets / OWASP CRS prendido sin ADR ratificado** (§2.3: 6,4× el marginal Base, y el
daño no aparece en ningún diff).

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
- **A qué tarifa regional se factura el rate limit del WAF para tráfico argentino.** La doc dice que
  el precio *"is based on the region(s) from which the requests come from"* pero **no existe (o
  `researcher` no encontró) la tabla país → región de facturación**, y la sección «Rate limiting
  pricing» de `usage-and-pricing` **viene vacía** en la versión markdown de la doc: los precios
  salen de las páginas de pricing regional. **El rango real es USD 0.50 (`iad1`) – 0.80 (`gru1`) por
  1M allowed requests**, y §2.3 usa 0.80 por conservador. **No es lo mismo que la región de
  funciones**: el WAF corre en el PoP del visitante, así que elegir `iad1` para las funciones no
  compra la tarifa de `iad1` acá. Se cierra con la primera factura, y el error máximo es ±37% sobre
  un renglón de USD 0.003 — o sea que **no vale la pena cerrarlo antes**.
- **Si «inspected requests» de Managed Rulesets incluye los hits servidos desde el CDN cache.** Si
  los incluye, los USD 0.154/tenant/mes de §2.3 son un **piso**. No se verifica: se verifica el día
  que haya un ADR para prenderlo, y no hay ninguno.
- **Cuántos requests matchean de verdad una regla.** `/api/track` **ya existe** (S4, `c9611b1`) y
  su regla está `active`; `/api/chat` aterriza con FASE 5. **Hoy el gasto de esta línea sigue siendo
  USD 0.00, pero ya no porque falten endpoints: porque no hay ninguna regla publicada** —no hay
  proyecto Vercel (B2/B5) y `publish` es un paso operativo aparte—, así que §2.3 sigue siendo una
  proyección. **Lo que S4 cerró es el trigger del beacon**, que era el supuesto más frágil:
  `filas_al_cargar=0` `[MEDIDO]`, dispara en el `click`, y con eso el renglón es **fijo y no
  proporcional al tráfico**. **Lo que sigue `[UNVERIFIED]` es el volumen**: cuántos clicks por
  tenant y por mes. El 5% de conversión no tiene ninguna vidriera real atrás, y por eso §2.3
  reserva 20× ese volumen en vez de bajar el número. Se cierra con la primera vidriera con tráfico,
  no con otra slice.
- **Lo que `/api/track` cuesta FUERA del WAF: nunca se midió.** Cada click es una invocación de
  Vercel Function y un `INSERT` en Postgres, y **S4 no tiene entrada propia en §2**: este documento
  audita el renglón de WAF del beacon y ningún otro. Orden de magnitud con los precios que ya usa
  §2.2: 150 clicks/mes × USD 0.60/1M = **USD 0.00009/mes** de invocaciones `[EST]`, con el precio de
  invocación `[UNVERIFIED]` como el resto de fluid compute. **El Active CPU del handler no está
  medido**: a diferencia de `sharp` (677 ms medidos por `bench`), acá no hay ni una corrida. Es casi
  seguro despreciable —un insert, sin imagen y sin LLM—, pero *casi seguro* no es un número y no se
  escribe como si lo fuera. Lo que sí conviene anotar por forma, no por monto: `wa_click_events` es
  **la primera tabla del producto que crece con el tráfico y no con el stock** (~150 filas/mes/tenant
  `[EST]`, ruido contra los 8 GB del plan Pro), o sea la primera cuyo tamaño no lo controla el dueño
  del negocio. Queda como hueco explícito hasta que S4 tenga auditoría de costo propia.
- **Drift entre `config/firewall-rules.json` y la config viva del WAF.** El gate de nivel 1
  (estático) pasa; el de nivel 2 (`vercel firewall diff --json` contra Vercel) **no está
  implementado** — falta saber qué scope de token permite `publish`. **Entre el archivo que audité y
  la factura no hay verificación automática**: todo §2.3 vale mientras nadie publique una condición
  distinta de la del repo. Es el riesgo residual de T1 y es de configuración, no de código.
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

**T1 auditada (2026-08-28): PASS, delta USD 0.0024 (Base) / USD 0.0034 (Negocio) por tenant/mes** —
ver §2.3. Es la primera auditoría del repo que **baja** el modelo en vez de subirlo: el renglón de
WAF de FASE 1 (USD 0.06, calculado sobre una regla `host suf .maat.work` que el LEAD rechazó) cae
17–25× y con él **el 68% del marginal del plan Base**, que pasa de 0.09 a **0.03**. La aritmética
de los 100k requests → USD 0.08 es correcta, pero es un **techo de plataforma** (~24 tenants) y no
una línea marginal: atribuirlo a un tenant solo daba 16% del budget cuando el número real es 0,5%.
Tres cosas quedan escritas para el futuro: el **umbral** que hace neta negativa a cada regla (0,5%
de denegación en el chat, 23% en `/api/track`), la alerta de **Managed Rulesets** (un toggle,
6,4× el marginal Base, invisible en cualquier diff) y los **tres caminos** por los que igual
podríamos terminar facturando pageviews.

**S4 (2026-08-28) no movió ningún total, y eso es un resultado, no una omisión.** De los tres
caminos de arriba, **el más probable —el trigger del beacon— se cerró midiéndolo**:
`filas_al_cargar=0`, cargar la ficha no escribe ninguna fila, el beacon vive en el `click`. El
renglón de §2.3 **se mantiene en USD 0.0024 / 0.0034 a propósito**: la reserva de 1 beacon/pageview
dejó de cubrir el trigger (medido) y pasa a cubrir el **volumen** de clicks (sin medir), que es 20×
el estimado y vale 0,46% del objetivo — bajarla sería precisión falsa sobre un denominador que
tampoco está medido. Con `storefront-track-rl` en `active`, **la regla ya no le va detrás al
endpoint: el endpoint nació con techo declarado.** Lo que S4 **no** trajo es una auditoría de costo
propia: su invocación de función y su fila de Postgres siguen sin medirse (§7).

**El más silencioso de los tres sigue abierto, y sin fecha: el gate valida el archivo, no la config
publicada.** `active` en `config/firewall-rules.json` significa que el repo **declara** que la regla
debe estar publicada, no que lo esté — hoy no lo está (B2/B5). El gate de nivel 2
(`vercel firewall diff --json`) **no existe**, así que entre el archivo que audité y la factura no
hay ninguna verificación automática. Es el **riesgo residual conocido de T1**, es de configuración y
no de código, y se cierra con el gate: ninguna slice de producto lo va a cerrar por su cuenta.

**Abierto:** precio de Supabase (B2) · **precio de fluid compute de Vercel (§7)** · comisión de MP
(B3, ADR-008) · región (ADR-010) · **Class B real y bytes del master (B1)** ·
**bytes por pageview de vidriera con fotos (S3)** · todos los supuestos de tráfico, hasta la
primera vidriera real.
