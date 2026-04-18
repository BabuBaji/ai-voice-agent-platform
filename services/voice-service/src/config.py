from common.config import Settings


class VoiceServiceSettings(Settings):
    service_name: str = "voice-service"
    port: int = 8001

    # STT
    default_stt_provider: str = "deepgram"
    stt_language: str = "en"
    stt_sample_rate: int = 16000

    # TTS
    default_tts_provider: str = "elevenlabs"
    default_tts_voice_id: str = "21m00Tcm4TlvDq8ikWAM"  # ElevenLabs "Rachel"
    tts_model: str = "eleven_turbo_v2"

    # Audio pipeline
    vad_threshold: float = 0.5
    audio_chunk_ms: int = 20
    interruption_threshold_ms: int = 500

    # AI Runtime connection
    ai_runtime_url: str = "http://localhost:8000"


settings = VoiceServiceSettings()
