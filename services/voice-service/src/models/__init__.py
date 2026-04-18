from pydantic import BaseModel, Field
from typing import Optional


class TranscribeRequest(BaseModel):
    audio: bytes
    language: str = "en"
    model: str = "nova-2"


class TranscribeResponse(BaseModel):
    text: str
    confidence: float
    language: str
    duration_seconds: float


class SynthesizeRequest(BaseModel):
    text: str
    voice_id: Optional[str] = None
    model: Optional[str] = None
    output_format: str = "mp3"


class StreamParams(BaseModel):
    agent_id: str
    conversation_id: str
    stt_provider: str = "deepgram"
    tts_provider: str = "elevenlabs"
    voice_id: Optional[str] = None
