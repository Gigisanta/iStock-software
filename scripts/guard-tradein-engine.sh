#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════════════════════
#  GUARD · las invariantes del canje que S8.1 mudo al MOTOR siguen en el arbol de migraciones.
#  gate-owner: LEAD (CLAUDE.md §4 — el gate no puede ser del writer que audita)
#
#  ── Por que existe este archivo y no es una seccion de `rls-lint` ────────────────────────────
#  La migracion 0009 movio al motor dos reglas que hasta entonces vivian solo en `apps/web`:
#
#    (1) el tenant tiene el canje prendido  →  `ALTER POLICY ... and exists (... accepts_trade_in)`
#    (2) un lead `accepted` tiene unidad     →  CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED
#
#  La (2) no es una policy y no es un CHECK. No es un CHECK a proposito: un CHECK no se puede
#  diferir y habria explotado en la PRIMERA sentencia de `acceptToStock()`, que escribe el status
#  antes que la unidad porque ese update ES el guard de concurrencia. Aceptar un canje habria
#  pasado a ser un 500.
#
#  `db-agent` lo levanto y PIDIO en vez de editar: `rls-lint` audita `CREATE`/`ALTER POLICY` y no
#  ve triggers, asi que la invariante (2) estaba sostenida solo por su propio test y por el `DO`
#  de la propia migracion — o sea por el writer, en las dos puntas. La respuesta del LEAD es que
#  NO va a `rls-lint`: el sujeto de ese lint son las policies, y estirarlo a triggers lo diluye
#  hasta que deje de significar algo. Vive aca, con su propio arnes de polaridad.
#
#  ── Que se censa, y por que el ARBOL y no la base ────────────────────────────────────────────
#  El migrador de Drizzle decide que aplicar comparando `created_at`, NO el hash del archivo
#  (CLAUDE.md §3). O sea que la base puede estar mintiendo — paso de verdad: `istock_dev` tenia la
#  0009 aplicada a medias, sin trigger ni backfill, con `migrate` diciendo OK. El `.sql`
#  commiteado es la unica verdad que sobrevive a eso.
#
#  Y se toma el ULTIMO statement que define cada objeto, no cualquiera. El agujero que esto
#  persigue no es el de hoy: es la 0012 que dropea el trigger, o que hace
#  `ALTER POLICY ... WITH CHECK (true)` para "arreglar" un test. Un `grep -c` daria verde con el
#  statement que lo desarma tres lineas mas abajo.
#
#  Uso:  scripts/guard-tradein-engine.sh [dir_de_migraciones]
#        (default `packages/db/drizzle`; el argumento existe para el arnes de polaridad)
# ══════════════════════════════════════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")/.."

DRZ="${1:-packages/db/drizzle}"
fail=0
no() { fail=1; printf 'FALLA: %s\n' "$1"; }
ok() {          printf 'OK: %s\n'    "$1"; }

if [ ! -d "$DRZ" ]; then
  no "no existe el directorio de migraciones: $DRZ"
  printf '\nGUARD-TRADEIN-ENGINE: FAIL\n'; exit 1
fi

# El censo separa prosa de SQL por linea completa. En este arbol toda la prosa son comentarios de
# linea entera y ningun literal contiene `--` (verificado). Si eso deja de ser cierto el censo se
# vuelve poco confiable, y entonces lo DICE en vez de seguir contando: un censo que no sabe lo que
# esta leyendo es peor que ninguno, porque tranquiliza.
INLINE=$(grep -nE '^[^-]*[^ -]+[^-]*--' "$DRZ"/0*.sql 2>/dev/null | grep -vE '^\S+:[0-9]+:[[:space:]]*--' | grep -vE '\-\->' || true)
if [ -n "$INLINE" ]; then
  no 'hay comentarios `--` colgando despues de SQL: este censo separa prosa por linea completa y con esto deja de ser confiable'
  printf '%s\n' "$INLINE" | head -5 | sed 's/^/        /'
fi

STMTS=$(mktemp)
# `FNR==1 && NR>1` cierra el borde ENTRE archivos: el ultimo statement de un `.sql` no lleva
# `--> statement-breakpoint`, asi que sin esto el `CREATE POLICY` de 0008 y el `ALTER` de 0009
# quedaban en el mismo registro y "el ultimo gana" dejaba de significar nada. Lo encontro el LEAD
# probando el censo antes de instalarlo, que es exactamente para lo que se prueba un censo.
awk 'FNR==1 && NR>1 {printf "\n"} /^[[:space:]]*--/ && !/-->/ {next} {gsub(/\r/,""); printf "%s ", $0}' \
  "$DRZ"/0*.sql 2>/dev/null | sed 's/--> statement-breakpoint/\n/g' > "$STMTS"

# ── 1 · el ULTIMO statement que define la policy del canje exige `accepts_trade_in` ────────────
POLDEF=$(grep -Ei '(create|alter|drop)[[:space:]]+policy[^;]*tradein_leads_storefront_insert' "$STMTS" | tail -1 || true)
if [ -z "$POLDEF" ]; then
  no 'cero statements que definan `tradein_leads_storefront_insert`: o la vidriera no puede recibir un canje, o el censo dejo de encontrar lo que busca. Ausencia = FAIL, nunca PASS'
elif printf '%s' "$POLDEF" | grep -qiE '^[[:space:]]*drop'; then
  no 'el ultimo statement de la policy del canje es un DROP: el flag del dueño vuelve a depender del handler'
elif printf '%s' "$POLDEF" | grep -q 'accepts_trade_in'; then
  ok 'el ultimo `CREATE`/`ALTER POLICY` del canje exige `accepts_trade_in`'
else
  no 'el ultimo statement de la policy del canje NO nombra `accepts_trade_in`: un insert como `anon` salteando el handler vuelve a entrar en un tenant con el canje apagado'
  printf '%s\n' "$POLDEF" | cut -c1-220 | sed 's/^/        /'
fi

# ── 2 · el trigger sigue siendo CONSTRAINT y sigue siendo DIFERIDO ─────────────────────────────
TRG=$(grep -Ei '(create[[:space:]]+(constraint[[:space:]]+)?trigger|drop[[:space:]]+trigger)[^;]*tradein_leads_accepted_has_listing' "$STMTS" | tail -1 || true)
if [ -z "$TRG" ]; then
  no 'cero statements del trigger `tradein_leads_accepted_has_listing`: `accepted` sin unidad creada no lo frena nadie. Ausencia = FAIL'
elif printf '%s' "$TRG" | grep -qiE '^[[:space:]]*drop'; then
  no 'el ultimo statement del trigger es un DROP: media operacion vuelve a ser un estado alcanzable'
elif ! printf '%s' "$TRG" | grep -qiE 'constraint[[:space:]]+trigger'; then
  no 'el trigger dejo de ser un CONSTRAINT TRIGGER: sin eso no se puede diferir'
elif ! printf '%s' "$TRG" | grep -qi 'deferrable'; then
  no 'el trigger dejo de ser DEFERRABLE: se evaluaria por sentencia y rompe el orden de escritura de `acceptToStock()` — aceptar un canje pasa a ser un 500'
elif ! printf '%s' "$TRG" | grep -qiE 'initially[[:space:]]+deferred'; then
  no 'el trigger es DEFERRABLE pero no INITIALLY DEFERRED: habria que pedirlo por transaccion y nadie lo pide'
else
  ok 'el trigger de `accepted ⇒ unidad creada` sigue siendo constraint, deferrable e initially deferred'
fi

# ── 3 · la columna nueva no se filtro a la vidriera ────────────────────────────────────────────
# `acquisition_channel` nace invisible para `anon` porque el GRANT de 0002 es POR COLUMNA y un
# GRANT de columna no alcanza a las columnas futuras. Eso es una propiedad feliz, no una decision
# escrita, asi que se la escribe aca: publicarla tiene que ser una migracion deliberada.
CANAL=$(grep -Ei 'grant[^;]*acquisition_channel[^;]*to[^;]*anon' "$STMTS" || true)
if [ -n "$CANAL" ]; then
  no 'alguien le otorgo `acquisition_channel` a `anon`: de donde salio una unidad es dato interno del dueño, no de la ficha publica'
  printf '%s\n' "$CANAL" | cut -c1-220 | sed 's/^/        /'
else
  ok 'cero GRANT de `acquisition_channel` a `anon`'
fi

rm -f "$STMTS"
printf '\n'
if [ "$fail" = "0" ]; then printf 'GUARD-TRADEIN-ENGINE: PASS\n'; else printf 'GUARD-TRADEIN-ENGINE: FAIL\n'; fi
exit "$fail"
