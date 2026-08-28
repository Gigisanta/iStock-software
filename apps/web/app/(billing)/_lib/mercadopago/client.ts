import 'server-only';
import { z } from 'zod';
import { encodeExternalReference } from './external-reference';
import type { PaidPlanTier } from '../plans';

/**
 * El cliente de Mercado Pago, como **puerto**: una interfaz, un mock que corre hoy y un driver
 * HTTP que no se puede ejercer hasta que aterrice B3.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Qué está verificado y qué no — leer antes de afirmar nada de este archivo
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `docs/DECISIONS.md` ADR-008 está **abierta y bloqueada en B3**, y su research anuló cinco
 * afirmaciones. Este archivo se escribe con esa disciplina:
 *
 * - **VERIFICADO** (changelog oficial, abril 2026): el producto es *Suscripciones* y los endpoints
 *   vigentes son `POST /preapproval_plan`, `POST /preapproval`, `PUT /preapproval/{id}` y
 *   `GET /authorized_payments/{id}`. `preapproval` **no** migró a `/v1/orders`.
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
 * Por eso `createPreapproval` **no manda `payment_methods_allowed` salvo que el llamador lo pida**.
 * No restringir es lo que deja disponible el medio barato. La preferencia se ejerce donde no
 * cuesta nada equivocarse: en el copy de la pantalla de pago, que recomienda dinero en cuenta.
 * Cuando el experimento 1 diga qué se puede adherir de verdad, la lista se escribe **con dato**.
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
  /** ISO 8601 o `null`. Alimenta `subscriptions.current_period_end`. */
  readonly nextPaymentDate: string | null;
}

export interface AuthorizedPaymentSnapshot {
  readonly id: string;
  readonly preapprovalId: string;
  /** `scheduled` · `processed` · `recycling` · `cancelled` · `waiting for gateway`. Tolerante. */
  readonly status: string;
  readonly paymentMethodId: string | null;
  /** Importe en ARS, en **centavos**. `null` si MP no lo informó. */
  readonly amountArsCents: number | null;
  readonly nextPaymentDate: string | null;
}

export interface CreatePreapprovalInput {
  readonly tenantId: string;
  readonly plan: PaidPlanTier;
  readonly preapprovalPlanId: string;
  readonly payerEmail: string;
  readonly backUrl: string;
  /**
   * Ver el encabezado: por default **no se manda**. Existe para el día que el experimento 1 diga
   * qué ids se pueden adherir de verdad.
   */
  readonly paymentMethodsAllowed?: readonly string[];
}

export interface CreatePreapprovalResult {
  readonly preapprovalId: string;
  /** El `init_point` **de la suscripción** (`?preapproval_id=`), nunca el del plan. */
  readonly initPoint: string;
}

export interface MercadoPagoClient {
  getPreapproval(id: string): Promise<PreapprovalSnapshot | null>;
  getAuthorizedPayment(id: string): Promise<AuthorizedPaymentSnapshot | null>;
  createPreapproval(input: CreatePreapprovalInput): Promise<CreatePreapprovalResult>;
}

// ── Driver mock ────────────────────────────────────────────────────────────────────────────────

/**
 * Cliente en memoria. Es el driver **por defecto** mientras B3 esté abierto, y el que usan los
 * tests.
 *
 * No simula el negocio de MP: simula sus **respuestas**. La diferencia importa — un mock que
 * "aprueba pagos" inventaría una máquina de estados que no conocemos. Este devuelve lo que se le
 * sembró, y nada más. Sembrar es explícito: `seedPreapproval` / `seedAuthorizedPayment`.
 */
export interface MockMercadoPagoClient extends MercadoPagoClient {
  seedPreapproval(snapshot: PreapprovalSnapshot): void;
  seedAuthorizedPayment(snapshot: AuthorizedPaymentSnapshot): void;
  /** Cuántas veces se le preguntó a MP. El webhook debe preguntar **una vez por evento nuevo**. */
  readonly calls: { preapproval: number; authorizedPayment: number; created: number };
}

export function createMockMercadoPagoClient(): MockMercadoPagoClient {
  const preapprovals = new Map<string, PreapprovalSnapshot>();
  const payments = new Map<string, AuthorizedPaymentSnapshot>();
  const calls = { preapproval: 0, authorizedPayment: 0, created: 0 };

  return {
    calls,
    seedPreapproval(snapshot) {
      preapprovals.set(snapshot.id, snapshot);
    },
    seedAuthorizedPayment(snapshot) {
      payments.set(snapshot.id, snapshot);
    },
    async getPreapproval(id) {
      calls.preapproval += 1;
      return preapprovals.get(id) ?? null;
    },
    async getAuthorizedPayment(id) {
      calls.authorizedPayment += 1;
      return payments.get(id) ?? null;
    },
    async createPreapproval(input) {
      calls.created += 1;
      const preapprovalId = `mock-preapproval-${calls.created}`;
      preapprovals.set(preapprovalId, {
        id: preapprovalId,
        status: 'pending',
        externalReference: encodeExternalReference({ tenantId: input.tenantId, plan: input.plan }),
        preapprovalPlanId: input.preapprovalPlanId,
        paymentMethodId: null,
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

/** Los importes de MP vienen en unidades, no en centavos. `1234.56` → `123456`. */
function toCents(value: number | null | undefined): number | null {
  if (value === undefined || value === null || !Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

const preapprovalSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  status: z.string(),
  external_reference: z.string().nullish(),
  preapproval_plan_id: z.string().nullish(),
  payment_method_id: z.union([z.string(), z.number()]).nullish(),
  next_payment_date: z.string().nullish(),
});

const authorizedPaymentSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  preapproval_id: z.union([z.string(), z.number()]).transform(String),
  status: z.string(),
  payment_method_id: z.union([z.string(), z.number()]).nullish(),
  transaction_amount: z.number().nullish(),
  next_payment_date: z.string().nullish(),
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
 * Driver HTTP real. **No se ejerció nunca**: B3 (sandbox + app + secret) es un blocker humano
 * abierto y las credenciales de *test* de MP sólo existen para Checkout API y Bricks, así que
 * probar Suscripciones exige credenciales de producción de una cuenta de prueba.
 *
 * Está escrito y no diferido porque la alternativa —una interfaz con un solo mock detrás— no es
 * revisable: no se puede discutir si el mapeo de campos está bien si el mapeo no existe. Lo que
 * **no** hace es prometer que anda. El día de B3 se corre contra sandbox y lo que falle se
 * corrige acá, con el shape de Zod como red: un campo que MP renombró rompe en el borde, no seis
 * capas abajo.
 */
export function createHttpMercadoPagoClient(accessToken: string): MercadoPagoClient {
  async function get<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
    // `fetch(url, init)`. NUNCA `fetch(new Request(...), otroInit)`: es el disparador de
    // CVE-2026-64648 y `CLAUDE.md` §3 lo prohíbe como regla de código.
    const response = await fetch(`${MP_API}${path}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new MercadoPagoApiError(response.status, path);
    return schema.parse(await response.json());
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
        paymentMethodId: raw.payment_method_id === null || raw.payment_method_id === undefined ? null : String(raw.payment_method_id),
        amountArsCents: toCents(raw.transaction_amount),
        nextPaymentDate: raw.next_payment_date ?? null,
      };
    },

    async createPreapproval(input) {
      const body: Record<string, unknown> = {
        preapproval_plan_id: input.preapprovalPlanId,
        payer_email: input.payerEmail,
        back_url: input.backUrl,
        external_reference: encodeExternalReference({ tenantId: input.tenantId, plan: input.plan }),
        status: 'pending',
      };
      // Ver el encabezado: por default NO se restringe. Restringir mal es empujar a tarjeta.
      if (input.paymentMethodsAllowed !== undefined) {
        body.payment_methods_allowed = input.paymentMethodsAllowed;
      }

      const response = await fetch(`${MP_API}/preapproval`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new MercadoPagoApiError(response.status, '/preapproval');

      const raw = createdPreapprovalSchema.parse(await response.json());
      return { preapprovalId: raw.id, initPoint: raw.init_point };
    },
  };
}
