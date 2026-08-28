import { defineConfig } from 'vitest/config';

/**
 * Tests que **cruzan un límite** (`CLAUDE.md` §4): integración entre owners, RLS contra Postgres
 * real, invariantes que ningún paquete puede sostener solo. El unit test de un paquete vive en el
 * paquete; acá vive lo que se rompe *entre* dos paquetes y no le duele a ninguno de los dos.
 */
export default defineConfig({
  test: {
    include: ['**/*.test.ts'],
    exclude: ['node_modules/**'],
    environment: 'node',
    globals: false,
    // `rls-cross-tenant.test.ts` abre conexiones reales a Postgres y monta/desmonta un fixture de
    // dos tenants más un schema de control. Sin esto, dos archivos podrían pisarse el fixture y el
    // síntoma sería intermitencia, que es la peor forma de perder un test de seguridad.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
