#!/usr/bin/env -S deno run --allow-read --allow-write
/** Build the results-site data document (the python `eval/build_site_data.py`
 * port). Reads the committed measurements and emits `src/data/results.json`
 * (bundled into the SPA) and `public/data/results.json` (served statically for
 * agents), both generated — never committed.
 *
 * Inputs: results/*.json (one run per file), results/token-survival.json (the
 * scored masked-name matrix from eval/deno/token_survival.ts),
 * docs/recommendation.json, plus the prompt/provider single sources in
 * eval/deno/{prompts,providers}.ts.
 */

import {
  buildPrompt,
  ENGINE_PRESERVE_SYSTEM,
  ENGINE_SYSTEM,
} from "../../eval/deno/prompts.ts";
import { BACKENDS, openaiProviderFor } from "../../eval/deno/providers.ts";
import { priceOf, type Cost } from "./pricing.ts";

const ROOT = new URL("../../", import.meta.url).pathname;
const RESULTS = ROOT + "results/";
const RECOMMENDATION_JSON = ROOT + "docs/recommendation.json";

const SAMPLE_CAP = 5; // best N and worst N by chrF per run

const PROMPT_DESCRIPTIONS: Record<string, string> = {
  engine:
    "the production translation-engine system instruction; the raw source text is the user message",
  "engine-preserve":
    "engine plus an explicit keep-the-protection-tokens-verbatim clause (masked segments)",
  none:
    "raw source text only — dedicated NMT models; the qwen-mt family adds translation_options",
  generic: "plain translate-this instruction for general local LLMs",
  translate_gemma:
    "the template from the TranslateGemma technical report (its evaluation prompt)",
  hymt2: "Tencent Hy-MT's instruction wording",
};

interface RunPayload {
  label: string;
  backend: string;
  model: string;
  prompt_style: string;
  src: string;
  tgt: string;
  testset?: string;
  pairs: number;
  metrics: { chrf: number; chrfpp: number; bleu: number };
  metric_backend: string;
  exact_match_rate: number | null;
  seconds_per_sentence: number | null;
  timestamp: string | null;
  chrF_by_category?: Record<string, number>;
  samples: {
    id: string;
    category: string;
    source: string;
    reference: string;
    hypothesis: string;
    chrf: number;
  }[];
}

function providerOf(
  payload: RunPayload,
): { provider: string; hosted: boolean } {
  const openai = openaiProviderFor(payload.label);
  if (openai) return { provider: openai.label, hosted: true };
  const info = BACKENDS[payload.backend];
  return {
    provider: info?.label ?? payload.backend,
    hosted: info?.hosted ?? true,
  };
}

function replicationFor(payload: RunPayload): Record<string, unknown> {
  const { label, model, src, tgt, backend } = payload;
  const style = payload.prompt_style;
  const py = ".venv/bin/python eval/run_eval.py"; // historical rows were python-driven
  const deno = "deno run -A eval/deno/run_eval.ts";
  const openai = openaiProviderFor(label);
  if (openai) {
    const kwargs = JSON.stringify(openai.chat_kwargs);
    return {
      command:
        `${deno} --backend openai --model ${model} --base-url ${openai.base_url} ` +
        `--api-key "\$${openai.key_env}" --chat-kwargs-json '${kwargs}' --max-tokens ${openai.max_tokens} ` +
        `--prompt-style ${style} --src ${src} --tgt ${tgt} --name ${label}`,
      base_url: openai.base_url,
      key_env: openai.key_env,
      chat_kwargs: openai.chat_kwargs,
      max_tokens: openai.max_tokens,
      notes: openai.note ? [openai.note] : [],
    };
  }
  if (backend === "qwen") {
    const target = tgt === "en" ? "English" : "Indonesian";
    return {
      command:
        `${deno} --backend qwen --model ${model} --prompt-style none --src ${src} --tgt ${tgt} --name ${label}`,
      base_url: BACKENDS.qwen.base_url,
      key_env: BACKENDS.qwen.key_env,
      request_body: {
        model,
        messages: [{ role: "user", content: "<raw source text>" }],
        translation_options: { source_lang: "auto", target_lang: target },
      },
      notes: [
        "no prompt: the qwen-mt contract is the raw text plus translation_options",
      ],
    };
  }
  if (backend === "cloudflare" || backend === "cloudflare-chat") {
    return {
      command:
        `${deno} --backend ${backend} --model '${model}' --prompt-style ${style} ` +
        `--src ${src} --tgt ${tgt} --name ${label}`,
      key_env: "CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID",
      notes: [],
    };
  }
  if (backend === "kagi") {
    return {
      command:
        `${deno} --backend kagi --prompt-style none --src ${src} --tgt ${tgt} --name ${label}`,
      key_env: "KAGI_SESSION + KAGI_CLIENT_REPO",
      notes: [
        "drives translate.kagi.com through bevry-vibes/kagi-translate-client",
      ],
    };
  }
  if (backend === "ollama") {
    return {
      command:
        `${deno} --backend ollama --model '${model}' --prompt-style ${style} --src ${src} --tgt ${tgt} --name ${label}`,
      base_url: "http://127.0.0.1:11434",
      notes: ["local model: the harness holds the one-benchmark run lock"],
    };
  }
  void py;
  return {
    command: `# no replication recipe for backend ${backend}`,
    notes: [],
  };
}

function cappedSamples(
  samples: RunPayload["samples"],
): { samples: RunPayload["samples"]; capped: boolean } {
  if (samples.length <= 2 * SAMPLE_CAP) return { samples, capped: false };
  const ranked = [...samples].sort((a, b) => b.chrf - a.chrf);
  const keep = new Set([
    ...ranked.slice(0, SAMPLE_CAP).map((s) => s.id),
    ...ranked.slice(-SAMPLE_CAP).map((s) => s.id),
  ]);
  return { samples: samples.filter((s) => keep.has(s.id)), capped: true };
}

function runRow(payload: RunPayload) {
  const { provider, hosted } = providerOf(payload);
  const { samples, capped } = cappedSamples(payload.samples);
  return {
    label: payload.label,
    file: `${payload.label}.json`,
    backend: payload.backend,
    model: payload.model,
    prompt_style: payload.prompt_style,
    provider,
    hosted,
    pairs: payload.pairs,
    testset: payload.testset ?? "testset.jsonl",
    metrics: payload.metrics,
    metric_backend: payload.metric_backend,
    exact_match_rate: payload.exact_match_rate,
    seconds_per_sentence: payload.seconds_per_sentence,
    timestamp: payload.timestamp,
    chrf_by_category: payload.chrF_by_category ?? {},
    samples_capped: capped,
    samples,
    replication: replicationFor(payload),
    cost: priceOf(payload.model) ?? null,
    best: {} as Record<string, boolean>,
  };
}

interface SurvivalRowLike {
  label: string;
  backend: string;
  direction: string;
  model: string;
  passed: number;
  total: number;
}

function survivalRows(): (SurvivalRowLike & {
  provider: string;
  hosted: boolean;
  cost: Cost | null;
})[] {
  const path = RESULTS + "token-survival.json";
  const data = JSON.parse(Deno.readTextFileSync(path)) as { runs: SurvivalRowLike[] };
  return data.runs.map((row) => {
    const { provider, hosted } = providerOf({ label: row.label, backend: row.backend } as RunPayload);
    return { ...row, provider, hosted, cost: priceOf(row.model) ?? null };
  });
}

function markBest(
  rows: {
    best: Record<string, boolean>;
    metrics: { chrf: number; chrfpp: number; bleu: number };
    seconds_per_sentence: number | null;
  }[],
) {
  if (!rows.length) return;
  for (const key of ["chrf", "chrfpp", "bleu"] as const) {
    const best = Math.max(...rows.map((r) => r.metrics[key]));
    for (const row of rows) if (row.metrics[key] === best) row.best[key] = true;
  }
  const withTime = rows.filter((r) => r.seconds_per_sentence !== null);
  const fastest = Math.min(...withTime.map((r) => r.seconds_per_sentence!));
  for (const row of rows) {
    if (row.seconds_per_sentence === fastest) row.best.speed = true;
  }
}

function promptCatalogue() {
  const placeholder = "SOURCE_TEXT_GOES_HERE";
  const catalogue: Record<string, unknown> = {};
  for (
    const style of ["generic", "translate_gemma", "hymt2", "none"] as const
  ) {
    catalogue[style] = {
      description: PROMPT_DESCRIPTIONS[style],
      user_message: buildPrompt(placeholder, "id", "en", style),
      system_message: null,
    };
  }
  for (const style of ["engine", "engine-preserve"] as const) {
    catalogue[style] = {
      description: PROMPT_DESCRIPTIONS[style],
      user_message: "<raw source text>",
      system_message: style === "engine"
        ? ENGINE_SYSTEM("id", "en")
        : ENGINE_PRESERVE_SYSTEM("id", "en"),
    };
  }
  catalogue["qwen-mt-request"] = {
    description:
      "the qwen-mt family takes no prompt: the raw text plus translation_options",
    request_body: {
      model: "qwen-mt-*",
      messages: [{ role: "user", content: "<raw source text>" }],
      translation_options: {
        source_lang: "auto",
        target_lang: "English | Indonesian",
      },
    },
  };
  return catalogue;
}

function main() {
  const mainRuns = new Map<string, ReturnType<typeof runRow>[]>();
  for (
    const entry of [...Deno.readDirSync(RESULTS)].filter((e) =>
      e.name.endsWith(".json")
    ).sort((a, b) => a.name.localeCompare(b.name))
  ) {
    if (entry.name === "token-survival.json") continue; // the scored matrix, not a run
    const payload = JSON.parse(
      Deno.readTextFileSync(RESULTS + entry.name),
    ) as RunPayload;
    if ((payload.testset ?? "testset.jsonl").startsWith("masked")) continue; // survival matrix only
    const direction = `${payload.src}->${payload.tgt}`;
    const rows = mainRuns.get(direction) ?? [];
    rows.push(runRow(payload));
    mainRuns.set(direction, rows);
  }

  const survival = survivalRows();
  const recommendation = JSON.parse(Deno.readTextFileSync(RECOMMENDATION_JSON));

  const directions = [...mainRuns.keys()].sort().map((direction) => {
    const rows = mainRuns.get(direction)!.sort((a, b) =>
      b.metrics.chrf - a.metrics.chrf
    );
    markBest(rows);
    const [src, tgt] = direction.split("->");
    return {
      direction,
      src,
      tgt,
      runs: rows,
      best_run: {
        label: rows[0].label,
        file: rows[0].file,
        chrf_by_category: rows[0].chrf_by_category,
      },
      token_survival: survival
        .filter((s) => s.direction === direction)
        .sort((a, b) =>
          (b.passed / b.total) - (a.passed / a.total) ||
          a.model.localeCompare(b.model)
        ),
    };
  });

  const data = {
    generated_at: new Date().toISOString().slice(0, 19) + "+00:00",
    directions,
    token_survival: [...survival].sort((a, b) =>
      a.direction.localeCompare(b.direction) ||
      (b.passed / b.total) - (a.passed / a.total) ||
      a.model.localeCompare(b.model)
    ),
    prompts: promptCatalogue(),
    recommendation,
  };

  const body = JSON.stringify(data, null, 1) + "\n";
  Deno.mkdirSync(ROOT + "site/src/data", { recursive: true });
  Deno.mkdirSync(ROOT + "site/public/data", { recursive: true });
  Deno.writeTextFileSync(ROOT + "site/src/data/results.json", body);
  Deno.writeTextFileSync(ROOT + "site/public/data/results.json", body);
  const runs = directions.reduce((n, d) => n + d.runs.length, 0);
  console.log(
    `wrote site/{src,public}/data/results.json (${body.length} bytes, ${directions.length} directions, ` +
      `${runs} main runs, ${survival.length} masked runs)`,
  );
}

main();
