#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════════════════════
#  ACEPTACION DE S8 — el canje. La re-ejecuta el LEAD, no el agente que escribio el codigo.
#  gate-owner: LEAD (CLAUDE.md §4 — el gate no puede ser del writer que audita)
#
#  Gate del board: "un visitante manda su equipo desde la vidriera, el dueño lo ve en el inbox,
#  lo acepta, y nace una unidad en `draft` con el costo puesto".
#
#  ── Lo que hace distinta a esta slice, y por que el gate mira lo que mira ────────────────────
#  S8 abre la SEGUNDA escritura sin autenticar del producto. La primera (el beacon de S4) escribe
#  tres columnas de ancho fijo y sin PII. Esta escribe el NOMBRE y el WHATSAPP de una persona que
#  no se logueo nunca. O sea que la tabla tiene dos mitades que se contradicen si una se afloja:
#
#     `anon` ESCRIBE nueve columnas y solo esas nueve  ←  lo decide el GRANT de la 0008
#     `anon` NO LEE ni una                             ←  lo decide la AUSENCIA de un GRANT SELECT
#
#  La segunda mitad no tiene policy que mirar: se sostiene por algo que NO ESTA, y una ausencia no
#  la ve ningun lint de policies. Por eso V2 la censa a mano y por eso `returning_desde_anon` es un
#  campo del parte: `insert ... returning` es la forma exacta en que la PII del visitante volveria
#  por la misma puerta por la que entro.
#
#  ── El precedente que el LEAD tuvo que relajar para que esto exista, y su precio ─────────────
#  La regla `0020` de `rls-lint` prohibia TODA columna SENSITIVE en un GRANT a `anon`. Un lead de
#  canje no se puede escribir sin `customer_name` y `customer_wa_phone`, que son SENSITIVE. La
#  relajacion es por `table.column` y **solo para escritura**; el dia que se escribio, el LEAD le
#  puso a `rls-lint` el arnes de polaridad que no tenia (`scripts/rls-lint.test.sh`, 12 casos),
#  porque era el unico de los cinco lints que nadie habia visto encender — y es el que sostiene
#  "sin RLS no hay merge".
#
#  ── Lo que este gate NO afirma, escrito para que nadie lo lea como cobertura ─────────────────
#  1. Que la regla del WAF de `/api/tradein` este PUBLICADA en Vercel. No lo puede saber: el apply
#     es manual (`$apply` de `config/firewall-rules.json`) y el gate de nivel 2
#     (`vercel firewall diff --json`) no existe. Riesgo residual conocido de T1.
#  2. Que ninguna policy de `tradein_leads` mire `membership_role`. Hoy NINGUNA lo hace: el corte
#     entre lo que ve un `seller` y lo que ve un `owner` lo sostiene el SERVIDOR
#     (`_lib/tradein/queries.ts`, dos queries), no la base. Eso es P5, sigue abierto, y por eso
#     `costo_en_el_payload_del_seller` se mide sobre el OBJETO que devuelve la lectura y no sobre
#     su tipo: el tipo lo cumple el compilador, el objeto lo cumple el codigo que corre.
#  3. e2e. Requiere `next build`. `TEST_MATRIX.md` E5 sigue en rojo y esta declarado alla.
#  4. Que la PII del visitante no llegue a `packages/ai` ni a un log. Es la primera PII de un
#     tercero del producto y NO tiene test de fuga. Lo levanto `qa-agent`; queda en el board.
# ══════════════════════════════════════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/_lib.sh
. scripts/_lib.sh

fail=0
MIG='packages/db/drizzle/0008_storefront_tradein_lead_insert.sql'
SF='apps/web/app/(storefront)'
PROBE='scripts/probes/s8-canje.test.ts'

# ── V1 · el GRANT es EXACTAMENTE el que se decidio ────────────────────────────────────────────
#
# Igualdad, no inclusion, y esa distincion es el gate entero: un `grep -q offer_usd` da verde con
# `offer_usd` adentro del GRANT si alguien lo agrego al final. Se lee del `.sql` de la migracion y
# no de la base, por la misma razon que S7 lee las migraciones: lo que corre en produccion es el
# archivo commiteado, y una base local puede tener una migracion editada despues de aplicada — la
# trampa del `created_at` que CLAUDE.md §3 documenta.
sec 'V1 · el GRANT de `anon` sobre `tradein_leads` son nueve columnas, ni una mas'
ESPERADAS='battery_pct color customer_name customer_wa_phone declared_condition model_text notes storage_gb tenant_id'
if [ ! -s "$MIG" ]; then
  no "falta la migracion del canje: $MIG"
else
  VISTAS=$(grep -oE 'GRANT INSERT \([^)]*\) ON TABLE "tradein_leads" TO anon' "$MIG" \
    | head -1 | sed -E 's/.*\(([^)]*)\).*/\1/' | tr -d '"' | tr ',' '\n' | tr -d ' ' \
    | grep -v '^$' | sort | tr '\n' ' ' | sed 's/ $//')
  if [ "$VISTAS" = "$ESPERADAS" ]; then
    ok 'las nueve columnas del GRANT son las decididas'
  else
    no "el GRANT a \`anon\` no es el decidido. visto: [$VISTAS]"
    inf "esperado:  [$ESPERADAS]"
    inf 'las que NO pueden estar, una por una y con su motivo:'
    inf '  offer_usd          — es el COSTO de la unidad que va a nacer. Lo escribe el dueño al aceptar'
    inf '  internal_notes     — nota del mostrador, nunca del visitante'
    inf '  status             — el estado del lead lo maneja el panel; escribirlo desde afuera es saltear el inbox'
    inf '  created_listing_id — lo escribe `acceptToStock`; desde afuera ataria un lead a una unidad ajena'
    inf '  handled_by         — quien lo atendio. Un anonimo no puede firmar por una persona'
    inf '  id, created_at, updated_at — defaults del motor. Escribirlos permite pisar una fila existente'
  fi
fi

# ── V2 · `anon` no lee lo que escribe, y esto se sostiene por una AUSENCIA ────────────────────
#
# No hay policy que mirar: si nadie otorgo `SELECT`, no hay nada que auditar salvo que siga sin
# haberlo. Se censa el arbol ENTERO de migraciones, no la 0008: el agujero que este bloque
# persigue es el de la migracion 0012 que "necesita que la vidriera muestre los canjes recibidos".
sec 'V2 · ni un GRANT SELECT ni una policy de SELECT `TO anon` sobre `tradein_leads`'
LEC=$(grep -rniE 'grant[^;]*select[^;]*on[^;]*tradein_leads[^;]*to[^;]*anon' packages/db/drizzle 2>/dev/null || true)
if [ -n "$LEC" ]; then
  no 'alguien le otorgo SELECT a `anon` sobre `tradein_leads`: la PII del visitante vuelve por la puerta por la que entro'
  printf '%s\n' "$LEC" | sed 's/^/        /'
else
  ok 'cero GRANT SELECT a `anon` sobre la tabla'
fi
POL=$(grep -rniE 'policy[^;]*ON "?tradein_leads"?[^;]*FOR SELECT[^;]*TO "?anon"?' packages/db/drizzle 2>/dev/null || true)
if [ -n "$POL" ]; then
  no 'hay una policy de SELECT `TO anon` sobre `tradein_leads`'
  printf '%s\n' "$POL" | sed 's/^/        /'
else
  ok 'cero policies de SELECT `TO anon` sobre la tabla'
fi

# ── V3 · el costo no existe en el borde publico ───────────────────────────────────────────────
#
# Este SI es un grep y no una medicion, y a diferencia de V3 de `accept-s7.sh` acá no hay falso
# positivo posible: en la vidriera **no hay ningun call site legitimo** que nombre la oferta. El
# costo lo escribe el dueño desde el panel al aceptar. Que la palabra aparezca en `(storefront)` ya
# es el defecto, sin importar que haga la linea.
sec 'V3 · `offer_usd` / `offerUsd` no aparecen en el borde publico'
HITS=$(grep -rnE 'offerUsd|offer_usd' "$SF" 2>/dev/null | grep -vE '\.test\.|\.spec\.' || true)
if [ -n "$HITS" ]; then
  no 'la oferta se nombra en la vidriera: el costo de la unidad no puede viajar en un request anonimo'
  printf '%s\n' "$HITS" | sed 's/^/        /'
else
  ok 'la vidriera no nombra la oferta en ningun archivo de produccion'
fi

# ── V4 · lo de siempre ────────────────────────────────────────────────────────────────────────
sec 'V4 · el arbol esta verde'
chk 'pnpm -r typecheck' 'pnpm -r typecheck'
chk 'pnpm -r lint'      'pnpm -r lint'
chk 'pnpm -r test'      'pnpm -r test'

# ── V5 · el parte de la probe, campo por campo ────────────────────────────────────────────────
#
# Un `exit 0` no alcanza: una probe que dejo de armar el fixture sale 0 con las aserciones
# corriendo sobre la nada. La ausencia de la linea `MEDIDO` es FAIL, nunca PASS.
#
# Los esperados son literales escritos ACA, en shell, en otro archivo y en otro lenguaje que la
# probe (ADR-023). Derivarlos leyendo el fuente haria que los dos lados se equivoquen juntos.
sec 'V5 · el parte del canje existe y sus numeros son los esperados'
if [ ! -s "$PROBE" ]; then
  no "falta la probe del LEAD: $PROBE"
else
  POUT=$(mktemp)
  pnpm vitest run "$PROBE" >"$POUT" 2>&1 || true
  MED=$(grep -aoE 'MEDIDO s8 canje · .*' "$POUT" | head -1 || true)
  if [ -z "$MED" ]; then
    no 'no hay linea "MEDIDO s8 canje": la probe no dejo parte de lo que midio y el gate NO pasa por ausencia de medicion'
    inf 'Formato: MEDIDO s8 canje · lead_anonimo_entra=<N> · lead_sin_claim_no_entra=<N> · lead_a_tenant_ajeno=<N> · offer_usd_desde_anon=<N> · returning_desde_anon=<N> · checks_del_motor=<N> · accept_crea_unidad_en_draft=<N> · accept_dos_veces_una_unidad=<N> · costo_en_el_payload_del_seller=<N> · canario_rol_anon=<N> (<N> transacciones)'
    tail -20 "$POUT" | sed 's/^/        /'
  else
    inf "$MED"
    campo() { printf '%s' "$MED" | sed -nE "s/.*[[:space:]]$1=([^ ·(]*).*/\1/p"; }

    # campo:esperado:que_significa_si_no_da
    for par in \
      'canario_rol_anon:1:las transacciones de la probe NO corrieron como `anon`. `set local role` fuera de un bloque de transaccion es un no-op que solo emite un WARNING, y entonces todo corre como superusuario, que bypassea RLS y GRANT a la vez: los demas campos de esta linea no midieron nada. Es un error que el LEAD cometio midiendo a mano en esta misma slice, y por eso el canario existe. MIRAR ESTE CAMPO ANTES QUE NINGUNO' \
      'lead_anonimo_entra:1:con el claim del slug, el insert de nueve columnas NO entro. 0 = la vidriera no puede recibir un canje, o sea que la slice no existe' \
      'lead_sin_claim_no_entra:0:sin claim del host entro una fila igual. El claim es el UNICO origen del tenant en la vidriera: si el insert entra sin el, el `tenant_id` lo esta eligiendo el body del request' \
      'lead_a_tenant_ajeno:0:con claim de A y `tenant_id` de B, la fila entro. Es el leak cruzado directo: cualquiera le planta canjes falsos al negocio de al lado' \
      'offer_usd_desde_anon:0:`anon` nombro `offer_usd` (o `internal_notes`) en el insert y NO lo paro la capa GRANT. Ojo con la capa: si el rechazo fue de POLICY, `anon` TIENE el privilegio de escribir el costo y lo unico que lo frena es una condicion de fila — el numero seria el mismo y el invariante no' \
      'returning_desde_anon:0:`insert ... returning` devolvio filas: `anon` puede LEER esta tabla. Es la PII del visitante volviendo por la puerta por la que entro, y no hay policy que aflojar porque el que falta es el GRANT' \
      'checks_del_motor:1:alguno de los siete CHECK no midio en el borde: el valor justo adentro no entro, o el justo afuera no dio 23514. Sin ellos, un anonimo escribe texto libre sin techo en una tabla que el dueño lee' \
      'accept_crea_unidad_en_draft:1:aceptar no produjo una unidad `draft` de `kind=unit` con `cost_usd` copiado de la oferta y el lead atado a ella. Es el gate del board, literal' \
      'accept_dos_veces_una_unidad:1:aceptar dos veces creo dos unidades (o ninguna). El guard es el `ne(status, ACCEPTED)` del update que abre la transaccion; si se cae, un doble click duplica stock' \
      'costo_en_el_payload_del_seller:0:el objeto que recibe un `seller` trae el costo. La regla 9 sobre esta tabla la sostiene HOY el servidor y no la base (P5), asi que este numero es la unica cosa que la sostiene. Se mide sobre el OBJETO y se exige AUSENCIA de la clave, no `null`: un `null` serializado sigue diciendo que el campo existe' \
    ; do
      N=${par%%:*}; R=${par#*:}; E=${R%%:*}; POR=${R#*:}
      V=$(campo "$N")
      case "$V" in
        ''|*[!0-9-]*) no "el parte no trae \`$N\` legible ('$V'): cambio el formato de la linea — arreglar el gate, no la linea" ;;
        "$E")         ok "$N=$V" ;;
        -1)           no "$N=-1: ese caso NO corrio. Un caso que no midio no es un cero — $POR" ;;
        *)            no "$N=$V y se esperaba $E — $POR" ;;
      esac
    done
  fi
  rm -f "$POUT"
fi

# ══════════════════════════════════════════════════════════════════════════════════════════════
printf '\n'
if [ "$fail" = "0" ]; then
  printf '\033[32mS8: ACEPTADA\033[0m\n'
else
  printf '\033[31mS8: RECHAZADA\033[0m\n'
fi
exit "$fail"
