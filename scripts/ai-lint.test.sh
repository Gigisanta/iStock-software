#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════════════════════
#  Polaridad de A010 en `packages/ai/scripts/ai-lint.mjs` — la evidencia de medicion no se forja.
#
#  Hermano de `web-lint.test.sh` y con su misma leccion adentro: un SILENT puede significar dos
#  cosas —"la regla miro el archivo y lo aprobo" o "la regla nunca vio el archivo"— y las dos se
#  ven iguales en la salida. Por eso aca **ningun caso se conforma con el exit code**: se exige el
#  ID de la regla Y el numero de linea. Un fixture que trae la forma legal en la linea 3 y la
#  prohibida en la 4 tiene que reportar A010 en la 4 y no en la 3: eso prueba a la vez que el
#  archivo se escaneo y que la linea legal se aprobo.
#
#  Por que A010 audita tambien los tests, a diferencia de A001/A003/A004: un test que forja la
#  marca es la plantilla de la que alguien copia la linea a produccion. La mitad del literal
#  (`kind: 'measured'`) si los exime, porque ahi es el fixture adversario con el que se prueba que
#  el runtime lo rechaza — sin el, el borde JS se queda sin quien lo ataque.
# ══════════════════════════════════════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")/.."

LINT="packages/ai/scripts/ai-lint.mjs"
T="scripts/.ailintpol-tmp"
rm -rf "$T"; mkdir -p "$T/src"
trap 'rm -rf "$T"' EXIT

fail=0
casos=0

# `entitlement.ts` es el unico exento: es donde viven los constructores y la marca.
cat > "$T/src/entitlement.ts" <<'EOF'
declare const USAGE_EVIDENCE: unique symbol;
export type MeasuredUsage = { kind: 'measured'; messagesToday: number; [USAGE_EVIDENCE]: true };
export function usageMeasured(messagesToday: number): MeasuredUsage {
  return { kind: 'measured', messagesToday } as MeasuredUsage;
}
EOF

# `$1` rotulo · `$2` linea que TIENE que encender (0 = ninguna) · `$3` archivo · `$4` contenido
caso() {
  casos=$((casos + 1))
  printf '%s' "$4" > "$T/src/$3"
  SALIDA=$(AI_LINT_ROOT="$T" node "$LINT" 2>&1 | sed 's/\x1b\[[0-9;]*m//g')
  LINEAS=$(printf '%s\n' "$SALIDA" | grep -E "^A010 +src/$3:" | sed -E "s#^A010 +src/$3:([0-9]+).*#\1#" | sort -u | paste -sd, -)
  rm -f "$T/src/$3"
  if [ "$2" = "0" ]; then ESPERADO=""; else ESPERADO="$2"; fi
  if [ "$LINEAS" = "$ESPERADO" ]; then
    printf '  \033[32mOK\033[0m    %-46s A010 en [%s]\n' "$1" "${LINEAS:-ninguna}"
  else
    printf '  \033[31mMAL\033[0m   %-46s A010 en [%s], se esperaba [%s]\n' "$1" "${LINEAS:-ninguna}" "${ESPERADO:-ninguna}"
    fail=1
  fi
}

printf '\n\033[1m── A010 se ve ENCENDER ──\033[0m\n'

caso 'as MeasuredUsage' 3 'chat.ts' \
'import { usageMeasured } from "./entitlement";
const legal = usageMeasured(3);
const forjado = { kind: "measured", messagesToday: 0 } as MeasuredUsage;
'
caso 'as unknown as MeasuredUsage' 2 'chat.ts' \
'const x: unknown = 0;
const forjado = x as unknown as MeasuredUsage;
'
caso 'as TenantUsageToday' 2 'chat.ts' \
'const x: unknown = 0;
const forjado = x as TenantUsageToday;
'
caso 'as UnmeasuredUsage' 2 'chat.ts' \
'const x: unknown = 0;
const forjado = x as UnmeasuredUsage;
'
caso 'cast con angulos <MeasuredUsage>' 2 'chat.ts' \
'const x: unknown = 0;
const forjado = <MeasuredUsage>x;
'
caso 'un test que forja la marca tambien enciende' 2 'chat.test.ts' \
'const x: unknown = 0;
const forjado = x as MeasuredUsage;
'
caso 'literal `kind: measured` en produccion' 2 'chat.ts' \
'import { usageMeasured } from "./entitlement";
const aMano = { kind: "measured", messagesToday: 7 };
'

printf '\n\033[1m── A010 se ve CALLAR (y el archivo se escaneo igual) ──\033[0m\n'

# El par: la linea 2 es legal y la 3 esta prohibida. Que encienda SOLO la 3 prueba las dos cosas.
caso 'usageMeasured() al lado de un forjado' 3 'chat.ts' \
'import { usageMeasured } from "./entitlement";
const legal = usageMeasured(3);
const forjado = 0 as MeasuredUsage;
'
caso 'literal `kind: measured` en un TEST' 3 'chat.test.ts' \
'const adversario = { kind: "measured", messagesToday: 7 };
const otro = { kind: "measured" };
const forjado = 0 as MeasuredUsage;
'
caso 'nombrarlo en un comentario no enciende' 3 'chat.test.ts' \
'/** quien escribe `as MeasuredUsage` no se olvido: esta mintiendo. */
// tampoco enciende este: x as TenantUsageToday
const forjado = 0 as MeasuredUsage;
'

printf '\n\033[1m── el exento, y el control negativo del arnes ──\033[0m\n'

# `entitlement.ts` trae un `as MeasuredUsage` en su linea 4 desde el fixture de arriba: si el
# exento no funcionara, este caso encenderia sin que ningun archivo nuevo lo pida.
casos=$((casos + 1))
SALIDA=$(AI_LINT_ROOT="$T" node "$LINT" 2>&1 | sed 's/\x1b\[[0-9;]*m//g')
if printf '%s\n' "$SALIDA" | grep -qE '^A010 +src/entitlement\.ts:'; then
  printf '  \033[31mMAL\033[0m   %-46s el exento encendio\n' 'src/entitlement.ts esta exento'; fail=1
else
  printf '  \033[32mOK\033[0m    %-46s el exento callo\n' 'src/entitlement.ts esta exento'
fi

# Control negativo del arnes: si `AI_LINT_ROOT` no se respetara, TODOS los casos de arriba habrian
# auditado `packages/ai` real —que esta limpio— y habrian dado "callar" por el motivo equivocado.
casos=$((casos + 1))
printf 'const forjado = 0 as MeasuredUsage;\n' > "$T/src/canario.ts"
# La salida se captura ANTES de grepear: con `pipefail`, el `exit 1` del lint —que es lo NORMAL
# cuando hay hallazgos— pisa el 0 del grep y la condicion sale al reves. Costo un rojo del arnes.
CANARIO=$(AI_LINT_ROOT="$T" node "$LINT" 2>&1 | sed 's/\x1b\[[0-9;]*m//g')
if printf '%s\n' "$CANARIO" | grep -qE '^A010 +src/canario\.ts:1'; then
  printf '  \033[32mOK\033[0m    %-46s el arnes audita el fixture, no el paquete\n' 'AI_LINT_ROOT se respeta'
else
  printf '  \033[31mMAL\033[0m   %-46s los casos de arriba no probaron nada\n' 'AI_LINT_ROOT se respeta'; fail=1
fi
rm -f "$T/src/canario.ts"

# Y el paquete real, sin escotilla, tiene que seguir verde.
casos=$((casos + 1))
if node "$LINT" >/dev/null 2>&1; then
  printf '  \033[32mOK\033[0m    %-46s packages/ai pasa las 10 reglas\n' 'el paquete real sigue verde'
else
  printf '  \033[31mMAL\033[0m   %-46s\n' 'el paquete real sigue verde'; fail=1
fi

printf '\n'
if [ "$fail" = "0" ]; then
  printf '\033[1;32mPOLARIDAD AI-LINT: OK\033[0m — %s casos, A010 se vio encender y se vio callar.\n' "$casos"
else
  printf '\033[1;31mPOLARIDAD AI-LINT: MAL\033[0m\n'
fi
exit "$fail"
