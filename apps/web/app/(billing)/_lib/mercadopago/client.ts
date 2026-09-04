import 'server-only';
import { z } from 'zod';
import { decimalToCents } from '@istock/db';
import { encodeExternalReference } from './external-reference';
import { PLAN_CATALOG, type PaidPlanTier } from '../plans';

/**
 * El cliente de Mercado Pago, como **puerto**: una interfaz, un mock que corre hoy y un driver
 * HTTP que ya tiene el contrato del checkout y queda pendiente de una corrida real de B3.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Qué está verificado y qué no — leer antes de afirmar nada de este archivo
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `docs/DECISIONS.md` ADR-008 está **abierta y bloqueada en B3**, y su research anuló cinco
 * afirmaciones. Este archivo se escribe con esa disciplina:
 *
 * - **VERIFICADO** (documentación oficial vigente): el producto es *Suscripciones* y los endpoints
 *   vigentes son `POST /preapproval_plan`, `POST /preapproval`, `PUT /preapproval/{id}`,
 *   `GET /authorized_payments/{id}` y `GET /v1/payments/{id}`. `preapproval` **no** migró a
 *   `/v1/orders`.
 * - **VERIFICADO por el LEAD**: el enum de `payment_method_id` de la **respuesta** de un pago de
 *   suscripción documenta `Debin_transfer` y `CVU`.
 * - **NO VERIFICADO, y por eso este archivo no lo afirma**: que se pueda **adherir** un CBU a un
 *   `preapproval`. El enum de la respuesta refuta el negativo; no prueba el positivo. Se establece
 *   intentándolo, que es el experimento 1 de ADR-008.
 * - **NO VERIFICADO**: la comisión. La FAQ oficial declara **tres** variables (provincia del
 *   domicilio, medio de pago que elige el cliente, plazo de acreditación). El "piso de USD 1,03
 *   por pagador por mes" está **condicionado, no medido**, y `cost-auditor` no lo usa como gate.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  La decisión de costo que sí se toma hoy: NO restringir medios de pago
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `CLAUDE.md` §3 pide **preferir débito/transferencia sobre tarjeta de crédito**, y la comisión de
 * MP es el mayor costo por tenant del producto — bastante más que toda la infra junta. La palanca
 * que MP ofrece es `payment_methods_allowed`, y la forma de usarla mal es obvia y cara: una lista
 * restrictiva escrita de memoria **deja afuera** el dinero en cuenta de MP y empuja a todos a
 * tarjeta de crédito, que es el medio caro.
 *
 * El checkout usa la variante oficial de suscripción sin plan asociado y pago pendiente. No
 * mandamos una lista de medios de pago: la selección la hace el pagador en Mercado Pago y así no
 * inventamos IDs ni cerramos la puerta al dinero en cuenta.
 */

/** Estado crudo de MP. `string` a propósito: ver el encabezado de `notification.ts`. */
export interface PreapprovalSnapshot {
  readonly id: string;
  /** `pending` · `authorized` · `paused` · `cancelled`. Tolerante. */
  readonly status: string;
  readonly externalReference: string | null;
  readonly preapprovalPlanId: string | null;
  /** `account_money` · `credit_card` · `debit_card` · `Debin_transfer` · `CVU` · lo que venga. */
  readonly paymentMethodId: string | null;
  /** Importe recurrente en ARS, en **centavos**. `null` si MP no lo informó. */
  readonly amountArsCents: number | null;
  /** ISO 8601 o `null`. Alimenta `subscriptions.current_period_end`. */
  readonly nextPaymentDate: string | null;
}

export interface AuthorizedPaymentSnapshot {
  readonly id: string;
  readonly preapprovalId: string;
  /** `scheduled` · `processed` · `recycling` · `cancelled` · `waiting for gateway`. Tolerante. */
  readonly status: string;
  /** Referencia de la suscripción; MP también la devuelve en la factura. */
  readonly externalReference: string | null;
  readonly paymentMethodId: string | null;
  /** Importe en ARS, en **centavos**. `null` si MP no lo informó. */
  readonly amountArsCents: number | null;
  readonly nextPaymentDate: string | null;
  /** Pago concreto generado por esta factura, si MP ya lo creó. */
  readonly paymentId: string | null;
  /** Estado del pago concreto; evita tratar como cobrada una cuota `processed` rechazada. */
  readonly paymentStatus: string | null;
}

export interface PaymentSnapshot {
  readonly id: string;
  /** `approved` · `authorized` · `rejected` · `cancelled` · lo que venga. Tolerante. */
  readonly status: string;
  readonly externalReference: string | null;
  readonly paymentMethodId: string | null;
  /** Importe en ARS, en **centavos**. `null` si MP no lo informó. */
  readonly amountArsCents: number | null;
}

export interface CreatePreapprovalInput {
  readonly tenantId: string;
  readonly plan: PaidPlanTier;
  readonly payerEmail: string;
  readonly backUrl: string;
  /** HTTPS callback for subscription status and recurring payment notifications. */
  readonly notificationUrl: string;
  /** Centavos ARS; se convierte a unidades sólo al cruzar el JSON de MP. */
  readonly amountArsCents: number;
}

export interface CreatePreapprovalResult {
  readonly preapprovalId: string;
  /** El `init_point` **de la suscripción** (`?preapproval_id=`), nunca el del plan. */
  readonly initPoint: string;
}

export interface MercadoPagoClient {
  getPreapproval(id: string): Promise<PreapprovalSnapshot | null>;
  getAuthorizedPayment(id: string): Promise<AuthorizedPaymentSnapshot | null>;
  getPayment(id: string): Promise<PaymentSnapshot | null>;
  createPreapproval(input: CreatePreapprovalInput): Promise<CreatePreapprovalResult>;
}

// ── Driver mock ────────────────────────────────────────────────────────────────────────────────

/**
 * Cliente en memoria. Es el driver **por defecto** mientras B3 esté abierto, y el que usan los
 * tests.
 *
 * No simula el negocio de MP: simula sus **respuestas**. La diferencia importa — un mock que
 * "aprueba pagos" inventaría una máquina de estados que no conocemos. Este devuelve lo que se le
 * sembró, y nada más. Sembrar es explícito: `seedPreapproval`, `seedAuthorizedPayment` o
 * `seedPayment`.
 */
export interface MockMercadoPagoClient extends MercadoPagoClient {
  seedPreapproval(snapshot: PreapprovalSnapshot): void;
  seedAuthorizedPayment(snapshot: AuthorizedPaymentSnapshot): void;
  seedPayment(snapshot: PaymentSnapshot): void;
  /** Cuántas veces se le preguntó a MP. El webhook debe preguntar **una vez por evento nuevo**. */
  readonly calls: { preapproval: number; authorizedPayment: number; payment: number; created: number };
}

export function createMockMercadoPagoClient(): MockMercadoPagoClient {
  const preapprovals = new Map<string, PreapprovalSnapshot>();
  const payments = new Map<string, AuthorizedPaymentSnapshot>();
  const standalonePayments = new Map<string, PaymentSnapshot>();
  const calls = { preapproval: 0, authorizedPayment: 0, payment: 0, created: 0 };

  return {
    calls,
    seedPreapproval(snapshot) {
      preapprovals.set(snapshot.id, snapshot);
    },
    seedAuthorizedPayment(snapshot) {
      payments.set(snapshot.id, snapshot);
    },
    seedPayment(snapshot) {
      standalonePayments.set(snapshot.id, snapshot);
    },
    async getPreapproval(id) {
      calls.preapproval += 1;
      return preapprovals.get(id) ?? null;
    },
    async getAuthorizedPayment(id) {
      calls.authorizedPayment += 1;
      return payments.get(id) ?? null;
    },
    async getPayment(id) {
      calls.payment += 1;
      return standalonePayments.get(id) ?? null;
    },
    async createPreapproval(input) {
      calls.created += 1;
      const preapprovalId = `mock-preapproval-${calls.created}`;
      preapprovals.set(preapprovalId, {
        id: preapprovalId,
        status: 'pending',
        externalReference: encodeExternalReference({ tenantId: input.tenantId, plan: input.plan }),
        preapprovalPlanId: null,
        paymentMethodId: null,
        amountArsCents: input.amountArsCents,
        nextPaymentDate: null,
      });
      return {
        preapprovalId,
        initPoint: `https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_id=${preapprovalId}`,
      };
    },
  };
}

// ── Driver HTTP ────────────────────────────────────────────────────────────────────────────────

const MP_API = 'https://api.mercadopago.com';
const MP_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Mercado Pago está fuera de nuestro proceso. Un socket que queda pendiente no puede consumir
 * indefinidamente la ejecución de una función serverless: el checkout debe fallar cerrado y
 * permitir reintentar, no quedar esperando hasta que Vercel mate la invocación.
 */
interface MercadoPagoHttpResponse {
  readonly response: Response;
  readonly body: unknown;
}

async function mercadoPagoFetch(input: string, init: RequestInit): Promise<MercadoPagoHttpResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MP_REQUEST_TIMEOUT_MS);

  try {
    // `fetch(url, init)`. No reutilizar un `Request` con otro init: la regla de seguridad del repo
    // exige que el signal viaje en la misma invocación que crea la request.
    const response = await fetch(input, { ...init, signal: controller.signal });
    // El timeout tiene que cubrir también el body: `fetch()` resuelve al recibir headers, pero
    // Mercado Pago todavía puede estar entregando el JSON en ese momento. No se lee un body de
    // error, porque puede contener datos del pagador y no participa del contrato del cliente.
    const body = response.ok ? await response.json() : null;
    return { response, body };
  } finally {
    clearTimeout(timeout);
  }
}

/** Los importes de MP vienen en unidades, no en centavos. `1234.56` → `123456`. */
function toCents(value: number | string | null | undefined): number | null {
  if (value === undefined || value === null) return null;
  try {
    if (typeof value === 'string') return decimalToCents(value);
    if (!Number.isFinite(value)) return null;
    const cents = Math.round(value * 100);
    return Number.isSafeInteger(cents) ? cents : null;
  } catch {
    return null;
  }
}

const preapprovalSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  status: z.string(),
  external_reference: z.union([z.string(), z.number()]).transform(String).nullish(),
  preapproval_plan_id: z.union([z.string(), z.number()]).transform(String).nullish(),
  payment_method_id: z.union([z.string(), z.number()]).nullish(),
  auto_recurring: z
    .object({ transaction_amount: z.union([z.string(), z.number()]).nullish() })
    .nullish(),
  next_payment_date: z.string().nullish(),
});

const authorizedPaymentSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  preapproval_id: z.union([z.string(), z.number()]).transform(String),
  status: z.string(),
  external_reference: z.union([z.string(), z.number()]).transform(String).nullish(),
  payment_method_id: z.union([z.string(), z.number()]).nullish(),
  transaction_amount: z.union([z.string(), z.number()]).nullish(),
  next_payment_date: z.string().nullish(),
  payment: z
    .object({
      id: z.union([z.string(), z.number()]).transform(String),
      status: z.string(),
    })
    .nullish(),
});

const paymentSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  status: z.string(),
  external_reference: z.union([z.string(), z.number()]).transform(String).nullish(),
  payment_method_id: z.union([z.string(), z.number()]).nullish(),
  transaction_amount: z.union([z.string(), z.number()]).nullish(),
});

const createdPreapprovalSchema = preapprovalSchema.extend({ init_point: z.string() });

export class MercadoPagoApiError extends Error {
  constructor(
    readonly status: number,
    readonly endpoint: string,
  ) {
    // Sin cuerpo de MP en el mensaje: la respuesta de error puede citar el mail del pagador, y
    // esto termina en los logs de Vercel para siempre (`CLAUDE.md` §2).
    super(`Mercado Pago respondió ${status} en ${endpoint}`);
    this.name = 'MercadoPagoApiError';
  }
}

/**
 * Driver HTTP real. La forma del request sigue el flujo oficial de suscripción sin plan asociado
 * y pago pendiente; igual necesita un cobro real con una cuenta de prueba para verificar medios,
 * trial y notificaciones.
 *
 * Está escrito y no diferido porque la alternativa —una interfaz con un solo mock detrás— no es
 * revisable: no se puede discutir si el mapeo de campos está bien si el mapeo no existe. Lo que
 * **no** hace es prometer un cobro real sin credenciales. El día de B3 se corre contra una cuenta
 * de prueba y lo que falle se corrige acá, con el shape de Zod como red: un campo que MP renombró
 * rompe en el borde, no seis capas abajo.
 */
export function createHttpMercadoPagoClient(accessToken: string): MercadoPagoClient {
  async function get<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
    const result = await mercadoPagoFetch(`${MP_API}${path}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    });
    if (result.response.status === 404) return null;
    if (!result.response.ok) throw new MercadoPagoApiError(result.response.status, path);
    return schema.parse(result.body);
  }

  return {
    async getPreapproval(id) {
      const raw = await get(`/preapproval/${encodeURIComponent(id)}`, preapprovalSchema);
      if (raw === null) return null;
      return {
        id: raw.id,
        status: raw.status,
        externalReference: raw.external_reference ?? null,
        preapprovalPlanId: raw.preapproval_plan_id ?? null,
        paymentMethodId: raw.payment_method_id === null || raw.payment_method_id === undefined ? null : String(raw.payment_method_id),
        amountArsCents: toCents(raw.auto_recurring?.transaction_amount),
        nextPaymentDate: raw.next_payment_date ?? null,
      };
    },

    async getAuthorizedPayment(id) {
      const raw = await get(`/authorized_payments/${encodeURIComponent(id)}`, authorizedPaymentSchema);
      if (raw === null) return null;
      return {
        id: raw.id,
        preapprovalId: raw.preapproval_id,
        status: raw.status,
        externalReference: raw.external_reference ?? null,
        paymentMethodId: raw.payment_method_id === null || raw.payment_method_id === undefined ? null : String(raw.payment_method_id),
        amountArsCents: toCents(raw.transaction_amount),
        nextPaymentDate: raw.next_payment_date ?? null,
        paymentId: raw.payment?.id ?? null,
        paymentStatus: raw.payment?.status ?? null,
      };
    },

    async getPayment(id) {
      const raw = await get(`/v1/payments/${encodeURIComponent(id)}`, paymentSchema);
      if (raw === null) return null;
      return {
        id: raw.id,
        status: raw.status,
        externalReference: raw.external_reference ?? null,
        paymentMethodId: raw.payment_method_id === null || raw.payment_method_id === undefined ? null : String(raw.payment_method_id),
        amountArsCents: toCents(raw.transaction_amount),
      };
    },

    async createPreapproval(input) {
      if (!Number.isSafeInteger(input.amountArsCents) || input.amountArsCents <= 0) {
        throw new Error('importe ARS inválido');
      }

      const body: Record<string, unknown> = {
        reason: `MaatWork ${PLAN_CATALOG[input.plan].label}`,
        external_reference: encodeExternalReference({ tenantId: input.tenantId, plan: input.plan }),
        payer_email: input.payerEmail,
        back_url: input.backUrl,
        notification_url: input.notificationUrl,
        auto_recurring: {
          frequency: 1,
          frequency_type: 'months',
          transaction_amount: Number((input.amountArsCents / 100).toFixed(2)),
          currency_id: 'ARS',
        },
        status: 'pending',
      };

      const result = await mercadoPagoFetch(`${MP_API}/preapproval`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!result.response.ok) throw new MercadoPagoApiError(result.response.status, '/preapproval');

      const raw = createdPreapprovalSchema.parse(result.body);
      return { preapprovalId: raw.id, initPoint: raw.init_point };
    },
  };
}
