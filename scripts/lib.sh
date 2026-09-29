#!/usr/bin/env bash
# Shared scaffolding for the sweep scripts. Source after setting ROOT:
#   ROOT="$(cd "$(dirname "$0")/.." && pwd)"
#   source "$ROOT/scripts/lib.sh"
# Provides: load_env.

load_env() {
  if [[ -f "$ROOT/.env" ]]; then
    set -a
    . "$ROOT/.env"
    set +a
  fi
}

# Emit sweep progress to the site's refresh monitor (ghostty-web terminal panel).
# usage: progress_emit <task> <status running|complete|failed> <done> <total> [current] [note]
progress_emit() {
  local task="$1" status="$2" done="$3" total="$4" current="${5:-}" note="${6:-}"
  local dir="$ROOT/site/public/data"
  mkdir -p "$dir"
  deno eval '
  const [task, status, done, total, current, note, startedPath] = Deno.args;
  const now = new Date().toISOString().slice(0, 19) + "+00:00";
  const startedFile = startedPath;
  let started_at = now;
  try { started_at = Deno.readTextFileSync(startedFile).trim() || now; } catch { Deno.writeTextFileSync(startedFile, now); }
  const out = { task, status, started_at, updated_at: now, done: Number(done), total: Number(total), ...(current ? { current } : {}), ...(note ? { note } : {}) };
  await Deno.writeTextFile(Deno.args[7], JSON.stringify(out, null, 1) + "\n");
  ' "$task" "$status" "$done" "$total" "$current" "$note" "$ROOT/.refresh-started-$task" "$dir/refresh-status.json"
}
