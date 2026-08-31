import 'server-only';
import { z } from 'zod';
import type { MercadoPagoClient } from './mercadopago/client';
import { PAID_PLAN_TIERS } from './plans';

/** El único input que llega desde la página de contratación. */
const subscriptionRequestSchema = z.object({ plan: z.enum(PAID_PLAN_TIERS) }).strict();

const checkoutInputSchema = z
  .object({
    tenantId: z.uuid(),
    plan: z.enum(PAID_PLAN_TIERS),
    payerEmail: z.email().max(254),
    preapprovalPlanId: z.string().trim().min(1),
    backUrl: z.string().url(),
  })
  .strict();

export type SubscriptionRequest = { readonly plan: (typeof PAID_PLAN_TIERS)[number] };

export type SubscriptionCheckoutInput = {
  readonly tenantId: string;
  readonly plan: string;
  readonly payerEmail: string;
};

export type SubscriptionCheckoutDeps = {
  readonly client: Pick<MercadoPagoClient, 'createPreapproval'>;
  readonly preapprovalPlanId: string;
  readonly backUrl: string;
};

export type SubscriptionCheckoutResult =
  | { readonly ok: true; readonly initPoint: string }
  | { readonly ok: false; readonly code: 'invalid_input' | 'provider_error' };

/**
 * Valida el cuerpo completo. `strict()` importa: el endpoint no acepta un tenant, mail o URL
 * dictados por el navegador, sólo el plan. Todo lo demás sale de la sesión o de configuración
 * server-side.
 */
export function parseSubscriptionRequest(body: unknown): SubscriptionRequest | null {
  const parsed = subscriptionRequestSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

/**
 * URL de retorno construida desde configuración confiable, nunca desde `Request.url` o headers.
 * HTTPS es obligatorio fuera de hosts locales de desarrollo.
 */
export function buildBillingBackUrl(appUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(appUrl);
  } catch {
    return null;
  }

  const localHost =
    parsed.hostname === 'localhost' ||
    parsed.hostname === '::1' ||
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname.endsWith('.localhost') ||
    parsed.hostname.endsWith('.nip.io');

  if (parsed.username !== '' || parsed.password !== '') return null;
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && localHost)) return null;

  return new URL('/billing', parsed).toString();
}

/**
 * Orquestación del alta. El cliente HTTP agrega el `external_reference` existente
 * (`istock:v1:<tenantId>:<plan>`) dentro de `createPreapproval()`; acá no se duplica ese codec.
 */
export async function createSubscriptionCheckout(
  input: SubscriptionCheckoutInput,
  deps: SubscriptionCheckoutDeps,
): Promise<SubscriptionCheckoutResult> {
  const parsed = checkoutInputSchema.safeParse({
    ...input,
    preapprovalPlanId: deps.preapprovalPlanId,
    backUrl: deps.backUrl,
  });
  if (!parsed.success) return { ok: false, code: 'invalid_input' };

  try {
    const result = await deps.client.createPreapproval({
      tenantId: parsed.data.tenantId,
      plan: parsed.data.plan,
      preapprovalPlanId: parsed.data.preapprovalPlanId,
      payerEmail: parsed.data.payerEmail,
      backUrl: parsed.data.backUrl,
    });

    // MP debe devolver un checkout HTTPS. No seguimos un valor vacío, relativo o de otro esquema.
    const initPoint = new URL(result.initPoint);
    if (initPoint.protocol !== 'https:') return { ok: false, code: 'provider_error' };

    return { ok: true, initPoint: initPoint.toString() };
  } catch {
    // El error de MP puede contener mail u otros datos del pagador. El caller sólo recibe un código.
    return { ok: false, code: 'provider_error' };
  }
}
