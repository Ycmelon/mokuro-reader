/**
 * Card generation helpers shared by the review dialog (inline "Generate") and
 * the chat refinement loop. Pure logic — no chat-store dependency (the store
 * imports from here, not the other way around).
 */

import { get } from 'svelte/store';
import { miscSettings } from '$lib/settings/misc';
import { streamOpenRouter, type ChatMessage } from './openrouter';

/** The mined half of a card: comes from the crop/review dialog, not the AI. */
export interface CardBase {
  sentence: string;
  focus: string;
  image: string;
}

/** The AI-generated half of a card. `sentence`/`focus` echo the input, corrected
 *  only where OCR clearly erred; `comments` notes any such fix (usually empty). */
export interface CardFields {
  sentence: string;
  focus: string;
  reading: string;
  meaning: string;
  extra: string;
  comments: string;
}

/** System prompt for card generation. Reading is always kana; the meaning/extra
 *  language follows the user's setting. */
export function cardSystemPrompt(lang: 'english' | 'japanese'): string {
  const langName = lang === 'japanese' ? 'Japanese' : 'English';
  return `You build Japanese expression flashcards from manga; given a sentence and a focus expression, explain the focus expression.
For expressions with multiple meanings, output only the meaning in the context of the given sentence.
For expressions, transform adjectives and verbs into the plain dictionary form and add a comment.
If the focus expression is written in kana when it is commonly written in kanji, output the kanji form in the focus field and add a comment.
OCR mistakes occur sometimes. If you are confident there is an error, update the sentence/focus and add a comment.

Reply with ONLY a fenced \`\`\`json code block (no prose) of the exact form:
{"sentence": "<omit this field if there are no changes>",
"focus": "<omit this field if there are no changes>",
"reading": "<reading of focus expression in kana>",
"meaning": "<brief definition/explanation of the focus expression in ${langName}>",
"extra": "<omit this field if the focus expression is straightforward (90%); otherwise, important context or nuance in ${langName}>",
"comments": "<omit this field if there are no changes; otherwise, briefly say what and why (e.g. 'Fixed OCR: 二 → ニ')>"}`;
}

/** The first user turn that seeds generation for a mined card. Follow-up
 *  instruction turns are appended by the caller to build a refinement history. */
export function buildGenerationPrompt(base: CardBase): string {
  return `Sentence: ${base.sentence}\nFocus: ${base.focus}\nGenerate the card.`;
}

/**
 * Extract card fields from a model reply. Prefers a fenced ```json block, and
 * falls back to the first `{...}` object. Returns null until a complete,
 * parseable object is present (so it can be called on a still-streaming reply).
 */
export function parseCardReply(content: string): Partial<CardFields> | null {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : content.match(/\{[\s\S]*\}/)?.[0];
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (typeof obj !== 'object' || obj === null) return null;
    // Keep only the keys the model actually sent, so regenerations merge over
    // the existing card instead of blanking omitted fields (e.g. reading).
    const keys = ['sentence', 'focus', 'reading', 'meaning', 'extra', 'comments'] as const;
    const out: Partial<CardFields> = {};
    for (const key of keys) {
      if (obj[key] != null) out[key] = String(obj[key]);
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Generate (or regenerate) a card from a running message history. Returns the
 * parsed fields plus the raw assistant reply, so the caller can append it to the
 * history and keep the refinement conversation going. Throws on missing key /
 * parse failure.
 */
export async function generateFromMessages(
  messages: ChatMessage[]
): Promise<{ fields: Partial<CardFields>; reply: string }> {
  const { openrouterApiKey, model } = get(miscSettings).aiChatSettings;
  const lang = get(miscSettings).ankiServerSettings.cardLanguage;
  const reply = await streamOpenRouter(
    messages,
    model,
    openrouterApiKey,
    cardSystemPrompt(lang),
    () => {}
  );
  const fields = parseCardReply(reply);
  if (!fields) throw new Error('Could not parse the generated card. Please try again.');
  return { fields, reply };
}
