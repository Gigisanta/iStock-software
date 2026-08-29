#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════════════════════
#  ACEPTACION DE S9 — la lista para estados de IG/WA. La re-ejecuta el LEAD, no quien la escribio.
#  gate-owner: LEAD (CLAUDE.md §4 — el gate no puede ser del writer que audita)
#
#  Gate del board: "el dueño copia un bloque de texto con su stock publicado y lo pega en un estado".
#
#  ── Por que existe este archivo, que es un hallazgo en si mismo ──────────────────────────────
#  S9 se acepto y se commiteo (`5fbdf16`) con la aceptacion corrida A MANO por el LEAD. Salio
#  verde, pero la regla 2 de CLAUDE.md no pide una corrida verde: pide un COMANDO que el LEAD
#  RE-EJECUTA, y una corrida que vive en una transcripcion no se re-ejecuta. `guard-gates.sh`
#  estaba en PASS mientras tanto, porque censa que cada probe tenga quien la corra y que cada
#  gate este en `ci.yml` — no que cada slice tenga gate. Es la misma clase que T28 y T30 una vez
#  mas: un censo que no cubre justamente lo que falto. Queda anotado aca y no se "arregla"
#  ampliando `guard-gates.sh` a ciegas: la lista de slices vive en el board, que es de otra
#  columna, y un gate que la parsee seria un gate atado al formato de una tabla de markdown.
#
#  ── Que mira, y por que estas cinco cosas ────────────────────────────────────────────────────
#  El texto que sale de esta pantalla NO se queda en el panel: el dueño lo pega en un estado de
#  Instagram, o sea que cada defecto de esta slice es un defecto PUBLICO con el nombre del dueño
#  encima. Eso ordena las verificaciones: primero lo que se publicaria de mas (V1), despues lo que
#  se publicaria mal (V2, V3), despues lo que el arnes NO PODRIA VER si se aflojara (V4).
#
#  ── Lo que este gate NO afirma ───────────────────────────────────────────────────────────────
#  1. e2e. Q4 (que ningun bloque enlace a una ficha invisible para `anon`) y Q5 (que el truncado a
#     100 se anuncie en pantalla) son de `qa-agent` y estaban en vuelo cuando esto se escribio.
#     V2 de aca es la mitad ESTATICA de Q4 y no la reemplaza: mira que la condicion este escrita,
#     no que el bloque renderizado la respete. Las dos hacen falta y por eso no se pisan.
#  2. VENCIDO EL MISMO DIA, y se corrige en vez de borrarse. Este punto decia que la coincidencia
#     entre el host del encabezado y el de los links quedaba afuera del gate "porque `domain-agent`
#     la esta arreglando". La arreglo (`bb4f820`), asi que la excusa caduco. Ahora la afirma V7 en
#     su forma ESTRUCTURAL, y `SL27` de `packages/domain/src/stock-list.test.ts` en su forma de
#     comportamiento. Que un docblock de gate haya envejecido en horas es el mismo defecto que
#     `CLAUDE.md` §5 nombra para las citas: lo que se escribe al lado de trabajo en vuelo nace con
#     fecha de vencimiento y hay que ir a buscarlo.
#  3. Que el boton de copiar copie. Depende del navegador y del origen; V5 mira lo unico que se
#     puede afirmar sin uno: que el fallo no sea silencioso.
# ══════════════════════════════════════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/_lib.sh
. scripts/_lib.sh

fail=0
DIR='apps/web/app/(app)/_lib/stock-list'
Q="$DIR/queries.ts"
B="$DIR/build-input.ts"
T="$DIR/build-input.test.ts"
PAGE='apps/web/app/(app)/app/(panel)/lista/page.tsx'

sec 'V0 · los artefactos existen y no estan vacios'
have "$Q"; have "$B"; have "$T"; have "$PAGE"

# ── V1 · el costo no puede publicarse porque no se selecciona ─────────────────────────────────
#
# CLAUDE.md §1: el seller no ve costo ni margen, nunca. Aca es mas fuerte que de costumbre porque
# el destino del dato es un estado publico. La defensa elegida es una ALLOWLIST de columnas en el
# `select`, no un borrado posterior: lo que no se pide no puede filtrarse por un DTO mal armado.
# Por eso el gate mira la LISTA DE COLUMNAS y no el objeto de salida — un test del objeto pasa
# igual el dia que alguien agregue la columna al select "para usarla despues".
sec 'V1 · ni costo, ni margen, ni IMEI, ni nota interna en lo que se pide a la base'
PROHIBIDAS='costUsd|cost_usd|marginUsd|margin_usd|imei|internalNotes|internal_notes|supplier|masterKey|master_key'
# Se descuentan comentarios (`*`, `//`) porque el docblock de `queries.ts` las NOMBRA a proposito
# para decir que no estan. Nombrar una columna para excluirla es lo contrario de seleccionarla.
SUCIO=$(grep -nE "$PROHIBIDAS" "$Q" "$B" 2>/dev/null | grep -vE ':[0-9]+: *(\*|//|/\*)' || true)
if [ -n "$SUCIO" ]; then
  no 'una columna sensible aparece en codigo (no en comentario) del armado de la lista'
  printf '%s\n' "$SUCIO" | sed 's/^/        /'
else
  ok 'las columnas sensibles solo aparecen en comentarios que explican su ausencia'
fi

# ── V2 · no se publica un link a una ficha que `anon` no ve ───────────────────────────────────
#
# Una unidad `available` SIN `published_at` es el caso que se escapa: el estado no alcanza. Si esta
# condicion desaparece, el dueño pega en su estado un link que a sus clientes les da 404 — y lo
# hace con su propio nombre encima. Se exige en las DOS queries: la del listado y la del `count()`
# del truncado. Si solo la tuviera el listado, el cartel de "y N mas" contaria unidades invisibles.
#
# El conteo NO se compara contra un 2 fijo, y esto lo aprendi encendiendo el gate: con el umbral
# `>= 2` sacar un filtro dejaba V3 en VERDE, porque la tercera aparicion estaba en el DOCBLOCK y
# tapaba el hueco. Un gate calibrado contra una constante tiene tanto juego como distancia haya
# entre esa constante y la realidad — y esa distancia crece sola. Se compara contra `.from(listings)`,
# o sea contra la cantidad de queries que hay de verdad: una query nueva sin filtro rompe el gate
# el dia que nace, igual que una ruta nueva rompe `guard-routes`.
sec 'V2 · TODA query sobre `listings` filtra por `published_at`, no solo por estado'
N_Q=$(grep -cE '^[^*/]*\.from\(listings\)' "$Q" || true)
N_PUB=$(grep -E 'isNotNull\(listings\.publishedAt\)' "$Q" | grep -cvE '^ *(\*|//|/\*)' || true)
if [ "${N_Q:-0}" -ge 1 ] && [ "${N_PUB:-0}" -eq "${N_Q:-0}" ]; then
  ok "las $N_Q queries sobre \`listings\` exigen \`publishedAt\` no nulo"
else
  no "hay $N_Q query(s) sobre \`listings\` y $N_PUB filtro(s) por \`publishedAt\`: un bloque puede enlazar a una ficha que \`anon\` no ve"
fi

# ── V3 · filtro de tenant explicito ADEMAS de RLS ─────────────────────────────────────────────
#
# CLAUDE.md §2, defensa en profundidad. Lo sostiene `W015` de `web-lint`, y esto es redundante a
# proposito: `web-lint` deriva las tablas del schema y podria dejar de reconocer esta si alguien
# le cambia el nombre a la columna. Dos gates que se pisan cuestan poco; el que falta cuesta un
# leak cross-tenant en la pantalla cuyo output se publica.
sec 'V3 · TODA query sobre `listings` ata por `tenant_id` ademas de la policy'
N_TEN=$(grep -E 'eq\(listings\.tenantId, ctx\.tenantId\)' "$Q" | grep -cvE '^ *(\*|//|/\*)' || true)
if [ "${N_Q:-0}" -ge 1 ] && [ "${N_TEN:-0}" -eq "${N_Q:-0}" ]; then
  ok "las $N_Q queries sobre \`listings\` filtran por \`tenantId\` explicito"
else
  no "hay $N_Q query(s) sobre \`listings\` y $N_TEN filtro(s) de tenant: RLS quedaria como unica capa"
fi

# ── V4 · el fixture puede distinguir su propia mutacion ───────────────────────────────────────
#
# Esta es la verificacion que este gate tiene y los otros no, y viene de un hallazgo real de la
# slice. La campana de mutacion de `app-agent` metio un `.filter(row.status === 'available')` en el
# map de `buildStockListInput` y dio CERO rojos: el fixture tenia sus filas en `available`, asi que
# el filtro era un no-op contra esa entrada. Rotando los tres estados publicos paso a 3 rojos.
#
# O sea que el defecto no estaba en el test sino en los DATOS con los que corre, y eso no lo ve
# ningun contador de tests ni ninguna cobertura de lineas: la linea se ejecutaba: 19 tests en verde
# sobre un fixture ciego. Un test que no puede distinguir su propia mutacion no defiende nada, y
# el fixture puede volver a quedar de un solo estado sin que nada chille. Por eso se censa aca.
sec 'V4 · el fixture del armado cubre los tres estados publicos, no solo `available`'
falta=''
for st in available reserved sold; do
  grep -qE "['\"]$st['\"]" "$T" || falta="$falta $st"
done
if [ -z "$falta" ]; then
  ok 'available, reserved y sold aparecen en el fixture: un filtro por estado da rojo'
else
  no "el fixture no menciona:$falta — un \`.filter(status === 'available')\` volveria a ser un no-op"
  inf 'la mutacion que esto persigue dio 0 rojos con el fixture de un solo estado y 3 con los tres'
fi

# ── V5 · el boton de copiar no falla en silencio ──────────────────────────────────────────────
#
# `navigator.clipboard` no existe en origen no seguro, y el e2e corre en
# `http://demo.127.0.0.1.nip.io:3100`, que no lo es. La version anterior hacia `void
# navigator.clipboard.writeText(...)`: el `void` se traga el rechazo, el boton no hacia nada y no
# lo decia. Lo que se exige no es que copie —eso depende del navegador— sino que el fallo se vea.
sec 'V5 · ningun `void navigator.clipboard` que se trague el error'
# Se descuentan comentarios por el mismo motivo que en V1, y aca lo aprendi encendiendolo: la
# primera corrida de este gate dio FAIL contra el docblock de `copy-button.tsx`, que CITA la forma
# vieja para explicar por que se fue. Un gate que no distingue el bug de su necrologica obliga a
# borrar la explicacion para pasar, que es exactamente al reves de lo que queremos.
CB=$(grep -rnE 'void +navigator\.clipboard' apps/web/app 2>/dev/null | grep -vE ':[0-9]+: *(\*|//|/\*)' || true)
if [ -n "$CB" ]; then
  no 'un `void navigator.clipboard` se traga el rechazo: en origen no seguro el boton no hace nada y no lo dice'
  printf '%s\n' "$CB" | sed 's/^/        /'
else
  ok 'no hay rechazo de portapapeles tragado por un `void`'
fi

# ── V6 · la ruta no quedo horneada ────────────────────────────────────────────────────────────
#
# No se re-mide aca: `guard-routes.sh` ya lo hace contra el manifest de un build, que es la unica
# fuente que lo sabe. Lo que este bloque afirma es mas chico y aun asi hace falta: que la ruta
# TENGA fila. Una ruta sin fila no es una ruta segura, es una ruta sobre la que nadie decidio — y
# el canje demostro que eso se queda asi durante slices enteras.
# ── V7 · el encabezado no puede volver a recalcular el host ───────────────────────────────────
#
# El defecto (`bb4f820`): `buildStockList` armaba el encabezado con `storefrontHost(slug)` —que
# hardcodea `maat.work`— mientras los links salian de las `url` de las unidades. En e2e el mismo
# texto decia `nortecel.maat.work` arriba y `127.0.0.1` abajo.
#
# `SL27` lo cubre por comportamiento y es la afirmacion principal. Esto es la estructural, y no es
# redundancia gratuita: `SL27` prueba que HOY coinciden, V7 prueba que el armador no tiene de donde
# sacar un segundo host. Es la diferencia entre "no se contradicen" y "no pueden contradecirse", y
# la forma que eligio `domain-agent` fue justamente la segunda.
sec 'V7 · `stock-list.ts` no importa `storefrontHost`: el host sale de los links o de ningun lado'
if grep -nE '^import .*\bstorefrontHost\b' packages/domain/src/stock-list.ts >/dev/null 2>&1; then
  no 'el armador de bloques volvio a importar `storefrontHost`: el encabezado puede recalcular un host distinto al de sus links'
else
  ok 'el armador no importa `storefrontHost` (el de `wa.ts` sigue existiendo para el mensaje de WA, que es otra pregunta)'
fi

sec 'V6 · `/app/lista` tiene fila declarada en guard-routes'
if grep -qE '"/app/lista": *"resuming/initial"' scripts/guard-routes.sh; then
  ok 'la fila existe y no es `static/*` (el modo real lo verifica ./scripts/guard-routes.sh con un build)'
else
  no 'falta la fila de `/app/lista` en scripts/guard-routes.sh, o cambio de modo sin decirlo'
fi

sec 'RESULTADO'
if [ "$fail" -eq 0 ]; then
  ok 'ACEPTACION S9: PASS'
else
  no 'ACEPTACION S9: FAIL'
fi
exit "$fail"
