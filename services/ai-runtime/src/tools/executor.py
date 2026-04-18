from typing import Any

from common import get_logger
from ..models import ToolExecuteResponse
from .registry import registry

logger = get_logger("tool-executor")


class ToolExecutor:
    """Executes registered tools by name with parameter validation."""

    async def execute(
        self,
        tool_name: str,
        parameters: dict[str, Any],
        conversation_id: str,
    ) -> ToolExecuteResponse:
        """Look up tool in registry, execute it, and return the result."""
        tool = registry.get(tool_name)
        if not tool:
            logger.warning("tool_not_found", tool=tool_name)
            return ToolExecuteResponse(
                tool_name=tool_name,
                result={},
                success=False,
                error=f"Tool '{tool_name}' not found. Available tools: {[t['function']['name'] for t in registry.list()]}",
            )

        try:
            logger.info(
                "tool_executing",
                tool=tool_name,
                conversation_id=conversation_id,
                param_keys=list(parameters.keys()),
            )
            result = await tool.fn(**parameters, conversation_id=conversation_id)
            logger.info("tool_executed", tool=tool_name, conversation_id=conversation_id)
            return ToolExecuteResponse(
                tool_name=tool_name,
                result=result if isinstance(result, dict) else {"result": result},
                success=True,
            )
        except TypeError as e:
            logger.error("tool_parameter_error", tool=tool_name, error=str(e))
            return ToolExecuteResponse(
                tool_name=tool_name,
                result={},
                success=False,
                error=f"Invalid parameters for tool '{tool_name}': {str(e)}",
            )
        except Exception as e:
            logger.error("tool_execution_failed", tool=tool_name, error=str(e))
            return ToolExecuteResponse(
                tool_name=tool_name,
                result={},
                success=False,
                error=str(e),
            )
