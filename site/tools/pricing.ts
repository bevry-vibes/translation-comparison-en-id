/** List pricing for every model in results/: USD per million tokens, input
 * then output. Aggregated 2026-09-29 from models.dev (the OpenRouter and
 * DeepSeek slugs), the Cloudflare Workers AI catalogue API (absent from
 * models.dev), and Alibaba Model Studio's pricing page for the QwenCloud legs
 * (qwen-mt-turbo is an aggregator snapshot — the model retires 2026-10-10).
 * Kagi Translate bills per million characters, not tokens. Local ollama rows
 * cost nothing but electricity. Prices drift — re-verify against the sources
 * before any spending decision.
 */

export interface Cost {
  /** USD per million input tokens (characters for Kagi) */
  input: number
  /** USD per million output tokens; null when output is not billed separately */
  output: number | null
  unit: "M tokens" | "M characters"
  source: string
}

const MODELS_DEV = "models.dev (2026-09-29)";
const CLOUDFLARE = "Cloudflare Workers AI catalogue (2026-09-29/30)";
const ALIBABA = "Alibaba Model Studio (2026-09-29)";

export const PRICING: Record<string, Cost> = {
  // OpenRouter slugs, via models.dev
  "qwen/qwen3-235b-a22b-2507": { input: 0.0875, output: 0.35, unit: "M tokens", source: MODELS_DEV },
  "qwen/qwen3-30b-a3b-instruct-2507": {
    input: 0.04815,
    output: 0.19305,
    unit: "M tokens",
    source: MODELS_DEV,
  },
  "google/gemma-4-31b-it": { input: 0.09, output: 0.34, unit: "M tokens", source: MODELS_DEV },
  "nvidia/nemotron-3.5-lightning": { input: 0.06, output: 0.16, unit: "M tokens", source: MODELS_DEV },
  "deepseek/deepseek-v4-flash": { input: 0.0763, output: 0.1526, unit: "M tokens", source: MODELS_DEV },
  "qwen/qwen3.5-397b-a17b": { input: 0.55, output: 3.5, unit: "M tokens", source: MODELS_DEV },
  "z-ai/glm-5.3-flash": { input: 0.15, output: 0.5, unit: "M tokens", source: MODELS_DEV },
  "moonshotai/kimi-k2.5": { input: 0.45, output: 2.25, unit: "M tokens", source: MODELS_DEV },
  "z-ai/glm-5": { input: 0.6, output: 1.92, unit: "M tokens", source: MODELS_DEV },
  // DeepSeek official API, via models.dev
  "deepseek-flash": { input: 0.15, output: 0.6, unit: "M tokens", source: MODELS_DEV },
  "deepseek-v4-pro": { input: 0.435, output: 0.87, unit: "M tokens", source: MODELS_DEV },
  // Cloudflare, via its own catalogue API (re-queried 2026-09-30 for the
  // deepseek/qwen additions)
  "@cf/zai-org/glm-4.7-flash": { input: 0.0605, output: 0.4, unit: "M tokens", source: CLOUDFLARE },
  "@cf/zai-org/glm-5.3-flash": { input: 0.15, output: 0.5, unit: "M tokens", source: CLOUDFLARE },
  "@cf/meta/m2m100-1.2b": { input: 0.342, output: 0.342, unit: "M tokens", source: CLOUDFLARE },
  "@cf/deepseek-ai/deepseek-v4-flash-0731": {
    input: 0.44,
    output: 1.32,
    unit: "M tokens",
    source: CLOUDFLARE,
  },
  "@cf/deepseek-ai/deepseek-v4-pro-0813": {
    input: 1.32,
    output: 3.96,
    unit: "M tokens",
    source: CLOUDFLARE,
  },
  "@cf/qwen/qwen3-30b-a3b-fp8": { input: 0.0509, output: 0.335, unit: "M tokens", source: CLOUDFLARE },
  // QwenCloud legs, via Alibaba Model Studio
  "qwen-flash": { input: 0.05, output: 0.4, unit: "M tokens", source: ALIBABA },
  "qwen3.5-flash": { input: 0.1, output: 0.4, unit: "M tokens", source: ALIBABA },
  "qwen3.6-flash": { input: 0.165, output: 0.99, unit: "M tokens", source: ALIBABA },
  "qwen-mt-turbo": {
    input: 0.16,
    output: 0.49,
    unit: "M tokens",
    source: "aggregator snapshot (retires 2026-10-10)",
  },
  "qwen-mt-flash": { input: 0.101, output: 0.28, unit: "M tokens", source: ALIBABA },
  "qwen-mt-plus": { input: 0.259, output: 0.775, unit: "M tokens", source: ALIBABA },
  "qwen-mt-lite": { input: 0.086, output: 0.229, unit: "M tokens", source: ALIBABA },
  // Cline free-promotion ids (zero-metered at the gateway, 2026-09-30); the
  // promos rotate, so re-verify before any paid-model leg — no credits held
  "z-ai/glm-5.3-prime": {
    input: 0,
    output: 0,
    unit: "M tokens",
    source: "Cline free promotion (2026-09-30)",
  },
  "xiaomi/mimo-v2.6-flash": {
    input: 0,
    output: 0,
    unit: "M tokens",
    source: "Cline free promotion (2026-09-30)",
  },
  "cohere/command-a-plus": {
    input: 0,
    output: 0,
    unit: "M tokens",
    source: "Cline free promotion (2026-09-30)",
  },
  "upstage/solar-mini4": {
    input: 0,
    output: 0,
    unit: "M tokens",
    source: "Cline free promotion (2026-09-30)",
  },
  // non-token billing
  "kagi-translate-web": {
    input: 15,
    output: null,
    unit: "M characters",
    source: "Kagi Translate API (per-character)",
  },
  // local inference
  "Hy-MT2-1.8B": { input: 0, output: 0, unit: "M tokens", source: "local (ollama)" },
  "translategemma:4b": { input: 0, output: 0, unit: "M tokens", source: "local (ollama)" },
};

export function priceOf(model: string): Cost | undefined {
  return PRICING[model];
}
