from common import get_logger

from .base import LLMProvider
from .openai_provider import OpenAIProvider
from .anthropic_provider import AnthropicProvider
from .gemini_provider import GeminiProvider

logger = get_logger("llm-router")


class LLMRouter:
    """Selects the appropriate LLM provider based on provider name string.

    Providers are lazily instantiated on first use to avoid creating
    API clients for providers that won't be used.
    """

    def __init__(self):
        self._providers: dict[str, LLMProvider] = {}
        self._factories: dict[str, type[LLMProvider]] = {
            "openai": OpenAIProvider,
            "anthropic": AnthropicProvider,
            "gemini": GeminiProvider,
        }

    def get_provider(self, provider_name: str) -> LLMProvider:
        """Get an LLM provider by name, creating it if necessary."""
        provider_name = provider_name.lower().strip()

        if provider_name not in self._providers:
            factory = self._factories.get(provider_name)
            if not factory:
                raise ValueError(
                    f"Unknown LLM provider: {provider_name}. "
                    f"Available: {list(self._factories.keys())}"
                )
            logger.info("initializing_provider", provider=provider_name)
            self._providers[provider_name] = factory()

        return self._providers[provider_name]

    def register_provider(self, name: str, provider: LLMProvider):
        """Register a custom provider instance."""
        self._providers[name] = provider

    def list_providers(self) -> list[str]:
        """Return list of available provider names."""
        return list(self._factories.keys())
