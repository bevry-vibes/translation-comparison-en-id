// Port of eval/metrics.py's bundled fallback formulas (the sacrebleu-free path).
// run_eval.ts prefers scoring through the system python3's sacrebleu so its rows
// stay directly comparable with the Python harness; this port is the fallback
// when python3 or sacrebleu is unavailable. `metric_backend` records which ran.

const WS = /\s+/g;
const PUNCT_EDGE = /^[^\w]+|[^\w]+$/u;

export function normalize(text: string): string {
  return text.normalize("NFC").trim().toLowerCase().replace(WS, " ");
}

export function wordTokens(text: string): string[] {
  return normalize(text)
    .split(" ")
    .map((tok) => tok.replace(PUNCT_EDGE, ""))
    .filter((tok) => tok.length > 0);
}

function charNgrams(text: string, n: number): Map<string, number> {
  const padded = " " + text + " ";
  const counts = new Map<string, number>();
  for (let i = 0; i + n <= padded.length; i++) {
    const gram = padded.slice(i, i + n);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

function ngramsJoined(tokens: string[], n: number): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i + n <= tokens.length; i++) {
    const gram = tokens.slice(i, i + n).join(" ");
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

function intersectionCount(a: Map<string, number>, b: Map<string, number>): number {
  let total = 0;
  for (const [gram, count] of a) {
    const other = b.get(gram);
    if (other) total += Math.min(count, other);
  }
  return total;
}

function sumCounts(counts: Map<string, number>): number {
  let total = 0;
  for (const count of counts.values()) total += count;
  return total;
}

function fScore(matched: number, hypTotal: number, refTotal: number, beta: number): number {
  if (hypTotal === 0 || refTotal === 0 || matched === 0) return 0;
  const precision = matched / hypTotal;
  const recall = matched / refTotal;
  const b2 = beta * beta;
  return ((1 + b2) * precision * recall) / (b2 * precision + recall);
}

/** chrF (wordOrder=0) or chrF++ (wordOrder=2), 0-100, corpus-level (micro-averaged). */
export function chrf(
  hypotheses: string[],
  references: string[],
  charOrder = 6,
  wordOrder = 0,
  beta = 2,
): number {
  let charMatched = 0, charHyp = 0, charRef = 0;
  let wordMatched = 0, wordHyp = 0, wordRef = 0;
  for (let i = 0; i < hypotheses.length; i++) {
    const h = normalize(hypotheses[i]);
    const r = normalize(references[i]);
    for (let n = 1; n <= charOrder; n++) {
      const hn = charNgrams(h, n), rn = charNgrams(r, n);
      charMatched += intersectionCount(hn, rn);
      charHyp += sumCounts(hn);
      charRef += sumCounts(rn);
    }
    if (wordOrder) {
      const ht = wordTokens(h), rt = wordTokens(r);
      for (let n = 1; n <= wordOrder; n++) {
        const hn = ngramsJoined(ht, n), rn = ngramsJoined(rt, n);
        wordMatched += intersectionCount(hn, rn);
        wordHyp += sumCounts(hn);
        wordRef += sumCounts(rn);
      }
    }
  }
  let score = fScore(charMatched, charHyp, charRef, beta);
  if (wordOrder) score = (score + fScore(wordMatched, wordHyp, wordRef, beta)) / 2;
  return Math.round(100 * score * 100) / 100;
}

/** Corpus BLEU-4 with one reference, 0-100 (add-1 smoothing on unigrams). */
export function bleu(hypotheses: string[], references: string[], maxOrder = 4): number {
  const matchedTotal = new Array<number>(maxOrder).fill(0);
  const hypTotal = new Array<number>(maxOrder).fill(0);
  let hypLen = 0, refLen = 0;
  for (let i = 0; i < hypotheses.length; i++) {
    const h = wordTokens(hypotheses[i]);
    const r = wordTokens(references[i]);
    hypLen += h.length;
    refLen += r.length;
    for (let n = 1; n <= maxOrder; n++) {
      const hn = ngramsJoined(h, n), rn = ngramsJoined(r, n);
      matchedTotal[n - 1] += intersectionCount(hn, rn);
      hypTotal[n - 1] += Math.max(0, h.length - n + 1);
    }
  }
  const precisions: number[] = [];
  for (let i = 0; i < maxOrder; i++) {
    let matched = matchedTotal[i];
    let denom = hypTotal[i];
    if (i === 0) { // add-1 smoothing on unigrams keeps short sentences from zeroing out
      matched += 1;
      denom += 1;
    }
    precisions.push(denom ? matched / denom : 0);
  }
  if (Math.min(...precisions) <= 0) return 0;
  const geoMean = Math.exp(precisions.reduce((acc, p) => acc + Math.log(p), 0) / maxOrder);
  const bp = hypLen > refLen ? 1 : Math.exp(1 - refLen / Math.max(hypLen, 1));
  return Math.round(100 * bp * geoMean * 100) / 100;
}

export function scoreAll(
  hypotheses: string[],
  references: string[],
): { bleu: number; chrf: number; chrfpp: number } {
  return {
    bleu: bleu(hypotheses, references),
    chrf: chrf(hypotheses, references),
    chrfpp: chrf(hypotheses, references, 6, 2),
  };
}

export function perSentenceChrf(hypotheses: string[], references: string[]): number[] {
  return hypotheses.map((h, i) => chrf([h], [references[i]]));
}

export function exactMatchRate(hypotheses: string[], references: string[]): number {
  if (hypotheses.length === 0) return 0;
  const hits = hypotheses.filter((h, i) => normalize(h) === normalize(references[i])).length;
  return Math.round((100 * hits) / hypotheses.length * 100) / 100;
}
