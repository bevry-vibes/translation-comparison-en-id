#!/usr/bin/env python3
"""Score token survival for masked-name translation runs.

Reads result files produced by `run_eval.py --testset data/masked.jsonl`, and
for every hypothesis (the raw provider output on masked text) checks, exactly
mirroring patipeaceplace's name-protection contract (`protectTerms` /
`restoreTerms` / `assertNamesSurvived`):

1. every expected placeholder token (U+E000 + <index> + U+E001) is present at
   least as often as the source carried it;
2. no token was renumbered to an index the segment never had, and no stray
   private-use characters remain beyond the expected well-formed tokens;
3. after restoring tokens to their name forms, every name still occurs at
   least as often as in the source (word-boundary, case-sensitive, plus the
   sentence-initial Capitalised variant, like production).

A segment passes only when all three hold. The corpus-level verdict is strict:
any failing segment fails the run. Restored-vs-reference chrF is reported as a
secondary quality column.

Usage:
  python3 eval/token_survival.py                     # score results/*-masked-*.json
  python3 eval/token_survival.py --glob 'results/x.json'
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys_path = ROOT / "eval"
import sys  # noqa: E402

sys.path.insert(0, str(sys_path))

import metrics  # noqa: E402

TOKEN_START = "\uE000"
TOKEN_END = "\uE001"
TOKEN_RE = re.compile(f"{TOKEN_START}(\\d+){TOKEN_END}")
TOKEN_CHARS_RE = re.compile("[\uE000\uE001]")


def count_form_occurrences(text: str, form: str) -> int:
    """Production `countFormOccurrences`: word-boundary, case-sensitive, plus
    the sentence-initial Capitalised variant of a lowercase form."""
    patterns = {re.escape(form)}
    capitalised = form[:1].upper() + form[1:]
    if capitalised != form:
        patterns.add(re.escape(capitalised))
    count = 0
    for pattern in patterns:
        count += len(re.findall(rf"\b{pattern}\b", text))
    return count


def restore(text: str, by_index: dict[int, str]) -> tuple[str, list[int]]:
    """Production `restoreTerms`; unknown indices are left in place and reported."""
    unknown: list[int] = []

    def repl(match: re.Match) -> str:
        index = int(match.group(1))
        if index not in by_index:
            unknown.append(index)
            return match.group(0)
        return by_index[index]

    return TOKEN_RE.sub(repl, text), unknown


def score_segment(hypothesis: str, truth: dict) -> tuple[bool, list[str], str]:
    """Returns (passed, failure lines, restored text)."""
    failures: list[str] = []
    expected = {n["index"]: n for n in truth["names"]}
    total_expected = sum(n["count"] for n in truth["names"])

    counts: dict[int, int] = {}
    for match in TOKEN_RE.finditer(hypothesis):
        index = int(match.group(1))
        counts[index] = counts.get(index, 0) + 1
    for index, name in expected.items():
        found = counts.get(index, 0)
        if found < name["count"]:
            failures.append(
                f"missing token {TOKEN_START}{index}{TOKEN_END} ({name['form']}): "
                f"expected {name['count']}, found {found}"
            )
    for index in counts:
        if index not in expected:
            failures.append(f"renumbered/unknown token index {index}")
    # Well-formed tokens carry exactly two private-use characters; anything
    # beyond them is a stray (mangled or half-deleted token).
    pua_chars = len(TOKEN_CHARS_RE.findall(hypothesis))
    well_formed = sum(counts.values())
    if pua_chars > 2 * well_formed:
        failures.append(
            f"stray private-use characters: {pua_chars - 2 * well_formed} beyond "
            f"the {well_formed} well-formed tokens"
        )

    restored, unknown = restore(hypothesis, {i: n["form"] for i, n in expected.items()})
    for index in unknown:
        failures.append(f"unrestorable token index {index} survived restoration")
    if TOKEN_CHARS_RE.search(restored):
        failures.append("protection token characters remained after restoration")
    for name in expected.values():
        have = count_form_occurrences(restored, name["form"])
        if have < name["count"]:
            failures.append(
                f"name did not survive restoration: {name['form']!r} "
                f"expected {name['count']}, restored text has {have}"
            )
    return not failures, failures, restored


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--glob", default="results/*-masked*.json",
                        help="result files to score (default results/*-masked*.json)")
    parser.add_argument("--testset", default=str(ROOT / "data" / "masked.jsonl"))
    parser.add_argument("--out", default=str(ROOT / "results" / "token-survival.md"))
    args = parser.parse_args()

    truth = {}
    for line in Path(args.testset).read_text(encoding="utf-8").splitlines():
        if line.strip():
            entry = json.loads(line)
            truth[entry["id"]] = entry

    runs = []
    for path in sorted(ROOT.glob(args.glob) if not args.glob.startswith("/") else [Path(args.glob)]):
        payload = json.loads(path.read_text(encoding="utf-8"))
        runs.append((path, payload))
    if not runs:
        raise SystemExit(f"no result files match {args.glob}")

    lines = [
        "# Masked-name token survival",
        "",
        "Provider output on production-style masked segments (names wrapped in",
        "`U+E000 + index + U+E001`, longest-form-first glossary). A segment passes only",
        "when every expected token survives (right index, full count), nothing was",
        "renumbered or left behind, and every name round-trips through restoration.",
        "Verdicts are strict: one dropped name fails the run. chrF is restored",
        "hypothesis vs hand reference, a secondary quality hint only.",
        "",
    ]
    summary_rows = []
    for path, payload in runs:
        samples = payload["samples"]
        passed = 0
        restored_texts = []
        references = []
        details = []
        for sample in samples:
            entry = truth[sample["id"]]
            ok, failures, restored = score_segment(sample["hypothesis"], entry)
            if ok:
                passed += 1
            else:
                details.append((sample["id"], failures, sample["hypothesis"]))
            restored_texts.append(restored)
            references.append(entry["reference"])
        chrf = metrics.per_sentence_chrf(restored_texts, references)
        corpus = metrics.score_all(restored_texts, references)
        verdict = "PASS" if passed == len(samples) else "FAIL"
        summary_rows.append({
            "label": payload["label"], "model": payload["model"],
            "prompt": payload["prompt_style"], "direction": f"{payload['src']}->{payload['tgt']}",
            "passed": passed, "total": len(samples), "verdict": verdict,
            "chrf": round(corpus["chrf"], 2), "per_segment": chrf, "details": details,
            "path": path.name,
        })

    lines += [
        "| run | model | prompt | direction | survived | verdict | restored chrF | file |",
        "| --- | --- | --- | --- | ---: | --- | ---: | --- |",
    ]
    for row in sorted(summary_rows, key=lambda r: (r["direction"], -(r["passed"] / r["total"]), r["model"])):
        lines.append(
            f"| `{row['label']}` | `{row['model']}` | {row['prompt']} | {row['direction']} "
            f"| {row['passed']}/{row['total']} | **{row['verdict']}** | {row['chrf']} "
            f"| `{row['path']}` |"
        )

    for row in summary_rows:
        if not row["details"]:
            continue
        lines += ["", f"## {row['label']} ({row['direction']}) failures", ""]
        for segment_id, failures, hypothesis in row["details"]:
            lines.append(f"- `{segment_id}`:")
            for failure in failures:
                lines.append(f"  - {failure}")
            lines.append(f"  - raw hypothesis: {hypothesis!r}")

    Path(args.out).write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {args.out}")
    print()
    for row in sorted(summary_rows, key=lambda r: (r["direction"], -(r["passed"] / r["total"]))):
        print(f"{row['direction']:6s} {row['model']:24s} {row['prompt']:16s} "
              f"{row['passed']}/{row['total']:2d} {row['verdict']:4s} restored-chrF {row['chrf']}")


if __name__ == "__main__":
    main()
