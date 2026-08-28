#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════════════════════
#  GUARD DE TABLAS DE DOCS — una fila con una columna de mas se corrompe en silencio
#
#  El board es el estado de la verdad de este repo: quien es dueño de que, que slice esta abierta,
#  que gate corrio. Y se rompe de una manera especifica y repetida — un `|` sin escapar adentro de
#  `` `codigo inline` ``. Markdown no lo lee como codigo: lo lee como separador de columna, la fila
#  se renderiza con una columna de mas, y las celdas de la derecha se corren un lugar. **El texto
#  sigue estando; lo que cambia es a que columna pertenece.** Una fila de ownership donde el dueño
#  se corrio un casillero dice que el dueño es otro.
#
#  ── Por que existe este gate, y no es una hipotesis ──────────────────────────────────────────
#  Paso TRES veces, todas con la misma forma —`git show … | grep -c W016`, `ls … | wc -l`— en
#  `SLICE_BOARD.md` (T26, T30) y en `TEST_MATRIX.md`. Las tres las encontro `docs-keeper` mirando,
#  a mano, mientras editaba otra cosa. Tres instancias arregladas de a una es la firma de una clase
#  sin gate: es literalmente T28/T30 corrido un escalon mas —alla se recordaba el dueño de un gate
#  y despues su corrida; aca se recuerda que un pipe se escapa.
#
#  `guard-artifacts.sh` no lo ve y no es su trabajo: el verifica que el archivo exista y tenga
#  bytes. Un board corrupto tiene bytes de sobra — imprime `OK 237271` y sigue.
#
#  ── Que cuenta como pipe, y la primera version de este gate lo tenia al reves ────────────────
#  Adentro de una fila de tabla, **el UNICO pipe que no separa es `\|`**. En Markdown la fila se
#  parte por `|` ANTES de mirar los backticks, asi que un pipe adentro de `` `codigo inline` ``
#  separa igual — que es exactamente por que los tres casos historicos se rompieron, y por que el
#  arreglo es escaparlo.
#
#  La primera version de este gate eximia al codigo inline. Sonaba razonable y era la premisa
#  invertida: con esa regla el gate **no veia el defecto para el que fue escrito** — el caso del
#  arnes que reproduce `` `ls docs/*.md | wc -l` `` salia verde. Lo agarro `guard-doc-tables.test.sh`
#  antes de que el gate entrara a CI, que es lo que un arnes de polaridad existe para hacer, y es
#  ADR-024 aplicado al gate mismo: la spec que escribi primero perdio contra la medicion.
#
#  Y hacia las dos cosas a la vez, que es la parte que no vi hasta que me corrigieron. La misma
#  premisa invertida **INVENTABA**: en su unica corrida imprimio `6 vs 7` sobre la fila `T28` del
#  board y yo lo reporte como un cuarto caso real. No lo era. Esa fila tiene 61 backticks —impar—,
#  y al blanquear spans el gate viejo formaba uno fantasma que se comia un pipe ESTRUCTURAL. Con el
#  modelo vigente la misma fila de `HEAD`, sin tocar, da 7 y PASA. Lo midio `docs-keeper` y lo
#  verifique yo contra `git show HEAD:docs/SLICE_BOARD.md`. Moraleja operativa, no filosofica: un
#  gate recien nacido que enciende **no es evidencia de un defecto hasta que se reproduce el
#  defecto sin el gate**. El backtick colgado es real y es cosmetico; no corre ninguna columna.
#
#  Lo que si queda afuera del conteo: `\|`, porque es LA correccion —si contara, el gate castigaria
#  el arreglo y ensenaria a no arreglar— y todo lo que vive dentro de un bloque ``` ``` ```, donde
#  un `|` es contenido y no hay tabla ninguna.
#
#  ── Que se afirma ────────────────────────────────────────────────────────────────────────────
#  Toda fila de una tabla tiene **exactamente** las columnas que declara su encabezado. Ni mas
#  —el caso medido— ni menos, que es la misma corrupcion en la otra direccion.
#
#  ci-exento: no aplica — este gate corre en ci.yml, ver .github/workflows/ci.yml
#  gate-owner: LEAD
# ══════════════════════════════════════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/_lib.sh
. scripts/_lib.sh

RAIZ="${DOC_TABLES_ROOT:-.}"

sec 'D1 · toda fila de tabla tiene las columnas que declara su encabezado'

SALIDA=$(RAIZ="$RAIZ" python3 - <<'PY'
import os, re, sys, pathlib

raiz = pathlib.Path(os.environ['RAIZ'])
archivos = sorted(
    p for p in list(raiz.glob('docs/**/*.md')) + list(raiz.glob('*.md'))
    if 'node_modules' not in p.parts
)

def columnas(linea):
    """Celdas de la fila. El unico pipe que NO separa es `\\|`: ver el encabezado."""
    s = linea.replace('\\|', '\x00')      # el escape, y nada mas que el escape
    s = s.strip()
    if s.startswith('|'): s = s[1:]
    if s.endswith('|'):   s = s[:-1]
    return s.split('|')

SEP = re.compile(r'^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$')

fallas, tablas, filas = [], 0, 0
for archivo in archivos:
    lineas = archivo.read_text(encoding='utf-8').split('\n')
    en_bloque, cabecera, n_col, linea_cab = False, None, 0, 0
    for i, linea in enumerate(lineas, 1):
        if linea.lstrip().startswith('```'):
            en_bloque = not en_bloque
            cabecera = None
            continue
        if en_bloque:
            continue
        es_fila = '|' in linea.replace('\\|', '')
        if not es_fila:
            cabecera = None
            continue
        if cabecera is None:
            # Una cabecera solo lo es si la linea de abajo es el separador `---|---`.
            if i < len(lineas) and SEP.match(lineas[i]):
                cabecera, n_col, linea_cab = linea, len(columnas(linea)), i
                tablas += 1
            continue
        if SEP.match(linea):
            continue
        filas += 1
        n = len(columnas(linea))
        if n != n_col:
            rel = archivo.relative_to(raiz) if raiz != pathlib.Path('.') else archivo
            fallas.append(
                f'{rel}:{i}  {n} columnas y la cabecera (linea {linea_cab}) declara {n_col}'
                f'  ·  {linea.strip()[:90]}'
            )

for f in fallas:
    print('D1 ' + f)
print(f'__CENSO__ {len(archivos)} {tablas} {filas} {len(fallas)}')
PY
)
RC=$?

CENSO=$(printf '%s\n' "$SALIDA" | grep '^__CENSO__' | tail -1)
if [ "$RC" != 0 ] || [ -z "$CENSO" ]; then
  no 'el censo de tablas no corrio: ausencia de medicion es FAIL, nunca PASS'
  printf '%s\n' "$SALIDA" | sed 's/^/        /' | tail -5
else
  # shellcheck disable=SC2086
  set -- $CENSO
  ARCHIVOS=$2; TABLAS=$3; FILAS=$4; FALLAS=$5
  if [ "$TABLAS" = "0" ]; then
    no "cero tablas censadas en $ARCHIVOS archivo(s): el gate no puede afirmar nada"
  elif [ "$FALLAS" = "0" ]; then
    ok "las $FILAS filas de las $TABLAS tablas de $ARCHIVOS archivo(s) tienen las columnas de su cabecera"
  else
    no "$FALLAS fila(s) con columnas de mas o de menos (un \`|\` sin escapar corre las celdas de lugar)"
    printf '%s\n' "$SALIDA" | grep '^D1 ' | sed 's/^D1 /        /'
  fi
fi

printf '\n'
if [ "${fail:-0}" = "0" ]; then printf '\033[1;32mGUARD-DOC-TABLES: PASS\033[0m\n'
else printf '\033[1;31mGUARD-DOC-TABLES: FAIL\033[0m\n'; fi
exit "${fail:-0}"
