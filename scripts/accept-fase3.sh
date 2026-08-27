#!/usr/bin/env bash
# ACEPTACION DE FASE 3 (skeleton) — la re-ejecuta el LEAD, no el agente que escribio el codigo.
# CLAUDE.md regla 2: nada es `done` sin un comando de aceptacion que el LEAD vuelve a correr.
#
# K1 marketing honesta · K2 auth + crear tenant + slug · K3 proxy de host
# K4 layout del panel mobile-first · K5 probe de upload a R2
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0
sec()  { printf '\n\033[1m── %s\033[0m\n' "$1"; }
ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
no()   { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=1; }
chk()  { if eval "$2" >/dev/null 2>&1; then ok "$1"; else no "$1"; fi; }
# nofile: el archivo tiene que existir Y no estar vacio (phantom-file guard de CLAUDE.md).
have() { if [ -s "$1" ]; then ok "existe y no esta vacio: $1"; else no "falta o esta vacio: $1"; fi; }
# grep que NO tiene que encontrar nada, ignorando comentarios.
none() { local d="$1" re="$2"; shift 2
  local o; o=$(grep -rnE "$re" "$@" 2>/dev/null | grep -vE ':[0-9]+:\s*(//|\*|/\*)' || true)
  if [ -z "$o" ]; then ok "$d"; else no "$d"; echo "$o" | sed 's/^/        /' | head -6; fi; }

sec "K3 · proxy de host (storefront-agent)"
have apps/web/proxy.ts
chk "exporta proxy()"                      "grep -qE 'export (async )?function proxy' apps/web/proxy.ts"
chk "NO declara runtime (en Proxy tira error)" "! grep -qE '^\s*(export const )?runtime\s*=|runtime:\s*.(nodejs|edge)' apps/web/proxy.ts"
chk "no existe middleware.ts"              "! ls apps/web/middleware.ts middleware.ts"
none "el proxy no hace I/O ni guarda estado (ADR-007 ley 1)" \
     "(from '@istock/db'|drizzle|createClient|await fetch\(|new Map\(|globalThis\.[a-z]+ *=)" apps/web/proxy.ts
chk "el slug se reescribe como segmento de path (ley 2)" \
    "grep -qE 'rewrite\(' apps/web/proxy.ts && grep -qE 'pathname *=' apps/web/proxy.ts"
none "el slug NO viaja como header de tenant" "headers\.set\(['\"]x-tenant" apps/web/proxy.ts
chk "borra los x-tenant-* que llegan de afuera" "grep -qiE 'x-tenant' apps/web/proxy.ts"
chk "tiene matcher (si no, se factura _next/static en cada hit)" "grep -q 'matcher' apps/web/proxy.ts"

sec "K3b · cache tags (todo tag lleva slug — los tags son por proyecto, no por dominio)"
have "apps/web/app/(storefront)/_lib/cache-tags.ts"
chk "storefrontTag y tenantConfigTag interpolan el slug" \
    "grep -qE 'storefront:\\\$\{' 'apps/web/app/(storefront)/_lib/cache-tags.ts'"
none "sin cacheTag literal sin slug (purgaria todos los tenants)" \
     "cacheTag\(['\"](storefront|tenant-config|listings?)['\"]\)" apps/web/app --include='*.ts' --include='*.tsx'
none "sin revalidate numerico corto en la vidriera (216x el costo)" \
     "revalidate\s*[:=]\s*([0-9]|[1-9][0-9]|[1-9][0-9]{2})\b" "apps/web/app/(storefront)"
none "cero set-cookie en (storefront): uno solo apaga el CDN entero" \
     "(set-?[Cc]ookie|cookies\(\)\.set)" "apps/web/app/(storefront)"
chk "la vidriera usa 'use cache'" "grep -rq \"use cache\" 'apps/web/app/(storefront)'"

sec "K1 · marketing honesta (app-agent)"
have "apps/web/app/(marketing)/page.tsx"
have "apps/web/app/(marketing)/precios/page.tsx"
none "no promete nada prohibido en Capa 1" \
     "\b(ARCA|AFIP|factura electr|WhatsApp Business API|MercadoLibre|carrito|checkout)\b" \
     "apps/web/app/(marketing)"
chk "precios dice 14 dias de trial" "grep -qE '14' 'apps/web/app/(marketing)/precios/page.tsx'"

sec "K2 · auth + crear tenant + slug (app-agent)"
have "apps/web/app/(app)/_lib/slug-format.ts"
have "apps/web/app/(app)/app/crear-negocio/actions.ts"
none "tenant_id JAMAS en user_metadata (lint 0015, escalacion de tenant)" \
     "user_metadata[^\n]{0,40}tenant" "apps/web/app" --include='*.ts' --include='*.tsx' --exclude='*.test.ts'
chk "el tenant viaja en app_metadata" "grep -rqE 'app_metadata' 'apps/web/app/(app)'"
# ADR-007 ley 3: un matcher que excluye un path tambien saltea las Server Functions de ese path.
chk "cada Server Action verifica sesion adentro, no delega en el proxy" \
    "grep -qE 'requireSession|requireUser|getSession|assertSession' 'apps/web/app/(app)/app/crear-negocio/actions.ts'"
chk "Zod en el borde del form de alta" \
    "grep -qE \"from 'zod'|from \\\"zod\\\"\" 'apps/web/app/(app)/app/crear-negocio/actions.ts'"

sec "K4 · panel mobile-first (app-agent)"
have "apps/web/app/(app)/app/(panel)/layout.tsx"
chk "hay navegacion inferior (mobile-first, CLAUDE.md 0.11)" \
    "ls 'apps/web/app/(app)/app/(panel)/_ui/bottom-nav.tsx'"
none "el panel no filtra costo ni IMEI a un componente cliente" \
     "\b(cost_?[Uu]sd|costUsd|margin|internal_?[Nn]otes)\b" \
     "apps/web/app/(app)/app/(panel)" --include='*.tsx'

sec "K5 · media / probe de R2 (media-agent)"
have packages/media/src/pipeline.ts
have packages/media/src/keys.ts
chk "hay tres variantes thumb/card/detail" \
    "grep -qE 'thumb' packages/media/src/types.ts && grep -qE 'card' packages/media/src/types.ts && grep -qE 'detail' packages/media/src/types.ts"
chk "existe un presupuesto de bytes por variante (card <=150KB)" "ls packages/media/src/budgets.ts"
chk "el presupuesto de card es 150KB o menos" \
    "grep -qE '15[0-9]?_?[0-9]*|153600' packages/media/src/budgets.ts"
none "la key publica no lleva tenant_id ni listing_id (no se deriva el master)" \
     "\`[^\`\n]*(tenantId|tenant_id|listingId|listing_id)[^\`\n]*\.(webp|jpg|png|avif)" \
     packages/media/src --include='*.ts' --exclude='*.test.ts'
chk "borrar un listing DESVINCULA, no borra el byte (key content-addressed)" \
    "ls packages/media/src/unlink.ts"
none "sin DeleteObject por key de listing en el camino de unlink" \
     "DeleteObjectCommand" packages/media/src/unlink.ts
chk "Cache-Control por parametro del SDK, no httpMetadata (eso es Workers)" \
    "! grep -q 'httpMetadata' packages/media/src/storage/r2.ts"
chk "hay driver local para trabajar sin las credenciales B1" "ls packages/media/src/storage/local.ts"

sec "Global · el arbol compila, pasa y no filtra"
if pnpm -s typecheck >/tmp/f3-tc.log 2>&1; then ok "pnpm typecheck"; else no "pnpm typecheck"; tail -25 /tmp/f3-tc.log | sed 's/^/        /'; fi
if pnpm -s lint      >/tmp/f3-lint.log 2>&1; then ok "pnpm lint"; else no "pnpm lint"; tail -25 /tmp/f3-lint.log | sed 's/^/        /'; fi
if pnpm -s test      >/tmp/f3-test.log 2>&1; then ok "pnpm test"; else no "pnpm test"; tail -30 /tmp/f3-test.log | sed 's/^/        /'; fi
SKIP=$(grep -coiE '↓|skipped' /tmp/f3-test.log 2>/dev/null || echo 0)
grep -qiE '[1-9][0-9]* skipped' /tmp/f3-test.log 2>/dev/null \
  && { no "hay tests skipeados: los drivers mock existen, no hay excusa"; grep -iE 'skipped' /tmp/f3-test.log | sed 's/^/        /' | head -3; } \
  || ok "cero tests skipeados"
if ./scripts/guard-leaks.sh >/tmp/f3-guard.log 2>&1; then ok "guard-leaks"; else no "guard-leaks"; grep -A3 LEAK /tmp/f3-guard.log | sed 's/^/        /' | head -20; fi

# `next build` es el unico momento en que se valida cacheComponents + 'use cache' de verdad.
# Un 'use cache' mal puesto no lo ve ni typecheck ni vitest: lo ve el build, o produccion.
sec "Global · next build (valida cacheComponents y 'use cache')"
if pnpm --filter @istock/web -s exec next build >/tmp/f3-build.log 2>&1; then
  ok "next build"
  grep -E "Route \(app\)|○|●|ƒ" /tmp/f3-build.log | head -20 | sed 's/^/        /'
else
  no "next build"; tail -35 /tmp/f3-build.log | sed 's/^/        /'
fi

echo
[ "$fail" -eq 0 ] && echo "FASE 3: ACEPTADA" || echo "FASE 3: RECHAZADA"
exit "$fail"
