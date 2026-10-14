import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { verifyRound } from '@velvet/game-math';
import type { RoundDto, SpinResponse } from '@velvet/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FairService } from '../src/services/fair.js';
import { GameService } from '../src/services/game.js';
import { csrf, makeApp, registerUser, spinReq } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => (ctx = await makeApp()));
afterAll(async () => ctx.close());

const balanceOf = async (cookie: string) => BigInt((await ctx.app.inject({ url: '/api/me', headers: { cookie } })).json().balance);

describe('POST /api/spin', () => {
  it('cobra la apuesta, paga el premio y deja la ronda en el historial', async () => {
    const u = await registerUser(ctx.app);
    const res = await spinReq(ctx.app, u.cookie, 2000);
    expect(res.statusCode).toBe(200);
    const body = res.json<SpinResponse>();
    expect(BigInt(body.balance)).toBe(1_000_000n - 2000n + BigInt(body.round.payout));
    expect(await balanceOf(u.cookie)).toBe(BigInt(body.balance));
    const hist = (await ctx.app.inject({ url: '/api/rounds', headers: { cookie: u.cookie } })).json<RoundDto[]>();
    expect(hist[0]!.id).toBe(body.round.id);
  });

  it('exige sesión', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/spin', headers: csrf, payload: { betId: randomUUID(), bet: 1000 } });
    expect(res.statusCode).toBe(401);
  });

  it.each([
    ['apuesta fuera de la lista', { bet: 1234 }],
    ['apuesta negativa', { bet: -1000 }],
    ['apuesta decimal', { bet: 1000.5 }],
    ['apuesta como string', { bet: '1000' }],
    ['betId que no es uuid', { betId: 'abc' }],
    ['premio inyectado por el cliente', { payout: 999999 }],
  ])('rechaza: %s', async (_name, patch) => {
    const u = await registerUser(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/spin',
      headers: { ...csrf, cookie: u.cookie },
      payload: { betId: randomUUID(), bet: 1000, ...patch },
    });
    expect(res.statusCode).toBe(400);
    expect(await balanceOf(u.cookie)).toBe(1_000_000n);
  });

  it('no permite apostar más de lo que hay (ni deja rastro)', async () => {
    const poor = await makeApp({ env: { SIGNUP_GRANT: '1500' } });
    const u = await registerUser(poor.app);
    const res = await spinReq(poor.app, u.cookie, 2000);
    const hist = await poor.app.inject({ url: '/api/rounds', headers: { cookie: u.cookie } });
    const me = await poor.app.inject({ url: '/api/me', headers: { cookie: u.cookie } });
    await poor.close();
    expect(res.statusCode).toBe(402);
    expect(hist.json()).toEqual([]);
    expect(me.json().balance).toBe('1500');
  });

  it('la ronda es verificable cuando se revela la semilla', async () => {
    const u = await registerUser(ctx.app);
    const fair0 = (await ctx.app.inject({ url: '/api/fair', headers: { cookie: u.cookie } })).json();
    const spun = (await spinReq(ctx.app, u.cookie, 5000)).json<SpinResponse>();
    expect(spun.round.serverSeedHash).toBe(fair0.serverSeedHash);
    expect(spun.round.serverSeed).toBeNull(); // todavía secreta

    const rot = await ctx.app.inject({ method: 'POST', url: '/api/fair/rotate', headers: { ...csrf, cookie: u.cookie }, payload: { clientSeed: 'mi-semilla' } });
    const { revealed, current } = rot.json();
    expect(revealed.serverSeedHash).toBe(fair0.serverSeedHash);
    expect(current.clientSeed).toBe('mi-semilla');
    expect(current.serverSeedHash).not.toBe(fair0.serverSeedHash);

    const round = (await ctx.app.inject({ url: `/api/rounds/${spun.round.id}`, headers: { cookie: u.cookie } })).json<RoundDto>();
    expect(round.serverSeed).toBe(revealed.serverSeed);
    const v = verifyRound({
      serverSeed: round.serverSeed!,
      serverSeedHash: round.serverSeedHash,
      clientSeed: round.clientSeed,
      nonce: round.nonce,
      bet: Number(round.bet),
      claimed: { outcome: round.outcome, payout: Number(round.payout) },
    });
    expect(v).toMatchObject({ commitmentOk: true, outcomeOk: true, payoutOk: true });
  });

  it('no deja ver rondas de otro jugador (IDOR)', async () => {
    const a = await registerUser(ctx.app);
    const b = await registerUser(ctx.app);
    const spun = (await spinReq(ctx.app, a.cookie)).json<SpinResponse>();
    const res = await ctx.app.inject({ url: `/api/rounds/${spun.round.id}`, headers: { cookie: b.cookie } });
    expect(res.statusCode).toBe(404);
  });
});

describe('idempotencia', () => {
  it('repetir el mismo betId devuelve la misma ronda y NO cobra otra vez', async () => {
    const u = await registerUser(ctx.app);
    const betId = randomUUID();
    const a = (await spinReq(ctx.app, u.cookie, 1000, betId)).json<SpinResponse>();
    const b = (await spinReq(ctx.app, u.cookie, 1000, betId)).json<SpinResponse>();
    expect(b.replayed).toBe(true);
    expect(b.round.id).toBe(a.round.id);
    expect(b.balance).toBe(a.balance);
  });

  it('el mismo betId con otra apuesta es un conflicto', async () => {
    const u = await registerUser(ctx.app);
    const betId = randomUUID();
    await spinReq(ctx.app, u.cookie, 1000, betId);
    const res = await spinReq(ctx.app, u.cookie, 2000, betId);
    expect(res.statusCode).toBe(409);
  });
});

describe('concurrencia (lock por jugador)', () => {
  it('en HTTP, una segunda tirada simultánea se rechaza al instante', async () => {
    const u = await registerUser(ctx.app);
    const codes = (await Promise.all(Array.from({ length: 10 }, () => spinReq(ctx.app, u.cookie)))).map((r) => r.statusCode);
    expect(codes).toContain(200);
    expect(codes.every((c) => c === 200 || c === 429)).toBe(true);
  });

  // Saltamos el guard en memoria y vamos directos al servicio: aquí probamos el lock de Postgres.
  it('30 apuestas simultáneas: nonces únicos y saldo exacto', async () => {
    const u = await registerUser(ctx.app);
    const me = (await ctx.app.inject({ url: '/api/me', headers: { cookie: u.cookie } })).json();
    const game = new GameService(ctx.db, new FairService(Buffer.from(ctx.env.SEED_ENCRYPTION_KEY, 'hex')));
    const results = await Promise.all(Array.from({ length: 30 }, () => game.spin(me.id, { betId: randomUUID(), bet: 1000 })));
    const nonces = results.map((r) => r.round.nonce).sort((a, b) => a - b);
    expect(nonces).toEqual(Array.from({ length: 30 }, (_, i) => i));
    const paid = results.reduce((a, r) => a + BigInt(r.round.payout), 0n);
    expect(await balanceOf(u.cookie)).toBe(1_000_000n - 30_000n + paid);
  });

  it('30 repeticiones simultáneas del MISMO betId: una sola ronda, un solo cobro', async () => {
    const u = await registerUser(ctx.app);
    const me = (await ctx.app.inject({ url: '/api/me', headers: { cookie: u.cookie } })).json();
    const game = new GameService(ctx.db, new FairService(Buffer.from(ctx.env.SEED_ENCRYPTION_KEY, 'hex')));
    const betId = randomUUID();
    const results = await Promise.all(Array.from({ length: 30 }, () => game.spin(me.id, { betId, bet: 1000 })));
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(new Set(results.map((r) => r.round.id)).size).toBe(1);
    const [{ n }] = (await ctx.db.execute(sql`SELECT count(*)::int AS n FROM rounds WHERE bet_id = ${betId}`)) as unknown as [{ n: number }];
    expect(n).toBe(1);
    expect(await balanceOf(u.cookie)).toBe(1_000_000n - 1000n + BigInt(results[0]!.round.payout));
  });
});

describe('invariantes del ledger', () => {
  it('cada transacción suma cero y la cadena de saldos cuadra para todos los jugadores', async () => {
    const unbalanced = await ctx.db.execute(sql`SELECT tx_id FROM ledger_entries GROUP BY tx_id HAVING sum(amount) <> 0`);
    expect(unbalanced).toHaveLength(0);
    const broken = await ctx.db.execute(sql`
      SELECT id FROM (
        SELECT id, balance_after, amount,
               lag(balance_after, 1, 0::bigint) OVER (PARTITION BY account_id ORDER BY id) AS prev
        FROM ledger_entries WHERE balance_after IS NOT NULL
      ) t WHERE balance_after <> prev + amount`);
    expect(broken).toHaveLength(0);
  });
});
