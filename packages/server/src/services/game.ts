import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { payoutFor, playRound } from '@velvet/game-math';
import type { RoundDto, SpinRequest, SpinResponse } from '@velvet/shared';
import type { Db, Tx } from '../db/client.js';
import { rounds, seedPairs } from '../db/schema.js';
import { conflict, insufficientFunds, notFound, pgConstraint } from '../lib/errors.js';
import { FairService } from './fair.js';
import { getBalance, lockPlayerAccount, systemAccount, transfer } from './ledger.js';

type RoundRow = typeof rounds.$inferSelect;

export function toRoundDto(r: RoundRow, revealedSeed: string | null): RoundDto {
  return {
    id: r.id,
    betId: r.betId,
    bet: r.bet.toString(),
    payout: r.payout.toString(),
    seedPairId: r.seedPairId,
    nonce: r.nonce,
    clientSeed: r.clientSeed,
    serverSeedHash: r.serverSeedHash,
    serverSeed: revealedSeed,
    mathVersion: r.mathVersion,
    outcome: r.outcome,
    createdAt: r.createdAt.toISOString(),
  };
}

export class GameService {
  constructor(
    private readonly db: Db,
    private readonly fair: FairService,
  ) {}

  /**
   * Una apuesta, de principio a fin, en UNA transacción:
   *   lock → ¿betId repetido? → saldo → nonce → resultado → ronda → ledger → COMMIT
   * Si algo falla, no queda nada a medias: ni cobro sin ronda ni ronda sin cobro.
   */
  async spin(userId: string, req: SpinRequest): Promise<SpinResponse> {
    try {
      return await this.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
        const player = await lockPlayerAccount(tx, userId);

        const replay = await this.findByBetId(tx, userId, req.betId);
        if (replay) return this.replayResponse(tx, replay, req, player.accountId);

        const bet = BigInt(req.bet);
        const balance = await getBalance(tx, player.accountId);
        if (balance < bet) throw insufficientFunds();

        const pair = await this.fair.active(tx, userId);
        const nonce = await this.fair.takeNonce(tx, pair);
        const outcome = playRound({ serverSeed: this.fair.serverSeedOf(pair), clientSeed: pair.clientSeed, nonce });
        const payout = BigInt(payoutFor(outcome, req.bet));

        const [round] = await tx
          .insert(rounds)
          .values({
            userId,
            betId: req.betId,
            seedPairId: pair.id,
            nonce,
            clientSeed: pair.clientSeed,
            serverSeedHash: pair.serverSeedHash,
            bet,
            payout,
            outcome,
            mathVersion: outcome.mathVersion,
          })
          .returning();

        const house = await systemAccount(tx, 'house');
        await transfer(tx, { kind: 'bet', from: player, to: house, amount: bet, roundId: round!.id });
        if (payout > 0n) {
          await transfer(tx, { kind: 'payout', from: house, to: player, amount: payout, roundId: round!.id });
        }
        return { round: toRoundDto(round!, null), balance: (balance - bet + payout).toString(), replayed: false };
      });
    } catch (err) {
      // Red de seguridad: si aun así dos inserciones chocan en la UNIQUE, la segunda ve la primera.
      if (pgConstraint(err) === 'rounds_user_bet_uq') {
        return this.db.transaction(async (tx) => {
          const player = await lockPlayerAccount(tx, userId);
          const existing = await this.findByBetId(tx, userId, req.betId);
          if (!existing) throw err;
          return this.replayResponse(tx, existing, req, player.accountId);
        });
      }
      throw err;
    }
  }

  private async findByBetId(tx: Tx, userId: string, betId: string): Promise<RoundRow | undefined> {
    const [row] = await tx
      .select()
      .from(rounds)
      .where(and(eq(rounds.userId, userId), eq(rounds.betId, betId)));
    return row;
  }

  /** Repetición idempotente: misma respuesta, sin cobrar. Distintos parámetros = conflicto. */
  private async replayResponse(tx: Tx, row: RoundRow, req: SpinRequest, accountId: string): Promise<SpinResponse> {
    if (row.bet !== BigInt(req.bet)) throw conflict('betId ya usado con otra apuesta');
    const balance = await getBalance(tx, accountId);
    return { round: toRoundDto(row, await this.revealedSeed(tx, row.seedPairId)), balance: balance.toString(), replayed: true };
  }

  private async revealedSeed(tx: Tx | Db, seedPairId: string): Promise<string | null> {
    const [p] = await tx.select({ s: seedPairs.serverSeed }).from(seedPairs).where(eq(seedPairs.id, seedPairId));
    return p?.s ?? null;
  }

  async listRounds(userId: string, limit: number, before?: string): Promise<RoundDto[]> {
    let cursor: { createdAt: Date; id: string } | undefined;
    if (before) {
      const [c] = await this.db
        .select({ createdAt: rounds.createdAt, id: rounds.id })
        .from(rounds)
        .where(and(eq(rounds.id, before), eq(rounds.userId, userId)));
      if (!c) throw notFound('cursor inválido');
      cursor = c;
    }
    const rows = await this.db
      .select({ round: rounds, serverSeed: seedPairs.serverSeed })
      .from(rounds)
      .innerJoin(seedPairs, eq(seedPairs.id, rounds.seedPairId))
      .where(
        and(
          eq(rounds.userId, userId),
          cursor
            ? or(lt(rounds.createdAt, cursor.createdAt), and(eq(rounds.createdAt, cursor.createdAt), lt(rounds.id, cursor.id)))
            : undefined,
        ),
      )
      .orderBy(desc(rounds.createdAt), desc(rounds.id))
      .limit(limit);
    return rows.map((r) => toRoundDto(r.round, r.serverSeed));
  }

  async getRound(userId: string, id: string): Promise<RoundDto> {
    const [r] = await this.db
      .select({ round: rounds, serverSeed: seedPairs.serverSeed })
      .from(rounds)
      .innerJoin(seedPairs, eq(seedPairs.id, rounds.seedPairId))
      // Filtrar por user_id evita IDOR: conocer el id de una ronda ajena no basta para verla.
      .where(and(eq(rounds.id, id), eq(rounds.userId, userId)));
    if (!r) throw notFound('ronda no encontrada');
    return toRoundDto(r.round, r.serverSeed);
  }
}
