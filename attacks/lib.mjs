// Utilidades compartidas por los scripts de ataque (Node 22, sin dependencias).
export const API = process.env.API ?? 'http://127.0.0.1:3000';
export const ORIGIN = process.env.ORIGIN ?? 'http://localhost:5173';
export const CSRF = { 'x-velvet-void': '1', origin: ORIGIN, 'content-type': 'application/json' };

export async function call(method, path, { body, cookie, headers = {}, raw } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(method === 'POST' ? CSRF : {}), ...(cookie ? { cookie } : {}), ...headers },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json, headers: res.headers };
}

export async function newPlayer() {
  const username = `atk_${Math.random().toString(36).slice(2, 12)}`;
  const r = await call('POST', '/api/auth/register', { body: { username, password: 'contraseña-de-ataque-1' } });
  if (r.status !== 201) throw new Error(`registro: ${r.status} ${JSON.stringify(r.json)}`);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  return { username, cookie };
}

export const balance = async (cookie) => BigInt((await call('GET', '/api/me', { cookie })).json.balance);

export async function allRounds(cookie) {
  const out = [];
  let before;
  for (;;) {
    const r = await call('GET', `/api/rounds?limit=100${before ? `&before=${before}` : ''}`, { cookie });
    out.push(...r.json);
    if (r.json.length < 100) return out;
    before = r.json.at(-1).id;
  }
}

/** Registro de resultados: cada ataque imprime una fila de la tabla del informe. */
export const results = [];
export function record(attack, expected, observed, pass) {
  results.push({ attack, expected, observed, pass });
  console.log(`${pass ? '✅' : '❌'} ${attack}\n     esperado: ${expected}\n     observado: ${observed}`);
}
export function summary() {
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} defensas aguantaron.`);
  if (failed) process.exitCode = 1;
}
