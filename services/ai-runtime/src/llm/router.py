from .base import LLMProvider
from .openai_provider import OpenAIProvider
from .anthropic_provider import AnthropicProvider
from .gemini_provider import GeminiProvider


class LLMRouter:
    """Selects the appropriate LLM provider based on agent configuration."""

    def __init__(self):
        self._providers: dict[str, LLMProvider] = {
            "openai": OpenAIProvider(),
            "anthropic": AnthropicProvider(),
            "gemini": GeminiProvider(),
        }

    def get_provider(self, provider_name: str) -> LLMProvider:
        provider = self._providers.get(provider_name)
        if not provider:
            raise ValueError(
                f"Unknown LLM provider: {provider_name}. "
                f"Available: {list(self._providers.keys())}"
            )
        return provider

    def register_provider(self, name: str, provider: LLMProvider):
        self._providers[name] = provider
