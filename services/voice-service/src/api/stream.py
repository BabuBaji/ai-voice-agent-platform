import asyncio
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

from common import get_logger
from ..pipeline.voice_pipeline import VoicePipeline

router = APIRouter()
logger = get_logger("voice-stream")


@router.websocket("/stream")
async def websocket_stream(
    websocket: WebSocket,
    agent_id: str = Query(...),
    conversation_id: str = Query(...),
):
    """Bidirectional audio streaming WebSocket.

    Protocol:
    - Client sends binary audio frames (16-bit PCM, 16kHz mono)
    - Server sends back:
      - Binary frames: TTS audio (MP3)
      - Text frames: JSON events (transcripts, status events)

    JSON event types:
      {"type": "transcript", "text": "...", "is_final": true/false}
      {"type": "event", "event": "response_text", "data": {"text": "..."}}
      {"type": "event", "event": "response_complete", "data": {...}}
      {"type": "event", "event": "interruption", "data": {...}}
    """
    await websocket.accept()
    logger.info("ws_connected", agent_id=agent_id, conversation_id=conversation_id)

    pipeline = VoicePipeline(agent_id=agent_id, conversation_id=conversation_id)

    try:
        await pipeline.start()

        # Send a connected event
        await websocket.send_text(json.dumps({
            "type": "event",
            "event": "connected",
            "data": {
                "agent_id": agent_id,
                "conversation_id": conversation_id,
            },
        }))

        while True:
            # Receive audio data from client
            try:
                data = await asyncio.wait_for(
                    websocket.receive_bytes(),
                    timeout=30.0,
                )
            except asyncio.TimeoutError:
                # Send keepalive ping
                await websocket.send_text(json.dumps({
                    "type": "event",
                    "event": "ping",
                    "data": {},
                }))
                continue

            # Process audio through the pipeline
            results = await pipeline.process_audio_chunk(data)

            # Send results back to client
            for result in results:
                try:
                    if result["type"] == "audio":
                        await websocket.send_bytes(result["data"])
                    else:
                        # transcript, event, etc. - send as JSON text
                        await websocket.send_text(json.dumps(result))
                except Exception as e:
                    logger.error("ws_send_error", error=str(e))
                    break

    except WebSocketDisconnect:
        logger.info("ws_disconnected", conversation_id=conversation_id)
    except Exception as e:
        logger.error("ws_error", error=str(e), conversation_id=conversation_id)
    finally:
        await pipeline.stop()
        logger.info("ws_cleanup_done", conversation_id=conversation_id)
