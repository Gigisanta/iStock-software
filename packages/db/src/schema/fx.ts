/**
 * `fx_settings` — el tipo de cambio **lo pone el dueño**, por tenant, a mano.
 * No hay API de dólar en el hot path (CLAUDE.md §1). Una fila por tenant.
 *
 * Guardado como `numeric(12, 2)` = pesos por USD; el código lo lee como **centavos de ARS
 * por USD** (`FxRate.arsCentsPerUsd` de `@istock/domain`). Ver `src/money.ts`.
 *
 * Cambiar el TC **revalida toda la vidriera del tenant** (`storefront:{slug}`). Eso es
 * responsabilidad de quien escribe, no de la DB, pero queda escrito acá porque olvidarlo
 * publica precios viejos.
 */

import { sql } from 'drizzle-orm';
import { index, pgTable, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { authUsers } from 'drizzle-orm/supabase';
import { moneyCents } from '../money';
import { createdAt, pk, updatedAt } from './columns';
import { tenantId } from './tenants';
import { fxRoundingModeEnum } from './enums';
import { storefrontAnonSelectPolicy, storefrontTenantId, tenantPolicies } from './rls';

export const fxSettings = pgTable(
  'fx_settings',
  {
    id: pk(),
    tenantId: tenantId(),
    /** ARS por 1 USD. En TS: centavos (`148750` = TC 1487,50). */
    arsPerUsd: moneyCents('ars_per_usd').notNull(),
    /** Default `ceil_1000`: así publica el reseller en la práctica (DOMAIN.md §FX). */
    rounding: fxRoundingModeEnum('rounding').notNull().default('ceil_1000'),
    updatedBy: uuid('updated_by').references(() => authUsers.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('fx_settings_tenant_idx').on(t.tenantId),
    uniqueIndex('fx_settings_tenant_key').on(t.tenantId),
    ...tenantPolicies('fx_settings'),
    // El TC del tenant: sin esto la ficha no puede mostrar ARS, que es requisito de aceptación.
    // `updated_by` (uuid de usuario) NO está en el GRANT de columnas.
    storefrontAnonSelectPolicy('fx_settings', sql`tenant_id = ${storefrontTenantId()}`),
  ],
).enableRLS();
