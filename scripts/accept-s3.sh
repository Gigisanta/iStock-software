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
. scripts/_lib.sh   # sec/ok/no/inf/none/noneraw + el contador `fail`. Probado en scripts/_lib.test.sh

DBURL="${DATABASE_URL:-postgresql://localhost:5432/istock_dev}"
PORT="${E2E_PORT:-3100}"
APEX="${E2E_APEX_HOST:-127.0.0.1.nip.io}"
SF="apps/web/app/(storefront)"
# El listing del seed. Se elige el que tiene TODOS los campos peligrosos cargados (imei, costo,
# proveedor, notas internas): si la ficha filtra algo, filtra aca.
L_SLUG="iphone-14-pro-256-grafito"

# ── MODO FIXTURE ─────────────────────────────────────────────────────────────
# Existe por una sola razon: **poder ver fallar a M3 y M4**. Un gate que nunca se vio fallar no es un
# gate, y estas dos secciones necesitan un server vivo, o sea que en la practica no se ejercitaban
# nunca en la polaridad que importa. Con `S3_FIXTURE_FICHA` + `S3_FIXTURE_GRILLA` apuntando a dos
# HTML de mentira, M3/M4 leen esos archivos en vez de curl.
#
# NO es un bypass, y esto es lo que lo hace no serlo: **en modo fixture el script sale distinto de
# cero siempre**, aunque todas las reglas den verde. No se puede aceptar S3 con HTML inventado.
FIXTURE=0
if [ -n "${S3_FIXTURE_FICHA:-}" ] || [ -n "${S3_FIXTURE_GRILLA:-}" ]; then
  if [ ! -s "${S3_FIXTURE_FICHA:-}" ] || [ ! -s "${S3_FIXTURE_GRILLA:-}" ]; then
    echo "modo fixture: hacen falta S3_FIXTURE_FICHA y S3_FIXTURE_GRILLA, los dos y no vacios"; exit 2
  fi
  FIXTURE=1
fi

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
if [ "$FIXTURE" = "1" ]; then
  inf "MODO FIXTURE: no se corre la suite e2e (M2/M5 se ejercitan con su propio fixture de log)"
  E2ERC=0
  [ -n "${S3_FIXTURE_E2ELOG:-}" ] && [ -s "${S3_FIXTURE_E2ELOG:-}" ] && cat "$S3_FIXTURE_E2ELOG" >"$EOUT"
elif node -e "process.exit(require('./e2e/package.json').scripts?.e2e?0:1)" 2>/dev/null; then
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
if [ "$FIXTURE" = "1" ]; then
  inf "MODO FIXTURE: M1/M2/M5/M6 no aplican; M3/M4 leen archivos, no HTTP"
elif [ -d apps/web/.next ]; then
  NODE_ENV=test DATABASE_URL="$DBURL" AUTH_DRIVER=local MEDIA_DRIVER=local \
    AUTH_LOCAL_SECRET="${AUTH_LOCAL_SECRET:-e2e-local-secret-32-chars-minimum}" \
    pnpm --filter @istock/web exec next start -p "$SPORT" >/tmp/accept-s3-start.log 2>&1 &
  BOOT=$!
  for _ in $(seq 1 60); do curl -sf -m 2 "http://127.0.0.1:${SPORT}/api/health" >/dev/null 2>&1 && break; sleep 1; done
else
  no "no hay apps/web/.next: M2 tenia que haber dejado un build. M3/M4 no pueden medir."
fi

HTML=$(mktemp); GRID=$(mktemp)
if [ "$FIXTURE" = "1" ]; then
  cat "$S3_FIXTURE_FICHA" >"$HTML"; cat "$S3_FIXTURE_GRILLA" >"$GRID"
  inf "ficha=$S3_FIXTURE_FICHA  grilla=$S3_FIXTURE_GRILLA"
elif curl -sf -m 5 "http://127.0.0.1:${SPORT}/api/health" >/dev/null 2>&1; then
  # OJO: el puerto va de $SPORT, no de $PORT. `normalizeHostname` hace `split(':')` asi que
  # hoy da igual, pero un Host que miente sobre el puerto es una bomba de tiempo barata de sacar.
  H="demo.${APEX}:${SPORT}"
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
  # `256` a secas lo cumplia el SLUG (`iphone-14-pro-256-grafito`), que viaja en el href de la
  # propia pagina: el assert daba verde con la capacidad sin renderizar. `256 GB` es el string que
  # el comprador ve (`page.tsx:276` arma `${storageGb} GB`). Lo satisface tambien el title del
  # seed, y esta bien: el requisito de producto es que el GB SE VEA, y en el title se ve.
  campo "capacidad GB"        "256 GB"
  campo "color"               "Negro espacial"
  campo "procedencia"         "Compra directa a cliente en Cipolletti"
  # `89` a secas: dos digitos aparecen en cualquier UUID, build id o payload de RSC. El assert era
  # verde por accidente. `89%` es lo que renderiza `page.tsx:280`.
  campo "bateria %"           "89%"
  campo "iCloud (texto explicito)" "Libre de iCloud, verificado en el local"
  campo "garantia"            "90 días de garantía del local"
  # `USD` a secas lo cumplia el medio de pago `Efectivo USD`, que M3 ya exige mas abajo: el precio
  # podia faltar entero. `USD 620` es `formatUsd(usd(620))`, fijado en `money.test.ts:47`.
  campo "precio USD"          "USD 620"
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
  # `grep -aqE 'ARS|\$'` lo cumplia el medio de pago `Transferencia ARS`, que M3 exige tres lineas mas
  # arriba: o sea que el precio en pesos podia no renderizarse nunca y el gate pasaba igual. Ahora se
  # exige la FORMA de `formatArs` (`$ 923.000`, hand-rolled en `money.ts:73`, ASCII, sin Intl), que
  # ningun otro texto de la ficha produce. El IMPORTE exacto sigue sin fijarse a proposito: fijarlo
  # haria que este gate reimplemente `applyFx` y despues las dos cuentas se separan en silencio.
  if grep -aqE '\$ [0-9]{1,3}(\.[0-9]{3})+' "$HTML"; then
    ok "campo: precio ARS presente con la forma de formatArs"
    grep -aqE '\$ [0-9]{1,3}(\.[0-9]{3})*\.000([^0-9]|$)' "$HTML" \
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
prohibido() { local d="$1" aguja="$2" f="$3" donde="$4"
  if grep -aqF "$aguja" "$f"; then no "FILTRA $d en el HTML de la $donde — rechazo (CLAUDE.md §2)"
  else ok "cero $d en la $donde"; fi; }

# Los IMEI NO se hardcodean: se leen del seed. Son 15 digitos, unicos, cero falsos positivos, y son
# la regla mas dura del producto (CLAUDE.md §8: "IMEI nunca en vidriera"). Leerlos de la fuente hace
# que una fila nueva del seed quede cubierta el dia que se agrega, sin que nadie se acuerde de venir.
IMEIS=$(grep -aoE "imei: '[0-9]+'" packages/db/src/seed-data.ts 2>/dev/null | grep -aoE '[0-9]{10,}' | sort -u)
[ -z "$IMEIS" ] && no "no pude leer ningun IMEI del seed: el barrido de IMEI seria vacuo"

# M4 corre sobre la ficha Y sobre la GRILLA. Antes miraba solo la ficha, y la grilla renderiza las
# 10 filas: una fuga en el componente de card no la veia nadie. La fila 201 esta `available`, asi
# que sus datos peligrosos viajan a los dos documentos.
for PAR in "ficha:$HTML" "grilla:$GRID"; do
  DONDE="${PAR%%:*}"; DOC="${PAR#*:}"
  if [ ! -s "$DOC" ]; then no "sin HTML de $DONDE: M4 no pudo medir ahi"; continue; fi

  FUGA_IMEI=0
  for I in $IMEIS; do
    grep -aqF "$I" "$DOC" && { no "FILTRA el IMEI $I en la $DONDE — rechazo (CLAUDE.md §8)"; FUGA_IMEI=1; }
  done
  [ "$FUGA_IMEI" = "0" ] && ok "cero IMEI en la $DONDE ($(echo "$IMEIS" | wc -l | tr -d ' ') buscados)"

  prohibido "notas internas" "Entró por canje"   "$DOC" "$DONDE"
  prohibido "proveedor"      "Canje mostrador"   "$DOC" "$DONDE"
  # El costo de la fila 201, en las dos formas en que puede salir.
  #
  # ESTAS DOS REGLAS ESTABAN MUERTAS. Buscaban `5200000` y `52.000`, y el costo real es
  # `usd(520)` = 520 × CENTS_PER_UNIT = **52000** (`money.ts:19`), que se formatea `USD 520`
  # (`formatUsd`, fijado en `money.test.ts:47`). Ninguna de las dos cadenas viejas existe en
  # ningun HTML posible, asi que la regla que hace cumplir "seller no ve costo ni margen"
  # (CLAUDE.md §9) daba verde con el costo entero servido en el payload. Encontrado por el LEAD
  # el 2026-08-28 leyendo el seed en vez de leer el gate.
  #
  # Ningun precio del seed es 520, asi que `USD 520` no puede aparecer legitimamente. (Ojo con el
  # de al lado: el costo 470 de la fila 206 SI colisiona con el precio 470 de la 208, por eso el
  # barrido es sobre el costo de 201 y no sobre los diez.)
  prohibido "costo (centavos crudos del DTO)" "52000"   "$DOC" "$DONDE"
  prohibido "costo (formateado)"              "USD 520" "$DOC" "$DONDE"

  # Y los NOMBRES de campo, que es como se filtra un objeto entero sin que se vea en pantalla.
  # El `[A-Za-z_]*` no es adorno: el campo REAL se llama `costUsdCents` / `cost_usd_cents`, y con el
  # `\b` pegado a `usd` el barrido no lo agarraba. O sea que la regla no reconocia el unico nombre
  # con el que el costo puede filtrarse de verdad. Encontrado el 2026-08-28 en la polaridad negativa:
  # el fixture sucio traia `costUsdCents` y el barrido listo `imei internalNotes supplier` sin el.
  #
  # Contrapartida asumida: `margin[A-Za-z_]*` tambien matchea `marginBottom` de un style inline. Se
  # deja asi. La vidriera es Tailwind y hoy no hay ni uno; el dia que aparezca, un FAIL que obliga a
  # sacar un style inline de la vidriera es mejor senal que un barrido que no reconoce `marginCents`.
  KEYS=$(grep -aoE '\b(imei|cost_?[uU]sd[A-Za-z_]*|margin[A-Za-z_]*|internal_?[nN]otes|supplier)\b' "$DOC" | sort -u | tr '\n' ' ')
  if [ -n "${KEYS// /}" ]; then
    no "claves prohibidas en el payload de la $DONDE: $KEYS"
  else
    ok "ninguna clave prohibida como nombre de campo en la $DONDE"
  fi
done

[ -n "$BOOT" ] && kill "$BOOT" 2>/dev/null
rm -f "$HTML" "$GRID" "$EOUT"

# ─────────────────────────────────────────────────────────────────────────────
# ── M7 · la ficha que NO existe le tiene que hablar a una persona en la PRIMERA request ──────
# Agregado por el LEAD el 2026-08-28 despues de medir, que es lo que pedia el comentario de
# `s/[slug]/p/[listing]/not-found.tsx`. Medicion sobre el build de `eaccfee`, host de tenant:
#
#   ficha real       req1 200 / req2 200 · texto visible 974 · robots index,follow
#   slug inventado   req1 200 / req2 404 · texto visible   0 · robots noindex
#
# O sea: **exactamente el mismo patologico de ADR-011, un nivel mas abajo**. Bajo `cacheComponents`
# + PPR el `notFound()` de la ficha no pinta nada en el primer hit y recien es 404 en el segundo.
# El primer hit es justo el que importa: el link que el dueno pego en un estado de WhatsApp hace
# tres semanas, abierto por alguien que nunca entro. Esa persona recibe 200 y pantalla en blanco.
#
# La regla mide TEXTO VISIBLE, no bytes: el HTML de un miss pesa 20KB de `<script>` de RSC y
# "hay bytes" no prueba que haya una palabra. Y mide la ficha real en la misma corrida como
# control: si el extractor se rompiera y devolviera 0 para todo, la regla tiene que caer por ahi
# y no dar un falso verde.
#
# El slug del miss lleva un timestamp a proposito. Un slug fijo lo deja cacheado de la corrida
# anterior y entonces el gate mediria el req2 creyendo que mide el req1 — que es exactamente el
# unico caso que hoy funciona.
sec "M7 · el miss de la ficha (primera request, ADR-011 un nivel mas abajo)"
if [ "$FIXTURE" = "1" ]; then
  inf "MODO FIXTURE: M7 necesita HTTP vivo, no aplica"
elif ! curl -sf -m 5 "http://127.0.0.1:${SPORT}/api/health" >/dev/null 2>&1; then
  no "sin server vivo: M7 no pudo medir el miss de la ficha"
else
  # Imprime el TEXTO que un humano ve: sin <script>/<style>/<head>, sin comentarios, sin tags.
  # No cuenta: imprime. La diferencia importa — la primera version de M7 contaba caracteres y
  # despues buscaba la frase con `grep` sobre el archivo CRUDO, y esa segunda regla daba verde
  # con 0 chars visibles porque la frase estaba en el payload RSC de un <script>. Un `grep` que
  # encuentra la frase adentro de un <script> esta midiendo bytes, no lectura.
  vtext() {
    python3 - "$1" <<'PYVIS'
import re, sys, io
h = io.open(sys.argv[1], encoding='utf-8', errors='replace').read()
h = re.sub(r'(?is)<(script|style|template|head)\b.*?</\1>', ' ', h)
h = re.sub(r'(?s)<!--.*?-->', ' ', h)
t = re.sub(r'(?s)<[^>]+>', ' ', h)
sys.stdout.write(re.sub(r'\s+', ' ', t).strip())
PYVIS
  }
  MISS=$(mktemp)
  MISS_SLUG="no-existe-$(date +%s)-$$"
  MCODE=$(curl -s -o "$MISS" -w '%{http_code}' -m 15 -H "Host: $H" \
            "http://127.0.0.1:${SPORT}/p/${MISS_SLUG}" || echo 000)
  T_MISS=$(mktemp); T_OK=$(mktemp)
  vtext "$MISS" >"$T_MISS"; vtext "$HTML" >"$T_OK"
  V_MISS=$(wc -c <"$T_MISS" | tr -d ' '); V_OK=$(wc -c <"$T_OK" | tr -d ' ')
  inf "miss: /p/${MISS_SLUG} -> $MCODE, texto visible ${V_MISS} chars (ficha real: ${V_OK})"

  if [ "${V_OK:-0}" -lt 200 ]; then
    no "control roto: la ficha REAL mide ${V_OK} chars de texto visible. M7 no puede afirmar nada"
  else
    ok "control: la ficha real tiene ${V_OK} chars de texto visible"
    if [ "${V_MISS:-0}" -lt 80 ]; then
      no "el miss de la ficha sale con ${V_MISS} chars visibles: pantalla en blanco en el primer hit"
      inf "salida: devolver el contenido de not-found.tsx como render normal, no lanzar notFound()"
    else
      ok "el miss de la ficha trae texto en la PRIMERA request (${V_MISS} chars)"
    fi
  fi

  # Sobre el texto VISIBLE, no sobre el HTML crudo. Ver el comentario de `vtext`.
  grep -qF "Ver el resto de la vidriera" "$T_MISS" \
    && ok "el miss ofrece volver a la vidriera (el camino de vuelta al stock)" \
    || no "el miss no ofrece volver a la vidriera EN TEXTO VISIBLE: la persona cierra la pestana"

  grep -aqiE 'name="robots" content="[^"]*noindex' "$MISS" \
    && ok "el miss va noindex (no se indexa un equipo que no existe)" \
    || no "el miss NO va noindex"

  grep -aqiE 'name="robots" content="[^"]*noindex' "$HTML" \
    && no "la ficha REAL va noindex: la vidriera no la puede encontrar nadie desde Google" \
    || ok "la ficha real es indexable (y el miss no): son dos robots distintos, a proposito"

  rm -f "$MISS" "$T_MISS" "$T_OK"
fi

sec "M6 · prohibiciones de siempre sobre lo que toco S3"
none "cero imei/cost/margin/notas internas en (storefront)" \
     '\b(imei|cost_?[uU]sd[A-Za-z_]*|margin[A-Za-z_]*|internal_?[nN]otes|supplier)\b' "$SF"
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
if [ "$FIXTURE" = "1" ]; then
  printf '\n\033[1;33mMODO FIXTURE — esto NO acepta nada.\033[0m reglas en rojo: %s\n' "$fail"
  exit 3
fi
if [ "$fail" = "0" ]; then printf '\n\033[1;32mS3: ACEPTADA\033[0m\n'; else printf '\n\033[1;31mS3: RECHAZADA\033[0m\n'; fi
exit "$fail"
