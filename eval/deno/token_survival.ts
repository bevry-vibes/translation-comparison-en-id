#!/usr/bin/env -S deno run --allow-read --allow-write
/** Score token survival for masked-name translation runs.
 *
 * Mirrors patipeaceplace's name-protection contract (`protectTerms` /
 * `restoreTerms` / `assertNamesSurvived`) for the bracket-marker scheme
 * ([[n]] since 2026-09-29; the PUA-token era is archived under
 * results/archive/masked-pua-2026-09-29/). For every hypothesis (the raw
 * provider output on masked text) it checks:
 *
 * 1. every expected marker ([[n]]) is present at least as often as the source
 *    carried it;
 * 2. no marker was renumbered, and no stray/unbalanced bracket markers remain
 *    (mangled or half-deleted markers);
 * 3. after restoring markers to their name forms, every name still occurs at
 *    least as often as in the source.
 *
 * A segment passes only when all three hold; the run verdict is strict. Writes
 * `results/token-survival.json` (the results site's survival matrix input).
 *
 * Usage: deno run -A eval/deno/token_survival.ts [--glob 'results/*-masked*.json']
 */

import { perSentenceChrf, scoreAll } from "./metrics.ts";

const ROOT = new URL("../../", import.meta.url).pathname;
const TOKEN_RE = /\[\[(\d+)\]\]/g;
const MARKER_OPEN_RE = /\[\[/g;
const MARKER_CLOSE_RE = /\]\]/g;
const MARKER_CHARS_RE = /\[\[|\]\]/g;

interface TruthName {
  index: number;
  form: string;
  count: number;
}
interface TruthEntry {
  id: string;
  names: TruthName[];
  reference: string;
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

function restore(
  text: string,
  byIndex: Map<number, string>,
): { restored: string; unknown: number[] } {
  const unknown: number[] = [];
  const restored = text.replace(TOKEN_RE, (match, digits: string) => {
    const index = parseInt(digits, 10);
    const form = byIndex.get(index);
    if (form === undefined) {
      unknown.push(index);
      return match;
    }
    return form;
  });
  return { restored, unknown };
}

interface SegmentScore {
  passed: boolean;
  failures: string[];
  restored: string;
}

function scoreSegment(hypothesis: string, truth: TruthEntry): SegmentScore {
  const failures: string[] = [];
  const expected = new Map<number, TruthName>(
    truth.names.map((n) => [n.index, n]),
  );
  const counts = new Map<number, number>();
  for (const match of hypothesis.matchAll(TOKEN_RE)) {
    const index = parseInt(match[1], 10);
    counts.set(index, (counts.get(index) ?? 0) + 1);
  }
  for (const [index, name] of expected) {
    const found = counts.get(index) ?? 0;
    if (found < name.count) {
      failures.push(
        `missing token [[${index}]] (${name.form}): expected ${name.count}, found ${found}`,
      );
    }
  }
  for (const index of counts.keys()) {
    if (!expected.has(index)) {
      failures.push(`renumbered/unknown token index ${index}`);
    }
  }
  // Well-formed markers carry exactly one opener and one closer each; anything
  // beyond them is a stray (mangled or half-deleted marker).
  const openers = (hypothesis.match(MARKER_OPEN_RE) ?? []).length;
  const closers = (hypothesis.match(MARKER_CLOSE_RE) ?? []).length;
  const wellFormed = [...counts.values()].reduce((a, b) => a + b, 0);
  if (openers > wellFormed || closers > wellFormed) {
    failures.push(
      `stray bracket markers: ${openers - wellFormed} unclosed / ${
        closers - wellFormed
      } unopened beyond the ${wellFormed} well-formed markers`,
    );
  }

  const byIndex = new Map<number, string>(
    [...expected].map(([i, n]) => [i, n.form]),
  );
  const { restored, unknown } = restore(hypothesis, byIndex);
  for (const index of unknown) {
    failures.push(`unrestorable token index ${index} survived restoration`);
  }
  if (MARKER_CHARS_RE.test(restored)) {
    failures.push("protection markers remained after restoration");
  }
  for (const name of expected.values()) {
    const have = countFormOccurrences(restored, name.form);
    if (have < name.count) {
      failures.push(
        `name did not survive restoration: ${
          JSON.stringify(name.form)
        } expected ${name.count}, restored text has ${have}`,
      );
    }
  }
  return { passed: failures.length === 0, failures, restored };
}

function main() {
  const glob = Deno.args.find((a) => a.startsWith("--glob="))?.slice(8) ??
    "results/*-masked*.json";
  const testsetPath =
    Deno.args.find((a) => a.startsWith("--testset="))?.slice(10) ??
      ROOT + "data/masked.jsonl";

  const truth = new Map<string, TruthEntry>();
  for (const line of Deno.readTextFileSync(testsetPath).split("\n")) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line);
    truth.set(entry.id, entry);
  }

  const paths = [...Deno.readDirSync(ROOT + "results")]
    .filter((e) =>
      e.isFile && !glob.startsWith("/") && matches(e.name, glob) ||
      glob.startsWith("/")
    )
    .map((e) => ROOT + "results/" + e.name)
    .sort();
  if (paths.length === 0) throw new Error(`no result files match ${glob}`);

  const runs = paths.map((path) => {
    const payload = JSON.parse(Deno.readTextFileSync(path));
    const samples = payload.samples as { id: string; hypothesis: string }[];
    let passed = 0;
    const restoredTexts: string[] = [];
    const references: string[] = [];
    const failures: { id: string; failures: string[]; hypothesis: string }[] =
      [];
    for (const sample of samples) {
      const entry = truth.get(sample.id);
      if (!entry) throw new Error(`masked truth missing for ${sample.id}`);
      const score = scoreSegment(sample.hypothesis, entry);
      if (score.passed) passed++;
      else {failures.push({
          id: sample.id,
          failures: score.failures,
          hypothesis: sample.hypothesis,
        });}
      restoredTexts.push(score.restored);
      references.push(entry.reference);
    }
    const corpus = scoreAll(restoredTexts, references);
    return {
      label: payload.label,
      file: path.split("/").pop(),
      model: payload.model,
      prompt_style: payload.prompt_style,
      backend: payload.backend,
      direction: `${payload.src}->${payload.tgt}`,
      passed,
      total: samples.length,
      verdict: passed === samples.length ? "PASS" : "FAIL",
      restored_chrf: corpus.chrf,
      restored_chrfpp: corpus.chrfpp,
      restored_bleu: corpus.bleu,
      failures,
      timestamp: payload.timestamp ?? null,
    };
  });

  runs.sort((a, b) =>
    a.direction.localeCompare(b.direction) ||
    (b.passed / b.total) - (a.passed / a.total) ||
    a.model.localeCompare(b.model)
  );
  const out = ROOT + "results/token-survival.json";
  Deno.writeTextFileSync(out, JSON.stringify({ runs }, null, 1) + "\n");
  console.log(`wrote ${out} (${runs.length} masked runs)`);
  for (const row of runs) {
    console.log(
      `${row.direction.padEnd(6)} ${row.model.padEnd(32)} ${
        row.prompt_style.padEnd(16)
      } ` +
        `${row.passed}/${row.total} ${
          row.verdict.padEnd(4)
        } restored-chrF ${row.restored_chrf}`,
    );
  }
}

/** tiny glob: only `*` wildcards, which is all the default patterns need */
function matches(name: string, glob: string): boolean {
  const bare = glob.includes("/") ? glob.split("/").pop()! : glob;
  const re = new RegExp(
    "^" + bare.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
  );
  return re.test(name);
}

main();
