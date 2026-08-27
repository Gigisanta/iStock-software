---
description: Review adversarial del diff actual - tenant leak, IDOR, PII en payload, RLS, secretos, prompt injection y costo escondido.
argument-hint: "[path o slice-id opcional]"
---

# /istock-review

Review adversarial de iStock. Alcance: `$ARGUMENTS` (sin argumento → diff no commiteado + staged).

## Pasos

1. Sacá el diff:
   ```bash
   git --no-pager diff HEAD --stat && git --no-pager diff HEAD
   ```
2. Lanzá `adversary-reviewer` con el diff y el alcance.
3. **Chequeos mecánicos que corrés vos mismo** (no delegar, son grep):
   ```bash
   git --no-pager grep -nE "console\.log\(.*listing" -- ':!*.test.*' || echo "ok: no listing logs"
   git --no-pager grep -nE "NEXT_PUBLIC_" | grep -viE "supabase_url|supabase_anon|posthog|sentry_dsn|site_url" || echo "ok: no secretos publicos"
   git --no-pager grep -nE "TODO.*(RLS|R2|tenant|auth)" || echo "ok: no TODOs prohibidos"
   git --no-pager grep -nE "using\s*\(\s*true\s*\)" -- '*.sql' || echo "ok: no policies permisivas"
   git --no-pager grep -nE "(imei|cost_usd|internal_notes|margin|supplier)" -- 'apps/web/app/(storefront)' || echo "ok: no PII en vidriera"
   ```
4. Verificá RLS de toda tabla nueva (skill `drizzle-rls`, paso 6).
5. Corré `cost-auditor` sobre el diff.

## Veredicto
```
VERDICT: PASS | FAIL
CRITICAL/HIGH: <lista con evidencia path:línea>
COST_VERDICT: PASS | FAIL
REGLAS DE CLAUDE.md SIN COBERTURA DE TEST: <lista>
```
Un `critical`/`high`, o un `COST_VERDICT: FAIL`, **bloquean el merge**.
