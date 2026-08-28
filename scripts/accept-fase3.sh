#!/usr/bin/env bash
# ACEPTACION DE FASE 3 (skeleton) — la re-ejecuta el LEAD, no el agente que escribio el codigo.
# CLAUDE.md regla 2: nada es `done` sin un comando de aceptacion que el LEAD vuelve a correr.
#
# K1 marketing honesta · K2 auth + crear tenant + slug · K3 proxy de host
# K4 layout del panel mobile-first · K5 probe de upload a R2
set -uo pipefail
cd "$(dirname "$0")/.."
. scripts/_lib.sh   # sec/ok/no/inf/none/noneraw + el contador `fail`. Probado en scripts/_lib.test.sh
chk()  { if eval "$2" >/dev/null 2>&1; then ok "$1"; else no "$1"; fi; }
# nofile: el archivo tiene que existir Y no estar vacio (phantom-file guard de CLAUDE.md).
have() { if [ -s "$1" ]; then ok "existe y no esta vacio: $1"; else no "falta o esta vacio: $1"; fi; }

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
# La pagina honesta TIENE que nombrar ARCA/WABA/ML/carrito — para decir que NO los hace.
# Grepear la palabra sin mirar la polaridad marca justo la seccion que cumple la regla.
# Lo prohibido es la PROMESA: el termino en una linea sin negacion.
PROMESAS=$(grep -rnE '\b(ARCA|AFIP|factura electr|WhatsApp Business API|MercadoLibre|carrito|checkout)\b' \
           "apps/web/app/(marketing)" 2>/dev/null \
           | grep -vE ':[0-9]+:[[:space:]]*(//|\*|/\*)' \
           | grep -viE '(\bno\b|\bsin\b|\bnunca\b|\btampoco\b|NOT_INCLUDED)' || true)
if [ -z "$PROMESAS" ]; then
  ok "no promete nada prohibido en Capa 1 (los menciona solo para negarlos)"
else
  no "promete algo prohibido en Capa 1"; echo "$PROMESAS" | sed 's/^/        /'
fi
chk "nombra explicitamente lo que NO hace (honestidad, no omision)" \
    "grep -qE 'NOT_INCLUDED|no incluye|No incluye' 'apps/web/app/(marketing)/page.tsx'"
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
# El schema puede vivir en su propio modulo (y debe: se comparte con el server).
# Lo que importa es que el FormData pase por el en el borde, y que ese schema sea Zod.
chk "el form de alta valida el FormData en el borde" \
    "grep -qE '(safeParse|\\.parse)\\(' 'apps/web/app/(app)/app/crear-negocio/actions.ts'"
chk "y ese schema es Zod" \
    "grep -rqE \"from 'zod'\" 'apps/web/app/(app)/_lib/tenants/create-tenant.ts'"

sec "K4 · panel mobile-first (app-agent)"
have "apps/web/app/(app)/app/(panel)/layout.tsx"
chk "hay navegacion inferior (mobile-first, CLAUDE.md 0.11)" \
    "ls 'apps/web/app/(app)/app/(panel)/_ui/bottom-nav.tsx'"
# ─────────────────────────────────────────────────────────────────────────────────────────────
#  §0.9 "el seller no ve costo ni margen": lo que se audita es el ROL, no la palabra.
# ─────────────────────────────────────────────────────────────────────────────────────────────
# La regla anterior era un `none` de `costUsd|margin|internal_notes` sobre todo `(panel)/**.tsx`.
# El 2026-08-28 empezo a marcar dos cosas correctas: el input donde el DUENIO tipea su propio
# costo al dar de alta un equipo, y `_ui/unit-row.tsx`, que ni siquiera es componente cliente.
# Un gate que acusa a un Server Component de filtrar al cliente no esta midiendo el invariante:
# esta contando ocurrencias de un identificador.
#
# El invariante tiene tres partes, y ninguna es "la palabra no aparece":
#   A. `margin` e `internal_notes` no se le muestran a NADIE en el panel. No cambia.
#   B. el costo no viaja a un componente CLIENTE, salvo el alta: ahi lo escribe el dueno.
#   C. toda lectura de `cost_usd` de la base esta condicionada por el rol `owner`.
# C es la que muerde: es la que va a fallar el dia que alguien sume el costo a una query nueva.
none "margen y notas internas no se muestran en ninguna pantalla del panel" \
     "\b(margin|internal_?[Nn]otes)\b" \
     "apps/web/app/(app)/app/(panel)" --include='*.tsx'
chk "el costo no llega a un componente cliente del panel (salvo el alta, donde lo tipea el dueno)" \
    "! grep -rl \"^'use client'\" 'apps/web/app/(app)/app/(panel)' --include='*.tsx' \
       | xargs -r grep -lE '\b(cost_?[Uu]sd|costUsd)\b' \
       | grep -v 'stock/nuevo/' | grep -q ."
chk "toda lectura de cost_usd de la base condiciona por el rol owner (no filtra: no pide)" \
    "! grep -rlE 'listings\.costUsd' 'apps/web/app/(app)' --include='*.ts' \
       | grep -v '\.test\.' \
       | xargs -r grep -LE \"role === .owner.\" | grep -q ."

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
# El comentario que documenta la trampa NO es la trampa. Se ignoran lineas de comentario:
# marcarlas entrena al equipo a borrar el comentario que evita el bug.
chk "Cache-Control por parametro del SDK, no httpMetadata (eso es Workers)" \
    "! grep -nE 'httpMetadata' packages/media/src/storage/r2.ts | grep -qvE '^[0-9]+:[[:space:]]*(//|\\*|/\\*)'"
chk "y lo manda de verdad (CacheControl del comando S3)" \
    "grep -qE 'CacheControl:' packages/media/src/storage/r2.ts"
chk "hay driver local para trabajar sin las credenciales B1" "ls packages/media/src/storage/local.ts"

sec "Global · el arbol compila, pasa y no filtra"
if pnpm -s typecheck >/tmp/f3-tc.log 2>&1; then ok "pnpm typecheck"; else no "pnpm typecheck"; tail -25 /tmp/f3-tc.log | sed 's/^/        /'; fi
if pnpm -s lint      >/tmp/f3-lint.log 2>&1; then ok "pnpm lint"; else no "pnpm lint"; tail -25 /tmp/f3-lint.log | sed 's/^/        /'; fi
# OJO: aca NO va `pnpm -s test`. Con `-s` pnpm silencia la salida de los paquetes hijos y el log
# queda en CERO bytes; el exit code sigue siendo bueno, asi que `ok "pnpm test"` es correcto, pero
# las dos reglas que leen el log dejan de leer nada. La de abajo grepeaba "skipped" en un archivo
# vacio y por lo tanto decia "cero tests skipeados" SIEMPRE — incluso con la suite entera skipeada.
# Encontrado por el LEAD el 2026-08-28, despues de reportar el mismo verde vacio en su propia
# verificacion. Sin `-s` el log trae los resumenes de vitest de los 5 paquetes.
if pnpm test >/tmp/f3-test.log 2>&1; then ok "pnpm test"; else no "pnpm test"; tail -30 /tmp/f3-test.log | sed 's/^/        /'; fi

# Ausencia de medicion = FAIL, nunca PASS: si el log no trae ni un resumen de vitest, las dos
# reglas de abajo no midieron nada y no pueden dar verde.
PAQ_CON_TEST=5   # domain, media, db, tests, apps/web. Si cambia, se cambia ACA y en el mismo commit.
RESUM=$(grep -cE 'Tests +[0-9]+ passed' /tmp/f3-test.log 2>/dev/null || echo 0)
if [ "$RESUM" -lt "$PAQ_CON_TEST" ]; then
  no "solo $RESUM de $PAQ_CON_TEST paquetes reportaron un resumen de vitest: alguno no midio nada"
  grep -E 'test\$|Scope:' /tmp/f3-test.log | sed 's/^/        /' | head -8
else
  ok "los $PAQ_CON_TEST paquetes con tests reportaron resumen"
  TOT=$(grep -oE 'Tests +[0-9]+ passed' /tmp/f3-test.log | grep -oE '[0-9]+' | paste -sd+ - | bc)
  ok "tests corridos en total: ${TOT:-0}"
  if grep -qiE '[1-9][0-9]* skipped' /tmp/f3-test.log 2>/dev/null; then
    no "hay tests skipeados: los drivers mock existen, no hay excusa"
    grep -iE 'skipped' /tmp/f3-test.log | sed 's/^/        /' | head -3
  else
    ok "cero tests skipeados"
  fi
fi
if ./scripts/guard-leaks.sh >/tmp/f3-guard.log 2>&1; then ok "guard-leaks"; else no "guard-leaks"; grep -A3 LEAK /tmp/f3-guard.log | sed 's/^/        /' | head -20; fi
for g in guard-grants guard-r2 guard-artifacts; do
  EXTRA=""; [ "$g" = guard-artifacts ] && EXTRA="--harness"
  if [ ! -x "scripts/$g.sh" ]; then
    no "falta scripts/$g.sh — ausencia de medicion = FAIL, nunca PASS"
  elif ./scripts/$g.sh ${EXTRA:-} >/tmp/f3-$g.log 2>&1; then
    ok "$g"
  else
    no "$g"; grep -E 'GRANT|R2|FAIL|vacio' /tmp/f3-$g.log | sed 's/^/        /' | head -12
  fi
done

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
