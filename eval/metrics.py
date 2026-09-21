"""Reference-based translation metrics.

Deliberately stdlib-only so the harness runs anywhere (no torch, no numpy).
If `sacrebleu` is installed it is used for BLEU/chrF so numbers stay comparable
to published results; otherwise a local implementation is used and results are
labelled accordingly.

chrF is the primary metric for Indonesian<->English: BLEU punishes the heavy
morphology/affixation differences in Indonesian, while chrF stays stable on
small test sets.
"""

from __future__ import annotations

import collections
import math
import re
import unicodedata
from typing import Iterable, Sequence

try:  # optional, preferred when available
    import sacrebleu  # type: ignore

    HAS_SACREBLEU = True
except Exception:  # pragma: no cover - optional dependency
    sacrebleu = None  # type: ignore
    HAS_SACREBLEU = False


_WS = re.compile(r"\s+")
_PUNCT_EDGE = re.compile(r"^[^\w]+|[^\w]+$", re.UNICODE)


def metric_backend() -> str:
    return "sacrebleu" if HAS_SACREBLEU else "local"


def normalize(text: str) -> str:
    """Light, language-agnostic normalisation.

    NFC (not NFKC) so distinct characters are not folded, then lowercase and
    collapse whitespace.
    """
    text = unicodedata.normalize("NFC", text)
    text = text.strip().lower()
    return _WS.sub(" ", text)


def word_tokens(text: str) -> list[str]:
    text = normalize(text)
    return [t for t in (_PUNCT_EDGE.sub("", tok) for tok in text.split(" ")) if t]


def char_ngrams(text: str, n: int) -> collections.Counter:
    padded = " " + text + " "
    return collections.Counter(padded[i : i + n] for i in range(len(padded) - n + 1))


def _f_score(matched: int, hyp_total: int, ref_total: int, beta: float) -> float:
    if hyp_total == 0 or ref_total == 0 or matched == 0:
        return 0.0
    precision = matched / hyp_total
    recall = matched / ref_total
    b2 = beta * beta
    return (1 + b2) * precision * recall / (b2 * precision + recall)


def chrf(hypotheses: Sequence[str], references: Sequence[str], char_order: int = 6,
         word_order: int = 0, beta: float = 2.0) -> float:
    """chrF (word_order=0) or chrF++ (word_order=2), 0-100, corpus-level.

    Corpus-level (micro-averaged) n-gram statistics, which matches sacrebleu's
    behaviour so scores are directly comparable.
    """
    char_stats = [0, 0, 0]
    word_stats = [0, 0, 0]
    for hyp, ref in zip(hypotheses, references):
        h, r = normalize(hyp), normalize(ref)
        for n in range(1, char_order + 1):
            hn, rn = char_ngrams(h, n), char_ngrams(r, n)
            char_stats[0] += sum((hn & rn).values())
            char_stats[1] += sum(hn.values())
            char_stats[2] += sum(rn.values())
        if word_order:
            ht, rt = word_tokens(h), word_tokens(r)
            for n in range(1, word_order + 1):
                hn = collections.Counter(
                    " ".join(ht[i : i + n]) for i in range(max(0, len(ht) - n + 1))
                )
                rn = collections.Counter(
                    " ".join(rt[i : i + n]) for i in range(max(0, len(rt) - n + 1))
                )
                word_stats[0] += sum((hn & rn).values())
                word_stats[1] += sum(hn.values())
                word_stats[2] += sum(rn.values())
    score = _f_score(*char_stats, beta)
    if word_order:
        score = (score + _f_score(*word_stats, beta)) / 2
    return round(100 * score, 2)


def _ngram_counts(tokens: Sequence[str], n: int) -> collections.Counter:
    return collections.Counter(tuple(tokens[i : i + n]) for i in range(len(tokens) - n + 1))


def bleu(hypotheses: Sequence[str], references: Sequence[str], max_order: int = 4) -> float:
    """Corpus BLEU-4 with one reference, 0-100 (local fallback only).

    Numbers from this fallback are NOT guaranteed to match sacreBLEU exactly;
    install sacrebleu for comparable numbers.
    """
    matched_total, hyp_total = [0] * max_order, [0] * max_order
    hyp_len = ref_len = 0
    for hyp, ref in zip(hypotheses, references):
        h, r = word_tokens(hyp), word_tokens(ref)
        hyp_len, ref_len = hyp_len + len(h), ref_len + len(r)
        for n in range(1, max_order + 1):
            hn, rn = _ngram_counts(h, n), _ngram_counts(r, n)
            matched_total[n - 1] += sum((hn & rn).values())
            hyp_total[n - 1] += max(0, len(h) - n + 1)
    precisions = []
    for i in range(max_order):
        matched = matched_total[i]
        denom = hyp_total[i]
        if i == 0:  # add-1 smoothing on unigrams keeps short sentences from zeroing out
            matched, denom = matched + 1, denom + 1
        precisions.append(matched / denom if denom else 0.0)
    if min(precisions) <= 0:
        return 0.0
    geo_mean = math.exp(sum(math.log(p) for p in precisions) / max_order)
    bp = 1.0 if hyp_len > ref_len else math.exp(1 - ref_len / max(hyp_len, 1))
    return round(100 * bp * geo_mean, 2)


def score_all(hypotheses: Sequence[str], references: Sequence[str]) -> dict[str, float]:
    """Corpus-level scores: bleu, chrf, chrfpp (all 0-100)."""
    if HAS_SACREBLEU:
        return {
            "bleu": round(float(sacrebleu.corpus_bleu(hypotheses, [list(references)]).score), 2),
            "chrf": round(float(sacrebleu.corpus_chrf(hypotheses, [list(references)]).score), 2),
            "chrfpp": round(
                float(sacrebleu.corpus_chrf(hypotheses, [list(references)], word_order=2).score), 2
            ),
        }
    return {
        "bleu": bleu(hypotheses, references),
        "chrf": chrf(hypotheses, references),
        "chrfpp": chrf(hypotheses, references, word_order=2),
    }


def per_sentence_chrf(hypotheses: Sequence[str], references: Sequence[str]) -> list[float]:
    return [chrf([h], [r]) for h, r in zip(hypotheses, references)]


def exact_match_rate(hypotheses: Iterable[str], references: Iterable[str]) -> float:
    pairs = list(zip(hypotheses, references))
    if not pairs:
        return 0.0
    hits = sum(1 for h, r in pairs if normalize(h) == normalize(r))
    return round(100 * hits / len(pairs), 2)

    return round(100 * score, 2)
