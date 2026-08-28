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
