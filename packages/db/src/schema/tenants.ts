/**
 * `tenants` — un reseller. **Unidad de aislamiento.** Todo dato de negocio cuelga de acá.
 *
 * Es la única tabla de negocio cuyo identificador de tenant es su propio `id`: no tiene
 * `tenant_id` que apunte a sí misma. Sus policies usan `id = <claim>` (ver `selfTenantPolicies`).
 */

import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, updatedAt } from './columns';
import { planTierEnum, tenantStatusEnum } from './enums';
import { selfTenantPolicies, storefrontAnonSelectPolicy, storefrontSlugClaim } from './rls';

export const tenants = pgTable(
  'tenants',
  {
    id: pk(),
    /** Subdominio: `{slug}.maat.work`. **Inmutable después del signup** (DOMAIN.md §Glosario). */
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    /** Teléfono del `wa.me`, sólo dígitos E.164 sin `+`. Es público por diseño: es el botón. */
    waPhone: text('wa_phone').notNull(),
    /** Medios de pago que se muestran en la ficha. Texto libre corto, español rioplatense. */
    paymentMethods: text('payment_methods').array().notNull().default(sql`'{}'::text[]`),
    acceptsTradeIn: boolean('accepts_trade_in').notNull().default(false),
    /** Preset inicial del formulario de reservas. Es configuración del panel, no dato público. */
    reservationMinutes: integer('reservation_minutes').notNull().default(60),
    plan: planTierEnum('plan').notNull().default('trial'),
    status: tenantStatusEnum('status').notNull().default('active'),
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
    /** Tenant de demostración (`/demo`): jamás se mezcla con datos reales (S13). */
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('tenants_slug_key').on(t.slug),
    index('tenants_status_idx').on(t.status),
    // El slug va en una URL y en un cache tag: si acepta cualquier cosa, acepta path traversal
    // y colisión de tags. El regex es el mismo que valida el proxy.
    check('tenants_slug_format', sql`slug ~ '^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$'`),
    check('tenants_wa_phone_digits', sql`wa_phone ~ '^[0-9]{8,15}$'`),
    check('tenants_reservation_minutes_options', sql`reservation_minutes in (30, 60, 90, 120)`),
    ...selfTenantPolicies('tenants'),
    // Vidriera anónima: el tenant SE RESUELVE por el slug del host, y sólo si está `active`.
    // Un tenant `suspended`/`cancelled` no tiene vidriera (misma regla que el DAL de storefront).
    // Sin claim de slug → NULL → cero filas: `anon` no puede listar la cartera de clientes.
    storefrontAnonSelectPolicy('tenants', sql`status = 'active' and slug = ${storefrontSlugClaim()}`),
  ],
).enableRLS();

/**
 * `tenant_id uuid not null references tenants(id) on delete cascade`. **No negociable**:
 * toda tabla de negocio la lleva, con índice y con RLS (CLAUDE.md §0.7, skill `drizzle-rls` §1).
 *
 * Vive acá y no en `columns.ts` para que la FK no arme un ciclo de imports con esta tabla.
 */
export const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' });
