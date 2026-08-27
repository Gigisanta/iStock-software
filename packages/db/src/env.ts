/**
 * Borde de entorno de `packages/db`. Una sola variable, leída en un solo lugar.
 *
 * No hay Zod acá a propósito: Zod está en los bordes de *request* (CLAUDE.md §5), y meterlo
 * como dependencia de runtime del paquete de DB agrega peso al bundle del server por una
 * validación de tres líneas que además tiene que correr antes que nada.
 */

export const DEFAULT_LOCAL_DATABASE_URL = 'postgresql://localhost:5432/istock_dev';

export class MissingDatabaseUrlError extends Error {
  constructor() {
    super(
      'falta DATABASE_URL. En local: ./scripts/pg-local.sh y después ' +
        `DATABASE_URL="${DEFAULT_LOCAL_DATABASE_URL}"`,
    );
    this.name = 'MissingDatabaseUrlError';
  }
}

/**
 * URL de conexión. En local cae al default de `scripts/pg-local.sh` (sin usuario: libpq usa el
 * usuario del SO), para que `pnpm --filter @istock/db test` corra sin ceremonia.
 * En Vercel/Supabase **no** hay default: si falta, se rompe fuerte y temprano.
 */
export function databaseUrl(): string {
  const fromEnv = process.env['DATABASE_URL'];
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  if (process.env['VERCEL'] !== undefined || process.env['NODE_ENV'] === 'production') {
    throw new MissingDatabaseUrlError();
  }
  return DEFAULT_LOCAL_DATABASE_URL;
}
