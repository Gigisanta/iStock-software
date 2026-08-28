#!/usr/bin/env node
/**
 * gate-owner: LEAD
 *
 * Este archivo es un **gate**, no codigo del paquete: `CLAUDE.md` §4 y **ADR-022** — el gate no
 * puede ser del mismo writer que el codigo que audita. Vive en este directorio por resolucion de
 * paths y porque `pnpm -r lint` lo encuentra ahi, no por pertenencia. Un lint que crece de la mano
 * del codigo que mira es un lint que nunca lo va a contradecir.
 *
 * El owner del paquete **pide, no edita** — igual que con los techos del WAF. La marca de arriba
 * la censa `scripts/guard-gates.sh` (G3), que enumera los `package.json` en vez de confiar en el
 * nombre del archivo: la version anterior de la regla decia `*-lint.mjs` y por ese sufijo se le
 * escapaba `purity-check.mjs`, que es exactamente este mismo agujero un nivel mas arriba.
 *
 * Lint estático de `packages/db`. **No necesita base de datos**: corre en CI, en un fork, y en la
 * máquina de alguien que todavía no levantó Postgres.
 *
 * Es a propósito distinto de `src/schema.test.ts`, que verifica la base **real**. Los dos hacen
 * falta y ninguno reemplaza al otro:
 *
 * - El lint lee el SQL que se va a aplicar. Atrapa el error **antes** de aplicarlo, y atrapa el
 *   caso en que alguien arregla la base a mano (`psql`) y se olvida de la migración.
 * - El test lee `pg_policies`. Atrapa el caso en que la migración existe pero nunca corrió.
 *
 * Falla con exit 1 y una línea por problema. Sin colores, sin spinner: esto lo lee un CI.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const fail = (rule, detail) => problems.push(`${rule}  ${detail}`);

/** Únicas tablas autorizadas a no tener RLS. Ver `src/schema/catalog.ts`. */
const GLOBAL_TABLES = new Set(['catalog_models', 'catalog_faqs']);
/** Con RLS pero sin `tenant_id`: se aíslan por identidad, no por tenant. */
const IDENTITY_TABLES = new Set(['tenants', 'users']);
/**
 * Las únicas tablas que la **vidriera anónima** puede leer, y sólo por GRANT de columna.
 * Cualquier otra tabla con un GRANT a `anon` es un hallazgo (regla 0020).
 */
const STOREFRONT_TABLES = new Set([
  'tenants', 'listings', 'listing_photos', 'locations', 'fx_settings', 'catalog_models',
]);
/**
 * La vidriera anónima **escribe** en exactamente una tabla, y con exactamente estas columnas
 * (S4, `drizzle/0004_storefront_wa_click_insert.sql`). Es la única escritura sin autenticar del
 * producto y por eso está tipeada acá como una allowlist cerrada en vez de como un permiso:
 * agregar una tabla o una columna a este objeto es un cambio de superficie de ataque y se lee
 * como tal en el diff. `id` y `created_at` NO están, y no pueden estar: salen de sus defaults
 * justamente para que no se puedan forjar (regla 0026).
 */
const STOREFRONT_WRITE = {
  wa_click_events: ['tenant_id', 'listing_id', 'source'],
};
const STOREFRONT_WRITE_TABLES = new Set(Object.keys(STOREFRONT_WRITE));
/** Columnas que jamás pueden entrar en un privilegio de escritura de `anon` (regla 0026). */
const NEVER_WRITABLE_BY_ANON = new Set(['id', 'created_at', 'updated_at']);
/**
 * Columnas que no pueden aparecer en un GRANT a `anon` **jamás**, ni por descuido ni por
 * "total, es sólo un dato más". Se chequea por nombre, no por tabla: si mañana aparece un
 * `cost_usd` en otra tabla, sigue prohibido (regla 0020b).
 */
const NEVER_TO_ANON = new Set([
  'imei', 'imei_check_status', 'imei_check_status_raw', 'imei_checked_at', 'imei_checked_by',
  'imei_check_source', 'imei_check_note', 'cost_usd', 'margin_usd', 'margen', 'supplier',
  'internal_notes', 'master_key', 'offer_usd', 'customer_name', 'customer_wa_phone',
  'created_by', 'updated_by',
]);
const SENSITIVE_COLUMNS = [
  ['listings', 'imei'], ['listings', 'cost_usd'], ['listings', 'margin_usd'],
  ['listings', 'supplier'], ['listings', 'internal_notes'],
  ['sales', 'cost_usd'], ['sales', 'margin_usd'], ['sales', 'internal_notes'],
  ['tradein_leads', 'offer_usd'], ['tradein_leads', 'internal_notes'],
  ['tradein_leads', 'customer_name'], ['tradein_leads', 'customer_wa_phone'],
  ['listing_photos', 'master_key'],
];

// ── 1. El SQL que se aplica de verdad ────────────────────────────────────────────────────────
const journalPath = join(ROOT, 'drizzle/meta/_journal.json');
const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
const migrations = journal.entries.map((e) => e.tag);

if (migrations.length === 0) fail('0001', 'no hay migraciones en el journal: `push` no es fuente de verdad');

const onDisk = readdirSync(join(ROOT, 'drizzle')).filter((f) => f.endsWith('.sql')).sort();
for (const file of onDisk) {
  if (!migrations.includes(file.replace(/\.sql$/, ''))) {
    fail('0002', `${file} está en disco pero no en _journal.json: no se va a aplicar`);
  }
}
for (const tag of migrations) {
  if (!onDisk.includes(`${tag}.sql`)) fail('0002', `${tag} está en el journal pero el .sql no existe`);
}

const sql = migrations.map((tag) => readFileSync(join(ROOT, 'drizzle', `${tag}.sql`), 'utf8')).join('\n');
const sqlNoComments = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

// ── 2. Toda tabla creada tiene RLS, FORCE y las 4 policies ───────────────────────────────────
const tables = [...sqlNoComments.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+"?(\w+)"?/gi)]
  .map((m) => m[1])
  .filter((t) => !t.startsWith('__drizzle'));

const enabled = new Set(
  [...sqlNoComments.matchAll(/ALTER TABLE\s+"?(\w+)"?\s+ENABLE ROW LEVEL SECURITY/gi)].map((m) => m[1]),
);
const forced = new Set(
  [...sqlNoComments.matchAll(/ALTER TABLE\s+"?(\w+)"?\s+FORCE ROW LEVEL SECURITY/gi)].map((m) => m[1]),
);

for (const table of tables) {
  if (GLOBAL_TABLES.has(table)) {
    if (enabled.has(table)) fail('0003', `${table} es catálogo global: no debería tener RLS`);
    continue;
  }
  if (!enabled.has(table)) fail('0003', `${table} sin ENABLE ROW LEVEL SECURITY`);
  // FORCE importa: sin él, el dueño de la tabla (el rol de las migraciones y el del seed) se
  // saltea las policies y un bug de tenant pasa desapercibido en desarrollo.
  if (!forced.has(table)) fail('0004', `${table} sin FORCE ROW LEVEL SECURITY (el owner ignora las policies)`);

  for (const cmd of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
    const re = new RegExp(`CREATE POLICY[^;]*?ON\\s+"?${table}"?[^;]*?FOR\\s+${cmd}\\b`, 'is');
    if (!re.test(sqlNoComments)) fail('0005', `${table} sin policy de ${cmd}`);
  }
}

// ── 3. Forma de cada policy ──────────────────────────────────────────────────────────────────
const policies = [...sqlNoComments.matchAll(/CREATE POLICY\s+"([^"]+)"\s+ON\s+"?(\w+)"?([^;]*);/gis)];
if (policies.length === 0) fail('0006', 'cero policies: RLS habilitada sin policy deja la tabla vacía para todos');

for (const [, name, table, body] of policies) {
  const id = `${table}.${name}`;
  if (/USING\s*\(\s*true\s*\)/i.test(body)) fail('0007', `${id} usa USING (true): RLS decorativa`);
  if (/WITH CHECK\s*\(\s*true\s*\)/i.test(body)) fail('0007', `${id} usa WITH CHECK (true)`);
  const toAnon = /\bTO\s+"?anon"?/i.test(body);
  const toAuthenticated = /\bTO\s+"?authenticated"?/i.test(body);
  if (!toAuthenticated && !toAnon) {
    fail('0008', `${id} no nombra un rol: TO authenticated (panel) o TO anon (vidriera)`);
  }
  if (toAnon) {
    // La vidriera anónima LEE, y escribe en UNA tabla y nada más: el click de WhatsApp (S4).
    // Hasta S3 esta regla exigía `FOR SELECT` a secas, porque el lead y el click iban a entrar
    // "por una Server Function con el rol del server". El LEAD lo decidió al revés en S4: con
    // `service_role` el aislamiento queda en manos del handler y la base deja de ser la última
    // línea de defensa en el único endpoint sin autenticar del producto. La regla no se ablandó
    // — se volvió más específica: la escritura de `anon` está permitida SÓLO donde dice
    // `STOREFRONT_WRITE`, sólo como INSERT, y con la 0026 encima.
    const esSelect = /\bFOR\s+SELECT\b/i.test(body);
    const esInsert = /\bFOR\s+INSERT\b/i.test(body);
    if (esSelect) {
      if (!STOREFRONT_TABLES.has(table)) {
        fail('0023', `${id}: ${table} no es una tabla del read model público de la vidriera`);
      }
    } else if (esInsert) {
      if (!STOREFRONT_WRITE_TABLES.has(table)) {
        fail('0026', `${id}: anon no escribe en ${table}. La única escritura sin autenticar es ${[...STOREFRONT_WRITE_TABLES].join(', ')}`);
      }
    } else {
      // UPDATE y DELETE para `anon` no existen y no van a existir: un visitante no corrige ni
      // borra. `FOR ALL` cae acá también, y ese es el punto.
      fail('0023', `${id} es TO anon y no es FOR SELECT ni FOR INSERT`);
    }
    // Sin claim de slug la policy tiene que dar falso. Una policy `TO anon` que no lo mira es
    // una policy que publica el stock de todos los tenants a la vez.
    if (!/storefront_(slug|tenant_id)\(\)/i.test(body)) {
      fail('0024', `${id} es TO anon y no acota por el claim de la vidriera (storefront_slug/tenant_id)`);
    }
    if (/storefront_(slug|tenant_id)\(\)/i.test(body) && !/\(\s*select\s+public\.storefront_/i.test(body)) {
      // Mismo motivo que 0009: sin subquery se evalúa una vez POR FILA.
      fail('0009', `${id} llama a storefront_*() fuera de una subquery`);
    }
  }
  if (/auth\.jwt/i.test(body) && !/\(\s*select\s+auth\.jwt/i.test(body)) {
    // ADR-005: sin subquery, `auth.jwt()` se evalúa una vez POR FILA.
    fail('0009', `${id} llama auth.jwt() fuera de una subquery`);
  }
  if (/user_metadata/i.test(body)) {
    // El usuario puede escribir su propio `user_metadata`: leer el tenant de ahí es escalación.
    fail('0010', `${id} lee tenant desde user_metadata (va en app_metadata)`);
  }
  if (/\bFOR\s+(INSERT|UPDATE)\b/i.test(body) && !/WITH CHECK/i.test(body)) {
    fail('0011', `${id} escribe sin WITH CHECK`);
  }
}

// ── 3b · `ALTER POLICY`: el predicado que queda es el ÚLTIMO, no el primero ───────────────────
//
// Regla agregada en S6, y no por prolijidad: hasta ese día esta sección leía **sólo**
// `CREATE POLICY`, así que un `ALTER POLICY … WITH CHECK (true)` en una migración pasaba en verde.
// Se midió antes de escribir esto: con esa línea puesta a mano en 0006, el lint imprimía
// `rls-lint OK · 74 policies` y salía 0. O sea que la regla 0007 —"`using (true)` está prohibido",
// que es la que CLAUDE.md nombra como fallo— tenía una puerta al lado sin cerrar.
//
// La puerta se abrió el día que apareció el primer `ALTER POLICY` del repo (0006, el `with check`
// que exige `sweep_attempts = 0` al crear una reserva). Antes no había ninguno y la omisión no
// costaba nada; a partir de ahí, cada cambio de predicado del producto entra por acá.
//
// Qué se audita y qué NO, que la diferencia importa:
//   · SÍ el predicado: `(true)`, `auth.jwt()` fuera de subquery, `user_metadata`, y —si la policy
//     original era `TO anon`— que siga acotando por el claim del host.
//   · NO la regla 0011 ("escribe sin WITH CHECK"). En Postgres, un `ALTER POLICY` que omite una
//     cláusula **la deja como estaba**: exigir `WITH CHECK` en un ALTER que sólo toca el `USING`
//     sería un falso positivo. El `WITH CHECK` de una policy de escritura lo sigue garantizando
//     su `CREATE`, arriba.
// El comando y el rol se resuelven contra el `CREATE POLICY` del mismo nombre, que es de dónde
// los saca Postgres también.
const alters = [...sqlNoComments.matchAll(/ALTER POLICY\s+"([^"]+)"\s+ON\s+"?(\w+)"?([^;]*);/gis)];
for (const [, name, table, body] of alters) {
  const id = `${table}.${name} (ALTER)`;
  const creado = policies.find(([, n, t]) => n === name && t === table);
  if (creado === undefined) {
    // Un ALTER sobre una policy que ninguna migración crea: o el nombre está mal escrito y el
    // ALTER va a explotar al aplicarse, o la policy la creó alguien a mano en la base.
    fail('0027', `${id} altera una policy que ninguna migración crea`);
    continue;
  }
  if (/USING\s*\(\s*true\s*\)/i.test(body)) fail('0007', `${id} deja USING (true): RLS decorativa`);
  if (/WITH CHECK\s*\(\s*true\s*\)/i.test(body)) fail('0007', `${id} deja WITH CHECK (true)`);
  if (/auth\.jwt/i.test(body) && !/\(\s*select\s+auth\.jwt/i.test(body)) {
    fail('0009', `${id} llama auth.jwt() fuera de una subquery`);
  }
  if (/user_metadata/i.test(body)) {
    fail('0010', `${id} lee tenant desde user_metadata (va en app_metadata)`);
  }
  // Si el ALTER trae predicado, tiene que traer TAMBIÉN el tenant: lo que se agrega va en `and`,
  // nunca en lugar del tenant. Sin esto, un ALTER que "simplifica" el `with check` a una condición
  // de columna publicaría la tabla entre tenants y el lint lo vería como un cambio cosmético.
  const traePredicado = /USING\s*\(|WITH CHECK\s*\(/i.test(body);
  const creadoBody = creado[3];
  if (traePredicado && /tenant_id/i.test(creadoBody) && !/tenant_id/i.test(body)) {
    fail('0027', `${id} reemplaza el predicado y no menciona tenant_id: lo extra va EN AND, no en lugar del tenant`);
  }
  if (/\bTO\s+"?anon"?/i.test(creadoBody) && traePredicado
      && !/storefront_(slug|tenant_id)\(\)/i.test(body)) {
    fail('0024', `${id} altera una policy TO anon y el predicado nuevo no acota por el claim de la vidriera`);
  }
}

// ── 4. tenant_id: NOT NULL, FK, e indexado ───────────────────────────────────────────────────
for (const table of tables) {
  const block = sqlNoComments.match(
    new RegExp(`CREATE TABLE(?: IF NOT EXISTS)?\\s+"?${table}"?\\s*\\(([\\s\\S]*?)\\n\\);`, 'i'),
  );
  if (!block) continue;
  const hasTenant = /"tenant_id"/.test(block[1]);
  if (!hasTenant) {
    if (!GLOBAL_TABLES.has(table) && !IDENTITY_TABLES.has(table)) {
      fail('0012', `${table} es tabla de negocio y no tiene tenant_id`);
    }
    continue;
  }
  if (!/"tenant_id"\s+uuid\s+NOT NULL/i.test(block[1])) fail('0013', `${table}.tenant_id no es uuid NOT NULL`);
  const idx = new RegExp(`CREATE(?: UNIQUE)? INDEX[^;]*?ON\\s+"?${table}"?[^;]*?"tenant_id"`, 'i');
  if (!idx.test(sqlNoComments)) fail('0014', `${table}.tenant_id sin índice: cada policy escanea la tabla`);
}

// ── 5. Tipos: plata, tiempo, ids ─────────────────────────────────────────────────────────────
for (const [, table, body] of sqlNoComments.matchAll(
  /CREATE TABLE(?: IF NOT EXISTS)?\s+"?(\w+)"?\s*\(([\s\S]*?)\n\);/gi,
)) {
  // El paréntesis se captura entero: si no, `numeric(12, 2)` se corta en la primera coma y
  // el lint reporta un falso positivo por cada columna de plata.
  for (const [, col, type] of body.matchAll(/^\s*"(\w+)"\s+([a-z][a-z0-9_ ]*(?:\([^)]*\))?)/gim)) {
    const t = type.trim().toLowerCase();
    if (/^(real|double precision|money|float)/.test(t)) fail('0015', `${table}.${col} es ${t}: la plata va en numeric(12, 2)`);
    if (/^numeric/.test(t) && !/^numeric\(12,\s*2\)/.test(t)) fail('0016', `${table}.${col} es ${t}, se esperaba numeric(12, 2)`);
    if (/^timestamp\b/.test(t) && !/with time zone/.test(t)) fail('0017', `${table}.${col} es timestamp sin zona horaria`);
  }
}

// ── 6. Marcadores SENSITIVE ──────────────────────────────────────────────────────────────────
const marks = sql.split('\n').filter((l) => l.trim() === '-- SENSITIVE: never in public DTO').length;
if (marks !== SENSITIVE_COLUMNS.length) {
  fail('0018', `hay ${marks} marcadores SENSITIVE y se esperaban ${SENSITIVE_COLUMNS.length}`);
}
for (const [table, column] of SENSITIVE_COLUMNS) {
  const re = new RegExp(`COMMENT ON COLUMN\\s+"?(?:public\\.)?${table}"?\\."?${column}"?\\s+IS\\s+'SENSITIVE: never in public DTO`, 'i');
  if (!re.test(sql)) fail('0019', `${table}.${column} sin COMMENT SENSITIVE consultable desde la base`);
}

// ── 7. anon toca EXACTAMENTE el read model público, y por columna ────────────────────────────
// Corregido en la ronda S1-R2 (hallazgo HIGH-1). La versión anterior de esta regla exigía CERO
// GRANT a `anon` — y ese invariante era el bug: con un rol no-superusuario la vidriera recibía
// `42501` y leía cero filas, mientras en dev "andaba" porque la conexión local es SUPERUSER y se
// saltea RLS y GRANTs por igual. Lo que se exige ahora es la forma:
//   · GRANT de **columna**, nunca de tabla (para que `select *` y `select imei` den 42501);
//   · sólo SELECT sobre las 6 tablas del read model público, jamás una columna sensible;
//   · más, desde S4, **un solo** INSERT de columna sobre `wa_click_events` (regla 0026): el
//     click de WhatsApp, que es la única escritura sin autenticar del producto. Ese privilegio
//     está tipeado columna por columna en `STOREFRONT_WRITE` y no acepta ni una más.
// Se lee `sqlNoComments`: la prosa de 0001/0002/0004 explica GRANTs que no se ejecutan.
for (const [, head, roles] of sqlNoComments.matchAll(/\bGRANT\b([^;]*?)\bTO\b([^;]*)/gi)) {
  if (!/\banon\b/i.test(roles)) continue;
  const stmt = `GRANT${head}TO${roles}`.replace(/\s+/g, ' ').trim();
  const short = stmt.slice(0, 110);

  if (/^GRANT USAGE ON SCHEMA public$/i.test(`GRANT${head}`.replace(/\s+/g, ' ').trim())) continue;
  if (/^GRANT EXECUTE ON FUNCTION public\.storefront_(slug|tenant_id)\(\)$/i.test(
    `GRANT${head}`.replace(/\s+/g, ' ').trim(),
  )) continue;

  if (/\bON\s+ALL\s+/i.test(head)) {
    fail('0020', `GRANT masivo a anon: el read model público se otorga tabla por tabla → ${short}`);
    continue;
  }

  const columnGrant = /^GRANT\s+(SELECT|INSERT)\s*\(([^)]*)\)\s*ON\s+TABLE\s+"?(\w+)"?$/i.exec(
    `GRANT${head}`.replace(/\s+/g, ' ').trim(),
  );
  if (columnGrant === null) {
    // Acá caen `GRANT SELECT ON TABLE listings TO anon` (privilegio de TABLA: haría andar el
    // `select *`) y cualquier UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER, sea de columna o no.
    fail('0020', `GRANT a anon que no es SELECT ni INSERT de COLUMNA sobre una tabla → ${short}`);
    continue;
  }
  const [, privilegio, columnList, table] = columnGrant;
  const esEscritura = privilegio.toUpperCase() === 'INSERT';
  const columnas = columnList.split(',').map((raw) => raw.trim().replace(/"/g, '')).filter((c) => c.length > 0);

  if (esEscritura) {
    // ── 0026 · la única escritura sin autenticar del producto ──────────────────────────────
    const permitidas = STOREFRONT_WRITE[table];
    if (permitidas === undefined) {
      fail('0026', `anon no escribe en ${table}: la única escritura sin autenticar es sobre ${[...STOREFRONT_WRITE_TABLES].join(', ')} → ${short}`);
    } else {
      // Igualdad EXACTA, no inclusión. Una columna de menos rompe el handler y se ve en el test;
      // una columna de más es superficie de ataque nueva y no se ve en ningún lado.
      const esperadas = [...permitidas].sort().join(',');
      const reales = [...columnas].sort().join(',');
      if (esperadas !== reales) {
        fail('0026', `el privilegio de escritura de anon sobre ${table} es (${reales}) y se esperaba exactamente (${esperadas})`);
      }
    }
    for (const column of columnas) {
      // `id` y `created_at` salen de sus defaults justamente para que no se puedan forjar: un
      // visitante no elige el id de su evento ni antedata un click.
      if (NEVER_WRITABLE_BY_ANON.has(column)) {
        fail('0026', `${table}.${column} no puede estar en un privilegio de escritura de anon: sale de su default para que no se pueda forjar`);
      }
    }
  } else if (!STOREFRONT_TABLES.has(table)) {
    fail('0020', `anon no lee ${table}: no es parte del read model público de la vidriera`);
  }

  for (const column of columnas) {
    if (NEVER_TO_ANON.has(column)) {
      fail('0020', `columna prohibida en un GRANT a anon: ${table}.${column}`);
    }
    if (SENSITIVE_COLUMNS.some(([t, c]) => t === table && c === column)) {
      fail('0020', `columna SENSITIVE en un GRANT a anon: ${table}.${column}`);
    }
  }
}

// La tabla que `anon` escribe tiene que tener su policy de INSERT `TO anon`, y **no** puede tener
// privilegio de lectura: el visitante escribe su click y no lee ninguno, ni el propio. Las dos
// mitades se chequean acá porque por separado ninguna alcanza — un privilegio sin policy escribe
// en cualquier tenant, y una policy sin privilegio no escribe nada (42501) y nadie se entera
// hasta que se prende el tráfico.
for (const table of STOREFRONT_WRITE_TABLES) {
  const tieneGrant = new RegExp(`GRANT\\s+INSERT\\s*\\([^)]*\\)\\s*ON\\s+TABLE\\s+"?${table}"?\\s+TO\\s+anon`, 'i')
    .test(sqlNoComments);
  if (!tieneGrant) fail('0026', `${table} tiene policy de escritura para anon y ningún privilegio de INSERT: el insert daría 42501`);
  const policyInsert = new RegExp(`CREATE POLICY[^;]*ON\\s+"?${table}"?[^;]*FOR\\s+INSERT[^;]*TO\\s+"?anon"?`, 'is')
    .test(sqlNoComments);
  if (!policyInsert) fail('0026', `${table} tiene privilegio de INSERT para anon y ninguna policy TO anon: escritura sin límite de tenant`);
  if (new RegExp(`GRANT\\s+SELECT[^;]*ON\\s+TABLE\\s+"?${table}"?\\s+TO\\s+anon`, 'i').test(sqlNoComments)) {
    fail('0026', `${table}: anon recibe lectura sobre la tabla que escribe. El visitante registra su click y no lee ninguno`);
  }
}

// Toda tabla del read model público tiene que tener, además del GRANT, su policy `TO anon`:
// un GRANT sin policy es una tabla que `anon` puede tocar y de la que no ve nada (o al revés,
// el día que alguien apague RLS). Las dos capas van juntas o no van.
for (const table of STOREFRONT_TABLES) {
  const tieneGrant = new RegExp(`GRANT\\s+SELECT\\s*\\([^)]*\\)\\s*ON\\s+TABLE\\s+"?${table}"?\\s+TO\\s+anon`, 'i')
    .test(sqlNoComments);
  const tienePolicy = new RegExp(`CREATE POLICY[^;]*ON\\s+"?${table}"?[^;]*TO\\s+"?anon"?`, 'is')
    .test(sqlNoComments);
  if (!tieneGrant) fail('0025', `${table} está en el read model público y no tiene GRANT de columna a anon`);
  // `catalog_models` es GLOBAL y no tiene RLS: se protege sólo con el GRANT (ver catalog.ts).
  if (!tienePolicy && !GLOBAL_TABLES.has(table)) {
    fail('0025', `${table} tiene GRANT a anon y ninguna policy TO anon: privilegio sin límite de filas`);
  }
}

// El invariante de arriba sólo vale para las tablas que existen HOY. En un proyecto Supabase real
// las tablas nuevas nacen con GRANT a `anon` por `ALTER DEFAULT PRIVILEGES` del rol dueño, así que
// el REVOKE puntual no alcanza y la migración tiene que apagar la fábrica, no sólo el producto.
if (!/ALTER DEFAULT PRIVILEGES[^;']*REVOKE ALL ON TABLES FROM anon/i.test(sqlNoComments)) {
  fail('0022', 'ninguna migración revoca los DEFAULT PRIVILEGES de anon: la próxima tabla nace legible');
}

// ── 8. Deuda declarada en comentarios ────────────────────────────────────────────────────────
for (const dir of ['src', 'drizzle']) {
  const walk = (p) => {
    for (const entry of readdirSync(p, { withFileTypes: true })) {
      const full = join(p, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(ts|sql|mjs)$/.test(entry.name)) continue;
      const text = readFileSync(full, 'utf8');
      for (const [i, line] of text.split('\n').entries()) {
        // Case-SENSITIVE y con `:`/`(`: en un repo escrito en español, /todo/i matchea prosa
        // ("todo índice compuesto...") y el lint se vuelve ruido que nadie mira.
        if (/\bTODO\s*[:(]/.test(line) && /\b(RLS|R2|tenant|policy|luego|despu)/i.test(line)) {
          fail('0021', `${full}:${i + 1} deuda de seguridad declarada en un TODO`);
        }
      }
    }
  };
  walk(join(ROOT, dir));
}

if (problems.length > 0) {
  console.error(`rls-lint: ${problems.length} problema(s)\n`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(
  `rls-lint OK · ${tables.length} tablas · ${enabled.size} con RLS · ${policies.length} policies` +
    ` (+${alters.length} ALTER auditados) · ${marks} columnas SENSITIVE`,
);
