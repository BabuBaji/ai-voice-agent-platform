/**
 * AES-256-GCM encryption for tenant credentials at rest. Uses the same
 * INTEGRATION_ENCRYPTION_KEY env that identity-service uses for OAuth tokens,
 * so credential rotation is platform-wide (rotate the env key + re-encrypt).
 *
 * Storage format (jsonb in tenant_whatsapp_integrations.encrypted_credentials):
 *   { iv: <12-byte base64>, tag: <16-byte base64>, ct: <ciphertext base64> }
 *
 * Plaintext is always a JSON object — callers serialize then we encrypt the
 * UTF-8 bytes. Decrypt returns the parsed object. Any malformed payload
 * throws — calling code MUST catch and treat as "credentials unreadable".
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';

function loadKey(): Buffer {
  const raw = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('INTEGRATION_ENCRYPTION_KEY not set — refusing to encrypt/decrypt credentials');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(`INTEGRATION_ENCRYPTION_KEY must decode to 32 bytes (got ${key.length})`);
  }
  return key;
}

export interface EncryptedBlob {
  iv: string;
  tag: string;
  ct: string;
}

export function encryptJSON(obj: Record<string, any>): EncryptedBlob {
  const key = loadKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(obj), 'utf8');
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv: iv.toString('base64'), tag: tag.toString('base64'), ct: ct.toString('base64') };
}

export function decryptJSON(blob: EncryptedBlob): Record<string, any> {
  const key = loadKey();
  const iv = Buffer.from(blob.iv, 'base64');
  const tag = Buffer.from(blob.tag, 'base64');
  const ct = Buffer.from(blob.ct, 'base64');
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  return JSON.parse(plaintext);
}

/** Mask a sensitive string for display: show first 6 + last 4, hide middle. */
export function mask(s: string | null | undefined): string {
  if (!s) return '';
  const t = String(s);
  if (t.length <= 12) return '••••••';
  return `${t.slice(0, 6)}…${t.slice(-4)}`;
}
