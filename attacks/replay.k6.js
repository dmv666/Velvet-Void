// Ataque de REPETICIÓN: 50 VUs disparan a la vez la MISMA apuesta (mismo betId).
//   k6 run attacks/replay.k6.js
// Esperado: una sola ronda y un solo cobro; el resto, repeticiones (replayed) o 429.
import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';

const API = __ENV.API || 'http://127.0.0.1:3000';
const ORIGIN = __ENV.ORIGIN || 'http://localhost:5173';
const H = { 'content-type': 'application/json', 'x-velvet-void': '1', origin: ORIGIN };

export const options = {
  scenarios: { replay: { executor: 'per-vu-iterations', vus: 50, iterations: 4, maxDuration: '60s' } },
  thresholds: { checks: ['rate==1'] },
};

export function setup() {
  const username = `k6r_${Date.now()}`;
  const res = http.post(`${API}/api/auth/register`, JSON.stringify({ username, password: 'contraseña-k6-replay' }), { headers: H });
  const cookie = res.headers['Set-Cookie'].split(';')[0];
  const me = http.get(`${API}/api/me`, { headers: { cookie } }).json();
  return { cookie, start: me.balance, betId: '7e57da7a-0000-4000-8000-' + String(Date.now()).padStart(12, '0').slice(-12) };
}

export default function (d) {
  const res = http.post(`${API}/api/spin`, JSON.stringify({ betId: d.betId, bet: 1000 }), { headers: { ...H, cookie: d.cookie } });
  check(res, { 'solo 200 o 429': (r) => r.status === 200 || r.status === 429 });
  if (exec.vu.idInTest === 1 && exec.vu.iterationInScenario === 0) console.log(`primer estado: ${res.status}`);
}

export function teardown(d) {
  sleep(5); // el rate limit por IP también nos frena a nosotros: esperamos a que se rellene el cubo
  const rounds = http.get(`${API}/api/rounds?limit=100`, { headers: { cookie: d.cookie } }).json();
  const me = http.get(`${API}/api/me`, { headers: { cookie: d.cookie } }).json();
  const expected = BigInt(d.start) - 1000n + BigInt(rounds[0] ? rounds[0].payout : '0');
  console.log(`rondas creadas: ${rounds.length} · saldo: ${d.start} → ${me.balance} (esperado ${expected})`);
  check(null, {
    'exactamente 1 ronda': () => rounds.length === 1,
    'un solo cobro': () => BigInt(me.balance) === expected,
  });
}
