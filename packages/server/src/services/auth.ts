import { hash, verify, type Algorithm } from '@node-rs/argon2';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { Credentials } from '@velvet/shared';
import type { Db } from '../db/client.js';
import { accounts, sessions, users } from '../db/schema.js';
import { newToken, sha256Hex } from '../lib/crypto.js';
import { conflict, pgConstraint, unauthorized } from '../lib/errors.js';
import { FairService } from './fair.js';
import { lockPlayerAccount, systemAccount, transfer } from './ledger.js';

/** Parámetros mínimos recomendados por OWASP para argon2id (19 MiB, 2 pasadas, 1 hilo). */
// Algorithm es un const enum ambiental (incompatible con verbatimModuleSyntax): 2 = Argon2id.
const ARGON = { algorithm: 2 as Algorithm.Argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class AuthService {
  /** Hash ficticio para igualar tiempos cuando el usuario no existe (evita enumerar usuarios). */
  private dummyHash: Promise<string> = hash('velvet-void-dummy-password', ARGON);

  constructor(
    private readonly db: Db,
    private readonly fair: FairService,
    private readonly signupGrant: bigint,
  ) {}

  async register({ username, password }: Credentials): Promise<{ token: string; userId: string }> {
    const passwordHash = await hash(password, ARGON);
    try {
      return await this.db.transaction(async (tx) => {
        const [user] = await tx.insert(users).values({ username, passwordHash }).returning({ id: users.id });
        await tx.insert(accounts).values({ userId: user!.id, kind: 'player' });
        const player = await lockPlayerAccount(tx, user!.id);
        await transfer(tx, { kind: 'signup_grant', from: await systemAccount(tx, 'grants'), to: player, amount: this.signupGrant });
        await this.fair.create(tx, user!.id);
        const token = await this.createSession(tx, user!.id);
        return { token, userId: user!.id };
      });
    } catch (err) {
      if (pgConstraint(err) === 'users_username_lower_uq') throw conflict('ese nombre no está disponible');
      throw err;
    }
  }

  async login({ username, password }: Credentials): Promise<{ token: string; userId: string }> {
    const [user] = await this.db
      .select({ id: users.id, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(sql`lower(${users.username})`, username.toLowerCase()));
    // Siempre verificamos un hash, exista o no el usuario: el tiempo de respuesta no lo delata.
    const ok = await verify(user?.passwordHash ?? (await this.dummyHash), password);
    if (!user || !ok) throw unauthorized('usuario o contraseña incorrectos');
    return { token: await this.createSession(this.db, user.id), userId: user.id };
  }

  private async createSession(db: Pick<Db, 'insert'>, userId: string): Promise<string> {
    const token = newToken();
    await db.insert(sessions).values({ id: sha256Hex(token), userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) });
    return token;
  }

  async userForToken(token: string): Promise<{ id: string; username: string } | null> {
    const [row] = await this.db
      .select({ id: users.id, username: users.username })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.id, sha256Hex(token)), gt(sessions.expiresAt, new Date())));
    return row ?? null;
  }

  async logout(token: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.id, sha256Hex(token)));
  }
}
