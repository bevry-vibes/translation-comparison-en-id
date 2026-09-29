#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
/** Identity-permanence spike: which masking scheme keeps protected names
 * intact through a given provider?
 *
 * Production masks every known name form into a private-use placeholder
 * (U+E000 + glossary index + U+E001) and restores it afterwards. DeepSeek
 * drops those tokens in the id->en direction (they come back as bare
 * numbers). This spike re-masks the same segments under several token
 * formats + instruction wordings, asks one provider, and scores each output
 * with the survival contract (every expected marker present with the right
 * count, nothing renumbered, every name back after restoration).
 *
 * Usage:
 *   deno run -A eval/deno/spike_identity.ts \
 *     --model deepseek-flash --base-url https://api.deepseek.com \
 *     --api-key-env DEEPSEEK_API_KEY --schemes all
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const TOKEN_START = "\uE000";
const TOKEN_END = "\uE001";

/** write the site monitor's progress file (the shape scripts/lib.sh emits) so
 * the ghostty-web terminal shows live spike progress + ETA */
function emitProgress(
  model: string,
  status: string,
  done: number,
  total: number,
  current: string,
) {
  const dir = ROOT + "site/public/data";
  const now = new Date().toISOString().slice(0, 19) + "+00:00";
  try {
    Deno.mkdirSync(dir, { recursive: true });
    let started = now;
    try {
      started = Deno.readTextFileSync(dir + "/.spike-started").trim() || now;
    } catch {
      Deno.writeTextFileSync(dir + "/.spike-started", now);
    }
    Deno.writeTextFileSync(
      dir + "/refresh-status.json",
      JSON.stringify(
        {
          task: `identity-spike (${model})`,
          status,
          started_at: started,
          updated_at: now,
          started_at_ms: Date.parse(started),
          updated_at_ms: Date.now(),
          done,
          total,
          current,
        },
        null,
        1,
      ) + "\n",
    );
  } catch (e) {
    console.warn(`[warn] progress emit failed: ${e}`);
  }
}

interface MaskedEntry {
  id: string;
  src: string;
  tgt: string;
  plain: string;
  names: { form: string; index: number; count: number }[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Scheme {
  id: string;
  /** mask one name occurrence at glossary index n */
  token: (n: number) => string;
  /** matches one token in provider output (global) */
  marker: RegExp;
  /** instruction clause describing the marker */
  clause: string;
}

const SCHEMES: Scheme[] = [
  {
    id: "pua",
    token: (n) => `${TOKEN_START}${n}${TOKEN_END}`,
    marker: new RegExp(`${TOKEN_START}(\\d+)${TOKEN_END}`, "g"),
    clause:
      "Placeholder tokens of the form \uE000<digits>\uE001 mark protected names: copy each token exactly as written, never translate, reorder, renumber, merge, split, or drop tokens.",
  },
  {
    id: "brackets",
    token: (n) => `[[${n}]]`,
    marker: /\[\[(\d+)\]\]/g,
    clause:
      "Bracketed markers like [[0]] or [[3]] mark protected names: copy each marker exactly as written, never translate, reorder, renumber, merge, split, or drop markers.",
  },
  {
    id: "curly",
    token: (n) => `{{${n}}}`,
    marker: /\{\{(\d+)\}\}/g,
    clause:
      "Curly-brace markers like {{0}} or {{3}} mark protected names: copy each marker exactly as written, never translate, reorder, renumber, merge, split, or drop markers.",
  },
  {
    id: "identifier",
    token: (n) => `NME${n}X`,
    marker: /NME(\d+)X/g,
    clause:
      "Identifiers like NME0X or NME3X mark protected names: copy each identifier exactly as written, never translate, reorder, renumber, merge, split, or drop identifiers.",
  },
  {
    id: "xml",
    token: (n) => `<name-${n}>`,
    marker: /<name-(\d+)>/g,
    clause:
      "Tags like <name-0> or <name-3> mark protected names: copy each tag exactly as written, never translate, reorder, renumber, merge, split, or drop tags.",
  },
  {
    id: "real",
    // no masking: the actual name stays inline (indices still expected back? no
    // markers exist; survival is judged on the names themselves)
    token: (n) => "",
    marker: /imdi-impossible/g,
    clause:
      "Person and organisation names are identity and must appear in the translation exactly as written in the source: never translate, transliterate, shorten, expand, or omit any name.",
  },
];

function maskPlain(
  plain: string,
  names: MaskedEntry["names"],
  scheme: Scheme,
): { source: string; expected: Map<number, number> } {
  if (scheme.id === "real") return { source: plain, expected: new Map() };
  let output = plain;
  const expected = new Map<number, number>();
  // longest-form-first order is baked into the stored indices
  for (const name of [...names].sort((a, b) => b.form.length - a.form.length)) {
    output = output.replaceAll(name.form, scheme.token(name.index));
    expected.set(name.index, (expected.get(name.index) ?? 0) + name.count);
  }
  return { source: output, expected };
}

function systemPrompt(scheme: Scheme, src: string, tgt: string): string {
  const LANG: Record<string, string> = { id: "Indonesian", en: "English" };
  return (
    `You are a translation engine. Translate the user's text from ${
      LANG[src]
    } to ${LANG[tgt]}. ` +
    scheme.clause +
    " Output only the translation, preserving paragraph breaks. No notes, no reasoning, no alternatives."
  );
}

function countMatches(text: string, marker: RegExp): Map<number, number> {
  const counts = new Map<number, number>();
  for (const match of text.matchAll(marker)) {
    const index = parseInt(match[1], 10);
    counts.set(index, (counts.get(index) ?? 0) + 1);
  }
  return counts;
}

function countFormOccurrences(text: string, form: string): number {
  const patterns = new Set([form]);
  const capitalised = form.charAt(0).toUpperCase() + form.slice(1);
  if (capitalised !== form) patterns.add(capitalised);
  let count = 0;
  for (const pattern of patterns) {
    count += (text.match(
      new RegExp(
        `\\b${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
        "g",
      ),
    ) ?? []).length;
  }
  return count;
}

interface Failure {
  id: string;
  failures: string[];
  raw: string;
}

async function translate(
  base_url: string,
  apiKey: string,
  model: string,
  system: string,
  source: string,
  cloudflareChat = false,
): Promise<string> {
  let url = `${base_url}/chat/completions`;
  const messages = [
    { role: "system", content: system },
    { role: "user", content: source },
  ];
  let requestBody: Record<string, unknown> = {
    model,
    messages,
    temperature: 0,
    stream: false,
    max_tokens: 4096,
  };
  if (cloudflareChat) {
    // OpenAI-compatible surface: /ai/run returns empty content for GLM
    // reasoning models (byte-identical requests succeed via /ai/v1), so post
    // the standard chat-completions shape to the compat endpoint instead
    const accountId = Deno.env.get("CLOUDFLARE_ACCOUNT_ID") ?? "";
    url =
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`;
    requestBody = { model, messages, stream: false };
  }
  if (Deno.env.get("SPIKE_DEBUG") === "1") {
    console.error("REQ:", JSON.stringify(requestBody));
  }
  // providers enforce request-per-minute limits (Workers AI: 300/min default
  // Text Generation, 20/min for paid-plan models). Honour 429 + Retry-After
  // with dedicated waits instead of burning a caller attempt on them.
  let response: Response;
  for (let rateTry = 1; ; rateTry++) {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      // a hung provider call must not freeze the monitor feed
      signal: AbortSignal.timeout(120_000),
    });
    if (response.status !== 429 || rateTry > 4) break;
    const retryAfterS =
      parseFloat(response.headers.get("retry-after") ?? "") || 5;
    const waitMs = Math.min(retryAfterS, 60) * 1000 + Math.random() * 1_000;
    console.warn(
      `[rate] 429 from ${model}, waiting ${Math.round(waitMs / 1000)}s before retry`,
    );
    await sleep(waitMs);
  }
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 200)}`,
    );
  }
  const envelope = payload as Record<string, unknown>;
  const choice = ((envelope.choices as Record<string, unknown>[] | undefined)?.[0] ??
    {}) as Record<string, unknown>;
  const message = (typeof choice.message === "object" && choice.message !== null
    ? choice.message
    : {}) as Record<string, unknown>;
  const content =
    // standard OpenAI shape: choices[0].message.content
    (typeof message.content === "string" ? message.content : "").trim() ||
    // some gateways inline the text on the choice
    (typeof choice.content === "string" ? choice.content : "").trim() ||
    // legacy single-string completion shape
    (typeof envelope.response === "string" ? envelope.response : "").trim();
  if (!content) {
    const reasoning = message.reasoning_content ?? message.reasoning;
    throw new Error(
      `empty content (finish_reason=${
        choice.finish_reason
      }) choice-keys=[${Object.keys(choice).join(",")}] content-type=${
        typeof choice.content
      } message-type=${typeof choice.message} reasoning=${
        typeof reasoning === "string"
          ? `${reasoning.length}ch: ${JSON.stringify(reasoning.slice(0, 150))}`
          : typeof reasoning
      }`,
    );
  }
  return content;
}

async function main() {
  const opts: Record<string, string> = {};
  for (let i = 0; i < Deno.args.length; i++) {
    const arg = Deno.args[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    if (i + 1 < Deno.args.length && !Deno.args[i + 1].startsWith("--")) {
      opts[key] = Deno.args[++i];
    } else {
      opts[key] = "true";
    }
  }
  const model = opts.model ?? "deepseek-flash";
  const base_url = opts["base-url"] ?? "https://api.deepseek.com";
  const keyEnv = opts["api-key-env"] ?? "DEEPSEEK_API_KEY";
  const apiKey = Deno.env.get(keyEnv) ?? "";
  if (!apiKey) throw new Error(`needs ${keyEnv} in the environment`);
  const schemeArg = opts.schemes ?? "all";
  const schemes = schemeArg === "all"
    ? SCHEMES
    : SCHEMES.filter((s) => schemeArg.split(",").includes(s.id));
  const runs = parseInt(opts.runs ?? "1", 10);

  const entries: MaskedEntry[] = Deno.readTextFileSync(
    ROOT + "data/masked.jsonl",
  )
    .split("\n").filter(Boolean).map((line) => JSON.parse(line))
    .filter((e: MaskedEntry) =>
      e.src === (opts.direction ?? "id-en").split("-")[0] &&
      e.tgt === (opts.direction ?? "id-en").split("-")[1]
    );

  // Workers AI documents 300 req/min for default-tier Text Generation models
  // and 20 req/min for paid-plan models; --rpm caps request starts under
  // either, --concurrency bounds in-flight requests, and the 429 +
  // Retry-After backoff in translate() is the backstop.
  const concurrency = Math.max(1, parseInt(opts.concurrency ?? "4", 10));
  const rpm = Math.max(1, parseFloat(opts.rpm ?? "240"));
  let lastStartMs = 0;
  const rateGate = async () => {
    for (;;) {
      const now = Date.now();
      const waitMs = lastStartMs + 60_000 / rpm - now;
      if (waitMs <= 0) {
        lastStartMs = now;
        return;
      }
      await sleep(waitMs);
    }
  };

  console.log(
    `spike: ${model} @ ${base_url} | ${entries.length} id->en segments | schemes: ${
      schemes.map((s) => s.id).join(",")
    } | concurrency ${concurrency} · cap ${rpm} rpm`,
  );

  let inFlight = 0;
  for (const scheme of schemes) {
    const failures: Failure[] = [];
    let passed = 0;
    let attempted = 0;
    // every (run, segment) pair must survive — intermittent drops count as failures
    const tasks: { run: number; entry: MaskedEntry }[] = [];
    for (let run = 0; run < runs; run++) {
      for (const entry of entries) tasks.push({ run, entry });
    }
    const progress = () =>
      emitProgress(
        model,
        "running",
        attempted,
        tasks.length,
        `${scheme.id}: ${attempted}/${tasks.length} done · ${inFlight} in flight`,
      );
    let cursor = 0;
    const worker = async () => {
      for (;;) {
        const index = cursor++;
        if (index >= tasks.length) return;
        const { run, entry } = tasks[index];
        await rateGate();
        inFlight++;
        progress();
        const { source, expected } = maskPlain(
          entry.plain,
          entry.names,
          scheme,
        );
        let raw: string | undefined;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            raw = await translate(
              base_url,
              apiKey,
              model,
              systemPrompt(scheme, entry.src, entry.tgt),
              source,
              opts["cloudflare-chat"] === "true",
            );
            break;
          } catch (e) {
            if (attempt === 2) {
              failures.push({
                id: `${entry.id}#r${run}`,
                failures: [String(e).slice(0, 160)],
                raw: "",
              });
            } else {
              // empty content and timeouts proved transient — the identical
              // request succeeds minutes later — so back off before retrying
              await sleep(4_000 + Math.random() * 5_000);
            }
          }
        }
        inFlight--;
        attempted++;
        if (raw !== undefined) {
          const problems: string[] = [];
          if (scheme.id === "real") {
            for (const name of entry.names) {
              const have = countFormOccurrences(raw, name.form);
              if (have < name.count) {
                problems.push(
                  `name lost: ${name.form} expected ${name.count}, found ${have}`,
                );
              }
            }
          } else {
            const got = countMatches(raw, scheme.marker);
            for (const [index, count] of expected) {
              const found = got.get(index) ?? 0;
              if (found < count) {
                problems.push(
                  `marker ${
                    scheme.token(index)
                  } missing: expected ${count}, found ${found}`,
                );
              }
            }
            for (const [index, count] of got) {
              if (!expected.has(index)) {
                problems.push(`renumbered marker index ${index} (x${count})`);
              }
            }
            // restoration must bring every name back
            const restored = raw.replace(scheme.marker, (_m, digits) => {
              const name = entry.names.find((n) =>
                n.index === parseInt(digits, 10)
              );
              return name ? name.form : _m;
            });
            for (const name of entry.names) {
              const have = countFormOccurrences(restored, name.form);
              if (have < name.count) {
                problems.push(
                  `name lost after restore: ${name.form} expected ${name.count}, found ${have}`,
                );
              }
            }
          }
          if (problems.length === 0) passed++;
          else {
            failures.push({
              id: `${entry.id}#r${run}`,
              failures: problems,
              raw,
            });
          }
        }
        progress();
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(concurrency, tasks.length) }, worker),
    );
    // parallel completion order is nondeterministic — report stably
    failures.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const verdict = passed === attempted ? "PASS" : "FAIL";
    emitProgress(
      model,
      verdict === "PASS" ? "complete" : "failed",
      attempted,
      attempted,
      `${scheme.id} ${passed}/${attempted}`,
    );
    console.log(`\n${scheme.id.padEnd(11)} ${passed}/${attempted} ${verdict}`);
    for (const failure of failures) {
      console.log(`  ${failure.id}: ${failure.failures.join(" | ")}`);
      console.log(`    raw: ${JSON.stringify(failure.raw.slice(0, 110))}`);
    }
  }
}

await main();
