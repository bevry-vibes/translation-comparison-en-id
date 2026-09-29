#!/usr/bin/env python3
"""Build site/src/data/results.json for the benchmark-results website.

Inputs (all in-repo, single-sourced):
  - results/*.json                one benchmark run per file
  - results/token-survival.json   the scored masked-name matrix (eval/token_survival.py)
  - docs/recommendation.json      the current model recommendation (mirrored by the survey)
  - eval/backends.py              the verbatim prompt templates (imported, never copied)
  - eval/providers.py             the provider manifest (labels, endpoints, gateway flags)

Emits one JSON document consumed by the Vite site in site/. Main tables cover
only default-testset runs (any testset-*.jsonl); masked runs surface through
the survival matrix. Samples are capped at the best/worst 5 by chrF per run.

Usage: python3 eval/build_site_data.py
"""

from __future__ import annotations

import json
import shlex
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "eval"))

import backends  # noqa: E402
import providers  # noqa: E402

OUT = ROOT / "site" / "src" / "data" / "results.json"
SURVIVAL_JSON = ROOT / "results" / "token-survival.json"
RECOMMENDATION_JSON = ROOT / "docs" / "recommendation.json"

SAMPLE_CAP = 5  # best N and worst N by chrF per run

PROMPT_DESCRIPTIONS = {
    "engine": "the production translation-engine system instruction; the raw source text is the user message",
    "engine-preserve": "engine plus an explicit keep-the-protection-tokens-verbatim clause (masked segments)",
    "none": "raw source text only — dedicated NMT models; the qwen-mt family adds translation_options",
    "generic": "plain translate-this instruction for general local LLMs",
    "translate_gemma": "the template from the TranslateGemma technical report (its evaluation prompt)",
    "hymt2": "Tencent Hy-MT's instruction wording",
}


def provider_of(payload: dict) -> tuple[str, bool]:
    """(provider label, hosted) for a run payload."""
    backend = payload["backend"]
    entry, is_openai = providers.openai_provider_for(payload["label"])
    if is_openai and entry:
        return entry["label"], True
    info = providers.BACKENDS.get(backend, {})
    return info.get("label", backend), info.get("hosted", True)


def replication_for(payload: dict) -> dict:
    """A ready-to-run recipe for one run: command + request shape + notes."""
    label, model, src, tgt = payload["label"], payload["model"], payload["src"], payload["tgt"]
    style = payload["prompt_style"]
    backend = payload["backend"]
    entry, is_openai = providers.openai_provider_for(label)
    py = ".venv/bin/python eval/run_eval.py"
    if is_openai and entry:
        kwargs = entry["chat_kwargs"]
        kwargs_arg = f" --chat-kwargs-json {shlex.quote(json.dumps(kwargs))}" if kwargs else ""
        command = (
            f"{py} --backend openai --model {model} --base-url {entry['base_url']} "
            f"--api-key \"${entry['key_env']}\"{kwargs_arg} --max-tokens {entry['max_tokens']} "
            f"--prompt-style {style} --src {src} --tgt {tgt} --name {label}"
        )
        return {
            "command": command,
            "base_url": entry["base_url"],
            "key_env": entry["key_env"],
            "chat_kwargs": kwargs or None,
            "max_tokens": entry["max_tokens"],
            "notes": [entry["note"]] if entry.get("note") else [],
        }
    if backend == "qwen":
        target = "English" if tgt == "en" else "Indonesian"
        body = {
            "model": model,
            "messages": [{"role": "user", "content": "<raw source text>"}],
            "translation_options": {"source_lang": "auto", "target_lang": target},
        }
        return {
            "command": f"{py} --backend qwen --model {model} --prompt-style none "
                       f"--src {src} --tgt {tgt} --name {label}",
            "base_url": providers.BACKENDS["qwen"]["base_url"],
            "key_env": "QWENCLOUD_API_KEY",
            "request_body": body,
            "notes": ["no prompt: the qwen-mt contract is the raw text plus translation_options"],
        }
    if backend in ("cloudflare", "cloudflare-chat"):
        sub = "cloudflare" if backend == "cloudflare" else "cloudflare-chat"
        return {
            "command": f"{py} --backend {sub} --model '{model}' --prompt-style {style} "
                       f"--src {src} --tgt {tgt} --name {label}",
            "key_env": "CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID",
            "notes": [],
        }
    if backend == "kagi":
        return {
            "command": f"{py} --backend kagi --kagi-runtime python --prompt-style none "
                       f"--src {src} --tgt {tgt} --name {label}",
            "key_env": "KAGI_SESSION + KAGI_CLIENT_REPO",
            "notes": ["drives translate.kagi.com through bevry-vibes/kagi-translate-client"],
        }
    if backend == "ollama":
        return {
            "command": f"{py} --backend ollama --model '{model}' --prompt-style {style} "
                       f"--src {src} --tgt {tgt} --name {label}",
            "base_url": "http://127.0.0.1:11434",
            "notes": ["local model: wrap big loads in eval/memguard.py (run_eval does)"],
        }
    return {"command": f"# no replication recipe for backend {backend!r}", "notes": []}


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
        "testset": payload.get("testset", "testset.jsonl"),
        "metrics": payload["metrics"],
        "metric_backend": payload["metric_backend"],
        "exact_match_rate": payload.get("exact_match_rate"),
        "seconds_per_sentence": payload.get("seconds_per_sentence"),
        "timestamp": payload.get("timestamp"),
        "chrf_by_category": payload.get("chrF_by_category", {}),
        "samples_capped": False,  # filled below
        "samples": [],
        "replication": replication_for(payload),
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


def prompt_catalogue() -> dict:
    """The verbatim prompt templates, generated from eval/backends.py (never copied)."""
    placeholder = "SOURCE_TEXT_GOES_HERE"
    catalogue = {}
    for style in ("generic", "translate_gemma", "hymt2", "none"):
        catalogue[style] = {
            "description": PROMPT_DESCRIPTIONS[style],
            "user_message": backends.build_prompt(placeholder, "id", "en", style),
            "system_message": None,
        }
    for style in ("engine", "engine-preserve"):
        system = (backends.engine_system_prompt("id", "en") if style == "engine"
                  else backends.engine_preserve_system_prompt("id", "en"))
        catalogue[style] = {
            "description": PROMPT_DESCRIPTIONS[style],
            "user_message": "<raw source text>",
            "system_message": system,
        }
    catalogue["qwen-mt-request"] = {
        "description": "the qwen-mt family takes no prompt: the raw text plus translation_options",
        "request_body": {
            "model": "qwen-mt-*",
            "messages": [{"role": "user", "content": "<raw source text>"}],
            "translation_options": {"source_lang": "auto", "target_lang": "English | Indonesian"},
        },
    }
    return catalogue


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
    recommendation = json.loads(RECOMMENDATION_JSON.read_text(encoding="utf-8"))

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
        "prompts": prompt_catalogue(),
        "recommendation": recommendation,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    size = OUT.stat().st_size
    runs = sum(len(d["runs"]) for d in directions)
    print(f"wrote {OUT} ({size} bytes, {len(directions)} directions, {runs} main runs, "
          f"{len(survival)} masked runs)")


if __name__ == "__main__":
    main()
