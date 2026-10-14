import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** Token de sesión: 32 bytes del CSPRNG del sistema. Nunca Math.random(). */
export const newToken = (): string => randomBytes(32).toString('base64url');

export const sha256Hex = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

/** Nueva serverSeed: 32 bytes del CSPRNG. */
export const newServerSeed = (): string => randomBytes(32).toString('hex');

/** Semilla de cliente por defecto si el jugador no aporta una. */
export const newClientSeed = (): string => randomBytes(12).toString('base64url');

const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Cifra la serverSeed en reposo con AES-256-GCM. `aad` (el id del usuario) ata el cifrado a
 * su fila: copiar el blob de un usuario a otro hace fallar la autenticación al descifrar.
 */
export function encryptSeed(key: Buffer, seedHex: string, aad: string): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(Buffer.from(seedHex, 'hex')), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

export function decryptSeed(key: Buffer, blob: Buffer, aad: string): string {
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(blob.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('hex');
}
