// Ataque de CARRERA (doble gasto): 40 VUs apuestan a la vez con betIds distintos sobre
// UNA cuenta. Intenta que dos apuestas lean el mismo saldo y gasten de más.
//   k6 run attacks/race.k6.js
import http from 'k6/http';
import { check, sleep } from 'k6';

const API = __ENV.API || 'http://127.0.0.1:3000';
const ORIGIN = __ENV.ORIGIN || 'http://localhost:5173';
const H = { 'content-type': 'application/json', 'x-velvet-void': '1', origin: ORIGIN };

export const options = {
  scenarios: { race: { executor: 'constant-vus', vus: 40, duration: '15s' } },
  thresholds: { checks: ['rate==1'] },
};

export function setup() {
  const res = http.post(`${API}/api/auth/register`, JSON.stringify({ username: `k6c_${Date.now()}`, password: 'contraseña-k6-race' }), { headers: H });
  const cookie = res.headers['Set-Cookie'].split(';')[0];
  return { cookie, start: http.get(`${API}/api/me`, { headers: { cookie } }).json().balance };
}

export default function (d) {
  const betId = `${crypto.randomUUID()}`;
  const res = http.post(`${API}/api/spin`, JSON.stringify({ betId, bet: 50000 }), { headers: { ...H, cookie: d.cookie } });
  check(res, { 'solo 200, 402 o 429': (r) => [200, 402, 429].includes(r.status) });
}

export function teardown(d) {
  sleep(5); // el rate limit por IP también nos frena a nosotros: esperamos a que se rellene el cubo
  let rounds = [];
  let before = '';
  for (;;) {
    const page = http.get(`${API}/api/rounds?limit=100${before}`, { headers: { cookie: d.cookie } }).json();
    rounds = rounds.concat(page);
    if (page.length < 100) break;
    before = `&before=${page[page.length - 1].id}`;
  }
  const me = http.get(`${API}/api/me`, { headers: { cookie: d.cookie } }).json();
  const spent = rounds.reduce((a, r) => a + BigInt(r.bet), 0n);
  const won = rounds.reduce((a, r) => a + BigInt(r.payout), 0n);
  const expected = BigInt(d.start) - spent + won;
  const nonces = rounds.map((r) => r.nonce).sort((a, b) => a - b);
  console.log(`rondas: ${rounds.length} · apostado ${spent} · ganado ${won} · saldo ${d.start} → ${me.balance} (esperado ${expected})`);
  check(null, {
    'saldo = inicial − apostado + ganado': () => BigInt(me.balance) === expected,
    'saldo nunca negativo': () => BigInt(me.balance) >= 0n,
    'nonces 0..n-1 sin huecos ni duplicados': () => nonces.every((n, i) => n === i),
  });
}
