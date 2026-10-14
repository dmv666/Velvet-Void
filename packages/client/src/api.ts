import {
  CSRF_HEADER,
  CSRF_VALUE,
  type Credentials,
  type ErrorCode,
  type ErrorResponse,
  type FairStateDto,
  type RotateResponse,
  type RoundDto,
  type SpinRequest,
  type SpinResponse,
  type UserDto,
} from '@velvet/shared';
import type { publicMathConfig } from '@velvet/game-math';

const BASE = import.meta.env.VITE_API_BASE ?? '';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK',
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      credentials: 'include', // la cookie httpOnly viaja sola: JS nunca la ve
      headers: method === 'POST' ? { 'content-type': 'application/json', [CSRF_HEADER]: CSRF_VALUE } : {},
      body: body === undefined ? null : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'sin conexión con el servidor');
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as ErrorResponse | null;
    throw new ApiError(res.status, err?.error ?? 'INTERNAL', err?.message ?? res.statusText);
  }
  return (await res.json()) as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const api = {
  me: () => request<UserDto>('GET', '/me'),
  register: (c: Credentials) => request<{ ok: true }>('POST', '/auth/register', c),
  login: (c: Credentials) => request<{ ok: true }>('POST', '/auth/login', c),
  logout: () => request<{ ok: true }>('POST', '/auth/logout', {}),
  fair: () => request<FairStateDto>('GET', '/fair'),
  rotate: (clientSeed?: string) => request<RotateResponse>('POST', '/fair/rotate', clientSeed ? { clientSeed } : {}),
  rounds: (limit = 30) => request<RoundDto[]>('GET', `/rounds?limit=${limit}`),
  round: (id: string) => request<RoundDto>('GET', `/rounds/${id}`),
  math: () => request<ReturnType<typeof publicMathConfig> & { report: Record<string, unknown> }>('GET', '/math'),

  /**
   * Apuesta con reintentos SEGUROS: si la red falla no sabemos si el servidor llegó a procesarla,
   * así que reintentamos con el MISMO betId. El servidor la cobra como mucho una vez.
   */
  async spin(req: SpinRequest): Promise<SpinResponse> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await request<SpinResponse>('POST', '/spin', req);
      } catch (e) {
        const retryable = e instanceof ApiError && (e.code === 'NETWORK' || (e.status === 429 && attempt === 0));
        if (!retryable || attempt >= 3) throw e;
        await sleep(300 * 2 ** attempt);
      }
    }
  },
};
