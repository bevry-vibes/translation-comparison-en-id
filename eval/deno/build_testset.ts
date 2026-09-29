#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write
/** Build the Indonesian<->English evaluation set (testset-v2).
 *
 * Ported from the original python `eval/build_testset.py` — including a
 * Mersenne Twister (MT19937) port of `random.Random(seed).shuffle`, so the
 * Tatoeba selection is byte-deterministic across the two implementations.
 * Verified: the v2 file this produces parses identical to the python-era one.
 *
 * Sources: FLORES-101 devtest via the HF datasets-server rows API (aligned
 * id/en rows; the en->id sample comes from a later row window), Tatoeba en-id
 * (OPUS moses zip; en->id uses a differently-seeded shuffle, disjoint from the
 * id->en sample), and data/curated.jsonl.
 *
 * Usage:
 *   deno run -A eval/deno/build_testset.ts \
 *     --flores 20 --tatoeba 40 --flores-enid 20 --tatoeba-enid 44 \
 *     --out data/testset-v2.jsonl
 */

import { MT19937 } from "./mt19937.ts";

const ROOT = new URL("../../", import.meta.url).pathname;
const DATA = ROOT + "data/";
const FLORES_DATASET = "gsarti/flores_101";
const FLORES_CONFIG: Record<string, string> = { id: "ind", en: "eng" };
const TATOEBA_ZIP = DATA + "tatoeba-en-id.zip";
const TATOEBA_URL =
  "https://object.pouta.csc.fi/OPUS-Tatoeba/v2023-04-12/moses/en-id.txt.zip";

// ---------------------------------------------------------------------------
// MT19937 exactly as CPython's `random` implements it (init_by_array seeding +
// genrand_res53 doubles + the backwards Fisher-Yates shuffle), so a seeded
// shuffle selects the same rows as the python-era builder did.

// ---------------------------------------------------------------------------

async function httpJson(url: string): Promise<Record<string, unknown>> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url);
      if (
        !response.ok && [502, 503, 504].includes(response.status) && attempt < 3
      ) {
        await new Promise((r) => setTimeout(r, 3 * 2 ** attempt * 1000));
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return await response.json();
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

interface FloresPair {
  id: string;
  src: string;
  tgt: string;
  category: string;
  source: string;
  reference: string;
}

async function floresRows(lang: string, offset: number, length: number) {
  const query = new URLSearchParams({
    dataset: FLORES_DATASET,
    config: FLORES_CONFIG[lang],
    split: "devtest",
    offset: String(offset),
    length: String(length),
  });
  const data = await httpJson(
    `https://datasets-server.huggingface.co/rows?${query}`,
  );
  return data.rows as { row: { id: number; sentence: string } }[];
}

function pairFrom(
  id: string,
  src: string,
  tgt: string,
  source: string,
  reference: string,
): FloresPair {
  return {
    id,
    src,
    tgt,
    category: "flores-devtest",
    source: source.trim(),
    reference: reference.trim(),
  };
}

async function loadFlores(limit: number): Promise<FloresPair[]> {
  if (limit <= 0) return [];
  const span = Math.min(limit, 60); // one API page is enough for the default sample
  const [idRows, enRows] = await Promise.all([
    floresRows("id", 0, span),
    floresRows("en", 0, span),
  ]);
  const enById = new Map(enRows.map((row) => [row.row.id, row.row.sentence]));
  const pairs: FloresPair[] = [];
  for (const row of idRows) {
    const reference = enById.get(row.row.id);
    if (reference !== undefined) {
      pairs.push(
        pairFrom(
          `flores-${row.row.id}`,
          "id",
          "en",
          row.row.sentence,
          reference,
        ),
      );
    }
  }
  return pairs.slice(0, limit);
}

async function loadFloresEnid(
  offset: number,
  limit: number,
): Promise<FloresPair[]> {
  if (limit <= 0) return [];
  // a later row window than the id->en sample so no sentence appears in both directions
  const [idRows, enRows] = await Promise.all([
    floresRows("id", offset, limit),
    floresRows("en", offset, limit),
  ]);
  const idById = new Map(idRows.map((row) => [row.row.id, row.row.sentence]));
  const pairs: FloresPair[] = [];
  for (const row of enRows) {
    const reference = idById.get(row.row.id);
    if (reference !== undefined) {
      pairs.push(
        pairFrom(
          `flores-enid-${row.row.id}`,
          "en",
          "id",
          row.row.sentence,
          reference,
        ),
      );
    }
  }
  return pairs.slice(0, limit);
}

async function ensureTatoebaZip(): Promise<string | null> {
  try {
    const stat = await Deno.stat(TATOEBA_ZIP);
    if (stat.isFile && stat.size > 1000) return TATOEBA_ZIP;
  } catch {
    // not cached: download
  }
  try {
    const response = await fetch(TATOEBA_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await Deno.writeFile(
      TATOEBA_ZIP,
      new Uint8Array(await response.arrayBuffer()),
    );
    return TATOEBA_ZIP;
  } catch (e) {
    console.warn(
      `[warn] could not download Tatoeba (${e}); skipping that source`,
    );
    return null;
  }
}

/** OPUS Tatoeba zips ship either a merged `en-id.txt` (tab separated) or
 * parallel `Tatoeba.en-id.en` / `Tatoeba.en-id.id` files. Unzipping uses the
 * `fflate` npm package under Deno. */
async function readTatoebaPairs(archive: string): Promise<[string, string][]> {
  const { unzipSync } = await import("npm:fflate@0.8.2");
  const files = unzipSync(new Uint8Array(await Deno.readFile(archive)));
  const merged = Object.keys(files).find((n) => n.endsWith("en-id.txt"));
  const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  if (merged) {
    const out: [string, string][] = [];
    for (const line of decode(files[merged]).split("\n")) {
      const parts = line.split("\t");
      if (parts.length >= 2) out.push([parts[0].trim(), parts[1].trim()]);
    }
    return out;
  }
  const enFile = Object.keys(files).find((n) => n.endsWith(".en-id.en"));
  const idFile = Object.keys(files).find((n) => n.endsWith(".en-id.id"));
  if (!enFile || !idFile) return [];
  const enLines = decode(files[enFile]).split("\n");
  const idLines = decode(files[idFile]).split("\n");
  return enLines
    .map((en, i) => [en.trim(), (idLines[i] ?? "").trim()] as [string, string])
    .filter(([en, idn]) => en && idn);
}

function tatoebaCandidates(archive: string): [string, string][] {
  return readTatoebaPairs(archive).then((pairs) =>
    pairs.filter(([en, idn]) =>
      idn.length >= 15 && idn.length <= 110 && en.length >= 15 &&
      en.length <= 110
    )
  );
}

interface TatoebaPair {
  id: string;
  src: string;
  tgt: string;
  category: string;
  source: string;
  reference: string;
}

async function loadTatoeba(
  limit: number,
  seed: number,
  exclude: Set<string>,
): Promise<TatoebaPair[]> {
  const archive = await ensureTatoebaZip();
  if (!archive || limit <= 0) return [];
  const pairs = await tatoebaCandidates(archive);
  new MT19937().seed(seed).shuffle(pairs);
  const out: TatoebaPair[] = [];
  let i = 0;
  for (const [en, idn] of pairs) {
    if (exclude.has(`${en}\u0000${idn}`)) continue;
    out.push({
      id: `tatoeba-${String(i).padStart(4, "0")}`,
      src: "id",
      tgt: "en",
      category: "tatoeba",
      source: idn,
      reference: en,
    });
    i++;
    if (out.length >= limit) break;
  }
  return out;
}

async function loadTatoebaEnid(
  limit: number,
  exclude: Set<string>,
): Promise<TatoebaPair[]> {
  const archive = await ensureTatoebaZip();
  if (!archive || limit <= 0) return [];
  const pairs = await tatoebaCandidates(archive);
  new MT19937().seed(17).shuffle(pairs);
  const out: TatoebaPair[] = [];
  let i = 0;
  for (const [en, idn] of pairs) {
    if (exclude.has(`${en}\u0000${idn}`)) continue;
    out.push({
      id: `tatoeba-enid-${String(i).padStart(4, "0")}`,
      src: "en",
      tgt: "id",
      category: "tatoeba",
      source: en,
      reference: idn,
    });
    i++;
    if (out.length >= limit) break;
  }
  return out;
}

function loadCurated(): Record<string, string>[] {
  const path = DATA + "curated.jsonl";
  try {
    return Deno.readTextFileSync(path).split("\n").filter((l) => l.trim()).map((
      l,
    ) => JSON.parse(l));
  } catch {
    return [];
  }
}

function parseArgs(argv: string[]): Record<string, string> {
  const opts: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    opts[key] = i + 1 < argv.length && !argv[i + 1].startsWith("--")
      ? argv[++i]
      : "true";
  }
  return opts;
}

const opts = parseArgs(Deno.args);
const flores = parseInt(opts.flores ?? "20", 10);
const tatoeba = parseInt(opts.tatoeba ?? "40", 10);
const floresEnid = parseInt(opts["flores-enid"] ?? "0", 10);
const tatoebaEnid = parseInt(opts["tatoeba-enid"] ?? "0", 10);

const entries: Record<string, string>[] = [
  ...loadCurated(),
  ...(await loadFlores(flores)),
  ...(await loadTatoeba(tatoeba, 13, new Set())),
];
if (floresEnid || tatoebaEnid) {
  // the en->id sample must not reuse any id->en Tatoeba pair
  const used = new Set(
    entries.filter((e) => e.src === "id").map((e) =>
      `${e.reference}\u0000${e.source}`
    ),
  );
  entries.push(
    ...(await loadFloresEnid(20, floresEnid)),
    ...(await loadTatoebaEnid(tatoebaEnid, used)),
  );
}

const out = opts.out ?? DATA + "testset.jsonl";
await Deno.writeTextFile(
  out,
  entries.map((e) => JSON.stringify(e)).join("\n") + "\n",
);
const counts = new Map<string, number>();
for (const entry of entries) {
  const key = `${entry.src}->${entry.tgt}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
}
console.log(`wrote ${entries.length} pairs to ${out}`);
for (const key of [...counts.keys()].sort()) {
  console.log(`  ${key}: ${counts.get(key)}`);
}
