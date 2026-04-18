from typing import Any

import httpx

from common import get_logger
from ...config import settings

logger = get_logger("calendar-booking")


async def book_calendar(
    date: str = "",
    time: str = "",
    duration_minutes: int = 30,
    attendee_name: str = "",
    attendee_email: str = "",
    notes: str = "",
    conversation_id: str = "",
    **kwargs: Any,
) -> dict[str, Any]:
    """Book a calendar appointment via the CRM service."""
    payload = {
        "date": date,
        "time": time,
        "duration_minutes": duration_minutes,
        "title": f"Appointment with {attendee_name}" if attendee_name else "Appointment",
        "attendee_name": attendee_name,
        "attendee_email": attendee_email,
        "notes": notes,
        "conversation_id": conversation_id,
    }

    logger.info(
        "booking_appointment",
        date=date,
        time=time,
        attendee=attendee_name,
        conversation_id=conversation_id,
    )

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{settings.crm_service_url}/appointments",
                json=payload,
                headers={"Content-Type": "application/json"},
            )
            resp.raise_for_status()
            result = resp.json()
            logger.info("appointment_booked", booking_id=result.get("id"))
            return {
                "booking_id": result.get("id", ""),
                "status": result.get("status", "confirmed"),
                "date": date,
                "time": time,
                "duration_minutes": duration_minutes,
                "attendee_name": attendee_name,
                "message": f"Appointment booked for {attendee_name} on {date} at {time}.",
            }
    except httpx.HTTPStatusError as e:
        logger.error("booking_failed_http", status=e.response.status_code, detail=e.response.text)
        return {
            "status": "failed",
            "error": f"CRM service returned {e.response.status_code}",
            "message": "Failed to book the appointment. Please try again.",
        }
    except httpx.ConnectError:
        logger.error("booking_failed_connect", crm_url=settings.crm_service_url)
        return {
            "status": "failed",
            "error": "Could not connect to CRM service",
            "message": "The booking system is currently unavailable. Please try again later.",
        }
