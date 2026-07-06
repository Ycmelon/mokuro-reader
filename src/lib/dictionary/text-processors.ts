/*
 * Japanese text preprocessors, ported from Yomitan's term-lookup pipeline.
 *
 * Mirrors ext/js/language/ja/japanese-text-preprocessors.js (the processor set)
 * and ext/js/language/translator.js `_getTextVariants` (the cartesian expansion
 * that turns them into candidate spellings). Each processor maps a string to the
 * variants it should also be looked up as; the unmodified text is always the
 * first element, so exact forms still hit.
 *
 * This replaces the previous hand-rolled `generateTextVariantsWithPenalty`,
 * which invented a ranking penalty per lossy normalization. Yomitan needs no
 * penalty: every variant records the chain of processors that produced it, and
 * ranking later prefers the shortest chain (see `getShortestTextProcessingChain`
 * in lookup.ts). A processor that leaves the string unchanged contributes no
 * chain step.
 */

import {
  convertHalfWidthKanaToFullWidth,
  normalizeCombiningCharacters,
  normalizeCJKCompatibilityCharacters,
  normalizeEnclosedCJKCharacters,
  convertAlphanumericToFullWidth,
  convertFullWidthAlphanumericToNormal,
  convertHiraganaToKatakana,
  convertKatakanaToHiragana,
  collapseEmphaticSequences,
  convertKyuujitaiToShinjitai,
  expandChoon
} from './japanese';

/** One text preprocessor: a stable id (used as the rule-chain token) and a
 *  function returning every spelling the input should also match. The input
 *  itself must be the first element. */
export interface TextProcessor {
  id: string;
  process: (text: string) => string[];
}

/**
 * The `ja` preprocessor list, in Yomitan's descriptor order
 * (language-descriptors.js, `iso: 'ja'`). Order matters: variants compose as a
 * cartesian product in sequence, so a later processor sees every spelling the
 * earlier ones produced.
 *
 * Omitted from Yomitan's set, matching the prior implementation:
 *  - `alphabeticToHiragana` (romaji → kana): only relevant to typed input, not
 *    OCR'd manga text.
 *  - `normalizeRadicalCharacters`: needs a large external mapping table.
 *
 * Project extensions kept (additive variant generators, not heuristics):
 *  - `standardizeKanji`: uses our `convertKyuujitaiToShinjitai` in place of
 *    Yomitan's `standardizeKanji`/`convertVariants`.
 *  - `expandChoon` / `normalizeEnclosedCJK`: manga-oriented spellings.
 */
export const japaneseTextProcessors: TextProcessor[] = [
  {
    id: 'convertHalfWidthCharacters',
    process: (s) => [s, convertHalfWidthKanaToFullWidth(s)]
  },
  {
    id: 'normalizeCombiningCharacters',
    process: (s) => [s, normalizeCombiningCharacters(s)]
  },
  {
    id: 'normalizeCJKCompatibilityCharacters',
    process: (s) => [s, normalizeCJKCompatibilityCharacters(s)]
  },
  {
    id: 'normalizeEnclosedCJKCharacters',
    process: (s) => [s, normalizeEnclosedCJKCharacters(s)]
  },
  {
    id: 'alphanumericWidthVariants',
    process: (s) => [s, convertFullWidthAlphanumericToNormal(s), convertAlphanumericToFullWidth(s)]
  },
  {
    id: 'convertHiraganaToKatakana',
    process: (s) => [s, convertHiraganaToKatakana(s), convertKatakanaToHiragana(s)]
  },
  {
    id: 'collapseEmphaticSequences',
    process: (s) => [s, collapseEmphaticSequences(s, false), collapseEmphaticSequences(s, true)]
  },
  {
    id: 'standardizeKanji',
    process: (s) => [s, convertKyuujitaiToShinjitai(s)]
  },
  {
    id: 'expandChoon',
    process: (s) => [s, ...expandChoon(s)]
  }
];

/** A candidate spelling of the source text, paired with the chains of
 *  preprocessor ids that produced it. An empty chain means the spelling is the
 *  unmodified source. */
export type TextVariantMap = Map<string, string[][]>;

/**
 * Port of Translator._getTextVariants (without text replacements). Grows a
 * variant→rule-chains map by applying each processor in order: a processor that
 * changes the string forks a new variant whose chains gain that processor's id;
 * a processor that leaves it unchanged carries the existing chains forward.
 * Multiple processors reaching the same spelling merge their chains, so ranking
 * can later pick the shortest.
 */
export function getTextVariants(
  text: string,
  processors: TextProcessor[] = japaneseTextProcessors
): TextVariantMap {
  let variantsMap: TextVariantMap = new Map([[text, [[]]]]);

  for (const { id, process } of processors) {
    const next: TextVariantMap = new Map();
    for (const [variant, chains] of variantsMap) {
      for (const processed of process(variant)) {
        const existing = next.get(processed);
        if (processed === variant) {
          // Processor was a no-op for this variant: keep its chains as-is.
          next.set(processed, existing ?? chains);
        } else if (existing === undefined) {
          next.set(
            processed,
            chains.map((chain) => [...chain, id])
          );
        } else {
          next.set(processed, [...existing, ...chains.map((chain) => [...chain, id])]);
        }
      }
    }
    variantsMap = next;
  }

  return variantsMap;
}
