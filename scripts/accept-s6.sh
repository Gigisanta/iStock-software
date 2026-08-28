#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════════════════════
#  ACEPTACION DE S6 — la re-ejecuta el LEAD, no el agente que escribio el codigo (CLAUDE.md regla 2)
#
#  Gate del board: "reserva 30-120min; cron libera; vidriera revalida".
#
#  ── Lo que este archivo NO hace, y por que ───────────────────────────────────────────────────
#  No vuelve a probar `expireReservation` ni `createReservation`: son puras, viven en
#  `packages/domain` y su suite es del owner del paquete. Duplicarlas aca serian dos copias que
#  derivan. Lo que S6 agrega y nadie mas mira es el CAMINO: que una reserva del panel llegue al
#  motor, que el cron llegue al handler, y que la vidriera se entere. Eso es lo que se audita.
#
#  ── El invariante mas caro de la slice, y por que necesita una probe y no un grep ────────────
#  `GET /api/cron/expire-reservations` es la UNICA puerta HTTP sin sesion que ESCRIBE en todo el
#  producto. Su propiedad no es "devuelve 401": es que **sin credencial valida no toca Postgres**,
#  o sea una afirmacion sobre el ORDEN de dos cosas. Un handler que barre primero y decide el
#  status despues devuelve los mismos 401 y es una escritura abierta. El orden no se lee con grep;
#  se mide espiando el barrido. Eso es `scripts/probes/s6-cron-fail-closed.test.ts`.
#
#  ── Y el que nadie habia mirado: el cron tiene que LLEGAR ────────────────────────────────────
#  De la doc de Vercel (`docs/research/vercel-cron-limits.md`, verificada 2026-08-28):
#    > "When a cron-triggered endpoint returns a 3xx redirect status code, the job completes
#    >  without further requests."
#  Un redirect NO es un fallo para Vercel: la corrida figura completa, no hay reintento, no hay log
#  nuestro —el handler nunca corrio— y no hay alerta. Las reservas dejan de vencer y el sintoma
#  aparece semanas despues del lado del cliente. `proxy.ts` rutea por HOST y el host que golpea el
#  cron esta UNVERIFIED, asi que ese camino se mide: `scripts/probes/s6-cron-reachability.test.ts`.
#
#  ── Por que las dos probes son del LEAD y no de `app-agent` ──────────────────────────────────
#  `apps/web/app/api/cron/expire-reservations/route.test.ts` existe, es bueno y prueba cosas
#  parecidas. No se cita como evidencia: es del mismo writer que el handler, y `CLAUDE.md` §4 dice
#  que la auditoria de referencia no puede serlo. Sirve como red de regresion de `app-agent`; el
#  certificado lo firma otra columna.
# ══════════════════════════════════════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/_lib.sh
. scripts/_lib.sh

fail=0
RES='apps/web/app/(app)/_lib/reservations'
PANEL='apps/web/app/(app)/app/(panel)/stock'
RUTA='apps/web/app/api/cron/expire-reservations'
SPEC='s6-la-reserva-se-ve-en-la-vidriera-y-el-cron-la-libera.spec.ts'

# Los archivos que S6 AGREGA O TOCA en el panel, uno por uno y no el directorio.
#
# `$PANEL` entero seria el gate equivocado y la primera corrida lo demostro: `stock/nuevo/` es de S2
# y ahi el IMEI y el `costUsd` son LEGITIMOS —van en el panel del dueno, `CLAUDE.md` §1— asi que V3
# y V6 fallaban contra codigo correcto de otra slice. Un gate que falla por el motivo equivocado es
# peor que uno que no existe: ensena a ignorarlo. La aceptacion de una slice mira lo que la slice
# hizo; lo que S2 hizo lo mira `accept-s2.sh`.
S6_UI=(
  "$PANEL/reservation-actions.ts"
  "$PANEL/reservation-action-state.ts"
  "$PANEL/_ui/reserve-form.tsx"
  "$PANEL/_ui/cancel-reservation-button.tsx"
  "$PANEL/_ui/unit-row.tsx"
)

# ── V1 · el schedule existe y apunta a un handler que existe ─────────────────────────────────
sec 'V1 · vercel.json agenda un handler real, y el cron llega hasta el'
if pnpm --filter @istock/web exec vitest run --root ../.. \
     scripts/probes/s6-cron-reachability.test.ts >/tmp/s6-reach.txt 2>&1; then
  ok "la probe de alcance pasa: $(grep -oE 'Tests +[0-9]+ passed' /tmp/s6-reach.txt | tail -1)"
else
  no 'la probe de alcance FALLA. O el path agendado no tiene handler, o el proxy lo redirige/reescribe'
  sed 's/^/        /' /tmp/s6-reach.txt | grep -E '×|FAIL|Error' | head -8
fi

# ── V2 · el fail-closed, medido por invocacion ───────────────────────────────────────────────
sec 'V2 · sin credencial valida el cron no toca Postgres (orden, no status code)'
if pnpm --filter @istock/web exec vitest run --root ../.. \
     scripts/probes/s6-cron-fail-closed.test.ts >/tmp/s6-closed.txt 2>&1; then
  ok "la probe de fail-closed pasa: $(grep -oE 'Tests +[0-9]+ passed' /tmp/s6-closed.txt | tail -1)"
else
  no 'la probe de fail-closed FALLA. Es el invariante mas caro de la slice'
  sed 's/^/        /' /tmp/s6-closed.txt | grep -E '×|FAIL|Error' | head -8
fi

# ── V3 · fuera de rango se RECHAZA, no se clampea ────────────────────────────────────────────
#
# Clampear es la respuesta comoda y es la equivocada: un pedido de 5 minutos convertido en 30 le
# devuelve al vendedor una reserva que NO pidio, y el cliente del otro lado del WhatsApp escucha un
# numero que nadie eligio. El rango es del motor (`check reservations_minutes_range`); la UI tiene
# que rebotar antes, no acomodar.
#
# Acotado a donde se DECIDE la duracion —`schema.ts` y la Server Action—, no al camino entero: en
# `presentation.ts` hay un `Math.max(0, ...)` que es el piso de un contador de tiempo restante, o sea
# codigo correcto. Dos corridas, dos regex de mas: el primer intento grepeaba `stock/` entero y
# fallaba contra el formulario de alta de S2. Un gate se acota hasta que lo unico que puede encender
# es el defecto que nombra.
sec 'V3 · una duracion fuera de 30-120 se rechaza, no se acomoda'
none 'sin clamp de la duracion pedida (Math.min/Math.max/clamp donde se decide los minutos)' \
  '(Math\.(min|max)|clamp)\s*\(' "$RES/schema.ts" "$PANEL/reservation-actions.ts"
if grep -qE 'RESERVATION_(MIN|MAX)_MINUTES' "$RES/schema.ts" 2>/dev/null; then
  ok 'el rango sale de las constantes de packages/domain, no de un numero magico que puede derivar'
else
  no "$RES/schema.ts no usa RESERVATION_MIN/MAX_MINUTES: el rango esta duplicado y va a derivar del check de la DB"
fi

# ── V4 · el entitlement se verifica en la ACCION, no en el render ────────────────────────────
#
# Esconder el boton no es autorizar. Una Server Action es un endpoint: se invoca sin pasar por el
# componente que la ofrece. Si el chequeo vive solo en el `page.tsx`, un tenant de plan Base reserva
# igual con un fetch. Es el mismo error de forma que delegar autorizacion al proxy.
sec 'V4 · el entitlement de reservas se chequea adentro de la Server Action'
if grep -qE '(entitlement|FEATURE_RESERVATIONS|canReserve|tieneReservas)' "$PANEL/reservation-actions.ts" 2>/dev/null; then
  ok 'reservation-actions.ts verifica el entitlement adentro de la accion'
else
  no "reservation-actions.ts no menciona el entitlement. Si el chequeo vive solo en el render, la accion es invocable igual"
fi

# ── V5 · la invalidacion es de la UNIDAD, no del catalogo ────────────────────────────────────
#
# Expirar una reserva cambia UNA unidad. Purgar los dos tags del tenant reconstruye cada ficha de la
# vidriera por cada expiracion: con el cron cada 5 minutos eso es el 95%-sin-Postgres de `CLAUDE.md`
# §3 tirado a la basura, y es exactamente el defecto que S3.2 cerro.
sec 'V5 · expirar una reserva invalida la unidad, no la vidriera entera'
if grep -rqE 'invalidateStorefrontUnit' "$RES" "${S6_UI[@]}" 2>/dev/null; then
  ok 'la expiracion invalida por unidad (invalidateStorefrontUnit)'
else
  no 'nada en S6 llama a invalidateStorefrontUnit: o no revalida, o revalida de mas'
fi
none 'sin purga del catalogo entero desde el camino de reservas' \
  'invalidateStorefront\(' "$RES" "${S6_UI[@]}"

# ── V6 · lo de siempre, sobre lo que S6 agrega ───────────────────────────────────────────────
sec 'V6 · nada de lo que S6 agrega filtra costo, margen ni IMEI'
none 'sin costo ni margen en el camino de reservas ni en su UI' \
  '\b(cost_usd|costUsd|margin|margen|internal_notes|internalNotes)\b' "$RES" "${S6_UI[@]}" "$RUTA"
none 'sin IMEI en el camino de reservas ni en su UI' '\bimei\b' "$RES" "${S6_UI[@]}" "$RUTA"
none 'sin console.log en el camino de reservas' '\bconsole\.log\b' "$RES" "${S6_UI[@]}" "$RUTA"

# ── V7 · la unica query cross-tenant del repo, y sus escrituras ──────────────────────────────
#
# El barrido corre sin sesion y mira reservas de TODOS los tenants: es la unica exencion legitima de
# W015 en el producto. La exencion es del SELECT. Cada escritura que sale de ese barrido tiene que
# atarse al tenant de SU fila, o una fila de A produce una escritura sobre B — el peor lugar posible
# para que este mal.
sec 'V7 · el barrido cruza tenants para LEER, y escribe atado al tenant de cada fila'
MARCAS=$(grep -rc 'web-lint:sin-tenant' "$RES" 2>/dev/null | awk -F: '{s+=$2} END {print s+0}')
if [ "$MARCAS" = "1" ]; then
  ok 'hay exactamente UNA exencion de tenant en el camino de reservas (el SELECT del barrido)'
else
  no "hay $MARCAS exenciones web-lint:sin-tenant en $RES. Se espera exactamente 1: el SELECT del barrido"
fi
if grep -qE 'eq\([A-Za-z]+\.tenantId,' "$RES/expire-reservations.ts" 2>/dev/null; then
  ok 'las escrituras del barrido filtran por el tenantId de su fila'
else
  no 'el barrido no ata sus escrituras por tenantId: una fila de A puede escribir sobre B'
fi

# ── V8 · la medicion e2e la emite `qa-agent`, y su ausencia es FAIL ──────────────────────────
#
# Misma convencion que S3/S4: hace falta un browser real y un contador de filas contra Postgres, o
# sea el arnes de e2e, que es de otra columna. Se corre el spec y se leen los campos DEL LOG DE LA
# CORRIDA; ausencia de medicion es FAIL, nunca PASS.
#
# **Esta verificacion grepeaba el FUENTE hasta el 2026-08-28, y por eso no podia fallar**: la cadena
# `MEDIDO s6 reserva` aparece en el docblock del spec y en el del helper que la arma, asi que el
# gate daba PASS con dos comentarios y cero corridas. Lo marco `qa-agent` en su propio reporte, con
# el gate ya en verde y a su favor — o sea que reporto lo que le habria convenido callar.
# `accept-s3.sh` y `accept-s4.sh` siempre leyeron el log de la corrida; el desalineado era este.
# Es la tercera vez en este repo que una regla no puede fallar (antes: `none()` filtrando el
# comentario que ERA el hallazgo, y la regla del `TODO: despues el RLS`). Ya no se acepta presencia
# de una cadena como evidencia de una medicion.
#
# La linea que se espera, textual:
#
#   MEDIDO s6 reserva · unidad=<id> · estado_tras_reservar=<estado> · vidriera_dice=<texto> · tras_expirar=<estado> · publicar_estando_reservada=<resultado>
#
# El ultimo campo se agrego DESPUES del adversary de S6, y por un motivo concreto: `transitionUnit`
# evaluaba toda transicion con `activeReservation: null` hardcodeado, asi que "Publicar" sobre una
# unidad RESERVADA devolvia ok, republicaba el equipo en la vidriera como Disponible con la sena
# puesta, y lo dejaba irreservable hasta que el cron lo venciera. El dominio aprobaba porque le
# mentian. Ninguna de las siete verificaciones de arriba lo veia, y ningun grep lo iba a ver: la
# afirmacion no es sobre que texto tiene un archivo, es sobre que hace el sistema cuando el dueno
# toca un boton que la UI todavia le ofrece. Un `extras` que se vuelve a olvidar reaparece aca.
sec 'V8 · medicion e2e del ciclo reserva -> vidriera -> expiracion (la emite qa-agent)'
EOUT=$(mktemp)
if node -e "process.exit(require('./e2e/package.json').scripts?.e2e?0:1)" 2>/dev/null; then
  # Sin --reporter: en la CLI REEMPLAZA los reporters del config y apaga el censo de qa-agent.
  # `E2E_ALLOW_PARTIAL=1` porque aca se corre UN spec y el reporter de censo de `qa-agent` —que
  # existe para que nadie shippee un spec que nunca corre— falla, con razon, ante un filtro de
  # archivos. La escotilla la documenta el propio reporter para este caso exacto. El censo completo
  # no se pierde: lo corre el job de e2e de CI y lo corre `accept-s3.sh`, que si ejecuta la suite
  # entera. Lo que este gate necesita es la medicion de S6, no una segunda pasada de 80 tests.
  if E2E_ALLOW_PARTIAL=1 pnpm --filter @istock/e2e e2e "$SPEC" >"$EOUT" 2>&1; then
    ok 'el spec de S6 termino en verde'
  else
    no 'el spec e2e de S6 fallo'
    grep -aE '^[[:space:]]+[0-9]+\) .*spec\.ts' "$EOUT" | cut -c1-200 | head -6 | sed 's/^/        /'
    KEEP="${TMPDIR:-/tmp}/accept-s6-e2e-$$.log"; cp "$EOUT" "$KEEP" 2>/dev/null && inf "salida completa: $KEEP"
  fi
else
  no "e2e/package.json no expone el script 'e2e'"
fi

MED=$(grep -aoE 'MEDIDO s6 reserva · .*' "$EOUT" | head -1 || true)
if [ -z "$MED" ]; then
  no 'no existe la medicion e2e de S6. S6 no se cierra con tests unitarios: el gate del board dice "cron libera; vidriera revalida", y eso es un ciclo, no una funcion'
  inf "Formato: MEDIDO s6 reserva · unidad=<id> · estado_tras_reservar=<estado> · vidriera_dice=<texto> · tras_expirar=<estado> · publicar_estando_reservada=<resultado>"
else
  ok 'la medicion e2e de S6 salio de una corrida'
  inf "$MED"

  campo() { printf '%s' "$MED" | sed -nE "s/.*$1=([^·]*).*/\1/p" | sed 's/[[:space:]]*$//'; }
  TRAS_RESERVAR=$(campo 'estado_tras_reservar')
  TRAS_EXPIRAR=$(campo 'tras_expirar')
  VIDRIERA=$(campo 'vidriera_dice')
  PUBLICAR=$(campo 'publicar_estando_reservada')

  if [ -z "$TRAS_RESERVAR$TRAS_EXPIRAR$VIDRIERA$PUBLICAR" ]; then
    no 'la linea MEDIDO s6 reserva cambio de formato y no puedo leer los campos — arreglar el gate, no la linea'
  fi

  [ "$TRAS_RESERVAR" = 'reserved' ] \
    && ok "tras reservar, Postgres dice $TRAS_RESERVAR" \
    || no "tras reservar, Postgres dice '$TRAS_RESERVAR' y no 'reserved'"

  [ "$TRAS_EXPIRAR" = 'available' ] \
    && ok "tras el barrido del cron, la unidad volvio a $TRAS_EXPIRAR" \
    || no "tras el barrido, la unidad quedo en '$TRAS_EXPIRAR' y no en 'available': el cron no libera"

  case "$VIDRIERA" in
    *[Dd]isponible*|'') no "la vidriera dice '$VIDRIERA' con la unidad reservada. Un equipo con sena puesta que se publica como disponible es la mentira del estado de Instagram, servida por nosotros" ;;
    *) ok "el visitante anonimo ve $VIDRIERA en la ficha" ;;
  esac

  # El campo que este gate agrego DESPUES del adversary de S6, y el unico que mira el bug que casi
  # se commitea: `transitionUnit()` evaluaba toda transicion con `activeReservation: null`
  # hardcodeado, asi que "Publicar" sobre una unidad RESERVADA devolvia ok, la republicaba en la
  # vidriera como Disponible con la sena puesta, y la dejaba irreservable hasta que el cron la
  # venciera. Se exigen las DOS mitades: que rechace, y que el rechazo no haya escrito igual.
  # Un rechazo que dejo basura escrita no es un rechazo.
  case "$PUBLICAR" in
    rechazado*) ok 'publicar una unidad reservada se rechaza' ;;
    '')         no 'la linea no trae `publicar_estando_reservada`: nadie probo el caso del adversary' ;;
    *)          no "publicar una unidad reservada dio '$PUBLICAR'. Es el bloqueante de S6 de vuelta" ;;
  esac
  case "$PUBLICAR" in
    *listing=reserved*) ok 'tras el rechazo la unidad sigue reservada' ;;
    *) no "tras el rechazo la unidad no quedo en reserved: $PUBLICAR" ;;
  esac
  case "$PUBLICAR" in
    *reserva=active*) ok 'tras el rechazo la reserva sigue viva' ;;
    *) no "tras el rechazo la reserva no quedo active: un rechazo que igual escribio no es un rechazo ($PUBLICAR)" ;;
  esac
fi

# ══════════════════════════════════════════════════════════════════════════════════════════════
printf '\n'
if [ "$fail" = "0" ]; then
  printf '\033[32mS6: ACEPTADA\033[0m\n'
else
  printf '\033[31mS6: RECHAZADA\033[0m\n'
fi
exit "$fail"
