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
    // ── AGREGADO POR EL LEAD, 2026-08-28. El escaner miraba el archivo CRUDO. ────────────────
    // Lo reporto `storefront-agent`: un docblock que mencionaba `srcSet` unas lineas despues de
    // un `<img>` en PROSA hizo que la ventana del tag se abriera en el `<` del comentario, y el
    // gate tiro FAIL sobre `listings.ts`, un archivo que no renderiza ni una etiqueta. O sea que
    // el gate castigaba DOCUMENTAR la regla que el gate defiende: el unico arreglo disponible
    // para quien lo choca es borrar la explicacion. Un gate que empuja a borrar prosa correcta
    // esta roto aunque su intencion sea buena.
    // Se blanquean comentarios y strings ANTES de escanear, reemplazando por espacios para no
    // mover un solo offset: los numeros de linea que reporta el gate siguen siendo los del
    // archivo real. Es lo mismo que ya hace `scan()` de `apps/web/scripts/web-lint.mjs`.
    // LIMITE DECLARADO: no se detectan literales de regex, asi que un `//` adentro de uno podria
    // blanquear de mas. No se detecta ninguno en `apps/web` hoy y el modo de falla seria omitir
    // una deteccion, no inventarla; si aparece, el fix es tokenizar de verdad, no aflojar la regla.
    const blanquear=src=>{
      const out=src.split(""); let st=null;
      for(let i=0;i<src.length;i++){
        const c=src[i], n=src[i+1];
        if(st===null){
          // `\u0027` y no la comilla literal: este JS viaja adentro de un `node -e` entrecomillado
          // SIMPLE, y una comilla simple aca —hasta en un comentario— corta el string de shell.
          if(c==="\""||c==="\u0027"||c==="`"){ st=c; continue; }
          if(c==="/"&&n==="/"){ st="//"; out[i]=" "; continue; }
          if(c==="/"&&n==="*"){ st="/*"; out[i]=" "; continue; }
          continue;
        }
        if(st==="//"){ if(c==="\n"){ st=null; continue; } out[i]=" "; continue; }
        if(st==="/*"){ if(c==="*"&&n==="/"){ out[i]=" "; out[i+1]=" "; i++; st=null; continue; }
                       if(c!=="\n") out[i]=" "; continue; }
        // dentro de un string: se blanquea el contenido, no las comillas
        if(c==="\\"){ out[i]=" "; if(i+1<src.length&&src[i+1]!=="\n") out[i+1]=" "; i++; continue; }
        if(c===st){ st=null; continue; }
        if(c!=="\n") out[i]=" ";
      }
      return out.join("");
    };
    const walk=d=>fs.readdirSync(d,{withFileTypes:true}).forEach(e=>{
      const f=p.join(d,e.name);
      if(e.isDirectory()) return walk(f);
      if(!/\.(tsx|ts)$/.test(e.name)||/\.test\.tsx?$/.test(e.name)) return;
      const s=blanquear(fs.readFileSync(f,"utf8"));
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
  elif [ "$GOT" -lt 1024 ]; then
    # Piso, agregado por el LEAD el 2026-08-28. Lo encontro `qa-agent` corriendo la polaridad de
    # su propio spec: `transferSize=0B` **pasaba** este gate, porque 0 <= 204800. Es el mismo bug
    # que M5 ya tenia tapado con `primera=0` y que aca faltaba: **ausencia de medicion no es un
    # numero chico, es ausencia**, y un gate que la lee como "muy liviano, PASS" es peor que no
    # tenerlo. La red cuenta 0 cuando el recurso salio del cache del browser o cuando el timing
    # es cross-origin sin `Timing-Allow-Origin`, que es justo lo que pasa hoy con `/_media`.
    # 1024B y no 1B: una variante `card` de 800px de ancho no existe en menos de un KB. Un numero
    # entre 1 y 1023 no es una foto liviana, es otro sintoma del mismo agujero.
    no "transferSize=${GOT}B: eso no es una foto, es la red contando cero. La medicion es vacua"
    inf "causa tipica: recurso servido del cache del browser, o Performance API cross-origin"
    inf "sin Timing-Allow-Origin en /_media (por eso el spec mide con request.sizes() de Playwright)"
  elif [ "$GOT" -le "$CAP" ]; then
    ok "el recurso que el browser eligio pesa ${GOT}B y el techo de la grilla es ${CAP}B"
  else
    no "el browser bajo ${GOT}B y el techo es ${CAP}B — falta 'sizes', o la grilla sirve 'detail'"
  fi

  # ── que el elegido NO sea la variante grande ──────────────────────────────
  # El numero solo no alcanza: una foto chica puede pasar el techo AUNQUE la grilla este pidiendo
  # `detail`, y el dia que entre una foto pesada revienta.
  #
  # Reescrito por el LEAD el 2026-08-28. La version anterior era `grep 'elegido=[^ ]*detail'` sobre
  # la URL, y era **letra muerta**: por ADR-006 las keys de R2 son content-addressed y opacas, asi
  # que la palabra "detail" no aparece nunca en una URL publica — la regla no podia fallar ni
  # sirviendo `detail` a proposito. Lo levanto `qa-agent`, y la salida que eligio es anotar la
  # variante que el spec resolvio, como fragmento: `...webp#variante=card`. El fragmento no viaja
  # al server, o sea que la anotacion no puede cambiar lo que se descargo.
  #
  # La anotacion se exige, no se asume: si falta, la regla no puede afirmar nada y eso es FAIL.
  # Una regla que se apaga sola cuando le sacan el insumo es la forma mas comun de gate muerto.
  VAR=$(echo "$IMG" | sed -nE 's/.*elegido=[^ ]*#variante=([a-z]+).*/\1/p')
  if [ -z "$VAR" ]; then
    no "la linea MEDIDO s3 imagen no anota '#variante=' en la URL elegida: no se que variante bajo"
    inf "las keys de R2 son opacas (ADR-006): sin la anotacion del spec, esta regla no puede medir"
  elif [ "$VAR" = "card" ] || [ "$VAR" = "thumb" ]; then
    ok "el browser eligio la variante '$VAR' en la grilla"
  else
    no "el browser eligio la variante '$VAR' en la grilla: eso es exactamente P3"
  fi
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

# ── M3b · el boton wa.me, que es el unico campo de los 15 que nadie chequeaba ─
# Agregado por el LEAD el 2026-08-28, y el motivo de que faltara vale mas que el modulo: habia
# TRES pruebas alrededor del `wa.me` y ninguna sobre la pagina servida.
#   1. `packages/domain/src/wa.test.ts` fija el string canonico byte a byte — pero fuera de la
#      pagina: prueba la funcion, no que alguien la llame.
#   2. `apps/web/app/(storefront)/ficha.test.ts` cuenta que UN solo componente emite el enlace —
#      pero cuenta en el FUENTE. Un componente que existe y no se renderiza pasa igual.
#   3. `e2e/_lib/miss.ts:96` exige que el miss NO tenga `wa.me` — en negativo. Una vidriera que
#      perdio el boton en todas sus fichas satisface esa asercion perfectamente.
# Tres pruebas que rodean el invariante y ninguna que lo afirme. La ficha minima de `CLAUDE.md` §1
# tiene 15 campos, este gate aseguraba 14, y el que faltaba es el unico por el que entra la plata:
# los otros 14 informan, este convierte. Un producto cuyo "done cobrable" es "recibe WhatsApps esa
# noche" no puede tener el boton de WhatsApp como el campo sin cubrir.
if [ -s "$HTML" ] && [ -s "$GRID" ]; then
  # El conteo va sobre ANCHORS (`<a ... wa.me ...>`), no sobre ocurrencias del texto. Medido en la
  # ficha servida: `wa.me` aparece 3 veces y hay UN solo anchor — las otras dos son el payload de
  # RSC que Next escribe al final del body, que repite el mismo `<a>` serializado. Contar
  # ocurrencias daria 3 y haria fallar la regla de "UN boton" contra una ficha correcta.
  ANCHORS=$(grep -aoE '<a[^>]*href="https://wa\.me/[^"]*"[^>]*>' "$HTML" | wc -l | tr -d ' ')
  case "$ANCHORS" in
    1) ok "campo: UN solo boton wa.me en la ficha (CLAUDE.md §1)" ;;
    0) no "campo FALTANTE en la ficha: el boton wa.me. Es el campo por el que entra la plata" ;;
    *) no "la ficha tiene $ANCHORS botones wa.me y el producto pide UNO: dos precios distintos en dos botones es como se pierde una venta" ;;
  esac

  # La grilla NO lleva boton: sin ficha no hay equipo ni precio que nombrar en el mensaje, y un
  # `wa.me` en la grilla manda un "hola" pelado que el dueño tiene que descifrar a mano.
  GANCHORS=$(grep -aoE '<a[^>]*href="https://wa\.me/[^"]*"[^>]*>' "$GRID" | wc -l | tr -d ' ')
  [ "$GANCHORS" = "0" ] && ok "la grilla no tiene boton wa.me (sin ficha no hay precio que nombrar)" \
    || no "la grilla tiene $GANCHORS boton(es) wa.me: manda un 'hola' sin equipo ni precio"

  WA_HREF=$(grep -aoE 'https://wa\.me/[^"]+' "$HTML" | head -1)
  if [ -z "$WA_HREF" ]; then
    no "sin href de wa.me: no puedo medir ni el telefono ni el texto"
  else
    # Telefono: sale del seed, no de este archivo. `SEED_DEMO_WA_PHONE` pisa el fallback sin tocar
    # codigo (`seed-data.ts:28`), asi que el gate lee la misma variable que la siembra. Hardcodear
    # el numero aca haria que el gate mienta el dia que alguien exporte otro.
    WANT_PHONE="${SEED_DEMO_WA_PHONE:-5492990000000}"
    case "$WA_HREF" in
      "https://wa.me/${WANT_PHONE}"*) ok "el wa.me apunta al telefono del tenant ($WANT_PHONE)" ;;
      *) no "el wa.me NO apunta al telefono del tenant: esperaba $WANT_PHONE en $(printf '%s' "$WA_HREF" | cut -c1-60)" ;;
    esac

    # Decodificado del `text=`. Sin python ni node: `%XX` → `\xXX` y `printf '%b'` lo resuelve,
    # UTF-8 incluido (probado con `Neuqu%C3%A9n` → `Neuquén`). El `sed` va en C para que un byte
    # alto no vuelva a tirar `illegal byte sequence`, como ya paso limpiando ANSI del log del gate.
    #
    # El `printf` toma el string como ARGUMENTO de `%b` y no como formato: al reves, un `%` del
    # texto se comeria el siguiente caracter. Y NO va por `xargs`: la primera version decia
    # `| xargs -0 printf '%b'` y fue medida antes de confiar en ella — `xargs` procesa las
    # barras invertidas por su cuenta y entrega `\x2C` ya pelado, asi que `printf` recibia `x2C` y
    # devolvia `Holax2Cx20vix20el...`. El detalle que lo hace peligroso es que ESO SIGUE PARECIENDO
    # TEXTO: no es un error ni un vacio, es una cadena plausible que ningun `set -e` detiene.
    WA_TEXT=$(printf '%s' "$WA_HREF" | sed 's/^[^?]*?//; s/^text=//; s/&.*$//' \
              | LC_ALL=C sed 's/+/ /g; s/%/\\x/g')
    WA_TEXT=$(printf '%b' "$WA_TEXT")
    inf "wa.me text= decodificado: $(printf '%s' "$WA_TEXT" | cut -c1-110)"

    waq() { case "$WA_TEXT" in *"$2"*) ok "el mensaje de WA nombra $1 ('$2')" ;;
                               *) no "el mensaje de WA NO nombra $1: falta '$2'" ;; esac; }
    # ## El agujero que dejaron los tres `waq` de abajo, encontrado el 2026-08-28
    # Los `waq` afirman SUBSTRINGS. El 2026-08-28, re-ejecutando accept-s4, el href medido de un
    # browser real decia `iPhone 14 Pro 256 Grafito 256 Grafito (usado A)`: storage y color
    # DUPLICADOS. Los tres `waq` pasaban — `256 Grafito` aparece, y `grep` no cuenta cuantas veces.
    # El unit de dominio tambien pasaba, porque compara byte a byte con el nombre ya limpio: prueba
    # la funcion, no el mapeo. Otra vez tres pruebas alrededor del string y ninguna encima del
    # string ENTERO en el camino real, que es el mismo agujero que este modulo nacio para tapar.
    #
    # La causa esta en `_lib/listings.ts` (`modelDisplayName: row.modelDisplayName ?? row.title`):
    # sin `catalog_model` cae al titulo libre del dueño, que ya suele traer storage y color, y
    # `describeListing` los appendea otra vez. `catalogModelId` es nullable y `onDelete: set null`,
    # asi que es camino de produccion. Lo arregla S4.1.
    #
    # La asercion no puede ser "el string es igual a X": el modelo, el storage y el color salen del
    # seed y hardcodearlos haria mentir al gate el dia que cambien. Lo que SI es invariante es que
    # la descripcion no repite un token: `iPhone 14 Pro 256 Grafito` tiene cinco y ninguno se
    # repite. Es la propiedad exacta que el defecto viola, sin depender de los valores.
    WA_DESC=$(printf '%s' "$WA_TEXT" | sed -n 's/^.*vi el \(.*\) (.*$/\1/p')
    if [ -z "$WA_DESC" ]; then
      no "el mensaje de WA no tiene la forma 'vi el <equipo> (<condicion>)': no puedo medir el equipo"
    else
      inf "equipo nombrado en el mensaje: '$WA_DESC'"
      WA_DUP=$(printf '%s' "$WA_DESC" | tr ' ' '\n' | grep -v '^$' | sort | uniq -d | tr '\n' ' ')
      [ -z "$WA_DUP" ] \
        && ok "el equipo se nombra una sola vez: sin tokens repetidos en '$WA_DESC'" \
        || no "el mensaje de WA repite el equipo: token(es) duplicado(s) [$WA_DUP] en '$WA_DESC'. Es el defecto S4.1: sin catalog_model, modelDisplayName cae al title y describeListing appendea storage y color por segunda vez"
    fi

    waq "el precio en dolares" "USD 620"
    waq "la vidriera de donde vino" "demo.maat.work"
    waq "la intencion de compra" "y lo quiero."

    # ## El par de registros, que es lo que ningun otro test puede ver
    # `CLAUDE.md` §1 lo ratifico en FASE 2 y es contraintuitivo a proposito: la MISMA pagina dice
    # `usado excelente` en el cuerpo (M3 ya lo exige) y `usado A` en el mensaje de WhatsApp. No es
    # un bug de consistencia: la ficha le habla a un comprador y el mensaje a un reseller, que usa
    # esa jerga. Son dos mapas distintos en `packages/domain` (`WA_CONDITION_LABELS`, `types.ts:69`).
    # Este es el unico lugar del proyecto donde se pueden observar los DOS a la vez, sobre el mismo
    # HTML: el unit de dominio ve un mapa por vez y no sabe que hay una pagina. Y es exactamente la
    # clase de decision que muere en silencio — el dia que alguien "arregle la inconsistencia"
    # unificando los mapas, todos los tests unitarios van a seguir verdes.
    case "$WA_TEXT" in
      *"usado A"*) ok "el mensaje de WA usa el registro reseller ('usado A', FASE 2)" ;;
      *) no "el mensaje de WA perdio el registro reseller: esperaba 'usado A' (WA_CONDITION_LABELS)" ;;
    esac
    case "$WA_TEXT" in
      *"usado excelente"*) no "el mensaje de WA copio el registro de la FICHA ('usado excelente'): los dos mapas se unificaron y la decision de FASE 2 se perdio" ;;
      *) ok "el mensaje de WA no usa el registro de la ficha: los dos mapas siguen separados" ;;
    esac
  fi
else
  no "sin HTML de ficha o de grilla: el boton wa.me quedo sin medir"
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
  # `margin` PELADO ya no se busca en los BYTES, y la razon es una medicion. La version anterior
  # barria `margin[A-Za-z_]*` con la contrapartida escrita al lado: "tambien matchea `marginBottom`
  # de un style inline, la vidriera es Tailwind y hoy no hay ni uno". Falso, y no por un style
  # nuestro. Medido el 2026-08-28 sobre `/p/cargador-20w-usbc` servido: 8 ocurrencias de `margin`,
  # las 8 de la pagina de error propia de Next, que va serializada en el payload de RSC de
  # CUALQUIER ficha con codigo 200: `body{...;margin:0}`, `.next-error-h1`, `\"margin\":\"0 20px 0
  # 0\"`, `\"margin\":0`. Ninguna es nuestra. El gate salia rojo por bytes del framework, y un gate
  # cronicamente rojo por una causa ajena es peor que no tenerlo: entrena a leer el rojo como ruido.
  #
  # Se probaron dos formas de separar los casos y las dos se cayeron contra el archivo servido:
  # por FORMA de clave no va (Next tambien escribe `\"margin\":`), y por TIPO de valor tampoco
  # (Next escribe `\"margin\":0`, un numero, igual que nuestros centavos). En este nivel el token
  # es indistinguible, punto.
  #
  # Lo que mantiene el invariante cubierto es que ya se chequea donde SI se puede discriminar:
  # `packages/domain/src/dto.test.ts` U18 arma una fila cruda que incluye literalmente
  # `margin: 14_000` y afirma que `publicListingDTO` nunca emite esa clave. Ahi es un objeto con
  # claves, no un HTML con CSS adentro. Esta regla se queda con los nombres inequivocos:
  # `margin_usd` (la columna real), `marginUsd`, `marginPct`, `margen*`, que ningun framework
  # escribe por su cuenta.
  #
  # Contrapartida que SI se asume: `margin[A-Z]...` matchea `marginTop` de un style inline. Hoy no
  # hay ninguno en la vidriera (medido, no supuesto) y un FAIL que obliga a sacarlo es buena senal.
  KEYS=$(grep -aoE '\b(imei|cost_?[uU]sd[A-Za-z_]*|margin(_[a-z]+|[A-Z][A-Za-z]*)|margen[A-Za-z_]*|internal_?[nN]otes|supplier)\b' "$DOC" | sort -u | tr '\n' ' ')
  if [ -n "${KEYS// /}" ]; then
    no "claves prohibidas en el payload de la $DONDE: $KEYS"
  else
    ok "ninguna clave prohibida como nombre de campo en la $DONDE"
  fi
done

# El teardown del server y de los dos temporales NO va aca. Estuvo aca una sola corrida y esa
# corrida es la prueba: M7 necesita las dos cosas —el server para pedir el miss, y `$HTML` para el
# control de "la ficha real tiene N chars visibles"— asi que matarlas antes de M7 lo dejaba muerto
# de dos maneras distintas, y la primera tapaba a la segunda ("sin server vivo" nunca llegaba a
# leer el archivo borrado). Un gate recien escrito que reporta FAIL por su propio orden de lineas
# es indistinguible de uno que encontro el defecto: por eso el teardown baja hasta despues de M7.
rm -f "$EOUT"

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

# Recien aca: M7 fue el ultimo modulo que necesitaba HTTP vivo y el HTML de la ficha real.
[ -n "$BOOT" ] && kill "$BOOT" 2>/dev/null
rm -f "$HTML" "$GRID"

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
