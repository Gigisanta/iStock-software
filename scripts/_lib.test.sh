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

printf '\n\033[1m── mtime() / lstart_a_epoch(): portables, y probados en la plataforma donde corren\033[0m\n'
# La razon de existir de este bloque: `accept-s1.sh` uso `stat -f %m` y `date -j -f` hasta el
# 2026-08-28. Los dos son BSD. En `ubuntu-latest` el segundo falla y el PRIMERO NO: `stat -f` es
# `--file-system` en GNU, asi que devuelve un numero que no es un mtime y el guard de frescura
# del build compara basura sin quejarse. El bug no era invisible en CI: era VERDE en CI.
#
# Por eso el test no compara contra un valor fijo — compara contra el reloj. Un mtime que no es
# un mtime no cae en la ventana, cualquiera sea la plataforma.
ahora=$(date +%s)
: > "$T/recien.txt"
m=$(mtime "$T/recien.txt")
if [ -n "$m" ] && [ "$m" -ge "$((ahora - 120))" ] && [ "$m" -le "$((ahora + 120))" ]; then
  printf '  \033[32mok\033[0m    mtime de un archivo recien creado cae en la ventana del reloj\n'
else
  printf '  \033[31mMAL\033[0m   mtime dio "%s" y ahora es %s (no es un mtime)\n' "$m" "$ahora"; tfail=1
fi

if mtime "$T/no-existe-jamas.txt" >/dev/null 2>&1; then
  printf '  \033[31mMAL\033[0m   mtime de un archivo inexistente salio con exito\n'; tfail=1
else
  printf '  \033[32mok\033[0m    mtime de un archivo inexistente sale distinto de cero\n'
fi

ls=$(ps -p $$ -o lstart= 2>/dev/null | sed 's/^ *//;s/ *$//')
e=$(lstart_a_epoch "$ls")
if [ -n "$e" ] && [ "$e" -le "$((ahora + 120))" ] && [ "$e" -ge "$((ahora - 86400))" ]; then
  printf '  \033[32mok\033[0m    lstart_a_epoch parsea el lstart de este mismo proceso\n'
else
  printf '  \033[31mMAL\033[0m   lstart_a_epoch("%s") dio "%s"\n' "$ls" "$e"; tfail=1
fi

if lstart_a_epoch "esto no es una fecha" >/dev/null 2>&1; then
  printf '  \033[31mMAL\033[0m   lstart_a_epoch acepto una cadena que no es fecha\n'; tfail=1
else
  printf '  \033[32mok\033[0m    lstart_a_epoch rechaza lo que no es una fecha\n'
fi

printf '\n\033[1m── chk(): las dos polaridades\033[0m\n'
caso "chk aprueba cuando la condicion se cumple" PASS "$(chk d 'true')"
caso "chk RECHAZA cuando no se cumple"           FAIL "$(chk d 'false')"
caso "chk RECHAZA un comando que no existe"      FAIL "$(chk d 'comando_que_no_existe_jamas')"

printf '\n\033[1m── have(): existe Y no esta vacio\033[0m\n'
: > "$T/vacio.ts"
caso "have aprueba un archivo con contenido"     PASS "$(have "$T/limpio.ts")"
caso "have RECHAZA un archivo vacio"             FAIL "$(have "$T/vacio.ts")"
caso "have RECHAZA un archivo que no existe"     FAIL "$(have "$T/no-existe.ts")"

printf '\n\033[1m── command_not_found_handle(): una asercion no se puede evaporar\033[0m\n'
# El caso real del 2026-08-28: `accept-s1.sh` llamaba a `chk` y a `have` sin tenerlos importados.
# Bash imprime "command not found" por STDERR, devuelve 127 y sigue; `no()` no se llama y `fail`
# queda intacto. Once aserciones —entre ellas las cuatro que prueban contra Postgres que `anon` no
# lee `listings.imei` y que `listings` tiene RLS forzada— no se ejecutaron, y el gate habria salido
# VERDE de no ser por un FAIL ajeno. Las tres aserciones de abajo son las tres mitades del arreglo.
# El gancho es de bash >= 4.0. macOS ships 3.2.57, asi que aca hay que elegir entre un rojo
# permanente en la maquina donde mas se corre, o un skip. Se elige **skip DECLARADO con motivo**,
# que es la unica forma honesta: un skip mudo seria el mismo pecado que la asercion evaporada.
# La red que si corre en las dos plataformas es `scripts/guard-gates.sh`, y esa no tiene skip.
if [ "${BASH_VERSINFO[0]:-0}" -ge 4 ]; then
  caso "un comando inexistente imprime FAIL, no silencio" FAIL "$(comando_que_no_existe_jamas 2>/dev/null)"

  comando_que_no_existe_jamas >/dev/null 2>&1; rc=$?  # guard-gates:a-proposito el fixture de la polaridad ES un comando inexistente
  [ "$rc" = "127" ] \
    && printf '  \033[32mok\033[0m    devuelve 127 (no rompe `if cmd; then`, solo lo hace visible)\n' \
    || { printf '  \033[31mMAL\033[0m   devolvio %s en vez de 127\n' "$rc"; tfail=1; }
else
  printf '  \033[33mskip\033[0m  bash %s < 4.0: `command_not_found_handle` no existe en esta\n' "${BASH_VERSION%%(*}"
  printf '        plataforma. En CI (bash 5.x) SI corre. La cobertura de esta clase en las dos\n'
  printf '        plataformas la da scripts/guard-gates.sh, que es estatico.\n'
fi

fail=0; true
[ "$fail" = "0" ] \
  && printf '  \033[32mok\033[0m    un comando que SI existe no dispara nada\n' \
  || { printf '  \033[31mMAL\033[0m   el handler se disparo con un comando valido\n'; tfail=1; }

printf '\n\033[1m── puerto_ocupado: las dos direcciones, contra un socket de verdad\033[0m\n'
# No se mockea nada: se abre un socket real, se pregunta, se cierra y se vuelve a preguntar. Un
# helper de entorno testeado contra un stub prueba el stub.
PUERTO_T=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')

if puerto_ocupado "$PUERTO_T"; then
  printf '  \033[31mMAL\033[0m   dijo ocupado un puerto que nadie escucha (%s)\n' "$PUERTO_T"; tfail=1
else
  printf '  \033[32mok\033[0m    polo negativo: puerto libre -> no ocupado (%s)\n' "$PUERTO_T"
fi

python3 -c 'import socket,sys,time; s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1); s.bind(("127.0.0.1",int(sys.argv[1]))); s.listen(1); time.sleep(20)' "$PUERTO_T" &
PID_T=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do puerto_ocupado "$PUERTO_T" && break; done

if puerto_ocupado "$PUERTO_T"; then
  printf '  \033[32mok\033[0m    polo positivo: con algo escuchando -> ocupado\n'
else
  printf '  \033[31mMAL\033[0m   no vio un listener vivo en %s: el chequeo previo de los gates no sirve\n' "$PUERTO_T"; tfail=1
fi

kill "$PID_T" 2>/dev/null; wait "$PID_T" 2>/dev/null

printf '\n\033[1m── la libreria no se ejecuta, se importa\033[0m\n'
if bash scripts/_lib.sh >/dev/null 2>&1; then
  printf '  \033[31mMAL\033[0m   scripts/_lib.sh se dejo ejecutar directo\n'; tfail=1
else
  printf '  \033[32mok\033[0m    ejecutarla directo sale distinto de cero\n'
fi

if [ "$tfail" = "0" ]; then printf '\n\033[1;32m_lib.sh: OK\033[0m\n'; else printf '\n\033[1;31m_lib.sh: ROTO\033[0m\n'; fi
exit "$tfail"
