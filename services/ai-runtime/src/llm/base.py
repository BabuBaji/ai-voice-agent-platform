from abc import ABC, abstractmethod
from typing import Any, AsyncGenerator, Optional


class LLMProvider(ABC):
    """Abstract base class for LLM provider integrations."""

    @abstractmethod
    async def chat_completion(
        self,
        messages: list[dict[str, str]],
        model: str,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        tools: Optional[list[dict[str, Any]]] = None,
    ) -> AsyncGenerator[dict[str, Any], None]:
        """Stream chat completion responses.

        Yields dicts with structure:
            {"delta": {"content": "...", "role": "assistant"}, "finish_reason": None}
        Final chunk:
            {"delta": {}, "finish_reason": "stop"}
        """
        ...
