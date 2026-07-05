// Japanese era-year (和暦) detection and conversion to the Gregorian calendar.
// Manga — especially historical or slice-of-life — dates things as 昭和五十六年
// or 平成３１年; this recognizes such spans at the cursor and offers the Western
// year (e.g. 1981年) as a synthetic dictionary result. Ported in spirit from
// 10ten's content/dates.ts + numbers.ts.

// Gregorian year of each era's year 1. gregorian = start + eraYear - 1.
const ERAS: { name: string; start: number }[] = [
  { name: '明治', start: 1868 },
  { name: '大正', start: 1912 },
  { name: '昭和', start: 1926 },
  { name: '平成', start: 1989 },
  { name: '令和', start: 2019 }
];

const DIGITS: Record<string, number> = {
  〇: 0,
  '０': 0,
  '0': 0,
  零: 0,
  一: 1,
  '１': 1,
  '1': 1,
  壱: 1,
  二: 2,
  '２': 2,
  '2': 2,
  弐: 2,
  三: 3,
  '３': 3,
  '3': 3,
  参: 3,
  四: 4,
  '４': 4,
  '4': 4,
  五: 5,
  '５': 5,
  '5': 5,
  六: 6,
  '６': 6,
  '6': 6,
  七: 7,
  '７': 7,
  '7': 7,
  八: 8,
  '８': 8,
  '8': 8,
  九: 9,
  '９': 9,
  '9': 9
};
const UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

/**
 * Parses a leading Japanese number (Arabic, full-width, or kanji with 十/百/千
 * positional units, plus 元 = year 1) from `text` at `start`. Returns the value
 * and the number of characters consumed, or null if there is no number there.
 */
export function parseNumberPrefix(
  text: string,
  start: number
): { value: number; length: number } | null {
  if (text[start] === '元') return { value: 1, length: 1 };

  let i = start;
  let total = 0; // accumulated value of completed unit groups
  let current = 0; // digits pending a unit (or the final ones-place)
  let sawDigit = false;

  while (i < text.length) {
    const ch = text[i];
    if (ch in DIGITS) {
      // Positional Arabic/full-width run (５６) vs kanji single digits.
      current = current * 10 + DIGITS[ch];
      sawDigit = true;
      i++;
    } else if (ch in UNITS) {
      const unit = UNITS[ch];
      total += (current === 0 ? 1 : current) * unit;
      current = 0;
      sawDigit = true;
      i++;
    } else {
      break;
    }
  }

  if (!sawDigit) return null;
  return { value: total + current, length: i - start };
}

export interface EraYearMatch {
  /** Characters consumed from the start offset (era + year [+ 年]). */
  length: number;
  /** The matched span as written, e.g. "昭和五十六年". */
  text: string;
  gregorianYear: number;
}

/**
 * Detects an era-year expression at `text[startOffset]` (era name, year, and an
 * optional trailing 年). Returns null if the text there is not an era year.
 */
export function detectEraYear(text: string, startOffset: number): EraYearMatch | null {
  const era = ERAS.find((e) => text.startsWith(e.name, startOffset));
  if (!era) return null;

  const numStart = startOffset + era.name.length;
  const num = parseNumberPrefix(text, numStart);
  if (!num || num.value < 1) return null;

  let end = numStart + num.length;
  if (text[end] === '年') end++;

  return {
    length: end - startOffset,
    text: text.slice(startOffset, end),
    gregorianYear: era.start + num.value - 1
  };
}
