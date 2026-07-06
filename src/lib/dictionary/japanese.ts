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

const KANA_RANGES: CodepointRange[] = [
  [0x3040, 0x309f], // Hiragana
  [0x30a0, 0x30ff], // Katakana
  [0xff66, 0xff9f] // Halfwidth katakana
];

/** True if every character is kana (hira/kata, incl. long marks) — used to tell
 *  a kana lookup from a kanji one when ranking results. */
export function isAllKana(text: string): boolean {
  if (text.length === 0) return false;
  for (const ch of text) {
    if (!isCodePointInRanges(ch.codePointAt(0)!, KANA_RANGES)) return false;
  }
  return true;
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

// Enclosed CJK Letters and Months (U+3200–U+32FF): circled/parenthesized kana
// and ideographs such as ㋐ (→ ア) or ㋿ (→ 令和). NFKD decomposes them to their
// plain forms; e.g. 弾道㋯㋚㋑㋸防衛 → 弾道ミサイル防衛.
const ENCLOSED_CJK_RANGE: [number, number] = [0x3200, 0x32ff];

/** Normalizes enclosed CJK letters/months (e.g. ㋐ → ア, ㋿ → 令和). */
export function normalizeEnclosedCJKCharacters(text: string): string {
  let result = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    result += cp && isCodePointInRange(cp, ENCLOSED_CJK_RANGE) ? ch.normalize('NFKD') : ch;
  }
  return result;
}

// ── 旧字体 → 新字体 (old kanji forms → modern forms) ───────────────────────────
// Older/period manga still uses pre-1946 character forms. Jitendex stores many
// as "old kanji form" headwords, but not all, so we also fold the common jōyō
// 旧字体 down to their 新字体 as a lookup variant. Curated to unambiguous,
// high-frequency pairs to avoid mis-mapping characters that survive in modern
// use (e.g. 辨/瓣/辯 all merged to 弁 are included; rare/ambiguous ones are not).
const KYUUJITAI_TO_SHINJITAI: Record<string, string> = {
  亞: '亜',
  惡: '悪',
  壓: '圧',
  圍: '囲',
  醫: '医',
  爲: '為',
  壹: '壱',
  逸: '逸',
  隱: '隠',
  榮: '栄',
  營: '営',
  衞: '衛',
  驛: '駅',
  謁: '謁',
  圓: '円',
  鹽: '塩',
  奧: '奥',
  應: '応',
  橫: '横',
  歐: '欧',
  毆: '殴',
  黃: '黄',
  溫: '温',
  穩: '穏',
  假: '仮',
  價: '価',
  禍: '禍',
  畫: '画',
  會: '会',
  悔: '悔',
  海: '海',
  繪: '絵',
  慨: '慨',
  概: '概',
  擴: '拡',
  殼: '殻',
  覺: '覚',
  學: '学',
  嶽: '岳',
  樂: '楽',
  喝: '喝',
  渴: '渇',
  褐: '褐',
  勸: '勧',
  卷: '巻',
  寬: '寛',
  歡: '歓',
  漢: '漢',
  館: '館',
  觀: '観',
  關: '関',
  顏: '顔',
  氣: '気',
  歸: '帰',
  器: '器',
  僞: '偽',
  戲: '戯',
  犧: '犠',
  舊: '旧',
  據: '拠',
  擧: '挙',
  虛: '虚',
  峽: '峡',
  挾: '挟',
  狹: '狭',
  響: '響',
  曉: '暁',
  勤: '勤',
  謹: '謹',
  區: '区',
  驅: '駆',
  勳: '勲',
  薰: '薫',
  群: '群',
  徑: '径',
  惠: '恵',
  揭: '掲',
  溪: '渓',
  經: '経',
  繼: '継',
  莖: '茎',
  螢: '蛍',
  輕: '軽',
  藝: '芸',
  擊: '撃',
  缺: '欠',
  硏: '研',
  縣: '県',
  儉: '倹',
  劍: '剣',
  圈: '圏',
  檢: '検',
  權: '権',
  獻: '献',
  硯: '硯',
  險: '険',
  顯: '顕',
  驗: '験',
  嚴: '厳',
  效: '効',
  廣: '広',
  恆: '恒',
  鑛: '鉱',
  號: '号',
  國: '国',
  黑: '黒',
  穀: '穀',
  碎: '砕',
  齋: '斎',
  劑: '剤',
  櫻: '桜',
  冊: '冊',
  雜: '雑',
  產: '産',
  贊: '賛',
  殘: '残',
  絲: '糸',
  姉: '姉',
  齒: '歯',
  兒: '児',
  辭: '辞',
  濕: '湿',
  實: '実',
  舍: '舎',
  寫: '写',
  釋: '釈',
  壽: '寿',
  收: '収',
  臭: '臭',
  從: '従',
  澀: '渋',
  獸: '獣',
  縱: '縦',
  祝: '祝',
  肅: '粛',
  處: '処',
  緖: '緒',
  敍: '叙',
  尙: '尚',
  奬: '奨',
  將: '将',
  涉: '渉',
  燒: '焼',
  稱: '称',
  證: '証',
  乘: '乗',
  剩: '剰',
  壤: '壌',
  孃: '嬢',
  條: '条',
  淨: '浄',
  狀: '状',
  疊: '畳',
  讓: '譲',
  釀: '醸',
  觸: '触',
  寢: '寝',
  愼: '慎',
  眞: '真',
  神: '神',
  盡: '尽',
  圖: '図',
  粹: '粋',
  醉: '酔',
  隨: '随',
  髓: '髄',
  樞: '枢',
  數: '数',
  瀨: '瀬',
  聲: '声',
  靜: '静',
  齊: '斉',
  稅: '税',
  蹟: '跡',
  說: '説',
  攝: '摂',
  竊: '窃',
  節: '節',
  專: '専',
  淺: '浅',
  戰: '戦',
  踐: '践',
  錢: '銭',
  潛: '潜',
  纖: '繊',
  禪: '禅',
  祖: '祖',
  雙: '双',
  壯: '壮',
  爭: '争',
  搜: '捜',
  插: '挿',
  巢: '巣',
  曾: '曽',
  瘦: '痩',
  總: '総',
  莊: '荘',
  裝: '装',
  騷: '騒',
  增: '増',
  藏: '蔵',
  贈: '贈',
  臟: '臓',
  卽: '即',
  屬: '属',
  續: '続',
  墮: '堕',
  體: '体',
  對: '対',
  帶: '帯',
  滯: '滞',
  臺: '台',
  瀧: '滝',
  擇: '択',
  澤: '沢',
  擔: '担',
  單: '単',
  膽: '胆',
  嘆: '嘆',
  團: '団',
  斷: '断',
  彈: '弾',
  遲: '遅',
  癡: '痴',
  蟲: '虫',
  鑄: '鋳',
  著: '著',
  廳: '庁',
  徵: '徴',
  懲: '懲',
  敕: '勅',
  鎭: '鎮',
  轉: '転',
  傳: '伝',
  都: '都',
  燈: '灯',
  當: '当',
  黨: '党',
  盜: '盗',
  稻: '稲',
  鬭: '闘',
  德: '徳',
  獨: '独',
  讀: '読',
  突: '突',
  屆: '届',
  難: '難',
  貳: '弐',
  惱: '悩',
  腦: '脳',
  霸: '覇',
  拜: '拝',
  廢: '廃',
  賣: '売',
  麥: '麦',
  發: '発',
  髮: '髪',
  拔: '抜',
  繁: '繁',
  晚: '晩',
  蠻: '蛮',
  卑: '卑',
  祕: '秘',
  碑: '碑',
  彥: '彦',
  姫: '姫',
  濱: '浜',
  賓: '賓',
  頻: '頻',
  敏: '敏',
  甁: '瓶',
  侮: '侮',
  福: '福',
  拂: '払',
  佛: '仏',
  倂: '併',
  塀: '塀',
  竝: '並',
  變: '変',
  邊: '辺',
  勉: '勉',
  步: '歩',
  峯: '峰',
  墨: '墨',
  飜: '翻',
  每: '毎',
  萬: '万',
  滿: '満',
  免: '免',
  麵: '麺',
  默: '黙',
  彌: '弥',
  藥: '薬',
  譯: '訳',
  豫: '予',
  餘: '余',
  與: '与',
  譽: '誉',
  搖: '揺',
  樣: '様',
  謠: '謡',
  來: '来',
  賴: '頼',
  亂: '乱',
  欄: '欄',
  覽: '覧',
  隆: '隆',
  龍: '竜',
  虜: '虜',
  兩: '両',
  獵: '猟',
  綠: '緑',
  淚: '涙',
  壘: '塁',
  類: '類',
  禮: '礼',
  勵: '励',
  戾: '戻',
  靈: '霊',
  齡: '齢',
  曆: '暦',
  歷: '歴',
  戀: '恋',
  練: '練',
  鍊: '錬',
  爐: '炉',
  勞: '労',
  郞: '郎',
  朗: '朗',
  廊: '廊',
  樓: '楼',
  錄: '録',
  灣: '湾',
  辨: '弁',
  瓣: '弁',
  辯: '弁',
  缽: '鉢',
  醬: '醤'
};

/** Folds common 旧字体 characters down to their 新字体 equivalents. */
export function convertKyuujitaiToShinjitai(text: string): string {
  let result = '';
  for (const ch of text) result += KYUUJITAI_TO_SHINJITAI[ch] ?? ch;
  return result;
}

// ── Mora splitting (for pitch-accent rendering) ──────────────────────────────
// A mora is a kana, except that small ゃゅょ / ぁぃぅぇぉ / ゎ (and katakana
// equivalents) attach to the preceding kana to form one mora. っ, ん and ー are
// each their own mora. Pitch-accent positions are mora indices, so display must
// split on mora boundaries, not characters.
const SMALL_FOLLOWING_KANA = new Set([...'ぁぃぅぇぉゃゅょゎゕゖ', ...'ァィゥェォャュョヮヵヶ']);

/** Splits kana text into mora (small kana attach to the preceding mora). */
export function splitMora(text: string): string[] {
  const mora: string[] = [];
  for (const ch of text) {
    if (mora.length > 0 && SMALL_FOLLOWING_KANA.has(ch)) {
      mora[mora.length - 1] += ch;
    } else {
      mora.push(ch);
    }
  }
  return mora;
}

export function countMora(text: string): number {
  return splitMora(text).length;
}

/** Joins the mora of `text` in the half-open range [start, end). */
export function moraSubstring(text: string, start: number, end?: number): string {
  return splitMora(text).slice(start, end).join('');
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

// ── Prolonged sound mark (ー) expansion ───────────────────────────────────────
// Stylized manga text often writes a long vowel with ー even in hiragana runs
// (おーきい, ねー, じーちゃん). The dictionary stores the spelled-out vowel
// (おおきい, ねえ), so a lookup must expand ー to the vowel of the preceding
// mora. The e/o rows are genuinely ambiguous (ねー → ねえ *or* ねい, とー → とお
// *or* とう), so we branch and let the dictionary decide which spelling exists.
// This is why the single-guess mapping baked into convertKatakanaToHiragana
// (which always resolves the o-row to う) is insufficient on its own.

const HIRAGANA_VOWELS: Record<string, string[]> = {
  a: ['あ'],
  i: ['い'],
  u: ['う'],
  e: ['え', 'い'],
  o: ['お', 'う']
};
const KATAKANA_VOWELS: Record<string, string[]> = {
  a: ['ア'],
  i: ['イ'],
  u: ['ウ'],
  e: ['エ', 'イ'],
  o: ['オ', 'ウ']
};

function isHiragana(cp: number): boolean {
  return cp >= HIRAGANA_CONVERSION_RANGE[0] && cp <= HIRAGANA_CONVERSION_RANGE[1];
}

/**
 * Returns every plausible spelling of `text` with each ー resolved to the vowel
 * kana of the preceding mora (in that mora's own script). Multiple ー compose
 * as a cartesian product. The identity string is *not* included — callers add
 * it — and an unresolvable ー (no preceding kana, or ambiguous script) leaves
 * that mark untouched. Returns [] when there is nothing to expand.
 */
export function expandChoon(text: string): string[] {
  if (!text.includes('ー')) return [];
  let variants = [''];
  let changed = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== 'ー' || i === 0) {
      variants = variants.map((v) => v + ch);
      continue;
    }
    const prev = text[i - 1];
    const vowel = KANA_TO_VOWEL.get(prev);
    const table = isHiragana(prev.codePointAt(0)!) ? HIRAGANA_VOWELS : KATAKANA_VOWELS;
    const options = vowel !== undefined ? table[vowel] : undefined;
    if (!options) {
      variants = variants.map((v) => v + ch);
      continue;
    }
    changed = true;
    variants = variants.flatMap((v) => options.map((o) => v + o));
  }
  return changed ? [...new Set(variants)].filter((v) => v !== text) : [];
}
