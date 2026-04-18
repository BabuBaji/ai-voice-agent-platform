import json
from fastapi import APIRouter
from sse_starlette.sse import EventSourceResponse

from ..models import ChatCompletionRequest
from ..llm.router import LLMRouter
from ..config import settings

router = APIRouter()
llm_router = LLMRouter()


async def _stream_response(request: ChatCompletionRequest):
    """Stream LLM response as SSE events."""
    provider = llm_router.get_provider(
        request.context.agent_config.get("llm_provider", settings.default_llm_provider)
    )
    messages = [{"role": m.role, "content": m.content} for m in request.messages]
    model = request.context.agent_config.get("model", settings.default_model)

    async for chunk in provider.chat_completion(
        messages=messages,
        model=model,
        temperature=settings.default_temperature,
        max_tokens=settings.default_max_tokens,
    ):
        yield {"data": json.dumps(chunk)}

    yield {"data": "[DONE]"}


@router.post("/chat/completions")
async def chat_completions(request: ChatCompletionRequest):
    return EventSourceResponse(_stream_response(request))
