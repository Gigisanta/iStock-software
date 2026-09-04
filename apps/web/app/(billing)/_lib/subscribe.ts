import 'server-only';
import { z } from 'zod';
import { applyFx, fxRateFromArsCents, type FxRoundingMode } from '@istock/domain';
import type { MercadoPagoClient } from './mercadopago/client';
import { PAID_PLAN_TIERS, PLAN_CATALOG, type PaidPlanTier } from './plans';

/** El único input que llega desde la página de contratación. */
const subscriptionRequestSchema = z.object({ plan: z.enum(PAID_PLAN_TIERS) }).strict();

const checkoutInputSchema = z
  .object({
    tenantId: z.uuid(),
    plan: z.enum(PAID_PLAN_TIERS),
    payerEmail: z.email().max(254),
    backUrl: z.string().url(),
    amountArsCents: z.number().int().positive().safe(),
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
  readonly backUrl: string;
  /** Centavos ARS calculados desde `fx_settings` y congelados para este checkout. */
  readonly amountArsCents: number;
};

export type SubscriptionCheckoutResult =
  | { readonly ok: true; readonly preapprovalId: string; readonly initPoint: string }
  | { readonly ok: false; readonly code: 'invalid_input' | 'provider_rejected' | 'provider_uncertain' };

/**
 * Un 4xx definitivo permite liberar el intent: MP confirmó que no aceptó el request. Los demás
 * errores no permiten saber si el POST llegó a crear un preapproval; conservamos el lease para
 * que un reintento inmediato no pueda generar dos suscripciones.
 */
function isDefinitiveProviderRejection(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const candidate = error as { readonly name?: unknown; readonly status?: unknown };
  if (candidate.name !== 'MercadoPagoApiError' || typeof candidate.status !== 'number') return false;

  return candidate.status >= 400 && candidate.status < 500 && ![408, 409, 429].includes(candidate.status);
}

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
 * Calcula el importe que se manda a Mercado Pago en la primera adhesión.
 *
 * Mercado Pago factura en ARS; la lista comercial vive en USD. El tipo de cambio es el último
 * valor persistido por el job BCRA del tenant, nunca una llamada en el hot path ni un número del
 * navegador. El importe ARS queda fijado en la autorización que el dueño acepta en Mercado Pago:
 * MP debita automáticamente ese importe en cada ciclo. Si el precio de referencia cambia, se debe
 * comunicar y actualizar la autorización de forma explícita; no simulamos una conversión automática
 * que MP no hace.
 */
export function monthlySubscriptionAmountArsCents(
  plan: PaidPlanTier,
  fx: { readonly arsCentsPerUsd: number; readonly rounding: FxRoundingMode },
): number | null {
  try {
    return applyFx(
      PLAN_CATALOG[plan].monthlyUsdCents,
      fxRateFromArsCents(fx.arsCentsPerUsd),
      fx.rounding,
    );
  } catch {
    return null;
  }
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
    backUrl: deps.backUrl,
    amountArsCents: deps.amountArsCents,
  });
  if (!parsed.success) return { ok: false, code: 'invalid_input' };

  try {
    const result = await deps.client.createPreapproval({
      tenantId: parsed.data.tenantId,
      plan: parsed.data.plan,
      payerEmail: parsed.data.payerEmail,
      backUrl: parsed.data.backUrl,
      amountArsCents: parsed.data.amountArsCents,
    });

    // MP debe devolver un checkout HTTPS. No seguimos un valor vacío, relativo o de otro esquema.
    const initPoint = new URL(result.initPoint);
    if (result.preapprovalId.trim().length === 0 || initPoint.protocol !== 'https:') {
      // El preapproval pudo haberse creado antes de que la respuesta llegara incompleta.
      return { ok: false, code: 'provider_uncertain' };
    }

    return { ok: true, preapprovalId: result.preapprovalId, initPoint: initPoint.toString() };
  } catch (error) {
    // El error de MP puede contener mail u otros datos del pagador. El caller sólo recibe un código.
    return { ok: false, code: isDefinitiveProviderRejection(error) ? 'provider_rejected' : 'provider_uncertain' };
  }
}
