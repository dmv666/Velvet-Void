import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    // Los ficheros comparten la BD de test: en serie para que los tests de concurrencia midan lo que creen medir.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
