import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { HmacStream, hashServerSeed, uniformInt, weightedIndex, type Rng } from '../src/rng.js';

const SEED = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

describe('uniformInt (muestreo por rechazo)', () => {
  it('descarta los valores de la cola incompleta en vez de usar módulo', () => {
    // Con n = 3, limit = 2^32 - (2^32 mod 3) = 4294967295. El valor 4294967295 debe rechazarse.
    const values = [4294967295, 7];
    const next = () => values.shift()!;
    expect(uniformInt(next, 3)).toBe(7 % 3);
    expect(values).toHaveLength(0);
  });

  it('acepta todo cuando n es potencia de 2 (no hay cola)', () => {
    expect(uniformInt(() => 0xffffffff, 4)).toBe(3);
  });

  it('rechaza n inválidos', () => {
    expect(() => uniformInt(() => 0, 0)).toThrow();
    expect(() => uniformInt(() => 0, 1.5)).toThrow();
  });
});

describe('HmacStream', () => {
  it('coincide con HMAC-SHA256 de Node para el primer bloque', () => {
    const stream = new HmacStream({ serverSeed: SEED, clientSeed: 'jugador', nonce: 42 });
    const digest = createHmac('sha256', Buffer.from(SEED, 'hex')).update('jugador:42:0').digest();
    for (let i = 0; i < 8; i++) expect(stream.nextUint32()).toBe(digest.readUInt32BE(i * 4));
    const next = createHmac('sha256', Buffer.from(SEED, 'hex')).update('jugador:42:1').digest();
    expect(stream.nextUint32()).toBe(next.readUInt32BE(0));
  });

  it('el nonce y la clientSeed cambian la salida', () => {
    const a = new HmacStream({ serverSeed: SEED, clientSeed: 'a', nonce: 0 }).nextUint32();
    const b = new HmacStream({ serverSeed: SEED, clientSeed: 'a', nonce: 1 }).nextUint32();
    const c = new HmacStream({ serverSeed: SEED, clientSeed: 'b', nonce: 0 }).nextUint32();
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('exige una serverSeed de 32 bytes y nonce entero ≥ 0', () => {
    expect(() => new HmacStream({ serverSeed: 'abcd', clientSeed: 'x', nonce: 0 })).toThrow();
    expect(() => new HmacStream({ serverSeed: SEED, clientSeed: 'x', nonce: -1 })).toThrow();
  });

  it('distribuye int(30) de forma uniforme (chi-cuadrado)', () => {
    const stream = new HmacStream({ serverSeed: SEED, clientSeed: 'chi', nonce: 0 });
    const n = 30, draws = 60_000;
    const counts = new Array<number>(n).fill(0);
    for (let i = 0; i < draws; i++) counts[stream.int(n)]!++;
    const expected = draws / n;
    const chi2 = counts.reduce((a, c) => a + (c - expected) ** 2 / expected, 0);
    // 29 grados de libertad: p = 0.001 ⇒ χ² ≈ 58.3
    expect(chi2).toBeLessThan(58.3);
  });
});

describe('hashServerSeed', () => {
  it('es el SHA-256 de los bytes (no del texto hex)', () => {
    expect(hashServerSeed(SEED)).toBe(createHash('sha256').update(Buffer.from(SEED, 'hex')).digest('hex'));
  });
});

describe('weightedIndex', () => {
  it('recorre los pesos en orden', () => {
    const fixed = (v: number): Rng => ({ int: () => v });
    expect(weightedIndex(fixed(0), [80, 17, 3])).toBe(0);
    expect(weightedIndex(fixed(79), [80, 17, 3])).toBe(0);
    expect(weightedIndex(fixed(80), [80, 17, 3])).toBe(1);
    expect(weightedIndex(fixed(99), [80, 17, 3])).toBe(2);
  });
});
