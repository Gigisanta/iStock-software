/**
 * Bootstrap del servidor de `apps/web`. Next llama `register()` **una vez por proceso**, antes de
 * atender la primera request y antes de cualquier render.
 *
 * ── Qué hace y por qué existe ────────────────────────────────────────────────────────────────
 * Enchufa el canal de incidentes de `@istock/media` (`setMediaIncidentReporter`) contra Sentry.
 * El paquete degrada en vez de tirar cuando una key de foto es insegura o la config de media está
 * rota —un `throw` adentro de un render cacheado no es un 500, es un 200 que nunca cierra— y para
 * eso reporta. Sin este cableado el reporte moría en un `console.warn` de una función serverless.
 *
 * ── Tres cosas que este archivo NO hace ──────────────────────────────────────────────────────
 * 1. **No tira nunca.** Un `register()` que revienta es un servidor que no levanta. Todo lo de acá
 *    adentro está envuelto y el fallo se traga.
 * 2. **No importa `@istock/media` de forma estática, y ya ni siquiera importa el barrel.** Ver
 *    abajo: el `import()` es dinámico *y* apunta al subpath liviano.
 * 3. **No lee secretos ni los pasa a ningún lado.** El DSN lo lee `_lib/env.ts`, que es el único
 *    borde de entorno con Zod del panel.
 *
 * ── El cold start, medido ────────────────────────────────────────────────────────────────────
 * Esto corre **una vez por instancia y en toda instancia**, incluidas las que nunca van a servir
 * una foto, así que lo que se cargue acá se paga siempre. Con la sonda de `packages/media`
 * (`scripts/subpath-probe/`: proceso nuevo, hook de `resolve` del loader, `sharedObjects` del
 * report de diagnóstico), apuntada a este archivo y ejecutando `register()`:
 *
 * | import de `_lib/observability/media-incidents.ts` | módulos resueltos | objetos nativos |
 * |---|---|---|
 * | `@istock/media` (el barrel)                       | 276               | 171 (`sharp-darwin-arm64.node` + `libvips-cpp.dylib`) |
 * | `@istock/media/incidents` (hoy)                    | **191**           | **0** |
 *
 * **Corrección de este mismo docblock:** la versión anterior decía que el barrel arrastraba el
 * *cliente de S3*. Es falso y lo dice la medición — `@aws-sdk/client-s3` tiene **cero** resoluciones
 * en las dos filas de arriba, porque `storage/r2.ts` lo carga con `await import()` adentro de cada
 * método. Lo que el barrel arrastraba, y este subpath elimina, es `sharp` (nativo) y su cadena
 * (`@img/colour`, `detect-libc`, `semver`). Un número viejo en un docblock es peor que ningún
 * número: el que lo lee cree que alguien lo midió.
 *
 * Los 191 que quedan son casi todos `zod`, que entra por `_lib/env.ts` y se paga a propósito: el
 * borde de entorno con Zod es el que hace que un DSN mal escrito sea un error con nombre y no un
 * `undefined` que viaja. Bajar de ahí es otra slice y otra discusión.
 *
 * `NEXT_RUNTIME` es el discriminador que inyecta el framework, no configuración nuestra: por eso
 * se lee acá y no en `_lib/env.ts` (y por eso este archivo está fuera del alcance de W015/W010,
 * que caminan `app/`).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  try {
    const { wireMediaIncidents } = await import('./app/(app)/_lib/observability/media-incidents');
    wireMediaIncidents();
  } catch {
    /* la telemetría de fotos no puede impedir que el servidor levante */
  }
}
