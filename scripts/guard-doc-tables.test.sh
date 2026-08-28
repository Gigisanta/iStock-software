#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════════════════════
#  Polaridad de `guard-doc-tables.sh`. Se tiene que ver ENCENDER sobre las tres formas de la
#  corrupcion, y se tiene que ver CALLAR sobre las cuatro formas legitimas que se le parecen.
#
#  La mitad que calla es la que importa mas, y no es simetrica con la otra: un gate de tablas que
#  se pasa de listo castiga el arreglo. El `\|` escapado ES la correccion de los tres casos
#  historicos — si el gate lo contara como separador, cada fila arreglada volveria a encender y el
#  gate ensenaria a no arreglar nada.
#
#  Cada caso corre contra su propio arbol temporal via `DOC_TABLES_ROOT`, y hay un canario que
#  prueba que esa escotilla se respeta: sin el, todos los casos habrian auditado los docs reales y
#  el que calla habria callado por el motivo equivocado.
# ══════════════════════════════════════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")/.."

G="scripts/guard-doc-tables.sh"
T="scripts/.doctables-tmp"
fail=0
casos=0

trap 'rm -rf "$T"' EXIT

# `$1` rotulo · `$2` ENCIENDE|CALLA · `$3` contenido del .md
caso() {
  casos=$((casos + 1))
  rm -rf "$T"; mkdir -p "$T/docs"
  printf '%s' "$3" > "$T/docs/f.md"
  SALIDA=$(DOC_TABLES_ROOT="$T" bash "$G" 2>&1 | sed 's/\x1b\[[0-9;]*m//g')
  if printf '%s\n' "$SALIDA" | grep -q 'GUARD-DOC-TABLES: FAIL'; then VISTO=ENCIENDE; else VISTO=CALLA; fi
  # Un CALLA solo vale si ademas el gate CENSO la tabla: "cero tablas" tambien saldria verde en un
  # gate roto, y seria el mismo verde vacio que este repo persigue.
  CENSADAS=$(printf '%s\n' "$SALIDA" | sed -nE 's/.*de las ([0-9]+) tablas.*/\1/p' | head -1)
  if [ "$VISTO" != "$2" ]; then
    printf '  \033[31mMAL\033[0m   %-52s se vio %s y se esperaba %s\n' "$1" "$VISTO" "$2"; fail=1
  elif [ "$2" = "CALLA" ] && [ "${CENSADAS:-0}" -lt 1 ]; then
    printf '  \033[31mMAL\033[0m   %-52s callo pero censo 0 tablas: verde vacio\n' "$1"; fail=1
  else
    printf '  \033[32mOK\033[0m    %-52s %s\n' "$1" "$2"
  fi
}

printf '\n\033[1m── se ve ENCENDER ──\033[0m\n'

caso 'un `|` sin escapar adentro de codigo inline (los 3 casos reales)' ENCIENDE \
'| id | estado | owner |
|---|---|---|
| T1 | `ls docs/*.md | wc -l` | LEAD |
'
caso 'una columna de MENOS (clase real, sin caso historico)' ENCIENDE \
'| id | estado | owner |
|---|---|---|
| T1 | done |
'
caso 'un `|` suelto en texto plano' ENCIENDE \
'| id | estado |
|---|---|
| T1 | done | de mas |
'

printf '\n\033[1m── se ve CALLAR (y censo la tabla igual) ──\033[0m\n'

caso 'la tabla correcta' CALLA \
'| id | estado | owner |
|---|---|---|
| T1 | done | LEAD |
| T2 | doing | qa-agent |
'
caso 'el `\|` escapado: es el ARREGLO, no puede encender' CALLA \
'| id | estado | owner |
|---|---|---|
| T1 | `ls docs/*.md \| wc -l` | LEAD |
'
caso 'un `|` adentro de un bloque de codigo, fuera de toda tabla' CALLA \
'| id | estado |
|---|---|
| T1 | done |

```sh
grep -c foo | wc -l
```
'
caso 'texto con pipes que NO es tabla (sin separador debajo)' CALLA \
'| id | estado |
|---|---|
| T1 | done |

Una linea suelta con a | b | c y nada mas.
'

printf '\n\033[1m── el control negativo del arnes ──\033[0m\n'

casos=$((casos + 1))
rm -rf "$T"; mkdir -p "$T/docs"
printf 'sin ninguna tabla.\n' > "$T/docs/f.md"
SAL=$(DOC_TABLES_ROOT="$T" bash "$G" 2>&1 | sed 's/\x1b\[[0-9;]*m//g')
if printf '%s\n' "$SAL" | grep -q 'cero tablas censadas'; then
  printf '  \033[32mOK\033[0m    %-52s cero tablas es FAIL, no PASS\n' 'un arbol sin tablas no se puede afirmar'
else
  printf '  \033[31mMAL\033[0m   %-52s salio verde sobre cero mediciones\n' 'un arbol sin tablas no se puede afirmar'; fail=1
fi

casos=$((casos + 1))
rm -rf "$T"; mkdir -p "$T/docs"
printf '| a |\n|---|\n| x | y |\n' > "$T/docs/f.md"
SAL=$(DOC_TABLES_ROOT="$T" bash "$G" 2>&1 | sed 's/\x1b\[[0-9;]*m//g')
if printf '%s\n' "$SAL" | grep -q 'docs/f.md:3'; then
  printf '  \033[32mOK\033[0m    %-52s el gate audita el fixture, no docs/ real\n' 'DOC_TABLES_ROOT se respeta'
else
  printf '  \033[31mMAL\033[0m   %-52s los casos de arriba no probaron nada\n' 'DOC_TABLES_ROOT se respeta'; fail=1
fi

printf '\n'
if [ "$fail" = "0" ]; then
  printf '\033[1;32mPOLARIDAD DOC-TABLES: OK\033[0m — %s casos, se vio encender y se vio callar.\n' "$casos"
else
  printf '\033[1;31mPOLARIDAD DOC-TABLES: MAL\033[0m\n'
fi
exit "$fail"
