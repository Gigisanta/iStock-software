# Auditoría de preparación para producción

**Fecha:** 2026-09-04
**Estado:** localmente verificable; dominio wildcard operativo; producción pendiente de R2, despliegue y plan Vercel
**Workflow:** diagnóstico profundo → correcciones de catálogo, vidriera, UX y billing → gates → preflight

## Resultado ejecutivo

El síntoma del selector vacío tenía una causa concreta: la base tenía un catálogo Apple demasiado
chico y el alta de unidades no usaba sus variantes. El código local ahora carga 32 líneas de modelo,
ofrece modelo → capacidad → color, compone el título y vuelve a validar la pertenencia de la variante
en el servidor. La migración `0021_apple_catalog_seed.sql` se aplicó al Neon configurado y dejó 32
modelos activos.

El runtime de autenticación productivo también quedó cerrado a Neon Auth: se retiraron el driver
Supabase, su callback y sus credenciales del bundle/configuración web. `local` queda únicamente para
desarrollo y pruebas; `AUTH_DRIVER=neon` es el único camino productivo.

La experiencia local de landing, panel, vidriera, canje, reservas y billing está cubierta por el
build y la suite E2E. La última corrida completa fue **109/109 tests, 19/19 specs, sin skips**; suma
los contratos S11 de roles y S12 de onboarding cobrable (cuenta nueva → negocio → primer equipo
publicado → link público), además del acceso directo a suscripción sin sesión y la propagación del
nombre y precio publicado del panel a la vidriera pública. La duración configurable de reserva se
validó también en una corrida enfocada de S12. El preflight real todavía termina en **FAIL**: el
equipo de Vercel sigue en Hobby, faltan las dos credenciales de R2 y el alias de producción todavía
sirve un build anterior. Mercado Pago ya está presente en Production, pero el checkout corregido no
está live y el cobro real B3 todavía no fue verificado. El wildcard `*.maat.work` ahora tiene DNS,
delegación ACME y certificado administrado activos; por lo tanto el bloqueo restante es de despliegue
y credenciales, no de resolución del link. No corresponde afirmar que hoy se puede cobrar hasta
desplegar el HEAD y cerrar esos bloqueos.

## Última evidencia ejecutada

- `pnpm --filter @istock/web exec vitest run 'app/(billing)/_lib/subscribe.test.ts' 'app/(billing)/billing/subscribe/route.test.ts'`:
  PASS; 26 tests cubren rechazo definitivo, respuesta incierta, retención del lease y mensajes sin
  datos del pagador.
- `pnpm typecheck`: PASS en los 7 workspaces con scripts de typecheck.
- `pnpm lint`: PASS en domain, media, AI, DB/RLS, web, tests y E2E.
- `pnpm test`: PASS; **2.975 tests aprobados y 4 skips intencionales** de Mercado Pago porque
  requieren credenciales de una cuenta de prueba.
- `pnpm build`: PASS con Next.js 16.3.3; las rutas de marketing, billing y vidriera compilan.
- `git status --short --branch`: `main` sincronizada con `origin/main` en `f1ca023e59a086c35c78985c122e9543efed5633`,
  que incluye `c16b087`; sólo queda el directorio local no versionado `.serena/`, que se conserva
  intacto.
- `pnpm --filter @istock/e2e typecheck`: PASS.
- La ruta local `/_media` expone `Timing-Allow-Origin: *`; el e2e de media lo verifica sobre la
  respuesta HTTP real. El LCP con throttling y el header del CDN productivo siguen sin medirse.
- `E2E_PORT=3145 pnpm e2e`: PASS; 109/109 tests, 19/19 specs, 0 skips, sobre `next build` + `next start`, con
  smoke de marketing que verifica CTA, tabs, navegación por teclado, contraste e interacción en
  esquema oscuro, selección de plan y el host correcto del link de la vidriera en el panel local,
  `s11-seller-payload` (aislamiento de datos internos y boundary visual de owner) y
  `s12-onboarding-primer-equipo-publicado`:
  cuenta nueva, alta del negocio, apertura del enlace exacto de Base en modo local fail-closed,
  primer equipo desde catálogo, tres fotos, publicación y apertura de la vidriera usando exactamente
  el link que entrega el panel, redirección anónima de `/billing/suscribirse?plan=base` a login
  conservando el plan, edición del nombre y edición de precio con comprobación en el host público.
- `E2E_PORT=3144 E2E_ALLOW_PARTIAL=1 pnpm e2e e2e/s12-onboarding-primer-equipo-publicado.spec.ts`: PASS;
  5/5 tests. Además del recorrido de onboarding, edita la duración inicial de reserva, vuelve a Stock
  y comprueba que la preferencia queda seleccionada.
- `E2E_PORT=3124 bash scripts/accept-s6.sh`: PASS; V1–V10, incluido el barrido autenticado, la
  liberación de una reserva vencida y la medición de que la invalidación sólo regenera las páginas
  afectadas. La primera corrida había detectado un falso rojo de la probe por BCRA no aislado; la
  probe quedó corregida y la aceptación se reejecutó completa.
- La aceptación puntual posterior al ajuste visual suma 7/7 tests de marketing, incluido el límite
  de dos líneas del H1 en desktop, y se ejecutó sobre un build fresco.
- `bash scripts/accept-s9.sh`: PASS; la lista para estados filtra por tenant y `published_at`, no
  expone campos internos, conserva los tres estados públicos y no traga silenciosamente errores de
  portapapeles.
- `E2E_PORT=3102 bash scripts/accept-s13.sh`: PASS; el alias `/demo` viaja como `308`, conserva el
  path, deriva el destino del host entrante y no redirige al demo desde el subdominio de otro tenant.
- `pnpm install --lockfile-only --offline --ignore-scripts`: PASS; el override de esbuild quedó en
  `pnpm-workspace.yaml`, que es la ubicación leída por pnpm 10.
- `bash scripts/guard-artifacts.sh --harness`: PASS; 14 agents, 10 skills, 4 commands y 12 docs.
- `git diff --check`: PASS.
- `pnpm audit --audit-level=high`: PASS; `No known vulnerabilities found`.
- `bash scripts/preflight-vercel-production.sh`: **FAIL** por los controles externos detallados
  abajo.

## Hallazgos y correcciones

### Alta de equipos

- `getCatalogModels()` ya devuelve capacidades y colores sin exponer datos internos.
- `nueva-unidad-form.tsx` dejó de pedir que el dueño redacte el equipo: primero selecciona modelo,
  después GB y color compatibles; el título se muestra como resultado de esos campos.
- El schema ya no exige un título escrito por el navegador: el alta server-side acepta el valor vacío
  y compone el nombre canónico desde el catálogo. Así el flujo también funciona sin depender de
  JavaScript ni de un campo editable que contradiga el selector.
- `create-listing.ts` valida que el modelo esté activo y que GB/color pertenezcan a ese modelo
  antes de subir fotos o insertar la unidad. Un POST manipulado no puede crear una variante inválida.
- El seed y la migración son idempotentes; el test comprueba 32 modelos, slugs únicos y variantes no
  vacías.

### Aceptación de canjes

- La ficha del canje usa el mismo patrón de configuración: modelo del catálogo, capacidad y color
  como selects; el título es una vista previa de sólo lectura y no se acepta texto libre del
  visitante como fuente de verdad.
- El servidor valida que el modelo esté activo y que cada variante pertenezca a ese modelo antes de
  mover el lead a `accepted`. Un canje con un modelo, GB o color manipulado queda en `new` y no crea
  una unidad.
- La prueba E2E confirma el recorrido público → inbox → selección de variante → borrador, y el
  motor conserva el costo, el tenant y el vínculo con el lead.

### Vidriera y landings

- La UI local se refinó con la skill `taste`, tomando de Onorca el ritmo editorial, el contraste
  monocromo, las transiciones contenidas y las previsualizaciones interactivas sin copiar assets ni
  copy: composición editorial/mineral, mobile-first, una
  acción principal, estados vacío/carga/error, contraste y superficies planas con profundidad leve.
- La revisión final retiró los últimos colores utilitarios decorativos del panel: badges de reserva,
  traslado, canje, servicio y estados de leads usan la escala neutral; rojo y ámbar quedan sólo
  para errores y advertencias con significado. `monochrome-theme.test.ts` censa esa regla en las
  fuentes de producción para que el verde no vuelva por una clase aislada.
- La landing ahora concentra el hero en una promesa breve (`Tu stock, listo para vender`), una
  acción primaria y una previsualización concreta de la vidriera; se eliminó el copy auxiliar que
  competía con la conversión.
- El smoke `e2e/s0-marketing-landing.spec.ts` comprueba sobre navegador móvil que la landing responde
  200, que el showcase cambia entre Stock/Vidriera/WhatsApp con click y teclado, y que los CTA de
  precios conservan el plan elegido al entrar.
- El panel calcula el stock total y publicado para que el mensaje del link no diga que la vidriera
  está vacía cuando ya hay equipos cargados. El shell de la vidriera tampoco duplica el padding
  horizontal en mobile.
- Next 16.3 validaba estos segmentos como navegación instantánea y emitía una advertencia al leer
  `params` dentro del scope cacheado. Como la vidriera entrega HTML completo en la primera respuesta
  y usa enlaces `<a>` sin prefetch, las cinco rutas dinámicas declaran `instant = false`: es un
  opt-out explícito de esa validación, no un cambio de cache ni un shell parcial.
- La vidriera mantiene el contrato de ficha: fotos públicas por variantes, USD + ARS, condición,
  garantía, retiro, canje, badge y un único botón de WhatsApp; IMEI, costo, margen y notas internas
  no cruzan el DTO público.
- La invalidación de stock usa los tags del tenant, y la E2E verifica lectura cacheada, publicación,
  reserva, liberación y WhatsApp.
- El entorno público inspeccionado todavía sirve una versión anterior. `istock.maat.work` responde,
  pero no prueba el código local; `/demo` responde con redirección a `demo.maat.work`, cuyo DNS,
  certificado y HTTPS 200 están activos. La resolución del wildcard no es el bloqueo: el link que se
  pega en un estado todavía apunta a una build pública anterior.
- La diferencia visual también quedó medida: el HTML/CSS entregado por el deployment público vigente
  todavía contiene 16 referencias a `emerald` y el H1 anterior, mientras que el build local actual
  no contiene utilidades verdes y sirve la UI monocromática en claro y oscuro.
- El dominio wildcard quedó verificado en Vercel con certificado `*.maat.work` y renovación automática.
  Cloudflare conserva sus nameservers y sus registros existentes; sólo se agregaron los dos NS de
  `_acme-challenge` y el CNAME wildcard según la guía de Vercel. Un smoke HTTPS con `demo.maat.work`
  devuelve `HTTP/2 200` usando ambos edges de Vercel. La resolución del resolver local puede tardar
  por caché, pero los nameservers autoritativos ya entregan el CNAME correcto.
- El preflight ahora también falla explícitamente si el deployment público no contiene el H1
  monocromático actual o si el enlace anónimo de Base pierde `plan=base`; ambos controles fallaron
  contra la versión pública inspeccionada el 2026-09-04.
- En desarrollo, la base local de media ahora es `/_media` relativa al host: las fotos no quedan
  atadas al puerto `3000` cuando la app se prueba en `3101` u otro puerto.
- El seed técnico del tenant `demo` ya no deja mappings de fotos huérfanos: `pnpm db:seed` hidrata
  sus 30 fotos sintéticas con el mismo pipeline de resize y variantes que una carga real. El smoke
  local fresco sobre `demo.localhost:3102` encontró 16 URLs únicas y **16/16 HTTP 200
  `image/webp`**, con 10 cards visibles. Es sólo un fixture de navegación; las fotos de clientes
  siguen requiriendo carga real.

### Billing

- La ruta conserva `?plan=base|negocio` al pasar por login y creación de negocio; no se pierde la
  selección del CTA.
- Las pantallas de contratación son `noindex`: requieren sesión y no deben competir con la landing
  ni quedar expuestas como resultados de búsqueda.
- El checkout bloquea en el servidor a un tenant que ya tiene Base o Pro, y el panel deja de
  mostrar botones para abrir otra suscripción después de la activación.
- El botón de contratación muestra estado de conexión y bloquea dobles toques en la misma pestaña.
  La migración `0022_thankful_boomer.sql` agrega un intent durable por tenant: un lock de fila y un
  lease de 10 minutos bloquean duplicados entre pestañas, reutilizan el `init_point` listo y dejan
  reintentar un fallo sin pedir otra fila.
- El intent se libera sólo cuando el webhook confirma una autorización o cancelación; un estado
  `pending` de Mercado Pago no abre una segunda suscripción. Las llamadas HTTP al proveedor tienen
  timeout de 10 segundos para que una API lenta no consuma indefinidamente una función serverless.
- El precio ARS se calcula server-side desde el TC persistido del tenant y se redondea al millar
  superior. El navegador sólo puede elegir el plan, nunca tenant, mail, importe ni credenciales.
- La lista comercial vigente es Base USD 35 y Pro USD 70 (la clave de almacenamiento sigue siendo
  `negocio`). Mercado Pago recibe un importe fijo en ARS calculado con el TC BCRA persistido al
  momento de la adhesión y luego gestiona el débito recurrente de ese importe; MP no hace una
  conversión USD→ARS automática en cada ciclo.
- Si el `POST /preapproval` falla de forma incierta después de salir del proceso (timeout, red,
  5xx o respuesta malformada), el checkout conserva el intent `creating` durante su lease de 10
  minutos y muestra `verificar`; sólo un 4xx definitivo libera el intent. Así un reintento inmediato
  no puede crear dos preapprovals aunque no sepamos si el primero llegó a Mercado Pago.
- El driver real usa la integración oficial de Mercado Pago **sin plan asociado y con estado
  `pending`**: envía `reason`, `external_reference`, `payer_email`, `auto_recurring` mensual en ARS,
  `back_url` y `status: pending`, y redirige al `init_point` de esa suscripción. La documentación
  oficial confirma que esta variante deja que el pagador complete el medio de pago desde el checkout
  hospedado: [pago pendiente sin plan asociado](https://www.mercadopago.com.ar/developers/es/docs/subscriptions/integration-configuration/subscription-no-associated-plan/pending-payments)
  y [referencia de creación de suscripción](https://www.mercadopago.com.ar/developers/en/reference/online-payments/subscriptions/create-preapproval/post.md).
- El trial de 14 días es el trial del producto y no se duplica dentro del checkout de Mercado Pago.
  El acceso sólo se activa cuando el webhook firmado confirma la suscripción autorizada.
- La configuración de Production rechaza explícitamente `BILLING_DRIVER=mock`; no puede quedar una
  instalación desplegada aparentando aceptar pagos mientras sólo funciona el trial.
- El webhook consulta el recurso en Mercado Pago, verifica HMAC, deduplica por evento y actualiza
  suscripción + tenant en una transacción. La autorización comercial usa únicamente
  `subscription_preapproval` y `subscription_authorized_payment`, porque el recurso oficial
  `/v1/payments/{id}` expone `external_reference` como texto libre pero no un `preapproval_id` que
  vincule el pago a una adhesión. Por eso el tópico `payment` se acepta y se ignora: nunca puede
  habilitar un plan por sí solo. Una cuota `processed` sólo habilita el plan si el pago asociado
  fue aprobado. El cliente también conserva `auto_recurring.transaction_amount` del preapproval en
  centavos ARS, así una notificación de suscripción no borra el importe que ya dejó una cuota
  autorizada. El mismo efecto limpia el intent durable cuando el estado ya es final. Los cuatro
  escenarios de cuenta real todavía no se ejecutaron: forman B3; los tests locales del handler no
  sustituyen ese cobro. Fuentes: [webhooks de Mercado Pago](https://www.mercadopago.com.ar/developers/es/docs/your-integrations/notifications/webhooks)
  y [obtener pago](https://www.mercadopago.com.ar/developers/es/reference/online-payments/subscriptions/get-payment/get).
- `MP_ACCESS_TOKEN` y `MP_WEBHOOK_SECRET` ya existen en las variables Production de Vercel sin
  exponer sus valores. La corrección que agrega `notification_url` al alta de la suscripción fue
  introducida en `c16b087`, incluido en el HEAD actual `f1ca023e59a086c35c78985c122e9543efed5633`;
  sigue pendiente de un despliegue porque el plan Hobby rechaza el cron.

### Configuración operativa

- La duración inicial de la reserva dejó de ser un número global: cada tenant la guarda en
  `tenants.reservation_minutes`, con default 60 y una constraint que sólo acepta los cuatro presets
  visibles en Ajustes. El owner la cambia desde `/app/ajustes`; el stock la recibe desde la sesión y
  la acción server-side también la usa si el formulario llega sin duración. No se abrieron permisos
  para `anon`: la columna queda fuera del read model de la vidriera.

- La configuración de identidad dejó un solo proveedor productivo. `apps/web` no conserva un
  fallback Supabase ni un callback alternativo: con `AUTH_DRIVER=neon`, Neon Auth atiende el
  subárbol `/api/auth/[...path]` y el servidor vuelve a resolver la membresía desde Postgres.

### Autorización del panel

- `requireOwner()` usa el interrupt nativo `forbidden()` de Next con `experimental.authInterrupts`
  habilitado. Una cuenta seller con sesión válida recibe `app/forbidden.tsx`, en vez de convertir
  la falta de rol en un 500 o mandarla a iniciar sesión otra vez. En una página con `Suspense` y
  Cache Components el shell ya puede haber empezado como 200; la frontera reemplaza el contenido
  visible. Las mutaciones sensibles no tienen ese shell y conservan 403, incluido
  `/billing/subscribe`. El contrato queda cubierto por `app/auth-interrupts.test.ts` y el build de
  producción lo compila con Next 16.3.3.

## Preflight real del 2026-09-04

| Control | Resultado | Consecuencia |
|---|---|---|
| Sesión Vercel | PASS | usuario esperado disponible |
| Plan del equipo | **FAIL: Hobby** | iStock comercial requiere Pro |
| Variables Production | **FAIL: faltan `R2_ACCESS_KEY_ID` y `R2_SECRET_ACCESS_KEY`; MP presente** | las fotos reales siguen cerradas; el checkout MP corregido aún no está live |
| Cron de reservas | PASS | hay una ruta cada 5 minutos declarada; el plan Hobby bloquea el deploy y requiere Vercel Pro |
| `istock.maat.work` | PASS | el apex llega a Vercel |
| `demo.maat.work` / wildcard | **PASS: CNAME, delegación ACME, certificado y HTTPS 200** | los links wildcard ya llegan a Vercel; falta comprobar un tenant real luego del deploy |
| Deployment existente | PASS | existe historial, pero no implica que sea este HEAD |
| Landing pública actual | **FAIL: sirve H1 y utilidades verdes de una versión anterior** | hay que desplegar el HEAD monocromático |
| Suscripción anónima Base | **FAIL: el deployment no conserva `plan=base` al derivar a login** | validar el flujo en el deployment actualizado |

El comando es sólo lectura y no imprime secretos: `bash scripts/preflight-vercel-production.sh`.

## Bloqueos externos antes de cobrar

1. Mantener el cron `*/5`: el plan Hobby bloquea el deploy por esa frecuencia. Elegir cómo salir de
   Hobby: pasar el equipo Vercel a Pro cuando haya un cliente, o reabrir formalmente la ADR de jobs
   con research antes de cambiar de proveedor. No se puede desplegar con un cron diario: rompería la
   expiración de reservas.
2. Crear las credenciales S3 de alcance exclusivo para `istock-media` y `istock-originals` y cargarlas
   en Production. R2 ya tiene `img.maat.work` activo con SSL y `r2.dev` deshabilitado en ambos buckets.
3. Configurar en Production el proveedor de autenticación/Neon, R2 privado para originales y R2/CDN
   para variantes públicas, junto con `MEDIA_DRIVER`, las credenciales S3 server-only y
   `NEXT_PUBLIC_MEDIA_BASE_URL`. El preflight confirma la presencia de variables, no la validez de
   sus credenciales.
4. Confirmar que la aplicación y el vendedor de Mercado Pago correspondan a Production, mantener
   `BILLING_DRIVER=mercadopago`, y registrar el webhook público
   `/billing/webhooks/mercadopago`.
5. Ejecutar B3 con una cuenta compradora de prueba para ambos planes: abrir checkout, confirmar el
   importe ARS, terminar la adhesión, recibir `subscription_preapproval`/pago autorizado, repetir
   el mismo webhook, simular rechazo/reintentos y confirmar que el tenant queda habilitado o
   degradado según el estado real. La prueba debe verificar también el medio elegido; la presencia
   de un valor en el enum de la API no prueba que pueda adherirse en esta cuenta.
6. Desplegar el HEAD por el pipeline normal, ejecutar `pnpm db:migrate` en el entorno objetivo y
   repetir el preflight, los smoke tests HTTPS y la E2E con dominio real. No activar cobros en
   Production antes de ese paso.

## Riesgos que permanecen declarados

- Mercado Pago no documenta una clave de idempotencia para `POST /preapproval`. El intent local
  serializa las solicitudes normales y, ante una respuesta incierta, conserva el lease para evitar
  el duplicado inmediato; queda una ambigüedad excepcional si el proceso crea el preapproval en
  Mercado Pago y cae antes de guardar su `init_point`. Sólo B3 con la cuenta real puede determinar
  si después del vencimiento del lease conviene reconciliar ese caso mediante búsqueda del proveedor.
- El importe ARS queda congelado en cada suscripción sin plan asociado. Reajustar automáticamente
  por BCRA requiere una decisión de producto y un flujo de actualización/cancelación; no se inventó
  un `PUT` masivo sin verificar su efecto comercial.
- Las credenciales, límites, comisiones, medios disponibles y notificaciones de la cuenta real no
  están verificados en este entorno. Son `UNVERIFIED`, no supuestos.

## Aceptación reproducible para el LEAD

```text
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm --filter @istock/e2e typecheck
E2E_PORT=3145 pnpm e2e
E2E_PORT=3144 E2E_ALLOW_PARTIAL=1 pnpm e2e e2e/s12-onboarding-primer-equipo-publicado.spec.ts
bash scripts/guard-artifacts.sh --harness
pnpm audit --audit-level=high
bash scripts/preflight-vercel-production.sh
```

## Costo y datos

- Migraciones: 32 filas globales de catálogo, la tabla tenant-scoped de intents de checkout y la
  preferencia tenant-scoped de reservas, con RLS, FORCE RLS, policies de owner y grants explícitos.
- FX: una lectura del valor persistido por contratación; el cron de expiración corre cada 5 minutos,
  pero la cotización BCRA se cachea por día y sólo escribe/invalida tenants cuyo valor cambió. Las
  solicitudes concurrentes reutilizan la misma promesa por instancia.
- Checkout: una lectura de FX, un intent transaccional con lock y una llamada a Mercado Pago por
  intento explícito del dueño; una pestaña bloqueada no llama al proveedor y un checkout listo
  reutiliza su URL. No se almacenan datos de tarjeta. La aceptación de un canje agrega una lectura
  puntual del modelo global para validar sus variantes; no agrega una consulta por pageview.
- Vidriera: no se agrega una consulta por pageview; las fotos públicas siguen siendo variantes
  redimensionadas y el original permanece privado.
- Seed del demo: en local no agrega egress; con `MEDIA_DRIVER=r2`, una corrida de 30 fotos implica
  hasta 120 escrituras de objetos (master privado + thumb/card/detail por foto), con deduplicación
  por contenido del driver. No se ejecuta en el hot path de visitantes.

**UNVERIFIED:** cuenta real de Mercado Pago, medios de pago y trial en checkout, webhook público y
reintentos reales, credenciales R2/Neon/Auth/observabilidad en Production, asociación del wildcard a
un tenant real después del deploy y aplicación de las migraciones `0022_thankful_boomer.sql` y
`0023_unknown_loners.sql` en el entorno objetivo.

**BLOCKERS:** Vercel Hobby bloquea el deploy con el cron `*/5`; faltan las credenciales R2; el
deployment público sirve una build vieja y no el HEAD `f1ca023e59a086c35c78985c122e9543efed5633`;
prueba B3 humana pendiente; migraciones `0022`/`0023` pendientes en Production.
