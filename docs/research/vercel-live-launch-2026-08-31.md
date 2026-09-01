# vercel-live-launch-2026-08-31
_Consultado: 2026-09-01 · Agente: researcher_

## Pregunta

¿Cuál es la ruta más eficiente y de menor riesgo operativo para publicar iStock en Vercel con Pro, un cron cada 5 minutos, WAF/rate limiting, `*.maat.work`, integración GitHub y un inventario de límites de variables de entorno?

## Respuesta corta

- Contratar Vercel Pro: cuesta USD 20/mes, incluye 1 asiento de deploy y USD 20 de crédito de uso; Hobby no es válido para el SaaS comercial de iStock. La frecuencia `*/5` del repo equivale a 8.640 invocaciones en un mes de 30 días y es válida en Pro, cuyo mínimo es 1 minuto. [Plan Pro](https://vercel.com/docs/plans/pro-plan) — consultado 2026-09-01; [Terms](https://vercel.com/legal/terms) — consultado 2026-09-01; [cron del repo](https://github.com/Gigisanta/iStock-software/blob/main/vercel.json) — consultado 2026-09-01.
- Importar `Gigisanta/iStock-software` mediante la integración nativa de GitHub, producción desde `main`, previews para pull requests y `Root Directory` `apps/web`; habilitar acceso a fuentes fuera del root para `packages/*`. Mantener GitHub Actions como alternativa avanzada, no como camino principal. [Git integration](https://vercel.com/docs/git) — consultado 2026-09-01; [Monorepos](https://vercel.com/docs/monorepos) — consultado 2026-09-01.
- Delegar `maat.work` a los nameservers de Vercel (`ns1.vercel-dns.com` y `ns2.vercel-dns.com`) para que `*.maat.work` tenga wildcard y certificado gestionados por Vercel. Cloudflare como DNS autoritativo no es equivalente para este wildcard de apex; tampoco conviene poner su proxy delante de Vercel. [Wildcard domains](https://vercel.com/kb/guide/why-use-domain-nameservers-method-wildcard-domains) — consultado 2026-09-01; [Cloudflare with Vercel](https://vercel.com/kb/guide/cloudflare-with-vercel) — consultado 2026-09-01.
- Publicar en Vercel Firewall las 4 reglas versionadas del repo sobre endpoints de escritura/chat, no sobre HTML de la vidriera: Pro permite 40 reglas y ventanas `fixed_window` de 10–600 segundos; incluye 1.000.000 de requests permitidos y luego factura USD 0,50 por millón según la página específica de rate limiting. [Reglas del repo](https://github.com/Gigisanta/iStock-software/blob/main/config/firewall-rules.json) — consultado 2026-09-01; [Rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting) — consultado 2026-09-01.
- Configurar Production y Preview por separado, dejando secretos server-only; Vercel admite hasta 1.000 variables por environment/project y 64 KB combinados por deployment, con máximo 64 KB por variable. `CRON_SECRET` debe ser aleatorio y tener al menos 16 caracteres según Vercel. [Environment variables](https://vercel.com/docs/environment-variables) — consultado 2026-09-01; [Cron security](https://vercel.com/docs/cron-jobs/manage-cron-jobs) — consultado 2026-09-01.

## Detalle

### Ruta de publicación

1. Crear o asociar el equipo Vercel al plan Pro y conectar el repositorio público de GitHub. Pro es el umbral correcto por el uso comercial: los términos de Vercel reservan Hobby para uso personal/no comercial, y la guía de fair use exige Pro o Enterprise para una aplicación comercial.
2. Crear un solo proyecto Vercel para `apps/web`: es la única app desplegable detectada en este monorepo; `packages/db`, `domain`, `media` y `ai` son dependencias compartidas. En el import, elegir `apps/web` como `Root Directory` y activar “Include source files outside of Root Directory”. Vercel detecta pnpm desde el `packageManager` del repo y la configuración de workspace.
3. Dejar la rama de producción en `main`. La integración Git nativa genera deployments de preview para pushes y pull requests, y el deployment de producción para el merge/push de la rama configurada. Para proteger producción, combinar checks de GitHub requeridos con Deployment Checks de Vercel.
4. Cargar variables en Vercel, no en el repositorio. En particular, `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, credenciales R2, secretos de Mercado Pago, claves LLM y `CRON_SECRET` quedan server-only. Las variables `NEXT_PUBLIC_*` se incorporan al bundle cliente y no deben contener secretos.
5. Verificar en el primer deployment que el cron aparezca en la pestaña de Cron Jobs y que el deployment sea Production. El archivo actual `vercel.json` está en la raíz del repositorio, mientras que Vercel documenta que la configuración está en el root del proyecto y que el proyecto monorepo puede tener `apps/web` como root: esa interacción no debe darse por supuesta.
6. Agregar el dominio raíz y delegar los nameservers en Vercel. Antes del cambio, relevar y recrear en Vercel todos los registros necesarios de correo, verificación y terceros. Después, asociar el wildcard `*.maat.work` y probar un slug real, el root y los redirects HTTPS.
7. Aplicar las reglas WAF desde Vercel Firewall CLI/dashboard y hacer `Publish`. `config/firewall-rules.json` es una declaración versionada del repo, no una fuente que Vercel sincronice automáticamente durante `vercel deploy`; el estado vivo debe comprobarse con el diff de Firewall y una prueba controlada de cada endpoint.

### Cron de 5 minutos

El repo ya declara `GET /api/cron/expire-reservations` con `schedule: */5 * * * *`. Vercel ejecuta los cron jobs contra el deployment de producción, en UTC, mediante HTTP GET. La expresión representa 12 ejecuciones por hora, 288 por día y 8.640 en un mes de 30 días, suponiendo una invocación por ejecución. [Cron jobs](https://vercel.com/docs/cron-jobs) — consultado 2026-09-01; [vercel.json](https://vercel.com/docs/project-configuration/vercel-json) — consultado 2026-09-01; [archivo del repo](https://github.com/Gigisanta/iStock-software/blob/main/vercel.json) — consultado 2026-09-01.

Cron está disponible en todos los planes, pero Hobby no acepta esta periodicidad: su mínimo es diario, mientras que Pro acepta una precisión mínima de 1 minuto. Pro también permite hasta 100 cron jobs por proyecto. Por lo tanto, Pro es necesario para iStock por comercialidad y por la frecuencia, aunque el cron individual no tenga una tarifa separada.

Vercel recomienda proteger el endpoint con `CRON_SECRET`; envía `Authorization: Bearer <CRON_SECRET>`. El handler debe fallar cerrado si el secreto falta o no coincide, responder sin redirect y ser idempotente. No hay retries automáticos documentados; además, Vercel advierte que pueden existir ejecuciones duplicadas u overlap si una corrida tarda más que el intervalo. La expiración de reservas necesita lock/idempotencia por datos, no solamente confiar en el scheduler. [Manage Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs) — consultado 2026-09-01.

El changelog de Vercel publicado el 2026-05-29 anuncia facturación de invocaciones de Functions por unidad para Pro a USD 0,0000006 por invocación. Aplicado solamente al componente de invocaciones del cron, 8.640 × USD 0,0000006 = USD 0,005184 por 30 días. La página general de Functions todavía describe 1.000.000 de requests incluidos y USD 0,60 por millón; ambos números son matemáticamente equivalentes, pero la documentación difiere sobre el modo de aplicación y la interacción con el crédito mensual. Para presupuesto se toma el changelog más nuevo; la factura final, CPU, memoria y transferencia siguen sin verificar. [Changelog de invocaciones](https://vercel.com/changelog/function-invocations-now-billed-per-unit) — consultado 2026-09-01; [Functions usage and pricing](https://vercel.com/docs/functions/usage-and-pricing) — consultado 2026-09-01.

### WAF y rate limiting

La mitigación DDoS y las reglas WAF básicas están disponibles en todos los planes. La documentación específica de rate limiting indica que Hobby y Pro usan `fixed_window`, permiten contar por IP o JA4 Digest, y aceptan ventanas de 10 segundos a 10 minutos. Pro permite 40 reglas por proyecto; el repo ya declara 4 reglas: `/api/track`, `/api/tradein`, `/api/chat` y `/billing/subscribe`. [Rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting) y [reglas del repo](https://github.com/Gigisanta/iStock-software/blob/main/config/firewall-rules.json) — consultados 2026-09-01. Las tres primeras protegen la superficie pública de la vidriera/chat; el billing protege intentos de alta.

El alcance debe ser por endpoint exacto, no por host o por todo `*.maat.work`: el rate limit contabiliza requests permitidos y el HTML de la vidriera está diseñado para ser cacheable/scrapeable. La regla del chatbot limita abuso por IP, pero no sustituye la cuota diaria por tenant ya prevista por la arquitectura. El cron y los webhooks quedan fuera del rate limiting por IP porque sus llamadores legítimos pueden reintentar desde rangos compartidos; se protegen con secreto/firma y validación antes de tocar datos.

La documentación de precios de rate limiting publica 1.000.000 de allowed requests incluidos para Hobby/Pro y USD 0,50 por cada millón adicional. El comentario versionado en `config/firewall-rules.json` aún dice USD 0,80 por millón: es una contradicción concreta; pesa más la página oficial específica y vigente de Vercel, pero la tarifa efectiva por región debe confirmarse en el dashboard antes de activar billing. La plantilla oficial de rate limit también dice “Pro o Enterprise”, en conflicto con la página específica y el changelog que habilitó rate limiting en Hobby; para esta decisión se priorizan la documentación del producto y el changelog, y se deja la disponibilidad exacta de la cuenta como aceptación.

Las acciones de bloqueo/challenge del WAF no se configuran como una sincronización de `config/firewall-rules.json`. Vercel documenta que `vercel.json` soporta reglas WAF con acciones `challenge` y `deny`, pero no el objeto de rate limiting de este repo. El Firewall se debe revisar y publicar separadamente. El changelog de 2026 indica que el tráfico mitigado por WAF no cuenta como CDN requests/Fast Data Transfer, lo que hace preferible bloquear en el edge; sí puede haber cargos específicos de allowed requests, Functions, base de datos o proveedores externos.

Fuentes: [WAF](https://vercel.com/docs/vercel-firewall) — consultado 2026-09-01; [rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting) — consultado 2026-09-01; [usage and pricing](https://vercel.com/docs/vercel-firewall/vercel-waf/usage-and-pricing) — consultado 2026-09-01; [WAF mitigated traffic](https://vercel.com/changelog/web-application-firewall-mitigated-traffic-is-free-on-vercel) — consultado 2026-09-01; [custom rules in `vercel.json`](https://vercel.com/docs/vercel-firewall/vercel-waf/custom-rules) — consultado 2026-09-01.

### Wildcard: nameservers Vercel versus Cloudflare

Para `*.maat.work`, Vercel exige la validación por nameservers porque el certificado wildcard usa DNS-01. La ruta recomendada es delegar el dominio a `ns1.vercel-dns.com` y `ns2.vercel-dns.com`; Vercel administra DNS y certificados wildcard, y su WAF ve el tráfico directamente. La alternativa documentada de delegar solamente `_acme-challenge` sirve para wildcards anidados como `*.app.example.com` y excluye explícitamente el wildcard del apex `*.example.com`, por lo que no resuelve `*.maat.work`. [Wildcard sin nameservers de Vercel](https://vercel.com/kb/guide/wildcard-domain-without-vercel-nameservers) — consultado 2026-09-01.

Con Cloudflare como nameserver autoritativo hay tres escenarios distintos:

| escenario | resultado para iStock |
|---|---|
| Vercel DNS + tráfico directo a Vercel | Recomendado para `*.maat.work`: wildcard/certificado automáticos y visibilidad completa del WAF Vercel. Requiere migrar y revisar todos los DNS del dominio. |
| Cloudflare DNS, records DNS-only | Mantiene Cloudflare como autoridad, pero no entrega el camino de wildcard apex que Vercel documenta; obligaría a resolver tenants con dominios/registros individuales o una integración no verificada. |
| Cloudflare DNS + proxy delante de Vercel | Vercel desaconseja el reverse proxy por pérdida de visibilidad, posibles problemas de caché y latencia. No usarlo como capa adicional para este lanzamiento. |

Hay una tensión con el media domain existente: Cloudflare documenta que el custom domain de R2 necesita una zona en la cuenta Cloudflare y que el CNAME setup parcial está limitado a planes Business/Enterprise. Si `maat.work` pasa a Vercel DNS, no está verificado que `img.maat.work` pueda conservar exactamente el flujo R2 actual sin una zona/media domain separado o un setup parcial de Cloudflare. La decisión eficiente para el launch es Vercel DNS para el dominio de tenants y, antes de producción, elegir entre un hostname de media separado gestionado por Cloudflare o validar/contratar el setup parcial; `r2.dev` no es una salida de producción.

Fuentes: [Vercel nameservers](https://vercel.com/docs/domains/working-with-nameservers) — consultado 2026-09-01; [add a domain](https://vercel.com/docs/domains/working-with-domains/add-a-domain) — consultado 2026-09-01; [wildcard without Vercel nameservers](https://vercel.com/kb/guide/wildcard-domain-without-vercel-nameservers) — consultado 2026-09-01; [migrating from Cloudflare](https://vercel.com/kb/guide/migrate-to-vercel-from-cloudflare) — consultado 2026-09-01; [Cloudflare with Vercel](https://vercel.com/kb/guide/cloudflare-with-vercel) — consultado 2026-09-01; [Cloudflare R2 custom domains](https://developers.cloudflare.com/r2/buckets/public-buckets/) — consultado 2026-09-01; [Cloudflare partial setup](https://developers.cloudflare.com/dns/zone-setups/partial-setup/) — consultado 2026-09-01.

### Git integration y monorepo

La integración nativa es el camino más corto: importar el repositorio, autorizar GitHub, elegir `main` como production branch y dejar que Vercel publique previews por PR. El usuario que conecta un repositorio de organización debe tener acceso compatible con Vercel; un Outside Collaborator no puede importar/conectar el repo según la documentación. En Pro, el autor del commit debe pertenecer al equipo Vercel para que el commit dispare deployment.

GitHub Actions no agrega valor para este repo público y un flujo Vercel estándar; Vercel lo documenta como alternativa para GitHub Enterprise Server, builds prebuilt o pipelines avanzados. Si se agrega Actions en el futuro, proteger secrets y no confundir los límites de Actions con los de runtime Vercel.

GitHub branch protection debe exigir checks de typecheck/lint/tests antes del merge. Vercel Deployment Checks puede impedir promover a producción mientras no pasen los checks seleccionados. El build completo no fue ejecutado en esta investigación; el LEAD debe hacer ese gate con salida controlada.

### Límites de variables

Los límites que gobiernan el runtime de iStock son los de Vercel:

- Hasta 1.000 variables por environment y por proyecto.
- Hasta 64 KB combinados de nombres y valores por deployment y hasta 64 KB para una variable individual en runtimes Node/Python/Ruby/Go/Java/.NET.
- Edge Functions/Middleware tienen un límite menor de 5 KB por variable; el proyecto debe conservar handlers de servidor donde necesite secretos o payloads mayores.
- Un cambio de variable sólo afecta deployments nuevos; después de cargar o rotar un secreto hay que redeployar.

Los límites de GitHub Actions sólo importan si el equipo elige el pipeline alternativo: una variable o secret individual admite 48 KB; GitHub publica hasta 1.000 variables de organización, 500 de repositorio y 100 de environment, con un límite combinado de 256 KB para variables de organización/repositorio por workflow. No usar ese canal para suplir las variables de runtime de Vercel.

Fuentes: [Vercel limits](https://vercel.com/docs/limits) — consultado 2026-09-01; [Vercel environment variables](https://vercel.com/docs/environment-variables) — consultado 2026-09-01; [GitHub Actions variables](https://docs.github.com/en/actions/reference/workflows-and-actions/variables) — consultado 2026-09-01; [GitHub Actions secrets](https://docs.github.com/en/actions/reference/security/secrets) — consultado 2026-09-01.

## Números que importan

| ítem | valor | unidad | fuente |
|---|---:|---|---|
| Vercel Pro | 20 | USD/mes | [Plan Pro](https://vercel.com/docs/plans/pro-plan) — consultado 2026-09-01 |
| Crédito incluido en Pro | 20 | USD/mes | [Plan Pro](https://vercel.com/docs/plans/pro-plan) — consultado 2026-09-01 |
| Asientos de deploy incluidos | 1 | asiento/equipo | [Plan Pro](https://vercel.com/docs/plans/pro-plan) — consultado 2026-09-01 |
| Intervalo mínimo de cron en Pro | 1 | minuto | [Cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing) — consultado 2026-09-01 |
| Cron jobs máximos por proyecto | 100 | jobs/proyecto | [Cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing) — consultado 2026-09-01 |
| Schedule actual | 5 | minutos | [vercel.json del repo](https://github.com/Gigisanta/iStock-software/blob/main/vercel.json) — consultado 2026-09-01 |
| Ejecuciones derivadas del schedule | 8.640 | invocaciones/30 días | Cálculo `12 × 24 × 30` a partir de [vercel.json](https://github.com/Gigisanta/iStock-software/blob/main/vercel.json) — consultado 2026-09-01 |
| Precio anunciado de invocación Function Pro | 0,0000006 | USD/invocación | [Changelog de Vercel](https://vercel.com/changelog/function-invocations-now-billed-per-unit) — consultado 2026-09-01 |
| Componente de invocaciones del cron, derivado | 0,005184 | USD/30 días | Cálculo `8.640 × 0,0000006`; inputs: [schedule del repo](https://github.com/Gigisanta/iStock-software/blob/main/vercel.json) y [changelog de Vercel](https://vercel.com/changelog/function-invocations-now-billed-per-unit) — consultado 2026-09-01 |
| Reglas WAF rate limit Pro | 40 | reglas/proyecto | [Rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting) — consultado 2026-09-01 |
| Reglas WAF rate limit Hobby | 1 | regla/proyecto | [Rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting) — consultado 2026-09-01 |
| Ventana `fixed_window` Hobby/Pro | 10–600 | segundos | [Rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting) — consultado 2026-09-01 |
| Counting keys Hobby/Pro | 2 | IP y JA4 Digest | [Rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting) — consultado 2026-09-01 |
| Allowed requests incluidos Hobby/Pro | 1.000.000 | requests | [WAF usage and pricing](https://vercel.com/docs/vercel-firewall/vercel-waf/usage-and-pricing) — consultado 2026-09-01 |
| Rate limiting adicional publicado | 0,50 | USD/millón de allowed requests | [WAF usage and pricing](https://vercel.com/docs/vercel-firewall/vercel-waf/usage-and-pricing) — consultado 2026-09-01 |
| Variables Vercel | 1.000 | variables/environment/project | [Vercel limits](https://vercel.com/docs/limits) — consultado 2026-09-01 |
| Tamaño Vercel por deployment | 64 | KB combinados | [Environment variables](https://vercel.com/docs/environment-variables) — consultado 2026-09-01 |
| Tamaño máximo de una variable Vercel | 64 | KB/variable | [Environment variables](https://vercel.com/docs/environment-variables) — consultado 2026-09-01 |
| Tamaño de variable Edge | 5 | KB/variable | [Environment variables](https://vercel.com/docs/environment-variables) — consultado 2026-09-01 |
| Variable/secret de GitHub Actions | 48 | KB/elemento | [GitHub variables](https://docs.github.com/en/actions/reference/workflows-and-actions/variables) — consultado 2026-09-01; [GitHub secrets](https://docs.github.com/en/actions/reference/security/secrets) — consultado 2026-09-01 |
| Variables GitHub: org/repo/environment | 1.000/500/100 | variables | [GitHub variables](https://docs.github.com/en/actions/reference/workflows-and-actions/variables) — consultado 2026-09-01 |
| Nameservers Vercel | 2 | `ns1.vercel-dns.com`, `ns2.vercel-dns.com` | [Working with nameservers](https://vercel.com/docs/domains/working-with-nameservers) — consultado 2026-09-01 |

## Fuentes

- [Vercel Pro plan](https://vercel.com/docs/plans/pro-plan) — consultado 2026-09-01.
- [Vercel Terms of Service](https://vercel.com/legal/terms) — consultado 2026-09-01.
- [Vercel fair use guidelines](https://vercel.com/docs/limits/fair-use-guidelines) — consultado 2026-09-01.
- [Vercel Cron Jobs](https://vercel.com/docs/cron-jobs) — consultado 2026-09-01.
- [Vercel Cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing) — consultado 2026-09-01.
- [Vercel Manage Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs) — consultado 2026-09-01.
- [Vercel Function invocations billed per unit](https://vercel.com/changelog/function-invocations-now-billed-per-unit) — consultado 2026-09-01.
- [Vercel Firewall](https://vercel.com/docs/vercel-firewall) — consultado 2026-09-01.
- [Vercel WAF rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting) — consultado 2026-09-01.
- [Vercel WAF usage and pricing](https://vercel.com/docs/vercel-firewall/vercel-waf/usage-and-pricing) — consultado 2026-09-01.
- [Vercel wildcard domains and nameservers](https://vercel.com/kb/guide/why-use-domain-nameservers-method-wildcard-domains) — consultado 2026-09-01.
- [Vercel Cloudflare guidance](https://vercel.com/kb/guide/cloudflare-with-vercel) — consultado 2026-09-01.
- [Vercel monorepos](https://vercel.com/docs/monorepos) — consultado 2026-09-01.
- [Vercel Git integration](https://vercel.com/docs/git) — consultado 2026-09-01.
- [Vercel environment variables](https://vercel.com/docs/environment-variables) — consultado 2026-09-01.
- [GitHub Actions variables](https://docs.github.com/en/actions/reference/workflows-and-actions/variables) — consultado 2026-09-01.
- [GitHub Actions secrets](https://docs.github.com/en/actions/reference/security/secrets) — consultado 2026-09-01.
- [Cloudflare R2 public buckets/custom domains](https://developers.cloudflare.com/r2/buckets/public-buckets/) — consultado 2026-09-01.

## Impacto en iStock

### ARCHITECTURE

- La arquitectura de producción queda: un proyecto Vercel para `apps/web`, despliegue Git nativo, Vercel DNS para `maat.work`, wildcard directo a Vercel y Vercel Firewall en el edge. Esto conserva el routing host→tenant y evita un proxy Cloudflare delante de la app.
- El cron de expiración debe validar `CRON_SECRET` antes de abrir conexiones o mutar reservas, y el barrido debe ser idempotente/seguro ante overlap y duplicados.
- El WAF protege `/api/track`, `/api/tradein`, `/api/chat` y `/billing/subscribe` con reglas exactas. No se agrega un bucket global sobre pageviews ni se rate-limita el webhook de Mercado Pago o el cron por IP.
- `img.maat.work` queda como dependencia de arquitectura separada: hay que probar un media domain Cloudflare independiente o el setup parcial antes de comprometer la migración de DNS.

### DECISIONS

- Pro es obligatorio por comercialidad y por el cron de 5 minutos; el hecho de que Cron exista en Hobby no cambia esa decisión. [Terms](https://vercel.com/legal/terms) y [cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing) — consultados 2026-09-01.
- La integración nativa GitHub/Vercel es la ruta de publicación. Branch protection y Deployment Checks son gates; GitHub Actions queda reservado para una necesidad concreta.
- Se elige Vercel nameservers para `*.maat.work`, sujeto a recrear y verificar DNS de correo/terceros. No se elige Cloudflare proxy delante de Vercel.
- Las reglas de rate limiting se aplican/publican como configuración operativa del Firewall, no se consideran desplegadas sólo porque exista `config/firewall-rules.json`.
- Antes del primer deployment debe resolverse la ubicación efectiva de `vercel.json`: el repo lo tiene en la raíz y la recomendación monorepo usa `apps/web` como root. Si el cron no aparece en Production, el lanzamiento no está aceptado.

### COST

- Base: USD 20/mes de Vercel Pro, con USD 20 de crédito incluido. El componente anunciado de invocaciones del cron es aproximadamente USD 0,005184 por 30 días, pero CPU, memoria, transferencia y la aplicación exacta del crédito no están cerradas por la documentación contradictoria. [Plan Pro](https://vercel.com/docs/plans/pro-plan) y [changelog de invocaciones](https://vercel.com/changelog/function-invocations-now-billed-per-unit) — consultados 2026-09-01.
- Rate limiting: 1.000.000 de allowed requests incluidos en Pro y USD 0,50/millón publicado después. La cifra USD 0,80/millón que persiste en el [metadata del repo](https://github.com/Gigisanta/iStock-software/blob/main/config/firewall-rules.json) debe corregirse en la decisión de costo o quedar explícitamente descartada; la [fuente oficial actual específica](https://vercel.com/docs/vercel-firewall/vercel-waf/usage-and-pricing) pesa más. Ambas — consultadas 2026-09-01.
- WAF mitigado reduce el costo de CDN/Fast Data Transfer, pero no convierte en gratuitos los costos de Functions, Postgres, R2, Mercado Pago, proveedores LLM o allowed requests de rate limiting.
- Un setup Cloudflare Business/Enterprise para resolver el media domain puede agregar costo; el plan exacto necesario para `img.maat.work` con la zona autoritativa en Vercel está sin verificar. [Cloudflare partial setup](https://developers.cloudflare.com/dns/zone-setups/partial-setup/) — consultado 2026-09-01.

## Confianza

media — alta en Pro, cron, integración Git, límites de variables y requisito de nameservers para `*.maat.work`; media en el resultado global por la contradicción de pricing de Functions/WAF y por no haber probado todavía R2 `img.maat.work` con `maat.work` delegado a Vercel. La subiría un deployment Preview/Production real con el cron visible, un `vercel firewall diff`/publish contra la cuenta y una prueba DNS-R2; la bajaría cualquier cambio posterior en las páginas oficiales o una limitación específica del team/región.

## UNVERIFIED

- Si Vercel carga automáticamente el `vercel.json` ubicado en la raíz del repositorio cuando el proyecto tiene `Root Directory: apps/web`; confirmar viendo el Cron Job en Production. No se movió ni duplicó el archivo.
- Aplicación exacta del nuevo precio por invocación de Functions al crédito Pro y costos de CPU/memoria/transferencia del handler cron; las páginas oficiales actuales no son completamente consistentes.
- Tarifa efectiva de rate limiting por región/account y si el dashboard del team muestra exactamente USD 0,50 por millón; el [metadata del repo](https://github.com/Gigisanta/iStock-software/blob/main/config/firewall-rules.json) conserva USD 0,80 por millón y la [plantilla oficial](https://vercel.com/templates/vercel-firewall/rate-limit-api-requests-firewall-rule) muestra una disponibilidad de plan distinta. Fuentes consultadas 2026-09-01.
- Que `img.maat.work` siga funcionando como custom domain de R2 con `maat.work` autoritativo en Vercel DNS; requiere validar zona Cloudflare, CNAME setup parcial y/o un media domain separado. [Cloudflare R2 custom domains](https://developers.cloudflare.com/r2/buckets/public-buckets/) — consultado 2026-09-01.
- Estado vivo de las 4 reglas WAF: el [archivo de GitHub](https://github.com/Gigisanta/iStock-software/blob/main/config/firewall-rules.json) declara la intención, pero no prueba que estén publicadas en el proyecto Vercel — consultado 2026-09-01.
- Permisos concretos del usuario/equipo GitHub-Vercel y branch protection configurados en la cuenta.
- Build y deployment de producción: no verificado, requiere gate del LEAD; no se ejecutó `next build`.
