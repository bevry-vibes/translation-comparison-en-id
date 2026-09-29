#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
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

interface MaskedEntry {
  id: string;
  src: string;
  tgt: string;
  plain: string;
  names: { form: string; index: number; count: number }[];
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
    // Workers AI run path: account/model ride the URL, message-array body
    const accountId = Deno.env.get("CLOUDFLARE_ACCOUNT_ID") ?? "";
    url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
    requestBody = { messages, stream: false };
  }
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 200)}`,
    );
  }
  const envelope = (cloudflareChat ? payload.result ?? {} : payload) as Record<string, unknown>;
  const message = ((envelope.choices as Record<string, unknown>[] | undefined)?.[0] ?? {}) as Record<string, unknown>;
  const content = (
    (typeof message.content === "string" ? message.content : "").trim() ||
    (typeof envelope.response === "string" ? envelope.response : "").trim()
  );
  if (!content) {
    throw new Error(
      `empty content (finish_reason=${(envelope.choices as Record<string, unknown>[] | undefined)?.[0]?.finish_reason})`,
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
    .filter((e: MaskedEntry) => e.src === (opts.direction ?? "id-en").split("-")[0] && e.tgt === (opts.direction ?? "id-en").split("-")[1]);

  console.log(
    `spike: ${model} @ ${base_url} | ${entries.length} id->en segments | schemes: ${
      schemes.map((s) => s.id).join(",")
    }`,
  );

  for (const scheme of schemes) {
    const failures: Failure[] = [];
    let passed = 0;
    let attempted = 0;
    // every (run, segment) pair must survive — intermittent drops count as failures
    for (let run = 0; run < runs; run++) {
      for (const entry of entries) {
        attempted++;
        const { source, expected } = maskPlain(
          entry.plain,
          entry.names,
          scheme,
        );
        let raw: string;
        try {
          raw = await translate(
            base_url,
            apiKey,
            model,
            systemPrompt(scheme, entry.src, entry.tgt),
            source,  // spike: cloudflare-chat posts the run-path shape
            opts["cloudflare-chat"] === "true",
          );
        } catch (e) {
          failures.push({
            id: `${entry.id}#r${run}`,
            failures: [String(e).slice(0, 160)],
            raw: "",
          });
          continue;
        }
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
        else {failures.push({
            id: `${entry.id}#r${run}`,
            failures: problems,
            raw,
          });}
      }
    }
    const verdict = passed === attempted ? "PASS" : "FAIL";
    console.log(`\n${scheme.id.padEnd(11)} ${passed}/${attempted} ${verdict}`);
    for (const failure of failures) {
      console.log(`  ${failure.id}: ${failure.failures.join(" | ")}`);
      console.log(`    raw: ${JSON.stringify(failure.raw.slice(0, 110))}`);
    }
  }
}

await main();
