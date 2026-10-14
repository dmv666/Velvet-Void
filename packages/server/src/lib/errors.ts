import type { ErrorCode } from '@velvet/shared';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string) => new HttpError(400, 'BAD_REQUEST', msg);
export const unauthorized = (msg = 'sesión requerida') => new HttpError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg: string) => new HttpError(403, 'FORBIDDEN', msg);
export const notFound = (msg = 'no encontrado') => new HttpError(404, 'NOT_FOUND', msg);
export const conflict = (msg: string) => new HttpError(409, 'CONFLICT', msg);
export const insufficientFunds = () => new HttpError(402, 'INSUFFICIENT_FUNDS', 'saldo insuficiente');

/**
 * Campo de un error de Postgres. Drizzle envuelve el error del driver en `cause`, así que
 * recorremos la cadena: comparar solo el error exterior hace que un 23505 acabe en un 500.
 */
function pgField(err: unknown, field: 'code' | 'constraint_name'): string | undefined {
  for (let e = err, depth = 0; typeof e === 'object' && e !== null && depth < 5; depth++) {
    if (field in e) return String((e as Record<string, unknown>)[field]);
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}
export const pgCode = (err: unknown) => pgField(err, 'code');
export const pgConstraint = (err: unknown) => pgField(err, 'constraint_name');
