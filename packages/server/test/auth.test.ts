import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { csrf, makeApp, registerUser, uniqueName } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => (ctx = await makeApp()));
afterAll(async () => ctx.close());

describe('registro y sesión', () => {
  it('crea la sesión en una cookie httpOnly + SameSite=Strict y regala el saldo inicial', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: csrf,
      payload: { username: uniqueName(), password: 'contraseña-larga-123' },
    });
    expect(res.statusCode).toBe(201);
    const c = res.cookies.find((k) => k.name === 'vv_session')!;
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe('Strict');
    const me = await ctx.app.inject({ url: '/api/me', headers: { cookie: `vv_session=${c.value}` } });
    expect(me.json()).toMatchObject({ balance: '1000000' });
  });

  it('el nombre es único sin distinguir mayúsculas', async () => {
    const name = uniqueName();
    await registerUser(ctx.app, name);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: csrf,
      payload: { username: name.toUpperCase(), password: 'contraseña-larga-123' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('login correcto e incorrecto (mismo mensaje si el usuario no existe)', async () => {
    const u = await registerUser(ctx.app);
    const ok = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', headers: csrf, payload: { username: u.username, password: u.password } });
    expect(ok.statusCode).toBe(200);
    const bad = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', headers: csrf, payload: { username: u.username, password: 'otra-contraseña-xx' } });
    const ghost = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', headers: csrf, payload: { username: uniqueName(), password: 'otra-contraseña-xx' } });
    expect(bad.statusCode).toBe(401);
    expect(ghost.statusCode).toBe(401);
    expect(bad.json()).toEqual(ghost.json());
  });

  it('logout invalida la sesión en el servidor (no basta con borrar la cookie)', async () => {
    const u = await registerUser(ctx.app);
    await ctx.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { ...csrf, cookie: u.cookie } });
    const me = await ctx.app.inject({ url: '/api/me', headers: { cookie: u.cookie } });
    expect(me.statusCode).toBe(401);
  });

  it('una cookie inventada no da acceso', async () => {
    const me = await ctx.app.inject({ url: '/api/me', headers: { cookie: 'vv_session=inventada' } });
    expect(me.statusCode).toBe(401);
  });
});

describe('CSRF y validación', () => {
  it('rechaza POST sin la cabecera anti-CSRF', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'abc', password: 'x'.repeat(12) } });
    expect(res.statusCode).toBe(403);
  });

  it('rechaza POST desde otro origen', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { ...csrf, origin: 'https://evil.example' },
      payload: { username: 'abc', password: 'x'.repeat(12) },
    });
    expect(res.statusCode).toBe(403);
  });

  it('CORS no refleja orígenes ajenos', async () => {
    const res = await ctx.app.inject({
      method: 'OPTIONS',
      url: '/api/spin',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('esquemas estrictos: un campo extra es un error', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: csrf,
      payload: { username: uniqueName(), password: 'contraseña-larga-123', isAdmin: true },
    });
    expect(res.statusCode).toBe(400);
  });

  it('cuerpos enormes se cortan antes de procesarse', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { ...csrf, 'content-type': 'application/json' },
      payload: JSON.stringify({ username: 'a', password: 'x'.repeat(10_000) }),
    });
    expect(res.statusCode).toBe(413);
  });

  it('las cabeceras de seguridad están presentes', async () => {
    const res = await ctx.app.inject({ url: '/api/health' });
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('rate limiting', () => {
  it('limita los intentos de login por IP', async () => {
    const strict = await makeApp({ limits: { auth: { capacity: 3, refillPerSec: 0.001 } } });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await strict.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: csrf,
        payload: { username: uniqueName(), password: 'x'.repeat(12) },
      });
      codes.push(r.statusCode);
    }
    await strict.close();
    expect(codes).toEqual([401, 401, 401, 429, 429]);
  });
});
