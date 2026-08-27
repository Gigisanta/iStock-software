/** Columnas que se repiten en toda tabla. Un solo lugar donde se escriben. */

import { timestamp, uuid } from 'drizzle-orm/pg-core';

/** IDs: `uuid` con default. Timestamps: `timestamptz`. (`db-agent` §6) */
export const pk = () => uuid('id').primaryKey().defaultRandom();

export const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/**
 * `tenantId()` NO vive acá sino en `./tenants`, a propósito: si `columns.ts` importara `tenants`
 * y `tenants` importara `columns`, el ciclo revienta en tiempo de carga del schema.
 */
export const timestamps = () => ({ createdAt: createdAt(), updatedAt: updatedAt() });
