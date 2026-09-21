#!/usr/bin/env python3
"""Build the Indonesian<->English evaluation set.

Sources (all fetchable without an HF token, no `datasets` dependency):
  1. FLORES-101 devtest (gsarti/flores_101) - professional human translations,
     formal/Wikinews domain. Pulled through the HF datasets-server rows API.
  2. Tatoeba en-id (OPUS moses release) - short, everyday, human-contributed
     sentence pairs. Good proxy for chat/subtitle/UI use cases.
  3. data/curated.jsonl - hand-written "tricky case" probes (register, idioms,
     numbers, do-not-translate entities, long sentences).

Output: data/testset.jsonl, one JSON object per line:
  {id, src, tgt, category, source, reference}

Usage:
  python3 eval/build_testset.py --flores 20 --tatoeba 40
"""

from __future__ import annotations

import argparse
import io
import json
import random
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
FLORES_DATASET = "gsarti/flores_101"
FLORES_CONFIG = {"id": "ind", "en": "eng"}
TATOEBA_ZIP = DATA / "tatoeba-en-id.zip"
TATOEBA_URL = "https://object.pouta.csc.fi/OPUS-Tatoeba/v2023-04-12/moses/en-id.txt.zip"


def http_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=60) as resp:  # noqa: S310 - fixed host
        return json.loads(resp.read().decode("utf-8"))


def flores_rows(lang: str, offset: int, length: int) -> list[dict]:
    query = urllib.parse.urlencode(
        {"dataset": FLORES_DATASET, "config": FLORES_CONFIG[lang],
         "split": "devtest", "offset": offset, "length": length}
    )
    return http_json(f"https://datasets-server.huggingface.co/rows?{query}")["rows"]


def load_flores(limit: int) -> list[dict]:
    """Aligned FLORES-101 devtest sentences for id and en (row ids match)."""
    if limit <= 0:
        return []
    span = min(limit, 60)  # one API page is enough for the default sample
    id_rows = flores_rows("id", 0, span)
    en_rows = flores_rows("en", 0, span)
    by_id_en = {row["row"]["id"]: row["row"]["sentence"] for row in en_rows}
    pairs = []
    for row in id_rows:
        key = row["row"]["id"]
        if key in by_id_en:
            pairs.append({
                "id": f"flores-{key}",
                "src": "id", "tgt": "en",
                "category": "flores-devtest",
                "source": row["row"]["sentence"].strip(),
                "reference": by_id_en[key].strip(),
            })
    return pairs[:limit]


def ensure_tatoeba_zip() -> Path | None:
    if TATOEBA_ZIP.exists() and TATOEBA_ZIP.stat().st_size > 1000:
        return TATOEBA_ZIP
    try:
        DATA.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(TATOEBA_URL, timeout=120) as resp:  # noqa: S310
            TATOEBA_ZIP.write_bytes(resp.read())
        return TATOEBA_ZIP
    except Exception as exc:  # network optional: curated + FLORES still work
        print(f"[warn] could not download Tatoeba ({exc}); skipping that source")
        return None


def read_tatoeba_pairs(archive: Path) -> list[tuple[str, str]]:
    """OPUS Tatoeba zips ship either `en-id.txt` (tab separated) or parallel
    `Tatoeba.en-id.en` / `Tatoeba.en-id.id` files, one sentence per line."""
    with zipfile.ZipFile(archive) as zf:
        names = zf.namelist()
        merged = next((n for n in names if n.endswith("en-id.txt")), None)
        if merged:
            lines = zf.read(merged).decode("utf-8").splitlines()
            out = []
            for line in lines:
                parts = line.split("\t")
                if len(parts) >= 2:
                    out.append((parts[0].strip(), parts[1].strip()))
            return out
        en_file = next((n for n in names if n.endswith(".en-id.en")), None)
        id_file = next((n for n in names if n.endswith(".en-id.id")), None)
        if not en_file or not id_file:
            return []
        en_lines = zf.read(en_file).decode("utf-8").splitlines()
        id_lines = zf.read(id_file).decode("utf-8").splitlines()
        return [(e.strip(), i.strip()) for e, i in zip(en_lines, id_lines)
                if e.strip() and i.strip()]


def load_tatoeba(limit: int, seed: int = 13) -> list[dict]:
    archive = ensure_tatoeba_zip()
    if not archive or limit <= 0:
        return []
    pairs = []
    for en, idn in read_tatoeba_pairs(archive):
        if 15 <= len(idn) <= 110 and 15 <= len(en) <= 110:
            pairs.append((en, idn))
    rng = random.Random(seed)
    rng.shuffle(pairs)
    out = []
    for i, (en, idn) in enumerate(pairs[:limit]):
        out.append({
            "id": f"tatoeba-{i:04d}", "src": "id", "tgt": "en",
            "category": "tatoeba", "source": idn, "reference": en,
        })
    return out


def load_curated() -> list[dict]:
    path = DATA / "curated.jsonl"
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--flores", type=int, default=20, help="FLORES-101 devtest pairs")
    parser.add_argument("--tatoeba", type=int, default=40, help="Tatoeba id->en pairs")
    parser.add_argument("--out", default=str(DATA / "testset.jsonl"))
    args = parser.parse_args()

    entries = load_curated() + load_flores(args.flores) + load_tatoeba(args.tatoeba)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as fh:
        for entry in entries:
            fh.write(json.dumps(entry, ensure_ascii=False) + "\n")

    counts: dict[str, int] = {}
    for entry in entries:
        key = f"{entry['src']}->{entry['tgt']}"
        counts[key] = counts.get(key, 0) + 1
    print(f"wrote {len(entries)} pairs to {out}")
    for key, value in sorted(counts.items()):
        print(f"  {key}: {value}")


if __name__ == "__main__":
    main()
