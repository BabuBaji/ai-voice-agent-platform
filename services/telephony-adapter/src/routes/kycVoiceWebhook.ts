// Plivo answer-URL webhook for voice-call OTP delivery.
//
// When the wizard places an outbound call to read the OTP aloud, Plivo
// requests this endpoint as the answer_url. We respond with Plivo XML
// (<Speak>) that TTSs the digits with pauses between each so they're
// easy to write down. The plaintext OTP is stored briefly in
// kyc_sessions.{mobile,aadhaar}_otp_plain and cleared after the speak
// completes — the hashed copy in *_otp_hash is what verifies it.

import { Router, Request, Response } from 'express';
import pino from 'pino';
import { pool } from '../index';

const logger = pino();
export const kycVoiceWebhookRouter = Router();

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' } as any)[c],
  );
}

// Plivo accepts both GET and POST for answer_url; send GET to keep things
// idempotent for retries.
async function handleCall(req: Request, res: Response) {
  const sessionId = req.params.sessionId;
  const channel = (req.query.channel as string) === 'aadhaar' ? 'aadhaar' : 'mobile';
  const column = channel === 'aadhaar' ? 'aadhaar_otp_plain' : 'mobile_otp_plain';

  let otp = '';
  try {
    const r = await pool.query(
      `SELECT ${column} AS otp FROM kyc_sessions WHERE id = $1`,
      [sessionId],
    );
    otp = String(r.rows[0]?.otp || '');
  } catch (err: any) {
    logger.error({ sessionId, channel, err: err.message }, 'kyc-otp-call: db lookup failed');
  }

  res.setHeader('Content-Type', 'application/xml');

  if (!/^\d{4,8}$/.test(otp)) {
    // No OTP found / already consumed — still respond with valid XML so
    // Plivo doesn't retry indefinitely.
    logger.warn({ sessionId, channel }, 'kyc-otp-call: no OTP available, sending fallback message');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak voice="Polly.Aditi" language="en-IN">Hello. Your verification code has expired or is no longer valid. Please request a new code in the application. Goodbye.</Speak>
</Response>`);
    return;
  }

  // Format the OTP for clear TTS — space the digits and use a comma as a
  // micro-pause: "1, 2, 3, 4, 5, 6". Read it twice for clarity.
  const spaced = otp.split('').join(', ');
  const purpose = channel === 'aadhaar' ? 'Aadhaar verification' : 'phone verification';

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Wait length="1"/>
  <Speak voice="Polly.Aditi" language="en-IN">Hello. This is the AI Voice Agent platform calling with your ${escapeXml(purpose)} code.</Speak>
  <Wait length="1"/>
  <Speak voice="Polly.Aditi" language="en-IN">Your verification code is ${escapeXml(spaced)}.</Speak>
  <Wait length="1"/>
  <Speak voice="Polly.Aditi" language="en-IN">Once again, your code is ${escapeXml(spaced)}.</Speak>
  <Wait length="1"/>
  <Speak voice="Polly.Aditi" language="en-IN">Thank you. Goodbye.</Speak>
</Response>`;

  // Best-effort wipe of the plaintext after we serve it once. Keep the hash
  // in place for verification.
  try {
    await pool.query(`UPDATE kyc_sessions SET ${column} = NULL WHERE id = $1`, [sessionId]);
  } catch { /* not fatal */ }

  logger.info({ sessionId, channel, length: otp.length }, 'kyc-otp-call: served OTP XML');
  res.send(xml);
}

kycVoiceWebhookRouter.get('/kyc-otp-call/:sessionId', handleCall);
kycVoiceWebhookRouter.post('/kyc-otp-call/:sessionId', handleCall);
