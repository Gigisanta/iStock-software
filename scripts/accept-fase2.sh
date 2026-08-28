#!/usr/bin/env bash
# Comando de aceptacion de FASE 2, re-ejecutable por el LEAD (regla dura 2).
# No cree al subagente: esto es lo que decide si D1/D2/D3/D4 pasan.
set -uo pipefail
DB="${ISTOCK_DB:-istock_dev}"
# `DATABASE_URL` gana si ya viene del entorno. En la maquina del dev no esta y se arma con
# `whoami`, que es el dueno de la base que crea `scripts/pg-local.sh`; en CI si esta, y ahi
# `whoami` es `runner`, que no es un rol de Postgres — armarla a mano haria fallar el seed de D4
# por una razon que no tiene nada que ver con lo que este gate mide.
URL="${DATABASE_URL:-postgresql://$(whoami)@localhost:5432/${DB}}"
. scripts/_lib.sh   # sec/ok/no/inf/none/noneraw + el contador `fail`. Probado en scripts/_lib.test.sh

# T4 del board pedia migrar cuatro gates a `_lib.sh` y este quedo afuera, con el motivo anotado:
# `bad()` y `strip_comments()` no tenian equivalente. La primera mitad no era un motivo — `bad()`
# es `no()` con otro nombre y nada mas. La segunda si, y `strip_comments()` se queda local abajo:
# lo usa un solo gate y no hay dos copias que puedan divergir.
#
# Lo que decidio la migracion fue lo tercero, que no estaba en la lista: este gate definia
# `head()`, que **pisa el comando `head`**. Mientras fue autonomo era latente, porque nunca lo
# invocaba. Al hacer `source` de `_lib.sh` dejaba de serlo: `_veredicto()` termina en `| head -6`,
# y bash resuelve funciones en el momento de la llamada, asi que ese `head -6` habria entrado a la
# funcion del gate — un pipe a `printf '%s' "$1"` que se come la salida y devuelve 0. La regla
# habria seguido imprimiendo FAIL sin listar un solo hallazgo. Se llama `sec()` como en los otros
# cinco gates y el problema no existe.

sec "D1 · packages/domain existe y es PURO"
for f in packages/domain/package.json packages/domain/tsconfig.json; do
  [ -s "$f" ] && ok "$f" || no "falta o vacio: $f"
done
# Un import de I/O en domain es fallo de arquitectura, no de estilo.
# strip_comments: un match dentro de un comentario no es I/O. Se filtra por linea, no por archivo.
strip_comments() { grep -vE "^\s*(//|\*|/\*)" || true; }
DIRT=$(grep -rnE "from ['\"](next|drizzle-orm|@supabase|@istock/db|node:fs|node:crypto)|process\.env|\bfetch\(" \
        packages/domain/src 2>/dev/null | grep -v '\.test\.' | sed 's/^[^:]*:[0-9]*://' \
        | strip_comments || true)
[ -z "$DIRT" ] && ok "cero I/O en packages/domain/src" || { no "packages/domain hace I/O:"; echo "$DIRT" | sed 's/^/        /'; }
# now/rate inyectados: Date.now() adentro de una funcion pura la vuelve no-testeable
IMPURE=$(grep -rnE "Date\.now\(\)|new Date\(\)" packages/domain/src 2>/dev/null | grep -v '\.test\.' \
        | sed 's/^[^:]*:[0-9]*://' | strip_comments || true)
[ -z "$IMPURE" ] && ok "cero reloj propio (now se inyecta)" || { no "reloj dentro de domain:"; echo "$IMPURE" | sed 's/^/        /'; }
for fn in applyFx buildWaMessage canTransition expireReservation publicListingDTO sanitizeDescription; do
  grep -rqE "export (function|const) $fn" packages/domain/src 2>/dev/null \
    && ok "export $fn" || no "no exporta $fn"
  grep -rqE "\b$fn\b" packages/domain/src --include='*.test.ts' 2>/dev/null \
    && ok "test de $fn" || no "$fn sin test"
done

sec "D2 · schema + RLS aplican limpio contra Postgres real"
./scripts/pg-local.sh --drop >/dev/null 2>&1 || no "pg-local.sh no corrio"
if DATABASE_URL="$URL" pnpm --filter @istock/db migrate >/tmp/istock-migrate.log 2>&1; then
  ok "migraciones aplican sobre base vacia"
else
  no "migraciones fallan (ver /tmp/istock-migrate.log)"; tail -20 /tmp/istock-migrate.log | sed 's/^/        /'
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
  no "tablas de negocio SIN RLS: $NORLS"
fi
# lint 0007 de Supabase: policies escritas con RLS apagado. Es el que parece hecho y no lo esta.
L0007=$(psql -d "$DB" -tAc "select distinct p.tablename from pg_policies p join pg_class c on c.relname=p.tablename join pg_namespace n on n.oid=c.relnamespace and n.nspname=p.schemaname where p.schemaname='public' and not c.relrowsecurity" 2>/dev/null | tr '\n' ' ')
[ -z "$(echo "$L0007" | tr -d ' ')" ] && ok "lint 0007: sin policies huerfanas" || no "lint 0007: policies con RLS apagado en $L0007"
# using(true) es RLS decorativa
TRUEPOL=$(psql -d "$DB" -tAc "select tablename||'.'||policyname from pg_policies where schemaname='public' and (qual='true' or with_check='true')" 2>/dev/null | tr '\n' ' ')
[ -z "$(echo "$TRUEPOL" | tr -d ' ')" ] && ok "ninguna policy con using/with check (true)" || no "policy permisiva: $TRUEPOL"
# ADR-005: auth.jwt() SIEMPRE en subquery, y TO authenticated siempre.
NOSUB=$(psql -d "$DB" -tAc "select tablename||'.'||policyname from pg_policies where schemaname='public' and (qual like '%auth.jwt%' or with_check like '%auth.jwt%') and coalesce(qual,'')||coalesce(with_check,'') not like '%( SELECT%'" 2>/dev/null | tr '\n' ' ')
[ -z "$(echo "$NOSUB" | tr -d ' ')" ] && ok "ADR-005: auth.jwt() siempre en subquery" || no "auth.jwt() sin subquery en: $NOSUB"
# Reescrita por el LEAD el 2026-08-28. La version anterior era `not ('authenticated' = any(roles))`
# y venia **roja desde que S1 agrego las policies de la vidriera**, sin que nadie lo viera: este
# gate tampoco esta en CI (mismo agujero que `guard-routes.sh`). Las cinco policies que marcaba
# —`tenants`, `locations`, `fx_settings`, `listing_photos`, `listings`, todas
# `*_storefront_anon_select`— son `TO anon` **a proposito**: la vidriera la mira un visitante
# anonimo. Exigirles `authenticated` no arregla nada y entrena a leer el rojo como ruido, que es
# la unica forma de romper un gate sin tocarlo.
#
# Lo que la regla queria decir, y ahora dice: **ninguna policy sin `TO`**. Una policy sin `TO`
# tiene `roles = {public}` y aplica a TODOS los roles, `anon` incluido — o sea que una policy de
# panel escrita sin `TO` es una fuga a la vidriera con cara de policy correcta. Ese era el bug
# real, y `{public}` es su firma exacta.
#
# Y una segunda, que la version vieja no podia expresar: **toda policy de `anon` es de SELECT**.
# Un `INSERT`/`UPDATE`/`DELETE` para `anon` es un visitante escribiendo en la base del dueno.
TOPUBLIC=$(psql -d "$DB" -tAc "select tablename||'.'||policyname from pg_policies where schemaname='public' and 'public' = any(roles)" 2>/dev/null | tr '\n' ' ')
[ -z "$(echo "$TOPUBLIC" | tr -d ' ')" ] && ok "ADR-005: ninguna policy sin TO (roles={public} aplica a anon tambien)" \
  || no "policy sin TO, aplica a TODOS los roles: $TOPUBLIC"
ANONWRITE=$(psql -d "$DB" -tAc "select tablename||'.'||policyname||' ('||cmd||')' from pg_policies where schemaname='public' and 'anon' = any(roles) and cmd <> 'SELECT'" 2>/dev/null | tr '\n' ' ')
[ -z "$(echo "$ANONWRITE" | tr -d ' ')" ] && ok "ADR-005: toda policy de anon es SELECT (el visitante no escribe)" \
  || no "policy de ESCRITURA para anon: $ANONWRITE"
OTHERROLE=$(psql -d "$DB" -tAc "select tablename||'.'||policyname||' -> '||roles::text from pg_policies where schemaname='public' and not ('authenticated' = any(roles) or 'anon' = any(roles))" 2>/dev/null | tr '\n' ' ')
[ -z "$(echo "$OTHERROLE" | tr -d ' ')" ] && ok "ADR-005: toda policy es de authenticated o de anon, de nadie mas" \
  || no "policy con un rol inesperado: $OTHERROLE"
# indice en tenant_id: sin esto RLS escanea la tabla entera en cada query
NOIDX=$(psql -d "$DB" -tAc "select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attname='tenant_id' where n.nspname='public' and c.relkind='r' and not exists (select 1 from pg_index i where i.indrelid=c.oid and a.attnum = any(i.indkey)) order by 1" 2>/dev/null | tr '\n' ' ')
[ -z "$(echo "$NOIDX" | tr -d ' ')" ] && ok "ADR-005: tenant_id indexado en toda tabla" || no "tenant_id sin indice en: $NOIDX"

sec "D4 · seed demo"
if DATABASE_URL="$URL" pnpm --filter @istock/db seed >/tmp/istock-seed.log 2>&1; then
  N=$(Q "select count(*) from listings"); R=$(Q "select count(*) from listings where status='reserved'")
  [ "${N:-0}" -ge 10 ] && ok "seed: $N listings" || no "seed: solo ${N:-0} listings (esperado >=10)"
  [ "${R:-0}" -ge 1 ]  && ok "seed: $R reserved"  || no "seed: sin listing reserved"
else
  no "seed falla (ver /tmp/istock-seed.log)"; tail -15 /tmp/istock-seed.log | sed 's/^/        /'
fi

sec "D3 · typecheck + tests (incluye RLS cruzado)"
pnpm -r typecheck >/tmp/istock-tc.log 2>&1 && ok "pnpm typecheck" || { no "typecheck rojo"; tail -25 /tmp/istock-tc.log | sed 's/^/        /'; }
DATABASE_URL="$URL" pnpm -r test >/tmp/istock-test.log 2>&1 && ok "pnpm test" || { no "tests rojos"; tail -30 /tmp/istock-test.log | sed 's/^/        /'; }
grep -qiE "skip|todo" /tmp/istock-test.log && printf '  \033[33mNOTA\033[0m  hay tests skipeados, revisar motivo\n' || true

sec "RESULTADO"
[ "$fail" -eq 0 ] && echo "FASE 2: PASS" || echo "FASE 2: FAIL"
exit "$fail"
