#!/usr/bin/env bash
# ACEPTACION DE S1 — la re-ejecuta el LEAD, no el agente que escribio el codigo (CLAUDE.md regla 2).
#
# Gate del board (docs/SLICE_BOARD.md:77):
#   "{slug}.local resuelve al tenant; slug inexistente -> pagina legible con noindex" (ADR-011)
#
# Los seis hallazgos que rechazaron S1 en la primera pasada estan codificados aca como chequeos.
# Un hallazgo que no deja atras un chequeo re-ejecutable vuelve, y vuelve callado.
#
# A1 aislamiento real en la DB   A2 la vidriera baja de rol   A3 404 en la PRIMERA request
# A4 el miss no se sirve como vidriera A5 cacheLife asimetrico      A6 la suite e2e corre entera
# A7 prohibiciones de siempre
#
# NOTA DE DISENO, a proposito: el tier vivo (A3/A4) NO se puede saltear. HIGH-2 se encontro con
# curl, no leyendo codigo, y un gate que pasa en verde porque nadie levanto el server es
# exactamente el modo de falla contra el que existe este archivo. Sin server, esto FALLA.
set -uo pipefail
cd "$(dirname "$0")/.."
. scripts/_lib.sh   # sec/ok/no/inf/none/noneraw + el contador `fail`. Probado en scripts/_lib.test.sh

DBURL="${DATABASE_URL:-postgresql://localhost:5432/istock_dev}"
PORT="${E2E_PORT:-3100}"

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

APEX="${E2E_APEX_HOST:-127.0.0.1.nip.io}"
SF="apps/web/app/(storefront)"

# ─────────────────────────────────────────────────────────────────────────────
sec "A1 · aislamiento real en Postgres (HIGH-1, db-agent)"
# La primera pasada leia como correcta una vidriera que en dev corria como SUPERUSER (usesuper=t,
# se saltea FORCE RLS entero) y que en produccion, con `anon`, habria leido cero filas: 0001 hace
# REVOKE ALL FROM anon y nunca otorgaba nada. GRANT y RLS son dos capas y se evaluan las dos.
MIG=$(ls packages/db/drizzle/0002_*.sql 2>/dev/null | head -1)
if [ -n "$MIG" ] && [ -s "$MIG" ]; then ok "existe la migracion del rol anonimo: $MIG"
else no "falta la migracion 0002 (GRANT + policies del rol anonimo)"; MIG=/dev/null; fi

# ── Los GRANT los audita `scripts/guard-grants.sh`, por SENTENCIA y no por linea ──────────────
# Aca vivian dos reglas y las DOS estaban verdes por vacio. Encontrado por el LEAD el 2026-08-28
# probando polaridades; el detalle importa porque el patron se repite:
#
#   1. La regla de columnas prohibidas grepeaba `GRANT` y `anon` en la MISMA linea. Cinco de los
#      seis GRANT a `anon` son multilinea (la linea que dice GRANT no dice anon y viceversa), asi
#      que solo veia `fx_settings`. Verificado inyectando "imei" en el GRANT de `listings`: la
#      regla no disparaba. Se podia otorgar el IMEI al rol anonimo con S1 en verde.
#   2. La regla "hay policy TO anon" buscaba `TO[[:space:]]+anon`, pero drizzle-kit emite
#      `TO "anon"` CON comillas. Matcheaba 13 lineas: comentarios en prosa, un GRANT EXECUTE sobre
#      una funcion y los GRANT de columna. Ninguna de las 5 policies reales. Borrar las cinco
#      policies dejaba la regla verde.
#
# La leccion no es "arreglar el regex": es que un gate que nunca se vio fallar no es un gate.
# La auditoria de GRANT se movio a un guard propio que parsea SENTENCIAS (separa por
# `--> statement-breakpoint`, tira las lineas de comentario ANTES de partir, y junta la lista de
# columnas de cada GRANT aunque ocupe cinco lineas). Sus siete reglas estan probadas en las dos
# polaridades. Aca solo se lo invoca: una sola implementacion, un solo lugar donde arreglarla.
if [ -x scripts/guard-grants.sh ]; then
  if scripts/guard-grants.sh > /tmp/s1-grants.txt 2>&1; then
    ok "guard-grants: toda tabla con GRANT explicito y anon sin columna prohibida"
  else
    no "guard-grants rechazo los GRANT"; sed 's/^/        /' /tmp/s1-grants.txt | head -20
  fi
else
  no "falta scripts/guard-grants.sh — la auditoria de GRANT no corrio (ausencia de medicion = FAIL)"
fi

# Que existan las policies es una pregunta distinta del GRANT y se chequea aparte: son las DOS
# capas de CLAUDE.md §2. El GRANT decide que tablas y columnas podes tocar; la policy, que filas
# ves. Se cuentan las policies REALES, aceptando `TO anon` y `TO "anon"`, y se exige que sean
# CREATE POLICY: es lo que la version anterior de esta linea no hacia.
POLS=$(grep -icE 'CREATE[[:space:]]+POLICY.*TO[[:space:]]+"?anon"?' "$MIG" 2>/dev/null || echo 0)
if [ "$POLS" -ge 1 ]; then ok "hay $POLS policies CREATE POLICY ... TO anon"
else no "cero policies TO anon en $MIG (con GRANT y sin policy, anon lee cero filas)"; fi

ESCR=$(grep -inE 'for[[:space:]]+(insert|update|delete|all)\b' "$MIG" 2>/dev/null \
       | grep -iE '\banon\b' || true)
if [ -z "$ESCR" ]; then ok "anon no tiene ninguna policy de escritura"
else no "anon tiene una policy de escritura"; echo "$ESCR" | sed 's/^/        /'; fi

# El assert que impide que el hallazgo vuelva: sin el, correr el test como superusuario lo pone
# verde pase lo que pase, y el test entero es teatro.
chk "el test del rol anonimo afirma que la conexion NO es superusuario" \
    "grep -rqiE 'usesuper' packages/db/src"

# --- vivo: contra el Postgres real. Un grep de la migracion no prueba que este aplicada.
if psql "$DBURL" -tAc 'select 1' >/dev/null 2>&1; then
  q() { psql "$DBURL" -tAc "$1" 2>/dev/null | tr -d '[:space:]'; }
  if [ "$(q "select count(*) from pg_roles where rolname='anon'")" = "1" ]; then
    chk "aplicado: anon NO puede leer listings.imei" \
        "[ \"\$(q \"select has_column_privilege('anon','listings','imei','SELECT')\")\" = 'f' ]"
    chk "aplicado: anon NO puede insertar en listings" \
        "[ \"\$(q \"select has_table_privilege('anon','listings','INSERT')\")\" = 'f' ]"
    chk "aplicado: anon SI puede leer alguna columna publica de listings" \
        "[ \"\$(q \"select bool_or(has_column_privilege('anon','listings',a.attname,'SELECT')) from pg_attribute a where a.attrelid='listings'::regclass and a.attnum>0 and not a.attisdropped\")\" = 't' ]"
    chk "aplicado: listings tiene RLS forzada" \
        "[ \"\$(q \"select relforcerowsecurity from pg_class where oid='listings'::regclass\")\" = 't' ]"
  else
    no "el rol anon no existe en la base: la migracion no esta aplicada"
  fi
else
  no "no se pudo conectar a \$DATABASE_URL ($DBURL) — A1 vivo no corrio, y sin eso no hay aceptacion"
fi

# ─────────────────────────────────────────────────────────────────────────────
sec "A2 · la vidriera baja de rol antes de consultar (HIGH-1, storefront-agent)"
have "$SF/_lib/tenant.ts"
have "$SF/_lib/storefront-db.ts"
chk "el helper unico abre transaccion y baja a anon" \
    "grep -qE 'set local role anon' '$SF/_lib/storefront-db.ts' && grep -qE '\.transaction\(' '$SF/_lib/storefront-db.ts'"
# ── ESTA ASERCION LA REESCRIBIO EL LEAD, 2026-08-28, y el motivo importa mas que el arreglo ──
# La version anterior greppeaba `set local role` DENTRO de tenant.ts. Cuando storefront-agent
# centralizo la bajada de rol en `_lib/storefront-db.ts` -que es mejor codigo: un solo lugar donde
# se abre transaccion y se baja a anon- la asercion quedo apuntando a un archivo que ya no la
# contiene. No lo noto nadie porque `chk` no estaba definido y la linea se EVAPORABA en silencio
# (ese hallazgo es lo que motivo scripts/guard-gates.sh).
# Repuntar el grep a storefront-db.ts habria repuesto exactamente la misma fragilidad: un gate
# atado al nombre del archivo de hoy. Lo que se afirma ahora es el invariante, no su domicilio:
# NINGUN archivo de la vidriera construye su propia conexion. Si el pool vive en un solo lugar y
# ese lugar baja el rol, entonces toda query de la vidriera corre como `anon`, sin importar cuantos
# helpers nuevos aparezcan. Un atajo que se saltee `withStorefrontDb` rompe el gate el dia que se
# escribe, y no el dia que alguien se acuerda de actualizar el grep.
# `createDb(` es el constructor; importar `tenants`/`listings` de @istock/db es schema, no conexion.
chk "solo storefront-db.ts construye conexion: el resto consulta via withStorefrontDb" \
    "! grep -rlE 'createDb\(' '$SF' --include='*.ts' | grep -qv '_lib/storefront-db.ts'"
none "no queda una conexion memoizada que consulte sin rol" \
     "memoizedDb[^=]*=[^=]*createDb" "$SF"
chk "el WHERE de tenant explicito sigue ahi (defensa en profundidad, no reemplazo de RLS)" \
    "grep -qriE '(tenantId|tenant_id|slug)' '$SF/_lib/tenant.ts'"

# ─────────────────────────────────────────────────────────────────────────────
sec "A3/A4 · el slug inexistente no se sirve como vidriera (HIGH-2 + MEDIUM-A/B) — tier vivo"
# ── EL GATE CAMBIO. Lo cambio el LEAD, a la vista, con ADR-011. ──────────────────────────────
# La version anterior exigia "404 real en la PRIMERA request". Ese gate es INALCANZABLE en
# Next 16.3.3 con cacheComponents, y no por un bug nuestro: bajo PPR el status se decide antes
# de que resuelva el lookup del slug, y la doc de Next lo dice explicito (loading.md:103-113).
# Medido por el LEAD, tres variantes, mismo build:
#   A  notFound() en s/[slug]      -> req1 200 / req2+ 404, body VISIBLE = 0 bytes, siempre
#   C  notFound(), boundary arriba -> identico a A (la posicion en el arbol no cambia nada)
#   B  el 404 como contenido       -> 200 siempre, body 797 B, h1=1, noindex+nofollow, titulo propio
# Es status XOR body: ninguna variante da las dos. Ninguna da 404 en la PRIMERA request.
# Se eligio B. El proposito del gate -no confundir un slug muerto con una vidriera, no indexarlo-
# se cumple con noindex + DOM legible; la letra (el status) se cumplia mientras se le mostraba una
# pagina en blanco al 100% de las personas. Se paga un precio y esta anotado abajo como deuda.
# El slug se genera nuevo en cada corrida: nunca fue pedido, asi que el cache esta frio para el
# aunque el server este caliente. Eso es lo que hace innecesario rebuildear para medir el miss.
SLUG="noexiste-$(date +%s)-$$"
URL="http://${SLUG}.${APEX}:${PORT}/"
BOOT=""

# ── IDENTIDAD DEL SERVER QUE REUSAMOS ────────────────────────────────────────────────────────
# Un 200 en /api/health prueba que HAY un server, no que sea ESTE build. El 2026-08-27 quedo vivo
# un `next start` de las 09:29 (codigo pre-ADR-011, variante A) mientras el arbol se rebuildeaba a
# las 11:16. El gate lo hubiera reusado y certificado la variante A como si fuera la B. Peor: ese
# proceso escribio una entrada de ISR con "status":404 DENTRO del .next nuevo, porque el cache de
# ISR vive en disco y lo comparten los dos builds. Un gate que se deja mentir asi no es un gate.
#
# Firma que lo distingue sin pedirle nada a la app (y sin invadir app/api/**, que no es mi columna):
# **si el proceso que escucha arranco ANTES del BUILD_ID que hay en disco, es de otro build.**
# Ante la duda -no puedo identificar el proceso- NO reuso: prefiero pagar un build.
# NUNCA mato el server ajeno: puede ser de otro agente trabajando. Me corro de puerto y listo.
server_es_de_este_build() {
  local port="$1" pid ls start bid
  pid=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1) || return 1
  [ -n "$pid" ] || return 1
  ls=$(ps -p "$pid" -o lstart= 2>/dev/null | sed 's/^ *//;s/ *$//') || return 1
  start=$(lstart_a_epoch "$ls") || return 1
  [ -n "$start" ] || return 1
  bid=$(mtime apps/web/.next/BUILD_ID) || return 1
  [ "$start" -ge "$bid" ]
}

# Segunda staleness, y es la que de verdad me mordio. `server_es_de_este_build` compara
# server >= build: detecta al zombi que sobrevivio a un rebuild. No ve el caso simetrico,
# **fuente >= build**: el server ES de este build, pero el build ya no es de este arbol porque
# alguien toco una fuente despues de compilar. El gate sale rojo o verde midiendo codigo que no
# es el que estoy por commitear, y las dos polaridades del error son igual de caras: un rojo
# fantasma manda a un agente a arreglar un bug que no existe, y un verde fantasma comitea uno
# que si.
#
# Me paso con S1: `[miss x 5]` durante una ronda entera. Ni siquiera hacia falta un cambio de
# comportamiento — el .next servido no correspondia al arbol y con eso alcanzo.
#
# Sale por `git ls-files` para no barrer node_modules ni .next, y saltea los `*.test.ts`: los
# tests no entran al bundle, asi que tocarlos no invalida el build y forzar un rebuild por cada
# edicion de un test seria un impuesto de minutos por ronda.
build_es_del_arbol_actual() {
  local bid nuevas
  bid=$(mtime apps/web/.next/BUILD_ID) || return 1
  nuevas=$(git ls-files --cached --others --exclude-standard -- 'apps/web' 'packages' \
    | grep -E '\.(ts|tsx|js|mjs|cjs|json|css)$' \
    | grep -vE '\.test\.(ts|tsx)$' \
    | while IFS= read -r f; do
        [ -f "$f" ] || continue
        m=$(mtime "$f") || continue
        [ "$m" -gt "$bid" ] && printf '%s\n' "$f"
      done)
  if [ -n "$nuevas" ]; then
    printf '%s\n' "$nuevas" | head -5 | while IFS= read -r f; do inf "  fuente mas nueva que el build: $f"; done
    return 1
  fi
  return 0
}

if curl -sf -m 5 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
  if server_es_de_este_build "$PORT" && build_es_del_arbol_actual; then
    ok "el server de :$PORT es de este build (arranco despues del BUILD_ID en disco)"
  else
    inf "el server de :$PORT no sirve para medir: o no es de este build, o el build quedo atras del arbol"
    inf "no lo mato — puede ser de otro agente. Me corro de puerto."
    for CAND in $(seq $((PORT+1)) $((PORT+20))); do
      if ! lsof -nP -iTCP:"$CAND" -sTCP:LISTEN -t >/dev/null 2>&1; then PORT="$CAND"; break; fi
    done
    inf "puerto nuevo: :$PORT"
    URL="http://${SLUG}.${APEX}:${PORT}/"
  fi
fi

if ! curl -sf -m 5 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
  inf "no hay server confiable en :$PORT — levantando uno (build + start), puede tardar unos minutos"
  if pnpm --filter @istock/web exec next build >/tmp/accept-s1-build.log 2>&1; then
    NODE_ENV=test DATABASE_URL="$DBURL" AUTH_DRIVER=local \
      pnpm --filter @istock/web exec next start -p "$PORT" >/tmp/accept-s1-start.log 2>&1 &
    BOOT=$!
    for _ in $(seq 1 60); do curl -sf -m 2 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1 && break; sleep 1; done
  else
    no "el build fallo (ver /tmp/accept-s1-build.log)"
  fi
fi

if curl -sf -m 5 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
  BODY=$(mktemp); HDR=$(mktemp); BODY2=$(mktemp); HDR2=$(mktemp)
  CODE=$(curl -s -o "$BODY" -D "$HDR" -w '%{http_code}' -m 20 "$URL" || echo 000)
  inf "primera request a $SLUG -> HTTP $CODE ($(wc -c <"$BODY" | tr -d ' ') bytes)"

  # 1 · MEDIUM-A. El h1 vivia SOLO en el payload de Flight, que lo lleva JSON-escapado. Un `<h1`
  #     literal en el body es DOM renderizado de verdad; el payload nunca lo escribe asi. Este es
  #     el chequeo que la variante A reprobaba en el 100% de las requests, primera o centesima.
  if grep -q '<h1' "$BODY"; then ok "el miss renderiza DOM de verdad en la PRIMERA request (h1 literal, no Flight)"
  else no "el miss sale con el body vacio: el h1 esta solo en el payload de Flight (MEDIUM-A)"; fi

  # 2 · MEDIUM-B. Un slug muerto ofrecido a Google para indexar no sirve de nada.
  if grep -qiE '<meta[^>]+name="robots"[^>]+noindex' "$BODY"; then ok "el miss va con robots noindex"
  else no "el miss hereda 'index, follow' del layout raiz (MEDIUM-B)"; fi
  T=$(grep -oiE '<title[^>]*>[^<]*</title>' "$BODY" | head -1 | sed -E 's/<[^>]+>//g')
  if [ -n "$T" ] && [ "$T" != "iStock" ]; then ok "el miss tiene titulo propio: \"$T\""
  else no "el miss hereda el titulo del layout raiz (\"${T:-vacio}\") (MEDIUM-B)"; fi

  # 3 · Lo que reemplaza al status: el miss no puede parecerse a una vidriera. Sin esto, la
  #     variante B degradaria en silencio a "shell de vidriera vacia con 200" y nadie lo veria.
  if grep -qiE 'wa\.me|data-listing|precio en USD' "$BODY"; then
    no "el miss trae markup de vidriera (wa.me / listing): se esta sirviendo como tienda"
  else ok "el miss no trae markup de vidriera (ni wa.me ni listings)"; fi

  # 4 · Costo: el miss TIENE que quedar cacheado, o un escaneo de subdominios es una query a
  #     Postgres por request. Es la mitad del motivo por el que existe el perfil corto de §6.
  CODE2=$(curl -s -o "$BODY2" -D "$HDR2" -w '%{http_code}' -m 20 "$URL" || echo 000)
  if grep -qi 'x-nextjs-cache:.*HIT' "$HDR2"; then ok "la segunda request al mismo slug es HIT (0 queries)"
  else no "la segunda request no es HIT: cada slug inventado pega en Postgres"; fi
  if diff -q <(sed 's/<script[^>]*>.*//g' "$BODY") <(sed 's/<script[^>]*>.*//g' "$BODY2") >/dev/null 2>&1; then
    ok "el DOM del miss es identico en req1 y req2 (no hay 'primera bien, resto en blanco')"
  else inf "el DOM del miss difiere entre req1 y req2 (req1=$CODE req2=$CODE2) — mirar a mano"; fi

  # 5 · DEUDA DECLARADA de ADR-011, impresa siempre. Un A4 verde NO significa que haya 404 duro.
  inf "DEUDA ADR-011: el status es $CODE/$CODE2, no 404. El miss deja de ser distinguible en los"
  inf "               logs de acceso por status code. Aceptado a cambio de que la persona que se"
  inf "               equivoco de subdominio lea algo en vez de ver una pagina en blanco."

  # 6 · Control. Sin esto, un bug que rompa TODA la vidriera pondria 1..4 en verde.
  CTRL=$(curl -s -o /dev/null -w '%{http_code}' -m 20 "http://demo.${APEX}:${PORT}/" || echo 000)
  if [ "$CTRL" = "200" ]; then ok "control: el tenant demo sigue sirviendo 200"
  else no "control: el tenant demo devolvio $CTRL — la vidriera real esta rota"; fi
  rm -f "$BODY" "$HDR" "$BODY2" "$HDR2"
else
  no "no hay server en :$PORT — A3/A4 no corrieron, y sin medir el miss no hay aceptacion de S1"
fi

# ─────────────────────────────────────────────────────────────────────────────
sec "A8 · ninguna URL publica deja la respuesta abierta (HIGH del adversary de S1)"
# Lo encontro el adversary, NO este gate, y esa es la razon por la que existe este tier.
#
# `/s/<algo>.json` es match de la ruta `/s/[slug]` pero NO del matcher del proxy (que excluye 14
# extensiones estaticas), asi que la guarda del proxy no corria y el slug basura terminaba en
# `cacheTag()`, que tira. Sin `error.tsx`, bajo cacheComponents+PPR **un throw de render no es un
# 500: es un stream que nunca cierra con status 200**. Anonimo, sin auth, `no-store` (el CDN nunca
# lo absorbe), cardinalidad de paths infinita: 1 request : hasta 300 s de Active CPU facturado.
#
# Por que el assert central es el TIEMPO y no el status: un chequeo de status no ve nada de esto.
# El status llega enseguida y es 200; lo que no llega nunca es el fin del body. Un gate que mira
# `%{http_code}` da verde mientras la funcion se factura sola. Mido `%{time_total}` con `-m` corto
# y trato el timeout de curl (exit 28) como el fallo que es.
if curl -sf -m 5 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
  A8_PRESUPUESTO=8
  for EXT in json txt css xml woff2; do
    A8_URL="http://127.0.0.1:${PORT}/s/noexiste-a8-$$.${EXT}"
    A8_OUT=$(mktemp)
    A8_CODE=$(curl -s -o "$A8_OUT" -w '%{http_code}' -m "$A8_PRESUPUESTO" "$A8_URL" 2>/dev/null) || A8_CODE=TIMEOUT
    if [ "$A8_CODE" = "TIMEOUT" ]; then
      no "/s/*.${EXT}: la respuesta no cerro en ${A8_PRESUPUESTO}s (stream colgado = CPU facturada)"
    elif grep -q '__next_error__' "$A8_OUT" 2>/dev/null; then
      no "/s/*.${EXT}: cerro, pero el body es una pagina de error de Next (throw de render sin manejar)"
    else
      ok "/s/*.${EXT}: la respuesta cierra sola, HTTP $A8_CODE, sin pagina de error"
    fi
    rm -f "$A8_OUT"
  done
  # Control positivo. Sin esto, el tier de arriba se satisface apagando la ruta entera.
  A8_CTRL=$(curl -s -o /dev/null -w '%{http_code}' -m "$A8_PRESUPUESTO" \
    "http://${SLUG}.${APEX}:${PORT}/" 2>/dev/null) || A8_CTRL=TIMEOUT
  if [ "$A8_CTRL" = "200" ]; then ok "control: el slug bien formado sigue dando el miss de ADR-011 (200)"
  else no "control: el slug bien formado dejo de dar 200 (dio $A8_CTRL): el fix rompio trafico legitimo"; fi
else
  no "A8 no pudo medir: no hay server en :$PORT. Un tier que no corre no es un tier que pasa."
fi

[ -n "$BOOT" ] && kill "$BOOT" 2>/dev/null

# A8 corre ACA, entre A3/A4 y A5, porque es el ultimo tier que necesita el server vivo: el
# teardown que lo apaga va justo arriba de esta linea y no antes.
#
# Historial, porque me equivoque dos veces seguidas y de dos formas distintas: primero lo puse
# al final de todo y no medio nada; le atribui la muerte del server al teardown de Playwright y
# lo move aca, y SIGUIO sin medir. La causa real la delato el propio bash — "line 278:
# Terminated: 15 ... next start" — y era el `kill "$BOOT"` de A3/A4, o sea mi propio teardown,
# no Playwright. Vale como recordatorio de que un tier que dice "no pude medir" es informacion
# util y un tier que asume que hay server es un verde inventado.
sec "A5 · cacheLife asimetrico (MEDIUM-C, decision del LEAD)"
# Positivo 'max' = los USD 0.012/tenant/mes. Negativo corto = un slug elegido por un atacante no
# crea una entrada durable de 30 dias, y un tenant dado de alta despues no nace muerto.
chk "el positivo sigue en 'max'" "grep -rqE \"cacheLife\\('max'\\)\" '$SF'"
chk "el negativo tiene perfil propio y corto (no 'max')" \
    "grep -rqE 'cacheLife\\(\\{' '$SF'"
# La polaridad la chequea guard-leaks.sh §6 (6a..6e), reescrito por el LEAD despues de que
# storefront-agent reportara que el regex anterior no distinguia el polo positivo del negativo
# y se satisfacia renombrando el literal a una constante. Aca se invoca, no se duplica: dos
# copias del mismo regex derivan, y la que deriva es siempre la que nadie mira.
if bash scripts/guard-leaks.sh 2>&1 | sed 's/\x1b\[[0-9;]*m//g' \
     | sed -n '/^6 \./,/^7 /p' | grep -q 'LEAK'; then
  no "guard-leaks.sh §6 (polaridad de cacheLife) reporta LEAK"
  bash scripts/guard-leaks.sh 2>&1 | sed 's/\x1b\[[0-9;]*m//g' \
    | sed -n '/^6 \./,/^7 /p' | grep -E 'LEAK|^        ' | sed 's/^/        /'
else
  ok "guard-leaks.sh §6: polaridad de cacheLife limpia (positivo max / negativo corto)"
fi
chk "el alta de tenant invalida el tag de su propio slug (el cinturon)" \
    "grep -rqE 'revalidateTag|updateTag' 'apps/web/app/(app)/_lib/tenants/storefront-cache.ts'"

# ─────────────────────────────────────────────────────────────────────────────
sec "A6 · la suite e2e corre ENTERA (HIGH-3, qa-agent)"
# El pool se abria a nivel de modulo y cada spec llamaba closeDb(): con workers:1 el primer spec
# alfabetico se llevaba puesto a todos los demas, y los tests de aislamiento nunca se ejecutaban.
SPECS=$(ls e2e/*.spec.ts 2>/dev/null | wc -l | tr -d ' ')
inf "specs en e2e/: $SPECS"
OUT=$(mktemp)
# TRAMPA QUE YA ME COMI UNA VEZ, 2026-08-27: esto decia `pnpm --filter @istock/e2e test`, y en
# e2e/package.json NO existe un script `test` (hay `e2e`). **pnpm no-opea con exit 0 cuando el
# script no existe.** Resultado: A6 reportaba "la suite termino en verde" + "0/3 specs" durante
# toda una ronda, sin haber invocado Playwright ni una vez. Un gate que se cree su propio no-op
# es peor que no tener gate. Por eso el nombre del script se VERIFICA antes de correrlo.
E2E_SCRIPT=e2e
if ! node -e "process.exit(require('./e2e/package.json').scripts?.['$E2E_SCRIPT']?0:1)" 2>/dev/null; then
  no "e2e/package.json no expone el script '$E2E_SCRIPT': el gate correria un no-op con exit 0"
fi
# Tampoco pasar --reporter: en la CLI REEMPLAZA los reporters del config y apaga el censo de
# qa-agent (medido por ellos). El acotado va por env, no por flag.
if pnpm --filter @istock/e2e "$E2E_SCRIPT" >"$OUT" 2>&1; then E2ERC=0; else E2ERC=1; fi
# NO se cuenta "el nombre del spec aparece en la salida": cuando el censo FALLA imprime el nombre
# de cada spec que NO corrio, asi que ese conteo daba 8/8 con CERO tests ejecutados. El numero se
# lee del censo, que lo emite el reporter de `qa-agent` (otra columna). 2026-08-27, medido en S2.
RAN=$(grep -iE 'censo de specs' "$OUT" | tail -1 \
      | sed -nE 's|.*[^0-9]([0-9]+)/([0-9]+) archivos ejecutados.*|\1|p')
RAN="${RAN:-0}"
# El censo por ARCHIVO no alcanza: un spec puede aparecer nombrado y dejar tests sin correr
# ("did not run"). qa-agent emite un censo por TEST; si esta, lo exijo.
CENSO=$(grep -iE 'censo de specs' "$OUT" | tail -1 || true)
if [ -n "$CENSO" ]; then
  inf "$(echo "$CENSO" | sed 's/^[[:space:]]*//')"
  echo "$CENSO" | grep -qE '([0-9]+)/\1 tests ejecutados' && ok "ningun test quedo en 'did not run'" \
    || no "el censo por test no cierra: hay tests descubiertos que no se ejecutaron"
  echo "$CENSO" | grep -qE '(^|[^0-9])0/0 tests' && no "el censo dice 0 tests: la suite no ejecuto nada"
else
  inf "sin linea de censo en la salida (qa-agent la emite): solo puedo contar por archivo"
fi
if [ "$E2ERC" = "0" ]; then ok "la suite e2e termino en verde"
else no "la suite e2e fallo"; tail -25 "$OUT" | sed 's/^/        /'; fi
if [ "$RAN" = "$SPECS" ] && [ "$SPECS" != "0" ]; then ok "los $SPECS specs se ejecutaron (ninguno quedo sin correr)"
else no "solo $RAN de $SPECS specs aparecen en la salida: la suite se corta a la mitad"; fi
rm -f "$OUT"

# ─────────────────────────────────────────────────────────────────────────────
sec "A7 · prohibiciones de siempre sobre lo que toco S1"
# `--exclude=*.test.ts` no es aflojar la regla: es apuntarla a lo que la regla protege.
# Lo que se guarda es el FLUJO DE DATOS del codigo servido — `listing.imei` en un DTO, `cost_usd`
# en un payload. Un `.test.ts` no se sirve, y su prosa nombra justamente lo que no debe pasar:
# esta linea la disparo el MENSAJE DE FALLO de `error.test.ts`, un test que PROHIBE importar el
# barrel de `@istock/domain` y que enumera `fx, wa, imei, dto` para explicar que arrastraria.
# O sea que el guard marcaba en rojo al test que impone la misma regla que el guard. Un grep no
# distingue prosa de acceso a propiedad, y el precio de fingir que si es que la proxima persona
# reescriba el mensaje del test para pasar el gate — peor que no tener el gate.
# El codigo real de (storefront) lo sigue cubriendo web-lint W009, que ya excluye tests igual.
none "cero imei/cost/margin/notas internas en (storefront)" \
     "\b(imei|cost_?usd|costUsd|margin|internal_?notes|internalNotes|supplier)\b" \
     --exclude="*.test.ts" "$SF"
none "sin console.log de un listing" "console\.log\([^)]*(listing|unit|producto)" apps/web/app packages
noneraw "sin 'despues el RLS/R2/cache' (noneraw: el hallazgo ES un comentario)" \
     "(TODO|FIXME|XXX)[^\n]*(RLS|R2|cache|caché|despu)" apps/web/app packages/db/src "$SF"
none "el slug no viaja como header de tenant" "headers\(\)|x-tenant" "$SF"

printf '\n'
if [ "$fail" = "0" ]; then printf '\033[1;32mS1: ACEPTADA\033[0m\n'
else printf '\033[1;31mS1: RECHAZADA\033[0m\n'; fi
exit "$fail"
