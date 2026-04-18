from typing import Any, AsyncGenerator, Optional

from openai import AsyncOpenAI

from .base import LLMProvider
from ..config import settings


class OpenAIProvider(LLMProvider):
    """OpenAI chat completion provider using the openai SDK."""

    def __init__(self):
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)

    async def chat_completion(
        self,
        messages: list[dict[str, str]],
        model: str = "gpt-4o",
        temperature: float = 0.7,
        max_tokens: int = 4096,
        tools: Optional[list[dict[str, Any]]] = None,
    ) -> AsyncGenerator[dict[str, Any], None]:
        kwargs: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
        }
        if tools:
            kwargs["tools"] = tools

        stream = await self.client.chat.completions.create(**kwargs)

        async for chunk in stream:
            choice = chunk.choices[0] if chunk.choices else None
            if choice:
                yield {
                    "delta": {
                        "content": choice.delta.content or "",
                        "role": choice.delta.role or "assistant",
                        "tool_calls": (
                            [tc.model_dump() for tc in choice.delta.tool_calls]
                            if choice.delta.tool_calls
                            else None
                        ),
                    },
                    "finish_reason": choice.finish_reason,
                }
