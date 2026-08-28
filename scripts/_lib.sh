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
