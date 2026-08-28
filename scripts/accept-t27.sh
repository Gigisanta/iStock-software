#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════════════════════
#  ACEPTACION DE T27 — la re-ejecuta el LEAD, no `app-agent`, que escribio el codigo (regla 2)
#
#  Criterio del board, textual: *"los dos resolvers dan el mismo motivo para la misma fila y el
#  copy del panel dice que alguien la apago, no que falta plan"*.
#
#  ── Por que esta fila necesitaba un gate escrito y no alcanzaba con "los tests pasan" ────────
#  T27 no rompe nada. Los dos resolvers compilaban, los dos devolvian un motivo del tipo correcto,
#  y la suite estaba verde con el bug adentro. Lo unico que estaba mal era el SIGNIFICADO: con la
#  misma fila de `entitlements` en `enabled = false`, `(app)` decia `plan` y `(billing)` decia
#  `flag_off`, y el copy del panel manda `plan` a *"Eso viene con el plan Negocio."* — o sea que a
#  un tenant que PAGA Negocio se le ofrecia comprar lo que ya tiene. Un defecto que sale por
#  pantalla en castellano y no mueve ningun numero es exactamente el que no se cierra solo.
#
#  ── De donde sale el certificado ─────────────────────────────────────────────────────────────
#  `(app)/_lib/entitlements.test.ts` y `(app)/_lib/listings/publish-listing.test.ts` ya afirman
#  esto, y bien. NO se citan como evidencia: son de `app-agent`, el writer del codigo auditado
#  (`CLAUDE.md` §4). Se corren igual, como red de regresion suya, y su rojo es informativo.
#  El certificado lo firma `scripts/probes/t27-un-motivo-una-voz.test.ts`, que es del LEAD.
#
#  ── Lo que este gate NO exige, a proposito ───────────────────────────────────────────────────
#  No exige que los dos resolvers se fusionen en uno. La celda del board lo dice: unificarlos pide
#  que `featureAccess()` ademas devuelva el techo y tenga camino de escritura, y eso es una
#  decision del LEAD, no un refactor. Lo que se audita es que digan LO MISMO, no que sean uno.
# ══════════════════════════════════════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/_lib.sh
. scripts/_lib.sh

fail=0

APP='apps/web/app/(app)/_lib/entitlements.ts'
BIL='apps/web/app/(billing)/_lib/entitlements.ts'
COPY='apps/web/app/(app)/_lib/listings/publish-listing.ts'

# ── V0 · los archivos auditados existen (phantom-file guard de CLAUDE.md, en linea) ───────────
sec 'V0 · existe lo que se va a auditar'
have "$APP"
have "$BIL"
have "$COPY"
have scripts/probes/t27-un-motivo-una-voz.test.ts

# ── V1 · el certificado: la probe del LEAD ───────────────────────────────────────────────────
sec 'V1 · la misma fila apagada da el mismo motivo, y ese motivo tiene su propio texto'
if pnpm --filter @istock/web exec vitest run --root ../.. \
     scripts/probes/t27-un-motivo-una-voz.test.ts >/tmp/t27-probe.txt 2>&1; then
  ok "la probe del LEAD pasa: $(grep -oE 'Tests +[0-9]+ passed' /tmp/t27-probe.txt | tail -1)"
else
  no 'la probe del LEAD FALLA: o los dos resolvers volvieron a discrepar, o el copy volvio a mentir'
  sed 's/^/        /' /tmp/t27-probe.txt | grep -E '×|FAIL|Error|→' | head -10
fi

# ── V2 · los tres motivos son los mismos tres de los dos lados, cada uno contra un literal ───
#
# ADR-023: NO se compara un tipo contra el otro. Cada declaracion se compara contra la lista
# escrita ACA. Que coincidan entre si es consecuencia de que las dos coincidan con el literal, y
# no la afirmacion principal: dos lados que se equivocan igual pasarian una comparacion mutua.
sec 'V2 · los dos resolvers declaran los mismos tres motivos (cada lado contra un literal de acá)'
ESPERADO="flag_off plan trial_expired"
for par in "$APP:FeatureAccess" "$BIL:EntitlementDenial"; do
  f="${par%%:*}"; tipo="${par##*:}"
  vistos=$(grep -A2 -E "type $tipo =" "$f" \
    | grep -oE "'(plan|trial_expired|flag_off)'" | tr -d "'" | sort -u | tr '\n' ' ')
  vistos="${vistos% }"
  if [ "$vistos" = "$ESPERADO" ]; then
    ok "$tipo declara exactamente [$ESPERADO]"
  else
    no "$tipo declara [$vistos] y se esperaba [$ESPERADO] — un motivo de mas o de menos en un solo lado ES T27"
  fi
done

# ── V3 · un motivo nuevo rompe en COMPILACION, no en el mostrador ────────────────────────────
#
# La rama `default` del switch de copy asigna el motivo a un `never`. Sin ella, un cuarto motivo
# cae en silencio al texto del plan, que es literalmente el bug que `flag_off` vino a cerrar: el
# defecto no se repite igual, se repite un motivo mas tarde.
sec 'V3 · agregar un motivo obliga a decidir su texto (exhaustividad por `never`)'
if grep -qE 'const exhaustive: never = access\.reason' "$COPY"; then
  ok 'el switch del copy cierra en `never`: un motivo nuevo sin texto no compila'
else
  no 'no esta el `never` en el switch del copy: un motivo nuevo caeria en silencio al texto del plan'
fi
if pnpm --filter @istock/web exec tsc --noEmit >/tmp/t27-tc.txt 2>&1; then
  ok 'typecheck de apps/web verde: el `never` de arriba esta satisfecho hoy'
else
  no 'typecheck de apps/web ROJO — el `never` no vale nada si el proyecto no compila'
  sed 's/^/        /' /tmp/t27-tc.txt | head -8
fi

# ── V4 · el copy del plan tiene UNA sola puerta ──────────────────────────────────────────────
#
# `denyReasonText()` puede estar impecable y el bug seguir vivo si otro archivo escribe el mismo
# texto a mano. El censo es sobre `apps/web` ENTERO menos los tests: los tests SI lo nombran, y
# tienen que nombrarlo — es el ancla literal de sus aserciones.
sec 'V4 · "Eso viene con el plan Negocio." se escribe en un solo lugar'
HITS=$(grep -rn --include='*.ts' --include='*.tsx' \
        --exclude='*.test.ts' --exclude='*.test.tsx' \
        --exclude-dir=node_modules --exclude-dir=.next \
        'Eso viene con el plan Negocio' apps/web scripts 2>/dev/null || true)
# El hallazgo de un comentario NO es una puerta de copy: el docblock de `TRIAL_OVER` cita este
# mismo texto para explicar por que NO es el suyo, y eso es exactamente lo que hay que escribir.
# Se filtra con la regla de `none()` de `_lib.sh`, que existe por esta misma razon.
HITS=$(printf '%s\n' "$HITS" | grep -vE '^[^:]*:[0-9]+:[[:space:]]*(//|\*|/\*|#)' || true)
N=$(printf '%s' "$HITS" | grep -c . || true)
if [ "$N" = "1" ]; then
  ok "una sola fuente del texto del plan: $(printf '%s' "$HITS" | cut -d: -f1-2)"
else
  no "el texto del plan aparece $N veces fuera de los tests: una copia a mano se saltea el switch"
  printf '%s\n' "$HITS" | sed 's/^/        /' | head -6
fi

# ── V5 · la red de regresion de `app-agent`, informativa ─────────────────────────────────────
#
# Se corre y se reporta, y su rojo ensucia el veredicto: si el writer del codigo no puede sostener
# su propia afirmacion, la slice no esta cerrada. Lo que NO hace es ser el certificado — eso es V1.
sec 'V5 · los tests del propio writer siguen verdes (red de regresion, no certificado)'
if pnpm --filter @istock/web exec vitest run \
     'app/(app)/_lib/entitlements.test.ts' \
     'app/(app)/_lib/listings/publish-listing.test.ts' \
     'app/(billing)/_lib/entitlements.test.ts' >/tmp/t27-reg.txt 2>&1; then
  ok "los tres archivos del writer pasan: $(grep -oE 'Tests +[0-9]+ passed' /tmp/t27-reg.txt | tail -1)"
else
  no 'la red de regresion del writer esta ROJA'
  sed 's/^/        /' /tmp/t27-reg.txt | grep -E '×|FAIL' | head -8
fi

# ══════════════════════════════════════════════════════════════════════════════════════════════
printf '\n'
if [ "$fail" = "0" ]; then
  printf '\033[32mT27: ACEPTADA\033[0m\n'
else
  printf '\033[31mT27: RECHAZADA\033[0m\n'
fi
exit "$fail"
