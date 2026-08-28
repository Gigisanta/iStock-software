#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════════════════════
#  Polaridad de la REGLA 3 de `guard-leaks.sh` — "sin TODO/FIXME sobre RLS, R2 o cache" (§2).
#
#  Por que esta regla y no las quince: es la unica que usa `hitsraw()`, y `hitsraw()` existe porque
#  la regla 3 estuvo VERDE POR CONSTRUCCION. Medido por el LEAD el 2026-08-28: con
#  `// TODO: despues el RLS` agregado a `apps/web/proxy.ts`, el gate imprimia `ok` y salia 0; con el
#  mismo texto al final de una linea de codigo imprimia LEAK. Veia la forma que nadie escribe.
#
#  Tercera instancia de la clase de `b5065a4` (`none()` vs `noneraw()` en `_lib.sh`). Este gate no
#  se arreglo aquella vez porque no importa `_lib.sh`: tiene su propio `hits()` copiado.
#
#  Las dos mitades no son simetricas y la que CALLA es la que sostiene el arreglo:
#   - si la mitad que ENCIENDE se rompe, la prohibicion vuelve a ser invisible (el bug original);
#   - si la mitad que CALLA se rompe, el gate castiga al que documenta el peligro en un comentario,
#     y entonces se le ensena al equipo a no documentarlo — que es de donde salio la convencion de
#     ignorar comentarios en primer lugar. Por eso `hits()` y `hitsraw()` son DOS helpers: sacarle
#     el filtro a las reglas 1 y 2 seria arreglar esta regla rompiendo aquellas.
#
#  Cada caso corre contra su propio arbol temporal via `LEAKS_ROOT`, con un canario que prueba que
#  la escotilla se respeta: sin el, todos los casos auditarian el repo real y los que callan
#  callarian por el motivo equivocado.
# ══════════════════════════════════════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")/.."

G="$PWD/scripts/guard-leaks.sh"
T="$PWD/scripts/.leaks-tmp"
fail=0
casos=0

trap 'rm -rf "$T"' EXIT

# `$1` rotulo · `$2` ENCIENDE|CALLA · `$3` path relativo dentro del arbol · `$4` contenido
# `$5` OPCIONAL: que linea del gate leer. Default: la de la regla 3.
#
# El parametro existe por un fallo de ESTE archivo, medido por el LEAD el 2026-08-28 y arreglado en
# el mismo commit: el caso "la regla 2 SIGUE ignorando comentarios" leia la linea de la REGLA 3, o
# sea afirmaba algo sobre la regla 2 midiendo otra. Mutando `hits()` para sacarle el filtro de
# comentarios —exactamente la "unificacion" que ese caso vino a prohibir— el test salia
# `PASS · 11 casos`. Es la misma familia que este gate persigue: la asercion apuntada a la linea
# equivocada no es mas debil que la correcta, es INDEPENDIENTE de lo que dice medir.
caso() {
  casos=$((casos + 1))
  rm -rf "$T"; mkdir -p "$T/apps/web/app" "$T/$(dirname "$3")"
  # Un archivo limpio siempre presente: sin el, un arbol sin fuentes daria verde por vacio y este
  # test estaria midiendo la ausencia de archivos en vez de la regla.
  printf 'export const ok = 1;\n' > "$T/apps/web/app/limpio.ts"
  printf '%s' "$4" > "$T/$3"
  SALIDA=$(LEAKS_ROOT="$T" bash "$G" 2>&1 | sed 's/\x1b\[[0-9;]*m//g')
  LINEA=$(printf '%s\n' "$SALIDA" | grep "${5:-sin TODO/FIXME sobre RLS}" || true)
  case "$LINEA" in
    *LEAK*) VISTO=ENCIENDE ;;
    *ok*)   VISTO=CALLA ;;
    *)      VISTO=AUSENTE ;;
  esac
  if [ "$VISTO" != "$2" ]; then
    printf '  \033[31mMAL\033[0m   %-58s se vio %s y se esperaba %s\n' "$1" "$VISTO" "$2"; fail=1
  elif [ "$2" = "ENCIENDE" ] && ! printf '%s\n' "$SALIDA" | grep -q "$3"; then
    # Encendio, pero sin nombrar el archivo plantado: seria un rojo por otra cosa.
    printf '  \033[31mMAL\033[0m   %-58s encendio sin nombrar %s\n' "$1" "$3"; fail=1
  else
    printf '  \033[32mOK\033[0m    %-58s %s\n' "$1" "$2"
  fi
}

printf '\n\033[1m── se ve ENCENDER  (la forma canonica y sus variantes)\033[0m\n'

caso 'la forma canonica: comentario de linea entera (EL BUG DE 2026-08-28)' ENCIENDE \
  'apps/web/app/a.ts' '// TODO: despues el RLS
export const a = 1;
'
caso 'la misma deuda al final de una linea de codigo (lo unico que veia antes)' ENCIENDE \
  'apps/web/app/b.ts' 'export const b = 1; // TODO: despues el RLS
'
caso 'comentario de bloque, que tampoco arranca con //' ENCIENDE \
  'apps/web/app/c.ts' '/* FIXME: el filtro de tenant despues */
export const c = 1;
'
caso 'comentario de SQL en una migracion (marcador --)' ENCIENDE \
  'apps/web/app/d.sql' '-- TODO: la policy de RLS despues
select 1;
'
caso 'e2e/, que ninguna slice nombraba y por eso no lo auditaba nadie' ENCIENDE \
  'e2e/x.spec.ts' '// TODO: cachear esto despues
export const x = 1;
'
caso 'scripts/probes/, misma zona huerfana' ENCIENDE \
  'scripts/probes/y.test.ts' '// XXX: falta el R2 real aca
export const y = 1;
'

printf '\n\033[1m── se ve CALLAR  (lo que se le parece y es legitimo)\033[0m\n'

caso 'castellano bien escrito: "TODOS los tenants" (falso positivo historico)' CALLA \
  'apps/web/app/e.ts' '// el cron ve las reservas vencidas de TODOS los tenants
export const e = 1;
'
caso 'un TODO real pero ajeno a seguridad y costo' CALLA \
  'apps/web/app/f.ts' '// TODO: mejorar el copy del boton de canje
export const f = 1;
'
caso 'TODO y la palabra RLS a mas de 59 caracteres (la ventana)' CALLA \
  'apps/web/app/g.ts' '// TODO: renombrar esta variable porque el nombre viejo confunde a cualquiera que lea el RLS
export const g = 1;
'
# ── La asimetria: la regla 3 perdio el filtro de comentarios, las OTRAS no. Si alguien "unifica"
#    los helpers, este caso se pone rojo y explica por que no se unifican.
caso 'la regla 2 SIGUE ignorando comentarios: documentar el peligro no es cometerlo' CALLA \
  'apps/web/app/h.ts' '// nunca hacer console.log(listing) entero
export const h = 1;
' 'sin console.log'

printf '\n\033[1m── canario de la escotilla\033[0m\n'
# Sin esto, todos los casos de arriba podrian haber auditado el REPO REAL —que esta limpio— y los
# seis ENCIENDE habrian fallado ruidosamente... pero los cuatro CALLA habrian pasado por el motivo
# equivocado. El canario prueba que `LEAKS_ROOT` es lo que se lee.
rm -rf "$T"; mkdir -p "$T/apps/web/app"
printf '// TODO: despues el RLS\n' > "$T/apps/web/app/canario.ts"
SAL=$(LEAKS_ROOT="$T" bash "$G" 2>&1 | sed 's/\x1b\[[0-9;]*m//g')
casos=$((casos + 1))
if printf '%s\n' "$SAL" | grep -q 'apps/web/app/canario.ts'; then
  printf '  \033[32mOK\033[0m    %-58s %s\n' 'LEAKS_ROOT se respeta (nombra el archivo plantado)' 'CANARIO'
else
  printf '  \033[31mMAL\033[0m   %-58s %s\n' 'LEAKS_ROOT NO se respeta: los CALLA no valen nada' 'CANARIO'; fail=1
fi

echo
if [ "$fail" -eq 0 ]; then echo "GUARD-LEAKS.TEST: PASS · $casos casos"; else echo "GUARD-LEAKS.TEST: FAIL"; fi
exit "$fail"
