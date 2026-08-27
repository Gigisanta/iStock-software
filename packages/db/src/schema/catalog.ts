/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  TABLAS GLOBALES — LA ÚNICA EXCEPCIÓN A `tenant_id` + RLS EN TODO EL SCHEMA.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `catalog_models` y `catalog_faqs` **no llevan `tenant_id` y no llevan RLS**, a propósito.
 *
 * ## Por qué es correcto y no una excepción de conveniencia
 * "iPhone 14 Pro" no es un dato del reseller: es un hecho del mundo. Es el **mismo** para los 100
 * tenants. Copiarlo por tenant sería 100× la misma fila, 100 embeddings idénticos que pagar, y un
 * catálogo que se desincroniza tenant por tenant. No hay nada que aislar: no hay dato de nadie.
 *
 * ## Qué las mantiene seguras sin RLS
 * 1. **Sólo lectura para la app.** El `GRANT` para `authenticated` es **`SELECT` y nada más**
 *    (`0001_rls_and_grants.sql`). Sin RLS pero también sin `INSERT/UPDATE/DELETE`: un usuario
 *    autenticado no puede escribir el catálogo global de todos los demás.
 * 2. Se pueblan por **seed/migración**, con `service_role`. Nunca desde el panel.
 * 3. Un listing apunta al modelo (`catalog_model_id`); el dato **del tenant** vive en `listings`,
 *    que sí tiene `tenant_id` + RLS.
 *
 * Si algún día un tenant necesita un modelo propio, **no** se le agrega `tenant_id` a esta tabla:
 * se agrega una tabla `tenant_catalog_overrides` con `tenant_id` + RLS. Escrito acá para que la
 * excepción no crezca por accidente.
 *
 * El `embedding` (pgvector) **no vive en la migración base**: está en
 * `drizzle/optional/0100_pgvector_embeddings.sql`, opcional, porque el Postgres de desarrollo
 * local no tiene la extensión y las migraciones base tienen que aplicar limpias igual.
 */

import { boolean, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, updatedAt } from './columns';

/** GLOBAL. Sin `tenant_id`, sin RLS. Ver el bloque de arriba. */
export const catalogModels = pgTable(
  'catalog_models',
  {
    id: pk(),
    slug: text('slug').notNull(),
    brand: text('brand').notNull().default('Apple'),
    family: text('family').notNull().default('iPhone'),
    /** "iPhone 14 Pro". Es lo que se muestra y lo que entra al mensaje de WhatsApp. */
    displayName: text('display_name').notNull(),
    releaseYear: integer('release_year'),
    storageOptionsGb: integer('storage_options_gb').array().notNull().default([]),
    colors: text('colors').array().notNull().default([]),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('catalog_models_slug_key').on(t.slug),
    index('catalog_models_family_idx').on(t.family, t.releaseYear),
  ],
);

/**
 * GLOBAL. Sin `tenant_id`, sin RLS.
 * Los "3 chunks del MISMO catalog_model" que el chatbot mete en el contexto (docs/CHATBOT.md).
 */
export const catalogFaqs = pgTable(
  'catalog_faqs',
  {
    id: pk(),
    catalogModelId: uuid('catalog_model_id').references(() => catalogModels.id, { onDelete: 'cascade' }),
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    locale: text('locale').notNull().default('es-AR'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('catalog_faqs_model_idx').on(t.catalogModelId, t.locale)],
);
