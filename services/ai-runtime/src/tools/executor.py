from typing import Any

from common import get_logger
from ..models import ToolExecuteResponse
from .registry import registry

logger = get_logger("tool-executor")


class ToolExecutor:
    """Executes registered tools by name."""

    async def execute(
        self,
        tool_name: str,
        parameters: dict[str, Any],
        conversation_id: str,
    ) -> ToolExecuteResponse:
        tool = registry.get(tool_name)
        if not tool:
            return ToolExecuteResponse(
                tool_name=tool_name,
                result={},
                success=False,
                error=f"Tool '{tool_name}' not found",
            )

        try:
            result = await tool.fn(**parameters, conversation_id=conversation_id)
            logger.info("tool_executed", tool=tool_name, conversation_id=conversation_id)
            return ToolExecuteResponse(
                tool_name=tool_name,
                result=result,
                success=True,
            )
        except Exception as e:
            logger.error("tool_execution_failed", tool=tool_name, error=str(e))
            return ToolExecuteResponse(
                tool_name=tool_name,
                result={},
                success=False,
                error=str(e),
            )
