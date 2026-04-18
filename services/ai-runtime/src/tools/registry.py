from typing import Any, Callable, Awaitable, Optional


ToolFunction = Callable[..., Awaitable[dict[str, Any]]]


class ToolDefinition:
    def __init__(self, name: str, description: str, parameters_schema: dict, fn: ToolFunction):
        self.name = name
        self.description = description
        self.parameters_schema = parameters_schema
        self.fn = fn


class ToolRegistry:
    """Registry for callable tools available to the LLM."""

    def __init__(self):
        self._tools: dict[str, ToolDefinition] = {}

    def register(
        self,
        name: str,
        description: str,
        parameters_schema: dict,
        fn: ToolFunction,
    ):
        self._tools[name] = ToolDefinition(name, description, parameters_schema, fn)

    def get(self, name: str) -> Optional[ToolDefinition]:
        return self._tools.get(name)

    def list(self) -> list[dict[str, Any]]:
        return [
            {
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.parameters_schema,
                },
            }
            for t in self._tools.values()
        ]


# Global registry instance
registry = ToolRegistry()
