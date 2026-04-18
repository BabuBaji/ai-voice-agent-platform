from typing import Any

import httpx

from common import get_logger
from ...config import settings

logger = get_logger("crm-lookup")


async def lookup_crm(
    phone: str = "",
    email: str = "",
    name: str = "",
    conversation_id: str = "",
    **kwargs: Any,
) -> dict[str, Any]:
    """Look up a lead/contact in the CRM service by phone, email, or name."""
    params: dict[str, str] = {}
    if phone:
        params["phone"] = phone
    if email:
        params["email"] = email
    if name:
        params["name"] = name

    if not params:
        return {
            "found": False,
            "error": "At least one of phone, email, or name is required for lookup.",
        }

    logger.info("crm_lookup", params=params, conversation_id=conversation_id)

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{settings.crm_service_url}/leads/search",
                params=params,
                headers={"Content-Type": "application/json"},
            )
            resp.raise_for_status()
            data = resp.json()

        leads = data.get("leads", [])
        if not leads:
            logger.info("crm_lookup_not_found", params=params)
            return {
                "found": False,
                "message": "No matching contact found in the CRM.",
            }

        lead = leads[0]
        logger.info("crm_lookup_found", lead_id=lead.get("id"))
        return {
            "found": True,
            "contact": {
                "id": lead.get("id", ""),
                "name": lead.get("name", ""),
                "email": lead.get("email", ""),
                "phone": lead.get("phone", ""),
                "status": lead.get("status", "unknown"),
                "company": lead.get("company", ""),
                "notes": lead.get("notes", ""),
            },
        }

    except httpx.HTTPStatusError as e:
        logger.error("crm_lookup_http_error", status=e.response.status_code)
        return {
            "found": False,
            "error": f"CRM service returned {e.response.status_code}",
        }
    except httpx.ConnectError:
        logger.error("crm_lookup_connect_error", crm_url=settings.crm_service_url)
        return {
            "found": False,
            "error": "Could not connect to CRM service",
        }
