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
# ── S4 movio la lista, no el invariante ─────────────────────────────────────────────────────
# Esta regla nacio como "toda policy de anon es SELECT" y fue cierta hasta `drizzle/
# 0004_storefront_wa_click_insert.sql`, que le da a `anon` la unica escritura sin autenticar del
# producto: el beacon del click de WhatsApp. Desde ese commit el gate quedo rojo y nadie se
# entero, porque `ci.yml` nunca corrio (el remoto no tiene ramas). Tercer gate de la misma
# familia en el mismo dia, y el segundo roto por el mismo commit.
#
# La reaccion comoda seria borrar la regla, o aflojarla a "casi todas son de lectura". Las dos la
# convierten en una descripcion del estado actual, y la SEGUNDA escritura sin autenticar entraria
# sin despertar a nadie. Asi que la lista se fija por nombre y se compara por IGUALDAD, no por
# subconjunto: una escritura nueva rompe el gate, y BORRAR el beacon tambien lo rompe. El numero
# de excepciones lo escribe una persona o no existe.
#
# `UPDATE`/`DELETE`/`ALL` para `anon` no tienen lista: son FAIL siempre. La excepcion es de INSERT
# y de una tabla, y ademas tiene que estar acotada por `storefront_tenant_id()` — un INSERT de
# `anon` sin esa condicion es un visitante escribiendo en el tenant de otro.
#
# La auditoria de referencia es R6c de `tests/rls-cross-tenant.test.ts` (`qa-agent`), que fija
# ademas los GRANT por COLUMNA: `anon` inserta `tenant_id`, `listing_id` y `source`, nunca `id`
# ni `created_at`. Este gate es el filo grueso, el que corre sin runner de tests.
ANONWRITE_OK='wa_click_events.wa_click_events_storefront_insert (INSERT)'
ANONWRITE=$(psql -d "$DB" -tAc "select tablename||'.'||policyname||' ('||cmd||')' from pg_policies where schemaname='public' and 'anon' = any(roles) and cmd <> 'SELECT' order by 1" 2>/dev/null | tr '\n' ' ' | sed 's/ *$//')
[ "$ANONWRITE" = "$ANONWRITE_OK" ] && ok "ADR-005: la UNICA escritura de anon es el beacon del click de WA (S4)" \
  || no "las escrituras de anon no son las declaradas: [$ANONWRITE] != [$ANONWRITE_OK]"
ANONUD=$(psql -d "$DB" -tAc "select tablename||'.'||policyname||' ('||cmd||')' from pg_policies where schemaname='public' and 'anon' = any(roles) and cmd in ('UPDATE','DELETE','ALL')" 2>/dev/null | tr '\n' ' ')
[ -z "$(echo "$ANONUD" | tr -d ' ')" ] && ok "ADR-005: anon no tiene UPDATE/DELETE/ALL, y no hay lista que lo permita" \
  || no "anon puede modificar o borrar: $ANONUD"
ANONSCOPE=$(psql -d "$DB" -tAc "select count(*) from pg_policies where schemaname='public' and 'anon' = any(roles) and cmd = 'INSERT' and coalesce(with_check,'') not like '%storefront_tenant_id%'" 2>/dev/null)
[ "$ANONSCOPE" = "0" ] && ok "ADR-005: todo INSERT de anon esta acotado por storefront_tenant_id()" \
  || no "hay $ANONSCOPE INSERT de anon sin storefront_tenant_id() en el WITH CHECK"
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

sec 'D5 · el GRANT de INSERT cubre el insert que Drizzle emite (no el que uno escribiria a mano)'
# Agregado por el LEAD el 2026-08-28, despues de que `0006` rompiera el alta de reservas del panel
# con `42501 permission denied for table reservations` y `guard-grants.sh` dijera PASS igual.
#
# La causa no estaba en el schema sino en el caller: Drizzle, en `insert().values()`, NOMBRA todas
# las columnas de la tabla y pone `default` en las que no le pasaste; Postgres exige privilegio
# sobre cada columna NOMBRADA aunque el valor sea DEFAULT. Un GRANT de INSERT por columna que no
# cubre el 100% de la tabla no es "mas restrictivo": es un INSERT roto para todo el producto.
#
# Va aca y no en `guard-grants.sh` a proposito: ese guard es 100% estatico por contrato declarado
# en su propio encabezado (corre sin base, en el pre-commit), y esta afirmacion solo se puede hacer
# contra el catalogo de una base con las migraciones aplicadas. FASE 2 ya la tiene: D2 acaba de
# migrar contra Postgres real. Duplicar la medicion en el guard estatico seria adivinarla.
if DATABASE_URL="$URL" pnpm --filter @istock/db exec vitest run --root ../.. \
     scripts/probes/el-grant-cubre-el-insert-de-drizzle.test.ts >/tmp/istock-g6.log 2>&1; then
  ok "G6: ninguna tabla de negocio le da a authenticated un INSERT por columna incompleto"
else
  no "G6: hay un GRANT de INSERT por columna incompleto — el panel recibe 42501 al insertar"
  inf "si la intencion era acotar el VALOR de una columna, eso va en la WITH CHECK de la policy"
  grep -E '×|FAIL|→|sin INSERT en' /tmp/istock-g6.log | head -8 | sed 's/^/        /'
fi

sec "RESULTADO"
[ "$fail" -eq 0 ] && echo "FASE 2: PASS" || echo "FASE 2: FAIL"
exit "$fail"
