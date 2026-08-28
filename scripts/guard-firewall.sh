#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════════════════════
#  guard-firewall · T1. El rate limit de la vidriera existe, esta versionado, y no puede pasar
#  por vacio.
#
#  Escrito por el LEAD el 2026-08-28, despues de que `researcher` demoliera la premisa de la fila
#  T1 del board. T1 decia "o vercel.json o bloqueo humano": es falsa dicotomia. El rate limit del
#  WAF **no entra en vercel.json** —el schema oficial tipa routes[].mitigate.action como enum
#  cerrado ["challenge","deny"] con additionalProperties:false, y `rate_limit` aparece 0 veces—
#  pero si se puede versionar en un JSON propio y aplicar por CLI. Eso es config/firewall-rules.json.
#
#  Este gate es de NIVEL 1: estatico, sin red, corre en cada push. El de nivel 2 (comparar contra
#  la config viva con `vercel firewall diff --json`) necesita token y un scope que todavia no esta
#  verificado — ver docs/research/vercel-firewall-as-code.md §UNVERIFIED.
#
#  Lo que hace fuerte a un gate estatico acá no es validar el JSON: es el **censo de rutas**. Cada
#  ruta de apps/web/app/api tiene que estar cubierta por una regla o estar en la allowlist **con
#  motivo escrito**. Una ruta nueva sin ninguna de las dos cosas rompe el gate el dia que se crea,
#  no el dia que la floodean.
#
#  Doctrina del repo: ausencia de medicion = FAIL, nunca PASS. Por eso F0 exige que el archivo
#  exista y F3 imprime el numero de rutas censadas — cero rutas se ve como un cero, no como verde.
#
#  Del LEAD y no de `app-agent` ni de `storefront-agent` por la regla de siempre: el gate no puede
#  ser del mismo writer que el codigo que audita.
# ══════════════════════════════════════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0
say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()  { printf '  \033[32mok\033[0m    %s\n' "$1"; }
bad() { printf '  \033[31mWAF\033[0m   %s\n' "$1"; fail=1; }
inf() { printf '  \033[36m····\033[0m  %s\n' "$1"; }

CFG=config/firewall-rules.json

say "F0 · censo: el archivo de reglas existe y parsea"
if [ ! -f "$CFG" ]; then
  bad "no existe $CFG. Sin archivo no hay nada que auditar, y eso es FAIL, no PASS"
  printf '\n\033[31mGUARD-FIREWALL: FAIL\033[0m\n'; exit 1
fi
if ! node -e "JSON.parse(require('fs').readFileSync('$CFG','utf8'))" 2>/dev/null; then
  bad "$CFG no es JSON valido. El CLI de Vercel lo va a rechazar igual, mejor acá"
  printf '\n\033[31mGUARD-FIREWALL: FAIL\033[0m\n'; exit 1
fi
ok "$CFG existe y parsea"

# Todo lo que sigue lo evalua node y devuelve lineas `OK <texto>` / `NO <texto>` / `IN <texto>`.
OUT=$(node - "$CFG" <<'NODE'
const fs = require('fs'), path = require('path');
const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const out = [];
const ok = (s) => out.push('OK ' + s);
const no = (s) => out.push('NO ' + s);
const inf = (s) => out.push('IN ' + s);
const sec = (s) => out.push('== ' + s);

// ── F1 · restricciones del plan Pro. Verificadas contra docs oficiales el 2026-08-28.
sec('F1 · cada regla cabe en lo que Vercel Pro realmente permite');
const KEYS_PRO = new Set(['ip', 'ja4']);          // header:<name> y UA son Enterprise
const ACTIONS  = new Set(['deny', 'challenge']);
const rules = Array.isArray(cfg.rules) ? cfg.rules : [];
if (rules.length === 0) no('el archivo no declara ninguna regla: el gate estaria pasando por vacio');
else if (rules.length > 40) no(`${rules.length} reglas y Pro permite 40 por proyecto`);
else ok(`${rules.length} reglas declaradas (techo de Pro: 40)`);

for (const r of rules) {
  const n = r.name || '(sin nombre)';
  const rl = r.rateLimit || {};
  if (!r.name)  no(`una regla no tiene \`name\`: el CLI lo pide como primer argumento posicional`);
  if (!r.why || r.why.length < 40)
    no(`la regla ${n} no explica por que existe. Una regla de WAF sin motivo escrito es una regla que nadie se anima a borrar`);
  if (rl.algo !== 'fixed_window')
    no(`la regla ${n} declara algo=${JSON.stringify(rl.algo)} y Pro solo tiene fixed_window`);
  const keys = Array.isArray(rl.keys) ? rl.keys : [];
  if (keys.length === 0) no(`la regla ${n} no declara clave de conteo`);
  for (const k of keys) if (!KEYS_PRO.has(k))
    no(`la regla ${n} cuenta por \`${k}\`, que es Enterprise. En Pro solo ip y ja4. Si hace falta contar por tenant, el camino es @vercel/firewall con rateLimitKey, no subir de plan`);
  if (!(Number.isInteger(rl.window) && rl.window >= 10 && rl.window <= 600))
    no(`la regla ${n} tiene window=${rl.window}. Pro admite 10..600s (la doc del CLI dice 3600, pero manda el limite del plan y es el que rechaza el publish)`);
  if (!(Number.isInteger(rl.requests) && rl.requests >= 1 && rl.requests <= 10_000_000))
    no(`la regla ${n} tiene requests=${rl.requests}, fuera de 1..10.000.000`);
  if (!ACTIONS.has(rl.action))
    no(`la regla ${n} mitiga con ${JSON.stringify(rl.action)}; se espera deny o challenge`);
  if (rl.action === 'challenge' && String(r.route || '').startsWith('/api/'))
    no(`la regla ${n} manda un challenge a ${r.route}. Un challenge contra un sendBeacon o un fetch no lo resuelve nadie: es un 4xx con pasos extra`);
  if (r.status !== 'active' && r.status !== 'planned')
    no(`la regla ${n} declara status=${JSON.stringify(r.status)}; se espera active o planned`);
  if (r.status === 'planned' && !r.lands_with)
    no(`la regla ${n} esta planned y no dice con que slice aterriza: es una regla huerfana`);
}
if (rules.length && !out.some((l) => l.startsWith('NO ')))
  ok('todas las reglas respetan keys/algo/window/limit/action de Pro');

// ── F2 · scoping. El riesgo de costo del rate limit no es el precio unitario, es el alcance:
// se facturan los *allowed requests*, o sea los que matchean y pasan.
sec('F2 · ninguna regla le cobra peaje al HTML publico de la vidriera');
let anchoDeMas = 0;
for (const r of rules) {
  const c = r.condition || {};
  const v = String(c.value ?? '');
  const CATCHALL = ['/', '/(.*)', '.*', '/*', '^/', '^/.*', '/.*'];
  const sinLiterales = c.op === 're' && v.replace(/[^a-z0-9]/gi, '') === '';
  const atrapaTodo = CATCHALL.includes(v) || sinLiterales;
  if (c.type === 'host' && !r.route) {
    anchoDeMas++;
    no(`la regla ${r.name} condiciona por host sin acotar path: matchea CADA pageview de vidriera y cada uno se factura como allowed request. ARCHITECTURE.md: "la vidriera es scrapeable por diseño; se defiende lo que cuesta plata"`);
  }
  if (atrapaTodo) {
    anchoDeMas++;
    no(`la regla ${r.name} matchea ${JSON.stringify(v)}, o sea todo el sitio. Para abuso masivo del HTML la palanca es Attack Challenge Mode, que es gratis; una regla de rate limit ahi es pagar por proteger lo que decidimos no proteger`);
  }
}
if (!anchoDeMas) ok('las reglas apuntan a escrituras y al chatbot, no al HTML cacheado');

// ── F3 · censo de rutas. Esto es lo que impide que el gate envejezca en silencio.
sec('F3 · censo: toda ruta de app/api esta cubierta por una regla o justificada en la allowlist');
const API = 'apps/web/app/api';
const rutas = [];
(function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name === 'route.ts' || e.name === 'route.tsx')
      rutas.push('/' + path.relative('apps/web/app', path.dirname(p)));
  }
})(API);

if (!fs.existsSync(API))
  no(`no existe ${API}. Si el panel se movio, este gate dejo de mirar donde estan las rutas y hay que actualizarlo — no darlo por bueno`);
inf(`rutas HTTP censadas en ${API}: ${rutas.length}`);
for (const r of rutas.sort()) inf(`  · ${r}`);

const cubiertas = rules.map((r) => String(r.route || ''));
const allow = Array.isArray(cfg.allowlist) ? cfg.allowlist : [];
const allowByRoute = new Map(allow.map((a) => [a.route, a]));
let huerfanas = 0;
for (const ruta of rutas) {
  const porRegla = cubiertas.some((c) => c && (ruta === c || ruta.startsWith(c + '/')));
  const exc = allowByRoute.get(ruta);
  if (porRegla) { ok(`${ruta} · cubierta por una regla de rate limit`); continue; }
  if (exc && typeof exc.reason === 'string' && exc.reason.length >= 60) {
    ok(`${ruta} · exceptuada con motivo escrito`);
    continue;
  }
  if (exc) { huerfanas++; no(`${ruta} esta en la allowlist con un motivo vacio o de una linea. La allowlist es para decidir, no para silenciar`); continue; }
  huerfanas++;
  no(`${ruta} no tiene regla de rate limit ni excepcion justificada. Toda ruta nueva de app/api decide una de las dos cosas, y la decide quien la crea`);
}
if (rutas.length && !huerfanas) ok(`las ${rutas.length} rutas censadas estan decididas`);

// ── F4 · la allowlist no puede apuntar a fantasmas
sec('F4 · la allowlist no exceptua rutas que ya no existen');
let fantasmas = 0;
for (const a of allow) {
  if (!rutas.includes(a.route)) {
    fantasmas++;
    no(`la allowlist exceptua ${a.route}, que no existe en ${API}. Una excepcion a una ruta borrada es una excepcion que se va a reciclar sin leer`);
  }
}
if (allow.length && !fantasmas) ok(`las ${allow.length} excepciones apuntan a rutas que existen`);

// ── F5 · el config fantasma. Esta es la trampa concreta que T1 casi comete.
sec('F5 · nadie intento declarar el rate limit en vercel.json');
if (!fs.existsSync('vercel.json')) {
  ok('vercel.json no existe, que es lo correcto: T1 no lo necesita');
} else {
  const raw = fs.readFileSync('vercel.json', 'utf8');
  if (/rate[_-]?limit|rateLimit/i.test(raw))
    no('vercel.json menciona rate limit. No existe en su schema (mitigate.action es enum cerrado ["challenge","deny"], additionalProperties:false): Vercel lo va a ignorar o rechazar, y el equipo va a creer que hay un limite puesto. El rate limit va en config/firewall-rules.json + vercel firewall publish');
  else ok('vercel.json existe pero no pretende declarar rate limits');
}

// ── F6 · el procedimiento de apply esta escrito en el archivo, no en la cabeza de alguien
sec('F6 · el archivo dice como se aplica y que el deploy no lo hace');
if (!cfg.$apply || !/publish/.test(cfg.$apply))
  no('el archivo no documenta el paso de apply. Las reglas del WAF no se sincronizan con `vercel deploy`: sin `vercel firewall publish` el JSON es un deseo');
else ok('el apply esta documentado y aclara que no es parte del build');

console.log(out.join('\n'));
NODE
)
NODE_EXIT=$?
if [ $NODE_EXIT -ne 0 ]; then
  bad "el validador de node murio con exit $NODE_EXIT — no interpretar esto como verde"
  printf '\n\033[31mGUARD-FIREWALL: FAIL\033[0m\n'; exit 1
fi

while IFS= read -r line; do
  case "$line" in
    "== "*) say "${line#== }" ;;
    "OK "*) ok  "${line#OK }" ;;
    "NO "*) bad "${line#NO }" ;;
    "IN "*) inf "${line#IN }" ;;
  esac
done <<< "$OUT"

if [ "$fail" -eq 0 ]; then
  printf '\n\033[32mGUARD-FIREWALL: PASS\033[0m\n'
else
  printf '\n\033[31mGUARD-FIREWALL: FAIL\033[0m\n'
fi
exit "$fail"
