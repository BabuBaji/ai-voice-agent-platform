from typing import Any, AsyncGenerator, Optional
import json

import httpx

from .base import LLMProvider
from ..config import settings

from common import get_logger

logger = get_logger("gemini-provider")


def _convert_openai_messages_to_gemini(
    messages: list[dict[str, str]],
) -> tuple[str, list[dict[str, Any]]]:
    """Convert OpenAI-format messages to Gemini format.

    Returns (system_instruction, contents).
    """
    system_parts: list[str] = []
    contents: list[dict[str, Any]] = []

    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")

        if role == "system":
            system_parts.append(content)
        elif role == "assistant":
            contents.append({
                "role": "model",
                "parts": [{"text": content}],
            })
        else:
            contents.append({
                "role": "user",
                "parts": [{"text": content}],
            })

    # Gemini requires alternating user/model.
    # Merge consecutive same-role messages.
    merged: list[dict[str, Any]] = []
    for item in contents:
        if merged and merged[-1]["role"] == item["role"]:
            merged[-1]["parts"].extend(item["parts"])
        else:
            merged.append(item)

    if not merged:
        merged = [{"role": "user", "parts": [{"text": "Hello."}]}]

    return "\n".join(system_parts), merged


class GeminiProvider(LLMProvider):
    """Google Gemini provider using the REST API with streaming.

    Uses httpx to call the Gemini generateContent streaming endpoint directly,
    avoiding dependency on the google-generativeai SDK which may not be installed.
    """

    def __init__(self):
        self.api_key = settings.google_ai_api_key
        self.base_url = "https://generativelanguage.googleapis.com/v1beta"

    async def chat_completion(
        self,
        messages: list[dict[str, str]],
        model: str = "gemini-1.5-pro",
        temperature: float = 0.7,
        max_tokens: int = 4096,
        tools: Optional[list[dict[str, Any]]] = None,
    ) -> AsyncGenerator[dict[str, Any], None]:
        system_instruction, contents = _convert_openai_messages_to_gemini(messages)

        request_body: dict[str, Any] = {
            "contents": contents,
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": max_tokens,
            },
        }

        if system_instruction:
            request_body["systemInstruction"] = {
                "parts": [{"text": system_instruction}],
            }

        if tools:
            gemini_tools = self._convert_tools(tools)
            if gemini_tools:
                request_body["tools"] = gemini_tools

        url = f"{self.base_url}/models/{model}:streamGenerateContent?alt=sse&key={self.api_key}"

        logger.info("gemini_stream_start", model=model, message_count=len(contents))

        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream("POST", url, json=request_body) as response:
                if response.status_code != 200:
                    error_body = await response.aread()
                    logger.error("gemini_api_error", status=response.status_code, body=error_body.decode())
                    yield {
                        "type": "content",
                        "content": f"[Gemini API error: {response.status_code}]",
                    }
                    yield {"type": "finish", "finish_reason": "error"}
                    return

                buffer = ""
                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data_str = line[6:]
                    if data_str.strip() == "[DONE]":
                        break

                    try:
                        data = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue

                    candidates = data.get("candidates", [])
                    for candidate in candidates:
                        content_block = candidate.get("content", {})
                        parts = content_block.get("parts", [])
                        for part in parts:
                            if "text" in part:
                                yield {
                                    "type": "content",
                                    "content": part["text"],
                                }
                            elif "functionCall" in part:
                                fc = part["functionCall"]
                                yield {
                                    "type": "tool_call",
                                    "tool_calls": [{
                                        "id": f"call_{fc['name']}",
                                        "type": "function",
                                        "function": {
                                            "name": fc["name"],
                                            "arguments": json.dumps(fc.get("args", {})),
                                        },
                                    }],
                                }

                        finish_reason = candidate.get("finishReason", "")
                        if finish_reason:
                            mapped_reason = "stop"
                            if finish_reason == "MAX_TOKENS":
                                mapped_reason = "length"
                            elif finish_reason == "SAFETY":
                                mapped_reason = "content_filter"
                            yield {
                                "type": "finish",
                                "finish_reason": mapped_reason,
                            }

        logger.info("gemini_stream_end", model=model)

    @staticmethod
    def _convert_tools(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Convert OpenAI tool format to Gemini tool format."""
        function_declarations = []
        for tool in tools:
            if tool.get("type") == "function":
                fn = tool["function"]
                decl: dict[str, Any] = {
                    "name": fn["name"],
                    "description": fn.get("description", ""),
                }
                params = fn.get("parameters")
                if params:
                    decl["parameters"] = params
                function_declarations.append(decl)

        if function_declarations:
            return [{"functionDeclarations": function_declarations}]
        return []
