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
for f in SCRIPTS:
    if os.path.basename(f) == '_lib.sh':
        continue
    propios = definidos(f)
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
    if os.path.basename(f) == '_lib.sh' or not sourcea_lib(f):
        continue
    for n in sorted(definidos(f) & LIB):
        print("FAIL\t%s: redefine `%s`, que ya viene de _lib.sh. Dos copias derivan." % (f, n))
        roto += 1

print("TOTAL\t%d" % roto)
sys.exit(0)
PY
)

HALL=$(echo "$SALIDA" | grep -c '^FAIL' || true)
if [ "$HALL" = "0" ]; then
  ok "los $(ls "$RAIZ"/scripts/*.sh | wc -l | tr -d ' ') scripts resuelven todos los helpers que invocan"
else
  no "$HALL invocacion(es) de un helper inexistente o duplicado"
  echo "$SALIDA" | grep -vE '^TOTAL' | sed 's/^/        /'
fi

echo
if [ "$fail" -eq 0 ]; then printf '\033[32mGUARD-GATES: PASS\033[0m\n'; else printf '\033[31mGUARD-GATES: FAIL\033[0m\n'; fi
exit "$fail"
