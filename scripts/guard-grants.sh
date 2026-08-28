#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════════════════════
#  guard-grants.sh · CLAUDE.md §2: "Tabla nueva sin GRANT explicito -> no la lee nadie."
# ══════════════════════════════════════════════════════════════════════════════════════════════
#
# Por que existe este guard y por que es del LEAD y no de `db-agent`: un gate no puede ser del
# mismo writer que el codigo que audita, y este audita las migraciones.
#
# El invariante que vigila NO aparece en CI. La migracion 0001 revoca los DEFAULT PRIVILEGES de
# `anon` **y de `authenticated`**, asi que una tabla nueva nace sin privilegios para los dos. Eso
# esta bien y es a proposito: falla cerrado. La contra es el sintoma: la tabla existe, el schema de
# Drizzle compila, el typecheck pasa, el seed corre con `service_role` (que SI conserva sus default
# privileges, es el rol de los jobs) y todo se ve verde. El `42501` aparece el dia que se prende el
# cron o el dia que el panel la lee por primera vez, en produccion, con un cliente adentro.
#
# `rls-anon-storefront.test.ts` audita los privilegios de COLUMNA contra Postgres real, y lo hace
# bien. Pero necesita `DATABASE_URL`: sin base, saltea. Este guard es 100% estatico a proposito —
# corre en cualquier maquina, sin base, en el pre-commit y en CI.
#
# Las cinco reglas se probaron en las DOS polaridades antes de shippear (2026-08-28). Un gate que
# nunca se vio fallar no es un gate: la version anterior de la regla G4 vivia en `accept-s1.sh`,
# grepeaba POR LINEA, y los GRANT multilinea (que son 5 de los 6) le pasaban por al lado.
# ══════════════════════════════════════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")/.."

SCHEMA_DIR="packages/db/src/schema"
MIG_DIR="packages/db/drizzle"

fail=0
ok()  { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
no()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=1; }
inf() { printf '  \033[36m····\033[0m  %s\n' "$1"; }
sec() { printf '\n\033[1m── %s\033[0m\n' "$1"; }

printf '\n\033[1mguard-grants · CLAUDE.md §2 · GRANT explicito por tabla\033[0m\n'

[ -d "$SCHEMA_DIR" ] || { no "no existe $SCHEMA_DIR"; exit 1; }
[ -d "$MIG_DIR" ]    || { no "no existe $MIG_DIR"; exit 1; }

# El python NO va dentro de `$(...)`: el pre-scan de bash que busca el `)` de cierre cuenta las
# comillas del heredoc aunque este entrecomillado, y el script deja de parsear. Va a un temporal.
RES="$(mktemp)"; trap 'rm -f "$RES"' EXIT
python3 - "$SCHEMA_DIR" "$MIG_DIR" > "$RES" <<'PY'
import re, sys, pathlib

schema_dir, mig_dir = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])

# ── 1 · Las tablas, desde el schema de Drizzle (la fuente de verdad) ──────────────────────────
# Dos formas de declaracion conviven en el arbol: `pgTable(\n  'x',` y `pgTable('x',`. Se aceptan
# las dos a proposito — el guard no puede exigir un estilo de formateo, y prettier mueve la coma.
TABLE = re.compile(r"=\s*pgTable\(\s*'([a-z_]+)'", re.S)
tables = set()
for f in sorted(schema_dir.glob('*.ts')):
    tables |= set(TABLE.findall(f.read_text(encoding='utf-8')))

# ── 2 · Los GRANT, por SENTENCIA y no por linea ───────────────────────────────────────────────
# Este es el punto entero del archivo. El GRANT de `listings` a `anon` ocupa cinco lineas: la que
# dice GRANT no dice anon, y la que dice anon no dice GRANT. Un grep por linea no lo ve NUNCA.
sql = []
for f in sorted(mig_dir.rglob('*.sql')):
    sql.append((f, f.read_text(encoding='utf-8')))

def statements(text):
    # Se tiran las lineas de comentario ANTES de partir: `-- ... GRANT ... anon ...` es prosa y
    # hay varias en 0002. Contarlas como sentencia da falsos positivos y falsos negativos.
    body = '\n'.join(l for l in text.splitlines() if not l.lstrip().startswith('--'))
    for chunk in re.split(r'-->\s*statement-breakpoint|;', body):
        s = ' '.join(chunk.split())
        if s:
            yield s

ON_TABLE = re.compile(r'\bON\s+TABLE\s+"?([a-z_]+)"?', re.I)
GRANTEES = re.compile(r'\bTO\s+([^;]+)$', re.I)
COLLIST  = re.compile(r'\bGRANT\s+[A-Z, ]*?\(([^)]*)\)', re.I)

# tabla -> rol -> {'cols': set|None}   (None == GRANT a nivel de TABLA, sin lista de columnas)
grants = {}
raw    = []   # (archivo, sentencia) de cada GRANT sobre una tabla, para los mensajes de error
for f, text in sql:
    for st in statements(text):
        if not re.match(r'\s*GRANT\b', st, re.I):
            continue
        m = ON_TABLE.search(st)
        if not m:
            continue                       # GRANT sobre schema, funcion o secuencia: no es esto
        tbl = m.group(1)
        g = GRANTEES.search(st)
        roles = re.findall(r'[a-z_]+', g.group(1).lower()) if g else []
        cols = COLLIST.search(st)
        colset = {c.strip().strip('"') for c in cols.group(1).split(',')} if cols else None
        for r in roles:
            prev = grants.setdefault(tbl, {}).get(r)
            if prev is None or prev.get('cols') is None:
                grants[tbl][r] = {'cols': colset}
            elif colset is not None:
                prev['cols'] |= colset
        raw.append((f.name, st))

# ── 3 · Columnas que no pueden salir de la base por el rol anonimo, nunca ─────────────────────
# CLAUDE.md §1 (IMEI nunca en vidriera), §2 (costo/margen/notas internas nunca a un DTO publico) y
# ADR-006 (`master_key` es la key del bucket privado; desde ella se deriva el original de 2MB).
FORBIDDEN = re.compile(
    r'^(imei.*|cost_usd|margin_usd|supplier|internal_notes|created_by|updated_by|sold_at'
    r'|master_key|card_bytes|embedding|enacom.*)$'
)

def emit(rule, status, msg, detail=''):
    print(f'{rule}\t{status}\t{msg}\t{detail}')

# G0 · censo. Cero tablas = el parser se rompio, y eso es FAIL, no PASS.
# (Absencia de medicion = FAIL. Es la regla que ya salvo al censo de specs de S2.)
emit('G0', 'PASS' if tables else 'FAIL',
     f'censo: {len(tables)} tablas en el schema, {len(grants)} con algun GRANT'
     if tables else 'censo: CERO tablas parseadas — el guard no midio nada')

for rule, role, label in (('G1', 'service_role', 'service_role (el rol de los jobs y el cron)'),
                          ('G2', 'authenticated', 'authenticated (el panel)')):
    missing = sorted(t for t in tables if role not in grants.get(t, {}))
    emit(rule, 'FAIL' if missing else 'PASS',
         f'toda tabla del schema tiene GRANT explicito a {label}',
         ', '.join(missing))

# G3 · a `anon` se le otorga por COLUMNA o no se le otorga. Un GRANT de tabla a anon significa que
# la proxima columna que agregue una migracion nace publica sin que nadie lo decida.
tablewide = sorted(t for t, r in grants.items()
                   if 'anon' in r and r['anon']['cols'] is None)
emit('G3', 'FAIL' if tablewide else 'PASS',
     'ningun GRANT a anon es a nivel de tabla (solo por columna)', ', '.join(tablewide))

# G4 · la regla que estaba verde por vacio en accept-s1.sh hasta el 2026-08-28.
leaks = []
for t, r in grants.items():
    cols = r.get('anon', {}).get('cols') or set()
    for c in sorted(cols):
        if FORBIDDEN.match(c):
            leaks.append(f'{t}.{c}')
emit('G4', 'FAIL' if leaks else 'PASS',
     'ningun GRANT a anon nombra imei/costo/margen/notas/proveedor/master_key', ', '.join(leaks))

# G5 · sin esto, TODO lo de arriba es decorativo: la tabla que cree la migracion 0007 nace con
# GRANT automatico a anon y a authenticated, y ninguna de las reglas de este guard se entera,
# porque el GRANT no esta escrito en ningun lado — lo pone Supabase.
alltext = '\n'.join(t for _, t in sql)
adp = re.findall(r'ALTER DEFAULT PRIVILEGES[^;\']*?REVOKE ALL ON TABLES FROM (\w+)', alltext, re.I)
for rule, role in (('G5a', 'anon'), ('G5b', 'authenticated')):
    emit(rule, 'PASS' if role in adp else 'FAIL',
         f'ALTER DEFAULT PRIVILEGES revoca TABLES a `{role}` (la tabla nueva nace sin privilegio)')
PY
PYRC=$?
[ "$PYRC" -eq 0 ] || { no "el parser de python fallo (rc=$PYRC)"; exit 1; }

sec "reglas"
while IFS=$'\t' read -r rule status msg detail; do
  [ -z "${rule:-}" ] && continue
  if [ "$status" = "PASS" ]; then ok "$rule · $msg"
  else no "$rule · $msg"; [ -n "${detail:-}" ] && printf '        %s\n' "$detail"; fi
done < "$RES"

sec "veredicto"
if [ "$fail" -eq 0 ]; then
  ok "GRANTS OK — toda tabla del schema tiene privilegio explicito y anon no ve nada prohibido"
else
  no "GRANTS RECHAZADOS"
  inf "una tabla sin GRANT no la lee nadie, y el 42501 aparece el dia que se prende el cron"
  inf "el GRANT se escribe en packages/db/drizzle/ y es de db-agent, no de este guard"
fi
exit "$fail"
