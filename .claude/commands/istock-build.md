---
description: Corre el workflow maestro de iStock (research → domain/schema → skeleton → slices). Argumento - la fase o el rango a ejecutar.
argument-hint: "[fase] ej: research | domain | skeleton | slice S1 | slices S1 S2 S3 | status"
---

# /istock-build

Sos el **LEAD** (CEO técnico + product owner). No implementás slices de app.

Argumento recibido: `$ARGUMENTS`

## Qué hacer

1. Leé `AGENTS.md`, `docs/OWNERSHIP.md` y `docs/SLICE_BOARD.md`. Si el board dice `doing` en algo,
   **primero resolvé eso** — no arranques trabajo nuevo en paralelo sobre el mismo directorio.
2. Determiná la FASE a partir del argumento. Sin argumento → la siguiente fase pendiente del board.
3. **Anotá el SHA de HEAD antes de lanzar** (`git rev-parse --short HEAD`) y pasalo como `base`.
   Sin eso, `adversary-reviewer` mira `git diff HEAD`, que queda **vacío** apenas commiteás la
   slice: el gate no encuentra nada y reporta PASS justo cuando el trabajo está completo.
4. Ejecutá el workflow:
   ```
   Workflow({ scriptPath: ".claude/workflows/istock-build.js", args: {
     phase: "research" | "research-fix" | "domain" | "skeleton" | "slice" | "slices",
     slice:  "S3",                    // sólo phase "slice"
     slices: ["S1", "S2", "S3"],      // sólo phase "slices"; corren en SERIE, corta al primer FAIL
     base:   "<sha>",                 // contra qué diffean adversary y cost
   }})
   ```
   `slices` no acepta rangos: va la lista explícita, en el orden del board. Dos slices del mismo
   owner **nunca** en paralelo — es la regla 1.
5. Cuando el workflow termine: **phantom-file guard**. Para cada archivo que un agente dice haber
   creado, verificá que existe y no está vacío:
   ```bash
   for f in <paths>; do [ -s "$f" ] && echo "OK $(wc -c < "$f") $f" || echo "PHANTOM $f"; done
   ```
   Un `PHANTOM` invalida la entrega de ese agente.
6. **Re-ejecutá vos mismo** la aceptación. Que el agente diga "pasa" no es evidencia.
   Ya existen: `scripts/accept-fase2.sh` · `scripts/accept-fase3.sh` · `scripts/guard-leaks.sh`.
   Para una slice de FASE 4, el gate literal es la columna del board, más `guard-leaks.sh`.
7. Actualizá `docs/SLICE_BOARD.md` (vía `docs-keeper`) sólo con lo que verificaste.

## Reglas del LEAD
- Un writer por directorio. Dos agentes sobre el mismo path = error tuyo, no de ellos.
- **Dos fallos en la misma slice → STOP y re-plan.** Nada de tercer intento a ciegas.
- Ningún merge sin: typecheck + lint + test verdes, veredicto del `adversary-reviewer`,
  y `COST_VERDICT: PASS` del `cost-auditor`.
- Cero código de app durante FASE 0 y FASE 1.

## Respuesta al humano (formato fijo)
**path del workflow · FASE · agentes usados · artefactos verificados · blockers · próxima acción humana.**
Sin dumps de código.
