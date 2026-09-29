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
    import time
    last: Exception | None = None
    for attempt in range(4):  # the datasets-server occasionally 502s; brief backoff
        try:
            with urllib.request.urlopen(url, timeout=60) as resp:  # noqa: S310 - fixed host
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code not in (502, 503, 504) or attempt == 3:
                raise
            last = exc
            time.sleep(3 * 2 ** attempt)
    raise last  # unreachable: the loop returns or raises


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


def load_flores_enid(offset: int, limit: int) -> list[dict]:
    """FLORES-101 devtest en->id pairs from the row window [offset, offset+limit).

    A different window than the id->en sample so no sentence appears in both
    directions; ids carry an `-enid` infix so they never collide.
    """
    if limit <= 0:
        return []
    id_rows = flores_rows("id", offset, limit)
    en_rows = flores_rows("en", offset, limit)
    by_id_id = {row["row"]["id"]: row["row"]["sentence"] for row in id_rows}
    pairs = []
    for row in en_rows:
        key = row["row"]["id"]
        if key in by_id_id:
            pairs.append({
                "id": f"flores-enid-{key}",
                "src": "en", "tgt": "id",
                "category": "flores-devtest",
                "source": row["row"]["sentence"].strip(),
                "reference": by_id_id[key].strip(),
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


def tatoeba_candidates() -> list[tuple[str, str]]:
    """Length-filtered (en, id) sentence pairs, in archive order."""
    archive = ensure_tatoeba_zip()
    if not archive:
        return []
    pairs = []
    for en, idn in read_tatoeba_pairs(archive):
        if 15 <= len(idn) <= 110 and 15 <= len(en) <= 110:
            pairs.append((en, idn))
    return pairs


def select_tatoeba(limit: int, seed: int, exclude: set[tuple[str, str]]) -> list[tuple[str, str]]:
    rng = random.Random(seed)
    pairs = tatoeba_candidates()
    rng.shuffle(pairs)
    out = []
    for pair in pairs:
        if pair in exclude:
            continue
        out.append(pair)
        if len(out) >= limit:
            break
    return out


def load_tatoeba(limit: int, seed: int = 13) -> list[dict]:
    pairs = select_tatoeba(limit, seed, exclude=set())
    out = []
    for i, (en, idn) in enumerate(pairs):
        out.append({
            "id": f"tatoeba-{i:04d}", "src": "id", "tgt": "en",
            "category": "tatoeba", "source": idn, "reference": en,
        })
    return out


def load_tatoeba_enid(limit: int, exclude: set[tuple[str, str]]) -> list[dict]:
    """Tatoeba en->id pairs from a differently-seeded shuffle, skipping every
    pair already used by the id->en sample; ids carry an `-enid` infix."""
    pairs = select_tatoeba(limit, seed=17, exclude=exclude)
    out = []
    for i, (en, idn) in enumerate(pairs):
        out.append({
            "id": f"tatoeba-enid-{i:04d}", "src": "en", "tgt": "id",
            "category": "tatoeba", "source": en, "reference": idn,
        })
    return out


def load_curated() -> list[dict]:
    path = DATA / "curated.jsonl"
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--flores", type=int, default=20, help="FLORES-101 devtest pairs (id->en)")
    parser.add_argument("--tatoeba", type=int, default=40, help="Tatoeba pairs (id->en)")
    parser.add_argument("--flores-enid", type=int, default=0,
                        help="FLORES-101 devtest pairs (en->id, from a later row window)")
    parser.add_argument("--tatoeba-enid", type=int, default=0,
                        help="Tatoeba pairs (en->id, differently seeded, disjoint from id->en)")
    parser.add_argument("--out", default=str(DATA / "testset.jsonl"))
    args = parser.parse_args()

    entries = load_curated() + load_flores(args.flores) + load_tatoeba(args.tatoeba)
    if args.flores_enid or args.tatoeba_enid:
        # the en->id sample must not reuse any id->en Tatoeba pair
        used = {(entry["reference"], entry["source"])
                for entry in entries if entry["src"] == "id" and entry["tgt"] == "en"}
        entries += load_flores_enid(20, args.flores_enid) + load_tatoeba_enid(args.tatoeba_enid, used)
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
