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
  echo "agents:   $(ls .claude/agents/*.md 2>/dev/null | wc -l | tr -d ' ') (esperado 14)"
  echo "skills:   $(ls .claude/skills/*/SKILL.md 2>/dev/null | wc -l | tr -d ' ') (esperado 9)"
  echo "commands: $(ls .claude/commands/*.md 2>/dev/null | wc -l | tr -d ' ') (esperado 4)"
  echo "docs:     $(ls docs/*.md 2>/dev/null | wc -l | tr -d ' ') (esperado 9)"
else
  for f in "$@"; do check "$f"; done
fi
[ "$fail" -eq 0 ] && echo "GUARD: PASS" || echo "GUARD: FAIL"
exit "$fail"
