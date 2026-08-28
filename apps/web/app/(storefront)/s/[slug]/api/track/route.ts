import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { waClickSourceEnum } from '@istock/db';
import { isSlugShaped } from '../../../../_lib/host';
import { withStorefrontDb } from '../../../../_lib/storefront-db';

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  `POST {slug}.maat.work/api/track` — la ÚNICA escritura sin autenticar de todo el producto.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `proxy.ts` reescribe `{slug}.maat.work/api/track` → `/s/{slug}/api/track`, que es este archivo.
 * El handler vive en la ruta **reescrita** y no en `app/api/**` a propósito (decisión del LEAD):
 * un passthrough de `/api/**` en el proxy ensancharía la exposición de **toda** ruta de API bajo
 * los hosts de vidriera, para ganar un handler.
 *
 * ── De dónde sale el tenant, que es la slice entera ───────────────────────────────────────────
 * Del **segmento de path que escribió el proxy desde el host**, y de ningún otro lugar. Nunca de
 * un campo del pedido, nunca de un header. El `slug` llega como `params`, igual que en toda página
 * de vidriera, y se convierte en el claim `app_metadata.storefront_slug` dentro de
 * `withStorefrontDb()`. De ahí en más el que resuelve `slug → tenant` es Postgres
 * (`public.storefront_tenant_id()`, `security invoker`), no este archivo.
 *
 * Consecuencia práctica: este handler **no puede** escribir en la cuenta de otro aunque tenga un
 * bug, porque no conoce el uuid del tenant y no hay forma de que se lo digan. El `WITH CHECK` de
 * `wa_click_events_storefront_insert` lo vuelve a verificar en el planner en cada `insert`.
 *
 * ── Sin PII, y no por disciplina: no hay de dónde sacarla ─────────────────────────────────────
 * `wa_click_events` es "sin PII" **por diseño**: no se anonimiza, no se recibe. Este handler no
 * lee ni un solo header del visitante — ni el que trae la dirección de red, ni el que dice qué
 * navegador es, ni el `content-type` (por eso el cuerpo se parsea como texto: `sendBeacon` manda
 * `text/plain` y el tipo lo elige quien llama, así que no es dato en el que apoyarse).
 *
 * Tampoco hay contador de abuso propio: `CLAUDE.md` §2 prohíbe rate limiting con contador en
 * Postgres sobre la vidriera. El techo lo pone el WAF (`storefront-track-rl`, 60/min por IP en
 * `config/firewall-rules.json`), que es la capa que no cuesta una query.
 *
 * ── Por qué todas las respuestas son el MISMO 204 ─────────────────────────────────────────────
 * Es un beacon: `navigator.sendBeacon` no expone la respuesta a nadie, así que un status distinto
 * no informa a ningún cliente legítimo — sólo a quien esté probando. Y hay uno concreto que puede
 * probar: contestar distinto cuando el uuid de una ficha existe en OTRO tenant convertiría este
 * endpoint en un oráculo de pertenencia (`404` = no es tuyo, `204` = sí). Un 204 uniforme, sin
 * cuerpo, no distingue "escribí" de "no escribí" y no filtra el error de Postgres.
 *
 * La contrapartida está aceptada y escrita: **este endpoint es opaco para depurar**. Lo que dice
 * si funciona no es un log —loguear en el único endpoint sin autenticar es pagar por el flood del
 * atacante— sino la cuenta de filas: el e2e de `qa-agent` la mide y el panel la va a mostrar.
 */

/**
 * `id` y `created_at` **no están** y no pueden estar: quedan fuera del `GRANT` de columna de
 * `anon` (migración 0004), salen de sus defaults y por lo tanto no se forjan desde afuera.
 *
 * `.strict()` y no un objeto abierto: si el schema deja pasar lo que no nombra, cualquier campo
 * de más entra al scope del handler, y un campo que ya está adentro es un campo que alguien va a
 * querer guardar "total ya viene". La forma de esta tabla se decide en `packages/db`, no en un JSON que mandó el browser.
 *
 * `listingId` opcional a propósito: un click que no sale de ninguna ficha (el footer de la
 * vidriera, cuando exista) es legítimo y la policy lo contempla (`listing_id is null or …`).
 *
 * El enum sale de `waClickSourceEnum` de `@istock/db`, no de una copia escrita a mano acá: dos
 * listas del mismo enum es cómo una se queda vieja sin que nadie lo note.
 */
const beaconSchema = z
  .object({
    listingId: z.uuid().nullish(),
    source: z.enum(waClickSourceEnum.enumValues),
  })
  .strict();

type Beacon = z.infer<typeof beaconSchema>;

/**
 * Techo del cuerpo, en caracteres. Un beacon legítimo son ~90 bytes; 512 deja lugar para un campo
 * más sin dejar que nadie use este endpoint para hacernos parsear un megabyte por request.
 */
const MAX_BEACON_CHARS = 512;

/** Siempre la misma respuesta. Sin cuerpo: nadie la lee. */
function noContent(): Response {
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}

/**
 * El cuerpo, como texto y sin mirar el `content-type` (lo elige quien llama, así que no es una
 * garantía de nada). `null` = no hay nada parseable, y eso no es un error del que haya que
 * informar: es un 204 como todos los demás.
 */
async function readBeacon(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length === 0 || text.length > MAX_BEACON_CHARS) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * El `insert`, como `anon`, pasando por la policy.
 *
 * ── Por qué es `insert … select` y no `insert … values` ───────────────────────────────────────
 * Con `values`, un uuid de ficha ajena resolvería a `null` y la fila se escribiría igual con
 * `listing_id` vacío — pasaría el `WITH CHECK` por la rama del footer y le anotaría al atacante
 * una conversación que nadie tuvo. Con `select`, si la ficha no es de este tenant **no hay fila**:
 * cero filas insertadas, sin error y sin dato inventado.
 *
 * ── El filtro explícito, además de RLS (CLAUDE.md §5) ─────────────────────────────────────────
 * El `and l.tenant_id = (select public.storefront_tenant_id())` es redundante con la policy de
 * `listings` y con el `WITH CHECK` de `wa_click_events`, y se queda: si mañana alguien afloja una
 * policy en un fix apurado, la query sigue acotada. Va en subquery (InitPlan) por ADR-005.
 *
 * `select … from listings` corre como `anon`, o sea que además pasa por
 * `listings_storefront_anon_select`: una unidad en `draft`, o de un tenant `suspended`, no existe
 * como destino. Si no está publicada, no hay botón desde el cual apretar.
 *
 * Y no hay `returning`: `anon` tiene INSERT de tres columnas y **cero** SELECT sobre esta tabla
 * (migración 0004), así que un `returning id` recibiría `42501`. El beacon no necesita saber qué
 * escribió.
 */
async function record(slug: string, beacon: Beacon): Promise<void> {
  const listingId = beacon.listingId ?? null;

  await withStorefrontDb(slug, async (tx) => {
    if (listingId === null) {
      await tx.execute(sql`
        insert into wa_click_events ("tenant_id", "listing_id", "source")
        select claim.tid, null::uuid, ${beacon.source}::wa_click_source
        from (select (select public.storefront_tenant_id()) as tid) as claim
        where claim.tid is not null
      `);
      return;
    }

    await tx.execute(sql`
      insert into wa_click_events ("tenant_id", "listing_id", "source")
      select l.tenant_id, l.id, ${beacon.source}::wa_click_source
      from listings l
      where l.id = ${listingId}::uuid
        and l.tenant_id = (select public.storefront_tenant_id())
    `);
  });
}

/**
 * `POST` es el único método exportado, y eso también es una afirmación: un `GET` a esta ruta
 * contesta **405** (lo emite Next, no nosotros), que es lo que distingue "el handler está y
 * rechazó" de "no hay handler" sin depender de la forma del cuerpo.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  // El slug del path, escrito por el proxy desde el host. `isSlugShaped` es puro y no tira: un
  // slug con esta forma no puede existir en la base (`CHECK tenants_slug_format`), así que no hay
  // nada que consultar. Se contesta el mismo 204 que todo lo demás.
  const { slug } = await params;
  if (!isSlugShaped(slug)) return noContent();

  const parsed = beaconSchema.safeParse(await readBeacon(request));
  if (!parsed.success) return noContent();

  try {
    await record(slug, parsed.data);
  } catch {
    // Un rechazo de la policy (`42501`), una conexión caída o un uuid que no existe terminan acá y
    // NO cruzan al cliente: el visitante no recibe el mensaje de Postgres, ni por status ni por
    // cuerpo. Que la telemetría falle no puede cambiar en nada lo que ve quien está comprando.
  }

  return noContent();
}
