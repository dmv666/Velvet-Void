import { randomUUID } from 'node:crypto';
import { CSRF_HEADER, CSRF_VALUE } from '@velvet/shared';
import { buildApp, type AppDeps } from '../src/app.js';
import { createDb } from '../src/db/client.js';
import { loadEnv } from '../src/env.js';

export const APP_URL = process.env.TEST_DATABASE_URL ?? 'postgres://velvet_app:app_dev_only@127.0.0.1:5432/velvet_void_test';
export const OWNER_URL = process.env.TEST_MIGRATION_DATABASE_URL ?? 'postgres://velvet_owner:owner_dev_only@127.0.0.1:5432/velvet_void_test';
export const ORIGIN = 'http://localhost:5173';

export function testEnv(overrides: Record<string, string> = {}) {
  return loadEnv({
    NODE_ENV: 'test',
    CLIENT_ORIGIN: ORIGIN,
    DATABASE_URL: APP_URL,
    SEED_ENCRYPTION_KEY: '11'.repeat(32),
    ...overrides,
  });
}

export async function makeApp(opts: { env?: Record<string, string>; limits?: AppDeps['limits'] } = {}) {
  const env = testEnv(opts.env);
  const { db, sql } = createDb(env.DATABASE_URL, { max: 20 });
  const generous = { capacity: 10_000, refillPerSec: 10_000 };
  const app = await buildApp({ env, db, limits: { ip: generous, auth: generous, spin: generous, ...opts.limits } });
  return { app, db, sql, env, close: async () => (await app.close(), await sql.end()) };
}

export const csrf = { [CSRF_HEADER]: CSRF_VALUE, origin: ORIGIN };

export const uniqueName = () => `u_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

type App = Awaited<ReturnType<typeof makeApp>>['app'];

/** Registra un usuario y devuelve la cookie de sesión lista para usar. */
export async function registerUser(app: App, username = uniqueName(), password = 'contraseña-larga-123') {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', headers: csrf, payload: { username, password } });
  if (res.statusCode !== 201) throw new Error(`registro falló: ${res.statusCode} ${res.body}`);
  const c = res.cookies.find((k) => k.name === 'vv_session')!;
  return { username, password, cookie: `${c.name}=${c.value}` };
}

export async function spinReq(app: App, cookie: string, bet = 1000, betId: string = randomUUID()) {
  return app.inject({ method: 'POST', url: '/api/spin', headers: { ...csrf, cookie }, payload: { betId, bet } });
}
