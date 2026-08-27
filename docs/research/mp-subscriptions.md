# R4 - Mercado Pago Subscriptions (preapproval) en Argentina: API vigente
_Consultado: 2026-08-27 - Agente: researcher_

---

> # ⛔ LEAD OVERRIDE — 2026-08-27 — LEER ANTES QUE EL RESTO DEL DOCUMENTO
>
> Este documento **falló el voto adversarial dos veces**. Por la regla 3 de `CLAUDE.md`
> (*dos fallos en la misma slice → STOP y re-plan*) **no hay tercera pasada de research**.
> Queda cerrado como **PARCIAL, bloqueado en B3**.
>
> **Causa raíz del doble fallo:** las preguntas que quedan abiertas **no son contestables desde
> documentación pública**. Las páginas de costos de MP son UA-gated y se renderizan por JS, y
> si se puede adherir un CBU a un `preapproval` sólo se establece **intentándolo**. Una tercera
> pasada de búsqueda falla igual. Lo que falta es una **cuenta de sandbox**, no más research.
>
> ## Afirmaciones ANULADAS por el LEAD — no las copies a ningún doc ni a ningún ADR
>
> 1. **«No hay débito automático por CBU / DEBIN / transferencia recurrente en la API de
>    Suscripciones»** (`:26-27`, `:162-163`, `:537-538`). **Es falsa.** Verificado por el LEAD
>    hoy: `GET .../reference/online-payments/subscriptions/get-payment/get.md` → HTTP 200, y el
>    enum de `payment_method_id` documenta `Debin_transfer` ("immediately debits an amount from an
>    account, requesting prior authorization") y `CVU`. Está bajo el árbol de **Suscripciones**.
>    **Ojo con el rebote:** esto refuta el negativo, **no prueba el positivo** — es el enum de la
>    *respuesta*, no del alta. Si se puede *adherir* un CBU se decide en sandbox.
>    Esto importa porque `CLAUDE.md` §3 dice **preferir débito/transferencia**: un negativo falso
>    acá cerraba el riel de pago que el ICP necesita.
> 2. **«La frase "no tenés costos fijos" no está en la página» y «sus 5 FAQs son…»** (`:349-355`).
>    Falsas ambas: la frase está en el `meta-description` y el JSON-LD trae **8** `Question`.
>    La conclusión (dejarlo en UNVERIFIED) se sostiene; **el fundamento no**.
> 3. **«Devuelve HTTP 403 sin sesión»** (`:367-368`, `:448-449`, `:457-458`, `:461-462`, `:620-621`).
>    Los tres URLs dan **200** con User-Agent de browser. El bloqueo real es **UA-gating + render
>    por JS**. La conclusión (no leído en fuente primaria) se sostiene; el diagnóstico no.
> 4. **La tabla de comisiones y el «piso de USD 1,03/mes»** (`:339-344`, `:551-560`) modelan el
>    costo como función **sólo** del plazo de acreditación. La FAQ oficial declara **tres**
>    variables: provincia del domicilio, **medio de pago que elija el cliente**, y plazo.
>    El piso queda **condicionado**, no presupuestable. `cost-auditor` no lo usa como gate.
> 5. **`:496` habla de `middleware.ts` y delega la exención del webhook a un matcher del proxy.**
>    Doblemente prohibido: el archivo es `proxy.ts` (Next 16) y `CLAUDE.md` dice que la
>    autorización **nunca** se delega al proxy. **La única defensa del webhook es el HMAC
>    verificado dentro del route handler.**
>
> ## Lo que sigue vigente
> Todo lo demás del documento pasó la revisión. El flujo `preapproval`, el modelo de estados y la
> forma del webhook no están en disputa.
>
> ## Cómo se cierra (FASE 6, cuando llegue B3)
> Ver el **plan de sandbox de ADR-008** en `docs/DECISIONS.md`. Hasta entonces R4 **no bloquea**
> FASE 2, 3 ni 4: billing es la FASE 6.

---

## Pregunta

¿Cómo cobramos una suscripción SaaS mensual en ARS a resellers argentinos con Mercado Pago?
Producto vigente y endpoints, plan asociado vs sin plan, medios de pago reales (el ICP prefiere
débito/transferencia sobre crédito), trial de 14 días, webhooks + firma + idempotencia + reintentos,
máquina de estados, comisiones en AR y requisitos de cuenta.

## Respuesta corta

- **Producto:** "Suscripciones" (Subscriptions). API vigente = `POST /preapproval_plan` (plan) +
  `POST /preapproval` (suscripción) + `PUT /preapproval/{id}` (pausar/cancelar/cambiar) +
  `GET /authorized_payments/{id}` (la cuota/invoice). Host `https://api.mercadopago.com`.
  Es un producto distinto de Checkout Pro/API. **Verificado hoy contra el changelog oficial**
  (`/developers/es/changelog.md`, entradas de jul-2023 a jul-2026): **no hay ningún anuncio de
  deprecación de Suscripciones ni de `preapproval`**; la última entrada etiquetada `Subscriptions`
  es de **abril de 2026** y es una corrección de documentación. Checkout API sí migró a `/v1/orders`;
  `preapproval` **no**.
- **Usar plan asociado** para los 2 planes fijos. Razón dura para Argentina: *"When you edit the plan
  we will update the subscriptions"* — editás `transaction_amount` del plan y se propaga a todas las
  suscripciones vivas. Con inflación ARS eso es la diferencia entre un `PUT` y N `PUT`s.
  Además `billing_day` (1–28) **sólo existe con plan asociado** → todos cobran el mismo día del mes.
- **Medios de pago reales en AR:** tarjeta de crédito, tarjeta de débito y **dinero disponible en
  Mercado Pago**. El pagador **no necesita cuenta MP**. **NO hay débito automático por CBU ni DEBIN
  ni transferencia recurrente** en esta API. Traducción para el ICP: lo más cercano a "no tarjeta"
  es **dinero en cuenta de MP**, y hay que **habilitarlo explícitamente** vía `payment_methods_allowed`
  (o no restringir nada). **Abierto (corregido tras review):** Rapipago / Pago Fácil / línea de crédito
  aparecen en la doc oficial de Suscripciones (locale AR, disponibilidad AR+6 países) y **no verifiqué**
  que no sirvan ciclo a ciclo — no los damos por descartados. Fallback humano si nada de esto sirve:
  cobro manual fuera de MP.
- **Trial 14 días: soporte nativo.** `auto_recurring.free_trial = { frequency: 14, frequency_type: "days" }`
  **en el plan** (`POST /preapproval_plan`). No hace falta simularlo con `start_date`
  (además `start_date` sólo se respeta si también mandás `end_date`).
- **Webhook:** header `x-signature: ts=<timestamp>,v1=<hex>` + `x-request-id`. ⚠️ La doc dice que `ts`
  está "in milliseconds" pero el ejemplo que publica (`ts=1704908010`) tiene 10 dígitos = **segundos**:
  normalizar por longitud antes de cualquier chequeo anti-replay. Manifest exacto
  `id:[data.id_url];request-id:[x-request-id_header];ts:[ts_header];` → **HMAC-SHA256 en hex** con el
  secret de *Tus integraciones*. `data.id` alfanumérico en mayúsculas → pasar a minúsculas.
  Responder **200/201 en ≤22 s** o MP reintenta **cada 15 min** (intervalo se extiende tras el 3er intento).
- **Comisión AR de suscripciones (oficial, MP AR):** **6,99% + IVA al instante**, 4,49% + IVA a 10 días,
  3,39% + IVA a 18 días, 1,49% + IVA a 35 días. Con IVA 21% ⇒ **~8,46% efectivo** al instante.
  Sobre USD 19 son ~**USD 1,61/mes**; sobre USD 35, ~**USD 2,96/mes**.
- **Puente MP→tenant + campos corregidos tras el review:** `external_reference` es **request param de
  `POST /preapproval`** (no del plan) → alta siempre server-side y redirect al `init_point` **de la
  suscripción** (`?preapproval_id=`), **nunca** al del plan (`?preapproval_plan_id=`), que es idéntico
  para todos los tenants. El semáforo se llama `summarized.semaphore` (`green|yellow|red|blank`, **4**
  valores). `payment.status` usa **`cancelled`** (dos "l") mientras `preapproval.status` y
  `authorized_payment.status` usan `canceled` (una "l"). Existe un 5º estado de cuota,
  `waiting for gateway`, sólo en la guía y no en el API reference → enums de Zod **tolerantes**.
- **Cuenta:** hace falta cuenta de **vendedor** MP + aplicación en *Tus integraciones* + **activar
  credenciales de producción** (industria + URL del sitio + T&C + reCAPTCHA). No hay approval manual
  documentado. **Ojo:** las credenciales de *test* **sólo existen para Checkout API y Bricks** → para
  probar Suscripciones hay que usar **credenciales de producción de una cuenta de prueba**.

## Detalle

### 1. Producto vigente y endpoints

La solución se llama **Suscripciones / Subscriptions** y se integra "a través de llamadas a nuestra API
de Suscripciones". El flujo documentado es: crear suscripción (con o sin plan) → configurar prorrateo →
testear → producción.

| Acción | Método + endpoint |
|---|---|
| Crear plan | `POST https://api.mercadopago.com/preapproval_plan` |
| Obtener plan | `GET /preapproval_plan/{id}` |
| Actualizar plan (propaga a suscripciones) | `PUT /preapproval_plan/{id}` |
| Buscar planes | `GET /preapproval_plan/search` |
| Crear suscripción | `POST https://api.mercadopago.com/preapproval` |
| Obtener suscripción | `GET /preapproval/{id}` |
| Actualizar / pausar / cancelar | `PUT /preapproval/{id}` (body `{"status": ...}`) |
| Buscar suscripciones | `GET /preapproval/search` |
| Exportar suscripciones | `GET /preapproval/export` |
| Obtener cuota (invoice) | `GET https://api.mercadopago.com/authorized_payments/{id}` |
| Obtener pago de la cuota | `GET /v1/payments/{id}` |

Auth: `Authorization: Bearer <ACCESS_TOKEN>` en header (la doc de seguridad de MP pide **header, nunca
query param**).

Existe además un producto **no-code**: "Planes de suscripción" desde el panel/app de MP (creás el plan,
compartís el link). La doc oficial de ese producto enumera los campos del formulario y el único
identificador propio que ofrece es literal: *"**Reference Code:** Allows you to add a reference code to
help you identify the plan in case you have several similar active plans"* → **es por plan, no por
suscriptor**. Con 2 planes compartidos por todos los tenants, ese código no sirve como clave de tenant,
así que el producto no-code **no habilita entitlements automáticos**. Sirve como plan B para cobrar el
día 1 sin integración.
*(Corregido tras review: la versión anterior afirmaba "no da webhooks propios ni `external_reference`
controlado por nosotros" sin fuente. Lo verificable es el `Reference Code` a nivel plan; si el producto
no-code emite o no notificaciones propias queda en `UNVERIFIED`.)*

### 2. Plan asociado vs sin plan

**Con plan asociado** (`preapproval_plan` → `preapproval`):
- El plan es un *template*: `reason`, `auto_recurring.frequency` + `frequency_type` (`days`|`months`),
  `repetitions` (opcional; si no está, la suscripción no termina hasta que alguien la cancele),
  `billing_day` (1–28, **solo con plan**), `billing_day_proportional` (prorrateo del primer ciclo,
  ciclos calculados sobre base 30 días), `free_trial`, `transaction_amount`, `currency_id`,
  `payment_methods_allowed`, `back_url`.
- El `id` de la respuesta es el `preapproval_plan_id`, **obligatorio** para crear la suscripción.
- Regla dura de la doc: *"A subscription with an associated plan must always be created with your
  `card_token_id` and with the status `Authorized`."* → **con plan asociado, la suscripción vía API
  requiere tokenizar la tarjeta vos mismo** (Checkout API / Bricks card form) antes del `POST /preapproval`.
  El plan también expone un `init_point` (checkout hosteado por MP) como camino alternativo.
- Estados del plan: `active` | `canceled`.

**Sin plan asociado** (`POST /preapproval` directo). Dos sabores:
- **Authorized payment**: mandás `status: "authorized"` + `card_token_id`. El motor agenda y cobra las
  cuotas solo. La **primera cuota se cobra ~1 hora después** de crear la suscripción. MP hace un cobro de
  monto mínimo para validar la tarjeta y después lo devuelve.
- **Pending payment**: `status: "pending"`, **sin** método de pago. La suscripción queda esperando y el
  pagador elige medio de pago en el `init_point` de MP. Este es el camino **sin tokenizar tarjeta en
  nuestro front** — el más barato de construir y el que expone dinero en cuenta de MP.

**Recomendación para iStock (2 planes fijos):** **plan asociado**, uno por plan (`base`, `negocio`),
`frequency: 1`, `frequency_type: "months"`, `currency_id: "ARS"`, sin `repetitions`.
Motivos: (a) editar el plan sincroniza el monto en todas las suscripciones vivas — crítico porque
nuestro precio es USD pero **MP cobra un `transaction_amount` fijo en ARS**, o sea que el precio ARS hay
que reajustarlo periódicamente a mano; (b) `billing_day` unifica el día de cobro; (c) los eventos llegan
agrupables por plan (`subscription_preapproval_plan`).
Contra: obliga al `card_token_id` en el flujo API. Si queremos el checkout hosteado de MP (y con eso
dinero en cuenta), el camino es **redirigir al `init_point`** en vez de tokenizar nosotros.

> ⚠️ Contradicción a resolver en sandbox: la doc dice que con plan asociado la suscripción "siempre"
> se crea con `card_token_id` y `authorized`, pero el plan también devuelve `init_point` ("Url to
> checkout to add payment method"). Pesa más la nota normativa de la guía de integración; el `init_point`
> parece el camino de auto-suscripción del pagador. **Verificar con una prueba real antes de decidir el
> flujo de signup.**

**MP no convierte USD→ARS.** `currency_id: "ARS"` y monto fijo. La conversión USD 19 / USD 35 → ARS es
responsabilidad nuestra, igual que el TC del tenant.

### 3. Medios de pago reales

Fuente AR específica (página de producto de MP Argentina, FAQ "¿Qué medios de pago puedo ofrecer?"):

> "Tus clientes te pueden pagar con **tarjeta de crédito, débito y dinero disponible de Mercado Pago**.
> Ellos no necesitan tener una cuenta de Mercado Pago para pagar."

**Contradicción real (atribución corregida tras review):** la otra lista sale de
`mercadopago.com.ar/developers/es/docs/subscriptions/overview` — que **también es dominio/locale AR**,
no una página "genérica multi-país" como decía la versión anterior de este doc. Dice literal
*"Online and offline payment methods, such as Rapipago and Pago Fácil"* y, en la tabla comparativa,
*"Payment methods: Account money, credit or debit card, Credit line, Rapipago, Pago Fácil"*.
Lo que sí verifiqué en el `.md` crudo de esa página: la fila **"Availability by country" de ese mismo
bloque lista `AR, BR, CL, CO, MX, PE, UY`** — o sea, la lista de medios es **una sola lista de producto
para los 7 países**, no un desglose por país. Conclusión honesta:

- El criterio "(a) es país-específica" **era falso** y queda retirado.
- Lo único que sostiene la preferencia por la página comercial AR es que **enumera medios frente a un
  vendedor argentino concreto**, mientras que la lista de la overview no discrimina país.
- Rapipago/Pago Fácil son medios *offline*: **no está documentado** que puedan auto-debitarse ciclo a
  ciclo. Eso es una **incógnita**, no una deducción cerrada → va a `## UNVERIFIED` y al plan de sandbox.
  **No** damos por muerta la vía no-tarjeta que pide `CLAUDE.md` §3.

**Lo que realmente se puede hacer con el ICP que odia la tarjeta de crédito:**
1. **Dinero en cuenta de Mercado Pago** — es el sustituto viable de "débito/transferencia". El reseller
   mantiene saldo en MP (cosa que ya hace: cobra ventas por MP) y la suscripción se debita de ahí.
   Se controla con `payment_methods_allowed.payment_types[].id`.
2. **Tarjeta de débito** — declarada como soportada en AR por MP.
3. **Débito automático por CBU / DEBIN / transferencia recurrente: NO existe en esta API.** No hay
   endpoint ni `payment_type` documentado para adherir un CBU a un `preapproval`.
4. Fallback humano para el que no quiere nada de esto: link de pago mensual manual. Es churn asegurado;
   no lo pongamos como default.

**Riesgo abierto:** los IDs exactos de `payment_types` aceptados por `payment_methods_allowed`
(`credit_card`, `debit_card`, `account_money`, `ticket`…) **no están enumerados** en la referencia de
`preapproval_plan` — el ejemplo de la doc usa `{"id": "master"}`, que es un `payment_method`, no un
`payment_type`. Hay que confirmarlo empíricamente contra `GET /v1/payment_methods` con credenciales AR.

### 4. Trial de 14 días

**Nativo.** Objeto `auto_recurring.free_trial` con `frequency` (number) y `frequency_type`
(`days` | `months`). Para 14 días:

```json
"auto_recurring": {
  "frequency": 1, "frequency_type": "months",
  "free_trial": { "frequency": 14, "frequency_type": "days" },
  "transaction_amount": <ARS_PRICE>, "currency_id": "ARS",
  "billing_day": 10, "billing_day_proportional": true
}
```

> `<ARS_PRICE>` es placeholder a propósito. **No hardcodeamos un monto en ARS en este research**: no
> tenemos fuente citable del TC a 2026-08-27 y el ADR de "Precio ARS = derivado" lo prohíbe. El seed del
> plan lo calcula `billing-agent` con el TC vigente al momento del alta.

Notas:
- `free_trial` está documentado **en el request de `POST /preapproval_plan`**. En `POST /preapproval`
  aparece **sólo en los response params**, no en los request params → **el trial se define en el plan**,
  no por suscripción. Otro punto a favor de plan asociado.
- No hace falta simularlo con `start_date` diferido. Y además `start_date` "only works together with
  the `end_date` parameter" — si no mandás `end_date`, `start_date` se ignora. O sea que la simulación
  con fecha diferida te obliga a poner fecha de fin, que es justo lo que no queremos en un SaaS.
- Sigue siendo nuestra la responsabilidad de la máquina de entitlements durante el trial: MP no nos va a
  avisar "arrancó el trial" con un pago (no hay pago). El evento útil es
  `subscription_preapproval` con la suscripción en `authorized`.

### 5. Webhooks: formato, firma, idempotencia, reintentos

**Tópicos a activar** (en *Tus integraciones → Webhooks → Configurar notificaciones*):

| Tópico | Qué notifica | Dónde consultar el recurso |
|---|---|---|
| `subscription_preapproval` | creación/actualización de la **suscripción** | `GET /preapproval/{id}` (search: `/preapproval/search`) |
| `subscription_preapproval_plan` | creación/actualización del **plan** | `/preapproval_plan/search` |
| `subscription_authorized_payment` | la **cuota** recurrente | `GET /authorized_payments/{id}` |
| `payment` | el **pago** concreto de cada cuota | `GET /v1/payments/{id}` |

La doc es explícita: *"en **todos los casos** también debés activar el tópico de pagos"*.

**Payload** (POST JSON):

```json
{ "id": 12345, "live_mode": true, "type": "payment",
  "date_created": "2015-03-25T10:04:58.396-04:00", "user_id": 44444,
  "api_version": "v1", "action": "payment.created", "data": { "id": "999999999" } }
```

**Verificación de firma (exacto):**
1. Header `x-signature`, ej. `ts=1704908010,v1=618c85345248dd820d5fd456117c2ab2ef8eda45a0282ff693eac24131a5e839`.
   Split por `,` → `ts` = timestamp de la notificación, `v1` = firma.
   ⚠️ **Inconsistencia de la propia doc de MP (verificada hoy):** el texto dice literal
   *"The value for the `ts` prefix is the notification timestamp (in milliseconds)"*, pero el ejemplo
   publicado en esa misma página es `ts=1704908010` → **10 dígitos = epoch en segundos** (2024-01-10).
   Consecuencia práctica: una tolerancia anti-replay tipo `Date.now() - ts > 5*60_000` se equivoca por
   un factor 1000 (rechaza todo o no protege nada). **Normalizar por longitud** (10 dígitos ⇒ ×1000)
   antes de cualquier chequeo de frescura, y **nunca** tocar el string original al armar el manifest.
2. Template del manifest: `id:[data.id_url];request-id:[x-request-id_header];ts:[ts_header];`
   - `[data.id_url]` = `data.id` de los **query params de la URL**. Si viene alfanumérico en mayúsculas,
     **convertir a minúsculas** (ej. `ORD01JQ…` → `ord01jq…`).
   - `[x-request-id_header]` = header `x-request-id`.
   - `[ts_header]` = el `ts` extraído de `x-signature`.
   - Si falta `data.id` o `x-request-id`, **quitar ese segmento del manifest** antes de calcular.
3. Secret: *Tus integraciones → app → Webhooks > Configurar notificación → revelar clave secreta*.
4. `HMAC` con **SHA256 en base hexadecimal**, clave = secret, mensaje = manifest. Comparar contra `v1`
   (usar comparación en tiempo constante).

Notificaciones de QR **no** se pueden validar con el secret (no nos aplica).

**Respuesta e idempotencia:**
- Devolver `HTTP 200 (OK)` o `201 (CREATED)`. **Ventana de espera: 22 segundos.**
- Si no llega confirmación: **reintento cada 15 minutos**; *"After the third attempt, the interval will
  be extended, but the attempts will continue."* MP **no publica el backoff exacto ni un tope de
  intentos** → hay que asumir entrega **at-least-once, sin límite conocido**.
- MP **no ofrece un mecanismo de deduplicación**: la idempotencia es nuestra. Clave natural =
  `(type, data.id, action)` o el `id` de la notificación, persistida en una tabla de eventos con
  UNIQUE, y procesamiento **fuera** del request (responder 200 rápido y re-consultar el recurso después,
  que es justo lo que la doc recomienda: confirmar recepción y luego pegarle a la API).
- `X-Idempotency-Key` (UUID v4 en el header, sin prefijos con `_`) es **obligatorio desde 09/01/2024 para
  las APIs de Pagos y Reembolsos**. La nota oficial **no menciona `/preapproval`** → mandarlo igual en
  nuestras llamadas de escritura no hace daño, pero no asumir que MP lo honra en `preapproval`.

### 6. Estados y transiciones

**Suscripción (`preapproval.status`):**

| Estado | Significado (doc oficial) |
|---|---|
| `pending` | suscripción **sin** medio de pago |
| `authorized` | suscripción con medio de pago válido → cobrando |
| `paused` | cobros **temporalmente** discontinuados |
| `canceled` | terminada. **"This is an irreversible state."** |

Se cambian con `PUT /preapproval/{id}` mandando `status`. La respuesta trae además un semáforo cuyo
nombre real es **`summarized.semaphore`** (corregido tras review: la versión anterior decía
`summarized.status`, campo que **no existe** — `status` es de primer nivel). Enum completo según
`GET /preapproval/{id}`:

| valor | significado (literal doc) |
|---|---|
| `green` | "All collections made." |
| `yellow` | "With collection problems. We are trying to collect an invoice." |
| `red` | "With pending collections. An invoice could not be collected." |
| `blank` | "Discounted collection." |

Son **4 valores, no 2-3**: un `z.enum(['green','yellow','red'])` rompe con `blank`. El resto de
`summarized`: `quotas`, `charged_quantity`, `charged_amount`, `pending_charge_quantity`,
`pending_charge_amount`, `last_charged_date`, `last_charged_amount`.
(Rareza de la doc: declara `semaphore` como `(number, optional)` pero enumera valores string.)

**Cuota (`authorized_payment.status`):** `scheduled` → `recycling` (reintentando) → `processed`
(cobrada **o** agotados los reintentos) | `canceled`. Campo `retry_attempt` cuenta los intentos.
`summarized`: `pending` | `done`.

⚠️ **Discrepancia guía vs API reference (verificada hoy, agregada tras review):** el API reference de
`GET /authorized_payments/{id}` enumera **sólo 4** valores (`scheduled`, `processed`, `recycling`,
`canceled`), pero la **guía** de pagos autorizados documenta un quinto estado en tránsito:
*"Payment is being processed so the installment will be pending in a `waiting for gateway` status until
the payment is resolved"* y *"If an installment is in `waiting for gateway` status and, when the payment
is resolved, it appears as declined..."*. Nótese que el literal lleva **espacios**, no guiones bajos.
Consecuencia con `CLAUDE.md` §5 (Zod en todos los bordes): un `z.enum` de 4 valores tira error sobre una
cuota en tránsito → el webhook no responde 200 → MP reintenta cada 15 min (~96 invocaciones/día, el
costo tonto que queremos evitar). **Regla:** enum tolerante (`z.enum([...5 valores]).catch('unknown')`
o `z.string()` + mapeo), nunca estricto, sobre estados que vienen de MP.

**Pago (`payment.status`)** — fuente agregada tras review: API reference de `GET /v1/payments/{id}`
(`.../reference/online-payments/checkout-api-payments/get-payment/get`), enum literal:
`pending` · `approved` · `authorized` · `in_process` · `in_mediation` · **`cancelled`** · `refunded` ·
`charged_back` · `rejected`.

🔴 **Trampa de ortografía (corregida tras review):** este doc decía `canceled`. El valor real en
`payment.status` es **`cancelled` con dos "l"**, mientras que `preapproval.status` y
`authorized_payment.status` usan **`canceled` con una "l"**. Son tres enums distintos con dos
ortografías distintas en la misma API: `billing-agent` **no** debe compartir un solo enum de Zod ni un
solo enum de Postgres entre suscripción, cuota y pago.

**Qué evento llega en cada transición:**

| Transición | Evento |
|---|---|
| Alta / autorización de la suscripción | `subscription_preapproval` (`action` de creación/actualización) |
| Pausa (`authorized`→`paused`) | `subscription_preapproval` (update) |
| Cancelación (`→ canceled`) | `subscription_preapproval` (update) |
| Cuota agendada / reintentada / procesada | `subscription_authorized_payment` |
| Pago aprobado o rechazado | `payment` + `subscription_authorized_payment` |
| Cambio de precio/estado del plan | `subscription_preapproval_plan` |

⚠️ La doc **no publica la lista cerrada de valores de `action`** para los tópicos de suscripción
(sólo muestra `payment.created` como ejemplo). **No hardcodear `action`: leer `type` + re-consultar el
recurso y usar el `status` de la API como fuente de verdad.**

**Reintentos de cobro (lógica de recycling), literal de la doc:**
- Cuota rechazada → queda en `recycling` y entra a un esquema de **máximo 4 intentos**.
- Ventana por defecto: **10 días** (se ajusta si la cuota tiene fecha de expiración).
- Si al 4º intento no se cobra, la cuota pasa a `processed` con pago rechazado.
- **Después de 3 cuotas con pagos rechazados, MP cancela la suscripción automáticamente** y le manda
  mail al vendedor. El resultado de una cuota no afecta la generación de las siguientes.
- Consecuencia de producto: la ventana de dunning real es de ~3 meses; nuestro downgrade a read-only
  debería dispararse mucho antes (a la 1ª cuota `processed` con pago rechazado).

### 7. Comisiones en Argentina

De la página oficial de producto de MP Argentina (Suscripciones), sección "Podés recibir tu dinero al
instante":

| Plazo de acreditación | Costo |
|---|---|
| Al instante | **6,99% + IVA** |
| En 10 días | **4,49% + IVA** |
| En 18 días | **3,39% + IVA** |
| En 35 días | **1,49% + IVA** |

Nota literal de MP: *"Los costos pueden variar de acuerdo a los impuestos provinciales"* (retenciones
de IIBB).

🔴 **Retirado tras review:** la versión anterior citaba como literal *"no tenés costos fijos"*. Re-leí la
página hoy y **esa frase no está**; la página sólo publica comisiones porcentuales por plazo y la nota de
impuestos provinciales, y sus 5 FAQs son *"¿Qué es una suscripción?"*, *"¿Cómo cobrar de forma
automática?"*, *"¿Con qué frecuencia recibo los pagos?"*, *"¿Puedo hacer que mis clientes definan el monto
que pagarán?"*, *"¿Qué medios de pago puedo ofrecer?"*. **No afirmo que exista o no un abono fijo**: pasa a
`## UNVERIFIED`. Una cita textual que no está en la fuente es el peor error de este oficio y así queda
declarado.

Con IVA 21%: 6,99 → **8,46% efectivo**; 4,49 → 5,43%; 3,39 → 4,10%; 1,49 → 1,80%.
Si somos Responsable Inscripto, el IVA de la comisión es crédito fiscal y el costo económico vuelve a
~6,99% / ~4,49%; para monotributo es costo puro.

**Decisión de plata:** pasar de "al instante" a "en 10 días" ahorra **~3,03 puntos** de comisión
(≈ USD 0,58/mes por cliente base, USD 1,06/mes por cliente negocio). Con 50 clientes mixtos son del
orden de **USD 40/mes** — plata real para un SaaS de USD 19. Un SaaS mensual no necesita el dinero
al instante: **default recomendado = 10 días**.
**Dónde se configura: `UNVERIFIED`.** Existe la FAQ oficial *"¿Cómo elijo o modifico los costos por
cobro?"* (`mercadopago.com.ar/ayuda/como-elegir-modificar-costos-cobro_16181`, URL real, título
confirmado por búsqueda hoy), pero **devuelve HTTP 403 sin sesión**, igual que
`/costs-section/subscriptions`. Es decir: **no pude leer el procedimiento en fuente primaria**. La
versión anterior de este doc afirmaba "configurable desde el panel de MP, no desde la API" citando esa
FAQ sin tenerla en `## Fuentes` ni haberla leído. Queda como incógnita a resolver con la cuenta logueada
antes de cobrar el primer peso. Lo que **sí** está verificado son los cuatro porcentajes por plazo.

### 8. Requisitos de cuenta

- **Cuenta de vendedor** de Mercado Pago (prerequisito explícito de la doc de Suscripciones).
- **Aplicación** creada en *Tus integraciones* (developers panel) → de ahí salen las credenciales.
- **Activar credenciales de producción**: elegir **Industria**, completar **Website (obligatorio)** con
  la URL del negocio, aceptar Declaración de Privacidad + Términos y Condiciones, reCAPTCHA →
  "Activar credenciales de producción". **No hay aprobación manual / whitelist documentada** para
  Suscripciones.
- Credenciales: `Public Key` (frontend) + `Access Token` (backend, secreto) y `Client ID`/`Client Secret`
  (OAuth).
- **Gotcha grande de testing:** *"Test credentials are only available for Checkout API and Checkout
  Bricks integrations."* Para Suscripciones hay que testear con **credenciales de producción de una
  cuenta de prueba** (test accounts). Es decir: el sandbox de Suscripciones se hace con cuentas de
  prueba, no con TEST tokens.
- Se pueden **compartir credenciales** con otra cuenta MP hasta **10 veces**, y **renovarlas** (renovar
  rompe la integración hasta que reemplaces las claves).
- Se necesita **URL pública** para el webhook antes de poder configurarlo (bloqueante de orden: dominio
  y ruta de billing en `*.maat.work` tienen que existir antes de la primera prueba end-to-end).

## Números que importan

| ítem | valor | unidad | fuente |
|---|---|---|---|
| Comisión suscripciones AR, acreditación al instante | 6,99 | % + IVA | MP AR — herramientas-para-vender/suscripciones |
| Comisión suscripciones AR, 10 días | 4,49 | % + IVA | idem |
| Comisión suscripciones AR, 18 días | 3,39 | % + IVA | idem |
| Comisión suscripciones AR, 35 días | 1,49 | % + IVA | idem |
| Comisión efectiva al instante (IVA 21%) | 8,46 | % | cálculo propio sobre 6,99 |
| Comisión efectiva 10 días (IVA 21%) | 5,43 | % | cálculo propio sobre 4,49 |
| Costo fijo mensual del producto Suscripciones | `UNVERIFIED` | — | cita retirada; ver §UNVERIFIED |
| Semáforo de salud de la suscripción | `summarized.semaphore` ∈ green/yellow/red/blank | enum (4) | MP API Reference — `GET /preapproval/{id}` |
| Estados de la cuota (API reference) | scheduled / processed / recycling / canceled | enum (4) | MP API Reference — `GET /authorized_payments/{id}` |
| Estado extra sólo en la guía | `waiting for gateway` | string con espacios | MP Developers — Authorized payments |
| Estados de pago | pending/approved/authorized/in_process/in_mediation/**cancelled**/refunded/charged_back/rejected | enum (9) | MP API Reference — `GET /v1/payments/{id}` |
| `external_reference` en `POST /preapproval` | request param (string, opcional) | — | MP API Reference — `POST /preapproval` |
| `external_reference` en `POST /preapproval_plan` | **sólo response**, no request | — | MP API Reference — `POST /preapproval_plan` |
| `init_point` de la suscripción | `?preapproval_id=...` | URL | MP API Reference — `POST /preapproval` (response example) |
| `init_point` del plan | `?preapproval_plan_id=...` (compartido por todos los tenants) | URL | MP API Reference — `POST /preapproval_plan` (response example) |
| Ejemplo de `ts` publicado por MP | 1704908010 | 10 dígitos = segundos (doc dice "ms") | MP Developers — Webhooks |
| Última entrada de changelog etiquetada `Subscriptions` | abril 2026 (corrección de docs) | — | MP Developers — Changelog |
| Anuncios de deprecación de `preapproval` en changelog jul-2023→jul-2026 | 0 | entradas | MP Developers — Changelog |
| Timeout de confirmación de webhook | 22 | segundos | MP Developers — Webhooks |
| Intervalo de reintento de webhook | 15 | minutos | MP Developers — Webhooks |
| Reintentos antes de extender el intervalo | 3 | intentos | MP Developers — Webhooks |
| HTTP esperado por MP en el webhook | 200 / 201 | status | MP Developers — Webhooks |
| Algoritmo de firma | HMAC-SHA256 hex | — | MP Developers — Webhooks |
| Reintentos de cobro por cuota | 4 | intentos | MP Developers — Authorized payments |
| Ventana de reintento de cobro | 10 | días | idem |
| Cuotas rechazadas antes de cancelación automática | 3 | cuotas | idem |
| Demora del primer cobro tras crear la suscripción | ~1 | hora | idem |
| Rango válido de `billing_day` | 1–28 | día del mes | MP API Reference — preapproval_plan |
| Base de cálculo del prorrateo | 30 | días | idem |
| Trial 14 días | `free_trial:{frequency:14,frequency_type:"days"}` | — | idem |
| Estados de suscripción | pending / authorized / paused / canceled | enum | MP API Reference — preapproval |
| Máximo de veces que se pueden compartir credenciales | 10 | veces | MP Developers — Credenciales |
| Obligatoriedad de `X-Idempotency-Key` (Pagos y Reembolsos) | 09/01/2024 | fecha | MP Developers — Noticias |

## Fuentes

- [Suscripciones — Overview (MP Developers AR)](https://www.mercadopago.com.ar/developers/es/docs/subscriptions/overview) — consultado 2026-08-27
- [Suscripciones — Landing (MP Developers AR)](https://www.mercadopago.com.ar/developers/es/docs/subscriptions/landing) — consultado 2026-08-27
- [Suscripción con plan asociado (MP Developers AR)](https://www.mercadopago.com.ar/developers/es/docs/subscriptions/integration-configuration/subscription-associated-plan) — consultado 2026-08-27
- [Suscripciones sin plan asociado (MP Developers AR)](https://www.mercadopago.com.ar/developers/es/docs/subscriptions/integration-configuration/subscription-no-associated-plan) — consultado 2026-08-27
- [Suscripciones con pago autorizado + lógica de reintentos (MP Developers AR)](https://www.mercadopago.com.ar/developers/es/docs/subscriptions/integration-configuration/subscription-no-associated-plan/authorized-payments) — consultado 2026-08-27
- [Suscripciones con pago pendiente (MP Developers AR)](https://www.mercadopago.com.ar/developers/es/docs/subscriptions/integration-configuration/subscription-no-associated-plan/pending-payments) — consultado 2026-08-27
- [API Reference — Create subscription plan `POST /preapproval_plan`](https://www.mercadopago.com.ar/developers/en/reference/online-payments/subscriptions/create-preapproval-plan/post) — consultado 2026-08-27
- [API Reference — Create subscription `POST /preapproval`](https://www.mercadopago.com.ar/developers/en/reference/online-payments/subscriptions/create-preapproval/post) — consultado 2026-08-27
- [API Reference — Update subscription `PUT /preapproval/{id}`](https://www.mercadopago.com.ar/developers/en/reference/online-payments/subscriptions/update-preapproval/put) — consultado 2026-08-27
- [API Reference — Get subscription `GET /preapproval/{id}`](https://www.mercadopago.com.ar/developers/en/reference/online-payments/subscriptions/get-preapproval/get) — consultado 2026-08-27
- [API Reference — Get invoice data `GET /authorized_payments/{id}`](https://www.mercadopago.com.ar/developers/en/reference/online-payments/subscriptions/get-authorized-payment/get) — consultado 2026-08-27
- [Webhooks — firma `x-signature`, manifest, reintentos (MP Developers AR)](https://www.mercadopago.com.ar/developers/es/docs/your-integrations/notifications/webhooks) — consultado 2026-08-27
- [Información adicional sobre notificaciones — tópicos de Suscripciones (MP Developers AR)](https://www.mercadopago.com.ar/developers/es/docs/your-integrations/notifications/additional-info) — consultado 2026-08-27
- [Credenciales y activación de producción (MP Developers AR)](https://www.mercadopago.com.ar/developers/es/docs/subscriptions/additional-content/your-integrations/credentials) — consultado 2026-08-27
- [El uso de Idempotencia será obligatorio (MP Developers, 4-ene-2024)](https://www.mercadopago.com.ar/developers/es/news/2023/01/04/Idempotency-key-usage-will-be-mandatory) — consultado 2026-08-27
- [Cobrá de forma automática con una suscripción — costos y medios de pago AR (MP Argentina, © 2026)](https://www.mercadopago.com.ar/herramientas-para-vender/suscripciones) — consultado 2026-08-27
- [¿Cuánto cuesta recibir pagos con suscripciones? (MP Ayuda AR)](https://www.mercadopago.com.ar/ayuda/19495) — consultado 2026-08-27 — **no renderiza sin JS**; los números salen de la página de producto
- [Costos por cobro — sección de costos (MP AR)](https://www.mercadopago.com.ar/costs-section/subscriptions) — consultado 2026-08-27 — **SPA, requiere sesión**

**Agregadas tras el review (una por afirmación que estaba sin fuente):**

- [API Reference — Get payment `GET /v1/payments/{id}`](https://www.mercadopago.com.ar/developers/en/reference/online-payments/checkout-api-payments/get-payment/get) — consultado 2026-08-27 — enum de `payment.status` (incluye `cancelled` con dos "l")
- [Received payments management — Suscripciones (MP Developers AR)](https://www.mercadopago.com.ar/developers/en/docs/subscriptions/additional-content/payment-management) — consultado 2026-08-27 — es la página de Suscripciones que apunta a esa referencia de Payments y documenta `/v1/payments/search?external_reference=`
- [Planes de suscripción (no-code) — crear un plan (MP Developers AR)](https://www.mercadopago.com.ar/developers/es/docs/subscription-plans/create-subscription-plan) — consultado 2026-08-27 — campo `Reference Code` a nivel plan
- [Changelog de MP Developers](https://www.mercadopago.com.ar/developers/es/changelog) — consultado 2026-08-27 — **la página HTML es una SPA, pero `…/changelog.md` devuelve 200 con el texto plano completo (jul-2023 → jul-2026)**; ahí verifiqué que no hay deprecación de `preapproval`
- [¿Cómo elijo o modifico los costos por cobro? (MP Ayuda AR)](https://www.mercadopago.com.ar/ayuda/como-elegir-modificar-costos-cobro_16181) — consultado 2026-08-27 — **HTTP 403 sin sesión**; se cita la existencia de la FAQ, no su contenido
- [¿Cuáles son los costos por cobro con Mercado Pago? (MP Ayuda AR)](https://www.mercadopago.com.ar/ayuda/_220) — consultado 2026-08-27 — **HTTP 403 sin sesión**

> Nota de método: todas las páginas de `developers` de MP se leen en fuente primaria agregando `.md` a la
> URL (ej. `…/subscriptions/overview.md`). Las de `mercadopago.com.ar/ayuda` y `/costs-section` devuelven
> 403/JS y **no** son verificables sin sesión — ninguna cifra de este doc depende de ellas.

## Refutaciones al review

Dos puntos del review adversarial son **incorrectos** y los defiendo con URL. El resto lo acepté y está
corregido arriba.

1. **Finding 1, argumento (a): "«`external_reference`» es un atributo del plan… lo lista como request
   param de `POST /preapproval_plan`".** Es falso.
   `curl -sL https://www.mercadopago.com.ar/developers/en/reference/online-payments/subscriptions/create-preapproval-plan/post.md`
   → la sección `## Request parameters` del plan contiene **sólo** `reason`, `auto_recurring.*`,
   `payment_methods_allowed.*` y `back_url`. `external_reference` e `init_point` aparecen **después** de
   `## Response parameters`. Y en
   `…/subscriptions/create-preapproval/post.md`, `external_reference` **sí** figura dentro de
   `## Request parameters` de `POST /preapproval` (junto a `preapproval_plan_id`, `payer_email`,
   `card_token_id`, `status`). **Conclusión:** `external_reference` es por suscripción y es un puente
   válido — el riesgo real es otro y más acotado (usar el `init_point` **del plan** en vez del **de la
   suscripción**), y así quedó redactado en `## Impacto`.
   *Igual acepto la parte sustantiva del finding:* el flujo de alta con plan asociado sin tokenizar
   tarjeta sigue sin verificarse y ahora está en `## UNVERIFIED` como bloqueante del ADR.

2. **Afirmación sin fuente #5: "el changelog de MP es una SPA JS que no renderiza sin navegador, así que
   la ausencia de anuncio de deprecación no fue realmente verificable".** Sí es verificable:
   `curl -sL https://www.mercadopago.com.ar/developers/es/changelog.md` devuelve **HTTP 200 y 44.300
   bytes** de texto plano con todas las entradas de **julio 2023 → julio 2026**. Grepeado hoy: cero
   ocurrencias de deprecación/discontinuación de `preapproval` o Suscripciones; la única entrada
   etiquetada `Subscriptions` es de abril 2026 y es una corrección de documentación de Tarjetas Guardadas.
   La afirmación del cuerpo queda **verificada**, no `UNVERIFIED`.

## Impacto en iStock

**ARCHITECTURE**
- `billing-agent` implementa en `apps/web/app/(billing)/**` + la ruta de webhook. El endpoint del
  webhook es **público sin auth de sesión** y su única defensa es el HMAC → tiene que estar fuera del
  matcher de auth del `middleware.ts` (coordinar con `storefront-agent`, que es dueño del middleware)
  y **fuera del routing por host de vidriera**.
- Zod en el borde del webhook: `{id, live_mode, type, action, data:{id}}`. Verificar firma **antes** de
  parsear negocio. Rechazar si `live_mode` no coincide con el entorno.
- Tablas nuevas (`db-agent`), todas con `tenant_id` + RLS:
  `subscriptions` (mp_preapproval_id UNIQUE, mp_preapproval_plan_id, status enum
  `pending|authorized|paused|canceled`, plan `base|negocio`, current_period_end, trial_ends_at),
  `billing_events` (mp_notification_id + type + data_id **UNIQUE** → idempotencia), y
  `entitlements`/flags derivados (chatbot on/off, reservas, margen, puntos de retiro).
  Las policies RLS deben permitir la escritura del webhook vía service role, **nunca** vía sesión de usuario.
- **Puente MP→tenant (reescrito tras review, con verificación de fuente primaria hoy):**
  `external_reference` **sí es un request param de `POST /preapproval`** — *"Reference to sync with your
  system. This is a free text field to help you with your integration to link the entities"* — y aparece
  en el body de ejemplo de la guía de alta (`"external_reference": "YG-1234"`). O sea: **es por
  suscripción, no por plan**. En `POST /preapproval_plan` **no** es request param: está sólo en
  *Response parameters* (verificado leyendo el `.md` crudo de la referencia: la sección
  `## Request parameters` del plan sólo tiene `reason`, `auto_recurring`, `payment_methods_allowed`,
  `back_url`).
  **Regla dura de arquitectura:** el alta **siempre** la origina nuestro backend con
  `POST /preapproval` seteando `external_reference = tenant_id`, y redirigimos al `init_point` **de la
  suscripción** (el response de `POST /preapproval` trae
  `init_point: ".../subscriptions/checkout?preapproval_id=..."`). **Prohibido** publicar el `init_point`
  **del plan** (`.../subscriptions/checkout?preapproval_plan_id=...`): esa URL es la misma para todos los
  tenants, no lleva `external_reference` por pagador y el webhook no podría resolver el tenant →
  **misatribución cross-tenant de entitlements**.
  `payer_email` **no** sirve como clave (el reseller puede pagar con otro mail), así que si el
  `external_reference` no llega, la resolución correcta es **fallar y alertar**, nunca adivinar.
  ⚠️ Lo que queda abierto y **bloquea el ADR de plan asociado**: si `POST /preapproval` con
  `preapproval_plan_id` + `status: "pending"` (sin `card_token_id`) es aceptado. El API reference lo
  permite en el enum de `status`, pero la guía de plan asociado dice *"A subscription with an associated
  plan must always be created with your `card_token_id` and with the status `Authorized`"*. Si la guía
  gana, **plan asociado ⇒ tokenizar tarjeta ⇒ adiós dinero-en-cuenta** por ese camino. Ver `## UNVERIFIED`.
- Procesamiento **asíncrono**: responder 200 en <22s (idealmente <1s), encolar y re-consultar
  `GET /preapproval/{id}` o `GET /authorized_payments/{id}` como fuente de verdad. Nunca confiar en el payload.
- El estado de suscripción se lee del panel autenticado, no de la vidriera. La vidriera sigue siendo ISR
  y no toca billing.

**DECISIONS (ADRs a redactar por `architect`)**
- ADR: **Suscripciones con plan asociado** (2 planes, `billing_day` fijo, propagación de precio en ARS).
- ADR: **Trial 14d nativo vía `free_trial`**, no simulado con `start_date`/`end_date`.
- ADR: **Medios de pago habilitados** = tarjeta de crédito + débito + dinero en cuenta MP.
  Registrar que **débito automático por CBU / DEBIN / transferencia recurrente no aparece en ninguna
  parte de la API de Suscripciones** (no hay endpoint ni `payment_type` documentado para adherir un CBU).
  🔴 **Corregido tras review: este ADR NO cierra la discusión no-tarjeta.** Rapipago / Pago Fácil /
  línea de crédito **sí** figuran en la doc oficial de Suscripciones (locale AR) y este research **no
  pudo probar** que no sirvan ciclo a ciclo. El ADR debe redactarse como *reversible*, condicionado al
  resultado de la prueba de sandbox, porque `CLAUDE.md` §3 pide explícitamente "preferir
  débito/transferencia" y es el requisito del ICP.
- ADR: **Idempotencia de webhooks propia** (tabla `billing_events` con UNIQUE), porque MP entrega
  at-least-once, reintenta cada 15 min sin tope publicado y no deduplica.
- ADR: **Dunning propio.** MP cancela recién a las 3 cuotas rechazadas (~3 meses). Nosotros degradamos a
  read-only al 1er ciclo `processed` con pago rechazado, con aviso al reseller.
- ADR: **Precio ARS = derivado, no hardcodeado.** Rutina de reajuste que hace `PUT /preapproval_plan/{id}`
  cuando el USD se despega. Guardar en `docs/DECISIONS.md` la cadencia (mensual/trimestral) y quién la aprueba.

**COST**
- Comisión MP: **6,99% + IVA al instante** vs **4,49% + IVA a 10 días**. Recomendación firme:
  **configurar acreditación a 10 días** en el panel de MP antes de cobrar el primer peso.
  Sobre USD 19 la comisión baja de ~USD 1,61 a ~USD 1,03 por cliente/mes (**-36%**).
- Costo de infra adicional: 1 ruta serverless de webhook + N filas en `billing_events`. Con reintentos
  cada 15 min sobre un endpoint caído, el peor caso son ~96 invocaciones/día por evento colgado →
  el `cost-auditor` debería exigir que el webhook responda 200 **siempre que la firma valide**, incluso
  si el procesamiento posterior falla, para no invitar a MP a martillarnos.
- **Piso de costo variable** por cliente pagador: ~USD 1,03/mes (base, 10 días) a ~USD 2,96/mes
  (negocio, al instante) de comisión. Cálculo: 5,43% y 8,46% efectivos sobre USD 19 / USD 35.
- ⚠️ **Corregido tras review:** ya **no** afirmamos "cero costo fijo de MP" — la cita en la que se
  apoyaba no existe en la página (ver `## UNVERIFIED`). El `cost-auditor` debe **verificar con la cuenta
  logueada** si hay abono fijo antes de firmar el COST de billing.

## Confianza

**media** (bajada desde "alta" tras el review adversarial: dos campos de API estaban mal nombrados o
mal escritos y una cita textual no existía en la fuente. Eso obliga a bajar la confianza global aunque el
resto se haya verificado).

**alta** para, sólo lo re-verificado hoy contra la referencia oficial leyendo el `.md` crudo: endpoints;
`free_trial` de 14 días en el plan; `external_reference` como request param de `POST /preapproval` y **no**
del plan; `init_point` por suscripción (`?preapproval_id=`) vs por plan (`?preapproval_plan_id=`);
`summarized.semaphore` con 4 valores; enum de `payment.status` con `cancelled`; lógica de reintentos
(4 intentos / 10 días / 3 cuotas → cancelación); mecánica de firma del webhook; 22 s y 15 min;
los 4 porcentajes de comisión AR; y la ausencia de deprecación de `preapproval` en el changelog.

**baja** para: qué medios de pago sirven para el cobro **recurrente** en AR (Rapipago/Pago Fácil/dinero
en cuenta), y para el flujo de alta con plan asociado sin `card_token_id`. Son justo los dos que definen
si el ICP puede pagar sin tarjeta → **no cerrar ADR sobre esto sin la prueba de sandbox**.

**Lo que subiría la confianza a alta en todo:** una prueba end-to-end en cuenta de prueba AR:
(1) `POST /preapproval_plan` con `free_trial` 14 días y `payment_methods_allowed` incluyendo dinero en
cuenta; (2) `POST /preapproval` con `preapproval_plan_id` + `status: "pending"` + `external_reference` y
**sin** `card_token_id` → ¿201 o 400? y ¿el response trae `init_point` con `?preapproval_id=`?;
(3) capturar el payload y el `action` real de `subscription_preapproval` en cada transición, más el
`external_reference` que llega en el webhook y en `/v1/payments/search`; (4) `GET /v1/payment_methods`
con credenciales AR para enumerar los `payment_types.id` válidos y ver si Rapipago/Pago Fácil aparecen
para recurrencia; (5) capturar un `x-signature` real para resolver si el `ts` viene en segundos o ms;
(6) capturar un `authorized_payment` en `waiting for gateway`; (7) captura de la sección de costos
logueada — única fuente de la comisión de nuestra cuenta **y del eventual abono fijo**.

**Lo que la bajaría:** que MP anuncie la migración de Suscripciones al modelo de `Orders` (ya migró
Checkout API a `/v1/orders`). **Verificado hoy:** el changelog (`/developers/es/changelog.md`, HTTP 200,
44.300 bytes, jul-2023 → jul-2026) **no** tiene ningún anuncio de ese tipo para `preapproval`. Sigue
siendo el riesgo estructural a monitorear: revisar ese `.md` en cada fase de billing.

## UNVERIFIED

**Agregados / degradados tras el review adversarial (2026-08-27):**

- 🔴 **Cita textual retirada por inexistente:** *"no tenés costos fijos"*, que este doc atribuía a
  `mercadopago.com.ar/herramientas-para-vender/suscripciones`. Re-leída la página hoy, la frase **no
  está**. Con ella cae la afirmación del cuerpo "no hay abono mensual por usar Suscripciones" y la fila
  "Costo fijo mensual = 0 ARS" de la tabla. **Si Suscripciones tiene o no costo fijo mensual en AR: sin
  verificar.** (El COST de este doc ya no asume costo fijo cero.)
- **Si `POST /preapproval` con `preapproval_plan_id` + `status: "pending"` y sin `card_token_id` es
  aceptado.** El API reference de `POST /preapproval` documenta `pending` como *"Subscription without a
  payment method… that the customer can load into our checkout"*, pero la guía de plan asociado dice
  *"A subscription with an associated plan must always be created with your `card_token_id` and with the
  status `Authorized`"*. **Bloquea el ADR de plan asociado** y, con él, la vía sin tokenizar tarjeta.
- **Si el `init_point` del *plan* permite inyectar un `external_reference` por pagador** (o cualquier
  parámetro por tenant). Presunción operativa hasta probarlo: **no**, y por eso el alta se origina
  siempre server-side con `POST /preapproval`.
- **Si Rapipago / Pago Fácil / línea de crédito sirven ciclo a ciclo en AR**, o sólo para el primer pago
  del flujo `pending`. La overview de MP (locale AR) los lista para los 7 países sin desglose; la página
  comercial AR no los menciona. **Ninguna fuente dice que no sirvan** — la versión anterior de este doc lo
  deducía y esa deducción queda retirada.
- **Dónde se configura el plazo de acreditación (10 días).** La FAQ oficial existe
  (`/ayuda/como-elegir-modificar-costos-cobro_16181`) pero devuelve **403 sin sesión**; no leí el
  procedimiento en fuente primaria. La afirmación "se configura desde el panel de MP, no desde la API"
  queda sin verificar.
- **Si el producto no-code "Planes de suscripción" emite notificaciones/webhooks propios.** Lo único
  verificado es que su identificador (`Reference Code`) es **por plan**. La afirmación anterior "no da
  webhooks propios" no tenía fuente y queda retirada del cuerpo.
- **`summarized.semaphore` está tipado `(number, optional)` en la referencia pero sus valores enumerados
  son strings** (`green`/`yellow`/`red`/`blank`). Cuál es el tipo real en el wire: sin verificar → parsear
  permisivo.
- **`waiting for gateway`**: aparece en la guía de pagos autorizados pero **no** en el enum del API
  reference de `GET /authorized_payments/{id}`. Cuál de los dos refleja el wire: sin verificar → enum
  tolerante.
- **Formato real del `ts` del header `x-signature`**: la doc dice "milliseconds", el ejemplo publicado
  tiene 10 dígitos (segundos). Sin capturar una notificación real no sé cuál manda.
- **Precio en ARS de los planes.** Este doc **ya no publica ningún monto en ARS** (antes usaba
  `transaction_amount: 24900`, que implicaba un TC de ~1.310 ARS/USD sin fuente ni fecha). No tengo fuente
  citable del TC a 2026-08-27; el monto lo define `billing-agent` al seedear.

**Ya estaban (siguen abiertos):**

- Valores exactos aceptados en `payment_methods_allowed.payment_types[].id` y
  `payment_methods[].id` para Argentina (la doc no los enumera; el ejemplo oficial usa `"master"` en
  ambos campos, lo cual parece un error de la propia doc).
- Si el cobro recurrente **automático** con **dinero en cuenta de MP** funciona ciclo a ciclo sin
  intervención del pagador (la página AR lo lista como medio de pago, pero no aclara si aplica al
  débito recurrente o sólo al primer pago).
- Si **tarjeta de débito** genera un `card_token_id` válido para `preapproval` en AR.
- Lista cerrada de valores de `action` para `subscription_preapproval`,
  `subscription_preapproval_plan` y `subscription_authorized_payment`.
- Backoff exacto y número máximo de reintentos de webhook después del 3er intento ("el intervalo se
  extiende", sin números publicados).
- Si `PUT /preapproval_plan/{id}` cambiando `transaction_amount` requiere re-autorización del pagador
  cuando el monto sube (típico requisito de las redes de tarjetas), y si dispara notificación al pagador.
- Alícuota de IVA usada en el cálculo de comisión efectiva: se asumió **21%** (tasa general AR); no
  verificada contra una liquidación real de MP.
- Retenciones provinciales de IIBB aplicables a nuestra jurisdicción (MP sólo dice "los costos pueden
  variar de acuerdo a los impuestos provinciales").
- Comisión específica de nuestra cuenta: la sección de costos de MP es una SPA que requiere sesión;
  los porcentajes citados son los de la página pública de producto, que pueden diferir de los
  configurados/negociados por cuenta.
- Monto exacto del cobro de validación de tarjeta en AR ("un monto mínimo" que MP luego devuelve).
- Si existe un límite de planes (`preapproval_plan`) por aplicación.
