/**
 * `memberships_single_owner_per_user_key` (migración 0005) — **la regla "un negocio por persona"
 * probada donde ahora vive: en el motor.**
 *
 * Hasta 0005 la regla la sostenía sólo `createTenant()`, con un `if (await hasMembership(userId))`
 * leído **antes** de abrir la transacción que después escribe. Eso no es una garantía: dos signups
 * concurrentes del mismo `user_id` leen cero filas los dos, escriben los dos y commitean los dos.
 * Este archivo prueba las tres cosas que decidió 0005, y las prueba contra Postgres real:
 *
 *   1. la FORMA del índice (único, parcial, sobre `user_id`, `where role = 'owner'`),
 *   2. la CARRERA (dos transacciones concurrentes, dos conexiones, sin mock),
 *   3. lo que el parcial **no** deroga: la misma persona sigue pudiendo *trabajar* en otros
 *      negocios como `seller`. Es la mitad que un único sobre `user_id` pelado habría roto en
 *      silencio, y por eso es un test y no un comentario.
 *
 * ## Quién es la auditoría de referencia (CLAUDE.md §4, precisión del LEAD del 2026-08-28)
 * **No es este archivo.** La afirmación que un gate cita vive en `tests/` y es de `qa-agent`.
 * Este test es la red de regresión del paquete que escribe la migración: si los dos divergen,
 * **gana el de `tests/`** y el que se corrige es éste. Ningún gate debe citar este archivo como
 * evidencia — sería `db-agent` firmando su propio certificado.
 *
 * Corre con `openAdmin()` (rol de operador) a propósito: acá no se prueba RLS sino el motor. Un
 * índice único se evalúa aunque la sesión sea superusuario, así que el rol no tapa nada. El
 * aislamiento entre tenants se prueba en `rls.test.ts` y en `tests/rls-cross-tenant.test.ts`.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openAdmin } from './test-session';

const admin = openAdmin();

const INDEX = 'memberships_single_owner_per_user_key';
/** El otro único de la tabla: el que dice "una persona puede estar en varios negocios". */
const PAIR_INDEX = 'memberships_tenant_user_key';
/** `23505` = `unique_violation`. Cualquier otro código sería otro bug, no este índice. */
const UNIQUE_VIOLATION = '23505';

const MIGRATION_TAG = '0005_memberships_single_owner_per_user';
const DRIZZLE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../drizzle');
const migrationSql = readFileSync(join(DRIZZLE_DIR, `${MIGRATION_TAG}.sql`), 'utf8');
/**
 * El SQL que Postgres **ejecuta**, sin las líneas de comentario. El encabezado de 0005 cita el
 * DDL en prosa para explicarlo, así que buscar `CREATE UNIQUE INDEX` sobre el archivo entero
 * encuentra el comentario antes que la sentencia. Misma precaución que toma `scripts/rls-lint.mjs`.
 */
const migrationDdl = migrationSql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

/** Cuatro negocios distintos: la carrera necesita tenants **nuevos**, no el mismo dos veces. */
const TENANT = [
  '00000000-0000-4000-9000-00000000d001',
  '00000000-0000-4000-9000-00000000d002',
  '00000000-0000-4000-9000-00000000d003',
  '00000000-0000-4000-9000-00000000d004',
] as const;
const USER_ONE = '00000000-0000-4000-9000-00000000d0a1';
const USER_TWO = '00000000-0000-4000-9000-00000000d0a2';

interface PgError {
  readonly code?: string;
  readonly constraint_name?: string;
  readonly message?: string;
  readonly detail?: string;
  readonly hint?: string;
}

const sqlList = (values: readonly string[]): string => values.map((v) => `'${v}'`).join(', ');

function insertMembership(tenant: string, user: string, role: 'owner' | 'seller'): string {
  return `insert into memberships (tenant_id, user_id, role) values ('${tenant}', '${user}', '${role}')`;
}

/** Corre el SQL como operador. Devuelve `null` si entró, o el error de Postgres si no. */
async function attempt(text: string): Promise<PgError | null> {
  try {
    await admin.unsafe(text);
    return null;
  } catch (error) {
    return error as PgError;
  }
}

async function rows<T>(text: string): Promise<T[]> {
  return (await admin.unsafe(text)) as unknown as T[];
}

async function countOwnerships(user: string): Promise<number> {
  const r = await rows<{ n: string }>(
    `select count(*)::text as n from memberships where user_id = '${user}' and role = 'owner'`,
  );
  return Number(r[0]?.n ?? '-1');
}

// Los tenants y los usuarios se montan una vez y sobreviven a todos los casos; lo único que se
// limpia entre casos son las membresías, que es lo que cada caso escribe.
beforeAll(async () => {
  await admin.unsafe(`delete from tenants where id in (${sqlList(TENANT)})`);
  await admin.unsafe(`
    insert into auth.users (id, email) values
      ('${USER_ONE}', 'uno@ownertest.local'), ('${USER_TWO}', 'dos@ownertest.local')
    on conflict (id) do nothing`);
  await admin.unsafe(`
    insert into tenants (id, slug, name, wa_phone) values
      ('${TENANT[0]}', 'ownertest-1', 'Negocio 1', '5492990000091'),
      ('${TENANT[1]}', 'ownertest-2', 'Negocio 2', '5492990000092'),
      ('${TENANT[2]}', 'ownertest-3', 'Negocio 3', '5492990000093'),
      ('${TENANT[3]}', 'ownertest-4', 'Negocio 4', '5492990000094')`);
});

beforeEach(async () => {
  await admin.unsafe(`delete from memberships where user_id in (${sqlList([USER_ONE, USER_TWO])})`);
});

afterAll(async () => {
  await admin.unsafe(`delete from tenants where id in (${sqlList(TENANT)})`);
  await admin.unsafe(`delete from auth.users where id in (${sqlList([USER_ONE, USER_TWO])})`);
  await admin.end({ timeout: 5 });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe('la migración 0005 está versionada y su índice es PARCIAL, no un único pelado', () => {
  it('0005 está en el journal: es una migración commiteada, no un `push`', () => {
    const journal = JSON.parse(readFileSync(join(DRIZZLE_DIR, 'meta/_journal.json'), 'utf8')) as {
      entries: { tag: string }[];
    };
    expect(journal.entries.map((e) => e.tag)).toContain(MIGRATION_TAG);
    expect(migrationDdl).toContain(`CREATE UNIQUE INDEX "${INDEX}"`);
    expect(migrationDdl).toContain(`WHERE role = 'owner'`);
  });

  it('el índice existe en la base con la definición exacta', async () => {
    const r = await rows<{ indexdef: string }>(
      `select indexdef from pg_indexes where indexname = '${INDEX}'`,
    );
    expect(r).toHaveLength(1);
    expect(r[0]?.indexdef).toBe(
      `CREATE UNIQUE INDEX ${INDEX} ON public.memberships USING btree (user_id) ` +
        `WHERE (role = 'owner'::membership_role)`,
    );
  });

  it('es ÚNICO y es PARCIAL, y sobre UNA columna (`user_id`), no sobre el par', async () => {
    // Si alguien "simplifica" esto a un único sobre `user_id` a secas, `indpred` pasa a NULL y
    // este caso falla. Ese es el punto: el parcial dice "una persona POSEE un solo negocio";
    // el pelado diría "una persona sólo puede estar en un negocio", que es otra regla, que no
    // tomamos nunca, y que rompería al empleado que trabaja en dos locales.
    const r = await rows<{ isunique: boolean; ispartial: boolean; cols: string }>(`
      select i.indisunique as isunique,
             (i.indpred is not null) as ispartial,
             (select string_agg(a.attname, ',' order by a.attnum)
                from pg_attribute a
               where a.attrelid = i.indrelid and a.attnum = any(i.indkey)) as cols
        from pg_index i join pg_class c on c.oid = i.indexrelid
       where c.relname = '${INDEX}'`);
    expect(r[0]?.isunique).toBe(true);
    expect(r[0]?.ispartial, 'el índice dejó de ser parcial: eso deroga la membresía múltiple').toBe(true);
    expect(r[0]?.cols).toBe('user_id');
  });

  it('el par `(tenant_id, user_id)` sigue existiendo: 0005 agregó, no reemplazó', async () => {
    const r = await rows<{ n: string }>(
      `select count(*)::text as n from pg_indexes where indexname = '${PAIR_INDEX}'`,
    );
    expect(r[0]?.n).toBe('1');
  });

  it('la regla queda consultable desde la base (COMMENT ON INDEX)', async () => {
    const r = await rows<{ description: string | null }>(
      `select obj_description('${INDEX}'::regclass, 'pg_class') as description`,
    );
    expect(r[0]?.description ?? '').toContain('una persona POSEE un solo negocio');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe('la base RECHAZA el segundo negocio de la misma persona (el caso que importa)', () => {
  it('owner en un tenant y owner en OTRO tenant → 23505 nombrando el índice de 0005', async () => {
    expect(await attempt(insertMembership(TENANT[0], USER_ONE, 'owner'))).toBeNull();

    const error = await attempt(insertMembership(TENANT[1], USER_ONE, 'owner'));
    expect(error, 'la base aceptó dos negocios para la misma persona').not.toBeNull();
    expect(error?.code).toBe(UNIQUE_VIOLATION);
    expect(error?.constraint_name).toBe(INDEX);
    expect(await countOwnerships(USER_ONE)).toBe(1);
  });

  it('el segundo owner tampoco entra por `update`: promover a dueño en otro negocio falla', async () => {
    // La carrera del signup no es el único camino: una membresía `seller` existente que se
    // promueve a `owner` llega a la misma fila prohibida por otra puerta.
    expect(await attempt(insertMembership(TENANT[0], USER_ONE, 'owner'))).toBeNull();
    expect(await attempt(insertMembership(TENANT[1], USER_ONE, 'seller'))).toBeNull();

    const error = await attempt(
      `update memberships set role = 'owner' where user_id = '${USER_ONE}' and tenant_id = '${TENANT[1]}'`,
    );
    expect(error?.code).toBe(UNIQUE_VIOLATION);
    expect(error?.constraint_name).toBe(INDEX);
    expect(await countOwnerships(USER_ONE)).toBe(1);
  });

  it('dos transacciones CONCURRENTES: la segunda no commitea (la carrera de S5, sin mock)', async () => {
    // Ésta es la razón de existir de 0005 y no se puede probar en secuencia: dos conexiones
    // físicas distintas, las dos con la transacción abierta, las dos insertando el mismo dueño
    // en dos negocios recién creados. Antes de 0005 las dos commiteaban y quedaban dos tenants
    // y dos slugs quemados. Ahora la segunda espera al `commit` de la primera y muere con 23505.
    const c1 = openAdmin();
    const c2 = openAdmin();
    try {
      await c1.unsafe('begin');
      await c2.unsafe('begin');
      await c1.unsafe(insertMembership(TENANT[2], USER_ONE, 'owner'));

      // Sin `await`: el insert de C2 queda BLOQUEADO por el índice hasta que C1 resuelva.
      const blocked = c2.unsafe(insertMembership(TENANT[3], USER_ONE, 'owner')).catch((e: unknown) => e);
      await new Promise((r) => setTimeout(r, 250));

      await c1.unsafe('commit');
      const error = (await blocked) as PgError;

      expect(error?.code, 'la segunda transacción commiteó: la carrera sigue abierta').toBe(
        UNIQUE_VIOLATION,
      );
      expect(error?.constraint_name).toBe(INDEX);
      await c2.unsafe('rollback');
    } finally {
      await c1.end({ timeout: 5 });
      await c2.end({ timeout: 5 });
    }

    expect(await countOwnerships(USER_ONE)).toBe(1);
    const r = await rows<{ tenant_id: string }>(
      `select tenant_id from memberships where user_id = '${USER_ONE}' and role = 'owner'`,
    );
    expect(r[0]?.tenant_id, 'el negocio que sobrevive es el de la transacción que commiteó').toBe(
      TENANT[2],
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe('lo que el parcial NO deroga (por esto no es un único sobre `user_id` pelado)', () => {
  it('la misma persona puede ser `seller` en otros dos negocios mientras es dueña de uno', async () => {
    expect(await attempt(insertMembership(TENANT[0], USER_ONE, 'owner'))).toBeNull();
    expect(await attempt(insertMembership(TENANT[1], USER_ONE, 'seller'))).toBeNull();
    expect(await attempt(insertMembership(TENANT[2], USER_ONE, 'seller'))).toBeNull();

    const r = await rows<{ n: string }>(
      `select count(*)::text as n from memberships where user_id = '${USER_ONE}'`,
    );
    // Un único sobre `user_id` pelado dejaría esto en 1 y nadie se enteraría hasta que un
    // empleado no pueda entrar al segundo local.
    expect(r[0]?.n).toBe('3');
    expect(await countOwnerships(USER_ONE)).toBe(1);
  });

  it('dos personas distintas pueden ser dueñas cada una de su propio negocio', async () => {
    expect(await attempt(insertMembership(TENANT[0], USER_ONE, 'owner'))).toBeNull();
    expect(await attempt(insertMembership(TENANT[1], USER_TWO, 'owner'))).toBeNull();
  });

  it('repetir `(tenant, user)` lo sigue frenando el índice del PAR, no el de 0005', async () => {
    // Discrimina los dos únicos: si este caso empezara a reportar el índice de 0005, querría
    // decir que alguien borró el del par y que la membresía múltiple ya no está modelada.
    expect(await attempt(insertMembership(TENANT[0], USER_ONE, 'seller'))).toBeNull();
    const error = await attempt(insertMembership(TENANT[0], USER_ONE, 'owner'));
    expect(error?.code).toBe(UNIQUE_VIOLATION);
    expect(error?.constraint_name).toBe(PAIR_INDEX);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * El guard de datos preexistentes. Una migración que sólo aplica sobre una base vacía es una
 * bomba con fecha: `CREATE UNIQUE INDEX` sobre una tabla que ya tiene dos `owner` para el mismo
 * `user_id` no crea nada y aborta con el mensaje crudo de Postgres. 0005 decide **abortar y
 * nombrar a los responsables**, sin tocar un solo dato, porque elegir cuál de los dos negocios
 * conserva una persona es una decisión con plata adentro (stock, slug publicado, suscripción).
 *
 * Acá se corre el bloque `DO` **leído del archivo de migración**, no una copia: si alguien lo
 * edita, este test corre lo editado.
 */
describe('el guard de 0005 sobre una base sucia: aborta, explica y no toca datos', () => {
  /** El bloque `DO $$ ... $$;` tal cual está en `drizzle/0005_*.sql`. */
  const guard = (() => {
    const start = migrationDdl.indexOf('DO $$');
    const end = migrationDdl.indexOf('$$;', start);
    if (start < 0 || end < 0) {
      throw new Error(`el guard de datos preexistentes desapareció de ${MIGRATION_TAG}.sql`);
    }
    return migrationDdl.slice(start, end + 3);
  })();

  it('con dos `owner` del mismo usuario: `unique_violation`, con DETAIL y HINT accionables', async () => {
    // Todo adentro de una transacción que se revierte: se dropea el índice para poder ensuciar
    // la base igual que estaría una base pre-0005, y se vuelve atrás entero.
    await admin.unsafe('begin');
    try {
      await admin.unsafe(`drop index ${INDEX}`);
      await admin.unsafe(insertMembership(TENANT[0], USER_ONE, 'owner'));
      await admin.unsafe(insertMembership(TENANT[1], USER_ONE, 'owner'));

      const error = await attempt(guard);
      expect(error, 'el guard dejó pasar una base que viola la regla').not.toBeNull();
      expect(error?.code).toBe(UNIQUE_VIOLATION);
      expect(error?.message).toContain('un negocio por persona');
      expect(error?.detail).toContain(USER_ONE);
      expect(error?.detail).toContain(TENANT[0]);
      expect(error?.detail).toContain(TENANT[1]);
      // El HINT tiene que decir qué hacer, no sólo que algo está mal.
      expect(error?.hint).toContain('NO elige por vos');
      expect(error?.hint).toContain('volve a correr la migracion');
    } finally {
      await admin.unsafe('rollback');
    }

    // El rollback devolvió el índice: el guard no deja la base a medio migrar.
    const r = await rows<{ n: string }>(
      `select count(*)::text as n from pg_indexes where indexname = '${INDEX}'`,
    );
    expect(r[0]?.n).toBe('1');
  });

  it('control: con la base limpia el mismo guard pasa sin decir nada', async () => {
    await admin.unsafe(insertMembership(TENANT[0], USER_ONE, 'owner'));
    await admin.unsafe(insertMembership(TENANT[1], USER_TWO, 'owner'));
    expect(await attempt(guard)).toBeNull();
  });

  it('el guard corre ANTES del `CREATE UNIQUE INDEX` en el archivo', async () => {
    // El orden es la mitad de la garantía: si el índice fuera primero, el operador vería el
    // error crudo de Postgres y nunca el HINT con la remediación.
    expect(migrationDdl.indexOf('DO $$')).toBeLessThan(migrationDdl.indexOf('CREATE UNIQUE INDEX'));
  });
});
