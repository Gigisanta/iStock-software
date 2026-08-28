#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════════════════════
#  Polaridad de `guard-effects.sh`. `T32` del board.
#
#  Por que existe: `guard-effects.sh` nacio en S6 con las tres polaridades ESCRITAS en su
#  encabezado —sin consumidor y sin motivo FAIL, sin consumidor y con motivo PASS, con consumidor
#  y con motivo FAIL— y ninguna de las tres se habia visto ocurrir. Las rutas que audita estaban
#  clavadas en el archivo, asi que la unica forma de provocarle un rojo era romper el dominio de
#  verdad, o sea nunca. Un gate cuyo rojo nadie vio es una afirmacion sobre el futuro, no una
#  medicion; y este en particular ya tuvo un defecto real que sobrevivio dos slices en verde (el
#  conteo inflado 8x por lineas de comentario, corregido en S7).
#
#  ── Lo que mide este arnes, y en que orden importa ───────────────────────────────────────────
#  La mitad que ENCIENDE prueba que el gate sabe encontrar las tres formas del defecto mas las dos
#  del gate ciego (fuente ausente, interfaz vacia). La mitad que CALLA es la que evita el gate
#  historico: uno que grita siempre tampoco distingue nada, y ademas castiga la exencion escrita,
#  que es la conducta que el gate quiere premiar.
#
#  El caso `un consumidor que es una linea de comentario` es el unico con historia: es la
#  correccion de S7, la que bajo el conteo de `createsSale` de 8 a 1. Sin este caso, esa
#  correccion vuelve a perderse la proxima vez que alguien "simplifique" el grep.
#
#  ── El canario, que no es ceremonia ──────────────────────────────────────────────────────────
#  Cada caso corre contra su propio arbol temporal via `EFFECTS_FUENTE` / `EFFECTS_DESTINO`. Si el
#  gate ignorara la escotilla, TODOS los casos habrian auditado el repo real: los que esperan
#  CALLA habrian callado por el motivo equivocado y el arnes entero seria decorativo. Por eso el
#  canario afirma que el gate nombro un efecto que **no existe en el dominio real**.
#
#  ── Por que `scripts/.effects-tmp/` NO va al `.gitignore` ────────────────────────────────────
#  `guard-effects.sh` busca con `_buscar`, que descarta toda linea de un archivo que `git
#  check-ignore` reconozca. Si este directorio estuviera ignorado, el consumidor del fixture seria
#  invisible y los casos que esperan "tiene consumidor" darian el resultado contrario. Es
#  exactamente la trampa que el `.gitignore` ya documenta para `scripts/.libtest-tmp/`.
#
#  Duenio: LEAD (`CLAUDE.md` §4) — es el arnes de un gate, y un gate no puede ser del writer que
#  audita.
# ══════════════════════════════════════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")/.."

G="scripts/guard-effects.sh"
T="scripts/.effects-tmp"
fail=0
casos=0

trap 'rm -rf "$T"' EXIT

# `armar <cuerpo-de-la-interfaz>` deja el arbol de mentira listo y vacio de consumidores.
armar() {
  rm -rf "$T"; mkdir -p "$T/app"
  { echo 'export interface TransitionEffects {'; printf '%s\n' "$1"; echo '}'; } > "$T/dominio.ts"
}

# Corre el gate contra el arbol de mentira y deja `SALIDA` y `VISTO` puestas.
#
# Se llama DIRECTO y no como `$(correr)`, y esa no es una preferencia de estilo: una sustitucion de
# comandos abre una subshell, asi que `SALIDA` moria adentro y el chequeo de "censo 0 efectos"
# leia una variable vacia. La primera version de este arnes tenia justo eso, y el sintoma fue el
# que este repo trata como el peor: los seis casos que esperaban ENCIENDE salieron OK igual,
# porque `VISTO` si volvia por stdout. Un arnes a medias que se ve verde en la mitad que importa.
SALIDA=""
VISTO=""
correr() {
  SALIDA=$(EFFECTS_FUENTE="$T/dominio.ts" EFFECTS_DESTINO="$T/app" bash "$G" 2>&1 \
           | sed 's/\x1b\[[0-9;]*m//g')
  if printf '%s\n' "$SALIDA" | grep -q 'GUARD-EFFECTS: RECHAZADO'; then VISTO=ENCIENDE; else VISTO=CALLA; fi
}

# `caso <rotulo> <ENCIENDE|CALLA>` — asume que el arbol ya esta armado.
caso() {
  casos=$((casos + 1))
  correr
  # Un CALLA solo vale si ademas el gate CENSO algo: "cero efectos" tambien saldria por la rama
  # verde en un gate roto, y seria el mismo verde vacio que este repo persigue.
  CENSADOS=$(printf '%s\n' "$SALIDA" | sed -nE 's/.*se leyeron ([0-9]+) efectos.*/\1/p' | head -1)
  if [ "$VISTO" != "$2" ]; then
    printf '  \033[31mMAL\033[0m   %-56s se vio %s y se esperaba %s\n' "$1" "$VISTO" "$2"; fail=1
  elif [ "$2" = "CALLA" ] && [ "${CENSADOS:-0}" -lt 1 ]; then
    printf '  \033[31mMAL\033[0m   %-56s callo pero censo 0 efectos: verde vacio\n' "$1"; fail=1
  else
    printf '  \033[32mOK\033[0m    %-56s %s\n' "$1" "$2"
  fi
}

printf '\n\033[1m── se ve ENCENDER ──\033[0m\n'

# 1 · el bug de S6, textual: declarado como obligatorio y ejecutado por nadie.
armar '  readonly closesReservation: boolean;'
caso 'un efecto sin consumidor y sin motivo escrito' ENCIENDE

# 2 · la exencion podrida. `writesListingEvent` SI tiene motivo en `motivo_de`, asi que darle un
#     consumidor tiene que encender: la excusa sobrevivio al problema que la justificaba.
armar '  readonly writesListingEvent: boolean;'
echo 'if (efectos.writesListingEvent) insertarEvento();' > "$T/app/ejecutor.ts"
caso 'un efecto CON consumidor y CON exencion escrita (la podrida)' ENCIENDE

# 3 · el gate ciego: sin fuente no puede afirmar nada, y no afirmar es FAIL.
rm -rf "$T"; mkdir -p "$T/app"
caso 'la fuente del dominio no existe' ENCIENDE

# 4 · la interfaz se renombro. Cero efectos leidos NO es "cero problemas".
rm -rf "$T"; mkdir -p "$T/app"
printf 'export interface EfectosDeTransicion {\n  readonly closesReservation: boolean;\n}\n' > "$T/dominio.ts"
caso 'la interfaz cambio de nombre: se leen 0 efectos' ENCIENDE

# 5 · un efecto que solo se ejecuta en un test es un efecto que no se ejecuta.
armar '  readonly closesReservation: boolean;'
echo 'expect(efectos.closesReservation).toBe(true);' > "$T/app/ejecutor.test.ts"
caso 'el unico consumidor vive en un .test.ts' ENCIENDE

# 6 · la correccion de S7: una mencion en un docblock no es un consumidor.
armar '  readonly closesReservation: boolean;'
printf '/**\n * Aca se documenta closesReservation con lujo de detalle.\n */\n// y aca closesReservation otra vez\nexport const nada = 1;\n' > "$T/app/ejecutor.ts"
caso 'el unico consumidor es una linea de comentario (el fallo de S7)' ENCIENDE

printf '\n\033[1m── se ve CALLAR (y censo al menos un efecto) ──\033[0m\n'

# 7 · lo normal: declarado y ejecutado.
armar '  readonly closesReservation: boolean;'
echo 'if (efectos.closesReservation) cerrarReserva();' > "$T/app/ejecutor.ts"
caso 'un efecto con consumidor real en codigo' CALLA

# 8 · la conducta que el gate premia: sin consumidor, pero con el motivo versionado.
armar '  readonly writesListingEvent: boolean;'
caso 'un efecto sin consumidor pero con motivo escrito' CALLA

printf '\n\033[1m── el control negativo del arnes ──\033[0m\n'

# El canario. `efectoQueNoExisteEnElDominioReal` no esta en `TransitionEffects` del repo: si el
# gate hubiera ignorado la escotilla, este nombre no podria aparecer en su salida y los ocho casos
# de arriba habrian estado midiendo el arbol real.
casos=$((casos + 1))
armar '  readonly efectoQueNoExisteEnElDominioReal: boolean;'
correr
if printf '%s\n' "$SALIDA" | grep -q 'efectoQueNoExisteEnElDominioReal'; then
  printf '  \033[32mOK\033[0m    %-56s el gate audita el fixture, no el dominio real\n' 'EFFECTS_FUENTE/EFFECTS_DESTINO se respetan'
else
  printf '  \033[31mMAL\033[0m   %-56s los 8 casos de arriba no probaron nada\n' 'EFFECTS_FUENTE/EFFECTS_DESTINO se respetan'; fail=1
fi

# Y la otra punta del canario: sin las variables, el gate tiene que volver al arbol real. Un arnes
# que dejara la escotilla pegada convertiria a `guard-effects.sh` en un gate que no audita nada.
casos=$((casos + 1))
REAL=$(bash "$G" 2>&1 | sed 's/\x1b\[[0-9;]*m//g')
if printf '%s\n' "$REAL" | grep -q 'writesListingEvent'; then
  printf '  \033[32mOK\033[0m    %-56s sin las variables vuelve a packages/domain\n' 'la escotilla no queda pegada'
else
  printf '  \033[31mMAL\033[0m   %-56s el gate no volvio al arbol real\n' 'la escotilla no queda pegada'; fail=1
fi

printf '\n'
if [ "$fail" = "0" ]; then
  printf '\033[1;32mPOLARIDAD EFFECTS: OK\033[0m — %s casos, se vio encender y se vio callar.\n' "$casos"
else
  printf '\033[1;31mPOLARIDAD EFFECTS: MAL\033[0m\n'
fi
exit "$fail"
