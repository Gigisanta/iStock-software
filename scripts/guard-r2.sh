#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════════════════════
#  guard-r2 · las cuatro reglas de R2 de CLAUDE.md §2, que hoy no estaban en ningun gate.
#
#  Escrito por el LEAD el 2026-08-28. Motivo: `packages/media` cumple los cuatro invariantes hoy,
#  y esa es exactamente la situacion en la que un invariante se pierde — nadie lo rompe a
#  proposito, se rompe el dia que un consumidor nuevo puentea el paquete. Las cuatro reglas son:
#
#    · master/original en un bucket R2 publico            → rechazo
#    · URL publica de la que se derive la key del master   → rechazo
#    · borrar un objeto de R2 por key al borrar un listing → rechazo (key content-addressed)
#    · imagen original (>500KB) servida a la vidriera      → cubierto por scripts/probes, no aca
#
#  Este gate es del LEAD y no del `media-agent` por la misma razon que los demas: **el gate no
#  puede ser del mismo writer que el codigo que audita.**
#
#  Doctrina: ausencia de medicion = FAIL, nunca PASS. Si `packages/media` se renombra o se borra,
#  R0 falla en vez de dar verde por vacio.
# ══════════════════════════════════════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0
say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()  { printf '  \033[32mok\033[0m    %s\n' "$1"; }
bad() { printf '  \033[31mR2\033[0m    %s\n' "$1"; fail=1; }

M=packages/media/src

say "R0 · censo: el paquete que hace cumplir todo esto existe y exporta sus gates"
FALTAN=""
for sym in assertPublicVariantKey isPublicVariantKey isMasterObjectKey masterObjectKey publicVariantKey; do
  grep -qE "^\s*$sym,?\s*$|export (function|const) $sym" "$M/index.ts" "$M/keys.ts" 2>/dev/null \
    || FALTAN="$FALTAN $sym"
done
if [ -n "$FALTAN" ]; then
  bad "packages/media no exporta:$FALTAN — sin esto las reglas de abajo no miden nada"
else
  ok "los 5 gates de key estan exportados desde packages/media"
fi

say "R1 · el unico DeleteObject del repo vive en el GC, y pide pruebas"
D=$(grep -rn 'DeleteObjectCommand\|\.delete(.*bucket\|driver\.delete(' --include='*.ts' --include='*.tsx' \
      packages apps 2>/dev/null \
    | grep -vE '^packages/media/src/(storage/r2\.ts|storage/local\.ts|unlink\.ts):' \
    | grep -vE '\.test\.ts:' | grep -vE ':[0-9]+:\s*(\*|//|/\*)' || true)
if [ -z "$D" ]; then
  ok "nadie borra un objeto de R2 fuera de packages/media/src/unlink.ts"
else
  bad "hay un borrado de objeto fuera del GC (la key es content-addressed: es borrado cruzado):"
  echo "$D" | sed 's/^/          /' | cut -c1-160
fi

say "R2 · packages/media no exporta ningun borrado por key"
if grep -qE '^\s*(deleteObject|deleteByKey|removeObject|purgeKey),' "$M/index.ts" 2>/dev/null; then
  bad "index.ts exporta un borrado por key — eso es exactamente lo prohibido"
else
  ok "la superficie publica del paquete no ofrece borrar por key"
fi

say "R3 · el bucket privado no se nombra fuera de packages/media"
O=$(grep -rn "istock-originals\|'originals'\|\"originals\"" --include='*.ts' --include='*.tsx' \
      apps 2>/dev/null | grep -vE '\.test\.ts:' | grep -vE ':[0-9]+:\s*(\*|//|/\*)' || true)
if [ -z "$O" ]; then
  ok "apps/** no nombra el bucket de masters; no puede pedirle un byte"
else
  bad "apps/** nombra el bucket privado (un bucket publico expone su contenido ENTERO):"
  echo "$O" | sed 's/^/          /' | cut -c1-160
fi

say "R4 · nadie fuera de packages/media arma una URL de media a mano"
U=$(grep -rn 'r2\.cloudflarestorage\|\.r2\.dev\|MEDIA_BASE_URL\s*}*\s*[+`]' \
      --include='*.ts' --include='*.tsx' apps packages 2>/dev/null \
    | grep -vE '^packages/media/' | grep -vE '\.test\.ts:' \
    | grep -vE ':[0-9]+:\s*(\*|//|/\*)' || true)
if [ -z "$U" ]; then
  ok "la URL publica la arma solo packages/media (variantUrl / publicUrlForKey)"
else
  bad "hay una URL de R2 armada afuera del paquete:"
  echo "$U" | sed 's/^/          /' | cut -c1-160
fi

say "R5 · el gate de key esta CABLEADO, no solo definido"
# Se busca la LLAMADA, no el simbolo: la linea de `import` sola tambien contiene el nombre, y
# con eso un gate importado-y-nunca-llamado pasaba. Lo encontro la polaridad R5b, no la lectura.
for f in upload.ts url.ts; do
  if grep -E 'assertPublicVariantKey\(' "$M/$f" 2>/dev/null | grep -qvE '^\s*import|from .\./'; then
    ok "$f llama a assertPublicVariantKey antes de exponer/subir"
  else
    bad "$M/$f dejo de llamar a assertPublicVariantKey — el gate existe pero no corre"
  fi
done

say "R6 · la key del master no cruza a la vidriera"
K=$(grep -rn 'masterKey\|master_key' --include='*.ts' --include='*.tsx' \
      "apps/web/app/(storefront)" packages/domain 2>/dev/null \
    | grep -vE '\.test\.ts:' | grep -vE ':[0-9]+:\s*(\*|//|/\*)' || true)
if [ -z "$K" ]; then
  ok "ni (storefront) ni packages/domain tocan master_key"
else
  bad "la key del master llego a codigo publico:"
  echo "$K" | sed 's/^/          /' | cut -c1-160
fi

say "R7 · siguen siendo DOS buckets, y el env lo rechaza si se igualan"
if grep -q 'R2_BUCKET_MEDIA === env.R2_BUCKET_ORIGINALS' "$M/env.ts" 2>/dev/null; then
  ok "env.ts rechaza configurar el mismo bucket para master y variantes"
else
  bad "env.ts ya no verifica que sean dos buckets distintos (ADR-006)"
fi

echo
if [ "$fail" -eq 0 ]; then printf '\033[32mGUARD-R2: PASS\033[0m\n'; else printf '\033[31mGUARD-R2: FAIL\033[0m\n'; fi
exit "$fail"
