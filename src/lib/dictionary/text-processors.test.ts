import { describe, expect, it } from 'vitest';
import { getTextVariants, japaneseTextProcessors } from './text-processors';

/** The candidate spellings (map keys) produced for a source string. */
function variants(text: string): string[] {
  return [...getTextVariants(text).keys()];
}

describe('getTextVariants', () => {
  it('always includes the unmodified source', () => {
    expect(variants('食べる')).toContain('食べる');
  });

  it('includes the chōon and kyūjitai expansions', () => {
    expect(variants('おーきい')).toContain('おおきい');
    expect(variants('國')).toContain('国');
  });

  it('produces the katakana/hiragana counterpart', () => {
    expect(variants('みる')).toContain('ミル');
    expect(variants('ミル')).toContain('みる');
  });

  it('collapses emphatic gemination (すっごい → すごい)', () => {
    expect(variants('すっごい')).toContain('すごい');
  });

  it('does not explode plain text', () => {
    // Only the identity spelling plus the katakana counterpart of its kana tail.
    expect(variants('食べる')).toEqual(['食べる', '食ベル']);
  });

  it('records the shortest processor chain that reaches each variant', () => {
    const map = getTextVariants('おーきい');
    // The identity spelling is reached with an empty chain.
    expect(map.get('おーきい')).toEqual([[]]);
    // A transformed spelling carries the id of the processor that produced it.
    const chains = map.get('おおきい');
    expect(chains?.some((chain) => chain.includes('expandChoon'))).toBe(true);
  });

  it('exposes processors in Yomitan descriptor order', () => {
    expect(japaneseTextProcessors[0].id).toBe('convertHalfWidthCharacters');
  });
});
