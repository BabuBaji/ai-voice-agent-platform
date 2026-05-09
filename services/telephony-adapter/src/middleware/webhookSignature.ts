import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

/**
 * Twilio signature validation.
 *
 * Twilio computes the signature as:
 *   HMAC-SHA1(authToken, fullUrl + sortedKeyValuePairsConcatenated).base64
 *
 * The full URL must include scheme + host + path + query string (matches what
 * Twilio called). When traffic arrives via ngrok, `req.protocol` reads `http`
 * (the proxy hop), so we honour `X-Forwarded-Proto` / `X-Forwarded-Host` and
 * `PUBLIC_BASE_URL` to reconstruct the URL Twilio actually signed.
 */
export function verifyTwilioSignature(req: Request, res: Response, next: NextFunction): void {
  // Disabled when in dev OR explicitly opted out (lets us replay synthetic
  // webhook calls with curl). Enable in production by setting
  // VERIFY_WEBHOOK_SIGNATURES=true.
  if (process.env.VERIFY_WEBHOOK_SIGNATURES !== 'true') return next();
  const tok = process.env.TWILIO_AUTH_TOKEN;
  if (!tok) return next(); // No token configured — fail open (legacy behaviour).

  const sigHeader = req.header('X-Twilio-Signature');
  if (!sigHeader) {
    res.status(403).json({ error: 'Missing X-Twilio-Signature header' });
    return;
  }

  const url = reconstructUrl(req);
  const params = (req.body || {}) as Record<string, string>;
  const sortedConcat = Object.keys(params)
    .sort()
    .map((k) => `${k}${params[k]}`)
    .join('');
  const expected = crypto
    .createHmac('sha1', tok)
    .update(Buffer.from(url + sortedConcat, 'utf-8'))
    .digest('base64');

  // Constant-time compare
  if (!safeEqual(expected, sigHeader)) {
    res.status(403).json({ error: 'Invalid X-Twilio-Signature' });
    return;
  }
  next();
}

/**
 * Plivo signature V3 validation.
 *
 * Plivo computes:
 *   HMAC-SHA256(authToken, nonce + url + sortedKeyValuePairs).hex
 *
 * Headers:
 *   X-Plivo-Signature-V3:    base64-encoded HMAC
 *   X-Plivo-Signature-V3-Nonce: random nonce echoed back
 *
 * Older Plivo accounts may still send Signature-V1 (HMAC-SHA1, similar to
 * Twilio). We check V3 first, fall back to V1 if V3 header is missing.
 */
export function verifyPlivoSignature(req: Request, res: Response, next: NextFunction): void {
  if (process.env.VERIFY_WEBHOOK_SIGNATURES !== 'true') return next();
  const tok = process.env.PLIVO_AUTH_TOKEN;
  if (!tok) return next();

  const v3 = req.header('X-Plivo-Signature-V3');
  const v3Nonce = req.header('X-Plivo-Signature-V3-Nonce');
  const v1 = req.header('X-Plivo-Signature');

  const url = reconstructUrl(req);
  const params = (req.body || {}) as Record<string, string>;

  if (v3 && v3Nonce) {
    const sortedConcat = Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join('&');
    const expected = crypto
      .createHmac('sha256', tok)
      .update(`${v3Nonce}${url}${sortedConcat}`)
      .digest('base64');
    if (!safeEqual(expected, v3)) {
      res.status(403).json({ error: 'Invalid X-Plivo-Signature-V3' });
      return;
    }
    return next();
  }

  if (v1) {
    // V1: identical algorithm to Twilio (URL + sorted k/v concatenation)
    const sortedConcat = Object.keys(params)
      .sort()
      .map((k) => `${k}${params[k]}`)
      .join('');
    const expected = crypto
      .createHmac('sha1', tok)
      .update(Buffer.from(url + sortedConcat, 'utf-8'))
      .digest('base64');
    if (!safeEqual(expected, v1)) {
      res.status(403).json({ error: 'Invalid X-Plivo-Signature' });
      return;
    }
    return next();
  }

  res.status(403).json({ error: 'Missing X-Plivo-Signature(-V3) header' });
}

function reconstructUrl(req: Request): string {
  // PUBLIC_BASE_URL is the canonical externally-visible base. Webhooks always
  // arrive at <PUBLIC_BASE_URL><path>?<query>.
  const base =
    (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '') ||
    `${req.header('X-Forwarded-Proto') || req.protocol}://${req.header('X-Forwarded-Host') || req.get('host') || 'localhost'}`;
  return base + req.originalUrl;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
