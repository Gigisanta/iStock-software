# `@istock/db`

Schema Drizzle, migraciones versionadas, políticas RLS y seed demo. **Un solo proyecto Postgres
para todos los tenants** (ADR-001): el aislamiento es RLS, no un schema ni una base por cliente.

## Inventario

| grupo | tablas | RLS |
|---|---|---|
| negocio, con `tenant_id` | 16 | sí |
| identidad (`tenants`, `users`) | 2 | sí |
| catálogo **global** (`catalog_models`, `catalog_faqs`) | 2 | no, a propósito |

**20 tablas · 18 con RLS.** La diferencia son exactamente 2 y está explicada abajo.

### Por qué el catálogo no tiene `tenant_id`

`catalog_models` (qué es un "iPhone 14 Pro": GB posibles, colores, año) y `catalog_faqs` ("¿qué
significa batería 87%?") describen el mundo, no el negocio de nadie. Duplicarlos por tenant sería
1 fila × N tenants de la misma verdad, y además rompería el embedding compartido del chatbot.

No tienen RLS y **no la necesitan**, porque el aislamiento acá se hace con `GRANT`, no con policy:
`authenticated` tiene `SELECT` y nada más; `anon` no tiene nada. Un tenant no puede escribir el
catálogo porque no tiene el privilegio, no porque una policy lo filtre. Los mantiene el seed.

Es la **única** excepción. Cualquier tabla nueva sin `tenant_id` es un bug hasta que se demuestre
lo contrario, y `scripts/rls-lint.mjs` lo reporta como `0012`.

## Comandos

Antes que nada, la base local (una vez):

```bash
./scripts/pg-local.sh                      # desde la RAÍZ del repo. Crea istock_dev + auth.jwt()
export DATABASE_URL="postgresql://localhost:5432/istock_dev"
```

Sin usuario en esa URL a propósito: libpq cae al usuario del SO. `pg-local.sh` **no crea un rol
`postgres`**, y los roles que sí crea (`anon` / `authenticated` / `service_role`) son NOLOGIN.
Es el mismo string que el default de `src/env.ts`, así que sin `DATABASE_URL` los tests igual corren.

```bash
pnpm --filter @istock/db generate         # drizzle-kit generate → drizzle/*.sql (fuente de verdad)
pnpm --filter @istock/db migrate          # aplica el journal
pnpm --filter @istock/db seed             # demo determinista, idempotente
pnpm --filter @istock/db lint             # lint estático, NO necesita base
pnpm --filter @istock/db typecheck && pnpm --filter @istock/db test
```

`drizzle-kit push` **no** es fuente de verdad y no está en los scripts. Lo que no está en
`drizzle/meta/_journal.json` no existe.

## Cómo se escribe una tabla nueva

Los seis pasos de la skill `drizzle-rls`, sin excepción:

1. `tenantId()` (uuid, not null, FK a `tenants` con `on delete cascade`).
2. Índice que **arranca** por `tenant_id`.
3. `.enableRLS()` + `FORCE` en la migración.
4. Las cuatro policies: `select`, `insert`, `update`, `delete`. `insert`/`update` con `WITH CHECK`.
5. `-- SENSITIVE: never in public DTO` + `COMMENT ON COLUMN` si la columna no puede salir.
6. Fila nueva en la tabla del test de RLS.

El claim va en `app_metadata`, nunca en `user_metadata`: el usuario puede escribir su propio
`user_metadata` y eso sería escalación de tenant.

## Dos redes distintas, las dos hacen falta

- `scripts/rls-lint.mjs` lee el **SQL que se va a aplicar**. Corre sin base. Atrapa el caso en que
  alguien arregló la base a mano con `psql` y se olvidó de la migración.
- `src/schema.test.ts` lee `pg_policies` de la **base real**. Atrapa el caso en que la migración
  existe pero nunca corrió.
- `src/rls.test.ts` abre **dos sesiones con claims distintos** y prueba que el tenant B no lee, no
  escribe, no actualiza y no borra lo del tenant A. No hay mocks: es `set local role authenticated`
  + `request.jwt.claims` real.
- `src/rls-anon-storefront.test.ts` hace lo mismo con el rol `anon` **real** y el claim de slug: qué
  lee la vidriera, qué columnas revientan con `42501`, y qué no puede escribir.
- `src/rls-anon-wa-click.test.ts` prueba la **polaridad** de la única escritura sin autenticar del
  producto (abajo): el insert legítimo pasa, el de otro tenant y el que apunta a un listing ajeno
  los rechaza la policy, y un `select` de `anon` sobre esa tabla no devuelve nada.

## Plata

SQL `numeric(12, 2)` ↔ TS entero de centavos, vía el `customType` de `src/money.ts`. La conversión
es por string, exacta. `real`/`double precision`/`money` están prohibidos y el lint los rechaza
(`0015`). `margin_usd` es columna **generada** por Postgres (`price_usd - cost_usd`): no se calcula
en la app, así no se puede desincronizar.

## Notas de operación

- **Seed contra Supabase**: `FORCE ROW LEVEL SECURITY` aplica también al owner. El seed tiene que
  correr con un rol `BYPASSRLS`, no con `authenticated`: en Supabase, `postgres` o `service_role`;
  en local, el usuario del SO que creó la base. **En la base local no existe un rol `postgres`** —
  `scripts/pg-local.sh` sólo crea `anon` / `authenticated` / `service_role`, y los tres son NOLOGIN.
- **`BYPASSRLS` no otorga privilegios.** Son dos capas y se evalúan las dos: el `GRANT` decide si
  el rol puede tocar la tabla, la policy decide qué filas ve, y `BYPASSRLS` sólo saltea lo segundo.
  Un `service_role` sin `GRANT` recibe `42501 permission denied` y no lee una fila: por eso 0001
  le otorga DML tabla por tabla a `service_role`, igual que a `authenticated`. Lo verifica R8 en
  `tests/rls-cross-tenant.test.ts` contra Postgres real, que **no es de este paquete**: es de
  `qa-agent`. El que escribe las policies no puede ser también el dueño del test que las audita
  (CLAUDE.md §4), así que el archivo se mudó fuera de `packages/db/src/` en T3.
- **La única escritura sin autenticar del producto** es el click del botón de WhatsApp
  (`wa_click_events`, migración `0004`). El LEAD decidió en S4 que se hace con un `INSERT` de
  `anon` acotado y **no** con una ruta de `service_role`: `service_role` tiene `BYPASSRLS`, así que
  con esa forma la garantía de que la fila cae en el tenant correcto viviría entera en el handler y
  la base dejaría de ser la última línea de defensa justo en el endpoint al que le puede pegar
  cualquiera. `anon` gana `INSERT` de **tres columnas** (`tenant_id`, `listing_id`, `source`) sobre
  **una** tabla; `id` y `created_at` salen de sus defaults para que no se puedan forjar. Cero
  `SELECT`/`UPDATE`/`DELETE`: el visitante escribe su click y no lee ninguno, ni el propio — así que
  un `insert ... returning` desde la vidriera recibe `42501` y eso es correcto. La regla `0026` del
  lint impide que la excepción se copie a una segunda tabla o gane una cuarta columna.
- **Tablas nuevas y `anon`**: un `REVOKE ... ON ALL TABLES` sólo alcanza a las tablas que existen
  en ese momento. Un proyecto Supabase real trae `ALTER DEFAULT PRIVILEGES` que le dan privilegios
  a `anon`/`authenticated` sobre **toda tabla futura** de `public`. La sección 2.a de 0001 los
  apaga (y deja los de `service_role` puestos) recorriendo los roles dueños plausibles. Si corre
  con un rol sin membresía en el dueño, **avisa con un `WARNING`** en vez de fallar en silencio:
  al crear el proyecto Supabase (B2) hay que leer la salida de la migración y, si aparece ese
  warning, re-correr 2.a con el rol dueño. El lint lo custodia con la regla `0022`.
- **pgvector** vive en `drizzle/optional/0100_pgvector_embeddings.sql`, **fuera del journal**, y se
  aplica con `pnpm --filter @istock/db migrate:pgvector`. Está separado a propósito: el Postgres
  local no tiene la extensión y las migraciones base tienen que aplicar limpias igual.
- Borrar un listing **no** borra el objeto en R2: la key es content-addressed y dos tenants pueden
  compartir el byte. Se borra el mapeo (`listing_photos`), nunca el objeto (ADR-006).
