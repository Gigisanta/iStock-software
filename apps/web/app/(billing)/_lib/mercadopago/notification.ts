import { z } from 'zod';

/**
 * La forma de la notificación de Mercado Pago, parseada con Zod (`CLAUDE.md` §5: Zod en todos los
 * bordes, y un webhook es el borde más hostil que tenemos).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Enums TOLERANTES, a propósito
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `type`, `action` y los estados llegan como `string`, no como `z.enum`. No es pereza:
 * `docs/research/mp-subscriptions.md` documenta un 5º estado de cuota (`waiting for gateway`) que
 * aparece **sólo en la guía y no en el API reference**, y documenta que `payment.status` usa
 * `cancelled` (dos "l") mientras `preapproval.status` usa `canceled` (una). Un `z.enum` cerrado
 * convierte "MP agregó un estado" en "el webhook devuelve 400 y MP reintenta para siempre".
 *
 * La estrechez está del otro lado: el **mapeo** a nuestro `subscription_status` es exhaustivo y lo
 * que no reconoce se ignora explícitamente (`unknown_status`), que se loguea y se responde 200.
 * Un evento que no entendemos no es un error de MP y no se le pide que lo reintente.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Cuál es el `event_id` de la idempotencia
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * El `id` **del cuerpo**, que es el id de la notificación y el que MP repite cuando reintenta
 * (ADR-008, experimento 3: *"disparar el webhook dos veces con el mismo `id`"*). No es `data.id`,
 * que es el id del **recurso** —una misma suscripción genera N notificaciones a lo largo de su
 * vida y todas comparten `data.id`—: deduplicar por ahí sería procesar el primer evento de una
 * suscripción y descartar todos los siguientes, que es un modo de falla silencioso y peor.
 * Tampoco es `x-request-id`, que identifica el **envío** y no el evento.
 */

/** Topics del árbol de Suscripciones. Se acepta cualquier otro string y se ignora explícito. */
export const TOPIC_PREAPPROVAL = 'subscription_preapproval';
export const TOPIC_AUTHORIZED_PAYMENT = 'subscription_authorized_payment';
export const TOPIC_PREAPPROVAL_PLAN = 'subscription_preapproval_plan';

/** `123` y `"123"` son el mismo id. MP manda el del cuerpo como número y el de la query como texto. */
const idLike = z.union([z.string().trim().min(1), z.number().int()]).transform((v) => String(v));

const notificationBodySchema = z.object({
  id: idLike,
  /** El nombre moderno es `type`; el IPN viejo manda `topic`. Se aceptan los dos. */
  type: z.string().min(1).optional(),
  topic: z.string().min(1).optional(),
  action: z.string().min(1).optional(),
  live_mode: z.boolean().optional(),
  user_id: z.union([z.string(), z.number()]).optional(),
  api_version: z.string().optional(),
  date_created: z.string().optional(),
  data: z.object({ id: idLike }).optional(),
});

export interface MpNotification {
  /** Clave de idempotencia. Ver el encabezado. */
  readonly eventId: string;
  /** `subscription_preapproval` · `subscription_authorized_payment` · lo que venga. */
  readonly topic: string;
  /** `created` · `updated` · `null`. */
  readonly action: string | null;
  /** `data.id`: el recurso al que hay que ir a preguntarle el estado. */
  readonly resourceId: string | null;
  readonly liveMode: boolean | null;
}

export type NotificationParse =
  | { readonly ok: true; readonly notification: MpNotification }
  | { readonly ok: false; readonly reason: 'invalid_json' | 'invalid_shape' };

/**
 * Parsea el cuerpo crudo. **Recibe el texto, no un `Request`**, por dos motivos: la firma se
 * calcula sobre la URL y los headers y el cuerpo hay que leerlo una sola vez, y porque
 * `CLAUDE.md` §3 prohíbe reusar un `Request` con otro `init` (CVE-2026-64648) — el handler lee el
 * body una vez y pasa el string.
 */
export function parseNotificationBody(raw: string): NotificationParse {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }

  const parsed = notificationBodySchema.safeParse(json);
  if (!parsed.success) return { ok: false, reason: 'invalid_shape' };

  const body = parsed.data;
  const topic = body.type ?? body.topic;
  if (topic === undefined) return { ok: false, reason: 'invalid_shape' };

  return {
    ok: true,
    notification: {
      eventId: body.id,
      topic,
      action: body.action ?? null,
      resourceId: body.data?.id ?? null,
      liveMode: body.live_mode ?? null,
    },
  };
}

/**
 * El `data.id` que va al manifiesto de la firma sale de la **query**, no del cuerpo.
 *
 * MP lo manda como `data.id`; el IPN viejo manda `id`. Se aceptan los dos y se prefiere el
 * moderno. Devolver `null` cuando no hay ninguno es correcto: el manifiesto omite el segmento.
 */
export function signedDataIdFromUrl(url: URL): string | null {
  return url.searchParams.get('data.id') ?? url.searchParams.get('id');
}
