/*
 * Japanese text utilities — Japanese codepoint detection and kana conversion.
 *
 * Adapted (reimplemented in TypeScript) from Yomitan:
 *   https://github.com/yomidevs/yomitan
 *   ext/js/language/ja/japanese.js and ext/js/language/CJK-util.js
 *
 * Copyright (C) 2023-2026  Yomitan Authors
 * Licensed under the GNU General Public License v3.0 or later — the same
 * license as this project. The logic mirrors the original Yomitan source.
 */

import {
  CJK_COMPATIBILITY,
  CJK_IDEOGRAPH_RANGES,
  CJK_PUNCTUATION_RANGE,
  FULLWIDTH_CHARACTER_RANGES,
  isCodePointInRange,
  isCodePointInRanges
} from './vendor/CJK-util.js';

type CodepointRange = [number, number];

// Ported verbatim from Yomitan's ext/js/language/ja/japanese.js JAPANESE_RANGES.
// Notably includes CJK_PUNCTUATION_RANGE, which holds the ideographic iteration
// mark 々 (U+3005) — without it the scan stops at 々 and words like 久々 / 時々 /
// 様々 (stored literally with 々 in the dictionary) never match.
const JAPANESE_RANGES: CodepointRange[] = [
  [0x3040, 0x309f], // Hiragana
  [0x30a0, 0x30ff], // Katakana
  ...CJK_IDEOGRAPH_RANGES,
  [0xff66, 0xff9f], // Halfwidth katakana
  [0x30fb, 0x30fc], // Katakana punctuation
  [0xff61, 0xff65], // Kana punctuation
  CJK_PUNCTUATION_RANGE,
  ...FULLWIDTH_CHARACTER_RANGES
];

export function isCodePointJapanese(cp: number): boolean {
  return isCodePointInRanges(cp, JAPANESE_RANGES);
}

export const MAX_SCAN_CHARS = 20;

// ── Kana conversion (ported from Yomitan ext/js/language/ja/japanese.js) ──────

const HIRAGANA_CONVERSION_RANGE: [number, number] = [0x3041, 0x3096];
const KATAKANA_CONVERSION_RANGE: [number, number] = [0x30a1, 0x30f6];
const KATAKANA_SMALL_KA = 0x30f5;
const KATAKANA_SMALL_KE = 0x30f6;
const PROLONGED_SOUND_MARK = 0x30fc;

const VOWEL_TO_HIRAGANA: Record<string, string> = {
  a: 'あ',
  i: 'い',
  u: 'う',
  e: 'え',
  o: 'う'
};
const KANA_TO_VOWEL = new Map<string, string>();
for (const [v, chars] of [
  ['a', 'ぁあかがさざただなはばぱまゃやらゎわヵァアカガサザタダナハバパマャヤラヮワヵヷ'],
  ['i', 'ぃいきぎしじちぢにひびぴみりゐィイキギシジチヂニヒビピミリヰヸ'],
  ['u', 'ぅうくぐすずっつづぬふぶぷむゅゆるゥウクグスズッツヅヌフブプムュユルヴ'],
  ['e', 'ぇえけげせぜてでねへべぺめれゑヶェエケゲセゼテデネヘベペメレヱヶヹ'],
  ['o', 'ぉおこごそぞとどのほぼぽもょよろをォオコゴソゾトドノホボポモョヨロヲヺ'],
  ['', 'のノ']
] as [string, string][]) {
  for (const ch of chars) KANA_TO_VOWEL.set(ch, v);
}

export function convertKatakanaToHiragana(text: string, keepProlongedSoundMarks = false): string {
  const offset = HIRAGANA_CONVERSION_RANGE[0] - KATAKANA_CONVERSION_RANGE[0];
  let result = '';
  for (let ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp === KATAKANA_SMALL_KA || cp === KATAKANA_SMALL_KE) {
      // keep as-is
    } else if (cp === PROLONGED_SOUND_MARK && !keepProlongedSoundMarks && result.length > 0) {
      const prolonged = VOWEL_TO_HIRAGANA[KANA_TO_VOWEL.get(result[result.length - 1]) ?? ''];
      if (prolonged) ch = prolonged;
    } else if (cp >= KATAKANA_CONVERSION_RANGE[0] && cp <= KATAKANA_CONVERSION_RANGE[1]) {
      ch = String.fromCodePoint(cp + offset);
    }
    result += ch;
  }
  return result;
}

export function convertHiraganaToKatakana(text: string): string {
  const offset = KATAKANA_CONVERSION_RANGE[0] - HIRAGANA_CONVERSION_RANGE[0];
  let result = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    result +=
      cp >= HIRAGANA_CONVERSION_RANGE[0] && cp <= HIRAGANA_CONVERSION_RANGE[1]
        ? String.fromCodePoint(cp + offset)
        : ch;
  }
  return result;
}

const HALFWIDTH_KATAKANA_MAPPING = new Map([
  ['･', '・--'],
  ['ｦ', 'ヲヺ-'],
  ['ｧ', 'ァ--'],
  ['ｨ', 'ィ--'],
  ['ｩ', 'ゥ--'],
  ['ｪ', 'ェ--'],
  ['ｫ', 'ォ--'],
  ['ｬ', 'ャ--'],
  ['ｭ', 'ュ--'],
  ['ｮ', 'ョ--'],
  ['ｯ', 'ッ--'],
  ['ｰ', 'ー--'],
  ['ｱ', 'ア--'],
  ['ｲ', 'イ--'],
  ['ｳ', 'ウヴ-'],
  ['ｴ', 'エ--'],
  ['ｵ', 'オ--'],
  ['ｶ', 'カガ-'],
  ['ｷ', 'キギ-'],
  ['ｸ', 'クグ-'],
  ['ｹ', 'ケゲ-'],
  ['ｺ', 'コゴ-'],
  ['ｻ', 'サザ-'],
  ['ｼ', 'シジ-'],
  ['ｽ', 'スズ-'],
  ['ｾ', 'セゼ-'],
  ['ｿ', 'ソゾ-'],
  ['ﾀ', 'タダ-'],
  ['ﾁ', 'チヂ-'],
  ['ﾂ', 'ツヅ-'],
  ['ﾃ', 'テデ-'],
  ['ﾄ', 'トド-'],
  ['ﾅ', 'ナ--'],
  ['ﾆ', 'ニ--'],
  ['ﾇ', 'ヌ--'],
  ['ﾈ', 'ネ--'],
  ['ﾉ', 'ノ--'],
  ['ﾊ', 'ハバパ'],
  ['ﾋ', 'ヒビピ'],
  ['ﾌ', 'フブプ'],
  ['ﾍ', 'ヘベペ'],
  ['ﾎ', 'ホボポ'],
  ['ﾏ', 'マ--'],
  ['ﾐ', 'ミ--'],
  ['ﾑ', 'ム--'],
  ['ﾒ', 'メ--'],
  ['ﾓ', 'モ--'],
  ['ﾔ', 'ヤ--'],
  ['ﾕ', 'ユ--'],
  ['ﾖ', 'ヨ--'],
  ['ﾗ', 'ラ--'],
  ['ﾘ', 'リ--'],
  ['ﾙ', 'ル--'],
  ['ﾚ', 'レ--'],
  ['ﾛ', 'ロ--'],
  ['ﾜ', 'ワ--'],
  ['ﾝ', 'ン--']
]);

export function convertHalfWidthKanaToFullWidth(text: string): string {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const mapping = HALFWIDTH_KATAKANA_MAPPING.get(c);
    if (!mapping) {
      result += c;
      continue;
    }
    let idx = 0;
    const next = text.charCodeAt(i + 1);
    if (next === 0xff9e) idx = 1;
    else if (next === 0xff9f) idx = 2;
    let c2 = mapping[idx];
    if (idx > 0) {
      if (c2 === '-') {
        idx = 0;
        c2 = mapping[0];
      } else i++;
    }
    result += c2;
  }
  return result;
}

// ── Emphatic sequence collapse (ported from Yomitan japanese.js) ──────────────

const HIRAGANA_SMALL_TSU_CODE_POINT = 0x3063;
const KATAKANA_SMALL_TSU_CODE_POINT = 0x30c3;

function isEmphaticCodePoint(codePoint: number): boolean {
  return (
    codePoint === HIRAGANA_SMALL_TSU_CODE_POINT ||
    codePoint === KATAKANA_SMALL_TSU_CODE_POINT ||
    codePoint === PROLONGED_SOUND_MARK
  );
}

/** Collapses emphatic kana runs, e.g. すっっごーーい → すっごーい (partial) or
 *  すごい (full). Matches Yomitan's collapseEmphaticSequences. */
export function collapseEmphaticSequences(text: string, fullCollapse: boolean): string {
  let left = 0;
  while (left < text.length && isEmphaticCodePoint(text.codePointAt(left)!)) ++left;
  let right = text.length - 1;
  while (right >= 0 && isEmphaticCodePoint(text.codePointAt(right)!)) --right;
  if (left > right) return text; // whole string is emphatic

  const leadingEmphatics = text.substring(0, left);
  const trailingEmphatics = text.substring(right + 1);
  let middle = '';
  let currentCollapsedCodePoint = -1;

  for (let i = left; i <= right; ++i) {
    const char = text[i];
    const codePoint = char.codePointAt(0)!;
    if (isEmphaticCodePoint(codePoint)) {
      if (currentCollapsedCodePoint !== codePoint) {
        currentCollapsedCodePoint = codePoint;
        if (!fullCollapse) {
          middle += char;
          continue;
        }
      }
    } else {
      currentCollapsedCodePoint = -1;
      middle += char;
    }
  }

  return leadingEmphatics + middle + trailingEmphatics;
}

// ── Combining-character normalization (ported from Yomitan japanese.js) ────────

function dakutenAllowed(codePoint: number): boolean {
  return (
    (codePoint >= 0x304b && codePoint <= 0x3068) ||
    (codePoint >= 0x306f && codePoint <= 0x307b) ||
    (codePoint >= 0x30ab && codePoint <= 0x30c8) ||
    (codePoint >= 0x30cf && codePoint <= 0x30db)
  );
}

function handakutenAllowed(codePoint: number): boolean {
  return (
    (codePoint >= 0x306f && codePoint <= 0x307b) || (codePoint >= 0x30cf && codePoint <= 0x30db)
  );
}

/** Combines decomposed dakuten/handakuten (e.g. U+30C8 U+3099 → U+30C9). */
export function normalizeCombiningCharacters(text: string): string {
  let result = '';
  let i = text.length - 1;
  // The first character can't combine with anything before it.
  while (i > 0) {
    if (text[i] === '゙') {
      const dakutenCombinee = text[i - 1].codePointAt(0);
      if (dakutenCombinee && dakutenAllowed(dakutenCombinee)) {
        result = String.fromCodePoint(dakutenCombinee + 1) + result;
        i -= 2;
        continue;
      }
    } else if (text[i] === '゚') {
      const handakutenCombinee = text[i - 1].codePointAt(0);
      if (handakutenCombinee && handakutenAllowed(handakutenCombinee)) {
        result = String.fromCodePoint(handakutenCombinee + 2) + result;
        i -= 2;
        continue;
      }
    }
    result = text[i] + result;
    i--;
  }
  if (i === 0) result = text[0] + result;
  return result;
}

/** Normalizes CJK compatibility characters (e.g. ㌀ → アパート). */
export function normalizeCJKCompatibilityCharacters(text: string): string {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const codePoint = text[i].codePointAt(0);
    result +=
      codePoint && isCodePointInRange(codePoint, CJK_COMPATIBILITY)
        ? text[i].normalize('NFKD')
        : text[i];
  }
  return result;
}

// ── Alphanumeric width variants (ported from Yomitan japanese.js) ─────────────

export function convertAlphanumericToFullWidth(text: string): string {
  let result = '';
  for (const char of text) {
    let c = char.codePointAt(0)!;
    if (c >= 0x30 && c <= 0x39)
      c += 0xff10 - 0x30; // 0-9
    else if (c >= 0x41 && c <= 0x5a)
      c += 0xff21 - 0x41; // A-Z
    else if (c >= 0x61 && c <= 0x7a) c += 0xff41 - 0x61; // a-z
    result += String.fromCodePoint(c);
  }
  return result;
}

export function convertFullWidthAlphanumericToNormal(text: string): string {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    let c = text[i].codePointAt(0)!;
    if (c >= 0xff10 && c <= 0xff19)
      c -= 0xff10 - 0x30; // ０-９
    else if (c >= 0xff21 && c <= 0xff3a)
      c -= 0xff21 - 0x41; // Ａ-Ｚ
    else if (c >= 0xff41 && c <= 0xff5a) c -= 0xff41 - 0x61; // ａ-ｚ
    result += String.fromCodePoint(c);
  }
  return result;
}

/**
 * Returns every variant Yomitan's Japanese text preprocessors would try for a
 * candidate string, by chained expansion (cartesian product) so combinations
 * compose just as they do in Translator._getTextVariants. The unmodified text is
 * always preserved (each preprocessor yields it first), so exact forms still hit.
 *
 * Ports the feasible subset of Yomitan's `ja` textPreprocessors. Omitted:
 * alphabeticToHiragana (romaji input — irrelevant to OCR), normalizeRadicalCharacters
 * and standardizeKanji (need large external mapping tables for marginal benefit).
 */
export function generateTextVariants(text: string): string[] {
  const preprocessors: ((s: string) => string[])[] = [
    (s) => [s, convertHalfWidthKanaToFullWidth(s)],
    (s) => [s, normalizeCombiningCharacters(s)],
    (s) => [s, normalizeCJKCompatibilityCharacters(s)],
    (s) => [s, convertFullWidthAlphanumericToNormal(s), convertAlphanumericToFullWidth(s)],
    (s) => [s, convertHiraganaToKatakana(s), convertKatakanaToHiragana(s)],
    (s) => [s, collapseEmphaticSequences(s, false), collapseEmphaticSequences(s, true)]
  ];

  let variants = new Set<string>([text]);
  for (const preprocess of preprocessors) {
    const next = new Set<string>();
    for (const v of variants) for (const out of preprocess(v)) next.add(out);
    variants = next;
  }
  return [...variants];
}
