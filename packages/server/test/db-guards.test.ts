import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_URL, OWNER_URL, makeApp, registerUser, spinReq } from './helpers.js';

/**
 * Atacamos la BD directamente con la credencial de la app (como haría alguien que la robara)
 * y con la del dueño (como un script manual descuidado).
 */
let ctx: Awaited<ReturnType<typeof makeApp>>;
const app = postgres(APP_URL, { max: 2, onnotice: () => {} });
const owner = postgres(OWNER_URL, { max: 2, onnotice: () => {} });
let roundId: string;
let playerAccount: string;

beforeAll(async () => {
  ctx = await makeApp();
  const u = await registerUser(ctx.app);
  roundId = (await spinReq(ctx.app, u.cookie)).json().round.id;
  const [acc] = await app`SELECT account_id FROM ledger_entries e JOIN ledger_tx t ON t.id = e.tx_id WHERE t.round_id = ${roundId} AND e.balance_after IS NOT NULL LIMIT 1`;
  playerAccount = acc!.account_id;
});
afterAll(async () => {
  await ctx.close();
  await app.end();
  await owner.end();
});

describe('append-only', () => {
  it('la app no tiene permiso para UPDATE/DELETE en rounds', async () => {
    await expect(app`UPDATE rounds SET payout = 999999 WHERE id = ${roundId}`).rejects.toThrow(/permission denied/);
    await expect(app`DELETE FROM rounds WHERE id = ${roundId}`).rejects.toThrow(/permission denied/);
  });

  it('ni siquiera el dueño puede modificar o vaciar el ledger (trigger)', async () => {
    await expect(owner`UPDATE ledger_entries SET amount = amount * 2`).rejects.toThrow(/append-only/);
    await expect(owner`DELETE FROM rounds`).rejects.toThrow(/append-only/);
    await expect(owner`TRUNCATE ledger_entries CASCADE`).rejects.toThrow(/append-only/);
  });
});

describe('ledger', () => {
  it('una transacción descuadrada falla al hacer COMMIT', async () => {
    await expect(
      app.begin(async (tx) => {
        const [t] = await tx`INSERT INTO ledger_tx (kind) VALUES ('daily_bonus') RETURNING id`;
        const [last] = await tx`SELECT balance_after FROM ledger_entries WHERE account_id = ${playerAccount} ORDER BY id DESC LIMIT 1`;
        // Dinero de la nada: una sola pata.
        await tx`INSERT INTO ledger_entries (tx_id, account_id, amount, balance_after)
                 VALUES (${t!.id}, ${playerAccount}, 1000000, ${(BigInt(last!.balance_after) + 1000000n).toString()})`;
      }),
    ).rejects.toThrow(/descuadrada/);
  });

  it('un balance_after inventado rompe la cadena', async () => {
    await expect(
      app.begin(async (tx) => {
        const [t] = await tx`INSERT INTO ledger_tx (kind) VALUES ('daily_bonus') RETURNING id`;
        await tx`INSERT INTO ledger_entries (tx_id, account_id, amount, balance_after) VALUES (${t!.id}, ${playerAccount}, 1, 999999999)`;
      }),
    ).rejects.toThrow(/cadena de saldo rota/);
  });

  it('el saldo de un jugador nunca puede quedar negativo', async () => {
    await expect(
      app.begin(async (tx) => {
        const [t] = await tx`INSERT INTO ledger_tx (kind) VALUES ('bet') RETURNING id`;
        const [last] = await tx`SELECT balance_after FROM ledger_entries WHERE account_id = ${playerAccount} ORDER BY id DESC LIMIT 1`;
        const all = BigInt(last!.balance_after) + 1n;
        await tx`INSERT INTO ledger_entries (tx_id, account_id, amount, balance_after) VALUES (${t!.id}, ${playerAccount}, ${(-all).toString()}, -1)`;
      }),
    ).rejects.toThrow(/saldo insuficiente/);
  });
});

describe('seed_pairs', () => {
  it('no se puede revelar una semilla que no corresponde al hash', async () => {
    await expect(app`UPDATE seed_pairs SET status = 'revealed', server_seed = ${'00'.repeat(32)} WHERE status = 'active'`).rejects.toThrow(
      /no corresponde al compromiso/,
    );
  });

  it('el nonce no puede retroceder ni saltar', async () => {
    await expect(app`UPDATE seed_pairs SET next_nonce = 0 WHERE next_nonce > 1`).rejects.toThrow(/uno en uno/);
    await expect(app`UPDATE seed_pairs SET next_nonce = next_nonce + 5`).rejects.toThrow(/uno en uno/);
  });

  it('dos rondas no pueden compartir nonce', async () => {
    const [r] = await app`SELECT * FROM rounds WHERE id = ${roundId}`;
    await expect(
      app`INSERT INTO rounds (user_id, bet_id, seed_pair_id, nonce, client_seed, server_seed_hash, bet, payout, outcome, math_version)
          VALUES (${r!.user_id}, ${randomUUID()}, ${r!.seed_pair_id}, ${r!.nonce}, 'x', 'x', 1000, 0, '{}', 'x')`,
    ).rejects.toThrow(/rounds_seed_nonce_uq/);
  });
});
