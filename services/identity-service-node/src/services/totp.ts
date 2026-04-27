import crypto from 'crypto';

// Self-contained TOTP (RFC 6238) implementation. Avoids pulling in speakeasy/
// otplib for one feature. Uses HMAC-SHA1 + 30-second windows + 6-digit codes,
// matching what Google Authenticator / Authy / 1Password expect.

const PERIOD = 30;
const DIGITS = 6;
const WINDOW = 1; // accept codes ±1 step (clock-drift tolerance)
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; // RFC 4648 base32

export function generateBase32Secret(bytes = 20): string {
  const buf = crypto.randomBytes(bytes);
  let bits = '';
  for (const byte of buf) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  return out;
}

function base32Decode(str: string): Buffer {
  const clean = str.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = '';
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function totpCode(secret: string, step: number): string {
  const key = base32Decode(secret);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac('sha1', key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const slice = hmac.slice(offset, offset + 4);
  const num = (slice.readUInt32BE(0) & 0x7fffffff) % 10 ** DIGITS;
  return num.toString().padStart(DIGITS, '0');
}

export function verifyTotp(secret: string, token: string): boolean {
  const t = String(token || '').padStart(DIGITS, '0');
  const step = Math.floor(Date.now() / 1000 / PERIOD);
  for (let w = -WINDOW; w <= WINDOW; w++) {
    if (totpCode(secret, step + w) === t) return true;
  }
  return false;
}

export function otpauthUrl(secret: string, label: string, issuer = 'VoiceAgent Platform'): string {
  const enc = encodeURIComponent;
  return `otpauth://totp/${enc(issuer)}:${enc(label)}?secret=${secret}&issuer=${enc(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD}`;
}
