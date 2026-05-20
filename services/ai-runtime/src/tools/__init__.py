"""Tools package — importing `builtin` here triggers the side-effect
registration calls in `builtin/__init__.py` so every tool (calendar_booking,
crm_lookup, transfer_call, send_sms, …) is in the registry by the time the
FastAPI app starts. Without this import the registry stays empty at runtime
and every /tools/execute call returns tool_not_found."""

from . import builtin  # noqa: F401  (import-for-side-effects)

__all__: list[str] = []
