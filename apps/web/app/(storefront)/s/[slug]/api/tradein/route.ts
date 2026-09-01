import { sql } from 'drizzle-orm';
import { isSlugShaped } from '../../../../_lib/host';
import { withStorefrontDb } from '../../../../_lib/storefront-db';
import { TRADEIN_DONE_PATH, TRADEIN_RETRY_PATH } from '../../../../_lib/routes';
import {
  MAX_TRADEIN_BODY_CHARS,
  parseTradeinBody,
  type TradeinLead,
} from '../../../../_lib/tradein-form';

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  `POST {slug}.maat.work/api/tradein` — la SEGUNDA (y por ahora última) escritura sin autenticar.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * El visitante ofrece su equipo en canje. `proxy.ts` reescribe
 * `{slug}.maat.work/api/tradein` → `/s/{slug}/api/tradein`, que es este archivo, por el mismo
 * motivo que el beacon de S4: un passthrough de `/api/**` en el proxy ensancharía la exposición de
 * **toda** ruta de API bajo los hosts de vidriera para ganar un handler.
 *
 * ── De dónde sale el tenant ───────────────────────────────────────────────────────────────────
 * Del **segmento de path que escribió el proxy desde el host**, y de ningún otro lugar. Nunca de
 * un campo del formulario. El `slug` llega como `params` y se convierte en el claim
 * `app_metadata.storefront_slug` dentro de `withStorefrontDb()`; de ahí en más quien resuelve
 * `slug → tenant` es Postgres (`public.storefront_tenant_id()`), no este archivo. Este handler
 * **no conoce** el uuid de ningún tenant y no hay forma de que se lo digan.
 *
 * ── Por qué NO es una Server Action ───────────────────────────────────────────────────────────
 * Una Server Action postea a la URL de la página que la renderizó. El único path que el WAF podría
 * condicionar sería entonces la ficha o `/canje` —o sea, ponerle techo por IP a los **pageviews**
 * de la vidriera—, que es exactamente lo contrario del producto. Como `route.ts` el endpoint tiene
 * path propio y `config/firewall-rules.json` le pone `storefront-tradein-rl`: 5 pedidos cada 600 s
 * por IP, acción `deny`. Ese es el ÚNICO techo de abuso, y es a propósito: `CLAUDE.md` §2 prohíbe
 * rate limiting con contador en Postgres sobre la vidriera.
 *
 * ── Qué se le dice al visitante, y qué no ─────────────────────────────────────────────────────
 * A diferencia del beacon, acá la persona **sí** necesita saber si su canje entró: acaba de
 * escribir su nombre y su teléfono y está esperando que la llamen. Entonces hay dos respuestas y
 * sólo dos, las dos como redirección a una página propia:
 *
 * | resultado | `Location` | qué significa |
 * |---|---|---|
 * | la fila entró | `/canje/listo` | el dueño lo ve en su panel |
 * | cualquier otra cosa | `/canje/reintentar` | no entró; revisá y mandalo de nuevo |
 *
 * **"Cualquier otra cosa" es una sola respuesta a propósito.** El body que no validó, el `42501`
 * de la policy, el CHECK violado, la conexión caída y el tenant que dejó de tomar canje colapsan
 * todos al mismo `Location`. Distinguirlos le daría a quien esté probando un oráculo sobre la
 * forma de la tabla y sobre qué tenants existen, y a la persona que quiere vender su teléfono no
 * le cambia en nada lo que tiene que hacer. El mensaje de Postgres **no cruza al cliente**, ni por
 * status ni por cuerpo.
 *
 * ── Por qué 303 y no 200 con HTML ─────────────────────────────────────────────────────────────
 * POST/Redirect/GET: sin la redirección, un F5 en la pantalla de confirmación reenvía el
 * formulario y el dueño recibe el mismo canje tres veces. `303 See Other` es el status que obliga
 * al navegador a hacer `GET` del destino (un `302` deja el método a criterio del cliente). Y las
 * dos páginas destino son **estáticas y cacheadas**: la respuesta de este POST no es HTML, así que
 * no hay una entrada de cache por envío.
 *
 * El `Location` es **relativo** (`/canje/listo`, no `https://…`). Ver `_lib/routes.ts`: armar el
 * absoluto obligaría a leer el host del pedido, y este handler no lee **ni un** header del
 * visitante — ni el `content-type`, que lo elige quien llama y por lo tanto no garantiza nada.
 *
 * ── PII: acá sí hay, y por eso no se loguea nada ──────────────────────────────────────────────
 * `wa_click_events` era "sin PII por diseño". Esto no: el body trae **nombre y teléfono** de una
 * persona real. Consecuencias que no son opcionales:
 * - **Cero `console.*`** en este archivo, ni siquiera en el `catch`. Un `console.error(err)` de
 *   postgres.js imprime la sentencia con sus parámetros, o sea el teléfono del visitante, en los
 *   logs de Vercel para siempre.
 * - Nada de esto llega a telemetría ni al contexto del chatbot. La única copia vive en la fila.
 *
 * ── Lo que NO se revalida ─────────────────────────────────────────────────────────────────────
 * Ni un `revalidateTag`. Un lead de canje no cambia un byte de la vidriera: no toca stock, ni
 * precio, ni estado de ninguna unidad. Purgar `storefront:{slug}` desde acá sería tirar el cache
 * de un tenant entero cada vez que alguien manda el formulario — y sería, además, una palanca de
 * denegación de servicio económico regalada a cualquier anónimo.
 */

/**
 * `303 See Other` con `Location` relativo y sin cuerpo.
 *
 * `no-store` explícito: es la respuesta a un POST, no la puede guardar nadie. Un CDN que cacheara
 * un `303` a `/canje/listo` le contestaría "entró" al próximo que mandara el formulario.
 */
function seeOther(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: { location, 'cache-control': 'no-store' },
  });
}

// El body canónico del formulario es ASCII percent-encodeado, así que el mismo presupuesto
// conserva los 6144 caracteres del parser y agrega el límite de bytes que faltaba en este borde.
const MAX_TRADEIN_BODY_BYTES = MAX_TRADEIN_BODY_CHARS;

/**
 * El cuerpo como texto, con techo de bytes antes de procesarlo.
 *
 * No se mira el `content-type`: el formulario manda `application/x-www-form-urlencoded`, pero el
 * tipo lo declara quien llama y no es una garantía. Lo que decide es si el texto parsea.
 */
async function readBody(request: Request): Promise<string> {
  const maxBytes = MAX_TRADEIN_BODY_BYTES;
  const contentLength = request.headers.get('content-length');

  // `Content-Length` es un dato no confiable: se valida antes de tocar el body y el stream se
  // vuelve a acotar abajo por si el header falta, miente o llega desde un proxy mal configurado.
  if (contentLength !== null) {
    if (!/^\d+$/u.test(contentLength)) return '';
    const declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maxBytes) return '';
  }

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

  try {
    const body = request.body;
    if (body === null) return '';

    reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return '';
      }
      chunks.push(value);
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
  } catch {
    // Un body roto o que no se pudo cancelar tiene que caer en el mismo reintento opaco que
    // cualquier otro input inválido. No se deja cruzar el error ni se loguea PII.
    return '';
  } finally {
    reader?.releaseLock();
  }
}

/**
 * El `insert`, como `anon`, pasando por la policy `tradein_leads_storefront_insert`.
 *
 * ── Las nueve columnas, que son exactamente el `GRANT` ────────────────────────────────────────
 * `drizzle/0008_storefront_tradein_lead_insert.sql` le da a `anon` INSERT sobre nueve columnas y
 * ninguna más. Por eso es **SQL crudo con lista de columnas explícita** y no el builder de
 * Drizzle sobre esa tabla: el builder nombra **todas** las columnas de
 * la tabla en el `INSERT`, así que un `values()` pediría escribir `status`, el precio ofrecido y el resto
 * —columnas que el privilegio no incluye a propósito— y Postgres contestaría `42501` por columnas
 * que ni siquiera queremos tocar. Está explicado en el docblock de `tenantPolicies` en
 * `packages/db/src/schema/rls.ts`.
 *
 * Las que faltan y por qué faltan: `id` / `created_at` / `updated_at` salen de sus defaults para
 * que no se puedan forjar; `status` sale de `'new'`, o sea que un `curl` **no puede** dejar un lead
 * ya aceptado y saltearse la evaluación del dueño; lo que el reseller ofrece pagar y sus notas
 * privadas son del panel (`CLAUDE.md` §0.9) y `created_listing_id` / `handled_by` los escribe el
 * lado autenticado cuando el dueño acepta.
 *
 * ── Por qué es `insert … select from tenants` y no `insert … values` ──────────────────────────
 * Dos cosas al precio de una sentencia, sin round-trip extra:
 * 1. **El `tenant_id` no se escribe acá**: sale de la fila de `tenants` que el claim resuelve. No
 *    hay ninguna expresión en este archivo que pueda producir el uuid de otro tenant.
 * 2. **`and t.accepts_trade_in`**: si el dueño no toma canje, no hay fila. La vidriera ya no le
 *    muestra el formulario, pero el formulario no es la defensa — un POST a mano se saltea la
 *    pantalla, no la sentencia. `select … from tenants` corre como `anon`, así que además pasa por
 *    `tenants_storefront_anon_select`: un tenant `suspended` tampoco existe como destino.
 *
 * ── El filtro explícito, además de RLS (`CLAUDE.md` §5) ───────────────────────────────────────
 * `where t.id = (select public.storefront_tenant_id())` es redundante con la policy de `tenants` y
 * con el `WITH CHECK` de `tradein_leads`, y se queda: si mañana alguien afloja una policy en un fix
 * apurado, la sentencia sigue acotada. Va en subquery (InitPlan) por ADR-005: se evalúa una vez por
 * query, no una vez por fila.
 *
 * ── Cómo se sabe si entró, sin `returning` ────────────────────────────────────────────────────
 * `anon` tiene INSERT y **cero SELECT** sobre `tradein_leads`: no lee ninguna fila, ni la que
 * acaba de dejar. Un `insert … returning id` recibiría `42501`, y la respuesta correcta no es
 * pedir un privilegio más — es confirmar sin el id. La cuenta de filas afectadas viene en el
 * `RowList` de postgres.js y alcanza: 1 = entró, 0 = no había tenant que tomara canje.
 */
async function record(slug: string, lead: TradeinLead): Promise<boolean> {
  return withStorefrontDb(slug, async (tx) => {
    const result = await tx.execute(sql`
      insert into tradein_leads (
        "tenant_id", "customer_name", "customer_wa_phone", "model_text",
        "storage_gb", "color", "declared_condition", "battery_pct", "notes"
      )
      select t.id,
             ${lead.customerName}::text,
             ${lead.customerWaPhone}::text,
             ${lead.modelText}::text,
             ${lead.storageGb}::integer,
             ${lead.color}::text,
             ${lead.declaredCondition}::listing_condition,
             ${lead.batteryPct}::integer,
             ${lead.notes}::text
      from tenants t
      where t.id = (select public.storefront_tenant_id())
        and t.accepts_trade_in
    `);

    return affectedRows(result) === 1;
  });
}

/**
 * Filas afectadas por la última sentencia. `postgres.js` las devuelve en `.count` del `RowList`
 * aunque el arreglo venga vacío (que es el caso: no hay `returning`).
 *
 * Se lee defensivamente y no por tipos: si una versión de driver dejara de traerlo, el valor sería
 * `0` y la persona vería "reintentá" en vez de una confirmación falsa. El modo de falla elegido es
 * el que no miente.
 */
function affectedRows(result: unknown): number {
  const count = (result as { count?: unknown }).count;
  return typeof count === 'number' ? count : 0;
}

/**
 * `POST` es el único método exportado. Un `GET` a esta ruta contesta **405** (lo emite Next), que
 * es lo que distingue "el handler está y rechazó" de "no hay handler" — y que además evita que
 * `/api/tradein` sea una URL que alguien pueda compartir por accidente.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  // El slug del path, escrito por el proxy desde el host. `isSlugShaped` es puro y no tira: un slug
  // con esta forma no puede existir en la base (`CHECK tenants_slug_format`), así que no hay nada
  // que consultar y no se abre conexión.
  const { slug } = await params;
  if (!isSlugShaped(slug)) return seeOther(TRADEIN_RETRY_PATH);

  const lead = parseTradeinBody(await readBody(request));
  if (lead === null) return seeOther(TRADEIN_RETRY_PATH);

  let stored = false;
  try {
    stored = await record(slug, lead);
  } catch {
    // Un rechazo de la policy (`42501`), un CHECK violado o una conexión caída terminan acá y NO
    // cruzan al cliente: ni el mensaje de Postgres, ni el status, ni una pista de cuál de los tres
    // fue. Tampoco se loguea: el error de postgres.js trae la sentencia con sus parámetros, o sea
    // el nombre y el teléfono de una persona real.
    stored = false;
  }

  return seeOther(stored ? TRADEIN_DONE_PATH : TRADEIN_RETRY_PATH);
}
