import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    globals: false,
    // sharp encodea una imagen de referencia de 12MP: el primer run paga el decode.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
