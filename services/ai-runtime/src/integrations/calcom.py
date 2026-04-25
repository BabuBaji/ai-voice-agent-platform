"""Cal.com booking client.

Cal.com v2 REST: https://cal.com/docs/api-reference/v2
v1 was decommissioned 2024-Q4. v2 uses Bearer auth + a `cal-api-version` header.
Tenant pastes a personal API key from cal.com → Settings → Developer.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

import httpx

from common import get_logger

logger = get_logger("calcom")

CALCOM_API = "https://api.cal.com/v2"
CALCOM_API_VERSION = "2024-08-13"


def _to_iso(value: str) -> Optional[str]:
    """Coerce assorted human-supplied datetime strings to UTC ISO 8601."""
    if not value:
        return None
    s = value.strip()
    # Allow plain "2026-04-25T10:30" without TZ — assume UTC.
    try:
        if s.endswith("Z"):
            return s
        if "+" in s[10:] or "-" in s[10:]:
            return s
        # Fall through: parse and re-serialize as UTC ISO
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    except Exception:
        return s  # let cal.com surface the parse error


async def create_booking(
    *,
    api_key: str,
    event_type_id: int | str,
    name: str,
    email: str,
    start: str,
    duration_minutes: int = 30,
    timezone_name: str = "UTC",
    notes: str = "",
    language: str = "en",
) -> dict[str, Any]:
    """Create a Cal.com booking. Returns a dict shaped:
       { ok: bool, booking_id?, link?, start?, end?, error? }
    """
    if not api_key:
        return {"ok": False, "error": "Cal.com API key not configured for this agent"}
    if not event_type_id:
        return {"ok": False, "error": "Cal.com event_type_id not configured for this agent"}
    if not (name and email and start):
        return {"ok": False, "error": "Missing name, email, or start time"}

    iso_start = _to_iso(start)

    payload: dict[str, Any] = {
        "start": iso_start,
        "eventTypeId": int(event_type_id) if str(event_type_id).isdigit() else event_type_id,
        "attendee": {
            "name": name,
            "email": email,
            "timeZone": timezone_name,
            "language": language,
        },
        "metadata": {"booked_via": "voice-agent"},
    }
    if duration_minutes:
        payload["lengthInMinutes"] = duration_minutes
    if notes:
        # v2 routes free-form notes through `bookingFieldsResponses`
        payload["bookingFieldsResponses"] = {"notes": notes}

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "cal-api-version": CALCOM_API_VERSION,
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(f"{CALCOM_API}/bookings", json=payload, headers=headers)
            if r.status_code in (200, 201):
                data = r.json()
                booking = (data.get("data") or {}) if isinstance(data, dict) else {}
                # Cal.com v2 nests the booking under `data`
                return {
                    "ok": True,
                    "booking_id": booking.get("id") or booking.get("uid"),
                    "uid": booking.get("uid"),
                    "link": booking.get("meetingUrl") or booking.get("location"),
                    "start": booking.get("start") or iso_start,
                    "end": booking.get("end"),
                    "title": booking.get("title"),
                }
            text = r.text[:300]
            logger.warn("calcom_booking_failed", status=r.status_code, body=text)
            # Trim noise from cal.com 4xx error bodies for the spoken reply
            short = text
            try:
                import json as _json
                d = _json.loads(text)
                err = d.get("error") if isinstance(d.get("error"), dict) else {}
                short = err.get("message") or d.get("message") or err.get("code") or text
            except Exception:
                pass
            short = (short or "").strip()[:140]
            return {"ok": False, "error": f"Cal.com {r.status_code}: {short}"}
    except Exception as e:
        logger.error("calcom_booking_error", err=str(e))
        return {"ok": False, "error": str(e)}
