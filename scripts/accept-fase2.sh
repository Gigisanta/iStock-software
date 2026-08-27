#!/usr/bin/env bash
# Comando de aceptacion de FASE 2, re-ejecutable por el LEAD (regla dura 2).
# No cree al subagente: esto es lo que decide si D1/D2/D3/D4 pasan.
set -uo pipefail
DB="${ISTOCK_DB:-istock_dev}"
URL="postgresql://$(whoami)@localhost:5432/${DB}"
fail=0
ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=1; }
head() { printf '\n\033[1m%s\033[0m\n' "$1"; }

head "D1 · packages/domain existe y es PURO"
for f in packages/domain/package.json packages/domain/tsconfig.json; do
  [ -s "$f" ] && ok "$f" || bad "falta o vacio: $f"
done
# Un import de I/O en domain es fallo de arquitectura, no de estilo.
# strip_comments: un match dentro de un comentario no es I/O. Se filtra por linea, no por archivo.
strip_comments() { grep -vE "^\s*(//|\*|/\*)" || true; }
DIRT=$(grep -rnE "from ['\"](next|drizzle-orm|@supabase|@istock/db|node:fs|node:crypto)|process\.env|\bfetch\(" \
        packages/domain/src 2>/dev/null | grep -v '\.test\.' | sed 's/^[^:]*:[0-9]*://' \
        | strip_comments || true)
[ -z "$DIRT" ] && ok "cero I/O en packages/domain/src" || { bad "packages/domain hace I/O:"; echo "$DIRT" | sed 's/^/        /'; }
# now/rate inyectados: Date.now() adentro de una funcion pura la vuelve no-testeable
IMPURE=$(grep -rnE "Date\.now\(\)|new Date\(\)" packages/domain/src 2>/dev/null | grep -v '\.test\.' \
        | sed 's/^[^:]*:[0-9]*://' | strip_comments || true)
[ -z "$IMPURE" ] && ok "cero reloj propio (now se inyecta)" || { bad "reloj dentro de domain:"; echo "$IMPURE" | sed 's/^/        /'; }
for fn in applyFx buildWaMessage canTransition expireReservation publicListingDTO sanitizeDescription; do
  grep -rqE "export (function|const) $fn" packages/domain/src 2>/dev/null \
    && ok "export $fn" || bad "no exporta $fn"
  grep -rqE "\b$fn\b" packages/domain/src --include='*.test.ts' 2>/dev/null \
    && ok "test de $fn" || bad "$fn sin test"
done

head "D2 · schema + RLS aplican limpio contra Postgres real"
./scripts/pg-local.sh --drop >/dev/null 2>&1 || bad "pg-local.sh no corrio"
if DATABASE_URL="$URL" pnpm --filter @istock/db migrate >/tmp/istock-migrate.log 2>&1; then
  ok "migraciones aplican sobre base vacia"
else
  bad "migraciones fallan (ver /tmp/istock-migrate.log)"; tail -20 /tmp/istock-migrate.log | sed 's/^/        /'
fi
Q() { psql -d "$DB" -tAc "$1" 2>/dev/null | tr -d ' '; }
TABLES=$(Q "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname not like '__drizzle%'")
RLS=$(Q    "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity and c.relname not like '__drizzle%'")
FORCED=$(Q "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relforcerowsecurity")
echo "        tablas=$TABLES  rls=$RLS  forced=$FORCED"
NORLS=$(psql -d "$DB" -tAc "select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity and c.relname not like '__drizzle%' order by 1" 2>/dev/null | tr '\n' ' ')
# Unica excepcion permitida: los dos catalogos globales.
if [ "$(echo "$NORLS" | tr -d ' ')" = "catalog_faqscatalog_models" ] || [ -z "$(echo "$NORLS" | tr -d ' ')" ]; then
  ok "toda tabla de negocio con RLS (sin RLS: ${NORLS:-ninguna})"
else
  bad "tablas de negocio SIN RLS: $NORLS"
fi
# lint 0007 de Supabase: policies escritas con RLS apagado. Es el que parece hecho y no lo esta.
L0007=$(psql -d "$DB" -tAc "select distinct p.tablename from pg_policies p join pg_class c on c.relname=p.tablename join pg_namespace n on n.oid=c.relnamespace and n.nspname=p.schemaname where p.schemaname='public' and not c.relrowsecurity" 2>/dev/null | tr '\n' ' ')
[ -z "$(echo "$L0007" | tr -d ' ')" ] && ok "lint 0007: sin policies huerfanas" || bad "lint 0007: policies con RLS apagado en $L0007"
# using(true) es RLS decorativa
TRUEPOL=$(psql -d "$DB" -tAc "select tablename||'.'||policyname from pg_policies where schemaname='public' and (qual='true' or with_check='true')" 2>/dev/null | tr '\n' ' ')
[ -z "$(echo "$TRUEPOL" | tr -d ' ')" ] && ok "ninguna policy con using/with check (true)" || bad "policy permisiva: $TRUEPOL"
# ADR-005: auth.jwt() SIEMPRE en subquery, y TO authenticated siempre.
NOSUB=$(psql -d "$DB" -tAc "select tablename||'.'||policyname from pg_policies where schemaname='public' and (qual like '%auth.jwt%' or with_check like '%auth.jwt%') and coalesce(qual,'')||coalesce(with_check,'') not like '%( SELECT%'" 2>/dev/null | tr '\n' ' ')
[ -z "$(echo "$NOSUB" | tr -d ' ')" ] && ok "ADR-005: auth.jwt() siempre en subquery" || bad "auth.jwt() sin subquery en: $NOSUB"
NOROLE=$(psql -d "$DB" -tAc "select tablename||'.'||policyname from pg_policies where schemaname='public' and not ('authenticated' = any(roles))" 2>/dev/null | tr '\n' ' ')
[ -z "$(echo "$NOROLE" | tr -d ' ')" ] && ok "ADR-005: toda policy TO authenticated" || bad "policy sin TO authenticated: $NOROLE"
# indice en tenant_id: sin esto RLS escanea la tabla entera en cada query
NOIDX=$(psql -d "$DB" -tAc "select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attname='tenant_id' where n.nspname='public' and c.relkind='r' and not exists (select 1 from pg_index i where i.indrelid=c.oid and a.attnum = any(i.indkey)) order by 1" 2>/dev/null | tr '\n' ' ')
[ -z "$(echo "$NOIDX" | tr -d ' ')" ] && ok "ADR-005: tenant_id indexado en toda tabla" || bad "tenant_id sin indice en: $NOIDX"

head "D4 · seed demo"
if DATABASE_URL="$URL" pnpm --filter @istock/db seed >/tmp/istock-seed.log 2>&1; then
  N=$(Q "select count(*) from listings"); R=$(Q "select count(*) from listings where status='reserved'")
  [ "${N:-0}" -ge 10 ] && ok "seed: $N listings" || bad "seed: solo ${N:-0} listings (esperado >=10)"
  [ "${R:-0}" -ge 1 ]  && ok "seed: $R reserved"  || bad "seed: sin listing reserved"
else
  bad "seed falla (ver /tmp/istock-seed.log)"; tail -15 /tmp/istock-seed.log | sed 's/^/        /'
fi

head "D3 · typecheck + tests (incluye RLS cruzado)"
pnpm -r typecheck >/tmp/istock-tc.log 2>&1 && ok "pnpm typecheck" || { bad "typecheck rojo"; tail -25 /tmp/istock-tc.log | sed 's/^/        /'; }
DATABASE_URL="$URL" pnpm -r test >/tmp/istock-test.log 2>&1 && ok "pnpm test" || { bad "tests rojos"; tail -30 /tmp/istock-test.log | sed 's/^/        /'; }
grep -qiE "skip|todo" /tmp/istock-test.log && printf '  \033[33mNOTA\033[0m  hay tests skipeados, revisar motivo\n' || true

head "RESULTADO"
[ "$fail" -eq 0 ] && echo "FASE 2: PASS" || echo "FASE 2: FAIL"
exit "$fail"
