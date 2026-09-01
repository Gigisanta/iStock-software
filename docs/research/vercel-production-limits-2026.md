# vercel-production-limits-2026
_Consultado: 2026-08-31 · Agente: researcher_

## Pregunta

¿Qué límites y requisitos de Vercel Hobby y Pro afectan a iStock en producción: cron cada cinco
minutos, uso comercial/licencia, Firewall/rate limiting, dominios/DNS y despliegue desde GitHub?

## Respuesta corta

- **Elegir Pro antes de producción.** Hobby permite sólo uso personal/no comercial; Vercel define como
  comercial también anunciar la venta de un producto o servicio, que es exactamente la vidriera de
  iStock ([Terms of Service](https://vercel.com/legal/terms) — consultado 2026-08-31; [Fair Use
  Guidelines](https://vercel.com/docs/limits/fair-use-guidelines) — consultado 2026-08-31).
- **El `*/5 * * * *` del repo no despliega en Hobby.** Hobby acepta como máximo una ejecución diaria,
  con precisión horaria de ±59 minutos; Pro acepta un intervalo mínimo de un minuto y precisión por
  minuto ([Cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing) — consultado
  2026-08-31). El schedule existente equivale, por cálculo, a 12 ejecuciones por hora, 288 por día
  y 8.640 en un mes de 30 días: es válido en Pro, inválido en Hobby.
- **Hobby no alcanza para la política WAF del repo.** Rate limiting existe en ambos planes, pero el
  límite es 1 regla por proyecto en Hobby contra 40 en Pro; ambos usan ventana fija de 10 segundos a
  10 minutos y claves IP/JA4. El archivo público de configuración del repo declara 4 reglas de
  rate-limit ([Vercel WAF Rate Limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting)
  — consultado 2026-08-31; [config/firewall-rules.json](https://github.com/Gigisanta/iStock-software/blob/main/config/firewall-rules.json)
  — consultado 2026-08-31).
- **El wildcard es viable, pero requiere DNS operativo.** Vercel documenta wildcard domains y los
  limita por proyecto a 50 dominios en Hobby frente a ilimitados en Pro, con un soft cap Pro de
  100.000. Para `*.maat.work` hay que usar nameservers de Vercel; no alcanza un CNAME convencional
  para el wildcard ([Limits](https://vercel.com/docs/limits) — consultado 2026-08-31; [Working with
  Domains](https://vercel.com/docs/domains/working-with-domains) — consultado 2026-08-31).
- **GitHub funciona técnicamente en Hobby para este checkout público, pero no resuelve producción.**
  Vercel despliega pushes y PRs automáticamente en ambos planes; Hobby exige que el autor del commit
  sea el owner del equipo Hobby y no permite repositorios privados de una organización. Pro permite
  repos privados de organización cuando cada autor es miembro del equipo ([Deploying Git Repositories](https://vercel.com/docs/git)
  — consultado 2026-08-31; [iStock-software en GitHub](https://github.com/Gigisanta/iStock-software)
  — consultado 2026-08-31).

## Detalle

### Cron de expiración

El repositorio ya declara `GET /api/cron/expire-reservations` con `*/5 * * * *` en `vercel.json`
([vercel.json](https://github.com/Gigisanta/iStock-software/blob/main/vercel.json) — consultado
2026-08-31). Vercel admite hasta 100 cron jobs por proyecto en Hobby y Pro; la diferencia decisiva
es la frecuencia: Hobby sólo admite una ejecución por día y rechaza durante el deploy una expresión
que corra más seguido, mientras que Pro admite una ejecución mínima por minuto y la invoca dentro del
minuto solicitado ([Usage & Pricing for Cron Jobs](https://vercel.com/docs/cron-jobs/usage-and-pricing)
— consultado 2026-08-31; [Limits](https://vercel.com/docs/limits) — consultado 2026-08-31).

La expresión de cinco minutos produce 12 ejecuciones por hora, 288 por día y 8.640 en 30 días; son
cálculos derivados de la expresión del repo, no una cuota adicional de Vercel. Los cron jobs invocan
Vercel Functions y consumen su uso normal ([Cron Jobs](https://vercel.com/docs/cron-jobs) — consultado
2026-08-31). Sólo corren en deployments de Production, no en Preview; esto exige que la aceptación
del job se haga sobre producción o invocando el endpoint de manera controlada, no esperando actividad
en cada preview ([Troubleshooting Vercel Cron Jobs](https://vercel.com/kb/guide/troubleshooting-vercel-cron-jobs)
— consultado 2026-08-31).

Requisitos operativos que sí afectan al handler: Vercel recomienda `CRON_SECRET` de al menos 16
caracteres, lo envía automáticamente como `Authorization: Bearer <valor>`, y el endpoint debe
validarlo; además los cron jobs no siguen redirects ([Managing Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
— consultado 2026-08-31). El repo ya tiene `CRON_SECRET` y el path declarado, pero la publicación
efectiva en una cuenta Vercel no está verificada.

### Uso comercial, licencia y datos

Los Terms of Service vigentes, actualizados el 1 de junio de 2026, restringen Hobby a uso personal o
no comercial. La Fair Use Guideline vigente define comercial como un deployment usado para obtener
ganancia financiera de alguien involucrado en el proyecto, e incluye explícitamente cobrar a
visitantes y anunciar la venta de un producto o servicio ([Terms of Service](https://vercel.com/legal/terms)
— consultado 2026-08-31; [Fair Use Guidelines](https://vercel.com/docs/limits/fair-use-guidelines)
— consultado 2026-08-31).

Esto es una inferencia aplicada al repo: iStock se presenta como SaaS para revendedores, publica
catálogos de equipos y contempla planes pagos; por definición de Vercel, la vidriera es comercial
aunque todavía no tenga tráfico pago ([README del repo](https://github.com/Gigisanta/iStock-software/blob/main/README.md)
— consultado 2026-08-31). No es una cuestión de poner o no un archivo `LICENSE` en GitHub: es la
entitlement/licencia de uso del servicio Vercel. Pro es el primer plan que Vercel declara apto para
uso comercial.

El mismo ToS permite a Vercel deshabilitar o retirar un deployment Hobby con o sin aviso. También
distingue el tratamiento de contenido: en Hobby y en Pro trial el contenido puede usarse para
entrenamiento de modelos; en Pro pago el model training no está habilitado por defecto y requiere
opt-in ([Terms of Service](https://vercel.com/legal/terms) — consultado 2026-08-31). Para datos reales
del panel de iStock, el trial no debe confundirse con una postura de producción.

### Firewall y rate limiting

La tabla específica de rate limiting dice que está disponible en todos los planes, con estos límites:

| capacidad | Hobby | Pro |
|---|---:|---:|
| reglas de rate limiting por proyecto | 1 | 40 |
| algoritmo | fixed window | fixed window |
| ventana | 10 s–10 min | 10 s–10 min |
| claves incluidas | IP, JA4 Digest | IP, JA4 Digest |
| claves de User-Agent/header arbitrario | no | no; Enterprise |
| requests permitidos incluidos | 1.000.000 | 1.000.000 |

Fuente de toda la tabla: [Vercel WAF Rate Limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting)
— consultado 2026-08-31. La página de pricing también muestra hasta 3 custom firewall rules en
Hobby y hasta 40 en Pro; no hay que confundir ese límite general de custom rules con el límite más
estricto de una sola regla de rate limiting en Hobby ([Vercel Pricing](https://vercel.com/pricing)
— consultado 2026-08-31).

El repo declara 4 entradas de rate-limit: `storefront-track-rl`, `storefront-tradein-rl`,
`chatbot-rl` y `billing-subscribe-rl`. Por eso Hobby no puede representar la política completa;
Pro sí queda dentro del techo documentado ([config/firewall-rules.json](https://github.com/Gigisanta/iStock-software/blob/main/config/firewall-rules.json)
— consultado 2026-08-31).

Las reglas WAF se guardan, revisan y publican desde Firewall, y tienen efecto sin redeploy; una
declaración versionada dentro del repo no demuestra que la configuración viva de Vercel ya esté
publicada ([WAF Custom Rules](https://vercel.com/docs/vercel-firewall/vercel-waf/custom-rules)
— consultado 2026-08-31). El diseño del repo debe conservar el WAF en el borde y no crear un contador
de rate-limit en Postgres sobre la vidriera.

El primer 1.000.000 de allowed requests de rate limiting por mes está incluido; el changelog de
Vercel confirma esa inclusión también para Hobby y una regla gratuita de Hobby. Luego Vercel factura
rate limiting por región; el rango publicado es USD 0,50–0,80 por 1.000.000 de allowed requests,
y la región São Paulo (`gru1`) figura a USD 0,80 por 1.000.000 ([Rate limiting now available on Hobby](https://vercel.com/changelog/rate-limiting-now-available-on-hobby-with-higher-included-usage-on-pro)
— consultado 2026-08-31; [Regional Pricing](https://vercel.com/docs/pricing/regional-pricing)
— consultado 2026-08-31; [São Paulo pricing](https://vercel.com/docs/pricing/regional-pricing/gru1)
— consultado 2026-08-31). En Hobby no se compra overage: la cuenta queda limitada a sus caps;
Pro permite consumo on-demand después del crédito incluido ([Vercel Pricing](https://vercel.com/pricing)
— consultado 2026-08-31).

### Dominios y DNS

Hobby permite 50 custom domains por proyecto. Pro figura como ilimitado, con un soft cap operativo
de 100.000 dominios por proyecto que Vercel puede aumentar a pedido ([Limits](https://vercel.com/docs/limits)
— consultado 2026-08-31). Para el diseño actual, un solo wildcard `*.maat.work` no parece acercarse
a esa cuota; no afirmo aquí cómo cuenta Vercel cada subdominio wildcard individual (ver
`UNVERIFIED`).

Los wildcard domains deben verificarse usando el método de nameservers, porque Vercel necesita
resolver automáticamente el desafío DNS-01 para emitir y renovar el certificado. Los nameservers
documentados son `ns1.vercel-dns.com` y `ns2.vercel-dns.com`; para un apex normal Vercel puede pedir
un A record y para un subdominio normal un CNAME, pero eso no sustituye el requisito de nameservers
del wildcard ([Working with Domains](https://vercel.com/docs/domains/working-with-domains) — consultado
2026-08-31; [Working with Nameservers](https://vercel.com/docs/domains/working-with-nameservers) —
consultado 2026-08-31; [Troubleshooting Domains](https://vercel.com/docs/domains/troubleshooting) —
consultado 2026-08-31).

Cambiar los nameservers de `maat.work` mueve la autoridad DNS del apex a Vercel: antes de hacerlo hay
que inventariar y recrear en Vercel todos los registros que hoy sostienen correo, verificaciones y
otros servicios. La documentación de Vercel lo advierte expresamente ([Adding and Configuring a
Custom Domain](https://vercel.com/docs/domains/working-with-domains/add-a-domain) — consultado
2026-08-31). No encontré una exclusión de plan para wildcard en la documentación de dominios; el
motivo independiente para Pro en iStock es licencia/cron/WAF, no el wildcard.

### Despliegue desde GitHub

Vercel for GitHub soporta GitHub Free, Team y Enterprise Cloud, crea Preview deployments para pushes
y PRs, y crea el Production deployment al mergear o pushear la rama de producción ([Deploying GitHub
Projects with Vercel](https://vercel.com/docs/git/vercel-for-github) — consultado 2026-08-31; [Deploying
Git Repositories](https://vercel.com/docs/git) — consultado 2026-08-31). El repo actual es público y
vive bajo `Gigisanta/iStock-software`, por lo que la restricción de Hobby para repos privados de una
organización no lo bloquea hoy ([iStock-software](https://github.com/Gigisanta/iStock-software) —
consultado 2026-08-31).

Las reglas de autoría sí importan: en Hobby, el autor del commit debe ser el owner del equipo Hobby;
en Pro, el autor debe ser miembro del equipo Pro. Un repo privado dentro de una organización GitHub
no puede desplegar a Hobby; en Pro, cada autor debe estar correctamente vinculado a Vercel y ser
miembro del team ([Deploying Git Repositories](https://vercel.com/docs/git) — consultado 2026-08-31).

Como límites anti-abuso, la documentación de límites lista 10 proyectos Vercel conectados por Git
repository en Hobby contra 60 en Pro, y 100 deployments creados por día en Hobby contra 6.000 en
Pro ([Limits](https://vercel.com/docs/limits) — consultado 2026-08-31). Un solo proyecto para este
monorepo no se acerca a ninguno de esos límites.

### Contradicciones y criterio

- La página genérica de uso/precio del WAF contiene la frase “Enterprise only features are priced as
  described below”, mientras la página específica de Rate Limiting dice “available on all plans”,
  la matriz actual de pricing muestra inclusión para Hobby y el changelog documenta la regla gratuita
  de Hobby ([WAF usage and pricing](https://vercel.com/docs/vercel-firewall/vercel-waf/usage-and-pricing)
  — consultado 2026-08-31; [WAF Rate Limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting)
  — consultado 2026-08-31; [Vercel Pricing](https://vercel.com/pricing) — consultado 2026-08-31).
  Pesa más la página específica de rate limiting y la matriz de plan porque expresan directamente la
  capacidad Hobby/Pro; interpreto la frase genérica como referida a features Enterprise como managed
  rulesets.
- La matriz de pricing muestra “Unlimited Deployments”, pero la página de límites operativos lista
  100 por día en Hobby y 6.000 por día en Pro. Pesa más el documento de límites para un gate de
  despliegue porque define el límite operativo anti-abuso; “unlimited” se entiende como ausencia de
  un paquete fijo, no como ausencia de hard/soft limits ([Vercel Pricing](https://vercel.com/pricing)
  — consultado 2026-08-31; [Limits](https://vercel.com/docs/limits) — consultado 2026-08-31).
- Hay una contradicción menor en IP Blocking: el pricing actual muestra hasta 3 en Hobby, mientras
  la página Hobby muestra hasta 10. No uso ese dato para la decisión: el límite específico de rate
  limiting, 1 en Hobby y 40 en Pro, sí es consistente entre la documentación específica y la
  configuración necesaria ([Vercel Pricing](https://vercel.com/pricing) — consultado 2026-08-31;
  [Hobby Plan](https://vercel.com/docs/plans/hobby) — consultado 2026-08-31).

## Números que importan

| ítem | valor | unidad | fuente |
|---|---:|---|---|
| Precio de plataforma Pro | USD 20 | por mes | [Vercel Pricing](https://vercel.com/pricing) — consultado 2026-08-31 |
| Crédito incluido en Pro | USD 20 | por mes | [Pro Plan](https://vercel.com/docs/plans/pro-plan) — consultado 2026-08-31 |
| Cron Hobby | 1 | ejecución por día; precisión horaria ±59 min | [Cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing) — consultado 2026-08-31 |
| Cron Pro | 1 | minuto de intervalo mínimo; precisión por minuto | [Cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing) — consultado 2026-08-31 |
| Cron jobs | 100 | por proyecto, ambos planes | [Limits](https://vercel.com/docs/limits) — consultado 2026-08-31 |
| `*/5` del repo | 12 / 288 / 8.640 | ejecuciones por hora / día / 30 días, cálculo derivado | [vercel.json](https://github.com/Gigisanta/iStock-software/blob/main/vercel.json) y [Cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing) — consultados 2026-08-31 |
| `CRON_SECRET` recomendado | ≥16 | caracteres | [Managing Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs) — consultado 2026-08-31 |
| Reglas de rate limiting | 1 Hobby / 40 Pro | por proyecto | [WAF Rate Limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting) — consultado 2026-08-31 |
| Ventana WAF | 10–600 | segundos, ambos planes | [WAF Rate Limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting) — consultado 2026-08-31 |
| Allowed requests WAF incluidos | 1.000.000 | por mes | [Rate limiting on Hobby](https://vercel.com/changelog/rate-limiting-now-available-on-hobby-with-higher-included-usage-on-pro) — consultado 2026-08-31 |
| WAF rate limiting adicional | USD 0,50–0,80 | por 1.000.000 allowed requests, según región | [Regional Pricing](https://vercel.com/docs/pricing/regional-pricing) — consultado 2026-08-31 |
| WAF rate limiting en `gru1` | USD 0,80 | por 1.000.000 allowed requests | [São Paulo pricing](https://vercel.com/docs/pricing/regional-pricing/gru1) — consultado 2026-08-31 |
| Custom firewall rules | 3 Hobby / 40 Pro | por proyecto | [Vercel Pricing](https://vercel.com/pricing) — consultado 2026-08-31 |
| Custom domains | 50 Hobby / ilimitados Pro* | por proyecto | [Limits](https://vercel.com/docs/limits) — consultado 2026-08-31 |
| Soft cap de dominios Pro | 100.000 | por proyecto | [Limits](https://vercel.com/docs/limits) — consultado 2026-08-31 |
| Proyectos conectados por Git repository | 10 Hobby / 60 Pro | proyectos por repository | [Limits](https://vercel.com/docs/limits) — consultado 2026-08-31 |
| Deployments creados por día | 100 Hobby / 6.000 Pro | por día | [Limits](https://vercel.com/docs/limits) — consultado 2026-08-31 |
| Rate-limit entries declaradas por el repo | 4 | entradas en `config/firewall-rules.json` | [config/firewall-rules.json](https://github.com/Gigisanta/iStock-software/blob/main/config/firewall-rules.json) — consultado 2026-08-31 |

\* “Ilimitados” tiene soft cap documentado para Pro; la tabla no prueba que cada subdominio
resuelto por un wildcard sea contado como dominio separado.

## Fuentes

- [Vercel Terms of Service](https://vercel.com/legal/terms) — consultado 2026-08-31.
- [Vercel Fair Use Guidelines](https://vercel.com/docs/limits/fair-use-guidelines) — consultado 2026-08-31.
- [Vercel Pricing](https://vercel.com/pricing) — consultado 2026-08-31.
- [Vercel Pro Plan](https://vercel.com/docs/plans/pro-plan) — consultado 2026-08-31.
- [Usage & Pricing for Cron Jobs](https://vercel.com/docs/cron-jobs/usage-and-pricing) — consultado 2026-08-31.
- [Managing Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs) — consultado 2026-08-31.
- [Limits](https://vercel.com/docs/limits) — consultado 2026-08-31.
- [WAF Rate Limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting) — consultado 2026-08-31.
- [WAF Custom Rules](https://vercel.com/docs/vercel-firewall/vercel-waf/custom-rules) — consultado 2026-08-31.
- [Usage & Pricing for Vercel WAF](https://vercel.com/docs/vercel-firewall/vercel-waf/usage-and-pricing) — consultado 2026-08-31.
- [Regional Pricing](https://vercel.com/docs/pricing/regional-pricing) — consultado 2026-08-31.
- [São Paulo (`gru1`) pricing](https://vercel.com/docs/pricing/regional-pricing/gru1) — consultado 2026-08-31.
- [Deploying Git Repositories with Vercel](https://vercel.com/docs/git) — consultado 2026-08-31.
- [Deploying GitHub Projects with Vercel](https://vercel.com/docs/git/vercel-for-github) — consultado 2026-08-31.
- [Working with Domains](https://vercel.com/docs/domains/working-with-domains) — consultado 2026-08-31.
- [Working with Nameservers](https://vercel.com/docs/domains/working-with-nameservers) — consultado 2026-08-31.
- [Troubleshooting Domains](https://vercel.com/docs/domains/troubleshooting) — consultado 2026-08-31.
- [iStock-software en GitHub](https://github.com/Gigisanta/iStock-software) — consultado 2026-08-31.
- [vercel.json del repo](https://github.com/Gigisanta/iStock-software/blob/main/vercel.json) — consultado 2026-08-31.
- [config/firewall-rules.json del repo](https://github.com/Gigisanta/iStock-software/blob/main/config/firewall-rules.json) — consultado 2026-08-31.

## Impacto en iStock

- **ARCHITECTURE:** Vercel debe modelarse como Pro-only. Mantener el cron de producción cada cinco
  minutos, protegido por `CRON_SECRET`, con handler idempotente y sin depender de Preview. Mantener
  el rate limiting en el Firewall de Vercel, no en Postgres ni en el render cacheado de la vidriera;
  las claves IP/JA4 y fixed window son compatibles con el plan Pro. El wildcard `*.maat.work` exige
  que la arquitectura operativa incluya Vercel DNS y renovación automática del certificado.
- **DECISIONS:** conservar Pro como decisión de release, no como optimización opcional. Tratar
  `config/firewall-rules.json` como desired state que todavía necesita publicación/verificación contra
  la configuración viva de Vercel. Antes de migrar nameservers, preservar MX/TXT/CAA y demás DNS de
  `maat.work`. En GitHub, mantener el repo público permite el camino técnico de Hobby, pero cualquier
  colaborador adicional o cambio a repo privado de organización requiere Pro y membresía del team.
- **COST:** piso de USD 20/mes de plataforma Pro, con USD 20/mes de crédito incluido; el WAF tiene
  1.000.000 allowed requests mensuales incluidos y el excedente es regional, hasta USD 0,80 por
  1.000.000 en `gru1`. El cron no tiene cargo de producto separado: sus invocaciones consumen Functions.
  Configurar Spend Management y no poner rate limit sobre cada pageview de la vidriera; limitar sólo
  endpoints que escriben o disparan costo externo.

## Confianza

alta — La decisión central se apoya en ToS/Fair Use vigentes, documentación específica de Cron y WAF,
matriz de pricing y límites operativos, además del estado observable del repositorio. La confianza
bajaría si Vercel cambia los ToS, la tabla específica de rate limiting o la política de cron; también
requiere verificación de cuenta para confirmar región de facturación, publicación real del Firewall,
DNS y deployment de producción.

## UNVERIFIED

- El plan, proyecto, región efectiva de ejecución y configuración de spend management de la cuenta
  Vercel de iStock.
- Que `config/firewall-rules.json` ya esté publicado en el Firewall vivo; el archivo del repo sólo es
  desired state.
- Que el deployment de producción actual registre el cron y que `CRON_SECRET` esté cargado en el
  environment Production.
- Si cada `{slug}.maat.work` resuelto por `*.maat.work` consume una unidad del límite de dominios por
  proyecto o si Vercel cuenta sólo el wildcard.
- La cuota exacta de IP Blocking en Hobby: la matriz de pricing actual muestra 3, mientras la página
  Hobby muestra 10; no se usa ese dato para la decisión.
- Si `maat.work` puede migrarse hoy sin pérdida de registros DNS, correo o verificaciones; requiere
  inspección de la zona DNS real.
