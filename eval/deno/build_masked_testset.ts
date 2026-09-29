#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write
/** Build the token-survival test set: name-heavy segments with production-style
 * name masking (patipeaceplace auto-translate `protectTerms`). The glossary
 * order is longest-form-first (production `buildPeoplePairs`), self-mapping,
 * index = glossary position.
 *
 * Mask scheme: ASCII brackets [[n]] since 2026-09-29 — the identity spike
 * (docs/identity-spike.md) showed GLM-family and nemotron tokenizers cannot
 * emit the previous private-use tokens (U+E000..U+E001) and mangle them into
 * bare digits or invented tags, while [[n]] survives every measured model.
 * The PUA-era test set lives on in results/archive/masked-pua-2026-09-29/.
 */

const ROOT = new URL("../../", import.meta.url).pathname;
const OUT = ROOT + "data/masked.jsonl";

/** one bracket marker at glossary index n */
const token = (n: number) => `[[${n}]]`;

const NAMES = ["Petrus", "Nanik", "Ben", "Tito", "Wiwit", "Peace Place Pati"];

const SEGMENTS: [string, string, string, string, string][] = [
  [
    "masked-iden-01",
    "id",
    "en",
    "Petrus memimpin rapat mingguan komunitas di ruang utama.",
    "Petrus leads the community's weekly meeting in the main hall.",
  ],
  [
    "masked-iden-02",
    "id",
    "en",
    "Nanik menyiapkan laporan keuangan yayasan pada akhir setiap bulan.",
    "Nanik prepares the foundation's financial report at the end of every month.",
  ],
  [
    "masked-iden-03",
    "id",
    "en",
    "Peace Place Pati membuka pendaftaran lokakarya perdamaian bagi para pemuda di Pati.",
    "Peace Place Pati opens registration for the peace workshop for the youth of Pati.",
  ],
  [
    "masked-iden-04",
    "id",
    "en",
    "Tito mendokumentasikan kegiatan komunitas melalui foto dan video pendek.",
    "Tito documents the community's activities through photos and short videos.",
  ],
  [
    "masked-iden-05",
    "id",
    "en",
    "Wiwit menjawab pesan yang masuk melalui situs setiap pagi.",
    "Wiwit answers the messages that arrive through the website every morning.",
  ],
  [
    "masked-iden-06",
    "id",
    "en",
    "Petrus dan Nanik akan mewakili Peace Place Pati pada pertemuan antar-komunitas di Semarang.",
    "Petrus and Nanik will represent Peace Place Pati at the inter-community meeting in Semarang.",
  ],
  [
    "masked-iden-07",
    "id",
    "en",
    "Ben dan Wiwit menyarankan agar para peserta mendaftar sebelum tanggal 15.",
    "Ben and Wiwit suggest that the participants register before the 15th.",
  ],
  [
    "masked-iden-08",
    "id",
    "en",
    "Nanik meminta Tito mengarsipkan foto-foto kegiatan, lalu Nanik memeriksanya kembali.",
    "Nanik asked Tito to archive the activity photos, and then Nanik reviewed them.",
  ],
  [
    "masked-iden-09",
    "id",
    "en",
    "Menurut Petrus, program ini berjalan dengan baik sejak Petrus menjadi koordinator.",
    "According to Petrus, the programme has run well since Petrus became the coordinator.",
  ],
  [
    "masked-iden-10",
    "id",
    "en",
    "Laporan tahunan Peace Place Pati ditulis oleh Ben bersama tim mediasi.",
    "The annual report of Peace Place Pati was written by Ben together with the mediation team.",
  ],
  [
    "masked-enid-01",
    "en",
    "id",
    "Petrus leads the community's weekly meeting in the main hall.",
    "Petrus memimpin rapat mingguan komunitas di ruang utama.",
  ],
  [
    "masked-enid-02",
    "en",
    "id",
    "Nanik prepares the foundation's financial report at the end of every month.",
    "Nanik menyiapkan laporan keuangan yayasan pada akhir setiap bulan.",
  ],
  [
    "masked-enid-03",
    "en",
    "id",
    "Peace Place Pati opens registration for the youth peace workshop in Pati.",
    "Peace Place Pati membuka pendaftaran lokakarya perdamaian bagi para pemuda di Pati.",
  ],
  [
    "masked-enid-04",
    "en",
    "id",
    "Tito documents community activities through photographs and short videos.",
    "Tito mendokumentasikan kegiatan komunitas melalui foto dan video pendek.",
  ],
  [
    "masked-enid-05",
    "en",
    "id",
    "Wiwit answers incoming messages from the website every morning.",
    "Wiwit menjawab pesan yang masuk dari situs setiap pagi.",
  ],
  [
    "masked-enid-06",
    "en",
    "id",
    "Petrus and Nanik will represent Peace Place Pati at the inter-community meeting in Semarang.",
    "Petrus dan Nanik akan mewakili Peace Place Pati pada pertemuan antar-komunitas di Semarang.",
  ],
  [
    "masked-enid-07",
    "en",
    "id",
    "Ben and Wiwit recommend that the participants register before the 15th.",
    "Ben dan Wiwit menyarankan agar para peserta mendaftar sebelum tanggal 15.",
  ],
  [
    "masked-enid-08",
    "en",
    "id",
    "Nanik asked Tito to archive the activity photos, and Nanik reviewed them afterwards.",
    "Nanik meminta Tito mengarsipkan foto-foto kegiatan, lalu Nanik memeriksanya kembali.",
  ],
  [
    "masked-enid-09",
    "en",
    "id",
    "According to Petrus, the programme has run well since Petrus became the coordinator.",
    "Menurut Petrus, program ini berjalan dengan baik sejak Petrus menjadi koordinator.",
  ],
  [
    "masked-enid-10",
    "en",
    "id",
    "The annual report of Peace Place Pati was written by Ben with the mediation team.",
    "Laporan tahunan Peace Place Pati ditulis oleh Ben bersama tim mediasi.",
  ],
];

function glossary(): string[] {
  // production `buildPeoplePairs` order: longest form first (stable, then
  // alphabetical for determinism), self-mapping, index = glossary position
  return [...NAMES].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

function mask(
  text: string,
  forms: string[],
): { source: string; names: { form: string; index: number; count: number }[] } {
  // production `protectTerms`: exact-form replaceAll per glossary entry
  let output = text;
  const found: { form: string; index: number; count: number }[] = [];
  for (const [index, form] of forms.entries()) {
    const marker = token(index);
    const count = text.split(form).length - 1;
    if (count) found.push({ form, index, count });
    output = output.replaceAll(form, marker);
  }
  return { source: output, names: found };
}

const forms = glossary();
const lines = SEGMENTS.map(([id, src, tgt, plain, reference]) => {
  const { source, names } = mask(plain, forms);
  return JSON.stringify({
    id,
    src,
    tgt,
    category: "masked-name",
    source,
    reference,
    plain,
    names,
  });
});
Deno.writeTextFileSync(OUT, lines.join("\n") + "\n");
console.log(
  `wrote ${OUT} (${lines.length} segments; glossary order: ` +
    forms.map((f, i) => `${i}=${f}`).join(", ") + ")",
);
