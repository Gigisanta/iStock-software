/**
 * Billing (FASE 6, ADR-008 **abierta**, bloqueada en B3).
 *
 * El schema no depende del experimento pendiente: `preapproval`, la máquina de estados y la
 * forma del webhook **no están en disputa**. Lo que falta verificar es si existe débito por CBU
 * y cuál es la comisión real — dos datos que no cambian estas columnas.
 *
 * `provider_event_id` con índice único es la **idempotencia del webhook**: MP reintenta, y un
 * handler que cobra dos veces es un bug de plata. La unicidad la garantiza el motor.
 */

import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { moneyCents } from '../money';
import { createdAt, pk, updatedAt } from './columns';
import { tenantId } from './tenants';
import { planTierEnum, subscriptionStatusEnum } from './enums';
import { ownerTenantPolicies } from './rls';

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: pk(),
    tenantId: tenantId(),
    provider: text('provider').notNull().default('mercadopago'),
    /** `preapproval.id` de MP. `null` durante el trial: el trial no toca MP. */
    providerPreapprovalId: text('provider_preapproval_id'),
    /** Puente MP → tenant. Experimento 4 de ADR-008 verifica que sobreviva el checkout hosteado. */
    externalReference: text('external_reference'),
    /** Último `id` de notificación procesado. Idempotencia del webhook. */
    lastProviderEventId: text('last_provider_event_id'),
    plan: planTierEnum('plan').notNull().default('trial'),
    status: subscriptionStatusEnum('status').notNull().default('trialing'),
    amountArs: moneyCents('amount_ars'),
    paymentMethod: text('payment_method'),
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('subscriptions_tenant_idx').on(t.tenantId),
    uniqueIndex('subscriptions_tenant_key').on(t.tenantId),
    uniqueIndex('subscriptions_preapproval_key').on(t.providerPreapprovalId),
    // MP/webhook es el único writer. El owner puede leer su estado; un seller no recibe
    // proveedor, importe, referencia ni estado de facturación desde Postgres.
    ...ownerTenantPolicies('subscriptions'),
  ],
).enableRLS();

/**
 * `entitlements` — qué puede hacer el tenant **hoy**. Se lee en el server, nunca en el cliente.
 * Plan `base`: el widget del chatbot **no existe en el DOM** (cero paywall mostrado al comprador
 * final: el comprador no es nuestro cliente).
 */
export const entitlements = pgTable(
  'entitlements',
  {
    id: pk(),
    tenantId: tenantId(),
    /** `chatbot` · `reservations` · `margin` · `pickup_points` · `import_csv` ... */
    feature: text('feature').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    /** Techo numérico donde aplica (ej: 3 puntos de retiro). `null` = sin techo. */
    limitValue: integer('limit_value'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('entitlements_tenant_idx').on(t.tenantId),
    uniqueIndex('entitlements_tenant_feature_key').on(t.tenantId, t.feature),
    // Los flags de acceso son control de billing. Sólo el owner puede consultarlos y ningún
    // usuario autenticado los muta; el webhook y el seed usan service_role.
    ...ownerTenantPolicies('entitlements'),
  ],
).enableRLS();

/**
 * Ledger idempotente del webhook de Mercado Pago. `provider_event_id` es global por proveedor:
 * no lleva tenant en la clave única, porque el mismo aviso nunca puede aplicarse dos veces aunque
 * el tenant del external_reference se resuelva de forma distinta.
 */
export const billingWebhookEvents = pgTable(
  'billing_webhook_events',
  {
    id: pk(),
    tenantId: tenantId(),
    provider: text('provider').notNull().default('mercadopago'),
    providerEventId: text('provider_event_id').notNull(),
    topic: text('topic').notNull(),
    action: text('action'),
    resourceId: text('resource_id'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('billing_webhook_events_tenant_idx').on(t.tenantId),
    uniqueIndex('billing_webhook_events_provider_event_key').on(t.provider, t.providerEventId),
    // No es una superficie del panel: las policies quedan explícitas, pero sólo service_role
    // tiene GRANT DML. El owner podrá consultar auditoría cuando el operador se lo autorice.
    ...ownerTenantPolicies('billing_webhook_events'),
  ],
).enableRLS();
