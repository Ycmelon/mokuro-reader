import { describe, expect, it } from 'vitest';
import {
  expandChoon,
  convertKyuujitaiToShinjitai,
  normalizeEnclosedCJKCharacters,
  isAllKana,
  splitMora,
  countMora,
  moraSubstring
} from './japanese';

describe('expandChoon', () => {
  it('branches on ambiguous e/o rows', () => {
    expect(expandChoon('おーきい')).toEqual(expect.arrayContaining(['おおきい', 'おうきい']));
    expect(expandChoon('ねー')).toEqual(expect.arrayContaining(['ねえ', 'ねい']));
  });
  it('resolves unambiguous rows to a single vowel', () => {
    expect(expandChoon('じーちゃん')).toEqual(['じいちゃん']);
  });
  it('returns nothing when there is no ー', () => {
    expect(expandChoon('食べる')).toEqual([]);
  });
});

describe('convertKyuujitaiToShinjitai', () => {
  it('folds old kanji forms to modern', () => {
    expect(convertKyuujitaiToShinjitai('國學')).toBe('国学');
    expect(convertKyuujitaiToShinjitai('辨當')).toBe('弁当');
    expect(convertKyuujitaiToShinjitai('食べる')).toBe('食べる');
  });
});

describe('normalizeEnclosedCJKCharacters', () => {
  it('decomposes circled katakana', () => {
    expect(normalizeEnclosedCJKCharacters('㋯㋚㋑㋸')).toBe('ミサイル');
  });
});

describe('isAllKana', () => {
  it('distinguishes kana from kanji', () => {
    expect(isAllKana('みる')).toBe(true);
    expect(isAllKana('ミル')).toBe(true);
    expect(isAllKana('見る')).toBe(false);
    expect(isAllKana('')).toBe(false);
  });
});

describe('mora helpers', () => {
  it('attaches small kana to the preceding mora', () => {
    expect(splitMora('きょう')).toEqual(['きょ', 'う']);
    expect(countMora('しゃちょう')).toBe(3);
    expect(moraSubstring('しゃちょう', 0, 1)).toBe('しゃ');
    expect(moraSubstring('しゃちょう', 1)).toBe('ちょう');
  });
});
