import { serverEnv } from '../../../(app)/_lib/env';
import { getPanelSession } from '../../../(app)/_lib/session';
import { logError } from '../../../(app)/_lib/log';
import { loadFxSettings } from '../../../(app)/_lib/tenants/queries';
import { billingDriver, mpAccessToken } from '../../_lib/env';
import {
  claimSubscriptionCheckout,
  completeSubscriptionCheckout,
  failSubscriptionCheckout,
} from '../../_lib/checkout-intents';
import { createHttpMercadoPagoClient } from '../../_lib/mercadopago/client';
import {
  buildBillingBackUrl,
  createSubscriptionCheckout,
  monthlySubscriptionAmountArsCents,
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

function checkoutStateResponse(
  request: Request,
  backUrl: string,
  state: 'en-curso' | 'otro-plan' | 'no-disponible' | 'verificar',
  message: string,
  status: number,
): Response {
  if (request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    return jsonError(message, status);
  }

  const location = new URL(backUrl);
  location.searchParams.set('checkout', state);
  return Response.redirect(location, 303);
}

function subscriptionErrorResponse(
  request: Request,
  backUrl: string | null,
  message: string,
  status: number,
): Response {
  if (backUrl === null) return jsonError(message, status);
  return checkoutStateResponse(request, backUrl, 'no-disponible', message, status);
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
  if (session.tenant.plan !== 'trial') {
    return jsonError('Tu negocio ya tiene una suscripción activa.', 409);
  }

  const requested = await readPlan(request);
  if (requested === null) return jsonError('Elegí un plan válido.', 400);

  let accessToken: string | null;
  let backUrl: string | null = null;
  try {
    backUrl = buildBillingBackUrl(serverEnv().NEXT_PUBLIC_APP_URL);
    if (billingDriver() !== 'mercadopago') {
      report('billing.subscription.misconfigured', 'driver_unavailable');
      return subscriptionErrorResponse(request, backUrl, 'El pago no está disponible en este momento.', 503);
    }

    accessToken = mpAccessToken();
  } catch {
    report('billing.subscription.misconfigured', 'invalid_config');
    return subscriptionErrorResponse(request, backUrl, 'El pago no está disponible en este momento.', 503);
  }

  if (accessToken === null || backUrl === null) {
    report('billing.subscription.misconfigured', 'missing_config');
    return subscriptionErrorResponse(request, backUrl, 'El pago no está disponible en este momento.', 503);
  }

  let fx: Awaited<ReturnType<typeof loadFxSettings>>;
  try {
    fx = await loadFxSettings({
      userId: session.identity.userId,
      tenantId: session.tenant.id,
      role: 'owner',
    });
  } catch {
    report('billing.subscription.misconfigured', 'fx_read_failed');
    return subscriptionErrorResponse(request, backUrl, 'El pago no está disponible en este momento.', 503);
  }
  const amountArsCents = fx === null ? null : monthlySubscriptionAmountArsCents(requested.plan, fx);
  if (amountArsCents === null) {
    report('billing.subscription.misconfigured', 'fx_unavailable');
    return subscriptionErrorResponse(request, backUrl, 'El pago no está disponible en este momento.', 503);
  }

  const tenantContext = {
    userId: session.identity.userId,
    tenantId: session.tenant.id,
    role: 'owner' as const,
  };

  let claim: Awaited<ReturnType<typeof claimSubscriptionCheckout>>;
  try {
    claim = await claimSubscriptionCheckout(tenantContext, {
      plan: requested.plan,
      amountArsCents,
    });
  } catch {
    report('billing.subscription.intent_failed', 'claim_failed');
    return checkoutStateResponse(
      request,
      backUrl,
      'no-disponible',
      'No pudimos preparar el pago. Probá de nuevo en unos minutos.',
      503,
    );
  }

  if (claim.kind === 'ready') return Response.redirect(claim.initPoint, 303);
  if (claim.kind === 'in_progress') {
    return checkoutStateResponse(
      request,
      backUrl,
      'en-curso',
      'Ya hay una contratación en curso para este negocio.',
      409,
    );
  }
  if (claim.kind === 'conflict') {
    return checkoutStateResponse(
      request,
      backUrl,
      'otro-plan',
      'Ya hay una contratación en curso para otro plan.',
      409,
    );
  }

  const result = await createSubscriptionCheckout(
    {
      tenantId: session.tenant.id,
      plan: requested.plan,
      payerEmail: session.identity.email,
    },
    {
      client: createHttpMercadoPagoClient(accessToken),
      backUrl,
      amountArsCents,
    },
  );

  if (!result.ok) {
    if (result.code === 'invalid_input' || result.code === 'provider_rejected') {
      try {
        await failSubscriptionCheckout(tenantContext, { intentId: claim.intentId });
      } catch {
        report('billing.subscription.intent_failed', 'release_failed');
      }
    }
    if (result.code === 'invalid_input') {
      return subscriptionErrorResponse(request, backUrl, 'No pudimos validar la contratación.', 400);
    }
    if (result.code === 'provider_uncertain') {
      const message =
        'No pudimos confirmar si el inicio del pago se completó. Esperá unos minutos antes de volver a intentar para evitar duplicar la suscripción.';
      report('billing.subscription.provider_uncertain', result.code);
      if (request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
        return jsonError(message, 503);
      }
      if (backUrl === null) return jsonError(message, 503);
      return checkoutStateResponse(request, backUrl, 'verificar', message, 503);
    }
    report('billing.subscription.provider_rejected', result.code);
    return subscriptionErrorResponse(
      request,
      backUrl,
      'No pudimos iniciar el pago. Probá de nuevo en unos minutos.',
      502,
    );
  }

  try {
    const completed = await completeSubscriptionCheckout(tenantContext, {
      intentId: claim.intentId,
      providerPreapprovalId: result.preapprovalId,
      initPoint: result.initPoint,
    });
    if (!completed) report('billing.subscription.intent_failed', 'complete_not_owned');
  } catch {
    // El preapproval ya existe en MP. Redirigimos igual para que la persona pueda terminarlo; el
    // webhook será la fuente de verdad para activar el plan y el incidente queda visible en logs.
    report('billing.subscription.intent_failed', 'complete_failed');
  }

  return Response.redirect(result.initPoint, 303);
}
