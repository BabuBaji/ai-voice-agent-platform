from typing import Any, AsyncGenerator, Optional

from .base import LLMProvider


class GeminiProvider(LLMProvider):
    """Google Gemini provider - stub implementation."""

    async def chat_completion(
        self,
        messages: list[dict[str, str]],
        model: str = "gemini-1.5-pro",
        temperature: float = 0.7,
        max_tokens: int = 4096,
        tools: Optional[list[dict[str, Any]]] = None,
    ) -> AsyncGenerator[dict[str, Any], None]:
        # TODO: implement with google-generativeai SDK
        yield {
            "delta": {
                "content": "[Gemini provider not yet implemented]",
                "role": "assistant",
            },
            "finish_reason": "stop",
        }
