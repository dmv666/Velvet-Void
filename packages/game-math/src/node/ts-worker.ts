import { Worker } from 'node:worker_threads';

/**
 * Lanza un worker que ejecuta un módulo TypeScript. `execArgv: ['--import','tsx']` no
 * resuelve bien los imports `.js` → `.ts` dentro de workers, así que registramos tsx
 * explícitamente con su API desde el propio worker.
 */
export function tsWorker(moduleUrl: string, workerData: unknown): Worker {
  const code = `import('tsx/esm/api').then(({ tsImport }) => tsImport(${JSON.stringify(moduleUrl)}, ${JSON.stringify(moduleUrl)}))`;
  return new Worker(code, { eval: true, workerData });
}
