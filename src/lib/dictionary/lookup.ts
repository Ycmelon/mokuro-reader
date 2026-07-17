import { writable, get } from 'svelte/store';
import { dictDb } from './db';
import { isCodePointJapanese, MAX_SCAN_CHARS } from './japanese';
import { getTextVariants } from './text-processors';
import { detectEraYear, type EraYearMatch } from './era';
import type { LookupResult, StoredTerm, Headword, PitchAccent, Sense } from './types';
import { LanguageTransformer } from './vendor/language-transformer.js';
import { japaneseTransformsExtended } from './japanese-transforms-extra';
import { getKanaHeadwordType, getPriority, type DictionaryWordResult } from './word-match-sorting';

const japaneseTransformer = new LanguageTransformer();
japaneseTransformer.addDescriptor(japaneseTransformsExtended);

/**
 * One candidate deinflection of a source substring — a faithful port of
 * Yomitan's `DatabaseDeinflection`. It carries the original (un-preprocessed)
 * substring, the preprocessed spelling it was looked up as, the deinflected
 * form, the POS conditions the deinflection requires, and the chains of
 * text-processor ids / inflection rules that produced it. Matched dictionary
 * words are attached in `databaseEntries`.
 */
interface DatabaseDeinflection {
  originalText: string;
  transformedText: string;
  deinflectedText: string;
  conditions: number;
  /** Preprocessor id chains that produced `transformedText` (Yomitan
   *  textProcessorRuleChainCandidates). Shortest wins when ranking. */
  textProcessorChains: string[][];
  /** Inflection-rule names applied to reach `deinflectedText`. */
  inflectionRules: string[];
  databaseEntries: StoredTerm[];
}

/** A matched dictionary word, deduplicated across the deinflections that reached
 *  it. Text-derived ranking fields remain Yomitan-owned; entry-derived ranking
 *  fields and per-headword match ranges are 10ten-owned. */
interface DictionaryEntry {
  term: StoredTerm;
  /** Length of the source substring that resolved to this word (Yomitan
   *  maxOriginalTextLength — the highlight/ranking length). */
  maxOriginalTextLength: number;
  /** Length of the held candidate's preprocessed spelling. Yomitan keeps the
   *  candidate with the longest `transformedText` and merges only ties, so a
   *  lossy shorter variant (e.g. an emphatic collapse) can't contribute an
   *  artificially short inflection chain. */
  transformedTextLength: number;
  /** Text-processor id chains across all reaching deinflections (shortest used). */
  textProcessorChains: string[][];
  /** Inflection-rule chains across all reaching deinflections (shortest used). */
  inflectionChains: string[][];
  /** The single inflection chain kept for display (shortest). */
  inflectionPath: string[];
  /** Transient 10ten-shaped word with `matchRange` only on reached headwords. */
  wordResult: DictionaryWordResult;
  /** 1 = kanji/kana-primary match; 2 = kana merely read by a kanji headword. */
  headwordType: 1 | 2;
  /** Granular priority of the matched headword(s). */
  priority: number;
}

// ── Deinflection (Translator._getAlgorithmDeinflections) ─────────────────────

/**
 * Port of Yomitan's `_getAlgorithmDeinflections`: scan the source
 * longest-substring-first (shrinking one character at a time), expand each
 * substring through the text preprocessors, and run every variant through the
 * language transformer. Emits one `DatabaseDeinflection` per (substring, variant,
 * transform) combination.
 */
function collectDeinflections(text: string): DatabaseDeinflection[] {
  const deinflections: DatabaseDeinflection[] = [];

  for (let rawSource = text; rawSource.length > 0; rawSource = rawSource.slice(0, -1)) {
    const variantsMap = getTextVariants(rawSource);
    for (const [variant, chains] of variantsMap) {
      for (const transformed of japaneseTransformer.transform(variant)) {
        // A transform chain can strip a short candidate to nothing (か → '').
        // An empty form is not a headword and would match every empty reading.
        if (transformed.text.length === 0) continue;
        deinflections.push({
          originalText: rawSource,
          transformedText: variant,
          deinflectedText: transformed.text,
          conditions: transformed.conditions,
          textProcessorChains: chains,
          inflectionRules: transformed.trace.map((f: { transform: string }) => f.transform),
          databaseEntries: []
        });
      }
    }
  }

  return deinflections;
}

// ── Database access (DictionaryDatabase.findTermsBulk adapter) ────────────────

/** Yomitan parity: a deinflected candidate only matches a word whose POS rules
 *  are compatible with the inflection that produced it. `conditions === 0` (a
 *  direct, non-inflected form) matches anything. Mirrors
 *  Translator._matchEntriesToDeinflections. */
const conditionFlagsByRules = new Map<string, number>();
function termMatchesConditions(term: StoredTerm, conditions: number): boolean {
  let definitionConditions = conditionFlagsByRules.get(term.rules);
  if (definitionConditions === undefined) {
    const partsOfSpeech = term.rules.length > 0 ? term.rules.split(' ') : [];
    definitionConditions = japaneseTransformer.getConditionFlagsFromPartsOfSpeech(partsOfSpeech);
    conditionFlagsByRules.set(term.rules, definitionConditions);
  }
  return LanguageTransformer.conditionsMatch(conditions, definitionConditions);
}

/**
 * Adapter for Yomitan's `_addEntriesToDeinflections`: groups deinflections by
 * their deinflected form, issues one bulk query over the `*keys` multiEntry
 * index for every unique form (in a single readonly transaction), then attaches
 * each matched word to the condition-compatible deinflections that reached it.
 */
async function attachDatabaseEntries(deinflections: DatabaseDeinflection[]): Promise<void> {
  const byText = new Map<string, DatabaseDeinflection[]>();
  for (const d of deinflections) {
    let arr = byText.get(d.deinflectedText);
    if (!arr) byText.set(d.deinflectedText, (arr = []));
    arr.push(d);
  }

  const forms = [...byText.keys()].filter((t) => t.length > 0);
  if (forms.length === 0) return;

  const results = await dictDb.transaction('r', dictDb.terms, () =>
    Promise.all(forms.map((t) => dictDb.terms.where('keys').equals(t).toArray()))
  );

  for (let i = 0; i < forms.length; i++) {
    const group = byText.get(forms[i]);
    if (!group) continue;
    for (const term of results[i]) {
      for (const d of group) {
        if (termMatchesConditions(term, d.conditions)) d.databaseEntries.push(term);
      }
    }
  }
}

// ── Entry assembly (Translator._getDictionaryEntries + sort) ──────────────────

function makeWordResult(term: StoredTerm, matchedForm: string): DictionaryWordResult {
  const mark = <T extends Headword>(headword: T) =>
    headword.text === matchedForm
      ? { ...headword, matchRange: [0, matchedForm.length] as [number, number] }
      : { ...headword };
  return {
    k: term.writings.map(mark),
    r: term.readings.map(mark),
    s: term.senses
  };
}

function markMatchedForm(result: DictionaryWordResult, matchedForm: string): void {
  for (const headword of [...result.k, ...result.r]) {
    if (headword.text === matchedForm && !headword.matchRange) {
      headword.matchRange = [0, matchedForm.length];
    }
  }
}

function shortestChainLength(chains: string[][]): number {
  let min = Infinity;
  for (const chain of chains) min = Math.min(min, chain.length);
  return min === Infinity ? 0 : min;
}

/**
 * Port of Yomitan's `_getDictionaryEntries`: dedupe matched words by id, keeping
 * the one reached by the longest source substring (merging ranking chains on
 * ties). Returns the entries plus the length of the longest matched substring,
 * which becomes the highlight span.
 */
function buildDictionaryEntries(deinflections: DatabaseDeinflection[]): {
  entries: DictionaryEntry[];
  originalTextLength: number;
} {
  let originalTextLength = 0;
  const byId = new Map<number, DictionaryEntry>();

  for (const d of deinflections) {
    if (d.databaseEntries.length === 0) continue;
    originalTextLength = Math.max(originalTextLength, d.originalText.length);

    for (const term of d.databaseEntries) {
      if (term.id === undefined) continue;
      const existing = byId.get(term.id);

      if (!existing) {
        byId.set(term.id, {
          term,
          maxOriginalTextLength: d.originalText.length,
          transformedTextLength: d.transformedText.length,
          textProcessorChains: [...d.textProcessorChains],
          inflectionChains: [d.inflectionRules],
          inflectionPath: d.inflectionRules,
          wordResult: makeWordResult(term, d.deinflectedText),
          headwordType: 1,
          priority: 0
        });
        continue;
      }

      markMatchedForm(existing.wordResult, d.deinflectedText);

      // Yomitan keys the keep/replace/merge decision on transformedText length:
      // a shorter (more lossily preprocessed) spelling never displaces or merges
      // into a longer one, so its chains can't skew ranking.
      if (d.transformedText.length < existing.transformedTextLength) continue;

      if (d.transformedText.length > existing.transformedTextLength) {
        existing.maxOriginalTextLength = d.originalText.length;
        existing.transformedTextLength = d.transformedText.length;
        existing.textProcessorChains = [...d.textProcessorChains];
        existing.inflectionChains = [d.inflectionRules];
        existing.inflectionPath = d.inflectionRules;
      } else {
        // Equal transformedText length: merge ranking chains; keep the shortest
        // inflection path for display.
        existing.maxOriginalTextLength = Math.max(
          existing.maxOriginalTextLength,
          d.originalText.length
        );
        existing.textProcessorChains.push(...d.textProcessorChains);
        existing.inflectionChains.push(d.inflectionRules);
        if (d.inflectionRules.length < existing.inflectionPath.length) {
          existing.inflectionPath = d.inflectionRules;
        }
      }
    }
  }

  return { entries: [...byId.values()], originalTextLength };
}

/** Yomitan's text-derived ladder followed by 10ten's entry-derived ladder. */
function sortEntries(entries: DictionaryEntry[]): void {
  for (const entry of entries) {
    const kanaReading = entry.wordResult.r.find((r) => !!r.matchRange);
    entry.headwordType = kanaReading ? getKanaHeadwordType(kanaReading, entry.wordResult) : 1;
    entry.priority = getPriority(entry.wordResult);
  }

  entries.sort(
    (a, b) =>
      b.maxOriginalTextLength - a.maxOriginalTextLength ||
      shortestChainLength(a.textProcessorChains) - shortestChainLength(b.textProcessorChains) ||
      shortestChainLength(a.inflectionChains) - shortestChainLength(b.inflectionChains) ||
      a.headwordType - b.headwordType ||
      b.priority - a.priority
  );
}

export interface PopupState {
  results: LookupResult[];
}

export interface MatchResult {
  /** UTF-16 length of the matched prefix, for highlighting the clicked span. */
  utf16Length: number;
  /** Fully-assembled popup state (all entries for the matched prefix). */
  state: PopupState;
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

// Once a dictionary is present it never disappears mid-session, so cache the
// check and skip a per-click `count()` round-trip.
let hasDictionaries = false;
async function ensureHasDictionaries(): Promise<boolean> {
  if (hasDictionaries) return true;
  hasDictionaries = (await dictDb.dictionaries.count()) > 0;
  return hasDictionaries;
}

/**
 * Yomitan-style term lookup at a click position. Scans the Japanese run starting
 * at `startOffset`, collects every longest-first deinflection candidate, bulk-
 * queries the database once, keeps the word(s) reached by the longest source
 * substring, and assembles them into ranked popup state.
 */
async function matchDictionary(text: string, startOffset: number): Promise<MatchResult | null> {
  if (!(await ensureHasDictionaries())) return null;

  // Gate on a contiguous Japanese run (bounded), so we never scan Latin/punct.
  const chars: string[] = [];
  let i = startOffset;
  while (i < text.length && chars.length < MAX_SCAN_CHARS) {
    const cp = text.codePointAt(i);
    if (cp === undefined || !isCodePointJapanese(cp)) break;
    chars.push(cp > 0xffff ? text.slice(i, i + 2) : text[i]);
    i += cp > 0xffff ? 2 : 1;
  }
  if (chars.length === 0) return null;

  const deinflections = collectDeinflections(chars.join(''));
  await attachDatabaseEntries(deinflections);

  const { entries, originalTextLength } = buildDictionaryEntries(deinflections);
  if (entries.length === 0) return null;

  const state = await assembleResults(entries);
  if (!state) return null;

  return { utf16Length: originalTextLength, state };
}

/** A synthetic, dictionary-independent result translating a Japanese era year
 *  (和暦) to the Gregorian calendar. */
function buildEraResult(era: EraYearMatch): LookupResult {
  const gloss = `西暦${era.gregorianYear}年 · ${era.gregorianYear} CE`;
  const sense: Sense = {
    pos: [],
    field: [],
    misc: [],
    dialect: [],
    info: [],
    glosses: [{ text: gloss }],
    xref: [],
    langSource: [],
    examples: []
  };
  return {
    expression: era.text,
    reading: '',
    writings: [{ text: era.text, obscure: false, hidden: false, priority: false, p: [], info: [] }],
    readings: [],
    senses: [sense],
    dictionaryTitle: 'Calendar',
    priority: false,
    inflectionPath: [],
    pitches: []
  };
}

/**
 * Full lookup at a click position: a Japanese era-year translation (when the
 * text there is one, e.g. 昭和五十六年 → 1981) shown above the ordinary
 * dictionary matches. Returns null only when neither applies.
 */
export async function findBestMatch(
  text: string,
  startOffset: number
): Promise<MatchResult | null> {
  const era = detectEraYear(text, startOffset);
  const dict = await matchDictionary(text, startOffset);
  if (!era && !dict) return null;

  const results: LookupResult[] = [];
  if (era) results.push(buildEraResult(era));
  if (dict) results.push(...dict.state.results);

  return {
    utf16Length: Math.max(era?.length ?? 0, dict?.utf16Length ?? 0),
    state: { results }
  };
}

// Per-dictionary title barely changes, so cache it once rather than re-querying
// on every lookup.
const dictTitleCache = new Map<number, string>();

async function getDictTitle(dictionaryId: number): Promise<string> {
  const cached = dictTitleCache.get(dictionaryId);
  if (cached !== undefined) return cached;
  const dict = await dictDb.dictionaries.get(dictionaryId);
  const title = dict?.title ?? 'Unknown';
  dictTitleCache.set(dictionaryId, title);
  return title;
}

// Pitch dictionaries are optional; most sessions have none, so cache
// the presence check to skip a per-lookup query when the table is empty.
let hasTermMeta: boolean | null = null;
async function ensureHasTermMeta(): Promise<boolean> {
  if (hasTermMeta === null) hasTermMeta = (await dictDb.termMeta.count()) > 0;
  return hasTermMeta;
}

/** Invalidate the cached term_meta presence flag after (re)importing metadata. */
export function invalidateTermMetaCache(): void {
  hasTermMeta = null;
}

/** Joins pitch-accent rows onto a merged entry, one PitchAccent per reading the
 *  entry displays. Returns [] when no pitch dictionary is installed. */
async function lookupPitches(writings: Headword[], readings: Headword[]): Promise<PitchAccent[]> {
  if (readings.length === 0 || !(await ensureHasTermMeta())) return [];

  const keys = [...new Set([...writings.map((w) => w.text), ...readings.map((r) => r.text)])];
  const rows = await dictDb.termMeta.where('expression').anyOf(keys).toArray();

  const readingSet = new Set(readings.map((r) => r.text));
  const byReading = new Map<string, Set<number>>();
  for (const row of rows) {
    if (row.mode !== 'pitch' || !row.positions) continue;
    const reading = row.reading ?? row.expression;
    if (!readingSet.has(reading)) continue;
    let set = byReading.get(reading);
    if (!set) byReading.set(reading, (set = new Set()));
    for (const p of row.positions) set.add(p);
  }

  const out: PitchAccent[] = [];
  for (const r of readings) {
    const set = byReading.get(r.text);
    if (set?.size) out.push({ reading: r.text, positions: [...set].sort((a, b) => a - b) });
  }
  return out;
}

/** Ranks assembled entries and renders them into popup state, joining dictionary
 *  titles and pitch accents. Returns null if nothing matched. */
async function assembleResults(entries: DictionaryEntry[]): Promise<PopupState | null> {
  if (entries.length === 0) return null;

  sortEntries(entries);

  const dictionaryIds = [...new Set(entries.map((e) => e.term.dictionaryId))];
  const titles = await Promise.all(dictionaryIds.map((id) => getDictTitle(id)));
  const titleMap = new Map(dictionaryIds.map((id, idx) => [id, titles[idx]]));

  const results: LookupResult[] = await Promise.all(
    entries.map(async (e) => {
      const priority =
        e.term.writings.some((h) => h.priority) || e.term.readings.some((h) => h.priority);
      return {
        expression: e.term.writings[0]?.text ?? e.term.readings[0]?.text ?? '',
        reading: e.term.readings[0]?.text ?? '',
        writings: e.term.writings,
        readings: e.term.readings,
        senses: e.term.senses,
        dictionaryTitle: titleMap.get(e.term.dictionaryId) ?? 'Unknown',
        priority,
        inflectionPath: e.inflectionPath,
        pitches: await lookupPitches(e.term.writings, e.term.readings)
      };
    })
  );

  return { results };
}

/** Shows an already-assembled lookup result, starting fresh history. */
export function showLookup(state: PopupState): void {
  popupStack.set([]);
  dictPopup.set(state);
}

/**
 * Follows a cross-reference inside a definition to another dictionary entry,
 * pushing the current entry onto the back stack. A cross-reference targets an
 * exact term with no inflection, so conditions are unconstrained (0). No-op if
 * the term isn't found.
 */
export async function lookupReference(expression: string): Promise<void> {
  if ((await dictDb.dictionaries.count()) === 0) return;

  const deinflection: DatabaseDeinflection = {
    originalText: expression,
    transformedText: expression,
    deinflectedText: expression,
    conditions: 0,
    textProcessorChains: [[]],
    inflectionRules: [],
    databaseEntries: []
  };
  await attachDatabaseEntries([deinflection]);

  const { entries } = buildDictionaryEntries([deinflection]);
  const state = await assembleResults(entries);
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
