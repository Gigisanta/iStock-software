#!/usr/bin/env node
/**
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
  if (!/\bTO\s+"?authenticated"?/i.test(body)) fail('0008', `${id} no es TO authenticated`);
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

// ── 7. anon no toca nada ─────────────────────────────────────────────────────────────────────
// Sobre `sqlNoComments`, no sobre `sql`: la migración 0001 **explica en prosa** qué default
// privileges trae Supabase (`... GRANT ALL ON TABLES TO anon ...`) y un lint que lee comentarios
// como si fueran código convierte la documentación del bug en un falso positivo. Se lee el SQL
// que Postgres va a ejecutar.
// Se separa el GRANT de su lista de roles porque `TO authenticated, anon` es la forma real en que
// esto se cuela: mirar sólo el token que sigue a `TO` deja pasar la segunda mitad de la lista.
for (const [, head, roles] of sqlNoComments.matchAll(/\bGRANT\b([^;]*?)\bTO\b([^;]*)/gi)) {
  if (!/\banon\b/i.test(roles)) continue;
  const stmt = `GRANT${head}TO${roles}`.replace(/\s+/g, ' ').slice(0, 90);
  fail('0020', `hay un GRANT a anon: la vidriera no lee Postgres directo → ${stmt}`);
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
console.log(`rls-lint OK · ${tables.length} tablas · ${enabled.size} con RLS · ${policies.length} policies · ${marks} columnas SENSITIVE`);
