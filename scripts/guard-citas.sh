#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════════════════════
#  GUARD DE CITAS DE DOCS (T55) — una referencia envejece sola y nada la cuenta
#
#  `CLAUDE.md` §5 («Un doc cita el simbolo, no el numero de linea») cerro la CLASE. Este gate es
#  lo que la hace fallar sola, que es el corolario que ese mismo parrafo pide: *"esto no puede
#  depender de que alguien se acuerde"*.
#
#  ── Por que existe, y no es una hipotesis ────────────────────────────────────────────────────
#  En UNA sola sesion del 2026-08-28, tres agentes distintos dejaron citas apuntando a texto ajeno:
#  `cost-auditor` cito `chat.ts:284-286`, el LEAD cito `:338`, y `docs-keeper` cito ocho lineas.
#  Ninguno leyo mal. El archivo se movio abajo de la cita mientras `ai-agent` lo editaba.
#
#  Y la variante mas cara ya se midio: `rls-cross-tenant.test.ts:553` se vendia como `R7c-bis` y
#  aterrizaba en `R7c` — el detector VIEJO, el que R7c-bis vino a complementar. **Una cita vencida
#  que cae en la asercion de al lado es peor que una que no cae en ninguna:** la primera se lee
#  como correcta.
#
#  ── Que se afirma, en dos secciones ──────────────────────────────────────────────────────────
#  C1. Una cita `` `archivo.ext:NNN` `` en `docs/**` lleva simbolo. La regla NO es "nunca un
#      numero": es *"no un numero SOLO"*. La forma tolerada es el tilde — `` `chat.ts:~500` `` —
#      que es la que `CLAUDE.md` §5 escribe como ejemplo valido, y que aca hace de declaracion:
#      el `~` dice *"esto es la ayuda para el que scrollea, el ancla es el simbolo de al lado"*.
#      Se eligio el tilde en vez de "hay otro code span cerca" porque lo segundo no es censable
#      sin adivinar que cuenta como cerca, y una regla que adivina no se puede discutir.
#
#  C2. Un hash de commit citado es **alcanzable desde `HEAD`**. La agravante de esta forma es como
#      falla: `git cat-file -t <sha>` contesta `commit` para un sha enmendado, porque el objeto
#      sigue vivo en el reflog de quien enmendo. **La cita se verifica perfecto en la maquina donde
#      se rompio y muere en un clon o en el primer `gc`.** La pregunta correcta es la unica que
#      este gate hace: `git merge-base --is-ancestor`.
#
#  ── El falso positivo que encontro la primera corrida, y es el interesante ────────────────────
#  Un regex `[0-9a-f]{7,40}` se traga **los IMEI**. `docs/research/enacom-imei.md` tiene cuatro
#  IMEI de prueba (`353811110018472`, `490154203237518`, …) y el board tiene un quinto: quince
#  digitos, todos en el alfabeto hex. La primera version de este gate reporto SIETE hashes
#  colgantes y cinco eran esos. Un gate que le pide al autor que "arregle el hash" de un IMEI de
#  prueba no es ruidoso: es un gate que no entiende de que habla, y el que lo lea la segunda vez
#  ya no lo lee.
#
#  El filtro NO es "excluir quince digitos" —eso arregla el caso, no la clase—. Un token se trata
#  como sha si (a) tiene letra `a-f` **y** digito `0-9`, o (b) mide exactamente 40, o (c) `git
#  cat-file -t` dice `commit`.
#
#  Las dos mitades de (a) las puso un falso positivo cada una, y ninguna la habia previsto yo:
#  · el digito hace falta porque el IMEI es todo digitos;
#  · la letra hace falta porque **`acababa` es un verbo espanol que ademas es hex valido**, y lo
#    mismo `acabada` o `deadbeef`. Lo encontro `cost-auditor` corriendo un regex de hex sobre
#    `COST.md`. Un sha de 7 caracteres sin ningun digito tiene probabilidad (6/16)^7 ~ 0,14 %, y
#    aun asi queda cubierto por (c) si existe localmente, que es el caso que importa.
#  La rama (c) es la que cierra el hueco donde el sha corto todo-digitos o todo-letras existe
#  igual, y lo hace **justo en el caso peligroso**: el sha enmendado que sigue vivo en el reflog
#  local es exactamente el que `cat-file` reconoce. Un IMEI jamas va a hacer que diga `commit`.
#  Limite declarado: un sha sin digito (o sin letra) YA borrado del reflog no se detecta. Es la
#  interseccion de dos improbabilidades y no tiene arreglo barato; se escribe en vez de callarse.
#
#  ── La escotilla, y por que es obligatoria desde el dia cero ─────────────────────────────────
#  Este gate va a encender sobre los docs que EXPLICAN el modo de falla. Ya paso: los dos unicos
#  hashes colgantes reales del repo (`9d5d20a`, `5f9ca03`) estan en `SLICE_BOARD.md` **narrando su
#  propia muerte** — son el sujeto de la frase, no una referencia. Y uno de ellos vive en la fila
#  T55, o sea en el parrafo que describe a este gate. Un gate que obliga a borrar la explicacion
#  para pasar es el mismo defecto que `accept-s9.sh` V5 tuvo y hubo que corregir: **no distingue un
#  bug de su obituario.**
#
#  Idioma: `<!-- t55-hash-exento: <motivo de 30+ caracteres> -->` para C2 y
#  `<!-- t55-cita-exenta: <motivo de 30+ caracteres> -->` para C1, en LA MISMA LINEA. Mismo
#  contrato que `web-lint:sin-tenant` y `ci-exento`, y por el mismo motivo: la alternativa a una
#  excepcion escrita no es "sin excepcion", es la excepcion invisible. Va en comentario HTML
#  porque Markdown no lo renderiza — la escotilla no puede ensuciar la celda que exime.
#
#  ── UNA MARCA POR CHEQUEO, y esto empezo siendo un bug mio ───────────────────────────────────
#  La primera version tenia UNA sola marca, `t55-exento:`, y `_censar_archivo` la aplicaba a la
#  linea entera. O sea que una escotilla escrita para un sha **pagaba deuda de C1 en silencio**.
#  No es hipotetico: lo encontro `docs-keeper` el 2026-08-28 al escribir sus tres primeras
#  escotillas, y el piso de `SLICE_BOARD.md` cayo de 163 a 158 sin que se hubiera arreglado una
#  sola cita. Tres de esas cinco (`guard-effects.sh:46-52` y las dos de `ci.yml` en la fila T34)
#  son citas VIVAS que habrian quedado invisibles para siempre en cuanto alguien apretara el piso:
#  el trinquete hornea la exencion. Y peor: la fila exenta quedaba como zona franca, libre de
#  acumular citas C1 sin techo.
#
#  Por eso son dos nombres y no dos usos del mismo. Con un nombre compartido, el que escribe la
#  escotilla para el chequeo que lo esta frenando **apaga el otro sin verlo** — es la misma clase
#  de defecto que este gate persigue, sirviendo de escotilla. El costo de dos nombres es que hay
#  que elegir; ese es exactamente el punto.
#
#  ── El trinquete de C1, y por que abajo del piso NO es FAIL ──────────────────────────────────
#  Hay 208 citas vivas y `SLICE_BOARD.md` tiene 163. Un gate estricto el dia uno estaria rojo en
#  `main`, y un gate que nace rojo se aprende a ignorar. Entonces C1 es un trinquete por archivo
#  (`scripts/citas-baseline.txt`): **por arriba del piso FALLA**, y un archivo que no figura en el
#  piso tiene piso cero — o sea que los cuatro que ya se barrieron no pueden volver a ensuciarse,
#  y un doc nuevo nace estricto.
#
#  Por DEBAJO del piso informa y no falla, y esa asimetria es deliberada: el piso vive en
#  `scripts/`, que es del LEAD, y `docs-keeper` es quien baja el numero. Si bajar una cita pusiera
#  el gate en rojo, el unico que puede apagarlo seria alguien que no puede tocar el doc — un
#  interbloqueo donde mejorar el doc rompe CI. El precio esta aceptado y es que el piso no se
#  aprieta solo; por eso la linea de info imprime EL COMANDO que lo aprieta, y el LEAD lo corre
#  cuando re-ejecuta la aceptacion.
#
#  ── Limite declarado: solo cuenta citas entre backticks ──────────────────────────────────────
#  Una cita suelta en prosa (`ver chat.ts:338`, sin backticks) NO la ve C1. Contarlas trae falsos
#  positivos de prosa que no se pueden distinguir sin adivinar. Se puede esquivar el gate sacando
#  los backticks; se escribe aca en vez de fingir que el censo es total.
#
#  ci-exento: no aplica — este gate corre en ci.yml, ver .github/workflows/ci.yml
#  gate-owner: LEAD
# ══════════════════════════════════════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")/.."
. scripts/_lib.sh

# Escotillas de test (mismo patron que `DOC_TABLES_ROOT`): el arnes de polaridad audita su propio
# arbol y su propio piso, para que un caso que CALLA no calle por el motivo equivocado.
ROOT="${CITAS_ROOT:-docs}"
BASE="${CITAS_BASELINE:-scripts/citas-baseline.txt}"

RE_CITA='`[A-Za-z0-9_./()-]+\.(ts|tsx|mjs|js|sh|sql|json|yml|yaml|md)(:[0-9]+(-[0-9]+)?)+`'
RE_HASH='`[0-9a-f]{7,40}`'

MARCA_CITA='t55-cita-exenta:'
MARCA_HASH='t55-hash-exento:'

# `_marcada <marca> <linea>` — 0 si la linea declara ESA marca con motivo de 30+ caracteres.
# Parametrica a proposito: ver "UNA MARCA POR CHEQUEO" arriba. Una marca no exime al otro chequeo.
_marcada() {
  local marca="$1" l="$2" m
  case "$l" in *"$marca"*) ;; *) return 1 ;; esac
  m=$(printf '%s' "$l" | sed -n "s/.*${marca}[[:space:]]*//p" | sed 's/-->.*//')
  # Sin el piso de 30 un `t55-cita-exenta: si` apagaria la regla sin decir nada. Es el mismo numero
  # que `web-lint:sin-tenant` y `ci-exento` piden, para que el idioma sea uno solo.
  [ "${#m}" -ge 30 ]
}
_exento_cita() { _marcada "$MARCA_CITA" "$1"; }
_exento_hash() { _marcada "$MARCA_HASH" "$1"; }

# `_censar_archivo <f>` — cuenta citas C1 no exentas.
_censar_archivo() {
  local f="$1" n=0 ln txt c
  while IFS= read -r ln; do
    [ -z "$ln" ] && continue
    txt="${ln#*:}"
    _exento_cita "$txt" && continue
    c=$(printf '%s' "$txt" | grep -oE "$RE_CITA" | wc -l | tr -d ' ')
    n=$((n + c))
  done < <(grep -nE "$RE_CITA" "$f" 2>/dev/null || true)
  printf '%s' "$n"
}

# `_nombrar_exentas` — imprime CADA cita eximida con su archivo y linea.
#
# Existe porque una exencion que solo baja un contador es indistinguible de una cita arreglada, y
# esa confusion ya paso dos veces en este mismo gate: primero con la marca unica (163 -> 158 leido
# como progreso) y despues con este contador, que en su primera version se incrementaba adentro de
# `_censar_archivo` — o sea adentro del `$(...)` que la llama, o sea en un SUBSHELL. El padre leia
# 0 para siempre y la linea nunca se imprimia; el board bajo de 163 a 161 sin una sola linea que
# dijera por que. Lo encontro `docs-keeper` usando el gate, igual que el anterior.
#
# Por eso el conteo se hace ACA, en una pasada aparte, y no dentro de la funcion que ya corre en
# subshell: no hay forma de "acordarse" de no incrementar una variable adentro de un `$(...)`.
# Y nombra la CITA, no la fila: `cut` sobre una fila de tabla de markdown corta en el titulo y
# "se nombran aca" terminaria nombrando cualquier cosa menos lo que se eximio.
_nombrar_exentas() {
  local ln f l txt c
  while IFS= read -r ln; do
    [ -z "$ln" ] && continue
    f="${ln%%:*}"; txt="${ln#*:}"; l="${txt%%:*}"; txt="${txt#*:}"
    c=$(printf '%s' "$txt" | grep -oE "$RE_CITA" | tr '\n' ' ')
    [ -n "$c" ] && printf '        %s:%s  %s\n' "${f#"$ROOT"/}" "$l" "$c"
  done < <(grep -rn "$MARCA_CITA" "$ROOT" 2>/dev/null || true)
}

# ── Modo de mantenimiento: reescribe el piso con lo medido hoy ────────────────────────────────
# El piso se GENERA con el mismo regex que lo audita. Escribirlo a mano es como se produce un
# piso que no coincide con la regla, y un trinquete descalibrado no mide lo que dice medir.
if [ "${1:-}" = "--escribir-piso" ]; then
  : > "$BASE"
  { echo "# Piso del trinquete C1 de scripts/guard-citas.sh — GENERADO, no editar a mano."
    echo "# Se reescribe con: bash scripts/guard-citas.sh --escribir-piso"
    echo "# Un archivo ausente de esta lista tiene piso CERO."
  } >> "$BASE"
  while IFS= read -r f; do
    n=$(_censar_archivo "$f")
    [ "$n" -gt 0 ] && echo "${f#"$ROOT"/} $n" >> "$BASE"
  done < <(find "$ROOT" -name '*.md' -type f | sort)
  echo "piso reescrito en $BASE:"; grep -v '^#' "$BASE" | sed 's/^/  /'
  exit 0
fi

printf '\033[1mGUARD-CITAS\033[0m  (T55 · CLAUDE.md §5)  root=%s\n' "$ROOT"

# ══ C1 ════════════════════════════════════════════════════════════════════════════════════════
sec 'C1 · una cita `archivo.ext:NNN` sin simbolo (forma tolerada: `archivo.ext:~NNN`)'

ARCHIVOS=0; TOTAL=0; DEUDA=0
while IFS= read -r f; do
  ARCHIVOS=$((ARCHIVOS + 1))
  rel="${f#"$ROOT"/}"
  n=$(_censar_archivo "$f")
  TOTAL=$((TOTAL + n))
  piso=$(awk -v k="$rel" '$1 == k { print $2 }' "$BASE" 2>/dev/null | head -1)
  piso="${piso:-0}"
  if [ "$n" -gt "$piso" ]; then
    no "$rel: $n citas sin simbolo, el piso es $piso — la deuda de citas no puede crecer"
    grep -nE "$RE_CITA" "$f" | grep -v "$MARCA_CITA" | head -4 | cut -c1-160 | sed 's/^/        /'
  elif [ "$n" -lt "$piso" ]; then
    ok "$rel: $n < piso $piso"
    inf "el piso quedo flojo: apretalo con \`bash scripts/guard-citas.sh --escribir-piso\` (lo corre el LEAD)"
    DEUDA=$((DEUDA + n))
  elif [ "$piso" -gt 0 ]; then
    ok "$rel: $n citas, exactamente el piso declarado (deuda conocida, no crece)"
    DEUDA=$((DEUDA + n))
  fi
done < <(find "$ROOT" -name '*.md' -type f | sort)

# Canario: ausencia de medicion es FAIL, nunca PASS. Un `find` que no encuentra nada —root mal
# apuntado, escotilla rota— dejaria C1 sin una sola asercion y el gate saldria verde afirmando
# nada. Es el mismo bug que `guard-doc-tables.sh` cubre con `TABLAS = 0`.
if [ "$ARCHIVOS" = 0 ]; then
  no "cero archivos .md censados bajo '$ROOT': el gate no puede afirmar nada"
else
  inf "$ARCHIVOS archivo(s) censado(s) · $TOTAL cita(s) sin simbolo, $DEUDA dentro del piso declarado"
  EX_CITA=$(grep -rn "$MARCA_CITA" "$ROOT" 2>/dev/null | grep -oE "$RE_CITA" | wc -l | tr -d ' ')
  if [ "${EX_CITA:-0}" -gt 0 ]; then
    inf "$EX_CITA cita(s) exenta(s) con motivo escrito — NO cuentan para el piso y por eso se nombran aca:"
    _nombrar_exentas
  fi
fi

# ══ C2 ════════════════════════════════════════════════════════════════════════════════════════
sec 'C2 · un hash citado tiene que ser alcanzable desde HEAD (`merge-base --is-ancestor`, no `cat-file`)'

# ── El clon shallow, que es como este gate se volveria vacuamente rojo (o peor, verde) ────────
# `actions/checkout@v4` clona con `fetch-depth: 1` por default. En un arbol asi los objetos
# viejos NO estan, `merge-base --is-ancestor` dice que no para TODA cita, y C2 acusaria a las ~100
# validas del repo — un gate que grita contra todo es un gate que se apaga.
# La tentacion es saltear C2 cuando el clon es shallow. Seria peor: la dejaria VACUAMENTE VERDE
# justo en el unico lugar donde corre sola, que es el modo de falla de `accept-fase2` (semanas en
# rojo sin que nadie se enterara) visto del otro lado. Entonces falla, y nombra el arreglo.
if [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" = true ]; then
  no 'clon shallow: `merge-base --is-ancestor` no puede contestar, y C2 acusaria a toda cita valida'
  inf 'se arregla con `fetch-depth: 0` en actions/checkout. Saltear C2 aca la dejaria vacuamente verde.'
else

N_SHA=0; N_DESC=0; N_EX=0; N_MAL=0
while IFS= read -r hit; do
  [ -z "$hit" ] && continue
  hf="${hit%%:*}"; rest="${hit#*:}"; hl="${rest%%:*}"; h="${rest#*:}"
  h="${h//\`/}"

  # ¿Es un sha, o es un IMEI? Ver el docblock: (a) tiene letra, (b) mide 40, (c) git lo reconoce.
  if ! { printf '%s' "$h" | grep -q '[a-f]' && printf '%s' "$h" | grep -q '[0-9]'; }; then
    if [ "${#h}" != 40 ] && [ "$(git cat-file -t "$h" 2>/dev/null)" != commit ]; then
      N_DESC=$((N_DESC + 1)); continue
    fi
  fi
  N_SHA=$((N_SHA + 1))

  git merge-base --is-ancestor "$h" HEAD 2>/dev/null && continue

  if _exento_hash "$(sed -n "${hl}p" "$hf")"; then N_EX=$((N_EX + 1)); continue; fi

  N_MAL=$((N_MAL + 1))
  no "$hf:$hl cita \`$h\`, que NO es alcanzable desde HEAD (cat-file dice: $(git cat-file -t "$h" 2>/dev/null || echo 'no existe'))"
done < <(grep -rnoE "$RE_HASH" "$ROOT" 2>/dev/null || true)

if [ "$N_SHA" = 0 ]; then
  inf "ningun hash citado bajo '$ROOT'"
else
  [ "$N_MAL" = 0 ] && ok "los $N_SHA hash(es) citados son alcanzables desde HEAD"
  inf "$N_SHA sha(s) · $N_DESC token(es) hex descartados por no ser commits (IMEI y afines) · $N_EX exento(s) con motivo escrito"
fi

fi

printf '\n'
if [ "${fail:-0}" = "0" ]; then printf '\033[1;32mGUARD-CITAS: PASS\033[0m\n'
else printf '\033[1;31mGUARD-CITAS: FAIL\033[0m\n'; fi
exit "${fail:-0}"
