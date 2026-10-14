import { payoutFor, spin, type SpinOutcome } from './engine.js';
import { HmacStream, hashServerSeed, type SeedTriple } from './rng.js';

/**
 * Reproduce una ronda a partir de las semillas. Es la misma función que usa el servidor,
 * por eso el verificador del navegador no puede "discrepar" por implementar distinto.
 */
export function playRound(seeds: SeedTriple): SpinOutcome {
  return spin(new HmacStream(seeds));
}

export interface VerifyInput extends SeedTriple {
  serverSeedHash: string;
  bet: number;
  claimed: { outcome: SpinOutcome; payout: number };
}

export interface VerifyResult {
  commitmentOk: boolean;
  outcomeOk: boolean;
  payoutOk: boolean;
  recomputed: SpinOutcome;
}

export function verifyRound(input: VerifyInput): VerifyResult {
  const recomputed = playRound(input);
  return {
    commitmentOk: hashServerSeed(input.serverSeed) === input.serverSeedHash.toLowerCase(),
    outcomeOk: canonicalJson(recomputed) === canonicalJson(input.claimed.outcome),
    payoutOk: payoutFor(recomputed, input.bet) === input.claimed.payout,
    recomputed,
  };
}

/**
 * JSON con claves ordenadas. Necesario porque Postgres `jsonb` no conserva el orden de las
 * claves: comparar con JSON.stringify directo daría falsos negativos.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}
