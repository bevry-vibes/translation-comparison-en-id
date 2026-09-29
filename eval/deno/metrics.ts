/** Corpus metrics: a faithful port of sacrebleu 2.x (chrF/chrF++ from
 * metrics/chrf.py, BLEU from metrics/bleu.py, tokenizer 13a) so Deno-scored
 * rows are directly comparable with the python/sacrebleu-scored rows —
 * verified to-the-decimal against the committed python-era results before the
 * python harness was removed.
 */

const PUNCTS = new Set('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~');
const EPS = 1e-16;

// ---------------------------------------------------------------------------
// tokenizer 13a (sacrebleu/tokenizers/tokenizer_13a.py + tokenizer_re.py)

const RE_A = /([\x7b-\x7e\x5b-\x60\x20-\x26\x28-\x2b\x3a-\x40\x2f])/g; // sacrebleu's punctuation-ish class
const RE_B = /([^0-9])([\.,])/g;
const RE_C = /([\.,])([^0-9])/g;
const RE_D = /([0-9])(-)/g;

/** mteval-v13a equivalent tokenization, exactly as sacrebleu's 13a. */
export function tokenize13a(line: string): string {
  line = line.replaceAll("<skipped>", "");
  line = line.replaceAll("-\n", "");
  line = line.replaceAll("\n", " ");
  if (line.includes("&")) {
    line = line.replaceAll("&quot;", '"');
    line = line.replaceAll("&amp;", "&");
    line = line.replaceAll("&lt;", "<");
    line = line.replaceAll("&gt;", ">");
  }
  line = ` ${line} `;
  line = line.replace(RE_A, " $1 ");
  line = line.replace(RE_B, "$1 $2 ");
  line = line.replace(RE_C, "$1 $2");
  line = line.replace(RE_D, "$1 $2 ");
  return line.split(/\s+/).filter((t) => t.length > 0).join(" ");
}

// ---------------------------------------------------------------------------
// n-gram counting (sacrebleu helpers.py)

function charNgrams(line: string, maxOrder: number, includeWhitespace: boolean): Map<string, number>[] {
  // extract_all_char_ngrams: whitespace stripped from the whole line unless included; no padding
  const text = includeWhitespace ? line : line.split(/\s+/).join("");
  const counters: Map<string, number>[] = [];
  for (let n = 1; n <= maxOrder; n++) {
    const counts = new Map<string, number>();
    for (let i = 0; i + n <= text.length; i++) {
      const gram = text.slice(i, i + n);
      counts.set(gram, (counts.get(gram) ?? 0) + 1);
    }
    counters.push(counts);
  }
  return counters;
}

function wordNgrams(tokens: string[], n: number): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i + n <= tokens.length; i++) {
    const gram = tokens.slice(i, i + n).join(" ");
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

/** CHRF._remove_punctuation: separate edge punctuation from words (one edge per word). */
function removePunctuation(sent: string): string[] {
  const tokenized: string[] = [];
  for (const word of sent.split(/\s+/).filter((w) => w)) {
    if (word.length === 1) {
      tokenized.push(word);
      continue;
    }
    if (PUNCTS.has(word[word.length - 1])) {
      tokenized.push(word.slice(0, -1), word[word.length - 1]);
    } else if (PUNCTS.has(word[0])) {
      tokenized.push(word[0], word.slice(1));
    } else {
      tokenized.push(word);
    }
  }
  return tokenized;
}

// ---------------------------------------------------------------------------
// chrF / chrF++ (sacrebleu metrics/chrf.py, defaults: char_order 6, beta 2,
// lowercase off, whitespace off, eps_smoothing off)

function sumCounts(counts: Map<string, number>): number {
  let total = 0;
  for (const count of counts.values()) total += count;
  return total;
}

function matchStatistics(hypNgrams: Map<string, number>, refNgrams: Map<string, number>): [number, number, number] {
  let hypCount = 0;
  let matchCount = 0;
  for (const [gram, count] of hypNgrams) {
    hypCount += count;
    const refCount = refNgrams.get(gram);
    if (refCount !== undefined) matchCount += Math.min(count, refCount);
  }
  // don't count hits if no reference exists for that n-gram
  return [refNgrams.size > 0 ? hypCount : 0, sumCounts(refNgrams), matchCount];
}

function chrfFScore(stats: number[], order: number, beta: number): number {
  const factor = beta * beta;
  let score = 0;
  let effectiveOrder = 0;
  let avgPrec = 0;
  let avgRec = 0;
  for (let i = 0; i < order; i++) {
    const [nHyp, nRef, nMatch] = [stats[3 * i], stats[3 * i + 1], stats[3 * i + 2]];
    const prec = nHyp > 0 ? nMatch / nHyp : EPS;
    const rec = nRef > 0 ? nMatch / nRef : EPS;
    const denom = factor * prec + rec;
    score += denom > 0 ? ((1 + factor) * prec * rec) / denom : EPS;
    // sacreBLEU <2.0.0 style effective order smoothing
    if (nHyp > 0 && nRef > 0) {
      avgPrec += prec;
      avgRec += rec;
      effectiveOrder++;
    }
  }
  if (effectiveOrder === 0) return 0;
  avgPrec /= effectiveOrder;
  avgRec /= effectiveOrder;
  if (avgPrec + avgRec === 0) return 0;
  score = ((1 + factor) * avgPrec * avgRec) / (factor * avgPrec + avgRec);
  return 100 * score;
}

function chrfStatistics(hypotheses: string[], references: string[], charOrder: number, wordOrder: number): number[] {
  const order = charOrder + wordOrder;
  const stats = new Array<number>(3 * order).fill(0);
  for (let i = 0; i < hypotheses.length; i++) {
    const hyp = hypotheses[i];
    const ref = references[i];
    const hypChar = charNgrams(hyp, charOrder, false);
    const refChar = charNgrams(ref, charOrder, false);
    let hypWord: Map<string, number>[] = [];
    let refWord: Map<string, number>[] = [];
    if (wordOrder > 0) {
      hypWord = Array.from({ length: wordOrder }, (_, n) => wordNgrams(removePunctuation(hyp), n + 1));
      refWord = Array.from({ length: wordOrder }, (_, n) => wordNgrams(removePunctuation(ref), n + 1));
    }
    const allHyp = [...hypChar, ...hypWord];
    const allRef = [...refChar, ...refWord];
    for (let n = 0; n < order; n++) {
      const [hypCount, refCount, match] = matchStatistics(allHyp[n], allRef[n]);
      stats[3 * n] += hypCount;
      stats[3 * n + 1] += refCount;
      stats[3 * n + 2] += match;
    }
  }
  return stats;
}

export function chrf(hypotheses: string[], references: string[], charOrder = 6, wordOrder = 0, beta = 2): number {
  const stats = chrfStatistics(hypotheses, references, charOrder, wordOrder);
  return Math.round(chrfFScore(stats, charOrder + wordOrder, beta) * 100) / 100;
}

// ---------------------------------------------------------------------------
// BLEU (sacrebleu metrics/bleu.py: max order 4, 13a tokenizer, exp smoothing,
// effective_order off)

function myLog(num: number): number {
  if (num === 0.0) return -9999999999;
  return Math.log(num);
}

export function bleu(hypotheses: string[], references: string[], maxNgramOrder = 4): number {
  const correct = new Array<number>(maxNgramOrder).fill(0);
  const total = new Array<number>(maxNgramOrder).fill(0);
  let sysLen = 0;
  let refLen = 0;
  for (let i = 0; i < hypotheses.length; i++) {
    const h = tokenize13a(hypotheses[i].replace(/\s+$/, "")).split(/\s+/).filter((t) => t);
    const r = tokenize13a(references[i].replace(/\s+$/, "")).split(/\s+/).filter((t) => t);
    sysLen += h.length;
    refLen += r.length;
    for (let n = 1; n <= maxNgramOrder; n++) {
      const hn = wordNgrams(h, n);
      const rn = wordNgrams(r, n);
      for (const [gram, count] of hn) {
        const refCount = rn.get(gram);
        if (refCount !== undefined) correct[n - 1] += Math.min(count, refCount);
      }
      total[n - 1] += Math.max(0, h.length - n + 1);
    }
  }

  // compute_bleu
  if (!correct.some((c) => c > 0)) return 0; // early stop when nothing matched
  let bp = 1.0;
  if (sysLen < refLen) bp = sysLen > 0 ? Math.exp(1 - refLen / sysLen) : 0.0;
  const precisions = new Array<number>(maxNgramOrder).fill(0);
  let smoothMteval = 1;
  const effOrder = maxNgramOrder;
  for (let n = 1; n <= maxNgramOrder; n++) {
    if (total[n - 1] === 0) break;
    if (correct[n - 1] === 0) {
      smoothMteval *= 2;
      precisions[n - 1] = 100.0 / (smoothMteval * total[n - 1]);
    } else {
      precisions[n - 1] = (100.0 * correct[n - 1]) / total[n - 1];
    }
  }
  const score = bp * Math.exp(precisions.slice(0, effOrder).reduce((acc, p) => acc + myLog(p), 0) / effOrder);
  return Math.round(score * 100) / 100;
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
  const hits = hypotheses.filter((h, i) => h.trim() === references[i].trim()).length;
  return Math.round((100 * hits) / hypotheses.length * 100) / 100;
}
