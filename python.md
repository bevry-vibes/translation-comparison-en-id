# python.md

https://github.com/bevry-vibes/skills/blob/main/python.md — **applies**, with this project's tweaks:

- This repo predates uv packaging: it stays a bare `requirements.txt` plus scripts. Bootstrap with `uv venv .venv` and `uv pip install --python .venv/bin/python -r requirements.txt` (never bare pip on the system), then run through `.venv/bin/python` directly — no activation step. `scripts/run-cloud.sh` does the bootstrap when `.venv` is missing.
- The official `cloudflare` SDK in `requirements.txt` is the sanctioned stdlib exception; it serves the hosted Workers AI backend only (`eval/backends.py` `CloudflareBackend`, lazy-imported). Everything else keeps the stdlib-first rule.
- `sacrebleu` rides in `requirements.txt` so hosted runs score with the same metric backend as the committed local-model results.
