export const meta = {
  name: 'istock-build',
  description: 'Pipeline maestro de iStock: research verificado -> domain/schema -> skeleton -> slices, con voto adversarial y gate de costo en cada ola.',
  whenToUse: 'Correr una FASE del pipeline de iStock. args: { phase: "research"|"domain"|"skeleton"|"slice", slice?: "S2" }',
  phases: [
    { title: 'Research', detail: '7 topics en paralelo, cada uno con fuentes de hoy' },
    { title: 'Verify', detail: 'adversario vota cada research: cifra sin fuente = FAIL' },
    { title: 'Domain', detail: 'packages/domain puro, luego schema + RLS, luego tests cruzados' },
    { title: 'Skeleton', detail: 'auth, tenant, middleware de host, layout de panel, probe R2' },
    { title: 'Slice', detail: 'test -> impl -> adversary -> costo, para una slice del board' },
  ],
}

// ---------------------------------------------------------------------------
// Contexto compartido: todo agente arranca leyendo la constitucion.
// ---------------------------------------------------------------------------
const LAW = `
Repo: /Users/gigi/HerMaatOS/work/istock
ANTES DE ESCRIBIR NADA, lee estos archivos con Bash (cat):
  - CLAUDE.md   (constitucion: reglas duras, stack CERRADO, ownership de archivos)
  - AGENTS.md   (tu contrato de oficio y el formato de retorno)
Reglas que te aplican siempre:
  - Escribis SOLO en el path que se te asigna. Un writer por directorio.
  - El stack esta cerrado. Proponer otro stack = fallo de la tarea.
  - tenant_id + RLS en toda tabla de negocio. IMEI/costo nunca en vidriera, logs ni chatbot.
  - Nunca afirmes un dato que no verificaste: marcalo UNVERIFIED.
  - Terminas devolviendo el bloque FILES / ACCEPTANCE / COST_DELTA / UNVERIFIED / BLOCKERS.
`.trim()

// El registry de subagentes se congela al inicio de la sesion, asi que los oficios de
// .claude/agents/*.md se cargan por instruccion. El contrato sigue siendo el mismo archivo.
const role = (name) => `TU OFICIO: "${name}".
Leé tu contrato completo AHORA: cat .claude/agents/${name}.md
Actuás exactamente como ese agente: sus reglas, su limite de directorio y su formato de salida.
No hagas nada que ese archivo no te habilite.`

const RESEARCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['topic', 'file', 'bytes', 'shortAnswer', 'keyNumbers', 'sources', 'impact', 'confidence', 'unverified'],
  properties: {
    topic: { type: 'string' },
    file: { type: 'string', description: 'path relativo del .md que escribiste' },
    bytes: { type: 'integer', description: 'tamano real del archivo, medido con wc -c' },
    shortAnswer: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 8 },
    keyNumbers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['item', 'value', 'source'],
        properties: { item: { type: 'string' }, value: { type: 'string' }, source: { type: 'string' } },
      },
    },
    sources: { type: 'array', items: { type: 'string' }, minItems: 1 },
    impact: { type: 'string', description: 'que cambia en ARCHITECTURE / DECISIONS / COST' },
    confidence: { type: 'string', enum: ['alta', 'media', 'baja'] },
    unverified: { type: 'array', items: { type: 'string' } },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['topic', 'verdict', 'findings', 'unsourcedClaims'],
  properties: {
    topic: { type: 'string' },
    verdict: { type: 'string', enum: ['PASS', 'FAIL'] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'claim', 'why'],
        properties: {
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          claim: { type: 'string' },
          why: { type: 'string' },
        },
      },
    },
    unsourcedClaims: { type: 'array', items: { type: 'string' } },
  },
}

const WORK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['files', 'acceptance', 'costDelta', 'unverified', 'blockers'],
  properties: {
    files: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'bytes'],
        properties: { path: { type: 'string' }, bytes: { type: 'integer' } },
      },
    },
    acceptance: { type: 'string' },
    costDelta: { type: 'string' },
    unverified: { type: 'array', items: { type: 'string' } },
    blockers: { type: 'array', items: { type: 'string' } },
  },
}

// ---------------------------------------------------------------------------
// FASE 1 - topics. Uno por agente, un archivo por agente. Sin solapamiento.
// ---------------------------------------------------------------------------
const TOPICS = [
  {
    id: 'R1',
    slug: 'wildcard-isr',
    title: 'Wildcard de subdominios + ISR en Next.js App Router sobre Vercel (vigente 2026)',
    ask: `Como se sirve HOY un SaaS multi-tenant con subdominio por tenant ({slug}.maat.work) en Next.js App Router sobre Vercel.
Responde con precision, con fuente y fecha, a:
1. Configuracion de wildcard domain en Vercel: que plan hace falta, como se verifica el DNS, y si el certificado wildcard es automatico o requiere pasos manuales.
2. Como resolver host -> tenant en middleware sin pegarle a la base de datos en cada request. Que opciones de cache existen en el runtime de middleware y cuales son sus limites reales (tamano, TTL, si sobrevive entre invocaciones).
3. Estado VIGENTE de ISR y cache tags en App Router: nombres exactos de las APIs de revalidacion hoy, si cambiaron de nombre o semantica en las versiones recientes, y como interactuan con el cache del CDN de Vercel.
4. Si una pagina cacheada por tag se puede invalidar por tenant sin invalidar las de otros tenants, y cual es la granularidad real.
5. Como se prueba wildcard en local (nip.io u otro) y que rompe respecto de produccion.
6. Trampas conocidas: cache compartido entre hosts, middleware que corre o no corre sobre respuestas cacheadas, y limites de dominios por proyecto en Vercel.
IMPORTANTE: las APIs de cache de Next cambiaron varias veces. Verifica cual es la forma vigente y decilo con version explicita. Si hay mas de una forma soportada, deci cual conviene y por que.`,
  },
  {
    id: 'R2',
    slug: 'r2-images',
    title: 'Cloudflare R2 + transformaciones de imagen vs Cloudflare Images: pricing real',
    ask: `Decidir como servimos fotos de productos con egress cero y costo predecible.
Responde con precios oficiales y fecha de consulta:
1. Pricing VIGENTE de Cloudflare R2: storage por GB-mes, Class A ops, Class B ops, y confirmacion explicita de que el egress es 0. Incluir el free tier si existe.
2. Cloudflare Image Resizing / transformaciones sobre origen R2: como se factura hoy (por request? por imagen unica?), cual es el free tier, y si requiere algun plan pago del dominio.
3. Cloudflare Images (el producto de storage+delivery): pricing por imagen almacenada y por entrega. Comparar contra R2 + resize propio.
4. Comparacion concreta para nuestro caso: 100 tenants x 60 listings x 4 fotos x 3 variantes, con 3000 pageviews/mes por tenant y ~15 imagenes card por sesion. Da el numero en USD/mes de cada opcion.
5. Recomendacion: resize server-side con sharp en el upload (3 variantes fijas guardadas) VS transformaciones on-the-fly. Cual sale mas barato a nuestra escala y cual escala peor.
6. Como se sirve R2 por CDN publico: dominio custom, r2.dev, y que Cache-Control conviene para objetos con hash inmutable.
Nuestro constraint: egress 0 es el motivo de elegir R2. Cualquier opcion que reintroduzca egress pago se descarta.`,
  },
  {
    id: 'R3',
    slug: 'llm-pricing',
    title: 'Gemini Flash-Lite y Groq: IDs exactos de modelo y USD por millon de tokens',
    ask: `Necesitamos el modelo mas barato que sirva para un chatbot de vidriera con dieta de 1200 tokens in / 180 out.
Responde con la pagina de pricing oficial y fecha:
1. Google Gemini: cual es HOY el modelo Flash-Lite mas barato disponible en la API. ID EXACTO del modelo (el string que se pasa a la API), precio input y output en USD por millon de tokens, y si tiene free tier con limites concretos (RPM, TPM, RPD).
2. Si existe un modelo mas nuevo y mas barato que 2.5 Flash-Lite, decilo con su ID y precio.
3. Groq: IDs exactos vigentes de llama-3.1-8b-instant y gpt-oss-20b (o sus reemplazos si fueron deprecados). Precio por millon de tokens y limites del free tier / dev tier.
4. Calculo directo para nuestro caso: 60.000 mensajes/mes con 1200 tokens in y 180 out. Da el USD/mes de cada opcion.
5. Latencia tipica reportada de cada uno (importa: es un chat en vivo en una vidriera).
6. Compatibilidad con Vercel AI SDK: que provider package se usa para cada uno y si hay algo que no funcione (tool calling, streaming).
7. Politica de retencion de datos de cada provider en el tier que usariamos: nos importa no filtrar datos de clientes.
NO recomiendes Claude ni GPT: estan prohibidos en el hot path. Verifica los IDs de modelo, no los recuerdes de memoria: cambian seguido y un ID viejo rompe en produccion.`,
  },
  {
    id: 'R4',
    slug: 'mp-subscriptions',
    title: 'Mercado Pago Subscriptions (preapproval) en Argentina: API vigente',
    ask: `Vamos a cobrar una suscripcion SaaS mensual en Argentina a resellers de celulares.
Responde con documentacion oficial de Mercado Pago y fecha:
1. Cual es el producto vigente para suscripciones recurrentes en MP Argentina (preapproval / suscripciones / planes). Nombre exacto y endpoints principales.
2. Diferencia entre suscripcion con plan asociado y sin plan. Cual conviene para 2 planes fijos (base ~USD 19, negocio ~USD 35) cobrados en ARS.
3. Medios de pago que soporta la suscripcion recurrente: tarjeta, debito automatico en cuenta, dinero en cuenta. IMPORTANTE: nuestro ICP prefiere debito/transferencia sobre tarjeta de credito. Deci que se puede hacer realmente.
4. Como se implementa el trial de 14 dias: hay soporte nativo (free trial) o hay que simularlo con fecha de inicio diferida.
5. Webhooks/IPN: formato del evento, como se VERIFICA LA FIRMA (header exacto y algoritmo), y como se garantiza idempotencia. Que reintentos hace MP y con que backoff.
6. Estados posibles de una suscripcion y que evento llega en cada transicion (autorizada, pausada, cancelada, pago rechazado).
7. Comisiones de MP por transaccion de suscripcion en Argentina.
8. Requisitos de cuenta: hace falta cuenta de vendedor, credenciales de produccion, algun tipo de aprobacion previa.
Stripe esta prohibido, no lo menciones como alternativa.`,
  },
  {
    id: 'R5',
    slug: 'enacom-imei',
    title: 'ENACOM: consulta de IMEI en Argentina, URL y flujo real',
    ask: `Necesitamos que el panel guarde el resultado de la consulta de IMEI que hace el dueno, y linkear al sitio oficial.
Responde con fuentes oficiales (enacom.gob.ar / argentina.gob.ar) y fecha:
1. URL EXACTA y vigente del consultor publico de IMEI de ENACOM. Verificala: no des una URL que ya no existe.
2. Que resultados devuelve la consulta (los estados posibles textuales) y que significa cada uno. Esto define nuestro enum.
3. Existe alguna API publica o solo consulta web manual. Si hay endpoint, decilo; si no, decilo explicitamente.
4. Que canales oficiales existen para denunciar o consultar un equipo con pedido de secuestro.
5. Marco normativo relevante hoy para comercializacion de celulares usados en Argentina: que obligaciones REALES tiene un reseller respecto del IMEI y el origen.
6. Ley/resolucion CABA 295/26 (o su identificador correcto si esta mal citado): que exige, a quien aplica, desde cuando. Verifica que exista; si no encontras nada, decilo claramente en vez de inventar.
7. Riesgo legal de guardar IMEIs de terceros: que precauciones de datos personales aplican bajo la ley argentina de proteccion de datos.
NO somos un registro oficial y no vamos a integrarnos con ENACOM: solo guardamos lo que el dueno consulto. El objetivo es no afirmar nada falso en el producto.`,
  },
  {
    id: 'R6',
    slug: 'apple-catalog-ar',
    title: 'Catalogo Apple que se vende hoy en el mercado argentino de reventa',
    ask: `Necesitamos poblar catalog_models con lo que un reseller del Alto Valle realmente vende HOY.
Responde con fuentes (marketplaces argentinos, listas de precios de mayoristas, MercadoLibre AR) y fecha:
1. Lineas de iPhone que circulan hoy en la reventa argentina, desde las mas viejas que todavia se venden hasta las actuales. Para CADA linea: capacidades (GB) que EXISTIERON de fabrica y colores, con el nombre en espanol como lo usa el mercado argentino (ej "Grafito", no "Graphite").
2. Cuales son las 10 lineas mas vendidas en reventa en Argentina hoy. Esto define el orden del autocomplete.
3. iPad, Apple Watch y Mac: que modelos aparecen con frecuencia en el stock de un reseller de celulares (probablemente pocos). No hace falta exhaustividad, si volumen real.
4. Accesorios que estos resellers venden como lote: cual es el mix tipico.
5. Vocabulario de condicion del mercado argentino: que significan exactamente "sellado", "open box", "tester A+", "usado excelente", "usado con detalle" en la practica. Si el mercado usa otros terminos frecuentes, decilos.
6. Que datos mira un comprador argentino de usado antes de escribir por WhatsApp: bateria %, pantalla original, iCloud, procedencia (nacional/importado), garantia. Confirma o corregi esta lista con evidencia de como se publican los avisos reales.
NO inventes capacidades que no existieron (ej un iPhone 14 Pro de 64GB). Si no podes verificar una linea, marcala UNVERIFIED.`,
  },
  {
    id: 'R7',
    slug: 'threats',
    title: 'Amenazas de un SaaS multi-tenant con vidriera publica: IDOR, scraping, prompt injection',
    ask: `Modelo de amenazas para iStock. Responde con fuentes (OWASP, Supabase docs, papers/reportes recientes) y fecha:
1. Supabase RLS en 2026: cual es el patron recomendado HOY para multi-tenant. Custom claim de tenant_id en el JWT vs tabla memberships consultada con auth.uid(). Ventajas, desventajas, y el impacto en performance de cada uno (la funcion de la policy corre por fila).
2. Errores clasicos de RLS que producen fuga entre tenants: policies sin WITH CHECK, uso de service_role key en el servidor sin filtro de tenant, funciones SECURITY DEFINER, vistas que evaden RLS. Da la lista con el sintoma de cada uno.
3. IDOR en Next.js App Router: como se filtra data por server actions y RSC props sin querer. Que se serializa realmente al cliente y como auditarlo.
4. Scraping de una vidriera publica: es un problema real para este negocio (competidor copiando precios) y que mitigaciones tienen sentido sin romper SEO ni el cache. Se explicito sobre el trade-off: cachear agresivo y bloquear bots son objetivos en tension.
5. Prompt injection donde el texto lo escribe el DUENO del tenant (no un atacante externo): que puede lograr un dueno malicioso contra su propio chatbot y contra otros tenants. Tecnicas de mitigacion vigentes (delimitadores, sanitizacion, separacion de instrucciones y datos, output filtering).
6. Fuga de PII en payloads de Next: __NEXT_DATA__, RSC flight data, props de server components. Como se audita automaticamente en CI.
7. Rate limiting sin infra extra en Vercel: que opciones hay que no requieran Redis pago.
Nuestro caso concreto: IMEI y costo NUNCA pueden salir a la vidriera ni al chatbot, y tenant A nunca puede leer datos de B.`,
  },
]

// ---------------------------------------------------------------------------
// FASE 1 - research en paralelo, cada uno verificado en cuanto termina.
// ---------------------------------------------------------------------------
async function runResearch() {
  log(`FASE 1 - research: ${TOPICS.length} topics en paralelo, cada uno con voto adversarial.`)

  const results = await pipeline(
    TOPICS,

    // Stage 1: investigar y escribir el archivo.
    (t) =>
      agent(
        `${LAW}

${role('researcher')}

Sos el agente "researcher" del topic ${t.id}.

TOPIC: ${t.title}

${t.ask}

TU UNICO ARCHIVO DE SALIDA: docs/research/${t.slug}.md
No escribas en ningun otro path. Ningun otro agente toca ese archivo.

METODO OBLIGATORIO:
1. Cargá las tools de web: ToolSearch("select:WebSearch,WebFetch").
2. Buscá AHORA. Tu conocimiento base esta desactualizado para precios, IDs de modelo y URLs.
   Hoy es 2026-08-27. Un dato de 2024 sobre pricing de 2026 no sirve.
3. Preferí fuente primaria (docs oficiales, pricing oficial, changelog) sobre blogs.
4. Si dos fuentes se contradicen, decilo y explicá cual pesa mas.
5. Toda cifra lleva URL + fecha de consulta. Sin URL -> va en la seccion UNVERIFIED.
6. Escribí el archivo con Write o con un heredoc de Bash, y despues medilo: wc -c docs/research/${t.slug}.md
7. Cero codigo de app. Snippets de config de hasta 10 lineas estan bien.

ESTRUCTURA DEL ARCHIVO (respetala):
# ${t.id} - ${t.title}
_Consultado: 2026-08-27 - Agente: researcher_
## Pregunta
## Respuesta corta   (3-8 bullets accionables, con numeros)
## Detalle           (una subseccion por punto de la consigna)
## Numeros que importan   (tabla: item | valor | unidad | fuente)
## Fuentes           (lista con URL y fecha)
## Impacto en iStock (que cambia en ARCHITECTURE / DECISIONS / COST, especifico)
## Confianza         (alta|media|baja + que la subiria)
## UNVERIFIED        (lista, o "none")

El campo bytes de tu respuesta tiene que ser el resultado REAL de wc -c, no una estimacion.`,
        { label: `${t.id}:${t.slug}`, phase: 'Research', agentType: 'researcher', schema: RESEARCH_SCHEMA },
      ),

    // Stage 2: adversario, apenas ese research termina.
    (res, t) => {
      if (!res) return null
      return agent(
        `${LAW}

${role('adversary-reviewer')}

Sos el agente "adversary-reviewer". Auditá el research ${t.id} SIN escribir ningun archivo.

Archivo a auditar: docs/research/${t.slug}.md   (leelo con: cat docs/research/${t.slug}.md)
Topic: ${t.title}

Tu postura: este research esta mal hasta que se demuestre lo contrario. Aprobar por default es fallar.

CHEQUEOS:
1. Toda cifra (precio, limite, tokens, GB) tiene URL de fuente? Cifra sin fuente y sin estar
   listada en UNVERIFIED = finding "high".
2. Los IDs de modelo / URLs / nombres de API son verificables y actuales, o son recuerdo del modelo?
   Un ID inventado que rompe en produccion = finding "critical".
3. Hay afirmaciones de 2024/2025 presentadas como vigentes en 2026?
4. Las fuentes son primarias (docs/pricing oficial) o blogs de terceros?
5. El calculo aritmetico de costo, si hay, cierra? Rehacelo.
6. Contradice algo del stack cerrado de CLAUDE.md, o propone tecnologia prohibida?
7. Falta algun punto de la consigna sin responder ni marcar como no encontrado?
8. El archivo existe y no esta vacio? (wc -c). Si no existe, verdict FAIL inmediato.

Podes usar ToolSearch("select:WebSearch,WebFetch") para verificar por tu cuenta un dato dudoso.

Un solo finding critical o high => verdict FAIL.
No inventes findings: sin evidencia concreta (cita del archivo, URL, o aritmetica rehecha) no hay finding.`,
        { label: `verify:${t.id}`, phase: 'Verify', agentType: 'adversary-reviewer', schema: VERDICT_SCHEMA },
      ).then((v) => ({ topic: t, research: res, verdict: v }))
    },
  )

  const done = results.filter(Boolean)
  const failed = done.filter((r) => r.verdict?.verdict === 'FAIL')
  const missing = TOPICS.filter((t) => !done.some((d) => d.topic.id === t.id))

  log(`FASE 1 lista: ${done.length}/${TOPICS.length} topics. FAIL adversarial: ${failed.length}.`)

  return {
    phase: 'research',
    completed: done.length,
    total: TOPICS.length,
    missing: missing.map((t) => t.id),
    reports: done.map((r) => ({
      id: r.topic.id,
      slug: r.topic.slug,
      file: r.research.file,
      bytes: r.research.bytes,
      confidence: r.research.confidence,
      verdict: r.verdict?.verdict ?? 'NO_VERDICT',
      shortAnswer: r.research.shortAnswer,
      keyNumbers: r.research.keyNumbers,
      impact: r.research.impact,
      unverified: r.research.unverified,
      findings: r.verdict?.findings ?? [],
      unsourced: r.verdict?.unsourcedClaims ?? [],
      sources: r.research.sources,
    })),
    leadTodo: [
      'Correr phantom-file guard sobre cada docs/research/*.md',
      'Sintetizar ARCHITECTURE.md + DECISIONS.md (ADR-005..009) + COST.md con cifras reales',
      'Reemplazar todo [EST] de COST.md por numeros con fuente',
    ],
  }
}

// ---------------------------------------------------------------------------
// FASE 2 - domain y schema. SERIAL por diseno: el schema depende del dominio,
// y los tests de RLS dependen del schema. Paralelizar aca crea dos writers.
// ---------------------------------------------------------------------------
async function runDomain() {
  log('FASE 2 - domain + schema (serial, un writer por vez).')

  const domain = await agent(
    `${LAW}

${role('domain-agent')}

Sos "domain-agent". Unico writer de packages/domain. NO toques ningun otro directorio.

Lee primero: docs/DOMAIN.md (maquina de estados, FX, publicListingDTO) y .claude/skills/wa-payload/SKILL.md

Implementa packages/domain como TypeScript PURO (cero imports de next, drizzle, supabase, fetch,
process.env; el tiempo y el tipo de cambio entran por parametro):
  - applyFx(usdCents, rate)        regla de redondeo explicita y testeada
  - canTransition(from, to, ctx)   exhaustiva; transicion no listada => false
  - expireReservation(res, now)    puro, now inyectado
  - buildWaMessage(listing, slug)  string canonico de CLAUDE.md, URL-encoded
  - publicListingDTO(listing)      ALLOWLIST explicita de campos
  - sanitizeDescription(text)      anti prompt-injection

Cada export publico con test de Vitest. Tests obligatorios: el DTO no filtra imei/cost_usd/
internal_notes ni anidados, y un campo NUEVO agregado al modelo NO aparece en el DTO.
Plata en enteros de centavos, nunca float.

Setea tambien el package.json del paquete y su tsconfig strict.
Acceptance que tenes que dejar funcionando: pnpm --filter @istock/domain typecheck && pnpm --filter @istock/domain test`,
    { label: 'domain:packages/domain', phase: 'Domain', agentType: 'domain-agent', schema: WORK_SCHEMA },
  )

  const db = await agent(
    `${LAW}

${role('db-agent')}

Sos "db-agent". Unico writer de packages/db. NO toques ningun otro directorio.

Lee primero: docs/DOMAIN.md, docs/SLICE_BOARD.md (FASE 2) y .claude/skills/drizzle-rls/SKILL.md
Lee tambien docs/DECISIONS.md: la ADR sobre la forma del claim de tenant define como escribis las policies.
Contexto de lo que ya existe en packages/domain: ${JSON.stringify(domain?.files ?? [])}

Entidades: tenants, users, memberships(owner|seller), locations, catalog_models, catalog_faqs,
listings (kind unit|lot), listing_photos (keys de R2 + variantes), listing_events, fx_settings,
tradein_leads, tradein_checklists, wa_click_events, sales, reservations, subscriptions/entitlements,
chatbot_threads, chatbot_messages.

Por cada tabla de negocio, los 6 pasos de la skill drizzle-rls. Sin excepcion.
catalog_models y catalog_faqs son GLOBALES (sin tenant_id): documentalo explicitamente en el schema
y en tu reporte, porque son la unica excepcion permitida.
Marca con comentario SQL "-- SENSITIVE: never in public DTO" las columnas imei, cost_usd,
internal_notes, supplier, margin.
Migraciones versionadas y commiteadas. Seed demo determinista: 8 iPhones + 2 accesorios + 1 reserved.

En tu reporte deci cuantas tablas creaste y cuantas tienen RLS. Si esos numeros no coinciden,
tu entrega es FAIL y lo decis vos mismo.`,
    { label: 'db:packages/db', phase: 'Domain', agentType: 'db-agent', schema: WORK_SCHEMA },
  )

  const rlsTests = await agent(
    `${LAW}

${role('qa-agent')}

Sos "qa-agent". Unico writer de tests. NO arregles el codigo bajo test: si algo falla, lo reportas.

Escribi el test de RLS cruzado contra Postgres REAL (nada de mocks), con dos sesiones con distinto
claim de tenant. Aserciones minimas:
  R1 tenant B hace select de una fila de A -> 0 filas
  R2 tenant B hace insert con tenant_id de A -> error
  R3 tenant B hace update de una fila de A -> 0 filas afectadas
  R4 tenant B hace delete de una fila de A -> 0 filas afectadas
  R5 toda tabla de negocio tiene relrowsecurity = true (query a pg_class)
  R6 ninguna policy contiene using (true) (query a pg_policies)

Schema entregado por db-agent: ${JSON.stringify(db?.files ?? [])}

Si no hay credenciales de Supabase/Postgres disponibles, NO simules el test: dejalo escrito,
marcalo skip con motivo explicito, y reportalo en blockers. Un test verde falso es peor que ninguno.`,
    { label: 'qa:rls', phase: 'Domain', agentType: 'qa-agent', schema: WORK_SCHEMA },
  )

  return { phase: 'domain', domain, db, rlsTests }
}

// ---------------------------------------------------------------------------
// FASE 3 - skeleton. Paralelo SOLO donde los directorios no se pisan.
// ---------------------------------------------------------------------------
async function runSkeleton() {
  log('FASE 3 - skeleton: 3 writers en directorios disjuntos.')

  const [panel, storefront, media] = await parallel([
    () =>
      agent(
        `${LAW}

${role('app-agent')}

Sos "app-agent". Escribis SOLO en apps/web/app/(marketing), apps/web/app/(app) y apps/web/app/api.
NO toques middleware.ts ni apps/web/app/(storefront): son de storefront-agent.

Entrega:
  - marketing honesta en / : que hace iStock, para quien, precio. Cero promesa que el producto no cumple.
  - auth con Supabase + creacion de tenant con slug (validado con Zod: url-safe, unico, reservados bloqueados)
  - layout del panel /app mobile-first (se usa parado en un local, con una mano)
RSC por default. Zod en todo borde. Copy en espanol rioplatense, codigo en ingles.
Cero features de slices S1-S13 todavia: esto es esqueleto navegable, no producto.`,
        { label: 'skeleton:panel', phase: 'Skeleton', agentType: 'app-agent', schema: WORK_SCHEMA },
      ),
    () =>
      agent(
        `${LAW}

${role('storefront-agent')}

Sos "storefront-agent". Escribis SOLO en apps/web/app/(storefront) y middleware.ts.
NO toques el panel ni las API del panel.

Lee docs/research/wildcard-isr.md antes de escribir una linea: define el mecanismo vigente.

Entrega el middleware de resolucion de host:
  maat.work / www        -> marketing
  {slug}.maat.work       -> storefront del tenant
  localhost / nip.io     -> dev
Sin consultar Postgres por request: cache de slug -> tenantId.
Slug inexistente -> 404 real, no redirect al home.
Mas una pagina placeholder de storefront que muestre el tenant resuelto. Nada de producto todavia.`,
        { label: 'skeleton:storefront', phase: 'Skeleton', agentType: 'storefront-agent', schema: WORK_SCHEMA },
      ),
    () =>
      agent(
        `${LAW}

${role('media-agent')}

Sos "media-agent". Escribis SOLO en packages/media.

Lee docs/research/r2-images.md antes de decidir el pipeline: define resize propio vs transform.
Lee .claude/skills/r2-media/SKILL.md.

Entrega el probe de R2: cliente, upload server-side, resize con sharp a thumb/card/detail,
keys deterministas t/{tenantId}/l/{listingId}/{variant}/{hash}.webp, y la API publica
uploadListingPhoto / variantUrl / deleteListingPhotos.
Test con imagen de referencia que FALLA si una variante supera su techo de bytes.
Si faltan credenciales de R2, dejalo funcionando contra un doble local del storage y reportalo
en blockers. El pipeline de resize se puede testear sin credenciales: hacelo.`,
        { label: 'skeleton:media', phase: 'Skeleton', agentType: 'media-agent', schema: WORK_SCHEMA },
      ),
  ])

  return { phase: 'skeleton', panel, storefront, media }
}

// ---------------------------------------------------------------------------
// FASE 4 - una slice: test -> impl -> adversary -> costo.
// ---------------------------------------------------------------------------
async function runSlice(sliceId) {
  if (!sliceId) throw new Error('runSlice necesita args.slice, ej "S2"')
  log(`FASE 4 - slice ${sliceId}: test primero, un writer, adversary y costo como gate.`)

  const spec = `Slice ${sliceId} de docs/SLICE_BOARD.md. Leé la fila de la slice y su gate de aceptación.`

  const test = await agent(
    `${LAW}

${role('qa-agent')}

Sos "qa-agent". ${spec}
Escribi el test ANTES de la implementacion y CORRELO para mostrar que falla.
Un test que nunca fallo no prueba nada. Reporta la salida real del test fallando.
Prohibido expect(true).toBe(true) y tests que pasan con la implementacion vacia.`,
    { label: `slice:${sliceId}:test`, phase: 'Slice', agentType: 'qa-agent', schema: WORK_SCHEMA },
  )

  const impl = await agent(
    `${LAW}

Tu oficio depende del directorio de la slice: mirá la tabla de ownership de CLAUDE.md seccion 4,
identificá cual de los agentes de .claude/agents/ sos, y leé ese archivo con cat antes de escribir.

${spec}
Sos el agente owner del directorio de esta slice segun la tabla de ownership de CLAUDE.md seccion 4.
Identificá cual sos leyendo el board y la tabla, y escribí SOLO en tu directorio.
Si la slice cruza dos directorios, hacé la parte que te corresponde y reporta la otra como pendiente:
NO escribas fuera de tu columna.

Tests que tenes que hacer pasar (ya escritos, no los modifiques): ${JSON.stringify(test?.files ?? [])}

Al terminar corré: pnpm typecheck && pnpm lint && pnpm test
y reporta la salida real, no lo que esperabas que pasara.`,
    { label: `slice:${sliceId}:impl`, phase: 'Slice', schema: WORK_SCHEMA },
  )

  const [adversary, cost] = await parallel([
    () =>
      agent(
        `${LAW}

${role('adversary-reviewer')}

Sos "adversary-reviewer". NO escribis archivos. Auditá la slice ${sliceId}.
Mirá el diff: git --no-pager diff HEAD
Checklist completo de .claude/agents/adversary-reviewer.md: tenant leak, IDOR, PII en payload
(imei/cost_usd/internal_notes en HTML, __NEXT_DATA__, props de RSC, respuestas de API),
RLS ausente o permisiva, input sin Zod, secretos en el cliente, prompt injection, estado
inconsistente, costo escondido, cache leak entre tenants.
Un critical o high => FAIL. Sin evidencia concreta no hay finding.`,
        { label: `slice:${sliceId}:adversary`, phase: 'Slice', agentType: 'adversary-reviewer', schema: VERDICT_SCHEMA },
      ),
    () =>
      agent(
        `${LAW}

${role('cost-auditor')}

Sos "cost-auditor". Auditá la slice ${sliceId} contra el objetivo de < USD 0.50/mes por tenant activo.
Mirá el diff: git --no-pager diff HEAD
Pregunta unica: esto agrega costo tonto?
Fallos automaticos: fotos por Supabase Storage o Vercel Image Optimization, original >500KB al
browser, LLM por pageview o modelo frontier, realtime anonimo, vidriera pegandole a Postgres en
cada hit, worker 24/7 en vez de cron, spend cap apagado.
Devolve DELTA_POR_TENANT_MES con la aritmetica a la vista y la metrica a vigilar.
Actualizá docs/COST.md si el delta es distinto de cero. FAIL bloquea el merge.`,
        { label: `slice:${sliceId}:cost`, phase: 'Slice', agentType: 'cost-auditor', schema: WORK_SCHEMA },
      ),
  ])

  return {
    phase: 'slice',
    slice: sliceId,
    test,
    impl,
    adversary,
    cost,
    gate: adversary?.verdict === 'PASS' ? 'ADVERSARY_PASS' : 'ADVERSARY_FAIL',
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------
const phase = (args && args.phase) || 'research'
log(`istock-build :: FASE solicitada = ${phase}`)

let out
if (phase === 'research') out = await runResearch()
else if (phase === 'domain') out = await runDomain()
else if (phase === 'skeleton') out = await runSkeleton()
else if (phase === 'slice') out = await runSlice(args && args.slice)
else throw new Error(`FASE desconocida: ${phase}. Usá research | domain | skeleton | slice`)

return out
