---
description: Ejecuta una slice del SLICE_BOARD de punta a punta - spec, test, impl, verificación, adversary y costo.
argument-hint: "<slice-id> ej: S2 o S6"
---

# /istock-slice

Ejecutá **una** slice de `docs/SLICE_BOARD.md` de punta a punta. Slice recibida: `$ARGUMENTS`

## Secuencia obligatoria (no se saltea ningún paso)

1. **Spec** — leé la fila de la slice en `SLICE_BOARD.md`. Si el gate de aceptación no es un comando
   concreto y ejecutable, **parás** y lo escribís antes de codear.
2. **Test primero** — `qa-agent` escribe el test. **Corré el test y mostrá que falla.**
   Un test que nunca falló no prueba nada.
3. **Impl** — **un solo** agente owner del directorio (ver `CLAUDE.md` §4). Si la slice cruza dos
   directorios, se hace en **dos pasos serie**, nunca dos writers en paralelo.
4. **Verificación** — el LEAD corre:
   ```
   pnpm typecheck && pnpm lint && pnpm test
   ```
5. **Adversary** — `adversary-reviewer`. Un `high` o `critical` → vuelve al paso 3.
6. **Costo** — `cost-auditor`. `COST_VERDICT: FAIL` bloquea igual que un test roto.
7. **Docs** — `docs-keeper` actualiza el board y el doc que corresponda.
8. **Commit** — chico, con prefijo (`[feat]` / `[test]` / `[fix]` / `[docs]` / `[cost]`).

## Reglas
- **Dos fallos en la misma slice → STOP.** Reportá al humano y re-planificá. No hay tercer intento.
- Sin RLS no hay merge. Sin test no hay merge. Sin gate de costo no hay merge.
- `TODO: después el RLS` o `TODO: después R2` en el diff → rechazo automático.
- La slice no está `done` hasta que **el LEAD** re-ejecutó el comando de aceptación.
