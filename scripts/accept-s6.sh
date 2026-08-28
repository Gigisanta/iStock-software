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
# La segunda spec la agrego el LEAD el 2026-08-28. Estaba en disco, medida y con su modulo de
# veredicto testeado, y NINGUN gate la citaba: era evidencia escrita que no sostenia nada.
SPEC_RADIO='s6-senar-un-equipo-no-purga-la-vidriera-entera.spec.ts'

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
sec 'V5 · el camino de reservas no purga el catalogo entero (estatico; el radio se mide en V9)'
#
# ── ACA HABIA UN GATE VACUAMENTE VERDE. Lo saco el LEAD el 2026-08-28. ───────────────────────
# La version anterior de esta seccion decia llamarse "expirar una reserva invalida la unidad, no la
# vidriera entera" y lo que ejecutaba era `grep -rqE 'invalidateStorefrontUnit'`. O sea: se llamaba
# como un verbo y verificaba un identificador. Durante TODO el defecto de S6.2 la funcion se llamo
# `invalidateStorefrontUnit` y purgaba la vidriera entera; el grep la encontro, dijo PASS, y el
# gate acompano el defecto de punta a punta sin pestanear. Lo encontro `docs-keeper` y lo verifique
# yo antes de tocar esto.
# Un nombre no es una conducta. Que exista la palabra `unidad` en el codigo no dice nada sobre
# cuantas paginas mueren cuando se sena un equipo: eso se cuenta, y contarlo es V9.
# Lo que SI se puede afirmar leyendo el fuente es la prohibicion complementaria -que nadie llame a
# la purga del catalogo desde el camino de reservas-, porque ahi la ausencia del texto si es la
# propiedad. Eso es lo unico que queda en V5, y ahora la seccion se llama como lo que hace.
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
# Chequeo de entorno, no de producto: si otro proceso tiene el puerto, este gate no puede levantar
# su propio server y por lo tanto NO PUEDE MEDIR. Se corta aca, con la causa nombrada, en vez de
# gastar un `next build` para terminar titulando "la suite no corrio entera" -que acusa a `qa-agent`
# por una colision de corridas. Ver `e2e/playwright.config.ts`: `reuseExistingServer: false` esta
# puesto a proposito para que un puerto ocupado rompa fuerte en lugar de prestar un server sin el
# espia de Postgres, que es como una medicion ausente se disfraza de exito.
if puerto_ocupado "${E2E_PORT:-3100}"; then
  no "el puerto ${E2E_PORT:-3100} lo tiene otro proceso: este gate no puede medir. NO es un rojo del producto: es otra corrida (otro accept-*, una suite e2e a mano) pisandose con esta. Esperala y volve a correr, o E2E_PORT=<otro>."
  exit "$fail"
fi
sec 'V8 · medicion e2e del ciclo reserva -> vidriera -> expiracion (la emite qa-agent)'
EOUT=$(mktemp)
if node -e "process.exit(require('./e2e/package.json').scripts?.e2e?0:1)" 2>/dev/null; then
  # Sin --reporter: en la CLI REEMPLAZA los reporters del config y apaga el censo de qa-agent.
  # `E2E_ALLOW_PARTIAL=1` porque aca se corre UN spec y el reporter de censo de `qa-agent` —que
  # existe para que nadie shippee un spec que nunca corre— falla, con razon, ante un filtro de
  # archivos. La escotilla la documenta el propio reporter para este caso exacto. El censo completo
  # no se pierde: lo corre el job de e2e de CI y lo corre `accept-s3.sh`, que si ejecuta la suite
  # entera. Lo que este gate necesita es la medicion de S6, no una segunda pasada de 80 tests.
  if E2E_ALLOW_PARTIAL=1 pnpm --filter @istock/e2e e2e "$SPEC" "$SPEC_RADIO" >"$EOUT" 2>&1; then
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

# ── V9 · el radio de la invalidacion, CONTADO ─────────────────────────────────────────────────
#
# Esta es la asercion que V5 decia hacer y no hacia. La diferencia entre las dos no es de rigor:
# es de tipo. V5 preguntaba que dice el fuente; esta pregunta cuantas paginas de la vidriera
# dejaron de servirse del cache cuando se seno UN equipo. Es la unica forma de que el "95% de los
# hits no tocan Postgres" de `CLAUDE.md` §3 sea una afirmacion y no una intencion.
#
# La medicion la emite `e2e/s6-senar-un-equipo-no-purga-la-vidriera-entera.spec.ts` y el veredicto
# vive en `e2e/_lib/s6-measure.ts`, con su propia bateria en
# `tests/el-veredicto-del-radio-rechaza-la-purga-que-arrastra-fichas-ajenas.test.ts` (de `qa-agent`,
# o sea de otra columna: por eso este gate puede citarla sin que el writer firme su certificado).
# Ese modulo ya rechaza el fixture de una sola ficha hermana, la medicion sin sentencias de Postgres
# y el "arreglo" que baja el radio a cero dejando de invalidar la grilla. Aca no se reimplementa
# nada de eso: se exige que la linea EXISTA -ausencia de medicion es FAIL, nunca PASS- y se compara
# el numero contra el esperado que la propia medicion declara.
sec 'V9 · senar un equipo no purga la vidriera entera (radio medido, no grepeado)'
RAD=$(grep -aoE 'MEDIDO s6 radio · .*' "$EOUT" | head -1 || true)
if [ -z "$RAD" ]; then
  no 'no hay linea "MEDIDO s6 radio": el radio de la invalidacion quedo sin medir y el gate NO pasa por ausencia de medicion'
  inf 'Formato: MEDIDO s6 radio · unidad=<id> · publicadas=<N> · paginas=<N> · rerender=<N> · esperado=<N> · purgadas=[..] · sobrevivieron=[..] · grilla_dice=".." · ficha_dice=".." · frio=<N>'
else
  inf "$RAD"
  campo_radio() { printf '%s' "$RAD" | sed -nE "s/.*[[:space:]]$1=([^·]*).*/\1/p" | sed 's/[[:space:]]*$//'; }
  RERENDER=$(campo_radio 'rerender')
  ESPERADO=$(campo_radio 'esperado')
  PAGINAS=$(campo_radio 'paginas')
  FRIO=$(campo_radio 'frio')
  SOBREVIVIERON=$(campo_radio 'sobrevivieron')

  if [ -z "$RERENDER" ] || [ -z "$ESPERADO" ] || [ -z "$PAGINAS" ]; then
    no 'la linea MEDIDO s6 radio cambio de formato y no puedo leer los numeros — arreglar el gate, no la linea'
  else
    # El fixture tiene que tener con que hablar de un radio: con una sola ficha hermana, "no purgo
    # de mas" es cierto por falta de candidatas y no significa nada.
    if [ "$PAGINAS" -gt 2 ] 2>/dev/null; then
      ok "el fixture midio $PAGINAS paginas: hay fichas ajenas que podrian haberse caido"
    else
      no "el fixture midio solo $PAGINAS paginas: sin fichas hermanas el radio no puede afirmarse"
    fi

    # `frio` son las sentencias que el espia vio contra Postgres. En cero, todas las paginas
    # "sobrevivieron" porque nunca se sirvio nada: es la medicion vacia disfrazada de exito.
    if [ "${FRIO:-0}" -gt 0 ] 2>/dev/null; then
      ok "el espia de Postgres vio $FRIO sentencias: la medicion ocurrio"
    else
      no 'el espia de Postgres no vio ninguna sentencia: la corrida no midio nada y un radio de cero sobre nada es cero'
    fi

    if [ "$RERENDER" = "$ESPERADO" ]; then
      ok "senar un equipo re-genero $RERENDER paginas, que es el esperado ($ESPERADO): sobrevivieron $SOBREVIVIERON"
    else
      no "senar un equipo re-genero $RERENDER paginas y el esperado es $ESPERADO. Si es de mas, cada expiracion del cron reconstruye fichas que no cambiaron y el 95%-sin-Postgres se cae; si es de menos, el equipo senado sigue publicandose como disponible. Purgadas: $(campo_radio 'purgadas')"
    fi
  fi
fi

# ── V10 · el barrido no se traba detras de una fila rota ──────────────────────────────────────
#
# La probe mas cara de la slice, y la unica que necesita Postgres de verdad. El motivo esta escrito
# entero en el archivo: la primera de las tres piezas del arreglo es el `order by`, y un `tx` de
# mentira devuelve las filas en el orden en que se las metieron — no hay nada del ordenamiento que
# pueda medir. Un fake que ignora el orden y despues "verifica el orden" es la familia de ADR-020
# con un mock en lugar de un grep.
#
# Polaridad ejecutada por el LEAD antes de aceptar (2026-08-28), cuatro mutaciones sobre el codigo
# real, cada una revertida: `order by expires_at` a secas -> cae A; sin el techo en el `where` ->
# cae B; `degraded = false` -> cae F; el `+1` que no avanza -> cae A por la asercion del contador,
# con su mensaje. Cuatro mutaciones, cuatro rojos DISTINTOS: ninguna asercion viaja colgada de otra.
sec 'V10 · el barrido no se traba detras de una fila rota (Postgres real)'
if pnpm --filter @istock/web exec vitest run --root ../.. \
     scripts/probes/s6-sweep-head-of-line.test.ts >/tmp/s6-hol.txt 2>&1; then
  ok "la probe de head-of-line pasa: $(grep -oE 'Tests +[0-9]+ passed' /tmp/s6-hol.txt | tail -1)"
else
  # Sin base no hay medicion, y ausencia de medicion es FAIL. El mensaje dice como levantarla:
  # un gate que falla sin decir que hacer se termina comentando.
  if grep -q 'no hay Postgres en' /tmp/s6-hol.txt; then
    no 'la probe de head-of-line no pudo correr: no hay Postgres. Levantalo con `pnpm db:local`'
  else
    no 'la probe de head-of-line FALLA: el cron puede quedar trabado detras de una fila rota y devolver 200'
  fi
  sed 's/^/        /' /tmp/s6-hol.txt | grep -E '×|FAIL|Error|→' | head -8
fi

# ── V10b · el parte de la probe, campo por campo ───────────────────────────────────────────────
#
# Hasta el 2026-08-28 V10 terminaba en la linea de arriba, o sea citaba la probe por su `exit 0`.
# Eso deja pasar el unico modo de falla que importa: una probe que dejo de armar el fixture sigue
# saliendo 0 con las aserciones corriendo sobre la nada. No es hipotetico — es exactamente lo que
# `accept-fase3.sh` hacia con su conteo de paquetes clavado, y es la razon por la que la celda T25
# del board pide una linea `MEDIDO` y declara "ausencia de la linea = FAIL".
#
# Los esperados de abajo son literales ESCRITOS ACA, en shell, en otro archivo que la probe. No se
# derivan de `EXPIRE_BATCH_SIZE` ni de `MAX_SWEEP_ATTEMPTS` leyendo el fuente a proposito (ADR-023):
# una comparacion del mismo origen pasa cuando los dos lados estan mal igual. Bajar el lote a 50 es
# una decision legitima; lo que no puede ser es que se baje sin que nadie toque este numero.
sec 'V10b · el parte del barrido existe y sus numeros son los esperados'
HOL=$(grep -aoE 'MEDIDO cron barrido · .*' /tmp/s6-hol.txt | head -1 || true)
if [ -z "$HOL" ]; then
  no 'no hay linea "MEDIDO cron barrido": la probe no dejo parte de lo que midio y el gate NO pasa por ausencia de medicion'
  inf 'Formato: MEDIDO cron barrido · corridas=<N> · envenenadas=<N> · sanas=<N> · sanas_vencidas_c2=<N> · intentos_tras_fallo=<N> · reintento_tras_recuperarse=<N> · tope=<N> · abandonadas_en_el_tope=<N> · unrecorded=<N> · skipped_sobre_vencidas=<N> · status_base_sana=<N> · status_con_abandonada=<N> · status_primer_fallo=<N> · status_segundo_fallo=<N> · lineas_log_por_envenenada=<N> · lineas_cuarentena_por_envenenada=<N>'
else
  inf "$HOL"
  campo_hol() { printf '%s' "$HOL" | sed -nE "s/.*[[:space:]]$1=([^ ·]*).*/\1/p"; }

  # `corridas` se compara con `-ge` y el resto con `=`. No es laxitud: agregar un caso nuevo a la
  # probe sube las corridas y eso es sano, mientras que un caso que deja de invocar el barrido las
  # baja y eso es el fixture evaporandose. La cota mide lo segundo sin castigar lo primero.
  CORRIDAS=$(campo_hol 'corridas')
  case "$CORRIDAS" in
    ''|*[!0-9]*) no "el parte no trae \`corridas\` legible ('$CORRIDAS'): cambio el formato de la linea — arreglar el gate, no la linea" ;;
    *) [ "$CORRIDAS" -ge 7 ] \
         && ok "la probe invoco el barrido $CORRIDAS veces" \
         || no "la probe invoco el barrido solo $CORRIDAS veces (minimo 7, una por caso mas las dos de A y C). Un caso dejo de correr el barrido: sus aserciones estan midiendo la nada" ;;
  esac

  # nombre_del_campo:esperado:que_significa_si_no_da
  for PAR in \
    'envenenadas:200:el lote de la corrida 1 no vino lleno (EXPIRE_BATCH_SIZE cambio y nadie toco este gate): sin lote lleno no hay head-of-line que medir' \
    'sanas:1:el fixture de A dejo de tener la reserva sana, que es la unica fila que la slice promete liberar' \
    'sanas_vencidas_c2:1:la reserva sana NO vencio en la corrida 2. Es el bug entero: fallar no manda al fondo de la cola' \
    'intentos_tras_fallo:1:el `+1` se rolleo junto con el error. El techo nunca se alcanza y el head-of-line vuelve entero, con el arreglo escrito y sin efecto' \
    'reintento_tras_recuperarse:1:una fila que fallo una vez y dejo de fallar NO volvio al lote. El arreglo se volvio un apagador: cada deadlock legitimo deja una unidad trabada' \
    'tope:5:MAX_SWEEP_ATTEMPTS cambio y nadie toco este gate' \
    'abandonadas_en_el_tope:1:la fila que paso el techo no se conto como abandonada. Una unidad trabada en `reserved` que ademas no figura en ningun numero es el mismo bug con otro disfraz' \
    'unrecorded:1:el `+1` fallo y el barrido no lo conto. Es el estado en el que el head-of-line vuelve sin dejar rastro' \
    'skipped_sobre_vencidas:0:el dominio dijo "nada que hacer" sobre una reserva vencida: esa fila se cuenta como atendida y vuelve manana igual' \
    'status_base_sana:200:el cron NO contesta 200 con la base sana. Un handler que contesta siempre lo mismo no distingue nada, y medir solo el 500 no lo detecta' \
    'status_con_abandonada:500:el cron contesta 200 con una unidad trabada. Un cron verde mientras nada se vence es la falla que se descubre semanas despues y del lado del cliente' \
    'status_primer_fallo:200:la PRIMERA falla de una fila pinto el cron de rojo. A 0,12 expiraciones por corrida eso es rojo permanente por una carrera perdida, y un rojo permanente se ignora igual que un verde vacio' \
    'status_segundo_fallo:500:la SEGUNDA falla de la MISMA fila devolvio 200: el predicado del 500 se quedo en `abandoned > 0` y calla la unidad trabada durante cinco corridas, que es toda la ventana en la que salia barata' \
    'lineas_log_por_envenenada:5:una fila envenenada no cuesta exactamente `tope` lineas. Mas = el techo no la saca del lote (8.640 lineas identicas por mes, para siempre); menos = dejo de entrar antes de tiempo y el reintento legitimo tampoco pasa' \
    'lineas_cuarentena_por_envenenada:1:T31 · `abandoned` dice cuantas, esta dice CUALES y es el unico lugar donde quedan los ids antes de que la fila se calle para siempre. 0 = el evento no se emite; 5 = se emite por intento y no por vida de la fila. Las ramas >= vs === y RETURNING vs select+1 NO las ve este fixture (medido: dan 1 las dos) porque hacen falta dos corridas pisandose' \
  ; do
    N=${PAR%%:*}; RESTO=${PAR#*:}; E=${RESTO%%:*}; POR=${RESTO#*:}
    V=$(campo_hol "$N")
    if [ -z "$V" ]; then
      no "el parte no trae \`$N\`: cambio el formato de la linea — arreglar el gate, no la linea"
    elif [ "$V" = "-1" ]; then
      no "\`$N\` vale -1: el caso que lo mide no llego a correr. Ausencia de medicion es FAIL, nunca PASS"
    elif [ "$V" = "$E" ]; then
      ok "$N=$V"
    else
      no "$N=$V y se esperaba $E · $POR"
    fi
  done
fi

# ══════════════════════════════════════════════════════════════════════════════════════════════
printf '\n'
if [ "$fail" = "0" ]; then
  printf '\033[32mS6: ACEPTADA\033[0m\n'
else
  printf '\033[31mS6: RECHAZADA\033[0m\n'
fi
exit "$fail"
