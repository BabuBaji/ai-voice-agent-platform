from typing import Any, AsyncGenerator, Optional

from openai import AsyncOpenAI

from .base import LLMProvider
from ..config import settings

from common import get_logger

logger = get_logger("openai-provider")


class OpenAIProvider(LLMProvider):
    """OpenAI chat completion provider using the openai SDK with streaming."""

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

        logger.info("openai_stream_start", model=model, message_count=len(messages))

        stream = await self.client.chat.completions.create(**kwargs)

        accumulated_tool_calls: dict[int, dict[str, Any]] = {}

        async for chunk in stream:
            choice = chunk.choices[0] if chunk.choices else None
            if not choice:
                continue

            delta = choice.delta

            # Handle content streaming
            if delta.content:
                yield {
                    "type": "content",
                    "content": delta.content,
                }

            # Handle tool calls streaming
            if delta.tool_calls:
                for tc in delta.tool_calls:
                    idx = tc.index
                    if idx not in accumulated_tool_calls:
                        accumulated_tool_calls[idx] = {
                            "id": tc.id or "",
                            "type": "function",
                            "function": {
                                "name": tc.function.name or "" if tc.function else "",
                                "arguments": "",
                            },
                        }
                    else:
                        if tc.id:
                            accumulated_tool_calls[idx]["id"] = tc.id
                        if tc.function and tc.function.name:
                            accumulated_tool_calls[idx]["function"]["name"] = tc.function.name

                    if tc.function and tc.function.arguments:
                        accumulated_tool_calls[idx]["function"]["arguments"] += tc.function.arguments

                yield {
                    "type": "tool_call_delta",
                    "data": [tc.model_dump() for tc in delta.tool_calls],
                }

            # Handle finish reason
            if choice.finish_reason:
                finish_data: dict[str, Any] = {
                    "type": "finish",
                    "finish_reason": choice.finish_reason,
                }
                if accumulated_tool_calls:
                    finish_data["tool_calls"] = list(accumulated_tool_calls.values())
                yield finish_data

        logger.info("openai_stream_end", model=model)
