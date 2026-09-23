#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
/** Like-for-like Deno harness for the Cloudflare Workers AI translation models.
 *
 * Same testset, same local-metric formulas (./metrics.ts), same results JSON
 * schema and one-benchmark-at-a-time run lock as eval/run_eval.py, so
 * eval/summarize.py renders both clients into one results/results.md.
 *
 * Usage:
 *   deno run --allow-net --allow-env --allow-read --allow-write eval/deno/run_eval.ts \
 *     --model @cf/meta/m2m100-1.2b --src id --tgt en --name cf-m2m100-1.2b-deno
 *
 * Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment
 * (`set -a; . ./.env; set +a`). The typed ai.run() helper URL-encodes the
 * slash-bearing model id (see eval/backends.py CloudflareBackend), so this
 * drives the SDK's generic request path too.
 */

import Cloudflare from "npm:cloudflare@7.1.0";
import { exactMatchRate, perSentenceChrf, scoreAll } from "./metrics.ts";

// Corpus-level scoring mirrors metrics.py exactly: sacrebleu when the system
// python3 has it (one subprocess per run — scoring only, the client stays Deno),
// otherwise the bundled local formulas. This keeps the Deno rows directly
// comparable with the Python rows in results/results.md.
const SACREBLEU_SNIPPET = [
  "import json, sys, sacrebleu",
  "h, r = json.load(sys.stdin)",
  "print(json.dumps({",
  "    'bleu': round(float(sacrebleu.corpus_bleu(h, [r]).score), 2),",
  "    'chrf': round(float(sacrebleu.corpus_chrf(h, [r]).score), 2),",
  "    'chrfpp': round(float(sacrebleu.corpus_chrf(h, [r], word_order=2).score), 2),",
  "}))",
].join("\n");

async function scoreAllParity(
  hypotheses: string[],
  references: string[],
): Promise<{ scores: { bleu: number; chrf: number; chrfpp: number }; backend: string }> {
  try {
    const command = new Deno.Command("python3", {
      args: ["-c", SACREBLEU_SNIPPET],
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    });
    const child = command.spawn();
    const writer = await child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(JSON.stringify([hypotheses, references])));
    writer.close();
    const stdout = await new Response(child.stdout).text();
    const status = await child.status;
    if (status.success) {
      const scores = JSON.parse(stdout);
      return { scores, backend: "sacrebleu" };
    }
  } catch {
    // fall through to the bundled local formulas
  }
  return { scores: scoreAll(hypotheses, references), backend: "local" };
}

const ROOT = new URL("../../", import.meta.url).pathname;
const DEFAULT_TESTSET = ROOT + "data/testset.jsonl";
const RESULTS = ROOT + "results";
const LOCK_PATH = Deno.env.get("MTBENCH_LOCK") ?? "/tmp/indonesian-mt-bench.lock";

interface Pair {
  id: string;
  category: string;
  source: string;
  reference: string;
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
      console.error(`another benchmark holds the lock (pid ${pid}): ${LOCK_PATH}`);
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

function extractTranslation(result: Record<string, unknown>, model: string): string {
  if (typeof result.translated_text === "string") { // m2m100-style: a single string
    return result.translated_text.trim();
  }
  if (Array.isArray(result.translations)) { // indictrans2-style: a list of segments
    const parts = (result.translations as unknown[]).map((p) =>
      typeof p === "string" ? p : String((p as Record<string, unknown>)?.translated_text ?? "")
    );
    return parts.join(" ").trim();
  }
  throw new Error(`cloudflare: unexpected result shape from ${model}: ${JSON.stringify(result).slice(0, 200)}`);
}

function byCategory(pairs: Pair[], perSentence: number[]): Record<string, number> {
  const buckets = new Map<string, number[]>();
  pairs.forEach((pair, i) => {
    const arr = buckets.get(pair.category) ?? [];
    arr.push(perSentence[i]);
    buckets.set(pair.category, arr);
  });
  const out: Record<string, number> = {};
  for (const cat of [...buckets.keys()].sort()) {
    const vals = buckets.get(cat)!;
    out[cat] = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
  }
  return out;
}

async function main() {
  const opts = parseArgs(Deno.args);
  const model = opts.model;
  if (!model) throw new Error("this harness needs --model (e.g. @cf/meta/m2m100-1.2b)");
  const src = opts.src ?? "id";
  const tgt = opts.tgt ?? "en";
  const apiToken = opts["api-key"] ?? Deno.env.get("CLOUDFLARE_API_TOKEN") ?? "";
  const accountId = opts["account-id"] ?? Deno.env.get("CLOUDFLARE_ACCOUNT_ID") ?? "";
  if (!apiToken || !accountId) {
    throw new Error("cloudflare needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment (`set -a; . ./.env; set +a`)");
  }

  const pairs = loadPairs(opts.testset ?? DEFAULT_TESTSET, src, tgt);
  if (opts.limit) pairs.length = Math.min(pairs.length, parseInt(opts.limit, 10));
  if (pairs.length === 0) {
    throw new Error(`no ${src}->${tgt} pairs in the testset; run \`python3 eval/build_testset.py\` first`);
  }

  const label = opts.name ?? `cloudflare-deno-${model}`;
  const hf = `${label}-${src}${tgt}`;
  console.log(`[${new Date().toISOString().slice(0, 19)}+00:00] cloudflare-deno:${model} | ${pairs.length} pairs ${src}->${tgt} | prompt=none`);

  acquireLock();
  try {
    const client = new Cloudflare({ apiToken });
    const path = `/accounts/${accountId}/ai/run/${model}`;

    // one throwaway call so connection setup is not charged to the benchmark
    await client.post(path, { body: { text: "Halo.", source_lang: src, target_lang: tgt } });

    const sources = pairs.map((p) => p.source);
    const references = pairs.map((p) => p.reference);
    const out: string[] = [];
    const started = performance.now();
    for (const text of sources) {
      const body = await client.post(path, {
        body: { text, source_lang: src, target_lang: tgt },
      }) as Record<string, unknown>;
      if (!body.success) {
        throw new Error(`cloudflare: bad envelope from ${model}: ${JSON.stringify(body).slice(0, 200)}`);
      }
      out.push(extractTranslation((body.result ?? {}) as Record<string, unknown>, model));
    }
    const wallSeconds = (performance.now() - started) / 1000;

    const perSentence = perSentenceChrf(out, references);
    const { scores, backend: metricBackend } = await scoreAllParity(out, references);
    const payload = {
      label: hf,
      backend: "cloudflare-deno",
      model,
      prompt_style: "none",
      src,
      tgt,
      pairs: pairs.length,
      metrics: scores,
      metric_backend: metricBackend,
      exact_match_rate: exactMatchRate(out, references),
      seconds_total: Math.round(wallSeconds * 100) / 100,
      seconds_per_sentence: Math.round(wallSeconds / pairs.length * 1000) / 1000,
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

    console.log(`  bleu=${scores.bleu}  chrF=${scores.chrf}  chrF++=${scores.chrfpp}  (metric backend: ${metricBackend})`);
    console.log(`  wall=${payload.seconds_total}s  ${payload.seconds_per_sentence}s/sentence`);
    console.log("  worst 5 by chrF:");
    [...pairs.keys()]
      .sort((a, b) => perSentence[a] - perSentence[b])
      .slice(0, 5)
      .forEach((i) => {
        console.log(`   - [${perSentence[i].toFixed(2).padStart(6)}] ${pairs[i].category}: ${JSON.stringify(pairs[i].source.slice(0, 70))}`);
        console.log(`            ref: ${JSON.stringify(references[i].slice(0, 70))}`);
        console.log(`            hyp: ${JSON.stringify(out[i].slice(0, 70))}`);
      });
    console.log(`wrote ${outPath}`);
    console.log("run `python3 eval/summarize.py` to regenerate results/results.md");
  } finally {
    releaseLock();
  }
}

await main();
