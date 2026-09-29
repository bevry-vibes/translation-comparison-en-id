"""Provider manifest: the single source of truth for hosted-gateway metadata.

Consumed by `eval/run_eval.py` (backend factory), `eval/build_site_data.py`
(provider labels + per-run replication objects) and documented in
`scripts/run-providers.sh` (keep its MODELS list in sync with OPENAI_MODELS).

Chat-kwargs are the gateway-specific request merges (reasoning switches etc.);
`max_tokens` is sent because OpenRouter preflights credit checks against the
model's full output ceiling when the field is absent (HTTP 402 on a funded key).
4096 keeps reasoning-mandatory models (glm-5.3-flash) from spending the whole
budget on reasoning and returning empty content.
"""

from __future__ import annotations

OPENROUTER_REASON_OFF = {"reasoning": {"enabled": False}}
DEEPSEEK_THINK_OFF = {"thinking": {"type": "disabled"}}
GATEWAY_MAX_TOKENS = 4096

# openai-compat gateways keyed by result-label prefix
OPENAI_COMPAT: dict[str, dict] = {
    "or-": {
        "label": "OpenRouter",
        "base_url": "https://openrouter.ai/api/v1",
        "key_env": "OPENROUTER_API_KEY",
        "chat_kwargs": OPENROUTER_REASON_OFF,
        "max_tokens": GATEWAY_MAX_TOKENS,
    },
    "ds-": {
        "label": "DeepSeek (official API)",
        "base_url": "https://api.deepseek.com",
        "key_env": "DEEPSEEK_API_KEY",
        "chat_kwargs": DEEPSEEK_THINK_OFF,
        "max_tokens": GATEWAY_MAX_TOKENS,
    },
    "cl-": {
        "label": "Cline",
        "base_url": "https://api.cline.bot/api/v1",
        "key_env": "CLINE_API_KEY",
        "chat_kwargs": OPENROUTER_REASON_OFF,
        "max_tokens": GATEWAY_MAX_TOKENS,
        "note": "gateway black-holes batch runs; single requests only",
    },
    "oc-": {
        "label": "OpenCode Zen",
        "base_url": "https://opencode.ai/zen/v1",
        "key_env": "OPENCODE_API_KEY",
        "chat_kwargs": {},
        "max_tokens": GATEWAY_MAX_TOKENS,
        "note": "account unfunded; free-tier ids returned unavailable (2026-09-29)",
    },
}

# non-openai backends: replication metadata only (label lives in build_site_data)
BACKENDS: dict[str, dict] = {
    "qwen": {
        "label": "Qwen MT (hosted API)",
        "base_url": "https://maas.qwencloudapi.com/compatible-mode/v1",
        "key_env": "QWENCLOUD_API_KEY",
        "request": "translation_options",
    },
    "cloudflare": {"label": "Cloudflare Workers AI", "hosted": True},
    "cloudflare-chat": {"label": "Cloudflare Workers AI", "hosted": True},
    "cloudflare-deno": {"label": "Cloudflare Workers AI", "hosted": True},
    "kagi": {"label": "Kagi Translate", "hosted": True},
    "ollama": {"label": "Local (Ollama)", "hosted": False},
}


def openai_provider_for(label: str) -> tuple[dict | None, bool]:
    """(manifest entry, is-openai-compat) for a result label prefix, else (None, False)."""
    for prefix, entry in OPENAI_COMPAT.items():
        if label.startswith(prefix):
            return entry, True
    return None, False
