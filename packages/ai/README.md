# `@istock/ai`

El chatbot de la vidriera. Server-only: prompts, tools, dieta de contexto, handoff y evals.

```
pnpm --filter @istock/ai test && pnpm --filter @istock/ai eval
```

## Qué es esto, en una frase

Un asistente **barato y desconfiado** que contesta lo que ya dice la ficha pública y, en cuanto la
consulta se vuelve una operación —reservar, pagar, canjear, un dato del equipo que no publicamos—,
**deja de hablar y manda al WhatsApp del vendedor con el producto ya escrito.**

No es un vendedor automático. Es el paso previo: que el visitante llegue informado al WhatsApp.

## La dieta

Esta tabla la escribe la eval, igual que el bloque de §Costo medido y en la misma corrida. Estuvo a
mano hasta el 2026-08-28 y decía `p95 1049` mientras el bloque generado, doce líneas más abajo,
medía `1078`: 29 tokens de deriva entre el número escrito y el número medido, en el mismo archivo.

**Son dos columnas y la que importa es la de la derecha.** Un turno con tool paga el prompt dos
veces, y la segunda lleva el digest de la ficha adentro: es el prompt más largo del ciclo. Hasta el
2026-08-28 el corpus no tenía **ninguna** llamada a tool, así que el único p95 publicado era el del
camino corto — el techo del caso que el producto casi no toma, publicado como si fuera el techo. No
estaba mal medido: medía otra cosa que la que el número parecía decir. Un p95 solo, promediando los
dos, sería peor todavía: esconde justo el que aprieta.

**Y el margen contra el techo dejó de publicarse como métrica de salud el 2026-08-28.** Desde que
hay escalera de degradación, el margen es `>= 0` **por construcción**: la dieta recorta hasta entrar
o tira `AI_BUDGET_EXCEEDED`. Publicarlo era publicar una tautología tranquilizadora — el día que la
ficha crezca va a seguir dando cero mientras por debajo se muere el historial. Lo que se emite ahora
es **cuánto hubo que tirar**, con el peor turno nombrado.

<!-- eval:dieta:inicio · lo genera `pnpm --filter @istock/ai eval`, no lo edites a mano -->

| | techo | medido p95, sin tool | medido p95, con tool |
|---|---|---|---|
| entrada | **1200** tokens | 1079 | 1198 |
| salida | **180** tokens | 35 | 35 |
| temperature | 0.2 | fijo, no configurable | ídem |
| thinking / reasoning | cero | el puerto ni siquiera expone la perilla | ídem |

Turnos con tool en el corpus: **15 casos** × 2 formas de conversación, 24 de ellos con el resultado adentro del prompt medido. El peor caso con tool mide **1200 tokens** contra el techo de 1200.

**El margen contra el techo no es la métrica de salud: la escalera de degradación lo mantiene en ≥ 0 sola.** La métrica es cuánto hubo que tirar para llegar ahí: **153 de 162** prompts armados entraron sin recortar nada. Los que sí recortaron: 9 perdieron medios de pago, 8 historial, 2 chunks, 0 la descripción.

Peor turno medido: **`n02`** (conversación cargada), 1198 tokens tras tirar 6 medios de pago, 4 turnos de historial y 2 chunks; la descripción entró entera. Es la ficha del **plan Negocio** (3 puntos de retiro, 6 medios de pago, descripción al tope): no es una ficha patológica, es la que el plan de USD 35 vende. Los 3 puntos de retiro sobreviven a la degradación por diseño — son el dato por el que ese tenant paga.

<!-- eval:dieta:fin -->

Contexto = system corto + `publicListingDTO` de la ficha abierta + 3 chunks del **mismo**
`catalog_model` + últimos 4 turnos recortados + el schema de las tres tools. **Nada más entra.**

La dieta **no es un objetivo, es una aserción**: `buildChatContext` mide el prompt armado y
`assertWithinBudget` tira antes de llamar al proveedor. Cuando no entra, se **degrada en orden**
(medios de pago → historial → chunks → descripción del dueño) en vez de truncar por el medio; si ni
el piso entra, rompe fuerte y visible. `src/context.test.ts` lo prueba con diez peores casos,
incluido un ataque de inflado de 20 turnos y las dos formas de la ronda de tool.

**El primer escalón son los medios de pago, y el criterio no es el tamaño.** Los seis medios de una
ficha del plan Negocio son 43 tokens, o sea **dos turnos de historial**; y las ocho formulaciones de
*"¿cómo puedo pagar?"* del corpus **derivan a WhatsApp antes de llamar al proveedor** (pagar es
handoff obligatorio), así que esos tokens no pueden contestar la única pregunta para la que existen.
Los **puntos de retiro no se recortan nunca**, aunque el tercero cueste 18: esas preguntas sí llegan
al modelo, y el bloque le dice *"si algo no está acá, no lo sabés"* — un punto recortado no se vuelve
silencio, se vuelve una **negación falsa** al comprador que vive en esa ciudad, sobre exactamente el
feature que el plan de USD 35 cobra.

**Y cuando ni el piso entra, el error nombra la causa.** Decía *"1173 tokens contra un techo de
1200"* —un número **adentro** del presupuesto mientras abortaba por pasarse—, porque re-armaba un
piso de mentira para el mensaje: sin el resultado de la tool y con la consulta real reemplazada por
`(consulta)`. Ahora reporta la última configuración **efectivamente medida**, así que el número está
por encima del techo por construcción, y manda el recorte a `listing-view.ts` en vez de al techo.

**La escalera cobra, y hasta el 2026-08-28 cobraba en silencio.** Sobre una ficha larga, el digest
de `get_open_listing` no rompe el techo: lo paga el historial. Medido en `context.test.ts`, el
contexto pasa de tres turnos de historial a **uno** — el costo no sube ni un dólar, no se mueve
ningún número, y lo que baja es la calidad. Es un bug de campo imposible de reproducir: el chatbot
se olvida de lo que el comprador dijo dos mensajes atrás, pero sólo cuando la ficha es larga y sólo
después de una tool call. El orden de la escalera **no cambió** —el digest es la respuesta a lo que
el modelo acaba de pedir y conservarlo parece correcto—; lo que cambió es que ahora hay un test que
lo dice por su nombre, con el número puesto, y que se pone en rojo si alguien la reordena sin
querer.

## Costo medido

Lo mide `pnpm --filter @istock/ai eval`, no una estimación — y **lo escribe la eval, no una
persona**. El bloque de abajo está entre marcadores y lo pisa el runner en cada corrida verde:
editarlo a mano no sirve de nada, porque la próxima corrida lo vuelve a poner.

<!-- eval:costo-medido:inicio · lo genera `pnpm --filter @istock/ai eval`, no lo edites a mano -->

```
primario: gemini-2.5-flash-lite   fallback: openai/gpt-oss-20b
casos: 206/206 verdes   preguntas reales: 50

turnos que llegan al modelo: 162/206 (79%)   ← el resto se deriva antes y cuesta CERO
de esos, con resultado de tool adentro del prompt: 24
tokens IN   p50 1018  p95 1183  max 1200  (techo 1200)
   sin tool  p95 1079  max 1200
   con tool  p95 1198  max 1200   ← el camino que el producto toma de verdad
tokens OUT  p50 22  p95 35  max 36  (techo 180)

entrada FACTURADA por turno (suma de las llamadas atendidas): avg 1173  p95 2267  max 2386
   ↑ la base del costo. NO es `tokens IN`, que es el máximo por turno y sirve para auditar la dieta.
degradación: 153/162 prompts armados sin tirar nada · medios de pago 9 · historial 8 · chunks 2 · descripción 0

costo /1000 mensajes facturados:  USD 0.1257
costo /1000 mensajes de vidriera: USD 0.0989   ← el número real
```

| | |
|---|---|
| costo por mensaje de vidriera | USD 0,00009885 |
| un tenant al tope del soft cap | 40 msg/día × 30 días × USD 0,00009885 = **USD 0,1186/mes** |

<!-- eval:costo-medido:fin -->

El número que importa es el **mezclado**, no el facturado: uno de cada cuatro mensajes se resuelve
por detección de intención sin llegar al proveedor. La defensa más barata es la que corre antes.
`runEval()` filtra los turnos que llegaron al modelo **antes** de promediar y recién después
multiplica por la tasa, así que ese descuento se aplica una sola vez.

> **Por qué se genera.** Hasta el 2026-08-28 este bloque estaba transcripto a mano, decía `124/168`
> y `USD 0.079` de una corrida vieja, y de ahí salió un `USD 0,094/mes` reportado como si fuera
> medición (0,079 × 1200 = 0,0948; el exacto es USD 0,0964/mes, 2,5% arriba). El defecto no fue de
> quien copió: fue tener **dos fuentes para un número**, donde la segunda es siempre la vieja.
> El gate es `pnpm eval && git diff --exit-code`: si el corpus se movió y nadie regeneró, el árbol
> queda sucio y se ve.

Los números finales viven en `docs/CHATBOT.md`, que escribe `docs-keeper` (`CLAUDE.md` §4).

## Modelos

Por **env**, nunca por constante — hubo dos deprecaciones en tres meses:

```
LLM_PRIMARY_MODEL   Gemini Flash-Lite     riesgo de apagado en octubre 2026
LLM_FALLBACK_MODEL  Groq gpt-oss-20b      en el camino de ejecución y ejercido en la eval
```

`env.ts` valida en el arranque y **rechaza** las familias frontier y el modelo de Groq retirado el
16/08/2026. Un ID equivocado rompe al levantar, no en la factura. Ver `.env.example`.

**El fallback no es un `catch` decorativo:** se ejerce con el primario caído, con el primario
devolviendo texto vacío (el modo de falla más común de un modelo barato bajo carga) y con los dos
caídos, que termina en handoff a WhatsApp.

## Las tres tools

`get_open_listing()` · `search_listings(query)` (máx 5, campos mínimos) · `handoff_whatsapp(reason)`.

Ninguna escribe. Ninguna recibe `tenant_id`: se inyecta server-side. Un solo round de tools por
turno, porque cada vuelta paga el prompt entero de nuevo.

## Las defensas, en orden

```
1. entitlement      en plan Base el widget está AUSENTE del DOM; acá ni se arma el prompt
1b. parte del contador  sin medidor no hay chat → AI_USAGE_UNMEASURED (no es "cero mensajes")
2. soft cap         40 msgs/tenant/día → después sólo el botón de WhatsApp
3. intención        reservar · pagar · iCloud · identificador · envío · canje → deriva SIN llamar al modelo
4. dieta            se arma, se MIDE, se asserta
5. primario → 6. fallback
7. guard de salida  costo, margen, identificadores, notas internas, precios inventados,
                    y "disponible" sobre una unidad `reserved` → se descarta la respuesta y se deriva
8. siempre          `waUrl` + `waMessage` del DTO
```

### El paso 1b: el contador es el techo de la factura

`answerChat` no recibe `messagesToday: number`. Recibe un **parte** (`TenantUsageToday`), que se
construye con `usageMeasured(n)` o con `usageUnmeasured('motivo')` y nada más — la marca del tipo es
un `unique symbol` no exportado, así que afuera del paquete no hay literal posible.

El motivo es un modo de falla medido: el cap tenía constante, predicado y gate, y **no tenía
contador**. Con un `number` en la firma, el primer cableado real de `/api/chat` iba a escribir un
`0` para poder compilar —el contador todavía no existe— y eso apagaba el único techo por tenant del
producto **sin poner nada en rojo**: compilaba, pasaban los tests y pasaba la eval.

El costo por mensaje y el costo de un tenant al tope del cap están en **§Costo medido**, que genera
la eval. No se repiten acá a propósito: un número escrito dos veces envejece en una de las dos.

El techo por IP del WAF (`config/firewall-rules.json`, hoy 20/600s) **no** sustituye a este contador:
un límite por IP y un cupo por tenant son ejes distintos, y el peor caso por IP queda dos órdenes de
magnitud por encima del cap. El contador **es** el techo de la factura, y por eso su ausencia se
declara en vez de codificarse como cero.

El contador no vive en este paquete y esta slice no lo construye: necesita estado por tenant/día en
un camino anónimo de vidriera, que es el ADR C1 (abierto). Mientras tanto, el cableado honesto es
`usageUnmeasured(...)`, que falla ruidoso en el primer request en vez de contestar gratis.

Los pasos 3 y 7 son los que hacen que los evals de jailbreak sean **deterministas**: no dependen de
que el modelo se porte bien. Un modelo nuevo mueve la *probabilidad* de la salida mala; no mueve si
la frenamos.

La descripción del listing la escribe el dueño y es **input no confiable**: se sanitiza y se
delimita con `sanitizeForPrompt` de `packages/domain` antes de entrar al prompt.

## La eval

`src/evals/cases.eval.ts` — **50 preguntas reales** de comprador del Alto Valle + handoffs
obligatorios + jailbreaks de costo y de identificador en varias formulaciones + el caso `reserved` +
inyección escondida en la descripción del dueño **+ turnos con tool**, que son el camino que el
chatbot existe para tomar. El corpus corre en dos formas de conversación —primer mensaje y
conversación cargada— y el total de casos lo imprime la corrida, en §Costo medido; no se transcribe
acá, que es como envejeció todo lo demás de este archivo.

Un caso con tool guiona **dos** turnos del modelo: la tool call y, con el resultado ya adentro del
contexto, la respuesta. El corpus clasifica un turno como "con tool" **por lo que se le mandó al
proveedor**, no por lo que el caso declaró: `handoff_whatsapp` y una tool inventada cortan antes de
re-armar el contexto, así que su prompt medido no tiene digest y contarlos en el p95 con tool sería
bajarlo con turnos que no lo pagaron.

Corre **sin red y sin credenciales** — B4 (keys de Gemini y Groq) es un bloqueo humano abierto y la
eval no lo espera. `LLM_DRIVER=stub` está **forzado** en la eval: un `.env` local con `live` no puede
convertirla en una llamada facturada por accidente.

El archivo se llama `.eval.ts` y no `.ts` porque adentro hay que escribir literalmente los ataques, y
la regla 1 de `scripts/guard-leaks.sh` busca esos nombres de campo en el paquete. El corpus de
ataques es lo contrario de una fuga, pero un `grep` no puede distinguirlas: la extensión lo declara.

## `ai-lint`

Diez reglas que ningún linter genérico puede tener, porque chequean cosas que **no fallan en
runtime**: ID de modelo hardcodeado (A001), familia frontier (A002), campo prohibido (A003),
`console` (A004), `NEXT_PUBLIC_` (A005), red suelta en `src` (A006), la dieta editada (A007), una
perilla de thinking (A008), un módulo sin test hermano (A009), evidencia de medición forjada con un
`as` o con un literal a mano (A010). El número lo imprime `pnpm lint` en cada corrida; si esta línea
y esa salida discrepan, manda la salida.

## Lo que este paquete NO hace

- **No consulta la base.** Recibe el `publicListingDTO` ya armado, el mismo que renderiza la
  vidriera. Una consulta propia sería una segunda definición de "qué es público".
- **No calcula embeddings por request.** Sólo en el seed/update de `catalog_models`.
- **No tiene memoria persistente.** El historial son los últimos 4 turnos que manda el cliente.
- **No habla con la red.** El I/O vive detrás de `LlmProvider`; el adapter real llega con B4.
