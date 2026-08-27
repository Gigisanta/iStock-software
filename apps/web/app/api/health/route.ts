/**
 * `GET /api/health` — señal de vida del deploy. Nada más.
 *
 * Lo que NO hace, y es la parte importante:
 * - **No toca Postgres.** Un health check que abre una conexión por request es un generador de
 *   costo silencioso: los uptime monitors pegan cada 30 s, o sea ~86.400 conexiones por mes por
 *   monitor, contra una base cuyo plan se mide en conexiones concurrentes.
 * - **No devuelve versión, commit, ni nombre de host.** Eso es reconocimiento gratis para
 *   cualquiera que escanee.
 * - **No requiere sesión**: es el único handler público de `app/api`, y lo es porque no revela
 *   absolutamente nada.
 */

export function GET(): Response {
  return Response.json({ status: 'ok' }, { headers: { 'cache-control': 'no-store' } });
}
