import type { Pool } from 'pg';

export interface RouteDecision {
  /** allow → continue with normal call flow */
  /** reject → hangup with given message */
  /** ivr → speak IVR greeting + menu (caller-driven sub-routing handled at handler level later) */
  /** failover → swap agent_id to the failover agent */
  action: 'allow' | 'reject' | 'ivr' | 'failover';
  reason?: string;
  message?: string;
  failover_agent_id?: string | null;
  ivr?: any;
}

export async function decideInboundRoute(
  pool: Pool,
  opts: { tenantId: string; numberId: string; callerNumber?: string | null },
): Promise<RouteDecision> {
  let cfg: any = {};
  try {
    const r = await pool.query(
      `SELECT route_config FROM call_routes WHERE tenant_id = $1 AND number_id = $2`,
      [opts.tenantId, opts.numberId],
    );
    cfg = r.rows[0]?.route_config || {};
  } catch {
    return { action: 'allow' };
  }

  // Spam / DND list: hardest gate, runs first.
  if (cfg.spam_dnd?.enabled && Array.isArray(cfg.spam_dnd.blocked_numbers)) {
    const caller = String(opts.callerNumber || '').replace(/[^\d]/g, '');
    if (caller) {
      const hit = cfg.spam_dnd.blocked_numbers.some((n: any) => {
        const cleaned = String(n || '').replace(/[^\d]/g, '');
        return cleaned && (cleaned === caller || caller.endsWith(cleaned));
      });
      if (hit) {
        return {
          action: 'reject',
          reason: 'dnd',
          message: cfg.spam_dnd.reject_message || 'This number is blocked. Goodbye.',
        };
      }
    }
  }

  // Geo restrictions (very simple: country-code prefix match against E.164).
  if (cfg.geo?.enabled) {
    const e164 = String(opts.callerNumber || '').replace(/[^\d+]/g, '');
    const allowList: string[] = Array.isArray(cfg.geo.allowed_country_codes) ? cfg.geo.allowed_country_codes : [];
    const blockList: string[] = Array.isArray(cfg.geo.blocked_country_codes) ? cfg.geo.blocked_country_codes : [];
    if (e164.startsWith('+')) {
      const blocked = blockList.some((cc) => e164.startsWith('+' + String(cc).replace(/^\+/, '')));
      if (blocked) {
        return {
          action: 'reject',
          reason: 'geo_blocked',
          message: 'Sorry, calls from your region are not accepted.',
        };
      }
      if (allowList.length > 0) {
        const allowed = allowList.some((cc) => e164.startsWith('+' + String(cc).replace(/^\+/, '')));
        if (!allowed) {
          return {
            action: 'reject',
            reason: 'geo_not_allowlisted',
            message: 'Sorry, calls from your region are not accepted.',
          };
        }
      }
    }
  }

  // Business hours
  if (cfg.business_hours?.enabled) {
    if (!isWithinBusinessHours(cfg.business_hours)) {
      // If a failover is configured for after-hours, use it.
      if (cfg.failover?.enabled && cfg.failover?.failover_agent_id) {
        return {
          action: 'failover',
          reason: 'after_hours',
          failover_agent_id: cfg.failover.failover_agent_id,
        };
      }
      return {
        action: 'reject',
        reason: 'after_hours',
        message:
          cfg.business_hours.after_hours_message ||
          'Sorry, we\'re closed right now. Please call back during business hours.',
      };
    }
  }

  // IVR (only if explicitly enabled — keeps existing direct-to-agent behaviour)
  if (cfg.ivr?.enabled && Array.isArray(cfg.ivr.menu) && cfg.ivr.menu.length > 0) {
    return { action: 'ivr', ivr: cfg.ivr };
  }

  return { action: 'allow' };
}

function isWithinBusinessHours(hours: any): boolean {
  try {
    const tz = hours.timezone || 'UTC';
    const now = new Date();
    // Convert to target timezone via Intl
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
    const parts = fmt.formatToParts(now);
    const weekdayShort = parts.find((p) => p.type === 'weekday')?.value || 'Sun';
    const hh = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
    const mm = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
    const minutesNow = hh * 60 + mm;
    const dayMap: Record<string, string> = {
      Sun: '0', Mon: '1', Tue: '2', Wed: '3', Thu: '4', Fri: '5', Sat: '6',
    };
    const dayKey = dayMap[weekdayShort] || '0';
    const slot = hours.days?.[dayKey];
    if (!slot) return false;
    const [openH, openM] = String(slot.open || '00:00').split(':').map((x: string) => parseInt(x, 10));
    const [closeH, closeM] = String(slot.close || '23:59').split(':').map((x: string) => parseInt(x, 10));
    const openMin = openH * 60 + (openM || 0);
    const closeMin = closeH * 60 + (closeM || 0);
    return minutesNow >= openMin && minutesNow <= closeMin;
  } catch {
    // Fail open — if timezone math throws, allow the call rather than rejecting.
    return true;
  }
}
