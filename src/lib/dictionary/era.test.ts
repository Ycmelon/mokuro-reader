import { describe, expect, it } from 'vitest';
import { detectEraYear, parseNumberPrefix } from './era';

describe('parseNumberPrefix', () => {
  it('parses kanji positional numbers', () => {
    expect(parseNumberPrefix('五十六年', 0)).toEqual({ value: 56, length: 3 });
    expect(parseNumberPrefix('三十一', 0)).toEqual({ value: 31, length: 3 });
    expect(parseNumberPrefix('百二十三', 0)).toEqual({ value: 123, length: 4 });
  });
  it('parses Arabic and full-width digits', () => {
    expect(parseNumberPrefix('56年', 0)).toEqual({ value: 56, length: 2 });
    expect(parseNumberPrefix('３１', 0)).toEqual({ value: 31, length: 2 });
  });
  it('treats 元 as year 1', () => {
    expect(parseNumberPrefix('元年', 0)).toEqual({ value: 1, length: 1 });
  });
  it('returns null when there is no number', () => {
    expect(parseNumberPrefix('年', 0)).toBeNull();
  });
});

describe('detectEraYear', () => {
  it('converts era years to Gregorian', () => {
    expect(detectEraYear('昭和五十六年', 0)).toMatchObject({ gregorianYear: 1981 });
    expect(detectEraYear('平成三十一年', 0)).toMatchObject({ gregorianYear: 2019 });
    expect(detectEraYear('令和元年', 0)).toMatchObject({ gregorianYear: 2019 });
    expect(detectEraYear('平成３１年', 0)).toMatchObject({
      gregorianYear: 2019,
      text: '平成３１年'
    });
  });
  it('works mid-string and consumes the trailing 年', () => {
    const m = detectEraYear('これは昭和56年です', 3);
    expect(m).toMatchObject({ gregorianYear: 1981, text: '昭和56年', length: 5 });
  });
  it('returns null for non-era text', () => {
    expect(detectEraYear('食べる', 0)).toBeNull();
    expect(detectEraYear('昭和です', 0)).toBeNull();
  });
});
