from fastapi import APIRouter

from ..models import ToolExecuteRequest, ToolExecuteResponse
from ..tools.executor import ToolExecutor

router = APIRouter()
executor = ToolExecutor()


@router.post("/execute", response_model=ToolExecuteResponse)
async def execute_tool(request: ToolExecuteRequest):
    result = await executor.execute(
        tool_name=request.tool_name,
        parameters=request.parameters,
        conversation_id=request.conversation_id,
    )
    return result
