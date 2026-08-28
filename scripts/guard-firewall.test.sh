#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════════════════════
#  Polaridad de `scripts/guard-firewall.sh`. Un gate que nunca se vio fallar es un adorno.
#
#  Existe porque `docs-keeper`, cerrando T1, no pudo documentar la frase "14 fixtures de polaridad,
#  14 rompen": la polaridad se habia ejercido a mano, fuera del repo, y por lo tanto no era
#  reejecutable ni por el LEAD del mes que viene. Una afirmacion de cobertura que nadie puede
#  reproducir vale lo mismo que ninguna. Esto la vuelve un comando.
#
#  Cada caso muta el archivo REAL en memoria y se lo pasa al guard por `WAF_CFG`, asi que las
#  fixtures no envejecen: si manana el JSON gana un campo obligatorio, estas copias lo tienen.
#  Una fixture escrita a mano se congela el dia que se escribe y despues falla por el motivo
#  equivocado, que es la peor clase de verde.
# ══════════════════════════════════════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")/.."

T="scripts/.wafpol-tmp"
rm -rf "$T"; mkdir -p "$T"
trap 'rm -rf "$T"' EXIT

node -e '
const fs = require("fs");
const dir = process.argv[1];
const base = JSON.parse(fs.readFileSync("config/firewall-rules.json", "utf8"));
const mk = (n, mut) => { const c = JSON.parse(JSON.stringify(base)); mut(c); fs.writeFileSync(`${dir}/${n}.json`, JSON.stringify(c, null, 2)); };
const r0 = (c) => c.rules[0];

// ── F1 · lo que Vercel Pro realmente permite
// Ojo: window/requests/keys/algo/action viven bajo `rateLimit`, NO en la raiz de la regla. La
// primera version de estas fixtures los mutaba en la raiz y los SIETE casos daban PASS — o sea que
// el arnes reportaba "cada regla se vio romper" mientras seis reglas de F1 no se habian ejercido
// nunca. Es el motivo entero por el que este archivo existe, encontrado por el archivo mismo.
mk("f1-algo",        (c) => { r0(c).rateLimit.algo = "token_bucket"; });
mk("f1-key",         (c) => { r0(c).rateLimit.keys = ["ip", "cookie"]; });
mk("f1-key-vacia",   (c) => { r0(c).rateLimit.keys = []; });
mk("f1-window",      (c) => { r0(c).rateLimit.window = 5; });
mk("f1-window-alto", (c) => { r0(c).rateLimit.window = 3600; });
mk("f1-requests",    (c) => { r0(c).rateLimit.requests = 0; });
mk("f1-action",      (c) => { r0(c).rateLimit.action = "log"; });
mk("f1-sin-nombre",  (c) => { delete r0(c).name; });
mk("f1-why-corto",   (c) => { r0(c).why = "porque si"; });
mk("f1-challenge",   (c) => { r0(c).rateLimit.action = "challenge"; });
// La mutacion FIJA el status en vez de asumir el del archivo real. Cuando storefront-track-rl paso
// de planned a active (S4), borrar lands_with quedo inocuo y este caso empezo a dar PASS: el fixture
// habia dejado de medir sin avisar. Un fixture acoplado al estado del archivo que audita se apaga
// solo el dia que ese archivo cambia, que es justo el dia en que hace falta.
mk("f1-planned",     (c) => { r0(c).status = "planned"; delete r0(c).lands_with; });
mk("f1-status",      (c) => { r0(c).status = "quizas"; });

// ── F2 · scoping. Cada uno de estos costaria plata, no seguridad.
mk("f2-host",        (c) => { r0(c).condition = { type: "host", op: "suf", value: ".maat.work" }; });
mk("f2-host-route",  (c) => { r0(c).condition = { type: "host", op: "suf", value: ".maat.work" }; r0(c).route = "/api/track"; });
mk("f2-catchall",    (c) => { r0(c).condition = { type: "path", op: "re", value: "/(.*)" }; });
mk("f2-slash-s",     (c) => { r0(c).condition = { type: "path", op: "pre", value: "/s" }; });
mk("f2-un-segmento", (c) => { r0(c).condition = { type: "path", op: "pre", value: "/api" }; });
mk("f2-pre-mudo",    (c) => { r0(c).condition.op = "pre"; });
mk("f2-pre-hablado", (c) => { r0(c).condition.op = "pre"; r0(c).prefix_why = "el beacon se sirve tambien bajo /api/track/v2 durante la migracion, medido y con fecha de cierre"; });

// ── F3/F4 · el censo, que es lo que impide que el gate envejezca en silencio
mk("f3-sin-motivo",  (c) => { c.allowlist.find((a) => a.route === "/api/health").reason = "no jode"; });
mk("f3-sin-excepcion", (c) => { c.allowlist = c.allowlist.filter((a) => a.route !== "/_media/[...key]"); });
mk("f3-covers-falso", (c) => { r0(c).status = "active"; r0(c).covers = ["/s/[slug]/api/inexistente"]; });
// El gemelo de `f3-covers-falso`, en el otro sentido: la regla nombra un handler que SI existe,
// pero sigue `planned`. `lands_with` esta puesto a proposito — sin el, el caso lo atajaria F1 y
// este arnes reportaria verde por el motivo equivocado, que es el defecto que este archivo
// documenta arriba en `f1-planned`. La regla es del beacon, que es la unica cuyo handler existe.
mk("f3-planned-viva", (c) => { r0(c).status = "planned"; r0(c).lands_with = "FASE 5"; });
mk("f4-ruta-muerta", (c) => { c.allowlist.push({ route: "/api/lo-que-fue", reason: "una ruta que ya no existe, con un motivo suficientemente largo como para pasar el minimo de sesenta caracteres que exige F3" }); });
' "$T"

printf 'esto no es json\n' > "$T/f0-roto.json"

tfail=0
caso() { # caso <esperado:FAIL|PASS> <fixture> <que se prueba>
  local esperado="$1" fx="$2" que="$3" visto salida
  if [ "$fx" = "(sin archivo)" ]; then salida=$(WAF_CFG="$T/no-existe.json" ./scripts/guard-firewall.sh 2>&1)
  else salida=$(WAF_CFG="$T/$fx.json" ./scripts/guard-firewall.sh 2>&1); fi
  [ $? -eq 0 ] && visto=PASS || visto=FAIL
  if [ "$visto" = "$esperado" ]; then printf '  \033[32mok\033[0m    %-14s %s → %s\n' "$fx" "$que" "$visto"
  else
    printf '  \033[31mMAL\033[0m   %-14s %s → esperaba %s, dio %s\n' "$fx" "$que" "$esperado" "$visto"
    printf '%s' "$salida" | sed 's/\x1b\[[0-9;]*m//g' | grep -m1 'WAF ' | sed 's/^/          /' | cut -c1-140
    tfail=1
  fi; }

printf '\n\033[1m── F0 · ausencia de medicion es FAIL, nunca PASS\033[0m\n'
caso FAIL "(sin archivo)" "sin archivo de reglas no hay nada que auditar"
caso FAIL f0-roto         "un JSON que no parsea"

printf '\n\033[1m── F1 · lo que Vercel Pro permite de verdad\033[0m\n'
caso FAIL f1-algo         "algo distinto de fixed_window"
caso FAIL f1-key          "una key que Pro no soporta (cookie es Enterprise)"
caso FAIL f1-key-vacia    "sin clave de conteo"
caso FAIL f1-window       "ventana por debajo del minimo"
caso FAIL f1-window-alto  "ventana por encima del maximo"
caso FAIL f1-requests     "limite fuera de rango"
caso FAIL f1-action       "action que Pro no tiene"
caso FAIL f1-sin-nombre   "sin name: el CLI lo pide como primer posicional"
caso FAIL f1-why-corto    "un why que no explica nada"
caso FAIL f1-challenge    "challenge sobre una ruta de API (rompe al cliente, no al bot)"
caso FAIL f1-planned      "planned sin lands_with: una regla que no aterriza nunca"
caso FAIL f1-status       "un status inventado"

printf '\n\033[1m── F2 · scoping, o sea: cual de estas cobra sin proteger\033[0m\n'
caso FAIL f2-host         "condicionar por host: cada pageview se factura"
caso FAIL f2-host-route   "host + route: declarar route NO exime (el agujero de cost-auditor)"
caso FAIL f2-catchall     "una regex sin literales: todo el sitio"
caso FAIL f2-slash-s      "prefijo /s: la vidriera entera con otro nombre (ADR-007)"
caso FAIL f2-un-segmento  "prefijo de un solo segmento"
caso FAIL f2-pre-mudo     "prefijo sin prefix_why: una ruta futura hereda el techo"
caso PASS f2-pre-hablado  "prefijo con motivo escrito: pasa, y queda dicho por que"

printf '\n\033[1m── F3/F4 · el censo, que es lo que impide envejecer en silencio\033[0m\n'
caso FAIL f3-sin-motivo    "exceptuar una ruta con un motivo de tres palabras"
caso FAIL f3-sin-excepcion "un handler censado que nadie decidio (el de las fotos)"
caso FAIL f3-covers-falso  "una regla active que dice cubrir un handler que no existe"
caso FAIL f3-planned-viva  "un handler que YA existe cuya unica regla sigue planned (o sea: sin publicar)"
caso FAIL f4-ruta-muerta   "una excepcion que apunta a una ruta que ya no existe"

printf '\n\033[1m── el archivo real\033[0m\n'
if ./scripts/guard-firewall.sh >/dev/null 2>&1; then printf '  \033[32mok\033[0m    config/firewall-rules.json pasa su propio gate\n'
else printf '  \033[31mMAL\033[0m   config/firewall-rules.json NO pasa su propio gate\n'; tfail=1; fi

if [ "$tfail" = "0" ]; then printf '\n\033[1;32mPOLARIDAD WAF: OK\033[0m — cada regla se vio romper.\n'
else printf '\n\033[1;31mPOLARIDAD WAF: MAL\033[0m\n'; fi
exit "$tfail"
