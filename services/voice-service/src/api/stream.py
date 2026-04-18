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

    Client sends audio chunks, server sends back TTS audio and transcripts.
    """
    await websocket.accept()
    logger.info("ws_connected", agent_id=agent_id, conversation_id=conversation_id)

    pipeline = VoicePipeline(agent_id=agent_id, conversation_id=conversation_id)

    try:
        await pipeline.start()

        while True:
            data = await websocket.receive_bytes()
            results = await pipeline.process_audio_chunk(data)

            for result in results:
                if result["type"] == "transcript":
                    await websocket.send_text(json.dumps(result))
                elif result["type"] == "audio":
                    await websocket.send_bytes(result["data"])
                elif result["type"] == "event":
                    await websocket.send_text(json.dumps(result))

    except WebSocketDisconnect:
        logger.info("ws_disconnected", conversation_id=conversation_id)
    finally:
        await pipeline.stop()
