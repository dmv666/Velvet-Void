import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

/**
 * Fuente de enteros uniformes. El motor solo depende de esta interfaz, así que el mismo
 * código sirve para la ronda real (HmacStream), para el verificador del navegador y
 * para el simulador.
 */
export interface Rng {
  /** Entero uniforme en [0, n). */
  int(n: number): number;
}

const TWO_POW_32 = 0x1_0000_0000;

/**
 * Entero uniforme en [0, n) a partir de un generador de uint32, por RECHAZO.
 *
 * Por qué no `x % n`: 2^32 no es múltiplo de n (salvo potencias de 2), así que los
 * primeros `2^32 mod n` restos saldrían una vez más que el resto. Con n = 30 el sesgo es
 * minúsculo, pero es exactamente el tipo de error que un auditor busca. Descartamos los
 * valores de la "cola" incompleta y volvemos a sacar.
 */
export function uniformInt(nextUint32: () => number, n: number): number {
  if (!Number.isInteger(n) || n < 1 || n > TWO_POW_32) throw new RangeError(`n fuera de rango: ${n}`);
  const limit = TWO_POW_32 - (TWO_POW_32 % n);
  for (;;) {
    const x = nextUint32();
    if (x < limit) return x % n;
  }
}

/** Índice elegido con probabilidad proporcional a `weights` (enteros ≥ 0). */
export function weightedIndex(rng: Rng, weights: readonly number[]): number {
  let total = 0;
  for (const w of weights) total += w;
  let r = rng.int(total);
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]!;
    if (r < 0) return i;
  }
  throw new Error('inalcanzable: pesos inconsistentes');
}

export interface SeedTriple {
  /** 32 bytes en hex. Secreta hasta que se rota. */
  serverSeed: string;
  clientSeed: string;
  nonce: number;
}

/**
 * Flujo provably fair:
 *   bloque(i) = HMAC-SHA256(key = serverSeed, msg = `${clientSeed}:${nonce}:${i}`)
 * Cada bloque da 8 uint32 big-endian que se consumen en orden.
 *
 * HMAC (y no SHA-256(serverSeed + clientSeed)) porque es una PRF con la semilla como clave:
 * aunque el jugador elija clientSeed a su antojo, no puede provocar colisiones ni
 * extensiones de longitud que le den control sobre la salida.
 */
export class HmacStream implements Rng {
  private readonly key: Uint8Array;
  private block = 0;
  private words: Uint32Array = new Uint32Array(0);
  private cursor = 0;

  constructor(private readonly seeds: SeedTriple) {
    this.key = hexToBytes(seeds.serverSeed);
    if (this.key.length !== 32) throw new Error('serverSeed debe tener 32 bytes');
    if (!Number.isSafeInteger(seeds.nonce) || seeds.nonce < 0) throw new Error('nonce inválido');
  }

  nextUint32(): number {
    if (this.cursor >= this.words.length) this.refill();
    return this.words[this.cursor++]!;
  }

  int(n: number): number {
    return uniformInt(() => this.nextUint32(), n);
  }

  private refill(): void {
    const msg = utf8ToBytes(`${this.seeds.clientSeed}:${this.seeds.nonce}:${this.block++}`);
    const digest = hmac(sha256, this.key, msg);
    const view = new DataView(digest.buffer, digest.byteOffset, digest.byteLength);
    this.words = new Uint32Array(8);
    for (let i = 0; i < 8; i++) this.words[i] = view.getUint32(i * 4, false);
    this.cursor = 0;
  }
}

/** Compromiso público: SHA-256 de los BYTES de la serverSeed, en hex. */
export function hashServerSeed(serverSeedHex: string): string {
  return bytesToHex(sha256(hexToBytes(serverSeedHex)));
}
