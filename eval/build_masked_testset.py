#!/usr/bin/env python3
"""Build the token-survival test set: name-heavy segments with production-style
name masking (patipeaceplace auto-translate `protectTerms`): every known name
form is replaced by U+E000 + <0-based glossary index> + U+E001 before the
provider sees the text, and restored verbatim afterwards. The glossary order is
longest-form-first (production `buildPeoplePairs`), self-mapping (form -> form).

Output `data/masked.jsonl` keeps the regular test-set schema (so `run_eval.py
--testset` works unchanged) plus `plain` (the unmasked source) and `names`
(`{form, index, count}` per masked form) for `token_survival.py`.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "masked.jsonl"

TOKEN_START = "\uE000"
TOKEN_END = "\uE001"

# The production byline forms this benchmark must protect: the staff names the
# 2026-09-29 regeneration lost (Petrus, Nanik), the owner-specified alternates
# (Ben, Tito, Wiwit) and the organisation byline. Order-independent here; the
# glossary order is derived below exactly like production (longest first).
NAMES = ["Petrus", "Nanik", "Ben", "Tito", "Wiwit", "Peace Place Pati"]

# (id, src, tgt, plain source, reference). Person and organisation names appear
# as themselves in both languages (self-mapping), so the references carry them
# verbatim; the survival score never depends on the reference wording.
SEGMENTS = [
    ("masked-iden-01", "id", "en",
     "Petrus memimpin rapat mingguan komunitas di ruang utama.",
     "Petrus leads the community's weekly meeting in the main hall."),
    ("masked-iden-02", "id", "en",
     "Nanik menyiapkan laporan keuangan yayasan pada akhir setiap bulan.",
     "Nanik prepares the foundation's financial report at the end of every month."),
    ("masked-iden-03", "id", "en",
     "Peace Place Pati membuka pendaftaran lokakarya perdamaian bagi para pemuda di Pati.",
     "Peace Place Pati opens registration for the peace workshop for the youth of Pati."),
    ("masked-iden-04", "id", "en",
     "Tito mendokumentasikan kegiatan komunitas melalui foto dan video pendek.",
     "Tito documents the community's activities through photos and short videos."),
    ("masked-iden-05", "id", "en",
     "Wiwit menjawab pesan yang masuk melalui situs setiap pagi.",
     "Wiwit answers the messages that arrive through the website every morning."),
    ("masked-iden-06", "id", "en",
     "Petrus dan Nanik akan mewakili Peace Place Pati pada pertemuan antar-komunitas di Semarang.",
     "Petrus and Nanik will represent Peace Place Pati at the inter-community meeting in Semarang."),
    ("masked-iden-07", "id", "en",
     "Ben dan Wiwit menyarankan agar para peserta mendaftar sebelum tanggal 15.",
     "Ben and Wiwit suggest that the participants register before the 15th."),
    ("masked-iden-08", "id", "en",
     "Nanik meminta Tito mengarsipkan foto-foto kegiatan, lalu Nanik memeriksanya kembali.",
     "Nanik asked Tito to archive the activity photos, and then Nanik reviewed them."),
    ("masked-iden-09", "id", "en",
     "Menurut Petrus, program ini berjalan dengan baik sejak Petrus menjadi koordinator.",
     "According to Petrus, the programme has run well since Petrus became the coordinator."),
    ("masked-iden-10", "id", "en",
     "Laporan tahunan Peace Place Pati ditulis oleh Ben bersama tim mediasi.",
     "The annual report of Peace Place Pati was written by Ben together with the mediation team."),
    ("masked-enid-01", "en", "id",
     "Petrus leads the community's weekly meeting in the main hall.",
     "Petrus memimpin rapat mingguan komunitas di ruang utama."),
    ("masked-enid-02", "en", "id",
     "Nanik prepares the foundation's financial report at the end of every month.",
     "Nanik menyiapkan laporan keuangan yayasan pada akhir setiap bulan."),
    ("masked-enid-03", "en", "id",
     "Peace Place Pati opens registration for the youth peace workshop in Pati.",
     "Peace Place Pati membuka pendaftaran lokakarya perdamaian bagi para pemuda di Pati."),
    ("masked-enid-04", "en", "id",
     "Tito documents community activities through photographs and short videos.",
     "Tito mendokumentasikan kegiatan komunitas melalui foto dan video pendek."),
    ("masked-enid-05", "en", "id",
     "Wiwit answers incoming messages from the website every morning.",
     "Wiwit menjawab pesan yang masuk dari situs setiap pagi."),
    ("masked-enid-06", "en", "id",
     "Petrus and Nanik will represent Peace Place Pati at the inter-community meeting in Semarang.",
     "Petrus dan Nanik akan mewakili Peace Place Pati pada pertemuan antar-komunitas di Semarang."),
    ("masked-enid-07", "en", "id",
     "Ben and Wiwit recommend that the participants register before the 15th.",
     "Ben dan Wiwit menyarankan agar para peserta mendaftar sebelum tanggal 15."),
    ("masked-enid-08", "en", "id",
     "Nanik asked Tito to archive the activity photos, and Nanik reviewed them afterwards.",
     "Nanik meminta Tito mengarsipkan foto-foto kegiatan, lalu Nanik memeriksanya kembali."),
    ("masked-enid-09", "en", "id",
     "According to Petrus, the programme has run well since Petrus became the coordinator.",
     "Menurut Petrus, program ini berjalan dengan baik sejak Petrus menjadi koordinator."),
    ("masked-enid-10", "en", "id",
     "The annual report of Peace Place Pati was written by Ben with the mediation team.",
     "Laporan tahunan Peace Place Pati ditulis oleh Ben bersama tim mediasi."),
]


def glossary() -> list[str]:
    """Production `buildPeoplePairs` order: longest form first (stable, then
    alphabetical for determinism), self-mapping, index = glossary position."""
    return sorted(NAMES, key=lambda form: (-len(form), form))


def mask(text: str, forms: list[str]) -> tuple[str, list[dict]]:
    """Production `protectTerms`: exact-form replaceAll per glossary entry."""
    output = text
    found: dict[str, dict] = {}
    for index, form in enumerate(forms):
        token = f"{TOKEN_START}{index}{TOKEN_END}"
        count = text.count(form)
        if count:
            found[form] = {"form": form, "index": index, "count": count}
        output = output.replace(form, token)
    return output, list(found.values())


def main() -> None:
    forms = glossary()
    lines = []
    for entry_id, src, tgt, plain, reference in SEGMENTS:
        source, names = mask(plain, forms)
        lines.append(json.dumps({
            "id": entry_id, "src": src, "tgt": tgt, "category": "masked-name",
            "source": source, "reference": reference, "plain": plain, "names": names,
        }, ensure_ascii=False))
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {OUT} ({len(lines)} segments; glossary order: "
          + ", ".join(f"{i}={f}" for i, f in enumerate(forms)) + ")")


if __name__ == "__main__":
    main()
