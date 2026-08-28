#!/usr/bin/env bash
# Gate mecanico de CLAUDE.md §2 — "Prohibiciones que se chequean en review".
# Un review humano se cansa; esto no. Cada regla cita la linea de la constitucion que aplica.
#
# Convencion: se ignoran las lineas de COMENTARIO. Un comentario que dice "prohibido el IMEI"
# no es una fuga de IMEI, y si lo tratamos como tal, el equipo deja de documentar los peligros.
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0
say()  { printf '\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32mok\033[0m    %s\n' "$1"; }
bad()  { printf '  \033[31mLEAK\033[0m  %s\n' "$1"; fail=1; }
hits() { # hits <descripcion> <regex> <path...>
  local desc="$1" re="$2"; shift 2
  local out
  out=$(grep -rnE "$re" "$@" 2>/dev/null \
        | grep -vE ':[0-9]+:\s*(//|\*|/\*|#|--)' || true)
  if [ -z "$out" ]; then ok "$desc"; else bad "$desc"; echo "$out" | sed 's/^/        /' | head -12; fi
}

SRC_STOREFRONT=$(ls -d apps/web/app/\(storefront\) 2>/dev/null || true)
SRC_AI=$(ls -d packages/ai 2>/dev/null || true)
SRC_ALL=$(ls -d apps/web packages 2>/dev/null || true)
[ -z "$SRC_ALL" ] && { echo "nada que auditar todavia"; exit 0; }

say "1 · campos prohibidos en la vidriera y en el chatbot  (§2, DOMAIN.md §Visibilidad)"
# La vidriera y el prompt del LLM son los dos lugares donde estos campos son una fuga, no un bug.
if [ -n "$SRC_STOREFRONT$SRC_AI" ]; then
  hits "sin imei / cost_usd / margin / internal_notes / supplier" \
       "\b(imei|cost_?[Uu]sd|costUsd|margin|internal_?[Nn]otes|internalNotes|supplier)\b" \
       $SRC_STOREFRONT $SRC_AI --include='*.ts' --include='*.tsx' \
       --exclude='*.test.ts' --exclude='*.test.tsx' --exclude='*.eval.ts'
else
  ok "sin (storefront) ni packages/ai todavia"
fi

say "2 · console.log de un listing entero  (§2)"
hits "sin console.log(listing|unit|row)" \
     "console\.(log|info|debug|warn)\((listing|unit|row|record|data)\b" \
     $SRC_ALL --include='*.ts' --include='*.tsx' --exclude='*.test.ts'

say "3 · deuda diferida sobre seguridad o costo  (§2: 'TODO: despues el RLS' = rechazo)"
# El `[^A-Za-z]` despues del marcador NO es cosmetico y se agrego el 2026-08-28 tras un falso
# positivo real: la frase "el cron ve las reservas vencidas de TODOS los tenants" hacia FAIL este
# guard, porque "TODO" es prefijo de "TODOS" y "tenant" estaba a menos de 60 caracteres. O sea que
# el gate se ponia rojo por una oracion en castellano bien escrita, sobre codigo correcto.
# Eso no es "un falso positivo tolerable": es la forma mas barata de ensenarle al equipo que los
# rojos de este guard se ignoran, y el dia que uno sea de verdad ya nadie lo mira. Exigir que el
# marcador termine en un caracter no alfabetico deja pasar "TODOS"/"TODAS" y sigue agarrando
# "TODO:", "TODO ", "FIXME(" y "HACK-". Se usa `[^A-Za-z]` y no `\b` a proposito: `\b` es una
# extension de GNU y el grep de macOS es BSD; el gate tiene que medir igual en las dos maquinas.
hits "sin TODO/FIXME sobre RLS, R2 o cache" \
     "(TODO|FIXME|XXX|HACK)[^A-Za-z][^\n]{0,59}(RLS|rls|R2|cache|tenant|policy|policies)" \
     $SRC_ALL --include='*.ts' --include='*.tsx' --include='*.sql'

say "4 · Next 16: el archivo se llama proxy.ts  (§3)"
if [ -f apps/web/middleware.ts ] || [ -f middleware.ts ]; then
  bad "existe middleware.ts — deprecado en Next 16.0, va proxy.ts"
else ok "sin middleware.ts"; fi

say "5 · el proxy no consulta ni cachea  (ADR-007; corre fuera del runtime de la app)"
if [ -f apps/web/proxy.ts ]; then
  hits "proxy sin DB / fetch / Map de modulo" \
       "(from '@istock/db'|createClient|drizzle|await fetch\(|new Map\(|new LRU)" apps/web/proxy.ts
  grep -qE "export (async )?function proxy" apps/web/proxy.ts \
    && ok "exporta proxy()" || bad "proxy.ts no exporta proxy()"
  grep -qE "^\s*(export const )?runtime\s*=" apps/web/proxy.ts \
    && bad "proxy.ts configura runtime — en Next 16 tira error" || ok "proxy.ts no configura runtime"
else ok "todavia no hay proxy.ts"; fi

say "6 . cacheLife de la vidriera - POLARIDAD  (§goal: revalidate:60 = 216x el costo)"
# Reescrito por el LEAD: la version anterior prohibia `revalidate: <numero corto>` en CUALQUIER
# archivo de (storefront) y no distinguia el camino positivo del negativo. storefront-agent lo
# reporto como conflicto entre dos reglas mias y tenia razon: la regla se satisfacia renombrando
# el literal a una constante, y una regla que se pasa renombrando dejo de guardar.
#
# El invariante real tiene dos polos:
#   POSITIVO (el tenant que existe)  -> 'max'. Un TTL por tiempo aca multiplica el costo por 216.
#   NEGATIVO (el slug que no existe) -> corto. 'max' aca es envenenamiento durable de 30 dias.
if [ -n "$SRC_STOREFRONT" ]; then
  CL="apps/web/app/(storefront)/_lib/cache-life.ts"

  # 6a - el polo positivo sigue en 'max'.
  grep -rqE "cacheLife\('max'\)" $SRC_STOREFRONT \
    && ok "el camino positivo usa cacheLife('max')" \
    || bad "el camino positivo perdio cacheLife('max') - 216x el costo"

  # 6b - el perfil corto se declara en UN solo archivo. Un cacheLife({...}) inline en cualquier
  #      otro lado es un TTL por tiempo escondido en el camino positivo.
  OTHER=$(grep -rlE "cacheLife\(\{" $SRC_STOREFRONT 2>/dev/null | grep -v 'cache-life\.ts' || true)
  if [ -z "$OTHER" ]; then ok "ningun cacheLife({...}) inline fuera de _lib/cache-life.ts"
  else bad "cacheLife({...}) inline fuera de _lib/cache-life.ts"; echo "$OTHER" | sed 's/^/        /'; fi

  # 6c - y ese unico archivo es el del MISS y sus numeros siguen siendo CORTOS.
  #      Se leen los enteros del archivo y se compara contra un techo DUPLICADO a proposito aca
  #      (mismo criterio que el presupuesto de bytes de packages/media): si el techo se leyera de
  #      la constante, subir la constante pondria el guard en verde y el guard dejaria de guardar.
  if [ -f "$CL" ]; then
    MAXN=$(grep -oE '=[[:space:]]*[0-9]+' "$CL" | grep -oE '[0-9]+' | sort -n | tail -1)
    MINN=$(grep -oE '=[[:space:]]*[0-9]+' "$CL" | grep -oE '[0-9]+' | sort -n | head -1)
    if [ -n "$MAXN" ] && [ "$MAXN" -le 900 ] && [ -n "$MINN" ] && [ "$MINN" -ge 30 ]; then
      ok "perfil negativo corto: enteros en [$MINN, $MAXN] s, dentro de [30, 900]"
    else
      bad "perfil negativo fuera de banda (enteros en [${MINN:-?}, ${MAXN:-?}] s, se exige [30, 900])"
    fi
    grep -qiE 'MISS' "$CL" \
      && ok "el perfil corto esta nombrado como MISS (es el polo negativo, no un TTL del positivo)" \
      || bad "_lib/cache-life.ts declara un perfil corto que no dice ser el del miss"
  else
    ok "todavia no hay _lib/cache-life.ts"
  fi

  # 6d - fuera de ese archivo, ningun revalidate numerico corto (la regla original, ya con scope).
  REST=$(grep -rnE "revalidate[[:space:]]*[:=][[:space:]]*([0-9]|[1-9][0-9]|[1-9][0-9]{2})\b" \
         $SRC_STOREFRONT 2>/dev/null | grep -v 'cache-life\.ts' \
         | grep -vE '^[^:]*:[0-9]+:[[:space:]]*(//|\*|/\*)' || true)
  if [ -z "$REST" ]; then ok "sin revalidate numerico corto fuera de _lib/cache-life.ts"
  else bad "revalidate numerico corto en el camino positivo"; echo "$REST" | sed 's/^/        /' | head -6; fi

  # 6e - todo archivo con un scope 'use cache' elige perfil EXPLICITAMENTE. Borrar el cacheLife
  #      no vuelve la ruta dinamica: la deja en el perfil default (~15 min de revalidate), que es
  #      el mismo 216x por otra puerta. Es el agujero que T3 dejo ver: 6a pasaba porque OTRO
  #      archivo tenia el 'max'.
  MUTE=""
  for f in $(grep -rlE "^\s*'use cache'" $SRC_STOREFRONT 2>/dev/null); do
    case "$f" in *cache-life.ts) continue;; esac
    grep -qE "cacheLife\(|cacheStorefrontMiss\(" "$f" || MUTE="$MUTE$f"$'\n'
  done
  if [ -z "$MUTE" ]; then ok "todo scope 'use cache' de la vidriera elige perfil explicito"
  else bad "'use cache' sin cacheLife -> cae al perfil default (~15m = 216x)"; printf '%s' "$MUTE" | sed 's/^/        /'; fi

  hits "sin set-cookie en (storefront)  (uno solo apaga el CDN entero)" \
       "(set-?[Cc]ookie|cookies\(\)\.set)" $SRC_STOREFRONT
fi

say "7 · tenant_id en app_metadata, nunca en user_metadata  (§2, lint 0015 ERROR)"
# Se excluyen los tests a proposito: el test que FORJA un claim con tenant_id en user_metadata
# y verifica que no abre nada es la prueba de que la regla se cumple. Marcarlo como fuga
# entrena al equipo a borrar justo el test que protege la regla.
hits "sin tenant_id en user_metadata" \
     "user_metadata[^\n]{0,40}tenant|tenant[^\n]{0,20}user_metadata" \
     $SRC_ALL --include='*.ts' --include='*.tsx' --include='*.sql' \
     --exclude='*.test.ts' --exclude='*.test.tsx'

say "8 · keys de foto opacas  (§2: derivar el master desde la URL = rechazo)"
if [ -d packages/media ]; then
  hits "sin tenant_id/listing_id dentro de una key de R2" \
       "\`[^\`\n]*(tenantId|tenant_id|listingId|listing_id)[^\`\n]*\.(webp|jpg|png|avif)" \
       packages/media --include='*.ts' --exclude='*.test.ts'
fi

say "9 · Realtime solo en panel autenticado  (§1, nunca anonimo)"
if [ -n "$SRC_STOREFRONT" ]; then
  hits "sin Realtime en la vidriera" "(\.channel\(|realtime|subscribe\(\))" $SRC_STOREFRONT
fi

say "10 · stack cerrado  (§3, rechazo automatico)"
BANNED=$(grep -rhoE '"(@prisma/[a-z-]+|prisma|mongodb|mongoose|firebase|@nestjs/[a-z-]+|@pinecone-database/[a-z-]+|langchain|cloudinary)"' \
         --include='package.json' apps packages 2>/dev/null | sort -u || true)
[ -z "$BANNED" ] && ok "sin dependencias prohibidas" || { bad "dependencia prohibida:"; echo "$BANNED" | sed 's/^/        /'; }

say "11 · LLM: nunca frontier en el hot path, y nada de modelos retirados  (§3)"
if [ -n "$SRC_AI" ]; then
  hits "sin claude-*/gpt-4/gpt-5 en packages/ai" \
       "(claude-[a-z0-9.-]+|gpt-4[a-z0-9.-]*|gpt-5[a-z0-9.-]*|o[1-4]-(mini|preview))" \
       $SRC_AI --include='*.ts' --exclude='*.test.ts' --exclude='*.eval.ts'
  hits "sin llama-3.1-8b-instant (retirado el 16/08/2026)" \
       "llama-3\.1-8b-instant" $SRC_AI
  # Los IDs van por env var: hubo dos deprecaciones en tres meses.
  hits "sin ID de modelo hardcodeado como constante" \
       "(MODEL|model)\s*[:=]\s*'(gemini|openai/|groq/|llama)" $SRC_AI --include='*.ts' --exclude='*.test.ts'
else ok "todavia no hay packages/ai"
fi

say "12 · secretos que no pueden llegar al browser  (§5)"
# Mismo criterio que la regla 7: un test puede nombrar `NEXT_PUBLIC_R2_SECRET_ACCESS_KEY`
# justamente para exigir que el parser de env lo rechace. Eso no llega a ningun bundle.
PUB=$(grep -rhoE 'NEXT_PUBLIC_[A-Z0-9_]+' --include='*.ts' --include='*.tsx' \
      --exclude='*.test.ts' --exclude='*.test.tsx' apps packages 2>/dev/null | sort -u || true)
BADPUB=$(echo "$PUB" | grep -E '(SECRET|SERVICE_ROLE|PRIVATE|TOKEN|PASSWORD|_KEY$)' \
         | grep -vE 'NEXT_PUBLIC_(SUPABASE_ANON_KEY|POSTHOG_KEY)$' || true)
[ -z "$BADPUB" ] && ok "ningun NEXT_PUBLIC_* sospechoso" || { bad "NEXT_PUBLIC_ con pinta de secreto:"; echo "$BADPUB" | sed 's/^/        /'; }
[ -n "$PUB" ] && printf '        (auditar a mano: %s)\n' "$(echo "$PUB" | tr '\n' ' ')"

say "13 · Capa 1 no incluye estas cosas  (§0.6, prohibido en Capa 1)"
hits "sin ARCA/AFIP, WhatsApp Business API, MercadoLibre ni carrito" \
     "\b(afip|arca|whatsapp[_-]?business[_-]?api|WABA|mercadolibre|mercado_libre|addToCart|checkout_?cart)\b" \
     $SRC_ALL --include='*.ts' --include='*.tsx'

say "14 · todo regex de slug del repo es uno de los que define packages/domain"
# Vive en packages/db (SQL, no puede importar TS), packages/domain, (app) y (storefront).
# Ningun owner puede arreglar una divergencia solo, y divergir no rompe nada visible: el slug
# entra a la DB y despues `storefrontTag()` tira en produccion al construir el tag. Falla tarde
# y en el unico lugar donde no hay nadie mirando.
#
# ── Reescrita por el LEAD el 2026-08-28, y el motivo importa mas que el codigo ────────────────
# La version anterior exigia UNA sola forma en todo el repo. Nacio cuando el unico slug era el de
# tenant, y S3 demostro que la premisa se vencio: el slug de una FICHA vive en el path, no en el
# host, asi que no es un label DNS y no le aplica el techo de 32. El seed tiene una fila con un
# slug de 37 caracteres (`iphone-15-pro-max-256-titanio-natural`); validarla con la regla del
# subdominio devuelve 404 sobre un equipo publicado y legible por `anon`. O sea: la regla vieja
# empujaba hacia un bug de producto.
#
# La correccion NO es aflojar la regla hasta que de verde -- eso es exactamente lo que esta regla
# existe para impedir. Es cambiar el criterio por el PROPOSITO: no "una sola forma", sino **una
# sola FUENTE**. `packages/domain` declara las formas legitimas (es TS puro, cero I/O, y lo pueden
# importar los tres owners que quedan); cualquier otro archivo del repo tiene que repetir una de
# ellas textualmente, nunca inventar una tercera. El SQL de `packages/db` no puede importar, por
# eso se compara texto y no identidad de simbolo.
#
# Con esto la regla se vuelve mas fuerte, no mas debil: antes cubria un slug, ahora cubre todas
# las familias que domain declare, y ademas exige que la definicion viva en domain.
#
# ── Endurecida por el LEAD el mismo dia, y el hallazgo vino del propio subagente ──────────────
# `domain-agent` cerro la version de arriba en verde y despues aviso: la copia textual del regex
# que vive en `apps/web/app/(storefront)/_lib/listing-slug.ts` **sigue ahi** y la regla no la ve,
# porque repite una forma que domain declara y por lo tanto no es huerfana. Tenia razon: la regla
# medía divergencia, y la divergencia no es la enfermedad — es el sintoma. La enfermedad es la
# **segunda definicion**, que hoy coincide y manana la edita uno solo de los dos owners.
#
# Queda partida en dos, y las dos tienen que dar verde:
#   14a  ningun `.ts` fuera de `packages/domain/src/slug*.ts` escribe un regex de slug. Puede
#        importarlo: domain es TS puro, cero I/O, y lo importan los tres owners que quedan.
#   14b  todo regex de slug en un `.sql` es uno de los que domain declara. El SQL no puede
#        importar TS, asi que ahi la copia es legitima y lo unico exigible es que no invente.
SLUGRE='\[a-z0-9\]\(\?:\[a-z0-9-\]\{[0-9]+,[0-9]+\}\[a-z0-9\]\)[$]'
CANON=$(grep -ohE "$SLUGRE" packages/domain/src/slug.ts 2>/dev/null | sort -u || true)
NC=$(echo "$CANON" | grep -c . || true)

# Ausencia de medicion = FAIL, nunca PASS. Si domain no declara ninguna forma, la regla no midio.
if [ "$NC" -eq 0 ]; then
  bad "packages/domain/src/slug.ts no declara ningun regex de slug — se renombro o se borro?"
else
  # 14a · una sola definicion en TS. Dos exenciones, y las dos son por MOTIVO, no por conveniencia:
  #   - dentro de un template `sql`...`` es texto SQL viviendo en un .ts. `packages/db` no importa
  #     `packages/domain` a proposito, asi que ahi la copia es la unica opcion.
  #   - un archivo que declara el marcador de abajo copia el regex A PROPOSITO. El caso real es un
  #     test que verifica que el proxy acepte exactamente lo que acepta la DB: si importara el
  #     simbolo seria tautologico y no probaria nada. Es el mismo principio que hace que un gate no
  #     pueda ser del writer que audita. La exencion se declara EN EL ARCHIVO, no en este gate:
  #     asi el motivo viaja al lado del codigo y no hay una allowlist secreta acá.
  MARCA='guard-leaks:slug-copia-deliberada'
  COPIAS=""
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    case "$f" in packages/domain/src/slug*) continue ;; esac
    grep -qF "$MARCA" "$f" && continue
    # se ignoran las lineas donde el regex viaja adentro de un template sql``
    grep -nE "$SLUGRE" "$f" | grep -qvE 'sql\s*`' && COPIAS="${COPIAS}${f}"$'\n'
  done < <(grep -rlE "$SLUGRE" --include='*.ts' packages apps 2>/dev/null | sort -u)
  if [ -z "${COPIAS//[$'\n\t ']/}" ]; then
    ok "14a · el regex de slug se escribe en UN solo .ts: packages/domain/src/slug.ts"
  else
    bad "14a · hay .ts que redefinen el regex de slug en vez de importarlo de @istock/domain:"
    echo "$COPIAS" | sed '/^$/d;s/^/          /'
    echo "          (copia deliberada? el archivo tiene que decir por que: // $MARCA — motivo)"
  fi

  # 14b · el SQL no puede importar, pero tampoco puede inventar.
  SQLRE=$(grep -rhoE "$SLUGRE" --include='*.sql' packages apps 2>/dev/null | sort -u || true)
  HUERF=$(comm -23 <(echo "$SQLRE") <(echo "$CANON") | grep -c . || true)
  if [ "$HUERF" -eq 0 ]; then
    ok "14b · $NC forma(s) en domain y ningun .sql inventa una propia"
    echo "$CANON" | sed 's/^/        /'
  else
    bad "14b · hay $HUERF regex de slug en SQL que packages/domain no declara:"
    comm -23 <(echo "$SQLRE") <(echo "$CANON") | while IFS= read -r r; do
      [ -z "$r" ] && continue
      echo "          $r"
      grep -rlE "$(printf '%s' "$r" | sed 's/[][\.*^$(){}?+|/]/\\&/g')" \
        --include='*.sql' packages apps 2>/dev/null | sed 's/^/            en /'
    done
  fi
fi


say "15 . afirmaciones de 404 sin ADR que las respalde  (ADR-011 vidriera / ADR-013-014 panel)"
# Por que existe esta regla: ADR-011 cambio una respuesta observable, y la afirmacion vieja estaba
# escrita en 7 archivos de 5 columnas distintas -- incluida la MIA (el brief del workflow, que la
# re-inyectaba en cada corrida). Ningun owner podia verlo desde su columna. El comentario stale no
# rompe CI: rompe al proximo que lo lee y reimplementa la variante A.
#
# Se permite nombrar la afirmacion vieja si el parrafo cita ADR-011 (o esta tachado / marcado como
# superado): eso es historia, no una afirmacion vigente.
#
# POR QUE NO ES UN grep POR LINEA. La primera version lo era, y se le escaparon 4 afirmaciones que
# estaban partidas por un salto de linea en medio de un docblock -- una de ellas decia que el miss
# se cachea con cacheLife('max'), que es falso por partida doble. Un guard que se esquiva con
# Enter no guarda. Esto agrupa las lineas de comentario contiguas en un parrafo y matchea contra
# el parrafo, reportando la linea donde arranca.
#
# La lista de archivos sale de `git ls-files --cached --others --exclude-standard`: tracked mas
# untracked-no-ignorados. Eso excluye solo node_modules, .next y e2e/test-results.
STALE=$(git ls-files --cached --others --exclude-standard -- '*.ts' '*.tsx' '*.js' '*.md' '*.sh' '*.sql' 2>/dev/null \
  | grep -v '^scripts/guard-leaks\.sh$' \
  | python3 -c '
import sys,re
# DOS NIVELES, y la diferencia importa. La version anterior tenia UNA sola lista de exenciones y
# por eso daba FALSO POSITIVO sobre el PANEL: ahi un "404 real" es correcto y esta decidido por
# ADR-013/ADR-014, no por ADR-011 -- citar ADR-011 en ese parrafo seria citar mal. Lo disparo el
# 2026-08-28 contra e2e/s2-...spec.ts:315, que hablaba de `stock/[id]/fotos`.
#   MISS  la afirmacion es sobre un slug inexistente de la VIDRIERA -> solo ADR-011 la exime.
#         Es la afirmacion que ADR-011 derogo; citar ADR-013 ahi no la hace verdadera.
#   REAL  un "404 real" a secas -> lo exime cualquiera de los tres ADRs que deciden semantica de
#         404 en este repo. Sourced es sourced; lo que la regla persigue es la afirmacion HUERFANA.
MISS = re.compile(r"(slug inexistente|slug que no existe)[^.]{0,120}?404|404 cacheado", re.I)
PAT  = re.compile(r"(slug inexistente|slug que no existe)[^.]{0,120}?404|404 cacheado|404 REAL|404 real", re.I)
EXE  = re.compile(r"ADR-011|~~|supersed|superad", re.I)
EXE2 = re.compile(r"ADR-011|ADR-013|ADR-014|~~|supersed|superad", re.I)
CMT = re.compile(r"^\s*(\*|/\*|//|#|--)")
out = []
for path in (l.strip() for l in sys.stdin if l.strip()):
    try: lines = open(path, encoding="utf-8", errors="replace").read().split("\n")
    except OSError: continue
    md = path.endswith(".md")
    i, n = 0, len(lines)
    while i < n:
        # un parrafo: en .md, lineas no vacias contiguas; en codigo, lineas de comentario contiguas
        joinable = (lines[i].strip() != "") if md else bool(CMT.match(lines[i]))
        j = i
        if joinable:
            while j + 1 < n and ((lines[j+1].strip() != "") if md else bool(CMT.match(lines[j+1]))):
                j += 1
        # sacar el lider del comentario ANTES de unir: si no, "404\n * cacheado" queda
        # como "404 * cacheado" y no matchea. Lo encontro el test negativo de esta misma regla.
        para = " ".join(re.sub(r"^\s*(\*/|/\*+|\*|//+|#|--)\s?", "", x) for x in lines[i:j+1])
        exempt = EXE.search(para) if MISS.search(para) else EXE2.search(para)
        if PAT.search(para) and not exempt:
            # anclar en la linea que trae el 404, no en el "/**" que abre el docblock
            k = next((x for x in range(i, j + 1) if "404" in lines[x]), i)
            snippet = re.sub(r"\s+", " ", lines[k].strip())[:110]
            out.append("%s:%d: %s" % (path, k + 1, snippet))
        i = j + 1
print("\n".join(out))
' || true)
STALE=$(echo "$STALE" | grep -v '^$' || true)
if [ -z "$STALE" ]; then ok "nadie afirma que el slug inexistente da 404"
else bad "afirmacion sobre un 404 sin ADR que la respalde (vidriera: ADR-011 · panel: ADR-013/014):"; echo "$STALE" | sed 's/^/        /'; fi

echo
[ "$fail" -eq 0 ] && echo "GUARD-LEAKS: PASS" || echo "GUARD-LEAKS: FAIL"
exit "$fail"
