#!/usr/bin/env bash
# ACEPTACION DE S2 — la re-ejecuta el LEAD, no el agente que escribio el codigo (CLAUDE.md regla 2).
#
# Gate del board (docs/SLICE_BOARD.md): "3 variantes generadas; `card` <=150KB medido".
#
# S2 tiene dos mitades y las dos se miden aca:
#   packages/media   el pipeline: 3 variantes, techos de bytes, keys opacas, master privado.
#   apps/web         el camino del panel a ese pipeline: alta de unidad con foto, byte servido.
#
# M1 pipeline medido por el LEAD     M2 la suite del paquete entera
# M3 el servido local NUNCA cruza al bucket privado (canarios vivos, dos polos)
# M4 la suite e2e entera + censo     M5 prohibiciones de siempre sobre lo que toco S2
#
# NOTA DE DISENO, la misma que en accept-s1.sh: los tiers vivos NO se pueden saltear. Un gate que
# pasa en verde porque nadie levanto el server es exactamente el modo de falla contra el que
# existe este archivo. Sin server, M3 y M4 FALLAN.
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0
sec()  { printf '\n\033[1m── %s\033[0m\n' "$1"; }
ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
no()   { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=1; }
inf()  { printf '  \033[36m····\033[0m  %s\n' "$1"; }
# --exclude-dir NO es cosmetico: `grep -r apps/web` entra a `.next/` y a `node_modules/`, y ahi un
# sourcemap de 4MB matchea cualquier cosa. La primera corrida de este gate (2026-08-27) dio un
# falso positivo de "URL de R2 armada a mano" apuntando a un `.js.map` de drizzle. Un gate que
# grita por artefactos de build se apaga solo: la proxima persona lo ignora.
# `git check-ignore` y no una lista de extensiones: lo que git ignora es artefacto de build, y lo
# que no, es codigo nuestro AUNQUE todavia no este en el indice. Esa segunda mitad importa: los
# archivos de una slice recien escrita estan sin `git add`, y filtrar por "trackeado" los saltearia
# justo cuando hay que auditarlos. Motivo real: `apps/web/tsconfig.tsbuildinfo` lista cada archivo
# del repo, asi que hacia MATCH con cualquier patron y M5 daba FAIL contra un artefacto (2026-08-27).
none() { local d="$1" re="$2"; shift 2
  local o; o=$(grep -rnE --exclude-dir=.next --exclude-dir=node_modules --exclude-dir=dist \
      --exclude-dir=.turbo --exclude="*.map" "$re" "$@" 2>/dev/null \
      | grep -vE '^([^:]*:)?[0-9]+:[[:space:]]*(//|\*|/\*|#|--)' || true)
  local kept="" line f
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    f="${line%%:*}"
    git check-ignore -q "$f" 2>/dev/null && continue
    kept="${kept}${line}"$'\n'
  done <<< "$o"
  if [ -z "${kept//[$'\n\t ']/}" ]; then ok "$d"
  else no "$d"; echo "$kept" | sed 's/^/        /' | cut -c1-200 | head -6; fi; }

# `none()` filtra las lineas que ARRANCAN con marcador de comentario, y eso deja MUERTA a la unica
# regla cuyo hallazgo ES un comentario: un `TODO: despues el RLS` siempre esta comentado, asi que
# nunca podia fallar. Estuvo vacuamente en verde desde S1; lo encontro el LEAD el 2026-08-28
# corriendo la polaridad negativa del gate de S3 contra un fixture con el TODO textual adentro.
# `noneraw()` es el mismo grep sin ese filtro. Polaridad probada en los dos sentidos ese mismo dia.
noneraw() { local d="$1" re="$2"; shift 2
  local o; o=$(grep -rnE --exclude-dir=.next --exclude-dir=node_modules --exclude-dir=dist \
      --exclude-dir=.turbo --exclude="*.map" "$re" "$@" 2>/dev/null || true)
  local kept="" line f
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    f="${line%%:*}"
    git check-ignore -q "$f" 2>/dev/null && continue
    kept="${kept}${line}"$'\n'
  done <<< "$o"
  if [ -z "${kept//[$'\n\t ']/}" ]; then ok "$d"
  else no "$d"; echo "$kept" | sed 's/^/        /' | cut -c1-200 | head -6; fi; }

DBURL="${DATABASE_URL:-postgresql://localhost:5432/istock_dev}"
PORT="${E2E_PORT:-3100}"
MEDIA="packages/media"

# ─────────────────────────────────────────────────────────────────────────────
sec "M1 · el pipeline entrega lo que el board pide — medido por el LEAD, no leido"
# El probe vive en scripts/probes/ (columna del LEAD) y NO en packages/media/src/: si el gate
# escribiera dentro del paquete que audita, seria el mismo writer de las dos puntas. Los techos
# estan escritos a mano ahi adentro; leerlos de budgets.ts haria que subir la constante ponga el
# gate en verde. Probado en las dos polaridades el 2026-08-27: con techo de card en 10KB, rojo.
PROBE=$(mktemp)
if pnpm --filter @istock/media exec vitest run --root ../.. scripts/probes/s2-media-measure.test.ts \
     >"$PROBE" 2>&1; then
  grep -oE 'MEDIDO [a-z]+=[0-9]+B techo=[0-9]+B [0-9]+x[0-9]+' "$PROBE" | sort | while read -r l; do inf "$l"; done
  # El master se mide con otra forma (no tiene NxN: no es una variante servible) y por eso el
  # grep de arriba no lo agarraba. Sin esta linea el objeto MAS PESADO del producto — el 62,7%
  # de los bytes guardados — era el unico cuyo numero el LEAD no veia, aunque el probe si lo
  # asertara. Un techo que nadie lee es un techo que nadie nota cuando se acerca.
  grep -oE 'MEDIDO master=.*' "$PROBE" | head -1 | while read -r l; do inf "$l"; done
  grep -qE 'Tests +4 passed \(4\)' "$PROBE" \
    && ok "4/4: 3 variantes, ningun techo pasado, keys opacas, master fuera del bucket publico" \
    || no "el probe no corrio los 4 chequeos (ver salida)"
else
  no "el probe del LEAD fallo"; grep -E 'AssertionError|expected|FAIL' "$PROBE" | head -8 | sed 's/^/        /'
fi
rm -f "$PROBE"

# Segunda sonda del LEAD: que el SEED emita masters con la forma que packages/media exige.
# Existe porque el defecto real de esta slice fue justamente ese —`seedMasterKey` emitia
# `originals/{2hex}/{32hex}.jpg`, ni la forma ni la extension— y estuvo VERDE todo el tiempo:
# hoy nadie lee esa key, asi que ningun test de ninguna de las dos columnas la miraba.
#
# A diferencia de los techos de bytes, aca el regex se LEE del fuente de `packages/media/src/keys.ts`
# en vez de copiarse. La logica es la opuesta y a proposito: un techo copiado impide que subir la
# constante ponga el gate en verde; un contrato entre dos paquetes tiene que gritar cuando las dos
# puntas se separan, y para eso hay que leer la punta real. Copiarlo aca solo agregaria una tercera
# version del regex para mantener.
#
# Polaridad probada el 2026-08-27: la forma vieja NO matchea el regex real, la nueva SI.
PROBE2=$(mktemp)
if pnpm --filter @istock/db exec vitest run --root ../.. scripts/probes/s2-seed-master-key.test.ts \
     >"$PROBE2" 2>&1; then
  grep -oE 'MEDIDO seedMasterKey -> .*' "$PROBE2" | head -1 | while read -r l; do inf "$l"; done
  grep -qE 'Tests +3 passed \(3\)' "$PROBE2" \
    && ok "el seed emite masters con la forma de ADR-006, y tenant/listing en ese orden" \
    || no "la sonda del seed no corrio sus 3 chequeos (ver salida)"
else
  no "la sonda del seed fallo"; grep -E 'AssertionError|expected|FAIL' "$PROBE2" | head -8 | sed 's/^/        /'
fi
rm -f "$PROBE2"

# ─────────────────────────────────────────────────────────────────────────────
sec "M2 · la suite de packages/media entera"
# Verifico el nombre del script ANTES de correrlo: pnpm no-opea con exit 0 cuando el script no
# existe, y un gate que se cree su propio no-op es peor que no tener gate (me paso en A6 de S1).
if node -e "process.exit(require('./$MEDIA/package.json').scripts?.test?0:1)" 2>/dev/null; then
  MOUT=$(mktemp)
  if pnpm --filter @istock/media test >"$MOUT" 2>&1; then
    inf "$(grep -oE 'Tests +[0-9]+ passed \([0-9]+\)' "$MOUT" | tail -1)"
    ok "la suite de packages/media termino en verde"
  else
    no "la suite de packages/media fallo"; tail -20 "$MOUT" | sed 's/^/        /'
  fi
  rm -f "$MOUT"
else
  no "$MEDIA/package.json no expone el script 'test': el gate correria un no-op con exit 0"
fi

# ─────────────────────────────────────────────────────────────────────────────
sec "M4 · la suite e2e entera + censo (el camino del panel a la foto)"
# Va antes que M3 a proposito: hace el build una sola vez y M3 reusa el .next resultante.
if node -e "process.exit(require('./e2e/package.json').scripts?.e2e?0:1)" 2>/dev/null; then
  SPECS=$(ls e2e/*.spec.ts 2>/dev/null | wc -l | tr -d ' ')
  inf "specs en e2e/: $SPECS"
  EOUT=$(mktemp)
  # Sin --reporter: en la CLI REEMPLAZA los reporters del config y apaga el censo de qa-agent.
  if pnpm --filter @istock/e2e e2e >"$EOUT" 2>&1; then E2ERC=0; else E2ERC=1; fi
  # NO se cuenta "el nombre del spec aparece en la salida". Cuando el censo FALLA imprime el
  # nombre de cada spec que NO corrio, asi que ese conteo daba 8/8 y el gate salia PASS con CERO
  # tests ejecutados — el texto que probaba que corrieron era el que decia que no. Paso el
  # 2026-08-27 con el build roto. La unica fuente es la linea del censo, que la emite el reporter
  # de `qa-agent` (otra columna: el gate no se mide con su propio codigo).
  # La linea de DATOS del censo, no el banner de fallo. El reporter, cuando algo no corre, escribe
  # ademas `✖ CENSO DE SPECS: quedo codigo de test sin ejecutar.` — con `-i` y `tail -1` ese banner
  # ganaba, y el gate reportaba "el censo cambio de formato" cuando el censo estaba perfecto.
  # Exigir `archivos ejecutados` ata el match a la linea que trae los numeros.
  CENSO=$(grep -E 'censo de specs: .*archivos ejecutados' "$EOUT" | tail -1 || true)
  if [ -z "$CENSO" ]; then
    no "sin linea de censo: no puedo saber cuantos specs corrieron, y NO cuento por nombre de archivo"
    inf "si el censo desaparecio, o se corrio con --reporter (lo pisa) o E2E_ALLOW_PARTIAL=1 lo apago"
  else
    inf "$(echo "$CENSO" | sed 's/^[[:space:]]*//')"
    RAN=$(echo "$CENSO" | sed -nE 's|.*[^0-9]([0-9]+)/([0-9]+) archivos ejecutados.*|\1|p')
    TOT=$(echo "$CENSO" | sed -nE 's|.*[^0-9]([0-9]+)/([0-9]+) archivos ejecutados.*|\2|p')
    if [ -z "$RAN" ] || [ -z "$TOT" ]; then
      no "la linea del censo cambio de formato y no puedo leer los numeros — arreglar el gate, no el censo"
    elif [ "$RAN" = "$TOT" ] && [ "$RAN" != "0" ] && [ "$TOT" = "$SPECS" ]; then
      ok "los $SPECS specs se ejecutaron (segun el censo, no segun el texto de la salida)"
    else
      no "el censo dice $RAN/$TOT archivos ejecutados y en disco hay $SPECS: la suite no corrio entera"
    fi
    # El censo emite ahora tres numeros y no uno, porque el viejo MENTIA: Playwright le fabrica un
    # TestResult con status 'skipped' al test que saltea por un fallo previo, asi que la version
    # anterior (`results.length > 0`) lo contaba como ejecutado. Medido el 2026-08-27: Playwright
    # imprimio "8 did not run" y el censo imprimio "63/63 tests ejecutados" y este gate dio PASS.
    # Un guard que afirma algo falso es peor que no tenerlo: entrena a leerlo mal.
    SALT=$(echo "$CENSO" | sed -nE 's|.*· ([0-9]+) salteados por un fallo previo.*|\1|p')
    if [ -z "$SALT" ]; then
      no "el censo no informa cuantos tests quedaron salteados por un fallo previo — arreglar el gate, no el censo"
    elif [ "$SALT" = "0" ]; then
      ok "ningun test quedo salteado por un fallo previo"
    else
      no "$SALT test(s) no llegaron a evaluar una sola asercion: los saltearon fallos anteriores"
    fi
  fi
  if [ "$E2ERC" = "0" ]; then ok "la suite e2e termino en verde"
  else
    no "la suite e2e fallo"
    # Los titulos de los tests en rojo, que es lo primero que hace falta. Playwright los numera
    # "  1) archivo.spec.ts:LINEA:COL > titulo" en el resumen del final.
    grep -aE '^[[:space:]]+[0-9]+\) .*spec\.ts' "$EOUT" | cut -c1-200 | head -10 | sed 's/^/        /'
    # Y el motivo cuando lo que reventó fue la infra (webServer), no una asercion: ahi el tail son
    # 30 lineas de traza de modulos y el mensaje real queda arriba, invisible.
    grep -aE 'Error:|⨯|Failed to compile|was not able to start' "$EOUT" \
      | grep -av tsbuildinfo | cut -c1-200 | head -6 | sed 's/^/        /'
    tail -6 "$EOUT" | cut -c1-200 | sed 's/^/        /'
    # El log COMPLETO se conserva: un gate que falla y borra la evidencia obliga a re-correr la
    # suite entera (2 min + build) para ver que fallo. Paso el 2026-08-27.
    KEEP="${TMPDIR:-/tmp}/accept-s2-e2e-$$.log"; cp "$EOUT" "$KEEP" 2>/dev/null \
      && inf "salida completa de la suite: $KEEP"
  fi
  # El spec de S2 tiene que EXISTIR en disco. Que haya corrido ya lo garantiza el censo de arriba.
  ls e2e/s2-*.spec.ts >/dev/null 2>&1 \
    && ok "hay specs de S2 en disco ($(ls e2e/s2-*.spec.ts | wc -l | tr -d ' '))" \
    || no "no hay spec de S2: la mitad del panel quedo sin medir"
  rm -f "$EOUT"
else
  no "e2e/package.json no expone el script 'e2e'"
fi

# ─────────────────────────────────────────────────────────────────────────────
sec "M3 · el servido local NUNCA cruza al bucket privado (canarios vivos, dos polos)"
# El master vive en `originals` (privado) y la variante publica en `media`. El chequeo por grep
# de "la ruta lee el bucket publico" no prueba nada: lo que prueba es plantar un objeto en CADA
# bucket con el MISMO driver local que usa el server y pedir los dos por HTTP.
#   canario en `media`      -> 200, image/webp, Cache-Control inmutable   (polo positivo)
#   canario en `originals`  -> NO 200                                     (polo negativo)
# Sin el polo positivo, el tier se satisface apagando la ruta entera.
MROOT=$(mktemp -d)
K_PUB="v1/aa/$(printf 'a%.0s' {1..32}).webp"
K_PRIV="v1/bb/$(printf 'b%.0s' {1..32}).webp"
mkdir -p "$MROOT/media/v1/aa" "$MROOT/originals/v1/bb"
# WebP minimo valido (RIFF/WEBP), suficiente para que el canario sea un byte real y no un .txt.
printf 'RIFF$\000\000\000WEBPVP8L\027\000\000\000/\000\000\000\020\007\020\021\021\210\210\376\007\000' > "$MROOT/media/v1/aa/$(basename "$K_PUB")"
cp "$MROOT/media/v1/aa/$(basename "$K_PUB")" "$MROOT/originals/v1/bb/$(basename "$K_PRIV")"

SPORT="$PORT"
while lsof -nP -iTCP:"$SPORT" -sTCP:LISTEN -t >/dev/null 2>&1; do SPORT=$((SPORT+1)); done
inf "levantando server propio en :$SPORT con MEDIA_LOCAL_ROOT=$MROOT"
BOOT=""
if [ -d apps/web/.next ]; then
  NODE_ENV=test DATABASE_URL="$DBURL" AUTH_DRIVER=local MEDIA_DRIVER=local MEDIA_LOCAL_ROOT="$MROOT" \
    AUTH_LOCAL_SECRET="${AUTH_LOCAL_SECRET:-e2e-local-secret-32-chars-minimum}" \
    pnpm --filter @istock/web exec next start -p "$SPORT" >/tmp/accept-s2-start.log 2>&1 &
  BOOT=$!
  for _ in $(seq 1 60); do curl -sf -m 2 "http://127.0.0.1:${SPORT}/api/health" >/dev/null 2>&1 && break; sleep 1; done
else
  no "no hay apps/web/.next: M4 tenia que haber dejado un build. M3 no puede medir."
fi

if curl -sf -m 5 "http://127.0.0.1:${SPORT}/api/health" >/dev/null 2>&1; then
  HDR=$(mktemp)
  CODE=$(curl -s -o /dev/null -D "$HDR" -w '%{http_code}' -m 10 "http://127.0.0.1:${SPORT}/_media/${K_PUB}" || echo 000)
  if [ "$CODE" = "200" ]; then
    ok "polo positivo: la variante publica se sirve (HTTP 200)"
    grep -qi 'content-type:.*image/webp' "$HDR" && ok "sale como image/webp" || no "el Content-Type no es image/webp"
    grep -qi 'cache-control:.*immutable' "$HDR" && ok "sale con Cache-Control inmutable" \
      || no "sin Cache-Control inmutable: cada pageview vuelve a pedir el byte"
  else
    no "polo positivo: la variante publica devolvio $CODE — la ruta /_media no sirve nada"
  fi
  CODEP=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "http://127.0.0.1:${SPORT}/_media/${K_PRIV}" || echo 000)
  if [ "$CODEP" = "200" ]; then
    no "EL MASTER ES ALCANZABLE POR HTTP ($CODEP): la ruta cruza al bucket privado. Rechazo (CLAUDE.md §2)"
  else
    ok "polo negativo: la key del bucket privado devuelve $CODEP, no 200"
  fi

  # ── tercer polo: la MISMA key bajo un host de TENANT ───────────────────────────────────────────
  #
  # Por que existe: hasta S2 el camino de `/_media` quedaba fuera del `matcher` del proxy (las
  # fotos son `.webp`, uno de los sufijos excluidos). Al meterlo adentro aparecio un riesgo nuevo y
  # peor que el que se arreglaba: sobre `acme.maat.work`, `/_media/...` cae en la rama `storefront`
  # y se reescribe a `/s/acme/_media/...`, que no es ruta de nada — o sea **todas las fotos de
  # todas las vidrieras rotas**. La guarda es una rama de passthrough antes de resolver el host.
  #
  # Los dos polos de arriba pegan contra el apex y **no verian** esa regresion: es exactamente el
  # agujero que `storefront-agent` reporto de su propio trabajo. Un gate que solo mira el apex
  # certifica una slice cuya mitad interesante vive en los subdominios.
  #
  # Y no alcanza con "200": el byte tiene que ser **el mismo**. La key es content-addressed (ADR-006),
  # asi que dos tenants comparten el objeto; si bajo un host de tenant saliera otro contenido, eso
  # seria una pertenencia por tenant que el esquema no tiene.
  #
  # El `Host` se manda a mano en vez de resolver por DNS: el server de M3 corre en un puerto libre,
  # pero el bundle lo baked M4 con el root domain de `e2e/_lib/env.ts`. Por eso el host que se manda
  # es ese y no el puerto real — el proxy lee el header, no el socket.
  TENANT_HOST="acme.${E2E_APEX_HOST:-127.0.0.1.nip.io}:${E2E_PORT:-3100}"
  B_APEX=$(mktemp); B_TEN=$(mktemp)
  curl -s -o "$B_APEX" -m 10 "http://127.0.0.1:${SPORT}/_media/${K_PUB}" >/dev/null 2>&1 || true
  CODET=$(curl -s -o "$B_TEN" -w '%{http_code}' -m 10 \
    -H "Host: ${TENANT_HOST}" "http://127.0.0.1:${SPORT}/_media/${K_PUB}" || echo 000)
  if [ "$CODET" != "200" ]; then
    no "tercer polo: la misma foto bajo el host de tenant ($TENANT_HOST) devolvio $CODET, no 200 — el proxy la esta reescribiendo a /s/{slug}/_media/... y las vidrieras quedan sin fotos"
  elif cmp -s "$B_APEX" "$B_TEN"; then
    ok "tercer polo: la misma key sirve los mismos bytes por apex y por host de tenant"
  else
    no "tercer polo: la misma key devuelve BYTES DISTINTOS por apex y por tenant — la key es content-addressed, no puede depender del host"
  fi
  rm -f "$B_APEX" "$B_TEN"

  rm -f "$HDR"
else
  no "no hay server en :$SPORT — M3 no corrio, y sin medir el servido no hay aceptacion de S2"
  tail -10 /tmp/accept-s2-start.log 2>/dev/null | sed 's/^/        /'
fi
[ -n "$BOOT" ] && kill "$BOOT" 2>/dev/null
rm -rf "$MROOT"

# ─────────────────────────────────────────────────────────────────────────────
sec "M5 · prohibiciones de siempre sobre lo que toco S2"
none "nadie fuera de packages/media importa el cliente de S3" \
     "@aws-sdk/client-s3" apps/web packages/domain packages/db packages/ai
# `--exclude=*.test.ts` por el mismo motivo que en A7 de S1: `packages/domain/src/dto.test.ts` usa
# `https://img.maat.work/...` como FIXTURE de entrada de `publicListingDTO`. Un grep no distingue
# "arma una URL de CDN" de "recibe una URL de CDN ya armada", y el precio de fingir que si es que
# alguien reescriba el fixture para pasar el gate. El codigo servido lo cubre igual.
none "nadie fuera de packages/media arma una URL de R2/CDN a mano" \
     "r2\.cloudflarestorage\.com|img\.maat\.work" --exclude="*.test.ts" \
     apps/web packages/domain packages/db packages/ai
none "ningun DeleteObjectCommand fuera de la recoleccion de huerfanos" \
     "DeleteObjectCommand" apps/web packages/domain packages/db packages/ai
none "sin console.log de un listing" "console\.log\([^)]*(listing|unit|producto|photo|foto)" apps/web/app packages
none "sin imei/cost/margin/notas internas en (storefront)" \
     "\b(imei|cost_?usd|costUsd|margin|internal_?notes|internalNotes|supplier)\b" \
     --exclude="*.test.ts" "apps/web/app/(storefront)"
# `--exclude=*lint*.mjs`: los linters de packages/db y packages/media DEFINEN esta misma regla y
# por lo tanto contienen el patron en su propio codigo. Un gate que marca en rojo al guard que
# impone la regla del gate no esta midiendo nada.
noneraw "sin 'despues el RLS/R2/cache' (noneraw: el hallazgo ES un comentario)" \
     "(TODO|FIXME|XXX)[^\n]*(RLS|R2|cache|caché|despu)" \
     --exclude="*lint*.mjs" apps/web/app packages
# Vercel Image Optimization se paga por transformacion y el byte ya viene del tamano correcto.
none "sin next/image sobre las URLs del pipeline (se paga por transformacion)" \
     "from 'next/image'" "apps/web/app/(storefront)" "apps/web/app/(app)"

# ─────────────────────────────────────────────────────────────────────────────
sec "M6 · el modo de servido de cada ruta es el que se midio"
# Va al final a proposito: lee el `.next` que dejo el build de la suite e2e de M4, asi que no
# cuesta un build extra pero EXIGE que M4 haya buildeado. Si M4 no corrio, esto lo dice y falla.
#
# El invariante caro no es el drift, es la primera linea de `guard-routes.sh`: una ruta de
# `/app/*` prerenderizada es panel autenticado horneado en un archivo estatico. Ningun test de
# RLS lo ve —la policy no llega a evaluarse— y ningun e2e logueado lo ve —pide con sesion.
if [ -x scripts/guard-routes.sh ]; then
  if OUT=$(./scripts/guard-routes.sh 2>&1); then
    echo "$OUT" | grep -E '^PASS' | while IFS= read -r l; do ok "${l#PASS }"; done
  else
    echo "$OUT" | grep -E '^FAIL' | while IFS= read -r l; do echo "        ${l}"; done
    no "el modo de servido de alguna ruta cambio sin que nadie lo decidiera"
  fi
else
  no "falta scripts/guard-routes.sh"
fi

printf '\n'
if [ "$fail" = "0" ]; then printf '\033[1;32mS2: ACEPTADA\033[0m\n'
else printf '\033[1;31mS2: RECHAZADA\033[0m\n'; fi
exit "$fail"
