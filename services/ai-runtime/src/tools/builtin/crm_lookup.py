from typing import Any


async def lookup_crm(
    phone: str = "",
    email: str = "",
    name: str = "",
    conversation_id: str = "",
    **kwargs: Any,
) -> dict[str, Any]:
    """Look up a contact in the CRM. Stub implementation."""
    # TODO: integrate with CRM service
    return {
        "found": True,
        "contact": {
            "id": "stub-contact-001",
            "name": name or "Jane Doe",
            "email": email or "jane@example.com",
            "phone": phone or "+1234567890",
            "status": "active_lead",
        },
    }
