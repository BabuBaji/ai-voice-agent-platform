import { pool } from '../index';
import pino from 'pino';

const logger = pino({ name: 'stale-sweeper' });

const STALE_AFTER_MIN = Number(process.env.STALE_CONV_THRESHOLD_MIN || 60);
const TICK_MS = Number(process.env.STALE_SWEEP_INTERVAL_MS || 30 * 60 * 1000); // 30 min

/**
 * Mark conversations that have been stuck on `ACTIVE` for too long as `FAILED`
 * so they don't pollute the call log. A row is "stuck" if its started_at is
 * older than STALE_CONV_THRESHOLD_MIN minutes (default 60) AND it has no
 * messages newer than that threshold (so we don't kill an actually-active
 * long call).
 *
 * Runs once on boot and then every STALE_SWEEP_INTERVAL_MS (default 30 min).
 */
export async function sweepStaleConversations(): Promise<number> {
  try {
    const res = await pool.query(
      `UPDATE conversations
       SET status = 'FAILED',
           ended_at = COALESCE(ended_at, now()),
           outcome = COALESCE(outcome, 'no-answer')
       WHERE status = 'ACTIVE'
         AND started_at < now() - ($1 || ' minutes')::interval
         AND NOT EXISTS (
           SELECT 1 FROM messages m
           WHERE m.conversation_id = conversations.id
             AND m.created_at > now() - ($1 || ' minutes')::interval
         )
       RETURNING id`,
      [String(STALE_AFTER_MIN)],
    );
    if (res.rowCount && res.rowCount > 0) {
      logger.info({ swept: res.rowCount, threshold_min: STALE_AFTER_MIN }, 'Stale conversations swept → FAILED');
    }
    return res.rowCount || 0;
  } catch (err) {
    logger.warn({ err }, 'Stale sweeper tick failed');
    return 0;
  }
}

export function startStaleSweeper(): void {
  if (process.env.STALE_SWEEPER === 'off') {
    logger.info('Stale sweeper disabled via STALE_SWEEPER=off');
    return;
  }
  // Run once shortly after boot (so the orphan we know about gets cleaned),
  // then every TICK_MS.
  setTimeout(sweepStaleConversations, 15_000).unref();
  setInterval(sweepStaleConversations, TICK_MS).unref();
  logger.info({ intervalMs: TICK_MS, threshold_min: STALE_AFTER_MIN }, 'Stale sweeper started');
}
