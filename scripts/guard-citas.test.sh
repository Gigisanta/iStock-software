#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════════════════════
#  Polaridad de `guard-citas.sh`. Se tiene que ver ENCENDER sobre las dos formas de la clase, y
#  CALLAR sobre las seis formas legitimas que se le parecen.
#
#  La mitad que CALLA es la que decide si este gate sobrevive, y no es simetrica con la otra:
#
#  · El IMEI. Cuatro IMEI de prueba de `docs/research/enacom-imei.md` entran enteros en el
#    alfabeto hex. La primera version de este gate los reporto como hashes colgantes. Un gate que
#    le pide al autor que "arregle el hash" de un IMEI no es ruidoso — no entiende de que habla, y
#    quien lo lea la segunda vez ya no lo lee.
#  · El obituario. Los dos hashes colgantes reales del repo narran su propia muerte, y uno vive en
#    la fila T55, o sea en el parrafo que describe a este gate. Un gate que obliga a borrar la
#    explicacion para pasar es el defecto que `accept-s9.sh` V5 tuvo: no distingue un bug de su
#    obituario.
#
#  ── El fixture caro, y por que no se puede inventar ──────────────────────────────────────────
#  El caso 5 necesita **un commit REAL inalcanzable desde HEAD**. Un sha inventado tambien da
#  rojo, pero por el motivo equivocado: falla en `cat-file` (no existe) en vez de fallar en
#  `merge-base` (existe y no es ancestro), que es la unica forma que este gate vino a detectar —
#  la del sha enmendado que sigue vivo en el reflog de quien enmendo. Con un fixture inventado, un
#  gate que usara `cat-file` en vez de `merge-base` PASARIA este arnes.
#  Por eso el caso 5 hace `git commit-tree`: crea un objeto commit de verdad, sin ninguna ref
#  apuntandolo. `cat-file` dice `commit` y `merge-base --is-ancestor` dice que no. Identico al bug.
#
#  Cada caso corre contra su propio arbol y su propio piso via `CITAS_ROOT` / `CITAS_BASELINE`, y
#  el caso 12 es el canario de que esas escotillas se respetan: sin el, todos los casos habrian
#  auditado los docs reales y los que callan habrian callado por el motivo equivocado.
#
#  ci-exento: no aplica — este arnes corre en ci.yml, ver .github/workflows/ci.yml
#  gate-owner: LEAD
# ══════════════════════════════════════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")/.."

G="scripts/guard-citas.sh"
T="scripts/.citas-tmp"
fail=0; n_ok=0; n_casos=0

trap 'rm -rf "$T"' EXIT

preparar() { rm -rf "$T"; mkdir -p "$T/docs"; : > "$T/piso.txt"; }

correr() { # correr <exit esperado> <titulo>
  local esp="$1" tit="$2" out rc
  n_casos=$((n_casos + 1))
  out=$(CITAS_ROOT="$T/docs" CITAS_BASELINE="$T/piso.txt" bash "$G" 2>&1); rc=$?
  if [ "$rc" = "$esp" ]; then
    printf '  \033[32mOK\033[0m    %s\n' "$tit"; n_ok=$((n_ok + 1))
  else
    printf '  \033[31mMAL\033[0m   %s  (esperaba exit=%s, dio %s)\n' "$tit" "$esp" "$rc"
    printf '%s\n' "$out" | sed 's/^/          /' | head -10
    fail=1
  fi
}

SHA_VIVO=$(git rev-parse --short HEAD)
# Commit REAL sin ninguna ref apuntandolo: `cat-file` lo reconoce, `merge-base` lo rechaza.
SHA_MUERTO=$(git -c user.name='CI fixture' -c user.email='ci-fixture@example.invalid' \
  commit-tree "HEAD^{tree}" -m 'fixture T55: commit real fuera de main' </dev/null 2>/dev/null)
if [ -z "$SHA_MUERTO" ]; then
  echo "no se pudo crear el commit huerfano del fixture: sin el, el caso 5 no prueba nada" >&2
  exit 2
fi

printf '\033[1mPOLARIDAD CITAS\033[0m  (arnes de scripts/guard-citas.sh)\n'

printf '\n\033[1m── tiene que ENCENDER\033[0m\n'

preparar
echo 'Ver `chat.ts:338` para el detalle.' > "$T/docs/A.md"
correr 1 '1. cita `archivo.ts:NNN` sin simbolo, en archivo con piso cero implicito'

preparar
echo 'Ver `chat.ts:338`, `chat.ts:340` y `chat.ts:341`.' > "$T/docs/A.md"
echo 'A.md 2' > "$T/piso.txt"
correr 1 '2. tres citas contra un piso de dos: la deuda no puede crecer'

preparar
echo 'Ver `chat.ts:338` <!-- t55-cita-exenta: corto -->' > "$T/docs/A.md"
correr 1 '3. escotilla con motivo de menos de 30 caracteres no apaga nada'

preparar
echo 'Ver `chat.ts:338`' > "$T/docs/A.md"
echo 'Y aca `chat.ts:339` <!-- t55-cita-exenta: este motivo si tiene largo de sobra para el piso -->' >> "$T/docs/A.md"
echo 'A.md 1' > "$T/piso.txt"
correr 0 '   (control del 3: con motivo largo, la exenta no cuenta y queda en el piso)'

preparar
echo "Se enmendo y quedo \`$SHA_MUERTO\` colgando." > "$T/docs/A.md"
correr 1 '5. hash de un commit REAL inalcanzable desde HEAD (el caso del `amend`)'

preparar
mkdir -p "$T/docs/vacio"
correr 1 '6. cero archivos .md bajo el root: ausencia de medicion es FAIL, nunca PASS'

printf '\n\033[1m── tiene que CALLAR\033[0m\n'

preparar
echo 'Ver `chat.ts` · `addBilled` · `chat.ts:~500` para el detalle.' > "$T/docs/A.md"
correr 0 '7. la forma con tilde `archivo.ts:~NNN` es la declarada valida por CLAUDE.md §5'

preparar
echo 'Ver `chat.ts:338` <!-- t55-cita-exenta: esta linea explica el modo de falla y por eso lo cita -->' > "$T/docs/A.md"
correr 0 '8. escotilla con motivo de 30+ caracteres, en la misma linea'

preparar
echo 'IMEI de prueba: `353811110018472` y `490154203237518`.' > "$T/docs/A.md"
correr 0 '9. un IMEI de 15 digitos NO es un hash de commit'

preparar
echo "El arreglo esta en \`$SHA_VIVO\`." > "$T/docs/A.md"
correr 0 '10. hash alcanzable desde HEAD'

preparar
# Lo encontro `cost-auditor` corriendo un regex de hex sobre COST.md: `acababa` es un verbo
# espanol y entra entero en el alfabeto hex. Igual `acabada`, `deadbeef`. Sin este caso, la mitad
# "tiene que tener un digito" del filtro se puede borrar sin que el arnes se entere.
echo 'El proceso `acababa` cuando salto el `deadbeef` de `cebada`.' > "$T/docs/A.md"
correr 0 '15. una palabra que entra en el alfabeto hex (`acababa`) NO es un hash de commit'

preparar
echo 'Ver `chat.ts:338` y `chat.ts:340`.' > "$T/docs/A.md"
echo 'A.md 2' > "$T/piso.txt"
correr 0 '11. exactamente el piso declarado: deuda conocida que no crece'

preparar
echo 'Ver `chat.ts:338`.' > "$T/docs/A.md"
echo 'A.md 9' > "$T/piso.txt"
correr 0 '12. por debajo del piso informa y no falla (el trinquete no puede interbloquear a docs-keeper)'

# ── Canario de la escotilla ──────────────────────────────────────────────────────────────────
# Los docs REALES estan hoy en rojo por C2 (dos hashes narrando su muerte, sin marcar todavia).
# Si `CITAS_ROOT` no se respetara, cada caso de arriba habria auditado `docs/` y los seis que
# callan habrian callado por el motivo equivocado — o mas bien no habrian callado en absoluto.
# Este canario lo hace explicito en vez de dejarlo implicito en un exit code.
printf '\n\033[1m── canario de la escotilla\033[0m\n'
preparar
echo 'Un doc sin una sola cita.' > "$T/docs/A.md"
n_casos=$((n_casos + 1))
if CITAS_ROOT="$T/docs" CITAS_BASELINE="$T/piso.txt" bash "$G" >/dev/null 2>&1; then
  printf '  \033[32mOK\033[0m    13. CITAS_ROOT se respeta: un arbol limpio da PASS aunque `docs/` este en rojo\n'
  n_ok=$((n_ok + 1))
else
  printf '  \033[31mMAL\033[0m   13. el gate ignoro CITAS_ROOT: todos los casos de arriba midieron el arbol equivocado\n'
  fail=1
fi

# ── El clon shallow, con la misma cita que en el arbol completo PASA ─────────────────────────
# `actions/checkout@v4` clona con `fetch-depth: 1`. Este caso es el unico del arnes donde el
# CONTENIDO es identico a uno que pasa (el caso 10, un hash alcanzable) y el veredicto es opuesto:
# lo unico que cambia es la profundidad del clon. Sin el, la unica forma de descubrir que C2 no
# puede correr en CI seria verla acusar a las ~100 citas validas del repo, o —peor y mas probable—
# no descubrirlo nunca porque alguien "arreglo" el ruido salteando C2 cuando el clon es shallow.
printf '\n\033[1m── el clon shallow (fetch-depth: 1)\033[0m\n'
SH="$T/shallow"
n_casos=$((n_casos + 1))
if git clone --quiet --depth 1 "file://$PWD" "$SH" 2>/dev/null \
   && [ "$(git -C "$SH" rev-parse --is-shallow-repository)" = true ]; then
  mkdir -p "$SH/scripts" "$SH/docs2"
  cp scripts/_lib.sh scripts/guard-citas.sh "$SH/scripts/"
  : > "$SH/piso.txt"
  echo "El arreglo esta en \`$SHA_VIVO\`." > "$SH/docs2/A.md"
  if ( cd "$SH" && CITAS_ROOT=docs2 CITAS_BASELINE=piso.txt bash scripts/guard-citas.sh >/dev/null 2>&1 ); then
    printf '  \033[31mMAL\033[0m   14. clon shallow: C2 dio PASS sin poder medir nada (vacuamente verde)\n'
    fail=1
  else
    printf '  \033[32mOK\033[0m    14. clon shallow: falla nombrando la causa, en vez de acusar a toda cita valida\n'
    n_ok=$((n_ok + 1))
  fi
else
  printf '  \033[31mMAL\033[0m   14. no se pudo armar el clon shallow: el caso no probo nada\n'
  fail=1
fi


# ── Una marca no exime al otro chequeo ────────────────────────────────────────────────────────
# Estos dos casos existen por un bug real: la primera version tenia UNA marca y `_censar_archivo`
# la aplicaba a la linea entera, asi que una escotilla escrita para un sha bajaba el piso de C1 en
# silencio. Lo encontro `docs-keeper` usando el gate, no yo escribiendolo — que es exactamente el
# motivo por el que un arnes de polaridad tiene que probar el CRUCE y no solo cada mitad.
printf '\n\033[1m── el cruce de escotillas (una marca por chequeo)\033[0m\n'

preparar
echo 'Fila `T34`: ver `guard-effects.sh:46-52` <!-- t55-hash-exento: la celda narra la enmienda de un sha y por eso lo nombra -->' > "$T/docs/A.md"
correr 1 '16. la marca de C2 NO paga deuda de C1: la cita sigue contando contra el piso'

preparar
echo "Se enmendo y quedo \`$SHA_MUERTO\` colgando <!-- t55-cita-exenta: esta linea exhibe la forma mala de citar a proposito -->" > "$T/docs/A.md"
correr 1 '17. la marca de C1 NO excusa un hash colgante: C2 sigue acusandolo'


# ── Una exencion tiene que NOMBRARSE, no solo restarse ────────────────────────────────────────
# Este caso mira la SALIDA, no el exit code, y por eso existe: el bug que cubre daba PASS. El
# contador de exentas se incrementaba adentro de `_censar_archivo`, que corre en un `$(...)` —o
# sea en un subshell—, asi que el padre leia 0 y la linea no se imprimia nunca. `SLICE_BOARD.md`
# bajo de 163 a 161 sin una sola linea que dijera por que, que es indistinguible de haber
# arreglado dos citas. Lo encontro `docs-keeper` leyendo el resumen, no el arnes: los 17 casos de
# arriba miran exit codes y ninguno podia verlo.
printf '\n\033[1m── la exencion se nombra, no solo se resta\033[0m\n'

preparar
echo 'Fila `T55`: ver `chat.ts:284-286` <!-- t55-cita-exenta: es un especimen exhibido de la forma mala y nunca se va a arreglar -->' > "$T/docs/A.md"
n_casos=$((n_casos + 1))
SALIDA=$(CITAS_ROOT="$T/docs" CITAS_BASELINE="$T/piso.txt" bash scripts/guard-citas.sh 2>&1)
if printf '%s' "$SALIDA" | grep -q 'cita(s) exenta(s) con motivo escrito' \
   && printf '%s' "$SALIDA" | grep -q 'A.md:1' \
   && printf '%s' "$SALIDA" | grep -q 'chat.ts:284-286'; then
  printf '  \033[32mOK\033[0m    18. la cita exenta se imprime con su archivo, su linea y su texto\n'
  n_ok=$((n_ok + 1))
else
  printf '  \033[31mMAL\033[0m   18. la cita exenta se resto del piso sin nombrarse: es indistinguible de una cita arreglada\n'
  fail=1
fi

printf '\n'
if [ "$fail" = 0 ]; then printf '\033[1;32mPOLARIDAD CITAS: OK — %s/%s casos\033[0m\n' "$n_ok" "$n_casos"
else printf '\033[1;31mPOLARIDAD CITAS: FAIL — %s/%s casos\033[0m\n' "$n_ok" "$n_casos"; fi
exit "$fail"
