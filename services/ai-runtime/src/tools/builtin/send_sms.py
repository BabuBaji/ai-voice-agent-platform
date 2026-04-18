from typing import Any


async def send_sms(
    to: str = "",
    body: str = "",
    conversation_id: str = "",
    **kwargs: Any,
) -> dict[str, Any]:
    """Send an SMS message. Stub implementation."""
    # TODO: integrate with Twilio / notification service
    return {
        "message_id": "stub-sms-001",
        "status": "sent",
        "to": to,
    }
