"""Public chat endpoint for the embeddable widget.

Unlike /chat/simple this is meant to be called directly from a 3rd-party
website's <script> tag, so:
  - no JWT required
  - CORS allows any origin (the marketing snippet runs on customers' domains)
  - looks up the agent (system_prompt, llm_provider, llm_model) by id so the
    caller only needs to know the public agent_id
  - persists the conversation through conversation-service so it shows up in
    the dashboard's call/conversation log
"""
from __future__ import annotations

import os
import re
from typing import Optional
from uuid import uuid4

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from common import get_logger
from ..integrations.calcom import create_booking as calcom_create_booking
from ..prompts import build_voice_agent_prompt

router = APIRouter()
logger = get_logger("widget-chat")

AGENT_SERVICE_URL = os.getenv("AGENT_SERVICE_URL", "http://localhost:3001/api/v1")
CONVERSATION_SERVICE_URL = os.getenv("CONVERSATION_SERVICE_URL", "http://localhost:3003")
SELF_BASE_URL = os.getenv("AI_RUNTIME_SELF_URL", "http://localhost:8000")


class WidgetChatRequest(BaseModel):
    agent_id: str = Field(..., description="Public agent id")
    message: str = Field(..., min_length=1, max_length=4000)
    conversation_id: Optional[str] = Field(None, description="Pass back to keep history")
    visitor_id: Optional[str] = None
    history: Optional[list[dict]] = Field(None, description="Optional client-side history; ignored if conversation_id is set")
    channel: Optional[str] = Field("chat", description='"chat" (typed widget) or "voice" (live voice call). When "voice", the AI Voice Agent template wraps the agent prompt.')
    customer_name: Optional[str] = Field(None, description="Caller/visitor name if known (threaded into the voice prompt)")
    call_type: Optional[str] = Field(None, description='"inbound", "outbound", "web_call" — overrides agent.direction in the voice template')


class WidgetChatResponse(BaseModel):
    conversation_id: str
    reply: str
    used_mock: bool


async def _load_agent(agent_id: str) -> Optional[dict]:
    """Fetch the agent record via the unauthenticated public endpoint.
    Returns None when the agent does not exist or is not ACTIVE."""
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            r = await client.get(f"{AGENT_SERVICE_URL}/agents-public/{agent_id}")
            if r.status_code == 200:
                return r.json()
            logger.info("agent_lookup_non200", agent_id=agent_id, status=r.status_code)
        except Exception as e:
            logger.warn("agent_lookup_failed", agent_id=agent_id, err=str(e))
    return None


async def _create_conversation(agent_id: str, tenant_id: str, visitor_id: Optional[str]) -> Optional[str]:
    payload = {
        "agent_id": agent_id,
        "channel": "WEB",
        "metadata": {"visitor_id": visitor_id, "source": "widget"},
    }
    headers = {"Content-Type": "application/json", "x-tenant-id": tenant_id}
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            r = await client.post(
                f"{CONVERSATION_SERVICE_URL}/api/v1/conversations",
                json=payload, headers=headers,
            )
            if r.status_code in (200, 201):
                d = r.json()
                return d.get("id") or (d.get("data") or {}).get("id")
        except Exception as e:
            logger.warn("conv_create_failed", err=str(e))
    return None


async def _append_message(conversation_id: str, tenant_id: str, role: str, content: str) -> None:
    headers = {"Content-Type": "application/json", "x-tenant-id": tenant_id}
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            await client.post(
                f"{CONVERSATION_SERVICE_URL}/api/v1/conversations/{conversation_id}/messages",
                json={"role": role, "content": content},
                headers=headers,
            )
        except Exception as e:
            logger.warn("conv_append_failed", err=str(e))


def _augment_system_prompt(base: str, agent: dict) -> str:
    """Append per-feature instructions so the LLM knows when to emit sentinels.

    We use a simple `[BOOK ...]` token convention so this works with any LLM
    (no provider-specific function-calling required, and no schema mismatch
    between providers).
    """
    extras: list[str] = []
    cfg = (agent.get("integrations_config") or {}).get("calcom") or {}
    if cfg.get("enabled") and cfg.get("api_key") and cfg.get("event_type_id"):
        extras.append(
            "\n\n## SCHEDULING TOOL\n"
            "If the user wants to book a meeting/demo/call, gather their full name, email, "
            "and preferred ISO date+time, then respond ONLY with this on its own line:\n"
            "`[BOOK name=\"<Full Name>\" email=\"<email@example.com>\" start=\"2026-04-25T15:00\" duration=30]`\n"
            "Do not say anything else when emitting [BOOK]. The system will book and confirm.\n"
            "Otherwise reply normally as a conversational assistant."
        )
    return base + "".join(extras)


# Regex to parse [BOOK key="value" key2=value ...] sentinel anywhere in the reply.
_BOOK_RE = re.compile(r"\[BOOK\b([^\]]*)\]", re.IGNORECASE)
_KV_RE = re.compile(r"(\w+)\s*=\s*(?:\"([^\"]*)\"|(\S+))")


async def _maybe_execute_book(reply: str, agent: dict) -> Optional[str]:
    """If the LLM emitted a [BOOK ...] sentinel, execute the booking and
    return a human-readable confirmation/error to use as the spoken reply.
    Returns None if no booking sentinel was found."""
    match = _BOOK_RE.search(reply)
    if not match:
        return None

    cfg = (agent.get("integrations_config") or {}).get("calcom") or {}
    if not (cfg.get("enabled") and cfg.get("api_key") and cfg.get("event_type_id")):
        return "I'd love to book that, but the calendar integration isn't configured on this agent yet."

    raw = match.group(1)
    kv: dict[str, str] = {}
    for m in _KV_RE.finditer(raw):
        kv[m.group(1).lower()] = m.group(2) if m.group(2) is not None else m.group(3)

    name = kv.get("name", "")
    email = kv.get("email", "")
    start = kv.get("start", "")
    duration = int(kv.get("duration") or cfg.get("default_duration_minutes") or 30)
    timezone_name = kv.get("tz") or cfg.get("timezone") or "UTC"

    if not (name and email and start):
        return "I need your full name, email, and a preferred date and time to book the meeting. Can you share those?"

    result = await calcom_create_booking(
        api_key=cfg["api_key"],
        event_type_id=cfg["event_type_id"],
        name=name,
        email=email,
        start=start,
        duration_minutes=duration,
        timezone_name=timezone_name,
    )
    if result.get("ok"):
        return f"Booked! You're confirmed for {result.get('start') or start}. We've sent a confirmation to {email}."
    err = result.get("error", "unknown error")
    return f"I couldn't complete that booking — {err}. Want to try another time?"


async def _fetch_history(conversation_id: str, tenant_id: str) -> list[dict]:
    headers = {"x-tenant-id": tenant_id}
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            r = await client.get(
                f"{CONVERSATION_SERVICE_URL}/api/v1/conversations/{conversation_id}/messages",
                headers=headers,
            )
            if r.status_code == 200:
                d = r.json()
                msgs = d if isinstance(d, list) else d.get("data", [])
                return [
                    {"role": m["role"], "content": m["content"]}
                    for m in msgs
                    if m.get("role") in ("user", "assistant") and m.get("content")
                ]
        except Exception as e:
            logger.warn("history_fetch_failed", err=str(e))
    return []


@router.post("/chat/widget", response_model=WidgetChatResponse)
async def widget_chat(req: WidgetChatRequest) -> WidgetChatResponse:
    # Public lookup — only ACTIVE agents are returned.
    agent = await _load_agent(req.agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent not found or not active: {req.agent_id}")

    tenant_id = agent.get("tenant_id") or agent.get("tenantId") or ""
    if not tenant_id:
        raise HTTPException(status_code=500, detail="Agent missing tenant_id")

    # Create or reuse conversation
    conversation_id = req.conversation_id
    if not conversation_id:
        conversation_id = await _create_conversation(req.agent_id, tenant_id, req.visitor_id)
        if not conversation_id:
            # Fall back to a synthetic id so the widget keeps working even when conv-service is down
            conversation_id = f"local-{uuid4()}"

    # Build history — prefer server-side, fall back to client-supplied
    history: list[dict] = []
    if not conversation_id.startswith("local-"):
        history = await _fetch_history(conversation_id, tenant_id)
    elif req.history:
        history = [m for m in req.history if isinstance(m, dict) and m.get("role") and m.get("content")]

    history.append({"role": "user", "content": req.message})

    # Persist the user message (best-effort)
    if not conversation_id.startswith("local-"):
        await _append_message(conversation_id, tenant_id, "user", req.message)

    # Call our own /chat/simple to reuse provider routing + mock fallback
    base_prompt = agent.get("system_prompt") or "You are a helpful AI assistant. Reply briefly."

    # For voice calls, wrap the agent's base prompt in the canonical AI Voice Agent
    # template (handles greeting, turn-taking, data capture, language match, etc.).
    # The same template is used by the phone-call path via telephony-adapter's TS port.
    if (req.channel or "chat").lower() == "voice":
        base_prompt = build_voice_agent_prompt(
            base_prompt=base_prompt,
            agent=agent,
            call_type=req.call_type,
            customer_name=req.customer_name,
        )

    payload = {
        "system_prompt": _augment_system_prompt(base_prompt, agent),
        "messages": history,
        "provider": agent.get("llm_provider") or "openai",
        "model": agent.get("llm_model") or "gpt-4o",
        "temperature": float(agent.get("temperature") or 0.7),
        "max_tokens": 300,
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(f"{SELF_BASE_URL}/chat/simple", json=payload)
        if r.status_code != 200:
            raise HTTPException(status_code=502, detail=f"LLM proxy failed: {r.status_code}")
        data = r.json()

    reply = (data.get("reply") or "").strip() or "Sorry, I didn't catch that."

    # If the LLM emitted a [BOOK ...] sentinel, execute the booking and
    # replace the spoken reply with a human-readable confirmation.
    booking_msg = await _maybe_execute_book(reply, agent)
    if booking_msg:
        reply = booking_msg

    # Persist assistant reply
    if not conversation_id.startswith("local-"):
        await _append_message(conversation_id, tenant_id, "assistant", reply)

    return WidgetChatResponse(
        conversation_id=conversation_id,
        reply=reply,
        used_mock=bool(data.get("mock")),
    )
