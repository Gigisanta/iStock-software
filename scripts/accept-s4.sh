#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════════════════════
#  ACEPTACION DE S4 — la re-ejecuta el LEAD, no el agente que escribio el codigo (CLAUDE.md regla 2)
#
#  Gate del board: "texto exacto byte a byte; evento registrado sin PII".
#
#  ESTE ARCHIVO NACE EN ROJO Y ESO ES EL PUNTO: se escribe antes de que exista una linea de S4, para
#  que ningun implementador pueda elegir a que se parece la aceptacion despues de haber implementado.
#
#  ── La primera mitad ya esta entregada, y este gate NO la vuelve a escribir ───────────────────
#  "Texto exacto byte a byte" lo cubren DOS gates que miran cosas distintas, y confundirlos es como
#  se pierde el invariante (lo preciso `docs-keeper` auditando esta misma linea):
#    · `packages/domain/src/wa.test.ts` (U14) compara el string canonico **byte a byte**
#      (`expect(text).toBe(CANONICAL_TEXT)`) — pero sobre la funcion pura, que no sabe que hay una
#      pagina. Prueba el byte; no prueba que alguien lo llame.
#    · M3b de `accept-s3.sh` decodifica el `text=` del href **en el HTML SERVIDO** y exige, por
#      substring, precio en USD, dominio de la vidriera, intencion de compra, `usado A` presente y
#      `usado excelente` ausente (los dos registros de CLAUDE.md §1), mas UN solo anchor. Prueba que
#      lo que sale de la pagina es lo que arma el dominio; no vuelve a comparar el byte.
#  Ninguno de los dos alcanza solo: el primero sin el segundo pasa con el boton borrado, el segundo
#  sin el primero pasa con el mensaje derivando de a un substring por vez. W1 nombra a los dos.
#
#  Copiar esas aserciones aca serian dos copias que derivan. Pero un comentario que dice "eso lo
#  cubre otro archivo" no es una prueba: es exactamente la clase de delegacion que dejo al boton de
#  `wa.me` con TRES pruebas alrededor y ninguna encima durante toda la FASE 3. Asi que W1 **nombra
#  las aserciones, no el archivo**. Si alguien borra M3b, S4 se pone roja junto con S3.
#
#  ── La segunda mitad es lo nuevo: el evento ──────────────────────────────────────────────────
#  Un click en el boton escribe una fila en `wa_click_events`. Es la UNICA escritura sin autenticar
#  del producto, asi que se audita mas que ninguna otra cosa del repo:
#
#    · sin PII            — ni IP, ni user agent, ni telefono. No se anonimiza: no se recibe.
#    · sin privilegio     — `anon` gana INSERT de tres columnas sobre UNA tabla, y nada mas.
#    · sin cruce          — el tenant sale del claim del slug, jamas del body.
#    · sin bloquear       — el href sigue siendo un `wa.me` real: con JS apagado el boton funciona.
#    · sin techo abierto  — la regla del WAF pasa de `planned` a `active` y cubre el handler.
#
#  DOS MEDICIONES LAS EMITE `qa-agent`, NO ESTE SCRIPT, por la misma razon que en S3: hacen falta un
#  browser real y un contador de filas contra Postgres, o sea el arnes de e2e, y `qa-agent` es otra
#  columna que `storefront-agent` y que `app-agent` (CLAUDE.md §4: el gate no puede ser del mismo
#  writer que el codigo que audita). Este script SOLO lee las lineas, y **falla si no estan**:
#  ausencia de medicion es FAIL, nunca PASS.
#
#    MEDIDO s4 click · ruta=<path> · filas_al_cargar=<N> · filas_antes=<N> · filas_despues=<N> · tenant_ok=<si|no> · listing_ok=<si|no>
#    MEDIDO s4 cruce · slug_atacante=<slug> · listing_de=<slug> · filas_creadas=<N>
#    MEDIDO s4 sinjs · ruta=<path> · anchors=<N> · href=<url> · abre_whatsapp=<si|no>
# ══════════════════════════════════════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")/.."
. scripts/_lib.sh

SF="apps/web/app/(storefront)"
HANDLER="$SF/s/[slug]/api/track/route.ts"
HDIR="$SF/s/[slug]/api/track"
COMP="$SF/_components"
BOTON="$COMP/wa-button.tsx"
E2E="e2e/s4-el-click-de-whatsapp-deja-una-fila-sin-pii.spec.ts"

# ── MODO FIXTURE ──────────────────────────────────────────────────────────────────────────────
# Un gate que nunca se vio fallar no es un gate, es un adorno. Con `S4_FIXTURE_E2ELOG` apuntando a
# un log inventado se ejercita la polaridad de W5/W6 sin levantar servidor ni base.
FIXTURE=0
[ -n "${S4_FIXTURE_E2ELOG:-}" ] && FIXTURE=1

# ──────────────────────────────────────────────────────────────────────────────────────────────
sec "W0 · censo: los artefactos de S4 existen"
# Sin estos archivos no hay nada que medir. No se corta el script — las reglas que NO dependen de
# ellos (W1, W7) siguen corriendo y son informativas — pero las que si dependen fallan explicitas
# en vez de imprimir verdes sobre el vacio.
LISTO=1
for f in "$HANDLER" "$BOTON" "$E2E"; do
  if [ -s "$f" ]; then ok "existe y no esta vacio: $f"; else no "falta (o esta vacio): $f"; LISTO=0; fi
done
MIG=$(grep -l 'wa_click_events_storefront_insert' packages/db/drizzle/*.sql 2>/dev/null | head -1)
if [ -n "$MIG" ]; then ok "hay migracion que crea wa_click_events_storefront_insert: $MIG"
else no "ninguna migracion crea la policy de insert de la vidriera sobre wa_click_events"; fi

# ──────────────────────────────────────────────────────────────────────────────────────────────
sec "W1 · el texto exacto sigue afirmado donde corresponde (M3b de accept-s3)"
# Se nombran las ASERCIONES, no el archivo: si M3b desaparece o se afloja, S4 se cae con S3.
for a in "el precio en dolares" "la vidriera de donde vino" "la intencion de compra"; do
  if grep -qF "waq \"$a\"" scripts/accept-s3.sh; then ok "M3b sigue afirmando: $a"
  else no "M3b dejo de afirmar '$a': el texto del wa.me quedo sin nadie encima"; fi
done
if grep -q "usado A" scripts/accept-s3.sh && grep -q "usado excelente" scripts/accept-s3.sh; then
  ok "M3b sigue separando los dos registros de condicion (usado A vs usado excelente)"
else no "M3b dejo de verificar los dos registros de condicion (CLAUDE.md §1, ratificado en FASE 2)"; fi
if grep -q 'UN solo boton wa.me en la ficha' scripts/accept-s3.sh; then
  ok "M3b sigue contando UN solo boton wa.me en la ficha"
else no "M3b dejo de contar los anchors de wa.me: la regla 'UN boton' quedo sin gate"; fi
# El byte exacto vive aca, no en M3b. Si U14 se afloja, "texto exacto byte a byte" deja de ser
# verdad aunque M3b siga verde: los substrings pasan igual con el mensaje derivando de a poco.
if grep -q 'expect(text).toBe(CANONICAL_TEXT)' packages/domain/src/wa.test.ts; then
  ok "U14 sigue comparando el mensaje canonico byte a byte (toBe, no toContain)"
else no "U14 dejo de comparar el mensaje canonico byte a byte: 'texto exacto' se quedo sin la unica asercion que lo afirma"; fi

# ──────────────────────────────────────────────────────────────────────────────────────────────
sec "W2 · el evento no puede tener PII, porque no hay donde ponerla"
if [ -s "$HANDLER" ]; then
  none "el handler de tracking no lee IP ni user agent (wa_click_events es 'sin PII' por diseno)" \
       'x-forwarded-for|x-real-ip|user-?[aA]gent|cf-connecting-ip|\.ip\b' "$HDIR"
  # El body se valida con un objeto CERRADO. Un objeto abierto (o `.passthrough()`) deja entrar
  # campos que despues alguien va a querer guardar "total ya vienen".
  if grep -q '\.strict()' "$HANDLER"; then ok "el body del beacon se valida con un objeto Zod estricto"
  else no "el body del beacon no usa .strict(): un objeto abierto es una invitacion a guardar de mas"; fi
  noneraw "el schema del beacon no usa passthrough()" 'passthrough\(\)' "$HDIR"
else
  no "sin handler: no se puede afirmar que el evento no recibe PII"
fi
if grep -qE '^\s*(ip|ipAddress|user_?agent|userAgent|phone|telefono|fingerprint)\b' packages/db/src/schema/events.ts; then
  no "el schema de eventos gano una columna de PII"
else ok "wa_click_events sigue sin columna de IP, user agent ni telefono"; fi

# ──────────────────────────────────────────────────────────────────────────────────────────────
sec "W3 · anon gana exactamente un privilegio mas, y ni uno mas que ese"
if [ -z "$MIG" ]; then
  no "sin migracion: no se puede auditar que privilegio gano anon"
else
  # El GRANT es de COLUMNA: `id` y `created_at` salen de los defaults y no se pueden forjar.
  if grep -qE 'GRANT INSERT \(\s*"?tenant_id"?\s*,\s*"?listing_id"?\s*,\s*"?source"?\s*\)[^;]*"?wa_click_events"?[^;]*anon' "$MIG"; then
    ok "el GRANT es de columna (tenant_id, listing_id, source): id y created_at no se pueden forjar"
  else no "el GRANT a anon sobre wa_click_events no es de columna, o no es exactamente esas tres"; fi
  # Y NADA mas: ni leer los clicks de otro, ni corregir los propios, ni borrarlos.
  for op in SELECT UPDATE DELETE; do
    if grep -qiE "GRANT[^;]*\b$op\b[^;]*wa_click_events[^;]*anon" "$MIG"; then
      no "anon recibe $op sobre wa_click_events: el visitante escribe su click y no lee ninguno"
    else ok "anon NO recibe $op sobre wa_click_events"; fi
  done
  # El tenant sale del claim del slug. Si saliera del body, cualquiera escribe en la cuenta ajena.
  if grep -A 14 'wa_click_events_storefront_insert' "$MIG" | grep -q 'storefront_tenant_id'; then
    ok "el WITH CHECK ata la fila al tenant del claim (storefront_tenant_id())"
  else no "el WITH CHECK no usa storefront_tenant_id(): el tenant estaria saliendo de otro lado"; fi
fi
if [ -s "$HANDLER" ]; then
  # El tenant llega como segmento de path que escribio el proxy desde el host, no como campo.
  noneraw "el handler no acepta un tenant desde el cliente (viene del segmento que escribio el proxy)" \
       'body[^\n]*tenant|tenant_?[iI]d\s*:\s*(z\.|body|json|input)' "$HDIR"
fi

# ──────────────────────────────────────────────────────────────────────────────────────────────
sec "W4 · la suite e2e, una sola vez, y de ahi salen las tres mediciones"
# W4/W5/W6 leen el MISMO log. Correr la suite tres veces seria triplicar el gasto y, peor, permitir
# que las tres mediciones vengan de tres estados distintos de la base.
EOUT=$(mktemp)
if [ "$FIXTURE" = "1" ]; then
  inf "MODO FIXTURE: no se corre la suite e2e, se lee $S4_FIXTURE_E2ELOG"
  cat "$S4_FIXTURE_E2ELOG" >"$EOUT" 2>/dev/null || true
elif [ "$LISTO" = "0" ]; then
  no "no se corre la suite e2e porque faltan artefactos de S4 (W0): no hay ninguna medicion"
else
  pnpm --filter e2e test >"$EOUT" 2>&1 || no "la suite e2e fallo"
fi
LOG=$(LC_ALL=C sed 's/\x1b\[[0-9;]*m//g' "$EOUT")
rm -f "$EOUT"

# ──────────────────────────────────────────────────────────────────────────────────────────────
sec "W5 · con JavaScript apagado el boton sigue abriendo WhatsApp"
# El beacon es telemetria. Si la telemetria puede romper la venta, la slice esta al reves.
#
# La asercion DECISIVA es una MEDICION, no un grep: `qa-agent` carga la ficha con
# `javaScriptEnabled: false` y lee el `href` que quedo en el DOM servido. Un grep puede confirmar
# que el codigo dice `href={listing.waUrl}` y aun asi la pagina servir otra cosa — es el mismo hueco
# por el que el `wa.me` atraveso toda la FASE 3 con tres pruebas alrededor y ninguna encima. Los
# greps de abajo son baratos y complementarios: explican POR QUE cuando la medicion se cae.
SINJS=$(printf '%s\n' "$LOG" | grep -m1 'MEDIDO s4 sinjs' || true)
if [ -z "$SINJS" ]; then
  no "no hay linea 'MEDIDO s4 sinjs': nadie probo la ficha con JavaScript apagado"
else
  inf "$SINJS"
  printf '%s' "$SINJS" | grep -q 'abre_whatsapp=si' \
    && ok "sin JS, el boton sigue siendo un enlace a wa.me que abre la conversacion" \
    || no "sin JS el boton NO abre WhatsApp: la telemetria se puso adelante de la venta"
  printf '%s' "$SINJS" | grep -q 'anchors=1' \
    && ok "sin JS hay exactamente UN anchor de wa.me (CLAUDE.md §1)" \
    || no "sin JS la cantidad de anchors de wa.me no es 1: $(printf '%s' "$SINJS" | sed 's/.*anchors=\([0-9]*\).*/\1/')"
fi
if [ -s "$BOTON" ]; then
  # El anchor lo sigue rindiendo el servidor. Si `wa-button.tsx` se volviera `"use client"`, el
  # unico camino a la venta pasaria a depender de que hidrate un bundle.
  if head -3 "$BOTON" | grep -q 'use client'; then
    no "wa-button.tsx se volvio \"use client\": el anchor que da la plata quedo dependiendo de hidratacion"
  else ok "el anchor lo sigue rindiendo el servidor (wa-button.tsx no es client component)"; fi
  if grep -qE 'href=\{' "$BOTON" && grep -qE 'waUrl|wa\.me' "$BOTON"; then
    ok "el href del anchor sigue siendo el wa.me del listing (no un redirector propio)"
  else no "el boton dejo de tener el wa.me como href: un redirector propio agrega un salto y un riesgo de open redirect delante de la unica accion que da plata"; fi
  noneraw "el click no se cancela para trackear (la navegacion no depende del beacon)" \
       'preventDefault\(\)' "$COMP"
  if grep -rq 'sendBeacon' "$COMP" 2>/dev/null; then
    ok "el evento sale por navigator.sendBeacon (no lo aborta la navegacion a WhatsApp)"
  else no "el evento no sale por sendBeacon: un fetch normal lo cancela el browser al navegar afuera"; fi
else
  no "sin componente de boton: no se puede auditar el camino sin JS"
fi

# ──────────────────────────────────────────────────────────────────────────────────────────────
sec "W6 · medicion viva: el pageview no escribe, y el click escribe UNA"
# Dos afirmaciones, y la primera es de COSTO tanto como de privacidad. `cost-auditor` la marco como
# el riesgo mas probable de S4 y el unico que no requiere que nadie se equivoque: si el beacon
# disparara en el `view` en vez de en el click, `allowed requests ≈ pageviews` y un renglon fijo del
# presupuesto se vuelve proporcional al trafico. Ademas dejaria de medir intencion de compra —
# contar "cuanta gente miro" es lo que ya hace PostHog, y esta tabla existe para contar cuanta gente
# APRETO. Por eso `filas_al_cargar` y `filas_antes` se miden por separado: entre cargar la ficha y
# apretar el boton, la cuenta de filas no se puede mover.
CLICK=$(printf '%s\n' "$LOG" | grep -m1 'MEDIDO s4 click' || true)
if [ -z "$CLICK" ]; then
  no "no hay linea 'MEDIDO s4 click': el gate NO puede pasar por ausencia de medicion"
else
  inf "$CLICK"
  C=$(printf '%s' "$CLICK" | sed 's/.*filas_al_cargar=\([0-9]*\).*/\1/')
  A=$(printf '%s' "$CLICK" | sed 's/.*filas_antes=\([0-9]*\).*/\1/')
  D=$(printf '%s' "$CLICK" | sed 's/.*filas_despues=\([0-9]*\).*/\1/')
  if [ "$A" -eq "$C" ]; then ok "cargar la ficha no escribio ninguna fila ($C → $A): el beacon dispara en el click, no en el view"
  else no "el pageview escribio $((A - C)) fila(s) sin que nadie apretara nada: el beacon quedo atado al view (allowed requests ≈ pageviews, y la tabla deja de medir intencion)"; fi
  if [ "$((D - A))" -eq 1 ]; then ok "el click dejo exactamente 1 fila ($A → $D)"
  else no "el click dejo $((D - A)) filas y se espera exactamente 1 ($A → $D)"; fi
  printf '%s' "$CLICK" | grep -q 'tenant_ok=si'  && ok "la fila quedo en el tenant correcto"  || no "la fila NO quedo en el tenant correcto"
  printf '%s' "$CLICK" | grep -q 'listing_ok=si' && ok "la fila apunta al listing correcto"   || no "la fila NO apunta al listing correcto"
fi

# ──────────────────────────────────────────────────────────────────────────────────────────────
sec "W6b · un tenant no puede escribir un click en la cuenta de otro"
CRUCE=$(printf '%s\n' "$LOG" | grep -m1 'MEDIDO s4 cruce' || true)
if [ -z "$CRUCE" ]; then
  no "no hay linea 'MEDIDO s4 cruce': sin ella no se puede afirmar el aislamiento de la escritura"
else
  inf "$CRUCE"
  printf '%s' "$CRUCE" | grep -q 'filas_creadas=0' \
    && ok "el POST nombrando el listing de otro tenant no creo ninguna fila" \
    || no "el POST cruzado creo filas: es escritura cross-tenant, rechazo (CLAUDE.md §7)"
fi

# ──────────────────────────────────────────────────────────────────────────────────────────────
sec "W7 · el endpoint nuevo nace con techo, no sin el"
if node -e "const c=require('./config/firewall-rules.json');const r=c.rules.find(x=>x.name==='storefront-track-rl');process.exit(r&&r.status==='active'?0:1)" 2>/dev/null; then
  ok "la regla storefront-track-rl paso de planned a active"
else no "la regla del WAF para /api/track sigue en planned: el endpoint existe y no tiene techo declarado"; fi
FWOUT=$(mktemp)
if ./scripts/guard-firewall.sh >"$FWOUT" 2>&1; then
  ok "guard-firewall PASS: la regla activa cubre un handler que existe y el censo esta decidido"
else
  no "guard-firewall FAIL — $(LC_ALL=C sed 's/\x1b\[[0-9;]*m//g' "$FWOUT" | grep -m1 'FAIL' | sed 's/^ *FAIL *//')"
fi
rm -f "$FWOUT"

# ──────────────────────────────────────────────────────────────────────────────────────────────
sec "W8 · las prohibiciones de siempre, sobre lo que toco S4"
none "cero imei/cost/margin/notas internas en lo que escribio S4" \
     '\b(imei|cost_?[uU]sd[A-Za-z_]*|margin[A-Za-z_]*|internal_?[nN]otes|supplier)\b' "$HDIR" "$COMP"
none "sin console.log en el handler ni en los componentes de la vidriera" \
     'console\.(log|info|debug)\(' "$HDIR" "$COMP"
noneraw "sin 'despues el RLS/R2/cache' en la unica escritura sin autenticar del producto" \
     '(TODO|FIXME|XXX)' "$HDIR"

# ──────────────────────────────────────────────────────────────────────────────────────────────
if [ "$FIXTURE" = "1" ]; then
  printf '\n\033[1;33mMODO FIXTURE — esto NO acepta nada.\033[0m reglas en rojo: %s\n' "$fail"
  exit 3
fi
if [ "$fail" = "0" ]; then printf '\n\033[1;32mS4: ACEPTADA\033[0m\n'; else printf '\n\033[1;31mS4: RECHAZADA\033[0m\n'; fi
exit "$fail"
