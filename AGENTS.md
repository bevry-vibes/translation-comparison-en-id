# AGENTS.md

This project conforms to Bevry's skills. Reference their remote URLs only — do not pull their contents into this file.

When a referenced skill applies with your project's tweaks, the local `<name>.md` file at this repo root references the remote URL and lists the tweaks underneath; this process is documented in the upstream repo's [local tweaks pattern](https://github.com/bevry-vibes/skills#local-tweaks-pattern).

- https://github.com/bevry-vibes/skills/blob/main/policy.md — **applies**. Bevry's AI policy. Gate every session: detect reciprocity compliance with [agent-detect](https://github.com/bevry-vibes/agent-detect) before any work in this repository.
- https://github.com/bevry-vibes/skills/blob/main/commits.md — **applies**. Bevry's commit hygiene. Use Conventional Commits, generate the co-author trailer with agent-detect, and sign through the 1Password SSH agent.
- https://github.com/bevry-vibes/skills/blob/main/plans.md — **applies**. Bevry's plan conventions. Follow them when you plan work in this repository.
- [python.md](./python.md) — **applies**, with this project's tweaks. Python work runs through uv; this repo keeps its bare `requirements.txt` bootstrap, and the official `cloudflare` SDK is the sanctioned stdlib exception for the hosted Workers AI backend.
- https://github.com/bevry-vibes/skills/blob/main/build.md — **does not apply**: this project has no packaged build and no menu-bar or tray app; the harness runs as plain Python scripts.
- https://github.com/bevry-vibes/skills/blob/main/powershell.md — **does not apply**: no PowerShell work here; the scripts are POSIX shell and Python.
- https://github.com/bevry-vibes/skills/blob/main/zig.md — **does not apply**: no Zig code in this project.
- https://github.com/bevry-vibes/skills/blob/main/minimax.md — **does not apply**: no MiniMax model tweaks in this project.

## this project

- Wrap every model-loading run with `eval/memguard.py`. Never bypass the fit check without an explicit user instruction.
- Run at most one benchmark at a time. The run lock in `eval/memguard.py` enforces this.
- Do not commit downloaded corpus archives (`data/*.zip`). Rebuild them with `eval/build_testset.py`.
- Commit the measured results (`results/*.json`, `results/results.md`) with the runs that produced them.
- Write Python with the standard library first. Add a dependency only when the standard library cannot do the job.