/** Canonical model registry: which run rows describe the SAME open-weight
 * model sold at several hosted providers, and therefore collapse into one
 * site row with a multi-provider signal.
 *
 * Policy (see results/README.md, "cross-provider parity"): a provider joins a
 * canonical model only when its measured chrF/chrF++ sit within ~3 points of
 * the primary provider on the same direction and testset. Temperature 0 still
 * leaves real serving-stack variance between providers — different
 * quantization, kernels and snapshot drift (we measured ~0.5 chrF run-to-run
 * nondeterminism on Cloudflare itself, and a 0.05–2.9 chrF spread across
 * three providers for DeepSeek V4 Flash) — so exact equality is not the bar.
 * The primary provider feeds the collapsed row's metrics: the first-party API
 * when measured, else the cheapest listing. Provider entries carry each
 * listing's price so the collapsed cost cell can surface the cheapest route.
 *
 * Models that merely share a family name across providers (kimi-k2.5 vs
 * kimi-k2.6/2.7, gemma-4-31b vs gemma-4-26b-a4b, nemotron-3.5-lightning vs
 * nemotron-3-120b) are different models: they must NOT be listed here.
 */

import type { Cost } from "./pricing.ts";

export interface ProviderListing {
  /** matches the site's provider label (runRow.provider) */
  provider: string;
  /** the exact model id at that provider (run payload.model, pricing key) */
  model_id: string;
  /** list price at that provider; omitted when not verified */
  cost?: Cost;
  /** serving caveats worth surfacing on hover */
  note?: string;
}

export interface CanonicalModel {
  id: string;
  name: string;
  /** whose runs feed the collapsed row's metrics */
  primary: string;
  providers: ProviderListing[];
}

const MODELS_DEV = "models.dev (2026-09-29)";
const CLOUDFLARE = "Cloudflare Workers AI catalogue (2026-09-29/30)";

export const CANONICAL_MODELS: CanonicalModel[] = [
  {
    id: "qwen3-235b-a22b-2507",
    name: "Qwen3 235B A22B",
    primary: "OpenRouter",
    providers: [
      {
        provider: "OpenRouter",
        model_id: "qwen/qwen3-235b-a22b-2507",
        cost: {
          input: 0.0875,
          output: 0.35,
          unit: "M tokens",
          source: MODELS_DEV,
        },
        note: "where the plain-set runs measured",
      },
      {
        provider: "QwenCloud",
        model_id: "qwen3-235b-a22b-instruct-2507",
        note: "first-party serving (instruct-2507 is the same model); price not verified",
      },
    ],
  },
  {
    id: "qwen3.5-397b-a17b",
    name: "Qwen3.5 397B A17B",
    primary: "OpenRouter",
    providers: [
      {
        provider: "OpenRouter",
        model_id: "qwen/qwen3.5-397b-a17b",
        cost: {
          input: 0.55,
          output: 3.5,
          unit: "M tokens",
          source: MODELS_DEV,
        },
      },
      {
        provider: "QwenCloud",
        model_id: "qwen3.5-397b-a17b",
        note: "first-party serving; thinks by default (reasoning_content separated); price not verified",
      },
    ],
  },
  {
    id: "qwen3-30b-a3b",
    name: "Qwen3 30B A3B",
    primary: "OpenRouter",
    providers: [
      {
        provider: "OpenRouter",
        model_id: "qwen/qwen3-30b-a3b-instruct-2507",
        cost: {
          input: 0.04815,
          output: 0.19305,
          unit: "M tokens",
          source: MODELS_DEV,
        },
        note: "full-precision serving",
      },
      {
        provider: "QwenCloud",
        model_id: "qwen3-30b-a3b-instruct-2507",
        note: "first-party, full-precision; price not verified",
      },
    ],
    // Cloudflare's fp8 build is deliberately NOT listed: it measured 5.8 chrF
    // below full precision en→id and stays its own row (see disqualified)
  },
  {
    id: "nemotron-3.5-lightning",
    name: "Nemotron 3.5 Lightning",
    primary: "OpenRouter",
    providers: [
      {
        provider: "OpenRouter",
        model_id: "nvidia/nemotron-3.5-lightning",
        cost: {
          input: 0.06,
          output: 0.16,
          unit: "M tokens",
          source: MODELS_DEV,
        },
      },
      {
        provider: "Cline",
        model_id: "nvidia/nemotron-3.5-lightning:free",
        cost: {
          input: 0,
          output: 0,
          unit: "M tokens",
          source: "Cline free promotion (2026-09-30)",
        },
        note: "free promotion — rotates",
      },
    ],
  },
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    primary: "DeepSeek (official API)",
    providers: [
      {
        provider: "DeepSeek (official API)",
        model_id: "deepseek-flash",
        cost: { input: 0.15, output: 0.6, unit: "M tokens", source: MODELS_DEV },
        note: "first-party serving",
      },
      {
        provider: "OpenRouter",
        model_id: "deepseek/deepseek-v4-flash",
        cost: {
          input: 0.0763,
          output: 0.1526,
          unit: "M tokens",
          source: MODELS_DEV,
        },
        note: "cheapest listing",
      },
      {
        provider: "Cloudflare Workers AI",
        model_id: "@cf/deepseek-ai/deepseek-v4-flash-0731",
        cost: { input: 0.44, output: 1.32, unit: "M tokens", source: CLOUDFLARE },
        note: "2026-07-31 snapshot",
      },
    ],
  },
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    primary: "DeepSeek (official API)",
    providers: [
      {
        provider: "DeepSeek (official API)",
        model_id: "deepseek-v4-pro",
        cost: { input: 0.435, output: 0.87, unit: "M tokens", source: MODELS_DEV },
        note: "first-party serving",
      },
      {
        provider: "Cloudflare Workers AI",
        model_id: "@cf/deepseek-ai/deepseek-v4-pro-0813",
        cost: { input: 1.32, output: 3.96, unit: "M tokens", source: CLOUDFLARE },
        note: "2026-08-13 snapshot",
      },
    ],
  },
  {
    id: "glm-5.3-flash",
    name: "GLM 5.3 Flash",
    primary: "Cloudflare Workers AI",
    providers: [
      {
        provider: "Cloudflare Workers AI",
        model_id: "@cf/zai-org/glm-5.3-flash",
        cost: { input: 0.15, output: 0.5, unit: "M tokens", source: CLOUDFLARE },
        note: "reasoning always on at this host",
      },
      {
        provider: "OpenRouter",
        model_id: "z-ai/glm-5.3-flash",
        cost: { input: 0.15, output: 0.5, unit: "M tokens", source: MODELS_DEV },
        note: "reasoning mandated by the endpoint",
      },
    ],
  },
  // qwen3-30b is deliberately NOT canonical: Cloudflare's fp8 build measured
  // 5.8 chrF below OpenRouter's full-precision serving en→id (67.84 vs 73.65)
  // — quantization damage beyond the parity band, so the rows stay separate.
];

export function canonicalFor(modelId: string): CanonicalModel | undefined {
  return CANONICAL_MODELS.find((m) =>
    m.providers.some((p) => p.model_id === modelId)
  );
}

/** human display names for the providers that appear in results/ — the site
 * renders these verbatim everywhere (badges, tooltips, footnotes); the
 * registry keys and runRow.provider may carry qualifiers ("official API")
 * that the display name drops */
export const PROVIDER_DISPLAY: Record<string, string> = {
  OpenRouter: "OpenRouter",
  "DeepSeek (official API)": "DeepSeek",
  "Cloudflare Workers AI": "Cloudflare",
  QwenCloud: "QwenCloud",
  Cline: "Cline",
  "Kagi Translate": "Kagi Translate",
  "Ollama (local)": "Ollama (local)",
};

export function providerDisplay(provider: string): string {
  return PROVIDER_DISPLAY[provider] ?? provider;
}
