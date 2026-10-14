// Ataques de "cliente manipulado": todo lo que alguien puede hacer con DevTools o curl.
//   node attacks/client-tampering.mjs   (con el servidor en marcha)
import { randomUUID } from 'node:crypto';
import { API, CSRF, balance, call, newPlayer, record, summary } from './lib.mjs';

const victim = await newPlayer();
const attacker = await newPlayer();
const start = await balance(attacker.cookie);
const spin = (patch, opts = {}) =>
  call('POST', '/api/spin', { cookie: attacker.cookie, body: { betId: randomUUID(), bet: 1000, ...patch }, ...opts });

// 1. Decidir el premio desde el cliente
let r = await spin({ payout: 999_999_999, outcome: { totalMultiplier: 3000 } });
record('Enviar payout/outcome propios en /spin', '400, el servidor no lee esos campos', `${r.status} ${r.json.message ?? ''}`, r.status === 400);

// 2. Apuestas fuera de rango o con tipos raros
for (const [label, bet] of [['negativa', -1000], ['cero', 0], ['decimal', 1000.5], ['string', '1000'], ['enorme', 1e30], ['no listada', 1234], ['NaN (null en JSON)', NaN]]) {
  r = await spin({ bet });
  record(`Apuesta ${label}`, '400', String(r.status), r.status === 400);
}

// 3. Contaminación de prototipo y JSON malformado
r = await call('POST', '/api/spin', { cookie: attacker.cookie, raw: `{"betId":"${randomUUID()}","bet":1000,"__proto__":{"isAdmin":true}}` });
record('__proto__ en el cuerpo', '400 (esquema estricto)', String(r.status), r.status === 400);
r = await call('POST', '/api/spin', { cookie: attacker.cookie, raw: '{"betId":' });
record('JSON truncado', '400 sin filtrar detalles', `${r.status} ${JSON.stringify(r.json)}`, r.status === 400 && !/at |stack/i.test(JSON.stringify(r.json)));
r = await call('POST', '/api/spin', { cookie: attacker.cookie, raw: JSON.stringify({ betId: randomUUID(), bet: 1000, pad: 'x'.repeat(50_000) }) });
record('Cuerpo de 50 KB', '413 antes de parsear', String(r.status), r.status === 413);

// 4. CSRF
r = await call('POST', '/api/spin', { cookie: attacker.cookie, body: { betId: randomUUID(), bet: 1000 }, headers: { 'x-velvet-void': '' } });
record('POST sin cabecera anti-CSRF', '403', String(r.status), r.status === 403);
r = await call('POST', '/api/spin', { cookie: attacker.cookie, body: { betId: randomUUID(), bet: 1000 }, headers: { origin: 'https://evil.example' } });
record('POST desde otro Origin', '403', String(r.status), r.status === 403);
const pre = await fetch(API + '/api/spin', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'x-velvet-void,content-type' } });
record('Preflight CORS desde otro origen', 'sin Access-Control-Allow-Origin', String(pre.headers.get('access-control-allow-origin')), !pre.headers.get('access-control-allow-origin'));

// 5. Sesiones
r = await call('GET', '/api/me', { cookie: 'vv_session=' + 'A'.repeat(43) });
record('Cookie de sesión inventada', '401', String(r.status), r.status === 401);
r = await call('GET', '/api/me');
record('Sin cookie', '401', String(r.status), r.status === 401);

// 6. IDOR: leer rondas ajenas
const vr = await call('POST', '/api/spin', { cookie: victim.cookie, body: { betId: randomUUID(), bet: 1000 } });
r = await call('GET', `/api/rounds/${vr.json.round.id}`, { cookie: attacker.cookie });
record('Leer la ronda de otro jugador por id', '404', String(r.status), r.status === 404);

// 7. Rotación: forzar una semilla del servidor o un nonce
r = await call('POST', '/api/fair/rotate', { cookie: attacker.cookie, body: { clientSeed: 'mia', serverSeed: '00'.repeat(32), nonce: 0 } });
record('Elegir serverSeed/nonce al rotar', '400 (solo se acepta clientSeed)', String(r.status), r.status === 400);

// 8. Inyección SQL en el nombre de usuario y en el login
r = await call('POST', '/api/auth/login', { body: { username: "admin' OR '1'='1", password: 'x'.repeat(12) } });
record("Inyección SQL en login", '400 (formato) — y aunque pasara, consultas parametrizadas', String(r.status), r.status === 400);

// 9. Fuerza bruta de login (límite por IP + por usuario)
const codes = [];
for (let i = 0; i < 14; i++) codes.push((await call('POST', '/api/auth/login', { body: { username: victim.username, password: `intento-${i}-xxxx` } })).status);
record('14 intentos de contraseña seguidos', 'los primeros 401, después 429', codes.join(','), codes.includes(429) && codes.indexOf(429) <= 11);

// Ninguno de los ataques movió dinero
const end = await balance(attacker.cookie);
record('Saldo del atacante tras todos los ataques', `${start} (intacto)`, String(end), end === start);
summary();
