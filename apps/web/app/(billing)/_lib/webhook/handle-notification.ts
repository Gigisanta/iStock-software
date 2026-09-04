import 'server-only';
import { logError, logEvent } from '../../../(app)/_lib/log';
import { decodeExternalReference } from '../mercadopago/external-reference';
import {
  parseNotificationBody,
  signedDataIdFromUrl,
  TOPIC_AUTHORIZED_PAYMENT,
  TOPIC_PREAPPROVAL,
  type MpNotification,
} from '../mercadopago/notification';
import { verifyWebhookSignature } from '../mercadopago/signature';
import type { MercadoPagoClient } from '../mercadopago/client';
import {
  applySubscriptionEvent,
  type SubscriptionEvent,
} from '../subscriptions/apply-event';
import { mapAuthorizedPaymentStatus, mapPreapprovalStatus } from '../subscriptions/status';
import type { BillingEventLedger } from './ledger';

/**
 * El webhook de Mercado Pago, entero, sin `Request` de Next y sin `process.env`.
 *
 * La ruta (`(billing)/billing/webhooks/mercadopago/route.ts`) arma las dependencias reales y
 * llama acá. Esta separación no es estética: permite entregar **el mismo evento dos veces** en un
 * test y contar efectos, que es la única forma de afirmar que el handler es idempotente. Un
 * comentario que dice "es idempotente" no es evidencia (ADR-020).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  EL CUERPO NO ESTÁ FIRMADO. Léase de nuevo.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * El manifiesto de MP es `id:<data.id de la QUERY>;request-id:<header>;ts:<header>;`. El body **no
 * entra en el HMAC**. O sea que una firma válida acredita el origen del *aviso*, no el contenido
 * de lo que el aviso dice.
 *
 * Consecuencia de diseño, y es la decisión más importante de este archivo: **del cuerpo no se
 * cree nada sobre el estado**. El cuerpo aporta dos cosas y nada más: el `id` del evento (clave de
 * deduplicación) y el `type`/`topic` (a qué endpoint ir). El estado —autorizada, pausada,
 * cancelada, cuánto, con qué medio de pago— se le pregunta a la API de MP con nuestro access
 * token. Un webhook que aplicara `body.status` sería un endpoint donde cualquiera que capture un
 * header viejo puede autorizarse un plan escribiendo un JSON. Esto vale también para el tópico
 * `payment`, que se resuelve con `GET /v1/payments/{id}`.
 *
 * Por lo mismo, el recurso a consultar sale **de la query** (`data.id`), que sí está firmado. Un
 * topic procesable sin ese dato se ignora: el `data.id` del cuerpo nunca autoriza una consulta.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Cuándo se responde qué
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * | situación | HTTP | por qué |
 * |---|---|---|
 * | firma inválida, ausente, vieja, o sin secreto configurado | 401 | no sabemos quién es |
 * | Content-Length inválido | 400 | el framing no es confiable |
 * | body por encima de 64 KiB | 413 | se rechaza antes de parsear |
 * | cuerpo ilegible | 400 | no hay evento que procesar |
 * | topic que no nos interesa, estado que no mapeamos, referencia ilegible | 200 | **no reintentar** |
 * | duplicado | 200 | ya estaba hecho |
 * | aplicado | 200 | |
 * | MP no contesta / la DB falla | 500 | **sí reintentar**, MP vuelve en 15 min |
 *
 * La fila que más cuesta entender es la del 200 en los casos "no lo entiendo": devolver 4xx haría
 * que MP reintente cada 15 minutos, para siempre, por un estado que agregaron ellos. Lo que se
 * hace es responder 200 y **loguearlo con nombre propio**, que es lo que se puede alertar.
 *
 * Y el 401 es **idéntico para los cinco motivos de fallo de firma**: el motivo va al log, no a la
 * respuesta. Mismo criterio que el handler del cron.
 */

export interface WebhookDeps {
  /** `null` = no hay secreto configurado. Con `null` no se autoriza a nadie: se falla cerrado. */
  readonly secret: string | null;
  readonly client: MercadoPagoClient;
  readonly ledger: BillingEventLedger;
  readonly now: () => Date;
}

export type WebhookOutcome =
  | 'unauthorized'
  | 'bad_request'
  | 'payload_too_large'
  | 'ignored_topic'
  | 'missing_resource'
  | 'unknown_resource'
  | 'unknown_status'
  | 'unknown_reference'
  | 'applied'
  | 'duplicate'
  | 'provider_error';

export interface WebhookResult {
  readonly status: number;
  readonly outcome: WebhookOutcome;
}

const PROVIDER = 'mercadopago';
/**
 * Las notificaciones de MP sólo llevan metadatos y `data.id`; no necesitamos megabytes para
 * procesarlas. El límite es deliberadamente holgado para el JSON del proveedor, pero finito para
 * que un request chunked tampoco pueda crecer sin límite antes del parseo.
 */
export const MAX_WEBHOOK_BODY_BYTES = 64 * 1024;

type ContentLength =
  | { readonly ok: true; readonly bytes: number | null }
  | { readonly ok: false };

type BodyReadResult =
  | { readonly ok: true; readonly raw: string }
  | { readonly ok: false; readonly reason: 'payload_too_large' | 'body_read_failed' };

/** Lo que se resuelve consultándole a MP, antes de tocar la base. */
type ResolvedEvent = { readonly event: SubscriptionEvent };

export async function handleWebhookNotification(request: Request, deps: WebhookDeps): Promise<WebhookResult> {
  // `Content-Length` no es una prueba suficiente: Vercel puede entregar el request chunked y el
  // header también es input no confiable. Primero usamos el dato sólo como rechazo temprano; si
  // falta o está dentro del límite, `readBodyUpToLimit` vuelve a imponer el cap sobre el stream.
  const contentLength = parseContentLength(request.headers.get('content-length'));
  if (!contentLength.ok) {
    logError('billing.webhook.rejected', 'invalid_content_length');
    return { status: 400, outcome: 'bad_request' };
  }

  const url = new URL(request.url);
  const signedDataId = signedDataIdFromUrl(url);
  const now = deps.now();

  const verdict = verifyWebhookSignature({
    signatureHeader: request.headers.get('x-signature'),
    requestId: request.headers.get('x-request-id'),
    dataId: signedDataId,
    secret: deps.secret,
    now,
  });

  if (!verdict.ok) {
    logError('billing.webhook.rejected', verdict.reason);
    return { status: 401, outcome: 'unauthorized' };
  }

  if (contentLength.bytes !== null && contentLength.bytes > MAX_WEBHOOK_BODY_BYTES) {
    logError('billing.webhook.rejected', 'payload_too_large');
    return { status: 413, outcome: 'payload_too_large' };
  }

  // La firma de MP no incluye el body, así que validar primero evita siquiera tocar el stream de
  // una entrega no autorizada. El body se lee UNA vez y viaja como string sólo después del HMAC.
  // `CLAUDE.md` §3 prohíbe reusar un `Request` con otro `init` (CVE-2026-64648).
  const body = await readBodyUpToLimit(request);
  if (!body.ok) {
    logError('billing.webhook.rejected', body.reason);
    return body.reason === 'payload_too_large'
      ? { status: 413, outcome: 'payload_too_large' }
      : { status: 400, outcome: 'bad_request' };
  }

  const parsed = parseNotificationBody(body.raw);
  if (!parsed.ok) {
    logError('billing.webhook.rejected', parsed.reason);
    return { status: 400, outcome: 'bad_request' };
  }

  const notification = parsed.notification;

  // MP recomienda activar también `payment`, pero el recurso `/v1/payments/{id}` no trae el
  // `preapproval_id` que sí identifica una cuota. `external_reference` es texto libre y no puede
  // habilitar un plan por sí solo; la autorización comercial queda exclusivamente en
  // `subscription_preapproval` y `subscription_authorized_payment`.
  if (
    notification.topic !== TOPIC_PREAPPROVAL &&
    notification.topic !== TOPIC_AUTHORIZED_PAYMENT
  ) {
    logEvent('billing.webhook.ignored', { topic: notification.topic, eventId: notification.eventId });
    return { status: 200, outcome: 'ignored_topic' };
  }

  if (signedDataId === null) {
    logError('billing.webhook.rejected', 'missing_signed_resource');
    return { status: 200, outcome: 'missing_resource' };
  }

  const resourceId = signedDataId;

  let resolved: ResolvedEvent | { readonly outcome: WebhookOutcome };
  try {
    resolved = await resolveEvent(deps.client, notification, resourceId, now);
  } catch (error) {
    // El error del proveedor NO se loguea crudo: el cuerpo de una respuesta de MP puede citar el
    // mail del pagador, y de ahí a Vercel logs es un paso. Se loguea el nombre.
    logError('billing.webhook.provider_error', errorCode(error), { topic: notification.topic });
    return { status: 500, outcome: 'provider_error' };
  }

  if (!('event' in resolved)) {
    logEvent('billing.webhook.skipped', {
      outcome: resolved.outcome,
      topic: notification.topic,
      eventId: notification.eventId,
    });
    return { status: 200, outcome: resolved.outcome };
  }

  let claim: 'applied' | 'duplicate';
  try {
    claim = await deps.ledger.claimAndApply(
      {
        tenantId: resolved.event.tenantId,
        provider: PROVIDER,
        eventId: notification.eventId,
        topic: notification.topic,
        action: notification.action,
        resourceId,
      },
      async (tx) => {
        await applySubscriptionEvent(tx, resolved.event);
      },
    );
  } catch (error) {
    logError('billing.webhook.apply_failed', errorCode(error), {
      tenantId: resolved.event.tenantId,
      topic: notification.topic,
    });
    // 500 a propósito: el evento quedó SIN reclamar (la transacción volvió atrás), así que el
    // reintento de MP en 15 minutos lo vuelve a intentar. Responder 200 acá sería perder un pago
    // en silencio, que es el modo de falla más caro de este archivo.
    return { status: 500, outcome: 'provider_error' };
  }

  logEvent('billing.webhook.processed', {
    outcome: claim,
    tenantId: resolved.event.tenantId,
    topic: notification.topic,
    status: resolved.event.status,
    eventId: notification.eventId,
  });

  return { status: 200, outcome: claim };
}

/**
 * Le pregunta a MP qué pasó de verdad y arma el efecto.
 *
 * La consulta al proveedor ocurre **antes** de reclamar el evento en el ledger, así que una
 * entrega duplicada cuesta una lectura extra a la API de MP. Es deliberado y es el intercambio
 * barato: la alternativa —reclamar primero y consultar adentro del efecto— metería una llamada de
 * red adentro de una transacción de Postgres, sosteniéndola abierta contra la latencia de un
 * tercero. Un `GET` de más no cobra dos veces; una transacción larga sí bloquea.
 */
async function resolveEvent(
  client: MercadoPagoClient,
  notification: MpNotification,
  resourceId: string,
  now: Date,
): Promise<ResolvedEvent | { readonly outcome: WebhookOutcome }> {
  if (notification.topic === TOPIC_PREAPPROVAL) {
    const preapproval = await client.getPreapproval(resourceId);
    if (preapproval === null) return { outcome: 'unknown_resource' };

    const mapping = mapPreapprovalStatus(preapproval.status);
    if (mapping === null) return { outcome: 'unknown_status' };

    const reference = decodeExternalReference(preapproval.externalReference);
    if (reference === null) return { outcome: 'unknown_reference' };

    return {
      event: {
        tenantId: reference.tenantId,
        plan: reference.plan,
        status: mapping.status,
        planEffect: mapping.planEffect,
        providerPreapprovalId: preapproval.id,
        externalReference: preapproval.externalReference,
        paymentMethod: preapproval.paymentMethodId,
        amountArsCents: preapproval.amountArsCents,
        currentPeriodEnd: parseDate(preapproval.nextPaymentDate),
        eventId: notification.eventId,
        occurredAt: now,
      },
    };
  }

  if (notification.topic === TOPIC_AUTHORIZED_PAYMENT) {
    const payment = await client.getAuthorizedPayment(resourceId);
    if (payment === null) return { outcome: 'unknown_resource' };

    let paymentStatus = payment.paymentStatus;
    let concretePayment: Awaited<ReturnType<MercadoPagoClient['getPayment']>> = null;
    if (paymentStatus === null && payment.paymentId !== null && payment.status.trim().toLowerCase() === 'processed') {
      concretePayment = await client.getPayment(payment.paymentId);
      paymentStatus = concretePayment?.status ?? null;
    }

    const mapping = mapAuthorizedPaymentStatus(payment.status, paymentStatus);
    if (mapping === null) return { outcome: 'unknown_status' };

    // La referencia existe en la factura según la API. Sólo se sube a la suscripción si falta:
    // así toleramos respuestas viejas sin pagar una lectura extra en el caso normal.
    let preapproval = null;
    let reference = decodeExternalReference(payment.externalReference);
    if (reference === null) {
      preapproval = await client.getPreapproval(payment.preapprovalId);
      if (preapproval === null) return { outcome: 'unknown_resource' };
      reference = decodeExternalReference(preapproval.externalReference);
    }
    if (reference === null) return { outcome: 'unknown_reference' };

    return {
      event: {
        tenantId: reference.tenantId,
        plan: reference.plan,
        status: mapping.status,
        planEffect: mapping.planEffect,
        providerPreapprovalId: preapproval?.id ?? payment.preapprovalId,
        externalReference: payment.externalReference ?? preapproval?.externalReference ?? null,
        paymentMethod: payment.paymentMethodId ?? concretePayment?.paymentMethodId ?? preapproval?.paymentMethodId ?? null,
        amountArsCents: payment.amountArsCents ?? concretePayment?.amountArsCents ?? null,
        currentPeriodEnd: parseDate(payment.nextPaymentDate ?? preapproval?.nextPaymentDate ?? null),
        eventId: notification.eventId,
        occurredAt: now,
      },
    };
  }

  return { outcome: 'ignored_topic' };
}

/** `null` ante cualquier fecha que no se entienda: una fecha inválida en una columna `timestamp` tira. */
function parseDate(raw: string | null): Date | null {
  if (raw === null) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** El nombre del error, nunca su mensaje. Los mensajes traen datos de la fila o del pagador. */
function errorCode(error: unknown): string {
  if (error instanceof Error) return error.name;
  return 'unknown_error';
}

/** `Content-Length` sólo sirve como fast-fail; el stream siempre se limita por separado. */
function parseContentLength(raw: string | null): ContentLength {
  if (raw === null) return { ok: true, bytes: null };
  if (!/^\d+$/.test(raw)) return { ok: false };

  const bytes = Number(raw);
  return Number.isSafeInteger(bytes) ? { ok: true, bytes } : { ok: false };
}

/**
 * Lee como máximo `MAX_WEBHOOK_BODY_BYTES` y un chunk adicional para detectar overflow. No usa
 * `request.text()`: esa API arma un string con todo el body antes de que podamos rechazarlo.
 */
async function readBodyUpToLimit(request: Request): Promise<BodyReadResult> {
  if (request.body === null) return { ok: true, raw: '' };

  const reader = request.body.getReader();
  const bytes = new Uint8Array(MAX_WEBHOOK_BODY_BYTES);
  let length = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) return { ok: false, reason: 'body_read_failed' };

      if (value.byteLength > MAX_WEBHOOK_BODY_BYTES - length) {
        try {
          await reader.cancel('webhook body exceeds limit');
        } catch {
          // El rechazo no depende de que el upstream acepte la cancelación.
        }
        return { ok: false, reason: 'payload_too_large' };
      }

      bytes.set(value, length);
      length += value.byteLength;
    }
  } catch {
    return { ok: false, reason: 'body_read_failed' };
  } finally {
    reader.releaseLock();
  }

  return { ok: true, raw: new TextDecoder().decode(bytes.subarray(0, length)) };
}
