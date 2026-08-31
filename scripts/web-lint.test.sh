#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════════════════════
#  Polaridad de `apps/web/scripts/web-lint.mjs`. Las 16 reglas se tienen que ver ENCENDER.
#
#  Hermano de `guard-firewall.test.sh` y por el mismo motivo. La diferencia es cuanto pesa: W015
#  es la regla que sostiene "Query sin filtro de tenant ademas de RLS -> rechazo", o sea la
#  defensa en profundidad del invariante mas caro del producto. Su implementacion tiene SEIS casos
#  de borde documentados como hallazgos —"presencia no es filtro", "sin ancla no hay exencion",
#  "proximidad no es alcance", la vara distinta para insert, el TDZ, el ancla en columna 0— y
#  ninguno era reejecutable: se midieron a mano, una vez, y quedaron escritos en un comentario.
#  Un comentario no vuelve a correr. Esto los vuelve un comando.
#
#  ── Por que este arnes verifica el ID de la regla y no el exit code ──────────────────────────
#  `guard-firewall.test.sh` mira el exit code, y le alcanza porque audita UN archivo. Aca no:
#  el linter corre 16 reglas sobre el mismo arbol, asi que un fixture puede salir en rojo por una
#  regla distinta de la que se quiso probar y el caso daria "ok" sin haber ejercido nada. Es la
#  misma falla que tuvieron los fixtures de F1 del arnes de WAF —siete casos PASS por mutar la
#  raiz en vez de `rateLimit`— y que ese archivo encontro sobre si mismo. Aca se pide que la regla
#  NOMBRADA aparezca en rojo.
#
#  ── Por que hay pares FIRES/SILENT sobre el MISMO path ───────────────────────────────────────
#  Un SILENT puede significar dos cosas: "la regla miro el archivo y lo aprobo" o "la regla nunca
#  vio el archivo". La segunda es un falso verde y no se distingue mirando la salida. Por eso cada
#  SILENT de W015 tiene un FIRES gemelo en el MISMO archivo: si el path no se escaneara, el gemelo
#  tampoco encenderia, y el arnes se cae.
# ══════════════════════════════════════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")/.."

LINT="apps/web/scripts/web-lint.mjs"
T="scripts/.weblintpol-tmp"
rm -rf "$T"; mkdir -p "$T"
trap 'rm -rf "$T"' EXIT

B="$T/base"
mkdir -p "$B/app/(storefront)/s/[slug]" "$B/app/(app)/_lib" "$B/app/(app)/app/(panel)"

cat > "$B/proxy.ts" <<'EOF'
export function proxy(request: Request): Response {
  const host = request.headers.get('host') ?? '';
  return new Response(host);
}
EOF

cat > "$B/app/(storefront)/s/[slug]/page.tsx" <<'EOF'
export function generateStaticParams() {
  return [];
}
export default function Page() {
  return <main>vidriera</main>;
}
EOF

cat > "$B/app/(app)/_lib/env.ts" <<'EOF'
export const serverEnv = () => ({ url: process.env.DATABASE_URL });
EOF

cat > "$B/app/(app)/_lib/q.ts" <<'EOF'
import { eq } from 'drizzle-orm';
import { listings } from '@istock/db';

export async function listUnits(tx: any, tenantId: string) {
  return tx.select().from(listings).where(eq(listings.tenantId, tenantId));
}
EOF

# ── el motor ──────────────────────────────────────────────────────────────────────────────────
tfail=0
SALIDA=""

nuevo() { rm -rf "$T/w"; cp -R "$B" "$T/w"; }

# Todo fixture se escribe por aca, y no por comodidad: la primera version de este archivo hacia
# `cat > "$T/w/app/(app)/_lib/auth/sign-in.ts"` sin crear el directorio. El shell escupio
# "No such file or directory", el archivo NUNCA existio, y el caso —que esperaba SILENT— dio ok
# igual, porque un arbol sin la Server Action tampoco enciende W012. O sea: el arnes que existe
# para matar los falsos verdes se comio uno propio, en su primera corrida. `fx` cierra la clase
# entera: crea el directorio, y si el archivo termina vacio o ausente el caso muere en rojo antes
# de medir nada. `ap` hace lo mismo para los apendes, donde el modo de falla es el inverso:
# apendear a un path equivocado crea un archivo huerfano que el linter igual camina.
# Un `$` literal en la ruta es SIEMPRE una comilla simple donde iba una doble, y el modo de falla
# es mudo: `fx '$W15'` escribe un archivo llamado `$W15`, con contenido, en el arbol — asi que ni
# `fx` ni `ap` se quejan, el linter lo camina sin reconocerlo y el caso da SILENT. Me paso al
# reescribir este archivo: SIETE casos de W015 se apagaron de golpe. Los delataron los gemelos
# —los FIRES viraron a SILENT— que es exactamente para lo que estan. Esto lo mata en el origen.
sinvar() { case "$1" in *'$'*) printf '  \033[31mMAL\033[0m   ruta con $ literal: %s — falto una comilla doble\n' "$1"; tfail=1;; esac; }

fx() { # fx <ruta relativa a apps/web>   (contenido por stdin)
  local rel="$1" dest="$T/w/$1"
  sinvar "$1"
  mkdir -p "$(dirname "$dest")"
  cat > "$dest"
  if [ ! -s "$dest" ]; then
    printf '  \033[31mMAL\033[0m   fixture vacio o no escrito: %s — el caso siguiente no mide nada\n' "$rel"
    tfail=1
  fi
}
ap() { # ap <ruta ya existente>   (contenido por stdin)
  local rel="$1" dest="$T/w/$1"
  sinvar "$1"
  if [ ! -f "$dest" ]; then
    printf '  \033[31mMAL\033[0m   apendice a un path inexistente: %s — el caso siguiente no mide nada\n' "$rel"
    tfail=1; return
  fi
  cat >> "$dest"
}

correr() { # correr [dir] -> deja la salida sin ANSI en $SALIDA
  local dir="${1:-$T/w}"
  SALIDA=$(WEB_LINT_ROOT="$dir" node "$LINT" 2>&1 | sed 's/\x1b\[[0-9;]*m//g')
}

encendio() { # encendio <regla>  ·  'exento:' es una linea informativa de W012, no una falla
  printf '%s\n' "$SALIDA" | grep -vF 'exento:' | grep -qE "^  $1 "
}

caso() { # caso <FIRES|SILENT> <regla> <descripcion>
  local esperado="$1" regla="$2" que="$3" visto
  correr
  encendio "$regla" && visto=FIRES || visto=SILENT
  if [ "$visto" = "$esperado" ]; then
    printf '  \033[32mok\033[0m    %-6s %-7s %s\n' "$regla" "$visto" "$que"
  else
    printf '  \033[31mMAL\033[0m   %-6s %-7s %s → esperaba %s\n' "$regla" "$visto" "$que" "$esperado"
    printf '%s\n' "$SALIDA" | grep -E '^  (W[0-9]+|ok)' | grep -vE '^  ok' | head -3 | sed 's/^/          /'
    tfail=1
  fi
}

# ── el arbol base tiene que estar LIMPIO ──────────────────────────────────────────────────────
# Sin esto todo lo de abajo es humo: un base sucio hace que cada caso salga rojo por herencia.
printf '\n\033[1m── base · el arbol de fixtures pasa las 16 reglas\033[0m\n'
correr "$B"
if printf '%s\n' "$SALIDA" | grep -q 'WEB-LINT: PASS'; then
  printf '  \033[32mok\033[0m    el arbol base esta limpio (si no, todo caso de abajo seria rojo por herencia)\n'
else
  printf '  \033[31mMAL\033[0m   el arbol base NO pasa el lint. Los casos de abajo no miden nada:\n'
  printf '%s\n' "$SALIDA" | grep -E '^  W[0-9]+' | head -8 | sed 's/^/          /'
  tfail=1
fi

printf '\n\033[1m── la vidriera es publica, cacheada y de costo acotado\033[0m\n'

nuevo; ap 'app/(storefront)/s/[slug]/page.tsx' <<'EOF'
'use client';
EOF
caso FIRES W001 "'use client' en la vidriera: JS de datos al visitante"

nuevo; fx 'app/(storefront)/error.tsx' <<'EOF'
'use client';
export default function Error() {
  return <p>ups</p>;
}
EOF
caso SILENT W001 "error.tsx SI puede ser client: Next lo exige (el HIGH de S1)"

nuevo; fx 'app/(storefront)/error.js' <<'EOF'
'use client';
export default function Error() { return null; }
EOF
caso SILENT W001 "LIMITE CONOCIDO: error.js no se camina (solo .ts/.tsx). Lo reporto storefront-agent"

nuevo; ap 'app/(storefront)/s/[slug]/page.tsx' <<< "$(printf "import { headers } from 'next/headers';\nheaders();\n")"
caso FIRES W002 "headers() en la vidriera: la ruta se vuelve dinamica y muere el ISR"

nuevo; ap 'app/(storefront)/s/[slug]/page.tsx' <<< "$(printf "const h = new Headers();\nh.set('set-cookie', 'a=1');\n")"
caso FIRES W003 "un set-cookie apaga el CDN entero"

nuevo; ap 'app/(storefront)/s/[slug]/page.tsx' <<< "$(printf "export const revalidate = 60;\n")"
caso FIRES W004 "revalidate = 60: 216x el costo (la prohibicion explicita del brief)"

nuevo; ap 'app/(storefront)/s/[slug]/page.tsx' <<< "$(printf "const L = <Link prefetch={true} href=\"/x\" />;\n")"
caso FIRES W005 "prefetch={true}: una invocacion de funcion por card"

nuevo; ap 'app/(app)/_lib/q.ts' <<< "$(printf "import Image from 'next/image';\n")"
caso FIRES W006 "next/image: Vercel Image Optimization esta PROHIBIDO como default"

nuevo
fx "app/(storefront)/s/[slug]/p/[listing]/page.tsx" <<'EOF'
export default function Ficha() {
  return <article>ficha</article>;
}
EOF
caso FIRES W007 "ruta dinamica sin generateStaticParams: soft 404 con status 200"

printf '\n\033[1m── aislamiento de tenant\033[0m\n'

nuevo; ap 'app/(app)/_lib/q.ts' <<< "$(printf "await sb.auth.updateUser({ data: { user_metadata: { tenant_id: t } } });\n")"
caso FIRES W008 "tenant_id en user_metadata: el usuario lo escribe = escalacion de tenant"

nuevo; ap 'app/(storefront)/s/[slug]/page.tsx' <<< "$(printf "const x = unit.imei;\n")"
caso FIRES W009 "imei en la vidriera"

nuevo; ap 'app/(storefront)/s/[slug]/page.tsx' <<< "$(printf "const c = listing.cost_usd;\n")"
caso FIRES W009 "cost_usd en la vidriera: el seller no ve costo, el visitante menos"

nuevo; ap 'app/(storefront)/s/[slug]/page.tsx' <<< "$(printf "const n = row.internalNotes;\n")"
caso FIRES W009 "internalNotes en la vidriera"

printf '\n\033[1m── bordes\033[0m\n'

nuevo; ap 'app/(app)/_lib/q.ts' <<< "$(printf "const k = process.env.R2_SECRET;\n")"
caso FIRES W010 "process.env fuera de _lib/env.ts: Zod en UN borde, no salpicado"

nuevo; ap 'app/(app)/_lib/q.ts' <<< "$(printf "if (process.env.NODE_ENV === 'test') {}\n")"
caso SILENT W010 "NODE_ENV esta exceptuado a proposito"

nuevo; ap 'app/(app)/_lib/q.ts' <<< "$(printf "console.log(listing);\n")"
caso FIRES W011 "console.log(listing): el IMEI y el costo a los logs de Vercel para siempre"

nuevo; fx 'app/(app)/app/(panel)/actions.ts' <<'EOF'
'use server';
export async function borrarTodo(id: string) {
  return id;
}
EOF
caso FIRES W012 "Server Action sin verificar sesion adentro: el proxy NO es control de acceso"

nuevo; fx 'app/(app)/app/(panel)/actions.ts' <<'EOF'
'use server';
import { requireTenant } from '../../_lib/session';
export async function borrarTodo(id: string) {
  const ctx = await requireTenant();
  return ctx.tenantId + id;
}
EOF
caso SILENT W012 "con requireTenant() adentro pasa (la regla castigaba la conducta correcta, S2)"

nuevo; fx 'app/(app)/_lib/auth/sign-in.ts' <<'EOF'
'use server';
export async function signIn(email: string) {
  return email;
}
EOF
caso SILENT W012 "_lib/auth/** exento: no se le pide sesion a la accion que la crea"

printf '\n\033[1m── el proxy, que corre en el 100% de los hits\033[0m\n'

nuevo; ap 'proxy.ts' <<< "$(printf "const cache = new Map();\n")"
caso FIRES W013 "un Map a nivel de modulo NO es un cache: el proxy corre fuera del runtime de la app"

nuevo; ap 'proxy.ts' <<< "$(printf "import { db } from '@istock/db';\n")"
caso FIRES W013 "el proxy consultando la DB: I/O antes del cache, en cada pageview"

nuevo; ap 'proxy.ts' <<< "$(printf "export const runtime = 'nodejs';\n")"
caso FIRES W014 "declarar runtime en el proxy: en Next 16 tira error de build"

nuevo; rm "$T/w/proxy.ts"
caso FIRES W013 "sin proxy.ts no hay vidriera por host"

printf '\n\033[1m── W015 · filtro de tenant EN LA QUERY, ademas de RLS\033[0m\n'
printf '   \033[2mcada SILENT tiene un FIRES gemelo en el mismo archivo: si el path no se escaneara,\n'
printf '   el gemelo tampoco encenderia y este arnes se caeria.\033[0m\n'

W15="app/(app)/_lib/q.ts"

nuevo; fx "$W15" <<'EOF'
import { listings } from '@istock/db';
export async function todas(tx: any) {
  return tx.select().from(listings);
}
EOF
caso FIRES W015 "select sin .where(): la query mas peligrosa del repo"

nuevo; fx "$W15" <<'EOF'
import { eq } from 'drizzle-orm';
import { listings } from '@istock/db';
export async function delTenant(tx: any, tenantId: string) {
  return tx.select().from(listings).where(eq(listings.tenantId, tenantId));
}
EOF
caso SILENT W015 "select con tenantId en el .where(): asi se escribe"

# El hallazgo de `session.ts:71`, que la PRIMERA version de W015 dejaba pasar en verde.
nuevo; fx "$W15" <<'EOF'
import { eq } from 'drizzle-orm';
import { memberships, tenants } from '@istock/db';
export async function cual(tx: any, userId: string) {
  return tx
    .select({ tid: memberships.tenantId })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(eq(memberships.userId, userId));
}
EOF
caso FIRES W015 "PRESENCIA NO ES FILTRO: proyectar tenantId y nombrarlo en el join no filtra nada"

nuevo; fx "$W15" <<'EOF'
import { listings } from '@istock/db';
export async function crear(tx: any, ctx: any) {
  return tx.insert(listings).values({ tenantId: ctx.tenantId, title: 'x' });
}
EOF
caso SILENT W015 "un insert se ata por el .values(), no por un .where() que no puede tener"

nuevo; fx "$W15" <<'EOF'
import { listings } from '@istock/db';
export async function crear(tx: any) {
  return tx.insert(listings).values({ title: 'x' });
}
EOF
caso FIRES W015 "insert sin tenantId en el values(): una fila huerfana entre tenants"

nuevo; fx "$W15" <<'EOF'
export async function barrer(tx: any) {
  return tx.execute(sql`select id from public.reservations where expires_at < now()`);
}
EOF
caso FIRES W015 "sql crudo sin tenant en el where: la pasada del builder no lo ve"

nuevo; fx "$W15" <<'EOF'
export async function barrer(tx: any, tid: string) {
  return tx.execute(sql`select id from public.reservations where tenant_id = ${tid} limit 10`);
}
EOF
caso SILENT W015 "sql crudo con tenant_id en el where"

# ── `insert ... select`: la lista de columnas es PRESENCIA, no filtro (S8, 2026-08-28) ────────
# La vara del `values` —"el tenant viaja como dato, alcanza con que este en la lista"— aplicada a
# un `insert ... select` dejaba VERDE un insert que escribe UNA FILA POR TENANT. El primer caso
# es esa mutacion exacta, medida sobre el handler real de S8 antes de tocar la regla; los dos
# SILENT de abajo son los dos beacons de S4, que atan el tenant en lugares DISTINTOS y los dos
# tienen que seguir callados: si uno solo encendiera, la regla estaria castigando la forma buena.
nuevo; fx "$W15" <<'EOF'
export async function canje(tx: any, nombre: string) {
  return tx.execute(sql`
    insert into tradein_leads ("tenant_id", "customer_name")
    select t.id, ${nombre}::text
    from tenants t
  `);
}
EOF
caso FIRES W015 "insert...select sin where: la lista de columnas es presencia, no filtro"

nuevo; fx "$W15" <<'EOF'
export async function canje(tx: any, nombre: string) {
  return tx.execute(sql`
    insert into tradein_leads ("tenant_id", "customer_name")
    select t.id, ${nombre}::text
    from tenants t
    where t.id = (select public.storefront_tenant_id())
  `);
}
EOF
caso SILENT W015 "insert...select atado en el where (el handler de S8)"

nuevo; fx "$W15" <<'EOF'
export async function beacon(tx: any, src: string) {
  return tx.execute(sql`
    insert into wa_click_events ("tenant_id", "listing_id", "source")
    select claim.tid, null::uuid, ${src}::wa_click_source
    from (select (select public.storefront_tenant_id()) as tid) as claim
    where claim.tid is not null
  `);
}
EOF
caso SILENT W015 "insert...select atado en el FROM, no en el where (el beacon del footer de S4)"

# Este es el que separa la ventana correcta de la ingenua: PROYECTAR `l.tenant_id` en la lista del
# select es la misma presencia que ponerlo en la lista de columnas. Si la ventana arrancara en el
# `select` en vez de en el `from`, este caso pasaria en verde y la regla no habria cerrado nada.
nuevo; fx "$W15" <<'EOF'
export async function fuga(tx: any, id: string) {
  return tx.execute(sql`
    insert into wa_click_events ("tenant_id", "listing_id", "source")
    select l.tenant_id, l.id, 'card'::wa_click_source
    from listings l
    where l.id = ${id}::uuid
  `);
}
EOF
caso FIRES W015 "insert...select que PROYECTA tenant_id y no lo filtra: presencia otra vez"

# ── El caso que el harness NO tenia, y que apagaba la rama entera ─────────────────────────────
# Ningun fixture usaba un identificador que CONTUVIERA la palabra `from`, asi que los tres casos de
# arriba pasaban con una ventana que buscaba subcadena. `listing_events.from_status` existe hoy en
# el schema: nombrarla en la lista de columnas movia el arranque de la ventana DENTRO del parentesis
# y W015 volvia a leer la lista de columnas como si fuera la fuente — verde sobre una escritura
# cross-tenant. Lo encontro `adversary-reviewer` en S8. Los dos casos van juntos a proposito: el
# FIRES prueba que la columna ya no apaga la regla, y el SILENT prueba que el arreglo no se llevo
# puesta la forma correcta moviendo la ventana demasiado lejos.
nuevo; fx "$W15" <<'EOF'
export async function backfill(tx: any) {
  return tx.execute(sql`
    insert into listing_events ("tenant_id", "listing_id", "from_status")
    select l.tenant_id, l.id, 'draft'::listing_status
    from listings l
  `);
}
EOF
caso FIRES W015 "una columna llamada from_status en la lista NO puede mover la ventana"

nuevo; fx "$W15" <<'EOF'
export async function backfillAtado(tx: any, t: string) {
  return tx.execute(sql`
    insert into listing_events ("tenant_id", "listing_id", "from_status")
    select l.tenant_id, l.id, 'draft'::listing_status
    from listings l where l.tenant_id = ${t}
  `);
}
EOF
caso SILENT W015 "la misma forma, atada por el where de la fuente: from_status no la vuelve falso positivo"

nuevo; fx "$W15" <<'EOF'
export async function conSubselect(tx: any, t: string) {
  return tx.execute(sql`
    insert into listing_events ("tenant_id", "listing_id")
    select (select x.id from aux x limit 1), l.id
    from listings l where l.tenant_id = ${t}
  `);
}
EOF
caso SILENT W015 "un from adentro de un subselect de proyeccion no es la fuente: la ventana es nivel 0"

printf '\n\033[1m── W015 · la marca de excepcion, que es donde se decide declarado vs invisible\033[0m\n'

nuevo; fx "$W15" <<'EOF'
import { memberships } from '@istock/db';

/**
 * web-lint:sin-tenant corre en el signup, antes de que exista un tenant, para el un-negocio-por-persona
 */
export async function hasMembership(tx: any, userId: string) {
  return tx.select().from(memberships).where(eq(memberships.userId, userId));
}
EOF
caso SILENT W015 "marca en el docblock pegado arriba, con motivo largo: la forma real de hasMembership"

nuevo; fx "$W15" <<'EOF'
import { memberships } from '@istock/db';

/**
 * web-lint:sin-tenant porque si
 */
export async function hasMembership(tx: any, userId: string) {
  return tx.select().from(memberships).where(eq(memberships.userId, userId));
}
EOF
caso FIRES W015 "un motivo de tres palabras no es un motivo: se piden 30+ caracteres"

# "Proximidad no es alcance": la marca vive en OTRA declaracion, la de al lado.
nuevo; fx "$W15" <<'EOF'
import { memberships, listings } from '@istock/db';

/**
 * web-lint:sin-tenant corre en el signup, antes de que exista un tenant, para el un-negocio-por-persona
 */
export async function hasMembership(tx: any, userId: string) {
  return tx.select().from(memberships).where(eq(memberships.userId, userId));
}

export async function todas(tx: any) {
  return tx.select().from(listings);
}
EOF
caso FIRES W015 "PROXIMIDAD NO ES ALCANCE: la marca de la funcion de arriba no excusa a la de abajo"

# "Sin ancla no hay exencion": la marca esta en el docblock del MODULO, que los import separan.
nuevo; fx "$W15" <<'EOF'
/**
 * web-lint:sin-tenant este modulo entero es cross-tenant y aca esta el motivo largo de sobra
 */
import { memberships } from '@istock/db';

export async function cual(tx: any, userId: string) {
  return tx.select().from(memberships).where(eq(memberships.userId, userId));
}
EOF
caso FIRES W015 "el docblock del MODULO no exime: los import lo separan de la declaracion"

printf '\n\033[1m── W016 · el techo de abuso de la vidriera es el WAF, no una query\033[0m\n'

# Par 1 · el brazo (a): abre Postgres + nombra el concepto. El SILENT es el caso REAL de
# `track/route.ts`, que abre Postgres y explica la prohibicion en su docblock: una regla que se
# encienda ahi castiga por documentarse. El gemelo prueba que el archivo si se estaba mirando.
nuevo; fx 'app/(storefront)/_lib/beacon.ts' <<'EOF'
import { createDb } from '@istock/db';

/**
 * No hay contador de abuso propio: §2 prohibe rate limiting con contador en Postgres sobre la
 * vidriera. El techo lo pone el WAF (60/min por IP en config/firewall-rules.json).
 */
export function abrir(url: string) {
  return createDb(url);
}
EOF
caso SILENT W016 "el archivo abre Postgres y NOMBRA la prohibicion en un comentario: documentarse no es violarla"

ap 'app/(storefront)/_lib/beacon.ts' <<'EOF'
export const rateLimit = { ventana: 60 };
EOF
caso FIRES W016 "gemelo: el mismo archivo, el mismo concepto, pero en codigo"

# Par 2 · nombrar el concepto NO alcanza si el archivo no abre Postgres: leer el veredicto del WAF
# desde un header es exactamente lo que queremos que haga la vidriera.
nuevo; fx 'app/(storefront)/_lib/waf.ts' <<'EOF'
export function techoDelWaf(h: Headers) {
  const rateLimitRestante = h.get('x-vercel-rate-limit-remaining');
  return rateLimitRestante === null ? null : Number(rateLimitRestante);
}
EOF
caso SILENT W016 "nombra rate limit pero no abre Postgres: leer el veredicto del WAF es lo correcto"

ap 'app/(storefront)/_lib/waf.ts' <<'EOF'
import { createDb } from '@istock/db';
export const db = createDb(process.env.DATABASE_URL ?? '');
EOF
caso FIRES W016 "gemelo: el mismo concepto, ahora con la puerta a Postgres abierta"

# Par 3 · el brazo (b): la FORMA del contador, aunque no se llame rate limit. Es como se escribe
# de verdad —nadie nombra la variable `rateLimiter`— y es el brazo que ataja la version astuta.
nuevo; fx 'app/(storefront)/_lib/hits.ts' <<'EOF'
import { sql } from 'drizzle-orm';

export function apexDe(hostname: string, apex: string) {
  return hostname.slice(0, -(apex.length + 1));
}
export const q = sql`select 1`;
EOF
caso SILENT W016 "aritmetica de strings con + 1 no es un contador: el shape real de _lib/host.ts"

ap 'app/(storefront)/_lib/hits.ts' <<'EOF'
export const contar = (t: any) => sql`${t.hits} + 1`;
EOF
caso FIRES W016 "gemelo: el mismo + 1, adentro de un template de sql"

nuevo; fx 'app/(storefront)/_lib/upsert.ts' <<'EOF'
export async function marcar(tx: any, tabla: any, ip: string) {
  await tx.insert(tabla).values({ ip }).onConflictDoUpdate({ target: tabla.ip, set: { n: 2 } });
}
EOF
caso FIRES W016 "upsert en la vidriera sin nombrar el concepto: el contador que no se declara"

printf '\n\033[1m── F0 · ausencia de medicion es FAIL, nunca PASS\033[0m\n'
nuevo
correr_schema() {
  SALIDA=$(WEB_LINT_ROOT="$T/w" WEB_LINT_SCHEMA="$T/no-existe" node "$LINT" 2>&1 | sed 's/\x1b\[[0-9;]*m//g')
}
correr_schema
if encendio W015; then
  printf '  \033[32mok\033[0m    %-6s %-7s %s\n' W015 FIRES "sin poder leer el schema, W015 FALLA (una lista vacia aprobaria todo)"
else
  printf '  \033[31mMAL\033[0m   %-6s %-7s %s\n' W015 SILENT "sin schema legible el lint dio PASS: 0 tablas miradas y verde"
  tfail=1
fi

# Mismo principio para W016: si `(storefront)` no existe, la regla mira una lista vacia. Una lista
# vacia no tiene infracciones, asi que la regla saldria VERDE justo cuando dejo de medir.
nuevo; rm -rf "$T/w/app/(storefront)"
caso FIRES W016 "sin un solo archivo de (storefront), W016 FALLA (medir cero no es aprobar)"

printf '\n\033[1m── el arbol real\033[0m\n'
if node "$LINT" >/dev/null 2>&1; then
  printf '  \033[32mok\033[0m    apps/web pasa su propio lint\n'
else
  printf '  \033[31mMAL\033[0m   apps/web NO pasa su propio lint\n'; tfail=1
fi

if [ "$tfail" = "0" ]; then
  printf '\n\033[1;32mPOLARIDAD WEB-LINT: OK\033[0m — las 16 reglas se vieron encender.\n'
else
  printf '\n\033[1;31mPOLARIDAD WEB-LINT: MAL\033[0m\n'
fi
exit "$tfail"
