#!/usr/bin/env bash
# GATE DE LOS GATES — una asercion que invoca un helper inexistente no falla: se evapora.
#
# ── El hallazgo que lo justifica (LEAD, 2026-08-28) ─────────────────────────────────────────────
# `accept-s1.sh` llamaba a `chk` diez veces y a `have` una. Ninguno de los dos estaba definido:
# vivian sueltos adentro de `accept-fase3.sh`, y `. scripts/_lib.sh` no los traia. Bash no tiene
# forma de avisarle a un gate sobre eso — imprime `chk: command not found` por STDERR, devuelve 127
# y sigue. `no()` nunca se llama, asi que `fail` no se toca.
#
# Resultado medido: `accept-s1.sh` reporto **25 PASS / 1 FAIL con ONCE aserciones que no corrieron**,
# entre ellas las cuatro que consultan Postgres de verdad para probar que `anon` no puede leer
# `listings.imei` y que `listings` tiene RLS forzada — la evidencia viva de "sin RLS no hay merge".
# El unico FAIL era un falso positivo ajeno. **Sin ese falso positivo el gate salia VERDE**, y corre
# en CI desde entonces.
#
# ── Por que este gate es estatico y no un `command_not_found_handle` ────────────────────────────
# Ese gancho existe y esta puesto en `_lib.sh`, pero es de **bash >= 4.0** y macOS ships 3.2.57:
# agarra en CI y es inerte en la maquina donde mas se corren los gates a mano. Una red que solo
# funciona donde no la miro da tranquilidad sin dar cobertura. Este archivo corre igual en las dos.
#
# ── Alcance, y el hueco que tuvo la primera version ─────────────────────────────────────────────
# La primera version miraba solo el **conjunto cerrado de helpers definidos en algun lado de
# `scripts/`**, para no tener que parsear heredocs de Python, de node y de SQL. Su polaridad la
# rechazo en el acto: si el helper se borra del repo entero y alguien lo sigue llamando, deja de
# estar en el conjunto y **el gate se queda ciego justo en el caso que vino a cubrir**.
#
# Version vigente: candidato es toda palabra en posicion de comando que **no resuelve a nada** — ni
# funcion definida en el archivo, ni funcion de `_lib.sh` cuando el archivo lo importa, ni builtin,
# ni keyword, ni binario en PATH. Para que eso no sea ruidoso hay tres podas, y las tres tienen su
# fixture en `guard-gates.test.sh`: se vacia el contenido entrecomillado (un `;` adentro de un
# string no separa comandos), se saltea el cuerpo de los heredocs, y se ignoran las asignaciones.
set -uo pipefail
cd "$(dirname "$0")/.."
. scripts/_lib.sh

# Raiz auditada. Por default el repo; `GATES_ROOT` la mueve a un arbol de fixtures para que
# `scripts/guard-gates.test.sh` pueda ver a ESTE gate encenderse. Un gate que nunca se vio fallar
# es un adorno, y los adornos ensenian a ignorar los gates de al lado.
RAIZ="${GATES_ROOT:-.}"
export GATES_ROOT="$RAIZ"

sec "G1 · ningun gate invoca un helper que no tiene"

SALIDA=$(BUILTINS="$( { compgen -b; compgen -k; } 2>/dev/null | tr '\n' ' ')" python3 - <<'PY'
import os, re, sys, glob, shutil

RAIZ = os.environ.get('GATES_ROOT', '.')
SCRIPTS = sorted(glob.glob(os.path.join(RAIZ, 'scripts', '*.sh')))
LIB_PATH = os.path.join(RAIZ, 'scripts', '_lib.sh')
if not SCRIPTS:
    print("FAIL\tno hay ningun scripts/*.sh bajo %s. Ausencia de medicion = FAIL, nunca PASS." % RAIZ)
    print("TOTAL\t1")
    sys.exit(0)

BUILTINS = set(os.environ.get('BUILTINS', '').split())
# `[[`, `[`, `:` y demas no siempre salen de compgen segun la version.
BUILTINS |= {'[', '[[', ']]', ':', '.', 'source', 'function', 'time', 'coproc', 'select', 'in', 'esac', 'fi', 'done'}

# Indentado a proposito: `accept-s1.sh` define `q()` adentro de un `if`, y `_lib.sh` define
# `mtime()` adentro de un `case`. Anclar en columna 0 los habria reportado como inexistentes.
DEF = re.compile(r'^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\(\)')
SRC = re.compile(r'^\s*(?:\.|source)\s+\S*_lib\.sh')
HD  = re.compile(r"<<-?\s*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\1")
CAND = re.compile(r'(?:^|;|&&|\|\||\bthen\b|\belse\b|\bdo\b|\{|\()\s*([a-z_][a-z0-9_]{1,})(?=\s|$)')

def definidos(path):
    return {m.group(1) for m in (DEF.match(l) for l in open(path, encoding='utf-8')) if m}

def sourcea_lib(path):
    return any(SRC.match(l) for l in open(path, encoding='utf-8'))

LIB = definidos(LIB_PATH) if os.path.exists(LIB_PATH) else set()

# El estado de comillas ATRAVIESA lineas: `node -e '...'` y `python3 -c '...'` meten JS y Python
# de varias lineas adentro de un string simple. Sin esto, cada `const x = 1` de esos bloques se
# leia como la invocacion de un comando `const` — 40 y pico de hallazgos de puro ruido, que es
# como se arruina un gate: no fallando de menos, fallando de mas hasta que se lo ignora.
def limpiar(cruda, comilla):
    salida = []
    i = 0
    while i < len(cruda):
        c = cruda[i]
        if comilla is None:
            if c == '#' and (i == 0 or cruda[i-1].isspace()):
                break
            if c in ('"', "'"):
                comilla = c
            salida.append(c)
        else:
            # `$( ... )` adentro de un string abre un contexto nuevo donde las comillas vuelven a
            # empezar. Sin contar parentesis, la `"` de `"$(printf "import ...` cerraba la de
            # afuera y el JS de adentro pasaba a leerse como comandos.
            if c == '$' and i + 1 < len(cruda) and cruda[i+1] == '(':
                prof = 0
                while i < len(cruda):
                    if cruda[i] == '(':
                        prof += 1
                    elif cruda[i] == ')':
                        prof -= 1
                        if prof == 0:
                            break
                    i += 1
            elif c == comilla:
                comilla = None
                salida.append(c)
            # lo de adentro se descarta
        i += 1
    l = ''.join(salida)
    l = re.sub(r'"[^"]*"', '""', l)
    l = re.sub(r"'[^']*'", "''", l)
    # `FOO=bar cmd` y `local x=1`: la asignacion no es una invocacion.
    l = re.sub(r'\b[A-Za-z_][A-Za-z0-9_]*\+?=\S*', '', l)
    return l, comilla

# Excepcion declarada, con el mismo contrato que `web-lint:sin-tenant`: motivo escrito, en la
# misma linea, de 20+ caracteres. Una excepcion se declara y se explica; la alternativa no es
# "sin excepcion", es la excepcion invisible, que es lo que la regla vino a matar.
MARCA = re.compile(r'#\s*guard-gates:a-proposito\s+(.{20,})')

roto = 0
auditados = 0
for f in SCRIPTS:
    # `_lib.sh` SI entra a G1, y este comentario es el arreglo de T20 (LEAD, 2026-08-28).
    # Lo saltea G2 mas abajo, con motivo, porque alli seria vacuo. Aca no lo es: la libreria
    # tambien puede invocar algo que no resuelve, y es el UNICO archivo donde eso se propaga a los
    # otros veinte de una vez. Que fuera justo el archivo no auditado lo encontro `docs-keeper`
    # discutiendo el numero impreso conmigo; los dos habiamos leido media implementacion y los dos
    # afirmamos lo contrario de lo que dice el codigo. Esta en ADR-020, aplicada a si misma.
    propios = definidos(f)
    auditados += 1
    disponibles = propios | (LIB if sourcea_lib(f) else set()) | BUILTINS
    term = None
    comilla = None
    continuacion = False
    for i, linea in enumerate(open(f, encoding='utf-8'), 1):
        cruda = linea.rstrip('\n')
        # Una linea que continua a la anterior (`\` al final) es CONTEXTO DE ARGUMENTOS, no de
        # comando: `grep ... \` + `      packages apps` no invoca `packages`.
        sigue = continuacion
        continuacion = cruda.rstrip().endswith('\\')
        if term is not None:
            if cruda.strip() == term:
                term = None
            continue
        m = HD.search(cruda)
        if m:
            term = m.group(2)
        limpia, comilla = limpiar(cruda, comilla)
        # La contabilidad de comillas se hace SIEMPRE, incluso en una linea de continuacion: la
        # linea `  | python3 -c '` que abre el Python embebido de `guard-leaks.sh` es justamente
        # una continuacion, y saltearla entera dejaba todo el cuerpo Python leyendose como shell.
        if sigue or MARCA.search(cruda):
            continue
        for n in set(CAND.findall(limpia)):
            if n in disponibles or shutil.which(n):
                continue
            print("FAIL\t%s:%d: invoca `%s`, que no resuelve a nada: ni funcion de aca, ni de" % (f, i, n))
            print("    \t_lib.sh, ni builtin, ni binario en PATH.  %s" % cruda.strip()[:100])
            roto += 1

# G2 — la causa raiz: un helper que _lib.sh ya da, redefinido adentro de un gate. Dos copias
# derivan, y cuando derivan nadie lo ve. `chk`/`have` estuvieron asi hasta hoy.
for f in SCRIPTS:
    # Aca el salteo de `_lib.sh` SI es correcto y por eso queda: G2 caza al gate que REDEFINE un
    # helper que la libreria ya da, y `_lib.sh` es la libreria — sus definiciones son el original,
    # no una copia que derive. Auditarlo aca reportaria las 12 como duplicadas de si mismas.
    if os.path.basename(f) == '_lib.sh' or not sourcea_lib(f):
        continue
    for n in sorted(definidos(f) & LIB):
        print("FAIL\t%s: redefine `%s`, que ya viene de _lib.sh. Dos copias derivan." % (f, n))
        roto += 1

print("AUDITADOS\t%d" % auditados)
print("TOTAL\t%d" % roto)
sys.exit(0)
PY
)

HALL=$(echo "$SALIDA" | grep -c '^FAIL' || true)
# El numero que se imprime es el de los archivos que G1 AUDITO, y lo dice el barrido: hasta hoy
# salia de un `ls` de `scripts/*.sh`, o sea contaba 21 mientras auditaba 20 —`_lib.sh` quedaba
# afuera de los dos `for`—. Un mensaje de exito que cuenta de mas es la misma falla que este gate
# existe para cazar, escrita en el gate: afirma sobre un conjunto que no es el que midio. T20.
# Ausencia de la linea = FAIL, nunca PASS: sin `AUDITADOS` no se sabe sobre que se esta afirmando.
AUD=$(echo "$SALIDA" | sed -nE 's/^AUDITADOS\t([0-9]+)$/\1/p' | head -1)
if [ -z "$AUD" ]; then
  no "el barrido no emitio AUDITADOS: no se puede afirmar sobre cuantos scripts se midio"
elif [ "$HALL" = "0" ]; then
  ok "los $AUD scripts auditados resuelven todos los helpers que invocan"
else
  no "$HALL invocacion(es) de un helper inexistente o duplicado (sobre $AUD scripts auditados)"
  echo "$SALIDA" | grep -vE '^TOTAL|^AUDITADOS' | sed 's/^/        /'
fi

sec "G3 · todo gate de paquete se declara del LEAD (CLAUDE.md §4 · ADR-022)"

# ── Por que esta seccion existe, LEAD 2026-08-28 ────────────────────────────────────────────────
# ADR-022 dice "todo `*-lint.mjs` es del LEAD, viva donde viva". Censar la clase mostro que la
# regla no la cubre: el `lint` de `packages/domain` es `scripts/purity-check.mjs`, que NO termina
# en `-lint.mjs` y por lo tanto quedaba adentro de `packages/domain/**` — o sea de `domain-agent`,
# el writer cuya pureza audita. Mismo agujero que ADR-022 vino a tapar, reabierto un nivel arriba:
# una regla que nombra un SUFIJO en vez de la clase falla igual que la que nombraba un archivo.
#
# Asi que el sujeto de esta seccion no es el nombre del archivo, es **que un `package.json` lo
# corra como gate**. Eso se censa, no se recuerda — y es la unica forma de que un gate nuevo
# escrito por el writer que audita rompa el dia que nace y no la vez que a alguien se le ocurra
# mirar. Lo que se exige es una marca, `gate-owner: LEAD`, en el encabezado del archivo: barata de
# poner, imposible de poner sin querer.
#
# Los que viven bajo `scripts/` estan exentos y no por comodidad: `scripts/**` YA es del LEAD por
# fila propia de §4, y ahi no hay ambiguedad de lectura que resolver. La marca existe para el
# archivo que vive adentro de la columna de otro.

SALIDA3=$(python3 - <<'PY3'
import os, re, sys, json

RAIZ = os.environ.get('GATES_ROOT', '.')
CLAVES = ('lint', 'guard', 'check', 'verify', 'audit')
MARCA = 'gate-owner: LEAD'
EXT = ('.mjs', '.cjs', '.js', '.sh')

pkgs = []
for dirpath, dirnames, filenames in os.walk(RAIZ):
    dirnames[:] = [d for d in dirnames if d not in ('node_modules', '.git', '.next', 'dist')]
    if 'package.json' in filenames:
        pkgs.append(os.path.join(dirpath, 'package.json'))
pkgs.sort()

if not pkgs:
    print("FAIL\tno hay ningun package.json bajo %s. Ausencia de medicion = FAIL, nunca PASS." % RAIZ)
    print("CENSADOS\t0"); sys.exit(0)

raiz_scripts = os.path.normpath(os.path.join(RAIZ, 'scripts'))
vistos, roto = {}, 0

for pkg in pkgs:
    try:
        scripts = (json.load(open(pkg, encoding='utf-8')) or {}).get('scripts') or {}
    except Exception as e:
        print("FAIL\t%s no se puede leer (%s). Un package.json ilegible esconde sus gates." % (pkg, e))
        roto += 1
        continue
    base = os.path.dirname(pkg)
    for k, cmd in scripts.items():
        if k not in CLAVES and not k.startswith('lint:'):
            continue
        # El target es el unico token del comando que parece un archivo del repo. `pnpm audit` y
        # `tsc -p ...` no nombran ninguno: no tienen archivo que marcar y no se cuentan.
        for tok in re.split(r'\s+', str(cmd).strip()):
            if not tok.endswith(EXT) or ('/' not in tok):
                continue
            dest = os.path.normpath(os.path.join(base, tok))
            if dest in vistos:      # `e2e` y `tests` comparten `qa-lint.mjs`
                continue
            vistos[dest] = '%s (%s)' % (pkg, k)
            if not os.path.isfile(dest):
                print("FAIL\t%s corre `%s` -> %s, que NO EXISTE. Un gate fantasma reporta salud que nadie midio." % (pkg, k, dest))
                roto += 1
                continue
            if os.path.normpath(dest).startswith(raiz_scripts + os.sep):
                continue            # `scripts/**` ya es del LEAD por fila propia de §4
            cab = ''.join(open(dest, encoding='utf-8', errors='replace').readlines()[:40])
            if MARCA not in cab:
                print("FAIL\t%s no declara `%s` en sus primeras 40 lineas. Lo corre %s, vive en la columna de otro writer, y el gate no puede ser del writer que audita (§4, ADR-022)." % (dest, MARCA, vistos[dest]))
                roto += 1

print("CENSADOS\t%d" % len(vistos))
PY3
)

CEN=$(echo "$SALIDA3" | sed -nE 's/^CENSADOS\t([0-9]+)$/\1/p' | head -1)
HALL3=$(echo "$SALIDA3" | grep -c '^FAIL' || true)
if [ -z "$CEN" ]; then
  no "el censo de gates no emitio CENSADOS: no se sabe sobre cuantos se esta afirmando"
elif [ "$CEN" = "0" ]; then
  # Medir cero no es aprobar. Un repo sin un solo `package.json` que corra un gate es un repo sin
  # gates de paquete, y eso es el hallazgo, no el veredicto verde.
  no "cero gates de paquete censados: o el censo se rompio o no hay ninguno. Las dos cosas son FAIL"
  echo "$SALIDA3" | grep -v '^CENSADOS' | sed 's/^/        /'
elif [ "$HALL3" = "0" ]; then
  ok "los $CEN gates que corren desde un package.json existen y se declaran del LEAD"
else
  no "$HALL3 de $CEN gates de paquete sin dueno declarado o inexistentes"
  echo "$SALIDA3" | grep -v '^CENSADOS' | sed 's/^/        /'
fi

sec "G4 · todo gate del repo corre en CI (o dice por escrito por que no)"

# ── Por que existe, LEAD 2026-08-28 ─────────────────────────────────────────────────────────────
# `ci.yml` tiene CUATRO comentarios distintos contando la misma historia con distinto nombre:
# `guard-routes`, `guard-grants`, `accept-fase2` y `accept-fase3` se escribieron, quedaron afuera
# del workflow, y estuvieron ROJOS —o vacuamente verdes— sin que nadie se enterara. `accept-fase2`
# llevaba semanas. Cada vez lo encontro un humano mirando, y cada vez se arreglo agregando ESE
# archivo. Cuatro instancias arregladas de a una es la firma de una clase sin gate.
#
# Es literalmente el defecto de T28 un nivel mas arriba. Alli el dueno de un gate se recordaba en
# vez de censarse; aca la EJECUCION de un gate se recuerda en vez de censarse. La forma de la
# solucion es la misma: enumerar la clase con un comando en vez de confiar en que alguien mire.
#
# La exencion se declara, no se omite — mismo idioma que `web-lint:sin-tenant`. Un gate que a
# proposito no corre en CI (porque pide una credencial que CI no tiene, porque tarda 40 minutos)
# escribe `ci-exento: <motivo>` en sus primeras 40 lineas, con 30+ caracteres de motivo. La
# alternativa a una exencion escrita no es "sin exencion": es la exencion invisible, que es
# exactamente lo que estas cuatro veces fueron.
#
# ── Y la SEXTA instancia fue de este gate, LEAD 2026-08-28 ────────────────────────────────────
# La quinta la agarro este censo el minuto en que nacio `accept-s7.sh`, que es para lo que se
# escribio. La sexta la agarro un humano, otra vez, y era de aca: **`ci.yml` no parseaba**. Lo
# rompio `c2aa5d2` con un `- name: polaridad de ai-lint (A010: la evidencia...)` sin comillas —
# un escalar sin citar con `: ` adentro es una entrada de mapping para YAML— y estuvo asi dos
# commits. GitHub no corre 42 de 43 pasos ante un yml invalido: **no corre NINGUNO**, y ni
# siquiera reporta rojo en los checks del PR, porque no hay workflow que reportar. O sea que es
# peor que las cuatro anteriores, donde al menos el resto del workflow corria.
#
# Y este gate decia PASS. Miraba el archivo como TEXTO, asi que la pregunta que contestaba era
# "¿esta escrito el nombre?" y no "¿se va a ejecutar?". Es exactamente el defecto que este repo
# persigue —verde por el motivo equivocado— en el gate que lo persigue.
#
# De ahi las dos mitades de abajo, y la segunda tapa un hueco que hoy esta LATENTE y no vivo (lo
# medi: hoy ningun gate depende de el). Un `grep` de texto tambien cuenta como "corre en CI" un
# nombre que aparece **en un comentario**, y este mismo archivo tiene comentarios que nombran a
# `guard-routes`, `guard-grants`, `accept-fase2` y `accept-fase3` justo para contar que se
# habian quedado afuera. Borrar el `run:` y dejar la historia escrita arriba habria dejado el
# censo verde. El censo mira ahora **solo los `run:` de los steps parseados**.
# `node` + `js-yaml` (devDependency EXPLICITA desde hoy: era transitiva de eslint, o sea que este
# gate dependia de que otro paquete no cambiara sus deps). Si el parser no esta, esto es FAIL y no
# skip: "ausencia de medicion es FAIL, nunca PASS".
CI_YML=".github/workflows/ci.yml"
[ -n "${GATES_ROOT:-}" ] && CI_YML="$GATES_ROOT/.github/workflows/ci.yml"
CI_RUNS=$(CI_YML="$CI_YML" node -e '
  const yaml = require("js-yaml"), fs = require("fs");
  const p = process.env.CI_YML;
  if (!fs.existsSync(p)) { console.error("no existe " + p); process.exit(2); }
  let doc;
  try { doc = yaml.load(fs.readFileSync(p, "utf8")); }
  catch (e) { console.error("YAML INVALIDO en " + p + " linea " + ((e.mark && e.mark.line + 1) || "?") + ": " + (e.reason || e.message)); process.exit(3); }
  if (!doc || !doc.jobs) { console.error(p + " parsea pero no declara `jobs`"); process.exit(4); }
  const runs = [];
  for (const j of Object.keys(doc.jobs)) for (const st of (doc.jobs[j].steps || [])) if (st.run) runs.push(st.run);
  if (runs.length === 0) { console.error(p + " no tiene un solo step con `run:`"); process.exit(5); }
  process.stdout.write(runs.join("\n"));
' 2>&1)
if [ $? -ne 0 ]; then
  no "ci.yml no se puede ejecutar, asi que ningun gate corre: $CI_RUNS"
  CI_RUNS=''
  CENSO4_VIVO=0
else
  CENSO4_VIVO=1
fi

SALIDA4=$(CI_RUNS="$CI_RUNS" python3 - <<'PY4'
import os, re, sys

RAIZ = os.environ.get('GATES_ROOT', '.')
CI   = os.path.join(RAIZ, '.github', 'workflows', 'ci.yml')
MARCA = 'ci-exento:'

if not os.path.isfile(CI):
    print("FAIL\tno existe %s: no se puede afirmar que ningun gate corra en CI." % CI)
    print("CENSADOS\t0"); sys.exit(0)

# `ci` NO es el archivo: son los `run:` de los steps que el YAML parseado declara, concatenados.
# La diferencia es la que separa "el nombre esta escrito" de "el comando se ejecuta". Ver el
# docblock de arriba: los comentarios de `ci.yml` nombran cuatro gates justamente para contar que
# NO corrian, asi que un censo textual los daba por corriendo.
ci = os.environ.get('CI_RUNS', '')

# Los gates del repo: `scripts/accept-*.sh` y `scripts/guard-*.sh`, mas sus arneses `*.test.sh`.
# `_lib.sh` NO entra: es libreria, no se ejecuta (y su propio arnes `_lib.test.sh` si entra).
d = os.path.join(RAIZ, 'scripts')
gates = sorted(f for f in os.listdir(d)
               if f.endswith('.sh') and f != '_lib.sh'
               and (f.startswith('accept-') or f.startswith('guard-') or f.endswith('.test.sh')))

roto = 0
for f in gates:
    # Se busca el nombre del archivo en el yml, no la linea entera: da igual si lo invoca
    # `./scripts/x.sh`, `bash scripts/x.sh` o desde un `if:`. Lo que se afirma es que CI lo NOMBRA.
    if re.search(r'(^|[/\s])' + re.escape(f) + r'(\s|$)', ci, re.M):
        continue
    cab = ''.join(open(os.path.join(d, f), encoding='utf-8', errors='replace').readlines()[:40])
    m = re.search(re.escape(MARCA) + r'[ \t]*(.+)', cab)
    if m and len(m.group(1).strip()) >= 30:
        continue
    if m:
        print("FAIL\tscripts/%s declara `%s` con un motivo de %d caracteres; se piden 30+. Un motivo que no explica nada es una exencion invisible con mas pasos." % (f, MARCA, len(m.group(1).strip())))
    else:
        print("FAIL\tscripts/%s no aparece en ci.yml y no declara `%s <motivo>`. Un gate que no corre se pone rojo y nadie se entera: paso cuatro veces (guard-routes, guard-grants, accept-fase2, accept-fase3)." % (f, MARCA))
    roto += 1

print("CENSADOS\t%d" % len(gates))
PY4
)

CEN4=$(echo "$SALIDA4" | sed -nE 's/^CENSADOS\t([0-9]+)$/\1/p' | head -1)
HALL4=$(echo "$SALIDA4" | grep -c '^FAIL' || true)
if [ -z "$CEN4" ]; then
  no "el censo de ejecucion no emitio CENSADOS: no se sabe sobre cuantos gates se esta afirmando"
elif [ "$CEN4" = "0" ]; then
  no "cero gates censados en scripts/: o el censo se rompio o no hay ninguno. Las dos cosas son FAIL"
  echo "$SALIDA4" | grep -v '^CENSADOS' | sed 's/^/        /'
elif [ "$HALL4" = "0" ]; then
  ok "los $CEN4 gates de scripts/ estan nombrados en ci.yml o declaran su exencion"
else
  no "$HALL4 de $CEN4 gates no corren en CI ni dicen por que"
  echo "$SALIDA4" | grep -v '^CENSADOS' | sed 's/^/        /'
fi

sec "G5 · toda probe de scripts/probes/ la corre alguien, y tsc la alcanza"

# ── Por que existe, LEAD 2026-08-28 (`T31` del board) ───────────────────────────────────────────
# `scripts/probes/**` son los tests mas caros del repo: los que miden contra Postgres de verdad,
# los que sostienen la linea MEDIDO de cada `accept-*.sh`. Y no los alcanza NINGUNA de las dos
# redes que el repo cree tener. `pnpm typecheck` y `pnpm test` son `pnpm -r` sobre los workspaces
# de `pnpm-workspace.yaml` —`apps/*`, `packages/*`, `tests`, `e2e`— y `scripts/` no esta en
# ninguno. O sea: una probe puede quedar sin ejecutor, o dejar de compilar, y el veredicto entero
# sigue verde.
#
# G5 son dos preguntas distintas y por eso son dos mitades:
#
# a · **¿la corre alguien?** Es G4 aplicado a las probes: alli el censo es de gates y la respuesta
#     vive en `ci.yml`; aca el censo es de probes y la respuesta vive en los `accept-*.sh`. Hoy
#     las ocho estan nombradas — lo medi antes de escribir esto, cero huerfanas — asi que este
#     medio gate nace verde y cubre una clase LATENTE. Se escribe igual, por el mismo motivo que
#     G4: las cuatro instancias de "un gate quedo afuera de CI" tambien fueron latentes hasta que
#     dejaron de serlo, y las cuatro las encontro un humano mirando.
#
# b · **¿compila?** Esta NO nacio verde, y es la mitad que justifica la fecha. La primera corrida
#     de `tsc` sobre `scripts/tsconfig.json` encontro CUATRO errores reales en tres probes, uno de
#     ellos en la probe de S7 escrita ese mismo dia: `TS2367`, una comparacion que el compilador
#     puede probar imposible. Era la segunda mitad de la medicion `costo_del_form_ignorado`, o sea
#     una asercion que no podia fallar adentro del campo que afirma que el costo del form se
#     ignora. Tirando de ese hilo aparecio lo de fondo: el valor contra el que la probe decia
#     comparar NI SIQUIERA era el que el form mandaba. Una probe que no compila es una probe que
#     miente en silencio, y esa clase estaba entera afuera del veredicto.
#
# La exencion se declara, no se omite —`probe-huerfana: <motivo>`, 30+ caracteres, en las primeras
# 40 lineas— y es el mismo idioma que `ci-exento` de G4 y `web-lint:sin-tenant`.

PROBES_DIR="$RAIZ/scripts/probes"
CEN5=0
HALL5=0
if [ -d "$PROBES_DIR" ]; then
  for probe in "$PROBES_DIR"/*.test.ts; do
    [ -e "$probe" ] || continue
    CEN5=$((CEN5 + 1))
    base=$(basename "$probe")
    # Quien puede correrla: un `accept-*.sh`, un `guard-*.sh`, o `ci.yml` directamente. El filtro
    # de comentarios es la leccion de la segunda mitad de G4 y de `guard-effects` en S7: un gate
    # que lee texto contesta "¿esta escrito?" cuando la pregunta es "¿se ejecuta?".
    corredores=$(grep -l "$base" "$RAIZ"/scripts/accept-*.sh "$RAIZ"/scripts/guard-*.sh \
                   "$RAIZ/.github/workflows/ci.yml" 2>/dev/null | while IFS= read -r f; do
                     grep -vE '^[[:space:]]*#' "$f" | grep -q "$base" && echo "$f"
                   done)
    if [ -n "$corredores" ]; then
      ok "$base la corre $(printf '%s' "$corredores" | tr '\n' ' ' | sed 's/ $//')"
      continue
    fi
    motivo=$(head -40 "$probe" | sed -nE 's/.*probe-huerfana:[[:space:]]*(.*)/\1/p' | head -1)
    largo=${#motivo}
    if [ "$largo" -ge 30 ]; then
      ok "$base no la corre nadie, y esta declarado"
      inf "$motivo"
    elif [ -n "$motivo" ]; then
      no "$base declara \`probe-huerfana\` con un motivo de $largo caracteres: hacen falta 30+. Un motivo de una palabra es la exencion invisible con otro nombre"
      HALL5=$((HALL5 + 1))
    else
      no "$base no la nombra ningun accept-*.sh ni guard-*.sh ni ci.yml: es una probe huerfana. \`pnpm test\` NO la alcanza (scripts/ no es workspace), asi que puede estar rota desde hace meses y el veredicto sigue verde. Dale un corredor, o escribile \`probe-huerfana: <motivo>\` de 30+ caracteres"
      HALL5=$((HALL5 + 1))
    fi
  done
fi

if [ "$CEN5" -eq 0 ]; then
  no "cero probes censadas en $PROBES_DIR: o el censo se rompio o el directorio desaparecio. Ausencia de medicion es FAIL, nunca PASS"
elif [ "$HALL5" -eq 0 ]; then
  ok "las $CEN5 probes de scripts/probes/ tienen quien las corra"
fi

# ── b · que `tsc` las alcance ───────────────────────────────────────────────────────────────────
# Corre solo contra el arbol REAL. Bajo `GATES_ROOT` no puede correr y la razon no es pereza:
# `tsc` necesita `tsconfig.base.json`, `node_modules` y los paths del monorepo, o sea todo lo que
# un arbol de fixtures sintetico justamente no tiene. Un chequeo que ahi fallara siempre pondria
# rojo cada fixture de G1–G4 por un motivo ajeno, que es el defecto que este arnes vino a evitar.
# La mitad `a` si respeta la escotilla y es la que el arnes ejerce.
if [ "$RAIZ" = "." ]; then
  if [ ! -f scripts/tsconfig.json ]; then
    no "falta scripts/tsconfig.json: sin el, ningun \`tsc\` mira las probes y una que no compile pasa desapercibida. \`pnpm typecheck\` no las cubre — \`scripts/\` no es un workspace"
  elif SALIDA5=$(./node_modules/.bin/tsc -p scripts/tsconfig.json --noEmit 2>&1); then
    ok "las $CEN5 probes compilan bajo scripts/tsconfig.json"
  else
    no "las probes no compilan. Una probe que no compila no es un test que falla: es un test que mide otra cosa y lo dice en verde"
    printf '%s\n' "$SALIDA5" | sed 's/^/        /' | head -8
  fi
else
  inf "G5b (tsc) no corre bajo GATES_ROOT: pide tsconfig.base.json, node_modules y los paths del monorepo"
fi

echo
if [ "$fail" -eq 0 ]; then printf '\033[32mGUARD-GATES: PASS\033[0m\n'; else printf '\033[31mGUARD-GATES: FAIL\033[0m\n'; fi
exit "$fail"
