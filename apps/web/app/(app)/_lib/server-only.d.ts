/**
 * `server-only` no está en `apps/web/package.json` (lo escribe el LEAD, no `app-agent`), pero
 * Next.js lo resuelve igual: `create-compiler-aliases` lo mapea a
 * `next/dist/compiled/server-only` y **rompe el build** si un Client Component lo importa.
 *
 * Este shim existe sólo para que `tsc --noEmit` resuelva el especificador. El efecto real —el
 * error de build cuando el DAL cruza al cliente, que es lo que pide `ARCHITECTURE.md`
 * §"Defensa en profundidad además de RLS"— lo da el bundler, no este archivo.
 *
 * Cuando el LEAD agregue `server-only` como dependencia declarada, este archivo se borra.
 */
declare module 'server-only';
