"""Translation backends for local / free Indonesian<->English models.

Each backend exposes `.translate(texts, src, tgt) -> list[str]` plus metadata
(`name`, `description`). Only stdlib is required for the HTTP backends, so
Ollama / LM Studio / llama.cpp server / vLLM can all be benchmarked without
installing torch.
"""

from __future__ import annotations

import json
import os
import subprocess
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field

LANG_NAMES = {"id": "Indonesian", "en": "English"}
# BCP-47 style codes used by the official TranslateGemma prompt template
LANG_CODES = {"id": "id-ID", "en": "en-US"}
# FLORES-200 / NLLB codes
NLLB_CODES = {"id": "ind_Latn", "en": "eng_Latn"}
# MADLAD-400 target-language tags
MADLAD_CODES = {"id": "<2id>", "en": "<2en>"}


def build_prompt(text: str, src: str, tgt: str, style: str) -> str:
    """Prompt per model family.

    - translate_gemma: the template from the TranslateGemma technical report (Fig. 3),
      which Google states is the prompt used for evaluation.
    - hymt2: Tencent's instruction wording for Hy-MT models ("...without
      additional explanation：").
    - generic: plain instruction for general LLMs (Qwen3, Gemma 3, Sahabat-AI, ...).
    - none: raw source text for dedicated NMT models (NLLB, OPUS-MT, MADLAD).
    """
    if style == "none":
        return text
    if style == "translate_gemma":
        return (
            f"You are a professional {LANG_NAMES[src]} ({LANG_CODES[src]}) to "
            f"{LANG_NAMES[tgt]} ({LANG_CODES[tgt]}) translator. Your goal is to accurately "
            f"convey the meaning and nuances of the original {LANG_NAMES[src]} text while "
            f"adhering to {LANG_NAMES[tgt]} grammar, vocabulary, and cultural sensitivities. "
            f"Produce only the {LANG_NAMES[tgt]} translation, without any additional "
            f"explanations or commentary. Please translate the following {LANG_NAMES[src]} "
            f"text into {LANG_NAMES[tgt]}:\n\n\n{text}"
        )
    if style == "hymt2":
        return (
            f"Translate the following segment into {LANG_NAMES[tgt]}, "
            f"without additional explanation：\n\n{text}"
        )
    return (
        f"Translate the following {LANG_NAMES[src]} text into {LANG_NAMES[tgt]}. "
        f"Respond with the translation only, no explanations.\n\n{text}"
    )


@dataclass
class Result:
    texts: list[str]
    seconds: float
    model: str
    backend: str
    extra: dict = field(default_factory=dict)

    @property
    def per_sentence_seconds(self) -> float:
        return round(self.seconds / max(len(self.texts), 1), 3)


def _post_json(url: str, payload: dict, headers: dict | None = None, timeout: int = 300) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 - local endpoint
        return json.loads(resp.read().decode("utf-8"))


class OllamaBackend:
    """Local models served by Ollama (https://ollama.com). Uses /api/chat so the
    model's own chat template is applied."""

    def __init__(self, model: str, host: str = "http://127.0.0.1:11434",
                 prompt_style: str = "generic", temperature: float = 0.0,
                 num_ctx: int = 4096, keep_alive: str = "5m", think: bool | None = None) -> None:
        self.model = model
        self.host = host.rstrip("/")
        self.prompt_style = prompt_style
        self.temperature = temperature
        self.num_ctx = num_ctx
        self.keep_alive = keep_alive
        # thinking models (Qwen3, ...) leak reasoning into the translation unless disabled
        self.think = think

    @property
    def name(self) -> str:
        return f"ollama:{self.model}"

    def warmup(self, src: str, tgt: str) -> None:
        """One throwaway call so model load time is not charged to the benchmark."""
        try:
            self.translate(["Halo."], src, tgt)
        except Exception as exc:  # pragma: no cover - warmup is best effort
            print(f"[warn] warmup failed for {self.name}: {exc}")

    def translate(self, texts: list[str], src: str, tgt: str) -> Result:
        out: list[str] = []
        started = time.perf_counter()
        for text in texts:
            payload = {
                "model": self.model,
                "messages": [{"role": "user",
                              "content": build_prompt(text, src, tgt, self.prompt_style)}],
                "stream": False,
                "keep_alive": self.keep_alive,
                "options": {"temperature": self.temperature, "num_ctx": self.num_ctx},
            }
            if self.think is not None:
                payload["think"] = self.think
            body = _post_json(f"{self.host}/api/chat", payload)
            out.append((body.get("message") or {}).get("content", "").strip())
        return Result(out, time.perf_counter() - started, self.model, "ollama")


class OpenAICompatBackend:
    """Any OpenAI-compatible server: LM Studio, llama.cpp `llama-server`, vLLM,
    SGLang, text-generation-inference, etc."""

    def __init__(self, model: str, base_url: str = "http://127.0.0.1:1234/v1",
                 api_key: str = "not-needed", prompt_style: str = "generic",
                 temperature: float = 0.0) -> None:
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.prompt_style = prompt_style
        self.temperature = temperature

    @property
    def name(self) -> str:
        return f"openai:{self.model}"

    def warmup(self, src: str, tgt: str) -> None:
        try:
            self.translate(["Halo."], src, tgt)
        except Exception as exc:  # pragma: no cover - warmup is best effort
            print(f"[warn] warmup failed for {self.name}: {exc}")

    def translate(self, texts: list[str], src: str, tgt: str) -> Result:
        out: list[str] = []
        started = time.perf_counter()
        for text in texts:
            payload = {
                "model": self.model,
                "messages": [{"role": "user",
                              "content": build_prompt(text, src, tgt, self.prompt_style)}],
                "temperature": self.temperature,
                "stream": False,
            }
            body = _post_json(
                f"{self.base_url}/chat/completions", payload,
                headers={"Authorization": f"Bearer {self.api_key}"},
            )
            out.append(body["choices"][0]["message"]["content"].strip())
        return Result(out, time.perf_counter() - started, self.model, "openai-compat")


class TransformersBackend:
    """Dedicated NMT models (NLLB, M2M-100, MADLAD, OPUS-MT) via transformers.

    Requires `pip install torch transformers sentencepiece`. Imports are lazy so
    the HTTP backends keep working with no ML dependencies installed.
    """

    def __init__(self, model_id: str, family: str = "seq2seq", max_new_tokens: int = 256,
                 device: str | None = None) -> None:
        self.model_id = model_id
        self.family = family  # "nllb" | "m2m100" | "madlad" | "opus" | "seq2seq"
        self.max_new_tokens = max_new_tokens
        self._model = None
        self._tokenizer = None
        self._device = device

    @property
    def name(self) -> str:
        return f"transformers:{self.model_id}"

    def _load(self) -> None:
        if self._model is not None:
            return
        import torch  # type: ignore
        from transformers import AutoModelForSeq2SeqLM, AutoTokenizer  # type: ignore

        self._device = self._device or ("cuda" if torch.cuda.is_available() else "cpu")
        self._tokenizer = AutoTokenizer.from_pretrained(self.model_id)
        self._model = AutoModelForSeq2SeqLM.from_pretrained(self.model_id).to(self._device).eval()

    def translate(self, texts: list[str], src: str, tgt: str) -> Result:
        self._load()
        import torch  # type: ignore

        inputs = []
        for text in texts:
            if self.family == "nllb":
                inputs.append(f" {NLLB_CODES[src]} " + text)
            elif self.family == "madlad":
                inputs.append(f"{MADLAD_CODES[tgt]} " + text)
            else:
                inputs.append(text)
        tok = self._tokenizer
        if self.family == "nllb":
            tok.src_lang = NLLB_CODES[src]
        batch = tok(inputs, return_tensors="pt", padding=True).to(self._device)
        gen: dict = {"max_new_tokens": self.max_new_tokens, "num_beams": 4}
        if self.family == "nllb":
            gen["forced_bos_token_id"] = tok.convert_tokens_to_ids(NLLB_CODES[tgt])
        elif self.family == "m2m100":
            gen["forced_bos_token_id"] = tok.get_lang_id(tgt)
        started = time.perf_counter()
        with torch.no_grad():
            generated = self._model.generate(**batch, **gen)
        seconds = time.perf_counter() - started
        decoded = tok.batch_decode(generated, skip_special_tokens=True)
        return Result([d.strip() for d in decoded], seconds, self.model_id, "transformers")


class ArgosBackend:
    """Argos Translate / LibreTranslate CTranslate2 models (fully offline,
    ~100 MB per direction, CPU-only). Requires `pip install argostranslate`."""

    def __init__(self, package_dir: str | None = None) -> None:
        self.package_dir = package_dir
        self._cache: dict[tuple[str, str], object] = {}

    @property
    def name(self) -> str:
        return "argos"

    def _get(self, src: str, tgt: str):
        if (src, tgt) not in self._cache:
            import argostranslate.package  # type: ignore
            import argostranslate.translate  # type: ignore

            if self.package_dir:
                argostranslate.package.install_from_path(self.package_dir)
            self._cache[(src, tgt)] = argostranslate.translate.get_translation_from_codes(src, tgt)
        return self._cache[(src, tgt)]

    def translate(self, texts: list[str], src: str, tgt: str) -> Result:
        translation = self._get(src, tgt)
        started = time.perf_counter()
        out = [translation.translate(t) for t in texts]
        return Result(out, time.perf_counter() - started, f"argos-{src}-{tgt}", "argos")


class CloudflareBackend:
    """Cloudflare Workers AI hosted translation models
    (https://developers.cloudflare.com/workers-ai/), via the official `cloudflare`
    SDK (requirements.txt).

    The typed `ai.run()` helper URL-encodes the slash-bearing model id
    ("@cf/meta/m2m100-1.2b") and Cloudflare answers "No route for that URI"
    (observed on python SDK 5.7.0 and TS SDK 7.1.0), so calls go through the
    SDK's generic request path; auth, retries and error mapping stay SDK-managed.
    """

    loads_local_model = False  # hosted: run_eval skips the RAM fit check, the run lock still applies

    def __init__(self, model: str, account_id: str, api_token: str) -> None:
        self.model = model
        self.account_id = account_id
        self.api_token = api_token
        self._client = None

    @property
    def name(self) -> str:
        return f"cloudflare:{self.model}"

    def _load(self):
        if self._client is None:
            from cloudflare import Cloudflare  # lazy: the local backends stay install-free

            self._client = Cloudflare(api_token=self.api_token)
        return self._client

    def warmup(self, src: str, tgt: str) -> None:
        try:
            self.translate(["Halo."], src, tgt)
        except Exception as exc:  # pragma: no cover - warmup is best effort
            print(f"[warn] warmup failed for {self.name}: {exc}")

    def translate(self, texts: list[str], src: str, tgt: str) -> Result:
        client = self._load()
        path = f"/accounts/{self.account_id}/ai/run/{self.model}"
        out: list[str] = []
        started = time.perf_counter()
        for text in texts:
            body = client.post(path, body={"text": text, "source_lang": src, "target_lang": tgt},
                               cast_to=object)
            if not isinstance(body, dict) or not body.get("success"):
                raise RuntimeError(f"cloudflare: bad envelope from {self.model}: {str(body)[:200]}")
            result = body.get("result") or {}
            if "translated_text" in result:  # m2m100-style: a single string
                out.append(str(result["translated_text"]).strip())
            elif "translations" in result:  # indictrans2-style: a list of segments
                parts = result["translations"]
                joined = " ".join(
                    p.get("translated_text", "") if isinstance(p, dict) else str(p) for p in parts
                )
                out.append(joined.strip())
            else:
                raise RuntimeError(
                    f"cloudflare: unexpected result shape from {self.model}: {str(result)[:200]}"
                )
        return Result(out, time.perf_counter() - started, self.model, "cloudflare")


class KagiBackend:
    """Kagi Translate (translate.kagi.com) through bevry-vibes/kagi-translate-client.

    The client repo (kagi_client_repo, default $KAGI_CLIENT_REPO) ships two
    like-for-like CLIs: runtime="python" runs kagi_translate.py under uv,
    runtime="deno" runs kagi_translate.ts under deno. KAGI_SESSION must be in
    the environment; the client reads it from the env only, no API key flow exists.
    """

    loads_local_model = False  # hosted: run_eval skips the RAM fit check, the run lock still applies

    def __init__(self, runtime: str = "python", kagi_client_repo: str | None = None) -> None:
        self.runtime = runtime
        self.kagi_client_repo = kagi_client_repo or os.environ.get("KAGI_CLIENT_REPO")
        if not self.kagi_client_repo:
            raise SystemExit("kagi backend needs --kagi-client-repo or $KAGI_CLIENT_REPO")
        if not os.path.isdir(self.kagi_client_repo):
            raise SystemExit(f"kagi client repo not found: {self.kagi_client_repo}")
        if runtime == "python":
            self._argv = ["uv", "run", "kagi_translate.py"]
        elif runtime == "deno":
            self._argv = ["deno", "run", "--allow-env", "--allow-net", "kagi_translate.ts"]
        else:
            raise SystemExit(f"unknown kagi runtime: {runtime} (use python | deno)")

    @property
    def name(self) -> str:
        return f"kagi:{self.runtime}"

    def warmup(self, src: str, tgt: str) -> None:
        try:
            self.translate(["Halo."], src, tgt)
        except Exception as exc:  # pragma: no cover - warmup is best effort
            print(f"[warn] warmup failed for {self.name}: {exc}")

    def translate(self, texts: list[str], src: str, tgt: str) -> Result:
        out: list[str] = []
        started = time.perf_counter()
        for text in texts:
            proc = subprocess.run(
                [*self._argv, "translate", text, "--from", src, "--to", tgt,
                 "--format", "json", "--no-stream"],
                cwd=self.kagi_client_repo, capture_output=True, text=True, timeout=300,
            )
            if proc.returncode != 0:
                raise RuntimeError(
                    f"kagi {self.runtime} rc={proc.returncode}: {proc.stderr.strip()[:200]}"
                )
            body = json.loads(proc.stdout)
            out.append(str(body.get("translation", "")).strip())
        return Result(out, time.perf_counter() - started, "kagi-translate-web", "kagi")

