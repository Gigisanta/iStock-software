# COST — modelo de costo de infraestructura

_Owner: `cost-auditor`. **Escrito por el LEAD en FASE 1** (excepción declarada en `CLAUDE.md` §4).
Números con fuente salvo los marcados `[EST]` / `[UNVERIFIED]`, que **no** son evidencia._
_Fecha: 2026-08-28. Insumos: R1 (wildcard/ISR), R2 (R2/imágenes), R3 (LLM), R7 (amenazas),
`docs/research/vercel-firewall-as-code.md` (T1), `docs/research/vercel-cron-limits.md` (S6)._
_Re-medido el 2026-08-27 después de **ADR-011** (el slug inexistente dejó de ser 404) y **ADR-012**
(los dos polos del cache). Lo que cambió está en §2.1; lo que **no** cambió también, y dice por qué._
_**Re-auditado el 2026-08-28 contra HEAD `6952393`** (§2.6): entra `packages/ai` —que no existía
cuando se escribió §2.5— y sale el hallazgo del barrido, que `b9a8e05` cerró. Lo que este documento
afirmaba del cron entre `68c0bd6` y hoy quedó **obsoleto en menos de una semana**, y se deja escrito
con esa etiqueta en vez de borrarse._
_**Re-medido el 2026-08-28 tras S8** (§2.7): la eval la corrí yo, no copié el número, y el paquete
se movió tres veces mientras lo auditaba. La dieta bajó 4 tokens por la sanitización de `ai-agent`,
el corpus creció a 198 casos con 12 que llaman una tool, y el costo por mensaje quedó en
**USD 0,00008501** (era 0,00008032). El hallazgo no es el precio: **el turno con tool llega a 1193
de 1200 y sostiene ese número degradando** — 2 de los 18 turnos con tool del corpus tiran el
historial completo, con la eval en verde y sin que nada se ponga rojo. Cuatro números heredados
habían derivado y están corregidos: el techo de `chatbot-rl` (12/60s → **20/600s**, §2.6.6), el
estado de C2 (**cumplida**, §2.6.4), una mezcla de unidades en el renglón del fallback (§2.6.3) y el
techo estructural del mensaje (0,000192 → **0,000384** cuando el turno usa una tool)._
_**Re-medido el 2026-08-28 tras C8** (§2.8): `ai-agent` cerró el hueco que yo había reportado y el
precio se movió. El renglón de vidriera pasó de **USD 0,0850 a 0,0989 /1000 msgs** y el facturado de
0,1093 a **0,1257**. **El anterior subfacturaba**: `promptTokens` era un `Math.max` y contaba una
vez un turno que manda el prompt dos veces (+14,2 %); el resto (+1,9 %) es el corpus, que sumó la
ficha del **plan Negocio**. Nada se encareció. **El techo estructural del turno con tool NO cambia**
(USD 0,000384) — lo que cambió es el esperado. Dos hallazgos nuevos, los dos medidos: el código
permite **4 llamadas facturadas en un turno**, no 2, y la ficha que el plan Negocio vende mide
**1374 tokens** contra un techo de 1200, así que hoy entra tirando el historial completo._
_**Re-medido el 2026-08-28 contra `89ab7c0`** (§2.8.3b): `ai-agent` cerró **C11** y **el techo de
llamadas facturadas por turno bajó de 4 a 3**, ahora como constante **derivada**
(`MAX_BILLED_CALLS_PER_TURN = TURN_ROUNDS + 1`) y no como número suelto. El techo absoluto del chat
pasa de **USD 0,8064 a 0,6336/tenant/mes** (−21,4 %, **no** el −29 % que yo había estimado: la resta
de C11 describía una de las dos ramas de 3 llamadas, no la cara — 2 primarios + 1 fallback). **El
esperado no se movió ni un dígito** (USD 0,1186/mes): lo que se compró es seguro contra el día malo,
no un ahorro de hoy. En la misma pasada se partió la celda de dueño de **C6**, que decía `ai-agent`
sola y **violaba `CLAUDE.md` §4** — el consumidor del `ContextTrimReport` vive en la columna de
`app-agent` y **espera FASE 5**._

_**Censado el 2026-08-28, y no se movió ningún precio.** Se me encargó barrer los once lugares que
todavía multiplicaban por **4 llamadas** después de que `89ab7c0` bajara el techo a 3: **quedan
cero**, los once ya los había corregido `84c2f4d` en la misma ronda que midió el techo — lo dejo
escrito porque el encargo se armó con el archivo en `6aea02b` y la medición estaba vencida, no
equivocada. Lo que **sí** estaba roto era otra cosa: **`C9` tenía dos filas con dos dueños**
(`ai-agent` en §2.7, `humano` en §2.8) sobre la misma decisión, y la fila de §2.7 se contradecía con
su propia columna de la derecha. **El dueño es el humano**; la fila vieja quedó `SUPERADA` con
puntero, y la regla que evita que vuelva a divergir está bajo la tabla de §2.7. Además se publicó la
aritmética del techo con `MAX_INPUT_TOKENS = 1374` (**USD 0,6910/mes, 1,45× de headroom** — el par
`0,8795 / 1,14×` es el de 4 llamadas y está vencido, §2.8.5 §2)._

_**Y el umbral de `C10` se cayó el mismo día, arbitrado por el LEAD** (`CLAUDE.md` §5): `calls > 2`
falla en las **dos** polaridades —enciende con tráfico legal, porque el turno degradado normal
factura 3 contra un techo de 3, y calla en el turno quemado, que reporta `calls: 0` porque el
`throw` descarta la medición—. Quedan **tres condiciones con tres trabajos**:
`billed.primaryServedEmpty` (degradación) · `handoff === 'provider_down'` (turno quemado) ·
`calls > MAX_BILLED_CALLS_PER_TURN` (aserción de control de flujo, **no** alarma de costo).
El `throw` que descartaba la medición **está cerrado en el árbol de hoy** (§2.8.7): el arbitraje no
depende de eso —la pata «enciende con tráfico legal» vale igual— pero el `calls: 0` de arriba es el
comportamiento de entonces, no algo que hoy se reproduzca.
Actualizados `C10` (§2.8), el `METRICA_A_VIGILAR` de §2.8.7 y la fila de LLM de §5; §6 suma el fallo
automático de la **clase**: una alarma de costo se acepta mostrando que enciende con el caso
patológico **y** calla con el tráfico legal. **Ningún precio se movió con esto.**_

## Objetivo duro
> **Base ≤ USD 0,50 · Negocio ≤ USD 1,50** por tenant activo, hasta 100 tenants, donde el 1,50 es
> **0,50 + hasta 1,00 atribuible al chat**.

Ratificado por el LEAD (`ARCHITECTURE.md` §153, `DECISIONS.md` §21-28, commit `ea26a02`). **La forma
importa más que el número:** el 1,50 **no** es una vara más floja para las mismas cosas — una slice
de vidriera, de panel o de media se mide contra **0,50 aunque el tenant esté en Negocio**. Si no,
«Negocio ≤ 1,50» licencia en silencio una vidriera de 1,40 y el chat se queda sin lugar. Corolario
operativo: **un número por tenant que no dice qué parte es chat no se puede comparar contra ninguno
de los dos techos**, así que en este documento el marginal va siempre atribuido (§2.5.6).

§2.4.7 dejaba esto como «acotación abierta para ratificación». **Está ratificado y cerrado.**

El **piso fijo** se cuenta **aparte** del marginal. No mezclar.

## 0. Conclusión, arriba de todo

**Se cumple, y con margen — pero no por donde parecía en FASE 0.**

| | FASE 0 `[EST]` | FASE 1 (con fuente) | FASE 4 (S1 + S2 **medidas**) | T1 (WAF **acotado**) | S6 (reservas + cron) | **HEAD `68c0bd6` (radio MEDIDO)** |
|---|---|---|---|---|---|---|
| Marginal plan **Base** | ~USD 0.03 | USD 0.07 | USD 0.09 | USD 0.03 | USD 0.088 | **USD 0.025 – 0.026** |
| Marginal plan **Negocio** | 0.03 + `[R3]` | USD 0.24 – 0.30 | USD 0.25 – 0.31 | USD 0.20 – 0.26 | USD 0.259 – 0.319 | **USD 0.196 – 0.257** |
| Headroom del Negocio contra el objetivo | «~15× abajo» | ~1.7× | ~1.6× | ~1.9 – 2.5× | ~1.6 – 1.9× | **5.8 – 7.6×** (contra 1.50 por plan) |
| **% de hits de vidriera que llegan a Postgres** `[EST]` | — | — | «1,3 %» (**mal modelado**) | — | 39,4 % (alarma: 5 %) | **4,6 %** (radio 2, **medido** por V9) |

> **La última columna es de la re-auditoría del 2026-08-28 y está en §2.5.** Todo lo que dicen las
> columnas anteriores sobre el 39,4% y sobre «la palanca pendiente» es **historia**: la palanca de
> §2.4.5 se accionó en `f504d69`, el radio de invalidación es **2** y lo **cuenta** V9 de
> `accept-s6.sh` desde la línea `MEDIDO s6 radio` del e2e. Se dejan escritas las columnas viejas
> porque un documento de costo que borra sus errores deja de ser auditable — pero **el estado es
> la última columna**.

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

> **Corregido el 2026-08-28 con la eval de `packages/ai` (§2.6), re-corregido el mismo día con el
> corpus que empezó a medir los turnos con tool (§2.7), y re-medido después de C8 (§2.8).** El
> «70–77%» salía de calcular el chat con la dieta **en el techo**. Con el consumo del corpus medido,
> el chat es **USD 0,119/mes** contra un techo estructural de **USD 0,461**, o sea el **81%** del
> marginal Negocio esperado (0,145) y el **94%** del de techo (0,488). **Sigue siendo la línea más
> grande del plan Negocio por lejos** — la frase de arriba subestimaba la proporción, no la
> sobrestimaba. Lo que cambia es el valor absoluto:
>
> | plan | esperado `[CALC-STUB]` | techo `[ESTRUCTURAL]` | contra el objetivo |
> |---|---|---|---|
> | **Base** | USD 0,025 – 0,026 | igual (no tiene chat) | 0,50 → **19×** |
> | **Negocio** | **USD 0,145** (0,026 no-chat + 0,119 chat) | **USD 0,488** (turno con tool) · **USD 0,660** (las 3 llamadas de §2.8.3b; decía 0,833 con las 4 de antes de `89ab7c0`) | 1,50 → **10,3× / 3,1× / 2,3×** |
> | **Negocio, hoy en producción** | **USD 0,026** | — | nada invoca `@istock/ai` (§2.6.4) |
>
> **El techo pasó de 0,257 a 0,488 el 2026-08-28 y no es que algo se haya encarecido (§2.7):** un
> turno que llama la tool `get_open_listing` manda el prompt **dos veces** y las dos se facturan,
> cada una con su propio `MAX_OUTPUT_TOKENS`. El techo viejo contaba una sola llamada. **El esperado
> subió por el mismo motivo** (0,096 → 0,114 → **0,119**): hasta la ronda de §2.7 el corpus no
> ejercitaba ni una tool call, así que el «esperado» era el de un producto que no es éste.
>
> **Y el 0,114 de §2.7 todavía subfacturaba (§2.8):** el reporte tomaba `Math.max` de los prompts
> del turno en vez de sumarlos. Con `ChatAnswer.billed` puesto por C8, el esperado medido es
> **USD 0,1186/mes** y el mensaje de vidriera **USD 0,00009885**. **El techo del turno con tool no
> se mueve** (0,000384/msg): lo que se movió es el esperado. Lo que sí es nuevo es un techo **más
> arriba** que no estaba escrito: el código permite llamadas facturadas de más porque el primario
> que contesta `200` vacío se factura igual. Eran **4 por turno**; desde `89ab7c0` son **3**, y ahí
> el mensaje vale **USD 0,000528** y el mes **USD 0,6336**, o sea **1,58×** bajo el presupuesto de
> chat en vez de 2,2× (era 1,24× con las 4). Sigue siendo PASS; deja de ser holgado. **Y el eval no
> se movió con el arreglo:** el techo facturable no es la factura (§2.8.3b).
>
> **Y el turno con tool no aguanta el techo de dieta: lo aguanta degradando.** Medido sobre el
> corpus del propio gate, **2 de los 18 turnos con resultado de tool tiran el historial completo**
> para que el prompt entre en 1200 (`reserved` × conversación cargada, 1193 de 1200), y en el
> barrido exhaustivo el borde es 1200 de 1200 con 65 de 65 preguntas degradando. La factura no se
> mueve, la respuesta empeora y nada se pone rojo. **Es el único vector de este documento cuyo
> síntoma es de calidad y no de plata, y el único que ya está ocurriendo.**
>
> **Y el hallazgo de la re-auditoría no es el número: es que el número no tiene techo enforced.**
> El soft cap de 40 msgs/día que multiplica todo el renglón de chat es una **función pura sin
> contador** — la constante existe, la decisión existe y está testeada, y el valor que lee no lo
> produce nadie. Sin él, lo único que acota la factura el día que aterrice `/api/chat` es una regla
> de WAF que permite **2.880 msgs/día por IP y por región**: **USD 6,91 – 16,59/mes** (§2.6.6).
> *(Esta línea decía «17.280 msgs/día … USD 41 – 99/mes contra un plan de USD 35». La regla
> `chatbot-rl` pasó de 12/60s a 20/600s en `config/firewall-rules.json` y este documento se quedó
> con el número viejo; corregido el 2026-08-28. La mitad que **no** cambió es la que importa: el
> techo de la factura sigue siendo un contador que no existe, no una regla de WAF.)*

**La columna S6 sube, y hay que leer de qué está hecha la suba, porque son dos cosas distintas:**

```
Base:  0.030  →  0.074   corrección de modelo mía, ANTERIOR a S6 (ISR Writes mal contados)
       0.074  →  0.088   delta real de S6
```
**S6 aporta USD 0.015/tenant/mes. Los otros USD 0.044 son una deuda de este documento que S6 hizo
visible.** Cobrárselos a la slice sería mentir sobre quién los generó.

**Y ninguna línea de S6 es el cron.** El cron `*/5` es **piso fijo, no marginal** —una corrida barre
todos los tenants— y cuesta USD 0.028 – 0.133/mes en total, el 0,3% del piso. El delta marginal es
casi todo **ISR Writes por invalidación ancha**. Ver §2.4.

**Y la corrección que S6 destapó, que es más grande que S6:** la fila de arriba dice 39,4% donde
§2.2.5 decía 1,3%, y **el que estaba mal es el 1,3%** — se calculó como `invalidaciones / pageviews`,
fórmula que sólo vale si una purga alcanza una página. `invalidateStorefrontUnit()` emitía
`storefront:{slug}`, que la **ficha también registraba**, así que **una reserva purgaba las 61
páginas del tenant, no 1**. Sin S6 el número ya era 32,1%.

> **Cerrado el 2026-08-28 (§2.5.1).** Las dos ediciones de §2.4.5 se hicieron en `f504d69`: la
> ficha ya no registra `storefront:{slug}` y `invalidateStorefrontUnit()` ya no emite
> `tenant-config:{slug}`. **Radio = 2, y no es una lectura del fuente: lo cuenta V9 de
> `accept-s6.sh` con `esperado=2` y controles anti-vacuidad.** El vector de DB queda en **4,6 %**,
> bajo la alarma, e ISR Writes caen de USD 0,071 a **USD 0,0085** — el 62% del marginal Base.

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
| Vercel Cron `*/5` (expirar reservas) | uso | **0.028 – 0.133** `[EST]` | **S6, §2.4.1.** Invocaciones verificadas (USD 0.0052); Active CPU + memoria son horquilla sin medir. **Es piso, no marginal:** una corrida barre todos los tenants |
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
no confundir con los 120.000: sólo dos rutas están bajo regla, y el HTML de la vidriera no) ·
**desde S6: ~25 reservas/mes/tenant `[EST]`, de las cuales ~18 terminan en venta y ~7 vencen o se
cancelan** · **reparto de pageviews 50% grilla / 50% fichas `[EST]`** — este último no existía como
supuesto y sin él el vector de Postgres no se puede calcular (§2.4.4).

| vector | cálculo | USD/mes | fuente |
|---|---|---|---|
| R2 storage | **120,2 MB medidos** (240 fotos × 500.938 B) × USD 0.015/GB | **0.0018** | **§2.2, medido** |
| R2 Class A (writes) | 288 PutObject/mes × USD 4.50/1M | **0.0013** | **§2.2, medido** |
| R2 Class B (reads) | ~4.320 GET de origen/mes × USD 0.36/1M | **0.0016** `[EST]` | §2.2 |
| R2 egress | **0 por diseño** | **0** | R2: egress Free |
| **Upload: Active CPU de `sharp`** | 72 fotos/mes × 1,35 s × USD 0.128/CPU-h | **0.0035** `[UNVERIFIED el precio]` | **§2.2, CPU medido** |
| Upload: memoria + invocaciones + transferencia a R2 | ver §2.2 | **0.0056** `[EST]` | §2.2 |
| ~~**ISR Writes** — pre-S6~~ | ~~962 renders fríos/mes × 15 write units~~ | ~~0.058~~ | **superado por §2.5.1** — valía con radio 61 |
| ~~**ISR Writes** — delta S6~~ | ~~+221 renders fríos × 15 write units~~ | ~~0.0133~~ | **superado por §2.5.1** |
| **ISR Writes — vigente (radio 2, MEDIDO)** | ≤141 renders fríos/mes × 15 write units | **0.0085** | **§2.5.1.** El radio lo cuenta V9 de `accept-s6.sh` (`esperado=2`); el tráfico sigue siendo `[EST]` |
| ISR Reads | sólo en CDN miss | ~0 | R1: USD 0.40/1M |
| **Server Actions reservar/cancelar** | 32/mes × USD 0.60/1M | **0.00002** | §2.4.7 |
| **Cron `*/5` amortizado a 100 tenants** | (0.028 – 0.133) ÷ 100 | **0.0003 – 0.0013** | **§2.4.2 — es piso (§1), va acá sólo para que se vea que es ruido** |
| Edge Requests | 10M incluidos ≈ 80 tenants; después USD 2.00/1M | **~0.04** | R1 (iad1) |
| **WAF Rate Limiting** — Base | ≤3.000 allowed req/mes × USD 0.80/1M | **0.0024** | **§2.3, T1** |
| **WAF Rate Limiting** — Negocio | ≤4.200 allowed req/mes × USD 0.80/1M | **0.0034** | **§2.3, T1** |
| Postgres | **95,4% de hits cacheados** (§2.5.1) | ~0 en USD, **4,6%** contra una alarma de 5% | **§2.5.1** — el objetivo de ADR-007 **se cumple** desde `f504d69`; §2.4.4 (60,6%) es historia |
| LLM plan **Base** | **widget ausente** | **0** | `CLAUDE.md` §3 |
| LLM plan **Negocio** | 1.200 msgs × USD 0.000144–0.000192 | **0.17 – 0.23** | R3 |
| ~~Marginal Base — con S6~~ | | ~~USD 0.088~~ | §2.4.7, con radio 61 |
| ~~Marginal Negocio — con S6~~ | | ~~USD 0.259 – 0.319~~ | §2.4.7, con radio 61 |
| **Marginal Base — VIGENTE** | no-chat, contra el techo de 0.50 | **USD 0.025 – 0.026** | **§2.5.6** |
| **Marginal Negocio — VIGENTE** | no-chat 0.026 + chat 0.17 – 0.23 | **USD 0.196 – 0.257** | **§2.5.6** — atribuido, contra 0.50 (no-chat) y 1.00 (chat) |

> **Los dos renglones de LLM de esta tabla son de FASE 1 y están superados.** «1.200 msgs ×
> USD 0.000144–0.000192 = 0.17 – 0.23» calcula con la dieta **en el techo** y con **una** llamada
> por turno. Medido: el chat esperado es **USD 0,1186/tenant/mes** (§2.8) y el techo del turno con
> tool **USD 0,4608** — o **USD 0,6336** contando las 3 llamadas que el código permite (§2.8.3b;
> eran 4 y USD 0,8064 hasta `89ab7c0`). Con eso, el **Marginal Negocio VIGENTE es USD 0,145
> esperado · 0,488 techo con tool · 0,660 techo absoluto**, contra los `0.196 – 0.257` que dice la
> fila. El **Marginal Base no se toca**: no tiene
> chat. Las filas se dejan escritas porque este documento no borra sus errores; el estado es §2.8.

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
(`dist/server/lib/cache-control.js`, medido contra **`next@16.3.3`**) emite
`s-maxage=<revalidate>, stale-while-revalidate=<expire − revalidate>`. Con eso, cada header medido
se deriva de un perfil y de uno solo:

| perfil | `stale` / `revalidate` / `expire` | header que produce | medido en |
|---|---|---|---|
| `'max'` de Next (`defaultConfig.cacheLife.max`, `dist/server/config-shared.js`) | 300 / **2.592.000** / 31.536.000 | `s-maxage=2592000, stale-while-revalidate=28944000` | **el polo positivo (`demo`)**, hoy |
| `STOREFRONT_MISS_LIFE` (`_lib/cache-life.ts`) | 60 / **300** / 900 | `s-maxage=300, stale-while-revalidate=600` | **el miss**, hoy |

> **Las dos referencias a Next apuntan a `node_modules`, que no está en git.** Por eso van por
> símbolo y con la versión pegada, no por línea: una línea de `node_modules` no se puede reproducir
> en un clon limpio ni sostener con un gate, y se mueve entera con cada upgrade. Se verifican
> después de `pnpm install` con `grep -n 'getCacheControlHeader' node_modules/next/dist/server/lib/cache-control.js`
> y `grep -n 'max: {' node_modules/next/dist/server/config-shared.js`, y **valen para `next@16.3.3`**.
> El día que un upgrade mueva el emisor o el perfil, esta aritmética deja de valer y se sabe por qué.

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

> **⚠ CORREGIDO EN S6 (2026-08-28). El 1,3% de este bloque está mal por 25×; el número real es
> 32,1%.** La fórmula `invalidaciones / pageviews` supone que una purga alcanza **una** página, y
> `invalidateStorefrontUnit()` emite `storefront:{slug}`, que **la ficha también registra**: purga
> las 61 páginas del tenant. Hay que contar por página, `I/(λ+I)`, y las fichas —25 visitas/mes cada
> una— caen frías casi siempre. **La aritmética de §2.2.5 se deja tal cual escrita a propósito**, para
> que se vea de dónde salió el error. La cuenta correcta y la palanca están en **§2.4.4 y §2.4.5**.
> La conclusión de este bloque sobre el coalescing por sesión **sigue en pie**: el problema nunca
> fue el número de invalidaciones, es el radio de cada una.

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

### 2.4 Auditada en S6 — reservas, cron de expiración e invalidación (2026-08-28)

Commits `cbbfa2f` + `10d31b6`. Lo que tiene costo: el cron `*/5` de `vercel.json`, el barrido con
`EXPIRE_BATCH_SIZE = 200`, las Server Actions de reservar/cancelar, y **una llamada a
`invalidateStorefrontUnit()` por cada entrada y salida del estado público**.

**El titular, y es incómodo: el renglón caro de S6 no es el cron, es la invalidación — y el modelo
de invalidación que este documento venía usando desde §2.2.5 estaba mal por 25×.** El error es
mío y es anterior a S6; S6 lo empeora 23% y, sobre todo, lo vuelve imposible de seguir ignorando,
porque es la primera mutación cuya frecuencia la maneja **la venta** y no la carga de stock.

#### 1. El cron: el número del LEAD está bien, y es el 4–19% del costo del cron

```
*/5 * * * *  →  12/h × 24 h × 30 d = 8.640 invocaciones/mes
8.640 × USD 0,60 / 1.000.000        = USD 0,005184  →  USD 0,0052/mes
8.640 / 10.000.000 Edge Requests     = 0,0864 % del allotment de Pro
```
Las dos cifras se **verifican** contra `docs/research/vercel-cron-limits.md` (2026-08-28), que hace
la misma aritmética y cita `vercel.com/docs/limits` y `vercel.com/docs/functions/usage-and-pricing`:
Function Invocations Pro = **USD 0,60/1M sin allotment incluido**, Edge Requests incluidos = **10M**.
Nada que corregir.

**Pero la invocación no es lo único que se factura por corrida.** Fluid compute cobra además
**Active CPU** (USD 0,128/CPU-h, `iad1`) y **Provisioned Memory** (USD 0,0106/GB-h, `iad1`), y una
corrida vacía —que es el caso normal— igual paga arranque, conexión a Postgres y una query indexada.
Ni el wall time ni el CPU están medidos, así que va como **horquilla declarada, no como número**:

```
wall time por corrida  [EST] 0,3 – 1,0 s   ·  CPU por corrida [EST] 0,05 – 0,25 s
memoria provisionada   [EST] 1 – 2 GB      (no está configurada; se asume el default)

Provisioned Memory : 8.640 × [0,3–1,0] s = [0,72 – 2,40] GB-h·(1–2 GB) → USD 0,0076 – 0,051
Active CPU         : 8.640 × [0,05–0,25] s = [0,12 – 0,60] CPU-h       → USD 0,0154 – 0,077
Invocaciones                                                            → USD 0,0052
                                                                   TOTAL USD 0,028 – 0,133 /mes
```

O sea: **la invocación es entre el 4% y el 19% de lo que cuesta el cron.** El número del LEAD es
correcto y es la punta chica del renglón. La horquilla es de 4,8× y no se cierra sin un deploy: el
término dominante es el **cold start de Vercel**, que no se puede medir en local. Se cierra con
`vercel crons run` contra producción y el gráfico de duración/CPU de la función.

**Y aun en su techo, es ruido: USD 0,133/mes es el 0,3% del piso fijo de USD 45.** Bajar el cron a
`*/15` ahorraría USD 0,02–0,09/mes a cambio de triplicar la deriva de una reserva de 30 minutos.
Es costo tonto en la dirección contraria y queda escrito acá para que nadie lo proponga de nuevo.

#### 2. ¿Escala con tenants? **No. Es piso fijo, y hay que contabilizarlo como tal.**

Una invocación barre **todos** los tenants. El schedule no depende de cuántos haya, y la query de
barrido tampoco: `reservations_active_expiry_idx` es un índice **parcial sobre `status='active'`**,
así que su costo es O(reservas activas vencidas), no O(tenants) ni O(filas de la tabla). Un tenant
número 101 no agrega ni una corrida ni una fila al índice si no tiene reservas vencidas.

Lo que sí crece con tenants es el **trabajo adentro** de la corrida: una transacción (2 `UPDATE`
guardados + 1 `INSERT` en `listing_events`) y una purga de tags por unidad liberada.

```
Amortizado, con la horquilla de arriba:
   20 tenants  →  USD 0,0014 – 0,0067 / tenant / mes
  100 tenants  →  USD 0,0003 – 0,0013 / tenant / mes
```
**Va a §1 (piso fijo), no a §2 (marginal).** Meterlo en el marginal sería el mismo error de
atribución que T1 corrigió con los 100k requests del WAF.

**¿A cuántos tenants empieza a importar?** Con `[EST]` 10 expiraciones/mes/tenant que llegan al
cron (ver §2.4.4), a 100 tenants son 1.000/mes = **33/día = 0,12 por corrida**. El wall time
adicional de 0,12 transacciones por corrida está por debajo de la resolución de este modelo.
El cron empieza a costar plata de verdad cuando el trabajo por corrida deja de ser despreciable
frente al arranque, o sea alrededor de **~50 expiraciones por corrida = ~14.000 expiraciones/día**,
que a este perfil de uso son **~42.000 tenants**. No es un límite que vayamos a tocar.

#### 3. `EXPIRE_BATCH_SIZE = 200`: no es problema de costo ni de producto. El problema es otro.

> **Recalibrado el 2026-08-28 en §2.5.2.** La conclusión de esta sección se mantiene —el techo no es
> la variable— pero el framing de abajo («si alguna vez hubiera 200 de ésas») pedía 200 filas rotas
> **independientes**, que este producto no va a ver. El modo de falla real es **una causa sistémica
> que envenena el 100% de las filas de una** (un `GRANT` que falta, una migración editada después de
> aplicada), y ahí el número de filas es irrelevante: con dos filas debidas y las dos fallando, ya
> no vence nada nadie. Sigue leyéndose esta sección; el cierre está en §2.5.

Saturar el batch requiere 200 reservas vencidas en una ventana de 5 minutos.

```
capacidad del barrido : 200 × 288 corridas/día = 57.600 expiraciones/día
demanda a 100 tenants : ~33 expiraciones/día          →  1.745× de margen
```
Y no puede llegar por ráfaga orgánica: las reservas se crean a lo largo del horario comercial y
vencen 30–120 min después, así que **heredan la dispersión de su creación**. El único camino real al
techo es un **backlog** (cron caído, deploy largo, base caída). Un día entero sin barrer a 100
tenants acumula 33 filas: se drenan en **una** corrida. Para que la primera pasada no alcance hace
falta el cron caído ~6 días seguidos, o ~4.000 tenants con un día de caída. Y aun ahí el `order by
expires_at asc` garantiza que se atienden primero las más viejas, que es el orden correcto.

Respuesta directa a la pregunta: **de ninguno de los dos.** El techo es un guard correcto y su
costo es una latencia extra de 5 minutos en un escenario que este producto no alcanza.

**Lo que sí hay que vigilar del batch, y no es el tamaño: `failed`.** Una fila que falla siempre
—no una carrera perdida, un error permanente— queda `active` con `expires_at` en el pasado y, por
el `order by expires_at asc`, es **la primera de la próxima corrida, para siempre**. Cuesta 8.640
transacciones desperdiciadas por mes por fila envenenada (plata: nada) y, si alguna vez hubiera 200
de ésas, el barrido **deja de avanzar y ningún tenant vence una reserva**. El cron seguiría
devolviendo `200 OK` con `failed: 200`. Es una falla de disponibilidad silenciosa, no de costo, y
por eso entra en §5 como métrica: **`failed > 0` sostenido entre corridas**.

> **Histórico. `b9a8e05` cerró este párrafo entero:** con `sweep_attempts` en el `order by` y un
> techo de 5 en el `where`, una fila envenenada cuesta **5** transacciones una sola vez, no 8.640
> por mes, y deja de encabezar la cola; y el route devuelve **500**, no `200 OK`. La métrica de §5
> se actualizó en consecuencia. Se deja escrito porque la aritmética vieja es la que explica por
> qué el arreglo era necesario.

#### 4. La invalidación: es **por unidad en el nombre y por vidriera entera en el radio**

Esta es la respuesta a la pregunta que importa, y no es la que el commit message anticipa.

`invalidateStorefrontUnit()` emite **tres** tags
(`(app)/_lib/tenants/storefront-cache.ts`):

```
storefront:{slug}   ·   tenant-config:{slug}   ·   listing:{uuid}
```

Y la **ficha** registra **esos mismos tres** (`getStorefrontListing()` y `listingMiss()`, en
`(storefront)/_lib/listings.ts`); la grilla registra los dos primeros (`getStorefrontCatalog()`).
Un tag de Vercel es un **OR**: la entrada muere si se purga **cualquiera** de los suyos.

> **Estado de S6, no de hoy.** §2.5.1 accionó la palanca: en el árbol de ahora
> `invalidateStorefrontUnit()` emite dos tags y `getStorefrontListing()` registra
> `tenant-config:{slug}` + `listing:{uuid}` — el radio es **2**, no 61. El párrafo se conserva
> porque es la aritmética que explica por qué había que accionarla.

> **Con 60 equipos, una reserva purga 61 páginas cacheadas, no 1.** Con 200, purga 201.

No es un bug escondido: `storefront-cache.ts` lo dice en su propio docblock (*«El de la unidad es
hoy redundante con `storefront:{slug}` —la ficha lleva los dos y muere con cualquiera—»*) y deja
declarado el contrato para arreglarlo. Es una **palanca diseñada y no accionada**. Lo que sí es un
defecto es que el docblock de `expire-reservations.ts` justifica la llamada diciendo que purgar la
vidriera entera *«regeneraría 200 fichas por una»* — que es exactamente lo que hace.

**El modelo de §2.2.5 estaba mal, y el error es de este documento.** Ahí se escribió
`40 invalidaciones / 3.000 pageviews = 1,3%`, fórmula que **sólo vale si la purga alcanza una
página y esa página tiene tráfico alto**. Con purga ancha hay que contar por página. Para una
página con λ visitas/mes contra `I` purgas anchas/mes, la fracción de sus visitas que cae en frío
es ≈ `I / (λ + I)` (probabilidad de que haya caído una purga entre dos visitas consecutivas;
aproximación de renovación, los dos procesos ~Poisson).

```
misses/mes = Σ_páginas  λ_p × I / (λ_p + I)
```

Supuestos de §2 (3.000 pv/mes, 60 listings) + reparto `[EST]` 50% grilla / 50% fichas:
grilla λ = 1.500/mes · cada ficha λ = 1.500/60 = **25/mes**. Ese 25 es el que rompe todo: una ficha
se ve **menos de una vez por día**, así que casi cualquier ritmo de purga la agarra fría.

```
ANTES de S6   I = 18 publicaciones + 18 ventas + 4 despublicaciones = 40/mes
  grilla : 1.500 × 40/1.540               =    39 misses
  fichas :    60 × (25 × 40/65)  = 60×15,4 =   923 misses
                                            ─────────────
                                              962 / 3.000  =  32,1 %     (alarma: 5 %)

CON S6        +25 reservas + 7 expiraciones/cancelaciones   [EST]  →  I = 72/mes  (+80 %)
  grilla : 1.500 × 72/1.572               =    69 misses
  fichas :    60 × (25 × 72/97)  = 60×18,6 = 1.114 misses
                                            ─────────────
                                            1.183 / 3.000  =  39,4 %
```
(Las 18 ventas ya estaban contadas; la reserva que termina en venta no suma dos veces.)

**El 1,3% publicado en §2.2.5 estaba bajo 25×. S6 mueve 32,1% → 39,4%: aporta 7,3 puntos, el 23%
del empeoramiento total, y no es el que creó el agujero.**

**En plata esto no es nada, y hay que decirlo con la misma fuerza:**
```
ISR Writes : 1.183 renders fríos × 15 write units × USD 4,00/1M = USD 0,071/tenant/mes
             delta contra los 962 pre-S6 : 221 renders          = USD 0,0133/tenant/mes
Invocaciones de esos renders : 221 × USD 0,60/1M                = USD 0,00013
Postgres   : 1.183 × ~5 queries = ~5.900 queries/mes/tenant = 0,0023 q/s
             a 100 tenants: ~590k/mes ≈ 0,23 q/s — Supabase Pro no se entera
```

**Entonces: la plata dice PASS y el invariante dice FAIL.** `CLAUDE.md` §3 fija *«95% de los hits no
tocan Postgres»* y §5 de este documento pone la alarma en 5%. 39,4% no es «Postgres en cada hit»
—el cache existe y funciona— pero es **8× la alarma**, y el motivo es que la invalidación es ancha,
que es literalmente el caso «mal invalidada» de la lista de fallos automáticos.

#### 5. La palanca: dos ediciones, dos owners, cero infraestructura nueva

Van **juntas o no sirve ninguna**, y ésa es la parte fácil de arruinar:

1. **`storefront-agent`** — `getStorefrontListing()` deja de registrar `storefrontTag(slug)`.
   La ficha se queda con `tenant-config:{slug}` + `listing:{uuid}`. Es el contrato que
   `storefront-cache.ts` ya dejó escrito.
2. **`app-agent`** — `invalidateStorefrontUnit()` deja de emitir `tenantConfigTag(slug)`.
   Una reserva **no** cambia el TC, ni los puntos de retiro, ni los medios de pago, ni el teléfono.
   Sin esta segunda edición, la purga vuelve a matar todas las fichas por la puerta de atrás y la
   primera no sirve para nada.

La grilla **se queda** con `storefront:{slug}`: su orden (`STATUS_ORDER`) y su `publishedCount`
dependen de verdad del estado de cada unidad, así que una reserva sí la cambia. Radio después:
**grilla + la ficha de esa unidad = 2 páginas.**

```
DESPUÉS de la palanca,  I = 72/mes
  grilla         : 1.500 × 72/1.572     =  69 misses
  ficha propia   : ≤ 1 por purga        = ≤ 72 misses   (techo; muchas purgas no llegan a verse)
  otras 59 fichas:                      =   0
                                          ─────────────
                                          ≤ 141 / 3.000  =  4,7 %   ← bajo la alarma de 5 %
```
**8,4× mejor, y no cuesta un centavo de infraestructura.** El ahorro en plata es de USD 0,053/mes
(0,071 → 0,018) y **no es el motivo**: el motivo es el invariante y la latencia del primer visitante.

**Chequeo obligatorio antes de accionarla**, y es de página, no de módulo: si la ficha alguna vez
muestra algo de **otra** unidad («otros equipos de este vendedor», un contador de stock), sacarle
`storefront:{slug}` le sirve datos viejos de sus hermanas. Hoy `getStorefrontListing()` devuelve un
único `PublicListingDTO` y nada más, así que la respuesta es no — pero eso es una propiedad del
render, y lo confirma `storefront-agent` mirando la página, no yo mirando la query.

#### 6. Lo que S6 **no** midió, y con qué se cierra

| qué falta | ancho del hueco | cómo se cierra |
|---|---|---|
| wall time y CPU de una corrida vacía del cron | **4,8×** (USD 0,028 – 0,133/mes de piso) | `vercel crons run` en producción + gráfico de duración/CPU. No es medible en local: domina el cold start |
| el 39,4% es `[EST]`, no `[MEDIDO]` | el número entero | `e2e/_lib/s6-measure.ts` **ya calienta una ficha hasta `x-nextjs-cache: HIT`**. Extenderlo para reservar **otra** unidad y volver a pedir la primera convierte esto en medición en pocas líneas. Es el gate más barato que le queda pendiente a este documento |
| reparto 50/50 grilla/fichas y 25 reservas/mes/tenant | mueve el 39,4% linealmente | primera vidriera real con tráfico |
| Active CPU de las Server Actions de reservar/cancelar | despreciable por forma (2 `UPDATE`, sin imagen, sin LLM) | nunca se corrió; mismo hueco que `/api/track` en §7 |

#### 7. Delta de S6 y veredicto

```
Piso fijo (§1)  — cron */5, una corrida para todos los tenants
    invocaciones                                    USD 0,0052
    Provisioned Memory + Active CPU  [EST]          USD 0,023 – 0,128
                                                    ─────────────────
                                                    USD 0,028 – 0,133 /mes  (0,3 % del piso de 45)

Marginal por tenant (§2)
    ISR Writes por las +32 invalidaciones anchas     USD 0,0133
    invocaciones de esos renders fríos               USD 0,00013
    Server Actions reservar/cancelar (32/mes)        USD 0,00002
    filas nuevas (reservations ~25 + events ~10)     ~0   (ruido contra 8 GB)
    cron amortizado a 100 tenants                    USD 0,0003 – 0,0013
                                                    ─────────────────
                                    DELTA S6         USD 0,015 /tenant/mes
```

**Y la restatement del modelo, que es más grande que S6 y no es de S6.** Corregir ISR Writes de
«200 mutaciones × 15 units» (radio 1) a «962 renders fríos × 15 units» (radio 61) mueve el renglón
de **USD 0,012 a USD 0,058**, y eso es **anterior** a esta slice:

```
Base, pre-S6, modelo VIEJO   : 0,0018+0,0013+0,0016+0,0035+0,0056+0,0120+0,0024 = USD 0,030
Base, pre-S6, modelo CORREGIDO: mismos renglones con ISR Writes = 0,0577         = USD 0,074
Base, con S6                 : 0,074 + 0,0133 + 0,00002 + 0,0008                 = USD 0,088
Negocio, con S6              : 0,088 − 0,0024 (WAF Base) + 0,0034 (WAF Negocio)
                                     + 0,17 – 0,23 (LLM, R3)              = USD 0,259 – 0,319
```
(Con las 8 write units que midió §2.2.5 en vez del techo de 15 que usa §2, el renglón de ISR sería
0,031 y el Base 0,047. Se usa 15 por conservador, igual que el resto del documento.)

**Esta tabla es el estado del 2026-08-28 por la mañana, con radio 61. El estado vigente está en
§2.5.6** — la palanca se accionó esa misma tarde y las tres filas se movieron.

| | antes de S6, modelo viejo | antes de S6, **corregido** | con S6 (radio 61) | **HEAD, radio 2 (§2.5.6)** | objetivo | headroom hoy |
|---|---|---|---|---|---|---|
| Marginal **Base** | USD 0,030 | USD 0,074 | USD 0,088 | **USD 0,025 – 0,026** | 0,50 | **19×** |
| Marginal **Negocio** | USD 0,20 – 0,26 | USD 0,245 – 0,305 | USD 0,259 – 0,319 | **USD 0,196 – 0,257** | 1,50 (0,50 no-chat + 1,00 chat) | **5,8 – 7,6×** |
| % de hits de vidriera a Postgres | «1,3 %» | 32,1 % `[EST]` | 39,4 % `[EST]` | **4,6 %** (radio **MEDIDO**) | **5 %** | **adentro** |

**Ninguna meta de dinero se rompe. La que se rompe es la del vector de DB, y la palanca de §2.4.5
la devuelve a 4,7% — o sea, adentro.**

> **Nota sobre el objetivo del plan Negocio. RATIFICADA Y CERRADA (`ea26a02`, 2026-08-28.)** Esta
> auditoría la dejó como acotación abierta porque aflojar un objetivo es una decisión y no un
> cálculo. El LEAD la decidió: **Base ≤ 0,50 · Negocio ≤ 1,50, donde el 1,50 es 0,50 + hasta 1,00
> atribuible al chat**, y una slice de vidriera, panel o media se mide contra **0,50 aunque el
> tenant esté en Negocio**. Está en `ARCHITECTURE.md` §153 y `DECISIONS.md` §21-28, y en el
> §Objetivo de este documento. El corolario operativo es que el marginal va **atribuido**: ver
> §2.5.6.

**COST_VERDICT: PASS, con gate nombrado para la próxima slice de vidriera.**

El dinero pasa con margen en los dos planes. La alarma de «> 5% de hits a Postgres» **está
excedida, y lo estaba antes de S6 por un error de modelo de este documento**: cobrarle a S6 el
merge por una deuda que heredó sería teatro. Lo que sí se le imputa a S6 son los 7,3 puntos que
agrega y el hecho de haber traído la primera mutación cuya frecuencia **crece con las ventas del
tenant** — o sea, la que empeora justo cuando el producto funciona.

**Gate para la próxima slice que toque `(storefront)` o `storefront-cache.ts`:** las dos ediciones
de §2.4.5, juntas, más la medición de §2.4.6. **Una slice de vidriera que pase por encima de este
gate es FAIL de costo**, igual que S1 le dejó el gate de coalescing a S2.

> **CUMPLIDO en `f504d69` (S6.2), verificado el 2026-08-28.** Las dos ediciones se hicieron juntas
> —más una tercera que ninguna de las dos anticipaba: `page.tsx` era un **cuarto** registrante de
> tags y sin tocarlo el arreglo no movía el número que lo justificaba— y el radio dejó de estimarse:
> lo **cuenta** V9 de `accept-s6.sh`. Radio **2**, vector de DB **4,6%**. Detalle en §2.5.1. El gate
> no se retira: se convierte en el fallo automático permanente de §6 («radio > 2 = FAIL»).

#### 8. El orden de magnitud que relativiza toda esta sección

Todo el delta marginal de S6 es **USD 0,015/tenant/mes**. La comisión de Mercado Pago es
**~USD 1,03 por pagador por mes** `[UNVERIFIED]` (§7, B3): **69× el delta entero de S6** y **~23× el
marginal Base completo con S6 adentro**.

La palanca de §2.4.5 vale la pena **por el invariante y por la latencia del primer visitante**, no
por los USD 0,053/mes que ahorra. Y el que lea esta sección y salga queriendo mover el cron a
`*/15` para ahorrar USD 0,09/mes la leyó al revés: eso es exactamente el «costo tonto en la
dirección contraria» de §2.2.3.

### 2.5 Cerrado en la re-auditoría del 2026-08-28 (HEAD `68c0bd6`) — el barrido que se atraganta

> ## ⚠️ §2.5.2 a §2.5.5 son HISTORIA desde `b9a8e05`. El hallazgo está ARREGLADO en el código.
>
> Esta sección se escribió contra HEAD `68c0bd6`. **Se commiteó en `4f95937`, y para entonces
> `b9a8e05` ya había aterrizado R1–R4 completos**: la columna `sweep_attempts`, el
> `order by sweep_attempts asc, expires_at asc`, el techo `MAX_SWEEP_ATTEMPTS = 5`, el `+1` en su
> propia transacción, el censo de abandonadas y el **500** del route. Las aserciones A–E viven en
> `scripts/probes/s6-sweep-head-of-line.test.ts` y las corre **V10 de `accept-s6.sh`** contra
> Postgres real, con cuatro mutaciones de polaridad ejecutadas por el LEAD.
>
> **Eso invalida el número nuestro, no el del tenant.** Los USD 0,0015/mes por unidad trabada
> salían de 8.640 reintentos/mes: hoy son **5 reintentos, una sola vez**, y el costo nuestro cae a
> ~USD 1e-6 no recurrente. Los **USD 15 – 22/mes del tenant siguen en pie sin cambios**, porque la
> unidad sigue trabada en `reserved` hasta que una persona apriete «Liberar equipo» — lo que se
> arregló es que ahora **grita** en vez de callarse. La aritmética corregida está en §2.5.3.
>
> Se deja escrito en vez de borrado por la misma regla que el resto del documento: un doc de costo
> que borra sus errores deja de ser auditable. Pero **el estado es §2.6**, no esto.

Dos cosas en esta sección. La primera es una **corrección a mi favor que igual va escrita**: el
renglón más grande de §2.4 ya no existe, la palanca se accionó y el radio está **medido**. La
segunda es el hallazgo de §2.4.3 que quedó como métrica y nunca se cerró: lo cierro acá, con la
aritmética y con la aserción que lo mantiene arreglado.

#### 1. La palanca de §2.4.5 **se accionó**. El 39,4% de §0 y de §2 es historia, no estado.

Verificado contra el árbol de hoy, no contra el commit message:

```
apps/web/app/(app)/_lib/tenants/storefront-cache.ts:166-169
    invalidateStorefrontUnit()  →  emite [ storefront:{slug} , listing:{uuid} ]   (cayó tenant-config)
apps/web/app/(storefront)/_lib/listings.ts:532
    getStorefrontListing()      →  registra listing:{uuid}                        (cayó storefront:{slug})
apps/web/app/(storefront)/_lib/listings.ts:360
    getStorefrontCatalog()      →  registra storefront:{slug} + tenant-config:{slug}
apps/web/app/(storefront)/_lib/listings.ts:556  (listingMiss)
    el miss de la ficha         →  conserva storefront:{slug}, a propósito
```

Radio = **grilla + la ficha de esa unidad = 2**, que es exactamente lo que §2.4.5 pedía. Y no es
una lectura mía del fuente: `accept-s6.sh` V9 lo **cuenta** desde la línea `MEDIDO s6 radio` que
emite el e2e, con `esperado=2`, con controles anti-vacuidad (toda página en HIT antes de la
mutación, una sola request después, la request fría tiene que producir `statements > 0`) y con un
caso que **rechaza** el arreglo que baja el radio a cero rompiendo la invalidación. Corrida del
LEAD en `f504d69`: `rerender=2 · esperado=2 · sobrevivieron=[ficha-a,ficha-c,ficha-d]`.

**Recalculo el vector de DB con radio 2, misma fórmula de renovación de §2.4.4, mismos supuestos:**

```
I = 72 mutaciones/mes que emiten tag  ·  λ_grilla = 1.500/mes  ·  λ_ficha = 25/mes  ·  60 fichas
purgas que le tocan a cada ficha : 72 / 60 = 1,2 /mes

grilla : 1.500 × 72/(1.500+72)      =  68,7 misses
fichas :    60 × 25 × 1,2/(25+1,2)  =  68,7 misses     (techo grueso de §2.4.5: ≤ 72)
                                      ───────────────
                                       137,4 / 3.000  =  4,6 %      (techo: ≤141 = 4,7 %)
```

**El vector de DB queda en 4,6 % `[EST]`, bajo la alarma de 5 %.** Era 39,4%. Se usa el techo
**4,7 %** en las tablas, por conservador.

```
ISR Writes con radio 2 : ≤141 renders fríos × 15 write units × USD 4,00/1M = USD 0,0085 /tenant/mes
                         (era 0,071 con radio 61 — cae 8,4×, que es el mismo factor del radio)
```

> **Corrección de aritmética de este documento.** §2.4.5 dice que la palanca lleva ISR Writes de
> «0,071 → 0,018». **El 0,018 no sale de su propia fórmula**: `141 × 15 × 4,00/1M = 0,0085`, y para
> llegar a 0,018 harían falta ~300 renders fríos, que no aparecen en ningún cálculo de esa sección.
> Vale el 0,0085. Es un error mío, chico y en la dirección conservadora, y queda escrito porque la
> alternativa —corregirlo en silencio— es cómo un documento de costo deja de ser auditable.

#### 2. El hallazgo de §2.4.3 sigue vivo. Verificado contra el código de hoy, no repetido de memoria.

`398fff7` («the closing status comes from the domain, not a literal») **no tocó este archivo**:
`git log -- expire-reservations.ts` termina en `83bc673` (S6.1). Lo que cambió esta semana fue
`reserve-unit.ts`, su hermano del panel. El barrido está tal cual, y lo que sostiene el hallazgo
son cuatro hechos del fuente, todos verificables en una lectura:

1. **La clave de orden no cambia cuando la fila falla.** El `select` es
   `where status='active' and expires_at <= now order by expires_at asc limit 200`. Una fila que
   tira deja la transacción rolleada: sigue `active`, con el mismo `expires_at` en el pasado. Por
   `asc`, es **la primera de la próxima corrida, y de la siguiente, para siempre**.
2. **No hay dónde anotar que ya falló.** `packages/db/src/schema/commerce.ts` — `reservations`
   tiene `id · tenant_id · listing_id · status · minutes · expires_at · customer_label ·
   created_by · closed_at · created_at · updated_at`. **Ninguna columna de intentos.** Sin estado,
   no hay forma de distinguir el primer fallo del octomilésimo.
3. **El `try/catch` es por fila y está dentro del loop**, así que `expireDueReservations()` nunca
   propaga. El único `catch` del route rodea la llamada entera y sólo se dispara si tira el
   `select`. Consecuencia exacta: **una corrida donde fallan las 200 filas devuelve `200 OK`**, con
   `{ ok: true, scanned: 200, expired: 0, failed: 200 }`. Para el dashboard de Vercel Cron es
   idéntica a una corrida perfecta.
4. **El test que parece cubrirlo, no lo cubre.** `expire-reservations.test.ts` tiene
   *«una fila podrida no frena el barrido → cuenta el fallo, loguea el id y sigue con la
   siguiente»*, y pasa (13/13, corrido hoy). Afirma la resiliencia **dentro de una corrida**.
   El hallazgo es **entre corridas**, y no hay un solo test que ejecute el barrido dos veces.
   Es el peor tipo de cobertura: la que tranquiliza sobre el eje equivocado.

**Y el framing de §2.4.3 estaba mal calibrado, así que lo corrijo.** Ahí escribí «si alguna vez
hubiera 200 de ésas». Pedir 200 filas rotas *independientes* es pedir algo que este producto no
va a ver: a 100 tenants el barrido atiende ~33 expiraciones/día (§2.4.2). Pero el modo de falla
real no es «200 filas rotas», es **una causa sistémica que envenena el 100% de las filas de una**,
y para eso el número de filas es irrelevante — con dos filas debidas y las dos fallando, el
producto ya no vence nada. Las causas están todas nombradas en las reglas de este repo:

| causa | SQLSTATE | qué la dispara | por qué no la ve CI |
|---|---|---|---|
| tabla sin `GRANT` para `service_role` | `42501` | una migración nueva; los DEFAULT PRIVILEGES están revocados (`CLAUDE.md` §2) | *«el síntoma no aparece en CI: aparece el día que se prende el cron»* — textual, `CLAUDE.md` §3 |
| migración editada después de aplicada | `23514` / `22P02` | la trampa del `created_at` de Drizzle (`CLAUDE.md` §3) | en CI la base nace limpia |
| check/NOT NULL nuevo en `listing_events` | `23502` / `23514` | el `insert` del barrido escribe 5 columnas y ninguna la elige el barrido | ningún test corre el barrido contra Postgres real |
| lock retenido por el panel | `55P03` / timeout | el dueño con una transacción abierta | no es determinista, pero se repite |

Las tres primeras son **deterministas**: fallan igual en la corrida 1 y en la 8.640.

#### 3. Cuánto cuesta, en plata y en producto

**En plata nuestra: nada, y ése es exactamente el problema.** *(Aritmética de `68c0bd6`. Corregida
para HEAD abajo — el arreglo cambió el multiplicador de 8.640 a 5.)*

```
corridas            : */5 → 288/día → 8.640/mes                             (§2.4.1, sin cambio)
costo de una corrida: (USD 0,028 – 0,133) / 8.640 = USD 3,2e-6 – 1,5e-5     [EST]
por fila envenenada : 8.640 intentos/mes, cada uno 2 UPDATE + rollback
CPU extra por fila  : 8.640 × [EST] 5 ms = 43,2 s = 0,012 CPU-h × 0,128  =  USD 0,0015 /mes
líneas de log       : 8.640 `reservation.expire.failed` idénticas /mes /fila
```

**USD 0,0015 por mes por unidad trabada.** Nuestro presupuesto no se entera nunca: haría falta que
se trabaran **330 unidades a la vez** para gastar lo que gasta el chat de **un** tenant en un mes.
Un gate de dinero no puede detectar esto, y por eso este renglón no se defiende con el objetivo de
§Objetivo: se defiende con la métrica de §5.

**Corregido contra HEAD `6952393` — el multiplicador dejó de ser 8.640 y pasó a ser 5.**
`MAX_SWEEP_ATTEMPTS = 5` está en el `where` del `select`, así que pasado el tope **la fila deja de
entrar al lote**. Ya no hay reintento recurrente:

```
por fila envenenada : 5 intentos, UNA sola vez en la vida de la fila   (era 8.640/mes)
CPU extra por fila  : 5 × [EST] 5 ms = 25 ms = 6,9e-6 CPU-h × 0,128 =  USD 0,0000009  no recurrente
líneas `expire.failed` : 5 por fila, una sola vez                       (eran 8.640/mes)
censo de abandonadas: query INCONDICIONAL, corre igual con la base sana → ya está en el piso fijo,
                      una unidad trabada NO agrega trabajo de DB después del quinto intento
línea de log residual: +1 por corrida mientras `abandoned > 0` (el `swept` que una corrida vacía no
                      emitiría, y el `degraded` del route en vez del `done`) = 8.640/mes /base
```

**El costo nuestro por unidad trabada cae de USD 0,0015/mes recurrentes a ~USD 1e-6 una sola vez.**
Queda una línea de log por corrida mientras haya una unidad abandonada, y eso **es la feature**: es
el ruido que hace que alguien mire. **Los USD 15 – 22/mes del tenant no cambian** — el arreglo no
libera la unidad, la deja de reintentar y avisa. Sigue haciendo falta que una persona apriete
«Liberar equipo».

**En producto, que es donde sí cuesta.** Una unidad trabada es una unidad que existe, que el dueño
tiene en la mano, y que su único canal de venta muestra como no comprable:

- **Vidriera** (`(storefront)/_lib/status.ts`, caso `'reserved'`) — **este renglón decía otra cosa
  hasta `7c1cc49` y el cambio baja el costo, así que se reescribe.** Decía que el copy prometía
  *«si la reserva se cae, avisamos»* y que el CTA se degradaba a *«Preguntar por WhatsApp si se
  libera»*. **Las dos cosas se fueron.** Hoy el detalle dice que otra persona lo reservó, que una
  reserva a veces se cae, que **no hay lista de espera** y que si lo querés igual se lo digas al
  vendedor **ahora**; y el CTA es *«Lo quiero igual — escribir por WhatsApp»*, el mismo verbo que
  `available` con un «igual» adelante. La regla que dejó el commit es más ancha que el caso:
  *ningún texto de la vidriera compromete una acción futura nuestra*. Efecto sobre este hallazgo:
  una unidad trabada **dejó de ser una promesa incumplida repetida una vez por pageview** y pasó a
  ser un pedido de conversación. Sigue sin poder señarse; ya no gasta la reputación del reseller en
  su propio dominio cada vez que alguien abre la ficha.
- **Panel** (`_lib/reservations/presentation.ts`) — **también reescrito, por R4 en `b9a8e05`.**
  Decía **«venció, se libera en unos minutos»** mirando sólo el reloj, o sea para siempre, que era
  la peor mitad del hallazgo: la UI le decía al dueño que no hiciera nada exactamente en el caso en
  que lo único que arregla el problema es que él apriete el botón. Hoy hay **dos** textos y los
  separa `SWEEP_GRACE_MINUTES = 15` (tres corridas del cron): dentro de la ventana sigue diciendo
  que se libera solo —y es verdad—, y pasada la ventana **nombra el botón** «Liberar equipo», que
  está en la misma fila y es reversible. No lee `sweep_attempts` y no hace falta: pasado el tiempo
  en que el cron debió haber barrido, apretar el botón es la respuesta correcta en los dos
  escenarios.
- **Base** (`reservations_one_active_per_listing`, índice único parcial sobre `status='active'`):
  mientras esa fila viva, **no se puede crear otra reserva para esa unidad**. El comprador real que
  aparece no puede ser señado.

Cuantificado con los supuestos de §2 (60 listings publicados, ~18 ventas/mes) y el precio de
ejemplo de `CLAUDE.md` §1 (iPhone 14 Pro a USD 620):

```
probabilidad mensual de venta de una unidad publicada : 18/60 = 30 %
margen bruto del reseller por equipo  [EST, no medido]: 8 – 12 % × USD 620 = USD 50 – 74
costo esperado de UNA unidad trabada un mes           : 0,30 × (50 – 74)  = USD 15 – 22 /mes
```

**USD 15 – 22 por mes, para el tenant, por una unidad. El plan Base cuesta USD 19.** O sea: **una
sola unidad trabada le come al reseller el equivalente al abono entero**, mientras a nosotros nos
cuesta USD 0,0015. La asimetría es de **~10.000×** y toda cae del lado del cliente. Y el costo de
verdad no es ése: es que el software le prometió por escrito, en dos pantallas distintas, que eso
se resolvía solo. **Eso no se factura, se cancela.** Un tenant que churnea son USD 19/mes
recurrentes, que es **730× el marginal de infra completo de ese tenant** (§2.5.5).

#### 4. La recomendación. No la implemento: `apps/web/app/(app)/**` es de `app-agent`.

Cuatro cambios, en orden de cuánto compran. **El 1 habilita al 2 y al 3**; el 4 es el que convierte
una pérdida invisible en un ticket de soporte.

**R1 · `db-agent`** — una columna en `reservations`:
```sql
sweep_attempts  integer not null default 0
```
Con su `GRANT` explícito para `service_role` (`CLAUDE.md` §2: tabla/columna nueva sin GRANT no la
lee nadie) y con el cuidado de la trampa del `created_at` de Drizzle: si la migración se edita
después de aplicada, la base de desarrollo nunca recibe la corrección y `migrate` dice `OK`.
**No una tabla de dead-letter**: una tabla nueva cuesta migración + GRANT + policy + un lector que
nadie va a escribir; un contador sobre una fila que ya existe cuesta cero.

**R2 · `app-agent`** — la fila envenenada pierde su lugar en la fila:
```
order by sweep_attempts asc, expires_at asc
where  status='active' and expires_at <= now and sweep_attempts < MAX_SWEEP_ATTEMPTS
```
y el `+1` se escribe **en su propia transacción**, no dentro de la que falló — si va adentro se
rollea con ella y el contador nunca avanza, que es la forma más fácil de escribir este arreglo mal.
`MAX_SWEEP_ATTEMPTS = 5` `[EST]`: generoso para que una carrera perdida contra el dueño cancelando
desde el panel (`40P01`) nunca llegue al tope, y chico para que una fila determinista deje de
costar 8.640 intentos/mes y pase a costar 5, una sola vez.

**R3 · `app-agent`** — el route deja de mentirle a Vercel Cron. **El predicado importa más que el
código**: `failed > 0` a secas es el predicado equivocado. A 0,12 expiraciones por corrida la
mayoría de las corridas no vacías traen **una** fila, así que una sola carrera perdida pintaría el
cron de rojo, y un cron que se pone rojo con la contención normal enseña a ignorar el rojo — el
mismo error que este repo ya cometió con los gates vacuamente verdes, del otro lado. El predicado
correcto es **cross-run, y R1 lo hace posible sin estado nuevo**:

> **500 si alguna fila de esta corrida falló teniendo ya `sweep_attempts >= 1`.**

Una fila que falla dos veces no es una carrera perdida. Y cuando una fila cruza el tope, **una**
línea, una sola vez en su vida: `logEvent('reservation.expire.quarantined', { reservationId,
tenantId, attempts })`. Eso reemplaza 8.640 líneas idénticas por mes con 5 más una — el mismo
argumento que el propio route ya aceptó para `misconfiguredLogged`, aplicado a la otra punta.

**R4 · `app-agent`** — el copy del panel deja de prometer lo que el sistema ya no hace.
`reservationCountdown()` dice «venció, se libera en unos minutos» mirando **sólo** el reloj. Con
R1 puede mirar también el contador: en cuarentena, la línea tiene que decir que **no** se liberó
sola y que hay que soltarla a mano. El botón ya está en pantalla; lo que falta es que el texto de
al lado deje de desaconsejar apretarlo. **Sin R4, R1–R3 arreglan la métrica y no arreglan la
unidad**: alguien tiene que ir y soltarla, y el único que puede es el dueño.

**Lo que NO hay que hacer**, porque es costo tonto en la dirección contraria:
- **Bajar `EXPIRE_BATCH_SIZE`.** No es la variable. La capacidad es 1.745× la demanda a 100 tenants
  (§2.4.3); el problema es que una fila conserva su lugar, no que el lote sea grande.
- **Reintentar dentro de la misma corrida.** Contra un error determinista es una segunda
  transacción facturada con el mismo resultado; contra un deadlock vuelve a entrar al mismo ciclo
  de locks — lo dice el docblock del propio módulo.
- **Un worker que vigile el cron.** Es literalmente el «worker 24/7» que `CLAUDE.md` §3 prohíbe.
  La señal es el exit code del cron, que ya existe y es gratis.
- **Subir la frecuencia del cron** «para que se recupere antes». Una fila envenenada falla más
  rápido, nada más.

#### 5. La aserción. Qué se **cuenta** — porque un gate afirma una conducta medida, nunca un identificador

Este documento ya vio cómo se arruina esto: V5 de `accept-s6.sh` se llamaba «no purga la vidriera
entera» y ejecutaba un `grep` de `invalidateStorefrontUnit`, y acompañó el defecto de S6.2 de punta
a punta en verde. Así que acá no se propone buscar `sweep_attempts` en ningún archivo. Se propone
**correr el barrido más de una vez y contar filas**.

**Aserción A — la que cierra el hallazgo, y es un número que hoy vale 0.**

> Fixture: `EXPIRE_BATCH_SIZE` filas vencidas cuya escritura tira `23514` (determinista) **más una
> fila sana**, todas vencidas, la sana la más nueva. Se corre el barrido **dos veces**.
> **Se cuenta: cuántas filas sanas venció la corrida 2.**
> Hoy vale **0** — las 200 envenenadas siguen siendo las primeras. Tiene que valer **1**.

Es la afirmación exacta del hallazgo, es un entero, y **no se puede satisfacer con un grep** ni
renombrando nada.

**Aserción B — el tope existe y frena.** Sobre una sola fila `23514`, corriendo el barrido
`MAX_SWEEP_ATTEMPTS + 3` veces: **intentos de escritura contra esa reserva == `MAX_SWEEP_ATTEMPTS`**
(hoy: crecen linealmente con las corridas, sin techo), y **líneas de log de esa fila == tope + 1**.

**Aserción C — la polaridad, sin la cual B se aprueba no barriendo nada.** Dos filas, dos SQLSTATE,
expectativas opuestas en la **misma** corrida:
- `23514` (determinista) → cuarentena al llegar al tope.
- `40P01` (carrera perdida) → **se reintenta en la corrida siguiente**; una fila puesta en
  cuarentena por perder un lock deja una unidad trabada por el motivo que el arreglo vino a evitar.
- y en las mismas corridas, **`sanas_vencidas == sanas`**. Sin este control, «cero intentos» pasa
  el gate rompiendo el barrido entero, que es el modo de fallo que V9 ya tuvo que cubrir con su
  caso que rechaza el radio cero.

**Aserción D — el status HTTP, contado, no razonado.** Dos códigos en la misma medición:
- corrida con una fila que falla **por segunda vez** → **500**.
- corrida con una fila que falla **por primera vez** y otra que sí venció → **200**.

Sin la segunda mitad, «devolver 500 si algo falló» pasa el gate y produce un cron rojo permanente.

**Aserción E — el `skipped`, que `398fff7` volvió posible y hoy es inalcanzable.** El barrido tiene
un segundo sumidero silencioso: `transition === null || closesAs === null → skipped`, que **no
loguea nada por fila**. Hoy es inalcanzable por construcción — sobre una fila `active` con
`expires_at <= now`, `expireReservation()` siempre devuelve `reserved → available` y
`closingStatusFor('reserved','available','expire')` siempre devuelve `'expired'` — y por eso **no
es un defecto**. Pero es una línea de `packages/domain/src/listing-status.ts` de distancia: si esa
tabla dejara de responder para la arista del cron, **todas** las corridas quedarían en
`scanned: N, skipped: N, 200 OK` y **sin una sola línea de log por fila**, o sea peor que el caso
`failed`. Se cuenta: **`skipped` sobre filas que el propio `where` del barrido declaró vencidas
== 0**.

**Dónde vive y qué cuesta.** No necesita Postgres, ni build, ni el puerto 3100: el `tx` falso que
ya usa `expire-reservations.test.ts` alcanza para las cinco aserciones. Va en la columna del LEAD
(`scripts/probes/`, junto a `s6-cron-fail-closed.test.ts`, que ya espía este mismo barrido para
probar un orden), **no** en `apps/web`: `CLAUDE.md` §4 — la auditoría de referencia no puede ser
del mismo writer que el código que audita. La copia de `app-agent` se queda como red de regresión
y ningún gate la cita.

Línea de medición sugerida, en la convención del repo:
```
MEDIDO cron barrido · corridas=<K> · envenenadas=<N> · sanas=<N> · sanas_vencidas_c2=<N>
 · intentos_23514=<N> · intentos_40P01=<N> · tope=<N> · lineas_log_por_envenenada=<N>
 · skipped_sobre_vencidas=<N> · status_segundo_fallo=<código> · status_primer_fallo=<código>
```
El gate lee los campos y compara enteros. Ninguno de ellos se puede producir sin ejecutar el
barrido dos veces.

#### 6. El objetivo marginal, revisado contra el árbol de hoy

Se adopta la forma **por plan**, que el LEAD ya ratificó en `ARCHITECTURE.md` §153 y `DECISIONS.md`
§21-28 y que §2.4.7 dejó como «acotación abierta»: **la acotación está cerrada**. Y la forma
importa más que el número: `Negocio ≤ 1,50` **no** es una vara más floja para las mismas cosas.
Todo lo que no es chat se mide contra **0,50** aunque el tenant esté en Negocio; el chat tiene
**1,00** propio. Un número por tenant que no dice qué parte es chat no se puede comparar contra
ninguno de los dos techos, así que va atribuido:

```
NO-CHAT (vidriera + panel + media + WAF + cron amortizado), por tenant/mes
    R2 storage                                      0,0018   [MEDIDO S2]
    R2 Class A (writes)                             0,0013   [MEDIDO S2]
    R2 Class B (reads)                              0,0016   [EST]
    Active CPU de `sharp` en el upload              0,0035   [CPU MEDIDO, precio UNVERIFIED]
    upload: memoria + invocaciones + transferencia  0,0056   [EST]
    ISR Writes — radio 2, ≤141 renders fríos        0,0085   [radio MEDIDO, tráfico EST]
    Server Actions reservar/cancelar (32/mes)       0,00002
    WAF Rate Limit (Base 0,0024 / Negocio 0,0034)   0,0024
    cron */5 amortizado a 100 tenants               0,0003 – 0,0013
                                                   ─────────────────
                                        Base        USD 0,025 – 0,026     contra 0,50  →  19×
                                        Negocio     USD 0,026 – 0,027     contra 0,50  →  18×

CHAT (sólo Negocio) — REEMPLAZADO por §2.6. El renglón viejo era la tarifa en el TECHO de la dieta:
    [viejo] 1.200 msgs × USD 0,000144 – 0,000192    USD 0,17 – 0,23       contra 1,00  →  4,3 – 5,9×
    esperado [CALC-STUB] 1.200 × 0,00008002         USD 0,096             contra 1,00  →   10,4×
    techo  [ESTRUCTURAL] 1.200 × 0,000192           USD 0,230             contra 1,00  →    4,3×
    HOY EN PRODUCCIÓN                               USD 0,00   — nada invoca `@istock/ai` (§2.6.4)

TOTAL Negocio  esperado  0,026 + 0,096            = USD 0,122             contra 1,50  →   12,3×
               techo     0,027 + 0,230            = USD 0,257             contra 1,50  →    5,8×
```

> **El renglón `techo` de arriba quedó viejo el 2026-08-28 (§2.7).** `0,230` cuenta **una** llamada
> al proveedor por mensaje, y un turno que usa la tool `get_open_listing` hace **dos**, las dos
> facturadas y cada una con su propio `MAX_OUTPUT_TOKENS`. El techo vigente del chat es
> **USD 0,4608/mes** al soft cap y el **TOTAL Negocio techo es USD 0,488 → 3,1×**. El `esperado`
> tampoco es tranquilizador tal como está: `0,096` vale para la fracción **cero** de turnos con
> tool, porque el corpus de la eval no ejercita ninguna, y el chatbot existe para llamar la tool.
> Con la fracción en 100% el esperado es **USD 0,2077/mes** (§2.7 §3). Los dos números están
> marcados como lo que son.

**El renglón viejo no estaba mal: estaba en el techo.** `0,000192` es exactamente la cota superior
por construcción que §2.6.3 vuelve a derivar de las dos aserciones del código. Lo que aporta la eval
no es un techo más bajo —el techo no se movió— sino un **esperado**, que es la mitad. Por eso el
`TOTAL Negocio` conserva `0,257` como cota y agrega `0,122` como valor esperado, en vez de
reemplazar uno por otro.

**Base cae de USD 0,088 a USD 0,025 – 0,026, y no porque se haya agregado nada barato: porque el
radio de invalidación pasó de 61 a 2 y con él ISR Writes de 0,071 a 0,0085.** Es el 62% del
marginal Base de la semana pasada, borrado por dos ediciones de una línea cada una.

**Lo que se agregó esta semana, auditado renglón por renglón:**

| commit | qué agrega | delta de costo | por qué |
|---|---|---|---|
| `f504d69` S6.2 | radio de invalidación 61 → 2 | **−USD 0,062 /tenant/mes** | el renglón más grande del Base, borrado |
| `1fc0e59` media/incidentes | `variantUrl` devuelve un centinela en vez de tirar | **≤ 0, probablemente < 0** | un throw adentro de un render cacheado cuelga el stream de una página ya medio enviada: eso es wall time y memoria provisionada **facturados** hasta el `maxDuration`. Dejar de tirar saca un modo de falla que se paga por request |
| `c43bfaf` vidriera/fotos | omite la foto no servible; ficha sin fotos publica igual | **≤ 0** | menos bytes servidos, nunca más. La ficha de cero fotos sirve **0 KB** de imagen |
| `c43bfaf` `reportMediaIncident` | una línea de log por foto omitida | **~0** | corre **adentro** de `photosByListing`, o sea dentro del `'use cache'`: se paga por **render frío** (≤141/mes/tenant), no por pageview. Si estuviera afuera del cache serían 3.000/mes/tenant y sería un renglón |
| `1fc0e59` reporter | `setMediaIncidentReporter` **sin cablear** en `apps/web` | 0 | el default es `console.warn`, acotado igual por el cache. Cablearlo a Sentry es de la columna de app y no tiene fila en el board |
| `398fff7` reserve-unit | el estado de cierre lo deriva del dominio | 0 | mismo número de escrituras |
| `f691daf` V9 + `guard-gates` | gates que cuentan en vez de grepear | 0 en infra | corren en CI sin base ni build |

**Ninguna línea de esta semana agrega un vector de costo.** Una lo borra, dos lo bajan y el resto
es neutro. **La semana es neta negativa en costo y positiva en evidencia**, que es la combinación
que este documento quiere premiar.

#### 7. Veredicto

```
COST_VERDICT: PASS

DELTA_POR_TENANT_MES:  Base    USD 0,025 – 0,026   (era 0,088; el radio de invalidación pagó la diferencia)
                       Negocio USD 0,196 – 0,257   (no-chat 0,026 + chat 0,17 – 0,23)
   no-chat  0,0018+0,0013+0,0016+0,0035+0,0056+0,0085+0,00002+0,0024 = 0,0247  (+0,0003–0,0013 de cron)
   chat     1.200 msgs × USD 0,000144 – 0,000192                     = 0,17 – 0,23
   [2026-08-28] el renglón de chat era la TARIFA EN EL TECHO. Con la eval de §2.6 el esperado es
   0,096 y el techo sigue siendo 0,230 → Negocio esperado USD 0,122 / techo USD 0,257.
   [2026-08-28, §2.7] rehecho con el corpus que mide turnos con tool: esperado 0,114, techo con
   tool 0,461 → Negocio esperado USD 0,140 / techo USD 0,488. VIGENTES estos dos.

SUPUESTOS: 3.000 pv/mes/tenant · 50% grilla / 50% fichas · 60 listings publicados · 4 fotos/listing
           · 25 reservas/mes/tenant, 18 terminan en venta · 40 msgs/día de chat (soft cap) · 100 tenants

VECTOR_MAS_RIESGOSO: [OBSOLETO — ver §2.6.8 para el vigente] el cron — y no por lo que cuesta
           (USD 0,0015/mes por unidad trabada) sino por lo que **no** cuesta: es el único vector del
           producto cuya falla total es indistinguible de su éxito total desde afuera (`200 OK` con
           `failed: 200`), y cuyo precio lo paga íntegro el tenant (USD 15 – 22/mes por unidad,
           ≈ el abono del plan Base) mientras nuestra factura no se mueve.
           → `b9a8e05` cerró esto: el route devuelve **500** con `stuck`/`unrecorded`/`abandoned`,
             así que la falla ya NO se parece al éxito. **El vector más riesgoso pasó a ser el soft
             cap del chat sin contador (§2.6.8)**, que tiene la misma forma —un techo que se cree
             puesto y no lo está— pero esta vez la factura sí es nuestra.

METRICA_A_VIGILAR: [OBSOLETA — ver §5 y §2.6.8] **corridas consecutivas de
           `cron.expire_reservations.done` con `scanned > 0` y `expired + released == 0`.**
           Alarma en ≥ 2 (10 minutos). Cerraba con «hoy no la emite nadie».
           → Ya la emite alguien y mejor: `stuck` y `unrecorded` de
             `cron.expire_reservations.degraded` dicen lo mismo **en una sola corrida**, porque
             `sweep_attempts` permite distinguir la primera falla de la segunda. La métrica vigente
             del documento es **mensajes de chat por tenant por día**, que hoy no existe.
```

**Este PASS no cierra el hallazgo: lo cierra R1–R4 con las aserciones A–E.** El hallazgo no rompe
el objetivo de dinero y nunca lo iba a romper — la plata es USD 0,0015 por unidad trabada. Bloquear
un merge por eso sería teatro. Lo que se pide es una **fila en el board con dueño**: `db-agent` la
columna, `app-agent` la query, el status y el copy del panel, el LEAD la probe.

> **CERRADO, y antes de que este párrafo se escribiera.** `b9a8e05` implementó R1–R4 completos y
> `2ad4fd7` aterrizó A–E como `scripts/probes/s6-sweep-head-of-line.test.ts`, que corre **V10 de
> `accept-s6.sh`** contra Postgres real — con cuatro mutaciones de polaridad ejecutadas por el LEAD
> (`order by expires_at` a secas → cae A; sin techo en el `where` → cae B; `degraded = false` → cae
> F; el `+1` que no avanza → cae A), cuatro rojos **distintos**, o sea ninguna aserción colgada de
> otra. Es exactamente lo que §2.5.5 pidió: se **cuenta**, no se grepea. Nada que hacer.

Y queda como
**gate de la próxima slice que toque `_lib/reservations/**` o el route del cron**: si esa slice
pasa por encima de A–E, es **FAIL de costo**, con la misma vara que S1 le dejó el coalescing a S2 y
que §2.4.7 le dejó la palanca del radio a S6.2 — palanca que, dicho sea de paso, **se accionó y se
midió**, que es la razón por la que este documento puede hoy afirmar 4,6% donde afirmaba 39,4%.


### 2.6 Auditado el 2026-08-28 (HEAD `6952393`) — `packages/ai`, y el techo que lo sostiene

`packages/ai` **existe desde `d42fac9`, o sea desde después de todo lo que este documento decía
sobre el chatbot.** Hasta hoy el renglón de chat era una tarifa multiplicada por los techos de la
dieta; ahora hay un corpus, un runner y un número. Esta sección lo verifica, lo compara contra el
objetivo y contesta la pregunta que el número solo no contesta.

**Antes que nada, el asterisco que vale por toda la sección: B4 está abierto.** No hay credenciales
de Gemini ni de Groq, así que la eval corre con el driver `stub` y **nadie facturó un token todavía**.
Lo que sigue es **calculado, no facturado**: aritmética buena sobre consumo simulado. Un número
medido contra un stub es una estimación con buena aritmética, y se marca `[CALC-STUB]` para que no
se lea como `[MEDIDO]`. Lo que **sí** es estructural —y no depende del stub— está marcado aparte.

#### 1. Verificación del precio: el hardcode coincide con el research, entrada por entrada

Era el primer lugar donde esto podía estar podrido, porque una tabla de precios en el código es un
número que envejece en silencio. Contrastado `packages/ai/src/pricing.ts` contra
`docs/research/llm-pricing.md` `[R3]`:

| modelo | `pricing.ts` (in / out por 1M) | `llm-pricing.md` | ¿coincide? |
|---|---|---|---|
| `gemini-2.5-flash-lite` | 0.10 / 0.40 | 0.10 / 0.40 (§13, §39, §114) | ✅ |
| `gemini-3.1-flash-lite` | 0.25 / 1.50 | 0.25 / 1.50 (§16, §40, §115) | ✅ |
| `gemini-3.5-flash-lite` | 0.30 / 2.50 | 0.30 / 2.50 (§16, §41, §116) | ✅ |
| `openai/gpt-oss-20b` | 0.075 / 0.30 | 0.075 / 0.30 (§21, §152, §190) | ✅ |
| `openai/gpt-oss-120b` | 0.15 / 0.60 | 0.15 / 0.60 (§153) | ✅ |

**Cinco de cinco.** No hay discrepancia y por lo tanto no hay hallazgo acá — se deja la tabla
escrita igual, porque la próxima vez la pregunta se contesta comparando dos columnas y no leyendo
dos archivos. Dos propiedades del módulo que además están bien y son de costo, no de estilo:

- **`priceFor()` devuelve `null` para un ID desconocido**, y `costPerThousandMessages()` propaga el
  `null` en vez de asumir cero. *«Ausencia de medición no es cero»* está en el código, no en un
  comentario. Un ID nuevo por env var —que es como se eligen los modelos acá (`CLAUDE.md` §3)—
  produce «sin tarifa conocida» y no un reporte de costo falsamente barato.
- **La tabla traduce, no elige.** No contradice la regla de que el ID va por env.

#### 2. La aritmética, reproducida sin copiar el número

```
$ pnpm --filter @istock/ai eval          # HEAD 6952393, driver stub, sin red
```

El runner imprime percentiles pero **cobra por el promedio**, así que el promedio se extrajo del
reporte y la cuenta se rehizo a mano contra `PRICE_PER_MTOK`:

```
turnos del corpus            : 174        (87 casos × 2 formas de conversación)
turnos que llegan al modelo  : 130        → tasa facturable 130/174 = 0,747126
tokens IN  promedio (de los 130)  : 991   (p50 1013 · p95 1078 · max 1083 · techo 1200)
tokens OUT promedio (de los 130)  :  20   (p50 21 · p95 35 · max 36 · techo 180)

USD / 1000 mensajes FACTURADOS
    991 tok × USD 0.10/1M × 1000  = 0,0991
     20 tok × USD 0.40/1M × 1000  = 0,0080
                                    ──────
                                    0,1071      ✅ coincide con el runner

USD / 1000 mensajes DE VIDRIERA (el denominador correcto: incluye los que no llegan al modelo)
    0,1071 × 0,747126            = 0,08002      ✅ coincide con el runner
```

> **Re-medido el 2026-08-28 por `cost-auditor` (§2.7), corriendo la eval yo, no copiando el número.**
> Los valores de este bloque eran `995 / 1017 / 1082 / 1087 / 0,1075 / 0,08032`. Bajaron porque la
> sanitización de S8 pasó a envolver **todo** el texto del dueño en un solo par de delimitadores en
> vez de uno por campo, y con eso se fue una línea de encabezado del bloque de ficha: **−4 tokens de
> promedio**. Ninguna conclusión de §2.6 cambia por esto; lo que sí cambia, y es de §2.7, es que
> **este bloque no mide los turnos que llaman una tool** — el corpus no ejercita ninguno.

**Los dos números del reporte son correctos y el reparto entre ellos también.** Verifiqué la trampa
que habría inflado el descuento: `runEval()` filtra `billed` **antes** de calcular el promedio de
tokens (`harness.ts`), así que los 44 turnos derivados no entran al promedio como ceros. Si
entraran, el descuento del 25,3% se aplicaría **dos veces** y el número saldría ~25% más barato de
lo real. No pasa.

**Discrepancia menor con lo que reportó `ai-agent` en su día:** decía **USD 0,094/mes** por tenant
al soft cap. La cuenta exacta con los números de hoy es `1.200 × 0,08002/1000 = ` **USD 0,0960/mes**.
Lo anoto porque el objetivo de este documento es que los números se puedan rehacer: **0,0960 es el
que se usa acá.**

#### 3. El techo que NO depende del stub — y es lo mejor que tiene esta slice

`avgOut = 20` lo produjo el stub, no Gemini. Es el término más débil de todo lo anterior: un modelo
real es perfectamente capaz de contestar con 150 tokens donde el stub contestó con 20. Así que el
número que importa no es el promedio simulado sino **la cota superior por construcción**, que sale
de dos aserciones del código y de ninguna medición:

- **IN ≤ 1200**: `assertWithinBudget()` **tira** `AI_BUDGET_EXCEEDED` si el prompt armado se pasa, y
  `chat.ts` no tiene un solo camino al proveedor que la saltee. No se recorta en el proveedor: se
  recorta acá o no se manda.
- **OUT ≤ 180**: `env.maxOutputTokens` viaja en el `LlmRequest` que arma `requestFor()` (`chat.ts`) y `env.ts` lo valida
  con `tokenCeiling(MAX_OUTPUT_TOKENS)` — **la env puede bajarlo, nunca subirlo.**
- Y `countTokens()` es un estimador **deliberadamente conservador** (3 chars/token contra los 3,5–4,5
  de un BPE real), con la dirección del error fijada como invariante en `tokens.test.ts`. Sobrecontar
  es la falla segura: si nuestro contador dice 1200, el tokenizador real dice menos.

```
peor mensaje posible, con la dieta enforced y la tarifa del primario:
    1200 tok IN  × USD 0.10/1M  = 0,000120
     180 tok OUT × USD 0.40/1M  = 0,000072
                                  ────────
                                  0,000192  USD / mensaje facturado          [ESTRUCTURAL]
```

**Ningún mensaje de este chatbot puede costar más de USD 0,000192 mientras esas dos aserciones
sigan en el código, con o sin credenciales.**

> ⚠️ **Corregido en §2.7: la frase de arriba vale para un turno de UNA llamada, y hay turnos de
> dos.** Un turno que usa la tool `get_open_listing` manda el prompt entero **otra vez** con el
> resultado adentro, y las dos llamadas se facturan, cada una con su propio techo de salida. El
> techo real de un mensaje es `2 × 1200 IN + 2 × 180 OUT = ` **USD 0,000384**, y lo que lo acota no
> son dos aserciones sino **tres**: la tercera es `MAX_TOOL_ROUNDS = 1`. Sigue estando 2,2× abajo
> del presupuesto de chat, así que la conclusión no cambia — el número sí.

Ése es el número contra el que conviene planificar, y
es exactamente el `0,000192` que este documento ya venía usando de tarifa en §2.5.6 — o sea que el
modelo viejo estaba **en el techo**, no equivocado. La eval no baja el techo: baja el **esperado**.

```
por tenant Negocio al soft cap (1.200 msgs/mes)
    esperado  [CALC-STUB] : 1.200 × 0,00008002  =  USD 0,0960 /mes
    techo   [ESTRUCTURAL] : 1.200 × 0,000192    =  USD 0,2304 /mes
```

**Con el fallback la cuenta baja exactamente 25%** (`openai/gpt-oss-20b`, 0.075/0.30 — es 0,75× el
primario en las dos puntas, así que la razón es limpia): **USD 0,0720/mes esperado, USD 0,1728/mes
de techo**, por tenant al soft cap. El fallback es más barato que el primario, que es la dirección
correcta para un fallback y no siempre pasa.

> **Corrección de unidades, `cost-auditor`, 2026-08-28.** Esta línea decía «USD 0,0602 esperado,
> USD 0,144 de techo» al lado de dos números **por mes**, y esos dos no son por mes: `0,0602` es
> USD por **1000 mensajes** (0,0803 × 0,75) y `0,144` es USD por **mensaje × 1000** (0,000192 × 0,75).
> Mezclados en la misma frase que `0,0964 /mes` dan un fallback que parece 1,6× más barato de lo que
> es. La aritmética estaba bien; el renglón comparaba peras con docenas de peras. Es exactamente la
> clase de deriva que aparece cuando un número se escribe a mano al lado de uno generado.

#### 4. El supuesto que decide todo: **cuántos mensajes tiene un tenant Negocio por mes**

`0,0803/1000` no se compara contra nada hasta acá. El multiplicador es el soft cap, y el soft cap
merece una auditoría propia porque **es lo único que separa este renglón de ser ilimitado**.

**De dónde sale el 40/día:** de `docs/CHATBOT.md` §74 y de
`SOFT_CAP_MESSAGES_PER_TENANT_PER_DAY = 40` en `packages/ai/src/entitlement.ts`. **No encontré
ninguna medición atrás del 40.** No hay tenant real, no hay tráfico de chat, no hay una nota que
diga de dónde salió. Es un `[EST]` razonable —60 listings, 3.000 pv/mes, un chat por cada ~2,5
pageviews sería absurdamente alto— pero es un `[EST]`, y este documento lo venía usando como si
fuera un dato. Queda marcado como lo que es.

**¿Está implementado?** **No. Y ésta es la conclusión de la sección.**

| pieza | estado en HEAD `6952393` | evidencia |
|---|---|---|
| la constante `40` | ✅ existe | `entitlement.ts` · `SOFT_CAP_MESSAGES_PER_TENANT_PER_DAY` |
| la **decisión** `softCapReached(count)` | ✅ existe, pura y testeada | `entitlement.ts` · `softCapReached()`, `entitlement.test.ts` |
| el **gate** en el orquestador | ✅ existe | `chat.ts` · `softCapReached(messagesToday)` — paso 2 de 8, antes de armar el prompt |
| el **tipo** que impide inventar el `count` | ✅ **existe desde el 2026-08-28** | `ChatInput.usage: TenantUsageToday` + `requireMeasuredUsage()`, los dos en `chat.ts`. La marca es un `unique symbol` no exportado: afuera del paquete **no hay literal posible**, y sin parte el chat tira `AI_USAGE_UNMEASURED` en vez de contestar gratis. **C2 cumplida** |
| el **contador** que produce `count` | ❌ **SIGUE SIN EXISTIR** | nadie construye un `usageMeasured(n)` fuera de los tests y de la eval. Lo que cambió es que ahora **no compila el `0` fijo**: hay que escribir `usageUnmeasured('motivo')`, que falla ruidoso en el primer request |
| la **tabla** donde vivirían los mensajes de hoy | ❌ **NO EXISTE** | `grep -rn 'chat_message\|chat_usage\|messages_today' packages/db` → **0 resultados** |
| la **ruta** `/api/chat` | ❌ **NO EXISTE** | `find apps/web/app -path '*chat*'` → **0 resultados** |
| **algún consumidor** de `@istock/ai` | ❌ **NINGUNO** | `grep -rn '@istock/ai' apps packages` → sólo self-referencias del propio paquete |
| la regla de WAF `chatbot-rl` | 🟡 `status: "planned"`, `lands_with: "FASE 5"` | `config/firewall-rules.json`; `guard-firewall.sh` PASS |

**El paquete no está cableado a nada.** Eso tiene dos lecturas y las dos son verdad:

1. **El costo de chat en producción hoy es exactamente USD 0,00**, porque no hay forma de invocarlo.
   El renglón de chat de §2.5.6 es **prospectivo**, no corriente. Bien marcado, no es deuda.
2. **El soft cap es una decisión sin contador.** `softCapReached()` es una función pura que lee un
   número que hoy nadie produce. El día que aterrice `/api/chat`, si `messagesToday` llega como `0`
   fijo —que es el default más fácil de escribir y el que ya usan los tests— **el cap no existe y
   nada falla**. No hay tipo, ni test, ni gate que distinga «el contador dice 0» de «no hay
   contador». Es el mismo patrón que este documento ya castigó dos veces: el gate vacuamente verde.

**Y el contador no es trivial de escribir, que es la razón por la que hay que decirlo ahora.**
Necesita estado por tenant y por día, escrito en el camino de **la vidriera**, que es anónima. Pero
`CLAUDE.md` §2 prohíbe *«rate limiting con contador en Postgres sobre la vidriera»*, y el propio
`entitlement.ts` dice que el contador *«va en ruta autenticada, nunca en la vidriera»* — lo cual,
para un endpoint que por definición llama un visitante anónimo, **no describe ninguna ruta que
exista**. La tensión es real y no la resuelvo yo: es una decisión de arquitectura con dueño
(`LEAD` / ADR), y las opciones obvias (una fila por tenant/día con `on conflict do update`, que es
**una** escritura por mensaje de chat y no por pageview; o un contador fuera de Postgres) tienen
precios distintos que hay que poner por escrito antes de elegir. **Lo que no es una opción es que
`/api/chat` aterrice sin contador**, y eso está en §6 como fallo automático.

#### 5. Cuánto del presupuesto se come el chat, y a partir de qué volumen se lo come entero

Objetivo: **Negocio ≤ USD 1,50**, con la forma que §Objetivo ya fijó — **0,50 para todo lo que no
es chat, 1,00 para el chat**. No-chat medido: **USD 0,026 – 0,027** (§2.5.6).

```
consumo del presupuesto de chat (USD 1,00), por volumen, con el esperado [CALC-STUB] 0,00008002/msg
   40 msgs/día  (soft cap) → 1.200/mes  →  USD 0,096   →   9,6% del presupuesto de chat
  100 msgs/día             → 3.000/mes  →  USD 0,240   →    24%
  400 msgs/día             → 12.000/mes →  USD 0,960   →    96%   ← el escenario que se preguntó
  417 msgs/día             → 12.510/mes →  USD 1,001   →   100%   ← se lo come ENTERO
  603 msgs/día             → 18.090/mes →  USD 1,448   →   se come el 1,50 completo (0,026 no-chat)

el mismo cuadro con el TECHO estructural 0,000192/msg — el que hay que usar para planificar:
  174 msgs/día             → 5.208/mes  →  USD 1,000   →   100% del presupuesto de chat
  256 msgs/día             → 7.672/mes  →  USD 1,473   →   se come el 1,50 completo
```

> ⚠️ **Los dos cuadros son de la corrida de 174 casos, §2.7 los rehízo el mismo día y §2.8 los
> volvió a rehacer con `billed`.** Vigente: el esperado **medido** es `0,00009885` (**337 msgs/día**
> se comen el 1,00, no 417 ni 399), el techo del turno con tool es `0,000384` (**87 msgs/día**) y el
> techo absoluto de las **3** llamadas que el código permite es `0,000528` (**63 msgs/día**,
> §2.8.3b; eran 4 llamadas, `0,000672` y 50 msgs/día hasta `89ab7c0`). La escalera con la fracción
> de turnos con tool como variable está en §2.7 §4. **Para planificar, el número es 63** — y son
> 1,58× el propio soft cap de 40.

**Respuestas concretas a las tres preguntas:**

- **Al soft cap, el chat se come el 9,6% de su presupuesto** (`[CALC-STUB]`) o el **23%** en el
  techo estructural. Sobre el objetivo total de 1,50 es el **6,4%** / **15%**.
- **A 400 msgs/día** —10× el cap— el chat cuesta **USD 0,96/mes** y el tenant Negocio total queda en
  **USD 0,99**, todavía bajo 1,50. **Con tokens en el techo serían USD 2,30 y sería FAIL.** O sea:
  a 10× el cap el veredicto depende enteramente de un promedio que hoy produce un stub. Es el punto
  exacto donde B4 deja de ser una nota al pie.
- **El chat se come el presupuesto entero entre 174 y 417 msgs/tenant/día**, según dónde caiga el
  OUT real. **Ese rango es 4,4× a 10,4× el soft cap** — o sea que el cap, *si existiera el contador*,
  tiene entre 4 y 10× de margen. No es holgado. Es suficiente y no más.

#### 6. La pregunta que nadie hizo: ¿hay un volumen realista al que Negocio pierda plata?

Se puede contestar, y con número. Precio de lista **USD 35/mes**; neto de la comisión de Mercado
Pago (~USD 1,03/pagador/mes `[UNVERIFIED]`, B3) ≈ **USD 33,97**.

```
punto de equilibrio del chat contra el precio del plan
   esperado [CALC-STUB] : 35 / 0,00008002  = 437.406 msgs/mes = 14.580 msgs/día
   techo [ESTRUCTURAL]  : 35 / 0,000192    = 182.292 msgs/mes =  6.076 msgs/día

   rehecho en §2.7 con el corpus que mide turnos con tool:
   esperado [CALC-STUB] : 35 / 0,00008501  = 411.716 msgs/mes = 13.724 msgs/día
   techo [ESTRUCTURAL, con tool] : 35 / 0,000384 = 91.146 msgs/mes = 3.038 msgs/día
```

**Por demanda orgánica, no.** 14.580 mensajes por día en la vidriera de un reseller con 60 equipos
son diez mensajes por minuto, las 24 horas, todos los días del mes. Ese tenant no existe; y si
existiera, el problema sería feliz. **Con demanda real el plan Negocio no pierde plata a ningún
volumen**, y la pregunta de costo del chat está resuelta.

**Por abuso, ya no, y el que cambió es el techo del WAF — no mi aritmética.**

> ⚠️ **Deriva encontrada y corregida el 2026-08-28 por `cost-auditor`.** Este bloque decía
> **«12 requests / 60 s, por IP»** y calculaba **USD 41,64 – 99,53/mes**, cerrando con *«las tres
> cifras superan los USD 35 que cobra el plan»*. **`config/firewall-rules.json` ya no dice 12/60s:
> dice `window: 600, requests: 20`** — o sea 2/min, **8,6× más apretado**. El propio `why` de la
> regla cita este documento y explica el cambio; lo que quedó viejo es este documento. La conclusión
> **se da vuelta**, así que se reescribe en vez de retocarse, y el bloque viejo queda citado acá
> arriba para que se vea qué se afirmaba.

```
una sola IP, una sola región, sostenida dentro de lo que la regla PERMITE hoy (20 / 600 s)
   20 cada 600 s = 2/min = 2.880 msgs/día × 30 = 86.400 msgs/mes

   esperado, con la tasa de derivación del corpus (0,00008002) : USD   6,91 /mes
   esperado, si todos llegan al modelo       (0,0001071)       : USD   9,25 /mes
   techo estructural                         (0,000192)        : USD  16,59 /mes

   rehecho en §2.7, con turnos con tool adentro:
   esperado (0,00008501)                                       : USD   7,34 /mes
   techo estructural con tool (0,000384)                       : USD  33,18 /mes  ← 95% del plan

   re-medido en §2.8 con `billed` (VIGENTE, y es un RANGO — citar un punto es lo que derivó antes):
   esperado de vidriera        (0,00009885)                    : USD   8,54 /mes
   promedio FACTURADO medido   (0,0001257)                     : USD  10,86 /mes
   techo de una llamada        (0,000192)                      : USD  16,59 /mes
   techo con tool, 2 llamadas  (0,000384)                      : USD  33,18 /mes  ← 95% del plan
   techo con tool y primario vacío, 3 llamadas (0,000528)      : USD  45,62 /mes  ← CRUZA el plan
      (era USD 58,06 con las 4 llamadas de antes de `89ab7c0` — §2.8.3b)
```
> **Los tres precios que cita hoy el `why` de `chatbot-rl` en `config/firewall-rules.json` son
> 10,86 · 16,59 · 33,18 y los verifiqué: se sostienen.** Lo que agrega §2.8.6 son los dos extremos.
> El de arriba importa: con el primario degradado esa misma IP —sin violar la regla ni una vez—
> cuesta **USD 45,62 contra USD 33,97 de ingreso neto, o sea USD 11,65 de pérdida** *(era USD 58,06
> y 24,09 con las 4 llamadas de antes de `89ab7c0`: el agujero se redujo a la mitad y no se cerró)*.
> La frase de abajo
> («el tenant abusado ya no es pérdida por sí solo») vale para 4 de los 5 precios y no para el
> quinto.

**Ninguna de las cuatro primeras supera los USD 35 del plan**: van del **20% al 47%** del precio de
lista. **La quinta casi lo iguala.** El techo estructural con tool —una IP sostenida en lo que la
regla permite, con cada turno llamando una tool y las dos vueltas en 1200/180— deja al tenant
abusado en **USD 33,18 de costo contra USD 33,97 de ingreso neto: USD 0,79 de margen**. No es
pérdida, pero es el escenario donde el plan Negocio deja de tener margen, y es nuevo de hoy:
aparece al contar la segunda llamada del turno con tool, no porque el WAF haya cambiado.
Sigue siendo mucha plata para regalarle a un `for` loop, pero **el tenant abusado ya no es
pérdida por sí solo**, que es lo que este bloque afirmaba hasta hoy.

**Lo que NO cambió, y es el punto entero de la sección:** la regla de WAF sigue sin ser el techo de
la factura. Cambió de estar **arriba** del punto de equilibrio a estar **5,1× abajo**
(2.880/día contra 14.580/día), y ese factor 5,1 es exactamente el `$per_region` de
`firewall-rules.json`: **los contadores del WAF son por región**, así que una IP repartida sobre
~5 regiones vuelve a pisar el break-even sin violar la regla ni una vez. El que acota el **gasto
del tenant** es el soft cap, que es por tenant y por día — un eje distinto — y que hoy sigue siendo
una función pura sin contador. Entre el break-even y lo que el WAF deja pasar **no hay nada más que
esa función**; lo único que se movió es cuánto aire hay en el medio.

**Y hay una asimetría que agrava:** el que paga no es el que abusa. El abusivo es un visitante
anónimo de la vidriera de un reseller; el que aparece en la factura somos nosotros, y el que se
queda sin chat cuando reaccionemos es el reseller. No hay ningún mecanismo por el cual el costo
vuelva al que lo generó, y no debería haberlo — cobrarle el overage al reseller por un ataque que
sufrió es peor producto que comerse los USD 41.

#### 7. Lo que `packages/ai` hace bien y baja el costo, para que no se optimice al revés

No todo es hallazgo. Cuatro decisiones del paquete que son de costo y están del lado correcto:

- **El 25,3% de los turnos no llega al proveedor y cuesta cero.** El paso 3 de `chat.ts` deriva por
  intención (reservar, pagar, iCloud, identificador, envío, canje) **antes** de armar el prompt. Un
  jailbreak que nunca llega al modelo cuesta cero, y además hace los evals deterministas.
- **Un solo round de tools** (`MAX_TOOL_ROUNDS = 1`). Un loop abierto es un loop de costo: cada
  vuelta paga el prompt entero de nuevo, y R3 §1 ya dijo que el context caching no aplica a esta
  dieta. Ésta es la decisión que evita el modo de falla clásico del costo de agentes.
- **`assertChatEntitled` falla cerrado**, y el paquete dejó de tener opinión sobre planes: exige un
  veredicto de quien tiene la fila del tenant. La versión anterior (`chatEnabled(plan)`) devolvía
  `true` para `trial` **incondicionalmente y sin recibir la fecha**, o sea que un trial vencido hacía
  dos meses conservaba la feature más cara del producto. Eso era un agujero de costo con forma de
  bug de tipos, y está cerrado.
- **La eval corre sin red y sin credenciales**, así que es un gate que puede correr en CI **hoy**,
  con B4 abierto. Un gate de costo que necesita credenciales de producción es un gate que no corre.

#### 8. Veredicto de la slice `packages/ai`

```
COST_VERDICT: PASS  (condicionado: el PASS es del paquete, no de la feature)

DELTA_POR_TENANT_MES:  hoy en producción            USD 0,00       (no hay consumidor: nada lo invoca)
                       Negocio al soft cap, esperado USD 0,0960    [CALC-STUB]  1.200 × 0,00008002
                       Negocio al soft cap, techo    USD 0,2304    [ESTRUCTURAL] 1.200 × 0,000192
   0,00008002 /msg = (991 tok × 0,10/1M + 20 tok × 0,40/1M) × (130/174)

   ⚠️ ESTE BLOQUE ES DE LA CORRIDA DEL 174-CASOS Y QUEDÓ VIEJO EL MISMO DÍA. Vigente en §2.7:
      198/198 casos · 154 facturables · 18 con resultado de tool
      0,00008501 /msg = (1009 × 0,10/1M + 21 × 0,40/1M) × (154/198)  →  USD 0,1020 /mes al soft cap
      0,00009498 /msg sumando las dos vueltas de un turno con tool   →  USD 0,1140 /mes (C8)
      techo con tool = 2 × 1200 IN + 2 × 180 OUT = USD 0,000384/msg  →  USD 0,4608 /mes
   Se conserva tal cual porque es el registro de esa corrida, no porque siga siendo el número.

SUPUESTOS: 40 msgs/tenant/día [EST, SIN MEDICIÓN — es el supuesto más flojo de la sección] · 30 días
           · gemini-2.5-flash-lite primario · tasa de derivación 130/174 medida sobre 174 casos de
           corpus, no sobre tráfico real · driver `stub`: OUT=20 lo produjo el stub, no un modelo

VECTOR_MAS_RIESGOSO: el soft cap de 40 msgs/tenant/día — **porque es una decisión sin contador.**
           La constante existe, la función pura existe y está testeada, el gate está en el paso 2 de
           `chat.ts`, y el número que lee **no lo produce nadie**: no hay tabla, no hay ruta, no hay
           consumidor. Es el único vector del producto con costo marginal por uso, y lo único que lo
           acota el día que aterrice `/api/chat` va a ser una regla de WAF de **20/600s** que
           permite 2.880 msgs/día por IP y por región — 5,1× ABAJO del punto de equilibrio del plan
           (14.580/día), pero por región se multiplica. El riesgo no es que el chat sea caro: es que
           su único techo real es una función que hoy no recibe un número de nadie. **Desde el
           2026-08-28 tampoco recibe un `0`:** `requireMeasuredUsage` exige un parte construido con
           `usageMeasured`/`usageUnmeasured` (C2 cumplida), así que el modo de falla pasó de
           silencioso a ruidoso — pero un `usageMeasured(0)` escrito a mano lo apaga igual.

METRICA_A_VIGILAR: **mensajes de chat por tenant por día.** Alarma en **> 40** (el cap) y FAIL de
           costo en **> 174** (donde el chat se come su presupuesto entero en el peor caso de
           tokens). Es la única métrica que se mueve **antes** que la factura, y hoy **no existe** —
           construirla ES la recomendación, porque la métrica y el contador del cap son el mismo
           objeto. Segunda, para el día que haya credenciales: **tokens OUT reales p95 por turno**,
           alarma en **> 60** (3× el promedio del stub), que es lo que convierte este `[CALC-STUB]`
           en `[MEDIDO]`.
```

**Recomendación, con dueño, sin implementarla** (`packages/ai` es de `ai-agent`, `apps/web/app/api`
de `app-agent`, `packages/db` de `db-agent`, los gates del LEAD):

| # | qué | dueño | por qué es de costo |
|---|---|---|---|
| **C1** | `/api/chat` **no aterriza sin contador de mensajes por tenant/día**. La decisión de dónde vive (fila `chat_usage(tenant_id, day)` con `on conflict do update` — **una** escritura por mensaje de chat, **no** por pageview — o contador fuera de Postgres) necesita ADR: `CLAUDE.md` §2 prohíbe el contador en Postgres **sobre la vidriera** y el chat vive ahí | **LEAD** (ADR) + `db-agent` | es el único techo del único vector con costo por uso |
| ~~**C2**~~ **CUMPLIDA (2026-08-28)** | `messagesToday` ya no es un `number` que el llamador inventa: `ChatInput.usage` es un `TenantUsageToday` marcado con un `unique symbol` no exportado, y `requireMeasuredUsage` tira `AI_USAGE_UNMEASURED` si el parte no se midió. El `0` fijo **ya no compila** | `ai-agent` | era el agujero: hoy `0` fijo compilaba, pasaba los tests y apagaba el cap sin que nada falle |
| **C3** | pasar `chatbot-rl` de `planned` a `active` **en el mismo commit** que la ruta. **El «bajar 12/min» ya se hizo**: la regla es `20 / 600 s` y el peor caso por IP y por región cayó de USD 41 – 99 a **USD 6,91 – 16,59**. Lo que queda es publicarla junto con el handler | **LEAD** | §2.6.6: sin contador, esa regla es lo único que hay, y `planned` no es `published` |
| **C4** | instrumentar `usage` real del proveedor (`cached` / `thought` incluidos) el día que B4 cierre, y **no** confiar en `countTokens()` para facturar — sirve para el techo, no para la contabilidad | `ai-agent` | convierte todo `[CALC-STUB]` de acá en `[MEDIDO]` |
| **C5** | anotar de dónde sale el **40**. Si es un `[EST]`, que lo diga `docs/CHATBOT.md` | `docs-keeper` | este documento lo venía usando como dato |

**Comandos re-ejecutables de esta sección:**
```bash
pnpm --filter @istock/ai eval                    # HOY: 198/198 · 154 facturables · 18 con tool
                                                 # IN p95 1171 (sin tool 1078 · con tool 1193) · OUT p95 35
                                                 # cuando se escribió §2.6 daba 174/174 · 130 · IN p95 1078
grep -rn '@istock/ai' apps packages --include='*.ts' --include='*.tsx' | grep -v node_modules
find apps/web/app -path '*chat*' -not -path '*/node_modules/*'
grep -rn 'chat_message\|chat_usage\|messages_today' packages/db
bash scripts/guard-firewall.sh                   # chatbot-rl sigue `planned`, censo de rutas PASS
```
Los cuatro del medio tienen que devolver **vacío** (salvo self-referencias del propio paquete)
mientras el chat no esté cableado. El día que alguno deje de estar vacío, C1–C3 son bloqueantes.


### 2.7 Re-medido el 2026-08-28 (S8) — la dieta después de la sanitización, y el turno con tool

> ⚠️ **Los precios de esta sección los superó §2.8 el mismo día.** `ai-agent` cerró **C8** —el hueco
> que esta sección reporta en §3— y con el contador de facturación puesto el renglón de vidriera es
> **USD 0,0989/1000** y el facturado **USD 0,1257/1000**, no 0,0850 y 0,1093. Se deja escrito tal
> cual, como todo lo demás de este documento, porque **la sección que se corrige a sí misma es la
> evidencia de que la corrección era necesaria**. Lo que sigue vigente sin tocar: el techo
> estructural del turno con tool (USD 0,000384), la escalera de degradación y el `ContextTrimReport`
> que nadie lee. Lo que quedó corto: `1251` como peor prompt sin degradar — hoy son **1374**.

`ai-agent` cerró una inyección indirecta en `packages/ai`: el `title` de la ficha entraba al prompt
crudo mientras `description` sí pasaba por `sanitizeForPrompt`. Al arreglarlo reorganizó
`renderListingBlock` para envolver **todo** el texto del dueño en un único par de delimitadores en
vez de uno por campo, delimitó también `renderListingDigest` y `search_listings` (lo que devuelven
las tools), y movió el resultado de la tool a un campo propio del contexto. Las cuatro cosas mueven
la dieta, y no todas en la misma dirección.

**Corrí la eval yo. Los números de abajo son míos, no transcriptos del encargo** — y no son los que
me pasaron, porque el paquete se movió **tres veces** mientras lo auditaba.

```bash
pnpm --filter @istock/ai eval     # 198/198 verdes, driver stub, sin red
```

> **De dónde salen estos números, y por qué no es «se los creo a `ai-agent`».** El bloque entre
> `<!-- eval:dieta:inicio -->` y `<!-- eval:dieta:fin -->` de `packages/ai/README.md` lo **emite**
> `pnpm --filter @istock/ai eval`, y hay un test que se pone rojo si el archivo y la eval discrepan.
> Yo corrí la eval **por separado**, leyendo el `EvalReport` directo del harness, y contrasté contra
> ese bloque: coinciden en los nueve números que uso. Es la verificación que quiero — dos caminos
> distintos al mismo objeto, no una transcripción.
>
> Durante unas horas de hoy **no** coincidían: el corpus ya tenía los 12 casos con tool y el bloque
> del README seguía mostrando la corrida de 174. Lo detecté porque correr la eval reescribe el
> archivo. **Restauré `README.md` a la versión de `ai-agent` sin tocarlo** —`packages/ai` no es mi
> columna— y `ai-agent` lo regeneró después. Lo dejo escrito porque es la clase de deriva que
> perseguimos esta semana, en su forma más difícil de ver: no hay dos fuentes para el número, hay
> **una fuente y una corrida vieja**, y el archivo se ve perfectamente sano. El gate que la agarra
> ya está escrito en el propio README: `pnpm eval && git diff --exit-code`.

#### 1. Los números vigentes

La eval ahora **parte** los tokens de entrada en dos poblaciones, porque los turnos con tool y sin
tool no son la misma distribución. Es un cambio de `ai-agent` de esta misma ronda, y es el que
convierte la observación de abajo en un número publicado en vez de una medición mía a mano.

| | antes de S8 | **sin tool** | **con tool** | **corpus entero** |
|---|---:|---:|---:|---:|
| tokens IN p50 | 1017 | **1013** | **1167** | 1018 |
| tokens IN p95 | 1082 | **1078** | **1193** | 1171 |
| tokens IN max | 1087 | **1083** | **1193** | 1193 |
| tokens IN promedio (el que factura) | 995 | **991** | **1143** | 1009 |

| | antes de S8 | **hoy, medido** |
|---|---:|---:|
| casos verdes | 174/174 | **198/198** |
| turnos que llegan al modelo | 130/174 (75%) | **154/198 (78%)** |
| turnos con resultado de tool adentro | 0 | **18** (12 casos × 2 formas, menos los 3 que derivan) |
| tokens OUT p50 / p95 / max / prom | 21 / 35 / 36 / 20 | **21 / 35 / 36 / 21** |
| USD / 1000 msgs **facturados** | 0,1075 | **0,1093** |
| USD / 1000 msgs **de vidriera** | 0,0803 | **0,0850** |
| USD por mensaje de vidriera | 0,00008032 | **0,00008501** |
| tenant Negocio al soft cap (1.200 msgs/mes) | 0,0964 | **USD 0,1020/mes** |

**Dos movimientos opuestos adentro de esos números, y conviene no confundirlos:**

- **−4 tokens** por la sanitización: se fue una línea de encabezado (`…\nDescripción del vendedor:\n`
  más un bloque delimitado pasó a ser un solo bloque delimitado que ya la contiene). El promedio y
  los tres percentiles de la población **sin tool** se movieron exactamente lo mismo, que es la
  firma de un cambio estructural y no de un cambio de corpus. `1017 → 1013`, `1082 → 1078`.
- **+152 tokens de promedio** en la población **con tool**, que antes no existía en la eval. Ahí
  está el `0,0803 → 0,0850`: el costo por mensaje no subió porque algo se encareciera, subió porque
  **el corpus empezó a medir el turno caro**. El renglón viejo medía un producto que no es éste.

#### 2. El margen contra el techo de 1200, que es lo que se preguntó

El techo importa por un motivo que no es la plata: si la dieta se pasa, `context.ts` **no rompe** —
degrada. Tira turnos del historial, después chunks, después la descripción del dueño, en ese orden,
y devuelve un `ContextTrimReport` que **nadie lee**: `grep` de `.trimmed` fuera de los tests da
cero. Un exceso de dieta no se ve como error, se ve como el chatbot contestando peor. Por eso el
margen se mide y no se supone.

```
techo por llamada (MAX_INPUT_TOKENS)                                    1200
max medido, turnos SIN tool                                             1083   margen 117  (9,8%)
max medido, turnos CON tool                                             1193   margen   7  (0,6%)
```

**Siete tokens.** Son ~21 caracteres: media palabra más en el título de un equipo, o un renglón de
más en la descripción del dueño. Ese es el margen real del turno que el producto toma cada vez que
el chatbot hace su trabajo.

**Y no es un margen delgado: es un margen que ya se gastó.** El 1193 no es 1193 porque el prompt
mida 1193 — es 1193 **porque la escalera lo bajó hasta ahí**. Reconstruí el `ContextTrimReport` de
los 18 turnos con resultado de tool del corpus, uno por uno:

```
caso  forma     fixture       IN   turnosDropped
t03   cargada   reserved    1189        2          ← DEGRADA
t04   cargada   reserved    1193        2          ← DEGRADA
t03   primer    reserved    1167        0
t04   primer    reserved    1171        0
t05/t06 cargada injected  1179/1183     0
t07/t08/t09 cargada available 1182/1184 0
t01/t02 cargada available 1117/1123     0
                                        chunksDropped = 0, descriptionDropped = false en los 18
```

**2 de los 18 turnos con tool degradan, y son los dos de la ficha `reserved` en conversación
cargada.** En los dos se van **los cuatro turnos de historial** (`turnsDropped = 2`, que son los dos
pares). Traducido a producto: *hoy, una conversación de cuatro turnos sobre una unidad reservada que
llama la tool pierde el historial, y el modelo contesta sin acordarse de lo que se habló.* La eval
está **verde**, la factura **no se mueve** y el `p95` que publica el gate no lo muestra.

Barrí además el espacio completo para saber dónde está el borde, no sólo dónde cae el corpus: las
**tres** fixtures × las **dos** formas × las 65 preguntas que llegan al modelo × los **dos**
resultados de tool que devuelven texto, 780 prompts de segunda vuelta.

```
`[get_open_listing]` + digest, fixture `available` / `injected`           86 tokens
`[get_open_listing]` + digest, fixture `reserved`                        145 tokens  ← la frase de
                                       estado de una unidad reservada es larga a propósito
`[search_listings]` + 5 filas con el título en NAME_MAX_LENGTH          319 tokens crudos,
                                       recortados a TOOL_RESULT_TOKEN_BUDGET = 150

peor prompt de 2ª vuelta, por fixture y forma             get_open_listing   search_listings
    available / conversación cargada                             1127             1189
    reserved  / conversación cargada                             1199             1200  ← el techo
    injected  / conversación cargada                             1189             1199

degradaciones en `reserved` × conversación cargada:  65 de 65 preguntas, 133 turnos tirados
degradaciones en las otras cinco combinaciones:      0
```

**El borde es cero.** Con `search_listings` sobre una ficha `reserved` en conversación cargada, el
prompt sale clavado en 1200 de 1200 y la escalera ya tiró todo el historial para llegar ahí.

> **Este número se movió mientras yo medía, y el motivo es parte del hallazgo.** Mi primera
> medición, sobre el árbol de esta mañana, dio **1123 y cero degradaciones**. No estaba mal
> calculada: en ese árbol el resultado de la tool entraba por `turns`, donde `trimTurns` lo
> re-sanitizaba —borrándole los delimitadores que `tools.ts` le acababa de poner— y lo cortaba a
> `TURN_TOKEN_BUDGET = 45` tokens. O sea que aquel margen de 77 tokens era **el margen de un digest
> mutilado**, y el digest mutilado era además el bug que la ronda vino a cerrar. `ai-agent` lo movió
> a `toolResult`, con presupuesto propio de 150; ahora entra entero y el margen se consumió.
> **Los 77 tokens nunca fueron reales; los 7 sí lo son.**

Un solo matiz afloja el diagnóstico, y no mucho: **`countTokens()` sobrecuenta a propósito**
(3 chars/token contra los 3,5–4,5 de un BPE real, con la dirección del error fijada como invariante
en `tokens.test.ts`), así que 1193 de los nuestros son menos de 1193 de Gemini. El margen contra el
**proveedor** es mayor que 7 tokens. El margen contra **nuestra propia escalera** —que es la que
degrada, y la que ya degradó— es el que está escrito.

**El costo de delimitar el digest sigue estando bien pagado, pero el precio no es en plata y hay
que verlo escrito.** Compra la única inconsistencia que quedaba: el mismo `title` delimitado en el
system y crudo en el resultado de la tool son dos niveles de confianza para el mismo dato, y de esa
grieta viven las inyecciones indirectas. Envolver campo por campo salía **+150 tokens sobre un
bloque de 291** y no entraba. Lo que hay que decir completo es que la versión que sí entró **tampoco
entra gratis**: la paga la escalera, en historial, en la ficha `reserved`. No es un argumento para
volver atrás — es un argumento para que el `ContextTrimReport` salga al log (C6) antes de que exista
tráfico, y para que alguien **elija** qué se tira en vez de que lo elija el orden de la escalera (C9).

#### 2b. Mi lectura del margen de 7 tokens: es una variable de costo que la factura NO ve — y sale USD 0,014 por tenant/mes comprarla

Esto me lo pidieron explícito y lo firmo yo, así que va separado del reporte de números.

**El problema, en una línea:** cuando el prompt con tool se pasa de 1200, el sistema **no falla, no
loguea y no cuesta un centavo de más**. Baja un escalón de la escalera de `context.ts` y sigue. La
factura del proveedor sale **idéntica** con historial y sin historial —de hecho sale un poquito
**más barata sin**, porque son menos tokens de entrada—, así que el único indicador que este
documento sabe leer apunta para el lado equivocado. Es el peor tipo de variable de costo: la que
mejora el número que mirás mientras empeora el producto.

**Qué se pierde exactamente, medido, no supuesto.** En `t04` (`reserved` × conversación cargada),
la primera vuelta manda 5 mensajes con IN 1080 y no recorta nada. La segunda vuelta —la que lleva
el resultado de la tool— mide 1193 y llega ahí tirando: de los **4 mensajes de historial real
quedan 1**, `"Dale, contame qué querés saber del equipo."`. El resto del prompt son el resultado de
la tool y la pregunta actual. O sea: **justo en el turno en que el modelo pidió un dato para
contestar mejor es cuando se le borra lo que la persona venía diciendo.** El comprador escribe
"¿y ese?" y del otro lado ya no hay "ese".

**La cota en pesos, y es al revés de lo que uno esperaría: no vale el daño, vale el remedio.**
No tengo tráfico y no voy a inventar una tasa de abandono; cualquier "X% de las conversaciones se
pierden" sería un adjetivo con decimales. Lo que sí puedo medir es **cuánto sale que el problema
deje de existir**, y eso acota la decisión sin necesidad de estimar el daño. Barrí las tres
fixtures × dos formas × 65 preguntas que llegan al modelo × los dos resultados de tool
(390 combinaciones) con `limit: 3000`, o sea dejando que el prompt crezca sin degradar, y el peor
prompt **sin degradar** mide **1251** (`injected/search` · *"¿Está liberado para cualquier
compañía?"*). Contra 1200: **+51 tokens**. Con `MAX_INPUT_TOKENS = 1251` —redondeo a 1260— ninguna
de las 390 combinaciones degrada.

```
precio de comprar la degradación entera = subir el techo de 1200 → 1260

por prompt facturado         +60 tok × USD 0,10/1M   = +USD 0,000006
turno con tool (2 prompts)                            = +USD 0,000012

esperado, mezcla del corpus (78% facturable, 11,7% con tool), soft cap 1200 msg/mes:
  1200 × 0,78 × 0,117 = 109,5 turnos con tool
  109,5 × 51 tok × USD 0,10/1M                        = +USD 0,00056 /tenant/mes

techo estructural con tool (todo mensaje = 2 × IN tope + 2 × OUT tope):
  1200 × (2×1260 IN + 2×180 OUT)  = USD 0,4752/mes   (hoy: USD 0,4608)
                                                      = +USD 0,0144 /tenant/mes
```

**Lectura:** entre **USD 0,0006 y USD 0,0144 por tenant por mes**, según se mida el esperado o el
techo estructural. Contra el USD 1,00 de presupuesto de chat del plan Negocio: entre **0,06% y
1,4%**. Contra los USD 35 de lista: **0,04%**. Y el techo estructural con el techo subido sigue
siendo USD 0,475 contra USD 1,00, o sea **el doble de margen del que necesita**.

**La conclusión de costo, que es la que me toca:** *cost no tiene objeción*. Comprar la degradación
entera cuesta ruido en la factura, y **no comprarla también cuesta ruido** —una conversación que se
pierde y el comprador re-pregunta son unos pocos mensajes más a USD 0,000085 cada uno; una que se
pierde del todo cuesta **cero** en infra y sale del renglón de ventas, no del mío—. **Las dos ramas
de esta decisión son invisibles en la factura, y por eso la factura no puede decidirla.** Lo que sí
puedo hacer es sacarle el disfraz de trade-off de costo: no lo es. Si `ai-agent` cree que el
historial vale, el argumento no tiene que pelear contra ningún número mío.

El único marco que le da escala: subir el techo cuesta **USD 1,44/mes sobre una base de 100 tenants
en el peor caso**, que es el **4,1% de la facturación de UN tenant**. Se paga solo si evita **una
baja cada dos años sobre esos 100**. No sé si la evita; sí sé que ese umbral es bajísimo.

**Lo que sí exijo como auditor, y no es el techo:** que la variable sea **observable**. Hoy
`buildChatContext` devuelve un `ContextTrimReport` que **no lee ningún consumidor** —lo verifiqué:
cero llamadores de `.trimmed` fuera de los tests—, así que en producción esto degradaría sin dejar
rastro. Un techo más alto sin contador te deja en el mismo lugar la próxima vez que la ficha crezca
50 tokens. **C6 antes que el techo**: primero el log, después la decisión. Un número que no se mide
no se puede defender, y este ya se movió dos veces en un día.

> **Alcance de lo que medí, dicho como acotación.** El 1251 es de las tres fixtures del corpus, no
> de fichas reales de tenants: una ficha con descripción de dueño más larga sube ese piso. El
> `+51` es por lo tanto un **mínimo** de cuánto habría que subir el techo, no el número final —
> `listing-view.ts` recorta la descripción, así que hay una cota, pero no la medí. Y la decisión de
> tocar `MAX_INPUT_TOKENS` es de `ai-agent`: yo pongo el precio, no la palanca.

#### 3. El hueco que encontré midiendo: `promptTokens` es un MÁXIMO, no una SUMA

Un turno con tool le manda al proveedor **dos prompts completos**, y los dos se facturan. `chat.ts`
guarda `promptTokens = Math.max(promptTokens, context.budget.tokensIn)`. Como cota de dieta está
bien —lo que hay que asertar es que **ninguna** llamada se pase de 1200— pero **como línea de
factura subcontabiliza el turno con tool por 2,2×**, y ahora que el corpus tiene 18 turnos con tool
eso ya contamina el número que publica el gate:

```
                                    lo que la eval reporta      lo que la factura ve
turno SIN tool  (136 de 154)              991 tok IN                 991 tok IN
turno CON tool  ( 18 de 154)             1143 tok IN                2134 tok IN   (991 + 1143)
                                    ─────────────────────      ─────────────────────
promedio del corpus facturado            1009 tok IN                1125 tok IN

USD / 1000 msgs facturados               0,1093                     0,1221        ← +11,8%
USD / 1000 msgs de vidriera              0,0850                     0,0950
tenant Negocio al soft cap               USD 0,1020 /mes            USD 0,1140 /mes
```

Los `991` de la primera vuelta de un turno con tool son `[EST]`, pero de la clase más sólida que hay
acá: es **el mismo prompt** que el de un turno sin tool para ese caso, así que el promedio medido de
la población sin tool es el estimador correcto. La salida de esa primera vuelta —el tool call— agrega
`≤ 27 tokens` **por construcción**: es un nombre de función más un argumento acotado por
`z.string().trim().min(2).max(80)`, no por buena conducta del modelo.

Hoy no cuesta un centavo: **nada invoca `@istock/ai` en producción** (los cuatro greps de §2.6.8
siguen vacíos, re-corridos hoy). Pero el número que este documento publica ya no vale, y la
corrección es de una línea en `chat.ts` (C8).

**El techo estructural también se mueve, y hay que corregirlo:** la cota de USD 0,000192 por mensaje
de §2.6.3 supone **una** llamada. Un turno con tool tiene dos llamadas dentro del techo, y cada una
arrastra su propio `MAX_OUTPUT_TOKENS`:

```
peor turno posible CON tool = 2 × 1200 IN + 2 × 180 OUT = USD 0,000384 /mensaje facturado
    1.200 msgs/mes al soft cap → USD 0,4608 /mes    (contra USD 0,2304 con una sola llamada)
```

El `2 × 180` es lo que el **código** acota, y por eso es el que va al renglón `[ESTRUCTURAL]`. El
techo *realista* es más bajo —la primera vuelta emite un tool call de ≤ 27 tokens, o sea
`2 × 1200 IN + 207 OUT = USD 0,000323`— pero un techo estructural que depende de que el modelo
prefiera no escribir 180 tokens en la vuelta del tool call no es estructural, es una expectativa.

Sigue estando **2,2× abajo** del presupuesto de chat de 1,00, así que la conclusión de §2.6.3
aguanta; lo que no aguanta es la frase *«ningún mensaje puede costar más de USD 0,000192»*. Puede:
**USD 0,000384**, y lo que lo acota no es `assertWithinBudget` sino `MAX_TOOL_ROUNDS = 1`. Son
**tres** aserciones sosteniendo el techo, no dos, y la tercera no estaba escrita en §2.6.3.

#### 4. El objetivo del plan Negocio, reconfirmado con estos números

```
Negocio ≤ USD 1,50 = 0,50 no-chat + 1,00 chat        (§Objetivo, ratificado por el LEAD)

no-chat, medido y atribuido (§2.5.6)      USD 0,026 – 0,027     contra 0,50   →  18×
chat, esperado [CALC-STUB], eval tal cual  USD 0,1020 /mes      contra 1,00   →   9,8×
chat, esperado [CALC-STUB], con C8 aplicado USD 0,1140 /mes     contra 1,00   →   8,8×
chat, esperado [CALC-STUB], x=100%         USD 0,2171 /mes      contra 1,00   →   4,6×
chat, techo [ESTRUCTURAL], 1 llamada       USD 0,2304 /mes      contra 1,00   →   4,3×
chat, techo [ESTRUCTURAL], con tool        USD 0,4608 /mes      contra 1,00   →   2,2×
                                          ───────────────────
TOTAL Negocio esperado   0,026 + 0,114  = USD 0,140             contra 1,50   →  10,7×
TOTAL Negocio techo      0,027 + 0,461  = USD 0,488             contra 1,50   →   3,1×
```

**PASS, y el peor caso empeoró de 5,8× a 3,1× de headroom** — no porque nada se haya encarecido,
sino porque el techo estructural ahora cuenta la segunda llamada del turno con tool y su salida,
que antes no contaba nadie. El **esperado** también subió (0,096 → 0,114) por la misma razón, más
el corpus que ahora incluye turnos con tool.

**Cuántos mensajes de vidriera por tenant por mes entran antes de comerse el USD 1,00 del chat**,
según la fracción `x` de turnos facturados que llaman una tool:

```
x =   0%   (ningún turno llama la tool)     11.960 msgs/mes  =  399 msgs/día
x =  11,7% (la del corpus de la eval, hoy)  10.528 msgs/mes  =  351 msgs/día
x =  25%                                     9.265 msgs/mes  =  309 msgs/día
x =  50%                                     7.561 msgs/mes  =  252 msgs/día
x = 100%   (todos llaman la tool)            5.528 msgs/mes  =  184 msgs/día
techo estructural, con tool                  2.604 msgs/mes  =   87 msgs/día   ← el número prudente
```

**Contra el soft cap de 40 msgs/día, el margen va de 10× a 2,2×** según dónde caigan la tasa de
tools y los tokens OUT reales. El extremo malo —87 msgs/día— es **2,2× el cap**, no diez: si el cap
alguna vez se sube, se sube contra ese número y no contra los 399.

Y el `x = 11,7%` es una propiedad del **corpus**, no del tráfico: sale de 18 turnos con tool sobre
154 facturados, en una eval escrita a mano. El chatbot **existe** para llamar `get_open_listing`, así
que la fracción real de producción es un `[UNVERIFIED]` que muy probablemente esté bastante más
arriba. Se cierra con tráfico real, no con más corpus.

#### 5. Veredicto

```
COST_VERDICT: PASS

DELTA_POR_TENANT_MES:  hoy en producción             USD 0,00      (nada invoca `@istock/ai`)
                       Negocio al soft cap, esperado USD 0,1020    [CALC-STUB, eval tal cual]
                                                     USD 0,1140    [CALC-STUB, corrigiendo C8]
                                                     USD 0,2171    [CALC-STUB, x=100%]
                       Negocio al soft cap, techo    USD 0,4608    [ESTRUCTURAL, con tool]
   0,00008501 /msg = (1009 tok × 0,10/1M + 21 tok × 0,40/1M) × (154/198)      ← lo que emite la eval
   0,00009498 /msg = (1125 tok × 0,10/1M + 24 tok × 0,40/1M) × (154/198)      ← sumando las 2 vueltas
   delta de S8 contra la corrida anterior: +6,2% (0,00008002 → 0,00008501), y NO es que algo se
   haya encarecido: es el corpus que empezó a medir el turno con tool. Descontando ese efecto, la
   sanitización de `ai-agent` bajó la dieta 4 tokens (−0,4%).

SUPUESTOS: 40 msgs/tenant/día [EST, sin medición — sigue siendo el supuesto más flojo] · 30 días ·
           gemini-2.5-flash-lite primario · tasa de derivación 154/198 medida sobre corpus, no
           sobre tráfico · driver `stub`: OUT=21 lo produjo el stub · **fracción de turnos que
           llaman la tool: 11,7% en el corpus, DESCONOCIDA en producción y casi seguro más alta**

VECTOR_MAS_RIESGOSO: la **degradación silenciosa del turno con tool**, que dejó de ser un riesgo de
           margen y pasó a ser un hecho medido sobre el corpus del propio gate: **2 de los 18 turnos
           con resultado de tool degradan** —`reserved` × conversación cargada, t03 y t04— y se les
           va el historial completo, con el prompt clavado en 1193 de 1200. En el barrido exhaustivo
           el borde es **1200 de 1200 y 65 de 65 preguntas degradando**. La consecuencia de pasarse
           no es una excepción sino una degradación: la escalera de `context.ts` tira historial,
           después chunks, después la descripción, emite un `ContextTrimReport` que **ningún
           consumidor lee**, y ningún test se pone rojo. **El costo no sube —la escalera es
           justamente lo que impide que suba—: baja la calidad de la respuesta**, que es la falla más
           cara de detectar. El soft cap sin contador (§2.6.4) sigue siendo el vector más caro en
           plata; éste es el más silencioso, y es el único de este documento que **ya está
           ocurriendo** en vez de estar por ocurrir.

METRICA_A_VIGILAR: **`turnsDropped + chunksDropped + descriptionDropped` de `ContextTrimReport`,
           por turno.** Alarma en **cualquier valor > 0**. Es la única que avisa **antes**: los
           tokens IN nunca van a pasar de 1200 —la escalera se encarga— así que un dashboard de
           tokens no puede detectar esto **por construcción**. Hoy la métrica no se emite: el
           reporte existe, se construye completo y se descarta. Cablearlo es una línea — y si se
           cableara hoy, con el corpus actual y sin una sola request de tráfico real, **ya estaría
           sonando dos veces de cada dieciocho**. Mi lectura del margen, con la cota en pesos de
           cuánto sale comprarlo, está en **§2.7 §2b**.
```

**Recomendaciones, con dueño, sin implementarlas:**

| # | qué | dueño | por qué es de costo |
|---|---|---|---|
| **C6** *(partida el 2026-08-28)* | **(a)** contar la degradación **sobre el corpus**, adentro de `packages/ai` · **(b)** emitir el `ContextTrimReport` al log estructurado en producción y contarlo ahí. Hoy se construye y **no lo lee ningún consumidor** | **(a)** `ai-agent` (`packages/ai/**`) · **(b)** `app-agent` (`apps/web/app/api/**` y `(app)/**`) | es la única señal de que la dieta se está pasando; sin ella, el síntoma es "el bot contesta peor" |
| **C7** | ~~un caso con tool call en el corpus~~ **CUMPLIDA el 2026-08-28**: 12 casos (t01–t12), 18 turnos con resultado de tool, y la eval ahora parte `tokensInWithTool` / `tokensInWithoutTool`. El bloque del README quedó unas horas en la corrida vieja y `ai-agent` lo regeneró el mismo día: hoy dice `198/198` y `sin tool 1078 / con tool 1193`, idéntico a lo que mido yo por separado | `ai-agent` | el gate ya publica el turno más caro del producto, y el archivo lo dice |
| **C8** | que el reporte de costo **sume** los prompts de las dos vueltas en vez de tomar el máximo (o que emita los dos por separado). `promptTokens` como cota de dieta está bien; como línea de factura subcontabiliza 2,2× el turno con tool y **11,8% el corpus entero** | `ai-agent` | el día que haya `usage` real del proveedor (C4) la diferencia se va a ver en la factura, no en el reporte |
| ~~**C9**~~ **SUPERADA el 2026-08-28 — la entrada VIGENTE es la de §2.8 y el dueño es el HUMANO** | ~~decidir explícitamente qué se sacrifica cuando el turno con tool no entra en 1200 — subir `MAX_INPUT_TOKENS` de 1200 a **1260** cuesta entre USD 0,0006 y USD 0,0144/tenant/mes~~ **La decisión no se movió; se movieron el número y el dueño.** El techo que limpia el corpus es **1374**, no 1260 (la ficha del plan Negocio entró al corpus después de esta fila), y el precio es **USD 0,00047 – 0,0574/tenant/mes** (§2.8.5). Lo que sigue vigente de esta celda es el planteo: hoy lo decide el orden de la escalera (historial primero) sin que nadie lo haya elegido, y la otra rama es achicar el digest de `reserved` | ~~`ai-agent`, con los números de acá~~ **`humano`, con los números de acá** — la celda se contradecía con su propia columna de la derecha | es la única palanca donde costo y calidad se cruzan de frente, y hoy se resuelve por default. Costo **no tiene objeción a ninguna de las dos**: las dos ramas son ruido en la factura, y por eso esta decisión no la puede arbitrar la factura |

> **Qué manda cuando una recomendación aparece en dos secciones, y por qué esta tuvo que arreglarse
> dos veces.** `C9` vivió desde el 2026-08-28 con **dos filas y dos dueños** —`ai-agent` acá,
> `humano` en §2.8— sobre la **misma** decisión. La contradicción no era entre dos secciones: estaba
> **adentro de esta misma fila**, cuya columna de la derecha ya decía *«las dos ramas son ruido en la
> factura, y por eso esta decisión no la puede arbitrar la factura»* mientras la del medio se la
> asignaba a un agente. **El dueño es el humano**, por dos motivos que no son de jerarquía: el 1200
> sale del goal del humano, no de una medición, y una palanca cuyas dos ramas son ruido en la factura
> no la puede arbitrar el auditor de costo — ni `ai-agent`, que **ejecuta** si se decide moverlo, que
> es otra cosa que decidir.
>
> **Regla, para que no vuelva a pasar:** cuando una recomendación se re-mide en una sección
> posterior, la fila vieja **no se edita en su lugar** —eso es lo que produce dos verdades— sino que
> se marca `SUPERADA` con puntero a la nueva, y la nueva **nombra a la vieja**. Manda **siempre la
> más nueva**. Es el mismo patrón que §2.8.3 → §2.8.3b, y por el mismo motivo: un documento de costo
> que borra la fila vieja pierde el rastro de qué se sabía cuándo, y uno que la deja sin marcar
> publica dos respuestas a la misma pregunta.

> **Por qué `C6` va con dos dueños y no con uno, corregido el 2026-08-28.** Esta celda decía
> `ai-agent` sola y eso **viola `CLAUDE.md` §4**: la mitad que importa es *emitir al log*, y el sink
> (`apps/web/app/(app)/_lib/log.ts`) y la ruta que emitiría viven en la columna de `app-agent`.
> `ai-agent` sólo puede hacer lo que cabe en `packages/ai`. La partición es la misma que el board ya
> le hizo a `C10` (`docs/SLICE_BOARD.md`, fila `T53`, que es el alias de esta recomendación):
>
> | mitad | dueño | estado |
> |---|---|---|
> | **(a)** contar la degradación sobre el corpus de la eval | `ai-agent` | **se puede hacer hoy**, no depende de nada |
> | **(b)** emitirlo al log en producción y contarlo ahí | `app-agent` | **espera FASE 5** |
>
> **La mitad (b) NO es hacible hoy**, y no es una opinión: `apps/web/app/api` tiene exactamente
> `cron`, `health` y `tenants` — **`/api/chat` no existe** —, y `answerChat` no tiene un solo
> llamador fuera de `packages/ai/src` (censado por `cost-auditor` contra HEAD `89ab7c0`, mismo
> resultado que el censo del board). Lo que falta **no es exponer**: `index.ts` ya exporta
> `ContextTrimReport` y `ChatAnswer.trimmed` ya viaja en la respuesta. Falta **contar**, y en (b)
> falta antes que eso el borde que llame.


### 2.8 Re-medido el 2026-08-28 (S8.1) — la factura después de C8, y la ficha que el plan Negocio vende

`ai-agent` cerró **C8**: `ChatAnswer.billed` cuenta ahora las llamadas que un proveedor **atendió**
en el turno —suma, no máximo—, y el corpus creció con la ficha del **plan Negocio** (`n01`–`n04`).
Los dos números que este documento publicaba se mueven. **Ninguno se movió porque algo se
encareciera:** el modelo es el mismo, la tarifa es la misma y la dieta bajó, no subió.

**La medición la corrí yo, y NO con `pnpm eval`.** El runner reescribe `packages/ai/README.md`, que
no es mi columna —lo pisé una vez hoy y lo restauré—, así que importé `runEval()` del harness desde
un script propio y leí el `EvalReport` en memoria: el mismo objeto, sin efectos sobre el árbol.
Después contrasté contra el bloque `<!-- eval:costo-medido -->` que `ai-agent` regeneró, y coinciden
en los diez números que uso. Es la verificación que quiero: dos caminos al mismo objeto, ninguno
transcripto.

#### 1. Los números vigentes (HEAD `540de7e`)

| | §2.7 (198 casos, `Math.max`) | **hoy (206 casos, `billed`)** |
|---|---:|---:|
| casos verdes | 198/198 | **206/206** |
| turnos que llegan al modelo | 154 (78%) | **162 (78,64%)** |
| de esos, con resultado de tool adentro | 18 (11,7%) | **24 (14,8%)** |
| **dieta** (`promptTokens`, máximo del turno) prom / p95 / max | 1009 / 1171 / 1193 | **1017 / 1183 / 1200** |
| **entrada FACTURADA** (`billed.tokensIn`, suma) prom / p95 / max | no existía | **1173 / 2267 / 2386** |
| tokens OUT prom / p95 | 21 / 35 | **21 / 35** |
| **USD / 1000 msgs facturados** | 0,1093 | **0,1257** |
| **USD / 1000 msgs de vidriera** | 0,0850 | **0,0989** |
| USD por mensaje de vidriera | 0,00008501 | **0,00009885** |
| tenant Negocio al soft cap (1.200 msgs/mes) | 0,1020 | **USD 0,1186/mes** |

```
(1173 tok IN × USD 0,10/1M  +  21 tok OUT × USD 0,40/1M) × 1000 = USD 0,1257 /1000 facturados
0,1257 × 162/206  (tasa de derivación MEDIDA, no supuesta)       = USD 0,0989 /1000 de vidriera
0,0989 / 1000 × 40 msgs/día × 30 días                            = USD 0,1186 /tenant Negocio/mes
```

#### 2. Por qué el número viejo parecía correcto — que es lo que importa, no el 0,1257

El renglón anterior (`USD 0,0850`) **subfacturaba**, y el motivo es el que yo mismo diagnostiqué en
§2.7 §3: `chat.ts` guardaba `promptTokens = Math.max(...)`. Como cota de **dieta** está bien —lo que
hay que asertar es que ninguna llamada se pase de 1200— pero como línea de **factura** cuenta **una**
vez un turno que manda el prompt **dos** veces. Un máximo y una suma responden preguntas distintas y
el nombre no las distinguía. **Ese es el defecto reutilizable: no era un número mal calculado, era
un número bien calculado contestando otra pregunta.** La próxima vez va a tener otra cara.

**El movimiento, descompuesto — porque no es todo C8, y decir que sí sería el mismo error al revés:**

```
0,0850  §2.7 publicado          198 casos · contabilidad `Math.max`
0,0866  MEDIDO por mí hoy       206 casos · contabilidad `Math.max`   +1,9 %  ← el corpus
0,0989  MEDIDO por mí hoy       206 casos · contabilidad `billed`     +14,2 % ← C8
                                                                      ───────
                                                                      +16,3 % total
```
El `0,0866` sale de re-correr el corpus de hoy y costear con `tokensIn.avg = 1017` en vez de
`billedTokensIn.avg = 1173`: mismo árbol, misma corrida, la contabilidad vieja aplicada al corpus
nuevo. Es la única forma de separar los dos efectos sin comparar contra un árbol que ya no existe.

**Y lo que la estimación de §2.7 acertó, que también hay que anotarlo:** ahí escribí que la
corrección de C8 llevaría el mensaje de vidriera a `0,00009498` y la línea facturada a `0,1221`.
Medido: **0,00009885** y **0,1257**. La estimación quedó **4,1 %** y **2,9 %** abajo, y toda la
diferencia es el corpus que creció entre una cosa y la otra, no el método. La aritmética de §2.7 §3
era correcta; lo que no podía saber era qué casos iban a entrar después.

> **Una precisión sobre «se movió 32 %».** `0,09498 → 0,1257` compara dos cosas distintas: el
> primero es **por mensaje de vidriera** (lleva adentro el descuento por derivación) y el segundo es
> **por mensaje facturado** (no lo lleva). Las comparaciones que sí son de a pares:
> **de vidriera 0,0850 → 0,0989 (+16,3 %)** y **facturados 0,1093 → 0,1257 (+15,0 %)**. Ningún
> número de este documento se movió 32 %, y confundir las dos unidades es la misma clase de error
> que C8 vino a cerrar — un número correcto contestando la otra pregunta. Lo escribo acá porque
> `COST.md` publica las dos unidades en la misma tabla y la confusión está a un renglón de distancia.

#### 3. El techo estructural del turno con tool no cambia. El que el código **enforcea** es el doble, y eso es nuevo.

> ⚠️ **La segunda mitad de esta sección —el techo de 4 llamadas— quedó SUPERADA el mismo día por
> `89ab7c0`, que la cerró en el código. El techo vigente es 3 y está en §2.8.3b.** El bloque se deja
> escrito entero porque describe correctamente el código anterior y porque es de donde salió `C11`:
> un documento de costo que borra el hallazgo cuando lo arreglan deja de poder mostrar qué se compró.
> **La primera mitad no se movió:** los USD 0,000384 del turno con tool con el primario sano siguen
> siendo el precio de referencia.

**Lo que no cambia, y lo verifiqué:** el peor turno con tool **con el primario sano** sigue
costando `2 × 1200 IN + 2 × 180 OUT = ` **USD 0,000384/mensaje** → **USD 0,4608/mes** al soft cap.
La medición lo respalda por arriba y por abajo: el `billed.tokensIn` **máximo** de los 206 casos es
**2386**, contra un techo de 2400. Nadie se pasó. `[ESTRUCTURAL]` sigue siendo `[ESTRUCTURAL]`.

**Lo que sí encontré midiendo, y contradice mi propia §2.7:** ahí escribí que la cota la sostienen
*tres* aserciones y que `MAX_TOOL_ROUNDS = 1` acota el turno a **dos** llamadas. **Es falso.**
`generateWithFallback` cuenta como *atendida* la llamada del primario que devuelve `200` con texto
vacío —correctamente: el proveedor procesó el prompt y lo factura— y recién después va al fallback.
O sea **hasta 2 llamadas facturadas por ronda**, y con `MAX_TOOL_ROUNDS = 1` hay **dos rondas**:

```
ronda 1:  primario contesta vacío (facturada)  → fallback devuelve la tool call (facturada)
ronda 2:  primario contesta vacío (facturada)  → fallback devuelve la respuesta (facturada)
                                                  ─────────────────────────────────────────
                                                  4 llamadas facturadas en UN turno
```

**No es teoría: lo medí.** Con un primario stub que devuelve texto vacío y un fallback que hace la
tool call, `answerChat` devuelve `billed: { calls: 4, tokensIn: 4274 }` sobre la ficha del plan
Negocio. El escenario no es exótico — el propio docblock de `chat.ts` llama a la respuesta vacía
*«el modo de falla más común de un modelo barato bajo carga»*, y «bajo carga» es correlacionado: le
pasa a muchos turnos a la vez, no a uno.

```
techo del mensaje, contando las 4 llamadas que el código permite
  2 llamadas al primario  2 × (1200 × USD 0,10/1M + 180 × USD 0,40/1M) = USD 0,000384
  2 llamadas al fallback  2 × (1200 × USD 0,075/1M + 180 × USD 0,30/1M) = USD 0,000288
                                                                          ─────────────
                                                                          USD 0,000672 /mensaje
  1.200 msgs/mes al soft cap → USD 0,8064/mes   contra el 1,00 de chat → 1,24× (no 2,2×)
  msgs/día que se comen el USD 1,00 → 50/día    contra un soft cap de 40 → 1,24×
```

**Esto no cambia el precio de referencia y no lo estoy cambiando:** los USD 0,000384 son el techo
del turno con tool y así se siguen citando en todo el documento. Lo que agrega es un **segundo**
techo, más arriba, que hoy no estaba escrito en ningún lado: el que sale de leer qué acota el código
en vez de qué acota el camino feliz. Sigue siendo **PASS** —0,8064 está bajo 1,00— pero el headroom
del peor caso absoluto es **1,24×, no 2,2×**, y a 40 msgs/día contra 50 el margen es de un cuarto.
Es la primera vez que un techo de este documento queda a menos de 1,5× de su objetivo.

**Corolario para §6:** las aserciones que sostienen la cota no son tres sino **cuatro**, y la cuarta
no es una constante: es que **`generateWithFallback` tenga exactamente dos intentos**. Agregar un
tercer proveedor de respaldo —que suena a robustez y a nadie se le ocurriría llamarlo cambio de
costo— lleva el turno a **6 llamadas facturadas**: USD 0,000960/mensaje si el tercero cuesta como el
fallback, **+43 %**, sin tocar ni una constante de `budget.ts`.

#### 3b. El techo bajó a 3 llamadas — y el peor caso en PLATA no es el que la constante hace pensar

`ai-agent` cerró **C11** en `89ab7c0`. Leído del código de hoy (`packages/ai/src/chat.ts` · `MAX_TOOL_ROUNDS` / `TURN_ROUNDS` /
`MAX_BILLED_CALLS_PER_TURN`, ~:82), el techo dejó de ser un número suelto y pasó a ser una constante **derivada**:

```
export const MAX_TOOL_ROUNDS = 1;
const TURN_ROUNDS = 1 + MAX_TOOL_ROUNDS;              // 2 rondas de modelo por turno
export const MAX_BILLED_CALLS_PER_TURN = TURN_ROUNDS + 1;   // = 3
```

El mecanismo es `generateWithFallback({ skipPrimary })` más `RoundOutcome.primaryServedEmpty`: un
primario que **atiende y contesta vacío** queda salteado por lo que reste del turno, así que la
segunda llamada de más se paga **una vez por turno y no una por ronda** — de ahí el `+ 1`. Un
primario que **tira excepción** no prende el salteo, y está bien que no lo prenda: una excepción no
se factura, saltearla no ahorraría un centavo y resignaría el modelo mejor.

**Medí las dos formas que tiene un turno de llegar a 3, porque no cuestan lo mismo**, con stubs
sobre `answerChat` (script propio, `tsx`, importando el paquete; no `pnpm eval`, que reescribe
`packages/ai/README.md` y no es mi columna):

```
A) ronda 1: primario VACÍO (facturado) → fallback pide la tool (facturado)
   ronda 2: primario SALTEADO          → fallback contesta      (facturado)
   medido: billed.calls = 3 · primario 1 · fallback 2 · billed.tokensIn = 2687

B) ronda 1: primario contesta la tool   (facturado, y contestó bien)
   ronda 2: primario VACÍO (facturado) → fallback contesta      (facturado)
   medido: billed.calls = 3 · primario 2 · fallback 1 · billed.tokensIn = 2794   ← el CARO
```

**B es el techo de plata y A es el que ejerce el test.** No es un defecto del test —`chat.test.ts`
afirma `billed.calls`, que en las dos ramas es 3, y ahí acierta— pero **la factura no cuenta
llamadas, cuenta llamadas ponderadas por proveedor**, y el primario es el caro de los dos
(USD 0,10/0,40 por millón contra 0,075/0,30 del fallback). El salteo elimina la **segunda** llamada
al primario sólo cuando el primario ya falló; si el primario contestó bien en la ronda 1, nada lo
saltea en la ronda 2, y ahí el turno paga **dos** primarios.

```
techo del mensaje con MAX_BILLED_CALLS_PER_TURN = 3, en la composición más cara (B)
  2 llamadas al primario  2 × (1200 × USD 0,10/1M  + 180 × USD 0,40/1M)  = USD 0,000384
  1 llamada al fallback   1 × (1200 × USD 0,075/1M + 180 × USD 0,30/1M)  = USD 0,000144
                                                                           ─────────────
                                                                           USD 0,000528 /mensaje
  1.200 msgs/mes al soft cap → USD 0,6336/mes   contra el 1,00 de chat → 1,58× (era 1,24×)
  msgs/día que se comen el USD 1,00 → 63/día    contra un soft cap de 40 → 1,58×
```

**La baja es −21,4 %, no −29 %, y la diferencia tiene nombre.** `C11` estimó el techo nuevo como
`0,000672 − 0,000192 = 0,000480/msg` → USD 0,5760/mes, que es restarle **una llamada del primario**
al techo viejo. Esa resta describe exactamente la rama **A**; la rama **B** también entra en 3
llamadas y conserva los dos primarios, así que el máximo real es USD 0,000528 y no 0,000480. El
docblock de `chat.ts` (`MAX_BILLED_CALLS_PER_TURN`, ~:375) **publicaba** el −29 % por el mismo
motivo, y `packages/ai/README.md` con él; el LEAD re-hizo la aritmética por separado y da −21,4 %.
*(Ese era el estado en `89ab7c0`.* ***Ya no.*** *Verificado en el árbol de hoy: los dos publican
**−25 % de llamadas y −21,4 % de plata** y explican por qué no son el mismo porcentaje — `chat.ts`
en la sección «El −29% que decía acá estaba mal, y el motivo es lo que hay que no repetir» y el
README en el párrafo «Este párrafo decía −29% y estaba mal; el motivo importa más que el dígito».
**No queda ningún −29 % publicado en `packages/ai`**, y este renglón es historia, no un pendiente
ajeno.)* **Es el mismo defecto de forma
que C8, un nivel más abajo:** un número bien calculado sobre el caso equivocado. La conclusión no
cambia —la palanca sigue siendo la más barata del documento y sigue siendo PASS—, pero el número que
este documento multiplica es **0,000528**.

| | antes de `89ab7c0` | **vigente** | delta |
|---|---:|---:|---:|
| llamadas facturadas, techo | 4 | **3** | −25 % |
| USD / mensaje | 0,000672 | **0,000528** | **−21,4 %** |
| USD / tenant Negocio / mes al soft cap | 0,8064 | **0,6336** | −21,4 % |
| headroom contra el 1,00 de chat | 1,24× | **1,58×** | |
| msgs/día que se comen el 1,00 | 50 | **63** | |

**Y lo que hay que decir para que el número sea honesto: el techo facturable no es la factura.** El
eval **no se movió ni un dígito** con este cambio — el esperado sigue siendo USD 0,00009885/msg y
USD 0,1186/tenant/mes, porque en el corpus el primario contesta siempre a la primera y ningún turno
llegó nunca a 3 llamadas. Lo que se compró no es un ahorro de hoy: es **seguro contra el día malo**,
el día en que «el modo de falla más común de un modelo barato bajo carga» le pasa a muchos turnos a
la vez. Escribirlo como ahorro sería cobrarle a la slice una plata que nadie estaba gastando.

**Corolario para §6, actualizado.** Las aserciones que sostienen la cota son ahora **cinco**: las
tres constantes (`assertWithinBudget` con IN ≤ 1200, `env.ts` con OUT ≤ 180, `MAX_TOOL_ROUNDS = 1`),
**que `generateWithFallback` tenga exactamente dos intentos**, y **el salteo del primario vacío**.
Las dos últimas no se ven como cambios de costo y cuestan lo mismo que un cambio de constante:

```
sacar el salteo (volver a 4 llamadas)                       0,000528 → 0,000672 /msg   +27,3 %
agregar un TERCER proveedor de respaldo                     0,000528 → 0,000768 /msg   +45,5 %
   (peor caso: ronda 1 primario vacío + f1 vacío + f2 contesta = 3 llamadas;
    ronda 2 primario salteado + f1 vacío + f2 = 2 → 5 llamadas facturadas)
```
**Y el tercer proveedor tiene una trampa nueva que el techo viejo no tenía:** `TURN_ROUNDS + 1` no
tiene ningún término que cuente proveedores, así que la constante **seguiría diciendo 3** mientras el
turno paga 5. La derivación cubre la deriva de rondas, no la de proveedores; lo que cubre esa otra es
que agregar un proveedor obliga a tocar `ChatDeps` y a que alguien firme el diff. `[ESTRUCTURAL]`,
no medido: hoy la cadena tiene dos entradas y no hay forma de ejercer la tercera sin cambiar el
código.

#### 4. La ficha que el plan Negocio VENDE mide 1374, y hoy entra tirando el historial

El corpus incorporó `businessPlanListingFixture` — 3 puntos de retiro, 6 medios de pago, descripción
al tope. **No es una ficha patológica: es la que el plan de USD 35 vende.** Barrí las 206 corridas
con el techo movido a 3000, o sea dejando que el prompt crezca sin degradar, y el peor prompt **sin
degradar** de todo el corpus es:

```
n02  negocio · conversación cargada · search_listings   1374 tokens   ← +174 sobre el techo de 1200
n01  negocio · conversación cargada · get_open_listing  1317          ← +117
n04  negocio · conversación cargada · get_open_listing  1309          ← +109
n02  negocio · primer mensaje       · search_listings   1310          ← +110
t04  reserved · conversación cargada · get_open_listing 1235          ← +35 (el peor de §2.7)
```

**Y así entra hoy, en el mismo barrido con el techo en 1200:**

```
n01  1200 de 1200   tira 6 medios de pago + 4 turnos de historial
n02  1198 de 1200   tira 6 medios de pago + 4 turnos de historial + 2 chunks
n04  1196 de 1200   tira 6 medios de pago + 4 turnos de historial
n03  1200 de 1200   tira 1 medio de pago          (sin tool: la ficha sola ya raspa el techo)
```

**De los 9 prompts que degradan en todo el corpus, 7 son la ficha del plan Negocio** (los otros 2
son `reserved` × conversación cargada, que era el hallazgo de §2.7). No es un caso de borde que
apareció: es el caso que el plan de USD 35 promete.

`turnsDropped = 4` sobre un historial de 4 turnos es **el historial entero**. Traducido: **el tenant
que más paga es el único al que el chatbot se le olvida la conversación**, y le pasa justo en el
turno en que el modelo pidió un dato para contestar mejor. Los 3 puntos de retiro sobreviven porque
un caso del corpus lo exige (`promptMustContain: ['General Roca']`); los 6 medios de pago y la
memoria de la charla no los exige nadie, así que son lo que la escalera tira.

**El techo mínimo que elimina toda la degradación del corpus es 1374**, medido barriendo techos:

```
techo    prompts armados sin recortar nada    qué se sigue cayendo
1200          153 / 162                       9 medios de pago · 8 historial · 2 chunks
1250          157 / 162                       5 medios de pago · 4 historial
1300          158 / 162                       4 medios de pago · 1 historial
1350          161 / 162                       1 medio de pago          ← 1350 NO alcanza
1374          162 / 162                       nada                     ← el mínimo que limpia
```

#### 5. Cuánto cuesta subir el techo — es una medición, y la decisión NO es mía

`MAX_INPUT_TOKENS = 1200` lo fijó el humano en el goal. **No lo cambio, no lo propongo como hecho
consumado y no es una recomendación de arquitectura: es el precio, y va con dueño.** Lo que sigue es
lo que cuesta comprarlo, medido de tres formas, porque el número depende enteramente de contra qué
techo se lo compare.

```
subir MAX_INPUT_TOKENS de 1200 a 1374 (el mínimo que limpia el corpus)

[ESPERADO, MEDIDO — re-corriendo el corpus entero con el techo movido]
  USD 0,0989 → 0,0992 /1000 msgs de vidriera
  × 1.200 msgs/mes                                          = +USD 0,00047 /tenant/mes

[TECHO ESTRUCTURAL, turno con tool, primario sano — 2 llamadas]
  2 × 174 tok × USD 0,10/1M = +USD 0,0000348 /msg
  × 1.200 msgs/mes            (0,4608 → 0,5026)             = +USD 0,0418  /tenant/mes

[TECHO ESTRUCTURAL, las 3 llamadas que el código permite — §2.8.3b, VIGENTE desde `89ab7c0`]
  2 × 174 × USD 0,10/1M + 1 × 174 × USD 0,075/1M = +USD 0,00004785 /msg
  × 1.200 msgs/mes            (0,6336 → 0,6910)             = +USD 0,0574  /tenant/mes
     (con las 4 llamadas de antes de `89ab7c0` este renglón decía +USD 0,0731 y 0,8064 → 0,8795)
```

**Contra el USD 1,00 de asignación de chat del plan Negocio: entre 0,05 % y 5,7 %.** Contra los
USD 35 de lista: entre 0,001 % y 0,2 %. A 100 tenants Negocio, el peor caso son **USD 5,74/mes** de
flota entera. *(La rama del techo se abarató sola el 2026-08-28: con las 4 llamadas anteriores a
`89ab7c0` el extremo era 7,3 % y USD 7,31. **La decisión sigue exactamente igual de abierta** — lo
único que cambió es que la rama cara de su precio es un 21 % más barata.)* **Es ruido en la factura, y ruido es exactamente lo que hay que decir**, porque tiene
una consecuencia que no es de plata:

> **Si subir el techo cuesta ruido, entonces el 1200 no se está pagando con plata: se está pagando
> con calidad.** Y una decisión que no se paga con plata no la puede arbitrar el auditor de costo.
> **Costo no tiene objeción a ninguna de las dos ramas** —ni subir el techo, ni achicar la ficha del
> plan Negocio, ni dejarlo como está—; lo único que hago es sacarle el disfraz de trade-off
> económico, porque no lo es. Si alguien quiere sostener el 1200, el argumento no tiene que pelear
> contra ningún número mío.

**`PENDIENTE DE DECISIÓN HUMANA.`** El 1200 es del goal del humano. Lo que yo aporto es el precio y
tres acotaciones que la decisión necesita:

1. **1374 es un piso, no el número final.** Sale de las cuatro fixtures del corpus, no de fichas
   reales: una descripción de dueño más larga o un cuarto punto de retiro lo suben. `listing-view.ts`
   recorta la descripción, así que hay una cota superior — **no la medí**.
2. **El techo de llamadas se acerca al objetivo antes que el de la dieta.** Con 1374, el peor caso
   absoluto queda en **USD 0,6910 contra 1,00: 1,45× de headroom** *(era 0,8795 y 1,14× con las 4
   llamadas de antes de `89ab7c0`; §2.8.3b)*. Subir el techo es barato; subir el techo *y* no tener
   contador del soft cap ya no lo es tanto.

   **La aritmética a la vista, porque es el número que otras filas citan y no puede quedar mágico**
   — composición cara (B): 2 primarios + 1 fallback, IN 1374, OUT 180:

   ```
   2 × (1374 × USD 0,10/1M  + 180 × USD 0,40/1M)  = 2 × 0,0002094  = USD 0,0004188
   1 × (1374 × USD 0,075/1M + 180 × USD 0,30/1M)  = 1 × 0,00015705 = USD 0,00015705
                                                                     ────────────────
                                                                     USD 0,00057585 /mensaje
   × 1.200 msgs/mes al soft cap                                    = USD 0,6910 /tenant/mes
   headroom contra el 1,00 de chat: 1,00 / 0,6910                  = 1,45×
   delta contra los 1200 de hoy:    0,6910 − 0,6336                = +USD 0,0574 /tenant/mes
   ```
   *(Con las 4 llamadas de antes de `89ab7c0` la segunda línea iba × 2 y daba USD 0,0007329/msg,
   USD 0,8795/mes y 1,14×. **Ése es el par que quedó citado afuera de este documento** — si alguna
   fila del board todavía dice `0,8795 / 1,14×`, está calculada con el techo de 4 llamadas y el
   número vigente es **0,6910 / 1,45×**. Como siempre en este archivo: el recálculo es mío, no de
   quien cita.)*
3. **C6 antes que el techo.** Hoy `buildChatContext` devuelve un `ContextTrimReport` que **no lee
   ningún consumidor** — cero llamadores de `.trimmed` fuera de los tests, re-verificado hoy. Un
   techo más alto sin contador te deja en el mismo lugar la próxima vez que la ficha crezca 200
   tokens, y esta vez ya sabemos que crece: entre §2.7 y §2.8 el peor prompt sin degradar pasó de
   1251 a 1374 en un día, sin que nadie tocara `budget.ts`.

> **Y la cuenta gruesa del encargo, para que quede el método y no sólo el resultado.** El LEAD
> estimó ~USD 0,017/tenant/mes para 1200 → 1350. Reproduje de dónde sale: `150 tok × 1.200 msgs ×
> USD 0,10/1M = USD 0,018`, que es **una** llamada por turno. Con las dos que paga un turno con tool
> son **USD 0,036**, y con 1374 en vez de 1350 son **USD 0,042**. O sea que la cuenta gruesa repite,
> un nivel más arriba, exactamente el defecto que C8 acaba de cerrar en el código: contar un turno
> con tool como si mandara el prompt una sola vez. **La conclusión no cambia —sigue siendo ruido—
> pero el factor 2 sí, y es el mismo factor 2 de toda esta ronda.**

#### 6. Conciliación con `config/firewall-rules.json`, para que no queden dos archivos peleados

El `why` de `chatbot-rl` cita hoy tres precios de los mismos 86.400 msgs/mes/IP/región que la regla
`20 / 600 s` permite. **Verifiqué los tres y se sostienen**; agrego los dos extremos que faltaban,
porque el peor caso por IP **es un rango y citar un punto es lo que produjo la deriva anterior**:

```
86.400 msgs/mes desde UNA IP y UNA región, dentro de lo que la regla PERMITE

  USD  8,54   esperado de vidriera, con la tasa de derivación medida (0,00009885/msg)
  USD 10,86   promedio FACTURADO re-medido        (0,0001257/msg)   ← el que cita la regla
  USD 16,59   techo de un turno de UNA llamada    (0,000192/msg)    ← el que cita la regla
  USD 33,18   techo del turno con tool, 2 llamadas (0,000384/msg)   ← el que cita la regla · MI HALLAZGO, SE SOSTIENE
  USD 45,62   techo con tool y el primario contestando vacío, 3 llamadas (0,000528/msg)  ← §2.8.3b, VIGENTE
              (decía USD 58,06 con las 4 llamadas de antes de `89ab7c0`; el extremo bajó, no desapareció)
```

**Los USD 33,18 de §2.6.6 quedan intactos** y su lectura también: dejan al tenant abusado en
USD 33,18 de costo contra USD 33,97 de ingreso neto, o sea USD 0,79 de margen. **Lo que agrega
§2.8.3b es que el extremo del rango cruza el precio del plan:** con el primario degradado, esa misma
IP —sin violar la regla ni una vez— cuesta **USD 45,62 contra USD 33,97 de ingreso: pérdida de
USD 11,65**. No es el escenario esperado y requiere un primario degradado, pero es el techo que el
código permite, y §2.6.6 afirmaba que *«el tenant abusado ya no es pérdida por sí solo»*. **Con el
rango completo, esa frase vale para 4 de los 5 precios y no para el quinto.**

> **`89ab7c0` bajó el quinto precio y no lo borró, que es la parte que importa.** Con las 4 llamadas
> anteriores la pérdida era USD 24,09; con 3 es **USD 11,65**. El salteo del primario vacío se llevó
> puesta la mitad del agujero, **no el agujero**: el extremo del rango sigue estando arriba del
> precio del plan, y lo seguiría estando aunque el techo fuera de 2 llamadas (USD 33,18 contra
> 33,97 deja USD 0,79). Lo que acota esto no es el techo por turno, es el contador del soft cap, que
> sigue sin existir.

**Lo que no cambia, y es el punto entero:** el WAF no es el techo de la factura. Los contadores son
por región (`$per_region`), así que una IP repartida sobre ~5 regiones multiplica las cinco líneas
de arriba por 5. Lo único que acota el gasto **por tenant** es el soft cap, que sigue siendo una
función pura sin contador (§2.6.4). Entre lo que el WAF deja pasar y el break-even del plan no hay
nada más que esa función.

#### 7. Veredicto de S8.1

```
COST_VERDICT: PASS

DELTA_POR_TENANT_MES:  hoy en producción              USD 0,00      (nada invoca `@istock/ai`)
                       Negocio al soft cap, esperado  USD 0,1186    [CALC-STUB, MEDIDO con `billed`]
                       Negocio al soft cap, techo     USD 0,4608    [ESTRUCTURAL, turno con tool]
                       Negocio al soft cap, techo abs USD 0,6336    [ESTRUCTURAL, las 3 llamadas de §2.8.3b]
                         (decía 0,8064 con las 4 llamadas de antes de `89ab7c0`; −21,4 %, y el eval
                          no se movió ni un dígito: se compró seguro, no ahorro — §2.8.3b)

  0,00009885 /msg = (1173 tok IN × USD 0,10/1M + 21 tok OUT × USD 0,40/1M) × (162/206)
  0,1186 /mes     = 0,00009885 × 40 msgs/día × 30 días
  el renglón anterior (0,00008501) SUBFACTURABA: `promptTokens` era un `Math.max` y contaba una vez
  un turno que manda el prompt dos veces. +16,3 %, de los cuales +14,2 % es la contabilidad (C8) y
  +1,9 % es el corpus que sumó la ficha del plan Negocio. Nada se encareció.

SUPUESTOS: 40 msgs/tenant/día [EST, sin medición — sigue siendo el supuesto más flojo] · 30 días ·
           `gemini-2.5-flash-lite` primario / `openai/gpt-oss-20b` fallback · derivación 162/206
           MEDIDA sobre corpus, no sobre tráfico · driver `stub`: el OUT=21 lo produce el stub (B4) ·
           fracción de turnos con tool: 14,8 % en el corpus, DESCONOCIDA en producción y casi seguro
           más alta · **el primario contesta siempre a la primera** (si no, §2.8.3b: hasta 3
           llamadas facturadas, y la composición cara son 2 primarios + 1 fallback)

VECTOR_MAS_RIESGOSO: **la llamada facturada que nadie contaba: el primario que devuelve `200` con
           texto vacío.** No tira, no aparece en Sentry, no rompe ningún test y **encarece el turno
           un 37 %** — `billed.calls = 3` medido, techo USD 0,000528/msg, USD 0,6336/mes al soft
           cap, 1,58× bajo el presupuesto de chat en vez de 2,2×. Es peor que el soft cap sin
           contador en una propiedad: el soft cap ausente es un techo que falta, éste es un techo
           que **creíamos tener**. *(Este renglón decía `calls = 4`, USD 0,000672 y 1,24×.
           `89ab7c0` cerró C11 —el primario vacío no se reintenta en la misma vuelta— y el techo
           bajó a 3 llamadas; §2.8.3b. **El vector no desapareció:** la llamada de más se sigue
           facturando, sólo que una vez por turno en vez de una por ronda. Lo que sí cambió es que
           ahora hay una constante exportada y un test que la clavan, así que dejó de ser un techo
           que sólo existía en la cabeza del que leyó el archivo.)* Y correlaciona: «modelo barato bajo carga» le pasa a muchos turnos
           a la vez. La degradación silenciosa de §2.7 sigue vigente y sigue ocurriendo —hoy en 9 de
           162 prompts armados, y **7 de esos 9 son la ficha del plan Negocio**—; ésta la desplaza
           sólo porque cuesta plata además de calidad.

METRICA_A_VIGILAR: **`billed.primaryServedEmpty` por turno. Alarma en cualquier `true`.**
           *(Este renglón decía «`billed.calls` > 2» y el LEAD lo arbitró el 2026-08-28 —`CLAUDE.md`
           §5, «Una alarma se verifica en las dos polaridades»— después de que yo destapara que el
           turno quemado reporta `calls: 0`. **`calls > 2` falla en las DOS direcciones:** por arriba
           enciende con tráfico legal —con el techo en 3, el turno degradado normal factura 3 y
           cruza—, y por abajo no ve el caso patológico. No es un umbral flojo: está
           anti-correlacionado con lo que dice medir.)*
           `primaryServedEmpty` es la señal de **degradación** y es la que avisa antes que la
           factura: un primario que devuelve `200` con texto vacío se factura igual, manda al
           fallback y encarece el turno **sin un solo error en el log**. No depende del contador, así
           que sobrevive tanto al arreglo de la medición perdida como a un cambio del techo.
           **Las otras dos condiciones no son variantes de ésta y no se pueden colapsar en un
           umbral:** `handoff === 'provider_down'` es el **turno quemado** (se pagó y no contestó), y
           `calls > MAX_BILLED_CALLS_PER_TURN` es una aserción de **control de flujo**, no una alarma
           de costo — si enciende, es un bug, no tráfico. Un dashboard de tokens no ve ninguna de las
           tres: los tokens por llamada siguen bajo 1200 por construcción. La métrica de calidad de
           §2.7 (`turnsDropped + chunksDropped + descriptionDropped > 0`) **no se reemplaza, se
           acompaña**: hoy daría distinto de cero en 9 de 162 prompts armados, y **7 de esos 9 son la
           ficha del plan Negocio**.
```

**Recomendaciones nuevas, con dueño, sin implementarlas:**

| # | qué | dueño | por qué es de costo |
|---|---|---|---|
| **C10** *(umbral arbitrado por el LEAD el 2026-08-28 — `CLAUDE.md` §5)* | emitir `billed` al log estructurado y alarmar con **tres condiciones**, no con un umbral: `billed.primaryServedEmpty === true` (**degradación**) · `handoff === 'provider_down'` (**turno quemado**) · `calls > MAX_BILLED_CALLS_PER_TURN` (**aserción de control de flujo**, no alarma de costo). El campo ya existe y **no lo lee nadie** — *«se descarta en el borde» era generoso: todavía no hay borde, `answerChat` no tiene un solo llamador fuera del paquete* | `ai-agent` (el campo, **hecho**: `index.ts` exporta `BilledUsage`, `ChatAnswer` y `MAX_BILLED_CALLS_PER_TURN`) · `app-agent` (el log, **espera FASE 5**: `/api/chat` no existe) | es el único indicador que distingue el techo real del techo que creíamos tener; sin él, un primario degradado encarece la factura en silencio. ~~**El umbral `> 2` no se movió con `89ab7c0`**~~ **El umbral `> 2` se cayó entero el 2026-08-28, y lo que lo mató fue medirlo en las dos polaridades.** Por arriba enciende con **tráfico legal**: con el techo en 3, el turno degradado normal —primario cobra un `200` vacío, contesta el fallback— factura 3 y cruza. Por abajo **no ve el caso patológico**: cuando los dos proveedores contestan vacío, el turno pagó dos llamadas y reporta `calls: 0`, porque el `throw` descarta la medición. **Un umbral por arriba no puede detectar una medición que se pierde.** Yo lo había escrito como «necesario pero no suficiente» —`calls = 2` son dos historias, el camino feliz con tool y el turno de una ronda que pagó un primario vacío—; el LEAD lo arbitró más fuerte y tiene razón: no es insuficiente, **está anti-correlacionado**, porque alarma sobre lo que el diseño contempla y calla sobre lo que lo rompe. De ahí las tres condiciones con tres trabajos. `BilledUsage.primaryServedEmpty` ya existe y es la primera de las tres |
| ~~**C11**~~ **CUMPLIDA el 2026-08-28 (`89ab7c0`)** | ~~decidir qué pasa cuando el primario contesta vacío **dos veces en el mismo turno**: hoy son 4 llamadas facturadas y ninguna constante lo dice~~ **Hecho, y con la constante:** el primario que atiende y contesta vacío no se reintenta en lo que queda del turno (`skipPrimary` + `primaryServedEmpty`), y el techo dejó de ser un literal — `MAX_BILLED_CALLS_PER_TURN = TURN_ROUNDS + 1 = 3`, derivado de `MAX_TOOL_ROUNDS` | `ai-agent` | **la palanca más barata del documento, y salió más barata de lo que rinde: −21,4 % del techo absoluto (0,8064 → USD 0,6336/mes), no el −29 % que yo estimé.** Mi cuenta restaba una llamada del primario y eso vale para una de las dos ramas de 3 llamadas, no para la cara (§2.8.3b). **Y el eval no se movió ni un dígito:** lo que se compró es seguro contra el día malo, no un ahorro de hoy |
| **C9** *(actualizado — **es la entrada VIGENTE**; la de §2.7 quedó marcada `SUPERADA`, y con ella el dueño `ai-agent` que decía)* | el precio de comprar la degradación entera **se re-midió con la ficha del plan Negocio adentro**: subir `MAX_INPUT_TOKENS` de 1200 a **1374** (no 1260) elimina las degradaciones del corpus y cuesta entre **USD 0,00047 y USD 0,0574/tenant/mes** (§2.8.5 — la rama cara decía 0,0731 hasta `89ab7c0`, que bajó el techo de llamadas; **la decisión no se movió, sólo su precio**). **Decisión humana pendiente, y sigue abierta:** el 1200 es del goal | humano, con los números de acá | las dos ramas son ruido en la factura, así que la factura no puede arbitrarla |

> **El turno que falla entero subfacturaba, y el precio de eso no era plata: era que la alarma de
> `C10` quedaba ciega justo donde importa.** Cuando primario **y** fallback contestaban `200` vacío,
> `generateWithFallback` acumulaba `servedCalls` en locales y después **tiraba**
> (`AI_PROVIDER_FAILED`); el `catch` de arriba derivaba a WhatsApp con `handoff: 'provider_down'` y
> reportaba el `billed` **de las rondas anteriores**, perdiendo las de la ronda que falló — en el
> turno de una sola ronda, que es el caso normal, eso era `calls: 0`. Las dos llamadas **se pagaron**.
>
> **CERRADO en el árbol de hoy, y lo verifiqué leyéndolo, no de memoria.** La ronda que falla se
> **devuelve** en vez de tirarse (`RoundOutcome` con `ok: false`), y `answerChat` llama a `addBilled`
> **antes** de mirar si hubo respuesta, en las dos rondas; los dos `return answerFromHandoff(...
> 'provider_down' ...)` pasan el `billed` acumulado. El turno que se quema ahora reporta las llamadas
> que pagó. Lo de abajo se conserva porque es el argumento que mató al umbral, y **el arbitraje del
> LEAD no depende de este arreglo**: la pata «por arriba» —el turno degradado normal factura 3 y
> cruza con tráfico legal— vale igual. Lo anoto acá porque el
> encargo preguntó si tiene consecuencia de costo que yo no esté viendo. **Tiene una, y no era el
> techo:**
>
> 1. **El techo no se mueve y no se movía.** Ese camino factura **2** llamadas y termina el turno,
>    así que está por debajo de `MAX_BILLED_CALLS_PER_TURN = 3`. Ningún número de §2.8.3b cambia.
> 2. **La alarma sí, y se llevó puesto el umbral.** `C10` proponía alarmar en `calls > 2`, y el
>    turno completamente fallado reportaba `0` (hoy ya no, ver arriba): no cruzaba el umbral **por
>    abajo**. Un umbral por arriba
>    no puede detectar una medición que se pierde. **El LEAD lo arbitró el 2026-08-28** (`CLAUDE.md`
>    §5) y el veredicto es más fuerte que mi reporte: `calls > 2` falla también **por arriba**,
>    porque con el techo en 3 el turno degradado normal factura 3 y cruza con **tráfico legal**. O
>    sea que el instrumento alarma sobre lo que el diseño contempla y calla sobre lo que lo rompe:
>    no es un umbral flojo, está **anti-correlacionado**. Quedan tres condiciones con tres trabajos
>    —`primaryServedEmpty` (degradación) · `provider_down` (turno quemado) · `calls >
>    MAX_BILLED_CALLS_PER_TURN` (aserción de control de flujo)— y `C10` y §5 ya están actualizados.
> 3. **Y los dos instrumentos se mueven en direcciones opuestas sobre el mismo evento.** El visitante
>    cuyo turno falló **reintenta**, así que `mensajes por tenant por día` —la métrica de §9, la que
>    avisa antes— **sube** mientras `billed.calls` **baja**. Un dashboard que mire los dos a la vez
>    va a leer «más tráfico, menos costo por mensaje» en el momento exacto en que el proveedor se
>    está degradando. Es la misma clase de defecto que C8: un número bien calculado contestando otra
>    pregunta, ahora con el signo invertido.
>
> **Corolario para quien escriba el emisor en FASE 5, escrito para sobrevivir al arreglo.** Yo había
> propuesto cruzar `calls` con `handoff` porque *«`calls = 0` con `provider_down` es plata quemada y
> `calls = 0` con `soft_cap` es plata no gastada»*. Eso era correcto sólo mientras la medición se
> perdía. **Ya no se pierde:** `ai-agent` cerró los dos sitios donde ocurría —el camino de falla de
> `answerChat` y el del loop de rondas de tool— devolviendo la ronda fallada como valor
> (`RoundOutcome`) y cobrando con `addBilled` antes de preguntar si hubo respuesta, así que el turno
> quemado reporta **`calls: 2` con `provider_down`**, no `calls: 0`. **La firma estable del turno
> quemado es `handoff === 'provider_down'`, no el valor del contador**, y así hay que escribir la
> condición: el cruce con `handoff` sigue haciendo falta —distingue quemado de derivado— pero el
> `calls = 0` ya no es su firma y no hay que esperarlo. El sesgo hacia abajo que este párrafo
> anunciaba **no llega a producción**: se cerró antes de que existiera `/api/chat`. No cambia ningún
> precio de este documento —el techo ya contaba esas llamadas—; cambia qué se va a poder medir en
> producción, que es lo que dice §7 (B4).

## 3. Techo de LLM a 50 tenants `negocio`

**Actualizado el 2026-08-28 con la eval de §2.6 y re-medido el mismo día con la de §2.7.** El bloque
original calculaba con la dieta **en el techo** (1.200 in / 180 out para todos los turnos); eso
sigue siendo la cota correcta y se conserva, pero ahora hay un esperado al lado. **El techo de abajo
subestima por un factor 2**: un turno con tool manda el prompt dos veces (§2.7 §3), así que la cota
real a 50 tenants es `2 × 72,0M in` y `2 × 10,8M out` → **USD 17,28 – 23,04/mes**. Sigue siendo
decenas de USD y el techo de FASE 0 se cumple igual.

```
[TECHO ESTRUCTURAL — la dieta llena, todos los turnos facturados]
50 tenants × 40 msgs/día × 30 días = 60.000 msgs/mes
60.000 × 1.200 tokens in  =  72,0M tokens in
60.000 ×   180 tokens out =  10,8M tokens out
```
**USD 8.64 – 11.52/mes** con `gemini-2.5-flash-lite` (R3). Es **decenas de USD, no cientos**: el
techo de FASE 0 se cumple.

```
[ESPERADO — CALC-STUB, con el consumo MEDIDO del corpus de 206 casos y `billed` (§2.8)]
60.000 msgs de vidriera × USD 0,00009885  =  USD 5,93 /mes  con los 50 tenants EN el soft cap
   de esos, 47.184 llegan al modelo (78,64%) : 55,3M tokens in facturados · 0,99M tokens out
   los otros 12.816 se derivan antes          : USD 0,00

   [TECHO con tool, 2 llamadas]  60.000 × USD 0,000384  =  USD 23,04 /mes · 144M in · 21,6M out
   [TECHO absoluto, 3 llamadas]  60.000 × USD 0,000528  =  USD 31,68 /mes  (§2.8.3b; era 40,32
                                 con las 4 llamadas de antes de `89ab7c0`)
```
**USD 5,93/mes para los 50 tenants juntos** — o sea **USD 0,1186 por tenant**, 3,9× abajo del techo
con tool y **5,3× abajo** del techo absoluto *(era 6,8× cuando el techo absoluto eran 4 llamadas: el
techo bajó, así que el esperado quedó **más cerca** de él, no más lejos)*.

> Los renglones viejos de este bloque decían `0,00008501 → USD 5,10` y `0,00009498 → USD 5,70`. El
> primero **subfacturaba** (`Math.max` en vez de suma) y el segundo era mi **estimación** de la
> corrección. Con C8 aterrizado, el número **medido** es el de arriba: la estimación quedó 4,1 %
> abajo y la diferencia es el corpus, no el método (§2.8.2).
Y el número que hay que retener no es ninguno de los dos sino la distancia entre ellos: **la
diferencia entera es el promedio de tokens OUT, que hoy lo produce un stub.** Con B4 abierto, el
número prudente para presupuestar sigue siendo el techo.

**Hoy el gasto real es USD 0,00**: no hay credenciales (B4) y, más definitivo todavía, no hay
consumidor — nada importa `@istock/ai` (§2.6.4).

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
| DB | **% de hits de vidriera que llegan a Postgres** | **> 5%** — **hoy en 4,6% `[EST]` (§2.5.1)**, después de que la palanca de §2.4.5 se accionara en `f504d69`. Sigue sin ser la métrica que avisa: es la consecuencia |
| **DB (la que avisa antes)** | **radio de purga de una mutación de unidad = páginas que registran el tag emitido** | **> 2** (grilla + ficha propia). **Hoy vale 2 y está MEDIDO**, no leído: V9 de `accept-s6.sh` lo cuenta desde `MEDIDO s6 radio` con `esperado=2`. Es la única alarma de este documento que ya tiene gate ejecutable |
| **cron (la que avisa antes)** | **`stuck` y `unrecorded` de `cron.expire_reservations.degraded`** | **> 0, cualquiera de los dos.** **Corregida contra `b9a8e05`: la versión anterior de esta fila pedía contar corridas consecutivas de `…done` con `scanned > 0` y `expired + released == 0`, y cerraba con «hoy no la emite nadie».** Ya la emite alguien, y mejor que lo que yo había pedido: el predicado cross-run que yo modelaba con dos corridas ahora es **una sola** lectura, porque `stuck` significa «falló una fila que ya venía fallando» (`sweep_attempts >= 1` **antes** de este intento) y eso sólo se puede saber con la columna que antes no existía. `unrecorded` es el caso peor y va en rojo desde la primera: falló la fila **y** falló el `+1`, o sea que el head-of-line vuelve entero y sin síntoma. Los dos son distintos de `failed` a propósito — el dueño cancelando desde el mostrador la misma reserva que el barrido está venciendo produce un `40P01` legítimo, y un cron que se pinta de rojo por eso enseña a ignorar el rojo |
| **cron** | **`abandoned` de `cron.expire_reservations.degraded`** | **> 0** — **esta fila reemplaza a la anterior, que quedó obsoleta con `b9a8e05`.** Decía «`failed > 0` sostenido sobre la MISMA fila», porque una fila rota conservaba su lugar en el `order by expires_at asc` y se reintentaba 8.640 veces/mes mientras la vidriera prometía «si la reserva se cae, avisamos» y el panel decía «se libera en unos minutos». **Nada de eso sigue siendo cierto**: el orden arranca por `sweep_attempts`, el techo son 5 intentos, el copy de las dos pantallas se reescribió (§2.5.3) y el route devuelve **500**. Lo que hay que mirar ahora no es el reintento —ya no existe— sino el **residuo**: cada unidad contada en `abandoned` está trabada en `reserved` hasta que una persona apriete «Liberar equipo». Cuesta ~USD 0 nuestros y **USD 15 – 22/mes del tenant**, y a diferencia de `stuck`/`unrecorded` **sigue en rojo en las corridas siguientes**, que es lo que se quiere: no es un incidente que pasó, es un estado en el que está la base |
| **cron** | duración y Active CPU de una corrida vacía | **> 2 s de wall time** — hoy es horquilla `[EST]` de 4,8× y es el único término del piso de S6 que no está medido (§2.4.1) |
| cache | `x-vercel-cache: HIT` ratio en vidriera | cualquier caída sostenida |
| cache | `set-cookie` en respuesta de `(storefront)` | **cualquiera** — apaga el CDN entero |
| imágenes | ratio Class A / fotos procesadas | **> 5** (anomalía, no capacidad; el valor de diseño es **4**, en el tipo: `classAOps`) |
| **imágenes** | **ms de CPU de `buildVariants` por foto subida** | **> 1.500 ms** (2,2× los 677 ms medidos en S2). **Es la única métrica de S2 que no se deduce de los bytes**: la salida puede pesar exactamente lo mismo mientras el costo se duplica |
| imágenes | bytes de la variante que el browser **elige** (no la que el gate mide) | que `sizes` falte y la grilla baje `detail` (128.570 B) donde el modelo dice `card` (50.692 B) — §2.2.7 |
| imágenes | `MEDIA_DRIVER` y `NEXT_PUBLIC_MEDIA_BASE_URL` del deploy de producción | **cualquier valor que no sea `r2` / `https://img.maat.work`** — es la única forma de que un byte de foto salga por Vercel (§2.2.2) |
| storage | GB por tenant | huérfanos de listings borrados — hoy **crecen sin techo**: `collectOrphanObjects` existe y **no tiene caller** |
| **LLM (la que avisa antes)** | **mensajes de chat por tenant por día** | **> 40** (el soft cap) y **FAIL de costo > 50** — donde el chat se comía su presupuesto de 1,00 entero con el peor caso que el código permitía hasta `89ab7c0` (4 llamadas facturadas por turno). *(Esta fila decía 174, que salía del techo de una sola llamada; con el turno con tool son 87 y con las 4 llamadas, 50.)* **El 50 se DEJA como está y ahora es conservador a propósito:** con el techo de 3 llamadas de §2.8.3b el punto de FAIL se corrió a **63/día**, así que alarmar en 50 avisa **1,26× antes** de que duela. Bajar una alarma porque el código mejoró sería gastarse la mejora. **Hoy NO EXISTE**, y no por olvido: es el mismo objeto que el contador del soft cap, que tampoco existe (§2.6.4). Construir la métrica **es** implementar el cap. El techo del WAF que hoy la sustituye deja pasar **2.880/día/IP/región** (20/600s), o sea 72× la alarma |
| LLM | **tokens reales/turno por tenant** | > 1200 in o > 180 out, o modelo frontier en el log. El techo está **enforced** (`assertWithinBudget` tira; `env.ts` deja bajar `LLM_MAX_OUTPUT_TOKENS`, nunca subirlo), así que esta métrica no vigila el techo: vigila que el `usage` real del proveedor coincida con nuestro estimador. Alarma práctica el día que cierre B4: **OUT p95 > 60** (3× el promedio del stub) |
| **LLM (la más barata de emitir)** | **`billed.primaryServedEmpty` por turno** | **cualquier `true`** — es la señal de **degradación**: un primario que devuelve `200` con texto vacío **se factura igual**, manda al fallback y encarece el turno **sin un solo error en el log**. Es lo que separa el techo de USD 0,000384 del de USD 0,000528 (§2.8.3b), y no depende del contador, así que no se rompe cuando cambie el techo. *(**Esta celda decía `billed.calls > 2` y el LEAD la arbitró el 2026-08-28** — `CLAUDE.md` §5. `calls > 2` falla en las dos direcciones: por arriba enciende con tráfico legal, porque con el techo en 3 el turno degradado normal factura 3 y cruza; por abajo no ve el turno quemado, que reporta `calls: 0` porque el `throw` descarta la medición. Alarmar sobre lo que el diseño contempla y callar sobre lo que lo rompe no es un umbral flojo: es un instrumento anti-correlacionado con lo que dice medir.)* **Van con ella, y son otras dos preguntas, no variantes:** `handoff === 'provider_down'` para el **turno quemado** —se pagó y no contestó— y `calls > MAX_BILLED_CALLS_PER_TURN` como **aserción de control de flujo**: si enciende es un bug, no tráfico, y por eso se escribe contra la constante exportada y no contra un literal. `chat.ts` ya calcula las tres y no las lee nadie: emitirlas es cablear campos que existen, no construir un contador. Un dashboard de tokens no ve ninguna — cada llamada sigue bajo 1200 por construcción |
| **LLM** | **`null` de `priceFor(modelId)` en el reporte de costo** | **cualquiera** — significa que `LLM_PRIMARY_MODEL` cambió a un ID que `pricing.ts` no conoce y el costo dejó de estar contabilizado. El módulo hace lo correcto (devuelve `null`, no cero), pero un `null` que nadie mira es un cero con otro nombre |
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
daño no aparece en ningún diff) ·
**agregado en S6: una mutación de UNA unidad que emita un tag registrado por las fichas de las
OTRAS unidades** — es el caso «cache mal invalidada» de `CLAUDE.md` y costaba 8× la alarma del
vector de DB. **Arreglado en `f504d69` y medido: radio 2** (§2.5.1). La regla queda como fallo
automático permanente: **la slice que vuelva a subir el radio arriba de 2 es FAIL de costo**, y no
se discute leyendo el diff — se mide con V9 de `accept-s6.sh`, que lo **cuenta**. ·
**agregado el 2026-08-28: un job periódico que devuelva `200 OK` en una corrida donde vio trabajo y
no aterrizó nada** — el barrido de reservas lo hacía (`{ ok: true, scanned: 200, failed: 200 }`), y
desde el dashboard de Vercel Cron era indistinguible de una corrida perfecta. **Ya no: `b9a8e05`
devuelve 500 con `stuck`/`unrecorded`/`abandoned`.** La regla queda como fallo automático
permanente para el próximo job que se escriba. La falla total de un
job no puede parecerse a su éxito total: **el precio no lo pagamos nosotros, lo paga el tenant
(USD 15 – 22/mes por unidad trabada, ≈ el abono del plan Base) y termina en churn** (§2.5.3). ·
**y su hermano: una fila que falla y conserva su lugar en la cola de un barrido ordenado** — sin
contador de intentos, el `order by` la pone primera para siempre y el trabajo del resto de los
tenants queda detrás de ella.
*(Los dos están **cerrados en el código** desde `b9a8e05` —`sweep_attempts`, techo de 5, censo de
abandonadas y `500`— y **gateados** por V10 de `accept-s6.sh` contra Postgres real. Quedan como
fallo automático permanente: la slice que los reabra es FAIL de costo. El «USD 0,0015/mes» que esta
línea decía era del modelo viejo de 8.640 reintentos y está corregido en §2.5.3.)* ·

**Agregados el 2026-08-28 con `packages/ai` (§2.6):**
**`/api/chat` desplegado sin contador de mensajes por tenant/día** — el soft cap de 40 es hoy una
función pura (`softCapReached`) que lee un número que **nadie produce**; sin contador el único techo
es la regla de WAF, hoy `20 / 600 s` por IP, que permite 2.880 msgs/día/IP/región y cuesta
**USD 6,91 – 16,59/mes** (§2.6.6, corregido: decía 12/min y USD 41 – 99). **La forma del agujero
cambió el 2026-08-28 y el fallo automático se queda:** el `0` fijo ya no compila —`ChatInput.usage`
es un parte marcado con un `unique symbol` no exportado y sin él el chat tira `AI_USAGE_UNMEASURED`
(C2 cumplida)—, así que el modo de falla dejó de ser silencioso y pasó a ser ruidoso. Pero un
`usageMeasured(0)` escrito para «hacer andar el deploy» apaga el cap igual, y esa firma es
deliberadamente incómoda de escribir, no imposible ·
**`chatbot-rl` en `planned` con la ruta `/api/chat` ya aterrizada** — la regla y el handler van en
el mismo commit, o hay una ventana sin techo de ninguna clase ·
**agregado el 2026-08-28 (§2.7): un `ContextTrimReport` con algo distinto de cero que nadie mira** —
si `context.ts` tira historial, chunks o la descripción del dueño para que el prompt entre en 1200,
la factura **no** se mueve y ningún test se pone rojo: se degrada la respuesta. Es el único vector
del documento cuyo síntoma es de calidad y no de plata, y por eso el reporte tiene que salir al log
antes de que exista tráfico. **Ya no es hipotético:** medido a mano, el turno con tool sobre la
ficha `reserved` en conversación cargada degrada en **65 de 65** preguntas ·
**un ID de modelo en `LLM_PRIMARY_MODEL` que `pricing.ts` no conoce**, desplegado a producción: el
reporte de costo devuelve `null` (bien) y nadie lo mira (mal), o sea que el vector más caro del
producto deja de estar contabilizado sin que se caiga nada ·
**aflojar la dieta**: subir `MAX_INPUT_TOKENS`/`MAX_OUTPUT_TOKENS` de `budget.ts`, o sacar el
`assertWithinBudget` del camino al proveedor, o subir `MAX_TOOL_ROUNDS`, o **agregar un intento más
a `generateWithFallback`**, o **sacar el salteo del primario vacío**. Son **cinco** aserciones, no
tres (§2.8.3 encontró la cuarta y §2.8.3b la quinta), y sostienen dos cotas: **USD 0,000384** por
mensaje con el primario sano y **USD 0,000528** contando las 3 llamadas que el código permite hoy
(eran 4 y USD 0,000672 hasta `89ab7c0`). Sacar el salteo vuelve a 0,000672 (**+27,3 %**) y un tercer
proveedor de respaldo lleva a **USD 0,000768** (**+45,5 %**) — y encima **`MAX_BILLED_CALLS_PER_TURN`
seguiría diciendo 3**, porque la derivación no tiene ningún término que cuente proveedores. Son las
dos que no se ven como cambios de costo. Esas cotas son lo único de §2.6 que no depende del stub ·
**agregado el 2026-08-28 (§2.8, arbitrado por el LEAD en `CLAUDE.md` §5): una alarma de costo
verificada en UNA sola polaridad** — concretamente, el log de `/api/chat` alarmando con un umbral
sobre `billed.calls` y nada más. `calls > 2` era exactamente eso y falla en las **dos** direcciones:
enciende con tráfico legal —el turno degradado normal factura 3 contra un techo de 3— y **calla en
el turno quemado**, que reporta `calls: 0` porque el `throw` descarta la medición. Un instrumento
que alarma sobre lo que el diseño contempla y calla sobre lo que lo rompe no es débil: está
**anti-correlacionado** con lo que dice medir, y da la tranquilidad que es peor que no tener nada
—el mismo defecto que el censo del WAF que no veía `/_media`. La regla queda como fallo automático
permanente y **no es sobre este umbral, es sobre la clase**: toda alarma de costo se acepta
mostrando que **enciende con el caso patológico y calla con el tráfico legal**, las dos cosas, igual
que un gate. Las tres condiciones que reemplazan a `calls > 2` están en §2.8.7 y en §5 ·
**más de un round de tools** (`MAX_TOOL_ROUNDS > 1`): cada vuelta paga el prompt entero de nuevo y
el context caching no aplica a esta dieta (R3 §1)

**BotID Deep Analysis (USD 1/1000 llamadas): NO activar preventivamente.** A 10.000 conversaciones/mes
son USD 10/mes — **el 53% del precio de lista de un plan Base**. (Precio, no margen: el margen
unitario del Base no está calculado en ningún artefacto — ver §7.)

## 7. `[UNVERIFIED]` — lo que este documento NO sabe
- **B4: el costo del chatbot está CALCULADO, NO FACTURADO.** No hay credenciales de Gemini ni de
  Groq, así que `pnpm --filter @istock/ai eval` corre con el driver `stub` y **nadie facturó un
  token todavía**. Los USD 0,0800/1000 mensajes de §2.6 son aritmética correcta sobre consumo
  simulado: el `avgIn = 991` sale del armado real del prompt y es sólido, pero el **`avgOut = 20`
  lo produjo el stub** y es el término que sostiene toda la diferencia entre el esperado (0,096) y
  el techo (0,230). Hasta que B4 cierre, **el número prudente para presupuestar es el techo.**
  Lo que **no** depende del stub, y por eso se puede afirmar hoy: la cota de USD 0,000192 por
  mensaje **de una sola llamada** —USD 0,000384 si el turno usa una tool (§2.7) y **USD 0,000528**
  contando las 3 llamadas que el código permite cuando el primario contesta vacío (§2.8.3b; eran 4
  y USD 0,000672 hasta `89ab7c0`)—, que sale de `assertWithinBudget` (IN ≤ 1200, tira), de `env.ts`
  (OUT ≤ 180, la env sólo puede bajarlo), de `MAX_TOOL_ROUNDS = 1`, de que `generateWithFallback`
  tenga **dos** intentos y del salteo del primario que ya contestó vacío. Cierra
  con C4 de §2.6.8: instrumentar el `usage` real del proveedor.
  *(Los «USD 0,0800/1000 mensajes» y el `avgIn = 991` de este ítem son de la corrida de 174 casos.
  Vigente: **USD 0,0989/1000** de vidriera con `billed.tokensIn` promedio **1173** — §2.8.)*
- **El soft cap de 40 msgs/tenant/día no tiene medición atrás.** Es el multiplicador de todo el
  renglón de chat y es un `[EST]` sin fuente (§2.6.4). Se cierra con el primer tenant Negocio real.
- **Qué fracción de los turnos llama una tool.** Es el segundo multiplicador del renglón de chat y
  **no está medido ni es estimable hoy**: el corpus de la eval no ejercita ninguna tool call, así
  que el `p95` de la dieta y el costo por mensaje que este documento publica valen para la fracción
  cero. Un turno con tool factura **dos** prompts (2,16× el costo) y deja **1 token de margen**
  contra el techo de 1200 — cero con `search_listings` —, y sólo llega ahí **degradando** en 65 de
  65 preguntas sobre la ficha `reserved` (§2.7). Se cierra con C7: un caso de tool en el corpus.
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
- ~~**Precio de fluid compute de Vercel Pro: Active CPU, memoria provisionada e invocaciones.**~~
  **CERRADO en S6 (2026-08-28), y no por una slice de costo.** `docs/research/vercel-cron-limits.md`
  cita los tres contra `vercel.com/docs/functions/usage-and-pricing` (`last_updated: 2026-06-16`,
  consultado 2026-08-28) y `vercel.com/docs/limits`: **Active CPU `iad1` USD 0.128/CPU-h ·
  Provisioned Memory `iad1` USD 0.0106/GB-h · Function Invocations Pro USD 0.60/1M, sin allotment
  incluido**. Coinciden **exactamente** con los valores que este documento venía usando de memoria
  desde §2.2.4, así que el renglón más grande de S2 (Active CPU de `sharp`, USD 0.0035) deja de ser
  `[UNVERIFIED el precio]`. **Lo que sigue sin medirse no es el precio sino la cantidad**: cuántos
  segundos de wall time y de CPU consume una corrida vacía del cron (§2.4.1, horquilla de 4,8×) y
  cuánta memoria tiene provisionada la función (no está configurada; se asume el default).
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
- **Agregado en S6, MEDIO CERRADO el 2026-08-28 — el % del vector de DB sigue siendo `[EST]`, pero
  su término dominante ya no.** El **radio** pasó de «hecho leído del código» a **medido** (V9 de
  `accept-s6.sh`, `esperado=2`, §2.5.1) y vale **2**, así que el porcentaje bajó de 39,4% a **4,6%**.
  Lo que sigue sin medir es el **tráfico** que lo convierte en porcentaje. El párrafo de abajo se
  conserva porque su método sigue siendo el correcto; sólo cambió el radio.

  **(texto original de S6)** El 39,4% del vector de DB es `[EST]`, no `[MEDIDO]`. Sale de un modelo de
  renovación (`I/(λ+I)` por página) sobre dos supuestos míos: el reparto **50% grilla / 50% fichas**
  de los 3.000 pageviews y las **~25 reservas/mes/tenant**. El **radio de purga sí es un hecho leído
  del código** (`getStorefrontCatalog()` / `getStorefrontListing()` / `listingMiss()` de
  `listings.ts`, contra `invalidateStorefrontUnit()` de `storefront-cache.ts`), y es el que manda: con radio
  61 el porcentaje es alto para cualquier reparto razonable, porque una ficha de 25 visitas/mes se ve
  menos de una vez por día. **El modelo se puede volver medición barato** y esa es la deuda concreta:
  `e2e/_lib/s6-measure.ts` ya calienta una ficha hasta `x-nextjs-cache: HIT`; falta reservar **otra**
  unidad y volver a pedir la primera.
- **Agregado en S6 — wall time, CPU y memoria de una corrida del cron.** Cero corridas. Es toda la
  horquilla de USD 0.028 – 0.133/mes del piso (§2.4.1) y **no es medible en local**: el término
  dominante es el cold start de Vercel. Se cierra con `vercel crons run` en producción.
- ~~**Agregado en S6 — el objetivo del plan Negocio.**~~ **CERRADO el 2026-08-28.** El LEAD
  ratificó `Base ≤ 0,50 · Negocio ≤ 1,50 = 0,50 + 1,00 de chat`, está en el §Objetivo de arriba y
  toda auditoría posterior mide atribuido. La §2.4 sigue midiendo contra 0,50 y eso **es correcto**:
  es infra compartida, no chat. Lo que queda de esta entrada es la regla, no la duda: **aflojar un
  objetivo es una decisión del LEAD, no un cálculo del auditor.**
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

**S6 auditada (2026-08-28): PASS, delta USD 0.015/tenant/mes + USD 0.028 – 0.133/mes de piso fijo**
— ver §2.4. Tres resultados, en orden de importancia decreciente:

1. **La invalidación es por unidad en el nombre y por vidriera entera en el radio.**
   `invalidateStorefrontUnit()` emite `storefront:{slug}` + `tenant-config:{slug}` + `listing:{uuid}`,
   y **la ficha registra los tres** — un tag es un OR, así que **una reserva purga las 61 páginas de
   un tenant de 60 equipos, no 1**. Con eso, el modelo de §2.2.5 (`invalidaciones / pageviews = 1,3%`)
   estaba **bajo 25×**: el número real pre-S6 era 32,1% y con S6 es 39,4%, contra una alarma de 5%.
   **El error es de este documento y es anterior a S6.** La palanca son dos ediciones de una línea
   (§2.4.5), baja a 4,7%, no cuesta infraestructura, y es **gate de la próxima slice de vidriera**.
2. **El cron es piso fijo, no marginal, y la invocación es su renglón chico.** Los USD 0.0052/mes de
   invocaciones están **verificados** y son el **4–19%** de lo que cuesta el cron: Active CPU +
   Provisioned Memory por corrida suman USD 0.023 – 0.128 `[EST]`. Aun en el techo es el 0,3% del
   piso. `EXPIRE_BATCH_SIZE = 200` tiene **1.745× de margen** a 100 tenants y no es problema de costo
   ni de producto; lo que sí hay que vigilar del barrido es `failed`, por head-of-line (§2.4.3).
3. **S6 cerró, de rebote, el `[UNVERIFIED]` de fluid compute** que sostenía el renglón más grande de
   S2. Los tres precios (0.128 / 0.0106 / 0.60) ahora tienen fuente en el repo y **coinciden** con lo
   que se venía usando de memoria.

**Y el marco, para que nadie optimice lo que no importa:** el delta entero de S6 es USD 0.015. La
comisión de Mercado Pago es ~USD 1.03 por pagador/mes `[UNVERIFIED]` — **69× S6 completo**.

**`packages/ai` auditado (2026-08-28, HEAD `6952393`): PASS condicionado, delta USD 0,00 hoy /
USD 0,096 – 0,230 por tenant Negocio al soft cap** — ver §2.6. Cuatro resultados:

1. **El precio hardcodeado coincide con el research en las cinco entradas**, y la aritmética del
   runner se rehizo a mano y da: `(991 × 0,10/1M + 20 × 0,40/1M) × 1000 = 0,1071` facturados,
   `× 130/174 = 0,08002` de vidriera. El descuento por derivación **no se aplica dos veces** (el
   promedio de tokens se calcula sobre los 130 facturables, no sobre los 174). Sin hallazgo acá.
   *(Números re-medidos el 2026-08-28 en §2.7; la corrida original daba 995 / 0,1075 / 0,08032.)*
2. **El costo es calculado, no facturado** (B4): el `avgOut = 20` lo produjo el driver `stub`. Lo
   que **sí** es estructural es la cota por mensaje, que sale de aserciones del código y no de
   ninguna medición: **USD 0,000192 en un turno de una llamada y USD 0,000384 si usa una tool**
   (§2.7 corrigió el número y agregó la tercera aserción, `MAX_TOOL_ROUNDS = 1`). Presupuestar por
   el techo hasta que B4 cierre.
3. **El hallazgo es el soft cap sin contador.** No hay tabla, no hay ruta `/api/chat` y **nada
   importa `@istock/ai`** (los cuatro greps de §2.6.8 siguen vacíos al 2026-08-28). **La mitad de
   tipos se cerró:** `ChatInput.usage` es un `TenantUsageToday` que sólo producen
   `usageMeasured` / `usageUnmeasured`, así que el `0` fijo ya no compila (**C2 cumplida**). Falta
   lo caro: el contador. C1–C5 en §2.6.8, con dueño.
4. ~~**Sí hay un volumen al que Negocio pierde plata, y no es orgánico.**~~ **Corregido el
   2026-08-28: con la regla vigente, no.** Break-even a 14.580 msgs/día; `chatbot-rl` pasó de
   12/60s a **20/600s**, o sea 2.880/día por IP y por región — **5,1× abajo** del break-even. Una
   sola IP dentro de lo permitido cuesta **USD 6,91 – 16,59/mes** (era USD 41,64 – 99,53) contra un
   plan de USD 35. Vuelve a ser pérdida si el abuso se reparte sobre ~5 regiones, porque los
   contadores del WAF son **por región** (§2.6.6).

**El hallazgo del barrido (§2.5) está CERRADO, y la lección es de proceso, no de costo.** `b9a8e05`
implementó R1–R4 completos y `2ad4fd7` agregó las aserciones A–E como
`scripts/probes/s6-sweep-head-of-line.test.ts`, gateadas por V10 de `accept-s6.sh` contra Postgres
real. **Lo incómodo es el timing:** §2.5 se commiteó en `4f95937` afirmando que el hallazgo «sigue
vivo», y para entonces el arreglo ya estaba en `main` — el documento auditó `68c0bd6` y se guardó
contra `4f95937` sin volver a mirar. El costo de eso fue una recomendación pedida dos veces y una
métrica de §5 que decía «hoy no la emite nadie» sobre algo que ya se emitía. **Regla que adopto:
la línea de HEAD del encabezado se re-verifica contra `git log` en el momento del commit, no en el
momento de la medición.**

**Re-auditoría del 2026-08-28 contra HEAD `68c0bd6`: PASS. Base USD 0.025 – 0.026 · Negocio
USD 0.196 – 0.257** — ver §2.5. Dos resultados:

1. **La palanca de §2.4.5 se accionó (`f504d69`) y el radio está MEDIDO en 2**, contado por V9 de
   `accept-s6.sh` desde la línea `MEDIDO s6 radio` del e2e, con controles anti-vacuidad y un caso
   que rechaza el «arreglo» que baja el radio a cero rompiendo la invalidación. El vector de DB cae
   de 39,4% a **4,6%** —bajo la alarma— e ISR Writes de USD 0.071 a **USD 0.0085**, que es el **62%
   del marginal Base**. El punto 1 de la entrada de S6, acá arriba, es historia: se deja escrito.
   De paso, una corrección de aritmética mía: §2.4.5 decía «0,071 → 0,018» y de su propia fórmula
   sale **0,0085**.
2. ~~**El hallazgo de §2.4.3 sigue vivo y queda cuantificado y con recomendación.**~~ **CERRADO en
   `b9a8e05`, y este punto quedó desactualizado el mismo día en que se commiteó.** Lo que decía:
   que una fila que falla conserva su lugar en el `order by expires_at asc` —sin columna de
   intentos— y que el route devuelve `200 OK` con `failed: 200`, así que la falla total del barrido
   era indistinguible de su éxito total; que en plata nuestra eran USD 0,0015/mes por unidad
   trabada; y que la vidriera le prometía al comprador «si la reserva se cae, avisamos» mientras el
   panel le decía al dueño «se libera en unos minutos», las dos cosas para siempre.

   **Estado real contra HEAD `6952393`, verificado leyendo el fuente y no el commit message:**
   R1–R4 aterrizaron completos (`sweep_attempts` con su `GRANT`, `order by sweep_attempts asc,
   expires_at asc`, techo de 5 con el `+1` en transacción propia, censo de abandonadas y **500**),
   las aserciones A–E son `scripts/probes/s6-sweep-head-of-line.test.ts` y las corre **V10 de
   `accept-s6.sh`** contra Postgres real. Las **dos** frases de copy que este punto citaba como
   agravante ya no se dicen: la vidriera no promete aviso (`7c1cc49`) y el panel nombra el botón
   pasados 15 minutos (`b9a8e05`). **El número nuestro muere; el del tenant sobrevive**: USD 15 – 22
   por unidad trabada por mes siguen intactos, porque el arreglo no libera la unidad — deja de
   reintentarla y **grita**. Aritmética corregida en §2.5.3; el vector riesgoso pasó a ser otro y
   está en §2.6.
3. **Lo que se agregó esta semana no suma ningún vector** (§2.5.6): `1fc0e59` saca un modo de falla
   que se pagaba por request (un throw adentro de un render cacheado cuelga el stream), `c43bfaf`
   sólo puede bajar bytes y su `reportMediaIncident` corre **dentro** del `'use cache'` —o sea por
   render frío, ≤141/mes/tenant, no por pageview—, y `398fff7` no cambia el número de escrituras.

**S8 re-medida (2026-08-28): PASS. El renglón de chat pasó de USD 0,00008032 a USD 0,00008501 por
mensaje (+5,8%), y el signo engaña** — ver §2.7. Adentro hay dos movimientos opuestos: la
sanitización de `ai-agent` (un solo envoltorio para todo el texto del dueño, en vez de uno por
campo) sacó una línea de encabezado y bajó la dieta **−4 tokens** (−0,4%); y el corpus creció con
**12 casos que llaman una tool**, que es el turno caro que la eval no medía. **Nada se encareció: el
corpus empezó a medir el producto real.** Cuatro resultados que no son el delta:

1. **El turno con tool aguanta el techo de dieta degradando, y eso ya está pasando.** El `p95 1078`
   que se publicaba era el de la vuelta corta; el de la vuelta con tool es **1193 de 1200 — 7 tokens
   de margen**. Reconstruí el `ContextTrimReport` de los 18 turnos con resultado de tool del corpus:
   **2 degradan** (`reserved` × conversación cargada, t03 y t04) y se les va el historial completo.
   En el barrido exhaustivo de 780 prompts el borde es **1200 de 1200 con 65 de 65 degradando**. La
   eval queda verde, la factura no se mueve y ningún test se pone rojo. Un turno con tool factura
   además **dos** prompts, o sea 2,2× lo que el modelo de costo cuenta (`promptTokens` es un
   `Math.max`, no una suma): **11,8% de subcuenta sobre el corpus entero**.
2. **El techo estructural del mensaje sube de USD 0,000192 a USD 0,000384** al contar la segunda
   llamada y su salida. Lo sostiene una tercera aserción que §2.6.3 no nombraba:
   `MAX_TOOL_ROUNDS = 1`. El headroom del peor caso del plan Negocio baja de 5,8× a **3,1×**; sigue
   siendo PASS.
3. **Al techo estructural con tool, una sola IP dentro de lo que el WAF permite deja al tenant
   abusado en USD 33,18 de costo contra USD 33,97 de ingreso neto: USD 0,79 de margen** (§2.6.6).
   No es pérdida y no es un escenario esperado, pero es el primer punto del documento donde el plan
   Negocio se queda sin margen, y aparece hoy por contar la segunda llamada — no porque el WAF haya
   cambiado.
4. **Tres números heredados habían derivado y están corregidos**: `chatbot-rl` pasó de 12/60s a
   20/600s y con eso el peor caso por IP cayó de USD 41 – 99 a **USD 6,91 – 16,59**, o sea que la
   afirmación *«una IP dentro de la regla convierte al Negocio en pérdida»* **ya no es cierta**;
   **C2 está cumplida** (`ChatInput.usage` es un parte marcado, el `0` fijo no compila); y el
   renglón del fallback mezclaba USD/mes con USD/1000 msgs.

**S8.1 re-medida (2026-08-28, HEAD `540de7e`): PASS. El renglón de chat pasó de USD 0,00008501 a
USD 0,00009885 por mensaje (+16,3 %), y esta vez el signo no engaña: el número viejo
SUBFACTURABA** — ver §2.8. Corrí la medición yo, importando `runEval()` del harness (no
`pnpm eval`, que reescribe `packages/ai/README.md` y no es mi columna); coincide con el bloque que
`ai-agent` regeneró, en los diez números que uso. Cuatro resultados:

1. **El motivo del movimiento, descompuesto:** +14,2 % es la contabilidad —`promptTokens` era un
   `Math.max` y contaba **una** vez un turno que manda el prompt **dos** veces, o sea el hueco que
   yo mismo reporté en §2.7 §3 y que C8 cerró— y +1,9 % es el corpus, que sumó la ficha del plan
   Negocio. **Nada se encareció.** Lo que hay que retener no es el 0,1257: es que un número **bien
   calculado** puede estar contestando **otra pregunta** (un máximo donde la factura quiere una
   suma), y que ese defecto la próxima vez va a tener otra cara. Mi estimación de §2.7 de cuánto
   movería C8 (0,00009498) quedó 4,1 % abajo, y toda la diferencia es corpus, no método.
2. **El techo estructural del turno con tool NO cambia: USD 0,000384/mensaje, USD 0,4608/mes.** Lo
   respalda la medición por arriba —el `billed.tokensIn` máximo del corpus es 2386 contra un techo
   de 2400— y lo que cambió es el **esperado**, no la **cota**. **Pero hay una cota más arriba que
   no estaba escrita:** el primario que devuelve `200` con texto vacío se factura igual y manda al
   fallback, y con dos rondas eso eran **4 llamadas facturadas en un turno**. Medido:
   `billed.calls = 4`. Techo **USD 0,000672/msg → USD 0,8064/mes**. §2.7 decía que la cota la
   sostenían tres aserciones; son cuatro, y la cuarta es que `generateWithFallback` tenga dos
   intentos. **`89ab7c0` cerró esto el mismo día (§2.8.3b): el techo es 3 llamadas,
   USD 0,000528/msg → USD 0,6336/mes, 1,58× bajo el presupuesto de chat**, y la constante ahora se
   deriva de `MAX_TOOL_ROUNDS` en vez de vivir en la cabeza del que leyó el archivo.
3. **La ficha que el plan Negocio VENDE no entra en 1200: mide 1374 sin degradar.** 3 puntos de
   retiro, 6 medios de pago, descripción al tope. Hoy entra porque la escalera le tira **los 6
   medios de pago y los 4 turnos de historial**: **el tenant que más paga es el único al que el
   chatbot se le olvida la conversación**, y **7 de los 9 prompts que degradan en todo el corpus son
   esa ficha**. Subir el techo a 1374 —el mínimo que limpia el corpus; 1350 **no** alcanza— cuesta
   entre **USD 0,00047 y USD 0,0574/tenant/mes** según se mida el esperado o el techo absoluto, o
   sea 0,05 %–5,7 % del presupuesto de chat *(la rama cara decía 0,0731 y 7,3 % hasta `89ab7c0`)*. **Ruido.** Y por eso mismo: **el 1200 no se está
   pagando con plata, se está pagando con calidad, así que la decisión no la puede arbitrar la
   factura.** `PENDIENTE DE DECISIÓN HUMANA` — el 1200 lo fijó el goal (§2.8.5). Costo **no tiene
   objeción a ninguna rama**.
4. **El peor caso por IP del WAF es un rango de cinco precios y ahora está escrito como tal**
   (§2.8.6). Los tres que cita `config/firewall-rules.json` se sostienen —USD 10,86 al promedio
   facturado, 16,59 al techo de una llamada, **33,18 al techo con tool, que es mi hallazgo**— y les
   agrego los dos extremos: **USD 8,54** (esperado de vidriera) y **USD 45,62** (las 3 llamadas de
   §2.8.3b; era USD 58,06 con las 4 de antes de `89ab7c0`). Ese último **sigue cruzando el precio
   del plan**: USD 45,62 de costo contra USD 33,97 de ingreso neto.
   §2.6.6 afirmaba que el tenant abusado ya no es pérdida por sí solo; con el rango completo, eso
   vale para 4 de los 5 precios y no para el quinto.

**Abierto:** precio de Supabase (B2) · comisión de MP (B3, ADR-008) · región (ADR-010) ·
**Class B real y bytes del master (B1)** · **bytes por pageview de vidriera con fotos (S3)** ·
**medir el 4,6% en vez de modelarlo** (el **radio** ya está medido; el **tráfico** que lo convierte
en un porcentaje, no) · **medir una corrida del cron** (§7) · **la fila del board para R1–R4 del
barrido** · todos los supuestos de tráfico, hasta la primera vidriera real.
**Cerrado en S6:** precio de fluid compute de Vercel (§7).
**Cerrado el 2026-08-28:** el radio de invalidación (medido, 2) · el objetivo por plan
(Base ≤ 0,50 / Negocio ≤ 1,50, ratificado en `ea26a02`; §2.4.7 lo dejaba abierto) · **C2, el tipo
que impide inventar el contador del soft cap** (§2.6.4 — el contador en sí sigue abierto).
**Abierto desde S8 (§2.7, actualizado en §2.8):** la fracción **real** de turnos que llama una tool
(en el corpus es **14,8 %**; en producción es `[UNVERIFIED]` y casi seguro más alta) · el
`ContextTrimReport` que nadie lee, que **hoy ya daría distinto de cero en 9 de 162 prompts armados,
7 de ellos la ficha del plan Negocio** (C6 — **partida en dos dueños el 2026-08-28**: contar sobre
el corpus es de `ai-agent` y se puede hacer hoy; emitirlo al log en producción es de `app-agent` y
**espera FASE 5**, porque `/api/chat` no existe) · qué se sacrifica cuando el turno con tool no entra en
1200, que hoy lo decide el orden de la escalera y no una decisión (C9, con el precio ya medido y la
decisión pendiente del humano).
**Abierto desde S8.1 (§2.8):** **`billed.calls` no lo emite nadie** (C10) — el campo existe, se
calcula y **no lo lee ningún consumidor**, y es lo único que distingue el techo de USD 0,000384 del
de USD 0,000528. La mitad de `ai-agent` está hecha (el paquete exporta el campo y la constante); la
de `app-agent` **espera FASE 5**, porque `/api/chat` no existe · **cuánto sube el piso de 1374 con
fichas reales** en vez de las cuatro fixtures del corpus.
**Cerrado en S8:** **C7**, el caso de tool que le faltaba al corpus. El bloque de
`packages/ai/README.md` **ya está regenerado** por `ai-agent` y hoy dice 206 casos.
**Cerrado el 2026-08-28 (`89ab7c0`):** **C11** — el primario que atiende y contesta vacío no se
reintenta en lo que queda del turno, y el techo facturable pasó a ser una constante **derivada**
(`MAX_BILLED_CALLS_PER_TURN = TURN_ROUNDS + 1 = 3`). Techo absoluto del chat **USD 0,8064 →
0,6336/mes, −21,4 %** — **no** el −29 % que estimé: mi resta valía para una de las dos ramas de 3
llamadas y no para la cara, que conserva **dos** llamadas al primario (§2.8.3b). **El eval no se
movió ni un dígito: se compró seguro contra el día malo, no un ahorro de hoy.**
**Cerrado en S8.1:** **C8** — `ChatAnswer.billed` suma las llamadas **atendidas** de un turno (una
que tira no se factura; una que contesta vacío, sí), así que el reporte de costo dejó de
subfacturar el turno con tool. Es el hallazgo de §2.7 §3 cerrado en el código, y el motivo por el
que todos los precios de chat de este documento se movieron hoy.
