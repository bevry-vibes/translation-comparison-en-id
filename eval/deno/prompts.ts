/** The verbatim prompt templates — the single source of truth.
 *
 * Ported 1:1 from the original python `eval/backends.py`; the site's data
 * pipeline imports this module, so the site always renders exactly what the
 * harness sends.
 */

export const LANG_NAMES: Record<string, string> = {
  id: "Indonesian",
  en: "English",
};
// BCP-47 style codes used by the official TranslateGemma prompt template
const LANG_CODES: Record<string, string> = { id: "id-ID", en: "en-US" };

export function buildPrompt(
  text: string,
  src: string,
  tgt: string,
  style: string,
): string {
  if (style === "none") return text;
  if (style === "translate_gemma") {
    return (
      `You are a professional ${LANG_NAMES[src]} (${LANG_CODES[src]}) to ` +
      `${LANG_NAMES[tgt]} (${
        LANG_CODES[tgt]
      }) translator. Your goal is to accurately ` +
      `convey the meaning and nuances of the original ${
        LANG_NAMES[src]
      } text while ` +
      `adhering to ${
        LANG_NAMES[tgt]
      } grammar, vocabulary, and cultural sensitivities. ` +
      `Produce only the ${
        LANG_NAMES[tgt]
      } translation, without any additional ` +
      `explanations or commentary. Please translate the following ${
        LANG_NAMES[src]
      } ` +
      `text into ${LANG_NAMES[tgt]}:\n\n\n${text}`
    );
  }
  if (style === "hymt2") {
    return `Translate the following segment into ${
      LANG_NAMES[tgt]
    }, without additional explanation：\n\n${text}`;
  }
  return (
    `Translate the following ${LANG_NAMES[src]} text into ${
      LANG_NAMES[tgt]
    }. ` +
    `Respond with the translation only, no explanations.\n\n${text}`
  );
}

/** The production translation-engine system instruction, verbatim from
 * patipeaceplace's `plugins/auto-translate/src/providers.mjs` (`glmTranslate`). */
export const ENGINE_SYSTEM = (src: string, tgt: string) =>
  `You are a translation engine. Translate the user's text from ` +
  `${LANG_NAMES[src]} to ${LANG_NAMES[tgt]}. Output only the translation, ` +
  `preserving paragraph breaks. No notes, no reasoning, no alternatives.`;

/** ENGINE_SYSTEM plus an explicit placeholder-preservation clause for masked
 * segments (patipeaceplace `protectTerms`). ASCII brackets since the 2026-09-29
 * identity spike: private-use tokens break weak tokenizers (they render as bare
 * digits), [[n]] survived every measured model. */
export const ENGINE_PRESERVE_SYSTEM = (src: string, tgt: string) =>
  ENGINE_SYSTEM(src, tgt) +
  " Bracketed markers like [[0]] or [[3]] mark protected names: copy each marker exactly as written, never translate, reorder, renumber, merge, split, or drop markers.";

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export function buildMessages(
  text: string,
  src: string,
  tgt: string,
  style: string,
): ChatMessage[] {
  if (style === "engine") {
    return [
      { role: "system", content: ENGINE_SYSTEM(src, tgt) },
      { role: "user", content: text },
    ];
  }
  if (style === "engine-preserve") {
    return [
      { role: "system", content: ENGINE_PRESERVE_SYSTEM(src, tgt) },
      { role: "user", content: text },
    ];
  }
  return [{ role: "user", content: buildPrompt(text, src, tgt, style) }];
}
