#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════════════════════
#  guard-routes.sh — fija el MODO DE SERVIDO de cada ruta. Owner: LEAD.
# ══════════════════════════════════════════════════════════════════════════════════════════════
#
# ## Por qué existe
# La columna `○ ◐ ƒ` de la tabla del `next build` es un dibujo para humanos y **confunde tres
# estados distintos**. El LEAD leyó `◐` en `/app/stock/[id]/fotos` y concluyó que `instant = false`
# no había hecho la ruta bloqueante; el manifest decía `compute=blocking` y la tabla decía `◐`
# igual que para una ruta que sí streamea. Un invariante que se verifica leyendo un glifo no es un
# invariante.
#
# ## Qué mira (y por qué es más fuerte que la tabla)
# `.next/prerender-manifest.json`, que trae por ruta:
#   compute=static   response=complete  → prerenderizada entera, se sirve de un archivo
#   compute=resuming response=initial   → shell estático + resume (PPR)
#   compute=blocking response=empty     → se computa antes de contestar, sin shell
# y las rutas ausentes del manifest, que son las dinámicas puras (`ƒ`).
#
# ## El invariante de seguridad, que es el motivo real de este archivo
# **Una ruta de `/app/*` que pase a `compute=static` es un leak cross-tenant.** Significa que
# contenido autenticado quedó horneado en un archivo estático que el CDN sirve a cualquiera: el
# panel de un tenant mostrado al siguiente que pida la URL. No lo detecta ningún test de RLS
# —la policy nunca llega a evaluarse, la respuesta no toca Postgres— ni ningún e2e logueado, que
# por definición pide con sesión. Se detecta acá o no se detecta.
#
# El resto de las filas son deuda documentada: fijan lo que el LEAD midió, para que un cambio de
# modo de servido sea una decisión y no un efecto colateral de otra cosa.
#
# ## Cómo se actualiza
# Cambiar una fila es legítimo. Cambiarla **sin decir por qué** no. Toda edición de la tabla de
# abajo lleva su motivo en el commit, y las filas de `/app/*` con `static` no se aceptan nunca.
#
# No corre `next build`: lee el `.next` que dejó el gate. Si no hay build, lo dice y falla.
set -euo pipefail

MANIFEST="apps/web/.next/prerender-manifest.json"
APP_ROUTES="apps/web/.next/app-path-routes-manifest.json"

if [[ ! -f "$MANIFEST" || ! -f "$APP_ROUTES" ]]; then
  echo "FAIL no hay build en apps/web/.next: corré el gate (que buildea) antes de este guard."
  echo "     falta: $MANIFEST"
  exit 1
fi

node --input-type=module -e '
import { readFileSync } from "node:fs";

// ruta => "compute/response". `dynamic` = ausente del prerender manifest.
const ESPERADO = {
  "/":                      "static/complete",
  "/precios":               "static/complete",
  "/_not-found":            "static/complete",
  "/_global-error":         "static/complete",
  "/api/health":            "static/complete",

  // Vidriera. `not-a-tenant` es el miss cacheado de ADR-011 y se sirve de un archivo a propósito.
  "/s/[slug]":              "blocking/empty",
  "/s/not-a-tenant":        "static/complete",

  // Ficha pública (S3). Mismo par que la grilla, y por el mismo motivo: la ruta con segmento
  // dinámico es ISR clásico (`blocking/empty` = se computa en el miss y después sale del CDN), y la
  // fila semilla se hornea en un archivo. Las tres filas se agregan el 2026-08-28, tarde: entraron
  // con el commit de S3 y el guard quedó en rojo tres commits porque NO ESTÁ EN CI y nadie lo corrió.
  // Ese es el hallazgo, no las rutas.
  //
  // `blocking` y no `resuming` es lo correcto acá y conviene dejarlo escrito: un shell de PPR para
  // una ficha significa mandar HTML antes de saber si el equipo existe, y entonces el 404 de un slug
  // inventado sale con `200` y cuerpo vacío. Es el mismo problema que ADR-011 resolvió en la raíz.
  "/s/[slug]/p/[listing]":              "blocking/empty",
  "/s/not-a-tenant/p/[listing]":        "blocking/empty",
  "/s/not-a-tenant/p/not-a-listing":    "static/complete",

  // Panel autenticado. NINGUNA puede ser `static`: ver el docblock.
  "/app":                   "resuming/initial",
  "/app/ajustes":           "resuming/initial",
  "/app/canjes":            "resuming/initial",
  "/app/crear-negocio":     "resuming/initial",
  "/app/stock":             "resuming/initial",
  "/app/stock/nuevo":       "resuming/initial",
  "/ingresar":              "resuming/initial",
  // Bloqueante a propósito (`export const instant = false`): sin esto el formulario de fotos no
  // funciona sin JavaScript, porque todo el contenido viaja escondido detrás del swap de streaming.
  "/app/stock/[id]/fotos":  "blocking/empty",

  // Beacon del click de WhatsApp (S4). `dynamic` es el unico valor aceptable y no por performance:
  // la ruta ESCRIBE una fila. Una ruta que escribe y aparece prerenderizada significa que se ejecuto
  // en build time, con el tenant equivocado o con ninguno.
  //
  // Se agrega el 2026-08-28, tarde otra vez: entro con `c9611b1` (S4) y el guard quedo rojo desde
  // entonces. Es la SEGUNDA vez que pasa lo mismo en este archivo — arriba esta escrito el caso de
  // S3. Pero la causa cambio y conviene no repetir el diagnostico viejo: en S3 fue que el guard no
  // estaba en CI. Ahora SI esta (`ci.yml:182`), y aun asi nadie se entero, porque **no hay nada
  // pusheado**: sin push no hay CI, y un gate que solo corre en un runner que nunca arranca es tan
  // invisible como uno que no esta configurado. El LEAD corre los accept-*; `guard-routes` no esta
  // en ninguno de ellos, asi que su unica ejecucion posible era la que no ocurria.
  "/s/[slug]/api/track":    "dynamic",

  "/_media/[...key]":       "dynamic",
  "/api/tenants/slug-check":"dynamic",
};

const m = JSON.parse(readFileSync("apps/web/.next/prerender-manifest.json", "utf8"));
const apr = JSON.parse(readFileSync("apps/web/.next/app-path-routes-manifest.json", "utf8"));
const pre = { ...(m.routes ?? {}), ...(m.dynamicRoutes ?? {}) };

const real = new Map();
for (const [k, e] of Object.entries(pre)) real.set(k, `${String(e.compute)}/${String(e.response)}`);
for (const v of Object.values(apr)) if (!real.has(v)) real.set(v, "dynamic");

let fallos = 0;
const fail = (m) => { console.log(`FAIL ${m}`); fallos++; };

// 1. El invariante duro, antes que cualquier comparación con la tabla: nada de `/app/*` estático.
for (const [ruta, modo] of real) {
  if (!ruta.startsWith("/app")) continue;
  if (ruta.startsWith("/app/api") || ruta.startsWith("/api")) continue;
  if (modo.startsWith("static/")) {
    fail(`${ruta} quedó PRERENDERIZADA (${modo}). Es contenido autenticado horneado en un ` +
         `archivo estático: el CDN se lo sirve a cualquiera y RLS ni se entera. Esto no se ` +
         `actualiza en la tabla, se arregla en la ruta.`);
  }
}

// 2. Drift contra lo medido.
for (const [ruta, esperado] of Object.entries(ESPERADO)) {
  if (!real.has(ruta)) { fail(`${ruta} desapareció del build (esperaba ${esperado}).`); continue; }
  const modo = real.get(ruta);
  if (modo !== esperado) fail(`${ruta} cambió de modo de servido: esperaba ${esperado}, es ${modo}.`);
}

// 3. Rutas nuevas: una ruta que nadie declaró es una decisión que nadie tomó.
for (const [ruta, modo] of real) {
  if (!(ruta in ESPERADO)) fail(`${ruta} es una ruta nueva (${modo}) y no está en la tabla de scripts/guard-routes.sh.`);
}

if (fallos === 0) {
  console.log(`PASS modo de servido de ${String(real.size)} rutas igual a lo medido`);
  console.log("PASS ninguna ruta de /app/* quedó prerenderizada");
} else {
  console.log(`\n${String(fallos)} fallo(s) de modo de servido.`);
  process.exit(1);
}
'
