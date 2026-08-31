import { serverEnv } from '../../../(app)/_lib/env';
import { getPanelSession } from '../../../(app)/_lib/session';
import { logError } from '../../../(app)/_lib/log';
import { billingDriver, mpAccessToken, mpPreapprovalPlanId } from '../../_lib/env';
import { createHttpMercadoPagoClient } from '../../_lib/mercadopago/client';
import {
  buildBillingBackUrl,
  createSubscriptionCheckout,
  parseSubscriptionRequest,
} from '../../_lib/subscribe';

/**
 * `POST /billing/subscribe` — inicia el checkout hosteado de una suscripción.
 *
 * La identidad y el tenant salen de `getPanelSession()`, no del body. Sólo un dueño con negocio
 * puede llegar al proveedor. El body es un formulario estricto con un único campo `plan`.
 */

const NO_STORE = { 'cache-control': 'no-store' };

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status, headers: NO_STORE });
}

async function readPlan(request: Request): Promise<{ readonly plan: 'base' | 'negocio' } | null> {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';

  if (contentType.includes('application/json')) {
    try {
      return parseSubscriptionRequest(await request.json());
    } catch {
      return null;
    }
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return null;
  }

  const entries = [...formData.entries()];
  if (entries.length !== 1) return null;
  const [entry] = entries;
  if (entry === undefined || entry[0] !== 'plan' || typeof entry[1] !== 'string') return null;

  return parseSubscriptionRequest({ plan: entry[1] });
}

function report(event: string, code: string): void {
  // Sólo códigos operativos; jamás el error crudo, el mail, el token o la URL recibida de MP.
  logError(event, code, {});
}

export async function POST(request: Request): Promise<Response> {
  const session = await getPanelSession();
  if (session === null) return jsonError('Necesitás iniciar sesión.', 401);
  if (session.tenant === null || session.role === null) {
    return jsonError('Necesitás tener un negocio para contratar un plan.', 403);
  }
  if (session.role !== 'owner') return jsonError('No tenés permiso para gestionar la suscripción.', 403);

  const requested = await readPlan(request);
  if (requested === null) return jsonError('Elegí un plan válido.', 400);

  let accessToken: string | null;
  let preapprovalPlanId: string | null;
  let backUrl: string | null;
  try {
    if (billingDriver() !== 'mercadopago') {
      report('billing.subscription.misconfigured', 'driver_unavailable');
      return jsonError('El pago no está disponible en este momento.', 503);
    }

    accessToken = mpAccessToken();
    preapprovalPlanId = mpPreapprovalPlanId(requested.plan);
    backUrl = buildBillingBackUrl(serverEnv().NEXT_PUBLIC_APP_URL);
  } catch {
    report('billing.subscription.misconfigured', 'invalid_config');
    return jsonError('El pago no está disponible en este momento.', 503);
  }

  if (accessToken === null || preapprovalPlanId === null || backUrl === null) {
    report('billing.subscription.misconfigured', 'missing_config');
    return jsonError('El pago no está disponible en este momento.', 503);
  }

  const result = await createSubscriptionCheckout(
    {
      tenantId: session.tenant.id,
      plan: requested.plan,
      payerEmail: session.identity.email,
    },
    {
      client: createHttpMercadoPagoClient(accessToken),
      preapprovalPlanId,
      backUrl,
    },
  );

  if (!result.ok) {
    if (result.code === 'invalid_input') return jsonError('No pudimos validar la contratación.', 400);
    report('billing.subscription.provider_error', result.code);
    return jsonError('No pudimos iniciar el pago. Probá de nuevo en unos minutos.', 502);
  }

  return Response.redirect(result.initPoint, 303);
}
