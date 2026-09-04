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
require_command curl

if [ "$fail" -ne 0 ]; then
  exit "$fail"
fi

ACCOUNT=$(vercel whoami 2>/dev/null || true)
if [ "$ACCOUNT" = 'gigisanta' ]; then pass 'sesión Vercel: gigisanta'; else fail "sesión Vercel inesperada: ${ACCOUNT:-ausente}"; fi

VERCEL_API_ARGS=(api "/v2/teams/$TEAM_ID")
TEAM_JSON=$(vercel "${VERCEL_API_ARGS[@]}" --scope "$SCOPE" 2>/dev/null || true)
PLAN=$(printf '%s' "$TEAM_JSON" | jq -r '.billing.plan // empty' 2>/dev/null || true)
if [ "$PLAN" = 'pro' ]; then
  pass 'team Vercel en Pro (uso comercial habilitado)'
else
  fail "team Vercel en ${PLAN:-plan desconocido}; iStock requiere Vercel Pro para uso comercial"
fi

ENV_JSON=$(vercel env ls production --scope "$SCOPE" --project "$PROJECT" --json 2>/dev/null || true)
if ! printf '%s' "$ENV_JSON" | jq -e '.envs | type == "array"' >/dev/null 2>&1; then
  fail 'no se pudo leer el inventario de variables Production'
else
  REQUIRED_ENV=(
    CRON_SECRET
    DATABASE_URL
    DATABASE_URL_UNPOOLED
    NEON_AUTH_BASE_URL
    NEON_AUTH_COOKIE_SECRET
    AUTH_DRIVER
    MEDIA_DRIVER
    R2_ACCOUNT_ID
    R2_ACCESS_KEY_ID
    R2_SECRET_ACCESS_KEY
    R2_BUCKET_ORIGINALS
    R2_BUCKET_MEDIA
    NEXT_PUBLIC_MEDIA_BASE_URL
    BILLING_DRIVER
    LLM_PRIMARY_MODEL
    LLM_FALLBACK_MODEL
    NEXT_PUBLIC_ROOT_DOMAIN
    NEXT_PUBLIC_APP_URL
    LLM_MAX_INPUT_TOKENS
    LLM_MAX_OUTPUT_TOKENS
    MP_ACCESS_TOKEN
    MP_WEBHOOK_SECRET
    INNGEST_SIGNING_KEY
    INNGEST_EVENT_KEY
  )
  MISSING=()
  for key in "${REQUIRED_ENV[@]}"; do
    if ! printf '%s' "$ENV_JSON" | jq -e --arg key "$key" \
      '.envs[] | select(.key == $key and (.target | index("production")) != null)' >/dev/null; then
      MISSING+=("$key")
    fi
  done
  if [ "${#MISSING[@]}" -eq 0 ]; then
    pass 'variables base presentes en Production (valores no expuestos)'
  else
    fail "faltan variables Production: ${MISSING[*]}"
  fi

  OPTIONAL_MISSING=()
  for key in GOOGLE_GENERATIVE_AI_API_KEY GROQ_API_KEY; do
    if ! printf '%s' "$ENV_JSON" | jq -e --arg key "$key" \
      '.envs[] | select(.key == $key and (.target | index("production")) != null)' >/dev/null; then
      OPTIONAL_MISSING+=("$key")
    fi
  done
  if [ "${#OPTIONAL_MISSING[@]}" -gt 0 ]; then
    printf 'INFO  módulos opcionales free sin credenciales: %s\n' "${OPTIONAL_MISSING[*]}"
  else
    pass 'credenciales opcionales presentes en Production (valores no expuestos)'
  fi
fi

if [ -f vercel.json ] && jq -e '([keys[]] | sort) == ["$schema"] and (has("crons") | not)' vercel.json >/dev/null; then
  pass 'Vercel Cron desactivado: el schedule de expiración vive en Inngest Free'
else
  fail 'vercel.json todavía declara Vercel Cron o configuración extra; la agenda de expiración debe vivir en Inngest'
fi

INNGEST_ROUTE='apps/web/app/api/inngest/route.ts'
INNGEST_FUNCTIONS='apps/web/inngest/functions.ts'
if [ -f "$INNGEST_ROUTE" ] && [ -f "$INNGEST_FUNCTIONS" ] &&
   grep -Eq 'serve\(' "$INNGEST_ROUTE" &&
   grep -Eq 'maxDuration[[:space:]]*=[[:space:]]*300' "$INNGEST_ROUTE" &&
   grep -Eq "cron\\([[:space:]]*['\"]\\*/5 \\* \\* \\* \\*['\"]" "$INNGEST_FUNCTIONS"; then
  pass 'Inngest declara /api/inngest y el barrido cada 5 minutos'
else
  fail 'falta la integración Inngest verificable: route, maxDuration=300 o cron */5'
fi

DNS_CNAME=$(dig +short CNAME "$DOMAIN" 2>/dev/null || true)
DNS_A=$(dig +short A "$DOMAIN" 2>/dev/null || true)
if printf '%s\n' "$DNS_A" | grep -Fxq "$VERCEL_IP" || \
   printf '%s\n' "$DNS_CNAME" | grep -Eq 'vercel-dns-[0-9]+\.com\.?$'; then
  pass "DNS $DOMAIN apunta a Vercel"
else
  fail "DNS $DOMAIN no apunta a Vercel (actual: ${DNS_CNAME:-sin CNAME} ${DNS_A:-sin registro A})"
fi

# El link que se pega en un estado no es el apex: es `{slug}.maat.work`. `demo` es una sonda
# estable porque `/demo` redirige ahí y porque un wildcard roto dejaría todos los tenants muertos.
STOREFRONT_PROBE='demo.maat.work'
PROBE_CNAME=$(dig +short CNAME "$STOREFRONT_PROBE" 2>/dev/null || true)
PROBE_A=$(dig +short A "$STOREFRONT_PROBE" 2>/dev/null || true)
if printf '%s\n' "$PROBE_A" | grep -Fxq "$VERCEL_IP" || \
   printf '%s\n' "$PROBE_CNAME" | grep -Eq 'vercel-dns-[0-9]+\.com\.?'; then
  pass "DNS wildcard ($STOREFRONT_PROBE) apunta a Vercel"
else
  fail "DNS wildcard ($STOREFRONT_PROBE) no resuelve a Vercel (actual: ${PROBE_CNAME:-sin CNAME} ${PROBE_A:-sin registro A})"
fi

if DEPLOYMENTS=$(vercel ls "$PROJECT" --scope "$SCOPE" --limit 1 2>&1); then
  if printf '%s' "$DEPLOYMENTS" | grep -q 'No deployments found'; then
    fail 'el proyecto todavía no tiene deployment verificable'
  else
    pass 'existe al menos un deployment en Vercel'
  fi
else
  fail 'no se pudo consultar deployments en Vercel'
fi

# Un deployment existente no alcanza: el alias puede seguir sirviendo una build anterior. Estas
# dos sondas son públicas y no mutan nada; detectan justo el caso que deja al usuario viendo la UI
# verde vieja o una ruta de suscripción que perdió el plan elegido.
LIVE_HOME=$(curl -fsSL --max-time 15 "https://${DOMAIN}/" 2>/dev/null || true)
if printf '%s' "$LIVE_HOME" | grep -Fq 'Tu stock, listo para vender.' &&
   ! printf '%s' "$LIVE_HOME" | grep -Eiq 'emerald|green|#087f5b|#2f8f68'; then
  pass 'deployment público sirve la landing monocromática actual'
else
  fail 'deployment público no sirve la landing monocromática actual (build vieja o respuesta incompleta)'
fi

LIVE_BILLING=$(curl -fsSL --max-time 15 "https://${DOMAIN}/billing/suscribirse?plan=base" 2>/dev/null || true)
if printf '%s' "$LIVE_BILLING" | grep -Fq '/ingresar?plan=base'; then
  pass 'deployment público conserva plan=base al pedir suscripción sin sesión'
else
  fail 'deployment público no conserva plan=base al pedir suscripción sin sesión'
fi

# Una ruta inexistente también puede existir en el árbol y pasar el build. El callback firmado debe
# estar vivo en el alias canónico y rechazar una request anónima con 401; un 404/3xx/500 significa
# que Inngest no puede sincronizar o ejecutar la función.
LIVE_INNGEST_STATUS=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://${DOMAIN}/api/inngest" 2>/dev/null || true)
if [ "$LIVE_INNGEST_STATUS" = '401' ]; then
  pass 'endpoint público de Inngest está vivo y falla cerrado sin firma'
else
  fail "endpoint público de Inngest respondió ${LIVE_INNGEST_STATUS:-sin respuesta}; se esperaba 401 sin firma"
fi

if [ "$fail" -eq 0 ]; then
  printf 'PRODUCTION PREFLIGHT: PASS\n'
else
  printf 'PRODUCTION PREFLIGHT: FAIL\n' >&2
fi
exit "$fail"
