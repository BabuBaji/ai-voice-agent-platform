import json
from typing import Any

from fastapi import APIRouter, Request
from sse_starlette.sse import EventSourceResponse

from common import get_logger
from ..models import ChatCompletionRequest
from ..llm.router import LLMRouter
from ..rag.pipeline import RAGPipeline
from ..rag.context_builder import ContextBuilder
from ..tools.executor import ToolExecutor
from ..tools.registry import registry
from ..config import settings

router = APIRouter()
llm_router = LLMRouter()
rag_pipeline = RAGPipeline()
context_builder = ContextBuilder()
tool_executor = ToolExecutor()

logger = get_logger("chat-api")


async def _build_messages_with_rag(
    request: ChatCompletionRequest,
) -> list[dict[str, str]]:
    """Build the final message list with RAG context injected if applicable."""
    messages = [{"role": m.role, "content": m.content} for m in request.messages]

    # If knowledge_base_ids are provided, run RAG to get relevant context
    kb_ids = request.context.knowledge_base_ids
    if kb_ids:
        # Use the last user message as query
        user_query = ""
        for msg in reversed(messages):
            if msg["role"] == "user":
                user_query = msg["content"]
                break

        if user_query:
            try:
                rag_context = await rag_pipeline.build_context(
                    query=user_query,
                    knowledge_base_ids=kb_ids,
                    top_k=settings.rag_top_k,
                )
                if rag_context:
                    # Inject RAG context as a system message
                    messages.insert(0, {
                        "role": "system",
                        "content": rag_context,
                    })
                    logger.info("rag_context_injected", query_length=len(user_query), kb_ids=kb_ids)
            except Exception as e:
                logger.warning("rag_context_failed", error=str(e))

    return messages


async def _handle_tool_calls(
    tool_calls: list[dict[str, Any]],
    conversation_id: str,
) -> list[dict[str, str]]:
    """Execute tool calls and return tool result messages."""
    tool_messages: list[dict[str, str]] = []

    for tc in tool_calls:
        tool_name = tc["function"]["name"]
        try:
            arguments = json.loads(tc["function"]["arguments"])
        except (json.JSONDecodeError, KeyError):
            arguments = {}

        logger.info("executing_tool", tool=tool_name, conversation_id=conversation_id)

        result = await tool_executor.execute(
            tool_name=tool_name,
            parameters=arguments,
            conversation_id=conversation_id,
        )

        tool_messages.append({
            "role": "tool",
            "content": json.dumps(result.result if result.success else {"error": result.error}),
            "tool_call_id": tc.get("id", ""),
        })

    return tool_messages


async def _stream_response(request: ChatCompletionRequest):
    """Stream LLM response as SSE events, handling tool calls inline."""
    provider_name = request.context.agent_config.get("llm_provider", settings.default_llm_provider)
    provider = llm_router.get_provider(provider_name)
    model = request.context.agent_config.get("model", settings.default_model)
    temperature = request.context.agent_config.get("temperature", settings.default_temperature)
    max_tokens = request.context.agent_config.get("max_tokens", settings.default_max_tokens)

    messages = await _build_messages_with_rag(request)

    # Get available tools for the LLM
    available_tools = registry.list() or None

    # Allow up to 5 rounds of tool calling
    max_tool_rounds = 5

    for round_idx in range(max_tool_rounds + 1):
        full_content = ""
        pending_tool_calls: list[dict[str, Any]] = []
        finish_reason = "stop"

        async for chunk in provider.chat_completion(
            messages=messages,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            tools=available_tools,
        ):
            chunk_type = chunk.get("type", "")

            if chunk_type == "content":
                full_content += chunk.get("content", "")
                yield {"data": json.dumps(chunk)}

            elif chunk_type == "tool_call":
                # Anthropic/Gemini style: complete tool calls
                pending_tool_calls.extend(chunk.get("tool_calls", []))
                yield {"data": json.dumps({"type": "tool_call", "data": chunk.get("tool_calls", [])})}

            elif chunk_type == "tool_call_delta":
                # OpenAI style: streaming tool call deltas (informational)
                yield {"data": json.dumps({"type": "tool_call_delta", "data": chunk.get("data", [])})}

            elif chunk_type == "finish":
                finish_reason = chunk.get("finish_reason", "stop")
                if chunk.get("tool_calls"):
                    pending_tool_calls = chunk["tool_calls"]

        # If the LLM wants to call tools, execute them and loop
        if pending_tool_calls and finish_reason in ("tool_calls", "stop"):
            # Add assistant message with the tool calls
            assistant_msg: dict[str, Any] = {"role": "assistant", "content": full_content or ""}
            if provider_name == "openai":
                assistant_msg["tool_calls"] = pending_tool_calls
            messages.append(assistant_msg)

            # Execute tools and add results
            tool_result_messages = await _handle_tool_calls(
                pending_tool_calls, request.conversation_id
            )
            messages.extend(tool_result_messages)

            yield {"data": json.dumps({
                "type": "tool_results",
                "results": [json.loads(m["content"]) for m in tool_result_messages],
            })}

            pending_tool_calls = []
            continue
        else:
            # No more tool calls, we're done
            break

    yield {"data": "[DONE]"}


@router.post("/chat/completions")
async def chat_completions(request: ChatCompletionRequest):
    """Streaming chat completion with RAG and tool calling support."""
    logger.info(
        "chat_request",
        agent_id=request.agent_id,
        conversation_id=request.conversation_id,
        message_count=len(request.messages),
    )
    return EventSourceResponse(_stream_response(request))


@router.post("/chat/simple")
async def simple_chat(request: Request):
    """Non-streaming chat for service-to-service calls.
    Falls back to mock provider if the real provider fails.
    """
    body = await request.json()

    system_prompt = body.get("system_prompt", "You are a helpful assistant.")
    messages = body.get("messages", [])
    provider = body.get("provider", "openai")
    model = body.get("model", "gpt-4o")
    temperature = body.get("temperature", 0.7)
    max_tokens = body.get("max_tokens", 4096)

    full_messages = [{"role": "system", "content": system_prompt}] + messages

    used_provider = provider
    used_mock = False

    async def _collect_response(llm, mdl):
        result = ""
        async for chunk in llm.chat_completion(
            messages=full_messages,
            model=mdl,
            temperature=temperature,
            max_tokens=max_tokens,
        ):
            if chunk.get("type") == "content" and chunk.get("content"):
                content = chunk["content"]
                # Check for error markers from providers
                if content.startswith("[") and "error" in content.lower():
                    raise RuntimeError(content)
                result += content
        return result

    # Try the requested provider first
    try:
        llm = llm_router.get_provider(provider)
        full_response = await _collect_response(llm, model)
    except Exception as e:
        # Fallback to mock provider
        logger.warn("provider_failed_fallback_to_mock", provider=provider, error=str(e))
        mock_llm = llm_router.get_provider("mock")
        full_response = await _collect_response(mock_llm, "mock-v1")
        used_provider = "mock"
        used_mock = True

    return {
        "reply": full_response,
        "provider": used_provider,
        "model": model if not used_mock else "mock-v1",
        "mock": used_mock,
    }
