import { describe, expect, it } from 'vitest';
import { decryptSeed, encryptSeed, newServerSeed } from '../src/lib/crypto.js';
import { RateLimiter } from '../src/lib/rate-limit.js';

describe('cifrado de semillas', () => {
  const key = Buffer.alloc(32, 7);
  it('ida y vuelta', () => {
    const seed = newServerSeed();
    expect(decryptSeed(key, encryptSeed(key, seed, 'user-a'), 'user-a')).toBe(seed);
  });
  it('mover el blob a otro usuario lo invalida (AAD)', () => {
    const blob = encryptSeed(key, newServerSeed(), 'user-a');
    expect(() => decryptSeed(key, blob, 'user-b')).toThrow();
  });
  it('un bit alterado se detecta (GCM autentica)', () => {
    const blob = encryptSeed(key, newServerSeed(), 'u');
    blob[blob.length - 1]! ^= 1;
    expect(() => decryptSeed(key, blob, 'u')).toThrow();
  });
});

describe('RateLimiter', () => {
  it('permite la ráfaga, luego limita y se recupera con el tiempo', () => {
    let t = 0;
    const rl = new RateLimiter({ capacity: 2, refillPerSec: 1 }, () => t);
    expect([rl.take('a'), rl.take('a'), rl.take('a')]).toEqual([0, 0, 1]);
    expect(rl.take('b')).toBe(0); // las claves son independientes
    t += 1000;
    expect(rl.take('a')).toBe(0);
  });
  it('acota la memoria aunque lleguen claves sin fin', () => {
    const rl = new RateLimiter({ capacity: 1, refillPerSec: 0.001 }, () => 0, 100);
    for (let i = 0; i < 1000; i++) rl.take(`ip-${i}`);
    expect(rl.size).toBeLessThanOrEqual(100);
  });
});
