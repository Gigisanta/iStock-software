#!/usr/bin/env bash
# ACEPTACION DE S3 — la re-ejecuta el LEAD, no el agente que escribio el codigo (CLAUDE.md regla 2).
#
# Gate del board (docs/SLICE_BOARD.md): "los 15 campos de la skill `storefront-ficha`; cero campos
# prohibidos en el HTML". Mas el requisito P3, que es previo a la implementacion y no posterior.
#
# ESTE ARCHIVO NACE EN ROJO Y ESO ES EL PUNTO.
# Se escribe ANTES de S3 porque P3 lo pide asi: "el criterio de aceptacion de S3 mide el
# transferSize del recurso que el browser ELIGIO". Un criterio de byte escrito despues de la
# implementacion se acomoda a lo que la implementacion ya hace. Escrito antes, la implementacion se
# acomoda al criterio. Hoy `apps/web/app/(storefront)/` tiene el proxy, el miss y `s/[slug]`: no hay
# ficha, no hay grilla y no hay un solo `srcSet` en el repo.
#
# M1 P3 estatico: ningun `srcset` sin `sizes`   M2 P3 vivo: el byte que el browser ELIGIO
# M3 los campos de la ficha, leidos del HTML servido, no del fuente
# M4 cero campos prohibidos EN LOS BYTES (imei/costo/margen/notas/proveedor del seed)
# M5 cero hits a Postgres en el caso cacheado   M6 prohibiciones de siempre sobre lo que toco S3
#
# DOS MEDICIONES LAS EMITE `qa-agent`, NO ESTE SCRIPT, y a proposito: necesitan un browser real y un
# contador de queries, o sea el arnes de e2e. `qa-agent` es otra columna que `storefront-agent`, asi
# que la independencia del gate se mantiene. Este script SOLO lee las lineas y **falla si no estan**
# — nunca pasa por ausencia, que es la regla que ya salvo al censo de specs de S2.
#
#   MEDIDO s3 imagen · viewport=390x844 dpr=3 · elegido=<url> · transferSize=<N>B · techo=204800B
#   MEDIDO s3 db-hits · ruta=<path> · primera=<N> · cacheada=<N>
#
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0
sec()  { printf '\n\033[1m── %s\033[0m\n' "$1"; }
ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
no()   { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=1; }
inf()  { printf '  \033[36m····\033[0m  %s\n' "$1"; }
# Mismo `none()` que accept-s2.sh (T4 del board lo va a extraer a scripts/_lib.sh; hasta entonces
# se duplica a proposito y no se "simplifica": un gate que importa de otro gate se rompe de a dos).
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

# `none()` descarta las lineas que ARRANCAN con marcador de comentario, para que una regla como
# "cero imei" no grite contra un comentario que explica por que no hay imei. Correcto para todas las
# reglas menos una: **un `TODO: despues el RLS` vive SIEMPRE dentro de un comentario**, asi que esa
# regla quedaba filtrada por el propio helper y no podia fallar nunca. Descubierto el 2026-08-28
# corriendo la polaridad negativa de este gate contra un fixture: el archivo tenia el TODO textual y
# la regla dio PASS. Estaba igual de muerta en accept-s1.sh y accept-s2.sh desde S1, o sea que
# llevaba dos slices en verde sin poder distinguir un arbol limpio de uno sucio.
# `noneraw()` es el mismo grep SIN el filtro de comentarios. Es para reglas cuyo hallazgo ES un comentario.
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
APEX="${E2E_APEX_HOST:-127.0.0.1.nip.io}"
SF="apps/web/app/(storefront)"
# El listing del seed. Se elige el que tiene TODOS los campos peligrosos cargados (imei, costo,
# proveedor, notas internas): si la ficha filtra algo, filtra aca.
L_SLUG="iphone-14-pro-256-grafito"

# ─────────────────────────────────────────────────────────────────────────────
sec "M1 · P3 estatico: ningun srcset sin sizes en la vidriera"
# Sin `sizes`, el browser asume `sizes="100vw"`. Un telefono de 390px CSS con DPR 3 pide 1170px de
# ancho de recurso y elige `detail` (128.570 B) en vez de `card` (50.692 B): 2,5x del presupuesto,
# con el gate de S2 en verde porque S2 mide el byte GENERADO y no el DESCARGADO. Medido y fijado en
# `e2e/_lib/photo.ts:17-18`.
#
# El chequeo es sobre el TAG, no sobre el archivo: `grep srcSet` y `grep sizes` por separado darian
# verde con un `<img srcSet>` en una linea y un `sizes` en otro componente cien lineas abajo.
if [ -d "$SF" ]; then
  BAD=$(node -e '
    const fs=require("fs"),p=require("path");
    const root=process.argv[1]; const bad=[];
    const walk=d=>fs.readdirSync(d,{withFileTypes:true}).forEach(e=>{
      const f=p.join(d,e.name);
      if(e.isDirectory()) return walk(f);
      if(!/\.(tsx|ts)$/.test(e.name)||/\.test\.tsx?$/.test(e.name)) return;
      const s=fs.readFileSync(f,"utf8");
      for(const m of s.matchAll(/srcSet|srcset/g)){
        // Ventana del tag: hacia atras hasta el `<` que lo abre, hacia adelante hasta el `>`.
        const open=s.lastIndexOf("<",m.index); if(open<0) continue;
        let close=m.index, depth=0;
        for(;close<s.length;close++){ const c=s[close];
          if(c==="{")depth++; else if(c==="}")depth--; else if(c===">"&&depth<=0) break; }
        const tag=s.slice(open,close);
        if(!/\bsizes\b/.test(tag)) bad.push(f+":"+(s.slice(0,m.index).split("\n").length));
      }
    });
    walk(root); process.stdout.write(bad.join("\n"));
  ' "$SF" 2>/dev/null)
  if [ -n "$BAD" ]; then
    no "hay srcset sin sizes: el browser va a pedir 'detail' (2,5x el presupuesto) en cada card"
    echo "$BAD" | head -8 | sed 's/^/        /'
  else
    N=$(grep -rlE 'srcSet|srcset' "$SF" --include='*.tsx' 2>/dev/null | wc -l | tr -d ' ')
    if [ "$N" = "0" ]; then
      inf "todavia no hay ningun srcset en la vidriera (S3 sin implementar): la regla no se probo"
      ok "cero srcset sin sizes (vacuo — se vuelve real cuando S3 renderice imagenes)"
    else
      ok "los srcset de la vidriera ($N archivo/s) llevan sizes explicito"
    fi
  fi
else
  no "no existe $SF"
fi

# ─────────────────────────────────────────────────────────────────────────────
sec "M2 · P3 vivo: el byte que el BROWSER eligio, no el que el pipeline genero  ·  + M5 db-hits"
# Una sola corrida de la suite e2e: deja el build que M3/M4 reusan y emite las dos lineas MEDIDO.
EOUT=$(mktemp)
if node -e "process.exit(require('./e2e/package.json').scripts?.e2e?0:1)" 2>/dev/null; then
  # Sin --reporter: en la CLI REEMPLAZA los reporters del config y apaga el censo de qa-agent.
  if pnpm --filter @istock/e2e e2e >"$EOUT" 2>&1; then E2ERC=0; else E2ERC=1; fi
  [ "$E2ERC" = "0" ] && ok "la suite e2e termino en verde" || {
    no "la suite e2e fallo"
    grep -aE '^[[:space:]]+[0-9]+\) .*spec\.ts' "$EOUT" | cut -c1-200 | head -8 | sed 's/^/        /'
    KEEP="${TMPDIR:-/tmp}/accept-s3-e2e-$$.log"; cp "$EOUT" "$KEEP" 2>/dev/null && inf "salida completa: $KEEP"; }
else
  no "e2e/package.json no expone el script 'e2e'"; E2ERC=1
fi

# ── el byte elegido ──────────────────────────────────────────────────────────
IMG=$(grep -aoE 'MEDIDO s3 imagen · .*' "$EOUT" | head -1 || true)
if [ -z "$IMG" ]; then
  no "no hay linea 'MEDIDO s3 imagen': el gate NO puede pasar por ausencia de medicion (P3)"
  inf "la emite un spec de qa-agent con Playwright, viewport 390x844 dpr 3, leyendo"
  inf "performance.getEntriesByType('resource') del recurso que el browser realmente pidio."
  inf "Formato: MEDIDO s3 imagen · viewport=390x844 dpr=3 · elegido=<url> · transferSize=<N>B · techo=204800B"
else
  inf "$IMG"
  GOT=$(echo "$IMG" | sed -nE 's/.*transferSize=([0-9]+)B.*/\1/p')
  CAP=$(echo "$IMG" | sed -nE 's/.*techo=([0-9]+)B.*/\1/p')
  if [ -z "$GOT" ] || [ -z "$CAP" ]; then
    no "la linea MEDIDO s3 imagen cambio de formato y no puedo leer los numeros — arreglar el gate"
  elif [ "$GOT" -le "$CAP" ]; then
    ok "el recurso que el browser eligio pesa ${GOT}B y el techo de la grilla es ${CAP}B"
  else
    no "el browser bajo ${GOT}B y el techo es ${CAP}B — falta 'sizes', o la grilla sirve 'detail'"
  fi
  # Que el elegido NO sea la variante grande. El numero solo no alcanza: una foto chica puede pasar
  # el techo AUNQUE la grilla este pidiendo `detail`, y el dia que entre una foto pesada revienta.
  echo "$IMG" | grep -q 'elegido=[^ ]*detail' \
    && no "el browser eligio la variante 'detail' en la grilla: eso es exactamente P3" \
    || ok "el recurso elegido no es la variante 'detail'"
fi

# ── M5, que viaja en la misma corrida ────────────────────────────────────────
DBH=$(grep -aoE 'MEDIDO s3 db-hits · .*' "$EOUT" | head -1 || true)
if [ -z "$DBH" ]; then
  no "no hay linea 'MEDIDO s3 db-hits': sin ella no se puede afirmar el 95% sin Postgres (CLAUDE.md §3)"
  inf "Formato: MEDIDO s3 db-hits · ruta=<path> · primera=<N> · cacheada=<N>"
else
  inf "$DBH"
  CACHED=$(echo "$DBH" | sed -nE 's/.*cacheada=([0-9]+).*/\1/p')
  FIRST=$(echo "$DBH" | sed -nE 's/.*primera=([0-9]+).*/\1/p')
  if [ -z "$CACHED" ] || [ -z "$FIRST" ]; then
    no "la linea MEDIDO s3 db-hits cambio de formato — arreglar el gate"
  elif [ "$CACHED" = "0" ] && [ "$FIRST" != "0" ]; then
    ok "la ficha cacheada hace 0 queries (la primera hizo $FIRST): el hit no toca Postgres"
  elif [ "$FIRST" = "0" ]; then
    no "primera=0: el contador de queries no esta contando nada, la medicion es vacua"
  else
    no "la ficha cacheada hace $CACHED queries: cada pageview pega a Postgres (rompe el 95%)"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
sec "M3/M4 · la ficha, leida de los BYTES servidos (server vivo bajo host de tenant)"
# Se mide el HTML que sale por HTTP, no el .tsx. Un `publicListingDTO` correcto no prueba nada si el
# componente igual imprime el objeto crudo en un `data-*` o en el payload de RSC del final del body.
SPORT="$PORT"
while lsof -nP -iTCP:"$SPORT" -sTCP:LISTEN -t >/dev/null 2>&1; do SPORT=$((SPORT+1)); done
BOOT=""
if [ -d apps/web/.next ]; then
  NODE_ENV=test DATABASE_URL="$DBURL" AUTH_DRIVER=local MEDIA_DRIVER=local \
    AUTH_LOCAL_SECRET="${AUTH_LOCAL_SECRET:-e2e-local-secret-32-chars-minimum}" \
    pnpm --filter @istock/web exec next start -p "$SPORT" >/tmp/accept-s3-start.log 2>&1 &
  BOOT=$!
  for _ in $(seq 1 60); do curl -sf -m 2 "http://127.0.0.1:${SPORT}/api/health" >/dev/null 2>&1 && break; sleep 1; done
else
  no "no hay apps/web/.next: M2 tenia que haber dejado un build. M3/M4 no pueden medir."
fi

HTML=$(mktemp); GRID=$(mktemp)
if curl -sf -m 5 "http://127.0.0.1:${SPORT}/api/health" >/dev/null 2>&1; then
  H="demo.${APEX}:${PORT}"
  GCODE=$(curl -s -o "$GRID" -w '%{http_code}' -m 15 -H "Host: $H" "http://127.0.0.1:${SPORT}/" || echo 000)
  [ "$GCODE" = "200" ] && ok "la grilla de demo responde 200 bajo $H" \
    || no "la grilla de demo devolvio $GCODE bajo $H"

  # La URL de la ficha NO se hardcodea: se saca del href de la grilla. Asi el gate no le impone a
  # `storefront-agent` una forma de URL, y ademas prueba que la grilla LINKEA a la ficha — que es
  # medio producto: una grilla que no linkea no lleva a nadie al boton de WhatsApp.
  HREF=$(grep -aoE 'href="[^"]*'"$L_SLUG"'[^"]*"' "$GRID" | head -1 | sed 's/^href="//;s/"$//')
  if [ -z "$HREF" ]; then
    no "la grilla no linkea a '$L_SLUG': sin href no hay ficha que medir (ni camino al wa.me)"
    inf "grep de control — cuantos href de la grilla apuntan a algo: $(grep -acoE 'href="/' "$GRID" || echo 0)"
  else
    inf "ficha segun la grilla: $HREF"
    FCODE=$(curl -s -o "$HTML" -w '%{http_code}' -m 15 -H "Host: $H" "http://127.0.0.1:${SPORT}${HREF}" || echo 000)
    [ "$FCODE" = "200" ] && ok "la ficha responde 200" || no "la ficha devolvio $FCODE"
  fi
else
  no "el server no levanto: no puedo medir el HTML servido (ver /tmp/accept-s3-start.log)"
fi

# ── M3 · los campos que S3 trae, uno por uno, contra el HTML ─────────────────
# Los strings salen del seed (`packages/db/src/seed-data.ts`, listing 201) y por eso son
# infalsificables: no hay forma de "pasar" el chequeo sin renderizar el dato de esa fila.
campo() { grep -aqF "$2" "$HTML" && ok "campo: $1" || no "campo FALTANTE en la ficha: $1  ($2)"; }
if [ -s "$HTML" ]; then
  FOTOS=$(grep -aoE '(src|srcSet)="[^"]*/_media/[^"]*"' "$HTML" | sort -u | wc -l | tr -d ' ')
  [ "$FOTOS" -ge 3 ] && ok "campo: 3 fotos reales (hay $FOTOS)" \
    || no "campo: la ficha muestra $FOTOS foto(s) y el minimo del producto es 3"
  campo "condicion (registro de ficha, no el de WhatsApp)" "usado excelente"
  campo "capacidad GB"        "256"
  campo "color"               "Negro espacial"
  campo "procedencia"         "Compra directa a cliente en Cipolletti"
  campo "bateria %"           "89"
  campo "iCloud (texto explicito)" "Libre de iCloud, verificado en el local"
  campo "garantia"            "90 días de garantía del local"
  campo "precio USD"          "USD"
  grep -aqiE 'pantalla original|pantalla:? *original' "$HTML" \
    && ok "campo: pantalla original" || no "campo FALTANTE en la ficha: pantalla original"
  grep -aqiE 'disponible|reservado|vendido' "$HTML" \
    && ok "campo: badge de stock/reserva" || no "campo FALTANTE en la ficha: badge de stock/reserva"
  # Los cuatro que faltaban. NO son agujero declarado: los cuatro TIENEN fuente de datos hoy y
  # estan sembrados, asi que S3 los renderiza o no pasa. El LEAD los habia diferido a S5/S8 por
  # error, y la correccion es del 2026-08-28, contra el schema real:
  #   ARS            `fx_settings` (arsPerUsd=148750 → 1487,50 · rounding=ceil_1000) + domain/fx.ts
  #   punto + horario `locations` (dos filas sembradas, con policy de anon para la vidriera)
  #   medios de pago  `tenants.payment_methods` (array de texto, cuatro sembrados)
  #   acepta canje    `tenants.accepts_trade_in` (true en el seed)
  # Lo que S5 agrega es la PANTALLA para que el dueño cambie el TC y el redondeo, no el dato.
  campo "punto de retiro"      "Local Neuquén centro"
  campo "horario del punto"    "lun a vie de 10 a 18"
  campo "segundo punto"        "Punto Cipolletti"
  campo "medios de pago"       "Transferencia ARS"
  grep -aqiE 'canje|permuta' "$HTML" \
    && ok "campo: acepta canje" || no "campo FALTANTE en la ficha: acepta canje (tenants.accepts_trade_in)"
  # ARS: se exige la MONEDA y que el numero publicado sea multiplo de 1000, que es lo que significa
  # `ceil_1000` en la practica. No se exige un importe exacto: fijarlo aca haria que el gate del
  # LEAD reimplemente `applyFx` y despues las dos cuentas se separen sin que nadie se entere.
  # El importe exacto lo prueba `packages/domain/src/fx.test.ts`, que es donde vive la funcion.
  if grep -aqE 'ARS|\$' "$HTML"; then
    ok "campo: precio ARS presente"
    grep -aqE '\.000([^0-9]|$)' "$HTML" \
      && ok "el ARS publicado termina en 000 (ceil_1000, el default del tenant)" \
      || no "hay ARS pero no termina en 000: el redondeo publicado no es ceil_1000"
  else
    no "campo FALTANTE en la ficha: precio ARS (fx_settings del tenant + domain/fx.ts)"
  fi
  # Y que la ficha diga que el ARS es informativo: es ratificacion del LEAD en FASE 2, la operacion
  # se cierra por WhatsApp. Sin ese texto el precio en pesos es una oferta y no lo es.
  grep -aqiE 'informativ|referencia|orientativ' "$HTML" \
    && ok "la ficha aclara que el ARS es informativo (ratificado en FASE 2)" \
    || no "el ARS se publica sin decir que es informativo (FASE 2: la operacion se cierra por WA)"
else
  no "sin HTML de ficha: los 15 campos quedaron sin medir"
fi

# ── M4 · cero campos prohibidos EN LOS BYTES ────────────────────────────────
# Este es el tier caro y va contra el HTML servido, incluido el payload de RSC que Next escribe al
# final del body: ahi es donde un objeto crudo se filtra sin aparecer en pantalla. Los valores son
# los del seed, o sea que un PASS aca significa "el dato existe en la base y NO salio", que es lo
# unico que interesa. Un grep del fuente daria verde con `{...listing}` en un componente cliente.
prohibido() { if grep -aqF "$2" "$HTML"; then
    no "FILTRA $1 en el HTML de la vidriera — rechazo (CLAUDE.md §2)"
    grep -aoF -m1 -B0 "$2" "$HTML" >/dev/null 2>&1
  else ok "cero $1 en el HTML"; fi; }
if [ -s "$HTML" ]; then
  prohibido "IMEI"           "353915107912345"
  prohibido "notas internas" "Entró por canje"
  prohibido "proveedor"      "Canje mostrador"
  # El costo, en las dos formas en que puede salir: centavos crudos del DTO y pesos formateados.
  prohibido "costo (centavos)" "5200000"
  prohibido "costo (formateado)" "52.000"
  # Y los NOMBRES de campo, que es como se filtra un objeto entero sin que se vea en pantalla.
  KEYS=$(grep -aoE '\b(imei|cost_?[uU]sd|margin|internal_?[nN]otes|supplier)\b' "$HTML" | sort -u | tr '\n' ' ')
  if [ -n "${KEYS// /}" ]; then
    no "aparecen claves prohibidas en el payload servido: $KEYS"
  else
    ok "ninguna clave prohibida aparece como nombre de campo en el payload"
  fi
else
  inf "sin HTML: M4 no corrio (y eso ya lo conto M3 como FAIL)"
fi
[ -n "$BOOT" ] && kill "$BOOT" 2>/dev/null
rm -f "$HTML" "$GRID" "$EOUT"

# ─────────────────────────────────────────────────────────────────────────────
sec "M6 · prohibiciones de siempre sobre lo que toco S3"
none "cero imei/cost/margin/notas internas en (storefront)" \
     '\b(imei|cost_?[uU]sd|margin|internal_?[nN]otes|supplier)\b' "$SF"
none "sin console.log de un listing/unit/row entero" \
     'console\.(log|info|debug)\((listing|unit|row|product|item)\b' "$SF"
noneraw "sin 'despues el RLS/R2/cache' (con noneraw: el hallazgo ES un comentario)" \
     '(TODO|FIXME|XXX)[^\n]*(RLS|R2|cache|caché|despu)' "$SF"
none "la vidriera no arma URLs de R2 a mano (eso es packages/media)" \
     'r2\.cloudflarestorage|\.r2\.dev' "$SF"
none "sin Realtime de Supabase en la vidriera (visitante anonimo, CLAUDE.md §3)" \
     'supabase.*channel\(|realtime' "$SF"
none "sin Image de next/image con loader por defecto (Vercel Image Optimization, prohibido)" \
     "from 'next/image'" "$SF"
none "PROHIBIDO revalidate:60 por default (x216 el costo)" \
     'revalidate\s*[:=]\s*60\b' "$SF"

# ─────────────────────────────────────────────────────────────────────────────
if [ "$fail" = "0" ]; then printf '\n\033[1;32mS3: ACEPTADA\033[0m\n'; else printf '\n\033[1;31mS3: RECHAZADA\033[0m\n'; fi
exit "$fail"
