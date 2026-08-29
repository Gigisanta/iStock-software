#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════════════════════
#  ACEPTACION DE S10 — importar stock desde un CSV. La re-ejecuta el LEAD.
#  gate-owner: LEAD (CLAUDE.md §4 — el gate no puede ser del writer que audita)
#
#  Lo que el board pide, literal: «errores por fila; sin import parcial silencioso».
#
#  ── Por que no alcanzaba con los 110 tests de `app-agent` ────────────────────────────────────
#  Los 110 son PUROS. Prueban el PLANIFICADOR —que el archivo tiene 8 filas malas y cuales son— y
#  ninguno toca Postgres. La segunda mitad del gate («sin import parcial silencioso») no es una
#  afirmacion sobre el planificador: es una afirmacion sobre el ESTADO DE DOS TABLAS despues de un
#  rechazo, y ningun test puro puede hacerla.
#
#  La regresion realista lo deja claro: si alguien cambia el `insert` multi-fila por un `for` con
#  `try/catch` adentro —que es como se "arregla" un import que falla por una fila— las 3 filas
#  buenas entran, la pantalla sigue diciendo *"no importamos nada"*, y los 110 tests siguen verdes,
#  porque el planificador devuelve exactamente los mismos 8 errores. Lo unico que cambia es una
#  tabla que nadie mira. V7 la cuenta.
#
#  ── La verificacion que manda es V1, y es de ORDEN ───────────────────────────────────────────
#  "Validar todo primero, escribir despues" no es un comentario: es un orden de dos lineas. V1
#  compara NUMEROS DE LINEA — `resolveImportPlan(` tiene que aparecer antes del primer
#  `tx.insert(`. Es la misma tecnica que V1 de `accept-s13.sh` y por el mismo motivo: un grep de
#  presencia da verde con las dos llamadas invertidas, que es justo el bug.
#
#  ── Lo que este gate NO afirma ───────────────────────────────────────────────────────────────
#  1. **Idempotencia.** Subir el mismo archivo dos veces carga los equipos dos veces, y hoy eso es
#     cierto a proposito: arreglarlo pide una clave de import persistida, o sea una tabla nueva, que
#     es de `db-agent`. Un gate que lo exigiera estaria exigiendo algo que la slice no promete —y
#     lo levanto `app-agent` en su parte, sin fingirlo, que es lo correcto de su parte.
#  2. **El modelo de permisos.** V7 mide que el `seller` no pueda subir un archivo con columna de
#     costo (`archivo_con_costo_de_seller_rechazado`), que es la mitad que esta en el camino. El
#     modelo completo de roles es `S11`.
#  3. **El modo de servido.** `/app/stock/importar` tiene fila propia en `scripts/guard-routes.sh`,
#     que corre aparte: un gate que llama a otro hace que un rojo se lea dos veces con dos nombres.
#
#
#  ── Los mutantes con los que se probo el gate (LEAD, 2026-08-28) ─────────────────────────────
#  Un harness verde no es evidencia de nada hasta que se lo ve encender. Cuatro mutaciones, cada
#  una restaurada byte a byte despues de medirla (`shasum -a 256` contra la copia previa):
#
#  M1 · `build-import.ts`, `issues.length > 0` → `> 999` (el import parcial silencioso literal).
#       Mata el caso A. **Los 110 tests tambien lo matan** (6 rojos), asi que M1 prueba que el
#       gate enciende, no que el gate haga falta.
#  M2 · el `insert` de la bitacora envuelto en un `try/catch` que se traga el error.
#       **Mutante EQUIVALENTE, y vale saber por que:** en Postgres un statement que revienta
#       aborta la transaccion entera, asi que tragarse el error en JS no salva nada — el `COMMIT`
#       vuelve `ROLLBACK` igual. La atomicidad de esta slice la sostiene el motor, no el `catch`.
#  M2b· la bitacora movida a SU PROPIA `withTenantDb`, despues de commitear las unidades — que es
#       la regresion que alguien escribe de verdad ("necesito una tx, llamo de nuevo al helper").
#       **Los 110 tests quedan en VERDE** y `unidades_tras_fallo_del_motor` pasa de 0 a 3. Este es
#       el mutante que justifica la probe con base y el trigger inyectado. V2 tambien lo agarra por
#       el lado estatico (`un solo withTenantDb`), que es a proposito: dos verificaciones distintas
#       sobre el mismo invariante, una que lee el codigo y otra que cuenta filas.
#  M3 · el mensaje del IMEI invalido citando el valor. `imei_en_los_mensajes` pasa de 0 a 1.
#  M4 · el ancla del corte duplicada ARRIBA del plan, sin cambiar una linea de logica.
#       V1 imprime `plan (:123) · corte (:122)` y se pone roja: la comparacion es de orden, no de
#       presencia.
#
#  Corre en `ci.yml`, en el job que tiene Postgres (con S7, S8, S9 y S13).
# ══════════════════════════════════════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/_lib.sh
. scripts/_lib.sh

fail=0
CSV='apps/web/app/(app)/_lib/csv-import'
PANT='apps/web/app/(app)/app/(panel)/stock/importar'
IMP="$CSV/import-listings.ts"
PROBE='scripts/probes/s10-import-csv.test.ts'

sec 'V0 · los artefactos existen y no estan vacios'
for f in \
  "$CSV/parse-csv.ts" "$CSV/parse-csv.test.ts" \
  "$CSV/schema.ts" "$CSV/schema.test.ts" \
  "$CSV/build-import.ts" "$CSV/build-import.test.ts" \
  "$CSV/queries.ts" "$IMP" \
  "$PANT/page.tsx" "$PANT/actions.ts" "$PANT/form-state.ts" "$PANT/importar-form.tsx" \
  "$PROBE"
do have "$f"; done

# ── V1 · validar todo primero, escribir despues ───────────────────────────────────────────────
sec 'V1 · `resolveImportPlan` corre ANTES del primer `insert`, y el rechazo corta en el medio'

L_PLAN=$(grep -n 'resolveImportPlan(read' "$IMP" | head -1 | cut -d: -f1)
L_CORTE=$(grep -n 'if (!planned.ok)' "$IMP" | head -1 | cut -d: -f1)
L_INS=$(grep -n 'tx.insert(' "$IMP" | head -1 | cut -d: -f1)

if [ -z "$L_PLAN" ] || [ -z "$L_CORTE" ] || [ -z "$L_INS" ]; then
  # Ausencia de medicion es FAIL, nunca PASS: sin las tres anclas el gate no puede afirmar el
  # orden, y salir verde seria afirmar nada. Mismo canario que V1 de `accept-s13.sh`.
  no "no se encontraron las tres anclas en $IMP (plan='$L_PLAN' corte='$L_CORTE' insert='$L_INS'): el gate NO puede afirmar el orden y no pasa por ausencia de medicion"
elif [ "$L_PLAN" -lt "$L_CORTE" ] && [ "$L_CORTE" -lt "$L_INS" ]; then
  ok "el orden se sostiene: plan (:$L_PLAN) → corte (:$L_CORTE) → insert (:$L_INS)"
else
  no "el orden esta roto: plan (:$L_PLAN) · corte (:$L_CORTE) · insert (:$L_INS). Con el \`insert\` antes del corte, el import escribe filas de un archivo que despues rechaza"
fi

# ── V2 · una sola transaccion, y los dos `insert` adentro ─────────────────────────────────────
#
# El rollback del caso D de la probe depende enteramente de esto. Dos `withTenantDb` serian dos
# transacciones, y entonces la bitagora podria fallar con las unidades ya confirmadas: import
# parcial, esta vez por el motor y no por un `for`.
sec 'V2 · UNA transaccion para las dos escrituras'
N_TX=$(grep -c 'withTenantDb(' "$IMP" || true)
N_INS=$(grep -c 'tx.insert(' "$IMP" || true)
if [ "${N_TX:-0}" = "1" ]; then ok "un solo \`withTenantDb\` en import-listings.ts"
else no "hay $N_TX \`withTenantDb\` en $IMP y tiene que haber exactamente 1: dos transacciones pueden dejar unidades sin bitacora"; fi
if [ "${N_INS:-0}" = "2" ]; then ok 'los dos `tx.insert` (unidades y bitacora) estan en esa transaccion'
else no "hay $N_INS \`tx.insert\` en $IMP y tiene que haber exactamente 2 (listings y listing_events)"; fi

# Nadie escribe por fuera del `tx`. Un `db().insert` en esta carpeta esta fuera de la transaccion
# Y fuera de RLS a la vez: las dos capas se pierden con la misma linea.
if grep -rnE '\bdb\(\)\.(insert|update|delete)\b' "$CSV" "$PANT" 2>/dev/null | grep -q .; then
  no 'alguien escribe con `db()` en el camino del import: eso corre fuera de la transaccion y fuera de RLS'
  grep -rnE '\bdb\(\)\.(insert|update|delete)\b' "$CSV" "$PANT" 2>/dev/null | sed 's/^/        /'
else
  ok 'ninguna escritura del import esquiva el `tx`'
fi

# ── V3 · el estado `partial` no existe, y no se puede colar por descuido ──────────────────────
sec 'V3 · no hay un estado intermedio que anuncie un import a medias'
if grep -rniE "['\"]partial['\"]|parcial-anunciado" "$CSV" "$PANT" 2>/dev/null | grep -vE '^\S+:[0-9]+: *\*|\*\*' | grep -q .; then
  no 'aparecio un estado `partial` en el camino del import: el diseño es todo o nada (ver el docblock de build-import.ts)'
  grep -rniE "['\"]partial['\"]" "$CSV" "$PANT" 2>/dev/null | sed 's/^/        /'
else
  ok 'ningun literal `partial` en el camino del import'
fi

ESTADOS=$(grep -n 'export type ImportStatus' "$PANT/form-state.ts" || true)
if [ -z "$ESTADOS" ]; then
  no "no se encontro \`ImportStatus\` en $PANT/form-state.ts: sin el tipo, V3 no mide nada"
elif printf '%s' "$ESTADOS" | grep -q "'idle' | 'imported' | 'file_error' | 'row_errors'"; then
  ok '`ImportStatus` tiene exactamente los cuatro estados, y ninguno es "importado a medias"'
else
  no "\`ImportStatus\` cambio de forma: $ESTADOS — si se agrego un estado, decidir si anuncia un import parcial antes de tocar este gate"
fi

# ── V4 · el import no abrio un endpoint ───────────────────────────────────────────────────────
#
# Es la respuesta al punto 1 del parte de `app-agent`, convertida en gate: la pantalla postea a su
# propia URL por Server Action y la plantilla se copia como texto, asi que NO hay `route.ts` nuevo
# y por eso NO hay regla de WAF nueva. Si mañana alguien agrega un endpoint de descarga o de
# upload, este gate lo dice — y ahi hay que decidir un techo, no descubrirlo en la factura.
sec 'V4 · la pantalla de import no abre un route handler'
N_RT=$(find "$PANT" -name 'route.ts' -o -name 'route.tsx' 2>/dev/null | wc -l | tr -d ' ')
if [ "${N_RT:-0}" = "0" ]; then
  ok 'cero `route.ts` bajo la pantalla de import: no hay endpoint nuevo que necesite techo de WAF'
else
  no "aparecieron $N_RT route handler(s) bajo $PANT: hay que decidir su techo en config/firewall-rules.json (es del LEAD) antes de mergear"
fi

# ── V5 · las dos capas de tenant en el `insert` ───────────────────────────────────────────────
#
# W015 ya lo exige y ya esta verde; se repite aca porque la vara de W015 para un `insert` es
# "`tenantId` en el `values()`", y este gate quiere que la afirmacion viva tambien del lado de la
# slice: un dia que `web-lint` cambie de vara, esto sigue midiendo lo mismo.
sec 'V5 · el `insert` ata el tenant explicitamente, ademas de RLS'
N_TEN=$(grep -c 'tenantId: ctx.tenantId' "$IMP" || true)
if [ "${N_TEN:-0}" -ge 2 ]; then
  ok "las dos escrituras nombran \`tenantId: ctx.tenantId\` ($N_TEN ocurrencias)"
else
  no "solo $N_TEN escritura(s) atan el tenant en el \`values()\`: un \`insert\` no tiene \`where\` donde atarlo, asi que RLS quedaria como unica capa (CLAUDE.md §2)"
fi

# ── V6 · el arbol verde ───────────────────────────────────────────────────────────────────────
sec 'V6 · el arbol esta verde'
chk 'pnpm typecheck' 'pnpm typecheck'
chk 'pnpm lint'      'pnpm lint'
chk 'pnpm test'      'pnpm test'

# ── V7 · el parte de la probe, campo por campo ────────────────────────────────────────────────
#
# Un `exit 0` de la probe no alcanza: una probe que dejo de armar el fixture sale 0 con las
# aserciones corriendo sobre la nada. Por eso se exige la linea `MEDIDO`, y **su ausencia es FAIL,
# nunca PASS**.
#
# Los esperados de abajo son literales ESCRITOS ACA, en shell, en otro archivo que la probe
# (ADR-023). No se derivan leyendo el fuente: una comparacion del mismo origen pasa cuando los dos
# lados estan mal igual.
sec 'V7 · el parte del import existe y sus numeros son los esperados'
if [ ! -s "$PROBE" ]; then
  no "falta la probe del LEAD: $PROBE"
else
  POUT=$(mktemp)
  pnpm vitest run "$PROBE" >"$POUT" 2>&1 || true
  MED=$(grep -aoE 'MEDIDO s10 import · .*' "$POUT" | head -1 || true)
  if [ -z "$MED" ]; then
    no 'no hay linea "MEDIDO s10 import": la probe no dejo parte de lo que midio y el gate NO pasa por ausencia de medicion'
    tail -25 "$POUT" | sed 's/^/        /'
  else
    inf "$MED"
    campo() { printf '%s' "$MED" | sed -nE "s/.*[[:space:]]$1=([^ ·]*).*/\1/p"; }

    # El conjunto EXACTO de lineas malas, no la cantidad: ocho errores sobre ocho filas equivocadas
    # dan el mismo 8 que ocho sobre las correctas. El literal sale de LEER EL FIXTURE de la probe
    # (11 filas, malas la 3,4,5,6,7,8,10,11), no de correr nada.
    LM=$(campo 'lineas_malas')
    if [ "$LM" = '3-4-5-6-7-8-10-11' ]; then
      ok "lineas_malas=$LM"
    else
      no "lineas_malas=$LM y se esperaba 3-4-5-6-7-8-10-11 — el planificador acusa a otras filas que las que el fixture rompe. Un corrimiento de uno en todas es el numero de linea FISICA del archivo, que es el que el dueño ve en Excel"
    fi

    # campo:esperado:que_significa_si_no_da
    for par in \
      'filas_malas_reportadas:8:se reportan TODAS las filas malas de una vez. Menos de 8 = el import corta en el primer error y obliga a subir el archivo N veces, que es el modo de falla que la slice vino a matar' \
      'filas_buenas_anunciadas:3:cuantas HABRIAN entrado. Se muestra en la pantalla debajo del rojo, nunca arriba: el dueño tiene que leer "no entro nada" antes que "3 estaban bien"' \
      'unidades_tras_rechazo:0:LA afirmacion de la slice. 3 = import parcial silencioso: las filas buenas entraron mientras la pantalla decia que no entro nada. Es lo que pasa si el `insert` multi-fila se vuelve un `for` con `try/catch`' \
      'eventos_tras_rechazo:0:misma afirmacion sobre `listing_events`. Bitacora sin unidad es peor que ninguna: la historia del stock afirma un alta que no existe' \
      'imei_en_los_mensajes:0:el IMEI invalido del fixture aparece en algun mensaje de error. CLAUDE.md §1: "IMEI nunca en vidriera, ni en logs". Un mensaje de validacion que lo repite es un log con otro nombre' \
      'unidades_tras_exito:3:el archivo limpio entra ENTERO. 0 = el import no importa; 1 o 2 = entra a medias tambien en el camino feliz' \
      'eventos_tras_exito:3:una bitacora por unidad. Menos = altas sin rastro; mas = unidades fantasma en la historia' \
      'unidades_en_otro_tenant:0:el import escribio en el tenant vecino. Es la fuga de tenant de esta slice y no tiene lectura benigna' \
      'unidades_tras_fallo_del_motor:0:se inyecta una falla en el `insert` de la bitacora con un trigger, DESPUES de que las unidades ya se escribieron. 3 = la transaccion de `withTenantDb` no esta deshaciendo nada, o sea que "todo o nada" vale solo mientras el motor no falle' \
      'archivo_con_costo_de_seller_rechazado:1:el `seller` subio un archivo con columna de costo y entro. CLAUDE.md §9: el seller no ve costo ni margen, y cargarlo es verlo' \
    ; do
      N=${par%%:*}; R=${par#*:}; E=${R%%:*}; POR=${R#*:}
      V=$(campo "$N")
      case "$V" in
        ''|*[!0-9]*) no "el parte no trae \`$N\` legible ('$V'): cambio el formato de la linea — arreglar el gate, no la linea" ;;
        "$E")        ok "$N=$V" ;;
        *)           no "$N=$V y se esperaba $E — $POR" ;;
      esac
    done
  fi
  rm -f "$POUT"
fi

# ══════════════════════════════════════════════════════════════════════════════════════════════
printf '\n'
if [ "$fail" = "0" ]; then
  printf '\033[32mS10: ACEPTADA\033[0m\n'
else
  printf '\033[31mS10: RECHAZADA\033[0m\n'
fi
exit "$fail"
