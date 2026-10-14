import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/**
 * E2E contra el build de producción del cliente (con su CSP) servido por `vite preview`,
 * que reenvía /api al servidor real. Requiere Postgres con las migraciones aplicadas.
 */
const CLIENT = 'http://localhost:4173';
// Chromium preinstalado si existe (contenedores de desarrollo); si no, el que instala Playwright (CI).
const preinstalled = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const launchOptions = existsSync(preinstalled) ? { executablePath: preinstalled } : {};

export default defineConfig({
  testDir: './e2e',
  // Chromium headless sin GPU renderiza WebGL por software (~6 FPS): una tirada tarda 5–7 s aquí y ~2 s en un navegador real.
  timeout: 120_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: CLIENT,
    trace: 'retain-on-failure',
    launchOptions,
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'], launchOptions } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @velvet/server exec tsx src/main.ts',
      url: 'http://127.0.0.1:3000/api/health',
      reuseExistingServer: !process.env.CI,
      env: {
        NODE_ENV: 'development',
        PORT: '3000',
        CLIENT_ORIGIN: CLIENT,
        DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://velvet_app:app_dev_only@127.0.0.1:5432/velvet_void',
        SEED_ENCRYPTION_KEY: process.env.SEED_ENCRYPTION_KEY ?? '22'.repeat(32),
      },
    },
    {
      command: 'pnpm --filter @velvet/client exec vite preview --port 4173 --strictPort',
      url: CLIENT,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
