"""
send_sms — AI agent tool. Posts to conversation-service's /communications/sms/send
which routes through the tenant's configured Plivo (or Twilio fallback) and
writes communication_logs. Tenant context is resolved from conversation_id via
conversation-service's GET /conversations/{id}.

Returns the same shape regardless of provider so the LLM gets a consistent
"sent / failed + message" reply to fold back into its reasoning.
"""

import os
from typing import Any

import httpx

from common import get_logger

logger = get_logger("tool-send-sms")

# When running inside Docker / k8s we'd flip this via env. Local default works
# against the dev stack where conversation-service binds 3003.
CONVERSATION_SERVICE_URL = os.environ.get(
    "CONVERSATION_SERVICE_URL", "http://localhost:3003/api/v1"
)


async def _resolve_tenant_id(conversation_id: str) -> str | None:
    """Look up a conversation's tenant_id. Returns None if the conversation
    doesn't exist or conversation-service is unreachable."""
    if not conversation_id:
        return None
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            r = await client.get(f"{CONVERSATION_SERVICE_URL}/conversations/{conversation_id}")
            if r.status_code != 200:
                logger.warning(
                    "conversation_lookup_failed",
                    conversation_id=conversation_id,
                    status=r.status_code,
                )
                return None
            data = r.json() or {}
            return data.get("tenant_id") or data.get("tenantId") or None
    except Exception as exc:
        logger.warning(
            "conversation_lookup_threw",
            conversation_id=conversation_id,
            error=str(exc),
        )
        return None


async def send_sms(
    to: str = "",
    body: str = "",
    conversation_id: str = "",
    tenant_id: str = "",
    **kwargs: Any,
) -> dict[str, Any]:
    """Send an SMS to the caller (or any recipient) via the tenant's configured
    Plivo / Twilio integration. The agent invokes this mid-conversation; the
    request lands in communication_logs and the delivery webhook updates the
    status asynchronously."""

    if not to or not body:
        return {
            "status": "failed",
            "error": "Both 'to' (phone) and 'body' (message) are required.",
            "to": to,
        }

    # Tenant resolution priority: explicit kwarg → lookup by conversation.
    # Without a tenant we can't pick which Plivo creds to use — refuse rather
    # than silently routing through the env-default sender of another tenant.
    resolved_tenant = tenant_id or await _resolve_tenant_id(conversation_id)
    if not resolved_tenant:
        return {
            "status": "failed",
            "error": "Could not resolve tenant for this conversation. Pass tenant_id explicitly or use a valid conversation_id.",
            "to": to,
        }

    payload: dict[str, Any] = {"recipient": to, "message": body}
    if conversation_id:
        payload["conversation_id"] = conversation_id
    # The lead_id is optional; if the caller knows it they can pass via kwargs.
    if kwargs.get("lead_id"):
        payload["lead_id"] = kwargs["lead_id"]

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(
                f"{CONVERSATION_SERVICE_URL}/communications/sms/send",
                headers={"x-tenant-id": resolved_tenant, "Content-Type": "application/json"},
                json=payload,
            )
            data: dict[str, Any] = {}
            try:
                data = r.json() or {}
            except Exception:
                pass
            if r.status_code >= 400 or data.get("ok") is False:
                err = data.get("error") or data.get("message") or f"HTTP {r.status_code}"
                logger.warning(
                    "send_sms_failed",
                    to=to,
                    tenant_id=resolved_tenant,
                    status=r.status_code,
                    error=err,
                )
                return {
                    "status": "failed",
                    "error": err,
                    "to": to,
                    "log_id": data.get("log_id"),
                }
            logger.info(
                "send_sms_dispatched",
                to=to,
                tenant_id=resolved_tenant,
                log_id=data.get("log_id"),
            )
            return {
                "status": "sent",
                "message_id": data.get("log_id") or "queued",
                "to": to,
                "log_id": data.get("log_id"),
            }
    except Exception as exc:
        logger.error("send_sms_threw", to=to, error=str(exc))
        return {"status": "failed", "error": str(exc), "to": to}
