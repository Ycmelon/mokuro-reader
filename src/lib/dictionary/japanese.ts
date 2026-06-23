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

// Codepoint ranges from Yomitan's ext/js/language/ja/japanese.js
export function isCodePointJapanese(cp: number): boolean {
  return (
    (cp >= 0x3040 && cp <= 0x309f) || // Hiragana
    (cp >= 0x30a0 && cp <= 0x30ff) || // Katakana
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified Ideographs
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Extension A
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK Compatibility Ideographs
    (cp >= 0x20000 && cp <= 0x2a6df) || // CJK Extension B
    (cp >= 0xff66 && cp <= 0xff9f) || // Halfwidth katakana
    (cp >= 0x30fb && cp <= 0x30fc) || // Katakana punctuation
    (cp >= 0xff61 && cp <= 0xff65) // Kana punctuation
  );
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

/** Returns all kana/width variants Yomitan would try for a candidate string. */
export function generateTextVariants(text: string): string[] {
  const variants = new Set<string>();
  variants.add(text);
  variants.add(convertHalfWidthKanaToFullWidth(text));
  const asHiragana = convertKatakanaToHiragana(text);
  variants.add(asHiragana);
  variants.add(convertHiraganaToKatakana(text));
  variants.add(convertKatakanaToHiragana(text, true)); // keep prolonged sound marks
  return [...variants];
}
