#!/usr/bin/env python3
"""Build site/src/data/results.json for the benchmark-results website.

Reads results/*.json plus the scored token-survival matrix
(results/token-survival.json, emitted by `eval/token_survival.py` — the single
scoring implementation) and emits a single JSON document consumed by the Vite
site in site/.

Main tables cover only default-testset runs; masked-testset runs appear only
through the scored survival matrix. Samples are capped at the best/worst 5 by
chrF per run to keep the payload small.

Usage: python3 eval/build_site_data.py
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

OUT = ROOT / "site" / "src" / "data" / "results.json"
SURVIVAL_JSON = ROOT / "results" / "token-survival.json"

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


def survival_rows() -> list[dict]:
    """The scored masked-run matrix from eval/token_survival.py (single scoring
    implementation), with provider labels attached per row."""
    if not SURVIVAL_JSON.exists():
        raise SystemExit(f"missing {SURVIVAL_JSON}; run `python3 eval/token_survival.py` first")
    data = json.loads(SURVIVAL_JSON.read_text(encoding="utf-8"))
    rows = []
    for row in data["runs"]:
        provider, hosted = provider_of(row)
        rows.append({**row, "provider": provider, "hosted": hosted})
    return rows


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
    for path in sorted((ROOT / "results").glob("*.json")):
        if path.name == SURVIVAL_JSON.name:
            continue  # the scored matrix, not a run
        payload = json.loads(path.read_text(encoding="utf-8"))
        if payload.get("testset", "testset.jsonl").startswith("masked"):
            continue  # masked runs surface only through the scored survival matrix
        direction = f"{payload['src']}->{payload['tgt']}"
        main_runs.setdefault(direction, []).append(run_row(payload))

    survival = survival_rows()

    directions = []
    for direction in sorted(main_runs):
        rows = sorted(main_runs[direction], key=lambda r: r["metrics"]["chrf"], reverse=True)
        mark_best(rows)
        survival_rows_for_direction = sorted(
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
                "token_survival": survival_rows_for_direction,
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
