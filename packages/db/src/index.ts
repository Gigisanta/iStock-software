/**
 * `@istock/db` — Drizzle schema, migraciones versionadas, políticas RLS y seed demo.
 *
 * ## Qué importar y desde dónde
 * - **Server code de la app**: `import { createDb, listings } from '@istock/db'`.
 * - **`drizzle-kit`**: usa `./src/schema/index.ts` directo (ver `drizzle.config.ts`).
 *
 * ## Lo que este paquete NO exporta a propósito
 * No hay un cliente "de vidriera" ni un helper que arme el DTO público: eso vive en
 * `@istock/domain` (`publicListingDTO`, allowlist explícita). Si un día alguien necesita
 * `select *` para la vidriera, la respuesta es que no: la vidriera consume el DTO.
 *
 * `src/test-session.ts` **no** se re-exporta: abre conexiones con `set local role` y sólo
 * tiene sentido dentro de los tests de RLS.
 *
 * ## Regla que sobrevive a este archivo
 * RLS es la última línea, no la única (CLAUDE.md §2): toda query lleva **además** su
 * `where tenant_id = ...` explícito. Defensa en profundidad; si mañana una policy se cae en un
 * merge, la query sigue acotada.
 */

export * from './schema';

export { createDb, createSqlClient, type CreateClientOptions, type Database } from './client';
export { DEFAULT_LOCAL_DATABASE_URL, MissingDatabaseUrlError, databaseUrl } from './env';
export { MONEY_MAX_CENTS, MoneyColumnError, centsToDecimal, decimalToCents, moneyCents } from './money';
