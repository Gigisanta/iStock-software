#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════════════════════
#  ACEPTACION DE S13 — el alias `maat.work/demo` → `demo.maat.work`. La re-ejecuta el LEAD.
#  gate-owner: LEAD (CLAUDE.md §4 — el gate no puede ser del writer que audita)
#
#  ── Por que este gate existe y no alcanzaba con los 18 tests de `demo.test.ts` ───────────────
#  `storefront-agent` probo el `308` sobre el OBJETO `NextResponse` que devuelve `demoAliasRedirect`,
#  que es lo unico que un unit test puede hacer. Nadie midio un `Location` que haya viajado por la
#  red. La diferencia no es ceremonial: entre la funcion y el browser estan el `matcher` del proxy,
#  el orden de las guardas de `proxy()` y el serializado de la URL — tres lugares donde el redirect
#  se puede perder sin que se caiga un solo unit test. V5 es la mitad que faltaba.
#
#  ── La verificacion que manda es V1, y es de ORDEN, no de contenido ──────────────────────────
#  Toda la slice se apoya en que el alias se decide DENTRO de `case 'marketing'`, o sea DESPUES de
#  resolver el host. Un `if (isDemoAliasPath(pathname))` arriba de `proxy()` —que es exactamente la
#  forma en que alguien lo va a "simplificar", porque no depende del host y parece que puede subir—
#  serviria la vidriera del demo bajo `{cualquier-tenant}.maat.work/demo`. Es una fuga de tenant, y
#  es la misma clase que `'use cache'` sin el host en la key: una decision por path tomada antes de
#  saber de quien es el host.
#
#  V1 no mira que el codigo "diga" algo: compara NUMEROS DE LINEA. Es la unica forma de afirmar un
#  orden. Si el `if` sube, el gate enciende aunque el codigo sea, palabra por palabra, el mismo.
#
#  ── Lo que este gate NO afirma ───────────────────────────────────────────────────────────────
#  1. Que el demo tenga contenido. El alias es una funcion pura de (host, path) y no consulta nada;
#     que `demo.<apex>` renderice depende del seed, que es de `db-agent` y lo cubre `accept-s1.sh`.
#     V5 mide el `Location`, no lo que hay del otro lado — a proposito: atar este gate al seed lo
#     haria fallar por un motivo que no es S13.
#  2. Que el `308` este cacheado en el CDN. Eso pasa en Vercel y no se puede medir con `next start`.
#     El precio de la permanencia esta declarado en ADR-027 y en `_lib/host.ts`; no es medible aca.
#  3. `guard-routes.sh` corre aparte (esta en `ci.yml`) y no se invoca desde aca: un gate que llama
#     a otro hace que un rojo se lea dos veces con dos nombres distintos.
#
#  Corre en `ci.yml`, en el job que ya buildea y levanta servers para S1/S2/S3.
# ══════════════════════════════════════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/_lib.sh
. scripts/_lib.sh

fail=0
PROXY='apps/web/proxy.ts'
HOST='apps/web/app/(storefront)/_lib/host.ts'
TEST='apps/web/app/(storefront)/demo.test.ts'
PORT="${E2E_PORT:-3100}"
APEX="${E2E_APEX_HOST:-127.0.0.1.nip.io}"

sec 'V0 · los artefactos existen y no estan vacios'
have "$PROXY"; have "$HOST"; have "$TEST"

# ── V1 · el alias se decide DESPUES de resolver el host ───────────────────────────────────────
sec 'V1 · el `if` del alias vive dentro de `case marketing`, no arriba de `proxy()`'

L_RESOLVE=$(grep -n 'const resolved = resolveHost(' "$PROXY" | head -1 | cut -d: -f1)
L_MKTG=$(grep -n "case 'marketing':" "$PROXY" | head -1 | cut -d: -f1)
L_ALIAS=$(grep -n 'isDemoAliasPath(pathname)' "$PROXY" | head -1 | cut -d: -f1)

if [ -z "$L_RESOLVE" ] || [ -z "$L_MKTG" ] || [ -z "$L_ALIAS" ]; then
  # Ausencia de medicion es FAIL, nunca PASS: si el gate no encuentra las tres anclas, no puede
  # afirmar el orden y salir verde seria afirmar nada. Mismo canario que C1 de `guard-citas.sh`.
  no "no encontre las tres anclas en $PROXY (resolveHost=$L_RESOLVE marketing=$L_MKTG alias=$L_ALIAS): el gate no puede medir el orden"
else
  if [ "$L_ALIAS" -gt "$L_RESOLVE" ] && [ "$L_ALIAS" -gt "$L_MKTG" ]; then
    ok "el alias se evalua en la linea $L_ALIAS, despues de resolveHost ($L_RESOLVE) y de case 'marketing' ($L_MKTG)"
  else
    no "el alias (linea $L_ALIAS) se evalua ANTES de resolver el host ($L_RESOLVE) o fuera de la rama marketing ($L_MKTG): eso sirve el demo bajo el subdominio de cualquier tenant"
  fi
fi

# Se cuentan LLAMADAS (con parentesis), no menciones: el import nombra el simbolo sin decidir
# nada. Un segundo call site es un segundo lugar desde donde el `if` puede subir, y V1 solo mide
# el primero que encuentra — o sea que sin este conteo V1 seria esquivable agregando otro.
N_ALIAS=$(grep -c 'isDemoAliasPath(pathname)' "$PROXY")
if [ "$N_ALIAS" = 1 ]; then
  ok 'el alias se decide en un solo lugar del proxy (un unico call site)'
else
  no "\`isDemoAliasPath(pathname)\` se llama $N_ALIAS veces en $PROXY (esperaba 1): V1 solo mide el primer call site, asi que un segundo lo esquiva"
fi

# ── V2 · el destino se DERIVA del host entrante, no esta escrito ──────────────────────────────
sec 'V2 · el `Location` sale del host entrante, no de una constante'
if grep -qE "tenantHostFor\(request\.headers\.get\('host'\)" "$PROXY"; then
  ok 'el host destino se deriva de `request.headers.get(host)` via `tenantHostFor`'
else
  no 'el destino del redirect no se deriva del host entrante: un `Location` fijo manda al apex de produccion desde dev y desde preview'
fi
noneraw "$PROXY" 'demo\.maat\.work' 'un host de demo escrito a mano en el proxy'

# ── V3 · cero I/O en el camino del alias ──────────────────────────────────────────────────────
#
# El proxy corre fuera del runtime de la app (CLAUDE.md §3): no puede consultar nada y no puede
# compartir estado. El alias tiene que ser una funcion pura de (host, path) o rompe el 95% sin
# Postgres del que cuelga el costo del producto.
sec 'V3 · el proxy no consulta nada para decidir el alias'
noneraw "$PROXY" "@istock/db" 'el proxy importa la base'
noneraw "$PROXY" '\bawait\b' 'hay un `await` en el proxy (el alias tiene que ser sincrono y puro)'
noneraw "$PROXY" '\bfetch\(' 'hay un `fetch(` en el proxy'

# ── V4 · la respuesta es 308 y no 302/307 ─────────────────────────────────────────────────────
sec 'V4 · el redirect es permanente (308), que es lo que ADR-027 decidio y lo que cuesta'
if grep -q 'NextResponse.redirect(url, 308)' "$PROXY"; then
  ok 'el redirect es 308 (permanente, cacheable por el browser y por el CDN)'
else
  no 'el redirect no es un 308: ADR-027 lo decidio permanente y el precio esta declarado ahi'
fi

# ── V5 · la mitad que los unit tests no pueden afirmar: el Location sobre la red ──────────────
sec 'V5 · sobre HTTP: el 308 viaja, y NO viaja bajo el subdominio de otro tenant'

if puerto_ocupado "$PORT" && ! curl -sf -m 5 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
  no "el puerto $PORT lo tiene otro proceso que no contesta el health: NO es un rojo del producto, es otra corrida pisandose con esta. Esperala, o E2E_PORT=<otro>."
fi

if curl -sf -m 5 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1 \
   && server_es_de_este_build "$PORT" && build_es_del_arbol_actual; then
  inf "reuso el server de :$PORT (arranco despues del BUILD_ID y ninguna fuente quedo mas nueva)"
else
  inf "no hay server confiable en :$PORT — build + start, puede tardar unos minutos"
  if pnpm --filter @istock/web exec next build >/tmp/accept-s13-build.log 2>&1; then
    NODE_ENV=test PORT="$PORT" \
      pnpm --filter @istock/web exec next start -p "$PORT" >/tmp/accept-s13-start.log 2>&1 &
    S13_PID=$!
    trap 'kill "$S13_PID" 2>/dev/null || true' EXIT
    for _ in $(seq 1 60); do curl -sf -m 2 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1 && break; sleep 1; done
  else
    no 'el build fallo: ver /tmp/accept-s13-build.log'
  fi
fi

# `--resolve` en vez de confiar en el DNS de nip.io: el gate no puede depender de una resolucion
# externa que se cae. El `Host:` viaja igual y es lo unico que el proxy mira.
_hdr() {
  curl -s -o /dev/null -D - -m 20 \
    --resolve "$1:${PORT}:127.0.0.1" \
    "http://$1:${PORT}$2" 2>/dev/null
}

if curl -sf -m 5 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
  # V5a — el apex redirige, y el Location apunta al host del demo de ESTA familia de hosts.
  H=$(_hdr "$APEX" "/demo")
  CODE=$(printf '%s' "$H" | awk 'NR==1{print $2}')
  LOC=$(printf '%s\n' "$H" | tr -d '\r' | sed -n 's/^[Ll]ocation: //p' | head -1)
  if [ "$CODE" = 308 ] && printf '%s' "$LOC" | grep -q "^http://demo\.${APEX}:${PORT}/$"; then
    ok "apex/demo → $CODE $LOC"
  else
    no "apex/demo dio '$CODE' con Location '$LOC' (esperaba 308 a http://demo.${APEX}:${PORT}/)"
  fi

  # V5b — el path de adentro se conserva. Sin esto el alias manda todo a la home del demo y un link
  # a una ficha compartido por WhatsApp pierde el equipo.
  H=$(_hdr "$APEX" "/demo/p/iphone-14-pro")
  CODE=$(printf '%s' "$H" | awk 'NR==1{print $2}')
  LOC=$(printf '%s\n' "$H" | tr -d '\r' | sed -n 's/^[Ll]ocation: //p' | head -1)
  if [ "$CODE" = 308 ] && printf '%s' "$LOC" | grep -q "^http://demo\.${APEX}:${PORT}/p/iphone-14-pro$"; then
    ok "apex/demo/p/… conserva el path → $LOC"
  else
    no "apex/demo/p/iphone-14-pro dio '$CODE' con Location '$LOC' (esperaba conservar /p/iphone-14-pro)"
  fi

  # V5c — LA FUGA. `/demo` bajo el subdominio de otro tenant no puede redirigir al demo. Es la
  # unica verificacion de este archivo que mide un ATAQUE y no una funcionalidad.
  OTRO="qa-no-soy-el-demo.${APEX}"
  H=$(_hdr "$OTRO" "/demo")
  CODE=$(printf '%s' "$H" | awk 'NR==1{print $2}')
  LOC=$(printf '%s\n' "$H" | tr -d '\r' | sed -n 's/^[Ll]ocation: //p' | head -1)
  if printf '%s' "$LOC" | grep -q "demo\.${APEX}"; then
    no "FUGA DE TENANT: ${OTRO}/demo redirige a '$LOC' — el demo se sirve bajo el subdominio de otro negocio"
  else
    ok "${OTRO}/demo NO redirige al demo (dio '$CODE', Location '${LOC:-ninguno}'): el alias vive dentro de la rama marketing"
  fi

  # V5d — control de que V5c no esta verde por vacio. Si el server no sirviera NADA, V5c pasaria
  # igual. Este mide que el mismo host, en la home, si responde algo del producto.
  H=$(_hdr "$APEX" "/")
  CODE=$(printf '%s' "$H" | awk 'NR==1{print $2}')
  if [ "$CODE" = 200 ]; then
    ok "control: el apex sirve su home con 200 (V5c no esta verde porque el server este mudo)"
  else
    no "control: el apex dio '$CODE' en / — V5c no prueba nada si el server no sirve el producto"
  fi
else
  no "no hay server en :$PORT — V5 no corrio, y sin medir el Location sobre la red no hay aceptacion de S13"
fi

sec 'V6 · el arnes del writer sigue verde (`(storefront)/demo.test.ts`)'
# Sin `--silent`: la CLI de vitest se come el argumento siguiente como valor de la flag y el path
# —que tiene puntos— termina interpretado como una propiedad anidada. Falla con un stack de `cac`
# que no dice nada del test. Costo un rojo de este gate que no era del producto.
if pnpm --filter @istock/web exec vitest run --reporter=dot "app/(storefront)/demo.test.ts" >/tmp/accept-s13-vitest.log 2>&1; then
  ok "$(grep -oE 'Tests +[0-9]+ passed' /tmp/accept-s13-vitest.log | head -1 || echo 'demo.test.ts verde')"
else
  no 'demo.test.ts en rojo: ver /tmp/accept-s13-vitest.log'
fi

printf '\n'
if [ "$fail" = 0 ]; then printf '\033[1;32mACEPTACION S13: PASS\033[0m\n'
else printf '\033[1;31mACEPTACION S13: FAIL\033[0m\n'; fi
exit "$fail"
