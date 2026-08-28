#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════════════════════
#  Polaridad de la seccion de GRANTs a `anon` de `packages/db/scripts/rls-lint.mjs` — el gate que
#  sostiene la unica escritura sin autenticar del producto.
#
#  Existe por una razon concreta y fechada: en S8 el LEAD **aflojo** la regla 0020 para que
#  `customer_name` / `customer_wa_phone` pasaran de "prohibidas en cualquier GRANT a anon" a
#  "prohibidas de LEER". El visitante del formulario de canje escribe su propio nombre y su
#  propio telefono —que ya tiene—; lo que no puede es leerlos de vuelta, ni los suyos ni los de
#  otro. Aflojar el gate mas caro del repo sin un arnes que lo vea encender en la direccion que
#  quedo prohibida es exactamente el "verde vacio" que este repo persigue: `rls-lint OK` habria
#  salido igual si la excepcion se hubiera escrito de mas y hubiera tapado tambien la lectura.
#
#  Por eso el caso que manda es el 1: **un `GRANT SELECT (customer_name)` tiene que seguir rojo**.
#  Y el 5, que prueba que la excepcion es por `tabla.columna` y no por nombre de columna: la
#  misma columna en OTRA tabla sigue siendo un hallazgo.
#
#  Ningun caso se conforma con el exit code. `rls-lint` corre TODAS sus reglas sobre el arbol, asi
#  que un `exit 1` puede venir de cualquiera; lo que se exige es la linea de LA regla, con su
#  tabla y su columna adentro. Y el caso base exige `rls-lint OK` sobre el arbol copiado: sin el,
#  un fixture mal armado haria que todos los demas "encendieran" por el motivo equivocado.
# ══════════════════════════════════════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")/.."

LINT="packages/db/scripts/rls-lint.mjs"
T="scripts/.rlslintpol-tmp"
SQL8="0008_storefront_tradein_lead_insert.sql"
fail=0
casos=0

trap 'rm -rf "$T"' EXIT

# Copia fiel de lo que el lint lee: el journal, los `.sql` y `src/` (los marcadores SENSITIVE).
prep() {
  rm -rf "$T"; mkdir -p "$T"
  cp -R packages/db/drizzle "$T/drizzle"
  cp -R packages/db/src "$T/src"
}
corre() { RLS_LINT_ROOT="$T" node "$LINT" 2>&1 | sed 's/\x1b\[[0-9;]*m//g'; }

# `$1` rotulo · `$2` comando de mutacion sobre $T · `$3..` patrones que TIENEN que aparecer
caso() {
  casos=$((casos + 1))
  local rotulo="$1" mut="$2"; shift 2
  prep
  eval "$mut"
  local salida; salida=$(corre)
  local faltan=()
  for pat in "$@"; do
    printf '%s\n' "$salida" | grep -qE "$pat" || faltan+=("$pat")
  done
  if [ ${#faltan[@]} -eq 0 ]; then
    printf '  \033[32mOK\033[0m    %-58s ENCIENDE\n' "$rotulo"
  else
    printf '  \033[31mMAL\033[0m   %-58s no se vio: %s\n' "$rotulo" "${faltan[*]}"; fail=1
  fi
}

printf '\n\033[1m── el caso base: el arbol copiado esta limpio ──\033[0m\n'
casos=$((casos + 1))
prep
BASE=$(corre)
if printf '%s\n' "$BASE" | grep -q '^rls-lint OK'; then
  printf '  \033[32mOK\033[0m    %-58s %s\n' 'RLS_LINT_ROOT se respeta y el fixture esta limpio' \
    "$(printf '%s\n' "$BASE" | grep '^rls-lint OK' | cut -c1-60)"
else
  printf '  \033[31mMAL\033[0m   %-58s los casos de abajo no probarian nada\n' 'el arbol copiado sale rojo'
  printf '%s\n' "$BASE" | sed 's/^/        /'
  fail=1
fi

printf '\n\033[1m── la direccion que S8 dejo prohibida: anon NO LEE ──\033[0m\n'

caso 'GRANT SELECT (customer_name): la excepcion es de escritura' \
  "printf '\nGRANT SELECT (\"customer_name\") ON TABLE \"tradein_leads\" TO anon;\n' >> \"\$T/drizzle/\$SQL8\"" \
  'columna prohibida en un GRANT a anon: tradein_leads\.customer_name' \
  'columna SENSITIVE en un GRANT a anon: tradein_leads\.customer_name' \
  'tradein_leads: anon recibe lectura sobre la tabla que escribe'

caso 'GRANT SELECT (customer_wa_phone): idem la otra mitad' \
  "printf '\nGRANT SELECT (\"customer_wa_phone\") ON TABLE \"tradein_leads\" TO anon;\n' >> \"\$T/drizzle/\$SQL8\"" \
  'columna prohibida en un GRANT a anon: tradein_leads\.customer_wa_phone' \
  'columna SENSITIVE en un GRANT a anon: tradein_leads\.customer_wa_phone'

printf '\n\033[1m── la excepcion es por TABLA.COLUMNA, no por nombre ──\033[0m\n'

caso 'customer_name escribible en OTRA tabla sigue siendo hallazgo' \
  "printf '\nGRANT INSERT (\"tenant_id\", \"customer_name\") ON TABLE \"listings\" TO anon;\n' >> \"\$T/drizzle/\$SQL8\"" \
  'columna prohibida en un GRANT a anon: listings\.customer_name' \
  'anon no escribe en listings'

printf '\n\033[1m── el costo del dueno no se aflojo con la PII del visitante ──\033[0m\n'

caso 'offer_usd metido en el INSERT de nueve columnas' \
  "sed -i '' 's/\"notes\") ON TABLE \"tradein_leads\"/\"notes\", \"offer_usd\") ON TABLE \"tradein_leads\"/' \"\$T/drizzle/\$SQL8\"" \
  'columna prohibida en un GRANT a anon: tradein_leads\.offer_usd' \
  'columna SENSITIVE en un GRANT a anon: tradein_leads\.offer_usd' \
  'el privilegio de escritura de anon sobre tradein_leads es'

caso 'internal_notes metido en el INSERT' \
  "sed -i '' 's/\"notes\") ON TABLE \"tradein_leads\"/\"notes\", \"internal_notes\") ON TABLE \"tradein_leads\"/' \"\$T/drizzle/\$SQL8\"" \
  'columna prohibida en un GRANT a anon: tradein_leads\.internal_notes' \
  'columna SENSITIVE en un GRANT a anon: tradein_leads\.internal_notes'

printf '\n\033[1m── la allowlist de nueve columnas es igualdad EXACTA ──\033[0m\n'

caso 'una columna de MENOS (notes fuera del GRANT)' \
  "sed -i '' 's/, \"notes\") ON TABLE \"tradein_leads\"/) ON TABLE \"tradein_leads\"/' \"\$T/drizzle/\$SQL8\"" \
  'el privilegio de escritura de anon sobre tradein_leads es'

caso 'status metido en el GRANT (el visitante no elige su estado)' \
  "sed -i '' 's/\"notes\") ON TABLE \"tradein_leads\"/\"notes\", \"status\") ON TABLE \"tradein_leads\"/' \"\$T/drizzle/\$SQL8\"" \
  'el privilegio de escritura de anon sobre tradein_leads es'

caso 'id metido en el GRANT (sale de su default, no se forja)' \
  "sed -i '' 's/\"notes\") ON TABLE \"tradein_leads\"/\"notes\", \"id\") ON TABLE \"tradein_leads\"/' \"\$T/drizzle/\$SQL8\"" \
  'tradein_leads\.id no puede estar en un privilegio de escritura de anon'

printf '\n\033[1m── las dos mitades: GRANT sin policy y policy sin GRANT ──\033[0m\n'

caso 'la policy desaparece: el GRANT escribiria sin limite de tenant' \
  "grep -v 'CREATE POLICY \"tradein_leads_storefront_insert\"' \"\$T/drizzle/\$SQL8\" > \"\$T/x\" && mv \"\$T/x\" \"\$T/drizzle/\$SQL8\"" \
  'tradein_leads tiene privilegio de INSERT para anon y ninguna policy TO anon'

caso 'el GRANT desaparece: la policy daria 42501 y nadie se entera' \
  "grep -v '^GRANT INSERT (\"tenant_id\", \"customer_name\"' \"\$T/drizzle/\$SQL8\" > \"\$T/x\" && mv \"\$T/x\" \"\$T/drizzle/\$SQL8\"" \
  'tradein_leads tiene policy de escritura para anon y ningun privilegio de INSERT|tradein_leads tiene policy de escritura para anon y ningún privilegio de INSERT'

caso 'GRANT de TABLA en vez de columna (alcanzaria a offer_usd y a lo que venga)' \
  "printf '\nGRANT INSERT ON TABLE \"tradein_leads\" TO anon;\n' >> \"\$T/drizzle/\$SQL8\"" \
  'GRANT a anon que no es SELECT ni INSERT de COLUMNA sobre una tabla'

printf '\n'
if [ "$fail" = "0" ]; then
  printf '\033[1;32mPOLARIDAD RLS-LINT: OK\033[0m — %s casos, se vio encender en las dos direcciones.\n' "$casos"
else
  printf '\033[1;31mPOLARIDAD RLS-LINT: MAL\033[0m\n'
fi
exit "$fail"
