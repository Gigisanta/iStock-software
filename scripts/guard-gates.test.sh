#!/usr/bin/env bash
# Polaridad de `scripts/guard-gates.sh`. Cada fixture tiene que verse ENCENDER o quedarse quieto.
#
# El primer fixture es el bug real del 2026-08-28, reducido: un gate que llama a `chk` sin tenerlo.
# Los dos ultimos son regresiones de falsos positivos que este mismo gate tuvo mientras se escribia
# —un `;` adentro de un string, y un cuerpo de heredoc— y que lo habrian vuelto ruidoso, o sea
# ignorable.
set -uo pipefail
cd "$(dirname "$0")/.."

T="scripts/.gatestest-tmp"
rm -rf "$T"; mkdir -p "$T/scripts"
trap 'rm -rf "$T"' EXIT
cp scripts/_lib.sh "$T/scripts/_lib.sh"

tfail=0
caso() { # caso <que> <esperado:PASS|FAIL>
  local que="$1" esperado="$2" visto salida
  salida=$(GATES_ROOT="$T" ./scripts/guard-gates.sh 2>&1)
  case "$salida" in *GUARD-GATES:\ PASS*) visto=PASS ;; *) visto=FAIL ;; esac
  if [ "$visto" = "$esperado" ]; then printf '  \033[32mok\033[0m    %s → %s\n' "$que" "$visto"
  else
    printf '  \033[31mMAL\033[0m   %s → esperaba %s, dio %s\n' "$que" "$esperado" "$visto"; tfail=1
    echo "$salida" | sed 's/^/          /'
  fi
  rm -f "$T"/scripts/fixture*.sh; }

printf '\n\033[1m── el bug real: helper prestado de otro gate\033[0m\n'

printf '#!/usr/bin/env bash\n. scripts/_lib.sh\nchk "x" "true"\n' > "$T/scripts/fixture.sh"
caso "el _lib del fixture SI trae chk: el gate calla" PASS

# `_lib.sh` sin chk/have — el arbol tal como estaba antes del arreglo de hoy.
grep -v '^chk()\|^have()' scripts/_lib.sh > "$T/scripts/_lib.sh"
printf '#!/usr/bin/env bash\n. scripts/_lib.sh\nchk "x" "true"\nhave algo.ts\n' > "$T/scripts/fixture.sh"
caso "ATRAPA el arbol de ayer: chk/have invocados sin existir" FAIL
cp scripts/_lib.sh "$T/scripts/_lib.sh"

printf '#!/usr/bin/env bash\nchk() { :; }\nchk "x" "true"\n' > "$T/scripts/fixture.sh"
caso "un gate que define su propio chk y NO importa _lib: legitimo" PASS

printf '\n\033[1m── G2: la causa raiz, dos copias del mismo helper\033[0m\n'
printf '#!/usr/bin/env bash\n. scripts/_lib.sh\nchk() { :; }\nchk "x" "true"\n' > "$T/scripts/fixture.sh"
caso "ATRAPA redefinir un helper que _lib.sh ya da" FAIL

printf '\n\033[1m── T20: el gate se audita a si mismo, y su numero es el que midio\033[0m\n'
# Hasta hoy `_lib.sh` quedaba afuera de los dos `for` y el mensaje de exito contaba con un `ls`:
# 21 impresos, 20 auditados. Justo el archivo no auditado era la libreria que importan los otros
# veinte, o sea donde un helper inexistente se propaga a todos de una vez. Lo encontro
# `docs-keeper` discutiendo el numero conmigo, con las dos versiones equivocadas en direcciones
# opuestas por haber leido media implementacion cada uno. ADR-020, aplicada a si misma.
cp scripts/_lib.sh "$T/scripts/_lib.sh"
printf '#!/usr/bin/env bash\n. scripts/_lib.sh\nok "sano"\n' > "$T/scripts/fixture.sh"
caso "el arbol sano del fixture, con _lib.sh adentro del barrido" PASS

printf '\nlibreria_rota() { helper_que_no_existe_en_ningun_lado "$1"; }\n' >> "$T/scripts/_lib.sh"
caso "ATRAPA una invocacion rota DENTRO de _lib.sh (se propaga a los otros veinte)" FAIL
cp scripts/_lib.sh "$T/scripts/_lib.sh"

# El otro polo de T20: G2 tiene que SEGUIR salteando `_lib.sh`. Sus definiciones son el original,
# no una copia que derive; auditarlo alli reportaria cada helper como duplicado de si mismo.
printf '#!/usr/bin/env bash\n. scripts/_lib.sh\nok "sano"\n' > "$T/scripts/fixture.sh"
caso "G2 no acusa a _lib.sh de duplicar los helpers que el mismo define" PASS

printf '\n\033[1m── falsos positivos que tuvo mientras se escribia (regresion)\033[0m\n'
printf '#!/usr/bin/env bash\n. scripts/_lib.sh\nok "apps/** no nombra el bucket; no puede pedirle un byte"\n' > "$T/scripts/fixture.sh"
caso "un ';' adentro de un string no es un separador de comandos" PASS

cat > "$T/scripts/fixture.sh" <<'FIX'
#!/usr/bin/env bash
. scripts/_lib.sh
python3 - <<'PY'
chk = 1
have = 2
PY
FIX
caso "el cuerpo de un heredoc no es codigo del gate" PASS

if [ "$tfail" = "0" ]; then printf '\n\033[1;32mguard-gates.sh: OK (se vio encender y se vio callar)\033[0m\n'
else printf '\n\033[1;31mguard-gates.sh: ROTO\033[0m\n'; fi
exit "$tfail"
