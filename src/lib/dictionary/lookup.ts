import { writable, get } from 'svelte/store';
import { dictDb } from './db';
import { isCodePointJapanese, MAX_SCAN_CHARS, generateTextVariants } from './japanese';
import type { LookupResult, StoredTerm, Definition } from './types';
import { LanguageTransformer } from './vendor/language-transformer.js';
import { japaneseTransforms } from './vendor/japanese-transforms.js';

const japaneseTransformer = new LanguageTransformer();
japaneseTransformer.addDescriptor(japaneseTransforms);

/**
 * One candidate deinflection of the clicked text: a normalized/deinflected form
 * to look up, the part-of-speech conditions it must satisfy, and the chain of
 * transforms that produced it. Mirrors Yomitan's DatabaseDeinflection.
 */
interface DeinflectionCandidate {
  deinflectedText: string;
  conditions: number;
  inflectionPath: string[];
}

/** A matched, display-ready entry. Writings/readings of the same lexical entry
 *  (same JMdict `sequence`) are merged into one: `term` is the highest-scoring
 *  member, with the other writings/readings carried alongside. The inflection
 *  chain that reached it (shortest wins) and the glossary (deinflection-pointer
 *  "formOf" tuples stripped) come from that primary member. */
interface AssembledEntry {
  term: StoredTerm;
  altExpressions: string[];
  readings: string[];
  inflectionPath: string[];
  displayDefinitions: Definition[];
}

function dedupeKeepOrder(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of items) {
    if (x && !seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

/** Every variant×transform deinflection Yomitan would try for one prefix. */
function collectDeinflections(candidate: string): DeinflectionCandidate[] {
  const out: DeinflectionCandidate[] = [];
  for (const variant of generateTextVariants(candidate)) {
    for (const transformed of japaneseTransformer.transform(variant)) {
      // A transform chain can strip a short candidate down to nothing (e.g.
      // か → ''). An empty form can't be a dictionary headword, and querying
      // it would match every row with an empty reading.
      if (transformed.text.length === 0) continue;
      out.push({
        deinflectedText: transformed.text,
        conditions: transformed.conditions,
        inflectionPath: transformed.trace.map((f: { transform: string }) => f.transform)
      });
    }
  }
  return out;
}

/** Fetches every stored term whose expression OR reading equals any of `texts`,
 *  de-duplicated by id. Mirrors Yomitan's findTermsBulk querying both the
 *  `expression` and `reading` indices.
 *
 *  Query shape matters: one readonly transaction with a parallel getAll per
 *  key per index (Yomitan's _findMultiBulk pattern). Dexie's anyOf() instead
 *  walks a single cursor sequentially across the sorted key set — one IDB
 *  round-trip per key — which benchmarks ~3x slower for the hundreds of
 *  candidate forms a deinflection scan produces. */
async function fetchTermsForTexts(texts: string[]): Promise<StoredTerm[]> {
  // Never query the empty string: dictionaries imported before readings were
  // normalized store '' as the reading for kana-only terms, so reading == ''
  // would match (and deserialize) a hundred thousand rows in one call.
  const unique = [...new Set(texts)].filter((t) => t.length > 0);
  if (unique.length === 0) return [];
  const [byExpr, byReading] = await dictDb.transaction('r', dictDb.terms, () =>
    Promise.all([
      Promise.all(unique.map((t) => dictDb.terms.where('expression').equals(t).toArray())),
      Promise.all(unique.map((t) => dictDb.terms.where('reading').equals(t).toArray()))
    ])
  );
  const seenIds = new Set<number>();
  const out: StoredTerm[] = [];
  for (const arr of byExpr) {
    for (const t of arr) {
      if (t.id !== undefined && !seenIds.has(t.id)) {
        seenIds.add(t.id);
        out.push(t);
      }
    }
  }
  for (const arr of byReading) {
    for (const t of arr) {
      if (t.id !== undefined && !seenIds.has(t.id)) {
        seenIds.add(t.id);
        out.push(t);
      }
    }
  }
  return out;
}

/**
 * Yomitan parity: a deinflected candidate only matches a term whose
 * part-of-speech rules are compatible with the inflection that produced it.
 * e.g. deinflecting こもって via the godan -て rule yields こもう/こもる with a
 * `v5` condition; the noun 虚妄 (こもう, no rules) is rejected, the verb 籠もる
 * (こもる, `v5`) is kept. `conditions === 0` (a direct, non-inflected form)
 * matches anything. Mirrors Translator._matchEntriesToDeinflections.
 */
const conditionFlagsByRules = new Map<string, number>();
function termMatchesConditions(term: StoredTerm, conditions: number): boolean {
  // Matching runs per (candidate, term) pair in the scan's hot loop; the flag
  // computation only depends on the rules string, so memoize it.
  let definitionConditions = conditionFlagsByRules.get(term.rules);
  if (definitionConditions === undefined) {
    const partsOfSpeech = term.rules.length > 0 ? term.rules.split(' ') : [];
    definitionConditions = japaneseTransformer.getConditionFlagsFromPartsOfSpeech(partsOfSpeech);
    conditionFlagsByRules.set(term.rules, definitionConditions);
  }
  return LanguageTransformer.conditionsMatch(conditions, definitionConditions);
}

/**
 * Resolves a set of deinflection candidates into displayable entries, mirroring
 * Translator._getDeinflections → _getDictionaryEntries:
 *  1. fetch terms for every candidate, keep those whose POS satisfies the
 *     candidate's conditions, deduped by id keeping the shortest inflection chain;
 *  2. follow dictionary-defined deinflections (`[formOf, rules]` tuples) one level,
 *     so redirect/irregular entries resolve to their canonical target;
 *  3. pull in every writing/reading sharing a matched entry's JMdict `sequence`,
 *     so variant kanji surface even when the clicked form matched only one of them;
 *  4. strip those tuples from display and drop entries left with no real glossary;
 *  5. merge writings/readings sharing a `sequence` into one entry (Yomitan's
 *     "merge" mode), e.g. 籠もる・篭もる・隠る【こもる】 as a single result;
 *  6. sort: fewest inflection steps, then score, then longer headword.
 */
async function assembleEntries(
  candidates: DeinflectionCandidate[],
  prefetchedTerms?: StoredTerm[]
): Promise<AssembledEntry[]> {
  if (candidates.length === 0) return [];

  // id -> matched term reached via its shortest inflection chain.
  const matched = new Map<number, { term: StoredTerm; path: string[] }>();
  const consider = (term: StoredTerm, cands: DeinflectionCandidate[]): void => {
    if (term.id === undefined) return;
    for (const c of cands) {
      if (term.expression !== c.deinflectedText && term.reading !== c.deinflectedText) continue;
      if (!termMatchesConditions(term, c.conditions)) continue;
      const existing = matched.get(term.id);
      if (!existing || c.inflectionPath.length < existing.path.length) {
        matched.set(term.id, { term, path: c.inflectionPath });
      }
    }
  };

  // Phase 1: algorithm deinflections. The scan may have already bulk-fetched
  // every candidate's terms — reuse them to avoid a redundant DB round-trip.
  const terms =
    prefetchedTerms ?? (await fetchTermsForTexts(candidates.map((c) => c.deinflectedText)));
  for (const term of terms) consider(term, candidates);

  // Phase 2: dictionary-defined deinflections (formOf redirects), one level deep.
  const dictCandidates: DeinflectionCandidate[] = [];
  for (const { term, path } of matched.values()) {
    for (const def of term.definitions as unknown[]) {
      if (!Array.isArray(def)) continue;
      const [formOf, inflectionRules] = def as [string, string[]];
      if (!formOf) continue;
      dictCandidates.push({
        deinflectedText: formOf,
        conditions: 0,
        inflectionPath: [...path, ...(Array.isArray(inflectionRules) ? inflectionRules : [])]
      });
    }
  }
  if (dictCandidates.length > 0) {
    const dictTerms = await fetchTermsForTexts(dictCandidates.map((c) => c.deinflectedText));
    for (const term of dictTerms) consider(term, dictCandidates);
  }

  // Phase 3: merge-mode expansion. Pull in every writing/reading sharing a
  // matched entry's JMdict sequence (Yomitan's findTermsBySequenceBulk), so e.g.
  // clicking 言った surfaces 言う・云う・謂う, not just the one writing matched.
  // Each pulled-in term inherits the shortest inflection chain of its sequence.
  const pathByKey = new Map<string, string[]>();
  for (const { term, path } of matched.values()) {
    if (term.sequence > 0) {
      const key = `${term.dictionaryId}:${term.sequence}`;
      const cur = pathByKey.get(key);
      if (!cur || path.length < cur.length) pathByKey.set(key, path);
    }
  }
  const sequences = [...new Set([...matched.values()].map((m) => m.term.sequence))].filter(
    (s) => s > 0
  );
  if (sequences.length > 0) {
    const related = await dictDb.terms.where('sequence').anyOf(sequences).toArray();
    for (const term of related) {
      if (term.id === undefined || matched.has(term.id)) continue;
      // Scope by dictionaryId too — sequence numbers can collide across dictionaries.
      const path = pathByKey.get(`${term.dictionaryId}:${term.sequence}`);
      if (path) matched.set(term.id, { term, path });
    }
  }

  // Strip array-type "definitions" (the deinflection pointers); drop entries
  // left with no real glossary.
  const perTerm: { term: StoredTerm; path: string[]; defs: Definition[] }[] = [];
  for (const { term, path } of matched.values()) {
    const defs = term.definitions.filter((d) => !Array.isArray(d));
    if (defs.length === 0) continue;
    perTerm.push({ term, path, defs });
  }

  // Group writings/readings that share a JMdict sequence (same lexical entry).
  // Sequence is per-dictionary; only positive sequences are real JMdict entries —
  // Jitendex uses <= 0 for redirects, which must stay standalone.
  type Member = (typeof perTerm)[number];
  const groups = new Map<string, Member[]>();
  const order: (Member[] | Member)[] = [];
  for (const pt of perTerm) {
    if (pt.term.sequence > 0) {
      const key = `${pt.term.dictionaryId}:${pt.term.sequence}`;
      let group = groups.get(key);
      if (!group) {
        group = [];
        groups.set(key, group);
        order.push(group);
      }
      group.push(pt);
    } else {
      order.push(pt);
    }
  }

  const buildMerged = (members: Member[]): AssembledEntry => {
    members.sort((a, b) => b.term.score - a.term.score);
    const primary = members[0];
    const expressions = dedupeKeepOrder(members.map((m) => m.term.expression));
    const path = members.reduce((s, m) => (m.path.length < s.length ? m.path : s), primary.path);
    return {
      term: primary.term,
      altExpressions: expressions.slice(1),
      readings: dedupeKeepOrder(members.map((m) => m.term.reading)),
      inflectionPath: path,
      displayDefinitions: primary.defs
    };
  };

  const entries = order.map((g) => buildMerged(Array.isArray(g) ? g : [g]));

  entries.sort(
    (a, b) =>
      a.inflectionPath.length - b.inflectionPath.length ||
      b.term.score - a.term.score ||
      b.term.expression.length - a.term.expression.length
  );

  return entries;
}

export interface PopupState {
  results: LookupResult[];
  /** Combined, popup-scoped CSS from the dictionaries' bundled styles.css */
  css: string;
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
 * Yomitan-style greedy forward scan with deinflection. Collects every
 * variant×deinflection candidate across *all* prefix lengths, issues a single
 * bulk DB query for them, then keeps the longest prefix that has a valid match
 * and assembles *all* its entries (so e.g. いって surfaces both 言う and 行く).
 *
 * Doing one bulk fetch — instead of a DB round-trip per prefix length — is what
 * makes a click feel instant even mid-way through a long unbroken run of kana.
 */
export async function findBestMatch(
  text: string,
  startOffset: number
): Promise<MatchResult | null> {
  if (!(await ensureHasDictionaries())) return null;

  const chars: string[] = [];
  let i = startOffset;
  while (i < text.length && chars.length < MAX_SCAN_CHARS) {
    const cp = text.codePointAt(i);
    if (cp === undefined || !isCodePointJapanese(cp)) break;
    chars.push(cp > 0xffff ? text.slice(i, i + 2) : text[i]);
    i += cp > 0xffff ? 2 : 1;
  }

  if (chars.length === 0) return null;

  // Collect candidates for every prefix length, tagged with that length.
  const allCandidates: (DeinflectionCandidate & { sourceLength: number })[] = [];
  for (let len = 1; len <= chars.length; len++) {
    const candidate = chars.slice(0, len).join('');
    for (const c of collectDeinflections(candidate)) {
      allCandidates.push({ ...c, sourceLength: len });
    }
  }

  // One bulk query for every candidate form.
  const allTerms = await fetchTermsForTexts(allCandidates.map((c) => c.deinflectedText));
  if (allTerms.length === 0) return null;

  // Index fetched terms by their expression/reading for O(1) candidate matching.
  const termsByText = new Map<string, StoredTerm[]>();
  for (const term of allTerms) {
    const keys =
      term.expression === term.reading ? [term.expression] : [term.expression, term.reading];
    for (const key of keys) {
      if (!key) continue;
      const arr = termsByText.get(key);
      if (arr) arr.push(term);
      else termsByText.set(key, [term]);
    }
  }

  // Longest prefix length with at least one condition-valid match wins.
  let bestLength = 0;
  for (const c of allCandidates) {
    if (c.sourceLength <= bestLength) continue;
    const candTerms = termsByText.get(c.deinflectedText);
    if (candTerms?.some((t) => termMatchesConditions(t, c.conditions))) {
      bestLength = c.sourceLength;
    }
  }
  if (bestLength === 0) return null;

  const bestCandidates = allCandidates.filter((c) => c.sourceLength === bestLength);
  const state = await buildPopupState(bestCandidates, allTerms);
  if (!state) return null;

  return { utf16Length: chars.slice(0, bestLength).join('').length, state };
}

// Per-dictionary metadata (title + popup-scoped CSS) barely changes, so cache it
// once rather than re-querying on every lookup.
interface DictMeta {
  title: string;
  css: string;
}
const dictMetaCache = new Map<number, DictMeta>();

async function getDictMeta(dictionaryId: number): Promise<DictMeta> {
  const cached = dictMetaCache.get(dictionaryId);
  if (cached !== undefined) return cached;

  const dict = await dictDb.dictionaries.get(dictionaryId);
  const { scopeCss } = await import('./scope-css');
  const meta: DictMeta = {
    title: dict?.title ?? 'Unknown',
    css: dict?.styleCss ? scopeCss(dict.styleCss, '.dict-definitions') : ''
  };
  dictMetaCache.set(dictionaryId, meta);
  return meta;
}

/** Assembles entries for a set of deinflection candidates into popup state, or
 *  null if nothing matches. `prefetchedTerms`, when supplied, are reused for the
 *  initial match step instead of re-querying. */
async function buildPopupState(
  candidates: DeinflectionCandidate[],
  prefetchedTerms?: StoredTerm[]
): Promise<PopupState | null> {
  const entries = await assembleEntries(candidates, prefetchedTerms);
  if (entries.length === 0) return null;

  const dictionaryIds = [...new Set(entries.map((e) => e.term.dictionaryId))];
  const metas = await Promise.all(dictionaryIds.map((id) => getDictMeta(id)));
  const titleMap = new Map(dictionaryIds.map((id, idx) => [id, metas[idx].title]));

  // Combine the bundled CSS of every dictionary present in the results.
  const css = metas
    .map((m) => m.css)
    .filter(Boolean)
    .join('\n');

  const results: LookupResult[] = entries.map((e) => ({
    expression: e.term.expression,
    reading: e.readings[0] ?? e.term.reading,
    altExpressions: e.altExpressions,
    altReadings: e.readings.slice(1),
    definitions: e.displayDefinitions,
    dictionaryTitle: titleMap.get(e.term.dictionaryId) ?? 'Unknown',
    score: e.term.score,
    inflectionPath: e.inflectionPath
  }));

  return { results, css };
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
  const state = await buildPopupState([
    { deinflectedText: expression, conditions: 0, inflectionPath: [] }
  ]);
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
