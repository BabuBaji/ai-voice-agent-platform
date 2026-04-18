from typing import Any, AsyncGenerator, Optional

import anthropic

from .base import LLMProvider
from ..config import settings

from common import get_logger

logger = get_logger("anthropic-provider")


def _convert_openai_messages_to_anthropic(
    messages: list[dict[str, str]],
) -> tuple[str, list[dict[str, Any]]]:
    """Convert OpenAI-format messages to Anthropic format.

    Returns (system_prompt, messages_list).
    Anthropic expects system as a top-level parameter, not in messages.
    """
    system_prompt = ""
    anthropic_messages: list[dict[str, Any]] = []

    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")

        if role == "system":
            system_prompt += content + "\n"
        elif role == "assistant":
            anthropic_messages.append({"role": "assistant", "content": content})
        else:
            # user, function, tool results all map to user
            anthropic_messages.append({"role": "user", "content": content})

    # Anthropic requires alternating user/assistant messages.
    # Merge consecutive same-role messages.
    merged: list[dict[str, Any]] = []
    for msg in anthropic_messages:
        if merged and merged[-1]["role"] == msg["role"]:
            merged[-1]["content"] += "\n" + msg["content"]
        else:
            merged.append(msg)

    # Ensure messages start with user
    if merged and merged[0]["role"] != "user":
        merged.insert(0, {"role": "user", "content": "Hello."})

    # Ensure we have at least one message
    if not merged:
        merged = [{"role": "user", "content": "Hello."}]

    return system_prompt.strip(), merged


def _convert_openai_tools_to_anthropic(
    tools: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Convert OpenAI tool format to Anthropic tool format."""
    anthropic_tools = []
    for tool in tools:
        if tool.get("type") == "function":
            fn = tool["function"]
            anthropic_tools.append({
                "name": fn["name"],
                "description": fn.get("description", ""),
                "input_schema": fn.get("parameters", {"type": "object", "properties": {}}),
            })
    return anthropic_tools


class AnthropicProvider(LLMProvider):
    """Anthropic Claude provider with streaming support."""

    def __init__(self):
        self.client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

    async def chat_completion(
        self,
        messages: list[dict[str, str]],
        model: str = "claude-sonnet-4-20250514",
        temperature: float = 0.7,
        max_tokens: int = 4096,
        tools: Optional[list[dict[str, Any]]] = None,
    ) -> AsyncGenerator[dict[str, Any], None]:
        system_prompt, anthropic_messages = _convert_openai_messages_to_anthropic(messages)

        kwargs: dict[str, Any] = {
            "model": model,
            "messages": anthropic_messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": True,
        }
        if system_prompt:
            kwargs["system"] = system_prompt
        if tools:
            kwargs["tools"] = _convert_openai_tools_to_anthropic(tools)

        logger.info("anthropic_stream_start", model=model, message_count=len(anthropic_messages))

        async with self.client.messages.stream(**kwargs) as stream:
            current_tool_name = ""
            current_tool_id = ""
            tool_input_json = ""

            async for event in stream:
                if event.type == "content_block_start":
                    block = event.content_block
                    if hasattr(block, "text"):
                        pass  # text block starting
                    elif hasattr(block, "name"):
                        # tool_use block starting
                        current_tool_name = block.name
                        current_tool_id = block.id
                        tool_input_json = ""

                elif event.type == "content_block_delta":
                    delta = event.delta
                    if hasattr(delta, "text") and delta.text:
                        yield {
                            "type": "content",
                            "content": delta.text,
                        }
                    elif hasattr(delta, "partial_json") and delta.partial_json:
                        tool_input_json += delta.partial_json

                elif event.type == "content_block_stop":
                    if current_tool_name:
                        import json
                        try:
                            parsed_input = json.loads(tool_input_json) if tool_input_json else {}
                        except json.JSONDecodeError:
                            parsed_input = {}

                        yield {
                            "type": "tool_call",
                            "tool_calls": [{
                                "id": current_tool_id,
                                "type": "function",
                                "function": {
                                    "name": current_tool_name,
                                    "arguments": json.dumps(parsed_input),
                                },
                            }],
                        }
                        current_tool_name = ""
                        current_tool_id = ""
                        tool_input_json = ""

                elif event.type == "message_stop":
                    pass

            # Emit finish event
            final_message = await stream.get_final_message()
            finish_reason = "stop"
            if final_message.stop_reason == "tool_use":
                finish_reason = "tool_calls"
            elif final_message.stop_reason == "max_tokens":
                finish_reason = "length"

            yield {
                "type": "finish",
                "finish_reason": finish_reason,
            }

        logger.info("anthropic_stream_end", model=model)
