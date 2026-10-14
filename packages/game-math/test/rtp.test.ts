import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_WIN_MULTIPLIER, compareToExact, mathFingerprint, simulate } from '../src/index.js';

const report = JSON.parse(readFileSync(new URL('../math-report.json', import.meta.url), 'utf8')) as {
  fingerprint: string;
  rtp: number;
  stdDev: number;
  maxMultiplierOfBet: number;
};

describe('math-report.json', () => {
  it('corresponde a la configuración actual (si falla: pnpm rtp:exact --write)', () => {
    expect(report.fingerprint).toBe(mathFingerprint());
  });

  it('el RTP exacto está en el objetivo (95,5 %–96,5 %)', () => {
    expect(report.rtp).toBeGreaterThan(0.955);
    expect(report.rtp).toBeLessThan(0.965);
  });

  it('el tope de premio nunca se alcanza, así que no distorsiona el RTP', () => {
    expect(report.maxMultiplierOfBet).toBeLessThan(MAX_WIN_MULTIPLIER);
  });
});

describe('simulación rápida', () => {
  it('200 000 rondas reales (HMAC) caen cerca del RTP exacto', () => {
    const stats = simulate(200_000, randomBytes(32).toString('hex'));
    const cmp = compareToExact(stats, report);
    // |z| < 4: probabilidad de falso positivo ≈ 6e-5.
    expect(Math.abs(cmp.z)).toBeLessThan(4);
  }, 60_000);
});
