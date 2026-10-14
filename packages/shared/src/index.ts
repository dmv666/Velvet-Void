import { BET_LEVELS, type SpinOutcome } from '@velvet/game-math';
import { z } from 'zod';

/**
 * Contrato único cliente↔servidor. El servidor VALIDA con estos esquemas; el cliente los usa
 * para tipar respuestas. Todo esquema es `strict`: un campo de más es un error, no se ignora,
 * así nadie puede colar `{ bet: 100, payout: 999999 }` y esperar que algo lo lea.
 *
 * Dinero en JSON como string de dígitos: el servidor trabaja con bigint y JSON no tiene
 * enteros de precisión arbitraria.
 */

export const Username = z
  .string()
  .min(3)
  .max(24)
  .regex(/^[a-zA-Z0-9_]+$/, 'solo letras, números y _');

// Longitud mínima en vez de reglas de composición (NIST SP 800-63B); máximo para acotar el coste de argon2.
export const Password = z.string().min(10).max(128);

export const Credentials = z.strictObject({ username: Username, password: Password });
export type Credentials = z.infer<typeof Credentials>;

export const Bet = z
  .number()
  .int()
  .refine((b) => BET_LEVELS.includes(b), { message: 'apuesta no permitida' });

export const SpinRequest = z.strictObject({
  /** Generado por el cliente por cada intento de apuesta. Repetirlo NUNCA cobra dos veces. */
  betId: z.uuid(),
  bet: Bet,
});
export type SpinRequest = z.infer<typeof SpinRequest>;

export const ClientSeed = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[\x21-\x7e]+$/, 'ASCII imprimible sin espacios');

export const RotateRequest = z.strictObject({ clientSeed: ClientSeed.optional() });
export type RotateRequest = z.infer<typeof RotateRequest>;

export const RoundsQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  /** Paginación por cursor (created_at, id) codificado: estable aunque entren rondas nuevas. */
  before: z.uuid().optional(),
});

export const Money = z.string().regex(/^-?\d+$/);

export interface UserDto {
  id: string;
  username: string;
  balance: string;
}

export interface FairStateDto {
  seedPairId: string;
  serverSeedHash: string;
  clientSeed: string;
  nextNonce: number;
}

export interface RoundDto {
  id: string;
  betId: string;
  bet: string;
  payout: string;
  seedPairId: string;
  nonce: number;
  clientSeed: string;
  serverSeedHash: string;
  /** Solo presente cuando el par de semillas ya se reveló. */
  serverSeed: string | null;
  mathVersion: string;
  outcome: SpinOutcome;
  createdAt: string;
}

export interface SpinResponse {
  round: RoundDto;
  balance: string;
  /** true si es la repetición de un betId ya procesado (no se cobró de nuevo). */
  replayed: boolean;
}

export interface RotateResponse {
  revealed: { seedPairId: string; serverSeed: string; serverSeedHash: string; clientSeed: string; rounds: number };
  current: FairStateDto;
}

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INSUFFICIENT_FUNDS'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export interface ErrorResponse {
  error: ErrorCode;
  message: string;
}

/** Cabecera anti-CSRF obligatoria en peticiones que cambian estado. */
export const CSRF_HEADER = 'x-velvet-void';
export const CSRF_VALUE = '1';
