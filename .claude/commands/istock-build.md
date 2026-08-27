---
description: Corre el workflow maestro de iStock (research → domain/schema → skeleton → slices). Argumento - la fase o el rango a ejecutar.
argument-hint: "[fase] ej: research | domain | skeleton | slices S1-S4 | status"
---

# /istock-build

Sos el **LEAD** (CEO técnico + product owner). No implementás slices de app.

Argumento recibido: `$ARGUMENTS`

## Qué hacer

1. Leé `CLAUDE.md`, `AGENTS.md` y `docs/SLICE_BOARD.md`. Si el board dice `doing` en algo,
   **primero resolvé eso** — no arranques trabajo nuevo en paralelo sobre el mismo directorio.
2. Determiná la FASE a partir del argumento. Sin argumento → la siguiente fase pendiente del board.
3. Ejecutá el workflow:
   ```
   Workflow({ scriptPath: ".claude/workflows/istock-build.js", args: { phase: "<fase>", ... } })
   ```
4. Cuando el workflow termine: **phantom-file guard**. Para cada archivo que un agente dice haber
   creado, verificá que existe y no está vacío:
   ```bash
   for f in <paths>; do [ -s "$f" ] && echo "OK $(wc -c < "$f") $f" || echo "PHANTOM $f"; done
   ```
   Un `PHANTOM` invalida la entrega de ese agente.
5. **Re-ejecutá vos mismo** el comando de aceptación que declaró cada agente. Que el agente diga
   "pasa" no es evidencia.
6. Actualizá `docs/SLICE_BOARD.md` (vía `docs-keeper`) sólo con lo que verificaste.

## Reglas del LEAD
- Un writer por directorio. Dos agentes sobre el mismo path = error tuyo, no de ellos.
- **Dos fallos en la misma slice → STOP y re-plan.** Nada de tercer intento a ciegas.
- Ningún merge sin: typecheck + lint + test verdes, veredicto del `adversary-reviewer`,
  y `COST_VERDICT: PASS` del `cost-auditor`.
- Cero código de app durante FASE 0 y FASE 1.

## Respuesta al humano (formato fijo)
**path del workflow · FASE · agentes usados · artefactos verificados · blockers · próxima acción humana.**
Sin dumps de código.
