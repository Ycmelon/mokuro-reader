import { writable, get } from 'svelte/store';
import { dictDb } from './db';
import { isCodePointJapanese, MAX_SCAN_CHARS, generateTextVariants } from './japanese';
import type { LookupResult } from './types';
import { LanguageTransformer } from './vendor/language-transformer.js';
import { japaneseTransforms } from './vendor/japanese-transforms.js';

const japaneseTransformer = new LanguageTransformer();
japaneseTransformer.addDescriptor(japaneseTransforms);

export interface PopupState {
  results: LookupResult[];
  /** Combined, popup-scoped CSS from the dictionaries' bundled styles.css */
  css: string;
}

export interface MatchResult {
  originalText: string;
  utf16Length: number;
  deinflectedText: string;
  inflectionPath: string[];
}

export const dictPopup = writable<PopupState | null>(null);

/** Previous popup states, so cross-reference navigation can go back. */
export const popupStack = writable<PopupState[]>([]);

/**
 * Identity of the currently revealed text box (mobile tap-to-reveal model).
 * Only one text box is "active" (showing its OCR text) at a time.
 */
export const activeTextBox = writable<string | null>(null);

export function setActiveTextBox(id: string): void {
  activeTextBox.set(id);
}

export function clearActiveTextBox(): void {
  activeTextBox.set(null);
}

export function closePopup(): void {
  dictPopup.set(null);
  popupStack.set([]);
  clearWordHighlight();
}

// ── Word highlight (CSS Custom Highlight API) ────────────────────────────────
// Marks the looked-up word without touching the DOM or the browser selection
// (which would trigger native mobile selection handles / copy bubbles).
const HIGHLIGHT_NAME = 'dict-word';
let wordHighlight: Highlight | null = null;

function getWordHighlight(): Highlight | null {
  if (typeof window === 'undefined') return null;
  if (typeof Highlight === 'undefined' || !window.CSS?.highlights) return null;
  if (!wordHighlight) {
    wordHighlight = new Highlight();
    window.CSS.highlights.set(HIGHLIGHT_NAME, wordHighlight);
  }
  return wordHighlight;
}

/** Highlights the given range(s) as the active dictionary word. Multiple ranges
 *  are used when a word spans a line break (separate text nodes). */
export function highlightWord(ranges: Range | Range[]): void {
  const h = getWordHighlight();
  if (h) {
    h.clear();
    for (const r of Array.isArray(ranges) ? ranges : [ranges]) h.add(r);
  }
}

export function clearWordHighlight(): void {
  wordHighlight?.clear();
}

/**
 * Yomitan-style greedy forward scan with deinflection:
 * Tries each prefix length longest-first. For each prefix, generates kana
 * normalization variants and runs LanguageTransformer BFS deinflection.
 * Returns the longest prefix that has any dictionary hit (direct or deinflected).
 */
export async function findBestMatch(
  text: string,
  startOffset: number
): Promise<MatchResult | null> {
  if ((await dictDb.dictionaries.count()) === 0) return null;

  const chars: string[] = [];
  let i = startOffset;
  while (i < text.length && chars.length < MAX_SCAN_CHARS) {
    const cp = text.codePointAt(i);
    if (cp === undefined || !isCodePointJapanese(cp)) break;
    chars.push(cp > 0xffff ? text.slice(i, i + 2) : text[i]);
    i += cp > 0xffff ? 2 : 1;
  }

  if (chars.length === 0) return null;

  for (let len = chars.length; len >= 1; len--) {
    const candidate = chars.slice(0, len).join('');
    const variants = generateTextVariants(candidate);

    for (const variant of variants) {
      const transformedTexts = japaneseTransformer.transform(variant);
      for (const transformed of transformedTexts) {
        const hit = await dictDb.terms.where('expression').equals(transformed.text).count();
        if (hit > 0) {
          return {
            originalText: candidate,
            utf16Length: candidate.length,
            deinflectedText: transformed.text,
            inflectionPath: transformed.trace.map((f: { transform: string }) => f.transform)
          };
        }
      }
    }
  }

  return null;
}

// Cache of popup-scoped CSS per dictionary id (styles.css rarely changes)
const scopedCssCache = new Map<number, string>();

async function getScopedCss(dictionaryId: number): Promise<string> {
  const cached = scopedCssCache.get(dictionaryId);
  if (cached !== undefined) return cached;

  const dict = await dictDb.dictionaries.get(dictionaryId);
  const { scopeCss } = await import('./scope-css');
  const scoped = dict?.styleCss ? scopeCss(dict.styleCss, '.dict-definitions') : '';
  scopedCssCache.set(dictionaryId, scoped);
  return scoped;
}

/** Builds a popup state for an exact expression, or null if nothing matches. */
async function buildPopupState(
  expression: string,
  inflectionPath: string[]
): Promise<PopupState | null> {
  if ((await dictDb.dictionaries.count()) === 0) return null;

  const terms = await dictDb.terms.where('expression').equals(expression).toArray();
  if (terms.length === 0) return null;

  terms.sort((a, b) => b.score - a.score);

  const dictionaryIds = [...new Set(terms.map((t) => t.dictionaryId))];
  const dicts = await Promise.all(dictionaryIds.map((id) => dictDb.dictionaries.get(id)));
  const dictMap = new Map(dicts.filter(Boolean).map((d) => [d!.id!, d!.title]));

  // Combine the bundled CSS of every dictionary present in the results.
  const cssParts = await Promise.all(dictionaryIds.map((id) => getScopedCss(id)));
  const css = cssParts.filter(Boolean).join('\n');

  const results: LookupResult[] = terms.map((term) => ({
    expression: term.expression,
    reading: term.reading,
    definitions: term.definitions,
    dictionaryTitle: dictMap.get(term.dictionaryId) ?? 'Unknown',
    score: term.score,
    inflectionPath
  }));

  return { results, css };
}

/** Entry point from a manga tap — starts a fresh lookup (clears history). */
export async function lookupAndShow(
  deinflectedText: string,
  inflectionPath: string[]
): Promise<void> {
  const state = await buildPopupState(deinflectedText, inflectionPath);
  popupStack.set([]);
  dictPopup.set(state);
}

/**
 * Follows a cross-reference inside a definition to another dictionary entry,
 * pushing the current entry onto the back stack. No-op if the term isn't found.
 */
export async function lookupReference(expression: string): Promise<void> {
  const state = await buildPopupState(expression, []);
  if (!state) return;
  const current = get(dictPopup);
  if (current) popupStack.update((stack) => [...stack, current]);
  dictPopup.set(state);
}

/** Returns to the previous entry after following a cross-reference. */
export function popupGoBack(): void {
  const stack = get(popupStack);
  if (stack.length === 0) return;
  const previous = stack[stack.length - 1];
  popupStack.set(stack.slice(0, -1));
  dictPopup.set(previous);
}
