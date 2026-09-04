/**
 * Schema de `@istock/db`. **Un solo proyecto Postgres para todos los tenants** (ADR-001).
 *
 * ## Inventario (lo que reporta `db-agent`)
 * | grupo | tablas | RLS |
 * |---|---|---|
 * | negocio con `tenant_id` | 17 | ✅ |
 * | identidad (`tenants` por `id`, `users` por `auth.uid()` + membresía) | 2 | ✅ |
 * | catálogo **global** (`catalog_models`, `catalog_faqs`) | 2 | ❌ a propósito, ver `catalog.ts` |
 *
 * 21 tablas · 19 con RLS · 2 globales sin RLS y con `GRANT` de sólo lectura.
 */

export * from './enums';
export * from './rls';
export * from './columns';

export * from './tenants';
export * from './users';
export * from './memberships';
export * from './locations';
export * from './fx';
export * from './catalog';
export * from './listings';
export * from './listing-photos';
export * from './events';
export * from './commerce';
export * from './tradein';
export * from './chatbot';
export * from './billing';
