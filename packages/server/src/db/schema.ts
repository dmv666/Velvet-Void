import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { SpinOutcome } from '@velvet/game-math';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
// Dinero: bigint en unidades mínimas, leído como BigInt de JS (nunca number).
const money = (name: string) => bigint(name, { mode: 'bigint' });

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('users_username_lower_uq').on(sql`lower(${t.username})`)],
);

export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 del token. El token en claro solo vive en la cookie del navegador. */
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const ACCOUNT_KINDS = ['player', 'house', 'grants'] as const;
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id),
    kind: text('kind', { enum: ACCOUNT_KINDS }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    // NULLS NOT DISTINCT: solo puede haber UNA cuenta 'house' con user_id NULL.
    unique('accounts_user_kind_uq').on(t.userId, t.kind).nullsNotDistinct(),
    check('accounts_kind_owner_ck', sql`(${t.kind} = 'player') = (${t.userId} IS NOT NULL)`),
  ],
);

export const LEDGER_KINDS = ['signup_grant', 'bet', 'payout', 'daily_bonus'] as const;
export const ledgerTx = pgTable('ledger_tx', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind', { enum: LEDGER_KINDS }).notNull(),
  roundId: uuid('round_id').references(() => rounds.id),
  createdAt: createdAt(),
});

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    txId: uuid('tx_id')
      .notNull()
      .references(() => ledgerTx.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    amount: money('amount').notNull(),
    /**
     * Saldo de la cuenta tras este movimiento. Solo para cuentas de jugador (las de sistema
     * serían un cuello de botella: todas las apuestas tendrían que bloquear la misma fila).
     * Un trigger exige que balance_after = anterior + amount y que no sea negativo.
     */
    balanceAfter: money('balance_after'),
    createdAt: createdAt(),
  },
  (t) => [
    index('ledger_entries_account_idx').on(t.accountId, t.id.desc()),
    index('ledger_entries_tx_idx').on(t.txId),
    check('ledger_entries_amount_nonzero_ck', sql`${t.amount} <> 0`),
  ],
);

export const SEED_STATUS = ['active', 'revealed'] as const;
export const seedPairs = pgTable(
  'seed_pairs',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** AES-256-GCM(iv ‖ tag ‖ ciphertext), con user_id como datos asociados. */
    serverSeedEnc: bytea('server_seed_enc').notNull(),
    serverSeedHash: text('server_seed_hash').notNull(),
    /** Solo se rellena al revelar. */
    serverSeed: text('server_seed'),
    clientSeed: text('client_seed').notNull(),
    nextNonce: integer('next_nonce').notNull().default(0),
    status: text('status', { enum: SEED_STATUS }).notNull().default('active'),
    createdAt: createdAt(),
    revealedAt: timestamp('revealed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('seed_pairs_one_active_uq').on(t.userId).where(sql`${t.status} = 'active'`),
    check('seed_pairs_reveal_ck', sql`(${t.status} = 'revealed') = (${t.serverSeed} IS NOT NULL)`),
  ],
);

export const rounds = pgTable(
  'rounds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    betId: uuid('bet_id').notNull(),
    seedPairId: uuid('seed_pair_id')
      .notNull()
      .references(() => seedPairs.id),
    nonce: integer('nonce').notNull(),
    clientSeed: text('client_seed').notNull(),
    serverSeedHash: text('server_seed_hash').notNull(),
    bet: money('bet').notNull(),
    payout: money('payout').notNull(),
    outcome: jsonb('outcome').$type<SpinOutcome>().notNull(),
    mathVersion: text('math_version').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    // Idempotencia: el mismo betId del mismo jugador nunca produce dos rondas (ni dos cobros).
    unique('rounds_user_bet_uq').on(t.userId, t.betId),
    // Un nonce no se reutiliza jamás dentro de un par de semillas.
    unique('rounds_seed_nonce_uq').on(t.seedPairId, t.nonce),
    index('rounds_user_created_idx').on(t.userId, t.createdAt.desc(), t.id.desc()),
    check('rounds_amounts_ck', sql`${t.bet} > 0 AND ${t.payout} >= 0`),
  ],
);
