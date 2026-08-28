#!/usr/bin/env bash
# Phantom-file guard: un agente dice "cree X" -> esto verifica que X existe y no esta vacio.
# Uso: scripts/guard-artifacts.sh <path> [path...]
#      scripts/guard-artifacts.sh --harness   (chequea el harness completo)
set -uo pipefail
fail=0
check() {
  if [ ! -e "$1" ]; then echo "PHANTOM   $1"; fail=1
  elif [ ! -s "$1" ]; then echo "EMPTY     $1"; fail=1
  else printf 'OK  %7s  %s\n' "$(wc -c < "$1" | tr -d ' ')" "$1"; fi
}
if [ "${1:-}" = "--harness" ]; then
  check CLAUDE.md; check AGENTS.md
  for f in .claude/agents/*.md .claude/commands/*.md .claude/skills/*/SKILL.md \
           .claude/workflows/*.js docs/*.md; do check "$f"; done
  echo "---"
  # Estos conteos SE AFIRMAN. Antes solo se imprimian: borrar dos agentes dejaba el guard en verde
  # con la linea "12 (esperado 14)" ahi arriba como texto decorativo, porque el bucle de `check`
  # solo ve los archivos que TODAVIA estan. Un guard que informa un faltante sin fallar por el
  # faltante es exactamente el "verde por vacio" que este archivo existe para impedir.
  # Si el numero esperado cambia a proposito, se cambia ACA y en el mismo commit que lo cambia.
  count() {
    local que="$1" esperado="$2"; shift 2
    local n; n=$(ls "$@" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$n" -eq "$esperado" ]; then printf '%-9s %s\n' "$que:" "$n"
    else printf '%-9s %s  <-- ESPERADO %s\n' "$que:" "$n" "$esperado"; fail=1; fi
  }
  count agents   14 .claude/agents/*.md
  count skills    9 .claude/skills/*/SKILL.md
  count commands  4 .claude/commands/*.md
  count docs      9 docs/*.md
elif [ "$#" -eq 0 ]; then
  # Sin argumentos esto iteraba sobre una lista vacia y salia `GUARD: PASS` con exit 0 habiendo
  # chequeado CERO archivos. O sea: el guard que existe para hacer cumplir "ausencia de medicion =
  # FAIL" era el que la violaba, y daba verde a cualquiera que lo invocara mal. Encontrado por el
  # LEAD el 2026-08-28 invocandolo mal el mismo. Ahora invocarlo mal es un fallo, no un pase.
  echo "SIN-ARGS  no se chequeo ningun artefacto. Ausencia de medicion = FAIL, nunca PASS."
  echo "          uso: scripts/guard-artifacts.sh <path>...   |   --harness"
  fail=1
else
  for f in "$@"; do check "$f"; done
fi
[ "$fail" -eq 0 ] && echo "GUARD: PASS" || echo "GUARD: FAIL"
exit "$fail"
