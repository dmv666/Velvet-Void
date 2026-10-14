import { z } from 'zod';

/**
 * Configuración SOLO desde variables de entorno, validada al arrancar. Si falta un secreto
 * el proceso no arranca: mejor fallar ruidosamente que correr con una clave por defecto.
 */
const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('127.0.0.1'),
  CLIENT_ORIGIN: z.url(),
  DATABASE_URL: z.string().startsWith('postgres'),
  SEED_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i, '32 bytes en hex (openssl rand -hex 32)'),
  /** Detrás de un proxy (Fly, Railway) la IP real viene en X-Forwarded-For. Solo activar allí. */
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Créditos de bienvenida, en unidades. */
  SIGNUP_GRANT: z.coerce.bigint().default(1_000_000n),
});

export type Env = z.infer<typeof Env>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = Env.safeParse(source);
  if (!parsed.success) {
    // No imprimimos los valores: podrían ser secretos.
    const fields = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Configuración inválida:\n  ${fields}`);
  }
  return parsed.data;
}
