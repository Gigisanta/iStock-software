/**
 * Chatbot de vidriera (capa 2, docs/CHATBOT.md).
 *
 * Lo que **no** hay acá, y es a propósito:
 * - **No hay IP ni user agent.** El rate limit vive en el WAF de Cloudflare/Vercel, no en
 *   Postgres: un contador en Postgres sobre la vidriera rompe el 95%-sin-DB y es causal de
 *   rechazo (CLAUDE.md §2). `visitor_hash` es un hash salteado y efímero, no una identidad.
 * - **No hay embeddings por tenant.** Los embeddings viven en el catálogo global y se calculan
 *   en el seed, nunca por request.
 * - En `content` **nunca** entra IMEI, costo, margen ni notas internas: el contexto se arma desde
 *   `publicListingDTO`, que ya los stripeó.
 */

import { foreignKey, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, updatedAt } from './columns';
import { tenantId } from './tenants';
import { chatRoleEnum } from './enums';
import { listings } from './listings';
import { tenantPolicies } from './rls';

export const chatbotThreads = pgTable(
  'chatbot_threads',
  {
    id: pk(),
    tenantId: tenantId(),
    /** Ficha abierta cuando arrancó la conversación. */
    listingId: uuid('listing_id'),
    /** Hash salteado del visitante. **No** es una IP y no se puede revertir a una. */
    visitorHash: text('visitor_hash'),
    messageCount: integer('message_count').notNull().default(0),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    /** El handoff a WhatsApp es el final feliz, no el fracaso. Se mide. */
    handedOffAt: timestamp('handed_off_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('chatbot_threads_tenant_idx').on(t.tenantId),
    index('chatbot_threads_tenant_created_idx').on(t.tenantId, t.createdAt),
    uniqueIndex('chatbot_threads_tenant_id_key').on(t.tenantId, t.id),
    foreignKey({
      columns: [t.tenantId, t.listingId],
      foreignColumns: [listings.tenantId, listings.id],
      name: 'chatbot_threads_tenant_listing_fk',
    // `tenant_id` es NOT NULL: `SET NULL` sobre una FK compuesta violaría la columna obligatoria.
    }).onDelete('restrict'),
    ...tenantPolicies('chatbot_threads'),
  ],
).enableRLS();

export const chatbotMessages = pgTable(
  'chatbot_messages',
  {
    id: pk(),
    tenantId: tenantId(),
    threadId: uuid('thread_id').notNull(),
    role: chatRoleEnum('role').notNull(),
    content: text('content').notNull(),
    /** Dieta medida, no estimada: ≤1200 in / ≤180 out por turno (docs/CHATBOT.md). */
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    /** ID del modelo **por env var**, guardado tal cual salió: hubo 2 deprecaciones en 3 meses. */
    model: text('model'),
    createdAt: createdAt(),
  },
  (t) => [
    index('chatbot_messages_tenant_idx').on(t.tenantId),
    index('chatbot_messages_tenant_thread_idx').on(t.tenantId, t.threadId, t.createdAt),
    foreignKey({
      columns: [t.tenantId, t.threadId],
      foreignColumns: [chatbotThreads.tenantId, chatbotThreads.id],
      name: 'chatbot_messages_tenant_thread_fk',
    }).onDelete('cascade'),
    ...tenantPolicies('chatbot_messages'),
  ],
).enableRLS();
