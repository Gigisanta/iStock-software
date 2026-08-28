# shellcheck shell=bash
# Helpers compartidos de los gates.  **NO es un gate: no se ejecuta, se hace `source`.**
#
# ── Por que existe (T4 del board, resuelto por el LEAD el 2026-08-28) ────────────────────────────
# Habia un empate declarado: el board pedia extraer, y un comentario adentro de `accept-s2.sh` /
# `accept-s3.sh` defendia la duplicacion con un argumento que NO es tonto — *"un gate que importa de
# otro gate se rompe de a dos"*. La independencia entre gates es la misma propiedad que hace que un
# gate no pueda ser del writer que audita, asi que el argumento merecia una respuesta y no un decreto.
#
# La respuesta la dieron los hechos, dos veces:
#
# 1. **El bug del filtro de comentarios.** `none()` descartaba toda linea que arranca con `//` o `#`,
#    y por eso la regla "sin `TODO: despues el RLS`" no podia fallar nunca: ese hallazgo ES un
#    comentario. Estaba muerta identica en `accept-s1`, `accept-s2` y `accept-s3`, o sea que un solo
#    defecto viajo tres veces y hubo que arreglarlo tres veces. Un gate roto de a tres, sin importar
#    nada de nadie.
# 2. **El comentario del `git check-ignore` ya se habia perdido en dos de las cuatro copias.** El
#    codigo todavia era byte-identico; el MOTIVO no. Asi arranca siempre: primero se va la razon,
#    despues alguien "simplifica" la linea que no entiende.
#
# ── La objecion, atendida y no ignorada ─────────────────────────────────────────────────────────
# Es cierto que un cambio malo aca rompe todos los gates a la vez. Por eso este archivo tiene
# **`scripts/_lib.test.sh`, que lo prueba en las dos polaridades y corre en CI**. La duplicacion no
# protegia de un cambio malo — solo lo repartia en tres lugares donde nadie lo veia. Un solo lugar
# con test en las dos polaridades es mas seguro que tres copias sin ninguno.
#
# Lo que NO se toco: cada gate sigue teniendo sus PROPIAS reglas. Lo compartido es la carroceria
# (como se imprime un PASS, como se busca un patron), nunca que se audita.

if [ "${BASH_SOURCE[0]:-}" = "${0}" ]; then
  echo "scripts/_lib.sh es una libreria: se hace \`. scripts/_lib.sh\`, no se ejecuta." >&2
  exit 2
fi

# Estado compartido: `no()` lo pone en 1 y el gate sale con el al final.
fail=0

sec()  { printf '\n\033[1m── %s\033[0m\n' "$1"; }
ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
no()   { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=1; }
inf()  { printf '  \033[36m····\033[0m  %s\n' "$1"; }


# ── mtime / lstart portables ────────────────────────────────────────────────────────────────
# `stat -f %m` es BSD y `stat -c %Y` es GNU, pero el problema no es que uno falte en la otra
# plataforma: es que **`stat -f` EXISTE en GNU y significa otra cosa** (`--file-system`). Un
# fallback `stat -f %m "$f" || stat -c %Y "$f"` no se cae en Linux — se queda con la primera
# rama y devuelve un numero que no es un mtime. El gate que lo use sale verde comparando
# basura, que es exactamente el modo de falla que este repo trata como el peor.
#
# Lo mismo con `date`: `-j -f` es BSD, `-d` es GNU, y ninguno degrada a error legible.
#
# Por eso se decide por `uname` una sola vez, y no hay rama por defecto: una plataforma que no
# sea Darwin ni Linux tiene que fallar al cargar la libreria, no elegir la rama equivocada.
case "$(uname -s)" in
  Darwin)
    mtime()   { stat -f %m "$1" 2>/dev/null; }
    # `ps -o lstart=` da "Thu Aug 28 06:41:00 2026" en las dos plataformas; cambia quien lo parsea.
    lstart_a_epoch() { date -j -f "%a %b %d %T %Y" "$1" +%s 2>/dev/null; }
    ;;
  Linux)
    mtime()   { stat -c %Y "$1" 2>/dev/null; }
    lstart_a_epoch() { date -d "$1" +%s 2>/dev/null; }
    ;;
  *)
    echo "scripts/_lib.sh: plataforma no soportada ($(uname -s)): mtime/lstart_a_epoch no tienen rama." >&2
    exit 2
    ;;
esac
# `_buscar <regex> <path>...` — el grep comun a `none()` y `noneraw()`.
#
# `git check-ignore`: lo que git ignora es artefacto de build; lo que no, es codigo nuestro AUNQUE no
# este en el indice todavia (los archivos de una slice recien escrita estan sin `git add`, y filtrar
# por "trackeado" los saltearia justo cuando hay que auditarlos). Motivo real:
# `apps/web/tsconfig.tsbuildinfo` lista cada archivo del repo y hacia MATCH con cualquier patron.
# 2026-08-27. Este parrafo se habia perdido en dos de las cuatro copias; por eso vive aca ahora.
_buscar() { local re="$1"; shift
  local o; o=$(grep -rnE --exclude-dir=.next --exclude-dir=node_modules --exclude-dir=dist \
      --exclude-dir=.turbo --exclude="*.map" "$re" "$@" 2>/dev/null || true)
  local kept="" line f
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    f="${line%%:*}"
    git check-ignore -q "$f" 2>/dev/null && continue
    kept="${kept}${line}"$'\n'
  done <<< "$o"
  printf '%s' "$kept"; }

_veredicto() { local d="$1" kept="$2"
  if [ -z "${kept//[$'\n\t ']/}" ]; then ok "$d"
  else no "$d"; echo "$kept" | sed 's/^/        /' | cut -c1-200 | head -6; fi; }

# `none <desc> <regex> <path>...` — falla si hay match FUERA de un comentario.
# Descarta las lineas que ARRANCAN con marcador de comentario, para que una regla como "cero imei"
# no grite contra un comentario que explica por que no hay imei.
none() { local d="$1" re="$2"; shift 2
  _veredicto "$d" "$(_buscar "$re" "$@" | grep -vE '^([^:]*:)?[0-9]+:[[:space:]]*(//|\*|/\*|#|--)' || true)"; }

# `noneraw <desc> <regex> <path>...` — el mismo grep SIN el filtro de comentarios.
#
# Existe porque hay reglas cuyo hallazgo **es** un comentario, y para esas `none()` no puede fallar
# nunca. El caso concreto: `TODO: despues el RLS` vive SIEMPRE dentro de un comentario, asi que la
# regla que hace cumplir "sin RLS no hay merge" quedaba filtrada por su propio helper. Descubierto
# el 2026-08-28 corriendo la polaridad negativa contra un fixture: el archivo tenia el TODO textual
# y la regla dio PASS. Llevaba dos slices en verde sin poder distinguir un arbol limpio de uno sucio.
noneraw() { local d="$1" re="$2"; shift 2
  _veredicto "$d" "$(_buscar "$re" "$@")"; }


# ── `chk` y `have`: los dos helpers que TRES gates creian tener ─────────────────────────────────
# Vivian sueltos adentro de `accept-fase3.sh`. `accept-s1.sh` los llamaba igual —diez veces `chk`
# y una `have`— sin definirlos y sin importarlos, porque `. scripts/_lib.sh` no los traia.
#
# Bash no protesta por eso de ninguna forma que un gate pueda ver: imprime `chk: command not found`
# por **stderr**, devuelve 127, y sigue. `no()` no se llama, asi que `fail` NO se toca. El 2026-08-28
# `accept-s1.sh` reporto 25 PASS / 1 FAIL con ONCE aserciones que no se ejecutaron, entre ellas las
# cuatro que consultan Postgres de verdad para probar que `anon` no puede leer `listings.imei` y que
# `listings` tiene RLS forzada — o sea la evidencia viva del invariante mas caro del producto.
# El unico FAIL era un falso positivo ajeno; sin el, el gate salia **VERDE**. Y corre en CI.
chk()  { if eval "$2" >/dev/null 2>&1; then ok "$1"; else no "$1"; fi; }
# El archivo tiene que existir Y no estar vacio: es el phantom-file guard de `CLAUDE.md` en linea.
have() { if [ -s "$1" ]; then ok "existe y no esta vacio: $1"; else no "falta o esta vacio: $1"; fi; }

# ── La red, que es lo que de verdad arregla la clase ────────────────────────────────────────────
# Definir `chk` cura los once casos de hoy y no impide el numero doce. La propiedad que faltaba no
# es "existe `chk`": es **"un gate no puede saltearse una asercion en silencio"**. Bash ofrece
# exactamente un gancho para eso, y es este.
#
# Con `command_not_found_handle` definido, cualquier comando inexistente en cualquier gate que haga
# `. scripts/_lib.sh` imprime un FAIL con nombre y linea, ensucia `fail`, y el gate sale != 0.
# Ausencia de medicion = FAIL, nunca PASS — la misma regla que `guard-artifacts.sh` aplica a los
# artefactos, aplicada ahora a las aserciones.
#
# DOS limites conocidos y declarados, porque una red con letra chica escondida es peor que ninguna:
#
# 1. **`command_not_found_handle` es de bash >= 4.0, y macOS ships 3.2.57.** En CI (`ubuntu-latest`,
#    bash 5.x) la red agarra; en la maquina del LEAD es INERTE. Una red que solo funciona donde no
#    la miro es exactamente la clase de tranquilidad falsa que este repo trata como el peor modo de
#    falla, asi que **la mecanica primaria no es esta: es `scripts/guard-gates.sh`**, que es estatico
#    y corre igual en las dos plataformas. Esto es el cinturon de mas, no el pantalon.
# 2. Si el comando inexistente esta dentro de `$(...)` o de un pipe, corre en una subshell y el
#    `fail=1` muere con ella. La linea FAIL **igual se imprime** (queda en la salida capturada), pero
#    el exit code del gate no la refleja. No se arregla con un `trap EXIT` porque `_lib.test.sh`,
#    `guard-firewall.test.sh` y `web-lint.test.sh` ya ponen el suyo y lo pisarian: preferi el limite
#    escrito antes que una red que se cae en tres archivos sin avisar.
command_not_found_handle() {
  no "comando inexistente: \`$1\` (${BASH_SOURCE[1]:-?}:${BASH_LINENO[0]:-?})"
  printf '        Una asercion que invoca un comando que no existe no falla: se evapora. Bash\n'
  printf '        avisa por stderr, devuelve 127 y sigue; el gate nunca se entera. Si el nombre\n'
  printf '        parece un helper (`chk`, `have`, `say`), lo mas probable es que este definido\n'
  printf '        adentro de OTRO gate y que este no lo importe.\n'
  return 127
}

# ─────────────────────────────────────────────────────────────────────────────────────────────
# `puerto_ocupado <n>` — 0 si algo ya escucha en ese puerto TCP.
#
# Existe por un rojo fantasma del 2026-08-28: dos gates corriendo a la vez sobre :3100 y
# `accept-s2.sh` titulando "el censo dice 0/13 archivos ejecutados: la suite no corrio entera".
# La causa real -otro proceso tenia el puerto- estaba en el cuerpo del error, pero el titular
# acusaba a la suite e2e, que no habia hecho nada.
#
# `e2e/playwright.config.ts` ya decide `reuseExistingServer: false` a proposito, para que un
# puerto ocupado rompa fuerte en vez de prestar un server sin el espia de Postgres. Esto no lo
# reemplaza: lo adelanta, para que el gate nombre la causa ANTES de gastar un `next build` y para
# que el rojo no apunte a la columna equivocada. Un arnes que puede acusar al writer equivocado es
# peor que uno lento, y eso ya esta escrito en el config.
puerto_ocupado() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
