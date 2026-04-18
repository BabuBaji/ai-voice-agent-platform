from typing import Any, AsyncGenerator, Optional

from .base import LLMProvider


class AnthropicProvider(LLMProvider):
    """Anthropic Claude provider - stub implementation."""

    async def chat_completion(
        self,
        messages: list[dict[str, str]],
        model: str = "claude-sonnet-4-20250514",
        temperature: float = 0.7,
        max_tokens: int = 4096,
        tools: Optional[list[dict[str, Any]]] = None,
    ) -> AsyncGenerator[dict[str, Any], None]:
        # TODO: implement with anthropic SDK
        yield {
            "delta": {
                "content": "[Anthropic provider not yet implemented]",
                "role": "assistant",
            },
            "finish_reason": "stop",
        }
