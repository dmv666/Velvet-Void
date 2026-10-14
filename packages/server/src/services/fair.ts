import { and, count, eq } from 'drizzle-orm';
import { hashServerSeed } from '@velvet/game-math';
import type { FairStateDto, RotateResponse } from '@velvet/shared';
import type { Tx } from '../db/client.js';
import { rounds, seedPairs } from '../db/schema.js';
import { decryptSeed, encryptSeed, newClientSeed, newServerSeed } from '../lib/crypto.js';

export type SeedPair = typeof seedPairs.$inferSelect;

export class FairService {
  constructor(private readonly key: Buffer) {}

  async create(tx: Tx, userId: string, clientSeed = newClientSeed()): Promise<SeedPair> {
    const serverSeed = newServerSeed();
    const [row] = await tx
      .insert(seedPairs)
      .values({
        id: crypto.randomUUID(),
        userId,
        serverSeedEnc: encryptSeed(this.key, serverSeed, userId),
        serverSeedHash: hashServerSeed(serverSeed),
        clientSeed,
      })
      .returning();
    return row!;
  }

  /** Par activo del usuario. Llamar con la cuenta del jugador bloqueada. */
  async active(tx: Tx, userId: string): Promise<SeedPair> {
    const [row] = await tx
      .select()
      .from(seedPairs)
      .where(and(eq(seedPairs.userId, userId), eq(seedPairs.status, 'active')));
    return row ?? this.create(tx, userId);
  }

  serverSeedOf(pair: SeedPair): string {
    return decryptSeed(this.key, pair.serverSeedEnc, pair.userId);
  }

  /** Reserva el siguiente nonce. El WHERE con el nonce esperado es una segunda red de seguridad. */
  async takeNonce(tx: Tx, pair: SeedPair): Promise<number> {
    const updated = await tx
      .update(seedPairs)
      .set({ nextNonce: pair.nextNonce + 1 })
      .where(and(eq(seedPairs.id, pair.id), eq(seedPairs.nextNonce, pair.nextNonce)))
      .returning({ id: seedPairs.id });
    if (updated.length !== 1) throw new Error('carrera en el nonce: la cuenta debía estar bloqueada');
    return pair.nextNonce;
  }

  /** Revela la serverSeed actual y abre un par nuevo (con la clientSeed nueva o la misma). */
  async rotate(tx: Tx, userId: string, clientSeed?: string): Promise<RotateResponse> {
    const old = await this.active(tx, userId);
    const serverSeed = this.serverSeedOf(old);
    await tx
      .update(seedPairs)
      .set({ status: 'revealed', serverSeed, revealedAt: new Date() })
      .where(eq(seedPairs.id, old.id));
    const next = await this.create(tx, userId, clientSeed ?? old.clientSeed);
    const [played] = await tx.select({ n: count() }).from(rounds).where(eq(rounds.seedPairId, old.id));
    return {
      revealed: {
        seedPairId: old.id,
        serverSeed,
        serverSeedHash: old.serverSeedHash,
        clientSeed: old.clientSeed,
        rounds: played?.n ?? 0,
      },
      current: toFairDto(next),
    };
  }
}

export function toFairDto(pair: SeedPair): FairStateDto {
  return {
    seedPairId: pair.id,
    serverSeedHash: pair.serverSeedHash,
    clientSeed: pair.clientSeed,
    nextNonce: pair.nextNonce,
  };
}
