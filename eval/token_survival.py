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

Output: `results/token-survival.json` (consumed by `eval/build_site_data.py`;
the results site renders it). Use `--json -` to print instead of writing.

Usage:
  python3 eval/token_survival.py                       # score -> results/token-survival.json
  python3 eval/token_survival.py --glob 'results/x.json' --json -
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "eval"))

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


def score_run(path: Path, payload: dict, truth: dict) -> dict:
    """Score one masked-set result file into the shared JSON shape."""
    samples = payload["samples"]
    passed = 0
    restored_texts: list[str] = []
    references: list[str] = []
    failures: list[dict] = []
    for sample in samples:
        entry = truth[sample["id"]]
        ok, seg_failures, restored = score_segment(sample["hypothesis"], entry)
        if ok:
            passed += 1
        else:
            failures.append(
                {"id": sample["id"], "failures": seg_failures, "hypothesis": sample["hypothesis"]}
            )
        restored_texts.append(restored)
        references.append(entry["reference"])
    corpus = metrics.score_all(restored_texts, references)
    return {
        "label": payload["label"],
        "file": path.name,
        "model": payload["model"],
        "prompt_style": payload["prompt_style"],
        "backend": payload["backend"],
        "direction": f"{payload['src']}->{payload['tgt']}",
        "passed": passed,
        "total": len(samples),
        "verdict": "PASS" if passed == len(samples) else "FAIL",
        "restored_chrf": corpus["chrf"],
        "restored_chrfpp": corpus["chrfpp"],
        "restored_bleu": corpus["bleu"],
        "failures": failures,
        "timestamp": payload.get("timestamp"),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--glob", default="results/*-masked*.json",
                        help="result files to score (default results/*-masked*.json)")
    parser.add_argument("--testset", default=str(ROOT / "data" / "masked.jsonl"))
    parser.add_argument("--json", default=str(ROOT / "results" / "token-survival.json"),
                        help="output path for the scored matrix ('-' prints to stdout)")
    args = parser.parse_args()

    truth: dict[str, dict] = {}
    for line in Path(args.testset).read_text(encoding="utf-8").splitlines():
        if line.strip():
            entry = json.loads(line)
            truth[entry["id"]] = entry

    paths = sorted(ROOT.glob(args.glob) if not args.glob.startswith("/") else [Path(args.glob)])
    runs = [score_run(path, json.loads(path.read_text(encoding="utf-8")), truth) for path in paths]
    if not runs:
        raise SystemExit(f"no result files match {args.glob}")

    runs.sort(key=lambda r: (r["direction"], -r["passed"] / r["total"], r["model"]))
    body = json.dumps({"runs": runs}, ensure_ascii=False, indent=1)
    if args.json == "-":
        print(body)
    else:
        Path(args.json).write_text(body + "\n", encoding="utf-8")
        print(f"wrote {args.json} ({len(runs)} masked runs)")
    for row in runs:
        print(f"{row['direction']:6s} {row['model']:32s} {row['prompt_style']:16s} "
              f"{row['passed']}/{row['total']:2d} {row['verdict']:4s} restored-chrF {row['restored_chrf']}")


if __name__ == "__main__":
    main()
