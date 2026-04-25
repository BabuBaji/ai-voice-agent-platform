import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

/**
 * Encryption-at-rest for sensitive JSON columns (integration credentials, etc.)
 *
 * Format of the stored ciphertext envelope:
 *   { _enc: 1, iv: <base64 12B>, tag: <base64 16B>, data: <base64 ciphertext> }
 *
 * Design notes:
 *  - AES-256-GCM gives us authenticated encryption (tamper-evident) with low overhead.
 *  - Key comes from `INTEGRATION_ENCRYPTION_KEY` env (base64 32 bytes preferred).
 *    If a shorter passphrase is supplied we hash it to 32 bytes — convenient for dev,
 *    but the user should set a proper random key in production.
 *  - We can identify already-encrypted values by the `_enc: 1` marker, which means
 *    legacy plaintext rows continue to work and get encrypted on next write.
 */

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

let cachedKey: Buffer | null = null;

function loadKey(): Buffer | null {
  if (cachedKey) return cachedKey;
  const raw = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!raw) return null;
  // Try base64 first; if it's not 32 bytes after decode, hash whatever we got.
  let buf: Buffer;
  try {
    const decoded = Buffer.from(raw, 'base64');
    buf = decoded.length === 32 ? decoded : createHash('sha256').update(raw).digest();
  } catch {
    buf = createHash('sha256').update(raw).digest();
  }
  cachedKey = buf;
  return buf;
}

/** Returns true when an encryption key is configured. Lets callers no-op cleanly. */
export function encryptionEnabled(): boolean {
  return loadKey() !== null;
}

/** Test if a stored value is already in our envelope format. */
export function isEncryptedEnvelope(value: unknown): boolean {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as any)._enc === 1 &&
    typeof (value as any).iv === 'string' &&
    typeof (value as any).data === 'string'
  );
}

/**
 * Encrypt arbitrary JSON-serialisable data. Returns the original value
 * unchanged when no encryption key is configured (fail-open in dev).
 */
export function encryptJson(plainObj: unknown): unknown {
  const key = loadKey();
  if (!key) return plainObj; // no-op when not configured
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const json = Buffer.from(JSON.stringify(plainObj ?? null), 'utf-8');
  const ct = Buffer.concat([cipher.update(json), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    _enc: 1,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: ct.toString('base64'),
  };
}

/**
 * Decrypt an envelope back to the original JSON object. If the value is
 * not in envelope form (legacy plaintext or null), it's returned as-is.
 */
export function decryptJson(value: unknown): unknown {
  if (!isEncryptedEnvelope(value)) return value;
  const key = loadKey();
  if (!key) {
    // Encrypted in DB but no key here — refuse to return anything sensitive.
    return { error: 'encryption key not configured on server' };
  }
  const env = value as { iv: string; tag: string; data: string };
  try {
    const iv = Buffer.from(env.iv, 'base64');
    const tag = Buffer.from(env.tag, 'base64');
    const ct = Buffer.from(env.data, 'base64');
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return JSON.parse(pt.toString('utf-8'));
  } catch (err: any) {
    return { error: 'decryption failed: ' + (err.message || 'unknown') };
  }
}
