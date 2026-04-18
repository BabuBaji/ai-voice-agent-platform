from fastapi import APIRouter

from common import get_logger
from ..models import ToolExecuteRequest, ToolExecuteResponse
from ..tools.executor import ToolExecutor
from ..tools.registry import registry

router = APIRouter()
executor = ToolExecutor()
logger = get_logger("tools-api")


@router.post("/execute", response_model=ToolExecuteResponse)
async def execute_tool(request: ToolExecuteRequest):
    """Execute a registered tool by name with given parameters."""
    logger.info(
        "tool_execute_request",
        tool=request.tool_name,
        conversation_id=request.conversation_id,
    )
    result = await executor.execute(
        tool_name=request.tool_name,
        parameters=request.parameters,
        conversation_id=request.conversation_id,
    )
    return result


@router.get("/list")
async def list_tools():
    """List all registered tools with their schemas."""
    return {"tools": registry.list()}
