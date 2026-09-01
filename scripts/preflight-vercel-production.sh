#!/usr/bin/env bash
# Preflight de producción para el proyecto Vercel de iStock.
#
# Sólo inspecciona estado: no crea deployments, no modifica variables y nunca imprime valores
# de secretos. Está pensado para correrse justo antes de `vercel deploy --prod` y para volver a
# correrse después de cualquier cambio en billing, DNS o credenciales.
set -euo pipefail

cd "$(dirname "$0")/.."

SCOPE='giolivos-projects'
PROJECT='istock'
TEAM_ID='team_lLlRfunuJpEQBo1JILzyaqH0'
DOMAIN='istock.maat.work'
VERCEL_IP='76.76.21.21'

fail=0

pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1" >&2; fail=1; }

require_command() {
  if command -v "$1" >/dev/null 2>&1; then pass "comando disponible: $1"; else fail "falta comando: $1"; fi
}

require_command jq
require_command vercel
require_command dig

if [ "$fail" -ne 0 ]; then
  exit "$fail"
fi

ACCOUNT=$(vercel whoami 2>/dev/null || true)
if [ "$ACCOUNT" = 'gigisanta' ]; then pass 'sesión Vercel: gigisanta'; else fail "sesión Vercel inesperada: ${ACCOUNT:-ausente}"; fi

TEAM_JSON=$(vercel api "/v2/teams/$TEAM_ID" --scope "$SCOPE" 2>/dev/null || true)
PLAN=$(printf '%s' "$TEAM_JSON" | jq -r '.billing.plan // empty' 2>/dev/null || true)
if [ "$PLAN" = 'pro' ]; then pass 'team Vercel en Pro'; else fail "team Vercel en ${PLAN:-plan desconocido}; el cron de 5 minutos requiere Pro"; fi

ENV_JSON=$(vercel env ls production --scope "$SCOPE" --project "$PROJECT" --json 2>/dev/null || true)
if ! printf '%s' "$ENV_JSON" | jq -e '.envs | type == "array"' >/dev/null 2>&1; then
  fail 'no se pudo leer el inventario de variables Production'
else
  REQUIRED_ENV=(
    CRON_SECRET
    DATABASE_URL
    NEXT_PUBLIC_SUPABASE_URL
    NEXT_PUBLIC_SUPABASE_ANON_KEY
    SUPABASE_SERVICE_ROLE_KEY
    AUTH_DRIVER
    MEDIA_DRIVER
    R2_ACCOUNT_ID
    R2_ACCESS_KEY_ID
    R2_SECRET_ACCESS_KEY
    R2_BUCKET_ORIGINALS
    R2_BUCKET_MEDIA
    NEXT_PUBLIC_MEDIA_BASE_URL
    BILLING_DRIVER
    MP_ACCESS_TOKEN
    MP_WEBHOOK_SECRET
    MP_PREAPPROVAL_PLAN_BASE
    MP_PREAPPROVAL_PLAN_NEGOCIO
    LLM_PRIMARY_MODEL
    LLM_FALLBACK_MODEL
    GOOGLE_GENERATIVE_AI_API_KEY
    GROQ_API_KEY
    NEXT_PUBLIC_ROOT_DOMAIN
    NEXT_PUBLIC_APP_URL
    LLM_MAX_INPUT_TOKENS
    LLM_MAX_OUTPUT_TOKENS
  )
  MISSING=()
  for key in "${REQUIRED_ENV[@]}"; do
    if ! printf '%s' "$ENV_JSON" | jq -e --arg key "$key" \
      '.envs[] | select(.key == $key and (.target | index("production")) != null)' >/dev/null; then
      MISSING+=("$key")
    fi
  done
  if [ "${#MISSING[@]}" -eq 0 ]; then
    pass 'variables requeridas presentes en Production (valores no expuestos)'
  else
    fail "faltan variables Production: ${MISSING[*]}"
  fi
fi

if [ -f vercel.json ] && jq -e '.crons | length == 1 and .[0].path == "/api/cron/expire-reservations" and .[0].schedule == "*/5 * * * *"' vercel.json >/dev/null; then
  pass 'cron de expiración: cada 5 minutos, una sola ruta'
else
  fail 'vercel.json no declara exactamente el cron de expiración esperado'
fi

DNS_A=$(dig +short "$DOMAIN" A 2>/dev/null || true)
if printf '%s\n' "$DNS_A" | grep -Fxq "$VERCEL_IP"; then
  pass "DNS $DOMAIN apunta a $VERCEL_IP"
else
  fail "DNS $DOMAIN no apunta a $VERCEL_IP (actual: ${DNS_A:-sin registro A})"
fi

DEPLOYMENTS=$(vercel ls "$PROJECT" --scope "$SCOPE" --limit 1 2>&1 || true)
if printf '%s' "$DEPLOYMENTS" | grep -q 'No deployments found'; then
  fail 'el proyecto todavía no tiene deployment verificable'
else
  pass 'existe al menos un deployment en Vercel'
fi

if [ "$fail" -eq 0 ]; then
  printf 'PRODUCTION PREFLIGHT: PASS\n'
else
  printf 'PRODUCTION PREFLIGHT: FAIL\n' >&2
fi
exit "$fail"
