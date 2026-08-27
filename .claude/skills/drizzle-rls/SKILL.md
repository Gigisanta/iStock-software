---
name: drizzle-rls
description: Receta para agregar una tabla de negocio multi-tenant en packages/db con tenant_id, índices, política RLS no permisiva y su test cruzado. Usar SIEMPRE que se cree o modifique una tabla.
---

# drizzle-rls

**Toda tabla de negocio de iStock pasa por acá.** Sin los 6 pasos, la tabla no se mergea.

## Paso 1 — Columnas obligatorias
```ts
id:        uuid('id').primaryKey().defaultRandom(),
tenantId:  uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
```
Plata: `numeric(12,2)` (o entero de centavos). **Nunca `real`/`double`.**

## Paso 2 — Índice de tenant
```ts
(t) => ({ tenantIdx: index('<table>_tenant_idx').on(t.tenantId) })
```
Todo índice compuesto arranca con `tenant_id` a la izquierda.

## Paso 3 — Marcar columnas sensibles
```sql
-- SENSITIVE: never in public DTO
```
sobre `imei`, `cost_usd`, `internal_notes`, `supplier`, `margin`.

## Paso 4 — RLS en la migración
```sql
alter table "<table>" enable row level security;
alter table "<table>" force row level security;  -- también para el owner de la tabla

create policy "<table>_tenant_select" on "<table>"
  for select using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

create policy "<table>_tenant_insert" on "<table>"
  for insert with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

create policy "<table>_tenant_update" on "<table>"
  for update using  (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
             with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

create policy "<table>_tenant_delete" on "<table>"
  for delete using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
```

**Prohibido:** `using (true)` · policy sólo de `select` · olvidar `with check` en insert/update
(sin `with check` un tenant puede **escribir filas de otro**).

> La forma exacta del claim (`auth.jwt() ->> 'tenant_id'` vs una tabla `memberships` con
> `auth.uid()`) la fija `docs/DECISIONS.md` tras FASE 1. Usá la que diga la ADR, no inventes.

## Paso 5 — Test cruzado obligatorio
Contra Postgres **real**, dos sesiones con distinto claim:
```
- tenant A inserta 1 fila
- sesión de tenant B hace select → 0 filas
- sesión de tenant B intenta insert con tenant_id de A → error
- sesión de tenant B intenta update de la fila de A → 0 filas afectadas
```
Un mock acá no vale.

## Paso 6 — Verificación global
```sql
select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' and c.relrowsecurity=false;
```
Debe devolver **cero filas** (salvo tablas explícitamente globales listadas en `ARCHITECTURE.md`).

## Aceptación
```
pnpm --filter @istock/db test -- rls
```
