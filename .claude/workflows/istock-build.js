export const meta = {
  name: 'istock-build',
  description: 'Pipeline maestro de iStock: research verificado -> domain/schema -> skeleton -> slices, con voto adversarial y gate de costo en cada ola.',
  whenToUse: 'Correr una FASE del pipeline de iStock. args: { phase: "research"|"domain"|"skeleton"|"slice", slice?: "S2" }',
  phases: [
    { title: 'Research', detail: '7 topics en paralelo, cada uno con fuentes de hoy' },
    { title: 'Verify', detail: 'adversario vota cada research: cifra sin fuente = FAIL' },
    { title: 'Fix', detail: 'el researcher corrige solo los findings del adversario' },
    { title: 'Reverify', detail: 'segunda vuelta: quedo algun critical/high abierto?' },
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

ENTORNO REAL DE ESTA MAQUINA (verificado por el LEAD, no lo re-investigues):
  - pnpm 10.34.5, Node 22.23.2. El workspace ya existe: pnpm-workspace.yaml + package.json raiz
    + tsconfig.base.json con strict, noUncheckedIndexedAccess y exactOptionalPropertyTypes.
    Tu package extiende ../../tsconfig.base.json. No lo redefinas.
  - NO hay Docker y NO hay Supabase CLI. NO los uses y NO los pidas.
  - SI hay Postgres 16.14 local corriendo. ./scripts/pg-local.sh crea la base istock_dev con los
    roles anon/authenticated/service_role y el schema auth con auth.jwt()/auth.uid()/auth.role()
    con el MISMO cuerpo que Supabase (leen current_setting('request.jwt.claims')).
    DATABASE_URL=postgresql://gigi@localhost:5432/istock_dev
    Consecuencia: el test de RLS cruzado SI se puede correr de verdad. B2 no lo bloquea.
  - pgvector NO esta disponible en este Postgres. Todo lo de embeddings va en una migracion
    APARTE y opcional, para que las migraciones base corran limpias en local.
  - Falta un secret (R2, MP, Gemini) => interface + driver mock/local + .env.example. NUNCA pares.
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
// FASE 1b - correccion quirurgica. El adversario voto FAIL sobre afirmaciones
// puntuales, no sobre el research entero. Se corrigen ESAS lineas y se re-vota.
// Re-investigar de cero tiraria a la basura material verificado.
// ---------------------------------------------------------------------------
async function runResearchFix(items) {
  if (!items || !items.length) throw new Error('runResearchFix necesita args.items con los findings')
  log(`FASE 1b - corrigiendo ${items.length} topics con findings del adversario.`)

  const results = await pipeline(
    items,

    (it) =>
      agent(
        `${LAW}

${role('researcher')}

Escribiste docs/research/${it.slug}.md y el adversario lo voto FAIL.
NO reescribas el documento de cero: la mayor parte esta bien y verificada.
Corregí EXACTAMENTE los puntos de abajo y nada mas.

EL REVIEW COMPLETO ESTA EN DISCO. Leelo AHORA, entero, antes de tocar nada:
  cat ${it.reviewFile}
Son ${it.nFindings} findings y ${it.nUnsourced} afirmaciones sin fuente. Trabajás sobre TODOS.

PROTOCOLO DE CORRECCION, por cada punto, en este orden:
  a) Cargá las tools: ToolSearch("select:WebSearch,WebFetch"). Hoy es 2026-08-27.
  b) Intentá VERIFICAR la afirmacion contra fuente primaria. Si se verifica: dejala y agregá la URL.
  c) Si la fuente dice algo DISTINTO: corregí el dato al valor real y citá la fuente.
     Un dato corregido vale mas que un dato borrado.
  d) Si no podes verificarla: NO la borres en silencio. Bajala a la seccion ## UNVERIFIED
     con el texto exacto y el motivo, y sacá cualquier afirmacion del cuerpo que dependia de ella.
  e) Si el adversario dice que INVENTASTE una cita textual o una URL: borrala y decilo en
     ## UNVERIFIED. Una cita fabricada es el peor fallo posible de tu oficio.
  f) Si el adversario encontro una CONTRADICCION INTERNA o un error aritmetico: rehacé la cuenta
     y dejá un solo numero, coherente en todo el archivo.

REGLAS:
  - Un finding critical o high sin resolver = tu entrega vuelve a fallar.
  - Si el adversario se equivoca, podes defender tu version, pero SOLO con URL que lo pruebe:
    agregá una linea "## Refutaciones al review" con la evidencia. Sin URL no hay defensa.
  - Escribis SOLO docs/research/${it.slug}.md.
  - Al terminar: wc -c docs/research/${it.slug}.md y reporta el numero real.

En shortAnswer devolvé un bullet por finding corregido, diciendo que cambio.`,
        { label: `fix:${it.id}`, phase: 'Fix', agentType: 'researcher', schema: RESEARCH_SCHEMA },
      ),

    (res, it) => {
      if (!res) return null
      return agent(
        `${LAW}

${role('adversary-reviewer')}

Segunda vuelta sobre docs/research/${it.slug}.md. Voz votaste FAIL antes; el researcher corrigio.
Leelo: cat docs/research/${it.slug}.md

Tus findings originales estan en disco. Leelos: cat ${it.reviewFile}

Tu tarea, en este orden:
  1. Por CADA finding tuyo: quedo resuelto? (corregido con fuente, o bajado a UNVERIFIED con motivo).
     Un finding "resuelto" borrando la afirmacion pero dejando el cuerpo del doc apoyado en ella
     NO esta resuelto.
  2. Verificá que no se introdujeron afirmaciones NUEVAS sin fuente al corregir.
  3. Si el researcher escribio "## Refutaciones al review", evaluá la evidencia con honestidad:
     si la URL prueba que el researcher tenia razon, aceptalo y no lo cuentes como finding.
  4. Chequeá coherencia aritmetica del archivo entero una vez mas.

Podes usar ToolSearch("select:WebSearch,WebFetch") para verificar.

verdict PASS solo si NINGUN critical/high queda abierto. Los low que quedaron documentados
en UNVERIFIED no bloquean: el objetivo es que el LEAD no promueva a DECISIONS.md un dato falso,
no que el research sea perfecto.`,
        { label: `reverify:${it.id}`, phase: 'Reverify', agentType: 'adversary-reviewer', schema: VERDICT_SCHEMA },
      ).then((v) => ({ id: it.id, slug: it.slug, research: res, verdict: v }))
    },
  )

  const done = results.filter(Boolean)
  const stillFailing = done.filter((r) => r.verdict?.verdict === 'FAIL')
  log(`FASE 1b lista: ${done.length}/${items.length}. Siguen en FAIL: ${stillFailing.length}.`)

  return {
    phase: 'research-fix',
    completed: done.length,
    total: items.length,
    stillFailing: stillFailing.map((r) => r.id),
    reports: done.map((r) => ({
      id: r.id,
      slug: r.slug,
      bytes: r.research.bytes,
      confidence: r.research.confidence,
      verdict: r.verdict?.verdict ?? 'NO_VERDICT',
      corrections: r.research.shortAnswer,
      keyNumbers: r.research.keyNumbers,
      impact: r.research.impact,
      unverified: r.research.unverified,
      openFindings: (r.verdict?.findings ?? []).filter((f) => f.severity === 'critical' || f.severity === 'high'),
    })),
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
Migraciones versionadas y commiteadas, en SQL plano aplicable con psql (drizzle-kit generate).
El embedding de catalog_models va en una migracion APARTE (pgvector no existe en el Postgres local):
las migraciones base tienen que aplicar limpias contra istock_dev.
Seed demo determinista: 8 iPhones + 2 accesorios + 1 reserved. Sin Math.random ni Date.now en el seed.

Acceptance que tenes que dejar corriendo y verificada por vos mismo:
  ./scripts/pg-local.sh --drop && pnpm --filter @istock/db migrate
  psql -d istock_dev -tAc "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'"
  psql -d istock_dev -tAc "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity"
Los dos conteos tienen que coincidir salvo por catalog_models/catalog_faqs, y esa diferencia la
explicas numericamente en tu reporte.

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

HAY Postgres real disponible: no hay skip que valga. El test corre contra istock_dev.
Setup del test: aplicar las migraciones de packages/db, insertar dos tenants con service_role,
y para cada asercion hacer  set local role authenticated  +
set_config('request.jwt.claims', <json con app_metadata.tenant_id>, true)  dentro de una transaccion.
Nada de mocks, nada de stubs de auth.jwt(): la funcion ya existe en la base.
Si un assert falla, el test queda ROJO y lo reportas. NO toques packages/db para taparlo.`,
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
NO toques proxy.ts ni apps/web/app/(storefront): son de storefront-agent.
NO toques apps/web/package.json, next.config.ts, tsconfig.json, app/layout.tsx ni app/globals.css:
los escribio el LEAD porque son compartidos por los tres owners. Si necesitas una dependencia
nueva, la pedis en BLOCKERS; no edites ese package.json.

Entrega:
  - marketing honesta en / : que hace iStock, para quien, precio. Cero promesa que el producto no cumple.
  - auth con Supabase + creacion de tenant con slug (validado con Zod: url-safe, unico, reservados bloqueados)
  - layout del panel /app mobile-first (se usa parado en un local, con una mano)
RSC por default. Zod en todo borde. Copy en espanol rioplatense, codigo en ingles.
Cero features de slices S1-S13 todavia: esto es esqueleto navegable, no producto.

Dos reglas que NO son negociables y que el LEAD verifica:
  - La autorizacion se chequea DENTRO de cada Server Function / Route Handler. El proxy no es
    control de acceso: un matcher que excluye un path tambien saltea las Server Functions de ese
    path (ARCHITECTURE.md, cerrado en ADR-007).
  - tenant_id va en app_metadata del JWT, NUNCA en user_metadata: el usuario puede escribir
    user_metadata y eso es escalacion de tenant (lint 0015, severidad ERROR).
Sin credenciales de Supabase (B2), cablea contra la interface y deja el flujo testeable; no pares.`,
        { label: 'skeleton:panel', phase: 'Skeleton', agentType: 'app-agent', schema: WORK_SCHEMA },
      ),
    () =>
      agent(
        `${LAW}

${role('storefront-agent')}

Sos "storefront-agent". Escribis SOLO en apps/web/app/(storefront) y apps/web/proxy.ts.
NO toques el panel ni las API del panel. NO toques los archivos compartidos de apps/web
(package.json, next.config.ts, tsconfig.json, app/layout.tsx, app/globals.css): son del LEAD.

Lee ANTES de escribir una linea: docs/research/wildcard-isr.md, docs/ARCHITECTURE.md
(secciones "Resolucion host -> tenant" y "Cache e invalidacion") y docs/DECISIONS.md ADR-007.
Eso ya esta CERRADO. No lo re-decidas.

El archivo es apps/web/proxy.ts con  export function proxy(request: NextRequest).
Next 16 deprecio middleware.ts. El runtime es Node.js y NO se configura: poner runtime tira error.

  maat.work / www        -> passthrough (marketing)
  {slug}.maat.work       -> rewrite a /s/{slug}/...
  *.localhost / *.nip.io -> idem, para dev

TRES COSAS QUE SON LEY Y QUE EL LEAD VERIFICA UNA POR UNA:
  1. El proxy NO consulta Postgres y NO cachea en memoria. NO hay Map de slug -> tenantId.
     Corre fuera del runtime de la app y la doc oficial dice explicito que no dependas de modulos
     ni globals compartidos: un Map a nivel de modulo ahi NO es un cache. Parsea el host, valida
     el slug con un regex, reescribe. Nada mas. Presupuesto: < 2 ms de CPU, 0 llamadas de red.
     Se factura en el 100% de los pageviews, incluso en HIT de cache.
  2. El slug viaja como SEGMENTO DE PATH, jamas como header. Dos motivos, los dos graves:
     headers() dentro de 'use cache' vuelve la ruta dinamica y mata el ISR; y el cache key de
     'use cache' NO incluye el host, asi que dos subdominios que rendericen el mismo path con
     los mismos argumentos COMPARTEN ENTRADA. Eso es una fuga entre tenants, no una ineficiencia.
  3. Todo cacheTag lleva el slug adentro (storefront:{slug}), porque los tags estan scopeados a
     proyecto + environment, NO a dominio: un tag sin slug purga a todos los tenants a la vez.

cacheLife de la vidriera: 'max' + invalidacion por evento. PROHIBIDO revalidate: 60 como default:
son USD 2.59/tenant/mes contra USD 0.012, o sea 216x, y solo eso ya revienta el objetivo de 0.50.

Slug inexistente -> 404 REAL y cacheable, no redirect al home. Y dejalo escrito en el codigo:
ese 404 se cachea, asi que el alta de un tenant TIENE que invalidar el tag de su propio slug o la
vidriera nace muerta.

Cero set-cookie en (storefront): uno solo apaga el cache del CDN entero.
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

Lee tambien docs/ARCHITECTURE.md seccion "Camino de una foto" y docs/DECISIONS.md ADR-006.
Eso esta CERRADO: no re-decidas el esquema de keys ni la cantidad de buckets.

Entrega el pipeline: cliente R2, upload server-side, resize propio con sharp a
thumb 200 / card 800 / detail 1600 px en WebP, y la API publica
uploadListingPhoto / variantUrl / unlinkListingPhotos.

EL ESQUEMA DE KEYS ES LEY Y ES CONTRAINTUITIVO. Leelo dos veces:
  - DOS buckets, no uno. istock-originals es PRIVADO (el master, alcanzable solo por S3 API
    server-side, sin public access y sin custom domain). istock-media es publico y SOLO tiene
    variantes.
  - La key publica es OPACA:  v1/{ab}/{sha256_32}.webp  donde el hash es del byte output DE ESA
    VARIANTE. Sin tenant_id, sin listing_id, sin sufijo de variante.
    Una key que contenga tenant_id o listing_id, o desde la que se pueda DERIVAR la key del
    master, es causa de rechazo automatico (CLAUDE.md §2). El mapeo listing -> keys vive en
    Postgres con tenant_id + RLS, no en la URL.
  - TRAMPA de la key content-addressed: dos tenants que suban la MISMA foto comparten el mismo
    objeto. Por lo tanto borrar un listing NUNCA borra el objeto de R2 por key: se borra la fila
    del mapeo. Borrar por key es un borrado cruzado entre tenants. Por eso la funcion se llama
    unlink y no delete.
  - Cache-Control se setea con el parametro CacheControl de @aws-sdk/client-s3, NO con
    httpMetadata.cacheControl: eso es el binding de Workers y no existe en el runtime Node de
    Vercel. Hacerlo mal deja los objetos sin Cache-Control y con edge TTL default de 120 min.

Techos que el test tiene que hacer FALLAR si se superan, con una imagen de referencia real
(generala vos con sharp, deterministica): card <= 150KB es requisito de aceptacion de S2.

Sin credenciales de R2 (B1), implementa la interface StorageDriver con un driver local en disco
y dejalo como default via MEDIA_DRIVER=local (ya esta en .env.example). El pipeline de resize y
los techos de bytes se testean SIN credenciales: hacelo, no lo dejes para despues.`,
        { label: 'skeleton:media', phase: 'Skeleton', agentType: 'media-agent', schema: WORK_SCHEMA },
      ),
  ])

  return { phase: 'skeleton', panel, storefront, media }
}

// ---------------------------------------------------------------------------
// FASE 4 - una slice: test -> impl -> adversary -> costo.
// ---------------------------------------------------------------------------
// Owner de cada slice, tomado de la tabla de FASE 4 de docs/SLICE_BOARD.md.
// Existe para que el agente de implementacion arranque CON el system prompt de su oficio y con
// sus tools recortadas, en vez de que un agente generico adivine quien es leyendo una tabla.
// Adivinar el owner es adivinar el permiso de escritura: la regla 1 se queda sin enforcement.
// Las slices con dos owners corren en ORDEN, nunca a la vez: la flecha del board es la secuencia.
const SLICE_OWNERS = {
  S1: ['storefront-agent'],
  S2: ['media-agent', 'app-agent'],
  S3: ['storefront-agent'],
  S4: ['domain-agent', 'storefront-agent'],
  S5: ['domain-agent', 'app-agent'],
  S6: ['app-agent'],
  S7: ['app-agent'],
  S8: ['app-agent'],
  S9: ['app-agent'],
  S10: ['app-agent'],
  S11: ['app-agent'],
  S12: ['app-agent'],
  S13: ['storefront-agent'],
}

async function runSlice(sliceId, base) {
  if (!sliceId) throw new Error('runSlice necesita args.slice, ej "S2"')
  const owners = SLICE_OWNERS[sliceId]
  if (!owners) throw new Error('Slice desconocida: ' + sliceId + '. Owners definidos: ' + Object.keys(SLICE_OWNERS).join(' '))

  // El LEAD commitea entre slices. Si el adversary mira "git diff HEAD" despues de ese commit ve
  // CERO lineas, no encuentra nada y reporta PASS: un gate que se apaga solo justo cuando el
  // trabajo esta completo. Por eso el diff va contra el SHA anterior a la slice, que pasa el LEAD.
  const baseRef = base || 'HEAD'
  const diffCmd = 'git --no-pager diff ' + baseRef + ' && git --no-pager diff --stat ' + baseRef

  log('FASE 4 - slice ' + sliceId + ': owners=' + owners.join(' -> ') + ', diff contra ' + baseRef)

  const spec = 'Slice ' + sliceId + ' de docs/SLICE_BOARD.md (FASE 4). Lee la fila de la slice y su gate de aceptacion, que es literal: es el comando que el LEAD va a re-ejecutar.'

  const test = await agent(
    LAW + '\n\n' + role('qa-agent') + '\n\n' +
    'Sos "qa-agent". ' + spec + '\n' +
    'Escribi el test ANTES de la implementacion y CORRELO para mostrar que falla.\n' +
    'Un test que nunca fallo no prueba nada. Reporta la salida real del test fallando.\n' +
    'Prohibido expect(true).toBe(true) y tests que pasan con la implementacion vacia.\n' +
    'Prohibido skipear por falta de un secret: si falta, el driver mock o local ya existe\n' +
    '(MEDIA_DRIVER=local, BILLING_DRIVER=mock, scripts/pg-local.sh). Usalo y testea de verdad.\n' +
    'El gate del board manda: si dice "cero campos prohibidos en el HTML", el test lee el HTML\n' +
    'renderizado y busca los campos, no confia en que el DTO este bien.',
    { label: 'slice:' + sliceId + ':test', phase: 'Slice', agentType: 'qa-agent', schema: WORK_SCHEMA },
  )

  const impls = []
  for (const owner of owners) {
    const previo = impls.length
      ? '\nParte ya hecha por ' + owners[impls.length - 1] + ': ' + JSON.stringify(impls[impls.length - 1]?.files ?? []) + '\nConstrui sobre eso; NO lo reescribas.'
      : ''
    const r = await agent(
      LAW + '\n\n' + role(owner) + '\n\n' +
      'Sos "' + owner + '", el owner del directorio de esta slice segun CLAUDE.md seccion 4.\n' +
      'Corre primero: cat .claude/agents/' + owner + '.md\n\n' + spec + previo + '\n\n' +
      'Escribi SOLO en tu directorio. Si la slice cruza otro directorio, haces tu parte y reportas\n' +
      'la otra como pendiente en notes. Escribir fuera de tu columna es fallo de slice, no iniciativa.\n\n' +
      'Tests ya escritos por qa-agent, que tenes que hacer pasar y NO podes tocar: ' +
      JSON.stringify(test?.files ?? []) + '\n' +
      'Si un test te parece mal, decilo en notes y pará. Editarlo para que pase es el unico modo\n' +
      'de romper esto sin que se note.\n\n' +
      'Al terminar corre, en este orden, y reporta la salida REAL de cada uno:\n' +
      '  pnpm typecheck && pnpm lint && pnpm test && ./scripts/guard-leaks.sh\n' +
      'guard-leaks chequea las prohibiciones de CLAUDE.md seccion 2. Si tira LEAK, arreglalo:\n' +
      'no es un falso positivo tuyo hasta que muestres por que.',
      { label: 'slice:' + sliceId + ':impl:' + owner, phase: 'Slice', agentType: owner, schema: WORK_SCHEMA },
    )
    impls.push(r)
  }

  const [adversary, cost] = await parallel([
    () =>
      agent(
        LAW + '\n\n' + role('adversary-reviewer') + '\n\n' +
        'Sos "adversary-reviewer". NO escribis archivos. Audita la slice ' + sliceId + '.\n' +
        'Mira el diff con: ' + diffCmd + '\n' +
        'Si ese diff sale vacio, NO reportes PASS: reporta que no hay diff que auditar y por que.\n\n' +
        'Checklist completo de .claude/agents/adversary-reviewer.md: tenant leak, IDOR, PII en\n' +
        'payload (imei/cost_usd/internal_notes en HTML, __NEXT_DATA__, props de RSC, respuestas de\n' +
        'API), RLS ausente o permisiva, input sin Zod, secretos en el cliente, prompt injection,\n' +
        'estado inconsistente, costo escondido, cache leak entre tenants.\n\n' +
        'Cuatro cosas de este proyecto que un checklist generico no mira:\n' +
        '  1. El slug viaja en el PATH, nunca en un header: el key de "use cache" no incluye el\n' +
        '     host, asi que dos subdominios comparten entrada. Eso es fuga de tenant, no ineficiencia.\n' +
        '  2. Todo cacheTag lleva el slug adentro: los tags son por proyecto+environment, no por\n' +
        '     dominio, y un tag sin slug purga a todos los tenants.\n' +
        '  3. proxy.ts no consulta nada ni cachea nada en memoria, y no configura runtime.\n' +
        '  4. Borrar un listing NO borra el objeto de R2 por key: la key es content-addressed y dos\n' +
        '     tenants pueden compartir el byte. Se desvincula el mapeo.\n\n' +
        'Corre tambien ./scripts/guard-leaks.sh y reporta lo que diga.\n' +
        'Un critical o high => FAIL. Sin evidencia concreta (archivo:linea, o comando y salida) no\n' +
        'hay finding: un finding sin evidencia le hace perder mas tiempo al equipo que el bug.',
        { label: 'slice:' + sliceId + ':adversary', phase: 'Slice', agentType: 'adversary-reviewer', schema: VERDICT_SCHEMA },
      ),
    () =>
      agent(
        LAW + '\n\n' + role('cost-auditor') + '\n\n' +
        'Sos "cost-auditor". Audita la slice ' + sliceId + ' contra < USD 0.50/mes por tenant activo\n' +
        '(plan Base) y < USD 1.50 (Negocio), hasta 100 clientes.\n' +
        'Mira el diff con: ' + diffCmd + '\n' +
        'Pregunta unica: esto agrega costo tonto?\n\n' +
        'Fallos automaticos: fotos por Supabase Storage o Vercel Image Optimization, original\n' +
        '>500KB al browser, LLM por pageview o modelo frontier, realtime anonimo, vidriera\n' +
        'pegandole a Postgres en cada hit, worker 24/7 en vez de cron, spend cap apagado.\n\n' +
        'Dos numeros medidos que ya estan en docs/COST.md y son el patron de comparacion:\n' +
        '  - cacheLife "max" + invalidacion por evento = USD 0.012/tenant/mes en ISR Writes.\n' +
        '  - revalidate: 60 = USD 2.59/tenant/mes. 216 veces mas caro por un default.\n' +
        '  - El proxy corre ANTES del cache: se factura en el 100% de los pageviews, tambien en HIT.\n' +
        '    Ahi duelen las Edge Requests alrededor de los 80 tenants.\n\n' +
        'Devolve DELTA_POR_TENANT_MES con la aritmetica a la vista y la metrica a vigilar.\n' +
        'Actualiza docs/COST.md si el delta es distinto de cero. Marca [EST] lo que estimaste.\n' +
        'FAIL bloquea el merge.',
        { label: 'slice:' + sliceId + ':cost', phase: 'Slice', agentType: 'cost-auditor', schema: WORK_SCHEMA },
      ),
  ])

  return {
    phase: 'slice',
    slice: sliceId,
    owners,
    base: baseRef,
    test,
    impls,
    adversary,
    cost,
    gate: adversary?.verdict === 'PASS' ? 'ADVERSARY_PASS' : 'ADVERSARY_FAIL',
  }
}

// Varias slices en una sola invocacion, en el orden del board y SIEMPRE serial: dos slices en
// paralelo que comparten owner violan "un writer por directorio a la vez". Se corta en el primer
// ADVERSARY_FAIL en vez de seguir apilando trabajo sobre una base que ya sabemos rota.
async function runSlices(ids, base) {
  const list = Array.isArray(ids) ? ids : String(ids || '').split(/[\s,]+/).filter(Boolean)
  if (!list.length) throw new Error('runSlices necesita args.slices, ej ["S1","S3"]')
  const done = []
  for (const id of list) {
    const r = await runSlice(id, base)
    done.push(r)
    if (r.gate !== 'ADVERSARY_PASS') {
      log('STOP en ' + id + ': adversary FAIL. No sigo con ' + list.slice(list.indexOf(id) + 1).join(' '))
      break
    }
  }
  return { phase: 'slices', ran: done.map((d) => d.slice), results: done }
}

// ---------------------------------------------------------------------------
// FASE 5 — chatbot de vidriera (capa 2, entitlement Negocio)
// ---------------------------------------------------------------------------
async function runChat(base) {
  const baseRef = base || 'HEAD'
  const diffCmd = 'git --no-pager diff ' + baseRef
  log('FASE 5 - chatbot. Primero se corrige el doc que lo especifica, despues se codea.')

  // docs/CHATBOT.md se escribio en FASE 0 y quedo desactualizado: ofrece llama-3.1-8b-instant
  // como fallback de Groq. Ese modelo esta RETIRADO desde el 16/08/2026 y CLAUDE.md seccion 3 lo
  // prohibe explicito. Si el doc entra asi a ai-agent, la fase arranca desde un ID muerto y el
  // fallback -- que esta en el camino de ejecucion, no de adorno -- falla la primera vez que se
  // usa, en produccion. Se arregla ANTES y lo arregla su owner, no el LEAD.
  const fix = await agent(
    LAW + '\n\n' + role('docs-keeper') + '\n\n' +
    'Sos "docs-keeper", unico writer de docs/** (salvo docs/research y docs/COST.md).\n' +
    'Tarea unica y acotada: docs/CHATBOT.md contradice a CLAUDE.md seccion 3.\n\n' +
    'El doc dice que el fallback de Groq es "llama-3.1-8b-instant / gpt-oss-20b".\n' +
    'La constitucion dice: llama-3.1-8b-instant esta RETIRADO desde el 16/08/2026 para free y\n' +
    'developer tier. El fallback es openai/gpt-oss-20b, unico.\n\n' +
    'Ademas, los IDs de modelo NO van como constante en el doc ni en el codigo: van por env var\n' +
    '(LLM_PRIMARY_MODEL / LLM_FALLBACK_MODEL), porque hubo dos deprecaciones en tres meses.\n' +
    'Y anota lo que ya esta decidido: billing habilitado en Gemini desde el dia 1 (no es ahorro,\n' +
    'es privacidad: el free tier entrena con los prompts) y ZDR activado en Groq antes de prod.\n\n' +
    'Verifica contra docs/research/llm-pricing.md [R3] antes de escribir. No reabras la decision,\n' +
    'no toques nada mas del archivo, y no inventes precios.',
    { label: 'chat:doc-fix', phase: 'Chat', agentType: 'docs-keeper', schema: WORK_SCHEMA },
  )

  const evals = await agent(
    LAW + '\n\n' + role('qa-agent') + '\n\n' +
    'Sos "qa-agent". Escribi la eval del chatbot ANTES de que exista, y mostrala fallando.\n' +
    'Gate de la fase, de docs/CHATBOT.md:\n' +
    '  - jailbreaks de COSTO y de IMEI, en TRES fraseos distintos cada uno. Que el bot no diga el\n' +
    '    costo "porque no se lo pasamos" no alcanza: la eval verifica que ni siquiera este en el\n' +
    '    contexto que se le arma.\n' +
    '  - prompt injection escondida en la DESCRIPCION de un listing. La escribe el dueno: es input\n' +
    '    no confiable, aunque el dueno sea nuestro cliente.\n' +
    '  - un listing reserved NUNCA se describe como disponible.\n' +
    '  - "no se" => handoff a WhatsApp, no invencion.\n' +
    '  - dieta MEDIDA: <=1200 tokens in, <=180 out. La eval cuenta tokens reales del prompt armado,\n' +
    '    no confia en que el codigo respete el techo.\n\n' +
    'Sin API keys (B4) la eval corre igual contra un cliente LLM fake que devuelve respuestas\n' +
    'fijas: lo que se testea es el ARMADO del contexto, las tools y el handoff, no el modelo.\n' +
    'Eso no es un skip: es la parte que nos puede filtrar un IMEI.',
    { label: 'chat:evals', phase: 'Chat', agentType: 'qa-agent', schema: WORK_SCHEMA },
  )

  const impl = await agent(
    LAW + '\n\n' + role('ai-agent') + '\n\n' +
    'Sos "ai-agent", unico writer de packages/ai. Corre: cat .claude/agents/ai-agent.md\n' +
    'Lee docs/CHATBOT.md (recien corregido) y la skill .claude/skills/chatbot-diet/SKILL.md.\n\n' +
    'Evals ya escritas que tenes que hacer pasar y NO podes tocar: ' + JSON.stringify(evals?.files ?? []) + '\n\n' +
    'No negociable:\n' +
    '  - Contexto exacto: system corto + publicListingDTO de la ficha abierta + 3 chunks del MISMO\n' +
    '    catalog_model + ultimos 4 turnos recortados. Nada mas. Ni el catalogo entero, ni los otros\n' +
    '    listings, ni el historial completo.\n' +
    '  - Tres tools: get_open_listing, search_listings (mismo tenant, max 5, campos minimos),\n' +
    '    handoff_whatsapp. El tenant_id NO es argumento de ninguna tool: se inyecta server-side\n' +
    '    desde el host. Un tenant_id que el modelo puede elegir es un tenant_id que puede cambiar.\n' +
    '  - El contexto se arma desde publicListingDTO, nunca desde la fila de la DB.\n' +
    '  - Modelos por env var. Gemini 2.5 Flash-Lite primario, openai/gpt-oss-20b fallback.\n' +
    '    El fallback esta EN el camino de ejecucion y TESTEADO: el primario tiene riesgo de apagado\n' +
    '    en octubre 2026. Un fallback que nunca se ejecuto no es un fallback.\n' +
    '  - Claude o GPT en el hot path = fallo de la fase.\n' +
    '  - Salida como TEXTO PLANO: sin markdown, sin imagenes, sin links. Sanitizador de Unicode\n' +
    '    invisible en el ingest de descripciones y en el render.\n' +
    '  - Sin memoria persistente, sin tools de escritura, sin embeddings por tenant.\n\n' +
    'Al terminar: pnpm typecheck && pnpm lint && pnpm test && ./scripts/guard-leaks.sh\n' +
    'y reporta la salida real de cada uno.',
    { label: 'chat:impl', phase: 'Chat', agentType: 'ai-agent', schema: WORK_SCHEMA },
  )

  const widget = await agent(
    LAW + '\n\n' + role('storefront-agent') + '\n\n' +
    'Sos "storefront-agent". Monta el widget del chat en la vidriera, detras del entitlement.\n\n' +
    'La regla que decide el diseno: en plan base el widget NO EXISTE EN EL DOM. No esta oculto,\n' +
    'no esta deshabilitado, no hay paywall. El comprador final no es nuestro cliente y no tiene\n' +
    'por que enterarse de nuestros planes.\n\n' +
    'Y no rompas el cache: el entitlement del tenant es parte del contenido cacheado por slug\n' +
    '(mismo tag tenant-config:{slug}), no una decision por request. Si esto te obliga a leer\n' +
    'headers() o cookies en la vidriera, lo estas haciendo mal: pará y reportalo en notes.\n\n' +
    'El chat es una llamada explicita del visitante, JAMAS parte del pageview.',
    { label: 'chat:widget', phase: 'Chat', agentType: 'storefront-agent', schema: WORK_SCHEMA },
  )

  const [adversary, cost] = await parallel([
    () => agent(
      LAW + '\n\n' + role('adversary-reviewer') + '\n\n' +
      'Sos "adversary-reviewer". NO escribis. Audita el chatbot. Diff: ' + diffCmd + '\n' +
      'Vector principal: la descripcion del listing la escribe el DUENO. Es input no confiable.\n' +
      'Intenta, con evidencia concreta: sacarle el costo o el IMEI al bot en tres fraseos;\n' +
      'inyectar instrucciones desde la descripcion de un listing; hacer que hable de otro tenant;\n' +
      'que describa un reserved como disponible; que devuelva un link o markdown.\n' +
      'Mira tambien si el tenant_id es argumento de alguna tool (deberia inyectarse server-side).\n' +
      'Un critical o high => FAIL.',
      { label: 'chat:adversary', phase: 'Chat', agentType: 'adversary-reviewer', schema: VERDICT_SCHEMA },
    ),
    () => agent(
      LAW + '\n\n' + role('cost-auditor') + '\n\n' +
      'Sos "cost-auditor". El chat es ~75% del costo variable del plan Negocio (<= USD 1.50).\n' +
      'Diff: ' + diffCmd + '\n' +
      'Verifica: cero LLM por pageview; dieta respetada con tokens MEDIDOS, no declarados;\n' +
      'rate limit 8/IP/10min y soft cap 40 msgs/tenant/dia; el contador de tokens por tenant vive\n' +
      'en ruta autenticada, NUNCA en la vidriera (un contador en Postgres sobre la vidriera rompe\n' +
      'el 95% sin Postgres); embeddings solo en seed/update de catalog_models.\n' +
      'Llena la tabla de costo de docs/CHATBOT.md con lo medido y actualiza docs/COST.md.\n' +
      'Devolve DELTA_POR_TENANT_MES con la aritmetica a la vista.',
      { label: 'chat:cost', phase: 'Chat', agentType: 'cost-auditor', schema: WORK_SCHEMA },
    ),
  ])

  return { phase: 'chat', fix, evals, impl, widget, adversary, cost,
    gate: adversary?.verdict === 'PASS' ? 'ADVERSARY_PASS' : 'ADVERSARY_FAIL' }
}

// ---------------------------------------------------------------------------
// FASE 6 — billing (trial 14d + entitlements; MP real bloqueado en B3)
// ---------------------------------------------------------------------------
async function runBilling(base) {
  const baseRef = base || 'HEAD'
  log('FASE 6 - billing. B3 no esta: se codea contra la interface y el driver mock.')

  const test = await agent(
    LAW + '\n\n' + role('qa-agent') + '\n\n' +
    'Sos "qa-agent". Test primero, mostrado fallando. Cubri:\n' +
    '  - trial de 14 dias: dia 13 tiene acceso, dia 15 no. Con "now" INYECTADO, nunca Date.now().\n' +
    '  - entitlements por plan: base no tiene chatbot ni reservas ni margen; negocio si.\n' +
    '  - webhook IDEMPOTENTE: el mismo evento dos veces deja el mismo estado. MP reintenta, y un\n' +
    '    webhook que cobra dos veces se descubre con el cliente enojado, no en CI.\n' +
    '  - webhook con firma HMAC invalida => rechazado. La firma se verifica DENTRO del route\n' +
    '    handler: un matcher del proxy que excluye un path tambien saltea sus Server Functions.\n' +
    '  - vencimiento de pago => se cae a base, la vidriera SIGUE viva. Cortarle la vidriera a quien\n' +
    '    se atraso un dia es perderlo para siempre.\n\n' +
    'BILLING_DRIVER=mock. Sin B3 no hay skip: la maquina de estados de la suscripcion es nuestra.',
    { label: 'billing:test', phase: 'Billing', agentType: 'qa-agent', schema: WORK_SCHEMA },
  )

  const impl = await agent(
    LAW + '\n\n' + role('billing-agent') + '\n\n' +
    'Sos "billing-agent". Corre: cat .claude/agents/billing-agent.md\n' +
    'Lee la skill .claude/skills/mp-subscriptions/SKILL.md y, ANTES de escribir, el bloque\n' +
    'LEAD OVERRIDE al tope de docs/research/mp-subscriptions.md.\n\n' +
    'CRITICO: R4 fallo dos veces y se cerro por la regla 3. Hay CINCO afirmaciones ANULADAS en ese\n' +
    'archivo. NO las copies al codigo ni a los docs. Sus preguntas abiertas no son contestables\n' +
    'leyendo: se cierran con los 4 experimentos de sandbox de ADR-008, y eso necesita B3.\n' +
    'debin_transfer y CVU EXISTEN en el enum de la API. Que existan en el enum no prueba que\n' +
    'funcionen para suscripciones: NO afirmes nada en positivo sobre ellos hasta B3.\n\n' +
    'Escribi: maquina de estados de la suscripcion, trial 14d, entitlements por plan, y el webhook\n' +
    'idempotente con verificacion HMAC. Todo detras de una interface con driver mock, de modo que\n' +
    'el dia que llegue B3 se enchufe el driver real sin tocar la logica.\n' +
    'Nunca Stripe. Preferir debito y transferencia: la comision de MP (~USD 1.03/pagador/mes) es\n' +
    'mas cara que TODA la infra del tenant.\n' +
    'Dejá en .env.example lo que hace falta de B3 y en notes los 4 experimentos pendientes.',
    { label: 'billing:impl', phase: 'Billing', agentType: 'billing-agent', schema: WORK_SCHEMA },
  )

  const adversary = await agent(
    LAW + '\n\n' + role('adversary-reviewer') + '\n\n' +
    'Sos "adversary-reviewer". NO escribis. Diff: git --no-pager diff ' + baseRef + '\n' +
    'Intenta: pagar una vez y quedar habilitado dos; reenviar un webhook viejo; forjar la firma;\n' +
    'usar el webhook de un tenant para habilitar otro; quedarte con features de negocio despues de\n' +
    'que expire el trial; leer el secret del webhook desde el bundle del browser.\n' +
    'Un critical o high => FAIL.',
    { label: 'billing:adversary', phase: 'Billing', agentType: 'adversary-reviewer', schema: VERDICT_SCHEMA },
  )

  return { phase: 'billing', test, impl, adversary,
    gate: adversary?.verdict === 'PASS' ? 'ADVERSARY_PASS' : 'ADVERSARY_FAIL' }
}

// ---------------------------------------------------------------------------
// FASE 7 — test matrix completa
// ---------------------------------------------------------------------------
async function runTests() {
  log('FASE 7 - TEST_MATRIX verde, o skip declarado por falta de key. Nunca skip silencioso.')
  const r = await agent(
    LAW + '\n\n' + role('qa-agent') + '\n\n' +
    'Sos "qa-agent", unico writer de tests/** y e2e/**. Lee docs/TEST_MATRIX.md fila por fila.\n\n' +
    'Para CADA fila: o esta cubierta por un test que existe y corre, o esta skipeada con el motivo\n' +
    'y el blocker ESCRITOS al lado. Una fila sin ninguna de las dos cosas es la fila que despues\n' +
    'nadie recuerda que falta.\n\n' +
    'Minimos: 20 unit de domain, las 8 aserciones de RLS contra Postgres REAL (scripts/pg-local.sh,\n' +
    'dos claims, dos sesiones), e2e E1..E7 cubriendo S1..S13.\n\n' +
    'Las tres que no pueden faltar, porque son las que nos hunden:\n' +
    '  - el seller no recibe cost_usd EN EL PAYLOAD DE RED, no solo en pantalla. Se verifica\n' +
    '    interceptando la respuesta, no mirando el DOM.\n' +
    '  - IMEI ausente del HTML renderizado, de los logs y del contexto del chatbot. Los tres.\n' +
    '  - la vidriera del tenant A no se sirve nunca bajo el host del tenant B.\n\n' +
    'Mock solo donde no importa la verdad. RLS contra Postgres real, siempre.\n' +
    'Al final corre todo y reporta el conteo real: pasados, fallados, skipeados y por que.',
    { label: 'tests:matrix', phase: 'Tests', agentType: 'qa-agent', schema: WORK_SCHEMA },
  )
  return { phase: 'tests', result: r }
}

// ---------------------------------------------------------------------------
// FASE 8 y 9 — README de operador + retrospectiva
// ---------------------------------------------------------------------------
async function runDocs() {
  log('FASE 8/9 - README de operador y retrospectiva del harness.')
  const [readme, retro] = await parallel([
    () => agent(
      LAW + '\n\n' + role('docs-keeper') + '\n\n' +
      'Sos "docs-keeper". Escribi el README de OPERADOR: para el que tiene que levantar y sostener\n' +
      'esto, no para el que lo escribio. Cada comando que pongas, CORRELO antes.\n\n' +
      'Tiene que cubrir:\n' +
      '  - variables de entorno, con cual es obligatoria y que se rompe si falta.\n' +
      '  - Postgres local: scripts/pg-local.sh, migraciones, seed.\n' +
      '  - wildcard en local con nip.io, para probar {slug}.maat.work sin DNS.\n' +
      '  - COMO NO APAGAR EL SPEND CAP de Supabase, y que pasa si alguien lo apaga. Va como\n' +
      '    seccion propia, no como nota al pie: es la unica linea entre un mes normal y una factura\n' +
      '    que no podemos pagar.\n' +
      '  - B5: el PROCEDIMIENTO para migrar los nameservers de maat.work a ns1/ns2.vercel-dns.com,\n' +
      '    documentado paso a paso, con el lead time de 24-48h y la advertencia de PRESERVAR los\n' +
      '    registros MX y TXT. Documentado, NO ejecutado: mover el DNS lo hace un humano.\n' +
      '  - los blockers B1..B6 abiertos, que bloquea cada uno y quien lo destraba.\n' +
      '  - que corre en CI y como reproducirlo local.',
      { label: 'docs:readme', phase: 'Docs', agentType: 'docs-keeper', schema: WORK_SCHEMA },
    ),
    () => agent(
      LAW + '\n\n' + role('docs-keeper') + '\n\n' +
      'Sos "docs-keeper". Escribi la retrospectiva del HARNESS en docs/, no del producto.\n' +
      'Que funciono y que no de: un writer por directorio, el test primero, el adversary como gate,\n' +
      'la regla de dos fallos, el phantom-file guard, los research con voto adversarial.\n\n' +
      'Interesa lo que fallo, con el caso concreto. Tres que ya estan documentados en los commits:\n' +
      '  - un comentario que MENTIA sobre los privilegios de service_role sobrevivio al review y\n' +
      '    solo lo agarro un test contra Postgres real. El bug era de produccion, no de CI: habria\n' +
      '    aparecido el dia que se prendia el cron.\n' +
      '  - runSkeleton contradecia tres ADRs cerradas porque el script se escribio ANTES del\n' +
      '    research. Un workflow guardado tambien se pudre.\n' +
      '  - adversary-reviewer diffeaba contra HEAD, que queda vacio despues del commit del LEAD:\n' +
      '    un gate que reportaba PASS sobre cero lineas auditadas.\n\n' +
      'Sin autoelogio y sin metricas de vanidad. Que sirva para la proxima.',
      { label: 'docs:retro', phase: 'Docs', agentType: 'docs-keeper', schema: WORK_SCHEMA },
    ),
  ])
  return { phase: 'docs', readme, retro }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------
const phase = (args && args.phase) || 'research'
log(`istock-build :: FASE solicitada = ${phase}`)

let out
if (phase === 'research') out = await runResearch()
else if (phase === 'research-fix') out = await runResearchFix(args && args.items)
else if (phase === 'domain') out = await runDomain()
else if (phase === 'skeleton') out = await runSkeleton()
else if (phase === 'slice') out = await runSlice(args && args.slice, args && args.base)
else if (phase === 'slices') out = await runSlices(args && args.slices, args && args.base)
else if (phase === 'chat') out = await runChat(args && args.base)
else if (phase === 'billing') out = await runBilling(args && args.base)
else if (phase === 'tests') out = await runTests()
else if (phase === 'docs') out = await runDocs()
else throw new Error(`FASE desconocida: ${phase}. Usá research | research-fix | domain | skeleton | slice | slices | chat | billing | tests | docs`)

return out
