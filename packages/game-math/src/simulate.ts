import { payoutFor, spin } from './engine.js';
import { HmacStream, type Rng } from './rng.js';

export interface SimStats {
  rounds: number;
  /** Suma de premios en múltiplos de la apuesta (apuesta = 1). */
  sum: number;
  sumSq: number;
  hits: number;
  riftRounds: number;
  maxWin: number;
}

export const emptyStats = (): SimStats => ({ rounds: 0, sum: 0, sumSq: 0, hits: 0, riftRounds: 0, maxWin: 0 });

/**
 * Simula `rounds` rondas por el MISMO camino que producción: HmacStream con una serverSeed
 * aleatoria y nonce creciente. `nextSeed` inyecta la fuente de semillas (CSPRNG en el script).
 */
export function simulate(rounds: number, serverSeed: string, clientSeed = 'sim', makeRng?: (nonce: number) => Rng): SimStats {
  const bet = 1_000;
  const s = emptyStats();
  for (let nonce = 0; nonce < rounds; nonce++) {
    const out = spin(makeRng ? makeRng(nonce) : new HmacStream({ serverSeed, clientSeed, nonce }));
    const x = payoutFor(out, bet) / bet;
    s.rounds++;
    s.sum += x;
    s.sumSq += x * x;
    if (x > 0) s.hits++;
    if (out.rifts.length > 0) s.riftRounds++;
    if (x > s.maxWin) s.maxWin = x;
  }
  return s;
}

export function mergeStats(parts: readonly SimStats[]): SimStats {
  return parts.reduce(
    (a, p) => ({
      rounds: a.rounds + p.rounds,
      sum: a.sum + p.sum,
      sumSq: a.sumSq + p.sumSq,
      hits: a.hits + p.hits,
      riftRounds: a.riftRounds + p.riftRounds,
      maxWin: Math.max(a.maxWin, p.maxWin),
    }),
    emptyStats(),
  );
}

export interface SimComparison {
  rtp: number;
  stdDev: number;
  /** Error estándar de la media usando la desviación TEÓRICA. */
  standardError: number;
  /** z = (RTP simulado − RTP exacto) / error estándar. */
  z: number;
  ci99: [number, number];
}

export function compareToExact(s: SimStats, exact: { rtp: number; stdDev: number }): SimComparison {
  const rtp = s.sum / s.rounds;
  const variance = s.sumSq / s.rounds - rtp * rtp;
  const standardError = exact.stdDev / Math.sqrt(s.rounds);
  const z = (rtp - exact.rtp) / standardError;
  const half = 2.576 * standardError;
  return { rtp, stdDev: Math.sqrt(variance), standardError, z, ci99: [exact.rtp - half, exact.rtp + half] };
}
