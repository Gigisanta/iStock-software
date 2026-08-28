#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════════════════════
#  ACEPTACION DE S7 — venta manual. La re-ejecuta el LEAD, no el agente que escribio el codigo.
#  gate-owner: LEAD (CLAUDE.md §4 — el gate no puede ser del writer que audita)
#
#  Gate del board: "el dueño marca vendida una unidad, desde `reserved` o desde `available`, y
#  queda la fila en `sales` con el costo y el TC congelados".
#
#  ── El defecto que abre la slice, medido ANTES de escribir esto ──────────────────────────────
#  `packages/domain/src/listing-status.ts:247` declara `createsSale: to === 'sold'`. Un
#  `grep -rn 'createsSale'` sobre el repo entero devolvia CUATRO lineas: la declaracion, la
#  implementacion, y dos tests del PROPIO dominio. Cero consumidores.
#
#  `transitionUnit()` ejecutaba tres de los cuatro efectos —`closesReservationAs`,
#  `revalidateStorefront`, `writesListingEvent`— y descartaba `createsSale` en silencio. La tabla
#  `sales` existia con RLS, indices y seed, y ningun codigo de produccion le escribia una fila.
#
#  No rompia nada visible por una sola razon: el Zod del panel era `z.enum(['available','draft'])`,
#  asi que `sold` no era alcanzable. O sea que el dia que alguien agregara `'sold'` a ese enum sin
#  tocar el ejecutor, la unidad quedaba vendida, la reserva `confirmed`, la vidriera purgada — y
#  no habia venta. Misma clase que T18 (`cancelReservation()` derivaba el estado de cierre a mano):
#  un efecto que el dominio declara y la aplicacion ejecuta a medias.
#
#  Por eso `V1` no es decorativo: es el defecto original, invertido. Si algun dia vuelve a dar
#  cero consumidores, la slice se desarmo.
#
#  ── Lo que este archivo NO hace ──────────────────────────────────────────────────────────────
#  No re-prueba `transitionEffects` ni `checkTransition`: son puras, viven en `packages/domain` y
#  su suite es del owner del paquete. Tampoco cita `publish-listing.test.ts` como evidencia — es
#  del mismo writer que el codigo (CLAUDE.md §4). El certificado lo firma otra columna.
#
#  ── Lo que S7 deja explicitamente AFUERA, para que nadie lo lea como un hueco ────────────────
#  La VISTA de margen y el reporte de ventas: es la feature `margin`, con techo de plan
#  (`(billing)/_lib/plans.ts`: solo `trial`/`negocio`). S7 ESCRIBE el margen —lo deriva Postgres—
#  y no lo devuelve a nadie.
#
#  Sobre el rol, con una correccion del LEAD a su propia spec: la spec de S7 decia que el gate
#  `owner`/`seller` "no existe todavia". **Es falso, y lo desmintio la primera corrida de este
#  archivo.** La primitiva existe y esta en uso: `session.role` es `MembershipRole` y
#  `stock/nuevo/actions.ts:90` ya hace `const isOwner = session.role === 'owner'` para decidir si
#  acepta el costo del formulario. Lo que S11 debe es el modelo COMPLETO de permisos del panel, no
#  la primitiva. La conclusion de D6 no cambia —el camino de venta no devuelve costo ni margen a
#  NADIE, ni al dueño— y de hecho es mas fuerte que un chequeo de rol, porque no hay `if` que
#  alguien pueda invertir. Lo que cambia es el motivo: no es "porque no hay rol", es "porque no
#  hace falta preguntar".
# ══════════════════════════════════════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/_lib.sh
. scripts/_lib.sh

fail=0
APP='apps/web/app/(app)'
LIST='apps/web/app/(app)/_lib/listings'
PROBE='scripts/probes/s7-venta-manual.test.ts'

# ── V1 · el efecto tiene consumidor fuera del dominio ─────────────────────────────────────────
#
# El numero de abajo es el defecto original invertido. `packages/domain` se EXCLUYE a proposito:
# alli `createsSale` se declara y se testea a si mismo, y contar esas lineas dejaria el gate
# vacuamente verde el dia que la aplicacion vuelva a descartar el efecto.
sec 'V1 · `createsSale` lo consume alguien, y no es el dominio testeandose a si mismo'
# `apps/web/app` y `packages/*/src`, no `apps/web` a secas: la primera version de esta linea
# grepeaba el arbol entero y contaba OCHO consumidores, todos chunks de `.next/server` con el
# codigo compilado del PROPIO dominio adentro. O sea que el gate salia verde por un cache de
# build — verde por el motivo equivocado, que es la clase que este repo persigue. Lo agarro
# correrlo antes de que existiera la implementacion.
CONS=$(grep -rl 'createsSale' apps/web/app packages/*/src 2>/dev/null | grep -v node_modules | grep -vc '^packages/domain/' || true)
if [ "${CONS:-0}" -ge 1 ]; then
  ok "el efecto `createsSale` tiene $CONS consumidor(es) fuera de \`packages/domain\`"
else
  no 'cero consumidores de `createsSale` fuera de `packages/domain`: la aplicacion volvio a descartar el efecto que el dominio declara — es el defecto que abrio S7'
fi

# ── V2 · el margen lo deriva Postgres, y el insert no lo nombra ───────────────────────────────
#
# `sales.margin_usd` es `generatedAlwaysAs(price_usd - cost_usd)`. Nombrarla en un `insert` es un
# error de Postgres, si — pero el punto no es que rompa: es que si alguien la nombra, alguien esta
# tratando el margen como un dato de entrada, y el margen de entrada es el costo de entrada
# disfrazado (D2 de la spec). Se mira en `apps/web` entera, no solo en el camino de venta.
sec 'V2 · nadie escribe `margin_usd` — la deriva el motor'
if grep -rnE 'marginUsd\s*:' apps/web/app 2>/dev/null | grep -vE '\.test\.|\.spec\.' | grep -q .; then
  no 'alguien le asigna `marginUsd` en `apps/web`: el margen es una columna generada y asignarla es tratar el costo como dato de entrada'
  grep -rnE 'marginUsd\s*:' apps/web/app 2>/dev/null | grep -vE '\.test\.|\.spec\.' | sed 's/^/        /'
else
  ok 'ningun call site de `apps/web` le asigna `marginUsd`'
fi

# ── V3 · el costo del formulario se IGNORA — y por que esto no es un grep ─────────────────────
#
# La primera version de V3 grepeaba `cost[Uu]sd` cerca de un borde de request en todo `(app)` y
# fallaba. Fallaba sobre codigo LEGITIMO: `stock/nuevo/actions.ts:102` lee el costo del formulario
# —`costUsd: isOwner ? readString(formData, 'costUsd') : ''`— porque al ALTA de un equipo el dueño
# escribe lo que pago, que es la unica forma de que el costo exista. Un gate que prohibe eso
# prohibe cargar stock.
#
# O sea que la regla no es "el costo nunca cruza un borde": es "el costo nunca cruza el borde **de
# la venta**". Y esa distincion no la sabe un grep, porque depende de que hace el call site, no de
# que palabra usa. Es el mismo error de forma que la primera version de `guard-doc-tables.sh`
# —una premisa plausible que castigaba justo el caso bueno— y ADR-024 dice como termina: gana la
# medicion.
#
# Asi que las dos mitades de la regla 9 se MIDEN, en `V6`, sobre el comportamiento real:
#   (a) ENTRADA  → `costo_del_form_ignorado`: se manda un costo falso en el payload de la accion de
#                  venta y `sales.cost_usd` tiene que quedar en el de `listings`, no en el falso.
#   (b) SALIDA   → `costo_o_margen_en_el_retorno`: censado sobre el payload que la accion devuelve.
#
# Lo unico que queda como grep es `V2`, y a proposito: asignar una columna GENERADA no tiene ningun
# call site legitimo, asi que ahi no hay falso positivo posible.

# ── V4 · una unidad tiene a lo sumo UNA venta, afirmado en el motor ───────────────────────────
#
# Hoy lo garantizan dos cosas y las dos viven en TypeScript: `sold` es terminal
# (`checkTransition` → `terminal_state`) y el `eq(listings.status, from)` de la transaccion.
# Ninguna vive en la base. El indice unico es la segunda capa, por la misma doctrina que pone el
# filtro de tenant en la query ADEMAS de RLS. Se busca en las migraciones, no en el schema de
# Drizzle: lo que corre en Postgres es el `.sql`.
sec 'V4 · el motor afirma "una venta por unidad", no solo el codigo'
if grep -rliE 'unique.*index.*sales|create +unique +index[^;]*\bsales\b' packages/db/drizzle 2>/dev/null | grep -q .; then
  ok 'hay un indice unico sobre `sales` en una migracion versionada'
else
  no 'ninguna migracion crea un indice unico sobre `sales`: "una venta por unidad" vive solo en TypeScript y el segundo writer de `sales` no la va a re-derivar bien (D8)'
fi

# ── V5 · lo de siempre, sobre lo que S7 agrega ────────────────────────────────────────────────
sec 'V5 · el arbol esta verde'
chk 'pnpm -r typecheck' 'pnpm -r typecheck'
chk 'pnpm -r lint'      'pnpm -r lint'
chk 'pnpm -r test'      'pnpm -r test'

# ── V6 · el parte de la probe, campo por campo ────────────────────────────────────────────────
#
# Un `exit 0` de la probe no alcanza y este repo ya pago por creer que si: una probe que dejo de
# armar el fixture sale 0 con las aserciones corriendo sobre la nada. Por eso se exige una linea
# `MEDIDO`, y **su ausencia es FAIL, nunca PASS**.
#
# Los esperados de abajo son literales ESCRITOS ACA, en shell, en otro archivo que la probe
# (ADR-023). No se derivan leyendo el fuente: una comparacion del mismo origen pasa cuando los dos
# lados estan mal igual.
sec 'V6 · el parte de la venta existe y sus numeros son los esperados'
if [ ! -s "$PROBE" ]; then
  no "falta la probe del LEAD: $PROBE"
else
  POUT=$(mktemp)
  pnpm vitest run "$PROBE" >"$POUT" 2>&1 || true
  MED=$(grep -aoE 'MEDIDO s7 venta · .*' "$POUT" | head -1 || true)
  if [ -z "$MED" ]; then
    no 'no hay linea "MEDIDO s7 venta": la probe no dejo parte de lo que midio y el gate NO pasa por ausencia de medicion'
    inf 'Formato: MEDIDO s7 venta · ventas_por_unidad_vendida=<N> · costo_congelado_no_se_mueve=<N> · margen_derivado_por_postgres=<N> · ars_congelado_no_se_mueve=<N> · venta_sin_tc_no_se_bloquea=<N> · reserva_cerrada_como_confirmed=<N> · segunda_venta_de_la_misma_unidad=<N> · costo_del_form_ignorado=<N> · costo_o_margen_en_el_retorno=<N>'
    tail -20 "$POUT" | sed 's/^/        /'
  else
    inf "$MED"
    campo() { printf '%s' "$MED" | sed -nE "s/.*[[:space:]]$1=([^ ·]*).*/\1/p"; }

    # campo:esperado:que_significa_si_no_da — el tercer tramo es lo que hace util al gate: sin el,
    # un numero que cambia obliga a re-derivar de cero por que estaba ahi.
    for par in \
      'ventas_por_unidad_vendida:1:0 = el efecto `createsSale` se sigue descartando, que es el defecto con el que abrio S7 · 2 = doble escritura, o sea que el insert quedo afuera del guard `eq(status, from)` de la transaccion' \
      'costo_congelado_no_se_mueve:1:se vende, DESPUES se edita `listings.cost_usd`, y `sales.cost_usd` no cambia. Si cambiara, "congelado" es mentira: el margen historico se reescribe solo cada vez que el dueño corrige un costo de compra' \
      'margen_derivado_por_postgres:1:`sales.margin_usd == price_usd - cost_usd` calculado por el motor. 0 = alguien lo esta escribiendo desde la aplicacion, y escribir el margen es escribir el costo disfrazado' \
      'ars_congelado_no_se_mueve:1:misma prueba que el costo, moviendo el TC del tenant despues de la venta. El TC lo setea el dueño a mano y lo mueve seguido (CLAUDE.md §1): si el ARS archivado lo sigue, la venta de ayer cambia de precio hoy' \
      'venta_sin_tc_no_se_bloquea:1:tenant sin fila en `fx_settings` → la venta entra con `price_ars = NULL`. Es un camino DEFENSIVO, no rutinario: `create-tenant.ts` inserta `fx_settings` en el alta desde que cerro S3.1. Se mide igual porque la fila se puede borrar, y no vender por falta de TC es peor que no tener el dato' \
      'reserva_cerrada_como_confirmed:1:la reserva activa queda `confirmed`, no `cancelled`. El dominio ya lo decide (`closingStatusFor`: "no existe una venta que vencio"); esto mide que la aplicacion lo ejecute' \
      'segunda_venta_de_la_misma_unidad:0:filas nuevas tras DOS reintentos que rebotan en guardianes DISTINTOS, y la distincion es el punto: (C1) el doble submit lo para la maquina de estados —`same_state`, no `terminal_state`: `checkTransition` compara `from === to` antes que nada—, y (C2) el estado revertido a `available` la maquina de estados lo DEJA PASAR, asi que lo unico que queda es `sales_one_sale_per_listing`. La primera version de la probe solo hacia C1 y salia verde CON EL INDICE BORRADO (medido): afirmaba el unico sin tocarlo nunca. Si este campo da 1, mirar cual de los dos casos fallo antes de tocar nada' \
      'costo_del_form_ignorado:1:se manda un `costUsd` FALSO en el payload de la accion de venta y `sales.cost_usd` queda en el de `listings`. 0 = el costo se puede escribir desde el request, y como `margin_usd` se deriva de el, escribir el costo es escribir el margen (D2). Es la mitad de ENTRADA de la regla 9, medida y no grepeada: ver el bloque V3' \
      'costo_o_margen_en_el_retorno:0:campos sensibles censados sobre el payload REAL que devuelve la accion, no sobre su tipo. La regla 9 se sostiene hoy por esto y no por un gate de rol, porque el gate de rol es S11' \
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
  printf '\033[32mS7: ACEPTADA\033[0m\n'
else
  printf '\033[31mS7: RECHAZADA\033[0m\n'
fi
exit "$fail"
