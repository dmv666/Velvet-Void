/**
 * RTP teórico EXACTO. Reparte el primer rodillo entre worker threads.
 *   pnpm --filter @velvet/game-math rtp:exact [--json] [--write]
 * --write guarda math-report.json (lo leen el simulador, los tests y GET /math).
 */
import { availableParallelism } from 'node:os';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { tsWorker } from '../src/node/ts-worker.js';
import { writeFileSync } from 'node:fs';
import { STRIPS, MATH_VERSION } from '../src/config.js';
import { mathFingerprint } from '../src/fingerprint.js';
import { exactPartial, expectedTotalWeight, mergePartials, summarize, type ExactPartial } from '../src/exact.js';

type Wire = Omit<ExactPartial, 'dist'> & { dist: [number, bigint][] };

if (!isMainThread) {
  const p = exactPartial(workerData as number[]);
  parentPort!.postMessage({ ...p, dist: [...p.dist] } satisfies Wire);
} else {
  const t0 = performance.now();
  const n = Math.min(availableParallelism(), STRIPS[0]!.length);
  const chunks: number[][] = Array.from({ length: n }, () => []);
  STRIPS[0]!.forEach((_, stop) => chunks[stop % n]!.push(stop));
  const parts = await Promise.all(
    chunks.map(
      (stops) =>
        new Promise<ExactPartial>((resolve, reject) => {
          const w = tsWorker(import.meta.url, stops);
          w.once('message', (m: Wire) => resolve({ ...m, dist: new Map(m.dist) }));
          w.once('error', reject);
        }),
    ),
  );
  const merged = mergePartials(parts);
  if (merged.totalWeight !== expectedTotalWeight()) throw new Error('peso total inconsistente');
  const report = summarize(merged);
  const seconds = ((performance.now() - t0) / 1000).toFixed(1);
  const json = JSON.stringify({ mathVersion: MATH_VERSION, fingerprint: mathFingerprint(), ...report }, null, 2);
  if (process.argv.includes('--write')) writeFileSync(new URL('../math-report.json', import.meta.url), json + '\n');
  if (process.argv.includes('--json')) {
    console.log(json);
  } else {
    const pct = (x: number) => `${(x * 100).toFixed(4)} %`;
    console.log(`Velvet Void ${MATH_VERSION} — RTP exacto (${seconds}s, ${n} workers)`);
    console.log(`  RTP                 ${pct(report.rtp)}`);
    console.log(`  Desv. estándar      ${report.stdDev.toFixed(3)} × apuesta`);
    console.log(`  Frecuencia acierto  ${pct(report.hitFrequency)}`);
    console.log(`  Rondas con Grieta   ${pct(report.riftFrequency)}  (aportan ${pct(report.riftRtpShare)} del RTP)`);
    console.log(`  Premio máximo       ${report.maxMultiplierOfBet}× apuesta`);
    console.log('  RTP por símbolo     ' + Object.entries(report.symbolRtp).map(([k, v]) => `${k} ${pct(v)}`).join(' · '));
    console.log('  Cola                ' + Object.entries(report.tail).map(([k, v]) => `P(${k}) ${v.toExponential(3)}`).join(' · '));
  }
}
