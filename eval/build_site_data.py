#!/usr/bin/env python3
"""Build site/src/data/results.json for the benchmark-results website.

Reads results/*.json (plus data/masked.jsonl truth for the token-survival
stats, scored by reusing eval/token_survival.py directly) and emits a single
JSON document consumed by the Vite site in site/.

Main tables cover only default-testset runs; masked-testset runs are scored
for name-token survival instead. Samples are capped at the best/worst 5 by
chrF per run to keep the payload small.

Usage: python3 eval/build_site_data.py
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "eval"))

import metrics  # noqa: E402
import token_survival  # noqa: E402

OUT = ROOT / "site" / "src" / "data" / "results.json"
MASKED_TESTSET = ROOT / "data" / "masked.jsonl"

# backend -> (provider label, hosted)
PROVIDERS = {
    "qwen": ("Qwen MT (hosted API)", True),
    "openai": ("Qwen Chat (hosted API)", True),
    "cloudflare": ("Cloudflare Workers AI", True),
    "cloudflare-chat": ("Cloudflare Workers AI", True),
    "cloudflare-deno": ("Cloudflare Workers AI", True),
    "kagi": ("Kagi Translate", True),
    "ollama": ("Local (Ollama)", False),
}

# openai-compat runs are shared by several hosted gateways; the result-file
# label prefix (see scripts/run-providers.sh) says which one served the run
OPENAI_LABEL_PROVIDERS = {
    "or-": "OpenRouter",
    "ds-": "DeepSeek (official API)",
    "cl-": "Cline",
    "oc-": "OpenCode Zen",
}


def provider_of(payload: dict) -> tuple[str, bool]:
    provider, hosted = PROVIDERS.get(payload["backend"], (payload["backend"], True))
    if payload["backend"] == "openai":
        for prefix, label in OPENAI_LABEL_PROVIDERS.items():
            if payload["label"].startswith(prefix):
                return label, hosted
    return provider, hosted

SAMPLE_CAP = 5  # best N and worst N by chrF per run


def load_jsonl(path: Path) -> dict:
    truth = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            entry = json.loads(line)
            truth[entry["id"]] = entry
    return truth


def capped_samples(samples: list[dict]) -> tuple[list[dict], bool]:
    """Best N then worst N by chrF (deduped by id); everything when the run is small.

    Returns (samples, capped).
    """
    if len(samples) <= 2 * SAMPLE_CAP:
        return samples, False
    ranked = sorted(samples, key=lambda s: s["chrf"], reverse=True)
    keep = {s["id"] for s in ranked[:SAMPLE_CAP]} | {s["id"] for s in ranked[-SAMPLE_CAP:]}
    return [s for s in samples if s["id"] in keep], True


def run_row(payload: dict) -> dict:
    provider, hosted = provider_of(payload)
    row = {
        "label": payload["label"],
        "file": f"{payload['label']}.json",
        "backend": payload["backend"],
        "model": payload["model"],
        "prompt_style": payload["prompt_style"],
        "provider": provider,
        "hosted": hosted,
        "pairs": payload["pairs"],
        "metrics": payload["metrics"],
        "metric_backend": payload["metric_backend"],
        "exact_match_rate": payload.get("exact_match_rate"),
        "seconds_per_sentence": payload.get("seconds_per_sentence"),
        "timestamp": payload.get("timestamp"),
        "chrf_by_category": payload.get("chrF_by_category", {}),
        "samples_capped": False,  # filled below
        "samples": [],
        "best": {},  # filled per direction below
    }
    row["samples"], row["samples_capped"] = capped_samples(payload["samples"])
    return row


def survival_row(path: Path, payload: dict, truth: dict) -> dict:
    """Score a masked run via eval/token_survival.py (shared logic, no reimplementation)."""
    samples = payload["samples"]
    passed = 0
    restored_texts, references, failures = [], [], []
    for sample in samples:
        entry = truth[sample["id"]]
        ok, seg_failures, restored = token_survival.score_segment(
            sample["hypothesis"], entry
        )
        if ok:
            passed += 1
        else:
            failures.append(
                {"id": sample["id"], "failures": seg_failures, "hypothesis": sample["hypothesis"]}
            )
        restored_texts.append(restored)
        references.append(entry["reference"])
    corpus = metrics.score_all(restored_texts, references)
    provider, hosted = provider_of(payload)
    return {
        "label": payload["label"],
        "file": path.name,
        "model": payload["model"],
        "prompt_style": payload["prompt_style"],
        "provider": provider,
        "hosted": hosted,
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


def mark_best(rows: list[dict]) -> None:
    """Flag the best value per numeric column across a direction's runs."""
    if not rows:
        return
    for key in ("chrf", "chrfpp", "bleu"):
        best = max(r["metrics"].get(key, 0) for r in rows)
        for r in rows:
            if r["metrics"].get(key) == best:
                r["best"][key] = True
    fastest = min(r["seconds_per_sentence"] for r in rows if r["seconds_per_sentence"] is not None)
    for r in rows:
        if r["seconds_per_sentence"] == fastest:
            r["best"]["speed"] = True


def main() -> None:
    main_runs: dict[str, list[dict]] = {}
    masked_runs: list[tuple[Path, dict]] = []
    for path in sorted((ROOT / "results").glob("*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        if payload.get("testset", "testset.jsonl") != "testset.jsonl":
            masked_runs.append((path, payload))
        else:
            direction = f"{payload['src']}->{payload['tgt']}"
            main_runs.setdefault(direction, []).append(run_row(payload))

    truth = load_jsonl(MASKED_TESTSET)
    survival = [survival_row(path, payload, truth) for path, payload in masked_runs]

    directions = []
    for direction in sorted(main_runs):
        rows = sorted(main_runs[direction], key=lambda r: r["metrics"]["chrf"], reverse=True)
        mark_best(rows)
        best_run = rows[0]
        survival_rows = sorted(
            (s for s in survival if s["direction"] == direction),
            key=lambda s: (-s["passed"] / s["total"], s["model"]),
        )
        src, tgt = direction.split("->")
        directions.append(
            {
                "direction": direction,
                "src": src,
                "tgt": tgt,
                "runs": rows,
                "best_run": {
                    "label": rows[0]["label"],
                    "file": rows[0]["file"],
                    "chrf_by_category": rows[0]["chrf_by_category"],
                },
                "token_survival": survival_rows,
            }
        )

    data = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "directions": directions,
        "token_survival": sorted(
            survival, key=lambda s: (s["direction"], -s["passed"] / s["total"], s["model"])
        ),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    size = OUT.stat().st_size
    runs = sum(len(d["runs"]) for d in directions)
    print(f"wrote {OUT} ({size} bytes, {len(directions)} directions, {runs} main runs, "
          f"{len(survival)} masked runs)")


if __name__ == "__main__":
    main()
