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
hits "sin TODO/FIXME sobre RLS, R2 o cache" \
     "(TODO|FIXME|XXX|HACK)[^\n]{0,60}(RLS|rls|R2|cache|tenant|policy|policies)" \
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

say "6 · cacheLife de la vidriera  (§goal: revalidate:60 = 216x el costo)"
if [ -n "$SRC_STOREFRONT" ]; then
  hits "sin revalidate numerico corto en (storefront)" \
       "revalidate\s*[:=]\s*([0-9]|[1-9][0-9]|[1-9][0-9]{2})\b" $SRC_STOREFRONT
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

say "14 · el regex de slug es identico en los 4 owners"
# Vive en packages/db (SQL, no puede importar TS), packages/domain, (app) y (storefront).
# Ningun owner puede arreglar una divergencia solo, y divergir no rompe nada visible: el slug
# entra a la DB y despues `storefrontTag()` tira en produccion al construir el tag. Falla tarde
# y en el unico lugar donde no hay nadie mirando.
SLUGS=$(grep -rhoE '\[a-z0-9\]\(\?:\[a-z0-9-\]\{[0-9]+,[0-9]+\}\[a-z0-9\]\)[$]' \
        --include='*.ts' --include='*.sql' packages apps 2>/dev/null | sort -u || true)
N=$(echo "$SLUGS" | grep -c . || true)
if [ "$N" -eq 1 ]; then ok "una sola forma: $SLUGS"
elif [ "$N" -eq 0 ]; then bad "no se encontro ningun regex de slug — se renombro o se borro?"
else bad "el regex de slug divergio en $N formas:"; echo "$SLUGS" | sed 's/^/        /'; fi

echo
[ "$fail" -eq 0 ] && echo "GUARD-LEAKS: PASS" || echo "GUARD-LEAKS: FAIL"
exit "$fail"
