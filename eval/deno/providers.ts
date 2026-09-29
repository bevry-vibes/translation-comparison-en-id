/** Provider manifest: the single source of truth for hosted-gateway metadata.
 *
 * Ported from the original python `eval/providers.py`. Consumed by the harness
 * (`run_eval.ts` defaults from the result-label prefix) and the site's data
 * pipeline (provider labels + per-run replication recipes).
 *
 * Chat-kwargs are the gateway-specific request merges (reasoning switches);
 * `max_tokens` is sent because OpenRouter preflights credit checks against the
 * model's full output ceiling when the field is absent (HTTP 402 on a funded
 * key), and 4096 keeps reasoning-mandatory models (glm-5.3-flash) from
 * spending the whole budget on reasoning and returning empty content.
 */

export const OPENROUTER_REASON_OFF = { reasoning: { enabled: false } };
export const DEEPSEEK_THINK_OFF = { thinking: { type: "disabled" } };
export const GATEWAY_MAX_TOKENS = 4096;

export interface OpenAiProvider {
  label: string;
  base_url: string;
  key_env: string;
  chat_kwargs: Record<string, unknown>;
  max_tokens: number;
  note?: string;
}

// openai-compat gateways keyed by result-label prefix
export const OPENAI_COMPAT: Record<string, OpenAiProvider> = {
  "or-": {
    label: "OpenRouter",
    base_url: "https://openrouter.ai/api/v1",
    key_env: "OPENROUTER_API_KEY",
    chat_kwargs: OPENROUTER_REASON_OFF,
    max_tokens: GATEWAY_MAX_TOKENS,
  },
  "ds-": {
    label: "DeepSeek (official API)",
    base_url: "https://api.deepseek.com",
    key_env: "DEEPSEEK_API_KEY",
    chat_kwargs: DEEPSEEK_THINK_OFF,
    max_tokens: GATEWAY_MAX_TOKENS,
  },
  "cl-": {
    label: "Cline",
    base_url: "https://api.cline.bot/api/v1",
    key_env: "CLINE_API_KEY",
    chat_kwargs: OPENROUTER_REASON_OFF,
    max_tokens: GATEWAY_MAX_TOKENS,
    note: "gateway black-holes batch runs; single requests only",
  },
  "oc-": {
    label: "OpenCode Zen",
    base_url: "https://opencode.ai/zen/v1",
    key_env: "OPENCODE_API_KEY",
    chat_kwargs: {},
    max_tokens: GATEWAY_MAX_TOKENS,
    note: "account unfunded; free-tier ids returned unavailable (2026-09-29)",
  },
};

// non-openai backends: replication metadata only (label lives in the site pipeline)
export const BACKENDS: Record<
  string,
  { label: string; hosted: boolean; base_url?: string; key_env?: string }
> = {
  qwen: {
    label: "Qwen MT (hosted API)",
    hosted: true,
    base_url: "https://maas.qwencloudapi.com/compatible-mode/v1",
    key_env: "QWENCLOUD_API_KEY",
  },
  cloudflare: { label: "Cloudflare Workers AI", hosted: true },
  "cloudflare-chat": { label: "Cloudflare Workers AI", hosted: true },
  kagi: { label: "Kagi Translate", hosted: true },
  ollama: { label: "Local (Ollama)", hosted: false },
};

export function openaiProviderFor(label: string): OpenAiProvider | undefined {
  const prefix = Object.keys(OPENAI_COMPAT).find((p) => label.startsWith(p));
  return prefix ? OPENAI_COMPAT[prefix] : undefined;
}
