/**
 * `reservations` y `sales`.
 *
 * Reserva: 30–120 min, default 60, entitlement `reservations` (plan `negocio`).
 * **Una unidad tiene como máximo una reserva activa** — y eso no se defiende con un `if` en el
 * server sino con un índice único parcial: dos requests concurrentes contra el mismo listing
 * pasan los dos por el `if` y sólo uno pasa por el índice.
 */

import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { authUsers } from 'drizzle-orm/supabase';
import { moneyCents } from '../money';
import { createdAt, pk, updatedAt } from './columns';
import { tenantId } from './tenants';
import { reservationStatusEnum } from './enums';
import { listings } from './listings';
import { ownerReadSellerInsertPolicies, tenantPolicies } from './rls';

export const reservations = pgTable(
  'reservations',
  {
    id: pk(),
    tenantId: tenantId(),
    listingId: uuid('listing_id').notNull(),
    status: reservationStatusEnum('status').notNull().default('active'),
    minutes: integer('minutes').notNull().default(60),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Etiqueta corta que escribe el dueño ("Juan de Cipolletti"). No es un CRM. */
    customerLabel: text('customer_label'),
    createdBy: uuid('created_by').references(() => authUsers.id, { onDelete: 'set null' }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    /**
     * Cuántas veces el barrido de expiración intentó cerrar ESTA reserva y falló.
     *
     * No es telemetría: es la memoria que le faltaba al cron. El barrido toma
     * `status='active' and expires_at <= now() order by expires_at asc limit 200`, y una fila que
     * hace rollback queda `active` con el **mismo `expires_at`** — o sea vuelve a ser la primera
     * de la próxima corrida, para siempre, tapando a las que sí podían vencer. Sin una columna
     * donde anotar el intento, el barrido no tiene forma de saber que ya la vio.
     *
     * El modo de falla real no son 200 filas rotas independientes: es una causa sistémica que las
     * envenena a todas de una (un `GRANT` faltante → `42501`, un check nuevo en `listing_events`).
     * Con dos filas debidas y las dos fallando ya no vence nada de nadie, y el endpoint sigue
     * devolviendo `200 OK`. Este contador es lo que hace visible esa clase entera.
     *
     * **Quién la escribe: sólo el cron (`service_role`). Nadie más, y eso lo sostienen las dos
     * capas de `drizzle/0006_reservations_sweep_attempts.sql`, cada una donde sirve:**
     *
     *   · **UPDATE → `GRANT` por columna.** `authenticated` tiene UPDATE de las otras 11 columnas
     *     y no de ésta: un `update reservations set sweep_attempts = 999` desde el panel no
     *     "filtra de más", da `42501`. Es la mitad cara —forjar el contador *después*, sobre una
     *     reserva viva, para que el barrido la saltee para siempre—.
     *   · **INSERT → `with check` de la policy.** El `GRANT` de INSERT queda a nivel de TABLA y la
     *     policy exige `sweep_attempts = 0`. No es una preferencia de estilo: Drizzle, en
     *     `insert().values()`, NOMBRA todas las columnas y pone `default` en las que no le pasaste,
     *     y Postgres pide el privilegio sobre cada columna nombrada aunque el valor sea `DEFAULT`.
     *     Sacar la columna del GRANT de INSERT no impide elegirla: impide crear reservas. Con la
     *     policy, el seller que mande `sweep_attempts = 7` recibe `new row violates row-level
     *     security policy` y el que no la mande entra con su `default 0`.
     *
     * `anon` no tiene ningún privilegio sobre `reservations`: la vidriera no la ve ni la escribe.
     *
     * El consumo (a quién saltea el barrido, con qué techo, y si eso se ordena o se filtra) es de
     * `app-agent` y no está acá: esta columna es sólo el lugar donde anotar.
     */
    sweepAttempts: integer('sweep_attempts').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('reservations_tenant_idx').on(t.tenantId),
    // Target único para la FK compuesta de `sales.reservation_id`.
    uniqueIndex('reservations_tenant_id_key').on(t.tenantId, t.id),
    index('reservations_tenant_status_idx').on(t.tenantId, t.status, t.expiresAt),
    // El cron de expiración barre por `expires_at` sin filtro de tenant (corre como service_role).
    index('reservations_active_expiry_idx').on(t.expiresAt).where(sql`status = 'active'`),
    // La invariante "máximo una reserva activa por unidad", en el motor y no en el código.
    uniqueIndex('reservations_one_active_per_listing')
      .on(t.tenantId, t.listingId)
      .where(sql`status = 'active'`),
    check('reservations_minutes_range', sql`minutes between 30 and 120`),
    // Un contador de intentos que puede ir a negativo no es un contador: es una forma de
    // deshabilitar el guard escribiendo -1 y que nadie lo note.
    check('reservations_sweep_attempts_non_negative', sql`sweep_attempts >= 0`),
    foreignKey({
      columns: [t.tenantId, t.listingId],
      foreignColumns: [listings.tenantId, listings.id],
      name: 'reservations_tenant_listing_fk',
    }).onDelete('cascade'),
    // El panel crea reservas con el contador en cero, y eso lo exige la POLICY (capa 2), no el
    // GRANT (capa 1): ver `sweepAttempts` arriba y `TenantPolicyOptions` en `./rls.ts`.
    ...tenantPolicies('reservations', { insertWithCheck: sql`sweep_attempts = 0` }),
  ],
).enableRLS();

export const sales = pgTable(
  'sales',
  {
    id: pk(),
    tenantId: tenantId(),
    listingId: uuid('listing_id').notNull(),
    reservationId: uuid('reservation_id'),
    /** Precio realmente cobrado, en USD. */
    priceUsd: moneyCents('price_usd').notNull(),
    /** ARS informativo al momento de la venta, con el TC que se usó. */
    priceArs: moneyCents('price_ars'),
    fxArsPerUsd: moneyCents('fx_ars_per_usd'),
    paymentMethod: text('payment_method'),

    // ── SENSITIVE: never in public DTO ────────────────────────────────────────────────────────
    /** SENSITIVE: never in public DTO. Costo congelado al momento de la venta. */
    costUsd: moneyCents('cost_usd'),
    /** SENSITIVE: never in public DTO. Derivada por Postgres. */
    marginUsd: moneyCents('margin_usd').generatedAlwaysAs(sql`price_usd - cost_usd`),
    /** SENSITIVE: never in public DTO. */
    internalNotes: text('internal_notes'),
    // ──────────────────────────────────────────────────────────────────────────────────────────

    soldBy: uuid('sold_by').references(() => authUsers.id, { onDelete: 'set null' }),
    soldAt: timestamp('sold_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('sales_tenant_idx').on(t.tenantId),
    index('sales_tenant_sold_at_idx').on(t.tenantId, t.soldAt),
    /**
     * D8 · **Una unidad tiene a lo sumo UNA venta, y eso lo afirma el motor.**
     *
     * Hoy la invariante la sostienen dos cosas y las dos viven en `apps/web`: `sold` es terminal
     * (`checkTransition` devuelve `terminal_state` desde `sold`) y el `eq(listings.status, from)`
     * que `transitionUnit()` usa como guard de concurrencia. Ninguna vive en la base — y el
     * segundo writer de `sales` que aparezca (un canje que cierra en venta, un import) no va a
     * re-derivar la regla bien. Misma doctrina de defensa en profundidad por la que este repo
     * pone el filtro de tenant en la query **además** de RLS.
     *
     * **Reemplaza a `sales_tenant_listing_idx`, no convive con él**, y el motivo se midió antes
     * de borrarlo (S7, `db-agent`): `grep` de `sales` sobre `apps/`, `packages/` y `tests/`
     * devuelve **cero** consultas de producción — la tabla nunca tuvo un lector. Y aunque los
     * tuviera: este índice tiene las **mismas columnas en el mismo orden**, así que cubre todo
     * plan que cubría el anterior (un btree único no lee distinto; sólo verifica de más al
     * escribir). Dejar los dos sería pagar dos inserciones de índice por fila para servir un
     * único árbol de lectura. Medido tras aplicar `0007` con `explain`: el plan de
     * `where tenant_id = $1 and listing_id = $2` es `Index Scan using sales_one_sale_per_listing`.
     *
     * **Por qué `(tenant_id, listing_id)` y no `(listing_id)` solo**, que sería más fuerte: un
     * único global convierte al índice en un **oráculo cruzado**. Un tenant que adivina el `id`
     * de una unidad ajena distingue "ya vendida" de "no vendida" por el `23505` que recibe, sin
     * ver una fila. El alcance de la afirmación queda dicho tal cual es: la unicidad es **por
     * tenant**. La FK compuesta `sales_tenant_listing_fk` afirma además que la venta y el
     * listing sean del mismo tenant; la migración 0010 aborta si encuentra datos históricos
     * cruzados antes de instalarla.
     */
    uniqueIndex('sales_one_sale_per_listing').on(t.tenantId, t.listingId),
    check('sales_price_positive', sql`price_usd > 0`),
    foreignKey({
      columns: [t.tenantId, t.listingId],
      foreignColumns: [listings.tenantId, listings.id],
      name: 'sales_tenant_listing_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.tenantId, t.reservationId],
      foreignColumns: [reservations.tenantId, reservations.id],
      name: 'sales_tenant_reservation_fk',
    // `tenant_id` es NOT NULL: una FK compuesta no puede hacer SET NULL sólo sobre reservation_id.
    // Las reservas se cierran por estado; si tienen ventas históricas, se conservan ambas filas.
    }).onDelete('restrict'),
    ...ownerReadSellerInsertPolicies(
      'sales',
      sql`cost_usd is not distinct from (select l.cost_usd from public.listings l where l.id = sales.listing_id and l.tenant_id = sales.tenant_id) and internal_notes is null and sold_by = (select auth.uid())`,
    ),
  ],
).enableRLS();
