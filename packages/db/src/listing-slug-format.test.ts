/**
 * `listings_slug_format` (migración 0003) — probado en la polaridad que importa: que la base
 * **RECHACE** un slug malo.
 *
 * Un CHECK que sólo se prueba con datos buenos no se probó: pasa igual si el constraint no se
 * aplicó nunca. Acá el caso principal es negativo (13 slugs que la base tiene que rechazar con
 * `23514 check_violation` nombrando el constraint) y el positivo es de control: **las 10 filas
 * reales de `SEED_LISTINGS`**, no un slug inventado que casualmente cumple.
 *
 * Por qué existe el constraint: el slug va a una URL pública (`/p/{slug}`) y entra como argumento
 * del cache key de `'use cache'`. Lo elige el visitante. La única defensa anterior era que el
 * panel *casualmente* genera slugs sanos — o sea ninguna para seed, import o migración.
 *
 * Contra Postgres real y con el rol de operador (`openAdmin`): esto no prueba RLS, prueba el
 * motor. Un CHECK se evalúa aunque la sesión sea superusuario, así que el rol no lo tapa. El
 * aislamiento entre tenants se prueba en `rls.test.ts` y en `tests/rls-cross-tenant.test.ts`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_LISTINGS } from './seed-data';
import { openAdmin } from './test-session';

const admin = openAdmin();

const TENANT = '00000000-0000-4000-9000-00000000c001';
const TENANT_SLUG = 'slugtest';

/** `23514` = `check_violation`. Cualquier otro código sería otro bug, no este constraint. */
const CHECK_VIOLATION = '23514';

/** Techo del CHECK. 64 y no 32: el slug de un listing vive en el path, no en un label DNS. */
const MAX_LEN = 64;
const MIN_LEN = 3;

interface PgError {
  readonly code?: string;
  readonly constraint_name?: string;
}

/** Inserta un listing con ese slug. Devuelve `null` si entró, o el error de Postgres si no. */
async function tryInsert(slug: string): Promise<PgError | null> {
  try {
    await admin.unsafe(
      `insert into listings (tenant_id, slug, title, condition, price_usd, status)
       values ($1, $2, 'Equipo de prueba', 'used_excellent', 100.00, 'draft')`,
      [TENANT, slug],
    );
    return null;
  } catch (error) {
    return error as PgError;
  }
}

beforeAll(async () => {
  await admin.unsafe(`delete from tenants where id = $1`, [TENANT]);
  await admin.unsafe(
    `insert into tenants (id, slug, name, wa_phone) values ($1, $2, 'Tenant de slugs', '5492990000099')`,
    [TENANT, TENANT_SLUG],
  );
});

afterAll(async () => {
  await admin.unsafe(`delete from tenants where id = $1`, [TENANT]);
  await admin.end({ timeout: 5 });
});

describe('la base RECHAZA un slug de listing mal formado (el caso que importa)', () => {
  /**
   * Cada entrada es un valor que la base aceptaba antes de 0003 y que termina en una URL pública
   * y en un cache key. El motivo va en el nombre del caso, no en un comentario suelto.
   */
  const REJECTED: readonly (readonly [string, string])[] = [
    ['string vacío', ''],
    ['un solo carácter', 'a'],
    [`${String(MIN_LEN - 1)} caracteres: por debajo del piso`, 'ab'],
    [`${String(MAX_LEN + 1)} caracteres: por encima del techo`, 'a'.repeat(MAX_LEN + 1)],
    ['8 KB de basura', 'a'.repeat(8192)],
    ['mayúsculas (dos slugs distintos para la misma ficha = dos entradas de cache)', 'iPhone-14-Pro'],
    ['path traversal', '../../../etc/passwd'],
    ['path traversal ya escapado', '..%2f..%2fadmin'],
    ['NUL codificado', 'iphone-14%00'],
    ['barra: se comería un segmento de la ruta', 'iphone/14'],
    ['espacio', 'iphone 14 pro'],
    ['guión al principio', '-iphone-14'],
    ['guión al final', 'iphone-14-'],
    ['guion bajo (no es [a-z0-9-])', 'iphone_14'],
    ['no-ASCII', 'iphoné-14'],
  ];

  for (const [why, slug] of REJECTED) {
    it(`rechaza ${why}`, async () => {
      const error = await tryInsert(slug);
      expect(error, `la base ACEPTÓ un slug que no debería: ${JSON.stringify(slug.slice(0, 40))}`)
        .not.toBeNull();
      expect(error?.code).toBe(CHECK_VIOLATION);
      expect(error?.constraint_name).toBe('listings_slug_format');
    });
  }

  it('ninguno de los rechazados quedó en la base', async () => {
    const r = (await admin.unsafe(`select count(*)::text as n from listings where tenant_id = $1`, [
      TENANT,
    ])) as unknown as { n: string }[];
    expect(r[0]?.n).toBe('0');
  });
});

describe('acepta lo legítimo (control: si esto falla, el constraint rompe el producto)', () => {
  it('las 10 filas de SEED_LISTINGS entran, una por una', async () => {
    expect(SEED_LISTINGS).toHaveLength(10);
    for (const listing of SEED_LISTINGS) {
      const error = await tryInsert(listing.slug);
      expect(error, `el seed viola el propio CHECK en '${listing.slug}'`).toBeNull();
    }
    const r = (await admin.unsafe(`select count(*)::text as n from listings where tenant_id = $1`, [
      TENANT,
    ])) as unknown as { n: string }[];
    expect(r[0]?.n).toBe('10');
    await admin.unsafe(`delete from listings where tenant_id = $1`, [TENANT]);
  });

  it('el techo es 64 y NO 32, y el seed lo necesita', () => {
    // `iphone-15-pro-max-256-titanio-natural` (fila 207) tiene 37 caracteres. Con techo 32 esta
    // migración no correría contra el seed, y en producción haría desaparecer de la vidriera un
    // equipo publicado por tener el nombre largo.
    const row207 = SEED_LISTINGS.find((l) => l.id.endsWith('207'));
    expect(row207?.slug).toBe('iphone-15-pro-max-256-titanio-natural');
    expect(row207?.slug.length).toBe(37);
    expect(row207?.slug.length).toBeGreaterThan(32);
    expect(row207?.slug.length).toBeLessThanOrEqual(MAX_LEN);
  });

  it('los bordes exactos: 3 caracteres entra, 64 entra', async () => {
    for (const slug of ['a1b', `a${'b'.repeat(MAX_LEN - 2)}c`]) {
      expect(slug.length === MIN_LEN || slug.length === MAX_LEN).toBe(true);
      expect(await tryInsert(slug), `debería aceptar ${String(slug.length)} caracteres`).toBeNull();
    }
    await admin.unsafe(`delete from listings where tenant_id = $1`, [TENANT]);
  });
});

describe('el constraint está en la base con la forma que dice el schema', () => {
  it('`listings_slug_format` existe y es el patrón de 62 caracteres interiores', async () => {
    const r = (await admin.unsafe(`
      select pg_get_constraintdef(con.oid) as def from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      where c.relname = 'listings' and con.conname = 'listings_slug_format'`)) as unknown as {
      def: string;
    }[];
    expect(r).toHaveLength(1);
    expect(r[0]?.def).toContain('[a-z0-9-]{1,62}');
  });

  it('es el mismo patrón que el de tenants salvo por el techo (32 allá, 64 acá)', async () => {
    // Si alguien "unifica" los dos constraints, este test le dice por qué no se unifican.
    const r = (await admin.unsafe(`
      select con.conname, pg_get_constraintdef(con.oid) as def from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      where con.conname in ('tenants_slug_format', 'listings_slug_format') order by 1`)) as unknown as {
      conname: string;
      def: string;
    }[];
    expect(r.map((x) => x.conname)).toEqual(['listings_slug_format', 'tenants_slug_format']);
    const [listingsDef, tenantsDef] = [r[0]?.def ?? '', r[1]?.def ?? ''];
    expect(tenantsDef).toContain('[a-z0-9-]{1,30}');
    expect(listingsDef.replace('{1,62}', '{1,30}')).toBe(tenantsDef);
  });
});
