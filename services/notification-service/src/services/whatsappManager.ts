import path from 'path';
import fs from 'fs';
import QRCode from 'qrcode';
import pino from 'pino';

const logger = pino({
  transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

/**
 * Per-tenant WhatsApp Web session manager, powered by @whiskeysockets/baileys.
 *
 * Flow:
 *   1. `start(tenantId)` launches a baileys socket in the background. Auth
 *      credentials persist under `./data/wa-sessions/<tenantId>/` so a
 *      restart keeps the connection alive.
 *   2. While the socket waits for a QR, we stash the latest QR (as a data:URL
 *      PNG) on the session — the frontend polls `status()` to get it.
 *   3. When the user scans the QR, baileys emits `connection: "open"` and we
 *      mark the session `connected`. The frontend sees this via the same
 *      poll and closes the modal.
 *
 * baileys is required lazily so the rest of the service can boot even when
 * WhatsApp deps aren't installed (dev convenience).
 */

type SessionStatus = 'idle' | 'qr' | 'scanned' | 'connected' | 'expired' | 'error';

interface Session {
  tenantId: string;
  status: SessionStatus;
  qrDataUrl: string | null;
  qrExpiresAt: number | null;
  phoneNumber: string | null;
  error: string | null;
  sock: any | null;
  createdAt: number;
}

const SESSIONS = new Map<string, Session>();
const SESSION_ROOT = path.resolve(process.cwd(), 'data', 'wa-sessions');
const QR_TTL_MS = 60_000; // WhatsApp shows a new QR every 60s anyway

function ensureSessionDir(tenantId: string): string {
  const dir = path.join(SESSION_ROOT, tenantId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Start a new (or resume an existing) WhatsApp session for a tenant. */
export async function startSession(tenantId: string): Promise<Session> {
  const existing = SESSIONS.get(tenantId);
  if (existing && existing.status === 'connected') return existing;
  if (existing && existing.sock) {
    // Session is mid-auth — just return the current snapshot
    return existing;
  }

  const sess: Session = {
    tenantId,
    status: 'idle',
    qrDataUrl: null,
    qrExpiresAt: null,
    phoneNumber: null,
    error: null,
    sock: null,
    createdAt: Date.now(),
  };
  SESSIONS.set(tenantId, sess);

  try {
    const baileys = require('@whiskeysockets/baileys');
    const makeWASocket = baileys.default || baileys.makeWASocket;
    const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = baileys;

    // WhatsApp Web's protocol moves fast; pinning a stale version here is
    // the #1 cause of "Connection Failure" right after start. Use baileys'
    // helper to fetch whatever version their CI last confirmed works.
    let version: [number, number, number] | undefined;
    try {
      const v = await fetchLatestBaileysVersion();
      version = v.version;
      logger.info({ version }, 'using baileys-reported whatsapp version');
    } catch {
      // Fallback to a recent known-good pin if the version fetch fails
      version = [2, 3000, 1017531287];
    }

    const { state, saveCreds } = await useMultiFileAuthState(ensureSessionDir(tenantId));
    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: ['VoiceAgent Platform', 'Chrome', '120.0'],
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
    });
    sess.sock = sock;

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', async (update: any) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        // baileys hands us the raw QR string — render to a PNG data URL the
        // frontend can stick straight into an <img src>.
        try {
          sess.qrDataUrl = await QRCode.toDataURL(qr, { width: 320, margin: 1 });
          sess.status = 'qr';
          sess.qrExpiresAt = Date.now() + QR_TTL_MS;
          logger.info({ tenantId }, 'whatsapp QR issued');
        } catch (err: any) {
          sess.status = 'error';
          sess.error = `QR render failed: ${err.message}`;
        }
      }
      if (connection === 'open') {
        sess.status = 'connected';
        sess.qrDataUrl = null;
        sess.phoneNumber = sock.user?.id?.split(':')?.[0] || null;
        logger.info({ tenantId, phone: sess.phoneNumber }, 'whatsapp connected');
      }
      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason?.loggedOut;
        if (loggedOut) {
          sess.status = 'expired';
          sess.sock = null;
          // wipe creds so a future start() issues a fresh QR
          try { fs.rmSync(ensureSessionDir(tenantId), { recursive: true, force: true }); } catch {}
          logger.info({ tenantId }, 'whatsapp logged out');
        } else if (sess.status !== 'connected') {
          sess.status = 'error';
          sess.error = `Connection closed: ${lastDisconnect?.error?.message || statusCode || 'unknown'}`;
          sess.sock = null;
        }
      }
    });
  } catch (err: any) {
    sess.status = 'error';
    sess.error = err.message || 'Failed to start WhatsApp session';
    logger.error({ tenantId, err: err.message }, 'whatsapp start failed');
  }

  return sess;
}

/** Current snapshot for polling. */
export function statusOf(tenantId: string): Pick<Session, 'status' | 'qrDataUrl' | 'qrExpiresAt' | 'phoneNumber' | 'error'> {
  const s = SESSIONS.get(tenantId);
  if (!s) return { status: 'idle', qrDataUrl: null, qrExpiresAt: null, phoneNumber: null, error: null };
  // Expire stale QR so the UI prompts for a fresh one
  if (s.status === 'qr' && s.qrExpiresAt && Date.now() > s.qrExpiresAt) {
    s.status = 'expired';
    s.qrDataUrl = null;
  }
  return { status: s.status, qrDataUrl: s.qrDataUrl, qrExpiresAt: s.qrExpiresAt, phoneNumber: s.phoneNumber, error: s.error };
}

export async function logout(tenantId: string): Promise<void> {
  const s = SESSIONS.get(tenantId);
  if (!s) return;
  try { await s.sock?.logout(); } catch { /* ignore */ }
  s.sock = null;
  s.status = 'idle';
  s.qrDataUrl = null;
  try { fs.rmSync(ensureSessionDir(tenantId), { recursive: true, force: true }); } catch {}
}
