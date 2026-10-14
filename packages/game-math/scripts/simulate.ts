/**
 * Simulador Monte Carlo por el camino de producción (HMAC-SHA256 + rechazo).
 *   pnpm --filter @velvet/game-math rtp:sim [rondas=10000000]
 * Compara con math-report.json (RTP exacto) y falla si |z| > 3.29 (p ≈ 0.001).
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { mathFingerprint } from '../src/fingerprint.js';
import { compareToExact, mergeStats, simulate, type SimStats } from '../src/simulate.js';
import { tsWorker } from '../src/node/ts-worker.js';

if (!isMainThread) {
  const { rounds } = workerData as { rounds: number };
  // CSPRNG para la semilla de cada worker: igual que el servidor.
  parentPort!.postMessage(simulate(rounds, randomBytes(32).toString('hex')));
} else {
  const total = Number(process.argv[2] ?? 10_000_000);
  const report = JSON.parse(readFileSync(new URL('../math-report.json', import.meta.url), 'utf8')) as {
    rtp: number;
    stdDev: number;
    hitFrequency: number;
    riftFrequency: number;
    fingerprint: string;
  };
  if (report.fingerprint !== mathFingerprint()) {
    console.error('math-report.json está desactualizado: ejecuta `pnpm rtp:exact --write`');
    process.exit(1);
  }
  const workers = availableParallelism();
  const t0 = performance.now();
  const parts = await Promise.all(
    Array.from({ length: workers }, (_, i) => {
      const rounds = Math.floor(total / workers) + (i < total % workers ? 1 : 0);
      return new Promise<SimStats>((resolve, reject) => {
        const w = tsWorker(import.meta.url, { rounds });
        w.once('message', resolve);
        w.once('error', reject);
      });
    }),
  );
  const s = mergeStats(parts);
  const cmp = compareToExact(s, report);
  const secs = (performance.now() - t0) / 1000;
  const pct = (x: number) => `${(x * 100).toFixed(4)} %`;
  console.log(`Simulación: ${s.rounds.toLocaleString('es')} rondas en ${secs.toFixed(1)}s (${Math.round(s.rounds / secs).toLocaleString('es')}/s, ${workers} workers)`);
  console.log(`  RTP simulado   ${pct(cmp.rtp)}   exacto ${pct(report.rtp)}   IC99 [${pct(cmp.ci99[0])}, ${pct(cmp.ci99[1])}]`);
  console.log(`  z              ${cmp.z.toFixed(3)}`);
  console.log(`  Desv. estándar ${cmp.stdDev.toFixed(3)}   exacta ${report.stdDev.toFixed(3)}`);
  console.log(`  Acierto        ${pct(s.hits / s.rounds)}   exacto ${pct(report.hitFrequency)}`);
  console.log(`  Grietas        ${pct(s.riftRounds / s.rounds)}   exacto ${pct(report.riftFrequency)}`);
  console.log(`  Premio máximo observado ${s.maxWin}×`);
  if (Math.abs(cmp.z) > 3.29) {
    console.error('✗ El RTP simulado se aleja del exacto más de lo que explica el azar.');
    process.exit(1);
  }
  console.log('✓ Coherente con el RTP exacto.');
}
