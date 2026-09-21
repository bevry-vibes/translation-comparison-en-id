"""Memory guards for local model benchmarks.

The failure mode this prevents: a benchmark loads a multi-GB model into RAM while another model
is still resident (or a pip install / second run is happening) and the machine starts swapping
hard. Everything here is cheap stdlib-only bookkeeping - call `require_memory()` before loading a
model, hold a `RunLock` for the whole run, and `unload_ollama()` afterwards.

Design notes:
- `MemAvailable` from /proc/meminfo is the number that matters (it already accounts for
  reclaimable page cache); swap is reported as context, never counted as usable headroom.
- Weight sizes are *estimates* from parameter count + quantisation, deliberately generous.
  Override with `--est-gb` when you know the exact file size.
- The lock file makes concurrent runs fail fast instead of stacking models in RAM.
"""

from __future__ import annotations

import os
import re
import sys
import time
from pathlib import Path

LOCK_PATH = Path(os.environ.get("MTBENCH_LOCK", "/tmp/indonesian-mt-bench.lock"))

# GiB of RAM per billion parameters by quantisation (weights + per-token runtime overhead)
GB_PER_PARAM = {
    "1.25bit": 0.22,
    "2bit": 0.32,
    "q3": 0.48,
    "q4": 0.62,
    "q5": 0.72,
    "q6": 0.85,
    "q8": 1.10,
    "fp8": 1.10,
    "fp16": 2.05,
    "bf16": 2.05,
    "default": 0.75,
}

# Families whose names carry no size marker (e.g. `Helsinki-NLP/opus-mt-id-en`): exact
# parameter counts so the estimate does not fall back to the generic 3 GB guess.
KNOWN_PARAMS_B = {
    "opus-mt": 0.074,
    "m2m100_418m": 0.418,
    "m2m100_1.2b": 1.2,
    "small100": 0.307,
}


def _meminfo() -> dict[str, int]:
    info: dict[str, int] = {}
    try:
        with open("/proc/meminfo", encoding="utf-8") as fh:
            for line in fh:
                key, _, rest = line.partition(":")
                info[key.strip()] = int(rest.strip().split()[0])  # kB
    except OSError:  # non-Linux
        pass
    return info


def available_gb() -> float:
    """Usable RAM in GiB (MemAvailable); 0.0 when unknown."""
    return _meminfo().get("MemAvailable", 0) / 1024 / 1024


def swap_free_gb() -> float:
    return _meminfo().get("SwapFree", 0) / 1024 / 1024


def total_gb() -> float:
    return _meminfo().get("MemTotal", 0) / 1024 / 1024


def human(gb: float) -> str:
    return f"{gb:.1f} GB"


def parse_params_b(model: str, family: str = "") -> float | None:
    """Parameter count in billions from a model id or GGUF filename.

    Handles `translategemma:12b`, `Hy-MT2-1.8B-Q4_K_M.gguf`, `Qwen3-30B-A3B`,
    `facebook/nllb-200-distilled-600M`.
    """
    text = model or ""
    lowered = text.lower()
    for needle, params in KNOWN_PARAMS_B.items():
        if needle in lowered:
            return params
    if family == "nllb" or "nllb-200" in text.lower():
        m = re.search(r"(\d+(?:\.\d+)?)\s*[mM]\b", text)
        if m:
            return float(m.group(1)) / 1000
    for pattern in (r"(\d+(?:\.\d+)?)\s*[bB](?:[^a-zA-Z0-9]|$)", r"(\d+(?:\.\d+)?)[bB]"):
        m = re.search(pattern, text)
        if m:
            value = float(m.group(1))
            if 0.05 <= value <= 1000:
                return value
    return None


def parse_quant(model: str) -> str:
    text = (model or "").lower()
    if "1.25bit" in text:
        return "1.25bit"
    if "2bit" in text or "q2" in text or "iq2" in text:
        return "2bit"
    for key, canonical in (("q8", "q8"), ("fp8", "fp8"), ("bf16", "bf16"), ("fp16", "fp16"),
                           ("q6", "q6"), ("q5", "q5"), ("q4", "q4"), ("q3", "q3")):
        if key in text:
            return canonical
    return "default"


def estimate_gb(model: str, family: str = "seq2seq", num_ctx: int = 2048,
                explicit: float | None = None, extra_gb: float = 0.6) -> float:
    """Estimated peak RAM for loading and running `model`."""
    if explicit is not None:
        return explicit
    params = parse_params_b(model, family)
    if params is None:
        return 3.0  # unknown model: assume mid-sized and demand headroom
    weights = max(params * GB_PER_PARAM.get(parse_quant(model), GB_PER_PARAM["default"]), 0.4)
    kv = 0.25 + 0.25 * (num_ctx / 2048)  # context + runtime buffers, rough
    return round(weights + kv + extra_gb, 2)



def require_memory(required_gb: float, min_free_gb: float = 2.0, force: bool = False,
                   label: str = "") -> None:
    """Abort with an actionable message when free RAM is insufficient."""
    avail, swap = available_gb(), swap_free_gb()
    needed = required_gb + min_free_gb
    name = label or "run"
    if avail >= needed:
        print(f"[mem ] {name}: needs ~{required_gb} GB + {min_free_gb} GB headroom, "
              f"{avail:.1f} GB available (swap free {swap:.1f} GB)")
        return
    if force:
        print(f"[warn] --force: {name} needs ~{required_gb} GB but only {avail:.1f} GB is "
              f"available; expect swapping", file=sys.stderr)
        return
    raise SystemExit(
        f"\n[mem ] refusing to start {name}: estimated {required_gb} GB + {min_free_gb} GB "
        f"headroom = {needed:.1f} GB, but only {avail:.1f} GB is available "
        f"(swap free {swap:.1f} GB).\n"
        "       Free memory first (`ollama ps`, `ollama stop <model>`, stop other benchmarks),\n"
        "       lower --num-ctx, use a smaller --model, reduce --limit, or pass --force "
        "(or a smaller --est-gb).\n"
    )


class RunLock:
    """Prevents two benchmark runs from stacking models in RAM simultaneously."""

    def __init__(self, path: Path = LOCK_PATH, stale_seconds: int = 3 * 3600) -> None:
        self.path = path
        self.stale_seconds = stale_seconds

    def __enter__(self) -> "RunLock":
        if self.path.exists():
            age = time.time() - self.path.stat().st_mtime
            owner = self.path.read_text(encoding="utf-8", errors="ignore").strip()
            if age < self.stale_seconds and _pid_alive(owner):
                raise SystemExit(
                    f"\n[lock] another benchmark looks active (pid {owner}, {age / 60:.1f} min "
                    f"old): {self.path}\n"
                    "       Wait for it to finish, or delete the lock file if it is stale.\n"
                )
            print(f"[lock] clearing stale lock from pid {owner or '?'}", file=sys.stderr)
            self.path.unlink(missing_ok=True)
        self.path.write_text(str(os.getpid()), encoding="utf-8")
        return self

    def __exit__(self, *_exc) -> None:
        self.path.unlink(missing_ok=True)


def _pid_alive(pid_text: str) -> bool:
    if not pid_text.isdigit():
        return False
    if Path(f"/proc/{pid_text}").exists():
        return True
    try:
        os.kill(int(pid_text), 0)
        return True
    except OSError:
        return False


def unload_ollama(models: list[str], host: str = "http://127.0.0.1:11434",
                  timeout: int = 60) -> None:
    """Ask Ollama to evict models immediately (keep_alive=0)."""
    import json
    import urllib.error
    import urllib.request

    for model in models:
        if not model:
            continue
        payload = json.dumps({"model": model, "keep_alive": 0}).encode()
        req = urllib.request.Request(f"{host.rstrip('/')}/api/generate", data=payload,
                                     method="POST")
        req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=timeout):  # noqa: S310 - local endpoint
                print(f"[mem ] unloaded {model}")
        except (urllib.error.URLError, TimeoutError) as exc:
            print(f"[warn] could not unload {model}: {exc}", file=sys.stderr)


def resident_ollama_models(host: str = "http://127.0.0.1:11434", timeout: int = 10) -> list[str]:
    """Names of models Ollama currently holds in RAM (best effort)."""
    import json
    import urllib.error
    import urllib.request

    try:
        with urllib.request.urlopen(f"{host.rstrip('/')}/api/ps", timeout=timeout) as resp:  # noqa: S310
            payload = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, ValueError):
        return []
    return [m.get("name") or m.get("model") or "" for m in payload.get("models", [])]


def ollama_env() -> dict[str, str]:
    """Environment keeping Ollama to a single resident model with one parallel slot."""
    return {
        "OLLAMA_MAX_LOADED_MODELS": "1",
        "OLLAMA_NUM_PARALLEL": "1",
        "OLLAMA_KEEP_ALIVE": "2m",
    }
