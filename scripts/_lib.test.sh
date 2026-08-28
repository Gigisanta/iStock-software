#!/usr/bin/env bash
# Polaridad de `scripts/_lib.sh`.  Un helper que nunca se vio fallar no es un helper.
#
# Esto es la contrapartida de haber centralizado (T4). El argumento en contra de extraer era "un
# gate que importa de otro gate se rompe de a dos"; la respuesta es este archivo, que corre en CI y
# prueba cada helper en las DOS polaridades. Las tres reglas que se prueban aca ya estuvieron
# muertas en produccion — no son hipotesis:
#   - el filtro de comentarios de `none()` mataba la regla del `TODO: despues el RLS` (3 gates)
#   - `noneraw()` existe justamente para esa clase, y tiene que atrapar lo que `none()` descarta
#   - el `git check-ignore` esta porque `tsconfig.tsbuildinfo` matcheaba contra cualquier patron
set -uo pipefail
cd "$(dirname "$0")/.."
. scripts/_lib.sh

T="scripts/.libtest-tmp"
rm -rf "$T"; mkdir -p "$T"
trap 'rm -rf "$T"' EXIT

printf 'const x = "AGUJA_REAL";\n'                  > "$T/sucio.ts"
printf 'const x = 1;\n'                             > "$T/limpio.ts"
printf '// AGUJA_REAL: esto es solo un comentario\n' > "$T/comentado.ts"
printf 'const y = "AGUJA_REAL";\n'                  > "$T/ignorado.ts"
printf 'ignorado.ts\n'                              > "$T/.gitignore"

tfail=0
caso() { # caso <que> <esperado:PASS|FAIL> <salida del helper>
  local que="$1" esperado="$2" salida="$3" visto
  case "$salida" in *PASS*) visto=PASS ;; *FAIL*) visto=FAIL ;; *) visto="(nada)" ;; esac
  if [ "$visto" = "$esperado" ]; then printf '  \033[32mok\033[0m    %s → %s\n' "$que" "$visto"
  else printf '  \033[31mMAL\033[0m   %s → esperaba %s, dio %s\n' "$que" "$esperado" "$visto"; tfail=1; fi; }

printf '\n\033[1m── none(): las dos polaridades\033[0m\n'
caso "none no ve nada en un arbol limpio"           PASS "$(none d AGUJA_REAL "$T/limpio.ts")"
caso "none ATRAPA una aguja de verdad"              FAIL "$(none d AGUJA_REAL "$T/sucio.ts")"
caso "none ignora la aguja dentro de un comentario" PASS "$(none d AGUJA_REAL "$T/comentado.ts")"

printf '\n\033[1m── noneraw(): la clase que none() no puede ver\033[0m\n'
caso "noneraw ATRAPA la aguja comentada"            FAIL "$(noneraw d AGUJA_REAL "$T/comentado.ts")"
caso "noneraw no inventa en un arbol limpio"        PASS "$(noneraw d AGUJA_REAL "$T/limpio.ts")"

printf '\n\033[1m── git check-ignore: artefacto de build != codigo nuestro\033[0m\n'
caso "none saltea un archivo git-ignored"           PASS "$(none d AGUJA_REAL "$T/ignorado.ts")"
caso "none SI mira un archivo sin commitear"        FAIL "$(none d AGUJA_REAL "$T/sucio.ts")"

printf '\n\033[1m── el contador `fail`\033[0m\n'
fail=0; ok "x"   >/dev/null; [ "$fail" = "0" ] \
  && printf '  \033[32mok\033[0m    ok() no ensucia fail\n' \
  || { printf '  \033[31mMAL\033[0m   ok() puso fail=%s\n' "$fail"; tfail=1; }
fail=0; no "x"   >/dev/null; [ "$fail" = "1" ] \
  && printf '  \033[32mok\033[0m    no() pone fail=1\n' \
  || { printf '  \033[31mMAL\033[0m   no() dejo fail=%s\n' "$fail"; tfail=1; }

printf '\n\033[1m── la libreria no se ejecuta, se importa\033[0m\n'
if bash scripts/_lib.sh >/dev/null 2>&1; then
  printf '  \033[31mMAL\033[0m   scripts/_lib.sh se dejo ejecutar directo\n'; tfail=1
else
  printf '  \033[32mok\033[0m    ejecutarla directo sale distinto de cero\n'
fi

if [ "$tfail" = "0" ]; then printf '\n\033[1;32m_lib.sh: OK\033[0m\n'; else printf '\n\033[1;31m_lib.sh: ROTO\033[0m\n'; fi
exit "$tfail"
