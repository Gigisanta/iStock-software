#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════════════════════
#  ARNES DE POLARIDAD de `guard-tradein-engine.sh`.
#  gate-owner: LEAD
#
#  Un gate que solo se vio verde no es evidencia: es un adorno que todavia no delato. Este repo ya
#  catalogo cinco verdes vacuos (rls-lint sin `ALTER POLICY`, guard-routes fuera de ci.yml,
#  accept-fase2 semanas en rojo sin que nadie lo viera, ...). Asi que cada afirmacion del guard se
#  prueba en las DOS direcciones: verde cuando el arbol esta bien, y rojo NOMBRANDO LA CAUSA
#  cuando se lo rompe. Que encienda no alcanza; tiene que decir por que.
#
#  El fixture F2 no es una variante mas: es la REGRESION del borde entre archivos. El ultimo
#  statement de un `.sql` no lleva `--> statement-breakpoint`, asi que un censo ingenuo pega el
#  final de la 0008 con el principio de la 0009 en un mismo registro — y entonces un
#  `WITH CHECK (true)` HEREDA el `accepts_trade_in` del statement anterior y el guard da verde
#  mintiendo. Es el modo de falla exacto que el LEAD encontro prototipando antes de instalar.
# ══════════════════════════════════════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")/.."
GUARD="$PWD/scripts/guard-tradein-engine.sh"

pass=0; fail=0
POL_OK='CREATE POLICY "tradein_leads_storefront_insert" ON "tradein_leads" TO anon WITH CHECK (tenant_id = (select public.storefront_tenant_id()) and exists (select 1 from tenants t where t.id = tradein_leads.tenant_id and t.accepts_trade_in));'
TRG_OK='CREATE CONSTRAINT TRIGGER "tradein_leads_accepted_has_listing" AFTER INSERT OR UPDATE OF "status" ON "tradein_leads" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW."status" = '"'"'accepted'"'"') EXECUTE FUNCTION public.tradein_leads_accepted_has_listing();'

# caso <nombre> <esperado PASS|FAIL> <fragmento que el mensaje tiene que nombrar>
caso() {
  local nombre="$1" esperado="$2" frag="${3:-}"
  local out rc
  out=$("$GUARD" "$DIR" 2>&1); rc=$?
  local got; if [ "$rc" = "0" ]; then got=PASS; else got=FAIL; fi
  if [ "$got" != "$esperado" ]; then
    fail=$((fail+1)); printf '  ✗ %-46s esperaba %s, dio %s\n' "$nombre" "$esperado" "$got"
    printf '%s\n' "$out" | sed 's/^/       /'
  elif [ -n "$frag" ] && ! printf '%s' "$out" | grep -qF "$frag"; then
    fail=$((fail+1)); printf '  ✗ %-46s %s correcto pero el mensaje no nombra la causa: %s\n' "$nombre" "$esperado" "$frag"
    printf '%s\n' "$out" | sed 's/^/       /'
  else
    pass=$((pass+1)); printf '  ✓ %-46s %s\n' "$nombre" "$esperado"
  fi
}

nuevo() {  # arbol sano de dos migraciones; la 0008 NO cierra con breakpoint, igual que el real
  DIR=$(mktemp -d)
  printf -- '-- 0008\nCREATE TABLE "tradein_leads" ("id" uuid);\n--> statement-breakpoint\n%s\n' "$POL_OK" > "$DIR/0008_x.sql"
  printf -- '-- 0009\nALTER TABLE "listings" ADD COLUMN "acquisition_channel" text;\n--> statement-breakpoint\n%s\n' "$TRG_OK" > "$DIR/0009_y.sql"
}
add() { printf -- '%s\n' "$1" > "$DIR/0010_z.sql"; }

echo '── guard-tradein-engine · polaridad ──────────────────────────────────────────'

nuevo; caso 'arbol sano' PASS 'GUARD-TRADEIN-ENGINE: PASS'

# F2 · REGRESION DEL BORDE: la 0008 deja la policy buena y la 0009 la afloja, sin breakpoint entre
# archivos. Si el censo pegara los dos archivos, el `WITH CHECK (true)` heredaria el
# `accepts_trade_in` de la linea anterior y esto daria verde.
nuevo
printf -- '-- 0009\nALTER POLICY "tradein_leads_storefront_insert" ON "tradein_leads" TO anon WITH CHECK (true);\n--> statement-breakpoint\n%s\n' "$TRG_OK" > "$DIR/0009_y.sql"
caso 'borde entre archivos: ALTER afloja en la 0009' FAIL 'NO nombra `accepts_trade_in`'

nuevo; add 'ALTER POLICY "tradein_leads_storefront_insert" ON "tradein_leads" TO anon WITH CHECK (tenant_id = (select public.storefront_tenant_id()));'
caso 'la 0010 afloja la policy' FAIL 'NO nombra `accepts_trade_in`'

nuevo; add 'DROP POLICY "tradein_leads_storefront_insert" ON "tradein_leads";'
caso 'la 0010 dropea la policy' FAIL 'es un DROP'

nuevo; add 'DROP TRIGGER "tradein_leads_accepted_has_listing" ON "tradein_leads";'
caso 'la 0010 dropea el trigger' FAIL 'el ultimo statement del trigger es un DROP'

nuevo; add 'CREATE TRIGGER "tradein_leads_accepted_has_listing" AFTER INSERT ON "tradein_leads" FOR EACH ROW EXECUTE FUNCTION public.f();'
caso 'el trigger deja de ser CONSTRAINT' FAIL 'dejo de ser un CONSTRAINT TRIGGER'

nuevo; add 'CREATE CONSTRAINT TRIGGER "tradein_leads_accepted_has_listing" AFTER INSERT ON "tradein_leads" FOR EACH ROW EXECUTE FUNCTION public.f();'
caso 'el trigger deja de ser DEFERRABLE' FAIL 'dejo de ser DEFERRABLE'

nuevo; add 'CREATE CONSTRAINT TRIGGER "tradein_leads_accepted_has_listing" AFTER INSERT ON "tradein_leads" DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION public.f();'
caso 'DEFERRABLE pero INITIALLY IMMEDIATE' FAIL 'no INITIALLY DEFERRED'

nuevo; add 'GRANT SELECT ("acquisition_channel") ON "listings" TO "anon";'
caso 'le otorgan acquisition_channel a anon' FAIL 'dato interno del dueño'

nuevo; rm "$DIR"/0008_x.sql
caso 'sin la policy: ausencia es FAIL, no PASS' FAIL 'Ausencia = FAIL, nunca PASS'

nuevo; rm "$DIR"/0009_y.sql
caso 'sin el trigger: ausencia es FAIL' FAIL 'Ausencia = FAIL'

DIR=$(mktemp -d); caso 'directorio vacio' FAIL 'Ausencia = FAIL'
DIR="$(mktemp -d)/no-existe"; caso 'directorio inexistente' FAIL 'no existe el directorio'

nuevo; add "$POL_OK -- lo dejo asi por ahora"
caso 'comentario colgando: el censo se declara ciego' FAIL 'deja de ser confiable'

# El arbol REAL, que es el que le importa al gate de S8.
DIR=packages/db/drizzle; caso 'el arbol real del repo' PASS 'GUARD-TRADEIN-ENGINE: PASS'

echo '──────────────────────────────────────────────────────────────────────────────'
printf '%d ok · %d fallando\n' "$pass" "$fail"
[ "$fail" = "0" ] || exit 1
