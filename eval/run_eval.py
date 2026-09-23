#!/usr/bin/env python3
"""Benchmark a local/free Indonesian<->English translation backend.

Examples:
  # Ollama (TranslateGemma uses its own recommended prompt template)
  python3 eval/run_eval.py --backend ollama --model translategemma:4b \
      --prompt-style translate_gemma --src id --tgt en --name translategemma-4b

  # Any OpenAI-compatible server (LM Studio, llama-server, vLLM)
  python3 eval/run_eval.py --backend openai --model Hy-MT2-1.8B \
      --base-url http://127.0.0.1:8080/v1 --prompt-style hymt2 --src id --tgt en

  # Dedicated NMT via transformers (NLLB / M2M-100 / MADLAD / OPUS-MT)
  python3 eval/run_eval.py --backend transformers --model facebook/nllb-200-distilled-600M \
      --family nllb --prompt-style none --src id --tgt en

  # Cloudflare Workers AI (official SDK; needs CLOUDFLARE_API_TOKEN +
  # CLOUDFLARE_ACCOUNT_ID in the environment, i.e. `set -a; . ./.env; set +a`)
  python3 eval/run_eval.py --backend cloudflare --model @cf/meta/m2m100-1.2b \
      --prompt-style none --src id --tgt en --name cf-m2m100-1.2b

  # Kagi Translate via bevry-vibes/kagi-translate-client (needs KAGI_SESSION and
  # KAGI_CLIENT_REPO in the environment; --kagi-runtime python|deno picks the CLI)
  python3 eval/run_eval.py --backend kagi --kagi-runtime python \
      --prompt-style none --src id --tgt en --name kagi-py

Hosted backends (cloudflare, kagi) load no local model, so the memguard RAM fit
check is skipped for them; the one-benchmark-at-a-time run lock still applies.
Raw results land in results/*.json; `python3 eval/summarize.py` renders results/results.md.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import memguard  # noqa: E402
import metrics  # noqa: E402
from backends import (  # noqa: E402
    ArgosBackend, CloudflareBackend, KagiBackend, OllamaBackend, OpenAICompatBackend,
    TransformersBackend,
)

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_TESTSET = ROOT / "data" / "testset.jsonl"
RESULTS = ROOT / "results"


def load_pairs(path: Path, src: str, tgt: str) -> list[dict]:
    pairs = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        entry = json.loads(line)
        if entry["src"] == src and entry["tgt"] == tgt:
            pairs.append(entry)
    return pairs


def make_backend(args):
    if args.backend == "ollama":
        think = None if args.think is None else args.think
        return OllamaBackend(args.model, host=args.host, prompt_style=args.prompt_style,
                             temperature=args.temperature, num_ctx=args.num_ctx, think=think)
    if args.backend == "openai":
        return OpenAICompatBackend(args.model, base_url=args.base_url, api_key=args.api_key,
                                   prompt_style=args.prompt_style, temperature=args.temperature)
    if args.backend == "cloudflare":
        token = args.api_key if args.api_key != "not-needed" else os.environ.get("CLOUDFLARE_API_TOKEN", "")
        account = args.account_id or os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
        if not token or not account:
            raise SystemExit("cloudflare backend needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID "
                             "in the environment (`set -a; . ./.env; set +a`) or --api-key/--account-id")
        return CloudflareBackend(args.model, account_id=account, api_token=token)
    if args.backend == "kagi":
        if not os.environ.get("KAGI_SESSION"):
            raise SystemExit("kagi backend needs KAGI_SESSION in the environment "
                             "(`set -a; . ./.env; set +a`)")
        return KagiBackend(runtime=args.kagi_runtime, kagi_client_repo=args.kagi_client_repo)
    if args.backend == "transformers":
        return TransformersBackend(args.model, family=args.family)
    if args.backend == "argos":
        return ArgosBackend()
    raise SystemExit(f"unknown backend: {args.backend}")


def by_category(pairs: list[dict], per_sentence: list[float]) -> dict:
    buckets: dict[str, list[float]] = {}
    for entry, score in zip(pairs, per_sentence):
        buckets.setdefault(entry["category"], []).append(score)
    return {cat: round(sum(vals) / len(vals), 2) for cat, vals in sorted(buckets.items())}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--backend", required=True,
                        choices=["ollama", "openai", "transformers", "argos", "cloudflare", "kagi"])
    parser.add_argument("--model", default="")
    parser.add_argument("--family", default="seq2seq",
                        help="transformers family: nllb | m2m100 | madlad | opus | seq2seq")
    parser.add_argument("--prompt-style", default="generic",
                        choices=["generic", "translate_gemma", "hymt2", "none"])
    parser.add_argument("--src", default="id")
    parser.add_argument("--tgt", default="en")
    parser.add_argument("--testset", default=str(DEFAULT_TESTSET))
    parser.add_argument("--limit", type=int, default=0, help="cap number of pairs (0 = all)")
    parser.add_argument("--name", default=None, help="label used in result filenames")
    parser.add_argument("--host", default="http://127.0.0.1:11434")
    parser.add_argument("--base-url", default="http://127.0.0.1:1234/v1")
    parser.add_argument("--api-key", default="not-needed")
    parser.add_argument("--account-id", default=None,
                        help="Cloudflare account id (default $CLOUDFLARE_ACCOUNT_ID)")
    parser.add_argument("--kagi-runtime", default="python", choices=["python", "deno"],
                        help="which kagi-translate-client CLI to drive (default python)")
    parser.add_argument("--kagi-client-repo", default=None,
                        help="path to bevry-vibes/kagi-translate-client (default $KAGI_CLIENT_REPO)")
    parser.add_argument("--temperature", type=float, default=0.0)
    parser.add_argument("--num-ctx", type=int, default=2048)
    parser.add_argument("--think", dest="think", action="store_true", default=None,
                        help="let thinking models (Qwen3, ...) emit reasoning before the translation")
    parser.add_argument("--no-think", dest="think", action="store_false",
                        help="disable reasoning tokens (recommended for translation)")
    parser.add_argument("--est-gb", type=float, default=None,
                        help="override the estimated RAM requirement in GB")
    parser.add_argument("--min-free-gb", type=float, default=2.0,
                        help="RAM that must remain free after loading the model (default 2.0)")
    parser.add_argument("--force", action="store_true",
                        help="run even if the memory guard says there is not enough RAM")
    parser.add_argument("--keep-loaded", action="store_true",
                        help="leave the Ollama model in RAM after the run (default: unload it)")
    parser.add_argument("--no-warmup", action="store_true",
                        help="charge model load time to the first sentence instead of pre-warming")
    return parser.parse_args()


def run(args: argparse.Namespace) -> None:
    pairs = load_pairs(Path(args.testset), args.src, args.tgt)
    if args.limit:
        pairs = pairs[: args.limit]
    if not pairs:
        raise SystemExit(f"no {args.src}->{args.tgt} pairs in {args.testset}; "
                         f"run `python3 eval/build_testset.py` first")

    backend = make_backend(args)
    label = args.name or f"{args.backend}-{args.model or 'default'}".replace("/", "_")
    hf = f"{label}-{args.src}{args.tgt}"
    print(f"[{datetime.now(timezone.utc).isoformat(timespec='seconds')}] "
          f"{backend.name} | {len(pairs)} pairs {args.src}->{args.tgt} | prompt={args.prompt_style}")

    # --- memory guards: refuse to start when the box cannot hold this model ----------------
    resident = memguard.resident_ollama_models(args.host) if args.backend == "ollama" else []
    if resident and args.backend == "ollama":
        print(f"[mem ] Ollama already holds in RAM: {', '.join(resident)}")
    if getattr(backend, "loads_local_model", True):
        required = memguard.estimate_gb(args.model or "unknown", args.family,
                                        num_ctx=args.num_ctx, explicit=args.est_gb)
        memguard.require_memory(required, min_free_gb=args.min_free_gb, force=args.force,
                                label=hf)
    else:
        print("[mem ] hosted backend: no local model to load, skipping the RAM fit check "
              "(the run lock is still held)")

    # load the model / warm the KV cache before the clock starts (skippable with --no-warmup)
    if hasattr(backend, "warmup") and not args.no_warmup:
        backend.warmup(args.src, args.tgt)

    sources = [p["source"] for p in pairs]
    references = [p["reference"] for p in pairs]
    started = time.perf_counter()
    result = backend.translate(sources, args.src, args.tgt)
    wall = time.perf_counter() - started

    per_sentence = metrics.per_sentence_chrf(result.texts, references)
    scores = metrics.score_all(result.texts, references)
    payload = {
        "label": hf,
        "backend": args.backend,
        "model": args.model or result.model,
        "prompt_style": args.prompt_style,
        "src": args.src,
        "tgt": args.tgt,
        "pairs": len(pairs),
        "metrics": scores,
        "metric_backend": metrics.metric_backend(),
        "exact_match_rate": metrics.exact_match_rate(result.texts, references),
        "seconds_total": round(wall, 2),
        "seconds_per_sentence": round(wall / len(pairs), 3),
        "chrF_by_category": by_category(pairs, per_sentence),
        "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "samples": [
            {"id": p["id"], "category": p["category"], "source": p["source"],
             "reference": p["reference"], "hypothesis": h, "chrf": s}
            for p, h, s in zip(pairs, result.texts, per_sentence)
        ],
    }

    RESULTS.mkdir(parents=True, exist_ok=True)
    out = RESULTS / f"{hf}.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"  bleu={scores['bleu']}  chrF={scores['chrf']}  chrF++={scores['chrfpp']}  "
          f"(metric backend: {payload['metric_backend']})")
    print(f"  wall={payload['seconds_total']}s  {payload['seconds_per_sentence']}s/sentence")
    print("  worst 5 by chrF:")
    for entry, hyp, score in sorted(zip(pairs, result.texts, per_sentence), key=lambda r: r[2])[:5]:
        print(f"   - [{score:6.2f}] {entry['category']}: {entry['source'][:70]!r}")
        print(f"            ref: {entry['reference'][:70]!r}")
        print(f"            hyp: {hyp[:70]!r}")
    print(f"wrote {out}")

    # evict the model so the next run starts from a clean memory state
    if args.backend == "ollama" and not args.keep_loaded and args.model:
        memguard.unload_ollama([args.model], host=args.host)
    print(f"[mem ] {memguard.available_gb():.1f} GB RAM available after unload")
    print("run `python3 eval/summarize.py` to regenerate results/results.md")


def main() -> None:
    # One benchmark at a time, ever: a second concurrent run fails fast here
    # instead of stacking another multi-GB model on top of the resident one.
    with memguard.RunLock():
        run(parse_args())


if __name__ == "__main__":
    main()
