"""Live streaming voice WebSocket — sub-second latency web call path.

Architecture (single browser ↔ server WS, full duplex JSON+binary frames):

    Browser → Server   binary  audio chunks (Opus/WebM, ~250ms)
                       JSON    {type:'start', agent_id, conversation_id?}
                       JSON    {type:'utterance_end'}    (optional manual flush)

    Server → Browser   JSON    {type:'transcript_partial', text}
                       JSON    {type:'transcript_final',   text}
                       JSON    {type:'reply_text',         text}
                       binary  TTS audio bytes (mp3, chunked as they generate)
                       JSON    {type:'reply_done'}

We bridge to Deepgram's streaming STT WebSocket for real-time partial+final
transcripts. On a final transcript we call /chat/widget (existing) for the
reply, then stream OpenAI TTS bytes straight back to the browser.

Why not full WebRTC? Because the only real win of WebRTC over this is
network jitter handling, and for a desktop chat that's not load-bearing.
This path keeps signalling trivial (a single WS) and reuses every existing
auth, agent, and persistence path.
"""
from __future__ import annotations

import asyncio
import json
import os
from typing import Optional
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from common import get_logger

router = APIRouter()
logger = get_logger("live-voice")

DEEPGRAM_KEY = lambda: os.getenv("DEEPGRAM_API_KEY") or ""
OPENAI_KEY = lambda: os.getenv("OPENAI_API_KEY") or ""
SELF_BASE_URL = os.getenv("AI_RUNTIME_SELF_URL", "http://localhost:8000")


@router.websocket("/ws/voice/{agent_id}")
async def live_voice(ws: WebSocket, agent_id: str):
    """Bidirectional streaming voice channel.

    Client opens the WS, sends a {"type":"start"} JSON, then streams audio
    binary frames. We forward to Deepgram, push transcripts back, and on
    each final transcript we run the agent + stream TTS audio back.
    """
    await ws.accept()
    conversation_id: Optional[str] = None
    visitor_id: Optional[str] = None
    customer_name: Optional[str] = None

    # Parse the opening start frame
    try:
        first = await asyncio.wait_for(ws.receive_text(), timeout=10.0)
        msg = json.loads(first)
        if msg.get("type") != "start":
            await ws.close(code=4400, reason="first frame must be {type:'start'}")
            return
        conversation_id = msg.get("conversation_id") or None
        visitor_id = msg.get("visitor_id") or None
        customer_name = msg.get("customer_name") or None
    except (asyncio.TimeoutError, json.JSONDecodeError, WebSocketDisconnect):
        try:
            await ws.close(code=4400, reason="bad start frame")
        except Exception:
            pass
        return

    if not DEEPGRAM_KEY():
        await ws.send_json({"type": "error", "message": "DEEPGRAM_API_KEY not configured on server"})
        await ws.close(code=4500)
        return

    logger.info("live_voice_started", agent_id=agent_id, conversation_id=conversation_id)

    # Inner state for the bridge tasks
    state = {
        "conversation_id": conversation_id,
        "visitor_id": visitor_id,
        "customer_name": customer_name,
        "in_flight_reply": False,  # serialise replies — don't overlap
    }

    try:
        await _bridge(ws, agent_id, state)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error("live_voice_bridge_error", err=str(e))
        try:
            await ws.send_json({"type": "error", "message": str(e)[:200]})
            await ws.close(code=1011)
        except Exception:
            pass

    logger.info("live_voice_ended", agent_id=agent_id, conversation_id=state.get("conversation_id"))


async def _bridge(ws: WebSocket, agent_id: str, state: dict) -> None:
    """Open Deepgram WS, fan messages between browser and Deepgram, and on
    each final transcript run the agent + stream TTS reply back to browser."""
    import websockets as wslib

    # Deepgram URL — Opus/WebM is the practical default from MediaRecorder
    qs = urlencode({
        "model": "nova-2",
        "interim_results": "true",
        "smart_format": "true",
        "vad_events": "true",
        "endpointing": "300",  # ms of silence to mark utterance end
        # Don't pin a sample rate — let DG infer from the Opus container
    })
    dg_url = f"wss://api.deepgram.com/v1/listen?{qs}"
    dg_headers = {"Authorization": f"Token {DEEPGRAM_KEY()}"}

    async with wslib.connect(dg_url, additional_headers=dg_headers, max_size=10_000_000) as dg:
        # Two concurrent tasks share the same Deepgram WS:
        #   - browser_to_dg : forwards audio frames from the browser to DG
        #   - dg_to_browser : forwards transcripts back, runs agent on finals
        async def browser_to_dg():
            try:
                while True:
                    msg = await ws.receive()
                    if msg.get("type") == "websocket.disconnect":
                        break
                    if "bytes" in msg and msg["bytes"] is not None:
                        await dg.send(msg["bytes"])
                    elif "text" in msg and msg["text"] is not None:
                        # Allow client to force-close the stream
                        try:
                            jm = json.loads(msg["text"])
                            if jm.get("type") == "stop":
                                # Tell DG no more audio is coming
                                await dg.send(json.dumps({"type": "CloseStream"}))
                                break
                        except Exception:
                            pass
            finally:
                # Best-effort — let DG drain
                try:
                    await dg.send(json.dumps({"type": "CloseStream"}))
                except Exception:
                    pass

        async def dg_to_browser():
            async for raw in dg:
                if isinstance(raw, bytes):
                    continue  # DG never sends binary, but ignore safely
                try:
                    data = json.loads(raw)
                except Exception:
                    continue
                if data.get("type") == "Results":
                    alt = (
                        data.get("channel", {})
                        .get("alternatives", [{}])[0]
                    )
                    transcript = (alt.get("transcript") or "").strip()
                    is_final = bool(data.get("is_final"))
                    if not transcript:
                        continue
                    if is_final:
                        await ws.send_json({"type": "transcript_final", "text": transcript})
                        # Don't await the agent call here — let new audio keep
                        # flowing. We serialise replies via state['in_flight_reply'].
                        if not state["in_flight_reply"]:
                            state["in_flight_reply"] = True
                            asyncio.create_task(_handle_utterance(ws, agent_id, state, transcript))
                    else:
                        await ws.send_json({"type": "transcript_partial", "text": transcript})

        await asyncio.gather(browser_to_dg(), dg_to_browser(), return_exceptions=True)


async def _handle_utterance(ws: WebSocket, agent_id: str, state: dict, user_text: str) -> None:
    """Run the agent on a final transcript and stream the spoken reply back."""
    try:
        # 1. Get reply text via the existing public widget endpoint (handles
        #    agent lookup, conversation persistence, [BOOK] sentinel, etc.)
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(
                f"{SELF_BASE_URL}/chat/widget",
                json={
                    "agent_id": agent_id,
                    "message": user_text,
                    "conversation_id": state.get("conversation_id"),
                    "visitor_id": state.get("visitor_id"),
                    "channel": "voice",
                    "call_type": "web_call",
                    "customer_name": state.get("customer_name"),
                },
            )
            if r.status_code != 200:
                await ws.send_json({"type": "error", "message": f"agent reply failed: {r.status_code}"})
                return
            data = r.json()
            reply = data.get("reply") or ""
            new_conv = data.get("conversation_id")
            if new_conv and not state.get("conversation_id"):
                state["conversation_id"] = new_conv
                await ws.send_json({"type": "conversation_id", "value": new_conv})

        await ws.send_json({"type": "reply_text", "text": reply})

        # 2. Stream TTS bytes back (chunked). Browser plays them as they arrive.
        if reply.strip() and OPENAI_KEY():
            try:
                async with httpx.AsyncClient(timeout=60.0) as client:
                    async with client.stream(
                        "POST",
                        "https://api.openai.com/v1/audio/speech",
                        headers={
                            "Authorization": f"Bearer {OPENAI_KEY()}",
                            "Content-Type": "application/json",
                        },
                        json={
                            "model": "tts-1",
                            "voice": "nova",
                            "input": reply[:3900],
                            "response_format": "mp3",
                            "speed": 1.0,
                        },
                    ) as resp:
                        if resp.status_code != 200:
                            err_body = (await resp.aread())[:200].decode("utf-8", errors="replace")
                            await ws.send_json({"type": "tts_error", "message": f"openai tts {resp.status_code}: {err_body}"})
                        else:
                            async for chunk in resp.aiter_bytes(chunk_size=4096):
                                if chunk:
                                    await ws.send_bytes(chunk)
            except Exception as e:
                await ws.send_json({"type": "tts_error", "message": str(e)[:200]})

        await ws.send_json({"type": "reply_done"})
    finally:
        state["in_flight_reply"] = False
