import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { ZodError, type z } from 'zod';
import { publicMathConfig } from '@velvet/game-math';
import {
  CSRF_HEADER,
  CSRF_VALUE,
  Credentials,
  RotateRequest,
  RoundsQuery,
  SpinRequest,
  type ErrorResponse,
  type UserDto,
} from '@velvet/shared';
import type { Db } from './db/client.js';
import type { Env } from './env.js';
import { HttpError, badRequest, forbidden, unauthorized } from './lib/errors.js';
import { RateLimiter } from './lib/rate-limit.js';
import { AuthService, SESSION_TTL_MS } from './services/auth.js';
import { FairService, toFairDto } from './services/fair.js';
import { GameService } from './services/game.js';
import { getBalance, lockPlayerAccount, playerAccountId } from './services/ledger.js';
import mathReport from '@velvet/game-math/math-report.json' with { type: 'json' };

declare module 'fastify' {
  interface FastifyRequest {
    user: { id: string; username: string } | null;
  }
}

export interface AppDeps {
  env: Env;
  db: Db;
  /** Límites inyectables para que los tests puedan ajustarlos. */
  limits?: Partial<Record<'ip' | 'auth' | 'spin', { capacity: number; refillPerSec: number }>>;
}

const parse = <S extends z.ZodType>(schema: S, data: unknown): z.infer<S> => schema.parse(data);

export async function buildApp({ env, db, limits }: AppDeps) {
  const prod = env.NODE_ENV === 'production';
  const app = Fastify({
    logger: env.NODE_ENV === 'test' ? false : { level: prod ? 'info' : 'debug' },
    trustProxy: env.TRUST_PROXY,
    bodyLimit: 4 * 1024, // ninguna petición legítima se acerca a 4 KB
  });

  const fair = new FairService(Buffer.from(env.SEED_ENCRYPTION_KEY, 'hex'));
  const auth = new AuthService(db, fair, env.SIGNUP_GRANT);
  const game = new GameService(db, fair);

  // Prefijo __Host-: el navegador exige Secure, Path=/ y sin Domain → no se puede fijar desde un subdominio.
  const COOKIE = prod ? '__Host-vv_session' : 'vv_session';
  const cookieOpts = { httpOnly: true, secure: prod, sameSite: 'strict', path: '/' } as const;

  const ipLimiter = new RateLimiter(limits?.ip ?? { capacity: 60, refillPerSec: 20 });
  const authLimiter = new RateLimiter(limits?.auth ?? { capacity: 10, refillPerSec: 1 / 6 });
  const spinLimiter = new RateLimiter(limits?.spin ?? { capacity: 10, refillPerSec: 5 });
  const sweeper = setInterval(() => [ipLimiter, authLimiter, spinLimiter].forEach((l) => l.sweep()), 60_000);
  sweeper.unref();
  app.addHook('onClose', async () => clearInterval(sweeper));

  /** Una sola tirada en vuelo por jugador en este proceso. El lock de Postgres es la garantía real. */
  const inFlight = new Set<string>();

  await app.register(helmet, {
    // La API solo devuelve JSON: nada debería cargarse ni enmarcarse desde aquí.
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    hsts: prod ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });
  await app.register(cors, {
    origin: [env.CLIENT_ORIGIN], // lista blanca de UN origen, nunca reflejar el Origin recibido
    credentials: true,
    methods: ['GET', 'POST'],
    allowedHeaders: ['content-type', CSRF_HEADER],
    maxAge: 600,
  });
  await app.register(cookie);

  const reject = (reply: FastifyReply, status: number, body: ErrorResponse) => reply.code(status).send(body);
  const limited = (reply: FastifyReply, wait: number) => {
    reply.header('retry-after', String(wait));
    return reject(reply, 429, { error: 'RATE_LIMITED', message: 'demasiadas peticiones' });
  };

  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req, reply) => {
    const wait = ipLimiter.take(req.ip);
    if (wait) return limited(reply, wait);

    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      // CSRF, dos capas: (1) cabecera propia — un formulario de otro sitio no puede ponerla y un
      // fetch cross-origin la convierte en preflight que CORS rechaza; (2) si hay Origin, debe ser el nuestro.
      if (req.headers[CSRF_HEADER] !== CSRF_VALUE) throw forbidden('falta la cabecera anti-CSRF');
      const origin = req.headers.origin;
      if (origin !== undefined && origin !== env.CLIENT_ORIGIN) throw forbidden('origen no permitido');
    }

    const token = req.cookies[COOKIE];
    if (token) req.user = await auth.userForToken(token);
  });

  const requireUser = (req: FastifyRequest) => {
    if (!req.user) throw unauthorized();
    return req.user;
  };

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      const message = err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
      return reject(reply, 400, { error: 'BAD_REQUEST', message });
    }
    if (err instanceof HttpError) return reject(reply, err.status, { error: err.code, message: err.message });
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      // Errores de Fastify (JSON malformado, cuerpo demasiado grande, content-type…)
      return reject(reply, e.statusCode, { error: 'BAD_REQUEST', message: e.message ?? 'petición inválida' });
    }
    req.log.error({ err }, 'error no controlado');
    // Nunca filtramos detalles internos (SQL, stack) al cliente.
    return reject(reply, 500, { error: 'INTERNAL', message: 'error interno' });
  });

  // ---- Rutas -------------------------------------------------------------------------------
  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/math', async (_req, reply) => {
    reply.header('cache-control', 'public, max-age=300');
    return { ...publicMathConfig(), report: mathReport };
  });

  const setSession = (reply: FastifyReply, token: string) =>
    reply.setCookie(COOKIE, token, { ...cookieOpts, maxAge: SESSION_TTL_MS / 1000 });

  const authLimit = async (req: FastifyRequest, reply: FastifyReply) => {
    const wait = authLimiter.take(req.ip);
    if (wait) return limited(reply, wait);
  };

  app.post('/api/auth/register', { preHandler: authLimit }, async (req, reply) => {
    const { token } = await auth.register(parse(Credentials, req.body));
    setSession(reply, token);
    return reply.code(201).send({ ok: true });
  });

  app.post('/api/auth/login', { preHandler: authLimit }, async (req, reply) => {
    // Límite también por nombre de usuario: frena el ataque a UNA cuenta desde muchas IPs.
    const body = parse(Credentials, req.body);
    const wait = authLimiter.take(`user:${body.username.toLowerCase()}`);
    if (wait) return limited(reply, wait);
    const { token } = await auth.login(body);
    setSession(reply, token);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[COOKIE];
    if (token) await auth.logout(token);
    reply.clearCookie(COOKIE, cookieOpts);
    return { ok: true };
  });

  app.get('/api/me', async (req): Promise<UserDto> => {
    const user = requireUser(req);
    // Lectura sin lock: el último balance_after confirmado es un valor consistente.
    const balance = await getBalance(db, await playerAccountId(db, user.id));
    return { id: user.id, username: user.username, balance: balance.toString() };
  });

  app.get('/api/fair', async (req) => {
    const user = requireUser(req);
    return db.transaction(async (tx) => {
      await lockPlayerAccount(tx, user.id);
      return toFairDto(await fair.active(tx, user.id));
    });
  });

  app.post('/api/fair/rotate', async (req) => {
    const user = requireUser(req);
    const body = parse(RotateRequest, req.body ?? {});
    return db.transaction(async (tx) => {
      // Mismo lock que las apuestas: no puede colarse una tirada a mitad de la rotación.
      await lockPlayerAccount(tx, user.id);
      return fair.rotate(tx, user.id, body.clientSeed);
    });
  });

  app.post('/api/spin', async (req, reply) => {
    const user = requireUser(req);
    const wait = spinLimiter.take(user.id);
    if (wait) return limited(reply, wait);
    const body = parse(SpinRequest, req.body);
    if (inFlight.has(user.id)) {
      return reject(reply, 429, { error: 'RATE_LIMITED', message: 'ya hay una tirada en curso' });
    }
    inFlight.add(user.id);
    try {
      return await game.spin(user.id, body);
    } finally {
      inFlight.delete(user.id);
    }
  });

  app.get('/api/rounds', async (req) => {
    const user = requireUser(req);
    const q = parse(RoundsQuery, req.query);
    return game.listRounds(user.id, q.limit, q.before);
  });

  app.get('/api/rounds/:id', async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw badRequest('id inválido');
    return game.getRound(user.id, id);
  });

  return app;
}
