"""Web Call module — browser ↔ server full-duplex voice WebSocket.

Protocol (matches the spec in the product brief):

Client → Server  (JSON except audio_chunk):
  {type:"start_call", call_id}
  {type:"audio_chunk"}          # followed by a binary frame
  <binary audio>                # Opus/WebM chunks from MediaRecorder
  {type:"user_speaking"}
  {type:"user_stopped_speaking"}  # end-of-utterance signal
  {type:"interrupt_agent"}      # stop current TTS playback server-side
  {type:"end_call", reason?}

Server → Client:
  {type:"call_started", call_id, agent:{...}, language, voice}
  {type:"listening"}
  {type:"partial_transcript", text, language?}
  {type:"final_transcript", text, language?, confidence?}
  {type:"agent_thinking"}
  {type:"agent_response_text", text, language?}
  {type:"agent_speaking"}
  {type:"agent_audio", format}    # followed by one or more binary frames
  <binary audio>                 # mp3 or wav bytes
  {type:"agent_audio_end"}
  {type:"recording_saved", kind, url}
  {type:"call_ended", reason, duration_seconds}
  {type:"analysis_ready", analysis}
  {type:"error", message}
"""
from __future__ import annotations

import asyncio
import json
import os
import time
import uuid
from pathlib import Path
from typing import Optional

import httpx
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from common import get_logger
from ..providers.speech import (
    make_stt_bridge,
    pick_stt_provider,
    pick_tts_provider,
    default_voice,
    synthesize_tts,
    SarvamBatchBridge,
    AzureStreamingBridge,
)

router = APIRouter()
logger = get_logger("web-call")

AGENT_SERVICE_URL = os.getenv("AGENT_SERVICE_URL", "http://localhost:3001/api/v1")
CONVERSATION_SERVICE_URL = os.getenv("CONVERSATION_SERVICE_URL", "http://localhost:3003")
SELF_BASE_URL = os.getenv("AI_RUNTIME_SELF_URL", "http://localhost:8000")

# Where user-audio + agent-audio blobs land before we register them in the DB.
# IMPORTANT: resolve to an absolute path. ai-runtime (writer) and
# conversation-service (reader) run with different cwds, so storing a relative
# path in the DB breaks playback — the reader resolves it from its own cwd and
# misses the file.
RECORDINGS_ROOT = Path(
    os.getenv("WEB_CALL_RECORDINGS_DIR")
    or os.getenv("RECORDINGS_DIR")
    # Default matches conversation-service's `data/recordings` dir. Walk up two
    # levels from this file: src/api/web_call.py → services/ai-runtime → repo
    # root, then into services/conversation-service/data/recordings.
    or str(Path(__file__).resolve().parents[3] / "services" / "conversation-service" / "data" / "recordings")
).resolve() / "web-calls"


@router.websocket("/ws/webcall/{call_id}")
async def web_call(ws: WebSocket, call_id: str):
    await ws.accept()
    RECORDINGS_ROOT.mkdir(parents=True, exist_ok=True)

    # 1. Load session + agent
    session = await _load_session(call_id)
    if not session:
        await ws.send_json({"type": "error", "message": "web call session not found"})
        await ws.close(code=4404)
        return

    tenant_id = session.get("tenant_id")
    agent_id = session.get("agent_id")
    agent = await _load_agent(agent_id, tenant_id) if agent_id else None
    if not agent:
        await ws.send_json({"type": "error", "message": "agent not found"})
        await ws.close(code=4404)
        return

    # 2. Wait for start_call from client (spec), but tolerate clients that
    #    don't send it (just treat first audio as start).
    try:
        first = await asyncio.wait_for(ws.receive(), timeout=15.0)
    except asyncio.TimeoutError:
        await ws.send_json({"type": "error", "message": "timeout waiting for start_call"})
        await ws.close(code=4408)
        return
    except WebSocketDisconnect:
        return

    if first.get("type") == "websocket.disconnect":
        return
    if first.get("text"):
        try:
            jm = json.loads(first["text"])
            if jm.get("type") != "start_call":
                # Any other JSON is bad; but we accept silently
                pass
        except Exception:
            pass
    # If first frame was binary audio, we'll re-emit it below.

    primary_language = session.get("primary_language") or "en-IN"
    auto_detect = bool(session.get("auto_detect_language"))
    mixed = bool(session.get("mixed_language_allowed"))

    stt_provider = pick_stt_provider(primary_language, auto_detect)
    tts_provider = pick_tts_provider(primary_language, session.get("voice_provider"))

    voice_name = session.get("voice_name") or default_voice(
        tts_provider, primary_language, session.get("voice_gender")
    )
    voice_speed = float(session.get("voice_speed") or 1.0)

    # 3. Mark session ACTIVE
    await _update_session(call_id, tenant_id, {
        "status": "ACTIVE",
        "voice_provider": tts_provider,
        "voice_name": voice_name,
    })

    await ws.send_json({
        "type": "call_started",
        "call_id": call_id,
        "agent": {
            "id": agent.get("id"),
            "name": agent.get("name"),
            "greeting_message": agent.get("greeting_message"),
        },
        "language": primary_language,
        "auto_detect_language": auto_detect,
        "mixed_language_allowed": mixed,
        "voice": {"provider": tts_provider, "name": voice_name, "speed": voice_speed},
        "stt_provider": stt_provider,
    })
    # Seed the event ledger so we always have a row even on empty calls
    await _log_event(
        {"call_id": call_id, "tenant_id": tenant_id},
        "system",
        "call_started",
        {"language": primary_language, "stt": stt_provider, "tts": tts_provider, "voice": voice_name},
    )

    # 4. Build STT bridge and state
    stt = make_stt_bridge(primary_language, auto_detect, mixed)
    await stt.start()

    state = {
        "call_id": call_id,
        "tenant_id": tenant_id,
        "agent_id": agent_id,
        "agent": agent,
        "conversation_id": session.get("conversation_id"),
        "primary_language": primary_language,
        "auto_detect": auto_detect,
        "mixed": mixed,
        "tts_provider": tts_provider,
        "voice_name": voice_name,
        "voice_speed": voice_speed,
        "recording_enabled": bool(session.get("recording_enabled", True)),
        "transcript_enabled": bool(session.get("transcript_enabled", True)),
        "in_flight_reply": False,
        "current_reply_id": 0,
        "started_at": time.time(),
        "transcript_sequence": 0,
        "user_audio_chunks": [],   # raw Opus/WebM bytes from client
        "agent_audio_chunks": [],  # TTS bytes we sent back (mp3 for openai/azure, wav for sarvam)
        "user_audio_mime": "audio/webm",
        "agent_audio_mime": "audio/mpeg",
    }

    # 5. Optional greeting
    greeting = (agent.get("greeting_message") or "").strip()
    if greeting:
        asyncio.create_task(_run_agent_turn(ws, state, stt, text_override=greeting, as_greeting=True))
    else:
        await ws.send_json({"type": "listening"})

    # 6. Run tasks: client→STT pump, STT→LLM→TTS pump
    async def client_pump():
        # Tolerate that the FIRST frame we already read may have been binary
        # audio — feed it in if so.
        if first.get("bytes"):
            chunk = first["bytes"]
            state["user_audio_chunks"].append(chunk)
            await stt.push_audio(chunk)

        while True:
            try:
                msg = await ws.receive()
            except WebSocketDisconnect:
                break
            if msg.get("type") == "websocket.disconnect":
                break

            if msg.get("bytes") is not None:
                chunk = msg["bytes"]
                if state["recording_enabled"]:
                    state["user_audio_chunks"].append(chunk)
                await stt.push_audio(chunk)
            elif msg.get("text") is not None:
                try:
                    jm = json.loads(msg["text"])
                except Exception:
                    continue
                t = jm.get("type")
                if t == "audio_chunk":
                    # next frame is binary — no-op marker
                    continue
                elif t == "user_stopped_speaking":
                    # Push utterance boundary to batched providers
                    if isinstance(stt, (SarvamBatchBridge, AzureStreamingBridge)):
                        await stt.flush_utterance(state["user_audio_mime"])
                    await _log_event(state, "in", "user_stopped_speaking")
                elif t == "user_speaking":
                    pass  # informational only
                elif t == "interrupt_agent":
                    state["current_reply_id"] += 1  # bump so in-flight reply drops its chunks
                    await ws.send_json({"type": "listening"})
                    await _log_event(state, "in", "interrupt_agent")
                elif t == "end_call":
                    reason = jm.get("reason") or "client_ended"
                    await _end_call(ws, state, reason)
                    await stt.close()
                    try:
                        await ws.close()
                    except Exception:
                        pass
                    return

    async def stt_pump():
        async for res in stt.results():
            kind = res.get("type")
            text = (res.get("text") or "").strip()
            if not text:
                continue
            if kind == "partial":
                await ws.send_json({
                    "type": "partial_transcript",
                    "text": text,
                    "language": res.get("language") or primary_language,
                })
                continue

            # final
            lang = res.get("language") or primary_language
            conf = res.get("confidence")
            await ws.send_json({
                "type": "final_transcript",
                "text": text,
                "language": lang,
                "confidence": conf,
            })
            # Persist transcript line + event
            await _save_transcript(state, "user", text, lang, conf)
            await _log_event(state, "out", "final_transcript", {"text": text, "language": lang, "confidence": conf})

            if not state["in_flight_reply"]:
                state["in_flight_reply"] = True
                asyncio.create_task(_run_agent_turn(ws, state, stt, user_text=text, user_language=lang))

    try:
        await asyncio.gather(client_pump(), stt_pump(), return_exceptions=True)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error("web_call_bridge_error", err=str(e))

    # If we got here without an explicit end_call, run the tear-down anyway.
    await _end_call(ws, state, "disconnected")


async def _run_agent_turn(
    ws: WebSocket,
    state: dict,
    stt,
    *,
    user_text: Optional[str] = None,
    user_language: Optional[str] = None,
    text_override: Optional[str] = None,
    as_greeting: bool = False,
) -> None:
    """Run one agent reply: LLM → TTS stream. Serialised via state['in_flight_reply']."""
    reply_id = state["current_reply_id"] + 1
    state["current_reply_id"] = reply_id
    try:
        reply_text = text_override
        if reply_text is None and user_text:
            await ws.send_json({"type": "agent_thinking"})
            reply_text = await _llm_reply(state, user_text, user_language)

        if not reply_text:
            return

        await ws.send_json({
            "type": "agent_response_text",
            "text": reply_text,
            "language": user_language or state["primary_language"],
        })
        await _save_transcript(state, "agent", reply_text, user_language or state["primary_language"], None)
        await _log_event(state, "out", "agent_response_text", {
            "text": reply_text,
            "language": user_language or state["primary_language"],
            "is_greeting": bool(as_greeting),
        })
        await ws.send_json({"type": "agent_speaking"})

        # TTS
        tts_provider = state["tts_provider"]
        fmt = "mp3" if tts_provider in ("openai", "azure") else "wav"
        state["agent_audio_mime"] = "audio/mpeg" if fmt == "mp3" else "audio/wav"
        await ws.send_json({"type": "agent_audio", "format": fmt})

        try:
            async for chunk in synthesize_tts(
                provider=tts_provider,
                text=reply_text,
                language=user_language or state["primary_language"],
                voice=state["voice_name"],
                speed=state["voice_speed"],
            ):
                if state["current_reply_id"] != reply_id:
                    # interrupted
                    break
                if state["recording_enabled"]:
                    state["agent_audio_chunks"].append(chunk)
                await ws.send_bytes(chunk)
        except Exception as e:
            logger.warn("tts_stream_failed", err=str(e))

        await ws.send_json({"type": "agent_audio_end"})
        if not as_greeting:
            await ws.send_json({"type": "listening"})
    finally:
        state["in_flight_reply"] = False


async def _llm_reply(state: dict, user_text: str, user_language: Optional[str]) -> str:
    """Reuse the existing /chat/widget endpoint for the agent brain. It handles
    agent lookup, system-prompt composition, conversation persistence, Cal.com
    [BOOK] sentinel, and mock/Sarvam LLM fallback."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(
                f"{SELF_BASE_URL}/chat/widget",
                json={
                    "agent_id": state["agent_id"],
                    "message": user_text,
                    "conversation_id": state.get("conversation_id"),
                    "visitor_id": f"webcall:{state['call_id']}",
                    "channel": "voice",
                    "call_type": "web_call",
                },
            )
            if r.status_code != 200:
                return "Sorry, I'm having trouble responding right now."
            data = r.json()
            reply = (data.get("reply") or "").strip()
            new_conv = data.get("conversation_id")
            if new_conv and not state.get("conversation_id"):
                state["conversation_id"] = new_conv
                # Link the conversation id back into the web_call_session
                await _update_session(state["call_id"], state["tenant_id"], {
                    "conversation_id": new_conv,
                })
            return reply
    except Exception as e:
        logger.warn("llm_reply_failed", err=str(e))
        return "Sorry, something went wrong on my end."


# ---------------------------------------------------------------------------
# Persistence helpers (HTTP to conversation-service)
# ---------------------------------------------------------------------------

async def _load_session(call_id: str) -> Optional[dict]:
    """Load a web_call session. We bypass auth by querying the service directly
    with a synthetic tenant scan — this WS is gated by call_id knowledge and
    happens AFTER POST /web-calls/start (which did the auth)."""
    # The REST endpoint requires x-tenant-id; we don't have one yet at WS
    # connect time. Use a direct DB-ish admin path: do an unauthed admin lookup.
    # We add a small unauthed admin endpoint server-side (below) just for WS
    # bootstrap. For now, try the tenant-less internal route.
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            r = await client.get(f"{CONVERSATION_SERVICE_URL}/internal/web-calls/{call_id}")
            if r.status_code == 200:
                return r.json()
        except Exception as e:
            logger.warn("session_lookup_failed", err=str(e))
    return None


async def _load_agent(agent_id: str, tenant_id: Optional[str] = None) -> Optional[dict]:
    """Look up an agent for a web-call WS handshake.

    Prefers the tenant-scoped GET /agents/:id (works for DRAFT agents — we've
    already checked tenant ownership at REST /start time). Falls back to the
    unauthenticated agents-public endpoint (ACTIVE-only) for legacy callers.
    """
    async with httpx.AsyncClient(timeout=5.0) as client:
        if tenant_id:
            try:
                r = await client.get(
                    f"{AGENT_SERVICE_URL}/agents/{agent_id}",
                    headers={"x-tenant-id": tenant_id},
                )
                if r.status_code == 200:
                    return r.json()
            except Exception as e:
                logger.warn("tenant_agent_lookup_failed", err=str(e))
        try:
            r = await client.get(f"{AGENT_SERVICE_URL}/agents-public/{agent_id}")
            if r.status_code == 200:
                return r.json()
        except Exception as e:
            logger.warn("agent_public_lookup_failed", err=str(e))
    return None


async def _update_session(call_id: str, tenant_id: str, patch: dict) -> None:
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            await client.patch(
                f"{CONVERSATION_SERVICE_URL}/internal/web-calls/{call_id}",
                json=patch,
                headers={"x-tenant-id": tenant_id or ""},
            )
        except Exception as e:
            logger.warn("session_update_failed", err=str(e))


async def _log_event(state: dict, direction: str, event_type: str, payload: Optional[dict] = None) -> None:
    """Fire-and-forget append into web_call_events. direction ∈ {in, out, system}."""
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            await client.post(
                f"{CONVERSATION_SERVICE_URL}/internal/web-calls/{state['call_id']}/events",
                json={"event_type": event_type, "direction": direction, "payload": payload or {}},
                headers={"x-tenant-id": state.get("tenant_id") or ""},
            )
    except Exception:
        # Event logging must never block the call
        pass


async def _save_transcript(state: dict, speaker: str, text: str, language: str, confidence: Optional[float]) -> None:
    if not state["transcript_enabled"]:
        return
    state["transcript_sequence"] += 1
    seq = state["transcript_sequence"]
    ms = int((time.time() - state["started_at"]) * 1000)
    payload = {
        "sequence": seq,
        "speaker": speaker,
        "text": text,
        "language": language,
        "confidence": confidence,
        "started_at_ms": ms,
    }
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            await client.post(
                f"{CONVERSATION_SERVICE_URL}/internal/web-calls/{state['call_id']}/transcripts",
                json=payload,
                headers={"x-tenant-id": state["tenant_id"] or ""},
            )
        except Exception as e:
            logger.warn("transcript_save_failed", err=str(e))


async def _save_recording(state: dict, kind: str, audio: bytes, mime: str) -> Optional[str]:
    if not audio:
        return None
    RECORDINGS_ROOT.mkdir(parents=True, exist_ok=True)
    ext = "webm" if "webm" in mime else "mp3" if "mpeg" in mime or "mp3" in mime else "wav"
    fname = f"{state['call_id']}_{kind}.{ext}"
    path = RECORDINGS_ROOT / fname
    try:
        with open(path, "wb") as f:
            f.write(audio)
    except Exception as e:
        logger.warn("recording_write_failed", err=str(e))
        return None

    public_url = f"/api/v1/web-calls/{state['call_id']}/recording?kind={kind}"
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            await client.post(
                f"{CONVERSATION_SERVICE_URL}/internal/web-calls/{state['call_id']}/recordings",
                json={
                    "kind": kind,
                    "file_path": str(path),
                    "public_url": public_url,
                    "mime_type": mime,
                    "size_bytes": len(audio),
                },
                headers={"x-tenant-id": state["tenant_id"] or ""},
            )
        except Exception as e:
            logger.warn("recording_register_failed", err=str(e))
    return public_url


async def _end_call(ws: WebSocket, state: dict, reason: str) -> None:
    if state.get("_ended"):
        return
    state["_ended"] = True

    duration = int(time.time() - state["started_at"])

    # Flush recordings
    if state["recording_enabled"]:
        user_bytes = b"".join(state["user_audio_chunks"])
        agent_bytes = b"".join(state["agent_audio_chunks"])
        if user_bytes:
            url = await _save_recording(state, "user", user_bytes, state["user_audio_mime"])
            if url:
                try:
                    await ws.send_json({"type": "recording_saved", "kind": "user", "url": url})
                except Exception:
                    pass
                await _log_event(state, "out", "recording_saved", {"kind": "user", "url": url, "size": len(user_bytes)})
        if agent_bytes:
            url = await _save_recording(state, "agent", agent_bytes, state["agent_audio_mime"])
            if url:
                try:
                    await ws.send_json({"type": "recording_saved", "kind": "agent", "url": url})
                except Exception:
                    pass
                await _log_event(state, "out", "recording_saved", {"kind": "agent", "url": url, "size": len(agent_bytes)})
        # Register the user file as the default 'mixed' playback target until
        # we wire a real audio mixer.
        if user_bytes:
            async with httpx.AsyncClient(timeout=5.0) as client:
                try:
                    await client.post(
                        f"{CONVERSATION_SERVICE_URL}/internal/web-calls/{state['call_id']}/recordings",
                        json={
                            "kind": "mixed",
                            "file_path": str(RECORDINGS_ROOT / f"{state['call_id']}_user.{('webm' if 'webm' in state['user_audio_mime'] else 'wav')}"),
                            "public_url": f"/api/v1/web-calls/{state['call_id']}/recording?kind=mixed",
                            "mime_type": state["user_audio_mime"],
                            "size_bytes": len(user_bytes),
                        },
                        headers={"x-tenant-id": state["tenant_id"] or ""},
                    )
                except Exception:
                    pass

    # Mark session ended — flip transcript_status based on what actually got
    # stored. (The REST layer will see DONE/EMPTY so the UI can render the
    # right status pill without querying counts.)
    transcript_status = "DONE" if state.get("transcript_sequence", 0) > 0 else "EMPTY"
    await _update_session(state["call_id"], state["tenant_id"], {
        "status": "ENDED",
        "ended_at": "now",
        "duration_seconds": duration,
        "end_reason": reason,
        "transcript_status": transcript_status,
    })

    try:
        await ws.send_json({"type": "call_ended", "reason": reason, "duration_seconds": duration})
    except Exception:
        pass
    await _log_event(state, "system", "call_ended", {"reason": reason, "duration_seconds": duration})

    # Trigger analysis asynchronously; notify client when done
    asyncio.create_task(_run_analysis_and_notify(ws, state))


async def _run_analysis_and_notify(ws: WebSocket, state: dict) -> None:
    async with httpx.AsyncClient(timeout=45.0) as client:
        try:
            r = await client.post(
                f"{CONVERSATION_SERVICE_URL}/internal/web-calls/{state['call_id']}/analyze",
                headers={"x-tenant-id": state["tenant_id"] or ""},
            )
            if r.status_code == 200:
                try:
                    await ws.send_json({"type": "analysis_ready", "analysis": r.json()})
                except Exception:
                    pass
                await _log_event(state, "out", "analysis_ready")
        except Exception as e:
            logger.warn("analyze_trigger_failed", err=str(e))
            await _log_event(state, "system", "analyze_trigger_failed", {"error": str(e)[:200]})
