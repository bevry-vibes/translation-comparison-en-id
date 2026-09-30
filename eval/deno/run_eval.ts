#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write --allow-run
/** The Indonesian<->English benchmark harness (Deno).
 *
 * Backends: OpenAI-compatible gateways (OpenRouter, DeepSeek official, Cline,
 * QwenCloud compatible-mode, local llama-server/vLLM), the qwen-mt family
 * (translation_options), Cloudflare Workers AI (NMT + chat), Kagi Translate and
 * Ollama. Metrics are the bundled local formulas in ./metrics.ts — the same
 * formulas sacrebleu implements, verified like-for-like when the client-parity
 * rows were measured. Same results JSON schema and one-benchmark-at-a-time run
 * lock as the original python harness, so results/*.json stay identical in
 * shape and comparable in substance.
 *
 * Usage:
 *   deno run -A eval/deno/run_eval.ts --backend openai --model qwen/qwen3-235b-a22b-2507 \
 *     --base-url https://openrouter.ai/api/v1 --api-key "$OPENROUTER_API_KEY" \
 *     --chat-kwargs-json '{"reasoning":{"enabled":false}}' --max-tokens 4096 \
 *     --prompt-style engine --src id --tgt en --name or-qwen3-235b-a22b-2507
 *
 * Prompts mirror production exactly (the same strings the site renders from
 * ./prompts.ts — one source of truth).
 */

import Cloudflare from "npm:cloudflare@7.1.0";
import { exactMatchRate, perSentenceChrf, scoreAll } from "./metrics.ts";
import {
  buildMessages,
  ENGINE_PRESERVE_SYSTEM,
  ENGINE_SYSTEM,
} from "./prompts.ts";
import { OPENAI_COMPAT } from "./providers.ts";

const ROOT = new URL("../../", import.meta.url).pathname;
const DEFAULT_TESTSET = ROOT + "data/testset-v2.jsonl";
// per-request ceiling; a hung gateway connection must fail over to retry,
// not freeze the run (the original "Cline black-holes requests" observation)
const REQUEST_TIMEOUT_MS = 180_000;
const RESULTS = ROOT + "results";
const LOCK_PATH = Deno.env.get("MTBENCH_LOCK") ??
  "/tmp/indonesian-mt-bench.lock";

const LANG_NAMES = { id: "Indonesian", en: "English" };

interface Pair {
  id: string;
  category: string;
  source: string;
  reference: string;
}

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

function parseArgs(argv: string[]): Record<string, string> {
  const opts: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      opts[key] = argv[++i];
    } else {
      opts[key] = "true";
    }
  }
  return opts;
}

function loadPairs(path: string, src: string, tgt: string): Pair[] {
  const pairs: Pair[] = [];
  for (const line of Deno.readTextFileSync(path).split("\n")) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line);
    if (entry.src === src && entry.tgt === tgt) pairs.push(entry);
  }
  return pairs;
}

// Mirror of memguard.RunLock: fail fast when another live pid holds the lock;
// treat the lock as stale when the pid is dead or the file is older than 3 hours.
function acquireLock(): void {
  try {
    const stat = Deno.statSync(LOCK_PATH);
    const pid = parseInt(Deno.readTextFileSync(LOCK_PATH).trim(), 10);
    let alive = false;
    try {
      Deno.statSync(`/proc/${pid}`);
      alive = true;
    } catch {
      alive = false;
    }
    const ageHours = (Date.now() - (stat.mtime?.getTime() ?? 0)) / 3_600_000;
    if (alive && ageHours < 3) {
      console.error(
        `another benchmark holds the lock (pid ${pid}): ${LOCK_PATH}`,
      );
      Deno.exit(1);
    }
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  Deno.writeTextFileSync(LOCK_PATH, String(Deno.pid));
}

function releaseLock(): void {
  try {
    Deno.removeSync(LOCK_PATH);
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
}

function byCategory(
  pairs: Pair[],
  perSentence: number[],
): Record<string, number> {
  const buckets = new Map<string, number[]>();
  pairs.forEach((pair, i) => {
    const arr = buckets.get(pair.category) ?? [];
    arr.push(perSentence[i]);
    buckets.set(pair.category, arr);
  });
  const out: Record<string, number> = {};
  for (const cat of [...buckets.keys()].sort()) {
    const vals = buckets.get(cat)!;
    out[cat] = Math.round(
      (vals.reduce((a, b) => a + b, 0) / vals.length) * 100,
    ) / 100;
  }
  return out;
}

/** POST a chat completion with 429/5xx/transient-network backoff; the waited
 * time is returned so retries stay out of the measured latency. */
async function postChatRetry(
  url: string,
  payload: unknown,
  apiKey: string,
): Promise<{ body: Record<string, unknown>; waited: number }> {
  let waited = 0;
  let attempt = 0;
  while (true) {
    const started = performance.now();
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        // a gateway that accepts the connection and never answers would
        // otherwise hang the whole run: this is how the (wrong) "Cline
        // black-holes requests" diagnosis happened — treat as transient
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const text = await response.text();
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error(
          `non-JSON response (${response.status}): ${text.slice(0, 200)}`,
        );
      }
      if (!response.ok) {
        const transient = [429, 500, 502, 503, 504].includes(response.status);
        const retryAfter = parseFloat(
          response.headers.get("Retry-After") ?? "",
        );
        const wait = Number.isFinite(retryAfter)
          ? retryAfter
          : Math.min(2.0 * 2 ** attempt, 30.0);
        if (!transient || attempt >= 5) {
          throw new Error(
            `HTTP ${response.status}: ${JSON.stringify(body).slice(0, 200)}`,
          );
        }
        waited += (performance.now() - started) / 1000 + wait;
        console.warn(
          `[warn] HTTP ${response.status}; retry ${attempt + 1} in ${
            wait.toFixed(0)
          }s`,
        );
        await new Promise((r) => setTimeout(r, wait * 1000));
        attempt++;
        continue;
      }
      return { body, waited };
    } catch (e) {
      const timedOut = e instanceof DOMException && e.name === "TimeoutError";
      if (e instanceof TypeError || timedOut) { // network-level failure: transient
        const wait = Math.min(2.0 * 2 ** attempt, 30.0);
        if (attempt >= 5) throw e;
        waited += (performance.now() - started) / 1000 + wait;
        console.warn(
          `[warn] ${timedOut ? `request timed out after ${REQUEST_TIMEOUT_MS / 1000}s` : e.message}; retry ${
            attempt + 1
          } in ${wait.toFixed(0)}s`,
        );
        await new Promise((r) => setTimeout(r, wait * 1000));
        attempt++;
        continue;
      }
      throw e;
    }
  }
}

interface ChatResult {
  content: string;
  waited: number;
}

async function chatCompletion(
  base_url: string,
  body: Record<string, unknown>,
  apiKey: string,
): Promise<ChatResult> {
  const { body: response, waited } = await postChatRetry(
    `${base_url}/chat/completions`,
    body,
    apiKey,
  );
  // Cline's gateway (api.cline.bot) wraps the standard chat completion in a
  // {"data": {...}} envelope; unwrap it before reading choices
  const payload =
    ("choices" in response || typeof response.data !== "object"
      ? response
      : response.data) as Record<string, unknown>;
  // Cline also reports model-level failures as HTTP 200 + {"error": ...}
  if (payload.error !== undefined) {
    throw new Error(
      `gateway error envelope: ${JSON.stringify(payload.error).slice(0, 200)}`,
    );
  }
  const choice = (payload.choices as Record<string, unknown>[])[0];
  const message = choice.message as Record<string, unknown>;
  const content = (typeof message.content === "string" ? message.content : "")
    .trim();
  if (!content) {
    throw new Error(
      `empty content (finish_reason=${choice.finish_reason}) — a reasoning model likely spent ` +
        `the whole --max-tokens budget on reasoning; raise --max-tokens`,
    );
  }
  return { content, waited };
}

async function translateOpenAi(
  texts: string[],
  opts: Record<string, string>,
  messages: (text: string) => ChatMessage[],
): Promise<{ out: string[]; seconds: number }> {
  const prefix = Object.keys(OPENAI_COMPAT).find((p) =>
    (opts.name ?? "").startsWith(p)
  );
  const manifest = prefix
    ? OPENAI_COMPAT[prefix as keyof typeof OPENAI_COMPAT]
    : undefined;
  const base_url = opts["base-url"] ?? manifest?.base_url ??
    "http://127.0.0.1:1234/v1";
  const apiKey = opts["api-key"] ??
    (manifest ? Deno.env.get(manifest.key_env) : undefined) ??
    "not-needed";
  const chatKwargs: Record<string, unknown> = opts["chat-kwargs-json"]
    ? JSON.parse(opts["chat-kwargs-json"])
    : manifest?.chat_kwargs ?? {};
  const maxTokens = opts["max-tokens"]
    ? parseInt(opts["max-tokens"], 10)
    : manifest?.max_tokens;
  const out: string[] = [];
  const started = performance.now();
  let waited = 0;
  for (const text of texts) {
    const body: Record<string, unknown> = {
      model: opts.model,
      messages: messages(text),
      temperature: 0,
      stream: false,
      ...chatKwargs,
    };
    if (maxTokens) body.max_tokens = maxTokens;
    const result = await chatCompletion(base_url, body, apiKey);
    waited += result.waited;
    out.push(result.content);
  }
  return { out, seconds: (performance.now() - started) / 1000 - waited };
}

async function translate(
  texts: string[],
  opts: Record<string, string>,
  src: string,
  tgt: string,
) {
  const backend = opts.backend;
  if (backend === "openai") {
    return translateOpenAi(
      texts,
      opts,
      (text) => buildMessages(text, src, tgt, opts["prompt-style"] ?? "engine"),
    );
  }
  if (backend === "qwen") {
    const apiKey = opts["qwen-api-key"] ?? Deno.env.get("QWENCLOUD_API_KEY") ??
      "";
    if (!apiKey) {
      throw new Error(
        "qwen backend needs QWENCLOUD_API_KEY in the environment",
      );
    }
    const base_url = "https://maas.qwencloudapi.com/compatible-mode/v1";
    const target = LANG_NAMES[tgt as keyof typeof LANG_NAMES];
    const out: string[] = [];
    const started = performance.now();
    let waited = 0;
    for (const text of texts) {
      // the qwen-mt contract: raw source text plus translation_options, no prompt
      const result = await chatCompletion(base_url, {
        model: opts.model,
        messages: [{ role: "user", content: text }],
        translation_options: { source_lang: "auto", target_lang: target },
      }, apiKey);
      waited += result.waited;
      out.push(result.content);
    }
    return { out, seconds: (performance.now() - started) / 1000 - waited };
  }
  if (backend === "cloudflare" || backend === "cloudflare-chat") {
    // absent or "not-needed": use the environment credentials
    const apiToken = !opts["api-key"] || opts["api-key"] === "not-needed"
      ? Deno.env.get("CLOUDFLARE_API_TOKEN") ?? ""
      : opts["api-key"];
    const accountId = opts["account-id"] ??
      Deno.env.get("CLOUDFLARE_ACCOUNT_ID") ?? "";
    if (!apiToken || !accountId) {
      throw new Error(
        "cloudflare needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment",
      );
    }
    const client = new Cloudflare({ apiToken });
    const path = `/accounts/${accountId}/ai/run/${opts.model}`;
    const out: string[] = [];
    const started = performance.now();
    for (const text of texts) {
      const body = backend === "cloudflare"
        ? { text, source_lang: src, target_lang: tgt }
        : {
          messages: buildMessages(
            text,
            src,
            tgt,
            // honour --prompt-style: the metadata records it, so the request
            // must carry it (masked-preserve runs used to silently send engine)
            opts["prompt-style"] ?? "engine",
          ),
          stream: false,
        };
      const response = await client.post(path, { body }) as Record<
        string,
        unknown
      >;
      if (!response.success) {
        throw new Error(
          `cloudflare: bad envelope from ${opts.model}: ${
            JSON.stringify(response).slice(0, 200)
          }`,
        );
      }
      const result = (response.result ?? {}) as Record<string, unknown>;
      if (backend === "cloudflare") {
        if (typeof result.translated_text === "string") {
          out.push(result.translated_text.trim());
          continue;
        }
        if (Array.isArray(result.translations)) {
          out.push(
            (result.translations as unknown[]).map((p) =>
              typeof p === "string"
                ? p
                : String((p as Record<string, unknown>)?.translated_text ?? "")
            ).join(" ").trim(),
          );
          continue;
        }
        throw new Error(
          `cloudflare: unexpected result shape: ${
            JSON.stringify(result).slice(0, 200)
          }`,
        );
      }
      const choices = result.choices as Record<string, unknown>[] | undefined;
      const message = choices?.[0]?.message as
        | Record<string, unknown>
        | undefined;
      const translated =
        typeof message?.content === "string" && message.content.trim()
          ? message.content
          : (typeof result.response === "string" ? result.response : "");
      if (!translated.trim()) {
        throw new Error(
          `cloudflare: empty result from ${opts.model}: ${
            JSON.stringify(result).slice(0, 200)
          }`,
        );
      }
      out.push(translated.trim());
    }
    return { out, seconds: (performance.now() - started) / 1000 };
  }
  if (backend === "kagi") {
    if (!Deno.env.get("KAGI_SESSION")) {
      throw new Error("kagi backend needs KAGI_SESSION in the environment");
    }
    const clientRepo = opts["kagi-client-repo"] ??
      Deno.env.get("KAGI_CLIENT_REPO") ?? "";
    if (!clientRepo) {
      throw new Error("kagi backend needs KAGI_CLIENT_REPO in the environment");
    }
    const runtime = opts["kagi-runtime"] ?? "python";
    const argv = runtime === "deno"
      ? ["deno", "run", "--allow-env", "--allow-net", "kagi_translate.ts"]
      : ["uv", "run", "kagi_translate.py"];
    const out: string[] = [];
    const started = performance.now();
    for (const text of texts) {
      const command = new Deno.Command(argv[0], {
        args: [
          ...argv.slice(1),
          "translate",
          text,
          "--from",
          src,
          "--to",
          tgt,
          "--format",
          "json",
          "--no-stream",
        ],
        cwd: clientRepo,
        stdout: "piped",
        stderr: "piped",
      });
      const { stdout, success } = await command.output();
      if (!success) {
        throw new Error(
          `kagi ${runtime} failed: ${
            new TextDecoder().decode(stdout).slice(0, 200)
          }`,
        );
      }
      out.push(
        String(JSON.parse(new TextDecoder().decode(stdout)).translation ?? "")
          .trim(),
      );
    }
    return { out, seconds: (performance.now() - started) / 1000 };
  }
  if (backend === "ollama") {
    const host = opts.host ?? "http://127.0.0.1:11434";
    const out: string[] = [];
    const started = performance.now();
    for (const text of texts) {
      const response = await fetch(`${host}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: opts.model,
          messages: [{
            role: "user",
            content: buildMessages(
              text,
              src,
              tgt,
              opts["prompt-style"] ?? "generic",
            )[0].content,
          }],
          stream: false,
          options: {
            temperature: 0,
            num_ctx: parseInt(opts["num-ctx"] ?? "2048", 10),
          },
        }),
      });
      const body = await response.json();
      out.push(String(body.message?.content ?? "").trim());
    }
    return { out, seconds: (performance.now() - started) / 1000 };
  }
  throw new Error(
    `unknown backend: ${backend} (openai | qwen | cloudflare | cloudflare-chat | kagi | ollama)`,
  );
}

async function main() {
  const opts = parseArgs(Deno.args);
  const src = opts.src ?? "id";
  const tgt = opts.tgt ?? "en";
  const promptStyle = opts["prompt-style"] ?? "engine";

  const pairs = loadPairs(opts.testset ?? DEFAULT_TESTSET, src, tgt);
  if (opts.limit) {
    pairs.length = Math.min(pairs.length, parseInt(opts.limit, 10));
  }
  if (pairs.length === 0) {
    throw new Error(
      `no ${src}->${tgt} pairs in the testset; build it with eval/deno/build_testset.ts`,
    );
  }

  const label = opts.name ??
    `${opts.backend}-${opts.model ?? "default"}`.replace(/\//g, "_");
  const hf = `${label}-${src}${tgt}`;
  console.log(
    `[${new Date().toISOString().slice(0, 19)}+00:00] deno:${opts.backend}:${
      opts.model ?? ""
    } | ` +
      `${pairs.length} pairs ${src}->${tgt} | prompt=${promptStyle}`,
  );

  acquireLock();
  try {
    const { out, seconds } = await translate(
      pairs.map((p) => p.source),
      opts,
      src,
      tgt,
    );
    const references = pairs.map((p) => p.reference);
    const perSentence = perSentenceChrf(out, references);
    const scores = scoreAll(out, references);
    const payload = {
      label: hf,
      backend: opts.backend,
      model: opts.model,
      prompt_style: promptStyle,
      src,
      tgt,
      testset: (opts.testset ?? DEFAULT_TESTSET).split("/").pop(),
      pairs: pairs.length,
      metrics: scores,
      metric_backend: "local",
      exact_match_rate: exactMatchRate(out, references),
      seconds_total: Math.round(seconds * 100) / 100,
      seconds_per_sentence: Math.round(seconds / pairs.length * 1000) / 1000,
      chrF_by_category: byCategory(pairs, perSentence),
      timestamp: new Date().toISOString().slice(0, 19) + "+00:00",
      samples: pairs.map((pair, i) => ({
        id: pair.id,
        category: pair.category,
        source: pair.source,
        reference: pair.reference,
        hypothesis: out[i],
        chrf: perSentence[i],
      })),
    };

    Deno.mkdirSync(RESULTS, { recursive: true });
    const outPath = `${RESULTS}/${hf}.json`;
    Deno.writeTextFileSync(outPath, JSON.stringify(payload, null, 2) + "\n");

    console.log(
      `  bleu=${scores.bleu}  chrF=${scores.chrf}  chrF++=${scores.chrfpp}  (metric backend: local)`,
    );
    console.log(
      `  wall=${payload.seconds_total}s  ${payload.seconds_per_sentence}s/sentence`,
    );
    console.log("  worst 5 by chrF:");
    [...pairs.keys()]
      .sort((a, b) => perSentence[a] - perSentence[b])
      .slice(0, 5)
      .forEach((i) => {
        console.log(
          `   - [${perSentence[i].toFixed(2).padStart(6)}] ${
            pairs[i].category
          }: ${JSON.stringify(pairs[i].source.slice(0, 70))}`,
        );
        console.log(
          `            ref: ${JSON.stringify(references[i].slice(0, 70))}`,
        );
        console.log(`            hyp: ${JSON.stringify(out[i].slice(0, 70))}`);
      });
    console.log(`wrote ${outPath}`);
    console.log(
      "run `deno task -s data && deno task deploy` (in site/) to refresh the results site",
    );
  } finally {
    releaseLock();
  }
}

// touch the prompt constants so deno check keeps them honest even when unused paths change
void ENGINE_SYSTEM;
void ENGINE_PRESERVE_SYSTEM;

await main();
