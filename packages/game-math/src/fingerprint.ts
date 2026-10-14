import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { publicMathConfig } from './config.js';
import { canonicalJson } from './verify.js';

/**
 * Huella de la configuración matemática. El informe de RTP exacto guarda la huella con la que
 * se calculó: si alguien toca una tira o un pago sin regenerar el informe, un test lo detecta.
 */
export function mathFingerprint(): string {
  return bytesToHex(sha256(utf8ToBytes(canonicalJson(publicMathConfig()))));
}
