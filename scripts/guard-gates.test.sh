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

# G3 audita los gates que un `package.json` corre. Sin ninguno el censo mide cero y —bien— reporta
# FAIL, lo que pondria rojo cada fixture de G1/G2 por un motivo ajeno a lo que ese fixture prueba.
# Asi que el arbol arranca con UN gate de paquete sano, y los casos de G3 lo mutan.
mkdir -p "$T/pkg/scripts"
printf '{"name":"fixture-pkg","scripts":{"lint":"node ./scripts/pkg-lint.mjs"}}\n' > "$T/pkg/package.json"
printf '/**\n * gate-owner: LEAD\n */\n' > "$T/pkg/scripts/pkg-lint.mjs"

# G4 audita que cada gate de `scripts/` este nombrado en `ci.yml`. Mismo razonamiento que arriba:
# sin `ci.yml` el censo mide cero, reporta FAIL —bien— y pondria rojo cada fixture de G1/G2/G3 por
# un motivo ajeno. El arbol arranca con UN gate censable y un `ci.yml` que lo nombra.
mkdir -p "$T/.github/workflows"
printf 'jobs:\n  x:\n    steps:\n      - run: ./scripts/guard-baseline.sh\n' > "$T/.github/workflows/ci.yml"
printf '#!/usr/bin/env bash\necho baseline\n' > "$T/scripts/guard-baseline.sh"

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

printf '\n\033[1m── G3: el gate de un paquete no puede ser del writer que audita\033[0m\n'

printf '#!/usr/bin/env bash\n. scripts/_lib.sh\nok "sano"\n' > "$T/scripts/fixture.sh"
caso "el baseline: un gate de paquete que se declara del LEAD" PASS

printf '/**\n * un lint cualquiera, sin dueno declarado\n */\n' > "$T/pkg/scripts/pkg-lint.mjs"
caso "ATRAPA un gate adentro de un paquete que no se declara del LEAD" FAIL

# El bug real del 2026-08-28: el `lint` de `packages/domain` es `purity-check.mjs`, que NO termina
# en `-lint.mjs`. Una regla apoyada en el SUFIJO no lo veia — mismo agujero que ADR-022 vino a
# tapar, un nivel mas arriba. G3 se apoya en el `package.json`, no en el nombre del archivo.
printf '{"name":"fixture-pkg","scripts":{"lint":"node ./scripts/purity-check.mjs"}}\n' > "$T/pkg/package.json"
mv "$T/pkg/scripts/pkg-lint.mjs" "$T/pkg/scripts/purity-check.mjs"
caso "ATRAPA el gate que NO se llama *-lint.mjs (el agujero que dejaba la regla vieja)" FAIL

printf '/**\n * gate-owner: LEAD\n */\n' > "$T/pkg/scripts/purity-check.mjs"
caso "el mismo archivo ya declarado: el gate se calla" PASS

printf '{"name":"fixture-pkg","scripts":{"lint":"node ./scripts/no-existe.mjs"}}\n' > "$T/pkg/package.json"
caso "ATRAPA el gate fantasma: el package.json lo corre y el archivo no esta" FAIL

# La exencion de `scripts/**` tiene que verse CALLAR, no solo existir en un comentario: esos gates
# ya son del LEAD por fila propia de §4 y no hay ambiguedad de lectura que resolver. Si este caso
# diera FAIL, la exencion seria un agujero; si nadie lo corriera, seria una promesa.
printf '#!/usr/bin/env bash\n. scripts/_lib.sh\nok "sano"\n' > "$T/scripts/fixture.sh"
printf '{"name":"fixture-pkg","scripts":{"guard":"../scripts/fixture.sh"}}\n' > "$T/pkg/package.json"
caso "un gate bajo scripts/ no necesita la marca: ya es del LEAD por §4" PASS

# Medir cero no es aprobar. Si el censo se rompe, el sintoma es indistinguible de "no hay gates".
rm -f "$T/pkg/package.json"
caso "ATRAPA el censo vacio: cero gates censados es hallazgo, no veredicto verde" FAIL
printf '{"name":"fixture-pkg","scripts":{"lint":"node ./scripts/purity-check.mjs"}}\n' > "$T/pkg/package.json"

printf '\n\033[1m── G4: un gate que no corre en CI se pone rojo y nadie se entera\033[0m\n'

printf '#!/usr/bin/env bash\n. scripts/_lib.sh\nok "sano"\n' > "$T/scripts/fixture.sh"
caso "el baseline: el unico gate censable esta nombrado en ci.yml" PASS

# El bug real, cuatro veces: guard-routes, guard-grants, accept-fase2 y accept-fase3 existieron
# fuera del workflow. `accept-fase2` estuvo ROJO semanas sin que nadie lo viera.
printf '#!/usr/bin/env bash\necho hola\n' > "$T/scripts/guard-huerfano.sh"
caso "ATRAPA el gate que existe y no aparece en ci.yml" FAIL

# Una exencion sin motivo es la exencion invisible con mas pasos: mismo criterio que
# `web-lint:sin-tenant`, 30+ caracteres.
printf '#!/usr/bin/env bash\n# ci-exento: porque si\necho hola\n' > "$T/scripts/guard-huerfano.sh"
caso "ATRAPA la exencion con motivo de menos de 30 caracteres" FAIL

printf '#!/usr/bin/env bash\n# ci-exento: pide una credencial de Mercado Pago que CI no tiene ni va a tener\necho hola\n' > "$T/scripts/guard-huerfano.sh"
caso "una exencion escrita con motivo de verdad: el gate se calla" PASS
rm -f "$T/scripts/guard-huerfano.sh"

# Nombrarlo en ci.yml tambien alcanza, y por cualquiera de las formas de invocacion.
printf '#!/usr/bin/env bash\necho hola\n' > "$T/scripts/accept-tX.sh"
caso "ATRAPA un accept-*.sh nuevo que nadie agrego al workflow" FAIL
printf 'jobs:\n  x:\n    steps:\n      - run: ./scripts/guard-baseline.sh\n      - run: bash scripts/accept-tX.sh\n' > "$T/.github/workflows/ci.yml"
caso "el mismo gate, ya nombrado en ci.yml: se calla" PASS
rm -f "$T/scripts/accept-tX.sh"
printf 'jobs:\n  x:\n    steps:\n      - run: ./scripts/guard-baseline.sh\n' > "$T/.github/workflows/ci.yml"

# `_lib.sh` NO se censa: es libreria, no se ejecuta. Si G4 la exigiera en ci.yml pediria correr un
# archivo que aborta a proposito cuando se lo ejecuta.
caso "_lib.sh no se exige en ci.yml: es libreria, no gate" PASS

# Medir cero no es aprobar, igual que en G3.
rm -f "$T/.github/workflows/ci.yml"
caso "ATRAPA el arbol sin ci.yml: no se puede afirmar que ningun gate corra" FAIL
printf 'jobs:\n  x:\n    steps:\n      - run: ./scripts/guard-baseline.sh\n' > "$T/.github/workflows/ci.yml"

# ── Las dos formas de "esta escrito pero no se ejecuta", LEAD 2026-08-28 ──────────────────────
#
# La primera fue REAL y estuvo viva dos commits: `c2aa5d2` metio un `- name:` sin comillas con
# `: ` adentro y `ci.yml` dejo de parsear. Ante un yml invalido GitHub no corre 42 de 43 pasos:
# no corre NINGUNO, y no reporta rojo porque no hay workflow que reportar. G4 decia PASS porque
# leia el archivo como texto. El fixture usa el MISMO disparador que la rompio de verdad.
printf 'jobs:\n  x:\n    steps:\n      - name: polaridad (A010: sin comillas)\n        run: ./scripts/guard-baseline.sh\n' > "$T/.github/workflows/ci.yml"
caso "ATRAPA el ci.yml que no parsea: GitHub no corre NINGUN step" FAIL

# Y la de al lado: el mismo yml, con el nombre citado. Sin este caso el de arriba no probaria que
# el gate mira el PARSEO — probaria que se pone rojo ante cualquier cosa que diga `A010`.
printf 'jobs:\n  x:\n    steps:\n      - name: %s\n        run: ./scripts/guard-baseline.sh\n' "'polaridad (A010: con comillas)'" > "$T/.github/workflows/ci.yml"
caso "el mismo nombre, citado: parsea y el gate se calla" PASS

# La segunda estaba LATENTE, no viva, y por eso vale un fixture: un censo textual cuenta como
# "corre en CI" un nombre que solo aparece en un COMENTARIO. `ci.yml` tiene comentarios que
# nombran a guard-routes, guard-grants, accept-fase2 y accept-fase3 precisamente para contar que
# se habian quedado afuera del workflow. Borrar el `run:` y dejar la historia arriba habria
# dejado el censo verde sobre el mismo defecto que la historia narra.
printf 'jobs:\n  x:\n    steps:\n      # ./scripts/guard-baseline.sh quedo afuera a proposito\n      - run: echo nada\n' > "$T/.github/workflows/ci.yml"
caso "ATRAPA el gate nombrado SOLO en un comentario del workflow" FAIL
printf 'jobs:\n  x:\n    steps:\n      - run: ./scripts/guard-baseline.sh\n' > "$T/.github/workflows/ci.yml"

if [ "$tfail" = "0" ]; then printf '\n\033[1;32mguard-gates.sh: OK (se vio encender y se vio callar)\033[0m\n'
else printf '\n\033[1;31mguard-gates.sh: ROTO\033[0m\n'; fi
exit "$tfail"
