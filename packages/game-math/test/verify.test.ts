import { describe, expect, it } from 'vitest';
import { canonicalJson, hashServerSeed, payoutFor, playRound, verifyRound } from '../src/index.js';

const serverSeed = 'c0ffee'.padEnd(64, '0');

describe('verifyRound', () => {
  const seeds = { serverSeed, clientSeed: 'mi-semilla', nonce: 3 };
  const outcome = playRound(seeds);
  const bet = 1000;
  const base = { ...seeds, serverSeedHash: hashServerSeed(serverSeed), bet, claimed: { outcome, payout: payoutFor(outcome, bet) } };

  it('acepta una ronda honesta aunque el JSON venga con otro orden de claves (jsonb)', () => {
    const reordered = JSON.parse(canonicalJson(outcome)) as typeof outcome;
    expect(verifyRound({ ...base, claimed: { ...base.claimed, outcome: reordered } })).toMatchObject({
      commitmentOk: true,
      outcomeOk: true,
      payoutOk: true,
    });
  });

  it('detecta una serverSeed que no corresponde al hash publicado', () => {
    expect(verifyRound({ ...base, serverSeedHash: hashServerSeed('11'.repeat(32)) }).commitmentOk).toBe(false);
  });

  it('detecta un resultado o premio manipulado', () => {
    const tampered = { ...outcome, totalMultiplier: outcome.totalMultiplier + 10 };
    const r = verifyRound({ ...base, claimed: { outcome: tampered, payout: base.claimed.payout + 1 } });
    expect(r.outcomeOk).toBe(false);
    expect(r.payoutOk).toBe(false);
  });
});
