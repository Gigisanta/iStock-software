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
import { applySubscriptionEvent, type SubscriptionEvent } from '../subscriptions/apply-event';
import { mapAuthorizedPaymentStatus, mapPreapprovalStatus, type StatusMapping } from '../subscriptions/status';
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
 * header viejo puede autorizarse un plan escribiendo un JSON.
 *
 * Por lo mismo, el recurso a consultar sale **de la query** (`data.id`), que sí está firmado, y
 * sólo cae al `data.id` del cuerpo si la query no lo trae.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Cuándo se responde qué
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * | situación | HTTP | por qué |
 * |---|---|---|
 * | firma inválida, ausente, vieja, o sin secreto configurado | 401 | no sabemos quién es |
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

/** Lo que se resuelve consultándole a MP, antes de tocar la base. */
interface ResolvedEvent {
  readonly mapping: StatusMapping;
  readonly event: SubscriptionEvent;
}

export async function handleWebhookNotification(request: Request, deps: WebhookDeps): Promise<WebhookResult> {
  // El body se lee UNA vez y viaja como string. `CLAUDE.md` §3 prohíbe reusar un `Request` con
  // otro `init` (CVE-2026-64648), y además el stream sólo se puede consumir una vez.
  const raw = await request.text();
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

  const parsed = parseNotificationBody(raw);
  if (!parsed.ok) {
    logError('billing.webhook.rejected', parsed.reason);
    return { status: 400, outcome: 'bad_request' };
  }

  const notification = parsed.notification;
  const resourceId = signedDataId ?? notification.resourceId;

  if (notification.topic !== TOPIC_PREAPPROVAL && notification.topic !== TOPIC_AUTHORIZED_PAYMENT) {
    logEvent('billing.webhook.ignored', { topic: notification.topic, eventId: notification.eventId });
    return { status: 200, outcome: 'ignored_topic' };
  }

  if (resourceId === null) {
    logError('billing.webhook.rejected', 'missing_resource', { topic: notification.topic });
    return { status: 200, outcome: 'missing_resource' };
  }

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

  const { event } = resolved;

  let claim: 'applied' | 'duplicate';
  try {
    claim = await deps.ledger.claimAndApply(
      {
        tenantId: event.tenantId,
        provider: PROVIDER,
        eventId: notification.eventId,
        topic: notification.topic,
        action: notification.action,
        resourceId,
      },
      async (tx) => {
        await applySubscriptionEvent(tx, event);
      },
    );
  } catch (error) {
    logError('billing.webhook.apply_failed', errorCode(error), {
      tenantId: event.tenantId,
      topic: notification.topic,
    });
    // 500 a propósito: el evento quedó SIN reclamar (la transacción volvió atrás), así que el
    // reintento de MP en 15 minutos lo vuelve a intentar. Responder 200 acá sería perder un pago
    // en silencio, que es el modo de falla más caro de este archivo.
    return { status: 500, outcome: 'provider_error' };
  }

  logEvent('billing.webhook.processed', {
    outcome: claim,
    tenantId: event.tenantId,
    topic: notification.topic,
    status: event.status,
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
      mapping,
      event: {
        tenantId: reference.tenantId,
        plan: reference.plan,
        status: mapping.status,
        planEffect: mapping.planEffect,
        providerPreapprovalId: preapproval.id,
        externalReference: preapproval.externalReference,
        paymentMethod: preapproval.paymentMethodId,
        amountArsCents: null,
        currentPeriodEnd: parseDate(preapproval.nextPaymentDate),
        eventId: notification.eventId,
        occurredAt: now,
      },
    };
  }

  const payment = await client.getAuthorizedPayment(resourceId);
  if (payment === null) return { outcome: 'unknown_resource' };

  const mapping = mapAuthorizedPaymentStatus(payment.status);
  if (mapping === null) return { outcome: 'unknown_status' };

  // La cuota no trae `external_reference`: hay que subir a la suscripción para saber de quién es.
  // Es la segunda lectura y es inevitable — el puente MP → tenant vive en el `preapproval`.
  const preapproval = await client.getPreapproval(payment.preapprovalId);
  if (preapproval === null) return { outcome: 'unknown_resource' };

  const reference = decodeExternalReference(preapproval.externalReference);
  if (reference === null) return { outcome: 'unknown_reference' };

  return {
    mapping,
    event: {
      tenantId: reference.tenantId,
      plan: reference.plan,
      status: mapping.status,
      planEffect: mapping.planEffect,
      providerPreapprovalId: preapproval.id,
      externalReference: preapproval.externalReference,
      paymentMethod: payment.paymentMethodId ?? preapproval.paymentMethodId,
      amountArsCents: payment.amountArsCents,
      currentPeriodEnd: parseDate(payment.nextPaymentDate ?? preapproval.nextPaymentDate),
      eventId: notification.eventId,
      occurredAt: now,
    },
  };
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
