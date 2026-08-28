/**
 * G6 · Un GRANT de INSERT por columna tiene que cubrir TODAS las columnas de la tabla.
 *
 * Por que existe esta probe, y por que es del LEAD y no de `db-agent`:
 *
 * El 2026-08-27 la migracion 0006 agrego `reservations.sweep_attempts`. Para que un
 * seller no pudiera forjar el contador, revoco INSERT/UPDATE de tabla a `authenticated`
 * y los re-otorgo columna por columna, sobre las 11 columnas que ya existian. El
 * razonamiento era correcto y el efecto fue que **reservar un equipo desde el panel
 * dejo de funcionar**, con `42501 permission denied for table reservations`.
 *
 * La causa no esta en el schema, esta en el caller: **Drizzle, en `insert().values()`,
 * nombra TODAS las columnas de la tabla** y pone `default` en las que no le pasaste. Y
 * Postgres exige privilegio de INSERT sobre cada columna **nombrada**, aunque el valor
 * sea `DEFAULT`. Entonces un GRANT por columna que no cubre el 100% de la tabla no es
 * "mas restrictivo": es un INSERT roto para todo el producto.
 *
 * `scripts/guard-grants.sh` no puede ver esto y no es un descuido: cuenta que exista un
 * GRANT por tabla, y un GRANT parcial existe. Dijo PASS con el panel roto. El que lo
 * agarro fue e2e — o sea, el gate mas caro y mas lento que tenemos. Esta probe pone la
 * misma afirmacion en un lugar barato: no ejecuta ningun INSERT, le pregunta al catalogo.
 *
 * No es de `db-agent` porque audita lo que `db-agent` escribe (CLAUDE.md §4: el gate no
 * puede ser del mismo writer que el codigo que audita). Tampoco es de `app-agent`, que es
 * quien sufre el sintoma. Es del LEAD, como todo `scripts/probes/**`.
 *
 * La salida si la excepcion se justifica: **no uses GRANT por columna para INSERT**. El
 * candado de "esta columna se inserta solo en cero" se expresa en la `WITH CHECK` de la
 * policy de RLS, que es la capa que sabe decir "si, pero con este valor". El GRANT solo
 * sabe decir si o no. Para UPDATE el GRANT por columna SI sirve, porque el `.set()` de
 * Drizzle nombra unicamente las columnas que estas seteando.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const { userInfo } = await import('node:os');
const { default: pg } = await import('postgres');

const url =
  process.env.DATABASE_URL ??
  `postgresql://${userInfo().username}@localhost:5432/${process.env.ISTOCK_DB ?? 'istock_dev'}`;

const cliente = pg(url, { max: 1, prepare: false, onnotice: () => {} });

const ROL = 'authenticated';

type Privilegio = { columna: string; puede: boolean };

/** La conexion o una transaccion: las dos saben `unsafe`, y el control necesita la segunda. */
type Ejecutor = { unsafe: (q: string, p?: unknown[]) => Promise<unknown> };

/**
 * El predicado, en un solo lugar, para que el censo y el control de polaridad midan
 * literalmente lo mismo. Devuelve las columnas que Drizzle va a nombrar y que el rol
 * NO puede insertar. Vacio = sano. Tabla fuera de alcance = `null`.
 *
 * **Toma el ejecutor por parametro y eso es el punto entero.** La primera version tenia
 * `cliente` cerrado adentro, asi que el control —que corre en una transaccion que se rollea—
 * no podia llamarla y reescribia el mismo SQL inline. Eran dos copias del predicado con un
 * docblock que juraba que habia una, y la deriva silenciosa iba en la peor direccion: al
 * corregir un bug aca, el control seguia verde midiendo la version vieja, o sea certificando
 * un predicado que ya no existe. Lo encontro `docs-keeper` leyendo el archivo, no un gate.
 */
async function columnasQueFaltan(tabla: string, ejecutor: Ejecutor = cliente): Promise<string[] | null> {
  const filas = (await ejecutor.unsafe(
    `select c.column_name as columna,
            has_column_privilege($1, $2::regclass, c.column_name, 'INSERT') as puede
       from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name   = $3
        and c.is_generated <> 'ALWAYS'
      order by c.ordinal_position`,
    [ROL, `public.${tabla}`, tabla],
  )) as unknown as Privilegio[];

  if (filas.length === 0) throw new Error(`la tabla public.${tabla} no tiene columnas: revisa el censo`);

  const conPrivilegio = filas.filter((f) => f.puede);
  // Cero privilegios = el panel no escribe esta tabla (la escribe `service_role`).
  // Eso es una decision legitima y no es lo que esta probe audita.
  if (conPrivilegio.length === 0) return null;

  return filas.filter((f) => !f.puede).map((f) => f.columna);
}

let tablasDeNegocio: string[] = [];

beforeAll(async () => {
  try {
    await cliente`select 1`;
  } catch (e) {
    // Fail-closed a proposito: ausencia de medicion no es PASS.
    throw new Error(
      `no hay Postgres en ${url.replace(/:[^:@]*@/u, ':***@')}. Levantalo con \`pnpm db:local\`. ` +
        `Causa: ${(e as Error).message}`,
    );
  }

  const [{ existe }] = (await cliente`
    select exists (select 1 from pg_roles where rolname = ${ROL}) as existe
  `) as unknown as [{ existe: boolean }];
  if (!existe) throw new Error(`el rol ${ROL} no existe en esta base: las migraciones no estan aplicadas`);

  const filas = (await cliente`
    select t.table_name as tabla
      from information_schema.tables t
     where t.table_schema = 'public'
       and t.table_type   = 'BASE TABLE'
       and exists (
         select 1 from information_schema.columns c
          where c.table_schema = t.table_schema
            and c.table_name   = t.table_name
            and c.column_name  = 'tenant_id')
     order by t.table_name
  `) as unknown as { tabla: string }[];
  tablasDeNegocio = filas.map((f) => f.tabla);
});

afterAll(async () => {
  await cliente.end({ timeout: 5 });
});

describe('el GRANT de INSERT cubre el insert que Drizzle emite de verdad', () => {
  it('encuentra tablas de negocio (si no, el censo no esta midiendo nada)', () => {
    // Sin esto, un censo sobre una lista vacia pasaria para siempre.
    expect(tablasDeNegocio.length).toBeGreaterThan(0);
  });

  it(`ninguna tabla de negocio le da a ${ROL} un INSERT por columna incompleto`, async () => {
    const rotas: string[] = [];
    let auditadas = 0;

    for (const tabla of tablasDeNegocio) {
      const faltan = await columnasQueFaltan(tabla);
      if (faltan === null) continue;
      auditadas += 1;
      if (faltan.length > 0) rotas.push(`${tabla} → sin INSERT en: ${faltan.join(', ')}`);
    }

    expect(
      auditadas,
      `ninguna tabla de negocio le da INSERT a ${ROL}: el panel no escribiria nada. Revisa las migraciones.`,
    ).toBeGreaterThan(0);

    expect(
      rotas,
      `Drizzle nombra TODAS las columnas en \`insert().values()\`, aun las que van con \`default\`, ` +
        `y Postgres exige privilegio sobre cada columna nombrada. Un GRANT por columna incompleto = ` +
        `el panel recibe \`42501 permission denied\` al insertar. Si la intencion era acotar el VALOR ` +
        `de una columna, eso va en la \`WITH CHECK\` de la policy de RLS, no en el GRANT.\n` +
        rotas.map((r) => `  · ${r}`).join('\n'),
    ).toEqual([]);
  });

  it('el predicado sabe decir que no (control de polaridad, en una transaccion que se rollea)', async () => {
    // Sin este control, "no encontre tablas rotas" y "no se buscar tablas rotas" son
    // la misma salida verde. Es la familia de gate que ADR-020 vino a cerrar.
    await cliente.begin(async (tx) => {
      await tx.unsafe(`create table public.probe_g6_control (
        id uuid primary key, tenant_id uuid not null, veneno integer not null default 0)`);
      await tx.unsafe(`grant insert ("id","tenant_id") on table public.probe_g6_control to ${ROL}`);

      // La MISMA funcion que corre el censo, no una copia de su SQL: si el control midiera
      // con su propia consulta, probaria que ese SQL sabe decir que no — que es justo lo que
      // no hace falta saber. Lo que se audita es el predicado que se usa arriba.
      const faltan = await columnasQueFaltan('probe_g6_control', tx);

      expect(faltan, 'el control quedo FUERA de alcance (null): el predicado no midio nada').not.toBeNull();
      expect(faltan, 'el predicado no vio la columna sin privilegio: el censo es vacuo').toEqual(['veneno']);

      throw new Error('rollback deliberado del control');
    }).catch((e: Error) => {
      if (e.message !== 'rollback deliberado del control') throw e;
    });

    // Y la tabla del control no sobrevive: una probe que ensucia la base envenena a la siguiente.
    const [{ quedo }] = (await cliente`
      select exists (select 1 from information_schema.tables
                      where table_schema='public' and table_name='probe_g6_control') as quedo
    `) as unknown as [{ quedo: boolean }];
    expect(quedo, 'el control dejo su tabla en la base').toBe(false);
  });
});
