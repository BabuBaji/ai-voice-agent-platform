import asyncio
import json
from typing import Any, AsyncGenerator

import httpx
import websockets

from common import get_logger
from ..config import settings
from .base import STTProvider

logger = get_logger("deepgram-stt")

DEEPGRAM_REST_URL = "https://api.deepgram.com/v1/listen"
DEEPGRAM_WS_URL = "wss://api.deepgram.com/v1/listen"


class DeepgramProvider(STTProvider):
    """Deepgram STT implementation using REST API for batch and WebSocket for streaming."""

    def __init__(self):
        self.api_key = settings.deepgram_api_key

    async def transcribe(self, audio: bytes, language: str = "en") -> dict[str, Any]:
        """Batch transcription using Deepgram REST API."""
        logger.info("transcribe_batch", audio_size=len(audio), language=language)

        headers = {
            "Authorization": f"Token {self.api_key}",
            "Content-Type": "audio/raw;encoding=linear16;sample_rate=16000;channels=1",
        }
        params = {
            "model": "nova-2",
            "language": language,
            "punctuate": "true",
            "smart_format": "true",
        }

        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                DEEPGRAM_REST_URL,
                content=audio,
                headers=headers,
                params=params,
            )
            resp.raise_for_status()
            data = resp.json()

        result = data.get("results", {}).get("channels", [{}])[0].get("alternatives", [{}])[0]
        transcript = result.get("transcript", "")
        confidence = result.get("confidence", 0.0)
        words = result.get("words", [])

        logger.info("transcribe_batch_done", text_length=len(transcript), confidence=confidence)

        return {
            "text": transcript,
            "confidence": confidence,
            "language": language,
            "words": [
                {
                    "word": w.get("word", ""),
                    "start": w.get("start", 0),
                    "end": w.get("end", 0),
                    "confidence": w.get("confidence", 0),
                }
                for w in words
            ],
        }

    async def stream_transcribe(
        self, audio_stream: AsyncGenerator[bytes, None], language: str = "en"
    ) -> AsyncGenerator[dict[str, Any], None]:
        """Streaming transcription using Deepgram WebSocket API.

        Connects to the Deepgram live transcription WebSocket, feeds audio chunks,
        and yields partial/final transcript results.
        """
        logger.info("transcribe_stream_start", language=language)

        ws_url = (
            f"{DEEPGRAM_WS_URL}"
            f"?model=nova-2"
            f"&language={language}"
            f"&encoding=linear16"
            f"&sample_rate={settings.stt_sample_rate}"
            f"&channels=1"
            f"&punctuate=true"
            f"&interim_results=true"
            f"&endpointing=300"
            f"&vad_events=true"
        )

        extra_headers = {
            "Authorization": f"Token {self.api_key}",
        }

        transcript_queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

        async def _send_audio(ws):
            """Send audio chunks to the WebSocket."""
            try:
                async for chunk in audio_stream:
                    await ws.send(chunk)
                # Signal end of audio
                await ws.send(json.dumps({"type": "CloseStream"}))
            except Exception as e:
                logger.error("stream_send_error", error=str(e))

        async def _receive_transcripts(ws):
            """Receive transcript results from the WebSocket."""
            try:
                async for message in ws:
                    if isinstance(message, bytes):
                        continue

                    data = json.loads(message)
                    msg_type = data.get("type", "")

                    if msg_type == "Results":
                        channel = data.get("channel", {})
                        alt = channel.get("alternatives", [{}])[0]
                        transcript = alt.get("transcript", "")
                        confidence = alt.get("confidence", 0.0)
                        is_final = data.get("is_final", False)

                        if transcript.strip():
                            await transcript_queue.put({
                                "text": transcript,
                                "is_final": is_final,
                                "confidence": confidence,
                                "speech_final": data.get("speech_final", False),
                            })

                    elif msg_type == "SpeechStarted":
                        await transcript_queue.put({
                            "text": "",
                            "is_final": False,
                            "confidence": 0.0,
                            "event": "speech_started",
                        })

                    elif msg_type == "UtteranceEnd":
                        await transcript_queue.put({
                            "text": "",
                            "is_final": True,
                            "confidence": 0.0,
                            "event": "utterance_end",
                        })

            except websockets.exceptions.ConnectionClosed:
                logger.info("deepgram_ws_closed")
            except Exception as e:
                logger.error("stream_receive_error", error=str(e))
            finally:
                await transcript_queue.put(None)

        try:
            async with websockets.connect(
                ws_url,
                additional_headers=extra_headers,
                ping_interval=20,
                ping_timeout=10,
            ) as ws:
                send_task = asyncio.create_task(_send_audio(ws))
                recv_task = asyncio.create_task(_receive_transcripts(ws))

                while True:
                    result = await transcript_queue.get()
                    if result is None:
                        break
                    yield result

                send_task.cancel()
                recv_task.cancel()
                try:
                    await send_task
                except asyncio.CancelledError:
                    pass
                try:
                    await recv_task
                except asyncio.CancelledError:
                    pass

        except Exception as e:
            logger.error("deepgram_stream_error", error=str(e))
            yield {
                "text": "",
                "is_final": True,
                "confidence": 0.0,
                "error": str(e),
            }

        logger.info("transcribe_stream_end")
