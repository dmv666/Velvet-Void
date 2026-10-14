/**
 * Rate limiting EN MEMORIA con token bucket.
 *
 * Limitación conocida (ver SECURITY.md): el estado vive en este proceso. Con N instancias el
 * límite efectivo es N veces mayor y un reinicio lo pone a cero. Para escalar habría que
 * moverlo a un almacén compartido (Redis, o una tabla en Postgres).
 */
export interface BucketOptions {
  /** Capacidad: ráfaga máxima. */
  capacity: number;
  /** Fichas repuestas por segundo. */
  refillPerSec: number;
}

interface Bucket {
  tokens: number;
  updated: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly opts: BucketOptions,
    private readonly now: () => number = Date.now,
    /** Tope de claves para que un atacante con muchas IPs no agote la memoria. */
    private readonly maxKeys = 100_000,
  ) {}

  /** Devuelve 0 si se permite, o los segundos que hay que esperar. */
  take(key: string, cost = 1): number {
    const t = this.now();
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size >= this.maxKeys) this.sweep(t, true);
      b = { tokens: this.opts.capacity, updated: t };
      this.buckets.set(key, b);
    }
    const elapsed = (t - b.updated) / 1000;
    b.tokens = Math.min(this.opts.capacity, b.tokens + elapsed * this.opts.refillPerSec);
    b.updated = t;
    if (b.tokens >= cost) {
      b.tokens -= cost;
      return 0;
    }
    return Math.ceil((cost - b.tokens) / this.opts.refillPerSec);
  }

  /** Elimina cubos llenos (inactivos). Con `force`, si sigue lleno, descarta los más antiguos. */
  sweep(t = this.now(), force = false): void {
    for (const [k, b] of this.buckets) {
      const full = b.tokens + ((t - b.updated) / 1000) * this.opts.refillPerSec >= this.opts.capacity;
      if (full) this.buckets.delete(k);
    }
    if (force && this.buckets.size >= this.maxKeys) {
      const drop = Math.ceil(this.maxKeys / 10);
      let i = 0;
      for (const k of this.buckets.keys()) {
        if (i++ >= drop) break;
        this.buckets.delete(k);
      }
    }
  }

  get size(): number {
    return this.buckets.size;
  }
}
