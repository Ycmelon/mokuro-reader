// This is ported from 10ten's src/background/word-match-sorting.ts. Keep the
// structure and upstream comments close to that file so future updates remain
// straightforward to diff.

import type { Headword, Sense } from './types';

export type MatchedHeadword = Headword & {
  matchRange?: [number, number];
};

export interface DictionaryWordResult {
  k: MatchedHeadword[];
  r: MatchedHeadword[];
  s: Sense[];
}

export function getKanaHeadwordType(
  r: DictionaryWordResult['r'][number],
  result: DictionaryWordResult
): 1 | 2 {
  // We don't want to prioritize readings marked as `ok` etc. or else we'll end
  // up prioritizing words like `檜` and `羆` being prioritized when searching
  // for `ひ`.
  const isReadingObscure =
    r.info?.includes('ok') ||
    r.info?.includes('rk') ||
    r.info?.includes('sk') ||
    r.info?.includes('ik');

  if (isReadingObscure) {
    return 2;
  }

  // Kana headwords are type 1 (i.e. they are a primary headword, not just a
  // reading for a kanji headword) if:
  //
  // (a) the entry has no kanji headwords or all the kanji headwords are marked
  //     as `rK`, `sK`, or `iK`.
  if (
    !result.k.length ||
    result.k.every(
      (k) => k.info?.includes('rK') || k.info?.includes('sK') || k.info?.includes('iK')
    )
  ) {
    return 1;
  }

  // (b) most of the English senses for the entry have a `uk` (usually kana)
  //     `misc` field and the reading is not marked as `ok` (old kana usage).
  //
  // We wanted to make the condition here be just one sense being marked as `uk`
  // but then you get words like `梓` being prioritized when searching for `し`
  // because of one sense out of many being usually kana.
  //
  // Furthermore, we don't want to require _all_ senses to be marked as `uk` or
  // else that will mean that 成る fails to be prioritized when searching for
  // `なる` because one sense out of 11 is not marked as `uk`.
  if (mostMatchedEnSensesAreUk(result.s)) {
    return 1;
  }

  // (c) the headword is marked as `nokanji`
  return r.app === 0 ? 1 : 2;
}

function mostMatchedEnSensesAreUk(senses: DictionaryWordResult['s']): boolean {
  // Intentional divergence from 10ten: this dictionary does not filter senses
  // by matched headword, and every bundled sense is English, so use all senses.
  const matchedEnSenses = senses;
  if (matchedEnSenses.length === 0) {
    return false;
  }

  const ukEnSenseCount = matchedEnSenses.filter((s) => s.misc?.includes('uk')).length;
  return ukEnSenseCount >= matchedEnSenses.length / 2;
}

export function getPriority(result: DictionaryWordResult): number {
  const scores: Array<number> = [0];

  // Scores from kanji readings
  for (const k of result.k || []) {
    if (!k.matchRange || !k.p) {
      continue;
    }

    // A tiny matched-headword-only fallback keeps entries missing from the XML
    // join useful without letting another headword lend this one its priority.
    scores.push(k.p.length ? getPrioritySum(k.p) : Number(k.priority));
  }

  // Scores from kana readings
  for (const r of result.r) {
    if (!r.matchRange || !r.p) {
      continue;
    }

    scores.push(r.p.length ? getPrioritySum(r.p) : Number(r.priority));
  }

  // Return top score
  return Math.max(...scores);
}

// Produce an overall priority from a series of priority strings.
//
// This should produce a value somewhere in the range 0~67.
//
// In general we report the highest priority, but if we have several priority
// scores we add a decreasing fraction (10%) of the lesser scores as an
// indication that several sources have attested to the priority.
//
// That should typically produce a maximum attainable score of 66.8.
// Having a bounded range like this makes it easier to combine this value with
// other metrics when sorting.
function getPrioritySum(priorities: Array<string>): number {
  // Upstream intentionally uses Array.sort() without a numeric comparator. The
  // actual two-digit score set makes the lexicographic ordering benign.
  const scores = priorities.map(getPriorityScore).sort().reverse();
  return scores.length
    ? scores[0] +
        scores.slice(1).reduce((total, score, index) => total + score / Math.pow(10, index + 1), 0)
    : 0;
}

// This assignment is pretty arbitrary however it's mostly used for sorting
// entries where all we need to do is distinguish between the really common ones
// and the obscure academic ones.
//
// Entries with (P) are those ones that are marked with (P) in Edict.
const PRIORITY_ASSIGNMENTS: Map<string, number> = new Map([
  ['i1', 50], // Top 10,000 words minus i2 (from 1998) (P)
  ['i2', 20],
  ['n1', 40], // Top 12,000 words in newspapers (from 2003?) (P)
  ['n2', 20], // Next 12,000
  ['s1', 32], // "Speculative" annotations? Seem pretty common to me. (P)
  ['s2', 20], // (P)
  ['g1', 30], // (P)
  ['g2', 15]
]);

function getPriorityScore(p: string): number {
  if (PRIORITY_ASSIGNMENTS.has(p)) {
    return PRIORITY_ASSIGNMENTS.get(p)!;
  }

  if (p.startsWith('nf')) {
    // The wordfreq scores are groups of 500 words.
    // e.g. nf01 is the top 500 words, and nf48 is the 23,501 ~ 24,000
    // most popular words.
    const wordfreq = parseInt(p.substring(2), 10);
    if (wordfreq > 0 && wordfreq < 48) {
      return 48 - wordfreq / 2;
    }
  }

  return 0;
}
