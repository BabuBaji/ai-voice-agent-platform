"""WebSocket endpoint for the Twilio Media Streams bridge.

The telephony-adapter connects here once per active call and forwards Twilio's
JSON messages. We run a TwilioPipeline and push back outbound events.
"""
import asyncio
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

from common import get_logger
from ..pipeline.twilio_pipeline import TwilioPipeline

router = APIRouter()
logger = get_logger("voice-ws-audio")


@router.websocket("/ws/audio")
async def ws_audio(
    websocket: WebSocket,
    callSid: str = Query(""),
    conversationId: str = Query(""),
    agentId: str = Query(""),
    tenantId: str = Query(""),
):
    """Bridge between telephony-adapter and the call conversation pipeline.

    Incoming (from telephony-adapter):
      { "type": "audio_in", "audio": "<base64 mulaw>", ... }
      { "type": "stream_ended" }

    Outgoing (to telephony-adapter):
      { "type": "audio_out", "audio": "<base64 mulaw>" }
      { "type": "event", "event": "user_transcript" | "agent_reply" | "tts_complete", "data": {...} }
    """
    await websocket.accept()
    logger.info(
        "ws_audio_connected",
        call_sid=callSid,
        conversation_id=conversationId,
        agent_id=agentId,
    )

    if not (agentId and tenantId and conversationId):
        logger.warning("ws_audio_missing_params", call_sid=callSid)
        await websocket.close(code=4000)
        return

    pipeline = TwilioPipeline(
        call_sid=callSid,
        conversation_id=conversationId,
        agent_id=agentId,
        tenant_id=tenantId,
    )
    await pipeline.start()

    async def pump_outbound():
        try:
            async for event in pipeline:
                try:
                    await websocket.send_text(json.dumps(event))
                except Exception:
                    break
        except Exception as e:
            logger.warning("pump_outbound_error", error=str(e))

    outbound_task = asyncio.create_task(pump_outbound())

    try:
        while True:
            try:
                raw = await websocket.receive_text()
            except WebSocketDisconnect:
                break

            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            mtype = msg.get("type", "")
            if mtype == "audio_in":
                audio_b64 = msg.get("audio")
                if audio_b64:
                    await pipeline.push_mulaw(audio_b64)
            elif mtype == "stream_ended":
                break
            # other message types ignored
    finally:
        await pipeline.stop()
        outbound_task.cancel()
        try:
            await outbound_task
        except (asyncio.CancelledError, Exception):
            pass
        try:
            await websocket.close()
        except Exception:
            pass
        logger.info("ws_audio_closed", call_sid=callSid, conversation_id=conversationId)
