# Indonesian ⇄ English notes for MT builders

Practical quirks that decide whether an off-the-shelf model looks good or bad on this pair.
Each item is a checklist entry for prompt design, preprocessing and QA — models are never uniform here.

## Grammar and morphology

- **No tense, aspect or plural marking.** `Saya makan` = I eat / I ate / I am eating. English forces a choice; models infer it from clues (`sudah`, `telah`, `sedang`, `baru saja`, `kemarin`, `akan`, `besok`). When the clue is implicit, expect tense errors.
- **Reduplication carries meaning, not just plurality:** `anak-anak` (children), `jalan-jalan` (to go for a stroll), `sama-sama` (you're welcome / each other), `hati-hati` (be careful), `kura-kura` (turtle), `sayur-sayuran` (vegetables). Only the first is plural — rendering the rest as repetition is a common failure.
- **Affixation is the whole grammar.** `meN-`, `ber-`, `di-`, `ter-`, `-kan`, `-i`, `ke-…-an`, `peN-…-an` change voice, intention and part of speech (`menulis / menulisi / menulisan / tulisan`). Standard orthography translates well; spoken contractions (`nulis`, `ngambil`, `dibikin`) degrade every model, so normalise them first.
- **Voice choices.** `di-` passive with an agent (`… disahkan oleh DPR`) maps cleanly onto an English passive; "accidental" `ter-` and `ke-…-an` passives (`bukumu ketinggalan`) usually read better as active English. Don't force passive-to-passive.
- **Particles and clitics.** `-nya` is often a definiteness marker rather than a possessive (`mobilnya mahal` = the car is pricey); `-ku/-mu` must be expanded to possessives in English; `lah/kah/pun/dong/sih` are stance markers with no direct English equivalent.
- **Gender is absent.** `dia` is he/she/it and kinship terms are gender-neutral (`kakak` = older sibling). English must pick a gender — a systematic error source in stories and profiles. Flag those segments for review; the model cannot know.

## Register, politeness and dialect

- **Pronouns encode register**: `saya` (neutral/formal), `aku` (intimate), `gue/gua` (Jakarta informal), `kami` (exclusive we) vs `kita` (inclusive we), `Anda` vs `kamu` vs `kalian`, plus titles `Bapak/Ibu` that signal deference with no English equivalent.
- Pick one target register (formal business / neutral / conversational), state it in the prompt, and keep it consistent — models drift over long documents.
- **Bahasa gaul** (Jakarta colloquial): `gak/nggak`, `udah`, `banget`, `aja`, `gimana`, `kepo`, `mager`,

## Terminology, entities and formatting

- **Keep a do-not-translate list in your pipeline**, not in the model's head: agency names (`Kemenkeu`, `Kemendikbud`, `BUMN`), programmes (`Kartu Prakerja`), product names, emails, URLs, file paths, code, brand names, and culture-specific items needing a gloss (`gotong royong`, `warung`, `ojek/ojol`, `Pancasila`).
- **Official Indonesian IT vocabulary** from KBBI/Badan Bahasa (`peramban` browser, `kata sandi` password, `unggah` upload, `unduh` download, `surel` email, `gawai` device) is often *less* natural than the loanword (`browser`, `password`, `upload`). Choose one convention per product and enforce it with a glossary — models happily mix both inside one document.
- **Numbers, dates and money flip conventions**: Indonesian uses `.` for thousands and `,` for decimals (`Rp1.250.000`, `5,2 persen`); dates are `1 Januari 2026`, times `pukul 09.00 WIB`. Do this with deterministic locale-aware post-processing, never by asking the model.
- **Abbreviations**: `yg, dgn, tdk, utk, kalo, gmn, sy, dll, dsb, s.d.` — expand before translation.
- **Formatting must survive**: HTML tags/attributes, markdown, placeholders (`%s`, `{name}`), SRT/WebVTT cue numbers and timings. For subtitles, translate cue by cue and re-check line lengths.

## Pipeline recommendations

1. Detect the source variety (formal Indonesian vs colloquial vs mixed regional language).
2. Normalise: expand abbreviations, fix non-standard spelling, protect placeholders and glossary terms.
3. Segment: sentence-split while preserving lists/tables; never split inside an SRT cue.
4. Translate at temperature 0 with a prompt stating domain, register and output constraints.
5. Post-process: restore placeholders, localise numbers/dates/currency, re-apply glossary, strip preambles.
6. QA: check every segment shorter than ~5 words (where hallucination shows up), verify `dia`-gender and tense decisions, and diff glossary terms deterministically.

## Where each model family breaks on Indonesian

- **Marian/OPUS, Argos (small NMT):** literal but stable; weak on idioms, collocations and restructuring; register-blind; misfires on `-nya` definiteness and reduplication.
- **NLLB / M2M-100 / MADLAD:** better fluency and coverage (including `jv`, `sun`, `bjn`, `mad`), still no instruction following; can be monotone or over-literal on informal text.
- **TranslateGemma:** best measured `en→id` quality among the free options and multimodal, but generative-LLM flavoured — needs the recommended prompt, temperature 0, and output trimming.
- **Hy-MT2:** strongest instruction following and the only Apache-2.0 option at this quality level; handles glossary/style/format requests; watch the quantisation (2-bit costs measurable quality).
- **General LLMs (Qwen3, Gemma 3, Aya Expanse, Sahabat-AI, SEA-LION):** best at long structured instructions and context-sensitive reasoning; lag specialised MT at equal size and carry per-model licence caveats (Aya and NLLB are non-commercial; Gemma terms apply to Gemma 3/TranslateGemma/SEA-LION-v3). They are also the only models that can carry casual register and fillers like `baper`. Translate the meaning; a neutral-to-formal English register is usually right.
- **Indonesian vs Malay** are distinct in these models (`id` vs `zsm`/`ms`). A Malay-flavoured path gives `boleh`/`pengguna`-style calques that read foreign to Indonesian users.
- **Code-switching is normal**: Indonesian sentences embed English (`deadline`, `meeting`, `submit`, `budget`) and vice versa. Don't "un-translate" embedded English unless instructed.
